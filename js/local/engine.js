// Home Bank's engine on the phone: answers every screen from the phone's own (encrypted) copy.
// Nothing here talks to a network.
import * as C from "./calc.js";
import * as IMP from "./importers.js";
import { answer as askAnswer, EXAMPLES as ASK_EXAMPLES } from "./ask.js";

const { fmt, todayIso, monthKey, shiftMonth, monthEnd, addDays } = C;

export class OfflineError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const nope = (what) => { throw new OfflineError(`${what} isn't available.`, 400); };

const nowStamp = () => { const d = new Date(); return `${todayIso()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`; };
const money = (v) => (Number.isInteger(v) ? v : C.toCents(v));
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const batchId = () => Math.random().toString(16).slice(2, 14);
function defaultIds() {
  let last = 0;
  const dev = Math.floor(Math.random() * 1000);
  return () => { let n = Date.now() * 1000 + dev; if (n <= last) n = last + 1000; last = n; return n; };
}

// ================================================================== the engine
export class Engine {
  constructor(data, person, makeId) {
    this.db = data instanceof C.Data ? data : new C.Data(structuredClone(data));
    this.person = person; // {id, name, color}
    this.makeId = makeId || defaultIds();
  }

  // ---- ids: each phone makes ids that can't clash with the other phone's (see store.js)
  newId() { return this.makeId(); }

