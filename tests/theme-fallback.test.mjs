/*
 * apps/web/theme.js and apps/web/theme-init.js, driven under Node - the
 * shared fallback behavior neither file's own page-specific suite
 * covers, because both scripts run on every page.
 *
 * TWO PROPERTIES LIVE HERE NOW:
 *
 * 1. The 0.9-M2-S14 (#380 ruling 2) one this file was built for: a
 *    member whose stored palette choice reads "custom" - the retired
 *    theme, or a hand-edited value - falls back to the resting palette
 *    on load. No crash, no half-applied state (data-theme never reads
 *    "custom" on the page), on both scripts alike.
 *
 * 2. The 0.9-M3-S32 (#456) one added here rather than forked into a new
 *    file, since both properties are the same question - "what does a
 *    member with no usable stored choice of their own get?" - answered
 *    by the same two scripts in the same order: a member with no saved
 *    choice gets the phone's own light-or-dark scheme, nothing more
 *    (owner ruling, UX record #454 item 15, 2026-08-22), and the picker
 *    pre-selects the admin's configured default without repainting
 *    anything. This SUPERSEDES 0.9-M3-S12's (#418) "admin default from
 *    the second load" rule - the arms that pinned it are rewritten
 *    below, named where they change, not deleted silently.
 *
 *     node tests/theme-fallback.test.mjs
 *
 * WHY A NEW FILE RATHER THAN A REPAIR, historically. tests/custom-
 * palette.test.mjs retired in the same change that first created this
 * file - its whole subject, BinderCustomPalette, is gone with the
 * custom theme it derived colors for. What survives of that suite's job
 * is exactly property 1 above, on the two files that used to share it;
 * this file was that property's new, narrower home, not a patch on the
 * old one - and property 2 belongs beside it rather than in a third
 * file, since it is answered by the same read order on the same two
 * scripts.
 *
 * A SMALL HAND-BUILT STUB, not jsdom (#75's rejection applies here as
 * everywhere else in this directory): both scripts touch only
 * document.documentElement (setAttribute/getAttribute), a NodeList of
 * palette buttons, a NodeList of theme-color <meta> tags, localStorage,
 * and - since 0.9-M3-S32 - window.matchMedia, stubbed directly rather
 * than through a general-purpose DOM.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFile(HERE(p), "utf8");

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

const themeInitSrc = await read("../apps/web/theme-init.js");
const themeSrc = await read("../apps/web/theme.js");

function storage(initial) {
  const data = new Map(Object.entries(initial || {}));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

function documentElementStub() {
  const attrs = {};
  return {
    setAttribute: (name, value) => { attrs[name] = String(value); },
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attrs, name)
      ? attrs[name] : null),
  };
}

function buttonStub(name) {
  const attrs = { "data-set-theme": name };
  return {
    getAttribute: (key) => (Object.prototype.hasOwnProperty.call(attrs, key)
      ? attrs[key] : null),
    setAttribute: (key, value) => { attrs[key] = String(value); },
    addEventListener: () => {},
  };
}

/*
 * window.matchMedia, stubbed to answer exactly the one query both
 * scripts ask - "(prefers-color-scheme: dark)" - since 0.9-M3-S32
 * dropped the prefers-contrast check from the first-visit decision
 * (owner ruling, UX record #454 item 15: "the phone decides light or
 * dark, nothing more"). darkMatches undefined means no matchMedia
 * support at all - a browser that cannot answer the question, which
 * the ruling's "no preference" resolves to light exactly the way an
 * answerable "not dark" query does; both scripts already had to fold
 * the two together (see schemeDefault() in either file), and keeping
 * them as two different stub shapes here is what proves the fold
 * happens on purpose rather than by the two cases looking alike.
 */
function matchMediaFor(darkMatches) {
  return function (query) {
    return { matches: darkMatches === true && query.indexOf("dark") !== -1 };
  };
}

/*
 * Runs both scripts fresh against one stored value - theme-init.js
 * first (the pre-paint script, blocking in a real <head>), then
 * theme.js (the end-of-body wiring) - the same order every page loads
 * them in, matching PREPAINT_SCRIPT's own seed in
 * tools/check_web.py's loading_problems().
 */
