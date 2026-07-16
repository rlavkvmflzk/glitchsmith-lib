/**
 * GlitchSmith Library — Game Time Facade
 *
 * Unified, read-only access to the world's game clock for GlitchSmith
 * modules. Delegates to the most authoritative source available:
 *
 *   1. Smartphone Widget's SmartphoneTime (which itself adapts Simple
 *      Calendar (Reborn), Calendaria, Seasons & Stars, Simple Timekeeping,
 *      or its own independent world clock)
 *   2. Simple Calendar / Simple Calendar Reborn
 *   3. Calendaria
 *   4. Seasons & Stars / Simple Timekeeping / core `game.time.worldTime`
 *
 * All timestamps are game-milliseconds on the axis of the active source
 * (matching SmartphoneTime's ms convention). Axes differ between sources,
 * so consumers that persist timestamps should store `sourceId()` alongside
 * and stop trusting the persisted value when the source changes.
 *
 * This facade never writes or advances world time.
 */

export const TIME_SOURCES = Object.freeze({
  SMARTPHONE_INTERNAL: "smartphone-internal",
  SIMPLE_CALENDAR: "simple-calendar",
  SIMPLE_CALENDAR_REBORN: "simple-calendar-reborn",
  CALENDARIA: "calendaria",
  SEASONS_AND_STARS: "seasons-and-stars",
  SIMPLE_TIMEKEEPING: "simple-timekeeping",
  CORE: "core",
});

const CHANGE_HOOKS = [
  "smartphoneTimeChanged",
  "updateWorldTime",
  "simple-calendar-date-time-change",
  "calendaria.dateTimeChange",
];

const DEFAULT_MONTHS = Object.freeze([
  { name: "January", abbreviation: "Jan", days: 31 },
  { name: "February", abbreviation: "Feb", days: 28, leapDays: 29 },
  { name: "March", abbreviation: "Mar", days: 31 },
  { name: "April", abbreviation: "Apr", days: 30 },
  { name: "May", abbreviation: "May", days: 31 },
  { name: "June", abbreviation: "Jun", days: 30 },
  { name: "July", abbreviation: "Jul", days: 31 },
  { name: "August", abbreviation: "Aug", days: 31 },
  { name: "September", abbreviation: "Sep", days: 30 },
  { name: "October", abbreviation: "Oct", days: 31 },
  { name: "November", abbreviation: "Nov", days: 30 },
  { name: "December", abbreviation: "Dec", days: 31 },
]);

const DEFAULT_WEEKDAYS = Object.freeze([
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
]);

function _isActive(moduleId) {
  return game.modules.get(moduleId)?.active === true;
}

function _phoneTime() {
  const mod = game.modules.get("smartphone-widget");
  if (!mod?.active) return null;
  return mod.api?.SmartphoneTime ?? null;
}

function _scApi() {
  return globalThis.SimpleCalendar?.api ?? null;
}

function _localize(value) {
  if (typeof value !== "string" || !value) return "";
  return game.i18n?.localize?.(value) ?? value;
}

/** Month/weekday entries arrive as strings or `{name, abbreviation}` objects. */
function _label(entry) {
  if (typeof entry === "string") return _localize(entry);
  return _localize(entry?.name ?? "");
}

function _abbr(entry) {
  if (entry && typeof entry === "object" && typeof entry.abbreviation === "string" && entry.abbreviation) {
    return _localize(entry.abbreviation);
  }
  const name = _label(entry);
  return name ? name.slice(0, 3) : "";
}

function _positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function _monthDays(entry, fallback = 30) {
  return _positiveInt(entry?.days ?? entry?.numberOfDays ?? entry?.length, fallback);
}

function _monthLeapDays(entry, baseDays) {
  const explicit = entry?.leapDays ?? entry?.numberOfLeapYearDays;
  if (explicit !== undefined && explicit !== null) return _positiveInt(explicit, baseDays);
  if (entry?.isLeap === true) return _positiveInt(baseDays + (Number(entry.leapOffset) || 0), baseDays);
  return baseDays;
}

