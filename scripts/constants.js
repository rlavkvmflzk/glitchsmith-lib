export const MODULE_ID = "glitchsmith-lib";

export const SOCKET_CHANNEL = `module.${MODULE_ID}`;

export const SETTING_KEYS = Object.freeze({
  CURRENCY_DEFINITIONS: "currency.definitions",
  CURRENCY_WALLETS: "currency.wallets",
  CURRENCY_MIGRATION_STATE: "currency.migrationState",
  WALLET_HIDE_HEADER_BUTTON: "wallet.hideHeaderButton",
  ACTOR_SHEET_MENU_CONSOLIDATE: "actorSheetMenu.consolidate",
});

export const HOOKS = Object.freeze({
  CURRENCY_BALANCE_CHANGED: `${MODULE_ID}.currency.balanceChanged`,
  CURRENCY_DEFINITIONS_CHANGED: `${MODULE_ID}.currency.definitionsChanged`,
  REGISTER_ACTOR_METRIC_PROVIDERS: `${MODULE_ID}.registerActorMetricProviders`,
  REGISTER_MENU_EXTENSIONS: `${MODULE_ID}.registerMenuExtensions`,
  REGISTER_SHEET_CURRENCY_DRIVERS: `${MODULE_ID}.registerSheetCurrencyDrivers`,
  REGISTER_SYSTEM_PRESETS: `${MODULE_ID}.registerSystemPresets`,
  MENU_EXTENSIONS_CHANGED: `${MODULE_ID}.menuExtensionsChanged`,
  READY: `${MODULE_ID}.ready`,
});

export const ACTOR_METRIC_PROVIDER_IDS = Object.freeze({
  GENERIC: "builtin.generic",
  DND5E: "builtin.dnd5e",
  PF2E: "builtin.pf2e",
});

export const ACTOR_METRIC_READ_MODES = Object.freeze({
  AUTO: "auto",
  DIRECT: "direct",
  VALUE: "value",
});

export const SOCKET_HANDLERS = Object.freeze({
  SET_DEFINITIONS: "currency.setDefinitions",
  MODIFY_BALANCE: "currency.modifyBalance",
  MODIFY_BALANCES: "currency.modifyBalances",
  SET_BALANCE: "currency.setBalance",
  TRANSFER_BALANCE: "currency.transferBalance",
  BULK_IMPORT: "currency.bulkImport",
  SET_SHEET_BALANCE: "currency.setSheetBalance",
  MODIFY_SHEET_BALANCE: "currency.modifySheetBalance",
  SET_SHEET_BALANCES: "currency.setSheetBalances",
  MODIFY_SHEET_BALANCES: "currency.modifySheetBalances",
  EXCHANGE_BALANCE: "currency.exchangeBalance",
});

export const DEFAULT_DEFINITIONS = Object.freeze({
  base: "",
  currencies: {},
});

export const CURRENCY_TYPES = Object.freeze({
  VIRTUAL: "virtual",
  SHEET: "sheet",
});

export const SOURCES = Object.freeze({
  LIBRARY: MODULE_ID,
  UNKNOWN: "unknown",
});

export const SOCKET_TIMEOUT_MS = 10000;
