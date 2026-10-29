// Home Bank's money engine, for phones working while the PC is off.
// This mirrors the PC's Python engine (homebank/*.py) so the numbers match.
// All money is integer cents. Dates are "YYYY-MM-DD" strings in local time.

// ---------------------------------------------------------------- small helpers
export const pyRound = (x) => {
  // Python's round(): halves go to the even number
  const f = Math.floor(x), d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
};
export const floorDiv = (a, b) => Math.floor(a / b);
const ceil = Math.ceil;

export function fmt(cents) {
  cents = Math.round(Number(cents || 0));
  const neg = cents < 0, a = Math.abs(cents);
  const s = "$" + Math.floor(a / 100).toLocaleString("en-US") + "." + String(a % 100).padStart(2, "0");
  return neg ? "-" + s : s;
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const pad = (n) => String(n).padStart(2, "0");
export const dayNum = (iso) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
export const fromDayNum = (n) => { const d = new Date(n * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
export const addDays = (iso, n) => fromDayNum(dayNum(iso) + n);
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export function addMonths(iso, n) {
  let [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  let mm = m - 1 + n;
  y += Math.floor(mm / 12);
  mm = ((mm % 12) + 12) % 12;
  return `${y}-${pad(mm + 1)}-${pad(Math.min(d, daysInMonth(y, mm + 1)))}`;
}
export const monthKey = (iso) => iso.slice(0, 7);
export const shiftMonth = (m, n) => addMonths(m + "-01", n).slice(0, 7);
export const monthEnd = (m) => addDays(addMonths(m + "-01", 1), -1);
export function monthsBetween(a, b) {
  const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
export const weekday = (iso) => (new Date(dayNum(iso) * 86400000).getUTCDay() + 6) % 7; // Monday = 0

export function toCents(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number" && Number.isInteger(value)) return value * 100;
  let s = String(value).trim();
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[,$\s]/g, "");
  if (s.endsWith("-")) { neg = !neg; s = s.slice(0, -1); }
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (s.toUpperCase().endsWith("CR")) s = s.slice(0, -2);
  else if (s.toUpperCase().endsWith("DR")) { neg = !neg; s = s.slice(0, -2); }
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") throw new Error(`Not a money amount: ${value}`);
  const [w, f = ""] = s.split(".");
  let cents = parseInt(w || "0", 10) * 100 + parseInt((f + "00").slice(0, 2), 10);
  if (f.length > 2 && Number(f[2]) >= 5) cents += 1;
  return neg ? -cents : cents;
}

export function median(arr) {
  const s = [...arr].sort((a, b) => a - b), n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// SQLite LIKE '%x%' (ASCII case-insensitive)
const likes = (hay, needle) => String(hay ?? "").toLowerCase().includes(String(needle).toLowerCase());
// sort helper that treats offline (negative) ids as the newest
export const idKey = (id) => (id < 0 ? 1e12 - id : id);

// ---------------------------------------------------------------- the data
export class Data {
  constructor(snapshot) {
    Object.assign(this, snapshot);
    for (const k of ["accounts", "category_groups", "categories", "assignments", "tags", "rules", "scheduled",
      "holdings", "attachments", "dismissed", "people", "transactions", "history", "keyslots"]) this[k] = this[k] || [];
    this.settings = this.settings || {};
    this.words = this.words || {};
    this.reindex();
  }
  reindex() {
    this.byId = {};
    for (const k of ["accounts", "category_groups", "categories", "tags", "rules", "scheduled", "holdings", "attachments", "people", "transactions"]) {
      const m = new Map();
      for (const r of this[k]) m.set(r.id, r);
      this.byId[k] = m;
    }
  }
  get(table, id) { return this.byId[table]?.get(Number(id)) || null; }
  insert(table, row) { this[table].push(row); this.byId[table]?.set(row.id, row); return row; }
  setting(k, d) { return this.settings[k] ?? d; }
}

// ---------------------------------------------------------------- accounts
export const ACCOUNT_TYPES = {
  checking: ["Checking", false, true, "Cash"], savings: ["Savings", false, true, "Cash"], cash: ["Cash (wallet)", false, true, "Cash"],
  credit: ["Credit card", true, true, "Credit cards"], loan: ["Loan (car, student, personal)", true, false, "Loans"],
  mortgage: ["Mortgage", true, false, "Loans"], investment: ["Investment", false, false, "Investments"],
  retirement: ["Retirement (401k, IRA)", false, false, "Investments"], hsa: ["HSA", false, false, "Investments"],
  house: ["House / property", false, false, "Property"], vehicle: ["Vehicle", false, false, "Property"],
  other_asset: ["Other thing we own", false, false, "Property"], other_debt: ["Other debt", true, false, "Loans"],
};
export const isLiability = (t) => !!ACCOUNT_TYPES[t]?.[1];
const liveTxns = (db) => db.transactions.filter((t) => !t.deleted_at);

export function accountBalances(db, asOf = null) {
  const sums = new Map();
  for (const t of db.transactions) {
    if (t.deleted_at || (asOf && t.date > asOf)) continue;
    let s = sums.get(t.account_id);
    if (!s) { s = { balance: 0, cleared: 0, pending: 0, txn_count: 0, last_txn: null }; sums.set(t.account_id, s); }
    s.balance += t.amount;
    if (t.status !== "pending") s.cleared += t.amount; else s.pending += t.amount;
    s.txn_count += 1;
    if (!s.last_txn || t.date > s.last_txn) s.last_txn = t.date;
  }
  const rows = db.accounts.filter((a) => !a.deleted_at).map((a) => {
    const s = sums.get(a.id) || { balance: 0, cleared: 0, pending: 0, txn_count: 0, last_txn: null };
    const meta = ACCOUNT_TYPES[a.type] || ["Other", false, false, "Other"];
    return { ...a, ...s, type_label: meta[0], liability: meta[1], group: meta[3], masked: a.last4 ? "••••" + a.last4 : "" };
  });
  rows.sort((x, y) => (x.closed - y.closed) || (x.sort - y.sort) || (idKey(x.id) - idKey(y.id)));
  return rows;
}
export function balanceOf(db, aid, asOf = null) {
  let b = 0;
  for (const t of db.transactions) if (!t.deleted_at && t.account_id === aid && (!asOf || t.date <= asOf)) b += t.amount;
  return b;
}

// ---------------------------------------------------------------- categories
export function listCategories(db) {
  const groups = db.category_groups.filter((g) => !g.deleted_at).sort((a, b) => (a.sort - b.sort) || (idKey(a.id) - idKey(b.id)));
  const cats = db.categories.filter((c) => !c.deleted_at).sort((a, b) => (a.sort - b.sort) || (idKey(a.id) - idKey(b.id)));
  return groups.map((g) => ({ ...g, categories: cats.filter((c) => c.group_id === g.id) }));
}
export const incomeCategoryId = (db) => db.categories.filter((c) => c.kind === "income" && !c.deleted_at).sort((a, b) => a.id - b.id)[0]?.id ?? null;

// ---------------------------------------------------------------- transactions
export function normalizePayee(p) {
  p = String(p || "").toUpperCase();
  p = p.replace(/(POS|DEBIT|PURCHASE|CHECKCARD|ACH|RECURRING|PAYMENT TO|SQ \*|TST\*|PP\*|PAYPAL \*)/g, " ");
  p = p.replace(/#?\d{3,}/g, " ");
  p = p.replace(/[^A-Z ]/g, " ");
  return p.replace(/\s+/g, " ").trim();
}

function isUncat(db, t, a) {
  return !t.transfer_txn_id && !t.is_valuation && a && a.on_budget && (t.import_source || "") !== "opening" &&
    !(a.type === "credit" && t.amount < 0 && /^interest/i.test(t.payee || "")) && t.splits.some((s) => s.category_id == null);
}

export function getTransactions(db, f = {}) {
  const accts = db.byId.accounts;
  let rows = db.transactions.filter((t) => !t.deleted_at && accts.has(t.account_id));
  if (f.account_id) rows = rows.filter((t) => t.account_id === Number(f.account_id));
  if (f.start) rows = rows.filter((t) => t.date >= f.start);
  if (f.end) rows = rows.filter((t) => t.date <= f.end);
  if (f.status) rows = rows.filter((t) => t.status === f.status);
  if (f.needs_review) rows = rows.filter((t) => t.needs_review);
  if (f.include_valuations === false) rows = rows.filter((t) => !t.is_valuation);
  if (f.txn_ids) { const set = new Set(f.txn_ids.map(Number)); rows = rows.filter((t) => set.has(t.id)); }
  if (f.category_id) rows = rows.filter((t) => t.splits.some((s) => s.category_id === Number(f.category_id)));
  if (f.uncategorized) rows = rows.filter((t) => isUncat(db, t, accts.get(t.account_id)));
  if (f.tag) {
    const ids = new Set(db.tags.filter((g) => g.name.toLowerCase() === String(f.tag).toLowerCase()).map((g) => g.id));
    rows = rows.filter((t) => t.tags.some((x) => ids.has(x)));
  }
  if (f.search) {
    const q = f.search.trim();
    let cents = 0;
    try { cents = Math.abs(toCents(q)); } catch { cents = 0; }
    rows = rows.filter((t) => likes(t.payee, q) || likes(t.notes, q) ||
      t.splits.some((s) => s.category_id != null && likes(db.get("categories", s.category_id)?.name, q)) ||
      (cents && Math.abs(t.amount) === cents));
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : idKey(b.id) - idKey(a.id)));
  const limit = f.limit ?? 500, offset = f.offset ?? 0;
  rows = rows.slice(offset, offset + limit);
  return rows.map((t) => decorate(db, t));
}

export function decorate(db, t) {
  const a = db.get("accounts", t.account_id) || {};
  const splits = t.splits.map((s) => {
    const c = s.category_id != null ? db.get("categories", s.category_id) : null;
    return { txn_id: t.id, category_id: s.category_id ?? null, amount: s.amount, memo: s.memo || "", category_name: c?.name ?? null, category_kind: c?.kind ?? null };
  });
  const tags = t.tags.map((id) => db.get("tags", id)).filter(Boolean).map((g) => ({ id: g.id, name: g.name, color: g.color }));
  const attachments = db.attachments.filter((x) => !x.deleted_at && x.txn_id === t.id).map((x) => ({ id: x.id, txn_id: x.txn_id, filename: x.filename }));
  let label = "";
  if (t.transfer_txn_id) label = "Transfer";
  else if (t.is_valuation) label = "Value update";
  else if (splits.length > 1) label = `Split (${splits.length})`;
  else if (splits.length && splits[0].category_name) label = splits[0].category_name;
  const { splits: _s, tags: _t, ...rest } = t;
  return { ...rest, account_name: a.name, account_type: a.type, on_budget: a.on_budget, splits, tags, attachments,
    category_label: label, category_id: splits.length === 1 ? splits[0].category_id : null };
}

export function runningBalances(db, accountId, rows) {
  if (!rows.length) return rows;
  const aid = Number(accountId);
  const total = balanceOf(db, aid);
  const top = rows[0];
  let newer = 0;
  for (const t of db.transactions) {
    if (t.deleted_at || t.account_id !== aid) continue;
    if (t.date > top.date || (t.date === top.date && idKey(t.id) > idKey(top.id))) newer += t.amount;
  }
  let bal = total - newer;
  for (const r of rows) { r.running = bal; bal -= r.amount; }
  return rows;
}

export function reconcileInfo(db, aid) {
  aid = Number(aid);
  let cleared = 0;
  const open = [];
  for (const t of db.transactions) {
    if (t.deleted_at || t.account_id !== aid) continue;
    if (t.status !== "pending") cleared += t.amount;
    if (t.status !== "reconciled") open.push({ id: t.id, date: t.date, payee: t.payee, amount: t.amount, status: t.status });
  }
  open.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : idKey(a.id) - idKey(b.id)));
  return { cleared_balance: cleared, open, last: db.settings[`reconciled_${aid}`] ?? null };
}

// ---------------------------------------------------------------- budget
class BudgetCalc {
  constructor(db) {
    this.db = db;
    this.accts = new Map(db.accounts.filter((a) => !a.deleted_at).map((a) => [a.id, a]));
    this.cats = new Map(db.categories.filter((c) => !c.deleted_at).map((c) => [c.id, c]));
    this.assigned = new Map();
    for (const r of db.assignments) {
      if (!this.assigned.has(r.category_id)) this.assigned.set(r.category_id, new Map());
      const m = this.assigned.get(r.category_id);
      m.set(r.month, (m.get(r.month) || 0) + r.amount);
    }
    const nest = () => new Map();
    const get2 = (map, a, b) => map.get(a)?.get(b) || 0;
    this.get2 = get2;
    this.income = new Map(); this.cash = nest(); this.card = nest(); this.cardBy = nest(); this.payments = nest();
    const add2 = (map, a, b, v) => { if (!map.has(a)) map.set(a, new Map()); const m = map.get(a); m.set(b, (m.get(b) || 0) + v); };
    this.uncategorized = 0;
    const payCat = new Map();
    for (const c of this.cats.values()) if (c.kind === "cc_payment") payCat.set(c.account_id, c.id);
    const incomeIds = new Set([...this.cats.values()].filter((c) => c.kind === "income").map((c) => c.id));
    const months = new Set();
    const txById = db.byId.transactions;
    const txs = [...db.transactions].filter((t) => !t.deleted_at).sort((a, b) => idKey(a.id) - idKey(b.id));
    for (const t of txs) {
      const a = this.accts.get(t.account_id);
      if (!a || !a.on_budget) continue;
      const m = t.date.slice(0, 7);
      const otherTxn = t.transfer_txn_id ? txById.get(t.transfer_txn_id) : null;
      const other = otherTxn ? this.accts.get(otherTxn.account_id) : null;
      for (const s of t.splits) {
        months.add(m);
        if (t.transfer_txn_id && other && other.on_budget) {
          if (a.type === "credit" && s.amount > 0 && payCat.has(a.id)) add2(this.payments, payCat.get(a.id), m, s.amount);
          continue;
        }
        const cid = s.category_id;
        if (cid == null || !this.cats.has(cid)) {
          if (!t.is_valuation) {
            if (a.type === "credit" && s.amount < 0) continue;
            this.uncategorized += 1;
          }
          continue;
        }
        if (incomeIds.has(cid)) { this.income.set(m, (this.income.get(m) || 0) + s.amount); continue; }
        if (a.type === "credit") {
          add2(this.card, cid, m, s.amount);
          if (!this.cardBy.has(cid)) this.cardBy.set(cid, new Map());
          const cm = this.cardBy.get(cid);
          if (!cm.has(m)) cm.set(m, new Map());
          const am = cm.get(m);
          am.set(a.id, (am.get(a.id) || 0) + s.amount);
        } else add2(this.cash, cid, m, s.amount);
      }
    }
    for (const mm of this.assigned.values()) for (const k of mm.keys()) months.add(k);
    months.add(monthKey(todayIso()));
    this.first = [...months].sort()[0];
    this.payCat = payCat;
    this.cache = new Map();
    this.overs = new Map();
  }
  monthsUpto(month) {
    let m = this.first < month ? this.first : month;
    const out = [];
    while (m <= month) { out.push(m); m = shiftMonth(m, 1); }
    return out;
  }
  compute(month) {
    if (this.cache.has(month)) return this.cache.get(month);
    const carry = new Map();
    let cashOverBefore = 0, assignedThrough = 0, incomeThrough = 0, result = null;
    const normal = [...this.cats.values()].filter((c) => c.kind === "normal");
    const paycats = [...this.cats.values()].filter((c) => c.kind === "cc_payment");
    const g2 = this.get2;
    for (const m of this.monthsUpto(month)) {
      const rows = new Map();
      const movedToPay = new Map();
      let cashOverThis = 0;
      for (const c of normal) {
        const cid = c.id;
        const A = this.assigned.get(cid)?.get(m) || 0, O = g2(this.cash, cid, m), K = g2(this.card, cid, m), C = carry.get(cid) || 0;
        const pre = C + A + O, spend = -K;
        const moved = spend > 0 ? Math.max(0, Math.min(spend, pre)) : spend;
        if (moved) {
          const by = this.cardBy.get(cid)?.get(m) || new Map();
          const items = [...by.entries()];
          const total = items.reduce((s, [, v]) => s - v, 0) || 1;
          let left = moved;
          items.forEach(([acct, v], i) => {
            const share = i === items.length - 1 ? left : pyRound((moved * -v) / total);
            left -= share;
            if (this.payCat.has(acct)) { const p = this.payCat.get(acct); movedToPay.set(p, (movedToPay.get(p) || 0) + share); }
          });
        }
        const available = pre + K;
        const cashOver = Math.max(0, -pre);
        const creditOver = spend > 0 ? Math.max(0, spend - Math.max(0, pre)) : 0;
        cashOverThis += cashOver;
        rows.set(cid, { assigned: A, activity: O + K, available, carry: C, cash_over: cashOver, credit_over: creditOver });
        carry.set(cid, Math.max(0, available));
      }
      for (const c of paycats) {
        const cid = c.id;
        const A = this.assigned.get(cid)?.get(m) || 0, C = carry.get(cid) || 0;
        const act = (movedToPay.get(cid) || 0) - g2(this.payments, cid, m);
        const available = C + A + act;
        const cashOver = Math.max(0, -available);
        cashOverThis += cashOver;
        rows.set(cid, { assigned: A, activity: act, available, carry: C, cash_over: cashOver, credit_over: 0 });
        carry.set(cid, Math.max(0, available));
      }
      incomeThrough += this.income.get(m) || 0;
      let assignedThis = 0;
      for (const r of rows.values()) assignedThis += r.assigned;
      assignedThrough += assignedThis;
      if (m === month) {
        let future = 0;
        for (const [cid, mm] of this.assigned) if (this.cats.has(cid)) for (const [k, v] of mm) if (k > month) future += v;
        result = { month: m, rows, ready_to_assign: incomeThrough - assignedThrough - future - cashOverBefore,
          income: this.income.get(m) || 0, assigned_total: assignedThis, overspent_last_month: this.overs.get(shiftMonth(m, -1)) || 0 };
      }
      cashOverBefore += cashOverThis;
      this.overs.set(m, cashOverThis);
    }
    this.cache.set(month, result);
    return result;
  }
}

export function goalInfo(cat, row, month) {
  const gt = cat.goal_type || "", G = Number(cat.goal_amount || 0);
  if (!gt || G <= 0) return null;
  const avail = row.available;
  const info = { type: gt, amount: G, date: cat.goal_date ?? null };
  if (gt === "monthly") {
    Object.assign(info, { needed: Math.max(0, G - row.assigned), progress: Math.min(1, row.assigned / G), done: row.assigned >= G, text: `Set aside ${fmt(G)} every month` });
  } else if (gt === "target_by_date" && cat.goal_date) {
    const goalM = cat.goal_date.slice(0, 7);
    const left = Math.max(1, monthsBetween(month, goalM) + 1);
    const start = row.carry;
    const per = G > start ? Math.max(0, ceil((G - start) / left)) : 0;
    Object.assign(info, { needed: Math.max(0, per - row.assigned), per_month: per, progress: Math.max(0, Math.min(1, avail / G)), done: avail >= G,
      months_left: left, text: `Save ${fmt(G)} by ${cat.goal_date} (${fmt(per)}/month)` });
  } else {
    Object.assign(info, { needed: 0, progress: Math.max(0, Math.min(1, avail / G)), done: avail >= G, text: `Build up to ${fmt(G)}` });
  }
  return info;
}

export function monthView(db, month = null) {
  month = month || monthKey(todayIso());
  const calc = new BudgetCalc(db);
  const data = calc.compute(month);
  const groups = listCategories(db);
  const totals = { assigned: 0, activity: 0, available: 0 };
  const overspent = [];
  let underfunded = 0;
  const outGroups = [];
  for (const g of groups) {
    if (g.kind === "income") continue;
    const cats = [];
    for (const c of g.categories) {
      const row = data.rows.get(c.id) || { assigned: 0, activity: 0, available: 0, carry: 0, cash_over: 0, credit_over: 0 };
      const goal = goalInfo(c, row, month);
      if (goal) underfunded += goal.needed;
      const item = { id: c.id, name: c.name, hidden: c.hidden, kind: c.kind, goal_type: c.goal_type, goal_amount: c.goal_amount,
        goal_date: c.goal_date ?? null, notes: c.notes, account_id: c.account_id ?? null, group_id: c.group_id, sort: c.sort, ...row, goal };
      if (row.available < 0) overspent.push({ id: c.id, name: c.name, amount: -row.available, credit: row.credit_over > 0 && row.cash_over === 0 });
      cats.push(item);
      if (!c.hidden) for (const k in totals) totals[k] += row[k];
    }
    const gt = { assigned: 0, activity: 0, available: 0 };
    for (const x of cats) if (!x.hidden) for (const k in gt) gt[k] += x[k];
    outGroups.push({ id: g.id, name: g.name, kind: g.kind, hidden: g.hidden, sort: g.sort, categories: cats, ...gt });
  }
  return { month, groups: outGroups, ready_to_assign: data.ready_to_assign, income: data.income, totals, overspent, underfunded,
    uncategorized: calc.uncategorized, prev: shiftMonth(month, -1), next: shiftMonth(month, 1), mode: db.setting("budget_mode", "zero") };
}

export function flexView(db, month = null) {
  const v = monthView(db, month);
  const fixedNames = new Set(["Bills"]), saving = new Set(["Savings Goals"]);
  const sum = (pred, k) => v.groups.filter(pred).reduce((s, g) => s + g[k], 0);
  const fixed = sum((g) => fixedNames.has(g.name), "assigned");
  const nonmonthly = sum((g) => saving.has(g.name), "assigned");
  const other = (g) => !fixedNames.has(g.name) && !saving.has(g.name) && g.kind === "normal";
  const flexBudget = sum(other, "assigned");
  const flexSpent = -sum(other, "activity");
  v.flex = { fixed, nonmonthly, flex_budget: flexBudget, flex_spent: flexSpent, flex_left: flexBudget - flexSpent };
  return v;
}

// ---------------------------------------------------------------- schedule, bills, forecast
export const FREQUENCIES = { weekly: "Every week", biweekly: "Every 2 weeks", semimonthly: "Twice a month", monthly: "Every month",
  quarterly: "Every 3 months", yearly: "Every year", once: "Just once" };

export function occurrences(item, start, end) {
  if (!item.next_date || item.paused) return [];
  let d = item.next_date;
  const stop = item.end_date || null;
  const freq = item.frequency || "monthly";
  const out = [];
  let n = 0;
  const anchor = d;
  while (d <= end && n < 1000) {
    if (stop && d > stop) break;
    if (d >= start) out.push(d);
    n += 1;
    if (freq === "once") break;
    else if (freq === "weekly") d = addDays(d, 7);
    else if (freq === "biweekly") d = addDays(d, 14);
    else if (freq === "semimonthly") {
      const day1 = Number(anchor.slice(8, 10));
      const day2 = Number(item.day2 || (day1 <= 13 ? day1 + 15 : 0) || 28);
      const [first, second] = [day1, Math.min(day2, 31)].sort((a, b) => a - b);
      const [y, m, dd] = d.split("-").map(Number);
      const last = daysInMonth(y, m);
      if (dd < Math.min(second, last)) d = `${y}-${pad(m)}-${pad(Math.min(second, last))}`;
      else {
        const nm = addMonths(`${y}-${pad(m)}-01`, 1);
        const [ny, nmo] = nm.split("-").map(Number);
        d = `${ny}-${pad(nmo)}-${pad(Math.min(first, daysInMonth(ny, nmo)))}`;
      }
    } else if (freq === "quarterly") d = addMonths(anchor, 3 * n);
    else if (freq === "yearly") d = addMonths(anchor, 12 * n);
    else d = addMonths(anchor, n);
  }
  return out;
}
export const signedAmount = (it) => (it.kind === "income" ? Math.abs(it.amount) : -Math.abs(it.amount));
export function monthlyEquivalent(it) {
  if (it.paused) return 0;
  const a = Math.abs(it.amount);
  return { weekly: floorDiv(a * 52, 12), biweekly: floorDiv(a * 26, 12), semimonthly: a * 2, monthly: a, quarterly: floorDiv(a, 3),
    yearly: floorDiv(a, 12), once: 0 }[it.frequency] ?? a;
}

export function listScheduled(db) {
  const t = todayIso();
  const rows = db.scheduled.filter((s) => !s.deleted_at).map((s) => ({
    ...s, account_name: db.get("accounts", s.account_id)?.name ?? null, category_name: db.get("categories", s.category_id)?.name ?? null,
    to_account_name: db.get("accounts", s.to_account_id)?.name ?? null,
  }));
  rows.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : (a.next_date || "") < (b.next_date || "") ? -1 : (a.next_date || "") > (b.next_date || "") ? 1 : 0));
  for (const r of rows) {
    r.frequency_label = FREQUENCIES[r.frequency] || r.frequency;
    r.monthly_cost = monthlyEquivalent(r);
    r.yearly_cost = r.monthly_cost * 12;
    const nxt = occurrences(r, t, addDays(t, 400));
    r.upcoming = nxt[0] || null;
    r.days_until = nxt.length ? dayNum(nxt[0]) - dayNum(t) : null;
  }
  return rows;
}

export function advancePast(db) {
  // Display only: moves past dates forward like the PC does. (Automatic entries are left for the PC to make.)
  const t = todayIso();
  for (const s of db.scheduled) {
    if (s.deleted_at || !s.next_date || s.next_date >= t || s.frequency === "once" || s.auto_record) continue;
    const nxt = occurrences(s, t, addDays(t, 800));
    if (nxt.length) s.next_date = nxt[0];
  }
}

function firstDate(s) {
  if (!s.next_date || s.frequency === "once") return s.next_date;
  let d = s.next_date;
  const step = { weekly: 7, biweekly: 14 }[s.frequency];
  const created = (s.created_at || d).slice(0, 10);
  const back = `${Number(created.slice(0, 4)) - 1}-${created.slice(5, 7)}-01`;
  if (step) { while (addDays(d, -step) >= back) d = addDays(d, -step); }
  else if (["monthly", "quarterly", "yearly"].includes(s.frequency)) {
    const n = { monthly: 1, quarterly: 3, yearly: 12 }[s.frequency];
    while (addMonths(d, -n) >= back) d = addMonths(d, -n);
  }
  return d;
}

export function calendarMonth(db, month) {
  const start = month + "-01", end = monthEnd(month);
  const days = {};
  for (const s of listScheduled(db)) {
    for (const d of occurrences({ ...s, next_date: firstDate(s) }, start, end)) {
      (days[d] ||= []).push({ id: s.id, name: s.name, kind: s.kind, amount: signedAmount(s), autopay: s.autopay, is_subscription: s.is_subscription });
    }
  }
  return { month, days, prev: shiftMonth(month, -1), next: shiftMonth(month, 1) };
}

export function dueSoon(db, days = 10) {
  return listScheduled(db).filter((s) => s.kind === "bill" && s.days_until !== null && s.days_until <= days)
    .map((s) => ({ id: s.id, name: s.name, amount: s.amount, date: s.upcoming, days: s.days_until, autopay: s.autopay }))
    .sort((a, b) => a.days - b.days);
}

export function detectRecurring(db, months = 13) {
  const since = addMonths(todayIso(), -months);
  const groups = new Map();
  const txs = liveTxns(db).filter((t) => !t.transfer_txn_id && !t.is_valuation && db.get("accounts", t.account_id)?.on_budget && t.date >= since)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const t of txs) {
    const name = normalizePayee(t.payee);
    if (!name) continue;
    const key = name + "|" + (t.amount > 0);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...t, category_id: t.splits[0]?.category_id ?? null });
  }
  const scheduled = new Set(db.scheduled.filter((s) => !s.deleted_at).map((s) => normalizePayee(s.payee || s.name)));
  const found = [];
  for (const [key, items] of groups) {
    if (items.length < 3) continue;
    const [name, isIncomeS] = key.split("|");
    const isIncome = isIncomeS === "true";
    const gaps = [];
    for (let i = 1; i < items.length; i++) { const g = dayNum(items[i].date) - dayNum(items[i - 1].date); if (g > 0) gaps.push(g); }
    if (gaps.length < 2) continue;
    const g = median(gaps);
    let freq = null;
    for (const [f, target, tol] of [["weekly", 7, 1], ["biweekly", 14, 2], ["semimonthly", 15, 2], ["monthly", 30.4, 4], ["quarterly", 91, 7], ["yearly", 365, 15]]) {
      if (Math.abs(g - target) <= tol) { freq = f; break; }
    }
    if (!freq) continue;
    const amts = items.map((i) => Math.abs(i.amount));
    const med = median(amts);
    const last3 = amts.slice(-3);
    if (med === 0 || (Math.max(...last3) - Math.min(...last3)) / med > 0.35) continue;
    const last = items[items.length - 1], prev = items[items.length - 2];
    let nxt = last.date;
    nxt = ["weekly", "biweekly", "semimonthly"].includes(freq) ? addDays(nxt, { weekly: 7, biweekly: 14, semimonthly: 15 }[freq]) : addMonths(nxt, { monthly: 1, quarterly: 3, yearly: 12 }[freq]);
    const inc = Math.abs(last.amount) - Math.abs(prev.amount);
    found.push({ payee: last.payee, kind: isIncome ? "income" : "bill", frequency: freq, frequency_label: FREQUENCIES[freq], amount: Math.abs(last.amount),
      count: items.length, account_id: last.account_id, category_id: last.category_id, next_date: nxt, already_scheduled: scheduled.has(name),
      price_increase: inc > 0 && inc * 100 >= Math.abs(prev.amount) ? inc : 0, previous_amount: Math.abs(prev.amount) });
  }
  found.sort((a, b) => (b.count - a.count) || (a.payee < b.payee ? -1 : a.payee > b.payee ? 1 : 0));
  return found;
}

