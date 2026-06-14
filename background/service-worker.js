/**
 * Clarity — background/service-worker.js
 * Manifest V3 Service Worker.
 *
 * IMPORTANT: MV3 service workers cannot use ES module imports.
 * All logic is inlined here — no importScripts, no external deps.
 *
 * Responsibilities:
 *   • Register daily alarms on install and on every startup
 *   • Handle morning_ritual, night_review, next_day_prep alarms
 *   • Handle per-block "block_{id}" alarms (5-min-before reminders)
 *   • Notification button-click → open relevant full page
 */

'use strict';

// ─── Constants ─────────────────────────────────────────────────────────────────

const PAGES = {
  dashboard: chrome.runtime.getURL('pages/dashboard.html'),
  planner:   chrome.runtime.getURL('pages/planner.html'),
  vision:    chrome.runtime.getURL('pages/vision.html'),
  tracker:   chrome.runtime.getURL('pages/tracker.html'),
};

const ALARM_MORNING = 'morning_ritual';
const ALARM_NIGHT   = 'night_review';
const ALARM_PREP    = 'next_day_prep';

// ─── Inline storage helpers ────────────────────────────────────────────────────
// (Duplicated from storage.js because SW cannot use ES modules)

function swGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) {
        console.error('[SW] storage.get error:', chrome.runtime.lastError);
        resolve(null);
      } else {
        resolve(key in result ? result[key] : null);
      }
    });
  });
}

