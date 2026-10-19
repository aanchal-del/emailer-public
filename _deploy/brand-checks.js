/* American Express brand & copy checklist — decided automatically wherever the PDF
   makes it decidable, so reviewers only spend time on what genuinely needs eyes.
   Statuses: pass · fail · warn (risk, human confirms) · review (needs a human/AI) · na */
window.BrandChecks = (() => {
  "use strict";
  const E = () => window.EmailerEngine;

  const ITEMS = [
    { id: "power-trust", label: "Power of Trust statement present", cat: "Brand", how: "auto" },
    { id: "trademark", label: "® on American Express & Membership Rewards", cat: "Brand", how: "auto" },
    { id: "amex-not-split", label: "“American Express®” never split across lines", cat: "Brand", how: "auto" },
    { id: "logo-registered", label: "Registered ® American Express logo present", cat: "Brand", how: "ai" },
    { id: "dll-colour", label: "“Don't live life” tagline in the card's colour", cat: "Brand", how: "ai" },
    { id: "preheader-period", label: "Pre-header ends with a full stop", cat: "Pre-header", how: "auto" },
    { id: "preheader-align", label: "Pre-header left-aligned, level with “No images?”", cat: "Pre-header", how: "auto" },
    { id: "view-online-copy", label: "Right side reads “No images? View this online.”", cat: "Pre-header", how: "auto" },
    { id: "copy-length", label: "Pre-header, header & body within character limits", cat: "Copy", how: "auto" },
    { id: "title-case", label: "Headers in Title Case", cat: "Copy", how: "auto" },
    { id: "header-grammar", label: "Section headers grammatically correct", cat: "Copy", how: "ai" },
    { id: "case-punctuation", label: "Sentence case ends with a full stop; Title Case has none", cat: "Copy", how: "auto" },
    { id: "log-in-case", label: "“Log in” in sentence case", cat: "Copy", how: "auto" },
    { id: "card-capital", label: "“Card” always with a capital C", cat: "Copy", how: "auto" },
    { id: "card-member", label: "“Card Member” as two words", cat: "Copy", how: "auto" },
    { id: "card-membership", label: "“Card Membership” as two words", cat: "Copy", how: "auto" },
    { id: "uk-english", label: "UK English spelling", cat: "Copy", how: "auto" },
    { id: "spelling", label: "No spelling, grammar or punctuation errors", cat: "Copy", how: "ai" },
    { id: "line-breaks", label: "Line breaks make sense", cat: "Copy", how: "auto" },
    { id: "card-name-single", label: "Card name on one line, never cut", cat: "Card", how: "auto" },
    { id: "card-fee", label: "Card fee as per the Card", cat: "Card", how: "ai" },
    { id: "signature", label: "Sign-off: SK signature (Plat Charge) / AEBC (other cards)", cat: "Card", how: "ai" },
    { id: "asterisks-numbers", label: "Asterisk / footnote on every offer figure", cat: "Special Characters", how: "auto" },
    { id: "asterisks-not-linked", label: "Asterisks and footnote markers not hyperlinked", cat: "Special Characters", how: "auto" },
    { id: "asterisk-colour", label: "Asterisks the same colour as the body copy", cat: "Special Characters", how: "auto" },
    { id: "superscripts", label: "Superscripts match the footnote pointers", cat: "Special Characters", how: "auto" },
    { id: "tcs-case", label: "“T&Cs Apply” — T, C and A in capitals", cat: "Special Characters", how: "auto" },
    { id: "click-here", label: "“here” hyperlinked in “click here”", cat: "Links & CTA", how: "auto" },
    { id: "cta-button", label: "CTA button present for this mailer type", cat: "Links & CTA", how: "auto" },
    { id: "footer-address", label: "Updated address, line break after “Phase II,”", cat: "Footer", how: "auto" },
    { id: "mandates", label: "® and © mandate lines exactly as approved", cat: "Footer", how: "auto" },
    { id: "copyright", label: "© shows the current year", cat: "Footer", how: "auto" },
    { id: "aebc-right", label: "“American Express Banking Corp.” aligned right", cat: "Footer", how: "auto" },
    { id: "footer-links", label: "Footer links in Title Case (Privacy · Contact Us · Update Email · Unsubscribe)", cat: "Footer", how: "auto" },
    { id: "unsubscribe", label: "No Unsubscribe in servicing mailers", cat: "Footer", how: "auto" },
    { id: "no-grey", label: "No excessive grey", cat: "Design", how: "auto" },
    { id: "icons-not-boxes", label: "Icons used — no boxed layouts", cat: "Design", how: "auto" },
    { id: "indian-imagery", label: "Imagery Indian in context, from Brand Box first", cat: "Design", how: "ai" },
    { id: "benefits", label: "Benefits highlighted prominently", cat: "Design", how: "ai" },
    { id: "mobile", label: "Mobile-ready (handbook measurements)", cat: "Design", how: "auto" }
  ];

  // The approved wording, exactly as the brand team issues it.
  const ADDRESS = "American Express Banking Corp., Cyber City, Tower 'C', DLF Building No. 8, Sector 25, DLF City Phase II, Gurgaon - 122002, Haryana.";
  const REGISTERED = "® Registered trademark of American Express Company.";
  const COPYRIGHT = (y) => `© ${y} American Express Company. All rights reserved.`;
  const VIEW_ONLINE = "No images? View this online.";

  const US_UK = {
    color: "colour", colors: "colours", colored: "coloured", colorful: "colourful", favorite: "favourite",
    favorites: "favourites", center: "centre", centers: "centres", organize: "organise", organized: "organised",
    organization: "organisation", realize: "realise", recognize: "recognise", recognized: "recognised",
    personalize: "personalise", personalized: "personalised", optimize: "optimise", analyze: "analyse",
    catalog: "catalogue", traveler: "traveller", travelers: "travellers", traveling: "travelling",
    traveled: "travelled", canceled: "cancelled", canceling: "cancelling", enrollment: "enrolment",
    fulfill: "fulfil", fulfillment: "fulfilment", program: "programme", programs: "programmes", labor: "labour",
    honor: "honour", honored: "honoured", favor: "favour", jewelry: "jewellery", defense: "defence",
    gray: "grey", behavior: "behaviour", neighbor: "neighbour", flavor: "flavour", flavors: "flavours",
    theater: "theatre", savor: "savour", apologize: "apologise", customize: "customise",
    customized: "customised", maximize: "maximise", minimize: "minimise", prioritize: "prioritise",
    utilize: "utilise", aluminum: "aluminium", mom: "mum", vacation: "holiday"
  };
  const TYPOS = {
    recieve: "receive", recieved: "received", seperate: "separate", occured: "occurred",
    accomodation: "accommodation", acommodation: "accommodation", untill: "until", definately: "definitely",
    wich: "which", teh: "the", privilage: "privilege", privilages: "privileges", previlege: "privilege",
    benifit: "benefit", benifits: "benefits", complimentry: "complimentary", experiance: "experience",
    membeship: "membership", upgarde: "upgrade", excusive: "exclusive", exlusive: "exclusive",
    oppurtunity: "opportunity", availabe: "available", guarentee: "guarantee", gaurantee: "guarantee",
    refered: "referred", transfered: "transferred", begining: "beginning", beleive: "believe",
    calender: "calendar", resturant: "restaurant", restuarant: "restaurant", acheive: "achieve",
    buisness: "business", enviroment: "environment", independant: "independent", neccessary: "necessary",
    noticable: "noticeable", occassion: "occasion", reccomend: "recommend", recomend: "recommend",
    tommorow: "tomorrow", truely: "truly", adress: "address", sucessful: "successful",
    succesful: "successful", vouncher: "voucher", vocher: "voucher", rewads: "rewards", reawrds: "rewards"
  };

  /* ---------- text model: visual lines with footnote markers written as ^n ----------
     Mailers put text side by side (a headline beside a card caption), so a run only
     joins a line it actually sits next to, and lines are then read column by column:
     each line is followed by the line directly beneath it that it overlaps. */
  const widthOf = (it) => it.w || it.text.length * it.size * 0.5;

  function buildLines(items) {
    const byPage = {};
    for (const it of items) (byPage[it.page] = byPage[it.page] || []).push(it);
    const lines = [];
    let chain = 0;
    for (const p of Object.keys(byPage).map(Number).sort((a, b) => a - b)) {
      const open = [];
      for (const it of byPage[p].slice().sort((a, b) => b.y - a.y || a.x - b.x)) {
        let best = null, bestDy = Infinity;
        for (let k = open.length - 1; k >= Math.max(0, open.length - 40); k--) {
          const L = open[k];
          const small = Math.min(L.size, it.size), big = Math.max(L.size, it.size);
          const dy = Math.abs(L.y - it.y);
          // A much smaller run may sit raised (a superscript); same-size runs share a baseline.
          if (dy > (small < big * 0.8 ? big * 0.6 : small * 0.5)) continue;
          if (Math.max(it.x - L.maxX, L.minX - (it.x + widthOf(it))) > big * 1.5) continue;
          if (dy < bestDy) { best = L; bestDy = dy; }
        }
        if (best) {
          best.items.push(it);
          best.minX = Math.min(best.minX, it.x); best.maxX = Math.max(best.maxX, it.x + widthOf(it));
          if (it.size > best.size) { best.size = it.size; best.y = it.y; }
        } else open.push({ items: [it], y: it.y, size: it.size, minX: it.x, maxX: it.x + widthOf(it) });
      }
      // Raised marks (®, ℠, footnote digits) are read before the line they sit on, and
      // baselines differ by fractions of a point, so one visual line can start as several
      // fragments. Fold touching fragments together until nothing changes.
      const touching = (L, M) => {
        const small = Math.min(L.size, M.size), big = Math.max(L.size, M.size);
        const dy = Math.abs(L.y - M.y);
        const gap = Math.max(M.minX - L.maxX, L.minX - M.maxX);
        return gap <= big * 1.5 && dy <= (small < big * 0.8 ? big * 0.6 : small * 0.5);
      };
      for (let merged = true; merged;) {
        merged = false;
        for (let i = 0; i < open.length; i++)
          for (let k = i + 1; k < open.length; k++) {
            const L = open[i], M = open[k];
            if (Math.abs(L.y - M.y) > Math.max(L.size, M.size) || !touching(L, M)) continue;
            L.items.push(...M.items);
            L.minX = Math.min(L.minX, M.minX); L.maxX = Math.max(L.maxX, M.maxX);
            if (M.size > L.size) { L.size = M.size; L.y = M.y; }
            open.splice(k--, 1);
            merged = true;
          }
      }
      open.sort((a, b) => b.y - a.y || a.minX - b.minX);

      // Link each line to the one directly beneath it in the same column.
      const below = new Map(), above = new Map();
      for (const L of open) {
        let next = null, gap = Infinity;
        for (const M of open) {
          const dy = L.y - M.y;
          if (dy <= L.size * 0.5 || dy > Math.max(L.size, M.size) * 2.2) continue;
          const overlap = Math.min(L.maxX, M.maxX) - Math.max(L.minX, M.minX);
          if (overlap < Math.min(L.maxX - L.minX, M.maxX - M.minX) * 0.3) continue;
          if (dy < gap) { next = M; gap = dy; }
        }
        if (next && (!above.has(next) || L.y - next.y < above.get(next).y - next.y)) {
          if (above.has(next)) below.delete(above.get(next));
          below.set(L, next); above.set(next, L);
        }
      }
      const seen = new Set();
      for (const L of open) {
        if (seen.has(L) || above.has(L)) continue;
        chain++;
        for (let cur = L; cur && !seen.has(cur); cur = below.get(cur)) {
          seen.add(cur);
          lines.push({ ...makeLine(p, cur.items.sort((a, b) => a.x - b.x)), chain });
        }
      }
      for (const L of open) if (!seen.has(L)) lines.push({ ...makeLine(p, L.items.sort((a, b) => a.x - b.x)), chain: ++chain });
    }
    return lines;
  }

  function makeLine(page, its) {
    const big = Math.max(...its.map((i) => i.size));
    let text = "", lastX2 = null;
    const spans = [];
    for (const it of its) {
      let t = it.text;
      const sup = it.size < big * 0.8 && /^[\s\d*†‡,]+$/.test(t) && t.trim() !== "";
      if (sup) t = t.trim().split(/[,\s]+/).filter(Boolean).map((x) => (/^\d+$/.test(x) ? "^" + x : x)).join("");
      else if (text && !/\s$/.test(text) && !/^\s/.test(t) && lastX2 != null && it.x - lastX2 > it.size * 0.2) text += " ";
      spans.push({ it, start: text.length, end: text.length + t.length, sup });
      text += t;
      lastX2 = it.x + (it.w || t.length * it.size * 0.5);
    }
    const main = its.find((i) => i.size === big);
    return { page, text: text.replace(/\s+$/, ""), spans, size: big, y: main.y };
  }

  function rectFor(line, start, end) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of line.spans) {
      if (s.end <= start || s.start >= end) continue;
      const it = s.it, len = Math.max(1, s.end - s.start);
      const w = it.w || len * it.size * 0.5;
      const a = s.sup ? 0 : Math.max(0, start - s.start) / len;
      const b = s.sup ? 1 : Math.min(len, end - s.start) / len;
      x0 = Math.min(x0, it.x + w * a); x1 = Math.max(x1, it.x + w * b);
      y0 = Math.min(y0, it.y - it.size * 0.3); y1 = Math.max(y1, it.y + it.size * 0.9);
    }
    if (!isFinite(x0)) return null;
    if (x1 - x0 < 3) x1 = x0 + 3;
    return [x0, y0, x1, y1];
  }

  /* ---------- the checks ---------- */
  async function run(r, ctx) {
    ctx = ctx || {};
    const d = r.data;
    const lines = buildLines(d.items);
    const starts = [];
    let joined = "";
    for (const l of lines) { starts.push(joined.length); joined += l.text + "\n"; }
    const lineAt = (pos) => {
      let lo = 0, hi = starts.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
      return lo;
    };
    const marks = [];
    const markAt = (pos, len, kind, label) => {
      const i = lineAt(pos), line = lines[i];
      const s = pos - starts[i], e = Math.min(line.text.length, s + len);
      const rect = rectFor(line, s, e);
      if (rect) marks.push({ page: line.page, rect, kind, label, space: "pdf", brand: true });
    };
    const find = (re) => Array.from(joined.matchAll(re));
    const body = r.bodySize || 12;
    // The handbook's legal size. T&Cs and footers sit here; their figures *are* the
    // footnotes, and their line wraps are not design decisions.
    const LEGAL = E().RB.thresholds.legalPx + 0.6;
    const legalLine = (l) => l.size <= LEGAL;
    const legal = (pos) => legalLine(lines[lineAt(pos)]);
    const hasText = d.totalChars >= 120;
    const out = {};
    const set = (id, status, evidence, method) => {
      for (const mk of marks) if (!mk.item) mk.item = id;   // boxes drawn since the last check belong to this one
      out[id] = { status, evidence: evidence || "", method: method || (status === "review" ? "manual" : "auto") };
    };
    const noText = "Copy is mostly images, so this can't be read from the PDF.";
    const quote = (m) => `“${E().trim(m[0].replace(/\s+/g, " "), 60)}”`;

    // 1. Power of Trust
    const pot = find(/(india'?s )?most trusted credit card brand|power of trust/gi);
    if (pot.length) { markAt(pot[0].index, pot[0][0].length, "pass", "✓ Power of Trust statement"); set("power-trust", "pass", `Found ${quote(pot[0])}.`); }
    else set("power-trust", hasText ? "fail" : "review", hasText ? "No “India's most trusted credit card brand” statement in the live text." : noText);

    // 2. Headers in Title Case. A header is a short stand-alone line, in capitals or larger
    // than the copy — never one line of a wrapped paragraph, and never a sentence
    // (sentence-case copy legitimately ends with a full stop).
    const isCaps = (t) => /[A-Z]/.test(t) && t === t.toUpperCase();
    const sizeChars = {};
    for (const l of lines) if (!legalLine(l) && l.text.split(/\s+/).length >= 6)
      sizeChars[l.size] = (sizeChars[l.size] || 0) + l.text.length;
    const copySize = +Object.keys(sizeChars).sort((a, z) => sizeChars[z] - sizeChars[a])[0] || body;
    const near = (i, j) => { const a = lines[i], o = lines[j]; return o && o.chain === a.chain && Math.abs(o.size - a.size) <= 0.6 && Math.abs(o.y - a.y) < a.size * 1.9; };
    const headers = lines.filter((l, i) => {
      const t = l.text.replace(/\^\d+/g, "").trim();
      const caps = isCaps(t);
      if (t.length < 3 || t.split(/\s+/).length > 10 || E().isViewOnline(t) || !/[A-Za-z]/.test(t) || legalLine(l)) return false;
      if (!caps && (/[.,;:]$/.test(t) || near(i, i - 1) || near(i, i + 1))) return false;
      return caps ? l.size >= copySize * 0.9 : l.size >= copySize * 1.15;
    });
    const badHeads = headers.filter((l) => !E().isTitleCase(l.text.replace(/[.!]+/g, " ")));
    for (const l of badHeads) markAt(starts[lines.indexOf(l)], l.text.length, "warn", "Header not in Title Case");
    if (!headers.length) set("title-case", "review", hasText ? "No live-text headers found — headers may be inside images." : noText);
    else if (badHeads.length) set("title-case", "warn", `${badHeads.length} of ${headers.length} header(s) not Title Case: ${badHeads.slice(0, 3).map((l) => `“${E().trim(l.text, 40)}”`).join(", ")}.`);
    else set("title-case", "pass", `${headers.length} header(s), all Title Case or capitals.`);

    // 3. Pre-header ends with a full stop
    let pre = null;
    for (const [i, l] of lines.entries()) {
      if (l.page !== 1) break;
      const t = l.text.split(/\s*(no images\??|view (this |it )?(online|in (your )?browser)|having trouble|can'?t see)/i)[0].trim();
      if (t.length >= 10) { pre = { i, t }; break; }
      if (i > 3) break;
    }
    if (!pre) set("preheader-period", "review", hasText ? "Couldn't identify the pre-header (it is often a hidden div that doesn't export to PDF)." : noText);
    else {
      const ok = /\.$/.test(pre.t);
      markAt(starts[pre.i], pre.t.length, ok ? "pass" : "fail", ok ? "✓ Pre-header ends with a full stop" : "Pre-header must end with a full stop");
      set("preheader-period", ok ? "pass" : "fail", `Pre-header: “${E().trim(pre.t, 70)}”.`);
    }

    // 4 & 6. Card names and "American Express" kept whole
    const cards = find(/(American\s+Express(?:\s*(?:®|Ⓡ|\^\d+))*\s*)?\b(Platinum\s+Reserve|Platinum\s+Travel|Platinum|Gold\s+Charge|Gold|Membership\s+Rewards|SmartEarn|Centurion)(?:\s*(?:℠|®|™|SM|TM|\^\d+))*\s*(Credit\s+Card|Charge\s+Card|Card)\b/g);
    const broken = cards.filter((m) => m[0].slice((m[1] || "").length).includes("\n"));
    const afterBrand = cards.filter((m) => !broken.includes(m) && (m[1] || "").includes("\n") && !legal(m.index));
    for (const m of broken) markAt(m.index, m[0].indexOf("\n"), "fail", "Card name broken across lines");
    for (const m of afterBrand) markAt(m.index, m[1].indexOf("\n"), "warn", "Card name continues on the next line");
    if (!cards.length) set("card-name-single", "review", hasText ? "No card name found in live text — check names inside images." : noText);
    else if (broken.length) set("card-name-single", "fail", `${broken.length} card name(s) break mid-name: ${broken.map(quote).join(", ")}.`);
    else if (afterBrand.length) set("card-name-single", "warn", `Card name runs onto a second line after “American Express®”: ${afterBrand.map(quote).join(", ")}. Confirm this is an approved lock-up.`);
    else set("card-name-single", "pass", `${cards.length} card name(s), each on one line.`);

    const split = find(/American[®\s^\d]*\n\s*Express/gi);
    for (const m of split) markAt(m.index, 8, "fail", "“American Express” split across lines");
    const amexAll = find(/American\s+Express/gi);
    if (split.length) set("amex-not-split", "fail", `“American Express” breaks across a line ${split.length} time(s).`);
    else set("amex-not-split", amexAll.length ? "pass" : "review", amexAll.length ? `${amexAll.length} mention(s), none split.` : (hasText ? "No “American Express” in live text — the logo/brand may be an image." : noText));

    // 5. Registered trademark
    const brandRefs = find(/American\s+Express(?![\s]*(Company|Banking|Bank))|Membership\s+Rewards/gi);
    const noMark = brandRefs.filter((m) => !/^\s*[®Ⓡ]/.test(joined.slice(m.index + m[0].length, m.index + m[0].length + 3)));
    for (const m of noMark) markAt(m.index, m[0].length, "warn", "® missing");
    for (const m of brandRefs.filter((x) => !noMark.includes(x)).slice(0, 15)) markAt(m.index, m[0].length + 1, "pass", "✓ ® present");
    if (!brandRefs.length) set("trademark", "review", hasText ? "No American Express / Membership Rewards mentions in live text." : noText);
    else if (noMark.length) set("trademark", "warn", `${noMark.length} of ${brandRefs.length} mention(s) without ®: ${noMark.slice(0, 3).map(quote).join(", ")}.`);
    else set("trademark", "pass", `All ${brandRefs.length} mention(s) carry ®.`);

    // 7. Asterisks / footnotes on offer figures
    const figures = find(/(₹|\bRs\.?\s?|\bINR\s?)\s?\d[\d,]*(\.\d+)?|\b\d+(\.\d+)?\s?%|\b\d+\s?[xX]\b|\b\d{1,3}(,\d{2,3})+(?=\s+(Membership|MR|bonus|reward|point))/g)
      .filter((m) => !legal(m.index));
    const bare = figures.filter((m) => {
      const end = m.index + m[0].length;
      const stop = joined.indexOf(".", end);
      const seg = joined.slice(end, Math.min(stop < 0 ? end + 200 : stop + 4, end + 200));
      return !/(\^\d|\*|[¹²³⁴⁵⁶⁷⁸⁹†‡])/.test(seg);
    });
    for (const m of bare) markAt(m.index, m[0].length, "warn", "Figure has no * or footnote");
    for (const m of figures.filter((x) => !bare.includes(x)).slice(0, 15)) markAt(m.index, m[0].length, "pass", "✓ Figure has * or footnote");
    if (!figures.length) set("asterisks-numbers", "na", "No offer figures (₹, %, X, points) in the copy.");
    else if (bare.length) set("asterisks-numbers", "warn", `${bare.length} of ${figures.length} figure(s) have no asterisk/footnote: ${bare.slice(0, 4).map(quote).join(", ")}.`);
    else set("asterisks-numbers", "pass", `All ${figures.length} offer figure(s) carry an asterisk or footnote.`);

    // 8 & 9. Hyperlinks
    const links = d.links || [];
    const inLink = (page, rect) => links.some((k) => k.page === page &&
      Math.min(rect[2], k.rect[2]) - Math.max(rect[0], k.rect[0]) > 0.5 &&
      Math.min(rect[3], k.rect[3]) - Math.max(rect[1], k.rect[1]) > 0.5);
    const noLinkData = "This PDF export carries no hyperlink data — check links in the HTML build.";
    if (!links.length) set("asterisks-not-linked", "review", noLinkData);
    else {
      const linked = [];
      for (const l of lines) for (const s of l.spans) {
        const t = l.text.slice(s.start, s.end);
        if (!(s.sup || /[*†‡¹²³⁴⁵⁶⁷⁸⁹]/.test(t))) continue;
        const idx = s.sup ? 0 : t.search(/[*†‡¹²³⁴⁵⁶⁷⁸⁹]/);
        const rect = rectFor(l, s.start + idx, s.sup ? s.end : s.start + idx + 1);
        if (rect && inLink(l.page, rect)) { linked.push(t); marks.push({ page: l.page, rect, kind: "fail", label: "Marker is hyperlinked", space: "pdf", brand: true }); }
      }
      set("asterisks-not-linked", linked.length ? "fail" : "pass", linked.length ? `${linked.length} marker(s) sit inside a link.` : "No asterisk or footnote marker is inside a link.");
    }

    const clicks = find(/click\s+here/gi);
    if (!clicks.length) set("click-here", "na", "No “click here” in the copy.");
    else if (!links.length) set("click-here", "review", noLinkData);
    else {
      let bad = 0;
      for (const m of clicks) {
        const pos = m.index + m[0].toLowerCase().lastIndexOf("here");
        const i = lineAt(pos), rect = rectFor(lines[i], pos - starts[i], pos - starts[i] + 4);
        const ok = rect && inLink(lines[i].page, rect);
        if (!ok) bad++;
        markAt(pos, 4, ok ? "pass" : "fail", ok ? "✓ “here” is hyperlinked" : "“here” is not hyperlinked");
      }
      set("click-here", bad ? "fail" : "pass", bad ? `${bad} “click here” without a link on “here”.` : `“here” is hyperlinked (${clicks.length}).`);
    }

    // Footer address — exact wording, and the line break after "DLF City Phase II,"
    const flat = (s) => s.replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
    const addrM = find(/American\s+Express\s+Banking\s+Corp\.?,?\s*Cyber\s+City[\s\S]{0,200}?(Haryana\.?|\b1220\d\d\b[^\n]*)/gi)[0];
    if (!addrM) {
      const any = find(/DLF\s+City/gi)[0];
      if (any) markAt(any.index, any[0].length, "fail", "Old or incomplete address");
      set("footer-address", hasText ? "fail" : "review", hasText ? (any ? "An address is there but not the approved one — it should read: " + ADDRESS : "No footer address found. It should read: " + ADDRESS) : noText);
    } else {
      const got = flat(addrM[0]);
      const brk = addrM[0].indexOf("\n");
      const breakAt = brk < 0 ? -1 : flat(addrM[0].slice(0, brk)).length;
      const wantBreak = flat(ADDRESS.slice(0, ADDRESS.indexOf("Gurgaon"))).length;
      if (got !== ADDRESS) {
        markAt(addrM.index, addrM[0].length, "fail", "Address wording differs from the approved one");
        set("footer-address", "fail", `Found “${E().trim(got, 140)}”. Approved: “${ADDRESS}”.`);
      } else if (breakAt !== wantBreak) {
        markAt(addrM.index, addrM[0].length, "warn", "Address line break should come after “Phase II,”");
        set("footer-address", "warn", breakAt < 0 ? "Address is on one line — it should break after “DLF City Phase II,”." :
          `Address breaks after “…${flat(addrM[0].slice(0, brk)).slice(-22)}” — it should break after “DLF City Phase II,”.`);
      } else {
        markAt(addrM.index, addrM[0].length, "pass", "✓ Approved address & line break");
        set("footer-address", "pass", "Approved address, breaking after “DLF City Phase II,”.");
      }
    }

    // Mandate lines — exact text
    const year = new Date().getFullYear();
    const regM = find(/®?\s*Registered\s+trade\s*mark\s+of\s+American\s+Express\s+Company\.?/gi)[0];
    const crM = find(/(©|\(c\)|copyright)\s*(\d{4})\s*American\s+Express(\s+Company)?\.?\s*(All\s+rights\s+reserved\.?)?/gi)[0];
    const mandateIssues = [];
    if (!regM) mandateIssues.push(`missing “${REGISTERED}”`);
    else if (flat(regM[0]) !== REGISTERED) { mandateIssues.push(`“${flat(regM[0])}” should read “${REGISTERED}”`); markAt(regM.index, regM[0].length, "fail", "Mandate wording"); }
    else markAt(regM.index, regM[0].length, "pass", "✓ ® mandate");
    if (!crM) mandateIssues.push(`missing “${COPYRIGHT(year)}”`);
    else if (flat(crM[0]).replace(/\d{4}/, year) !== COPYRIGHT(year)) { mandateIssues.push(`“${flat(crM[0])}” should read “${COPYRIGHT(year)}”`); markAt(crM.index, crM[0].length, "fail", "Mandate wording"); }
    set("mandates", mandateIssues.length ? (hasText ? "fail" : "review") : "pass", mandateIssues.length ? (hasText ? mandateIssues.join("; ") + "." : noText) : "Both mandate lines match the approved wording.");

    if (crM) {
      const ok = +crM[2] === year;
      markAt(crM.index, crM[0].length, ok ? "pass" : "fail", ok ? "✓ Copyright year" : `Copyright year should be ${year}`);
      set("copyright", ok ? "pass" : "fail", ok ? `© ${year}.` : `Copyright says ${crM[2]} — should be ${year}.`);
    } else set("copyright", hasText ? "fail" : "review", hasText ? "No © notice found." : noText);

    // AEBC sign-off line on the right
    const pageW = (p) => ((d.pageSizes || {})[p] || { w: d.page1W }).w;
    const lineBox = (l) => {
      const f = l.spans[0].it, z = l.spans[l.spans.length - 1].it;
      return { minX: f.x, maxX: z.x + widthOf(z) };
    };
    const aebcLine = lines.find((l) => /^American\s+Express\s+Banking\s+Corp\.?$/i.test(l.text.trim()));
    if (!aebcLine) set("aebc-right", hasText ? "warn" : "review", hasText ? "No stand-alone “American Express Banking Corp.” line found." : noText);
    else {
      const bx = lineBox(aebcLine), W = pageW(aebcLine.page);
      const ok = bx.maxX >= W * 0.8 && bx.minX >= W * 0.5;
      markAt(starts[lines.indexOf(aebcLine)], aebcLine.text.length, ok ? "pass" : "fail", ok ? "✓ Right-aligned" : "Should be right-aligned");
      set("aebc-right", ok ? "pass" : "fail", ok ? "Right-aligned." : `Sits at ${Math.round(bx.minX / W * 100)}–${Math.round(bx.maxX / W * 100)}% of the width — it should be aligned right.`);
    }

    // 12 & 13. Card Member / Card Membership
    const cm = find(/\bcardm[a-z]*?bers?\b(?!ship)/gi);
    for (const m of cm) markAt(m.index, m[0].length, "fail", "Write “Card Member” as two words");
    set("card-member", cm.length ? "fail" : "pass", cm.length ? `Found ${cm.map(quote).join(", ")} — must be “Card Member”.` : "No one-word “Cardmember” in the copy.");
    const cms = find(/\bcardm[a-z]*bership\b/gi);
    for (const m of cms) markAt(m.index, m[0].length, "fail", "Write “Card Membership” as two words");
    set("card-membership", cms.length ? "fail" : "pass", cms.length ? `Found ${cms.map(quote).join(", ")}.` : "No one-word “Cardmembership” in the copy.");

    // 14. Sign-off — depends on the card, which the PDF alone can't tell us
    const aebc = /American\s+Express\s+Banking\s+Corp/i.test(joined);
    set("signature", "review", aebc ? "“American Express Banking Corp.” sign-off found — confirm it suits this card (Plat Charge needs the SK signature)." : "No AEBC sign-off in live text — Plat Charge mailers need the SK signature image; confirm by eye.");

    // 15. Grey — measured from the rendered pixels
    try {
      const g = await greyShare(r.pdf);
      set("no-grey", g >= 30 ? "warn" : "pass", `Grey tones cover about ${g}% of the mailer${g >= 30 ? " — the brand guide says avoid excessive grey." : "."}`);
    } catch (_) { set("no-grey", "review", "Couldn't measure colours — check by eye."); }

    // 16. Icons vs boxes
    const icons = (d.graphics || []).filter((g) => g.kind === "icon").length +
      (d.imageSizes || []).filter((im) => im.w <= 80 && im.h <= 80 && im.w > 8).length;
    set("icons-not-boxes", icons >= 2 ? "pass" : "review", icons >= 2 ? `${icons} icon-sized graphics found.` : "No icons detected — check whether benefits sit in boxes instead of using icons.");

    // 17. Indian imagery — only eyes (or AI vision) can judge
    set("indian-imagery", "review", `${(d.imageSizes || []).filter((im) => im.w > 120).length} photo(s) to check for Indian context.`);

    // 18. Superscripts vs footnotes
    const SUP = { "¹": 1, "²": 2, "³": 3, "⁴": 4, "⁵": 5, "⁶": 6, "⁷": 7, "⁸": 8, "⁹": 9 };
    const used = new Set();
    for (const l of lines) {
      if (legalLine(l)) continue;
      for (const m of l.text.matchAll(/\^(\d+)|([¹²³⁴⁵⁶⁷⁸⁹])/g)) used.add(m[1] ? +m[1] : SUP[m[2]]);
    }
    const defined = new Set();
    for (const l of lines) {
      const m = l.text.match(/^\s*(?:\^(\d{1,2})|(\d{1,2})[.)]|([¹²³⁴⁵⁶⁷⁸⁹]))\s*[A-Z]/);
      if (m && legalLine(l)) defined.add(+(m[1] || m[2]) || SUP[m[3]]);
    }
    const usedList = [...used].sort((a, b) => a - b);
    if (!used.size) set("superscripts", "na", "No numbered footnote markers in the copy.");
    else if (!defined.size) set("superscripts", "review", `Markers ${usedList.join(", ")} are used, but the footnotes aren't in the mailer (likely in the linked T&Cs) — confirm they match.`);
    else {
      const missing = usedList.filter((n) => !defined.has(n));
      const unused = [...defined].filter((n) => !used.has(n));
      set("superscripts", missing.length || unused.length ? "warn" : "pass",
        missing.length || unused.length ? `${missing.length ? `No footnote for ${missing.join(", ")}. ` : ""}${unused.length ? `Footnote ${unused.join(", ")} never referenced.` : ""}` : `Markers ${usedList.join(", ")} all have footnotes.`);
    }

    // 19. T&Cs Apply
    const tcs = find(/\b(t\s*&\s*c'?s?|terms\s+(?:and|&)\s+conditions)\s+apply\b/gi);
    const badTcs = tcs.filter((m) => !/^(T&Cs? Apply|Terms (and|&) Conditions Apply)$/.test(m[0].replace(/\s+/g, " ")));
    for (const m of tcs) markAt(m.index, m[0].length, badTcs.includes(m) ? "fail" : "pass", badTcs.includes(m) ? "Should read “T&Cs Apply”" : "✓ T&Cs Apply");
    if (!tcs.length) set("tcs-case", hasText ? "warn" : "review", hasText ? "No “T&Cs Apply” line found." : noText);
    else set("tcs-case", badTcs.length ? "fail" : "pass", badTcs.length ? `Wrong case: ${badTcs.map(quote).join(", ")}.` : `${quote(tcs[0])} — correct case.`);

    // 20. CTA
    // The engine's CTA net is wide; for the evidence, prefer copy that leads with the action.
    const allCtas = r.ctas || [];
    const leading = allCtas.filter((x) => x.text.trim().split(/\s+/).length <= 3 && E().RB.ctaVerbs.test(x.text.trim().split(/\s+/)[0]));
    const ctas = leading.length ? leading : allCtas;
    if (ctas.length) set("cta-button", "pass", `${ctas.length} CTA(s): ${ctas.slice(0, 3).map((b) => `“${b.text}”`).join(", ")}${ctas.some((b) => !E().isTitleCase(b.text)) ? " — note: not all in Title Case (see handbook findings)." : "."}`);
    else set("cta-button", ctx.mailerType === "servicing" ? "review" : "fail", "No CTA-like button text found.");

    // 21. Unsubscribe
    const unsub = find(/unsubscribe/gi);
    for (const m of unsub) markAt(m.index, m[0].length, ctx.mailerType === "servicing" ? "fail" : "pass", ctx.mailerType === "servicing" ? "No Unsubscribe in servicing mailers" : "✓ Unsubscribe");
    if (ctx.mailerType === "servicing") set("unsubscribe", unsub.length ? "fail" : "pass", unsub.length ? "Servicing mailer contains “Unsubscribe” — remove it." : "Servicing mailer — correctly has no Unsubscribe.");
    else set("unsubscribe", unsub.length ? "pass" : (hasText ? "warn" : "review"), unsub.length ? "Marketing mailer — Unsubscribe link present." : "Marketing mailer without “Unsubscribe” in the footer — confirm.");

    // 22. UK English
    const us = find(new RegExp(`\\b(${Object.keys(US_UK).join("|")})\\b`, "gi"));
    for (const m of us) markAt(m.index, m[0].length, "warn", `UK spelling: ${US_UK[m[0].toLowerCase()]}`);
    set("uk-english", us.length ? "warn" : "pass", us.length ? `US spellings: ${us.slice(0, 5).map((m) => `${m[0]} → ${US_UK[m[0].toLowerCase()]}`).join(", ")}.` : "No US spellings found.");

    // 23. Spelling — common slips and doubled words; a full proofread needs AI or a person
    const typoKeys = Object.keys(TYPOS);
    const punct = find(/([,;:!?])\1+|(?<!\.)\.\.(?!\.)|[^\S\n]+[,;:!?](?=\s|$)|[,;](?=[A-Za-z])|[a-z]{2}\.(?=[A-Z][a-z])/g);
    const typos = find(new RegExp(`\\b(${typoKeys.join("|")})\\b`, "gi")).concat(find(/\b([A-Za-z]{2,})\s+\1\b/gi), punct);
    for (const m of typos) markAt(m.index, m[0].length, "fail", TYPOS[m[0].toLowerCase()] ? `Spelling: ${TYPOS[m[0].toLowerCase()]}` : punct.includes(m) ? "Punctuation" : "Repeated word");
    set("spelling", typos.length ? "fail" : "review", typos.length ? `Found: ${typos.slice(0, 5).map((m) => around(m.index, m[0].length)).join(", ")}.` : "No common misspellings, repeated words or punctuation slips. A full grammar proofread still needs AI or a person.");

    // 24. Benefits
    set("benefits", "review", `${(d.imageSizes || []).length} image(s) and ${icons} icon(s) — check benefits stand out.`);

    // 25. Line breaks — a line must not end on a word that needs the next one
    const dangling = [];
    for (let i = 0; i + 1 < lines.length; i++) {
      const a = lines[i], b = lines[i + 1];
      if (legalLine(a) || a.chain !== b.chain || Math.abs(a.size - b.size) > 0.6 || a.y - b.y > a.size * 1.9) continue;
      const m = a.text.match(/\b(a|an|the|of|to|and|&|with|for|on|in|at|by|your|our|up|via|or|₹|Rs\.?)\s*$/i);
      if (m) { dangling.push(a); markAt(starts[i] + m.index, m[0].length, "warn", "Line ends on a dangling word"); }
    }
    set("line-breaks", dangling.length ? "warn" : "pass", dangling.length ? `${dangling.length} line(s) end on a word that belongs with the next line: ${dangling.slice(0, 3).map((l) => `“…${l.text.slice(-28)}”`).join(", ")}.` : "No line ends on a dangling word (basic check — awkward breaks inside images aren't visible here).");

    const around = (pos, len) => `“…${joined.slice(Math.max(0, pos - 22), pos + len + 14).replace(/\s+/g, " ").trim()}…”`;

    // Pre-header alignment and the "No images? View this online." copy
    const voRe = /no images\??[^\n]*/i;
    const voLine = lines.slice(0, 10).find((l) => l.page === 1 && voRe.test(l.text));
    if (!voLine) {
      set("view-online-copy", hasText ? "fail" : "review", hasText ? `No “${VIEW_ONLINE}” at the top of the mailer.` : noText);
      set("preheader-align", "review", pre ? "Pre-header found, but there is no “No images?” text to line it up with." : "Couldn't identify the pre-header.");
    } else {
      const vi = lines.indexOf(voLine), vm = voLine.text.match(voRe), voText = vm[0].trim();
      const okCopy = voText === VIEW_ONLINE;
      markAt(starts[vi] + vm.index, vm[0].length, okCopy ? "pass" : "fail", okCopy ? `✓ ${VIEW_ONLINE}` : `Should read “${VIEW_ONLINE}”`);
      set("view-online-copy", okCopy ? "pass" : "fail", okCopy ? `Reads exactly “${VIEW_ONLINE}”` : `Reads “${voText}” — should be “${VIEW_ONLINE}”.`);
      const W = pageW(voLine.page);
      const vr = rectFor(voLine, vm.index, vm.index + vm[0].length);
      if (!pre) set("preheader-align", "review", "Couldn't identify the pre-header.");
      else {
        const pl = lines[pre.i], pr = rectFor(pl, 0, pre.t.length);
        const issues = [
          !(pr && pr[0] <= W * 0.15) && "the pre-header isn't aligned left",
          !(pr && vr && Math.abs((pr[1] + pr[3]) / 2 - (vr[1] + vr[3]) / 2) <= Math.max(2, pl.size * 0.3)) && "it isn't level with “No images?”",
          !(vr && vr[2] >= W * 0.8) && "“No images?” isn't on the right"
        ].filter(Boolean);
        set("preheader-align", issues.length ? "warn" : "pass", issues.length ? issues.join("; ") + "." : "Pre-header on the left, level with “No images? View this online.” on the right.");
      }
    }

    // Copy length — the handbook limits, from the engine's measurements plus the pre-header
    const T = E().RB.thresholds;
    const lenIssues = r.scored.concat(r.obs)
      .filter((c) => /length/i.test(c.title) && c.title !== "Preheader length" && (c.status === "warn" || c.status === "fail"))
      .map((c) => `${c.title}: ${c.detail.replace(/<[^>]+>/g, "")}`);
    if (pre && (pre.t.length < T.preheaderMin || pre.t.length > T.preheaderMax))
      lenIssues.unshift(`Pre-header is ${pre.t.length} characters (limit ${T.preheaderMin}–${T.preheaderMax}).`);
    set("copy-length", lenIssues.length ? "warn" : (hasText ? "pass" : "review"),
      lenIssues.length ? lenIssues.slice(0, 4).join(" ") : (hasText ? `Within limits${pre ? ` — pre-header ${pre.t.length} characters` : ""}.` : noText));

    // Sentence case ends with a full stop; Title Case has none
    const paras = [];
    lines.forEach((l, i) => {
      if (legalLine(l)) return;
      const prev = paras[paras.length - 1];
      if (prev && prev.chain === l.chain && Math.abs(prev.size - l.size) <= 0.6 && prev.last === i - 1) { prev.text += " " + l.text; prev.last = i; }
      else paras.push({ chain: l.chain, size: l.size, first: i, last: i, text: l.text });
    });
    const SMALL = new Set(["a", "an", "and", "the", "or", "for", "to", "of", "in", "on", "with", "at", "by", "from", "as", "via"]);
    const ctaTexts = new Set(allCtas.map((b) => b.text.trim()));
    const titleStop = [], noStop = [];
    for (const p of paras) {
      const t = p.text.replace(/\^\d+/g, "").replace(/[*†‡]+(?=\s|$)/g, "").trim();
      const words = t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
      if (words.length < 3 || isCaps(t) || E().isViewOnline(t) || ctaTexts.has(p.text.trim()) || (pre && p.first === pre.i)) continue;
      const sig = words.slice(1).filter((w) => !SMALL.has(w.toLowerCase()));
      if (!sig.length) continue;
      const ratio = sig.filter((w) => /^[A-Z0-9₹]/.test(w)).length / sig.length;
      if (ratio >= 0.75 && /\.$/.test(t)) titleStop.push(p);
      else if (ratio <= 0.4 && words.length >= 6 && !/[.!?:]$/.test(t)) noStop.push(p);
    }
    for (const p of titleStop) markAt(starts[p.last], lines[p.last].text.length, "fail", "Title Case copy must not end with a full stop");
    for (const p of noStop) markAt(starts[p.last], lines[p.last].text.length, "warn", "Sentence case copy should end with a full stop");
    const cut = (p) => `“${E().trim(p.text.replace(/\^\d+/g, ""), 50)}”`;
    set("case-punctuation", titleStop.length ? "fail" : noStop.length ? "warn" : (paras.length ? "pass" : "review"),
      [titleStop.length && `Title Case with a full stop: ${titleStop.slice(0, 2).map(cut).join(", ")}.`,
       noStop.length && `Sentence case without a full stop: ${noStop.slice(0, 2).map(cut).join(", ")}.`].filter(Boolean).join(" ") ||
       (paras.length ? "Every sentence-case line ends with a full stop, and no Title Case line has one." : noText));

    // "Log in"
    const logins = find(/\blog\s?-?in\b/gi);
    const badLogin = logins.filter((m) => m[0] !== "Log in");
    for (const m of logins) markAt(m.index, m[0].length, badLogin.includes(m) ? "fail" : "pass", badLogin.includes(m) ? "Should read “Log in”" : "✓ Log in");
    set("log-in-case", !logins.length ? "na" : badLogin.length ? "fail" : "pass",
      !logins.length ? "No “Log in” in the copy." : badLogin.length ? `Found ${badLogin.map(quote).join(", ")} — should be “Log in”.` : "“Log in” is in sentence case.");

    // "Card" with a capital C
    const lowerCard = find(/\bcards?\b/g);
    for (const m of lowerCard) markAt(m.index, m[0].length, "warn", "“Card” takes a capital C");
    set("card-capital", lowerCard.length ? "warn" : (hasText ? "pass" : "review"),
      lowerCard.length ? `${lowerCard.length} lowercase “card”: ${lowerCard.slice(0, 3).map((m) => around(m.index, m[0].length)).join(", ")}.` : (hasText ? "Every “Card” has a capital C." : noText));

    // Card fee — shown for the reviewer; checked automatically when the brief states it
    const fees = find(/annual\s+(?:membership\s+)?(?:renewal\s+)?fee[^₹\d\n]{0,12}(₹|Rs\.?\s?)\s?([\d,]+)/gi);
    const cardNames = [...new Set(cards.map((m) => m[2].replace(/\s+/g, " ")))];
    for (const m of fees.slice(0, 3)) markAt(m.index, m[0].length, "info", "Fee — confirm it matches the Card");
    set("card-fee", "review", fees.length
      ? `States ${[...new Set(fees.map((m) => "₹" + m[2]))].join(", ")}${cardNames.length ? ` for ${cardNames.join(" / ")}` : ""} — confirm against the Card's current fee. Put the fee in the brief and it's checked automatically.`
      : (hasText ? "No annual fee stated — confirm whether this mailer needs one." : noText));

    // Footer links in Title Case
    const fl = find(/\b(privacy(?:\s+(?:statement|policy))?|contact\s+us|update\s+(?:your\s+)?email|unsubscribe)\b/gi)
      .filter((m) => lines[lineAt(m.index)].text.split(/\s+/).length <= 10);
    const badFl = fl.filter((m) => !m[0].split(/\s+/).every((w) => /^[A-Z]/.test(w)));
    const haveFl = new Set(fl.map((m) => m[1].toLowerCase().replace(/\s+/g, " ").replace(/ (statement|policy)$/, "").replace("your ", "")));
    const missingFl = ["privacy", "contact us", "update email"].concat(ctx.mailerType === "servicing" ? [] : ["unsubscribe"]).filter((n) => !haveFl.has(n));
    for (const m of fl) markAt(m.index, m[0].length, badFl.includes(m) ? "fail" : "pass", badFl.includes(m) ? "Footer link not in Title Case" : "✓ Footer link");
    const title = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    set("footer-links", !fl.length ? (hasText ? "warn" : "review") : badFl.length ? "fail" : missingFl.length ? "warn" : "pass",
      !fl.length ? (hasText ? "No footer links (Privacy, Contact Us, Update Email…) found in the text." : noText)
        : [badFl.length && `Not Title Case: ${badFl.map(quote).join(", ")}.`, missingFl.length && `Missing: ${missingFl.map(title).join(", ")}.`].filter(Boolean).join(" ") ||
          `${fl.map((m) => m[0]).join(" · ")} — all Title Case.`);

    // Asterisks the same colour as the copy around them — compared on rendered pixels
    const pairs = [];
    for (const l of lines) {
      const main = l.spans.filter((s) => !s.sup && !/^[\s*†‡]*$/.test(l.text.slice(s.start, s.end))).sort((a, z) => (z.end - z.start) - (a.end - a.start))[0];
      if (!main) continue;
      for (const s of l.spans) {
        const t = l.text.slice(s.start, s.end);
        const idxs = s.sup ? [-1] : [...t.matchAll(/[*†‡]/g)].map((m) => m.index);
        for (const k of idxs) {
          const a = s.sup ? rectFor(l, s.start, s.end) : rectFor(l, s.start + k, s.start + k + 1);
          if (a && pairs.length < 40) pairs.push({ page: l.page, a, b: rectFor(l, main.start, main.end), at: starts[lines.indexOf(l)] + s.start + Math.max(0, k), len: s.sup ? s.end - s.start : 1 });
        }
      }
    }
    if (!pairs.length) set("asterisk-colour", "na", "No asterisks or footnote markers in the copy.");
    else {
      let dist = [];
      try { dist = await inkDistance(r.pdf, pairs); } catch (_) {}
      const measured = pairs.filter((p, i) => dist[i] != null);
      const off = pairs.filter((p, i) => dist[i] != null && dist[i] > 80);
      for (const p of off) markAt(p.at, p.len, "warn", "Marker colour differs from the copy");
      set("asterisk-colour", !measured.length ? "review" : off.length ? "warn" : "pass",
        !measured.length ? "Couldn't sample marker colours — check by eye." : off.length
          ? `${off.length} of ${measured.length} marker(s) look a different colour from the copy beside them: ${off.slice(0, 3).map((p) => around(p.at, p.len)).join(", ")}.`
          : `${measured.length} marker(s) sampled — all match the colour of the copy beside them.`);
    }

    // Visual brand items — AI vision or a reviewer
    set("logo-registered", "review", "The logo is artwork — confirm the registered ® American Express logo is used.");
    const dll = find(/don'?t\s+live\s+life/gi)[0];
    set("dll-colour", "review", dll ? "“Don't live life” is live text — confirm it uses the Card's colour." : "The “Don't live life” tagline is artwork — confirm it uses the Card's colour.");
    set("header-grammar", "review", headers.length ? `Headers to read: ${headers.slice(0, 5).map((l) => `“${E().trim(l.text, 40)}”`).join(", ")}.` : "No live-text headers — check headers inside images.");

    // 26. Mobile — straight from the handbook measurements
    set("mobile", r.counts.fail ? "warn" : "pass", r.counts.fail ? `${r.counts.fail} handbook error(s) — handbook score ${r.score}%. See the findings below.` : `No handbook errors — handbook score ${r.score}%.`);

    // Where a pattern sits on the page — used to point brief requirements at the preview.
    const locate = (re, max) => {
      const hits = [];
      for (const m of joined.matchAll(re)) {
        const i = lineAt(m.index), s = m.index - starts[i];
        const rect = rectFor(lines[i], s, Math.min(lines[i].text.length, s + m[0].length));
        if (rect) hits.push({ page: lines[i].page, rect });
        if (hits.length >= (max || 3)) break;
      }
      return hits;
    };

    return {
      items: ITEMS.map((it) => ({ id: it.id, ...out[it.id] })),
      marks, text: lines.map((l) => l.text).join("\n"), locate
    };
  }

  // Share of rendered pixels that are neutral grey (not white, not black, not coloured).
  async function greyShare(pdf) {
    let grey = 0, total = 0;
    for (let p = 1; p <= Math.min(pdf.numPages, 4); p++) {
      const page = await pdf.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 240 / base.width });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const L = 0.299 * r + 0.587 * g + 0.114 * b, sat = Math.max(r, g, b) - Math.min(r, g, b);
        total++;
        if (sat < 16 && L > 70 && L < 236) grey++;
      }
    }
    return total ? Math.round((grey / total) * 100) : 0;
  }

  // Mean colour of the ink inside each rect (pixels that clearly differ from the rect's
  // background), compared between a marker and the copy beside it. Returns distances.
  async function inkDistance(pdf, pairs) {
    const out = new Array(pairs.length).fill(null);
    const pages = [...new Set(pairs.map((p) => p.page))];
    for (const pg of pages) {
      const page = await pdf.getPage(pg);
      const vp = page.getViewport({ scale: 2 });
      const c = document.createElement("canvas");
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const ink = (rect) => {
        const [x0, y0] = pdfjsLib.Util.applyTransform([rect[0], rect[3]], vp.transform);
        const [x1, y1] = pdfjsLib.Util.applyTransform([rect[2], rect[1]], vp.transform);
        const X = Math.max(0, Math.floor(Math.min(x0, x1))), Y = Math.max(0, Math.floor(Math.min(y0, y1)));
        const w = Math.min(c.width - X, Math.ceil(Math.abs(x1 - x0))), h = Math.min(c.height - Y, Math.ceil(Math.abs(y1 - y0)));
        if (w < 1 || h < 1) return null;
        const px = ctx.getImageData(X, Y, w, h).data;
        const bg = [px[0], px[1], px[2]];
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) < 150) continue;
          r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
        }
        return n >= 3 ? [r / n, g / n, b / n] : null;
      };
      pairs.forEach((p, i) => {
        if (p.page !== pg) return;
        const A = ink(p.a), B = ink(p.b);
        if (A && B) out[i] = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
      });
      c.width = c.height = 0;
    }
    return out;
  }

  // AI verdicts replace "review" items; a confident AI verdict on an auto item is kept
  // as a second opinion in the evidence rather than overriding the measurement.
  function mergeAI(items, results) {
    const byId = Object.fromEntries((results || []).map((x) => [x.id, x]));
    return items.map((it) => {
      const a = byId[it.id];
      if (!a) return it;
      if (it.method === "manual" || it.status === "review") {
        return a.status === "unsure"
          ? { ...it, evidence: `${it.evidence} · ✦ AI unsure: ${a.evidence}` }
          : { ...it, status: a.status, method: "ai", evidence: `✦ ${a.evidence}` };
      }
      return { ...it, aiNote: a.evidence, aiStatus: a.status };
    });
  }

  return { ITEMS, run, mergeAI, label: (id) => (ITEMS.find((i) => i.id === id) || {}).label || id };
})();
