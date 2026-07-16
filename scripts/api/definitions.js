import {
  SETTING_KEYS,
  DEFAULT_DEFINITIONS,
  CURRENCY_TYPES,
} from "../constants.js";
import { getSetting, setSetting } from "../settings/index.js";
import { fireDefinitionsChanged } from "./hooks.js";

function clone(value) {
  return foundry.utils.deepClone(value);
}

function normalizeIntegerMode(raw) {
  if (raw?.integer === false || raw?.allowDecimals === true || raw?.decimal === true) return false;
  return true;
}

function normalizePrecision(raw, integer) {
  if (integer) return 0;
  const precision = Number(raw?.precision);
  if (Number.isInteger(precision) && precision >= 0 && precision <= 6) return precision;
  return 2;
}

function normalizeEmbeddedItemStorage(raw, currencyId) {
  if (!raw || raw.type !== "embeddedItem") return null;

  const itemType = typeof raw.itemType === "string" ? raw.itemType.trim() : "";
  const quantityPath = typeof raw.quantityPath === "string" ? raw.quantityPath.trim() : "";
  const createFromUuid = typeof raw.createFromUuid === "string" ? raw.createFromUuid.trim() : "";
  const filters = Array.isArray(raw.filters)
    ? raw.filters
      .map(filter => ({
        path: typeof filter?.path === "string" ? filter.path.trim() : "",
        equals: typeof filter?.equals === "string" ? filter.equals.trim() : filter?.equals,
      }))
      .filter(filter => filter.path)
    : [];

  if (!quantityPath) {
    throw new Error(`Currency '${currencyId}' embedded item storage requires quantityPath.`);
  }
  if (!itemType && filters.length === 0) {
    throw new Error(`Currency '${currencyId}' embedded item storage requires itemType or filters.`);
  }

  return {
    type: "embeddedItem",
    ...(itemType ? { itemType } : {}),
    filters,
    quantityPath,
    ...(createFromUuid ? { createFromUuid } : {}),
  };
}

function emptyDefinitions() {
  return clone(DEFAULT_DEFINITIONS);
}

export function getDefinitions() {
  const stored = getSetting(SETTING_KEYS.CURRENCY_DEFINITIONS);
  if (!stored || typeof stored !== "object") return emptyDefinitions();
  return {
    base: typeof stored.base === "string" ? stored.base : "",
    currencies: stored.currencies && typeof stored.currencies === "object"
      ? clone(stored.currencies)
      : {},
  };
}

export function getCurrency(currencyId) {
  const defs = getDefinitions();
  return defs.currencies[currencyId] ?? null;
}

export function hasCurrency(currencyId) {
  return getCurrency(currencyId) !== null;
}

export function getCurrencyIds() {
  return Object.keys(getDefinitions().currencies);
}

export function getVirtualCurrencyIds() {
  const defs = getDefinitions();
  return Object.entries(defs.currencies)
    .filter(([, def]) => def.type === CURRENCY_TYPES.VIRTUAL)
    .map(([id]) => id);
}

function normalizeDefinitions(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("Definitions must be an object.");
  }
  const base = typeof input.base === "string" ? input.base.trim() : "";

  const currencies = {};
  const rawCurrencies = input.currencies ?? {};
  if (typeof rawCurrencies !== "object") {
    throw new TypeError("Definitions.currencies must be an object.");
  }

  for (const [id, raw] of Object.entries(rawCurrencies)) {
    if (!id || typeof id !== "string") {
      throw new Error(`Invalid currency id: ${id}`);
    }
    const rate = Number(raw?.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Currency '${id}' rate must be a positive number.`);
    }
    const type = raw?.type === CURRENCY_TYPES.SHEET
      ? CURRENCY_TYPES.SHEET
      : CURRENCY_TYPES.VIRTUAL;
    const integer = normalizeIntegerMode(raw);
    const increment = Number(raw?.increment);
    const storage = type === CURRENCY_TYPES.SHEET
      ? normalizeEmbeddedItemStorage(raw?.storage, id)
      : null;

    currencies[id] = {
      name: typeof raw?.name === "string" ? raw.name : id,
      rate,
      symbol: typeof raw?.symbol === "string" ? raw.symbol : "",
      type,
      actorPath: type === CURRENCY_TYPES.SHEET && typeof raw?.actorPath === "string"
        ? raw.actorPath
        : "",
      primary: !!raw?.primary,
      icon: typeof raw?.icon === "string" ? raw.icon : "",
      integer,
      precision: normalizePrecision(raw, integer),
      ...(Number.isFinite(increment) && increment > 0 ? { increment } : {}),
      ...(storage ? { storage } : {}),
    };
  }

  if (Object.keys(currencies).length === 0) {
    return { base: "", currencies: {} };
  }

  if (!base) throw new Error("Definitions.base is required.");
  if (!currencies[base]) {
    throw new Error(`Base unit '${base}' is not present in currencies.`);
  }

  return { base, currencies };
}

export async function writeDefinitions(input, { source, reason } = {}) {
  const before = getDefinitions();
  const after = normalizeDefinitions(input);
  await setSetting(SETTING_KEYS.CURRENCY_DEFINITIONS, after);
  fireDefinitionsChanged({ before, after, source, reason });
  return { success: true, before, after };
}
