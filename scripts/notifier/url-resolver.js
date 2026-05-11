import { UPDATE_JSON_BASE_URL, LEGACY_JSON_FILENAMES } from "./constants.js";

export function resolveUpdateUrl(moduleId) {
  const filename = LEGACY_JSON_FILENAMES[moduleId] ?? `${moduleId}-update.json`;
  return `${UPDATE_JSON_BASE_URL}/${filename}`;
}
