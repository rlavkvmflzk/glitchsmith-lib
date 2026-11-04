import assert from "node:assert/strict";
import test from "node:test";

globalThis.FormApplication = class {};
globalThis.foundry = {
  utils: { deepClone: structuredClone, mergeObject: (base, extra) => ({ ...base, ...extra }) },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => class extends Base {} } },
};
const { WalletStore } = await import("../scripts/api/wallet-store.js");
const Wallets = await import("../scripts/api/wallets.js");
const MODULE = "glitchsmith-lib", FLAG = "walletLedgerV1", ARCHIVE = "currency.walletLedgerArchive";
const clone = structuredClone;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(baseline = { actor: { coin: 10, token: 1 } }) {
  const hooks = new Map(), socketEvents = new Map();
  const state = { writes: 0, balanceWrites: 0, failBefore: false, failAfter: false, events: [], nativeReads: 0, getGate: null, writeGate: null };
  globalThis.Hooks = {
    on(name, callback) { const list = hooks.get(name) || []; list.push(callback); hooks.set(name, list); },
    callAll(name, ...args) {
      if (name === "glitchsmith-lib.currency.balanceChanged") state.events.push(clone(args[0]));
      for (const callback of hooks.get(name) || []) callback(...args);
    },
  };
  const serverUsers = new Map();
  const userCollection = new Map();
  function setFlagPath(target, path, value) {
    const parts = path.split(".");
    let current = target;
    for (const part of parts.slice(0, -1)) current = current[part] ??= {};
    const key = parts.at(-1);
    if (key.startsWith("-=")) delete current[key.slice(2)];
    else current[key] = clone(value);
  }
  function user(id, isGM = false, flags = {}) {
    const value = {
      id, isGM, active: true, flags: clone(flags),
      updateSource(changes) { for (const [path, next] of Object.entries(changes)) setFlagPath(this, path, next); },
      async update(changes) {
        state.writes++;
        if (state.failBefore) throw new Error("save rejected");
        const entries = Object.values(changes);
        if (state.writeGate && entries.some(entry => entry?.phase === "completed")) {
          const gate = state.writeGate; state.writeGate = null; gate.started?.resolve(); await gate.promise;
        }
        if (entries.some(entry => entry?.patch || entry?.replace)) state.balanceWrites++;
        this.updateSource(changes);
        serverUsers.set(this.id, { id: this.id, flags: clone(this.flags) });
        Hooks.callAll("updateUser", this, changes);
        if (state.failAfter === true || entries.some(entry => entry?.phase === state.failAfter)) throw new Error("acknowledgement lost");
        return this;
      },
    };
    userCollection.set(id, value);
    serverUsers.set(id, { id, flags: clone(flags) });
    return value;
  }
  const player = user("player"), other = user("other"), gm = user("gm", true);
  const settings = new Map(), serverSettings = new Map(), defaults = new Map();
  function setting(key, value) {
    return { id: key, key: `${MODULE}.${key}`, value: clone(value),
      toObject() { return { value: clone(this.value) }; },
      updateSource(changes) { this.value = clone(changes.value); },
    };
  }
  function seedSetting(key, value) {
    settings.set(key, setting(key, value)); serverSettings.set(key, setting(key, value));
  }
  seedSetting("currency.wallets", baseline);
  seedSetting("currency.definitions", { base: "coin", currencies: {
    coin: { type: "virtual", rate: 1, integer: true, precision: 0, increment: 1 },
    token: { type: "virtual", rate: 1, integer: false, precision: 2, increment: 0.05 },
  } });
  settings.find = predicate => [...settings.values()].find(predicate);
  settings.documentClass = { database: { async get() {
    return [...serverSettings.values()].filter(doc => ["currency.wallets", ARCHIVE].some(key => doc.key === `${MODULE}.${key}`))
      .map(doc => setting(doc.id, doc.value));
  } } };
  userCollection.documentClass = { database: { async get() {
    state.nativeReads++;
    const snapshots = [...serverUsers.values()].map(value => clone(value));
    if (state.getGate) { const gate = state.getGate; state.getGate = null; await gate.promise; }
    return snapshots;
  } } };
  globalThis.game = {
    user: player, users: userCollection,
    socket: { connected: true,
      on(name, callback) { socketEvents.set(name, callback); },
      io: { on() {} },
    },
    settings: {
      storage: new Map([["world", settings]]),
      register(namespace, key, config) { defaults.set(key, clone(config.default)); },
      get(namespace, key, options) { return options?.document ? settings.get(key) : clone(settings.get(key)?.value ?? defaults.get(key)); },
      async set(namespace, key, value) {
        assert.equal(game.user.isGM, true, "players cannot write world settings");
        seedSetting(key, value); Hooks.callAll("updateSetting", settings.get(key)); return clone(value);
      },
    },
  };
  WalletStore.registerSettings(); WalletStore.install();
  WalletStore.setLegacyDispatcher(wallets => WalletStore.transaction(async () => {
    await WalletStore.replace(wallets, { full: true }); return { success: true };
  }));
  return { ...state, state, player, other, gm, user, settings, serverSettings, serverUsers, socketEvents, seedSetting };
}

