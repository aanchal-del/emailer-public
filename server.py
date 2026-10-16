#!/usr/bin/env python3
"""Static server for Emailer, plus a proxy for the optional Claude vision pass.

The API key is read from the environment (or .env) and stays in this process —
it is never sent to the browser. Without a key the app still runs; the vision
button just reports that the pass is unavailable.
"""
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import List, Literal
from urllib.parse import parse_qs, quote, unquote, urlparse

MODEL = "claude-opus-5-5"
MAX_PAGES = 8          # cost guard — pages beyond this are reported, not analysed
MAX_UPLOAD = 32 * 1024 * 1024

RULES = """\
THE AMERICAN EXPRESS MOBILE OPTIMISATION HANDBOOK (mailers) — complete.

OBJECTIVE
  Clean · Consistent · Readable · Scalable. Mobile-first, thumb-friendly, fast to
  read. Mobile is a design-stage concern, not a development-stage fix.

TYPOGRAPHY
  Never use a font size below 12px — absolute.
                    desktop        mobile
  H1 (primary)      28px           22px
  H2 (subheading)   18px           16px
  Body / paragraph  14-16px        12-14px
  Legal text        12px           12px
  Headings overall 18-32px. Line-height 1.4-1.5x the font size (a 16px font needs
  22-24px leading).

CONTENT LENGTH
  Preheader 40-50 chars. Hero headline 25-45 (max 60). Hero body 90-180 (max 250).
  Module headline 20-50. Module body 120-300. Paragraphs max 2 lines.

SPACING (desktop / mobile) — never drop below 15px
  Section spacing 30 / 20. Between stacked elements 20 / 20.
  Heading to copy 15 / 15. Copy to CTA 15 / 15.
  Use whitespace for hierarchy. Don't overcrowd, don't shrink spacing to fit copy,
  don't make text blocks dense or hard to scan.

IMAGES & GIFs
  Max 2 MB — the heavier the image the slower the load. Compress without visible
  quality loss. Use dimensions matched to actual display size. Prefer static images
  where animation isn't required.
  Don't: heavy/long GIFs; high-resolution assets displayed smaller; too many
  image-heavy sections; trading load speed for visual effects; assuming everyone is
  on a fast network.

CTAs
  Buttons at least 40-44px tall for thumb tapping. Horizontal padding 16-24px.
  Copy short and clear, 1-3 words preferred (~22 chars). Title Case. No glyph
  arrows after the copy.
  Don't: buttons too small or text-heavy; buttons too close to other clickable
  elements; thin padding or compressed button styles; relying only on text links
  for primary actions.

SHAPES & CODEABILITY
  Codeable: solid background, simple border, simple rounded card, normal image,
  simple CTA, simple 1/2/3-column layout.
  NOT codeable: gradients and shadows; blur effects; overlapping shapes; unusual
  shapes and custom treatments; Guardian or Benton Sans (non-web-safe, limited
  client support); text and a logo on the same line; image carousels.
  Reserve distinctive shapes for sections exported as images only, such as hero
  banners. Live text and text inside images render differently. Text embedded in
  an image renders IDENTICALLY in light and dark mode — dark mode adaptation
  becomes impossible.

COLUMN LAYOUT
  1-col stays 1-col. 2-col and 3-col stack to 1-col. 4-col stacks to 2 or 1.
  Avoid: connected layouts that depend on columns staying side by side; large
  background images spanning multiple columns; overlapping elements between
  columns; designs that break when columns stack; layouts needing horizontal
  scrolling.
  Principle: if a section cannot work as a stacked single column, it should not be
  used in an email at all.

DARK MODE
  Do: design for light AND dark; strong text/background contrast; transparent
  backgrounds where possible; important content as live text, not inside images;
  icons, logos and illustrations must stay visible when inverted.
  Don't: rely only on white backgrounds; fixed text colours that invert poorly;
  light grey or low-contrast text; important information inside images only;
  assume dark mode behaves the same on every platform; use elements that break
  when colours are automatically inverted.

KNOWN FAILURE PATTERNS (observed in past mailers)
  Connected multi-column designs that can't stack, so they get exported as images.
  Complex shapes and decorative borders that email CSS can't express, so they get
  exported as images.
  Mixed image and coded sections, which causes visual imbalance — image sections
  render smaller while coded sections render larger.

THE WAY FORWARD
  Design every section assuming it will stack to one column. Keep columns visually
  independent. Standard rectangular modules. Live text over image text. Avoid
  image-only implementations. Keep spacing sufficient to support stacking. Consider
  dark mode while designing. Codeable before decorative.
"""

