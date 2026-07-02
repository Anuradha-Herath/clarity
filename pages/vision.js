/**
 * Clarity — pages/vision.js
 * Vision & Goals page logic.
 * ES Module.
 */

import {
  getVision, patchVision,
  get, set, push, remove, update,
  generateId, compressImage,
  checkStorageSize,
  initAutoSync,
  getGoals, saveGoals, runGoalsMigration,
  getTasks, updateTask, addTask,
  todayKey,
} from '../shared/storage.js';
import { showConfirm, showAlert } from '../shared/dialog.js';
import { recalculateGoalProgress, recalculateParentProgress } from '../shared/goalsProgressService.js';

// ─── Category colour helper ────────────────────────────────────────────────────
function getCategoryColor(cat) {
  const palettes = [
    { bg: '#F5F3FF', color: '#5B21B6' }, // Purple
    { bg: '#EEF2FF', color: '#3730A3' }, // Indigo
    { bg: '#FFF1F2', color: '#BE123C' }, // Red
    { bg: '#F0FDF4', color: '#15803D' }, // Green
    { bg: '#FFFBEB', color: '#B45309' }, // Amber
    { bg: '#ECFDF5', color: '#047857' }, // Emerald
    { bg: '#F0FDFA', color: '#0F766E' }, // Teal
    { bg: '#F0F9FF', color: '#0369A1' }, // Sky
    { bg: '#F4F4F5', color: '#3F3F46' }, // Zinc
  ];
  
  const lowerCat = String(cat ?? '').toLowerCase();
  if (lowerCat.includes('personal')) return palettes[0];
  if (lowerCat.includes('academic') || lowerCat.includes('study') || lowerCat.includes('school')) return palettes[1];
  if (lowerCat.includes('meeting') || lowerCat.includes('call') || lowerCat.includes('zoom')) return palettes[2];
  if (lowerCat.includes('gym') || lowerCat.includes('health') || lowerCat.includes('workout') || lowerCat.includes('exercise')) return palettes[3];
  if (lowerCat.includes('chore') || lowerCat.includes('home') || lowerCat.includes('house')) return palettes[4];
  if (lowerCat.includes('company') || lowerCat.includes('work') || lowerCat.includes('job')) return palettes[7];
  if (lowerCat.includes('project') || lowerCat.includes('extension')) return palettes[5];
  if (lowerCat.includes('break') || lowerCat.includes('rest') || lowerCat.includes('sleep')) return palettes[8];

  let hash = 0;
  const str = String(cat ?? '');
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % palettes.length;
  return palettes[idx];
}

function catPillHTML(cat) {
  const s = getCategoryColor(cat);
  return `<span class="pill" style="background:${s.bg};color:${s.color}">${escHtml(cat)}</span>`;
}

// ─── Utility ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(str) {
  if (!str) return '';
  try {
    return new Date(str + 'T00:00:00').toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return str; }
}

// ─── ══════════════════════════════════════════════════════════
//     1. VISION BOARD
// ══════════════════════════════════════════════════════════════

const visionCard      = document.getElementById('vision-card');
const visionTextarea  = document.getElementById('vision-textarea');
const visionBgImage   = document.getElementById('vision-bg-image');
const visionImg       = document.getElementById('vision-img');
const btnUploadVision = document.getElementById('btn-upload-vision');
const btnRemoveImg    = document.getElementById('btn-remove-vision-img');
const visionFileInput = document.getElementById('vision-file-input');
const visionSaveHint  = document.getElementById('vision-save-hint');

let visionSaveTimer = null;

async function loadVision() {
  const v = await getVision();
  visionTextarea.value = v.text ?? '';
  applyVisionImage(v.imageBase64 ?? '');
}

function applyVisionImage(base64) {
  if (base64) {
    visionImg.src = base64;
    visionBgImage.classList.remove('hidden');
    visionCard.classList.add('has-image');
    btnRemoveImg.classList.remove('hidden');
  } else {
    visionBgImage.classList.add('hidden');
    visionCard.classList.remove('has-image');
    btnRemoveImg.classList.add('hidden');
  }
}

