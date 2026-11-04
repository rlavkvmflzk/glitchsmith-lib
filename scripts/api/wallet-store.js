import { MODULE_ID, SETTING_KEYS } from "../constants.js";
import { fireBalanceChanged } from "./hooks.js";

const SETTING = SETTING_KEYS.CURRENCY_WALLETS;
const FLAG = "walletLedgerV1";
const ARCHIVE = "currency.walletLedgerArchive";
const clone = value => value === undefined ? undefined : structuredClone(value);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unknown = () => ({ success: false, commitUnknown: true, postCommitError: true,
  error: "Previous currency operation is awaiting confirmation." });
const id = () => globalThis.crypto?.randomUUID?.() ?? foundry.utils.randomID();

function validatesWallets(value) {
  return object(value) && Object.values(value).every(wallet => object(wallet)
    && Object.values(wallet).every(amount => Number.isFinite(amount) && amount >= 0));
}

function difference(before, after) {
  const patch = {};
  for (const actorId of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!Object.hasOwn(after, actorId)) { patch[actorId] = null; continue; }
    const changes = {};
    for (const currencyId of new Set([...Object.keys(before[actorId] || {}), ...Object.keys(after[actorId])])) {
      if (!Object.hasOwn(after[actorId], currencyId)) changes[currencyId] = null;
      else if (before[actorId]?.[currencyId] !== after[actorId][currencyId]) changes[currencyId] = after[actorId][currencyId];
    }
    if (Object.keys(changes).length || !Object.hasOwn(before, actorId)) patch[actorId] = changes;
  }
  return patch;
}

function applyPatch(wallets, patch) {
  for (const [actorId, changes] of Object.entries(patch || {})) {
    if (changes === null) { delete wallets[actorId]; continue; }
    if (!object(changes)) continue;
    const wallet = wallets[actorId] ??= {};
    for (const [currencyId, amount] of Object.entries(changes)) {
      if (amount === null) delete wallet[currencyId];
      else if (Number.isFinite(amount) && amount >= 0) wallet[currencyId] = amount;
    }
  }
}

function affectsWallet(changes) {
  if (!object(changes)) return false;
  const scoped = changes.flags?.[MODULE_ID] ?? changes[`flags.${MODULE_ID}`];
  return scoped?.[FLAG] !== undefined || scoped?.[`-=${FLAG}`] !== undefined
    || changes.flags?.[`-=${MODULE_ID}`] !== undefined || Object.keys(changes).some(key =>
      key.startsWith(`flags.${MODULE_ID}.${FLAG}`) || key === `flags.${MODULE_ID}.-=${FLAG}` || key === `flags.-=${MODULE_ID}`);
}

function actorResources(entry) {
  return new Set([entry.actorId, ...(Array.isArray(entry.resources) ? entry.resources : [])]
    .map(value => typeof value === "string" ? value : value?.actorId).filter(Boolean));
}

function overlaps(left, right) {
  const a = actorResources(left), b = actorResources(right);
  return !a.size || !b.size || [...a].some(actorId => b.has(actorId));
}

/** Shared wallet projection. The elected currency executor supplies serialization. */
export class WalletStore {
  static registerSettings() {
    if (this._registered === game.settings) return;
    game.settings.register(MODULE_ID, ARCHIVE, { scope: "world", config: false, type: Object, default: {} });
    this._registered = game.settings;
  }

  static get isInstalled() { return this._state?.game === globalThis.game && this._settings === game.settings; }

