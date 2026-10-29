import { backend } from "./local/store.js";
// Shared building blocks: API calls, money, modals, toasts, help boxes, menus, charts.
import { icon } from "./icons.js";
import { w } from "./words.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------- money & dates
export function money(cents, opts = {}) {
  cents = Math.round(Number(cents || 0));
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = "$" + Math.floor(abs / 100).toLocaleString("en-US") + (opts.noCents ? "" : "." + String(abs % 100).padStart(2, "0"));
  if (neg) return "−" + s;
  return opts.sign && cents > 0 ? "+" + s : s;
}
export function moneyHtml(cents, opts = {}) {
  const cls = opts.color === false ? "" : cents > 0 && opts.inflow ? "in" : cents < 0 && opts.red ? "bad" : "";
  return `<span class="money ${cls}">${money(cents, opts)}</span>`;
}
export function centsFromInput(v) {
  // "$1,234.56", "(12)", "-5", "12.5" -> cents; returns null if blank / invalid
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$,\s]/g, "").replace("−", "-");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const [whole, frac = ""] = s.split(".");
  const cents = parseInt(whole || "0", 10) * 100 + parseInt((frac + "00").slice(0, 2), 10) + (frac.length > 2 && Number(frac[2]) >= 5 ? 1 : 0);
  return neg ? -cents : cents;
}
export function dollars(cents) { // for putting cents back into an input box
  if (cents === null || cents === undefined || cents === "") return "";
  const neg = cents < 0, a = Math.abs(cents);
  return (neg ? "-" : "") + Math.floor(a / 100).toLocaleString("en-US") + "." + String(a % 100).padStart(2, "0");
}
export const todayIso = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
export const thisMonth = () => todayIso().slice(0, 7);
export function niceDate(iso, opts = {}) {
  if (!iso) return "";
  const d = new Date(iso.slice(0, 10) + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(opts.year || iso.slice(0, 4) !== todayIso().slice(0, 4) ? { year: "numeric" } : {}) });
}
export function monthName(m) {
  const d = new Date(m + "-15T12:00:00");
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
export function shiftMonth(m, n) {
  let [y, mo] = m.split("-").map(Number);
  mo += n; y += Math.floor((mo - 1) / 12); mo = ((mo - 1) % 12 + 12) % 12 + 1;
  return `${y}-${String(mo).padStart(2, "0")}`;
}
export function plural(n, word, many) { return `${n} ${n === 1 ? word : many || word + "s"}`; }

// ---------------------------------------------------------------- API
export async function api(method, path, body) {
  const res = await backend.request(method, path, body);
  const data = res.data || {};
  if (res.status === 401 && data.signin) {
    window.dispatchEvent(new CustomEvent("hb:locked"));
    throw new Error("Please sign in.");
  }
  if (res.status >= 400) throw new Error(data.error || `Something went wrong (${res.status}).`);
  if (method !== "GET") window.dispatchEvent(new CustomEvent("hb:changed", { detail: { path } }));
  return data;
}
export const GET = (p) => api("GET", p);
export const POST = (p, b = {}) => api("POST", p, b);
export const PUT = (p, b = {}) => api("PUT", p, b);
export const DEL = (p, b) => api("DELETE", p, b);

// run an action, show errors as a toast
export async function attempt(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) savedToast(okMsg);
    return r ?? true;
  } catch (e) {
    toast(e.message, { bad: true });
    return null;
  }
}

// ---------------------------------------------------------------- toasts
export function toast(msg, opts = {}) {
  let box = $(".toasts");
  if (!box) { box = document.createElement("div"); box.className = "toasts"; document.body.append(box); }
  const t = document.createElement("div");
  t.className = "card toast" + (opts.bad ? " bad" : "");
  t.innerHTML = `<span style="flex:1">${esc(msg)}</span>`;
  if (opts.action) {
    const b = document.createElement("button");
    b.className = "btn sm"; b.textContent = opts.action.label;
    b.onclick = () => { opts.action.fn(); t.remove(); };
    t.append(b);
  }
  box.append(t);
  setTimeout(() => t.remove(), opts.ms || (opts.bad ? 7000 : 3800));
}

