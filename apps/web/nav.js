/*
 * The rail. Marking where you are, and folding the theme chips away on
 * a screen too narrow to hold them beside the links.
 *
 * The destinations themselves are in the HTML of each rail page, not
 * built here. That is deliberate and it is the opposite of what
 * countries.js does, so it is worth saying why: 250 country options
 * would bury the six fields that matter, whereas four links are the
 * page's own structure, and a page whose navigation vanishes when a
 * script fails is a page somebody can get stranded on. The cost is the
 * same list written three times, which is real - so tools/check_web.py
 * fails the build if the copies ever disagree.
 *
 * What this file no longer does is open the navigation. Before the rail
 * the four links lived behind a hamburger and this file was what made
 * them reachable; now they are always in flow at every width, and the
 * disclosure below opens the theme chips instead. That is the owner's
 * decision on #73 - the links are the thing somebody needs, so they are
 * the thing that stays.
 *
 * All wiring, no pure half. There is nothing here to test under Node
 * that reading the file does not already tell you; what could break is
 * the rendering, which is checked by looking at it.
 */
(function () {
  "use strict";

  if (typeof document === "undefined") return;

  document.addEventListener("DOMContentLoaded", function () {
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
    const links = document.querySelectorAll(".rail-links a");
    Array.prototype.forEach.call(links, function (link) {
      const target = link.getAttribute("href").split("/").pop();
      if (target === here) link.setAttribute("aria-current", "page");
    });

    const toggle = document.getElementById("theme-toggle");
    const chips = document.getElementById("theme-chips");
    if (!toggle || !chips) return;

    const group = toggle.closest(".rail-themes");
    if (!group) return;

    function isOpen() {
      return toggle.getAttribute("aria-expanded") === "true";
    }

    /*
     * One function sets both the attribute and the visibility, because
     * they are the same fact. Letting them be set separately is how a
     * panel ends up open on screen and closed to a screen reader.
     *
     * A data attribute rather than the `hidden` one, and that is forced
     * rather than chosen: theme.css makes [hidden] display:none
     * !important, so chips folded that way on a phone could not be
     * shown again on a desktop by any rule in the stylesheet. The
     * folding is a fact about the width, so the stylesheet has to stay
     * the thing that decides it.
     */
    function setOpen(open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      group.setAttribute("data-open", open ? "true" : "false");
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
      if (!group.contains(event.target)) setOpen(false);
    });

    // Leaving by keyboard closes it as well. Tabbing past the last chip
    // onto the page behind should not leave a panel hanging open over
    // it.
    document.addEventListener("focusin", function (event) {
      if (!isOpen()) return;
      if (!group.contains(event.target)) setOpen(false);
    });

    // Closed to start with, whatever the markup said. The attribute is
    // what stops the two disagreeing if somebody edits one of them.
    setOpen(false);
  });
})();
