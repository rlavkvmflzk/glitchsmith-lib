import assert from "node:assert/strict";
import test from "node:test";

globalThis.FormApplication = class {};
globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: Base => class extends Base {},
    },
  },
};

const moduleRecord = { id: "glitchsmith-lib", api: null };
globalThis.game = {
  modules: new Map([["glitchsmith-lib", moduleRecord]]),
  system: { id: "dnd5e", title: "D&D 5e", version: "5" },
};

const { exposeApi } = await import("../scripts/api/index.js");

test("init and ready exposure reuse the same API object", () => {
  const initApi = exposeApi();
  assert.equal(moduleRecord.api, initApi);
  assert.equal(typeof initApi.actorMetrics.read, "function");
  assert.equal(initApi.constants.ACTOR_METRIC_PROVIDER_IDS.GENERIC, "builtin.generic");
  assert.equal(initApi.constants.ACTOR_METRIC_READ_MODES.DIRECT, "direct");

  moduleRecord.api = null;
  const readyApi = exposeApi();
  assert.equal(readyApi, initApi);
  assert.equal(moduleRecord.api, initApi);
});