  // ---- run one request
  run(method, path, query = {}, body = {}) {
    const db = this.db;
    const seg = path.replace(/^\/api\//, "").split("/");
    const id = (n = 1) => Number(seg[n]);
    const M = method.toUpperCase();
    const key = `${M} ${seg.map((s) => (/^-?\d+$/.test(s) ? "{id}" : s)).join("/")}`;
    const h = HANDLERS[key];
    if (!h) throw new OfflineError("That isn't available.", 404);
    const res = h.call(this, { db, seg, id, query, body: body || {}, M });
    if (M !== "GET") db.reindex();
    return res;
  }

  // ---- helpers shared by handlers
  history(entity, entity_id, action, summary) {
    this.db.history.unshift({ id: this.newId(), at: nowStamp(), person: this.person?.name || "", entity, entity_id, action, summary,
      before: null, after: null, reverted_by: null });
    if (this.db.history.length > 600) this.db.history.length = 600;
  }
  ensurePaymentCategory(aid) {
    const db = this.db, a = db.get("accounts", aid);
    if (!a || a.type !== "credit" || !a.on_budget) return null;
    const ex = db.categories.find((c) => c.kind === "cc_payment" && c.account_id === aid && !c.deleted_at);
    if (ex) { ex.name = a.name; return ex.id; }
    const g = db.category_groups.find((x) => x.kind === "cc_payments");
    const cid = this.newId("payment_category_id");
    db.insert("categories", { id: cid, group_id: g?.id ?? null, name: a.name, sort: 0, hidden: 0, kind: "cc_payment", account_id: aid,
      goal_type: "", goal_amount: 0, goal_date: null, notes: "", tax_kind: "", is_demo: a.is_demo || 0, deleted_at: null, del_batch: null });
    a.payment_category_id = cid;
    return cid;
  }
  cleanSplits(data, amount) {
    if (data.splits && data.splits.length) {
      const out = data.splits.filter((s) => Number(s.amount || 0) !== 0).map((s) => ({ category_id: num(s.category_id), amount: money(s.amount), memo: s.memo || "" }));
      const sum = out.reduce((a, s) => a + s.amount, 0);
      if (sum !== amount) throw new OfflineError(`The split amounts add up to ${fmt(sum)}, but the transaction is ${fmt(amount)}.`);
      return out;
    }
    return [{ category_id: num(data.category_id), amount, memo: "" }];
  }
  tagIds(tags) {
    const db = this.db;
    return (tags || []).map((t) => {
      if (typeof t === "number") return t;
      const name = String(t).trim();
      const ex = db.tags.find((g) => g.name.toLowerCase() === name.toLowerCase());
      if (ex) return ex.id;
      const tid = this.newId("tag");
      db.insert("tags", { id: tid, name, color: "#22D3EE", tax_kind: "" });
      return tid;
    });
  }
  addTxn(data, idKey = "id") {
    const db = this.db;
    const amount = money(data.amount);
    const a = db.get("accounts", data.account_id);
    if (!a || a.deleted_at) throw new OfflineError("Pick an account.");
    const splits = this.cleanSplits(data, amount);
    const tid = this.newId(idKey);
    db.insert("transactions", { id: tid, account_id: a.id, date: (data.date || todayIso()).slice(0, 10), payee: (data.payee || "").trim(), amount,
      notes: data.notes || "", status: data.status || "cleared", transfer_txn_id: data.transfer_txn_id ?? null, import_id: null, import_source: data.import_source || null,
      original_payee: null, is_valuation: data.is_valuation ? 1 : 0, needs_review: data.needs_review ? 1 : 0, is_demo: 0,
      created_by: this.person?.name || "", created_at: nowStamp(), updated_at: null, deleted_at: null, del_batch: null,
      splits, tags: this.tagIds(data.tags) });
    return tid;
  }
  link(t1, t2) {
    const db = this.db, a = db.get("transactions", t1), b = db.get("transactions", t2);
    a.transfer_txn_id = t2; b.transfer_txn_id = t1;
    const aa = db.get("accounts", a.account_id), bb = db.get("accounts", b.account_id);
    if ((aa.on_budget && bb.on_budget) || (!aa.on_budget && !bb.on_budget)) { a.splits.forEach((s) => (s.category_id = null)); b.splits.forEach((s) => (s.category_id = null)); }
  }
  transfer(fromId, toId, amount, on, notes = "", categoryId = null, status = "cleared") {
    const db = this.db;
    amount = Math.abs(money(amount));
    const a = db.get("accounts", fromId), b = db.get("accounts", toId);
    if (!a || !b || a.id === b.id) throw new OfflineError("Pick two different accounts.");
    on = (on || todayIso()).slice(0, 10);
    const catOut = a.on_budget && !b.on_budget ? categoryId : null;
    const catIn = b.on_budget && !a.on_budget ? categoryId : null;
    db.reindex();
    const t1 = this.addTxn({ account_id: a.id, date: on, payee: `Transfer to ${b.name}`, amount: -amount, notes, category_id: catOut, status }, `${this.idPrefix || "ids"}.0`);
    db.reindex();
    const t2 = this.addTxn({ account_id: b.id, date: on, payee: `Transfer from ${a.name}`, amount, notes, category_id: catIn, status }, `${this.idPrefix || "ids"}.1`);
    db.reindex();
    this.link(t1, t2);
    this.history("transactions", t1, "create", `Moved ${fmt(amount)} from ${a.name} to ${b.name}`);
    return [t1, t2];
  }
  // A "category" that is really a credit card: record it as a payment to that card
  cardFor(data) {
    if (data.splits && data.splits.length > 1) return null;
    const c = data.category_id != null && data.category_id !== "" ? this.db.get("categories", data.category_id) : null;
    return c && c.kind === "cc_payment" && !c.deleted_at ? this.db.get("accounts", c.account_id) : null;
  }
  cardPayment(data, card) {
    const from = this.db.get("accounts", data.account_id);
    if (!from) throw new OfflineError("Pick an account.");
    if (from.id === card.id) throw new OfflineError(`This is already the ${card.name} account. Pick the account the payment came out of, like checking.`);
    const amount = money(data.amount);
    if (amount > 0) throw new OfflineError(`A payment to ${card.name} is money out of ${from.name}. Switch to "Money out".`);
    const ids = this.transfer(from.id, card.id, -amount, data.date, data.notes || "", null, data.status || "cleared");
    const t1 = this.db.get("transactions", ids[0]);
    if (data.payee && data.payee.trim()) t1.payee = data.payee.trim();
    return ids;
  }
  updateTxn(tid, data) {
    const db = this.db, cur = db.get("transactions", tid);
    if (!cur || cur.deleted_at) throw new OfflineError("That transaction no longer exists.");
    const amount = data.amount !== undefined ? money(data.amount) : cur.amount;
    for (const k of ["account_id", "date", "payee", "notes", "status", "needs_review"]) if (k in data) cur[k] = k === "date" ? String(data[k]).slice(0, 10) : data[k];
    if ("account_id" in data) cur.account_id = Number(data.account_id);
    const amountChanged = amount !== cur.amount;
    cur.amount = amount;
    if ("splits" in data || "category_id" in data) cur.splits = this.cleanSplits(data, amount);
    else if (amountChanged) {
      if (cur.splits.length === 1) cur.splits[0].amount = amount;
      else throw new OfflineError("This transaction is split. Change the split amounts too.");
    }
    if ("tags" in data && data.tags) cur.tags = this.tagIds(data.tags);
    cur.updated_at = nowStamp();
    if (cur.transfer_txn_id && ("amount" in data || "date" in data)) {
      const o = db.get("transactions", cur.transfer_txn_id);
      if (o) { o.amount = -amount; o.date = cur.date; o.splits.forEach((s) => (s.amount = -amount)); }
    }
    this.history("transactions", tid, "update", `Changed ${cur.payee}`);
  }
  // After a category change: offer "always do this" for that payee (same as the PC)
  ruleSuggestion(tid, d, oldCat) {
    if (!("category_id" in d) || !d.category_id || Number(d.category_id) === oldCat) return null;
    const t = this.db.get("transactions", tid);
    if (!t) return null;
    const c = this.db.get("categories", d.category_id);
    if (!c || c.kind !== "normal") return null;
    const key = IMP.tidy(t.original_payee || t.payee);
    const words = C.normalizePayee(key).split(" ").filter(Boolean);
    const text = words.length ? words.slice(0, 2).join(" ") : key;
    if (!text) return null;
    const existing = this.db.rules.find((r) => !r.deleted_at && (r.match_text || "").toLowerCase() === text.toLowerCase());
    const up = text.toUpperCase();
    let others = 0;
    for (const x of this.db.transactions) {
      if (x.deleted_at || x.id === t.id) continue;
      if (!((x.payee || "").toUpperCase().includes(up) || (x.original_payee || "").toUpperCase().includes(up))) continue;
      others += x.splits.filter((sp) => (sp.category_id || 0) !== c.id).length;
    }
    const nice = text === text.toUpperCase() ? text.toLowerCase().replace(/(^|\s)([a-z])/g, (_, a, b2) => a + b2.toUpperCase()) : text;
    return { match_text: nice, rename_to: t.payee, category_id: c.id, existing_rule: existing ? existing.id : null, others };
  }
  softDelete(table, id, batch) {
    const r = this.db.get(table, id);
    if (r && !r.deleted_at) { r.deleted_at = nowStamp(); r.del_batch = batch; }
  }
  deleteTxn(tid) {
    const t = this.db.get("transactions", tid);
    if (!t) return;
    const batch = batchId();
    this.softDelete("transactions", tid, batch);
    if (t.transfer_txn_id) this.softDelete("transactions", t.transfer_txn_id, batch);
    this.history("transactions", tid, "delete", `Deleted ${fmt(t.amount)} ${t.payee}`);
  }
  setAssigned(cid, month, amount) {
    const db = this.db;
    const r = db.assignments.find((x) => x.category_id === cid && x.month === month);
    const before = r ? r.amount : 0;
    if (before === amount) return;
    if (r) r.amount = amount; else db.assignments.push({ category_id: cid, month, amount });
    const c = db.get("categories", cid);
    this.history("assignments", cid, "update", `${c ? c.name : "Category"} ${month}: assigned ${fmt(before)} → ${fmt(amount)}`);
  }
  getAssigned(cid, month) { return this.db.assignments.find((x) => x.category_id === cid && x.month === month)?.amount || 0; }
  moveMoney(month, amount, to, from) {
    if (amount <= 0) throw new OfflineError("Enter an amount to move.");
    if (from) this.setAssigned(from, month, this.getAssigned(from, month) - amount);
    if (to) this.setAssigned(to, month, this.getAssigned(to, month) + amount);
  }
  runRule(r, onlyUncat = true) {
    let changed = 0;
    for (const t of this.db.transactions) {
      if (t.deleted_at || t.transfer_txn_id || t.is_valuation) continue;
      if (r.account_id && r.account_id !== t.account_id) continue;
      if (!(C.ruleMatches(r, t.original_payee || "") || C.ruleMatches(r, t.payee))) continue;
      let did = false;
      if (r.rename_to && t.payee !== r.rename_to) { t.payee = r.rename_to; did = true; }
      const cat = t.splits[0]?.category_id ?? null;
      if (r.category_id && t.splits.length === 1 && (cat === null || !onlyUncat) && cat !== r.category_id) { t.splits[0].category_id = r.category_id; t.needs_review = 0; did = true; }
      if (did) changed++;
    }
    r.times_used = (r.times_used || 0) + changed;
    return changed;
  }
  recordScheduled(it, amount, on) {
    const db = this.db;
    const amt = Math.abs(amount ?? it.amount);
    on = on || it.next_date;
    let made = [];
    if (it.kind === "transfer") {
      if (!it.account_id || !it.to_account_id) throw new OfflineError("Pick both accounts for this transfer first.");
      this.idPrefix = "txn_ids";
      try { made = this.transfer(it.account_id, it.to_account_id, amt, on, it.name, it.category_id); } finally { this.idPrefix = null; }
    } else {
      if (!it.account_id) throw new OfflineError("Pick which account this uses first (change it on the Recurring page).");
      const cat = it.kind === "bill" ? it.category_id : (it.category_id || C.incomeCategoryId(db));
      made = [this.addTxn({ account_id: it.account_id, date: on, payee: it.payee || it.name, amount: it.kind === "income" ? amt : -amt, category_id: cat }, "txn_ids.0")];
    }
    if (it.frequency === "once") this.softDelete("scheduled", it.id, batchId());
    else {
      const nxt = C.occurrences({ ...it, paused: 0 }, addDays(on, 1), addDays(on, 800));
      if (nxt.length) { it.next_date = nxt[0]; it.last_amount = amt; }
    }
    this.history("scheduled", it.id, "update", `Recorded ${it.name}`);
    return made;
  }

  // Enter everything marked "enter automatically" whose date has come (catches up on missed dates)
  autoRecordDue() {
    const t = todayIso();
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const due = this.db.scheduled.filter((x) => !x.deleted_at && x.auto_record && !x.paused && x.next_date && x.next_date <= t && (!x.end_date || x.next_date <= x.end_date));
      if (!due.length) break;
      for (const it of due) {
        try { this.recordScheduled(it, null, null); n++; } catch { it.auto_record = 0; }
        this.db.reindex();
      }
    }
    return n;
  }

