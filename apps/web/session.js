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
   * A browser that will not let go of a dead credential, said once.
   *
   * removeItem throws in hardened configurations and under an exhausted
   * quota, and until this the throw was swallowed whole. It is worth one
   * line because it is not a cosmetic failure: it is the condition that
   * makes clear() reachable from its own announcement, and a page that
   * meets it leaves no other trace of having done so. Once per tab,
   * because a store that refuses one removal refuses every one and the
   * fact is worth exactly one line however many times it recurs.
   */
  let reportedStuck = false;

  function reportStuck(error) {
    if (reportedStuck) return;
    reportedStuck = true;
    if (root.console && typeof root.console.warn === "function") {
      root.console.warn("This browser refused to remove the stored session, " +
        "so a dead credential stays in sessionStorage until the tab closes. " +
        "Nothing here will use it.", error);
    }
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
   *
   * RE-ENTRY IS BOUNDED STRUCTURALLY rather than by argument.
   *
   * clear() announces; every listener re-reads; read() is itself a
   * caller of clear(). That chain terminates because the second read
   * leaves at `if (!raw) return null` - the key is already gone. THE
   * ARGUMENT DEPENDS ENTIRELY ON THE REMOVAL HAVING WORKED. When it
   * throws, the stored value is still there and still expired, so every
   * re-read disposes of it again: about two thousand frames deep, two
   * thousand repaints, and a RangeError swallowed by the listener guard
   * below - in a browser, on the expiry path, which is a tab left open
   * overnight rather than an exotic case.
   *
   * So a clear() running inside another clear()'s announcement performs
   * its removal and returns without announcing. The outer announcement
   * is already telling every listener the same thing, and the depth
   * cannot exceed two whatever the store does. Do not replace this with
   * a check that the value is gone: that is the same argument again,
   * and it is the argument the throwing store falsifies.
   */
  let announcing = false;

  function clear() {
    const storage = store();
    if (storage) {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch (error) {
        // The verdict does not change: read() below still answers null,
        // so nothing acts on a value this file has disowned. Only the
        // silence changes.
        reportStuck(error);
      }
    }
    if (announcing) return;
    announcing = true;
    try {
      announce(null);
    } finally {
      announcing = false;
    }
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
    //
    // The early return above still keeps the ordinary re-read cheap -
    // listeners arrive back here to a key that is already gone and leave
    // before this line. It is no longer what BOUNDS the recursion,
    // because it cannot: a store whose removeItem throws leaves the key
    // exactly where it was, and this line disposes of it again on every
    // re-read. clear()'s own re-entry latch is the bound. Moving the
    // disposal ahead of that return, or announcing for a key that was
    // never there, is still the wrong direction.
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
    // Gaining one is a change to the stored credential as much as losing
    // one is. Announcing only the losses would make onChange a name for
    // half of what it says, and leave the next surface to subscribe
    // reacting to sign-out and silently not to sign-in - the same class
    // of half-wired shell #166 is about. It is announced after the store
    // succeeds, so nothing paints a session this function then refuses.
    announce(value);
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
   * Pages serves "your-page.html" at "your-page" and 308s the full name away,
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

  /*
   * Who to tell when the stored credential changes.
   *
   * The card above is this file's own surface. The rail's "Signed in as
   * <name>" is signout.js's, and neither this file nor the next surface
   * to need the same treatment should be the place that knows about the
   * other's markup: the store says its credential changed, and whoever
   * paints from a session subscribes and looks again (#166).
   *
   * NOTHING IS HANDED TO THE LISTENER, AND THAT IS THE POINT. A listener
   * given a copy can paint from a credential the store has already moved
   * past - which is the bug this whole line of work is about, arriving by
   * a shorter route. One that re-reads cannot, and read() stays the
   * single answer to what is true.
   */
  function onChange(listener) {
    if (typeof listener === "function") listeners.push(listener);
  }

  /*
   * A listener that throws is a painting fault, and it must not become a
   * credential fault. clear() runs from read() and from every refusal
   * path, so an exception escaping here would turn disposing of a dead
   * token into a broken page at a moment nobody chose - and would stop
   * the listeners after it from hearing at all.
   */
  function announce(value) {
    paintDevelopmentCard(value);
    for (let i = 0; i < listeners.length; i += 1) {
      try {
        listeners[i]();
      } catch (error) {
        // Swallowed for the reason above. There is no surface to report
        // it on: the one this would report through is the one that just
        // failed to paint.
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

  // Every interactive page loads this file, including admin's break-glass
  // path. Announce a stored development session everywhere, but let each page
  // choose when it requires one: submit does now; dashboard and admin gain
  // their route-specific gates in their own later slices.
  if (typeof document !== "undefined") announce(read());
})(globalThis);
