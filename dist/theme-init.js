

(function () {
  "use strict";
  try {
    const t = localStorage.getItem("hgb-palette");
    if (t) document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
