/*
 * Leaving. One act, one owner, loaded by the three pages that offer it.
 *
 * This is a file rather than a function inside submit.js because the
 * owner put Sign out in the rail, and the rail is on every signed-in
 * page. Three pages wiring it themselves would be three copies of the
 * same four steps, and the copy that goes missing is always the prefill
 * clear - the step with no visible symptom, on the page nobody tests
 * signing out from.
 *
 * It is not inside session.js either, and that boundary is pinned by
 * dev/session.test.mjs rather than merely preferred. session.js is the
 * credential store: its clear() also runs when read() finds a malformed
 * or expired value, and when the member panel gets a 401. A revoke
 * living there would fire a doomed DELETE on both of those - one of
 * them for a session the endpoint has just refused. Ending a session is
 * something somebody does, so it lives at the call site, which is here.
 *
 * The DOM half is behind the usual guard, so Node can load these bytes
 * and exercise the act itself.
 */
(function (root) {
  "use strict";

  /*
   * The device-local entry prefill, and its key lives here rather than
   * in submit.js - which reads it back from this object.
   *
   * That is the wrong way round until you ask what the key is FOR. The
   * prefill is localStorage, so unlike the session it outlives the tab:
   * it is cleartext body data sitting on a possibly shared browser, and
   * AGENTS.md makes erasing it part of what Sign out means. Whether it
   * gets erased therefore must not depend on which page the member
   * happened to be standing on when they pressed the button - and
   * submit.js is loaded on exactly one of the three. So the module that
   * always runs owns the name, and the module that reads the value
   * borrows it.
   *
   * What sits under that one key is the whole of an entry - the
   * measurements, gender, country, affiliations, an age confirmation,
   * and the height the last stored row carried (#172). One key is a
   * deliberate constraint rather than a convenience: this erase is a
   * single removeItem, so it stays correct as fields are added, and a
   * second store for a field somebody judges harmless is how Sign out
   * quietly stops meaning what AGENTS.md says it means.
   */
  const PREFILL_KEY = "hgb-submit-prefill";

  /*
   * The one thing this act leaves behind, and it is a sentence rather
   * than a credential - #265, owner-ruled, and the mockup carries the
   * line it produces.
   *
   * Everything above is destruction, and a member saw none of it: the
   * page they land on is the sign-in page exactly as it looks to
   * somebody arriving for the first time, so signing out and never
   * having signed in were indistinguishable. This is the mark that
   * tells them apart, and index.html spends it on arrival.
   *
   * sessionStorage, for the reason the session itself uses it: the fact
   * is about THIS TAB. A second tab of this origin signed nobody out and
   * must not be told it did, and a mark in localStorage would greet
   * whoever opens the site next week.
   *
   * The name is written down twice, here and in auth.js, because
   * index.html does not load this file - it must not offer an act there
   * is no session for - so the reader cannot borrow the constant the
   * way submit.js borrows the prefill key. dev/session.test.mjs
   * compares the two literals: a rename on one side alone
   * leaves a sign-out marking a page nobody reads and a door waiting on
   * a mark nobody writes, both silent.
   */
  const SIGNED_OUT_KEY = "hgb-signed-out";

  const Session = root.BinderSession;

  function localStore() {
    try {
      return root.localStorage || null;
    } catch (error) {
      return null;
    }
  }

  /*
   * Guarded the way every other store access here is: reading
   * sessionStorage throws outright in some hardened configurations, and
   * an exception between the erasures and the navigation would leave a
   * member signed in on the page they pressed Sign out on - which is
   * the failure this whole file is arranged to avoid, traded for a
   * sentence.
   */
  function markSignedOut() {
    try {
      if (root.sessionStorage) root.sessionStorage.setItem(SIGNED_OUT_KEY, "1");
    } catch (error) {}
  }

  function clearPrefill() {
    const store = localStore();
    if (!store) return;
    try { store.removeItem(PREFILL_KEY); } catch (error) {}
  }

  /*
   * Ask the endpoint to delete the session row, and do not wait to hear
   * back - #90.
   *
   * Dropping this tab's copy of the token is not the end of a session.
   * The row is, and without this request it survives to its natural
   * expiry: a token captured beforehand stays a working credential for
   * up to seven days, which is exactly the window somebody pressing
   * Sign out is trying to close.
   *
   * Best-effort is the design and not a shortcut. Awaiting this would
   * put the network between a member and signing out - a dead
   * connection, or a Worker that never answers, and the button does
   * nothing while the credential sits in this tab. The row expires on
   * its own either way, so a failed revoke costs the hardening; a failed
   * sign-out costs the thing the button is for. Nothing is reported for
   * it either: the user-visible act is the local clear below, it always
   * succeeds, and a message about the other half would describe a
   * sign-out that did not happen.
   *
   * keepalive is load-bearing, not decoration. signOut() navigates in
   * the same turn, and a browser cancels in-flight fetches when the page
   * goes; without it this is a request that reliably never arrives.
   *
   * No session, no request. The endpoint refuses a DELETE it cannot
   * authenticate, and there is no row to end.
   */
  function revokeSession() {
    const config = root.BINDER_CONFIG || {};
    const headers = Session ? Session.authorization() : {};
    if (!config.endpoint || !headers.Authorization) return;

    root.fetch(config.endpoint + "/session", {
      method: "DELETE",
      headers: headers,
      keepalive: true,
    }).catch(function () {
      // Handled so an abandoned promise cannot log a rejection about a
      // sign-out that, from here, worked.
    });
  }

  /*
   * The member's device key, destroyed here although nothing here makes
   * one any more.
   *
   * NOTHING WRITES THIS DATABASE TODAY. The client seal is gone with the
   * keys (DESIGN.md, "Trust model: the Worker reads"), and 0.9-M2-S5
   * (#356) deleted apps/web/memberkey.js, the module that filled it. The
   * destruction stays anyway, and that is a ruling rather than an
   * oversight: every browser that visited the old pages is still
   * carrying `hgb-member-key`, holding a private key that opens
   * everything that member ever submitted, and the only code that can
   * remove it from those browsers is code they load. A device is not
   * cleaned up by a deployment. This line is the cleanup.
   *
   * IT IS DESTROYED FROM HERE AND UNCONDITIONALLY, because IndexedDB is
   * origin-wide. The key sits in this origin whatever page the member is
   * standing on, so destruction cannot depend on which modules that page
   * happened to load. Reaching through a key module is how sign-out came
   * to destroy nothing on charts.html and admin.html, which are the two
   * pages a member is most likely to leave from (#257). That is the same
   * argument the prefill's key makes above, and it is why both acts live
   * in the module every signed-in page runs.
   *
   * DELETING THE DATABASE, not the row. A delete of one key leaves the
   * store, the database and anything else in it behind. Sign out means
   * this device retains nothing of this member's, and a deleted database
   * is a claim a reader can check.
   *
   * The name is now written down HERE ALONE, which is why
   * dev/signout.test.mjs pins the literal itself rather than comparing
   * two files. A rename here with no second copy to disagree would leave
   * sign-out deleting a database nobody ever made while the real one
   * survives, and that failure has no symptom at all.
   *
   * ONE NAME, AND NOTHING ENUMERATED. Sign out is in the rail on
   * admin.html too, where the keyholder's imported working copy lives in
   * a database of its own. A sweep over the origin's databases, or a
   * second name added here for tidiness, would destroy the corpus key on
   * the way out of the export page.
   *
   * Never thrown from and never waited on, which is the same trade the
   * revoke above makes for the same reason: the user-visible act is
   * leaving, and a member cannot be held on the page by a storage call.
   * Both guards below are load-bearing rather than defensive - reading
   * `indexedDB` throws outright in some hardened configurations, and
   * `deleteDatabase` can refuse on an origin whose storage is disabled.
   * Either one, unguarded, ends signOut() above the credential clear and
   * the navigation, so the member is left signed in on the page they
   * pressed Sign out on - which is worse than the key surviving.
   */
  const KEY_DB_NAME = "hgb-member-key";

  function database() {
    try {
      return root.indexedDB || null;
    } catch (error) {
      // Accessing indexedDB throws outright in some hardened
      // configurations rather than reading undefined, and that is a
      // browser without one rather than a fault to report.
      return null;
    }
  }

  /*
   * Silent, and assigned rather than left unset so that neither outcome
   * surfaces as an unhandled error event in a console a member has open.
   *
   * There is nothing to do about either, which is why nothing is done. A
   * block is another tab holding the database open, and that tab closes
   * its handle after every transaction, so the delete completes the
   * moment it does. A retry, a close() of somebody else's connection, or
   * a timeout would each put a wait between a member and leaving, for an
   * act that either finishes on its own or is finished by the next
   * sign-out - and DESIGN.md's recovery path covers the remainder.
   */
  function unreported() {}

  function forgetDeviceKey() {
    const factory = database();
    if (!factory) return;
    let request;
    try {
      request = factory.deleteDatabase(KEY_DB_NAME);
    } catch (error) {
      return;
    }
    request.onerror = unreported;
    request.onblocked = unreported;
  }

  function signOut() {
    // Ordered: the revoke needs the token that the lines below destroy.
    // The session is authority, the prefill is cleartext body data, and
    // the device key opens the whole history - so all three leave
    // together, because "Sign out" means this device retains none of
    // them and the endpoint keeps the session no longer either.
    //
    // The navigation is last and cannot move: a page that has already
    // been replaced finishes none of the erasures above it.
    revokeSession();
    clearPrefill();
    forgetDeviceKey();
    if (Session) Session.clear();
    // Immediately before the navigation, and that order is the whole of
    // it: location.replace() ends this page, so a mark written after it
    // is a mark written by nobody.
    markSignedOut();
    if (root.location && typeof root.location.replace === "function") {
      root.location.replace("index.html");
    }
  }

  root.BinderSignOut = Object.freeze({
    signOut,
    clearPrefill,
    prefillKey: PREFILL_KEY,
    signedOutKey: SIGNED_OUT_KEY,
  });

  if (typeof document === "undefined") return;

  /*
   * The rail's session home. The Sign out control ships `hidden` and is
   * revealed only once a session is confirmed, which is the honest
   * resting state: with no session there is nothing to end, and with
   * scripts dead there is no way to end one, so a button offering to
   * would be a control that does nothing.
   *
   * The Sign in route beside it is the same reasoning read the other
   * way (#187). It ships VISIBLE: with scripts dead there is no
   * session, the door is exactly what the rail must still carry - the
   * anti-stranding rule in tools/check_web.py stands on it - and it is
   * a plain link, so it works with nothing running. A confirmed session
   * is what hides it, the reverse of the button below.
   *
   * The name is the member's own, on a screen their own session opened.
   * It is read from the session rather than fetched - this file makes
   * no request that is not the revoke.
   */
  function paintSession() {
    const who = document.getElementById("session-who");
    const door = document.getElementById("sign-in");
    const button = document.getElementById("sign-out");
    const session = Session ? Session.read() : null;

    if (who) {
      who.textContent = session
        ? "Signed in as " + session.username
        : "Not signed in";
    }
    if (door) door.hidden = !!session;
    if (button) {
      button.hidden = !session;
      if (session) button.addEventListener("click", signOut);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", paintSession, { once: true });
  } else {
    paintSession();
  }

  /*
   * And again whenever the credential changes under the tab - #166.
   *
   * The paint above runs once, at load, which is right for the case it
   * was written for: a member arrives already signed in. It is wrong for
   * the case that ends a session without leaving the page. A Worker 401
   * on the dashboard, or a stored value that expires while the tab sits
   * open, both drop the credential and stay put - and the rail goes on
   * naming the member, three inches from a page saying the sign-in is no
   * longer valid.
   *
   * The whole handler is the same function again, and nothing about it
   * had to change: it reads the session fresh, recomputes all three
   * controls from it, and on the path that matters here - no session -
   * never reaches the click registration at all.
   *
   * The subscription is not conditional on there being a session now.
   * The state worth reacting to is precisely the one that does not exist
   * yet, and a page that loads signed out is the page a session is about
   * to be minted on.
   */
  if (Session) Session.onChange(paintSession);
})(globalThis);
