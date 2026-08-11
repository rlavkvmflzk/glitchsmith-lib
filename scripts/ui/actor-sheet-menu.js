import { MODULE_ID, SETTING_KEYS } from "../constants.js";

const MENU_ACTION = "glitchsmithOpenActorSheetMenu";
const MENU_CLASS = "glitchsmith-actor-sheet-menu";
const MENU_ICON = "fas fa-hammer";
const MENU_LABEL_KEY = "GLITCHSMITH-LIB.actorSheetMenu.label";

const BUILTIN_CONTROLS = [
  {
    id: "glitchsmith-lib.wallet",
    moduleId: "glitchsmith-lib",
    v1Classes: ["gs-wallet-header-btn"],
    v2Actions: ["gsOpenWallet"],
    label: "GLITCHSMITH-LIB.wallet.headerButton",
    icon: "fas fa-wallet",
  },
  {
    id: "cinematic-cut-ins.actor-config",
    moduleId: "cinematic-cut-ins",
    v1Classes: ["cinematic-config-btn"],
    v2Actions: ["configure-cinematic-actor"],
    label: "Cinematic FX",
    icon: "fas fa-bolt",
  },
  {
    id: "stylish-action-hud.overlay-url",
    moduleId: "stylish-action-hud",
    v1Classes: ["sah-overlay-url"],
    v2Actions: ["sah-overlay-url"],
    label: "HUD Overlay URL",
    icon: "fas fa-link",
  },
  {
    id: "visual-novel-maker.portrait-config",
    moduleId: "visual-novel-maker",
    v1Classes: ["fi-portrait-config-btn"],
    v2Actions: ["fi-portrait-config"],
    label: "FI.Portrait.ConfigTitle",
    icon: "fa-solid fa-face-smile",
  },
  {
    id: "stylish-shop.actor-settings",
    moduleId: "stylish-shop",
    v1Classes: ["stylish-shop-settings"],
    v2Actions: ["ssOpenShopSettings"],
    label: "STYLISH_SHOP.hud.shopSettings",
    icon: "fas fa-store-alt",
  },
  {
    id: "stylish-relationship-tracker.manager",
    moduleId: "stylish-relationship-tracker",
    v1Classes: ["stylish-relationship-tracker-manager"],
    v2Actions: ["srtOpenRelationshipManager"],
    label: "STYLISH_RELATIONSHIP_TRACKER.sidebar.relationshipManager",
    icon: "fas fa-sliders",
  },
  {
    id: "stylish-relationship-tracker.archive",
    moduleId: "stylish-relationship-tracker",
    v1Classes: ["stylish-relationship-tracker-archive"],
    v2Actions: ["srtOpenRelationshipArchive"],
    label: "STYLISH_RELATIONSHIP_TRACKER.sidebar.relationshipArchive",
    icon: "fas fa-heart",
  },
];

const controlRegistry = new Map();
let hooksRegistered = false;
let activeContextMenu = null;
let contextMenuTransition = Promise.resolve();

