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
 */
(function () {
  "use strict";
  try {
    var t = localStorage.getItem("hgb-theme");
    if (t) document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