function showVisionHint(msg, isError = false) {
  visionSaveHint.textContent = msg;
  visionSaveHint.style.color = isError ? 'var(--color-danger)' : '';
  clearTimeout(visionSaveTimer);
  visionSaveTimer = setTimeout(() => { visionSaveHint.textContent = ''; }, 2000);
}

// Auto-save on blur
visionTextarea.addEventListener('blur', async () => {
  try {
    await patchVision({ text: visionTextarea.value });
    showVisionHint('Saved');
  } catch { showVisionHint('Save failed', true); }
});

// Upload vision image
btnUploadVision.addEventListener('click', () => visionFileInput.click());

visionFileInput.addEventListener('change', async () => {
  const file = visionFileInput.files[0];
  if (!file) return;
  try {
    btnUploadVision.textContent = 'Compressing…';
    btnUploadVision.disabled = true;
    const base64 = await compressImage(file);
    await patchVision({ imageBase64: base64 });
    applyVisionImage(base64);
    showVisionHint('Image saved');

    // Storage check
    const { overLimit } = await checkStorageSize();
    if (overLimit) showVisionHint('⚠ Storage over 8 MB', true);
  } catch (err) {
    console.error(err);
    showVisionHint('Image failed', true);
  } finally {
    btnUploadVision.textContent = 'Upload image';
    btnUploadVision.disabled = false;
    visionFileInput.value = '';
  }
});

// Remove vision image
btnRemoveImg.addEventListener('click', async () => {
  await patchVision({ imageBase64: '' });
  applyVisionImage('');
  showVisionHint('Image removed');
});

// ─── ══════════════════════════════════════════════════════════
//     2. UNIFIED GOALS SYSTEM
// ══════════════════════════════════════════════════════════════



const longGoalsList  = document.getElementById('long-goals-list');
const shortGoalsList = document.getElementById('short-goals-list');
const longGoalsEmpty = document.getElementById('long-goals-empty');
const shortGoalsEmpty= document.getElementById('short-goals-empty');
const btnAddLong     = document.getElementById('btn-add-long');
const btnAddShort    = document.getElementById('btn-add-short');

// Goal modal (minimal, Title only)
const goalModalOverlay = document.getElementById('goal-modal-overlay');
const goalModalTitle   = document.getElementById('goal-modal-title');
const goalModalClose   = document.getElementById('goal-modal-close');
const btnGoalCancel    = document.getElementById('btn-goal-cancel');
const btnGoalSave      = document.getElementById('btn-goal-save');
const btnGoalDelete    = document.getElementById('btn-goal-delete');
const goalTitleInput   = document.getElementById('goal-title');

// Link Task Modal
const linkTaskModalOverlay = document.getElementById('link-task-modal-overlay');
const linkTaskModalClose   = document.getElementById('link-task-modal-close');
const btnLinkTaskCancel    = document.getElementById('btn-link-task-cancel');
const linkTaskSearch       = document.getElementById('link-task-search');
const linkTaskList         = document.getElementById('link-task-list');

// Link Goal Modal
const linkGoalModalOverlay = document.getElementById('link-goal-modal-overlay');
const linkGoalModalClose   = document.getElementById('link-goal-modal-close');
const btnLinkGoalCancel    = document.getElementById('btn-link-goal-cancel');
const linkGoalList         = document.getElementById('link-goal-list');

let editingGoalId   = null;
let editingGoalTimeframe = null; // 'longterm' | 'shortterm'
let expandedGoalIds = new Set(); // tracks which cards are expanded
let editingSmartGoalId = null; // tracks which goal currently has inline SMART form expanded
let linkingGoalId = null; // tracks which goal is currently having tasks/goals linked
let pendingParentGoalId = null; // tracks parentGoalId pre-fill during quick short-term goal add
let quickAddFormGoalId = null; // tracks which goal currently has inline quick add task expanded
let draggedGoalId = null; // tracks the goal being dragged

