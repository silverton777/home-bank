// Made-up demo data for showing Home Bank to others. No real names, banks or numbers.
// Built fresh in memory each time; it is never saved and never mixed with your real data.
import * as C from "./calc.js";
import { Engine } from "./engine.js";
import SEED from "./seed.js";

const { todayIso, monthKey, shiftMonth, addMonths, addDays } = C;

function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { random: next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), choice: (arr) => arr[Math.floor(next() * arr.length)] };
}
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function buildDemo(people) {
  let n = 0;
  const e = new Engine(structuredClone(SEED), people[0] || { id: 1, name: "Demo" }, () => ++n + 1000);
  const db = e.db;
  db.people = people.map((p) => ({ ...p }));
  const R = rng(7);
  const t = todayIso();
  const months = 7;
  const start = addMonths(monthKey(t) + "-01", -(months - 1));
  const acct = (name, type, balance, extra = {}) =>
    e.run("POST", "/api/accounts", {}, { name, type, balance, opening_date: start, ...extra }).id;
  const chk = acct("Demo Joint Checking", "checking", 284000, { institution: "Maple Street Bank", last4: "4821" });
  const sav = acct("Demo Savings", "savings", 640000, { institution: "Maple Street Bank", last4: "9910" });
  const visa = acct("Demo Rewards Card", "credit", -184250, { institution: "Bluebird Card Co.", last4: "3307", apr: 23.99, min_payment: 5500, credit_limit: 1200000 });
  const storeCard = acct("Demo Store Card", "credit", -62000, { institution: "Corner Store Credit", last4: "7742", apr: 27.99, min_payment: 3500, credit_limit: 300000 });
  const carLoan = acct("Demo Car Loan", "loan", -1435000, { institution: "Riverbend Credit Union", last4: "1150", apr: 6.49, min_payment: 38500 });
  const student = acct("Demo Student Loan", "loan", -924000, { institution: "Lakeside Loans", last4: "6620", apr: 4.95, min_payment: 21000 });
  const mort = acct("Demo Mortgage", "mortgage", -21850000, { institution: "Hillcrest Home Loans", last4: "0042", apr: 3.75, min_payment: 148000 });
  acct("Demo House", "house", 31500000);
  acct("Demo Minivan", "vehicle", 1980000);
  const k401 = acct("Demo 401(k)", "retirement", 6420000, { institution: "Oakline Investments", last4: "5531" });
  acct("Demo HSA", "hsa", 315000);
  db.reindex();

  const inc = C.incomeCategoryId(db);
  const cat = (name) => db.categories.find((c) => !c.deleted_at && c.name.toLowerCase() === name.toLowerCase())?.id ?? null;
  const tx = (account_id, date, payee, amount, category_id = null, status = "cleared", tags = []) => {
    if (date > t) return;
    const id = e.addTxn({ account_id, date, payee, amount, category_id, status, tags });
    const row = db.transactions[db.transactions.length - 1];
    if (row && row.id === id) row.original_payee = payee.toUpperCase();
    db.reindex();
  };
  const transfer = (from, to, amount, date, category = null) => { if (date <= t) { e.transfer(from, to, amount, date, "", category); db.reindex(); } };

  const plan = { "Rent / Mortgage": 148000, Electric: 15000, "Water & Sewer": 6000, Internet: 8000, Phones: 12600, Insurance: 21400, Groceries: 95000,
    "Eating Out": 25000, "Gas (car)": 22000, Household: 9000, "Personal Care": 5000, Kids: 22000, Pets: 6000, "Emergency Fund": 50000, Vacation: 30000,
    "Car Repairs": 10000, "Gifts & Holidays": 15000, Entertainment: 8000, Subscriptions: 3500, Medical: 6000, "Charitable Giving": 5000,
    "Interest & Fees": 4000, Hobbies: 6000, "Home Repairs": 10000, "Fun Money - Partner 1": 7500, "Fun Money - Partner 2": 7500,
    "Car Payment": 38500, "Student Loan Payment": 21000 };
  const cur = monthKey(t);
  for (let m = start.slice(0, 7); m <= cur; m = shiftMonth(m, 1)) {
    const [y, mo] = m.split("-").map(Number);
    const dim = C.daysInMonth(y, mo);
    for (let d = 1; d <= dim; d++) {
      const day = iso(y, mo, d);
      if (C.weekday(day) === 4 && ((C.dayNum(day) - C.dayNum("2024-01-05")) % 14 + 14) % 14 === 0) tx(chk, day, "Northwind Logistics Payroll", 198500, inc);
      if (d === 15 || d === dim) tx(chk, day, "Brightside Clinic Payroll", 164000, inc);
    }
    const D = (d) => iso(y, mo, d);
    transfer(chk, mort, 148000, D(1), cat("Rent / Mortgage"));
    tx(chk, D(3), "City Power & Light", -R.int(9800, 16400), cat("Electric"));
    tx(chk, D(6), "Valley Water Dept", -R.int(4200, 6100), cat("Water & Sewer"));
    tx(visa, D(9), "Fastlane Internet", -7999, cat("Internet"));
    tx(visa, D(12), "Skyline Mobile", -(m < shiftMonth(cur, -1) ? 11800 : 12600), cat("Phones"));
    tx(chk, D(20), "Guardian Mutual Insurance", -21400, cat("Insurance"));
    tx(visa, D(14), "StreamBox", -(m < shiftMonth(cur, -2) ? 1599 : 1799), cat("Subscriptions"));
    tx(visa, D(18), "TuneWave Music", -1199, cat("Subscriptions"));
    tx(storeCard, D(22), "CloudVault Storage", -299, cat("Subscriptions"));
    tx(chk, D(25), "Neighborhood Food Pantry", -5000, cat("Charitable Giving"), "cleared", ["Charitable"]);
    for (let i = R.int(7, 10); i > 0; i--) tx(visa, D(R.int(1, 28)), R.choice(["FreshMart Grocery", "Green Basket Market", "Bulk Barn Club"]), -R.int(4200, 18800), cat("Groceries"));
    for (let i = R.int(4, 8); i > 0; i--) tx(visa, D(R.int(1, 28)), R.choice(["Taco Corner", "Pizza Palace", "Morning Brew Cafe", "Noodle House", "Burger Barn"]), -R.int(1200, 7800), cat("Eating Out"));
    for (let i = R.int(3, 5); i > 0; i--) tx(visa, D(R.int(1, 28)), R.choice(["QuickFuel #2231", "Speedy Gas"]), -R.int(3800, 6400), cat("Gas (car)"));
    for (let i = R.int(1, 3); i > 0; i--) tx(storeCard, D(R.int(1, 28)), "HomeGoods Depot", -R.int(1500, 9000), cat("Household"));
    tx(visa, D(R.int(1, 28)), "Paws & Claws Pet Supply", -R.int(2500, 6000), cat("Pets"));
    tx(chk, D(R.int(1, 28)), "Little Sprouts Daycare", -20000, cat("Kids"));
    if (R.random() < 0.5) tx(visa, D(R.int(1, 28)), "Family Health Pharmacy", -R.int(1500, 8000), cat("Medical"), "cleared", ["Medical"]);
    if (R.random() < 0.6) tx(visa, D(R.int(1, 28)), "Cinema Twelve", -R.int(2400, 5200), cat("Entertainment"));
    if (D(28) <= t) {
      transfer(chk, sav, 40000, D(16));
      transfer(chk, visa, R.int(150000, 210000), D(28));
      transfer(chk, storeCard, 12000, D(21));
      transfer(chk, carLoan, 38500, D(10), cat("Car Payment"));
      transfer(chk, student, 21000, D(11), cat("Student Loan Payment"));
      tx(carLoan, D(10), "Interest charged", -7600);
      tx(student, D(11), "Interest charged", -3700);
      tx(mort, D(1), "Interest charged", -68000);
      tx(visa, D(27), "Interest charge", -R.int(2800, 3900), cat("Interest & Fees"));
      tx(k401, D(28), "Contributions and growth", R.int(60000, 140000));
    }
    for (const [name, amt] of Object.entries(plan)) {
      const cid = cat(name);
      if (cid) e.setAssigned(cid, m, amt + (m !== cur ? R.choice([-1, 0, 1]) * 1000 : 0));
    }
  }
  db.reindex();
  const first = start.slice(0, 7);
  const extra = C.monthView(db, cur).ready_to_assign - 35000;
  if (extra > 0) e.setAssigned(cat("Emergency Fund"), first, e.getAssigned(cat("Emergency Fund"), first) + extra);
  tx(visa, addDays(t, -1), "ACME ONLINE MARKETPLACE", -4399, null, "pending");
  tx(chk, addDays(t, -2), "Venmo Cashout", 6500, null);
  for (const x of db.transactions) {
    if (!x.transfer_txn_id && !x.is_valuation && x.payee !== "Starting balance" && !/^(Interest|Contrib)/.test(x.payee) && x.splits.some((s) => s.category_id == null)) {
      const a = db.get("accounts", x.account_id);
      if (a && a.on_budget) x.needs_review = 1;
    }
  }
  const goal = (name, type, amount, date) => { const c = db.get("categories", cat(name)); Object.assign(c, { goal_type: type, goal_amount: amount, goal_date: date }); };
  goal("Emergency Fund", "target_balance", 1500000, null);
  goal("Vacation", "target_by_date", 360000, addMonths(t, 8));
  goal("Car Repairs", "monthly", 10000, null);
  goal("Gifts & Holidays", "target_by_date", 120000, `${t.slice(0, 4)}-12-15`);
  goal("Home Repairs", "target_balance", 500000, null);

  const nextDay = (day) => { const d = `${t.slice(0, 8)}${String(Math.min(day, 28)).padStart(2, "0")}`; return d > t ? d : addMonths(d, 1); };
  let nf = addDays(t, ((4 - C.weekday(t) + 7) % 7) || 7);
  if (((C.dayNum(nf) - C.dayNum("2024-01-05")) % 14 + 14) % 14) nf = addDays(nf, 7);
  const ym = t.slice(0, 7), dd = Number(t.slice(8, 10));
  const semi = dd < 15 ? `${ym}-15` : addDays(addMonths(ym + "-01", 1), -1);
  const sched = [
    ["income", "Partner 1 paycheck", "Northwind Logistics Payroll", 198500, chk, null, "biweekly", nf, null, 0, 0],
    ["income", "Partner 2 paycheck", "Brightside Clinic Payroll", 164000, chk, null, "semimonthly", semi, 31, 0, 0],
    ["bill", "Mortgage", "Hillcrest Home Loans", 148000, chk, cat("Rent / Mortgage"), "monthly", addMonths(ym + "-01", 1), null, 1, 0],
    ["bill", "Electric", "City Power & Light", 13000, chk, cat("Electric"), "monthly", nextDay(3), null, 1, 0],
    ["bill", "Water", "Valley Water Dept", 5200, chk, cat("Water & Sewer"), "monthly", nextDay(6), null, 0, 0],
    ["bill", "Internet", "Fastlane Internet", 7999, visa, cat("Internet"), "monthly", nextDay(9), null, 1, 1],
    ["bill", "Phones", "Skyline Mobile", 12600, visa, cat("Phones"), "monthly", nextDay(12), null, 1, 0],
    ["bill", "Car insurance", "Guardian Mutual Insurance", 21400, chk, cat("Insurance"), "monthly", nextDay(20), null, 1, 0],
    ["bill", "StreamBox", "StreamBox", 1799, visa, cat("Subscriptions"), "monthly", nextDay(14), null, 1, 1],
    ["bill", "TuneWave Music", "TuneWave Music", 1199, visa, cat("Subscriptions"), "monthly", nextDay(18), null, 1, 1],
    ["bill", "CloudVault Storage", "CloudVault Storage", 299, storeCard, cat("Subscriptions"), "monthly", nextDay(22), null, 1, 1],
    ["bill", "Daycare", "Little Sprouts Daycare", 20000, chk, cat("Kids"), "monthly", nextDay(15), null, 0, 0],
  ];
  for (const [kind, name, payee, amount, account_id, category_id, frequency, next_date, day2, autopay, is_subscription] of sched)
    e.run("POST", "/api/scheduled", {}, { kind, name, payee, amount, account_id, category_id, frequency, next_date, day2, autopay, is_subscription, might_cancel: name === "CloudVault Storage" ? 1 : 0 });
  e.run("POST", "/api/scheduled", {}, { kind: "transfer", name: "Move to savings", amount: 40000, account_id: chk, to_account_id: sav, frequency: "monthly", next_date: nextDay(16) });
  for (const [text, rename, c] of [["QUICKFUEL", "QuickFuel", "Gas (car)"], ["FRESHMART", "FreshMart Grocery", "Groceries"], ["TACO", "", "Eating Out"]])
    e.run("POST", "/api/rules", {}, { match_type: "contains", match_text: text, rename_to: rename, category_id: cat(c) });
  e.run("POST", "/api/holdings", {}, { account_id: k401, symbol: "TOTALMKT", name: "Demo Total Market Fund", shares: 412.5, price: 124.55, as_of: t });
  e.run("POST", "/api/holdings", {}, { account_id: k401, symbol: "BONDIDX", name: "Demo Bond Index Fund", shares: 300, price: 43.8, as_of: t });
  db.history = [];
  db.settings.demo_loaded = true;
  db.reindex();
  return db;
}