async function driven(storedPalette, defaultTheme, darkMatches) {
  const documentElement = documentElementStub();
  const metas = [{ attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } }];
  const buttons = ["midnight", "pink", "daylight", "contrast"]
    .map(buttonStub);

  const g = globalThis;
  // defaultTheme, optional: the admin's configured resting palette
  // (0.9-M3-S8, #414), the same key apps/web/site-content.js writes
  // from GET /config. Existing callers pass one argument and get
  // exactly today's behavior - this key is simply absent, the same as
  // a fork that has never learned one.
  const initial = {};
  if (storedPalette !== undefined) initial["hgb-palette"] = storedPalette;
  if (defaultTheme !== undefined) initial["hgb-default-theme"] = defaultTheme;
  g.localStorage = storage(initial);
  g.document = {
    documentElement,
    querySelectorAll: (selector) => (selector === "[data-set-theme]"
      ? buttons : selector === 'meta[name="theme-color"]' ? metas : []),
  };
  // No global matchMedia at all when darkMatches is undefined - the
  // "no preference, no signal" case both files' schemeDefault() folds
  // into light. When it is boolean, both `window.matchMedia` (the
  // truthiness check) and the bare `matchMedia` global (the actual
  // call - both files invoke it unqualified, matching real browser
  // code where window IS the global object) have to answer, or the
  // call throws past the outer try/catch in theme-init.js and is
  // silently swallowed - which would make a broken stub look like a
  // passing test for the wrong reason.
  if (darkMatches === undefined) {
    g.window = {};
    delete g.matchMedia;
  } else {
    const mm = matchMediaFor(darkMatches);
    g.window = { matchMedia: mm };
    g.matchMedia = mm;
  }

  await import("data:text/javascript," +
    encodeURIComponent(themeInitSrc) + "#theme-init-" + Math.random());
  await import("data:text/javascript," +
    encodeURIComponent(themeSrc) + "#theme-" + Math.random());

  return { documentElement, metas, buttons };
}

function pressedOnly(buttons, name) {
  return buttons.find((b) => b.getAttribute("data-set-theme") === name)
    .getAttribute("aria-pressed") === "true" &&
    buttons.filter((b) => b.getAttribute("data-set-theme") !== name)
      .every((b) => b.getAttribute("aria-pressed") === "false");
}

/* ------------------------------------------------------------------ */
/* CONTROL: a real, named stored choice is honored by both scripts,     */
/* regardless of the phone's scheme or any cached admin default - "a    */
/* saved choice wins on every later load" (UX record #454 item 15).     */

{
  const { documentElement, buttons } = await driven("pink", "daylight", true);
  check("CONTROL: a real stored palette is painted by theme-init.js's " +
    "pre-paint script",
    documentElement.getAttribute("data-theme") === "pink");
  check("...and theme.js's own load-time confirm marks that same chip " +
    "pressed, not the cached admin default it also sees",
    pressedOnly(buttons, "pink"));
}

/* ------------------------------------------------------------------ */
/* FIRST VISIT FOLLOWS THE PHONE (owner ruling, UX record #454 item 15; */
/* 0.9-M3-S32, #456): with no saved choice, dark paints dark, light      */
/* paints light, and no preference paints light - the ticket's own       */
/* three named cases, each with a differently-shaped matchMedia stub so  */
/* "light" and "no preference" are proven independently rather than      */
/* relying on one stub standing in for both.                             */

{
  const { documentElement } = await driven(undefined, undefined, true);
  check("no stored choice, phone prefers dark -> the plain dark palette",
    documentElement.getAttribute("data-theme") === "midnight");
}

{
  const { documentElement } = await driven(undefined, undefined, false);
  check("no stored choice, phone answers matchMedia but not with dark " +
    "(prefers light) -> the plain light palette",
    documentElement.getAttribute("data-theme") === "daylight");
}

