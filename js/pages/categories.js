import { icon } from "../icons.js";
import { GET, POST, PUT, DEL, askText, modal, formData, esc, attempt, confirmBox, toast, longPressDrag } from "../ui.js";
import { categoryForm, goalForm } from "../forms.js";

const TAX = { charitable: "Charitable", medical: "Medical", hsa: "HSA", deductible: "Tax deductible" };

export default {
  async render(ctx) {
    const { groups, tags } = await GET("/api/categories");
    const normal = groups.filter((g) => g.kind === "normal");
    ctx.el.innerHTML = `
      <div class="row between" style="margin-bottom:var(--gap)">
        <p class="muted" style="margin:0;max-width:70ch">Drag categories to reorder them or move them to another group (on a phone, press and hold for a moment first). Hidden categories keep their history but stay out of the way.</p>
        <div class="row"><button class="btn" data-addgroup>${icon("plus")} Add group</button><button class="btn primary" data-addcat>${icon("plus")} Add category</button></div>
      </div>
      <div class="grid g2">
        ${normal.map((g) => `<section class="card rise" data-gid="${g.id}">
          <div class="card-head"><h2 data-help="Tap the pencil to rename this group.">${esc(g.name)}${g.hidden ? ` <span class="pill">Hidden</span>` : ""}</h2>
            <div class="row"><button class="btn icon ghost sm" data-gedit="${g.id}" data-help="Rename this group.">${icon("edit")}</button>
              <button class="btn icon ghost sm" data-ghide="${g.id}" data-help="${g.hidden ? "Show this group again." : "Hide this group from the budget."}">${icon(g.hidden ? "check" : "x")}</button>
              <button class="btn icon ghost sm" data-gdel="${g.id}" data-help="Delete this group and its categories (they can be put back).">${icon("trash")}</button></div></div>
          <div data-drop="${g.id}" style="min-height:30px">
          ${g.categories.map((c) => `<div class="look" draggable="${matchMedia("(pointer: fine)").matches}" data-cid="${c.id}" style="cursor:${matchMedia("(pointer: fine)").matches ? "grab" : "default"}">
            <div class="what">${esc(c.name)} ${c.hidden ? `<span class="pill">Hidden</span>` : ""}${c.tax_kind ? ` <span class="pill accent">${TAX[c.tax_kind]}</span>` : ""}${c.goal_type ? ` <span class="pill good">Goal</span>` : ""}</div>
            <button class="btn icon ghost sm" data-goal="${c.id}" data-help="Set a savings goal.">${icon("target")}</button>
            <button class="btn icon ghost sm" data-cedit="${c.id}" data-help="Rename, hide, mark for taxes or delete.">${icon("edit")}</button></div>`).join("")}
          </div></section>`).join("")}
      </div>
      <section class="card rise" style="margin-top:var(--gap)">
        <div class="card-head"><h2>Tags</h2><button class="btn sm" data-addtag>${icon("plus")} Add tag</button></div>
        <p class="muted small" style="margin-top:-6px">Tags work across categories. Tags marked for taxes show up in the year-end tax report.</p>
        <div class="row">${tags.map((t) => `<button class="pill" data-tag="${t.id}" style="border:0;cursor:pointer" data-help="Tap to rename or mark for taxes.">${esc(t.name)}${t.tax_kind ? ` (${TAX[t.tax_kind]})` : ""}</button>`).join("")}</div>
      </section>`;
    const cats = groups.flatMap((g) => g.categories);
    const find = (id) => cats.find((c) => c.id == id);
    ctx.el.querySelector("[data-addcat]").onclick = () => categoryForm();
    ctx.el.querySelector("[data-addgroup]").onclick = async () => { const n = await askText({ title: "Add a group", label: "Group name", yes: "Add group" }); if (n) attempt(() => POST("/api/groups", { name: n }), "Group added."); };
    ctx.el.querySelectorAll("[data-cedit]").forEach((b) => b.onclick = () => categoryForm(find(b.dataset.cedit)));
    ctx.el.querySelectorAll("[data-goal]").forEach((b) => b.onclick = () => goalForm(find(b.dataset.goal)));
    ctx.el.querySelectorAll("[data-gedit]").forEach((b) => b.onclick = async () => {
      const g = groups.find((x) => x.id == b.dataset.gedit);
      const n = await askText({ title: "Rename group", label: "Group name", value: g.name });
      if (n) attempt(() => PUT(`/api/groups/${g.id}`, { name: n }), "Renamed.");
    });
    ctx.el.querySelectorAll("[data-ghide]").forEach((b) => b.onclick = () => { const g = groups.find((x) => x.id == b.dataset.ghide); attempt(() => PUT(`/api/groups/${g.id}`, { hidden: g.hidden ? 0 : 1 })); });
    ctx.el.querySelectorAll("[data-gdel]").forEach((b) => b.onclick = async () => {
      const g = groups.find((x) => x.id == b.dataset.gdel);
      if (await confirmBox({ title: `Delete ${esc(g.name)}?`, text: `<b>${esc(g.name)}</b> and its ${g.categories.length} categories will move to the Deleted page. Their transactions keep their categories, and you can put everything back.`, yes: "Delete group", danger: true }))
        attempt(() => DEL(`/api/groups/${g.id}`), "Moved to Deleted.");
    });
    ctx.el.querySelector("[data-addtag]").onclick = async () => { const n = await askText({ title: "New tag", label: "Tag name", yes: "Add tag" }); if (n) attempt(() => POST("/api/tags", { name: n }), "Tag added."); };
    ctx.el.querySelectorAll("[data-tag]").forEach((b) => b.onclick = async () => {
      const t = tags.find((x) => x.id == b.dataset.tag);
      const m = modal({ title: "Change tag", body: `<form class="form" data-f><label class="field"><span>Name</span><input name="name" value="${esc(t.name)}"></label>
        <label class="field"><span>Counts for taxes as</span><select name="tax_kind">${[["", "Nothing"], ...Object.entries(TAX)].map(([k, l]) => `<option value="${k}" ${t.tax_kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></label></form>`,
        foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Save tag</button>` });
      m.$("[data-go]").onclick = async () => { const v = formData(m.$("[data-f]")); if (await attempt(() => PUT(`/api/tags/${t.id}`, { name: v.name || t.name, tax_kind: v.tax_kind }), "Tag saved.")) m.close(); };
    });
    // drag to reorder / move
    let dragging = null;
    ctx.el.querySelectorAll("[data-cid]").forEach((row) => {
      longPressDrag(row);
      row.addEventListener("dragstart", (e) => { dragging = row; row.style.opacity = ".4"; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", row.dataset.cid); });
      row.addEventListener("dragend", () => { row.style.opacity = ""; dragging = null; });
    });
    ctx.el.querySelectorAll("[data-drop]").forEach((zone) => {
      zone.addEventListener("dragover", (e) => {
        if (!dragging) return;
        e.preventDefault(); e.stopPropagation();
        const after = [...zone.querySelectorAll("[data-cid]:not([style*='opacity'])")].find((r) => e.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
        after ? zone.insertBefore(dragging, after) : zone.append(dragging);
      });
      zone.addEventListener("drop", async (e) => {
        if (!dragging) return;
        e.preventDefault(); e.stopPropagation();
        const order = [...ctx.el.querySelectorAll("[data-drop]")].map((z) => ({ id: Number(z.dataset.drop), categories: [...z.querySelectorAll("[data-cid]")].map((r) => Number(r.dataset.cid)) }));
        await attempt(() => POST("/api/categories/reorder", { groups: order }), "Order saved.");
      });
    });
  },
};
