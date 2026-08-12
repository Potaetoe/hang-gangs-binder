

(function (root) {
  "use strict";

  

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

  

  function revokeSession() {
    const config = root.BINDER_CONFIG || {};
    const headers = Session ? Session.authorization() : {};
    if (!config.endpoint || !headers.Authorization) return;

    root.fetch(config.endpoint + "/session", {
      method: "DELETE",
      headers: headers,
      keepalive: true,
    }).catch(function () {
       
       
    });
  }

  

  const KEY_DB_NAME = "hgb-member-key";

  function database() {
    try {
      return root.indexedDB || null;
    } catch (error) {
       
       
       
      return null;
    }
  }

  

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

  

  if (Session) Session.onChange(paintSession);
})(globalThis);