function swSet(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        console.error('[SW] storage.set error:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

async function swGetSettings() {
  const stored = await swGet('settings');
  const defaults = { morningTime: '07:00', nightTime: '22:00', theme: 'light' };
  return { ...defaults, ...(stored ?? {}) };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function dateKey(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// ─── Alarm scheduling helpers ──────────────────────────────────────────────────

/**
 * Convert "HH:MM" time string into the next matching timestamp (ms).
 * If the time has already passed today, schedules for tomorrow.
 * @param {string} timeStr  "HH:MM"
 * @returns {number}  Unix ms timestamp
 */
function nextAlarmTime(timeStr) {
  const [hh, mm] = timeStr.split(':').map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(hh, mm, 0, 0);
  if (target.getTime() <= now.getTime()) {
    // Already past — schedule for tomorrow
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

/**
 * Register (or re-register) the three daily alarms.
 * Safe to call multiple times — clears and recreates each one.
 */
async function registerDailyAlarms() {
  const settings = await swGetSettings();

  // Clear existing recurring alarms before re-registering
  await Promise.all([
    clearAlarmSafe(ALARM_MORNING),
    clearAlarmSafe(ALARM_NIGHT),
    clearAlarmSafe(ALARM_PREP),
  ]);

  // Morning ritual
  chrome.alarms.create(ALARM_MORNING, {
    when: nextAlarmTime(settings.morningTime),
    periodInMinutes: 24 * 60, // daily
  });

  // Night review
  chrome.alarms.create(ALARM_NIGHT, {
    when: nextAlarmTime(settings.nightTime),
    periodInMinutes: 24 * 60,
  });

  // Next-day prep — always at 21:00
  chrome.alarms.create(ALARM_PREP, {
    when: nextAlarmTime('21:00'),
    periodInMinutes: 24 * 60,
  });

  console.log('[SW] Daily alarms registered:', {
    morningTime: settings.morningTime,
    nightTime:   settings.nightTime,
    prep:        '21:00',
  });
}

function clearAlarmSafe(name) {
  return new Promise((resolve) => {
    chrome.alarms.clear(name, () => resolve());
  });
}

// ─── Per-block alarm helpers ───────────────────────────────────────────────────

/**
 * Register a one-time alarm for a block, firing 5 min before its start.
 * Alarm name: "block_{id}"
 * @param {object} block  { id, title, start }  start = decimal hours
 * @param {string} date   "YYYY-MM-DD"
 */
function registerBlockAlarm(block, date) {
  try {
    if (block.start === undefined || block.start === null) return;

    // Build the target fire time
    const [year, month, day] = date.split('-').map(Number);
    const totalMinutes = Math.round(block.start * 60) - 5; // 5 min before
    const fireDate = new Date(year, month - 1, day, 0, totalMinutes, 0, 0);

    // Don't register if the time is already in the past
    if (fireDate.getTime() <= Date.now()) return;

    chrome.alarms.create(`block_${block.id}`, {
      when: fireDate.getTime(),
    });

    console.log(`[SW] Block alarm registered: "${block.title}" at`, fireDate.toLocaleTimeString());
  } catch (err) {
    console.error('[SW] registerBlockAlarm failed:', err);
  }
}

/**
 * Cancel a block alarm by block id.
 * @param {string} blockId
 */
function cancelBlockAlarm(blockId) {
  clearAlarmSafe(`block_${blockId}`);
}

// ─── Notification helpers ──────────────────────────────────────────────────────

let notifIdCounter = 0;

function createNotification(id, title, message, buttons = []) {
  const options = {
    type:     'basic',
    iconUrl:  chrome.runtime.getURL('assets/icons/128.png'),
    title,
    message,
    priority: 1,
  };

  // Chrome supports buttons in notifications (up to 2)
  if (buttons.length > 0) {
    options.buttons = buttons.slice(0, 2);
  }

  chrome.notifications.create(id, options, () => {
    if (chrome.runtime.lastError) {
      console.error('[SW] Notification error:', chrome.runtime.lastError);
    }
  });
}

// ─── Alarm handlers ────────────────────────────────────────────────────────────

async function handleMorningRitual() {
  try {
    const vision = await swGet('vision');
    const visionText = vision?.text ?? '';
    const message = visionText.trim().length > 0
      ? visionText.trim().slice(0, 80) + (visionText.trim().length > 80 ? '…' : '')
      : 'Tap to open your vision board';

    createNotification('clarity_morning', 'Good morning — review your vision', message, [
      { title: 'Open vision' },
    ]);
  } catch (err) {
    console.error('[SW] handleMorningRitual failed:', err);
  }
}

async function handleNightReview() {
  try {
    createNotification('clarity_night', 'Night review', 'Check tomorrow\'s plan and review today', [
      { title: 'Open planner' },
    ]);
  } catch (err) {
    console.error('[SW] handleNightReview failed:', err);
  }
}

async function handleNextDayPrep() {
  try {
    const tomorrow = dateKey(1);
    const tasks = await swGet(`tasks_${tomorrow}`);
    const count = Array.isArray(tasks) ? tasks.length : 0;
    const message = count > 0
      ? `${count} task${count === 1 ? '' : 's'} scheduled for tomorrow`
      : 'No tasks scheduled yet — plan your tomorrow';

    createNotification('clarity_prep', "Tomorrow's plan", message, [
      { title: 'View tomorrow' },
    ]);
  } catch (err) {
    console.error('[SW] handleNextDayPrep failed:', err);
  }
}

async function handleBlockAlarm(alarmName) {
  try {
    // Extract block id from alarm name: "block_{id}"
    const blockId = alarmName.slice('block_'.length);

    // Search today's and tomorrow's blocks for this id
    for (const date of [todayKey(), dateKey(1)]) {
      const blocks = await swGet(`blocks_${date}`);
      if (!Array.isArray(blocks)) continue;
      const block = blocks.find((b) => b.id === blockId);
      if (block) {
        createNotification(
          `clarity_block_${blockId}`,
          `⏰ Starting soon: ${block.title}`,
          `"${block.title}" (${block.cat || 'Block'}) starts in 5 minutes`,
        );
        return;
      }
    }

    console.warn(`[SW] Block alarm fired but block not found: ${blockId}`);
  } catch (err) {
    console.error('[SW] handleBlockAlarm failed:', err);
  }
}

async function handleTimerCompleteAlarm() {
  try {
    const state = await swGet('timer_state');
    if (!state || !state.running || !state.targetTime) return;

    // Verify that targetTime has passed
    const timeDiff = Date.now() - state.targetTime;
    if (timeDiff < -2000) {
      return; // Too early or reset
    }

    const mode = state.mode;
    const focusCount = state.focusCount ?? 0;
    const totalToday = state.totalToday ?? 0;

    let title = '';
    let msg = '';
    let nextMode = 'focus';
    let nextFocusCount = focusCount;
    let nextTotalToday = totalToday;

    const MODES = {
      focus:       { label: 'Focus',        seconds: 25 * 60 },
      short_break: { label: 'Short Break',  seconds:  5 * 60 },
      long_break:  { label: 'Long Break',   seconds: 15 * 60 },
    };
    const SESSIONS_PER_CYCLE = 4;

    if (mode === 'focus') {
      const logs = (await swGet('timer_logs')) ?? [];
      const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        date: todayKey(),
        label: state.label?.trim() || 'Focus session',
        mode: 'focus',
        duration: MODES.focus.seconds,
        completedAt: new Date().toISOString(),
      };
      logs.push(entry);
      await swSet('timer_logs', logs);

      nextFocusCount = (focusCount + 1) % SESSIONS_PER_CYCLE;
      nextTotalToday = totalToday + 1;

      if (nextFocusCount === 0) {
        nextMode = 'long_break';
        title = 'Focus cycle complete! 🎉';
        msg = 'Time for a well-deserved long break (15 mins).';
      } else {
        nextMode = 'short_break';
        title = 'Focus session complete! 🎯';
        msg = 'Time for a short break (5 mins).';
      }
    } else {
      nextMode = 'focus';
      title = 'Break over! ☕';
      msg = 'Ready to start focusing?';
    }

    const newState = {
      ...state,
      running: false,
      mode: nextMode,
      remaining: MODES[nextMode].seconds,
      targetTime: null,
      focusCount: nextFocusCount,
      totalToday: nextTotalToday,
      label: nextMode === 'focus' ? '' : state.label
    };
    await swSet('timer_state', newState);

    createNotification('clarity_timer_complete', title, msg, [
      { title: nextMode === 'focus' ? 'Start Focus' : 'Start Break' }
    ]);
  } catch (err) {
    console.error('[SW] handleTimerCompleteAlarm failed:', err);
  }
}

// ─── Event listeners ───────────────────────────────────────────────────────────

// Install — register alarms immediately
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[SW] onInstalled:', details.reason);
  await registerDailyAlarms();

  // Set default settings if not present
  const existing = await swGet('settings');
  if (!existing) {
    await swSet('settings', { morningTime: '07:00', nightTime: '22:00', theme: 'light' });
  }

  // Initialize default yearly themes if not present
  const themes = await swGet('yearly_themes');
  if (!themes) {
    await swSet(
      'yearly_themes',
      Array.from({ length: 12 }, (_, i) => ({ month: i + 1, theme: '' }))
    );
  }
});

// Startup — re-register alarms (SW can be killed and restarted)
chrome.runtime.onStartup.addListener(async () => {
  console.log('[SW] onStartup — re-registering daily alarms');
  await registerDailyAlarms();
});

// Daily midnight re-registration via a dedicated midnight alarm
chrome.runtime.onInstalled.addListener(() => {
  // Register a midnight alarm to re-register daily alarms each day
  chrome.alarms.create('midnight_reregister', {
    when: (() => {
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0); // next midnight
      return midnight.getTime();
    })(),
    periodInMinutes: 24 * 60,
  });
});

// Alarm fires
chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log('[SW] Alarm fired:', alarm.name);

  switch (alarm.name) {
    case ALARM_MORNING:
      await handleMorningRitual();
      break;

    case ALARM_NIGHT:
      await handleNightReview();
      break;

    case ALARM_PREP:
      await handleNextDayPrep();
      break;

    case 'midnight_reregister':
      // Re-register daily alarms each midnight in case settings changed
      await registerDailyAlarms();
      await syncHabitsForNext7DaysSW();
      break;

    case 'timer_complete':
      await handleTimerCompleteAlarm();
      break;

    default:
      // Per-block alarm
      if (alarm.name.startsWith('block_')) {
        await handleBlockAlarm(alarm.name);
      }
      break;
  }
});

