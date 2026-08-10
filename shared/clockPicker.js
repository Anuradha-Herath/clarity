/**
 * Clarity — shared/clockPicker.js
 * Interactive Circular Clock-Face Time Picker.
 * ES Module.
 */

let activePickerInstance = null;

/**
 * Parse time string or number into { hours, minutes, ampm }
 */
function parseTime(val) {
  let h = 8, m = 0, ampm = 'AM';

  if (typeof val === 'number') {
    // Decimal hour e.g. 8.5 -> 8:30
    h = Math.floor(val);
    m = Math.round((val - h) * 60);
  } else if (typeof val === 'string' && val.trim()) {
    const str = val.trim();
    // 12-hour format e.g. "08:30 AM" or "8:30 PM"
    const ampmMatch = str.match(/(AM|PM)/i);
    if (ampmMatch) {
      ampm = ampmMatch[1].toUpperCase();
      const parts = str.replace(/(AM|PM)/i, '').trim().split(':');
      h = parseInt(parts[0], 10) || 12;
      m = parseInt(parts[1], 10) || 0;
    } else {
      // 24-hour format e.g. "14:30"
      const parts = str.split(':');
      let h24 = parseInt(parts[0], 10) || 0;
      m = parseInt(parts[1], 10) || 0;
      if (h24 >= 12) {
        ampm = 'PM';
        h = h24 === 12 ? 12 : h24 - 12;
      } else {
        ampm = 'AM';
        h = h24 === 0 ? 12 : h24;
      }
    }
  }

  h = Math.max(1, Math.min(12, h));
  m = Math.max(0, Math.min(59, m));
  return { hours: h, minutes: m, ampm };
}

/**
 * Format hours, minutes, ampm into 24h ("14:30") and 12h ("08:30 AM") strings.
 */
function formatTime(hours, minutes, ampm) {
  let h24 = hours;
  if (ampm === 'PM' && hours < 12) h24 += 12;
  if (ampm === 'AM' && hours === 12) h24 = 0;

  const h24Str = String(h24).padStart(2, '0');
  const mStr = String(minutes).padStart(2, '0');
  const h12Str = String(hours).padStart(2, '0');

  return {
    val24: `${h24Str}:${mStr}`,
    val12: `${h12Str}:${mStr} ${ampm}`,
    hours12: hours,
    minutes,
    ampm
  };
}

/**
 * Open interactive circular clock face time picker dialog.
 * @param {string|number} initialTime Initial time string or decimal hour
 * @param {function} onSelect Callback (timeResult) => {}
 */
