// Bring in bank files on the phone: CSV, OFX, QFX and QIF.
// Mirrors the PC version: CSV columns are mapped once per bank (remembered by the column headings),
// and every import is checked for duplicates and transfers before anything is saved.
import * as C from "./calc.js";

const GUESS = {
  date: ["posting date", "post date", "posted date", "transaction date", "trans. date", "date"],
  payee: ["description", "payee", "merchant", "name", "transaction description", "details"],
  amount: ["amount", "transaction amount", "amt"],
  debit: ["debit", "withdrawal", "withdrawals", "money out", "debit amount", "charges"],
  credit: ["credit", "deposit", "deposits", "money in", "credit amount", "payments"],
  memo: ["memo", "notes", "note", "category", "type"],
  status: ["status"],
  id: ["transaction id", "reference", "ref", "fitid", "id"],
};

// ---------------------------------------------------------------- text
export function decode(bytes) {
  const tries = [["utf-8", true], ["utf-16le", true], ["windows-1252", false]];
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  for (const [enc, fatal] of tries) {
    try {
      const t = new TextDecoder(enc, { fatal }).decode(bytes);
      if (enc === "utf-16le" && !/[\x20-\x7e]{4}/.test(t)) continue;
      return t.replace(/^﻿/, "");
    } catch { /* next */ }
  }
  return new TextDecoder("latin1").decode(bytes);
}

export function sniffKind(filename, text) {
  const name = (filename || "").toLowerCase(), head = text.slice(0, 2000).toUpperCase();
  if (/\.(ofx|qfx)$/.test(name) || head.includes("<OFX") || head.includes("OFXHEADER")) return "ofx";
  if (name.endsWith(".qif") || /^\s*!(TYPE|ACCOUNT)/.test(head)) return "qif";
  return "csv";
}

// ---------------------------------------------------------------- dates
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const p2 = (n) => String(n).padStart(2, "0");
function ymd(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= C.daysInMonth(y, m))) return null;
  return `${y}-${p2(m)}-${p2(d)}`;
}
export function parseDate(s, dayFirst = false) {
  s = String(s ?? "").trim();
  if (!s) throw new Error("Empty date");
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) s = s.split("T")[0];
  let m, r = null;
  if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s))) r = ymd(m[1], m[2], m[3]);
  else if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) r = ymd(m[1], m[2], m[3]);
  else if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s))) {
    r = dayFirst ? ymd(m[3], m[2], m[1]) : ymd(m[3], m[1], m[2]);
    if (!r && !dayFirst && s.includes("/")) r = ymd(m[3], m[2], m[1]); // 25/12/2026 style
  } else if ((m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(s))) r = ymd(m[3], MON.indexOf(m[2].toLowerCase()) + 1, m[1]);
  else if ((m = /^([A-Za-z]{3})[a-z]* (\d{1,2}),? (\d{4})$/.exec(s))) r = ymd(m[3], MON.indexOf(m[1].toLowerCase()) + 1, m[2]);
  if (!r) throw new Error(`Not a date: '${s}'`);
  return r;
}

