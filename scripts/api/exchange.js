import { CURRENCY_TYPES, SOURCES } from "../constants.js";
import { getDefinitions } from "./definitions.js";
import {
  getSheetCurrencies,
  supportsAtomicSheetExchange,
  writeModifySheetBalances,
} from "./sheet-currency.js";
import { writeExchangeBalances } from "./wallets.js";
import { buildExchangeQuote } from "./exchange-math.js";

export { buildExchangeQuote, getCurrencyIncrement } from "./exchange-math.js";

let exchangeMutationQueue = Promise.resolve();

function failure(errorCode, error, details = {}) {
  return { success: false, errorCode, error, ...details };
}

export function getExchangeCurrencies(systemId = game?.system?.id) {
  const stored = getDefinitions().currencies ?? {};
  const currencies = Object.fromEntries(
    Object.entries(stored).map(([id, def]) => [id, { id, ...def }])
  );

  // Sheet APIs can fall back to a system preset before the GM saves explicit
  // definitions. Keep explicitly configured currencies authoritative on ID clashes.
  for (const def of getSheetCurrencies(systemId)) {
    if (!currencies[def.id]) currencies[def.id] = { ...def };
  }
  return currencies;
}

export function getExchangeQuote(request = {}, systemId = game?.system?.id) {
  return buildExchangeQuote(getExchangeCurrencies(systemId), request);
}

async function resolveActor({ actorUuid, actorId } = {}) {
  let actor = null;
  if (actorUuid) actor = await fromUuid(actorUuid);
  if (!actor && actorId) actor = game.actors?.get(actorId);
  return actor;
}

function requesterCanMutateActor(actor, requesterId) {
  const requester = requesterId ? game.users?.get(requesterId) : null;
  if (!actor || !requester) return false;
  if (requester.isGM) return true;
  return typeof actor.testUserPermission === "function"
    && actor.testUserPermission(requester, "OWNER");
}

/**
 * Exchange balances owned by GlitchSmith Library. Same-store exchanges are
 * supported: virtual-to-virtual and sheet-to-sheet. Cross-store exchanges only
 * receive quotes because Foundry cannot atomically commit an Actor update and a
 * world setting update together.
 */
async function performExchangeBalance({
  actorUuid,
  actorId,
  systemId,
  fromCurrencyId,
  toCurrencyId,
  amount,
  feePercent = 0,
  source = SOURCES.UNKNOWN,
  reason = null,
  requesterId,
} = {}) {
  const actor = await resolveActor({ actorUuid, actorId });
  if (!actor) return failure("ACTOR_NOT_FOUND", "Actor not found.");
  if (!requesterCanMutateActor(actor, requesterId)) {
    return failure("PERMISSION_DENIED", "Permission denied.");
  }

  const quote = getExchangeQuote({ fromCurrencyId, toCurrencyId, amount, feePercent }, systemId);
  if (!quote.success) return quote;

  if (quote.fromType !== quote.toType) {
    return failure(
      "MIXED_STORAGE_UNSUPPORTED",
      "Sheet-to-virtual exchanges cannot be committed atomically. Use getExchangeQuote and let the owning module coordinate its storage.",
      { quote }
    );
  }

  if (quote.fromType === CURRENCY_TYPES.VIRTUAL) {
    const result = await writeExchangeBalances({
      actorId: actor.id,
      fromCurrencyId: quote.fromCurrencyId,
      toCurrencyId: quote.toCurrencyId,
      fromAmount: quote.fromAmount,
      toAmount: quote.toAmount,
      source,
      reason,
    });
    return result.success ? { ...result, quote } : result;
  }

  if (quote.fromType === CURRENCY_TYPES.SHEET) {
    if (!supportsAtomicSheetExchange([quote.fromCurrencyId, quote.toCurrencyId], systemId)) {
      return failure(
        "NON_ATOMIC_SHEET_EXCHANGE_UNSUPPORTED",
        "This sheet currency driver cannot guarantee an atomic multi-currency exchange.",
        { quote }
      );
    }
    const result = await writeModifySheetBalances({
      actorUuid: actor.uuid,
      actorId: actor.id,
      systemId,
      deltasById: {
        [quote.fromCurrencyId]: -quote.fromAmount,
        [quote.toCurrencyId]: quote.toAmount,
      },
      source,
      reason,
      requesterId,
      requireExactDeltas: true,
    });
    if (!result.success) {
      const errorCode = result.errorCode ?? (result.error === "Insufficient balance."
        ? "INSUFFICIENT_BALANCE"
        : "SHEET_EXCHANGE_FAILED");
      return failure(errorCode, result.error ?? "Sheet currency exchange failed.", { quote });
    }
    return {
      success: true,
      quote,
      from: {
        before: result.before[quote.fromCurrencyId] ?? 0,
        after: result.after[quote.fromCurrencyId] ?? 0,
      },
      to: {
        before: result.before[quote.toCurrencyId] ?? 0,
        after: result.after[quote.toCurrencyId] ?? 0,
      },
    };
  }

  return failure("UNSUPPORTED_CURRENCY_TYPE", "Unsupported currency type.", { quote });
}

export function writeExchangeBalance(payload = {}) {
  const result = exchangeMutationQueue.then(() => performExchangeBalance(payload));
  exchangeMutationQueue = result.then(() => undefined, () => undefined);
  return result;
}
