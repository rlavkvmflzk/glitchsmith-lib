import { SOCKET_HANDLERS } from "../constants.js";
import * as Socket from "./SocketHelper.js";
import { writeDefinitions } from "../api/definitions.js";
import {
  writeSetBalance,
  writeModifyBalance,
  writeTransferBalance,
  writeBulkImport,
} from "../api/wallets.js";

function gmOnly(handler) {
  return async (data, ctx) => {
    if (!game.user.isGM) {
      return { success: false, error: "Permission denied." };
    }
    return await handler(data, ctx);
  };
}

export function registerSocketHandlers() {
  Socket.initialize();

  Socket.register(
    SOCKET_HANDLERS.SET_DEFINITIONS,
    gmOnly(async (data) => writeDefinitions(data?.definitions, data?.options))
  );

  Socket.register(
    SOCKET_HANDLERS.SET_BALANCE,
    gmOnly(async (data) => writeSetBalance(data ?? {}))
  );

  Socket.register(
    SOCKET_HANDLERS.MODIFY_BALANCE,
    gmOnly(async (data) => writeModifyBalance(data ?? {}))
  );

  Socket.register(
    SOCKET_HANDLERS.TRANSFER_BALANCE,
    gmOnly(async (data) => writeTransferBalance(data ?? {}))
  );

  Socket.register(
    SOCKET_HANDLERS.BULK_IMPORT,
    gmOnly(async (data) => writeBulkImport(data ?? {}))
  );
}

export { Socket };
