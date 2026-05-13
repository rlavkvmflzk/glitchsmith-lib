import { SOCKET_HANDLERS, SOURCES } from "../constants.js";
import * as Definitions from "./definitions.js";
import * as Wallets from "./wallets.js";
import { getRegisteredSystemIds, getSystemPreset, registerSystemPreset } from "./presets.js";
import { Socket } from "../socket/index.js";

function callerSource(options) {
  return options?.source ?? SOURCES.UNKNOWN;
}

function callerReason(options) {
  return options?.reason ?? null;
}

export const currency = Object.freeze({
  getDefinitions() {
    return Definitions.getDefinitions();
  },

  getCurrency(currencyId) {
    return Definitions.getCurrency(currencyId);
  },

  hasCurrency(currencyId) {
    return Definitions.hasCurrency(currencyId);
  },

  getCurrencyIds() {
    return Definitions.getCurrencyIds();
  },

  getVirtualCurrencyIds() {
    return Definitions.getVirtualCurrencyIds();
  },

  getSystemPreset(systemId) {
    return getSystemPreset(systemId);
  },

  getRegisteredSystemIds() {
    return getRegisteredSystemIds();
  },

  registerSystemPreset(systemId, preset) {
    return registerSystemPreset(systemId, preset);
  },

  async setDefinitions(definitions, options = {}) {
    return await Socket.executeAsGM(SOCKET_HANDLERS.SET_DEFINITIONS, {
      definitions,
      options: {
        source: callerSource(options),
        reason: callerReason(options),
      },
    });
  },

  getWallet(actorId) {
    return Wallets.getWallet(actorId);
  },

  getBalance(actorId, currencyId) {
    return Wallets.getBalance(actorId, currencyId);
  },

  getAllWallets() {
    if (!game.user.isGM) {
      return null;
    }
    return Wallets.getAllWallets();
  },

  async modifyBalance(actorId, currencyId, delta, options = {}) {
    return await Socket.executeAsGM(SOCKET_HANDLERS.MODIFY_BALANCE, {
      actorId,
      currencyId,
      delta,
      source: callerSource(options),
      reason: callerReason(options),
      allowNegative: options.allowNegative === true,
    });
  },

  async setBalance(actorId, currencyId, value, options = {}) {
    return await Socket.executeAsGM(SOCKET_HANDLERS.SET_BALANCE, {
      actorId,
      currencyId,
      value,
      source: callerSource(options),
      reason: callerReason(options),
    });
  },

  async transferBalance(fromActorId, toActorId, currencyId, amount, options = {}) {
    return await Socket.executeAsGM(SOCKET_HANDLERS.TRANSFER_BALANCE, {
      fromActorId,
      toActorId,
      currencyId,
      amount,
      source: callerSource(options),
      reason: callerReason(options),
    });
  },

  async bulkImport(payload, options = {}) {
    return await Socket.executeAsGM(SOCKET_HANDLERS.BULK_IMPORT, {
      ...payload,
      source: callerSource(options),
      reason: callerReason(options),
    });
  },
});
