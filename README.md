# Emailer — Mailer Mobile-Optimisation Checker

A simple, fully local web page. Upload an exported email/mailer **PDF** and Emailer
scores it against the American Express *Mobile Optimisation* handbook, then lists
exactly what passes and what's missing.

## Run it

```bash
./start.sh          # serves at http://localhost:8099 and opens your browser
# or a custom port:
./start.sh 3000
```

It must be **served** (the bundled `start.sh` uses Python's built-in server) rather
than opened as a `file://` — browsers block the PDF worker on `file://`.

Nothing is uploaded anywhere — the PDF is parsed entirely in your browser with a
locally bundled copy of PDF.js (`vendor/`).

## What it checks (from the handbook)

- **Typography** — nothing below 12px, headings 18–32px, body 14–16px
- **Fonts** — flags non-web-safe fonts (Guardian / Benton Sans), excessive variety
- **Content length** — hero/module headline & body limits, overlong paragraphs
- **CTAs** — short 1–3 word copy, ~22 characters
- **Images vs. live text** — warns when sections look image-based (breaks dark mode)
- **File weight** — 2 MB asset guideline

It also lists items that **can't** be read from a PDF (section spacing, GIF weight,
dark-mode contrast, real mobile stacking, text baked into images) for manual review.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page markup |
| `styles.css` | Styling |
| `rules.js` | Thresholds + rulebook content (edit here to tune rules) |
| `app.js` | PDF parsing, rules engine, scoring, report |
| `vendor/` | Bundled PDF.js (no CDN needed) |