// Notification button clicks
chrome.notifications.onButtonClicked.addListener((notifId, buttonIndex) => {
  console.log('[SW] Notification button clicked:', notifId, buttonIndex);

  // Morning: button 0 → Open vision
  if (notifId === 'clarity_morning') {
    chrome.tabs.create({ url: PAGES.vision });
  }
  // Night: button 0 → Open planner
  else if (notifId === 'clarity_night') {
    chrome.tabs.create({ url: PAGES.planner });
  }
  // Prep: button 0 → View tomorrow (opens planner)
  else if (notifId === 'clarity_prep') {
    chrome.tabs.create({ url: PAGES.planner });
  }
  // Block reminders — open dashboard
  else if (notifId.startsWith('clarity_block_')) {
    chrome.tabs.create({ url: PAGES.dashboard });
  }
  // Timer complete — open tracker
  else if (notifId === 'clarity_timer_complete') {
    chrome.tabs.create({ url: PAGES.tracker });
  }

  // Dismiss the notification
  chrome.notifications.clear(notifId);
});

// Notification click (body click) — same behaviour as button 0
chrome.notifications.onClicked.addListener((notifId) => {
  if (notifId === 'clarity_morning') {
    chrome.tabs.create({ url: PAGES.vision });
  } else if (notifId === 'clarity_night' || notifId === 'clarity_prep') {
    chrome.tabs.create({ url: PAGES.planner });
  } else if (notifId.startsWith('clarity_block_')) {
    chrome.tabs.create({ url: PAGES.dashboard });
  } else if (notifId === 'clarity_timer_complete') {
    chrome.tabs.create({ url: PAGES.tracker });
  }
  chrome.notifications.clear(notifId);
});

