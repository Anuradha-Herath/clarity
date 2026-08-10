import { get, set, todayKey, dateKey, generateId, getSettings } from './storage.js';
import { showConfirm } from './dialog.js';

/**
 * Update the streak logic
 */
async function recordRitualCompletion() {
  try {
    const settings = await getSettings();
    const streaks = settings.streaks || { ritualStreak: 0, lastRitualDate: '', longestStreak: 0 };
    
    const today = todayKey();
    const yesterday = dateKey(-1);
    
    if (streaks.lastRitualDate === today) {
      // Already recorded today, do nothing
      return;
    }
    
    if (streaks.lastRitualDate === yesterday) {
      // Streak continues
      streaks.ritualStreak += 1;
    } else {
      // Streak broken, start new
      streaks.ritualStreak = 1;
    }
    
    streaks.lastRitualDate = today;
    if (streaks.ritualStreak > streaks.longestStreak) {
      streaks.longestStreak = streaks.ritualStreak;
    }
    
    await set('settings', { ...settings, streaks });
  } catch (err) {
    console.error('[Rituals] Failed to record completion', err);
  }
}

/**
 * Save a plan
 */
async function savePlan(dateStr, tasks, startTime, isMorning = false) {
  const planKey = `ritualPlans_${dateStr}`;
  const existingPlan = await get(planKey) || {};
  
  const plan = {
    id: existingPlan.id || generateId(),
    date: dateStr,
    tasks: tasks.map(t => ({ taskId: t.taskId || null, title: t.title })),
    plannedStartTime: startTime || null,
    nightNudgeCompletedAt: isMorning ? existingPlan.nightNudgeCompletedAt : new Date().toISOString(),
    morningPulseCompletedAt: isMorning ? new Date().toISOString() : existingPlan.morningPulseCompletedAt || null,
    morningPulseConfirmed: isMorning,
    createdAt: existingPlan.createdAt || new Date().toISOString()
  };
  
  await set(planKey, plan);
  await recordRitualCompletion();
}

/**
 * Remove pending ritual
 */
async function clearPendingRitual() {
  await set('pendingRitual', null);
}

// ─── UI Rendering ─────────────────────────────────────────────────────────────

let overlayEl = null;

function createOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.className = 'ritual-overlay';
  document.body.appendChild(overlayEl);
  
  // Need to force reflow for opacity transition
  overlayEl.offsetHeight; 
  return overlayEl;
}

function closeOverlay() {
  if (overlayEl) {
    overlayEl.classList.remove('active');
    setTimeout(() => {
      overlayEl.remove();
      overlayEl = null;
    }, 300);
  }
}