function _normalizeMonth(entry, index) {
  const days = _monthDays(entry);
  const leapDays = _monthLeapDays(entry, days);
  const name = _label(entry) || String(index + 1);
  const abbreviation = _abbr(entry) || name.slice(0, 3);
  return {
    value: index + 1,
    name,
    abbreviation,
    days,
    leapDays,
    maxDays: Math.max(days, leapDays),
  };
}

function _normalizeWeekday(entry, index) {
  const name = _label(entry) || String(index + 1);
  return {
    value: index,
    name,
    abbreviation: _abbr(entry) || name.slice(0, 3),
  };
}

function _normalizeCalendarStructure(raw = {}) {
  const rawMonths = Array.isArray(raw.months) && raw.months.length > 0 ? raw.months : DEFAULT_MONTHS;
  const rawWeekdays = Array.isArray(raw.weekdays) && raw.weekdays.length > 0 ? raw.weekdays : DEFAULT_WEEKDAYS;
  const secondsInMinute = _positiveInt(raw.secondsInMinute, 60);
  const minutesInHour = _positiveInt(raw.minutesInHour, 60);
  const hoursInDay = _positiveInt(raw.hoursInDay, 24);
  return {
    months: rawMonths.map(_normalizeMonth),
    weekdays: rawWeekdays.map(_normalizeWeekday),
    secondsInMinute,
    minutesInHour,
    hoursInDay,
    leapYearRule: raw.leapYearRule ?? null,
  };
}

function _coreCalendarStructure() {
  const calendar = game.time?.calendar ?? null;
  if (!calendar) return _normalizeCalendarStructure();
  return _normalizeCalendarStructure({
    months: calendar.months?.values ?? [],
    weekdays: calendar.days?.values ?? [],
  });
}

function _isLeapByRule(year, rule) {
  if (!rule || typeof rule !== "object") return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const frequency = Number(rule.frequency) || 0;
  const exception = Number(rule.exception) || 0;
  const proleptic = Number(rule.proleptic) || 0;
  if (exception > 0 && year % exception === 0) return proleptic > 0 && year % proleptic === 0;
  return frequency > 0 && year % frequency === 0;
}

function _structureDaysInMonth(structure, year, month) {
  const entry = structure.months[Math.max(0, Math.min(structure.months.length - 1, month - 1))];
  if (!entry) return 30;
  if (entry.leapDays !== entry.days && _isLeapByRule(year, structure.leapYearRule)) return entry.leapDays;
  return entry.days;
}

function _normalizePartsInput(parts = {}) {
  const value = (key, fallback) => {
    const n = Number(parts[key]);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
  };
  return {
    year: value("year", 0),
    month: Math.max(1, value("month", 1)),
    day: Math.max(1, value("day", 1)),
    hour: Math.max(0, value("hour", 0)),
    minute: Math.max(0, value("minute", 0)),
    second: Math.max(0, value("second", 0)),
  };
}

function _genericTimestampFromParts(parts, structure = _normalizeCalendarStructure()) {
  let days = 0;
  for (let y = 0; y < parts.year; y += 1) {
    for (const month of structure.months) {
      days += month.leapDays !== month.days && _isLeapByRule(y, structure.leapYearRule) ? month.leapDays : month.days;
    }
  }
  for (let m = 1; m < parts.month; m += 1) days += _structureDaysInMonth(structure, parts.year, m);
  days += parts.day - 1;
  const seconds =
    days * structure.hoursInDay * structure.minutesInHour * structure.secondsInMinute +
    parts.hour * structure.minutesInHour * structure.secondsInMinute +
    parts.minute * structure.secondsInMinute +
    parts.second;
  return seconds * 1000;
}