// Quick-capture keyboard command
chrome.commands.onCommand.addListener((command) => {
  if (command === 'quick-capture') {
    chrome.windows.create({
      url:    chrome.runtime.getURL('capture/capture.html'),
      type:   'popup',
      width:  400,
      height: 180,
    });
  }
});

// Message API — allow pages to register/cancel block alarms without
// needing direct access to the alarm API from a page context.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;

  switch (message.type) {
    case 'REGISTER_BLOCK_ALARM':
      // { type, block: { id, title, start }, date }
      if (message.block && message.date) {
        registerBlockAlarm(message.block, message.date);
        sendResponse({ ok: true });
      }
      break;

    case 'CANCEL_BLOCK_ALARM':
      // { type, blockId }
      if (message.blockId) {
        cancelBlockAlarm(message.blockId);
        sendResponse({ ok: true });
      }
      break;

    case 'RESCHEDULE_DAILY_ALARMS':
      // Called when settings change
      registerDailyAlarms().then(() => sendResponse({ ok: true }));
      return true; // async response

    case 'GET_PAGES':
      sendResponse(PAGES);
      break;

    case 'SYNC_HABITS':
      syncHabitsForNext7DaysSW().then(() => sendResponse({ ok: true }));
      return true; // async response

    default:
      console.warn('[SW] Unknown message type:', message.type);
  }
});

console.log('[SW] Clarity service worker loaded.');

// ─── Habit Tracker service-worker sync ─────────────────────────────────────────

function swParseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function swFormatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function swGetMonthDates(year, monthIndex, count) {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const selectedDays = [];
  const c = Math.min(count, daysInMonth);
  for (let i = 0; i < daysInMonth; i++) {
    const val1 = Math.floor((i * c) / daysInMonth);
    const val2 = Math.floor(((i - 1) * c) / daysInMonth);
    if (i === 0 || val1 !== val2) {
      selectedDays.push(i + 1);
    }
  }
  return selectedDays;
}

