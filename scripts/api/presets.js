import { CURRENCY_TYPES } from "../constants.js";

const SHEET = CURRENCY_TYPES.SHEET;

function sheetCurrency(name, symbol, rate, actorPath, primary = false) {
  return {
    name,
    symbol,
    rate,
    type: SHEET,
    actorPath,
    primary,
    icon: "",
  };
}

export const SYSTEM_PRESETS = Object.freeze({
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
  wfrp4e: Object.freeze({
    base: "bp",
    currencies: Object.freeze({
      gc: sheetCurrency("Gold Crowns",      "gc", 240, "itemTags.money.gc", true),
      ss: sheetCurrency("Silver Shillings", "ss", 12,  "itemTags.money.ss"),
      bp: sheetCurrency("Brass Pennies",    "bp", 1,   "itemTags.money.bp"),
    }),
  }),
});

export function getSystemPreset(systemId = game?.system?.id) {
  return SYSTEM_PRESETS[systemId] ?? null;
}

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
  }));
}
