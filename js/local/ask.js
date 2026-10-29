// Ask My Money: plain-English questions answered from your own data, on the phone. Nothing is sent anywhere.
import * as C from "./calc.js";

const { fmt, todayIso, monthKey, shiftMonth, monthEnd, addDays } = C;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export const EXAMPLES = [
  "How much did we spend eating out last month?",
  "How much did we spend at Target this year?",
  "What did we spend in September?",
  "How much is left in Groceries?",
  "What's our net worth?",
  "How much do we owe?",
  "Biggest expenses last month",
  "How much did we make this year?",
  "What bills are due this week?",
  "How much is in checking?",
  "How much is ready to assign?",
];

function parsePeriod(q) {
  const t = todayIso(), cur = monthKey(t), y = Number(t.slice(0, 4)), mon = Number(t.slice(5, 7));
  const wd = C.weekday(t);
  if (q.includes("last month")) { const m = shiftMonth(cur, -1); return [m + "-01", monthEnd(m), "last month"]; }
  if (q.includes("this month")) return [cur + "-01", t, "this month"];
  if (q.includes("last year")) return [`${y - 1}-01-01`, `${y - 1}-12-31`, "last year"];
  if (["this year", "so far", "year to date", "ytd"].some((k) => q.includes(k))) return [`${y}-01-01`, t, "this year"];
  if (q.includes("last week")) { const s = addDays(t, -(wd + 7)); return [s, addDays(s, 6), "last week"]; }
  if (q.includes("this week")) return [addDays(t, -wd), t, "this week"];
  if (q.includes("today")) return [t, t, "today"];
  if (q.includes("yesterday")) { const d = addDays(t, -1); return [d, d, "yesterday"]; }
  let m = /last (\d+) (day|week|month)s?/.exec(q);
  if (m) { const n = Number(m[1]); return [addDays(t, -n * { day: 1, week: 7, month: 30 }[m[2]]), t, `the last ${n} ${m[2]}s`]; }
  for (let i = 0; i < 12; i++) {
    const name = MONTHS[i];
    if (new RegExp(`\\b${name}\\b|\\b${name.slice(0, 3)}\\b`).test(q)) {
      const ym = /\b(20\d\d)\b/.exec(q);
      const year = ym ? Number(ym[1]) : (i + 1 <= mon ? y : y - 1);
      const mk = `${year}-${String(i + 1).padStart(2, "0")}`;
      return [mk + "-01", monthEnd(mk), `${name[0].toUpperCase()}${name.slice(1)} ${year}`];
    }
  }
  m = /\b(?:in )?(20\d\d)\b/.exec(q);
  if (m) return [`${m[1]}-01-01`, `${m[1]}-12-31`, m[1]];
  return [cur + "-01", t, "this month"];
}

function matchThing(db, phrase) {
  phrase = phrase.replace(/^[\s?.!]+|[\s?.!]+$/g, "").toLowerCase().replace(/^(the|our|my|on|at|for|in)\s+/, "");
  if (!phrase) return null;
  const aliases = { "eating out": "eating out", restaurants: "eating out", dining: "eating out", food: "groceries", gas: "gas (car)", fuel: "gas (car)", subscriptions: "subscriptions" };
  phrase = aliases[phrase] || phrase;
  for (const c of db.categories) if (!c.deleted_at && (c.name.toLowerCase() === phrase || c.name.toLowerCase().includes(phrase))) return ["category", c.id, c.name];
  for (const g of db.category_groups) if (!g.deleted_at && g.name.toLowerCase().includes(phrase)) return ["group", g.id, g.name];
  for (const tg of db.tags) if (tg.name.toLowerCase().includes(phrase)) return ["tag", tg.id, tg.name];
  const counts = new Map();
  for (const t of db.transactions) if (!t.deleted_at && (t.payee || "").toLowerCase().includes(phrase)) counts.set(t.payee, (counts.get(t.payee) || 0) + 1);
  if (counts.size) return ["payee", phrase, [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]];
  return null;
}

function spent(db, kind, ref, start, end) {
  let s = 0;
  if (kind === "tag") {
    for (const t of db.transactions) if (!t.deleted_at && t.date >= start && t.date <= end && t.tags.includes(ref)) s += t.amount;
    return -s;
  }
  for (const r of C.baseRows(db, start, end)) {
    if (kind === "category" && r.s.category_id === ref) s += r.s.amount;
    else if (kind === "group" && r.c && r.c.group_id === ref) s += r.s.amount;
    else if (kind === "payee" && (r.t.payee || "").toLowerCase().includes(ref) && (r.c ? r.c.kind : "normal") === "normal") s += r.s.amount;
    else if (kind === "all" && r.c && r.c.kind === "normal") s += r.s.amount;
  }
  return -s;
}

