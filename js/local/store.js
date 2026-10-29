// Home Bank's "back end", running entirely on the phone.
// Every screen asks this module, never a network. It keeps your data encrypted in the phone's
// storage, remembers what changed (for undo, Edit History, and sharing with your partner's phone),
// and makes the backup / share files.
import * as V from "./vault.js";
import * as C from "./calc.js";
import { Engine, OfflineError } from "./engine.js";
import SEED from "./seed.js";

export const APP_VERSION = "2.0.0";

// ---------------------------------------------------------------- rows, keys and changes
const ARRAYS = ["accounts", "category_groups", "categories", "tags", "rules", "scheduled", "holdings", "attachments", "people", "transactions", "keyslots", "assignments", "dismissed"];
const MAPS = ["settings", "words"];
const KEYF = { assignments: (r) => `${r.category_id}|${r.month}`, dismissed: (r) => String(r.key) };
const keyOf = (t, r) => (KEYF[t] ? KEYF[t](r) : String(r.id));

export function plain(db) {
  const o = {};
  for (const t of ARRAYS) o[t] = db[t] || [];
  for (const m of MAPS) o[m] = db[m] || {};
  o.history = db.history || [];
  return o;
}
export function indexRows(db) {
  const m = new Map();
  for (const t of ARRAYS) for (const r of db[t] || []) m.set(`${t}:${keyOf(t, r)}`, JSON.stringify(r));
  for (const t of MAPS) for (const [k, v] of Object.entries(db[t] || {})) m.set(`${t}:${k}`, JSON.stringify(v));
  return m;
}
export function diff(before, after) {
  const ch = [];
  for (const [k, v] of after) { const b = before.get(k); if (b !== v) ch.push({ k, b: b ?? null, a: v }); }
  for (const [k, v] of before) if (!after.has(k)) ch.push({ k, b: v, a: null });
  return ch;
}
export function setRow(o, key, json) {
  const i = key.indexOf(":"), t = key.slice(0, i), k = key.slice(i + 1);
  if (MAPS.includes(t)) { o[t] ||= {}; if (json == null) delete o[t][k]; else o[t][k] = JSON.parse(json); return; }
  if (!ARRAYS.includes(t)) return;
  const arr = (o[t] ||= []);
  const idx = arr.findIndex((r) => keyOf(t, r) === k);
  if (json == null) { if (idx >= 0) arr.splice(idx, 1); }
  else { const row = JSON.parse(json); if (idx >= 0) arr[idx] = row; else arr.push(row); }
}

// change stamps: later stamp wins when two phones changed the same thing
let clock = { last: 0, n: 0 };
const msOf = (s) => Number(String(s).split(".")[0]) || 0;
function stampNow(dev) {
  const ms = Date.now();
  if (ms > clock.last) { clock.last = ms; clock.n = 0; } else clock.n++;
  return `${String(clock.last).padStart(15, "0")}.${String(clock.n).padStart(5, "0")}.${String(dev).padStart(3, "0")}`;
}

// Combine another phone's copy into ours. Each row/setting: whichever phone changed it last wins.
// Deletions win over older edits. Edit History from both phones is kept.
export function merge(local, incoming) {
  const L = indexRows(local.data), R = indexRows(incoming.data);
  const out = structuredClone(local.data);
  const stamps = { ...(local.stamps || {}) }, tombs = { ...(local.tombs || {}) };
  const rs = incoming.stamps || {}, rt = incoming.tombs || {};
  const keys = new Set([...L.keys(), ...R.keys(), ...Object.keys(rt)]);
  let changed = 0, maxMs = 0;
  const side = (rows, st, tb, k) => {
    const has = rows.has(k), live = has ? (st[k] || "0") : "", tomb = tb[k] || "";
    if (tomb && tomb >= live) return { gone: true, s: tomb };
    return has ? { gone: false, s: live, v: rows.get(k) } : null;
  };
  for (const k of keys) {
    const a = side(L, stamps, tombs, k), b = side(R, rs, rt, k);
    if (!b) continue;
    maxMs = Math.max(maxMs, msOf(b.s));
    if (a && a.s >= b.s) continue;
    if (b.gone) {
      if (L.has(k)) { setRow(out, k, null); changed++; }
      tombs[k] = b.s; delete stamps[k];
    } else {
      if (L.get(k) !== b.v) { setRow(out, k, b.v); changed++; }
      stamps[k] = b.s; delete tombs[k];
    }
  }
  // Edit History: keep both phones' entries
  const seen = new Set((out.history || []).map((h) => String(h.id)));
  for (const h of incoming.data.history || []) if (!seen.has(String(h.id))) { const { changes, ...rest } = h; out.history.push(rest); }
  out.history.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : C.idKey(y.id) - C.idKey(x.id)));
  out.history.length = Math.min(out.history.length, 600);
  return { data: out, stamps, tombs, changed, maxMs };
}