// ---------------------------------------------------------------- CSV
function splitCsv(text, delim) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
export function csvTable(text) {
  const lines = text.slice(0, 5000).split(/\r?\n/).slice(0, 15);
  let delim = ",", best = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = lines.filter(Boolean).map((l) => l.split(d).length - 1);
    const score = counts.length ? Math.min(...counts.slice(0, 5)) : 0;
    if (score > best) { best = score; delim = d; }
  }
  const rows = splitCsv(text, delim).filter((r) => r.some((c) => c.trim()));
  let start = 0;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const low = rows[i].join(" ").toLowerCase();
    if (low.includes("date") && ["amount", "debit", "credit", "withdraw", "deposit"].some((k) => low.includes(k))) { start = i; break; }
  }
  const header = rows.length ? rows[start].map((c) => c.trim()) : [];
  return [header, rows.slice(start + 1)];
}
export function signature(header) {
  // short stable fingerprint of the column headings (FNV-1a, no crypto needed)
  let h = 0x811c9dc5;
  for (const ch of header.map((x) => x.trim().toLowerCase()).join("|")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return "h" + h.toString(16).padStart(8, "0");
}
export function guessMapping(header) {
  const low = header.map((h) => h.toLowerCase().trim());
  const m = {};
  for (const [field, names] of Object.entries(GUESS)) {
    for (const n of names) {
      const i = low.indexOf(n);
      if (i >= 0 && !Object.values(m).includes(i)) { m[field] = i; break; }
    }
  }
  if ("amount" in m && ("debit" in m || "credit" in m)) { delete m.debit; delete m.credit; }
  return { columns: m, flip_sign: false, day_first: false };
}
export function parseCsv(text, mapping) {
  const [, rows] = csvTable(text);
  const cols = {};
  for (const [k, v] of Object.entries(mapping.columns || {})) if (v !== null && v !== "" && v !== undefined) cols[k] = Number(v);
  const out = [], problems = [];
  rows.forEach((r, n) => {
    const col = (f) => (cols[f] !== undefined && cols[f] < r.length ? String(r[cols[f]]).trim() : "");
    let d, amt;
    try {
      d = parseDate(col("date"), mapping.day_first);
      amt = "amount" in cols ? C.toCents(col("amount")) : Math.abs(C.toCents(col("credit"))) - Math.abs(C.toCents(col("debit")));
      if (mapping.flip_sign) amt = -amt;
    } catch (e) {
      if (col("date") || col("amount")) problems.push(`Row ${n + 1}: ${e.message}`);
      return;
    }
    const status = col("status").toLowerCase();
    out.push({ date: d, amount: amt, payee: col("payee") || col("memo") || "Unknown", memo: col("payee") ? col("memo") : "",
      import_id: col("id") || null, status: status.includes("pend") ? "pending" : "cleared" });
  });
  return [out, problems];
}

// ---------------------------------------------------------------- OFX / QFX
const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"');
const tag = (block, t) => { const m = new RegExp(`<${t}>([^<\\r\\n]*)`, "i").exec(block); return m ? m[1].trim() : ""; };
export function parseOfx(text) {
  const out = [];
  const re = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi;
  let m;
  while ((m = re.exec(text))) {
    const block = m[1];
    let d, amt;
    try { d = parseDate(tag(block, "DTPOSTED").slice(0, 8)); amt = C.toCents(tag(block, "TRNAMT")); } catch { continue; }
    const name = tag(block, "NAME") || tag(block, "PAYEE") || tag(block, "MEMO") || "Unknown";
    const memo = tag(block, "MEMO");
    out.push({ date: d, amount: amt, payee: unescape(name), memo: memo !== name ? unescape(memo) : "", import_id: tag(block, "FITID") || null, status: "cleared" });
  }
  const bal = /<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)/i.exec(text);
  let balance = null;
  try { balance = bal ? C.toCents(bal[1]) : null; } catch { balance = null; }
  return [out, { balance, last4: tag(text, "ACCTID").replace(/\D/g, "").slice(-4) }];
}

// ---------------------------------------------------------------- QIF
export function parseQif(text, dayFirst = false) {
  const out = [];
  let cur = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const code = line[0], val = line.slice(1).trim();
    if (code === "^") {
      if (cur.date && cur.amount !== undefined) out.push({ date: cur.date, amount: cur.amount, payee: cur.payee || "Unknown", memo: cur.memo || "", import_id: cur.num || null, status: "cleared", qif_category: cur.cat || "" });
      cur = {};
    } else if (code === "D") {
      const v = val.replace(/'/g, "/").replace(/ /g, "");
      const m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(v);
      if (m) { const d = dayFirst ? ymd(m[3], m[2], m[1]) : ymd(m[3], m[1], m[2]); if (d) cur.date = d; }
      else { try { cur.date = parseDate(v, dayFirst); } catch { /* skip */ } }
    } else if (code === "T" || code === "U") { try { cur.amount = C.toCents(val); } catch { /* skip */ } }
    else if (code === "P") cur.payee = val;
    else if (code === "M") cur.memo = val;
    else if (code === "N") cur.num = val;
    else if (code === "L") cur.cat = val;
  }
  return out;
}