  static install() {
    if (this.isInstalled) return;
    this._settings = game.settings;
    this._rawGet = game.settings.get.bind(game.settings);
    this._rawSet = game.settings.set.bind(game.settings);
    this._state = { game, connection: 0, revision: 0, needsRefresh: false, pending: null };
    this._clock = 0; this._draft = null; this._writing = false;
    this._removed = new Map(); this._freshFlags = null;
    this._archiveQueue = Promise.resolve(); this._legacyDispatcher = null;
    this._lastWallets = this.get();
    const state = this._state;
    game.settings.get = (namespace, key, ...args) => namespace === MODULE_ID && key === SETTING && !args[0]?.document
      ? this.get() : this._rawGet(namespace, key, ...args);
    game.settings.set = (namespace, key, value, ...args) => namespace === MODULE_ID && key === SETTING
      ? this.setLegacyFullReplace(value) : this._rawSet(namespace, key, value, ...args);
    const current = () => this._state === state;
    Hooks.on("updateUser", (user, changes) => {
      if (!current() || !affectsWallet(changes)) return;
      state.revision++;
      this._freshFlags?.set(user.id, clone(user.flags?.[MODULE_ID]?.[FLAG] || {}));
      this._invalidate(!this._writing);
    });
    Hooks.on("createUser", user => {
      if (!current()) return;
      state.revision++;
      this._freshFlags?.set(user.id, clone(user.flags?.[MODULE_ID]?.[FLAG] || {}));
      this._invalidate();
    });
    Hooks.on("deleteUser", user => { if (current()) this._archiveUser(user); });
    for (const hook of ["createSetting", "updateSetting", "deleteSetting"]) Hooks.on(hook, setting => {
      if (!current() || ![SETTING, ARCHIVE].some(key => setting.key === `${MODULE_ID}.${key}`)) return;
      state.revision++; this._invalidate();
    });
    game.socket?.on?.("disconnect", () => { if (current()) { state.connection++; state.needsRefresh = true; } });
    const reconnect = () => { if (current()) void this.ready({ force: true }); };
    game.socket?.on?.("connect", reconnect);
    game.socket?.io?.on?.("reconnect", reconnect);
  }

  static setLegacyDispatcher(callback) { this._legacyDispatcher = callback; }

  static _read(key) {
    try { return (this.isInstalled ? this._rawGet(MODULE_ID, key) : game.settings.get(MODULE_ID, key)) || {}; }
    catch (error) { if (key === ARCHIVE) return {}; throw error; }
  }

  static _events() {
    if (!this.isInstalled) return [];
    const entries = new Map();
    const collect = (author, values) => {
      for (const [key, event] of Object.entries(values || {})) {
        if (!Number.isSafeInteger(event?.clock) || event.clock < 0) continue;
        this._clock = Math.max(this._clock, event.clock);
        entries.set(`${author}/${key}`, { ...event, key, author });
      }
    };
    for (const [author, values] of Object.entries(this._read(ARCHIVE))) collect(author, values);
    for (const [author, values] of this._removed) collect(author, values);
    if (this._freshFlags) for (const [author, values] of this._freshFlags) collect(author, values);
    else for (const user of game.users?.values?.() || game.users?.contents || []) collect(user.id, user.flags?.[MODULE_ID]?.[FLAG]);
    return [...entries.values()].sort((a, b) => a.clock - b.clock || `${a.author}/${a.key}`.localeCompare(`${b.author}/${b.key}`));
  }

  static get({ draft = false } = {}) {
    if (draft && this.isInstalled && this._draft) return clone(this._draft.wallets);
    let wallets = clone(this._read(SETTING));
    if (!object(wallets)) wallets = {};
    for (const entry of this._events()) {
      if (entry.phase !== "completed") continue;
      if (validatesWallets(entry.replace)) wallets = clone(entry.replace);
      applyPatch(wallets, entry.patch);
    }
    return wallets;
  }

  static getReceipt(operationId) {
    if (!operationId) return null;
    const entry = this._events().reverse().find(event => event.operationId === operationId);
    return entry ? (entry.phase === "pending" ? unknown() : clone(entry.result)) : null;
  }

  static async replace(wallets, { full = false } = {}) {
    if (!validatesWallets(wallets)) throw new TypeError("Wallets must contain finite non-negative currency balances.");
    if (!this.isInstalled) return game.settings.set(MODULE_ID, SETTING, clone(wallets));
    if (this._draft) {
      this._draft.wallets = clone(wallets);
      this._draft.full ||= full;
      return clone(wallets);
    }
    const result = await this.transaction(async () => { await this.replace(wallets, { full }); return clone(wallets); });
    if (result?.success === false) {
      const error = new Error(result.error || "Wallet save failed."); error.bankResult = result; throw error;
    }
    return result;
  }

  static async setLegacyFullReplace(wallets) {
    if (!game.user?.isGM) throw new Error("Permission denied.");
    if (!validatesWallets(wallets)) throw new TypeError("Wallets must contain finite non-negative currency balances.");
    if (!this._legacyDispatcher) throw new Error("Currency service is not ready.");
    const result = await this._legacyDispatcher(clone(wallets));
    if (result?.success === false) {
      const error = new Error(result.error || "Wallet restore failed."); error.bankResult = result; throw error;
    }
    return this.get();
  }