SYSTEM = f"""\
You are the visual reviewer in a two-layer email compliance checker, reviewing one
rendered page of an American Express mailer against the Mobile Optimisation handbook.

{RULES}

## What the other layer already knows — never repeat it

A deterministic parser reads the PDF's internals and has ALREADY measured, exactly:
  - every text run's font size in px, line-height, character and word counts, and
    font family (including Guardian / Benton Sans);
  - CTA wording: length, word count, Title Case, trailing arrow glyphs;
  - every raster image's painted size, position, and whether its asset resolution
    is larger than the size it displays at;
  - every stencil (1-bit mask) logo;
  - every vector logo, icon and graphic's size and position;
  - vector gradient/shading fills;
  - overlapping graphics, and text sitting on the same line as a logo;
  - multi-column bands, block spacing, and the file's total weight.

Those numbers are exact and yours would be guesses. Never report a px font size,
a character count, a CTA's wording, or "there is a logo/image here". The user is
shown your findings alongside the measured ones; a duplicate is worse than
silence, because it makes the exact layer look unreliable.

The user message lists what was already detected on this page. Treat that list as
ground truth about WHERE things are and WHAT they are. Your job is what those
boxes cannot say: how the pixels actually LOOK.

## What only you can see — hunt for this

1. TEXT BAKED INTO AN IMAGE. The highest-value finding you can make. The parser is
   blind to it, so it cannot be measured, it will not scale on mobile, it will not
   invert for dark mode, and screen readers cannot read it. If a region of live
   text is conspicuously absent from the detected list but you can plainly read
   words there, that text is baked in — say so, and quote the words.
2. CONTRAST AND DARK MODE. Light text on a light field, dark on dark, text laid
   over a busy photo, a logo or icon that disappears when inverted, or artwork
   relying on a white background that will not be white in dark mode.
3. SHADOWS, BLUR, GLOWS OR GRADIENTS RENDERED INSIDE AN IMAGE. The parser catches
   vector gradients only; anything baked into a raster is yours alone. All of these
   are on the handbook's non-codeable list.
4. STRUCTURE THAT CANNOT STACK. Connected columns that depend on sitting side by
   side; a background image spanning several columns; non-rectangular or decorative
   modules; content that would collide or reorder nonsensically at one column.
   Remember the principle: if a section can't work stacked, it shouldn't be used.
5. MIXED IMAGE AND CODED SECTIONS. The handbook flags the visual imbalance this
   causes — image-built sections rendering smaller than coded ones. If some modules
   are clearly flat artwork and others are live text, say so.
6. CTA STYLING ONLY. A button too short or cramped against the 40-44px height /
   16-24px padding rule; a CTA that is not styled as a button at all and reads as a
   bare text link (the handbook says don't rely on text links for primary actions);
   or buttons crowded against other clickable elements. Never its wording.
7. IMAGE QUALITY. Visible pixelation, compression artefacts, or a stretched or
   squashed aspect ratio — the handbook asks for compression without visible
   quality loss.

## Severity — follow the handbook's own language

  fail = breaks an absolute ("never below 12px", "web-safe only", "no glyph
         arrows"), or is unreadable/invisible in a common client.
  warn = outside a recommended range, or a genuine mobile or dark-mode risk.
  info = worth the reviewer's eye, but not a violation.

## Output discipline

  - `box` is [x0, y0, x1, y1] in PIXELS of the image you were given, origin at the
    TOP-LEFT. Tight around the element you are describing — the box is drawn on
    the page and a loose one points at the wrong thing.
  - `label` under 60 characters; it is rendered on top of the artwork.
  - `explanation`: one or two sentences on what you SAW and why it matters in an
    email client. No hedging, no restating the rule.
  - Report only what you can actually see. Do not infer a problem from an absence,
    and do not pad the list to look thorough. An empty list is a valid, useful
    answer, and is much better than a plausible guess.
"""


