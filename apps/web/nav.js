/*
 * Two jobs: marking where you are in the rail, and opening the Theme
 * chips.
 *
 * They travel together in one file because they are wired to the same
 * markup on the three rail pages. The sign-in page loads this file for
 * the second job alone - the owner's ruling on #150 gives it the same
 * single Theme control, and it has no rail - so the current-destination
 * half finds nothing there and returns. A second copy of the disclosure
 * wiring would be the cheaper-looking answer and the wrong one: two
 * copies drift, and this control has to behave identically on all four
 * pages.
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
 * What this file does not do is open the navigation. The four links are
 * always in flow at every width, and the disclosure below opens the
 * theme chips instead. That is the owner's decision on #73 - the links
 * are the thing somebody needs, so they are the thing that stays.
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
     * The name comes from BinderSession.pageName() rather than a second
     * reading of location.pathname, because the two consumers have to
     * agree: a rail and a sign-in gate with separate opinions of "which
     * page is this" is how #188 shipped - Cloudflare Pages serves
     * "submit.html" at "submit", and the raw last segment matched no
     * href, so the hosted rail marked nothing. pageName() restores the
     * suffix, and the hrefs keep theirs, so the comparison holds from a
     * directory root, from /apps/web/ under a locally served repository
     * root, from GitHub Pages under a project path, and from a
     * pretty-URL CDN alike. session.js loads before this file on all
     * four pages, and tools/check_web.py holds the script order.
     */
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

    /*
     * One function sets both the attribute and the visibility, because
     * they are the same fact. Letting them be set separately is how a
     * panel ends up open on screen and closed to a screen reader.
     *
     * A data attribute rather than the `hidden` one, and that is forced
     * rather than chosen: theme.css makes [hidden] display:none
     * !important, so chips folded that way could not be revealed again
     * by any rule in the stylesheet. This file says open or closed; the
     * stylesheet owns what that looks like, and it has to stay the
     * thing that owns it.
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

    // There is deliberately no click-outside and no focus-out
    // dismissal. Those belong to a panel floating over the page, and
    // the chips open in flow (#150) - nothing is covered, so there is
    // no "outside" to be dismissed from, and closing a list the reader
    // can still see would take it away for no reason they could
    // observe. #82 is where a floating layer gets decided, and it is
    // where these come back if it does.

    // Closed to start with, whatever the markup said. The attribute is
    // what stops the two disagreeing if somebody edits one of them.
    setOpen(false);
  });
})();
