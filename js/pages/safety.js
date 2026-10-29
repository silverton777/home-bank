// Backup & partner: the Offline lock, backups, and sharing changes with your partner's phone.
import { icon } from "../icons.js";
import { GET, POST, esc, toast, modal, confirmBox, attempt } from "../ui.js";
import { saveFile, pickFile, readText, setOfflineLockFlag } from "../local/files.js";

const ago = (iso) => {
  if (!iso) return "never";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};
const mb = (n) => (n == null ? "" : n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(1)} MB`);

function askPasscode(title, text) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title, body: `<p>${text}</p><input class="passcode" type="password" data-pc placeholder="Passcode" autocomplete="current-password">`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>OK</button>`, onClose: () => { if (!done) resolve(null); } });
    const go = () => { done = true; const v = m.$("[data-pc]").value; m.close(); resolve(v); };
    m.$("[data-ok]").onclick = go;
    m.$("[data-pc]").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  });
}

export default {
  async render(ctx) {
    const s = await GET("/api/safety");
    const lockOn = s.offline_lock;
    const backupOld = !s.last_backup || Date.now() - new Date(s.last_backup).getTime() > 7 * 86400000;
    ctx.el.innerHTML = `
      ${!s.standalone ? `<section class="card rise warnbox"><b>Add Home Bank to your Home Screen.</b> In Safari tap Share, then <b>Add to Home Screen</b>, and open it from the new icon. iPhone keeps a Home Screen app's data safe; a plain Safari tab can be cleared.</section>` : ""}
      ${s.demo_mode ? `<section class="card rise warnbox">Demo mode is on. Backups and sharing use your real data, so leave demo mode first (tap Demo at the top).</section>` : ""}
      <section class="card rise lockcard2 ${lockOn ? "on" : ""}">
        <div class="row between" style="align-items:flex-start">
          <div><h2 style="margin:0 0 4px">${icon("shield")} Offline lock is ${lockOn ? "on" : "off"}</h2>
            <p class="muted" style="margin:0">${lockOn
              ? "Home Bank can't use the internet. It runs only from what's saved on this phone, and it won't change itself or update."
              : "Home Bank already never sends your data anywhere. Turning this on also stops it from loading anything, ever, including updates."}</p></div>
          <label class="switch big" data-help="${lockOn ? "Turning it off needs your passcode." : "Turn on to block every internet connection."}"><input type="checkbox" data-lock ${lockOn ? "checked" : ""}><span></span></label>
        </div>
        ${lockOn ? `<p class="small muted" style="margin:12px 0 0">To get an update later: turn the lock off (passcode), tap <b>Check for an update</b>, then turn it back on.</p>`
          : `<div class="row" style="margin-top:12px"><button class="btn sm" data-update data-help="Looks for a newer Home Bank where you installed it from. Only the app's files are checked; none of your data is sent.">Check for an update</button></div>`}
        <p class="small muted" style="margin:10px 0 0">Strongest protection: once both phones are set up, also switch off the website you installed from (see the guide). Then there's nothing online for Home Bank to reach, and nobody can change it.</p>
      </section>

      <div class="grid g2" style="margin-top:var(--gap)">
        <section class="card rise">
          <div class="card-head"><h2>${icon("archive")} Backups</h2>${backupOld ? `<span class="pill warn">Due</span>` : `<span class="pill good">${icon("check")} OK</span>`}</div>
          <p class="muted">A backup is one locked file with everything, receipt photos included. It opens only with one of your passcodes. Last backup: <b>${esc(ago(s.last_backup))}</b>.</p>
          <p class="muted small">Tap <b>Save a backup</b>, then <b>Save to Files</b> and pick a folder, or AirDrop it to a computer. Keep one somewhere other than this phone. If the phone is lost, this file is how you get everything back.</p>
          <div class="row"><button class="btn primary" data-backup ${s.demo_mode ? "disabled" : ""}>${icon("download")} Save a backup</button><button class="btn" data-restore ${s.demo_mode ? "disabled" : ""}>Restore a backup</button></div>
        </section>

        <section class="card rise">
          <div class="card-head"><h2>${icon("share")} Your partner's phone</h2></div>
          <p class="muted">The two phones don't connect to each other or to the internet. To stay in step, send a file: <b>AirDrop</b> it phone to phone, then the other phone taps <b>Get partner's changes</b>.</p>
          <div class="row"><button class="btn primary" data-send ${s.demo_mode ? "disabled" : ""}>${icon("share")} Send my changes</button><button class="btn" data-get ${s.demo_mode ? "disabled" : ""}>${icon("import")} Get partner's changes</button></div>
          <p class="small muted" style="margin-top:10px">Last sent: ${esc(ago(s.last_share_out))}. Last received: ${esc(ago(s.last_share_in))}.</p>
          <details class="small muted"><summary>How it works</summary>
            <p>Each phone keeps its own copy. The file carries everything on this phone; the other phone keeps whatever is newer on either side. If you both changed the same thing, the change made last wins. Nothing is ever lost from Edit History.</p>
            <p><b>First time on your partner's phone:</b> install Home Bank there, tap <b>Use my partner's file or a backup</b>, pick the file you sent, and they type their own passcode.</p>
            <p>A good habit: send and get once a week, or after a big budgeting session. AirDrop works with no Wi-Fi and no internet.</p></details>
        </section>
      </div>

      <section class="card rise" style="margin-top:var(--gap)"><h2>On this phone</h2>
        <div class="look"><div class="what">Storage used<small>Everything Home Bank keeps on this phone, encrypted.</small></div><span>${esc(mb(s.used))}</span></div>
        <div class="look"><div class="what">Protected from clean-up<small>${s.persisted ? "Yes. The phone won't clear Home Bank's data to save space." : "Not confirmed. Keep Home Bank on your Home Screen and keep backups."}</small></div><span>${s.persisted ? icon("check") : ""}</span></div>
        <div class="look"><div class="what">Version<small>Home Bank ${esc(s.version)}</small></div></div>
      </section>`;
    const $ = (q) => ctx.el.querySelector(q);

    $("[data-lock]").onchange = async (e) => {
      const on = e.target.checked;
      if (on) {
        if (!(await confirmBox({ title: "Turn on the Offline lock?", text: "From now on Home Bank won't load anything from the internet, not even updates. Everything keeps working from this phone. You can turn it off later with your passcode.", yes: "Turn it on" }))) { e.target.checked = false; return; }
        await POST("/api/offline-lock", { on: true });
        await setOfflineLockFlag(true);
        toast("Offline lock is on.");
      } else {
        const pc = await askPasscode("Turn off the Offline lock?", "Type your passcode. While it's off, Home Bank can download its own updates (never your data).");
        if (pc === null) { e.target.checked = true; return; }
        try { await POST("/api/offline-lock", { on: false, passcode: pc }); await setOfflineLockFlag(false); toast("Offline lock is off."); }
        catch (err) { e.target.checked = true; toast(err.message, { bad: true }); return; }
      }
      ctx.refresh();
    };

    $("[data-update]")?.addEventListener("click", async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) { toast("Add Home Bank to your Home Screen first.", { bad: true }); return; }
      toast("Checking…");
      try {
        await reg.update();
        const nw = reg.installing || reg.waiting;
        if (!nw) { toast("You have the latest Home Bank."); return; }
        const done = () => toast("Update ready. Close Home Bank and open it again to use it.", { ms: 8000 });
        if (nw.state === "installed" || nw.state === "activated") done();
        else nw.addEventListener("statechange", () => { if (nw.state === "activated" || nw.state === "installed") done(); if (nw.state === "redundant") toast("The update didn't install.", { bad: true }); });
      } catch { toast("Couldn't reach the place Home Bank was installed from. That's fine; it keeps working as is.", { bad: true }); }
    });

    const send = async (kind) => {
      const f = await attempt(() => POST("/api/file/make", { kind }));
      if (!f) return;
      const how = await saveFile(f.filename, f.text, "application/octet-stream");
      if (how === "cancelled") return;
      toast(kind === "share" ? "Now open Home Bank on the other phone and tap Get partner's changes." : "Backup saved. Keep it somewhere other than this phone, too.", { ms: 6000 });
      ctx.refresh();
    };
    $("[data-backup]").onclick = () => send("backup");
    $("[data-send]").onclick = () => send("share");
    $("[data-get]").onclick = async () => {
      const file = await pickFile();
      if (!file) return;
      const r = await attempt(async () => POST("/api/file/receive", { text: await readText(file) }));
      if (r) toast(r.changed ? `Got ${r.changed} change${r.changed === 1 ? "" : "s"} from the other phone.` : "Already up to date. Nothing new in that file.", { ms: 5000 });
    };
    $("[data-restore]").onclick = async () => {
      const file = await pickFile();
      if (!file) return;
      const text = await readText(file);
      if (!(await confirmBox({ title: "Replace everything with this backup?", text: "Everything on this phone is replaced by what's in the backup. Anything newer than the backup is lost (save a backup first if unsure).", yes: "Replace with backup", danger: true }))) return;
      const pc = await askPasscode("Passcode for this backup", "Type the passcode you used when the backup was made.");
      if (pc === null) return;
      if (await attempt(() => POST("/api/file/restore", { text, passcode: pc }), "Backup restored.")) ctx.refresh();
    };
  },
};