{
  const { documentElement } = await driven(undefined, undefined, undefined);
  check("no stored choice, no matchMedia support at all (no preference " +
    "the phone can report) -> the plain light palette, the ruling's " +
    "own words for \"no preference\"",
    documentElement.getAttribute("data-theme") === "daylight");
}

/* ------------------------------------------------------------------ */
/* THE ARM: "custom" falls back to the resting scheme palette, no        */
/* crash - not the fixed "midnight" 0.9-M3-S12 pinned, since the         */
/* resting palette is scheme-based now (rewritten, 0.9-M3-S32, #456).    */

{
  const { documentElement, metas, buttons } =
    await driven("custom", undefined, undefined);
  check("a stored choice of \"custom\" never reaches data-theme=\"custom\" " +
    "- theme-init.js's pre-paint script paints the resting scheme " +
    "palette instead of guessing at a palette it no longer derives",
    documentElement.getAttribute("data-theme") === "daylight");
  check("the browser-chrome meta color is painted too - a corrupted " +
    "stored value does not leave stale chrome behind",
    metas[0].attrs.content !== undefined);
  check("the resting palette's own chip - the one actually applied - " +
    "is the one marked pressed, and only that one",
    pressedOnly(buttons, "daylight"));
}

{
  const { documentElement } = await driven("custom", undefined, true);
  check("the same corrupted \"custom\" value, under a phone that " +
    "prefers dark, falls to the dark half of the same resting rule - " +
    "proving the fallback reads the scheme rather than returning a " +
    "fixed palette",
    documentElement.getAttribute("data-theme") === "midnight");
}

/* ------------------------------------------------------------------ */
/* #456 F4, CARRIED TO 0.9-M3-S33 PART B: a stored "hgb-palette" value  */
/* naming NO real palette - not "custom", not one of the four known      */
/* names, a typo or a hand-edited value or a future name this build      */
/* predates - must not paint verbatim either. Before this fix, theme-    */
/* init.js's own guard excluded only the literal string "custom" and     */
/* let everything else through unchecked, so an unknown value painted    */
/* straight onto the page and then flashed to the real resting palette   */
/* a moment later when theme.js's own already-validated read (the BG     */
/* map check, this file's line ~110) corrected it - a dark-to-light or   */
/* light-to-dark flash a member would see on every load until they       */
/* picked a real palette. "banana" is the canary: a distinctive value    */
/* nothing else in this repository uses as a real setting.                */

{
  const { documentElement, metas, buttons } =
    await driven("banana", undefined, undefined);
  check("a stored choice naming no real palette never reaches " +
    "data-theme=\"banana\" - theme-init.js's pre-paint script paints " +
    "the resting scheme palette instead of guessing at an unknown value",
    documentElement.getAttribute("data-theme") === "daylight");
  check("the browser-chrome meta color is painted too - an unknown " +
    "stored value does not leave stale chrome behind",
    metas[0].attrs.content !== undefined);
  check("the resting palette's own chip - the one actually applied - " +
    "is the one marked pressed, and only that one",
    pressedOnly(buttons, "daylight"));
}

{
  const { documentElement } = await driven("banana", undefined, true);
  check("the same unknown value, under a phone that prefers dark, falls " +
    "to the dark half of the same resting rule - proving the fallback " +
    "reads the scheme rather than returning a fixed palette",
    documentElement.getAttribute("data-theme") === "midnight");
}

/* ------------------------------------------------------------------ */
/* THE ADMIN'S DEFAULT PAINTS AGAIN (owner ruling 2026-08-24). This arm  */
/* has now been written three times, and the history is the point.       */
/* 0.9-M3-S12 (#418) pinned that a cached admin default PAINTS once      */
/* learned. 0.9-M3-S32 (#456), under UX record #454 item 15, reversed    */
/* it: read for the picker's pre-selection only, never reaching          */
/* data-theme. That is what shipped - and the owner then set the site    */
/* default to Daylight on the sit, watched a dark phone keep painting    */
/* midnight, and reported the setting as doing nothing, while the admin  */
/* page's own help text promised it was "what a new visitor sees". The   */
/* ruling of 2026-08-24 puts the paint back, one rank below the member's */
/* own choice and one above the phone.                                   */
/*                                                                       */
/* A scheme and an admin default that DISAGREE (dark phone, "pink"       */
/* admin default) is still the only honest shape here: it proves which   */
/* of the two actually decided, where a same-value fixture would pass    */
/* whichever way the code went.                                          */

