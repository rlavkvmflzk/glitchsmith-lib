import { CURRENCY_TYPES, SOURCES } from "../constants.js";
import { getDefinitions } from "./definitions.js";
import { getSystemPreset } from "./presets.js";
import { fireBalanceChanged } from "./hooks.js";

const sheetDrivers = new Map();

function getSystemId(systemId = game?.system?.id) {
  return typeof systemId === "string" && systemId ? systemId : game?.system?.id;
}

function inferIntegerMode(id, raw, systemId) {
  if (raw?.integer === false) return false;
  if (raw?.integer === true) return true;
  return !(systemId === "swade" && id === "currency" && raw?.actorPath === "system.details.currency");
}

function normalizeSheetCurrency(id, raw, systemId) {
  const integer = inferIntegerMode(id, raw, systemId);
  const precision = Number(raw?.precision);
  return {
    id,
    name: raw?.name ?? id,
    symbol: raw?.symbol ?? "",
    rate: Number.isFinite(Number(raw?.rate)) && Number(raw.rate) > 0 ? Number(raw.rate) : 1,
    type: CURRENCY_TYPES.SHEET,
    actorPath: typeof raw?.actorPath === "string" ? raw.actorPath : "",
    primary: !!raw?.primary,
    icon: typeof raw?.icon === "string" ? raw.icon : "",
    integer,
    precision: integer ? 0 : (Number.isInteger(precision) && precision >= 0 && precision <= 6 ? precision : 2),
  };
}

export function getSheetCurrencies(systemId = game?.system?.id) {
  const id = getSystemId(systemId);
  const defs = getDefinitions();
  const fromDefinitions = Object.entries(defs.currencies ?? {})
    .filter(([, def]) => def?.type === CURRENCY_TYPES.SHEET)
    .map(([currencyId, def]) => normalizeSheetCurrency(currencyId, def, id));

  if (fromDefinitions.length > 0) return fromDefinitions;

  const preset = getSystemPreset(id);
  if (!preset?.currencies) return [];
  return Object.entries(preset.currencies)
    .filter(([, def]) => def?.type === CURRENCY_TYPES.SHEET)
    .map(([currencyId, def]) => normalizeSheetCurrency(currencyId, def, id));
}

function getSheetCurrency(currencyId, systemId = game?.system?.id) {
  return getSheetCurrencies(systemId).find(c => c.id === currencyId) ?? null;
}

function getProperty(source, path) {
  if (!path) return undefined;
  return foundry.utils.getProperty(source, path);
}

function readPathValue(source, path) {
  const value = getProperty(source, path);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value === "object") {
    if (typeof value.value === "number" && Number.isFinite(value.value)) return value.value;
    if (typeof value.value === "string" && Number.isFinite(Number(value.value))) return Number(value.value);
  }
  return 0;
}

