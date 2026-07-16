import { MODULE_ID } from "../constants.js";
import { collectBoardData } from "./board-data.js";
import { NOTIFIER_LOG_PREFIX, NOTIFIER_SETTING_KEYS } from "./constants.js";
import { setSetting } from "./settings.js";

const { DISABLE, SKIPPED_VERSION, LAST_SEEN_NOTICE_ID } = NOTIFIER_SETTING_KEYS;

let openingPromise = null;

function getApi() {
  return foundry.applications?.api ?? null;
}

function getApplicationBase() {
  const api = getApi();
  if (!api) return null;
  return api.HandlebarsApplicationMixin(api.ApplicationV2);
}

function localize(key) {
  return game.i18n.localize(key);
}

function buildEqHelper() {
  if (Handlebars.helpers?.eq) return;
  Handlebars.registerHelper("eq", (a, b) => a === b);
}

function buildGtHelper() {
  if (Handlebars.helpers?.gt) return;
  Handlebars.registerHelper("gt", (a, b) => Number(a) > Number(b));
}

let definedClass = null;

function defineBoardClass() {
  if (definedClass) return definedClass;
  const Base = getApplicationBase();
  if (!Base) return null;
  buildEqHelper();
  buildGtHelper();

  class NotifierBoard extends Base {
    static DEFAULT_OPTIONS = {
      id: "glitchsmith-notifier-board",
      tag: "section",
      classes: ["glitchsmith-notifier-board"],
      window: {
        title: "GLITCHSMITH-LIB.notifier.board.title",
        icon: "fas fa-bell",
        resizable: true,
      },
      position: {
        width: 560,
        height: "auto",
      },
      actions: {
        setPrimary: NotifierBoard.#onSetPrimary,
        setUpdateModule: NotifierBoard.#onSetUpdateModule,
        setAnnouncementModule: NotifierBoard.#onSetAnnouncementModule,
        skipUpdate: NotifierBoard.#onSkipUpdate,
        acknowledgeUpdate: NotifierBoard.#onAcknowledgeUpdate,
        acknowledgeAnnouncement: NotifierBoard.#onAcknowledgeAnnouncement,
        acknowledgeAll: NotifierBoard.#onAcknowledgeAll,
        disableModule: NotifierBoard.#onDisableModule,
        disableAll: NotifierBoard.#onDisableAll,
        manageDisabled: NotifierBoard.#onManageDisabled,
      },
    };

    static PARTS = {
      main: {
        template: `modules/${MODULE_ID}/templates/notifier-board.hbs`,
      },
    };

    #updates = [];
    #announcements = [];
    #activePrimary = "updates";
    #activeUpdateModuleId = null;
    #activeAnnouncementModuleId = null;
    #loaded = false;

    setData(updates, announcements, { preferredPrimary } = {}) {
      this.#updates = Array.isArray(updates) ? updates : [];
      this.#announcements = Array.isArray(announcements) ? announcements : [];
      const hasUpdates = this.#updates.length > 0;
      const hasAnnouncements = this.#announcements.length > 0;
      if (preferredPrimary === "announcements" && hasAnnouncements) {
        this.#activePrimary = "announcements";
      } else if (hasUpdates) {
        this.#activePrimary = "updates";
      } else if (hasAnnouncements) {
        this.#activePrimary = "announcements";
      }
      this.#activeUpdateModuleId = this.#updates[0]?.moduleId ?? null;
      this.#activeAnnouncementModuleId = this.#announcements[0]?.moduleId ?? null;
      this.#loaded = true;
    }

    async _prepareContext() {
      if (!this.#loaded) {
        const { updates, announcements } = await collectBoardData();
        this.setData(updates, announcements);
      }

      const hasUpdates = this.#updates.length > 0;
      const hasAnnouncements = this.#announcements.length > 0;
      const activeUpdate = this.#updates.find(
        (u) => u.moduleId === this.#activeUpdateModuleId
      ) ?? this.#updates[0] ?? null;
      const activeAnnouncement = this.#announcements.find(
        (a) => a.moduleId === this.#activeAnnouncementModuleId
      ) ?? this.#announcements[0] ?? null;

      return {
        hasUpdates,
        hasAnnouncements,
        isEmpty: !hasUpdates && !hasAnnouncements,
        updates: this.#updates,
        announcements: this.#announcements,
        activePrimary: this.#activePrimary,
        activeUpdateModuleId: activeUpdate?.moduleId ?? null,
        activeAnnouncementModuleId: activeAnnouncement?.moduleId ?? null,
        activeUpdate,
        activeAnnouncement,
      };
    }

    static async #onSetPrimary(event, target) {
      const tab = target?.dataset?.tab;
      if (tab !== "updates" && tab !== "announcements") return;
      this.#activePrimary = tab;
      this.render();
    }

    static async #onSetUpdateModule(event, target) {
      const moduleId = target?.dataset?.moduleId;
      if (!moduleId) return;
      this.#activeUpdateModuleId = moduleId;
      this.render();
    }

    static async #onSetAnnouncementModule(event, target) {
      const moduleId = target?.dataset?.moduleId;
      if (!moduleId) return;
      this.#activeAnnouncementModuleId = moduleId;
      this.render();
    }

    static async #onSkipUpdate(event, target) {
      const moduleId = target?.dataset?.moduleId;
      const version = target?.dataset?.version;
      if (!moduleId || !version) return;
      await setSetting(moduleId, SKIPPED_VERSION, version);
      this.#removeUpdateCard(moduleId);
      this.render();
    }

    static async #onAcknowledgeUpdate(event, target) {
      const moduleId = target?.dataset?.moduleId;
      if (!moduleId) return;
      this.#removeUpdateCard(moduleId);
      this.render();
    }

    static async #onAcknowledgeAnnouncement(event, target) {
      const moduleId = target?.dataset?.moduleId;
      const noticeId = target?.dataset?.noticeId;
      if (!moduleId || !noticeId) return;
      await setSetting(moduleId, LAST_SEEN_NOTICE_ID, noticeId);
      this.#removeAnnouncementCard(moduleId);
      this.render();
    }

    static async #onAcknowledgeAll() {
      const announcements = this.#announcements.filter(
        (announcement) => announcement.moduleId && announcement.noticeId
      );
      await Promise.all(
        announcements.map((announcement) =>
          setSetting(announcement.moduleId, LAST_SEEN_NOTICE_ID, announcement.noticeId)
        )
      );
      this.#clearCards();
      ui.notifications?.info(localize("GLITCHSMITH-LIB.notifier.allConfirm"));
      this.render();
    }

    static async #onDisableModule(event, target) {
      const moduleId = target?.dataset?.moduleId;
      if (!moduleId) return;
      await setSetting(moduleId, DISABLE, true);
      ui.notifications?.info(localize("GLITCHSMITH-LIB.notifier.disableConfirm"));
      this.#removeUpdateCard(moduleId);
      this.#removeAnnouncementCard(moduleId);
      this.render();
    }

    static async #onDisableAll() {
      const moduleIds = new Set(
        [...this.#updates, ...this.#announcements]
          .map((card) => card.moduleId)
          .filter(Boolean)
      );
      if (moduleIds.size === 0) return;
      await Promise.all(
        Array.from(moduleIds, (moduleId) => setSetting(moduleId, DISABLE, true))
      );
      this.#clearCards();
      ui.notifications?.info(localize("GLITCHSMITH-LIB.notifier.allDisableConfirm"));
      this.render();
    }

    static async #onManageDisabled() {
      const { reopenManagerDialog } = await import("./manager.js");
      await reopenManagerDialog();
      this.render();
    }

    #clearCards() {
      this.#updates = [];
      this.#announcements = [];
      this.#activeUpdateModuleId = null;
      this.#activeAnnouncementModuleId = null;
    }

    #removeUpdateCard(moduleId) {
      this.#updates = this.#updates.filter((u) => u.moduleId !== moduleId);
      if (this.#activeUpdateModuleId === moduleId) {
        this.#activeUpdateModuleId = this.#updates[0]?.moduleId ?? null;
      }
      if (this.#updates.length === 0 && this.#announcements.length > 0) {
        this.#activePrimary = "announcements";
      }
    }

    #removeAnnouncementCard(moduleId) {
      this.#announcements = this.#announcements.filter(
        (a) => a.moduleId !== moduleId
      );
      if (this.#activeAnnouncementModuleId === moduleId) {
        this.#activeAnnouncementModuleId = this.#announcements[0]?.moduleId ?? null;
      }
      if (this.#announcements.length === 0 && this.#updates.length > 0) {
        this.#activePrimary = "updates";
      }
    }
  }

  definedClass = NotifierBoard;
  return NotifierBoard;
}

export function getNotifierBoardClass() {
  return defineBoardClass();
}

export async function showBoardWith({ updates, announcements }) {
  const NotifierBoard = defineBoardClass();
  if (!NotifierBoard) {
    console.warn(`${NOTIFIER_LOG_PREFIX} ApplicationV2 not available; board cannot render.`);
    return null;
  }

  if (openingPromise) await openingPromise;

  const board = new NotifierBoard();
  board.setData(updates, announcements);
  openingPromise = board.render({ force: true });
  await openingPromise;
  openingPromise = null;
  return board;
}

export async function showBoard({ silentIfEmpty = false } = {}) {
  const NotifierBoard = defineBoardClass();
  if (!NotifierBoard) return null;
  const { updates, announcements } = await collectBoardData();
  if (silentIfEmpty && updates.length === 0 && announcements.length === 0) {
    return null;
  }
  return showBoardWith({ updates, announcements });
}