function _coreTimestampFromParts(parts) {
  const calendar = game.time?.calendar ?? null;
  if (!calendar?.componentsToTime) return null;
  const months = calendar.months?.values ?? [];
  const isLeap = typeof calendar.isLeapYear === "function" ? calendar.isLeapYear(parts.year) : false;
  let dayOfYear = 0;
  for (let i = 0; i < parts.month - 1; i += 1) {
    const month = months[i] ?? null;
    const baseDays = _monthDays(month);
    dayOfYear += isLeap ? _monthLeapDays(month, baseDays) : baseDays;
  }
  dayOfYear += parts.day - 1;
  return calendar.componentsToTime({
    year: parts.year - 1,
    day: dayOfYear,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  }) * 1000;
}

/**
 * Effective clock id. When the smartphone is active this reports the axis
 * the phone is reading (so persisted timestamps survive the phone being
 * disabled while e.g. Simple Calendar stays installed).
 */
export function sourceId() {
  const phone = _phoneTime();
  if (phone) {
    try {
      switch (phone.getTimeSource?.()) {
        case "simple-calendar": return TIME_SOURCES.SIMPLE_CALENDAR;
        case "simple-calendar-reborn": return TIME_SOURCES.SIMPLE_CALENDAR_REBORN;
        case "calendaria": return TIME_SOURCES.CALENDARIA;
        case "seasons-and-stars": return TIME_SOURCES.SEASONS_AND_STARS;
        case "simple-timekeeping": return TIME_SOURCES.SIMPLE_TIMEKEEPING;
        default: return TIME_SOURCES.SMARTPHONE_INTERNAL;
      }
    } catch (e) {
      console.error("GlitchSmith Library | time.sourceId failed:", e);
      return TIME_SOURCES.SMARTPHONE_INTERNAL;
    }
  }
  if (_isActive("foundryvtt-simple-calendar") && _scApi()) return TIME_SOURCES.SIMPLE_CALENDAR;
  if (_isActive("foundryvtt-simple-calendar-reborn") && _scApi()) return TIME_SOURCES.SIMPLE_CALENDAR_REBORN;
  if (_isActive("calendaria")) return TIME_SOURCES.CALENDARIA;
  if (_isActive("seasons-and-stars")) return TIME_SOURCES.SEASONS_AND_STARS;
  if (_isActive("simple-timekeeping")) return TIME_SOURCES.SIMPLE_TIMEKEEPING;
  return TIME_SOURCES.CORE;
}

/** Current game time in ms on the active source's axis. */
export function now() {
  const phone = _phoneTime();
  if (phone) {
    try {
      return phone.now();
    } catch (e) {
      console.error("GlitchSmith Library | time.now failed via SmartphoneTime:", e);
    }
  }
  const source = sourceId();
  if (source === TIME_SOURCES.SIMPLE_CALENDAR || source === TIME_SOURCES.SIMPLE_CALENDAR_REBORN) {
    const api = _scApi();
    if (api) return api.timestamp() * 1000;
  }
  return (game.time?.worldTime ?? 0) * 1000;
}

function _genericParts(ts) {
  const totalSeconds = Math.max(0, Math.floor((Number(ts) || 0) / 1000));
  const day = Math.floor(totalSeconds / 86400);
  const rest = totalSeconds % 86400;
  return {
    year: 0,
    month: 1,
    day: day + 1,
    hour: Math.floor(rest / 3600),
    minute: Math.floor((rest % 3600) / 60),
    second: rest % 60,
    weekday: 0,
    monthName: "",
    monthAbbr: "",
    weekdayName: "",
  };
}

function _joinParts(parts, months, weekdays) {
  const monthEntry = Array.isArray(months) ? months[(parts.month ?? 1) - 1] ?? null : null;
  const weekdayEntry = Array.isArray(weekdays) ? weekdays[parts.weekday ?? -1] ?? null : null;
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
    weekday: parts.weekday ?? 0,
    monthName: _label(monthEntry) || String(parts.month ?? 1),
    monthAbbr: _abbr(monthEntry) || String(parts.month ?? 1),
    weekdayName: _label(weekdayEntry),
  };
}

