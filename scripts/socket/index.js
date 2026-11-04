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
import { WalletStore } from "../api/wallet-store.js";

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

function actorOwnerOnly(handler) {
  return async (data, ctx) => {
    const requester = game.users?.get(ctx?.requesterId);
    let actor;
    if (data?.actorUuid) actor = await fromUuid(data.actorUuid);
    actor ??= game.actors?.get(data?.actorId);
    if (!requester || !actor || (!requester.isGM && !actor.testUserPermission?.(requester, "OWNER"))) {
      return { success: false, error: "Permission denied." };
    }
    return handler(data, ctx);
  };
}

function withWalletMutation(handler, { target = "gm", external = false } = {}) {
  return withBalanceMutationLock(async (data, ctx) => {
    if (!await Socket.isTargetClient(target, data)) return { retryCoordinator: true };
    if (!await WalletStore.ready({ force: true })) return { success: false, error: "Currency data could not be refreshed." };
    if (!await Socket.isTargetClient(target, data)) return { retryCoordinator: true };
    return WalletStore.transaction(() => handler(data, ctx), {
      operationId: data?.operationId || foundry.utils.randomID(), requesterId: ctx.requesterId,
      actorId: data?.actorId, external, guard: () => Socket.isTargetClient(target, data),
      resources: [data?.actorId, data?.fromActorId, data?.toActorId].filter(Boolean),
    });
  });
}

export function registerSocketHandlers() {
  WalletStore.install();
  Socket.initialize();

  Socket.register(
    SOCKET_HANDLERS.SET_DEFINITIONS,
    gmRequesterOnly(withBalanceMutationLock(
      async (data) => writeDefinitions(data?.definitions, data?.options)
    ))
  );

  Socket.register(
    SOCKET_HANDLERS.SET_BALANCE,
    gmRequesterOnly(withWalletMutation(async (data) => writeSetBalance(data ?? {})))
  );

  Socket.register(
    SOCKET_HANDLERS.MODIFY_BALANCE,
    gmRequesterOnly(withWalletMutation(async (data) => writeModifyBalance(data ?? {})))
  );

  Socket.register(
    SOCKET_HANDLERS.MODIFY_BALANCES,
    gmRequesterOnly(withWalletMutation(async (data) => writeModifyBalances(data ?? {})))
  );

  Socket.register(
    SOCKET_HANDLERS.TRANSFER_BALANCE,
    gmRequesterOnly(withWalletMutation(async (data) => writeTransferBalance(data ?? {})))
  );

  Socket.register(
    SOCKET_HANDLERS.BULK_IMPORT,
    gmRequesterOnly(withWalletMutation(async (data) => writeBulkImport(data ?? {})))
  );

  Socket.register(
    SOCKET_HANDLERS.SET_SHEET_BALANCE,
    actorRequesterOnly(withWalletMutation(async (data, ctx) => writeSetSheetBalance({ ...(data ?? {}), requesterId: ctx.requesterId }), { external: true }))
  );

  Socket.register(
    SOCKET_HANDLERS.MODIFY_SHEET_BALANCE,
    actorRequesterOnly(withWalletMutation(async (data, ctx) => writeModifySheetBalance({ ...(data ?? {}), requesterId: ctx.requesterId }), { external: true }))
  );

  Socket.register(
    SOCKET_HANDLERS.MODIFY_SHEET_BALANCES,
    actorRequesterOnly(withWalletMutation(async (data, ctx) => writeModifySheetBalances({ ...(data ?? {}), requesterId: ctx.requesterId }), { external: true }))
  );

  Socket.register(
    SOCKET_HANDLERS.SET_SHEET_BALANCES,
    actorRequesterOnly(withWalletMutation(async (data, ctx) => writeSetSheetBalances({ ...(data ?? {}), requesterId: ctx.requesterId }), { external: true }))
  );

  Socket.register(
    SOCKET_HANDLERS.EXCHANGE_BALANCE,
    actorRequesterOnly(withWalletMutation(async (data, ctx) => writeExchangeBalance({ ...(data ?? {}), requesterId: ctx.requesterId }), { external: true }))
  );

  Socket.register("currency.modifyOwnedBalances", actorOwnerOnly(withWalletMutation(
    data => writeModifyBalances(data ?? {}), { target: "coordinator" }
  )), { target: "coordinator" });
  Socket.register("currency.modifyOwnedSheetBalances", actorOwnerOnly(withWalletMutation(
    (data, ctx) => writeModifySheetBalances({ ...(data ?? {}), requesterId: ctx.requesterId, requireExactDeltas: true }),
    { target: "owner", external: true }
  )), { target: "owner" });

  Socket.register("currency.replaceWallets", gmRequesterOnly(withWalletMutation(async data => {
    await WalletStore.replace(data.wallets, { full: true });
    return { success: true };
  })));
  WalletStore.setLegacyDispatcher(wallets => Socket.executeAsGM("currency.replaceWallets", { wallets }));
}

export { Socket };
