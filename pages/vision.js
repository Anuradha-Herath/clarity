/**
 * Clarity — pages/vision.js
 * Vision & Goals page logic.
 * ES Module.
 */

import {
  getVision, patchVision,
  getSmartGoals, getLongGoals, getShortGoals,
  get, set, push, remove, update,
  generateId, compressImage,
  checkStorageSize,
  initAutoSync,
} from '../shared/storage.js';
import { showConfirm, showAlert } from '../shared/dialog.js';

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
//     2. SMART GOALS
// ══════════════════════════════════════════════════════════════

const smartScroll     = document.getElementById('smart-scroll');
const smartAddCard    = document.getElementById('smart-add-card');
const smartCount      = document.getElementById('smart-count');

// Modal elements
const smartModalOverlay  = document.getElementById('smart-modal-overlay');
const smartModalTitle    = document.getElementById('smart-modal-title');
const smartModalClose    = document.getElementById('smart-modal-close');
const btnSmartCancel     = document.getElementById('btn-smart-cancel');
const btnSmartSave       = document.getElementById('btn-smart-save');
const btnSmartDelete     = document.getElementById('btn-smart-delete');
const smartTitle         = document.getElementById('smart-title');
const smartDesc          = document.getElementById('smart-desc');
const smartDate          = document.getElementById('smart-date');
const smartCat           = document.getElementById('smart-cat');
const smartImgPreview    = document.getElementById('smart-modal-img-preview');
const smartImgPlaceholder= document.getElementById('smart-modal-img-placeholder');
const btnSmartImgUpload  = document.getElementById('btn-smart-img-upload');
const btnSmartImgRemove  = document.getElementById('btn-smart-img-remove');
const smartImgFile       = document.getElementById('smart-img-file');

let editingSmartId   = null;
let pendingSmartImg  = null; // base64 or empty string

async function loadSmartGoals() {
  const goals = await getSmartGoals();
  smartCount.textContent = `${goals.length} goal${goals.length !== 1 ? 's' : ''}`;
  renderSmartCards(goals);
}

function renderSmartCards(goals) {
  // Remove all cards except the add card
  smartScroll.querySelectorAll('.smart-card:not(#smart-add-card)').forEach(c => c.remove());

  goals.forEach((g) => {
    const card = buildSmartCard(g);
    smartScroll.insertBefore(card, smartAddCard);
  });
}

function buildSmartCard(g) {
  const card = document.createElement('div');
  card.className = 'smart-card fade-in';
  card.dataset.id = g.id;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  const hasImg = g.imageBase64 && g.imageBase64.length > 10;

  card.innerHTML = `
    ${hasImg
      ? `<img class="smart-card-img" src="${g.imageBase64}" alt="${escHtml(g.title)}" />`
      : `<div class="smart-card-img-placeholder">
           <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round">
             <circle cx="12" cy="12" r="10"/>
             <circle cx="12" cy="12" r="6"/>
             <circle cx="12" cy="12" r="2"/>
           </svg>
         </div>`
    }
    <div class="smart-card-body">
      <div class="smart-card-title">${escHtml(g.title)}</div>
      ${g.description ? `<div class="smart-card-desc">${escHtml(g.description)}</div>` : ''}
      <div class="smart-card-footer">
        ${catPillHTML(g.category || 'Personal')}
        ${g.targetDate ? `<span class="smart-card-date">${fmtDate(g.targetDate)}</span>` : ''}
      </div>
    </div>
  `;

  const open = () => openSmartModal(g);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  return card;
}

function openSmartModal(goal = null) {
  editingSmartId = goal ? goal.id : null;
  pendingSmartImg = goal ? (goal.imageBase64 ?? '') : '';

  smartModalTitle.textContent = goal ? 'Edit SMART Goal' : 'Add SMART Goal';
  smartTitle.value  = goal?.title       ?? '';
  smartDesc.value   = goal?.description ?? '';
  smartDate.value   = goal?.targetDate  ?? '';
  smartCat.value    = goal?.category    ?? 'Personal';

  // Image preview
  applySmartModalImage(pendingSmartImg);

  btnSmartDelete.classList.toggle('hidden', !goal);
  smartModalOverlay.classList.remove('hidden');
  smartTitle.focus();
}

function applySmartModalImage(base64) {
  pendingSmartImg = base64;
  if (base64) {
    smartImgPreview.src = base64;
    smartImgPreview.classList.remove('hidden');
    smartImgPlaceholder.classList.add('hidden');
    btnSmartImgRemove.classList.remove('hidden');
  } else {
    smartImgPreview.classList.add('hidden');
    smartImgPlaceholder.classList.remove('hidden');
    btnSmartImgRemove.classList.add('hidden');
  }
}

