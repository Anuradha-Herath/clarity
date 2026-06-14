/**
 * Clarity — pages/planner.js
 * Full 4-tab planner logic: Day · Week · Month · Year
 * ES Module.
 */

import {
  getTasks, addTask, updateTask, deleteTask, setTasks,
  getBlocks,
  get, set,
  getYearlyThemes, setMonthTheme, setMonthGoals,
  generateId, todayKey, dateKey,
  snapHour,
  getCustomCategories, addCustomCategory, deleteCustomCategory, renameCustomCategory,
} from '../shared/storage.js';

import { mountTimeboard } from '../shared/timeboard.js';

// ─── Date helpers ──────────────────────────────────────────────────────────────
function isoDate(d) { return d.toISOString().slice(0, 10); }

function getMondayOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return isoDate(d);
}

function getWeekDates(mondayStr) {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayStr + 'T12:00:00');
    d.setDate(d.getDate() + i);
    dates.push(isoDate(d));
  }
  return dates;
}

function fmtLong(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function fmtShort(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
}

function fmtMonthYear(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

// ─── State ────────────────────────────────────────────────────────────────────
const TODAY          = todayKey();
let currentDate      = TODAY;
let currentWeekStart = getMondayOf(TODAY);
let currentYear      = new Date().getFullYear();
let currentMonth     = new Date().getMonth(); // 0-indexed
let activeCat        = 'Deep Work';
let selectedPriority = 1;
let activeTab        = 'day';
let collapsedCategories = [];

let timeboardInstance = null;

// ─── Tab switching ─────────────────────────────────────────────────────────────
const tabBtns   = document.querySelectorAll('[data-tab]');
const tabPanels = {
  day:   document.getElementById('tab-day'),
  week:  document.getElementById('tab-week'),
  month: document.getElementById('tab-month'),
  year:  document.getElementById('tab-year'),
};

tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    switchTab(tab);
  });
});

async function switchTab(tab) {
  activeTab = tab;
  tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  Object.entries(tabPanels).forEach(([key, el]) => {
    el.classList.toggle('active', key === tab);
    el.classList.toggle('hidden', key !== tab);
  });

  if (tab === 'day') {
    mountDayBoard();
    renderDayDate();
    await populateCategoryDropdowns();
    await renderPriorityList();
    await loadNotes();
  } else if (tab === 'week') {
    renderWeekTab();
  } else if (tab === 'month') {
    renderMonthTab();
  } else if (tab === 'year') {
    renderYearTab();
  }
}

// Helper to switch to Day tab for a specific date
function goToDay(dateStr) {
  currentDate = dateStr;
  switchTab('day');
}

// ─── ══════════════════════════════════════════════════════
//     DAY TAB
// ══════════════════════════════════════════════════════════

// Date navigation
const btnPrevDay  = document.getElementById('btn-prev-day');
const btnNextDay  = document.getElementById('btn-next-day');
const btnGoToday  = document.getElementById('btn-go-today');
const dayNavDate  = document.getElementById('day-nav-date');

btnPrevDay.addEventListener('click', () => {
  const d = new Date(currentDate + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  currentDate = isoDate(d);
  onDayChanged();
});

btnNextDay.addEventListener('click', () => {
  const d = new Date(currentDate + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  currentDate = isoDate(d);
  onDayChanged();
});

btnGoToday.addEventListener('click', () => {
  currentDate = TODAY;
  onDayChanged();
});

function renderDayDate() {
  dayNavDate.textContent = fmtLong(currentDate);
  btnGoToday.classList.toggle('hidden', currentDate === TODAY);
}

async function onDayChanged() {
  renderDayDate();
  if (timeboardInstance) timeboardInstance.refresh(currentDate);
  await renderPriorityList();
  await loadNotes();
}

// Category pills
const catPillsBar = document.getElementById('cat-pills-bar');
catPillsBar.querySelectorAll('.cat-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    catPillsBar.querySelectorAll('.cat-pill').forEach((p) => p.classList.remove('selected'));
    pill.classList.add('selected');
    activeCat = pill.dataset.cat;
  });
});

// Mount timeboard
function mountDayBoard() {
  const container = document.getElementById('day-board-wrapper');
  if (timeboardInstance) {
    timeboardInstance.refresh(currentDate);
    return;
  }
  timeboardInstance = mountTimeboard(container, currentDate, {
    getSelectedCat: () => activeCat,
  });
}

// ── Priority list & Categories ──────────────────────────────────────────────

const priorityList      = document.getElementById('priority-list');
const priorityTaskCount = document.getElementById('priority-task-count');
const priorityInput     = document.getElementById('priority-input');
const btnAddPriority    = document.getElementById('btn-add-priority');
const categoryFilter    = document.getElementById('priority-category-filter');
const quickAddCatInput  = document.getElementById('quick-add-category-input');

// Category filter state
let activeCategoryFilter = 'all';

// Priority dot selector
document.querySelectorAll('.priority-dot-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.priority-dot-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    selectedPriority = parseInt(btn.dataset.p, 10);
  });
});