const SW_WEEK_DISTRIBUTIONS = {
  1: ["Wed"],
  2: ["Tue", "Thu"],
  3: ["Mon", "Wed", "Fri"],
  4: ["Mon", "Wed", "Fri", "Sun"],
  5: ["Mon", "Tue", "Thu", "Fri", "Sun"],
  6: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  7: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
};

const SW_WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function swGenerateHabitInstances(habit, dateRange) {
  if (habit.status !== 'active') return [];

  const instances = [];
  const startLocal = swParseLocalDate(habit.goal.startDate);
  
  let endLocal = null;
  if (habit.goal.type !== 'ongoing' && habit.goal.durationDays) {
    endLocal = new Date(startLocal);
    endLocal.setDate(endLocal.getDate() + habit.goal.durationDays - 1);
  }

  for (const dateStr of dateRange) {
    const curLocal = swParseLocalDate(dateStr);

    if (curLocal < startLocal) continue;
    if (endLocal && curLocal > endLocal) continue;

    let isScheduled = false;
    const recurrence = habit.recurrence || {};

    switch (recurrence.type) {
      case 'daily':
        isScheduled = true;
        break;

      case 'specificDays':
        if (recurrence.days && Array.isArray(recurrence.days)) {
          const wd = SW_WEEKDAY_NAMES[curLocal.getDay()];
          isScheduled = recurrence.days.includes(wd);
        }
        break;

      case 'everyOtherDay': {
        const msDiff = curLocal.getTime() - startLocal.getTime();
        const daysDiff = Math.round(msDiff / (24 * 60 * 60 * 1000));
        isScheduled = (daysDiff >= 0 && daysDiff % 2 === 0);
        break;
      }

      case 'xPerWeek': {
        const count = Math.min(7, Math.max(1, recurrence.countPerPeriod || 1));
        const activeDays = SW_WEEK_DISTRIBUTIONS[count] || ["Wed"];
        const curDayIndex = curLocal.getDay();
        const adjustedIdx = curDayIndex === 0 ? 7 : curDayIndex;
        const adjustedNames = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        const curDayName = adjustedNames[adjustedIdx];
        isScheduled = activeDays.includes(curDayName);
        break;
      }

      case 'xPerMonth': {
        const year = curLocal.getFullYear();
        const month = curLocal.getMonth();
        const day = curLocal.getDate();
        const count = recurrence.countPerPeriod || 1;
        const scheduledDays = swGetMonthDates(year, month, count);
        isScheduled = scheduledDays.includes(day);
        break;
      }
    }

    if (isScheduled && habit.timeSlots && Array.isArray(habit.timeSlots)) {
      for (const slot of habit.timeSlots) {
        const hasMultipleSlots = habit.timeSlots.length > 1;
        const slotSuffix = hasMultipleSlots ? ` (${slot.label || slot.time})` : '';
        instances.push({
          date: dateStr,
          time: slot.time,
          title: `${habit.name}${slotSuffix}`,
          habitId: habit.id,
          slotLabel: slot.label || ''
        });
      }
    }
  }

  return instances;
}

