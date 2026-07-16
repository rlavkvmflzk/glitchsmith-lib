import assert from "node:assert/strict";
import test from "node:test";

const definitions = {
  base: "coin",
  currencies: {
    coin: { type: "virtual", rate: 1, integer: true, precision: 0, increment: 1 },
    token: { type: "virtual", rate: 1, integer: false, precision: 2, increment: 0.05 },
  },
};
const state = { wallets: {}, writes: 0 };

globalThis.FormApplication = class {};
globalThis.foundry = {
  utils: {
    deepClone: structuredClone,
    mergeObject: (base, extra) => ({ ...base, ...extra }),
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
  settings: {
    get(moduleId, key) {
      assert.equal(moduleId, "glitchsmith-lib");
      if (key === "currency.definitions") return structuredClone(definitions);
      if (key === "currency.wallets") return structuredClone(state.wallets);
      return null;
    },
    async set(moduleId, key, value) {
      assert.equal(moduleId, "glitchsmith-lib");
      assert.equal(key, "currency.wallets");
      state.writes += 1;
      state.wallets = structuredClone(value);
      return value;
    },
  },
};

const { writeModifyBalances } = await import("../scripts/api/wallets.js");

function reset(wallet = { coin: 10, token: 1 }) {
  state.wallets = { "actor-1": structuredClone(wallet) };
  state.writes = 0;
}

test("batch wallet mutation validates then persists all deltas in one write", async () => {
  reset();

  const result = await writeModifyBalances({
    actorId: "actor-1",
    deltasById: { coin: -2, token: 0.1 },
  });

  assert.equal(result.success, true);
  assert.equal(state.writes, 1);
  assert.deepEqual(state.wallets["actor-1"], { coin: 8, token: 1.1 });
});

test("batch wallet mutation rejects a fractional whole-unit delta without writing", async () => {
  reset();

  const result = await writeModifyBalances({
    actorId: "actor-1",
    deltasById: { coin: -0.5, token: 0.1 },
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "INVALID_AMOUNT_INCREMENT");
  assert.equal(state.writes, 0);
  assert.deepEqual(state.wallets["actor-1"], { coin: 10, token: 1 });
});

test("batch wallet mutation rejects unsafe or misaligned stored balances", async () => {
  reset({ coin: Number.MAX_SAFE_INTEGER, token: 1 });
  const overflow = await writeModifyBalances({
    actorId: "actor-1",
    deltasById: { coin: 1 },
  });
  assert.equal(overflow.success, false);
  assert.equal(overflow.errorCode, "AMOUNT_NORMALIZATION_MISMATCH");
  assert.equal(state.writes, 0);

  reset({ coin: 10, token: 1.01 });
  const misaligned = await writeModifyBalances({
    actorId: "actor-1",
    deltasById: { token: 0.05 },
  });
  assert.equal(misaligned.success, false);
  assert.equal(misaligned.errorCode, "INVALID_WALLET_BALANCE");
  assert.equal(state.writes, 0);
});
