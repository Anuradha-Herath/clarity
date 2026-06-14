/**
 * Clarity — pages/tracker.js
 * Pomodoro timer + session log.
 * ES Module.
 */

import { get, set, push, generateId, todayKey, getTasks, getBlocks, updateTask, formatHour } from '../shared/storage.js';
import { showConfirm, showAlert } from '../shared/dialog.js';

// ─── Constants ─────────────────────────────────────────────────────────────────
const RING_R         = 100;
const CIRCUMFERENCE  = 2 * Math.PI * RING_R; // 628.318

const MODES = {
  focus:       { label: 'Focus',        seconds: 25 * 60, color: '#4F46E5', icon: '🎯' },
  short_break: { label: 'Short Break',  seconds:  5 * 60, color: '#16A34A', icon: '☕' },
  long_break:  { label: 'Long Break',   seconds: 15 * 60, color: '#0891B2', icon: '🛋️' },
};

const SESSIONS_PER_CYCLE = 4; // long break after 4 focus sessions

// ─── State ────────────────────────────────────────────────────────────────────
let currentMode   = 'focus';
let totalSeconds  = MODES.focus.seconds;
let remaining     = totalSeconds;
let running       = false;
let tickHandle    = null;
let lastTick      = null;
let focusCount    = 0; // completed focus sessions this cycle (0–3)
let totalToday    = 0; // total focus sessions logged today
let logFilter     = 'today';
let linkedId      = null;
let linkedType    = null; // 'task' or 'event'
let linkedTitle   = '';
let agendaTab     = 'tasks'; // 'tasks' or 'events'

const TODAY = todayKey();

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const timerPanel     = document.getElementById('timer-panel');
const modeTabs       = document.querySelectorAll('.mode-tab');
const timerLabel     = document.getElementById('timer-label');
const ringProgress   = document.getElementById('ring-progress');
const timerTimeEl    = document.getElementById('timer-time');
const timerModeLabel = document.getElementById('timer-mode-label');
const timerRingWrap  = document.getElementById('timer-ring-wrap');
const sessionDots    = document.querySelectorAll('.session-dot');
const sessionDotLbl  = document.getElementById('session-dot-label');
const btnStartPause  = document.getElementById('btn-start-pause');
const iconPlay       = document.getElementById('icon-play');
const iconPause      = document.getElementById('icon-pause');
const btnReset       = document.getElementById('btn-reset');
const btnSkip        = document.getElementById('btn-skip');
const statSessions   = document.getElementById('stat-sessions');
const statFocusTime  = document.getElementById('stat-focus-time');
const logList        = document.getElementById('log-list');
const logEmpty       = document.getElementById('log-empty');
const logTotals      = document.getElementById('log-totals');
const totalSessionsVal = document.getElementById('total-sessions-val');
const totalFocusVal    = document.getElementById('total-focus-val');
const filterBtns       = document.querySelectorAll('.log-filter-btn');

const agendaPanel        = document.getElementById('agenda-panel');
const agendaDateLabel    = document.getElementById('agenda-date-label');
const agendaTabs         = document.querySelectorAll('.agenda-tab');
const agendaList         = document.getElementById('agenda-list');
const linkedTaskPill     = document.getElementById('linked-task-pill');
const linkedTaskTitle    = document.getElementById('linked-task-title');
const btnClearLink       = document.getElementById('btn-clear-link');

// Manual Log elements
const btnManualLog      = document.getElementById('btn-manual-log');
const manualLogModal    = document.getElementById('manual-log-modal-overlay');
const manualLogClose    = document.getElementById('manual-log-modal-close');
const btnManualCancel   = document.getElementById('btn-manual-log-cancel');
const btnManualSave     = document.getElementById('btn-manual-log-save');
const manualLogLabel    = document.getElementById('manual-log-label');
const manualLogLink     = document.getElementById('manual-log-link');
const manualLogDuration = document.getElementById('manual-log-duration');
const manualLogDate     = document.getElementById('manual-log-date');
const quickDurationBtns = document.querySelectorAll('.btn-quick-dur');

