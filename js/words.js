// Edit Words: rename any text in Home Bank, including help-box text.
// Tap the "Aa" button in the top bar, then tap any outlined text.
// Your wording is saved with your data on the phone (and travels in backups and partner files).
//
// Two kinds of saved wording:
//   "<key>"      labels made with w(key, default)
//   "t:<text>"   any other text on screen, matched by its original wording
//   "h:<text>"   help-box text, matched by its original wording
let overrides = {};
const original = new WeakMap(); // text node -> original wording

const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function setWords(o) { overrides = o || {}; startObserver(); }
export function wt(key, def) { return overrides[key] ?? def; }
export function w(key, def) { return `<span data-w="${escape(key)}" data-wdef="${escape(def)}">${escape(wt(key, def))}</span>`; }

const hasText = () => Object.keys(overrides).some((k) => k.startsWith("t:") || k.startsWith("h:"));

function fixNode(n) {
  if (n.nodeType === 3) {
    const raw = n.nodeValue;
    const t = raw.trim();
    if (!t || n.parentElement?.closest("[data-w], script, style, textarea, .edit-words-bar, .words-editor")) return;
    if (!original.has(n)) original.set(n, t);
    const rep = overrides["t:" + original.get(n)];
    if (rep !== undefined && t !== rep) n.nodeValue = raw.replace(t, rep);
  } else if (n.nodeType === 1) {
    const h = n.getAttribute("data-help");
    if (h) {
      if (!n.hasAttribute("data-help-orig")) n.setAttribute("data-help-orig", h);
      const rep = overrides["h:" + n.getAttribute("data-help-orig")];
      if (rep !== undefined && h !== rep) n.setAttribute("data-help", rep);
    }
    const ph = n.getAttribute("placeholder");
    if (ph) {
      if (!n.hasAttribute("data-ph-orig")) n.setAttribute("data-ph-orig", ph);
      const rep = overrides["t:" + n.getAttribute("data-ph-orig")];
      if (rep !== undefined && ph !== rep) n.setAttribute("placeholder", rep);
    }
  }
}

function walk(root) {
  if (root.nodeType === 3) return fixNode(root);
  if (root.nodeType !== 1) return;
  fixNode(root);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = it.nextNode())) fixNode(n);
}

let observer = null;
function startObserver() {
  if (observer || !document.body) return;
  observer = new MutationObserver((muts) => {
    if (!hasText() && !document.documentElement.classList.contains("edit-words")) return;
    for (const m of muts) m.addedNodes.forEach(walk);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  if (hasText()) walk(document.body);
}

function editorBox(title, fields, yes = "Save wording") {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "overlay words-editor";
    ov.innerHTML = `<div class="card modal"><h2 style="margin-top:0">${escape(title)}</h2>
      ${fields.map((f, i) => `<label class="field" style="margin-bottom:12px"><span>${escape(f.label)}</span>${f.long ? `<textarea data-i="${i}" rows="3">${escape(f.value)}</textarea>` : `<input data-i="${i}" value="${escape(f.value)}">`}
        <small class="faint">Original: ${escape(f.def)}</small></label>`).join("")}
      ${fields.length ? "" : "<p>Every renamed word and help box goes back to how Home Bank came.</p>"}
      <div class="modal-foot">${fields.length ? `<button class="btn" data-reset>Put back original</button>` : ""}<span class="spacer"></span><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>${escape(yes)}</button></div></div>`;
    document.body.append(ov);
    const done = (v) => { ov.remove(); resolve(v); };
    ov.querySelector("[data-cancel]").onclick = () => done(null);
    ov.querySelector("[data-reset]")?.addEventListener("click", () => done(fields.map(() => "")));
    ov.querySelector("[data-save]").onclick = () => done(fields.map((_, i) => ov.querySelector(`[data-i="${i}"]`).value.trim()));
    ov.addEventListener("keydown", (e) => { if (e.key === "Escape") done(null); if (e.key === "Enter" && e.target.tagName === "INPUT") ov.querySelector("[data-save]").click(); });
    setTimeout(() => ov.querySelector("[data-i]")?.select(), 30);
  });
}

function textNodeAt(el, x, y) {
  // the text node under the pointer, or the element's only text node
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p?.offsetNode?.nodeType === 3 && p.offsetNode.nodeValue.trim()) return p.offsetNode;
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r?.startContainer?.nodeType === 3 && r.startContainer.nodeValue.trim()) return r.startContainer;
  }
  const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim());
  return texts.length ? texts[0] : null;
}

