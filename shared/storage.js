/**
 * Clarity — shared/storage.js
 * All chrome.storage.local read/write helpers.
 * ES Module — import with: import { get, set, push, remove, update } from '../shared/storage.js'
 *
 * Storage schema keys:
 *   settings       → { morningTime, nightTime, theme }
 *   vision         → { text, imageBase64 }
 *   smart_goals    → [ { id, title, description, targetDate, imageBase64, category, createdAt } ]
 *   goals_long     → [ { id, title, description, targetDate, status } ]
 *   goals_short    → [ { id, title, targetDate, status } ]
 *   yearly_themes  → [ { month, theme } ]
 *   blocks_{date}  → [ { id, title, cat, start, end } ]
 *   tasks_{date}   → [ { id, title, done, priority, timeEstimate } ]
 *   time_logs      → [ { id, taskTitle, cat, start, end, date } ]
 *   capture_inbox  → [ { id, text, route, createdAt } ]
 */

// ─── Default values ────────────────────────────────────────────────────────────

const DEFAULTS = {
  settings: {
    morningTime: '07:00',
    nightTime: '22:00',
    theme: 'light',
  },
  vision: {
    text: '',
    imageBase64: '',
  },
  smart_goals: [],
  goals_long: [],
  goals_short: [],
  yearly_themes: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, theme: '' })),
  time_logs: [],
  capture_inbox: [],
};

// ─── ID generator ──────────────────────────────────────────────────────────────

/**
 * Generate a short unique ID.
 * Uses crypto.randomUUID when available (extension pages), falls back to
 * Math.random-based string for service worker context.
 * @returns {string}
 */