  // ---- composite reads
  dashboard() {
    const db = this.db;
    C.advancePast(db);
    const t = todayIso(), cur = monthKey(t);
    const accts = C.accountBalances(db);
    const nw = C.netWorthSeries(db, 12);
    const view = C.monthView(db, cur);
    const cash = accts.filter((a) => ["checking", "savings", "cash"].includes(a.type) && !a.closed).reduce((s, a) => s + a.balance, 0);
    const debt = -accts.filter((a) => a.liability && a.balance < 0).reduce((s, a) => s + a.balance, 0);
    const ivs = C.incomeVsSpending(db, 6);
    const spentNow = ivs.length ? ivs[ivs.length - 1].spending : 0;
    const lm = shiftMonth(cur, -1);
    const dayLast = Math.min(Number(t.slice(8, 10)), Number(monthEnd(lm).slice(8, 10)));
    const lastRows = C.incomeVsSpending; // (kept for clarity)
    let spentLastSame = 0;
    {
      const end = `${lm}-${String(dayLast).padStart(2, "0")}`;
      for (const tx of db.transactions) {
        if (tx.deleted_at || tx.is_valuation || tx.date < lm + "-01" || tx.date > end || (tx.import_source || "") === "opening") continue;
        const a = db.get("accounts", tx.account_id);
        for (const s of tx.splits) {
          if (tx.transfer_txn_id && s.category_id == null) continue;
          if (!a?.on_budget && s.category_id == null) continue;
          const c = s.category_id != null ? db.get("categories", s.category_id) : null;
          if (c && c.kind === "normal") spentLastSame -= s.amount;
        }
      }
    }
    void lastRows;
    const review = C.getTransactions(db, { needs_review: true, limit: 8 })
      .concat(C.getTransactions(db, { uncategorized: true, limit: 8 }).filter((r) => !r.needs_review));
    let reviewCount = 0;
    for (const tx of db.transactions) {
      if (tx.deleted_at) continue;
      const a = db.get("accounts", tx.account_id);
      if (tx.needs_review || (a && a.on_budget && !tx.transfer_txn_id && !tx.is_valuation && (tx.import_source || "") !== "opening" &&
        tx.splits.some((s) => s.category_id == null) && !(a.type === "credit" && tx.amount < 0 && /^interest/i.test(tx.payee || "")))) reviewCount++;
    }
    const due = C.dueSoon(db, 10);
    const fc = C.forecast(db, 45);
    const low = fc.accounts.filter((a) => a.warning).map((a) => a.warning);
    const goalsDone = [];
    for (const g of view.groups) for (const c of g.categories) if (c.goal && c.goal.done && c.goal.type !== "monthly") goalsDone.push({ id: c.id, name: c.name, amount: c.goal.amount });
    const staleBefore = addDays(t, -90);
    const stale = accts.filter((a) => ["house", "vehicle", "investment", "retirement", "hsa"].includes(a.type) && !a.closed && (a.last_updated || "") < staleBefore);
    const bits = [];
    const rta = view.ready_to_assign;
    if (rta > 0) bits.push(`you have ${fmt(rta)} ready to give a job`);
    else if (rta < 0) bits.push(`you've assigned ${fmt(-rta)} more than you have, so pull some back`);
    else bits.push("every dollar has a job");
    if (view.overspent.length) bits.push(`${view.overspent.length} ${view.overspent.length === 1 ? "category is" : "categories are"} overspent`);
    if (spentLastSame) {
      const diff = spentNow - spentLastSame;
      const pct = C.pyRound((Math.abs(diff) * 100) / spentLastSame);
      bits.push(pct >= 3 ? `spending is ${pct}% ${diff > 0 ? "higher" : "lower"} than this time last month` : "spending is right in line with last month");
    }
    if (due.length) bits.push(`${due.length} bill${due.length !== 1 ? "s" : ""} ${due.length !== 1 ? "are" : "is"} due in the next 10 days`);
    let sentence = bits[0][0].toUpperCase() + bits[0].slice(1);
    if (bits.length > 1) sentence = [sentence, ...bits.slice(1, -1)].join(", ") + (bits.length > 2 ? ", and " : " and ") + bits[bits.length - 1];
    sentence += ".";
    if (!accts.length) sentence = "Let's get started: add your first account, or load the demo to look around.";
    const monthly = [];
    for (let i = 5; i >= 0; i--) {
      const m = shiftMonth(cur, -i), end = m !== cur ? monthEnd(m) : t;
      let s = 0;
      for (const tx of db.transactions) {
        if (tx.deleted_at || tx.date > end) continue;
        const a = db.get("accounts", tx.account_id);
        if (a && !a.deleted_at && ["checking", "savings", "cash"].includes(a.type)) s += tx.amount;
      }
      monthly.push(s);
    }
    return {
      hero: { sentence },
      kpis: [
        { key: "net", label: "Net worth", value: nw.length ? nw[nw.length - 1].net : 0, spark: nw.map((p) => p.net), help: "Everything you own minus everything you owe.", link: "networth" },
        { key: "cash", label: "Cash on hand", value: cash, spark: monthly, help: "Checking, savings and cash added together.", link: "accounts" },
        { key: "rta", label: "Ready to assign", value: rta, spark: [], help: "Money that hasn't been given a job in the budget yet.", link: "budget" },
        { key: "spent", label: "Spent this month", value: spentNow, spark: ivs.map((r) => r.spending), help: "Everything spent in budget categories this month, cards included.", link: "reports" },
        { key: "debt", label: "Total debt", value: debt, spark: nw.map((p) => p.debts), help: "Cards, loans and the mortgage added together.", link: "debt" },
      ],
      review: { count: reviewCount, items: review.slice(0, 8) },
      overspent: view.overspent, due, price_alerts: C.priceAlerts(db), low_balance: low, goals_done: goalsDone,
      stale: stale.map((a) => ({ id: a.id, name: a.name, last_updated: a.last_updated })),
      pending: db.transactions.filter((x) => x.status === "pending" && !x.deleted_at).length, month: cur, has_accounts: accts.length > 0,
    };
  }

