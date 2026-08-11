import assert from "node:assert/strict";
import test from "node:test";

const state = { enabled: false };

globalThis.game = {
  i18n: {
    localize: key => ({
      "GLITCHSMITH-LIB.actorSheetMenu.label": "GlitchSmith",
      "GLITCHSMITH-LIB.wallet.headerButton": "Wallet",
      "STYLISH_SHOP.hud.shopSettings": "Shop Settings",
    })[key] ?? key,
  },
  settings: {
    get(moduleId, key) {
      assert.equal(moduleId, "glitchsmith-lib");
      assert.equal(key, "actorSheetMenu.consolidate");
      return state.enabled;
    },
  },
};

globalThis.Hooks = { on() {} };

const {
  consolidateActorSheetControls,
  createActorSheetContextMenuItems,
  invokeActorSheetMenuEntry,
  registerActorSheetMenuControl,
  resolveActorSheetMenuEntryLabel,
  unregisterActorSheetMenuControl,
} = await import("../scripts/ui/actor-sheet-menu.js");

function actorApp() {
  return {
    document: { documentName: "Actor" },
    options: { actions: {} },
  };
}

test("an explicitly disabled consolidation option leaves controls untouched", () => {
  state.enabled = false;
  const app = actorApp();
  const controls = [
    { class: "gs-wallet-header-btn", label: "Wallet" },
    { class: "third-party", label: "Other" },
  ];

  assert.equal(consolidateActorSheetControls(app, controls), null);
  assert.deepEqual(controls.map(control => control.class), ["gs-wallet-header-btn", "third-party"]);
});

test("V1 GlitchSmith controls collapse to one menu while third-party controls stay in place", () => {
  const app = actorApp();
  const controls = [
    { class: "third-party-first", label: "Other" },
    { class: "gs-wallet-header-btn", label: "" },
    { class: "cinematic-config-btn", label: "Cinematic FX" },
    { class: "fi-portrait-config-btn", label: "" },
    { class: "stylish-shop-settings", label: "" },
    { class: "stylish-relationship-tracker-manager", label: "Manager" },
    { class: "stylish-relationship-tracker-archive", label: "Archive" },
    { class: "sah-overlay-url", label: "HUD Overlay URL" },
    { class: "third-party-last", label: "Other 2" },
  ];

  const result = consolidateActorSheetControls(app, controls, { enabled: true });

  assert.equal(result.entries.length, 7);
  assert.equal(controls.length, 3);
  assert.equal(controls[0].class, "third-party-first");
  assert.equal(controls[1].class, "glitchsmith-actor-sheet-menu");
  assert.equal(controls[2].class, "third-party-last");
  assert.equal(controls[1].label, "GlitchSmith");
  assert.equal(resolveActorSheetMenuEntryLabel(result.entries[0]), "Wallet");
  assert.equal(resolveActorSheetMenuEntryLabel(result.entries[3]), "Shop Settings");
});

test("V2 action controls collapse and install a current app action", () => {
  const app = actorApp();
  const controls = [
    { action: "gsOpenWallet", label: "Wallet" },
    { action: "configure-cinematic-actor", label: "Cinematic FX" },
    { action: "sah-overlay-url", label: "HUD Overlay URL" },
    { action: "fi-portrait-config", label: "Portrait" },
    { action: "ssOpenShopSettings", label: "Shop Settings" },
    { action: "srtOpenRelationshipManager", label: "Manager" },
    { action: "srtOpenRelationshipArchive", label: "Archive" },
    { action: "system-control", label: "System" },
  ];

  const result = consolidateActorSheetControls(app, controls, { applicationV2: true, enabled: true });

  assert.equal(result.entries.length, 7);
  assert.deepEqual(controls.map(control => control.action), ["glitchsmithOpenActorSheetMenu", "system-control"]);
  assert.equal(typeof app.options.actions.glitchsmithOpenActorSheetMenu, "function");
  assert.equal(controls[0].onClick, undefined);
});

