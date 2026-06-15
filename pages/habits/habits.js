/**
 * Clarity — pages/habits/habits.js
 */

import {
  getHabits, saveHabits, getTasks, updateTask, generateId, todayKey, dateKey,
  removeFutureHabitInstances,
  initAutoSync,
  getCustomCategories
} from '../../shared/storage.js';

// SVG Definitions for preset icons
const HABIT_ICONS = {
  Book: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`,
  Activity: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`,
  Heart: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`,
  Brain: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-3.12 3 3 0 0 1 0-4.88 2.5 2.5 0 0 1 0-3.12A2.5 2.5 0 0 1 9.5 2z"></path><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-3.12 3 3 0 0 0 0-4.88 2.5 2.5 0 0 0 0-3.12A2.5 2.5 0 0 0 14.5 2z"></path></svg>`,
  Coffee: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>`,
  Briefcase: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>`,
  GlassWater: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 5-2.07l-5-5.93-5 5.93A7 7 0 0 0 12 22z"></path><path d="M17 19.93A7 7 0 0 0 12 15a7 7 0 0 0-5 4.93"></path><path d="M21 12H3"></path><path d="M12 2a10 10 0 0 0-10 10v2a10 10 0 0 0 20 0v-2A10 10 0 0 0 12 2z"></path></svg>`,
  Pills: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"></path><path d="m8.5 8.5 7 7"></path></svg>`,
  Smile: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>`
};

export function getCategoryColor(cat) {
  const palettes = [
    { bg: '#F5F3FF', acc: '#7C3AED', txt: '#5B21B6' }, // Purple
    { bg: '#EEF2FF', acc: '#4F46E5', txt: '#3730A3' }, // Indigo
    { bg: '#FFF1F2', acc: '#E11D48', txt: '#BE123C' }, // Red
    { bg: '#F0FDF4', acc: '#16A34A', txt: '#15803D' }, // Green
    { bg: '#FFFBEB', acc: '#D97706', txt: '#B45309' }, // Amber
    { bg: '#ECFDF5', acc: '#059669', txt: '#047857' }, // Emerald
    { bg: '#F0FDFA', acc: '#0D9488', txt: '#0F766E' }, // Teal
    { bg: '#F0F9FF', acc: '#0284C7', txt: '#0369A1' }, // Sky
    { bg: '#F4F4F5', acc: '#71717A', txt: '#3F3F46' }, // Zinc
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

// Date math helper (local time)
function parseLocal(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// App State
let allHabits = [];
let todayTasks = [];
const TODAY = todayKey();

// DOM elements
const todayHabitsList = document.getElementById('today-habits-list');
const groupActive = document.getElementById('group-active');
const groupPaused = document.getElementById('group-paused');
const groupCompleted = document.getElementById('group-completed');
const groupArchived = document.getElementById('group-archived');

// Modal Elements
const modal = document.getElementById('habit-modal');
const modalTitle = document.getElementById('modal-title');
const habitForm = document.getElementById('habit-form');
const fieldId = document.getElementById('field-habit-id');
const fieldName = document.getElementById('field-name');
const fieldCategory = document.getElementById('field-category');
const fieldIcon = document.getElementById('field-icon');
const fieldRecType = document.getElementById('field-rec-type');
const fieldGoalType = document.getElementById('field-goal-type');
const fieldGoalDays = document.getElementById('field-goal-days');
const customDaysContainer = document.getElementById('goal-custom-days-container');
const timeSlotsContainer = document.getElementById('time-slots-container');

// Buttons
const btnNewHabit = document.getElementById('btn-new-habit');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelModal = document.getElementById('btn-cancel-modal');
const btnSubmitModal = document.getElementById('btn-submit-modal');
const btnAddTimeslot = document.getElementById('btn-add-timeslot');

// Delete / Edit actions
const btnPauseHabit = document.getElementById('btn-pause-habit');
const btnArchiveHabit = document.getElementById('btn-archive-habit');
const btnDeleteHabit = document.getElementById('btn-delete-habit');

// Celebration elements
const celebrationBanner = document.getElementById('celebration-banner');
const celebrationText = document.getElementById('celebration-text');
const btnCloseCelebration = document.getElementById('btn-close-celebration');

// Init
async function init() {
  // Trigger habits synchronization for the next 7 days in the background
  try {
    await chrome.runtime.sendMessage({ type: 'SYNC_HABITS' });
  } catch (_) {}

  await populateCategoryPicker();
  await loadData();
  renderIconPicker();
  setupEventListeners();
  checkCelebrations();

  // Initialize automatic synchronization
  initAutoSync();
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes['habits'] || Object.keys(changes).some(key => key.startsWith('tasks_'))) {
    await loadData();
  }
});

async function loadData() {
  allHabits = await getHabits();
  todayTasks = await getTasks(TODAY);
  renderTodayHabits();
  renderAllHabits();
}

async function populateCategoryPicker() {
  const picker = document.getElementById('habit-category-picker');
  if (!picker) return;
  const categories = await getCustomCategories();
  
  picker.innerHTML = '';
  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat-pill';
    btn.dataset.cat = cat;
    btn.textContent = cat;
    picker.appendChild(btn);
  });
  
  picker.querySelectorAll('.cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      picker.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      fieldCategory.value = btn.dataset.cat;
    });
  });
}

function setupEventListeners() {
  btnNewHabit.addEventListener('click', () => openModal());
  btnCloseModal.addEventListener('click', closeModal);
  btnCancelModal.addEventListener('click', closeModal);

  // Recurrence Selectors
  document.querySelectorAll('.recurrence-selector .rec-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.recurrence-selector .rec-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      fieldRecType.value = btn.dataset.type;

      // Hide all sub-inputs
      document.querySelectorAll('.rec-sub-input').forEach(div => div.classList.add('hidden'));
      // Show specific
      const target = document.getElementById(`rec-input-${btn.dataset.type}`);
      if (target) target.classList.remove('hidden');
    });
  });

  // Day buttons
  document.querySelectorAll('.day-picker .day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
    });
  });

  // Goal Cards
  document.querySelectorAll('.goal-duration-picker .goal-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.goal-duration-picker .goal-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      fieldGoalType.value = card.dataset.val;

      if (card.dataset.val === 'custom') {
        customDaysContainer.classList.remove('hidden');
        fieldGoalDays.required = true;
      } else {
        customDaysContainer.classList.add('hidden');
        fieldGoalDays.required = false;
      }
    });
  });

  // Time Slots
  btnAddTimeslot.addEventListener('click', () => addTimeSlotRow());

  // Form Submit
  habitForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveHabitForm();
  });

  // Edit action buttons
  btnPauseHabit.addEventListener('click', async () => {
    const id = fieldId.value;
    const habit = allHabits.find(h => h.id === id);
    if (habit) {
      habit.status = habit.status === 'paused' ? 'active' : 'paused';
      if (habit.status === 'paused') {
        await removeFutureHabitInstances(habit.id, TODAY);
      }
      await saveHabits(allHabits);
      await chrome.runtime.sendMessage({ type: 'SYNC_HABITS' });
      closeModal();
      await loadData();
    }
  });

  btnArchiveHabit.addEventListener('click', async () => {
    const id = fieldId.value;
    const habit = allHabits.find(h => h.id === id);
    if (habit) {
      habit.status = habit.status === 'archived' ? 'active' : 'archived';
      if (habit.status === 'archived') {
        await removeFutureHabitInstances(habit.id, TODAY);
      }
      await saveHabits(allHabits);
      await chrome.runtime.sendMessage({ type: 'SYNC_HABITS' });
      closeModal();
      await loadData();
    }
  });

  btnDeleteHabit.addEventListener('click', async () => {
    const id = fieldId.value;
    if (confirm('Are you sure you want to delete this habit? All future scheduled items will be removed.')) {
      const filtered = allHabits.filter(h => h.id !== id);
      await saveHabits(filtered);
      await removeFutureHabitInstances(id, TODAY);
      await chrome.runtime.sendMessage({ type: 'SYNC_HABITS' });
      closeModal();
      await loadData();
    }
  });

  // Celebration Close
  btnCloseCelebration.addEventListener('click', () => {
    celebrationBanner.classList.add('hidden');
  });
}

function checkCelebrations() {
  const completedHabit = allHabits.find(h => h.showCompletionCelebration);
  if (completedHabit) {
    const duration = completedHabit.goal.durationDays || 'ongoing';
    celebrationText.textContent = `You completed ${completedHabit.name} — ${duration} day goal reached!`;
    celebrationBanner.classList.remove('hidden');

    // Reset flag
    completedHabit.showCompletionCelebration = false;
    saveHabits(allHabits);
  }
}

// ─── Modals & Form Helpers ──────────────────────────────────────────────────────

async function openModal(habit = null) {
  modal.classList.remove('hidden');
  habitForm.reset();
  timeSlotsContainer.innerHTML = '';
  
  // Reset active pickers
  document.querySelectorAll('.category-picker .cat-pill').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.icon-picker-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.recurrence-selector .rec-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.rec-sub-input').forEach(div => div.classList.add('hidden'));
  document.querySelectorAll('.day-picker .day-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.goal-duration-picker .goal-card').forEach(c => c.classList.remove('active'));
  customDaysContainer.classList.add('hidden');

  if (habit) {
    // EDIT MODE
    modalTitle.textContent = 'Edit Habit';
    btnSubmitModal.textContent = 'Save Changes';
    fieldId.value = habit.id;
    fieldName.value = habit.name;

    // Category
    fieldCategory.value = habit.category;
    const catBtn = Array.from(document.querySelectorAll('.category-picker .cat-pill')).find(btn => btn.dataset.cat === habit.category);
    if (catBtn) catBtn.classList.add('active');

    // Icon
    fieldIcon.value = habit.icon;
    const iconBtn = document.querySelector(`.icon-picker-btn[data-icon="${habit.icon}"]`);
    if (iconBtn) iconBtn.classList.add('active');

    // Recurrence
    fieldRecType.value = habit.recurrence.type;
    const recBtn = document.querySelector(`.recurrence-selector .rec-btn[data-type="${habit.recurrence.type}"]`);
    if (recBtn) recBtn.classList.add('active');

    const subInput = document.getElementById(`rec-input-${habit.recurrence.type}`);
    if (subInput) subInput.classList.remove('hidden');

    if (habit.recurrence.type === 'specificDays') {
      const days = habit.recurrence.days || [];
      days.forEach(d => {
        const btn = document.querySelector(`.day-picker .day-btn[data-day="${d}"]`);
        if (btn) btn.classList.add('active');
      });
    } else if (habit.recurrence.type === 'xPerWeek') {
      document.getElementById('field-rec-count-week').value = habit.recurrence.countPerPeriod;
    } else if (habit.recurrence.type === 'xPerMonth') {
      document.getElementById('field-rec-count-month').value = habit.recurrence.countPerPeriod;
    }

    // Goal Duration
    fieldGoalType.value = habit.goal.type;
    const goalCard = document.querySelector(`.goal-duration-picker .goal-card[data-val="${habit.goal.type}"]`);
    if (goalCard) {
      goalCard.classList.add('active');
    } else {
      // Custom card
      const cCard = document.querySelector(`.goal-duration-picker .goal-card[data-val="custom"]`);
      if (cCard) {
        cCard.classList.add('active');
        customDaysContainer.classList.remove('hidden');
        fieldGoalDays.value = habit.goal.durationDays;
      }
    }

    // Time Slots
    if (habit.timeSlots && habit.timeSlots.length > 0) {
      habit.timeSlots.forEach(slot => addTimeSlotRow(slot.time, slot.label));
    } else {
      addTimeSlotRow('08:00', '');
    }

    // Show actions
    btnPauseHabit.classList.remove('hidden');
    btnPauseHabit.textContent = habit.status === 'paused' ? 'Resume' : 'Pause';
    btnArchiveHabit.classList.remove('hidden');
    btnArchiveHabit.textContent = habit.status === 'archived' ? 'Unarchive' : 'Archive';
    btnDeleteHabit.classList.remove('hidden');
  } else {
    // CREATE MODE
    modalTitle.textContent = 'Create New Habit';
    btnSubmitModal.textContent = 'Create Habit';
    fieldId.value = '';
    
    // Set default category & icon
    const categories = await getCustomCategories();
    const defaultCat = categories[0] || 'Personal';
    fieldCategory.value = defaultCat;
    const catBtn = Array.from(document.querySelectorAll('.category-picker .cat-pill')).find(btn => btn.dataset.cat === defaultCat);
    if (catBtn) catBtn.classList.add('active');

    fieldIcon.value = 'Book';
    const iconBtn = document.querySelector('.icon-picker-btn[data-icon="Book"]');
    if (iconBtn) iconBtn.classList.add('active');

    // Default Recurrence "Every Day"
    fieldRecType.value = 'daily';
    document.querySelector('.recurrence-selector .rec-btn[data-type="daily"]').classList.add('active');

    // Default Goal Ongoing
    fieldGoalType.value = 'ongoing';
    document.querySelector('.goal-duration-picker .goal-card[data-val="ongoing"]').classList.add('active');

    // Default 1 Time Slot
    addTimeSlotRow('08:00', '');

    // Hide actions
    btnPauseHabit.classList.add('hidden');
    btnArchiveHabit.classList.add('hidden');
    btnDeleteHabit.classList.add('hidden');
  }
}

function closeModal() {
  modal.classList.add('hidden');
}

function renderIconPicker() {
  const iconPicker = document.getElementById('icon-picker');
  iconPicker.innerHTML = Object.keys(HABIT_ICONS).map(name => `
    <button type="button" class="icon-picker-btn" data-icon="${name}" title="${name}">
      ${HABIT_ICONS[name]}
    </button>
  `).join('');

  iconPicker.querySelectorAll('.icon-picker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      iconPicker.querySelectorAll('.icon-picker-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      fieldIcon.value = btn.dataset.icon;
    });
  });
}

function addTimeSlotRow(time = '08:00', label = '') {
  const row = document.createElement('div');
  row.className = 'timeslot-row';
  row.innerHTML = `
    <input type="time" class="timeslot-input-time" value="${time}" required />
    <input type="text" class="timeslot-input-label" placeholder="Slot label (e.g. Morning dose)" value="${label}" maxLength="50" />
    <button type="button" class="btn-remove-slot">&times;</button>
  `;
  row.querySelector('.btn-remove-slot').addEventListener('click', () => {
    if (timeSlotsContainer.querySelectorAll('.timeslot-row').length > 1) {
      row.remove();
    } else {
      alert('A habit must have at least one time slot!');
    }
  });
  timeSlotsContainer.appendChild(row);
}

async function saveHabitForm() {
  const id = fieldId.value;
  const name = fieldName.value.trim();
  const category = fieldCategory.value;
  const icon = fieldIcon.value;
  const recType = fieldRecType.value;
  const goalType = fieldGoalType.value;

  // Resolve Recurrence Days or counts
  let days = [];
  let countPerPeriod = null;

  if (recType === 'specificDays') {
    document.querySelectorAll('.day-picker .day-btn.active').forEach(btn => {
      days.push(btn.dataset.day);
    });
    if (days.length === 0) {
      alert('Please select at least one day for the specific days pattern.');
      return;
    }
  } else if (recType === 'xPerWeek') {
    countPerPeriod = Number(document.getElementById('field-rec-count-week').value);
  } else if (recType === 'xPerMonth') {
    countPerPeriod = Number(document.getElementById('field-rec-count-month').value);
  }

  // Goal duration days
  let durationDays = null;
  if (goalType === 'custom') {
    durationDays = Number(fieldGoalDays.value);
  } else if (goalType !== 'ongoing') {
    durationDays = Number(goalType);
  }

  // Time slots
  const timeSlots = [];
  timeSlotsContainer.querySelectorAll('.timeslot-row').forEach(row => {
    timeSlots.push({
      time: row.querySelector('.timeslot-input-time').value,
      label: row.querySelector('.timeslot-input-label').value.trim()
    });
  });

  const habitData = {
    id: id || generateId(),
    name,
    icon,
    category,
    recurrence: {
      type: recType,
      days,
      countPerPeriod
    },
    goal: {
      type: goalType,
      durationDays,
      startDate: id ? (allHabits.find(h => h.id === id)?.goal?.startDate || TODAY) : TODAY
    },
    timeSlots,
    streak: id ? (allHabits.find(h => h.id === id)?.streak || { current: 0, longest: 0, lastCompletedDate: null }) : { current: 0, longest: 0, lastCompletedDate: null },
    completions: id ? (allHabits.find(h => h.id === id)?.completions || {}) : {},
    status: id ? (allHabits.find(h => h.id === id)?.status || 'active') : 'active',
    createdAt: id ? (allHabits.find(h => h.id === id)?.createdAt || Date.now()) : Date.now()
  };

  if (id) {
    const idx = allHabits.findIndex(h => h.id === id);
    allHabits[idx] = habitData;
  } else {
    allHabits.push(habitData);
  }

  await saveHabits(allHabits);
  
  // Call SW sync
  await chrome.runtime.sendMessage({ type: 'SYNC_HABITS' });

  closeModal();
  await loadData();
}

// ─── Rendering ──────────────────────────────────────────────────────────────────

function renderTodayHabits() {
  todayHabitsList.innerHTML = '';
  
  const todayHabits = todayTasks.filter(t => t.habitId);
  
  if (todayHabits.length === 0) {
    todayHabitsList.innerHTML = `<div class="text-muted text-center" style="padding: var(--space-4); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-card);">No habits scheduled for today. Take a break! ☕</div>`;
    return;
  }

  todayHabits.forEach(task => {
    const habit = allHabits.find(h => h.id === task.habitId);
    if (!habit) return;

    const colors = getCategoryColor(habit.category);
    const streak = habit.streak?.current || 0;

    // Create row
    const row = document.createElement('div');
    row.className = 'today-habit-row';
    
    row.innerHTML = `
      <div class="habit-checkbox-wrapper">
        <input type="checkbox" class="habit-checkbox" data-task-id="${task.id}" ${task.done ? 'checked' : ''} />
      </div>
      <div class="habit-row-icon" style="background: ${colors.bg}; color: ${colors.acc};">
        ${HABIT_ICONS[habit.icon] || HABIT_ICONS.Book}
      </div>
      <div class="habit-row-details">
        <div class="habit-row-name-bar">
          <span class="habit-row-name">${task.title}</span>
          <span class="streak-badge" title="Current streak">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2c1.78 0 3.32.96 4.12 2.39C17 5.76 17 8 15 10c-2.4 2.4-1.78 6-1 7 .5.6 1 1 2 1s2.5-.5 3-1.5c1.4-2.8 1.4-6.2.2-9.2C19.78 6.55 20 5.4 20 4c0-1.1-.9-2-2-2-1.2 0-2.2.8-2.6 1.9C14.7 3.3 13.4 3 12 3s-2.7.3-3.4.9C8.2 2.8 7.2 2 6 2 4.9 2 4 2.9 4 4c0 1.4.22 2.55.8 3.3C3.6 10.3 3.6 13.7 5 16.5c.5 1 2 1.5 3 1.5s1.5-.4 2-1c.78-1 1.4-4.6-1-7C7 8 7 5.76 7.88 4.39 8.68 2.96 10.22 2 12 2z"></path></svg>
            ${streak}
          </span>
        </div>
        <div class="habit-row-schedule">${getScheduleSummary(habit)}</div>
        <div class="mini-heatmap" id="mini-heatmap-${habit.id}-${task.id}"></div>
      </div>
      <div class="habit-row-meta">
        ${task.habitTime ? `<span class="time-badge">${task.habitTime}</span>` : ''}
      </div>
    `;

    // Hook checkbox click
    row.querySelector('.habit-checkbox').addEventListener('change', async (e) => {
      const isChecked = e.target.checked;
      await updateTask(TODAY, task.id, { done: isChecked });
      await loadData();
    });

    todayHabitsList.appendChild(row);

    // Render 21-day mini-heatmap
    renderMiniHeatmap(habit, `mini-heatmap-${habit.id}-${task.id}`);
  });
}

function renderAllHabits() {
  groupActive.innerHTML = '';
  groupPaused.innerHTML = '';
  groupCompleted.innerHTML = '';
  groupArchived.innerHTML = '';

  const groups = {
    active: groupActive,
    paused: groupPaused,
    completed: groupCompleted,
    archived: groupArchived
  };

  allHabits.forEach(habit => {
    const container = groups[habit.status];
    if (!container) return;

    const colors = getCategoryColor(habit.category);
    const streak = habit.streak?.current || 0;
    const longest = habit.streak?.longest || 0;

    const card = document.createElement('div');
    card.className = 'habit-card';
    card.dataset.id = habit.id;

    // Calculate completion ratio
    const completionStats = getGoalProgress(habit);

    card.innerHTML = `
      <div class="habit-card-header">
        <div class="habit-card-identity">
          <div class="habit-card-icon" style="background: ${colors.bg}; color: ${colors.acc};">
            ${HABIT_ICONS[habit.icon] || HABIT_ICONS.Book}
          </div>
          <div style="display: flex; flex-direction: column;">
            <span class="habit-card-name">${habit.name}</span>
            <span class="habit-row-schedule" style="font-size: 11px;">${getScheduleSummary(habit)}</span>
          </div>
        </div>
        <span class="streak-badge" title="Current streak">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2c1.78 0 3.32.96 4.12 2.39C17 5.76 17 8 15 10c-2.4 2.4-1.78 6-1 7 .5.6 1 1 2 1s2.5-.5 3-1.5c1.4-2.8 1.4-6.2.2-9.2C19.78 6.55 20 5.4 20 4c0-1.1-.9-2-2-2-1.2 0-2.2.8-2.6 1.9C14.7 3.3 13.4 3 12 3s-2.7.3-3.4.9C8.2 2.8 7.2 2 6 2 4.9 2 4 2.9 4 4c0 1.4.22 2.55.8 3.3C3.6 10.3 3.6 13.7 5 16.5c.5 1 2 1.5 3 1.5s1.5-.4 2-1c.78-1 1.4-4.6-1-7C7 8 7 5.76 7.88 4.39 8.68 2.96 10.22 2 12 2z"></path></svg>
          ${streak} <span style="font-size:10px; opacity:0.6; font-weight:normal;">(max ${longest})</span>
        </span>
      </div>

      ${habit.goal.type !== 'ongoing' ? `
        <div class="habit-card-progress">
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${completionStats.percent}%;"></div>
          </div>
          <div class="progress-text-label">
            <span>Progress: ${completionStats.percent}%</span>
            <span>${completionStats.done} / ${completionStats.total} days</span>
          </div>
        </div>
      ` : ''}

      <div class="heatmap-container">
        <span class="heatmap-label">Last 90 days</span>
        <div class="heatmap-grid" id="heatmap-90-${habit.id}"></div>
      </div>
    `;

    // Click opens Edit dialog
    card.addEventListener('click', (e) => {
      // Don't open if clicking on internal controls (if any)
      openModal(habit);
    });

    container.appendChild(card);
    render90DayHeatmap(habit, `heatmap-90-${habit.id}`);
  });

  // Check if group is empty and show indicator
  Object.keys(groups).forEach(key => {
    const el = groups[key];
    if (el.children.length === 0) {
      el.innerHTML = `<div class="text-muted text-xs text-center" style="width:100%; padding: var(--space-4); background: var(--color-bg); border: 1px dashed var(--color-border); border-radius: var(--radius-card);">No ${key} habits</div>`;
    }
  });
}

// ─── Heatmap Rendering ──────────────────────────────────────────────────────────

function renderMiniHeatmap(habit, elementId) {
  const container = document.getElementById(elementId);
  if (!container) return;
  container.innerHTML = '';

  const totalDays = 21;
  const list = [];
  const start = new Date();
  start.setDate(start.getDate() - totalDays + 1);

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    list.push(formatLocal(d));
  }

  list.forEach(dateStr => {
    const cell = document.createElement('div');
    cell.className = 'mini-cell';
    cell.title = dateStr;

    const completions = habit.completions?.[dateStr];
    if (completions) {
      const slots = habit.timeSlots || [];
      const doneSlots = slots.filter(s => completions[s.time] === true).length;
      if (doneSlots === slots.length) {
        cell.className += ' filled-full';
      } else if (doneSlots > 0) {
        cell.className += ' filled-partial';
      } else {
        cell.className += ' filled-none';
      }
    } else {
      cell.className += ' filled-none';
    }

    container.appendChild(cell);
  });
}

function render90DayHeatmap(habit, elementId) {
  const container = document.getElementById(elementId);
  if (!container) return;
  container.innerHTML = '';

  const totalDays = 90;
  const list = [];
  const start = new Date();
  start.setDate(start.getDate() - totalDays + 1);

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    list.push(formatLocal(d));
  }

  list.forEach(dateStr => {
    const cell = document.createElement('div');
    cell.className = 'heatmap-cell';
    cell.title = dateStr;

    const completions = habit.completions?.[dateStr];
    if (completions) {
      const slots = habit.timeSlots || [];
      const doneSlots = slots.filter(s => completions[s.time] === true).length;
      if (doneSlots === slots.length) {
        cell.className += ' cell-full';
      } else if (doneSlots > 0) {
        cell.className += ' cell-partial';
      } else {
        cell.className += ' cell-none';
      }
    } else {
      cell.className += ' cell-none';
    }

    container.appendChild(cell);
  });
}

// ─── Helpers & Summaries ────────────────────────────────────────────────────────

function getScheduleSummary(habit) {
  const rec = habit.recurrence || {};
  let recText = '';
  switch (rec.type) {
    case 'daily': recText = 'Every day'; break;
    case 'specificDays': recText = (rec.days || []).join(', '); break;
    case 'everyOtherDay': recText = 'Every other day'; break;
    case 'xPerWeek': recText = `${rec.countPerPeriod}x per week`; break;
    case 'xPerMonth': recText = `${rec.countPerPeriod}x per month`; break;
  }

  const durationText = habit.goal.type === 'ongoing' ? 'Ongoing' : `${habit.goal.durationDays} day goal`;
  return `${recText} · ${habit.timeSlots?.length || 1} slot(s) · ${durationText}`;
}

function getGoalProgress(habit) {
  if (habit.goal.type === 'ongoing') return { percent: 0, done: 0, total: 0 };
  const duration = habit.goal.durationDays || 21;
  const startDateStr = habit.goal.startDate;
  
  // Calculate completed days in history
  let daysCompleted = 0;
  const completions = habit.completions || {};
  const slots = habit.timeSlots || [];

  Object.keys(completions).forEach(dateStr => {
    if (dateStr >= startDateStr) {
      const dayData = completions[dateStr];
      const isDayComplete = slots.length > 0 && slots.every(s => dayData[s.time] === true);
      if (isDayComplete) {
        daysCompleted++;
      }
    }
  });

  const percent = Math.min(100, Math.round((daysCompleted / duration) * 100));

  return {
    percent,
    done: daysCompleted,
    total: duration
  };
}

document.addEventListener('DOMContentLoaded', init);