// ---------------------------------------------------------------- the back end
const MAX_TRIES = 5;
const ok = (data, status = 200) => ({ status, data });
const err = (message, status = 400, extra = {}) => ({ status, data: { error: message, ...extra } });
const MUTATING_GETS = new Set(["dashboard", "scheduled", "bills/overview"]);

class Backend {
  constructor() {
    this.meta = null;        // unencrypted: device number, who can sign in (names + passcode locks), lockout, Offline lock
    this.key = null;         // data key (only while signed in)
    this.person = null;
    this.db = null;          // C.Data
    this.engine = null;
    this.stamps = {}; this.tombs = {};
    this.index = new Map();
    this.undo = []; this.redo = [];
    this.demo = null;        // {db, engine, pics} while demo mode is on
    this.saving = Promise.resolve();
    this.pics = new Map();
  }

  async init() {
    this.meta = (await V.get("meta")) || {};
    if (!this.meta.device) { this.meta.device = 1 + Math.floor(Math.random() * 999); await this.saveMeta(); }
    try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
  }
  saveMeta() { return V.put("meta", this.meta); }
  ids() {
    const dev = this.meta.device;
    let last = 0;
    return () => { let n = Date.now() * 1000 + dev; if (n <= last) n = last + 1000; last = n; return n; };
  }

  // ---- load / save
  async load() {
    const box = await V.get("data");
    const st = await V.unseal(this.key, box);
    this.useState(st);
  }
  useState(st) {
    this.db = new C.Data(st.data);
    this.stamps = st.stamps || {}; this.tombs = st.tombs || {};
    if (st.clock) clock.last = Math.max(clock.last, st.clock);
    this.index = indexRows(this.db);
    this.engine = new Engine(this.db, this.person, this.makeId ||= this.ids());
  }
  state() {
    const data = plain(this.db);
    // only the newest changes keep their undo details
    data.history = data.history.map((h, i) => (i < 150 || !h.changes ? h : (({ changes, ...r }) => r)(h)));
    return { data, stamps: this.stamps, tombs: this.tombs, clock: clock.last, version: APP_VERSION };
  }
  persist() {
    const key = this.key, st = this.state();
    this.saving = this.saving.then(async () => { await V.put("data", await V.seal(key, st)); }).catch((e) => console.error("Saving failed", e));
    return this.saving;
  }

  // ---- change tracking
  commit(label, { undoable = true, before = this.index } = {}) {
    const after = indexRows(this.db);
    const ch = diff(before, after);
    this.index = after;
    if (!ch.length) return ch;
    const s = stampNow(this.meta.device);
    for (const c of ch) { if (c.a == null) { this.tombs[c.k] = s; delete this.stamps[c.k]; } else { this.stamps[c.k] = s; delete this.tombs[c.k]; } }
    if (undoable) {
      this.undo.push({ label, changes: ch });
      if (this.undo.length > 60) this.undo.shift();
      this.redo = [];
    }
    this.persist();
    return ch;
  }
  apply(changes, dir) {
    for (const c of changes) setRow(this.db, c.k, dir === "back" ? c.b : c.a);
    this.db.reindex();
  }
  rollback(before) {
    const ch = diff(before, indexRows(this.db));
    this.apply(ch, "back");
  }

