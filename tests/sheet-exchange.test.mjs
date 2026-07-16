import assert from "node:assert/strict";
import test from "node:test";

const definitions = {
  base: "gold",
  currencies: {
    gold: {
      type: "sheet",
      rate: 1,
      integer: true,
      precision: 0,
      actorPath: "system.gold",
    },
    silver: {
      type: "sheet",
      rate: 0.1,
      integer: false,
      precision: 2,
      increment: 0.05,
      actorPath: "system.silver",
    },
  },
};

const actor = {
  id: "actor-1",
  uuid: "Actor.actor-1",
  system: { gold: 10, silver: 0 },
  updateCount: 0,
  async update(updates) {
    this.updateCount += 1;
    for (const [path, value] of Object.entries(updates)) {
      const key = path.split(".").at(-1);
      this.system[key] = value;
    }
  },
};

const gm = { id: "gm", isGM: true };
globalThis.FormApplication = class {};
globalThis.foundry = {
  utils: {
    deepClone: structuredClone,
    mergeObject: (base, extra) => ({ ...base, ...extra }),
    getProperty(source, path) {
      return path.split(".").reduce((value, key) => value?.[key], source);
    },
  },
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: Base => class extends Base {},
    },
  },
};
globalThis.Hooks = { callAll() {} };
globalThis.game = {
  system: { id: "test-system" },
  user: gm,
  users: { get: id => (id === gm.id ? gm : null) },
  actors: { get: id => (id === actor.id ? actor : null) },
  settings: {
    get(moduleId, key) {
      if (moduleId === "glitchsmith-lib" && key === "currency.definitions") {
        return structuredClone(definitions);
      }
      return null;
    },
  },
};
let resolveCallCount = 0;
let mutateBeforeSecondResolve = null;
globalThis.fromUuid = async uuid => {
  resolveCallCount += 1;
  if (resolveCallCount === 2 && mutateBeforeSecondResolve) {
    const mutate = mutateBeforeSecondResolve;
    mutateBeforeSecondResolve = null;
    mutate();
  }
  return uuid === actor.uuid ? actor : null;
};

const { writeModifySheetBalances } = await import("../scripts/api/sheet-currency.js");

function exchangeDeltas() {
  resolveCallCount = 0;
  return writeModifySheetBalances({
    actorUuid: actor.uuid,
    actorId: actor.id,
    deltasById: { gold: -1, silver: 0.05 },
    requesterId: gm.id,
    requireExactDeltas: true,
  });
}

test("strict sheet exchange rejects a misaligned source balance before writing", async () => {
  actor.system = { gold: 10.5, silver: 0 };
  actor.updateCount = 0;

  const result = await exchangeDeltas();

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "INVALID_SHEET_BALANCE");
  assert.equal(actor.updateCount, 0);
  assert.deepEqual(actor.system, { gold: 10.5, silver: 0 });
});

test("strict sheet exchange rejects a misaligned target balance before writing", async () => {
  actor.system = { gold: 10, silver: 0.01 };
  actor.updateCount = 0;

  const result = await exchangeDeltas();

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "INVALID_SHEET_BALANCE");
  assert.equal(actor.updateCount, 0);
  assert.deepEqual(actor.system, { gold: 10, silver: 0.01 });
});

test("strict sheet exchange applies two exact deltas in one Actor update", async () => {
  actor.system = { gold: 10, silver: 0 };
  actor.updateCount = 0;

  const result = await exchangeDeltas();

  assert.equal(result.success, true);
  assert.equal(actor.updateCount, 1);
  assert.deepEqual(actor.system, { gold: 9, silver: 0.05 });
  assert.deepEqual(result.before, { gold: 10, silver: 0 });
  assert.deepEqual(result.after, { gold: 9, silver: 0.05 });
});

test("aborts when a sheet balance changes between validation and the Actor update", async () => {
  actor.system = { gold: 10, silver: 0 };
  actor.updateCount = 0;
  mutateBeforeSecondResolve = () => {
    actor.system.gold = 20;
  };

  const result = await exchangeDeltas();

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "BALANCE_CHANGED");
  assert.equal(actor.updateCount, 0);
  assert.deepEqual(actor.system, { gold: 20, silver: 0 });
});
