

(function () {
  "use strict";
   
   
   
   
   
   
   
  const KEY = "hgb-palette";
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

  function apply(name) {
    document.documentElement.setAttribute("data-theme", name);
    paintChrome(name);
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

  

  if (!buttons.length) {
    paintChrome(stored || preferred());
    return;
  }

   
   
   
  apply(stored || preferred());

  

  const picker = document.querySelector("details.theme-picker");
  const panel = picker && picker.querySelector(".theme-flyout");
  const summary = picker && picker.querySelector("summary");

   
   
   
   
  function place() {
    if (!panel) return;
    picker.removeAttribute("data-flip");
    if (panel.getBoundingClientRect().top < 0) {
      picker.setAttribute("data-flip", "down");
    }
  }

   
   
   
  function close() {
    if (!picker || !picker.open) return;
    picker.open = false;
    summary.focus();
  }

  if (picker) {
    picker.addEventListener("toggle", function () {
      if (picker.open) place();
    });

     
     
     
     
     
     
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
       
       
       
       
      close();
    });
  });
})();