function answerOffline(db, question) {
  const q = question.toLowerCase().trim();
  const [start, end, label] = parsePeriod(q);
  if (q.includes("net worth") || q.includes("worth")) {
    const nw = C.netWorthNow(db);
    return { answer: `Your net worth is ${fmt(nw.net)}: you own ${fmt(nw.assets)} and owe ${fmt(nw.debts)}.` };
  }
  if (/\b(owe|debt|debts)\b/.test(q)) {
    const ds = C.debts(db);
    const total = ds.reduce((s, d) => s + d.balance, 0);
    return { answer: `You owe ${fmt(total)} across ${ds.length} debts.`, table: [...ds].sort((a, b) => b.balance - a.balance).map((d) => [d.name, fmt(d.balance)]) };
  }
  if (["ready to assign", "unassigned", "to budget"].some((k) => q.includes(k))) return { answer: `${fmt(C.monthView(db).ready_to_assign)} is ready to assign this month.` };
  let m = /(?:left|remaining|available) (?:in|for) (.+)/.exec(q) || /how much (?:do we|do i|is) (?:have )?left (?:in|for) (.+)/.exec(q);
  if (m) {
    const th = matchThing(db, m[1]);
    if (th && th[0] === "category") {
      for (const g of C.monthView(db).groups) for (const c of g.categories) if (c.id === th[1])
        return { answer: `${th[2]} has ${fmt(c.available)} left this month (assigned ${fmt(c.assigned)}, spent ${fmt(-c.activity)}).` };
    }
  }
  if (/(bills?|due)/.test(q) && !q.includes("spend")) {
    const days = q.includes("week") ? 7 : q.includes("month") ? 31 : 14;
    const due = C.dueSoon(db, days);
    if (!due.length) return { answer: `No bills are due in the next ${days} days.` };
    return { answer: `${due.length} bills are due in the next ${days} days, totalling ${fmt(due.reduce((s, d) => s + d.amount, 0))}.`, table: due.map((d) => [d.date, d.name, fmt(d.amount)]) };
  }
  if (/\b(earn|earned|make|made|income|paid us|paychecks?)\b/.test(q)) {
    let inc = 0;
    for (const r of C.baseRows(db, start, end)) if (r.c && r.c.kind === "income") inc += r.s.amount;
    return { answer: `You brought in ${fmt(inc)} ${label}.` };
  }
  if (/(biggest|largest|top) (expenses|spending|purchases|categories)/.test(q) || q.includes("where did")) {
    const rows = C.spendingByCategory(db, start, end).slice(0, 8);
    if (!rows.length) return { answer: `I don't see any spending ${label}.` };
    return { answer: `Here is where the money went ${label}:`, table: rows.map((r) => [r.name, fmt(r.amount)]) };
  }
  m = /\b(?:spend|spent|spending|cost|pay|paid)\b(?: (?:on|at|for|in))? (.+)/.exec(q);
  if (m || /\b(spend|spent|spending)\b/.test(q)) {
    let rest = m ? m[1] : "";
    rest = rest.replace(/\b(last|this|in|so far|year to date|ytd|today|yesterday)\b.*$/, "").trim();
    rest = rest.replace(new RegExp(`\\b(${MONTHS.join("|")})\\b.*$`), "").trim();
    const th = rest ? matchThing(db, rest) : null;
    if (rest && !th) return null;
    const amt = spent(db, th ? th[0] : "all", th ? th[1] : null, start, end);
    const what = th && th[0] !== "payee" ? `on ${th[2]}` : th ? `at ${th[2]}` : "in total";
    const when = /^(this|last|the|today|yesterday)/.test(label) ? label : `in ${label}`;
    return { answer: `You spent ${fmt(amt)} ${what} ${when}.` };
  }
  m = /(?:balance (?:of|in)|how much (?:is|money is|do we have) in) (.+)/.exec(q);
  if (m) {
    const name = m[1].replace(/[\s?]+$/, "").trim();
    for (const a of C.accountBalances(db)) if (a.name.toLowerCase().includes(name) || a.type.includes(name)) return { answer: `${a.name} has a balance of ${fmt(a.balance)}.` };
  }
  return null;
}

export function answer(db, question) {
  let res = null;
  try { res = answerOffline(db, question || ""); } catch { res = null; }
  if (res) return { ...res, source: "built-in" };
  return { answer: "I don't know how to answer that one yet. Try asking it like one of the examples below.", source: "none", examples: EXAMPLES };
}
