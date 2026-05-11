import { SETTING_KEYS, CURRENCY_TYPES } from "../constants.js";
import { getSetting, setSetting } from "../settings/index.js";
import { getCurrency } from "./definitions.js";
import { fireBalanceChanged } from "./hooks.js";

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
  const next = Math.max(0, Math.floor(numeric));

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

  const next = Math.max(0, Math.floor(after));
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
      next[actorId][currencyId] = Math.max(0, Math.floor(numeric));
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
