import assert from "node:assert/strict";
import test from "node:test";

globalThis.game = {
  system: { id: "generic", title: "Generic", version: "1" },
  modules: new Map(),
  combat: null,
  i18n: { localize: key => key },
};

const {
  actorMetrics,
  createActorMetricsService,
} = await import("../scripts/api/actor-metrics.js");

function actorFor(systemId, system = {}) {
  return {
    id: `${systemId}-actor`,
    documentName: "Actor",
    systemId,
    system,
    items: new Map(),
  };
}

test("built-in providers have stable registrations and immutable public descriptors", () => {
  const providers = actorMetrics.listProviders();
  assert.deepEqual(
    providers.map(provider => provider.registrationId).sort(),
    [
      "dnd5e:builtin.dnd5e",
      "generic:builtin.generic",
      "pf2e:builtin.pf2e",
    ],
  );
  assert.equal(Object.isFrozen(providers), true);
  assert.equal(Object.isFrozen(providers[0]), true);
  assert.equal(providers.every(provider => provider.builtIn), true);
});

test("registry honors priority and compatibility, replaces stable ids, and unregisters", () => {
  const service = createActorMetricsService({ includeBuiltIns: false });
  const actor = actorFor("test", { resource: { value: 4, max: 8 } });
  const definition = [{ id: "resource", path: "system.resource", label: "Configured", semantic: "charge" }];

  service.registerProvider("test", {
    id: "low",
    read: () => [{ value: 1, max: 2 }],
  }, { priority: 1, source: "low-source" });
  service.registerProvider("test", {
    id: "incompatible",
    read: () => [{ value: 99, max: 99 }],
  }, { priority: 100, source: "wrong", isCompatible: () => false });
  const first = service.registerProvider("test", {
    id: "selected",
    read: () => [{
      id: "provider-id",
      path: "system.other",
      label: "Provider Label",
      semantic: "provider-semantic",
      value: 6,
      max: 12,
      color: "#ff0000",
      style: "bar",
      icon: "fas fa-star",
      x: 120,
    }],
  }, { priority: 10, source: "selected-source" });

  const [metric] = service.read(actor, definition);
  assert.equal(metric.value, 6);
  assert.equal(metric.id, "resource");
  assert.equal(metric.path, "system.resource");
  assert.equal(metric.label, "Configured");
  assert.equal(metric.semantic, "charge");
  assert.equal(metric.source, "selected-source");
  assert.equal("color" in metric, false);
  assert.equal("style" in metric, false);
  assert.equal("icon" in metric, false);
  assert.equal("x" in metric, false);

  const replacement = service.registerProvider("test", {
    id: "selected",
    read: () => [{ value: 7, max: 14 }],
  }, { priority: 10, source: "replacement" });
  assert.equal(replacement.registrationId, first.registrationId);
  assert.equal(replacement.order, first.order);
  assert.equal(service.listProviders("test").length, 3);
  assert.equal(service.read(actor, definition)[0].value, 7);

  assert.equal(service.unregisterProvider(replacement.registrationId), true);
  assert.equal(service.unregisterProvider(replacement.registrationId), false);
  assert.equal(service.read(actor, definition)[0].value, 1);
});

test("a priority-zero external provider overrides the lower-priority system built-in", () => {
  const service = createActorMetricsService();
  const actor = actorFor("dnd5e", { attributes: { hp: { value: 3, max: 10 } } });
  service.registerProvider("dnd5e", {
    id: "external.dnd5e",
    read: () => [{ value: 8, max: 10 }],
  }, { priority: 0, source: "external-adapter" });

  const [metric] = service.read(actor, [{ id: "hp", path: "system.attributes.hp", label: "HP" }]);
  assert.equal(metric.value, 8);
  assert.equal(metric.providerId, "external.dnd5e");
  assert.equal(service.listProviders("dnd5e")[0].id, "external.dnd5e");
});

test("an empty provider result is authoritative while null falls through", () => {
  const service = createActorMetricsService();
  const actor = actorFor("empty-system", { score: 7 });
  service.registerProvider("empty-system", {
    id: "declines",
    read: () => null,
  }, { priority: 20 });
  service.registerProvider("empty-system", {
    id: "empty",
    read: () => [],
  }, { priority: 10 });

  assert.deepEqual(service.read(actor, [{ path: "system.score", label: "Score" }]), []);
});

