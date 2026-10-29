import { icon } from "../icons.js";
import { GET, POST, PUT, toast, esc, money, niceDate, attempt, monthName, thisMonth, todayIso, plural, modal, centsFromInput, dollars, formData } from "../ui.js";
import { w } from "../words.js";
import { scheduleForm } from "../forms.js";

export default {
  async render(ctx) {
    const month = ctx.params.month || thisMonth();
    const [ov, cal] = await Promise.all([GET("/api/bills/overview"), GET(`/api/bills/calendar?month=${month}`)]);
    const tab = ctx.params.tab || "list";
    const income = ov.items.filter((i) => i.kind === "income");
    const bills = ov.items.filter((i) => i.kind === "bill");
    const transfers = ov.items.filter((i) => i.kind === "transfer");
    const row = (s) => `<tr class="clickable" data-edit="${s.id}" data-help="Tap to change it.">
        <td class="lead">${esc(s.name)} ${s.paused ? `<span class="pill warn" data-help="Paused: not in the forecast or reminders.">Paused</span> ` : ""}${s.auto_record ? `<span class="pill good" data-help="Entered automatically on its date.">Automatic</span> ` : ""}${s.autopay ? `<span class="pill" data-help="Paid automatically.">Autopay</span>` : ""}${s.is_subscription ? ` <span class="pill accent">Subscription</span>` : ""}${s.person ? ` <span class="pill">${esc(s.person)}</span>` : ""}</td>
        <td data-label="How often" class="muted">${esc(s.frequency_label)}</td>
        <td data-label="Next" class="${s.days_until !== null && s.days_until <= 3 ? "warn" : ""}">${s.upcoming ? esc(niceDate(s.upcoming)) + (s.days_until === 0 ? " (today)" : s.days_until === 1 ? " (tomorrow)" : "") : "—"}</td>
        <td data-label="Account" class="muted small hide-phone">${esc(s.account_name || "")}${s.to_account_name ? " → " + esc(s.to_account_name) : ""}</td>
        <td class="amt"><span class="money ${s.kind === "income" ? "in" : ""}">${money(s.amount)}</span></td>
        <td class="actions"><button class="btn sm" data-record="${s.id}" data-help="Record this as a real transaction now and move the next date along.">Record it</button>
          <button class="btn sm ghost" data-skip="${s.id}" data-help="Skip the next one without recording it. The date moves to the one after.">Skip</button>
          <button class="btn sm ghost" data-pause="${s.id}" data-help="${s.paused ? "Start it again." : "Stop it for now without deleting it."}">${s.paused ? "Resume" : "Pause"}</button></td></tr>`;
    const table = (list, empty) => list.length ? `<table class="list cards"><thead><tr><th>Name</th><th>How often</th><th>Next</th><th class="hide-phone">Account</th><th class="amt">Amount</th><th></th></tr></thead><tbody>${list.map(row).join("")}</tbody></table>` : `<p class="muted">${empty}</p>`;
    // calendar grid
    const first = new Date(month + "-01T12:00:00");
    const startDow = first.getDay();
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    let cells = "";
    for (let i = 0; i < startDow; i++) cells += `<div class="day out"></div>`;
    for (let d = 1; d <= days; d++) {
      const iso = `${month}-${String(d).padStart(2, "0")}`;
      const evs = cal.days[iso] || [];
      cells += `<div class="day ${iso === todayIso() ? "today" : ""}"><div class="n">${d}</div>${evs.map((e) => `<div class="ev ${e.kind}" data-help="${esc(e.name)}: ${money(Math.abs(e.amount))}">${esc(e.name)}</div>`).join("")}</div>`;
    }
    ctx.el.innerHTML = `
      <div class="grid g3" style="margin-bottom:var(--gap)">
        <div class="card rise" data-help="All paychecks and income, converted to a monthly amount."><div class="muted">Income per month</div><div class="stat"><span class="value good">${money(ov.monthly_income)}</span></div></div>
        <div class="card rise" data-help="All bills, converted to a monthly amount."><div class="muted">Bills per month</div><div class="stat"><span class="value">${money(ov.monthly_bills)}</span></div></div>
        <div class="card rise" data-help="Income minus bills. What's left for everything else."><div class="muted">Left after bills</div><div class="stat"><span class="value">${money(ov.monthly_income - ov.monthly_bills)}</span></div></div>
      </div>
      <div class="row between" style="margin-bottom:12px">
        <div class="seg"><button data-tab="list" class="${tab === "list" ? "on" : ""}">List</button><button data-tab="calendar" class="${tab === "calendar" ? "on" : ""}">Calendar</button><button data-tab="subs" class="${tab === "subs" ? "on" : ""}">Subscriptions</button></div>
        <div class="row"><button class="btn" data-detect data-help="Look through your transactions for charges and paychecks that repeat.">${icon("sparkle")} Find repeating charges</button>
          <button class="btn primary" data-add>${icon("plus")} ${w("bills.add", "Add recurring")}</button></div>
      </div>
      ${ov.price_alerts.length ? `<div class="card rise" style="margin-bottom:var(--gap);border-color:color-mix(in srgb,var(--warn) 50%,var(--line))"><b>Price went up</b>
        ${ov.price_alerts.map((p) => `<div class="look"><div class="what">${esc(p.name)}<small>${money(p.old)} → ${money(p.new)} on ${esc(niceDate(p.date))}</small></div><button class="btn sm ghost" data-dismiss="${esc(p.key)}">Got it</button></div>`).join("")}</div>` : ""}
      ${tab === "list" ? `<div class="stack">
        <section class="card rise"><div class="card-head"><h2>${w("rec.in", "Money in: paychecks and income")}</h2><button class="btn sm" data-addk="income">${icon("plus")} Add money in</button></div>${table(income, "Add each paycheck so the forecast knows when money comes in. Use 'Every 2 weeks' for biweekly pay or 'Twice a month' for the 1st and 15th.")}</section>
        <section class="card rise"><div class="card-head"><h2>${w("rec.out", "Money out: bills and subscriptions")}</h2><button class="btn sm" data-addk="bill">${icon("plus")} Add money out</button></div>${table(bills, "No bills yet. Add them, or let Home Bank find repeating charges for you.")}</section>
        <section class="card rise"><div class="card-head"><h2>${w("rec.move", "Moving money: regular transfers")}</h2><button class="btn sm" data-addk="transfer">${icon("plus")} Add transfer</button></div>${table(transfers, "Like moving money to savings every payday, or paying a card from checking.")}</section>
      </div>` : ""}
      ${tab === "calendar" ? `<section class="card rise">
        <div class="row between" style="margin-bottom:12px"><a class="btn icon" href="#/bills?tab=calendar&month=${cal.prev}">${icon("left")}</a><h2 style="margin:0">${esc(monthName(month))}</h2><a class="btn icon" href="#/bills?tab=calendar&month=${cal.next}">${icon("right")}</a></div>
        <div class="cal">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="dow">${d}</div>`).join("")}${cells}</div>
        <div class="legend" style="margin-top:10px"><span><i class="dot" style="background:var(--good)"></i>Paychecks</span><span><i class="dot" style="background:var(--accent)"></i>Bills</span></div></section>` : ""}
      ${tab === "subs" ? `<section class="card rise"><div class="card-head"><h2>Subscriptions</h2><span class="muted">${money(ov.subscriptions.reduce((a, s) => a + s.yearly_cost, 0))} a year</span></div>
        ${ov.subscriptions.length ? `<table class="list cards"><thead><tr><th>Subscription</th><th class="amt">Per month</th><th class="amt">Per year</th><th>Might cancel?</th></tr></thead><tbody>
        ${ov.subscriptions.map((s) => `<tr><td class="lead">${esc(s.name)}</td><td class="amt money">${money(s.monthly_cost)}</td><td class="amt money">${money(s.yearly_cost)}</td>
          <td data-label="Might cancel"><label class="switch" data-help="Mark subscriptions you're thinking about cancelling. They go to the top of this list."><input type="checkbox" data-cancel="${s.id}" ${s.might_cancel ? "checked" : ""}><span></span></label></td></tr>`).join("")}</tbody></table>
        <p class="muted small">Cancelling the ones marked would save ${money(ov.subscriptions.filter((s) => s.might_cancel).reduce((a, s) => a + s.yearly_cost, 0))} a year.</p>`
        : `<p class="muted">Mark a bill as a subscription to see it here.</p>`}</section>` : ""}`;

    ctx.el.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => ctx.go(`#/bills?tab=${b.dataset.tab}${ctx.params.month ? "&month=" + ctx.params.month : ""}`));
    ctx.el.querySelector("[data-add]").onclick = () => scheduleForm();
    ctx.el.querySelectorAll("[data-addk]").forEach((b) => b.onclick = () => scheduleForm(null, { kind: b.dataset.addk }));
    ctx.el.querySelectorAll("[data-edit]").forEach((r) => r.addEventListener("click", (e) => { if (!e.target.closest("button")) scheduleForm(ov.items.find((s) => s.id == r.dataset.edit)); }));
    ctx.el.querySelectorAll("[data-record]").forEach((b) => b.onclick = () => recordIt(ov.items.find((s) => s.id == b.dataset.record)));
    ctx.el.querySelectorAll("[data-skip]").forEach((b) => b.onclick = () => attempt(() => POST(`/api/scheduled/${b.dataset.skip}/skip`), "Skipped."));
    ctx.el.querySelectorAll("[data-pause]").forEach((b) => b.onclick = () => { const s = ov.items.find((x) => x.id == b.dataset.pause); attempt(() => PUT(`/api/scheduled/${s.id}`, { paused: s.paused ? 0 : 1 }), s.paused ? "Resumed." : "Paused."); });
    ctx.el.querySelectorAll("[data-dismiss]").forEach((b) => b.onclick = () => attempt(() => POST("/api/dismiss", { key: b.dataset.dismiss })));
    ctx.el.querySelectorAll("[data-cancel]").forEach((c) => c.onchange = () => attempt(() => PUT(`/api/scheduled/${c.dataset.cancel}`, { might_cancel: c.checked ? 1 : 0 })));
    ctx.el.querySelector("[data-detect]").onclick = detect;
  },
};