async function fetchAllTasks() {
  const allStorage = await chrome.storage.local.get(null);
  const allTasks = [];
  for (const key of Object.keys(allStorage)) {
    if (key.startsWith('tasks_')) {
      const date = key.slice('tasks_'.length);
      const tasks = allStorage[key];
      if (Array.isArray(tasks)) {
        for (const t of tasks) {
          allTasks.push({ ...t, date });
        }
      }
    }
  }
  return allTasks;
}

function getCountdownText(targetDateStr) {
  if (!targetDateStr) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDateStr + 'T00:00:00');
  target.setHours(0, 0, 0, 0);
  const diffTime = target - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return 'Target date is today!';
  } else if (diffDays === 1) {
    return '1 day left';
  } else if (diffDays > 1) {
    return `${diffDays} days left`;
  } else {
    return `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) !== 1 ? 's' : ''}`;
  }
}

async function loadGoals() {
  const goals = await getGoals();
  const allTasks = await fetchAllTasks();

  const longTerm = goals.filter(g => g.timeframe === 'longterm');
  const shortTerm = goals.filter(g => g.timeframe === 'shortterm');

  renderGoalList(longTerm, longGoalsList, longGoalsEmpty, 'longterm', goals, allTasks);
  renderGoalList(shortTerm, shortGoalsList, shortGoalsEmpty, 'shortterm', goals, allTasks);
}