  static afterCommit(callback) {
    if (this.isInstalled && this._draft) this._draft.notifications.push(callback);
    else callback();
  }

  static async transaction(callback, { operationId = id(), external = false, actorId = null, requesterId = null, resources = null, guard = () => true } = {}) {
    this.install();
    if (this._draft) throw new Error("Nested currency transaction is not supported.");
    if (!await this.ready()) return { success: false, error: "Currency data could not be refreshed." };
    const receipt = this.getReceipt(operationId);
    if (receipt && !receipt.retryCoordinator) { this._invalidate(); return receipt; }
    if (!await guard()) return { success: false, retryCoordinator: true };
    const metadata = { operationId, actorId, requesterId, external, ...(resources ? { resources: clone(resources) } : {}) };
    if (this._events().some(event => event.phase === "pending" && overlaps(event, metadata))) return unknown();
    const writer = game.user;
    if (!writer?.update) return { success: false, error: "Currency writer is unavailable." };
    const entryId = id();
    // Publish the reservation before any balance change. A replacement executor
    // can then see an earlier executor's in-flight native commit and wait.
    try { await this._persist(writer, entryId, { ...metadata, phase: "pending", clock: ++this._clock }); }
    catch { return unknown(); }
    if (!await guard()) {
      const result = { success: false, retryCoordinator: true };
      try { await this._persist(writer, entryId, { ...metadata, phase: "completed", clock: ++this._clock, result }); }
      catch { return unknown(); }
      return result;
    }
    const before = this.get();
    const draft = { wallets: clone(before), full: false, notifications: [] };
    this._draft = draft;
    let result;
    try { result = await callback(); }
    catch (error) {
      if (external) return { ...unknown(), error: error?.message || String(error) };
      result = { success: false, error: error?.message || String(error) };
    } finally { this._draft = null; }
    if (!await guard()) {
      if (external) return unknown();
      result = { success: false, retryCoordinator: true };
    }
    if (external && (result?.commitUnknown || result?.partialCommit || result?.postCommitError)) {
      return { ...result, success: false, commitUnknown: true, postCommitError: true };
    }
    const success = result?.success !== false;
    const patch = success ? difference(before, draft.wallets) : {};
    const entry = { ...metadata, phase: "completed", clock: ++this._clock, result: clone(result) };
    if (success && draft.full) entry.replace = clone(draft.wallets);
    else if (Object.keys(patch).length) entry.patch = patch;
    try { await this._persist(writer, entryId, entry); }
    catch { this._lastWallets = before; return unknown(); }
    if (success) {
      if (draft.full && !draft.notifications.length) this._notifyChanges(before, this.get());
      for (const notify of draft.notifications) {
        try { notify(); } catch (error) { console.error("GlitchSmith Library | Wallet notification failed", error); }
      }
    }
    return result;
  }

  static async _persist(writer, key, entry) {
    this._writing = true;
    try {
      try { await writer.update({ [`flags.${MODULE_ID}.${FLAG}.${key}`]: entry }); }
      catch (error) {
        // A lost acknowledgement can still represent a committed native User
        // update. Recover this exact reservation/receipt before declaring an
        // unknown outcome; do not repeat its currency or sheet operation.
        if (!await this.ready({ force: true })) throw error;
        const saved = this._events().find(event => event.author === writer.id && event.key === key);
        if (!saved || !Object.entries(entry).every(([name, value]) => equal(saved[name], value))) throw error;
      }
      this._freshFlags?.set(writer.id, clone(writer.flags?.[MODULE_ID]?.[FLAG] || {}));
      this._invalidate(false);
    } finally { this._writing = false; }
  }

  static _notifyChanges(before, after) {
    for (const actorId of new Set([...Object.keys(before), ...Object.keys(after)])) {
      for (const currencyId of new Set([...Object.keys(before[actorId] || {}), ...Object.keys(after[actorId] || {})])) {
        const previous = before[actorId]?.[currencyId] ?? 0, current = after[actorId]?.[currencyId] ?? 0;
        if (previous !== current) fireBalanceChanged({ actorId, currencyId, before: previous, after: current, source: MODULE_ID, reason: "wallet-sync" });
      }
    }
  }

