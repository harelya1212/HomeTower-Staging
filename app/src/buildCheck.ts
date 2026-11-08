// Build freshness self-check (web only) - round-11 fix.
//
// A home-screen web app caches its main bundle. When a deploy lands,
// the cached app can end up running an OLD main bundle against NEW
// lazily-loaded chunks (module ids are per-build), which crashes
// actions with errors like: Requiring unknown module "813".
// On startup this fetches the served index.html without cache,
// compares the main bundle it names with the bundle actually running,
// and reloads ONCE per new build name (sessionStorage guard - no
// reload loops). From the first build that carries this check, a
// stale pairing heals itself; the user never manages the cache.
import { Platform } from "react-native";

export function checkBuildFreshness(): void {
  if (Platform.OS !== "web") return;
  try {
    const script = document.querySelector('script[src*="index-"]');
    const running = script?.getAttribute("src")?.match(/index-[a-f0-9]+\.js/)?.[0] ?? "";
    if (!running) return;
    fetch(`${window.location.pathname}?htcheck=${Date.now()}`, { cache: "no-store" })
      .then((r) => r.text())
      .then((html) => {
        const served = html.match(/index-[a-f0-9]+\.js/)?.[0] ?? "";
        if (!served || served === running) return;
        const KEY = "hometower.buildReload";
        if (sessionStorage.getItem(KEY) === served) return;
        sessionStorage.setItem(KEY, served);
        window.location.reload();
      })
      .catch(() => {});
  } catch {
    // A freshness check must never break startup.
  }
}
