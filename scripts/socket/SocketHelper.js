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
    if (!game.user.isGM) return;
    if (game.users?.activeGM && game.users.activeGM.id !== game.user.id) return;
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

  const handler = handlers.get(handlerName);

  let result;
  if (!handler) {
    result = { success: false, error: `Unknown handler: ${handlerName}` };
  } else {
    try {
      result = await handler(data, { requesterId });
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
  if (senderId !== pending.responderId || !game.users?.get(senderId)?.isGM) return;
  pendingRequests.delete(message.requestId);
  clearTimeout(pending.timeoutId);
  pending.resolve(message.result);
}

export function initialize() {
  if (initialized) return;
  game.socket.on(SOCKET_CHANNEL, onMessage);
  initialized = true;
}

export function register(handlerName, handler) {
  if (typeof handler !== "function") {
    throw new TypeError(`${logPrefix()} handler for '${handlerName}' must be a function`);
  }
  handlers.set(handlerName, handler);
}

export async function executeAsGM(handlerName, data) {
  const activeGM = game.users?.activeGM ?? null;
  if (game.user.isGM && (!activeGM || activeGM.id === game.user.id)) {
    const handler = handlers.get(handlerName);
    if (!handler) return { success: false, error: `Unknown handler: ${handlerName}` };
    try {
      const result = await handler(data, { requesterId: game.user.id });
      return result === undefined ? { success: true } : result;
    } catch (err) {
      console.error(`${logPrefix()} handler '${handlerName}' threw`, err);
      return { success: false, error: err?.message ?? String(err) };
    }
  }

  if (!activeGM) {
    return { success: false, error: "No active GM available." };
  }

  const requestId = foundry.utils.randomID();
  return await new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        resolve({ success: false, error: "GM request timed out." });
      }
    }, SOCKET_TIMEOUT_MS);

    pendingRequests.set(requestId, { resolve, timeoutId, responderId: activeGM.id });

    game.socket.emit(SOCKET_CHANNEL, {
      type: "request",
      handlerName,
      data,
      requestId,
      requesterId: game.user.id,
    });
  });
}
