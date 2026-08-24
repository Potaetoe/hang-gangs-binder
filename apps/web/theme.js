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
  // The admin's configured resting palette, cached by apps/web/site-
  // content.js from GET /config. Owner ruling 2026-08-24: it paints for
  // a member who has made no choice of their own, ranking under that
  // member's own choice and over the phone's scheme. theme-init.js
  // reads the same key before first frame in the same order, which is
  // what keeps this file's own repaint from being a flash.
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
  // the browser chrome. pressedName is which swatch shows as pressed.
  // Every caller passes one name, or the same value twice: the mark and
  // the palette agree by construction, because what the picker shows as
  // chosen is what the page is wearing. The parameter stays separate so
  // that any caller ever needing to mark something it did not paint has
  // to say so out loud rather than by omission.
  function apply(paintName, pressedName) {
    document.documentElement.setAttribute("data-theme", paintName);
    paintChrome(paintName);
    const mark = pressedName || paintName;
    Array.prototype.forEach.call(buttons, function (b) {
      b.setAttribute("aria-pressed",
        String(b.getAttribute("data-set-theme") === mark));
    });
  }

  // The LAST rank: what a member gets when they have chosen nothing and
  // the admin has configured nothing either. A mirror of theme-init.js's
  // own synchronous pre-paint read, on purpose - apply() below writes
  // the same attribute theme-init.js already wrote, and a disagreement
  // here would repaint the page the instant this script ran, which is
  // the flash both files exist to prevent. "No preference" - no
  // matchMedia support, or the query not matching - resolves to light.
  function schemeDefault() {
    return (window.matchMedia &&
      matchMedia("(prefers-color-scheme: dark)").matches)
      ? "midnight" : "daylight";
  }

  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}

  // A stored value naming a palette this file does not paint - "custom"
  // from before the ruling retired it, or anything else hand-edited or
  // from a future version - is not a choice this file can honor.
  // Dropping it puts the member exactly where somebody who has never
  // picked stands, so they fall through the same ranks in the same
  // order - the admin's default, then the phone's scheme: no crash, no
  // half-applied state, and BG[name] above already guards paintChrome()
  // the same way for the browser chrome.
  if (stored && !Object.prototype.hasOwnProperty.call(BG, stored)) {
    stored = null;
  }

  // The admin's configured resting palette (site.defaultTheme from
  // GET /config), read from the cache apps/web/site-content.js writes -
  // see this file's DEFAULT_THEME_KEY comment above for why this script
  // does not fetch it directly. It DECIDES WHAT PAINTS for a member who
  // has made no choice of their own, ranking above the phone's scheme
  // and below the member (owner ruling 2026-08-24, replacing the
  // 2026-08-22 "first visit follows the phone" rule; theme-init.js's
  // header carries the whole order and the reasoning). Reading it only
  // to pre-select a swatch is the failure that shape invites: the
  // setting saves, the picker agrees with it, and the page ignores it.
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
    paintChrome(stored || adminDefault || schemeDefault());
    return;
  }

  // resting: the same value theme-init.js already painted - a member's
  // own stored choice, then the admin's configured default, then the
  // phone's light/dark scheme - the one order theme-init.js already
  // painted by, repeated here because this file repaints on load and a
  // different order would flash the palette the other one rejected.
  // pressed is now the SAME value: the swatch the picker shows is
  // whatever is actually on the page, which it was not while the
  // admin's default could be pre-selected without painting. A visitor
  // who has never touched a control has not made a choice, so nothing
  // here is written to storage.
  const resting = stored || adminDefault || schemeDefault();
  const pressed = resting;
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