{
  const { documentElement, metas, buttons } =
    await driven(undefined, "pink", true);
  check("a cached admin default PAINTS before first paint, outranking " +
    "the phone's dark preference - the setting an admin saves is what " +
    "a visitor who has not chosen actually sees",
    documentElement.getAttribute("data-theme") === "pink");
  check("theme.js's own load-time confirm agrees with theme-init.js on " +
    "what PAINTED - a mismatch here is the flash both files exist to " +
    "prevent, and repainting to the phone's scheme here is exactly the " +
    "flash the old split would have caused once the paint moved",
    documentElement.getAttribute("data-theme") === "pink");
  check("the browser-chrome meta color follows the painted admin " +
    "default, not the phone's own scheme palette",
    metas[0].attrs.content !== undefined);
  check("the picker's pressed chip is the palette actually on the page " +
    "- \"pink\" - so the swatch and the page can no longer disagree",
    pressedOnly(buttons, "pink"));
}

{
  // A member's OWN saved choice still wins over the admin's configured
  // default, on both what paints and what the picker shows pressed -
  // "a saved choice wins on every later load" (UX record #454 item 15),
  // unchanged by the picker-pre-selection mechanism landing beside it.
  const { documentElement, buttons } =
    await driven("pink", "daylight", true);
  check("a member's own stored palette outranks a cached admin default",
    documentElement.getAttribute("data-theme") === "pink");
  check("...and the picker marks the member's own chip pressed, not " +
    "the admin default",
    pressedOnly(buttons, "pink"));
}

{
  // A cached value naming no palette either script knows - corrupted
  // localStorage, or a future config value this build predates - never
  // reaches the picker's pre-selection, the same discipline a stored
  // "custom" choice already gets above. It cannot reach painting either
  // way, now that the admin default is never painted regardless of
  // validity.
  const { documentElement, buttons } =
    await driven(undefined, "neon", true);
  check("an admin default naming a palette neither script knows still " +
    "paints the resting scheme palette",
    documentElement.getAttribute("data-theme") === "midnight");
  check("...and the picker falls back to marking that same resting " +
    "chip pressed, not a chip named \"neon\"",
    pressedOnly(buttons, "midnight"));
}

{
  // S8's GET /config contract (0.9-M3-S8, #414, comment 5370945709):
  // site.defaultTheme may come back "" for "unset", which apps/web/
  // site-content.js's cacheDefaultTheme() already refuses to cache (a
  // door.test.mjs check proves that half). This is the belt this file
  // holds beside that suspenders - a "" that reached storage some other
  // way is still not a value either script paints or pre-selects, the
  // same falsy read an absent key gets.
  const { documentElement, buttons } =
    await driven(undefined, "", true);
  check("a cached empty string is read the same as no cached value at " +
    "all, per S8's \"unset\" contract for GET /config",
    documentElement.getAttribute("data-theme") === "midnight");
  check("...and the picker pre-selects the resting chip, not an empty " +
    "one",
    pressedOnly(buttons, "midnight"));
}

/*
 * THE NO-PICKER BRANCH (fix wave 1, review comment 5379013364 on #456,
 * finding F2). driven() above always wires four palette buttons, so it
 * never exercises theme.js's `if (!buttons.length)` branch - the one
 * path 404.html actually runs, since it is the one shipped page with no
 * palette control (see theme.js's own header comment on "the error page
 * is the one page here with no palette control"). The reviewer replaced
 * that branch's `paintChrome(stored || schemeDefault())` with
 * `paintChrome("pink")` and every existing check stayed green. This
 * drives the same two scripts, in the same order, with an empty button
 * list, so the branch runs for real.
 */
