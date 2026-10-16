/* Persistence for Emailer Studio.
   Shared mode — the site has a data API (Netlify Function or the local server.py), so
   everyone sees the same projects. Local mode — no API (e.g. a plain static server), so
   data lives in this browser's IndexedDB. Both expose the same async interface. */
window.Store = (() => {
  "use strict";
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------- this browser only (IndexedDB) ---------- */
  const local = (() => {
    const DB = "emailer-studio", VERSION = 1;
    const STORES = ["projects", "mailers", "briefs", "reviews", "events", "files"];
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

  /* ---------- shared (data API) ---------- */
  async function call(method, path, body, headers) {
    const res = await fetch(path, { method, body, headers, cache: "no-store" });
    if (!res.ok) {
      let msg = `Shared storage error (${res.status})`;
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    return res;
  }
  const enc = encodeURIComponent;
  const shared = {
    get: (store, id, pid) => fetch(`/api/data/${store}/${enc(id)}${pid ? `?project=${enc(pid)}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)),
    all: async (store) => (await call("GET", `/api/data/${store}`)).json(),
    async where(store, key, value) {
      if (key === "projectId") return (await call("GET", `/api/data/${store}?project=${enc(value)}`)).json();
      return (await this.all(store)).filter((x) => x[key] === value);
    },
    put: async (store, obj) => {
      await call("PUT", `/api/data/${store}/${enc(obj.id)}`, JSON.stringify(obj), { "Content-Type": "application/json" });
      return obj;
    },
    del: (store, id, pid) => call("DELETE", `/api/data/${store}/${enc(id)}${pid ? `?project=${enc(pid)}` : ""}`),
    async saveFile(file, id) {
      id = id || uid();
      await call("PUT", `/api/files/${id}`, file, { "Content-Type": file.type || "application/octet-stream", "X-File-Name": enc(file.name) });
      return id;
    },
    async file(id) {
      if (!id) return null;
      const res = await fetch(`/api/files/${enc(id)}`, { cache: "force-cache" });
      if (!res.ok) return null;
      const name = decodeURIComponent(res.headers.get("X-File-Name") || id);
      return new File([await res.blob()], name, { type: res.headers.get("Content-Type") || "" });
    },
    delFile: (id) => call("DELETE", `/api/files/${enc(id)}`),
    version: async (pid) => (await (await call("GET", `/api/version${pid ? `?project=${enc(pid)}` : ""}`)).json()).v
  };

  // Shared when the data API answers with JSON; otherwise this browser only.
  const ready = fetch("/api/data/projects", { cache: "no-store" })
    .then((r) => (r.ok && /json/.test(r.headers.get("Content-Type") || "") ? "shared" : "local"))
    .catch(() => "local");

  const api = { uid, mode: "local", ready, local };
  for (const k of ["get", "all", "where", "put", "del", "saveFile", "file", "delFile", "version"])
    api[k] = async (...args) => {
      api.mode = await ready;
      const impl = api.mode === "shared" ? shared : local;
      return impl[k].apply(impl, args);
    };
  ready.then((m) => { api.mode = m; });
  return api;
})();