export async function mountNightNudge() {
  const overlay = createOverlay();
  const tomorrow = dateKey(1);
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  
  const existingTasks = await get(`tasks_${tomorrow}`) || [];
  const options = existingTasks.map(t => `<option value="${escapeHtml(t.title)}" data-id="${t.id}"></option>`).join('');
  
  overlay.innerHTML = `
    <div class="ritual-container">
      <div class="ritual-greeting">Good evening, Anuradha.</div>
      <div class="ritual-date">Tomorrow is ${dateStr}.</div>
      
      <div class="ritual-prompt">What are your 3 most important tasks?</div>
      
      <datalist id="night-nudge-tasks">${options}</datalist>
      
      <div class="ritual-tasks-list">
        <input type="text" class="ritual-task-input" id="nn-task-1" list="night-nudge-tasks" placeholder="Task 1" />
        <input type="text" class="ritual-task-input" id="nn-task-2" list="night-nudge-tasks" placeholder="Task 2" />
        <input type="text" class="ritual-task-input" id="nn-task-3" list="night-nudge-tasks" placeholder="Task 3" />
      </div>
      
      <div class="ritual-start-time">
        <span class="text-sm text-muted">When do you want to start? (Optional)</span>
        <input type="time" id="nn-time" class="input input-sm" value="08:00" />
      </div>
      
      <div class="ritual-actions">
        <button class="btn btn-ghost" id="nn-cancel">Cancel</button>
        <button class="btn btn-primary" id="nn-done">Done for tonight &rarr;</button>
      </div>
    </div>
  `;
  
  overlay.classList.add('active');
  
  document.getElementById('nn-cancel').addEventListener('click', () => {
    closeOverlay();
    clearPendingRitual();
  });
  
  document.getElementById('nn-done').addEventListener('click', async () => {
    const t1 = document.getElementById('nn-task-1').value.trim();
    const t2 = document.getElementById('nn-task-2').value.trim();
    const t3 = document.getElementById('nn-task-3').value.trim();
    
    const tasks = [t1, t2, t3].filter(t => t).map(title => ({ title }));
    
    if (tasks.length === 0) {
      const confirmed = await showConfirm("No tasks listed — are you sure you want to save an empty plan?", "Empty Plan");
      if (!confirmed) {
        return;
      }
    }
    
    const startTime = document.getElementById('nn-time').value;
    await savePlan(tomorrow, tasks, startTime, false);
    
    const container = overlay.querySelector('.ritual-container');
    container.innerHTML = `
      <div style="text-align:center; padding: 2rem;">
        <div style="font-size: 2rem; margin-bottom: 1rem;">🌙</div>
        <div class="ritual-greeting" style="margin:0">Plan set. Rest well.</div>
      </div>
    `;
    
    await clearPendingRitual();
    setTimeout(closeOverlay, 2000);
  });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function mountMorningPulse() {
  const overlay = createOverlay();
  const today = todayKey();
  
  const planKey = `ritualPlans_${today}`;
  const plan = await get(planKey);
  
  if (!plan || !plan.tasks || plan.tasks.length === 0) {
    // Missed night nudge - do it now
    return mountAdjustMode(overlay, today, [], '08:00');
  }
  
  renderConfirmMode(overlay, today, plan);
  overlay.classList.add('active');
}

function renderConfirmMode(overlay, today, plan) {
  const tasksHtml = plan.tasks.map((t, i) => `
    <div class="ritual-task-slot">
      <div class="checkbox"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
      <div class="ritual-task-input readonly">${escapeHtml(t.title)}</div>
    </div>
  `).join('');
  
  overlay.innerHTML = `
    <div class="ritual-container">
      <div class="ritual-greeting">Good morning.</div>
      <div class="ritual-prompt">Here's your plan for today.</div>
      
      <div class="ritual-tasks-list">
        ${tasksHtml}
      </div>
      
      ${plan.plannedStartTime ? `<div class="ritual-date">Start time: ${plan.plannedStartTime}</div>` : ''}
      
      <div class="ritual-actions">
        <button class="btn btn-ghost" id="mp-adjust">Adjust</button>
        <button class="btn btn-primary" id="mp-done">Looks good — let's go &rarr;</button>
      </div>
    </div>
  `;
  
  document.getElementById('mp-adjust').addEventListener('click', () => {
    mountAdjustMode(overlay, today, plan.tasks, plan.plannedStartTime);
  });
  
  document.getElementById('mp-done').addEventListener('click', async () => {
    await savePlan(today, plan.tasks, plan.plannedStartTime, true);
    
    const container = overlay.querySelector('.ritual-container');
    container.innerHTML = `
      <div style="text-align:center; padding: 2rem;">
        <div style="font-size: 2rem; margin-bottom: 1rem;">☀️</div>
        <div class="ritual-greeting" style="margin:0">Let's go.</div>
      </div>
    `;
    
    await clearPendingRitual();
    setTimeout(closeOverlay, 1500);
  });
}

async function mountAdjustMode(overlay, dateStr, currentTasks, defaultTime) {
  const existingTasks = await get(`tasks_${dateStr}`) || [];
  const options = existingTasks.map(t => `<option value="${escapeHtml(t.title)}"></option>`).join('');
  
  const t1 = currentTasks[0]?.title || '';
  const t2 = currentTasks[1]?.title || '';
  const t3 = currentTasks[2]?.title || '';
  
  overlay.innerHTML = `
    <div class="ritual-container">
      <div class="ritual-greeting">Good morning.</div>
      <div class="ritual-prompt">${currentTasks.length === 0 ? "No plan from last night — pick 3 things right now." : "Adjust your plan for today."}</div>
      
      <datalist id="morning-pulse-tasks">${options}</datalist>
      
      <div class="ritual-tasks-list">
        <input type="text" class="ritual-task-input" id="mp-task-1" list="morning-pulse-tasks" placeholder="Task 1" value="${escapeHtml(t1)}" />
        <input type="text" class="ritual-task-input" id="mp-task-2" list="morning-pulse-tasks" placeholder="Task 2" value="${escapeHtml(t2)}" />
        <input type="text" class="ritual-task-input" id="mp-task-3" list="morning-pulse-tasks" placeholder="Task 3" value="${escapeHtml(t3)}" />
      </div>
      
      <div class="ritual-start-time">
        <span class="text-sm text-muted">When do you want to start?</span>
        <input type="time" id="mp-time" class="input input-sm" value="${defaultTime || '08:00'}" />
      </div>
      
      <div class="ritual-actions">
        <button class="btn btn-ghost" id="mp-cancel-adjust">Cancel</button>
        <button class="btn btn-primary" id="mp-save-adjust">Save plan &rarr;</button>
      </div>
    </div>
  `;
  
  overlay.classList.add('active');
  
  document.getElementById('mp-cancel-adjust').addEventListener('click', () => {
    closeOverlay();
    clearPendingRitual();
  });
  
  document.getElementById('mp-save-adjust').addEventListener('click', async () => {
    const vt1 = document.getElementById('mp-task-1').value.trim();
    const vt2 = document.getElementById('mp-task-2').value.trim();
    const vt3 = document.getElementById('mp-task-3').value.trim();
    
    const tasks = [vt1, vt2, vt3].filter(t => t).map(title => ({ title }));
    if (tasks.length === 0) {
      const confirmed = await showConfirm("No tasks listed — are you sure you want to save an empty plan?", "Empty Plan");
      if (!confirmed) return;
    }
    
    const startTime = document.getElementById('mp-time').value;
    await savePlan(dateStr, tasks, startTime, true);
    
    const container = overlay.querySelector('.ritual-container');
    container.innerHTML = `
      <div style="text-align:center; padding: 2rem;">
        <div style="font-size: 2rem; margin-bottom: 1rem;">☀️</div>
        <div class="ritual-greeting" style="margin:0">Let's go.</div>
      </div>
    `;
    
    await clearPendingRitual();
    setTimeout(closeOverlay, 1500);
  });
}
