import {
  ACTOR_METRIC_PROVIDER_IDS,
  ACTOR_METRIC_READ_MODES,
  MODULE_ID,
  HOOKS,
  SOURCES,
  CURRENCY_TYPES,
  SETTING_KEYS,
} from "../constants.js";
import { openNotifierBoard } from "../notifier/index.js";
import { currency } from "./currency.js";
import { time } from "./time.js";
import { actorSheetMenu } from "../ui/actor-sheet-menu.js";
import { actorMetrics } from "./actor-metrics.js";

let exposedApi = null;

export function exposeApi() {
  const module = game.modules.get(MODULE_ID);
  if (!module) {
    console.warn(`GlitchSmith Library | Module record not found for '${MODULE_ID}'.`);
    return null;
  }

  if (exposedApi) {
    module.api = exposedApi;
    return exposedApi;
  }

  const api = Object.freeze({
    actorMetrics,
    currency,
    time,
    actorSheetMenu,
    notifier: Object.freeze({
      openBoard: openNotifierBoard,
    }),
    constants: Object.freeze({
      HOOKS,
      SOURCES,
      CURRENCY_TYPES,
      SETTING_KEYS,
      ACTOR_METRIC_PROVIDER_IDS,
      ACTOR_METRIC_READ_MODES,
      MODULE_ID,
    }),
  });

  module.api = api;
  exposedApi = api;
  return api;
}
