import assert from "node:assert/strict";
import test from "node:test";
import { createCurrencyServiceFixture } from "./currency-service-fixture.mjs";

const fixture = createCurrencyServiceFixture();
const { registerSocketHandlers } = await import("../scripts/socket/index.js");
const { WalletStore } = await import("../scripts/api/wallet-store.js");
registerSocketHandlers();

test("an actor owner may request a server-authoritative wallet exchange", async () => {
  const result = await fixture.request("owner", "currency.exchangeBalance", {
    actorId: "actor", actorUuid: "Actor.actor", fromCurrencyId: "coin", toCurrencyId: "token", amount: 2,
  });
  assert.equal(result.success, true); assert.equal(result.quote.toAmount, 1);
  assert.deepEqual(WalletStore.get().actor, { coin: 98, token: 11 });
  assert.equal(fixture.userWrites, 2); assert.deepEqual(fixture.raw["currency.wallets"].actor, { coin: 100, token: 10 });
});

test("a non-owner exchange request is rejected without a wallet balance write", async () => {
  const before = WalletStore.get();
  const result = await fixture.request("viewer", "currency.exchangeBalance", {
    actorId: "actor", actorUuid: "Actor.actor", fromCurrencyId: "coin", toCurrencyId: "token", amount: 2,
  });
  assert.equal(result.success, false); assert.equal(result.errorCode, "PERMISSION_DENIED"); assert.deepEqual(WalletStore.get(), before);
});

test("existing virtual wallet mutations continue to require a GM requester", async () => {
  const before = WalletStore.get(), writes = fixture.userWrites;
  for (const [handler, data] of [
    ["currency.modifyBalance", { actorId: "actor", currencyId: "coin", delta: 5 }],
    ["currency.modifyBalances", { actorId: "actor", deltasById: { coin: 5 } }],
    ["currency.setBalance", { actorId: "actor", currencyId: "coin", value: 999 }],
    ["currency.bulkImport", { wallets: { actor: { coin: 999 } } }],
  ]) {
    const result = await fixture.request("owner", handler, data);
    assert.equal(result.success, false); assert.equal(result.error, "Permission denied.");
  }
  assert.equal(fixture.userWrites, writes); assert.deepEqual(WalletStore.get(), before);
});

test("sheet exchange preserves a lost native response as pending instead of permitting another debit", async () => {
  fixture.failActor = true;
  const data = { actorId: "actor", actorUuid: "Actor.actor", fromCurrencyId: "gold", toCurrencyId: "silver", amount: 2, operationId: "sheet-exchange" };
  const result = await fixture.request("owner", "currency.exchangeBalance", data);
  assert.equal(result.success, false); assert.equal(result.commitUnknown, true); assert.equal(result.postCommitError, true);
  assert.deepEqual(fixture.actor.system, { gold: 98, silver: 30 }); assert.equal(fixture.actorWrites, 1);
  const retry = await fixture.request("owner", "currency.exchangeBalance", { ...data, operationId: "new-sheet-exchange" });
  assert.equal(retry.commitUnknown, true); assert.equal(fixture.actorWrites, 1);
});
