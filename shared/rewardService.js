/**
 * Clarity — shared/rewardService.js
 * Earning logic, weekly decay, session logging, and timer widget for the Reward Time system.
 * ES Module.
 * Scoped to user ID.
 */

import { get, set, getAuth, generateId, todayKey } from './storage.js';

// ─── Configurable Constants ──────────────────────────────────────────────────
export const WORK_TO_REWARD_RATIO = 0.5; // 2:1 ratio (e.g. 60m focus = 30m reward)
export const DEFAULT_TASK_DURATION = 15;   // Default minutes if task has no timeEstimate
export const WEEKLY_DECAY_CAP = 120;       // Max reward minutes that carry over weekly

// ─── Subtask Support Configurable Constants ──────────────────────────────────
export const FLAT_TASK_DEFAULT = 15;       // Case 1: Standalone task default estimate
export const FLAT_SUBTASK_DEFAULT = 10;    // Case 2: Subtask default estimate
export const REWARD_RATIO = 0.5;           // Work-to-reward ratio (0.5 = 2:1)
export const USE_TIME_LOG_BONUS = true;    // Case 6: Time log bonus check enabled/disabled

// ─── Earning Logic ────────────────────────────────────────────────────────────

/**
 * Calculates reward minutes earned based on task duration.
 * @param {number} taskDurationMinutes 
 * @returns {number} Rounded earned minutes
 */
export function calculateEarnedMinutes(taskDurationMinutes) {
  return Math.round((taskDurationMinutes || DEFAULT_TASK_DURATION) * WORK_TO_REWARD_RATIO);
}

/**
 * Retrieves the current reward balance for the user.
 * @param {string} userId 
 * @returns {Promise<object>} Current balance object
 */
export async function getRewardBalance(userId) {
  let balance = await get('rewardBalance');
  const todayStr = todayKey();
  if (!balance) {
    balance = {
      userId: userId || '',
      minutesAvailable: 0,
      minutesEarnedThisWeek: 0,
      minutesSpentThisWeek: 0,
      lastResetDate: todayStr,
      updatedAt: Date.now()
    };
    await set('rewardBalance', balance);
  }
  return balance;
}

/**
 * Awards reward minutes to the user's balance.
 * @param {string} userId 
 * @param {number} minutes 
 * @returns {Promise<object>} Updated balance object
 */
export async function awardMinutes(userId, minutes) {
  if (minutes <= 0) return await getRewardBalance(userId);
  
  const balance = await getRewardBalance(userId);
  balance.minutesAvailable = (balance.minutesAvailable || 0) + minutes;
  balance.minutesEarnedThisWeek = (balance.minutesEarnedThisWeek || 0) + minutes;
  balance.updatedAt = Date.now();
  
  await set('rewardBalance', balance);
  return balance;
}

/**
 * Helper to award minutes directly from a completed task object.
 * (Deprecated: use handleTaskComplete instead. Preserved for backwards compatibility).
 * @param {string} userId 
 * @param {object} task 
 */
export async function awardMinutesForTask(userId, task) {
  return await handleTaskComplete(userId, task, false, true);
}

/**
 * Central function to handle task and subtask completion state transitions
 * and process reward payouts based on the five core rules.
 * 
 * @param {string} userId - The authenticated user ID.
 * @param {object} item - The task or subtask object being modified.
 * @param {boolean} isSubtask - True if completing a subtask, false if a parent task.
 * @param {boolean} isChecked - True if toggled to completed, false if toggled back to incomplete.
 * @param {object|null} parentTask - The parent task object (required for subtask validation).
 * @returns {Promise<object>} { earned: number, rule: number }
 */
