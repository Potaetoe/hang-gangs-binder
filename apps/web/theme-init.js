/*
 * Applied before first paint so a saved theme does not flash the default
 * palette on the way in. theme.js, at the end of the body, does
 * everything else.
 *
 * This is a file rather than the inline <script> it started as. Inline
 * scripts require script-src 'unsafe-inline' (or a hash that breaks on
 * every edit), and this page will shortly be handling plaintext before
 * it is encrypted - the one page where an injected script is worth
 * spending a request to prevent. Same origin, no attributes: it blocks
 * rendering exactly like the inline version did.
 *
 * THE CUSTOM-PALETTE MATH THIS FILE ONCE PUBLISHED (BinderCustomPalette,
 * 0.9-M2-S6, #82) IS GONE (0.9-M2-S14, #380 ruling 2): the custom theme
 * is retired outright, so there is nothing left here to derive a
 * palette from two colors, and nothing to warn about their contrast.
 * What remains is this file's original, whole job - painting a resting
 * palette before the first frame - so it assigns no global any more
 * (tools/check_web.py's MODULE_EXPORTS records the same fact).
 *
 * A stored choice naming no real palette - "custom" from before the
 * retired theme, a typo, a hand-edited value, or a future palette name
 * this build predates - is not painted. It is read and DISCARDED here
 * (see below) rather than trusted, so a member in that state gets the
 * same first-visit resting state described below - no crash, no
 * half-applied state. theme.js's own guard on load does the matching
 * thing for the same stored value, against the same four names.
 *
 * THE FOUR NAMES ARE CHECKED HERE, NOT JUST "NOT CUSTOM" (#456 F4,
 * carried to 0.9-M3-S33 part B): before this fix, the guard below
 * excluded only the literal string "custom" and let anything else
 * through unvalidated - a hand-edited or corrupted value painted
 * verbatim in this pre-paint script and then flashed to the real
 * resting palette a moment later, once theme.js's own already-
 * validated read corrected it. PALETTES is this file's own copy of the
 * same four names theme.js's BG map keys on and theme.css's
 * data-theme selectors paint - duplicated rather than shared because
 * this script runs first, in <head>, before theme.js has loaded at
 * all; there is nothing yet to import it from.
 *
 * FIRST VISIT FOLLOWS THE PHONE (owner ruling, UX record #454 item 15,
 * 2026-08-22; 0.9-M3-S32, #456, superseding 0.9-M3-S12's #418 "admin
 * default from the second load" rule - not deleted silently, replaced):
 * a member with no saved choice of their own gets the plain dark
 * palette when the phone reports prefers-color-scheme: dark, and the
 * plain light palette otherwise - including "no preference", the
 * ruling's own words. matchMedia is synchronous, so this reads it
 * directly rather than caching anything or waiting on a network round
 * trip; there is no flash because the decision is made and painted in
 * the same tick as everything else in this file.
 *
 * THE ADMIN'S CONFIGURED DEFAULT (site.defaultTheme from the Worker's
 * GET /config, 0.9-M3-S8/#414) is no longer read here at all. It never
 * paints a page on its own any more - it is read by theme.js instead,
 * only to decide which swatch the picker shows as pre-selected. See
 * theme.js's own header and apps/web/site-content.js's for the read
 * side and why the cache write there stays a cache write.
 */
(function () {
  "use strict";

  const PALETTES = ["midnight", "pink", "daylight", "contrast"];

  function schemeDefault() {
    return (window.matchMedia &&
      matchMedia("(prefers-color-scheme: dark)").matches)
      ? "midnight" : "daylight";
  }

  try {
    const chosen = localStorage.getItem("hgb-palette");
    if (chosen && PALETTES.indexOf(chosen) !== -1) {
      document.documentElement.setAttribute("data-theme", chosen);
    } else {
      document.documentElement.setAttribute("data-theme", schemeDefault());
    }
  } catch (e) {}
})();
