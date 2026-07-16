import { SETTING_KEYS, CURRENCY_TYPES } from "../constants.js";
import { getSetting, setSetting } from "../settings/index.js";
import { getCurrency } from "./definitions.js";
import { fireBalanceChanged } from "./hooks.js";
import { getCurrencyIncrement } from "./exchange-math.js";

function clone(value) {
  return foundry.utils.deepClone(value);
}

function readAllWallets() {
  const stored = getSetting(SETTING_KEYS.CURRENCY_WALLETS);
  return stored && typeof stored === "object" ? clone(stored) : {};
}

export function getAllWallets() {
  return readAllWallets();
}

export function getWallet(actorId) {
  if (!actorId) return {};
  const all = readAllWallets();
  return all[actorId] ? clone(all[actorId]) : {};
}

export function getBalance(actorId, currencyId) {
  const wallet = getWallet(actorId);
  const value = wallet[currencyId];
  return Number.isFinite(value) ? value : 0;
}

function ensureVirtualCurrency(currencyId) {
  const def = getCurrency(currencyId);
  if (!def) {
    return { ok: false, error: `Currency '${currencyId}' is not defined.` };
  }
  if (def.type !== CURRENCY_TYPES.VIRTUAL) {
    return {
      ok: false,
      error: `Currency '${currencyId}' is not a virtual currency. Library only mutates virtual wallets.`,
    };
  }
  return { ok: true, def };
}

function readBalance(wallets, actorId, currencyId) {
  const value = wallets[actorId]?.[currencyId];
  return Number.isFinite(value) ? value : 0;
}

function writeBalance(wallets, actorId, currencyId, value) {
  if (!wallets[actorId]) wallets[actorId] = {};
  wallets[actorId][currencyId] = value;
}

function roundDecimal(value, precision) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeBalanceValue(value, def) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const nonNegative = Math.max(0, numeric);
  if (def?.integer !== false) return Math.floor(nonNegative);
  const precision = Number.isInteger(Number(def.precision)) ? Number(def.precision) : 2;
  return roundDecimal(nonNegative, precision);
}

function balanceMatchesIncrement(value, def) {
  const increment = getCurrencyIncrement(def);
  const scaled = value / increment;
  if (!Number.isFinite(scaled) || Math.abs(scaled) > Number.MAX_SAFE_INTEGER) return false;
  const nearest = Math.round(scaled);
  const tolerance = Math.min(1e-9, Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8);
  return Math.abs(scaled - nearest) <= tolerance;
}

function deltaMatchesIncrement(actual, expected, def) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  const increment = getCurrencyIncrement(def);
  const tolerance = Math.min(
    Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected)) * 16,
    increment * 1e-6
  );
  return Math.abs(actual - expected) <= tolerance;
}

/**
 * Atomically exchange two virtual currencies in one actor wallet. Both balance
 * changes are persisted in a single world-setting write.
 */
