/* IndexedDB persistence for Emailer Studio. localStorage caps out around 5 MB, which
   one mailer PDF can exceed — and the final approved PDF has to be downloadable later. */
window.Store = (() => {
  "use strict";
  const DB = "emailer-studio", VERSION = 1;
  const STORES = ["projects", "mailers", "briefs", "reviews", "events", "files"];
  let opening = null;

  function db() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        for (const s of STORES)
          if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return opening;
  }

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

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  return {
    uid,
    get: (store, id) => run(store, "readonly", (s) => s.get(id)),
    all: (store) => run(store, "readonly", (s) => s.getAll()).then((x) => x || []),
    put: (store, obj) => run(store, "readwrite", (s) => s.put(obj)).then(() => obj),
    del: (store, id) => run(store, "readwrite", (s) => s.delete(id)),
    async where(store, key, value) {
      return (await this.all(store)).filter((x) => x[key] === value);
    },
    async saveFile(file) {
      const rec = { id: uid(), name: file.name, type: file.type || "", size: file.size, blob: file };
      await this.put("files", rec);
      return rec.id;
    },
    async file(id) {
      const rec = id && await this.get("files", id);
      return rec ? new File([rec.blob], rec.name, { type: rec.type }) : null;
    }
  };
})();