  deleted() {
    const db = this.db;
    const WHAT = { accounts: "name", transactions: "payee", categories: "name", category_groups: "name", rules: "match_text", scheduled: "name", holdings: "symbol", attachments: "filename", people: "name" };
    const items = [];
    for (const [t, label] of Object.entries(WHAT)) for (const r of db[t]) if (r.deleted_at) items.push({ id: r.id, label: r[label], deleted_at: r.deleted_at, del_batch: r.del_batch, table: t });
    items.sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1));
    const groups = new Map();
    for (const it of items) {
      const key = it.del_batch || `${it.table}:${it.id}`;
      if (!groups.has(key)) groups.set(key, { key, table: it.table, id: it.id, label: it.label, deleted_at: it.deleted_at, count: 0, parts: {} });
      const g = groups.get(key);
      g.count++; g.parts[it.table] = (g.parts[it.table] || 0) + 1;
      if (it.table === "accounts" || (it.table === "category_groups" && g.table !== "accounts")) Object.assign(g, { table: it.table, id: it.id, label: it.label });
    }
    for (const g of groups.values()) if (g.table === "transactions") { const t = db.get("transactions", g.id); if (t) g.label = `${t.payee} ${fmt(t.amount)} on ${t.date}`; }
    return { items: [...groups.values()].filter((g) => g.key !== "undo").slice(0, 300) };
  }
}

// ================================================================== request handlers
const H = {};
const HANDLERS = H;
const ok = { ok: true };

// ---- reads
H["GET dashboard"] = function () { return this.dashboard(); };
H["GET accounts"] = function ({ db }) { return { accounts: C.accountBalances(db), types: Object.fromEntries(Object.entries(C.ACCOUNT_TYPES).map(([k, v]) => [k, v[0]])) }; };
H["GET accounts/{id}/reconcile"] = function ({ db, id }) { return C.reconcileInfo(db, id()); };
H["GET transactions"] = function ({ db, query: q }) {
  const acct = num(q.account);
  const rows = C.getTransactions(db, { account_id: acct, search: q.q || "", category_id: num(q.category), start: q.start || null, end: q.end || null,
    status: q.status || null, tag: q.tag || null, uncategorized: q.uncategorized === "1", needs_review: q.review === "1", limit: Number(q.limit || 300), offset: Number(q.offset || 0) });
  if (acct && !["q", "category", "start", "end", "status", "tag", "uncategorized", "review"].some((k) => q[k])) C.runningBalances(db, acct, rows);
  return { transactions: rows, account: acct ? C.accountBalances(db).find((a) => a.id === acct) || null : null };
};
H["GET transactions/{id}"] = function ({ db, id }) {
  const r = C.getTransactions(db, { txn_ids: [id()], limit: 1 });
  if (!r.length) throw new OfflineError("That transaction no longer exists.", 404);
  return r[0];
};
H["GET payees"] = function ({ db }) {
  const m = new Map();
  for (const t of db.transactions) {
    if (t.deleted_at || t.transfer_txn_id || t.is_valuation || !t.payee || t.import_source === "opening") continue;
    const e = m.get(t.payee) || { payee: t.payee, n: 0, last: null };
    e.n++; if (!e.last || C.idKey(t.id) > C.idKey(e.last.id)) e.last = t; m.set(t.payee, e);
  }
  return { payees: [...m.values()].sort((a, b) => (b.n - a.n) || (a.payee < b.payee ? 1 : a.payee > b.payee ? -1 : 0)).slice(0, 400).map((e) => ({ payee: e.payee, n: e.n, category_id: e.last.splits[0]?.category_id ?? null })) };
};
H["GET categories"] = function ({ db }) { return { groups: C.listCategories(db), tags: [...db.tags].sort((a, b) => (a.name < b.name ? -1 : 1)) }; };
H["GET rules"] = function ({ db }) {
  return { rules: db.rules.filter((r) => !r.deleted_at).sort((a, b) => (a.sort - b.sort) || (C.idKey(a.id) - C.idKey(b.id)))
    .map((r) => ({ ...r, category_name: db.get("categories", r.category_id)?.name ?? null, account_name: db.get("accounts", r.account_id)?.name ?? null })) };
};
H["GET budget"] = function ({ db, query }) { return C.flexView(db, query.month || monthKey(todayIso())); };
H["GET goals"] = function ({ db }) {
  const v = C.monthView(db);
  const out = [];
  for (const g of v.groups) for (const c of g.categories) if (c.goal) out.push({ id: c.id, name: c.name, group: g.name, available: c.available, assigned: c.assigned, ...c.goal });
  return { goals: out, month: v.month, ready_to_assign: v.ready_to_assign };
};
H["GET scheduled"] = function ({ db }) { C.advancePast(db); return { items: C.listScheduled(db), frequencies: C.FREQUENCIES }; };
H["GET bills/calendar"] = function ({ db, query }) { return C.calendarMonth(db, query.month || monthKey(todayIso())); };
H["GET bills/detect"] = function ({ db }) { return { found: C.detectRecurring(db) }; };
H["GET bills/overview"] = function ({ db }) {
  C.advancePast(db);
  const items = C.listScheduled(db);
  return { items, due: C.dueSoon(db, 14), price_alerts: C.priceAlerts(db), subscriptions: C.subscriptions(db), frequencies: C.FREQUENCIES,
    monthly_bills: items.filter((i) => i.kind === "bill").reduce((s, i) => s + i.monthly_cost, 0),
    monthly_income: items.filter((i) => i.kind === "income").reduce((s, i) => s + i.monthly_cost, 0) };
};
H["GET debt"] = function ({ db, query }) {
  const extra = query.extra ? C.toCents(query.extra) : 0;
  const skip = new Set(String(query.exclude || "").split(",").filter(Boolean).map(Number));
  const all = C.debts(db), ds = all.filter((d) => !skip.has(d.id));
  const base = C.simulate(ds, 0, "minimum");
  const out = { debts: all, excluded: [...skip].sort((a, b) => a - b), extra, minimum_only: base, snowball: C.simulate(ds, extra, "snowball"),
    avalanche: C.simulate(ds, extra, "avalanche"), total: ds.reduce((s, d) => s + d.balance, 0), missing_minimums: ds.filter((d) => !d.min_payment).map((d) => d.name) };
  for (const k of ["snowball", "avalanche"]) out[k].interest_saved = base.months ? base.interest - out[k].interest : null;
  return out;
};
H["POST amortize"] = function ({ body: b }) {
  try {
    return C.amortization(money(b.principal || 0), C.pyRound(Number(b.apr || 0) * 100), num(b.months), b.payment ? money(b.payment) : null, b.start || null);
  } catch (e) { throw new OfflineError(e.message); }
};
H["GET forecast"] = function ({ db, query }) { return C.forecast(db, Number(query.days || 90)); };
H["GET networth"] = function ({ db, query }) { return { ...C.netWorthNow(db), series: C.netWorthSeries(db, Number(query.months || 24)) }; };
H["GET reports"] = function ({ db, query: q }) {
  const [start, end] = C.period(q.period || "this_month", q.start, q.end);
  const kind = q.kind || "category";
  if (kind === "category") { const rows = C.spendingByCategory(db, start, end); return { kind, start, end, rows, total: rows.reduce((s, r) => s + r.amount, 0) }; }
  if (kind === "payee") return { kind, start, end, rows: C.spendingByPayee(db, start, end) };
  if (kind === "income") return { kind, rows: C.incomeVsSpending(db, Number(q.months || 12)) };
  if (kind === "trends") return { kind, rows: C.trends(db, num(q.category), 12) };
  if (kind === "month") return { kind, start, end, ...C.byMonthTable(db, start, end) };
  if (kind === "tax") return { kind, ...C.taxReport(db, Number(q.year || todayIso().slice(0, 4))) };
  throw new OfflineError("Unknown report.");
};
H["GET search"] = function ({ db, query }) {
  const q = (query.q || "").trim();
  if (q.length < 2) return { results: [] };
  const res = [];
  const lq = q.toLowerCase();
  db.accounts.filter((a) => !a.deleted_at && a.name.toLowerCase().includes(lq)).slice(0, 5).forEach((a) => res.push({ kind: "account", id: a.id, label: a.name, sub: C.ACCOUNT_TYPES[a.type]?.[0] || "" }));
  db.categories.filter((c) => !c.deleted_at && c.kind === "normal" && c.name.toLowerCase().includes(lq)).slice(0, 5).forEach((c) => res.push({ kind: "category", id: c.id, label: c.name, sub: "Category" }));
  C.getTransactions(db, { search: q, limit: 8 }).forEach((t) => res.push({ kind: "transaction", id: t.id, account_id: t.account_id, label: t.payee, sub: `${t.date} · ${t.account_name}`, amount: t.amount }));
  return { results: res };
};
H["GET transfers/suggest"] = function ({ db }) { return { pairs: IMP.autoMatchTransfers(db) }; };
H["GET history"] = function ({ db, query }) {
  const off = Number(query.offset || 0), lim = Number(query.limit || 100);
  return { history: db.history.slice(off, off + lim).map((h) => ({ ...h, can_undo: false })) };
};
H["GET deleted"] = function () { return this.deleted(); };
H["GET settings"] = function ({ db }) {
  return { demo_mode: false, people: db.people.filter((p) => !p.deleted_at), app_name: db.setting("app_name", "Home Bank"), budget_mode: db.setting("budget_mode", "zero"),
    start_with_windows: false, is_windows: false, data_folder: "(on the PC)", backups_folder: "(on the PC)", demo_loaded: !!db.setting("demo_loaded"),
    version: db.app_version || "", intro_animation: db.setting("intro_animation", true), hover_seconds: db.setting("hover_seconds", 1.5), offline: true };
};
H["GET words"] = function ({ db }) { return { words: db.words || {} }; };
H["GET ask/examples"] = function () { return { examples: ASK_EXAMPLES }; };
H["POST ask"] = function ({ db, body }) { return askAnswer(db, body.question); };

