import { MODULE_ID, CURRENCY_TYPES } from "../constants.js";
import { currency } from "../api/currency.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function _getVirtualCurrencyDefs() {
  const defs = currency.getDefinitions();
  const out = [];
  for (const [id, c] of Object.entries(defs.currencies ?? {})) {
    if (c.type !== CURRENCY_TYPES.VIRTUAL) continue;
    out.push({
      id,
      name: c.name ?? id,
      symbol: c.symbol ?? id,
      rate: Number.isFinite(Number(c.rate)) && Number(c.rate) > 0 ? Number(c.rate) : 1,
      icon: c.icon ?? "",
      primary: !!c.primary
    });
  }
  out.sort((a, b) => b.rate - a.rate);
  return out;
}

export class WalletDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  #actor = null;
  #pendingBalances = null;

  static DEFAULT_OPTIONS = {
    id: "gs-wallet-dialog",
    classes: ["gs-wallet-dialog"],
    tag: "div",
    window: {
      title: "GLITCHSMITH-LIB.wallet.dialog.title",
      icon: "fas fa-wallet",
      resizable: true
    },
    position: {
      width: 480,
      height: "auto"
    },
    actions: {
      save: WalletDialog.#onSave,
      cancel: WalletDialog.#onCancel
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/wallet-dialog.hbs`
    }
  };

  constructor(actor, options = {}) {
    super(options);
    this.#actor = actor;
  }

  get title() {
    const base = game.i18n.localize("GLITCHSMITH-LIB.wallet.dialog.title");
    return this.#actor ? `${base} — ${this.#actor.name}` : base;
  }

  async _prepareContext(options) {
    const defs = _getVirtualCurrencyDefs();

    if (!this.#pendingBalances) {
      this.#pendingBalances = {};
      for (const def of defs) {
        const bal = this.#actor ? currency.getBalance(this.#actor.id, def.id) : 0;
        this.#pendingBalances[def.id] = typeof bal === "number" ? bal : 0;
      }
    }

    return {
      actorName: this.#actor?.name ?? "",
      actorImg: this.#actor?.img ?? "icons/svg/mystery-man.svg",
      hasCurrencies: defs.length > 0,
      currencies: defs.map(def => ({
        ...def,
        currentBalance: this.#pendingBalances[def.id] ?? 0
      }))
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    if (!root) return;
    root.querySelectorAll('input[name^="balance-"]').forEach(input => {
      input.addEventListener("input", () => {
        const id = input.name.slice("balance-".length);
        const value = Number(input.value);
        this.#pendingBalances[id] = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
      });
    });
  }

  static async #onSave(event, target) {
    if (!this.#actor) {
      ui.notifications?.warn(game.i18n.localize("GLITCHSMITH-LIB.wallet.dialog.noActor"));
      return;
    }

    const errors = [];
    let changed = 0;
    for (const [currencyId, nextValue] of Object.entries(this.#pendingBalances ?? {})) {
      const current = currency.getBalance(this.#actor.id, currencyId);
      if (current === nextValue) continue;
      const result = await currency.setBalance(this.#actor.id, currencyId, nextValue, {
        source: MODULE_ID,
        reason: "wallet-dialog"
      });
      if (result?.success) {
        changed++;
      } else {
        errors.push(`${currencyId}: ${result?.error ?? "unknown error"}`);
      }
    }

    if (errors.length > 0) {
      ui.notifications?.error(
        game.i18n.format("GLITCHSMITH-LIB.wallet.dialog.saveErrors", { errors: errors.join("; ") })
      );
      return;
    }

    if (changed > 0) {
      ui.notifications?.info(
        game.i18n.format("GLITCHSMITH-LIB.wallet.dialog.saved", { count: changed })
      );
    }

    this.#pendingBalances = null;
    await this.close();
  }

  static async #onCancel(event, target) {
    this.#pendingBalances = null;
    await this.close();
  }
}
