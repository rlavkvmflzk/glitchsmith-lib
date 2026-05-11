import { NOTIFIER_SETTING_KEYS } from "./constants.js";
import { setSetting } from "./settings.js";

const { DISABLE, SKIPPED_VERSION, LAST_SEEN_NOTICE_ID } = NOTIFIER_SETTING_KEYS;

function localize(key) {
  return game.i18n.localize(`GLITCHSMITH-LIB.notifier.${key}`);
}

function format(key, params) {
  return game.i18n.format(`GLITCHSMITH-LIB.notifier.${key}`, params);
}

export async function showUpdateDialog({ mod, data, currentVersion }) {
  const { DialogV2 } = foundry.applications.api;
  const moduleId = mod.id;
  const title = mod.title || mod.id;

  const accentColor = data.critical ? "#d63031" : "#e61c34";
  const headerIcon = data.critical ? "fas fa-exclamation-triangle" : "fas fa-gift";

  const checkboxHtml = `
    <div style="margin-top: 15px; display: flex; align-items: center; justify-content: center; gap: 8px;">
      <input type="checkbox" id="gs-skip-update-checkbox" style="width: 16px; height: 16px; margin: 0;">
      <label for="gs-skip-update-checkbox" style="color: var(--color-text-secondary); font-size: 0.9em; cursor: pointer;">
        ${localize("skipVersion")}
      </label>
    </div>
  `;

  const content = `
    <div style="display: flex; flex-direction: column; align-items: center; text-align: center; padding: 10px;">
      <i class="${headerIcon}" style="font-size: 3rem; color: ${accentColor}; margin-bottom: 15px;"></i>
      <h2 style="border:none; margin-bottom: 5px; color: var(--color-text-primary);">
        ${format("newVersion", { title, version: data.latestVersion })}
      </h2>
      <p style="color: var(--color-text-secondary); font-size: 0.9em; margin-bottom: 15px;">
        ${format("currentVersion", { current: currentVersion })}
      </p>
      <div style="background: var(--color-bg-primary); padding: 15px; border-radius: 8px; width: 100%; margin: 10px 0; text-align: left; border: 1px solid var(--color-border-light-tertiary); max-height: 40vh; overflow-y: auto;">
        <p style="margin:0 0 5px 0; font-weight:bold; color: var(--color-text-primary);">
          ${localize("patchHighlights")}
        </p>
        <p style="margin:0; color: var(--color-text-primary); line-height: 1.4; white-space: pre-wrap;">${data.notes ?? ""}</p>
      </div>
      ${data.critical ? `<p style="color: var(--color-text-error); font-weight: bold; margin-top: 10px;">${localize("criticalWarning")}</p>` : ""}
      ${checkboxHtml}
    </div>
  `;

  await DialogV2.wait({
    window: {
      title: format("updateAvailable", { title }),
      icon: "fas fa-bell",
      width: 400,
    },
    content,
    buttons: [
      {
        action: "confirm",
        label: localize("confirm"),
        icon: "fas fa-check",
        default: true,
        callback: async (event, button, dialog) => {
          const root = dialog?.element ?? dialog;
          const checkbox = root?.querySelector?.("#gs-skip-update-checkbox");
          if (checkbox?.checked) {
            await setSetting(moduleId, SKIPPED_VERSION, data.latestVersion);
          }
        },
      },
      {
        action: "disable",
        label: localize("disableNotification"),
        icon: "fas fa-bell-slash",
        callback: async () => {
          await setSetting(moduleId, DISABLE, true);
          ui.notifications?.info(localize("disableConfirm"));
        },
      },
    ],
  });
}

export async function showAnnouncementDialog({ mod, announcement }) {
  const { DialogV2 } = foundry.applications.api;
  const moduleId = mod.id;
  const title = mod.title || mod.id;

  const content = `
    <div style="padding: 10px; color: var(--color-text-primary);">
      <p style="font-size: 1.1em; line-height: 1.5;">${announcement.content ?? ""}</p>
    </div>
  `;

  await DialogV2.wait({
    window: {
      title: announcement.title || format("announcementTitle", { title }),
      icon: "fas fa-bullhorn",
      width: 400,
    },
    content,
    buttons: [
      {
        action: "ok",
        label: localize("confirmNotice"),
        icon: "fas fa-check",
        default: true,
      },
      {
        action: "close",
        label: localize("close"),
        icon: "fas fa-times",
      },
    ],
  });

  await setSetting(moduleId, LAST_SEEN_NOTICE_ID, announcement.id);
}