// Populate Category selects/dropdowns
async function populateCategoryDropdowns() {
  const categories = await getCustomCategories();
  
  // Populate filter dropdown
  const currentFilterVal = categoryFilter.value || 'all';
  categoryFilter.innerHTML = `<option value="all">All Categories</option>` + 
    categories.map(cat => `<option value="${escHtml(cat)}">${escHtml(cat)}</option>`).join('');
  categoryFilter.value = currentFilterVal;

  // Populate quick add dropdown
  const currentQuickAddVal = quickAddCatInput.value || 'Personal';
  quickAddCatInput.innerHTML = categories.map(cat => `<option value="${escHtml(cat)}">${escHtml(cat)}</option>`).join('');
  quickAddCatInput.value = categories.includes(currentQuickAddVal) ? currentQuickAddVal : categories[0] || 'Personal';

  // Populate task modal dropdown
  const taskCategoryInput = document.getElementById('task-category-input');
  const currentModalVal = taskCategoryInput.value || 'Personal';
  taskCategoryInput.innerHTML = categories.map(cat => `<option value="${escHtml(cat)}">${escHtml(cat)}</option>`).join('');
  taskCategoryInput.value = categories.includes(currentModalVal) ? currentModalVal : categories[0] || 'Personal';
}

categoryFilter.addEventListener('change', () => {
  activeCategoryFilter = categoryFilter.value;
  renderPriorityList();
});

async function renderPriorityList() {
  const tasks = await getTasks(currentDate);
  // Sort: priority asc, then undone before done
  const sorted = [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return (a.priority ?? 3) - (b.priority ?? 3);
  });

  const pCount = tasks.filter((t) => !t.done).length;
  priorityTaskCount.textContent = `${pCount} pending`;

  const categories = await getCustomCategories();
  
  // Group tasks by category
  const grouped = {};
  categories.forEach(cat => {
    grouped[cat] = [];
  });
  // Fallbacks
  grouped['Personal'] = grouped['Personal'] || [];
  grouped['Other'] = grouped['Other'] || [];

  for (const t of sorted) {
    const cat = t.category || 'Personal';
    if (!grouped[cat]) {
      grouped[cat] = [];
    }
    grouped[cat].push(t);
  }

  // Generate html sections for categories
  let html = '';
  let renderedCount = 0;

  for (const cat of Object.keys(grouped)) {
    const catTasks = grouped[cat];
    if (catTasks.length === 0) continue;
    if (activeCategoryFilter !== 'all' && activeCategoryFilter !== cat) continue;

    renderedCount += catTasks.length;
    const pendingCount = catTasks.filter(t => !t.done).length;
    const isCollapsed = collapsedCategories.includes(cat);

    html += `
      <div class="category-group" data-category="${escHtml(cat)}">
        <div class="category-group-header" data-cat="${escHtml(cat)}" style="cursor: pointer; user-select: none; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="category-group-chevron" style="display: inline-flex; align-items: center; transition: transform 0.2s; transform: ${isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </span>
            <span class="category-group-title">${escHtml(cat)}</span>
          </div>
          <span class="category-group-badge ${pendingCount > 0 ? 'active' : ''}">${pendingCount}</span>
        </div>
        <div class="category-group-list" style="display: ${isCollapsed ? 'none' : 'block'};">
          ${catTasks.map((t) => `
            <div class="priority-item-container" style="border-bottom: 1px solid var(--color-border); padding: 7px 0; display: flex; flex-direction: column;">
              <div class="priority-item" data-id="${t.id}" draggable="true" style="border-bottom: none; padding: 0; cursor: grab;">
                <input type="checkbox" class="priority-item-check" data-id="${t.id}" ${t.done ? 'checked' : ''} />
                <div class="priority-dot" data-p="${t.priority ?? 3}" style="flex-shrink:0;"></div>
                <span class="priority-item-title${t.done ? ' done-text' : ''}" data-id="${t.id}">${escHtml(t.title)}</span>
                ${t.timeEstimate ? `<span class="priority-item-est">${t.timeEstimate}m</span>` : ''}
                <div class="priority-item-delete" data-id="${t.id}" title="Delete">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
                       fill="none" stroke="currentColor" stroke-width="2.5"
                       stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6"/><path d="M14 11v6"/>
                  </svg>
                </div>
              </div>
              ${t.subtasks && t.subtasks.length > 0 ? `
                <div class="subtasks-list" style="margin-left: 28px; margin-top: 6px; display: flex; flex-direction: column; gap: 4px;">
                  ${t.subtasks.map(sub => `
                    <div class="subtask-item" draggable="true" data-task-id="${t.id}" data-sub-id="${sub.id}" style="display: flex; align-items: center; gap: 6px; padding: 1px 0; cursor: grab;">
                      <input type="checkbox" class="subtask-item-check" data-task-id="${t.id}" data-sub-id="${sub.id}" ${sub.done ? 'checked' : ''} style="width: 12px; height: 12px; accent-color: var(--color-accent); cursor: pointer;" />
                      <span class="subtask-title-text${sub.done ? ' done-text' : ''}" style="font-size: 12px; color: var(--color-text);">${escHtml(sub.title)}</span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  if (renderedCount === 0) {
    priorityList.innerHTML = `<div style="font-size:13px;color:var(--color-text-muted);padding:12px;text-align:center;font-style:italic;">No tasks today — add one below</div>`;
    return;
  }

  priorityList.innerHTML = html;

  // Collapse toggle
  priorityList.querySelectorAll('.category-group-header').forEach((hdr) => {
    hdr.addEventListener('click', async () => {
      const cat = hdr.dataset.cat;
      if (collapsedCategories.includes(cat)) {
        collapsedCategories = collapsedCategories.filter(c => c !== cat);
      } else {
        collapsedCategories.push(cat);
      }
      await set('collapsed_categories', collapsedCategories);
      await renderPriorityList();
    });
  });

  // Checkbox toggle
  priorityList.querySelectorAll('.priority-item-check').forEach((cb) => {
    cb.addEventListener('change', async () => {
      await updateTask(currentDate, cb.dataset.id, { done: cb.checked });
      await renderPriorityList();
    });
  });

  // Subtask checkbox toggles
  priorityList.querySelectorAll('.subtask-item-check').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const taskId = cb.dataset.taskId;
      const subId = cb.dataset.subId;
      const tasks = await getTasks(currentDate);
      const t = tasks.find(x => x.id === taskId);
      if (t && t.subtasks) {
        const sub = t.subtasks.find(s => s.id === subId);
        if (sub) {
          sub.done = cb.checked;
          await updateTask(currentDate, taskId, { subtasks: t.subtasks });
          await renderPriorityList();
        }
      }
    });
  });

  // Click title → open edit modal
  priorityList.querySelectorAll('.priority-item-title').forEach((el) => {
    el.addEventListener('click', async () => {
      const tasks = await getTasks(currentDate);
      const t = tasks.find((x) => x.id === el.dataset.id);
      if (t) openTaskModal(t);
    });
  });

  // Delete
  priorityList.querySelectorAll('.priority-item-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await deleteTask(currentDate, btn.dataset.id);
      await renderPriorityList();
    });
  });

  // Dragstart binding
  priorityList.querySelectorAll('.priority-item').forEach((item) => {
    item.addEventListener('dragstart', (e) => {
      const taskId = item.dataset.id;
      const task = sorted.find(t => t.id === taskId);
      if (task) {
        e.dataTransfer.setData('text/plain', JSON.stringify({
          id: task.id,
          title: task.title,
          category: task.category,
          timeEstimate: task.timeEstimate
        }));
        e.dataTransfer.effectAllowed = 'copyMove';
      }
    });
  });

  // Subtask dragstart binding
  priorityList.querySelectorAll('.subtask-item').forEach((item) => {
    item.addEventListener('dragstart', (e) => {
      e.stopPropagation(); // Avoid triggering parent task drag
      const taskId = item.dataset.taskId;
      const subId = item.dataset.subId;
      const task = sorted.find(t => t.id === taskId);
      if (task && task.subtasks) {
        const sub = task.subtasks.find(s => s.id === subId);
        if (sub) {
          e.dataTransfer.setData('text/plain', JSON.stringify({
            id: sub.id,
            parentId: task.id,
            title: `${task.title} — ${sub.title}`,
            category: task.category,
            timeEstimate: 30 // Subtasks default to 30 mins
          }));
          e.dataTransfer.effectAllowed = 'copyMove';
        }
      }
    });
  });
}

