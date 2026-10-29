import { icon } from "../icons.js";
import { GET, POST, PUT, askText, esc, attempt, modal, formData, confirmBox, toast, avatar, setHelpMode } from "../ui.js";
import { editWords } from "../app.js";

export default {
  async render(ctx) {
    const s = await GET("/api/settings");
    const me = ctx.info.person;
    ctx.el.innerHTML = `<div class="grid g2">
      <section class="card rise"><div class="card-head"><h2>The two of you</h2>${s.people.length < 2 && !s.demo_mode ? `<button class="btn sm" data-addperson>${icon("plus")} Add partner</button>` : ""}</div>
        ${s.people.map((p) => `<div class="look">${avatar(p)}<div class="what">${esc(p.name)}${p.id === me.id ? ` <span class="pill">You</span>` : ""}</div>
          <button class="btn sm" data-rename="${p.id}">Rename</button><button class="btn sm" data-pass="${p.id}" data-help="Change this person's passcode. You'll need your own passcode to do it.">Passcode</button></div>`).join("")}
        <p class="muted small">Each person has their own passcode. Edit History shows who made each change. Passcode changes reach the other phone the next time you share.</p></section>

      <section class="card rise"><h2>Words and help</h2>
        <div class="look"><div class="what">Edit words<small>Rename any label in Home Bank, including help text. Also the Aa button at the top of every page.</small></div><button class="btn sm" data-words>${icon("words")} Edit words</button></div>
        <div class="look"><div class="what">Help mode<small>Tap ? at the top of any page, then tap anything to see what it does.</small></div><button class="btn sm" data-help-on>Try it</button></div></section>

      <section class="card rise"><h2>Demo mode</h2>
        ${s.demo_mode ? `<p>Demo mode is on. Everything showing is made up. Going back to your real Home Bank needs a passcode.</p>
          <button class="btn primary" data-leavedemo2>Leave demo mode</button>`
        : `<p class="muted">Show Home Bank to friends or family with made-up money. Your real accounts are completely hidden while it's on, and getting back to them needs one of your passcodes. The demo starts fresh every time, and nothing visitors change is kept.</p>
          <button class="btn primary" data-startdemo data-help="Switch to made-up money. Your real data stays safe and hidden.">Start demo mode</button>`}</section>

      <section class="card rise"><h2>More settings</h2>
        <div class="row"><a class="btn" href="#/safety">${icon("shield")} Backup & partner</a><a class="btn" href="#/categories">${icon("tag")} Categories</a><a class="btn" href="#/rules">${icon("wand")} Rules</a>
          <a class="btn" href="#/accounts">${icon("wallet")} Accounts</a><a class="btn" href="#/theme">${icon("palette")} Theme</a><a class="btn" href="#/bills">${icon("repeat")} Recurring</a></div>
        <p class="muted small" style="margin-top:14px">Home Bank ${esc(s.version)}. Everything stays on this phone, locked with your passcodes. Home Bank never sends anything anywhere.</p></section>
    </div>`;
    const $ = (q) => ctx.el.querySelector(q);
    $("[data-words]").onclick = editWords;
    $("[data-help-on]").onclick = () => setHelpMode(true);
    $("[data-startdemo]")?.addEventListener("click", async () => {
      if (await confirmBox({ title: "Start demo mode?", text: "Home Bank switches to made-up money. Your real data is hidden until someone types one of your passcodes.", yes: "Start demo mode" })) {
        const { enterDemo } = await import("../app.js");
        attempt(() => enterDemo());
      }
    });
    $("[data-leavedemo2]")?.addEventListener("click", () => document.querySelector("[data-leavedemo]")?.click());
    $("[data-addperson]")?.addEventListener("click", () => {
      const m = modal({ title: "Add your partner", body: `<form class="form" data-f><label class="field"><span>Name</span><input name="name"></label><label class="field"><span>Their passcode</span><input name="passcode" type="password" autocomplete="new-password"></label></form>
        <p class="muted small">Then share with their phone (More > Backup & partner) so they can sign in there with this passcode.</p>`,
        foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Add partner</button>` });
      m.$("[data-go]").onclick = async () => { if (await attempt(() => POST("/api/people", formData(m.$("[data-f]"))), "Added.")) { m.close(); ctx.refresh(); } };
    });
    ctx.el.querySelectorAll("[data-rename]").forEach((b) => b.onclick = async () => {
      const p = s.people.find((x) => x.id == b.dataset.rename);
      const n = await askText({ title: "Rename", label: "Name", value: p.name });
      if (n) attempt(() => PUT(`/api/people/${p.id}`, { name: n }), "Renamed.");
    });
    ctx.el.querySelectorAll("[data-pass]").forEach((b) => b.onclick = () => {
      const p = s.people.find((x) => x.id == b.dataset.pass);
      const m = modal({ title: `New passcode for ${esc(p.name)}`,
        body: `<form class="form" data-f><label class="field full"><span>Your current passcode (${esc(me.name)})</span><input name="current" type="password" autocomplete="current-password"></label>
          <label class="field"><span>New passcode</span><input name="new" type="password" autocomplete="new-password"></label><label class="field"><span>Type it again</span><input name="again" type="password" autocomplete="new-password"></label></form>`,
        foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Change passcode</button>` });
      m.$("[data-go]").onclick = async () => {
        const v = formData(m.$("[data-f]"));
        if (v.new !== v.again) { toast("The two new passcodes don't match.", { bad: true }); return; }
        if (await attempt(() => POST(`/api/people/${p.id}/passcode`, { current: v.current, new: v.new }), "Passcode changed.")) m.close();
      };
    });
  },
};
