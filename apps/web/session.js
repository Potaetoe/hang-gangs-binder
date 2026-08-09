/*
 * The one tab-scoped credential shared by the site's member pages.
 *
 * A session is authority, but it is not key material: it can append a row
 * for one account and reach the member views, but it cannot decrypt a row.
 * sessionStorage gives it exactly the lifetime promised by the design — this
 * tab — without putting it in a URL, a cookie, or persistent storage.
 */
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

  /*
   * Dropping the credential, and telling the shell that it is gone.
   *
   * THE ANNOUNCEMENT BELONGS HERE AND NOT AT THE CALL SITES. A page acting
   * on a 401 is not the only caller: read() lands here too, whenever a
   * stored value is malformed or past its expiry, and nothing calls that
   * on purpose. Announcing from the pages that know they are ending a
   * session covers the deliberate path and leaves that second one
   * describing a credential this function has already thrown away, for
   * the rest of the tab's life, with no author to remember it (#166).
   *
   * The trap is a page contradicting itself rather than a page looking
   * untidy: with the credential gone and the announcement stale, "your
   * sign-in is no longer valid" and "Signed in as <name>" sit on one
   * screen, and the reader has no way to tell which half is true.
   */
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

    // Malformed and expired credentials are not left around to fail every
    // request until the tab closes. They are no session, so store that fact.
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

  /*
   * The one answer to "which page is this" - the sign-in gate below and
   * the rail marking in nav.js both stand on it, which is why it is
   * exported: two readings of location.pathname is how the two could
   * disagree about the same page.
   *
   * The suffix is restored before anything compares the name. Cloudflare
   * Pages serves "submit.html" at "submit" and 308s the full name away,
   * with no setting that refuses (#188, found on #143's hosted bake).
   * Compared raw, that segment matches no rail href, and a host that
   * strips the index name the same way turns requireSession()'s redirect
   * into a loop: the sign-in page arrives named "index", which is never
   * "index.html".
   */
  function pageName() {
    if (!root.location || typeof root.location.pathname !== "string") {
      return "index.html";
    }
    const segment = root.location.pathname.split("/").pop();
    if (!segment) return "index.html";
    return segment.indexOf(".") === -1 ? segment + ".html" : segment;
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
    pageName,
    require: requireSession,
  });

  // Every interactive page loads this file, including admin's break-glass
  // path. Announce a stored development session everywhere, but let each page
  // choose when it requires one: submit does now; dashboard and admin gain
  // their route-specific gates in their own later slices.
  if (typeof document !== "undefined") announce(read());
})(globalThis);