// ---- accounts
function acctPayload(b) {
  const d = { ...b };
  for (const k of ["balance", "min_payment", "credit_limit", "low_balance_warn"]) {
    if (k in d && d[k] !== null && d[k] !== "") d[k] = money(d[k]);
    else if (k in d) d[k] = k !== "low_balance_warn" ? 0 : 10000;
  }
  if ("apr" in d) { d.apr_bp = C.pyRound(Number(d.apr || 0) * 100); delete d.apr; }
  return d;
}
H["POST accounts"] = function ({ db, body }) {
  const d = acctPayload(body);
  const t = d.type || "checking";
  if (!C.ACCOUNT_TYPES[t]) throw new OfflineError("Pick an account type.");
  if (!(d.name || "").trim()) throw new OfflineError("Give the account a name.");
  const onBudget = d.on_budget === undefined || d.on_budget === null ? C.ACCOUNT_TYPES[t][2] : !!d.on_budget;
  let balance = Number(d.balance || 0);
  if (C.isLiability(t) && balance > 0) balance = -balance;
  const start = d.opening_date || todayIso();
  const aid = this.newId("id");
  const sort = Math.max(0, ...db.accounts.map((a) => a.sort || 0)) + 10;
  db.insert("accounts", { id: aid, name: d.name.trim(), type: t, institution: d.institution || "", last4: String(d.last4 || "").replace(/\D/g, "").slice(-4),
    on_budget: onBudget ? 1 : 0, opening_balance: 0, opening_date: start, apr_bp: Number(d.apr_bp || 0), min_payment: Number(d.min_payment || 0),
    credit_limit: Number(d.credit_limit || 0), low_balance_warn: d.low_balance_warn ?? 10000, payment_category_id: null, notes: d.notes || "", sort, closed: 0,
    owner: d.owner || "Joint", simplefin_id: null, last_updated: nowStamp(), is_demo: 0, created_at: nowStamp(), updated_at: null, deleted_at: null, del_batch: null });
  db.reindex();
  this.ensurePaymentCategory(aid);
  db.reindex();
  if (balance) {
    const cat = onBudget && !C.isLiability(t) ? C.incomeCategoryId(db) : null;
    const tid = this.newId("opening_txn_id");
    db.insert("transactions", { id: tid, account_id: aid, date: start, payee: "Starting balance", amount: balance, notes: "", status: "reconciled", transfer_txn_id: null,
      import_id: null, import_source: "opening", original_payee: null, is_valuation: 0, needs_review: 0, is_demo: 0, created_by: this.person?.name || "",
      created_at: nowStamp(), updated_at: null, deleted_at: null, del_batch: null, splits: [{ category_id: cat, amount: balance, memo: "" }], tags: [] });
  }
  this.history("accounts", aid, "create", `Added account ${d.name}`);
  const made = db.get("accounts", aid);
  const opening = db.transactions.find((t) => t.account_id === aid && t.import_source === "opening");
  return { id: aid, payment_category_id: made.payment_category_id ?? null, opening_txn_id: opening ? opening.id : null };
};
H["PUT accounts/{id}"] = function ({ db, id, body }) {
  const a = db.get("accounts", id());
  if (!a) throw new OfflineError("That account no longer exists.");
  const d = acctPayload(body);
  for (const k of ["name", "institution", "last4", "on_budget", "apr_bp", "min_payment", "credit_limit", "low_balance_warn", "notes", "owner", "closed", "sort", "type"]) if (k in d) a[k] = d[k];
  if ("last4" in d) a.last4 = String(d.last4 || "").replace(/\D/g, "").slice(-4);
  db.reindex();
  this.ensurePaymentCategory(a.id);
  this.history("accounts", a.id, "update", `Changed account ${a.name}`);
  return ok;
};
H["DELETE accounts/{id}"] = function ({ db, id }) {
  const a = db.get("accounts", id());
  if (!a) return ok;
  const batch = batchId();
  this.softDelete("accounts", a.id, batch);
  for (const t of db.transactions) if (t.account_id === a.id && !t.deleted_at) { t.deleted_at = nowStamp(); t.del_batch = batch; }
  if (a.payment_category_id) this.softDelete("categories", a.payment_category_id, batch);
  this.history("accounts", a.id, "delete", `Deleted account ${a.name}`);
  return ok;
};
H["POST accounts/{id}/value"] = function ({ db, id, body }) {
  const a = db.get("accounts", id());
  let nb = money(body.balance);
  if (C.isLiability(a.type) && nb > 0) nb = -nb;
  const diff = nb - C.balanceOf(db, a.id);
  a.last_updated = nowStamp();
  if (!diff) return { id: null };
  const tid = this.addTxn({ account_id: a.id, date: body.date || todayIso(), payee: body.note || "Updated value", amount: diff, is_valuation: 1, status: "reconciled" });
  return { id: tid };
};
H["POST accounts/{id}/reconcile"] = function ({ db, id, body }) {
  const aid = id();
  const info = C.reconcileInfo(db, aid);
  const stmt = money(body.statement_balance);
  let diff = stmt - info.cleared_balance;
  if (diff && body.adjust) { this.addTxn({ account_id: aid, date: body.date || todayIso(), payee: "Reconcile adjustment", amount: diff, status: "cleared" }); diff = 0; }
  if (diff) throw new OfflineError(`Still ${fmt(diff)} apart. Find the difference or add an adjustment.`);
  for (const t of db.transactions) if (t.account_id === aid && t.status === "cleared" && !t.deleted_at) t.status = "reconciled";
  db.settings[`reconciled_${aid}`] = { date: body.date || todayIso(), balance: stmt };
  return ok;
};
H["POST accounts/reorder"] = function ({ db, body }) { (body.ids || []).forEach((aid, i) => { const a = db.get("accounts", aid); if (a) a.sort = i * 10; }); return ok; };

