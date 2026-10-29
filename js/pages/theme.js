import { icon } from "../icons.js";
import { PUT, askText, esc, attempt, toast } from "../ui.js";
import * as T from "../theme.js";

export default {
  async render(ctx) {
    let t = T.normalize(ctx.theme);
    const draw = () => {
      const pal = T.palette(t);
      const sliders = [["roundness", "Roundness", 0, 28, "px", "How round the corners are."], ["frost", "Frost (glass blur)", 0, 40, "px", "How blurry the glass cards are."],
        ["opacity", "Panel opacity", 15, 100, "%", "How see-through the cards are."], ["glow", "Glow strength", 0, 100, "%", "How strong the colored glows and button glow are."],
        ["motionAmt", "Background motion", 0, 200, "%", "How fast the background glows drift."], ["textSize", "Text size", 85, 130, "%", "Make all text bigger or smaller."]];
      ctx.el.innerHTML = `
        <section class="card rise" style="margin-bottom:var(--gap)">
          <div class="row between"><h2 style="margin:0">Look</h2>
            <div class="row">
              <div class="seg" data-help="Frosted glass: see-through cards over drifting color. Minimal: clean, solid and quiet, like Apple's apps.">${[["glass", "Frosted glass"], ["minimal", "Minimal"]].map(([k, l]) => `<button data-k="style" data-v="${k}" class="${t.style === k ? "on" : ""}">${l}</button>`).join("")}</div>
              <div class="seg">${[["dark", "Dark"], ["light", "Light"]].map(([k, l]) => `<button data-k="mode" data-v="${k}" class="${t.mode === k ? "on" : ""}">${l}</button>`).join("")}</div>
              <div class="seg" data-help="Compact fits more rows on screen.">${[["comfortable", "Comfortable"], ["compact", "Compact"]].map(([k, l]) => `<button data-k="density" data-v="${k}" class="${t.density === k ? "on" : ""}">${l}</button>`).join("")}</div>
              <div class="seg" data-help="Reduced motion turns off animations and drifting glows.">${[["full", "Full motion"], ["reduced", "Reduced motion"]].map(([k, l]) => `<button data-k="motion" data-v="${k}" class="${t.motion === k ? "on" : ""}">${l}</button>`).join("")}</div>
            </div></div></section>
        <section class="card rise" style="margin-bottom:var(--gap)"><h2>Color sets</h2>
          <div class="swatches">${Object.entries(T.PRESETS).map(([k, p]) => { const c = p[t.mode]; return `<div class="swatch ${t.preset === k ? "on" : ""}" data-preset="${k}" style="background:${c.bg};color:${c.text}" data-help="Use the ${esc(p.name)} colors.">
            <b>${esc(p.name)}</b><div class="chips">${[c.accent, c.accent2, c.good, c.bad].map((x) => `<i style="background:${x}"></i>`).join("")}</div></div>`; }).join("")}</div></section>
        <div class="grid g2">
          <section class="card rise"><div class="card-head"><h2>Every color</h2><button class="btn sm ghost" data-resetcolors data-help="Go back to this color set's own colors.">Reset colors</button></div>
            <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px">
            ${T.COLOR_KEYS.filter(([k]) => t.style === "glass" || !k.startsWith("glow")).map(([k, l]) => `<label class="row" style="gap:10px;flex-wrap:nowrap" data-help="Pick the ${esc(l.toLowerCase())} color."><input type="color" data-color="${k}" value="${pal[k]}"><span>${esc(l)}</span></label>`).join("")}</div></section>
          <section class="card rise"><h2>Fine-tune</h2>
            ${sliders.filter(([k]) => t.style === "glass" || !["frost", "opacity", "glow", "motionAmt"].includes(k)).map(([k, l, min, max, unit, help]) => `<label class="field" style="margin-bottom:8px" data-help="${esc(help)}"><span>${l}: <b data-out="${k}" style="color:var(--text)">${t[k]}${unit}</b></span>
              <input type="range" min="${min}" max="${max}" value="${t[k]}" data-slider="${k}" data-unit="${unit}"></label>`).join("")}</section>
        </div>
        <section class="card rise" style="margin-top:var(--gap)"><h2>Share a theme</h2>
          <p class="muted small">Copy your theme as text to keep it or give it to your partner. Paste one to use it.</p>
          <div class="row"><button class="btn" data-copy>${icon("download")} Copy theme as text</button><button class="btn" data-paste>Paste a theme</button><span class="spacer"></span>
            <button class="btn ghost" data-default data-help="Make this the look for anyone who hasn't picked their own, like the sign-in screen.">Use for everyone</button></div></section>`;
      wire();
    };
    let saveT = null;
    const save = (redraw = false) => {
      t = ctx.setTheme(t);
      if (redraw) draw();
      clearTimeout(saveT);
      saveT = setTimeout(() => PUT("/api/theme", { theme: t }).catch((e) => toast(e.message, { bad: true })), 400);
    };
    const wire = () => {
      ctx.el.querySelectorAll("[data-k]").forEach((b) => b.onclick = () => { t[b.dataset.k] = b.dataset.v; save(true); });
      ctx.el.querySelectorAll("[data-preset]").forEach((b) => b.onclick = () => { t.preset = b.dataset.preset; save(true); });
      ctx.el.querySelectorAll("[data-color]").forEach((inp) => inp.oninput = () => {
        const key = `${t.style}-${t.mode}`;
        t.custom = { ...t.custom, [key]: { ...(t.custom[key] || {}), [inp.dataset.color]: inp.value } };
        save(false);
      });
      ctx.el.querySelectorAll("[data-slider]").forEach((r) => r.oninput = () => { t[r.dataset.slider] = Number(r.value); ctx.el.querySelector(`[data-out="${r.dataset.slider}"]`).textContent = r.value + r.dataset.unit; save(false); });
      ctx.el.querySelector("[data-resetcolors]").onclick = () => { const c = { ...t.custom }; delete c[`${t.style}-${t.mode}`]; t.custom = c; save(true); };
      ctx.el.querySelector("[data-copy]").onclick = async () => {
        const txt = T.toText(t);
        try { await navigator.clipboard.writeText(txt); toast("Theme copied. Paste it anywhere to save it."); }
        catch { const r = await askText({ title: "Copy this theme", label: "Select all of this text and copy it (Ctrl+C)", value: txt, yes: "Done" }); }
      };
      ctx.el.querySelector("[data-paste]").onclick = async () => {
        const txt = await askText({ title: "Paste a theme", label: "Paste the theme text here (Ctrl+V)", yes: "Use this theme" });
        if (!txt) return;
        try { t = T.fromText(txt); save(true); toast("Theme applied."); } catch { toast("That doesn't look like a Home Bank theme.", { bad: true }); }
      };
      ctx.el.querySelector("[data-default]").onclick = () => attempt(() => PUT("/api/theme", { theme: t, make_default: true }), "This look is now the default.");
    };
    draw();
  },
};
