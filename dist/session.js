

(function (root) {
  "use strict";

  const STORAGE_KEY = "hgb-session";

  function store() {
    try {
      return root.sessionStorage || null;
    } catch (error) {
      return null;
    }
  }

  function normalize(value) {
    if (!value || typeof value !== "object") return null;
    if (typeof value.session !== "string" || !value.session.trim()) {
      return null;
    }
    if (typeof value.username !== "string" || !value.username.trim()) {
      return null;
    }

    const expires = Date.parse(value.expiresAt);
    if (!Number.isFinite(expires) || expires <= Date.now()) return null;

    return Object.freeze({
      session: value.session.trim(),
      expiresAt: new Date(expires).toISOString(),
      username: value.username.trim().toLowerCase(),
      isAdmin: value.isAdmin === true,
      isDev: value.isDev === true,
      telegramId: value.telegramId == null ? null : String(value.telegramId),
    });
  }

  function clear() {
    const storage = store();
    if (!storage) return;
    try { storage.removeItem(STORAGE_KEY); } catch (error) {}
  }

  function read() {
    const storage = store();
    if (!storage) return null;

    let value;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      value = normalize(JSON.parse(raw));
    } catch (error) {
      value = null;
    }

     
     
    if (!value) clear();
    return value;
  }

  function write(response) {
    if (!response || response.ok !== true) {
      throw new Error("The server returned an invalid or expired session.");
    }
    const value = normalize(response);
    if (!value) {
      throw new Error("The server returned an invalid or expired session.");
    }

    const storage = store();
    if (!storage) {
      throw new Error("This browser cannot keep a session for this tab.");
    }
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (error) {
      throw new Error("This browser cannot keep a session for this tab.");
    }
    return value;
  }

  function authorization() {
    const value = read();
    return value ? { Authorization: "Bearer " + value.session } : {};
  }

  function pageName() {
    if (!root.location || typeof root.location.pathname !== "string") {
      return "index.html";
    }
    return root.location.pathname.split("/").pop() || "index.html";
  }

  function announce(value) {
    if (typeof document === "undefined") return;
    const banner = document.querySelector("[data-dev-session]");
    if (!banner) return;

    const development = Boolean(value && value.isDev);
    banner.hidden = !development;
    const identity = banner.querySelector("[data-dev-identity]");
    if (identity) identity.textContent = development ? value.username : "";
  }

  function redirectToSignIn() {
    if (root.location && typeof root.location.replace === "function") {
      root.location.replace("index.html");
    }
  }

  function requireSession() {
    const value = read();
    announce(value);
    if (!value && pageName() !== "index.html") redirectToSignIn();
    return value;
  }

  root.BinderSession = Object.freeze({
    read,
    write,
    clear,
    authorization,
    require: requireSession,
  });

   
   
   
   
  if (typeof document !== "undefined") announce(read());
})(globalThis);
