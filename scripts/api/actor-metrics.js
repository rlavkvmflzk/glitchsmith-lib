import {
  ACTOR_METRIC_PROVIDER_IDS,
  ACTOR_METRIC_READ_MODES,
  MODULE_ID,
} from "../constants.js";

const GENERIC_SYSTEM_ID = "generic";
const MAX_DISCOVERED_METRICS = 500;
const MAX_DISCOVERY_DEPTH = 6;
const BLOCKED_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const VALUE_KEYS = Object.freeze([
  "value",
  "total",
  "current",
  "amount",
  "points",
  "remaining",
  "derived",
  "override",
  "base",
  "speed",
  "walk",
  "run",
  "modifier",
  "mod",
  "bonus",
  "rank",
  "level",
]);
const TYPED_VALUE_KEYS = Object.freeze([
  "total",
  "value",
  "current",
  "amount",
  "points",
  "used",
  "remaining",
  "speed",
  "base",
  "walk",
  "run",
  "modifier",
  "mod",
  "bonus",
  "rank",
  "level",
]);
const MAX_KEYS = Object.freeze(["max", "cap", "limit", "maximum"]);
const TYPED_ENTRY_KEYS = Object.freeze([
  "type",
  "slug",
  "id",
  "key",
  "name",
  "label",
  "short",
  "code",
  "abbreviation",
]);