const change = (operationId, deltasById, extra = {}) => WalletStore.transaction(
  () => Wallets.writeModifyBalances({ actorId: "actor", deltasById }), { operationId, actorId: "actor", ...extra });

test("legacy balances remain intact while player ledger writes project through all readers", async () => {
  const f = fixture();
  assert.deepEqual(Wallets.getAllWallets(), { actor: { coin: 10, token: 1 } });
  const result = await change("first", { coin: -2, token: 0.1 });
  assert.equal(result.success, true);
  assert.equal(f.state.balanceWrites, 1);
  assert.equal(f.state.writes, 2);
  assert.deepEqual(Wallets.getWallet("actor"), { coin: 8, token: 1.1 });
  assert.deepEqual(game.settings.get(MODULE, "currency.wallets"), Wallets.getAllWallets());
  assert.deepEqual(f.settings.get("currency.wallets").value, { actor: { coin: 10, token: 1 } });
  assert.equal(Object.keys(f.player.flags[MODULE][FLAG]).length, 1);
});

test("staged wallet changes and success hooks stay private until the atomic commit", async () => {
  const f = fixture(), gate = deferred(), staged = deferred();
  const pending = WalletStore.transaction(async () => {
    const result = await Wallets.writeModifyBalances({ actorId: "actor", deltasById: { coin: -2, token: 0.1 } });
    staged.resolve(); await gate.promise; return result;
  }, { operationId: "staged", actorId: "actor" });
  await staged.promise;
  assert.equal(Wallets.getBalance("actor", "coin"), 10);
  assert.equal(WalletStore.get({ draft: true }).actor.coin, 8);
  assert.equal(f.state.events.length, 0);
  assert.equal(f.state.balanceWrites, 0);
  assert.equal(f.state.writes, 1);
  gate.resolve(); await pending;
  assert.equal(Wallets.getBalance("actor", "coin"), 8);
  assert.equal(f.state.events.length, 2);
});

test("a two-Actor transfer commits its debit and credit in one balance update", async () => {
  const f = fixture({ actor: { coin: 10 }, recipient: { coin: 4 } });
  const result = await WalletStore.transaction(() => Wallets.writeTransferBalance({
    fromActorId: "actor", toActorId: "recipient", currencyId: "coin", amount: 3,
  }), { operationId: "transfer", actorId: "actor" });
  assert.equal(result.success, true);
  assert.equal(f.state.balanceWrites, 1);
  assert.equal(f.state.writes, 2);
  assert.deepEqual(Wallets.getAllWallets(), { actor: { coin: 7 }, recipient: { coin: 7 } });
});

test("a rejected batch changes neither balances nor success notifications", async () => {
  const f = fixture();
  const result = await change("rejected", { coin: -2, token: -5 });
  assert.equal(result.success, false);
  assert.deepEqual(Wallets.getWallet("actor"), { coin: 10, token: 1 });
  assert.equal(f.state.events.length, 0);
});

test("native persistence failure is unknown and does not emit success hooks", async () => {
  const f = fixture(); f.state.failBefore = true;
  const result = await change("save-failure", { coin: -2 });
  assert.equal(result.commitUnknown, true);
  assert.equal(Wallets.getBalance("actor", "coin"), 10);
  assert.equal(f.state.events.length, 0);
});

