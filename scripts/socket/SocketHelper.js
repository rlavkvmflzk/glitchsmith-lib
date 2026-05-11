import { SOCKET_CHANNEL, SOCKET_TIMEOUT_MS } from "../constants.js";

const handlers = new Map();
const pendingRequests = new Map();
let initialized = false;

function logPrefix() {
  return "GlitchSmith Library | Socket |";
}

function onMessage(message) {
  if (!message || typeof message !== "object") return;

  if (message.type === "request") {
    if (!game.user.isGM) return;
    handleRequest(message);
  } else if (message.type === "response") {
    if (message.requesterId !== game.user.id) return;
    handleResponse(message);
  }
}

async function handleRequest(message) {
  const { handlerName, data, requestId, requesterId } = message;
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

function handleResponse(message) {
  const pending = pendingRequests.get(message.requestId);
  if (!pending) return;
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
  if (game.user.isGM) {
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

  if (!game.users.activeGM) {
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

    pendingRequests.set(requestId, { resolve, timeoutId });

    game.socket.emit(SOCKET_CHANNEL, {
      type: "request",
      handlerName,
      data,
      requestId,
      requesterId: game.user.id,
    });
  });
}
