

(function () {
  "use strict";

  const PALETTES = ["midnight", "pink", "daylight", "contrast"];

  function schemeDefault() {
    return (window.matchMedia &&
      matchMedia("(prefers-color-scheme: dark)").matches)
      ? "midnight" : "daylight";
  }

  function valid(name) {
    return !!name && PALETTES.indexOf(name) !== -1;
  }

  try {
    const chosen = localStorage.getItem("hgb-palette");
    const adminDefault = localStorage.getItem("hgb-default-theme");
    let painted;
    if (valid(chosen)) {
      painted = chosen;
    } else if (valid(adminDefault)) {
      painted = adminDefault;
    } else {
      painted = schemeDefault();
    }
    document.documentElement.setAttribute("data-theme", painted);
  } catch (e) {}
})();