export async function writeExchangeBalances({
  actorId,
  fromCurrencyId,
  toCurrencyId,
  fromAmount,
  toAmount,
  source,
  reason,
} = {}) {
  if (!actorId) return { success: false, errorCode: "ACTOR_REQUIRED", error: "actorId is required." };
  if (!fromCurrencyId || !toCurrencyId || fromCurrencyId === toCurrencyId) {
    return { success: false, errorCode: "INVALID_CURRENCY_PAIR", error: "Two different currency IDs are required." };
  }

  const fromCheck = ensureVirtualCurrency(fromCurrencyId);
  if (!fromCheck.ok) return { success: false, errorCode: "INVALID_SOURCE_CURRENCY", error: fromCheck.error };
  const toCheck = ensureVirtualCurrency(toCurrencyId);
  if (!toCheck.ok) return { success: false, errorCode: "INVALID_TARGET_CURRENCY", error: toCheck.error };

  const debit = Number(fromAmount);
  const credit = Number(toAmount);
  if (!Number.isFinite(debit) || debit <= 0 || !Number.isFinite(credit) || credit <= 0) {
    return { success: false, errorCode: "INVALID_AMOUNT", error: "Exchange amounts must be positive finite numbers." };
  }

  const wallets = readAllWallets();
  const fromBefore = readBalance(wallets, actorId, fromCurrencyId);
  const toBefore = readBalance(wallets, actorId, toCurrencyId);
  if (!balanceMatchesIncrement(fromBefore, fromCheck.def) || !balanceMatchesIncrement(toBefore, toCheck.def)) {
    return {
      success: false,
      errorCode: "INVALID_WALLET_BALANCE",
      error: "A wallet balance does not match the configured currency increment.",
    };
  }
  if (fromBefore + Number.EPSILON < debit) {
    return {
      success: false,
      errorCode: "INSUFFICIENT_BALANCE",
      error: "Insufficient balance.",
      from: { before: fromBefore, after: fromBefore },
      to: { before: toBefore, after: toBefore },
    };
  }

  const fromAfter = normalizeBalanceValue(fromBefore - debit, fromCheck.def);
  const toAfter = normalizeBalanceValue(toBefore + credit, toCheck.def);
  const debitApplied = fromBefore - fromAfter;
  const creditApplied = toAfter - toBefore;
  const debitTolerance = Math.min(
    Number.EPSILON * Math.max(1, Math.abs(debit), Math.abs(fromBefore)) * 16,
    getCurrencyIncrement(fromCheck.def) * 1e-6
  );
  const creditTolerance = Math.min(
    Number.EPSILON * Math.max(1, Math.abs(credit), Math.abs(toBefore)) * 16,
    getCurrencyIncrement(toCheck.def) * 1e-6
  );
  if (!Number.isFinite(fromAfter) || !Number.isFinite(toAfter)
    || !balanceMatchesIncrement(fromAfter, fromCheck.def)
    || !balanceMatchesIncrement(toAfter, toCheck.def)
    || Math.abs(debitApplied - debit) > debitTolerance
    || Math.abs(creditApplied - credit) > creditTolerance) {
    return {
      success: false,
      errorCode: "AMOUNT_NORMALIZATION_MISMATCH",
      error: "Exchange amounts do not match the configured currency precision.",
    };
  }
  writeBalance(wallets, actorId, fromCurrencyId, fromAfter);
  writeBalance(wallets, actorId, toCurrencyId, toAfter);
  await setSetting(SETTING_KEYS.CURRENCY_WALLETS, wallets);

  fireBalanceChanged({ actorId, currencyId: fromCurrencyId, before: fromBefore, after: fromAfter, source, reason });
  fireBalanceChanged({ actorId, currencyId: toCurrencyId, before: toBefore, after: toAfter, source, reason });

  return {
    success: true,
    from: { before: fromBefore, after: fromAfter },
    to: { before: toBefore, after: toAfter },
  };
}

export async function writeSetBalance({
  actorId,
  currencyId,
  value,
  source,
  reason,
  silent = false,
} = {}) {
  const check = ensureVirtualCurrency(currencyId);
  if (!check.ok) return { success: false, error: check.error };

  if (!actorId) return { success: false, error: "actorId is required." };
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return { success: false, error: "value must be a finite number." };
  }
  const next = normalizeBalanceValue(numeric, check.def);

  const wallets = readAllWallets();
  const before = readBalance(wallets, actorId, currencyId);
  if (before === next) {
    return { success: true, before, after: next, unchanged: true };
  }

  writeBalance(wallets, actorId, currencyId, next);
  await setSetting(SETTING_KEYS.CURRENCY_WALLETS, wallets);

  if (!silent) {
    fireBalanceChanged({ actorId, currencyId, before, after: next, source, reason });
  }
  return { success: true, before, after: next };
}

export async function writeModifyBalance({
  actorId,
  currencyId,
  delta,
  source,
  reason,
  allowNegative = false,
  silent = false,
} = {}) {
  const check = ensureVirtualCurrency(currencyId);
  if (!check.ok) return { success: false, error: check.error };

  if (!actorId) return { success: false, error: "actorId is required." };
  const numericDelta = Number(delta);
  if (!Number.isFinite(numericDelta)) {
    return { success: false, error: "delta must be a finite number." };
  }

  const wallets = readAllWallets();
  const before = readBalance(wallets, actorId, currencyId);
  const after = before + numericDelta;

  if (after < 0 && !allowNegative) {
    return {
      success: false,
      error: "Insufficient balance.",
      before,
      after: before,
    };
  }

  const next = normalizeBalanceValue(after, check.def);
  if (before === next) {
    return { success: true, before, after: next, unchanged: true };
  }

  writeBalance(wallets, actorId, currencyId, next);
  await setSetting(SETTING_KEYS.CURRENCY_WALLETS, wallets);

  if (!silent) {
    fireBalanceChanged({ actorId, currencyId, before, after: next, source, reason });
  }
  return { success: true, before, after: next };
}

/**
 * Apply several virtual-currency deltas to one actor wallet in a single
 * world-setting write. The full batch is validated before any value is saved.
 */
