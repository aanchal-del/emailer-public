/* Thresholds + full coverage map, taken directly from the
   American Express "Mobile Optimisation" handbook (pages cited). */
window.RULEBOOK = {
  thresholds: {
    // Typography (p3, p4)
    fontMinPx: 12,
    headingMinPx: 18, headingMaxPx: 32,
    h1Px: 28, h2Px: 18,                       // recommended desktop
    h1MobilePx: 22, h2MobilePx: 16,           // recommended mobile
    bodyMinPx: 14, bodyMaxPx: 16,
    bodyMobileMinPx: 12, bodyMobileMaxPx: 14,
    legalPx: 12,
    lineHeightMin: 1.4, lineHeightMax: 1.5,

    // Content length (p6)
    preheaderMin: 40, preheaderMax: 50,
    heroHeadlineMin: 25, heroHeadlineMax: 45, heroHeadlineHard: 60,
    heroBodyMin: 90, heroBodyMax: 180, heroBodyHard: 250,
    moduleHeadlineMin: 20, moduleHeadlineMax: 50,
    moduleBodyMin: 120, moduleBodyMax: 300,
    paragraphMaxLines: 2,

    // CTA (p12)
    ctaMaxChars: 22, ctaMaxWords: 3, ctaFontPx: 15,

    // Spacing (p5) — desktop / mobile
    spacingMinPx: 15,                          // absolute readable floor
    sectionGapPx: 30, sectionGapMobilePx: 20,
    stackedGapPx: 20,
    headingToCopyPx: 15,
    copyToCtaPx: 15,

    // Images (p3)
    fileMaxBytes: 2 * 1024 * 1024,
    // "Don't upload high-resolution images if they are displayed smaller."
    // 2× is legitimate retina; beyond that the bytes are wasted.
    imageOversampleMax: 2.5,

    // Fonts (p11)
    nonWebSafeFonts: ["guardian", "benton"],
    maxFontFamilies: 4,

    // Geometry gate — a mailer export is portrait & a sane width in points
    emailMinWidthPt: 280, emailMaxWidthPt: 900
  },

  // Glyphs the handbook says must NOT trail CTA copy (p12: "no glyph arrows after the copy")
  ctaTrailingGlyphs: /[>»→›➔➜▶]+\s*$/,
  ctaVerbs: /\b(now|shop|buy|book|refer|apply|learn|explore|get|redeem|view|rsvp|register|discover|know\s?more|read\s?more|sign\s?up|join|claim|activate|start|order|reserve|download|enrol|enroll|upgrade|renew)\b/i,

  // FULL coverage matrix — every handbook rule and how Emailer handles it.
  // mode: "auto" = measured & scored · "obs" = heuristic observation (not scored)
  //       · "manual" = visual, must be reviewed by a human
  coverage: [
    { cat: "Objective", page: "p2",  mode: "principle", rule: "Clean · Consistent · Readable · Scalable" },
    { cat: "Objective", page: "p2",  mode: "principle", rule: "Mobile-first, thumb-friendly, fast to read" },

    { cat: "Typography", page: "p3–4", mode: "auto",   rule: "Never below 12px" },
    { cat: "Typography", page: "p4",   mode: "auto",   rule: "Body copy 14–16px (mobile 12–14px)" },
    { cat: "Typography", page: "p3–4", mode: "auto",   rule: "Headings 18–32px (H1≈28, H2≈18)" },
    { cat: "Typography", page: "p4",   mode: "principle", rule: "Mobile sizes: H1 22px, H2 16px" },
    { cat: "Typography", page: "p4",   mode: "auto",   rule: "Legal text 12px" },
    { cat: "Typography", page: "p4",   mode: "auto",   rule: "Line-height 1.4–1.5×" },

    { cat: "Content length", page: "p6", mode: "obs",  rule: "Preheader 40–50 chars" },
    { cat: "Content length", page: "p6", mode: "obs",  rule: "Hero headline 25–45 (max 60)" },
    { cat: "Content length", page: "p6", mode: "obs",  rule: "Hero body 90–180 (max 250)" },
    { cat: "Content length", page: "p6", mode: "obs",  rule: "Module headline 20–50 chars" },
    { cat: "Content length", page: "p6", mode: "auto", rule: "Module body 120–300 chars" },
    { cat: "Content length", page: "p6", mode: "auto", rule: "Paragraphs ≤ 2 lines" },

    { cat: "CTAs", page: "p12", mode: "obs",    rule: "Copy 1–3 words" },
    { cat: "CTAs", page: "p12", mode: "obs",    rule: "≈22 characters incl. spaces" },
    { cat: "CTAs", page: "p12", mode: "obs",    rule: "Title Case" },
    { cat: "CTAs", page: "p12", mode: "obs",    rule: "No glyph arrows after copy" },
    { cat: "CTAs", page: "p12", mode: "obs",    rule: "Not too close to other clickable elements" },
    { cat: "CTAs", page: "p12", mode: "ai",     rule: "Height 40–44px, padding 16–24px" },
    { cat: "CTAs", page: "p12", mode: "ai",     rule: "Don't rely only on text links" },
    { cat: "CTAs", page: "p12", mode: "manual", rule: "Primary/secondary/tertiary styles" },

    { cat: "Fonts", page: "p11", mode: "auto",  rule: "Web-safe only (no Guardian/Benton Sans)" },
    { cat: "Fonts", page: "p11", mode: "auto",  rule: "Limited font variety" },

    { cat: "Images & GIFs", page: "p3", mode: "auto",   rule: "Assets ≤ 2 MB" },
    { cat: "Images & GIFs", page: "p3", mode: "auto",   rule: "No high-res assets displayed smaller" },
    { cat: "Images & GIFs", page: "p3", mode: "obs",    rule: "Prefer live text over text-in-image" },
    { cat: "Images & GIFs", page: "p3", mode: "ai",     rule: "Compressed without quality loss" },
    { cat: "Images & GIFs", page: "p3", mode: "obs",    rule: "Avoid too many image-heavy sections" },
    { cat: "Images & GIFs", page: "p3", mode: "obs",    rule: "Optimized image dimensions (painted size)" },
    { cat: "Images & GIFs", page: "p3", mode: "manual", rule: "Prefer static where animation not needed" },
    { cat: "Images & GIFs", page: "p3", mode: "manual", rule: "GIF animation weight / compression" },
    { cat: "Images & GIFs", page: "p3", mode: "manual", rule: "Test load speed; don't assume fast networks" },

    { cat: "Spacing", page: "p5", mode: "obs",       rule: "≥15px between elements (floor)" },
    { cat: "Spacing", page: "p5", mode: "obs",       rule: "Section spacing 30px desktop / 20px mobile" },
    { cat: "Spacing", page: "p5", mode: "obs",       rule: "Between stacked elements 20px" },
    { cat: "Spacing", page: "p5", mode: "obs",       rule: "Heading→copy 15px · copy→CTA 15px" },
    { cat: "Spacing", page: "p5", mode: "principle", rule: "Whitespace sets hierarchy; flag congestion early" },

    { cat: "Layout", page: "p13–15", mode: "obs",       rule: "Columns must stack to 1-column" },
    { cat: "Layout", page: "p13–15", mode: "principle", rule: "1-col unchanged · 2/3-col → 1 · 4-col → 2 or 1" },
    { cat: "Layout", page: "p13",    mode: "obs",       rule: "No horizontal scroll / bleed images" },
    { cat: "Layout", page: "p13",    mode: "ai",        rule: "No connected / overlapping columns" },
    { cat: "Layout", page: "p13",    mode: "ai",        rule: "No bg image spanning multiple columns" },
    { cat: "Layout", page: "p23",    mode: "obs",       rule: "Standard rectangular modules" },
    { cat: "Layout", page: "p15",    mode: "principle", rule: "If it can't stack to 1-col, don't use it" },

    { cat: "Shapes & coding", page: "p10–11", mode: "auto",      rule: "No vector gradients / shadings" },
    { cat: "Shapes & coding", page: "p10",    mode: "principle", rule: "Codeable: solid bg, border, rounded card, image, CTA, 1–3 col" },
    { cat: "Shapes & coding", page: "p11",    mode: "ai",        rule: "Shadows / blur baked into images" },
    { cat: "Shapes & coding", page: "p11",    mode: "obs",       rule: "No overlapping / custom shapes" },
    { cat: "Shapes & coding", page: "p11",    mode: "obs",       rule: "No text + logo on the same line" },
    { cat: "Shapes & coding", page: "p11",    mode: "manual",    rule: "No image carousel" },
    { cat: "Shapes & coding", page: "p8",     mode: "principle", rule: "Reserve custom shapes for image-only heroes" },
    { cat: "Shapes & coding", page: "p3",     mode: "ai",        rule: "Text-in-image breaks dark mode" },

    { cat: "Dark mode", page: "p16–17", mode: "ai",     rule: "Strong contrast, works when inverted" },
    { cat: "Dark mode", page: "p16–17", mode: "ai",     rule: "Transparent bg, live text, visible icons" },
    { cat: "Dark mode", page: "p16–17", mode: "ai",     rule: "No light-grey / low-contrast text" },
    { cat: "Dark mode", page: "p16–17", mode: "manual", rule: "Don't assume parity across platforms" },

    { cat: "Understanding coding", page: "p10",    mode: "principle", rule: "Prefer codeable blocks: solid bg, borders, cards, simple CTA, 1–3 col" },
    { cat: "Common challenges",    page: "p18–21", mode: "principle", rule: "Connected columns & mixed image/code sections cause imbalance" },
    { cat: "Way forward",          page: "p19,23", mode: "principle", rule: "Design every block to stack; codeable before decorative" },

    // American Express Brand & Compliance Rules
    { cat: "Brand Requirements", page: "amex", mode: "principle", rule: "Power of Trust statement must appear in all mailers" },
    { cat: "Brand Requirements", page: "amex", mode: "principle", rule: "India's most trusted credit card brand — 11 years in a row" },
    { cat: "Brand Requirements", page: "amex", mode: "auto", rule: "Registered trademark ® on all American Express references" },
    { cat: "Brand Requirements", page: "amex", mode: "principle", rule: "Use American Express® branding consistently" },

    { cat: "Typography", page: "amex", mode: "obs", rule: "Headers in Title Case (first letter of all words capitalized)" },
    { cat: "Typography", page: "amex", mode: "obs", rule: "Sentence case copy must end with full stop (period)" },
    { cat: "Typography", page: "amex", mode: "obs", rule: "Title case copy must NOT have full stop" },
    { cat: "Typography", page: "amex", mode: "obs", rule: "Card Member (two words), not Cardmember" },
    { cat: "Typography", page: "amex", mode: "obs", rule: "Card Membership (two words)" },
    { cat: "Typography", page: "amex", mode: "obs", rule: "American Express® cannot be split across lines" },
    { cat: "Typography", page: "amex", mode: "auto", rule: "T&Cs Apply — T, C & A in uppercase" },
    { cat: "Typography", page: "amex", mode: "obs", rule: "Prefer UK English spelling unless specified" },

    { cat: "Special Characters", page: "amex", mode: "auto", rule: "Asterisks on all numbers with footnotes" },
    { cat: "Special Characters", page: "amex", mode: "obs", rule: "Asterisks NOT hyperlinked, same color as body copy" },
    { cat: "Special Characters", page: "amex", mode: "obs", rule: "Superscripts match relevant body copy pointers" },
    { cat: "Special Characters", page: "amex", mode: "obs", rule: "Log In (Sentence Case)" },

    { cat: "Content Length", page: "amex", mode: "auto", rule: "Pre-header ends with full stop (period)" },
    { cat: "Content Length", page: "amex", mode: "obs", rule: "Pre-header left-aligned and vertically centered" },
    { cat: "Content Length", page: "amex", mode: "obs", rule: "Pre-header balanced with No images copy length" },

    { cat: "Card Names", page: "amex", mode: "obs", rule: "Card names in single line, never split or cut off" },
    { cat: "Card Names", page: "amex", mode: "obs", rule: "Card names grammatically correct" },
    { cat: "Card Names", page: "amex", mode: "principle", rule: "Plat Charge creatives: SK signature at end of body" },
    { cat: "Card Names", page: "amex", mode: "principle", rule: "Port Cards: American Express Banking Corp. at end of body" },

    { cat: "Hyperlinks", page: "amex", mode: "obs", rule: "Click Here — 'Here' must be hyperlinked" },
    { cat: "Hyperlinks", page: "amex", mode: "obs", rule: "All relevant text links must be active" },

    { cat: "Footer", page: "amex", mode: "auto", rule: "Address: DLF City Phase II format required" },
    { cat: "Footer", page: "amex", mode: "obs", rule: "Address with proper line breaks" },
    { cat: "Footer", page: "amex", mode: "obs", rule: "American Express Banking Corp. right-aligned" },
    { cat: "Footer", page: "amex", mode: "auto", rule: "© 2026 American Express Company. All rights reserved." },
    { cat: "Footer", page: "amex", mode: "auto", rule: "® Registered trademark of American Express Company" },
    { cat: "Footer", page: "amex", mode: "principle", rule: "Servicing mailer: NO Unsubscribe in footer" },
    { cat: "Footer", page: "amex", mode: "obs", rule: "Standard mailer footer: Privacy, Contact Us, Update Email, Unsubscribe" },
    { cat: "Footer", page: "amex", mode: "obs", rule: "Footer links in Title Case" },

    { cat: "Images", page: "amex", mode: "obs", rule: "Images must be Indian in context" },
    { cat: "Images", page: "amex", mode: "principle", rule: "Source images from Brand Box first" },
    { cat: "Images", page: "amex", mode: "obs", rule: "Registered American Express logo on all card emailers" },

    { cat: "Design Principles", page: "amex", mode: "principle", rule: "Avoid excessive use of grey in creative" },
    { cat: "Design Principles", page: "amex", mode: "principle", rule: "Avoid box layouts — use icons instead" },
    { cat: "Design Principles", page: "amex", mode: "principle", rule: "Use icons to represent benefits and features" },
    { cat: "Design Principles", page: "amex", mode: "principle", rule: "Card color used for Don't live life tagline" },
    { cat: "Design Principles", page: "amex", mode: "obs", rule: "Maintain primary brand blue with card-specific accents" },

    { cat: "CTAs", page: "amex", mode: "principle", rule: "CTA button present depending on emailer type" },
    { cat: "CTAs", page: "amex", mode: "obs", rule: "CTA matches emailer purpose (Apply, Learn, Discover, etc.)" },

    { cat: "Content Quality", page: "amex", mode: "principle", rule: "All copy free of spelling, grammar, punctuation errors" },
    { cat: "Content Quality", page: "amex", mode: "principle", rule: "Body copy clear, concise, benefit-focused" },
    { cat: "Content Quality", page: "amex", mode: "principle", rule: "Benefits highlighted prominently with icons" },
    { cat: "Content Quality", page: "amex", mode: "obs", rule: "Line breaks must make sense — no awkward cuts" },

    { cat: "Mobile Optimization", page: "amex", mode: "obs", rule: "All content remains readable on mobile" },
    { cat: "Mobile Optimization", page: "amex", mode: "obs", rule: "Card names fit on single line mobile" }
  ]
};
