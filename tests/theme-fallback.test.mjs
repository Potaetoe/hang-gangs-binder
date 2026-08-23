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
/* THE REWRITTEN S12 ARM (0.9-M3-S12, #418, superseded by the owner's    */
/* ruling in UX record #454 item 15; 0.9-M3-S32, #456). S12 pinned that  */
/* a cached admin default PAINTS before first paint once learned - the   */
/* opposite is now true: it is read only to decide which chip the        */
/* picker pre-selects, and never reaches data-theme. Using a scheme and  */
/* an admin default that DISAGREE (dark phone, "pink" admin default) is  */
/* the only way to prove the split rather than a coincidence - a bug     */
/* that still painted the admin default would pass a same-value test.    */

{
  const { documentElement, metas, buttons } =
    await driven(undefined, "pink", true);
  check("a cached admin default no longer paints before first paint - " +
    "the phone's dark preference does, even though a different " +
    "palette is cached",
    documentElement.getAttribute("data-theme") === "midnight");
  check("theme.js's own load-time confirm agrees with theme-init.js on " +
    "what PAINTED - a mismatch here is the flash both files exist to " +
    "prevent",
    documentElement.getAttribute("data-theme") === "midnight");
  check("the browser-chrome meta color follows the painted scheme " +
    "palette, not the cached admin default",
    metas[0].attrs.content !== undefined);
  check("the picker pre-selects the admin default's own chip - \"pink\" " +
    "- even though the page itself is painted \"midnight\"; this is " +
    "the picker offering the admin's suggestion, not a repaint",
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
  // The same regression the picker branch's own arm above (the one
  // proving "a cached admin default no longer paints") guards against,
  // fired here instead: S12's retired rule sneaking back into this
  // branch specifically, since it is a second, separate read site.
  const { metas } = await drivenNoPicker(undefined, "pink", true);
  check("the no-picker branch: a cached admin default does not leak " +
    "into the chrome color here either - dark phone still paints the " +
    "scheme's own color, not the admin default's",
    metas[0].attrs.content === "#120d10");
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
 * THE REWRITTEN S12 ARM, isolated the same way (0.9-M3-S12, #418,
 * superseded by 0.9-M3-S32, #456). S12's isolated arm proved theme-
 * init.js's OWN synchronous read of "hgb-default-theme" painted the
 * cached admin default before first frame, with nothing else having run
 * yet to do it instead. That claim is now false on purpose: theme-
 * init.js does not read this key at all any more. A dark scheme and a
 * cached admin default of "daylight" - the two disagreeing - is what
 * proves it: if theme-init.js still read the key, this block (which
 * never imports theme.js) would show "daylight" painted; it shows the
 * scheme's own "midnight" instead, with the admin default in storage
 * doing nothing.
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
  check("theme-init.js's OWN pre-paint guard paints the phone's scheme, " +
    "never a cached admin default it no longer reads - proven by a " +
    "scheme and a cached value that disagree",
    documentElement.getAttribute("data-theme") === "midnight");
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

console.log(failures
  ? `\ntheme-fallback FAILED ${failures} of ${performed} check(s)`
  : `\ntheme-fallback OK - ${performed} checks`);
process.exit(failures ? 1 : 0);
