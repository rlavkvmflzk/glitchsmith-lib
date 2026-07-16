import { MODULE_ID } from "../constants.js";

export const NOTIFIER_LOG_PREFIX = `${MODULE_ID} | notifier |`;

export const KNOWN_AUTHOR_TOKENS = new Set([
  "rlavkvmflzk",
  "GlitchSmith",
  "sarangi",
]);

export const EXPLICIT_MODULE_IDS = new Set([
  "jrpg-turn-tracker",
]);

// Permanent skip list. Removing a module from here while users still run an
// older version with its own UpdateNotifier produces duplicate dialogs.
// To migrate, leave the module here and have it call the lib API directly.
export const LEGACY_NOTIFIER_MODULES = new Set([
  "cinematic-cut-ins",
  "stylish-action-hud",
]);

export const MIGRATED_LEGACY_NOTIFIER_MIN_VERSIONS = Object.freeze({
  "stylish-action-hud": "2.5.1",
  "cinematic-cut-ins": "2.0.0",
});

export const UPDATE_JSON_BASE_URL =
  "https://raw.githubusercontent.com/rlavkvmflzk/glitchsmith-updates/main";

export const LEGACY_JSON_FILENAMES = Object.freeze({
  "smartphone-widget": "update-info.json",
  "cinematic-cut-ins": "cinematic-update.json",
});

export const NOTIFIER_SETTING_KEYS = Object.freeze({
  DISABLE: "disableUpdateNotification",
  SKIPPED_VERSION: "skippedUpdateVersion",
  LAST_SEEN_NOTICE_ID: "lastSeenNoticeId",
  FORCE_RESET_ID: "forceResetId",
});

export const FETCH_TIMEOUT_MS = 10000;
