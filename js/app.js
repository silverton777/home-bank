// Home Bank for phones: start-up, first-time setup, sign-in, the shell (top bar + bottom tabs)
// and page switching. Everything runs on the phone; nothing is sent anywhere.
import { icon, logo } from "./icons.js";
import { $, $$, esc, GET, POST, PUT, DEL, toast, attempt, initHelp, initTapHelp, setHelpMode, helpModeOn, busyTyping, avatar, modalOpen } from "./ui.js";
import { w, wt, setWords, startEditWords } from "./words.js";
import * as theme from "./theme.js";
import { quickAdd } from "./forms.js";
import { pickFile, readText } from "./local/files.js";

export const NAV = [
  { head: null, items: [
    ["dashboard", "home", "Home", "Where things stand today."],
    ["budget", "budget", "Budget", "Give every dollar a job, month by month."],
    ["accounts", "wallet", "Accounts", "Checking, savings, cards, loans and the things you own."],
    ["register", "list", "Transactions", "Every dollar in and out, all accounts or one at a time."],
    ["bills", "repeat", "Recurring", "Paychecks, bills and transfers that repeat. Set them up, pause or change them."],
    ["goals", "target", "Savings goals", "Categories you're saving up for, and how close you are."],
    ["debt", "debt", "Debt payoff", "Snowball or avalanche: see the payoff date and interest saved."],
    ["networth", "scale", "Net worth", "What you own minus what you owe, over time."],
  ]},
  { head: "Plan", items: [
    ["forecast", "forecast", "Cash-flow forecast", "Where each balance is headed over the next 90 days."],
    ["reports", "chart", "Reports", "Spending by category, payee and month. Taxes too."],
    ["ask", "chat", "Ask my money", "Type a question in plain English."],
    ["learn", "info", "How budgeting works", "Zero-based and flex budgeting, explained."],
  ]},
  { head: "Organize", items: [
    ["import", "import", "Import bank files", "Bring in CSV, OFX, QFX or QIF files you downloaded from your bank."],
    ["rules", "wand", "Rules", "Clean up payee names and pick categories automatically."],
    ["categories", "tag", "Categories", "Groups, categories and tags. Rename, hide, reorder."],
  ]},
  { head: "Keep safe", items: [
    ["safety", "archive", "Backup & partner", "Save a backup, share changes with your partner's phone, and the Offline lock."],
    ["history", "history", "Edit history", "Every money change: who, when, before and after."],
    ["deleted", "trash", "Deleted", "Anything deleted waits here until you put it back."],
  ]},
  { head: "Settings", items: [
    ["settings", "settings", "Settings", "People, passcodes, demo mode and more."],
    ["theme", "palette", "Theme", "Colors, glass or minimal, light or dark."],
  ]},
];
const PAGES = Object.fromEntries(NAV.flatMap((g) => g.items).map(([k, i, t, s]) => [k, { icon: i, title: t, sub: s }]));
PAGES.more = { icon: "menu", title: "More", sub: "Everything else in Home Bank." };
const TABS = [["dashboard", "home", "Home"], ["budget", "budget", "Budget"], ["add", "plus", "Add"], ["register", "list", "Activity"], ["more", "menu", "More"]];

export const state = { info: null, theme: null, page: null, params: {}, renderToken: 0 };

// ---------------------------------------------------------------- boot
async function boot() {
  const info = await GET("/api/state").catch((e) => ({ error: e.message }));
  if (info.error) { document.getElementById("app").innerHTML = `<div class="lockscreen"><div class="card lockcard"><h1>Home Bank</h1><p>${esc(info.error)}</p></div></div>`; return; }
  state.info = info;
  setWords(info.words);
  state.theme = theme.apply(info.theme || readSavedTheme(), { glide: false });
  document.title = info.app_name;
  initHelp(() => (state.hoverSeconds || 1.5) * 1000);
  initTapHelp();
  window.addEventListener("hb:locked", () => showLock());
  if (info.needs_setup) return showSetup();
  if (!info.person) return showLock();
  startShell();
}
function readSavedTheme() { try { return JSON.parse(localStorage.getItem("hb-theme") || "null"); } catch { return null; } }

