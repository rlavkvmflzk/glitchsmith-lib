import { CURRENCY_TYPES, SOURCES } from "../constants.js";
import { getDefinitions } from "./definitions.js";
import { getSystemPreset } from "./presets.js";
import { fireBalanceChanged } from "./hooks.js";
import { getCurrencyIncrement } from "./exchange-math.js";

const sheetDrivers = new Map();

function getSystemId(systemId = game?.system?.id) {
  return typeof systemId === "string" && systemId ? systemId : game?.system?.id;
}

function inferIntegerMode(id, raw, systemId) {
  if (raw?.integer === false) return false;
  if (raw?.integer === true) return true;
  return !(systemId === "swade" && id === "currency" && raw?.actorPath === "system.details.currency");
}

function normalizeEmbeddedItemStorage(raw) {
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

  if (!quantityPath || (!itemType && filters.length === 0)) return null;
  return {
    type: "embeddedItem",
    ...(itemType ? { itemType } : {}),
    filters,
    quantityPath,
    ...(createFromUuid ? { createFromUuid } : {}),
  };
}

function getEmbeddedItemStorage(def) {
  return def?.storage?.type === "embeddedItem" ? def.storage : null;
}

function normalizeSheetCurrency(id, raw, systemId) {
  const integer = inferIntegerMode(id, raw, systemId);
  const precision = Number(raw?.precision);
  const increment = Number(raw?.increment);
  const storage = normalizeEmbeddedItemStorage(raw?.storage);
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
    ...(Number.isFinite(increment) && increment > 0 ? { increment } : {}),
    ...(storage ? { storage } : {}),
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

function amountMatchesIncrement(value, def) {
  const increment = getCurrencyIncrement(def);
  const scaled = Number(value) / increment;
  if (!Number.isFinite(scaled) || Math.abs(scaled) > Number.MAX_SAFE_INTEGER) return false;
  if (value !== 0) {
    const spacing = 2 ** (Math.floor(Math.log2(Math.abs(value))) - 52);
    if (!Number.isFinite(spacing) || spacing > increment / 2) return false;
  }
  const nearest = Math.round(scaled);
  const tolerance = Math.min(
    1e-9,
    Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8
  );
  return Math.abs(scaled - nearest) <= tolerance;
}

function deltaMatchesIncrement(actual, expected, def) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  const increment = getCurrencyIncrement(def);
  const tolerance = Math.min(
    Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected)) * 16,
    increment * 1e-6
  );
  return Math.abs(actual - expected) <= tolerance;
}