export function priceAlerts(db) {
  const out = [];
  const dismissed = new Set(db.dismissed.map((d) => d.key ?? d));
  const recent = liveTxns(db).filter((t) => t.amount < 0 && !t.transfer_txn_id)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 400);
  for (const s of db.scheduled) {
    if (s.deleted_at || s.kind !== "bill") continue;
    const name = normalizePayee(s.payee || s.name);
    if (!name) continue;
    const hits = recent.filter((r) => normalizePayee(r.payee) === name).slice(0, 3);
    const fixed = (hits.length === 3 && hits[1].amount === hits[2].amount) || hits.length === 2;
    if (hits.length >= 2 && fixed && Math.abs(hits[0].amount) > Math.abs(hits[1].amount)) {
      const inc = Math.abs(hits[0].amount) - Math.abs(hits[1].amount);
      if (inc * 100 >= Math.abs(hits[1].amount)) {
        const key = `price:${s.id}:${hits[0].date}`;
        if (!dismissed.has(key)) out.push({ id: s.id, name: s.name, old: Math.abs(hits[1].amount), new: Math.abs(hits[0].amount), date: hits[0].date, key });
      }
    }
  }
  return out;
}

export function subscriptions(db) {
  const subs = listScheduled(db).filter((s) => s.kind === "bill" && s.is_subscription);
  for (const s of subs) s.reason = s.might_cancel ? "You marked this as one to think about." : "";
  return subs.sort((a, b) => (b.might_cancel - a.might_cancel) || (b.yearly_cost - a.yearly_cost));
}