// ─── Display helpers ───────────────────────────────────────────────────────────
function fmtSeconds(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtDuration(secs) {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function fmtTime(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
}

function fmtDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Ring update ───────────────────────────────────────────────────────────────
function updateRing() {
  const progress = remaining / totalSeconds;
  const offset   = CIRCUMFERENCE * (1 - progress);
  ringProgress.style.strokeDashoffset = offset;
  ringProgress.style.stroke = MODES[currentMode].color;
}

// ─── Timer display update ──────────────────────────────────────────────────────
function updateDisplay() {
  timerTimeEl.textContent  = fmtSeconds(remaining);
  timerModeLabel.textContent = MODES[currentMode].label;
  document.title = `${fmtSeconds(remaining)} — ${MODES[currentMode].label} · Clarity`;
  updateRing();
}

// ─── Session dots update ───────────────────────────────────────────────────────
function updateSessionDots() {
  sessionDots.forEach((dot, i) => {
    dot.classList.remove('done', 'current');
    if (i < focusCount) {
      dot.classList.add('done');
    } else if (i === focusCount && currentMode === 'focus') {
      dot.classList.add('current');
    }
  });

  const cycle   = focusCount + 1;
  const remaining_ = SESSIONS_PER_CYCLE - focusCount;
  if (currentMode === 'focus') {
    sessionDotLbl.textContent = `Session ${cycle} of ${SESSIONS_PER_CYCLE}`;
  } else {
    sessionDotLbl.textContent = `${remaining_} session${remaining_ !== 1 ? 's' : ''} until long break`;
  }
}

async function saveStateToStorage() {
  const state = {
    mode: currentMode,
    running: running,
    remaining: remaining,
    targetTime: running ? (Date.now() + remaining * 1000) : null,
    label: timerLabel.value,
    focusCount: focusCount,
    totalToday: totalToday,
    linkedId: linkedId,
    linkedType: linkedType,
    linkedTitle: linkedTitle,
  };
  await set('timer_state', state);

  // Sync background alarm
  if (running) {
    chrome.alarms.create('timer_complete', { when: state.targetTime });
  } else {
    chrome.alarms.clear('timer_complete');
  }
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes['timer_state']) {
    const newState = changes['timer_state'].newValue;
    if (!newState) return;

    if (newState.mode !== currentMode || newState.running !== running || Math.abs(newState.remaining - remaining) > 2 || newState.linkedId !== linkedId || newState.label !== timerLabel.value) {
      currentMode = newState.mode;
      running = newState.running;
      focusCount = newState.focusCount ?? 0;
      totalToday = newState.totalToday ?? 0;
      timerLabel.value = newState.label ?? '';
      linkedId = newState.linkedId ?? null;
      linkedType = newState.linkedType ?? null;
      linkedTitle = newState.linkedTitle ?? '';

      if (running) {
        remaining = Math.max(0, Math.round((newState.targetTime - Date.now()) / 1000));
        if (!tickHandle) {
          lastTick = Date.now();
          tickHandle = setInterval(tick, 250);
        }
        timerRingWrap.classList.add('running');
        iconPlay.classList.add('hidden');
        iconPause.classList.remove('hidden');
      } else {
        remaining = newState.remaining;
        if (tickHandle) {
          clearInterval(tickHandle);
          tickHandle = null;
        }
        timerRingWrap.classList.remove('running');
        iconPlay.classList.remove('hidden');
        iconPause.classList.add('hidden');
      }

      timerPanel.className = `timer-panel mode-${currentMode}`;
      ringProgress.style.stroke = MODES[currentMode].color;

      // Update tab UI
      modeTabs.forEach((t) => t.classList.toggle('active', t.dataset.mode === currentMode));

      updateDisplay();
      updateSessionDots();
      updateLinkedUI();
      await refreshStats();
      await renderLog();
      await renderAgenda();
    }
  }
});

// ─── Start / Pause ─────────────────────────────────────────────────────────────
function startTimer() {
  if (running) return;
  running  = true;
  lastTick = Date.now();
  tickHandle = setInterval(tick, 250);

  timerRingWrap.classList.add('running');
  iconPlay.classList.add('hidden');
  iconPause.classList.remove('hidden');

  saveStateToStorage();
}

