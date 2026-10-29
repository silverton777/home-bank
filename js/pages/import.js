import { icon } from "../icons.js";
import { GET, POST, esc, money, niceDate, attempt, plural, toast } from "../ui.js";
import { importFlow } from "../forms.js";
import { pickFile } from "../local/files.js";

export default {
  async render(ctx) {
    const { pairs } = await GET("/api/transfers/suggest");
    ctx.el.innerHTML = `
      <section class="card rise center">
        ${icon("import").replace("<svg", '<svg style="width:40px;height:40px;color:var(--accent)"')}
        <h2 style="margin:10px 0 4px">Import a bank file</h2>
        <p class="muted">CSV, OFX, QFX and QIF all work. Save the file from your bank's website first (it goes to Files > Downloads).</p>
        <button class="btn primary big" data-pick data-help="Opens Files so you can pick the file you downloaded from your bank.">${icon("import")} Pick the file</button>
      </section>
      <div class="grid g2" style="margin-top:var(--gap)">
        <section class="card rise"><h2>How to get the file on an iPhone</h2>
          <ol class="muted" style="padding-left:20px;margin:0">
            <li>In Safari, sign in to your bank's website (not the bank's app).</li>
            <li>Open the account and look for <b>Download</b> or <b>Export</b>.</li>
            <li>Pick a date range that starts at your last import.</li>
            <li>Choose <b>Quicken (QFX)</b>, <b>OFX</b> or <b>CSV</b>. QFX/OFX are best: they include IDs that stop duplicates.</li>
            <li>Tap Download. Then come back here and tap <b>Pick the file</b>. It's in <b>Downloads</b>.</li></ol>
          <p class="muted small">Home Bank reads the file on this phone. Your bank never talks to Home Bank.</p></section>
        <section class="card rise"><h2>What Home Bank checks</h2>
          <ul class="muted" style="padding-left:20px;margin:0">
            <li><b>Duplicates</b>: anything already in Home Bank is unticked so it isn't added twice.</li>
            <li><b>Transfers</b>: a payment from checking to your card is matched up, so it isn't counted as spending.</li>
            <li><b>Rules</b>: payee names are cleaned up and categories filled in.</li>
            <li><b>CSV columns</b>: the first time, you show Home Bank which column is which. It remembers for that bank.</li></ul></section>
      </div>
      <section class="card rise" style="margin-top:var(--gap)">
        <div class="card-head"><h2>Possible transfers</h2>${pairs.length ? `<button class="btn sm" data-all data-help="Mark every pair below as a transfer between your accounts.">Match all ${pairs.length}</button>` : ""}</div>
        ${pairs.length ? pairs.map((p, i) => `<div class="look"><div class="what">${esc(p.out.payee)} → ${esc(p.in.payee)}<small>${esc(p.out.account)} to ${esc(p.in.account)}, ${esc(niceDate(p.out.date))}</small></div>
          <span class="money">${money(p.in.amount)}</span><button class="btn sm" data-match="${i}" data-help="These two are the same money moving between your accounts.">Match</button></div>`).join("")
          : `<p class="muted">Nothing to match. When money leaves one account and the same amount lands in another within a few days, it shows up here.</p>`}
      </section>`;
    ctx.el.querySelector("[data-pick]").onclick = async () => {
      const f = await pickFile(".csv,.ofx,.qfx,.qif,.txt,text/csv,application/x-ofx,application/vnd.intu.qfx");
      if (f) importFlow(f);
    };
    const match = (p) => POST(`/api/transactions/${p.out.id}/link`, { other_id: p.in.id });
    ctx.el.querySelectorAll("[data-match]").forEach((b) => b.onclick = () => attempt(() => match(pairs[b.dataset.match]), "Matched."));
    ctx.el.querySelector("[data-all]")?.addEventListener("click", async () => {
      let n = 0;
      for (const p of pairs) { try { await match(p); n++; } catch { /* skip */ } }
      toast(`Matched ${plural(n, "transfer")}.`);
    });
  },
};
