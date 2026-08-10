/**
 * Clarity — popup/popup.js
 * Popup launcher logic.
 * ES Module.
 */

import {
  get,
  getSettings,
  patchSettings,
  getTasks,
  getBlocks,
  getInbox,
  removeInboxItem,
  trackedHoursForDate,
  checkStorageSize,
  todayKey,
  getAuth,
  signUp,
  signIn,
  signOut,
  pullLatestFromCloud,
} from '../shared/storage.js';
import { attachClockPicker } from '../shared/clockPicker.js';

// ─── Page URLs ─────────────────────────────────────────────────────────────────
const PAGES = {
  dashboard: chrome.runtime.getURL('pages/dashboard.html'),
  planner:   chrome.runtime.getURL('pages/planner.html'),
  vision:    chrome.runtime.getURL('pages/vision.html'),
  tracker:   chrome.runtime.getURL('pages/tracker.html'),
  settings:  chrome.runtime.getURL('pages/settings/settings.html'),
};

// ─── Element refs ──────────────────────────────────────────────────────────────
const greetingDate    = document.getElementById('greeting-date');
const greetingText    = document.getElementById('greeting-text');
const statBlocksVal   = document.getElementById('stat-blocks-val');
const statTasksVal    = document.getElementById('stat-tasks-val');
const statTimeVal     = document.getElementById('stat-time-val');
const inboxBadge      = document.getElementById('inbox-badge');
const btnInbox        = document.getElementById('btn-inbox');
const btnSettings     = document.getElementById('btn-settings');
const popupInbox      = document.getElementById('popup-inbox');
const popupSettings   = document.getElementById('popup-settings');
const inboxList       = document.getElementById('inbox-list');
const inboxEmpty      = document.getElementById('inbox-empty');
const btnInboxClose   = document.getElementById('btn-inbox-close');
const btnSettingsClose= document.getElementById('btn-settings-close');
const setMorning      = document.getElementById('set-morning');
const setNight        = document.getElementById('set-night');

if (setMorning) attachClockPicker(setMorning);
if (setNight) attachClockPicker(setNight);
const storageUsed     = document.getElementById('storage-used');
const storageWarning  = document.getElementById('storage-warning');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnOpenSettings = document.getElementById('btn-open-settings');

// Cloud Sync Element refs
const syncLoggedOut = document.getElementById('sync-logged-out');
const syncLoggedIn  = document.getElementById('sync-logged-in');
const syncEmail      = document.getElementById('sync-email');
const syncPassword   = document.getElementById('sync-password');
const syncError      = document.getElementById('sync-error');
const btnSyncSignin  = document.getElementById('btn-sync-signin');
const btnSyncSignup  = document.getElementById('btn-sync-signup');
const syncUserEmail  = document.getElementById('sync-user-email');
const btnSyncSignout = document.getElementById('btn-sync-signout');
const btnSyncNow     = document.getElementById('btn-sync-now');

// Nav cards
const navDashboard = document.getElementById('nav-dashboard');
const navPlanner   = document.getElementById('nav-planner');
const navVision    = document.getElementById('nav-vision');
const navTracker   = document.getElementById('nav-tracker');

// ─── Greeting ──────────────────────────────────────────────────────────────────
function renderGreeting() {
  const now = new Date();
  const h   = now.getHours();

  // Date label
  greetingDate.textContent = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  // Time-based greeting
  let salutation;
  if (h >= 5 && h < 12)       salutation = 'Good morning, ready to focus?';
  else if (h >= 12 && h < 17) salutation = 'Good afternoon, keep the momentum!';
  else if (h >= 17 && h < 21) salutation = 'Good evening, finishing strong?';
  else                         salutation = 'Working late? You got this.';

  greetingText.textContent = salutation;
}

// ─── Quick stats ───────────────────────────────────────────────────────────────
async function renderStats() {
  const today = todayKey();

  try {
    const [blocks, tasks, tracked] = await Promise.all([
      getBlocks(today),
      getTasks(today),
      trackedHoursForDate(today),
    ]);

    const blockCount = blocks.length;
    const doneCount  = tasks.filter((t) => t.done).length;
    const total      = tasks.length;
    const hours      = tracked.toFixed(1);

    statBlocksVal.textContent = `${blockCount} block${blockCount !== 1 ? 's' : ''}`;
    statTasksVal.textContent  = `${doneCount}/${total} tasks`;
    statTimeVal.textContent   = `${hours}h tracked`;
  } catch (err) {
    console.error('[Popup] renderStats error:', err);
  }
}

