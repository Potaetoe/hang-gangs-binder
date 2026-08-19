/*
 * The custom-palette apparatus: apps/web/theme-init.js's pure half
 * (0.9-M2-S6, #82).
 *
 *     node tests/custom-palette.test.mjs
 *
 * Subject: BinderCustomPalette.derive() and .contrastProblems() - the
 * math a member's own background and accent are turned into a full
 * palette by, and the honesty check that decides whether the picker
 * warns - plus theme-init.js's pre-paint side effect, which is where
 * VALIDATE ON READ (the 0.9-M2-S6 security mandate) actually lives: a
 * hand-corrupted stored value has to paint nothing, not merely fail to
 * validate on write.
 *
 * WHY THIS IS ONE ARM RATHER THAN TWO. derive() and contrastProblems()
 * are pure and load under plain Node with no stub at all; the pre-paint
 * block needs a document/localStorage stand-in. Splitting them into two
 * files would cost a reader the thing worth seeing in one place: the
 * SAME derive() and contrastProblems() the math section measures
 * directly are what the pre-paint section watches decide, through
 * nothing more than localStorage, whether a page paints.
 *
 * THE ORACLE. "Validated ... by the same rules the shipped palettes
 * pass ... using the toolbox's contrast calculator" (the mandate's own
 * words) is checked twice here: section 1 recomputes a handful of
 * ratios with a WCAG formula written independently in this file - the
 * same arithmetic tools/check_contrast.py and the toolbox's contrast.mjs
 * both use - and asserts BinderCustomPalette.ratio() agrees, so this
 * arm is not merely trusting the module's own arithmetic about itself.
 * Section 2 then uses derive()/contrastProblems() as the oracle for the
 * mutation-evidence claim the DoD asks for: a pair with real separation
 * derives to zero problems, a pair with almost none derives to at least
 * one - both directions, from real theme.css palettes and a synthetic
 * bad one.
 *
 * SECTION 4 NOW COVERS theme.js's click handler - the VALIDATE ON READ
 * gate a reviewer's real-browser repro found missing there (0.9-M2-S6
 * fix wave 1, F1, #82). This sentence used to exclude "theme.js's DOM
 * wiring" wholesale and call it "exercised in a real browser instead" -
 * that exclusion is what let the click site ship the same trust-the-
 * raw-string bug Section 3 already held theme-init.js's pre-paint block
 * to, unnoticed until a human clicked it by hand. Section 4 loads the
 * real shipped apps/web/theme.js under a small stub document, the same
 * pattern tests/door.test.mjs uses for apps/web/auth.js, and simulates
 * the click.
 *
 * STILL NOT COVERED: the two <input type="color"> elements' own
 * "input" listener (pickCustom()) and the contrast-warning paragraph's
 * hidden attribute. Those are plumbing around derive()/contrastProblems(),
 * which Sections 1-2 already prove correct as functions - what would be
 * new here is DOM wiring with no decision in it, and it stays exercised
 * in a real browser; the completion record labels that verification by
 * hand.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (path) => readFile(HERE(path), "utf8");

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* ------------------------------------------------------------------ */
/* Section 0: load the pure half under plain Node - no document, no     */
/* localStorage, so the pre-paint block's own try/catch absorbs the     */
/* ReferenceError and BinderCustomPalette is all this import leaves     */
/* behind.                                                              */

const themeInitSource = await read("../apps/web/theme-init.js");
await import("data:text/javascript," +
  encodeURIComponent(themeInitSource + "\n//pure-load"));
const CustomPalette = globalThis.BinderCustomPalette;

check("theme-init.js publishes BinderCustomPalette even with no document",
  !!CustomPalette);
check("the namespace is frozen",
  Object.isFrozen(CustomPalette));

/* ------------------------------------------------------------------ */
/* Section 1: isValidHex, and the independent WCAG oracle.              */

check("a lowercase 6-digit hex is valid",
  CustomPalette.isValidHex("#120d10"));
