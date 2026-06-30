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
  initAutoSync,
  getAuth,
} from '../shared/storage.js';

import { mountTimeboard } from '../shared/timeboard.js';
import { showConfirm, showAlert } from '../shared/dialog.js';
import { getSriLankanHoliday } from '../shared/holidays.js';

import {
  getFixedEventsForMonth,
  getFixedEventsForDate,
  getUpcomingFixedEvents,
  toggleFixedEventComplete
} from '../shared/fixedEventsService.js';
import { openFixedEventModal } from '../shared/FixedEventModal.js';

let showSlHolidays = false;

// ─── Date helpers ──────────────────────────────────────────────────────────────
function isoDate(d) { return d.toISOString().slice(0, 10); }

function dateKeyFrom(baseDateStr, offset) {
  const d = new Date(baseDateStr + 'T12:00:00');
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function formatTimeStr(time24) {
  if (!time24) return '';
  const [hStr, mStr] = time24.split(':');
  const h = parseInt(hStr, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return `${displayH}:${mStr} ${ampm}`;
}

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
let activeCat        = null;
let selectedPriority = 1;
let activeTab        = 'day';
let collapsedCategories = [];

let timeboardInstance = null;
let lastAddedCategory = null;
let expandedQuickAdds = [];
let expandedSubtaskAdds = [];
let lastAddedSubtaskTaskId = null;

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
    renderDayHolidayBanner();
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

function renderDayHolidayBanner() {
  const banner = document.getElementById('day-holiday-banner');
  if (!banner) return;
  if (!showSlHolidays) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }
  const holiday = getSriLankanHoliday(currentDate);
  if (holiday) {
    banner.innerHTML = `<span class="holiday-tag">Sri Lankan Holiday</span> <span>${holiday.emoji} ${holiday.name}</span>`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
    banner.innerHTML = '';
  }
}

async function refreshCurrentTab() {
  if (activeTab === 'day') {
    renderDayHolidayBanner();
  } else if (activeTab === 'week') {
    await renderWeekTab();
  } else if (activeTab === 'month') {
    await renderMonthTab();
  } else if (activeTab === 'year') {
    await renderYearTab();
  }
}

async function onDayChanged() {
  renderDayDate();
  renderDayHolidayBanner();
  if (timeboardInstance) timeboardInstance.refresh(currentDate);
  await renderPriorityList();
  await loadNotes();
  await renderDayFixedEvents();
  await renderDaySidebarFixedEvents();
  await renderCountdownBanners();
}

async function renderDayFixedEvents() {
  const container = document.getElementById('day-fixed-events-banner-zone');
  if (!container) return;

  const auth = await getAuth();
  const userId = auth?.localId || '';
  const events = await getFixedEventsForDate(userId, currentDate);

  if (events.length === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = '';

  events.forEach(event => {
    const chip = document.createElement('div');
    const completedClass = event.isCompleted ? ' completed' : '';
    chip.className = `fixed-event-chip ${event.type}${completedClass}`;
    
    let icon = '🔔';
    if (event.type === 'deadline') icon = '⏰';
    else if (event.type === 'appointment') icon = '📅';

    const timeStr = event.time ? formatTimeStr(event.time) : 'All Day';
    chip.innerHTML = `<span>${icon}</span> <span class="font-medium">${escHtml(event.title)}</span> <span style="opacity: 0.6; margin-left: 2px;">· ${timeStr}</span>`;
    
    chip.addEventListener('click', () => {
      openFixedEventModal(event, async () => {
        await refreshActiveTab();
      }, async () => {
        await refreshActiveTab();
      });
    });
    
    container.appendChild(chip);
  });
}

async function renderDaySidebarFixedEvents() {
  const listContainer = document.getElementById('upcoming-fixed-events-list');
  if (!listContainer) return;

  const auth = await getAuth();
  const userId = auth?.localId || '';
  const events = await getUpcomingFixedEvents(userId, currentDate, 3);

  if (events.length === 0) {
    listContainer.innerHTML = `<div style="text-align: center; font-size: 12px; color: var(--color-text-muted); padding: 8px 0;">No upcoming events.</div>`;
    return;
  }

  listContainer.innerHTML = '';
  events.forEach(event => {
    const item = document.createElement('div');
    const completedClass = event.isCompleted ? ' completed' : '';
    item.className = `upcoming-event-item${completedClass}`;
    item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; border-radius: 6px; background: var(--color-bg); border-left: 3px solid; cursor: pointer; transition: background 150ms;';
    
    if (event.type === 'deadline') {
      item.style.borderLeftColor = '#ef4444';
    } else if (event.type === 'appointment') {
      item.style.borderLeftColor = '#3b82f6';
    } else {
      item.style.borderLeftColor = '#f59e0b';
    }
    
    item.addEventListener('mouseenter', () => { item.style.background = 'var(--color-border)'; });
    item.addEventListener('mouseleave', () => { item.style.background = 'var(--color-bg)'; });

    let icon = '🔔';
    if (event.type === 'deadline') icon = '⏰';
    else if (event.type === 'appointment') icon = '📅';

    let dateLabel = '';
    const isMulti = event.isMultiDay || (event.endDate && event.endDate !== event.date);
    if (isMulti) {
      const startObj = new Date(event.date + 'T12:00:00');
      const startFormatted = startObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endObj = new Date(event.endDate + 'T12:00:00');
      const endFormatted = endObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dateLabel = `${startFormatted} – ${endFormatted}`;
    } else {
      if (event.date === currentDate) {
        dateLabel = 'Today';
      } else if (event.date === dateKeyFrom(currentDate, 1)) {
        dateLabel = 'Tomorrow';
      } else if (event.date === dateKeyFrom(currentDate, 2)) {
        dateLabel = 'In 2 days';
      } else {
        dateLabel = fmtShort(event.date);
      }
    }

    const timeLabel = event.time ? formatTimeStr(event.time) : '';
    const dateAndTime = timeLabel ? `${dateLabel} · ${timeLabel}` : dateLabel;

    let checkboxHtml = '';
    if (event.type === 'deadline' || event.type === 'reminder') {
      checkboxHtml = `<input type="checkbox" class="event-complete-checkbox" ${event.isCompleted ? 'checked' : ''} style="margin: 0; cursor: pointer; accent-color: var(--color-accent); flex-shrink: 0;" />`;
    }

    item.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; flex: 1;">
        ${checkboxHtml}
        <span style="font-size: 14px; flex-shrink: 0;">${icon}</span>
        <span style="font-size: 13px; font-weight: 500; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escHtml(event.title)}</span>
      </div>
      <span style="font-size: 11px; font-weight: 600; color: var(--color-text-muted); white-space: nowrap; flex-shrink: 0;">${dateAndTime}</span>
    `;

    const chk = item.querySelector('.event-complete-checkbox');
    if (chk) {
      chk.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isCompleted = chk.checked;
        await toggleFixedEventComplete(userId, event.id, isCompleted);
        await refreshActiveTab();
      });
    }

    item.addEventListener('click', () => {
      openFixedEventModal(event, async () => {
        await refreshActiveTab();
      }, async () => {
        await refreshActiveTab();
      });
    });

    listContainer.appendChild(item);
  });
}

async function renderCountdownBanners() {
  const container = document.getElementById('day-countdown-banners-container');
  if (!container) return;

  const auth = await getAuth();
  const userId = auth?.localId || '';
  const events = await getUpcomingFixedEvents(userId, currentDate, 3);
  const filteredEvents = events.filter(e => e.type === 'deadline' || e.type === 'appointment');

  container.innerHTML = '';

  if (filteredEvents.length === 0) {
    return;
  }

  filteredEvents.forEach(event => {
    const sessionKey = `dismissed_event_${event.id}_${currentDate}`;
    if (sessionStorage.getItem(sessionKey)) {
      return;
    }

    const banner = document.createElement('div');
    banner.className = `countdown-banner ${event.type}`;
    banner.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-radius: 6px; background: var(--color-surface); border: 1px solid var(--color-border); border-left-width: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.02); font-size: 13px; font-weight: 500; margin-bottom: 6px;';
    
    if (event.type === 'deadline') {
      banner.style.borderLeftColor = '#ef4444';
    } else if (event.type === 'appointment') {
      banner.style.borderLeftColor = '#3b82f6';
    }

    let icon = event.type === 'deadline' ? '⏰' : '📅';
    
    let relText = '';
    if (event.date === currentDate) {
      relText = 'today';
    } else if (event.date === dateKeyFrom(currentDate, 1)) {
      relText = 'tomorrow';
    } else if (event.date === dateKeyFrom(currentDate, 2)) {
      relText = 'in 2 days';
    }

    const weekdayStr = new Date(event.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
    const monthAndDay = fmtShort(event.date);
    const timeLabel = event.time ? ` · ${formatTimeStr(event.time)}` : '';
    const dateDetails = `(${weekdayStr}, ${monthAndDay}${timeLabel})`;

    const typeCapitalized = event.type.charAt(0).toUpperCase() + event.type.slice(1);
    
    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span>${icon}</span>
        <span>
          <strong style="color: var(--color-text);">${typeCapitalized} ${relText}</strong> — 
          <span class="countdown-title" style="color: var(--color-text); cursor: pointer; text-decoration: underline;">${escHtml(event.title)}</span> 
          <span style="color: var(--color-text-muted); font-size: 12px; margin-left: 4px;">${dateDetails}</span>
        </span>
      </div>
      <button class="btn-close-banner" style="background: none; border: none; cursor: pointer; color: var(--color-text-muted); font-size: 14px; padding: 4px; display: flex; align-items: center; justify-content: center; border-radius: 4px;" title="Dismiss">✕</button>
    `;

    banner.querySelector('.btn-close-banner').addEventListener('click', () => {
      sessionStorage.setItem(sessionKey, 'true');
      banner.remove();
    });

    banner.querySelector('.countdown-title').addEventListener('click', () => {
      openFixedEventModal(event, async () => {
        await refreshActiveTab();
      }, async () => {
        await refreshActiveTab();
      });
    });

    container.appendChild(banner);
  });
}

async function renderMonthSidebarFixedEvents() {
  const listContainer = document.getElementById('month-fixed-events-list');
  if (!listContainer) return;

  const auth = await getAuth();
  const userId = auth?.localId || '';
  const events = await getFixedEventsForMonth(userId, currentYear, currentMonth);

  events.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (!a.time) return -1;
    if (!b.time) return 1;
    return a.time.localeCompare(b.time);
  });

  listContainer.innerHTML = '';
  if (events.length === 0) {
    listContainer.innerHTML = `<div style="text-align: center; color: var(--color-text-muted); font-size: 12px; padding: 20px 0;">No fixed events.</div>`;
    return;
  }

  events.forEach(event => {
    const item = document.createElement('div');
    const completedClass = event.isCompleted ? ' completed' : '';
    item.className = `month-sidebar-event-item${completedClass}`;
    item.style.cssText = 'display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 6px; background: var(--color-bg); border-left: 3px solid; cursor: pointer; transition: background 150ms; margin-bottom: 6px;';
    
    if (event.type === 'deadline') {
      item.style.borderLeftColor = '#ef4444';
    } else if (event.type === 'appointment') {
      item.style.borderLeftColor = '#3b82f6';
    } else {
      item.style.borderLeftColor = '#f59e0b';
    }

    item.addEventListener('mouseenter', () => { item.style.background = 'var(--color-border)'; });
    item.addEventListener('mouseleave', () => { item.style.background = 'var(--color-bg)'; });

    let icon = '🔔';
    if (event.type === 'deadline') icon = '⏰';
    else if (event.type === 'appointment') icon = '📅';

    const startObj = new Date(event.date + 'T12:00:00');
    const startFormatted = startObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    let dateStr = startFormatted;
    const isMulti = event.isMultiDay || (event.endDate && event.endDate !== event.date);
    if (isMulti && event.endDate) {
      const endObj = new Date(event.endDate + 'T12:00:00');
      const endFormatted = endObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dateStr = `${startFormatted} – ${endFormatted}`;
    }

    const timeStr = event.time ? `, ${formatTimeStr(event.time)}` : '';

    let checkboxHtml = '';
    if (event.type === 'deadline' || event.type === 'reminder') {
      checkboxHtml = `<input type="checkbox" class="event-complete-checkbox" ${event.isCompleted ? 'checked' : ''} style="margin: 0; margin-top: 2px; cursor: pointer; accent-color: var(--color-accent); flex-shrink: 0;" />`;
    }

    item.innerHTML = `
      <div style="display: flex; gap: 8px; align-items: flex-start; overflow: hidden; flex: 1;">
        ${checkboxHtml}
        <span style="font-size: 14px; flex-shrink: 0; margin-top: 1px;">${icon}</span>
        <div style="display: flex; flex-direction: column; overflow: hidden;">
          <span style="font-size: 13px; font-weight: 500; color: var(--color-text); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escHtml(event.title)}</span>
          <span style="font-size: 11px; color: var(--color-text-muted); margin-top: 2px;">${dateStr}${timeStr}</span>
        </div>
      </div>
    `;

    const chk = item.querySelector('.event-complete-checkbox');
    if (chk) {
      chk.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isCompleted = chk.checked;
        await toggleFixedEventComplete(userId, event.id, isCompleted);
        await refreshActiveTab();
      });
    }

    item.addEventListener('click', () => {
      openFixedEventModal(event, async () => {
        await refreshActiveTab();
      }, async () => {
        await refreshActiveTab();
      });
    });

    listContainer.appendChild(item);
  });
}

