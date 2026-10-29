import { icon } from "../icons.js";
import { GET, POST, esc, money, dollars, centsFromInput, attempt, lineChart, monthName, plural, modal, formData, todayIso, thisMonth } from "../ui.js";
import { w } from "../words.js";
import { accountForm } from "../forms.js";

const yrs = (m) => (m === null || m === undefined ? "never" : m < 12 ? plural(m, "month") : `${Math.floor(m / 12)} yr${Math.floor(m / 12) === 1 ? "" : "s"}${m % 12 ? " " + (m % 12) + " mo" : ""}`);

export default {
  async render(ctx) {
    const extra = ctx.params.extra || "0";
    const exclude = ctx.params.exclude || "";
    const d = await GET(`/api/debt?extra=${encodeURIComponent(extra)}&exclude=${exclude}`);
    const skip = new Set(d.excluded);
    const plan = (key, title, desc) => {
      const p = d[key];
      return `<section class="card rise" data-help="${esc(desc)}">
        <div class="card-head"><h2>${title}</h2>${key === "avalanche" && d.avalanche.interest <= d.snowball.interest && d.debts.length > 1 ? `<span class="pill good">Least interest</span>` : key === "snowball" && d.debts.length > 1 ? `<span class="pill accent">Quickest wins</span>` : ""}</div>
        <p class="muted small" style="margin-top:-6px">${desc}</p>
        ${p.months ? `<div class="grid g2" style="gap:10px;margin:12px 0">
          <div><div class="muted small">Debt-free</div><b style="font-size:1.3em">${esc(monthName(p.payoff_month))}</b><div class="small muted">${yrs(p.months)}</div></div>
          <div><div class="muted small">Total interest</div><b class="money" style="font-size:1.3em">${money(p.interest)}</b>${p.interest_saved ? `<div class="small good">Saves ${money(p.interest_saved)} vs minimums only</div>` : ""}</div></div>
          <div class="muted small">Pay off in this order:</div>
          <ol style="margin:6px 0 0;padding-left:20px">${p.debts.filter((x) => x.paid_month).sort((a, b) => a.paid_month.localeCompare(b.paid_month)).map((x) => `<li>${esc(x.name)} <span class="muted small">paid off ${esc(monthName(x.paid_month))}</span></li>`).join("")}</ol>`
        : `<p class="bad">At these payments the debt never gets paid off. Raise the minimums or add extra.</p>`}</section>`;
    };
    const labels = [], months = Math.max(d.snowball.timeline.length, d.avalanche.timeline.length, d.minimum_only.timeline.length);
    const step = Math.max(1, Math.ceil(months / 60));
    ctx.el.innerHTML = `
      ${!d.debts.length ? `<div class="card empty"><b>No debts to plan</b>Add your credit cards, loans and mortgage on the Accounts page with their interest rate and minimum payment.<div style="margin-top:14px"><button class="btn primary" data-addacct>${icon("plus")} Add a debt</button></div></div>` : `
      <section class="card rise" style="margin-bottom:var(--gap)">
        <div class="row between"><div><div class="muted">Total owed${skip.size ? " (in this plan)" : ""}</div><div class="stat"><span class="value bad">${money(d.total)}</span></div></div>
          <div style="flex:1;min-width:260px;max-width:520px">
            <label class="field"><span>Extra each month on top of minimums: <b data-extra-val style="color:var(--text)">${money(centsFromInput(extra) || 0)}</b></span>
              <input type="range" min="0" max="200000" step="2500" value="${centsFromInput(extra) || 0}" data-extra data-help="Slide to see how paying a bit extra each month changes the payoff date and the interest."></label>
          </div></div>
        ${d.missing_minimums.length ? `<p class="warn small">Add a minimum payment for ${esc(d.missing_minimums.join(", "))} on the Accounts page for an accurate plan.</p>` : ""}
      </section>
      <div class="grid g2">
        ${plan("snowball", "Snowball", "Pay the smallest balance first. Each payoff frees up money for the next. Feels great, fast.")}
        ${plan("avalanche", "Avalanche", "Pay the highest interest rate first. Costs the least overall.")}
      </div>
      <section class="card rise" style="margin-top:var(--gap)">
        <div class="card-head"><h2>Balance over time</h2><span class="muted small">Minimums only: ${d.minimum_only.months ? `debt-free ${esc(monthName(d.minimum_only.payoff_month))}, ${money(d.minimum_only.interest)} interest` : "never paid off"}</span></div>
        ${lineChart({
          labels: Array.from({ length: Math.ceil(months / step) }, (_, i) => { const m = new Date(); m.setMonth(m.getMonth() + i * step + 1); return m.toLocaleDateString("en-US", { month: "short", year: "2-digit" }); }),
          series: [
            { name: "Avalanche", color: "var(--accent)", values: pad(d.avalanche.timeline, months, step) },
            { name: "Snowball", color: "var(--accent2)", values: pad(d.snowball.timeline, months, step) },
            { name: "Minimums only", color: "var(--faint)", values: pad(d.minimum_only.timeline, months, step), dash: true },
          ], zero: true })}
      </section>
      <section class="card rise" style="margin-top:var(--gap)">
        <div class="card-head"><h2>Your debts</h2><span class="muted small">Untick one to leave it out of the plan (for example, the mortgage).</span></div>
        <table class="list cards"><thead><tr><th></th><th>Debt</th><th class="amt">Owed</th><th class="amt">Rate</th><th class="amt">Minimum</th><th></th></tr></thead><tbody>
        ${d.debts.map((x) => `<tr><td><input type="checkbox" data-inc="${x.id}" ${skip.has(x.id) ? "" : "checked"} data-help="Include this debt in the payoff plan."></td><td class="lead">${esc(x.name)}</td>
          <td class="amt money">${money(x.balance)}</td><td class="amt" data-label="Rate">${(x.apr_bp / 100).toFixed(2)}%</td><td class="amt money" data-label="Minimum">${money(x.min_payment)}</td>
          <td class="actions"><button class="btn sm" data-amort="${x.id}" data-help="See the month-by-month loan table: interest and principal.">Loan table</button></td></tr>`).join("")}</tbody></table>
        <div class="row" style="margin-top:12px"><button class="btn sm" data-calc data-help="Work out payments for any loan, like a new car.">${icon("chart")} Loan calculator</button></div>
      </section>`}`;
    const range = ctx.el.querySelector("[data-extra]");
    let t = null;
    range?.addEventListener("input", () => {
      ctx.el.querySelector("[data-extra-val]").textContent = money(Number(range.value));
      clearTimeout(t);
      t = setTimeout(() => ctx.go(`#/debt?extra=${(Number(range.value) / 100).toFixed(2)}${exclude ? "&exclude=" + exclude : ""}`), 250);
    });
    ctx.el.querySelectorAll("[data-inc]").forEach((c) => c.onchange = () => {
      const ex = new Set(d.excluded);
      c.checked ? ex.delete(Number(c.dataset.inc)) : ex.add(Number(c.dataset.inc));
      ctx.go(`#/debt?extra=${extra}&exclude=${[...ex].join(",")}`);
    });
    ctx.el.querySelector("[data-addacct]")?.addEventListener("click", () => accountForm({ type: "credit", on_budget: 1 }));
    ctx.el.querySelectorAll("[data-amort]").forEach((b) => b.onclick = () => {
      const x = d.debts.find((y) => y.id == b.dataset.amort);
      loanTable({ principal: x.balance, apr: x.apr_bp / 100, payment: x.min_payment, name: x.name });
    });
    ctx.el.querySelector("[data-calc]")?.addEventListener("click", () => loanTable({}));
  },
};

