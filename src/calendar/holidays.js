// NLM CRM - US federal holidays + pure date helpers
//
// MIGRATION NOTE (step 7a of the modular extraction):
// First file in the new src/calendar/ subdirectory. Strangler-fig: this module
// duplicates the four pure helpers from index.html's CALENDAR block (search
// "// US FEDERAL HOLIDAYS" near line ~7653). Nothing imports from it yet; the
// inline copies are still authoritative for every callsite.
//
// Calendar extraction is split across multiple deploys because the inline
// CALENDAR block (~924 lines, ~30 KB) is too big and too state-coupled to do
// in a single pass. Roadmap:
//   7a. holidays.js (pure helpers + holiday data)    <- this file
//   7b. datepicker.js (openDatePicker / closeDatePicker / renderDatePickerPopup)
//   7c. index.js (renderCalendar + CRUD + state)
//
// These four functions are PURE - no DOM, no globals, no Supabase. Safe to
// migrate callsites in a later step by importing from this file.
//
// `getUsHolidayEvents()` is deliberately NOT included here because it reads
// `calSources` (an inline-scoped `let`). Extracting it would require either
// passing `calSources` in or reading `window.calSources` - that decision is
// part of step 7c, not 7a.

// Nth occurrence of a weekday in a given month (e.g. "3rd Monday of January").
// Args: year (full), month (0-11), weekday (0=Sun..6=Sat), n (1-based).
export function _nthWeekday(year, month, weekday, n){
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n-1)*7);
}

// Last occurrence of a weekday in a given month (e.g. "last Monday of May" for Memorial Day).
export function _lastWeekday(year, month, weekday){
  const last = new Date(year, month+1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - offset);
}

// Format a Date as "YYYY-MM-DD" (calendar local time, NOT ISO UTC).
export function _ymd(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

// All 11 US federal holidays for a given year.
export function getUsHolidaysForYear(year){
  return [
    { date: `${year}-01-01`,                   name: "New Year's Day" },
    { date: _ymd(_nthWeekday(year, 0, 1, 3)),  name: "Martin Luther King Jr. Day" },
    { date: _ymd(_nthWeekday(year, 1, 1, 3)),  name: "Presidents' Day" },
    { date: _ymd(_lastWeekday(year, 4, 1)),    name: "Memorial Day" },
    { date: `${year}-06-19`,                   name: "Juneteenth" },
    { date: `${year}-07-04`,                   name: "Independence Day" },
    { date: _ymd(_nthWeekday(year, 8, 1, 1)),  name: "Labor Day" },
    { date: _ymd(_nthWeekday(year, 9, 1, 2)),  name: "Columbus Day" },
    { date: `${year}-11-11`,                   name: "Veterans Day" },
    { date: _ymd(_nthWeekday(year, 10, 4, 4)), name: "Thanksgiving Day" },
    { date: `${year}-12-25`,                   name: "Christmas Day" },
  ];
}

window.__nlmCalendarHolidaysLoaded = true;