async function addPriorityTask() {
  const title = priorityInput.value.trim();
  if (!title) return;
  const category = quickAddCatInput.value;
  await addTask(currentDate, {
    id: generateId(),
    title,
    done: false,
    priority: selectedPriority,
    timeEstimate: null,
    category,
  });
  priorityInput.value = '';
  await renderPriorityList();
}

btnAddPriority.addEventListener('click', addPriorityTask);
priorityInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addPriorityTask(); }
});

// ── Task modal ──────────────────────────────────────────────────────────────
const taskModalOverlay = document.getElementById('task-modal-overlay');
const taskModalTitle   = document.getElementById('task-modal-title');
const taskModalClose   = document.getElementById('task-modal-close');
const btnTaskCancel    = document.getElementById('btn-task-cancel');
const btnTaskSave      = document.getElementById('btn-task-save');
const btnTaskDelete    = document.getElementById('btn-task-delete');
const taskTitleInput   = document.getElementById('task-title-input');
const taskPriorityInput= document.getElementById('task-priority-input');
const taskCategoryInput= document.getElementById('task-category-input');
const taskEstimateInput= document.getElementById('task-estimate-input');

// Subtasks modal selectors
const taskSubtaskInput = document.getElementById('task-subtask-input');
const btnAddSubtask    = document.getElementById('btn-add-subtask');
const modalSubtasksList= document.getElementById('modal-subtasks-list');
const subtaskProgress  = document.getElementById('subtask-progress');

let editingTask = null;
let editingSubtasks = [];

