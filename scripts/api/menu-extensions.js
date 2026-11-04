import { HOOKS } from "../constants.js";

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const CONTROL_CHARACTERS_PATTERN = /[\u0000-\u001f\u007f]/gu;
const ICON_PATTERN = /^[a-z0-9 _-]+$/iu;
const HOME_SIZES = new Set(["1x1", "2x1", "2x2"]);
const PROFILE_KEYS = new Set(["gm", "player"]);
const PAGE_LAYOUTS = new Set(["list", "gallery"]);
const MAX_ENTRIES = 500;
const MAX_ACTIONS = 8;
const MAX_BADGES = 8;
const MAX_TABS = 24;
const MAX_BREADCRUMBS = 16;
const MAX_NAVIGATION_DEPTH = 8;

/**
 * @typedef {object} MenuExtensionAction
 * @property {string} id Provider-owned action identifier.
 * @property {string} [label] Fallback label.
 * @property {string} [labelKey] Localization key preferred over the fallback label.
 * @property {string} [icon] Font Awesome class list.
 * @property {boolean} [primary]
 * @property {boolean} [danger]
 * @property {boolean} [disabled]
 * @property {boolean} [closesFirst] Whether the presentation surface should close before execution.
 * @property {MenuExtensionNavigation} [navigation] Same-provider target handled by the consumer
 *   instead of provider execution.
 */

/**
 * @typedef {object} MenuExtensionEntry
 * @property {string} id Provider-owned opaque entry identifier.
 * @property {string} [title]
 * @property {string} [titleKey]
 * @property {string} [subtitle]
 * @property {string} [subtitleKey]
 * @property {string|null} [image]
 * @property {string} [icon]
 * @property {string} [meta]
 * @property {string[]} [badges]
 * @property {string} [path]
 * @property {string} [keywords]
 * @property {MenuExtensionAction[]} [actions]
 */

/**
 * @typedef {object} MenuExtensionNavigation
 * @property {string|null} tabId Active provider-owned tab identifier.
 * @property {readonly string[]} path Bounded provider-owned hierarchy segments.
 */

/**
 * @typedef {object} MenuExtensionTab
 * @property {string} id Provider-owned tab identifier.
 * @property {string} [label]
 * @property {string} [labelKey]
 * @property {string} [icon]
 */

/**
 * @typedef {object} MenuExtensionBreadcrumb
 * @property {string} [label]
 * @property {string} [labelKey]
 * @property {MenuExtensionNavigation} navigation Target location within the provider page.
 */

/**
 * A callback-free page projection. Providers may return this shape from `load`, while legacy
 * providers may continue returning an entry array.
 *
 * @typedef {object} MenuExtensionPage
 * @property {string} [title]
 * @property {string} [titleKey]
 * @property {string} [subtitle]
 * @property {string} [subtitleKey]
 * @property {"list"|"gallery"} layout
 * @property {readonly MenuExtensionTab[]} tabs
 * @property {string|null} activeTab
 * @property {MenuExtensionNavigation} navigation
 * @property {readonly MenuExtensionBreadcrumb[]} breadcrumbs
 * @property {readonly MenuExtensionEntry[]} entries
 */

/**
 * @typedef {object} MenuExtensionProvider
 * @property {string} id Namespaced lowercase provider identifier.
 * @property {string} [title]
 * @property {string} [titleKey]
 * @property {string} [subtitle]
 * @property {string} [subtitleKey]
 * @property {string} [icon]
 * @property {string} [source]
 * @property {number} [order]
 * @property {object} [home] Optional home-tile presentation hints.
 * @property {(context: object) => boolean|Promise<boolean>} [canDisplay]
 * @property {(context: object) => MenuExtensionEntry[]|MenuExtensionPage|Promise<MenuExtensionEntry[]|MenuExtensionPage>} load
 * @property {(actionId: string, entryId: string, context: object) => *|Promise<*>} execute
 */

function asText(value, limit) {
  return typeof value === "string"
    ? value.replace(CONTROL_CHARACTERS_PATTERN, " ").trim().slice(0, limit)
    : "";
}

function normalizeIcon(value) {
  const icon = asText(value, 160);
  return ICON_PATTERN.test(icon) ? icon : "";
}

