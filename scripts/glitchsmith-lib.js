import { MODULE_ID, HOOKS } from "./constants.js";
import { registerSettings } from "./settings/index.js";
import { registerSocketHandlers } from "./socket/index.js";
import { exposeApi } from "./api/index.js";
import {
  registerNotifierSettingsForTargets,
  runAutoDiscovery,
} from "./notifier/index.js";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  registerSettings();
  registerNotifierSettingsForTargets();
});

Hooks.once("ready", async () => {
  console.log(`${MODULE_ID} | ready`);
  registerSocketHandlers();
  const api = exposeApi();
  Hooks.callAll(HOOKS.READY, { api });
  await runAutoDiscovery();
});