function openTaskModal(task = null) {
  editingTask = task;
  editingSubtasks = task?.subtasks ? JSON.parse(JSON.stringify(task.subtasks)) : [];
  taskModalTitle.textContent = task ? 'Edit Task' : 'Add Task';
  taskTitleInput.value    = task?.title       ?? '';
  taskPriorityInput.value = String(task?.priority ?? 1);
  taskCategoryInput.value = task?.category || 'Personal';
  taskEstimateInput.value = task?.timeEstimate ?? '';
  taskSubtaskInput.value = '';
  
  btnTaskDelete.classList.toggle('hidden', !task);
  taskModalOverlay.classList.remove('hidden');
  taskTitleInput.focus();
  renderModalSubtasks();
}

function renderModalSubtasks() {
  const total = editingSubtasks.length;
  const done = editingSubtasks.filter(s => s.done).length;
  subtaskProgress.textContent = `${done}/${total}`;

  modalSubtasksList.innerHTML = editingSubtasks.map((sub, idx) => `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; background: var(--color-bg); border-radius: 4px; font-size: 12px; gap: 6px;">
      <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
        <input type="checkbox" class="modal-subtask-check" data-idx="${idx}" ${sub.done ? 'checked' : ''} style="width: 13px; height: 13px; cursor: pointer; accent-color: var(--color-accent);" />
        <span class="${sub.done ? 'done-text' : ''}" style="color: var(--color-text); word-break: break-all;">${escHtml(sub.title)}</span>
      </div>
      <button type="button" class="btn btn-ghost btn-xs delete-subtask-btn" data-idx="${idx}" style="color: var(--color-danger); padding: 2px; height: auto;">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `).join('');

  // Bind checkbox change
  modalSubtasksList.querySelectorAll('.modal-subtask-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.idx, 10);
      editingSubtasks[idx].done = cb.checked;
      renderModalSubtasks();
    });
  });

  // Bind delete button click
  modalSubtasksList.querySelectorAll('.delete-subtask-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      editingSubtasks.splice(idx, 1);
      renderModalSubtasks();
    });
  });
}

function addSubtaskFromInput() {
  const title = taskSubtaskInput.value.trim();
  if (!title) return;
  editingSubtasks.push({
    id: generateId(),
    title,
    done: false
  });
  taskSubtaskInput.value = '';
  renderModalSubtasks();
  taskSubtaskInput.focus();
}

btnAddSubtask.addEventListener('click', addSubtaskFromInput);
taskSubtaskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addSubtaskFromInput();
  }
});

function closeTaskModal() {
  taskModalOverlay.classList.add('hidden');
  editingTask = null;
}

async function saveTask() {
  const title = taskTitleInput.value.trim();
  if (!title) { taskTitleInput.focus(); return; }
  const priority    = parseInt(taskPriorityInput.value, 10) || 1;
  const category    = taskCategoryInput.value;
  const timeEstimate= parseInt(taskEstimateInput.value, 10) || null;
  const subtasks    = editingSubtasks;

  if (editingTask) {
    await updateTask(currentDate, editingTask.id, { title, priority, timeEstimate, category, subtasks });
  } else {
    await addTask(currentDate, {
      id: generateId(), title, done: false, priority, timeEstimate, category, subtasks,
    });
  }
  closeTaskModal();
  await renderPriorityList();
}

taskModalClose.addEventListener('click', closeTaskModal);
btnTaskCancel.addEventListener('click', closeTaskModal);
btnTaskSave.addEventListener('click', saveTask);
taskModalOverlay.addEventListener('click', (e) => { if (e.target === taskModalOverlay) closeTaskModal(); });
btnTaskDelete.addEventListener('click', async () => {
  if (!editingTask) return;
  await deleteTask(currentDate, editingTask.id);
  closeTaskModal();
  await renderPriorityList();
});
taskTitleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); saveTask(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !taskModalOverlay.classList.contains('hidden')) closeTaskModal();
});

// ── Categories management modal ─────────────────────────────────────────────
const btnManageCategories = document.getElementById('btn-manage-categories');
const categoriesModalOverlay = document.getElementById('categories-modal-overlay');
const categoriesModalClose = document.getElementById('categories-modal-close');
const btnAddCustomCategory = document.getElementById('btn-add-custom-category');
const newCategoryInput = document.getElementById('new-category-input');
const manageCategoriesList = document.getElementById('manage-categories-list');