async function drivenNoPicker(storedPalette, defaultTheme, darkMatches) {
  const documentElement = documentElementStub();
  const metas = [{ attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } }];

  const g = globalThis;
  const initial = {};
  if (storedPalette !== undefined) initial["hgb-palette"] = storedPalette;
  if (defaultTheme !== undefined) initial["hgb-default-theme"] = defaultTheme;
  g.localStorage = storage(initial);
  g.document = {
    documentElement,
    querySelectorAll: (selector) => (selector === "[data-set-theme]"
      ? [] : selector === 'meta[name="theme-color"]' ? metas : []),
  };
  if (darkMatches === undefined) {
    g.window = {};
    delete g.matchMedia;
  } else {
    const mm = matchMediaFor(darkMatches);
    g.window = { matchMedia: mm };
    g.matchMedia = mm;
  }

  await import("data:text/javascript," +
    encodeURIComponent(themeInitSrc) + "#theme-init-nopicker-" +
    Math.random());
  await import("data:text/javascript," +
    encodeURIComponent(themeSrc) + "#theme-nopicker-" + Math.random());

  return { documentElement, metas };
}

{
  const { metas } = await drivenNoPicker(undefined, undefined, true);
  check("the no-picker branch (404.html): nothing stored, dark phone -> " +
    "the browser-chrome color follows the plain dark palette, not a " +
    "hardcoded value",
    metas[0].attrs.content === "#120d10");
}

{
  const { metas } = await drivenNoPicker(undefined, undefined, false);
  check("the no-picker branch: nothing stored, light phone -> the " +
    "browser-chrome color follows the plain light palette",
    metas[0].attrs.content === "#f3eadb");
}

{
  // The no-picker branch is a SECOND, separate read site (404.html has
  // no swatches to wire, so theme.js returns early through it), and the
  // owner's 2026-08-24 ruling has to reach both or the error page's
  // browser chrome disagrees with every other page's.
  const { metas } = await drivenNoPicker(undefined, "pink", true);
  check("the no-picker branch: a cached admin default reaches the " +
    "chrome color here too - a dark phone does not override it, the " +
    "same order every other page paints by",
    metas[0].attrs.content === "#1e141a");
}

{
  const { metas } = await drivenNoPicker("pink", "daylight", true);
  check("the no-picker branch: a member's own stored choice still wins " +
    "the chrome color here too, over both the phone's scheme and the " +
    "admin default",
    metas[0].attrs.content === "#1e141a");
}

/*
 * theme-init.js ALONE, without theme.js running after it - the window
 * theme-init.js's own header exists to cover ("so a saved theme does
 * not flash the default palette on the way in"). The combined driven()
 * above proves the FINAL painted state is always safe because theme.js
 * runs second and always overwrites data-theme from its own guarded
 * read - which is real and worth proving, but it cannot by itself show
 * theme-init.js's OWN guard is doing anything, since a broken one there
 * would still be corrected a moment later. This isolates it.
 */
{
  const documentElement = documentElementStub();
  const g = globalThis;
  g.localStorage = storage({ "hgb-palette": "custom" });
  g.window = {};
  delete g.matchMedia;
  g.document = { documentElement, querySelectorAll: () => [] };
  await import("data:text/javascript," +
    encodeURIComponent(themeInitSrc) + "#theme-init-alone-" +
    Math.random());
  check("theme-init.js's OWN pre-paint guard, with nothing running " +
    "after it to correct a mistake: a stored \"custom\" choice paints " +
    "the resting scheme palette (light, with no matchMedia support to " +
    "report otherwise), never the literal string \"custom\"",
    documentElement.getAttribute("data-theme") === "daylight");
}

