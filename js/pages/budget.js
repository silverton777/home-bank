import { icon } from "../icons.js";
import { GET, POST, PUT, askText, esc, money, dollars, centsFromInput, monthName, attempt, modal, toast, formData, confetti, thisMonth } from "../ui.js";
import { w } from "../words.js";
import { categoryForm, goalForm } from "../forms.js";

const availClass = (c) => c.available < 0 ? (c.credit_over > 0 && c.cash_over === 0 ? "credit" : "neg") : c.available === 0 ? "zero" : "pos";

function goalLine(c) {
  if (!c.goal) return "";
  const g = c.goal;
  const pct = Math.round(g.progress * 100);
  const need = g.needed > 0 ? `<span class="warn">${money(g.needed)} more needed this month</span>` : g.done ? `<span class="good">Goal met</span>` : "";
  return `<div class="progress ${g.done ? "done" : ""}" data-help="${esc(g.text)}. ${pct}% there."><i style="width:${pct}%"></i></div><small class="muted">${need}</small>`;
}

// "Spent $20 of $200": how much of what was set aside is used up this month
export function spendLine(c) {
  if (c.kind !== "normal") return "";
  const spent = Math.max(0, -c.activity);
  const had = c.available + spent; // what was there before this month's spending
  if (!spent && had <= 0) return "";
  const pct = had > 0 ? Math.round((spent * 100) / had) : 100;
  const cls = spent > had ? "over" : pct >= 80 ? "near" : "";
  const text = spent > had ? `${money(spent)} spent, ${money(spent - had)} over` : `${money(spent)} of ${money(had)} spent`;
  return `<div class="spend ${cls}" data-help="How much of what's set aside for ${esc(c.name)} is used this month. Yellow at 80%, red when over."><div class="progress ${cls}"><i style="width:${Math.min(100, pct)}%"></i></div><small>${text}</small></div>`;
}