async function renderManageCategoriesList() {
  const categories = await getCustomCategories();
  
  manageCategoriesList.innerHTML = categories.map(cat => {
    return `
      <div class="manage-cat-item" data-cat="${escHtml(cat)}" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid var(--color-border); font-size: 13px; gap: 8px;">
        <div class="cat-display-mode" style="display: flex; align-items: center; justify-content: space-between; flex: 1; width: 100%;">
          <span class="cat-name-span" style="font-weight: 500;">${escHtml(cat)}</span>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-ghost btn-xs edit-cat-btn" data-cat="${escHtml(cat)}" style="color: var(--color-text-muted); padding: 2px; height: auto;" title="Rename">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="btn btn-ghost btn-xs delete-cat-btn" data-cat="${escHtml(cat)}" style="color: var(--color-danger); padding: 2px; height: auto;" title="Delete">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="cat-edit-mode hidden" style="display: flex; gap: 4px; flex: 1; width: 100%;">
          <input type="text" class="input input-sm edit-cat-input" value="${escHtml(cat)}" style="height: 24px; font-size: 12px; flex: 1; padding: 2px 6px;" maxlength="30" />
          <button class="btn btn-primary btn-xs save-cat-btn" data-cat="${escHtml(cat)}" style="padding: 2px 6px; font-size: 10px; height: 24px;">Save</button>
          <button class="btn btn-secondary btn-xs cancel-cat-btn" style="padding: 2px 6px; font-size: 10px; height: 24px;">Esc</button>
        </div>
      </div>
    `;
  }).join('');

  // Attach display mode / edit mode toggle
  manageCategoriesList.querySelectorAll('.manage-cat-item').forEach(item => {
    const displayMode = item.querySelector('.cat-display-mode');
    const editMode = item.querySelector('.cat-edit-mode');
    const editInput = item.querySelector('.edit-cat-input');
    const editBtn = item.querySelector('.edit-cat-btn');
    const cancelBtn = item.querySelector('.cancel-cat-btn');
    const saveBtn = item.querySelector('.save-cat-btn');
    const oldCatName = item.dataset.cat;

    editBtn.addEventListener('click', () => {
      displayMode.classList.add('hidden');
      editMode.classList.remove('hidden');
      editInput.focus();
      editInput.select();
    });

    cancelBtn.addEventListener('click', () => {
      editMode.classList.add('hidden');
      displayMode.classList.remove('hidden');
      editInput.value = oldCatName;
    });

    const triggerRename = async () => {
      const newCatName = editInput.value.trim();
      if (!newCatName || newCatName === oldCatName) {
        cancelBtn.click();
        return;
      }
      const success = await renameCustomCategory(oldCatName, newCatName);
      if (success) {
        await populateCategoryDropdowns();
        await renderManageCategoriesList();
        await renderPriorityList();
      } else {
        alert('Category name already exists or is invalid.');
      }
    };

    saveBtn.addEventListener('click', triggerRename);
    editInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelBtn.click();
      }
    });
  });

  // Attach delete events
  manageCategoriesList.querySelectorAll('.delete-cat-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const catToDelete = btn.dataset.cat;
      if (confirm(`Are you sure you want to delete the category "${catToDelete}"? (Tasks in this category will display under "Personal")`)) {
        await deleteCustomCategory(catToDelete);
        await populateCategoryDropdowns();
        await renderManageCategoriesList();
        await renderPriorityList();
      }
    });
  });
}

btnManageCategories.addEventListener('click', () => {
  renderManageCategoriesList();
  categoriesModalOverlay.classList.remove('hidden');
});

categoriesModalClose.addEventListener('click', () => {
  categoriesModalOverlay.classList.add('hidden');
});

categoriesModalOverlay.addEventListener('click', (e) => {
  if (e.target === categoriesModalOverlay) {
    categoriesModalOverlay.classList.add('hidden');
  }
});

async function handleAddCategory() {
  const catName = newCategoryInput.value.trim();
  if (!catName) return;
  const success = await addCustomCategory(catName);
  if (success) {
    newCategoryInput.value = '';
    await populateCategoryDropdowns();
    await renderManageCategoriesList();
    await renderPriorityList();
  } else {
    alert('Category name already exists or is invalid.');
  }
}

btnAddCustomCategory.addEventListener('click', handleAddCategory);
newCategoryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleAddCategory();
  }
});

// ── Notes ───────────────────────────────────────────────────────────────────
const dayNotesEl = document.getElementById('day-notes');
const notesHint  = document.getElementById('notes-hint');
let notesTimer   = null;

async function loadNotes() {
  const key   = `notes_${currentDate}`;
  const saved = await get(key);
  dayNotesEl.value = saved ?? '';
}

dayNotesEl.addEventListener('input', () => {
  clearTimeout(notesTimer);
  notesTimer = setTimeout(saveNotes, 800);
});

dayNotesEl.addEventListener('blur', saveNotes);

async function saveNotes() {
  clearTimeout(notesTimer);
  try {
    await set(`notes_${currentDate}`, dayNotesEl.value);
    notesHint.textContent = 'Saved';
    setTimeout(() => { notesHint.textContent = ''; }, 1500);
  } catch {
    notesHint.textContent = 'Error saving';
  }
}

// ─── ══════════════════════════════════════════════════════
//     WEEK TAB
// ══════════════════════════════════════════════════════════

const weekGrid     = document.getElementById('week-grid');
const weekNavTitle = document.getElementById('week-nav-title');
const btnPrevWeek  = document.getElementById('btn-prev-week');
const btnNextWeek  = document.getElementById('btn-next-week');

btnPrevWeek.addEventListener('click', () => {
  const d = new Date(currentWeekStart + 'T12:00:00');
  d.setDate(d.getDate() - 7);
  currentWeekStart = isoDate(d);
  renderWeekTab();
});

btnNextWeek.addEventListener('click', () => {
  const d = new Date(currentWeekStart + 'T12:00:00');
  d.setDate(d.getDate() + 7);
  currentWeekStart = isoDate(d);
  renderWeekTab();
});

