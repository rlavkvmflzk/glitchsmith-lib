import { MODULE_ID } from "../constants.js";
import {
  KNOWN_AUTHOR_TOKENS,
  EXPLICIT_MODULE_IDS,
  LEGACY_NOTIFIER_MODULES,
  MIGRATED_LEGACY_NOTIFIER_MIN_VERSIONS,
  NOTIFIER_LOG_PREFIX,
} from "./constants.js";

function isAuthoredByGlitchSmith(mod) {
  const authors = mod?.authors;
  if (!authors) return false;
  try {
    for (const a of authors) {
      if (KNOWN_AUTHOR_TOKENS.has(a?.name) || KNOWN_AUTHOR_TOKENS.has(a?.discord)) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function isExplicitlyClaimed(mod) {
  return EXPLICIT_MODULE_IDS.has(mod.id);
}

export function isGlitchSmithModule(mod) {
  if (!mod) return false;
  if (mod.id === MODULE_ID) return true;
  return isAuthoredByGlitchSmith(mod) || isExplicitlyClaimed(mod);
}

export function hasLegacyOwnNotifier(mod) {
  if (!LEGACY_NOTIFIER_MODULES.has(mod.id)) return false;

  const migratedFromVersion = MIGRATED_LEGACY_NOTIFIER_MIN_VERSIONS[mod.id];
  if (!migratedFromVersion) return true;

  return foundry.utils.isNewerVersion(migratedFromVersion, mod.version || "0.0.0");
}

export function enumerateNotifierTargets() {
  const targets = [];
  for (const mod of game.modules) {
    if (!mod.active) continue;
    if (!isGlitchSmithModule(mod)) continue;
    if (hasLegacyOwnNotifier(mod)) {
      console.log(`${NOTIFIER_LOG_PREFIX} skipping ${mod.id} (legacy own notifier)`);
      continue;
    }
    targets.push(mod);
  }
  return targets;
}
