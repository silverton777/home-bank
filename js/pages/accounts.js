import { icon } from "../icons.js";
import { GET, esc, money, niceDate, plural } from "../ui.js";
import { w } from "../words.js";
import { accountForm, valueForm, transferForm } from "../forms.js";

const ORDER = ["Cash", "Credit cards", "Loans", "Investments", "Property"];
const GROUP_HELP = {
  Cash: "Checking, savings and cash: the money you spend from.",
  "Credit cards": "Cards you owe money on. Pay them from the budget's Credit Card Payments.",
  Loans: "Car loans, student loans and the mortgage.",
  Investments: "Retirement, brokerage and HSA balances.",
  Property: "The house, cars and other things you own.",
};

export default {
  async render(ctx) {
    const { accounts } = await GET("/api/accounts");
    const open = accounts.filter((a) => !a.closed);
    const closed = accounts.filter((a) => a.closed);
    const groups = {};
    open.forEach((a) => (groups[a.group] ||= []).push(a));
    const total = (list) => list.reduce((s, a) => s + a.balance, 0);
    ctx.el.innerHTML = `
      <div class="row between" style="margin-bottom:var(--gap)">
        <div class="muted">${plural(open.length, "account")}. Owned minus owed: <b class="money" style="color:var(--text)">${money(total(open))}</b></div>
        <div class="row"><button class="btn" data-transfer data-help="Move money between two of your accounts, like paying a card from checking.">${icon("transfer")} Transfer</button>
          <button class="btn primary" data-add>${icon("plus")} ${w("acct.add", "Add account")}</button></div>
      </div>
      ${open.length ? "" : `<div class="card empty"><b>No accounts yet</b>Add your checking account first. You can add cards, loans, savings and the house after.</div>`}
      <div class="stack">
      ${ORDER.filter((g) => groups[g]).map((g) => `
        <section class="card rise" data-help="${esc(GROUP_HELP[g] || "")}">
          <div class="card-head"><h2>${esc(g)}</h2><span class="money ${total(groups[g]) < 0 ? "bad" : ""}">${money(total(groups[g]))}</span></div>
          <table class="list cards"><thead><tr><th>Account</th><th class="hide-phone">Bank</th><th class="hide-phone">Cleared</th><th class="hide-phone">Pending</th><th class="hide-phone">Last updated</th><th class="amt">Balance</th><th></th></tr></thead><tbody>
          ${groups[g].map((a) => `<tr class="clickable" data-open="${a.id}" data-help="Tap to see this account's transactions.">
            <td class="lead">${esc(a.name)} <span class="faint small">${esc(a.masked)}</span>${a.on_budget ? "" : ` <span class="pill" data-help="A tracking account: its balance counts in net worth but not in the budget.">Tracking</span>`}
              ${a.liability && a.apr_bp ? `<div class="small muted">${(a.apr_bp / 100).toFixed(2)}% APR${a.min_payment ? `, minimum ${money(a.min_payment)}` : ""}</div>` : ""}</td>
            <td class="hide-phone muted">${esc(a.institution || "")}</td>
            <td class="hide-phone money">${money(a.cleared)}</td>
            <td class="hide-phone money muted">${a.pending ? money(a.pending) : ""}</td>
            <td class="hide-phone muted small">${a.last_updated ? esc(niceDate(a.last_updated.slice(0, 10))) : ""}</td>
            <td class="amt"><span class="money ${a.balance < 0 ? "bad" : ""}">${money(a.balance)}</span></td>
            <td class="actions">
              ${["house", "vehicle", "other_asset", "investment", "retirement", "hsa", "loan", "mortgage", "other_debt"].includes(a.type) ? `<button class="btn sm" data-value="${a.id}" data-help="Type today's value or balance. Home Bank records the change.">Update value</button>` : ""}
              ${a.type === "credit" ? `<button class="btn sm primary" data-pay="${a.id}" data-help="Record a payment to this card from checking (or another account).">Pay card</button>` : ""}
              <a class="btn sm ghost" href="#/register?account=${a.id}&reconcile=1" data-help="Check this account against a bank statement.">Reconcile</a>
              <button class="btn icon ghost sm" data-edit="${a.id}" data-help="Change this account's details.">${icon("edit")}</button></td></tr>`).join("")}
          </tbody></table></section>`).join("")}
      ${closed.length ? `<details class="card"><summary class="muted" style="cursor:pointer">${plural(closed.length, "closed account")}</summary>
        <table class="list" style="margin-top:8px"><tbody>${closed.map((a) => `<tr><td>${esc(a.name)}</td><td class="amt money">${money(a.balance)}</td><td class="actions"><button class="btn icon ghost sm" data-edit="${a.id}">${icon("edit")}</button></td></tr>`).join("")}</tbody></table></details>` : ""}
      </div>`;
    const find = (id) => accounts.find((a) => a.id == id);
    ctx.el.querySelector("[data-add]").onclick = () => accountForm();
    ctx.el.querySelector("[data-transfer]").onclick = () => transferForm();
    ctx.el.querySelectorAll("[data-open]").forEach((r) => r.addEventListener("click", (e) => { if (!e.target.closest("button, a")) ctx.go(`#/register?account=${r.dataset.open}`); }));
    ctx.el.querySelectorAll("[data-edit]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); accountForm(find(b.dataset.edit)); });
    ctx.el.querySelectorAll("[data-pay]").forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const card = find(b.dataset.pay);
      const from = accounts.find((x) => ["checking", "savings", "cash"].includes(x.type) && !x.closed && x.on_budget);
      transferForm({ from_id: from?.id, to_id: card.id, amount: card.balance < 0 ? -card.balance : 0 });
    });
    ctx.el.querySelectorAll("[data-value]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); valueForm(find(b.dataset.value)); });
  },
};