async function renderWeekTab() {
  const dates   = getWeekDates(currentWeekStart);
  const lastDay = dates[6];

  weekNavTitle.textContent = `${fmtShort(dates[0])} – ${fmtShort(lastDay)}, ${new Date(dates[0] + 'T12:00:00').getFullYear()}`;

  // Load tasks for all 7 days in parallel
  const tasksByDay = await Promise.all(dates.map((d) => getTasks(d)));

  weekGrid.innerHTML = '';

  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  dates.forEach((date, i) => {
    const isToday  = date === TODAY;
    const dateObj  = new Date(date + 'T12:00:00');
    const dateNum  = dateObj.getDate();
    const tasks    = tasksByDay[i];

    const col = document.createElement('div');
    col.className = 'week-col';

    const hdrClass = `week-col-header${isToday ? ' is-today' : ''}`;
    const numClass = `week-day-num${isToday ? ' is-today-num' : ''}`;

    col.innerHTML = `
      <div class="${hdrClass}" data-date="${date}">
        <span class="week-day-name">${DAY_LABELS[i]}</span>
        <span class="${numClass}">${dateNum}</span>
      </div>
      <div class="week-task-list" id="wt-${date}"></div>
      <div class="week-add-row">
        <input type="text" class="week-add-input" data-date="${date}" placeholder="+ Add task…" maxlength="200" />
        <button class="week-add-btn" data-date="${date}">+</button>
      </div>
    `;

    // Click header → go to day
    col.querySelector('.week-col-header').addEventListener('click', () => {
      currentDate = date;
      goToDay(date);
    });

    weekGrid.appendChild(col);
    renderWeekTaskList(tasks, date, document.getElementById(`wt-${date}`));
  });

  // Quick-add bindings
  weekGrid.querySelectorAll('.week-add-input').forEach((input) => {
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await weekQuickAdd(input.dataset.date, input.value.trim());
        input.value = '';
        renderWeekTab();
      }
    });
  });

  weekGrid.querySelectorAll('.week-add-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const input = weekGrid.querySelector(`.week-add-input[data-date="${btn.dataset.date}"]`);
      if (!input) return;
      await weekQuickAdd(btn.dataset.date, input.value.trim());
      input.value = '';
      renderWeekTab();
    });
  });
}

function renderWeekTaskList(tasks, date, container) {
  if (!container) return;

  if (tasks.length === 0) {
    container.innerHTML = '<div class="week-empty-day">No tasks</div>';
    return;
  }

  // Sort: undone priority first, done last
  const sorted = [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return (a.priority ?? 3) - (b.priority ?? 3);
  });

  container.innerHTML = sorted.map((t) => `
    <div class="week-task-item" data-id="${t.id}">
      <input type="checkbox" class="week-task-check" data-id="${t.id}" data-date="${date}" ${t.done ? 'checked' : ''} />
      <span class="week-task-title${t.done ? ' done-text' : ''}">${escHtml(t.title)}</span>
      ${!t.done ? `<button class="week-carry-btn" data-id="${t.id}" data-date="${date}" title="Carry to next day">→</button>` : ''}
    </div>
  `).join('');

  // Checkbox
  container.querySelectorAll('.week-task-check').forEach((cb) => {
    cb.addEventListener('change', async () => {
      await updateTask(cb.dataset.date, cb.dataset.id, { done: cb.checked });
      renderWeekTab();
    });
  });

  // Carry forward
  container.querySelectorAll('.week-carry-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fromDate = btn.dataset.date;
      const d = new Date(fromDate + 'T12:00:00');
      d.setDate(d.getDate() + 1);
      const toDate  = isoDate(d);
      const allTasks = await getTasks(fromDate);
      const task     = allTasks.find((t) => t.id === btn.dataset.id);
      if (task) {
        await addTask(toDate, { ...task, id: generateId(), done: false });
        renderWeekTab();
      }
    });
  });
}

async function weekQuickAdd(date, title) {
  if (!title) return;
  await addTask(date, { id: generateId(), title, done: false, priority: 2, timeEstimate: null });
}

// ─── ══════════════════════════════════════════════════════
//     MONTH TAB
// ══════════════════════════════════════════════════════════

const monthGrid     = document.getElementById('month-grid');
const monthNavTitle = document.getElementById('month-nav-title');
const btnPrevMonth  = document.getElementById('btn-prev-month');
const btnNextMonth  = document.getElementById('btn-next-month');

btnPrevMonth.addEventListener('click', () => {
  currentMonth--;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  renderMonthTab();
});

btnNextMonth.addEventListener('click', () => {
  currentMonth++;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  renderMonthTab();
});

