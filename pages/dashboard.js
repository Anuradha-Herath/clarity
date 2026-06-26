/**
 * Clarity — pages/dashboard.js
 * Dashboard: today's time board + tasks + capture inbox + weekly progress.
 * ES Module.
 */

import {
  getTasks, addTask, updateTask, deleteTask,
  getBlocks,
  get, set, remove,
  getYearlyThemes,
  generateId, todayKey, dateKey,
  getHabits,
  initAutoSync,
  getCustomCategories,
} from '../shared/storage.js';

import { mountTimeboard } from '../shared/timeboard.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

function fmtRelTime(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins  = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getMondayOf(dateStr) {
  const d   = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return isoDate(d);
}

function getWeekDates(mondayStr) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mondayStr + 'T12:00:00');
    d.setDate(d.getDate() + i);
    return isoDate(d);
  });
}

// ─── Greeting ──────────────────────────────────────────────────────────────────
function renderGreeting() {
  const el = document.getElementById('dash-date-greeting');
  if (!el) return;

  const now  = new Date();
  const hour = now.getHours();
  const greet =
    hour < 12 ? 'Good morning' :
    hour < 17 ? 'Good afternoon' :
    hour < 21 ? 'Good evening' : 'Good night';

  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  el.innerHTML = `
    <div class="dash-greeting">${greet} ✦</div>
    <div class="dash-date-sub">${dateStr}</div>
  `;
}

// ─── Category pills ────────────────────────────────────────────────────────────
let activeCat = null;



// ─── Time board ────────────────────────────────────────────────────────────────
const TODAY = todayKey();

const boardWrap = document.getElementById('dash-board-wrap');
let board = null;

// ─── ══════════════════════════════════════════════════════
//     TODAY'S TASKS
// ══════════════════════════════════════════════════════════

// ─── ══════════════════════════════════════════════════════
//     HABITS TODAY WIDGET
// ══════════════════════════════════════════════════════════
const dashHabitsCard = document.getElementById('dash-habits-card');
const dashHabitsCount = document.getElementById('dash-habits-count');
const dashHabitsStreaks = document.getElementById('dash-habits-streaks');

async function renderHabitsWidget() {
  if (!dashHabitsCard) return;

  const habits = await getHabits();
  const allTasks = await getTasks(TODAY);
  const habitTasks = allTasks.filter(t => t.habitId);

  const total = habitTasks.length;
  const done = habitTasks.filter(t => t.done).length;

  dashHabitsCount.textContent = `${done} of ${total} habits done today`;

  if (total === 0) {
    dashHabitsStreaks.innerHTML = `<span class="text-xs text-muted">No habits scheduled for today.</span>`;
    return;
  }

  dashHabitsStreaks.innerHTML = habitTasks.map(task => {
    const habit = habits.find(h => h.id === task.habitId);
    if (!habit) return '';
    const streak = habit.streak?.current || 0;
    return `
      <span class="streak-badge" title="${habit.name}: ${streak} day streak" style="font-size: 13px; color: var(--color-warning); display: inline-flex; align-items: center; gap: 3px; padding: 2px 4px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2c1.78 0 3.32.96 4.12 2.39C17 5.76 17 8 15 10c-2.4 2.4-1.78 6-1 7 .5.6 1 1 2 1s2.5-.5 3-1.5c1.4-2.8 1.4-6.2.2-9.2C19.78 6.55 20 5.4 20 4c0-1.1-.9-2-2-2-1.2 0-2.2.8-2.6 1.9C14.7 3.3 13.4 3 12 3s-2.7.3-3.4.9C8.2 2.8 7.2 2 6 2 4.9 2 4 2.9 4 4c0 1.4.22 2.55.8 3.3C3.6 10.3 3.6 13.7 5 16.5c.5 1 2 1.5 3 1.5s1.5-.4 2-1c.78-1 1.4-4.6-1-7C7 8 7 5.76 7.88 4.39 8.68 2.96 10.22 2 12 2z"></path></svg>
        <span style="font-weight: 700;">${streak}</span>
        <span style="font-size: 10px; color: var(--color-text-muted); font-weight: normal; margin-left: 2px;">${habit.name}</span>
      </span>
    `;
  }).join('');
}

const dashTaskList  = document.getElementById('dash-task-list');
const dashTaskInput = document.getElementById('dash-task-input');
const btnAddTask    = document.getElementById('btn-dash-add-task');

