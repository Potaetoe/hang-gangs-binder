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
 * THE ORDER OF PRECEDENCE (owner ruling 2026-08-24, replacing the
 * 2026-08-22 "first visit follows the phone" rule of UX record #454
 * item 15 / 0.9-M3-S32 #456 - replaced out loud, not deleted quietly):
 *
 *   1. the member's OWN saved choice, always;
 *   2. the ADMIN'S CONFIGURED DEFAULT (site.defaultTheme), until the
 *      member picks for themselves;
 *   3. the phone's prefers-color-scheme, when neither of those is set.
 *
 * WHY THE ADMIN'S DEFAULT OUTRANKS THE PHONE. The admin page offers
 * this setting as "what a new visitor sees before they pick their own
 * theme", so a default that only pre-selected a swatch in the picker
 * would be a control that does not do what it says: an admin sets
 * Daylight, a dark phone goes on painting midnight, and nothing
 * anywhere reports a fault.
 *
 * "FOLLOW THE PHONE UNLESS IT SAYS NOTHING" IS NOT AVAILABLE, and is
 * worth naming because it is the obvious middle rank. No current
 * browser ever reports prefers-color-scheme: no-preference - every
 * device answers light or dark - so that rank would never fire, and
 * the setting would be dead in a subtler way than before.
 *
 * WHERE THE VALUE COMES FROM, AND THE ONE HONEST GAP. The default
 * arrives over GET /config, which is a network round trip this script
 * cannot make: it runs in <head>, before first paint, with nothing
 * loaded. apps/web/site-content.js caches the fetched value into
 * `hgb-default-theme` on every load, and this script reads that cache
 * on the NEXT one. So the very first visit from a browser that has
 * never loaded this site paints by the phone's scheme, and every visit
 * after it obeys the admin. That is a real limit of painting before the
 * network, not an oversight - the alternative is a flash of the wrong
 * palette on every load, which is the exact thing this file exists to
 * prevent. It is validated against the same four names as the member's
 * own choice, for the reason the block above gives.
 */
(function () {
  "use strict";

  const PALETTES = ["midnight", "pink", "daylight", "contrast"];

  function schemeDefault() {
    return (window.matchMedia &&
      matchMedia("(prefers-color-scheme: dark)").matches)
      ? "midnight" : "daylight";
  }

  function valid(name) {
    return !!name && PALETTES.indexOf(name) !== -1;
  }

  try {
    const chosen = localStorage.getItem("hgb-palette");
    const adminDefault = localStorage.getItem("hgb-default-theme");
    let painted;
    if (valid(chosen)) {
      painted = chosen;
    } else if (valid(adminDefault)) {
      painted = adminDefault;
    } else {
      painted = schemeDefault();
    }
    document.documentElement.setAttribute("data-theme", painted);
  } catch (e) {}
})();
