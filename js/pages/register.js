import { icon } from "../icons.js";
import { GET, POST, PUT, esc, money, niceDate, attempt, confirmBox, accountOptions, categoryOptions, centsFromInput, dollars, plural, toast, todayIso } from "../ui.js";
import { w } from "../words.js";
import { txnForm, importFlow, transferForm } from "../forms.js";

export default {
  async render(ctx) {
    const p = ctx.params;
    const acct = p.account ? Number(p.account) : null;
    const qs = new URLSearchParams();
    for (const k of ["account", "q", "category", "start", "end", "status", "tag", "uncategorized", "review"]) if (p[k]) qs.set(k, p[k]);
    qs.set("limit", p.limit || 300);
    const [data, cats, accts] = await Promise.all([GET("/api/transactions?" + qs), GET("/api/categories"), GET("/api/accounts")]);
    const rows = data.transactions;
    const a = data.account;
    const showRunning = rows.length && rows[0].running !== undefined;
    const reconciling = p.reconcile === "1" && a;
    const set = (k, v) => { const n = { ...p }; if (v === "" || v === null || v === undefined) delete n[k]; else n[k] = v; delete n.limit; ctx.go("#/register?" + new URLSearchParams(n)); };
    const filtersOn = ["q", "category", "start", "end", "status", "tag", "uncategorized", "review"].some((k) => p[k]);

    ctx.el.innerHTML = `
      ${a ? `<div class="card rise" style="margin-bottom:var(--gap)"><div class="row between">
          <div><h2 style="margin:0">${esc(a.name)} <span class="faint small">${esc(a.masked)}</span></h2><span class="muted small">${esc(a.type_label)}${a.institution ? " at " + esc(a.institution) : ""}</span></div>
          <div class="row" style="gap:28px">
            <div data-help="Everything the bank has finished."><div class="muted small">Cleared</div><b class="money">${money(a.cleared)}</b></div>
            <div data-help="Charges the bank hasn't finished yet."><div class="muted small">Pending</div><b class="money">${money(a.pending)}</b></div>
            <div data-help="Cleared plus pending."><div class="muted small">Balance</div><b class="money" style="font-size:1.3em">${money(a.balance)}</b></div>
          </div></div></div>` : ""}
      ${reconciling ? `<div class="card rise" data-recon style="margin-bottom:var(--gap);border-color:var(--accent)">
          <div class="card-head"><h2>Reconcile with your statement</h2><a class="btn sm ghost" href="#/register?account=${a.id}">Close</a></div>
          <p class="muted small">Type the ending balance from your bank statement. Then tick each transaction that's on the statement until the difference is $0.00.</p>
          <div class="row" style="gap:24px;align-items:flex-end">
            <label class="field" style="max-width:220px"><span>Statement ending balance</span><input data-stmt class="money-in" inputmode="decimal" placeholder="0.00"></label>
            <div><div class="muted small">Cleared in Home Bank</div><b class="money" data-cleared>${money(a.cleared)}</b></div>
            <div><div class="muted small">Difference</div><b class="money" data-diff>—</b></div>
            <span class="spacer"></span>
            <button class="btn" data-adjust data-help="Add a one-time adjustment for the difference and finish. Use this only if you can't find what's missing.">Add adjustment and finish</button>
            <button class="btn primary" data-finish data-help="Lock in everything ticked as reconciled.">Finish reconciling</button>
          </div></div>` : ""}
      <div class="row" style="margin-bottom:12px">
        <select data-acct style="max-width:240px" data-help="Show one account, or all of them together.">${`<option value="">All accounts</option>` + accountOptions(accts.accounts, acct)}</select>
        <input type="search" data-q value="${esc(p.q || "")}" placeholder="Search payee, note, category or amount" style="max-width:300px" data-help="Search as you type. Amounts work too, like 42.50.">
        <select data-cat style="max-width:200px" data-help="Show only one category.">${categoryOptions(cats.groups, p.category, { blank: "All categories", payments: true })}</select>
        <select data-status style="max-width:150px" data-help="Show only pending, cleared or reconciled transactions.">${[["", "Any status"], ["pending", "Pending"], ["cleared", "Cleared"], ["reconciled", "Reconciled"]].map(([v, l]) => `<option value="${v}" ${p.status === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <input type="date" data-start value="${esc(p.start || "")}" style="max-width:160px" data-help="Show from this date.">
        <input type="date" data-end value="${esc(p.end || "")}" style="max-width:160px" data-help="Show up to this date.">
        ${filtersOn ? `<button class="btn ghost sm" data-clear>Clear filters</button>` : ""}
        <span class="spacer"></span>
        <button class="btn" data-import data-help="Bring in a bank file (CSV, OFX, QFX or QIF).">${icon("import")} Import</button>
        <button class="btn" data-transfer>${icon("transfer")} Transfer</button>
        <button class="btn primary" data-add>${icon("plus")} ${w("reg.add", "Add transaction")}</button>
      </div>
      <div class="row" style="margin-bottom:10px;gap:8px">
        <button class="btn sm ${p.review ? "primary" : ""}" data-toggle="review" data-help="Imported transactions waiting for you to check them.">Needs a look</button>
        <button class="btn sm ${p.uncategorized ? "primary" : ""}" data-toggle="uncategorized" data-help="Transactions without a category yet.">No category</button>
        ${cats.tags.slice(0, 6).map((t) => `<button class="btn sm ${p.tag === t.name ? "primary" : ""}" data-tag="${esc(t.name)}">${esc(t.name)}</button>`).join("")}
      </div>
      <div class="card rise" data-bulk hidden style="margin-bottom:10px;padding:10px 14px"><div class="row">
        <b data-count></b><span class="spacer"></span>
        <select data-bulkcat style="max-width:240px">${categoryOptions(cats.groups, null, { blank: "Set category to…" })}</select>
        <button class="btn sm" data-b="approve" data-help="Mark these as checked so they leave 'Needs a look'.">Mark checked</button>
        <button class="btn sm" data-b="cleared">Mark cleared</button>
        <button class="btn sm danger" data-b="delete">${icon("trash")} Delete</button></div></div>
      <div class="card rise" style="padding:4px var(--pad) 10px">
        ${rows.length ? `<table class="list cards"><thead><tr><th style="width:28px"><input type="checkbox" data-all data-help="Select everything shown."></th><th>Date</th><th>Payee</th><th>Category</th>${acct ? "" : "<th>Account</th>"}<th class="amt">Amount</th>${showRunning ? `<th class="amt hide-phone">Balance</th>` : ""}<th style="width:30px"></th></tr></thead><tbody>
        ${rows.map((t) => `<tr class="clickable" data-id="${t.id}">
          <td class="hide-phone"><input type="checkbox" data-sel="${t.id}"></td>
          <td data-label="Date" class="muted">${esc(niceDate(t.date))}</td>
          <td class="lead"><div class="ellipsis">${esc(t.payee || "No payee")}${t.needs_review ? ` <span class="pill warn" data-help="Imported and waiting for you to check it.">New</span>` : ""}${t.attachments.length ? ` <span class="faint" data-help="Has a receipt attached.">${icon("receipt").replace("<svg", '<svg style="width:14px;height:14px;vertical-align:-2px"')}</span>` : ""}</div>
            ${t.notes || t.tags.length ? `<div class="small muted ellipsis">${t.tags.map((g) => `<span class="pill" style="font-size:.75em">${esc(g.name)}</span>`).join(" ")} ${esc(t.notes || "")}</div>` : ""}</td>
          <td data-label="Category">${t.category_label ? `<span class="${t.transfer_txn_id ? "pill accent" : ""}">${esc(t.category_label)}</span>` : t.on_budget && !t.transfer_txn_id ? `<span class="pill warn">Needs category</span>` : ""}</td>
          ${acct ? "" : `<td data-label="Account" class="muted small">${esc(t.account_name)}</td>`}
          <td class="amt"><span class="money ${t.amount > 0 ? "in" : ""}">${money(t.amount)}</span></td>
          ${showRunning ? `<td class="amt hide-phone muted money">${money(t.running)}</td>` : ""}
          <td class="hide-phone"><button class="btn icon ghost sm" data-status="${t.id}" data-help="${t.status === "pending" ? "Pending at the bank. Tap to mark cleared." : t.status === "reconciled" ? "Reconciled with a statement." : "Cleared. Tap to mark pending."}" style="color:${t.status === "pending" ? "var(--warn)" : t.status === "reconciled" ? "var(--good)" : "var(--dim)"}">${t.status === "reconciled" ? icon("lock") : t.status === "cleared" ? icon("check") : icon("history")}</button></td>
        </tr>`).join("")}</tbody></table>
        ${rows.length >= (Number(p.limit) || 300) ? `<div class="center" style="margin-top:10px"><button class="btn" data-more>Show more</button></div>` : ""}`
        : `<div class="empty"><b>${filtersOn ? "Nothing matches" : "No transactions yet"}</b>${filtersOn ? "Try clearing the filters." : "Add one with the button above, or import a file from your bank."}</div>`}
      </div>`;

    const $ = (s) => ctx.el.querySelector(s);
    $("[data-acct]").onchange = (e) => set("account", e.target.value);
    let qt = null;
    $("[data-q]").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => set("q", e.target.value.trim()), 450); });
    if (p.q) { const q = $("[data-q]"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    $("[data-cat]").onchange = (e) => set("category", e.target.value);
    $("[data-status]").onchange = (e) => set("status", e.target.value);
    $("[data-start]").onchange = (e) => set("start", e.target.value);
    $("[data-end]").onchange = (e) => set("end", e.target.value);
    $("[data-clear]")?.addEventListener("click", () => ctx.go("#/register" + (acct ? `?account=${acct}` : "")));
    ctx.el.querySelectorAll("[data-toggle]").forEach((b) => b.onclick = () => set(b.dataset.toggle, p[b.dataset.toggle] ? "" : "1"));
    ctx.el.querySelectorAll("[data-tag]").forEach((b) => b.onclick = () => set("tag", p.tag === b.dataset.tag ? "" : b.dataset.tag));
    $("[data-add]").onclick = () => txnForm(null, { account_id: acct, category_id: p.category ? Number(p.category) : null });
    $("[data-transfer]").onclick = () => transferForm({ from_id: acct });
    $("[data-import]").onclick = () => { const i = document.createElement("input"); i.type = "file"; i.accept = ".csv,.ofx,.qfx,.qif,.txt"; i.onchange = () => i.files[0] && importFlow(i.files[0], acct); i.click(); };
    $("[data-more]")?.addEventListener("click", () => { const n = { ...p, limit: (Number(p.limit) || 300) + 500 }; ctx.go("#/register?" + new URLSearchParams(n)); });
    ctx.el.querySelectorAll("tr[data-id]").forEach((r) => r.addEventListener("click", (e) => {
      if (e.target.closest("input, button, a")) return;
      const t = rows.find((x) => x.id == r.dataset.id);
      if (reconciling) return toggleCleared(t, r);
      txnForm(t);
    }));
    ctx.el.querySelectorAll("[data-status]").forEach((b) => b.onclick = () => {
      const t = rows.find((x) => x.id == b.dataset.status);
      if (t.status === "reconciled") { toast("This one is reconciled. Open it to change it."); return; }
      attempt(() => PUT(`/api/transactions/${t.id}`, { status: t.status === "pending" ? "cleared" : "pending" }));
    });
    // selecting several
    const bulk = $("[data-bulk]");
    const selected = () => [...ctx.el.querySelectorAll("[data-sel]:checked")].map((c) => Number(c.dataset.sel));
    const updBulk = () => {
      const s = selected();
      bulk.hidden = !s.length;
      $("[data-count]") && ($("[data-count]").textContent = `${plural(s.length, "transaction")} selected`);
      ctx.el.querySelectorAll("tr[data-id]").forEach((r) => r.classList.toggle("sel", s.includes(Number(r.dataset.id))));
    };
    ctx.el.addEventListener("change", (e) => { if (e.target.dataset.sel !== undefined) updBulk(); });
    $("[data-all]")?.addEventListener("change", (e) => { ctx.el.querySelectorAll("[data-sel]").forEach((c) => (c.checked = e.target.checked)); updBulk(); });
    $("[data-bulkcat]").onchange = async (e) => {
      if (!e.target.value) return;
      const s = selected();
      const r = await attempt(() => POST("/api/transactions/bulk", { ids: s, action: "category", category_id: Number(e.target.value) }));
      if (r) toast(`Changed ${plural(r.changed, "transaction")}.${r.changed < s.length ? " Split transactions and transfers were skipped." : ""}`);
    };
    ctx.el.querySelectorAll("[data-b]").forEach((b) => b.onclick = async () => {
      const s = selected();
      if (b.dataset.b === "delete" && !(await confirmBox({ title: `Delete ${plural(s.length, "transaction")}?`, text: "They'll move to the Deleted page, where you can put them back.", yes: "Delete them", danger: true }))) return;
      const r = await attempt(() => POST("/api/transactions/bulk", { ids: s, action: b.dataset.b }));
      if (r) toast(`Done: ${plural(r.changed, "transaction")}.`);
    });
    // reconciling
    if (reconciling) {
      let cleared = a.cleared;
      const stmt = $("[data-stmt]"), diff = $("[data-diff]");
      const upd = () => {
        const s = centsFromInput(stmt.value);
        $("[data-cleared]").textContent = money(cleared);
        if (s === null) { diff.textContent = "—"; return; }
        const d = s - cleared;
        diff.textContent = money(d);
        diff.className = "money " + (d === 0 ? "good" : "bad");
      };
      const card = $("[data-recon]");
      card.dataset.dirty = "1"; // keep this page still while reconciling
      stmt.value = sessionStorage.getItem("hb-stmt-" + a.id) || "";
      stmt.addEventListener("input", () => { sessionStorage.setItem("hb-stmt-" + a.id, stmt.value); upd(); });
      upd();
      const toggleCleared = async (t, r) => {
        if (t.status === "reconciled") return;
        const ns = t.status === "pending" ? "cleared" : "pending";
        cleared += ns === "cleared" ? t.amount : -t.amount;
        t.status = ns; upd();
        const btn = r.querySelector("[data-status]");
        if (btn) { btn.style.color = ns === "pending" ? "var(--warn)" : "var(--dim)"; btn.innerHTML = ns === "cleared" ? icon("check") : icon("history"); }
        await PUT(`/api/transactions/${t.id}`, { status: ns }).catch((e) => toast(e.message, { bad: true }));
      };
      window.__toggleCleared = toggleCleared;
      $("[data-finish]").onclick = () => finish(false);
      $("[data-adjust]").onclick = () => finish(true);
      const finish = async (adjust) => {
        const s = centsFromInput(stmt.value);
        if (s === null) { toast("Type the statement balance first.", { bad: true }); return; }
        if (await attempt(() => POST(`/api/accounts/${a.id}/reconcile`, { statement_balance: s, adjust, date: todayIso() }), "Reconciled.")) {
          delete card.dataset.dirty; sessionStorage.removeItem("hb-stmt-" + a.id); ctx.go(`#/register?account=${a.id}`);
        }
      };
    }
    function toggleCleared(t, r) { window.__toggleCleared?.(t, r); }
  },
};
