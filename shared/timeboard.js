/**
 * Clarity — shared/timeboard.js
 * Reusable drag-to-create time block board.
 * ES Module.
 *
 * Usage:
 *   import { mountTimeboard } from '../shared/timeboard.js';
 *   const board = mountTimeboard(containerEl, '2026-06-09', {
 *     getSelectedCat: () => activeCategory,
 *   });
 *   board.refresh('2026-06-10');
 *   board.destroy();
 */

import {
  getBlocks, addBlock, updateBlock, deleteBlock,
  generateId, snapHour, formatHour, timeToDec, decimalToTime, todayKey,
} from './storage.js';

// ─── Constants ─────────────────────────────────────────────────────────────────
const BOARD_START = 6;    // 6 AM
const BOARD_END   = 23;   // 11 PM
const PX_PER_HOUR = 48;   // pixels per hour
const TOTAL_HOURS = BOARD_END - BOARD_START; // 17

const CATEGORIES = ['Deep Work', 'Meetings', 'Health', 'Learning', 'Personal', 'Break'];
const CAT_STYLE  = {
  'Deep Work': { bg: '#EEF2FF', acc: '#4F46E5', txt: '#3730A3' },
  'Meetings':  { bg: '#FFF1F2', acc: '#E11D48', txt: '#BE123C' },
  'Health':    { bg: '#F0FDF4', acc: '#16A34A', txt: '#15803D' },
  'Learning':  { bg: '#FFFBEB', acc: '#D97706', txt: '#B45309' },
  'Personal':  { bg: '#F5F3FF', acc: '#7C3AED', txt: '#5B21B6' },
  'Break':     { bg: '#F8FAFC', acc: '#94A3B8', txt: '#475569' },
};