export function forecast(db, days = 90) {
  const t = todayIso(), end = addDays(t, days);
  const accts = accountBalances(db).filter((a) => !a.closed && ["checking", "savings", "cash", "credit"].includes(a.type));
  const events = new Map();
  const push = (id, ev) => { if (!events.has(id)) events.set(id, []); events.get(id).push(ev); };
  for (const s of listScheduled(db)) {
    for (const d of occurrences(s, addDays(t, 1), end)) {
      const amt = Math.abs(s.amount);
      if (s.kind === "income") push(s.account_id, [d, amt, s.name]);
      else if (s.kind === "bill") push(s.account_id, [d, -amt, s.name]);
      else if (s.kind === "transfer") { push(s.account_id, [d, -amt, s.name]); if (s.to_account_id) push(s.to_account_id, [d, amt, s.name]); }
    }
  }
  const out = [];
  for (const a of accts) {
    let bal = a.balance;
    const series = [];
    const evs = (events.get(a.id) || []).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1]));
    let low = [bal, t], i = 0;
    for (let k = 0; k <= days; k++) {
      const d = addDays(t, k);
      while (i < evs.length && evs[i][0] <= d) { bal += evs[i][1]; i++; }
      series.push(bal);
      if (bal < low[0]) low = [bal, d];
    }
    const warnAt = a.type !== "credit" ? a.low_balance_warn : null;
    let warning = null;
    if (warnAt !== null && warnAt !== undefined) {
      for (let k = 0; k < series.length; k++) {
        if (series[k] < warnAt) { const d = addDays(t, k); warning = { date: d, balance: series[k], text: `${a.name} drops to ${fmt(series[k])} around ${d}.` }; break; }
      }
    }
    out.push({ id: a.id, name: a.name, type: a.type, start: a.balance, d30: series[Math.min(30, days)], d60: series[Math.min(60, days)], d90: series[Math.min(90, days)],
      low: low[0], low_date: low[1], series: series.filter((_, k) => k % 3 === 0), warning,
      events: evs.slice(0, 40).map((e) => ({ date: e[0], amount: e[1], name: e[2] })) });
  }
  return { start: t, days, accounts: out };
}

