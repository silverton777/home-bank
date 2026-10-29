import { icon } from "../icons.js";
import { GET, POST, PUT, DEL, esc, attempt, modal, formData, confirmDelete, categoryOptions, accountOptions, toast, plural } from "../ui.js";

const TYPES = { contains: "contains", starts: "starts with", exact: "is exactly", regex: "matches pattern" };

export default {
  async render(ctx) {
    const [{ rules }, cats, accts] = await Promise.all([GET("/api/rules"), GET("/api/categories"), GET("/api/accounts")]);
    ctx.el.innerHTML = `
      <div class="row between" style="margin-bottom:var(--gap)">
        <p class="muted" style="margin:0;max-width:70ch">Rules run on every import. They tidy up messy bank names and fill in the category. When you change a category, Home Bank offers to make a rule for you.</p>
        <button class="btn primary" data-add>${icon("plus")} Add rule</button>
      </div>
      <section class="card rise">
        ${rules.length ? `<table class="list cards"><thead><tr><th>When the payee…</th><th>Rename to</th><th>Category</th><th class="hide-phone">Used</th><th class="hide-phone">On</th><th></th></tr></thead><tbody>
        ${rules.map((r) => `<tr><td class="lead">${esc(TYPES[r.match_type] || r.match_type)} <b>“${esc(r.match_text)}”</b>${r.account_name ? `<div class="small muted">only in ${esc(r.account_name)}</div>` : ""}</td>
          <td data-label="Rename to">${esc(r.rename_to || "")}</td><td data-label="Category">${esc(r.category_name || "")}</td>
          <td class="hide-phone muted">${r.times_used || 0}</td>
          <td class="hide-phone"><label class="switch" data-help="Turn this rule on or off."><input type="checkbox" data-on="${r.id}" ${r.enabled ? "checked" : ""}><span></span></label></td>
          <td class="actions"><button class="btn sm" data-run="${r.id}" data-help="Apply this rule to transactions you already have that don't have a category.">Run now</button>
            <button class="btn icon ghost sm" data-edit="${r.id}">${icon("edit")}</button><button class="btn icon ghost sm" data-del="${r.id}">${icon("trash")}</button></td></tr>`).join("")}</tbody></table>`
        : `<div class="empty"><b>No rules yet</b>Add one, or change a transaction's category and say "Always do this".</div>`}
      </section>`;
    const form = (r = null) => {
      const m = modal({
        title: r ? "Change rule" : "Add a rule",
        body: `<form class="form" data-f>
          <label class="field"><span>When the payee</span><select name="match_type">${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${r?.match_type === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="field"><span>These words</span><input name="match_text" value="${esc(r?.match_text || "")}" placeholder="AMZN" data-help="Capital letters don't matter."></label>
          <label class="field"><span>Rename it to (optional)</span><input name="rename_to" value="${esc(r?.rename_to || "")}" placeholder="Amazon"></label>
          <label class="field"><span>Put it in (optional)</span><select name="category_id">${categoryOptions(cats.groups, r?.category_id, { blank: "Leave category alone" })}</select></label>
          <label class="field full"><span>Only for this account (optional)</span><select name="account_id">${accountOptions(accts.accounts, r?.account_id, { blank: "Any account" })}</select></label>
          ${r ? "" : `<label class="check full"><input type="checkbox" name="run_now" checked> Also apply it to transactions I already have without a category</label>`}
        </form>`,
        foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Save rule</button>`,
      });
      m.$("[data-go]").onclick = async () => {
        const v = formData(m.$("[data-f]"));
        const body = { ...v, category_id: Number(v.category_id) || null, account_id: Number(v.account_id) || null };
        const res = await attempt(() => (r ? PUT(`/api/rules/${r.id}`, body) : POST("/api/rules", body)));
        if (res) { toast(res.changed ? `Rule saved and ${plural(res.changed, "transaction")} updated.` : "Rule saved."); m.close(); }
      };
    };
    const find = (id) => rules.find((r) => r.id == id);
    ctx.el.querySelector("[data-add]").onclick = () => form();
    ctx.el.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => form(find(b.dataset.edit)));
    ctx.el.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => { if (await confirmDelete("rule", `payee ${TYPES[find(b.dataset.del).match_type]} "${find(b.dataset.del).match_text}"`)) attempt(() => DEL(`/api/rules/${b.dataset.del}`), "Moved to Deleted."); });
    ctx.el.querySelectorAll("[data-on]").forEach((c) => c.onchange = () => attempt(() => PUT(`/api/rules/${c.dataset.on}`, { enabled: c.checked ? 1 : 0 })));
    ctx.el.querySelectorAll("[data-run]").forEach((b) => b.onclick = async () => { const r = await attempt(() => POST(`/api/rules/${b.dataset.run}/run`, {})); if (r) toast(`Updated ${plural(r.changed, "transaction")}.`); });
  },
};
