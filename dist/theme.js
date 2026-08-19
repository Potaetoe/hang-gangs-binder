

(function () {
  "use strict";
   
   
   
   
   
   
   
  const KEY = "hgb-palette";
  const CUSTOM_KEY = "hgb-custom-colors";
  const BG = {
    pink: "#1e141a", daylight: "#f3eadb", midnight: "#120d10",
    contrast: "#000000",
  };
  const buttons = document.querySelectorAll("[data-set-theme]");

   
   
   
   
   
  const CustomPalette = window.BinderCustomPalette;

   
   
   
   
   
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

   
   
   
   
   
   
   
   
   
   
   
  function preferred() {
    if (!window.matchMedia) return "midnight";
    if (matchMedia("(prefers-contrast: more)").matches) return "contrast";
    if (matchMedia("(prefers-color-scheme: light)").matches) return "daylight";
    return "midnight";
  }

  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}

   
   
   
   
   
   
   
   
   
   
  if (stored === "custom" && !storedCustomTokens()) stored = null;

  

  if (!buttons.length) {
    paintChrome(stored || preferred());
    return;
  }

   
   
   
  apply(stored || preferred());

  

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

     
     
     
    bgInput.addEventListener("input", pickCustom);
    accentInput.addEventListener("input", pickCustom);
  }

  function pickCustom() {
    const bg = bgInput.value, accent = accentInput.value;
     
     
     
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

   
   
   
   
   
   
   
   
  Array.prototype.forEach.call(buttons, function (b) {
    b.addEventListener("click", function () {
      const name = b.getAttribute("data-set-theme");
      apply(name);
      try { localStorage.setItem(KEY, name); } catch (e) {}
       
       
       
       
       
       
       
       
       
      if (name === "custom") showWarning(storedCustomTokens());
      else if (warning) warning.hidden = true;
    });
  });
})();