/**
 * Providers are synchronous and may implement any of these methods:
 * - read(actor, definitions, context)
 * - defaults(actor, context)
 * - discover(actor, context)
 *
 * Public results are reduced to JSON-safe metric and definition fields. A
 * provider that needs opaque input definition fields can opt into receiving
 * shallow copies with preserveDefinitionFields at registration time.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isObject = value => value !== null && typeof value === "object";
const isScalar = value => value === null
  || typeof value === "string"
  || typeof value === "number"
  || typeof value === "boolean";

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized || fallback;
}

function toFiniteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function unwrapNumber(value, keys = VALUE_KEYS, depth = 0) {
  const direct = toFiniteNumber(value);
  if (direct !== undefined) return direct;
  if (!isObject(value) || depth > 2) return undefined;

  for (const key of keys) {
    const resolved = unwrapNumber(value[key], keys, depth + 1);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

function normalizeMetricValue(value, fallback = 0) {
  if (typeof value === "boolean") return value;
  const numeric = toFiniteNumber(value);
  if (numeric !== undefined) return numeric;
  if (typeof value === "string") return value;
  const unwrapped = unwrapNumber(value);
  return unwrapped ?? fallback;
}

function getPropertyFallback(object, path) {
  if (!path) return object;
  const segments = String(path).split(".").filter(Boolean);
  let current = object;

  for (const segment of segments) {
    if (BLOCKED_PATH_SEGMENTS.has(segment) || current == null) return undefined;
    if (current instanceof Map) {
      current = current.get(segment);
      continue;
    }
    if (typeof current.get === "function" && !Object.prototype.hasOwnProperty.call(current, segment)) {
      const entry = current.get(segment);
      if (entry !== undefined) {
        current = entry;
        continue;
      }
    }
    current = current[segment];
  }
  return current;
}

function getProperty(object, path) {
  if (!path) return object;
  const foundryGetProperty = globalThis.foundry?.utils?.getProperty;
  if (typeof foundryGetProperty === "function") {
    try {
      const value = foundryGetProperty(object, path);
      if (value !== undefined) return value;
    } catch (error) {
      console.warn(`${MODULE_ID} | Actor metric path lookup failed for '${path}'.`, error);
    }
  }
  return getPropertyFallback(object, path);
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") {
    try {
      return Array.from(collection.values());
    } catch (_error) {
      return [];
    }
  }
  if (typeof collection[Symbol.iterator] === "function" && typeof collection !== "string") {
    try {
      return Array.from(collection);
    } catch (_error) {
      return [];
    }
  }
  return Object.values(collection);
}

function collectionGet(collection, id) {
  if (!collection || !id) return null;
  if (typeof collection.get === "function") return collection.get(id) ?? null;
  return collectionValues(collection).find(entry => entry?.id === id || entry?._id === id) ?? null;
}

function normalizeTypedToken(value) {
  return normalizeText(String(value ?? ""))
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function getTypedEntryKey(entry) {
  for (const key of TYPED_ENTRY_KEYS) {
    const candidate = entry?.[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}

function resolveTypedArrayValue(actor, path) {
  const segments = normalizeText(path).split(".");
  if (segments.length < 2) return null;
  const token = normalizeTypedToken(segments.pop());
  const collection = getProperty(actor, segments.join("."));
  if (!token || !Array.isArray(collection)) return null;

  const entry = collection.find(candidate => normalizeTypedToken(getTypedEntryKey(candidate)) === token);
  if (!entry) return null;
  const value = unwrapNumber(entry, TYPED_VALUE_KEYS);
  const max = unwrapNumber(entry, MAX_KEYS);
  if (value === undefined && max === undefined) return null;
  return { value: value ?? 0, max: max ?? 0 };
}

function resolveConfiguredNumber(actor, configuredPath) {
  const direct = toFiniteNumber(configuredPath);
  if (direct !== undefined) return direct;
  const path = normalizeText(configuredPath);
  if (!path) return undefined;
  const normalizedPath = path.startsWith("@") ? path.slice(1) : path;
  const configured = getProperty(actor, normalizedPath);
  return unwrapNumber(configured) ?? unwrapNumber(configured, MAX_KEYS);
}

function findCombatant(actor) {
  const combatants = collectionValues(globalThis.game?.combat?.combatants);
  return combatants.find(combatant => combatant?.actorId === actor?.id
    || combatant?.actor?.id === actor?.id) ?? null;
}

function resolveItemPath(actor, path) {
  const parts = normalizeText(path).split(".");
  if (parts[0] !== "items" || parts.length < 3) return null;
  const item = collectionGet(actor?.items, parts[1]);
  if (!item) return { found: false, value: undefined, max: undefined, temp: undefined };

  const property = parts[2];
  if (property === "uses") {
    const uses = item.system?.uses ?? item.uses;
    const nestedPath = parts.slice(3).join(".");
    if (nestedPath) {
      return { found: true, value: getProperty(uses, nestedPath), max: undefined, temp: undefined };
    }
    return {
      found: true,
      value: uses?.value ?? uses?.remaining ?? uses?.current ?? 0,
      max: unwrapNumber(uses, MAX_KEYS) ?? 0,
      temp: 0,
    };
  }
  if (property === "quantity") {
    return {
      found: true,
      value: item.system?.quantity ?? item.quantity ?? 0,
      max: 0,
      temp: 0,
    };
  }

  const value = getProperty(item, parts.slice(2).join("."));
  return { found: value !== undefined, value, max: undefined, temp: undefined };
}

function inferSemantic(path) {
  const normalized = normalizeText(path).toLowerCase();
  if (!normalized) return "resource";
  if (/(^|\.)(hp|health|hitpoints?)(\.|$)/.test(normalized)) {
    if (/(^|\.)temp(orary)?(\.|$)/.test(normalized)) return "temporary-health";
    if (normalized.includes("shield")) return "shield";
    return "health";
  }
  if (normalized.includes("shield")) return "shield";
  if (/(^|\.)(ac|armorclass)(\.|$)/.test(normalized)) return "armor";
  if (normalized.includes("inspiration")) return "inspiration";
  if (/heropoints?|hero-points?/.test(normalized)) return "hero-points";
  if (normalized.includes("initiative")) return "initiative";
  if (normalized.includes("perception")) return "perception";
  if (normalized.includes("exhaustion")) return "exhaustion";
  if (/(^|\.)(speed|movement)(\.|$)/.test(normalized)) return "speed";
  if (/(^|\.)(xp|experience)(\.|$)/.test(normalized)) return "experience";
  if (/(^|\.)(focus)(\.|$)/.test(normalized)) return "focus";
  if (/(classdc|spell\.dc|\.dc$)/.test(normalized)) return "difficulty-class";
  return "resource";
}

function readableLabel(path) {
  const segments = normalizeText(path).split(".").filter(Boolean);
  let key = segments.at(-1) ?? "Resource";
  if (key === "value" && segments.length > 1) key = segments.at(-2);
  return String(key)
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function normalizeDefinition(input, index = 0) {
  const raw = typeof input === "string" ? { path: input } : input;
  if (!isObject(raw)) return null;
  const path = normalizeText(raw.path);
  if (!path) return null;
  const semantic = normalizeText(raw.semantic, inferSemantic(path));
  const id = normalizeText(raw.id, path || `${semantic}-${index}`);
  const definition = {
    id,
    path,
    label: normalizeText(raw.label, readableLabel(path)),
    semantic,
  };

  const readMode = normalizeText(raw.readMode).toLowerCase();
  if (Object.values(ACTOR_METRIC_READ_MODES).includes(readMode)) {
    definition.readMode = readMode;
  }

  const maxPath = toFiniteNumber(raw.maxPath) !== undefined
    ? String(raw.maxPath)
    : normalizeText(raw.maxPath);
  const tempPath = toFiniteNumber(raw.tempPath) !== undefined
    ? String(raw.tempPath)
    : normalizeText(raw.tempPath);
  if (maxPath) definition.maxPath = maxPath;
  if (tempPath) definition.tempPath = tempPath;
  return definition;
}

function normalizeDefinitions(definitions, { dedupe = true } = {}) {
  if (!Array.isArray(definitions)) return [];
  const normalized = [];
  const seen = new Set();
  const usedIds = new Map();
  definitions.forEach((definition, index) => {
    const entry = normalizeDefinition(definition, index);
    if (!entry) return;
    const key = `${entry.id}\u0000${entry.path}`;
    if (dedupe && seen.has(key)) return;
    seen.add(key);
    const idCount = usedIds.get(entry.id) ?? 0;
    usedIds.set(entry.id, idCount + 1);
    if (!dedupe && idCount > 0) entry.id = `${entry.id}#${idCount + 1}`;
    normalized.push(entry);
  });
  return normalized;
}

function readGenericDefinition(actor, definition) {
  if (definition.path === "combat.initiative") {
    const initiative = findCombatant(actor)?.initiative;
    return {
      ...definition,
      value: Number.isFinite(initiative) ? initiative : "—",
      max: 0,
      temp: 0,
      percent: 100,
      available: Number.isFinite(initiative),
    };
  }

  const itemResult = resolveItemPath(actor, definition.path);
  const typedResult = itemResult ? null : resolveTypedArrayValue(actor, definition.path);
  const raw = itemResult?.found
    ? itemResult.value
    : typedResult
      ? typedResult.value
      : getProperty(actor, definition.path);
  const available = itemResult ? itemResult.found : typedResult !== null || raw !== undefined;

  let value;
  let max;
  let temp;
  if (itemResult?.found) {
    value = itemResult.value;
    max = itemResult.max;
    temp = itemResult.temp;
  } else if (typedResult) {
    value = typedResult.value;
    max = typedResult.max;
    temp = 0;
  } else if (isObject(raw)) {
    value = raw.value ?? unwrapNumber(raw, VALUE_KEYS) ?? 0;
    max = unwrapNumber(raw, MAX_KEYS);
    temp = unwrapNumber(raw.temp) ?? 0;
  } else {
    value = raw ?? 0;
  }

  const configuredMax = resolveConfiguredNumber(actor, definition.maxPath);
  if (configuredMax !== undefined) {
    max = configuredMax;
  } else if (max === undefined) {
    max = definition.path.endsWith(".value")
      ? unwrapNumber(getProperty(actor, definition.path.slice(0, -6) + ".max"))
      : unwrapNumber(getProperty(actor, `${definition.path}.max`));
  }

  const configuredTemp = resolveConfiguredNumber(actor, definition.tempPath);
  if (configuredTemp !== undefined) temp = configuredTemp;
  if (temp === undefined) temp = unwrapNumber(getProperty(actor, `${definition.path}.temp`)) ?? 0;

  if (typeof value === "boolean" && !(max > 0)) max = 1;
  const numericValue = typeof value === "boolean" ? (value ? 1 : 0) : toFiniteNumber(value);
  const percent = numericValue === undefined
    ? 0
    : clamp((numericValue / (max > 0 ? max : 1)) * 100, 0, 100);
  return {
    ...definition,
    value,
    max: max ?? 0,
    temp,
    percent,
    available,
  };
}

function readGeneric(actor, definitions) {
  return definitions.map(definition => readGenericDefinition(actor, definition));
}

function metricType(value) {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "text";
  return "unknown";
}

function definitionForMetric(rawMetric, definitions, index) {
  const raw = isObject(rawMetric) ? rawMetric : {};
  const rawId = normalizeText(raw.id);
  const rawPath = normalizeText(raw.path);
  const indexed = definitions[index];
  if (rawId && indexed?.id === rawId) return indexed;
  if (rawPath && indexed?.path === rawPath) return indexed;
  return (rawId ? definitions.find(definition => definition.id === rawId) : null)
    ?? (rawPath ? definitions.find(definition => definition.path === rawPath) : null)
    ?? definitions[index]
    ?? normalizeDefinition(raw, index);
}

function normalizeMetric(rawMetric, definition, descriptor) {
  if (!definition) return null;
  const raw = isObject(rawMetric) ? rawMetric : { value: rawMetric };
  const value = normalizeMetricValue(raw.value);
  const max = unwrapNumber(raw.max) ?? 0;
  const temp = unwrapNumber(raw.temp) ?? 0;
  const numericValue = typeof value === "boolean" ? (value ? 1 : 0) : toFiniteNumber(value);
  const hasMax = max > 0;
  const suppliedPercent = toFiniteNumber(raw.percent);
  const suppliedTempPercent = toFiniteNumber(raw.tempPercent);
  const percent = numericValue !== undefined && hasMax
    ? clamp((numericValue / max) * 100, 0, 100)
    : suppliedPercent !== undefined
      ? clamp(suppliedPercent, 0, 100)
      : numericValue !== undefined || typeof value === "string"
        ? 100
        : 0;
  const tempPercent = hasMax
    ? clamp((temp / max) * 100, 0, 100)
    : suppliedTempPercent !== undefined
      ? clamp(suppliedTempPercent, 0, 100)
      : 0;

  let status = null;
  if (isScalar(raw.status) && raw.status !== null) status = String(raw.status);
  else if (raw.broken === true) status = "broken";
  else if (typeof raw.active === "boolean") status = raw.active ? "active" : "inactive";

  const state = {};
  if (isObject(raw.state)) {
    if (typeof raw.state.active === "boolean") state.active = raw.state.active;
    if (typeof raw.state.broken === "boolean") state.broken = raw.state.broken;
  }
  if (typeof raw.active === "boolean") state.active = raw.active;
  if (typeof raw.broken === "boolean") state.broken = raw.broken;
  if (definition.semantic === "inspiration" && typeof state.active !== "boolean") {
    if (typeof value === "boolean") state.active = value;
    else if (suppliedPercent !== undefined) state.active = suppliedPercent > 0;
    else if (typeof value === "string") state.active = value === "★";
  }
  if (status === null && typeof state.active === "boolean") {
    status = state.active ? "active" : "inactive";
  }

  const metric = {
    id: definition.id,
    path: definition.path,
    label: definition.label,
    semantic: definition.semantic,
    value,
    max,
    temp,
    percent,
    tempPercent,
    hasMax,
    type: metricType(value),
    status,
    state,
    available: typeof raw.available === "boolean" ? raw.available : true,
    source: descriptor.source,
    providerId: descriptor.id,
  };
  if (definition.maxPath) metric.maxPath = definition.maxPath;
  if (definition.tempPath) metric.tempPath = definition.tempPath;
  if (definition.readMode) metric.readMode = definition.readMode;
  return metric;
}

function normalizeMetrics(rawMetrics, definitions, descriptor) {
  if (!Array.isArray(rawMetrics)) return null;
  const metrics = [];
  rawMetrics.forEach((rawMetric, index) => {
    const definition = definitionForMetric(rawMetric, definitions, index);
    const metric = normalizeMetric(rawMetric, definition, descriptor);
    if (metric) metrics.push(metric);
  });
  return metrics;
}

function appendProviderMetadata(definitions, descriptor) {
  return definitions.map(definition => ({
    ...definition,
    source: descriptor.source,
    providerId: descriptor.id,
  }));
}

function isDiscoverableScalar(value) {
  return typeof value === "boolean" || toFiniteNumber(value) !== undefined;
}

function shouldSkipDiscoveredKey(key) {
  const normalized = String(key).toLowerCase();
  return normalized.startsWith("_")
    || normalized === "sort"
    || normalized === "order"
    || normalized === "index";
}

function discoverGeneric(actor) {
  const discovered = [];
  const visited = new WeakSet();

  const add = definition => {
    if (discovered.length >= MAX_DISCOVERED_METRICS) return;
    discovered.push(definition);
  };

  const walk = (object, prefix, depth) => {
    if (!isObject(object) || depth > MAX_DISCOVERY_DEPTH || discovered.length >= MAX_DISCOVERED_METRICS) return;
    if (visited.has(object)) return;
    visited.add(object);

    for (const [key, value] of Object.entries(object)) {
      if (shouldSkipDiscoveredKey(key)) continue;
      const path = `${prefix}.${key}`;
      if (isDiscoverableScalar(value)) {
        add({ path, label: readableLabel(path) });
        continue;
      }
      if (!isObject(value)) continue;

      if (Array.isArray(value)) {
        for (const entry of value) {
          if (!isObject(entry)) continue;
          const typedKey = getTypedEntryKey(entry);
          const typedValue = unwrapNumber(entry, TYPED_VALUE_KEYS);
          if (!typedKey || typedValue === undefined) continue;
          const token = normalizeTypedToken(typedKey);
          add({ path: `${path}.${token}`, label: `${readableLabel(path)}: ${readableLabel(token)}` });
        }
        continue;
      }

      if (isDiscoverableScalar(value.value)) {
        const definition = { path: `${path}.value`, label: readableLabel(path) };
        if (unwrapNumber(value.max) !== undefined) definition.maxPath = `${path}.max`;
        if (unwrapNumber(value.temp) !== undefined) definition.tempPath = `${path}.temp`;
        add(definition);
      } else if (isDiscoverableScalar(value.max)) {
        add({ path, label: readableLabel(path) });
      } else {
        walk(value, path, depth + 1);
      }
    }
  };

  if (isObject(actor?.system)) walk(actor.system, "system", 0);
  return normalizeDefinitions(discovered)
    .sort((left, right) => left.label.localeCompare(right.label));
}

function defaultGenericDefinitions() {
  return [{ id: "hp", path: "system.attributes.hp", label: "HP", semantic: "health" }];
}

function defaultDnd5eDefinitions() {
  return [
    { id: "hp", path: "system.attributes.hp", label: "HP", semantic: "health" },
    { id: "ac", path: "system.attributes.ac.value", label: "AC", semantic: "armor" },
    { id: "speed", path: "system.attributes.movement.walk", label: "Speed", semantic: "speed" },
    {
      id: "inspiration",
      path: "system.attributes.inspiration",
      label: "Inspiration",
      semantic: "inspiration",
    },
  ];
}

function localizedConfigLabel(configEntry, fallback) {
  const candidate = typeof configEntry === "string" ? configEntry : configEntry?.label;
  if (typeof candidate !== "string" || !candidate) return fallback;
  const localize = globalThis.game?.i18n?.localize;
  if (typeof localize !== "function") return candidate;
  try {
    return localize(candidate) || candidate;
  } catch (_error) {
    return candidate;
  }
}

function discoverDnd5e(actor) {
  const system = actor?.system ?? {};
  const definitions = [
    { id: "hp", path: "system.attributes.hp", label: "Hit Points (HP)", semantic: "health" },
    {
      id: "temporary-hp",
      path: "system.attributes.hp.temp",
      label: "Temporary HP",
      semantic: "temporary-health",
    },
  ];
  const add = (path, label, semantic) => definitions.push({ path, label, ...(semantic ? { semantic } : {}) });

  if (system.attributes?.ac) add("system.attributes.ac.value", "Armor Class (AC)", "armor");
  if (system.attributes?.init) add("system.attributes.init.total", "Initiative", "initiative");
  if (system.attributes?.movement) add("system.attributes.movement.walk", "Speed (Walk)", "speed");
  if (system.attributes?.spell?.dc !== undefined) add("system.attributes.spell.dc", "Spell DC", "difficulty-class");
  if (system.attributes?.exhaustion !== undefined) add("system.attributes.exhaustion", "Exhaustion", "exhaustion");
  if (system.attributes?.inspiration !== undefined) add("system.attributes.inspiration", "Inspiration", "inspiration");

  for (const [key] of Object.entries(system.abilities ?? {})) {
    const label = localizedConfigLabel(globalThis.CONFIG?.DND5E?.abilities?.[key], key.toUpperCase());
    add(`system.abilities.${key}.value`, `${label} Score`);
    add(`system.abilities.${key}.mod`, `${label} Mod`);
    add(`system.abilities.${key}.save.value`, `${label} Save`);
  }
  for (const [key, skill] of Object.entries(system.skills ?? {})) {
    const label = localizedConfigLabel(globalThis.CONFIG?.DND5E?.skills?.[key], skill?.label || key);
    add(`system.skills.${key}.total`, label);
  }
  for (const resourceId of ["primary", "secondary", "tertiary"]) {
    const resource = system.resources?.[resourceId];
    if (!resource) continue;
    add(`system.resources.${resourceId}`, `RES: ${resource.label || resourceId.toUpperCase()}`);
  }
  for (const [key, slots] of Object.entries(system.spells ?? {})) {
    if (!(unwrapNumber(slots?.max) > 0)) continue;
    add(`system.spells.${key}`, key === "pact" ? "Pact Slots" : `Spell LV${key.replace("spell", "")}`);
  }
  if (system.details?.xp) add("system.details.xp", "Experience (XP)", "experience");
  for (const item of collectionValues(actor?.items)) {
    if (unwrapNumber(item?.system?.uses?.max) > 0) {
      add(`items.${item.id}.uses`, `ITEM: ${item.name || item.id} (Uses)`);
    }
    if (item?.system?.quantity !== undefined) {
      add(`items.${item.id}.quantity`, `QTY: ${item.name || item.id}`);
    }
  }
  return normalizeDefinitions(definitions);
}

function readDnd5e(actor, definitions) {
  return definitions.map(definition => {
    const metric = readGenericDefinition(actor, definition);
    if (definition.semantic === "inspiration" || definition.path === "system.attributes.inspiration") {
      const active = Boolean(getProperty(actor, definition.path));
      return { ...metric, value: active, max: 1, temp: 0, percent: active ? 100 : 0, active };
    }
    if (definition.path === "combat.initiative" || metric.max > 0) return metric;
    const value = metric.value;
    return { ...metric, percent: value > 0 || value === 0 ? 100 : 0 };
  });
}

function defaultPf2eDefinitions() {
  return [
    { id: "hp", path: "system.attributes.hp", label: "HP", semantic: "health" },
    { id: "ac", path: "system.attributes.ac.value", label: "AC", semantic: "armor" },
    { id: "speed", path: "system.attributes.speed.value", label: "Speed", semantic: "speed" },
    {
      id: "hero-points",
      path: "system.resources.heroPoints",
      label: "Hero",
      semantic: "hero-points",
    },
  ];
}

function pf2eSourceSpeed(actor) {
  const source = actor?._source?.system?.attributes?.speed;
  const prepared = actor?.system?.attributes?.speed;
  const sourceOthers = Array.isArray(source?.otherSpeeds) ? source.otherSpeeds : [];
  const preparedOthers = Array.isArray(prepared?.otherSpeeds) ? prepared.otherSpeeds : [];
  return {
    value: unwrapNumber(source?.value)
      ?? unwrapNumber(prepared?.value)
      ?? unwrapNumber(actor?.system?.movement?.speeds?.land)
      ?? unwrapNumber(source?.total)
      ?? unwrapNumber(prepared?.total)
      ?? 0,
    otherSpeeds: sourceOthers.length ? sourceOthers : preparedOthers,
  };
}

function pf2eSpeedType(path) {
  const normalized = normalizeText(path);
  if (new Set([
    "system.attributes.speed",
    "system.attributes.speed.value",
    "system.attributes.speed.total",
    "system.movement.speeds.land.value",
    "system.movement.speeds.land.total",
    "system.movement.speeds.land.base",
  ]).has(normalized)) return "land";
  return normalized.match(/^system\.attributes\.speed\.otherSpeeds\.([^.]+)$/)?.[1]
    ?? normalized.match(/^system\.movement\.speeds\.([^.]+)\.(?:value|total|base)$/)?.[1]
    ?? null;
}

function pf2eSpeedValue(actor, type) {
  if (type === "land") {
    return unwrapNumber(actor?.system?.movement?.speeds?.land)
      ?? pf2eSourceSpeed(actor).value;
  }
  const prepared = actor?.system?.movement?.speeds?.[type];
  if (prepared) return unwrapNumber(prepared) ?? 0;
  const other = pf2eSourceSpeed(actor).otherSpeeds.find(speed => speed?.type === type);
  return unwrapNumber(other) ?? 0;
}

function pf2eOtherSpeedTypes(actor) {
  const types = new Set();
  for (const speed of pf2eSourceSpeed(actor).otherSpeeds) {
    if (speed?.type) types.add(String(speed.type));
  }
  for (const [type, speed] of Object.entries(actor?.system?.movement?.speeds ?? {})) {
    if (type === "land" || type === "travel" || !(unwrapNumber(speed) > 0)) continue;
    types.add(type);
  }
  const preferred = ["burrow", "climb", "fly", "swim"];
  return Array.from(types).sort((left, right) => {
    const leftIndex = preferred.includes(left) ? preferred.indexOf(left) : preferred.length;
    const rightIndex = preferred.includes(right) ? preferred.indexOf(right) : preferred.length;
    return leftIndex === rightIndex ? left.localeCompare(right) : leftIndex - rightIndex;
  });
}

function resolvePf2eSpellcasting(actor, definition) {
  const parts = definition.path.split(".");
  if (parts[0] !== "spellcasting" || parts.length < 3) return null;
  const entry = collectionGet(actor?.spellcasting, parts[1]);
  if (!entry) return { ...definition, value: 0, max: 0, temp: 0, available: false };
  if (parts[2] === "dc") {
    return {
      ...definition,
      value: unwrapNumber(entry.statistic?.dc) ?? 0,
      max: 0,
      temp: 0,
      available: true,
    };
  }
  if (parts[2] !== "slots" || !parts[3]) return null;
  const slot = entry.system?.slots?.[parts[3]];
  if (!slot) return { ...definition, value: 0, max: 0, temp: 0, available: false };
  const prepared = Array.isArray(slot.prepared) ? slot.prepared : [];
  const value = entry.isPrepared && !entry.isFlexible && prepared.length
    ? prepared.filter(spell => spell?.id && !spell.expended).length
    : unwrapNumber(slot.value) ?? 0;
  return {
    ...definition,
    value,
    max: unwrapNumber(slot.max) ?? 0,
    temp: 0,
    available: true,
  };
}

function readPf2e(actor, definitions) {
  return definitions.map(definition => {
    if (definition.path === "system.attributes.perception.value") {
      const perception = actor?.perception ?? actor?.attributes?.perception;
      return {
        ...definition,
        value: unwrapNumber(perception?.mod)
          ?? unwrapNumber(perception?.totalModifier)
          ?? unwrapNumber(perception?.value)
          ?? 0,
        max: 0,
        temp: 0,
        available: perception != null,
      };
    }

    const speedType = pf2eSpeedType(definition.path);
    if (speedType) {
      return { ...definition, value: pf2eSpeedValue(actor, speedType), max: 0, temp: 0, available: true };
    }

    if (definition.path.startsWith("spellcasting.")) {
      return resolvePf2eSpellcasting(actor, definition) ?? readGenericDefinition(actor, definition);
    }

    if (definition.path.startsWith("items.")) {
      const parts = definition.path.split(".");
      const item = collectionGet(actor?.items, parts[1]);
      if (parts[2] === "quantity") {
        return {
          ...definition,
          value: unwrapNumber(item?.quantity) ?? unwrapNumber(item?.system?.quantity) ?? 0,
          max: 0,
          temp: 0,
          available: item != null,
        };
      }
      if (parts[2] === "uses") {
        const frequency = item?.system?.frequency;
        return {
          ...definition,
          value: unwrapNumber(frequency?.value) ?? 0,
          max: unwrapNumber(frequency?.max) ?? 0,
          temp: 0,
          available: item != null && frequency != null,
        };
      }
    }

    if (definition.semantic === "hero-points" && getProperty(actor, definition.path) === undefined) {
      const fallback = getProperty(actor, "system.resources.hero");
      if (fallback !== undefined) {
        const raw = isObject(fallback) ? fallback : { value: fallback };
        return {
          ...definition,
          value: raw.value ?? unwrapNumber(raw) ?? 0,
          max: unwrapNumber(raw, MAX_KEYS) ?? 0,
          temp: 0,
          available: true,
        };
      }
    }

    if (definition.path.includes("shield")) {
      const shield = actor?.attributes?.shield ?? actor?.system?.attributes?.shield;
      if (!shield) return { ...definition, value: 0, max: 0, temp: 0, available: false };
      const shieldPrefix = "system.attributes.shield";
      const relativePath = definition.path.startsWith(`${shieldPrefix}.`)
        ? definition.path.slice(shieldPrefix.length + 1)
        : "";
      const raw = relativePath ? getProperty(shield, relativePath) : shield;
      const shieldMax = isObject(raw)
        ? unwrapNumber(raw, MAX_KEYS) ?? 0
        : relativePath.endsWith(".value")
          ? unwrapNumber(getProperty(shield, `${relativePath.slice(0, -6)}.max`)) ?? 0
          : 0;
      return {
        ...definition,
        value: isObject(raw) ? raw.value ?? unwrapNumber(raw) ?? 0 : raw ?? 0,
        max: shieldMax,
        temp: 0,
        broken: shield.broken === true,
        available: true,
      };
    }

    return readGenericDefinition(actor, definition);
  }).map(metric => ({
    ...metric,
    percent: metric.max > 0 && toFiniteNumber(metric.value) !== undefined
      ? clamp((Number(metric.value) / metric.max) * 100, 0, 100)
      : 100,
    broken: metric.broken === true,
  }));
}

function discoverPf2e(actor) {
  const system = actor?.system ?? {};
  const definitions = [
    { id: "hp", path: "system.attributes.hp", label: "Hit Points (HP)", semantic: "health" },
    { id: "ac", path: "system.attributes.ac.value", label: "Armor Class (AC)", semantic: "armor" },
    { path: "system.attributes.perception.value", label: "Perception", semantic: "perception" },
    { path: "system.attributes.classDC.value", label: "Class DC", semantic: "difficulty-class" },
    { id: "speed", path: "system.attributes.speed.value", label: "Speed", semantic: "speed" },
    { path: "system.details.level.value", label: "Level" },
  ];
  const add = (path, label, semantic) => definitions.push({ path, label, ...(semantic ? { semantic } : {}) });
  const shield = actor?.attributes?.shield ?? system.attributes?.shield;
  if (shield) add("system.attributes.shield.hp", "Shield HP", "shield");
  for (const type of pf2eOtherSpeedTypes(actor)) {
    add(`system.attributes.speed.otherSpeeds.${type}`, `Speed: ${readableLabel(type)}`, "speed");
  }
  if (system.resources?.focus) add("system.resources.focus", "Focus Points", "focus");
  if (system.resources?.heroPoints ?? system.resources?.hero) {
    add(system.resources?.heroPoints ? "system.resources.heroPoints" : "system.resources.hero", "Hero Points", "hero-points");
  }
  if (system.resources?.crafting) add("system.resources.crafting.infused", "Infused Reagents");
  if (system.saves) {
    add("system.saves.fortitude.value", "Save: Fortitude");
    add("system.saves.reflex.value", "Save: Reflex");
    add("system.saves.will.value", "Save: Will");
  }
  for (const [key, skill] of Object.entries(system.skills ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    if (skill?.label) add(`system.skills.${key}.value`, `Skill: ${skill.label}`);
  }
  for (const item of collectionValues(actor?.items)) {
    const quantity = unwrapNumber(item?.quantity) ?? unwrapNumber(item?.system?.quantity);
    const physical = typeof item?.isOfType !== "function" || item.isOfType("physical");
    if (quantity !== undefined && physical) add(`items.${item.id}.quantity`, `Qty: ${item.name || item.id}`);
  }
  for (const entry of collectionValues(actor?.spellcasting)) {
    if (!entry?.isSpontaneous && !entry?.isInnate && !entry?.isPrepared) continue;
    const entryName = entry.name || "Spells";
    const shortName = entryName.length > 10 ? `${entryName.slice(0, 8)}..` : entryName;
    if (unwrapNumber(entry.statistic?.dc) > 0) add(`spellcasting.${entry.id}.dc`, `${shortName} DC`, "difficulty-class");
    for (let rank = 1; rank <= 10; rank += 1) {
      const slot = entry.system?.slots?.[`slot${rank}`];
      if (unwrapNumber(slot?.max) > 0) add(`spellcasting.${entry.id}.slots.slot${rank}`, `${shortName} R${rank}`);
    }
  }
  return normalizeDefinitions(definitions);
}

const genericProvider = Object.freeze({
  id: ACTOR_METRIC_PROVIDER_IDS.GENERIC,
  read: readGeneric,
  defaults: defaultGenericDefinitions,
  discover: discoverGeneric,
});

const dnd5eProvider = Object.freeze({
  id: ACTOR_METRIC_PROVIDER_IDS.DND5E,
  read: readDnd5e,
  defaults: defaultDnd5eDefinitions,
  discover: discoverDnd5e,
});

const pf2eProvider = Object.freeze({
  id: ACTOR_METRIC_PROVIDER_IDS.PF2E,
  read: readPf2e,
  defaults: defaultPf2eDefinitions,
  discover: discoverPf2e,
});

function normalizeSystemId(systemId) {
  return normalizeText(systemId).toLowerCase();
}

function normalizeRequestOptions(options) {
  if (typeof options === "string") return { systemId: options };
  return isObject(options) ? options : {};
}

function resolveSubject(subject, systemIdOverride) {
  const forcedSystemId = normalizeSystemId(systemIdOverride);
  if (typeof subject === "string") {
    const systemId = forcedSystemId || normalizeSystemId(subject) || GENERIC_SYSTEM_ID;
    const activeSystem = globalThis.game?.system ?? null;
    return {
      actor: null,
      systemId,
      system: normalizeSystemId(activeSystem?.id) === systemId ? activeSystem : { id: systemId },
    };
  }
  const looksLikeSystem = isObject(subject)
    && typeof subject.id === "string"
    && subject.documentName !== "Actor"
    && ("version" in subject || "title" in subject || "data" in subject);
  if (looksLikeSystem) {
    return { actor: null, systemId: forcedSystemId || normalizeSystemId(subject.id), system: subject };
  }
  return {
    actor: isObject(subject) ? subject : null,
    systemId: forcedSystemId
      || normalizeSystemId(subject?.systemId ?? globalThis.game?.system?.id)
      || GENERIC_SYSTEM_ID,
    system: globalThis.game?.system ?? null,
  };
}

function registrationDescriptor(entry) {
  return Object.freeze({
    registrationId: entry.registrationId,
    id: entry.id,
    systemId: entry.systemId,
    source: entry.source,
    priority: entry.priority,
    order: entry.order,
    builtIn: entry.builtIn,
    hasCompatibilityCheck: typeof entry.isCompatible === "function",
    preserveDefinitionFields: entry.preserveDefinitionFields,
  });
}

/**
 * Create an isolated actor metric registry.
 *
 * Read/default/discover options support systemId, providerId, registrationId,
 * excludeProviderId(s), excludeRegistrationId(s), and a context object. The
 * context object is exposed to providers both directly and as requestContext.
 */
