import { MODULE_ID, CURRENCY_TYPES } from "../constants.js";
import { currency } from "../api/currency.js";
import { buildSheetRowsFromPreset } from "../api/presets.js";
import { matchEmbeddedItemForActor } from "../api/sheet-currency.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const STORAGE_TYPES = Object.freeze({
  ACTOR_PATH: "actorPath",
  EMBEDDED_ITEM: "embeddedItem",
});

const QUANTITY_PATH_CANDIDATES = Object.freeze([
  "system.quantity",
  "system.quantity.value",
  "system.qty",
  "system.qty.value",
  "system.count",
  "system.amount",
  "system.amount.value",
]);

function localize(key) {
  return game.i18n.localize(`GLITCHSMITH-LIB.currency.dialog.${key}`);
}

function findScanActor() {
  const controlled = canvas?.tokens?.controlled ?? [];
  for (const token of controlled) {
    if (token?.actor) return token.actor;
  }
  return game.user?.character ?? null;
}

function readNumericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function detectQuantityPath(item) {
  for (const path of QUANTITY_PATH_CANDIDATES) {
    const numeric = readNumericValue(foundry.utils.getProperty(item, path));
    if (numeric !== null) return { path, value: numeric };
  }
  return null;
}

function extractStableFilters(item) {
  const filters = [];
  const physicalItemType = foundry.utils.getProperty(item, "system.physicalItemType");
  if (typeof physicalItemType === "string" && physicalItemType.trim()) {
    filters.push({ path: "system.physicalItemType", equals: physicalItemType.trim() });
  }
  const rqid = foundry.utils.getProperty(item, "flags.rqg.documentRqidFlags.id");
  if (typeof rqid === "string" && rqid.trim()) {
    filters.push({ path: "flags.rqg.documentRqidFlags.id", equals: rqid.trim() });
  }
  const compendiumSource = foundry.utils.getProperty(item, "_stats.compendiumSource");
  if (typeof compendiumSource === "string" && compendiumSource.trim()) {
    filters.push({ path: "_stats.compendiumSource", equals: compendiumSource.trim() });
  }
  const coreSourceId = foundry.utils.getProperty(item, "flags.core.sourceId");
  if (typeof coreSourceId === "string" && coreSourceId.trim()) {
    filters.push({ path: "flags.core.sourceId", equals: coreSourceId.trim() });
  }
  return filters;
}

function isStableSourceUuid(uuid) {
  if (typeof uuid !== "string" || !uuid) return false;
  if (uuid.startsWith("Compendium.")) return true;
  // Single-segment world item only; embedded/token uuids (Actor.x.Item.y) are unstable.
  return /^Item\.[^.]+$/.test(uuid);
}

function extractSourceUuid(item) {
  const compendiumSource = foundry.utils.getProperty(item, "_stats.compendiumSource");
  if (typeof compendiumSource === "string" && isStableSourceUuid(compendiumSource.trim())) {
    return compendiumSource.trim();
  }
  const coreSourceId = foundry.utils.getProperty(item, "flags.core.sourceId");
  if (typeof coreSourceId === "string" && isStableSourceUuid(coreSourceId.trim())) {
    return coreSourceId.trim();
  }
  if (typeof item?.uuid === "string" && isStableSourceUuid(item.uuid)) return item.uuid;
  return "";
}

function buildScanCandidate(item) {
  const quantity = detectQuantityPath(item);
  if (!quantity) return null;

  let filters = extractStableFilters(item);
  const nameFallback = filters.length === 0;
  if (nameFallback && item?.name) {
    filters = [{ path: "name", equals: item.name }];
  }

  const filtersText = filters.map(filter => `${filter.path}=${filter.equals}`).join("; ");
  const summary = [`${localize("scan.summaryQty")} ${quantity.value}`, ...filters.map(filter => `${filter.path}=${filter.equals}`)]
    .join(" \u00b7 ");

  return {
    name: item?.name ?? item?.id ?? "",
    type: typeof item?.type === "string" ? item.type : "",
    img: typeof item?.img === "string" ? item.img : "",
    quantityPath: quantity.path,
    quantity: quantity.value,
    filtersText,
    nameFallback,
    sourceUuid: extractSourceUuid(item),
    summary,
  };
}