export function generateId() {
  try {
    return crypto.randomUUID();
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}

// ─── Date helper ───────────────────────────────────────────────────────────────

/**
 * Returns today's date as "YYYY-MM-DD".
 * @returns {string}
 */
export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Returns a date offset by `days` from today as "YYYY-MM-DD".
 * @param {number} days  Positive = future, negative = past.
 * @returns {string}
 */
export function dateKey(days = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Snap a decimal hour value to the nearest 0.5 increment (30-min slots).
 * @param {number} h
 * @returns {number}
 */
export function snapHour(h) {
  return Math.round(h * 2) / 2;
}

/**
 * Convert decimal hours to "HH:MM" string.
 * @param {number} h  e.g. 9.5 → "09:30"
 * @returns {string}
 */
export function decimalToTime(h) {
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60).toString().padStart(2, '0');
  const mm = (totalMin % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Convert "HH:MM" string to decimal hours.
 * @param {string} t  e.g. "09:30" → 9.5
 * @returns {number}
 */
export function timeToDec(t) {
  const [h, m] = t.split(':').map(Number);
  return h + m / 60;
}

/**
 * Format a decimal hour for display: "9:30 AM"
 * @param {number} h
 * @returns {string}
 */
export function formatHour(h) {
  const totalMin = Math.round(h * 60);
  const raw = Math.floor(totalMin / 60);
  const mm = (totalMin % 60).toString().padStart(2, '0');
  const period = raw >= 12 ? 'PM' : 'AM';
  const display = raw % 12 === 0 ? 12 : raw % 12;
  return `${display}:${mm} ${period}`;
}

// ─── Core storage primitives ───────────────────────────────────────────────────

/**
 * Get a value from chrome.storage.local by key.
 * Returns the stored value or the default for known keys, or null.
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function get(key) {
  try {
    const result = await chrome.storage.local.get(key);
    if (key in result) {
      return result[key];
    }
    // Return defaults for known keys
    if (key in DEFAULTS) {
      return structuredClone(DEFAULTS[key]);
    }
    // Dynamic keys: blocks_{date}, tasks_{date}
    if (key.startsWith('blocks_') || key.startsWith('tasks_')) {
      return [];
    }
    return null;
  } catch (err) {
    console.error(`[Clarity Storage] get("${key}") failed:`, err);
    return null;
  }
}

/**
 * Set a value in chrome.storage.local.
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
export async function set(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
    // Sync to cloud in the background (fire-and-forget)
    syncToCloud(key, value);
  } catch (err) {
    console.error(`[Clarity Storage] set("${key}") failed:`, err);
    throw err;
  }
}

/**
 * Remove a key entirely from chrome.storage.local.
 * Note: this removes the whole key. To remove an item from an array,
 * use the remove(key, id) overload below.
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function clear(key) {
  try {
    await chrome.storage.local.remove(key);
    // Sync deletion to cloud in the background
    deleteFromCloud(key);
  } catch (err) {
    console.error(`[Clarity Storage] clear("${key}") failed:`, err);
    throw err;
  }
}

// ─── Array helpers ─────────────────────────────────────────────────────────────

/**
 * Append an item to an array stored under `key`.
 * The item must have an `id` field (use generateId() before calling).
 * @param {string} key
 * @param {object} item
 * @returns {Promise<void>}
 */
export async function push(key, item) {
  try {
    const arr = (await get(key)) ?? [];
    arr.push(item);
    await set(key, arr);
  } catch (err) {
    console.error(`[Clarity Storage] push("${key}") failed:`, err);
    throw err;
  }
}

/**
 * Remove an item by `id` from an array stored under `key`.
 * @param {string} key
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function remove(key, id) {
  try {
    const arr = (await get(key)) ?? [];
    const filtered = arr.filter((item) => item.id !== id);
    await set(key, filtered);
  } catch (err) {
    console.error(`[Clarity Storage] remove("${key}", "${id}") failed:`, err);
    throw err;
  }
}

/**
 * Update specific fields of an item by `id` in an array stored under `key`.
 * Uses shallow merge (Object.assign) — pass only the fields you want to change.
 * @param {string} key
 * @param {string} id
 * @param {object} patch  Fields to merge into the matching item.
 * @returns {Promise<void>}
 */
export async function update(key, id, patch) {
  try {
    const arr = (await get(key)) ?? [];
    const idx = arr.findIndex((item) => item.id === id);
    if (idx === -1) {
      console.warn(`[Clarity Storage] update: item "${id}" not found in "${key}"`);
      return;
    }
    arr[idx] = { ...arr[idx], ...patch };
    await set(key, arr);
  } catch (err) {
    console.error(`[Clarity Storage] update("${key}", "${id}") failed:`, err);
    throw err;
  }
}

// ─── Settings helpers ──────────────────────────────────────────────────────────

/**
 * Get the full settings object, merged with defaults.
 * @returns {Promise<object>}
 */
export async function getSettings() {
  const stored = (await get('settings')) ?? {};
  return { ...DEFAULTS.settings, ...stored };
}

/**
 * Patch one or more settings fields.
 * @param {object} patch
 * @returns {Promise<void>}
 */
export async function patchSettings(patch) {
  const current = await getSettings();
  await set('settings', { ...current, ...patch });
}

// ─── Blocks helpers ────────────────────────────────────────────────────────────

/**
 * Get all time blocks for a given date.
 * @param {string} date  "YYYY-MM-DD"
 * @returns {Promise<Array>}
 */
export async function getBlocks(date) {
  return (await get(`blocks_${date}`)) ?? [];
}

/**
 * Save the full blocks array for a given date (replaces entirely).
 * @param {string} date  "YYYY-MM-DD"
 * @param {Array} blocks
 * @returns {Promise<void>}
 */
export async function setBlocks(date, blocks) {
  await set(`blocks_${date}`, blocks);
}

/**
 * Add a new block for a given date.
 * @param {string} date
 * @param {object} block  { id, title, cat, start, end }
 * @returns {Promise<void>}
 */
export async function addBlock(date, block) {
  await push(`blocks_${date}`, block);
}

/**
 * Update a block by id for a given date.
 * @param {string} date
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<void>}
 */
export async function updateBlock(date, id, patch) {
  await update(`blocks_${date}`, id, patch);
}

/**
 * Delete a block by id for a given date.
 * @param {string} date
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteBlock(date, id) {
  await remove(`blocks_${date}`, id);
}

// ─── Tasks helpers ─────────────────────────────────────────────────────────────

/**
 * Get all tasks for a given date.
 * @param {string} date  "YYYY-MM-DD"
 * @returns {Promise<Array>}
 */
export async function getTasks(date) {
  return (await get(`tasks_${date}`)) ?? [];
}

/**
 * Save the full tasks array for a given date.
 * @param {string} date
 * @param {Array} tasks
 * @returns {Promise<void>}
 */
export async function setTasks(date, tasks) {
  await set(`tasks_${date}`, tasks);
}

/**
 * Add a new task for a given date.
 * @param {string} date
 * @param {object} task  { id, title, done, priority, timeEstimate }
 * @returns {Promise<void>}
 */
export async function addTask(date, task) {
  await push(`tasks_${date}`, task);
}

/**
 * Update a task by id for a given date.
 * @param {string} date
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<void>}
 */
export async function updateTask(date, id, patch) {
  await update(`tasks_${date}`, id, patch);
}

/**
 * Delete a task by id for a given date.
 * @param {string} date
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteTask(date, id) {
  await remove(`tasks_${date}`, id);
}

/**
 * Carry forward incomplete tasks from one date to another.
 * Copies tasks where done === false from `fromDate` to `toDate`.
 * Does not duplicate if already present (checks by title).
 * @param {string} fromDate
 * @param {string} toDate
 * @returns {Promise<number>} Number of tasks carried forward.
 */
export async function carryForwardTasks(fromDate, toDate) {
  try {
    const from = (await getTasks(fromDate)).filter((t) => !t.done);
    const to = await getTasks(toDate);
    const existingTitles = new Set(to.map((t) => t.title));
    let count = 0;
    for (const task of from) {
      if (!existingTitles.has(task.title)) {
        await addTask(toDate, { ...task, id: generateId(), done: false });
        count++;
      }
    }
    return count;
  } catch (err) {
    console.error('[Clarity Storage] carryForwardTasks failed:', err);
    return 0;
  }
}

// ─── Time logs helpers ─────────────────────────────────────────────────────────

/**
 * Get all time log entries.
 * @returns {Promise<Array>}
 */
export async function getTimeLogs() {
  return (await get('time_logs')) ?? [];
}

/**
 * Get time log entries for a specific date.
 * @param {string} date  "YYYY-MM-DD"
 * @returns {Promise<Array>}
 */
export async function getTimeLogsForDate(date) {
  const logs = await getTimeLogs();
  return logs.filter((l) => l.date === date);
}

/**
 * Add a time log entry.
 * @param {object} entry  { id, taskTitle, cat, start, end, date }
 * @returns {Promise<void>}
 */
export async function addTimeLog(entry) {
  await push('time_logs', entry);
}

/**
 * Delete a time log entry by id.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteTimeLog(id) {
  await remove('time_logs', id);
}

/**
 * Compute total tracked hours for a date from time_logs.
 * @param {string} date
 * @returns {Promise<number>} Hours as decimal.
 */
export async function trackedHoursForDate(date) {
  const logs = await getTimeLogsForDate(date);
  let total = 0;
  for (const l of logs) {
    if (l.start && l.end) {
      const s = new Date(l.start).getTime();
      const e = new Date(l.end).getTime();
      if (e > s) total += (e - s) / 3600000;
    }
  }
  return total;
}

// ─── Capture inbox helpers ─────────────────────────────────────────────────────

/**
 * Get all capture inbox items.
 * @returns {Promise<Array>}
 */
export async function getInbox() {
  return (await get('capture_inbox')) ?? [];
}

/**
 * Add an item to the capture inbox.
 * @param {object} item  { id, text, route, createdAt }
 * @returns {Promise<void>}
 */
export async function addInboxItem(item) {
  await push('capture_inbox', item);
}

/**
 * Remove an item from the capture inbox by id.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function removeInboxItem(id) {
  await remove('capture_inbox', id);
}

// ─── Vision helpers ────────────────────────────────────────────────────────────

/**
 * Get the vision object.
 * @returns {Promise<{text: string, imageBase64: string}>}
 */
export async function getVision() {
  const v = await get('vision');
  return v ?? { text: '', imageBase64: '' };
}

/**
 * Update vision fields.
 * @param {object} patch  { text?, imageBase64? }
 * @returns {Promise<void>}
 */
export async function patchVision(patch) {
  const current = await getVision();
  await set('vision', { ...current, ...patch });
}

// ─── Goals helpers ─────────────────────────────────────────────────────────────

/**
 * Get all SMART goals.
 * @returns {Promise<Array>}
 */
export async function getSmartGoals() {
  return (await get('smart_goals')) ?? [];
}

/**
 * Get all long-term goals.
 * @returns {Promise<Array>}
 */
export async function getLongGoals() {
  return (await get('goals_long')) ?? [];
}

/**
 * Get all short-term goals.
 * @returns {Promise<Array>}
 */
export async function getShortGoals() {
  return (await get('goals_short')) ?? [];
}

/**
 * Get yearly themes array (12 months).
 * @returns {Promise<Array>}
 */
export async function getYearlyThemes() {
  const stored = (await get('yearly_themes')) ?? [];
  // Ensure all 12 months are present
  if (stored.length === 12) return stored;
  const base = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, theme: '' }));
  for (const entry of stored) {
    const idx = entry.month - 1;
    if (idx >= 0 && idx < 12) base[idx] = entry;
  }
  return base;
}

