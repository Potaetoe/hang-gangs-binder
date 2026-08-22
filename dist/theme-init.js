

(function () {
  "use strict";

  function schemeDefault() {
    return (window.matchMedia &&
      matchMedia("(prefers-color-scheme: dark)").matches)
      ? "midnight" : "daylight";
  }

  try {
    const chosen = localStorage.getItem("hgb-palette");
    if (chosen && chosen !== "custom") {
      document.documentElement.setAttribute("data-theme", chosen);
    } else {
      document.documentElement.setAttribute("data-theme", schemeDefault());
    }
  } catch (e) {}
})();