// ---------------------------------------------------------------- first time on this phone
function showSetup() {
  document.getElementById("app").innerHTML = "";
  const el = document.createElement("div");
  el.className = "lockscreen";
  el.innerHTML = `<div class="card lockcard rise" style="text-align:left;width:min(520px,100%)">
    <div class="center logo">${logo(true)}</div>
    <h1 class="center">Welcome to Home Bank</h1>
    <p class="muted center">Your money stays on this phone, locked with your passcode. Nothing is ever sent anywhere.</p>
    <div class="choice" style="margin-top:18px">
      <button class="btn primary big" data-new data-help="Set up Home Bank from scratch on this phone.">${icon("plus")} Start a new Home Bank</button>
      <button class="btn big" data-join data-help="Your partner already set up Home Bank? Use the file they sent you (or a backup) to start this phone with the same budget.">${icon("import")} Use my partner's file or a backup</button>
    </div>
  </div>`;
  document.body.append(el);
  el.querySelector("[data-new]").onclick = () => setupNew(el);
  el.querySelector("[data-join]").onclick = () => setupJoin(el);
}

function setupNew(el) {
  el.innerHTML = `<form class="card lockcard rise" style="text-align:left;width:min(520px,100%)" autocomplete="off">
    <h1>Set up the two of you</h1>
    <p class="muted">Each person gets their own passcode (at least 4 characters). Home Bank asks for it every time it opens. Longer passcodes keep your backup files safer.</p>
    <div class="form" style="margin-top:16px">
      <label class="field"><span>Your name</span><input name="n1" autocomplete="off" required data-help="Your first name. It shows in the greeting and in Edit History."></label>
      <label class="field"><span>Your passcode</span><input name="p1" type="password" autocomplete="new-password" required data-help="At least 4 characters."></label>
      <label class="field"><span>Partner's name</span><input name="n2" autocomplete="off" data-help="Leave empty to add them later in Settings."></label>
      <label class="field"><span>Partner's passcode</span><input name="p2" type="password" autocomplete="new-password" data-help="Must be different from yours. Your partner can change it later."></label>
    </div>
    <p class="bad small" data-err></p>
    <button class="btn primary" style="width:100%;margin-top:8px">Set up Home Bank</button>
    <button type="button" class="btn ghost" style="width:100%;margin-top:8px" data-back>Back</button>
  </form>`;
  el.querySelector("[data-back]").onclick = () => { el.remove(); showSetup(); };
  el.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const people = [{ name: f.n1.value, passcode: f.p1.value }];
    if (f.n2.value.trim()) people.push({ name: f.n2.value, passcode: f.p2.value });
    try {
      await POST("/api/setup", { people });
      el.remove();
      state.info = await GET("/api/state");
      startShell();
      setTimeout(() => toast("You're set up. Next: add your checking account, then turn on the Offline lock under More > Backup & partner."), 600);
    } catch (err) { f.querySelector("[data-err]").textContent = err.message; }
  });
}

function setupJoin(el) {
  let text = null;
  el.innerHTML = `<form class="card lockcard rise" style="text-align:left;width:min(520px,100%)" autocomplete="off">
    <h1>Use a Home Bank file</h1>
    <p class="muted">Pick the <b>.homebank</b> file your partner sent you (or a backup). Then type <b>your</b> passcode, the same one you use on the other phone.</p>
    <button type="button" class="btn" style="width:100%;margin-top:12px" data-pick>${icon("import")} Pick the file</button>
    <p class="small muted" data-fname style="min-height:1.3em;margin:8px 0"></p>
    <input class="passcode" name="pass" type="password" placeholder="Your passcode" autocomplete="current-password">
    <p class="bad small" data-err style="min-height:1.3em"></p>
    <button class="btn primary" style="width:100%">Open it</button>
    <button type="button" class="btn ghost" style="width:100%;margin-top:8px" data-back>Back</button>
  </form>`;
  const f = el.querySelector("form"), errEl = el.querySelector("[data-err]");
  el.querySelector("[data-back]").onclick = () => { el.remove(); showSetup(); };
  el.querySelector("[data-pick]").onclick = async () => {
    const file = await pickFile();
    if (!file) return;
    text = await readText(file);
    el.querySelector("[data-fname]").textContent = file.name;
    f.pass.focus();
  };
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!text) { errEl.textContent = "Pick the file first."; return; }
    errEl.textContent = "Opening…";
    try {
      const r = await POST("/api/join", { text, passcode: f.pass.value });
      el.remove();
      state.info = await GET("/api/state");
      startShell();
      toast(`Welcome, ${r.name}. This phone now has the same Home Bank.`);
    } catch (err) { errEl.textContent = err.message; f.pass.value = ""; }
  });
}