  static _invalidate(notify = true) {
    const wallets = this.get();
    if (notify) this._notifyChanges(this._lastWallets || {}, wallets);
    this._lastWallets = wallets;
  }

  static _archiveUser(user) {
    this._state.revision++;
    const entries = clone(this._freshFlags?.get(user.id) ?? user.flags?.[MODULE_ID]?.[FLAG] ?? {});
    this._freshFlags?.delete(user.id);
    if (Object.keys(entries).length) {
      this._removed.set(user.id, entries);
      if (game.user?.isGM && (!game.users.activeGM || game.users.activeGM.id === game.user.id)) {
        this._archiveQueue = this._archiveQueue.catch(() => {}).then(async () => {
          if (!await this.ready()) throw new Error("Currency archive could not be refreshed.");
          const archive = clone(this._read(ARCHIVE));
          archive[user.id] = { ...archive[user.id], ...entries };
          await this._rawSet(MODULE_ID, ARCHIVE, archive);
        }).catch(error => console.error("GlitchSmith Library | Could not preserve deleted user's wallets", error));
      }
    }
    this._invalidate();
  }

  static ready({ force = false } = {}) {
    this.install();
    const state = this._state;
    if (game.socket?.connected === false) return Promise.resolve(false);
    if (state.pending) return state.pending;
    if (!force && !state.needsRefresh) return Promise.resolve(true);
    state.needsRefresh = true;
    const pending = Promise.resolve().then(async () => {
      let connection, success;
      do {
        connection = state.connection;
        try { success = await this._refresh(state, connection); }
        catch (error) { console.warn("GlitchSmith Library | Wallet refresh failed", error); success = false; }
      } while (this._state === state && game.socket?.connected !== false && connection !== state.connection);
      if (success && this._state === state) state.needsRefresh = false;
      return success;
    }).finally(() => { if (state.pending === pending) state.pending = null; });
    state.pending = pending;
    return pending;
  }

  static async _refresh(state, connection) {
    const users = game.users, userClass = users?.documentClass;
    const storage = game.settings?.storage?.get("world"), settingClass = storage?.documentClass;
    if (!userClass?.database?.get || !settingClass?.database?.get) return false;
    const keys = [SETTING, ARCHIVE].map(key => `${MODULE_ID}.${key}`);
    for (let attempt = 0; attempt < 3; attempt++) {
      const revision = state.revision;
      let timer, snapshots, settings;
      try {
        [snapshots, settings] = await Promise.race([
          Promise.all([userClass.database.get(userClass, { query: {} }), settingClass.database.get(settingClass, { query: { key__in: keys } })]),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Wallet refresh timed out.")), 5000); }),
        ]);
      } finally { clearTimeout(timer); }
      if (this._state !== state || state.connection !== connection || game.socket?.connected === false) return false;
      if (state.revision !== revision) continue;
      for (const key of keys) {
        const snapshot = settings.find(setting => setting.key === key && !setting.user);
        const existing = storage.find(setting => setting.key === key && !setting.user);
        if (!snapshot) { if (existing) storage.delete(existing.id); }
        else if (!existing || existing.id !== snapshot.id) {
          if (existing) storage.delete(existing.id);
          storage.set(snapshot.id, snapshot);
        } else if (!equal(existing.toObject().value, snapshot.toObject().value)) {
          existing.updateSource({ value: clone(snapshot.toObject().value) }, { recursive: false });
        }
      }
      this._freshFlags = new Map(snapshots.map(user => [user.id, clone(user.flags?.[MODULE_ID]?.[FLAG] || {})]));
      for (const snapshot of snapshots) {
        const user = users.get(snapshot.id), value = snapshot.flags?.[MODULE_ID]?.[FLAG];
        if (!user || equal(user.flags?.[MODULE_ID]?.[FLAG], value)) continue;
        user.updateSource({ [`flags.${MODULE_ID}.-=${FLAG}`]: null });
        if (value !== undefined) user.updateSource({ [`flags.${MODULE_ID}.${FLAG}`]: clone(value) });
      }
      this._invalidate(!this._writing);
      return true;
    }
    return false;
  }
}
