/**
 * Clarity — shared/FixedEventModal.js
 * Dynamic edit/create modal for Fixed Events with Multi-Day support.
 * ES Module.
 */

import { getCustomCategories, getAuth, todayKey } from './storage.js';
import { addFixedEvent, updateFixedEvent, deleteFixedEvent, toggleFixedEventComplete } from './fixedEventsService.js';
import { showConfirm, showAlert } from './dialog.js';
import { attachClockPicker } from './clockPicker.js';

let modalOverlay = null;
let currentEvent = null;
let currentOnSave = null;
let currentOnDelete = null;
let selectedType = 'reminder'; // Default type

// Type to color mapping (filled background for active, outline for inactive)
const TYPE_COLORS = {
  deadline: { color: '#ef4444', label: 'Deadline' },
  appointment: { color: '#3b82f6', label: 'Appointment' },
  reminder: { color: '#f59e0b', label: 'Reminder' }
};

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Build the modal markup and inject it into document.body if it doesn't exist.
 */
function ensureModalHtml() {
  if (modalOverlay) return;

  modalOverlay = document.createElement('div');
  modalOverlay.id = 'fixed-event-modal-overlay';
  modalOverlay.className = 'modal-overlay hidden';
  modalOverlay.style.zIndex = '9500';

  modalOverlay.innerHTML = `
    <div class="modal" style="max-width: 400px;">
      <!-- Header -->
      <div class="modal-header">
        <div class="modal-title" id="fe-modal-title">New Fixed Event</div>
        <button class="btn btn-ghost btn-icon" id="fe-btn-close" title="Close">✕</button>
      </div>
      
      <!-- Body -->
      <div class="modal-body" style="display: flex; flex-direction: column; gap: 14px; padding: 18px;">
        <!-- Title -->
        <div class="form-group">
          <label class="label" for="fe-title" style="display:block; font-size:11px; font-weight:600; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px;">Title</label>
          <input type="text" id="fe-title" class="input" placeholder="e.g. Submit assignment, Team meeting..." maxlength="120" style="width: 100%; box-sizing: border-box;" />
        </div>

        <!-- Completion Checkbox (Conditional) -->
        <div class="form-group" id="fe-completion-group" style="display: none; align-items: center; gap: 8px; margin-top: -4px;">
          <input type="checkbox" id="fe-completed" style="width: auto; height: auto; margin: 0; cursor: pointer; accent-color: var(--color-accent);" />
          <label for="fe-completed" style="font-size: 13px; font-weight: 500; color: var(--color-text); cursor: pointer; user-select: none; margin: 0; display: flex; align-items: center; gap: 6px;">
            <span>Mark as completed</span>
            <span id="fe-completed-at" style="font-size: 11px; color: var(--color-text-muted); font-weight: normal; margin-left: 4px;"></span>
          </label>
        </div>
        
        <!-- Type Pill Selector -->
        <div class="form-group">
          <label class="label" style="display:block; font-size:11px; font-weight:600; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px;">Type</label>
          <div class="flex gap-2" id="fe-type-pills" style="display: flex; gap: 8px;">
            <button type="button" class="btn btn-sm flex-1" data-type="deadline" style="flex: 1; padding: 6px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1.5px solid #ef4444; border-radius: 6px; transition: all 150ms; font-family: inherit;">Deadline</button>
            <button type="button" class="btn btn-sm flex-1" data-type="appointment" style="flex: 1; padding: 6px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1.5px solid #3b82f6; border-radius: 6px; transition: all 150ms; font-family: inherit;">Appointment</button>
            <button type="button" class="btn btn-sm flex-1" data-type="reminder" style="flex: 1; padding: 6px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1.5px solid #f59e0b; border-radius: 6px; transition: all 150ms; font-family: inherit;">Reminder</button>
          </div>
        </div>
        
        <!-- Date -->
        <div class="form-group">
          <label class="label" for="fe-date" style="display:block; font-size:11px; font-weight:600; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px;">Date</label>
          <input type="date" id="fe-date" class="input" style="width: 100%; box-sizing: border-box;" />
        </div>

        <!-- Ends on a different day Toggle -->
        <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
          <input type="checkbox" id="fe-multiday" style="width: auto; height: auto; margin: 0; cursor: pointer; accent-color: var(--color-accent);" />
          <label for="fe-multiday" style="font-size: 13px; font-weight: 500; color: var(--color-text); cursor: pointer; user-select: none; margin: 0;">Ends on a different day</label>
        </div>

        <!-- End Date (hidden when not checked) -->
        <div class="form-group" id="fe-enddate-group" style="display: none;">
          <label class="label" for="fe-enddate" style="display:block; font-size:11px; font-weight:600; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px;">End Date</label>
          <input type="date" id="fe-enddate" class="input" style="width: 100%; box-sizing: border-box;" />
          <div id="fe-enddate-error" style="color: #ef4444; font-size: 11px; margin-top: 4px; display: none;"></div>
        </div>
        
        <!-- All Day Toggle -->
        <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
          <input type="checkbox" id="fe-allday" style="width: auto; height: auto; margin: 0; cursor: pointer; accent-color: var(--color-accent);" />
          <label for="fe-allday" style="font-size: 13px; font-weight: 500; color: var(--color-text); cursor: pointer; user-select: none; margin: 0;">All Day Event</label>
        </div>
        
        <!-- Time Fields (shown only when All Day is off) -->
        <div class="form-row" id="fe-time-fields" style="display: flex; gap: 12px;">
          <div class="form-group" style="flex: 1;">
            <label class="label" for="fe-time" style="display:block; font-size:11px; font-weight:600; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px;">Time</label>
            <input type="time" id="fe-time" class="input" style="width: 100%; box-sizing: border-box;" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label class="label" for="fe-endtime" style="display:block; font-size:11px; font-weight:600; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px;">End Time</label>
            <input type="time" id="fe-endtime" class="input" style="width: 100%; box-sizing: border-box;" />
          </div>
        </div>
        
        <!-- Category -->
        <div class="form-group">
          <label class="label" for="fe-category" style="display:block; font-size:11px; font-weight:600; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px;">Category</label>
          <select id="fe-category" class="select" style="width: 100%; box-sizing: border-box;"></select>
        </div>
        
        <!-- Note -->
        <div class="form-group">
          <label class="label" for="fe-note" style="display:block; font-size:11px; font-weight:600; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px;">Note (max 120 chars)</label>
          <textarea id="fe-note" class="textarea" placeholder="Add a short note..." maxlength="120" rows="3" style="width: 100%; box-sizing: border-box; font-family: inherit; font-size: 13px;"></textarea>
        </div>
      </div>
      
      <!-- Footer -->
      <div class="modal-footer modal-footer-split" style="padding: 12px 18px;">
        <button class="btn btn-danger" id="fe-btn-delete" title="Delete event" style="display: none; padding: 8px 12px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; background: var(--color-danger-soft); color: var(--color-danger); border: none; display: flex; align-items: center; justify-content: center;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
        <div class="flex gap-2" style="display: flex; gap: 8px; margin-left: auto;">
          <button class="btn btn-secondary" id="fe-btn-cancel" style="padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; background: #fff; color: var(--color-text); border: 1px solid var(--color-border); font-family: inherit;">Cancel</button>
          <button class="btn btn-primary" id="fe-btn-save" style="padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; background: var(--color-accent); color: #fff; border: none; font-family: inherit;">Save Event</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);

  // Set up event listeners
  const closeBtn = modalOverlay.querySelector('#fe-btn-close');
  const cancelBtn = modalOverlay.querySelector('#fe-btn-cancel');
  const saveBtn = modalOverlay.querySelector('#fe-btn-save');
  const deleteBtn = modalOverlay.querySelector('#fe-btn-delete');
  const allDayCheckbox = modalOverlay.querySelector('#fe-allday');
  const multidayCheckbox = modalOverlay.querySelector('#fe-multiday');
  const titleInput = modalOverlay.querySelector('#fe-title');

  closeBtn.addEventListener('click', hide);
  cancelBtn.addEventListener('click', hide);
  
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) hide();
  });

  allDayCheckbox.addEventListener('change', () => {
    updateTimeFieldsVisibility();
  });

  const completedCheckbox = modalOverlay.querySelector('#fe-completed');
  const completedAtSpan = modalOverlay.querySelector('#fe-completed-at');
  const dateInput = modalOverlay.querySelector('#fe-date');
  const endDateInput = modalOverlay.querySelector('#fe-enddate');
  const enddateError = modalOverlay.querySelector('#fe-enddate-error');

  function validateDatesInline() {
    if (multidayCheckbox.checked && dateInput.value && endDateInput.value) {
      if (endDateInput.value < dateInput.value) {
        enddateError.textContent = 'End Date cannot be before the Start Date.';
        enddateError.style.display = 'block';
        endDateInput.style.borderColor = '#ef4444';
        return false;
      }
    }
    enddateError.textContent = '';
    enddateError.style.display = 'none';
    endDateInput.style.borderColor = '';
    return true;
  }

  dateInput.addEventListener('change', validateDatesInline);
  endDateInput.addEventListener('change', validateDatesInline);

  multidayCheckbox.addEventListener('change', () => {
    updateEndDateVisibility();
    validateDatesInline();
  });

  completedCheckbox.addEventListener('change', async () => {
    const isCompleted = completedCheckbox.checked;
    if (isCompleted) {
      const nowStr = new Date().toISOString();
      const dateLabel = new Date(nowStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      completedAtSpan.textContent = `Completed on ${dateLabel}`;
    } else {
      completedAtSpan.textContent = '';
    }

    if (currentEvent && currentEvent.id) {
      const auth = await getAuth();
      const userId = auth?.localId || '';
      await toggleFixedEventComplete(userId, currentEvent.id, isCompleted);
      currentEvent.isCompleted = isCompleted;
      currentEvent.completedAt = isCompleted ? new Date().toISOString() : null;
    }
  });

  // Type pills selection listeners
  const pills = modalOverlay.querySelectorAll('#fe-type-pills button');
  pills.forEach(btn => {
    btn.addEventListener('click', () => {
      selectType(btn.dataset.type);
    });
  });

  attachClockPicker(modalOverlay.querySelector('#fe-time'));
  attachClockPicker(modalOverlay.querySelector('#fe-endtime'));

  saveBtn.addEventListener('click', handleSave);
  deleteBtn.addEventListener('click', handleDelete);

  // Keyboard navigation
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) {
      hide();
    }
  });
}

function updateTimeFieldsVisibility() {
  const allDayCheckbox = modalOverlay.querySelector('#fe-allday');
  const timeFieldsRow = modalOverlay.querySelector('#fe-time-fields');
  
  if (allDayCheckbox.checked) {
    timeFieldsRow.style.display = 'none';
  } else {
    timeFieldsRow.style.display = 'flex';
  }
}

function updateEndDateVisibility() {
  const multidayCheckbox = modalOverlay.querySelector('#fe-multiday');
  const endDateGroup = modalOverlay.querySelector('#fe-enddate-group');
  
  if (multidayCheckbox.checked) {
    endDateGroup.style.display = 'block';
  } else {
    endDateGroup.style.display = 'none';
  }
}

function selectType(type) {
  selectedType = type;
  const pills = modalOverlay.querySelectorAll('#fe-type-pills button');
  
  pills.forEach(btn => {
    const btnType = btn.dataset.type;
    const config = TYPE_COLORS[btnType];
    
    if (btnType === type) {
      btn.style.backgroundColor = config.color;
      btn.style.color = '#fff';
    } else {
      btn.style.backgroundColor = 'transparent';
      btn.style.color = config.color;
    }
  });

  const completionGroup = modalOverlay.querySelector('#fe-completion-group');
  if (completionGroup) {
    if (type === 'deadline' || type === 'reminder') {
      completionGroup.style.display = 'flex';
    } else {
      completionGroup.style.display = 'none';
    }
  }
}

function hide() {
  if (modalOverlay) {
    modalOverlay.classList.add('hidden');
  }
  currentEvent = null;
  currentOnSave = null;
  currentOnDelete = null;
}

async function handleSave() {
  const titleInput = modalOverlay.querySelector('#fe-title');
  const dateInput = modalOverlay.querySelector('#fe-date');
  const multidayCheckbox = modalOverlay.querySelector('#fe-multiday');
  const endDateInput = modalOverlay.querySelector('#fe-enddate');
  const allDayCheckbox = modalOverlay.querySelector('#fe-allday');
  const timeInput = modalOverlay.querySelector('#fe-time');
  const endTimeInput = modalOverlay.querySelector('#fe-endtime');
  const categorySelect = modalOverlay.querySelector('#fe-category');
  const noteTextarea = modalOverlay.querySelector('#fe-note');

  const title = titleInput.value.trim();
  const date = dateInput.value;

  if (!title) {
    titleInput.focus();
    return;
  }
  if (!date) {
    dateInput.focus();
    return;
  }

  let endDate = date;
  if (multidayCheckbox.checked) {
    endDate = endDateInput.value;
    if (!endDate) {
      endDateInput.focus();
      return;
    }
    const errorDiv = modalOverlay.querySelector('#fe-enddate-error');
    if (endDate < date) {
      errorDiv.textContent = 'End Date cannot be before the Start Date.';
      errorDiv.style.display = 'block';
      endDateInput.style.borderColor = '#ef4444';
      endDateInput.focus();
      return;
    }
  }

  const isAllDay = allDayCheckbox.checked;
  const time = isAllDay ? null : (timeInput.value || null);
  const endTime = isAllDay ? null : (endTimeInput.value || null);
  const category = categorySelect.value || 'Other';
  const note = noteTextarea.value.trim();

  const completedCheckbox = modalOverlay.querySelector('#fe-completed');
  const isCompleted = (selectedType === 'appointment') ? false : completedCheckbox.checked;
  const completedAt = isCompleted ? (currentEvent?.completedAt || new Date().toISOString()) : null;

  const auth = await getAuth();
  const userId = auth?.localId || '';

  const eventData = {
    title,
    type: selectedType,
    date,
    endDate: multidayCheckbox.checked ? endDate : null,
    isMultiDay: multidayCheckbox.checked,
    allDay: isAllDay,
    time,
    endTime,
    category,
    note,
    isCompleted,
    completedAt
  };

  try {
    if (currentEvent && currentEvent.id) {
      await updateFixedEvent(userId, currentEvent.id, eventData);
    } else {
      await addFixedEvent(userId, eventData);
    }
    
    hide();
    
    if (currentOnSave) {
      await currentOnSave();
    }
  } catch (err) {
    console.error('[FixedEventModal] Error saving fixed event:', err);
  }
}

async function handleDelete() {
  if (!currentEvent || !currentEvent.id) return;
  
  const yes = await showConfirm('Are you sure you want to delete this event? This action cannot be undone.', 'Delete Event');
  if (!yes) return;

  const auth = await getAuth();
  const userId = auth?.localId || '';

  try {
    await deleteFixedEvent(userId, currentEvent.id);
    hide();
    if (currentOnDelete) {
      await currentOnDelete();
    }
  } catch (err) {
    console.error('[FixedEventModal] Error deleting event:', err);
  }
}

/**
 * Open the fixed event modal.
 * @param {object|null} eventOrPrefill  If editing, pass full event object. If creating, pass `{ date: "YYYY-MM-DD" }` or empty object.
 * @param {function} onSave             Callback on successful save
 * @param {function} onDelete           Callback on successful delete
 */
export async function openFixedEventModal(eventOrPrefill = null, onSave = null, onDelete = null) {
  ensureModalHtml();

  currentEvent = eventOrPrefill;
  currentOnSave = onSave;
  currentOnDelete = onDelete;

  const titleInput = modalOverlay.querySelector('#fe-title');
  const dateInput = modalOverlay.querySelector('#fe-date');
  const multidayCheckbox = modalOverlay.querySelector('#fe-multiday');
  const endDateInput = modalOverlay.querySelector('#fe-enddate');
  const allDayCheckbox = modalOverlay.querySelector('#fe-allday');
  const timeInput = modalOverlay.querySelector('#fe-time');
  const endTimeInput = modalOverlay.querySelector('#fe-endtime');
  const categorySelect = modalOverlay.querySelector('#fe-category');
  const noteTextarea = modalOverlay.querySelector('#fe-note');
  const deleteBtn = modalOverlay.querySelector('#fe-btn-delete');
  const modalTitle = modalOverlay.querySelector('#fe-modal-title');

  const categories = await getCustomCategories();
  categorySelect.innerHTML = categories.map(cat => 
    `<option value="${escHtml(cat)}">${escHtml(cat)}</option>`
  ).join('');

  const completedCheckbox = modalOverlay.querySelector('#fe-completed');
  const completedAtSpan = modalOverlay.querySelector('#fe-completed-at');
  const completionGroup = modalOverlay.querySelector('#fe-completion-group');
  const enddateError = modalOverlay.querySelector('#fe-enddate-error');

  // Clear errors
  enddateError.textContent = '';
  enddateError.style.display = 'none';
  endDateInput.style.borderColor = '';

  if (currentEvent && currentEvent.id) {
    modalTitle.textContent = 'Edit Fixed Event';
    titleInput.value = currentEvent.title || '';
    dateInput.value = currentEvent.date || '';
    
    const hasEndDate = !!currentEvent.isMultiDay || (currentEvent.endDate && currentEvent.endDate !== currentEvent.date);
    multidayCheckbox.checked = hasEndDate;
    endDateInput.value = currentEvent.endDate || currentEvent.date || '';

    const isAllDay = currentEvent.allDay !== undefined ? !!currentEvent.allDay : !currentEvent.time;
    allDayCheckbox.checked = isAllDay;
    timeInput.value = currentEvent.time || '';
    endTimeInput.value = currentEvent.endTime || '';
    categorySelect.value = currentEvent.category || categories[0] || 'Personal';
    noteTextarea.value = currentEvent.note || '';
    
    selectType(currentEvent.type || 'reminder');

    if (currentEvent.type === 'deadline' || currentEvent.type === 'reminder') {
      completionGroup.style.display = 'flex';
      completedCheckbox.checked = !!currentEvent.isCompleted;
      if (currentEvent.isCompleted && currentEvent.completedAt) {
        const completedDate = new Date(currentEvent.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        completedAtSpan.textContent = `Completed on ${completedDate}`;
      } else {
        completedAtSpan.textContent = '';
      }
    } else {
      completionGroup.style.display = 'none';
      completedCheckbox.checked = false;
      completedAtSpan.textContent = '';
    }

    deleteBtn.style.display = 'flex';
  } else {
    modalTitle.textContent = 'New Fixed Event';
    titleInput.value = '';
    
    const prefillDate = eventOrPrefill?.date || todayKey();
    dateInput.value = prefillDate;
    
    multidayCheckbox.checked = false;
    endDateInput.value = prefillDate;

    allDayCheckbox.checked = true;
    timeInput.value = '';
    endTimeInput.value = '';
    categorySelect.value = eventOrPrefill?.category || categories[0] || 'Personal';
    noteTextarea.value = '';
    
    selectType('reminder');

    completionGroup.style.display = 'flex';
    completedCheckbox.checked = false;
    completedAtSpan.textContent = '';

    deleteBtn.style.display = 'none';
  }

  updateTimeFieldsVisibility();
  updateEndDateVisibility();
  
  modalOverlay.classList.remove('hidden');
  titleInput.focus();
}