// "Saved" with an Undo button right on it
export function savedToast(msg) {
  toast(msg, { action: { label: "Undo", fn: async () => { try { const r = await api("POST", "/api/undo", {}); toast(r.message); } catch (e) { toast(e.message, { bad: true }); } } }, ms: 5000 });
}

// ---------------------------------------------------------------- modals
let modalDepth = 0;
export function modal({ title, body = "", foot = null, wide = false, help = "", onClose }) {
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<div class="card modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" ${help ? `data-help="${esc(help)}"` : ""}>
      <div class="card-head"><h2>${title}</h2><button class="btn icon ghost" data-close data-help="Close this window without saving changes.">${icon("x")}</button></div>
      <div class="modal-body">${body}</div>
      ${foot !== null ? `<div class="modal-foot">${foot}</div>` : ""}
    </div>`;
  document.body.append(ov);
  modalDepth++;
  const close = () => { if (!ov.isConnected) return; ov.remove(); modalDepth--; onClose && onClose(); };
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) ov._down = true; });
  ov.addEventListener("click", (e) => { if (e.target === ov && ov._down && !ov.querySelector("[data-dirty]")) close(); ov._down = false; });
  ov.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  const onKey = (e) => { if (e.key === "Escape" && ov.isConnected) { e.stopPropagation(); close(); } };
  ov.addEventListener("keydown", onKey);
  setTimeout(() => { if (ov.contains(document.activeElement)) return; const f = ov.querySelector("[autofocus], input:not([type=hidden]):not([type=checkbox]):not([type=file]), select, textarea"); f && f.focus(); }, 30);
  return { el: ov, close, $: (s) => ov.querySelector(s), $$: (s) => [...ov.querySelectorAll(s)] };
}
export const modalOpen = () => modalDepth > 0;

export function confirmBox({ title, text, yes = "Yes", no = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, body: `<p>${text}</p>`,
      foot: `<button class="btn" data-no>${esc(no)}</button><button class="btn ${danger ? "danger solid" : "primary"}" data-yes>${esc(yes)}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    m.$("[data-no]").onclick = () => { done = true; m.close(); resolve(false); };
    m.$("[data-yes]").onclick = () => { done = true; m.close(); resolve(true); };
    setTimeout(() => m.$("[data-yes]").focus(), 40);
  });
}

// Every delete asks first and names the thing.
export function confirmDelete(what, name, extra = "") {
  return confirmBox({
    title: `Delete ${what}?`,
    text: `<b>${esc(name)}</b> will move to the Deleted page, where you can put it back any time.${extra ? "<br><br>" + extra : ""}`,
    yes: `Delete ${what}`, danger: true,
  });
}

export function askText({ title, label, value = "", yes = "Save", help = "" }) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, body: `<label class="field"><span>${label}</span><input data-v value="${esc(value)}" ${help ? `data-help="${esc(help)}"` : ""}></label>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-yes>${esc(yes)}</button>`,
      onClose: () => { if (!done) resolve(null); },
    });
    const go = () => { done = true; const v = m.$("[data-v]").value; m.close(); resolve(v); };
    m.$("[data-yes]").onclick = go;
    m.$("[data-v]").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  });
}