function renderGoalList(goals, listEl, emptyEl, timeframe, allGoals, allTasks) {
  if (goals.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = '';

  goals.forEach(g => {
    const card = document.createElement('div');
    const isExpanded = expandedGoalIds.has(g.id);
    card.className = `goal-card fade-in ${isExpanded ? 'is-expanded' : ''}`;
    card.dataset.id = g.id;

    // Drag and drop setup for the card
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      draggedGoalId = g.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', g.id);
      setTimeout(() => card.classList.add('is-dragging'), 0);
    });
    card.addEventListener('dragend', () => {
      draggedGoalId = null;
      card.classList.remove('is-dragging');
      document.querySelectorAll('.goals-col').forEach(col => col.classList.remove('drag-over'));
    });

    const childGoals = timeframe === 'longterm' ? allGoals.filter(cg => cg.parentGoalId === g.id) : [];
    const linkedTasks = allTasks.filter(t => t.linkedGoalId === g.id);

    // Build SMART Section
    let smartSectionHTML = '';
    if (g.isSmart) {
      smartSectionHTML = `
        <span class="smart-badge" data-id="${g.id}">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          ✓ SMART
        </span>
      `;
    } else {
      smartSectionHTML = `<button class="btn-make-smart" data-id="${g.id}">Make it SMART</button>`;
    }

    // Build Countdown HTML
    let countdownHTML = '';
    if (g.isSmart && g.targetDate) {
      countdownHTML = `
        <div class="goal-countdown">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          ${getCountdownText(g.targetDate)}
        </div>
      `;
    }

    // Inline SMART form
    const isSmartFormExpanded = editingSmartGoalId === g.id;
    const inlineSmartFormHTML = `
      <div class="smart-upgrade-form ${isSmartFormExpanded ? 'expanded' : ''}">
        <div class="form-group">
          <label class="label text-xs">Specific</label>
          <textarea class="textarea textarea-sm smart-specific" style="font-size: 12px;" rows="2" placeholder="What exactly do you want to achieve?">${escHtml(g.specific || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="label text-xs">Measurable</label>
          <textarea class="textarea textarea-sm smart-measurable" style="font-size: 12px;" rows="2" placeholder="How will you measure success?">${escHtml(g.measurable || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="label text-xs">Target Date</label>
          <input type="date" class="input input-sm smart-date" style="font-size: 12px; height:28px;" value="${g.targetDate || ''}" />
        </div>
        <div class="flex gap-2 justify-end" style="margin-top: 8px;">
          <button class="btn btn-secondary btn-sm btn-smart-skip" style="font-size: 11px; padding: 2px 8px; height:24px;" data-id="${g.id}">Cancel</button>
          <button class="btn btn-primary btn-sm btn-smart-save" style="font-size: 11px; padding: 2px 8px; height:24px;" data-id="${g.id}">Save</button>
        </div>
      </div>
    `;

    // Tasks list HTML
    let tasksListHTML = '';
    if (linkedTasks.length > 0) {
      tasksListHTML = `
        <div class="goal-tasks-header">Linked Tasks</div>
        <div class="goal-tasks-list">
          ${linkedTasks.map(t => `
            <div class="goal-task-item">
              <input type="checkbox" class="goal-task-item-check" data-id="${t.id}" data-date="${t.date}" ${t.done ? 'checked' : ''} />
              <span class="goal-task-item-title ${t.done ? 'is-done' : ''}">${escHtml(t.title)}</span>
              <span class="text-xs text-muted" style="margin-left:auto;">${fmtDate(t.date)}</span>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      tasksListHTML = `
        <div class="goal-tasks-header">Linked Tasks</div>
        <div style="font-size: 11px; color: var(--color-text-muted); font-style: italic; margin-bottom: 6px;">No linked tasks yet</div>
      `;
    }

    // Child goals list (long-term only)
    let childGoalsHTML = '';
    if (timeframe === 'longterm') {
      if (childGoals.length > 0) {
        childGoalsHTML = `
          <div class="goal-children-header">Linked Short-term Goals</div>
          <div class="goal-children-list">
            ${childGoals.map(cg => `
              <div class="goal-child-item" data-id="${cg.id}">
                <span>${escHtml(cg.title)}</span>
                <span class="text-xs text-accent font-semibold">${cg.progress}% completed</span>
              </div>
            `).join('')}
          </div>
        `;
      } else {
        childGoalsHTML = `
          <div class="goal-children-header">Linked Short-term Goals</div>
          <div style="font-size: 11px; color: var(--color-text-muted); font-style: italic; margin-bottom: 6px; padding-left: 8px;">No child goals linked</div>
        `;
      }
    }

    // Quick add task inline form
    const isQuickAddExpanded = quickAddFormGoalId === g.id;
    const quickAddTaskHTML = `
      <div class="quick-add-task-form ${isQuickAddExpanded ? '' : 'hidden'}" style="margin-top: 8px;">
        <input type="text" class="input input-sm quick-add-task-input flex-1" style="font-size: 12px; height:28px;" placeholder="Add planner task for today..." />
        <button class="btn btn-primary btn-sm btn-quick-add-task-save" style="font-size: 11px; height:28px; line-height: 1;" data-id="${g.id}">Add</button>
        <button class="btn btn-ghost btn-sm btn-quick-add-task-cancel" style="font-size: 11px; height:28px;" data-id="${g.id}">Cancel</button>
      </div>
    `;

    card.innerHTML = `
      <div class="goal-card-header">
        <div class="goal-card-title-group" data-id="${g.id}">
          <div class="goal-card-title">${escHtml(g.title)}</div>
          <div class="goal-card-timeframe">${timeframe === 'longterm' ? 'Long-term Goal' : 'Short-term Goal'}</div>
        </div>
        <div class="flex items-center gap-2">
          ${smartSectionHTML}
          <div class="goal-item-edit" data-id="${g.id}" title="Edit goal">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </div>
        </div>
      </div>

      <div class="goal-progress-container">
        <div class="goal-progress-label">
          <span>${g.progress || 0}% Progress</span>
          <span>${g.completedTaskCount || 0} of ${g.linkedTaskCount || 0} tasks completed</span>
        </div>
        <div class="goal-progress-track">
          <div class="goal-progress-fill" style="width: ${g.progress || 0}%"></div>
        </div>
      </div>

      ${countdownHTML}
      ${inlineSmartFormHTML}

      <div class="goal-card-details">
        ${tasksListHTML}
        ${quickAddTaskHTML}
        ${childGoalsHTML}

        <div class="goal-card-actions">
          <button class="btn-card-action btn-link-task" data-id="${g.id}">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
            Link existing task
          </button>
          <button class="btn-card-action btn-quick-add-task" data-id="${g.id}">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Quick add task
          </button>
          ${timeframe === 'longterm' ? `
            <button class="btn-card-action btn-link-goal" data-id="${g.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
              Link existing goal
            </button>
            <button class="btn-card-action btn-add-child-goal" data-id="${g.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Add short-term goal
            </button>
          ` : ''}
        </div>
      </div>
    `;

    // Bind Expand/Collapse Card details click on the Title/Timeframe area
    card.querySelector('.goal-card-title-group').addEventListener('click', () => {
      const gid = g.id;
      if (expandedGoalIds.has(gid)) {
        expandedGoalIds.delete(gid);
      } else {
        expandedGoalIds.add(gid);
      }
      loadGoals();
    });

    // Bind Make SMART button
    const btnMakeSmart = card.querySelector('.btn-make-smart');
    if (btnMakeSmart) {
      btnMakeSmart.addEventListener('click', (e) => {
        e.stopPropagation();
        editingSmartGoalId = g.id;
        loadGoals();
      });
    }

    // Bind SMART badge edit click
    const badgeSmart = card.querySelector('.smart-badge');
    if (badgeSmart) {
      badgeSmart.addEventListener('click', (e) => {
        e.stopPropagation();
        editingSmartGoalId = g.id;
        loadGoals();
      });
    }

    // Bind Inline SMART Save/Cancel
    card.querySelector('.btn-smart-skip').addEventListener('click', (e) => {
      e.stopPropagation();
      editingSmartGoalId = null;
      loadGoals();
    });

    card.querySelector('.btn-smart-save').addEventListener('click', async (e) => {
      e.stopPropagation();
      const specific = card.querySelector('.smart-specific').value.trim() || null;
      const measurable = card.querySelector('.smart-measurable').value.trim() || null;
      const targetDate = card.querySelector('.smart-date').value || null;

      const auth = await get('firebase_auth');
      const userId = auth?.localId || '';

      const allGoals = await getGoals();
      const idx = allGoals.findIndex(item => item.id === g.id);
      if (idx !== -1) {
        allGoals[idx].isSmart = true;
        allGoals[idx].specific = specific;
        allGoals[idx].measurable = measurable;
        allGoals[idx].targetDate = targetDate;
        allGoals[idx].updatedAt = new Date().toISOString();
        await saveGoals(allGoals);
        await recalculateGoalProgress(userId, g.id);
      }
      editingSmartGoalId = null;
      await loadGoals();
    });

    // Bind task checklist toggles
    card.querySelectorAll('.goal-task-item-check').forEach(cb => {
      cb.addEventListener('change', async (e) => {
        e.stopPropagation();
        const date = cb.dataset.date;
        const taskId = cb.dataset.id;
        const done = cb.checked;
        await updateTask(date, taskId, { done });
        await loadGoals();
      });
    });

    // Bind Quick Add Task inline form toggle
    card.querySelector('.btn-quick-add-task').addEventListener('click', (e) => {
      e.stopPropagation();
      quickAddFormGoalId = g.id;
      expandedGoalIds.add(g.id); // Ensure details section is expanded too
      loadGoals();
    });

    // Save Quick Add Task
    const quickAddSaveBtn = card.querySelector('.btn-quick-add-task-save');
    if (quickAddSaveBtn) {
      quickAddSaveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const input = card.querySelector('.quick-add-task-input');
        const title = input.value.trim();
        if (!title) { input.focus(); return; }

        const today = todayKey();
        const newTask = {
          id: generateId(),
          title,
          done: false,
          priority: 2,
          timeEstimate: null,
          category: 'Personal',
          linkedGoalId: g.id
        };

        const auth = await get('firebase_auth');
        const userId = auth?.localId || '';

        await addTask(today, newTask);
        await recalculateGoalProgress(userId, g.id);
        
        quickAddFormGoalId = null;
        await loadGoals();
      });
    }

    // Cancel Quick Add Task
    const quickAddCancelBtn = card.querySelector('.btn-quick-add-task-cancel');
    if (quickAddCancelBtn) {
      quickAddCancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        quickAddFormGoalId = null;
        loadGoals();
      });
    }

    // Bind Link Task button modal trigger
    card.querySelector('.btn-link-task').addEventListener('click', (e) => {
      e.stopPropagation();
      openLinkTaskModal(g.id, allTasks);
    });

    // Bind Edit Goal title/delete trigger
    card.querySelector('.goal-item-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openGoalModal(g.timeframe, g);
    });

    // Bind Long-term specific button actions
    if (timeframe === 'longterm') {
      // Link short-term goal button
      card.querySelector('.btn-link-goal').addEventListener('click', (e) => {
        e.stopPropagation();
        openLinkGoalModal(g.id, allGoals);
      });

      // Add short-term goal shortcut button
      card.querySelector('.btn-add-child-goal').addEventListener('click', (e) => {
        e.stopPropagation();
        pendingParentGoalId = g.id;
        openGoalModal('shortterm', null);
      });

      // Bind nested child goals clicks to navigate/expand them
      card.querySelectorAll('.goal-child-item').forEach(childEl => {
        childEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const childId = childEl.dataset.id;
          expandedGoalIds.add(childId); // Expand the card
          // Scroll to it
          const targetCard = document.querySelector(`.goal-card[data-id="${childId}"]`);
          if (targetCard) {
            targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetCard.classList.add('highlight-glow');
            setTimeout(() => targetCard.classList.remove('highlight-glow'), 2000);
          }
        });
      });
    }

    listEl.appendChild(card);
  });
}

