

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

     
     
     
    say("Signed in — opening your page…", "good");
    if (root.location && typeof root.location.replace === "function") {
      root.location.replace("your-page.html");
    }
    return session;
  }

  root.BinderAuth = Object.freeze({ authenticate });

   
   
  root.onTelegramAuth = function (payload) {
     
     
     
    return authenticate("/auth/telegram", payload).catch(function () {
      return null;
    });
  };

  

  const SIGNED_OUT_KEY = "hgb-signed-out";

  function acknowledgeSignOut() {
    let marked = false;
    try {
      const store = root.sessionStorage;
      if (store && store.getItem(SIGNED_OUT_KEY) !== null) {
        marked = true;
        store.removeItem(SIGNED_OUT_KEY);
      }
    } catch (error) {
       
       
       
      return;
    }
    if (!marked) return;
    const line = document.getElementById("signed-out");
    if (line && UI && typeof UI.show === "function") UI.show(line, true);
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
       
       
       
      if (root.console && typeof root.console.warn === "function") {
        root.console.warn("binder: " +
          (error && error.message ? error.message : "sign-in boot failed"));
      }
      say("Sign-in did not start correctly — reload and try again.", "bad");
    });
  }
})(globalThis);