function pauseTimer() {
  if (!running) return;
  running = false;
  clearInterval(tickHandle);
  tickHandle = null;

  timerRingWrap.classList.remove('running');
  iconPlay.classList.remove('hidden');
  iconPause.classList.add('hidden');

  saveStateToStorage();
}

function resetTimer() {
  pauseTimer();
  remaining = totalSeconds;
  timerRingWrap.classList.remove('complete');
  updateDisplay();

  saveStateToStorage();
}

// ─── Tick ──────────────────────────────────────────────────────────────────────
function tick() {
  if (!running) return;
  const now     = Date.now();
  const elapsed = Math.floor((now - lastTick) / 1000);
  if (elapsed >= 1) {
    remaining = Math.max(0, remaining - elapsed);
    lastTick  = now;
    updateDisplay();
    if (remaining === 0) {
      onComplete();
    }
  }
}

// ─── Timer complete ────────────────────────────────────────────────────────────
async function onComplete() {
  pauseTimer();
  timerRingWrap.classList.add('complete');
  playBeep();

  // Notify SW
  try {
    chrome.runtime.sendMessage({ type: 'TIMER_COMPLETE', mode: currentMode });
  } catch (_) {}

  if (currentMode === 'focus') {
    // Log the session
    const sessionSecs = MODES.focus.seconds; // full session
    const entry = {
      id:          generateId(),
      date:        TODAY,
      label:       timerLabel.value.trim() || 'Focus session',
      mode:        'focus',
      duration:    sessionSecs,
      completedAt: new Date().toISOString(),
      linkedId:    linkedId,
      linkedType:  linkedType,
      linkedTitle: linkedTitle,
    };
    await saveLog(entry);

    // Advance cycle counter
    focusCount = (focusCount + 1) % SESSIONS_PER_CYCLE;
    totalToday++;

    // Auto-select next mode
    if (focusCount === 0) {
      // Completed a full cycle → long break
      setTimeout(() => switchMode('long_break'), 800);
    } else {
      setTimeout(() => switchMode('short_break'), 800);
    }

    await refreshStats();
    await renderLog();
    await renderAgenda();
  } else {
    // Break finished → switch back to focus
    setTimeout(() => switchMode('focus'), 800);
  }

  updateSessionDots();
}

// ─── Skip ──────────────────────────────────────────────────────────────────────
function skipMode() {
  pauseTimer();
  timerRingWrap.classList.remove('complete');
  if (currentMode === 'focus') {
    switchMode(focusCount === SESSIONS_PER_CYCLE - 1 ? 'long_break' : 'short_break');
  } else {
    switchMode('focus');
  }
}

// ─── Mode switching ────────────────────────────────────────────────────────────
function switchMode(mode) {
  currentMode  = mode;
  totalSeconds = MODES[mode].seconds;
  remaining    = totalSeconds;

  // Update tab UI
  modeTabs.forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));

  // Panel background tint
  timerPanel.className = `timer-panel mode-${mode}`;

  // Ring color (immediate update, no transition)
  ringProgress.style.transition = 'stroke-dashoffset 800ms linear';
  ringProgress.style.stroke = MODES[mode].color;

  timerRingWrap.classList.remove('running', 'complete');
  iconPlay.classList.remove('hidden');
  iconPause.classList.add('hidden');

  updateDisplay();
  updateSessionDots();

  saveStateToStorage();
}

// ─── Web Audio beep ────────────────────────────────────────────────────────────
function playBeep() {
  try {
    const ctx  = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.28, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 1.2);
  } catch (_) {}
}

// ─── Save log entry ────────────────────────────────────────────────────────────
async function saveLog(entry) {
  const logs = (await get('timer_logs')) ?? [];
  logs.push(entry);
  await set('timer_logs', logs);
}