/*
 * #456 F4, CARRIED TO 0.9-M3-S33 PART B, isolated the same way - the
 * combined driven() case above cannot by itself prove theme-init.js's
 * OWN guard rejects an unknown value, since theme.js runs second and
 * always overwrites data-theme with its own validated read regardless
 * of what theme-init.js painted first. This block never imports
 * theme.js, so nothing can correct a wrong first frame before this
 * check reads it - the exact flash a member would otherwise see.
 */
{
  const documentElement = documentElementStub();
  const g = globalThis;
  g.localStorage = storage({ "hgb-palette": "banana" });
  g.window = {};
  delete g.matchMedia;
  g.document = { documentElement, querySelectorAll: () => [] };
  await import("data:text/javascript," +
    encodeURIComponent(themeInitSrc) + "#theme-init-alone-banana-" +
    Math.random());
  check("theme-init.js's OWN pre-paint guard, with nothing running " +
    "after it to correct a mistake: a stored value naming no real " +
    "palette paints the resting scheme palette, never the literal " +
    "unknown string - this is the fix for #456 F4",
    documentElement.getAttribute("data-theme") === "daylight");
}

/*
 * THE SAME ARM, ISOLATED (0.9-M3-S12 #418, reversed by 0.9-M3-S32 #456,
 * restored by the owner's ruling of 2026-08-24 - see the paint arm
 * above for why it moved twice). This block never imports theme.js, so
 * what it observes is theme-init.js's OWN synchronous read, before
 * first frame, with nothing else having run that could have painted it
 * instead. A dark scheme and a cached admin default of "daylight" - the
 * two disagreeing - is what makes the answer mean something: only the
 * key being read can produce "daylight" here.
 */
{
  const documentElement = documentElementStub();
  const g = globalThis;
  g.localStorage = storage({ "hgb-default-theme": "daylight" });
  const mm = matchMediaFor(true);
  g.window = { matchMedia: mm };
  g.matchMedia = mm;
  g.document = { documentElement, querySelectorAll: () => [] };
  await import("data:text/javascript," +
    encodeURIComponent(themeInitSrc) + "#theme-init-admin-default-" +
    Math.random());
  check("theme-init.js's OWN pre-paint guard paints the cached admin " +
    "default over the phone's disagreeing scheme, in the same tick and " +
    "with no network - proven by a scheme and a cached value that " +
    "disagree",
    documentElement.getAttribute("data-theme") === "daylight");
}

/*
 * theme-init.js's OWN precedence between a member's saved choice and
 * the phone's scheme, isolated the same way the block above isolates
 * the admin-default question (0.9-M3-S12 fix wave, #418 comment
 * 5371848229, finding F3, carried forward by 0.9-M3-S32, #456). The
 * combined driven("pink", ...) case far above proves the FINAL painted
 * state always honors the member's choice, but theme.js runs second and
 * reads the same key in the same order - so a regression that swapped
 * theme-init.js's OWN precedence (paint the scheme first, only falling
 * back to a member's choice) would still end on "pink" once theme.js
 * corrected it a moment later. That is exactly the flash both files
 * exist to prevent, and the combined test cannot see it. This block
 * never imports theme.js at all, so nothing can correct a broken
 * precedence before this check reads it. A cached admin default sits in
 * storage too, unread by design (see the block above) - included here
 * to prove its mere presence changes nothing about this precedence
 * either.
 */
{
  const documentElement = documentElementStub();
  const g = globalThis;
  g.localStorage = storage({
    "hgb-palette": "pink",
    "hgb-default-theme": "daylight",
  });
  const mm = matchMediaFor(true);
  g.window = { matchMedia: mm };
  g.matchMedia = mm;
  g.document = { documentElement, querySelectorAll: () => [] };
  await import("data:text/javascript," +
    encodeURIComponent(themeInitSrc) + "#theme-init-precedence-" +
    Math.random());
  check("theme-init.js's OWN pre-paint guard paints the member's saved " +
    "choice over the phone's own dark scheme, with nothing else having " +
    "run yet to correct a wrong first frame",
    documentElement.getAttribute("data-theme") === "pink");
}

