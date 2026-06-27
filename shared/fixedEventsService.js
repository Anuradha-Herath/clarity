/**
 * Clarity — shared/fixedEventsService.js
 * Firestore and local storage integration for the Fixed Events feature.
 * ES Module.
 */

import { get, set, getAuth, jsToFirestore } from './storage.js';

const FIRESTORE_REST_BASE = 'https://firestore.googleapis.com/v1/projects/clarity-app-b599e/databases/(default)/documents';

/**
 * Add a new fixed event.
 * @param {string} userId
 * @param {object} data
 * @returns {Promise<object>} The added event object
 */
export async function addFixedEvent(userId, data) {
  const newEvent = {
    id: data.id || crypto.randomUUID(),
    userId: userId || '',
    title: data.title || '',
    type: data.type || 'reminder',
    date: data.date || '',
    endDate: data.endDate || data.date || '',
    time: data.time || null,
    endTime: data.endTime || null,
    category: data.category || 'Other',
    note: data.note || '',
    createdAt: data.createdAt || new Date().toISOString()
  };

  // 1. Update local storage
  const localEvents = (await get('fixed_events')) || [];
  localEvents.push(newEvent);
  await set('fixed_events', localEvents);

  // 2. Write to Firestore if authenticated
  if (userId) {
    const auth = await getAuth();
    if (auth) {
      try {
        const url = `${FIRESTORE_REST_BASE}/users/${userId}/fixed_events?documentId=${newEvent.id}`;
        const fields = jsToFirestore(newEvent);
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${auth.idToken}`
          },
          body: JSON.stringify(fields)
        });
        if (!res.ok) {
          console.warn('[fixedEventsService] Firestore add failed:', await res.text());
        }
      } catch (err) {
        console.error('[fixedEventsService] Firestore add error:', err);
      }
    }
  }
  return newEvent;
}

/**
 * Update an existing fixed event.
 * @param {string} userId
 * @param {string} eventId
 * @param {object} data
 * @returns {Promise<void>}
 */
export async function updateFixedEvent(userId, eventId, data) {
  // 1. Update local storage
  const localEvents = (await get('fixed_events')) || [];
  const idx = localEvents.findIndex(e => e.id === eventId);
  if (idx !== -1) {
    const updatedData = { ...data };
    if (!updatedData.endDate) {
      updatedData.endDate = updatedData.date || localEvents[idx].date;
    }
    localEvents[idx] = { ...localEvents[idx], ...updatedData };
    await set('fixed_events', localEvents);
  }

  // 2. Write to Firestore if authenticated
  if (userId) {
    const auth = await getAuth();
    if (auth) {
      try {
        const url = `${FIRESTORE_REST_BASE}/users/${userId}/fixed_events/${eventId}`;
        const updatedEvent = localEvents.find(e => e.id === eventId);
        if (updatedEvent) {
          const fields = jsToFirestore(updatedEvent);
          const res = await fetch(url, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${auth.idToken}`
            },
            body: JSON.stringify(fields)
          });
          if (!res.ok) {
            console.warn('[fixedEventsService] Firestore update failed:', await res.text());
          }
        }
      } catch (err) {
        console.error('[fixedEventsService] Firestore update error:', err);
      }
    }
  }
}

/**
 * Delete a fixed event by ID.
 * @param {string} userId
 * @param {string} eventId
 * @returns {Promise<void>}
 */
export async function deleteFixedEvent(userId, eventId) {
  // 1. Update local storage
  const localEvents = (await get('fixed_events')) || [];
  const filtered = localEvents.filter(e => e.id !== eventId);
  await set('fixed_events', filtered);

  // 2. Delete from Firestore if authenticated
  if (userId) {
    const auth = await getAuth();
    if (auth) {
      try {
        const url = `${FIRESTORE_REST_BASE}/users/${userId}/fixed_events/${eventId}`;
        const res = await fetch(url, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${auth.idToken}`
          }
        });
        if (!res.ok) {
          console.warn('[fixedEventsService] Firestore delete failed:', await res.text());
        }
      } catch (err) {
        console.error('[fixedEventsService] Firestore delete error:', err);
      }
    }
  }
}

/**
 * Get fixed events for a specific month.
 * @param {string} userId
 * @param {number} year
 * @param {number} month  0-indexed (0=January)
 * @returns {Promise<Array>}
 */
export async function getFixedEventsForMonth(userId, year, month) {
  const localEvents = (await get('fixed_events')) || [];
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  return localEvents.filter(e => {
    const start = e.date;
    const end = e.endDate || e.date;
    return start <= monthEnd && end >= monthStart;
  });
}

/**
 * Get fixed events for a specific date.
 * @param {string} userId
 * @param {string} dateStr  "YYYY-MM-DD"
 * @returns {Promise<Array>}
 */
export async function getFixedEventsForDate(userId, dateStr) {
  const localEvents = (await get('fixed_events')) || [];
  return localEvents.filter(e => {
    const start = e.date;
    const end = e.endDate || e.date;
    return dateStr >= start && dateStr <= end;
  });
}

/**
 * Get upcoming fixed events within the next N days.
 * @param {string} userId
 * @param {string} fromDate  "YYYY-MM-DD"
 * @param {number} days
 * @returns {Promise<Array>} Sorted by date then time ascending
 */
export async function getUpcomingFixedEvents(userId, fromDate, days) {
  const localEvents = (await get('fixed_events')) || [];
  
  const startRange = fromDate;
  const end = new Date(fromDate + 'T00:00:00');
  end.setDate(end.getDate() + days - 1);
  const endRange = end.toISOString().slice(0, 10);

  return localEvents
    .filter(e => {
      if (!e.date) return false;
      const start = e.date;
      const endEvent = e.endDate || e.date;
      return start <= endRange && endEvent >= startRange;
    })
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (!a.time) return -1;
      if (!b.time) return 1;
      return a.time.localeCompare(b.time);
    });
}
