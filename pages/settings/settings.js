import {
  getSettings,
  patchSettings,
  checkStorageSize,
  getAuth,
  signUp,
  signIn,
  signOut,
  pullLatestFromCloud,
} from '../../shared/storage.js';
import { attachClockPicker } from '../../shared/clockPicker.js';

const chkMorningPulse = document.getElementById('chk-morning-pulse');
const setMorning      = document.getElementById('set-morning');
const chkNightNudge   = document.getElementById('chk-night-nudge');
const setNight        = document.getElementById('set-night');

if (setMorning) attachClockPicker(setMorning);
if (setNight) attachClockPicker(setNight);
const chkReprompt     = document.getElementById('chk-reprompt');
const chkAutoCarry    = document.getElementById('chk-auto-carry');
const btnSave         = document.getElementById('btn-save-settings');
const saveFeedback    = document.getElementById('save-feedback');
const storageUsed     = document.getElementById('storage-used');
const storageWarning  = document.getElementById('storage-warning');

const syncLoggedOut   = document.getElementById('sync-logged-out');
const syncLoggedIn    = document.getElementById('sync-logged-in');
const syncEmail       = document.getElementById('sync-email');
const syncPassword    = document.getElementById('sync-password');
const syncError       = document.getElementById('sync-error');
const btnSyncSignin   = document.getElementById('btn-sync-signin');
const btnSyncSignup   = document.getElementById('btn-sync-signup');
const syncUserEmail   = document.getElementById('sync-user-email');
const btnSyncSignout  = document.getElementById('btn-sync-signout');
const btnSyncNow      = document.getElementById('btn-sync-now');

async function loadSettings() {
  const settings = await getSettings();
  const rituals = settings.rituals || {};
  chkMorningPulse.checked = rituals.morningPulse?.enabled ?? true;
  setMorning.value        = rituals.morningPulse?.time ?? '07:30';
  chkNightNudge.checked   = rituals.nightNudge?.enabled ?? true;
  setNight.value          = rituals.nightNudge?.time ?? '21:30';
  chkReprompt.checked     = rituals.repromptIfDismissed ?? true;

  chkAutoCarry.checked = settings.autoCarryForward ?? false;

  const { bytes, overLimit } = await checkStorageSize();
  const kb = (bytes / 1024).toFixed(1);
  const mb = (bytes / (1024 * 1024)).toFixed(2);
  storageUsed.textContent = bytes > 1024 * 1024 ? `${mb} MB` : `${kb} KB`;
  storageWarning.classList.toggle('hidden', !overLimit);

  await renderAuthPanel();
}

async function renderAuthPanel() {
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
}

async function saveSettings() {
  const autoCarryForward = chkAutoCarry.checked;

  const rituals = {
    morningPulse: { enabled: chkMorningPulse.checked, time: setMorning.value || '07:30' },
    nightNudge: { enabled: chkNightNudge.checked, time: setNight.value || '21:30' },
    repromptIfDismissed: chkReprompt.checked
  };

  try {
    await patchSettings({ autoCarryForward, rituals });
    chrome.runtime.sendMessage({ type: 'RESCHEDULE_DAILY_ALARMS' });
    showFeedback('Saved &#10003;', 'var(--color-success)');
  } catch (err) {
    console.error('[Settings] save error:', err);
    showFeedback('Save failed', 'var(--color-danger)');
  }
}

function showFeedback(text, color) {
  saveFeedback.innerHTML = text;
  saveFeedback.style.display = 'inline';
  saveFeedback.style.color = color;
  setTimeout(() => {
    saveFeedback.style.display = 'none';
  }, 2000);
}

btnSave.addEventListener('click', saveSettings);

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
});

btnSyncNow.addEventListener('click', async () => {
  btnSyncNow.disabled = true;
  btnSyncNow.textContent = 'Syncing...';
  try {
    await pullLatestFromCloud();
    btnSyncNow.textContent = 'Synced &#10003;';
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

loadSettings();
