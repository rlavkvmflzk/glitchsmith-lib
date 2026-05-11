import { NOTIFIER_LOG_PREFIX, NOTIFIER_SETTING_KEYS } from "./constants.js";
import { enumerateNotifierTargets } from "./discovery.js";
import {
  registerNotifierSettings,
  getSetting,
  setSetting,
} from "./settings.js";
import { resolveUpdateUrl } from "./url-resolver.js";
import { fetchUpdateData } from "./fetcher.js";
import { showUpdateDialog, showAnnouncementDialog } from "./dialog.js";

const { DISABLE, SKIPPED_VERSION, LAST_SEEN_NOTICE_ID, FORCE_RESET_ID } =
  NOTIFIER_SETTING_KEYS;

let cachedTargets = null;

function getTargets() {
  if (cachedTargets === null) {
    cachedTargets = enumerateNotifierTargets();
  }
  return cachedTargets;
}

export function registerNotifierSettingsForTargets() {
  for (const mod of getTargets()) {
    registerNotifierSettings(mod.id);
  }
}

export async function runAutoDiscovery() {
  if (!game.user?.isGM) return;
  for (const mod of getTargets()) {
    try {
      await checkOne(mod);
    } catch (err) {
      console.warn(
        `${NOTIFIER_LOG_PREFIX} ${mod.id} update check failed:`,
        err?.message ?? err
      );
    }
  }
}

export async function checkOne(mod) {
  if (!mod?.active) return;
  const moduleId = mod.id;

  if (getSetting(moduleId, DISABLE) === true) return;

  const url = resolveUpdateUrl(moduleId);
  const data = await fetchUpdateData(url);
  if (!data) return;

  const currentVersion = mod.version || "0.0.0";

  if (data.forceResetId) {
    const savedForceId = getSetting(moduleId, FORCE_RESET_ID) || "";
    if (savedForceId !== data.forceResetId) {
      await setSetting(moduleId, SKIPPED_VERSION, "0.0.0");
      await setSetting(moduleId, FORCE_RESET_ID, data.forceResetId);
      ui.notifications?.info(
        game.i18n.format("GLITCHSMITH-LIB.notifier.settingsReset", {
          title: mod.title || moduleId,
        })
      );
    }
  }

  const skippedVersion = getSetting(moduleId, SKIPPED_VERSION) || "0.0.0";
  const isNewer =
    data.latestVersion &&
    foundry.utils.isNewerVersion(data.latestVersion, currentVersion);
  const versionAlreadySkipped = data.latestVersion === skippedVersion;

  if (isNewer && !versionAlreadySkipped) {
    await showUpdateDialog({ mod, data, currentVersion });
    return;
  }

  if (data.announcement?.show && data.announcement?.id) {
    const lastSeen = getSetting(moduleId, LAST_SEEN_NOTICE_ID) || "";
    if (lastSeen !== data.announcement.id) {
      await showAnnouncementDialog({ mod, announcement: data.announcement });
    }
  }
}