/*
 * THE ALLOWLIST AGAINST DRIFT (#457 review, finding F3; 0.9-M3-S33
 * part B fix wave 1) - WIDENED TO FIVE SOURCES (0.9-M3-S33b trailing
 * wave, #457 re-fire #1, F2).
 *
 * theme-init.js's PALETTES is a hand-typed copy of four names, and it
 * HAS to be one: the file runs first, in <head>, with nothing loaded
 * yet to import a list from. Everything above proves the guard REFUSES
 * a name that is not in that list. Nothing above proves the list is
 * the right list - drop "contrast" from it and every check in this
 * file still passed, while a member whose stored palette is
 * "contrast" (the accessibility high-contrast one, a real thing they
 * can pick) got exactly the dark-to-light flash the guard exists to
 * close, with the whole gate green.
 *
 * This is the review bar's own corollary: "a check computed entirely
 * from the file it guards cannot detect that the file was rearranged;
 * something outside the file has to say what it may contain." The
 * something is the other files that must agree with it - theme.js's BG
 * map, which is what actually gets painted into the browser chrome,
 * theme.css's own :root[data-theme="..."] rules, which are what
 * actually paint the page, apps/web/site-content.js's VALID_PALETTES,
 * the admin's configured default written to localStorage for theme.js
 * to pre-select a swatch from, and apps/web/admin.js's THEMES, the
 * settings form's own mirror of what the Worker accepts. All five are
 * read from disk as text: a sixth hand-typed list here would be one
 * more copy to drift.
 *
 * Re-fire #1 found the last two: site-content.js's own comment already
 * CLAIMED to match theme-init.js and theme.js ("Matches theme-init.js's
 * own copy and theme.js's BG keys") - a claim checked by nothing until
 * this arm read the file. Dropping a name from either list left every
 * check in this file green, exactly the gap this widening closes.
 *
 * Set equality across all five, not "PALETTES is a subset": a palette
 * added to one list and missing from another either flashes on load, or
 * paints a data-theme nothing styles, or offers a palette on the
 * settings form the page can never paint. No direction is the safe one.
 */
{
  const themeCssSrc = await read("../apps/web/theme.css");
  const siteContentSrc = await read("../apps/web/site-content.js");
  const adminSrc = await read("../apps/web/admin.js");
  const group = (pattern, text) => {
    const found = pattern.exec(text);
    return found ? found[1] : "";
  };
  const namesIn = (text) =>
    new Set(Array.from(text.matchAll(/"([^"]+)"/g), (m) => m[1]));

  const listed = group(/const PALETTES = \[([^\]]*)\]/, themeInitSrc);
  const guard = namesIn(listed);
  const bgBlock = group(/const BG = \{([^}]*)\}/, themeSrc);
  const painted = new Set(
    Array.from(bgBlock.matchAll(/(\w+)\s*:/g), (m) => m[1]));
  // Anchored to the start of a line, so the same selector QUOTED in a
  // comment (theme.css carries two) is not read as a rule that exists.
  const styled = new Set(Array.from(
    themeCssSrc.matchAll(/^:root\[data-theme="([^"]+)"\]/gm),
    (m) => m[1]));
  const configured = namesIn(
    group(/const VALID_PALETTES = \[([^\]]*)\]/, siteContentSrc));
  const settingsForm = namesIn(
    group(/const THEMES = Object\.freeze\(\[([^\]]*)\]\)/, adminSrc));

  const others = [
    ["theme.js's BG map, which theme.js paints chrome for", painted],
    ["theme.css's :root[data-theme] rules", styled],
    ["site-content.js's VALID_PALETTES, the admin's configured default",
      configured],
    ["admin.js's THEMES, the settings form's own mirror", settingsForm],
  ];

  const same = (a, b) => a.size === b.size && [...a].every((n) => b.has(n));
  check("CONTROL: all five lists were actually parsed - an empty set " +
    "would make every comparison below true for the wrong reason",
    guard.size > 1 && others.every(([, set]) => set.size > 1));
  for (const [label, set] of others) {
    check("theme-init.js's PALETTES names exactly what " + label +
      " names - a name in one and not the other either flashes on " +
      "load, paints a data-theme nothing colors, or offers a palette " +
      "the page cannot paint",
      same(guard, set));
  }
}

console.log(failures
  ? `\ntheme-fallback FAILED ${failures} of ${performed} check(s)`
  : `\ntheme-fallback OK - ${performed} checks`);
process.exit(failures ? 1 : 0);
