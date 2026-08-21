

(function () {
  "use strict";

   
   
   
   
   
  const PALETTES = ["midnight", "pink", "daylight", "contrast"];

  try {
    const chosen = localStorage.getItem("hgb-palette");
    if (chosen && chosen !== "custom") {
      document.documentElement.setAttribute("data-theme", chosen);
    } else {
      const learned = localStorage.getItem("hgb-default-theme");
      if (learned && PALETTES.indexOf(learned) !== -1) {
        document.documentElement.setAttribute("data-theme", learned);
      }
    }
  } catch (e) {}
})();
