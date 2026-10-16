/* Emailer Studio — projects, mailers, briefs, reviews and history on top of the
   Emailer engine (app.js), the brand checklist and the brief reader. */
(() => {
  "use strict";
  const E = window.EmailerEngine, B = window.BriefReader, C = window.BrandChecks, DB = window.Store;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => E.escapeHtml(s == null ? "" : s);
  const app = $("#app");

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

  const S = {
    user: lsGet("studio-user") || "", projects: [], all: null, project: null, loadedPid: null,
    mailers: [], briefs: [], reviews: [], events: [], ai: { available: false, reason: "Checking AI…" },
    draft: null, current: null, histFilter: "all"
  };
  const cache = new Map();      // "mailerId:v" → { r, file, brand: { [type]: result } }

  const now = () => new Date().toISOString();
  const fmtDate = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  const latest = (m) => m.versions[m.versions.length - 1];
  const P = () => `#/p/${encodeURIComponent(S.project.id)}`;
  const DECIDED = ["pass", "fail", "na"];
  const spinner = '<span class="spinner"></span>';

  /* ---------- small UI kit ---------- */
  function toast(msg, kind) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast " + (kind || "");
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, kind === "err" ? 6000 : 3000);
  }

  function modal({ title, body, actions, wide }) {
    actions = actions || [{ label: "Close", primary: true, value: true }];
    return new Promise((resolve) => {
      const m = $("#modal");
      m.innerHTML = `<div class="modal-box ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-x" data-mclose aria-label="Close">×</button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.primary ? "" : "ghost"} ${a.danger ? "danger" : ""}" data-mval="${i}">${esc(a.label)}</button>`).join("")}</div>
      </div>`;
      m.hidden = false;
      const done = (v) => { m.hidden = true; m.innerHTML = ""; m.onclick = null; document.removeEventListener("keydown", onKey); resolve(v); };
      const pick = (a) => done(a.collect ? a.collect(m) : a.value !== undefined ? a.value : true);
      const onKey = (e) => {
        if (e.key === "Escape") done(null);
        if (e.key === "Enter" && e.target.matches("input.inp")) { e.preventDefault(); const a = actions.find((x) => x.primary); if (a) pick(a); }
      };
      document.addEventListener("keydown", onKey);
      m.onclick = (e) => {
        if (e.target === m || e.target.closest("[data-mclose]") || e.target.closest("[data-href]")) return done(null);
        const b = e.target.closest("[data-mval]");
        if (b) pick(actions[+b.dataset.mval]);
      };
      const f = $("input.inp, textarea", m);
      if (f) f.focus();
    });
  }
  const confirmModal = (text, ok, danger) => modal({
    title: "Please confirm", body: `<p>${esc(text)}</p>`,
    actions: [{ label: "Cancel", value: null }, { label: ok, primary: true, danger, value: true }]
  });

  async function ensureUser(force) {
    if (S.user && !force) return S.user;
    const name = await modal({
      title: force ? "Change your name" : "Who is working?",
      body: `<p class="muted">Your name is recorded on every upload, brief and check you make.</p>
        <input class="inp" placeholder="Your full name" value="${esc(S.user)}" maxlength="60">`,
      actions: [{ label: "Cancel", value: null }, { label: "Save", primary: true, collect: (m) => $("input", m).value.trim() }]
    });
    if (!name) { if (!S.user) throw new Error("A name is needed to continue."); return S.user; }
    S.user = name;
    lsSet("studio-user", name);
    renderUserChip();
    return name;
  }

  async function api(path, body) {
    let res, json;
    try {
      res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      json = await res.json();
    } catch (_) { throw new Error("The AI server isn't reachable — start the app with ./start.sh"); }
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }
  const aiAttr = () => S.ai.available ? "" : `disabled title="${esc(S.ai.reason)}"`;
  const aiNote = () => S.ai.available ? "" : `<span class="ai-off-note">AI is off — ${esc(S.ai.reason)}</span>`;

  async function downloadFile(fileId, name) {
    const f = await DB.file(fileId);
    if (!f) return toast("That file is no longer stored.", "err");
    saveBlob(f, name || f.name);
  }
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function logEvent(ev) {
    await DB.put("events", { id: DB.uid(), projectId: S.project.id, at: now(), by: S.user, ...ev });
  }

  /* ---------- data ---------- */
  // The shared-store version each view was loaded at; polling compares against it.
  let seen = { key: null, v: null };
  const markSeen = async (pid) => { if (DB.mode === "shared") seen = { key: pid || "_all", v: await DB.version(pid).catch(() => null) }; };

  async function loadAll() {
    await markSeen(null);
    S.projects = (await DB.all("projects")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    // Every project's history would be a lot to fetch for a dashboard; counts are enough.
    const [mailers, briefs, reviews] = await Promise.all(["mailers", "briefs", "reviews"].map((s) => DB.all(s)));
    S.all = { mailers, briefs, reviews };
  }
  async function reloadProject(pid) {
    await markSeen(pid);
    S.project = await DB.get("projects", pid);
    const [m, b, r, e] = await Promise.all(["mailers", "briefs", "reviews", "events"].map((s) => DB.where(s, "projectId", pid)));
    S.mailers = m.sort((a, z) => z.createdAt.localeCompare(a.createdAt));
    S.briefs = b.sort((a, z) => z.uploadedAt.localeCompare(a.uploadedAt));
    S.reviews = r.sort((a, z) => z.at.localeCompare(a.at));
    S.events = e.sort((a, z) => z.at.localeCompare(a.at));
    S.loadedPid = pid;
  }

  function mailerStatus(m, ver) {
    ver = ver || latest(m);
    const revs = S.reviews.filter((r) => r.mailerId === m.id && r.v === ver.v);
    const manual = revs.filter((r) => r.stage === "manual");
    const fin = revs.find((r) => r.stage === "final") || null;
    return { ver, revs, manual, manualNames: uniq(manual.flatMap((r) => r.reviewers)), final: fin, approved: !!(fin && fin.verdict === "approved") };
  }
  const briefsFor = (m) => S.briefs.filter((b) => !b.mailerId || b.mailerId === m.id);
  const priorityOf = (b) => S.briefs.indexOf(b) + 1;

  async function analysisFor(m, ver) {
    const key = `${m.id}:${ver.v}`;
    let entry = cache.get(key);
    if (!entry) {
      const file = await DB.file(ver.fileId);
      if (!file) throw new Error("The PDF for this version is missing from storage.");
      entry = { r: await E.analyseFile(file), file, brand: {} };
      cache.set(key, entry);
      if (cache.size > 6) {
        const [oldKey, old] = cache.entries().next().value;
        cache.delete(oldKey);
        try { old.r.pdf.destroy(); } catch (_) {}
      }
    }
    if (!entry.brand[m.type]) entry.brand[m.type] = await C.run(entry.r, { mailerType: m.type });
    return { r: entry.r, file: entry.file, brand: entry.brand[m.type] };
  }
  const itemsFor = (ver, brand) => C.mergeAI(brand.items, ver.aiBrand && ver.aiBrand.results);

  /* ---------- routing ---------- */
  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== "p" || !parts[1]) return { view: "dash" };
    return { view: "project", pid: parts[1], tab: parts[2] || "upload", id: parts[3] || null,
             v: parts[4] ? +parts[4].replace(/^v/, "") : null };
  }
  const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    const rt = parseRoute();
    try {
      if (rt.view === "dash") {
        await loadAll();
        if (seq === renderSeq) renderDash();
        return;
      }
      if (S.loadedPid !== rt.pid) await reloadProject(rt.pid);
      if (seq !== renderSeq) return;
      if (!S.project) { toast("That project no longer exists.", "err"); return go("#/"); }
      renderShell(rt);
      const view = $("#view");
      if (rt.tab !== "upload" || !rt.id) delete view.dataset.mounted;
      if (rt.tab === "upload") rt.id ? await renderMailer(view, rt, seq) : renderUpload(view);
      else if (rt.tab === "briefs") renderBriefs(view, rt);
      else if (rt.tab === "history") renderHistory(view);
      else if (rt.tab === "rulebook") renderRulebook(view);
      else go(P() + "/upload");
    } catch (err) {
      console.error(err);
      toast("Something went wrong: " + err.message, "err");
    }
  }

  /* ---------- top bar ---------- */
  function renderUserChip() {
    $("#userBtn").innerHTML = S.user ? `👤 ${esc(S.user)}` : "👤 Set your name";
  }
  function renderAIBadge() {
    const b = $("#aiBadge");
    b.className = "ai-badge " + (S.ai.available ? "on" : "off");
    b.textContent = S.ai.available ? `✦ AI on` : "✦ AI off";
    b.title = S.ai.available ? `AI features use ${S.ai.model}` : S.ai.reason;
  }
  function crumbs(parts) {
    $("#crumbs").innerHTML = parts.map((p, i) => i < parts.length - 1 && p.href
      ? `<a href="${p.href}">${esc(p.label)}</a>` : `<span>${esc(p.label)}</span>`).join('<span class="sep">›</span>');
  }

  /* ---------- dashboard ---------- */
  function renderDash() {
    S.loadedPid = null;
    crumbs([{ label: "Projects" }]);
    const count = (store, pid, fn) => S.all[store].filter((x) => x.projectId === pid && (!fn || fn(x))).length;
    const cards = S.projects.map((p) => {
      return `<article class="proj-card" data-href="#/p/${encodeURIComponent(p.id)}/upload" tabindex="0">
        <div class="pc-top"><h3>${esc(p.name)}</h3>
          <button class="icon-btn" data-act="delete-project" data-id="${esc(p.id)}" title="Delete project" aria-label="Delete project">🗑</button></div>
        <div class="pc-stats">
          <div><b>${count("mailers", p.id)}</b><span>Mailers</span></div>
          <div><b>${count("briefs", p.id)}</b><span>Briefs</span></div>
          <div><b>${count("reviews", p.id, (r) => r.stage === "manual")}</b><span>Manual checks</span></div>
          <div><b>${count("mailers", p.id, (m) => m.final)}</b><span>Final approved</span></div>
        </div>
        <div class="pc-foot">Created ${fmtDay(p.createdAt)} by ${esc(p.createdBy || "—")}</div>
      </article>`;
    }).join("");
    app.innerHTML = `<div class="dash">
      <div class="dash-head">
        <div><h1>Projects</h1><p class="muted">One project per client or campaign. Each holds its mailers, briefs and every check made on them.</p></div>
        <form class="inline-form" data-form="new-project">
          <input class="inp" name="name" placeholder="New project name, e.g. Plat Reserve Upgrade Sep '26" required maxlength="80">
          <button class="btn">+ Create project</button>
        </form>
      </div>
      ${S.projects.length ? `<div class="proj-grid">${cards}</div>` :
        `<div class="empty-card"><h3>No projects yet</h3><p>Create one above, then upload a mailer PDF and its brief.</p></div>`}
    </div>`;
  }

  /* ---------- project shell: sidebar + tabs ---------- */
  function renderShell(rt) {
    if (!$("#ws") || $("#ws").dataset.pid !== rt.pid) {
      app.innerHTML = `<div class="ws" id="ws" data-pid="${esc(rt.pid)}">
        <aside class="ws-side" id="side"></aside>
        <section class="ws-main"><nav class="ws-tabs" id="tabs" aria-label="Project sections"></nav><div id="view"></div></section>
      </div>`;
    }
    renderSide(rt);
    const tabs = [["upload", "📤 Upload & Analyse"], ["briefs", `📋 Briefs (${S.briefs.length})`], ["history", "📊 History"], ["rulebook", "📘 Rulebook"]];
    $("#tabs").innerHTML = tabs.map(([k, l]) => `<a href="${P()}/${k}" class="${rt.tab === k ? "on" : ""}">${l}</a>`).join("");
    const parts = [{ label: "Projects", href: "#/" }, { label: S.project.name, href: P() + "/upload" }];
    const tabName = { upload: "Upload & Analyse", briefs: "Briefs", history: "History", rulebook: "Rulebook" }[rt.tab];
    parts.push({ label: tabName, href: `${P()}/${rt.tab}` });
    const m = rt.tab === "upload" && rt.id && S.mailers.find((x) => x.id === rt.id);
    if (m) parts.push({ label: m.name });
    crumbs(parts);
  }

  function renderSide(rt) {
    rt = rt || parseRoute();
    const mailers = S.mailers.map((m) => {
      const st = mailerStatus(m);
      const active = rt.tab === "upload" && rt.id === m.id;
      return `<li class="side-item ${active ? "on" : ""}" data-href="${P()}/upload/${encodeURIComponent(m.id)}" tabindex="0">
        <div class="si-name"><span>${esc(m.name)}</span><span class="si-v">v${st.ver.v}</span></div>
        <div class="si-meta">
          <span class="chip ${st.ver.engine.score >= 85 ? "good" : st.ver.engine.score >= 65 ? "ok" : "bad"}">${st.ver.engine.score}%</span>
          <span class="stage done" title="Automated checks ran on upload">✓ Auto</span>
          ${st.ver.aiBrand ? '<span class="stage done ai" title="AI checked the remaining items">✦ AI</span>' : ""}
        </div>
        <div class="si-people">${st.manualNames.length ? `👤 Manual: ${esc(st.manualNames.join(", "))}` : '<span class="pending">👤 Manual check pending</span>'}</div>
        <div class="si-people">${st.final ? (st.approved ? `🏁 Final ✓ ${esc(st.final.reviewers.join(", "))}` : `<span class="bad-t">🏁 Changes asked by ${esc(st.final.reviewers.join(", "))}</span>`) : '<span class="pending">🏁 Final check pending</span>'}</div>
      </li>`;
    }).join("");
    const briefs = S.briefs.map((b) => {
      const scope = b.mailerId ? (S.mailers.find((m) => m.id === b.mailerId) || {}).name || "a deleted mailer" : "All mailers";
      return `<li class="side-item small ${rt.tab === "briefs" && rt.id === b.id ? "on" : ""}" data-href="${P()}/briefs/${encodeURIComponent(b.id)}" tabindex="0">
        <div class="si-name"><span><span class="prio ${priorityOf(b) === 1 ? "top" : ""}">P${priorityOf(b)}</span> ${esc(b.title)}</span></div>
        <div class="si-people">${b.kind === "change" ? "Change brief" : "Original"} · ${esc(scope)} · ${fmtDay(b.uploadedAt)}</div>
      </li>`;
    }).join("");
    const acts = S.events.slice(0, 6).map((e) => `<li class="act" data-act="event-detail" data-id="${esc(e.id)}" tabindex="0"><span>${esc(e.text)}</span><small>${esc(e.by || "")} · ${fmtDate(e.at)}</small></li>`).join("");
    $("#side").innerHTML = `
      <div class="side-proj"><a href="#/" class="back">← All projects</a><h2>${esc(S.project.name)}</h2></div>
      <a class="btn side-cta" href="${P()}/upload">+ Upload mailer</a>
      <h3 class="side-h">Mailers <span>${S.mailers.length}</span></h3>
      <ul class="side-list">${mailers || '<li class="side-empty">No mailers yet</li>'}</ul>
      <h3 class="side-h">Briefs <span title="P1 is the newest brief and overrides older ones">priority ↓</span></h3>
      <ul class="side-list">${briefs || `<li class="side-empty">No briefs yet · <a href="${P()}/briefs">add one</a></li>`}</ul>
      <h3 class="side-h">Recent activity</h3>
      <ul class="side-acts">${acts || '<li class="side-empty">Nothing yet</li>'}</ul>`;
  }

  /* ---------- upload tab ---------- */
  function renderUpload(view) {
    const opts = S.mailers.map((m) => `<option value="${esc(m.id)}">New version of “${esc(m.name)}”</option>`).join("");
    const cards = S.mailers.map((m) => {
      const st = mailerStatus(m);
      return `<article class="mailer-card" data-href="${P()}/upload/${encodeURIComponent(m.id)}" tabindex="0">
        <h4>${esc(m.name)} <span class="si-v">v${st.ver.v}</span></h4>
        <div class="mc-score">${st.ver.engine.score}% <small>handbook</small></div>
        <div class="muted small">${st.ver.engine.counts.fail} errors · ${st.ver.engine.counts.warn} to fix · uploaded by ${esc(st.ver.uploadedBy)} · ${fmtDay(st.ver.uploadedAt)}</div>
        <div class="muted small">${st.manualNames.length ? "Manual: " + esc(st.manualNames.join(", ")) : "Manual check pending"} · ${st.approved ? "Final ✓" : "Final pending"}</div>
      </article>`;
    }).join("");
    view.innerHTML = `
      <div class="card upload-card">
        <div class="uc-head"><h2>Upload a mailer PDF</h2><a href="${P()}/rulebook" class="link">View rulebook →</a></div>
        <label class="ws-drop" data-drop="mailer">
          <input type="file" accept="application/pdf,.pdf" class="vh">
          <span class="drop-icon">⬆</span>
          <span class="drop-title">Drop the mailer PDF here or <u>browse</u></span>
          <span class="drop-hint">The full handbook engine, the Amex brand & copy checklist and the brief checks run in your browser the moment it lands.</span>
        </label>
        <div class="upload-opts">
          <label>Mailer type
            <select id="upType"><option value="marketing">Marketing (needs Unsubscribe)</option><option value="servicing">Servicing (no Unsubscribe)</option></select></label>
          <label>Upload as
            <select id="upAs"><option value="">A new mailer</option>${opts}</select></label>
        </div>
        <div id="upStatus"></div>
      </div>
      ${S.mailers.length ? `<h3 class="section-h">Mailers in this project</h3><div class="mailer-grid">${cards}</div>` : ""}`;
  }

  async function uploadMailer(file, asVersionOf, type) {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return toast("Please upload a PDF of the mailer.", "err");
    await ensureUser();
    const status = $("#upStatus") || $("#mhStatus");
    if (status) status.innerHTML = `<div class="status">${spinner}Analysing <b>${esc(file.name)}</b>…</div>`;
    try {
      const r = await E.analyseFile(file);
      const fileId = await DB.saveFile(file);
      let m = asVersionOf && S.mailers.find((x) => x.id === asVersionOf);
      if (!m) m = { id: DB.uid(), projectId: S.project.id, name: file.name.replace(/\.pdf$/i, ""), type: type || "marketing", createdAt: now(), createdBy: S.user, versions: [], final: null };
      const v = m.versions.length + 1;
      const brand = await C.run(r, { mailerType: m.type });
      const ver = {
        v, fileId, fileName: file.name, size: file.size, uploadedAt: now(), uploadedBy: S.user,
        engine: { score: r.score, counts: r.counts, scoredCount: r.scored.length, pages: r.stats.pages },
        brand: { items: brand.items }, aiBrand: null, vision: null, briefAI: null
      };
      m.versions.push(ver);
      await DB.put("mailers", m);
      cache.set(`${m.id}:${v}`, { r, file, brand: { [m.type]: brand } });
      const auto = brand.items.filter((i) => i.method === "auto" && DECIDED.includes(i.status)).length;
      await logEvent({ type: "upload", mailerId: m.id, v, text: `Uploaded “${m.name}” v${v} — handbook ${r.score}%, ${auto}/${brand.items.length} checklist items decided automatically` });
      await reloadProject(S.project.id);
      go(`${P()}/upload/${encodeURIComponent(m.id)}/v${v}`);
      toast(`Analysed ${file.name}`);
    } catch (err) {
      console.error(err);
      if (status) status.innerHTML = `<div class="status err">Could not read this PDF: ${esc(err.message)}</div>`;
    }
  }

  /* ---------- mailer view ---------- */
  function newDraft(key, items) {
    const decisions = {};
    for (const i of items) if (DECIDED.includes(i.status)) decisions[i.id] = i.status;
    const keep = S.draft && S.draft.key && S.draft.key.split(":")[0] === key.split(":")[0] ? S.draft : null;
    return { key, decisions, touched: {}, reviewers: keep ? keep.reviewers : uniq([S.user]), stage: keep ? keep.stage : "manual", notes: "", verdict: "approved" };
  }

  async function renderMailer(view, rt, seq) {
    const m = S.mailers.find((x) => x.id === rt.id);
    if (!m) { view.innerHTML = `<div class="empty-card"><h3>This mailer was deleted.</h3><a href="${P()}/upload">Back to uploads</a></div>`; return; }
    const ver = (rt.v && m.versions.find((x) => x.v === rt.v)) || latest(m);
    const key = `${m.id}:${ver.v}:${m.type}`;
    if (view.dataset.mounted === key && S.current && S.current.key === key) {
      S.current.m = m; S.current.ver = ver;
      return refreshMailer();
    }
    view.dataset.mounted = key;
    view.innerHTML = `<div id="mhead"></div><div id="pipe"></div>
      <div class="mailer-body">
        <div class="mailer-main"><div class="status" id="mStatus">${spinner}Analysing ${esc(ver.fileName)}…</div><div id="report" class="report" hidden></div></div>
        <aside class="mailer-notes" id="notes"></aside>
      </div>`;
    S.current = { m, ver, key, a: null };
    $("#mhead").innerHTML = mailerHeadHTML(m, ver);
    $("#pipe").innerHTML = pipelineHTML(m, ver);
    let a;
    try { a = await analysisFor(m, ver); }
    catch (err) {
      if (view.dataset.mounted === key) $("#mStatus").outerHTML = `<div class="status err">Could not analyse this PDF: ${esc(err.message)}</div>`;
      return;
    }
    if (seq !== renderSeq || view.dataset.mounted !== key) return;
    S.current.a = a;
    if (!S.draft || S.draft.key !== key) S.draft = newDraft(key, itemsFor(ver, a.brand));
    $("#mStatus").remove();
    const r = { ...a.r, marks: a.r.marks.concat(a.brand.marks) };
    E.renderReport(r, a.file, $("#report"), { slot: true, vision: ver.vision, onVision: (marks, res) => saveVision(marks, res) });
    $("#report .report-slot").innerHTML = '<div id="checklist"></div>';
    S.focusItem = null;
    refreshMailer();
  }

  function refreshMailer() {
    const { m, ver, a } = S.current;
    $("#mhead").innerHTML = mailerHeadHTML(m, ver);
    $("#pipe").innerHTML = pipelineHTML(m, ver);
    if (!a) return;
    renderChecklist();
    $("#notes").innerHTML = notesHTML(m, ver, a);
  }

  function mailerHeadHTML(m, ver) {
    const vopts = m.versions.map((x) => `<option value="${x.v}" ${x.v === ver.v ? "selected" : ""}>v${x.v} · ${fmtDay(x.uploadedAt)}${m.final && m.final.v === x.v ? " · final ✓" : ""}</option>`).join("");
    return `<div class="card mailer-head">
      <div class="mh-left">
        <h2>${esc(m.name)}</h2>
        <div class="mh-meta">${esc(ver.fileName)} · ${E.fmtBytes(ver.size)} · ${ver.engine.pages} page(s) · uploaded by <b>${esc(ver.uploadedBy)}</b> ${fmtDate(ver.uploadedAt)}</div>
      </div>
      <div class="mh-actions">
        <label class="mini">Type <select data-change="mailer-type"><option value="marketing" ${m.type === "marketing" ? "selected" : ""}>Marketing</option><option value="servicing" ${m.type === "servicing" ? "selected" : ""}>Servicing</option></select></label>
        <label class="mini">Version <select data-change="mailer-version">${vopts}</select></label>
        <label class="btn ghost sm" data-drop="version" data-mid="${esc(m.id)}">⬆ New version<input type="file" accept="application/pdf,.pdf" class="vh"></label>
        <button class="btn ghost sm" data-act="download-version" data-mid="${esc(m.id)}" data-v="${ver.v}">⬇ PDF</button>
        <a class="btn ghost sm" href="${P()}/rulebook">📘 Rulebook</a>
        <button class="icon-btn" data-act="delete-mailer" data-id="${esc(m.id)}" title="Delete mailer" aria-label="Delete mailer">🗑</button>
      </div>
      <div id="mhStatus"></div>
    </div>`;
  }

  function pipelineHTML(m, ver) {
    const st = mailerStatus(m, ver);
    const items = ver.brand.items;
    const auto = items.filter((i) => i.method === "auto" && DECIDED.includes(i.status)).length;
    const ai = items.filter((i) => i.method === "ai" && DECIDED.includes(i.status)).length;
    const step = (n, cls, title, body) => `<div class="pstep ${cls}"><span class="pnum">${n}</span><div><b>${title}</b><small>${body}</small></div></div>`;
    return `<div class="pipeline">
      ${step("1", "done", "Automated + AI check", `Handbook ${ver.engine.score}% · ${auto} auto${ai ? ` · ${ai} AI` : ""} of ${items.length} brand items`)}
      ${step("2", st.manual.length ? "done" : "todo", "Manual check", st.manual.length ? `by ${esc(st.manualNames.join(", "))}` : "pending — use the checklist below")}
      ${step("3", st.final ? (st.approved ? "done" : "bad") : "todo", "Final professional check", st.final ? `${st.approved ? "approved" : "changes requested"} by ${esc(st.final.reviewers.join(", "))}` : "pending")}
      ${step("4", st.approved ? "done" : "todo", "Final emailer", st.approved ? `<button class="link" data-act="download-version" data-mid="${esc(m.id)}" data-v="${ver.v}">⬇ Download v${ver.v}</button>` : "available after final approval")}
    </div>`;
  }

  /* ---------- checklist + review form (sits right under the preview) ---------- */
  function renderChecklist() {
    const box = $("#checklist");
    if (!box) return;
    const { m, ver, a } = S.current;
    const items = itemsFor(ver, a.brand);
    const d = S.draft;
    const auto = items.filter((i) => i.method === "auto" && DECIDED.includes(i.status)).length;
    const ai = items.filter((i) => i.method === "ai" && DECIDED.includes(i.status)).length;
    const need = items.length - auto - ai;
    const decided = items.filter((i) => d.decisions[i.id]).length;
    const badge = (s) => `<span class="badge ${s}">${{ pass: "Pass", fail: "Fail", warn: "Check", review: "Needs eyes", na: "N/A" }[s] || s}</span>`;
    const meth = (i) => i.method === "ai" ? '<span class="meth ai">✦ AI</span>' : i.method === "auto" ? '<span class="meth auto">Auto</span>' : '<span class="meth manual">Manual</span>';
    const rows = items.map((i) => {
      const dec = d.decisions[i.id];
      const suggested = DECIDED.includes(i.status) ? i.status : null;
      const seg = ["pass", "fail", "na"].map((v) => `<button type="button" class="${dec === v ? "on " + v : ""}" data-dec="${v}" aria-pressed="${dec === v}">${{ pass: "✓ Pass", fail: "✕ Fail", na: "N/A" }[v]}</button>`).join("");
      return `<tr data-item="${i.id}" class="${dec ? "" : "undecided"}${S.focusItem === i.id ? " focus" : ""}">
        <td class="cl-name" tabindex="0" title="Show on the preview"><b>${esc(C.label(i.id))}</b><small>${esc(C.ITEMS.find((x) => x.id === i.id).cat)}</small></td>
        <td>${badge(i.status)} ${meth(i)}<div class="ev">${esc(i.evidence)}</div>${i.aiNote ? `<div class="ev ai">✦ AI second opinion (${esc(i.aiStatus)}): ${esc(i.aiNote)}</div>` : ""}</td>
        <td><div class="seg">${seg}</div>${dec && suggested === dec && !d.touched[i.id] ? '<small class="pre">pre-filled</small>' : ""}</td>
      </tr>`;
    }).join("");
    const people = knownPeople().map((p) => `<option value="${esc(p)}">`).join("");
    const prior = S.reviews.filter((r) => r.mailerId === m.id && r.v === ver.v).map((r) => `
      <li data-act="review-detail" data-id="${esc(r.id)}" tabindex="0"><span class="stage-tag ${r.stage}">${r.stage === "final" ? "Final" : "Manual"}</span>
        <b>${esc(r.reviewers.join(", "))}</b> ${r.verdict ? (r.verdict === "approved" ? "· approved ✓" : "· changes requested") : ""}
        · ${r.tally.pass} pass / ${r.tally.fail} fail · ${fmtDate(r.at)}</li>`).join("");
    box.innerHTML = `<div class="card checklist">
      <div class="cl-head">
        <div><h3>Amex brand & copy checklist</h3>
          <p class="muted small">Decided automatically where the PDF allows. Click a check’s name to see it highlighted on the preview beside it.</p></div>
        <div class="cl-actions"><button class="btn ghost sm ai-btn" data-act="ai-brand" ${aiAttr()}>✦ AI-check the ${need} remaining</button>${aiNote()}</div>
      </div>
      <div class="cl-split">
        <span class="sp auto">✓ ${auto} automated</span><span class="sp ai">✦ ${ai} by AI</span><span class="sp human">👤 ${need} need a reviewer</span>
        <span class="sp prog">${decided}/${items.length} decided</span>
      </div>
      <div class="table-wrap"><table class="cl-table">
        <thead><tr><th>Check</th><th>Automated result</th><th>Reviewer decision</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="review-form">
        <div class="rf-row"><span class="rf-l">Stage</span>
          <div class="seg big"><button type="button" class="${d.stage === "manual" ? "on" : ""}" data-stage="manual">👤 Manual check</button><button type="button" class="${d.stage === "final" ? "on" : ""}" data-stage="final">🏁 Final professional check</button></div></div>
        <div class="rf-row"><span class="rf-l">Checked by <i>*</i></span>
          <div class="chips">${d.reviewers.map((n) => `<span class="pchip">${esc(n)}<button type="button" data-act="rm-reviewer" data-name="${esc(n)}" aria-label="Remove ${esc(n)}">×</button></span>`).join("")}
            <form class="chip-add" data-form="add-reviewer"><input class="inp sm" name="who" list="peopleList" placeholder="Add another checker"><button class="btn ghost sm">+ Add</button></form>
            <datalist id="peopleList">${people}</datalist></div></div>
        ${d.stage === "final" ? `<div class="rf-row"><span class="rf-l">Verdict</span>
          <div class="seg big"><button type="button" class="${d.verdict === "approved" ? "on pass" : ""}" data-verdict="approved">✓ Approve as final emailer</button><button type="button" class="${d.verdict === "changes" ? "on fail" : ""}" data-verdict="changes">↩ Send back for changes</button></div></div>` : ""}
        <div class="rf-row"><span class="rf-l">Notes</span><textarea class="inp" id="rfNotes" rows="3" placeholder="What you checked, what needs changing…">${esc(d.notes)}</textarea></div>
        <div class="rf-row"><span class="rf-l"></span><div><button class="btn" data-act="submit-review">${d.stage === "final" ? "Submit final check" : "Submit manual check"}</button> <span id="rfMsg" role="status"></span></div></div>
      </div>
      ${prior ? `<h4 class="prior-h">Checks on this version</h4><ul class="prior">${prior}</ul>` : ""}
    </div>`;
    applyFocus(false);
  }

  /* Click a checklist heading → dim the preview and light up just that check's boxes. */
  function applyFocus(scroll) {
    const pv = $("#preview"), id = S.focusItem;
    if (!pv) return;
    $$("#checklist tr.focus").forEach((tr) => tr.classList.remove("focus"));
    $$(".pv-mark.focus", pv).forEach((el) => el.classList.remove("focus"));
    const old = $("#pvFocus");
    if (old) old.remove();
    pv.classList.toggle("focusing", !!id);
    if (!id) return;
    const row = $(`#checklist tr[data-item="${id}"]`);
    if (row) row.classList.add("focus");
    const hits = $$(".pv-mark", pv).filter((el) => el.dataset.item === id);
    hits.forEach((el) => el.classList.add("focus"));
    const bar = document.createElement("div");
    bar.id = "pvFocus";
    bar.className = "pv-focus";
    bar.innerHTML = `<span><b>${esc(C.label(id))}</b> — ${hits.length ? `${hits.length} spot(s) on the preview` : "nothing to point at on the preview (it is judged from the whole mailer or from artwork) — see the result in the table"}</span><button type="button" data-act="clear-focus" aria-label="Clear highlight">× Show all</button>`;
    $(".pv-legend", pv).before(bar);
    if (scroll && hits.length) hits[0].scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function knownPeople() {
    const src = S.reviews.flatMap((r) => r.reviewers)
      .concat(S.mailers.flatMap((m) => m.versions.map((v) => v.uploadedBy)), S.briefs.map((b) => b.uploadedBy), [S.user]);
    return uniq(src).sort();
  }

  async function submitReview() {
    const { m, ver, a } = S.current;
    const d = S.draft;
    const msg = $("#rfMsg");
    const items = itemsFor(ver, a.brand);
    if (!d.reviewers.length) { msg.className = "err"; msg.textContent = "Add at least one checker's name."; return; }
    const missing = items.filter((i) => !d.decisions[i.id]);
    if (missing.length) {
      msg.className = "err";
      msg.textContent = `Decide ${missing.length} more item(s) first — highlighted in the table.`;
      $$("#checklist tr.undecided").forEach((tr) => tr.classList.add("need"));
      const first = $("#checklist tr.undecided");
      if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (d.stage === "final" && !S.reviews.some((r) => r.mailerId === m.id && r.v === ver.v && r.stage === "manual")) {
      if (!await confirmModal("No manual check is recorded on this version yet. Submit the final check anyway?", "Submit final check")) return;
    }
    const byItem = {}, tally = { pass: 0, fail: 0, na: 0 }, split = { auto: 0, ai: 0, human: 0 };
    for (const i of items) {
      const dec = d.decisions[i.id];
      const suggested = DECIDED.includes(i.status) ? i.status : null;
      const by = suggested === dec ? (i.method === "ai" ? "ai" : "auto") : "human";
      byItem[i.id] = { decision: dec, auto: i.status, method: i.method, evidence: i.evidence, by };
      tally[dec]++; split[by]++;
    }
    const review = {
      id: DB.uid(), projectId: S.project.id, mailerId: m.id, v: ver.v, stage: d.stage, reviewers: [...d.reviewers],
      notes: d.notes.trim(), verdict: d.stage === "final" ? d.verdict : null, at: now(), byItem, tally, split,
      engineScore: ver.engine.score
    };
    await DB.put("reviews", review);
    if (d.stage === "final") {
      if (d.verdict === "approved") m.final = { v: ver.v, by: review.reviewers, at: review.at, reviewId: review.id };
      else if (m.final && m.final.v === ver.v) m.final = null;
      await DB.put("mailers", m);
    }
    const what = d.stage === "final" ? (d.verdict === "approved" ? "Final check — approved" : "Final check — changes requested") : "Manual check";
    await logEvent({ type: "review", mailerId: m.id, v: ver.v, reviewId: review.id, by: review.reviewers.join(", "),
      text: `${what} on “${m.name}” v${ver.v} by ${review.reviewers.join(", ")} — ${tally.pass} pass, ${tally.fail} fail` });
    S.draft = { ...newDraft(S.current.key, items), reviewers: d.reviewers, stage: d.stage };
    await reloadProject(S.project.id);
    toast(`${what} saved`);
    render();
  }

  async function saveVision(marks, res) {
    const { m, ver } = S.current;
    const mm = S.mailers.find((x) => x.id === m.id);
    const vv = mm.versions.find((x) => x.v === ver.v);
    vv.vision = { marks, res, at: now(), by: S.user };
    await DB.put("mailers", mm);
    await logEvent({ type: "ai", mailerId: m.id, v: ver.v, text: `AI vision pass on “${m.name}” v${ver.v} — ${marks.length} finding(s)` });
    await reloadProject(S.project.id);
    renderSide();
  }

  async function runAIBrand(btn) {
    const { m, ver, a } = S.current;
    btn.disabled = true;
    btn.innerHTML = `${spinner}AI is reading the mailer…`;
    try {
      const pages = (await E.renderPagesForVision(a.r.pdf)).map((p) => ({ page: p.page, png: p.png, w: p.w, h: p.h }));
      const items = itemsFor(ver, a.brand)
        .filter((i) => !DECIDED.includes(i.status) || C.ITEMS.find((x) => x.id === i.id).how === "ai")
        .map((i) => ({ id: i.id, label: C.label(i.id), hint: i.evidence }));
      const res = await api("/api/brand", { pages, text: a.brand.text, items, mailerType: m.type });
      const mm = S.mailers.find((x) => x.id === m.id), vv = mm.versions.find((x) => x.v === ver.v);
      vv.aiBrand = { results: res.results, at: now(), by: S.user, model: res.model };
      vv.brand.items = C.mergeAI(a.brand.items, res.results);
      await DB.put("mailers", mm);
      await logEvent({ type: "ai", mailerId: m.id, v: ver.v, text: `AI checked ${res.results.length} checklist item(s) on “${m.name}” v${ver.v}` });
      S.draft = newDraft(S.current.key, vv.brand.items);
      await reloadProject(S.project.id);
      toast("AI results added to the checklist");
      render();
    } catch (err) {
      toast(err.message, "err");
      btn.disabled = false;
      btn.textContent = "✦ Try the AI check again";
    }
  }

  /* ---------- right-hand notes: what the brief asked for ---------- */
  function notesHTML(m, ver, a) {
    const briefs = briefsFor(m);
    const reviews = S.reviews.filter((r) => r.mailerId === m.id).map((r) => `
      <li data-act="review-detail" data-id="${esc(r.id)}" tabindex="0"><span class="stage-tag ${r.stage}">${r.stage === "final" ? "Final" : "Manual"}</span>
        <b>${esc(r.reviewers.join(", "))}</b><small>v${r.v} · ${fmtDate(r.at)}${r.verdict ? " · " + (r.verdict === "approved" ? "approved" : "changes") : ""}</small></li>`).join("");
    const who = `<div class="notes-card"><h3>Who checked this mailer</h3>
      <ul class="who">
        ${m.versions.slice().reverse().map((v) => `<li><span class="stage-tag auto">Upload</span><b>${esc(v.uploadedBy)}</b><small>v${v.v} · ${fmtDate(v.uploadedAt)} · auto-checked</small></li>`).join("")}
        ${reviews}
      </ul></div>`;
    if (!briefs.length) {
      return `<div class="notes-card"><h3>Brief check</h3>
        <p class="muted">No brief is linked to this mailer yet. Add one and every requirement in it is checked against this mailer here.</p>
        <a class="btn sm" href="${P()}/briefs">+ Add a brief</a></div>${who}`;
    }
    const rows = B.checkAll(briefs, a.brand.text);
    const aiRes = Object.fromEntries(((ver.briefAI && ver.briefAI.results) || []).map((x) => [x.id, x]));
    const ICON = { found: "✓", partial: "◐", missing: "✕", verify: "👁", superseded: "⤼", conflict: "⚠" };
    const counts = {};
    const groups = briefs.map((b) => {
      const list = rows.filter((x) => x.brief === b).map((x) => {
        const ai = aiRes[x.req.id];
        const st = ai ? ai.status : x.status;
        counts[st] = (counts[st] || 0) + 1;
        return `<li class="nr ${st}"><span class="ic">${ICON[st] || "•"}</span><div>
          <div class="nr-t">${esc(x.req.text)}</div>
          <div class="nr-n">${ai ? `✦ ${esc(ai.note)}` : esc(x.note)}</div>
          ${x.evidence && st !== "superseded" ? `<div class="nr-e">${esc(x.evidence)}</div>` : ""}</div></li>`;
      }).join("");
      return `<div class="nb"><div class="nb-head"><span class="prio ${priorityOf(b) === 1 ? "top" : ""}">P${priorityOf(b)}</span>
        <a href="${P()}/briefs/${encodeURIComponent(b.id)}">${esc(b.title)}</a><small>${b.kind === "change" ? "change brief" : "original"} · ${fmtDay(b.uploadedAt)}</small></div>
        <ul class="nrs">${list || '<li class="muted small">No checkable requirements — add some in Briefs.</li>'}</ul></div>`;
    }).join("");
    const sum = ["found", "partial", "missing", "conflict", "verify", "superseded"].filter((k) => counts[k])
      .map((k) => `<span class="ns ${k}">${ICON[k]} ${counts[k]} ${k === "verify" ? "to verify" : k}</span>`).join("");
    return `<div class="notes-card"><h3>Brief check <small>${briefs.length} brief(s), newest first</small></h3>
        <div class="ns-row">${sum}</div>
        <p class="muted small">P1 is the latest brief — where briefs disagree it wins and older lines show as replaced.</p>
        <button class="btn ghost sm ai-btn" data-act="ai-brief-check" ${aiAttr()}>✦ AI brief check</button>${aiNote()}
        ${ver.briefAI ? `<p class="muted small">✦ AI checked ${fmtDate(ver.briefAI.at)} by ${esc(ver.briefAI.by)}</p>` : ""}
        ${groups}</div>${who}`;
  }

  async function runAIBriefCheck(btn) {
    const { m, ver, a } = S.current;
    const rows = B.checkAll(briefsFor(m), a.brand.text).filter((x) => x.status !== "superseded");
    if (!rows.length) return toast("No requirements to check.", "err");
    btn.disabled = true;
    btn.innerHTML = `${spinner}AI is comparing…`;
    try {
      const res = await api("/api/brief-check", {
        requirements: rows.map((x) => ({ id: x.req.id, text: x.req.text, brief: x.brief.title, priority: x.priority })),
        mailerText: a.brand.text
      });
      const mm = S.mailers.find((x) => x.id === m.id), vv = mm.versions.find((x) => x.v === ver.v);
      vv.briefAI = { results: res.results, at: now(), by: S.user };
      await DB.put("mailers", mm);
      await logEvent({ type: "ai", mailerId: m.id, v: ver.v, text: `AI brief check on “${m.name}” v${ver.v} — ${res.results.length} requirement(s)` });
      await reloadProject(S.project.id);
      render();
    } catch (err) {
      toast(err.message, "err");
      btn.disabled = false;
      btn.textContent = "✦ Try the AI brief check again";
    }
  }

  /* ---------- briefs tab ---------- */
  function renderBriefs(view, rt) {
    const sel = (rt.id && S.briefs.find((b) => b.id === rt.id)) || S.briefs[0] || null;
    const scopeOpts = (cur) => `<option value="" ${!cur ? "selected" : ""}>All mailers in this project</option>` +
      S.mailers.map((m) => `<option value="${esc(m.id)}" ${cur === m.id ? "selected" : ""}>Only “${esc(m.name)}”</option>`).join("");
    const list = S.briefs.map((b) => `
      <li class="bl-item ${sel === b ? "on" : ""}" data-href="${P()}/briefs/${encodeURIComponent(b.id)}" tabindex="0">
        <div><span class="prio ${priorityOf(b) === 1 ? "top" : ""}">P${priorityOf(b)}</span> <b>${esc(b.title)}</b></div>
        <small>${b.kind === "change" ? "Change brief" : "Original brief"} · ${esc(b.format.toUpperCase())} · ${(b.requirements || []).length} requirement(s)</small>
        <small>${esc(b.uploadedBy)} · ${fmtDate(b.uploadedAt)}</small>
      </li>`).join("");
    view.innerHTML = `
      <div class="card">
        <div class="uc-head"><h2>Add a brief</h2><span class="muted small">Every format is stored. Newer briefs take priority over older ones.</span></div>
        <label class="ws-drop compact" data-drop="brief">
          <input type="file" multiple accept="${B.ACCEPT}" class="vh">
          <span class="drop-icon">📎</span>
          <span class="drop-title">Drop brief files or <u>browse</u> — several at once is fine</span>
          <span class="drop-hint">PDF · Word (.docx/.doc) · Excel (.xlsx/.xls/.csv) · PowerPoint (.pptx/.ppt) · TXT · RTF · HTML · email · images</span>
        </label>
        <div class="upload-opts"><label>Applies to <select id="briefScope">${scopeOpts(null)}</select></label></div>
        <details class="paste"><summary>…or paste the brief text</summary>
          <form data-form="paste-brief"><input class="inp" name="title" placeholder="Brief title" required maxlength="100">
          <textarea class="inp" name="text" rows="6" placeholder="Paste the brief — an email, chat message or document text" required></textarea>
          <button class="btn sm">Add pasted brief</button></form></details>
        <div id="briefStatus"></div>
      </div>
      ${S.briefs.length ? `<div class="brief-layout"><ul class="brief-list">${list}</ul><div class="brief-detail">${sel ? briefDetailHTML(sel, scopeOpts) : ""}</div></div>`
        : `<div class="empty-card"><h3>No briefs yet</h3><p>Briefs are optional, but with one every mailer is checked against what the client asked for.</p></div>`}`;
  }

  function briefDetailHTML(b, scopeOpts) {
    const s = b.summary || {};
    const reqs = (b.requirements || []).map((q) => `<li><span class="kind ${q.kind}">${esc(q.kind)}</span><span class="rq">${esc(q.text)}</span>
      <span class="src">${q.source === "ai" ? "✦ AI" : q.source === "user" ? "added" : "auto"}</span>
      <button class="icon-btn sm" data-act="brief-req-del" data-id="${esc(q.id)}" aria-label="Remove requirement">×</button></li>`).join("");
    const sheets = b.sheets && b.sheets.length > 1 ? `<div class="sheets"><b>Sheets used:</b> ${b.sheets.map((sh, i) => `
      <label><input type="checkbox" data-change="brief-sheet" data-i="${i}" ${sh.use ? "checked" : ""}> ${esc(sh.name)} <small>(${sh.rows.length} rows)</small></label>`).join("")}</div>` : "";
    return `<div class="card">
      <div class="bd-head">
        <div><h3><span class="prio ${priorityOf(b) === 1 ? "top" : ""}">P${priorityOf(b)}</span> ${esc(b.title)}
          <button class="icon-btn sm" data-act="brief-rename" aria-label="Rename brief">✎</button></h3>
          <div class="muted small">${b.kind === "change" ? "Change brief — overrides older briefs where they disagree" : "Original brief"} · added by <b>${esc(b.uploadedBy)}</b> ${fmtDate(b.uploadedAt)}</div></div>
        <div class="bd-actions">
          ${b.fileId ? `<button class="btn ghost sm" data-act="brief-download">⬇ ${esc(b.fileName)}</button>` : ""}
          <button class="icon-btn" data-act="brief-delete" title="Delete brief" aria-label="Delete brief">🗑</button>
        </div>
      </div>
      <div class="upload-opts"><label>Applies to <select data-change="brief-scope">${scopeOpts(b.mailerId)}</select></label></div>
      ${b.note ? `<div class="banner">${esc(b.note)}</div>` : ""}
      ${sheets}
      <h4 class="bd-h">Summary</h4>
      ${s.overview ? `<p>${esc(s.overview)}</p>` : '<p class="muted">No prose to summarise — see the key facts and requirements.</p>'}
      ${(s.keyFields || []).length ? `<dl class="kv">${s.keyFields.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join("")}</dl>` : ""}
      ${(s.facts || []).length ? `<h5>Key facts & figures</h5><ul class="facts">${s.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
      ${(s.dates || []).length ? `<p><b>Dates:</b> ${s.dates.map(esc).join(" · ")}</p>` : ""}
      ${(s.urls || []).length ? `<p class="small"><b>Links:</b> ${s.urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(E.trim(u, 60))}</a>`).join(" · ")}</p>` : ""}
      <p class="muted small">${s.words || 0} words read from the brief.</p>

      <div class="ai-row">
        <button class="btn ghost sm ai-btn" data-act="brief-ai-summary" ${aiAttr()}>✦ AI summary & requirements</button>
        <button class="btn ghost sm ai-btn" data-act="brief-reframe" ${aiAttr()}>✦ Reframe into a detailed script</button>
        ${aiNote()}
      </div>
      ${b.ai ? `<div class="ai-box"><h5>✦ AI summary <small>${fmtDate(b.ai.at)} · ${esc(b.ai.by)}</small></h5>
        <ul>${b.ai.summary.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <button class="btn sm" data-act="brief-ai-use">Use the AI's ${b.ai.requirements.length} requirements</button></div>` : ""}
      ${b.script ? `<div class="ai-box"><h5>✦ Detailed script <small>${fmtDate(b.script.at)} · ${esc(b.script.by)}</small></h5>
        <pre class="script">${esc(b.script.text)}</pre>
        <button class="btn ghost sm" data-act="brief-script-copy">Copy</button> <button class="btn ghost sm" data-act="brief-script-download">⬇ Download .txt</button></div>` : ""}

      <h4 class="bd-h">Requirements checked against mailers <small>${(b.requirements || []).length}</small></h4>
      <p class="muted small">Each line is checked in every mailer this brief applies to (see the notes beside the preview). Remove noise, add anything missing.</p>
      <ul class="reqs">${reqs || '<li class="muted">None found automatically — add them below.</li>'}</ul>
      <form class="req-add" data-form="add-req">
        <select name="kind" aria-label="Requirement type"><option value="fact">Fact / offer</option><option value="cta">CTA</option><option value="date">Date</option><option value="theme">Theme</option><option value="instruction">Instruction</option></select>
        <input class="inp sm" name="text" placeholder="e.g. 11,000 Membership Rewards points on upgrade" required maxlength="220">
        <button class="btn ghost sm">+ Add</button>
        <button type="button" class="link" data-act="brief-reextract">Re-extract from brief</button>
      </form>

      <details class="paste"><summary>Brief text as read ${b.pasted ? "(edited)" : ""}</summary>
        <form data-form="edit-brief-text"><textarea class="inp mono" name="text" rows="12">${esc(B.briefText(b))}</textarea>
        <button class="btn ghost sm">Save text & re-read</button>
        ${b.pasted ? '<button type="button" class="link" data-act="brief-text-reset">Go back to the original file text</button>' : ""}</form></details>
    </div>`;
  }

  async function addBriefs(files, pasted) {
    await ensureUser();
    const status = $("#briefStatus");
    const scope = ($("#briefScope") || {}).value || null;
    let lastId = null;
    for (const f of files) {
      if (status) status.innerHTML = `<div class="status">${spinner}Reading <b>${esc(f ? f.name : pasted.title)}</b>…</div>`;
      const read = f ? await B.read(f) : { kind: "text", note: "", sheets: null, rows: [] };
      const overlaps = S.briefs.some((b) => !scope || !b.mailerId || b.mailerId === scope);
      const brief = {
        id: DB.uid(), projectId: S.project.id, mailerId: scope, title: f ? f.name.replace(/\.[^.]+$/, "") : pasted.title,
        fileId: f ? await DB.saveFile(f) : null, fileName: f ? f.name : null, size: f ? f.size : 0,
        uploadedAt: now(), uploadedBy: S.user, kind: overlaps ? "change" : "original", format: read.kind,
        note: read.note, sheets: read.sheets, rows: read.rows, pasted: f ? null : pasted.text, ai: null, script: null
      };
      brief.summary = B.summarize(brief);
      brief.requirements = B.extractRequirements(brief);
      await DB.put("briefs", brief);
      await logEvent({ type: "brief", briefId: brief.id, text: `Added ${brief.kind} brief “${brief.title}” (${brief.format.toUpperCase()}, ${brief.requirements.length} requirements)` });
      S.briefs.unshift(brief);
      lastId = brief.id;
    }
    await reloadProject(S.project.id);
    if (lastId) go(`${P()}/briefs/${encodeURIComponent(lastId)}`);
    toast(files.length > 1 ? `${files.length} briefs added` : "Brief added");
  }

  const selectedBrief = () => { const rt = parseRoute(); return (rt.id && S.briefs.find((b) => b.id === rt.id)) || S.briefs[0]; };
  async function saveBrief(b, eventText) {
    await DB.put("briefs", b);
    if (eventText) await logEvent({ type: "brief", briefId: b.id, text: eventText });
    await reloadProject(S.project.id);
    render();
  }
  function reread(b) {
    b.summary = B.summarize(b);
    const keep = (b.requirements || []).filter((q) => q.source !== "auto");
    b.requirements = keep.concat(B.extractRequirements(b).filter((q) => !keep.some((k) => k.text.toLowerCase() === q.text.toLowerCase())));
  }
  async function briefPayload(b) {
    const body = { title: b.title, text: B.briefText(b) };
    if (b.format === "image" && b.fileId) {
      const f = await DB.file(b.fileId);
      const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      body.image = { media_type: f.type || "image/png", data: url.split(",")[1] };
    }
    return body;
  }

  /* ---------- history tab ---------- */
  function coverage(m) {
    const ver = latest(m);
    const st = mailerStatus(m, ver);
    const engineN = ver.engine.scoredCount || 0;
    const last = st.revs[0];
    let auto, ai, manual, pending;
    if (last) { auto = last.split.auto; ai = last.split.ai; manual = last.split.human; pending = 0; }
    else {
      const items = ver.brand.items;
      auto = items.filter((i) => i.method === "auto" && DECIDED.includes(i.status)).length;
      ai = items.filter((i) => i.method === "ai" && DECIDED.includes(i.status)).length;
      manual = 0; pending = items.length - auto - ai;
    }
    return { m, ver, st, auto: auto + engineN, ai, manual, pending };
  }

  function bar(segs, total, w) {
    let x = 0;
    return segs.filter((s) => s.n > 0).map((s) => {
      const width = total ? (s.n / total) * w : 0;
      const out = `<rect x="${x.toFixed(1)}" y="0" width="${Math.max(0, width - 1).toFixed(1)}" height="22" rx="3" class="${s.cls}"><title>${s.label}: ${s.n}</title></rect>
        ${width > 26 ? `<text x="${(x + width / 2).toFixed(1)}" y="15" class="bt">${s.n}</text>` : ""}`;
      x += width;
      return out;
    }).join("");
  }

  function renderHistory(view) {
    const cov = S.mailers.map(coverage);
    const sum = cov.reduce((a, c) => ({ auto: a.auto + c.auto, ai: a.ai + c.ai, manual: a.manual + c.manual, pending: a.pending + c.pending }), { auto: 0, ai: 0, manual: 0, pending: 0 });
    const total = sum.auto + sum.ai + sum.manual + sum.pending;
    const pct = (n) => total ? Math.round((n / total) * 100) : 0;
    const segs = (c) => [
      { n: c.auto, cls: "s-auto", label: "Automated (rules engine)" }, { n: c.ai, cls: "s-ai", label: "AI" },
      { n: c.manual, cls: "s-manual", label: "Manual reviewer" }, { n: c.pending, cls: "s-pending", label: "Waiting for a reviewer" }];
    const W = 420;
    const perMailer = cov.map((c) => {
      const t = c.auto + c.ai + c.manual + c.pending;
      return `<div class="hrow" data-href="${P()}/upload/${encodeURIComponent(c.m.id)}" tabindex="0">
        <div class="hlabel"><b>${esc(c.m.name)}</b><small>v${c.ver.v} · ${c.st.manualNames.length ? "manual: " + esc(c.st.manualNames.join(", ")) : "no manual check"}</small></div>
        <svg viewBox="0 0 ${W} 22" class="hbar" role="img" aria-label="Check split for ${esc(c.m.name)}">${bar(segs(c), t, W)}</svg>
        <div class="hfinal ${c.st.approved ? "ok" : c.st.final ? "bad" : ""}">${c.st.approved ? "🏁 Final ✓ " + esc(c.st.final.reviewers.join(", ")) : c.st.final ? "🏁 Changes asked" : "🏁 Pending"}</div>
      </div>`;
    }).join("");

    const n = S.mailers.length;
    const manualDone = cov.filter((c) => c.st.manual.length).length;
    const finalDone = cov.filter((c) => c.st.approved).length;
    const funnel = [["Mailers uploaded", n, "f0"], ["Automated + AI checked", n, "f1"], ["Manual checked", manualDone, "f2"], ["Final professional check ✓", finalDone, "f3"]]
      .map(([l, v, cls]) => `<div class="frow"><span>${l}</span><div class="ftrack"><div class="fbar ${cls}" style="width:${n ? (v / n) * 100 : 0}%"></div></div><b>${v}</b></div>`).join("");

    const people = {};
    const bump = (name, k, at) => { if (!name) return; const p = people[name] = people[name] || { uploads: 0, manual: 0, final: 0, briefs: 0, last: "" }; p[k]++; if (at > p.last) p.last = at; };
    for (const m of S.mailers) for (const v of m.versions) bump(v.uploadedBy, "uploads", v.uploadedAt);
    for (const r of S.reviews) for (const who of r.reviewers) bump(who, r.stage === "final" ? "final" : "manual", r.at);
    for (const b of S.briefs) bump(b.uploadedBy, "briefs", b.uploadedAt);
    const peopleRows = Object.entries(people).sort((a, z) => (z[1].manual + z[1].final) - (a[1].manual + a[1].final))
      .map(([name, p]) => `<tr><td><b>${esc(name)}</b></td><td>${p.manual}</td><td>${p.final}</td><td>${p.uploads}</td><td>${p.briefs}</td><td>${p.last ? fmtDate(p.last) : "—"}</td></tr>`).join("");

    const finals = S.mailers.filter((m) => m.final).map((m) => {
      const v = m.versions.find((x) => x.v === m.final.v);
      return `<tr><td><b>${esc(m.name)}</b></td><td>v${m.final.v}</td><td>${esc(m.final.by.join(", "))}</td><td>${fmtDate(m.final.at)}</td>
        <td>${v ? `<button class="btn sm" data-act="download-version" data-mid="${esc(m.id)}" data-v="${m.final.v}">⬇ Download final emailer</button>` : "—"}</td></tr>`;
    }).join("");

    const filters = [["all", "All"], ["upload", "Uploads"], ["review", "Checks"], ["brief", "Briefs"], ["ai", "AI"]];
    const evs = S.events.filter((e) => S.histFilter === "all" || e.type === S.histFilter);
    const evRows = evs.map((e) => `<tr class="click" data-act="event-detail" data-id="${esc(e.id)}" tabindex="0">
      <td class="nowrap">${fmtDate(e.at)}</td><td><span class="etype ${esc(e.type)}">${esc(e.type)}</span></td><td>${esc(e.text)}</td><td>${esc(e.by || "")}</td></tr>`).join("");

    view.innerHTML = `
      <div class="hist-grid">
        <div class="card"><h3>Who did the checking</h3>
          <p class="muted small">Every handbook measurement and Amex checklist item, by who decided it — on each mailer's latest version.</p>
          <div class="hsum">
            <svg viewBox="0 0 ${W} 22" class="hbar big" role="img" aria-label="Overall check split">${bar(segs(sum), total, W)}</svg>
            <div class="legend">
              <span><i class="s-auto"></i>Automated ${pct(sum.auto)}%</span><span><i class="s-ai"></i>AI ${pct(sum.ai)}%</span>
              <span><i class="s-manual"></i>Manual ${pct(sum.manual)}%</span><span><i class="s-pending"></i>Waiting ${pct(sum.pending)}%</span>
              <span>🏁 Final approved ${finalDone}/${n}</span>
            </div>
          </div>
          ${perMailer || '<p class="muted">Upload a mailer to see the split.</p>'}
        </div>
        <div class="card"><h3>Pipeline</h3><p class="muted small">Automated check → manual check → final professional check.</p>${funnel}</div>
      </div>
      <div class="card"><h3>People</h3>
        ${peopleRows ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Manual checks</th><th>Final checks</th><th>Uploads</th><th>Briefs</th><th>Last active</th></tr></thead><tbody>${peopleRows}</tbody></table></div>` : '<p class="muted">Nobody has worked on this project yet.</p>'}</div>
      <div class="card"><h3>Final emailers</h3>
        ${finals ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Mailer</th><th>Version</th><th>Approved by</th><th>When</th><th></th></tr></thead><tbody>${finals}</tbody></table></div>` : '<p class="muted">No mailer has passed the final professional check yet.</p>'}</div>
      <div class="card"><div class="uc-head"><h3>Everything that happened</h3>
        <div class="filters">${filters.map(([k, l]) => `<button class="fchip ${S.histFilter === k ? "on" : ""}" data-act="hist-filter" data-k="${k}">${l}</button>`).join("")}</div></div>
        <p class="muted small">Click any row to see exactly what was done.</p>
        ${evRows ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>When</th><th>Type</th><th>What</th><th>By</th></tr></thead><tbody>${evRows}</tbody></table></div>` : '<p class="muted">Nothing yet.</p>'}</div>`;
  }

  async function eventDetail(id) {
    const e = S.events.find((x) => x.id === id);
    if (!e) return;
    if (e.reviewId) return reviewDetail(e.reviewId);
    const m = e.mailerId && S.mailers.find((x) => x.id === e.mailerId);
    const b = e.briefId && S.briefs.find((x) => x.id === e.briefId);
    let body = `<p><b>${esc(e.text)}</b></p><p class="muted">${esc(e.by || "")} · ${fmtDate(e.at)}</p>`;
    if (m) {
      const v = m.versions.find((x) => x.v === e.v) || latest(m);
      const items = v.brand.items;
      const c = (s) => items.filter((i) => i.status === s).length;
      body += `<dl class="kv"><dt>Mailer</dt><dd>${esc(m.name)} — v${v.v} (${esc(v.fileName)})</dd>
        <dt>Uploaded by</dt><dd>${esc(v.uploadedBy)} · ${fmtDate(v.uploadedAt)}</dd>
        <dt>Handbook score</dt><dd>${v.engine.score}% · ${v.engine.counts.pass} passed · ${v.engine.counts.warn} to fix · ${v.engine.counts.fail} failed</dd>
        <dt>Amex checklist</dt><dd>${c("pass")} pass · ${c("fail")} fail · ${c("warn")} to check · ${c("review")} need eyes · ${c("na")} n/a</dd>
        ${v.aiBrand ? `<dt>AI checklist</dt><dd>${v.aiBrand.results.length} item(s) by ${esc(v.aiBrand.by)} · ${fmtDate(v.aiBrand.at)}</dd>` : ""}
        ${v.vision ? `<dt>AI vision</dt><dd>${v.vision.marks.length} finding(s) by ${esc(v.vision.by)} · ${fmtDate(v.vision.at)}</dd>` : ""}</dl>
        <p><a class="btn sm" data-href="${P()}/upload/${encodeURIComponent(m.id)}/v${v.v}" href="${P()}/upload/${encodeURIComponent(m.id)}/v${v.v}">Open this version</a>
        <button class="btn ghost sm" data-act="download-version" data-mid="${esc(m.id)}" data-v="${v.v}">⬇ PDF</button></p>`;
    } else if (b) {
      body += `<dl class="kv"><dt>Brief</dt><dd>${esc(b.title)} (${esc(b.format.toUpperCase())})</dd><dt>Type</dt><dd>${b.kind === "change" ? "Change brief" : "Original"}</dd>
        <dt>Requirements</dt><dd>${(b.requirements || []).length}</dd></dl>
        <p><a class="btn sm" data-href="${P()}/briefs/${encodeURIComponent(b.id)}" href="${P()}/briefs/${encodeURIComponent(b.id)}">Open brief</a></p>`;
    } else if (e.mailerId || e.briefId) body += '<p class="muted">This item has since been deleted.</p>';
    modal({ title: "What was done", body, wide: true });
  }

  function reviewDetail(id) {
    const r = S.reviews.find((x) => x.id === id);
    if (!r) return toast("That check was deleted with its mailer.", "err");
    const m = S.mailers.find((x) => x.id === r.mailerId);
    const by = { auto: "Automated", ai: "✦ AI", human: "👤 Reviewer" };
    const rows = Object.entries(r.byItem).map(([k, x]) => `<tr class="${x.decision}"><td>${esc(C.label(k))}</td>
      <td><span class="badge ${x.auto}">${esc(x.auto)}</span></td><td><b>${esc(x.decision)}</b></td><td>${by[x.by]}${x.by === "human" && DECIDED.includes(x.auto) ? " (overrode)" : ""}</td></tr>`).join("");
    modal({
      title: `${r.stage === "final" ? "Final professional check" : "Manual check"} — ${m ? m.name : "deleted mailer"} v${r.v}`, wide: true,
      body: `<dl class="kv"><dt>Checked by</dt><dd>${esc(r.reviewers.join(", "))}</dd><dt>When</dt><dd>${fmtDate(r.at)}</dd>
        ${r.verdict ? `<dt>Verdict</dt><dd>${r.verdict === "approved" ? "✓ Approved as final emailer" : "↩ Sent back for changes"}</dd>` : ""}
        <dt>Result</dt><dd>${r.tally.pass} pass · ${r.tally.fail} fail · ${r.tally.na} n/a — handbook score ${r.engineScore}%</dd>
        <dt>Decided by</dt><dd>${r.split.auto} automated · ${r.split.ai} AI · ${r.split.human} by the reviewer</dd>
        ${r.notes ? `<dt>Notes</dt><dd class="pre">${esc(r.notes)}</dd>` : ""}</dl>
        <div class="table-wrap"><table class="tbl small"><thead><tr><th>Check</th><th>Automated said</th><th>Decision</th><th>Decided by</th></tr></thead><tbody>${rows}</tbody></table></div>
        ${m ? `<p><a class="btn sm" data-href="${P()}/upload/${encodeURIComponent(m.id)}/v${r.v}" href="${P()}/upload/${encodeURIComponent(m.id)}/v${r.v}">Open this version</a></p>` : ""}`
    });
  }

  /* ---------- rulebook tab ---------- */
  function renderRulebook(view) {
    const how = { auto: '<span class="cov auto">automated</span>', ai: '<span class="cov ai">ai / reviewer</span>' };
    view.innerHTML = `
      <div class="ref-card"><div class="ref-icon">📄</div>
        <div class="ref-body"><strong>Mobile Optimisation Handbook</strong><span id="refNote">The American Express source these rules come from — 24 pages.</span></div>
        <div class="ref-actions" id="refActions"><a class="btn" href="reference/mobile-optimisation-handbook.pdf" target="_blank" rel="noopener">Open PDF</a></div></div>
      <div class="card"><h3>Amex brand & copy checklist — ${C.ITEMS.length} items</h3>
        <p class="muted small">Run on every upload. “Automated” items are decided from the PDF's text, links and pixels; the rest go to AI (when on) and the reviewer.</p>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Check</th><th>Area</th><th>Decided by</th></tr></thead><tbody>
        ${C.ITEMS.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.label)}</td><td>${esc(it.cat)}</td><td>${how[it.how]}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="card"><h3>Mobile Optimisation handbook — every rule</h3>
        <p class="rulebook-sub"><span class="cov auto">auto</span> measured &amp; scored · <span class="cov obs">heuristic</span> detected, review by eye ·
          <span class="cov principle">guidance</span> design principle · <span class="cov ai">ai vision</span> optional AI pass · <span class="cov manual">manual</span> visual only.</p>
        <div class="rule-grid" id="ruleGrid"></div></div>`;
    E.renderCoverage($("#ruleGrid"));
    fetch("reference/mobile-optimisation-handbook.pdf", { method: "HEAD" }).then((r) => { if (!r.ok) throw 0; })
      .catch(() => { const a = $("#refActions"); if (a) a.hidden = true; const n = $("#refNote"); if (n) n.textContent = "Not bundled in this build — refer to your internal copy."; });
  }

  /* ---------- events ---------- */
  const actions = {
    "set-user": () => ensureUser(true).catch(() => {}),
    "delete-project": async (el) => {
      const p = S.projects.find((x) => x.id === el.dataset.id);
      if (!p || !await confirmModal(`Delete “${p.name}” with all its mailers, briefs, checks and files? This can't be undone.`, "Delete project", true)) return;
      for (const s of ["mailers", "briefs", "reviews", "events"]) {
        for (const x of await DB.where(s, "projectId", p.id)) {
          if (s === "mailers") for (const v of x.versions) await DB.delFile(v.fileId);
          if (s === "briefs" && x.fileId) await DB.delFile(x.fileId);
          await DB.del(s, x.id, p.id);
        }
      }
      await DB.del("projects", p.id);
      toast(`Deleted ${p.name}`);
      render();
    },
    "delete-mailer": async (el) => {
      const m = S.mailers.find((x) => x.id === el.dataset.id);
      if (!m || !await confirmModal(`Delete “${m.name}” (${m.versions.length} version(s)) and its checks? History entries are kept.`, "Delete mailer", true)) return;
      for (const v of m.versions) { await DB.delFile(v.fileId); cache.delete(`${m.id}:${v.v}`); }
      for (const r of S.reviews.filter((x) => x.mailerId === m.id)) await DB.del("reviews", r.id, m.projectId);
      await DB.del("mailers", m.id, m.projectId);
      await logEvent({ type: "upload", text: `Deleted mailer “${m.name}”` });
      await reloadProject(S.project.id);
      go(P() + "/upload");
    },
    "download-version": (el) => {
      const m = S.mailers.find((x) => x.id === el.dataset.mid);
      const v = m && m.versions.find((x) => x.v === +el.dataset.v);
      if (v) downloadFile(v.fileId, m.final && m.final.v === v.v ? v.fileName.replace(/\.pdf$/i, " - FINAL.pdf") : v.fileName);
    },
    "clear-focus": () => { S.focusItem = null; applyFocus(false); },
    "rm-reviewer": (el) => { S.draft.reviewers = S.draft.reviewers.filter((n) => n !== el.dataset.name); renderChecklist(); },
    "submit-review": () => submitReview(),
    "review-detail": (el) => reviewDetail(el.dataset.id),
    "event-detail": (el) => eventDetail(el.dataset.id),
    "ai-brand": (el) => runAIBrand(el),
    "ai-brief-check": (el) => runAIBriefCheck(el),
    "hist-filter": (el) => { S.histFilter = el.dataset.k; renderHistory($("#view")); },
    "brief-download": () => { const b = selectedBrief(); downloadFile(b.fileId, b.fileName); },
    "brief-delete": async () => {
      const b = selectedBrief();
      if (!await confirmModal(`Delete the brief “${b.title}”?`, "Delete brief", true)) return;
      if (b.fileId) await DB.delFile(b.fileId);
      await DB.del("briefs", b.id, b.projectId);
      await logEvent({ type: "brief", text: `Deleted brief “${b.title}”` });
      await reloadProject(S.project.id);
      go(P() + "/briefs");
    },
    "brief-rename": async () => {
      const b = selectedBrief();
      const t = await modal({ title: "Rename brief", body: `<input class="inp" value="${esc(b.title)}" maxlength="100">`,
        actions: [{ label: "Cancel", value: null }, { label: "Save", primary: true, collect: (m) => $("input", m).value.trim() }] });
      if (t) { b.title = t; saveBrief(b); }
    },
    "brief-req-del": (el) => { const b = selectedBrief(); b.requirements = b.requirements.filter((q) => q.id !== el.dataset.id); saveBrief(b); },
    "brief-reextract": () => { const b = selectedBrief(); reread(b); saveBrief(b); toast("Requirements re-read from the brief"); },
    "brief-text-reset": () => { const b = selectedBrief(); b.pasted = null; reread(b); saveBrief(b); },
    "brief-ai-summary": async (el) => {
      const b = selectedBrief();
      el.disabled = true; el.innerHTML = `${spinner}Reading the brief…`;
      try {
        const res = await api("/api/brief", { ...(await briefPayload(b)), action: "analyse" });
        b.ai = { summary: res.summary, requirements: res.requirements, at: now(), by: S.user };
        saveBrief(b, `AI summarised brief “${b.title}”`);
      } catch (err) { toast(err.message, "err"); el.disabled = false; el.textContent = "✦ AI summary & requirements"; }
    },
    "brief-ai-use": () => {
      const b = selectedBrief();
      const keep = b.requirements.filter((q) => q.source === "user");
      b.requirements = keep.concat(b.ai.requirements.map((q) => ({ id: DB.uid(), text: q.text, kind: q.kind, field: q.field, source: "ai" })));
      saveBrief(b, `Switched “${b.title}” to the AI's requirements`);
    },
    "brief-reframe": async (el) => {
      const b = selectedBrief();
      el.disabled = true; el.innerHTML = `${spinner}Writing the detailed script…`;
      try {
        const res = await api("/api/brief", { ...(await briefPayload(b)), action: "reframe" });
        b.script = { text: res.script, at: now(), by: S.user };
        saveBrief(b, `AI reframed brief “${b.title}” into a detailed script`);
      } catch (err) { toast(err.message, "err"); el.disabled = false; el.textContent = "✦ Reframe into a detailed script"; }
    },
    "brief-script-copy": () => navigator.clipboard.writeText(selectedBrief().script.text).then(() => toast("Script copied")),
    "brief-script-download": () => { const b = selectedBrief(); saveBlob(new Blob([b.script.text], { type: "text/plain" }), `${b.title} - detailed script.txt`); }
  };

  document.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (act && !act.disabled) {
      e.preventDefault();
      Promise.resolve().then(() => actions[act.dataset.act](act)).catch((err) => { console.error(err); toast(err.message, "err"); });
      return;
    }
    const nm = e.target.closest("#checklist td.cl-name");
    if (nm) {
      const id = nm.closest("tr").dataset.item;
      S.focusItem = S.focusItem === id ? null : id;
      applyFocus(true);
      return;
    }
    const dec = e.target.closest("[data-dec]");
    if (dec) {
      // Update the row in place — re-rendering the table on every click loses the scroll.
      const tr = dec.closest("tr"), id = tr.dataset.item, v = dec.dataset.dec;
      S.draft.decisions[id] = v;
      S.draft.touched[id] = true;
      tr.classList.remove("undecided", "need");
      $$("[data-dec]", tr).forEach((b) => { const on = b.dataset.dec === v; b.className = on ? "on " + v : ""; b.setAttribute("aria-pressed", on); });
      const pre = $(".pre", tr);
      if (pre) pre.remove();
      const prog = $("#checklist .sp.prog");
      if (prog) prog.textContent = `${Object.keys(S.draft.decisions).length}/${$$("#checklist tbody tr").length} decided`;
      return;
    }
    const stage = e.target.closest("[data-stage]");
    if (stage) { S.draft.stage = stage.dataset.stage; return renderChecklist(); }
    const verdict = e.target.closest("[data-verdict]");
    if (verdict) { S.draft.verdict = verdict.dataset.verdict; return renderChecklist(); }
    const link = e.target.closest("[data-href]");
    if (link && !e.target.closest("a[href]:not([data-href]), button, select, input, label")) go(link.dataset.href);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("td.cl-name")) { e.preventDefault(); e.target.click(); return; }
    if (e.key !== "Enter" || !e.target.matches("[data-href][tabindex], [data-act][tabindex]")) return;
    e.preventDefault();
    e.target.click();
  });
  document.addEventListener("input", (e) => { if (e.target.id === "rfNotes" && S.draft) S.draft.notes = e.target.value; });

  document.addEventListener("submit", async (e) => {
    const f = e.target.closest("[data-form]");
    if (!f) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    try {
      if (f.dataset.form === "new-project") {
        await ensureUser();
        const p = { id: DB.uid(), name: data.name.trim(), createdAt: now(), createdBy: S.user };
        if (!p.name) return;
        await DB.put("projects", p);
        S.project = p;
        await logEvent({ type: "project", text: `Created project “${p.name}”` });
        go(`#/p/${encodeURIComponent(p.id)}/upload`);
      } else if (f.dataset.form === "add-reviewer") {
        const who = (data.who || "").trim();
        if (who && !S.draft.reviewers.includes(who)) S.draft.reviewers.push(who);
        renderChecklist();
        const inp = $('#checklist input[name="who"]');
        if (inp) inp.focus();
      } else if (f.dataset.form === "paste-brief") {
        await addBriefs([null], { title: data.title.trim(), text: data.text });
      } else if (f.dataset.form === "add-req") {
        const b = selectedBrief();
        b.requirements.push({ id: DB.uid(), text: data.text.trim(), kind: data.kind, field: data.kind === "cta" ? "CTA" : data.kind === "date" ? "Dates" : "", source: "user" });
        saveBrief(b);
      } else if (f.dataset.form === "edit-brief-text") {
        const b = selectedBrief();
        b.pasted = data.text.trim() || null;
        reread(b);
        saveBrief(b, `Edited the text of brief “${b.title}”`);
      }
    } catch (err) { if (!/name is needed/.test(err.message)) toast(err.message, "err"); }
  });

  document.addEventListener("change", async (e) => {
    const el = e.target;
    if (el.type === "file") {
      const zone = el.closest("[data-drop]");
      const files = Array.from(el.files || []);
      el.value = "";
      if (zone && files.length) handleDrop(zone, files);
      return;
    }
    const kind = el.dataset.change;
    if (!kind) return;
    if (kind === "mailer-version") return go(`${P()}/upload/${encodeURIComponent(S.current.m.id)}/v${el.value}`);
    if (kind === "mailer-type") {
      const m = S.mailers.find((x) => x.id === S.current.m.id);
      m.type = el.value;
      await DB.put("mailers", m);
      await logEvent({ type: "upload", mailerId: m.id, text: `Set “${m.name}” as a ${m.type} mailer` });
      await reloadProject(S.project.id);
      return render();
    }
    if (kind === "brief-scope") {
      const b = selectedBrief();
      b.mailerId = el.value || null;
      return saveBrief(b, `Brief “${b.title}” now applies to ${b.mailerId ? "one mailer" : "all mailers"}`);
    }
    if (kind === "brief-sheet") {
      const b = selectedBrief();
      b.sheets[+el.dataset.i].use = el.checked;
      reread(b);
      return saveBrief(b);
    }
  });

  function handleDrop(zone, files) {
    const t = zone.dataset.drop;
    const fail = (err) => { if (!/name is needed/.test(err.message)) toast(err.message, "err"); };
    if (t === "mailer") uploadMailer(files[0], ($("#upAs") || {}).value || null, ($("#upType") || {}).value).catch(fail);
    else if (t === "version") uploadMailer(files[0], zone.dataset.mid).catch(fail);
    else if (t === "brief") addBriefs(files).catch(fail);
  }
  document.addEventListener("dragover", (e) => {
    const z = e.target.closest && e.target.closest("[data-drop]");
    if (!z) return;
    e.preventDefault();
    z.classList.add("drag");
  });
  document.addEventListener("dragleave", (e) => { const z = e.target.closest && e.target.closest("[data-drop]"); if (z) z.classList.remove("drag"); });
  document.addEventListener("drop", (e) => {
    const z = e.target.closest && e.target.closest("[data-drop]");
    if (!z) return;
    e.preventDefault();
    z.classList.remove("drag");
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) handleDrop(z, files);
  });

  /* ---------- one-time import of projects made in the earlier single-page version ---------- */
  async function migrateOld() {
    if (lsGet("studio-migrated")) return;
    lsSet("studio-migrated", "1");
    let old = [];
    try { old = JSON.parse(lsGet("ep") || "[]"); } catch (_) { return; }
    for (const p of old) {
      if (!p || !p.name) continue;
      const proj = { id: DB.uid(), name: p.name, createdAt: now(), createdBy: "imported" };
      await DB.put("projects", proj);
      for (const b of p.b || []) {
        try {
          let file = null;
          if (b.file && b.file.data) file = new File([await (await fetch(b.file.data)).blob()], b.file.name, { type: b.file.type || "" });
          const read = file ? await B.read(file) : { kind: "text", note: "", sheets: null, rows: [] };
          const brief = { id: DB.uid(), projectId: proj.id, mailerId: null, title: b.name || (file && file.name) || "Brief",
            fileId: file ? await DB.saveFile(file) : null, fileName: file ? file.name : null, size: file ? file.size : 0,
            uploadedAt: now(), uploadedBy: "imported", kind: "original", format: read.kind, note: read.note,
            sheets: read.sheets, rows: read.rows, pasted: file ? null : (b.type || b.name), ai: null, script: null };
          brief.summary = B.summarize(brief);
          brief.requirements = B.extractRequirements(brief);
          await DB.put("briefs", brief);
        } catch (err) { console.warn("brief import skipped", err); }
      }
    }
  }

  /* ---------- boot ---------- */
  window.addEventListener("hashchange", render);
  renderUserChip();
  renderAIBadge();
  $("#aiBadge").addEventListener("click", () => modal({
    title: S.ai.available ? "AI is on" : "AI is off",
    body: S.ai.available
      ? `<p>AI features use <b>${esc(S.ai.model)}</b> through your local server. Pages and brief text are sent to Anthropic only when you press a ✦ button.</p>`
      : `<p><b>Why:</b> ${esc(S.ai.reason)}</p><p>Everything else — the handbook engine, the brand checklist, brief reading and brief checks — runs without AI.</p>
         <p>To turn AI on: put a valid key in <code>.env</code> as <code>ANTHROPIC_API_KEY=…</code>, then run <code>./start.sh</code> and open the address it prints.</p>`
  }));
  E.aiStatus.then((s) => { S.ai = s; renderAIBadge(); if (S.loadedPid) render(); });

  function renderStoreBadge() {
    const b = $("#storeBadge");
    const shared = DB.mode === "shared";
    b.className = "ai-badge " + (shared ? "on store" : "off");
    b.textContent = shared ? "👥 Shared" : "💻 This browser only";
    b.title = shared ? "Everyone using this site sees the same projects" : "No shared storage here — projects are saved in this browser only";
  }
  $("#storeBadge").addEventListener("click", () => modal({
    title: DB.mode === "shared" ? "Shared workspace" : "Saved in this browser only",
    body: DB.mode === "shared"
      ? "<p>Projects, mailers, briefs, checks and history are stored on the server, so everyone with the link sees and edits the same data. Changes made by others appear within about 15 seconds.</p><p class='muted'>Anyone with the link can see and change everything here.</p>"
      : "<p>This copy of the site has no shared storage, so projects are kept in this browser and other people won't see them.</p><p>Open the shared site (Netlify, linked to GitHub) or run <code>./start.sh</code> to share data.</p>"
  }));

  // Projects made before sharing existed live in this browser; offer to copy them up once.
  async function offerUpload() {
    if (DB.mode !== "shared" || lsGet("studio-uploaded-local")) return;
    let projects = [];
    try { projects = await DB.local.all("projects"); } catch (_) { return; }
    if (!projects.length) return lsSet("studio-uploaded-local", "1");
    const go = await modal({
      title: "Share the projects saved in this browser?",
      body: `<p>This browser has ${projects.length} project(s) from before the workspace was shared: <b>${projects.map((p) => esc(p.name)).join(", ")}</b>.</p>
        <p>Copy them to the shared workspace so everyone can see them?</p>`,
      actions: [{ label: "Not now", value: null }, { label: "Don't ask again", value: "never" }, { label: "Copy to shared", primary: true, value: "yes" }]
    });
    if (go === "never") return lsSet("studio-uploaded-local", "1");
    if (go !== "yes") return;
    toast("Copying your projects to the shared workspace…");
    try {
      for (const s of ["projects", "mailers", "briefs", "reviews", "events"])
        for (const rec of await DB.local.all(s)) {
          if (s === "mailers") for (const v of rec.versions) { const f = await DB.local.file(v.fileId); if (f) await DB.saveFile(f, v.fileId); }
          if (s === "briefs" && rec.fileId) { const f = await DB.local.file(rec.fileId); if (f) await DB.saveFile(f, rec.fileId); }
          await DB.put(s, rec);
        }
      lsSet("studio-uploaded-local", "1");
      toast(`${projects.length} project(s) are now shared`);
      render();
    } catch (err) { toast("Copy stopped: " + err.message, "err"); }
  }

  // Pick up teammates' changes: one tiny version read every 15 s, a reload only when it moved.
  async function poll() {
    if (document.hidden || DB.mode !== "shared" || !$("#modal").hidden) return;
    if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    const pid = parseRoute().view === "project" ? parseRoute().pid : null;
    if (seen.key !== (pid || "_all")) return;          // the view is still loading
    let v;
    try { v = await DB.version(pid); } catch (_) { return; }
    if (v === seen.v) return;
    if (pid) await reloadProject(pid);
    render();
  }

  DB.ready.then(async () => {
    renderStoreBadge();
    if (DB.mode === "local") await migrateOld().catch((err) => console.warn(err));
    await render();
    offerUpload().catch((err) => console.warn(err));
    setInterval(() => poll().catch(() => {}), 15000);
  });
})();
