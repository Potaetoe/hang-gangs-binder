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
 *
 * THE ADMIN'S CONFIGURED DEFAULT (0.9-M3-S12, #418; site.defaultTheme
 * from the Worker's GET /config), for a member with no saved choice of
 * their own. This file cannot fetch it: fetch is never synchronous, and
 * blocking first paint on a network round trip would be the very flash
 * this file exists to prevent, worse than the one it would fix. So it
 * reads a CACHE instead. apps/web/site-content.js writes the last value
 * a page on this origin actually learned from /config into the key
 * "hgb-default-theme", and this file's own read of it is synchronous,
 * the same as the member-choice read two lines up.
 *
 * A fork's first-ever visit, or one where /config has never answered,
 * finds nothing cached and leaves data-theme unset, so
 * apps/web/theme.css's own system-preference defaults paint exactly as
 * they do today: the "falling back to the shipped default" the design
 * ruling asks for. theme.js's own guard on load mirrors this read too,
 * so the two never disagree about which value a page with no
 * data-theme attribute yet should confirm.
 */
(function () {
  "use strict";

  // The four palettes theme.js knows how to paint. Duplicated rather
  // than read off a shared global: this script runs before every other
  // one on the page, including theme.js's own copy (its BG object), so
  // it cannot depend on anything else having run first. A fifth palette
  // lands here in the same change that adds it there.
  const PALETTES = ["midnight", "pink", "daylight", "contrast"];

  try {
    const chosen = localStorage.getItem("hgb-palette");
    if (chosen && chosen !== "custom") {
      document.documentElement.setAttribute("data-theme", chosen);
    } else {
      const learned = localStorage.getItem("hgb-default-theme");
      if (learned && PALETTES.indexOf(learned) !== -1) {
        document.documentElement.setAttribute("data-theme", learned);
      }
    }
  } catch (e) {}
})();
