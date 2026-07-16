import assert from "node:assert/strict";
import test from "node:test";

async function loadSocketHelper() {
  return import(`../scripts/socket/SocketHelper.js?test=${Date.now()}-${Math.random()}`);
}

test("accepts a GM response only from the authoritative GM selected for the request", async () => {
  const player = { id: "player", isGM: false };
  const primaryGM = { id: "gm-primary", isGM: true };
  const secondaryGM = { id: "gm-secondary", isGM: true };
  const usersById = new Map([
    [player.id, player],
    [primaryGM.id, primaryGM],
    [secondaryGM.id, secondaryGM],
  ]);
  let listener = null;
  const emitted = [];

  globalThis.foundry = { utils: { randomID: () => "request-1" } };
  globalThis.game = {
    user: player,
    users: {
      activeGM: primaryGM,
      get: id => usersById.get(id),
    },
    socket: {
      on: (_channel, callback) => { listener = callback; },
      emit: (_channel, message) => { emitted.push(message); },
    },
  };

  const Socket = await loadSocketHelper();
  Socket.initialize();
  const pending = Socket.executeAsGM("currency.test", { amount: 1 });
  assert.equal(emitted[0].requestId, "request-1");

  let settled = false;
  pending.finally(() => { settled = true; });
  listener({
    type: "response",
    requestId: "request-1",
    requesterId: player.id,
    result: { success: false, error: "forged" },
  }, player.id);
  listener({
    type: "response",
    requestId: "request-1",
    requesterId: player.id,
    result: { success: false, error: "wrong GM" },
  }, secondaryGM.id);
  await Promise.resolve();
  assert.equal(settled, false);

  listener({
    type: "response",
    requestId: "request-1",
    requesterId: player.id,
    result: { success: true },
  }, primaryGM.id);
  assert.deepEqual(await pending, { success: true });
});
