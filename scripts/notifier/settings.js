import { NOTIFIER_SETTING_KEYS, NOTIFIER_LOG_PREFIX } from "./constants.js";

const { DISABLE, SKIPPED_VERSION, LAST_SEEN_NOTICE_ID, FORCE_RESET_ID } =
  NOTIFIER_SETTING_KEYS;

function settingExists(moduleId, key) {
  return game.settings.settings.has(`${moduleId}.${key}`);
}

function safeRegister(moduleId, key, options) {
  if (settingExists(moduleId, key)) return;
  try {
    game.settings.register(moduleId, key, options);
  } catch (err) {
    console.warn(
      `${NOTIFIER_LOG_PREFIX} failed to register ${moduleId}.${key}:`,
      err?.message ?? err
    );
  }
}

export function registerNotifierSettings(moduleId) {
  safeRegister(moduleId, DISABLE, {
    name: game.i18n.localize("GLITCHSMITH-LIB.notifier.disableName"),
    hint: game.i18n.localize("GLITCHSMITH-LIB.notifier.disableHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });
  safeRegister(moduleId, SKIPPED_VERSION, {
    scope: "client",
    config: false,
    type: String,
    default: "0.0.0",
  });
  safeRegister(moduleId, LAST_SEEN_NOTICE_ID, {
    scope: "client",
    config: false,
    type: String,
    default: "",
  });
  safeRegister(moduleId, FORCE_RESET_ID, {
    scope: "client",
    config: false,
    type: String,
    default: "",
  });
}

export function getSetting(moduleId, key) {
  if (!settingExists(moduleId, key)) return undefined;
  try {
    return game.settings.get(moduleId, key);
  } catch {
    return undefined;
  }
}

export async function setSetting(moduleId, key, value) {
  if (!settingExists(moduleId, key)) return;
  try {
    await game.settings.set(moduleId, key, value);
  } catch (err) {
    console.warn(
      `${NOTIFIER_LOG_PREFIX} failed to set ${moduleId}.${key}:`,
      err?.message ?? err
    );
  }
}
