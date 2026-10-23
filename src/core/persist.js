// 本地存档：IndexedDB（失败时退回 localStorage）
const DB_NAME = 'tw-politics-sandbox';
const DB_VER = 1;
let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ['kv', 'versions', 'assets']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}
const LS = 'tw-sandbox:';
export async function kvGet(key) {
  try { return await tx('kv', 'readonly', s => s.get(key)); }
  catch { try { return JSON.parse(localStorage.getItem(LS + key)); } catch { return null; } }
}
export async function kvSet(key, val) {
  try { await tx('kv', 'readwrite', s => s.put(val, key)); }
  catch { try { localStorage.setItem(LS + key, JSON.stringify(val)); } catch { } }
}
export async function versionPut(v) { try { await tx('versions', 'readwrite', s => s.put(v, v.id)); } catch { } }
export async function versionDel(id) { try { await tx('versions', 'readwrite', s => s.delete(id)); } catch { } }
export async function versionGet(id) { try { return await tx('versions', 'readonly', s => s.get(id)); } catch { return null; } }
export async function versionList() {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const out = [];
      const t = db.transaction('versions', 'readonly');
      const req = t.objectStore('versions').openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { const { state, ...meta } = c.value; out.push(meta); c.continue(); } else resolve(out); };
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
}
export async function assetPut(id, dataUrl) { try { await tx('assets', 'readwrite', s => s.put(dataUrl, id)); } catch { } }
export async function assetGet(id) { try { return await tx('assets', 'readonly', s => s.get(id)); } catch { return null; } }
export async function assetAll() {
  try {
    const db = await open();
    return await new Promise(resolve => {
      const out = {};
      const req = db.transaction('assets', 'readonly').objectStore('assets').openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { out[c.key] = c.value; c.continue(); } else resolve(out); };
      req.onerror = () => resolve(out);
    });
  } catch { return {}; }
}
export async function requestPersistent() { try { await navigator.storage?.persist?.(); } catch { } }