function buildScanCandidates(actor) {
  const candidates = [];
  for (const item of Array.from(actor?.items ?? [])) {
    const candidate = buildScanCandidate(item);
    if (candidate) candidates.push(candidate);
  }
  candidates.sort((a, b) => {
    if (a.nameFallback !== b.nameFallback) return a.nameFallback ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return candidates;
}

function candidateMatchesSearch(candidate, query) {
  if (!query) return true;
  if (!candidate) return false;
  const haystack = [candidate.name, candidate.type, candidate.filtersText, candidate.summary, candidate.sourceUuid]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function buildScanView(row) {
  if (!Array.isArray(row?.scanCandidates) || row.scanCandidates.length === 0) return null;
  const search = String(row.scanSearch ?? "");
  const query = search.trim().toLowerCase();
  const items = row.scanCandidates.map((candidate, index) => ({ ...candidate, index }));
  const shown = items.reduce((count, candidate) => count + (candidateMatchesSearch(candidate, query) ? 1 : 0), 0);
  return {
    actorName: row.scanActorName ?? "",
    search,
    total: items.length,
    shown,
    isEmpty: shown === 0,
    countLabel: game.i18n.format("GLITCHSMITH-LIB.currency.dialog.scan.count", { shown, total: items.length }),
    items,
  };
}

function deriveStorageFromItem(item) {
  const quantity = detectQuantityPath(item);
  let filters = extractStableFilters(item);
  if (filters.length === 0 && item?.name) {
    filters = [{ path: "name", equals: item.name }];
  }
  return {
    itemType: typeof item?.type === "string" ? item.type : "",
    quantityPath: quantity?.path || "system.quantity",
    filtersText: filters.map(filter => `${filter.path}=${filter.equals}`).join("; "),
    createFromUuid: extractSourceUuid(item),
  };
}

function rowIndexFromTarget(target) {
  const entry = target?.closest(".gs-cur-entry");
  const idx = parseInt(entry?.dataset.index, 10);
  return Number.isInteger(idx) ? idx : -1;
}

function stringifyFilters(filters) {
  if (!Array.isArray(filters)) return "";
  return filters
    .filter(filter => filter?.path)
    .map(filter => `${filter.path}=${filter.equals ?? ""}`)
    .join("; ");
}

function parseFilters(raw) {
  return String(raw ?? "")
    .split(/[;\n]/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const index = part.indexOf("=");
      if (index === -1) return { path: part, equals: "" };
      return {
        path: part.slice(0, index).trim(),
        equals: part.slice(index + 1).trim(),
      };
    })
    .filter(filter => filter.path);
}

function readStorageFields(c) {
  const storage = c?.storage?.type === STORAGE_TYPES.EMBEDDED_ITEM ? c.storage : null;
  return {
    storageType: storage ? STORAGE_TYPES.EMBEDDED_ITEM : STORAGE_TYPES.ACTOR_PATH,
    isEmbeddedItem: !!storage,
    storageItemType: storage?.itemType ?? "",
    storageQuantityPath: storage?.quantityPath ?? "system.quantity",
    storageFilters: stringifyFilters(storage?.filters),
    storageCreateFromUuid: storage?.createFromUuid ?? "",
  };
}

function withStorageDefaults(row) {
  const merged = { ...readStorageFields(null), ...row };
  merged.isEmbeddedItem = merged.storageType === STORAGE_TYPES.EMBEDDED_ITEM;
  return merged;
}

function buildEmbeddedStorage(row) {
  if (row.storageType !== STORAGE_TYPES.EMBEDDED_ITEM) return null;

  const itemType = String(row.storageItemType ?? "").trim();
  const quantityPath = String(row.storageQuantityPath ?? "").trim();
  const createFromUuid = String(row.storageCreateFromUuid ?? "").trim();
  const filters = parseFilters(row.storageFilters);

  return {
    type: STORAGE_TYPES.EMBEDDED_ITEM,
    ...(itemType ? { itemType } : {}),
    filters,
    quantityPath,
    ...(createFromUuid ? { createFromUuid } : {}),
  };
}

function readDefinitionRows() {
  const defs = currency.getDefinitions();
  const sheetRows = [];
  const virtualRows = [];
  for (const [id, c] of Object.entries(defs.currencies ?? {})) {
    const rate = Number(c.rate);
    const row = {
      id,
      name: c.name ?? id,
      symbol: c.symbol ?? id,
      rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
      actorPath: c.actorPath ?? "",
      primary: !!c.primary,
      icon: c.icon ?? "",
      integer: c.integer !== false,
      precision: Number.isInteger(Number(c.precision)) ? Number(c.precision) : (c.integer === false ? 2 : 0),
      ...(Number.isFinite(Number(c.increment)) && Number(c.increment) > 0 ? { increment: Number(c.increment) } : {}),
      ...readStorageFields(c),
    };
    if (c.type === CURRENCY_TYPES.SHEET) sheetRows.push(row);
    else virtualRows.push(row);
  }
  sheetRows.sort((a, b) => b.rate - a.rate);
  virtualRows.sort((a, b) => b.rate - a.rate);
  return { sheetRows, virtualRows, base: defs.base ?? "" };
}

function rowsToCurrencies(sheetRows, virtualRows) {
  const out = {};
  for (const r of sheetRows) {
    const id = String(r.id ?? "").trim();
    if (!id) continue;
    const storage = buildEmbeddedStorage(r);
    out[id] = {
      name: String(r.name ?? "").trim() || id,
      rate: Number.isFinite(Number(r.rate)) && Number(r.rate) > 0 ? Number(r.rate) : 1,
      symbol: String(r.symbol ?? "").trim() || id,
      type: CURRENCY_TYPES.SHEET,
      actorPath: storage ? "" : String(r.actorPath ?? "").trim(),
      primary: !!r.primary,
      icon: String(r.icon ?? "").trim(),
      integer: r.integer !== false,
      precision: Number.isInteger(Number(r.precision)) ? Number(r.precision) : (r.integer === false ? 2 : 0),
      ...(Number.isFinite(Number(r.increment)) && Number(r.increment) > 0 ? { increment: Number(r.increment) } : {}),
      ...(storage ? { storage } : {}),
    };
  }
  for (const r of virtualRows) {
    const id = String(r.id ?? "").trim();
    if (!id) continue;
    out[id] = {
      name: String(r.name ?? "").trim() || id,
      rate: Number.isFinite(Number(r.rate)) && Number(r.rate) > 0 ? Number(r.rate) : 1,
      symbol: String(r.symbol ?? "").trim() || id,
      type: CURRENCY_TYPES.VIRTUAL,
      actorPath: "",
      primary: !!r.primary,
      icon: String(r.icon ?? "").trim(),
      integer: r.integer !== false,
      precision: Number.isInteger(Number(r.precision)) ? Number(r.precision) : (r.integer === false ? 2 : 0),
      ...(Number.isFinite(Number(r.increment)) && Number(r.increment) > 0 ? { increment: Number(r.increment) } : {}),
    };
  }
  return out;
}

function chooseBase(currencies) {
  const ids = Object.keys(currencies);
  if (ids.length === 0) return "";
  const primary = ids.find(id => currencies[id].primary);
  if (primary) return primary;
  return ids.reduce((min, id) => currencies[id].rate < currencies[min].rate ? id : min, ids[0]);
}

export class CurrencyDefinitionsDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  #sheetRows = null;
  #virtualRows = null;

  static DEFAULT_OPTIONS = {
    id: "gs-currency-definitions",
    classes: ["gs-currency-definitions"],
    tag: "div",
    window: {
      title: "GLITCHSMITH-LIB.currency.dialog.title",
      icon: "fas fa-coins",
      resizable: true,
    },
    position: {
      width: 980,
      height: "auto",
    },
    actions: {
      addSheet:    CurrencyDefinitionsDialog.#onAddSheet,
      removeSheet: CurrencyDefinitionsDialog.#onRemoveSheet,
      addVirtual:    CurrencyDefinitionsDialog.#onAddVirtual,
      removeVirtual: CurrencyDefinitionsDialog.#onRemoveVirtual,
      resetSheet: CurrencyDefinitionsDialog.#onResetSheet,
      pickIcon:   CurrencyDefinitionsDialog.#onPickIcon,
      scanEmbedded:   CurrencyDefinitionsDialog.#onScanEmbedded,
      applyCandidate: CurrencyDefinitionsDialog.#onApplyCandidate,
      clearScan:      CurrencyDefinitionsDialog.#onClearScan,
      testEmbedded:   CurrencyDefinitionsDialog.#onTestEmbedded,
      save:       CurrencyDefinitionsDialog.#onSave,
      cancel:     CurrencyDefinitionsDialog.#onCancel,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/currency-definitions.hbs`,
    },
  };

  get title() {
    return game.i18n.localize("GLITCHSMITH-LIB.currency.dialog.title");
  }

  async _prepareContext(options) {
    if (this.#sheetRows === null || this.#virtualRows === null) {
      const { sheetRows, virtualRows } = readDefinitionRows();
      const presetRows = buildSheetRowsFromPreset();
      const rows = sheetRows.length > 0 ? sheetRows : presetRows;
      this.#sheetRows = rows.map(withStorageDefaults);
      this.#virtualRows = virtualRows;
    }

    return {
      sheetRows: this.#sheetRows.map(row => ({ ...row, scanView: buildScanView(row) })),
      virtualRows: this.#virtualRows,
      systemId: game.system.id,
      systemName: game.system.title ?? game.system.id,
      hasPreset: !!buildSheetRowsFromPreset().length,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#bindRowInputs();
    this.#bindStorageDropzones();
  }

  #bindRowInputs() {
    const html = this.element;
    if (!html) return;

    html.querySelectorAll(".gs-cur-entry[data-section='sheet']").forEach(row => {
      const idx = parseInt(row.dataset.index, 10);
      if (!Number.isInteger(idx) || !this.#sheetRows[idx]) return;

      this.#bindInput(row, "id",        v => { this.#sheetRows[idx].id = v; });
      this.#bindInput(row, "name",      v => { this.#sheetRows[idx].name = v; });
      this.#bindInput(row, "symbol",    v => { this.#sheetRows[idx].symbol = v; });
      this.#bindInput(row, "actorPath", v => { this.#sheetRows[idx].actorPath = v; });
      this.#bindSelectInput(row, "storageType", v => {
        this.#sheetRows[idx].storageType = v;
        this.#sheetRows[idx].isEmbeddedItem = v === STORAGE_TYPES.EMBEDDED_ITEM;
        if (this.#sheetRows[idx].isEmbeddedItem && !this.#sheetRows[idx].storageQuantityPath) {
          this.#sheetRows[idx].storageQuantityPath = "system.quantity";
        }
        this.render({ force: false });
      });
      this.#bindInput(row, "storageItemType", v => { this.#sheetRows[idx].storageItemType = v; });
      this.#bindInput(row, "storageQuantityPath", v => { this.#sheetRows[idx].storageQuantityPath = v; });
      this.#bindInput(row, "storageFilters", v => { this.#sheetRows[idx].storageFilters = v; });
      this.#bindInput(row, "storageCreateFromUuid", v => { this.#sheetRows[idx].storageCreateFromUuid = v; });
      this.#bindNumberInput(row, "rate", v => { this.#sheetRows[idx].rate = v; });
      this.#bindCheckboxInput(row, "integer", v => { this.#sheetRows[idx].integer = v; });
      this.#bindCheckboxInput(row, "sheet-primary", v => {
        if (v) this.#sheetRows.forEach((r, i) => { r.primary = (i === idx); });
        else this.#sheetRows[idx].primary = false;
      });
      this.#bindScanSearch(row, idx);
    });

    html.querySelectorAll(".gs-cur-row[data-section='virtual']").forEach(row => {
      const idx = parseInt(row.dataset.index, 10);
      if (!Number.isInteger(idx) || !this.#virtualRows[idx]) return;

      this.#bindInput(row, "id",     v => { this.#virtualRows[idx].id = v; });
      this.#bindInput(row, "name",   v => { this.#virtualRows[idx].name = v; });
      this.#bindInput(row, "symbol", v => { this.#virtualRows[idx].symbol = v; });
      this.#bindNumberInput(row, "rate", v => { this.#virtualRows[idx].rate = v; });
      this.#bindCheckboxInput(row, "integer", v => { this.#virtualRows[idx].integer = v; });
      this.#bindCheckboxInput(row, "virtual-primary", v => {
        if (v) this.#virtualRows.forEach((r, i) => { r.primary = (i === idx); });
        else this.#virtualRows[idx].primary = false;
      });
    });
  }

  #bindInput(row, name, setter) {
    const input = row.querySelector(`[name="${name}"]`);
    if (!input) return;
    input.addEventListener("input", () => setter(input.value));
  }

  #bindNumberInput(row, name, setter) {
    const input = row.querySelector(`[name="${name}"]`);
    if (!input) return;
    input.addEventListener("input", () => {
      const n = Number(input.value);
      setter(Number.isFinite(n) && n > 0 ? n : 1);
    });
  }

  #bindSelectInput(row, name, setter) {
    const input = row.querySelector(`[name="${name}"]`);
    if (!input) return;
    input.addEventListener("change", () => setter(input.value));
  }

  #bindScanSearch(entry, idx) {
    const model = this.#sheetRows[idx];
    const input = entry.querySelector(".gs-cur-scan-search");
    if (!input || !model) return;
    input.addEventListener("input", () => {
      model.scanSearch = input.value;
      this.#applyScanFilter(entry, model);
    });
    this.#applyScanFilter(entry, model);
  }

  #applyScanFilter(entry, model) {
    const results = entry.querySelector(".gs-cur-scan-results");
    if (!results) return;
    const candidates = Array.isArray(model.scanCandidates) ? model.scanCandidates : [];
    const query = String(model.scanSearch ?? "").trim().toLowerCase();
    let shown = 0;
    results.querySelectorAll(".gs-cur-scan-item").forEach(item => {
      const cidx = parseInt(item.dataset.candidate, 10);
      const candidate = Number.isInteger(cidx) ? candidates[cidx] : null;
      const match = candidateMatchesSearch(candidate, query);
      item.toggleAttribute("hidden", !match);
      if (match) shown += 1;
    });
    const empty = results.querySelector(".gs-cur-scan-empty");
    if (empty) empty.toggleAttribute("hidden", shown !== 0);
    const count = results.querySelector(".gs-cur-scan-count");
    if (count) {
      count.textContent = game.i18n.format(
        "GLITCHSMITH-LIB.currency.dialog.scan.count",
        { shown, total: candidates.length }
      );
    }
  }

  #bindStorageDropzones() {
    const html = this.element;
    if (!html) return;

    html.querySelectorAll(".gs-cur-storage-dropzone[data-index]").forEach(zone => {
      const idx = parseInt(zone.dataset.index, 10);
      if (!Number.isInteger(idx)) return;

      zone.addEventListener("dragover", (event) => {
        event.preventDefault();
        zone.classList.add("is-dragover");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("is-dragover"));
      zone.addEventListener("drop", (event) => {
        event.preventDefault();
        zone.classList.remove("is-dragover");
        this.#onStorageDrop(idx, event);
      });
    });
  }

  async #onStorageDrop(idx, event) {
    const row = this.#sheetRows[idx];
    if (!row) return;

    let data;
    try {
      data = JSON.parse(event.dataTransfer?.getData("text/plain") ?? "");
    } catch {
      data = null;
    }
    if (!data?.uuid || (data.type && data.type !== "Item")) {
      ui.notifications?.warn(localize("scan.dropInvalid"));
      return;
    }

    const item = await fromUuid(data.uuid);
    if (!item || item.documentName !== "Item") {
      ui.notifications?.warn(localize("scan.dropInvalid"));
      return;
    }

    const derived = deriveStorageFromItem(item);
    row.storageItemType = derived.itemType;
    row.storageQuantityPath = derived.quantityPath;
    row.storageFilters = derived.filtersText;
    row.storageCreateFromUuid = derived.createFromUuid;
    row.scanCandidates = null;
    row.scanActorName = "";
    row.scanSearch = "";
    this.render({ force: false });
  }

  #bindCheckboxInput(row, name, setter) {
    const input = row.querySelector(`[name="${name}"]`);
    if (!input) return;
    input.addEventListener("change", () => {
      setter(input.checked);
      this.render({ force: false });
    });
  }

  static #onAddSheet(event, target) {
    this.#sheetRows.push({
      id: "", name: "", symbol: "", rate: 1, actorPath: "",
      primary: this.#sheetRows.length === 0, icon: "", integer: true, precision: 0,
      ...readStorageFields(null),
    });
    this.render({ force: false });
  }

  static #onRemoveSheet(event, target) {
    const row = target.closest(".gs-cur-row");
    const idx = parseInt(row?.dataset.index, 10);
    if (!Number.isInteger(idx)) return;
    this.#sheetRows.splice(idx, 1);
    if (!this.#sheetRows.some(r => r.primary) && this.#sheetRows.length > 0) {
      this.#sheetRows[0].primary = true;
    }
    this.render({ force: false });
  }

  static #onAddVirtual(event, target) {
    this.#virtualRows.push({
      id: "", name: "", symbol: "", rate: 1,
      primary: this.#virtualRows.length === 0, icon: "", integer: true, precision: 0,
    });
    this.render({ force: false });
  }

  static #onRemoveVirtual(event, target) {
    const row = target.closest(".gs-cur-row");
    const idx = parseInt(row?.dataset.index, 10);
    if (!Number.isInteger(idx)) return;
    this.#virtualRows.splice(idx, 1);
    if (!this.#virtualRows.some(r => r.primary) && this.#virtualRows.length > 0) {
      this.#virtualRows[0].primary = true;
    }
    this.render({ force: false });
  }

  static async #onResetSheet(event, target) {
    const presetRows = buildSheetRowsFromPreset();
    if (presetRows.length === 0) {
      ui.notifications?.warn(game.i18n.localize("GLITCHSMITH-LIB.currency.dialog.noPreset"));
      return;
    }
    const DialogV2 = foundry.applications?.api?.DialogV2;
    const proceed = DialogV2
      ? await DialogV2.confirm({
          window: { title: game.i18n.localize("GLITCHSMITH-LIB.currency.dialog.resetSheet") },
          content: `<p>${game.i18n.localize("GLITCHSMITH-LIB.currency.dialog.resetSheetConfirm")}</p>`,
          modal: true,
        })
      : confirm(game.i18n.localize("GLITCHSMITH-LIB.currency.dialog.resetSheetConfirm"));
    if (!proceed) return;
    this.#sheetRows = presetRows.map(withStorageDefaults);
    this.render({ force: false });
  }

  static async #onPickIcon(event, target) {
    const row = target.closest(".gs-cur-row");
    if (!row) return;
    const section = row.dataset.section;
    const idx = parseInt(row.dataset.index, 10);
    const list = section === "sheet" ? this.#sheetRows : this.#virtualRows;
    if (!Number.isInteger(idx) || !list[idx]) return;

    const fp = new FilePicker({
      type: "image",
      current: list[idx].icon || "",
      callback: (path) => {
        list[idx].icon = path;
        this.render({ force: false });
      },
    });
    fp.render(true);
  }

  static #onScanEmbedded(event, target) {
    const idx = rowIndexFromTarget(target);
    const row = this.#sheetRows[idx];
    if (!row) return;

    const actor = findScanActor();
    if (!actor) {
      ui.notifications?.warn(localize("scan.noActor"));
      return;
    }

    const candidates = buildScanCandidates(actor);
    row.scanActorName = actor.name;
    row.scanCandidates = candidates;
    row.scanSearch = "";
    if (candidates.length === 0) {
      ui.notifications?.warn(
        game.i18n.format("GLITCHSMITH-LIB.currency.dialog.scan.empty", { actor: actor.name })
      );
    }
    this.render({ force: false });
  }

  static #onApplyCandidate(event, target) {
    const idx = rowIndexFromTarget(target);
    const row = this.#sheetRows[idx];
    if (!row) return;

    const action = target.closest("[data-candidate]");
    const cidx = parseInt(action?.dataset.candidate, 10);
    const candidate = Number.isInteger(cidx) ? row.scanCandidates?.[cidx] : null;
    if (!candidate) return;

    row.storageItemType = candidate.type ?? "";
    row.storageQuantityPath = candidate.quantityPath || "system.quantity";
    row.storageFilters = candidate.filtersText ?? "";
    row.storageCreateFromUuid = candidate.sourceUuid ?? "";
    row.scanCandidates = null;
    row.scanActorName = "";
    row.scanSearch = "";
    this.render({ force: false });
  }

  static #onClearScan(event, target) {
    const idx = rowIndexFromTarget(target);
    const row = this.#sheetRows[idx];
    if (!row) return;
    row.scanCandidates = null;
    row.scanActorName = "";
    row.scanSearch = "";
    this.render({ force: false });
  }

  static #onTestEmbedded(event, target) {
    const idx = rowIndexFromTarget(target);
    const row = this.#sheetRows[idx];
    if (!row) return;

    const actor = findScanActor();
    if (!actor) {
      ui.notifications?.warn(localize("scan.noActor"));
      return;
    }

    const storage = buildEmbeddedStorage(row);
    if (!storage?.quantityPath || (!storage.itemType && storage.filters.length === 0)) {
      ui.notifications?.warn(localize("scan.testInvalid"));
      return;
    }

    const result = matchEmbeddedItemForActor(actor, storage);
    if (!result.item) {
      ui.notifications?.warn(
        game.i18n.format("GLITCHSMITH-LIB.currency.dialog.scan.testFail", { actor: actor.name })
      );
      return;
    }

    ui.notifications?.info(
      game.i18n.format("GLITCHSMITH-LIB.currency.dialog.scan.testSuccess", {
        actor: actor.name,
        item: result.item.name,
        quantity: result.quantity,
      })
    );
  }

  static async #onSave(event, target) {
    const sheetIds = new Set();
    for (const r of this.#sheetRows) {
      const id = String(r.id ?? "").trim();
      if (!id) continue;
      if (sheetIds.has(id)) {
        ui.notifications?.error(
          game.i18n.format("GLITCHSMITH-LIB.currency.dialog.errors.duplicateId", { id })
        );
        return;
      }
      sheetIds.add(id);
    }
    const virtualIds = new Set();
    for (const r of this.#virtualRows) {
      const id = String(r.id ?? "").trim();
      if (!id) continue;
      if (virtualIds.has(id) || sheetIds.has(id)) {
        ui.notifications?.error(
          game.i18n.format("GLITCHSMITH-LIB.currency.dialog.errors.duplicateId", { id })
        );
        return;
      }
      virtualIds.add(id);
    }

    const currencies = rowsToCurrencies(this.#sheetRows, this.#virtualRows);
    const base = chooseBase(currencies);
    const merged = { base, currencies };

    const result = await currency.setDefinitions(merged, {
      source: MODULE_ID,
      reason: "currency-definitions-dialog",
    });
    if (!result?.success) {
      ui.notifications?.error(
        result?.error ?? game.i18n.localize("GLITCHSMITH-LIB.currency.dialog.errors.saveFailed")
      );
      return;
    }

    ui.notifications?.info(game.i18n.localize("GLITCHSMITH-LIB.currency.dialog.saved"));
    this.#sheetRows = null;
    this.#virtualRows = null;
    await this.close();
  }

  static async #onCancel(event, target) {
    this.#sheetRows = null;
    this.#virtualRows = null;
    await this.close();
  }
}
