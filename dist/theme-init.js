

(function () {
  "use strict";

  try {
    const chosen = localStorage.getItem("hgb-palette");
    if (chosen && chosen !== "custom") {
      document.documentElement.setAttribute("data-theme", chosen);
    }
  } catch (e) {}
})();