async function renderTasks() {
  const allTasks = await getTasks(TODAY);

  // Sort: priority asc, done at bottom, show top 5
  const sorted = [...allTasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return (a.priority ?? 3) - (b.priority ?? 3);
  });

  const shown  = sorted.slice(0, 5);
  const hidden = sorted.length - shown.length;

  if (sorted.length === 0) {
    dashTaskList.innerHTML = `
      <div style="font-size:13px;color:var(--color-text-muted);padding:10px 0;font-style:italic;">
        No tasks today — press Add or use the capture shortcut
      </div>`;
    return;
  }

  dashTaskList.innerHTML = shown.map((t) => `
    <div class="dash-task-item" data-id="${t.id}">
      <div class="dash-p-dot" data-p="${t.priority ?? 3}"></div>
      <input type="checkbox" class="dash-task-check" data-id="${t.id}" ${t.done ? 'checked' : ''} />
      <span class="dash-task-text${t.done ? ' done-text' : ''}">${escHtml(t.title)}</span>
      ${t.timeEstimate ? `<span class="dash-task-est">${t.timeEstimate}m</span>` : ''}
    </div>
  `).join('') + (hidden > 0 ? `<div class="dash-task-more">+${hidden} more — <a href="planner.html" style="color:var(--color-accent)">open planner</a></div>` : '');

  // Bind checkboxes
  dashTaskList.querySelectorAll('.dash-task-check').forEach((cb) => {
    cb.addEventListener('change', async () => {
      await updateTask(TODAY, cb.dataset.id, { done: cb.checked });
      await renderTasks();
      await renderWeekProgress(); // update progress bar
    });
  });
}

async function quickAddTask() {
  const title = dashTaskInput.value.trim();
  if (!title) return;
  await addTask(TODAY, {
    id: generateId(), title, done: false, priority: 2, timeEstimate: null,
  });
  dashTaskInput.value = '';
  await renderTasks();
  await renderWeekProgress();
}

btnAddTask.addEventListener('click', quickAddTask);
dashTaskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); quickAddTask(); }
});

// ─── ══════════════════════════════════════════════════════
//     CAPTURE INBOX
// ══════════════════════════════════════════════════════════

const dashInboxList  = document.getElementById('dash-inbox-list');
const inboxEmpty     = document.getElementById('dash-inbox-empty');
const inboxBadge     = document.getElementById('inbox-count-badge');

// Route → label and action text
const ROUTE_LABELS = {
  today:   { text: 'Today',   pillClass: 'pill-today',   btnLabel: '→ Add as task' },
  someday: { text: 'Someday', pillClass: 'pill-someday', btnLabel: '→ Long-term goal' },
  goal:    { text: 'Goal',    pillClass: 'pill-goal',    btnLabel: '→ Add to goals' },
  vision:  { text: 'Vision',  pillClass: 'pill-vision',  btnLabel: '→ Open Vision' },
};

async function renderInbox() {
  const inbox = (await get('capture_inbox')) ?? [];

  inboxBadge.textContent = inbox.length;
  inboxBadge.style.display = inbox.length > 0 ? '' : 'none';

  if (inbox.length === 0) {
    dashInboxList.innerHTML = '';
    inboxEmpty.classList.remove('hidden');
    return;
  }

  inboxEmpty.classList.add('hidden');
  dashInboxList.innerHTML = '';

  inbox.forEach((item) => {
    const meta   = ROUTE_LABELS[item.route] ?? ROUTE_LABELS['today'];
    const timeAgo = fmtRelTime(item.timestamp);

    const el = document.createElement('div');
    el.className = 'inbox-item';
    el.dataset.id = item.id;

    el.innerHTML = `
      <div class="inbox-item-top">
        <span class="pill ${meta.pillClass} inbox-item-route">${meta.text}</span>
        <span class="inbox-item-text">${escHtml(item.text)}</span>
        <span class="inbox-item-time">${timeAgo}</span>
      </div>
      <div class="inbox-item-actions">
        <button class="btn-inbox-route" data-action data-id="${item.id}" data-route="${item.route}" data-text="${escHtml(item.text)}">
          ${meta.btnLabel}
        </button>
        <button class="btn-inbox-dismiss" data-dismiss data-id="${item.id}">✕ Dismiss</button>
      </div>
    `;

    dashInboxList.appendChild(el);
  });

  // Bind route action buttons
  dashInboxList.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => processInboxItem(btn.dataset.id, btn.dataset.route, btn.dataset.text));
  });

  // Bind dismiss buttons
  dashInboxList.querySelectorAll('[data-dismiss]').forEach((btn) => {
    btn.addEventListener('click', () => dismissInboxItem(btn.dataset.id));
  });
}

async function removeFromInbox(id) {
  const inbox = (await get('capture_inbox')) ?? [];
  const updated = inbox.filter((item) => item.id !== id);
  await set('capture_inbox', updated);
}

