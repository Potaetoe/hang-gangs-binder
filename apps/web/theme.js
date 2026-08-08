/*
 * Theme picker, shared by every page in this directory - one copy so
 * the pages cannot drift. The saved theme is applied before first paint
 * by a tiny inline script in each page's <head>; this file wires the
 * chip buttons, keeps the browser-chrome color (meta theme-color) in
 * step with the palette, and persists the choice.
 */
(function () {
  "use strict";
  const KEY = "hgb-theme";
  const BG = {
    pink: "#241b21", light: "#f2efe9", dark: "#121212",
    contrast: "#000000",
  };
  const buttons = document.querySelectorAll("[data-set-theme]");
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

  // What the stylesheet gives a page carrying no data-theme attribute.
  // This function is a mirror of the two :root:not([data-theme]) media
  // blocks in theme.css and has to stay one: apply() writes the
  // attribute, which outranks both of them, so a disagreement here does
  // not degrade quietly - the page paints the palette the CSS chose and
  // then repaints to this one the moment this file runs.
  //
  // Contrast is tested first for the same reason it sits last in
  // theme.css: a system asking for more contrast AND for light matches
  // both blocks, and contrast is the need while lightness is the
  // preference.
  function preferred() {
    if (!window.matchMedia) return "dark";
    if (matchMedia("(prefers-contrast: more)").matches) return "contrast";
    if (matchMedia("(prefers-color-scheme: light)").matches) return "light";
    return "dark";
  }

  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}
  // Reflected without persisting: a visitor who has never touched a
  // chip has not made a choice, and writing one would freeze today's
  // system setting into storage.
  apply(stored || preferred());

  Array.prototype.forEach.call(buttons, function (b) {
    b.addEventListener("click", function () {
      const name = b.getAttribute("data-set-theme");
      apply(name);
      try { localStorage.setItem(KEY, name); } catch (e) {}
    });
  });
})();
