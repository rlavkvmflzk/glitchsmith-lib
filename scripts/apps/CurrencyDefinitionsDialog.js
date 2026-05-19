import { MODULE_ID, CURRENCY_TYPES } from "../constants.js";
import { currency } from "../api/currency.js";
import { buildSheetRowsFromPreset } from "../api/presets.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
    out[id] = {
      name: String(r.name ?? "").trim() || id,
      rate: Number.isFinite(Number(r.rate)) && Number(r.rate) > 0 ? Number(r.rate) : 1,
      symbol: String(r.symbol ?? "").trim() || id,
      type: CURRENCY_TYPES.SHEET,
      actorPath: String(r.actorPath ?? "").trim(),
      primary: !!r.primary,
      icon: String(r.icon ?? "").trim(),
      integer: r.integer !== false,
      precision: Number.isInteger(Number(r.precision)) ? Number(r.precision) : (r.integer === false ? 2 : 0),
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
      width: 820,
      height: "auto",
    },
    actions: {
      addSheet:    CurrencyDefinitionsDialog.#onAddSheet,
      removeSheet: CurrencyDefinitionsDialog.#onRemoveSheet,
      addVirtual:    CurrencyDefinitionsDialog.#onAddVirtual,
      removeVirtual: CurrencyDefinitionsDialog.#onRemoveVirtual,
      resetSheet: CurrencyDefinitionsDialog.#onResetSheet,
      pickIcon:   CurrencyDefinitionsDialog.#onPickIcon,
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
      this.#sheetRows = sheetRows.length > 0 ? sheetRows : presetRows;
      this.#virtualRows = virtualRows;
    }

    return {
      sheetRows: this.#sheetRows,
      virtualRows: this.#virtualRows,
      systemId: game.system.id,
      systemName: game.system.title ?? game.system.id,
      hasPreset: !!buildSheetRowsFromPreset().length,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#bindRowInputs();
  }

  #bindRowInputs() {
    const html = this.element;
    if (!html) return;

    html.querySelectorAll(".gs-cur-row[data-section='sheet']").forEach(row => {
      const idx = parseInt(row.dataset.index, 10);
      if (!Number.isInteger(idx) || !this.#sheetRows[idx]) return;

      this.#bindInput(row, "id",        v => { this.#sheetRows[idx].id = v; });
      this.#bindInput(row, "name",      v => { this.#sheetRows[idx].name = v; });
      this.#bindInput(row, "symbol",    v => { this.#sheetRows[idx].symbol = v; });
      this.#bindInput(row, "actorPath", v => { this.#sheetRows[idx].actorPath = v; });
      this.#bindNumberInput(row, "rate", v => { this.#sheetRows[idx].rate = v; });
      this.#bindCheckboxInput(row, "integer", v => { this.#sheetRows[idx].integer = v; });
      this.#bindCheckboxInput(row, "sheet-primary", v => {
        if (v) this.#sheetRows.forEach((r, i) => { r.primary = (i === idx); });
        else this.#sheetRows[idx].primary = false;
      });
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
    this.#sheetRows = presetRows;
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