test("read, defaults, and discover accept a system id shorthand", () => {
  const service = createActorMetricsService();
  const actor = actorFor("unknown-system", {
    attributes: { hp: { value: 8, max: 10 } },
  });

  assert.equal(service.read(actor, undefined, "dnd5e")[0].providerId, "builtin.dnd5e");
  assert.equal(service.defaults(actor, "pf2e")[0].providerId, "builtin.pf2e");
  assert.equal(service.discover(actor, "generic")[0].providerId, "builtin.generic");
});

test("generic providers remain fallbacks even when their numeric priority is higher", () => {
  const service = createActorMetricsService();
  const actor = actorFor("dnd5e", { attributes: { hp: { value: 3, max: 10 } } });
  service.registerProvider("generic", {
    id: "generic.override",
    read: () => [{ value: 99, max: 100 }],
  }, { priority: 1000, source: "generic-extension" });

  const [metric] = service.read(actor, [{ id: "hp", path: "system.attributes.hp", label: "HP" }]);
  assert.equal(metric.value, 3);
  assert.equal(metric.providerId, "builtin.dnd5e");
});

test("generic reads support objects, explicit paths, typed arrays, combat, and JSON-safe output", () => {
  const service = createActorMetricsService();
  const actor = actorFor("unknown-system", {
    attributes: { hp: { value: 12, max: 20, temp: 4 } },
    pool: { current: "3", cap: 5, bonus: 2 },
    poolLimit: { maximum: "5" },
    movement: {
      otherSpeeds: [
        { type: "fly", total: "35", value: 30, cap: 50 },
        { type: "swim", total: "15" },
        { type: "burrow", used: 10, max: 20 },
      ],
    },
  });
  globalThis.game.combat = { combatants: [{ actorId: actor.id, initiative: 17 }] };

  const definitions = [
    { id: "hp", path: "system.attributes.hp", label: "HP", semantic: "health", color: "red" },
    {
      id: "pool",
      path: "system.pool.current",
      label: "Pool",
      semantic: "charge",
      maxPath: "@system.poolLimit",
      tempPath: "2",
      style: "dots",
    },
    { path: "system.movement.otherSpeeds.fly", label: "Fly" },
    { path: "system.movement.otherSpeeds.burrow", label: "Burrow" },
    { path: "combat.initiative", label: "Initiative" },
    { path: "system.missing", label: "Missing" },
  ];
  const metrics = service.read(actor, definitions);

  assert.deepEqual(
    metrics.map(metric => [metric.value, metric.max, metric.temp, metric.available]),
    [
      [12, 20, 4, true],
      [3, 5, 2, true],
      [35, 50, 0, true],
      [10, 20, 0, true],
      [17, 0, 0, true],
      [0, 0, 0, false],
    ],
  );
  assert.equal(metrics[0].percent, 60);
  assert.equal(metrics[1].percent, 60);
  assert.equal(metrics[1].maxPath, "@system.poolLimit");
  assert.equal(metrics[1].tempPath, "2");
  assert.equal("color" in metrics[0], false);
  assert.equal("style" in metrics[1], false);
  assert.doesNotThrow(() => JSON.stringify(metrics));
});

test("generic discovery is bounded, cycle-safe, deduplicated, and presentation-neutral", () => {
  const service = createActorMetricsService();
  const system = {
    attribs: { hp: { value: 7, max: 10, temp: 1 } },
    speeds: [{ type: "fly", total: 25 }],
    enabled: true,
  };
  system.loop = system;
  const definitions = service.discover(actorFor("other", system));

  assert.equal(definitions.some(definition => definition.path === "system.attribs.hp.value"), true);
  assert.equal(definitions.some(definition => definition.path === "system.speeds.fly"), true);
  assert.equal(definitions.some(definition => definition.path === "system.enabled"), true);
  assert.equal(definitions.find(definition => definition.path === "system.attribs.hp.value")?.maxPath,
    "system.attribs.hp.max");
  assert.equal(definitions.every(definition => !("style" in definition) && !("icon" in definition)), true);
  assert.equal(new Set(definitions.map(definition => definition.path)).size, definitions.length);
  assert.doesNotThrow(() => JSON.stringify(definitions));
});

