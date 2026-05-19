import { enumerateNotifierTargets } from "./discovery.js";
import { registerNotifierSettings } from "./settings.js";
import { showBoard, showBoardWith } from "./board.js";
import { collectBoardData } from "./board-data.js";

let cachedTargets = null;

function getTargets() {
  if (cachedTargets === null) {
    cachedTargets = enumerateNotifierTargets();
  }
  return cachedTargets;
}

export function registerNotifierSettingsForTargets() {
  for (const mod of getTargets()) {
    registerNotifierSettings(mod.id);
  }
}

export async function runAutoDiscovery() {
  if (!game.user?.isGM) return;
  const { updates, announcements } = await collectBoardData();
  if (updates.length === 0 && announcements.length === 0) return;
  await showBoardWith({ updates, announcements });
}

export async function openNotifierBoard() {
  return showBoard({ silentIfEmpty: false });
}

export { showUpdateDialog, showAnnouncementDialog } from "./dialog.js";