function recordIt(s) {
  const m = modal({
    title: `Record ${esc(s.name)}`,
    body: `<form class="form" data-f><label class="field"><span>Amount</span><input name="amount" class="money-in" value="${dollars(s.amount)}"></label>
      <label class="field"><span>Date</span><input type="date" name="date" value="${esc(s.next_date)}"></label></form>
      <p class="muted small">This adds the transaction to ${esc(s.account_name || "the account")} and moves the next date along.</p>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Record this ${s.kind === "income" ? "paycheck" : "payment"}</button>`,
  });
  m.$("[data-go]").onclick = async () => {
    const v = formData(m.$("[data-f]"));
    if (await attempt(() => POST(`/api/scheduled/${s.id}/record`, { amount: centsFromInput(v.amount), date: v.date }), "Recorded.")) m.close();
  };
}

async function detect() {
  const { found } = await GET("/api/bills/detect");
  const fresh = found.filter((f) => !f.already_scheduled);
  const m = modal({
    title: "Repeating charges and paychecks", wide: true,
    body: fresh.length ? `<p class="muted">These repeat on a regular rhythm. Tick the ones to keep track of.</p>
      <table class="list cards"><thead><tr><th></th><th>Payee</th><th>What</th><th>How often</th><th>Next</th><th class="amt">Amount</th></tr></thead><tbody>
      ${fresh.map((f, i) => `<tr><td><input type="checkbox" data-i="${i}" checked></td><td class="lead">${esc(f.payee)}</td><td data-label="What">${f.kind === "income" ? "Paycheck" : "Bill"}</td><td data-label="How often">${esc(f.frequency_label)} (${f.count} times)</td><td data-label="Next">${esc(niceDate(f.next_date))}</td>
        <td class="amt money">${money(f.amount)}${f.price_increase ? `<div class="small warn">up ${money(f.price_increase)}</div>` : ""}</td></tr>`).join("")}</tbody></table>`
      : `<p class="muted">Nothing new found. Home Bank needs at least three charges from the same payee to spot a pattern.</p>`,
    foot: fresh.length ? `<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Add the ticked ones</button>` : `<button class="btn" data-close>Close</button>`,
  });
  m.$("[data-go]")?.addEventListener("click", async () => {
    const picks = m.$$("[data-i]:checked").map((c) => fresh[Number(c.dataset.i)]);
    for (const f of picks) {
      await POST("/api/scheduled", { kind: f.kind, name: f.payee, payee: f.payee, amount: f.amount, frequency: f.frequency, next_date: f.next_date,
        account_id: f.account_id, category_id: f.kind === "bill" ? f.category_id : null }).catch(() => {});
    }
    m.close();
    toast(`Added ${plural(picks.length, "item")}.`);
  });
}
