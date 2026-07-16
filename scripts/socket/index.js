import { SOCKET_HANDLERS } from "../constants.js";
import * as Socket from "./SocketHelper.js";
import { writeDefinitions } from "../api/definitions.js";
import {
  writeSetBalance,
  writeModifyBalance,
  writeModifyBalances,
  writeTransferBalance,
  writeBulkImport,
} from "../api/wallets.js";
import {
  writeSetSheetBalance,
  writeModifySheetBalance,
  writeModifySheetBalances,
  writeSetSheetBalances,
} from "../api/sheet-currency.js";
import { writeExchangeBalance } from "../api/exchange.js";

let balanceMutationQueue = Promise.resolve();

function withBalanceMutationLock(handler) {
  return (data, ctx) => {
    const result = balanceMutationQueue.then(() => handler(data, ctx));
    balanceMutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };
}

function requesterIsGM(requesterId) {
  const requester = requesterId ? game.users?.get(requesterId) : null;
  return requester?.isGM === true;
}

function gmRequesterOnly(handler) {
  return async (data, ctx) => {
    if (!requesterIsGM(ctx?.requesterId)) {
      return { success: false, error: "Permission denied." };
    }
    return await handler(data, ctx);
  };
}

function actorRequesterOnly(handler) {
  return async (data, ctx) => {
    if (!ctx?.requesterId) {
      return { success: false, error: "Permission denied." };
    }
    return await handler(data, ctx);
  };
}

export function registerSocketHandlers() {
  Socket.initialize();

  Socket.register(
    SOCKET_HANDLERS.SET_DEFINITIONS,
    gmRequesterOnly(withBalanceMutationLock(
      async (data) => writeDefinitions(data?.definitions, data?.options)
    ))
  );

  Socket.register(
    SOCKET_HANDLERS.SET_BALANCE,
    gmRequesterOnly(withBalanceMutationLock(async (data) => writeSetBalance(data ?? {})))
  );

  Socket.register(
    SOCKET_HANDLERS.MODIFY_BALANCE,
    gmRequesterOnly(withBalanceMutationLock(async (data) => writeModifyBalance(data ?? {})))
  );

  Socket.register(
    SOCKET_HANDLERS.MODIFY_BALANCES,
    gmRequesterOnly(withBalanceMutationLock(async (data) => writeModifyBalances(data ?? {})))
  );

  Socket.register(
    SOCKET_HANDLERS.TRANSFER_BALANCE,
    gmRequesterOnly(withBalanceMutationLock(async (data) => writeTransferBalance(data ?? {})))
  );

  Socket.register(
    SOCKET_HANDLERS.BULK_IMPORT,
    gmRequesterOnly(withBalanceMutationLock(async (data) => writeBulkImport(data ?? {})))
  );

  Socket.register(
    SOCKET_HANDLERS.SET_SHEET_BALANCE,
    actorRequesterOnly(withBalanceMutationLock(async (data, ctx) => writeSetSheetBalance({ ...(data ?? {}), requesterId: ctx.requesterId })))
  );

  Socket.register(
    SOCKET_HANDLERS.MODIFY_SHEET_BALANCE,
    actorRequesterOnly(withBalanceMutationLock(async (data, ctx) => writeModifySheetBalance({ ...(data ?? {}), requesterId: ctx.requesterId })))
  );

  Socket.register(
    SOCKET_HANDLERS.MODIFY_SHEET_BALANCES,
    actorRequesterOnly(withBalanceMutationLock(async (data, ctx) => writeModifySheetBalances({ ...(data ?? {}), requesterId: ctx.requesterId })))
  );

  Socket.register(
    SOCKET_HANDLERS.SET_SHEET_BALANCES,
    actorRequesterOnly(withBalanceMutationLock(async (data, ctx) => writeSetSheetBalances({ ...(data ?? {}), requesterId: ctx.requesterId })))
  );

  Socket.register(
    SOCKET_HANDLERS.EXCHANGE_BALANCE,
    actorRequesterOnly(withBalanceMutationLock(async (data, ctx) => writeExchangeBalance({ ...(data ?? {}), requesterId: ctx.requesterId })))
  );
}

export { Socket };