export function createActorMetricsService({ includeBuiltIns = true } = {}) {
  const entriesBySystem = new Map();
  const entriesByRegistrationId = new Map();
  const activeRegistrations = new Set();
  let registrationOrder = 0;

  const registerProvider = (systemId, provider, options = {}) => {
    const resolvedSystemId = normalizeSystemId(systemId);
    if (!resolvedSystemId) throw new Error(`${MODULE_ID} | actorMetrics systemId is required.`);
    if (!isObject(provider)) throw new Error(`${MODULE_ID} | actorMetrics provider is required.`);
    if (!["read", "defaults", "discover"].some(method => typeof provider[method] === "function")) {
      throw new Error(`${MODULE_ID} | actorMetrics provider must implement read, defaults, or discover.`);
    }
    const id = normalizeText(options.id ?? provider.id);
    if (!id) throw new Error(`${MODULE_ID} | actorMetrics provider id is required.`);
    if (id.includes(":")) throw new Error(`${MODULE_ID} | actorMetrics provider id cannot contain ':'.`);
    const registrationId = `${resolvedSystemId}:${id}`;
    const existing = entriesByRegistrationId.get(registrationId);
    const entry = {
      registrationId,
      id,
      systemId: resolvedSystemId,
      provider,
      priority: Number.isFinite(options.priority) ? options.priority : 0,
      source: normalizeText(options.source, "unknown"),
      isCompatible: typeof options.isCompatible === "function" ? options.isCompatible : null,
      preserveDefinitionFields: options.preserveDefinitionFields === true,
      order: existing?.order ?? registrationOrder++,
      builtIn: options.builtIn === true,
    };

    const entries = entriesBySystem.get(resolvedSystemId) ?? [];
    if (existing) {
      const index = entries.findIndex(candidate => candidate.registrationId === registrationId);
      if (index >= 0) entries[index] = entry;
      else entries.push(entry);
    } else {
      entries.push(entry);
    }
    entriesBySystem.set(resolvedSystemId, entries);
    entriesByRegistrationId.set(registrationId, entry);
    return registrationDescriptor(entry);
  };

  const unregisterProvider = registrationId => {
    const normalized = normalizeText(
      isObject(registrationId) ? registrationId.registrationId : registrationId,
    );
    const entry = entriesByRegistrationId.get(normalized);
    if (!entry) return false;
    entriesByRegistrationId.delete(normalized);
    const entries = entriesBySystem.get(entry.systemId) ?? [];
    const remaining = entries.filter(candidate => candidate.registrationId !== normalized);
    if (remaining.length) entriesBySystem.set(entry.systemId, remaining);
    else entriesBySystem.delete(entry.systemId);
    return true;
  };

  const listProviders = systemId => {
    const resolvedSystemId = normalizeSystemId(systemId);
    const entries = resolvedSystemId
      ? [...(entriesBySystem.get(resolvedSystemId) ?? [])]
      : Array.from(entriesByRegistrationId.values());
    entries.sort((left, right) => left.systemId.localeCompare(right.systemId)
      || right.priority - left.priority
      || left.order - right.order);
    return Object.freeze(entries.map(registrationDescriptor));
  };

  const createContext = (subject, entry, options = {}) => {
    const suppliedContext = isObject(options.context) ? options.context : {};
    const requestContext = Object.freeze({
      ...suppliedContext,
      ...(typeof options.fromHudDefaultRegistry === "boolean"
        ? { fromHudDefaultRegistry: options.fromHudDefaultRegistry }
        : {}),
    });
    return Object.freeze({
      ...requestContext,
      requestContext,
      actor: subject.actor,
      systemId: subject.systemId,
      system: subject.system ?? globalThis.game?.system ?? null,
      modules: globalThis.game?.modules ?? null,
      providerId: entry.id,
      source: entry.source,
    });
  };

  const compatibleEntries = (subject, options = {}) => {
    const systemIds = subject.systemId === GENERIC_SYSTEM_ID
      ? [GENERIC_SYSTEM_ID]
      : [subject.systemId, GENERIC_SYSTEM_ID];
    const entries = systemIds.flatMap(systemId => [...(entriesBySystem.get(systemId) ?? [])]
      .sort((left, right) => right.priority - left.priority || left.order - right.order));
    const excludedProviderIds = new Set([
      ...(Array.isArray(options.excludeProviderIds) ? options.excludeProviderIds : []),
      ...(options.excludeProviderId ? [options.excludeProviderId] : []),
    ].map(normalizeText).filter(Boolean));
    const excludedRegistrationIds = new Set([
      ...(Array.isArray(options.excludeRegistrationIds) ? options.excludeRegistrationIds : []),
      ...(options.excludeRegistrationId ? [options.excludeRegistrationId] : []),
    ].map(normalizeText).filter(Boolean));
    const requestedProviderId = normalizeText(options.providerId);
    const requestedRegistrationId = normalizeText(options.registrationId);
    return entries.filter(entry => {
        if (activeRegistrations.has(entry.registrationId)) return false;
        if (excludedProviderIds.has(entry.id)
          || excludedProviderIds.has(entry.registrationId)
          || excludedRegistrationIds.has(entry.registrationId)
          || excludedRegistrationIds.has(entry.id)) return false;
        if (requestedProviderId
          && entry.id !== requestedProviderId
          && entry.registrationId !== requestedProviderId) return false;
        if (requestedRegistrationId && entry.registrationId !== requestedRegistrationId) return false;
        if (typeof entry.isCompatible !== "function") return true;
        activeRegistrations.add(entry.registrationId);
        try {
          return entry.isCompatible(createContext(subject, entry, options)) !== false;
        } catch (error) {
          console.warn(`${MODULE_ID} | Actor metric provider compatibility check failed for '${entry.registrationId}'.`, error);
          return false;
        } finally {
          activeRegistrations.delete(entry.registrationId);
        }
      });
  };

  const invokeProvider = (entry, method, args) => {
    activeRegistrations.add(entry.registrationId);
    try {
      return entry.provider[method](...args);
    } finally {
      activeRegistrations.delete(entry.registrationId);
    }
  };

  const defaults = (subjectInput, options = {}) => {
    options = normalizeRequestOptions(options);
    const subject = resolveSubject(subjectInput, options.systemId);
    for (const entry of compatibleEntries(subject, options)) {
      if (typeof entry.provider.defaults !== "function") continue;
      try {
        const providedDefinitions = invokeProvider(entry, "defaults", [
          subject.actor,
          createContext(subject, entry, options),
        ]);
        if (!Array.isArray(providedDefinitions)) continue;
        const definitions = normalizeDefinitions(providedDefinitions, { dedupe: false });
        return appendProviderMetadata(definitions, registrationDescriptor(entry));
      } catch (error) {
        console.warn(`${MODULE_ID} | Actor metric defaults failed for '${entry.registrationId}'.`, error);
      }
    }
    return [];
  };

  const discover = (actor, options = {}) => {
    options = normalizeRequestOptions(options);
    const subject = resolveSubject(actor, options.systemId);
    if (!subject.actor) return [];
    for (const entry of compatibleEntries(subject, options)) {
      if (typeof entry.provider.discover !== "function") continue;
      try {
        const providedDefinitions = invokeProvider(entry, "discover", [
          subject.actor,
          createContext(subject, entry, options),
        ]);
        if (!Array.isArray(providedDefinitions)) continue;
        const definitions = normalizeDefinitions(providedDefinitions);
        return appendProviderMetadata(definitions, registrationDescriptor(entry));
      } catch (error) {
        console.warn(`${MODULE_ID} | Actor metric discovery failed for '${entry.registrationId}'.`, error);
      }
    }
    return [];
  };

  const read = (actor, suppliedDefinitions, options = {}) => {
    options = normalizeRequestOptions(options);
    const subject = resolveSubject(actor, options.systemId);
    if (!subject.actor) return [];
    const hasSuppliedDefinitions = Array.isArray(suppliedDefinitions);
    const normalizedSupplied = hasSuppliedDefinitions
      ? normalizeDefinitions(suppliedDefinitions, { dedupe: false })
      : null;
    const rawSupplied = hasSuppliedDefinitions
      ? suppliedDefinitions
        .map((definition, index) => typeof definition === "string"
          ? normalizeDefinition(definition, index)
          : normalizeDefinition(definition, index) && isObject(definition)
            ? { ...definition }
            : null)
        .filter(Boolean)
      : null;

    for (const entry of compatibleEntries(subject, options)) {
      if (typeof entry.provider.read !== "function") continue;
      try {
        const context = createContext(subject, entry, options);
        let rawDefinitions = rawSupplied;
        let definitions = normalizedSupplied;
        if (definitions === null) {
          if (typeof entry.provider.defaults !== "function") continue;
          const providedDefaults = invokeProvider(entry, "defaults", [subject.actor, context]);
          if (!Array.isArray(providedDefaults)) continue;
          rawDefinitions = Array.isArray(providedDefaults)
            ? providedDefaults
              .map((definition, index) => typeof definition === "string"
                ? normalizeDefinition(definition, index)
                : normalizeDefinition(definition, index) && isObject(definition)
                  ? { ...definition }
                  : null)
              .filter(Boolean)
            : [];
          definitions = normalizeDefinitions(providedDefaults, { dedupe: false });
        }
        const providerDefinitions = entry.preserveDefinitionFields ? rawDefinitions : definitions;
        const rawMetrics = invokeProvider(entry, "read", [subject.actor, providerDefinitions, context]);
        const metrics = normalizeMetrics(rawMetrics, definitions, registrationDescriptor(entry));
        if (metrics !== null) return metrics;
      } catch (error) {
        console.warn(`${MODULE_ID} | Actor metric read failed for '${entry.registrationId}'.`, error);
      }
    }
    return [];
  };

  if (includeBuiltIns) {
    registerProvider("dnd5e", dnd5eProvider, {
      id: dnd5eProvider.id,
      priority: -100,
      source: MODULE_ID,
      builtIn: true,
    });
    registerProvider("pf2e", pf2eProvider, {
      id: pf2eProvider.id,
      priority: -100,
      source: MODULE_ID,
      builtIn: true,
    });
    registerProvider(GENERIC_SYSTEM_ID, genericProvider, {
      id: genericProvider.id,
      priority: -1000,
      source: MODULE_ID,
      builtIn: true,
    });
  }

  return Object.freeze({
    read,
    defaults,
    discover,
    registerProvider,
    unregisterProvider,
    listProviders,
  });
}

export const actorMetrics = createActorMetricsService();
