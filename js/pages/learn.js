import { icon } from "../icons.js";
import { GET, POST, attempt } from "../ui.js";
import { w } from "../words.js";

export default {
  async render(ctx) {
    const mode = ctx.info.budget_mode;
    ctx.el.innerHTML = `
      <div class="grid g2">
        <section class="card rise">
          <div class="card-head"><h2>${w("learn.zero.title", "Zero-based budgeting")}</h2>${mode !== "flex" ? `<span class="pill accent">You're using this</span>` : ""}</div>
          <p><b>Give every dollar a job.</b> When a paycheck lands, it goes into <b>Ready To Assign</b>. You then hand that money out to categories (groceries, the electric bill, the vacation fund) until Ready To Assign reaches $0. That's why it's called zero-based: nothing is left without a plan.</p>
          <p><b>Only budget money you already have.</b> You assign this month's paychecks, not next month's. If you get ahead, you can start funding next month early.</p>
          <p><b>Leftovers roll over.</b> If you set aside $600 for groceries and spend $550, the extra $50 is still there next month. That's how big, irregular costs (car repairs, holidays, insurance) stop being surprises: you set a little aside every month.</p>
          <p><b>Overspent? Move money.</b> If a category goes red, cover it from another category. One tap on <b>Fix it</b> does that for you. If you don't, the overspending comes out of next month's Ready To Assign.</p>
          <p><b>Credit cards.</b> When you buy groceries on a card, the money moves from Groceries into that card's payment category, so it's waiting when the bill comes. Paying the card is a transfer from checking.</p>
          <p class="muted"><b>Good for:</b> couples who want to agree on every dollar, paying off debt, and building savings on purpose.</p>
          ${mode === "flex" ? `<button class="btn primary" data-mode="zero">Switch to zero-based</button>` : ""}
        </section>
        <section class="card rise">
          <div class="card-head"><h2>${w("learn.flex.title", "Flex budgeting")}</h2>${mode === "flex" ? `<span class="pill accent">You're using this</span>` : ""}</div>
          <p><b>Three buckets, less fuss.</b> Your money goes into:</p>
          <ol><li><b>Fixed bills</b>: rent or mortgage, utilities, insurance. The same every month.</li>
            <li><b>Saving for later</b>: things that don't happen monthly, like gifts or car repairs.</li>
            <li><b>Flexible spending</b>: one pot for everything else (groceries, eating out, gas, fun). Spend it however you like, as long as the pot doesn't run out.</li></ol>
          <p>You still set amounts for each category, but the budget page shows one simple number for flexible spending: how much is left this month.</p>
          <p class="muted"><b>Good for:</b> when you want a lighter touch, or as a first step before zero-based.</p>
          <p class="muted">Switching styles never changes your numbers. It only changes how the budget page shows them.</p>
          ${mode !== "flex" ? `<button class="btn" data-mode="flex">Switch to flex</button>` : ""}
        </section>
      </div>
      <section class="card rise" style="margin-top:var(--gap)">
        <h2>Words you'll see</h2>
        <div class="grid g2">
          <p><b>Assigned</b>: money you've set aside for a category this month.</p>
          <p><b>Activity</b>: what was spent (or refunded) in the category this month.</p>
          <p><b>Available</b>: what's left to spend. Green is fine, red is overspent, yellow means overspent on a credit card.</p>
          <p><b>Ready To Assign</b>: money you have that hasn't been given a job yet.</p>
          <p><b>Transfer</b>: money moving between your own accounts. Never counted as spending or income.</p>
          <p><b>Tracking account</b>: a loan, investment or house. Its balance counts in net worth but not in the budget.</p>
          <p><b>Cleared / pending</b>: whether the bank has finished the transaction yet.</p>
          <p><b>Reconcile</b>: check Home Bank against a bank statement so the two agree.</p>
        </div>
      </section>`;
    ctx.el.querySelectorAll("[data-mode]").forEach((b) => b.onclick = async () => {
      if (await attempt(() => POST("/api/budget/mode", { mode: b.dataset.mode }), "Budget style changed.")) { ctx.info.budget_mode = b.dataset.mode; ctx.go("#/budget"); }
    });
  },
};
