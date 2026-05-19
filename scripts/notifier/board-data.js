import { NOTIFIER_LOG_PREFIX, NOTIFIER_SETTING_KEYS } from "./constants.js";
import { enumerateNotifierTargets } from "./discovery.js";
import { fetchUpdateData } from "./fetcher.js";
import { getSetting, setSetting } from "./settings.js";
import { resolveUpdateUrl } from "./url-resolver.js";

const { DISABLE, SKIPPED_VERSION, LAST_SEEN_NOTICE_ID, FORCE_RESET_ID } =
  NOTIFIER_SETTING_KEYS;

async function applyForceReset(mod, data) {
  if (!data?.forceResetId) return;
  const moduleId = mod.id;
  const saved = getSetting(moduleId, FORCE_RESET_ID) || "";
  if (saved === data.forceResetId) return;

  await setSetting(moduleId, SKIPPED_VERSION, "0.0.0");
  await setSetting(moduleId, FORCE_RESET_ID, data.forceResetId);
  ui.notifications?.info(
    game.i18n.format("GLITCHSMITH-LIB.notifier.settingsReset", {
      title: mod.title || moduleId,
    })
  );
}

async function collectModuleEntry(mod) {
  const moduleId = mod.id;
  if (getSetting(moduleId, DISABLE) === true) return null;

  const url = resolveUpdateUrl(moduleId);
  const data = await fetchUpdateData(url);
  if (!data) return null;

  await applyForceReset(mod, data);

  const currentVersion = mod.version || "0.0.0";
  const skippedVersion = getSetting(moduleId, SKIPPED_VERSION) || "0.0.0";
  const lastSeenNoticeId = getSetting(moduleId, LAST_SEEN_NOTICE_ID) || "";

  const isNewer =
    data.latestVersion &&
    foundry.utils.isNewerVersion(data.latestVersion, currentVersion);
  const versionAlreadySkipped = data.latestVersion === skippedVersion;

  let update = null;
  if (isNewer && !versionAlreadySkipped) {
    update = {
      moduleId,
      title: mod.title || moduleId,
      currentVersion,
      latestVersion: data.latestVersion,
      notes: data.notes ?? "",
      critical: !!data.critical,
    };
  }

  let announcement = null;
  if (
    data.announcement?.show &&
    data.announcement?.id &&
    data.announcement.id !== lastSeenNoticeId
  ) {
    announcement = {
      moduleId,
      title: mod.title || moduleId,
      noticeId: data.announcement.id,
      noticeTitle: data.announcement.title || "",
      content: data.announcement.content ?? "",
    };
  }

  return { update, announcement };
}

export async function collectBoardData() {
  const targets = enumerateNotifierTargets();
  const updates = [];
  const announcements = [];

  for (const mod of targets) {
    try {
      const entry = await collectModuleEntry(mod);
      if (!entry) continue;
      if (entry.update) updates.push(entry.update);
      if (entry.announcement) announcements.push(entry.announcement);
    } catch (err) {
      console.warn(
        `${NOTIFIER_LOG_PREFIX} ${mod.id} update check failed:`,
        err?.message ?? err
      );
    }
  }

  return { updates, announcements };
}