function closeSmartModal() {
  smartModalOverlay.classList.add('hidden');
  editingSmartId = null;
  pendingSmartImg = null;
  smartImgFile.value = '';
}

async function saveSmartGoal() {
  const title = smartTitle.value.trim();
  if (!title) { smartTitle.focus(); return; }

  const payload = {
    title,
    description: smartDesc.value.trim(),
    targetDate:  smartDate.value,
    category:    smartCat.value,
    imageBase64: pendingSmartImg ?? '',
  };

  if (editingSmartId) {
    await update('smart_goals', editingSmartId, payload);
  } else {
    await push('smart_goals', {
      id: generateId(),
      createdAt: new Date().toISOString(),
      ...payload,
    });
  }

  closeSmartModal();
  await loadSmartGoals();
}

async function deleteSmartGoal() {
  if (!editingSmartId) return;
  const isConfirmed = await showConfirm('Delete this SMART goal?', 'Delete Goal');
  if (!isConfirmed) return;
  await remove('smart_goals', editingSmartId);
  closeSmartModal();
  await loadSmartGoals();
}

// Smart image upload
btnSmartImgUpload.addEventListener('click', () => smartImgFile.click());
smartImgFile.addEventListener('change', async () => {
  const file = smartImgFile.files[0];
  if (!file) return;
  try {
    btnSmartImgUpload.textContent = 'Compressing…';
    btnSmartImgUpload.disabled = true;
    const base64 = await compressImage(file);
    applySmartModalImage(base64);
  } catch { showAlert('Failed to process image.', 'Upload Error'); }
  finally {
    btnSmartImgUpload.textContent = 'Upload image';
    btnSmartImgUpload.disabled = false;
    smartImgFile.value = '';
  }
});

btnSmartImgRemove.addEventListener('click', () => applySmartModalImage(''));

// Modal events
smartAddCard.addEventListener('click', () => openSmartModal(null));
smartAddCard.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSmartModal(null); }
});
smartModalClose.addEventListener('click', closeSmartModal);
btnSmartCancel.addEventListener('click', closeSmartModal);
btnSmartSave.addEventListener('click', saveSmartGoal);
btnSmartDelete.addEventListener('click', deleteSmartGoal);
smartModalOverlay.addEventListener('click', (e) => {
  if (e.target === smartModalOverlay) closeSmartModal();
});

// ─── ══════════════════════════════════════════════════════════
//     3. LONG & SHORT TERM GOALS
// ══════════════════════════════════════════════════════════════

const longGoalsList  = document.getElementById('long-goals-list');
const shortGoalsList = document.getElementById('short-goals-list');
const longGoalsEmpty = document.getElementById('long-goals-empty');
const shortGoalsEmpty= document.getElementById('short-goals-empty');
const btnAddLong     = document.getElementById('btn-add-long');
const btnAddShort    = document.getElementById('btn-add-short');

// Goal modal
const goalModalOverlay = document.getElementById('goal-modal-overlay');
const goalModalTitle   = document.getElementById('goal-modal-title');
const goalModalClose   = document.getElementById('goal-modal-close');
const btnGoalCancel    = document.getElementById('btn-goal-cancel');
const btnGoalSave      = document.getElementById('btn-goal-save');
const btnGoalDelete    = document.getElementById('btn-goal-delete');
const goalTitleInput   = document.getElementById('goal-title');
const goalDescInput    = document.getElementById('goal-desc');
const goalDateInput    = document.getElementById('goal-date');

let editingGoalId   = null;
let editingGoalType = null; // 'long' | 'short'

async function loadGoals() {
  const [longGoals, shortGoals] = await Promise.all([
    getLongGoals(),
    getShortGoals(),
  ]);

  renderGoalList(longGoals,  longGoalsList,  longGoalsEmpty,  'long');
  renderGoalList(shortGoals, shortGoalsList, shortGoalsEmpty, 'short');
}

