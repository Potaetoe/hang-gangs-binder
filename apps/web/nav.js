/*
 * Three jobs, all about the shared shell rather than a page's own
 * content: marking where you are in the rail (and, since 0.9-M3-S33,
 * #457, in the bottom bar), gating the bar's Admin item to admins, and
 * showing/wiring the bar's own Sign out item.
 *
 * It is loaded by the three pages that HAVE a rail and a bar, and by
 * nothing else. The palette control is theme.js's whole subject - the
 * disclosure opens itself and the sign-in page has none - so a page
 * with no rail has no reason to fetch this file at all, and the
 * sign-in page does not.
 *
 * THE BAR'S SIGN OUT ITEM IS WIRED HERE, DELIBERATELY, NOT IN
 * apps/web/signout.js beside the rail's own copy. `tools/tier.py`
 * reads signout.js as an auth/session module (it revokes the session
 * row, clears the device key) and tiers ANY edit to it sensitive
 * regardless of size (AGENTS.md, "The M3 delivery shape") - this slice
 * builds on the normal tier, so the bar's copy reads the same public,
 * already-frozen `BinderSession`/`BinderSignOut` exports nav.js's own
 * admin gate already reads, from a file that stays normal. Nothing
 * about signing out changes; only where the button that starts it is
 * found and shown.
 *
 * The destinations themselves are in the HTML of each rail/bar page,
 * not built here. That is deliberate and it is the opposite of what
 * countries.js does, so it is worth saying why: 250 country options
 * would bury the six fields that matter, whereas four links are the
 * page's own structure, and a page whose navigation vanishes when a
 * script fails is a page somebody can get stranded on. The cost is the
 * same list written three or four times, which is real - so
 * tools/check_web.py fails the build if the copies ever disagree.
 *
 * What this file does not do is open the navigation. The rail's four
 * links are always in flow at every width - that is the owner's
 * decision on #73, and the links are the thing somebody needs, so they
 * are the thing that stays. The bar replaces the rail's role on a
 * phone (theme.css's own comment on .tab-bar carries that ruling); it
 * is not a disclosure either, just a different position for the same
 * kind of always-visible destination.
 *
 * Mostly wiring, with one small pure-shaped read (isAdminVia, used
 * only to decide true/false and easy to exercise without a document).
 */
(function (root) {
  "use strict";

  /*
   * True when GET /me's own `adminVia` names a real reason - the same
   * four values apps/web/admin.js's loadAdminVia() already recognizes
   * (telegram/flag/secret/break-glass). Absent, empty or unrecognized
   * all read as "not an admin here" rather than as an error: a
   * member's own bar simply keeps its fourth item hidden, the honest
   * default this function shares with the rest of the bar's own
   * hidden-until-confirmed items.
   */
  function isAdminVia(value) {
    return value === "telegram" || value === "flag" ||
      value === "secret" || value === "break-glass";
  }

  root.BinderNav = Object.freeze({ isAdminVia });

  if (typeof document === "undefined") return;

  /*
   * Which link is this page - shared by the rail and the bar, since
   * both name the same four destinations.
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
  function markCurrent() {
    const here = BinderSession.pageName();
    const links = document.querySelectorAll(".rail-links a, .tab-bar-item");
    Array.prototype.forEach.call(links, function (link) {
      const href = link.getAttribute("href");
      if (!href) return; // #tab-bar-signout is a <button>, not a link
      const target = href.split("/").pop();
      if (target === here) link.setAttribute("aria-current", "page");
    });
  }

  /*
   * The bar's Admin item, gated by /me's adminVia rather than by
   * anything cached at sign-in - the same reasoning admin.js's own
   * loadAdminVia() carries, applied to a control every signed-in
   * member's page now renders. Ships `hidden` (the honest resting
   * state every session-dependent bar/rail control ships with) and is
   * revealed only once this answers true - never on a request that
   * fails or on a Worker that predates the field, which both read as
   * "say nothing" rather than as "assume admin".
   */
  function gateAdminItem() {
    const item = document.getElementById("tab-bar-admin");
    if (!item) return;
    const config = root.BINDER_CONFIG || {};
    const session = root.BinderSession && root.BinderSession.read();
    if (!config.endpoint || !session) return;
    root.fetch(config.endpoint + "/me", {
      headers: root.BinderSession.authorization(),
    }).then(function (response) {
      if (!response.ok) return null;
      return response.json();
    }).then(function (payload) {
      if (payload && isAdminVia(payload.adminVia)) item.hidden = false;
    }).catch(function () {
      // A network failure says nothing, same as an unreadable answer -
      // the item stays hidden, which is the safe default this whole
      // function exists to keep.
    });
  }

  /*
   * The bar's Sign out item - the same honest-resting-state rule the
   * rail's own #sign-out follows (see apps/web/signout.js's own
   * comment on paintSession()): ships `hidden`, revealed only once a
   * session is confirmed, because with no session there is nothing to
   * end. Wired to the same `BinderSignOut.signOut()` the rail's own
   * button calls - both are one act, two buttons, never two copies of
   * what leaving means.
   *
   * Re-run on every session change (`BinderSession.onChange`), not
   * only at load, for the reason signout.js's own paintSession()
   * gives: a 401 elsewhere in the tab, or a stored session expiring
   * while this tab sits open, both drop the credential without
   * leaving the page, and a bar still offering to end a session that
   * is already gone is a control that does nothing.
   */
  function paintBarSignOut() {
    const button = document.getElementById("tab-bar-signout");
    if (!button) return;
    const session = root.BinderSession && root.BinderSession.read();
    button.hidden = !session;
    if (session && root.BinderSignOut) {
      button.addEventListener("click", root.BinderSignOut.signOut);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    markCurrent();
    gateAdminItem();
    paintBarSignOut();
  });

  if (root.BinderSession) root.BinderSession.onChange(paintBarSignOut);
})(globalThis);
