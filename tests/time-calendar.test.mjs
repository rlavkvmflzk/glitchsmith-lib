import assert from "node:assert/strict";
import test from "node:test";
import { time } from "../scripts/api/time.js";

// Provider shapes checked against installed sources, not the library's own output:
// SC Reborn: api.getTimeConfiguration() -> Time.toConfig() in index.js.
// Calendaria: CalendarData.days in calendaria.mjs.map, scripts/data/calendaria-calendar.mjs.
// Seasons & Stars: schemas/calendar-v1.0.0.json, time.{hoursInDay,minutesInHour,secondsInMinute}.
// Foundry V14 CalendarData: client/data/calendar.mjs, days.{hoursPerDay,minutesPerHour,secondsPerMinute}.
function installClock(source, { phone = false, hours = 30, minutes = 100, seconds = 20 } = {}) {
  const units = { hoursInDay: hours, minutesInHour: minutes, secondsInMinute: seconds };
  const days = {};
  for (const [property, unit] of Object.entries({ hoursPerDay: "hoursInDay", minutesPerHour: "minutesInHour", secondsPerMinute: "secondsInMinute" })) {
    Object.defineProperty(days, property, { get: () => units[unit] });
  }
  const daySeconds = () => units.hoursInDay * units.minutesInHour * units.secondsInMinute;
  const hourSeconds = () => units.minutesInHour * units.secondsInMinute;
  const decode = timestamp => {
    const withinDay = ((timestamp % daySeconds()) + daySeconds()) % daySeconds();
    return { year: 1, month: 1, day: Math.floor(timestamp / daySeconds()) + 1,
      hour: Math.floor(withinDay / hourSeconds()),
      minute: Math.floor(withinDay % hourSeconds() / units.secondsInMinute),
      second: Math.floor(withinDay % units.secondsInMinute), weekday: 0 };
  };
  const encode = parts => ((parts.day ?? 1) - 1) * daySeconds()
    + (parts.hour ?? 0) * hourSeconds() + (parts.minute ?? 0) * units.secondsInMinute + (parts.second ?? 0);
  const months = [{ name: "Longmonth", days: 30, numberOfDays: 30 }];
  const weekdays = [{ name: "Firstday" }];
  const modules = new Map();
  const moduleId = source === "simple-calendar" ? "foundryvtt-simple-calendar"
    : source === "simple-calendar-reborn" ? "foundryvtt-simple-calendar-reborn" : source;
  if (source !== "core" && source !== "smartphone-internal") modules.set(moduleId, { active: true });
  const coreCalendar = { days: { values: weekdays, ...days }, months: { values: months },
    timeToComponents: timestamp => {
      const date = decode(timestamp);
      return { year: 0, month: 0, dayOfMonth: date.day - 1, dayOfWeek: 0,
        hour: date.hour, minute: date.minute, second: date.second };
    },
    componentsToTime: parts => encode({ ...parts, day: (parts.day ?? 0) + 1 }) };
  // Keep getters: live calendar configuration changes must be observable on reread.
  Object.defineProperties(coreCalendar.days, Object.getOwnPropertyDescriptors(days));
  globalThis.game = { modules, time: { worldTime: 0, calendar: coreCalendar }, i18n: { localize: value => value } };
  delete globalThis.SimpleCalendar;
  delete globalThis.CALENDARIA;
  if (source.startsWith("simple-calendar")) {
    globalThis.SimpleCalendar = { api: {
      getTimeConfiguration: () => ({ ...units }),
      getAllMonths: () => months, getAllWeekdays: () => weekdays,
      timestamp: () => game.time.worldTime,
      timestampToDate: timestamp => {
        const p = decode(timestamp);
        return { ...p, month: p.month - 1, day: p.day - 1, seconds: p.second, dayOfTheWeek: p.weekday };
      },
      dateToTimestamp: p => encode({ ...p, day: p.day + 1, second: p.seconds }),
      timestampPlusInterval: (timestamp, interval) => timestamp + (interval.day ?? 0) * daySeconds()
        + (interval.hour ?? 0) * hourSeconds() + (interval.minute ?? 0) * units.secondsInMinute,
    } };
  } else if (source === "calendaria") {
    globalThis.CALENDARIA = { api: { getActiveCalendar: () => ({ days, monthsArray: months, weekdaysArray: weekdays }),
      timestampToDate: timestamp => { const { second, weekday, ...date } = decode(timestamp); return date; },
      dateToTimestamp: encode } };
  } else if (source === "seasons-and-stars") {
    game.seasonsStars = { api: { getActiveCalendar: () => ({ time: units, months, weekdays }),
      worldTimeToDate: timestamp => { const { hour, minute, second, ...date } = decode(timestamp); return { ...date, time: { hour, minute, second } }; },
      dateToWorldTime: date => encode({ ...date, ...date.time }) } };
  }
  if (phone || source === "smartphone-internal") {
    const internal = source === "smartphone-internal";
    modules.set("smartphone-widget", { active: true, api: { SmartphoneTime: {
      getTimeSource: () => internal ? "internal" : source,
      getCalendarConfig: () => ({ months, weekdays, ...(internal ? units : {}) }),
      // An external calendar must never inherit the phone's unrelated internal day shape.
      getConfig: () => internal ? { ...units, months, weekdays } : { hoursInDay: 24, minutesInHour: 60, secondsInMinute: 60 },
      now: () => game.time.worldTime * 1000,
      getDateObject: timestamp => decode(timestamp / 1000),
      fromObjectToTimestamp: parts => encode(parts) * 1000,
    } } });
  }
  return { units, daySeconds, setTime: parts => { game.time.worldTime = encode(parts); } };
}

