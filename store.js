/* Persistence for Emailer Studio.
   Shared mode — the site has a data API (Netlify Function or the local server.py), so
   everyone sees the same projects. Local mode — no API (e.g. a plain static server), so
   data lives in this browser's IndexedDB. Both expose the same async interface. */
window.Store = (() => {
  "use strict";
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------- this browser only (IndexedDB) ---------- */
  const local = (() => {
    const DB = "emailer-studio", VERSION = 2;
    const STORES = ["projects", "mailers", "briefs", "reviews", "events", "files", "outbox"];
    let opening = null;
    const db = () => opening || (opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        for (const s of STORES)
          if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
    async function run(store, mode, fn) {
      const d = await db();
      return new Promise((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        let out;
        if (req) req.onsuccess = () => { out = req.result; };
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error("Storage transaction aborted"));
      });
    }
    return {
      get: (store, id) => run(store, "readonly", (s) => s.get(id)),
      all: (store) => run(store, "readonly", (s) => s.getAll()).then((x) => x || []),
      put: (store, obj) => run(store, "readwrite", (s) => s.put(obj)).then(() => obj),
      del: (store, id) => run(store, "readwrite", (s) => s.delete(id)),
      async where(store, key, value) { return (await this.all(store)).filter((x) => x[key] === value); },
      async saveFile(file, id) {
        const rec = { id: id || uid(), name: file.name, type: file.type || "", size: file.size, blob: file };
        await this.put("files", rec);
        return rec.id;
      },
      async file(id) {
        const rec = id && await this.get("files", id);
        return rec ? new File([rec.blob], rec.name, { type: rec.type }) : null;
      },
      delFile(id) { return this.del("files", id); },
      version: async () => null
    };
  })();

  /* ---------- shared (data API) with an offline outbox ----------
     A write that can't reach the server (network down) is kept in this browser's
     outbox and replayed, in order, once the connection is back. Reads lay the queued
     changes over what the server returned, so nothing you did disappears meanwhile. */
  class Offline extends Error {}
  async function call(method, path, body, headers) {
    let res;
    try { res = await fetch(path, { method, body, headers, cache: "no-store" }); }
    catch (_) { throw new Offline("No connection"); }
    if (!res.ok) {
      let msg = `Shared storage error (${res.status})`;
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    return res;
  }
  const enc = encodeURIComponent;
  const recPath = (store, id, pid) => `/api/data/${store}/${enc(id)}${pid ? `?project=${enc(pid)}` : ""}`;

  let seq = 0;
  const opId = () => Date.now().toString(36).padStart(10, "0") + "-" + (seq++).toString(36).padStart(4, "0");
  const outbox = {
    all: () => local.all("outbox").then((ops) => ops.sort((a, z) => (a.id < z.id ? -1 : 1))),
    add: (op) => local.put("outbox", { ...op, id: opId(), at: new Date().toISOString() }).then(() => notify()),
    drop: (id) => local.del("outbox", id)
  };

  // Last good answer per URL, so a page that loses the network can still read.
  const lastRead = new Map();
  async function readJSON(path) {
    try { const data = await (await call("GET", path)).json(); lastRead.set(path, data); return data; }
    catch (err) { if (err instanceof Offline && lastRead.has(path)) return lastRead.get(path); throw err; }
  }
  async function overlay(store, list, pid) {
    const out = new Map(list.map((x) => [x.id, x]));
    for (const op of await outbox.all()) {
      if (op.store !== store) continue;
      if (op.kind === "put" && (!pid || op.rec.projectId === pid || (store === "projects" && op.rec.id === pid))) out.set(op.rec.id, op.rec);
      if (op.kind === "del") out.delete(op.recId);
    }
    return [...out.values()];
  }

  async function send(op) {
    if (op.kind === "put") return call("PUT", recPath(op.store, op.rec.id), JSON.stringify(op.rec), { "Content-Type": "application/json" });
    if (op.kind === "del") return call("DELETE", recPath(op.store, op.recId, op.pid));
    if (op.kind === "file") return call("PUT", `/api/files/${op.fileId}`, op.blob, { "Content-Type": op.type || "application/octet-stream", "X-File-Name": enc(op.name) });
    if (op.kind === "delFile") return call("DELETE", `/api/files/${enc(op.fileId)}`);
  }
  // Writes go straight to the server, unless the network is down or older writes are
  // still queued (order matters), in which case they join the queue.
  async function write(op) {
    if (!pending && navigator.onLine !== false) {
      try { await send(op); return { queued: false }; }
      catch (err) { if (!(err instanceof Offline)) throw err; }
    }
    await outbox.add(op);
    return { queued: true };
  }

  let pending = 0, syncing = false, lastError = "";
  const listeners = new Set();
  async function notify() {
    pending = (await local.all("outbox")).length;
    for (const fn of listeners) try { fn({ pending, syncing, lastError }); } catch (_) {}
  }
  async function flush() {
    if (syncing) return;
    syncing = true;
    await notify();
    try {
      for (const op of await outbox.all()) {
        try { await send(op); }
        catch (err) {
          if (err instanceof Offline) break;
          lastError = `A change could not be saved and was dropped: ${err.message}`;   // the server refused it
        }
        await outbox.drop(op.id);
      }
    } finally { syncing = false; await notify(); }
  }

  const shared = {
    async get(store, id, pid) {
      let rec = null;
      try { rec = await readJSON(recPath(store, id, pid)); } catch (err) { if (err instanceof Offline) rec = null; else if (!/404/.test(err.message) && !/Not found/i.test(err.message)) throw err; }
      for (const op of await outbox.all()) {
        if (op.store !== store) continue;
        if (op.kind === "put" && op.rec.id === id) rec = op.rec;
        if (op.kind === "del" && op.recId === id) rec = null;
      }
      return rec;
    },
    all: async (store) => overlay(store, await readJSON(`/api/data/${store}`)),
    async where(store, key, value) {
      if (key === "projectId") return overlay(store, await readJSON(`/api/data/${store}?project=${enc(value)}`), value);
      return (await this.all(store)).filter((x) => x[key] === value);
    },
    async put(store, obj) { await write({ kind: "put", store, rec: obj }); return obj; },
    del: (store, id, pid) => write({ kind: "del", store, recId: id, pid }),
    async saveFile(file, id) {
      id = id || uid();
      await write({ kind: "file", fileId: id, blob: file, name: file.name, type: file.type || "" });
      return id;
    },
    async file(id) {
      if (!id) return null;
      const q = (await outbox.all()).reverse().find((op) => op.kind === "file" && op.fileId === id);
      if (q) return new File([q.blob], q.name, { type: q.type });
      let res;
      try { res = await fetch(`/api/files/${enc(id)}`, { cache: "force-cache" }); } catch (_) { return null; }
      if (!res.ok) return null;
      const name = decodeURIComponent(res.headers.get("X-File-Name") || id);
      return new File([await res.blob()], name, { type: res.headers.get("Content-Type") || "" });
    },
    delFile: (id) => write({ kind: "delFile", fileId: id }),
    version: async (pid) => (await (await call("GET", `/api/version${pid ? `?project=${enc(pid)}` : ""}`)).json()).v
  };

  // Shared when the data API answers with JSON; otherwise this browser only.
  const ready = fetch("/api/data/projects", { cache: "no-store" })
    .then((r) => (r.ok && /json/.test(r.headers.get("Content-Type") || "") ? "shared" : "local"))
    .catch(() => "local");

  const api = {
    uid, mode: "local", ready, local, flush,
    onSync(fn) { listeners.add(fn); notify(); },
    get sync() { return { pending, syncing, lastError }; }
  };
  for (const k of ["get", "all", "where", "put", "del", "saveFile", "file", "delFile", "version"])
    api[k] = async (...args) => {
      api.mode = await ready;
      const impl = api.mode === "shared" ? shared : local;
      return impl[k].apply(impl, args);
    };
  ready.then((m) => {
    api.mode = m;
    if (m !== "shared") return;
    window.addEventListener("online", () => flush());
    setInterval(() => { if (pending) flush(); }, 20000);
    notify().then(() => { if (pending) flush(); });   // changes left over from a previous visit
  });
  return api;
})();
