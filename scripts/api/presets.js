import { CURRENCY_TYPES } from "../constants.js";

const SHEET = CURRENCY_TYPES.SHEET;

function normalizePrecision(options, integer) {
  if (integer) return 0;
  const precision = Number(options?.precision);
  if (Number.isInteger(precision) && precision >= 0 && precision <= 6) return precision;
  return 2;
}

function sheetCurrency(name, symbol, rate, actorPath, primary = false, options = {}) {
  const integer = options.integer !== false;
  const increment = Number(options.increment);
  return {
    name,
    symbol,
    rate,
    type: SHEET,
    actorPath,
    primary,
    icon: "",
    integer,
    precision: normalizePrecision(options, integer),
    ...(Number.isFinite(increment) && increment > 0 ? { increment } : {}),
  };
}

const BUILTIN_PRESETS = Object.freeze({
  dnd5e: Object.freeze({
    base: "cp",
    currencies: Object.freeze({
      pp: sheetCurrency("Platinum Pieces", "pp", 1000, "system.currency.pp"),
      gp: sheetCurrency("Gold Pieces",     "gp", 100,  "system.currency.gp", true),
      ep: sheetCurrency("Electrum Pieces", "ep", 50,   "system.currency.ep"),
      sp: sheetCurrency("Silver Pieces",   "sp", 10,   "system.currency.sp"),
      cp: sheetCurrency("Copper Pieces",   "cp", 1,    "system.currency.cp"),
    }),
  }),
  daggerheart: Object.freeze({
    base: "coins",
    currencies: Object.freeze({
      chests:   sheetCurrency("Chests",   "chests",   1000, "system.gold.chests"),
      bags:     sheetCurrency("Bags",     "bags",     100,  "system.gold.bags"),
      handfuls: sheetCurrency("Handfuls", "handfuls", 10,   "system.gold.handfuls", true),
      coins:    sheetCurrency("Coins",    "coins",    1,    "system.gold.coins"),
    }),
  }),
  "cosmere-rpg": Object.freeze({
    base: "spheres",
    currencies: Object.freeze({
      spheres: sheetCurrency("Spheres (Marks)", "mk", 1, "system.currency.spheres.total", true, { integer: false, precision: 1, increment: 0.2 }),
    }),
  }),
  pf1: Object.freeze({
    base: "cp",
    currencies: Object.freeze({
      pp: sheetCurrency("Platinum Pieces", "pp", 1000, "system.currency.pp"),
      gp: sheetCurrency("Gold Pieces",     "gp", 100,  "system.currency.gp", true),
      sp: sheetCurrency("Silver Pieces",   "sp", 10,   "system.currency.sp"),
      cp: sheetCurrency("Copper Pieces",   "cp", 1,    "system.currency.cp"),
    }),
  }),
  pf2e: Object.freeze({
    base: "cp",
    currencies: Object.freeze({
      pp: sheetCurrency("Platinum Pieces", "pp", 1000, "system.coins.pp.value"),
      gp: sheetCurrency("Gold Pieces",     "gp", 100,  "system.coins.gp.value", true),
      sp: sheetCurrency("Silver Pieces",   "sp", 10,   "system.coins.sp.value"),
      cp: sheetCurrency("Copper Pieces",   "cp", 1,    "system.coins.cp.value"),
    }),
  }),
  sf2e: Object.freeze({
    base: "credits",
    currencies: Object.freeze({
      credits: sheetCurrency("Credits",         "credits", 10,   "system.coins.credits.value", true),
      upb:     sheetCurrency("UPB",             "upb",     10,   "system.coins.upb.value"),
    }),
  }),
  sfrpg: Object.freeze({
    base: "credit",
    currencies: Object.freeze({
      credit: sheetCurrency("Credits", "credits", 1, "system.currency.credit", true),
      upb:    sheetCurrency("UPB",     "upb",     1, "system.currency.upb"),
    }),
  }),
  "cyberpunk-red-core": Object.freeze({
    base: "eb",
    currencies: Object.freeze({
      eb: sheetCurrency("Eurobucks", "eb", 1, "system.wealth.value", true),
    }),
  }),
  shadowrun5e: Object.freeze({
    base: "nuyen",
    currencies: Object.freeze({
      nuyen: sheetCurrency("Nuyen", "¥", 1, "system.nuyen", true),
    }),
  }),
  shadowrun: Object.freeze({
    base: "nuyen",
    currencies: Object.freeze({
      nuyen: sheetCurrency("Nuyen", "¥", 1, "system.nuyen", true),
    }),
  }),
  "shadowrun6-eden": Object.freeze({
    base: "nuyen",
    currencies: Object.freeze({
      nuyen: sheetCurrency("Nuyen", "¥", 1, "system.nuyen", true),
    }),
  }),
  projectfu: Object.freeze({
    base: "zenit",
    currencies: Object.freeze({
      zenit: sheetCurrency("Zenit", "z", 1, "system.resources.zenit.value", true),
    }),
  }),
  swade: Object.freeze({
    base: "currency",
    currencies: Object.freeze({
      currency: sheetCurrency("Currency", "$", 1, "system.details.currency", true, { integer: false, precision: 2 }),
    }),
  }),
  wfrp4e: Object.freeze({
    base: "bp",
    currencies: Object.freeze({
      gc: sheetCurrency("Gold Crowns",      "gc", 240, "itemTags.money.gc", true),
      ss: sheetCurrency("Silver Shillings", "ss", 12,  "itemTags.money.ss"),
      bp: sheetCurrency("Brass Pennies",    "bp", 1,   "itemTags.money.bp"),
    }),
  }),
});

