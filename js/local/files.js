// Getting files in and out of Home Bank on a phone: the share sheet (AirDrop, Save to Files)
// to send, and the Files picker to open. No network is involved.

// Hand a file to the phone's share sheet. Falls back to a download where sharing isn't offered.
export async function saveFile(filename, text, mime = "application/octet-stream") {
  const file = new File([text], filename, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return "shared"; }
    catch (e) { if (e.name === "AbortError") return "cancelled"; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "downloaded";
}

// Ask for a file from the Files app (or iCloud Drive, a thumb drive, etc.)
export function pickFile(accept = "") {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    if (accept) inp.accept = accept;
    inp.style.display = "none";
    inp.onchange = () => { resolve(inp.files?.[0] || null); inp.remove(); };
    document.body.append(inp);
    inp.click();
  });
}
export const readText = (file) => file.text();

// The offline keeper (sw.js) reads this flag. When it's on, nothing is ever fetched from the network.
export async function setOfflineLockFlag(on) {
  if (!("caches" in window)) return;
  const c = await caches.open("homebank-flags");
  await c.put("offline-lock", new Response(on ? "on" : "off"));
}

// Shrink a photo before keeping it (a phone photo can be 5 MB; a receipt reads fine at ~1600px)
export async function shrinkPhoto(file, max = 1600, quality = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality).split(",")[1];
  } finally { URL.revokeObjectURL(url); }
}