check("an uppercase 6-digit hex is valid (input[type=color] never emits "
  + "one, but a hand-edited value might)",
  CustomPalette.isValidHex("#C73743"));
check("a 3-digit shorthand is refused - input[type=color] never emits "
  + "one either, so accepting it would be accepting a shape nothing "
  + "legitimate writes",
  !CustomPalette.isValidHex("#fff"));
check("a color keyword is refused", !CustomPalette.isValidHex("crimson"));
check("a bare word is refused", !CustomPalette.isValidHex("hello"));
check("an injection-shaped string is refused",
  !CustomPalette.isValidHex("javascript:alert(1)"));
check("a CSS-breakout-shaped string is refused",
  !CustomPalette.isValidHex("#120d10; background: url(evil)"));
check("the empty string is refused", !CustomPalette.isValidHex(""));
check("null is refused", !CustomPalette.isValidHex(null));
check("undefined is refused", !CustomPalette.isValidHex(undefined));
check("a number is refused", !CustomPalette.isValidHex(0x120d10));
check("an array is refused", !CustomPalette.isValidHex(["#120d10"]));
check("an object is refused", !CustomPalette.isValidHex({ bg: "#120d10" }));

// WCAG 2.x relative luminance and contrast ratio, written out again
// independently of theme-init.js's own copy - the same formula
// tools/check_contrast.py and the toolbox's contrast.mjs both use. This
// is the oracle section 2 trusts BinderCustomPalette.ratio() against.
function oracleLuminance(hex) {
  const n = hex.replace("#", "");
  const channels = [0, 2, 4].map((at) => parseInt(n.slice(at, at + 2), 16))
    .map((value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function oracleRatio(a, b) {
  const [hi, lo] = [oracleLuminance(a), oracleLuminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

const RATIO_PAIRS = [
  ["#f1e9e2", "#120d10"], // Midnight text on bg
  ["#000000", "#ffffff"], // the two rails
  ["#8e2530", "#f3eadb"], // Daylight accent on bg
  ["#c73743", "#c73743"], // identical - ratio 1
];
for (const [fg, bg] of RATIO_PAIRS) {
  const wanted = oracleRatio(fg, bg);
  const got = CustomPalette.ratio(fg, bg);
  check("ratio(" + fg + ", " + bg + ") agrees with the independent oracle "
    + "(" + got.toFixed(4) + " vs " + wanted.toFixed(4) + ")",
    Math.abs(got - wanted) < 1e-9);
}
check("two identical colors measure 1:1",
  CustomPalette.ratio("#c73743", "#c73743") === 1);
check("black on white measures the WCAG maximum, 21:1",
  Math.abs(CustomPalette.ratio("#000000", "#ffffff") - 21) < 1e-9);

/* ------------------------------------------------------------------ */
/* Section 2: derive() - the twenty-one tokens, and contrastProblems()  */
/* armed both directions.                                               */

const derived = CustomPalette.derive("#120d10", "#c73743");
const WANTED_TOKENS = [
  "--color-bg", "--color-surface", "--color-accent", "--color-accent-strong",
  "--color-text", "--color-text-muted", "--color-border",
  "--color-border-strong", "--color-warn-bg", "--color-warn-text",
  "--color-field", "--color-focus", "--color-accent-text", "--color-gold",
  "--color-on-accent", "--color-series-0", "--color-series-1",
  "--color-series-2", "--color-series-3", "--color-series-4",
  "--color-series-5",
];
check("derive() writes exactly the twenty-one tokens theme.css's other "
  + "four palettes hand-tune, no more and no fewer",
  Object.keys(derived).length === WANTED_TOKENS.length &&
  WANTED_TOKENS.every((name) => Object.prototype.hasOwnProperty.call(derived, name)));
check("every derived value is a valid 6-digit hex, including --color-field "
  + "which is set to the input verbatim",
  Object.values(derived).every((value) => CustomPalette.isValidHex(value)));
check("--color-bg and --color-field both echo the background exactly",
  derived["--color-bg"] === "#120d10" && derived["--color-field"] === "#120d10");
check("--color-accent echoes the accent exactly",
  derived["--color-accent"] === "#c73743");
check("--color-series-0 is the accent, theme.css's own convention for "
  + "every shipped palette",
  derived["--color-series-0"] === derived["--color-accent"]);

// PAIRINGS is exposed rather than reimplemented here - the same list
// contrastProblems() itself walks, so this section checks that the list
// IS check_contrast.py's AA pairing set (minus the two EXEMPT tokens
// that check's own docstring names), not merely that some list exists.
check("PAIRINGS covers the sixteen fixed pairs plus six series against "
  + "both surfaces - twenty-eight in total, the same count "
  + "tools/check_contrast.py's own PAIRINGS holds",
  CustomPalette.PAIRINGS.length === 16 + 6 * 2);
check("--color-accent-quiet is absent from PAIRINGS - color-mix() has no "
  + "fixed luminance to measure, check_contrast.py's own EXEMPT reason",
  !CustomPalette.PAIRINGS.some((p) => p.includes("--color-accent-quiet")));
check("--color-border is absent from PAIRINGS - decorative by rule, the "
  + "other EXEMPT reason",
  !CustomPalette.PAIRINGS.some((p) => p.includes("--color-border")
    && !p.includes("--color-border-strong")));
check("the AA thresholds and margin match check_contrast.py's own "
  + "(4.5 text, 3.0 mark, 0.1 margin)",
  CustomPalette.THRESHOLD.text === 4.5 && CustomPalette.THRESHOLD.mark === 3.0
    && CustomPalette.MARGIN === 0.1);

// theme.css's own four palettes' bg/accent pairs, READ off the shipped
// stylesheet rather than pinned - DERIVE, DO NOT PIN, tests/run.mjs's
// own header. Each is a real pair a member could type in, and each was
// chosen by a human for real contrast, so this is the "passing pair"
// half of the mutation-evidence claim: derive() given real, separated
// colors should reach a fully passing palette.
const themeCss = await read("../apps/web/theme.css");
function paletteBlock(css, selector) {
  const at = css.indexOf(selector);
  if (at === -1) return null;
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}
function colorsOf(block) {
  const bg = /--color-bg:\s*(#[0-9a-fA-F]{6})/.exec(block);
  const accent = /--color-accent:\s*(#[0-9a-fA-F]{6})/.exec(block);
  return bg && accent ? { bg: bg[1], accent: accent[1] } : null;
}
const SHIPPED_SELECTORS = {
  midnight: ':root[data-theme="midnight"]',
  pink: ':root[data-theme="pink"]',
  daylight: ':root[data-theme="daylight"]',
  contrast: ':root[data-theme="contrast"]',
};
const shippedPairs = {};
for (const [name, selector] of Object.entries(SHIPPED_SELECTORS)) {
  const block = paletteBlock(themeCss, selector);
  shippedPairs[name] = block && colorsOf(block);
}
check("all four shipped palettes' bg/accent pairs were read off theme.css",
  Object.values(shippedPairs).every((pair) => pair && pair.bg && pair.accent));

for (const [name, pair] of Object.entries(shippedPairs)) {
  if (!pair) continue;
  const tokens = CustomPalette.derive(pair.bg, pair.accent);
  const problems = CustomPalette.contrastProblems(tokens);
  check("derive(" + pair.bg + ", " + pair.accent + ") - " + name
    + "'s own real colors - clears every pairing (contrastProblems is "
    + "empty; got " + problems.length + ": "
    + problems.slice(0, 2).join(" | ") + ")",
    problems.length === 0);
}

// The failing-pair half. Two greys a hair apart in lightness, with no
// separation for anything derived from them to work with - the shape a
// member would actually produce by picking two clicks on the same spot
// in a color wheel, not an adversarial edge case.
const badTokens = CustomPalette.derive("#808080", "#7d7d7d");
const badProblems = CustomPalette.contrastProblems(badTokens);
check("derive() given two nearly-identical greys still returns a full "
  + "twenty-one-token palette rather than throwing",
  Object.keys(badTokens).length === WANTED_TOKENS.length);
check("contrastProblems() is non-empty for the nearly-identical pair - "
  + "the warning arm's other direction",
  badProblems.length > 0);

// The independent oracle again, this time over derive()'s OUTPUT rather
// than over hand-picked pairs - proving contrastProblems() is not just
// self-consistent with ratio() but with the WCAG formula itself.
for (const [name, pair] of Object.entries(shippedPairs)) {
  if (!pair) continue;
  const tokens = CustomPalette.derive(pair.bg, pair.accent);
  const [fg, bgToken] = CustomPalette.PAIRINGS[0];
  const wanted = oracleRatio(tokens[fg], tokens[bgToken]);
  const got = CustomPalette.ratio(tokens[fg], tokens[bgToken]);
  check(name + "'s derived text-on-bg ratio agrees with the independent "
    + "oracle", Math.abs(got - wanted) < 1e-9);
}

/* ------------------------------------------------------------------ */
/* Section 3: VALIDATE ON READ - theme-init.js's pre-paint side effect, */
/* against a stand-in document/localStorage. A hand-corrupted stored    */
/* value has to paint NOTHING, per the 0.9-M2-S6 security mandate and   */
/* the DoD's own words: "falls back to the named palette" - and with    */
/* custom having overwritten the record of which named palette that     */
/* was, the fallback is the same resting state a first-time visitor     */
/* gets: no data-theme attribute, no inline property.                   */

function stub(store) {
  const attrs = {};
  const styleProps = {};
  return {
    localStorage: {
      getItem: (key) => (key in store ? store[key] : null),
    },
    document: {
      documentElement: {
        setAttribute: (name, value) => { attrs[name] = value; },
        style: {
          setProperty: (name, value) => { styleProps[name] = value; },
          removeProperty: (name) => { delete styleProps[name]; },
        },
      },
    },
    attrs, styleProps,
  };
}

let tag = 0;
async function runPrePaint(store) {
  const box = stub(store);
  globalThis.localStorage = box.localStorage;
  globalThis.document = box.document;
  tag += 1;
  await import("data:text/javascript," +
    encodeURIComponent(themeInitSource + "\n//stub-load-" + tag));
  delete globalThis.localStorage;
  delete globalThis.document;
  return box;
}

// A. A valid custom pair paints data-theme="custom" and every derived
// token, matching an independent call to derive() with the same colors.
{
  const box = await runPrePaint({
    "hgb-palette": "custom",
    "hgb-custom-colors": JSON.stringify({ bg: "#120d10", accent: "#c73743" }),
  });
  const wanted = CustomPalette.derive("#120d10", "#c73743");
  check("a valid stored custom pair sets data-theme=\"custom\"",
    box.attrs["data-theme"] === "custom");
  check("a valid stored custom pair writes every derived token as an "
    + "inline custom property, matching an independent derive() call",
    WANTED_TOKENS.every((name) => box.styleProps[name] === wanted[name]));
}

// B. Corrupted JSON - not parseable at all.
{
  const box = await runPrePaint({
    "hgb-palette": "custom",
    "hgb-custom-colors": "{not json",
  });
  check("unparsable JSON in hgb-custom-colors sets no data-theme "
    + "attribute (falls back, paints nothing)",
    box.attrs["data-theme"] === undefined);
  check("unparsable JSON in hgb-custom-colors writes no inline property",
    Object.keys(box.styleProps).length === 0);
}

// C. Well-formed JSON, but the color shape is wrong (the case a hand
// edit in devtools actually produces: a plausible-looking string that
// is not #rrggbb).
{
  const box = await runPrePaint({
    "hgb-palette": "custom",
    "hgb-custom-colors": JSON.stringify({ bg: "javascript:alert(1)", accent: "#c73743" }),
  });
  check("a non-hex background in an otherwise well-formed record sets no "
    + "data-theme attribute",
    box.attrs["data-theme"] === undefined);
  check("a non-hex background writes no inline property",
    Object.keys(box.styleProps).length === 0);
}

// D. One field missing entirely.
{
  const box = await runPrePaint({
    "hgb-palette": "custom",
    "hgb-custom-colors": JSON.stringify({ bg: "#120d10" }),
  });
  check("a record missing the accent field sets no data-theme attribute",
    box.attrs["data-theme"] === undefined);
}

// E. hgb-palette says "custom" and nothing at all is stored for the
// colors - the "no saved custom palette" case the DoD's design-round
// answer names directly, not merely a malformed record.
{
  const box = await runPrePaint({ "hgb-palette": "custom" });
  check("hgb-palette=\"custom\" with no hgb-custom-colors at all sets no "
    + "data-theme attribute",
    box.attrs["data-theme"] === undefined);
}

// F. A named palette still works exactly as before - the regression
// check that this file's own changes to theme-init.js did not touch
// the four-palette path at all.
{
  const box = await runPrePaint({ "hgb-palette": "daylight" });
  check("a named palette still sets data-theme to that name, unchanged",
    box.attrs["data-theme"] === "daylight");
  check("a named palette writes no inline custom property - it has "
    + "nothing to override",
    Object.keys(box.styleProps).length === 0);
}

// G. No stored choice at all - the first-time-visitor resting state,
// also unchanged.
{
  const box = await runPrePaint({});
  check("no stored palette at all sets no data-theme attribute",
    box.attrs["data-theme"] === undefined);
}

/* ------------------------------------------------------------------ */
/* Section 4: theme.js's click handler - the second VALIDATE ON READ    */
/* call site (0.9-M2-S6 fix wave 1, F1, #82). A minimal stub document -  */
/* five buttons, one dot, one meta tag, no color inputs - is enough:    */
/* theme.js skips its <input type="color"> wiring entirely when         */
/* getElementById finds nothing, which is the truth for every id here.  */

function themeDomStub(store) {
  const localStorageStore = Object.assign({}, store);
  const styleProps = {};
  const documentElement = {
    _attrs: {},
    setAttribute(name, value) { this._attrs[name] = value; },
    style: {
      setProperty(name, value) { styleProps[name] = value; },
      removeProperty(name) { delete styleProps[name]; },
    },
  };
  const buttons = {};
  ["midnight", "pink", "daylight", "contrast", "custom"].forEach((name) => {
    const listeners = [];
    buttons[name] = {
      _pressed: null,
      getAttribute(attr) { return attr === "data-set-theme" ? name : null; },
      setAttribute(attr, value) { if (attr === "aria-pressed") this._pressed = value; },
      addEventListener(type, fn) { if (type === "click") listeners.push(fn); },
      click() { listeners.forEach((fn) => fn()); },
    };
  });
  const dot = { style: {} };
  const meta = { _content: null, setAttribute(n, v) { if (n === "content") this._content = v; } };
  return {
    localStorage: {
      getItem: (key) => (key in localStorageStore ? localStorageStore[key] : null),
      setItem: (key, value) => { localStorageStore[key] = String(value); },
    },
    document: {
      documentElement: documentElement,
      querySelectorAll(selector) {
        if (selector === "[data-set-theme]") return Object.values(buttons);
        if (selector === 'meta[name="theme-color"]') return [meta];
        return [];
      },
      querySelector(selector) {
        return selector === '.swatch-dot[data-palette="custom"]' ? dot : null;
      },
      // Every id this file asks for (custom-bg, custom-accent,
      // custom-contrast-warning) is absent - the color-input wiring
      // this stub does not carry, per this file's header.
      getElementById() { return null; },
    },
    buttons: buttons,
    documentElement: documentElement,
    meta: meta,
    store: localStorageStore,
  };
}

const themeJsSource = await read("../apps/web/theme.js");

async function runThemeClick(store, clickedName) {
  const box = themeDomStub(store);
  globalThis.window = globalThis;
  globalThis.document = box.document;
  globalThis.localStorage = box.localStorage;
  // Never exercised: paintCustomDot() falls to getComputedStyle() only
  // when no custom pair is on record, which every fixture below is
  // free to hit. A real value is not needed - nothing here reads the
  // dot's own painted color - so the stub returns empty strings.
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  tag += 1;
  await import("data:text/javascript," +
    encodeURIComponent(themeJsSource + "\n//theme-click-" + tag));
  box.buttons[clickedName].click();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.localStorage;
  delete globalThis.getComputedStyle;
  return box;
}

// The reviewer's exact repro (F1, #82 review): Daylight saved, no
// hgb-custom-colors record at all, one click on the Custom chip.
{
  const box = await runThemeClick({ "hgb-palette": "daylight" }, "custom");
  check("F1: clicking Custom with no valid stored pair leaves data-theme "
    + "on the named palette that was already active",
    box.documentElement._attrs["data-theme"] === "daylight");
  check("F1: the Custom chip does not read pressed",
    box.buttons.custom._pressed === "false");
  check("F1: the Daylight chip is still the one reading pressed",
    box.buttons.daylight._pressed === "true");
  check("F1: the meta theme-color still agrees with Daylight's own "
    + "background, not a stale or missing value",
    box.meta._content === "#f3eadb");
  check("F1: hgb-palette in storage still reads \"daylight\" - the "
    + "click did not overwrite it with \"custom\"",
    box.store["hgb-palette"] === "daylight");
  check("F1: no hgb-custom-colors record was written",
    !("hgb-custom-colors" in box.store));
}

// Same shape, no named palette on record at all (a first-time visitor
// who clicks Custom first) - the chip still declines to press and
// nothing is persisted.
{
  const box = await runThemeClick({}, "custom");
  check("F1, no prior choice: clicking Custom with no valid stored pair "
    + "and no named palette on record writes nothing to hgb-palette",
    !("hgb-palette" in box.store));
  check("F1, no prior choice: the Custom chip does not read pressed",
    box.buttons.custom._pressed === "false");
}

// Regression: a NAMED palette click is untouched by this fix.
{
  const box = await runThemeClick({ "hgb-palette": "daylight" }, "midnight");
  check("F1 regression: clicking a named palette still applies and "
    + "persists it",
    box.documentElement._attrs["data-theme"] === "midnight" &&
    box.store["hgb-palette"] === "midnight" &&
    box.buttons.midnight._pressed === "true");
}

// The other direction: a VALID stored custom pair still activates
// Custom on click - the fix narrows to "no valid pair", not "never".
{
  const box = await runThemeClick({
    "hgb-palette": "daylight",
    "hgb-custom-colors": JSON.stringify({ bg: "#120d10", accent: "#c73743" }),
  }, "custom");
  check("F1 other direction: clicking Custom WITH a valid stored pair "
    + "still applies and persists it",
    box.documentElement._attrs["data-theme"] === "custom" &&
    box.store["hgb-palette"] === "custom" &&
    box.buttons.custom._pressed === "true");
}

/* ------------------------------------------------------------------ */

const EXPECTED = 62;
console.log(failures
  ? "\ncustom-palette FAILED " + failures + " of " + performed + " check(s)"
  : performed !== EXPECTED
    ? "\ncustom-palette ran " + performed + " checks, expected " + EXPECTED
    : "\ncustom-palette OK - " + performed + " checks");
process.exit(failures || performed !== EXPECTED ? 1 : 0);
