/*
 * apps/web/theme.js and apps/web/theme-init.js, driven under Node - the
 * one property 0.9-M2-S14 (#380 ruling 2) requires an arm for: a
 * member whose stored palette choice reads "custom" - the retired
 * theme, or a hand-edited value - falls back to the resting named
 * palette on load. No crash, no half-applied state (data-theme never
 * reads "custom" on the page), on both scripts alike.
 *
 *     node tests/theme-fallback.test.mjs
 *
 * WHY A NEW FILE RATHER THAN A REPAIR. tests/custom-palette.test.mjs
 * retired in this same change - its whole subject, BinderCustomPalette,
 * is gone with the custom theme it derived colors for. What survives
 * of that suite's job is exactly this one property, on the two files
 * that used to share it; this file is that property's new, narrower
 * home, not a patch on the old one.
 *
 * A SMALL HAND-BUILT STUB, not jsdom (#75's rejection applies here as
 * everywhere else in this directory): both scripts touch only
 * document.documentElement (setAttribute/getAttribute), a NodeList of
 * palette buttons, a NodeList of theme-color <meta> tags, and
 * localStorage - four surfaces, stubbed directly rather than through a
 * general-purpose DOM.
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
 * Runs both scripts fresh against one stored value - theme-init.js
 * first (the pre-paint script, blocking in a real <head>), then
 * theme.js (the end-of-body wiring) - the same order every page loads
 * them in, matching PREPAINT_SCRIPT's own seed in
 * tools/check_web.py's loading_problems().
 */
async function driven(storedPalette, defaultTheme) {
  const documentElement = documentElementStub();
  const metas = [{ attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } }];
  const buttons = ["midnight", "pink", "daylight", "contrast"]
    .map(buttonStub);

  const g = globalThis;
  // defaultTheme, optional: the admin's configured resting palette
  // (0.9-M3-S12, #418), the same key apps/web/site-content.js writes
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
  // No matchMedia at all - preferred() reads `!window.matchMedia` and
  // falls to "midnight" deterministically, the same resting state a
  // first-time visitor with no system preference gets.
  g.window = {};

  await import("data:text/javascript," +
    encodeURIComponent(themeInitSrc) + "#theme-init-" + Math.random());
  await import("data:text/javascript," +
    encodeURIComponent(themeSrc) + "#theme-" + Math.random());

  return { documentElement, metas, buttons };
}

/* ------------------------------------------------------------------ */
/* CONTROL: a real, named stored choice is honored by both scripts.     */

{
  const { documentElement } = await driven("pink");
  check("CONTROL: a real stored palette is painted by theme-init.js's " +
    "pre-paint script",
    documentElement.getAttribute("data-theme") === "pink");
}

/* ------------------------------------------------------------------ */
/* THE ARM: "custom" falls back to the resting palette, no crash.       */

{
  const { documentElement, metas, buttons } = await driven("custom");
  check("a stored choice of \"custom\" never reaches data-theme=\"custom\" " +
    "- theme-init.js's pre-paint script leaves the attribute unset " +
    "rather than guess at a palette it no longer derives",
    documentElement.getAttribute("data-theme") !== "custom");
  check("theme.js's own load-time guard paints the resting named " +
    "palette instead (\"midnight\", the no-system-preference default) " +
    "- the same first-time-visitor state, not a half-applied custom one",
    documentElement.getAttribute("data-theme") === "midnight");
  check("the browser-chrome meta color is painted too - a corrupted " +
    "stored value does not leave stale chrome behind",
    metas[0].attrs.content !== undefined);
  check("the resting palette's own chip - Midnight, the one actually " +
    "applied - is the one marked pressed, and only that one",
    buttons.find((b) => b.getAttribute("data-set-theme") === "midnight")
      .getAttribute("aria-pressed") === "true" &&
    buttons.filter((b) => b.getAttribute("data-set-theme") !== "midnight")
      .every((b) => b.getAttribute("aria-pressed") === "false"));
}

/* An empty or missing stored value is the ordinary first-visit case,    */
/* not the corrupted-value path - both scripts already had to tell the   */
/* two apart, and this is what proves they still do. */
{
  const { documentElement } = await driven(undefined);
  check("no stored value at all also lands on the resting palette, " +
    "the same way a corrupted \"custom\" one does",
    documentElement.getAttribute("data-theme") === "midnight");
}

/* ------------------------------------------------------------------ */
/* THE ADMIN'S CONFIGURED DEFAULT (0.9-M3-S12, #418): site.defaultTheme */
/* from GET /config, cached by apps/web/site-content.js and read by     */
/* both scripts through the "hgb-default-theme" key - a member's own    */
/* choice still wins, an unlearned or corrupted admin default falls     */
/* through to the same system-preference resting state a first-time    */
/* visitor with no cache at all gets (the driven(undefined) case just   */
/* above), and both scripts agree on the answer.                        */