def load_env() -> None:
    env = Path(__file__).with_name(".env")
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


load_env()


def _schema():
    """Built lazily so the server still boots without the SDK installed."""
    from pydantic import BaseModel

    class Finding(BaseModel):
        label: str
        severity: Literal["fail", "warn", "info"]
        rule: str
        explanation: str
        box: List[int]

    class PageFindings(BaseModel):
        findings: List[Finding]

    return PageFindings


def _known_block(page):
    """What the exact layer already found on this page, in the image's own pixels."""
    known = page.get("known") or []
    if not known:
        return ("Nothing was detected on this page by the exact layer — so if you can read "
                "text here, ALL of it is baked into an image. That is a major finding.")
    lines = "\n".join(
        f"  - {k['label']} at [{k['box'][0]}, {k['box'][1]}, {k['box'][2]}, {k['box'][3]}]"
        for k in known[:120])
    more = f"\n  …and {len(known) - 120} more." if len(known) > 120 else ""
    return ("Already detected and measured on this page (same pixel coordinates as the "
            f"image). Do not re-report these:\n{lines}{more}")


def analyse_page(client, page):
    """One Claude call per page. Returns a list of finding dicts."""
    PageFindings = _schema()
    response = client.messages.parse(
        model=MODEL,
        max_tokens=16000,
        system=SYSTEM,
        thinking={"type": "adaptive"},
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64",
                                             "media_type": "image/png",
                                             "data": page["png"]}},
                {"type": "text", "text": (
                    f"Page {page['page']} of {page.get('pages', '?')}, rendered at "
                    f"{page['w']}x{page['h']} pixels.\n\n"
                    f"{_known_block(page)}\n\n"
                    "Review the image and report only what those boxes cannot express — "
                    "how it actually looks. Anything legible that is NOT in the list above "
                    "is text baked into an image; that is the first thing to check."
                )},
            ],
        }],
        output_format=PageFindings,
    )
    if response.stop_reason == "refusal":
        return []
    out = []
    for f in response.parsed_output.findings:
        if len(f.box) != 4:
            continue
        out.append({"page": page["page"], "label": f.label, "severity": f.severity,
                    "rule": f.rule, "explanation": f.explanation, "box": f.box,
                    "imgW": page["w"], "imgH": page["h"]})
    return out


_STATUS = {"at": 0.0, "value": None}


def ai_status():
    """Whether the key actually works — a present-but-rejected key must read as off."""
    import time
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return {"available": False, "model": MODEL,
                "reason": "No ANTHROPIC_API_KEY in .env"}
    if _STATUS["value"] and time.time() - _STATUS["at"] < 120:
        return _STATUS["value"]
    try:
        import anthropic
        anthropic.Anthropic().models.list(limit=1)
        value = {"available": True, "model": MODEL, "reason": ""}
    except ImportError:
        value = {"available": False, "model": MODEL,
                 "reason": "Anthropic SDK not installed — run .venv/bin/pip install anthropic"}
    except Exception as e:
        reason = "API key rejected by Anthropic — update ANTHROPIC_API_KEY in .env and restart" \
            if "401" in str(e) or "authentication" in str(e).lower() else f"{type(e).__name__}: {e}"
        value = {"available": False, "model": MODEL, "reason": reason}
    _STATUS.update(at=time.time(), value=value)
    return value


BRIEF_SYSTEM = """\
You read creative briefs for American Express India email campaigns (mailers). Briefs
arrive as Excel forms, Word documents, decks, PDFs or screenshots, and are often messy:
placeholder cells like "<Choose from the drop down>", internal admin fields, and several
campaigns in one workbook. Ignore placeholders and admin plumbing (owners, ECR/HTML dates,
distribution channels) unless they change what the mailer must say.

Requirements are things a reviewer can verify by reading the finished mailer: offer
amounts, points, fees, dates, CTA wording, mandatory callouts, card names, disclaimers,
personalisation, things that must NOT appear. Write each one as a short, checkable
statement that quotes exact figures and wording from the brief. Never invent figures.
"""