function _corePartsFromCalendar(ts) {
  const calendar = game.time?.calendar ?? null;
  if (!calendar?.timeToComponents) return null;
  const c = calendar.timeToComponents(ts / 1000);
  return _joinParts(
    {
      year: (c.year ?? 0) + 1,
      month: (c.month ?? 0) + 1,
      day: (c.dayOfMonth ?? 0) + 1,
      hour: c.hour ?? 0,
      minute: c.minute ?? 0,
      second: c.second ?? 0,
      weekday: c.dayOfWeek ?? 0,
    },
    calendar.months?.values ?? [],
    calendar.days?.values ?? []
  );
}

/**
 * Calendar-resolved date parts for a timestamp:
 * `{year, month, day, hour, minute, second, weekday, monthName, monthAbbr, weekdayName}`.
 * Month/weekday names come from the active calendar, so custom fantasy
 * calendars surface their own labels.
 */
export function getDateParts(ts) {
  const timestamp = Number(ts);
  const value = Number.isFinite(timestamp) ? timestamp : now();
  try {
    const phone = _phoneTime();
    if (phone) {
      const d = phone.getDateObject(value);
      const cal = phone.getCalendarConfig?.() ?? null;
      return _joinParts(d, cal?.months ?? [], cal?.weekdays ?? []);
    }
    switch (sourceId()) {
      case TIME_SOURCES.SIMPLE_CALENDAR:
      case TIME_SOURCES.SIMPLE_CALENDAR_REBORN: {
        const api = _scApi();
        if (!api) break;
        const scDate = api.timestampToDate(value / 1000);
        if (!scDate) break;
        return _joinParts(
          {
            year: scDate.year,
            month: (scDate.month ?? 0) + 1,
            day: (scDate.day ?? 0) + 1,
            hour: scDate.hour ?? 0,
            minute: scDate.minute ?? 0,
            second: scDate.seconds ?? 0,
            weekday: scDate.dayOfTheWeek ?? 0,
          },
          api.getAllMonths?.() ?? [],
          api.getAllWeekdays?.() ?? []
        );
      }
      case TIME_SOURCES.CALENDARIA: {
        const api = globalThis.CALENDARIA?.api;
        if (!api) break;
        const calDate = api.timestampToDate(value / 1000);
        if (!calDate) break;
        const cal = api.getActiveCalendar?.() ?? null;
        return _joinParts(
          {
            year: calDate.year,
            month: calDate.month ?? calDate.ordinal ?? 1,
            day: calDate.day ?? 1,
            hour: calDate.hour ?? 0,
            minute: calDate.minute ?? 0,
            second: calDate.second ?? 0,
            weekday: calDate.weekday ?? 0,
          },
          cal?.monthsArray ?? [],
          cal?.weekdaysArray ?? []
        );
      }
      case TIME_SOURCES.SEASONS_AND_STARS: {
        const api = game.seasonsStars?.api;
        if (!api) break;
        const snsDate = api.worldTimeToDate(value / 1000);
        if (!snsDate) break;
        const cal = api.getActiveCalendar?.() ?? null;
        return _joinParts(
          {
            year: snsDate.year,
            month: snsDate.month ?? 1,
            day: snsDate.day ?? 1,
            hour: snsDate.time?.hour ?? 0,
            minute: snsDate.time?.minute ?? 0,
            second: snsDate.time?.second ?? 0,
            weekday: snsDate.weekday ?? 0,
          },
          cal?.months ?? [],
          cal?.weekdays ?? []
        );
      }
      case TIME_SOURCES.SIMPLE_TIMEKEEPING:
      case TIME_SOURCES.CORE: {
        const parts = _corePartsFromCalendar(value);
        if (parts) return parts;
        break;
      }
    }
  } catch (e) {
    console.error("GlitchSmith Library | time.getDateParts failed:", e);
  }
  return _genericParts(value);
}