// ─── Coordinate helpers ────────────────────────────────────────────────────────
function hourToPx(h) { return (h - BOARD_START) * PX_PER_HOUR; }
function pxToHour(px) { return px / PX_PER_HOUR + BOARD_START; }
function clampH(h) { return Math.max(BOARD_START, Math.min(BOARD_END, h)); }
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Service-worker alarm helpers ──────────────────────────────────────────────
function registerAlarm(block, date) {
  try { chrome.runtime.sendMessage({ type: 'REGISTER_BLOCK_ALARM', block, date }); } catch (_) {}
}
function cancelAlarm(id) {
  try { chrome.runtime.sendMessage({ type: 'CANCEL_BLOCK_ALARM', blockId: id }); } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// mountTimeboard — main export
// ═══════════════════════════════════════════════════════════════════════════════
export function mountTimeboard(containerEl, initialDate, opts = {}) {
  const getSelectedCat = opts.getSelectedCat ?? (() => 'Deep Work');

  let date   = initialDate;
  let blocks = [];

  // Drag state
  let dragCreate = null; // { startHour, endHour, ghost }
  let dragResize = null; // { block, el, currentEnd }
  let dragMove   = null; // { block, el, startY, blockStart, duration, hasMoved }
  let ignoreNextClick = false;

  // ── Build board skeleton ────────────────────────────────────────────────────
  containerEl.innerHTML = '';
  containerEl.style.position = 'relative';

  const boardEl = document.createElement('div');
  boardEl.style.cssText = 'height:100%; overflow-y:auto; overflow-x:hidden; position:relative;';

  const innerEl = document.createElement('div');
  innerEl.style.cssText = 'display:flex; position:relative;';

  // Labels column (52px wide, one label per hour)
  const labelsEl = document.createElement('div');
  labelsEl.style.cssText = 'width:52px; flex-shrink:0;';
  for (let h = BOARD_START; h < BOARD_END; h++) {
    const lbl = document.createElement('div');
    lbl.style.cssText = `height:${PX_PER_HOUR}px; display:flex; align-items:flex-start;
      padding-top:2px; padding-right:8px; font-size:10px; color:#64748B;
      font-weight:500; justify-content:flex-end; box-sizing:border-box;
      font-family:inherit;`;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const disp = h > 12 ? h - 12 : h === 0 ? 12 : h;
    lbl.textContent = `${disp} ${ampm}`;
    labelsEl.appendChild(lbl);
  }

  // Grid (fills remaining width, position:relative for absolute blocks)
  const gridEl = document.createElement('div');
  gridEl.style.cssText = `flex:1; position:relative; border-left:1px solid #E2E8F0;
    height:${TOTAL_HOURS * PX_PER_HOUR}px; overflow:visible;`;

  // Slot lines
  const totalSlots = TOTAL_HOURS * 2; // 34 half-hour slots
  for (let i = 0; i < totalSlots; i++) {
    const slot = document.createElement('div');
    const isHalf = i % 2 !== 0;
    slot.style.cssText = `height:${PX_PER_HOUR / 2}px; border-bottom:1px ${isHalf ? 'dashed' : 'solid'} ${isHalf ? '#f1f5f9' : '#E2E8F0'}; box-sizing:border-box;`;
    gridEl.appendChild(slot);
  }

  // Now line
  const nowLineEl = document.createElement('div');
  nowLineEl.style.cssText = 'position:absolute; left:0; right:0; height:2px; background:#E11D48; z-index:10; pointer-events:none; display:none;';
  const nowDot = document.createElement('div');
  nowDot.style.cssText = 'position:absolute; left:-4px; top:-4px; width:10px; height:10px; border-radius:50%; background:#E11D48;';
  nowLineEl.appendChild(nowDot);
  gridEl.appendChild(nowLineEl);

  innerEl.appendChild(labelsEl);
  innerEl.appendChild(gridEl);
  boardEl.appendChild(innerEl);
  containerEl.appendChild(boardEl);

  // ── Now line updater ────────────────────────────────────────────────────────
  function updateNowLine() {
    const now   = new Date();
    const h     = now.getHours() + now.getMinutes() / 60;
    const today = now.toISOString().slice(0, 10);
    if (date === today && h >= BOARD_START && h <= BOARD_END) {
      nowLineEl.style.top     = hourToPx(h) + 'px';
      nowLineEl.style.display = 'block';
    } else {
      nowLineEl.style.display = 'none';
    }
  }
  updateNowLine();
  const nowTimer = setInterval(updateNowLine, 30000);

  // ── Block rendering ─────────────────────────────────────────────────────────
  function renderBlocks() {
    gridEl.querySelectorAll('[data-block]').forEach(el => el.remove());
    for (const b of blocks) {
      const el = makeBlockEl(b);
      gridEl.appendChild(el);
    }
    gridEl.appendChild(nowLineEl); // keep now line on top
  }

  function makeBlockEl(b) {
    const top    = hourToPx(b.start);
    const height = Math.max(PX_PER_HOUR / 2, hourToPx(b.end) - hourToPx(b.start));
    const s      = CAT_STYLE[b.cat] ?? CAT_STYLE['Break'];

    const el = document.createElement('div');
    el.dataset.block = b.id;
    el.style.cssText = `
      position: absolute;
      top: ${top}px;
      height: ${height}px;
      left: 2px; right: 2px;
      background: ${s.bg};
      border-left: 3px solid ${s.acc};
      color: ${s.txt};
      border-radius: 6px;
      overflow: hidden;
      cursor: default;
      padding: 3px 7px 3px 18px;
      user-select: none;
      z-index: 2;
      box-sizing: border-box;
      transition: opacity 150ms;
    `;
    const isSmall = height < 35;
    el.innerHTML = isSmall ? `
      <div data-drag-handle style="position:absolute; left:2px; top:0; bottom:0; width:12px; display:flex; align-items:center; justify-content:center; cursor:grab; opacity:0.4; font-size:12px; font-weight:bold; color:${s.txt};" title="Drag to move slot">⋮</div>
      <div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:18px;cursor:pointer;padding-right:8px;">
        ${esc(b.title || 'Untitled')}
        <span data-time-label style="font-size:9px;font-weight:normal;opacity:0.8;margin-left:4px;">(${formatHour(b.start)} – ${formatHour(b.end)})</span>
      </div>
      <div data-resize-handle style="position:absolute;bottom:0;left:0;right:0;height:7px;cursor:s-resize;"></div>
    ` : `
      <div data-drag-handle style="position:absolute; left:2px; top:0; bottom:0; width:12px; display:flex; align-items:center; justify-content:center; cursor:grab; opacity:0.4; font-size:12px; font-weight:bold; color:${s.txt};" title="Drag to move slot">⋮</div>
      <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3;cursor:pointer;">${esc(b.title || 'Untitled')}</div>
      <div data-time-label style="font-size:10px;opacity:0.75;margin-top:1px;cursor:pointer;">${formatHour(b.start)} – ${formatHour(b.end)}</div>
      <div data-resize-handle style="position:absolute;bottom:0;left:0;right:0;height:7px;cursor:s-resize;"></div>
    `;

    el.addEventListener('mouseenter', () => { el.style.opacity = '0.88'; });
    el.addEventListener('mouseleave', () => { el.style.opacity = '1'; });
 
    // Click → edit modal
    el.addEventListener('click', (e) => {
      if (ignoreNextClick) {
        ignoreNextClick = false;
        return;
      }
      if (e.target.dataset.resizeHandle !== undefined || e.target.closest('[data-drag-handle]')) return;
      e.stopPropagation();
      openBlockModal(b, false);
    });

    // Mouse drag to move block - ONLY on drag handle
    el.querySelector('[data-drag-handle]').addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      
      const startY = e.clientY;
      const blockStart = b.start;
      const duration = b.end - b.start;
      
      dragMove = {
        block: b,
        el,
        startY,
        blockStart,
        duration,
        hasMoved: true
      };
      document.body.style.userSelect = 'none';
      const handle = el.querySelector('[data-drag-handle]');
      if (handle) handle.style.cursor = 'grabbing';
    });
 
    // Resize handle mousedown
    el.querySelector('[data-resize-handle]').addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      document.body.style.userSelect = 'none';
      dragResize = { block: b, el, currentEnd: b.end };
    });
 
    return el;
  }

  // ── Drag to create ──────────────────────────────────────────────────────────
  function getGridY(e) {
    const rect = gridEl.getBoundingClientRect();
    return e.clientY - rect.top + boardEl.scrollTop;
  }

  gridEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('[data-block]')) return;
    e.preventDefault();
    const startHour = snapHour(clampH(pxToHour(getGridY(e))));
    dragCreate = { startHour, endHour: startHour + 0.5, ghost: null };
  });

  // ── Drag & Drop tasks onto grid ─────────────────────────────────────────────
  gridEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  gridEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    try {
      const dataStr = e.dataTransfer.getData('text/plain');
      if (!dataStr) return;
      const taskData = JSON.parse(dataStr);
      if (!taskData || !taskData.title) return;

      const startHour = snapHour(clampH(pxToHour(getGridY(e))));
      
      // Snapping to estimate or defaulting to 1 hour
      const duration = taskData.timeEstimate ? Math.max(0.5, snapHour(taskData.timeEstimate / 60)) : 1.0;
      const endHour = Math.min(BOARD_END, startHour + duration);

      // Map task category to timeboard categories
      let blockCat = getSelectedCat();
      // If task has a category, match or map it
      if (taskData.category) {
        // Find if taskData.category is an exact match or close match to timeline categories
        const matched = CATEGORIES.find(c => c.toLowerCase() === taskData.category.toLowerCase());
        if (matched) blockCat = matched;
      }

      const newBlock = {
        id:    generateId(),
        title: taskData.title,
        cat:   blockCat,
        start: startHour,
        end:   endHour,
      };

      await addBlock(date, newBlock);
      registerAlarm(newBlock, date);
      await loadBlocks();
    } catch (err) {
      console.error('[Timeboard Drop] failed:', err);
    }
  });

  // ── Global mousemove / mouseup ──────────────────────────────────────────────
  function onMouseMove(e) {
    if (dragCreate) {
      const rawEnd = snapHour(clampH(pxToHour(getGridY(e))));
      dragCreate.endHour = Math.max(dragCreate.startHour + 0.5, rawEnd);

      if (!dragCreate.ghost) {
        const g = document.createElement('div');
        g.style.cssText = `position:absolute; left:2px; right:2px;
          background:#EEF2FF; border:2px dashed #4F46E5; border-radius:6px;
          opacity:0.75; pointer-events:none; z-index:5; box-sizing:border-box;`;
        gridEl.appendChild(g);
        dragCreate.ghost = g;
        document.body.style.userSelect = 'none';
      }

      const s = dragCreate.startHour;
      const e2 = dragCreate.endHour;
      dragCreate.ghost.style.top    = hourToPx(s) + 'px';
      dragCreate.ghost.style.height = Math.max(24, hourToPx(e2) - hourToPx(s)) + 'px';
    }

    if (dragResize) {
      const newEnd = Math.max(
        dragResize.block.start + 0.5,
        snapHour(clampH(pxToHour(getGridY(e))))
      );
      dragResize.currentEnd = newEnd;
      dragResize.el.style.height = Math.max(24, hourToPx(newEnd) - hourToPx(dragResize.block.start)) + 'px';
    }

    if (dragMove) {
      ignoreNextClick = true;
      const deltaY = e.clientY - dragMove.startY;
      const deltaHours = deltaY / PX_PER_HOUR;
      let newStart = snapHour(clampH(dragMove.blockStart + deltaHours));
      newStart = Math.max(BOARD_START, Math.min(BOARD_END - dragMove.duration, newStart));
      const newEnd = newStart + dragMove.duration;
      
      dragMove.el.style.top = hourToPx(newStart) + 'px';
      
      // Update text representation of time inside the element
      const timeLabel = dragMove.el.querySelector('[data-time-label]');
      if (timeLabel) {
        const isSmall = dragMove.duration <= 0.5;
        timeLabel.textContent = isSmall ? `(${formatHour(newStart)} – ${formatHour(newEnd)})` : `${formatHour(newStart)} – ${formatHour(newEnd)}`;
      }
      
      dragMove.currentStart = newStart;
      dragMove.currentEnd = newEnd;
    }
  }

  async function onMouseUp() {
    document.body.style.userSelect = '';

    if (dragCreate) {
      const { startHour, endHour, ghost } = dragCreate;
      if (ghost) ghost.remove();
      dragCreate = null;

      if (endHour - startHour >= 0.5) {
        const newBlock = {
          id:    generateId(),
          title: '',
          cat:   getSelectedCat(),
          start: startHour,
          end:   endHour,
        };
        openBlockModal(newBlock, true);
      }
      return;
    }

    if (dragResize) {
      const { block, currentEnd } = dragResize;
      dragResize = null;
      if (currentEnd !== block.end) {
        await updateBlock(date, block.id, { end: currentEnd });
        cancelAlarm(block.id);
        registerAlarm({ ...block, end: currentEnd }, date);
        await loadBlocks();
      }
      return;
    }

    if (dragMove) {
      const { block, currentStart, currentEnd } = dragMove;
      dragMove = null;

      if (currentStart !== undefined && currentEnd !== undefined) {
        if (currentStart !== block.start || currentEnd !== block.end) {
          await updateBlock(date, block.id, { start: currentStart, end: currentEnd });
          cancelAlarm(block.id);
          registerAlarm({ ...block, start: currentStart, end: currentEnd }, date);
          await loadBlocks();
        }
      }
    }
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);

  // ── Block modal ─────────────────────────────────────────────────────────────
  const modal = buildBlockModal();
  document.body.appendChild(modal.el);

  function openBlockModal(block, isNew) {
    modal.show(block, isNew, {
      onSave: async (updated) => {
        if (isNew) {
          await addBlock(date, updated);
          registerAlarm(updated, date);
        } else {
          await updateBlock(date, updated.id, updated);
          cancelAlarm(updated.id);
          registerAlarm(updated, date);
        }
        modal.hide();
        await loadBlocks();
      },
      onDelete: async () => {
        await deleteBlock(date, block.id);
        cancelAlarm(block.id);
        modal.hide();
        await loadBlocks();
      },
    });
  }

  // ── Storage ─────────────────────────────────────────────────────────────────
  async function loadBlocks() {
    blocks = await getBlocks(date);
    renderBlocks();
  }

  // ── Scroll to now ────────────────────────────────────────────────────────────
  function scrollToNow() {
    const now = new Date();
    const h   = now.getHours() + now.getMinutes() / 60;
    boardEl.scrollTop = Math.max(0, hourToPx(h) - 150);
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  loadBlocks().then(() => {
    if (date === todayKey()) setTimeout(scrollToNow, 60);
  });

  // ── Public API ────────────────────────────────────────────────────────────────
  return {
    refresh(newDate) {
      date = newDate;
      updateNowLine();
      loadBlocks().then(() => {
        if (date === todayKey()) setTimeout(scrollToNow, 60);
      });
    },
    destroy() {
      clearInterval(nowTimer);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
      if (modal.el.parentNode) modal.el.remove();
      containerEl.innerHTML = '';
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Block edit modal builder
// ═══════════════════════════════════════════════════════════════════════════════
function buildBlockModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(15,23,42,0.45);
    display: flex; align-items: center; justify-content: center;
    z-index: 9000; padding: 16px;
  `;
  overlay.classList.add('hidden');

  overlay.innerHTML = `
    <div style="background:#fff; border:1px solid #E2E8F0; border-radius:10px;
                width:100%; max-width:420px; display:flex; flex-direction:column;
                font-family:inherit; overflow:hidden;">
      <!-- Header -->
      <div style="display:flex; align-items:center; justify-content:space-between;
                  padding:14px 18px 12px; border-bottom:1px solid #E2E8F0;">
        <div style="font-size:15px; font-weight:700; color:#1E293B;" data-modal-title>Edit Block</div>
        <button data-btn-close style="background:none; border:none; cursor:pointer;
                width:30px; height:30px; border-radius:6px; display:flex; align-items:center;
                justify-content:center; color:#64748B; font-family:inherit; font-size:18px;"
                title="Close">✕</button>
      </div>
      <!-- Body -->
      <div style="padding:18px; display:flex; flex-direction:column; gap:14px;">
        <!-- Title -->
        <div>
          <label style="display:block; font-size:11px; font-weight:600; color:#64748B;
                         text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px;">Block title</label>
          <input data-title type="text" maxlength="120" placeholder="e.g. Deep work — project X"
                 style="width:100%; padding:8px 12px; border:1px solid #E2E8F0; border-radius:6px;
                        font-size:14px; font-family:inherit; color:#1E293B; outline:none;
                        transition:border-color 150ms; box-sizing:border-box;" />
        </div>
        <!-- Category -->
        <div>
          <label style="display:block; font-size:11px; font-weight:600; color:#64748B;
                         text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px;">Category</label>
          <div data-cat-picker style="display:flex; flex-wrap:wrap; gap:6px;"></div>
        </div>
        <!-- Time -->
        <div style="display:flex; gap:12px;">
          <div style="flex:1;">
            <label style="display:block; font-size:11px; font-weight:600; color:#64748B;
                           text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px;">Start</label>
            <input data-start type="time" step="1800"
                   style="width:100%; padding:8px 12px; border:1px solid #E2E8F0; border-radius:6px;
                          font-size:14px; font-family:inherit; color:#1E293B; outline:none; box-sizing:border-box;" />
          </div>
          <div style="flex:1;">
            <label style="display:block; font-size:11px; font-weight:600; color:#64748B;
                           text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px;">End</label>
            <input data-end type="time" step="1800"
                   style="width:100%; padding:8px 12px; border:1px solid #E2E8F0; border-radius:6px;
                          font-size:14px; font-family:inherit; color:#1E293B; outline:none; box-sizing:border-box;" />
          </div>
        </div>
      </div>
      <!-- Footer -->
      <div style="display:flex; align-items:center; justify-content:space-between;
                  padding:12px 18px; border-top:1px solid #E2E8F0;">
        <button data-btn-delete style="display:none; padding:7px 12px; border-radius:6px; font-size:13px;
                font-weight:500; cursor:pointer; background:#FFF1F2; color:#E11D48;
                border:none; font-family:inherit; transition:background 150ms;">Delete block</button>
        <div style="display:flex; gap:8px; margin-left:auto;">
          <button data-btn-cancel style="padding:7px 14px; border-radius:6px; font-size:13px;
                  font-weight:500; cursor:pointer; background:#fff; color:#1E293B;
                  border:1px solid #E2E8F0; font-family:inherit; transition:background 150ms;">Cancel</button>
          <button data-btn-save style="padding:7px 14px; border-radius:6px; font-size:13px;
                  font-weight:600; cursor:pointer; background:#4F46E5; color:#fff;
                  border:none; font-family:inherit; transition:background 150ms;">Save block</button>
        </div>
      </div>
    </div>
  `;

  // Build category picker
  const picker = overlay.querySelector('[data-cat-picker]');
  const CAT_S = {
    'Deep Work': { bg:'#EEF2FF', acc:'#4F46E5', txt:'#3730A3' },
    'Meetings':  { bg:'#FFF1F2', acc:'#E11D48', txt:'#BE123C' },
    'Health':    { bg:'#F0FDF4', acc:'#16A34A', txt:'#15803D' },
    'Learning':  { bg:'#FFFBEB', acc:'#D97706', txt:'#B45309' },
    'Personal':  { bg:'#F5F3FF', acc:'#7C3AED', txt:'#5B21B6' },
    'Break':     { bg:'#F8FAFC', acc:'#94A3B8', txt:'#475569' },
  };

  let selCat = 'Deep Work';
  const catBtns = {};

  CATEGORIES.forEach((cat) => {
    const s   = CAT_S[cat];
    const btn = document.createElement('button');
    btn.textContent = cat;
    btn.style.cssText = `padding:4px 10px; border-radius:20px; font-size:11px; font-weight:600;
      cursor:pointer; background:${s.bg}; color:${s.txt}; border:2px solid transparent;
      font-family:inherit; transition:border-color 150ms;`;
    btn.addEventListener('click', () => selectCat(cat));
    picker.appendChild(btn);
    catBtns[cat] = btn;
  });

  function selectCat(cat) {
    selCat = cat;
    CATEGORIES.forEach((c) => {
      catBtns[c].style.borderColor = c === cat ? CAT_S[c].acc : 'transparent';
    });
  }

  // Focus ring on title input
  const titleInput = overlay.querySelector('[data-title]');
  titleInput.addEventListener('focus', () => {
    titleInput.style.borderColor = '#4F46E5';
    titleInput.style.boxShadow   = '0 0 0 3px rgba(79,70,229,0.15)';
  });
  titleInput.addEventListener('blur', () => {
    titleInput.style.borderColor = '#E2E8F0';
    titleInput.style.boxShadow   = 'none';
  });

  // Callbacks and state
  let onSaveCb   = null;
  let onDeleteCb = null;
  let curBlock   = null;

  const q = (sel) => overlay.querySelector(sel);

  function hide() {
    overlay.classList.add('hidden');
    curBlock = onSaveCb = onDeleteCb = null;
  }

  q('[data-btn-close]').addEventListener('click',  hide);
  q('[data-btn-cancel]').addEventListener('click', hide);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hide(); });

  q('[data-btn-save]').addEventListener('click', () => {
    const title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return; }
    const startStr = q('[data-start]').value;
    const endStr   = q('[data-end]').value;
    const start = startStr ? snapHour(clampH(timeToDec(startStr))) : curBlock.start;
    const rawEnd = endStr   ? snapHour(clampH(timeToDec(endStr)))   : curBlock.end;
    const end = Math.max(start + 0.5, rawEnd);
    onSaveCb?.({ ...curBlock, title, cat: selCat, start, end });
  });

  q('[data-btn-delete]').addEventListener('click', () => { onDeleteCb?.(); });

  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); q('[data-btn-save]').click(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) hide();
  });

  function show(block, isNew, cbs) {
    curBlock   = block;
    onSaveCb   = cbs.onSave;
    onDeleteCb = cbs.onDelete;

    q('[data-modal-title]').textContent = isNew ? 'New Block' : 'Edit Block';
    titleInput.value            = block.title ?? '';
    q('[data-start]').value     = decimalToTime(block.start);
    q('[data-end]').value       = decimalToTime(block.end);
    q('[data-btn-delete]').style.display = isNew ? 'none' : '';

    selectCat(block.cat ?? 'Deep Work');
    overlay.classList.remove('hidden');
    setTimeout(() => titleInput.focus(), 50);
  }

  return { el: overlay, show, hide };
}