test("an accepted write with a lost reply is confirmed natively without a second debit", async () => {
  const f = fixture(); f.state.failAfter = "completed";
  assert.equal((await change("lost-reply", { coin: -2 })).success, true);
  assert.equal(f.state.events.length, 1);
  assert.equal(f.state.nativeReads, 1);
  f.state.failAfter = false;
  const result = await change("lost-reply", { coin: -2 });
  assert.equal(result.success, true);
  assert.equal(f.state.writes, 2);
  assert.equal(Wallets.getBalance("actor", "coin"), 8);
  assert.equal(f.state.events.length, 1);
});

test("an accepted reservation with a lost reply continues once after native confirmation", async () => {
  const f = fixture(); f.state.failAfter = "pending"; let calls = 0;
  const result = await WalletStore.transaction(async () => {
    calls++; return Wallets.writeModifyBalances({ actorId: "actor", deltasById: { coin: -2 } });
  }, { operationId: "pending-ack", actorId: "actor" });
  assert.equal(result.success, true);
  assert.equal(calls, 1);
  assert.equal(f.state.writes, 2);
  assert.equal(f.state.balanceWrites, 1);
  assert.equal(f.state.nativeReads, 1);
  assert.equal(Wallets.getBalance("actor", "coin"), 8);
});

test("a lost external completion acknowledgement recovers its receipt without repeating the sheet write", async () => {
  const f = fixture(); f.state.failAfter = "completed"; let sheetWrites = 0;
  const run = () => { sheetWrites++; return { success: true, before: 10, after: 8 }; };
  const result = await WalletStore.transaction(run, { operationId: "sheet-complete-ack", actorId: "actor", external: true });
  assert.equal(result.success, true);
  assert.equal(result.after, 8);
  assert.equal(sheetWrites, 1);
  assert.equal(f.state.nativeReads, 1);
  await WalletStore.transaction(run, { operationId: "sheet-complete-ack", actorId: "actor", external: true });
  assert.equal(sheetWrites, 1);
  f.state.failAfter = false;
  assert.equal((await change("following-wallet-write", { coin: -1 })).success, true);
});

test("external pending receipts block both same and new requests for that Actor", async () => {
  const f = fixture(); let calls = 0;
  const run = () => { calls++; throw new Error("sheet response lost"); };
  const first = await WalletStore.transaction(run, { operationId: "sheet-one", actorId: "actor", external: true });
  assert.equal(first.commitUnknown, true);
  assert.equal((await WalletStore.transaction(run, { operationId: "sheet-one", actorId: "actor", external: true })).commitUnknown, true);
  assert.equal((await WalletStore.transaction(run, { operationId: "sheet-two", actorId: "actor", external: true })).commitUnknown, true);
  assert.equal(calls, 1);
  game.user = f.other;
  assert.equal(await WalletStore.ready({ force: true }), true);
  assert.equal((await WalletStore.transaction(run, { operationId: "sheet-three", actorId: "actor", external: true })).commitUnknown, true);
  assert.equal(calls, 1);
});

test("definite external rejection completes the receipt and allows later operations", async () => {
  fixture(); let calls = 0;
  const reject = () => { calls++; return { success: false, error: "insufficient sheet balance" }; };
  await WalletStore.transaction(reject, { operationId: "sheet-reject", actorId: "actor", external: true });
  await WalletStore.transaction(reject, { operationId: "sheet-reject", actorId: "actor", external: true });
  assert.equal(calls, 1);
  const next = await WalletStore.transaction(() => ({ success: true }), { operationId: "sheet-later", actorId: "actor", external: true });
  assert.equal(next.success, true);
});

