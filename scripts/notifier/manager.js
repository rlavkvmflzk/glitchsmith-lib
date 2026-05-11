import { MODULE_ID } from "../constants.js";
import { NOTIFIER_SETTING_KEYS, NOTIFIER_LOG_PREFIX } from "./constants.js";

const { DISABLE } = NOTIFIER_SETTING_KEYS;

function findDisabledModules() {
  const disabled = [];
  for (const mod of game.modules) {
    if (!mod.active) continue;
    if (mod.id === MODULE_ID) continue;
    const settingPath = `${mod.id}.${DISABLE}`;
    if (!game.settings.settings.has(settingPath)) continue;
    try {
      if (game.settings.get(mod.id, DISABLE) === true) {
        disabled.push(mod);
      }
    } catch {
      continue;
    }
  }
  return disabled;
}

async function showManagerDialog() {
  const { DialogV2 } = foundry.applications.api;
  const disabled = findDisabledModules();

  if (disabled.length === 0) {
    ui.notifications?.info(
      game.i18n.localize("GLITCHSMITH-LIB.notifier.managerNoneDisabled")
    );
    return;
  }

  const list = disabled.map((m) => `<li>${m.title || m.id}</li>`).join("");
  const content = `
    <p>${game.i18n.format("GLITCHSMITH-LIB.notifier.managerSummary", {
      count: disabled.length,
    })}</p>
    <ul style="margin: 8px 0 12px 16px;">${list}</ul>
    <p>${game.i18n.localize("GLITCHSMITH-LIB.notifier.managerConfirm")}</p>
  `;

  const result = await DialogV2.confirm({
    window: {
      title: game.i18n.localize("GLITCHSMITH-LIB.notifier.managerTitle"),
      icon: "fas fa-bell",
    },
    content,
    yes: { label: game.i18n.localize("GLITCHSMITH-LIB.notifier.managerYes") },
    no: { label: game.i18n.localize("GLITCHSMITH-LIB.notifier.managerNo") },
  });
  if (!result) return;

  let count = 0;
  for (const mod of disabled) {
    try {
      await game.settings.set(mod.id, DISABLE, false);
      count++;
    } catch (err) {
      console.warn(
        `${NOTIFIER_LOG_PREFIX} failed to re-enable ${mod.id}:`,
        err?.message ?? err
      );
    }
  }
  ui.notifications?.info(
    game.i18n.format("GLITCHSMITH-LIB.notifier.managerSuccess", { count })
  );
}

export class NotifierManagerLauncher extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "glitchsmith-notifier-manager-launcher",
      title: "",
      template: null,
      popOut: false,
    });
  }

  async render() {
    await showManagerDialog();
    return this;
  }

  async close() {
    return Promise.resolve();
  }

  async _updateObject() {}
}
