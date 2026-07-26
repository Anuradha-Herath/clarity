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
  getBlocks, addBlock, updateBlock, deleteBlock, setBlocks,
  generateId, snapHour, formatHour, timeToDec, decimalToTime, todayKey,
  getCustomCategories,
  getRecurringTemplates, addRecurringTemplate, updateRecurringTemplate, deleteRecurringTemplate,
  syncRecurringTemplateForRange, updateFutureRecurringInstances, removeFutureRecurringInstances,
  findNextFreeSlot, autoRescheduleBlocks, deferBlocksToDate
} from './storage.js';

// ─── Constants ─────────────────────────────────────────────────────────────────
const BOARD_START = 6;    // 6 AM
const BOARD_END   = 24;   // 12 AM (Midnight)
const PX_PER_HOUR = 48;   // pixels per hour
const TOTAL_HOURS = BOARD_END - BOARD_START; // 18

export function getCategoryColor(cat) {
  const palettes = [
    { bg: '#F5F3FF', acc: '#7C3AED', txt: '#5B21B6' }, // Purple
    { bg: '#EEF2FF', acc: '#4F46E5', txt: '#3730A3' }, // Indigo
    { bg: '#FFF1F2', acc: '#E11D48', txt: '#BE123C' }, // Red
    { bg: '#F0FDF4', acc: '#16A34A', txt: '#15803D' }, // Green
    { bg: '#FFFBEB', acc: '#D97706', txt: '#B45309' }, // Amber
    { bg: '#ECFDF5', acc: '#059669', txt: '#047857' }, // Emerald
    { bg: '#F0FDFA', acc: '#0D9488', txt: '#0F766E' }, // Teal
    { bg: '#F0F9FF', acc: '#0284C7', txt: '#0369A1' }, // Sky
    { bg: '#F4F4F5', acc: '#71717A', txt: '#3F3F46' }, // Zinc
  ];
  
  const lowerCat = String(cat ?? '').toLowerCase();
  if (lowerCat.includes('personal')) return palettes[0];
  if (lowerCat.includes('academic') || lowerCat.includes('study') || lowerCat.includes('school')) return palettes[1];
  if (lowerCat.includes('meeting') || lowerCat.includes('call') || lowerCat.includes('zoom')) return palettes[2];
  if (lowerCat.includes('gym') || lowerCat.includes('health') || lowerCat.includes('workout') || lowerCat.includes('exercise')) return palettes[3];
  if (lowerCat.includes('chore') || lowerCat.includes('home') || lowerCat.includes('house')) return palettes[4];
  if (lowerCat.includes('company') || lowerCat.includes('work') || lowerCat.includes('job')) return palettes[7];
  if (lowerCat.includes('project') || lowerCat.includes('extension')) return palettes[5];
  if (lowerCat.includes('break') || lowerCat.includes('rest') || lowerCat.includes('sleep')) return palettes[8];

  let hash = 0;
  const str = String(cat ?? '');
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % palettes.length;
  return palettes[idx];
}

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
  let bannerDismissed = false;

  // Drag state
  let dragCreate = null; // { startHour, endHour, ghost }
  let dragResize = null; // { block, el, currentEnd }
  let dragMove   = null; // { block, el, startY, blockStart, duration, hasMoved }
  let ignoreNextClick = false;

  // ── Build board skeleton ────────────────────────────────────────────────────
  containerEl.innerHTML = '';
  containerEl.style.position = 'relative';

  // Rolling Queue Banner Top Bar
  const bannerWrapper = document.createElement('div');
  bannerWrapper.style.cssText = 'padding: 8px 12px 0 56px; display: none;';
  
  const bannerEl = document.createElement('div');
  bannerEl.style.cssText = `
    background: linear-gradient(135deg, #FEF2F2, #FFF7ED);
    border: 1px solid #FCA5A5;
    border-radius: 8px;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    box-shadow: 0 2px 8px rgba(225, 29, 72, 0.08);
  `;
  bannerWrapper.appendChild(bannerEl);
  containerEl.appendChild(bannerWrapper);

  const boardEl = document.createElement('div');
  boardEl.style.cssText = 'height:100%; overflow-y:auto; overflow-x:hidden; position:relative;';

  const innerEl = document.createElement('div');
  innerEl.style.cssText = 'display:flex; position:relative;';

  // Labels column (56px wide, labels centered on line boundaries)
  const labelsEl = document.createElement('div');
  labelsEl.style.cssText = 'width:56px; flex-shrink:0; position:relative;';
  for (let h = BOARD_START; h <= BOARD_END; h++) {
    const topPx = (h - BOARD_START) * PX_PER_HOUR;
    const lbl = document.createElement('div');
    lbl.style.cssText = `position:absolute; top:${topPx}px; transform:translateY(-50%);
      right:8px; font-size:11px; color:#475569; font-weight:600;
      line-height:1; font-family:inherit; white-space:nowrap; pointer-events:none;`;
    const ampm = h >= 12 && h < 24 ? 'PM' : 'AM';
    const disp = h > 12 ? (h > 24 ? h - 24 : h - 12) : (h === 0 || h === 24 ? 12 : h);
    lbl.textContent = `${disp} ${ampm}`;
    labelsEl.appendChild(lbl);

    // Half-hour label (subtle :30 mark)
    if (h < BOARD_END) {
      const halfTopPx = topPx + (PX_PER_HOUR / 2);
      const halfLbl = document.createElement('div');
      halfLbl.style.cssText = `position:absolute; top:${halfTopPx}px; transform:translateY(-50%);
        right:8px; font-size:9px; color:#94A3B8; font-weight:500;
        line-height:1; font-family:inherit; white-space:nowrap; pointer-events:none;`;
      halfLbl.textContent = `:30`;
      labelsEl.appendChild(halfLbl);
    }
  }

  // Grid (fills remaining width, position:relative for absolute blocks)
  const gridEl = document.createElement('div');
  gridEl.style.cssText = `flex:1; position:relative; border-left:1px solid #CBD5E1;
    height:${TOTAL_HOURS * PX_PER_HOUR}px; overflow:visible;`;

  // Slot lines
  const totalSlots = TOTAL_HOURS * 2; // 36 half-hour slots
  for (let i = 0; i < totalSlots; i++) {
    const slot = document.createElement('div');
    const isHalf = i % 2 !== 0;
    slot.style.cssText = `height:${PX_PER_HOUR / 2}px; border-bottom:1px ${isHalf ? 'dashed' : 'solid'} ${isHalf ? '#e2e8f0' : '#CBD5E1'}; box-sizing:border-box;`;
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

  // Helper date function
  function getTomorrowKey(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }

  // ── Now line updater ────────────────────────────────────────────────────────
  function updateNowLine() {
    const now   = new Date();
    const h     = now.getHours() + now.getMinutes() / 60;
    const today = todayKey();
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

    const infraBlocks = [];
    const normalBlocks = [];
    for (const b of blocks) {
      if (b.isInfrastructure) infraBlocks.push(b);
      else normalBlocks.push(b);
    }

    // Detect missed tasks for Rolling Queue Banner
    const now = new Date();
    const currentDec = now.getHours() + now.getMinutes() / 60;
    const isToday = date === todayKey();
    const isPastDate = date < todayKey();

    const missedBlocks = normalBlocks.filter(b => {
      if (b.completed) return false;
      return (isToday && b.end <= currentDec) || isPastDate;
    });

    if (missedBlocks.length > 0 && !bannerDismissed) {
      bannerWrapper.style.display = 'block';
      bannerEl.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:16px;">⚡</span>
          <div>
            <div style="font-size:13px; font-weight:700; color:#991B1B;">
              ${missedBlocks.length} Missed Task${missedBlocks.length > 1 ? 's' : ''} Past Scheduled Time
            </div>
            <div style="font-size:11px; color:#7F1D1D; opacity:0.85;">
              ${missedBlocks.map(b => esc(b.title || 'Untitled')).slice(0, 3).join(', ')}${missedBlocks.length > 3 ? ` +${missedBlocks.length - 3} more` : ''}
            </div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button data-auto-reschedule-all style="background:#E11D48; color:#FFF; border:none; border-radius:6px; padding:6px 12px; font-size:12px; font-weight:600; cursor:pointer; box-shadow:0 1px 3px rgba(225,29,72,0.3);">
            ⚡ Auto-Reschedule All
          </button>
          <button data-defer-all style="background:#FFF; color:#475569; border:1px solid #CBD5E1; border-radius:6px; padding:6px 10px; font-size:12px; font-weight:500; cursor:pointer;">
            🌅 Defer to Tomorrow
          </button>
          <button data-dismiss-banner style="background:transparent; color:#94A3B8; border:none; font-size:14px; cursor:pointer; padding:4px;" title="Dismiss notification">
            ✕
          </button>
        </div>
      `;

      bannerEl.querySelector('[data-auto-reschedule-all]')?.addEventListener('click', async () => {
        const startFrom = isToday ? Math.max(BOARD_START, currentDec) : BOARD_START;
        await autoRescheduleBlocks(date, missedBlocks.map(b => b.id), startFrom);
        await loadBlocks();
      });

      bannerEl.querySelector('[data-defer-all]')?.addEventListener('click', async () => {
        const tomorrow = getTomorrowKey(date);
        await deferBlocksToDate(date, tomorrow, missedBlocks.map(b => b.id));
        await loadBlocks();
      });

      bannerEl.querySelector('[data-dismiss-banner]')?.addEventListener('click', () => {
        bannerDismissed = true;
        bannerWrapper.style.display = 'none';
      });
    } else {
      bannerWrapper.style.display = 'none';
    }

    // Sort normal blocks by start time, then duration
    normalBlocks.sort((a, b) => {
      if (a.start === b.start) return (b.end - b.start) - (a.end - a.start);
      return a.start - b.start;
    });

    const clusters = [];
    let currentCluster = [];
    let clusterEnd = 0;

    for (const b of normalBlocks) {
      if (currentCluster.length === 0) {
        currentCluster.push(b);
        clusterEnd = b.end;
      } else {
        if (b.start < clusterEnd) { // overlap
          currentCluster.push(b);
          if (b.end > clusterEnd) clusterEnd = b.end;
        } else {
          clusters.push(currentCluster);
          currentCluster = [b];
          clusterEnd = b.end;
        }
      }
    }
    if (currentCluster.length > 0) clusters.push(currentCluster);

    for (const cluster of clusters) {
      const columns = [];
      for (const b of cluster) {
        let placed = false;
        for (const col of columns) {
          const lastInCol = col[col.length - 1];
          if (b.start >= lastInCol.end) {
            col.push(b);
            b._col = columns.indexOf(col);
            placed = true;
            break;
          }
        }
        if (!placed) {
          b._col = columns.length;
          columns.push([b]);
        }
      }
      const numCols = columns.length;
      for (const b of cluster) {
        b._widthPct = 100 / numCols;
        b._leftPct = b._col * (100 / numCols);
      }
    }

    for (const b of infraBlocks) gridEl.appendChild(makeBlockEl(b));
    for (const b of normalBlocks) gridEl.appendChild(makeBlockEl(b));

    gridEl.appendChild(nowLineEl); // keep now line on top
  }

  function makeBlockEl(b) {
    const top    = hourToPx(b.start);
    const height = Math.max(PX_PER_HOUR / 2, hourToPx(b.end) - hourToPx(b.start));
    const s      = getCategoryColor(b.cat);

    const isInfra = b.isInfrastructure;
    const isRecur = b.isRecurring;
    const isDone  = !!b.completed;
    const icon = isRecur ? '<span style="font-size:10px; margin-right:4px;" title="Recurring">🔄</span>' : '';

    const now = new Date();
    const currentDec = now.getHours() + now.getMinutes() / 60;
    const isToday = date === todayKey();
    const isPastDate = date < todayKey();
    const isMissed = !isDone && !isInfra && ((isToday && b.end <= currentDec) || isPastDate);

    const missedBadge = isMissed ? '<span style="font-size:9px;font-weight:700;color:#E11D48;background:#FFE4E6;padding:1px 4px;border-radius:3px;margin-left:4px;border:1px solid #FDA4AF;">Missed</span>' : '';
    const bumpBtnHtml = isMissed ? `<button data-bump-btn style="background:#EEF2FF; color:#4F46E5; border:1px solid #C7D2FE; border-radius:4px; font-size:10px; font-weight:600; padding:1px 6px; cursor:pointer; margin-left:6px;" title="Push to next free slot today">⏩ Bump</button>` : '';

    const el = document.createElement('div');
    el.dataset.block = b.id;
    
    const leftCss = b._leftPct !== undefined ? `calc(${b._leftPct}% + 2px)` : '2px';
    const widthCss = b._widthPct !== undefined ? `calc(${b._widthPct}% - 4px)` : 'auto';
    const rightCss = b._widthPct === undefined ? 'right: 2px;' : '';
    const zIndex = isInfra ? 1 : 2;

    el.style.cssText = `
      position: absolute;
      top: ${top}px;
      height: ${height}px;
      left: ${leftCss}; ${rightCss} width: ${widthCss};
      background: ${isDone ? '#f8fafc' : (isMissed ? '#FEF2F2' : s.bg)};
      border-left: 4px solid ${isDone ? '#16A34A' : (isMissed ? '#E11D48' : s.acc)};
      color: ${isDone ? '#64748B' : s.txt};
      border-radius: 6px;
      overflow: hidden;
      cursor: default;
      padding: 3px 7px 3px 18px;
      user-select: none;
      z-index: ${zIndex};
      box-sizing: border-box;
      transition: opacity 150ms, background 150ms;
      ${isInfra ? 'opacity: 0.75; filter: grayscale(0.2);' : ''}
      ${isDone ? 'opacity: 0.85;' : ''}
      ${isMissed ? 'outline: 1px dashed #FCA5A5;' : ''}
    `;
    const isSmall = height < 35;
    const dragHandle = isInfra ? '' : `<div data-drag-handle style="position:absolute; left:2px; top:0; bottom:0; width:12px; display:flex; align-items:center; justify-content:center; cursor:grab; opacity:0.4; font-size:12px; font-weight:bold; color:${s.txt};" title="Drag to move slot">⋮</div>`;
    const resizeHandle = isInfra ? '' : `<div data-resize-handle style="position:absolute;bottom:0;left:0;right:0;height:7px;cursor:s-resize;"></div>`;
    
    const checkToggle = `<input type="checkbox" data-complete-toggle ${isDone ? 'checked' : ''} style="margin:0 5px 0 0; cursor:pointer; width:14px; height:14px; accent-color:#16A34A; flex-shrink:0; vertical-align:middle;" title="${isDone ? 'Mark as incomplete' : 'Mark as completed'}" />`;
    const textStyle = isDone ? 'text-decoration:line-through; opacity:0.75;' : '';

    el.innerHTML = isSmall ? `
      ${dragHandle}
      <div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:18px;cursor:pointer;padding-right:8px;${isInfra ? 'margin-left:-12px;' : ''};${textStyle}">
        ${checkToggle}${icon}${esc(b.title || 'Untitled')}${missedBadge}${bumpBtnHtml}
        <span data-time-label style="font-size:9px;font-weight:normal;opacity:0.8;margin-left:4px;">(${formatHour(b.start)} – ${formatHour(b.end)})</span>
      </div>
      ${resizeHandle}
    ` : `
      ${dragHandle}
      <div style="display:flex; align-items:center; gap:2px; ${isInfra ? 'margin-left:-12px;' : ''}">
        ${checkToggle}
        <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3;cursor:pointer;${textStyle}">${icon}${esc(b.title || 'Untitled')} ${missedBadge}${bumpBtnHtml}</div>
      </div>
      <div data-time-label style="font-size:10px;opacity:0.75;margin-top:1px;cursor:pointer;${isInfra ? 'margin-left:-12px;' : ''}">${formatHour(b.start)} – ${formatHour(b.end)}</div>
      ${resizeHandle}
    `;

    const bumpEl = el.querySelector('[data-bump-btn]');
    if (bumpEl) {
      bumpEl.addEventListener('click', async (e) => {
        e.stopPropagation();
        const duration = Math.max(0.25, b.end - b.start);
        const startFrom = isToday ? Math.max(BOARD_START, currentDec) : BOARD_START;
        const freeSlot = await findNextFreeSlot(date, duration, startFrom, [b.id]);
        if (freeSlot) {
          b.start = freeSlot.start;
          b.end = freeSlot.end;
          b.rescheduled = true;
          await updateBlock(date, b.id, { start: freeSlot.start, end: freeSlot.end, rescheduled: true });
          await loadBlocks();
        } else {
          alert('No open slot remaining today. Try deferring to tomorrow!');
        }
      });
    }

    const chk = el.querySelector('[data-complete-toggle]');
    if (chk) {
      chk.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newStatus = chk.checked;
        b.completed = newStatus;
        await updateBlock(date, b.id, { completed: newStatus });
        await loadBlocks();
      });
    }

    el.addEventListener('mouseenter', () => { el.style.opacity = '0.88'; });
    el.addEventListener('mouseleave', () => { el.style.opacity = isDone ? '0.85' : '1'; });
 
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
    const dragHandleEl = el.querySelector('[data-drag-handle]');
    if (dragHandleEl) {
      dragHandleEl.addEventListener('mousedown', (e) => {
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
      });
    }
 
    // Resize handle mousedown
    const resizeHandleEl = el.querySelector('[data-resize-handle]');
    if (resizeHandleEl) {
      resizeHandleEl.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        document.body.style.userSelect = 'none';
        dragResize = { block: b, el, currentEnd: b.end };
      });
    }
 
    return el;
  }

  // ── Drag to create ──────────────────────────────────────────────────────────
  function getGridY(e) {
    const rect = gridEl.getBoundingClientRect();
    return e.clientY - rect.top;
  }

  function getSlotStartHour(e) {
    const rawH = clampH(pxToHour(getGridY(e)));
    // Floor to nearest half-hour slot so clicking anywhere in the 6:30 slot gets 6:30 (18.5)
    return Math.min(BOARD_END - 0.5, Math.floor(rawH * 2) / 2);
  }

  gridEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('[data-block]')) return;
    e.preventDefault();
    const startHour = getSlotStartHour(e);
    dragCreate = { startHour, endHour: startHour + 0.5, ghost: null, hasDragged: false };
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

      const startHour = getSlotStartHour(e);
      
      // Snapping to estimate or defaulting to 1 hour
      const duration = taskData.timeEstimate ? Math.max(0.5, snapHour(taskData.timeEstimate / 60)) : 1.0;
      const endHour = Math.min(BOARD_END, startHour + duration);

      // Map task category to timeboard categories
      let blockCat = getSelectedCat();
      // If task has a category, match or map it
      if (taskData.category) {
        const categories = await getCustomCategories();
        const matched = categories.find(c => c.toLowerCase() === taskData.category.toLowerCase());
        if (matched) {
          blockCat = matched;
        } else {
          blockCat = taskData.category;
        }
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
      const targetEnd = Math.max(dragCreate.startHour + 0.5, rawEnd);
      
      if (targetEnd !== dragCreate.endHour) {
        dragCreate.endHour = targetEnd;
        dragCreate.hasDragged = true;
      }

      if (dragCreate.hasDragged) {
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
      onSave: async (updated, editMode) => {
        if (isNew) {
          if (updated.isRecurring) {
            updated.recurrenceId = generateId();
            const template = {
              id: generateId(),
              recurrenceId: updated.recurrenceId,
              itemType: 'block',
              startDate: date,
              title: updated.title,
              cat: updated.cat,
              start: updated.start,
              end: updated.end,
              recurrencePattern: updated.recurrencePattern,
              isInfrastructure: updated.isInfrastructure
            };
            await addRecurringTemplate(template);
            
            const endObj = new Date(date);
            endObj.setDate(endObj.getDate() + 60);
            const y = endObj.getFullYear();
            const m = String(endObj.getMonth() + 1).padStart(2, '0');
            const d = String(endObj.getDate()).padStart(2, '0');
            await syncRecurringTemplateForRange(template, date, `${y}-${m}-${d}`);
          } else {
            await addBlock(date, updated);
          }
          registerAlarm(updated, date);
        } else {
          if (editMode === 'following') {
            await updateFutureRecurringInstances(updated.recurrenceId, date, 'block', updated);
            const templates = await getRecurringTemplates();
            const t = templates.find(x => x.recurrenceId === updated.recurrenceId);
            if (t) {
              Object.assign(t, {
                title: updated.title, cat: updated.cat, start: updated.start, end: updated.end,
                recurrencePattern: updated.recurrencePattern, isInfrastructure: updated.isInfrastructure
              });
              await updateRecurringTemplate(t.id, t);
            }
          } else {
            await updateBlock(date, updated.id, updated);
          }
          cancelAlarm(updated.id);
          registerAlarm(updated, date);
        }
        modal.hide();
        await loadBlocks();
      },
      onDelete: async (editMode) => {
        if (editMode === 'following') {
          await removeFutureRecurringInstances(block.recurrenceId, date, 'block');
          const templates = await getRecurringTemplates();
          const t = templates.find(x => x.recurrenceId === block.recurrenceId);
          if (t) await deleteRecurringTemplate(t.id);
        } else {
          await deleteBlock(date, block.id);
          if (block.isRecurring && block.recurrenceId) {
            const templates = await getRecurringTemplates();
            const t = templates.find(x => x.recurrenceId === block.recurrenceId);
            if (t) {
              if (!t.exceptions) t.exceptions = [];
              if (!t.exceptions.includes(date)) t.exceptions.push(date);
              await updateRecurringTemplate(t.id, { exceptions: t.exceptions });
            }
          }
        }
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
        <!-- Repeat Options -->
        <div style="margin-top:4px; padding-top:12px; border-top:1px solid #E2E8F0;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:600; color:#1E293B;">
            <input type="checkbox" data-repeat-toggle style="accent-color:#4F46E5; width:15px; height:15px; cursor:pointer;" />
            Repeat this block
          </label>
          <div data-repeat-settings style="display:none; margin-top:10px; flex-direction:column; gap:10px;">
            <select data-repeat-pattern style="width:100%; padding:8px 12px; border:1px solid #E2E8F0; border-radius:6px; font-size:13px; font-family:inherit; color:#1E293B; outline:none; background:#fff;">
              <option value="daily">Daily</option>
              <option value="weekdays">Weekdays (Mon-Fri)</option>
              <option value="weekends">Weekends (Sat-Sun)</option>
              <option value="custom">Custom days...</option>
            </select>
            <div data-repeat-custom style="display:none; gap:6px; flex-wrap:wrap;">
              <button data-day="1" class="day-pill" style="padding:4px 8px; border-radius:6px; border:1px solid #E2E8F0; background:#fff; font-size:11px; cursor:pointer; font-weight:600;">Mon</button>
              <button data-day="2" class="day-pill" style="padding:4px 8px; border-radius:6px; border:1px solid #E2E8F0; background:#fff; font-size:11px; cursor:pointer; font-weight:600;">Tue</button>
              <button data-day="3" class="day-pill" style="padding:4px 8px; border-radius:6px; border:1px solid #E2E8F0; background:#fff; font-size:11px; cursor:pointer; font-weight:600;">Wed</button>
              <button data-day="4" class="day-pill" style="padding:4px 8px; border-radius:6px; border:1px solid #E2E8F0; background:#fff; font-size:11px; cursor:pointer; font-weight:600;">Thu</button>
              <button data-day="5" class="day-pill" style="padding:4px 8px; border-radius:6px; border:1px solid #E2E8F0; background:#fff; font-size:11px; cursor:pointer; font-weight:600;">Fri</button>
              <button data-day="6" class="day-pill" style="padding:4px 8px; border-radius:6px; border:1px solid #E2E8F0; background:#fff; font-size:11px; cursor:pointer; font-weight:600;">Sat</button>
              <button data-day="0" class="day-pill" style="padding:4px 8px; border-radius:6px; border:1px solid #E2E8F0; background:#fff; font-size:11px; cursor:pointer; font-weight:600;">Sun</button>
            </div>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:12px; color:#64748B; margin-top:4px;">
              <input type="checkbox" data-is-routine style="accent-color:#4F46E5; width:14px; height:14px; cursor:pointer;" />
              This is a routine (no completion tracking)
            </label>
          </div>
        </div>
        <!-- Completion Option -->
        <div style="margin-top:4px; padding-top:10px; border-top:1px solid #E2E8F0;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:600; color:#1E293B;">
            <input type="checkbox" data-completed-toggle style="accent-color:#16A34A; width:15px; height:15px; cursor:pointer;" />
            Mark as completed ✓
          </label>
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

  let selCat = 'Personal';
  let catBtns = {};
  let categories = [];

  function selectCat(cat) {
    selCat = cat;
    categories.forEach((c) => {
      if (catBtns[c]) {
        const s = getCategoryColor(c);
        catBtns[c].style.borderColor = c === cat ? s.acc : 'transparent';
      }
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
  
  const repeatToggle = q('[data-repeat-toggle]');
  const repeatSettings = q('[data-repeat-settings]');
  const repeatPattern = q('[data-repeat-pattern]');
  const repeatCustom = q('[data-repeat-custom]');
  const isRoutine = q('[data-is-routine]');
  let customDays = new Set();
  
  repeatToggle.addEventListener('change', () => {
    repeatSettings.style.display = repeatToggle.checked ? 'flex' : 'none';
  });
  
  repeatPattern.addEventListener('change', () => {
    repeatCustom.style.display = repeatPattern.value === 'custom' ? 'flex' : 'none';
  });
  
  overlay.querySelectorAll('.day-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const day = parseInt(btn.dataset.day);
      if (customDays.has(day)) {
        customDays.delete(day);
        btn.style.background = '#fff';
        btn.style.borderColor = '#E2E8F0';
        btn.style.color = 'inherit';
      } else {
        customDays.add(day);
        btn.style.background = '#4F46E5';
        btn.style.borderColor = '#4F46E5';
        btn.style.color = '#fff';
      }
    });
  });

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
    
    const isRecurring = repeatToggle.checked;
    const recurrencePattern = isRecurring ? {
      type: repeatPattern.value,
      customDays: repeatPattern.value === 'custom' ? Array.from(customDays) : []
    } : null;
    const isInfrastructure = isRoutine.checked;
    const completed = q('[data-completed-toggle]').checked;
    
    const updated = { ...curBlock, title, cat: selCat, start, end, isRecurring, recurrencePattern, isInfrastructure, completed };
    
    if (curBlock.isRecurring && curBlock.id && window.confirm("This is a recurring block.\n\nPress OK to apply changes to ALL FUTURE blocks in this series.\nPress Cancel to apply changes ONLY to this block.")) {
      onSaveCb?.(updated, 'following');
    } else if (curBlock.isRecurring && curBlock.id) {
      onSaveCb?.(updated, 'only-this');
    } else {
      onSaveCb?.(updated, 'only-this');
    }
  });

  q('[data-btn-delete]').addEventListener('click', () => { 
    if (curBlock.isRecurring) {
      if (window.confirm("Delete ALL FUTURE blocks in this series? (Cancel will delete only this one)")) {
        onDeleteCb?.('following');
      } else {
        onDeleteCb?.('only-this');
      }
    } else {
      onDeleteCb?.('only-this'); 
    }
  });

  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); q('[data-btn-save]').click(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) hide();
  });

  async function show(block, isNew, cbs) {
    curBlock   = block;
    onSaveCb   = cbs.onSave;
    onDeleteCb = cbs.onDelete;

    q('[data-modal-title]').textContent = isNew ? 'New Block' : 'Edit Block';
    titleInput.value            = block.title ?? '';
    q('[data-start]').value     = decimalToTime(block.start);
    q('[data-end]').value       = decimalToTime(block.end);
    q('[data-btn-delete]').style.display = isNew ? 'none' : '';
    
    repeatToggle.checked = !!block.isRecurring;
    repeatSettings.style.display = block.isRecurring ? 'flex' : 'none';
    repeatPattern.value = block.recurrencePattern?.type || 'daily';
    repeatCustom.style.display = repeatPattern.value === 'custom' ? 'flex' : 'none';
    isRoutine.checked = !!block.isInfrastructure;
    q('[data-completed-toggle]').checked = !!block.completed;
    
    customDays.clear();
    overlay.querySelectorAll('.day-pill').forEach(btn => {
      btn.style.background = '#fff';
      btn.style.borderColor = '#E2E8F0';
      btn.style.color = 'inherit';
    });
    
    if (block.recurrencePattern?.customDays) {
      block.recurrencePattern.customDays.forEach(d => {
        customDays.add(d);
        const btn = overlay.querySelector(`.day-pill[data-day="${d}"]`);
        if (btn) {
          btn.style.background = '#4F46E5';
          btn.style.borderColor = '#4F46E5';
          btn.style.color = '#fff';
        }
      });
    }

    // Populate category buttons dynamically
    categories = await getCustomCategories();
    picker.innerHTML = '';
    catBtns = {};

    const initialCat = block.cat || categories[0] || 'Personal';

    categories.forEach((cat) => {
      const s = getCategoryColor(cat);
      const btn = document.createElement('button');
      btn.textContent = cat;
      btn.style.cssText = `padding:4px 10px; border-radius:20px; font-size:11px; font-weight:600;
        cursor:pointer; background:${s.bg}; color:${s.txt}; border:2px solid transparent;
        font-family:inherit; transition:border-color 150ms;`;
      btn.addEventListener('click', () => selectCat(cat));
      picker.appendChild(btn);
      catBtns[cat] = btn;
    });

    selectCat(initialCat);
    overlay.classList.remove('hidden');
    setTimeout(() => titleInput.focus(), 50);
  }

  return { el: overlay, show, hide };
}