// ---- transactions
H["POST transactions"] = function ({ body }) {
  if (!body.account_id) throw new OfflineError("Pick an account.");
  if (!body.amount) throw new OfflineError("Enter an amount.");
  const card = this.cardFor(body);
  if (card) { const ids = this.cardPayment(body, card); return { id: ids[0], ids, card_payment: card.name }; }
  const tid = this.addTxn(body);
  const t = this.db.get("transactions", tid);
  this.history("transactions", tid, "create", `Added ${fmt(t.amount)} ${t.payee}`);
  return { id: tid };
};
H["PUT transactions/{id}"] = function ({ db, id, body }) {
  const tid = id();
  const d = { ...body };
  if ("amount" in d) d.amount = money(d.amount);
  if ("category_id" in d) d.needs_review = 0;
  const cur = db.get("transactions", tid);
  const card = cur && !cur.transfer_txn_id ? this.cardFor(d) : null;
  if (card) {
    // turn this spending into a payment to the card: same money, now linked to the card
    const merged = { account_id: cur.account_id, date: cur.date, notes: cur.notes, status: cur.status, payee: cur.payee, ...d };
    if (Number(merged.account_id) === card.id) throw new OfflineError(`This is already the ${card.name} account. Pick the account the payment came out of, like checking.`);
    if (money(merged.amount ?? cur.amount) > 0) throw new OfflineError(`A payment to ${card.name} is money out. Switch to "Money out".`);
    this.updateTxn(tid, { ...d, category_id: null, splits: undefined });
    const amt = -cur.amount;
    const other = this.addTxn({ account_id: card.id, date: cur.date, payee: `Payment from ${db.get("accounts", cur.account_id).name}`, amount: amt, status: cur.status });
    db.reindex();
    this.link(tid, other);
    return { ok: true, rule_suggestion: null, card_payment: card.name };
  }
  const oldCat = cur && cur.splits.length === 1 ? cur.splits[0].category_id : null;
  this.updateTxn(tid, d);
  return { ok: true, rule_suggestion: this.ruleSuggestion(tid, d, oldCat) };
};
H["DELETE transactions/{id}"] = function ({ id }) { this.deleteTxn(id()); return ok; };
H["POST transactions/bulk"] = function ({ db, body }) {
  const ids = (body.ids || []).map(Number);
  let n = 0;
  for (const tid of ids) {
    const t = db.get("transactions", tid);
    if (!t) continue;
    if (body.action === "category") { if (t.splits.length <= 1) { this.updateTxn(tid, { category_id: num(body.category_id), needs_review: 0 }); n++; } }
    else if (body.action === "delete") { this.deleteTxn(tid); n++; }
    else if (body.action === "cleared" || body.action === "pending") { this.updateTxn(tid, { status: body.action }); n++; }
    else if (body.action === "approve") { this.updateTxn(tid, { needs_review: 0 }); n++; }
  }
  return { changed: n };
};
H["POST transfers"] = function ({ body }) {
  const ids = this.transfer(num(body.from_id), num(body.to_id), money(body.amount), body.date, body.notes || "", num(body.category_id));
  return { ids };
};
H["POST transactions/{id}/link"] = function ({ db, id, body }) {
  const a = db.get("transactions", id()), b = db.get("transactions", body.other_id);
  if (!a || !b || a.amount !== -b.amount || a.account_id === b.account_id) throw new OfflineError("Those two can't be a transfer: the amounts must match and be in different accounts.");
  this.link(a.id, b.id); a.needs_review = 0; b.needs_review = 0;
  return ok;
};
H["POST transactions/{id}/unlink"] = function ({ db, id }) {
  const t = db.get("transactions", id());
  if (t && t.transfer_txn_id) { const o = db.get("transactions", t.transfer_txn_id); t.transfer_txn_id = null; if (o) o.transfer_txn_id = null; }
  return ok;
};
H["POST transactions/{id}/receipt"] = function ({ db, id, body }) {
  if (!body.data_b64) throw new OfflineError("No picture was sent.");
  const aid = this.newId("id");
  db.insert("attachments", { id: aid, txn_id: id(), filename: String(body.filename || "receipt.jpg").split(/[\\/]/).pop(), created_at: nowStamp(), deleted_at: null, del_batch: null });
  return { id: aid };
};
H["DELETE attachments/{id}"] = function ({ id }) { this.softDelete("attachments", id(), batchId()); return ok; };
H["POST import/preview"] = function ({ db, body }) {
  const bytes = Uint8Array.from(atob(body.data_b64 || ""), (c) => c.charCodeAt(0));
  if (!bytes.length) throw new OfflineError("The file was empty.");
  try { return IMP.preview(db, num(body.account_id), body.filename || "", bytes, body.mapping || null); }
  catch (e) { throw new OfflineError(`Couldn't read that file: ${e.message}`); }
};
H["POST import/commit"] = function ({ db, body }) {
  const aid = num(body.account_id);
  const a = db.get("accounts", aid);
  if (!a) throw new OfflineError("Pick an account.");
  if (body.mapping && body.signature) db.settings[`csvmap_${body.signature}`] = body.mapping;
  let added = 0, linked = 0;
  for (const r of body.rows || []) {
    if (r.include === false) continue;
    const tid = this.addTxn({ account_id: aid, date: r.date, payee: r.payee, amount: Number(r.amount), notes: r.memo || "", category_id: num(r.category_id),
      status: r.status || "cleared", import_source: "file", needs_review: r.category_id ? 0 : 1 });
    const t = db.get("transactions", tid) || db.transactions[db.transactions.length - 1];
    t.import_id = r.import_id || null; t.original_payee = r.original_payee || null;
    added++;
    const tm = r.transfer_match;
    if (tm && r.link_transfer !== false) {
      db.reindex();
      const other = db.get("transactions", tm.id);
      if (other && !other.transfer_txn_id && !other.deleted_at) { this.link(tid, other.id); t.needs_review = 0; other.needs_review = 0; linked++; }
    }
  }
  a.last_updated = nowStamp();
  this.history("transactions", 0, "create", `Imported ${added} transactions into ${a.name}`);
  return { added, transfers_linked: linked };
};

