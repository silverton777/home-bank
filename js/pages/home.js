// "More": every part of Home Bank as a tile, plus undo/redo and help.
import { icon } from "../icons.js";
import { GET, esc, setHelpMode } from "../ui.js";
import { w, wt } from "../words.js";
import { undo, redo, lockNow } from "../app.js";

export default {
  async render(ctx) {
    const u = await GET("/api/undo").catch(() => ({}));
    const groups = ctx.nav.map((g) => ({ head: g.head, items: g.items.filter(([k]) => !["dashboard", "budget", "register"].includes(k)) })).filter((g) => g.items.length);
    ctx.el.innerHTML = `
      <section class="card rise">
        <div class="row" style="gap:8px">
          <button class="btn grow" data-undo ${u.undo ? "" : "disabled"} data-help="Take back your last change.">${icon("undo")} Undo</button>
          <button class="btn grow" data-redo ${u.redo ? "" : "disabled"} data-help="Put back what you just undid.">${icon("redo")} Redo</button>
        </div>
        ${u.undo ? `<p class="small muted" style="margin:8px 2px 0">Last change: ${esc(u.undo)}</p>` : ""}
      </section>
      ${groups.map((g, gi) => `${g.head ? `<h3 class="tiles-head">${w("navhead." + g.head, g.head)}</h3>` : ""}<div class="tiles">${g.items.map(([k, ic, t, s], i) => `
        <a class="card tile rise" style="animation-delay:${(gi * 4 + i) * 20}ms" href="#/${k}" data-help="${esc(wt("page." + k + ".sub", s))}">${icon(ic)}<b>${w("page." + k + ".title", t)}</b></a>`).join("")}</div>`).join("")}
      <div class="row" style="margin-top:var(--gap);gap:8px">
        <button class="btn grow" data-helpmode>${icon("info")} Help mode</button>
        <button class="btn grow" data-lock>${icon("lock")} Lock</button>
      </div>`;
    ctx.el.querySelector("[data-undo]").onclick = async () => { await undo(); ctx.refresh(); };
    ctx.el.querySelector("[data-redo]").onclick = async () => { await redo(); ctx.refresh(); };
    ctx.el.querySelector("[data-helpmode]").onclick = () => setHelpMode(true);
    ctx.el.querySelector("[data-lock]").onclick = lockNow;
  },
};