test("menu entries preserve direct callbacks and ApplicationV2 action this binding", async () => {
  const event = { type: "click" };
  const target = { id: "target" };
  const directApp = actorApp();
  let directArgs = null;
  const directControl = {
    onClick(receivedEvent, receivedTarget) {
      directArgs = { thisValue: this, receivedEvent, receivedTarget };
      return "direct";
    },
  };

  assert.equal(await invokeActorSheetMenuEntry({ app: directApp, control: directControl }, event, target), "direct");
  assert.deepEqual(directArgs, { thisValue: directApp, receivedEvent: event, receivedTarget: target });

  const actionApp = actorApp();
  let actionThis = null;
  actionApp.options.actions.openThing = function () {
    actionThis = this;
    return "action";
  };
  assert.equal(
    await invokeActorSheetMenuEntry({ app: actionApp, control: { action: "openThing" } }, event, target),
    "action",
  );
  assert.equal(actionThis, actionApp);

  const descriptorApp = actorApp();
  let descriptorCalls = 0;
  descriptorApp.options.actions.openWithRightClick = {
    buttons: [2],
    handler() {
      descriptorCalls += 1;
      assert.equal(this, descriptorApp);
      return "descriptor";
    },
  };
  const descriptorEntry = { app: descriptorApp, control: { action: "openWithRightClick" } };
  assert.equal(await invokeActorSheetMenuEntry(descriptorEntry, { button: 0 }, target), undefined);
  assert.equal(await invokeActorSheetMenuEntry(descriptorEntry, { button: 2 }, target), "descriptor");
  assert.equal(descriptorCalls, 1);
});

test("custom registry controls normalize matchers and can be unregistered", () => {
  const id = registerActorSheetMenuControl({
    moduleId: "example-module",
    id: "custom-action",
    v1Class: "  example-control  ",
    label: "Example",
  });
  assert.equal(id, "example-module.custom-action");

  const app = actorApp();
  const controls = [{ class: "example-control", label: "Example" }];
  const result = consolidateActorSheetControls(app, controls, { enabled: true });
  assert.equal(result.entries.length, 1);
  assert.equal(controls[0].class, "glitchsmith-actor-sheet-menu");

  assert.equal(unregisterActorSheetMenuControl(id), true);
  const restoredControls = [{ class: "example-control", label: "Example" }];
  assert.equal(consolidateActorSheetControls(app, restoredControls, { enabled: true }), null);
});

test("V2 unified control is hidden when every original control is hidden", () => {
  const app = actorApp();
  const controls = [{ action: "gsOpenWallet", label: "Wallet", visible: false }];
  const result = consolidateActorSheetControls(app, controls, { applicationV2: true, enabled: true });

  assert.equal(typeof result.menuControl.visible, "function");
  assert.equal(result.menuControl.visible(), false);
});

test("ContextMenu entries adapt to the V13 and V14 APIs", async () => {
  const app = actorApp();
  let visibleThis = null;
  let clicked = 0;
  const entry = {
    app,
    definition: { id: "test.action", label: "Test Action", icon: "fas fa-star" },
    control: {
      visible() {
        visibleThis = this;
        return true;
      },
      onClick() {
        clicked += 1;
      },
    },
  };

  const openingEvent = { type: "opening-click" };
  const [v13] = createActorSheetContextMenuItems([entry], 13, openingEvent);
  assert.equal(v13.name, "Test Action");
  assert.equal(v13.icon, '<i class="fas fa-star"></i>');
  assert.equal(v13.condition({}), true);
  assert.equal(visibleThis, app);
  await v13.callback({});

  const [v14] = createActorSheetContextMenuItems([entry], 14);
  assert.equal(v14.label, "Test Action");
  assert.equal(v14.icon, "fas fa-star");
  assert.equal(v14.visible({}), true);
  await v14.onClick({ type: "click" }, {});
  assert.equal(clicked, 2);
});

test("non-Actor applications are never consolidated", () => {
  const app = { document: { documentName: "Item" }, options: { actions: {} } };
  const controls = [{ action: "gsOpenWallet", label: "Wallet" }];
  assert.equal(consolidateActorSheetControls(app, controls, { applicationV2: true, enabled: true }), null);
  assert.equal(controls[0].action, "gsOpenWallet");
});