test("GM full restore replaces old ledger balances without changing the released baseline", async () => {
  const f = fixture(); await change("before-restore", { coin: -2 });
  game.user = f.gm;
  await game.settings.set(MODULE, "currency.wallets", { fresh: { coin: 20 } });
  assert.deepEqual(Wallets.getAllWallets(), { fresh: { coin: 20 } });
  assert.deepEqual(f.settings.get("currency.wallets").value, { actor: { coin: 10, token: 1 } });
  game.user = f.other;
  const result = await WalletStore.transaction(() => Wallets.writeSetBalance({ actorId: "actor", currencyId: "coin", value: 3 }), { operationId: "after-restore" });
  assert.equal(result.success, true);
  assert.deepEqual(Wallets.getAllWallets(), { fresh: { coin: 20 }, actor: { coin: 3 } });
  await assert.rejects(game.settings.set(MODULE, "currency.wallets", {}), /Permission denied/);
  game.user = f.gm;
  await assert.rejects(game.settings.set(MODULE, "currency.wallets", { actor: { coin: NaN } }), /finite/);
});

test("GM bulk replace and exchange use the same current wallet projection", async () => {
  const f = fixture(); await change("prior", { coin: -2 }); game.user = f.gm;
  await WalletStore.transaction(() => Wallets.writeExchangeBalances({ actorId: "actor", fromCurrencyId: "coin", toCurrencyId: "token", fromAmount: 2, toAmount: 0.5 }), { operationId: "exchange" });
  assert.deepEqual(Wallets.getWallet("actor"), { coin: 6, token: 1.5 });
  await WalletStore.transaction(() => Wallets.writeBulkImport({ wallets: { restored: { coin: 15 } }, mode: "replace" }), { operationId: "bulk" });
  assert.deepEqual(Wallets.getAllWallets(), { restored: { coin: 15 } });
});

test("deleted user archives preserve both balances and completed receipts across reload", async () => {
  const f = fixture(); await change("archived-write", { coin: -2 });
  game.user = f.gm; game.users.activeGM = f.gm;
  game.users.delete(f.player.id); f.serverUsers.delete(f.player.id);
  Hooks.callAll("deleteUser", f.player); await WalletStore._archiveQueue;
  assert.equal(Wallets.getBalance("actor", "coin"), 8);
  assert.ok(f.settings.get(ARCHIVE).value.player);
  WalletStore._removed.clear();
  assert.equal(await WalletStore.ready({ force: true }), true);
  assert.equal(Wallets.getBalance("actor", "coin"), 8);
  assert.equal(WalletStore.getReceipt("archived-write").success, true);
});

test("native recovery restores missed flag, baseline, archive, and receipt updates only", async () => {
  const f = fixture();
  f.other.flags.unrelated = { keep: true };
  f.serverUsers.get("other").flags[MODULE] = { [FLAG]: { saved: {
    clock: 7, phase: "completed", operationId: "offline", patch: { actor: { coin: 3 } }, result: { success: true },
  } } };
  f.serverSettings.get("currency.wallets").value = { actor: { coin: 10, token: 5 }, newActor: { coin: 8 } };
  assert.equal(await WalletStore.ready({ force: true }), true);
  assert.deepEqual(Wallets.getAllWallets(), { actor: { coin: 3, token: 5 }, newActor: { coin: 8 } });
  assert.deepEqual(f.other.flags.unrelated, { keep: true });
  assert.equal(WalletStore.getReceipt("offline").success, true);
});

test("a live update during native refresh is not replaced by an older snapshot", async () => {
  const f = fixture(), gate = deferred(); f.state.getGate = gate;
  const ready = WalletStore.ready({ force: true }); await Promise.resolve();
  await f.other.update({ [`flags.${MODULE}.${FLAG}.newer`]: {
    clock: 10, phase: "completed", patch: { actor: { coin: 4 } }, result: { success: true },
  } });
  gate.resolve(); assert.equal(await ready, true);
  assert.equal(f.state.nativeReads, 2);
  assert.equal(Wallets.getBalance("actor", "coin"), 4);
});

test("repeated reconnect discards the earlier pending snapshot and repeats recovery", async () => {
  const f = fixture(), gate = deferred(); f.state.getGate = gate;
  const first = WalletStore.ready({ force: true }); await Promise.resolve();
  game.socket.connected = false; f.socketEvents.get("disconnect")();
  f.serverUsers.get("other").flags[MODULE] = { [FLAG]: { fresh: {
    clock: 9, phase: "completed", patch: { actor: { coin: 6 } }, result: { success: true },
  } } };
  game.socket.connected = true; f.socketEvents.get("connect")();
  gate.resolve(); assert.equal(await first, true);
  assert.equal(f.state.nativeReads, 2);
  assert.equal(Wallets.getBalance("actor", "coin"), 6);
});

