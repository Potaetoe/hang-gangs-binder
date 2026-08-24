/*
 * Sign-in transport, deliberately separate from the page that will render
 * the Telegram widget. The widget supplies the payload; the POST and
 * everything downstream of it live here.
 *
 * AUTH_PATHS stays a list of one. It is an allowlist rather than a
 * parameter check, so the cost of the extra element is nil and the
 * benefit is that adding a second sign-in door has to be a deliberate
 * edit here as well as a route on the Worker - which is the property
 * that made removing the local development door a two-line change rather
 * than an archaeology exercise (0.9-M2-S1, #352).
 */
(function (root) {
  "use strict";

  const AUTH_PATHS = ["/auth/telegram"];
  const UI = root.BinderUI;

  function statusElement() {
    return typeof document === "undefined" ? null :
      document.getElementById("auth-status");
  }

  function say(message, tone) {
    const element = statusElement();
    if (element && UI) UI.setStatus(element, message, tone);
  }

  async function authenticate(path, payload) {
    if (!AUTH_PATHS.includes(path)) {
      throw new Error("That is not a sign-in route.");
    }

    const config = root.BINDER_CONFIG || {};
    if (!config.endpoint) {
      throw new Error("Sign-in is not set up for this address.");
    }

    say("Signing in…", null);
    let response;
    let body;
    try {
      response = await fetch(config.endpoint + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      });
      try {
        body = await response.json();
      } catch (error) {
        body = null;
      }
    } catch (error) {
      say("Sign-in could not reach the service. Try again.", "bad");
      throw error;
    }

    if (!response.ok || !body || body.ok !== true) {
      // The Worker's own `{error}` is written for whoever provoked it
      // and stays. Where it is absent, the fallback must not put a
      // status number in front of somebody trying to sign in: a number
      // is not something they can act on - #265 row 13 - so it goes to
      // the console, where it is useful.
      if (!(body && body.error) && root.console &&
          typeof root.console.warn === "function") {
        root.console.warn("binder: the sign-in route answered " +
          response.status);
      }
      const message = body && body.error
        ? body.error
        : "The service could not answer — try again shortly.";
      say(message, "bad");
      throw new Error(message);
    }

    let session;
    try {
      session = root.BinderSession.write(body);
    } catch (error) {
      say(error.message, "bad");
      throw error;
    }

    // The page this opens lands on "On record", not on the form -
    // submit.js chooses that tab - so "Opening the form" told a member
    // to expect something they do not get (#265 row 20).
    say("Signed in — opening your page…", "good");
    if (root.location && typeof root.location.replace === "function") {
      root.location.replace("your-page.html");
    }
    return session;
  }

  root.BinderAuth = Object.freeze({ authenticate });

  // The widget names this callback in index.html; transport remains here so
  // the third-party script never owns the endpoint or session handling.
  root.onTelegramAuth = function (payload) {
    // The widget does not await callbacks. authenticate() has already put a
    // refusal on screen, so absorb it here rather than adding an unhandled
    // promise rejection to the console as a second, less useful failure.
    return authenticate("/auth/telegram", payload).catch(function () {
      return null;
    });
  };

  /*
   * WHAT A SIGN-OUT LEAVES ON THIS PAGE, AND WHY IT IS SPENT ON SIGHT.
   *
   * signout.js revokes the session, erases the prefill and deletes the
   * device key, then replaces the page with this one. Until #265 the
   * member was shown none of that: the sign-in page they landed on is
   * identical to the one somebody sees arriving for the first time, so
   * the four acts that had just happened to their browser were
   * invisible, and "did that work?" had no answer on screen.
   *
   * The mark is sessionStorage, written by signout.js immediately before
   * the navigation. This reads it and REMOVES IT IN THE SAME BREATH,
   * which is the half that makes the acknowledgement honest: it
   * acknowledges an act, so a reload of this page - or a visit tomorrow
   * in the same tab - must say nothing. A mark that survived its
   * reading would turn one sign-out into a standing notice on a page
   * nobody signed out from.
   *
   * The name is a second literal rather than a borrowed constant
   * because this page does not load signout.js, and it must not: the
   * sign-in page offers no act there is no session for.
   * dev/session.test.mjs compares the two literals.
   *
   * Nothing here runs without scripts, and that costs nothing: sign-out
   * itself is a script, so a browser that cannot show this is one that
   * could not have produced the state it describes.
   *
   * THE VEHICLE IS THE SHARED TOAST (owner ruling 2026-08-23, UX record
   * #454 comment 5389445914): item 8 sends the result of an act to the
   * toast, and item 14 admits only three things above the door's
   * sign-in button - an inline line here was a fourth one on the
   * commonest way back to this page. SIGNED_OUT_LINE is a CONSTANT and
   * is the whole of what is ever shown: the sessionStorage mark is a
   * boolean trigger and never a source of text, so nothing a page,
   * a URL or a store can write reaches the screen through here.
   * tools/check_web.py's RULED_TOAST_LINES pins the words (#275),
   * the call below, and index.html's own #toast element.
   */
  const SIGNED_OUT_KEY = "hgb-signed-out";
  const SIGNED_OUT_LINE = "Signed out.";

  function acknowledgeSignOut() {
    let marked = false;
    try {
      const store = root.sessionStorage;
      if (store && store.getItem(SIGNED_OUT_KEY) !== null) {
        marked = true;
        store.removeItem(SIGNED_OUT_KEY);
      }
    } catch (error) {
      // A store that will not answer is a browser that cannot have
      // written the mark either, so there is nothing to say and nothing
      // to report.
      return;
    }
    if (!marked) return;
    if (UI && typeof UI.showToast === "function") {
      UI.showToast(SIGNED_OUT_LINE);
    }
  }

  if (typeof document !== "undefined" && UI) {
    UI.boot(function () {
      if (root.BinderSession.read() && root.location &&
          typeof root.location.replace === "function") {
        root.location.replace("your-page.html");
        return;
      }
      acknowledgeSignOut();
    }, function (error) {
      // The boot error goes to the console, not into the sentence
      // (#275, rule 1): it names a module a signed-out visitor has
      // never heard of, and there is one thing to do either way.
      if (root.console && typeof root.console.warn === "function") {
        root.console.warn("binder: " +
          (error && error.message ? error.message : "sign-in boot failed"));
      }
      say("Sign-in did not start correctly — reload and try again.", "bad");
    });
  }
})(globalThis);