for (const source of ["simple-calendar", "simple-calendar-reborn", "calendaria", "seasons-and-stars", "simple-timekeeping", "core", "smartphone-internal"]) {
  test(`${source}: provider time units govern 29:99 -> 00:00 and duration calculations`, () => {
    const clock = installClock(source);
    const structure = time.getCalendarStructure();
    assert.equal(structure.sourceId, source);
    for (const key of ["hoursInDay", "minutesInHour", "secondsInMinute"]) assert.equal(structure[key], clock.units[key]);
    clock.setTime({ day: 1, hour: 29, minute: 99 });
    assert.equal(time.getDateParts(time.now()).hour, 29);
    assert.equal(time.getDateParts(time.now()).minute, 99);
    const nextMinute = time.addDuration(time.now(), { minutes: 1 });
    assert.equal(time.getDateParts(nextMinute).day, 2);
    assert.equal(time.getDateParts(nextMinute).hour, 0);
    assert.equal(time.getDateParts(nextMinute).minute, 0);
    assert.equal(time.addDuration(0, { days: 1 }), clock.daySeconds() * 1000);
    assert.deepEqual(time.remaining(time.addDuration(0, { days: 1, hours: 2, minutes: 3 }), 0), {
      expired: false, totalMs: (clock.daySeconds() + 2 * 100 * 20 + 3 * 20) * 1000, days: 1, hours: 2, minutes: 3,
    });
    const parts = { year: 1, month: 1, day: 2, hour: 27, minute: 80, second: 0 };
    const converted = time.getDateParts(time.partsToTimestamp(parts));
    for (const key of ["day", "hour", "minute"]) assert.equal(converted[key], parts[key]);
  });
}

for (const source of ["simple-calendar", "simple-calendar-reborn", "calendaria", "seasons-and-stars", "simple-timekeeping"]) {
  test(`phone following ${source}: the source's units survive the phone's labels-only summary`, () => {
    const clock = installClock(source, { phone: true });
    clock.setTime({ hour: 27, minute: 80 });
    assert.equal(time.sourceId(), source);
    assert.equal(time.getDateParts(time.now()).hour, 27);
    assert.equal(time.getCalendarStructure().hoursInDay, 30);
    assert.equal(time.getCalendarStructure().minutesInHour, 100);
    assert.equal(time.getCalendarStructure().secondsInMinute, 20);
    assert.equal(time.addDuration(0, { days: 1 }), clock.daySeconds() * 1000);
  });
}