export async function handleTaskComplete(userId, item, isSubtask, isChecked, parentTask = null) {
  // ───────────────────────────────────────────────────────────────────────────
  // Rule 5 — Task is being UN-completed (toggled back to incomplete):
  // → do NOT subtract reward minutes already earned.
  // → reward minutes are never taken back (keeps the system positive-only).
  // ───────────────────────────────────────────────────────────────────────────
  if (!isChecked) {
    console.log('[Reward Earning] Rule 5 triggered: Task toggled back to incomplete. No minutes subtracted.');
    return { earned: 0, rule: 5 };
  }

  // Determine Goal ID: Subtasks inherit from parentTask.
  const goalId = isSubtask ? parentTask?.linkedGoalId : item.linkedGoalId;

  // ───────────────────────────────────────────────────────────────────────────
  // Rule 4 — Any task or subtask with NO linkedGoalId:
  // → earn NOTHING — reward is tied to goal progress only.
  // ───────────────────────────────────────────────────────────────────────────
  if (!goalId) {
    console.log('[Reward Earning] Rule 4 triggered: Completion is not goal-linked. Earned 0 minutes.');
    return { earned: 0, rule: 4 };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rule 3 — Parent task completed AND it has subtasks:
  // → earn NOTHING — subtasks already paid out individually.
  // → just trigger goal progress recalculation as normal.
  // ───────────────────────────────────────────────────────────────────────────
  if (!isSubtask && item.subtasks && item.subtasks.length > 0) {
    console.log('[Reward Earning] Rule 3 triggered: Completed parent task has subtasks. Paid out on subtasks. Earned 0 minutes.');
    return { earned: 0, rule: 3 };
  }

  let durationMinutes = 0;

  if (isSubtask) {
    // ───────────────────────────────────────────────────────────────────────────
    // Rule 2 — Subtask completed, parent has linkedGoalId:
    // → earn minutes based on subtask.estimatedMinutes.
    // → if null/0, use FLAT_SUBTASK_DEFAULT (10m).
    // → inherit linkedGoalId from parent task.
    // ───────────────────────────────────────────────────────────────────────────
    durationMinutes = parseInt(item.estimatedMinutes, 10) || 0;
    if (durationMinutes <= 0) {
      durationMinutes = FLAT_SUBTASK_DEFAULT;
    }

    // Case 6: Time Log Bonus Lookup
    if (USE_TIME_LOG_BONUS) {
      const logs = (await get('timer_logs')) ?? [];
      const subtaskLogs = logs.filter(l => l.linkedId === item.id && l.mode === 'focus');
      const loggedSeconds = subtaskLogs.reduce((sum, l) => sum + (l.duration || 0), 0);
      const loggedMinutes = Math.floor(loggedSeconds / 60);

      if (loggedMinutes > durationMinutes) {
        const cap = durationMinutes * 1.5;
        const finalMinutes = Math.min(loggedMinutes, cap);
        console.log(`[Reward Earning] Rule 6 Bonus applied: Subtask duration boosted from ${durationMinutes} to ${finalMinutes} min due to tracker logs.`);
        durationMinutes = finalMinutes;
      }
    }
  } else {
    // ───────────────────────────────────────────────────────────────────────────
    // Rule 1 — Standalone task (no subtasks), has linkedGoalId:
    // → earn minutes based on task.estimatedMinutes (or fallback task.timeEstimate).
    // → if task.estimatedMinutes is null/0, use FLAT_TASK_DEFAULT (15m).
    // ───────────────────────────────────────────────────────────────────────────
    const estimate = item.estimatedMinutes !== undefined ? item.estimatedMinutes : item.timeEstimate;
    durationMinutes = parseInt(estimate, 10) || 0;
    if (durationMinutes <= 0) {
      durationMinutes = FLAT_TASK_DEFAULT;
    }

    // Case 6: Time Log Bonus Lookup
    if (USE_TIME_LOG_BONUS) {
      const logs = (await get('timer_logs')) ?? [];
      const taskLogs = logs.filter(l => l.linkedId === item.id && l.mode === 'focus');
      const loggedSeconds = taskLogs.reduce((sum, l) => sum + (l.duration || 0), 0);
      const loggedMinutes = Math.floor(loggedSeconds / 60);

      if (loggedMinutes > durationMinutes) {
        const cap = durationMinutes * 1.5;
        const finalMinutes = Math.min(loggedMinutes, cap);
        console.log(`[Reward Earning] Rule 6 Bonus applied: Task duration boosted from ${durationMinutes} to ${finalMinutes} min due to tracker logs.`);
        durationMinutes = finalMinutes;
      }
    }
  }

  // Calculate earned reward time using ratio
  const earnedMinutes = Math.round(durationMinutes * REWARD_RATIO);

  if (earnedMinutes > 0) {
    await awardMinutes(userId, earnedMinutes);
    console.log(`[Reward Earning] Awarded ${earnedMinutes} minutes. Available increased.`);
  }

  return { earned: earnedMinutes, rule: isSubtask ? 2 : 1 };
}

// ─── Weekly Decay ─────────────────────────────────────────────────────────────

/**
 * Checks if a week has passed since lastResetDate.
 * If yes, resets weekly progress stats and applies a soft cap to available minutes.
 * @param {string} userId 
 * @returns {Promise<object>} Updated balance object
 */
export async function checkAndResetWeekly(userId) {
  const balance = await getRewardBalance(userId);
  const todayStr = todayKey();
  
  if (!balance.lastResetDate) {
    balance.lastResetDate = todayStr;
    balance.updatedAt = Date.now();
    await set('rewardBalance', balance);
    return balance;
  }
  
  // Calculate difference in days (start of day T00:00:00 to avoid timezone errors)
  const d1 = new Date(balance.lastResetDate + 'T00:00:00');
  const d2 = new Date(todayStr + 'T00:00:00');
  const diffTime = d2.getTime() - d1.getTime();
  const daysPassed = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  if (daysPassed >= 7) {
    // Reset weekly stats
    balance.minutesEarnedThisWeek = 0;
    balance.minutesSpentThisWeek = 0;
    
    // Apply soft cap to available minutes
    if (balance.minutesAvailable > WEEKLY_DECAY_CAP) {
      balance.minutesAvailable = WEEKLY_DECAY_CAP;
    }
    
    balance.lastResetDate = todayStr;
    balance.updatedAt = Date.now();
    
    await set('rewardBalance', balance);
  }
  
  return balance;
}

// ─── Session Management ───────────────────────────────────────────────────────

/**
 * Deducts minutes and starts a reward session.
 * Saves the session log and registers it as the active session.
 * @param {string} userId 
 * @param {number} minutesChosen 
 * @param {string} label 
 */
export async function startRewardSession(userId, minutesChosen, label) {
  const balance = await getRewardBalance(userId);
  
  // Subtract chosen minutes immediately (cap at 0)
  const cost = Math.min(balance.minutesAvailable, minutesChosen);
  balance.minutesAvailable = Math.max(0, balance.minutesAvailable - cost);
  balance.minutesSpentThisWeek = (balance.minutesSpentThisWeek || 0) + cost;
  balance.updatedAt = Date.now();
  await set('rewardBalance', balance);
  
  const sessionId = generateId();
  const sessionDoc = {
    id: sessionId,
    userId: userId,
    minutesUsed: cost,
    startedAt: new Date().toISOString(),
    completedAt: null,
    label: label || null
  };
  
  // Save to rewardSessions log
  const sessions = (await get('rewardSessions')) || [];
  sessions.push(sessionDoc);
  await set('rewardSessions', sessions);
  
  // Save active timer reference
  const activeSession = {
    id: sessionId,
    userId: userId,
    minutesChosen: cost,
    label: label || null,
    startedAt: sessionDoc.startedAt
  };
  await set('activeRewardSession', activeSession);
  
  return activeSession;
}

/**
 * Concludes the active reward session.
 * Refunds unused minutes back to balance if cancelled early.
 * @param {string} userId 
 * @param {boolean} cancelEarly 
 */
export async function endActiveSession(userId, cancelEarly = false) {
  const activeSession = await get('activeRewardSession');
  if (!activeSession) return;
  
  const sessions = (await get('rewardSessions')) || [];
  const idx = sessions.findIndex(s => s.id === activeSession.id);
  
  const nowStr = new Date().toISOString();
  
  if (idx !== -1) {
    const session = sessions[idx];
    const elapsedMs = Date.now() - new Date(session.startedAt).getTime();
    
    // Ceiling round used time to nearest minute, capped between 0 and chosen minutes
    const actualMinutesUsed = Math.min(
      activeSession.minutesChosen,
      Math.max(0, Math.ceil(elapsedMs / 60000))
    );
    
    session.minutesUsed = actualMinutesUsed;
    session.completedAt = nowStr;
    
    // Process refund if stopped early
    if (cancelEarly) {
      const refundMinutes = activeSession.minutesChosen - actualMinutesUsed;
      if (refundMinutes > 0) {
        const balance = await getRewardBalance(userId);
        balance.minutesAvailable = (balance.minutesAvailable || 0) + refundMinutes;
        // Deduct refunded time from weekly spent stats so it's accurate
        balance.minutesSpentThisWeek = Math.max(0, (balance.minutesSpentThisWeek || 0) - refundMinutes);
        balance.updatedAt = Date.now();
        await set('rewardBalance', balance);
      }
    }
    
    await set('rewardSessions', sessions);
  }
  
  // Clear active session state
  await set('activeRewardSession', null);
}

// ─── Floating Countdown Timer Widget ─────────────────────────────────────────

let timerInterval = null;

/**
 * Initializes the floating countdown widget on page load/storage updates.
 */
export async function initRewardTimerWidget() {
  const auth = await getAuth();
  if (!auth) {
    removeTimerWidgetDOM();
    return;
  }
  
  const userId = auth.localId;
  
  // 1. Initial render check
  await updateTimerWidgetState(userId);
  
  // 2. Setup storage change listener to sync across tabs
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes['activeRewardSession']) {
      await updateTimerWidgetState(userId);
    }
  });

  // 3. Listen for reward minutes earned custom events to show toast feedback
  if (typeof window !== 'undefined') {
    window.addEventListener('reward-minutes-earned', (e) => {
      const { taskId, subId, minutes } = e.detail;
      if (minutes > 0) {
        showEarnedToast(taskId, subId, minutes);
      }
    });
  }
}

