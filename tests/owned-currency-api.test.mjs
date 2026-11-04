import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SOCKET_HANDLERS, SOURCES } from "../scripts/constants.js";

const source = (await readFile(new URL("../scripts/api/currency.js", import.meta.url), "utf8"))
  .replace(/^import[^;]+;\s*/gm, "");
globalThis.__ownedApiConstants = { SOCKET_HANDLERS, SOURCES };
const { currency } = await import(`data:text/javascript;base64,${Buffer.from(`
const { SOCKET_HANDLERS, SOURCES } = globalThis.__ownedApiConstants;
const Socket = Object.fromEntries(["executeAsGM", "executeAsCoordinator", "executeAsOwner"].map(name => [name,
  (...args) => globalThis.ownedApiSocket(name, ...args)]));
const SheetCurrency = { buildActorPayload: (actor, options) => ({ actorId: actor?.id || "", actorUuid: actor?.uuid || "", systemId: options.systemId || game.system.id }) };
${source}
`).toString("base64")}`);

function setup() {
  const calls = []; let sequence = 0;
  globalThis.game = { system: { id: "test-system" } };
  globalThis.foundry = { utils: { randomID: () => `generated-${++sequence}` } };
  globalThis.ownedApiSocket = async (method, name, data) => { calls.push({ method, name, data }); return { success: true }; };
  return calls;
}

test("owned wallet API forwards stable operation identity to the coordinator", async () => {
  const calls = setup();
  await currency.modifyOwnedBalances("actor", { coin: -5 }, { operationId: "bank:wallet:apply", source: "bank", reason: "deposit" });
  assert.deepEqual(calls[0], { method: "executeAsCoordinator", name: "currency.modifyOwnedBalances",
    data: { actorId: "actor", deltasById: { coin: -5 }, operationId: "bank:wallet:apply", source: "bank", reason: "deposit" } });
  await currency.modifyOwnedBalances("actor", { coin: 2 }); assert.equal(calls[1].data.operationId, "generated-1");
});

test("owned sheet API supports actor IDs and synthetic actor UUID payloads", async () => {
  const calls = setup();
  await currency.modifyOwnedSheetBalances("actor", { gold: 3 }, { operationId: "bank:sheet:rollback" });
  assert.deepEqual(calls[0], { method: "executeAsOwner", name: "currency.modifyOwnedSheetBalances", data: {
    actorId: "actor", actorUuid: "", systemId: "test-system", deltasById: { gold: 3 }, operationId: "bank:sheet:rollback", source: "unknown", reason: null,
  } });
  await currency.modifyOwnedSheetBalances({ id: "actor", uuid: "Scene.scene.Token.token.Actor.actor" }, { gold: 1 });
  assert.equal(calls[1].data.actorUuid, "Scene.scene.Token.token.Actor.actor"); assert.equal(calls[1].data.operationId, "generated-1");
});

test("legacy currency APIs retain GM transport and their existing payload contracts", async () => {
  const calls = setup(), actor = { id: "actor", uuid: "Actor.actor" };
  await currency.modifyBalance("actor", "coin", -1, { allowNegative: true });
  await currency.modifyBalances("actor", { coin: 2 }); await currency.setBalance("actor", "coin", 9);
  await currency.modifySheetBalances(actor, { gold: -1 }); await currency.setSheetBalances(actor, { gold: 5 });
  await currency.transferBalance("actor", "recipient", "coin", 2); await currency.bulkImport({ wallets: {} });
  assert.equal(calls.every(call => call.method === "executeAsGM"), true);
  assert.deepEqual(calls.map(call => call.name), [SOCKET_HANDLERS.MODIFY_BALANCE, SOCKET_HANDLERS.MODIFY_BALANCES, SOCKET_HANDLERS.SET_BALANCE,
    SOCKET_HANDLERS.MODIFY_SHEET_BALANCES, SOCKET_HANDLERS.SET_SHEET_BALANCES, SOCKET_HANDLERS.TRANSFER_BALANCE, SOCKET_HANDLERS.BULK_IMPORT]);
  assert.equal(calls[0].data.allowNegative, true); assert.equal(calls[3].data.actorUuid, "Actor.actor");
});

test("owned APIs propagate partial and uncertain results without claiming completion", async () => {
  setup(); const result = { success: false, partialCommit: true, commitUnknown: true, postCommitError: true, rollbackFailed: true };
  globalThis.ownedApiSocket = async () => result;
  assert.deepEqual(await currency.modifyOwnedBalances("actor", { coin: -1 }), result);
  assert.deepEqual(await currency.modifyOwnedSheetBalances("actor", { gold: -1 }), result);
});