function normalizeOpaqueId(value, name, limit) {
  const id = typeof value === "string" ? value.trim().slice(0, limit + 1) : "";
  if (!id || id.length > limit || CONTROL_CHARACTER_PATTERN.test(id)) {
    throw new TypeError(`${name} must be a non-empty string no longer than ${limit} characters.`);
  }
  return id;
}

function normalizeProviderId(value) {
  const rawId = typeof value === "string" ? value.trim().slice(0, 97) : "";
  if (rawId.length > 96 || !PROVIDER_ID_PATTERN.test(rawId)) {
    throw new TypeError("Menu extension provider ids must be namespaced lowercase identifiers.");
  }
  return rawId;
}

function normalizeOrder(value) {
  if (!Number.isFinite(value)) return 100;
  return Math.max(-10000, Math.min(10000, Math.trunc(value)));
}

function normalizeHome(input) {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("A menu extension provider home descriptor must be an object.");
  }

  const profiles = Array.isArray(input.profiles)
    ? [...new Set(input.profiles.filter(profile => PROFILE_KEYS.has(profile)))]
    : null;
  if (Array.isArray(input.profiles) && !profiles.length) {
    throw new TypeError("A menu extension provider home descriptor must target a supported profile.");
  }

  return Object.freeze({
    label: asText(input.label, 180),
    labelKey: asText(input.labelKey, 180),
    subtitle: asText(input.subtitle, 280),
    subtitleKey: asText(input.subtitleKey, 180),
    icon: normalizeIcon(input.icon),
    image: asText(input.image, 1024) || null,
    defaultSize: HOME_SIZES.has(input.defaultSize) ? input.defaultSize : "1x1",
    profiles: profiles ? Object.freeze(profiles) : null,
  });
}

function normalizeProvider(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("A menu extension provider descriptor is required.");
  }

  const id = normalizeProviderId(input.id);
  const title = asText(input.title, 180);
  const titleKey = asText(input.titleKey, 180);
  if (!title && !titleKey) {
    throw new TypeError(`Menu extension provider "${id}" requires a title or titleKey.`);
  }
  if (input.canDisplay !== undefined && typeof input.canDisplay !== "function") {
    throw new TypeError(`Menu extension provider "${id}" has an invalid canDisplay callback.`);
  }
  if (typeof input.load !== "function") {
    throw new TypeError(`Menu extension provider "${id}" requires a load callback.`);
  }
  if (typeof input.execute !== "function") {
    throw new TypeError(`Menu extension provider "${id}" requires an execute callback.`);
  }

  return Object.freeze({
    id,
    title,
    titleKey,
    subtitle: asText(input.subtitle, 280),
    subtitleKey: asText(input.subtitleKey, 180),
    icon: normalizeIcon(input.icon),
    source: asText(input.source, 96) || id.split(".")[0],
    order: normalizeOrder(input.order),
    home: normalizeHome(input.home),
    canDisplay: input.canDisplay ?? null,
    load: input.load,
    execute: input.execute,
  });
}

function copyHome(home) {
  if (!home) return null;
  return Object.freeze({
    label: home.label,
    labelKey: home.labelKey,
    subtitle: home.subtitle,
    subtitleKey: home.subtitleKey,
    icon: home.icon,
    image: home.image,
    defaultSize: home.defaultSize,
    profiles: home.profiles ? Object.freeze([...home.profiles]) : null,
  });
}

function publicProvider(provider) {
  return Object.freeze({
    id: provider.id,
    title: provider.title,
    titleKey: provider.titleKey,
    subtitle: provider.subtitle,
    subtitleKey: provider.subtitleKey,
    icon: provider.icon,
    source: provider.source,
    order: provider.order,
    home: copyHome(provider.home),
  });
}

function normalizeAction(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  let id;
  try {
    id = normalizeOpaqueId(input.id, "Menu extension action ids", 96);
  } catch {
    return null;
  }

  return Object.freeze({
    id,
    label: asText(input.label, 180),
    labelKey: asText(input.labelKey, 180),
    icon: normalizeIcon(input.icon),
    primary: Boolean(input.primary),
    danger: Boolean(input.danger),
    disabled: Boolean(input.disabled),
    closesFirst: Boolean(input.closesFirst),
    navigation:
      input.navigation && typeof input.navigation === "object" && !Array.isArray(input.navigation)
        ? normalizeNavigation(input.navigation)
        : null,
  });
}