function _asStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .filter(entry => typeof entry === "string")
      .map(entry => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function _normalizeDefinition(definition) {
  if (!definition || typeof definition !== "object") {
    throw new TypeError("Actor sheet menu control definition must be an object.");
  }

  const moduleId = String(definition.moduleId ?? "").trim();
  const localId = String(definition.id ?? "").trim();
  const id = localId.includes(".") || !moduleId ? localId : `${moduleId}.${localId}`;
  if (!id) throw new TypeError("Actor sheet menu control definition requires an id.");

  const v1Classes = _asStringArray(definition.v1Classes ?? definition.v1Class);
  const v2Actions = _asStringArray(definition.v2Actions ?? definition.v2Action);
  if (v1Classes.length === 0 && v2Actions.length === 0) {
    throw new TypeError(`Actor sheet menu control '${id}' requires a V1 class or V2 action.`);
  }

  return Object.freeze({
    id,
    moduleId,
    v1Classes: Object.freeze(v1Classes),
    v2Actions: Object.freeze(v2Actions),
    label: definition.label ?? "",
    icon: String(definition.icon ?? "").trim(),
  });
}

export function registerActorSheetMenuControl(definition) {
  const normalized = _normalizeDefinition(definition);
  controlRegistry.set(normalized.id, normalized);
  return normalized.id;
}

export function unregisterActorSheetMenuControl(id) {
  return controlRegistry.delete(String(id ?? "").trim());
}

for (const definition of BUILTIN_CONTROLS) registerActorSheetMenuControl(definition);

export function isActorSheetMenuEnabled() {
  try {
    return game.settings.get(MODULE_ID, SETTING_KEYS.ACTOR_SHEET_MENU_CONSOLIDATE) === true;
  } catch (_error) {
    return false;
  }
}

function _getActor(app) {
  return app?.document ?? app?.actor ?? app?.object ?? null;
}

function _isActorApplication(app) {
  return _getActor(app)?.documentName === "Actor";
}

function _controlClasses(control) {
  return String(control?.class ?? control?.classes ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

function _findDefinition(control, applicationV2) {
  const classes = _controlClasses(control);
  const action = String(control?.action ?? "");

  for (const definition of controlRegistry.values()) {
    if (applicationV2 && action && definition.v2Actions.includes(action)) return definition;
    if (definition.v1Classes.some(className => classes.includes(className))) return definition;
  }
  return null;
}

function _localize(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  return game.i18n?.localize?.(value) ?? value;
}

export function resolveActorSheetMenuEntryLabel(entry) {
  const configured = typeof entry?.definition?.label === "function"
    ? entry.definition.label(entry.control, entry.app)
    : entry?.definition?.label;
  return _localize(configured) || _localize(entry?.control?.label) || entry?.definition?.id || "GlitchSmith";
}

function _resolveEntryIcon(entry) {
  return String(entry?.control?.icon ?? entry?.definition?.icon ?? "fas fa-puzzle-piece").trim();
}

function _isEntryVisible(entry, target) {
  const visible = entry?.control?.visible;
  if (typeof visible === "function") return visible.call(entry.app, target);
  return visible !== false;
}

export async function invokeActorSheetMenuEntry(entry, event, target) {
  const control = entry?.control ?? {};
  const app = entry?.app ?? null;
  const directHandler = control.onClick ?? control.onclick;
  if (typeof directHandler === "function") {
    return await directHandler.call(app, event, target);
  }

  const action = control.action ? app?.options?.actions?.[control.action] : null;
  const actionHandler = typeof action === "object" ? action?.handler : action;
  const allowedButtons = typeof action === "object"
    ? (Array.isArray(action?.buttons) ? action.buttons : [0])
    : [0];
  const eventButton = Number.isInteger(event?.button) ? event.button : 0;
  if (typeof actionHandler === "function") {
    if (!allowedButtons.includes(eventButton)) return undefined;
    return await actionHandler.call(app, event, target);
  }

  console.warn(`GlitchSmith Library | No handler found for Actor sheet menu control '${entry?.definition?.id ?? "unknown"}'.`);
  return undefined;
}

function _getContextMenuClass() {
  const contextMenu = globalThis.foundry?.applications?.ux?.ContextMenu ?? globalThis.ContextMenu;
  return contextMenu?.implementation ?? contextMenu ?? null;
}

function _isElement(value) {
  return value?.nodeType === 1 && typeof value.getBoundingClientRect === "function";
}

function _getAnchorEvent(event, target) {
  if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) return event;
  if (!_isElement(target) || typeof MouseEvent !== "function") return event;
  const rect = target.getBoundingClientRect();
  return new MouseEvent("click", {
    bubbles: true,
    clientX: rect.left + Math.min(rect.width, 16),
    clientY: rect.bottom,
  });
}

async function _openActorSheetMenu(app, entries, event, target) {
  const ContextMenuClass = _getContextMenuClass();
  if (!ContextMenuClass || typeof document === "undefined") {
    console.warn("GlitchSmith Library | Foundry ContextMenu is unavailable.");
    return;
  }

  if (activeContextMenu?.close) {
    await activeContextMenu.close({ animate: false });
  }

  const menuItems = createActorSheetContextMenuItems(entries, game.release?.generation ?? 14, event);

  const container = document.createElement("div");
  const menu = new ContextMenuClass(container, ".glitchsmith-actor-sheet-menu-anchor", menuItems, {
    eventName: "click",
    fixed: true,
    jQuery: false,
    relative: "target",
    closeOnSelect: true,
    onClose: () => {
      if (activeContextMenu === menu) activeContextMenu = null;
      if (globalThis.ui?.context === menu) globalThis.ui.context = null;
    },
  });
  activeContextMenu = menu;

  const anchor = _isElement(target)
    ? target
    : (_isElement(event?.currentTarget) ? event.currentTarget : document.body);
  await menu.render(anchor, { event: _getAnchorEvent(event, anchor) });

  const menuElement = _isElement(menu.element) ? menu.element : menu.element?.[0];
  if (menuElement?.isConnected) {
    if (globalThis.ui) globalThis.ui.context = menu;
  } else if (activeContextMenu === menu) {
    activeContextMenu = null;
  }
}

function _invokeContextMenuEntry(entry, event, target) {
  void invokeActorSheetMenuEntry(entry, event, target).catch(error => {
    console.error(`GlitchSmith Library | Actor sheet menu action '${entry.definition.id}' failed:`, error);
  });
}

function _requestActorSheetMenu(app, entries, event, target) {
  event?.preventDefault?.();
  if (!entries.some(entry => _isEntryVisible(entry, target))) return;

  const transition = contextMenuTransition
    .catch(() => undefined)
    .then(() => _openActorSheetMenu(app, entries, event, target));
  contextMenuTransition = transition;
  void transition.catch(error => {
    console.error("GlitchSmith Library | Failed to open the Actor sheet menu:", error);
  });
}

function _sanitizeIconClass(icon) {
  return String(icon ?? "").replace(/[^a-zA-Z0-9_\-\s]/g, "").trim();
}

export function createActorSheetContextMenuItems(
  entries,
  generation = game.release?.generation ?? 14,
  openingEvent,
) {
  if (Number(generation) <= 13) {
    return entries.map(entry => ({
      name: resolveActorSheetMenuEntryLabel(entry),
      icon: `<i class="${_sanitizeIconClass(_resolveEntryIcon(entry))}"></i>`,
      condition: target => _isEntryVisible(entry, target),
      callback: target => _invokeContextMenuEntry(entry, openingEvent, target),
    }));
  }

  return entries.map(entry => ({
    label: resolveActorSheetMenuEntryLabel(entry),
    icon: _resolveEntryIcon(entry),
    visible: target => _isEntryVisible(entry, target),
    onClick: (menuEvent, menuTarget) => _invokeContextMenuEntry(entry, menuEvent, menuTarget),
  }));
}

function _createUnifiedControl(app, entries, applicationV2) {
  const label = _localize(MENU_LABEL_KEY) || "GlitchSmith";
  const openMenu = (event, target) => _requestActorSheetMenu(app, entries, event, target);

  if (!applicationV2) {
    return {
      label,
      class: MENU_CLASS,
      icon: MENU_ICON,
      onclick: openMenu,
    };
  }

  app.options ??= {};
  app.options.actions ??= {};
  app.options.actions[MENU_ACTION] = function (event, target) {
    _requestActorSheetMenu(this, entries, event, target);
  };

  return {
    label,
    class: MENU_CLASS,
    action: MENU_ACTION,
    icon: MENU_ICON,
    visible: () => entries.some(entry => _isEntryVisible(entry)),
  };
}

export function consolidateActorSheetControls(app, controls, { applicationV2 = false, enabled } = {}) {
  const shouldConsolidate = enabled ?? isActorSheetMenuEnabled();
  if (!shouldConsolidate || !_isActorApplication(app) || !Array.isArray(controls)) return null;

  const entries = [];
  let insertionIndex = -1;
  for (let index = 0; index < controls.length; index += 1) {
    const control = controls[index];
    const definition = _findDefinition(control, applicationV2);
    if (!definition) continue;
    if (insertionIndex < 0) insertionIndex = index;
    entries.push({ app, control, definition, applicationV2 });
  }

  if (entries.length === 0) return null;

  for (let index = controls.length - 1; index >= 0; index -= 1) {
    if (_findDefinition(controls[index], applicationV2)) controls.splice(index, 1);
  }

  const menuControl = _createUnifiedControl(app, entries, applicationV2);
  controls.splice(Math.min(insertionIndex, controls.length), 0, menuControl);
  return { entries, menuControl };
}

export function registerActorSheetMenuHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;

  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    consolidateActorSheetControls(sheet, buttons, { applicationV2: false });
  });

  Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    consolidateActorSheetControls(app, controls, { applicationV2: true });
  });
}

export const actorSheetMenu = Object.freeze({
  registerControl: registerActorSheetMenuControl,
  unregisterControl: unregisterActorSheetMenuControl,
  isEnabled: isActorSheetMenuEnabled,
});