// ---------------------------------------------------------------- lock screen
let lockTimer = null;
async function showLock() {
  if (document.querySelector(".lockscreen")) return;
  state.info = await GET("/api/state").catch(() => state.info);
  document.getElementById("app").innerHTML = "";
  document.querySelectorAll(".overlay, .tabbar").forEach((o) => o.remove());
  setHelpMode(false);
  const info = state.info;
  const el = document.createElement("div");
  el.className = "lockscreen";
  let chosen = Number(localStorage.getItem("hb-last-person")) || info.people[0]?.id;
  if (!info.people.some((p) => p.id === chosen)) chosen = info.people[0]?.id;
  const demo = info.demo_mode;
  el.innerHTML = `<form class="card lockcard rise" autocomplete="off">
    <div class="logo">${logo()}</div>
    <h1>${demo ? "Demo mode is on" : esc(info.app_name)}</h1>
    <p class="muted">${demo ? "Everything showing right now is made up. To go back to your real Home Bank, pick who you are and type your passcode." : "Who's here?"}</p>
    <div class="people">${info.people.map((p) => `<button type="button" class="person ${p.id === chosen ? "on" : ""}" data-p="${p.id}" data-help="Sign in as ${esc(p.name)}.">${avatar(p)}<span>${esc(p.name)}</span></button>`).join("")}</div>
    <input class="passcode" name="pass" type="password" placeholder="Passcode" autocomplete="current-password" data-help="Type your passcode and tap Unlock.">
    <p class="small" data-msg style="min-height:1.4em;margin:10px 0 0"></p>
    <button class="btn primary" style="width:100%;margin-top:10px">${demo ? "Back to my real Home Bank" : "Unlock"}</button>
    ${demo ? `<button type="button" class="btn ghost" style="width:100%;margin-top:8px" data-resume data-help="Keep showing the made-up demo. No passcode needed.">Keep showing the demo</button>` : ""}
  </form>`;
  document.body.append(el);
  const form = el.querySelector("form");
  const msg = el.querySelector("[data-msg]");
  el.querySelector("[data-resume]")?.addEventListener("click", async () => {
    el.remove();
    state.info = await GET("/api/state");
    startShell();
  });
  el.querySelectorAll(".person").forEach((b) => b.addEventListener("click", () => {
    chosen = Number(b.dataset.p);
    el.querySelectorAll(".person").forEach((x) => x.classList.toggle("on", x === b));
    form.pass.focus();
  }));
  const countdown = (secs) => {
    clearInterval(lockTimer);
    form.pass.disabled = true;
    let left = secs;
    const tick = () => {
      msg.className = "small bad";
      msg.textContent = `Too many wrong tries. Try again in ${left} second${left === 1 ? "" : "s"}.`;
      if (left-- <= 0) { clearInterval(lockTimer); form.pass.disabled = false; msg.textContent = ""; }
    };
    tick(); lockTimer = setInterval(tick, 1000);
  };
  if (info.lock?.remaining) countdown(info.lock.remaining);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.className = "small muted"; msg.textContent = "Unlocking…";
    try {
      if (demo) await POST("/api/demo/exit", { person_id: chosen, passcode: form.pass.value });
      else await POST("/api/login", { person_id: chosen, passcode: form.pass.value });
      localStorage.setItem("hb-last-person", chosen);
      el.remove();
      state.info = await GET("/api/state");
      startShell();
    } catch (err) {
      form.pass.value = "";
      form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake");
      const m = /Wait (\d+) seconds/.exec(err.message);
      if (m) countdown(Number(m[1]));
      else { msg.className = "small bad"; msg.textContent = err.message; }
    }
  });
}

