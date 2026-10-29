import { icon } from "../icons.js";
import { GET, POST, esc, attempt } from "../ui.js";

export default {
  async render(ctx) {
    const { examples } = await GET("/api/ask/examples");
    let history = [];
    try { history = JSON.parse(sessionStorage.getItem("hb-ask") || "[]"); } catch { /* ignore */ }
    ctx.el.innerHTML = `
      <section class="card rise" style="max-width:860px">
        <form class="row" data-f style="flex-wrap:nowrap">
          <input name="q" placeholder="How much did we spend eating out last month?" autocomplete="off" spellcheck="true" data-help="Ask in plain English. Answers come straight from your own data on this computer; nothing leaves it.">
          <button class="btn primary">${icon("chat")} Ask</button>
        </form>
        <div class="muted small" style="margin:14px 0 8px">Try one of these:</div>
        <div class="chips-row">${examples.map((e) => `<button type="button" data-ex="${esc(e)}">${esc(e)}</button>`).join("")}</div>
      </section>
      <div class="stack" data-answers style="margin-top:var(--gap);max-width:860px">
        ${history.map(answerCard).join("")}
      </div>`;
    const f = ctx.el.querySelector("[data-f]");
    const box = ctx.el.querySelector("[data-answers]");
    const ask = async (q) => {
      if (!q.trim()) return;
      const r = await attempt(() => POST("/api/ask", { question: q }));
      if (!r) return;
      const item = { q, ...r };
      history.unshift(item);
      history = history.slice(0, 20);
      sessionStorage.setItem("hb-ask", JSON.stringify(history));
      box.insertAdjacentHTML("afterbegin", answerCard(item));
      f.q.value = "";
    };
    f.addEventListener("submit", (e) => { e.preventDefault(); ask(f.q.value); });
    ctx.el.querySelectorAll("[data-ex]").forEach((b) => b.onclick = () => ask(b.dataset.ex));
    f.q.focus();
  },
};

function answerCard(a) {
  return `<section class="card rise"><div class="muted small">${esc(a.q)}</div>
    <div class="answer" style="margin-top:6px">${esc(a.answer)}</div>
    ${a.table ? `<table class="list" style="margin-top:10px"><tbody>${a.table.map((r) => `<tr>${r.map((c, i) => `<td class="${i === r.length - 1 ? "amt money" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : ""}</section>`;
}