export async function writeModifyBalances({
  actorId,
  deltasById,
  source,
  reason,
  silent = false,
} = {}) {
  if (!actorId) return { success: false, error: "actorId is required." };
  if (!deltasById || typeof deltasById !== "object") {
    return { success: false, error: "deltasById must be an object." };
  }

  const entries = Object.entries(deltasById);
  if (entries.length === 0) {
    return { success: false, error: "deltasById must contain at least one currency." };
  }

  const wallets = readAllWallets();
  const before = {};
  const after = {};

  for (const [currencyId, rawDelta] of entries) {
    const check = ensureVirtualCurrency(currencyId);
    if (!check.ok) return { success: false, error: check.error, before, after: before };
    const delta = Number(rawDelta);
    if (!Number.isFinite(delta)) {
      return { success: false, error: `${currencyId} delta must be a finite number.`, before, after: before };
    }

    const current = readBalance(wallets, actorId, currencyId);
    if (!balanceMatchesIncrement(current, check.def)) {
      return {
        success: false,
        errorCode: "INVALID_WALLET_BALANCE",
        error: `${currencyId} balance does not match its configured increment.`,
        before,
        after: before,
      };
    }
    if (!balanceMatchesIncrement(delta, check.def)) {
      return {
        success: false,
        errorCode: "INVALID_AMOUNT_INCREMENT",
        error: `${currencyId} delta does not match its configured increment.`,
        before,
        after: before,
      };
    }
    const rawNext = current + delta;
    if (!Number.isFinite(rawNext)) {
      return { success: false, error: `${currencyId} balance exceeded the supported numeric range.`, before, after: before };
    }
    if (rawNext < 0) {
      return { success: false, error: "Insufficient balance.", before, after: before };
    }

    const next = normalizeBalanceValue(rawNext, check.def);
    if (!balanceMatchesIncrement(next, check.def)
      || !deltaMatchesIncrement(next - current, delta, check.def)) {
      return {
        success: false,
        errorCode: "AMOUNT_NORMALIZATION_MISMATCH",
        error: `${currencyId} delta cannot be applied exactly at its configured increment.`,
        before,
        after: before,
      };
    }
    before[currencyId] = current;
    after[currencyId] = next;
  }

  const changed = Object.keys(after).filter(currencyId => before[currencyId] !== after[currencyId]);
  if (changed.length === 0) return { success: true, before, after, unchanged: true };

  for (const currencyId of changed) {
    writeBalance(wallets, actorId, currencyId, after[currencyId]);
  }
  await setSetting(SETTING_KEYS.CURRENCY_WALLETS, wallets);

  if (!silent) {
    for (const currencyId of changed) {
      fireBalanceChanged({
        actorId,
        currencyId,
        before: before[currencyId],
        after: after[currencyId],
        source,
        reason,
      });
    }
  }
  return { success: true, before, after };
}

export async function writeTransferBalance({
  fromActorId,
  toActorId,
  currencyId,
  amount,
  source,
  reason,
} = {}) {
  if (!fromActorId || !toActorId) {
    return { success: false, error: "fromActorId and toActorId are required." };
  }
  if (fromActorId === toActorId) {
    return { success: false, error: "fromActorId and toActorId must differ." };
  }
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { success: false, error: "amount must be a positive number." };
  }

  const debit = await writeModifyBalance({
    actorId: fromActorId,
    currencyId,
    delta: -numeric,
    source,
    reason,
  });
  if (!debit.success) return debit;

  const credit = await writeModifyBalance({
    actorId: toActorId,
    currencyId,
    delta: numeric,
    source,
    reason,
  });
  if (!credit.success) {
    await writeModifyBalance({
      actorId: fromActorId,
      currencyId,
      delta: numeric,
      source,
      reason: `${reason ?? "transfer"}-rollback`,
      silent: true,
    });
    return credit;
  }

  return {
    success: true,
    from: { actorId: fromActorId, before: debit.before, after: debit.after },
    to: { actorId: toActorId, before: credit.before, after: credit.after },
  };
}

export async function writeBulkImport({
  wallets: incomingWallets,
  mode = "merge",
  source,
  reason,
} = {}) {
  if (!incomingWallets || typeof incomingWallets !== "object") {
    return { success: false, error: "wallets must be an object." };
  }
  const validModes = new Set(["merge", "replace"]);
  if (!validModes.has(mode)) {
    return { success: false, error: `mode must be one of: ${[...validModes].join(", ")}` };
  }

  const before = readAllWallets();
  const next = mode === "replace" ? {} : clone(before);

  for (const [actorId, wallet] of Object.entries(incomingWallets)) {
    if (!actorId || !wallet || typeof wallet !== "object") continue;
    if (!next[actorId]) next[actorId] = {};
    for (const [currencyId, value] of Object.entries(wallet)) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      const def = getCurrency(currencyId);
      if (!def) continue;
      next[actorId][currencyId] = normalizeBalanceValue(numeric, def);
    }
  }

  await setSetting(SETTING_KEYS.CURRENCY_WALLETS, next);

  for (const [actorId, wallet] of Object.entries(next)) {
    for (const [currencyId, after] of Object.entries(wallet)) {
      const previous = before[actorId]?.[currencyId] ?? 0;
      if (previous !== after) {
        fireBalanceChanged({ actorId, currencyId, before: previous, after, source, reason });
      }
    }
  }

  return { success: true, mode, importedActors: Object.keys(incomingWallets).length };
}
