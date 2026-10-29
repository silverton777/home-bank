import { icon } from "../icons.js";
import { GET, POST, PUT, DEL, esc, money, dollars, centsFromInput, attempt, lineChart, modal, formData, confirmDelete, niceDate, todayIso } from "../ui.js";
import { valueForm, accountForm } from "../forms.js";

export default {
  async render(ctx) {
    const d = await GET("/api/networth?months=24");
    const s = d.series;
    const change = s.length > 1 ? s[s.length - 1].net - s[Math.max(0, s.length - 13)].net : 0;
    const assets = d.accounts.filter((a) => a.balance > 0 && !a.closed);
    const debts = d.accounts.filter((a) => a.balance < 0 && !a.closed);
    const listOf = (rows, owed) => rows.length ? `<table class="list cards"><tbody>${rows.map((a) => `<tr><td class="lead">${esc(a.name)}<div class="small muted">${esc(a.type_label)}${a.last_updated ? `, updated ${esc(niceDate(a.last_updated.slice(0, 10)))}` : ""}</div></td>
        <td class="amt"><span class="money ${owed ? "bad" : ""}">${money(Math.abs(a.balance))}</span></td>
        <td class="actions">${["house", "vehicle", "other_asset", "investment", "retirement", "hsa", "loan", "mortgage", "other_debt"].includes(a.type) ? `<button class="btn sm" data-value="${a.id}" data-help="Type today's value. Home Bank records the change so the chart stays right.">Update value</button>` : ""}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">Nothing here yet.</p>`;
    ctx.el.innerHTML = `
      <div class="grid g3" style="margin-bottom:var(--gap)">
        <div class="card rise" data-help="Everything you own: cash, investments, the house, the cars."><div class="muted">You own</div><div class="stat"><span class="value">${money(d.assets)}</span></div></div>
        <div class="card rise" data-help="Everything you owe: cards, loans, mortgage."><div class="muted">You owe</div><div class="stat"><span class="value bad">${money(d.debts)}</span></div></div>
        <div class="card rise" data-help="Own minus owe. The one number that sums up your finances."><div class="muted">Net worth</div><div class="stat"><span class="value">${money(d.net)}</span></div>
          <small class="${change >= 0 ? "good" : "bad"}">${change >= 0 ? "Up" : "Down"} ${money(Math.abs(change))} over the last year</small></div>
      </div>
      <section class="card rise" style="margin-bottom:var(--gap)"><div class="card-head"><h2>Over time</h2></div>
        ${s.length > 1 ? lineChart({ labels: s.map((p) => new Date(p.month + "-15T12:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" })),
          series: [{ name: "Net worth", color: "var(--accent)", values: s.map((p) => p.net) }, { name: "Own", color: "var(--good)", values: s.map((p) => p.assets) }, { name: "Owe", color: "var(--bad)", values: s.map((p) => p.debts) }] })
          : `<p class="muted">The chart fills in as months go by.</p>`}</section>
      <div class="grid g2">
        <section class="card rise"><div class="card-head"><h2>What you own</h2><button class="btn sm" data-add="house">${icon("plus")} Add</button></div>${listOf(assets, false)}</section>
        <section class="card rise"><div class="card-head"><h2>What you owe</h2><button class="btn sm" data-add="loan">${icon("plus")} Add</button></div>${listOf(debts, true)}</section>
      </div>
      <section class="card rise" style="margin-top:var(--gap)"><div class="card-head"><h2>Investment holdings</h2><button class="btn sm" data-hold data-help="Optional: list the funds or stocks inside an investment account.">${icon("plus")} Add holding</button></div>
        ${d.holdings.length ? `<table class="list cards"><thead><tr><th>Holding</th><th>Account</th><th class="amt">Shares</th><th class="amt">Price</th><th class="amt">Value</th><th></th></tr></thead><tbody>
          ${d.holdings.map((h) => `<tr><td class="lead">${esc(h.symbol)} <span class="muted small">${esc(h.name || "")}</span></td><td data-label="Account" class="muted">${esc(h.account_name)}</td>
            <td class="amt" data-label="Shares">${(h.shares_milli / 1000).toLocaleString()}</td><td class="amt money" data-label="Price">${money(h.price)}</td><td class="amt money">${money(h.value)}</td>
            <td class="actions"><button class="btn icon ghost sm" data-edith="${h.id}">${icon("edit")}</button><button class="btn icon ghost sm" data-delh="${h.id}">${icon("trash")}</button></td></tr>`).join("")}</tbody></table>
          <p class="muted small">Holdings are for your information. The account balance is what counts toward net worth.</p>` : `<p class="muted">Optional. Add funds or stocks if you'd like to see what's inside your investment accounts.</p>`}</section>`;
    const find = (id) => d.accounts.find((a) => a.id == id);
    ctx.el.querySelectorAll("[data-value]").forEach((b) => b.onclick = () => valueForm(find(b.dataset.value)));
    ctx.el.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => accountForm({ type: b.dataset.add, on_budget: 0, owner: "Joint" }).catch(() => {}));
    const holdForm = (h = null) => {
      const inv = d.accounts.filter((a) => ["investment", "retirement", "hsa"].includes(a.type));
      if (!inv.length) return import("../ui.js").then((u) => u.toast("Add an investment or retirement account first."));
      const m = modal({
        title: h ? "Change holding" : "Add a holding",
        body: `<form class="form" data-f><label class="field"><span>Account</span><select name="account_id">${inv.map((a) => `<option value="${a.id}" ${h?.account_id === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
          <label class="field"><span>Symbol</span><input name="symbol" value="${esc(h?.symbol || "")}"></label>
          <label class="field full"><span>Name</span><input name="name" value="${esc(h?.name || "")}"></label>
          <label class="field"><span>Shares</span><input name="shares" inputmode="decimal" value="${h ? h.shares_milli / 1000 : ""}"></label>
          <label class="field"><span>Price per share</span><input name="price" class="money-in" value="${h ? dollars(h.price) : ""}"></label>
          <label class="field"><span>Price as of</span><input type="date" name="as_of" value="${esc(h?.as_of || todayIso())}"></label></form>`,
        foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Save holding</button>`,
      });
      m.$("[data-go]").onclick = async () => {
        const v = formData(m.$("[data-f]"));
        const body = { ...v, price: centsFromInput(v.price) || 0 };
        if (await attempt(() => (h ? PUT(`/api/holdings/${h.id}`, body) : POST("/api/holdings", body)), "Saved.")) m.close();
      };
    };
    ctx.el.querySelector("[data-hold]").onclick = () => holdForm();
    ctx.el.querySelectorAll("[data-edith]").forEach((b) => b.onclick = () => holdForm(d.holdings.find((h) => h.id == b.dataset.edith)));
    ctx.el.querySelectorAll("[data-delh]").forEach((b) => b.onclick = async () => {
      const h = d.holdings.find((x) => x.id == b.dataset.delh);
      if (await confirmDelete("holding", h.symbol)) attempt(() => DEL(`/api/holdings/${h.id}`), "Moved to Deleted.");
    });
  },
};