// ─── Refresh stats row ─────────────────────────────────────────────────────────
async function refreshStats() {
  const logs     = (await get('timer_logs')) ?? [];
  const today    = logs.filter((l) => l.date === TODAY && l.mode === 'focus');
  const totalSec = today.reduce((sum, l) => sum + l.duration, 0);

  statSessions.textContent  = today.length;
  statFocusTime.textContent = fmtDuration(totalSec);
}

// ─── ══════════════════════════════════════════════════════
//     SESSION LOG PANEL
// ══════════════════════════════════════════════════════════

async function renderLog() {
  const allLogs = (await get('timer_logs')) ?? [];
  let filtered  = [];

  const now     = new Date();
  const todayStr = TODAY;

  if (logFilter === 'today') {
    filtered = allLogs.filter((l) => l.date === todayStr);
  } else if (logFilter === 'week') {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 6);
    const weekAgoStr = weekAgo.toISOString().slice(0, 10);
    filtered = allLogs.filter((l) => l.date >= weekAgoStr);
  } else {
    filtered = [...allLogs];
  }

  // Sort newest first
  filtered.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  logList.innerHTML = '';

  if (filtered.length === 0) {
    logEmpty.style.display = '';
    logTotals.style.display = 'none';
    return;
  }

  logEmpty.style.display = 'none';
  logTotals.style.display = '';

  // Group by date
  const groups = new Map();
  filtered.forEach((entry) => {
    if (!groups.has(entry.date)) groups.set(entry.date, []);
    groups.get(entry.date).push(entry);
  });

  for (const [date, entries] of groups) {
    // Group header
    const header = document.createElement('div');
    header.className = 'log-group-header';
    header.textContent = fmtDate(date + 'T00:00:00');
    logList.appendChild(header);

    entries.forEach((entry) => {
      const el = buildLogEntry(entry);
      logList.appendChild(el);
    });
  }

  // Totals
  const focusSessions = filtered.filter((l) => l.mode === 'focus');
  const totalFocusSec = focusSessions.reduce((s, l) => s + l.duration, 0);
  totalSessionsVal.textContent = focusSessions.length;
  totalFocusVal.textContent    = fmtDuration(totalFocusSec);
}

function buildLogEntry(entry) {
  const mode = MODES[entry.mode] ?? MODES.focus;
  const el   = document.createElement('div');
  el.className = 'log-entry fade-in';

  const linkBadgeHtml = entry.linkedTitle ? `
    <div class="log-entry-link-badge" title="Linked to: ${escHtml(entry.linkedTitle)}">
      🔗 ${escHtml(entry.linkedTitle)}
    </div>
  ` : '';

  el.innerHTML = `
    <div class="log-entry-icon ${entry.mode}">${mode.icon}</div>
    <div class="log-entry-body">
      <div class="log-entry-label">${escHtml(entry.label || mode.label)}</div>
      <div class="log-entry-meta">
        ${mode.label}
        ${linkBadgeHtml}
      </div>
    </div>
    <div class="log-entry-right">
      <div class="log-entry-duration">${fmtDuration(entry.duration)}</div>
      <div class="log-entry-time">${fmtTime(entry.completedAt)}</div>
    </div>
  `;

  return el;
}

// ─── Event bindings ────────────────────────────────────────────────────────────

// Mode tabs
modeTabs.forEach((tab) => {
  tab.addEventListener('click', async () => {
    if (tab.dataset.mode === currentMode) return;
    if (running) {
      const confirmSwitch = await showConfirm(`Switching to ${MODES[tab.dataset.mode].label} will reset your active session. Are you sure?`, 'Reset Active Session');
      if (!confirmSwitch) return;
    }
    pauseTimer();
    timerRingWrap.classList.remove('complete');
    switchMode(tab.dataset.mode);
  });
});

// Start/Pause
btnStartPause.addEventListener('click', () => {
  if (running) pauseTimer();
  else         startTimer();
});

// Reset
btnReset.addEventListener('click', resetTimer);

// Skip
btnSkip.addEventListener('click', skipMode);

// Label — update title on change
timerLabel.addEventListener('input', () => {
  if (!running && timerLabel.value.trim()) {
    document.title = `${fmtSeconds(remaining)} — ${MODES[currentMode].label} · Clarity`;
  }
  saveStateToStorage();
});