test("time-unit configuration is reread rather than cached across calendar changes", () => {
  const clock = installClock("calendaria");
  const handlers = new Map();
  globalThis.Hooks = { on: (name, handler) => handlers.set(name, handler), off: (name, handler) => {
    assert.equal(handlers.get(name), handler); handlers.delete(name);
  } };
  const seen = [];
  const stop = time.onChange(() => seen.push(time.getCalendarStructure().hoursInDay));
  for (const hook of ["calendaria.calendarSwitched", "calendaria.calendarUpdated", "seasons-stars:dateChanged", "seasons-stars:calendarChanged"]) {
    assert.equal(typeof handlers.get(hook), "function");
  }
  handlers.get("calendaria.calendarSwitched")();
  clock.units.hoursInDay = 36;
  handlers.get("calendaria.calendarUpdated")();
  assert.deepEqual(seen, [30, 36]);
  stop();
  assert.equal(handlers.size, 0);
});

test("core without a calendar retains conventional V13 time units", () => {
  installClock("core");
  delete game.time.calendar;
  const structure = time.getCalendarStructure();
  assert.equal(structure.hoursInDay, 24);
  assert.equal(structure.minutesInHour, 60);
  assert.equal(structure.secondsInMinute, 60);
  assert.equal(time.addDuration(0, { days: 1 }), 86400000);
});

test("SC and smartphone time-unit saves refresh subscribers without a clock tick", () => {
  for (const [source, key] of [
    ["simple-calendar", "foundryvtt-simple-calendar.calendar-configuration"],
    ["simple-calendar-reborn", "foundryvtt-simple-calendar-reborn.calendar-configuration"],
    ["smartphone-internal", "smartphone-widget.smartphone-time-config"],
  ]) {
    const clock = installClock(source);
    const handlers = new Map();
    globalThis.Hooks = { on: (name, handler) => handlers.set(name, handler), off: name => handlers.delete(name) };
    const seen = [];
    const stop = time.onChange(() => seen.push(time.getCalendarStructure().hoursInDay));
    clock.units.hoursInDay = 36;
    handlers.get("updateSetting")({ key: "stylish-shop.unrelated-setting" });
    assert.deepEqual(seen, []);
    handlers.get("updateSetting")({ key });
    assert.deepEqual(seen, [36]);
    stop();
    assert.equal(handlers.size, 0);
  }
});

test("remote SC active-calendar changes publish the new clock even without a date-time hook", () => {
  for (const [source, moduleId] of [
    ["simple-calendar", "foundryvtt-simple-calendar"],
    ["simple-calendar-reborn", "foundryvtt-simple-calendar-reborn"],
  ]) {
    for (const phone of [false, true]) {
      const clock = installClock(source, { phone, hours: 24, minutes: 60, seconds: 60 });
      const handlers = new Map();
      globalThis.Hooks = { on: (name, handler) => handlers.set(name, handler), off: name => handlers.delete(name) };
      const seen = [];
      const stop = time.onChange(timestamp => seen.push({
        hour: time.getDateParts(timestamp).hour,
        hoursInDay: time.getCalendarStructure().hoursInDay,
      }));
      assert.equal(time.getCalendarStructure().hoursInDay, 24);
      // A remote client's setting onChange loads the selected calendar before this hook.
      clock.units.hoursInDay = 30;
      clock.setTime({ hour: 25 });
      handlers.get("updateSetting")({ key: `${moduleId}.active-calendar` });
      assert.deepEqual(seen, [{ hour: 25, hoursInDay: 30 }], `${source}, phone=${phone}`);
      stop();
      assert.equal(handlers.size, 0);
    }
  }
});
