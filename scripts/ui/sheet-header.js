import { MODULE_ID, SETTING_KEYS } from "../constants.js";

const ACTION_NAME = "gsOpenWallet";
const BUTTON_CLASS = "gs-wallet-header-btn";
const ICON = "fas fa-wallet";
const I18N_KEY = "GLITCHSMITH-LIB.wallet.headerButton";

function _getActor(app) {
  return app?.document ?? app?.actor ?? null;
}

function _shouldShow(app) {
  const actor = _getActor(app);
  if (!actor || actor.documentName !== "Actor") return false;
  if (!game.user?.isGM) return false;
  if (game.settings.get(MODULE_ID, SETTING_KEYS.WALLET_HIDE_HEADER_BUTTON)) return false;
  return true;
}

async function _openWallet(actor) {
  if (!actor) return;
  const { WalletDialog } = await import("../apps/WalletDialog.js");
  new WalletDialog(actor).render(true);
}

export function registerSheetHeader() {
  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    if (!_shouldShow(sheet)) return;
    if (buttons.some(b => b.class === BUTTON_CLASS)) return;
    buttons.unshift({
      label: game.i18n.localize(I18N_KEY),
      class: BUTTON_CLASS,
      icon: ICON,
      onclick: () => _openWallet(_getActor(sheet)),
    });
  });

  Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    if (!_shouldShow(app)) return;
    if (controls.some(c => c.action === ACTION_NAME)) return;
    app.options.actions ??= {};
    app.options.actions[ACTION_NAME] ??= function () {
      return _openWallet(_getActor(this));
    };
    controls.unshift({
      action: ACTION_NAME,
      icon: ICON,
      label: game.i18n.localize(I18N_KEY),
    });
  });
}
