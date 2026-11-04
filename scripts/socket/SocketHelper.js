import { SOCKET_CHANNEL, SOCKET_TIMEOUT_MS } from "../constants.js";

const handlers = new Map();
const pendingRequests = new Map();
let initialized = false;

function logPrefix() {
  return "GlitchSmith Library | Socket |";
}

function onMessage(message, senderId) {
  if (!message || typeof message !== "object") return;

  if (message.type === "request") {
    if (message.responderId && message.responderId !== game.user.id) return;
    handleRequest(message, senderId);
  } else if (message.type === "response") {
    if (message.requesterId !== game.user.id) return;
    handleResponse(message, senderId);
  }
}

async function handleRequest(message, senderId) {
  const { handlerName, data, requestId } = message;
  const requesterId = typeof senderId === "string" && senderId ? senderId : "";
  if (!requesterId) return;

  const registration = handlers.get(handlerName);
  const target = registration?.target ?? "gm";
  const responder = await selectResponder(target, data);
  if (!responder || responder.id !== game.user.id) {
    if (target === "gm" || message.responderId !== game.user.id) return;
    game.socket.emit(SOCKET_CHANNEL, { type: "response", requestId, requesterId, result: { retryCoordinator: true } });
    return;
  }

  let result;
  if (!registration) {
    result = { success: false, error: `Unknown handler: ${handlerName}` };
  } else {
    try {
      result = await registration.handler(data, { requesterId });
      if (result === undefined) result = { success: true };
    } catch (err) {
      console.error(`${logPrefix()} handler '${handlerName}' threw`, err);
      result = { success: false, error: err?.message ?? String(err) };
    }
  }

  game.socket.emit(SOCKET_CHANNEL, {
    type: "response",
    requestId,
    requesterId,
    result,
  });
}

function handleResponse(message, senderId) {
  const pending = pendingRequests.get(message.requestId);
  if (!pending) return;
  if (senderId !== pending.responderId || (pending.gmOnly && !game.users?.get(senderId)?.isGM)) return;
  pendingRequests.delete(message.requestId);
  clearTimeout(pending.timeoutId);
  pending.resolve(message.result);
}

export function initialize() {
  if (initialized) return;
  game.socket.on(SOCKET_CHANNEL, onMessage);
  initialized = true;
}

export function register(handlerName, handler, { target = "gm" } = {}) {
  if (typeof handler !== "function") {
    throw new TypeError(`${logPrefix()} handler for '${handlerName}' must be a function`);
  }
  if (!["gm", "coordinator", "owner"].includes(target)) throw new TypeError(`${logPrefix()} invalid handler target`);
  handlers.set(handlerName, { handler, target });
}

async function selectResponder(target, data = {}) {
  const activeGM = game.users?.activeGM ?? null;
  if (activeGM) return activeGM;
  if (target === "gm") return game.user.isGM ? game.user : null;
  const users = game.users?.contents ?? [...(game.users?.values?.() ?? [])];
  let actor;
  if (target === "owner") {
    if (data.actorUuid && typeof globalThis.fromUuid === "function") actor = await fromUuid(data.actorUuid);
    actor ??= game.actors?.get(data.actorId);
    if (!actor) return null;
  }
  return users.filter(user => user.active && (target !== "owner" || user.isGM || actor.testUserPermission?.(user, "OWNER")))
    .sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}

export async function isTargetClient(target, data = {}) {
  return (await selectResponder(target, data))?.id === game.user.id;
}

export async function executeAsGM(handlerName, data) {
  const activeGM = game.users?.activeGM ?? null;
  if (game.user.isGM && (!activeGM || activeGM.id === game.user.id)) {
    const registration = handlers.get(handlerName);
    if (!registration) return { success: false, error: `Unknown handler: ${handlerName}` };
    try {
      const result = await registration.handler(data, { requesterId: game.user.id });
      return result === undefined ? { success: true } : result;
    } catch (err) {
      console.error(`${logPrefix()} handler '${handlerName}' threw`, err);
      return { success: false, error: err?.message ?? String(err) };
    }
  }

  if (!activeGM) {
    return { success: false, error: "No active GM available." };
  }

  return requestRemote(handlerName, data, activeGM.id, { gmOnly: true });
}

function requestRemote(handlerName, data, responderId, { gmOnly = false } = {}) {
  const requestId = foundry.utils.randomID();
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        resolve(gmOnly ? { success: false, error: "GM request timed out." } : {
          success: false, error: "Currency request timed out.", commitUnknown: true, postCommitError: true,
        });
      }
    }, SOCKET_TIMEOUT_MS);

    pendingRequests.set(requestId, { resolve, timeoutId, responderId, gmOnly });

    game.socket.emit(SOCKET_CHANNEL, {
      type: "request",
      handlerName,
      data,
      requestId,
      requesterId: game.user.id,
      responderId,
    });
  });
}

async function executeTargeted(target, handlerName, data) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (game.socket?.connected === false) return { success: false, error: "Currency connection is unavailable." };
    const responder = await selectResponder(target, data);
    if (!responder) return { success: false, error: "No active currency owner is available." };
    let result;
    if (responder.id === game.user.id) {
      const registration = handlers.get(handlerName);
      if (!registration) return { success: false, error: `Unknown handler: ${handlerName}` };
      try { result = await registration.handler(data, { requesterId: game.user.id }); }
      catch (error) { result = { success: false, error: error?.message ?? String(error) }; }
    } else result = await requestRemote(handlerName, data, responder.id);
    if (!result?.retryCoordinator) return result === undefined ? { success: true } : result;
  }
  return { success: false, error: "Currency coordinator changed. Try again." };
}

export const executeAsCoordinator = (handlerName, data) => executeTargeted("coordinator", handlerName, data);
export const executeAsOwner = (handlerName, data) => executeTargeted("owner", handlerName, data);
