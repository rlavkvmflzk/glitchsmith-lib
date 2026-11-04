import { MODULE_ID } from "../constants.js";

let shownThisSession = false;

/** Include inactive packages: Foundry disables incompatible dependents before loading their scripts. */
export function collectLibraryVersionIssues(gameRef = globalThis.game) {
  const installedVersion = gameRef.modules.get(MODULE_ID)?.version;
  if (!installedVersion) return null;
  const isNewerVersion = foundry.utils.isNewerVersion;
  const modules = [];
  let requiredVersion = installedVersion;
  for (const mod of gameRef.modules.values()) {
    if (mod.id === MODULE_ID) continue;
    let minimum = null;
    for (const dependency of mod.relationships?.requires ?? []) {
      if (dependency.id !== MODULE_ID || (dependency.type && dependency.type !== "module")) continue;
      const candidate = dependency.compatibility?.minimum;
      if (candidate && isNewerVersion(candidate, installedVersion)
        && (!minimum || isNewerVersion(candidate, minimum))) minimum = candidate;
    }
    if (!minimum) continue;
    modules.push({ id: mod.id, title: mod.title || mod.id, minimum });
    if (isNewerVersion(minimum, requiredVersion)) requiredVersion = minimum;
  }
  if (!modules.length) return null;
  modules.sort((left, right) => left.title.localeCompare(right.title));
  return { installedVersion, requiredVersion, modules };
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

/** Local compatibility notice, independent of release announcements, their mute settings, and network access. */
export async function showLibraryVersionNotice() {
  if (shownThisSession || !game.user?.isGM) return false;
  const issues = collectLibraryVersionIssues();
  if (!issues) return false;
  shownThisSession = true;

  const localize = key => game.i18n.localize(`GLITCHSMITH-LIB.libraryVersion.${key}`);
  const format = (key, data) => game.i18n.format(`GLITCHSMITH-LIB.libraryVersion.${key}`, data);
  const intro = format("intro", { required: issues.requiredVersion });
  const current = format("current", { current: issues.installedVersion });
  const instructions = localize("instructions");
  const rows = issues.modules.map(mod => `<tr><td>${escapeHTML(mod.title)}</td><td>${escapeHTML(mod.minimum)}</td></tr>`).join("");
  const content = `<p>${escapeHTML(intro)}</p>
    <p><strong>${escapeHTML(current)}</strong></p>
    <div style="max-height:35vh;overflow:auto">
      <table><thead><tr><th scope="col">${escapeHTML(localize("module"))}</th><th scope="col">${escapeHTML(localize("minimum"))}</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
    <p>${escapeHTML(instructions)}</p>`;

  try {
    await foundry.applications.api.DialogV2.wait({
      id: "glitchsmith-library-version-notice",
      window: { title: localize("title"), icon: "fas fa-circle-exclamation" },
      position: { width: 560 },
      modal: true,
      content,
      rejectClose: false,
      buttons: [{ action: "acknowledge", label: localize("acknowledge"), icon: "fas fa-check", default: true }],
    });
  } catch (error) {
    console.error(`${MODULE_ID} | Could not display library version requirements.`, error);
    ui.notifications?.warn(`${intro} ${current} ${instructions}`, { permanent: true });
  }
  return true;
}
