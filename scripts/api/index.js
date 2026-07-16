import { MODULE_ID, HOOKS, SOURCES, CURRENCY_TYPES, SETTING_KEYS } from "../constants.js";
import { openNotifierBoard } from "../notifier/index.js";
import { currency } from "./currency.js";
import { time } from "./time.js";

export function exposeApi() {
  const module = game.modules.get(MODULE_ID);
  if (!module) {
    console.warn(`GlitchSmith Library | Module record not found for '${MODULE_ID}'.`);
    return null;
  }

  const api = Object.freeze({
    currency,
    time,
    notifier: Object.freeze({
      openBoard: openNotifierBoard,
    }),
    constants: Object.freeze({
      HOOKS,
      SOURCES,
      CURRENCY_TYPES,
      SETTING_KEYS,
      MODULE_ID,
    }),
  });

  module.api = api;
  return api;
}