// ─── Inbox badge ───────────────────────────────────────────────────────────────
async function renderInboxBadge() {
  try {
    const inbox = await getInbox();
    const count = inbox.length;
    if (count > 0) {
      inboxBadge.textContent = count > 99 ? '99+' : String(count);
      inboxBadge.classList.remove('hidden');
    } else {
      inboxBadge.classList.add('hidden');
    }
  } catch (err) {
    console.error('[Popup] renderInboxBadge error:', err);
  }
}

// ─── Inbox panel ───────────────────────────────────────────────────────────────
function formatRelTime(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function routeLabel(route) {
  const map = { today: 'Today', someday: 'Someday', goal: 'Goal idea', vision: 'Vision note' };
  return map[route] ?? route;
}

async function renderInboxPanel() {
  try {
    const inbox = await getInbox();

    if (inbox.length === 0) {
      inboxList.innerHTML = '';
      inboxEmpty.classList.remove('hidden');
      return;
    }

    inboxEmpty.classList.add('hidden');

    // Sort newest first
    const sorted = [...inbox].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    inboxList.innerHTML = sorted.map((item) => `
      <div class="inbox-item" data-id="${item.id}">
        <div class="inbox-item-text">${escHtml(item.text)}</div>
        <div class="inbox-item-meta">
          <span class="inbox-route-pill" data-route="${item.route}">${routeLabel(item.route)}</span>
          <span class="inbox-item-time">${formatRelTime(item.createdAt)}</span>
        </div>
        <div class="inbox-item-delete" data-id="${item.id}" title="Remove">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </div>
      </div>
    `).join('');

    // Bind delete buttons
    inboxList.querySelectorAll('.inbox-item-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        await removeInboxItem(id);
        await renderInboxPanel();
        await renderInboxBadge();
      });
    });
  } catch (err) {
    console.error('[Popup] renderInboxPanel error:', err);
  }
}

// ─── Settings panel ────────────────────────────────────────────────────────────
async function renderSettingsPanel() {
  try {
    const settings = await getSettings();
    const rituals = settings.rituals || {};
    setMorning.value = rituals.morningPulse?.time ?? '07:30';
    setNight.value   = rituals.nightNudge?.time   ?? '21:30';

    // Storage usage
    const { bytes, overLimit } = await checkStorageSize();
    const kb = (bytes / 1024).toFixed(1);
    const mb = (bytes / (1024 * 1024)).toFixed(2);
    storageUsed.textContent = bytes > 1024 * 1024 ? `${mb} MB` : `${kb} KB`;

    if (overLimit) {
      storageWarning.classList.remove('hidden');
    } else {
      storageWarning.classList.add('hidden');
    }

    // Render Cloud Sync auth panel
    await renderAuthPanel();
  } catch (err) {
    console.error('[Popup] renderSettingsPanel error:', err);
  }
}

async function renderAuthPanel() {
  try {
    const auth = await getAuth();
    if (auth) {
      syncLoggedOut.classList.add('hidden');
      syncLoggedIn.classList.remove('hidden');
      syncUserEmail.textContent = auth.email;
    } else {
      syncLoggedOut.classList.remove('hidden');
      syncLoggedIn.classList.add('hidden');
      syncEmail.value = '';
      syncPassword.value = '';
      syncError.style.display = 'none';
    }
  } catch (err) {
    console.error('[Popup] renderAuthPanel error:', err);
  }
}

async function saveSettings() {
  const morningTime = setMorning.value || '07:30';
  const nightTime   = setNight.value   || '21:30';

  try {
    const currentSettings = await getSettings();
    const currentRituals = currentSettings.rituals || {};
    const rituals = {
      ...currentRituals,
      morningPulse: { ...currentRituals.morningPulse, time: morningTime },
      nightNudge: { ...currentRituals.nightNudge, time: nightTime }
    };

    await patchSettings({ rituals });

    // Tell service worker to reschedule alarms
    chrome.runtime.sendMessage({ type: 'RESCHEDULE_DAILY_ALARMS' });

    // Visual feedback
    btnSaveSettings.textContent = 'Saved ✓';
    btnSaveSettings.disabled = true;
    setTimeout(() => {
      btnSaveSettings.textContent = 'Save settings';
      btnSaveSettings.disabled = false;
    }, 1500);
  } catch (err) {
    console.error('[Popup] saveSettings error:', err);
  }
}

// ─── Panel toggle helpers ──────────────────────────────────────────────────────
let inboxOpen    = false;
let settingsOpen = false;