REFRAME_SYSTEM = BRIEF_SYSTEM + """
Rewrite the brief as a detailed, production-ready email script a copywriter and designer
can execute without reopening the brief. Use these sections, in plain text with clear
headings: Campaign summary; Audience & variants; Subject line (3 options); Preheader
(40-50 characters, ends with a full stop); Hero headline (25-45 characters, Title Case);
Hero body (90-180 characters); Modules (one per benefit: headline 20-50 characters + body);
CTA (1-3 words, Title Case, no arrows); Footnotes & T&Cs (asterisk/superscript plan);
Mandatory items checklist; Open questions for the client. Keep every figure exactly as
the brief states it. American Express® takes the ® on first mention; write Card Member as
two words; use UK English.
"""

BRAND_SYSTEM = """\
You are checking a rendered American Express India mailer against house brand rules.

House rules (from the brand and client-servicing teams):
- Pre-header ends with a full stop; left-aligned and vertically centred in the grey band,
  level with "No images? View this online." on the right.
- "Don't live life" tagline uses the respective Card's colour. Avoid excessive grey.
- Headers in Title Case and grammatically correct. Sentence-case copy ends with a full
  stop; Title Case copy has none. UK English. No spelling, grammar or punctuation errors.
- Card Member / Card Membership are two words; "Card" always has a capital C.
- Images are Indian in context (Brand Box first). Use icons; avoid boxed layouts.
- Asterisks are not hyperlinked and match the body copy colour; superscripts match their
  footnote pointers. "T&Cs Apply" with T, C and A in capitals.
- Plat Charge creatives carry the SK signature; other cards end the body copy with
  "American Express Banking Corp.". The registered ® American Express logo is used.
- Card fee must be the right one for the Card. Card names and "American Express®" are
  never split across lines. Power of Trust statement in every mailer.
- Servicing mailers have no Unsubscribe; footer links are Title Case.
For each rule you are given, look at the page images and the extracted live text and
decide: pass, fail, warn (a risk worth a human's eye), or unsure (you genuinely cannot
tell from what you see). Quote the exact words or describe the exact region you based the
verdict on. Do not guess: "unsure" is better than a confident wrong answer, because a
human signs off on this.
"""

BRIEF_CHECK_SYSTEM = BRIEF_SYSTEM + """
You are now comparing brief requirements with the finished mailer's live text. Each
requirement carries a priority: 1 is the most recent brief (a change brief) and overrides
anything older that it contradicts. For each requirement decide: found, partial, missing,
conflict (the mailer says something different), or superseded (a higher-priority
requirement replaces it). Quote the mailer wording you relied on in the note.
"""


def _client():
    import anthropic
    return anthropic.Anthropic()


def brief_analyse(body):
    from pydantic import BaseModel

    class Req(BaseModel):
        text: str
        kind: Literal["fact", "cta", "date", "flag", "theme", "instruction"]
        field: str

    class BriefOut(BaseModel):
        summary: List[str]
        requirements: List[Req]

    content = []
    if body.get("image"):
        content.append({"type": "image", "source": {"type": "base64",
                        "media_type": body["image"]["media_type"], "data": body["image"]["data"]}})
    content.append({"type": "text", "text": (
        f"Brief title: {body.get('title', '')}\n\n"
        f"Brief text:\n{(body.get('text') or '(see image)')[:60000]}\n\n"
        "Return a 5-8 line summary (one line per point, most important first) and the "
        "list of checkable requirements.")})
    r = _client().messages.parse(model=MODEL, max_tokens=8000, system=BRIEF_SYSTEM,
                                 messages=[{"role": "user", "content": content}],
                                 output_format=BriefOut)
    out = r.parsed_output
    return {"summary": out.summary, "requirements": [q.model_dump() for q in out.requirements]}


def brief_reframe(body):
    content = []
    if body.get("image"):
        content.append({"type": "image", "source": {"type": "base64",
                        "media_type": body["image"]["media_type"], "data": body["image"]["data"]}})
    content.append({"type": "text", "text": (
        f"Brief title: {body.get('title', '')}\n\nBrief text:\n"
        f"{(body.get('text') or '(see image)')[:60000]}")})
    r = _client().messages.create(model=MODEL, max_tokens=8000, system=REFRAME_SYSTEM,
                                  messages=[{"role": "user", "content": content}])
    return {"script": "".join(b.text for b in r.content if b.type == "text").strip()}


