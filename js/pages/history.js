import { icon } from "../icons.js";
import { GET, POST, esc, money, attempt, confirmBox } from "../ui.js";

const FIELDS = { amount: "Amount", payee: "Payee", date: "Date", notes: "Notes", status: "Status", account_id: "Account", name: "Name",
  assigned: "Assigned", goal_amount: "Goal", goal_date: "Goal date", next_date: "Next date", balance: "Balance", category_id: "Category",
  rename_to: "Rename to", match_text: "Words", hidden: "Hidden", deleted_at: "Deleted", min_payment: "Minimum", apr_bp: "Rate" };
const MONEYISH = new Set(["amount", "goal_amount", "min_payment", "credit_limit", "low_balance_warn"]);

function diff(b, a) {
  if (!b || !a) return "";
  const out = [];
  for (const k of Object.keys(FIELDS)) {
    if (!(k in a) || b[k] === a[k]) continue;
    const show = (v) => (v === null || v === undefined || v === "" ? "empty" : MONEYISH.has(k) ? money(v) : k === "apr_bp" ? (v / 100).toFixed(2) + "%" : String(v));
    out.push(`<span class="pill">${FIELDS[k]}: ${esc(show(b[k]))} → ${esc(show(a[k]))}</span>`);
  }
  if (b._splits && a._splits && JSON.stringify(b._splits) !== JSON.stringify(a._splits)) out.push(`<span class="pill">Category or split changed</span>`);
  return out.join(" ");
}

export default {
  async render(ctx) {
    const offset = Number(ctx.params.offset || 0);
    const { history } = await GET(`/api/history?limit=100&offset=${offset}`);
    const actions = { create: "Added", update: "Changed", delete: "Deleted", restore: "Put back", undo: "Undid" };
    ctx.el.innerHTML = `
      <p class="muted" style="margin:0 0 var(--gap)">Every change to money, accounts and the budget, newest first. Undo any single change with its button.</p>
      <section class="card rise">
        ${history.length ? `<table class="list cards"><thead><tr><th>When</th><th>Who</th><th>What happened</th><th></th></tr></thead><tbody>
        ${history.map((h) => `<tr><td data-label="When" class="muted small" style="white-space:nowrap">${esc(h.at)}</td><td data-label="Who">${esc(h.person)}</td>
          <td class="lead" style="font-weight:normal"><span class="pill ${h.action === "delete" ? "bad" : h.action === "create" ? "good" : ""}">${actions[h.action] || esc(h.action)}</span> ${esc(h.summary)}
            ${h.action === "update" || h.action === "undo" ? `<div style="margin-top:4px">${diff(h.before, h.after)}</div>` : ""}${h.reverted_by ? ` <span class="pill">Undone</span>` : ""}</td>
          <td class="actions">${h.can_undo ? `<button class="btn sm ghost" data-undo="${h.id}" data-help="Put this back the way it was before this change.">${icon("undo")} Undo</button>` : ""}</td></tr>`).join("")}</tbody></table>
        <div class="row" style="margin-top:12px">${offset ? `<a class="btn sm" href="#/history?offset=${Math.max(0, offset - 100)}">Newer</a>` : ""}${history.length === 100 ? `<a class="btn sm" href="#/history?offset=${offset + 100}">Older</a>` : ""}</div>`
        : `<div class="empty"><b>No changes yet</b>Changes show up here as you use Home Bank.</div>`}
      </section>`;
    ctx.el.querySelectorAll("[data-undo]").forEach((b) => b.onclick = async () => {
      if (await confirmBox({ title: "Undo this change?", text: "This puts that item back the way it was just before the change.", yes: "Undo it" }))
        attempt(() => POST(`/api/history/${b.dataset.undo}/revert`), "Undone.");
    });
  },
};