function openGoalModal(timeframe, goal = null) {
  editingGoalId = goal ? goal.id : null;
  editingGoalTimeframe = timeframe;

  const label = timeframe === 'longterm' ? 'Long-term' : 'Short-term';
  goalModalTitle.textContent = goal ? `Edit ${label} Goal` : `Add ${label} Goal`;
  goalTitleInput.value = goal?.title ?? '';

  btnGoalDelete.classList.toggle('hidden', !goal);
  goalModalOverlay.classList.remove('hidden');
  goalTitleInput.focus();
}

function closeGoalModal() {
  goalModalOverlay.classList.add('hidden');
  editingGoalId = null;
  editingGoalTimeframe = null;
  pendingParentGoalId = null;
}

async function saveGoal() {
  const title = goalTitleInput.value.trim();
  if (!title) { goalTitleInput.focus(); return; }

  const auth = await get('firebase_auth');
  const userId = auth?.localId || '';

  const allGoals = await getGoals();

  if (editingGoalId) {
    const idx = allGoals.findIndex(g => g.id === editingGoalId);
    if (idx !== -1) {
      allGoals[idx].title = title;
      allGoals[idx].updatedAt = new Date().toISOString();
      await saveGoals(allGoals);
    }
  } else {
    const newGoal = {
      id: generateId(),
      userId: userId,
      title,
      timeframe: editingGoalTimeframe,
      isSmart: false,
      specific: null,
      measurable: null,
      targetDate: null,
      parentGoalId: pendingParentGoalId || null,
      progress: 0,
      linkedTaskCount: 0,
      completedTaskCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    allGoals.push(newGoal);
    await saveGoals(allGoals);

    if (newGoal.parentGoalId) {
      await recalculateParentProgress(userId, newGoal.parentGoalId);
    }
  }

  closeGoalModal();
  await loadGoals();
}

async function deleteGoal() {
  if (!editingGoalId) return;
  const isConfirmed = await showConfirm('Delete this goal? Linked tasks will remain but will be unlinked.', 'Delete Goal');
  if (!isConfirmed) return;

  const auth = await get('firebase_auth');
  const userId = auth?.localId || '';

  const allGoals = await getGoals();
  const deletedGoal = allGoals.find(g => g.id === editingGoalId);
  const filtered = allGoals.filter(g => g.id !== editingGoalId);

  // If deleting a shortterm goal that has a parent, recalculate parent progress
  const parentId = deletedGoal?.parentGoalId;

  // Unlink parent Goal IDs of child goals if deleting parent
  filtered.forEach(g => {
    if (g.parentGoalId === editingGoalId) {
      g.parentGoalId = null;
    }
  });

  await saveGoals(filtered);

  // Unlink tasks linked to this goal
  const allStorage = await chrome.storage.local.get(null);
  for (const key of Object.keys(allStorage)) {
    if (key.startsWith('tasks_')) {
      const tasks = allStorage[key];
      if (Array.isArray(tasks)) {
        let changed = false;
        tasks.forEach(t => {
          if (t.linkedGoalId === editingGoalId) {
            t.linkedGoalId = null;
            changed = true;
          }
        });
        if (changed) {
          await chrome.storage.local.set({ [key]: tasks });
        }
      }
    }
  }

  if (parentId) {
    await recalculateParentProgress(userId, parentId);
  }

  closeGoalModal();
  await loadGoals();
}

// ── Link Task Modal ──────────────────────────────────────────────────────────
async function openLinkTaskModal(goalId, allTasks) {
  linkingGoalId = goalId;
  linkTaskSearch.value = '';
  linkTaskModalOverlay.classList.remove('hidden');

  const renderTasksList = (filterText = '') => {
    const query = filterText.toLowerCase();
    const unlinked = allTasks.filter(t => !t.linkedGoalId && escHtml(t.title).toLowerCase().includes(query));

    if (unlinked.length === 0) {
      linkTaskList.innerHTML = '<div style="font-size:12px;color:var(--color-text-muted);text-align:center;padding:10px;">No unlinked tasks found.</div>';
      return;
    }

    linkTaskList.innerHTML = unlinked.map(t => `
      <div class="goal-child-item" data-id="${t.id}" data-date="${t.date}">
        <span>${escHtml(t.title)}</span>
        <span class="text-xs text-muted">${fmtDate(t.date)}</span>
      </div>
    `).join('');

    linkTaskList.querySelectorAll('.goal-child-item').forEach(el => {
      el.addEventListener('click', async () => {
        const taskId = el.dataset.id;
        const taskDate = el.dataset.date;

        const auth = await get('firebase_auth');
        const userId = auth?.localId || '';

        await updateTask(taskDate, taskId, { linkedGoalId: linkingGoalId });
        await recalculateGoalProgress(userId, linkingGoalId);

        closeLinkTaskModal();
        await loadGoals();
      });
    });
  };

  renderTasksList();

  linkTaskSearch.oninput = () => {
    renderTasksList(linkTaskSearch.value);
  };
}

function closeLinkTaskModal() {
  linkTaskModalOverlay.classList.add('hidden');
  linkingGoalId = null;
}

// ── Link Goal Modal ──────────────────────────────────────────────────────────
async function openLinkGoalModal(parentGoalId, allGoals) {
  linkingGoalId = parentGoalId;
  linkGoalModalOverlay.classList.remove('hidden');

  const unlinkedShortTerm = allGoals.filter(g => g.timeframe === 'shortterm' && !g.parentGoalId);

  if (unlinkedShortTerm.length === 0) {
    linkGoalList.innerHTML = '<div style="font-size:12px;color:var(--color-text-muted);text-align:center;padding:10px;">No unlinked short-term goals found.</div>';
    return;
  }

  linkGoalList.innerHTML = unlinkedShortTerm.map(g => `
    <div class="goal-child-item" data-id="${g.id}">
      <span>${escHtml(g.title)}</span>
      <span class="text-xs text-accent">${g.progress}% completed</span>
    </div>
  `).join('');

  linkGoalList.querySelectorAll('.goal-child-item').forEach(el => {
    el.addEventListener('click', async () => {
      const childGoalId = el.dataset.id;

      const auth = await get('firebase_auth');
      const userId = auth?.localId || '';

      const goalsList = await getGoals();
      const childIdx = goalsList.findIndex(item => item.id === childGoalId);
      if (childIdx !== -1) {
        goalsList[childIdx].parentGoalId = linkingGoalId;
        goalsList[childIdx].updatedAt = new Date().toISOString();
        await saveGoals(goalsList);
        await recalculateParentProgress(userId, linkingGoalId);
      }

      closeLinkGoalModal();
      await loadGoals();
    });
  });
}

function closeLinkGoalModal() {
  linkGoalModalOverlay.classList.add('hidden');
  linkingGoalId = null;
}

// Event Bindings
btnAddLong.addEventListener('click',  () => openGoalModal('longterm'));
btnAddShort.addEventListener('click', () => openGoalModal('shortterm'));
goalModalClose.addEventListener('click', closeGoalModal);
btnGoalCancel.addEventListener('click', closeGoalModal);
btnGoalSave.addEventListener('click', saveGoal);
btnGoalDelete.addEventListener('click', deleteGoal);

goalModalOverlay.addEventListener('click', (e) => {
  if (e.target === goalModalOverlay) closeGoalModal();
});

// Link Task Bindings
linkTaskModalClose.addEventListener('click', closeLinkTaskModal);
btnLinkTaskCancel.addEventListener('click', closeLinkTaskModal);
linkTaskModalOverlay.addEventListener('click', (e) => {
  if (e.target === linkTaskModalOverlay) closeLinkTaskModal();
});

// Link Goal Bindings
linkGoalModalClose.addEventListener('click', closeLinkGoalModal);
btnLinkGoalCancel.addEventListener('click', closeLinkGoalModal);
linkGoalModalOverlay.addEventListener('click', (e) => {
  if (e.target === linkGoalModalOverlay) closeLinkGoalModal();
});

// Enter to save inside goal modal
goalTitleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); saveGoal(); }
});

