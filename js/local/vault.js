// Home Bank's private storage on the phone, encrypted.
// A random data key encrypts everything. That key is itself locked with each person's
// passcode (PBKDF2 + AES-GCM), so the data can only be opened with a passcode.
// Backup and share files use the same locks, so they open with the same passcodes.

const DB_NAME = "homebank";
const STORE = "kv";
const ITER = 210000;

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
let dbp = null;
const db = () => (dbp ||= open());

export async function get(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(STORE, "readonly").objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function put(key, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export async function del(key) {
  const d = await db();
  return new Promise((resolve) => { const tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(key); tx.oncomplete = () => resolve(); });
}

const enc = new TextEncoder(), dec = new TextDecoder();
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

async function passKey(passcode, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passcode), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const importData = (raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

// Lock the data key with a person's passcode
export async function wrapFor(rawKey, passcode) {
  const salt = rand(16), iv = rand(12);
  const k = await passKey(passcode, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, rawKey);
  return { salt, iv, ct };
}
// Returns {raw, key} if the passcode is right, or null
export async function unwrap(entry, passcode) {
  try {
    const k = await passKey(passcode, entry.salt);
    const raw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: entry.iv }, k, entry.ct));
    return { raw, key: await importData(raw) };
  } catch {
    return null;
  }
}
export async function newDataKey() {
  const raw = rand(32);
  return { raw, key: await importData(raw) };
}

export async function seal(key, obj) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv, ct };
}
export async function unseal(key, box) {
  if (!box) return null;
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: box.iv }, key, box.ct);
  return JSON.parse(dec.decode(pt));
}

// ---- for files and for keeping locks inside the data
export const b64 = (u8) => { let s = ""; const a = new Uint8Array(u8); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const slotToJson = (w) => ({ salt: b64(w.salt), iv: b64(w.iv), ct: b64(w.ct) });
export const slotFromJson = (j) => ({ salt: unb64(j.salt), iv: unb64(j.iv), ct: unb64(j.ct) });

async function squeeze(bytes, how) {
  if (typeof CompressionStream === "undefined") return null;
  const s = new Blob([bytes]).stream().pipeThrough(how === "in" ? new CompressionStream("gzip") : new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
// Encrypt an object for a file: returns {iv, gz, data} as text-safe base64
export async function sealText(key, obj) {
  let bytes = enc.encode(JSON.stringify(obj)), gz = false;
  const z = await squeeze(bytes, "in");
  if (z) { bytes = z; gz = true; }
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  return { iv: b64(iv), gz, data: b64(ct) };
}
export async function unsealText(key, box) {
  let bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.data)));
  if (box.gz) {
    const z = await squeeze(bytes, "out");
    if (!z) throw new Error("This phone can't open compressed files. Update iOS and try again.");
    bytes = z;
  }
  return JSON.parse(dec.decode(bytes));
}
export async function sha(text) {
  return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)))).slice(0, 16);
}
