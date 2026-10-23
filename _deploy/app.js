/* Emailer — client-side mailer PDF compliance checker */
(function () {
  "use strict";

  const RB = window.RULEBOOK;
  const T = RB.thresholds;
  pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

  const $ = (s) => document.querySelector(s);

  // Reverse map of pdf.js's numeric opcodes → names, for the diagnostics panel.
  const OPNAME = (() => {
    const m = {};
    for (const k of Object.keys(pdfjsLib.OPS)) m[pdfjsLib.OPS[k]] = k;
    return m;
  })();
  /* ---------- environment probes ----------
     The same build runs locally (with a vision server + the handbook) and as a
     static deploy (with neither). Rather than fork the HTML, ask the environment
     what exists and make the page's claims match it. */

  // Resolves true only when the server holds a key Anthropic accepts. On a static
  // host the 404 page fails to parse as JSON, which lands in catch → false.
  const aiStatus = fetch("/api/status")
    .then((r) => r.json())
    .catch(() => ({ available: false, reason: "AI server not running — start it with ./start.sh" }));
  const visionReady = aiStatus.then((i) => !!i.available);

  /* In-memory session state only — the uploaded PDF & result live here while you use
     the app (so toggling the rulebook never loses your report) and are cleared on reload. */
  const session = { file: null, result: null };

  async function analyseFile(file) {
    const data = await withTimeout(extractPdf(file), 45000,
      "PDF parsing timed out — the file may be corrupt or the PDF worker failed to load.");
    return analyse(data, file);
  }

  /* ---------- standalone page (index.html) ---------- */
  function initStandalone() {
    const drop = $("#drop");
    const fileInput = $("#file");
    const statusEl = $("#status");
    const reportEl = $("#report");

    $("#browse").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
    drop.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
    ["dragenter", "dragover"].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
    drop.addEventListener("drop", (e) => {
      const f = e.dataTransfer.files[0];
      if (f && f.type === "application/pdf") handleFile(f);
      else showStatus("Please drop a PDF file.", true);
    });

    renderCoverage($("#ruleGrid"));

    visionReady.then((ok) => {
      if (!ok) return;                       // defaults in the HTML are already correct
      $("#aiTier").hidden = false;
      $("#privacyNote").textContent = "Rule checks run entirely in your browser. Pages are " +
        "only sent to Anthropic if you explicitly run the AI vision pass on the report.";
      $("#footNote").innerHTML = "Emailer · rule checks run locally · pages leave your machine " +
        "only when you run the AI vision pass · <strong>build v10 · 16 Jul 2026</strong>";
    });

    // The handbook is internal Amex material and isn't shipped publicly.
    fetch("reference/mobile-optimisation-handbook.pdf", { method: "HEAD" })
      .then((r) => { if (!r.ok) throw new Error("absent"); })
      .catch(() => {
        $("#refActions").hidden = true;
        $("#refNote").textContent = "The source reference these rules are built from — American " +
          "Express, 24 pages. Not bundled in this build; refer to your internal copy.";
      });

    const rulebookEl = $("#rulebook");
    const rulesToggle = $("#rulesToggle");
    function setRulebook(show) {
      rulebookEl.hidden = !show;
      rulesToggle.textContent = show ? "Hide rulebook" : "View rulebook";
      if (show) rulebookEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    rulesToggle.addEventListener("click", (e) => { e.preventDefault(); setRulebook(rulebookEl.hidden); });
    $("#rulesClose").addEventListener("click", () => {
      setRulebook(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    function showStatus(msg, isErr, busy) {
      statusEl.hidden = false;
      statusEl.className = "status" + (isErr ? " err" : "");
      statusEl.innerHTML = (busy ? '<span class="spinner"></span>' : "") + msg;
    }

    let analysing = false;
    async function handleFile(file) {
      if (analysing) return;            // ignore re-drops while one is in flight
      analysing = true;
      reportEl.hidden = true;
      showStatus(`Analysing <strong>&nbsp;${escapeHtml(file.name)}</strong>…`, false, true);
      try {
        const result = await analyseFile(file);
        session.file = file; session.result = result;  // keep in memory for this session
        renderReport(result, file, reportEl, {
          scroll: true,
          onAgain: () => { fileInput.value = ""; reportEl.hidden = true; window.scrollTo({ top: 0, behavior: "smooth" }); }
        });
        statusEl.hidden = true;         // done — remove the spinner
      } catch (err) {
        console.error(err);
        showStatus("Could not read this PDF: " + escapeHtml(err.message || String(err)), true);
      } finally {
        analysing = false;
      }
    }
  }

  function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /* ---------- PDF extraction (with geometry) ---------- */
  async function extractPdf(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    const items = [];        // {size, text, font, page, x, y, w}
    const fontFamilies = new Set();
    const imageSizes = [];   // {w, h, page} — displayed size in px
    const vectors = [];      // painted vector paths — logos, icons, buttons, rules
    const opCounts = {};     // which drawing ops this PDF actually uses (diagnostics)
    const tinyImages = [];   // images skipped as <=1px — spacers, tracking pixels
    const links = [];        // hyperlink hot-spots, PDF user space — only present if the export kept them
    let imageCount = 0, totalChars = 0;
    let page1W = 0, page1H = 0;
    let hasGradient = false, gradientCount = 0;

    const pageSizes = {};
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      pageSizes[p] = { w: vp.width, h: vp.height };
      if (p === 1) { page1W = vp.width; page1H = vp.height; }

      try {
        for (const a of await page.getAnnotations())
          if (a.subtype === "Link" && a.rect) links.push({ page: p, rect: a.rect, url: a.url || a.unsafeUrl || null });
      } catch (_) {}

      const content = await page.getTextContent();
      const styles = content.styles || {};
      const painted = new Set();
      for (const it of content.items) {
        // Keep the run's own spacing — pdf.js emits word gaps as their own
        // whitespace-only runs, and dropping them fuses "FROM" onto "AMERICAN".
        // Empty runs carry nothing and are skipped; blank blocks are dropped later.
        const str = it.str || "";
        if (!str) continue;
        const t = it.transform || [1, 0, 0, 1, 0, 0];
        // Some exports paint the same run twice at the same spot (overprint / fake
        // bold). Counting both doubles the copy and garbles every text check.
        const at = `${Math.round(t[4])}|${Math.round(t[5])}|${str}`;
        if (str.trim() && painted.has(at)) continue;
        painted.add(at);
        let size = it.height && it.height > 0 ? it.height : Math.hypot(t[2], t[3]);
        size = Math.round(size * 10) / 10;
        const fam = styles[it.fontName] && styles[it.fontName].fontFamily
          ? styles[it.fontName].fontFamily : (it.fontName || "unknown");
        items.push({ size, text: str, font: fam, page: p, x: t[4], y: t[5], w: it.width || 0 });
        fontFamilies.add(cleanFont(fam));
        totalChars += str.trim().length;
      }

      try {
        const ops = await page.getOperatorList();
        const OPS = pdfjsLib.OPS, Util = pdfjsLib.Util;
        // Walk the draw ops tracking the current transform matrix (CTM) so we can
        // measure how big each image is actually painted, and spot gradient fills.
        let ctm = vp.transform.slice();
        const stack = [];
        const fns = ops.fnArray, argsA = ops.argsArray;
        // Every image variant paints a unit square through some matrix; the only
        // thing that differs is how that matrix is arrived at.
        // `src` is the image's INTRINSIC pixel size, which pdf.js hands us alongside
        // the paint op. Comparing it to the painted size is the only way to catch
        // "don't upload high-resolution images if they are displayed smaller" (p3).
        const addImage = (m, isMask, src) => {
          const w = Math.hypot(m[0], m[1]);          // painted width in px
          const h = Math.hypot(m[2], m[3]);          // painted height in px
          if (!(w > 1 && h > 1)) {                   // 1px spacers, trackers, degenerate
            tinyImages.push(`${Math.round(w)}x${Math.round(h)}`);
            return;
          }
          imageCount++;
          const pts = [[0, 0], [1, 0], [1, 1], [0, 1]].map((q) => Util.applyTransform(q, m));
          const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
          imageSizes.push({ w: Math.round(w), h: Math.round(h), page: p, mask: !!isMask,
            srcW: src && src.w > 0 ? src.w : null, srcH: src && src.h > 0 ? src.h : null,
            rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
        };

        // A path is only artwork once something paints it — a path built purely to
        // clip is invisible, so hold each one until we see a fill/stroke.
        const PAINTS = new Set([OPS.fill, OPS.eoFill, OPS.stroke, OPS.closeStroke,
          OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
        let pending = null;
        for (let i = 0; i < fns.length; i++) {
          const fn = fns[i];
          const nm = OPNAME[fn] || String(fn);
          opCounts[nm] = (opCounts[nm] || 0) + 1;
          if (fn === OPS.save) stack.push(ctm.slice());
          else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
          else if (fn === OPS.transform) ctm = Util.transform(ctm, argsA[i]);
          // A logo is often placed as a reusable Form XObject, which carries its own
          // matrix. Ignore it and everything inside the form is measured in the wrong
          // space — the box lands off-page and gets clipped away, looking "undetected".
          else if (fn === OPS.paintFormXObjectBegin) {
            stack.push(ctm.slice());
            if (argsA[i] && argsA[i][0]) ctm = Util.transform(ctm, argsA[i][0]);
          }
          else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); }
          else if (fn === OPS.constructPath) {
            // pdf.js hands us the path's bbox as [minX, maxX, minY, maxY] in path
            // space; push it through the CTM to get where it actually lands.
            const mm = argsA[i][2];
            pending = null;
            if (mm && mm.length === 4) {
              const pts = [[mm[0], mm[2]], [mm[1], mm[2]], [mm[1], mm[3]], [mm[0], mm[3]]]
                .map((q) => Util.applyTransform(q, ctm));
              const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
              pending = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
            }
          }
          else if (PAINTS.has(fn)) {
            if (pending) vectors.push({ page: p, rect: pending });
            pending = null;
          }
          else if (fn === OPS.clip || fn === OPS.eoClip || fn === OPS.endPath) pending = null;
          else if (fn === OPS.shadingFill) { hasGradient = true; gradientCount++; }
          else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
            // args = [objId, intrinsicWidth, intrinsicHeight]
            const a = argsA[i] || [];
            addImage(ctm, false, a.length >= 3 ? { w: a[1], h: a[2] } : null);
          }
          else if (fn === OPS.paintInlineImageXObject) {
            const im = (argsA[i] || [])[0];
            addImage(ctm, false, im ? { w: im.width, h: im.height } : null);
          }
          // A single-colour logo is usually painted as a 1-bit STENCIL MASK, which
          // pdf.js reports under its own operators. Miss these and every mono logo
          // (and many icons) is invisible to the tool.
          else if (fn === OPS.paintImageMaskXObject) {
            const im = (argsA[i] || [])[0];
            addImage(ctm, true, im ? { w: im.width, h: im.height } : null);
          }
          else if (fn === OPS.paintImageMaskXObjectGroup ||
                   fn === OPS.paintInlineImageXObjectGroup) {
            for (const im of argsA[i][0] || [])
              addImage(im && im.transform ? Util.transform(ctm, im.transform) : ctm, true);
          }
          else if (fn === OPS.paintImageMaskXObjectRepeat || fn === OPS.paintImageXObjectRepeat) {
            // Repeated stencils: args carry a base scale plus a flat [x, y, ...] list.
            const a = argsA[i];
            const isMaskRepeat = fn === OPS.paintImageMaskXObjectRepeat;
            const m = isMaskRepeat ? [a[1], a[2], a[3], a[4]] : [a[1], 0, 0, a[2]];
            const pos = (isMaskRepeat ? a[5] : a[3]) || [];
            for (let k = 0; k + 1 < pos.length; k += 2)
              addImage(Util.transform(ctm, [m[0], m[1], m[2], m[3], pos[k], pos[k + 1]]), true);
          }
        }
      } catch (_) {}
    }

    return {
      pdf,                     // kept so the preview can re-render pages without re-parsing
      numPages: pdf.numPages, items, fonts: Array.from(fontFamilies),
      imageCount, imageSizes, hasGradient, gradientCount, totalChars, page1W, page1H,
      blocks: buildBlocks(readingOrder(items)),
      graphics: clusterVectors(vectors, page1W, page1H),
      pageSizes, opCounts, tinyImages, links
    };
  }

  // Graphics are measured in device space (y down from the top); text is in PDF
  // user space (y up from the bottom). To compare them, flip one. Assumes an
  // unrotated page, which every mailer export is.
  const devToPdf = (rect, pageH) => [rect[0], pageH - rect[3], rect[2], pageH - rect[1]];

  /* ---------- vector artwork (logos, icons, buttons, rules) ----------
     A logo is drawn as dozens of separate paths, so raw paths are useless as
     findings — group touching paths into one element, then classify by shape.
     Backgrounds and hairline rules are structure, not artwork. */
  function clusterVectors(vectors, pageW, pageH) {
    const PAD = 6;                       // paths this close belong to one element
    const CAP = 4000;                    // pathological vector art — don't hang the tab
    const byPage = {};
    for (const v of vectors) (byPage[v.page] = byPage[v.page] || []).push(v.rect);

    const out = [];
    for (const p of Object.keys(byPage)) {
      let rects = byPage[p];
      const dropped = Math.max(0, rects.length - CAP);
      rects = rects.slice(0, CAP);

      // Separate structure from artwork BEFORE clustering. A divider line or a
      // full-width band sits right next to a logo, so if they're allowed to cluster
      // together the logo gets absorbed into a page-wide box and then discarded as
      // "background" — the logo is found, then thrown away.
      const artRects = [];
      for (const r of rects) {
        const w = r[2] - r[0], h = r[3] - r[1];
        if (!(w > 0.5 && h > 0.5)) continue;                  // zero-area path
        if (w > pageW * 0.9 && h > pageH * 0.9) continue;      // page background
        if (Math.min(w, h) < 4) continue;                      // hairline rule / divider
        if (w >= pageW * 0.85 || h >= pageH * 0.85) continue;  // full-width band or panel
        artRects.push(r);
      }

      const clusters = [];
      for (const r of artRects) {
        const [x0, y0, x1, y1] = r;
        let merged = null;
        for (let k = clusters.length - 1; k >= 0; k--) {
          const c = clusters[k];
          const hit = x0 < c[2] + PAD && x1 > c[0] - PAD && y0 < c[3] + PAD && y1 > c[1] - PAD;
          if (!hit) continue;
          if (!merged) {
            c[0] = Math.min(c[0], x0); c[1] = Math.min(c[1], y0);
            c[2] = Math.max(c[2], x1); c[3] = Math.max(c[3], y1);
            c.n = (c.n || 1) + 1;
            merged = c;
          } else {
            // This rect bridges two clusters — fold them together.
            merged[0] = Math.min(merged[0], c[0]); merged[1] = Math.min(merged[1], c[1]);
            merged[2] = Math.max(merged[2], c[2]); merged[3] = Math.max(merged[3], c[3]);
            merged.n = (merged.n || 1) + (c.n || 1);
            clusters.splice(k, 1);
          }
        }
        if (!merged) { const c = [x0, y0, x1, y1]; c.n = 1; clusters.push(c); }
      }

      for (const c of clusters) {
        const w = c[2] - c[0], h = c[3] - c[1];
        // Structure was filtered out above, so anything left is artwork; classify
        // it by painted size — a 938×285 cluster is a panel, not a logo.
        const kind = (w < 64 && h < 64) ? "icon"
          : (w <= 240 && h <= 160) ? "logo"
          : "vector art";                                      // card, button, illustration
        out.push({ page: Number(p), rect: [c[0], c[1], c[2], c[3]],
                   w: Math.round(w), h: Math.round(h), paths: c.n || 1, kind, dropped });
      }
    }
    return out;
  }

  // pdf.js returns runs in *draw* order, which is not reading order — a mailer can
  // paint "M" before "GET MORE FRO". Regroup into visual lines (top→bottom) and sort
  // each line left→right, so merged blocks read the way a human reads them.
  function readingOrder(items) {
    const byPage = {};
    for (const i of items) (byPage[i.page] = byPage[i.page] || []).push(i);
    const out = [];
    for (const p of Object.keys(byPage).sort((a, z) => a - z)) {
      const rows = byPage[p].slice().sort((a, b) => b.y - a.y || a.x - b.x);
      let line = [];
      const flush = () => {
        line.sort((a, b) => a.x - b.x);
        out.push(...line);
        line = [];
      };
      for (const it of rows) {
        // Same line while the baseline stays within half an em of the line's first run.
        if (line.length && Math.abs(line[0].y - it.y) > Math.max(it.size, line[0].size) * 0.5) flush();
        line.push(it);
      }
      flush();
    }
    return out;
  }

  // Group consecutive items into blocks — one block ≈ one design element.
  // Merge only a continuation of the same line, or the very next line of the same
  // paragraph: same size, one line-gap away, and horizontally overlapping. Anything
  // looser swallows a CTA into the paragraph above it and destroys its identity.
  function buildBlocks(items) {
    const blocks = [];
    let cur = null;
    for (const it of items) {
      let sameBlock = false;
      if (cur && cur.page === it.page && Math.abs(cur.size - it.size) <= 0.6) {
        const dy = cur.lastY - it.y;                       // > 0 when the run sits lower
        const sameLine = Math.abs(dy) < it.size * 0.5;
        const nextLine = dy > 0 && dy < it.size * 1.8;
        const overlapsX = it.x < cur.maxX + it.size * 3 && it.x + it.w > cur.minX - it.size * 3;
        sameBlock = sameLine || (nextLine && overlapsX);
      }
      if (sameBlock) {
        const newLine = Math.abs(cur.lastY - it.y) > it.size * 0.5;
        if (newLine) cur.lines++;
        // A run that butts up against the previous one is the same word, split by
        // kerning ("GET MORE FRO" + "M") — join it with no space. Runs that carry
        // their own boundary space keep it; only a real positional gap adds one.
        const spaced = /\s$/.test(cur.text) || /^\s/.test(it.text) ||
                       it.x - cur.lastX2 > it.size * 0.25;
        cur.text += (newLine || spaced ? " " : "") + it.text;
        cur.lastY = it.y; cur.lastX2 = it.x + it.w;
        cur.minX = Math.min(cur.minX, it.x); cur.maxX = Math.max(cur.maxX, it.x + it.w);
      } else {
        cur = { page: it.page, size: it.size, font: it.font, text: it.text,
                lines: 1, y: it.y, lastY: it.y, minX: it.x, maxX: it.x + it.w,
                lastX2: it.x + it.w };
        blocks.push(cur);
      }
    }
    return blocks.map((b) => ({ ...b, text: b.text.replace(/\s+/g, " ").trim(),
      chars: b.text.replace(/\s+/g, " ").trim().length }))
      .filter((b) => b.chars > 0);   // whitespace-only runs that never merged
  }

  const cleanFont = (f) => String(f).replace(/^[A-Z]{6}\+/, "").toLowerCase();

  /* ---------- geometry gate ---------- */
  function geometry(d) {
    const w = d.page1W, h = d.page1H;
    const portrait = h >= w * 1.05;
    const widthOk = w >= T.emailMinWidthPt && w <= T.emailMaxWidthPt;
    const emailLike = portrait && widthOk;
    let note = "";
    if (!portrait) note = "This PDF is landscape — it looks like a slide/deck, not a mailer export. Pixel-based typography checks are unreliable here.";
    else if (w > T.emailMaxWidthPt) note = `Page is ${Math.round(w)}pt wide (≈${Math.round(w)}px) — wider than a typical email, so it may be exported at ${Math.max(2, Math.round(w / 600))}× scale. Pixel sizes shown are approximate.`;
    else if (w < T.emailMinWidthPt) note = `Page is only ${Math.round(w)}pt wide — narrower than expected; pixel sizes may be approximate.`;
    return { emailLike, portrait, note, w, h };
  }

  /* ---------- line-height (scale-independent ratio) ---------- */
  function measureLineHeight(items, bodySize) {
    const body = items.filter((i) => Math.abs(i.size - bodySize) <= 1);
    const byPage = {};
    for (const i of body) (byPage[i.page] = byPage[i.page] || []).push(i);
    const deltas = [];
    for (const p in byPage) {
      const ys = Array.from(new Set(byPage[p].map((i) => Math.round(i.y)))).sort((a, b) => b - a);
      for (let k = 1; k < ys.length; k++) {
        const dy = ys[k - 1] - ys[k];
        if (dy > bodySize * 0.9 && dy < bodySize * 2.4) deltas.push(dy);
      }
    }
    if (deltas.length < 3) return null;
    deltas.sort((a, b) => a - b);
    const leading = deltas[Math.floor(deltas.length / 2)];
    return Math.round((leading / bodySize) * 100) / 100;
  }

  /* ---------- conservative multi-column detection ---------- */
  function detectColumns(items) {
    const body = items.filter((i) => i.w > 0);
    const byPage = {};
    for (const i of body) (byPage[i.page] = byPage[i.page] || []).push(i);
    let bandsWithCols = 0, maxCols = 1;
    for (const p in byPage) {
      const rows = {};
      for (const i of byPage[p]) {
        const band = Math.round(i.y / 12);
        (rows[band] = rows[band] || []).push(i);
      }
      for (const b in rows) {
        const xs = rows[b].map((i) => i.minX !== undefined ? i.minX : i.x).sort((a, z) => a - z);
        let groups = 1;
        for (let k = 1; k < xs.length; k++) if (xs[k] - xs[k - 1] > 60) groups++;
        if (groups >= 2) { bandsWithCols++; maxCols = Math.max(maxCols, groups); }
      }
    }
    return { multiColumn: bandsWithCols >= 3, maxCols, bands: bandsWithCols };
  }

  /* ---------- vertical spacing between blocks (rough, per page) ---------- */
  function measureSpacing(blocks) {
    const byPage = {};
    for (const b of blocks) (byPage[b.page] = byPage[b.page] || []).push(b);
    let tight = 0, pairs = 0;
    for (const p in byPage) {
      const arr = byPage[p].slice().sort((a, z) => z.y - a.y); // top → bottom
      for (let k = 0; k < arr.length - 1; k++) {
        const curBottom = Math.min(arr[k].y, arr[k].lastY) - arr[k].size;
        const nextTop = Math.max(arr[k + 1].y, arr[k + 1].lastY);
        const gap = curBottom - nextTop;
        if (gap >= 0 && gap < 200) { pairs++; if (gap < T.spacingMinPx) tight++; }
      }
    }
    return { tight, pairs };
  }

  /* ---------- rules engine ---------- */
  function analyse(d, file) {
    const g = geometry(d);
    const scored = [];   // measured & counted toward the score
    const obs = [];      // heuristic observations (not scored)
    const marks = [];    // boxes drawn over the rendered page preview
    const S = (c) => scored.push(c);
    const O = (c) => obs.push(c);
    /* space: "pdf" = PDF user space (y up); "device1" = scale-1 viewport space (images). */
    const mark = (page, rect, kind, label, space) =>
      marks.push({ page, rect, kind, label, space: space || "pdf" });

    const sizes = d.items.map((i) => i.size).filter((s) => s > 0);
    // Dominant size by volume of text, not by number of runs — body copy is whatever
    // carries the most characters, and counting runs lets a row of tiny labels win.
    const bodySize = dominantSize(d.items);
    const maxSize = sizes.length ? Math.max(...sizes) : 0;
    const pxOk = g.emailLike; // only trust px thresholds when geometry looks like an email

    /* ---- Typography (px-gated) ---- */
    // Trademark / footnote superscripts are naturally tiny — not a body-text violation.
    const tooSmall = d.items.filter((i) => i.size > 0 && i.size < T.fontMinPx && !isMarkGlyph(i.text));
    const smallEvi = uniqBySize(tooSmall).slice(0, 4)
      .map((t) => `<span class="evi">${fmt1(t.size)}px</span> — “${escapeHtml(trim(t.text, 55))}”`);
    // Every text rule below is gated on there actually being text. A flattened
    // mailer has none, and "all detected text is >= 12px" must not be a free pass
    // for a page with nothing to detect — that inflates the score exactly when the
    // tool can measure the least.
    const hasText = d.items.length > 0;
    if (pxOk && hasText) {
      if (tooSmall.length)
        S(chk("Minimum font size", "fail", 3, "p3 · never below 12px",
          `${tooSmall.length} text run(s) fall below the 12px floor.`, smallEvi));
      else
        S(chk("Minimum font size", "pass", 3, "p3 · never below 12px", "All detected text is ≥ 12px."));
    } else if (tooSmall.length) {
      O(chk("Minimum font size", "info", 0, "p3 · never below 12px",
        `${tooSmall.length} run(s) look smaller than 12px, but page geometry is non-standard so this is approximate — verify manually.`, smallEvi));
    }

    if (bodySize) {
      const inRange = bodySize >= T.bodyMinPx && bodySize <= T.bodyMaxPx;
      const mobileOk = bodySize >= T.bodyMobileMinPx;
      const detail = `Dominant body size is <span class="evi">${bodySize}px</span> (target 14–16px desktop, ≥12px mobile).`;
      if (pxOk) S(chk("Body copy size", inRange ? "pass" : (mobileOk ? "warn" : "fail"), 2, "p4 · body 14–16px", detail));
      else O(chk("Body copy size", "info", 0, "p4 · body 14–16px", detail + " (approx — non-standard page size)."));
    }

    if (maxSize) {
      const headDetail = `Largest text ≈ <span class="evi">${fmt1(maxSize)}px</span> (headings 18–32px; H1≈28, H2≈18).`;
      if (pxOk) {
        const st = maxSize > T.headingMaxPx ? "warn" : "pass";
        S(chk("Heading size", st, 1, "p4 · headings 18–32px",
          st === "warn" ? headDetail + " Above 32px — fine inside a hero image, review if it's live text." : headDetail));
      } else O(chk("Heading size", "info", 0, "p4 · headings 18–32px", headDetail + " (approx)."));
    }

    // Legal / fine print: smallest tier of text
    const legal = d.items.filter((i) => i.size > 0 && i.size <= T.legalPx + 0.6 && i.size >= 8);
    if (pxOk && legal.length) {
      const belowLegal = legal.filter((i) => i.size < T.legalPx - 0.4);
      if (belowLegal.length)
        S(chk("Legal / fine print", "fail", 1, "p4 · legal 12px",
          `Fine print detected below 12px — legal text should stay at 12px.`,
          uniqBySize(belowLegal).slice(0, 3).map((t) => `<span class="evi">${fmt1(t.size)}px</span> — “${escapeHtml(trim(t.text, 50))}”`)));
      else
        S(chk("Legal / fine print", "pass", 1, "p4 · legal 12px", "Fine print holds at ~12px."));
    }

    // Line-height (ratio is scale-independent → always scored)
    const lh = measureLineHeight(d.items, bodySize);
    if (lh != null) {
      const ok = lh >= T.lineHeightMin - 0.05 && lh <= T.lineHeightMax + 0.15;
      S(chk("Line-height", ok ? "pass" : "warn", 1, "p4 · 1.4–1.5×",
        `Body line-height ≈ <span class="evi">${lh}×</span> font size (target 1.4–1.5×).`));
    }

    /* ---- Fonts (scale-independent) ---- */
    const flagged = d.fonts.filter((f) => T.nonWebSafeFonts.some((n) => f.includes(n)));
    if (d.fonts.length) {
      if (flagged.length)
        S(chk("Web-safe fonts", "fail", 2, "p11 · web-safe only",
          "Non-web-safe font(s) detected — limited email-client support.",
          flagged.map((f) => `<span class="evi">${escapeHtml(f)}</span>`)));
      else
        S(chk("Web-safe fonts", "pass", 2, "p11 · font support", "No Guardian / Benton Sans detected."));

      if (d.fonts.length > T.maxFontFamilies)
        S(chk("Font variety", "warn", 1, "consistency",
          `${d.fonts.length} distinct font families — consider consolidating.`,
          d.fonts.slice(0, 8).map((f) => `<span class="evi">${escapeHtml(f)}</span>`)));
      else
        S(chk("Font variety", "pass", 1, "consistency", `${d.fonts.length} font family(ies) in use.`));
    }

    /* ---- Content length (scale-independent) ---- */
    const longBlocks = d.blocks.filter((b) => b.chars > T.moduleBodyMax);
    if (longBlocks.length) {
      const worst = [...longBlocks].sort((a, b) => b.chars - a.chars).slice(0, 3);
      S(chk("Body length", "warn", 2, "p6 · module body ≤ 300",
        `${longBlocks.length} text block(s) exceed 300 chars.`,
        worst.map((b) => `<span class="evi">${b.chars} chars</span> (p${b.page}) — “${escapeHtml(trim(b.text, 65))}”`)));
    } else if (d.blocks.length) {
      S(chk("Body length", "pass", 2, "p6 · module body ≤ 300", "No blocks exceed the 300-char body limit."));
    }

    const bodyBlocks = d.blocks.filter((b) => Math.abs(b.size - bodySize) <= 1 && b.chars > 40);
    const overLines = bodyBlocks.filter((b) => b.lines > T.paragraphMaxLines + 1); // allow slack for wrap detection
    if (bodyBlocks.length) {
      if (overLines.length)
        S(chk("Paragraph length", "warn", 1, "p6 · max 2 lines",
          `${overLines.length} paragraph(s) run well over 2 lines — tighten copy.`,
          overLines.slice(0, 3).map((b) => `<span class="evi">${b.lines} lines</span> (p${b.page}) — “${escapeHtml(trim(b.text, 55))}”`)));
      else
        S(chk("Paragraph length", "pass", 1, "p6 · max 2 lines", "Paragraphs stay compact."));
    }

    // Preheader = first text block (observation). A real preheader is often a
    // hidden HTML div that never renders into the PDF at all, so this is a guess
    // — and it's simply wrong when the export opens with a view-online link.
    const first = d.blocks.find((b) => isSubstantive(b));
    if (first && isViewOnline(first.text)) {
      O(chk("Preheader length", "info", 0, "p6 · 40–50 chars",
        "The first text is a view-online link, so Emailer can't identify the preheader " +
        "in this export — a preheader is often a hidden div that never renders to PDF. " +
        "Check it in your ESP.", [`“${escapeHtml(trim(first.text, 70))}”`]));
    } else if (first) {
      const c = first.chars;
      const ok = c >= T.preheaderMin && c <= T.preheaderMax;
      O(chk("Preheader length", ok ? "pass" : "info", 0, "p6 · 40–50 chars",
        `First text block is <span class="evi">${c} chars</span> (preheader target 40–50). Confirm this is the preheader.`,
        [`“${escapeHtml(trim(first.text, 70))}”`]));
    }

    // Headlines are 18–32px per the handbook (p3–4). Sizing them relative to the
    // dominant body size instead turns every 14px run into a "headline" whenever
    // legal copy out-volumes the real body text.
    const headlineBlocks = d.blocks.filter((b) => b.size >= T.headingMinPx - 0.5 &&
        b.chars <= 90 && b.lines <= 2 && isSubstantive(b))
      .sort((a, b) => b.size - a.size);
    const heroHead = headlineBlocks[0];
    if (heroHead) {
      const c = heroHead.chars;
      // 25–45 is a range, not a ceiling — a 13-char hero misses the target too.
      const st = (c > T.heroHeadlineHard || c < T.heroHeadlineMin) ? "warn" : "pass";
      O(chk("Hero headline length", st, 0, "p6 · 25–45 (max 60)",
        `Largest headline is <span class="evi">${c} chars</span> (ideal 25–45, hard max 60).`,
        [`“${escapeHtml(trim(heroHead.text, 80))}”`]));
    }

    // Hero body = the first substantial copy block after the hero headline (p6).
    const heroBody = heroHead && d.blocks
      .filter((b) => b.page === heroHead.page && b.y < heroHead.y &&
                     b.chars >= 40 && b.size < T.headingMinPx && isSubstantive(b))
      .sort((a, b) => b.y - a.y)[0];
    if (heroBody) {
      const c = heroBody.chars;
      const st = c > T.heroBodyHard ? "warn"
        : (c < T.heroBodyMin || c > T.heroBodyMax) ? "warn" : "pass";
      O(chk("Hero body length", st, 0, "p6 · 90–180 (max 250)",
        `Copy under the hero is <span class="evi">${c} chars</span> (ideal 90–180, hard max 250).`,
        [`“${escapeHtml(trim(heroBody.text, 80))}”`]));
    }

    // Module headlines = the remaining smaller headlines. 20–50 is a range: a
    // 6-char headline misses the target just as a 72-char one does.
    const moduleHeads = headlineBlocks.slice(1);
    if (moduleHeads.length) {
      const longMods = moduleHeads.filter((b) => b.chars > T.moduleHeadlineMax);
      const shortMods = moduleHeads.filter((b) => b.chars < T.moduleHeadlineMin);
      const bad = longMods.concat(shortMods);
      if (bad.length)
        O(chk("Module headline length", "warn", 0, "p6 · 20–50 chars",
          `${bad.length} of ${moduleHeads.length} module headline(s) fall outside 20–50 chars ` +
          `(${longMods.length} over, ${shortMods.length} under).`,
          bad.slice(0, 3).map((b) => `<span class="evi">${b.chars} chars</span> — “${escapeHtml(trim(b.text, 55))}”`)));
      else
        O(chk("Module headline length", "pass", 0, "p6 · 20–50 chars",
          `${moduleHeads.length} module headline(s), all within 20–50 chars.`));
    }

    /* ---- CTAs (scale-independent) ---- */
    const ctas = d.blocks.filter((b) => isCtaLike(b.text));
    if (ctas.length) {
      const issues = [];
      let ctaHardBreak = false;
      for (const b of ctas) {
        const problems = [];
        if (b.chars > T.ctaMaxChars || wordCount(b.text) > T.ctaMaxWords) problems.push("too long");
        // "No glyph arrows after the copy" (p12) is an absolute — treat it as an error, not a nudge.
        if (RB.ctaTrailingGlyphs.test(b.text)) { problems.push("trailing arrow glyph"); ctaHardBreak = true; }
        if (!isTitleCase(b.text)) problems.push("not Title Case");
        if (problems.length) issues.push({ b, problems });
      }
      if (issues.length)
        S(chk("CTA copy", ctaHardBreak ? "fail" : "warn", 1, "p12 · 1–3 words, Title Case, no arrows",
          `${issues.length} of ${ctas.length} CTA-like element(s) break CTA rules.`,
          issues.slice(0, 5).map((x) =>
            `“${escapeHtml(trim(x.b.text, 34))}” — ${x.problems.join(", ")}`)));
      else
        S(chk("CTA copy", "pass", 1, "p12 · CTA copy", `${ctas.length} CTA-like element(s), all concise & well-formed.`));
    }

    /* ---- Preview boxes: every text block gets one, labelled with its role, its
            measurements, and every rule it breaks. buildBlocks() splits on font size,
            so a small run always forms its own block — one box per box-worthy region. ---- */
    const heroSet = new Set(heroHead ? [heroHead] : []);
    const modSet = new Set(moduleHeads);
    const ctaSet = new Set(ctas);
    const sev = (k) => (pxOk ? k : "info");   // px verdicts are unreliable off-geometry

    for (const b of d.blocks) {
      const v = [];
      // Any sub-heading-sized run of real copy is body text, whatever the dominant
      // size happens to be — otherwise a 17px paragraph dodges the 14–16px rule.
      // Stray glyphs (bullets, ®, a lone letter) are not elements — don't call a
      // single character a headline.
      const role = !isSubstantive(b) ? "symbol"
        : isViewOnline(b.text) ? "view-online link"
        : b === first ? "preheader" : ctaSet.has(b) ? "CTA"
        : heroSet.has(b) ? "hero headline" : modSet.has(b) ? "headline"
        : b.size <= T.legalPx + 0.6 ? "legal"
        : (b.size < T.headingMinPx && (b.chars >= 40 || Math.abs(b.size - bodySize) <= 1))
          ? "body" : "text";

      /* size */
      if (b.size < T.fontMinPx && !isMarkGlyph(b.text))
        v.push([sev("fail"), `${fmt1(b.size)}px — under the 12px floor`]);
      else if (role === "body" && (b.size < T.bodyMinPx || b.size > T.bodyMaxPx))
        v.push([sev("warn"), `body ${fmt1(b.size)}px — target 14–16px`]);
      if ((role === "hero headline" || role === "headline") && b.size > T.headingMaxPx)
        v.push([sev("warn"), `${fmt1(b.size)}px — over the 32px heading max`]);

      /* font */
      const bf = cleanFont(b.font);
      if (T.nonWebSafeFonts.some((n) => bf.includes(n)))
        v.push(["fail", `${bf} — not web-safe`]);

      /* line-height (ratio → scale-independent, so never gated on geometry) */
      const blh = blockLineHeight(b);
      if (blh != null && (blh < T.lineHeightMin - 0.05 || blh > T.lineHeightMax + 0.15))
        v.push(["warn", `line-height ${blh}× — target 1.4–1.5×`]);

      /* copy length */
      if (b.chars > T.moduleBodyMax) v.push(["warn", `${b.chars} chars — over the 300 limit`]);
      if (role === "body" && b.lines > T.paragraphMaxLines + 1)
        v.push(["warn", `${b.lines} lines — over the 2-line max`]);
      if (role === "preheader" && (b.chars < T.preheaderMin || b.chars > T.preheaderMax))
        v.push(["warn", `preheader ${b.chars} chars — target 40–50`]);
      if (role === "hero headline" && b.chars > T.heroHeadlineHard)
        v.push(["warn", `hero headline ${b.chars} chars — over the 60 max`]);
      if (role === "headline" && b.chars > T.moduleHeadlineMax)
        v.push(["warn", `headline ${b.chars} chars — over 50`]);

      /* CTA */
      if (role === "CTA") {
        if (RB.ctaTrailingGlyphs.test(b.text)) v.push(["fail", "CTA — trailing arrow glyph"]);
        if (b.chars > T.ctaMaxChars || wordCount(b.text) > T.ctaMaxWords)
          v.push(["warn", `CTA ${b.chars} chars / ${wordCount(b.text)} words — max 22 / 3`]);
        if (!isTitleCase(b.text)) v.push(["warn", "CTA — not Title Case"]);
      }

      const rank = { fail: 0, warn: 1, info: 2 };
      const worst = v.reduce((a, x) => (rank[x[0]] < rank[a] ? x[0] : a), "info");
      // A real element that breaks nothing is a measured pass, and shows as one.
      mark(b.page, blockRect(b), v.length ? worst : role === "symbol" ? "info" : "pass",
        v.length ? v.map((x) => x[1]).join(" · ")
                 : `✓ ${role} · ${fmt1(b.size)}px · ${b.chars} chars`);
    }

    /* ---- Images (scale-independent) ---- */
    if (file.size > T.fileMaxBytes)
      S(chk("File weight", "warn", 1, "p3 · assets ≤ 2 MB",
        `PDF is <span class="evi">${fmtBytes(file.size)}</span>. Keep individual email assets ≤ 2 MB.`));
    else
      S(chk("File weight", "pass", 1, "p3 · assets ≤ 2 MB", `PDF is <span class="evi">${fmtBytes(file.size)}</span>.`));

    // "Prefer live text over image-based text" (p3) and "don't place important
    // information inside images only" (p16) are rules, not observations — so this
    // is scored. Without it a fully-flattened mailer scores 100% simply because
    // there is nothing left to measure, which is the most misleading answer possible.
    const liveTextThin = d.imageCount > 0 && d.totalChars < 120 * Math.max(1, d.numPages);
    if (liveTextThin)
      S(chk("Live text vs. image", "fail", 3, "p3 · prefer live text",
        `Only <span class="evi">${d.totalChars} chars</span> of live text against ${d.imageCount} image(s) — ` +
        `the copy is built as images. Image text can't rescale on mobile, renders identically in ` +
        `dark mode (so it can't adapt), and can't be read by screen readers. Almost nothing else ` +
        `on this page is measurable as a result — run the AI vision pass for a real review.`));
    else
      S(chk("Live text vs. image", "pass", 3, "p3 · prefer live text",
        `<span class="evi">${d.totalChars} chars</span> of live text alongside ${d.imageCount} image(s).`));

    if (d.imageCount > d.numPages * 6)
      O(chk("Image density", "warn", 0, "p3 · avoid image-heavy sections",
        `${d.imageCount} image draws across ${d.numPages} page(s) — check for image-heavy sections.`));

    /* ---- Layout (heuristic observation) ---- */
    const cols = detectColumns(d.items);
    if (cols.multiColumn)
      O(chk("Column layout", "warn", 0, "p13 · must stack to 1-column",
        `A multi-column layout (~${cols.maxCols} columns) appears in ${cols.bands} row(s). Confirm every block stacks independently to a single column on mobile.`));

    /* ---- Gradients / shadings (detected from vector ops) ---- */
    if (d.hasGradient)
      O(chk("Gradients / shadings", "warn", 0, "p10–11 · non-codeable",
        `${d.gradientCount} vector gradient/shading fill(s) detected — gradients are hard to code for email and can break across clients. (Shadows & blur baked into images can't be detected here — still review visually.)`));
    else
      O(chk("Gradients / shadings", "pass", 0, "p10–11 · non-codeable",
        `No vector gradient fills detected. (Gradients baked into images can't be seen here — confirm visually.)`));

    /* ---- Vector artwork: logos, icons, buttons ----
       Drawn as paths, so none of it appears in the text layer or the image list.
       This must NOT be nested under the image check — a mailer whose logos are all
       vector has no raster images at all, and would get no artwork boxes. */
    const art = d.graphics || [];   // structure is already filtered out upstream
    for (const g of art) mark(g.page, g.rect, "info", `${g.kind} · ${g.w}×${g.h}px · vector`, "device1");
    if (art.length) {
      const n = (k) => art.filter((g) => g.kind === k).length;
      const dropped = art.reduce((a, g) => Math.max(a, g.dropped || 0), 0);
      O(chk("Logos, icons & vector art", "pass", 0, "p3 · prefer live text & simple shapes",
        `${art.length} vector graphic(s) — <span class="evi">${n("icon")} icon(s)</span>, ` +
        `<span class="evi">${n("logo")} logo(s)</span>, <span class="evi">${n("vector art")} larger graphic(s)</span>. ` +
        `Drawn as paths rather than images, so they scale cleanly and are invisible to the text ` +
        `layer. Confirm each survives dark mode.` +
        (dropped ? ` <strong>${dropped} extra path(s) not analysed.</strong>` : ""),
        art.slice(0, 4).map((g) => `<span class="evi">${g.w}×${g.h}px</span> ${g.kind} (p${g.page}) — ${g.paths} path(s)`)));
    }

    /* ---- Bleed / oversized images (from painted size) ---- */
    if (d.imageSizes && d.imageSizes.length) {
      const bleed = d.imageSizes.filter((im) => im.w > d.page1W * 1.02);
      const biggest = d.imageSizes.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
      for (const im of d.imageSizes) {
        if (!im.rect) continue;
        const over = im.w > d.page1W * 1.02;
        const what = im.mask ? "logo/stencil" : "image";
        mark(im.page, im.rect, over ? "warn" : "info",
          over ? `${what} ${im.w}px — wider than page` : `${what} ${im.w}×${im.h}px`, "device1");
      }
      if (bleed.length)
        O(chk("Bleed / oversized images", "warn", 0, "p13 · avoid horizontal scroll",
          `${bleed.length} image(s) are painted wider than the page (up to ${Math.max(...bleed.map((b) => b.w))}px vs ${Math.round(d.page1W)}px page) — this can force horizontal scrolling on mobile.`));
      else
        O(chk("Image sizing", "pass", 0, "p3 · optimized dimensions",
          `Largest image is painted at ${biggest.w}×${biggest.h}px, within the ${Math.round(d.page1W)}px page width.`));

      /* ---- "Don't upload high-resolution images if they are displayed smaller" (p3).
              Measured exactly: the asset's real pixels vs the size it is painted. ---- */
      const sized = d.imageSizes.filter((im) => im.srcW && im.w > 0);
      const over = sized.filter((im) => im.srcW / im.w > T.imageOversampleMax);
      for (const im of over)
        mark(im.page, im.rect, "warn",
          `${im.srcW}×${im.srcH}px asset shown at ${im.w}×${im.h}px — ${fmt1(im.srcW / im.w)}× oversampled`,
          "device1");
      if (sized.length) {
        if (over.length)
          S(chk("Image resolution vs display size", "warn", 1, "p3 · optimized dimensions",
            `${over.length} of ${sized.length} image(s) carry far more pixels than they display ` +
            `(over ${T.imageOversampleMax}×). 2× is legitimate retina; beyond that the extra bytes ` +
            `slow the load for no visible gain.`,
            over.slice(0, 3).map((im) => `<span class="evi">${im.srcW}×${im.srcH}</span> shown at ` +
              `<span class="evi">${im.w}×${im.h}</span> (p${im.page}) — ${fmt1(im.srcW / im.w)}×`)));
        else
          S(chk("Image resolution vs display size", "pass", 1, "p3 · optimized dimensions",
            `${sized.length} image(s) are sized appropriately for how they're displayed (≤ ${T.imageOversampleMax}×).`));
      }
    }

    /* ---- Non-codeable structure the handbook calls out (p11) ----
       Now that logos, icons and vector art are located, two of these stop being
       "manual" and become measurable geometry. ---- */
    const boxes = [];
    for (const im of d.imageSizes || []) if (im.rect) boxes.push({ page: im.page, rect: im.rect, what: im.mask ? "logo" : "image" });
    for (const g of art) boxes.push({ page: g.page, rect: g.rect, what: g.kind });

    // "Text with logo on same line (RewardXcelerator)" — non-codeable.
    const sameLine = [];
    for (const b of d.blocks) {
      if (!isSubstantive(b)) continue;
      const ty0 = Math.min(b.y, b.lastY) - b.size * 0.35, ty1 = Math.max(b.y, b.lastY) + b.size * 0.95;
      for (const g of boxes) {
        if (g.page !== b.page || !/logo|icon/.test(g.what)) continue;
        const [gx0, gy0, gx1, gy1] =
          devToPdf(g.rect, (d.pageSizes[b.page] || { h: d.page1H }).h);
        const vOverlap = Math.min(ty1, gy1) - Math.max(ty0, gy0);
        const hGap = Math.max(gx0 - b.maxX, b.minX - gx1);
        if (vOverlap > Math.min(ty1 - ty0, gy1 - gy0) * 0.5 && hGap > -2 && hGap < b.size * 4) {
          sameLine.push({ b, g }); break;
        }
      }
    }
    if (sameLine.length)
      O(chk("Text + logo on one line", "warn", 0, "p11 · non-codeable",
        `${sameLine.length} place(s) put live text and a logo/icon side by side on the same line. ` +
        `The handbook calls this out as non-codeable — it usually forces the whole row to be ` +
        `exported as an image, which then breaks dark mode.`,
        sameLine.slice(0, 3).map((x) => `“${escapeHtml(trim(x.b.text, 40))}” beside a ${x.g.what} (p${x.b.page})`)));

    // "Overlapping shapes" — non-codeable.
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.page !== b.page) continue;
        const ov = Math.max(0, Math.min(a.rect[2], b.rect[2]) - Math.max(a.rect[0], b.rect[0])) *
                   Math.max(0, Math.min(a.rect[3], b.rect[3]) - Math.max(a.rect[1], b.rect[1]));
        const smaller = Math.min((a.rect[2] - a.rect[0]) * (a.rect[3] - a.rect[1]),
                                 (b.rect[2] - b.rect[0]) * (b.rect[3] - b.rect[1]));
        if (smaller > 0 && ov / smaller > 0.25) overlaps.push({ a, b, pct: Math.round(ov / smaller * 100) });
      }
    if (overlaps.length)
      O(chk("Overlapping shapes", "warn", 0, "p11 · non-codeable",
        `${overlaps.length} pair(s) of graphics overlap. Overlapping shapes can't be coded ` +
        `responsively and are usually flattened into an image.`,
        overlaps.slice(0, 3).map((o) => `${o.a.what} over ${o.b.what} — ${o.pct}% covered (p${o.a.page})`)));

    /* ---- Section spacing (rough, from block positions) ---- */
    const sp = measureSpacing(d.blocks);
    if (sp.pairs >= 4 && sp.tight >= 3)
      O(chk("Section spacing", "warn", 0, "p5 · ≥15px between elements",
        `${sp.tight} of ${sp.pairs} adjacent block-gaps sit under 15px — parts of the layout may feel cramped. (Rough estimate from text positions.)`));
    else if (sp.pairs >= 4)
      O(chk("Section spacing", "pass", 0, "p5 · ≥15px between elements",
        `Block spacing generally holds ≥15px (${sp.pairs} gaps measured).`));

    /* ---- score over scored checks only ---- */
    let got = 0, total = 0;
    for (const c of scored) {
      total += c.weight;
      got += c.weight * (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0);
    }
    const score = total ? Math.round((got / total) * 100) : 0;

    return {
      score, scored, obs, geo: g, marks: dedupeMarks(marks), pdf: d.pdf, data: d, bodySize, ctas,
      // Structure only — sizes, positions and operator counts. No text, no image data.
      diag: {
        pages: d.numPages, pageW: Math.round(d.page1W), pageH: Math.round(d.page1H),
        textBlocks: d.blocks.length, images: d.imageCount,
        stencils: d.imageSizes.filter((i) => i.mask).length,
        vectorGraphics: (d.graphics || []).length,
        // Images below 1px are spacers/tracking pixels and are skipped on purpose;
        // listing them explains any gap between the paint-op count and `images`.
        skippedTinyImages: d.tinyImages,
        // Where each non-text element landed, so a missing box can be traced to
        // "never found" vs "found but mispositioned" without sharing the PDF.
        imageBoxes: d.imageSizes.map((i) => ({
          p: i.page, x: Math.round(i.rect[0]), y: Math.round(i.rect[1]),
          w: i.w, h: i.h, src: i.srcW ? `${i.srcW}x${i.srcH}` : null, mask: !!i.mask
        })).slice(0, 60),
        vectorBoxes: (d.graphics || []).map((g) => ({
          p: g.page, x: Math.round(g.rect[0]), y: Math.round(g.rect[1]),
          w: g.w, h: g.h, kind: g.kind, paths: g.paths
        })).slice(0, 60),
        // Text blocks as geometry only — size and position, never the words.
        textBoxes: d.blocks.map((b) => ({
          p: b.page, x: Math.round(b.minX), y: Math.round(b.y),
          px: fmt1(b.size), chars: b.chars, lines: b.lines
        })).slice(0, 80),
        ops: d.opCounts
      },
      counts: {
        pass: scored.filter((c) => c.status === "pass").length,
        warn: scored.filter((c) => c.status === "warn").length,
        fail: scored.filter((c) => c.status === "fail").length
      },
      stats: { pages: d.numPages, chars: d.totalChars, images: d.imageCount,
               fonts: d.fonts, bodySize, lineHeight: lh, pageW: Math.round(d.page1W), pageH: Math.round(d.page1H) }
    };
  }

  const chk = (title, status, weight, rule, detail, bullets) =>
    ({ title, status, weight, rule, detail, bullets: bullets || null });

  /* One box per region: several rules can flag the same run (e.g. "under 12px" and
     "fine print"), so keep the worst status and merge the labels into it. */
  function dedupeMarks(marks) {
    const rank = { fail: 0, warn: 1, pass: 2, info: 3 };
    const byKey = new Map();
    for (const m of marks) {
      const key = m.page + ":" + m.space + ":" + m.rect.map((v) => Math.round(v)).join(",");
      const prev = byKey.get(key);
      if (!prev) { byKey.set(key, { ...m }); continue; }
      if (!prev.label.split(" · ").includes(m.label)) prev.label += " · " + m.label;
      if (rank[m.kind] < rank[prev.kind]) prev.kind = m.kind;
    }
    return Array.from(byKey.values());
  }

  /* ---------- geometry helpers for preview boxes (PDF user space, y up from baseline) ---------- */
  const blockRect = (b) => [b.minX, Math.min(b.y, b.lastY) - b.size * 0.35,
                            Math.max(b.maxX, b.minX + b.size), Math.max(b.y, b.lastY) + b.size * 0.95];

  // Leading for one block, from its own first→last baseline span. Returns null when the
  // block is a single line or the span is implausible (wrapped columns, stray positioning).
  function blockLineHeight(b) {
    if (b.lines < 2 || !b.size) return null;
    const ratio = (Math.abs(b.y - b.lastY) / (b.lines - 1)) / b.size;
    return ratio > 0.8 && ratio < 3 ? Math.round(ratio * 100) / 100 : null;
  }

  /* ---------- heuristics ---------- */
  // The "No images? View this online" link every mailer opens with. It is not a
  // CTA and not the preheader, and it trips both checks if left unrecognised.
  const isViewOnline = (text) =>
    /(no images|can'?t (see|view)|having trouble|trouble viewing|view (it |this )?(online|in browser)|view in browser|open in browser|web version)/i
      .test(text.trim());

  function isCtaLike(text) {
    const t = text.trim();
    if (t.length > 40 || t.length < 2) return false;
    if (/[.!?:]$/.test(t)) return false;
    if (wordCount(t) > 6) return false;
    if (isViewOnline(t)) return false;
    return RB.ctaVerbs.test(t);
  }
  function isTitleCase(text) {
    const small = new Set(["a","an","and","the","or","for","to","of","in","on","with","at","by","from"]);
    const words = text.replace(RB.ctaTrailingGlyphs, "").trim().split(/\s+/).filter(Boolean);
    let significant = 0, capped = 0;
    words.forEach((w, i) => {
      const bare = w.replace(/[^A-Za-z].*$/, "");
      if (!bare) return;
      if (i !== 0 && small.has(bare.toLowerCase())) return;
      significant++;
      if (/^[A-Z0-9]/.test(bare)) capped++;
    });
    return significant === 0 ? true : capped / significant >= 0.7;
  }
  const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  // Symbol-only runs (®, ™, ©, *, †, superscript digits, bullets) — exclude from the min-font fail.
  // A real design element, as opposed to a stray glyph or a lone character left
  // over from how the PDF happened to be drawn.
  const isSubstantive = (b) => b.chars >= 2 && !isMarkGlyph(b.text);
  const isMarkGlyph = (t) => {
    const s = t.trim();
    return /^[®™©*†‡·•\-–—°'"¹²³⁰⁴⁵⁶⁷⁸⁹\s]+$/.test(s)   // symbol-only runs
      || (s.length <= 2 && /[®™©*†‡¹²³]/.test(s))          // short runs containing a mark glyph
      || /^\d{1,2}$/.test(s)                               // footnote markers ("1", "12")
      || /^(TM|SM|R)$/.test(s);                            // literal trademark superscripts
  };
  // The size carrying the most characters, ignoring heading-sized runs so a big hero
  // headline can't outweigh the copy underneath it.
  function dominantSize(items) {
    const chars = {};
    for (const i of items) {
      if (!(i.size > 0)) continue;
      const s = Math.round(i.size);
      chars[s] = (chars[s] || 0) + i.text.length;
    }
    const keys = Object.keys(chars);
    if (!keys.length) return 0;
    const body = keys.filter((s) => Number(s) < T.headingMinPx);
    const pool = body.length ? body : keys;
    return Number(pool.reduce((a, b) => (chars[b] > chars[a] ? b : a)));
  }
  function uniqBySize(items) {
    const seen = new Set(), out = [];
    for (const it of items) if (!seen.has(it.size)) { seen.add(it.size); out.push(it); }
    return out.sort((a, b) => a.size - b.size);
  }

  /* ---------- rendering ---------- */
  /* opts: scroll, onAgain (show "Check another PDF"), slot (empty .report-slot after the
     preview for the host page), onVision(marks, res) when an AI pass finishes, and
     vision {marks, res} to re-apply a pass that was run earlier. */
  function renderReport(r, file, reportEl, opts) {
    opts = opts || {};
    const verdict =
      r.score >= 85 ? "Strong — ready with only minor tweaks." :
      r.score >= 65 ? "Good, but several items need attention." :
      r.score >= 40 ? "Needs work before this is mobile-ready." :
                      "Significant guardrail issues to resolve.";
    const circ = 2 * Math.PI * 56;
    const offset = circ * (1 - r.score / 100);
    const barColor = r.score >= 85 ? "#12855b" : r.score >= 65 ? "#006fcf" : r.score >= 40 ? "#b7791f" : "#c62828";

    const banner = r.geo.note
      ? `<div class="banner">⚠ ${escapeHtml(r.geo.note)}</div>` : "";

    const nMarks = { fail: 0, warn: 0, info: 0, pass: 0 };
    for (const m of r.marks) nMarks[m.kind] = (nMarks[m.kind] || 0) + 1;

    const manualItems = RB.coverage.filter((c) => c.mode === "manual")
      .map((c) => `<li><strong>${escapeHtml(c.cat)}</strong> (${c.page}): ${escapeHtml(c.rule)}</li>`).join("");

    reportEl.innerHTML = `
      ${banner}
      ${opts.compact ? "" : `
      <div class="score-card">
        <div class="gauge">
          <svg width="128" height="128" viewBox="0 0 128 128">
            <circle class="track" cx="64" cy="64" r="56" fill="none" stroke-width="12"/>
            <circle class="bar" cx="64" cy="64" r="56" fill="none" stroke-width="12"
              stroke="${barColor}" stroke-dasharray="${circ}" stroke-dashoffset="${circ}"/>
          </svg>
          <div class="label"><b style="color:${barColor}">${r.score}%</b><span>accurate</span></div>
        </div>
        <div class="score-meta">
          <h2>Compliance score</h2>
          <p class="score-verdict">${verdict}</p>
          <div class="score-tallies">
            <span class="pill pass">✓ ${r.counts.pass} passed</span>
            <span class="pill warn">! ${r.counts.warn} to fix</span>
            <span class="pill fail">✕ ${r.counts.fail} failed</span>
          </div>
          <p class="score-note">Score reflects only automatically-measurable rules. Observations &amp; manual items below are not scored.</p>
          <p class="score-verdict stats-line">
            ${r.stats.pages} page(s) · ${r.stats.pageW}×${r.stats.pageH}px ·
            ${r.stats.chars} chars live text · ${r.stats.images} image(s) ·
            body ≈ ${r.stats.bodySize || "?"}px ·
            line-height ${r.stats.lineHeight != null ? r.stats.lineHeight + "×" : "n/a"} ·
            ${r.stats.fonts.length} font(s)
          </p>
        </div>
      </div>
      `}

      ${opts.slot ? '<div class="review-split"><div class="report-slot"></div><div class="pv-side">' : ""}
      <h3 class="section-title">Preview — what was detected</h3>
      <div class="preview" id="preview">
        <div class="pv-legend">
          <button type="button" class="pv-key fail" data-kind="fail">✕ Errors <b>${nMarks.fail}</b></button>
          <button type="button" class="pv-key warn" data-kind="warn">! To fix <b>${nMarks.warn}</b></button>
          <button type="button" class="pv-key pass" data-kind="pass">✓ Passed <b>${nMarks.pass}</b></button>
          <button type="button" class="pv-key info" data-kind="info">◻ Detected <b>${nMarks.info}</b></button>
          <button type="button" class="pv-key ai" data-kind="ai" hidden>✦ AI vision <b>0</b></button>
          <span class="pv-hint">Click a key to show/hide those boxes · hover a box for the reason</span>
        </div>
        <div class="pv-ai" id="pvAi" hidden>
          <button type="button" class="btn ghost" id="visionBtn">✦ Run AI vision pass</button>
          <span class="pv-ai-note">Reads the rendered pages to catch what measurement can't —
            text baked into images, dark-mode contrast, shadows, unstackable modules.
            <strong>This sends your pages to Anthropic.</strong></span>
        </div>
        <div class="pv-pages" id="pvPages"><span class="pv-loading"><span class="spinner"></span>Rendering pages…</span></div>
      </div>
      ${opts.slot ? '</div></div>' : ""}
      ${opts.compact ? `<details class="card hb-details">
        <summary><span>Handbook measurements</span><small>${r.counts.pass} passed · ${r.counts.warn} to fix · ${r.counts.fail} failed — mobile handbook score ${r.score}%</small></summary>
        ${sortChecks(r.scored).map(renderCheck).join("") || '<p class="empty">No scorable checks for this file.</p>'}
        ${r.obs.length ? `<h4 class="section-title">Observations — heuristic, review by eye</h4>${sortChecks(r.obs).map(renderCheck).join("")}` : ""}
      </details>` : `
      <h3 class="section-title">Scored findings</h3>
      ${sortChecks(r.scored).map(renderCheck).join("") || '<p class="empty">No scorable checks for this file.</p>'}

      ${r.obs.length ? `<h3 class="section-title">Observations — heuristic, review by eye</h3>
        ${sortChecks(r.obs).map(renderCheck).join("")}` : ""}
      `}
      ${opts.compact ? "" : `
      <h3 class="section-title">Manual review — not machine-checkable from a PDF</h3>
      <div class="check info">
        <div class="check-head"><span class="check-badge">manual</span>
          <span class="check-title">Confirm these against the handbook by hand</span></div>
        <div class="check-detail"><ul>${manualItems}</ul></div>
      </div>

      <details class="diag">
        <summary>Diagnostics — how this PDF is drawn</summary>
        <p class="diag-note">Operator names and counts only — no text, no image data, nothing
          from your content. Useful when something on the page isn't being detected.</p>
        <button class="btn ghost" id="diagCopy">Copy diagnostics</button>
        <pre id="diagText">${escapeHtml(JSON.stringify(r.diag, null, 1))}</pre>
      </details>

      <div class="report-actions">
        <button class="btn" id="printBtn">Save / print report</button>
        ${opts.onAgain ? '<button class="btn ghost" id="againBtn">Check another PDF</button>' : ""}
      </div>
      `}
    `;
    const q = (s) => reportEl.querySelector(s);
    reportEl.hidden = false;
    if (q(".bar")) requestAnimationFrame(() => { q(".bar").style.strokeDashoffset = offset; });
    if (opts.scroll) reportEl.scrollIntoView({ behavior: "smooth", block: "start" });

    if (q("#diagCopy")) q("#diagCopy").addEventListener("click", (e) => {
      navigator.clipboard.writeText(q("#diagText").textContent).then(() => {
        e.target.textContent = "Copied ✓";
        setTimeout(() => { e.target.textContent = "Copy diagnostics"; }, 1500);
      }).catch(() => { e.target.textContent = "Select the text below and copy"; });
    });

    if (q("#printBtn")) q("#printBtn").addEventListener("click", () => window.print());
    if (opts.onAgain) q("#againBtn").addEventListener("click", opts.onAgain);

    const preview = q("#preview");
    preview.querySelectorAll(".pv-key").forEach((btn) => {
      btn.addEventListener("click", () => {
        const off = preview.classList.toggle("hide-" + btn.dataset.kind);
        btn.classList.toggle("off", off);
      });
    });
    const rendered = renderPreview(q("#pvPages"), r.pdf, r.marks, opts.previewMax).catch((err) => {
      console.error(err);
      q("#pvPages").innerHTML = '<p class="empty">Could not render a preview of this PDF.</p>';
    });

    if (opts.vision && opts.vision.marks) {
      // A pass already ran on this file — redraw it instead of offering it again.
      rendered.then(() => addVisionMarks(opts.vision.marks, opts.vision.res));
      return;
    }
    // The vision pass only appears when a server is actually holding a working key.
    visionReady.then((ok) => {
      if (!ok) return;
      q("#pvAi").hidden = false;
      q("#visionBtn").addEventListener("click", () => runVision(r, opts.onVision), { once: true });
    });
  }

  /* ---------- optional AI vision pass ---------- */
  // Rendered pages go to Anthropic via our own server, which holds the key.
  // Findings are never scored — they're heuristic, like the other observations.
  async function runVision(r, onVision) {
    const btn = $("#visionBtn"), note = $(".pv-ai-note");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Reading pages…';
    try {
      const pages = await renderPagesForVision(r.pdf);
      note.textContent = `Sending ${pages.length} page(s) to Claude…`;
      const res = await withTimeout(
        fetch("/api/vision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pages })
        }).then(async (x) => {
          const body = await x.json();
          if (!x.ok) throw new Error(body.error || `HTTP ${x.status}`);
          return body;
        }), 300000, "The vision pass timed out.");

      const marks = res.findings.map((f) => ({
        page: f.page, kind: f.severity, space: "image",
        rect: f.box, imgW: f.imgW, imgH: f.imgH, ai: true,
        label: `✦ ${f.label}`, detail: f.explanation, rule: f.rule
      }));
      addVisionMarks(marks, res);
      if (onVision) onVision(marks, res);
    } catch (err) {
      console.error(err);
      btn.hidden = true;
      note.innerHTML = `<span class="pv-ai-err">Vision pass failed: ${escapeHtml(err.message)}</span>`;
    }
  }

  // Render each page big enough for Claude to read, but under the 2576px limit.
  async function renderPagesForVision(pdf) {
    const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(1800 / Math.max(base.width, base.height), 3);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";                       // flatten transparency to white
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      out.push({ page: p, pages: pdf.numPages, w: canvas.width, h: canvas.height,
                 known: knownBoxesFor(p, canvas.width),
                 png: canvas.toDataURL("image/png").split(",")[1] });
    }
    return out;
  }

  // What the exact layer already found, expressed in the pixels of the image we're
  // about to send — so Claude can complement it instead of re-reporting it. Read
  // straight off the rendered overlay, which sidesteps converting between the
  // PDF, device and image coordinate spaces a third time.
  function knownBoxesFor(pageNum, imgW) {
    const wrap = $("#preview").querySelectorAll(".pv-page")[pageNum - 1];
    if (!wrap) return [];
    const cv = wrap.querySelector("canvas");
    if (!cv || !cv.clientWidth) return [];
    const k = imgW / cv.clientWidth;
    return Array.from(wrap.querySelectorAll(".pv-mark:not(.ai)")).map((el) => {
      const tag = el.querySelector(".pv-tag");
      return {
        label: tag ? tag.textContent.slice(0, 70) : "element",
        box: [el.offsetLeft, el.offsetTop, el.offsetLeft + el.offsetWidth,
              el.offsetTop + el.offsetHeight].map((v) => Math.round(v * k))
      };
    });
  }

  function addVisionMarks(marks, res) {
    const preview = $("#preview");
    session.visionMarks = marks;

    const key = preview.querySelector('.pv-key[data-kind="ai"]');
    key.hidden = false;
    key.querySelector("b").textContent = marks.length;

    for (const m of marks) {
      const wrap = preview.querySelectorAll(".pv-page")[m.page - 1];
      if (!wrap) continue;
      // Box coords are pixels of the image we sent — rescale to the rendered page.
      const k = wrap.querySelector("canvas").clientWidth / m.imgW;
      const [x0, y0, x1, y1] = m.rect;
      const el = document.createElement("div");
      el.className = `pv-mark ai ${m.kind}`;
      el.style.left = Math.min(x0, x1) * k + "px";
      el.style.top = Math.min(y0, y1) * k + "px";
      el.style.width = Math.abs(x1 - x0) * k + "px";
      el.style.height = Math.abs(y1 - y0) * k + "px";
      const tag = document.createElement("span");
      tag.className = "pv-tag";
      tag.textContent = m.label;
      el.appendChild(tag);
      el.title = `${m.rule} — ${m.detail}`;
      wrap.appendChild(el);
    }

    const counts = { fail: 0, warn: 0, info: 0 };
    for (const m of marks) counts[m.kind]++;
    const skipped = res.pagesSkipped
      ? ` <strong>${res.pagesSkipped} page(s) were not analysed</strong> (${res.pagesAnalysed}-page cap).` : "";
    $("#pvAi").hidden = false;
    $("#pvAi").innerHTML =
      `<span class="pv-ai-done">✦ ${res.model} read ${res.pagesAnalysed} page(s) and found
        ${marks.length} item(s) — ${counts.fail} error, ${counts.warn} to fix, ${counts.info} noted.
        Hover a ✦ box for the reason. Not scored — review by eye.${skipped}</span>`;

    if (marks.length) renderVisionList(marks);
  }

  function renderVisionList(marks) {
    const order = { fail: 0, warn: 1, info: 2 };
    const rows = [...marks].sort((a, b) => order[a.kind] - order[b.kind]).map((m) => `
      <div class="check ${m.kind}">
        <div class="check-head">
          <span class="check-badge">${m.kind === "fail" ? "ai error" : m.kind === "warn" ? "ai review" : "ai note"}</span>
          <span class="check-title">${escapeHtml(m.label.replace(/^✦ /, ""))}</span>
          <span class="check-rule">p${m.page} · ${escapeHtml(m.rule)}</span>
        </div>
        <div class="check-detail">${escapeHtml(m.detail)}</div>
      </div>`).join("");
    const sec = document.createElement("div");
    sec.innerHTML = `<h3 class="section-title">AI vision — read from the rendered page, not scored</h3>${rows}`;
    $("#preview").insertAdjacentElement("afterend", sec);
  }

  /* ---------- page preview with detection overlay ---------- */
  async function renderPreview(container, pdf, marks, cap) {
    cap = cap || 560;
    const maxW = Math.min(container.clientWidth || cap, cap);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const frag = document.createDocumentFragment();

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(maxW / base.width, 1.5);
      const vp = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width * ratio);
      canvas.height = Math.round(vp.height * ratio);
      canvas.style.width = vp.width + "px";
      canvas.style.height = vp.height + "px";
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp,
        transform: [ratio, 0, 0, ratio, 0, 0] }).promise;

      const wrap = document.createElement("div");
      wrap.className = "pv-page";
      wrap.style.width = vp.width + "px";
      wrap.appendChild(canvas);

      for (const m of marks.filter((m) => m.page === p)) {
        // "pdf" marks need the viewport transform; "device1" marks are already in
        // scale-1 device space, so they only need the render scale applied.
        const [a, b] = m.space === "device1"
          ? [[m.rect[0] * scale, m.rect[1] * scale], [m.rect[2] * scale, m.rect[3] * scale]]
          : [pdfjsLib.Util.applyTransform([m.rect[0], m.rect[1]], vp.transform),
             pdfjsLib.Util.applyTransform([m.rect[2], m.rect[3]], vp.transform)];
        const left = Math.min(a[0], b[0]), top = Math.min(a[1], b[1]);
        const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
        if (w < 1 || h < 1) continue;

        const el = document.createElement("div");
        el.className = "pv-mark " + m.kind;
        if (m.item) el.dataset.item = m.item;
        el.style.left = (left - 2) + "px";
        el.style.top = (top - 2) + "px";
        el.style.width = (w + 4) + "px";
        el.style.height = (h + 4) + "px";
        // Merged labels can run to 70+ characters, which no position on the page can
        // fit. Show a readable stub and keep the full text on hover.
        const short = trim(m.label, 46);
        el.title = m.label;

        // Tag sits right of the box; flips left if that overflows. A box spanning
        // nearly the full width has room on neither side — drop the tag below it,
        // nudged left so it can't run off the page and get clipped away.
        const tagW = short.length * 5.8 + 16;
        const tag = document.createElement("span");
        tag.className = "pv-tag";
        tag.textContent = short;
        if (left + w + tagW > vp.width) {
          if (left - tagW >= 0) el.classList.add("tag-flip");
          else {
            el.classList.add("tag-below");
            tag.style.left = Math.min(0, vp.width - (left + tagW) - 4) + "px";
          }
        }
        el.appendChild(tag);
        wrap.appendChild(el);
      }

      const cap = document.createElement("span");
      cap.className = "pv-cap";
      cap.textContent = `Page ${p} of ${pdf.numPages}`;
      wrap.appendChild(cap);
      frag.appendChild(wrap);
    }

    container.innerHTML = "";
    container.appendChild(frag);
  }

  function renderCheck(c) {
    const badge = c.status === "pass" ? "pass" : c.status === "fail" ? "fail"
      : c.status === "info" ? "info" : "review";
    const bullets = c.bullets && c.bullets.length
      ? `<ul>${c.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>` : "";
    return `
      <div class="check ${c.status}">
        <div class="check-head">
          <span class="check-badge">${badge}</span>
          <span class="check-title">${escapeHtml(c.title)}</span>
          <span class="check-rule">${escapeHtml(c.rule)}</span>
        </div>
        <div class="check-detail">${c.detail}${bullets}</div>
      </div>`;
  }

  function sortChecks(checks) {
    const order = { fail: 0, warn: 1, info: 2, pass: 3 };
    return [...checks].sort((a, b) => order[a.status] - order[b.status] || b.weight - a.weight);
  }

  function renderCoverage(grid) {
    const cats = {};
    for (const c of RB.coverage) (cats[c.cat] = cats[c.cat] || []).push(c);
    const badge = (m) => m === "auto" ? '<span class="cov auto">auto</span>'
      : m === "obs" ? '<span class="cov obs">heuristic</span>'
      : m === "principle" ? '<span class="cov principle">guidance</span>'
      : m === "ai" ? '<span class="cov ai">ai vision</span>'
      : '<span class="cov manual">manual</span>';
    grid.innerHTML = Object.keys(cats).map((cat) => `
      <div class="rule-card">
        <h3>${escapeHtml(cat)}</h3>
        <ul>${cats[cat].map((c) => `<li>${badge(c.mode)} ${escapeHtml(c.rule)}</li>`).join("")}</ul>
      </div>`).join("");
  }

  /* ---------- utils ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }
  const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const fmt1 = (n) => (Math.round(n * 10) / 10);
  function fmtBytes(b) {
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
    return (b / 1024 / 1024).toFixed(2) + " MB";
  }

  window.EmailerEngine = {
    RB, analyseFile, renderReport, renderCoverage, renderPagesForVision, blockRect,
    aiStatus, escapeHtml, trim, fmtBytes, isTitleCase, isCtaLike, isViewOnline,
    isMarkGlyph, isSubstantive
  };

  if (!window.EMAILER_EMBED) initStandalone();
})();
