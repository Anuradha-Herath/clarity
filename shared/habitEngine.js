/**
 * Clarity — shared/habitEngine.js
 * Pure functions for resolving habit recurrence rules.
 * ES Module.
 */

/**
 * Parses YYYY-MM-DD into a local Date object.
 */
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Formats a Date object as YYYY-MM-DD in local time.
 */
function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Spreads a count of days evenly over a month's days.
 * Returns 1-based day numbers.
 */
function getMonthDates(year, monthIndex, count) {
  // Get number of days in the month
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const selectedDays = [];
  const c = Math.min(count, daysInMonth);
  for (let i = 0; i < daysInMonth; i++) {
    const val1 = Math.floor((i * c) / daysInMonth);
    const val2 = Math.floor(((i - 1) * c) / daysInMonth);
    if (i === 0 || val1 !== val2) {
      selectedDays.push(i + 1);
    }
  }
  return selectedDays;
}

// Map of countPerPeriod -> weekday names for xPerWeek distribution
const WEEK_DISTRIBUTIONS = {
  1: ["Wed"],
  2: ["Tue", "Thu"],
  3: ["Mon", "Wed", "Fri"],
  4: ["Mon", "Wed", "Fri", "Sun"],
  5: ["Mon", "Tue", "Thu", "Fri", "Sun"],
  6: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  7: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
};

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Generate all habit instances within a given date range.
 * @param {object} habit 
 * @param {Array<string>} dateRange Array of "YYYY-MM-DD" date strings
 * @returns {Array<object>} Array of { date, time, title, habitId, slotLabel }
 */
export function generateHabitInstances(habit, dateRange) {
  if (habit.status !== 'active') return [];

  const instances = [];
  const startLocal = parseLocalDate(habit.goal.startDate);
  
  // Calculate goal end date if not ongoing
  let endLocal = null;
  if (habit.goal.type !== 'ongoing' && habit.goal.durationDays) {
    endLocal = new Date(startLocal);
    endLocal.setDate(endLocal.getDate() + habit.goal.durationDays - 1);
  }

  for (const dateStr of dateRange) {
    const curLocal = parseLocalDate(dateStr);

    // Respect goal boundaries
    if (curLocal < startLocal) continue;
    if (endLocal && curLocal > endLocal) continue;

    let isScheduled = false;
    const recurrence = habit.recurrence || {};

    switch (recurrence.type) {
      case 'daily':
        isScheduled = true;
        break;

      case 'specificDays':
        if (recurrence.days && Array.isArray(recurrence.days)) {
          const wd = WEEKDAY_NAMES[curLocal.getDay()];
          isScheduled = recurrence.days.includes(wd);
        }
        break;

      case 'everyOtherDay': {
        const msDiff = curLocal.getTime() - startLocal.getTime();
        const daysDiff = Math.round(msDiff / (24 * 60 * 60 * 1000));
        isScheduled = (daysDiff >= 0 && daysDiff % 2 === 0);
        break;
      }

      case 'xPerWeek': {
        const count = Math.min(7, Math.max(1, recurrence.countPerPeriod || 1));
        const activeDays = WEEK_DISTRIBUTIONS[count] || ["Wed"];
        const curDayIndex = curLocal.getDay(); // 0 is Sun, 1 is Mon...
        // Convert to Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6, Sun=7
        const adjustedIdx = curDayIndex === 0 ? 7 : curDayIndex;
        const adjustedNames = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        const curDayName = adjustedNames[adjustedIdx];
        isScheduled = activeDays.includes(curDayName);
        break;
      }

      case 'xPerMonth': {
        const year = curLocal.getFullYear();
        const month = curLocal.getMonth();
        const day = curLocal.getDate();
        const count = recurrence.countPerPeriod || 1;
        const scheduledDays = getMonthDates(year, month, count);
        isScheduled = scheduledDays.includes(day);
        break;
      }

      default:
        isScheduled = false;
        break;
    }

    if (isScheduled && habit.timeSlots && Array.isArray(habit.timeSlots)) {
      for (const slot of habit.timeSlots) {
        const exceptionKey = `${dateStr}_${slot.time}`;
        if (habit.exceptions && habit.exceptions.includes(exceptionKey)) {
          continue;
        }
        const hasMultipleSlots = habit.timeSlots.length > 1;
        const slotSuffix = hasMultipleSlots ? ` (${slot.label || slot.time})` : '';
        instances.push({
          date: dateStr,
          time: slot.time,
          title: `${habit.name}${slotSuffix}`,
          habitId: habit.id,
          slotLabel: slot.label || ''
        });
      }
    }
  }

  return instances;
}

/**
 * Dynamic calculation of the current and longest streaks for a habit based on its completions.
 * Walks backward from today in local time.
 * @param {object} habit
 * @param {string} todayStr "YYYY-MM-DD"
 */
export function recalculateHabitStreaks(habit, todayStr) {
  const startDateStr = habit.goal.startDate;
  if (todayStr < startDateStr) {
    return { current: 0, longest: habit.streak?.longest || 0, lastCompletedDate: habit.streak?.lastCompletedDate || null };
  }

  // Generate all scheduled dates for this habit up to today
  // Let's generate a list of days from startDateStr to todayStr
  const start = parseLocalDate(startDateStr);
  const end = parseLocalDate(todayStr);
  const dates = [];
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(formatLocalDate(cur));
    cur.setDate(cur.getDate() + 1);
  }

  // Find unique scheduled dates
  const scheduledDates = new Set();
  const instances = generateHabitInstances(habit, dates);
  for (const inst of instances) {
    scheduledDates.add(inst.date);
  }

  // Sort scheduled dates descending (most recent first)
  const sortedScheduled = Array.from(scheduledDates).sort((a, b) => b.localeCompare(a));

  let currentStreak = 0;
  let broken = false;
  let lastCompletedDate = habit.streak?.lastCompletedDate || null;

  for (const date of sortedScheduled) {
    // Check if all slots for this scheduled date were completed
    const dayCompletions = habit.completions?.[date] || {};
    const slots = habit.timeSlots || [];
    const isCompleted = slots.length > 0 && slots.every(s => dayCompletions[s.time] === true);

    if (date === todayStr) {
      if (isCompleted) {
        currentStreak++;
        if (!lastCompletedDate || date > lastCompletedDate) {
          lastCompletedDate = date;
        }
      }
      // If today is scheduled but NOT complete, we don't count it, but we don't break yet (user still has time)
    } else {
      if (isCompleted) {
        currentStreak++;
        if (!lastCompletedDate || date > lastCompletedDate) {
          lastCompletedDate = date;
        }
      } else {
        broken = true;
        break;
      }
    }
  }

  let longest = habit.streak?.longest || 0;
  if (currentStreak > longest) {
    longest = currentStreak;
  }

  return {
    current: currentStreak,
    longest,
    lastCompletedDate
  };
}
