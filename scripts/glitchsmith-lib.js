import { MODULE_ID, HOOKS } from "./constants.js";
import { registerSettings } from "./settings/index.js";
import { registerSocketHandlers } from "./socket/index.js";
import { exposeApi } from "./api/index.js";
import { callMenuExtensionRegistrationHook } from "./api/menu-extensions.js";
import { applyDecimalPresetMigration } from "./api/preset-migrations.js";
import { registerSystemPreset } from "./api/presets.js";
import { registerSheetCurrencyDriver } from "./api/sheet-currency.js";
import { registerSheetHeader } from "./ui/sheet-header.js";
import { registerActorSheetMenuHooks } from "./ui/actor-sheet-menu.js";
import { showLibraryVersionNotice } from "./ui/library-version-notice.js";
import {
  registerNotifierSettingsForTargets,
  runAutoDiscovery,
} from "./notifier/index.js";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  const api = exposeApi();
  Hooks.callAll(HOOKS.REGISTER_ACTOR_METRIC_PROVIDERS, {
    actorMetrics: api?.actorMetrics ?? null,
    register: (...args) => api?.actorMetrics?.registerProvider(...args),
  });
  callMenuExtensionRegistrationHook();
  registerSettings();
  registerNotifierSettingsForTargets();
  registerSheetHeader();
  Hooks.callAll(HOOKS.REGISTER_SYSTEM_PRESETS, {
    register: (systemId, preset) => registerSystemPreset(systemId, preset),
  });
  Hooks.callAll(HOOKS.REGISTER_SHEET_CURRENCY_DRIVERS, {
    register: (systemId, driver) => registerSheetCurrencyDriver(systemId, driver),
  });
});

// Keep this local check independent of migrations and the network-backed announcement board.
Hooks.once("ready", () => {
  void showLibraryVersionNotice().catch(error => console.error(`${MODULE_ID} | Library version check failed.`, error));
});

Hooks.once("ready", async () => {
  console.log(`${MODULE_ID} | ready`);
  registerSocketHandlers();
  const api = exposeApi();
  Hooks.callAll(HOOKS.READY, { api });
  setTimeout(registerActorSheetMenuHooks, 0);
  await applyDecimalPresetMigration();
  await runAutoDiscovery();
});