// ---------------------------------------------------------------- debt
export function debts(db) {
  return accountBalances(db).filter((a) => a.liability && a.balance < 0 && !a.closed)
    .map((a) => ({ id: a.id, name: a.name, type: a.type, balance: -a.balance, apr_bp: a.apr_bp, min_payment: a.min_payment, credit_limit: a.credit_limit }));
}

export function simulate(list, extra = 0, order = "avalanche", maxMonths = 600, startMonth = null) {
  startMonth = startMonth || monthKey(todayIso());
  const ds = list.filter((d) => d.balance > 0).map((d) => ({ ...d, bal: d.balance, interest: 0, paid_month: null }));
  if (!ds.length) return { months: 0, interest: 0, debts: [], payoff_month: startMonth, stuck: [] };
  let key;
  if (order === "snowball") key = (a, b) => (a.bal - b.bal) || (b.apr_bp - a.apr_bp);
  else if (order === "avalanche") key = (a, b) => (b.apr_bp - a.apr_bp) || (a.bal - b.bal);
  else key = () => 0;
  const minDue = (d) => {
    const i = pyRound((d.bal * d.apr_bp) / 10000 / 12);
    let m = d.min_payment;
    if (d.type === "credit") m = Math.max(m, i + floorDiv(d.bal, 100));
    return Math.min(d.bal + i, m);
  };
  const budget = ds.reduce((s, d) => s + minDue(d), 0) + (order !== "minimum" ? extra : 0);
  const startTotal = ds.reduce((s, d) => s + d.bal, 0);
  let month = 0, totalInt = 0;
  const stuck = ds.filter((d) => d.min_payment && d.type !== "credit" && d.min_payment <= pyRound((d.bal * d.apr_bp) / 10000 / 12)).map((d) => d.name);
  const timeline = [];
  while (ds.some((d) => d.bal > 0) && month < maxMonths) {
    month += 1;
    const dues = new Map();
    for (const d of ds) if (d.bal > 0) dues.set(d, minDue(d));
    for (const d of ds) {
      if (d.bal > 0) { const i = pyRound((d.bal * d.apr_bp) / 10000 / 12); d.bal += i; d.interest += i; totalInt += i; }
    }
    const dueSum = [...dues.values()].reduce((s, v) => s + v, 0);
    let left = order !== "minimum" ? Math.max(budget, dueSum) : dueSum;
    for (const d of ds) if (d.bal > 0) { const p = Math.min(d.bal, dues.get(d) || 0, left); d.bal -= p; left -= p; }
    if (order !== "minimum") {
      for (const d of ds.filter((x) => x.bal > 0).sort(key)) { if (left <= 0) break; const p = Math.min(d.bal, left); d.bal -= p; left -= p; }
    }
    for (const d of ds) if (d.bal <= 0 && d.paid_month === null) d.paid_month = shiftMonth(startMonth, month);
    timeline.push(ds.reduce((s, d) => s + Math.max(0, d.bal), 0));
    if (timeline[timeline.length - 1] > startTotal * 2) break;
  }
  const done = !ds.some((d) => d.bal > 0);
  const step = Math.max(1, floorDiv(timeline.length, 60));
  return {
    months: done ? month : null, interest: totalInt, payoff_month: done ? shiftMonth(startMonth, month) : null,
    debts: ds.map((d) => ({ id: d.id, name: d.name, paid_month: d.paid_month, interest: d.interest })),
    order: [...ds].sort((a, b) => ((a.paid_month || "9999") < (b.paid_month || "9999") ? -1 : (a.paid_month || "9999") > (b.paid_month || "9999") ? 1 : 0)).map((d) => d.name),
    timeline: timeline.filter((_, i) => i % step === 0), stuck,
  };
}

