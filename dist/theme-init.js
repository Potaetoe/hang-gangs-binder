

(function () {
  "use strict";

  var PALETTES = ["midnight", "pink", "daylight", "contrast"];

  function schemeDefault() {
    return (window.matchMedia &&
      matchMedia("(prefers-color-scheme: dark)").matches)
      ? "midnight" : "daylight";
  }

  try {
    const chosen = localStorage.getItem("hgb-palette");
    if (chosen && PALETTES.indexOf(chosen) !== -1) {
      document.documentElement.setAttribute("data-theme", chosen);
    } else {
      document.documentElement.setAttribute("data-theme", schemeDefault());
    }
  } catch (e) {}
})();
