

(function () {
  "use strict";

  if (typeof document === "undefined") return;

  document.addEventListener("DOMContentLoaded", function () {
    

    const here = BinderSession.pageName();
    const links = document.querySelectorAll(".rail-links a");
    Array.prototype.forEach.call(links, function (link) {
      const target = link.getAttribute("href").split("/").pop();
      if (target === here) link.setAttribute("aria-current", "page");
    });
  });
})();