test("D&D5e defaults and reads preserve health, item uses, and inspiration state", () => {
  const service = createActorMetricsService();
  const actor = actorFor("dnd5e", {
    attributes: {
      hp: { value: 18, max: 24, temp: 3 },
      ac: { value: 16 },
      movement: { walk: 30 },
      inspiration: true,
      init: { total: 2 },
      spell: { dc: 14 },
    },
    abilities: { str: { value: 16, mod: 3, save: { value: 5 } } },
    skills: { ath: { total: 5, label: "Athletics" } },
    resources: { primary: { value: 2, max: 3, label: "Rage" } },
  });
  actor.items.set("wand", {
    id: "wand",
    name: "Wand",
    system: { uses: { value: 2, max: 5 }, quantity: 1 },
  });

  const defaults = service.defaults(actor);
  assert.deepEqual(defaults.map(definition => definition.id), ["hp", "ac", "speed", "inspiration"]);
  assert.equal(defaults.every(definition => definition.source === "glitchsmith-lib"), true);
  assert.equal(defaults.every(definition => !("style" in definition) && !("color" in definition)), true);

  const metrics = service.read(actor, [
    ...defaults,
    { id: "wand", path: "items.wand.uses", label: "Wand", semantic: "charge" },
  ]);
  assert.deepEqual(
    metrics.map(metric => metric.value),
    [18, 16, 30, true, 2],
  );
  assert.deepEqual(
    metrics.map(metric => metric.max),
    [24, 0, 0, 1, 5],
  );
  assert.equal(metrics[0].temp, 3);
  assert.deepEqual(metrics[3].state, { active: true });
  assert.equal(metrics[3].status, "active");

  const discovered = service.discover(actor);
  assert.equal(discovered.some(definition => definition.path === "items.wand.uses"), true);
  assert.equal(discovered.some(definition => definition.path === "system.abilities.str.save.value"), true);
  assert.equal(discovered.every(definition => !("style" in definition)), true);
});

test("PF2e reads prepared statistics, speeds, shields, items, and spellcasting slots", () => {
  const service = createActorMetricsService();
  const actor = actorFor("pf2e", {
    attributes: {
      hp: { value: 30, max: 40, temp: 2 },
      ac: { value: 21 },
      speed: { value: 25, otherSpeeds: [{ type: "fly", value: 20 }] },
    },
    movement: { speeds: { land: { value: 30 }, fly: { total: 35 } } },
    resources: { heroPoints: { value: 2, max: 3 }, focus: { value: 1, max: 2 } },
    details: { level: { value: 7 } },
  });
  actor._source = { system: { attributes: { speed: { value: 25, otherSpeeds: [{ type: "swim", value: 15 }] } } } };
  actor.attributes = { shield: { hp: { value: 6, max: 10 }, broken: true } };
  actor.perception = { mod: 12 };
  actor.items.set("rope", { id: "rope", name: "Rope", quantity: 3, isOfType: type => type === "physical" });
  actor.spellcasting = new Map([[
    "arcane",
    {
      id: "arcane",
      name: "Arcane",
      isPrepared: true,
      isFlexible: false,
      statistic: { dc: { value: 25 } },
      system: {
        slots: {
          slot1: {
            value: 0,
            max: 3,
            prepared: [
              { id: "a", expended: false },
              { id: "b", expended: true },
              { id: "c", expended: false },
            ],
          },
        },
      },
    },
  ]]);

  const metrics = service.read(actor, [
    { path: "system.attributes.perception.value", label: "Perception" },
    { path: "system.attributes.speed.value", label: "Speed" },
    { path: "system.movement.speeds.fly.total", label: "Fly" },
    { path: "system.attributes.shield.hp", label: "Shield", semantic: "shield" },
    { path: "items.rope.quantity", label: "Rope" },
    { path: "spellcasting.arcane.dc", label: "Arcane DC" },
    { path: "spellcasting.arcane.slots.slot1", label: "Arcane R1" },
  ]);
  assert.deepEqual(metrics.map(metric => metric.value), [12, 30, 35, 6, 3, 25, 2]);
  assert.deepEqual(metrics.map(metric => metric.max), [0, 0, 0, 10, 0, 0, 3]);
  assert.equal(metrics.every(metric => typeof metric.state.broken === "boolean"), true);
  assert.deepEqual(metrics[3].state, { broken: true });
  assert.equal(metrics[3].status, "broken");

  const discovered = service.discover(actor);
  assert.equal(discovered.some(definition => definition.path === "system.attributes.shield.hp"), true);
  assert.equal(discovered.some(definition => definition.path === "items.rope.quantity"), true);
  assert.equal(discovered.some(definition => definition.path === "spellcasting.arcane.slots.slot1"), true);
});

