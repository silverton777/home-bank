import { icon } from "../icons.js";
import { GET, POST, esc, attempt, plural } from "../ui.js";

const WHAT = { accounts: "Account", transactions: "Transaction", categories: "Category", category_groups: "Category group", rules: "Rule",
  scheduled: "Bill or paycheck", holdings: "Holding", attachments: "Receipt", people: "Person" };

export default {
  async render(ctx) {
    const { items } = await GET("/api/deleted");
    ctx.el.innerHTML = `
      <p class="muted" style="margin:0 0 var(--gap)">Nothing in Home Bank is ever thrown away. Anything you delete waits here until you put it back.</p>
      <section class="card rise">
        ${items.length ? `<table class="list cards"><thead><tr><th>What</th><th>Kind</th><th>Deleted</th><th></th></tr></thead><tbody>
        ${items.map((it) => {
          const extra = Object.entries(it.parts).filter(([t]) => t !== it.table).map(([t, n]) => plural(n, (WHAT[t] || t).toLowerCase())).join(", ");
          return `<tr><td class="lead">${esc(it.label || "(no name)")}${extra ? `<div class="small muted">along with ${esc(extra)}</div>` : ""}</td>
            <td data-label="Kind" class="muted">${WHAT[it.table] || esc(it.table)}</td><td data-label="Deleted" class="muted small">${esc(it.deleted_at)}</td>
            <td class="actions"><button class="btn sm" data-restore="${it.table}:${it.id}" data-help="Put this back exactly where it was.">${icon("undo")} Put back</button></td></tr>`;
        }).join("")}</tbody></table>`
        : `<div class="empty"><b>Nothing deleted</b>When you delete something, it lands here so you can put it back.</div>`}
      </section>`;
    ctx.el.querySelectorAll("[data-restore]").forEach((b) => b.onclick = () => {
      const [table, id] = b.dataset.restore.split(":");
      attempt(() => POST("/api/deleted/restore", { table, id: Number(id) }), "Put back.");
    });
  },
};
