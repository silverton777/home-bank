// Home Bank's offline keeper. It saves the app's own files on the phone when you first install,
// then serves them from the phone. Your money data is never here (it lives encrypted in the app's storage).
//
// Offline lock: when it's on, this worker never uses the network for anything, and it refuses to
// let a newer version of itself take over. Updates happen only when you turn the lock off yourself.
const VERSION = "2.0.0";
const FILES = [
"./",
"css/app.css",
"fonts/Inter-Medium.woff",
"fonts/Inter-Regular.woff",
"fonts/Inter-SemiBold.woff",
"fonts/InterDisplay-Light.woff",
"fonts/InterDisplay-SemiBold.woff",
"fonts/OFL.txt",
"icons/apple-touch-icon.png",
"icons/icon-192.png",
"icons/icon-512.png",
"index.html",
"js/app.js",
"js/boot.js",
"js/forms.js",
"js/icons.js",
"js/local/ask.js",
"js/local/calc.js",
"js/local/demo.js",
"js/local/engine.js",
"js/local/files.js",
"js/local/importers.js",
"js/local/seed.js",
"js/local/store.js",
"js/local/vault.js",
"js/pages/accounts.js",
"js/pages/ask.js",
"js/pages/bills.js",
"js/pages/budget.js",
"js/pages/categories.js",
"js/pages/dashboard.js",
"js/pages/debt.js",
"js/pages/deleted.js",
"js/pages/forecast.js",
"js/pages/goals.js",
"js/pages/history.js",
"js/pages/home.js",
"js/pages/import.js",
"js/pages/learn.js",
"js/pages/networth.js",
"js/pages/register.js",
"js/pages/reports.js",
"js/pages/rules.js",
"js/pages/safety.js",
"js/pages/settings.js",
"js/pages/theme.js",
"js/theme.js",
"js/ui.js",
"js/words.js",
"manifest.webmanifest"
];
const CACHE = "homebank-" + VERSION;
const FLAGS = "homebank-flags";

async function locked() {
  const c = await caches.open(FLAGS);
  const r = await c.match("offline-lock");
  return r ? (await r.text()) === "on" : false;
}

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    // A different version can only take over while the Offline lock is off.
    const others = (await caches.keys()).filter((k) => k.startsWith("homebank-") && k !== FLAGS && k !== CACHE);
    if (others.length && (await locked())) throw new Error("Offline lock is on: not updating.");
    const cache = await caches.open(CACHE);
    await cache.addAll(FILES.map((f) => new Request(f, { cache: "no-store" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("homebank-") && k !== CACHE && k !== FLAGS) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope);
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (url.origin === scope.origin) {
      let rel = url.pathname.startsWith(scope.pathname) ? url.pathname.slice(scope.pathname.length) : url.pathname;
      if (rel === "" || e.request.mode === "navigate") rel = "index.html";
      const hit = await cache.match(rel, { ignoreSearch: true });
      if (hit) return hit;
    }
    if (await locked()) return new Response("Home Bank's Offline lock is on.", { status: 503, headers: { "Content-Type": "text/plain" } });
    // Lock off and the file isn't kept yet (only happens while installing): use the network.
    return fetch(e.request);
  })());
});

self.addEventListener("message", (e) => {
  if (e.data === "version") e.source?.postMessage({ version: VERSION });
});
