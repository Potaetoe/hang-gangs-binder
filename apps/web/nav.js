/*
 * The navigation menu. Opening, closing, and marking where you are.
 *
 * The links themselves are in the HTML of each page, not built here.
 * That is deliberate and it is the opposite of what countries.js does,
 * so it is worth saying why: 250 country options would bury the six
 * fields that matter, whereas three links are the page's own structure,
 * and a page whose navigation vanishes when a script fails is a page
 * somebody can get stranded on. The cost is the same list written five
 * times, which is real - so tools/check_web.py fails the build if the
 * five ever disagree.
 *
 * All wiring, no pure half. There is nothing here to test under Node
 * that reading the file does not already tell you; what could break is
 * the rendering, which is checked by looking at it.
 */
(function () {
  "use strict";

  if (typeof document === "undefined") return;

  document.addEventListener("DOMContentLoaded", function () {
    const toggle = document.getElementById("nav-toggle");
    const menu = document.getElementById("nav-menu");
    if (!toggle || !menu) return;

    function isOpen() {
      return toggle.getAttribute("aria-expanded") === "true";
    }

    /*
     * One function sets both the attribute and the visibility, because
     * they are the same fact. Letting them be set separately is how a
     * menu ends up open on screen and closed to a screen reader.
     */
    function setOpen(open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      menu.hidden = !open;
    }

    toggle.addEventListener("click", function () {
      setOpen(!isOpen());
    });

    // Escape closes it and puts focus back on the button. Without the
    // second half, focus is left inside something that is no longer
    // there and the next Tab starts from the top of the document.
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && isOpen()) {
        setOpen(false);
        toggle.focus();
      }
    });

    // A click anywhere else closes it. `contains` covers the toggle too,
    // so this does not fight the button's own handler and immediately
    // reopen what that just closed.
    document.addEventListener("click", function (event) {
      if (!isOpen()) return;
      const nav = toggle.closest(".nav");
      if (nav && !nav.contains(event.target)) setOpen(false);
    });

    // Leaving by keyboard closes it as well. Tabbing past the last link
    // onto the page behind should not leave a menu hanging open over it.
    document.addEventListener("focusin", function (event) {
      if (!isOpen()) return;
      const nav = toggle.closest(".nav");
      if (nav && !nav.contains(event.target)) setOpen(false);
    });

    /*
     * Which link is this page.
     *
     * Compared on the last path segment rather than the whole href,
     * because the same markup is served from a directory root, from
     * /apps/web/ under a locally served repository root, and from
     * GitHub Pages under a project path. An empty segment is the
     * directory index, which is the sign-in page.
     */
    const here = location.pathname.split("/").pop() || "index.html";
    Array.prototype.forEach.call(menu.querySelectorAll("a"), function (link) {
      const target = link.getAttribute("href").split("/").pop();
      if (target === here) link.setAttribute("aria-current", "page");
    });

    // Closed to start with, whatever the markup said. The attribute is
    // in the HTML so the menu is not visible before this runs; this is
    // what stops the two disagreeing if somebody edits one of them.
    setOpen(false);
  });
})();
