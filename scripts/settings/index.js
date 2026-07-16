import { MODULE_ID, SETTING_KEYS, DEFAULT_DEFINITIONS } from "../constants.js";
import { NotifierBoardLauncher } from "../notifier/manager.js";
import { CurrencyDefinitionsDialog } from "../apps/CurrencyDefinitionsDialog.js";

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTING_KEYS.CURRENCY_DEFINITIONS, {
    name: "Currency Definitions",
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(DEFAULT_DEFINITIONS),
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.CURRENCY_WALLETS, {
    name: "Virtual Currency Wallets",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.CURRENCY_MIGRATION_STATE, {
    name: "Currency Migration State",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.WALLET_HIDE_HEADER_BUTTON, {
    name: "GLITCHSMITH-LIB.wallet.hideHeaderButton.name",
    hint: "GLITCHSMITH-LIB.wallet.hideHeaderButton.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.registerMenu(MODULE_ID, "currencyDefinitions", {
    name: game.i18n.localize("GLITCHSMITH-LIB.currency.menu.name"),
    label: game.i18n.localize("GLITCHSMITH-LIB.currency.menu.label"),
    hint: game.i18n.localize("GLITCHSMITH-LIB.currency.menu.hint"),
    icon: "fas fa-coins",
    type: CurrencyDefinitionsDialog,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, "notifierBoard", {
    name: game.i18n.localize("GLITCHSMITH-LIB.notifier.board.menuName"),
    label: game.i18n.localize("GLITCHSMITH-LIB.notifier.board.menuLabel"),
    hint: game.i18n.localize("GLITCHSMITH-LIB.notifier.board.menuHint"),
    icon: "fas fa-bell",
    type: NotifierBoardLauncher,
    restricted: false,
  });
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

export async function setSetting(key, value) {
  return await game.settings.set(MODULE_ID, key, value);
}
