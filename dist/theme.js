

(function () {
  "use strict";
   
   
   
   
   
   
   
  const KEY = "hgb-palette";
   
   
   
   
   
   
  const DEFAULT_THEME_KEY = "hgb-default-theme";
  const BG = {
    pink: "#1e141a", daylight: "#f3eadb", midnight: "#120d10",
    contrast: "#000000",
  };
  const buttons = document.querySelectorAll("[data-set-theme]");

   
   
   
   
  function paintChrome(name) {
    const background = BG[name];
    if (!background) return;
    Array.prototype.forEach.call(
      document.querySelectorAll('meta[name="theme-color"]'),
      function (m) { m.setAttribute("content", background); }
    );
  }

   
   
   
   
   
   
   
  function apply(paintName, pressedName) {
    document.documentElement.setAttribute("data-theme", paintName);
    paintChrome(paintName);
    const mark = pressedName || paintName;
    Array.prototype.forEach.call(buttons, function (b) {
      b.setAttribute("aria-pressed",
        String(b.getAttribute("data-set-theme") === mark));
    });
  }

   
   
   
   
   
   
   
  function schemeDefault() {
    return (window.matchMedia &&
      matchMedia("(prefers-color-scheme: dark)").matches)
      ? "midnight" : "daylight";
  }

  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}

   
   
   
   
   
   
   
   
  if (stored && !Object.prototype.hasOwnProperty.call(BG, stored)) {
    stored = null;
  }

   
   
   
   
   
   
   
   
   
   
  let adminDefault = null;
  try { adminDefault = localStorage.getItem(DEFAULT_THEME_KEY); } catch (e) {}
  if (adminDefault && !Object.prototype.hasOwnProperty.call(BG, adminDefault)) {
    adminDefault = null;
  }

  

  if (!buttons.length) {
    paintChrome(stored || adminDefault || schemeDefault());
    return;
  }

   
   
   
   
   
   
   
   
   
   
  const resting = stored || adminDefault || schemeDefault();
  const pressed = resting;
  apply(resting, pressed);

   
   
   
   
   
   
   
   
  Array.prototype.forEach.call(buttons, function (b) {
    b.addEventListener("click", function () {
      const name = b.getAttribute("data-set-theme");
      apply(name);
      try { localStorage.setItem(KEY, name); } catch (e) {}
    });
  });
})();
