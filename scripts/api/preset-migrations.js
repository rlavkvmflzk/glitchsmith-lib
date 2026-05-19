import { CURRENCY_TYPES, MODULE_ID, SETTING_KEYS, SOURCES } from "../constants.js";
import { getSetting, setSetting } from "../settings/index.js";
import { getDefinitions, writeDefinitions } from "./definitions.js";
import { getSystemPreset } from "./presets.js";

const MIGRATION_KEY = "swadeDecimalCurrency.v1";

function _readMigrationState() {
  const state = getSetting(SETTING_KEYS.CURRENCY_MIGRATION_STATE);
  return state && typeof state === "object" ? state : {};
}

async function _markComplete(extra = {}) {
  const state = _readMigrationState();
  state[MIGRATION_KEY] = { completed: true, at: Date.now(), ...extra };
  await setSetting(SETTING_KEYS.CURRENCY_MIGRATION_STATE, state);
}

function _matchesPresetEntry(preset, currencyId, def) {
  const presetEntry = preset?.currencies?.[currencyId];
  if (!presetEntry) return false;
  if (presetEntry.integer !== false) return false;
  if (def?.type !== CURRENCY_TYPES.SHEET) return false;
  if (presetEntry.actorPath && def?.actorPath && presetEntry.actorPath !== def.actorPath) return false;
  return true;
}

export async function applyDecimalPresetMigration() {
  if (!game.user?.isGM) return;
  const systemId = game?.system?.id;
  if (systemId !== "swade") return;

  const state = _readMigrationState();
  if (state[MIGRATION_KEY]?.completed) return;

  const preset = getSystemPreset(systemId);
  if (!preset?.currencies) {
    await _markComplete({ skipped: "no-preset" });
    return;
  }

  const defs = getDefinitions();
  const currencies = defs.currencies ?? {};
  if (Object.keys(currencies).length === 0) {
    await _markComplete({ skipped: "no-definitions" });
    return;
  }

  const updated = {};
  let touched = 0;

  for (const [id, def] of Object.entries(currencies)) {
    updated[id] = def;
    if (Object.hasOwn(def, "integer")) continue;
    if (!_matchesPresetEntry(preset, id, def)) continue;

    const presetEntry = preset.currencies[id];
    updated[id] = {
      ...def,
      integer: false,
      precision: Number.isInteger(presetEntry.precision) ? presetEntry.precision : 2,
    };
    touched += 1;
  }

  if (touched === 0) {
    await _markComplete({ skipped: "nothing-to-touch" });
    return;
  }

  try {
    await writeDefinitions({ base: defs.base, currencies: updated }, {
      source: SOURCES.LIBRARY,
      reason: `${MODULE_ID}:${MIGRATION_KEY}`,
    });
    await _markComplete({ touched });
    console.log(`${MODULE_ID} | ${MIGRATION_KEY}: backfilled ${touched} currency entr${touched === 1 ? "y" : "ies"}.`);
  } catch (err) {
    console.error(`${MODULE_ID} | ${MIGRATION_KEY} failed:`, err);
  }
}
