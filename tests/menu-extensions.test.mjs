import assert from "node:assert/strict";
import test from "node:test";

const changedEvents = [];
globalThis.Hooks = {
  callAll(hook, payload) {
    changedEvents.push({ hook, payload });
  },
};

const { HOOKS } = await import("../scripts/constants.js");
const { callMenuExtensionRegistrationHook, menuExtensions } = await import(
  "../scripts/api/menu-extensions.js"
);

function provider(id, overrides = {}) {
  return {
    id,
    title: `Provider ${id}`,
    load: () => [],
    execute: () => null,
    ...overrides,
  };
}

function cleanup(...ids) {
  for (const id of ids) menuExtensions.unregisterProvider(id);
  changedEvents.length = 0;
}

test("provider registration validates ids, requires explicit replacement, and exposes callback-free immutable copies", () => {
  const id = "tests.registration";
  cleanup(id);
  assert.throws(
    () => menuExtensions.registerProvider(provider("Tests.Bad")),
    /namespaced lowercase/u,
  );
  assert.throws(
    () => menuExtensions.registerProvider(provider("tests.bad.")),
    /namespaced lowercase/u,
  );

  const registered = menuExtensions.registerProvider(
    provider(id, {
      subtitle: "x".repeat(400),
      icon: "<img>",
      source: "test-module",
      order: 20000,
      canDisplay: () => true,
      home: {
        label: "Test",
        icon: "fa-solid fa-stars",
        image: "tiles/test.webp",
        defaultSize: "2x1",
        profiles: ["player", "player", "gm"],
      },
    }),
  );

  assert.deepEqual(Object.keys(registered), [
    "id",
    "title",
    "titleKey",
    "subtitle",
    "subtitleKey",
    "icon",
    "source",
    "order",
    "home",
  ]);
  assert.equal(registered.subtitle.length, 280);
  assert.equal(registered.icon, "");
  assert.equal(registered.order, 10000);
  assert.deepEqual(registered.home.profiles, ["player", "gm"]);
  assert.equal(Object.isFrozen(registered), true);
  assert.equal(Object.isFrozen(registered.home), true);
  assert.equal(Object.isFrozen(registered.home.profiles), true);
  assert.throws(() => menuExtensions.registerProvider(provider(id)), /already registered/u);

  const replacement = menuExtensions.registerProvider(provider(id, { title: "Replacement" }), {
    replace: true,
  });
  assert.equal(replacement.title, "Replacement");
  assert.equal(menuExtensions.listProviders().find(item => item.id === id).title, "Replacement");
  assert.equal(Object.isFrozen(menuExtensions.listProviders()), true);

  const registrationEvents = changedEvents.filter(
    event => event.hook === HOOKS.MENU_EXTENSIONS_CHANGED,
  );
  assert.equal(registrationEvents.length, 2);
  assert.equal(registrationEvents[0].payload.type, "registered");
  assert.equal(registrationEvents[0].payload.providerId, id);
  assert.equal(Object.isFrozen(registrationEvents[0].payload), true);
  assert.equal("load" in registrationEvents[0].payload.provider, false);
  cleanup(id);
});

test("the init registration hook exposes the stable facade and registration shortcut", () => {
  const id = "tests.registration-hook";
  cleanup(id);
  callMenuExtensionRegistrationHook();
  const event = changedEvents.find(item => item.hook === HOOKS.REGISTER_MENU_EXTENSIONS);
  assert.ok(event);
  assert.equal(Object.isFrozen(event.payload), true);
  assert.equal(event.payload.menuExtensions, menuExtensions);
  event.payload.register(provider(id));
  assert.equal(menuExtensions.listProviders().some(item => item.id === id), true);
  cleanup(id);
});

