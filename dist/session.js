

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
    if (storage) {
      try { storage.removeItem(STORAGE_KEY); } catch (error) {}
    }
    announce(null);
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
     
     
     
     
     
     
    announce(value);
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
    const segment = root.location.pathname.split("/").pop();
    if (!segment) return "index.html";
    return segment.indexOf(".") === -1 ? segment + ".html" : segment;
  }

  function paintDevelopmentCard(value) {
    if (typeof document === "undefined") return;
    const banner = document.querySelector("[data-dev-session]");
    if (!banner) return;

    const development = Boolean(value && value.isDev);
    banner.hidden = !development;
    const identity = banner.querySelector("[data-dev-identity]");
    if (identity) identity.textContent = development ? value.username : "";
  }

  const listeners = [];

  

  function onChange(listener) {
    if (typeof listener === "function") listeners.push(listener);
  }

  

  function announce(value) {
    paintDevelopmentCard(value);
    for (let i = 0; i < listeners.length; i += 1) {
      try {
        listeners[i]();
      } catch (error) {
         
         
         
      }
    }
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
    pageName,
    require: requireSession,
    onChange,
  });

   
   
   
   
  if (typeof document !== "undefined") announce(read());
})(globalThis);