// ---------------------------------------------------------------- drafts (kept if the window closes)
export function bindDraft(form, key) {
  const k = "hb-draft:" + key;
  try {
    const saved = JSON.parse(localStorage.getItem(k) || "null");
    if (saved) {
      for (const [name, val] of Object.entries(saved)) {
        const el = form.querySelector(`[name="${name}"]`);
        if (el && el.type !== "file") { if (el.type === "checkbox") el.checked = val; else el.value = val; }
      }
      form.dataset.restored = "1";
    }
  } catch { /* storage unavailable */ }
  form.addEventListener("input", () => {
    form.dataset.dirty = "1";
    const data = {};
    form.querySelectorAll("[name]").forEach((el) => { if (el.type !== "file") data[el.name] = el.type === "checkbox" ? el.checked : el.value; });
    try { localStorage.setItem(k, JSON.stringify(data)); } catch { /* ignore */ }
  });
  return () => { try { localStorage.removeItem(k); } catch { /* ignore */ } delete form.dataset.dirty; };
}
export function formData(form) {
  const d = {};
  form.querySelectorAll("[name]").forEach((el) => {
    if (el.type === "checkbox") d[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) d[el.name] = el.value; }
    else d[el.name] = el.value;
  });
  return d;
}

// is someone in the middle of typing? then never redraw the page under them
export function busyTyping() {
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest(".content")) return true;
  return !!document.querySelector(".content [data-dirty]") || modalOpen();
}

// ---------------------------------------------------------------- help boxes (hover still)
export function initHelp(getDelay) {
  const box = document.createElement("div");
  box.className = "helpbox"; box.hidden = true; document.body.append(box);
  let timer = null, lastX = 0, lastY = 0, target = null;
  const hide = () => { box.hidden = true; clearTimeout(timer); };
  const helpFor = (el) => {
    const h = el.closest("[data-help]");
    if (h) return h.dataset.help;
    const b = el.closest("button, a.btn");
    if (b && b.textContent.trim()) return `${b.textContent.trim()}.`;
    const inp = el.closest("input, select, textarea");
    if (inp) { const l = inp.closest("label"); if (l) return `Type or pick the ${l.textContent.trim().toLowerCase()} here.`; }
    return null;
  };
  document.addEventListener("mousemove", (e) => {
    if (Math.abs(e.clientX - lastX) < 3 && Math.abs(e.clientY - lastY) < 3) return;
    lastX = e.clientX; lastY = e.clientY;
    hide();
    target = e.target;
    timer = setTimeout(() => {
      const text = target && target.isConnected ? helpFor(target) : null;
      if (!text) return;
      box.textContent = text;
      box.hidden = false;
      const r = box.getBoundingClientRect();
      let x = lastX + 14, y = lastY + 18;
      if (x + r.width > innerWidth - 8) x = innerWidth - r.width - 8;
      if (y + r.height > innerHeight - 8) y = lastY - r.height - 12;
      box.style.left = x + "px"; box.style.top = y + "px";
    }, getDelay());
  }, { passive: true });
  ["mousedown", "keydown", "wheel", "scroll"].forEach((ev) => document.addEventListener(ev, hide, { passive: true, capture: true }));
}

// Help mode for touch screens: while it's on, tapping anything explains it instead of doing it.
let helpOn = false;
export const helpModeOn = () => helpOn;
export function setHelpMode(on) {
  helpOn = on;
  document.documentElement.classList.toggle("help-mode", on);
  let bar = document.querySelector(".helpbar");
  if (on && !bar) {
    bar = document.createElement("div");
    bar.className = "card helpbar";
    bar.innerHTML = `<span><b>Help mode.</b> Tap anything to see what it does.</span><button class="btn sm primary" data-helpdone>Done</button>`;
    document.body.append(bar);
    bar.querySelector("[data-helpdone]").onclick = () => setHelpMode(false);
  }
  if (!on) { bar?.remove(); document.querySelector(".helpbox.tap")?.remove(); }
  window.dispatchEvent(new CustomEvent("hb:helpmode", { detail: on }));
}
function helpText(el) {
  const h = el.closest("[data-help]");
  if (h) return h.dataset.help;
  const b = el.closest("button, a");
  if (b && b.textContent.trim()) return `${b.textContent.trim()}.`;
  const inp = el.closest("input, select, textarea");
  if (inp) { const l = inp.closest("label"); if (l) return `Type or pick the ${l.textContent.trim().toLowerCase()} here.`; }
  return null;
}
export function initTapHelp() {
  const block = (e) => {
    if (!helpOn || e.target.closest(".helpbar")) return;
    e.preventDefault(); e.stopPropagation();
    if (e.type !== "click") return;
    document.querySelector(".helpbox.tap")?.remove();
    const text = helpText(e.target) || "This part just shows information.";
    const box = document.createElement("div");
    box.className = "helpbox tap";
    box.textContent = text;
    document.body.append(box);
    const r = e.target.getBoundingClientRect(), br = box.getBoundingClientRect();
    let y = r.bottom + 8;
    if (y + br.height > innerHeight - 90) y = Math.max(8, r.top - br.height - 8);
    box.style.left = Math.max(8, Math.min(innerWidth - br.width - 8, r.left + r.width / 2 - br.width / 2)) + "px";
    box.style.top = y + "px";
  };
  for (const ev of ["click", "pointerdown", "touchstart", "focusin"]) document.addEventListener(ev, block, { capture: true, passive: false });
  // Help boxes need a moment when a mouse is used (iPad with a mouse, or a computer)
}