test("providers are sorted and touch/unregister emit object change payloads", () => {
  const ids = ["tests.sorted-b", "tests.sorted-a"];
  cleanup(...ids);
  menuExtensions.registerProvider(provider(ids[0], { order: 2 }));
  menuExtensions.registerProvider(provider(ids[1], { order: 1 }));
  assert.deepEqual(
    menuExtensions
      .listProviders()
      .filter(item => ids.includes(item.id))
      .map(item => item.id),
    [ids[1], ids[0]],
  );

  changedEvents.length = 0;
  assert.equal(menuExtensions.touchProvider(ids[0]), true);
  assert.equal(menuExtensions.touchProvider("tests.missing-touch"), false);
  assert.equal(menuExtensions.unregisterProvider(ids[0]), true);
  assert.equal(menuExtensions.unregisterProvider(ids[0]), false);
  assert.deepEqual(
    changedEvents.map(event => event.payload.type),
    ["touched", "unregistered"],
  );
  assert.equal(changedEvents[1].payload.provider.id, ids[0]);
  cleanup(...ids);
});

test("canDisplay returns false for missing or stale providers and contextualizes callback failures", async () => {
  const ids = ["tests.available", "tests.availability-error"];
  cleanup(...ids);
  assert.equal(await menuExtensions.canDisplay("tests.missing-provider"), false);

  menuExtensions.registerProvider(
    provider(ids[0], {
      async canDisplay() {
        menuExtensions.registerProvider(provider(ids[0]), { replace: true });
        return true;
      },
    }),
  );
  assert.equal(await menuExtensions.canDisplay(ids[0]), false);

  const cause = new Error("provider failure");
  menuExtensions.registerProvider(
    provider(ids[1], {
      canDisplay() {
        throw cause;
      },
    }),
  );
  await assert.rejects(menuExtensions.canDisplay(ids[1]), error => {
    assert.match(error.message, /tests\.availability-error.*availability check/u);
    assert.equal(error.cause, cause);
    return true;
  });
  cleanup(...ids);
});

test("loadEntries sanitizes bounded immutable entries and rechecks availability", async () => {
  const id = "tests.entries";
  cleanup(id);
  let checks = 0;
  menuExtensions.registerProvider(
    provider(id, {
      canDisplay() {
        checks += 1;
        return true;
      },
      load() {
        return [
          {
            id: " entry-1 ",
            title: "A".repeat(300),
            icon: "fa-solid fa-bolt",
            image: null,
            badges: [...Array.from({ length: 10 }, (_, index) => `Badge ${index}`), 2],
            actions: [
              ...Array.from({ length: 10 }, (_, index) => ({
                id: `action-${index}`,
                label: `Action ${index}`,
                primary: index === 0,
                closesFirst: true,
              })),
              { id: "bad\u0000action" },
            ],
          },
          { id: "entry-1", title: "duplicate" },
          { title: "missing id" },
        ];
      },
    }),
  );

  const entries = await menuExtensions.loadEntries(id, { profileKey: "gm" });
  assert.equal(checks, 2);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "entry-1");
  assert.equal(entries[0].title.length, 180);
  assert.equal(entries[0].badges.length, 8);
  assert.equal(entries[0].actions.length, 8);
  assert.equal(entries[0].actions[0].primary, true);
  assert.equal(entries[0].actions[0].closesFirst, true);
  assert.equal(Object.isFrozen(entries), true);
  assert.equal(Object.isFrozen(entries[0]), true);
  assert.equal(Object.isFrozen(entries[0].actions), true);
  cleanup(id);
});

test("loadPage wraps legacy entry arrays without changing loadEntries compatibility", async () => {
  const id = "tests.legacy-page";
  cleanup(id);
  menuExtensions.registerProvider(
    provider(id, {
      load: () => [{ id: "legacy-entry", title: "Legacy" }],
    }),
  );

  const page = await menuExtensions.loadPage(id);
  assert.equal(page.layout, "list");
  assert.equal(page.activeTab, null);
  assert.deepEqual(page.tabs, []);
  assert.deepEqual(page.navigation, { tabId: null, path: [] });
  assert.deepEqual(page.breadcrumbs, []);
  assert.equal(page.entries[0].id, "legacy-entry");
  assert.equal(Object.isFrozen(page), true);
  assert.equal(Object.isFrozen(page.navigation), true);
  assert.equal(Object.isFrozen(page.navigation.path), true);

  const entries = await menuExtensions.loadEntries(id);
  assert.equal(entries[0].id, "legacy-entry");
  assert.equal(Object.isFrozen(entries), true);
  cleanup(id);
});