test("provider re-entry is automatically excluded and explicit generic reads remain available", () => {
  const service = createActorMetricsService();
  const actor = actorFor("coc7", { attribs: { hp: { value: 9, max: 12 } } });
  const definitions = [{ id: "hp", path: "system.attribs.hp", label: "HP", semantic: "health" }];
  let calls = 0;

  service.registerProvider("coc7", {
    id: "legacy.coc7",
    read: (innerActor, innerDefinitions) => {
      calls += 1;
      return service.read(innerActor, innerDefinitions);
    },
  }, { priority: 100, source: "stylish-action-hud" });

  const [bridged] = service.read(actor, definitions);
  assert.equal(calls, 1);
  assert.equal(bridged.value, 9);
  assert.equal(bridged.source, "stylish-action-hud");
  assert.equal(bridged.providerId, "legacy.coc7");

  const [generic] = service.read(actor, definitions, { providerId: "builtin.generic" });
  assert.equal(generic.value, 9);
  assert.equal(generic.providerId, "builtin.generic");
  assert.equal(calls, 1);

  const [excluded] = service.read(actor, definitions, {
    excludeProviderIds: ["coc7:legacy.coc7"],
  });
  assert.equal(excluded.providerId, "builtin.generic");
});

test("legacy providers can receive raw definition fields while public data stays canonical", () => {
  const service = createActorMetricsService({ includeBuiltIns: false });
  const actor = actorFor("legacy", { score: { value: 11 } });
  let defaultsContext = null;
  const registration = service.registerProvider("legacy", {
    id: "style-sensitive",
    defaults: (_actor, context) => {
      defaultsContext = context;
      return [{
        path: "system.score",
        label: "Score",
        readMode: "direct",
        style: "badge",
        color: "red",
      }];
    },
    read: (_actor, definitions) => definitions.map(definition => ({
      path: definition.path,
      value: definition.style === "badge" ? 11 : 22,
      max: 0,
      style: definition.style,
      color: definition.color,
    })),
  }, {
    priority: 100,
    source: "stylish-action-hud",
    preserveDefinitionFields: true,
  });

  assert.equal(registration.preserveDefinitionFields, true);
  const publicDefaults = service.defaults(actor, {
    context: { fromHudDefaultRegistry: true, caller: "test" },
  });
  assert.equal(publicDefaults.length, 1);
  assert.equal("style" in publicDefaults[0], false);
  assert.equal("color" in publicDefaults[0], false);
  assert.equal(publicDefaults[0].readMode, "direct");
  assert.equal(defaultsContext.fromHudDefaultRegistry, true);
  assert.equal(defaultsContext.requestContext.fromHudDefaultRegistry, true);
  assert.equal(defaultsContext.requestContext.caller, "test");
  assert.equal(defaultsContext.providerId, "style-sensitive");

  const [fromRawDefaults] = service.read(actor);
  assert.equal(fromRawDefaults.value, 11);
  assert.equal("style" in fromRawDefaults, false);

  const duplicates = service.read(actor, [
    { path: "system.score", label: "Badge", readMode: "direct", style: "badge" },
    { path: "system.score", label: "Number", readMode: "direct", style: "number" },
  ]);
  assert.deepEqual(duplicates.map(metric => metric.value), [11, 22]);
  assert.deepEqual(duplicates.map(metric => metric.label), ["Badge", "Number"]);
  assert.deepEqual(duplicates.map(metric => metric.id), ["system.score", "system.score#2"]);
  assert.equal(duplicates.every(metric => metric.readMode === "direct"), true);
  assert.equal(duplicates.every(metric => metric.path === "system.score"), true);
});

test("provider failures and invalid numeric data fall through or normalize safely", () => {
  const service = createActorMetricsService();
  const actor = actorFor("unstable", { score: 5 });
  const definitions = [{ path: "system.score", label: "Score" }];
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    service.registerProvider("unstable", {
      id: "throws",
      read: () => { throw new Error("failed"); },
    }, { priority: 100, source: "broken" });
    assert.equal(service.read(actor, definitions)[0].value, 5);

    service.registerProvider("unstable", {
      id: "non-finite",
      read: () => [{ value: Number.NaN, max: Number.POSITIVE_INFINITY, temp: "nope" }],
    }, { priority: 200, source: "odd" });
    const [metric] = service.read(actor, definitions);
    assert.equal(metric.value, 0);
    assert.equal(metric.max, 0);
    assert.equal(metric.temp, 0);
    assert.doesNotThrow(() => JSON.stringify(metric));
  } finally {
    console.warn = originalWarn;
  }
});