// Log filter
filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    filterBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    logFilter = btn.dataset.range;
    renderLog();
  });
});

// Keyboard shortcut: Space = start/pause (when not typing in input)
document.addEventListener('keydown', (e) => {
  if (e.target === timerLabel) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (running) pauseTimer();
    else         startTimer();
  }
  if (e.key === 'r' || e.key === 'R') {
    if (e.target.tagName !== 'INPUT') resetTimer();
  }
});

// ─── Manual Session Logging ───────────────────────────────────────────────────

async function openManualLogModal() {
  manualLogDate.value = TODAY;
  manualLogDuration.value = 25;
  manualLogLabel.value = linkedTitle || '';

  // Load today's tasks & events
  const tasks = await getTasks(TODAY);
  const blocks = await getBlocks(TODAY);

  manualLogLink.innerHTML = '<option value="">-- No link --</option>';

  if (tasks.length > 0) {
    const optGroup = document.createElement('optgroup');
    optGroup.label = 'Tasks';
    tasks.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = `task:${t.id}`;
      opt.textContent = t.title;
      opt.dataset.title = t.title;
      optGroup.appendChild(opt);
    });
    manualLogLink.appendChild(optGroup);
  }

  if (blocks.length > 0) {
    const optGroup = document.createElement('optgroup');
    optGroup.label = 'Events';
    blocks.forEach((b) => {
      const opt = document.createElement('option');
      opt.value = `event:${b.id}`;
      opt.textContent = b.title;
      opt.dataset.title = b.title;
      optGroup.appendChild(opt);
    });
    manualLogLink.appendChild(optGroup);
  }

  // Pre-select current link if active
  if (linkedId && linkedType) {
    manualLogLink.value = `${linkedType}:${linkedId}`;
  }

  manualLogModal.classList.remove('hidden');
}

function closeManualLogModal() {
  manualLogModal.classList.add('hidden');
}

async function handleManualLogSave() {
  const durationMin = parseInt(manualLogDuration.value, 10);
  if (isNaN(durationMin) || durationMin <= 0) {
    showAlert('Please enter a valid duration in minutes.', 'Invalid Duration');
    return;
  }

  const labelText = manualLogLabel.value.trim() || 'Focus session';
  const selectedDate = manualLogDate.value || TODAY;

  const linkVal = manualLogLink.value;
  let logLinkedId = null;
  let logLinkedType = null;
  let logLinkedTitle = '';

  if (linkVal) {
    const [type, id] = linkVal.split(':');
    logLinkedId = id;
    logLinkedType = type;
    const opt = manualLogLink.selectedOptions[0];
    logLinkedTitle = opt.dataset.title;
  }

  // Create standard log entry
  let completedAt = new Date().toISOString();
  if (selectedDate !== TODAY) {
    completedAt = new Date(selectedDate + 'T12:00:00').toISOString();
  }

  const entry = {
    id:          generateId(),
    date:        selectedDate,
    label:       labelText,
    mode:        'focus',
    duration:    durationMin * 60,
    completedAt: completedAt,
    linkedId:    logLinkedId,
    linkedType:  logLinkedType,
    linkedTitle: logLinkedTitle,
  };

  await saveLog(entry);
  closeManualLogModal();

  // Refresh views
  await refreshStats();
  await renderLog();
  await renderAgenda();
}

// Bind manual log modal actions
btnManualLog.addEventListener('click', openManualLogModal);
manualLogClose.addEventListener('click', closeManualLogModal);
btnManualCancel.addEventListener('click', closeManualLogModal);
btnManualSave.addEventListener('click', handleManualLogSave);

// Quick duration selectors
quickDurationBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    manualLogDuration.value = btn.dataset.dur;
  });
});