async function renderMonthTab() {
  monthNavTitle.textContent = fmtMonthYear(currentYear, currentMonth);
  monthGrid.innerHTML = '';

  const firstDay = new Date(currentYear, currentMonth, 1);
  const lastDay  = new Date(currentYear, currentMonth + 1, 0);
  const numDays  = lastDay.getDate();

  // Monday-indexed start (Mon=0 … Sun=6)
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  // Collect dates to display
  const displayDates = [];

  // Prev-month padding days
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(currentYear, currentMonth, -i);
    displayDates.push({ date: isoDate(d), current: false });
  }

  // Current month days
  for (let d = 1; d <= numDays; d++) {
    displayDates.push({ date: isoDate(new Date(currentYear, currentMonth, d)), current: true });
  }

  // Next-month padding to complete grid
  const remainder = (7 - (displayDates.length % 7)) % 7;
  for (let d = 1; d <= remainder; d++) {
    displayDates.push({ date: isoDate(new Date(currentYear, currentMonth + 1, d)), current: false });
  }

  // Load task + block counts in parallel
  const countData = await Promise.all(
    displayDates.map(async ({ date }) => {
      const [tasks, blocks] = await Promise.all([getTasks(date), getBlocks(date)]);
      return {
        tasks: tasks.length,
        done:  tasks.filter((t) => t.done).length,
        blocks: blocks.length,
      };
    })
  );

  displayDates.forEach(({ date, current }, i) => {
    const counts  = countData[i];
    const isToday = date === TODAY;
    const dateNum = new Date(date + 'T12:00:00').getDate();

    const cell = document.createElement('div');
    cell.className = `month-day-cell${isToday ? ' is-today' : ''}${!current ? ' other-month' : ''}`;

    cell.innerHTML = `
      <div class="month-day-num">${dateNum}</div>
      <div class="month-day-badges">
        ${counts.tasks > 0 ? `<span class="month-badge month-badge-tasks">${counts.done}/${counts.tasks} tasks</span>` : ''}
        ${counts.blocks > 0 ? `<span class="month-badge month-badge-blocks">${counts.blocks} block${counts.blocks > 1 ? 's' : ''}</span>` : ''}
      </div>
    `;

    if (current) {
      cell.addEventListener('click', () => {
        currentDate = date;
        goToDay(date);
      });
    }

    monthGrid.appendChild(cell);
  });
}

// ─── ══════════════════════════════════════════════════════
//     YEAR TAB
// ══════════════════════════════════════════════════════════

const yearContent  = document.getElementById('year-content');
const yearNavTitle = document.getElementById('year-nav-title');
const btnPrevYear  = document.getElementById('btn-prev-year');
const btnNextYear  = document.getElementById('btn-next-year');

btnPrevYear.addEventListener('click', () => { currentYear--; renderYearTab(); });
btnNextYear.addEventListener('click', () => { currentYear++; renderYearTab(); });

const QUARTERS = [
  { label: 'Q1', key: 'q1', months: [1, 2, 3] },
  { label: 'Q2', key: 'q2', months: [4, 5, 6] },
  { label: 'Q3', key: 'q3', months: [7, 8, 9] },
  { label: 'Q4', key: 'q4', months: [10, 11, 12] },
];