// ---------------------------------------------------------------- shell
function startShell() {
  document.querySelectorAll(".lockscreen").forEach((l) => l.remove());
  const app = document.getElementById("app");
  state.theme = theme.apply(state.info.theme || state.theme);
  try { localStorage.setItem("hb-theme", JSON.stringify(state.theme)); } catch { /* ignore */ }
  app.innerHTML = `<div class="main">
      <header class="topbar">
        <div class="titles"><h1 data-title></h1></div>
        ${state.info.demo_mode ? `<button class="btn sm demo-pill" data-leavedemo data-help="Everything showing is made up. Tap to go back to your real Home Bank (needs a passcode).">Demo</button>` : ""}
        <button class="btn icon ghost" data-helpmode data-help="Help mode: tap this, then tap anything to see what it does." aria-label="Help">?</button>
        <button class="btn icon ghost" data-editwords data-help="Edit words: tap this, then tap any text to rename it or change its help." aria-label="Edit words"><span style="font-weight:600;font-size:.95em;letter-spacing:-.02em">Aa</span></button>
        <button class="btn icon ghost" data-lock data-help="Lock Home Bank. You'll need a passcode to get back in." aria-label="Lock">${icon("lock")}</button>
      </header>
      <main class="content" id="content"></main>
    </div>`;
  document.querySelector(".tabbar")?.remove();
  const bar = document.createElement("nav");
  bar.className = "tabbar";
  bar.innerHTML = TABS.map(([k, ic, t]) => k === "add"
    ? `<button class="tab add" data-add aria-label="Add" data-help="Add a purchase, bill or paycheck. Quick: amount, who, category.">${icon("plus")}</button>`
    : `<a class="tab" href="#/${k}" data-tab="${k}" data-help="${esc(PAGES[k].sub)}">${icon(ic)}<span>${w("tab." + k, t)}</span></a>`).join("");
  document.body.append(bar);
  bar.querySelector("[data-add]").onclick = () => quickAdd({ account_id: state.params.account ? Number(state.params.account) : null });
  app.querySelector("[data-lock]").onclick = lockNow;
  app.querySelector("[data-leavedemo]")?.addEventListener("click", lockNow);
  app.querySelector("[data-helpmode]").onclick = () => setHelpMode(!helpModeOn());
  app.querySelector("[data-editwords]").onclick = editWords;
  document.documentElement.classList.toggle("demo-mode", !!state.info.demo_mode);
  window.removeEventListener("hashchange", onAddressChange);
  window.addEventListener("hashchange", onAddressChange);
  window.removeEventListener("popstate", onAddressChange);
  window.addEventListener("popstate", onAddressChange);
  route();
  idleLock();
  GET("/api/settings").then((s) => { state.hoverSeconds = s.hover_seconds; state.settings = s; }).catch(() => {});
}

// ---------------------------------------------------------------- page switching
let currentHash = location.hash || "";
export function navigate(hash) {
  hash = hash.startsWith("#") ? hash : "#" + hash;
  currentHash = hash;
  try { if (location.hash !== hash) history.pushState(null, "", hash); } catch { /* fine */ }
  route();
}
window.navigate = navigate;
function onAddressChange() {
  if ((location.hash || "") === currentHash) return;
  currentHash = location.hash || "";
  route();
}
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const a = e.target.closest && e.target.closest('a[href^="#"]');
  if (!a) return;
  e.preventDefault();
  navigate(a.getAttribute("href"));
});