// Escape closes modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!goalModalOverlay.classList.contains('hidden')) closeGoalModal();
    if (!linkTaskModalOverlay.classList.contains('hidden')) closeLinkTaskModal();
    if (!linkGoalModalOverlay.classList.contains('hidden')) closeLinkGoalModal();
  }
});

// ── Drag and Drop Setup ────────────────────────────────────────────────────────
function setupDragAndDrop() {
  const cols = document.querySelectorAll('.goals-col');
  cols.forEach(col => {
    col.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (draggedGoalId) {
        col.classList.add('drag-over');
      }
    });
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggedGoalId) {
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-over');
      }
    });
    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) {
        col.classList.remove('drag-over');
      }
    });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      
      const targetGoalId = e.dataTransfer.getData('text/plain') || draggedGoalId;
      if (!targetGoalId) return;

      const isLongTermCol = col.querySelector('#long-goals-list') !== null;
      const newTimeframe = isLongTermCol ? 'longterm' : 'shortterm';
      
      const allGoals = await getGoals();
      const goalIndex = allGoals.findIndex(g => g.id === targetGoalId);
      
      if (goalIndex !== -1 && allGoals[goalIndex].timeframe !== newTimeframe) {
        const auth = await get('firebase_auth');
        const userId = auth?.localId || '';
        const oldParentId = allGoals[goalIndex].parentGoalId;

        allGoals[goalIndex].timeframe = newTimeframe;
        allGoals[goalIndex].updatedAt = new Date().toISOString();
        
        if (newTimeframe === 'longterm') {
          allGoals[goalIndex].parentGoalId = null;
        } else {
          allGoals.forEach(g => {
            if (g.parentGoalId === targetGoalId) {
              g.parentGoalId = null;
            }
          });
        }
        
        await saveGoals(allGoals);
        if (oldParentId) {
          await recalculateParentProgress(userId, oldParentId);
        }
        await loadGoals();
      }
    });
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  await runGoalsMigration();
  await Promise.all([
    loadVision(),
    loadGoals(),
  ]);

  setupDragAndDrop();

  // Initialize automatic synchronization
  initAutoSync();
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(changes);
  const hasVisionChanges = keys.some(key => 
    key === 'vision' ||
    key === 'goals' ||
    key.startsWith('tasks_') ||
    key === 'yearly_themes'
  );
  if (hasVisionChanges) {
    await Promise.all([
      loadVision(),
      loadGoals(),
    ]);
  }
});

init();