// Category pills


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
  // Update progress card
  const { total: totalTasks, completed: completedTasks } = getTaskCompletionStats(tasks);
  updateDailyProgressCard(totalTasks, completedTasks);

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
    const isQuickAddExpanded = expandedQuickAdds.includes(cat);

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
          ${catTasks.map((t) => {
            const isSubtaskExpanded = expandedSubtaskAdds.includes(t.id);
            return `
              <div class="priority-item-container" style="border-bottom: 1px solid var(--color-border); padding: 7px 0; display: flex; flex-direction: column;">
                <div class="priority-item" data-id="${t.id}" draggable="true" style="border-bottom: none; padding: 0; cursor: grab;">
                  <input type="checkbox" class="priority-item-check" data-id="${t.id}" ${t.done ? 'checked' : ''} />
                  <div class="priority-dot" data-p="${t.priority ?? 3}" style="flex-shrink:0;"></div>
                  <span class="priority-item-title${t.done ? ' done-text' : ''}" data-id="${t.id}">${escHtml(t.title)}</span>
                  ${t.timeEstimate ? `<span class="priority-item-est">${t.timeEstimate}m</span>` : ''}
                  
                  <div class="priority-item-add-subtask" data-id="${t.id}" title="Add Subtask">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2.5"
                         stroke-linecap="round" stroke-linejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  </div>

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
                
                <div class="subtask-quick-add-form" data-task-id="${t.id}" style="display: ${isSubtaskExpanded ? 'flex' : 'none'}; margin-left: 28px; margin-top: 6px; align-items: center; gap: 6px;">
                  <input type="text" class="input input-sm subtask-quick-add-input" placeholder="New subtask..." data-task-id="${t.id}" style="flex: 1; font-size: 11px; padding: 2px 6px; height: 22px;" />
                  <button class="btn btn-primary btn-sm subtask-quick-add-btn" data-task-id="${t.id}" style="padding: 2px 8px; font-size: 11px; height: 22px; line-height: 1;">Add</button>
                  <button class="btn btn-ghost btn-sm subtask-quick-add-cancel" data-task-id="${t.id}" style="padding: 2px; color: var(--color-text-muted);" title="Cancel">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
          <div class="category-quick-add-toggle" data-category="${escHtml(cat)}" style="display: ${isQuickAddExpanded ? 'none' : 'flex'}; padding: 6px 0; color: var(--color-text-muted); cursor: pointer; font-size: 12px; align-items: center; gap: 4px; border-top: 1px dashed var(--color-border); margin-top: 4px; user-select: none;">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Add task</span>
          </div>
          <div class="category-quick-add-form" data-category="${escHtml(cat)}" style="display: ${isQuickAddExpanded ? 'flex' : 'none'}; border-top: 1px solid var(--color-border); padding: 8px 0; gap: 8px; align-items: center; margin-top: 4px;">
            <input type="text" class="input input-sm category-quick-add-input" placeholder="Add a task..." data-category="${escHtml(cat)}" style="flex: 1;" />
            <button class="btn btn-primary btn-sm category-quick-add-btn" data-category="${escHtml(cat)}">Add</button>
            <button class="btn btn-ghost btn-sm category-quick-add-cancel" data-category="${escHtml(cat)}" style="padding: 4px 8px; color: var(--color-text-muted);" title="Collapse">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  if (renderedCount === 0) {
    priorityList.innerHTML = `<div style="font-size:13px;color:var(--color-text-muted);padding:12px;text-align:center;font-style:italic;">No tasks today — add one below</div>`;
    return;
  }

  priorityList.innerHTML = html;

  // Restore focus to the quick add input if we just added a task to a category
  if (lastAddedCategory) {
    const activeInput = priorityList.querySelector(`.category-quick-add-input[data-category="${lastAddedCategory.replace(/"/g, '\\"')}"]`);
    if (activeInput) {
      activeInput.focus();
    }
    lastAddedCategory = null;
  }

  // Restore focus to the subtask quick add input if we just added a subtask
  if (lastAddedSubtaskTaskId) {
    const activeInput = priorityList.querySelector(`.subtask-quick-add-input[data-task-id="${lastAddedSubtaskTaskId.replace(/"/g, '\\"')}"]`);
    if (activeInput) {
      activeInput.focus();
    }
    lastAddedSubtaskTaskId = null;
  }

  // Quick add to category handlers
  priorityList.querySelectorAll('.category-quick-add-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const cat = toggle.dataset.category;
      if (!expandedQuickAdds.includes(cat)) {
        expandedQuickAdds.push(cat);
      }
      const groupEl = toggle.closest('.category-group');
      const formEl = groupEl.querySelector('.category-quick-add-form');
      const inputEl = groupEl.querySelector('.category-quick-add-input');
      toggle.style.display = 'none';
      if (formEl) formEl.style.display = 'flex';
      if (inputEl) inputEl.focus();
    });
  });

  priorityList.querySelectorAll('.category-quick-add-cancel').forEach((cancel) => {
    cancel.addEventListener('click', () => {
      const cat = cancel.dataset.category;
      expandedQuickAdds = expandedQuickAdds.filter(c => c !== cat);
      const groupEl = cancel.closest('.category-group');
      const formEl = groupEl.querySelector('.category-quick-add-form');
      const toggleEl = groupEl.querySelector('.category-quick-add-toggle');
      const inputEl = groupEl.querySelector('.category-quick-add-input');
      if (inputEl) inputEl.value = '';
      if (formEl) formEl.style.display = 'none';
      if (toggleEl) toggleEl.style.display = 'flex';
    });
  });

  priorityList.querySelectorAll('.category-quick-add-input').forEach((input) => {
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const cat = input.dataset.category;
        const title = input.value.trim();
        if (!title) return;
        
        lastAddedCategory = cat;
        await addTask(currentDate, {
          id: generateId(),
          title,
          done: false,
          priority: selectedPriority || 3,
          timeEstimate: null,
          category: cat,
        });
        
        await renderPriorityList();
      } else if (e.key === 'Escape') {
        const cat = input.dataset.category;
        expandedQuickAdds = expandedQuickAdds.filter(c => c !== cat);
        const groupEl = input.closest('.category-group');
        const formEl = groupEl.querySelector('.category-quick-add-form');
        const toggleEl = groupEl.querySelector('.category-quick-add-toggle');
        input.value = '';
        if (formEl) formEl.style.display = 'none';
        if (toggleEl) toggleEl.style.display = 'flex';
      }
    });
  });

  priorityList.querySelectorAll('.category-quick-add-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cat = btn.dataset.category;
      const groupEl = btn.closest('.category-group');
      const input = groupEl ? groupEl.querySelector('.category-quick-add-input') : null;
      if (!input) return;
      const title = input.value.trim();
      if (!title) return;
      
      lastAddedCategory = cat;
      await addTask(currentDate, {
        id: generateId(),
        title,
        done: false,
        priority: selectedPriority || 3,
        timeEstimate: null,
        category: cat,
      });
      
      await renderPriorityList();
    });
  });

  // Quick add to subtasks handlers
  priorityList.querySelectorAll('.priority-item-add-subtask').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.id;
      if (!expandedSubtaskAdds.includes(taskId)) {
        expandedSubtaskAdds.push(taskId);
      }
      const containerEl = btn.closest('.priority-item-container');
      const formEl = containerEl ? containerEl.querySelector('.subtask-quick-add-form') : null;
      const inputEl = containerEl ? containerEl.querySelector('.subtask-quick-add-input') : null;
      if (formEl) formEl.style.display = 'flex';
      if (inputEl) inputEl.focus();
    });
  });

  priorityList.querySelectorAll('.subtask-quick-add-cancel').forEach((cancel) => {
    cancel.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = cancel.dataset.taskId;
      expandedSubtaskAdds = expandedSubtaskAdds.filter(id => id !== taskId);
      const containerEl = cancel.closest('.priority-item-container');
      const formEl = containerEl ? containerEl.querySelector('.subtask-quick-add-form') : null;
      const inputEl = containerEl ? containerEl.querySelector('.subtask-quick-add-input') : null;
      if (inputEl) inputEl.value = '';
      if (formEl) formEl.style.display = 'none';
    });
  });

  priorityList.querySelectorAll('.subtask-quick-add-input').forEach((input) => {
    input.addEventListener('keydown', async (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const taskId = input.dataset.taskId;
        const title = input.value.trim();
        if (!title) return;
        
        const tasks = await getTasks(currentDate);
        const t = tasks.find(x => x.id === taskId);
        if (t) {
          t.subtasks = t.subtasks || [];
          t.subtasks.push({
            id: generateId(),
            title,
            done: false
          });
          await updateTask(currentDate, taskId, { subtasks: t.subtasks });
          lastAddedSubtaskTaskId = taskId;
          await renderPriorityList();
        }
      } else if (e.key === 'Escape') {
        const taskId = input.dataset.taskId;
        expandedSubtaskAdds = expandedSubtaskAdds.filter(id => id !== taskId);
        const containerEl = input.closest('.priority-item-container');
        const formEl = containerEl ? containerEl.querySelector('.subtask-quick-add-form') : null;
        input.value = '';
        if (formEl) formEl.style.display = 'none';
      }
    });
  });

  priorityList.querySelectorAll('.subtask-quick-add-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.taskId;
      const containerEl = btn.closest('.priority-item-container');
      const input = containerEl ? containerEl.querySelector('.subtask-quick-add-input') : null;
      if (!input) return;
      const title = input.value.trim();
      if (!title) return;
      
      const tasks = await getTasks(currentDate);
      const t = tasks.find(x => x.id === taskId);
      if (t) {
        t.subtasks = t.subtasks || [];
        t.subtasks.push({
          id: generateId(),
          title,
          done: false
        });
        await updateTask(currentDate, taskId, { subtasks: t.subtasks });
        lastAddedSubtaskTaskId = taskId;
        await renderPriorityList();
      }
    });
  });

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
      const isChecked = cb.checked;
      const taskId = cb.dataset.id;
      const tasks = await getTasks(currentDate);
      
      const statsBefore = getTaskCompletionStats(tasks);

      await updateTask(currentDate, taskId, { done: isChecked });
      
      const updatedTasks = await getTasks(currentDate);
      const statsAfter = getTaskCompletionStats(updatedTasks);
      
      if (isChecked && statsAfter.completed === statsAfter.total && statsBefore.completed < statsBefore.total && statsBefore.total > 0) {
        triggerConfettiCelebration();
      }

      await renderPriorityList();
    });
  });

  // Subtask checkbox toggles
  priorityList.querySelectorAll('.subtask-item-check').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const taskId = cb.dataset.taskId;
      const subId = cb.dataset.subId;
      const isChecked = cb.checked;
      const tasks = await getTasks(currentDate);
      
      const statsBefore = getTaskCompletionStats(tasks);

      const t = tasks.find(x => x.id === taskId);
      if (t && t.subtasks) {
        const sub = t.subtasks.find(s => s.id === subId);
        if (sub) {
          sub.done = isChecked;
          await updateTask(currentDate, taskId, { subtasks: t.subtasks });
          
          const updatedTasks = await getTasks(currentDate);
          const statsAfter = getTaskCompletionStats(updatedTasks);
          
          if (isChecked && statsAfter.completed === statsAfter.total && statsBefore.completed < statsBefore.total && statsBefore.total > 0) {
            triggerConfettiCelebration();
          }

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

// Habit edit confirmation modal selectors
const habitConfirmModalOverlay = document.getElementById('habit-confirm-modal-overlay');
const habitConfirmModalClose   = document.getElementById('habit-confirm-modal-close');
const btnHabitConfirmCancel    = document.getElementById('btn-habit-confirm-cancel');
const btnHabitConfirmSave      = document.getElementById('btn-habit-confirm-save');

// Subtasks modal selectors
const taskSubtaskInput = document.getElementById('task-subtask-input');
const btnAddSubtask    = document.getElementById('btn-add-subtask');
const modalSubtasksList= document.getElementById('modal-subtasks-list');
const subtaskProgress  = document.getElementById('subtask-progress');

let editingTask = null;
let editingSubtasks = [];
let editingTaskDate = null;

function openTaskModal(task = null, date = null) {
  editingTask = task;
  editingTaskDate = date;
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
  editingTaskDate = null;
}

function closeHabitConfirmModal() {
  habitConfirmModalOverlay.classList.add('hidden');
}

async function saveTask() {
  const title = taskTitleInput.value.trim();
  if (!title) { taskTitleInput.focus(); return; }
  const priority    = parseInt(taskPriorityInput.value, 10) || 1;
  const category    = taskCategoryInput.value;
  const timeEstimate= parseInt(taskEstimateInput.value, 10) || null;
  const subtasks    = editingSubtasks;

  const targetDate = editingTaskDate || currentDate;

  if (editingTask) {
    if (editingTask.habitId) {
      const titleChanged = title !== editingTask.title;
      const priorityChanged = priority !== editingTask.priority;
      const categoryChanged = category !== editingTask.category;
      const estimateChanged = timeEstimate !== editingTask.timeEstimate;
      const subtasksChanged = JSON.stringify(subtasks) !== JSON.stringify(editingTask.subtasks || []);
      
      if (titleChanged || priorityChanged || categoryChanged || estimateChanged || subtasksChanged) {
        habitConfirmModalOverlay.classList.remove('hidden');
        btnHabitConfirmSave.onclick = async () => {
          const editMode = document.querySelector('input[name="habit-edit-mode"]:checked').value;
          await updateTask(targetDate, editingTask.id, { title, priority, timeEstimate, category, subtasks }, editMode);
          closeHabitConfirmModal();
          closeTaskModal();
          await refreshActiveTab();
          try {
            await chrome.runtime.sendMessage({ type: 'SYNC_HABITS' });
          } catch (e) {}
        };
        return;
      }
    }
    await updateTask(targetDate, editingTask.id, { title, priority, timeEstimate, category, subtasks });
  } else {
    await addTask(targetDate, {
      id: generateId(), title, done: false, priority, timeEstimate, category, subtasks,
    });
  }
  closeTaskModal();
  await refreshActiveTab();
}

async function refreshActiveTab() {
  if (activeTab === 'day') {
    await renderPriorityList();
    await renderDayFixedEvents();
    await renderDaySidebarFixedEvents();
    await renderCountdownBanners();
  } else if (activeTab === 'week') {
    await renderWeekTab();
  } else if (activeTab === 'month') {
    await renderMonthTab();
  } else if (activeTab === 'year') {
    await renderYearTab();
  }
}

taskModalClose.addEventListener('click', closeTaskModal);
btnTaskCancel.addEventListener('click', closeTaskModal);
btnTaskSave.addEventListener('click', saveTask);
taskModalOverlay.addEventListener('click', (e) => { if (e.target === taskModalOverlay) closeTaskModal(); });

habitConfirmModalClose.addEventListener('click', closeHabitConfirmModal);
btnHabitConfirmCancel.addEventListener('click', closeHabitConfirmModal);
habitConfirmModalOverlay.addEventListener('click', (e) => { if (e.target === habitConfirmModalOverlay) closeHabitConfirmModal(); });

btnTaskDelete.addEventListener('click', async () => {
  if (!editingTask) return;
  const targetDate = editingTaskDate || currentDate;
  await deleteTask(targetDate, editingTask.id);
  closeTaskModal();
  await refreshActiveTab();
});
taskTitleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); saveTask(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!habitConfirmModalOverlay.classList.contains('hidden')) {
      closeHabitConfirmModal();
    } else if (!taskModalOverlay.classList.contains('hidden')) {
      closeTaskModal();
    }
  }
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
        showAlert('Category name already exists or is invalid.', 'Invalid Category Name');
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
      const isConfirmed = await showConfirm(
        `Are you sure you want to delete the category "${catToDelete}"? (Tasks in this category will display under "Personal")`,
        'Delete Category'
      );
      if (isConfirmed) {
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
    showAlert('Category name already exists or is invalid.', 'Invalid Category Name');
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
const btnGoThisWeek = document.getElementById('btn-go-this-week');

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

btnGoThisWeek.addEventListener('click', () => {
  currentWeekStart = getMondayOf(TODAY);
  renderWeekTab();
});

async function renderWeekTab() {
  const dates   = getWeekDates(currentWeekStart);
  const lastDay = dates[6];

  if (btnGoThisWeek) {
    btnGoThisWeek.classList.toggle('hidden', currentWeekStart === getMondayOf(TODAY));
  }

  weekNavTitle.textContent = `${fmtShort(dates[0])} – ${fmtShort(lastDay)}, ${new Date(dates[0] + 'T12:00:00').getFullYear()}`;

  const auth = await getAuth();
  const userId = auth?.localId || '';

  // Load tasks and fixed events for all 7 days in parallel
  const [tasksByDay, fixedEventsByDay] = await Promise.all([
    Promise.all(dates.map((d) => getTasks(d))),
    Promise.all(dates.map((d) => getFixedEventsForDate(userId, d)))
  ]);

  // Calculate and update weekly progress
  let totalWeeklyTasks = 0;
  let completedWeeklyTasks = 0;
  tasksByDay.forEach(dayTasks => {
    const stats = getTaskCompletionStats(dayTasks);
    totalWeeklyTasks += stats.total;
    completedWeeklyTasks += stats.completed;
  });
  const weeklyPercent = totalWeeklyTasks > 0 ? Math.round((completedWeeklyTasks / totalWeeklyTasks) * 100) : 0;
  const weekProgressText = document.getElementById('week-progress-text');
  const weekProgressBarFill = document.getElementById('week-progress-bar-fill');
  if (weekProgressText && weekProgressBarFill) {
    weekProgressText.textContent = `Progress: ${weeklyPercent}% (${completedWeeklyTasks}/${totalWeeklyTasks})`;
    weekProgressBarFill.style.width = `${weeklyPercent}%`;
  }

  weekGrid.innerHTML = '';

  const multiDayContainer = document.getElementById('week-multi-day-container');
  if (multiDayContainer) {
    multiDayContainer.innerHTML = '';
    multiDayContainer.classList.add('hidden');
    
    // Gather all unique events across the week
    const allWeekEvents = [];
    const seenIds = new Set();
    fixedEventsByDay.forEach(dayEvents => {
      dayEvents.forEach(event => {
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          allWeekEvents.push(event);
        }
      });
    });
    
    // Filter only multi-day events
    const multiDayEvents = allWeekEvents.filter(event => {
      return event.isMultiDay || (event.endDate && event.endDate !== event.date);
    });
    
    if (multiDayEvents.length > 0) {
      multiDayContainer.classList.remove('hidden');
      
      // Sort multi-day events by start date and end date
      multiDayEvents.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (a.endDate || a.date).localeCompare(b.endDate || b.date);
      });
      
      const rowOccupancy = []; // Array of arrays of 7 booleans
      
      multiDayEvents.forEach(event => {
        const startIdx = dates.indexOf(event.date);
        const endIdx = dates.indexOf(event.endDate);
        
        const startCol = startIdx !== -1 ? startIdx + 1 : 1;
        const endCol = endIdx !== -1 ? endIdx + 2 : 8;
        
        let assignedRow = 0;
        for (let r = 0; r < rowOccupancy.length; r++) {
          let fits = true;
          for (let c = startCol - 1; c < endCol - 1; c++) {
            if (rowOccupancy[r][c]) {
              fits = false;
              break;
            }
          }
          if (fits) {
            assignedRow = r;
            break;
          }
        }
        
        if (assignedRow === rowOccupancy.length) {
          rowOccupancy.push(new Array(7).fill(false));
        }
        for (let c = startCol - 1; c < endCol - 1; c++) {
          rowOccupancy[assignedRow][c] = true;
        }
        
        const bar = document.createElement('div');
        const completedClass = event.isCompleted ? ' completed' : '';
        bar.className = `fixed-event-bar ${event.type}${completedClass}`;
        
        bar.style.gridColumnStart = startCol;
        bar.style.gridColumnEnd = endCol;
        bar.style.gridRowStart = assignedRow + 1;
        
        const leftRound = (startIdx !== -1);
        const rightRound = (endIdx !== -1);
        
        bar.style.borderTopLeftRadius = leftRound ? '4px' : '0';
        bar.style.borderBottomLeftRadius = leftRound ? '4px' : '0';
        bar.style.borderTopRightRadius = rightRound ? '4px' : '0';
        bar.style.borderBottomRightRadius = rightRound ? '4px' : '0';
        
        bar.style.marginLeft = leftRound ? '4px' : '0';
        bar.style.marginRight = rightRound ? '4px' : '0';
        
        let icon = '🔔';
        if (event.type === 'deadline') icon = '⏰';
        else if (event.type === 'appointment') icon = '📅';
        
        const timeStr = event.time ? formatTimeStr(event.time) : 'All Day';
        bar.innerHTML = `<span>${icon}</span> <span style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escHtml(event.title)}</span> <span style="opacity: 0.6; margin-left: 2px; font-size: 9px; white-space: nowrap;">· ${timeStr}</span>`;
        
        bar.addEventListener('click', (e) => {
          e.stopPropagation();
          openFixedEventModal(event, async () => {
            await refreshActiveTab();
          }, async () => {
            await refreshActiveTab();
          });
        });
        
        multiDayContainer.appendChild(bar);
      });
    }
  }

  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  dates.forEach((date, i) => {
    const isToday  = date === TODAY;
    const isWeekend = i === 5 || i === 6;
    const dateObj  = new Date(date + 'T12:00:00');
    const dateNum  = dateObj.getDate();
    const tasks    = tasksByDay[i];

    const col = document.createElement('div');
    col.className = `week-col${isWeekend ? ' is-weekend' : ''}`;

    const hdrClass = `week-col-header${isToday ? ' is-today' : ''}${isWeekend ? ' is-weekend' : ''}`;
    const numClass = `week-day-num${isToday ? ' is-today-num' : ''}${isWeekend ? ' is-weekend-num' : ''}`;

    const stats = getTaskCompletionStats(tasks);
    const dayTotal = stats.total;
    const dayCompleted = stats.completed;
    const dayPercent = dayTotal > 0 ? Math.round((dayCompleted / dayTotal) * 100) : 0;

    let holidayHtml = '';
    if (showSlHolidays) {
      const holiday = getSriLankanHoliday(date);
      if (holiday) {
        holidayHtml = `<div class="week-col-holiday" title="${holiday.name}">${holiday.emoji} ${holiday.name}</div>`;
      }
    }

    col.innerHTML = `
      <div class="${hdrClass}" data-date="${date}">
        <span class="week-day-name">${DAY_LABELS[i]}</span>
        <span class="${numClass}">${dateNum}</span>
        ${holidayHtml}
        ${dayTotal > 0 ? `
          <div class="week-day-progress-bar-bg" title="${dayCompleted} of ${dayTotal} tasks completed">
            <div class="week-day-progress-bar-fill ${dayPercent === 100 ? 'completed' : ''}" style="width: ${dayPercent}%"></div>
          </div>
        ` : ''}
      </div>
      <div class="week-fixed-events-cell" id="wfe-${date}"></div>
      <div class="week-task-list" id="wt-${date}"></div>
      <div class="week-add-row">
        <input type="text" class="week-add-input" data-date="${date}" placeholder="+ Add task…" maxlength="200" />
        <button class="week-add-btn" data-date="${date}">+</button>
      </div>
    `;

    // Render week fixed events
    const feCell = col.querySelector(`#wfe-${date}`);
    const dayFixedEvents = (fixedEventsByDay[i] || []).filter(event => {
      const isMulti = event.isMultiDay || (event.endDate && event.endDate !== event.date);
      return !isMulti;
    });
    dayFixedEvents.forEach(event => {
      const chip = document.createElement('div');
      const completedClass = event.isCompleted ? ' completed' : '';
      chip.className = `fixed-event-chip ${event.type}${completedClass}`;
      chip.style.cssText = 'padding: 2px 6px; font-size: 10px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; border: 1.5px solid; cursor: pointer; max-width: 100%; box-sizing: border-box; overflow: hidden; margin-bottom: 2px;';
      
      let icon = '🔔';
      if (event.type === 'deadline') icon = '⏰';
      else if (event.type === 'appointment') icon = '📅';

      const timeStr = event.time ? formatTimeStr(event.time) : 'All Day';
      chip.innerHTML = `<span>${icon}</span> <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60px;">${escHtml(event.title)}</span> <span style="opacity: 0.6; margin-left: 2px; font-size: 9px; white-space: nowrap;">· ${timeStr}</span>`;
      
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        openFixedEventModal(event, async () => {
          await refreshActiveTab();
        }, async () => {
          await refreshActiveTab();
        });
      });
      
      feCell.appendChild(chip);
    });

    // Click header → go to day
    col.querySelector('.week-col-header').addEventListener('click', () => {
      currentDate = date;
      goToDay(date);
    });

    // Drag-and-drop column listeners
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });

    col.addEventListener('dragenter', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });

    col.addEventListener('dragleave', () => {
      col.classList.remove('drag-over');
    });

    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        if (data && data.id && data.sourceDate) {
          const targetDate = date;
          if (data.sourceDate === targetDate) return;

          const sourceTasks = await getTasks(data.sourceDate);
          const taskToMove = sourceTasks.find(t => t.id === data.id);
          if (taskToMove) {
            await deleteTask(data.sourceDate, data.id);
            await addTask(targetDate, taskToMove);
            renderWeekTab();
          }
        }
      } catch (err) {
        console.error('Drag and drop error:', err);
      }
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
    <div class="week-task-item" data-id="${t.id}" data-date="${date}" draggable="true">
      <input type="checkbox" class="week-task-check" data-id="${t.id}" data-date="${date}" ${t.done ? 'checked' : ''} />
      <span class="week-task-title${t.done ? ' done-text' : ''}" data-id="${t.id}" data-date="${date}">${escHtml(t.title)}</span>
      <div class="week-task-actions">
        ${!t.done ? `
          <button class="week-action-btn carry" data-id="${t.id}" data-date="${date}" title="Carry to next day">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
            </svg>
          </button>
        ` : ''}
        <button class="week-action-btn edit" data-id="${t.id}" data-date="${date}" title="Edit task">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/>
          </svg>
        </button>
        <button class="week-action-btn delete" data-id="${t.id}" data-date="${date}" title="Delete task">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');

  // Checkbox
  container.querySelectorAll('.week-task-check').forEach((cb) => {
    cb.addEventListener('change', async () => {
      await updateTask(cb.dataset.date, cb.dataset.id, { done: cb.checked });
      renderWeekTab();
    });
  });

  // Title click opens edit modal
  container.querySelectorAll('.week-task-title').forEach((titleEl) => {
    titleEl.addEventListener('click', () => {
      const task = sorted.find((x) => x.id === titleEl.dataset.id);
      if (task) openTaskModal(task, titleEl.dataset.date);
    });
  });

  // Edit button
  container.querySelectorAll('.week-action-btn.edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const task = sorted.find((x) => x.id === btn.dataset.id);
      if (task) openTaskModal(task, btn.dataset.date);
    });
  });

  // Delete button
  container.querySelectorAll('.week-action-btn.delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const isConfirmed = await showConfirm('Are you sure you want to delete this task?', 'Delete Task');
      if (isConfirmed) {
        await deleteTask(btn.dataset.date, btn.dataset.id);
        renderWeekTab();
      }
    });
  });

  // Carry forward
  container.querySelectorAll('.week-action-btn.carry').forEach((btn) => {
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

  // Drag listeners
  container.querySelectorAll('.week-task-item').forEach((item) => {
    item.addEventListener('dragstart', (e) => {
      const taskId = item.dataset.id;
      const sourceDate = item.dataset.date;
      e.dataTransfer.setData('text/plain', JSON.stringify({ id: taskId, sourceDate }));
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
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

const monthGrid       = document.getElementById('month-grid');
const monthNavTitle   = document.getElementById('month-nav-title');
const btnPrevMonth    = document.getElementById('btn-prev-month');
const btnNextMonth    = document.getElementById('btn-next-month');
const btnGoThisMonth   = document.getElementById('btn-go-this-month');

// New Month Tab selectors
const monthStatsBanner   = document.getElementById('month-stats-banner');
const monthGoalsSidebar  = document.getElementById('month-goals-sidebar');
const monthGoalsList     = document.getElementById('month-goals-list');
const monthGoalInput     = document.getElementById('month-goal-input');
const btnAddMonthGoal    = document.getElementById('btn-add-month-goal');
const monthHoverPreview  = document.getElementById('month-hover-preview');

let tooltipTimeout = null;

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

btnGoThisMonth.addEventListener('click', () => {
  const d = new Date();
  currentMonth = d.getMonth();
  currentYear = d.getFullYear();
  renderMonthTab();
});

// Sidebar goals interactions
btnAddMonthGoal.addEventListener('click', addMonthGoal);
monthGoalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addMonthGoal();
  }
});

async function addMonthGoal() {
  const text = monthGoalInput.value.trim();
  if (!text) return;
  const themes = await getYearlyThemes();
  const currentTheme = themes.find(t => t.month === (currentMonth + 1));
  const goals = currentTheme?.goals ?? [];
  const updatedGoals = [...goals, { text, completed: false }];
  await setMonthGoals(currentMonth + 1, updatedGoals);
  monthGoalInput.value = '';
  renderMonthGoals();
  if (activeTab === 'year') {
    renderYearTab();
  }
}

async function renderMonthGoals() {
  const themes = await getYearlyThemes();
  const currentTheme = themes.find(t => t.month === (currentMonth + 1));
  const goals = currentTheme?.goals ?? [];

  monthGoalsList.innerHTML = '';
  if (goals.length === 0) {
    monthGoalsList.innerHTML = `<div style="text-align: center; color: var(--color-text-muted); font-size: 12px; margin-top: 20px;">No goals set for this month yet.</div>`;
  } else {
    goals.forEach((goal, index) => {
      const item = document.createElement('div');
      item.className = 'month-goal-item';
      item.innerHTML = `
        <input type="checkbox" class="month-goal-checkbox" ${goal.completed ? 'checked' : ''} />
        <span class="month-goal-text ${goal.completed ? 'completed' : ''}">${escHtml(goal.text)}</span>
        <button class="btn btn-ghost btn-xs btn-delete-month-goal" title="Delete goal">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      `;

      // Event listener for toggling completion
      item.querySelector('.month-goal-checkbox').addEventListener('change', async (e) => {
        const updatedGoals = [...goals];
        updatedGoals[index].completed = e.target.checked;
        await setMonthGoals(currentMonth + 1, updatedGoals);
        renderMonthGoals();
        if (activeTab === 'year') {
          renderYearTab();
        }
      });

      // Event listener for delete
      item.querySelector('.btn-delete-month-goal').addEventListener('click', async () => {
        const updatedGoals = [...goals];
        updatedGoals.splice(index, 1);
        await setMonthGoals(currentMonth + 1, updatedGoals);
        renderMonthGoals();
        if (activeTab === 'year') {
          renderYearTab();
        }
      });

      monthGoalsList.appendChild(item);
    });
  }
}

// Tooltip mouse event handlers
monthHoverPreview.addEventListener('mouseenter', () => {
  clearTimeout(tooltipTimeout);
});

monthHoverPreview.addEventListener('mouseleave', () => {
  hideTooltip();
});

async function showTooltip(cell, date) {
  clearTimeout(tooltipTimeout);
  const tasks = await getTasks(date);
  const holiday = showSlHolidays ? getSriLankanHoliday(date) : null;
  
  if ((!tasks || tasks.length === 0) && !holiday) {
    monthHoverPreview.classList.add('hidden');
    return;
  }

  monthHoverPreview.classList.remove('hidden');

  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  
  let holidayBannerHtml = '';
  if (holiday) {
    holidayBannerHtml = `
      <div style="background:rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.2); padding:6px 8px; border-radius:6px; margin-bottom:8px; font-size:11px; font-weight:600; color:#D97706; display:flex; align-items:center; gap:6px;">
        <span>${holiday.emoji}</span>
        <span>${holiday.name}</span>
      </div>
    `;
  }

  monthHoverPreview.innerHTML = `
    <div class="month-preview-title">
      <span>${dateLabel}</span>
      <span style="font-size:10px; opacity:0.8;">${tasks.length} task${tasks.length > 1 ? 's' : ''}</span>
    </div>
    ${holidayBannerHtml}
    <div class="month-preview-list">
      ${tasks.map((task) => {
        const isCompleted = !!task.done;
        return `
          <div class="month-preview-task-item">
            <input type="checkbox" class="month-preview-task-check" data-id="${task.id}" data-date="${date}" ${isCompleted ? 'checked' : ''} />
            <span class="month-preview-task-text ${isCompleted ? 'completed' : ''}">${escHtml(task.title)}</span>
            ${task.category ? `<span class="month-preview-task-cat cat-${task.category.toLowerCase().replace(/\s+/g, '-')}" style="background:var(--cat-${task.category.toLowerCase().replace(/\s+/g, '-')}-bg, var(--color-bg)); color:var(--cat-${task.category.toLowerCase().replace(/\s+/g, '-')}-text, var(--color-text));">${escHtml(task.category)}</span>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Bind checkboxes in tooltip
  monthHoverPreview.querySelectorAll('.month-preview-task-check').forEach(cb => {
    cb.addEventListener('change', async () => {
      const taskId = cb.dataset.id;
      const taskDate = cb.dataset.date;
      const dayTasks = await getTasks(taskDate);
      const task = dayTasks.find(t => t.id === taskId);
      if (task) {
        task.done = cb.checked;
        await updateTask(taskDate, task);
        // Refresh grid + stats + tooltip
        await renderMonthTab();
        // Keep showing the tooltip but updated
        showTooltip(cell, date);
      }
    });
  });

  // Position logic
  const cellRect = cell.getBoundingClientRect();
  let left = cellRect.right + window.scrollX + 5;
  let top = cellRect.top + window.scrollY;

  if (left + 260 > window.innerWidth) {
    left = cellRect.left + window.scrollX - 255;
  }
  
  monthHoverPreview.style.left = `${left}px`;
  monthHoverPreview.style.top = `${top}px`;
}

function hideTooltip() {
  tooltipTimeout = setTimeout(() => {
    monthHoverPreview.classList.add('hidden');
  }, 250);
}

async function renderMonthTab() {
  const realDate = new Date();
  const isThisMonth = currentMonth === realDate.getMonth() && currentYear === realDate.getFullYear();
  if (btnGoThisMonth) {
    btnGoThisMonth.classList.toggle('hidden', isThisMonth);
  }

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

  const auth = await getAuth();
  const userId = auth?.localId || '';

  // Load task + block counts in parallel
  const countData = await Promise.all(
    displayDates.map(async ({ date }) => {
      const [tasks, blocks, fixedEvents] = await Promise.all([
        getTasks(date),
        getBlocks(date),
        getFixedEventsForDate(userId, date)
      ]);
      const stats = getTaskCompletionStats(tasks);
      return {
        tasks: stats.total,
        done:  stats.completed,
        blocks: blocks.length,
        fixedEvents: fixedEvents
      };
    })
  );

  // Render stats banner
  const currentMonthCounts = countData.filter((_, idx) => displayDates[idx].current);
  const totalTasks = currentMonthCounts.reduce((sum, d) => sum + d.tasks, 0);
  const doneTasks  = currentMonthCounts.reduce((sum, d) => sum + d.done, 0);
  const totalBlocks = currentMonthCounts.reduce((sum, d) => sum + d.blocks, 0);
  const percent    = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  monthStatsBanner.innerHTML = `
    <div class="month-stat-card">
      <div class="month-stat-val">${totalTasks}</div>
      <div class="month-stat-lbl">Tasks Planned</div>
    </div>
    <div class="month-stat-card">
      <div class="month-stat-val">${doneTasks}/${totalTasks}</div>
      <div class="month-stat-lbl">Completed (${percent}%)</div>
    </div>
    <div class="month-stat-card">
      <div class="month-stat-val">${totalBlocks}</div>
      <div class="month-stat-lbl">Blocked Hours</div>
    </div>
    <div class="month-stat-progress-bar">
      <div class="month-stat-progress-fill" style="width: ${percent}%"></div>
    </div>
  `;

  // Render month sidebar goals
  await renderMonthGoals();
  await renderMonthSidebarFixedEvents();

  displayDates.forEach(({ date, current }, i) => {
    const counts  = countData[i];
    const isToday = date === TODAY;
    const isWeekend = (i % 7 === 5 || i % 7 === 6);
    const dateNum = new Date(date + 'T12:00:00').getDate();

    const cell = document.createElement('div');
    cell.className = `month-day-cell${isToday ? ' is-today' : ''}${!current ? ' other-month' : ''}${isWeekend ? ' is-weekend' : ''}`;

    const isCompleted = counts.tasks > 0 && counts.done === counts.tasks;

    let holidayHtml = '';
    if (showSlHolidays) {
      const holiday = getSriLankanHoliday(date);
      if (holiday) {
        holidayHtml = `<div class="month-day-holiday" title="${holiday.name}">${holiday.emoji} ${holiday.name}</div>`;
      }
    }

    let fixedEventsHtml = '';
    if (counts.fixedEvents && counts.fixedEvents.length > 0) {
      const maxVisible = 2;
      const visibleEvents = counts.fixedEvents.slice(0, maxVisible);
      const remainingCount = counts.fixedEvents.length - maxVisible;

      const pillsHtml = visibleEvents.map(event => {
        let icon = '🔔';
        if (event.type === 'deadline') icon = '⏰';
        else if (event.type === 'appointment') icon = '📅';

        const timeLabel = event.time ? ` (${formatTimeStr(event.time)})` : '';
        
        const isMulti = event.isMultiDay || (event.endDate && event.endDate !== event.date);
        const isMidRange = isMulti && date !== event.endDate;
        const midRangeClass = isMidRange ? ' mid-range' : '';
        const completedClass = event.isCompleted ? ' completed' : '';

        return `
          <div class="month-event-pill ${event.type}${midRangeClass}${completedClass}" 
               data-event-json="${escHtml(JSON.stringify(event))}"
               title="${escHtml(event.title)}${timeLabel}">
            <span>${icon}</span>
            <span class="month-event-pill-title">${escHtml(event.title)}</span>
          </div>
        `;
      }).join('');

      const remainingHtml = remainingCount > 0 
        ? `<div class="month-event-more">+${remainingCount} more</div>` 
        : '';

      fixedEventsHtml = `
        <div class="month-day-fixed-events-container">
          ${pillsHtml}
          ${remainingHtml}
        </div>
      `;
    }

    cell.innerHTML = `
      <div class="month-day-num">${dateNum}</div>
      ${current ? `<button class="month-day-quick-add" title="Quick Add Task">+</button>` : ''}
      <div class="month-day-badges">
        ${counts.tasks > 0 ? `
          <span class="month-day-progress-badge ${isCompleted ? 'completed' : ''}" title="${counts.done} of ${counts.tasks} tasks completed">
            ${isCompleted ? '✓ Done' : `${counts.done}/${counts.tasks} tasks`}
          </span>
        ` : ''}
        ${counts.blocks > 0 ? `<span class="month-badge month-badge-blocks">${counts.blocks} block${counts.blocks > 1 ? 's' : ''}</span>` : ''}
      </div>
      ${fixedEventsHtml}
      ${holidayHtml}
    `;

    if (current) {
      cell.addEventListener('click', () => {
        currentDate = date;
        goToDay(date);
      });

      const quickAddBtn = cell.querySelector('.month-day-quick-add');
      if (quickAddBtn) {
        quickAddBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openTaskModal(null, date);
        });
      }

      cell.addEventListener('mouseenter', () => {
        showTooltip(cell, date);
      });
      cell.addEventListener('mouseleave', () => {
        hideTooltip();
      });

      // Bind click handlers to event pills
      cell.querySelectorAll('.month-event-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          const eventData = JSON.parse(pill.getAttribute('data-event-json'));
          openFixedEventModal(eventData, async () => {
            await refreshActiveTab();
          }, async () => {
            await refreshActiveTab();
          });
        });
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
  const localEvents = (await get('fixed_events')) || [];
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

      const badgesContainer = document.createElement('div');
      badgesContainer.style.cssText = 'display: flex; align-items: center; gap: 4px;';
      monthHeader.appendChild(badgesContainer);

      if (isCurrent) {
        const badge = document.createElement('span');
        badge.className = 'current-badge';
        badge.textContent = 'Current';
        badgesContainer.appendChild(badge);
      }

      const monthPrefix = `${currentYear}-${String(m).padStart(2, '0')}`;
      const monthEvents = localEvents.filter(e => e.date && e.date.startsWith(monthPrefix));
      if (monthEvents.length > 0) {
        const feBadge = document.createElement('span');
        feBadge.className = 'year-month-fixed-events-badge';
        feBadge.style.cssText = 'font-size: 11px; font-weight: 600; color: var(--color-accent); background: var(--color-accent-soft); padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 2px;';
        feBadge.innerHTML = `📌 ${monthEvents.length}`;
        badgesContainer.appendChild(feBadge);
      }

      card.appendChild(monthHeader);

      const progressContainer = document.createElement('div');
      progressContainer.className = 'year-month-progress-container';
      card.appendChild(progressContainer);

      const goalsContainer = document.createElement('div');
      goalsContainer.className = 'year-month-goals-list';

      const rawList = themeEntry?.goals ?? (themeVal ? [themeVal] : []);
      const goalsList = rawList.map(g => {
        if (typeof g === 'string') return { text: g, completed: false };
        return { text: g.text ?? '', completed: !!g.completed };
      });

      const updateMonthProgressVisual = (currentGoals) => {
        const total = currentGoals.length;
        const completed = currentGoals.filter(g => g.completed).length;
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        
        if (total === 0) {
          progressContainer.innerHTML = '';
          return;
        }

        progressContainer.innerHTML = `
          <div class="year-month-progress-meta">
            <span>Goals Progress</span>
            <span>${completed}/${total} (${percent}%)</span>
          </div>
          <div class="year-month-progress-bar-bg">
            <div class="year-month-progress-bar-fill" style="width: ${percent}%"></div>
          </div>
        `;
      };

      const renderGoals = (currentGoals) => {
        goalsContainer.innerHTML = '';
        updateMonthProgressVisual(currentGoals);
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

// ─── Progress Helpers & Confetti ────────────────────────────────────────────────
function triggerConfettiCelebration() {
  let canvas = document.getElementById('confetti-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'confetti-canvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '10000';
    document.body.appendChild(canvas);
  }
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#3B82F6'];
  const particles = [];
  for (let i = 0; i < 80; i++) {
    particles.push({
      x: canvas.width / 2 + (Math.random() - 0.5) * 60,
      y: canvas.height * 0.4 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 16,
      vy: (Math.random() - 0.5) * 16 - 6,
      r: Math.random() * 4 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      opacity: 1,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 8
    });
  }

  let animationId;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let active = false;
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.25; // gravity
      p.vx *= 0.98; // friction
      p.opacity -= 0.015;
      p.rotation += p.rotationSpeed;

      if (p.opacity > 0) {
        active = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation * Math.PI / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.opacity;
        ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2);
        ctx.restore();
      }
    });

    if (active) {
      animationId = requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cancelAnimationFrame(animationId);
    }
  }
  draw();
}

function getTaskCompletionStats(tasks) {
  let total = 0;
  let completed = 0;
  tasks.forEach(t => {
    if (t.subtasks && t.subtasks.length > 0) {
      total += t.subtasks.length;
      completed += t.subtasks.filter(s => s.done).length;
    } else {
      total += 1;
      if (t.done) {
        completed += 1;
      }
    }
  });
  return { total, completed };
}

function updateDailyProgressCard(total, completed) {
  const card = document.getElementById('daily-progress-card');
  if (!card) return;
  
  if (total === 0) {
    card.classList.add('hidden');
    return;
  }
  
  card.classList.remove('hidden');
  const percent = Math.round((completed / total) * 100);
  
  document.getElementById('daily-progress-percent').textContent = `${percent}%`;
  
  const circle = document.getElementById('daily-progress-circle');
  if (circle) {
    const radius = parseFloat(circle.getAttribute('r') || '26');
    const circumference = 2 * Math.PI * radius; // ~163.36
    const offset = circumference - (percent / 100) * circumference;
    circle.style.strokeDashoffset = offset;
  }
  
  document.getElementById('daily-progress-ratio').textContent = `${completed} of ${total} completed`;
  
  const messageEl = document.getElementById('daily-progress-message');
  if (messageEl) {
    if (percent === 100) {
      messageEl.textContent = "Absolute legend! All tasks completed today! 🎉";
      card.classList.add('is-complete');
    } else if (percent >= 50) {
      messageEl.textContent = "Over halfway there! You're doing amazing! ✨";
      card.classList.remove('is-complete');
    } else if (percent > 0) {
      messageEl.textContent = "Good start! Keep the momentum going! 💪";
      card.classList.remove('is-complete');
    } else {
      messageEl.textContent = "A fresh day! Let's conquer the first task! 🚀";
      card.classList.remove('is-complete');
    }
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  collapsedCategories = (await get('collapsed_categories')) || [];
  
  // Load holidays setting
  showSlHolidays = !!(await get('show_sl_holidays'));
  const toggleSlHolidaysCb = document.getElementById('toggle-sl-holidays');
  if (toggleSlHolidaysCb) {
    toggleSlHolidaysCb.checked = showSlHolidays;
    toggleSlHolidaysCb.addEventListener('change', async () => {
      showSlHolidays = toggleSlHolidaysCb.checked;
      await set('show_sl_holidays', showSlHolidays);
      await refreshCurrentTab();
    });
  }

  renderDayDate();
  renderDayHolidayBanner();
  const categories = await getCustomCategories();
  activeCat = categories[0] || 'Personal';
  mountDayBoard();
  await populateCategoryDropdowns();
  await renderPriorityList();
  await loadNotes();

  // Initial Fixed Events rendering
  await renderDayFixedEvents();
  await renderDaySidebarFixedEvents();
  await renderCountdownBanners();

  // Bind add buttons
  const sidebarAddBtn = document.getElementById('btn-add-fixed-event-sidebar');
  if (sidebarAddBtn) {
    sidebarAddBtn.addEventListener('click', () => {
      openFixedEventModal({ date: currentDate }, async () => {
        await refreshActiveTab();
      });
    });
  }

  const weekAddBtn = document.getElementById('btn-add-fixed-event-week');
  if (weekAddBtn) {
    weekAddBtn.addEventListener('click', () => {
      openFixedEventModal({ date: TODAY }, async () => {
        await refreshActiveTab();
      });
    });
  }

  const monthAddBtn = document.getElementById('btn-add-month-fixed-event');
  if (monthAddBtn) {
    monthAddBtn.addEventListener('click', () => {
      const prefillDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
      openFixedEventModal({ date: prefillDate }, async () => {
        await refreshActiveTab();
      });
    });
  }

  // Initialize automatic synchronization
  initAutoSync();
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;

  const keys = Object.keys(changes);
  const hasPlannerChanges = keys.some(key => 
    key.startsWith('blocks_') || 
    key.startsWith('tasks_') || 
    key.startsWith('notes_') || 
    key === 'notes' || 
    key === 'collapsed_categories' || 
    key === 'task_categories' ||
    key === 'monthly_themes' ||
    key === 'monthly_goals' ||
    key === 'show_sl_holidays' ||
    key === 'fixed_events'
  );

  if (hasPlannerChanges) {
    if (activeTab === 'day') {
      await onDayChanged();
    } else {
      await refreshActiveTab();
    }
  }
});

init();