function toggleInbox() {
  inboxOpen = !inboxOpen;
  if (inboxOpen) {
    if (settingsOpen) toggleSettings(); // close settings first
    popupInbox.classList.remove('hidden');
    renderInboxPanel();
  } else {
    popupInbox.classList.add('hidden');
  }
}

function toggleSettings() {
  settingsOpen = !settingsOpen;
  if (settingsOpen) {
    if (inboxOpen) toggleInbox(); // close inbox first
    popupSettings.classList.remove('hidden');
    renderSettingsPanel();
  } else {
    popupSettings.classList.add('hidden');
  }
}

// ─── Navigation ────────────────────────────────────────────────────────────────
function openPage(url) {
  chrome.tabs.create({ url });
  window.close(); // close the popup after opening tab
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Event bindings ────────────────────────────────────────────────────────────
navDashboard.addEventListener('click', () => openPage(PAGES.dashboard));
navPlanner.addEventListener('click',   () => openPage(PAGES.planner));
navVision.addEventListener('click',    () => openPage(PAGES.vision));
navTracker.addEventListener('click',   () => openPage(PAGES.tracker));

// Keyboard nav (Enter/Space) on nav cards
[navDashboard, navPlanner, navVision, navTracker].forEach((card) => {
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      card.click();
    }
  });
});

btnInbox.addEventListener('click', toggleInbox);
btnInboxClose.addEventListener('click', () => {
  inboxOpen = true; toggleInbox();
});

btnSettings.addEventListener('click', toggleSettings);
btnSettingsClose.addEventListener('click', () => {
  settingsOpen = true; toggleSettings();
});

btnSaveSettings.addEventListener('click', saveSettings);
btnOpenSettings.addEventListener('click', () => openPage(PAGES.settings));

// ─── Cloud Sync Events ────────────────────────────────────────────────────────
btnSyncSignin.addEventListener('click', async () => {
  const email = syncEmail.value.trim();
  const password = syncPassword.value;
  if (!email || !password) {
    showSyncError('Please enter email and password.');
    return;
  }
  btnSyncSignin.disabled = true;
  btnSyncSignin.textContent = 'Signing in...';
  syncError.style.display = 'none';
  try {
    await signIn(email, password);
    await renderAuthPanel();
    await init(); // Refresh stats/inbox display
  } catch (err) {
    showSyncError(err.message);
  } finally {
    btnSyncSignin.disabled = false;
    btnSyncSignin.textContent = 'Sign In';
  }
});

btnSyncSignup.addEventListener('click', async () => {
  const email = syncEmail.value.trim();
  const password = syncPassword.value;
  if (!email || !password) {
    showSyncError('Please enter email and password.');
    return;
  }
  btnSyncSignup.disabled = true;
  btnSyncSignup.textContent = 'Registering...';
  syncError.style.display = 'none';
  try {
    await signUp(email, password);
    await renderAuthPanel();
    await init();
  } catch (err) {
    showSyncError(err.message);
  } finally {
    btnSyncSignup.disabled = false;
    btnSyncSignup.textContent = 'Register';
  }
});

btnSyncSignout.addEventListener('click', async () => {
  await signOut();
  await renderAuthPanel();
  await init();
});

btnSyncNow.addEventListener('click', async () => {
  btnSyncNow.disabled = true;
  btnSyncNow.textContent = 'Syncing...';
  try {
    await pullLatestFromCloud();
    btnSyncNow.textContent = 'Synced ✓';
    await init();
    setTimeout(() => {
      btnSyncNow.textContent = 'Sync Now';
      btnSyncNow.disabled = false;
    }, 1500);
  } catch (err) {
    console.error('[Sync] Manual sync failed:', err);
    btnSyncNow.textContent = 'Sync Failed';
    setTimeout(() => {
      btnSyncNow.textContent = 'Sync Now';
      btnSyncNow.disabled = false;
    }, 1500);
  }
});

function showSyncError(msg) {
  let displayMsg = msg;
  if (msg === 'EMAIL_EXISTS') displayMsg = 'Email already registered.';
  else if (msg === 'INVALID_PASSWORD') displayMsg = 'Invalid password.';
  else if (msg === 'EMAIL_NOT_FOUND' || msg === 'INVALID_LOGIN_CREDENTIALS') displayMsg = 'Incorrect email or password.';
  else if (msg === 'INVALID_EMAIL') displayMsg = 'Invalid email address format.';
  else if (msg.includes('WEAK_PASSWORD')) displayMsg = 'Password must be at least 6 characters.';

  syncError.textContent = displayMsg;
  syncError.style.display = 'block';
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  renderGreeting();
  await Promise.all([
    renderStats(),
    renderInboxBadge(),
  ]);
}

init();