export function startEditWords({ save, reset }) {
  const root = document.documentElement;
  if (root.classList.contains("edit-words")) return;
  root.classList.add("edit-words");
  walk(document.body); // remember the original wording of everything on screen
  const bar = document.createElement("div");
  bar.className = "card edit-words-bar";
  bar.innerHTML = `<span>Edit words: tap any text to rename it or change its help box.</span><button class="btn sm" data-reset>Put all words back</button><button class="btn sm primary" data-done>Done</button>`;
  document.body.append(bar);
  const style = document.createElement("style");
  style.textContent = `html.edit-words .content *:hover, html.edit-words .sidebar *:hover, html.edit-words .topbar *:hover { outline: 1px dashed var(--warn); outline-offset: 2px; cursor: text; }`;
  document.head.append(style);

  const onClick = async (e) => {
    if (bar.contains(e.target) || e.target.closest(".words-editor")) return;
    e.preventDefault(); e.stopPropagation();
    let el = e.target.closest("[data-w]");
    let node = null;
    if (!el) {
      node = textNodeAt(e.target, e.clientX, e.clientY);
      if (node) el = node.parentElement?.closest("[data-w]") || null;
    }
    const helpEl = e.target.closest("[data-help]");
    const fields = [];
    let kind;
    if (el) {
      kind = { type: "key", key: el.dataset.w, def: el.dataset.wdef };
      fields.push({ label: "Text", value: wt(el.dataset.w, el.dataset.wdef), def: el.dataset.wdef });
    } else {
      if (node) {
        const orig = original.get(node) || node.nodeValue.trim();
        kind = { type: "text", key: "t:" + orig, def: orig };
        fields.push({ label: "Text", value: overrides["t:" + orig] ?? orig, def: orig });
      } else if (e.target.placeholder) {
        const orig = e.target.getAttribute("data-ph-orig") || e.target.placeholder;
        kind = { type: "text", key: "t:" + orig, def: orig };
        fields.push({ label: "Example text in the box", value: overrides["t:" + orig] ?? orig, def: orig });
      }
    }
    let helpKey = null;
    if (helpEl) {
      const orig = helpEl.getAttribute("data-help-orig") || helpEl.dataset.help;
      helpKey = "h:" + orig;
      fields.push({ label: "Help (shows in help mode when you tap this)", value: overrides[helpKey] ?? orig, def: orig, long: true });
    }
    if (!fields.length) return;
    const vals = await editorBox("Change wording", fields);
    if (!vals) return;
    let i = 0;
    if (kind) {
      const v = vals[i++];
      const keep = v && v !== kind.def ? v : "";
      await save(kind.key, keep);
      if (keep) overrides[kind.key] = keep; else delete overrides[kind.key];
      if (kind.type === "text" && node) { if (!original.has(node)) original.set(node, kind.def); node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), keep || kind.def); }
      if (kind.type === "key") document.querySelectorAll(`[data-w="${CSS.escape(kind.key)}"]`).forEach((n) => (n.textContent = wt(kind.key, n.dataset.wdef)));
    }
    if (helpKey) {
      const v = vals[i];
      const orig = helpKey.slice(2);
      const keep = v && v !== orig ? v : "";
      await save(helpKey, keep);
      if (keep) overrides[helpKey] = keep; else delete overrides[helpKey];
      document.querySelectorAll("[data-help-orig]").forEach((n) => { if (n.getAttribute("data-help-orig") === orig) n.setAttribute("data-help", keep || orig); });
    }
    // re-apply plain text changes everywhere on screen
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const o = original.get(n);
      if (o && kind?.type === "text" && "t:" + o === kind.key) n.nodeValue = n.nodeValue.replace(n.nodeValue.trim(), overrides[kind.key] ?? o);
    }
  };
  document.addEventListener("click", onClick, true);
  bar.querySelector("[data-done]").onclick = () => {
    root.classList.remove("edit-words");
    document.removeEventListener("click", onClick, true);
    bar.remove(); style.remove();
  };
  bar.querySelector("[data-reset]").onclick = async () => {
    const sure = await editorBox("Put all words back?", [], "Put them all back").then((v) => v !== null);
    if (!sure) return;
    await reset();
    overrides = {};
    location.reload();
  };
}
