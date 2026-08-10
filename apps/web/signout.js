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

  const Session = root.BinderSession;

  function localStore() {
    try {
      return root.localStorage || null;
    } catch (error) {
      return null;
    }
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
   * The member's device key, destroyed here rather than where it is
   * made.
   *
   * DESIGN.md's Encryption section already says signing out destroys it,
   * and names the price out loud: getting a history back afterwards
   * costs a re-seal request to an admin. That price was accepted on
   * #56's own reasoning, with more at stake rather than less - the
   * prefill is one measurement a member typed, and this key opens
   * everything they have ever submitted. A browser two people share
   * must not hand the second one the first one's history.
   *
   * It is here, in the module every signed-in page loads, for exactly
   * the reason the prefill clear is: whether the key gets destroyed must
   * not depend on which page somebody happened to be standing on when
   * they pressed the button. memberkey.js is loaded only by the page
   * that seals entries, so the call is guarded rather than assumed -
   * and a page without it has no key of its own to destroy.
   *
   * Not awaited, and that is the same trade the revoke above makes for
   * the same reason: the user-visible act is leaving, and a member
   * cannot be held on the page by a storage call. `forget()` never
   * rejects, so nothing is left unhandled; the delete is started before
   * the navigation below, which is what gives it a turn to run.
   */
  function forgetDeviceKey() {
    const keys = root.BinderMemberKey;
    if (keys && typeof keys.forget === "function") keys.forget();
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
    if (root.location && typeof root.location.replace === "function") {
      root.location.replace("index.html");
    }
  }

  root.BinderSignOut = Object.freeze({
    signOut,
    clearPrefill,
    prefillKey: PREFILL_KEY,
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