export function amortization(principal, aprBp, months = null, payment = null, start = null) {
  const r = aprBp / 10000 / 12;
  if (!payment) {
    if (!months) throw new Error("Give the loan length or the monthly payment.");
    payment = r ? pyRound((principal * r) / (1 - (1 + r) ** -months)) : -floorDiv(-principal, months);
  }
  let bal = principal, n = 0, totalInt = 0, m = start || monthKey(todayIso());
  const rows = [];
  while (bal > 0 && n < 720) {
    n += 1;
    const i = pyRound(bal * r);
    const p = Math.min(bal, payment - i);
    if (p <= 0) throw new Error("That payment does not cover the interest, so the loan would never be paid off.");
    bal -= p; totalInt += i;
    rows.push({ n, month: m, payment: p + i, interest: i, principal: p, balance: bal });
    m = shiftMonth(m, 1);
  }
  return { payment, months: n, total_interest: totalInt, rows };
}

// ---------------------------------------------------------------- net worth
export function netWorthSeries(db, months = 24) {
  const accts = db.accounts.filter((a) => !a.deleted_at);
  const live = liveTxns(db);
  const first = live.reduce((m, t) => (!m || t.date < m ? t.date : m), null);
  const cur = monthKey(todayIso());
  let start = shiftMonth(cur, -(months - 1));
  if (first && first.slice(0, 7) > start) start = first.slice(0, 7);
  const out = [];
  for (let m = start; m <= cur; m = shiftMonth(m, 1)) {
    const end = m !== cur ? monthEnd(m) : todayIso();
    const bals = new Map();
    for (const t of live) if (t.date <= end) bals.set(t.account_id, (bals.get(t.account_id) || 0) + t.amount);
    let assets = 0, debtsSum = 0;
    for (const a of accts) { const b = bals.get(a.id) || 0; assets += Math.max(0, b); debtsSum += -Math.min(0, b); }
    out.push({ month: m, assets, debts: debtsSum, net: assets - debtsSum });
  }
  return out;
}

