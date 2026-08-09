

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

    const toggle = document.getElementById("theme-toggle");
    const chips = document.getElementById("theme-chips");
    if (!toggle || !chips) return;

    const group = toggle.closest(".theme-picker");
    if (!group) return;

    function isOpen() {
      return toggle.getAttribute("aria-expanded") === "true";
    }

    

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      group.setAttribute("data-open", open ? "true" : "false");
    }

    toggle.addEventListener("click", function () {
      setOpen(!isOpen());
    });

     
     
     
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && isOpen()) {
        setOpen(false);
        toggle.focus();
      }
    });

     
     
     
     
     
     
     

     
     
    setOpen(false);
  });
})();