function normalizeEntry(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  let id;
  try {
    id = normalizeOpaqueId(input.id, "Menu extension entry ids", 256);
  } catch {
    return null;
  }

  const seenActionIds = new Set();
  const actions = [];
  for (const candidate of Array.isArray(input.actions) ? input.actions : []) {
    if (actions.length >= MAX_ACTIONS) break;
    const action = normalizeAction(candidate);
    if (!action || seenActionIds.has(action.id)) continue;
    seenActionIds.add(action.id);
    actions.push(action);
  }

  const badges = [];
  for (const candidate of Array.isArray(input.badges) ? input.badges : []) {
    if (badges.length >= MAX_BADGES) break;
    const badge = asText(candidate, 80);
    if (badge) badges.push(badge);
  }

  return Object.freeze({
    id,
    title: asText(input.title, 180),
    titleKey: asText(input.titleKey, 180),
    subtitle: asText(input.subtitle, 280),
    subtitleKey: asText(input.subtitleKey, 180),
    image: asText(input.image, 1024) || null,
    icon: normalizeIcon(input.icon),
    meta: asText(input.meta, 280),
    badges: Object.freeze(badges),
    path: asText(input.path, 500),
    keywords: asText(input.keywords, 1000),
    actions: Object.freeze(actions),
  });
}

function normalizeOptionalOpaqueId(value, name, limit) {
  if (value === undefined || value === null || value === "") return null;
  try {
    return normalizeOpaqueId(value, name, limit);
  } catch {
    return null;
  }
}

function normalizeEntries(value, providerId) {
  if (!Array.isArray(value)) {
    throw new TypeError(`Menu extension provider "${providerId}" returned a non-array entry result.`);
  }

  const entries = [];
  const seenEntryIds = new Set();
  for (const candidate of value) {
    if (entries.length >= MAX_ENTRIES) break;
    const entry = normalizeEntry(candidate);
    if (!entry || seenEntryIds.has(entry.id)) continue;
    seenEntryIds.add(entry.id);
    entries.push(entry);
  }
  return Object.freeze(entries);
}

function normalizeTab(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const id = normalizeOptionalOpaqueId(input.id, "Menu extension tab ids", 96);
  if (!id) return null;

  const label = asText(input.label, 180);
  const labelKey = asText(input.labelKey, 180);
  if (!label && !labelKey) return null;

  return Object.freeze({
    id,
    label,
    labelKey,
    icon: normalizeIcon(input.icon),
  });
}

function normalizeTabs(value) {
  const tabs = [];
  const seenTabIds = new Set();
  for (const candidate of Array.isArray(value) ? value : []) {
    if (tabs.length >= MAX_TABS) break;
    const tab = normalizeTab(candidate);
    if (!tab || seenTabIds.has(tab.id)) continue;
    seenTabIds.add(tab.id);
    tabs.push(tab);
  }
  return Object.freeze(tabs);
}

function normalizeNavigation(input, { validTabIds = null, fallbackTabId = null } = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const hasTabId = Object.prototype.hasOwnProperty.call(source, "tabId");
  const hasExplicitNullTab = hasTabId && source.tabId === null;
  let tabId = hasExplicitNullTab
    ? null
    : normalizeOptionalOpaqueId(source.tabId, "Menu extension tab ids", 96);
  if (tabId && validTabIds?.size && !validTabIds.has(tabId)) tabId = fallbackTabId;
  if (!hasTabId && !tabId) tabId = fallbackTabId;

  const path = [];
  for (const candidate of Array.isArray(source.path) ? source.path : []) {
    if (path.length >= MAX_NAVIGATION_DEPTH) break;
    const segment = normalizeOptionalOpaqueId(candidate, "Menu extension navigation segments", 128);
    if (!segment) break;
    path.push(segment);
  }

  return Object.freeze({
    tabId: tabId ?? (hasExplicitNullTab ? null : fallbackTabId) ?? null,
    path: Object.freeze(path),
  });
}