async function dismissInboxItem(id) {
  const el = dashInboxList.querySelector(`[data-id="${id}"]`);
  if (el) {
    el.style.opacity = '0';
    el.style.transform = 'translateX(30px)';
    el.style.transition = 'opacity 200ms, transform 200ms';
    await new Promise((r) => setTimeout(r, 200));
  }
  await removeFromInbox(id);
  await renderInbox();
}

async function processInboxItem(id, route, text) {
  switch (route) {
    case 'today':
      await addTask(TODAY, {
        id: generateId(), title: text, done: false, priority: 2, timeEstimate: null,
      });
      await renderTasks();
      await renderWeekProgress();
      break;

    case 'someday': {
      const goals = (await get('goals_long')) ?? [];
      goals.push({ id: generateId(), title: text, status: 'active', description: '', targetDate: '' });
      await set('goals_long', goals);
      break;
    }

    case 'goal': {
      const goals = (await get('goals_short')) ?? [];
      goals.push({ id: generateId(), title: text, status: 'active', description: '', targetDate: '' });
      await set('goals_short', goals);
      break;
    }

    case 'vision':
      // Open Vision page
      chrome.tabs.create({ url: chrome.runtime.getURL('pages/vision.html') });
      break;
  }

  await dismissInboxItem(id);
}

// Listen for new capture items arriving via storage change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['capture_inbox']) {
    renderInbox();
  }
});

// ─── ══════════════════════════════════════════════════════
//     WEEKLY PROGRESS
// ══════════════════════════════════════════════════════════

const weekProgressFill  = document.getElementById('week-progress-fill');
const weekProgressLabel = document.getElementById('week-progress-label');
const weekMiniBars      = document.getElementById('week-mini-bars');

const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function renderWeekProgress() {
  const monday    = getMondayOf(TODAY);
  const weekDates = getWeekDates(monday);

  // Load tasks for all 7 days in parallel
  const taskSets = await Promise.all(weekDates.map((d) => getTasks(d)));

  let totalDone  = 0;
  let totalTasks = 0;

  const dayStats = taskSets.map((tasks, i) => {
    const done  = tasks.filter((t) => t.done).length;
    const total = tasks.length;
    totalDone  += done;
    totalTasks += total;
    return { done, total, date: weekDates[i] };
  });

  // Aggregate bar
  const pct = totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0;
  weekProgressFill.style.width  = `${pct}%`;
  weekProgressLabel.textContent = `${totalDone}/${totalTasks} done`;

  // Mini bars
  weekMiniBars.innerHTML = '';
  dayStats.forEach((stat, i) => {
    const isToday   = stat.date === TODAY;
    const fillPct   = stat.total > 0 ? (stat.done / stat.total) * 100 : 0;
    const isComplete = stat.total > 0 && stat.done === stat.total;

    const col = document.createElement('div');
    col.className = `week-mini-bar-col${isToday ? ' is-today' : ''}`;

    col.innerHTML = `
      <div class="week-mini-bar-label">${DAY_ABBR[i]}</div>
      <div class="week-mini-bar-track" title="${stat.done}/${stat.total} tasks">
        <div class="week-mini-bar-fill${isComplete ? ' complete' : ''}"
             style="height:${fillPct}%"></div>
      </div>
      <div class="week-mini-bar-count">${stat.done}/${stat.total}</div>
    `;

    weekMiniBars.appendChild(col);
  });
}

// ─── Refresh on storage changes (e.g. popup adds a task) ───────────────────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const todayBlockKey = `blocks_${TODAY}`;
  const todayTaskKey  = `tasks_${TODAY}`;

  if (changes[todayBlockKey]) board.refresh(TODAY);
  if (changes[todayTaskKey])  {
    renderTasks();
    renderWeekProgress();
    renderHabitsWidget();
  }
  if (changes['habits']) {
    renderHabitsWidget();
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  // Sync habits for next 7 days on load
  try {
    await chrome.runtime.sendMessage({ type: 'SYNC_HABITS' });
  } catch (_) {}

  renderGreeting();
  const categories = await getCustomCategories();
  activeCat = categories[0] || 'Personal';
  board = mountTimeboard(boardWrap, TODAY, {
    getSelectedCat: () => activeCat,
  });
  await Promise.all([
    renderTasks(),
    renderInbox(),
    renderWeekProgress(),
    renderHabitsWidget(),
  ]);

  if (dashHabitsCard) {
    dashHabitsCard.addEventListener('click', () => {
      window.location.href = 'habits/habits.html';
    });
  }

  // Initialize automatic synchronization
  initAutoSync();
}

init();