/**
 * Update the theme for a specific month.
 * @param {number} month  1–12
 * @param {string} theme
 * @returns {Promise<void>}
 */
export async function setMonthTheme(month, theme) {
  const themes = await getYearlyThemes();
  const idx = themes.findIndex((t) => t.month === month);
  if (idx >= 0) {
    themes[idx].theme = theme;
  } else {
    themes.push({ month, theme });
  }
  await set('yearly_themes', themes);
}

// ─── Image compression helper ──────────────────────────────────────────────────

/**
 * Compress an image File or Blob to a base64 string.
 * Resizes to max 800px width, JPEG quality 0.75.
 * @param {File|Blob} file
 * @returns {Promise<string>}  base64 data URL
 */
export async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX_W = 800;
        let { width, height } = img;
        if (width > MAX_W) {
          height = Math.round((height * MAX_W) / width);
          width = MAX_W;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Storage size check ────────────────────────────────────────────────────────

/**
 * Check total storage used (bytes) and warn if over 8 MB.
 * @returns {Promise<{bytes: number, overLimit: boolean}>}
 */
export async function checkStorageSize() {
  try {
    const bytesInUse = await new Promise((resolve, reject) => {
      chrome.storage.local.getBytesInUse(null, (b) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(b);
      });
    });
    return { bytes: bytesInUse, overLimit: bytesInUse > 8 * 1024 * 1024 };
  } catch (err) {
    console.error('[Clarity Storage] checkStorageSize failed:', err);
    return { bytes: 0, overLimit: false };
  }
}

