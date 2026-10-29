import { icon } from "../icons.js";
import { GET, esc, money, niceDate, lineChart, emptyState, PALETTE } from "../ui.js";

export default {
  async render(ctx) {
    const days = Number(ctx.params.days || 90);
    const f = await GET(`/api/forecast?days=${days}`);
    const accts = f.accounts;
    const labels = [];
    const n = accts[0]?.series.length || 0;
    for (let i = 0; i < n; i++) { const d = new Date(); d.setDate(d.getDate() + i * 3); labels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" })); }
    const warnings = accts.filter((a) => a.warning);
    ctx.el.innerHTML = `
      <div class="row between" style="margin-bottom:var(--gap)">
        <p class="muted" style="margin:0;max-width:70ch">Starting from today's balances, Home Bank adds each paycheck and takes away each bill on its date. Keep your paychecks and bills up to date on the <a href="#/bills">Bills &amp; paychecks</a> page for the best forecast.</p>
        <div class="seg">${[30, 60, 90].map((dd) => `<button data-days="${dd}" class="${dd === days ? "on" : ""}">${dd} days</button>`).join("")}</div>
      </div>
      ${warnings.length ? `<div class="card rise" style="margin-bottom:var(--gap);border-color:color-mix(in srgb,var(--bad) 50%,var(--line))"><b class="bad">Heads up</b>${warnings.map((a) => `<div class="look"><div class="what">${esc(a.warning.text)}</div></div>`).join("")}</div>` : ""}
      ${accts.length ? `
      <section class="card rise" style="margin-bottom:var(--gap)">${lineChart({ labels, series: accts.map((a, i) => ({ name: a.name, color: PALETTE[i % PALETTE.length], values: a.series })), zero: false })}</section>
      <section class="card rise"><table class="list cards"><thead><tr><th>Account</th><th class="amt">Today</th><th class="amt">In 30 days</th><th class="amt">In 60 days</th><th class="amt">In 90 days</th><th class="amt">Lowest point</th></tr></thead><tbody>
        ${accts.map((a) => `<tr><td class="lead">${esc(a.name)}</td><td class="amt money" data-label="Today">${money(a.start)}</td><td class="amt money" data-label="30 days">${money(a.d30)}</td><td class="amt money hide-phone">${money(a.d60)}</td><td class="amt money" data-label="90 days">${money(a.d90)}</td>
          <td class="amt" data-label="Lowest"><span class="money ${a.warning ? "bad" : ""}">${money(a.low)}</span><div class="small muted">${esc(niceDate(a.low_date))}</div></td></tr>`).join("")}</tbody></table></section>
      <section class="card rise" style="margin-top:var(--gap)"><div class="card-head"><h2>Coming up</h2></div>
        ${accts.map((a) => a.events.length ? `<h3 class="muted" style="margin:12px 0 6px">${esc(a.name)}</h3>${a.events.slice(0, 12).map((e) => `<div class="look"><div class="what">${esc(e.name)}<small>${esc(niceDate(e.date))}</small></div><span class="money ${e.amount > 0 ? "in" : ""}">${money(e.amount, { sign: true })}</span></div>`).join("")}` : "").join("")}</section>`
      : `<div class="card">${emptyState("Nothing to forecast yet", "Add a checking or savings account, then your paychecks and bills.", `<a class="btn primary" href="#/bills">${icon("calendar")} Add bills and paychecks</a>`)}</div>`}`;
    ctx.el.querySelectorAll("[data-days]").forEach((b) => b.onclick = () => ctx.go(`#/forecast?days=${b.dataset.days}`));
  },
};
