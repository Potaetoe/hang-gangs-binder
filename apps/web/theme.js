/*
 * Palette picker, shared by every page in this directory - one copy so
 * the pages cannot drift. The saved palette, or the phone's own light/
 * dark scheme when nothing is saved, is applied before first paint by
 * theme-init.js in each page's <head>; this file wires the palette
 * buttons, keeps the browser-chrome color (meta theme-color) in step
 * with the palette, and persists a member's own choice.
 *
 * There is one control to wire and it does not open: four swatches that
 * are simply there, in every page's footer, on the owner's ruling
 * (#274). That is why this file is as short as it is. A disclosure owes
 * manners - a flip when the room above runs out, Escape, outside click,
 * close on pick - and every one of them is code that exists to undo a
 * reveal. A control with no reveal owes none, so the whole of what a
 * palette costs here is: read a choice, paint it, store it.
 *
 * THE CUSTOM THEME IS RETIRED (0.9-M2-S14, #380 ruling 2), superseding
 * every earlier shape it went through - the fifth swatch circle
 * (0.9-M2-S6, #82) and the footer's "Custom theme" disclosure summary
 * that replaced it (0.9-M2-S13, #378) alike. `buttons` below wires only
 * the four NAMED palettes now, the same [data-set-theme] loop it always
 * used for them. A member whose stored choice still reads "custom" (an
 * older browser's localStorage, or a hand-edited value) falls back to
 * the resting palette on load - see the read-and-validate guard below -
 * rather than reading as a choice this file no longer knows how to
 * paint.
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
  // The admin's configured resting palette, cached by apps/web/site-content.js
  // from GET /config. Owner ruling, UX record #454 item 15 (2026-08-22;
  // 0.9-M3-S32, #456, superseding 0.9-M3-S12's #418 "admin default from
  // the second load" rule): this key no longer paints a page on its
  // own. It is read only below, to decide which swatch the picker shows
  // as pre-selected for a member who has made no choice of their own;
  // the pre-paint script this page's <head> loads first never touches
  // it any more.
  const DEFAULT_THEME_KEY = "hgb-default-theme";
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

  // paintName is what gets painted - the documentElement attribute and
  // the browser chrome. pressedName, when it differs, is which swatch
  // shows as pressed without repainting anything: the picker pre-
  // selecting the admin's configured default (see adminDefault below)
  // while the page itself keeps the resting palette theme-init.js
  // already painted is exactly this split, and it is the only reason
  // apply() takes two names instead of one. The click handler below
  // passes a single name, so a member's own pick paints and marks the
  // same swatch, as it always has.
  function apply(paintName, pressedName) {
    document.documentElement.setAttribute("data-theme", paintName);
    paintChrome(paintName);
    const mark = pressedName || paintName;
    Array.prototype.forEach.call(buttons, function (b) {
      b.setAttribute("aria-pressed",
        String(b.getAttribute("data-set-theme") === mark));
    });
  }

  // What a member with no saved choice of their own gets, on this load
  // and every one before they ever pick: the phone's own light/dark
  // scheme, nothing more (owner ruling, UX record #454 item 15). A
  // mirror of theme-init.js's own synchronous pre-paint read, on
  // purpose - apply() below writes the same attribute theme-init.js
  // already wrote, and a disagreement here would repaint the page the
  // instant this script ran, which is the flash both files exist to
  // prevent. "No preference" - no matchMedia support, or the query not
  // matching - resolves to light, the ruling's own words.
  function schemeDefault() {
    return (window.matchMedia &&
      matchMedia("(prefers-color-scheme: dark)").matches)
      ? "midnight" : "daylight";
  }

  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}

  // A stored value naming a palette this file does not paint - "custom"
  // from before the ruling retired it, or anything else hand-edited or
  // from a future version - is not a choice this file can honor. Falls
  // through to the resting scheme-based palette instead (schemeDefault()
  // below), the same resting state a first-time visitor gets: no crash,
  // no half-applied state, and BG[name] above already guards
  // paintChrome() the same way for the browser chrome.
  if (stored && !Object.prototype.hasOwnProperty.call(BG, stored)) {
    stored = null;
  }

  // The admin's configured resting palette (site.defaultTheme from
  // GET /config), read from the cache apps/web/site-content.js writes -
  // see this file's DEFAULT_THEME_KEY comment above for why this script
  // does not fetch it directly. Used ONLY below, to decide which swatch
  // the picker pre-selects when a member has made no choice of their
  // own - never to decide what paints, which is schemeDefault()'s job
  // alone now.
  let adminDefault = null;
  try { adminDefault = localStorage.getItem(DEFAULT_THEME_KEY); } catch (e) {}
  if (adminDefault && !Object.prototype.hasOwnProperty.call(BG, adminDefault)) {
    adminDefault = null;
  }

  /*
   * The error page is the one page here with no palette control, so it
   * reaches this file with nothing to wire. Every other page offers the
   * four palettes as swatches, and tools/check_web.py's check 19 is
   * what pins which pages those are.
   *
   * It still has browser chrome to keep honest: theme-init.js paints
   * the saved palette, or the phone's own resting scheme when none is
   * saved, before first paint, and without this the address bar on a
   * phone would stay out of step with the page under it.
   *
   * data-theme is deliberately NOT written there. The attribute
   * outranks both :root:not([data-theme]) blocks in theme.css, so
   * writing it for a visitor who has expressed no choice would freeze
   * this moment's system setting onto a page that would otherwise keep
   * following it.
   */
  if (!buttons.length) {
    paintChrome(stored || schemeDefault());
    return;
  }

  // resting: the same value theme-init.js already painted - a member's
  // own stored choice, or the phone's light/dark scheme when there is
  // none. pressed: which swatch the picker shows as pressed - a
  // member's own choice still wins outright, otherwise the admin's
  // configured default when one is known (the picker pre-selecting it,
  // per the owner's ruling), and only when neither exists does it fall
  // back to matching whatever is actually painted. A visitor who has
  // never touched a control has not made a choice, so nothing here is
  // written to storage.
  const resting = stored || schemeDefault();
  const pressed = stored || adminDefault || resting;
  apply(resting, pressed);

  // No document-level listener here, and that is the whole difference
  // the ruling on #274 made. Escape and outside-click both belonged to
  // a panel that covered something: there was an outside to dismiss
  // from, and a reader who had moved on had said they were done. A row
  // that covers nothing owes neither - taking a visible control away
  // for a reason nobody can observe is worse than leaving it - so the
  // press is all there is to wire, and the button the member pressed
  // is still under their finger when it is over.
  Array.prototype.forEach.call(buttons, function (b) {
    b.addEventListener("click", function () {
      const name = b.getAttribute("data-set-theme");
      apply(name);
      try { localStorage.setItem(KEY, name); } catch (e) {}
    });
  });
})();