  // ---- people and passcodes
  peopleList() { return (this.meta.people || []).filter((p) => this.meta.slots?.[p.id]); }
  syncMetaFromData() {
    const people = this.db.people.filter((p) => !p.deleted_at);
    const slots = {};
    for (const k of this.db.keyslots) if (people.some((p) => p.id === k.id)) slots[k.id] = k.slot;
    this.meta.people = people.map((p) => {
      let theme = null;
      try { theme = p.theme ? JSON.parse(p.theme) : null; } catch { theme = null; }
      return { id: p.id, name: p.name, color: p.color, theme };
    });
    this.meta.slots = slots;
    this.meta.appName = this.db.settings.app_name || "Home Bank";
    return this.saveMeta();
  }
  async checkLock() {
    const lo = this.meta.lockout || { fails: 0, until: 0 };
    if (lo.until > Date.now()) throw new OfflineError(`Too many wrong tries. Wait ${Math.ceil((lo.until - Date.now()) / 1000)} seconds and try again.`, 429);
    return lo;
  }
  async failed(lo) {
    lo.fails = (lo.fails || 0) + 1;
    if (lo.fails >= MAX_TRIES) { lo.until = Date.now() + 30000 * 2 ** Math.min(lo.fails - MAX_TRIES, 6); }
    this.meta.lockout = lo; await this.saveMeta();
    const left = MAX_TRIES - lo.fails;
    return err(left > 0 ? `That passcode isn't right. ${left} ${left === 1 ? "try" : "tries"} left before a short wait.` : `Too many wrong tries. Wait ${Math.ceil((lo.until - Date.now()) / 1000)} seconds and try again.`, 403);
  }
  async verify(personId, passcode) {
    const slot = this.meta.slots?.[personId];
    if (!slot) return null;
    return V.unwrap(V.slotFromJson(slot), String(passcode || ""));
  }
  checkPasscode(p) {
    p = String(p || "");
    if (p.length < 4) throw new OfflineError("Passcodes need at least 4 characters. Longer is safer for your backup files.");
    return p;
  }