export function getCalendarStructure() {
  try {
    const phone = _phoneTime();
    if (phone) {
      const raw = phone.getCalendarConfig?.() ?? phone.getConfig?.() ?? {};
      return { sourceId: sourceId(), ..._normalizeCalendarStructure(raw) };
    }
    switch (sourceId()) {
      case TIME_SOURCES.SIMPLE_CALENDAR:
      case TIME_SOURCES.SIMPLE_CALENDAR_REBORN: {
        const api = _scApi();
        if (api) {
          return {
            sourceId: sourceId(),
            ..._normalizeCalendarStructure({
              months: api.getAllMonths?.() ?? [],
              weekdays: api.getAllWeekdays?.() ?? [],
            }),
          };
        }
        break;
      }
      case TIME_SOURCES.CALENDARIA: {
        const cal = globalThis.CALENDARIA?.api?.getActiveCalendar?.() ?? null;
        if (cal) return { sourceId: sourceId(), ..._normalizeCalendarStructure({ months: cal.monthsArray ?? [], weekdays: cal.weekdaysArray ?? [] }) };
        break;
      }
      case TIME_SOURCES.SEASONS_AND_STARS: {
        const cal = game.seasonsStars?.api?.getActiveCalendar?.() ?? null;
        if (cal) return { sourceId: sourceId(), ..._normalizeCalendarStructure({ months: cal.months ?? [], weekdays: cal.weekdays ?? [] }) };
        break;
      }
      case TIME_SOURCES.SIMPLE_TIMEKEEPING:
      case TIME_SOURCES.CORE:
        return { sourceId: sourceId(), ..._coreCalendarStructure() };
    }
  } catch (e) {
    console.error("GlitchSmith Library | time.getCalendarStructure failed:", e);
  }
  return { sourceId: sourceId(), ..._normalizeCalendarStructure() };
}

export function partsToTimestamp(parts) {
  const d = _normalizePartsInput(parts);
  try {
    const phone = _phoneTime();
    if (phone?.fromObjectToTimestamp) {
      return phone.fromObjectToTimestamp(d);
    }
    switch (sourceId()) {
      case TIME_SOURCES.SIMPLE_CALENDAR:
      case TIME_SOURCES.SIMPLE_CALENDAR_REBORN: {
        const api = _scApi();
        if (api?.dateToTimestamp) {
          return api.dateToTimestamp({
            year: d.year,
            month: d.month - 1,
            day: d.day - 1,
            hour: d.hour,
            minute: d.minute,
            seconds: d.second,
          }) * 1000;
        }
        break;
      }
      case TIME_SOURCES.CALENDARIA: {
        const api = globalThis.CALENDARIA?.api;
        if (api?.dateToTimestamp) {
          return api.dateToTimestamp({
            year: d.year,
            month: d.month,
            day: d.day,
            hour: d.hour,
            minute: d.minute,
            second: d.second,
          }) * 1000;
        }
        break;
      }
      case TIME_SOURCES.SEASONS_AND_STARS: {
        const api = game.seasonsStars?.api;
        if (api?.dateToWorldTime) {
          return api.dateToWorldTime({
            year: d.year,
            month: d.month,
            day: d.day,
            time: { hour: d.hour, minute: d.minute, second: d.second },
          }) * 1000;
        }
        break;
      }
      case TIME_SOURCES.SIMPLE_TIMEKEEPING:
      case TIME_SOURCES.CORE: {
        const coreTs = _coreTimestampFromParts(d);
        if (Number.isFinite(coreTs)) return coreTs;
        break;
      }
    }
  } catch (e) {
    console.error("GlitchSmith Library | time.partsToTimestamp failed:", e);
    return null;
  }
  return _genericTimestampFromParts(d, getCalendarStructure());
}

/**
 * Format a timestamp with calendar-aware tokens. Single-pass replacement,
 * so month/weekday names containing token letters are never re-expanded.
 * Tokens: YYYY, MMMM (month name), MMM (abbr), MM, DD, ddd (weekday name),
 * HH, mm, ss.
 */
export function format(ts, pattern = "YYYY-MM-DD HH:mm") {
  const p = getDateParts(ts);
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return String(pattern).replace(/YYYY|MMMM|MMM|MM|DD|ddd|HH|mm|ss/g, (token) => {
    switch (token) {
      case "YYYY": return pad(p.year, 4);
      case "MMMM": return p.monthName;
      case "MMM": return p.monthAbbr;
      case "MM": return pad(p.month);
      case "DD": return pad(p.day);
      case "ddd": return p.weekdayName;
      case "HH": return pad(p.hour);
      case "mm": return pad(p.minute);
      case "ss": return pad(p.second);
      default: return token;
    }
  });
}

