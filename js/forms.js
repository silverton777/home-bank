// Shared windows for adding and changing things (used from many pages and the big + button).
import { icon } from "./icons.js";
import {
  $, esc, GET, POST, PUT, DEL, toast, attempt, modal, confirmBox, confirmDelete, bindDraft, formData, money, dollars,
  centsFromInput, askText, todayIso, thisMonth, accountOptions, categoryOptions, readFileB64, niceDate, plural, savedToast,
} from "./ui.js";
import { w } from "./words.js";
import { shrinkPhoto } from "./local/files.js";

export async function viewPicture(id, name = "Receipt") {
  try {
    const { data_url } = await GET(`/api/receipts/${id}`);
    modal({ title: esc(name), wide: true, body: `<img src="${data_url}" alt="${esc(name)}" style="width:100%;border-radius:12px;display:block">` });
  } catch (e) { toast(e.message, { bad: true }); }
}

export async function lookups() {
  const [a, c] = await Promise.all([GET("/api/accounts"), GET("/api/categories")]);
  return { accounts: a.accounts, types: a.types, groups: c.groups, tags: c.tags };
}

// ================================================================== quick add (the big + button)
// Amount first (the phone's number pad comes up), then who, then the category, guessed from last time.
export async function quickAdd(defaults = {}) {
  const L = await lookups();
  if (!L.accounts.length) { toast("Add your checking account first. Then the + button records purchases."); return accountForm(); }
  const { payees } = await GET("/api/payees");
  let dir = "out";
  let acct = defaults.account_id || Number(localStorage.getItem("hb-last-account")) || L.accounts.find((a) => a.on_budget && !a.closed)?.id;
  if (!L.accounts.some((a) => a.id === acct)) acct = L.accounts[0].id;
  let photo = null;
  const m = modal({
    title: "Add",
    help: "Record money spent or received. Type the amount, who it was, and pick a category.",
    body: `<div class="quick">
      <div class="seg wide" data-dir data-help="Spent = money out. Got money = paycheck, refund or deposit.">
        <button type="button" data-v="out" class="on">Spent</button><button type="button" data-v="in">Got money</button><button type="button" data-v="move">Move money</button>
      </div>
      <label class="amount-big" data-help="How much. Your phone's number pad comes up."><span class="cur">$</span><input name="amount" inputmode="decimal" placeholder="0.00" autocomplete="off" enterkeyhint="next"></label>
      <label class="field"><span>Who</span><input name="payee" autocomplete="off" placeholder="Store, person or company" enterkeyhint="done" data-help="Who you paid or who paid you. Pick a name from before and the category fills in."></label>
      <div class="chips-row" data-sugg></div>
      <label class="field"><span>Category</span><select name="category_id" data-help="Which budget category this comes out of. Paying a credit card? Pick the card under 'Pay a credit card'.">${categoryOptions(L.groups, null, { payments: true })}</select></label>
      <div class="row2">
        <label class="field"><span>Account</span><select name="account_id" data-help="Which account the money came out of or went into.">${accountOptions(L.accounts, acct)}</select></label>
        <label class="field"><span>Date</span><input type="date" name="date" value="${todayIso()}"></label>
      </div>
      <div class="row" style="gap:8px;margin-top:4px">
        <label class="btn" data-help="Take a picture of the receipt, or pick one. It's kept on this phone, locked with your data.">${icon("camera")} <span data-photolabel>Receipt photo</span><input type="file" accept="image/*" hidden data-photo></label>
        <button type="button" class="btn ghost" data-more data-help="Open the full form: notes, tags, split across categories, status.">More details</button>
      </div>
    </div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save</button>`,
  });
  m.el.classList.add("sheet");
  const $f = (n) => m.$(`[name=${n}]`);
  const amount = $f("amount"), payee = $f("payee"), cat = $f("category_id");
  amount.focus();
  const sugg = m.$("[data-sugg]");
  let catTouched = false;
  cat.addEventListener("change", () => (catTouched = true));
  const drawSugg = () => {
    const q = payee.value.trim().toLowerCase();
    const list = (q ? payees.filter((p) => p.payee.toLowerCase().includes(q)) : payees).slice(0, 6);
    sugg.innerHTML = list.map((p) => `<button type="button" data-p="${esc(p.payee)}">${esc(p.payee)}</button>`).join("");
    sugg.querySelectorAll("[data-p]").forEach((b) => b.onclick = () => { payee.value = b.dataset.p; guess(); sugg.innerHTML = ""; });
  };
  const guess = () => {
    const hit = payees.find((p) => p.payee.toLowerCase() === payee.value.trim().toLowerCase());
    if (hit && hit.category_id && !catTouched) cat.value = String(hit.category_id);
  };
  payee.addEventListener("input", () => { drawSugg(); guess(); });
  payee.addEventListener("focus", drawSugg);
  amount.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); payee.focus(); } });
  m.$$("[data-dir] button").forEach((b) => b.onclick = () => {
    if (b.dataset.v === "move") { m.close(); transferForm({ from_id: Number($f("account_id").value), amount: centsFromInput(amount.value) || 0 }); return; }
    dir = b.dataset.v;
    m.$$("[data-dir] button").forEach((x) => x.classList.toggle("on", x === b));
    if (dir === "in" && !catTouched) { const inc = L.groups.find((g) => g.kind === "income")?.categories[0]; if (inc) cat.value = String(inc.id); }
  });
  m.$("[data-photo]").addEventListener("change", (e) => { photo = e.target.files[0] || null; m.$("[data-photolabel]").textContent = photo ? "Photo added" : "Receipt photo"; });
  m.$("[data-more]").onclick = () => {
    const cents = centsFromInput(amount.value) || 0;
    m.close();
    txnForm(null, { account_id: Number($f("account_id").value), category_id: Number(cat.value) || null, payee: payee.value, amount: dir === "out" ? -cents : cents, date: $f("date").value });
  };
  const save = async () => {
    const cents = centsFromInput(amount.value);
    if (!cents) { toast("Type the amount first.", { bad: true }); amount.focus(); return; }
    const body = { account_id: Number($f("account_id").value), date: $f("date").value || todayIso(), payee: payee.value.trim(),
      amount: dir === "out" ? -Math.abs(cents) : Math.abs(cents), category_id: Number(cat.value) || null, status: "cleared" };
    const btn = m.$("[data-save]");
    btn.disabled = true;
    try {
      const r = await POST("/api/transactions", body);
      if (photo) await POST(`/api/transactions/${r.id}/receipt`, { filename: photo.name || "receipt.jpg", data_b64: await shrinkPhoto(photo) });
      localStorage.setItem("hb-last-account", body.account_id);
      m.close();
      savedToast(r.card_payment ? `Recorded as a payment to ${r.card_payment}.` : `Saved ${money(body.amount)}${body.payee ? " at " + body.payee : ""}.`);
    } catch (e) { btn.disabled = false; toast(e.message, { bad: true }); }
  };
  m.$("[data-save]").onclick = save;
  payee.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
}

