// Shared storage for Emailer Studio on Netlify — every visitor reads and writes the
// same projects, mailers, briefs, checks, history and files (Netlify Blobs).
//
// Keys:  rec/projects/<id>            rec/<store>/<projectId>/<id>
//        file/<id>                    ver/<projectId>, ver/_all  (change counters for polling)
import { getStore } from "@netlify/blobs";

const STORES = new Set(["projects", "mailers", "briefs", "reviews", "events"]);
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_FILE = 5.5 * 1024 * 1024;   // Netlify Functions cap request bodies at 6 MB

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});
const fail = (status, error) => json({ error }, status);

const recKey = (store, id, pid) => store === "projects" ? `rec/projects/${id}` : `rec/${store}/${pid}/${id}`;

async function bump(db, pid) {
  const v = new Date().toISOString() + Math.random().toString(36).slice(2, 6);
  await Promise.all([db.set(`ver/${pid || "_none"}`, v), db.set("ver/_all", v)]);
}

async function listJSON(db, prefix) {
  const { blobs } = await db.list({ prefix });
  return (await Promise.all(blobs.map((b) => db.get(b.key, { type: "json" })))).filter(Boolean);
}

export default async (req) => {
  const db = getStore({ name: "emailer-studio", consistency: "strong" });
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);   // ["api", kind, ...]
  const kind = parts[1];
  const project = url.searchParams.get("project");
  if (project && !ID.test(project)) return fail(400, "Bad project id");

  try {
    if (kind === "status") {
      return json({ available: false, shared: true, model: null,
        reason: "AI runs only in the local app (./start.sh) — Netlify can't host the AI server." });
    }

    if (kind === "version") {
      return json({ v: (await db.get(`ver/${project || "_all"}`)) || "0" });
    }

    if (kind === "data") {
      const [store, id] = [parts[2], parts[3]];
      if (!STORES.has(store)) return fail(404, "Unknown store");
      if (id && !ID.test(id)) return fail(400, "Bad id");

      if (req.method === "GET" && !id) {
        const prefix = store === "projects" ? "rec/projects/" : `rec/${store}/${project ? project + "/" : ""}`;
        return json(await listJSON(db, prefix));
      }
      if (req.method === "GET") {
        if (store !== "projects" && !project) return fail(400, "project is required");
        const rec = await db.get(recKey(store, id, project), { type: "json" });
        return rec ? json(rec) : fail(404, "Not found");
      }
      if (req.method === "PUT") {
        const rec = await req.json();
        if (!rec || rec.id !== id) return fail(400, "Record id must match the URL");
        const pid = store === "projects" ? id : rec.projectId;
        if (!pid || !ID.test(pid)) return fail(400, "projectId is required");
        await db.setJSON(recKey(store, id, pid), rec);
        await bump(db, pid);
        return json({ ok: true });
      }
      if (req.method === "DELETE") {
        const pid = store === "projects" ? id : project;
        if (!pid) return fail(400, "project is required");
        await db.delete(recKey(store, id, pid));
        await bump(db, pid);
        return json({ ok: true });
      }
      return fail(405, "Method not allowed");
    }

    if (kind === "files") {
      const id = parts[2];
      if (!id || !ID.test(id)) return fail(400, "Bad file id");
      if (req.method === "GET") {
        const got = await db.getWithMetadata(`file/${id}`, { type: "arrayBuffer" });
        if (!got) return fail(404, "File not found");
        return new Response(got.data, { headers: {
          "Content-Type": got.metadata.type || "application/octet-stream",
          "X-File-Name": encodeURIComponent(got.metadata.name || id), "Cache-Control": "private, max-age=31536000, immutable" } });
      }
      if (req.method === "PUT") {
        const body = await req.arrayBuffer();
        if (body.byteLength > MAX_FILE) return fail(413, "Files over 5.5 MB can't be stored on the shared site.");
        await db.set(`file/${id}`, body, { metadata: {
          name: decodeURIComponent(req.headers.get("X-File-Name") || id),
          type: req.headers.get("Content-Type") || "", size: body.byteLength } });
        return json({ ok: true });
      }
      if (req.method === "DELETE") { await db.delete(`file/${id}`); return json({ ok: true }); }
      return fail(405, "Method not allowed");
    }
    return fail(404, "Not found");
  } catch (err) {
    console.error(err);
    return fail(500, `${err.name}: ${err.message}`);
  }
};

export const config = { path: ["/api/data/*", "/api/files/*", "/api/version", "/api/status"] };
