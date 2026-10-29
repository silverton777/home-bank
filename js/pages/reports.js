import { icon } from "../icons.js";
import { GET, POST, esc, money, attempt, barChart, lineChart, donut, PALETTE, niceDate, toast } from "../ui.js";

const KINDS = [["category", "By category"], ["payee", "By payee"], ["month", "By month"], ["income", "Income vs spending"], ["trends", "Trends"], ["tax", "Tax report"]];
const PERIODS = [["this_month", "This month"], ["last_month", "Last month"], ["this_year", "This year"], ["last_year", "Last year"], ["last_12", "Last 12 months"], ["custom", "Pick dates"]];

export default {
  async render(ctx) {
    const p = { kind: "category", period: "this_month", ...ctx.params };
    const qs = new URLSearchParams(p);
    const r = await GET("/api/reports?" + qs);
    const cats = p.kind === "trends" ? await GET("/api/categories") : null;
    const set = (k, v) => ctx.go("#/reports?" + new URLSearchParams({ ...p, [k]: v }));
    const year = Number(p.year || new Date().getFullYear());
    let body = "";
    if (p.kind === "category") {
      body = r.rows.length ? `<div class="row" style="align-items:flex-start;gap:28px">
          <div style="flex:0 0 220px">${donut(r.rows.slice(0, 9).map((x, i) => ({ label: x.name, value: x.amount, color: PALETTE[i] })).concat(r.rows.length > 9 ? [{ label: "Everything else", value: r.rows.slice(9).reduce((a, b) => a + b.amount, 0), color: PALETTE[9] }] : []), 220)}</div>
          <table class="list cards" style="flex:1;min-width:260px"><thead><tr><th>Category</th><th class="hide-phone">Group</th><th class="amt">Spent</th><th class="amt">Share</th></tr></thead><tbody>
          ${r.rows.map((x, i) => `<tr class="clickable" data-cat="${x.id}"><td class="lead"><i class="dot" style="background:${PALETTE[Math.min(i, 9)]}"></i> ${esc(x.name)}</td><td class="hide-phone muted">${esc(x.group_name)}</td><td class="amt money">${money(x.amount)}</td><td class="amt muted">${Math.round((x.amount * 100) / r.total)}%</td></tr>`).join("")}
          </tbody></table></div>` : `<p class="muted">No spending in this period.</p>`;
    } else if (p.kind === "payee") {
      body = r.rows.length ? `<table class="list cards"><thead><tr><th>Payee</th><th class="amt">Times</th><th class="amt">Spent</th></tr></thead><tbody>
        ${r.rows.map((x) => `<tr class="clickable" data-q="${esc(x.name)}"><td class="lead">${esc(x.name)}</td><td class="amt" data-label="Times">${x.count}</td><td class="amt money">${money(x.spent)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No spending in this period.</p>`;
    } else if (p.kind === "month") {
      body = r.rows.length ? `<div style="overflow-x:auto"><table class="list"><thead><tr><th>Category</th>${r.months.map((m) => `<th class="amt">${esc(new Date(m + "-15T12:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" }))}</th>`).join("")}<th class="amt">Total</th></tr></thead><tbody>
        ${r.rows.map((x) => `<tr><td>${esc(x.name)}</td>${x.values.map((v) => `<td class="amt money">${v ? money(v, { noCents: true }) : ""}</td>`).join("")}<td class="amt money"><b>${money(x.total, { noCents: true })}</b></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No spending in this period.</p>`;
    } else if (p.kind === "income") {
      const lab = r.rows.map((x) => new Date(x.month + "-15T12:00").toLocaleDateString("en-US", { month: "short" }));
      body = barChart({ labels: lab, series: [{ name: "Income", color: "var(--good)", values: r.rows.map((x) => x.income) }, { name: "Spending", color: "var(--accent)", values: r.rows.map((x) => x.spending) }] }) +
        `<table class="list cards" style="margin-top:14px"><thead><tr><th>Month</th><th class="amt">Income</th><th class="amt">Spending</th><th class="amt">Saved</th></tr></thead><tbody>
        ${r.rows.slice().reverse().map((x) => `<tr><td class="lead">${esc(new Date(x.month + "-15T12:00").toLocaleDateString("en-US", { month: "long", year: "numeric" }))}</td><td class="amt money in" data-label="Income">${money(x.income)}</td><td class="amt money" data-label="Spending">${money(x.spending)}</td><td class="amt"><span class="money ${x.saved < 0 ? "bad" : "good"}">${money(x.saved)}</span></td></tr>`).join("")}</tbody></table>`;
    } else if (p.kind === "trends") {
      const lab = r.rows.map((x) => new Date(x.month + "-15T12:00").toLocaleDateString("en-US", { month: "short" }));
      body = `<label class="field" style="max-width:300px;margin-bottom:12px"><span>Category</span><select data-tcat><option value="">All spending</option>${cats.groups.filter((g) => g.kind === "normal").flatMap((g) => g.categories).map((c) => `<option value="${c.id}" ${p.category == c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>` +
        lineChart({ labels: lab, series: [{ name: "This year", color: "var(--accent)", values: r.rows.map((x) => x.amount) }, { name: "Same month last year", color: "var(--faint)", values: r.rows.map((x) => x.last_year), dash: true }], zero: true });
    } else if (p.kind === "tax") {
      body = `<div class="row" style="margin-bottom:12px"><a class="btn icon" href="#/reports?kind=tax&year=${year - 1}">${icon("left")}</a><b style="font-size:1.2em">${year}</b><a class="btn icon" href="#/reports?kind=tax&year=${year + 1}">${icon("right")}</a>
          <span class="muted small" style="margin-left:12px">Comes from categories marked for taxes (Categories page) and tags like Tax Deductible, Charitable, Medical and HSA.</span></div>
        <div class="grid g2" style="margin-bottom:12px">${r.sections.map((s) => `<div class="card"><div class="muted">${esc(s.label)}</div><div class="stat"><span class="value">${money(s.total)}</span></div><small class="muted">${s.items.length} transactions</small></div>`).join("")}</div>
        ${r.sections.filter((s) => s.items.length).map((s) => `<h3>${esc(s.label)}</h3><table class="list cards"><tbody>${s.items.map((i) => `<tr><td data-label="Date" class="muted">${esc(niceDate(i.date, { year: true }))}</td><td class="lead">${esc(i.payee)}</td><td class="muted small">${esc(i.category)}</td><td class="amt money">${money(i.amount)}</td></tr>`).join("")}</tbody></table>`).join("")}
        <p class="muted small">This is a summary to help at tax time, not tax advice.</p>`;
    }
    ctx.el.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <div class="seg" style="flex-wrap:wrap">${KINDS.map(([k, l]) => `<button data-kind="${k}" class="${p.kind === k ? "on" : ""}">${l}</button>`).join("")}</div>
      </div>
      <div class="row" style="margin-bottom:var(--gap)">
        ${["category", "payee", "month"].includes(p.kind) ? `<select data-period style="max-width:200px" data-help="Which dates to include.">${PERIODS.map(([k, l]) => `<option value="${k}" ${p.period === k ? "selected" : ""}>${l}</option>`).join("")}</select>
          ${p.period === "custom" ? `<input type="date" data-s value="${esc(p.start || "")}" style="max-width:170px"><input type="date" data-e value="${esc(p.end || "")}" style="max-width:170px">` : ""}
          ${r.start ? `<span class="muted small">${esc(niceDate(r.start, { year: true }))} to ${esc(niceDate(r.end, { year: true }))}</span>` : ""}` : ""}
        <span class="spacer"></span>
        <button class="btn" data-export="csv" data-help="Save this report as a spreadsheet file (CSV). Numbers, Excel and Google Sheets all open it.">${icon("download")} Spreadsheet</button>
        <button class="btn" data-print data-help="Print it, or tap Share in the print screen to save it as a PDF.">${icon("download")} Print / PDF</button>
        <button class="btn ghost" data-export-txns data-help="Save every transaction as a spreadsheet file (CSV).">All transactions</button>
      </div>
      <section class="card rise">${body}</section>`;
    ctx.el.querySelectorAll("[data-kind]").forEach((b) => b.onclick = () => ctx.go(`#/reports?kind=${b.dataset.kind}&period=${p.period}`));
    ctx.el.querySelector("[data-period]")?.addEventListener("change", (e) => set("period", e.target.value));
    ctx.el.querySelector("[data-s]")?.addEventListener("change", (e) => set("start", e.target.value));
    ctx.el.querySelector("[data-e]")?.addEventListener("change", (e) => set("end", e.target.value));
    ctx.el.querySelector("[data-tcat]")?.addEventListener("change", (e) => set("category", e.target.value));
    ctx.el.querySelectorAll("[data-cat]").forEach((x) => x.onclick = () => ctx.go(`#/register?category=${x.dataset.cat}&start=${r.start}&end=${r.end}`));
    ctx.el.querySelectorAll("[data-q]").forEach((x) => x.onclick = () => ctx.go(`#/register?q=${encodeURIComponent(x.dataset.q)}&start=${r.start}&end=${r.end}`));
    const exp = async (kind, format) => {
      const kindMap = { trends: "income" };
      const res = await attempt(() => POST("/api/export", { kind: kindMap[kind] || kind, format, period: p.period, start: p.start, end: p.end, year }));
      if (!res) return;
      const { saveFile } = await import("../local/files.js");
      await saveFile(res.filename, res.text, "text/csv");
    };
    ctx.el.querySelectorAll("[data-export]").forEach((b) => b.onclick = () => exp(p.kind, b.dataset.export));
    ctx.el.querySelector("[data-export-txns]").onclick = () => exp("transactions", "csv");
    ctx.el.querySelector("[data-print]").onclick = () => window.print();
  },
};
