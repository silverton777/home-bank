import { icon } from "../icons.js";
import { GET, POST, esc, money, sparkline, countUp, niceDate, plural, attempt, confetti, avatar } from "../ui.js";
import { w } from "../words.js";
import { spendLine } from "./budget.js";
import { txnForm, accountForm, valueForm } from "../forms.js";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default {
  async render(ctx) {
    const [d, bud, safe] = await Promise.all([GET("/api/dashboard"), GET("/api/budget"), GET("/api/safety").catch(() => ({}))]);
    const cats = bud.groups.flatMap((g) => g.categories).filter((c) => c.kind === "normal" && !c.hidden && (c.activity < 0 || c.assigned > 0));
    const top = cats.map((c) => ({ c, spent: Math.max(0, -c.activity) })).sort((a, b) => b.spent - a.spent).slice(0, 6).filter((x) => x.spent > 0 || x.c.assigned > 0);
    const backupDue = !ctx.info.demo_mode && d.has_accounts && (!safe.last_backup || Date.now() - new Date(safe.last_backup).getTime() > 7 * 86400000);
    const person = ctx.info.person;
    const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const colors = { net: "var(--accent)", cash: "var(--accent2)", rta: "var(--good)", spent: "var(--warn)", debt: "var(--bad)" };
    const looks = [];
    if (d.review.count) looks.push(`<div class="card rise"><div class="card-head"><h2>${w("dash.review", "Needs a category")}</h2><a class="btn sm" href="#/register?review=1" data-help="Open every transaction that still needs a category or a quick check.">See all ${d.review.count}</a></div>
      ${d.review.items.slice(0, 5).map((t) => `<div class="look clickable" data-txn="${t.id}" data-help="Tap to pick a category for this one.">
        <div class="what">${esc(t.payee || "No payee")}<small>${esc(niceDate(t.date))} · ${esc(t.account_name)}</small></div>
        <span class="money ${t.amount > 0 ? "in" : ""}">${money(t.amount)}</span></div>`).join("")}</div>`);
    if (d.overspent.length) looks.push(`<div class="card rise"><div class="card-head"><h2>${w("dash.overspent", "Overspent")}</h2><a class="btn sm" href="#/budget" data-help="Open the budget to move money and cover these.">Open budget</a></div>
      ${d.overspent.map((o) => `<div class="look"><div class="what">${esc(o.name)}<small>${o.credit ? "Spent on a card beyond what was set aside" : "Spent more than was set aside"}</small></div>
        <span class="money bad">${money(-o.amount)}</span><button class="btn sm" data-fix="${o.id}" data-help="Cover this from Ready To Assign, or from the category with the most money left.">Fix it</button></div>`).join("")}</div>`);
    if (d.due.length) looks.push(`<div class="card rise"><div class="card-head"><h2>${w("dash.due", "Bills due soon")}</h2><a class="btn sm" href="#/bills">Bill calendar</a></div>
      ${d.due.map((b) => `<div class="look"><div class="what">${esc(b.name)}<small>${b.days === 0 ? "Today" : b.days === 1 ? "Tomorrow" : `In ${b.days} days`} · ${esc(niceDate(b.date))}${b.autopay ? " · autopay" : ""}</small></div><span class="money">${money(b.amount)}</span></div>`).join("")}</div>`);
    if (d.low_balance.length) looks.push(`<div class="card rise" style="border-color:color-mix(in srgb,var(--bad) 50%,var(--line))"><div class="card-head"><h2>${w("dash.low", "Low balance ahead")}</h2><a class="btn sm" href="#/forecast">See forecast</a></div>
      ${d.low_balance.map((x) => `<div class="look"><div class="what">${esc(x.text)}</div></div>`).join("")}</div>`);
    if (d.price_alerts.length) looks.push(`<div class="card rise"><div class="card-head"><h2>${w("dash.price", "Price went up")}</h2></div>
      ${d.price_alerts.map((p) => `<div class="look"><div class="what">${esc(p.name)}<small>Was ${money(p.old)}, now ${money(p.new)} (since ${esc(niceDate(p.date))})</small></div><button class="btn sm ghost" data-dismiss="${esc(p.key)}" data-help="Hide this alert.">Got it</button></div>`).join("")}</div>`);
    if (d.goals_done.length) looks.push(`<div class="card rise"><div class="card-head"><h2>${w("dash.goals", "Goals reached")}</h2><a class="btn sm" href="#/goals">Goals</a></div>
      ${d.goals_done.map((g) => `<div class="look"><div class="what">${esc(g.name)}<small>${money(g.amount)} saved</small></div><span class="pill good">${icon("check")} Done</span></div>`).join("")}</div>`);
    if (d.stale.length) looks.push(`<div class="card rise"><div class="card-head"><h2>${w("dash.stale", "Values to update")}</h2></div>
      ${d.stale.map((a) => `<div class="look"><div class="what">${esc(a.name)}<small>Last updated ${a.last_updated ? esc(niceDate(a.last_updated.slice(0, 10))) : "never"}</small></div><button class="btn sm" data-value="${a.id}">Update value</button></div>`).join("")}</div>`);

    ctx.el.innerHTML = `
      <section class="card hero rise" data-help="A quick summary of where things stand today.">
        <div class="date">${esc(date)}</div>
        <div class="hello">${esc(greeting())}${person ? ", " + esc(person.name) : ""}.</div>
        <div class="sentence">${esc(d.hero.sentence)}</div>
        <div class="who">${avatar(person)}</div>
      </section>
      ${!d.has_accounts ? `<div class="card rise" style="margin-top:var(--gap)"><div class="row between"><div><h2 style="margin:0 0 4px">Start here</h2><span class="muted">Add your checking account first, then your cards, savings, loans and the house. Or try demo mode to look around with made-up numbers.</span></div>
        <div class="row">${ctx.info.demo_mode ? "" : `<button class="btn" data-demo data-help="Look around with made-up money. Your real data stays hidden, and coming back needs your passcode.">Try demo mode</button>`}<button class="btn primary" data-addacct>${icon("plus")} Add an account</button></div></div></div>` : ""}
      ${backupDue ? `<a class="card rise warnbox" href="#/safety" style="display:block;margin-top:var(--gap);text-decoration:none;color:inherit" data-help="Backups are your safety net if this phone is lost or reset.">${icon("archive")} <b>Time for a backup.</b> ${safe.last_backup ? "It's been over a week." : "You haven't saved one yet."} Tap here.</a>` : ""}
      ${top.length ? `<section class="card rise thismonth" style="margin-top:var(--gap)" data-help="Your biggest budget categories this month: what's spent out of what's set aside.">
        <div class="card-head"><h2>${w("dash.month", "This month")}</h2><a class="btn sm" href="#/budget">Budget</a></div>
        ${top.map(({ c }) => `<a class="mrow" href="#/register?category=${c.id}"><div class="row between"><b>${esc(c.name)}</b><span class="${c.available < 0 ? "bad" : "muted"}">${money(c.available)} left</span></div>${spendLine(c) || `<small class="muted">${money(c.assigned)} set aside, nothing spent yet</small>`}</a>`).join("")}
      </section>` : ""}
      <div class="grid kpis" style="margin-top:var(--gap)">
        ${d.kpis.map((k, i) => `<a class="card kpi rise" style="animation-delay:${i * 50}ms;text-decoration:none;color:inherit" href="#/${k.link}" data-help="${esc(k.help)}">
          <span class="label">${w("kpi." + k.key, k.label)}</span>
          <span class="value ${k.key === "rta" && k.value < 0 ? "bad" : ""}" data-count="${k.value}">${money(k.value)}</span>
          ${sparkline(k.spark, colors[k.key])}</a>`).join("")}
      </div>
      <h2 style="margin:28px 2px 12px;font-weight:600;font-size:1.15em">${w("dash.needs", "Needs a look")}</h2>
      ${looks.length ? `<div class="grid g2">${looks.join("")}</div>` : `<div class="card empty"><b>All caught up</b>Nothing needs your attention right now.</div>`}
      ${d.pending ? `<p class="muted small" style="margin-top:14px">${plural(d.pending, "transaction")} still pending at the bank.</p>` : ""}`;
    if (ctx.fresh) countUp(ctx.el);
    ctx.el.querySelectorAll("[data-txn]").forEach((x) => x.onclick = async () => {
      txnForm(await GET(`/api/transactions/${x.dataset.txn}`));
    });
    ctx.el.querySelectorAll("[data-fix]").forEach((b) => b.onclick = () => attempt(() => POST("/api/budget/fix", { month: d.month, category_id: Number(b.dataset.fix) }), "Covered."));
    ctx.el.querySelectorAll("[data-dismiss]").forEach((b) => b.onclick = () => attempt(() => POST("/api/dismiss", { key: b.dataset.dismiss })));
    ctx.el.querySelectorAll("[data-value]").forEach((b) => b.onclick = async () => {
      const { accounts } = await GET("/api/accounts");
      const a = accounts.find((x) => x.id == b.dataset.value);
      if (a) valueForm(a);
    });
    ctx.el.querySelector("[data-addacct]")?.addEventListener("click", () => accountForm());
    ctx.el.querySelector("[data-demo]")?.addEventListener("click", async () => { const { enterDemo } = await import("../app.js"); attempt(() => enterDemo()); });
    // celebrate newly reached goals once
    const seen = JSON.parse(localStorage.getItem("hb-goals-celebrated") || "[]");
    const fresh = d.goals_done.filter((g) => !seen.includes(g.id));
    if (fresh.length && ctx.fresh) {
      setTimeout(confetti, 400);
      localStorage.setItem("hb-goals-celebrated", JSON.stringify([...seen, ...fresh.map((g) => g.id)]));
    }
  },
};