{
  const { documentElement, metas, buttons } =
    await driven(undefined, "daylight");
  check("a cached admin default paints before first paint, with no " +
    "member choice of the visitor's own to outrank it",
    documentElement.getAttribute("data-theme") === "daylight");
  check("theme.js's own load-time read CONFIRMS the same palette " +
    "theme-init.js already painted, rather than disagreeing with it - " +
    "a mismatch here is the flash both files exist to prevent",
    documentElement.getAttribute("data-theme") === "daylight");
  check("the browser-chrome meta color follows the admin default too",
    metas[0].attrs.content !== undefined);
  check("the admin default's own chip is the one marked pressed",
    buttons.find((b) => b.getAttribute("data-set-theme") === "daylight")
      .getAttribute("aria-pressed") === "true" &&
    buttons.filter((b) => b.getAttribute("data-set-theme") !== "daylight")
      .every((b) => b.getAttribute("aria-pressed") === "false"));
}

{
  // A member's OWN saved choice still wins over the admin's configured
  // default - the ruling's exact words (0.9-M3-S12, #418): "a member's
  // own saved choice still wins".
  const { documentElement } = await driven("pink", "daylight");
  check("a member's own stored palette outranks a cached admin default",
    documentElement.getAttribute("data-theme") === "pink");
}

{
  // A cached value naming no palette either script knows - corrupted
  // localStorage, or a future config value this build predates - is
  // not a value either file paints, the same discipline a stored
  // "custom" choice already gets above.
  const { documentElement } = await driven(undefined, "neon");
  check("an admin default naming a palette neither script knows falls " +
    "through to the system-preference resting state, not to the " +
    "literal string \"neon\"",
    documentElement.getAttribute("data-theme") === "midnight");
}

{
  // S8's GET /config contract (0.9-M3-S8, #414, comment 5370945709):
  // site.defaultTheme may come back "" for "unset", which apps/web/
  // site-content.js's cacheDefaultTheme() already refuses to cache (a
  // door.test.mjs check proves that half). This is the belt this file
  // holds beside that suspenders - a "" that reached storage some other
  // way is still not a value either script paints, the same falsy read
  // an absent key gets.
  const { documentElement } = await driven(undefined, "");
  check("a cached empty string is read the same as no cached value at " +
    "all, per S8's \"unset\" contract for GET /config",
    documentElement.getAttribute("data-theme") === "midnight");
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
  g.document = { documentElement, querySelectorAll: () => [] };
  await import("data:text/javascript," +
    encodeURIComponent(themeInitSrc) + "#theme-init-alone-" +
    Math.random());
  check("theme-init.js's OWN pre-paint guard, with nothing running " +
    "after it to correct a mistake: a stored \"custom\" choice sets no " +
    "data-theme attribute at all, rather than one CSS has no palette " +
    "block for",
    documentElement.getAttribute("data-theme") === null);
}

/*
 * The same isolation for the admin's configured default (0.9-M3-S12,
 * #418): theme-init.js's OWN synchronous read of "hgb-default-theme"
 * has to be what paints the palette before first frame, since fetch is
 * never synchronous and nothing else runs before this file does. If
 * theme.js were secretly doing the real work here, this block - which
 * never imports theme.js at all - would show data-theme unset.
 */
{
  const documentElement = documentElementStub();
  const g = globalThis;
  g.localStorage = storage({ "hgb-default-theme": "daylight" });
  g.document = { documentElement, querySelectorAll: () => [] };
  await import("data:text/javascript," +
    encodeURIComponent(themeInitSrc) + "#theme-init-admin-default-" +
    Math.random());
  check("theme-init.js's OWN pre-paint guard paints a cached admin " +
    "default with nothing else having run yet",
    documentElement.getAttribute("data-theme") === "daylight");
}

/*
 * And the invalid-value half of the same guard, isolated the same way.
 * The combined driven(undefined, "neon") case above proves the FINAL
 * state is safe, but theme.js validates adminDefault too (see its own
 * PALETTES-equivalent guard) and would silently correct a broken
 * theme-init.js the same way it corrects a broken "custom" guard -
 * exactly the masking the block above this one exists to rule out, and
 * a mutation against theme-init.js's own validity check proved it
 * during this slice's build (0.9-M3-S12, #418): the combined test
 * stayed green while this isolated one went red.
 */
{
  const documentElement = documentElementStub();
  const g = globalThis;
  g.localStorage = storage({ "hgb-default-theme": "neon" });
  g.document = { documentElement, querySelectorAll: () => [] };
  await import("data:text/javascript," +
    encodeURIComponent(themeInitSrc) + "#theme-init-bad-default-" +
    Math.random());
  check("theme-init.js's OWN pre-paint guard never paints a cached " +
    "value naming a palette it does not know, with nothing else " +
    "having run yet to correct a mistake",
    documentElement.getAttribute("data-theme") === null);
}

console.log(failures
  ? `\ntheme-fallback FAILED ${failures} of ${performed} check(s)`
  : `\ntheme-fallback OK - ${performed} checks`);
process.exit(failures ? 1 : 0);