export function openNew(kind, ctx = {}) {
  const acct = ctx.params?.account ? Number(ctx.params.account) : null;
  if (kind === "txn") return txnForm(null, { account_id: acct });
  if (kind === "transfer") return transferForm({ from_id: acct });
  if (kind === "account") return accountForm();
  if (kind === "bill") return scheduleForm(null, { kind: "bill" });
  if (kind === "goal") return goalForm();
  if (kind === "category") return categoryForm();
  if (kind === "import") return pickFileThenImport(acct);
}

// ================================================================== transaction
export async function txnForm(txn = null, defaults = {}) {
  const L = await lookups();
  const { payees } = await GET("/api/payees");
  if (!L.accounts.length) {
    toast("Add an account first, then you can record transactions in it.");
    return accountForm();
  }
  const t = txn || { account_id: defaults.account_id || Number(localStorage.getItem("hb-last-account")) || L.accounts.find((a) => a.on_budget)?.id,
    date: defaults.date || todayIso(), payee: defaults.payee || "", amount: defaults.amount || 0, notes: "", status: "cleared", splits: [], tags: [], category_id: defaults.category_id || null };
  const isSplit = (t.splits || []).length > 1;
  const out = t.amount <= 0;
  const tagIds = new Set((t.tags || []).map((x) => x.id));
  const isTransfer = !!t.transfer_txn_id;
  const m = modal({
    title: txn ? "Change transaction" : "Record a transaction",
    wide: true,
    help: "Fill in what happened. Money out is spending; money in is income or a refund.",
    body: `<form class="form" data-f>
      <label class="field"><span>${w("f.account", "Account")}</span><select name="account_id" data-help="Which account the money came out of or went into.">${accountOptions(L.accounts, t.account_id)}</select></label>
      <label class="field"><span>${w("f.date", "Date")}</span><input type="date" name="date" value="${esc(t.date)}" data-help="The day it happened."></label>
      <label class="field full"><span>${w("f.payee", "Paid to / received from")}</span><input name="payee" list="payee-list" value="${esc(t.payee)}" autocomplete="off" data-help="Who you paid or who paid you. Pick a name you've used before and Home Bank fills in the usual category."></label>
      <datalist id="payee-list">${payees.map((p) => `<option value="${esc(p.payee)}">`).join("")}</datalist>
      <div class="field full"><span class="muted small">${w("f.direction", "Which way did the money go?")}</span>
        <div class="seg" data-dir data-help="Money out = you spent or paid something. Money in = income, a refund or a deposit.">
          <button type="button" data-v="out" class="${out ? "on" : ""}">${w("f.out", "Money out")}</button><button type="button" data-v="in" class="${!out ? "on" : ""}">${w("f.in", "Money in")}</button>
        </div></div>
      <label class="field"><span>${w("f.amount", "Amount")}</span><input name="amount" class="money-in" inputmode="decimal" value="${t.amount ? dollars(Math.abs(t.amount)) : ""}" placeholder="0.00" data-help="How much, without a minus sign. Pick Money out or Money in above."></label>
      <label class="field"><span>${w("f.status", "Status")}</span><select name="status" data-help="Pending = the bank hasn't finished it yet. Cleared = it's done.">
        ${[["cleared", "Cleared"], ["pending", "Pending"], ["reconciled", "Reconciled"]].map(([v, l]) => `<option value="${v}" ${t.status === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="full" data-catwrap ${isTransfer ? "hidden" : ""}>
        <div data-single ${isSplit ? "hidden" : ""}><label class="field"><span>${w("f.category", "Category")}</span><select name="category_id" data-help="The budget category this comes out of. Income goes to Ready To Assign. Paying a credit card? Pick the card under 'Pay a credit card'.">${categoryOptions(L.groups, t.category_id ?? t.splits?.[0]?.category_id, { payments: !txn || !isTransfer })}</select></label>
          <button type="button" class="btn ghost sm" data-splitbtn style="margin-top:6px" data-help="Split one purchase across several categories, like groceries and household from one store trip.">${icon("split")} ${w("f.split", "Split across categories")}</button></div>
        <div data-splits ${isSplit ? "" : "hidden"}></div>
      </div>
      ${isTransfer ? `<p class="full muted">This is a transfer between your own accounts, so it isn't spending or income. <button type="button" class="btn sm" data-unlink data-help="Turn this back into a normal transaction.">Not a transfer</button></p>` : ""}
      <div class="field full"><span class="muted small">${w("f.tags", "Tags")}</span>
        <div class="chips-row" data-tags data-help="Tags mark things across categories, like 'tax deductible' or 'vacation'. Tap to turn one on.">${L.tags.map((g) => `<button type="button" data-tag="${g.id}" class="${tagIds.has(g.id) ? "on" : ""}" style="${tagIds.has(g.id) ? "border-color:var(--accent);color:var(--text)" : ""}">${esc(g.name)}</button>`).join("")}<button type="button" data-newtag>+ New tag</button></div></div>
      <label class="field full"><span>${w("f.notes", "Notes")}</span><textarea name="notes" spellcheck="true" data-help="Anything you want to remember about this one. Spelling is checked as you type.">${esc(t.notes || "")}</textarea></label>
      <div class="full row" data-receipts>${(t.attachments || []).map((a) => `<span class="pill">${icon("receipt")}<button type="button" class="linkish" data-viewpic="${a.id}" data-help="See the picture.">${esc(a.filename)}</button><button type="button" class="btn icon ghost sm" data-delatt="${a.id}" data-help="Remove this receipt.">${icon("x")}</button></span>`).join("")}
        <label class="btn sm" data-help="Attach a photo of the receipt. On a phone you can take the picture right now." data-receipt-drop>${icon("receipt")} ${w("f.receipt", "Attach receipt photo")}<input type="file" accept="image/*" name="receipt_file" hidden></label><span class="small muted" data-rname></span></div>
    </form>`,
    foot: `${txn ? `<button class="btn danger" data-del data-help="Move this transaction to the Deleted page.">${icon("trash")} Delete</button><span class="spacer"></span>` : ""}
      <button class="btn" data-close>Cancel</button>
      ${txn ? "" : `<button class="btn" data-again data-help="Save this one and start another.">Save and add another</button>`}
      <button class="btn primary" data-save>${txn ? "Save changes" : "Record this transaction"}</button>`,
  });
  const f = m.$("[data-f]");
  const clearDraft = txn ? () => {} : bindDraft(f, "txn-new");
  let dir = out ? "out" : "in";
  m.$$("[data-dir] button").forEach((b) => b.onclick = () => { dir = b.dataset.v; m.$$("[data-dir] button").forEach((x) => x.classList.toggle("on", x === b)); f.dataset.dirty = "1"; });
  // remember the usual category for a payee
  f.payee.addEventListener("change", () => {
    const p = payees.find((x) => x.payee.toLowerCase() === f.payee.value.trim().toLowerCase());
    if (p && p.category_id && !f.category_id.value) f.category_id.value = p.category_id;
  });
  // tags
  const tagsOn = new Set(tagIds);
  m.$("[data-tags]").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.newtag !== undefined) {
      const name = await askText({ title: "New tag", label: "Tag name", yes: "Add tag" });
      if (!name) return;
      await attempt(() => POST("/api/tags", { name }));
      const nb = document.createElement("button"); nb.type = "button"; nb.textContent = name; nb.dataset.tagname = name;
      nb.classList.add("on"); nb.style.borderColor = "var(--accent)"; b.before(nb); tagsOn.add(name);
      return;
    }
    const id = b.dataset.tag ? Number(b.dataset.tag) : b.dataset.tagname;
    if (tagsOn.has(id)) { tagsOn.delete(id); b.style.borderColor = ""; b.style.color = ""; } else { tagsOn.add(id); b.style.borderColor = "var(--accent)"; b.style.color = "var(--text)"; }
  });
  // splits
  const splitsEl = m.$("[data-splits]");
  let splitRows = isSplit ? t.splits.map((s) => ({ category_id: s.category_id, amount: Math.abs(s.amount), memo: s.memo })) : [];
  const drawSplits = () => {
    const total = centsFromInput(f.amount.value) || 0;
    const used = splitRows.reduce((a, s) => a + (s.amount || 0), 0);
    splitsEl.innerHTML = `<div class="muted small" style="margin-bottom:6px">Split ${money(total)} across categories:</div>` +
      splitRows.map((s, i) => `<div class="row" style="margin-bottom:6px;flex-wrap:nowrap"><select data-si="${i}" data-k="category_id" style="flex:2">${categoryOptions(L.groups, s.category_id)}</select>
        <input data-si="${i}" data-k="amount" class="money-in" style="flex:1" value="${s.amount ? dollars(s.amount) : ""}" placeholder="0.00" data-help="How much of the total goes to this category.">
        <button type="button" class="btn icon ghost" data-rm="${i}" data-help="Remove this line.">${icon("x")}</button></div>`).join("") +
      `<div class="row"><button type="button" class="btn sm" data-addsplit>+ Add a line</button><span class="spacer"></span><span class="${used === total ? "good" : "warn"}">${used === total ? "Adds up" : `${money(total - used)} left to split`}</span>
       <button type="button" class="btn ghost sm" data-unsplit>Use one category</button></div>`;
  };
  splitsEl.addEventListener("input", (e) => {
    const i = e.target.dataset.si; if (i === undefined) return;
    splitRows[i][e.target.dataset.k] = e.target.dataset.k === "amount" ? centsFromInput(e.target.value) || 0 : Number(e.target.value) || null;
    if (e.target.dataset.k === "amount") { const s = splitsEl.querySelector(".row:last-child span:nth-child(3)"); const total = centsFromInput(f.amount.value) || 0; const used = splitRows.reduce((a, s) => a + (s.amount || 0), 0); if (s) { s.className = used === total ? "good" : "warn"; s.textContent = used === total ? "Adds up" : `${money(total - used)} left to split`; } }
  });
  splitsEl.addEventListener("click", (e) => {
    if (e.target.closest("[data-addsplit]")) { splitRows.push({ category_id: null, amount: 0 }); drawSplits(); }
    const rm = e.target.closest("[data-rm]"); if (rm) { splitRows.splice(Number(rm.dataset.rm), 1); drawSplits(); }
    if (e.target.closest("[data-unsplit]")) { splitRows = []; splitsEl.hidden = true; m.$("[data-single]").hidden = false; }
  });
  m.$("[data-splitbtn]")?.addEventListener("click", () => {
    const total = centsFromInput(f.amount.value) || 0;
    splitRows = [{ category_id: Number(f.category_id.value) || null, amount: total }, { category_id: null, amount: 0 }];
    m.$("[data-single]").hidden = true; splitsEl.hidden = false; drawSplits();
  });
  if (isSplit) drawSplits();
  f.receipt_file.addEventListener("change", () => { m.$("[data-rname]").textContent = f.receipt_file.files[0]?.name || ""; });
  m.$$("[data-viewpic]").forEach((b) => b.onclick = () => viewPicture(b.dataset.viewpic, b.textContent));
  m.$$("[data-delatt]").forEach((b) => b.onclick = async () => {
    if (await confirmDelete("receipt", b.previousElementSibling.textContent)) { await attempt(() => DEL(`/api/attachments/${b.dataset.delatt}`)); b.closest(".pill").remove(); }
  });
  m.$("[data-unlink]")?.addEventListener("click", async () => { await attempt(() => POST(`/api/transactions/${txn.id}/unlink`), "It's a normal transaction now."); m.close(); });
  m.$("[data-del]")?.addEventListener("click", async () => {
    if (await confirmDelete("transaction", `${t.payee || "Transaction"} ${money(t.amount)} on ${niceDate(t.date)}`, isTransfer ? "Both sides of the transfer will be deleted." : "")) {
      await attempt(() => DEL(`/api/transactions/${txn.id}`), "Moved to Deleted.");
      m.close();
    }
  });
  const save = async (again) => {
    const d = formData(f);
    const cents = centsFromInput(d.amount);
    if (!cents) { toast("Enter an amount.", { bad: true }); f.amount.focus(); return; }
    const amount = dir === "out" ? -Math.abs(cents) : Math.abs(cents);
    const body = { account_id: Number(d.account_id), date: d.date, payee: d.payee, amount, notes: d.notes, status: d.status,
      tags: [...tagsOn] };
    if (!isTransfer) {
      if (!splitsEl.hidden && splitRows.length) {
        const sign = amount < 0 ? -1 : 1;
        body.splits = splitRows.filter((s) => s.amount).map((s) => ({ category_id: s.category_id, amount: sign * Math.abs(s.amount), memo: s.memo || "" }));
      } else body.category_id = Number(d.category_id) || null;
    }
    try {
      let id = txn?.id, res, resNew;
      if (txn) res = await PUT(`/api/transactions/${txn.id}`, body);
      else { resNew = await POST("/api/transactions", body); id = resNew.id; }
      const file = f.receipt_file.files[0];
      if (file) await POST(`/api/transactions/${id}/receipt`, { filename: file.name || "receipt.jpg", data_b64: await shrinkPhoto(file) });
      localStorage.setItem("hb-last-account", body.account_id);
      clearDraft();
      savedToast(res?.card_payment || resNew?.card_payment ? `Recorded as a payment to ${res?.card_payment || resNew?.card_payment}.` : txn ? "Changes saved." : "Transaction recorded.");
      if (res?.rule_suggestion) offerRule(res.rule_suggestion, L.groups);
      if (again) { m.close(); txnForm(null, { account_id: body.account_id }); } else m.close();
    } catch (e) { toast(e.message, { bad: true }); }
  };
  m.$("[data-save]").onclick = () => save(false);
  m.$("[data-again]")?.addEventListener("click", () => save(true));
  f.addEventListener("submit", (e) => { e.preventDefault(); save(false); });
}

export async function offerRule(s, groups) {
  const cat = groups.flatMap((g) => g.categories).find((c) => c.id === s.category_id);
  const yes = await confirmBox({
    title: "Always do this?",
    text: `Put payees containing <b>${esc(s.match_text)}</b> in <b>${esc(cat?.name || "this category")}</b> from now on?` +
      (s.others ? `<br><br>${plural(s.others, "other transaction")} from them could be changed too.` : ""),
    yes: s.others ? "Yes, and fix the others" : "Yes, make a rule", no: "Just this once",
  });
  if (yes) await attempt(() => POST("/api/rules", { match_text: s.match_text, category_id: s.category_id, rename_to: "", run_now: true, apply_all: true }), "Rule saved.");
}

// ================================================================== transfer
export async function transferForm(d = {}) {
  const L = await lookups();
  const m = modal({
    title: "Move money between accounts",
    help: "A transfer moves money between your own accounts. It isn't spending or income.",
    body: `<form class="form" data-f>
      <label class="field"><span>From</span><select name="from_id" data-help="The account the money leaves.">${accountOptions(L.accounts, d.from_id)}</select></label>
      <label class="field"><span>To</span><select name="to_id" data-help="The account the money goes into. To pay a credit card, pick the card here.">${accountOptions(L.accounts, d.to_id, { blank: "Pick an account…" })}</select></label>
      <label class="field"><span>Amount</span><input name="amount" class="money-in" inputmode="decimal" placeholder="0.00" value="${d.amount ? dollars(d.amount) : ""}"></label>
      <label class="field"><span>Date</span><input type="date" name="date" value="${todayIso()}"></label>
      <label class="field full" data-catrow hidden><span>Budget category</span><select name="category_id" data-help="Money leaving the budget (like a car loan or mortgage payment) needs a category so it counts in the budget.">${categoryOptions(L.groups, null)}</select></label>
      <label class="field full"><span>Notes</span><input name="notes" spellcheck="true"></label>
    </form>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Record this transfer</button>`,
  });
  const f = m.$("[data-f]");
  const clear = bindDraft(f, "transfer-new");
  const check = () => {
    const a = L.accounts.find((x) => x.id == f.from_id.value), b = L.accounts.find((x) => x.id == f.to_id.value);
    m.$("[data-catrow]").hidden = !(a && b && a.on_budget !== b.on_budget);
  };
  f.from_id.onchange = check; f.to_id.onchange = check; check();
  m.$("[data-save]").onclick = async () => {
    const v = formData(f);
    const ok = await attempt(() => POST("/api/transfers", { ...v, amount: centsFromInput(v.amount), category_id: Number(v.category_id) || null }), "Transfer recorded.");
    if (ok) { clear(); m.close(); }
  };
}

// ================================================================== account
export async function accountForm(a = null) {
  const L = await lookups();
  const { people } = await GET("/api/settings");
  const isNew = !a?.id;
  a = { type: "checking", owner: "Joint", on_budget: 1, low_balance_warn: 10000, ...(a || {}) };
  const types = Object.entries(L.types);
  const m = modal({
    title: isNew ? "Add an account" : `Change ${esc(a.name)}`,
    wide: true,
    body: `<form class="form" data-f>
      <label class="field"><span>Name</span><input name="name" value="${esc(a.name || "")}" placeholder="Joint Checking" data-help="Whatever you call this account."></label>
      <label class="field"><span>Kind of account</span><select name="type" data-help="Cards, loans and the mortgage are debts. Houses and cars are things you own.">${types.map(([k, l]) => `<option value="${k}" ${a.type === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label class="field"><span>Bank or company</span><input name="institution" value="${esc(a.institution || "")}" data-help="Who holds the account. Optional."></label>
      <label class="field"><span>Last 4 digits</span><input name="last4" inputmode="numeric" maxlength="4" value="${esc(a.last4 || "")}" data-help="Only the last 4 digits are kept, so you can tell cards apart. Never the full number."></label>
      ${isNew ? `<label class="field"><span data-ballabel>Balance right now</span><input name="balance" class="money-in" inputmode="decimal" placeholder="0.00" data-help="What the account shows today. For a card or loan, type what you owe."></label>
      <label class="field"><span>As of</span><input type="date" name="opening_date" value="${todayIso()}"></label>` : ""}
      <label class="field"><span>Whose is it?</span><select name="owner">${["Joint", ...people.map((p) => p.name)].map((o) => `<option ${a.owner === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>
      <label class="field" data-debt><span>Interest rate (APR %)</span><input name="apr" inputmode="decimal" value="${a.apr_bp ? (a.apr_bp / 100).toFixed(2) : ""}" placeholder="0.00" data-help="The yearly interest rate. Used by the debt payoff planner."></label>
      <label class="field" data-debt><span>Minimum payment</span><input name="min_payment" class="money-in" inputmode="decimal" value="${a.min_payment ? dollars(a.min_payment) : ""}" placeholder="0.00" data-help="The smallest payment due each month."></label>
      <label class="field" data-card><span>Credit limit</span><input name="credit_limit" class="money-in" inputmode="decimal" value="${a.credit_limit ? dollars(a.credit_limit) : ""}" placeholder="0.00"></label>
      <label class="field" data-cash><span>Warn me below</span><input name="low_balance_warn" class="money-in" inputmode="decimal" value="${dollars(a.low_balance_warn ?? 10000)}" data-help="The forecast warns you before this account is expected to drop under this amount."></label>
      <label class="check full" data-help="Budget accounts are the ones you spend from day to day (checking, savings, cash, cards). Tracking accounts (loans, investments, house) just show their balance."><input type="checkbox" name="on_budget" ${a.on_budget ? "checked" : ""}> Use this account in the budget</label>
      <label class="field full"><span>Notes</span><textarea name="notes" spellcheck="true">${esc(a.notes || "")}</textarea></label>
      ${!isNew ? `<label class="check full"><input type="checkbox" name="closed" ${a.closed ? "checked" : ""}> This account is closed (keep its history, hide it from lists)</label>` : ""}
    </form>`,
    foot: `${!isNew ? `<button class="btn danger" data-del>${icon("trash")} Delete account</button><span class="spacer"></span>` : ""}<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${isNew ? "Add this account" : "Save changes"}</button>`,
  });
  const f = m.$("[data-f]");
  const clear = isNew ? bindDraft(f, "account-new") : () => {};
  const debtTypes = ["credit", "loan", "mortgage", "other_debt"], cashTypes = ["checking", "savings", "cash"];
  const budgetDefault = { checking: 1, savings: 1, cash: 1, credit: 1 };
  const sync = (changed) => {
    const t = f.type.value;
    m.$$("[data-debt]").forEach((x) => (x.hidden = !debtTypes.includes(t)));
    m.$$("[data-card]").forEach((x) => (x.hidden = t !== "credit"));
    m.$$("[data-cash]").forEach((x) => (x.hidden = !cashTypes.includes(t)));
    const bl = m.$("[data-ballabel]");
    if (bl) bl.textContent = debtTypes.includes(t) ? "Amount owed right now" : ["house", "vehicle", "other_asset"].includes(t) ? "What it's worth today" : "Balance right now";
    if (changed && isNew) f.on_budget.checked = !!budgetDefault[t];
  };
  f.type.onchange = () => sync(true); sync(false);
  m.$("[data-del]")?.addEventListener("click", async () => {
    if (await confirmDelete("account", a.name, `Its ${plural(a.txn_count || 0, "transaction")} go with it, and come back if you put it back.`)) {
      await attempt(() => DEL(`/api/accounts/${a.id}`), "Moved to Deleted.");
      m.close(); window.navigate("#/accounts");
    }
  });
  m.$("[data-save]").onclick = async () => {
    const v = formData(f);
    const body = { ...v, on_budget: v.on_budget ? 1 : 0, closed: v.closed ? 1 : 0, balance: centsFromInput(v.balance) || 0,
      min_payment: centsFromInput(v.min_payment) || 0, credit_limit: centsFromInput(v.credit_limit) || 0,
      low_balance_warn: centsFromInput(v.low_balance_warn) ?? 0, apr: v.apr || 0 };
    if (!isNew) delete body.balance;
    const r = await attempt(() => (isNew ? POST("/api/accounts", body) : PUT(`/api/accounts/${a.id}`, body)), isNew ? "Account added." : "Changes saved.");
    if (r) { clear(); m.close(); if (isNew && r.id) window.navigate(`#/register?account=${r.id}`); }
  };
}

export async function valueForm(a) {
  const m = modal({
    title: `Update ${esc(a.name)}`,
    help: "For houses, cars, investments and loans: type today's value and Home Bank records the change.",
    body: `<form class="form" data-f>
      <label class="field"><span>${a.liability ? "Amount owed now" : "Value now"}</span><input name="balance" class="money-in" inputmode="decimal" value="${dollars(Math.abs(a.balance))}"></label>
      <label class="field"><span>As of</span><input type="date" name="date" value="${todayIso()}"></label>
      <label class="field full"><span>Note</span><input name="note" placeholder="${a.type === "house" ? "Estimated value" : "Statement balance"}"></label></form>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Record new value</button>`,
  });
  m.$("[data-save]").onclick = async () => {
    const v = formData(m.$("[data-f]"));
    if (await attempt(() => POST(`/api/accounts/${a.id}/value`, { balance: centsFromInput(v.balance), date: v.date, note: v.note || "Updated value" }), "Value updated.")) m.close();
  };
}

// ================================================================== bills / paychecks
export async function scheduleForm(s = null, defaults = {}) {
  const L = await lookups();
  const { frequencies } = await GET("/api/scheduled");
  const { people } = await GET("/api/settings");
  const isNew = !s;
  s = s || { kind: defaults.kind || "bill", frequency: "monthly", next_date: todayIso(), autopay: 0, is_subscription: 0, ...defaults };
  const m = modal({
    title: isNew ? "Add recurring money in or out" : `Change ${esc(s.name)}`, wide: true,
    help: "Anything that repeats: paychecks, bills, subscriptions, transfers to savings. Used for the calendar, reminders and the cash-flow forecast.",
    body: `<form class="form" data-f>
      <div class="field full"><span class="muted small">What is it?</span><div class="seg" data-kind>
        ${[["bill", "A bill"], ["income", "A paycheck / income"], ["transfer", "A regular transfer"]].map(([k, l]) => `<button type="button" data-v="${k}" class="${s.kind === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <label class="field"><span>Name</span><input name="name" value="${esc(s.name || "")}" placeholder="Electric bill" data-help="What you call it."></label>
      <label class="field" data-not="transfer"><span>Payee on the bank statement</span><input name="payee" value="${esc(s.payee || "")}" data-help="How it shows up at the bank. Helps Home Bank spot price changes."></label>
      <label class="field"><span>Amount</span><input name="amount" class="money-in" inputmode="decimal" value="${s.amount ? dollars(s.amount) : ""}" placeholder="0.00" data-help="The usual amount. For a paycheck, the take-home amount."></label>
      <label class="field"><span>How often</span><select name="frequency" data-help="Every 2 weeks = biweekly paychecks. Twice a month = on two set days, like the 1st and 15th.">${Object.entries(frequencies).map(([k, l]) => `<option value="${k}" ${s.frequency === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="field"><span>Next date</span><input type="date" name="next_date" value="${esc(s.next_date || todayIso())}"></label>
      <label class="field" data-semi><span>Second day of the month</span><input name="day2" inputmode="numeric" value="${esc(s.day2 || "")}" placeholder="e.g. 30" data-help="For twice-a-month: the other day it happens. Type 31 for the last day of the month."></label>
      <label class="field"><span data-acctlabel>Account</span><select name="account_id">${accountOptions(L.accounts, s.account_id, { blank: "Pick an account…" })}</select></label>
      <label class="field" data-only="transfer"><span>To account</span><select name="to_account_id">${accountOptions(L.accounts, s.to_account_id, { blank: "Pick an account…" })}</select></label>
      <label class="field" data-not="transfer"><span>Budget category</span><select name="category_id">${categoryOptions(L.groups, s.category_id, { blank: "No category" })}</select></label>
      <label class="field" data-only="income"><span>Whose paycheck?</span><select name="person"><option value="">Shared</option>${people.map((p) => `<option ${s.person === p.name ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Stops after (optional)</span><input type="date" name="end_date" value="${esc(s.end_date || "")}"></label>
      <label class="check full" data-help="On its date, Home Bank adds the transaction for you. Turn this off if you'd rather record it yourself (or import it from the bank)."><input type="checkbox" name="auto_record" ${s.auto_record ? "checked" : ""}> Enter it in Home Bank automatically on its date</label>
      <label class="check full" data-help="Paused items stay on the list but don't show up in the forecast, calendar or reminders."><input type="checkbox" name="paused" ${s.paused ? "checked" : ""}> Paused for now</label>
      <label class="check" data-only="bill"><input type="checkbox" name="autopay" ${s.autopay ? "checked" : ""}> The bank pays it automatically (autopay)</label>
      <label class="check" data-only="bill"><input type="checkbox" name="is_subscription" ${s.is_subscription ? "checked" : ""}> It's a subscription</label>
      <label class="check" data-only="bill"><input type="checkbox" name="might_cancel" ${s.might_cancel ? "checked" : ""}> We might cancel this</label>
      <label class="field full"><span>Notes</span><textarea name="notes" spellcheck="true">${esc(s.notes || "")}</textarea></label>
    </form>`,
    foot: `${!isNew ? `<button class="btn danger" data-del>${icon("trash")} Delete</button><span class="spacer"></span>` : ""}<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${isNew ? "Save this" : "Save changes"}</button>`,
  });
  const f = m.$("[data-f]");
  let kind = s.kind;
  const sync = () => {
    m.$$("[data-only]").forEach((x) => (x.hidden = x.dataset.only !== kind));
    m.$$("[data-not]").forEach((x) => (x.hidden = x.dataset.not === kind));
    m.$("[data-semi]").hidden = f.frequency.value !== "semimonthly";
    m.$("[data-acctlabel]").textContent = kind === "income" ? "Paid into" : kind === "transfer" ? "From account" : "Paid from";
  };
  m.$$("[data-kind] button").forEach((b) => b.onclick = () => { kind = b.dataset.v; m.$$("[data-kind] button").forEach((x) => x.classList.toggle("on", x === b)); sync(); });
  f.frequency.onchange = sync; sync();
  m.$("[data-del]")?.addEventListener("click", async () => {
    if (await confirmDelete(kind === "income" ? "paycheck" : "bill", s.name)) { await attempt(() => DEL(`/api/scheduled/${s.id}`), "Moved to Deleted."); m.close(); }
  });
  m.$("[data-save]").onclick = async () => {
    const v = formData(f);
    const body = { ...v, kind, amount: centsFromInput(v.amount) || 0, autopay: v.autopay ? 1 : 0, is_subscription: v.is_subscription ? 1 : 0,
      might_cancel: v.might_cancel ? 1 : 0, auto_record: v.auto_record ? 1 : 0, paused: v.paused ? 1 : 0, day2: v.day2 ? Number(v.day2) : null, account_id: Number(v.account_id) || null,
      to_account_id: Number(v.to_account_id) || null, category_id: Number(v.category_id) || null, end_date: v.end_date || null };
    if (kind === "income" && !body.category_id) delete body.category_id;
    const r = await attempt(() => (isNew ? POST("/api/scheduled", body) : PUT(`/api/scheduled/${s.id}`, body)), isNew ? "Saved." : "Changes saved.");
    if (r) m.close();
  };
}

// ================================================================== goals and categories
export async function goalForm(cat = null) {
  const L = await lookups();
  const groups = L.groups.filter((g) => g.kind === "normal");
  const m = modal({
    title: cat ? `Goal for ${esc(cat.name)}` : "Add a savings goal",
    help: "A goal is a budget category with a target. Home Bank works out how much to set aside each month.",
    body: `<form class="form" data-f>
      ${cat ? "" : `<div class="field full"><span class="muted small">Save in</span><div class="seg" data-which><button type="button" class="on" data-v="new">A new category</button><button type="button" data-v="old">A category I already have</button></div></div>
      <label class="field" data-new><span>Name</span><input name="name" placeholder="New roof" data-help="What you're saving for."></label>
      <label class="field" data-new><span>Group</span><select name="group_id">${groups.map((g) => `<option value="${g.id}" ${g.name === "Savings Goals" ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></label>
      <label class="field full" data-old hidden><span>Category</span><select name="category_id">${categoryOptions(groups, null)}</select></label>`}
      <label class="field full"><span>Kind of goal</span><select name="goal_type" data-help="Pick how you want to save.">
        ${[["target_by_date", "Save a total by a date (e.g. vacation, holidays)"], ["target_balance", "Build up to an amount, no deadline (e.g. emergency fund)"], ["monthly", "Set aside the same amount every month"], ["", "No goal"]]
          .map(([k, l]) => `<option value="${k}" ${(cat?.goal_type ?? "target_by_date") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="field"><span data-amtlabel>Target amount</span><input name="goal_amount" class="money-in" inputmode="decimal" value="${cat?.goal_amount ? dollars(cat.goal_amount) : ""}" placeholder="0.00"></label>
      <label class="field" data-date><span>By when</span><input type="date" name="goal_date" value="${esc(cat?.goal_date || "")}"></label>
      <p class="full muted small" data-calc></p>
    </form>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save goal</button>`,
  });
  const f = m.$("[data-f]");
  let which = "new";
  m.$$("[data-which] button").forEach((b) => b.onclick = () => { which = b.dataset.v; m.$$("[data-which] button").forEach((x) => x.classList.toggle("on", x === b)); m.$$("[data-new]").forEach((x) => (x.hidden = which !== "new")); m.$$("[data-old]").forEach((x) => (x.hidden = which !== "old")); });
  const calc = () => {
    const t = f.goal_type.value;
    m.$("[data-date]").hidden = t !== "target_by_date";
    m.$("[data-amtlabel]").textContent = t === "monthly" ? "Each month" : "Target amount";
    const amt = centsFromInput(f.goal_amount.value) || 0;
    let msg = "";
    if (t === "target_by_date" && amt && f.goal_date.value) {
      const now = new Date(), d = new Date(f.goal_date.value + "T12:00:00");
      const months = Math.max(1, (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth() + 1);
      const have = cat?.available > 0 ? cat.available : 0;
      msg = `That's about <b>${money(Math.ceil(Math.max(0, amt - have) / months))}</b> a month for ${plural(months, "month")}${have ? `, counting the ${money(have)} already saved` : ""}.`;
    }
    m.$("[data-calc]").innerHTML = msg;
  };
  f.addEventListener("input", calc); calc();
  m.$("[data-save]").onclick = async () => {
    const v = formData(f);
    let id = cat?.id;
    try {
      if (!cat && which === "new") {
        if (!v.name.trim()) throw new Error("Give the goal a name.");
        id = (await POST("/api/categories", { name: v.name, group_id: Number(v.group_id) })).id;
      } else if (!cat) id = Number(v.category_id);
      if (!id) throw new Error("Pick a category.");
      await PUT(`/api/categories/${id}`, { goal_type: v.goal_type, goal_amount: centsFromInput(v.goal_amount) || 0, goal_date: v.goal_type === "target_by_date" ? v.goal_date || null : null });
      toast("Goal saved.");
      m.close();
    } catch (e) { toast(e.message, { bad: true }); }
  };
}

export async function categoryForm(cat = null, groupId = null) {
  const L = await lookups();
  const groups = L.groups.filter((g) => g.kind === "normal");
  const m = modal({
    title: cat ? `Change ${esc(cat.name)}` : "Add a category",
    body: `<form class="form" data-f>
      <label class="field"><span>Name</span><input name="name" value="${esc(cat?.name || "")}"></label>
      <label class="field"><span>Group</span><select name="group_id">${groups.map((g) => `<option value="${g.id}" ${(cat?.group_id ?? groupId) == g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></label>
      ${cat ? `<label class="field full"><span>Counts for taxes as</span><select name="tax_kind" data-help="Spending in this category shows up in the year-end tax report.">${[["", "Nothing"], ["charitable", "Charitable giving"], ["medical", "Medical"], ["hsa", "HSA contributions"], ["deductible", "Other tax-deductible"]].map(([k, l]) => `<option value="${k}" ${cat.tax_kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="check full"><input type="checkbox" name="hidden" ${cat.hidden ? "checked" : ""}> Hide this category (keeps its history)</label>
      <label class="field full"><span>Notes</span><textarea name="notes" spellcheck="true">${esc(cat.notes || "")}</textarea></label>` : ""}
    </form>`,
    foot: `${cat ? `<button class="btn danger" data-del>${icon("trash")} Delete</button><span class="spacer"></span>` : ""}<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${cat ? "Save changes" : "Add category"}</button>`,
  });
  const f = m.$("[data-f]");
  m.$("[data-del]")?.addEventListener("click", async () => {
    const others = groups.flatMap((g) => g.categories).filter((c) => c.id !== cat.id);
    const mm = modal({
      title: `Delete ${esc(cat.name)}?`,
      body: `<p><b>${esc(cat.name)}</b> will move to the Deleted page, where you can put it back.</p>
        <label class="field"><span>Move its transactions to</span><select data-to><option value="">Leave them without a category</option>${others.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn danger solid" data-yes>Delete category</button>`,
    });
    mm.$("[data-yes]").onclick = async () => {
      if (await attempt(() => DEL(`/api/categories/${cat.id}`, { move_to: Number(mm.$("[data-to]").value) || null }), "Moved to Deleted.")) { mm.close(); m.close(); }
    };
  });
  m.$("[data-save]").onclick = async () => {
    const v = formData(f);
    const body = { name: v.name, group_id: Number(v.group_id) };
    if (cat) Object.assign(body, { tax_kind: v.tax_kind, hidden: v.hidden ? 1 : 0, notes: v.notes });
    if (await attempt(() => (cat ? PUT(`/api/categories/${cat.id}`, body) : POST("/api/categories", body)), cat ? "Changes saved." : "Category added.")) m.close();
  };
}

// ================================================================== import
function pickFileThenImport(acct) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".csv,.ofx,.qfx,.qif,.txt";
  inp.onchange = () => inp.files[0] && importFlow(inp.files[0], acct);
  inp.click();
}

export async function importFlow(file, accountId = null) {
  const L = await lookups();
  if (!L.accounts.length) { toast("Add the account first, then import its file."); return accountForm(); }
  const data_b64 = await readFileB64(file);
  const m = modal({ title: `Import ${esc(file.name)}`, wide: true, body: `<div data-step></div>`, foot: "" });
  const step = m.$("[data-step]");
  let acct = accountId || Number(localStorage.getItem("hb-import-account")) || L.accounts[0].id;
  let preview = null, mapping = null;

  const chooseAccount = () => {
    step.innerHTML = `<p class="muted">Which account is this file from?</p>
      <label class="field"><span>Account</span><select data-acct>${accountOptions(L.accounts, acct)}</select></label>
      <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" data-next>Read the file</button></div>`;
    step.querySelector("[data-close]").onclick = m.close;
    step.querySelector("[data-next]").onclick = () => { acct = Number(step.querySelector("[data-acct]").value); localStorage.setItem("hb-import-account", acct); load(); };
  };
  const load = async () => {
    step.innerHTML = `<p class="muted">Reading…</p>`;
    try {
      preview = await POST("/api/import/preview", { account_id: acct, filename: file.name, data_b64, mapping });
    } catch (e) { step.innerHTML = `<p class="bad">${esc(e.message)}</p><button class="btn" data-back>Back</button>`; step.querySelector("[data-back]").onclick = chooseAccount; return; }
    if (preview.needs_mapping) return mapColumns();
    review();
  };
  const mapColumns = () => {
    const h = preview.header, mp = preview.mapping;
    const sel = (field, label, help) => `<label class="field"><span>${label}</span><select data-map="${field}" data-help="${esc(help)}"><option value="">(none)</option>${h.map((c, i) => `<option value="${i}" ${mp.columns[field] === i ? "selected" : ""}>${esc(c || "Column " + (i + 1))}</option>`).join("")}</select></label>`;
    step.innerHTML = `<p>This is the first file from this bank, so tell Home Bank which column is which. It'll remember next time.</p>
      <div class="form">
        ${sel("date", "Date", "The column with the transaction date.")}
        ${sel("payee", "Payee / description", "Who was paid. Usually 'Description'.")}
        ${sel("amount", "Amount (one column)", "Use this if the file has one amount column with minus signs for money out.")}
        ${sel("debit", "Money out (if separate)", "Use this and Money in if the file has two amount columns.")}
        ${sel("credit", "Money in (if separate)", "")}
        ${sel("memo", "Memo (optional)", "")}
        ${sel("id", "Transaction ID (optional)", "A unique reference number. Helps spot duplicates.")}
        <label class="field"><span>Bank name</span><input data-bank placeholder="My bank"></label>
        <label class="check"><input type="checkbox" data-flip ${mp.flip_sign ? "checked" : ""}> Money out shows as a positive number (flip signs)</label>
        <label class="check"><input type="checkbox" data-dayfirst ${mp.day_first ? "checked" : ""}> Dates are day/month/year</label>
      </div>
      <h3 style="margin-top:18px">First rows of the file</h3>
      <div style="overflow:auto"><table class="list small"><thead><tr>${h.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${preview.sample.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="modal-foot"><button class="btn" data-back>Back</button><button class="btn primary" data-next>Use these columns</button></div>`;
    step.querySelector("[data-back]").onclick = chooseAccount;
    step.querySelector("[data-next]").onclick = () => {
      const cols = {};
      step.querySelectorAll("[data-map]").forEach((s) => { if (s.value !== "") cols[s.dataset.map] = Number(s.value); });
      if (cols.date === undefined || (cols.amount === undefined && cols.debit === undefined && cols.credit === undefined)) { toast("Pick at least the date and an amount column.", { bad: true }); return; }
      mapping = { columns: cols, flip_sign: step.querySelector("[data-flip]").checked, day_first: step.querySelector("[data-dayfirst]").checked };
      preview.bank_name = step.querySelector("[data-bank]").value;
      load();
    };
  };
  const review = () => {
    const rows = preview.rows;
    const sum = preview.summary;
    step.innerHTML = `<p>Found <b>${plural(sum.count, "transaction")}</b>.
        ${sum.duplicates ? `<span class="pill warn">${plural(sum.duplicates, "looks", "look")} like ${sum.duplicates === 1 ? "a duplicate" : "duplicates"}, unticked</span>` : ""}
        ${sum.transfers ? `<span class="pill accent">${plural(sum.transfers, "transfer")} matched</span>` : ""}</p>
      ${preview.problems?.length ? `<p class="warn small">${esc(preview.problems.slice(0, 3).join(" · "))}</p>` : ""}
      <div style="max-height:52vh;overflow:auto"><table class="list cards"><thead><tr><th></th><th>Date</th><th>Payee</th><th>Category</th><th class="amt">Amount</th><th>Note</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td><input type="checkbox" data-inc="${i}" ${r.include ? "checked" : ""} data-help="Untick to skip this one."></td>
        <td data-label="Date">${esc(niceDate(r.date))}</td><td class="lead ellipsis" title="${esc(r.original_payee)}">${esc(r.payee)}</td>
        <td data-label="Category"><select data-cat="${i}" style="min-width:150px">${categoryOptions(L.groups, r.category_id, { blank: r.transfer_match ? "Transfer" : "Pick later" })}</select></td>
        <td class="amt ${r.amount > 0 ? "in" : ""}">${money(r.amount)}</td>
        <td class="small">${r.duplicate ? `<span class="pill warn" data-help="${esc(r.duplicate.why)}: ${esc(r.duplicate.payee)} on ${esc(r.duplicate.date)}">Duplicate?</span>` : ""}${r.transfer_match ? `<span class="pill accent" data-help="Matches ${esc(r.transfer_match.payee)} in ${esc(r.transfer_match.account_name)}">Transfer from ${esc(r.transfer_match.account_name)}</span>` : ""}${r.status === "pending" ? `<span class="pill">Pending</span>` : ""}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Import ${plural(rows.filter((r) => r.include).length, "transaction")}</button></div>`;
    const go = step.querySelector("[data-go]");
    step.addEventListener("change", (e) => {
      if (e.target.dataset.inc !== undefined) rows[e.target.dataset.inc].include = e.target.checked;
      if (e.target.dataset.cat !== undefined) rows[e.target.dataset.cat].category_id = Number(e.target.value) || null;
      go.textContent = `Import ${plural(rows.filter((r) => r.include).length, "transaction")}`;
    });
    step.querySelector("[data-close]").onclick = m.close;
    go.onclick = async () => {
      const r = await attempt(() => POST("/api/import/commit", { account_id: acct, rows, mapping: preview.mapping || mapping, signature: preview.signature, bank_name: preview.bank_name || "" }));
      if (r) { toast(`Imported ${plural(r.added, "transaction")}${r.transfers_linked ? `, ${plural(r.transfers_linked, "transfer")} matched` : ""}.`); m.close(); window.navigate(`#/register?account=${acct}`); }
    };
  };
  chooseAccount();
}
