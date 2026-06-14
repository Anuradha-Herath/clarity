/**
 * Clarity — capture/capture.js
 * Quick-capture mini popup logic.
 * ES Module.
 */

import { addInboxItem, generateId } from '../shared/storage.js';

// ─── Elements ──────────────────────────────────────────────────────────────────

const input      = document.getElementById('capture-input');
const btnClose   = document.getElementById('btn-close');
const statusEl   = document.getElementById('capture-status');
const routeBtns  = document.querySelectorAll('.route-btn');

// ─── State ─────────────────────────────────────────────────────────────────────

let isSaving = false;

// ─── Init ──────────────────────────────────────────────────────────────────────

// Auto-focus the input immediately
input.focus();

// ─── Core save logic ───────────────────────────────────────────────────────────

/**
 * Save the captured thought to capture_inbox and close the popup.
 * @param {string} route  "today" | "someday" | "goal" | "vision"
 */
async function capture(route) {
  if (isSaving) return;

  const text = input.value.trim();
  if (!text) {
    // Shake the input to indicate it's empty
    input.classList.add('shake');
    input.focus();
    setTimeout(() => input.classList.remove('shake'), 400);
    return;
  }

  isSaving = true;

  // Disable all buttons while saving
  routeBtns.forEach((btn) => { btn.disabled = true; });

  try {
    await addInboxItem({
      id:        generateId(),
      text,
      route,
      createdAt: new Date().toISOString(),
    });

    // Brief success flash, then close
    showStatus('Captured!');
    setTimeout(() => {
      window.close();
    }, 600);

  } catch (err) {
    console.error('[Capture] Failed to save:', err);
    showStatus('Error — try again', true);
    isSaving = false;
    routeBtns.forEach((btn) => { btn.disabled = false; });
  }
}

// ─── UI helpers ────────────────────────────────────────────────────────────────

function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.remove('hidden');
  statusEl.style.background = isError
    ? 'var(--color-danger)'
    : 'var(--color-success)';

  if (isError) {
    setTimeout(() => statusEl.classList.add('hidden'), 2000);
  }
}

// ─── Event bindings ────────────────────────────────────────────────────────────

// Route buttons
routeBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const route = btn.dataset.route;
    if (route) capture(route);
  });
});

// Enter key → "Today" route
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    capture('today');
  }
  // Escape → close without saving
  if (e.key === 'Escape') {
    window.close();
  }
});

// Close button
btnClose.addEventListener('click', () => {
  window.close();
});

// ─── Input character counter (visual feedback near limit) ──────────────────────
input.addEventListener('input', () => {
  const remaining = 500 - input.value.length;
  if (remaining <= 50) {
    input.style.borderColor = remaining <= 10
      ? 'var(--color-danger)'
      : 'var(--color-warning)';
  } else {
    input.style.borderColor = '';
  }
});

// ─── Shake animation (injected dynamically, avoids extra CSS file edit) ────────
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%,100% { transform: translateX(0); }
    20%      { transform: translateX(-6px); }
    40%      { transform: translateX(6px); }
    60%      { transform: translateX(-4px); }
    80%      { transform: translateX(4px); }
  }
  .shake { animation: shake 0.35s ease; }
`;
document.head.appendChild(shakeStyle);