const loaders = {};
async function loadPage(name) {
  if (!loaders[name]) loaders[name] = import(`./pages/${name === "more" ? "home" : name}.js`);
  return (await loaders[name]).default;
}
function parseHash() {
  const h = currentHash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  const params = Object.fromEntries(new URLSearchParams(qs || ""));
  let page = path || "dashboard";
  if (page === "home") page = "dashboard";
  if (!PAGES[page]) page = "dashboard";
  return { page, params };
}
export async function route() {
  const { page, params } = parseHash();
  state.page = page; state.params = params;
  if (!document.getElementById("content")) return;
  const inMore = !["dashboard", "budget", "register"].includes(page);
  $$(".tabbar [data-tab]").forEach((a) => a.classList.toggle("on", a.dataset.tab === page || (a.dataset.tab === "more" && inMore)));
  setTitle(page);
  await render(true);
  window.scrollTo(0, 0);
}
function setTitle(page) {
  const h = $("[data-title]");
  if (h) h.innerHTML = page === "dashboard" ? esc(state.info.app_name) : w(`page.${page}.title`, PAGES[page].title);
  document.title = `${wt(`page.${page}.title`, PAGES[page].title)} – ${state.info.app_name}`;
}
export async function render(fresh = false) {
  const content = document.getElementById("content");
  if (!content) return;
  const token = ++state.renderToken;
  const mod = await loadPage(state.page);
  const el = document.createElement("div");
  el.className = "page";
  const ctx = {
    el, params: state.params, info: state.info, theme: state.theme, fresh,
    go: (hash) => navigate(hash), refresh: () => render(false), isPhone: true,
    setTheme: (t, opts) => { state.theme = theme.apply(t, opts); try { localStorage.setItem("hb-theme", JSON.stringify(state.theme)); } catch { /* ignore */ } return state.theme; },
    nav: NAV, pages: PAGES,
  };
  try {
    await mod.render(ctx);
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="card"><h2>This page couldn't load</h2><p class="muted">${esc(e.message)}</p><button class="btn" data-reload>Reload</button></div>`;
    el.querySelector("[data-reload]").onclick = () => location.reload();
  }
  if (token !== state.renderToken) return;
  content.replaceChildren(el);
  if (!fresh) el.querySelectorAll(".rise").forEach((r) => r.classList.remove("rise"));
}

let pendingRefresh = false;
window.addEventListener("hb:changed", () => { pendingRefresh = true; setTimeout(maybeRefresh, 60); });
function maybeRefresh() {
  if (!pendingRefresh) return;
  if (busyTyping()) { setTimeout(maybeRefresh, 1200); return; }
  pendingRefresh = false;
  render(false);
}
export function refreshSoon() { pendingRefresh = true; maybeRefresh(); }

// ---------------------------------------------------------------- undo / redo / lock
export async function undo() { const r = await attempt(() => POST("/api/undo")); if (r) toast(r.message); }
export async function redo() { const r = await attempt(() => POST("/api/redo")); if (r) toast(r.message); }
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || modalOpen()) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
  const k = e.key.toLowerCase();
  if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
});
export async function lockNow() {
  await POST("/api/logout").catch(() => {});
  document.querySelector(".tabbar")?.remove();
  showLock();
}
let hiddenAt = 0;
function idleLock() {
  let last = Date.now();
  ["pointerdown", "keydown", "touchstart", "scroll"].forEach((ev) => document.addEventListener(ev, () => (last = Date.now()), { passive: true, capture: true }));
  clearInterval(state.idleTimer);
  state.idleTimer = setInterval(() => {
    if (Date.now() - last > 10 * 60 * 1000 && !document.querySelector(".lockscreen") && !busyTyping()) lockNow();
  }, 30000);
}
// Leaving the app for more than 5 minutes locks it
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000 && state.info?.person && !document.querySelector(".lockscreen")) lockNow();
});

export function editWords() {
  startEditWords({
    save: (key, text) => PUT("/api/words", { key, text }),
    reset: () => DEL("/api/words", {}),
  });
}

export async function enterDemo() {
  await POST("/api/demo/start");
  state.info = await GET("/api/state");
  sessionStorage.removeItem("hb-goals-celebrated");
  currentHash = "#/dashboard";
  startShell();
}

boot();
