/*
 * Palette picker, shared by every page in this directory - one copy so
 * the pages cannot drift. The saved palette is applied before first
 * paint by theme-init.js in each page's <head>; this file wires the
 * palette buttons, keeps the browser-chrome color (meta theme-color) in
 * step with the palette, and persists the choice.
 *
 * There is one control to wire and it does not open: four swatches that
 * are simply there, in every page's footer, on the owner's ruling
 * (#274). That is why this file is as short as it is. A disclosure owes
 * manners - a flip when the room above runs out, Escape, outside click,
 * close on pick - and every one of them is code that exists to undo a
 * reveal. A control with no reveal owes none, so the whole of what a
 * palette costs here is: read a choice, paint it, store it.
 *
 * CUSTOM IS A FIFTH SWATCH, not a new control (0.9-M2-S6, #82). It is
 * wired by the same [data-set-theme] loop as the other four - clicking
 * it calls the same apply(), which is the whole of how the named
 * palettes double as Custom's reset (design mandate 4: no new control,
 * picking a name un-presses Custom through the mechanism that was
 * already here). What is new is what apply() does WHEN the name is
 * "custom": it reads the two colors the member picked out of
 * localStorage, runs them through BinderCustomPalette.derive() -
 * theme-init.js's own pure half, published there rather than in a
 * second <head> script because check 22 in tools/check_web.py pins the
 * head to exactly one - and writes the result on as inline custom
 * properties, which is the one thing in this file that outranks
 * theme.css's stylesheet rules. Switching to any NAMED palette has to
 * clear those same properties for that reason: an inline style beats a
 * class selector regardless of specificity, so a leftover
 * --color-bg set by Custom would keep painting through Midnight's own
 * block forever.
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
  const CUSTOM_KEY = "hgb-custom-colors";
  const BG = {
    pink: "#1e141a", daylight: "#f3eadb", midnight: "#120d10",
    contrast: "#000000",
  };
  const buttons = document.querySelectorAll("[data-set-theme]");

  // theme-init.js's pure half, read off the global it publishes rather
  // than reimplemented - see this file's header for why it lives there.
  // Absent only if theme-init.js failed to run at all, which is not a
  // shape any page ships; the guards below still check for it so a
  // reader of this file does not have to trust that sentence.
  const CustomPalette = window.BinderCustomPalette;

  // The full token set derive() writes, read off one throwaway
  // derivation rather than typed out a second time - the list this file
  // clears when a member leaves Custom is the list theme-init.js's own
  // comment already argues token by token, and a hand-kept copy here is
  // the one that goes stale when a token is added there.
  const CUSTOM_TOKEN_NAMES = CustomPalette
    ? Object.keys(CustomPalette.derive("#000000", "#000000")) : [];

  function storedCustomTokens() {
    if (!CustomPalette) return null;
    let raw = null;
    try { raw = localStorage.getItem(CUSTOM_KEY); } catch (e) {}
    if (!raw) return null;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return null; }
    if (!parsed || !CustomPalette.isValidHex(parsed.bg) ||
        !CustomPalette.isValidHex(parsed.accent)) {
      return null;
    }
    return CustomPalette.derive(parsed.bg, parsed.accent);
  }

  function clearCustomProperties() {
    const style = document.documentElement.style;
    CUSTOM_TOKEN_NAMES.forEach(function (name) { style.removeProperty(name); });
  }

  function applyCustomProperties(tokens) {
    const style = document.documentElement.style;
    Object.keys(tokens).forEach(function (name) {
      style.setProperty(name, tokens[name]);
    });
  }

  // The dot cannot be a static CSS rule the way the other four are
  // (design mandate 5): from inside :root[data-theme="custom"] there is
  // no expression naming a color that is not the palette already on
  // screen, and a member's own colors are not known until they are
  // stored. Painted here instead, every time apply() runs, from
  // whichever colors are actually on record - or, with none on record
  // yet, from the palette currently on screen, so a first look at the
  // dot reads as "not customized yet" rather than as a blank control
  // nothing has drawn.
  function paintCustomDot() {
    const dot = document.querySelector('.swatch-dot[data-palette="custom"]');
    if (!dot) return;
    const tokens = storedCustomTokens();
    if (tokens) {
      dot.style.background = tokens["--color-bg"];
      dot.style.borderColor = tokens["--color-accent"];
      return;
    }
    const resolved = getComputedStyle(document.documentElement);
    dot.style.background = resolved.getPropertyValue("--color-bg").trim();
    dot.style.borderColor = resolved.getPropertyValue("--color-accent").trim();
  }

  // A palette this file does not know is not written into the browser
  // chrome. The stored value comes from localStorage, which anything on
  // this origin can write, and setAttribute would happily paint the
  // string "undefined" into a color slot.
  function paintChrome(name) {
    let background = BG[name];
    if (name === "custom") {
      const tokens = storedCustomTokens();
      background = tokens ? tokens["--color-bg"] : null;
    }
    if (!background) return;
    Array.prototype.forEach.call(
      document.querySelectorAll('meta[name="theme-color"]'),
      function (m) { m.setAttribute("content", background); }
    );
  }

  function apply(name) {
    document.documentElement.setAttribute("data-theme", name);
    if (name === "custom") {
      const tokens = storedCustomTokens();
      if (tokens) applyCustomProperties(tokens);
      else clearCustomProperties();
    } else {
      clearCustomProperties();
    }
    paintChrome(name);
    paintCustomDot();
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

  // VALIDATE ON READ, the same rule theme-init.js's own pre-paint block
  // holds (0.9-M2-S6 security mandate): a stored "custom" record with
  // no valid colors behind it is not a choice this file can honor.
  // theme-init.js already declined to write data-theme for exactly this
  // shape - without this, apply() below would press the Custom chip and
  // set data-theme="custom" anyway, on a page that in fact painted
  // nothing differently, which is the opposite of "Custom reads as
  // inactive" (design mandate 3). Falls through to preferred() instead,
  // the same resting state a first-time visitor gets and the DoD's own
  // words: a corrupted value "falls back to the named palette".
  if (stored === "custom" && !storedCustomTokens()) stored = null;

  /*
   * The error page is the one page here with no palette control, so it
   * reaches this file with nothing to wire. Every other page offers the
   * four palettes as swatches, and tools/check_web.py's check 19 is
   * what pins which pages those are.
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
   * The picker: two native color inputs inside the collapsed <details>
   * every themed page carries directly below the swatch row (design
   * mandate 1). Prefilled from whatever is on record - the member's own
   * saved colors if there are any, the currently painted palette's own
   * bg/accent if there are none - so opening the editor for the first
   * time shows a real starting point rather than the browser's own
   * default black-and-white pair.
   *
   * "input" rather than "change": the swatches apply the instant they
   * are pressed, and a color picker that waited for its own dialog to
   * close before doing the same thing would be the one control on this
   * row that behaves differently.
   */
  const bgInput = document.getElementById("custom-bg");
  const accentInput = document.getElementById("custom-accent");
  const warning = document.getElementById("custom-contrast-warning");

  function showWarning(tokens) {
    if (!warning) return;
    const problems = tokens ? CustomPalette.contrastProblems(tokens) : [];
    warning.hidden = problems.length === 0;
  }

  if (bgInput && accentInput && CustomPalette) {
    const onRecord = storedCustomTokens();
    const resolved = getComputedStyle(document.documentElement);
    bgInput.value = onRecord ? onRecord["--color-bg"]
      : resolved.getPropertyValue("--color-bg").trim();
    accentInput.value = onRecord ? onRecord["--color-accent"]
      : resolved.getPropertyValue("--color-accent").trim();
    showWarning(onRecord);

    // Never blocks (design mandate 3): a pair that fails is still saved
    // and still applied, and the warning is what stays honest about it -
    // there is no path in this function that refuses to store a color.
    bgInput.addEventListener("input", pickCustom);
    accentInput.addEventListener("input", pickCustom);
  }

  function pickCustom() {
    const bg = bgInput.value, accent = accentInput.value;
    // The browser's own color input never emits anything else; this
    // guard is the same defensive shape the rest of this file uses
    // rather than a case that can actually be reached.
    if (!CustomPalette.isValidHex(bg) || !CustomPalette.isValidHex(accent)) {
      return;
    }
    try {
      localStorage.setItem(CUSTOM_KEY,
        JSON.stringify({ bg: bg, accent: accent }));
      localStorage.setItem(KEY, "custom");
    } catch (e) {}
    apply("custom");
    showWarning(CustomPalette.derive(bg, accent));
  }

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
      // Picking a named palette IS the reset (design mandate 4). The
      // warning is Custom's own honesty about Custom's own colors, and
      // it has nothing to say about a palette that carries none.
      // Pressing Custom itself has to SYNC the warning rather than
      // leave it at whatever the last-visited palette left it as: a
      // member who saved a failing pair, switched away, and switched
      // back is looking at Custom's own colors again, and the warning
      // is what stays honest about THOSE, not about the click that
      // most recently touched it.
      if (name === "custom") showWarning(storedCustomTokens());
      else if (warning) warning.hidden = true;
    });
  });
})();
