/* Brief reading for Emailer Studio — text extraction for every common brief format,
   a local summary, checkable requirements, and matching those against a mailer.
   Everything here runs in the browser; the optional AI layer lives on the server. */
window.BriefReader = (() => {
  "use strict";

  const EXT = {
    pdf: "pdf", docx: "docx", docm: "docx", dotx: "docx", xlsx: "xlsx", xlsm: "xlsx",
    pptx: "pptx", txt: "text", md: "text", csv: "text", tsv: "text", json: "text",
    html: "html", htm: "html", rtf: "rtf", eml: "text", doc: "legacy", xls: "legacy",
    ppt: "legacy", msg: "legacy", odt: "odt", png: "image", jpg: "image", jpeg: "image",
    webp: "image", gif: "image"
  };
  const ACCEPT = Object.keys(EXT).map((e) => "." + e).join(",");
  const kindOf = (name) => EXT[(name.split(".").pop() || "").toLowerCase()] || "unknown";

  /* ---------- zip (docx / xlsx / pptx are zip archives of XML) ---------- */
  async function unzip(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--)
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("This file is not a valid Office document (no zip directory).");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = {};
    for (let k = 0; k < count && dv.getUint32(p, true) === 0x02014b50; k++) {
      const nameLen = dv.getUint16(p + 28, true);
      entries[new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen))] = {
        method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true),
        local: dv.getUint32(p + 42, true)
      };
      p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    return {
      names: Object.keys(entries),
      async text(name) {
        const e = entries[name];
        if (!e) return null;
        const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
        const raw = new Uint8Array(buf, start, e.size);
        if (e.method === 0) return new TextDecoder().decode(raw);
        if (e.method !== 8) throw new Error("Unsupported compression inside the document.");
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new TextDecoder().decode(await new Response(stream).arrayBuffer());
      }
    };
  }

  const xml = (s) => new DOMParser().parseFromString(s, "application/xml");
  const kids = (n, local) => Array.from(n.childNodes).filter((c) => c.nodeType === 1 && (!local || c.localName === local));

  /* ---------- per-format readers → { text, rows, sheets?, note? } ---------- */
  function wordParagraph(p) {
    let s = "";
    const walk = (n) => {
      for (const c of kids(n)) {
        const ln = c.localName;
        if (ln === "t") s += c.textContent;
        else if (ln === "tab") s += "\t";
        else if (ln === "br" || ln === "cr") s += "\n";
        else if (ln !== "del" && ln !== "instrText") walk(c);
      }
    };
    walk(p);
    return s;
  }

  async function readDocx(zip) {
    const doc = xml(await zip.text("word/document.xml") || "<x/>");
    const body = doc.getElementsByTagNameNS("*", "body")[0] || doc.documentElement;
    const rows = [];
    const block = (n) => {
      for (const c of kids(n)) {
        if (c.localName === "p") rows.push([wordParagraph(c)]);
        else if (c.localName === "tbl") {
          for (const tr of kids(c, "tr")) {
            rows.push(kids(tr, "tc").map((tc) =>
              Array.from(tc.getElementsByTagNameNS("*", "p")).map(wordParagraph).join(" / ").trim()));
          }
        } else if (/^(sdt|sdtContent|customXml|smartTag)$/.test(c.localName)) block(c);
      }
    };
    block(body);
    return { rows };
  }

  async function readPptx(zip) {
    const slides = zip.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]);
    const rows = [];
    for (const [i, name] of slides.entries()) {
      rows.push([`— Slide ${i + 1} —`]);
      const doc = xml(await zip.text(name));
      for (const p of doc.getElementsByTagNameNS("*", "p")) {
        const t = Array.from(p.getElementsByTagNameNS("*", "t")).map((x) => x.textContent).join("");
        if (t.trim()) rows.push([t]);
      }
    }
    return { rows };
  }

  // Excel stores dates as day counts from 1899-12-30; only convert where the label says date.
  const excelDate = (n) => new Date(Date.UTC(1899, 11, 30) + n * 86400000)
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  async function readXlsx(zip) {
    const shared = [];
    const ss = await zip.text("xl/sharedStrings.xml");
    if (ss) for (const si of xml(ss).getElementsByTagNameNS("*", "si"))
      shared.push(Array.from(si.getElementsByTagNameNS("*", "t")).map((t) => t.textContent).join(""));

    const wb = xml(await zip.text("xl/workbook.xml") || "<x/>");
    const relsDoc = xml(await zip.text("xl/_rels/workbook.xml.rels") || "<x/>");
    const rels = {};
    for (const r of relsDoc.getElementsByTagNameNS("*", "Relationship"))
      rels[r.getAttribute("Id")] = r.getAttribute("Target");

    const sheets = [];
    for (const s of wb.getElementsByTagNameNS("*", "sheet")) {
      const rid = s.getAttribute("r:id") ||
        Array.from(s.attributes).find((a) => a.localName === "id")?.value;
      let target = rels[rid] || "";
      target = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
      const sx = await zip.text(target);
      if (!sx) continue;
      const rows = [];
      for (const row of xml(sx).getElementsByTagNameNS("*", "row")) {
        const cells = [];
        for (const c of kids(row, "c")) {
          const t = c.getAttribute("t");
          const v = kids(c, "v")[0];
          let val = "";
          if (t === "s" && v) val = shared[+v.textContent] || "";
          else if (t === "inlineStr") val = Array.from(c.getElementsByTagNameNS("*", "t")).map((x) => x.textContent).join("");
          else if (t === "b" && v) val = v.textContent === "1" ? "Yes" : "No";
          else if (v) val = v.textContent;
          cells.push(val.trim());
        }
        const clean = cells.filter((x) => x && !isPlaceholder(x));
        if (!clean.length) continue;
        if (/date/i.test(clean[0]) && clean.length > 1 && /^\d{5}(\.\d+)?$/.test(clean[clean.length - 1]))
          clean[clean.length - 1] = excelDate(+clean[clean.length - 1]);
        rows.push(clean);
      }
      sheets.push({ name: s.getAttribute("name") || `Sheet ${sheets.length + 1}`, rows });
    }
    return { sheets };
  }

  async function readPdf(buf) {
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const rows = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const items = (await (await pdf.getPage(p)).getTextContent()).items.filter((i) => i.str);
      items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
      let line = [], y = null;
      const flush = () => {
        if (line.length) rows.push([line.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(" ").replace(/\s+/g, " ").trim()]);
        line = [];
      };
      for (const it of items) {
        if (y !== null && Math.abs(it.transform[5] - y) > Math.max(2, (it.height || 10) * 0.5)) flush();
        line.push(it);
        y = it.transform[5];
      }
      flush();
    }
    return { rows };
  }

  function htmlToRows(s) {
    const doc = new DOMParser().parseFromString(s, "text/html");
    doc.querySelectorAll("script,style").forEach((n) => n.remove());
    return (doc.body ? doc.body.innerText || doc.body.textContent : "").split(/\n/).map((l) => [l]);
  }

  function rtfToRows(s) {
    const text = s.replace(/\{\\\*[^{}]*\}/g, "").replace(/\\par[d]?/g, "\n")
      .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "");
    return text.split(/\n/).map((l) => [l]);
  }

  // Old binary Office files: pull out runs of readable text. Approximate by nature.
  function scrapeLegacy(buf) {
    const b = new Uint8Array(buf);
    const runs = (wide) => {
      const out = [];
      let cur = "";
      const step = wide ? 2 : 1;
      for (let i = 0; i + step - 1 < b.length; i += step) {
        const ch = b[i], hi = wide ? b[i + 1] : 0;
        if (hi === 0 && (ch === 9 || ch === 13 || (ch >= 32 && ch < 127) || ch === 0xa0)) cur += ch === 13 ? "\n" : String.fromCharCode(ch);
        else { if (cur.trim().length >= 6) out.push(cur); cur = ""; }
      }
      if (cur.trim().length >= 6) out.push(cur);
      return out.join("\n");
    };
    const a = runs(true), c = runs(false);
    const letters = (s) => (s.match(/[A-Za-z]/g) || []).length;
    const best = letters(a) > letters(c) * 0.6 ? a : c;
    return best.split(/\n/).filter((l) => (l.match(/[A-Za-z]{3,}/g) || []).length >= 2).map((l) => [l.trim()]);
  }

  async function read(file) {
    const kind = kindOf(file.name);
    const buf = await file.arrayBuffer();
    let out = { rows: [] }, note = "";
    try {
      if (kind === "pdf") out = await readPdf(buf);
      else if (kind === "docx") out = await readDocx(await unzip(buf));
      else if (kind === "xlsx") out = await readXlsx(await unzip(buf));
      else if (kind === "pptx") out = await readPptx(await unzip(buf));
      else if (kind === "odt") {
        const z = await unzip(buf);
        out = { rows: htmlToRows((await z.text("content.xml") || "").replace(/<\/text:p>/g, "</text:p>\n")) };
      }
      else if (kind === "html") out = { rows: htmlToRows(await file.text()) };
      else if (kind === "rtf") out = { rows: rtfToRows(await file.text()) };
      else if (kind === "text") out = { rows: (await file.text()).split(/\r?\n/).map((l) => l.includes("\t") ? l.split("\t") : [l]) };
      else if (kind === "legacy") {
        out = { rows: scrapeLegacy(buf) };
        note = "Old Office format — text recovered approximately. Save it as .docx / .xlsx / .pptx for an exact read, or paste the text.";
      }
      else if (kind === "image") note = "Image brief — use ✦ AI summary to read it, or paste the text.";
      else note = "Unrecognised format — stored as-is. Paste the brief text to check it against mailers.";
    } catch (err) {
      console.error(err);
      note = "Could not read this file: " + err.message + " — it is stored; paste the text to use it.";
    }
    const result = { kind, note, sheets: out.sheets || null, rows: (out.rows || []).map(cleanRow).filter((r) => r.length) };
    if (result.sheets) result.sheets.forEach((s) => (s.use = false));
    if (result.sheets) pickSheets(file.name, result.sheets);
    return result;
  }

  // Keep line breaks inside a cell — a brief's bullet lists live in them.
  const cleanRow = (cells) => cells.map((c) => String(c).replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n").trim()).filter(Boolean);

  // A workbook often carries several campaigns. Use the sheet whose name best matches
  // the file name; if nothing stands out, use every sheet that looks like a brief.
  function pickSheets(fileName, sheets) {
    const words = (s) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0 && !/^(the|and|brief|sheet|ia|xlsx|xls)$/.test(w)));
    const fw = words(fileName);
    const scored = sheets.map((s) => ({ s, score: [...words(s.name)].filter((w) => fw.has(w)).length }));
    const best = Math.max(0, ...scored.map((x) => x.score));
    const top = scored.filter((x) => x.score === best);
    if (best >= 2 && top.length === 1) { top[0].s.use = true; return; }
    // Otherwise: sheets that are actually briefs (not dropdown lists), and of those the
    // one with the newest brief date — workbooks pile up old campaigns.
    const briefy = sheets.filter((s) => s.rows.some((r) => /brief name|cta|primary message|what is the offer/i.test(r.join(" "))));
    const dated = briefy.map((s) => {
      const row = s.rows.find((r) => /brief date/i.test(r[0]) && r.length > 1);
      const t = row ? Date.parse(row[row.length - 1]) : NaN;
      return { s, t };
    }).filter((x) => !isNaN(x.t)).sort((a, z) => z.t - a.t);
    if (dated.length) dated[0].s.use = true;
    else if (briefy.length) briefy.forEach((s) => (s.use = true));
    else if (sheets.length) sheets.reduce((a, z) => (z.rows.length > a.rows.length ? z : a)).use = true;
  }

  /* ---------- turning rows into something useful ---------- */
  const isPlaceholder = (v) => /^(<[^>]*>|please insert.*|please don.?t change.*|choose from.*|tbd|na|n\/a|nil|none|-+|minimum cells.*)$/i.test(String(v).trim());
  const ADMIN = /(brief (name|date|type)|campaign owner|business (unit|objective)|^category|ecr date|html date|deployment date|distribution channel|social media|mobile app|interstitial|myca|dashboard alert|amex offers tile|relationship manager|account developer|gem copy|homepage banner|triggers|experiences app|budget|duration of days|mitc|sub-?category|targeted cards|information source|cardmember journey|visuals|basic information|mr story|to be filled|if it is an mr|what should the communication say)/i;

  function briefRows(brief) {
    if (brief.pasted) return brief.pasted.split(/\r?\n/).map((l) => cleanRow(l.split(/\t| \| /))).filter((r) => r.length);
    if (brief.sheets) return brief.sheets.filter((s) => s.use).flatMap((s) => [[`— ${s.name} —`], ...s.rows]);
    return brief.rows || [];
  }
  const briefText = (brief) => briefRows(brief).map((r) => r.join(" | ")).join("\n");

  function fieldsOf(rows) {
    const out = [];
    for (const r of rows) {
      if (r.length >= 2) out.push({ label: r.slice(0, -1).join(" › "), value: r[r.length - 1] });
      else {
        const m = r[0].match(/^([A-Za-z][^:]{1,48}):\s+(.{2,})$/);
        if (m) out.push({ label: m[1].trim(), value: m[2].trim() });
      }
    }
    return out.filter((f) => !isPlaceholder(f.value));
  }

  const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
  const DATE_RE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})\\.?,?(?:\\s+(\\d{4}))?|\\b(${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?`, "gi");
  const ABBR = /\b(Rs|INR|Mr|Mrs|Ms|Dr|St|No|vs|etc|approx|incl|e\.g|i\.e)\.\s/gi;
  const sentences = (s) => s.replace(ABBR, (m, a) => a + "\u2024 ").split(/(?<=[.!?])\s+(?=[A-Z0-9₹"“(])/).map((x) => x.replace(/\u2024/g, "."));
  const MONEY = /(₹|rs\.?\s?\d|inr\s?\d|\d\s?%|\b\d+\s?x\b|\bpoints?\b|\bvouchers?\b|\bfee\b|\bcashback\b|\bdiscount\b|\boff\b|\d{1,3}(,\d{2,3})+)/i;

  function summarize(brief) {
    const rows = briefRows(brief);
    const text = rows.map((r) => r.join(" | ")).join("\n");
    const fields = fieldsOf(rows);
    const pick = (re) => fields.find((f) => re.test(f.label));
    const keyFields = [
      ["Brief", /brief name/i], ["Type", /brief type/i], ["Category", /^category|basic information.*category/i],
      ["Owner", /campaign owner/i], ["Cards", /targeted cards/i], ["Offer dates", /dates? \(|validity|offer.*date/i],
      ["CTA", /cta/i]
    ].map(([k, re]) => { const f = pick(re); return f ? { label: k, value: f.value } : null; }).filter(Boolean);

    const lines = text.split("\n").map((l) => l.split(" | ").pop().trim()).filter(Boolean);
    const seen = new Set();
    const facts = [];
    for (const l of lines) {
      for (const part of sentences(l)) {
        const s = part.replace(/^[·•\-*–\s]+/, "").trim();
        if (s.length < 8 || s.length > 180 || !MONEY.test(s) || !/\d/.test(s) || seen.has(s.toLowerCase())) continue;
        seen.add(s.toLowerCase());
        facts.push(s);
      }
    }
    const dates = [...new Set((text.match(DATE_RE) || []).map((d) => d.trim()))];
    const urls = [...new Set(text.match(/https?:\/\/[^\s|"'<>)]+/g) || [])];
    const message = fields.filter((f) => /message|objective|offer|what is|callout|thought/i.test(f.label) && f.value.length > 40)
      .sort((a, b) => b.value.length - a.value.length)[0];
    const prose = (message ? message.value : lines.filter((l) => l.split(/\s+/).length >= 8).join(" "));
    const overview = sentences(prose).filter((s) => s.split(/\s+/).length >= 6).slice(0, 3).join(" ");
    return {
      words: (text.match(/\S+/g) || []).length, keyFields, facts: facts.slice(0, 12),
      dates, urls: urls.slice(0, 5), overview: overview.slice(0, 600)
    };
  }

  /* ---------- requirements: what a reviewer can verify in the finished mailer ---------- */
  let seq = 0;
  const rid = () => "r" + Date.now().toString(36) + (seq++).toString(36);

  function extractRequirements(brief) {
    const rows = briefRows(brief);
    const reqs = [];
    const add = (text, kind, field) => {
      text = text.replace(/\s+/g, " ").replace(/^[·•\-*–\s]+/, "").trim();
      if (text.length < 3 || text.length > 220) return;
      if (reqs.some((r) => r.text.toLowerCase() === text.toLowerCase())) return;
      reqs.push({ id: rid(), text, kind, field: field || "", source: "auto" });
    };

    for (const f of fieldsOf(rows)) {
      const L = f.label;
      if (/\bcta\b/i.test(L)) add(`CTA: ${f.value}`, "cta", "CTA");
      else if (/dates? \(|validity|offer (end|start)?\s*date/i.test(L) && !/brief|ecr|html|deploy/i.test(L)) add(`Dates: ${f.value}`, "date", "Dates");
      else if (/t&c|terms/i.test(L) && /^yes$/i.test(f.value)) add("Terms and Conditions referenced in the mailer", "flag", /footer/i.test(L) ? "Footer T&Cs" : "T&C");
      else if (/personali[sz]ation/i.test(L) && /^yes$/i.test(f.value)) add("Personalised greeting (Dear <Name>)", "flag", "Personalisation");
      else if (/closing line/i.test(L) && !/for all cards/i.test(f.value)) add(`Closing line: ${f.value}`, "fact", "Closing line");
    }

    // Short items following a lead-in line ("…pillars:") are themes the mailer should carry.
    // A blank line ends the list, except straight after the lead-in itself.
    let listLead = false, lastWasLead = false;
    for (const r of rows) {
      const labelled = r.length > 1;
      if (labelled) { listLead = false; lastWasLead = false; }
      if (labelled && ADMIN.test(r.slice(0, -1).join(" "))) continue;
      for (const raw of r[r.length - 1].split("\n")) {
        const line = raw.trim();
        if (!line) { if (!lastWasLead) listLead = false; continue; }
        if (isPlaceholder(line)) continue;
        const bullet = /^[·•\-*–]/.test(line);
        const clean = line.replace(/^[·•\-*–\s]+/, "");
        const words = clean.split(/\s+/).length;
        if (MONEY.test(clean) && /\d/.test(clean)) {
          for (const s of sentences(clean)) if (/\d/.test(s) && MONEY.test(s)) add(s, "fact");
        } else if (/\b(must|should|mention|include|add|highlight|ensure|avoid|do not|don't|no cta|to be added)\b/i.test(clean) && words <= 30) {
          add(clean, "instruction");
        } else if ((listLead || bullet) && words <= 5 && !/[:?]$/.test(clean)) {
          add(clean, "theme");
        }
        lastWasLead = /[:\-–]$/.test(clean) && words > 2;
        if (lastWasLead) listLead = true;
        else if (words > 5 && !bullet) listLead = false;
      }
      if (labelled) { listLead = false; lastWasLead = false; }
    }
    return reqs;
  }

  /* ---------- matching requirements against a mailer's live text ---------- */
  const STOP = new Set(("the and for with that this from your you our are will should must have has been into all any can may not but more " +
    "also only its their they them then than there here what when where which who why how per via etc please add mention highlight ensure " +
    "include emailer mailer email creative communication being each other such some these those about over under after before while both " +
    "very just like need needs get gets make made new use used using one two related rather mentioning keep short crisp should").split(" "));

  const stem = (w) => w.replace(/'s$/, "").replace(/ies$/, "y").replace(/(ss)$/, "$1").replace(/([^s])s$/, "$1")
    .replace(/(.{4,})(ing|ed)$/, "$1");
  const normalise = (s) => s.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, " ").replace(/\^\d+/g, " ").replace(/[®™℠©*†‡]/g, "")
    .replace(/\b(?:rs\.?|inr)(?=\s*\d)\s*/gi, "₹").replace(/₹\s+/g, "₹").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ").toLowerCase().trim();
  const tokensOf = (s) => normalise(s).split(/[^a-z0-9&]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w)).map(stem);
  function numbersOf(s) {
    const out = [];
    for (const m of normalise(s).matchAll(/₹?(\d[\d,]*(?:\.\d+)?)\s?(%|x\b)?/g)) {
      const digits = m[1].replace(/,/g, "").replace(/\.0+$/, "");
      if (+digits >= 10 || m[2]) out.push(digits + (m[2] || ""));
    }
    return [...new Set(out)];
  }

  function mailerIndex(text) {
    return { text, norm: normalise(text), tokens: new Set(tokensOf(text)), nums: new Set(numbersOf(text)) };
  }

  function snippet(m, needle) {
    if (!needle) return "";
    const re = /^\d/.test(needle)
      ? new RegExp(needle.replace(/[%x]$/, "").split("").join(",?"), "i")
      : new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const flat = m.text.replace(/\s+/g, " ");
    const at = flat.search(re);
    if (at < 0) return "";
    const s = Math.max(0, at - 45), e = Math.min(flat.length, at + 70);
    return (s ? "…" : "") + flat.slice(s, e).trim() + (e < flat.length ? "…" : "");
  }

  function datesOf(s) {
    const out = [];
    for (const m of s.matchAll(DATE_RE)) {
      const day = m[1] || m[5], mon = (m[2] || m[4] || "").slice(0, 3).toLowerCase();
      if (day && mon) out.push({ day: +day, mon });
    }
    return out;
  }

  function check(req, m) {
    const kind = req.kind;
    if (kind === "cta") {
      const want = req.text.replace(/^cta[^:]*:\s*/i, "").trim();
      if (!want) return { status: "verify", note: "No CTA wording given in the brief." };
      if (m.text.includes(want)) return { status: "found", note: `CTA “${want}” is in the mailer.` };
      const re = new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "i");
      const hit = m.text.match(re);
      if (hit) return { status: "partial", note: `Mailer says “${hit[0]}” — brief says “${want}” (capitalisation differs).` };
      return { status: "missing", note: `No “${want}” CTA found in the mailer.` };
    }
    if (kind === "date") {
      const ds = datesOf(req.text);
      if (!ds.length) return { status: "verify", note: "Could not read a date from this line — check by eye." };
      const hits = ds.filter((d) => new RegExp(`\\b0?${d.day}(st|nd|rd|th)?\\s+${d.mon}|${d.mon}[a-z]*\\.?\\s+0?${d.day}\\b`, "i").test(m.norm));
      const st = hits.length === ds.length ? "found" : hits.length ? "partial" : "missing";
      return { status: st, note: st === "found" ? "Offer dates appear in the mailer." : `${ds.length - hits.length} of ${ds.length} date(s) not shown in the mailer.` };
    }
    if (kind === "flag") {
      if (/personal/i.test(req.field)) {
        const g = m.text.match(/\bDear\b\s*([^\s,]*)\s*,?/);
        if (!g) return { status: "missing", note: "No “Dear …” greeting found." };
        return g[1] ? { status: "found", note: `Greeting: “${g[0].trim()}”.` }
          : { status: "partial", note: "Greeting is just “Dear,” — the name merge field is empty in this export. Confirm it personalises in the ESP." };
      }
      const t = /terms\s+(and|&)\s+conditions|t\s*&\s*cs?\b/i.test(m.text);
      return { status: t ? "found" : "missing", note: t ? "Terms and Conditions are referenced." : "No Terms and Conditions reference found." };
    }

    const nums = numbersOf(req.text), toks = [...new Set(tokensOf(req.text))];
    const numHit = nums.filter((n) => m.nums.has(n));
    const tokHit = toks.filter((t) => m.tokens.has(t));
    const cov = toks.length ? tokHit.length / toks.length : 1;
    const ev = snippet(m, numHit[0] || tokHit[0]);
    const missNums = nums.filter((n) => !m.nums.has(n));
    if (kind === "instruction")
      return { status: "verify", note: `Instruction — check by eye. ${tokHit.length}/${toks.length} key words appear in the mailer.`, evidence: ev };
    let status;
    if (nums.length) status = !missNums.length && cov >= 0.4 ? "found" : (numHit.length || cov >= 0.6) ? "partial" : "missing";
    else status = cov >= 0.75 ? "found" : cov >= 0.4 ? "partial" : "missing";
    const note = status === "found" ? "Found in the mailer."
      : missNums.length ? `Not in the mailer: ${missNums.join(", ")}.`
      : `Only ${tokHit.length} of ${toks.length} key words appear (${toks.filter((t) => !m.tokens.has(t)).slice(0, 4).join(", ")} missing).`;
    return { status, note, evidence: ev };
  }

  // Newest brief wins. An older requirement is superseded when a newer brief sets the
  // same field (CTA, dates…) or restates the same offer with different figures.
  function resolve(briefsNewestFirst) {
    const out = [];
    const fields = new Map();
    const facts = [];
    const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); const i = [...A].filter((x) => B.has(x)).length; return i / (A.size + B.size - i || 1); };
    briefsNewestFirst.forEach((b, i) => {
      for (const r of b.requirements || []) {
        const row = { req: r, brief: b, priority: i + 1, supersededBy: null };
        const fk = (r.field || "").toLowerCase();
        if (fk && fields.has(fk)) row.supersededBy = fields.get(fk);
        else if (r.kind === "fact") {
          const nums = numbersOf(r.text), toks = tokensOf(r.text);
          const newer = facts.find((f) => f.brief !== b && jaccard(toks, f.toks) >= 0.5 && f.nums.join() !== nums.join());
          if (newer) row.supersededBy = newer.brief;
          facts.push({ brief: b, toks, nums });
        }
        if (fk && !fields.has(fk)) fields.set(fk, b);
        out.push(row);
      }
    });
    return out;
  }

  function checkAll(briefsNewestFirst, mailerText) {
    const m = mailerIndex(mailerText);
    return resolve(briefsNewestFirst).map((row) => row.supersededBy
      ? { ...row, status: "superseded", note: `Replaced by the newer brief “${row.supersededBy.title}”.` }
      : { ...row, ...check(row.req, m) });
  }

  return { ACCEPT, kindOf, read, briefText, summarize, extractRequirements, checkAll, normalise, pickSheets };
})();