/**
 * Updates the UI widget state based on current activeRewardSession.
 * @param {string} userId 
 */
async function updateTimerWidgetState(userId) {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  const activeSession = await get('activeRewardSession');
  if (!activeSession || activeSession.userId !== userId) {
    removeTimerWidgetDOM();
    return;
  }
  
  // Calculate remaining time
  const totalMs = activeSession.minutesChosen * 60 * 1000;
  const elapsedMs = Date.now() - new Date(activeSession.startedAt).getTime();
  
  if (elapsedMs >= totalMs) {
    // Already expired
    await endActiveSession(userId, false);
    showSessionEndNotification();
    removeTimerWidgetDOM();
    return;
  }
  
  // Render or update widget
  mountTimerWidgetDOM(activeSession, userId);
}

/**
 * Creates and inserts the widget DOM if not present.
 * @param {object} session 
 * @param {string} userId 
 */
function mountTimerWidgetDOM(session, userId) {
  let widget = document.getElementById('reward-timer-widget');
  if (!widget) {
    widget = document.createElement('div');
    widget.id = 'reward-timer-widget';
    widget.className = 'reward-timer-widget';
    widget.innerHTML = `
      <span class="reward-timer-icon">⏱</span>
      <div class="reward-timer-text">
        <span class="reward-timer-time" id="reward-timer-time">00:00</span>
        <span class="reward-timer-divider">—</span>
        <span class="reward-timer-label" id="reward-timer-label">Break</span>
      </div>
      <button class="reward-timer-close" id="btn-end-reward-early" title="End session early">×</button>
    `;
    document.body.appendChild(widget);
    
    // Bind stop click
    const btnStop = widget.querySelector('#btn-end-reward-early');
    btnStop.onclick = async () => {
      if (confirm('End reward session early? Any unused full minutes will be refunded.')) {
        await endActiveSession(userId, true);
        removeTimerWidgetDOM();
      }
    };
  }
  
  // Update static fields
  const labelEl = widget.querySelector('#reward-timer-label');
  labelEl.textContent = session.label || 'Break';
  
  // Start ticks
  const timeEl = widget.querySelector('#reward-timer-time');
  const totalMs = session.minutesChosen * 60 * 1000;
  const startedTime = new Date(session.startedAt).getTime();
  
  const tick = async () => {
    const elapsed = Date.now() - startedTime;
    const remaining = totalMs - elapsed;
    
    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      await endActiveSession(userId, false);
      showSessionEndNotification();
      removeTimerWidgetDOM();
      return;
    }
    
    const totalSeconds = Math.ceil(remaining / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    timeEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  
  tick(); // First run immediate
  timerInterval = setInterval(tick, 1000);
}

/**
 * Removes the widget DOM from the document.
 */
function removeTimerWidgetDOM() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  const widget = document.getElementById('reward-timer-widget');
  if (widget) {
    widget.remove();
  }
}