function pad(arr, n, step) {
  const out = [];
  for (let i = 0; i < n; i += step) out.push(arr[Math.min(i, arr.length - 1)] ?? 0);
  return out.length ? out : [0];
}

function loanTable({ principal = 0, apr = 0, payment = 0, name = "" }) {
  const m = modal({
    title: name ? `${esc(name)} loan table` : "Loan calculator", wide: true,
    help: "Type the loan amount, rate and either the length or the monthly payment.",
    body: `<form class="form" data-f style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <label class="field"><span>Amount owed</span><input name="principal" class="money-in" value="${principal ? dollars(principal) : ""}" placeholder="0.00"></label>
      <label class="field"><span>Rate (APR %)</span><input name="apr" value="${apr || ""}" placeholder="6.5"></label>
      <label class="field"><span>Monthly payment</span><input name="payment" class="money-in" value="${payment ? dollars(payment) : ""}" placeholder="or leave blank"></label>
      <label class="field"><span>Or length (months)</span><input name="months" inputmode="numeric" placeholder="60"></label></form>
      <div data-out style="margin-top:14px"></div>`,
    foot: `<button class="btn" data-close>Close</button><button class="btn primary" data-go>Work it out</button>`,
  });
  const go = async () => {
    const v = formData(m.$("[data-f]"));
    try {
      const r = await POST("/api/amortize", { principal: centsFromInput(v.principal) || 0, apr: v.apr || 0, payment: v.payment ? centsFromInput(v.payment) : null, months: v.months ? Number(v.months) : null });
      m.$("[data-out]").innerHTML = `<p>Payment <b>${money(r.payment)}</b> a month for <b>${yrs(r.months)}</b>. Total interest <b>${money(r.total_interest)}</b>.</p>
        <div style="max-height:46vh;overflow:auto"><table class="list"><thead><tr><th>#</th><th>Month</th><th class="amt">Payment</th><th class="amt">Interest</th><th class="amt">Principal</th><th class="amt">Left</th></tr></thead><tbody>
        ${r.rows.map((x) => `<tr><td>${x.n}</td><td>${esc(x.month)}</td><td class="amt money">${money(x.payment)}</td><td class="amt money">${money(x.interest)}</td><td class="amt money">${money(x.principal)}</td><td class="amt money">${money(x.balance)}</td></tr>`).join("")}</tbody></table></div>`;
    } catch (e) { m.$("[data-out]").innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
  };
  m.$("[data-go]").onclick = go;
  if (principal && payment) go();
}