// Dropdown link changes auto-populate the label field if empty/default
manualLogLink.addEventListener('change', () => {
  const labelVal = manualLogLabel.value.trim();
  if (!labelVal || labelVal === 'Focus session' || (linkedTitle && labelVal === linkedTitle)) {
    if (manualLogLink.value) {
      const opt = manualLogLink.selectedOptions[0];
      manualLogLabel.value = opt.dataset.title || '';
    } else {
      manualLogLabel.value = '';
    }
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  // Set ring initial state
  ringProgress.style.strokeDasharray  = CIRCUMFERENCE;
  ringProgress.style.strokeDashoffset = 0;

  // Load timer state from storage
  let state = await get('timer_state');
  if (!state) {
    state = {
      mode: 'focus',
      running: false,
      remaining: MODES.focus.seconds,
      targetTime: null,
      label: '',
      focusCount: 0,
      totalToday: 0,
      linkedId: null,
      linkedType: null,
      linkedTitle: ''
    };
    await set('timer_state', state);
  }

  // Restore state variables
  currentMode = state.mode;
  totalSeconds = MODES[currentMode].seconds;
  running = state.running;
  focusCount = state.focusCount ?? 0;
  totalToday = state.totalToday ?? 0;
  timerLabel.value = state.label ?? '';
  linkedId = state.linkedId ?? null;
  linkedType = state.linkedType ?? null;
  linkedTitle = state.linkedTitle ?? '';

  // Calculate remaining time
  if (running && state.targetTime) {
    const timeDiff = Math.max(0, Math.round((state.targetTime - Date.now()) / 1000));
    if (timeDiff <= 0) {
      remaining = 0;
      running = false;
      await onComplete();
    } else {
      remaining = timeDiff;
      lastTick = Date.now();
      tickHandle = setInterval(tick, 250);
      timerRingWrap.classList.add('running');
      iconPlay.classList.add('hidden');
      iconPause.classList.remove('hidden');
    }
  } else {
    remaining = state.remaining ?? MODES[currentMode].seconds;
    running = false;
    timerRingWrap.classList.remove('running');
    iconPlay.classList.remove('hidden');
    iconPause.classList.add('hidden');
  }

  timerPanel.className = `timer-panel mode-${currentMode}`;
  ringProgress.style.stroke = MODES[currentMode].color;

  // Agenda tab clicks
  agendaTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.tab === agendaTab) return;
      agendaTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      agendaTab = tab.dataset.tab;
      renderAgenda();
    });
  });

  // Clear link button click
  btnClearLink.addEventListener('click', clearLink);

  updateDisplay();
  updateSessionDots();
  updateLinkedUI();

  await refreshStats();
  await renderLog();
  await renderAgenda();
}

// ─── Agenda & Linking Logic ──────────────────────────────────────────────────

function toggleLink(id, type, title) {
  if (linkedId === id) {
    clearLink();
  } else {
    linkedId = id;
    linkedType = type;
    linkedTitle = title;
    timerLabel.value = title;
    updateLinkedUI();
    saveStateToStorage();
    renderAgenda();
  }
}

function clearLink() {
  linkedId = null;
  linkedType = null;
  linkedTitle = '';
  updateLinkedUI();
  saveStateToStorage();
  renderAgenda();
}

function updateLinkedUI() {
  if (linkedId) {
    linkedTaskTitle.textContent = linkedTitle;
    linkedTaskPill.classList.remove('hidden');
  } else {
    linkedTaskPill.classList.add('hidden');
  }
}