def brand_check(body):
    from pydantic import BaseModel

    class Verdict(BaseModel):
        id: str
        status: Literal["pass", "fail", "warn", "unsure"]
        evidence: str

    class BrandOut(BaseModel):
        results: List[Verdict]

    content = []
    for p in (body.get("pages") or [])[:4]:
        content.append({"type": "image", "source": {"type": "base64",
                        "media_type": "image/png", "data": p["png"]}})
    rules = "\n".join(f"- {i['id']}: {i['label']}" + (f" ({i['hint']})" if i.get("hint") else "")
                      for i in body.get("items", []))
    content.append({"type": "text", "text": (
        f"Mailer type: {body.get('mailerType', 'marketing')}\n\nRules to check:\n{rules}\n\n"
        f"Extracted live text:\n{(body.get('text') or '')[:40000]}\n\n"
        "Return one verdict per rule id.")})
    r = _client().messages.parse(model=MODEL, max_tokens=8000, system=BRAND_SYSTEM,
                                 messages=[{"role": "user", "content": content}],
                                 output_format=BrandOut)
    return {"results": [v.model_dump() for v in r.parsed_output.results], "model": MODEL}


def brief_check(body):
    from pydantic import BaseModel

    class Result(BaseModel):
        id: str
        status: Literal["found", "partial", "missing", "conflict", "superseded"]
        note: str

    class CheckOut(BaseModel):
        results: List[Result]

    reqs = "\n".join(f"- [{q['id']}] (priority {q.get('priority', 1)}, brief "
                     f"\"{q.get('brief', '')}\") {q['text']}" for q in body.get("requirements", []))
    r = _client().messages.parse(
        model=MODEL, max_tokens=8000, system=BRIEF_CHECK_SYSTEM,
        messages=[{"role": "user", "content": (
            f"Requirements:\n{reqs}\n\nMailer live text:\n{(body.get('mailerText') or '')[:40000]}\n\n"
            "Return one result per requirement id.")}],
        output_format=CheckOut)
    return {"results": [x.model_dump() for x in r.parsed_output.results], "model": MODEL}


ROUTES = {"/api/brief": lambda b: brief_reframe(b) if b.get("action") == "reframe" else brief_analyse(b),
          "/api/brand": brand_check,
          "/api/brief-check": brief_check}


"""Shared storage, mirroring netlify/functions/data.mjs, so everyone using this server
sees the same projects. Records are JSON files under data/ (kept out of git)."""
DATA = Path(__file__).with_name("data")
STORES = {"projects", "mailers", "briefs", "reviews", "events"}
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
DATA_LOCK = threading.Lock()


def _rec_path(store, rid, pid):
    return DATA / "rec" / "projects" / f"{rid}.json" if store == "projects" \
        else DATA / "rec" / store / pid / f"{rid}.json"