export function netWorthNow(db) {
  const accts = accountBalances(db);
  let assets = 0, d = 0;
  for (const a of accts) {
    if (a.closed && a.balance === 0) continue;
    if (a.balance >= 0) assets += a.balance; else d += -a.balance;
  }
  const holdings = db.holdings.filter((h) => !h.deleted_at && db.get("accounts", h.account_id) && !db.get("accounts", h.account_id).deleted_at)
    .map((h) => ({ ...h, account_name: db.get("accounts", h.account_id).name, value: pyRound((h.shares_milli * h.price) / 1000) }))
    .sort((a, b) => (a.account_name < b.account_name ? -1 : a.account_name > b.account_name ? 1 : (a.symbol || "") < (b.symbol || "") ? -1 : 1));
  return { assets, debts: d, net: assets - d, accounts: accts, holdings };
}

// ---------------------------------------------------------------- reports
export function baseRows(db, start, end) {
  // mirrors reports.BASE: one row per split
  const out = [];
  for (const t of db.transactions) {
    if (t.deleted_at || t.is_valuation || t.date < start || t.date > end || (t.import_source || "") === "opening") continue;
    const a = db.get("accounts", t.account_id);
    if (!a) continue;
    for (const s of t.splits) {
      if (t.transfer_txn_id && s.category_id == null) continue;
      if (!a.on_budget && s.category_id == null) continue;
      const c = s.category_id != null ? db.get("categories", s.category_id) : null;
      const g = c ? db.get("category_groups", c.group_id) : null;
      out.push({ t, a, s, c, g });
    }
  }
  return out;
}