async function renderAgenda() {
  agendaDateLabel.textContent = new Date(TODAY + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric'
  });

  const allLogs = (await get('timer_logs')) ?? [];
  const todayFocusLogs = allLogs.filter((l) => l.date === TODAY && l.mode === 'focus');

  // Helper to calculate total spent focus time in minutes for a specific task or block ID
  const getSpentMinutes = (id) => {
    const matchedLogs = todayFocusLogs.filter((l) => l.linkedId === id);
    const totalSecs = matchedLogs.reduce((sum, l) => sum + (l.duration ?? 0), 0);
    return Math.round(totalSecs / 60);
  };

  agendaList.innerHTML = '';

  if (agendaTab === 'tasks') {
    const tasks = await getTasks(TODAY);
    if (tasks.length === 0) {
      agendaList.innerHTML = `
        <div class="empty-state" style="padding: 40px 10px;">
          <div class="empty-state-title">No tasks for today</div>
          <div class="empty-state-desc">Add tasks in the Planner to track them here</div>
        </div>`;
      return;
    }

    // Sort: priority asc, then undone first
    const sorted = [...tasks].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (a.priority ?? 3) - (b.priority ?? 3);
    });

    sorted.forEach((task) => {
      const spentMin = getSpentMinutes(task.id);
      const estMin = task.timeEstimate ?? 0;
      const isSelected = linkedId === task.id;

      const itemEl = document.createElement('div');
      itemEl.className = `agenda-item${isSelected ? ' selected' : ''}`;
      itemEl.dataset.id = task.id;
      itemEl.dataset.type = 'task';
      itemEl.dataset.title = task.title;

      let metaHtml = '';
      if (estMin > 0 || spentMin > 0) {
        const estText = estMin ? `${estMin}m est` : 'no est';
        const progressPercent = estMin ? Math.min(100, Math.round((spentMin / estMin) * 100)) : 0;
        const overtimeClass = spentMin > estMin && estMin > 0 ? ' overtime' : '';
        metaHtml = `
          <div class="agenda-item-meta">
            <span>Spent: ${spentMin}m / ${estText}</span>
            <span>${estMin ? progressPercent + '%' : ''}</span>
          </div>
          ${estMin ? `
            <div class="agenda-progress-bar">
              <div class="agenda-progress-fill${overtimeClass}" style="width: ${progressPercent}%"></div>
            </div>
          ` : ''}
        `;
      }

      itemEl.innerHTML = `
        <div class="agenda-item-top">
          <input type="checkbox" class="agenda-item-check" data-id="${task.id}" ${task.done ? 'checked' : ''} />
          <div class="agenda-priority-dot" data-p="${task.priority ?? 3}"></div>
          <span class="agenda-item-title${task.done ? ' done-text' : ''}">${escHtml(task.title)}</span>
        </div>
        ${metaHtml}
      `;

      // Checkbox listener
      const cb = itemEl.querySelector('.agenda-item-check');
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      cb.addEventListener('change', async () => {
        await updateTask(TODAY, task.id, { done: cb.checked });
        await renderAgenda();
      });

      itemEl.addEventListener('click', () => {
        toggleLink(task.id, 'task', task.title);
      });

      agendaList.appendChild(itemEl);
    });

  } else {
    // Events
    const blocks = await getBlocks(TODAY);
    if (blocks.length === 0) {
      agendaList.innerHTML = `
        <div class="empty-state" style="padding: 40px 10px;">
          <div class="empty-state-title">No events scheduled</div>
          <div class="empty-state-desc">Plan your day in the Planner to schedule events</div>
        </div>`;
      return;
    }

    // Sort by start hour
    const sorted = [...blocks].sort((a, b) => a.start - b.start);

    sorted.forEach((block) => {
      const spentMin = getSpentMinutes(block.id);
      const isSelected = linkedId === block.id;

      const itemEl = document.createElement('div');
      itemEl.className = `agenda-item event-item${isSelected ? ' selected' : ''}`;
      itemEl.dataset.id = block.id;
      itemEl.dataset.type = 'event';
      itemEl.dataset.title = block.title;
      itemEl.dataset.cat = block.cat;

      const timeRange = `${formatHour(block.start)} – ${formatHour(block.end)}`;

      itemEl.innerHTML = `
        <div class="agenda-item-top">
          <span class="agenda-item-title">${escHtml(block.title)}</span>
          <span class="agenda-item-time">${timeRange}</span>
        </div>
        <div class="agenda-item-meta">
          <span>Category: ${escHtml(block.cat)}</span>
          ${spentMin > 0 ? `<span>Spent: ${spentMin}m</span>` : ''}
        </div>
      `;

      itemEl.addEventListener('click', () => {
        toggleLink(block.id, 'event', block.title);
      });

      agendaList.appendChild(itemEl);
    });
  }
}

init();
