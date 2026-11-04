import assert from "node:assert/strict";
import test from "node:test";
import { createCurrencyServiceFixture } from "./currency-service-fixture.mjs";

let fixture = createCurrencyServiceFixture();
const { registerSocketHandlers } = await import("../scripts/socket/index.js");
const { WalletStore } = await import("../scripts/api/wallet-store.js");
const { currency } = await import("../scripts/api/currency.js");

function reset({ gm = true } = {}) {
  fixture = createCurrencyServiceFixture();
  if (!gm) { fixture.users.activeGM = null; fixture.users[0].active = false; game.user = fixture.users.get("owner"); }
  registerSocketHandlers(); return fixture;
}

test("owned wallet and sheet mutations work with GM offline and keep exactly-once receipts", async () => {
  const f = reset({ gm: false });
  const wallet = await currency.modifyOwnedBalances("actor", { coin: -5, token: 0.1 }, { operationId: "wallet-apply" });
  assert.equal(wallet.success, true); assert.deepEqual(WalletStore.get().actor, { coin: 95, token: 10.1 });
  assert.deepEqual(await currency.modifyOwnedBalances("actor", { coin: -5, token: 0.1 }, { operationId: "wallet-apply" }), wallet); assert.equal(f.userWrites, 2);
  const sheet = await currency.modifyOwnedSheetBalances("actor", { gold: -5, silver: 0.1 }, { operationId: "sheet-apply" });
  assert.equal(sheet.success, true); assert.deepEqual(f.actor.system, { gold: 95, silver: 10.1 });
  assert.deepEqual(await currency.modifyOwnedSheetBalances("actor", { gold: -5, silver: 0.1 }, { operationId: "sheet-apply" }), sheet);
  assert.equal(f.actorWrites, 1); assert.equal(f.userWrites, 4);
});

test("legacy GM wallet and owned operations serialize against one current projection", async () => {
  const f = reset();
  const results = await Promise.all([currency.modifyBalances("actor", { coin: -10 }),
    currency.modifyOwnedBalances("actor", { coin: -15 }, { operationId: "bank-apply" }), currency.modifyBalance("actor", "coin", 7)]);
  assert.equal(results.every(result => result.success), true); assert.equal(WalletStore.get().actor.coin, 82);
  assert.equal(f.userWrites, 6); assert.equal(f.notifications.filter(event => event.currencyId === "coin").length, 3);
});

test("owned mutations enforce actor ownership while legacy wallet writes remain GM-only", async () => {
  reset(); game.user = fixture.users.get("viewer"); fixture.users.activeGM = null; fixture.users[0].active = false; fixture.users.get("owner").active = false;
  const owned = await currency.modifyOwnedBalances("actor", { coin: -5 }, { operationId: "not-owned" });
  assert.equal(owned.success, false); assert.equal(owned.error, "Permission denied."); assert.equal(fixture.userWrites, 0);
  assert.equal((await currency.modifyBalances("actor", { coin: -5 })).success, false); assert.equal(WalletStore.get().actor.coin, 100);
});

test("sheet response loss leaves a pending receipt blocking same and new operation IDs", async () => {
  const f = reset({ gm: false }); f.failActor = true;
  const first = await currency.modifyOwnedSheetBalances("actor", { gold: -5 }, { operationId: "uncertain" });
  assert.equal(first.success, false); assert.equal(first.commitUnknown, true); assert.equal(first.postCommitError, true);
  assert.equal(f.actor.system.gold, 95); assert.equal(f.actorWrites, 1);
  for (const operationId of ["uncertain", "new-operation"]) assert.equal((await currency.modifyOwnedSheetBalances("actor", { gold: -5 }, { operationId })).commitUnknown, true);
  assert.equal(f.actorWrites, 1); assert.equal(f.userWrites, 1);
});

test("definite sheet validation failure releases the actor for a later valid operation", async () => {
  const f = reset({ gm: false });
  const invalid = await currency.modifyOwnedSheetBalances("actor", { gold: -0.5 }, { operationId: "invalid" });
  assert.equal(invalid.success, false); assert.equal(invalid.commitUnknown, undefined); assert.equal(f.actorWrites, 0);
  const valid = await currency.modifyOwnedSheetBalances("actor", { gold: -2 }, { operationId: "valid" });
  assert.equal(valid.success, true); assert.equal(f.actor.system.gold, 98); assert.equal(f.actorWrites, 1);
});

test("legacy world-wallet replacement uses the same serialized currency service", async () => {
  reset(); await game.settings.set("glitchsmith-lib", "currency.wallets", { actor: { coin: 40, token: 3 } });
  await currency.modifyOwnedBalances("actor", { coin: -2 }, { operationId: "after-restore" }); assert.deepEqual(WalletStore.get().actor, { coin: 38, token: 3 });
});