function roundDecimal(value, precision) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeBalance(value, def, label = "value") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be a finite number.`);
  }
  if (numeric < 0) {
    throw new Error(`${label} must not be negative.`);
  }
  if (def?.integer !== false) return Math.floor(numeric);
  return roundDecimal(numeric, def.precision ?? 2);
}

function getActorUuid(actor) {
  return actor?.uuid ?? (actor?.id ? `Actor.${actor.id}` : "");
}

async function resolveActor({ actorUuid, actorId } = {}) {
  let actor = null;
  if (actorUuid) actor = await fromUuid(actorUuid);
  if (!actor && actorId) actor = game.actors?.get(actorId);
  return actor;
}

const pathDriver = Object.freeze({
  readBalance(actor, currencyId, def) {
    if (!actor || !def?.actorPath) return 0;
    return readPathValue(actor, def.actorPath);
  },

  async setBalances(actor, targetBalancesById, defsById) {
    if (!actor) throw new Error("Actor not found.");
    const updates = {};
    for (const [currencyId, target] of Object.entries(targetBalancesById ?? {})) {
      const def = defsById[currencyId];
      if (!def) throw new Error(`Currency '${currencyId}' is not a sheet currency.`);
      if (!def.actorPath) throw new Error(`Currency '${currencyId}' has no actorPath.`);
      const current = this.readBalance(actor, currencyId, def);
      if (current !== target) updates[def.actorPath] = target;
    }
    if (Object.keys(updates).length > 0) {
      await actor.update(updates);
    }
  },
});

function hasCoinApi(actor) {
  return typeof actor?.inventory?.addCoins === "function"
    && typeof actor?.inventory?.removeCoins === "function";
}

const pf2eDriver = Object.freeze({
  readBalance(actor, currencyId, def) {
    if (!actor) return 0;
    const wallet = actor.inventory?.currency ?? actor.inventory?.coins;
    const id = String(currencyId ?? "").toLowerCase();
    if (typeof wallet?.[id] === "number") return wallet[id];
    if (typeof wallet?.[currencyId] === "number") return wallet[currencyId];
    return pathDriver.readBalance(actor, currencyId, def);
  },

  async setBalances(actor, targetBalancesById, defsById) {
    if (!hasCoinApi(actor)) {
      return pathDriver.setBalances(actor, targetBalancesById, defsById);
    }

    const snapshot = {};
    for (const [currencyId, target] of Object.entries(targetBalancesById ?? {})) {
      if (!defsById[currencyId]) throw new Error(`Currency '${currencyId}' is not a sheet currency.`);
      snapshot[currencyId] = this.readBalance(actor, currencyId, defsById[currencyId]);
      if (snapshot[currencyId] < 0 || target < 0) throw new Error("Invalid balance.");
    }

    for (const [currencyId, target] of Object.entries(targetBalancesById ?? {})) {
      const current = snapshot[currencyId] ?? 0;
      const delta = target - current;
      if (delta === 0) continue;

      const id = String(currencyId).toLowerCase();
      if (delta > 0) {
        await actor.inventory.addCoins({ [id]: delta });
      } else {
        const success = await actor.inventory.removeCoins({ [id]: -delta }, { byValue: false });
        if (success === false) throw new Error("Insufficient balance.");
      }
    }
  },
});

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return [];
}

function getMoneyItems(actor) {
  const tagged = actor?.itemTags?.money;
  if (Array.isArray(tagged)) return tagged;
  return collectionValues(actor?.items).filter(item => item?.type === "money");
}

function findWfrpMoneyItem(actor, currencyId, def) {
  const rate = Number(def?.rate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return getMoneyItems(actor).find(item => readPathValue(item, "system.coinValue.value") === rate) ?? null;
}

const wfrp4eDriver = Object.freeze({
  readBalance(actor, currencyId, def) {
    if (!actor) return 0;
    const item = findWfrpMoneyItem(actor, currencyId, def);
    return item ? readPathValue(item, "system.quantity.value") : 0;
  },

  async setBalances(actor, targetBalancesById, defsById) {
    if (!actor) throw new Error("Actor not found.");
    const updates = [];

    for (const [currencyId, target] of Object.entries(targetBalancesById ?? {})) {
      const def = defsById[currencyId];
      if (!def) throw new Error(`Currency '${currencyId}' is not a sheet currency.`);
      const item = findWfrpMoneyItem(actor, currencyId, def);
      if (!item) {
        if (target === 0) continue;
        throw new Error(`MISSING_MONEY_ITEM_${currencyId}`);
      }
      const current = this.readBalance(actor, currencyId, def);
      if (current === target) continue;
      const itemId = item.id ?? item._id;
      if (!itemId) throw new Error(`Missing money item id: ${currencyId}`);
      updates.push({ _id: itemId, "system.quantity.value": target });
    }

    if (updates.length > 0) {
      await actor.updateEmbeddedDocuments("Item", updates);
    }
  },
});

function getDriver(systemId = game?.system?.id) {
  const id = getSystemId(systemId);
  if (sheetDrivers.has(id)) return sheetDrivers.get(id);
  if (id === "pf2e" || id === "sf2e") return pf2eDriver;
  if (id === "wfrp4e") return wfrp4eDriver;
  return pathDriver;
}

function defsById(systemId = game?.system?.id) {
  return Object.fromEntries(getSheetCurrencies(systemId).map(def => [def.id, def]));
}

export function registerSheetCurrencyDriver(systemId, driver) {
  if (typeof systemId !== "string" || !systemId) {
    throw new Error("registerSheetCurrencyDriver: systemId must be a non-empty string.");
  }
  if (!driver || typeof driver !== "object") {
    throw new Error("registerSheetCurrencyDriver: driver must be an object.");
  }
  if (typeof driver.readBalance !== "function") {
    throw new Error("registerSheetCurrencyDriver: driver.readBalance is required.");
  }
  if (typeof driver.setBalances !== "function") {
    throw new Error("registerSheetCurrencyDriver: driver.setBalances is required.");
  }
  sheetDrivers.set(systemId, driver);
  return true;
}

export function getSheetBalance(actor, currencyId, systemId = game?.system?.id) {
  if (!actor || !currencyId) return 0;
  const def = getSheetCurrency(currencyId, systemId);
  if (!def) return 0;
  return getDriver(systemId).readBalance(actor, currencyId, def);
}

export async function writeSetSheetBalances({
  actorUuid,
  actorId,
  systemId,
  balancesById,
  source = SOURCES.UNKNOWN,
  reason = null,
} = {}) {
  const actor = await resolveActor({ actorUuid, actorId });
  if (!actor) return { success: false, error: "Actor not found." };
  if (!balancesById || typeof balancesById !== "object") {
    return { success: false, error: "balancesById must be an object." };
  }

  const id = getSystemId(systemId);
  const defs = defsById(id);
  const targets = {};
  const before = {};
  const after = {};

  try {
    for (const [currencyId, raw] of Object.entries(balancesById)) {
      const def = defs[currencyId];
      if (!def) throw new Error(`Currency '${currencyId}' is not a sheet currency.`);
      const target = normalizeBalance(raw, def, currencyId);
      targets[currencyId] = target;
      before[currencyId] = getDriver(id).readBalance(actor, currencyId, def);
      after[currencyId] = target;
    }

    await getDriver(id).setBalances(actor, targets, defs);
  } catch (err) {
    return { success: false, error: err?.message ?? String(err), before, after: before };
  }

  for (const [currencyId, target] of Object.entries(after)) {
    if (before[currencyId] !== target) {
      fireBalanceChanged({ actorId: actor.id, currencyId, before: before[currencyId], after: target, source, reason });
    }
  }

  return { success: true, before, after };
}

export async function writeSetSheetBalance(payload = {}) {
  if (!payload?.currencyId) {
    return { success: false, error: "currencyId is required." };
  }
  const result = await writeSetSheetBalances({
    ...payload,
    balancesById: { [payload.currencyId]: payload.value },
  });
  if (!result.success) return result;
  return {
    success: true,
    before: result.before[payload.currencyId] ?? 0,
    after: result.after[payload.currencyId] ?? 0,
  };
}

export async function writeModifySheetBalance({
  actorUuid,
  actorId,
  systemId,
  currencyId,
  delta,
  source = SOURCES.UNKNOWN,
  reason = null,
} = {}) {
  if (!currencyId) {
    return { success: false, error: "currencyId is required." };
  }
  const result = await writeModifySheetBalances({
    actorUuid,
    actorId,
    systemId,
    deltasById: { [currencyId]: delta },
    source,
    reason,
  });
  if (!result.success) {
    return {
      ...result,
      before: result.before?.[currencyId] ?? 0,
      after: result.after?.[currencyId] ?? result.before?.[currencyId] ?? 0,
    };
  }
  return {
    success: true,
    before: result.before[currencyId] ?? 0,
    after: result.after[currencyId] ?? 0,
  };
}

export async function writeModifySheetBalances({
  actorUuid,
  actorId,
  systemId,
  deltasById,
  source = SOURCES.UNKNOWN,
  reason = null,
} = {}) {
  const actor = await resolveActor({ actorUuid, actorId });
  if (!actor) return { success: false, error: "Actor not found." };
  if (!deltasById || typeof deltasById !== "object") {
    return { success: false, error: "deltasById must be an object." };
  }

  const id = getSystemId(systemId);
  const defs = defsById(id);
  const before = {};
  const after = {};

  try {
    for (const [currencyId, rawDelta] of Object.entries(deltasById)) {
      const def = defs[currencyId];
      if (!def) throw new Error(`Currency '${currencyId}' is not a sheet currency.`);
      const numericDelta = Number(rawDelta);
      if (!Number.isFinite(numericDelta)) throw new Error(`${currencyId} delta must be a finite number.`);
      const current = getDriver(id).readBalance(actor, currencyId, def);
      const rawNext = current + numericDelta;
      if (rawNext < 0) throw new Error("Insufficient balance.");
      const next = normalizeBalance(rawNext, def, currencyId);
      before[currencyId] = current;
      after[currencyId] = next;
    }
  } catch (err) {
    return { success: false, error: err?.message ?? String(err), before, after: before };
  }

  const result = await writeSetSheetBalances({
    actorUuid,
    actorId,
    systemId: id,
    balancesById: after,
    source,
    reason,
  });
  if (!result.success) {
    return { ...result, before, after: before };
  }
  return result;
}

export function buildActorPayload(actor, options = {}) {
  return {
    actorUuid: getActorUuid(actor),
    actorId: actor?.id ?? "",
    systemId: options.systemId ?? game?.system?.id,
  };
}