test("loadPage sanitizes structured tabs, hierarchy, and navigation actions into bounded immutable data", async () => {
  const id = "tests.structured-page";
  cleanup(id);
  const tabs = [
    { id: "scenes", labelKey: "TEST.Scenes", extra: () => "not public" },
    { id: "actors", label: "Actors", icon: "fa-solid fa-users" },
    { id: "actors", label: "Duplicate" },
    { id: "missing-label" },
    { id: "bad\u0000tab", label: "Bad" },
    ...Array.from({ length: 30 }, (_, index) => ({
      id: `extra-${index}`,
      label: `Extra ${index}`,
    })),
  ];
  const breadcrumbs = Array.from({ length: 20 }, (_, index) => ({
    label: `Crumb ${index}`,
    navigation: {
      tabId: index === 0 ? null : "actors",
      path: Array.from({ length: 12 }, (__, pathIndex) => ` level-${pathIndex} `),
    },
    callback: () => "not public",
  }));

  menuExtensions.registerProvider(
    provider(id, {
      load: () => ({
        title: " Gallery\u0000Title ",
        subtitle: "Choose an actor",
        layout: "gallery",
        tabs,
        activeTab: "missing",
        navigation: {
          tabId: " actors ",
          path: Array.from({ length: 12 }, (_, index) => ` actor-${index} `),
        },
        breadcrumbs,
        entries: [
          {
            id: "actor.one",
            title: "Actor One",
            actions: [
              {
                id: "browse-actor",
                label: "Browse",
                navigation: {
                  tabId: " actors ",
                  path: [" actor.one ", "presets", "bad\u0000segment", "ignored"],
                },
                callback: () => "not public",
              },
              { id: "play", label: "Play" },
            ],
          },
        ],
        callback: () => "not public",
      }),
    }),
  );

  const page = await menuExtensions.loadPage(id);
  assert.equal(page.title, "Gallery Title");
  assert.equal(page.layout, "gallery");
  assert.equal(page.tabs.length, 24);
  assert.deepEqual(
    page.tabs.slice(0, 2).map(tab => tab.id),
    ["scenes", "actors"],
  );
  assert.equal(page.activeTab, "actors");
  assert.equal(page.navigation.tabId, "actors");
  assert.equal(page.navigation.path.length, 8);
  assert.equal(page.navigation.path[0], "actor-0");
  assert.equal(page.breadcrumbs.length, 16);
  assert.equal(page.breadcrumbs[0].navigation.tabId, null);
  assert.equal(page.breadcrumbs[1].navigation.path.length, 8);
  assert.equal("callback" in page, false);
  assert.equal("extra" in page.tabs[0], false);
  assert.equal("callback" in page.breadcrumbs[0], false);

  const browseAction = page.entries[0].actions[0];
  assert.deepEqual(browseAction.navigation, {
    tabId: "actors",
    path: ["actor.one", "presets"],
  });
  assert.equal(page.entries[0].actions[1].navigation, null);
  assert.equal("callback" in browseAction, false);
  assert.equal(Object.isFrozen(page.tabs), true);
  assert.equal(Object.isFrozen(page.tabs[0]), true);
  assert.equal(Object.isFrozen(page.breadcrumbs), true);
  assert.equal(Object.isFrozen(page.breadcrumbs[0].navigation.path), true);
  assert.equal(Object.isFrozen(browseAction.navigation), true);
  assert.equal(Object.isFrozen(browseAction.navigation.path), true);
  assert.equal((await menuExtensions.loadEntries(id))[0].id, "actor.one");
  cleanup(id);
});

test("loadPage rejects malformed structured entries and falls back to the list layout token", async () => {
  const ids = ["tests.invalid-page-entries", "tests.invalid-page-layout"];
  cleanup(...ids);
  menuExtensions.registerProvider(
    provider(ids[0], {
      load: () => ({ layout: "gallery", entries: null }),
    }),
  );
  await assert.rejects(menuExtensions.loadPage(ids[0]), /non-array entry result/u);

  menuExtensions.registerProvider(
    provider(ids[1], {
      load: () => ({ layout: "cards", entries: [] }),
    }),
  );
  assert.equal((await menuExtensions.loadPage(ids[1])).layout, "list");
  cleanup(...ids);
});