// ---- rules
H["POST rules"] = function ({ db, body }) {
  if (!(body.match_text || "").trim()) throw new OfflineError("Type the words to look for in the payee.");
  const rid = this.newId("id");
  db.insert("rules", { id: rid, match_type: body.match_type || "contains", match_text: body.match_text.trim(), rename_to: (body.rename_to || "").trim(),
    category_id: num(body.category_id), account_id: num(body.account_id), sort: Math.max(0, ...db.rules.map((r) => r.sort || 0)) + 10, enabled: 1, times_used: 0,
    is_demo: 0, created_at: nowStamp(), deleted_at: null, del_batch: null });
  db.reindex();
  const changed = body.run_now ? this.runRule(db.get("rules", rid), !body.apply_all) : 0;
  return { id: rid, changed };
};
H["PUT rules/{id}"] = function ({ db, id, body }) {
  const r = db.get("rules", id());
  if (r) for (const k of ["match_type", "match_text", "rename_to", "category_id", "account_id", "enabled", "sort"]) if (k in body) r[k] = body[k];
  return ok;
};
H["DELETE rules/{id}"] = function ({ id }) { this.softDelete("rules", id(), batchId()); return ok; };
H["POST rules/{id}/run"] = function ({ db, id, body }) { return { changed: this.runRule(db.get("rules", id()), !body.apply_all) }; };

// ---- categories, groups, tags
H["POST groups"] = function ({ db, body }) {
  const name = (body.name || "").trim();
  if (!name) throw new OfflineError("Give the group a name.");
  const gid = this.newId("id");
  db.insert("category_groups", { id: gid, name, sort: Math.max(0, ...db.category_groups.map((g) => g.sort || 0)) + 10, hidden: 0, kind: "normal", is_demo: 0, deleted_at: null, del_batch: null });
  return { id: gid };
};
H["PUT groups/{id}"] = function ({ db, id, body }) { const g = db.get("category_groups", id()); if (g) for (const k of ["name", "hidden", "sort"]) if (k in body) g[k] = body[k]; return ok; };
H["DELETE groups/{id}"] = function ({ db, id }) {
  const g = db.get("category_groups", id());
  if (!g) return ok;
  if (g.kind !== "normal") throw new OfflineError("This group is built in and can't be deleted.");
  const batch = batchId();
  this.softDelete("category_groups", g.id, batch);
  for (const c of db.categories) if (c.group_id === g.id && !c.deleted_at) this.softDelete("categories", c.id, batch);
  return ok;
};
H["POST categories"] = function ({ db, body }) {
  const name = (body.name || "").trim(), gid = num(body.group_id);
  if (!name || !gid) throw new OfflineError("Give the category a name and pick a group.");
  const cid = this.newId("id");
  db.insert("categories", { id: cid, group_id: gid, name, sort: Math.max(0, ...db.categories.filter((c) => c.group_id === gid).map((c) => c.sort || 0)) + 10,
    hidden: 0, kind: "normal", account_id: null, goal_type: "", goal_amount: 0, goal_date: null, notes: "", tax_kind: "", is_demo: 0, deleted_at: null, del_batch: null });
  return { id: cid };
};
H["PUT categories/{id}"] = function ({ db, id, body }) {
  const c = db.get("categories", id());
  if (!c) throw new OfflineError("That category no longer exists.");
  for (const k of ["name", "group_id", "hidden", "sort", "goal_type", "goal_date", "notes", "tax_kind"]) if (k in body) c[k] = body[k];
  if ("goal_amount" in body) c.goal_amount = money(body.goal_amount || 0);
  if (body.goal_type === "") { c.goal_amount = 0; c.goal_date = null; }
  return ok;
};
H["DELETE categories/{id}"] = function ({ db, id, body }) {
  const c = db.get("categories", id());
  if (!c) return ok;
  if (c.kind !== "normal") throw new OfflineError("This category is built in and can't be deleted.");
  const to = num(body.move_to);
  if (to) for (const t of db.transactions) for (const s of t.splits) if (s.category_id === c.id) s.category_id = to;
  this.softDelete("categories", c.id, batchId());
  return ok;
};
H["POST categories/reorder"] = function ({ db, body }) {
  (body.groups || []).forEach((g, gi) => {
    const grp = db.get("category_groups", g.id); if (grp) grp.sort = gi * 10;
    (g.categories || []).forEach((cid, ci) => { const c = db.get("categories", cid); if (c) { c.sort = ci * 10; c.group_id = Number(g.id); } });
  });
  return ok;
};
H["POST tags"] = function ({ db, body }) {
  const name = (body.name || "").trim();
  if (!name) throw new OfflineError("Give the tag a name.");
  const ex = db.tags.find((g) => g.name.toLowerCase() === name.toLowerCase());
  if (ex) return { ok: true, id: ex.id };
  const tid = this.newId("id");
  db.insert("tags", { id: tid, name, color: body.color || "#22D3EE", tax_kind: body.tax_kind || "" });
  return { ok: true, id: tid };
};
H["PUT tags/{id}"] = function ({ db, id, body }) { const t = db.get("tags", id()); if (t) for (const k of ["name", "color", "tax_kind"]) if (k in body) t[k] = body[k]; return ok; };

