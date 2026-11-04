export function createCurrencyServiceFixture() {
  const definitions = { base: "coin", currencies: {
    coin: { type: "virtual", rate: 1, integer: true, increment: 1 },
    token: { type: "virtual", rate: 2, integer: false, precision: 2, increment: 0.05 },
    gold: { type: "sheet", rate: 1, integer: true, actorPath: "system.gold" },
    silver: { type: "sheet", rate: 0.1, integer: false, precision: 2, increment: 0.05, actorPath: "system.silver" },
  } };
  const raw = { "currency.definitions": definitions, "currency.wallets": { actor: { coin: 100, token: 10 } }, "currency.walletLedgerArchive": {} };
  const hooks = new Map(), socketListeners = new Map(), responses = new Map(), notifications = [];
  let sequence = 0, userWrites = 0, actorWrites = 0, failActor = false;
  const setPath = (target, path, value) => {
    const parts = path.split("."); let cursor = target;
    for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
    cursor[parts.at(-1)] = structuredClone(value);
  };
  const users = [{ id: "gm", isGM: true, active: true, flags: {} }, { id: "owner", isGM: false, active: true, flags: {} }, { id: "viewer", isGM: false, active: true, flags: {} }];
  users.get = id => users.find(user => user.id === id); users.activeGM = users[0];
  for (const user of users) {
    user.update = async changes => {
      userWrites++; for (const [path, value] of Object.entries(changes)) setPath(user, path, value);
      Hooks.callAll("updateUser", user, changes); return user;
    };
    user.updateSource = changes => {
      for (const [path, value] of Object.entries(changes)) {
        if (path.includes(".-=")) delete user.flags["glitchsmith-lib"]?.[path.split(".-=")[1]];
        else setPath(user, path, value);
      }
    };
  }
  users.documentClass = { database: { get: async () => users.map(user => ({ id: user.id, flags: structuredClone(user.flags) })) } };
  const actor = { id: "actor", uuid: "Actor.actor", system: { gold: 100, silver: 10 },
    testUserPermission: (user, permission) => permission === "OWNER" && (user.id === "owner" || user.isGM),
    async update(changes) {
      actorWrites++; for (const [path, value] of Object.entries(changes)) setPath(actor, path, value);
      if (failActor) throw new Error("Actor response was lost after saving"); return actor;
    },
  };
  const storage = new Map(); storage.find = predicate => [...storage.values()].find(predicate);
  const makeSetting = key => ({ id: key, key: `glitchsmith-lib.${key}`, value: raw[key],
    toObject: () => ({ value: structuredClone(raw[key]) }), updateSource: data => { raw[key] = structuredClone(data.value); } });
  for (const key of ["currency.wallets", "currency.walletLedgerArchive"]) storage.set(key, makeSetting(key));
  storage.documentClass = { database: { get: async () => [...storage.values()] } };
  globalThis.FormApplication = class {};
  globalThis.foundry = { utils: { deepClone: structuredClone, randomID: () => `id-${++sequence}`, mergeObject: (a, b) => ({ ...a, ...b }),
    getProperty: (source, path) => path.split(".").reduce((value, key) => value?.[key], source) },
    applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => class extends Base {} } } };
  globalThis.Hooks = {
    on(name, handler) { if (!hooks.has(name)) hooks.set(name, []); hooks.get(name).push(handler); },
    callAll(name, ...args) { if (name.endsWith("balanceChanged")) notifications.push(args[0]); for (const handler of hooks.get(name) || []) handler(...args); },
  };
  globalThis.fromUuid = async uuid => uuid === actor.uuid ? actor : null;
  globalThis.game = { user: users[0], users, actors: new Map([["actor", actor]]), system: { id: "test-system" },
    socket: { connected: true,
      on: (name, listener) => socketListeners.set(name, listener),
      emit: (_channel, message) => { if (message.type === "response") responses.get(message.requestId)?.(message.result); },
    }, settings: { storage: new Map([["world", storage]]),
      get: (_moduleId, key) => structuredClone(raw[key]),
      set: async (_moduleId, key, value) => { raw[key] = structuredClone(value); return value; }, register() {},
    },
  };
  return { users, actor, raw, notifications,
    get userWrites() { return userWrites; }, get actorWrites() { return actorWrites; }, set failActor(value) { failActor = value; },
    async request(requesterId, handlerName, data = {}) {
      const requestId = `remote-${++sequence}`;
      return new Promise(resolve => {
        responses.set(requestId, resolve);
        socketListeners.get("module.glitchsmith-lib")({ type: "request", requestId, handlerName, data, responderId: game.user.id }, requesterId);
      });
    },
  };
}
