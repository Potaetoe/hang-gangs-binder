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
 * What remains is this file's original, whole job - painting a saved
 * NAMED palette before the first frame - so it assigns no global any
 * more (tools/check_web.py's MODULE_EXPORTS records the same fact).
 *
 * A stored choice reading "custom" - an older browser's localStorage,
 * or a hand-edited value - is not a palette this file paints. It is
 * read and DISCARDED here (see below) rather than trusted, so a member
 * in that state falls through to theme.css's own system-preference
 * defaults, the same resting state a first-time visitor gets - no
 * crash, no half-applied state. theme.js's own guard on load does the
 * matching thing for the same stored value.
 */
(function () {
  "use strict";

  try {
    const chosen = localStorage.getItem("hgb-palette");
    if (chosen && chosen !== "custom") {
      document.documentElement.setAttribute("data-theme", chosen);
    }
  } catch (e) {}
})();