// ─── Weekly stats helper ───────────────────────────────────────────────────────

/**
 * Get task stats (done/total) for the past N days.
 * @param {number} days  Default 7.
 * @returns {Promise<Array<{date: string, done: number, total: number}>>}
 */
export async function getWeeklyTaskStats(days = 7) {
  const results = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = dateKey(-i);
    const tasks = await getTasks(date);
    results.push({
      date,
      done: tasks.filter((t) => t.done).length,
      total: tasks.length,
    });
  }
  return results;
}

/**
 * Get time tracked per day for the past N days grouped by category.
 * @param {number} days
 * @returns {Promise<Array<{date: string, total: number, byCat: object}>>}
 */
export async function getWeeklyTimeStats(days = 7) {
  const allLogs = await getTimeLogs();
  const results = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = dateKey(-i);
    const dayLogs = allLogs.filter((l) => l.date === date);
    const byCat = {};
    let total = 0;
    for (const l of dayLogs) {
      if (l.start && l.end) {
        const dur = (new Date(l.end) - new Date(l.start)) / 3600000;
        if (dur > 0) {
          total += dur;
          byCat[l.cat] = (byCat[l.cat] ?? 0) + dur;
        }
      }
    }
    results.push({ date, total, byCat });
  }
  return results;
}

// ─── Firebase Auth & Sync REST API Integration ──────────────────────────────────

const firebaseConfig = {
  apiKey: "AIzaSyAWpNPhuyP6fkd6UlK_6SFLVSFiOtqU6Gg",
  authDomain: "clarity-app-b599e.firebaseapp.com",
  projectId: "clarity-app-b599e",
  storageBucket: "clarity-app-b599e.firebasestorage.app",
  messagingSenderId: "778165477935",
  appId: "1:778165477935:web:91d1f577bba63f6f8ddcda",
  measurementId: "G-05JJY37MZJ"
};

const FIRESTORE_REST_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;

/**
 * Get current Firebase Auth state, refreshing token if necessary.
 * @returns {Promise<object|null>}
 */