function normalizeBreadcrumb(input, navigationOptions) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (!input.navigation || typeof input.navigation !== "object" || Array.isArray(input.navigation)) {
    return null;
  }

  const label = asText(input.label, 180);
  const labelKey = asText(input.labelKey, 180);
  if (!label && !labelKey) return null;

  return Object.freeze({
    label,
    labelKey,
    navigation: normalizeNavigation(input.navigation, navigationOptions),
  });
}

function normalizeBreadcrumbs(value, navigationOptions) {
  const breadcrumbs = [];
  for (const candidate of Array.isArray(value) ? value : []) {
    if (breadcrumbs.length >= MAX_BREADCRUMBS) break;
    const breadcrumb = normalizeBreadcrumb(candidate, navigationOptions);
    if (breadcrumb) breadcrumbs.push(breadcrumb);
  }
  return Object.freeze(breadcrumbs);
}

const EMPTY_NAVIGATION = Object.freeze({ tabId: null, path: Object.freeze([]) });
const EMPTY_PAGE = Object.freeze({
  title: "",
  titleKey: "",
  subtitle: "",
  subtitleKey: "",
  layout: "list",
  tabs: Object.freeze([]),
  activeTab: null,
  navigation: EMPTY_NAVIGATION,
  breadcrumbs: Object.freeze([]),
  entries: Object.freeze([]),
});

function normalizePage(value, providerId) {
  if (Array.isArray(value)) {
    return Object.freeze({
      ...EMPTY_PAGE,
      entries: normalizeEntries(value, providerId),
    });
  }
  if (!value || typeof value !== "object") {
    throw new TypeError(`Menu extension provider "${providerId}" returned an invalid page result.`);
  }

  const tabs = normalizeTabs(value.tabs);
  const validTabIds = new Set(tabs.map(tab => tab.id));
  const requestedNavigation = normalizeNavigation(value.navigation);
  const requestedActiveTab = normalizeOptionalOpaqueId(
    value.activeTab,
    "Menu extension active tab ids",
    96,
  );
  let activeTab = requestedActiveTab ?? requestedNavigation.tabId;
  if (validTabIds.size) {
    if (requestedActiveTab && validTabIds.has(requestedActiveTab)) {
      activeTab = requestedActiveTab;
    } else if (requestedNavigation.tabId && validTabIds.has(requestedNavigation.tabId)) {
      activeTab = requestedNavigation.tabId;
    } else {
      activeTab = tabs[0].id;
    }
  }

  const navigationOptions = { validTabIds, fallbackTabId: activeTab };
  const navigation = normalizeNavigation(
    {
      tabId: activeTab,
      path: requestedNavigation.path,
    },
    navigationOptions,
  );

  return Object.freeze({
    title: asText(value.title, 180),
    titleKey: asText(value.titleKey, 180),
    subtitle: asText(value.subtitle, 280),
    subtitleKey: asText(value.subtitleKey, 180),
    layout: PAGE_LAYOUTS.has(value.layout) ? value.layout : "list",
    tabs,
    activeTab: navigation.tabId,
    navigation,
    breadcrumbs: normalizeBreadcrumbs(value.breadcrumbs, navigationOptions),
    entries: normalizeEntries(value.entries, providerId),
  });
}

function contextualError(providerId, operation, cause) {
  return new Error(`Menu extension provider "${providerId}" failed during ${operation}.`, { cause });
}

function emitChanged(type, provider) {
  const snapshot = publicProvider(provider);
  globalThis.Hooks?.callAll?.(
    HOOKS.MENU_EXTENSIONS_CHANGED,
    Object.freeze({ type, providerId: provider.id, provider: snapshot }),
  );
}

const providers = new Map();

function requireProvider(providerId) {
  const id = normalizeProviderId(providerId);
  const provider = providers.get(id);
  if (!provider) throw new Error(`Menu extension provider "${id}" is not registered.`);
  return provider;
}

async function checkAvailability(provider, context) {
  if (!provider.canDisplay) return providers.get(provider.id) === provider;

  let available;
  try {
    available = await provider.canDisplay(context);
  } catch (cause) {
    throw contextualError(provider.id, "availability check", cause);
  }
  return providers.get(provider.id) === provider && Boolean(available);
}

