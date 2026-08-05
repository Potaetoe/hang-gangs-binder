/*
 * Theme picker, shared by every page in this directory - one copy so
 * the pages cannot drift. The saved theme is applied before first paint
 * by a tiny inline script in each page's <head>; this file wires the
 * chip buttons, keeps the browser-chrome color (meta theme-color) in
 * step with the palette, and persists the choice.
 */
(function () {
  "use strict";
  var KEY = "hgb-theme";
  var BG = { pink: "#241b21", light: "#f2efe9", dark: "#121212" };
  var buttons = document.querySelectorAll("[data-set-theme]");
  if (!buttons.length) return;

  function apply(name) {
    document.documentElement.setAttribute("data-theme", name);
    Array.prototype.forEach.call(
      document.querySelectorAll('meta[name="theme-color"]'),
      function (m) { m.setAttribute("content", BG[name]); }
    );
    Array.prototype.forEach.call(buttons, function (b) {
      b.setAttribute("aria-pressed",
        String(b.getAttribute("data-set-theme") === name));
    });
  }

  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}
  // No saved choice: reflect what the CSS is already doing (Light on a
  // light-preferring system, Dark otherwise) without persisting. This
  // pairing is load-bearing - if it disagrees with theme.css the page
  // repaints to a different palette the moment this file runs.
  apply(stored || (window.matchMedia &&
    matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));

  Array.prototype.forEach.call(buttons, function (b) {
    b.addEventListener("click", function () {
      var name = b.getAttribute("data-set-theme");
      apply(name);
      try { localStorage.setItem(KEY, name); } catch (e) {}
    });
  });
})();