test("loadPage discards a structured page when its provider is replaced while loading", async () => {
  const id = "tests.stale-page";
  cleanup(id);
  let release;
  const blocked = new Promise(resolve => {
    release = resolve;
  });
  menuExtensions.registerProvider(
    provider(id, {
      async load() {
        await blocked;
        return {
          layout: "gallery",
          tabs: [{ id: "actors", label: "Actors" }],
          activeTab: "actors",
          entries: [{ id: "stale" }],
        };
      },
    }),
  );

  const pending = menuExtensions.loadPage(id);
  await Promise.resolve();
  menuExtensions.registerProvider(provider(id), { replace: true });
  release();
  const page = await pending;
  assert.equal(page.layout, "list");
  assert.deepEqual(page.entries, []);
  assert.deepEqual(page.navigation, { tabId: null, path: [] });
  assert.equal(Object.isFrozen(page), true);
  cleanup(id);
});

test("loadEntries discards stale results when a provider is replaced while loading", async () => {
  const id = "tests.stale-load";
  cleanup(id);
  let release;
  const blocked = new Promise(resolve => {
    release = resolve;
  });
  menuExtensions.registerProvider(
    provider(id, {
      async load() {
        await blocked;
        return [{ id: "stale" }];
      },
    }),
  );

  const pending = menuExtensions.loadEntries(id);
  await Promise.resolve();
  menuExtensions.registerProvider(provider(id), { replace: true });
  release();
  assert.deepEqual(await pending, []);
  cleanup(id);
});

test("loadEntries caps provider results at five hundred entries", async () => {
  const id = "tests.entry-limit";
  cleanup(id);
  menuExtensions.registerProvider(
    provider(id, {
      load: () => Array.from({ length: 510 }, (_, index) => ({ id: `entry-${index}` })),
    }),
  );
  const entries = await menuExtensions.loadEntries(id);
  assert.equal(entries.length, 500);
  assert.equal(entries.at(-1).id, "entry-499");
  cleanup(id);
});

test("execute normalizes ids, checks availability, returns provider results, and contextualizes failures", async () => {
  const ids = ["tests.execute", "tests.execute-error", "tests.unavailable"];
  cleanup(...ids);
  let received = null;
  const resultValue = { opened: true };
  menuExtensions.registerProvider(
    provider(ids[0], {
      canDisplay: () => true,
      execute(actionId, entryId, context) {
        received = { actionId, entryId, context };
        return resultValue;
      },
    }),
  );
  const context = { actorId: "a1" };
  assert.equal(await menuExtensions.execute(ids[0], " open ", " actor.a1 ", context), resultValue);
  assert.deepEqual(received, { actionId: "open", entryId: "actor.a1", context });

  const cause = new Error("execute failed");
  menuExtensions.registerProvider(
    provider(ids[1], {
      execute() {
        throw cause;
      },
    }),
  );
  await assert.rejects(menuExtensions.execute(ids[1], "open", "one"), error => {
    assert.match(error.message, /tests\.execute-error.*action "open" execution/u);
    assert.equal(error.cause, cause);
    return true;
  });

  menuExtensions.registerProvider(provider(ids[2], { canDisplay: () => false }));
  await assert.rejects(menuExtensions.execute(ids[2], "open", "one"), /not available/u);
  cleanup(...ids);
});

test("execute rejects completion from a provider replaced during its callback", async () => {
  const id = "tests.stale-execute";
  cleanup(id);
  menuExtensions.registerProvider(
    provider(id, {
      execute() {
        menuExtensions.registerProvider(provider(id), { replace: true });
        return { stale: true };
      },
    }),
  );
  await assert.rejects(menuExtensions.execute(id, "open", "one"), /changed during action execution/u);
  cleanup(id);
});