export async function getAuth() {
  try {
    // We use chrome.storage.local directly to bypass sync loops
    const result = await chrome.storage.local.get('firebase_auth');
    const auth = result.firebase_auth;
    if (!auth) return null;

    const now = Date.now();
    // Refresh token if expired or expiring in next 5 minutes
    if (auth.expiresAt && now > auth.expiresAt - 5 * 60 * 1000) {
      const url = `https://securetoken.googleapis.com/v1/token?key=${firebaseConfig.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${auth.refreshToken}`
      });
      if (res.ok) {
        const data = await res.json();
        auth.idToken = data.id_token;
        auth.refreshToken = data.refresh_token;
        auth.expiresAt = Date.now() + parseInt(data.expires_in) * 1000;
        await chrome.storage.local.set({ firebase_auth: auth });
      } else {
        console.warn('[Sync] Auth session expired and refresh failed. Signing out.');
        await chrome.storage.local.remove('firebase_auth');
        return null;
      }
    }
    return auth;
  } catch (err) {
    console.error('[Sync] Error getting auth session:', err);
    return null;
  }
}

/**
 * Sign up a new user using Firebase Auth REST API.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<object>} Auth data
 */
export async function signUp(email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.error?.message || 'Failed to sign up');
  }
  const data = await res.json();
  const auth = {
    email: data.email,
    localId: data.localId,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + parseInt(data.expiresIn) * 1000
  };
  await chrome.storage.local.set({ firebase_auth: auth });
  
  // Pull existing cloud data if any
  await pullLatestFromCloud();
  return auth;
}

/**
 * Sign in an existing user using Firebase Auth REST API.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<object>} Auth data
 */
export async function signIn(email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.error?.message || 'Failed to sign in');
  }
  const data = await res.json();
  const auth = {
    email: data.email,
    localId: data.localId,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + parseInt(data.expiresIn) * 1000
  };
  await chrome.storage.local.set({ firebase_auth: auth });
  
  // Pull existing cloud data
  await pullLatestFromCloud();
  return auth;
}

/**
 * Sign out the current user.
 */
export async function signOut() {
  await chrome.storage.local.remove('firebase_auth');
}

/**
 * Push a key-value update to Firestore.
 * @param {string} key
 * @param {any} value
 */
export async function syncToCloud(key, value) {
  if (key === 'firebase_auth' || key === 'storage_size_info') return;

  const auth = await getAuth();
  if (!auth) return;

  try {
    const url = `${FIRESTORE_REST_BASE}/users/${auth.localId}/data/${key}`;
    const fields = {
      value: { stringValue: JSON.stringify(value) },
      updatedAt: { integerValue: Date.now().toString() }
    };

    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.idToken}`
      },
      body: JSON.stringify({ fields })
    });
    if (!res.ok) {
      console.warn(`[Sync] Cloud write failed for key ${key}:`, await res.text());
    }
  } catch (err) {
    console.error(`[Sync] Cloud write network error for key ${key}:`, err);
  }
}

/**
 * Delete a key from Firestore.
 * @param {string} key
 */
export async function deleteFromCloud(key) {
  if (key === 'firebase_auth' || key === 'storage_size_info') return;

  const auth = await getAuth();
  if (!auth) return;

  try {
    const url = `${FIRESTORE_REST_BASE}/users/${auth.localId}/data/${key}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${auth.idToken}`
      }
    });
    if (!res.ok) {
      console.warn(`[Sync] Cloud delete failed for key ${key}:`, await res.text());
    }
  } catch (err) {
    console.error(`[Sync] Cloud delete network error for key ${key}:`, err);
  }
}

/**
 * Pull all data documents from Firestore and populate local storage.
 */
export async function pullLatestFromCloud() {
  const auth = await getAuth();
  if (!auth) return;

  try {
    const url = `${FIRESTORE_REST_BASE}/users/${auth.localId}/data`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${auth.idToken}`
      }
    });
    if (!res.ok) {
      // If collection doesn't exist yet, it returns 404/not found. That's fine.
      if (res.status === 404) return;
      console.warn('[Sync] Pull from cloud failed:', await res.text());
      return;
    }
    const data = await res.json();
    if (!data.documents) {
      return;
    }

    for (const doc of data.documents) {
      const parts = doc.name.split('/');
      const key = parts[parts.length - 1];
      const fields = doc.fields;
      if (fields && fields.value && fields.value.stringValue) {
        try {
          const parsedVal = JSON.parse(fields.value.stringValue);
          await chrome.storage.local.set({ [key]: parsedVal });
        } catch (e) {
          console.error(`[Sync] Error parsing value for pulled key "${key}":`, e);
        }
      }
    }
  } catch (err) {
    console.error('[Sync] Error pulling from cloud:', err);
  }
}