export default {
  async render(ctx) {
    const month = ctx.params.month || thisMonth();
    const b = await GET(`/api/budget?month=${month}`);
    const flex = b.mode === "flex";
    const rta = b.ready_to_assign;
    const rtaCls = rta === 0 ? "zero" : rta > 0 ? "pos" : "neg";
    const rtaMsg = rta === 0 ? "Every dollar has a job. Nicely done." : rta > 0 ? "Give these dollars a job by assigning them to categories below." : "You've assigned more than you have. Take some back from a category.";
    const visible = (g) => g.categories.filter((c) => !c.hidden);
    ctx.el.innerHTML = `
      <div class="row between" style="margin-bottom:var(--gap)">
        <div class="row">
          <a class="btn icon" href="#/budget?month=${b.prev}" data-help="Previous month.">${icon("left")}</a>
          <h2 style="margin:0 6px;font-size:1.35em;font-weight:600;min-width:170px;text-align:center">${esc(monthName(month))}</h2>
          <a class="btn icon" href="#/budget?month=${b.next}" data-help="Next month. You can plan ahead.">${icon("right")}</a>
          ${month !== thisMonth() ? `<a class="btn sm ghost" href="#/budget">This month</a>` : ""}
        </div>
        <div class="row">
          <div class="seg" data-mode data-help="Zero-based gives every dollar a job. Flex keeps it simple: fixed bills, savings and one flexible pot.">
            <button data-v="zero" class="${!flex ? "on" : ""}">${w("budget.zero", "Zero-based")}</button><button data-v="flex" class="${flex ? "on" : ""}">${w("budget.flex", "Flex")}</button></div>
          <a class="btn ghost sm" href="#/learn" data-help="A plain-English explanation of both budget styles.">${icon("info")} How this works</a>
        </div>
      </div>
      <section class="card rta ${rtaCls} rise" data-help="Ready To Assign is money you have that hasn't been given a job yet. Aim for zero.">
        <div><div class="muted">${w("budget.rta", "Ready to assign")}</div><div class="big ${rta < 0 ? "bad" : ""}">${money(rta)}</div></div>
        <div style="flex:1;min-width:220px" class="muted">${rtaMsg}</div>
        <div class="row">
          ${b.underfunded > 0 ? `<button class="btn" data-needed data-help="Assign what each goal needs this month, as far as Ready To Assign goes.">${icon("target")} Fund goals (${money(b.underfunded)})</button>` : ""}
          <button class="btn" data-copy data-help="Copy every assigned amount from last month into this month.">${icon("repeat")} Copy last month</button>
          <button class="btn" data-move data-help="Move money from one category to another.">${icon("transfer")} Move money</button>
        </div>
      </section>
      ${b.overspent.length ? `<div class="card rise" style="margin-top:var(--gap);border-color:color-mix(in srgb,var(--bad) 45%,var(--line))">
        <div class="row between"><b>${b.overspent.length === 1 ? "1 category is" : b.overspent.length + " categories are"} overspent</b><span class="muted small">Cash overspending comes out of next month's Ready To Assign. Card overspending becomes card debt.</span></div>
        <div class="row" style="margin-top:10px">${b.overspent.map((o) => `<button class="btn sm" data-fix="${o.id}" data-help="Cover ${money(o.amount)} from Ready To Assign, or from the category with the most money left.">${esc(o.name)} <span class="bad">${money(-o.amount)}</span> Fix</button>`).join("")}</div></div>` : ""}
      ${b.uncategorized ? `<p class="small" style="margin:12px 2px"><a href="#/register?uncategorized=1">${b.uncategorized} transaction${b.uncategorized === 1 ? "" : "s"} still need a category</a> before the budget is complete.</p>` : ""}
      ${flex ? `<div class="grid g3" style="margin-top:var(--gap)">
          <div class="card rise" data-help="Bills that are the same every month."><div class="muted">Fixed bills</div><div class="stat"><span class="value">${money(b.flex.fixed)}</span></div></div>
          <div class="card rise" data-help="Money set aside for things that don't happen every month."><div class="muted">Saving for later</div><div class="stat"><span class="value">${money(b.flex.nonmonthly)}</span></div></div>
          <div class="card rise" data-help="One pot for everything else: groceries, eating out, gas, fun. Spend it however you like."><div class="muted">Flexible spending left</div><div class="stat"><span class="value ${b.flex.flex_left < 0 ? "bad" : ""}">${money(b.flex.flex_left)}</span></div>
            <div class="progress ${b.flex.flex_spent > b.flex.flex_budget ? "over" : ""}" style="margin-top:8px"><i style="width:${Math.min(100, b.flex.flex_budget ? (b.flex.flex_spent * 100) / b.flex.flex_budget : 0)}%"></i></div>
            <small class="muted">${money(b.flex.flex_spent)} spent of ${money(b.flex.flex_budget)}</small></div>
        </div>` : ""}
      <div class="card rise" style="margin-top:var(--gap);padding:6px var(--pad) 12px">
        <table class="list cards budget-table">
          <thead><tr><th>${w("budget.cat", "Category")}</th><th class="amt">${flex ? w("budget.planned", "Planned") : w("budget.assigned", "Assigned")}</th><th class="amt">${flex ? w("budget.spent", "Spent") : w("budget.activity", "Activity")}</th><th class="amt">${flex ? w("budget.left", "Left") : w("budget.available", "Available")}</th><th></th></tr></thead>
          <tbody>
          ${b.groups.filter((g) => visible(g).length || g.kind === "normal").map((g) => `
            <tr class="group"><td class="lead" data-group="${g.id}" data-help="${g.kind === "cc_payments" ? "Money set aside to pay your credit cards. It fills up automatically when you spend on a card from a category that has money." : "A category group. Tap its name to rename it."}">${esc(g.name)}</td>
              <td class="amt hide-phone">${money(g.assigned)}</td><td class="amt hide-phone">${money(g.activity)}</td><td class="amt hide-phone">${money(g.available)}</td>
              <td class="actions">${g.kind === "normal" ? `<button class="btn icon ghost sm" data-addcat="${g.id}" data-help="Add a category to ${esc(g.name)}.">${icon("plus")}</button>` : ""}</td></tr>
            ${visible(g).map((c) => `<tr data-cat="${c.id}">
              <td class="lead"><div class="catname"><a href="#/register?category=${c.id}" style="color:inherit;text-decoration:none" data-help="${c.kind === "cc_payment" ? "Money waiting to pay this card's bill." : c.notes ? esc(c.notes) : "Tap to see this category's transactions."}">${esc(c.name)}</a>${spendLine(c)}${goalLine(c)}</div></td>
              <td class="assigned amt" data-label="${flex ? "Planned" : "Assigned"}"><input class="money-in" data-assign="${c.id}" value="${dollars(c.assigned)}" inputmode="decimal" data-help="How much to set aside for ${esc(c.name)} this month. Type a number or a sum like 100+25."></td>
              <td class="amt" data-label="${flex ? "Spent" : "Activity"}"><a href="#/register?category=${c.id}&start=${month}-01&end=${month}-31" style="color:inherit" data-help="Spending and refunds in ${esc(c.name)} this month.">${money(c.activity)}</a></td>
              <td class="amt"><span class="avail ${availClass(c)} ${c.goal?.needed > 0 ? "need" : ""}" data-avail="${c.id}" data-help="${c.available < 0 ? "Overspent. Tap to cover it." : "What's left to spend. Tap to move money."}" style="cursor:pointer">${money(c.available)}</span></td>
              <td class="actions">${c.kind === "normal" ? `<button class="btn icon ghost sm" data-goal="${c.id}" data-help="Set or change a savings goal for this category.">${icon("target")}</button><button class="btn icon ghost sm" data-edit="${c.id}" data-help="Rename, hide or delete this category.">${icon("edit")}</button>` : ""}</td></tr>`).join("")}`).join("")}
          </tbody></table>
        <div class="row" style="margin-top:12px"><button class="btn sm" data-addgroup data-help="Add a new group of categories.">${icon("plus")} Add group</button><span class="spacer"></span>
          <span class="muted small">Assigned ${money(b.totals.assigned)} · Activity ${money(b.totals.activity)} · Available ${money(b.totals.available)}</span></div>
      </div>`;

    const cats = b.groups.flatMap((g) => g.categories);
    const findCat = (id) => cats.find((c) => c.id == id);

    // assigning money: save when leaving the box
    ctx.el.querySelectorAll("[data-assign]").forEach((inp) => {
      const orig = inp.value;
      const save = async () => {
        let v = inp.value.trim();
        if (/^[\d.,$+\- ]+$/.test(v) && /[+\-]/.test(v.slice(1))) {
          // simple sums like 100+25-10
          const parts = v.replace(/[$,\s]/g, "").match(/[+\-]?[\d.]+/g) || [];
          v = (parts.reduce((a, p) => a + (centsFromInput(p) || 0), 0) / 100).toFixed(2);
        }
        const cents = v === "" ? 0 : centsFromInput(v);
        if (cents === null) { toast("That isn't an amount.", { bad: true }); inp.value = orig; return; }
        if (dollars(cents) === orig) { inp.value = orig; return; }
        inp.value = dollars(cents);
        const before = findCat(inp.dataset.assign);
        await attempt(() => POST("/api/budget/assign", { category_id: Number(inp.dataset.assign), month, amount: cents }));
        if (before?.goal && !before.goal.done && before.available - before.assigned + cents >= before.goal.amount && before.goal.type !== "monthly") confetti();
      };
      inp.addEventListener("focus", () => inp.select());
      inp.addEventListener("change", save);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { inp.blur(); } if (e.key === "Escape") { inp.value = orig; inp.blur(); } });
    });
    ctx.el.querySelectorAll("[data-mode] button").forEach((btn) => btn.onclick = () => attempt(() => POST("/api/budget/mode", { mode: btn.dataset.v })));
    ctx.el.querySelector("[data-copy]").onclick = async () => { const r = await attempt(() => POST("/api/budget/copy-last", { month })); if (r) toast(r.copied ? `Copied ${r.copied} amounts from last month.` : "Last month had nothing assigned."); };
    ctx.el.querySelector("[data-needed]")?.addEventListener("click", async () => { const r = await attempt(() => POST("/api/budget/assign-needed", { month })); if (r) toast(`Assigned ${money(r.assigned)} to goals.`); });
    ctx.el.querySelectorAll("[data-fix]").forEach((x) => x.onclick = () => attempt(() => POST("/api/budget/fix", { month, category_id: Number(x.dataset.fix) }), "Covered."));
    ctx.el.querySelector("[data-move]").onclick = () => moveMoney(cats, month);
    ctx.el.querySelectorAll("[data-avail]").forEach((x) => x.onclick = () => {
      const c = findCat(x.dataset.avail);
      if (c.available < 0) attempt(() => POST("/api/budget/fix", { month, category_id: c.id }), "Covered.");
      else moveMoney(cats, month, c.id);
    });
    ctx.el.querySelectorAll("[data-edit]").forEach((x) => x.onclick = () => categoryForm(findCat(x.dataset.edit)));
    ctx.el.querySelectorAll("[data-goal]").forEach((x) => x.onclick = () => goalForm(findCat(x.dataset.goal)));
    ctx.el.querySelectorAll("[data-addcat]").forEach((x) => x.onclick = () => categoryForm(null, Number(x.dataset.addcat)));
    ctx.el.querySelector("[data-addgroup]").onclick = async () => {
      const name = await askText({ title: "Add a group", label: "Group name", yes: "Add group" });
      if (name) attempt(() => POST("/api/groups", { name }), "Group added.");
    };
    ctx.el.querySelectorAll("[data-group]").forEach((x) => x.addEventListener("dblclick", async () => {
      const name = await askText({ title: "Rename group", label: "Group name", value: x.textContent.trim() });
      if (name) attempt(() => PUT(`/api/groups/${x.dataset.group}`, { name }), "Renamed.");
    }));
  },
};

function moveMoney(cats, month, fromId = null) {
  const opts = (sel, rta) => `${rta ? `<option value="">Ready to assign</option>` : ""}${cats.filter((c) => c.kind !== "income").map((c) => `<option value="${c.id}" ${c.id == sel ? "selected" : ""}>${esc(c.name)} (${money(c.available)})</option>`).join("")}`;
  const m = modal({
    title: "Move money",
    help: "Take money set aside in one category and give it to another.",
    body: `<form class="form" data-f>
      <label class="field"><span>From</span><select name="from_id">${opts(fromId, true)}</select></label>
      <label class="field"><span>To</span><select name="to_id"><option value="">Ready to assign</option>${opts(null, false)}</select></label>
      <label class="field full"><span>Amount</span><input name="amount" class="money-in" inputmode="decimal" placeholder="0.00"></label></form>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Move this money</button>`,
  });
  m.$("[data-go]").onclick = async () => {
    const v = formData(m.$("[data-f]"));
    if (await attempt(() => POST("/api/budget/move", { month, amount: centsFromInput(v.amount), from_id: Number(v.from_id) || null, to_id: Number(v.to_id) || null }), "Moved.")) m.close();
  };
}