/**
 * Seconds per minute/hour/day for the active source. The smartphone's
 * independent clock exposes its configured day shape; Simple Calendar
 * durations go through `timestampPlusInterval` in `addDuration` instead;
 * other sources follow SmartphoneTime's own 86400s/day convention.
 */
function _unitSeconds() {
  try {
    const phone = _phoneTime();
    if (phone && phone.getTimeSource?.() === "internal") {
      const cfg = phone.getConfig?.() ?? {};
      const secondsInMinute = Number(cfg.secondsInMinute) || 60;
      const minutesInHour = Number(cfg.minutesInHour) || 60;
      const hoursInDay = Number(cfg.hoursInDay) || 24;
      return {
        minute: secondsInMinute,
        hour: secondsInMinute * minutesInHour,
        day: secondsInMinute * minutesInHour * hoursInDay,
      };
    }
  } catch (e) {
    console.error("GlitchSmith Library | time._unitSeconds failed:", e);
  }
  return { minute: 60, hour: 3600, day: 86400 };
}

/**
 * Add a game-time duration to a timestamp (default: now) and return the
 * resulting timestamp in ms. Uses the active calendar's own interval math
 * when it provides one.
 */
export function addDuration(ts, { days = 0, hours = 0, minutes = 0 } = {}) {
  const base = Number(ts);
  const start = Number.isFinite(base) ? base : now();
  const source = sourceId();
  if (source === TIME_SOURCES.SIMPLE_CALENDAR || source === TIME_SOURCES.SIMPLE_CALENDAR_REBORN) {
    const api = _scApi();
    if (api?.timestampPlusInterval) {
      try {
        return api.timestampPlusInterval(start / 1000, { day: days, hour: hours, minute: minutes }) * 1000;
      } catch (e) {
        console.error("GlitchSmith Library | time.addDuration failed via Simple Calendar:", e);
      }
    }
  }
  const unit = _unitSeconds();
  return start + (days * unit.day + hours * unit.hour + minutes * unit.minute) * 1000;
}

/**
 * Remaining game time until `targetTs`:
 * `{expired, totalMs, days, hours, minutes}` sized by the active
 * calendar's day/hour lengths. Returns null for non-numeric targets.
 */
export function remaining(targetTs, nowTs = now()) {
  const target = Number(targetTs);
  if (!Number.isFinite(target)) return null;
  const diff = target - nowTs;
  const totalMs = Math.max(0, diff);
  const unit = _unitSeconds();
  const dayMs = unit.day * 1000;
  const hourMs = unit.hour * 1000;
  const minuteMs = unit.minute * 1000;
  return {
    expired: diff <= 0,
    totalMs,
    days: Math.floor(totalMs / dayMs),
    hours: Math.floor((totalMs % dayMs) / hourMs),
    minutes: Math.floor((totalMs % hourMs) / minuteMs),
  };
}

/**
 * Subscribe to game-time changes across every supported source.
 * The callback receives the current timestamp; sources that re-broadcast
 * each other (e.g. the phone mirroring Simple Calendar) may fire it more
 * than once per change. Returns an unsubscribe function.
 */
export function onChange(callback) {
  if (typeof callback !== "function") return () => {};
  const handler = () => {
    try {
      callback(now());
    } catch (e) {
      console.error("GlitchSmith Library | time.onChange callback failed:", e);
    }
  };
  for (const hook of CHANGE_HOOKS) Hooks.on(hook, handler);
  return () => {
    for (const hook of CHANGE_HOOKS) Hooks.off(hook, handler);
  };
}

export const time = Object.freeze({
  SOURCES: TIME_SOURCES,
  sourceId,
  now,
  getDateParts,
  getCalendarStructure,
  partsToTimestamp,
  format,
  addDuration,
  remaining,
  onChange,
});
