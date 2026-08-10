/*
 * Sign-in transport, deliberately separate from the page that will render
 * the Telegram widget. The widget supplies one payload; local
 * development supplies another. Downstream of the POST, both responses are
 * the same session and travel through the same code here.
 */
(function (root) {
  "use strict";

  const AUTH_PATHS = ["/auth/telegram", "/auth/dev"];
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
      throw new Error("Sign-in is not configured for this hostname.");
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
      const message = body && body.error
        ? body.error
        : "The service refused this sign-in (" + response.status + ").";
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

    say("Signed in. Opening the form…", "good");
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

  if (typeof document !== "undefined" && UI) {
    UI.boot(function () {
      if (root.BinderSession.read() && root.location &&
          typeof root.location.replace === "function") {
        root.location.replace("your-page.html");
      }
    }, function (error) {
      say("Sign-in did not start correctly. " +
        (error && error.message ? error.message : "Reload and try again."),
      "bad");
    });
  }
})(globalThis);
