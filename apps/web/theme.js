/*
 * Palette picker, shared by every page in this directory - one copy so
 * the pages cannot drift. The saved palette is applied before first
 * paint by theme-init.js in each page's <head>; this file wires the
 * palette buttons, keeps the browser-chrome color (meta theme-color) in
 * step with the palette, and persists the choice.
 *
 * There are two controls to wire and one of them opens itself. The
 * signed-in pages carry a <details class="theme-picker"> whose panel
 * floats; index.html carries four swatches that are simply there. Both
 * are the same [data-set-theme] buttons underneath, which is why one
 * file still serves both - and the disclosure needs NO script to open,
 * so everything this file does to it is enhancement over a control that
 * already works.
 */
(function () {
  "use strict";
  // A new key rather than the old "hgb-theme": the stored values are
  // renamed in this same change, and a browser holding "dark" would
  // otherwise set data-theme="dark", which matches no palette and
  // paints the default while claiming a choice was honored. Nobody has
  // used the site yet, so there is nothing to migrate - but a stale
  // value read under a live key is a silent wrong answer, and a key
  // nobody has written is a clean one.
  const KEY = "hgb-palette";
  const BG = {
    pink: "#1e141a", daylight: "#f3eadb", midnight: "#120d10",
    contrast: "#000000",
  };
  const buttons = document.querySelectorAll("[data-set-theme]");

  // A palette this file does not know is not written into the browser
  // chrome. The stored value comes from localStorage, which anything on
  // this origin can write, and setAttribute would happily paint the
  // string "undefined" into a color slot.
  function paintChrome(name) {
    const background = BG[name];
    if (!background) return;
    Array.prototype.forEach.call(
      document.querySelectorAll('meta[name="theme-color"]'),
      function (m) { m.setAttribute("content", background); }
    );
  }

  function apply(name) {
    document.documentElement.setAttribute("data-theme", name);
    paintChrome(name);
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
    if (!window.matchMedia) return "midnight";
    if (matchMedia("(prefers-contrast: more)").matches) return "contrast";
    if (matchMedia("(prefers-color-scheme: light)").matches) return "daylight";
    return "midnight";
  }

  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}

  /*
   * The error page is the one page here with no palette control, so it
   * reaches this file with nothing to wire. Every other page offers the
   * four palettes - the sign-in page included, as swatches rather than
   * behind a disclosure - and tools/check_web.py's check 19 is what
   * pins which pages those are and in which shape.
   *
   * It still has browser chrome to keep honest: theme-init.js paints
   * the saved palette before first paint, and without this the address
   * bar on a phone would stay Midnight's near-black above a parchment
   * page.
   *
   * data-theme is deliberately NOT written there. The attribute
   * outranks both :root:not([data-theme]) blocks in theme.css, so
   * writing it for a visitor who has expressed no choice would freeze
   * this moment's system setting onto a page that would otherwise keep
   * following it.
   */
  if (!buttons.length) {
    paintChrome(stored || preferred());
    return;
  }

  // Reflected without persisting: a visitor who has never touched a
  // control has not made a choice, and writing one would freeze today's
  // system setting into storage.
  apply(stored || preferred());

  /*
   * The disclosure, on the three pages that carry one. Everything below
   * is enhancement: <details> opens, closes, takes Tab through its
   * buttons and reports its own expanded state with this file deleted,
   * which is why aria-expanded is NOT mirrored onto the summary. A
   * mirrored attribute is a second copy of one fact, and the copy this
   * file would keep goes stale in exactly the case the element still
   * works - scripts dead, panel open, attribute saying shut.
   */
  const picker = document.querySelector("details.theme-picker");
  const panel = picker && picker.querySelector(".theme-flyout");
  const summary = picker && picker.querySelector("summary");

  // Which way there is room to open. Measured rather than assumed,
  // because how much room is above the footer depends on where the page
  // is scrolled - and taken with the flip cleared first, so what gets
  // measured is the default direction and not the last answer.
  function place() {
    if (!panel) return;
    picker.removeAttribute("data-flip");
    if (panel.getBoundingClientRect().top < 0) {
      picker.setAttribute("data-flip", "down");
    }
  }

  // Closing puts focus back on the summary. Without that half, focus is
  // left inside a panel that is not on screen any more and the next Tab
  // starts from the top of the document.
  function close() {
    if (!picker || !picker.open) return;
    picker.open = false;
    summary.focus();
  }

  if (picker) {
    picker.addEventListener("toggle", function () {
      if (picker.open) place();
    });

    // Outside click and Escape both belong to a panel that floats:
    // something IS covered while it is open, so there is an outside to
    // be dismissed from, and a reader who has moved on has said they
    // are done with it. Neither would be right for a control that
    // covers nothing - taking a visible list away for a reason nobody
    // can observe - which is why index.html's swatches have neither.
    document.addEventListener("click", function (event) {
      if (picker.open && !picker.contains(event.target)) picker.open = false;
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close();
    });
  }

  Array.prototype.forEach.call(buttons, function (b) {
    b.addEventListener("click", function () {
      const name = b.getAttribute("data-set-theme");
      apply(name);
      try { localStorage.setItem(KEY, name); } catch (e) {}
      // A pick is an answer, so the panel has nothing left to show -
      // and it closes through close() rather than by itself, because
      // the button just pressed is about to stop being on screen and
      // focus has to have somewhere to go.
      close();
    });
  });
})();
