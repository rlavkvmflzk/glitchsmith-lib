import { HOOKS, SOURCES } from "../constants.js";

export function fireBalanceChanged(payload) {
  const event = {
    actorId: payload.actorId,
    currencyId: payload.currencyId,
    before: payload.before ?? 0,
    after: payload.after ?? 0,
    delta: (payload.after ?? 0) - (payload.before ?? 0),
    source: payload.source ?? SOURCES.UNKNOWN,
    reason: payload.reason ?? null,
  };
  Hooks.callAll(HOOKS.CURRENCY_BALANCE_CHANGED, event);
  return event;
}

export function fireDefinitionsChanged(payload) {
  const event = {
    before: payload.before ?? null,
    after: payload.after ?? null,
    source: payload.source ?? SOURCES.UNKNOWN,
    reason: payload.reason ?? null,
  };
  Hooks.callAll(HOOKS.CURRENCY_DEFINITIONS_CHANGED, event);
  return event;
}
