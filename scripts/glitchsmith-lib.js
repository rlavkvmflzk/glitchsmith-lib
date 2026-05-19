import { MODULE_ID, HOOKS } from "./constants.js";
import { registerSettings } from "./settings/index.js";
import { registerSocketHandlers } from "./socket/index.js";
import { exposeApi } from "./api/index.js";
import { applyDecimalPresetMigration } from "./api/preset-migrations.js";
import { registerSystemPreset } from "./api/presets.js";
import { registerSheetCurrencyDriver } from "./api/sheet-currency.js";
import { registerSheetHeader } from "./ui/sheet-header.js";
import {
  registerNotifierSettingsForTargets,
  runAutoDiscovery,
} from "./notifier/index.js";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
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

Hooks.once("ready", async () => {
  console.log(`${MODULE_ID} | ready`);
  registerSocketHandlers();
  const api = exposeApi();
  Hooks.callAll(HOOKS.READY, { api });
  await applyDecimalPresetMigration();
  await runAutoDiscovery();
});
