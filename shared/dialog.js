/**
 * Clarity — shared/dialog.js
 * A modern, user-friendly dialog replacement for browser alert() and confirm().
 * ES Module.
 */

export function showConfirm(message, title = 'Confirm Action') {
  return new Promise((resolve) => {
    injectStyles();

    let overlay = document.getElementById('custom-confirm-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'custom-confirm-overlay';
      overlay.className = 'custom-dialog-overlay';
      overlay.innerHTML = `
        <div class="custom-dialog-modal">
          <div class="custom-dialog-title"></div>
          <div class="custom-dialog-message"></div>
          <div class="custom-dialog-buttons">
            <button class="custom-dialog-btn cancel-btn">Cancel</button>
            <button class="custom-dialog-btn ok-btn">OK</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    const titleEl = overlay.querySelector('.custom-dialog-title');
    const msgEl = overlay.querySelector('.custom-dialog-message');
    const btnCancel = overlay.querySelector('.cancel-btn');
    const btnOk = overlay.querySelector('.ok-btn');

    titleEl.textContent = title;
    msgEl.textContent = message;
    btnCancel.style.display = 'inline-block';
    
    // Check if deletion or destructive action
    const isDestructive = message.toLowerCase().includes('delete') || message.toLowerCase().includes('reset');
    btnOk.textContent = isDestructive ? 'Delete' : 'Confirm';
    btnOk.className = `custom-dialog-btn ok-btn${isDestructive ? ' danger-btn' : ''}`;

    overlay.style.display = 'flex';

    const cleanUp = (value) => {
      overlay.style.display = 'none';
      btnOk.onclick = null;
      btnCancel.onclick = null;
      overlay.onclick = null;
      resolve(value);
    };

    btnOk.onclick = () => cleanUp(true);
    btnCancel.onclick = () => cleanUp(false);
    overlay.onclick = (e) => {
      if (e.target === overlay) cleanUp(false);
    };
  });
}

export function showAlert(message, title = 'Notification') {
  return new Promise((resolve) => {
    injectStyles();

    let overlay = document.getElementById('custom-confirm-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'custom-confirm-overlay';
      overlay.className = 'custom-dialog-overlay';
      overlay.innerHTML = `
        <div class="custom-dialog-modal">
          <div class="custom-dialog-title"></div>
          <div class="custom-dialog-message"></div>
          <div class="custom-dialog-buttons">
            <button class="custom-dialog-btn cancel-btn">Cancel</button>
            <button class="custom-dialog-btn ok-btn">OK</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    const titleEl = overlay.querySelector('.custom-dialog-title');
    const msgEl = overlay.querySelector('.custom-dialog-message');
    const btnCancel = overlay.querySelector('.cancel-btn');
    const btnOk = overlay.querySelector('.ok-btn');

    titleEl.textContent = title;
    msgEl.textContent = message;
    btnCancel.style.display = 'none';
    btnOk.textContent = 'OK';
    btnOk.className = 'custom-dialog-btn ok-btn';

    overlay.style.display = 'flex';

    const cleanUp = () => {
      overlay.style.display = 'none';
      btnOk.onclick = null;
      overlay.onclick = null;
      resolve();
    };

    btnOk.onclick = () => cleanUp();
    overlay.onclick = (e) => {
      if (e.target === overlay) cleanUp();
    };
  });
}

export function showChoiceDialog({
  title = 'Recurring Item',
  message = 'How would you like to apply your changes?',
  choices = [
    { value: 'only-this', label: 'This instance only', description: 'Changes affect only this item.' },
    { value: 'following', label: 'This and future instances', description: 'Changes affect this and all future recurring instances.' },
    { value: 'all', label: 'All instances', description: 'Changes template and updates all instances.' }
  ],
  defaultChoice = 'following',
  confirmText = 'Apply',
  cancelText = 'Cancel'
} = {}) {
  return new Promise((resolve) => {
    injectStyles();

    let overlay = document.getElementById('custom-choice-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'custom-choice-overlay';
      overlay.className = 'custom-dialog-overlay';
      overlay.innerHTML = `
        <div class="custom-dialog-modal" style="max-width:380px;">
          <div class="custom-dialog-title"></div>
          <div class="custom-dialog-message"></div>
          <div class="custom-dialog-choices" style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;"></div>
          <div class="custom-dialog-buttons">
            <button class="custom-dialog-btn cancel-btn">Cancel</button>
            <button class="custom-dialog-btn ok-btn">Confirm</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    const titleEl = overlay.querySelector('.custom-dialog-title');
    const msgEl = overlay.querySelector('.custom-dialog-message');
    const choicesEl = overlay.querySelector('.custom-dialog-choices');
    const btnCancel = overlay.querySelector('.cancel-btn');
    const btnOk = overlay.querySelector('.ok-btn');

    titleEl.textContent = title;
    msgEl.textContent = message;
    btnCancel.textContent = cancelText;
    btnOk.textContent = confirmText;

    choicesEl.innerHTML = choices.map((c, i) => `
      <label style="display:flex; align-items:flex-start; gap:10px; padding:8px 10px; border:1px solid var(--color-border, #e2e8f0); border-radius:8px; cursor:pointer; transition:background 0.15s ease;" onmouseover="this.style.background='var(--color-bg-hover, #f8fafc)'" onmouseout="this.style.background='transparent'">
        <input type="radio" name="custom-choice-radio" value="${c.value}" ${c.value === defaultChoice || (i === 0 && !defaultChoice) ? 'checked' : ''} style="margin-top:3px; accent-color:var(--color-accent, #6366f1);" />
        <div>
          <strong style="display:block; font-size:13px; color:var(--color-text, #1e293b);">${c.label}</strong>
          ${c.description ? `<span style="font-size:11px; color:var(--color-text-muted, #64748b);">${c.description}</span>` : ''}
        </div>
      </label>
    `).join('');

    overlay.style.display = 'flex';

    const cleanUp = (value) => {
      overlay.style.display = 'none';
      btnOk.onclick = null;
      btnCancel.onclick = null;
      overlay.onclick = null;
      resolve(value);
    };

    btnOk.onclick = () => {
      const selected = overlay.querySelector('input[name="custom-choice-radio"]:checked')?.value || null;
      cleanUp(selected);
    };
    btnCancel.onclick = () => cleanUp(null);
    overlay.onclick = (e) => {
      if (e.target === overlay) cleanUp(null);
    };
  });
}

function injectStyles() {
  if (document.getElementById('custom-dialog-styles')) return;
  const style = document.createElement('style');
  style.id = 'custom-dialog-styles';
  style.textContent = `
    .custom-dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.65);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      padding: 16px;
    }
    .custom-dialog-modal {
      background: var(--color-surface, #ffffff);
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 12px;
      width: 100%;
      max-width: 320px;
      padding: 20px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      animation: dialogPop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .custom-dialog-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--color-text, #1e293b);
      margin-bottom: 8px;
    }
    .custom-dialog-message {
      font-size: 13px;
      color: var(--color-text-muted, #64748b);
      line-height: 1.5;
      margin-bottom: 20px;
    }
    .custom-dialog-buttons {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .custom-dialog-btn {
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 500;
      border-radius: 6px;
      cursor: pointer;
      border: 1px solid var(--color-border, #e2e8f0);
      background: transparent;
      color: var(--color-text, #1e293b);
      transition: all 0.15s ease;
      font-family: inherit;
      outline: none;
    }
    .custom-dialog-btn:hover {
      background: var(--color-bg-hover, #f8fafc);
      border-color: var(--color-text-muted, #94a3b8);
    }
    .custom-dialog-btn.ok-btn {
      background: var(--color-accent, #6366f1);
      color: #ffffff;
      border-color: var(--color-accent, #6366f1);
    }
    .custom-dialog-btn.ok-btn:hover {
      opacity: 0.9;
    }
    .custom-dialog-btn.danger-btn {
      background: var(--color-danger, #ef4444);
      color: #ffffff;
      border-color: var(--color-danger, #ef4444);
    }
    .custom-dialog-btn.danger-btn:hover {
      background: #dc2626;
      border-color: #dc2626;
    }
    @keyframes dialogPop {
      from { opacity: 0; transform: scale(0.95) translateY(10px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
  `;
  document.head.appendChild(style);
}