function renderGoalList(goals, listEl, emptyEl, type) {
  // Sort: active first, done at bottom
  const active = goals.filter((g) => g.status !== 'done');
  const done   = goals.filter((g) => g.status === 'done');
  const sorted = [...active, ...done];

  if (sorted.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = sorted.map((g) => `
    <div class="goal-item${g.status === 'done' ? ' is-done' : ''}" data-id="${g.id}" data-type="${type}">
      <input type="checkbox" class="goal-item-check"
             data-id="${g.id}" data-type="${type}"
             ${g.status === 'done' ? 'checked' : ''} />
      <div class="goal-item-body">
        <div class="goal-item-title${g.status === 'done' ? ' done-text' : ''}">${escHtml(g.title)}</div>
        ${g.targetDate ? `<div class="goal-item-date">${fmtDate(g.targetDate)}</div>` : ''}
      </div>
      <div class="goal-item-edit" data-id="${g.id}" data-type="${type}" title="Edit">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </div>
    </div>
  `).join('');

  // Bind checkboxes
  listEl.querySelectorAll('.goal-item-check').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const key  = cb.dataset.type === 'long' ? 'goals_long' : 'goals_short';
      const status = cb.checked ? 'done' : 'active';
      await update(key, cb.dataset.id, { status });
      await loadGoals();
    });
  });

  // Bind edit buttons
  listEl.querySelectorAll('.goal-item-edit').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key   = btn.dataset.type === 'long' ? 'goals_long' : 'goals_short';
      const goals = await get(key) ?? [];
      const goal  = goals.find((g) => g.id === btn.dataset.id);
      if (goal) openGoalModal(btn.dataset.type, goal);
    });
  });
}

function openGoalModal(type, goal = null) {
  editingGoalType = type;
  editingGoalId   = goal?.id ?? null;

  const label = type === 'long' ? 'Long-term' : 'Short-term';
  goalModalTitle.textContent = goal ? `Edit ${label} Goal` : `Add ${label} Goal`;

  goalTitleInput.value = goal?.title       ?? '';
  goalDescInput.value  = goal?.description ?? '';
  goalDateInput.value  = goal?.targetDate  ?? '';

  btnGoalDelete.classList.toggle('hidden', !goal);
  goalModalOverlay.classList.remove('hidden');
  goalTitleInput.focus();
}

function closeGoalModal() {
  goalModalOverlay.classList.add('hidden');
  editingGoalId   = null;
  editingGoalType = null;
}

async function saveGoal() {
  const title = goalTitleInput.value.trim();
  if (!title) { goalTitleInput.focus(); return; }

  const key = editingGoalType === 'long' ? 'goals_long' : 'goals_short';

  const payload = {
    title,
    description: goalDescInput.value.trim(),
    targetDate:  goalDateInput.value,
  };

  if (editingGoalId) {
    await update(key, editingGoalId, payload);
  } else {
    await push(key, {
      id: generateId(),
      status: 'active',
      ...payload,
    });
  }

  closeGoalModal();
  await loadGoals();
}

async function deleteGoal() {
  if (!editingGoalId || !editingGoalType) return;
  const isConfirmed = await showConfirm('Delete this goal?', 'Delete Goal');
  if (!isConfirmed) return;
  const key = editingGoalType === 'long' ? 'goals_long' : 'goals_short';
  await remove(key, editingGoalId);
  closeGoalModal();
  await loadGoals();
}

// Goal modal event bindings
btnAddLong.addEventListener('click',  () => openGoalModal('long'));
btnAddShort.addEventListener('click', () => openGoalModal('short'));
goalModalClose.addEventListener('click', closeGoalModal);
btnGoalCancel.addEventListener('click', closeGoalModal);
btnGoalSave.addEventListener('click', saveGoal);
btnGoalDelete.addEventListener('click', deleteGoal);
goalModalOverlay.addEventListener('click', (e) => {
  if (e.target === goalModalOverlay) closeGoalModal();
});

// Enter to save in goal modal
[goalTitleInput, goalDescInput, goalDateInput].forEach((el) => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveGoal(); }
  });
});

// Enter to save in smart modal (only in text fields)
[smartTitle, smartDate].forEach((el) => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveSmartGoal(); }
  });
});

// Escape closes modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!smartModalOverlay.classList.contains('hidden')) closeSmartModal();
    if (!goalModalOverlay.classList.contains('hidden'))  closeGoalModal();
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  await Promise.all([
    loadVision(),
    loadSmartGoals(),
    loadGoals(),
  ]);

  // Initialize automatic synchronization
  initAutoSync();
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(changes);
  const hasVisionChanges = keys.some(key => 
    key === 'vision' ||
    key === 'smart_goals' ||
    key === 'long_goals' ||
    key === 'short_goals' ||
    key === 'yearly_themes'
  );
  if (hasVisionChanges) {
    await Promise.all([
      loadVision(),
      loadSmartGoals(),
      loadGoals(),
    ]);
  }
});

init();
