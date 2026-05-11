import { FETCH_TIMEOUT_MS, NOTIFIER_LOG_PREFIX } from "./constants.js";

export async function fetchUpdateData(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}?t=${Date.now()}`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    if (err?.name === "AbortError") {
      console.warn(`${NOTIFIER_LOG_PREFIX} fetch timed out: ${url}`);
    } else {
      console.warn(`${NOTIFIER_LOG_PREFIX} fetch failed: ${url}`, err?.message ?? err);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
