// Starts Home Bank on the phone. Everything runs here; nothing is sent anywhere.
import { backend } from "./local/store.js";
import { setOfflineLockFlag } from "./local/files.js";

(async () => {
  if (!window.crypto?.subtle || !window.indexedDB) {
    document.getElementById("app").innerHTML = `<div class="lockscreen"><div class="card lockcard"><h1>Home Bank</h1>
      <p>This browser can't keep Home Bank's data locked. Open Home Bank in Safari on your iPhone (or Chrome on Android), from its secure https address.</p></div></div>`;
    return;
  }
  await backend.init();
  await setOfflineLockFlag(!!backend.meta.offline_lock).catch(() => {});
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Offline keeper not started:", e));
  await import("./app.js");
})();
