import assert from "node:assert/strict";
import test from "node:test";

async function setup() {
  const users = [
    { id: "a-coordinator", active: true, isGM: false },
    { id: "b-owner", active: true, isGM: false },
    { id: "z-requester", active: true, isGM: false },
    { id: "gm", active: false, isGM: true },
  ];
  users.get = id => users.find(user => user.id === id); users.activeGM = null;
  let listener, sequence = 0;
  const emitted = [], actor = { id: "actor", testUserPermission: user => ["b-owner", "z-requester"].includes(user.id) };
  globalThis.game = { user: users.get("z-requester"), users, actors: new Map([["actor", actor]]),
    socket: { connected: true, on: (_channel, callback) => { listener = callback; }, emit: (_channel, message) => emitted.push(message) } };
  globalThis.foundry = { utils: { randomID: () => `request-${++sequence}` } };
  globalThis.fromUuid = async () => actor;
  const socket = await import(`../scripts/socket/SocketHelper.js?owned=${Date.now()}-${Math.random()}`);
  socket.initialize();
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const respond = (request, result, senderId = request.responderId) => listener({ type: "response", requestId: request.requestId, requesterId: request.requesterId, result }, senderId);
  return { users, socket, emitted, tick, respond, receive: (message, senderId) => listener(message, senderId) };
}

test("owned wallet chooses an active coordinator and accepts only that player's response", async () => {
  const f = await setup(); f.socket.register("owned", () => ({ success: true }), { target: "coordinator" });
  const pending = f.socket.executeAsCoordinator("owned", { actorId: "actor", operationId: "op" }); await f.tick();
  assert.equal(f.emitted[0].responderId, "a-coordinator");
  let finished = false; pending.then(() => { finished = true; });
  f.respond(f.emitted[0], { success: false }, "b-owner"); await f.tick(); assert.equal(finished, false);
  f.respond(f.emitted[0], { success: true, before: 10, after: 9 }); assert.equal((await pending).success, true);
});

test("owned sheet selects an actor owner instead of the unrelated wallet coordinator", async () => {
  const f = await setup();
  const pending = f.socket.executeAsOwner("sheet", { actorId: "actor", operationId: "op" }); await f.tick();
  assert.equal(f.emitted[0].responderId, "b-owner"); f.respond(f.emitted[0], { success: true }); await pending;
});

test("an active GM remains the executor for both new APIs and existing GM requests", async () => {
  const f = await setup(); f.users.activeGM = f.users.get("gm"); f.users.activeGM.active = true;
  for (const execute of [f.socket.executeAsGM, f.socket.executeAsCoordinator, f.socket.executeAsOwner]) {
    const pending = execute("handler", { actorId: "actor" }); await f.tick();
    const request = f.emitted.at(-1); assert.equal(request.responderId, "gm"); f.respond(request, { success: true }); await pending;
  }
});

test("legacy GM commands still fail without an active GM", async () => {
  const f = await setup(); f.socket.register("legacy", () => ({ success: true }));
  assert.deepEqual(await f.socket.executeAsGM("legacy", {}), { success: false, error: "No active GM available." });
  assert.equal(f.emitted.length, 0);
});

test("coordinator handling uses the actual socket requester and ignores another target", async () => {
  const f = await setup(); game.user = f.users.get("a-coordinator"); const calls = [];
  f.socket.register("owned", (data, context) => { calls.push({ data, context }); return { success: true }; }, { target: "coordinator" });
  const message = { type: "request", handlerName: "owned", data: { actorId: "actor" }, requestId: "id", requesterId: "gm", responderId: "b-owner" };
  f.receive(message, "z-requester"); await f.tick(); assert.equal(calls.length, 0);
  f.receive({ ...message, responderId: "a-coordinator" }, "z-requester"); await f.tick();
  assert.equal(calls.length, 1); assert.equal(calls[0].context.requesterId, "z-requester"); assert.equal(f.emitted[0].requesterId, "z-requester");
});

test("a stale owner target asks for rerouting before any mutation", async () => {
  const f = await setup(); game.user = f.users.get("b-owner"); let writes = 0;
  f.socket.register("sheet", () => { writes++; return { success: true }; }, { target: "owner" });
  f.users.activeGM = f.users.get("gm"); f.users.activeGM.active = true;
  f.receive({ type: "request", handlerName: "sheet", data: { actorId: "actor" }, requestId: "op", responderId: "b-owner" }, "z-requester"); await f.tick();
  assert.equal(writes, 0); assert.deepEqual(f.emitted[0].result, { retryCoordinator: true });
});

test("new owned RPC timeouts report an uncertain commit while legacy GM timeout stays compatible", async () => {
  const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
  try {
    const f = await setup(), timers = [];
    globalThis.setTimeout = callback => { timers.push(callback); return timers.length; }; globalThis.clearTimeout = () => {};
    let pending = f.socket.executeAsCoordinator("owned", { actorId: "actor" }); await f.tick(); timers.shift()();
    assert.deepEqual(await pending, { success: false, error: "Currency request timed out.", commitUnknown: true, postCommitError: true });
    f.users.activeGM = f.users.get("gm"); f.users.activeGM.active = true;
    pending = f.socket.executeAsGM("legacy", {}); timers.shift()();
    assert.deepEqual(await pending, { success: false, error: "GM request timed out." });
  } finally { globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout; }
});

test("owned local execution preserves operation data and failed results", async () => {
  const f = await setup(); game.user = f.users.get("b-owner");
  f.socket.register("sheet", (data, context) => ({ success: false, operationId: data.operationId, requesterId: context.requesterId, partialCommit: true }), { target: "owner" });
  const result = await f.socket.executeAsOwner("sheet", { actorId: "actor", operationId: "bank-sheet-apply" });
  assert.deepEqual(result, { success: false, operationId: "bank-sheet-apply", requesterId: "b-owner", partialCommit: true }); assert.equal(f.emitted.length, 0);
});