// ---------------------------------------------------------------- right-click Cut / Copy / Paste
export function initContextMenu() {
  let menu = null;
  const close = () => { if (menu) { menu.remove(); menu = null; } };
  document.addEventListener("contextmenu", (e) => {
    const el = e.target.closest("input:not([type=checkbox]):not([type=range]):not([type=color]), textarea, [contenteditable]");
    close();
    if (!el) return;
    e.preventDefault();
    el.focus();
    const sel = el.value !== undefined ? el.value.substring(el.selectionStart, el.selectionEnd) : String(getSelection());
    menu = document.createElement("div");
    menu.className = "card ctxmenu";
    menu.innerHTML = `<button data-a="cut">Cut <kbd>Ctrl+X</kbd></button><button data-a="copy">Copy <kbd>Ctrl+C</kbd></button><button data-a="paste">Paste <kbd>Ctrl+V</kbd></button><button data-a="all">Select all <kbd>Ctrl+A</kbd></button>`;
    menu.style.left = Math.min(e.clientX, innerWidth - 190) + "px";
    menu.style.top = Math.min(e.clientY, innerHeight - 170) + "px";
    document.body.append(menu);
    menu.addEventListener("mousedown", (ev) => ev.preventDefault());
    menu.addEventListener("click", async (ev) => {
      const a = ev.target.closest("button")?.dataset.a;
      if (!a) return;
      try {
        if (a === "copy" || a === "cut") {
          await navigator.clipboard.writeText(sel).catch(() => document.execCommand("copy"));
          if (a === "cut") document.execCommand("insertText", false, "") || document.execCommand("delete");
        } else if (a === "paste") {
          let text = null;
          try { text = await navigator.clipboard.readText(); } catch { /* not allowed */ }
          if (text !== null) document.execCommand("insertText", false, text);
          else if (!document.execCommand("paste")) toast("Press Ctrl+V to paste here.");
        } else if (a === "all") { el.select ? el.select() : document.execCommand("selectAll"); }
      } finally { close(); }
    });
  });
  ["mousedown", "scroll", "keydown", "blur"].forEach((ev) => window.addEventListener(ev, (e) => { if (!menu?.contains(e.target)) close(); }, true));
}

// ---------------------------------------------------------------- select options
export function accountOptions(accounts, selected, opts = {}) {
  const groups = {};
  for (const a of accounts) {
    if (a.closed && a.id !== selected) continue;
    if (opts.budgetOnly && !a.on_budget) continue;
    (groups[a.group] ||= []).push(a);
  }
  let out = opts.blank ? `<option value="">${esc(opts.blank)}</option>` : "";
  for (const [g, list] of Object.entries(groups)) {
    out += `<optgroup label="${esc(g)}">` + list.map((a) => `<option value="${a.id}" ${a.id == selected ? "selected" : ""}>${esc(a.name)}${a.masked ? " " + a.masked : ""}</option>`).join("") + "</optgroup>";
  }
  return out;
}
export function categoryOptions(groups, selected, opts = {}) {
  let out = `<option value="">${esc(opts.blank || "Pick a category…")}</option>`;
  for (const g of groups) {
    if (g.kind === "cc_payments" && !opts.payments) continue;
    const cats = g.categories.filter((c) => !c.hidden || c.id == selected);
    if (!cats.length) continue;
    const label = g.kind === "income" ? "Income" : g.kind === "cc_payments" ? "Pay a credit card" : g.name;
    const name = (c) => (g.kind === "cc_payments" ? `Payment to ${c.name}` : c.name);
    out += `<optgroup label="${esc(label)}">` + cats.map((c) => `<option value="${c.id}" ${c.id == selected ? "selected" : ""}>${esc(name(c))}</option>`).join("") + "</optgroup>";
  }
  return out;
}