async function renderYearTab() {
  yearNavTitle.textContent = String(currentYear);
  yearContent.innerHTML = '';

  const realDate  = new Date();
  const realYear  = realDate.getFullYear();
  const realMonth = realDate.getMonth() + 1;

  const themes    = await getYearlyThemes();
  const allMs     = (await get('year_milestones')) ?? {};
  const yearMs    = allMs[currentYear] ?? { q1: '', q2: '', q3: '', q4: '' };

  for (const q of QUARTERS) {
    const section = document.createElement('div');
    section.className = 'year-quarter fade-in';

    // Quarter header + milestone input
    const header = document.createElement('div');
    header.className = 'year-quarter-header';

    const qLabel = document.createElement('div');
    qLabel.className = 'year-q-label';
    qLabel.textContent = q.label;

    const msInput = document.createElement('input');
    msInput.type        = 'text';
    msInput.className   = 'input input-sm year-q-milestone';
    msInput.value       = yearMs[q.key] ?? '';
    msInput.placeholder = `${q.label} milestone — e.g. Launch beta, Run 5K…`;
    msInput.maxLength   = 300;

    msInput.addEventListener('blur', async () => {
      const all = (await get('year_milestones')) ?? {};
      all[currentYear] = { ...(all[currentYear] ?? {}), [q.key]: msInput.value.trim() };
      await set('year_milestones', all);
    });

    header.appendChild(qLabel);
    header.appendChild(msInput);
    section.appendChild(header);

    // Month cards row
    const cardsRow = document.createElement('div');
    cardsRow.className = 'year-month-cards';

    for (const m of q.months) {
      const themeEntry = themes.find((t) => t.month === m);
      const themeVal   = themeEntry?.theme ?? '';

      const card = document.createElement('div');
      card.className = 'year-month-card';

      const isCurrentYear = (currentYear === realYear);
      const isFutureYear  = (currentYear > realYear);

      let isCurrent = false;
      let isFuture  = false;
      let isPast    = false;

      if (isCurrentYear) {
        if (m === realMonth) {
          isCurrent = true;
        } else if (m > realMonth) {
          isFuture = true;
        } else {
          isPast = true;
        }
      } else if (isFutureYear) {
        isFuture = true;
      } else {
        isPast = true;
      }

      if (isCurrent) {
        card.classList.add('is-current');
      } else if (isFuture) {
        card.classList.add('is-future');
      } else if (isPast) {
        card.classList.add('is-past');
      }

      const monthHeader = document.createElement('div');
      monthHeader.className = 'year-month-header';

      const monthName = document.createElement('div');
      monthName.className   = 'year-month-name';
      monthName.textContent = MONTH_NAMES[m - 1];
      monthHeader.appendChild(monthName);

      if (isCurrent) {
        const badge = document.createElement('span');
        badge.className = 'current-badge';
        badge.textContent = 'Current';
        monthHeader.appendChild(badge);
      }

      card.appendChild(monthHeader);

      const goalsContainer = document.createElement('div');
      goalsContainer.className = 'year-month-goals-list';

      const rawList = themeEntry?.goals ?? (themeVal ? [themeVal] : []);
      const goalsList = rawList.map(g => {
        if (typeof g === 'string') return { text: g, completed: false };
        return { text: g.text ?? '', completed: !!g.completed };
      });

      const renderGoals = (currentGoals) => {
        goalsContainer.innerHTML = '';
        currentGoals.forEach((goalObj, gIdx) => {
          const goalText = goalObj.text;
          const isCompleted = goalObj.completed;

          const item = document.createElement('div');
          item.className = `year-month-goal-item ${isCompleted ? 'is-completed' : ''}`;

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'goal-checkbox';
          checkbox.checked = isCompleted;
          checkbox.addEventListener('change', async () => {
            currentGoals[gIdx].completed = checkbox.checked;
            await setMonthGoals(m, currentGoals);
            renderGoals(currentGoals);
          });

          const goalInput = document.createElement('input');
          goalInput.type = 'text';
          goalInput.className = 'input input-sm year-month-goal-input';
          goalInput.value = goalText;
          goalInput.placeholder = 'Goal...';

          goalInput.addEventListener('blur', async () => {
            const val = goalInput.value.trim();
            if (val === '') {
              currentGoals.splice(gIdx, 1);
            } else {
              currentGoals[gIdx].text = val;
            }
            await setMonthGoals(m, currentGoals);
            renderGoals(currentGoals);
          });

          goalInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
              goalInput.blur();
            }
          });

          const actionsContainer = document.createElement('div');
          actionsContainer.className = 'goal-actions';

          if (!isCompleted) {
            const moveBtn = document.createElement('button');
            moveBtn.className = 'btn-move-goal';
            moveBtn.innerHTML = '→';
            moveBtn.title = 'Move to next month';
            moveBtn.addEventListener('click', async () => {
              const nextMonth = m === 12 ? 1 : m + 1;
              const themes = await getYearlyThemes();
              
              const currentTheme = themes.find(t => t.month === m);
              if (currentTheme) {
                currentTheme.goals = currentTheme.goals.filter((_, idx) => idx !== gIdx);
                currentTheme.theme = currentTheme.goals[0]?.text ?? '';
              }
              
              const nextTheme = themes.find(t => t.month === nextMonth);
              if (nextTheme) {
                nextTheme.goals.push({ text: goalText, completed: false });
                nextTheme.theme = nextTheme.goals[0]?.text ?? '';
              }
              
              await set('yearly_themes', themes);
              renderYearTab();
            });
            actionsContainer.appendChild(moveBtn);
          }

          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'btn-delete-goal';
          deleteBtn.innerHTML = '&times;';
          deleteBtn.addEventListener('click', async () => {
            currentGoals.splice(gIdx, 1);
            await setMonthGoals(m, currentGoals);
            renderGoals(currentGoals);
          });
          actionsContainer.appendChild(deleteBtn);

          item.appendChild(checkbox);
          item.appendChild(goalInput);
          item.appendChild(actionsContainer);
          goalsContainer.appendChild(item);
        });
      };

      renderGoals(goalsList);
      card.appendChild(goalsContainer);

      const addGoalContainer = document.createElement('div');
      addGoalContainer.className = 'add-goal-container';

      const addGoalInput = document.createElement('input');
      addGoalInput.type = 'text';
      addGoalInput.className = 'input input-sm add-goal-input';
      addGoalInput.placeholder = '+ Add goal...';

      const handleAddGoal = async () => {
        const val = addGoalInput.value.trim();
        if (val) {
          goalsList.push({ text: val, completed: false });
          await setMonthGoals(m, goalsList);
          addGoalInput.value = '';
          renderGoals(goalsList);
        }
      };

      addGoalInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          await handleAddGoal();
        }
      });

      addGoalInput.addEventListener('blur', async () => {
        await handleAddGoal();
      });

      addGoalContainer.appendChild(addGoalInput);
      card.appendChild(addGoalContainer);

      cardsRow.appendChild(card);
    }

    section.appendChild(cardsRow);
    yearContent.appendChild(section);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  collapsedCategories = (await get('collapsed_categories')) || [];
  renderDayDate();
  mountDayBoard();
  await populateCategoryDropdowns();
  await renderPriorityList();
  await loadNotes();
}

init();