const externalPresets = new Map();

function freezePreset(preset) {
  const currencies = preset?.currencies ?? {};
  const frozenCurrencies = {};
  for (const [id, c] of Object.entries(currencies)) {
    frozenCurrencies[id] = Object.freeze({ ...c });
  }
  return Object.freeze({
    base: preset.base ?? "",
    currencies: Object.freeze(frozenCurrencies),
  });
}

export function registerSystemPreset(systemId, preset) {
  if (typeof systemId !== "string" || !systemId) {
    throw new Error("registerSystemPreset: systemId must be a non-empty string");
  }
  if (!preset || typeof preset !== "object" || typeof preset.currencies !== "object") {
    throw new Error("registerSystemPreset: preset must include a 'currencies' object");
  }
  if (Object.hasOwn(BUILTIN_PRESETS, systemId)) {
    console.warn(`glitchsmith-lib | registerSystemPreset: overriding built-in preset for "${systemId}"`);
  }
  externalPresets.set(systemId, freezePreset(preset));
  return true;
}

export function getSystemPreset(systemId = game?.system?.id) {
  if (externalPresets.has(systemId)) return externalPresets.get(systemId);
  return BUILTIN_PRESETS[systemId] ?? null;
}

export function getRegisteredSystemIds() {
  return Array.from(new Set([
    ...Object.keys(BUILTIN_PRESETS),
    ...externalPresets.keys(),
  ]));
}

export const SYSTEM_PRESETS = BUILTIN_PRESETS;

export function buildSheetRowsFromPreset(systemId = game?.system?.id) {
  const preset = getSystemPreset(systemId);
  if (!preset) return [];
  return Object.entries(preset.currencies).map(([id, c]) => ({
    id,
    name: c.name,
    symbol: c.symbol,
    rate: c.rate,
    actorPath: c.actorPath,
    primary: !!c.primary,
    icon: c.icon ?? "",
    integer: c.integer !== false,
    precision: Number.isInteger(Number(c.precision)) ? Number(c.precision) : (c.integer === false ? 2 : 0),
    ...(Number.isFinite(Number(c.increment)) && Number(c.increment) > 0 ? { increment: Number(c.increment) } : {}),
  }));
}
