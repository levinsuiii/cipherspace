export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/service-worker.js", {
      scope: "/",
      updateViaCache: "none"
    }).catch(() => {
      // Installation is optional; the normal HTTPS application remains usable if it fails.
    });
  }, { once: true });
}