function codedError(errorCode, message) {
  const error = new Error(message);
  error.errorCode = errorCode;
  return error;
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

function canRequesterMutateActor(actor, requesterId) {
  const requester = requesterId ? game.users?.get(requesterId) : game.user;
  if (!actor || !requester) return false;
  if (requester.isGM) return true;
  if (typeof actor.testUserPermission !== "function") return false;
  return actor.testUserPermission(requester, "OWNER");
}

function assertSheetCurrencyWritePermission(actor, requesterId) {
  if (!canRequesterMutateActor(actor, requesterId)) {
    throw new Error("Permission denied.");
  }
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

function valuesMatch(actual, expected) {
  if (typeof expected === "string") {
    if (actual === undefined || actual === null) return expected === "";
    return String(actual) === expected;
  }
  return actual === expected;
}

function matchesEmbeddedItemFilter(item, filter) {
  return valuesMatch(getProperty(item, filter.path), filter.equals);
}

function findEmbeddedCurrencyItem(actor, def) {
  const storage = getEmbeddedItemStorage(def);
  if (!storage) return null;

  return collectionValues(actor?.items).find(item => {
    if (storage.itemType && item?.type !== storage.itemType) return false;
    return storage.filters.every(filter => matchesEmbeddedItemFilter(item, filter));
  }) ?? null;
}

export function matchEmbeddedItemForActor(actor, storageRaw) {
  const storage = normalizeEmbeddedItemStorage(storageRaw);
  if (!storage || !actor) return { storage, item: null, quantity: 0 };
  const item = findEmbeddedCurrencyItem(actor, { storage });
  return {
    storage,
    item: item ?? null,
    quantity: item ? readPathValue(item, storage.quantityPath) : 0,
  };
}

async function createEmbeddedCurrencyItem(actor, currencyId, storage, target) {
  if (!storage.createFromUuid) throw new Error(`MISSING_CURRENCY_ITEM_${currencyId}`);

  const source = await fromUuid(storage.createFromUuid);
  if (!source || typeof source.toObject !== "function") {
    throw new Error(`Invalid createFromUuid for currency '${currencyId}'.`);
  }

  const data = source.toObject();
  delete data._id;
  foundry.utils.setProperty(data, storage.quantityPath, target);
  await actor.createEmbeddedDocuments("Item", [data]);
}

const embeddedItemDriver = Object.freeze({
  readBalance(actor, currencyId, def) {
    if (!actor) return 0;
    const storage = getEmbeddedItemStorage(def);
    if (!storage) return pathDriver.readBalance(actor, currencyId, def);
    const item = findEmbeddedCurrencyItem(actor, def);
    return item ? readPathValue(item, storage.quantityPath) : 0;
  },

  async setBalances(actor, targetBalancesById, defsById) {
    if (!actor) throw new Error("Actor not found.");
    const updates = [];

    for (const [currencyId, target] of Object.entries(targetBalancesById ?? {})) {
      const def = defsById[currencyId];
      if (!def) throw new Error(`Currency '${currencyId}' is not a sheet currency.`);

      const storage = getEmbeddedItemStorage(def);
      if (!storage) throw new Error(`Currency '${currencyId}' is not an embedded item currency.`);

      const item = findEmbeddedCurrencyItem(actor, def);
      if (!item) {
        if (target === 0) continue;
        await createEmbeddedCurrencyItem(actor, currencyId, storage, target);
        continue;
      }

      const current = this.readBalance(actor, currencyId, def);
      if (current === target) continue;

      const itemId = getItemId(item);
      if (!itemId) throw new Error(`Missing embedded item id: ${currencyId}`);
      updates.push({ _id: itemId, [storage.quantityPath]: target });
    }

    if (updates.length > 0) {
      await actor.updateEmbeddedDocuments("Item", updates);
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

const COSMERE_MONEY_DENOMINATIONS = Object.freeze([
  { name: "Emerald Broam",    value: 200, img: "systems/cosmere-rpg/assets/icons/stormlight/items/spheres/sphere_emerald_broam.webp" },
  { name: "Amethyst Broam",   value: 100, img: "systems/cosmere-rpg/assets/icons/stormlight/items/spheres/sphere_amethyst_broam.webp" },
  { name: "Sapphire Broam",   value: 100, img: "systems/cosmere-rpg/assets/icons/stormlight/items/spheres/sphere_sapphire_broam.webp" },
  { name: "Ruby Broam",       value: 40,  img: "systems/cosmere-rpg/assets/icons/stormlight/items/spheres/sphere_ruby_broam.webp" },
  { name: "Smokestone Broam", value: 40,  img: "systems/cosmere-rpg/assets/icons/stormlight/items/spheres/sphere_smokestone_broam.webp" },
  { name: "Zircon Broam",     value: 40,  img: "systems/cosmere-rpg/assets/icons/stormlight/items/spheres/sphere_zircon_broam.webp" },
  { name: "Garnet Broam",     value: 20,  img: "systems/cosmere-rpg/assets/icons/stormlight/items/spheres/sphere_garnet_broam.webp" },
  { name: "Heliodor Broam",   value: 20,  img: "systems/cosmere-rpg/assets/icons/stormlight/items/spheres/sphere_heliodor_broam.webp" },
  { name: "Topaz Broam",      value: 20,  img: "systems/cosmere-rpg/assets/icons/stormlight/items/spheres/sphere_topaz_broam.webp" },
  { name: "Diamond Broam",    value: 4,   img: "systems/cosmere-rpg/assets/icons/stormlight/items/spheres/sphere_diamond_broam.webp" },
  { name: "Diamond Mark",     value: 1,   img: "systems/cosmere-rpg/assets/icons/stormlight/items/spheres/sphere_diamond_mark.webp" },
  { name: "Diamond Chip",     value: 0.2, img: "systems/cosmere-rpg/assets/icons/stormlight/items/spheres/sphere_diamond_chip.webp" },
]);

function isCosmereMoneyItem(item) {
  return item?.type === "loot"
    && item?.system?.isMoney === true
    && item?.system?.price?.currency === "spheres";
}

function getCosmereMoneyValue(item) {
  const base = readPathValue(item, "system.price.baseValue");
  if (base > 0) return base;
  return readPathValue(item, "system.price.value");
}

function getCosmereMoneyItems(actor) {
  return collectionValues(actor?.items).filter(isCosmereMoneyItem);
}

function getItemId(item) {
  return item?.id ?? item?._id ?? null;
}

function toCosmereChipUnits(value) {
  const chips = Math.round(Number(value) * 5);
  if (!Number.isInteger(chips) || Math.abs((chips / 5) - Number(value)) > 0.000001) {
    throw new Error("Cosmere sphere balances must be divisible by 0.2 marks.");
  }
  return chips;
}

function buildCosmereMoneyItem(denom, quantity) {
  return {
    name: denom.name,
    type: "loot",
    img: denom.img,
    system: {
      isMoney: true,
      description: { value: "", chat: "", short: "" },
      weight: { value: 0, unit: "lb" },
      price: {
        value: denom.value,
        currency: "spheres",
        denomination: { primary: "mark", secondary: "none" },
        unit: "spheres.mark",
      },
      quantity,
      events: {},
    },
    effects: [],
    flags: { "glitchsmith-lib": { cosmereMoney: true } },
  };
}

function decomposeCosmereMoney(target) {
  let remaining = toCosmereChipUnits(target);
  const out = new Map();
  for (const denom of COSMERE_MONEY_DENOMINATIONS) {
    const units = toCosmereChipUnits(denom.value);
    const quantity = Math.floor(remaining / units);
    if (quantity > 0) {
      out.set(denom.value, { denom, quantity });
      remaining -= quantity * units;
    }
  }
  if (remaining !== 0) throw new Error("Unable to decompose Cosmere sphere balance.");
  return out;
}

const cosmereRpgDriver = Object.freeze({
  readBalance(actor, currencyId, def) {
    if (!actor || currencyId !== "spheres") return pathDriver.readBalance(actor, currencyId, def);
    const total = getCosmereMoneyItems(actor).reduce((sum, item) => {
      const quantity = readPathValue(item, "system.quantity");
      return sum + (getCosmereMoneyValue(item) * quantity);
    }, 0);
    return roundDecimal(total, def?.precision ?? 1);
  },

  async setBalances(actor, targetBalancesById, defsById) {
    if (!actor) throw new Error("Actor not found.");
    if (!Object.hasOwn(targetBalancesById ?? {}, "spheres")) return;
    if (!defsById.spheres) throw new Error("Currency 'spheres' is not a sheet currency.");

    const target = Number(targetBalancesById.spheres);
    if (!Number.isFinite(target) || target < 0) throw new Error("Invalid Cosmere sphere balance.");

    const desired = decomposeCosmereMoney(target);
    const existing = getCosmereMoneyItems(actor);
    const byValue = new Map();
    const deleteIds = [];

    for (const item of existing) {
      const id = getItemId(item);
      if (!id) continue;
      const value = roundDecimal(getCosmereMoneyValue(item), 1);
      const desiredEntry = desired.get(value);
      if (!desiredEntry) {
        deleteIds.push(id);
        continue;
      }
      if (!byValue.has(value)) byValue.set(value, item);
      else deleteIds.push(id);
    }

    const updates = [];
    const creates = [];
    for (const [value, entry] of desired) {
      const item = byValue.get(value);
      if (!item) {
        creates.push(buildCosmereMoneyItem(entry.denom, entry.quantity));
        continue;
      }
      const id = getItemId(item);
      if (!id) continue;
      if (readPathValue(item, "system.quantity") !== entry.quantity) {
        updates.push({ _id: id, "system.quantity": entry.quantity });
      }
    }

    if (deleteIds.length > 0) await actor.deleteEmbeddedDocuments("Item", deleteIds);
    if (updates.length > 0) await actor.updateEmbeddedDocuments("Item", updates);
    if (creates.length > 0) await actor.createEmbeddedDocuments("Item", creates);
  },
});

function getDriver(systemId = game?.system?.id) {
  const id = getSystemId(systemId);
  if (sheetDrivers.has(id)) return sheetDrivers.get(id);
  if (id === "pf2e" || id === "sf2e") return pf2eDriver;
  if (id === "wfrp4e") return wfrp4eDriver;
  if (id === "cosmere-rpg") return cosmereRpgDriver;
  return pathDriver;
}

function getDriverForDef(systemId, def) {
  if (getEmbeddedItemStorage(def)) return embeddedItemDriver;
  return getDriver(systemId);
}

function groupBalancesByDriver(systemId, balancesById, defs) {
  const groups = new Map();
  for (const currencyId of Object.keys(balancesById ?? {})) {
    const driver = getDriverForDef(systemId, defs[currencyId]);
    if (!groups.has(driver)) groups.set(driver, {});
    groups.get(driver)[currencyId] = balancesById[currencyId];
  }
  return groups;
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
  return getDriverForDef(systemId, def).readBalance(actor, currencyId, def);
}

export function supportsAtomicSheetExchange(currencyIds, systemId = game?.system?.id) {
  const id = getSystemId(systemId);
  const defs = defsById(id);
  const ids = Array.isArray(currencyIds) ? currencyIds : [];
  if (ids.length < 2) return false;
  const actorPaths = [];
  const supported = ids.every(currencyId => {
    const def = defs[currencyId];
    if (!def || getDriverForDef(id, def) !== pathDriver) return false;
    const rawActorPath = typeof def.actorPath === "string" ? def.actorPath : "";
    const actorPath = rawActorPath.trim();
    if (!actorPath || actorPath !== rawActorPath) return false;
    actorPaths.push(actorPath);
    return true;
  });
  if (!supported || new Set(actorPaths).size !== actorPaths.length) return false;
  return actorPaths.every((path, index) => actorPaths.every((other, otherIndex) => (
    index === otherIndex
    || (!path.startsWith(`${other}.`) && !other.startsWith(`${path}.`))
  )));
}

export async function writeSetSheetBalances({
  actorUuid,
  actorId,
  systemId,
  balancesById,
  source = SOURCES.UNKNOWN,
  reason = null,
  requesterId,
  expectedBeforeById = null,
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
    assertSheetCurrencyWritePermission(actor, requesterId);
    for (const [currencyId, raw] of Object.entries(balancesById)) {
      const def = defs[currencyId];
      if (!def) throw new Error(`Currency '${currencyId}' is not a sheet currency.`);
      const target = normalizeBalance(raw, def, currencyId);
      const driver = getDriverForDef(id, def);
      const current = driver.readBalance(actor, currencyId, def);
      if (expectedBeforeById
        && Object.prototype.hasOwnProperty.call(expectedBeforeById, currencyId)
        && current !== expectedBeforeById[currencyId]) {
        throw codedError(
          "BALANCE_CHANGED",
          `Currency '${currencyId}' balance changed before the update could be committed.`
        );
      }
      targets[currencyId] = target;
      before[currencyId] = current;
      after[currencyId] = target;
    }

    for (const [driver, driverTargets] of groupBalancesByDriver(id, targets, defs)) {
      await driver.setBalances(actor, driverTargets, defs);
    }
  } catch (err) {
    return {
      success: false,
      ...(err?.errorCode ? { errorCode: err.errorCode } : {}),
      error: err?.message ?? String(err),
      before,
      after: before,
    };
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
  requesterId,
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
    requesterId,
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
  requesterId,
  requireExactDeltas = false,
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
    assertSheetCurrencyWritePermission(actor, requesterId);
    for (const [currencyId, rawDelta] of Object.entries(deltasById)) {
      const def = defs[currencyId];
      if (!def) throw new Error(`Currency '${currencyId}' is not a sheet currency.`);
      const numericDelta = Number(rawDelta);
      if (!Number.isFinite(numericDelta)) throw new Error(`${currencyId} delta must be a finite number.`);
      const current = getDriverForDef(id, def).readBalance(actor, currencyId, def);
      const rawNext = current + numericDelta;
      if (rawNext < 0) throw new Error("Insufficient balance.");
      const next = normalizeBalance(rawNext, def, currencyId);
      if (requireExactDeltas) {
        if (!amountMatchesIncrement(current, def)) {
          throw codedError(
            "INVALID_SHEET_BALANCE",
            `Currency '${currencyId}' balance does not match its configured increment.`
          );
        }
        if (!amountMatchesIncrement(numericDelta, def)
          || !amountMatchesIncrement(next, def)
          || !deltaMatchesIncrement(next - current, numericDelta, def)) {
          throw codedError(
            "AMOUNT_NORMALIZATION_MISMATCH",
            `Currency '${currencyId}' delta cannot be applied exactly at its configured increment.`
          );
        }
      }
      before[currencyId] = current;
      after[currencyId] = next;
    }
  } catch (err) {
    return {
      success: false,
      ...(err?.errorCode ? { errorCode: err.errorCode } : {}),
      error: err?.message ?? String(err),
      before,
      after: before,
    };
  }

  const result = await writeSetSheetBalances({
    actorUuid,
    actorId,
    systemId: id,
    balancesById: after,
    source,
    reason,
    requesterId,
    expectedBeforeById: before,
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