// ---------------------------------------------------------------- charts (plain SVG)
export function sparkline(values, color = "var(--accent)") {
  if (!values || values.length < 2) return `<svg class="spark" viewBox="0 0 100 30"></svg>`;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 27 - ((v - min) / span) * 24]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const id = "sg" + Math.random().toString(36).slice(2, 7);
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L100 30 L0 30 Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>`;
}

function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / p) * p; }

export function barChart({ labels, series, height = 240, money: isMoney = true }) {
  // series: [{name, color, values}]
  const W = 720, H = height, L = 64, B = 26, T = 10;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const n = labels.length, groupW = (W - L - 10) / n, barW = Math.min(26, (groupW - 8) / series.length);
  let g = "";
  for (let i = 0; i <= 4; i++) {
    const y = T + (H - T - B) * (1 - i / 4);
    g += `<line class="gridline" x1="${L}" x2="${W}" y1="${y}" y2="${y}"/><text x="${L - 8}" y="${y + 4}" text-anchor="end">${isMoney ? money((max * i) / 4, { noCents: true }) : Math.round((max * i) / 4)}</text>`;
  }
  labels.forEach((lab, i) => {
    const x0 = L + i * groupW + (groupW - barW * series.length) / 2;
    series.forEach((s, j) => {
      const v = Math.max(0, s.values[i] || 0), h = ((H - T - B) * v) / max;
      g += `<rect x="${x0 + j * barW}" y="${H - B - h}" width="${barW - 2}" height="${h}" rx="3" fill="${s.color}"><title>${esc(s.name)} ${esc(lab)}: ${isMoney ? money(v) : v}</title></rect>`;
    });
    if (n <= 14 || i % Math.ceil(n / 12) === 0) g += `<text x="${L + i * groupW + groupW / 2}" y="${H - 8}" text-anchor="middle">${esc(lab)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg>` + legend(series);
}

export function lineChart({ labels, series, height = 240, zero = false }) {
  const W = 720, H = height, L = 72, B = 26, T = 10;
  const all = series.flatMap((s) => s.values);
  let min = Math.min(...all), max = Math.max(...all);
  if (zero) min = Math.min(0, min);
  const pad = (max - min) * 0.08 || 100;
  min -= pad; max += pad;
  const n = labels.length;
  const X = (i) => L + (i * (W - L - 12)) / Math.max(1, n - 1);
  const Y = (v) => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
  let g = "";
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4, y = Y(v);
    g += `<line class="gridline" x1="${L}" x2="${W}" y1="${y}" y2="${y}"/><text x="${L - 8}" y="${y + 4}" text-anchor="end">${money(v, { noCents: true })}</text>`;
  }
  if (min < 0 && max > 0) g += `<line x1="${L}" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--bad)" stroke-dasharray="4 4" opacity=".6"/>`;
  labels.forEach((lab, i) => { if (n <= 13 || i % Math.ceil(n / 12) === 0) g += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle">${esc(lab)}</text>`; });
  for (const s of series) {
    const d = s.values.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" ");
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="6 5"' : ""}/>`;
    s.values.forEach((v, i) => { if (n <= 24) g += `<circle cx="${X(i)}" cy="${Y(v)}" r="3" fill="${s.color}"><title>${esc(s.name)} ${esc(labels[i])}: ${money(v)}</title></circle>`; });
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg>` + (series.length > 1 ? legend(series) : "");
}

export function donut(items, size = 200) {
  const total = items.reduce((a, b) => a + Math.max(0, b.value), 0) || 1;
  let a0 = -Math.PI / 2, g = "";
  const r = 80, cx = 100, cy = 100;
  for (const it of items) {
    const frac = Math.max(0, it.value) / total;
    if (frac <= 0) continue;
    const a1 = a0 + frac * Math.PI * 2 - 0.0001;
    const large = frac > 0.5 ? 1 : 0;
    g += `<path d="M${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}" stroke="${it.color}" stroke-width="26" fill="none"><title>${esc(it.label)}: ${money(it.value)}</title></path>`;
    a0 = a1 + 0.0001;
  }
  return `<svg viewBox="0 0 200 200" width="${size}" height="${size}" style="max-width:100%">${g}<text x="100" y="96" text-anchor="middle" fill="var(--dim)" font-size="12">Total</text><text x="100" y="118" text-anchor="middle" fill="var(--text)" font-size="17" font-weight="600">${money(total, { noCents: true })}</text></svg>`;
}
export const PALETTE = ["var(--accent)", "var(--accent2)", "var(--good)", "var(--warn)", "#F472B6", "#60A5FA", "#A78BFA", "#FB923C", "#4ADE80", "#94A3B8"];

function legend(series) {
  return `<div class="legend" style="margin-top:8px">${series.map((s) => `<span><i class="dot" style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>`;
}

// ---------------------------------------------------------------- motion
export function countUp(root) {
  const reduced = document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  $$("[data-count]", root).forEach((el) => {
    const target = Number(el.dataset.count);
    if (reduced) { el.textContent = money(target); return; }
    const t0 = performance.now(), dur = 700;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = money(Math.round(target * e));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

export function confetti() {
  if (document.documentElement.dataset.motion === "reduced") return;
  const c = document.createElement("canvas");
  c.className = "confetti"; c.width = innerWidth; c.height = innerHeight;
  document.body.append(c);
  const ctx = c.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const colors = ["--accent", "--accent2", "--good", "--warn"].map((v) => css.getPropertyValue(v).trim() || "#fff");
  const bits = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 13 - 4, r: Math.random() * 6 + 3,
    c: colors[Math.floor(Math.random() * colors.length)], a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3,
  }));
  let frames = 0;
  setTimeout(() => c.remove(), 4000);
  const tick = () => {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const b of bits) {
      b.vy += 0.32; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.a += b.va;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = b.c; ctx.fillRect(-b.r / 2, -b.r / 4, b.r, b.r / 2); ctx.restore();
    }
    if (++frames < 150) requestAnimationFrame(tick); else c.remove();
  };
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- misc
export function avatar(p, cls = "") {
  const ini = (p?.name || "?").trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  return `<span class="avatar ${cls}" style="background:${esc(p?.color || "var(--accent)")}">${esc(ini)}</span>`;
}

export function readFileB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("That file couldn't be read."));
    r.readAsDataURL(file);
  });
}

export function emptyState(title, text, button = "") {
  return `<div class="empty"><b>${title}</b>${text}${button ? `<div style="margin-top:14px">${button}</div>` : ""}</div>`;
}

export function pageHead(key, title, sub) {
  return { title: w(`page.${key}.title`, title), sub: w(`page.${key}.sub`, sub) };
}

// Long-press before anything drags on phones (1.5 seconds)
export function longPressDrag(row, onStart) {
  let timer = null;
  row.addEventListener("touchstart", () => { timer = setTimeout(() => { row.draggable = true; navigator.vibrate?.(30); onStart && onStart(); }, 1500); }, { passive: true });
  ["touchend", "touchmove", "touchcancel"].forEach((ev) => row.addEventListener(ev, () => clearTimeout(timer), { passive: true }));
}