export function openClockPicker(initialTime = '08:00', onSelect) {
  if (activePickerInstance) {
    activePickerInstance.close();
  }

  let { hours, minutes, ampm } = parseTime(initialTime);
  let mode = 'hours'; // 'hours' | 'minutes'

  injectClockStyles();

  const overlay = document.createElement('div');
  overlay.className = 'cp-overlay';
  overlay.innerHTML = `
    <div class="cp-modal">
      <!-- Header Readout -->
      <div class="cp-header">
        <div class="cp-time-display">
          <button type="button" class="cp-unit-btn cp-unit-hours active" data-unit="hours">${String(hours).padStart(2, '0')}</button>
          <span class="cp-colon">:</span>
          <button type="button" class="cp-unit-btn cp-unit-minutes" data-unit="minutes">${String(minutes).padStart(2, '0')}</button>
        </div>
        <div class="cp-ampm-group">
          <button type="button" class="cp-ampm-btn ${ampm === 'AM' ? 'active' : ''}" data-ampm="AM">AM</button>
          <button type="button" class="cp-ampm-btn ${ampm === 'PM' ? 'active' : ''}" data-ampm="PM">PM</button>
        </div>
      </div>

      <!-- Quick Presets -->
      <div class="cp-presets">
        <button type="button" class="cp-chip" data-preset="07:00 AM">7:00 AM</button>
        <button type="button" class="cp-chip" data-preset="08:00 AM">8:00 AM</button>
        <button type="button" class="cp-chip" data-preset="09:00 AM">9:00 AM</button>
        <button type="button" class="cp-chip" data-preset="12:00 PM">12:00 PM</button>
        <button type="button" class="cp-chip" data-preset="01:00 PM">1:00 PM</button>
        <button type="button" class="cp-chip" data-preset="05:00 PM">5:00 PM</button>
        <button type="button" class="cp-chip" data-preset="06:00 PM">6:00 PM</button>
        <button type="button" class="cp-chip" data-preset="08:00 PM">8:00 PM</button>
      </div>

      <!-- Clock Dial Face -->
      <div class="cp-dial-wrapper">
        <div class="cp-dial">
          <div class="cp-hand"></div>
          <div class="cp-center-pin"></div>
          <div class="cp-numbers-layer"></div>
        </div>
      </div>

      <!-- Actions Footer -->
      <div class="cp-footer">
        <button type="button" class="cp-btn cp-cancel-btn">Cancel</button>
        <button type="button" class="cp-btn cp-ok-btn">OK</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const hoursBtn = overlay.querySelector('.cp-unit-hours');
  const minutesBtn = overlay.querySelector('.cp-unit-minutes');
  const amBtn = overlay.querySelector('[data-ampm="AM"]');
  const pmBtn = overlay.querySelector('[data-ampm="PM"]');
  const dial = overlay.querySelector('.cp-dial');
  const hand = overlay.querySelector('.cp-hand');
  const numbersLayer = overlay.querySelector('.cp-numbers-layer');
  const btnCancel = overlay.querySelector('.cp-cancel-btn');
  const btnOk = overlay.querySelector('.cp-ok-btn');

  function updateDisplay() {
    hoursBtn.textContent = String(hours).padStart(2, '0');
    minutesBtn.textContent = String(minutes).padStart(2, '0');

    hoursBtn.classList.toggle('active', mode === 'hours');
    minutesBtn.classList.toggle('active', mode === 'minutes');

    amBtn.classList.toggle('active', ampm === 'AM');
    pmBtn.classList.toggle('active', ampm === 'PM');

    renderDial();
  }

  function renderDial() {
    numbersLayer.innerHTML = '';
    const CENTER = 110;
    const RADIUS = 80;

    let degrees = 0;

    if (mode === 'hours') {
      const selectedHour = hours;
      degrees = (selectedHour % 12) * 30;

      for (let h = 1; h <= 12; h++) {
        const deg = (h % 12) * 30;
        const rad = (deg - 90) * (Math.PI / 180);
        const x = CENTER + RADIUS * Math.cos(rad);
        const y = CENTER + RADIUS * Math.sin(rad);

        const node = document.createElement('div');
        node.className = `cp-num ${h === hours ? 'selected' : ''}`;
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        node.textContent = h;
        node.dataset.val = h;
        numbersLayer.appendChild(node);
      }
    } else {
      // Minutes mode
      const selectedMin = minutes;
      degrees = (selectedMin / 60) * 360;

      for (let m = 0; m < 60; m += 5) {
        const deg = (m / 60) * 360;
        const rad = (deg - 90) * (Math.PI / 180);
        const x = CENTER + RADIUS * Math.cos(rad);
        const y = CENTER + RADIUS * Math.sin(rad);

        const node = document.createElement('div');
        node.className = `cp-num ${Math.abs(m - minutes) < 3 ? 'selected' : ''}`;
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        node.textContent = String(m).padStart(2, '0');
        node.dataset.val = m;
        numbersLayer.appendChild(node);
      }
    }

    hand.style.transform = `rotate(${degrees}deg)`;
  }

  function handleDialInteraction(e) {
    const rect = dial.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const dx = clientX - centerX;
    const dy = clientY - centerY;

    let rad = Math.atan2(dy, dx);
    let deg = rad * (180 / Math.PI) + 90;
    if (deg < 0) deg += 360;

    if (mode === 'hours') {
      let h = Math.round(deg / 30);
      if (h === 0) h = 12;
      hours = h;
    } else {
      let m = Math.round((deg / 360) * 60) % 60;
      m = Math.round(m / 5) * 5 % 60;
      minutes = m;
    }
    updateDisplay();
  }

  let isDragging = false;

  dial.addEventListener('mousedown', (e) => {
    isDragging = true;
    handleDialInteraction(e);
  });

  dial.addEventListener('mousemove', (e) => {
    if (isDragging) handleDialInteraction(e);
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      if (mode === 'hours') {
        setTimeout(() => {
          mode = 'minutes';
          updateDisplay();
        }, 150);
      }
    }
  });

  dial.addEventListener('touchstart', (e) => {
    isDragging = true;
    handleDialInteraction(e);
  }, { passive: true });

  dial.addEventListener('touchmove', (e) => {
    if (isDragging) handleDialInteraction(e);
  }, { passive: true });

  dial.addEventListener('touchend', () => {
    if (isDragging) {
      isDragging = false;
      if (mode === 'hours') {
        setTimeout(() => {
          mode = 'minutes';
          updateDisplay();
        }, 150);
      }
    }
  });

  hoursBtn.onclick = () => { mode = 'hours'; updateDisplay(); };
  minutesBtn.onclick = () => { mode = 'minutes'; updateDisplay(); };

  amBtn.onclick = () => { ampm = 'AM'; updateDisplay(); };
  pmBtn.onclick = () => { ampm = 'PM'; updateDisplay(); };

  overlay.querySelectorAll('.cp-chip').forEach(chip => {
    chip.onclick = () => {
      const parsed = parseTime(chip.dataset.preset);
      hours = parsed.hours;
      minutes = parsed.minutes;
      ampm = parsed.ampm;
      updateDisplay();
    };
  });

  function close() {
    overlay.remove();
    activePickerInstance = null;
  }

  btnCancel.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };

  btnOk.onclick = () => {
    const res = formatTime(hours, minutes, ampm);
    onSelect?.(res);
    close();
  };

  updateDisplay();

  activePickerInstance = { close };
}

/**
 * Attach clock picker to an input element.
 */
export function attachClockPicker(inputEl, options = {}) {
  if (!inputEl || inputEl._hasClockPicker) return;
  inputEl._hasClockPicker = true;

  if (inputEl.type === 'time') {
    inputEl.type = 'text';
    inputEl.readOnly = true;
    inputEl.style.cursor = 'pointer';
  } else {
    inputEl.readOnly = true;
    inputEl.style.cursor = 'pointer';
  }

  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const currentVal = inputEl.value || options.defaultTime || '08:00 AM';

    openClockPicker(currentVal, (res) => {
      const finalVal = options.format24 ? res.val24 : res.val12;
      inputEl.value = finalVal;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      options.onSelect?.(res);
    });
  };

  inputEl.addEventListener('click', handler);
  inputEl.addEventListener('focus', handler);
}

function injectClockStyles() {
  if (document.getElementById('cp-styles')) return;

  const style = document.createElement('style');
  style.id = 'cp-styles';
  style.textContent = `
    .cp-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(4px);
      z-index: 9999999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      animation: cpFade 0.15s ease-out;
    }
    @keyframes cpFade {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .cp-modal {
      background: var(--color-surface, #ffffff);
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 16px;
      width: 100%;
      max-width: 320px;
      padding: 20px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      display: flex;
      flex-direction: column;
      align-items: center;
      animation: cpPop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes cpPop {
      from { opacity: 0; transform: scale(0.92) translateY(10px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .cp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--color-border, #e2e8f0);
    }
    .cp-time-display {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .cp-unit-btn {
      font-size: 32px;
      font-weight: 700;
      color: var(--color-text-muted, #64748b);
      background: transparent;
      border: none;
      border-radius: 8px;
      padding: 2px 8px;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s ease;
    }
    .cp-unit-btn.active {
      color: var(--color-primary, #4f46e5);
      background: rgba(79, 70, 229, 0.1);
    }
    .cp-colon {
      font-size: 30px;
      font-weight: 700;
      color: var(--color-text-muted, #94a3b8);
    }
    .cp-ampm-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
      background: var(--color-bg, #f8fafc);
      padding: 3px;
      border-radius: 8px;
      border: 1px solid var(--color-border, #e2e8f0);
    }
    .cp-ampm-btn {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: var(--color-text-muted, #64748b);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .cp-ampm-btn.active {
      background: var(--color-primary, #4f46e5);
      color: #ffffff;
      box-shadow: 0 2px 4px rgba(79, 70, 229, 0.3);
    }
    .cp-presets {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      width: 100%;
      margin-bottom: 16px;
      justify-content: center;
    }
    .cp-chip {
      font-size: 11px;
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 12px;
      border: 1px solid var(--color-border, #e2e8f0);
      background: var(--color-bg, #f8fafc);
      color: var(--color-text, #1e293b);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .cp-chip:hover {
      background: var(--color-primary, #4f46e5);
      color: #ffffff;
      border-color: var(--color-primary, #4f46e5);
    }
    .cp-dial-wrapper {
      width: 220px;
      height: 220px;
      position: relative;
      margin-bottom: 16px;
      user-select: none;
    }
    .cp-dial {
      width: 220px;
      height: 220px;
      border-radius: 50%;
      background: var(--color-bg, #f8fafc);
      border: 1px solid var(--color-border, #e2e8f0);
      position: relative;
      cursor: pointer;
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.05);
    }
    .cp-center-pin {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--color-primary, #4f46e5);
      position: absolute;
      top: 106px;
      left: 106px;
      z-index: 5;
    }
    .cp-hand {
      width: 2px;
      height: 80px;
      background: var(--color-primary, #4f46e5);
      position: absolute;
      top: 30px;
      left: 109px;
      transform-origin: center bottom;
      transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
      z-index: 4;
      pointer-events: none;
    }
    .cp-hand::before {
      content: '';
      position: absolute;
      top: -14px;
      left: -13px;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(79, 70, 229, 0.25);
      border: 2px solid var(--color-primary, #4f46e5);
    }
    .cp-numbers-layer {
      position: absolute;
      inset: 0;
    }
    .cp-num {
      position: absolute;
      width: 28px;
      height: 28px;
      margin-left: -14px;
      margin-top: -14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text, #1e293b);
      border-radius: 50%;
      z-index: 6;
      transition: all 0.15s ease;
      pointer-events: none;
    }
    .cp-num.selected {
      color: #ffffff;
      font-weight: 700;
      background: var(--color-primary, #4f46e5);
      box-shadow: 0 2px 6px rgba(79, 70, 229, 0.4);
    }
    .cp-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      width: 100%;
    }
    .cp-btn {
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid var(--color-border, #e2e8f0);
      background: transparent;
      color: var(--color-text, #1e293b);
      transition: all 0.15s ease;
      font-family: inherit;
    }
    .cp-btn:hover {
      background: var(--color-bg-hover, #f8fafc);
    }
    .cp-ok-btn {
      background: var(--color-primary, #4f46e5);
      color: #ffffff;
      border-color: var(--color-primary, #4f46e5);
    }
    .cp-ok-btn:hover {
      opacity: 0.9;
    }
  `;

  document.head.appendChild(style);
}
