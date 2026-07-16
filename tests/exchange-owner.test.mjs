import assert from "node:assert/strict";
import test from "node:test";

const gm = { id: "gm", isGM: true };
const owner = { id: "owner", isGM: false };
const intruder = { id: "intruder", isGM: false };
const usersById = new Map([gm, owner, intruder].map(user => [user.id, user]));
const users = {
  activeGM: gm,
  get: id => usersById.get(id) ?? null,
};
const actor = {
  id: "actor-1",
  uuid: "Actor.actor-1",
  testUserPermission(user, permission) {
    return permission === "OWNER" && user.id === owner.id;
  },
};
const definitions = {
  base: "usd",
  currencies: {
    usd: { type: "virtual", rate: 1, integer: true, precision: 0 },
    eur: { type: "virtual", rate: 2, integer: true, precision: 0 },
  },
};
const state = {
  wallets: { [actor.id]: { usd: 10, eur: 0 } },
  walletWrites: 0,
  socketListener: null,
  responseResolver: null,
};

globalThis.FormApplication = class {};
globalThis.foundry = {
  utils: {
    deepClone: structuredClone,
    mergeObject: (base, extra) => ({ ...base, ...extra }),
    randomID: () => "request-id",
  },
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: Base => class extends Base {},
    },
  },
};
globalThis.Hooks = { callAll() {} };
globalThis.fromUuid = async uuid => (uuid === actor.uuid ? actor : null);
globalThis.game = {
  user: gm,
  users,
  actors: { get: id => (id === actor.id ? actor : null) },
  system: { id: "test-system" },
  socket: {
    on(channel, listener) {
      assert.equal(channel, "module.glitchsmith-lib");
      state.socketListener = listener;
    },
    emit(channel, message) {
      assert.equal(channel, "module.glitchsmith-lib");
      if (message.type === "response") state.responseResolver?.(message);
    },
  },
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
      state.walletWrites += 1;
      state.wallets = structuredClone(value);
      return value;
    },
  },
};

const { registerSocketHandlers } = await import("../scripts/socket/index.js");
registerSocketHandlers();

function requestExchange(requesterId, requestId) {
  return new Promise(resolve => {
    state.responseResolver = resolve;
    state.socketListener({
      type: "request",
      handlerName: "currency.exchangeBalance",
      requestId,
      data: {
        actorUuid: actor.uuid,
        actorId: actor.id,
        fromCurrencyId: "usd",
        toCurrencyId: "eur",
        amount: 2,
      },
    }, requesterId);
  });
}

test("an actor owner may request a server-authoritative wallet exchange", async () => {
  state.wallets = { [actor.id]: { usd: 10, eur: 0 } };
  state.walletWrites = 0;

  const response = await requestExchange(owner.id, "owner-request");

  assert.equal(response.result.success, true);
  assert.equal(response.result.quote.toAmount, 1);
  assert.equal(state.walletWrites, 1);
  assert.deepEqual(state.wallets[actor.id], { usd: 8, eur: 1 });
});

test("a non-owner exchange request is rejected without a wallet write", async () => {
  state.wallets = { [actor.id]: { usd: 10, eur: 0 } };
  state.walletWrites = 0;

  const response = await requestExchange(intruder.id, "intruder-request");

  assert.equal(response.result.success, false);
  assert.equal(response.result.errorCode, "PERMISSION_DENIED");
  assert.equal(state.walletWrites, 0);
  assert.deepEqual(state.wallets[actor.id], { usd: 10, eur: 0 });
});