def _bump(pid):
    v = f"{time.time():.6f}"
    for name in (pid or "_none", "_all"):
        p = DATA / "ver" / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(v)


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/api/vision", "/api/status"):
            # Lets the page show or hide AI features without exposing the key.
            return self._json(200, {**ai_status(), "shared": True})
        if self.path.startswith(("/api/data/", "/api/files/", "/api/version")):
            return self._storage("GET")
        return super().do_GET()

    def do_PUT(self):
        return self._storage("PUT")

    def do_DELETE(self):
        return self._storage("DELETE")

    def _storage(self, method):
        url = urlparse(self.path)
        parts = [unquote(p) for p in url.path.split("/") if p]
        project = parse_qs(url.query).get("project", [None])[0]
        kind = parts[1] if len(parts) > 1 else ""
        if project and not SAFE_ID.match(project):
            return self._json(400, {"error": "Bad project id"})
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0)) if method == "PUT" else b""
        with DATA_LOCK:
            if kind == "version":
                p = DATA / "ver" / (project or "_all")
                return self._json(200, {"v": p.read_text() if p.exists() else "0"})

            if kind == "data":
                store = parts[2] if len(parts) > 2 else ""
                rid = parts[3] if len(parts) > 3 else None
                if store not in STORES:
                    return self._json(404, {"error": "Unknown store"})
                if rid and not SAFE_ID.match(rid):
                    return self._json(400, {"error": "Bad id"})
                if method == "GET" and not rid:
                    base = DATA / "rec" / store
                    if store != "projects" and project:
                        base = base / project
                    files = base.rglob("*.json") if base.exists() else []
                    return self._json(200, [json.loads(f.read_text()) for f in files])
                if method == "GET":
                    if store != "projects" and not project:
                        return self._json(400, {"error": "project is required"})
                    p = _rec_path(store, rid, project)
                    return self._json(200, json.loads(p.read_text())) if p.exists() else self._json(404, {"error": "Not found"})
                if method == "PUT":
                    try:
                        rec = json.loads(body)
                    except Exception:
                        return self._json(400, {"error": "Bad JSON"})
                    pid = rid if store == "projects" else rec.get("projectId")
                    if rec.get("id") != rid or not pid or not SAFE_ID.match(pid):
                        return self._json(400, {"error": "Record id / projectId missing or mismatched"})
                    p = _rec_path(store, rid, pid)
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_text(json.dumps(rec))
                    _bump(pid)
                    return self._json(200, {"ok": True})
                if method == "DELETE":
                    pid = rid if store == "projects" else project
                    if not pid:
                        return self._json(400, {"error": "project is required"})
                    _rec_path(store, rid, pid).unlink(missing_ok=True)
                    _bump(pid)
                    return self._json(200, {"ok": True})

            if kind == "files":
                fid = parts[2] if len(parts) > 2 else ""
                if not SAFE_ID.match(fid):
                    return self._json(400, {"error": "Bad file id"})
                blob, meta = DATA / "files" / fid, DATA / "files" / f"{fid}.meta.json"
                if method == "GET":
                    if not blob.exists():
                        return self._json(404, {"error": "File not found"})
                    m = json.loads(meta.read_text()) if meta.exists() else {}
                    data = blob.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", m.get("type") or "application/octet-stream")
                    self.send_header("X-File-Name", quote(m.get("name") or fid))
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                if method == "PUT":
                    blob.parent.mkdir(parents=True, exist_ok=True)
                    blob.write_bytes(body)
                    meta.write_text(json.dumps({"name": unquote(self.headers.get("X-File-Name") or fid),
                                                "type": self.headers.get("Content-Type") or "", "size": len(body)}))
                    return self._json(200, {"ok": True})
                if method == "DELETE":
                    blob.unlink(missing_ok=True)
                    meta.unlink(missing_ok=True)
                    return self._json(200, {"ok": True})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/api/vision" and self.path not in ROUTES:
            return self._json(404, {"error": "not found"})
        status = ai_status()
        if not status["available"]:
            return self._json(503, {"error": status["reason"]})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_UPLOAD:
            return self._json(413, {"error": "Request too large."})
        try:
            body = json.loads(self.rfile.read(length))
        except Exception as e:
            return self._json(400, {"error": f"Bad request: {e}"})

        if self.path in ROUTES:
            try:
                return self._json(200, ROUTES[self.path](body))
            except Exception as e:
                print(f"{self.path} error: {type(e).__name__}: {e}", file=sys.stderr)
                return self._json(502, {"error": f"{type(e).__name__}: {e}"})

        pages = body.get("pages") or []

        skipped = max(0, len(pages) - MAX_PAGES)
        pages = pages[:MAX_PAGES]
        try:
            import anthropic
            client = anthropic.Anthropic()
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda p: analyse_page(client, p), pages))
        except ImportError:
            return self._json(503, {"error": "Anthropic SDK not installed — run "
                                             ".venv/bin/pip install anthropic"})
        except Exception as e:
            print(f"vision error: {type(e).__name__}: {e}", file=sys.stderr)
            return self._json(502, {"error": f"{type(e).__name__}: {e}"})

        findings = [f for page in results for f in page]
        return self._json(200, {"findings": findings, "pagesAnalysed": len(pages),
                                "pagesSkipped": skipped, "model": MODEL})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
    status = ai_status()
    print(f"Emailer running at  http://localhost:{port}/workspace.html  (Ctrl+C to stop)")
    print(f"AI features: {'on (' + MODEL + ')' if status['available'] else 'off — ' + status['reason']}")
    ThreadingHTTPServer(("", port), Handler).serve_forever()
