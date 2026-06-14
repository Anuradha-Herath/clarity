/**
 * Clarity — pages/planner.js
 * Full 4-tab planner logic: Day · Week · Month · Year
 * ES Module.
 */

import {
  getTasks, addTask, updateTask, deleteTask, setTasks,
  getBlocks,
  get, set,
  getYearlyThemes, setMonthTheme,
  generateId, todayKey, dateKey,
  snapHour,
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

function switchTab(tab) {
  activeTab = tab;
  tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  Object.entries(tabPanels).forEach(([key, el]) => {
    el.classList.toggle('active', key === tab);
    el.classList.toggle('hidden', key !== tab);
  });

  if (tab === 'day') {
    mountDayBoard();
    renderDayDate();
    renderPriorityList();
    loadNotes();
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

// ── Priority list ───────────────────────────────────────────────────────────

const priorityList      = document.getElementById('priority-list');
const priorityTaskCount = document.getElementById('priority-task-count');
const priorityInput     = document.getElementById('priority-input');
const btnAddPriority    = document.getElementById('btn-add-priority');

// Priority dot selector
let editingTaskId = null;
document.querySelectorAll('.priority-dot-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.priority-dot-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    selectedPriority = parseInt(btn.dataset.p, 10);
  });
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

  if (sorted.length === 0) {
    priorityList.innerHTML = `<div style="font-size:13px;color:var(--color-text-muted);padding:8px 0;font-style:italic;">No tasks yet — add one below</div>`;
    return;
  }

  priorityList.innerHTML = sorted.map((t) => `
    <div class="priority-item" data-id="${t.id}">
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
  `).join('');

  // Checkbox toggle
  priorityList.querySelectorAll('.priority-item-check').forEach((cb) => {
    cb.addEventListener('change', async () => {
      await updateTask(currentDate, cb.dataset.id, { done: cb.checked });
      await renderPriorityList();
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
}

async function addPriorityTask() {
  const title = priorityInput.value.trim();
  if (!title) return;
  await addTask(currentDate, {
    id: generateId(),
    title,
    done: false,
    priority: selectedPriority,
    timeEstimate: null,
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
const taskEstimateInput= document.getElementById('task-estimate-input');

let editingTask = null;

function openTaskModal(task = null) {
  editingTask = task;
  taskModalTitle.textContent = task ? 'Edit Task' : 'Add Task';
  taskTitleInput.value    = task?.title       ?? '';
  taskPriorityInput.value = String(task?.priority ?? 1);
  taskEstimateInput.value = task?.timeEstimate ?? '';
  btnTaskDelete.classList.toggle('hidden', !task);
  taskModalOverlay.classList.remove('hidden');
  taskTitleInput.focus();
}

function closeTaskModal() {
  taskModalOverlay.classList.add('hidden');
  editingTask = null;
}

async function saveTask() {
  const title = taskTitleInput.value.trim();
  if (!title) { taskTitleInput.focus(); return; }
  const priority    = parseInt(taskPriorityInput.value, 10) || 1;
  const timeEstimate= parseInt(taskEstimateInput.value, 10) || null;

  if (editingTask) {
    await updateTask(currentDate, editingTask.id, { title, priority, timeEstimate });
  } else {
    await addTask(currentDate, {
      id: generateId(), title, done: false, priority, timeEstimate,
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

      const monthName = document.createElement('div');
      monthName.className   = 'year-month-name';
      monthName.textContent = MONTH_NAMES[m - 1];

      const themeInput = document.createElement('input');
      themeInput.type        = 'text';
      themeInput.className   = 'input input-sm year-month-theme';
      themeInput.value       = themeVal;
      themeInput.placeholder = 'Monthly theme…';
      themeInput.maxLength   = 200;
      themeInput.dataset.month = String(m);

      themeInput.addEventListener('blur', async () => {
        await setMonthTheme(m, themeInput.value.trim());
      });

      card.appendChild(monthName);
      card.appendChild(themeInput);
      cardsRow.appendChild(card);
    }

    section.appendChild(cardsRow);
    yearContent.appendChild(section);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  renderDayDate();
  mountDayBoard();
  await renderPriorityList();
  await loadNotes();
}

init();