/**
 * Triggers native system notifications and an in-page soft overlay.
 */
function showSessionEndNotification() {
  // 1. Chrome Native system notification
  try {
    chrome.notifications.create('reward-time-up-' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/128.png'),
      title: "Reward Time's Up!",
      message: "Reward time's up! Back to it when you're ready.",
      priority: 1
    });
  } catch (err) {
    console.error('[RewardTimer] Failed to trigger Chrome system notification:', err);
  }

  // 2. Soft in-page modal/overlay notification
  try {
    showSoftInPageNotification();
  } catch (err) {
    console.error('[RewardTimer] Failed to render in-page notification:', err);
  }
}

/**
 * Appends a soft, neutral notification dialog directly to the active page body.
 */
function showSoftInPageNotification() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (document.getElementById('reward-ended-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'reward-ended-modal';
  overlay.style.cssText = "position: fixed; inset: 0; background: rgba(15, 23, 42, 0.65); display: flex; align-items: center; justify-content: center; z-index: 999999; padding: 16px;";
  
  overlay.innerHTML = `
    <div style="background: var(--color-surface, #ffffff); border: 1px solid var(--color-border, #e2e8f0); border-top: 4px solid var(--color-accent, #6366f1); border-radius: 12px; width: 100%; max-width: 320px; padding: 20px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15); text-align: center; animation: dialogPop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);">
      <div style="font-size: 15px; font-weight: 600; color: var(--color-text, #1e293b); margin-bottom: 8px;">⏱ Reward Time's Up!</div>
      <div style="font-size: 13px; color: var(--color-text-muted, #64748b); line-height: 1.5; margin-bottom: 20px;">Reward time's up! Back to it when you're ready.</div>
      <div style="display: flex; justify-content: center;">
        <button id="btn-close-ended-notif" style="padding: 6px 20px; font-size: 12px; font-weight: 500; border-radius: 6px; cursor: pointer; border: 1px solid var(--color-accent, #6366f1); background: var(--color-accent, #6366f1); color: #ffffff; transition: opacity 0.15s ease;">Got it</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const btnClose = overlay.querySelector('#btn-close-ended-notif');
  btnClose.onclick = () => {
    overlay.remove();
  };
}

/**
 * Creates and displays a viewport-relative toast notification when reward minutes are earned.
 * 
 * @param {string} taskId - The parent task ID.
 * @param {string|null} subId - The subtask ID if Rule 2, or null.
 * @param {number} minutes - The earned reward minutes to display.
 */
export function showEarnedToast(taskId, subId, minutes) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  
  // Find task or subtask DOM element checkbox
  let targetEl = null;
  if (subId) {
    targetEl = document.querySelector(`[data-sub-id="${subId}"], [data-id="${subId}"], [data-parent-id="${taskId}"][data-id="${subId}"]`);
  } else {
    // Look for checkbox with this task id that isn't a subtask checkbox
    targetEl = document.querySelector(`[data-id="${taskId}"]:not([data-parent-id]):not([data-task-id]), .priority-item-check[data-id="${taskId}"], .dash-task-check[data-id="${taskId}"]`);
  }
  
  // Fallback to task row or parent element if checkbox element is not rendered or found
  if (!targetEl) {
    targetEl = document.querySelector(`[data-id="${taskId}"]`) || document.querySelector(`[data-task-id="${taskId}"]`);
  }

  if (!targetEl) return;

  const rect = targetEl.getBoundingClientRect();
  const toast = document.createElement('div');
  toast.className = 'reward-earned-toast';
  toast.textContent = `+${minutes} min reward earned 🎮`;
  
  // Position toast directly above the target element row/checkbox
  toast.style.cssText = `
    position: fixed;
    top: ${rect.top - 28}px;
    left: ${rect.left + 16}px;
    z-index: 100000;
    background: var(--color-success-soft, #f0fdf4);
    color: var(--color-success, #16a34a);
    border: 1px solid var(--color-success, #16a34a);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    pointer-events: none;
    transition: opacity 0.3s ease, transform 0.3s ease;
    transform: translateY(4px);
    opacity: 0;
  `;
  
  document.body.appendChild(toast);
  
  // Trigger transition animation
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });
  
  // Fade out and remove
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-4px)';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 2200); // 2.2s visible + 0.3s fade = 2.5s total duration
}