export function period(name, start, end) {
  const t = todayIso(), cur = monthKey(t), y = Number(t.slice(0, 4));
  if (name === "last_month") { const m = shiftMonth(cur, -1); return [m + "-01", monthEnd(m)]; }
  if (name === "this_year") return [`${y}-01-01`, t];
  if (name === "last_year") return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  if (name === "last_12") return [shiftMonth(cur, -11) + "-01", t];
  if (name === "custom" && start && end) return [start, end];
  return [cur + "-01", monthEnd(cur)];
}

export function spendingByCategory(db, start, end) {
  const byCat = new Map();
  for (const r of baseRows(db, start, end)) {
    const kind = r.c ? r.c.kind : "normal";
    if (kind !== "normal") continue;
    const key = r.c ? r.c.id : null;
    if (!byCat.has(key)) byCat.set(key, { id: key, name: r.c ? r.c.name : "No category", group_name: r.g ? r.g.name : "", out: 0, refund: 0 });
    const e = byCat.get(key);
    if (r.s.amount < 0) e.out += -r.s.amount; else if (r.s.amount > 0 && r.c) e.refund += r.s.amount;
  }
  const rows = [...byCat.values()].filter((e) => e.out > 0).map((e) => ({ id: e.id, name: e.name, group_name: e.group_name, amount: e.out - e.refund }))
    .filter((r) => r.amount > 0);
  rows.sort((a, b) => b.amount - a.amount);
  return rows;
}