  // ---- the request router
  async request(method, path, body = {}) {
    method = method.toUpperCase();
    const [p, qs] = path.split("?");
    const query = Object.fromEntries(new URLSearchParams(qs || ""));
    const seg = p.replace(/^\/api\//, "");
    try {
      const r = await this.route(method, seg, query, body || {});
      return r && r.status ? r : ok(r);
    } catch (e) {
      if (e instanceof OfflineError) return err(e.message, e.status);
      console.error(e);
      return err(e.message || "Something went wrong.", 500);
    }
  }

  async route(M, seg, query, body) {
    if (!this.meta) await this.init();
    const key = `${M} ${seg.split("/").map((s) => (/^-?\d+$/.test(s) ? "{id}" : s)).join("/")}`;
    const id = () => Number(seg.split("/")[1]);
    const open = OPEN[key];
    if (open) return open.call(this, { body, query, id });
    if (!this.person) return err("Please sign in.", 401, { signin: true });
    const own = SIGNED_IN[key];
    if (own) return own.call(this, { body, query, id, seg });
    // demo mode: answers come from the made-up copy and nothing is saved
    if (this.demo) {
      if (key === "POST transactions/{id}/receipt") { const r = this.demo.engine.run(M, "/api/" + seg, query, body); this.pics.set(r.id, body.data_b64); return r; }
      return this.demo.engine.run(M, "/api/" + seg, query, body);
    }
    if (M === "GET") {
      if (MUTATING_GETS.has(seg)) {
        const before = this.index;
        const r = this.engine.run(M, "/api/" + seg, query, body);
        this.commit("", { undoable: false, before });
        return r;
      }
      return this.engine.run(M, "/api/" + seg, query, body);
    }
    const before = this.index;
    const topHist = this.db.history[0]?.id;
    let r;
    try { r = this.engine.run(M, "/api/" + seg, query, body); }
    catch (e) { this.rollback(before); this.index = before; throw e; }
    if (key === "POST transactions/{id}/receipt") await this.savePic(r.id, body.data_b64);
    const newest = this.db.history[0];
    const label = newest && newest.id !== topHist ? newest.summary : LABELS[key] || "Change";
    const ch = this.commit(label, { before });
    if (ch.length && newest && newest.id !== topHist) { newest.changes = ch.filter((c) => !c.k.startsWith("keyslots:")); this.persist(); }
    if (ch.some((c) => c.k.startsWith("people:") || c.k === "settings:app_name")) await this.syncMetaFromData();
    return r;
  }

  // ---- receipt pictures (kept encrypted, one per entry)
  async savePic(aid, b64) { await V.put(`pic_${aid}`, await V.seal(this.key, { b64 })); }
  async loadPic(aid) {
    if (this.demo) return this.pics.get(aid) || null;
    const box = await V.get(`pic_${aid}`);
    return box ? (await V.unseal(this.key, box)).b64 : null;
  }

  // ---- files: backups and partner sharing use the same locked format
  async makeFile(kind) {
    const pics = {};
    for (const a of this.db.attachments) if (!a.deleted_at) { const b = await this.loadPic(a.id); if (b) pics[a.id] = b; }
    const box = await V.sealText(this.key, { ...this.state(), pics, kind });
    const slots = this.db.keyslots.map((k) => k.slot);
    const made = new Date();
    const stamp = `${C.todayIso()}-${String(made.getHours()).padStart(2, "0")}${String(made.getMinutes()).padStart(2, "0")}`;
    const text = JSON.stringify({ homebank: 1, kind, made: made.toISOString(), slots, ...box });
    const name = kind === "share" ? `Home Bank for partner ${stamp}.homebank` : `Home Bank backup ${stamp}.homebank`;
    return { filename: name, text };
  }
  parseFile(text) {
    let f;
    try { f = JSON.parse(text); } catch { f = null; }
    if (!f || f.homebank !== 1 || !f.data) throw new OfflineError("That isn't a Home Bank file. Pick a file that ends in .homebank.");
    return f;
  }
  async openFile(f, passcode) {
    // with the passcode: try each person's lock; signed in: use our own key
    if (this.key && !passcode) {
      try { return { st: await V.unsealText(this.key, f), key: this.key }; }
      catch { throw new OfflineError("That file is from a different Home Bank, so it can't be combined with this one."); }
    }
    for (const s of f.slots || []) {
      const k = await V.unwrap(V.slotFromJson(s), String(passcode || ""));
      if (k) return { st: await V.unsealText(k.key, f), key: k.key, raw: k.raw };
    }
    return null;
  }
  async restorePics(pics) { for (const [aid, b] of Object.entries(pics || {})) await this.savePic(Number(aid), b); }
}

const LABELS = { "POST budget/assign": "Budget change", "PUT settings": "Settings change", "PUT words": "Word change", "PUT theme": "Look change" };

// ---------------------------------------------------------------- requests that work before signing in
const OPEN = {};
OPEN["GET state"] = async function () {
  const m = this.meta;
  const lo = m.lockout || { fails: 0, until: 0 };
  const pRow = this.person && (this.demo ? null : this.db?.get("people", this.person.id));
  let theme = null;
  try { theme = pRow?.theme ? JSON.parse(pRow.theme) : (this.person ? (m.people || []).find((x) => x.id === this.person.id)?.theme : null) ?? null; } catch { theme = null; }
  const has = !!(await V.get("data"));
  return {
    app_name: m.appName || "Home Bank", version: APP_VERSION, needs_setup: !has,
    people: this.peopleList().map(({ id, name, color }) => ({ id, name, color })),
    lock: { fails: lo.fails || 0, remaining: Math.max(0, Math.ceil(((lo.until || 0) - Date.now()) / 1000)), tries_left: MAX_TRIES - (lo.fails || 0) },
    person: this.person, is_phone: true, device_ok: true, theme, words: this.db?.words || {},
    budget_mode: this.db?.settings?.budget_mode || "zero", intro_seen: true, intro_animation: false,
    demo_mode: !!this.demo, offline_lock: !!m.offline_lock,
  };
};
OPEN["POST setup"] = async function ({ body }) {
  if (await V.get("data")) throw new OfflineError("Home Bank is already set up on this phone.");
  const people = (body.people || []).filter((p) => (p.name || "").trim());
  if (!people.length) throw new OfflineError("Type at least one name.");
  const codes = people.map((p) => this.checkPasscode(p.passcode));
  if (codes.length > 1 && codes[0] === codes[1]) throw new OfflineError("Give each person a different passcode, so Home Bank knows who's signing in.");
  const k = await V.newDataKey();
  this.key = k.key; this.raw = k.raw;
  const data = structuredClone(SEED);
  data.history = [];
  const colors = ["#7C5CFF", "#22D3EE", "#F472B6", "#34D399"];
  const makeId = (this.makeId ||= this.ids());
  data.people = [];
  data.keyslots = [];
  for (let i = 0; i < people.length; i++) {
    const pid = makeId();
    data.people.push({ id: pid, name: people[i].name.trim(), color: colors[i % 4], theme: null, created_at: C.todayIso(), deleted_at: null, del_batch: null });
    data.keyslots.push({ id: pid, slot: V.slotToJson(await V.wrapFor(k.raw, codes[i])) });
  }
  data.settings = { ...(data.settings || {}), app_name: "Home Bank", budget_mode: "zero" };
  const p0 = data.people[0];
  this.person = { id: p0.id, name: p0.name, color: p0.color };
  this.useState({ data, stamps: {}, tombs: {} });
  this.engine.history("people", p0.id, "create", "Set up Home Bank");
  this.index = indexRows(this.db);
  await this.persist();
  await this.syncMetaFromData();
  return { ok: true };
};
OPEN["POST login"] = async function ({ body }) {
  const lo = await this.checkLock();
  const pid = Number(body.person_id);
  const k = await this.verify(pid, body.passcode);
  if (!k) return this.failed(lo);
  this.meta.lockout = { fails: 0, until: 0 };
  await this.saveMeta();
  this.key = k.key; this.raw = k.raw;
  const p = (this.meta.people || []).find((x) => x.id === pid);
  this.person = { id: pid, name: p?.name || "", color: p?.color };
  await this.load();
  this.undo = []; this.redo = [];
  // enter anything marked "enter automatically" that has come due
  const before = this.index;
  this.engine.autoRecordDue();
  this.commit("Entered automatically", { before, undoable: false });
  return { ok: true };
};
OPEN["POST logout"] = async function () {
  await this.saving;
  this.key = null; this.raw = null; this.person = null; this.db = null; this.engine = null; this.demo = null;
  this.undo = []; this.redo = []; this.index = new Map();
  return { ok: true };
};
// Start this phone from a backup or from the partner's file (nothing set up here yet, or replacing it)
OPEN["POST join"] = async function ({ body }) {
  const f = this.parseFile(body.text);
  const lo = await this.checkLock();
  const got = await this.openFile(f, body.passcode);
  if (!got) return this.failed(lo);
  this.meta.lockout = { fails: 0, until: 0 };
  this.key = got.key; this.raw = got.raw;
  this.useState(got.st);
  await this.syncMetaFromData();
  // who's this? the person whose passcode opened it
  let who = null;
  for (const p of this.db.people.filter((x) => !x.deleted_at)) if (await this.verify(p.id, body.passcode)) { who = p; break; }
  who ||= this.db.people.find((x) => !x.deleted_at);
  this.person = { id: who.id, name: who.name, color: who.color };
  this.engine.person = this.person;
  this.engine.history("settings", 0, "create", f.kind === "share" ? "Joined from partner's phone" : "Restored from a backup");
  this.index = indexRows(this.db);
  await this.persist();
  await this.restorePics(got.st.pics);
  this.meta.last_share_in = new Date().toISOString();
  await this.saveMeta();
  this.undo = []; this.redo = [];
  return { ok: true, name: who.name };
};
// Turning the Offline lock off needs a passcode
OPEN["POST offline-lock"] = async function ({ body }) {
  if (!this.person) return err("Please sign in.", 401, { signin: true });
  if (body.on) { this.meta.offline_lock = true; await this.saveMeta(); return { ok: true, on: true }; }
  const lo = await this.checkLock();
  if (!(await this.verify(this.person.id, body.passcode))) return this.failed(lo);
  this.meta.offline_lock = false; await this.saveMeta();
  return { ok: true, on: false };
};

// ---------------------------------------------------------------- signed-in requests handled here (not by the engine)
const SIGNED_IN = {};
SIGNED_IN["POST undo"] = async function () {
  if (this.demo) return { message: "Nothing to undo in the demo." };
  const u = this.undo.pop();
  if (!u) return { message: "Nothing to undo." };
  const before = this.index;
  this.apply(u.changes, "back");
  this.commit("", { undoable: false, before });
  this.redo.push(u);
  return { message: `Undid: ${u.label}` };
};
SIGNED_IN["POST redo"] = async function () {
  if (this.demo) return { message: "Nothing to redo in the demo." };
  const u = this.redo.pop();
  if (!u) return { message: "Nothing to redo." };
  const before = this.index;
  this.apply(u.changes, "fwd");
  this.commit("", { undoable: false, before });
  this.undo.push(u);
  return { message: `Redid: ${u.label}` };
};
SIGNED_IN["GET undo"] = async function () { return { undo: this.undo.at(-1)?.label || null, redo: this.redo.at(-1)?.label || null }; };
SIGNED_IN["GET history"] = async function ({ query }) {
  const db = this.demo ? this.demo.db : this.db;
  const off = Number(query.offset || 0), lim = Number(query.limit || 100);
  return { history: db.history.slice(off, off + lim).map(({ changes, ...h }) => ({ ...h, can_undo: !!(changes && changes.length) && !h.reverted_by })) };
};
SIGNED_IN["POST history/{id}/revert"] = async function ({ id }) {
  if (this.demo) throw new OfflineError("That isn't available in the demo.");
  const h = this.db.history.find((x) => x.id === id());
  if (!h || !h.changes) throw new OfflineError("That change can't be undone from here.");
  if (h.reverted_by) throw new OfflineError("That change was already undone.");
  const before = this.index;
  this.apply(h.changes, "back");
  this.engine.history(h.entity, h.entity_id, "revert", `Undid: ${h.summary}`);
  const rid = this.db.history[0].id;
  h.reverted_by = rid;
  this.commit(`Undid: ${h.summary}`, { before });
  return { ok: true, message: `Undid: ${h.summary}` };
};
SIGNED_IN["GET receipts/{id}"] = async function ({ id }) {
  const b = await this.loadPic(id());
  if (!b) throw new OfflineError("That picture isn't on this phone.", 404);
  return { data_url: `data:image/jpeg;base64,${b}` };
};
SIGNED_IN["GET settings"] = async function () {
  const db = this.demo ? this.demo.db : this.db;
  return { demo_mode: !!this.demo, people: db.people.filter((p) => !p.deleted_at).map(({ id, name, color }) => ({ id, name, color })),
    app_name: db.setting("app_name", "Home Bank"), budget_mode: db.setting("budget_mode", "zero"), version: APP_VERSION,
    intro_animation: false, hover_seconds: db.setting("hover_seconds", 1.5), offline_lock: !!this.meta.offline_lock };
};
SIGNED_IN["PUT settings"] = async function ({ body }) {
  const db = this.demo ? this.demo.db : this.db;
  const before = this.index;
  for (const k of ["hover_seconds", "budget_mode", "app_name"]) if (k in body) db.settings[k] = body[k];
  if (this.demo) return { ok: true };
  this.commit("Settings change", { before });
  if ("app_name" in body) await this.syncMetaFromData();
  return { ok: true };
};
SIGNED_IN["POST people"] = async function ({ body }) {
  if (this.demo) throw new OfflineError("That isn't available in the demo.");
  const name = (body.name || "").trim();
  if (!name) throw new OfflineError("Type a name.");
  const code = this.checkPasscode(body.passcode);
  for (const p of this.db.people) if (!p.deleted_at && (await this.verify(p.id, code))) throw new OfflineError("Someone already uses that passcode. Pick a different one.");
  const raw = this.raw;
  if (!raw) throw new OfflineError("Lock Home Bank and sign in again, then try again.");
  const before = this.index;
  const pid = this.makeId();
  this.db.people.push({ id: pid, name, color: body.color || "#22D3EE", theme: null, created_at: C.todayIso(), deleted_at: null, del_batch: null });
  this.db.keyslots.push({ id: pid, slot: V.slotToJson(await V.wrapFor(raw, code)) });
  this.db.reindex();
  this.engine.history("people", pid, "create", `Added ${name}`);
  this.commit(`Added ${name}`, { before, undoable: false });
  await this.syncMetaFromData();
  return { id: pid };
};
SIGNED_IN["POST people/{id}/passcode"] = async function ({ id, body }) {
  if (this.demo) throw new OfflineError("That isn't available in the demo.");
  const pid = id();
  const lo = await this.checkLock();
  if (!(await this.verify(this.person.id, body.current))) return this.failed(lo);
  const code = this.checkPasscode(body.new ?? body.passcode);
  for (const p of this.db.people) if (p.id !== pid && !p.deleted_at && (await this.verify(p.id, code))) throw new OfflineError("Someone else uses that passcode. Pick a different one.");
  const raw = this.raw;
  if (!raw) throw new OfflineError("Lock Home Bank and sign in again, then try again.");
  const before = this.index;
  const slot = V.slotToJson(await V.wrapFor(raw, code));
  const row = this.db.keyslots.find((k) => k.id === pid);
  if (row) row.slot = slot; else this.db.keyslots.push({ id: pid, slot });
  this.engine.history("people", pid, "update", `Changed ${this.db.get("people", pid)?.name || "a"} passcode`);
  this.commit("Passcode change", { before, undoable: false });
  await this.syncMetaFromData();
  return { ok: true };
};

// demo mode
SIGNED_IN["POST demo/start"] = async function () {
  const { buildDemo } = await import("./demo.js");
  const people = this.db.people.filter((p) => !p.deleted_at).map(({ id, name, color, theme }) => ({ id, name, color, theme }));
  const db = buildDemo(people);
  this.demo = { db, engine: new Engine(db, this.person, this.ids()) };
  this.pics = new Map();
  return { ok: true };
};
SIGNED_IN["POST demo/resume"] = async function () { return { ok: true }; };
SIGNED_IN["POST demo/exit"] = async function ({ body }) {
  const lo = await this.checkLock();
  const pid = Number(body.person_id || this.person.id);
  if (!(await this.verify(pid, body.passcode))) return this.failed(lo);
  this.meta.lockout = { fails: 0, until: 0 }; await this.saveMeta();
  this.demo = null; this.pics = new Map();
  const p = (this.meta.people || []).find((x) => x.id === pid);
  this.person = { id: pid, name: p?.name || "", color: p?.color };
  this.engine.person = this.person;
  return { ok: true };
};

// backups and partner sharing
SIGNED_IN["GET safety"] = async function () {
  let est = null;
  try { est = await navigator.storage?.estimate?.(); } catch { est = null; }
  let persisted = null;
  try { persisted = await navigator.storage?.persisted?.(); } catch { persisted = null; }
  const m = this.meta;
  return { offline_lock: !!m.offline_lock, last_backup: m.last_backup || null, last_share_out: m.last_share_out || null, last_share_in: m.last_share_in || null,
    used: est?.usage || null, persisted, version: APP_VERSION, demo_mode: !!this.demo,
    people: (m.people || []).map(({ id, name }) => ({ id, name })), device: m.device, standalone: matchMedia("(display-mode: standalone)").matches || !!navigator.standalone };
};
SIGNED_IN["POST file/make"] = async function ({ body }) {
  if (this.demo) throw new OfflineError("Leave demo mode first. Demo data isn't saved or shared.");
  const kind = body.kind === "share" ? "share" : "backup";
  await this.saving;
  const f = await this.makeFile(kind);
  this.meta[kind === "share" ? "last_share_out" : "last_backup"] = new Date().toISOString();
  await this.saveMeta();
  return f;
};
// Combine the partner's file into this phone's Home Bank
SIGNED_IN["POST file/receive"] = async function ({ body }) {
  if (this.demo) throw new OfflineError("Leave demo mode first.");
  const f = this.parseFile(body.text);
  const got = await this.openFile(f);
  const before = this.index;
  const res = merge(this.state(), got.st);
  clock.last = Math.max(clock.last, res.maxMs);
  const keepHistory = this.db.history;
  this.useState({ data: res.data, stamps: res.stamps, tombs: res.tombs, clock: clock.last });
  void keepHistory;
  const who = got.st.data.people?.length ? "partner's phone" : "the file";
  this.engine.history("settings", 0, "update", res.changed ? `Got ${res.changed} change${res.changed === 1 ? "" : "s"} from ${who}` : `Checked ${who}: nothing new`);
  this.index = indexRows(this.db);
  await this.persist();
  await this.restorePics(got.st.pics);
  await this.syncMetaFromData();
  this.meta.last_share_in = new Date().toISOString(); await this.saveMeta();
  this.undo = []; this.redo = [];
  void before;
  return { ok: true, changed: res.changed };
};
// Replace everything on this phone with a backup (asks for the passcode used when the backup was made)
SIGNED_IN["POST file/restore"] = async function ({ body }) {
  if (this.demo) throw new OfflineError("Leave demo mode first.");
  const f = this.parseFile(body.text);
  const lo = await this.checkLock();
  const got = await this.openFile(f, body.passcode);
  if (!got) return this.failed(lo);
  if (got.raw && this.raw && V.b64(this.raw) !== V.b64(got.raw)) { this.key = got.key; this.raw = got.raw; } // a backup from a different set-up: use its key from now on
  this.useState(got.st);
  this.engine.history("settings", 0, "update", `Restored a backup from ${String(f.made || "").slice(0, 10)}`);
  this.index = indexRows(this.db);
  await this.persist();
  await this.restorePics(got.st.pics);
  await this.syncMetaFromData();
  this.undo = []; this.redo = [];
  return { ok: true };
};
// CSV of transactions or a report, for Numbers/Excel or to print
SIGNED_IN["POST export"] = async function ({ body }) {
  const db = this.demo ? this.demo.db : this.db;
  const csv = (rows) => rows.map((r) => r.map((v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
  const $ = (c) => (c / 100).toFixed(2);
  const [start, end] = C.period(body.period || "this_month", body.start, body.end);
  let rows, name;
  if (body.kind === "transactions") {
    rows = [["Date", "Account", "Payee", "Category", "Amount", "Status", "Notes", "Tags"]];
    for (const t of C.getTransactions(db, { limit: 100000 })) rows.push([t.date, t.account_name, t.payee, t.category_label, $(t.amount), t.status, t.notes, t.tags.map((g) => g.name).join("; ")]);
    name = "Home Bank transactions";
  } else if (body.kind === "payee") {
    rows = [["Payee", "Spent", "Times"], ...C.spendingByPayee(db, start, end, 1000).map((r) => [r.name, $(r.spent), r.count])];
    name = `Spending by payee ${start} to ${end}`;
  } else if (body.kind === "income") {
    rows = [["Month", "Income", "Spending", "Saved"], ...C.incomeVsSpending(db, 12).map((r) => [r.month, $(r.income), $(r.spending), $(r.saved)])];
    name = "Income vs spending";
  } else if (body.kind === "tax") {
    const t = C.taxReport(db, Number(body.year || C.todayIso().slice(0, 4)));
    rows = [["Section", "Date", "Payee", "Category", "Account", "Amount"]];
    for (const sct of t.sections || []) for (const r of sct.items || []) rows.push([sct.label, r.date, r.payee, r.category, r.account, $(r.amount)]);
    name = `Tax report ${body.year || ""}`.trim();
  } else {
    rows = [["Category", "Group", "Spent"], ...C.spendingByCategory(db, start, end).map((r) => [r.name, r.group_name, $(r.amount)])];
    name = `Spending by category ${start} to ${end}`;
  }
  return { filename: `${name}.csv`, text: csv(rows), mime: "text/csv" };
};
SIGNED_IN["POST quit"] = async function () { return { ok: true }; };
for (const k of ["GET backups", "POST backups", "POST backups/restore", "GET phone", "POST phone", "POST phone/code", "POST phone/signout-all", "DELETE phone/devices/{id}", "POST demo/load", "POST demo/clear"])
  SIGNED_IN[k] = async function () { throw new OfflineError("That isn't part of the phone version."); };

export const backend = new Backend();