// ---- budget
H["POST budget/assign"] = function ({ body }) { this.setAssigned(num(body.category_id), body.month, money(body.amount || 0)); return ok; };
H["POST budget/move"] = function ({ body }) { this.moveMoney(body.month, money(body.amount), num(body.to_id), num(body.from_id)); return ok; };
H["POST budget/fix"] = function ({ db, body }) {
  const month = body.month, cid = num(body.category_id);
  const view = C.monthView(db, month);
  const over = view.overspent.find((o) => o.id === cid);
  if (!over) return { covered: 0 };
  let from = num(body.from_id);
  if (!from && view.ready_to_assign < over.amount) {
    let best = null;
    for (const g of view.groups) for (const c of g.categories) if (c.id !== cid && c.kind === "normal" && c.available >= over.amount && (!best || c.available > best.available)) best = c;
    if (best) from = best.id;
  }
  this.moveMoney(month, over.amount, cid, from);
  return { covered: over.amount };
};
H["POST budget/copy-last"] = function ({ db, body }) {
  const prev = shiftMonth(body.month, -1);
  const rows = db.assignments.filter((r) => r.month === prev);
  for (const r of rows) this.setAssigned(r.category_id, body.month, r.amount);
  return { copied: rows.length };
};
H["POST budget/assign-needed"] = function ({ db, body }) {
  const view = C.monthView(db, body.month);
  let rta = view.ready_to_assign, done = 0;
  for (const g of view.groups) for (const c of g.categories) {
    if (c.goal && c.goal.needed > 0 && rta > 0) { const amt = Math.min(rta, c.goal.needed); this.setAssigned(c.id, body.month, c.assigned + amt); rta -= amt; done += amt; }
  }
  return { assigned: done };
};
H["POST budget/mode"] = function ({ db, body }) {
  if (!["zero", "flex"].includes(body.mode)) throw new OfflineError("Pick a budget style.");
  db.settings.budget_mode = body.mode;
  return ok;
};

// ---- recurring
function schedPayload(b) {
  const d = {};
  for (const k of ["kind", "name", "payee", "account_id", "to_account_id", "category_id", "frequency", "next_date", "day2", "end_date", "autopay", "is_subscription",
    "might_cancel", "notes", "person", "auto_record", "paused"]) if (k in b) d[k] = b[k];
  if ("amount" in b) d.amount = Math.abs(money(b.amount || 0));
  for (const k of ["account_id", "to_account_id", "category_id", "day2"]) if (k in d) d[k] = num(d[k]);
  return d;
}
H["POST scheduled"] = function ({ db, body }) {
  const d = schedPayload(body);
  if (!d.name || !d.next_date) throw new OfflineError("Give it a name and the next date.");
  const sid = this.newId("id");
  db.insert("scheduled", { id: sid, kind: "bill", payee: "", amount: 0, account_id: null, to_account_id: null, category_id: null, frequency: "monthly", day2: null,
    end_date: null, autopay: 0, is_subscription: 0, might_cancel: 0, last_amount: null, notes: "", person: "", auto_record: 0, paused: 0, is_demo: 0,
    created_at: nowStamp(), deleted_at: null, del_batch: null, ...d });
  return { id: sid };
};
H["PUT scheduled/{id}"] = function ({ db, id, body }) { const s = db.get("scheduled", id()); if (s) Object.assign(s, schedPayload(body)); return ok; };
H["DELETE scheduled/{id}"] = function ({ id }) { this.softDelete("scheduled", id(), batchId()); return ok; };
H["POST scheduled/{id}/record"] = function ({ db, id, body }) {
  const it = db.get("scheduled", id());
  if (!it) throw new OfflineError("That item no longer exists.");
  const amt = body.amount !== undefined && body.amount !== null && body.amount !== "" ? money(body.amount) : null;
  // ids for what gets made, in the same order the PC reports them
  const made = this.recordScheduled(it, amt, body.date);
  return { ok: true, txn_ids: made };
};
H["POST scheduled/{id}/skip"] = function ({ db, id }) {
  const it = db.get("scheduled", id());
  if (!it) return ok;
  const nxt = C.occurrences(it, addDays(it.next_date, 1), addDays(it.next_date, 800));
  if (it.frequency === "once" || !nxt.length) this.softDelete("scheduled", it.id, batchId());
  else it.next_date = nxt[0];
  return ok;
};
H["POST chores"] = function () { return { entered: this.autoRecordDue() }; };
H["POST dismiss"] = function ({ db, body }) { db.dismissed.push({ key: body.key }); return ok; };

// ---- holdings
H["POST holdings"] = function ({ db, body: d }) {
  const hid = this.newId("id");
  db.insert("holdings", { id: hid, account_id: Number(d.account_id), symbol: String(d.symbol || "").toUpperCase(), name: d.name || "",
    shares_milli: C.pyRound(Number(d.shares || 0) * 1000), price: money(d.price || 0), as_of: d.as_of || todayIso(), is_demo: 0, deleted_at: null, del_batch: null });
  return { id: hid };
};
H["PUT holdings/{id}"] = function ({ db, id, body: d }) {
  const h = db.get("holdings", id());
  if (!h) return ok;
  for (const k of ["symbol", "name", "as_of"]) if (k in d) h[k] = d[k];
  if ("shares" in d) h.shares_milli = C.pyRound(Number(d.shares || 0) * 1000);
  if ("price" in d) h.price = money(d.price || 0);
  return ok;
};
H["DELETE holdings/{id}"] = function ({ id }) { this.softDelete("holdings", id(), batchId()); return ok; };

// ---- deleted, history, settings, words, theme, people
H["POST deleted/restore"] = function ({ db, body }) {
  const row = db.get(body.table, body.id);
  if (!row) return { restored: 0 };
  const batch = row.del_batch;
  let n = 0;
  for (const t of ["accounts", "transactions", "categories", "category_groups", "rules", "scheduled", "holdings", "attachments", "people"]) {
    for (const r of db[t]) if ((batch ? r.del_batch === batch : (t === body.table && r.id === row.id)) && r.deleted_at) { r.deleted_at = null; r.del_batch = null; n++; }
  }
  return { restored: n };
};
H["POST history/{id}/revert"] = function () { nope("Undoing an older change from Edit History"); };
H["PUT settings"] = function ({ db, body }) {
  for (const k of ["intro_animation", "hover_seconds", "budget_mode", "intro_seen"]) if (k in body) db.settings[k] = body[k];
  if ("start_with_windows" in body) nope("Changing Start with Windows");
  return ok;
};
H["PUT words"] = function ({ db, body }) { if (body.text) db.words[body.key] = body.text; else delete db.words[body.key]; return ok; };
H["DELETE words"] = function ({ db, body }) { if (body.key) delete db.words[body.key]; else db.words = {}; return ok; };
H["PUT theme"] = function ({ db, body }) { const p = db.get("people", this.person?.id); if (p) p.theme = JSON.stringify(body.theme); return ok; };
H["PUT people/{id}"] = function ({ db, id, body }) { const p = db.get("people", id()); if (p) for (const k of ["name", "color"]) if (k in body) p[k] = body[k]; return ok; };
for (const k of ["POST people", "POST people/{id}/passcode", "POST backups", "POST backups/restore", "POST phone", "POST phone/code", "POST phone/signout-all",
  "DELETE phone/devices/{id}", "POST demo/start", "POST demo/load", "POST demo/clear", "POST setup", "POST quit"]) {
  H[k] = function () { nope("That"); };
}

// Which changes make new things, and where the PC reports their real ids
export const CHANGES_THAT_NEED_A_PC = new Set(["POST history/{id}/revert", "POST people", "POST people/{id}/passcode"]);
