/*
 * One job: marking where you are in the rail.
 *
 * It is loaded by the three pages that HAVE a rail and by nothing else.
 * The palette control is theme.js's whole subject - the disclosure
 * opens itself and the sign-in page has none - so a page with no rail
 * has no reason to fetch this file at all, and the sign-in page does
 * not.
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
 * always in flow at every width - that is the owner's decision on #73,
 * and the links are the thing somebody needs, so they are the thing
 * that stays.
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
     * "your-page.html" at "your-page", and the raw last segment matched no
     * href, so the hosted rail marked nothing. pageName() restores the
     * suffix, and the hrefs keep theirs, so the comparison holds from a
     * directory root, from /apps/web/ under a locally served repository
     * root, from GitHub Pages under a project path, and from a
     * pretty-URL CDN alike. session.js loads before this file on all
     * three rail pages, and tools/check_web.py holds the script order.
     */
    const here = BinderSession.pageName();
    const links = document.querySelectorAll(".rail-links a");
    Array.prototype.forEach.call(links, function (link) {
      const target = link.getAttribute("href").split("/").pop();
      if (target === here) link.setAttribute("aria-current", "page");
    });
  });
})();
