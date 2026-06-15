/**
 * Clarity — shared/holidays.js
 * Offline Sri Lankan Holidays dataset and utilities.
 */

const HOLIDAYS_2025 = {
  "01-13": "Duruthu Full Moon Poya Day",
  "01-14": "Tamil Thai Pongal Day",
  "02-04": "National Day",
  "02-12": "Navam Full Moon Poya Day",
  "02-26": "Mahasivarathri Day",
  "03-13": "Medin Full Moon Poya Day",
  "03-31": "Id-Ul-Fitr (Ramazan Festival)",
  "04-12": "Bak Full Moon Poya Day",
  "04-13": "Sinhala & Tamil New Year Eve",
  "04-14": "Sinhala & Tamil New Year Day",
  "04-18": "Good Friday",
  "05-01": "May Day",
  "05-12": "Vesak Full Moon Poya Day",
  "05-13": "Day following Vesak Full Moon Poya Day",
  "06-07": "Id-Ul-Alha (Hadji Festival)",
  "06-10": "Poson Full Moon Poya Day",
  "07-10": "Esala Full Moon Poya Day",
  "08-08": "Nikini Full Moon Poya Day",
  "09-05": "Milad-Un-Nabi (Holy Prophet's Birthday)",
  "09-07": "Binara Full Moon Poya Day",
  "10-06": "Vap Full Moon Poya Day",
  "10-20": "Deepavali Festival Day",
  "11-05": "Ill Full Moon Poya Day",
  "12-04": "Unduvap Full Moon Poya Day",
  "12-25": "Christmas Day"
};

const HOLIDAYS_2026 = {
  "01-03": "Duruthu Full Moon Poya Day",
  "01-15": "Tamil Thai Pongal Day",
  "02-01": "Navam Full Moon Poya Day",
  "02-04": "Independence Day",
  "02-15": "Mahasivarathri Day",
  "03-02": "Medin Full Moon Poya Day",
  "03-21": "Id-Ul-Fitr (Ramazan Festival)",
  "04-01": "Bak Full Moon Poya Day",
  "04-03": "Good Friday",
  "04-13": "Sinhala & Tamil New Year Eve",
  "04-14": "Sinhala & Tamil New Year Day",
  "05-01": "Vesak Full Moon Poya Day / May Day",
  "05-02": "Day following Vesak Full Moon Poya Day",
  "05-28": "Id-Ul-Alha (Hadji Festival)",
  "05-30": "Adhi Poson Full Moon Poya Day",
  "06-29": "Poson Full Moon Poya Day",
  "07-29": "Esala Full Moon Poya Day",
  "08-26": "Milad-Un-Nabi (Holy Prophet's Birthday)",
  "08-27": "Nikini Full Moon Poya Day",
  "09-26": "Binara Full Moon Poya Day",
  "10-25": "Vap Full Moon Poya Day",
  "11-08": "Deepavali Festival Day",
  "11-24": "Ill Full Moon Poya Day",
  "12-23": "Unduwap Full Moon Poya Day",
  "12-25": "Christmas Day"
};

const HOLIDAYS_2027 = {
  "01-15": "Tamil Thai Pongal Day",
  "01-22": "Duruthu Full Moon Poya Day",
  "02-04": "National Day",
  "02-20": "Navam Full Moon Poya Day",
  "03-06": "Mahasivarathri Day",
  "03-10": "Id-Ul-Fitr (Ramazan Festival)",
  "03-21": "Medin Full Moon Poya Day",
  "03-26": "Good Friday",
  "04-13": "Sinhala & Tamil New Year Eve",
  "04-14": "Sinhala & Tamil New Year Day",
  "04-20": "Bak Full Moon Poya Day",
  "05-01": "May Day",
  "05-17": "Id-Ul-Alha (Hadji Festival)",
  "05-20": "Vesak Full Moon Poya Day",
  "05-21": "Day following Vesak Full Moon Poya Day",
  "06-18": "Poson Full Moon Poya Day",
  "07-03": "Esala Full Moon Poya Day",
  "08-02": "Nikini Full Moon Poya Day",
  "08-30": "Milad-Un-Nabi (Holy Prophet's Birthday)",
  "08-31": "Adhi Nikini Full Moon Poya Day",
  "09-30": "Binara Full Moon Poya Day",
  "10-29": "Vap Full Moon Poya Day",
  "11-12": "Deepavali Festival Day",
  "11-28": "Ill Full Moon Poya Day",
  "12-25": "Christmas Day",
  "12-27": "Unduwap Full Moon Poya Day"
};

const FIXED_HOLIDAYS = {
  "01-15": "Tamil Thai Pongal Day",
  "02-04": "Independence Day",
  "04-13": "Sinhala & Tamil New Year Eve",
  "04-14": "Sinhala & Tamil New Year Day",
  "05-01": "May Day",
  "12-25": "Christmas Day"
};

/**
 * Returns the Sri Lankan holiday name and suitable emoji if the given date is a holiday.
 * @param {string} dateStr  Format "YYYY-MM-DD"
 * @returns {{name: string, emoji: string} | null}
 */
export function getSriLankanHoliday(dateStr) {
  if (!dateStr || dateStr.length < 10) return null;
  
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;
  
  const year = parts[0];
  const monthDay = `${parts[1]}-${parts[2]}`;
  
  let name = null;
  if (year === "2025") {
    name = HOLIDAYS_2025[monthDay];
  } else if (year === "2026") {
    name = HOLIDAYS_2026[monthDay];
  } else if (year === "2027") {
    name = HOLIDAYS_2027[monthDay];
  } else {
    // Fallback to fixed holidays for other years
    name = FIXED_HOLIDAYS[monthDay];
  }
  
  if (!name) return null;
  
  // Choose a nice emoji based on keywords
  let emoji = "🇱🇰";
  const lower = name.toLowerCase();
  if (lower.includes("poya")) {
    emoji = "🌕";
  } else if (lower.includes("new year") || lower.includes("awurudu")) {
    emoji = "🌾";
  } else if (lower.includes("christmas")) {
    emoji = "🎄";
  } else if (lower.includes("pongal")) {
    emoji = "🍯";
  } else if (lower.includes("independence") || lower.includes("national")) {
    emoji = "🇱🇰";
  } else if (lower.includes("friday")) {
    emoji = "✝️";
  } else if (lower.includes("ramazan") || lower.includes("fitr") || lower.includes("hadji") || lower.includes("alha") || lower.includes("milad")) {
    emoji = "🌙";
  } else if (lower.includes("deepavali")) {
    emoji = "🪔";
  } else if (lower.includes("sivarathri")) {
    emoji = "🕉️";
  }
  
  return { name, emoji };
}