test("disconnected writers cannot save until native recovery succeeds", async () => {
  const f = fixture(); game.socket.connected = false; f.socketEvents.get("disconnect")();
  assert.equal((await change("offline-write", { coin: -2 })).success, false);
  assert.equal(f.state.balanceWrites, 0);
  game.socket.connected = true;
  assert.equal((await change("online-write", { coin: -2 })).success, true);
  assert.equal(f.state.nativeReads, 1);
});

test("coordinator loss discards a staged virtual mutation and leaves external work pending", async () => {
  const f = fixture(); let allowed = true;
  const result = await WalletStore.transaction(async () => {
    const changed = await Wallets.writeModifyBalances({ actorId: "actor", deltasById: { coin: -2 } });
    allowed = false; return changed;
  }, { operationId: "handoff", actorId: "actor", guard: () => allowed });
  assert.equal(result.retryCoordinator, true);
  assert.equal(f.state.balanceWrites, 0);
  assert.equal(Wallets.getBalance("actor", "coin"), 10);
  allowed = true;
  const external = await WalletStore.transaction(() => { allowed = false; return { success: true }; }, {
    operationId: "external-handoff", actorId: "actor", external: true, guard: () => allowed,
  });
  assert.equal(external.commitUnknown, true);
  assert.equal(WalletStore.getReceipt("external-handoff").commitUnknown, true);
});

test("a new GM cannot overwrite an older executor's delayed native balance commit", async () => {
  const f = fixture(), gate = deferred(); gate.started = deferred(); f.state.writeGate = gate;
  const oldWrite = change("old-executor", { coin: -2 });
  await gate.started.promise;
  assert.equal(WalletStore.getReceipt("old-executor").commitUnknown, true);
  game.user = f.gm;
  assert.equal(await WalletStore.ready({ force: true }), true);
  const blocked = await change("new-executor", { coin: -1 });
  assert.equal(blocked.commitUnknown, true);
  assert.equal(f.state.balanceWrites, 0);
  gate.resolve(); assert.equal((await oldWrite).success, true);
  assert.equal(await WalletStore.ready({ force: true }), true);
  assert.equal((await change("new-executor", { coin: -1 })).success, true);
  assert.equal(Wallets.getBalance("actor", "coin"), 7);
  assert.equal(f.state.balanceWrites, 2);
});

test("full restores and transfers cannot bypass an overlapping pending Actor operation", async () => {
  const f = fixture({ actor: { coin: 10 }, otherActor: { coin: 5 } });
  await WalletStore.transaction(() => { throw new Error("unconfirmed sheet update"); }, {
    operationId: "actor-pending", actorId: "actor", external: true,
  });
  game.user = f.gm;
  await assert.rejects(game.settings.set(MODULE, "currency.wallets", {}), /awaiting confirmation/);
  let called = false;
  const blocked = await WalletStore.transaction(() => { called = true; return { success: true }; }, {
    operationId: "incoming-transfer", actorId: "otherActor", resources: ["otherActor", "actor"],
  });
  assert.equal(blocked.commitUnknown, true);
  assert.equal(called, false);
  const separate = await WalletStore.transaction(() => Wallets.writeModifyBalances({ actorId: "otherActor", deltasById: { coin: -1 } }), {
    operationId: "independent", actorId: "otherActor",
  });
  assert.equal(separate.success, true);
  assert.equal(Wallets.getBalance("otherActor", "coin"), 4);
});

test("a definite callback failure completes its reservation without saving staged currency", async () => {
  const f = fixture();
  const failed = await WalletStore.transaction(async () => {
    await Wallets.writeModifyBalances({ actorId: "actor", deltasById: { coin: -2 } });
    throw new Error("validation failed after staging");
  }, { operationId: "callback-failure", actorId: "actor" });
  assert.equal(failed.success, false);
  assert.equal(failed.commitUnknown, undefined);
  assert.equal(f.state.balanceWrites, 0);
  assert.equal(f.state.events.length, 0);
  assert.equal((await change("following-success", { coin: -1 })).success, true);
  assert.equal(Wallets.getBalance("actor", "coin"), 9);
});