function swRecalculateHabitStreaks(habit, todayStr) {
  const startDateStr = habit.goal.startDate;
  if (todayStr < startDateStr) {
    return { current: 0, longest: habit.streak?.longest || 0, lastCompletedDate: habit.streak?.lastCompletedDate || null };
  }

  const start = swParseLocalDate(startDateStr);
  const end = swParseLocalDate(todayStr);
  const dates = [];
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(swFormatLocalDate(cur));
    cur.setDate(cur.getDate() + 1);
  }

  const scheduledDates = new Set();
  const instances = swGenerateHabitInstances(habit, dates);
  for (const inst of instances) {
    scheduledDates.add(inst.date);
  }

  const sortedScheduled = Array.from(scheduledDates).sort((a, b) => b.localeCompare(a));

  let currentStreak = 0;
  let lastCompletedDate = habit.streak?.lastCompletedDate || null;

  for (const date of sortedScheduled) {
    const dayCompletions = habit.completions?.[date] || {};
    const slots = habit.timeSlots || [];
    const isCompleted = slots.length > 0 && slots.every(s => dayCompletions[s.time] === true);

    if (date === todayStr) {
      if (isCompleted) {
        currentStreak++;
        if (!lastCompletedDate || date > lastCompletedDate) {
          lastCompletedDate = date;
        }
      }
    } else {
      if (isCompleted) {
        currentStreak++;
        if (!lastCompletedDate || date > lastCompletedDate) {
          lastCompletedDate = date;
        }
      } else {
        break;
      }
    }
  }

  let longest = habit.streak?.longest || 0;
  if (currentStreak > longest) {
    longest = currentStreak;
  }

  return { current: currentStreak, longest, lastCompletedDate };
}

async function syncHabitsForNext7DaysSW() {
  const todayStr = todayKey();
  const next7Days = [];
  for (let i = 0; i <= 7; i++) {
    next7Days.push(dateKey(i));
  }

  const result = await chrome.storage.local.get('habits');
  const habits = result.habits || [];
  let habitsChanged = false;

  // 1. Recalculate streaks and goals
  for (let i = 0; i < habits.length; i++) {
    const habit = habits[i];
    if (habit.status === 'active') {
      const updates = swRecalculateHabitStreaks(habit, todayStr);
      habit.streak = { ...habit.streak, ...updates };

      if (habit.goal && habit.goal.type !== 'ongoing' && habit.goal.durationDays) {
        const startLocal = swParseLocalDate(habit.goal.startDate);
        const todayLocal = swParseLocalDate(todayStr);
        const msDiff = todayLocal.getTime() - startLocal.getTime();
        const daysElapsed = Math.round(msDiff / (24 * 60 * 60 * 1000));
        
        if (daysElapsed >= habit.goal.durationDays) {
          habit.status = 'completed';
          habit.showCompletionCelebration = true;
        }
      }
      habitsChanged = true;
    }
  }

  if (habitsChanged) {
    await chrome.storage.local.set({ habits });
  }

  const activeHabits = habits.filter(h => h.status === 'active');
  if (activeHabits.length === 0) return;

  // 2. Generate and write tasks/blocks
  for (const habit of activeHabits) {
    const instances = swGenerateHabitInstances(habit, next7Days);
    for (const inst of instances) {
      const tKey = `tasks_${inst.date}`;
      const bKey = `blocks_${inst.date}`;

      const data = await chrome.storage.local.get([tKey, bKey]);
      const tasks = data[tKey] || [];
      const blocks = data[bKey] || [];

      let taskChanged = false;
      const taskExists = tasks.some(t => t.habitId === inst.habitId && t.habitTime === inst.time);
      if (!taskExists) {
        tasks.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          title: inst.title,
          done: false,
          priority: 3,
          timeEstimate: 15,
          category: habit.category,
          habitId: habit.id,
          habitTime: inst.time
        });
        taskChanged = true;
      }

      let blockChanged = false;
      const decStart = (() => {
        const [h, m] = inst.time.split(':').map(Number);
        return h + m / 60;
      })();
      const blockExists = blocks.some(b => b.habitId === inst.habitId && b.habitTime === inst.time);
      if (!blockExists) {
        blocks.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          title: inst.title,
          cat: habit.category,
          start: decStart,
          end: decStart + 0.25,
          habitId: habit.id,
          habitTime: inst.time
        });
        blockChanged = true;
      }

      if (taskChanged) {
        await chrome.storage.local.set({ [tKey]: tasks });
      }
      if (blockChanged) {
        await chrome.storage.local.set({ [bKey]: blocks });
      }
    }
  }
}