/** Register a provider synchronously, replacing an existing id only when explicitly requested. */
function registerProvider(input, { replace = false } = {}) {
  const provider = normalizeProvider(input);
  if (providers.has(provider.id) && !replace) {
    throw new Error(`Menu extension provider "${provider.id}" is already registered.`);
  }
  providers.set(provider.id, provider);
  emitChanged("registered", provider);
  return publicProvider(provider);
}

/** Remove a provider by id and report whether one was registered. */
function unregisterProvider(providerId) {
  const id = normalizeProviderId(providerId);
  const provider = providers.get(id);
  if (!provider) return false;
  providers.delete(id);
  emitChanged("unregistered", provider);
  return true;
}

/** Return sorted, callback-free, immutable provider snapshots. */
function listProviders() {
  return Object.freeze(
    [...providers.values()]
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map(publicProvider),
  );
}

/** Resolve current provider availability without exposing its callback. */
async function canDisplay(providerId, context = {}) {
  const id = normalizeProviderId(providerId);
  const provider = providers.get(id);
  if (!provider) return false;
  return checkAvailability(provider, context);
}

async function loadProviderPage(providerId, context, operation) {
  const provider = requireProvider(providerId);
  if (!(await checkAvailability(provider, context))) return EMPTY_PAGE;
  if (providers.get(provider.id) !== provider) return EMPTY_PAGE;

  let result;
  try {
    result = await provider.load(context);
  } catch (cause) {
    throw contextualError(provider.id, operation, cause);
  }
  if (providers.get(provider.id) !== provider) return EMPTY_PAGE;
  if (!(await checkAvailability(provider, context))) return EMPTY_PAGE;
  return normalizePage(result, provider.id);
}

/**
 * Load a bounded, deeply immutable, callback-free page from the currently registered provider.
 * Legacy entry-array results are projected as a list page with no tabs or hierarchy.
 *
 * @returns {Promise<MenuExtensionPage>}
 */
async function loadPage(providerId, context = {}) {
  return loadProviderPage(providerId, context, "page loading");
}

/**
 * Load only the entries from a provider page. This compatibility facade preserves the legacy
 * entry-array contract while structured providers expose their current page through `loadPage`.
 *
 * @returns {Promise<readonly MenuExtensionEntry[]>}
 */
async function loadEntries(providerId, context = {}) {
  return (await loadProviderPage(providerId, context, "entry loading")).entries;
}

/** Execute an action through the currently registered and available provider. */
async function execute(providerId, actionId, entryId, context = {}) {
  const provider = requireProvider(providerId);
  const normalizedActionId = normalizeOpaqueId(actionId, "Menu extension action ids", 96);
  const normalizedEntryId = normalizeOpaqueId(entryId, "Menu extension entry ids", 256);
  if (!(await checkAvailability(provider, context))) {
    throw new Error(`Menu extension provider "${provider.id}" is not available.`);
  }
  if (providers.get(provider.id) !== provider) {
    throw new Error(`Menu extension provider "${provider.id}" changed before action execution.`);
  }

  let result;
  try {
    result = await provider.execute(normalizedActionId, normalizedEntryId, context);
  } catch (cause) {
    throw contextualError(provider.id, `action "${normalizedActionId}" execution`, cause);
  }
  if (providers.get(provider.id) !== provider) {
    throw new Error(`Menu extension provider "${provider.id}" changed during action execution.`);
  }
  return result;
}

/** Signal that a provider's dynamic presentation data should be refreshed. */
function touchProvider(providerId) {
  const id = normalizeProviderId(providerId);
  const provider = providers.get(id);
  if (!provider) return false;
  emitChanged("touched", provider);
  return true;
}

/** Shared semantic registry consumed by presentation modules such as Stylish Menu. */
export const menuExtensions = Object.freeze({
  registerProvider,
  unregisterProvider,
  listProviders,
  canDisplay,
  loadPage,
  loadEntries,
  execute,
  touchProvider,
});

/** Publish the init-time registration surface to dependent modules. */
export function callMenuExtensionRegistrationHook() {
  globalThis.Hooks?.callAll?.(
    HOOKS.REGISTER_MENU_EXTENSIONS,
    Object.freeze({
      menuExtensions,
      register: (...args) => menuExtensions.registerProvider(...args),
    }),
  );
}

export { PROVIDER_ID_PATTERN as MENU_EXTENSION_PROVIDER_ID_PATTERN };
