import { icon } from "../icons.js";
import { GET, POST, esc, money, niceDate, attempt, confetti, emptyState } from "../ui.js";
import { w } from "../words.js";
import { goalForm } from "../forms.js";

export default {
  async render(ctx) {
    const { goals, month, ready_to_assign } = await GET("/api/goals");
    const totalNeeded = goals.reduce((a, g) => a + g.needed, 0);
    const kindText = { target_by_date: "Save by a date", target_balance: "Build up to", monthly: "Every month" };
    ctx.el.innerHTML = `
      <div class="row between" style="margin-bottom:var(--gap)">
        <div class="muted">${goals.length ? `This month, goals need <b style="color:var(--text)">${money(totalNeeded)}</b> more. You have <b style="color:var(--text)">${money(ready_to_assign)}</b> ready to assign.` : ""}</div>
        <div class="row">${totalNeeded > 0 && ready_to_assign > 0 ? `<button class="btn" data-fund data-help="Assign what each goal needs this month, as far as Ready To Assign goes.">${icon("target")} Fund this month's goals</button>` : ""}
          <button class="btn primary" data-add>${icon("plus")} ${w("goals.add", "Add a goal")}</button></div>
      </div>
      ${goals.length ? `<div class="grid g2">${goals.map((g, i) => {
        const pct = Math.round(g.progress * 100);
        const amountNow = g.type === "monthly" ? g.assigned : g.available;
        return `<section class="card rise" style="animation-delay:${i * 40}ms" data-help="${esc(g.text)}">
          <div class="card-head"><h2>${esc(g.name)}</h2>${g.done ? `<span class="pill good">${icon("check")} Done</span>` : `<span class="pill">${esc(kindText[g.type] || "")}</span>`}</div>
          <div class="row between" style="align-items:baseline"><span class="stat"><span class="value">${money(amountNow)}</span></span><span class="muted">of ${money(g.amount)}${g.type === "monthly" ? " this month" : ""}</span></div>
          <div class="progress ${g.done ? "done" : ""}" style="margin:10px 0 8px;height:10px"><i style="width:${pct}%"></i></div>
          <div class="row between small"><span class="muted">${g.type === "target_by_date" && g.date ? `By ${esc(niceDate(g.date, { year: true }))}, about ${money(g.per_month)} a month` : g.type === "monthly" ? "Set aside every month" : "No deadline"}</span>
            ${g.needed > 0 ? `<span class="warn">${money(g.needed)} to go this month</span>` : ""}</div>
          <div class="row" style="margin-top:12px"><button class="btn sm" data-edit="${g.id}">${icon("edit")} Change goal</button>
            ${g.needed > 0 && ready_to_assign > 0 ? `<button class="btn sm" data-fundone="${g.id}" data-help="Assign this month's amount to this goal from Ready To Assign.">Add ${money(Math.min(g.needed, ready_to_assign))}</button>` : ""}
            <a class="btn sm ghost" href="#/register?category=${g.id}">Transactions</a></div></section>`;
      }).join("")}</div>`
      : `<div class="card">${emptyState("No savings goals yet", "Saving for a vacation, the holidays, car repairs or an emergency fund? Add a goal and Home Bank works out how much to set aside each month.", `<button class="btn primary" data-add2>${icon("plus")} Add a goal</button>`)}</div>`}`;
    const find = (id) => goals.find((g) => g.id == id);
    ctx.el.querySelector("[data-add]").onclick = () => goalForm();
    ctx.el.querySelector("[data-add2]")?.addEventListener("click", () => goalForm());
    ctx.el.querySelectorAll("[data-edit]").forEach((b) => b.onclick = async () => {
      const { groups } = await GET("/api/categories");
      const c = groups.flatMap((g) => g.categories).find((c) => c.id == b.dataset.edit);
      goalForm({ ...c, available: find(b.dataset.edit).available });
    });
    ctx.el.querySelector("[data-fund]")?.addEventListener("click", async () => { const r = await attempt(() => POST("/api/budget/assign-needed", { month })); if (r) { (await GET("/api/goals")).goals.some((g) => g.done && !find(g.id).done) && confetti(); } });
    ctx.el.querySelectorAll("[data-fundone]").forEach((b) => b.onclick = async () => {
      const g = find(b.dataset.fundone);
      const amt = Math.min(g.needed, ready_to_assign);
      if (await attempt(() => POST("/api/budget/assign", { category_id: g.id, month, amount: g.assigned + amt }), "Added.")) {
        if (g.type !== "monthly" && g.available + amt >= g.amount) confetti();
      }
    });
  },
};