// ---------------------------------------------------------------- rules
export function tidy(payee) {
  let p = String(payee || "").trim().replace(/\s{2,}/g, " ");
  p = p.replace(/\b(POS|DEBIT CARD PURCHASE|PURCHASE AUTHORIZED ON \d+\/\d+|CHECKCARD \d+)\b/gi, "").trim();
  p = p.replace(/\s#?\d{4,}.*$/, "").trim();
  if (p === p.toUpperCase() && /[A-Z]/.test(p) && p.length > 3) p = p.toLowerCase().replace(/(^|[^a-z'])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  return p || payee;
}
export function applyRules(ruleList, payee, accountId) {
  const out = { payee, category_id: null, rule_ids: [] };
  for (const r of ruleList) {
    if (r.account_id && accountId && r.account_id !== accountId) continue;
    if (C.ruleMatches(r, payee)) {
      if (r.rename_to && out.payee === payee) out.payee = r.rename_to;
      if (r.category_id && !out.category_id) out.category_id = r.category_id;
      out.rule_ids.push(r.id);
    }
  }
  if (out.payee === payee) out.payee = tidy(payee);
  return out;
}
export const liveRules = (db) => db.rules.filter((r) => !r.deleted_at && r.enabled).sort((a, b) => (a.sort - b.sort) || (C.idKey(a.id) - C.idKey(b.id)));

// ---------------------------------------------------------------- preview: duplicates, transfers, rules
function findDuplicate(db, accountId, r) {
  const live = db.transactions.filter((t) => !t.deleted_at && t.account_id === accountId);
  if (r.import_id) {
    const d = live.find((t) => t.import_id === r.import_id);
    if (d) return { id: d.id, date: d.date, payee: d.payee, amount: d.amount, why: "Same bank ID" };
  }
  const lo = C.addDays(r.date, -3), hi = C.addDays(r.date, 3);
  const np = C.normalizePayee(r.original_payee);
  for (const c of live) {
    if (c.amount !== r.amount || c.date < lo || c.date > hi) continue;
    const same = C.normalizePayee(c.original_payee || c.payee) === np || C.normalizePayee(c.payee) === C.normalizePayee(r.payee);
    const out = { id: c.id, date: c.date, payee: c.payee, amount: c.amount };
    if (c.date === r.date && same) return { ...out, why: "Same date, amount and payee" };
    if (same && !(r.import_id && c.import_id)) return { ...out, why: "Same amount and payee, a few days apart" };
  }
  return null;
}
function findTransfer(db, accountId, r) {
  const lo = C.addDays(r.date, -4), hi = C.addDays(r.date, 4);
  const c = db.transactions.filter((t) => !t.deleted_at && t.account_id !== accountId && t.amount === -r.amount && !t.transfer_txn_id && t.date >= lo && t.date <= hi &&
    db.get("accounts", t.account_id) && !db.get("accounts", t.account_id).deleted_at);
  if (c.length !== 1) return null;
  const a = db.get("accounts", c[0].account_id);
  return { id: c[0].id, date: c[0].date, payee: c[0].payee, amount: c[0].amount, account_name: a.name, account_id: a.id };
}
export function check(db, accountId, rows) {
  const rules = liveRules(db);
  for (const r of rows) {
    r.original_payee = r.payee;
    const res = applyRules(rules, r.payee, accountId);
    r.payee = res.payee;
    r.category_id = res.category_id;
    r.category_name = res.category_id ? db.get("categories", res.category_id)?.name || "" : "";
    if (r.qif_category && !r.category_id) {
      const nm = r.qif_category.split(":").pop().trim().toLowerCase();
      const c = db.categories.find((x) => !x.deleted_at && x.name.toLowerCase() === nm);
      if (c) { r.category_id = c.id; r.category_name = c.name; }
    }
    r.duplicate = findDuplicate(db, accountId, r);
    r.transfer_match = r.duplicate ? null : findTransfer(db, accountId, r);
    r.include = !r.duplicate;
  }
}
export function preview(db, accountId, filename, bytes, mapping = null) {
  const text = decode(bytes);
  const kind = sniffKind(filename, text);
  let rows, problems = [], info = {};
  if (kind === "ofx") [rows, info] = parseOfx(text);
  else if (kind === "qif") rows = parseQif(text);
  else {
    const [header, body] = csvTable(text);
    if (!header.length) throw new Error("That file is empty.");
    const sig = signature(header);
    if (!mapping && db.settings[`csvmap_${sig}`]) mapping = db.settings[`csvmap_${sig}`];
    if (!mapping) return { kind: "csv", needs_mapping: true, header, sample: body.slice(0, 6), mapping: guessMapping(header), signature: sig };
    [rows, problems] = parseCsv(text, mapping);
    info = { mapping, signature: sig, header };
  }
  rows = rows.filter((r) => r.amount !== 0);
  check(db, accountId, rows);
  return { kind, rows, problems, ...info,
    summary: { count: rows.length, duplicates: rows.filter((r) => r.duplicate).length, transfers: rows.filter((r) => r.transfer_match).length } };
}

// Unlinked opposite amounts in two accounts, a few days apart, that look like transfers
export function autoMatchTransfers(db, days = 4) {
  const rows = db.transactions.filter((t) => !t.deleted_at && !t.transfer_txn_id && !t.is_valuation && !/^Starting balance/.test(t.payee || ""))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : C.idKey(a.id) - C.idKey(b.id)));
  const byAmt = new Map();
  for (const r of rows) { if (!byAmt.has(r.amount)) byAmt.set(r.amount, []); byAmt.get(r.amount).push(r); }
  const kw = /TRANSFER|XFER|PAYMENT|AUTOPAY|ONLINE PMT|THANK YOU|TO SAV|FROM CHK|TO CHK|FROM SAV/i;
  const used = new Set(), pairs = [];
  for (const r of rows) {
    if (used.has(r.id) || r.amount >= 0) continue;
    for (const o of byAmt.get(-r.amount) || []) {
      if (used.has(o.id) || o.account_id === r.account_id) continue;
      if (Math.abs(C.dayNum(o.date) - C.dayNum(r.date)) <= days && (kw.test(r.payee) || kw.test(o.payee))) { pairs.push([r, o]); used.add(r.id); used.add(o.id); break; }
    }
  }
  const side = (t) => ({ id: t.id, account_id: t.account_id, date: t.date, amount: t.amount, payee: t.payee, account: db.get("accounts", t.account_id)?.name });
  return pairs.map(([a, b]) => ({ out: side(a), in: side(b) }));
}