export function spendingByPayee(db, start, end, limit = 50) {
  const m = new Map();
  for (const r of baseRows(db, start, end)) {
    if ((r.c ? r.c.kind : "normal") !== "normal" || !r.a.on_budget) continue;
    const e = m.get(r.t.payee) || { name: r.t.payee, spent: 0, ids: new Set() };
    e.spent += -r.s.amount; e.ids.add(r.t.id); m.set(r.t.payee, e);
  }
  return [...m.values()].filter((e) => e.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, limit)
    .map((e) => ({ name: e.name, spent: e.spent, count: e.ids.size }));
}

function sumKind(db, start, end, kind, catId = null) {
  let s = 0;
  for (const r of baseRows(db, start, end)) {
    if (catId != null) { if (r.s.category_id === catId) s += r.s.amount; }
    else if (r.c && r.c.kind === kind) s += r.s.amount;
  }
  return s;
}

export function incomeVsSpending(db, months = 12) {
  const cur = monthKey(todayIso());
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = shiftMonth(cur, -i), s = m + "-01", e = monthEnd(m);
    const inc = sumKind(db, s, e, "income"), spent = -sumKind(db, s, e, "normal");
    out.push({ month: m, income: inc, spending: spent, saved: inc - spent });
  }
  return out;
}

export function trends(db, categoryId = null, months = 12) {
  const cur = monthKey(todayIso());
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = shiftMonth(cur, -i), ly = shiftMonth(m, -12);
    out.push({ month: m, amount: -sumKind(db, m + "-01", monthEnd(m), "normal", categoryId), last_year: -sumKind(db, ly + "-01", monthEnd(ly), "normal", categoryId) });
  }
  return out;
}

export function byMonthTable(db, start, end) {
  const table = new Map();
  const monthsSet = new Set();
  for (const r of baseRows(db, start, end)) {
    if ((r.c ? r.c.kind : "normal") !== "normal") continue;
    const m = r.t.date.slice(0, 7);
    monthsSet.add(m);
    const name = r.c ? r.c.name : "No category";
    if (!table.has(name)) table.set(name, new Map());
    const row = table.get(name);
    row.set(m, (row.get(m) || 0) - r.s.amount);
  }
  const months = [...monthsSet].sort();
  const lines = [...table.entries()].map(([name, v]) => ({ name, values: months.map((m) => v.get(m) || 0), total: [...v.values()].reduce((a, b) => a + b, 0) }));
  lines.sort((a, b) => b.total - a.total);
  return { months, rows: lines };
}

export function taxReport(db, year) {
  const s = `${year}-01-01`, e = `${year}-12-31`;
  const byKind = new Map();
  const seen = new Set();
  const rows = baseRows(db, s, e).filter((r) => r.c && r.c.tax_kind).sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : 0));
  for (const r of rows) {
    const item = { id: r.t.id, date: r.t.date, payee: r.t.payee, amount: -r.s.amount, category: r.c.name, tax_kind: r.c.tax_kind, account: r.a.name };
    if (!byKind.has(item.tax_kind)) byKind.set(item.tax_kind, []);
    byKind.get(item.tax_kind).push(item);
    seen.add(item.id + "|" + item.tax_kind);
  }
  const tagged = [];
  for (const t of liveTxns(db)) {
    if (t.date < s || t.date > e) continue;
    for (const tid of t.tags) {
      const g = db.get("tags", tid);
      if (g && g.tax_kind) tagged.push({ id: t.id, date: t.date, payee: t.payee, amount: -t.amount, tag: g.name, tax_kind: g.tax_kind, account: db.get("accounts", t.account_id)?.name });
    }
  }
  tagged.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const r of tagged) {
    if (!seen.has(r.id + "|" + r.tax_kind)) {
      r.category = "Tag: " + r.tag;
      if (!byKind.has(r.tax_kind)) byKind.set(r.tax_kind, []);
      byKind.get(r.tax_kind).push(r);
    }
  }
  const labels = { charitable: "Charitable giving", medical: "Medical", hsa: "HSA contributions", deductible: "Other tax-deductible" };
  const sections = ["charitable", "medical", "hsa", "deductible"].map((k) => {
    const items = byKind.get(k) || [];
    return { kind: k, label: labels[k], items, total: items.reduce((a, b) => a + b.amount, 0) };
  });
  return { year, sections, income: sumKind(db, s, e, "income") };
}

// ---------------------------------------------------------------- rules
export function ruleMatches(rule, payee) {
  const p = String(payee || "").toLowerCase(), t = String(rule.match_text || "").toLowerCase();
  if (!t) return false;
  if (rule.match_type === "exact") return p.trim() === t.trim();
  if (rule.match_type === "starts") return p.startsWith(t);
  if (rule.match_type === "regex") { try { return new RegExp(rule.match_text, "i").test(payee || ""); } catch { return false; } }
  return p.includes(t);
}
