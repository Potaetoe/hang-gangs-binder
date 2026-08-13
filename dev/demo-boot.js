/*
 * The demo's browser half: replace fetch, answer from dev/demo-stub.js,
 * move the clock the page reads, and refuse everything else out loud.
 *
 * All wiring, no pure half. Every decision this file makes is made in
 * demo-stub.js, which dev/demo.test.mjs drives under Node; what is left
 * here is reading sessionStorage, swapping two globals, and shaping an
 * answer into a Response.
 *
 * It has to run before any shipped script, so it is a classic script and
 * dev/demo-server.mjs inserts it ahead of the page's own. A module would
 * be deferred until after them, by which time auth.js has already called
 * the real fetch.
 */
(function (root) {
  "use strict";

  const Demo = root.BinderDemo;
  if (!Demo) {
    throw new Error("demo-boot.js loaded without demo-stub.js.");
  }

  // Named by demo-stub.js rather than here, because dev/demo.test.mjs
  // scans apps/web for these strings: a shipped page keyed on one would
  // be a demo hook in the published bytes. A second copy of the names is
  // a second copy that can drift out from under that scan.
  const [WHO_KEY, DATA_KEY, WORLD_KEY] = Demo.STORAGE_KEYS;

  /*
   * The real fetch, kept before anything can take it away. It is the
   * only thing in this demo that can reach the network at all, so both
   * of its call sites below are gated on the same allowlist in
   * demo-stub.js - by path, not by "same origin".
   *
   * It exists for one file: the demo's export rows are a committed
   * sample, so the honest way to serve them is to read them rather than
   * carry eighteen ciphertexts through sessionStorage.
   */
  const realFetch = root.fetch.bind(root);

  function readJson(key, fallback) {
    try {
      const raw = root.sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      root.sessionStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // A demo that cannot persist its world still runs; it forgets a
      // published snapshot between pages. Failing the page over it would
      // be worse than the thing it is reporting.
    }
  }

  /*
   * WHO IS SIGNED IN IS ITS OWN KEY, not a field of the world blob.
   *
   * One home per fact, and this is the fact two doors write: the
   * toolbar's shortcut writes it directly, and the product's own
   * sign-in route writes it through answerFor's `next`. Reading it from
   * one place is what stops those two doors disagreeing about who is
   * holding the tab.
   */
  function world() {
    const stored = readJson(WORLD_KEY, {});
    stored.signedInAs = root.sessionStorage.getItem(WHO_KEY) || null;
    stored.data = readJson(DATA_KEY, {});
    return stored;
  }

  function remember(next) {
    const keep = Object.assign({}, next);
    // The corpus is built by the toolbar and is the largest thing here
    // by far; writing it back on every request would spend the whole
    // sessionStorage budget re-storing what has not changed.
    delete keep.data;
    if (keep.signedInAs) {
      root.sessionStorage.setItem(WHO_KEY, String(keep.signedInAs));
    }
    delete keep.signedInAs;
    writeJson(WORLD_KEY, keep);
  }

  /*
   * THE CLOCK, MOVED HERE AND NOWHERE ELSE.
   *
   * apps/web/admin.js decides whether anybody is still at the page by
   * reading `Date.now()` twice, ten minutes apart. That is the right
   * design - a laptop that sleeps for an hour delivers one late
   * interval, not an hour of them - and it is also why the timer cannot
   * be watched: nobody sits in front of a demo for eight minutes to see
   * a warning appear.
   *
   * So the demo moves the clock the page reads, at the one seam that
   * runs before any shipped script. The offset is in sessionStorage, so
   * it survives the sign-out the expiry performs and the navigation
   * that follows it - which is the half a driver is actually watching.
   *
   * ONLY `Date.now`, DELIBERATELY. `new Date()` is what every rendered
   * date on screen comes from, and shifting that would move the
   * submissions, the last-seen line and the published-at stamp by the
   * same eight minutes - a demo whose data quietly disagrees with its
   * own corpus. The timer reads the clock through `Date.now()`; that is
   * the whole of what has to move.
   */
  function installClock() {
    const stored = readJson(WORLD_KEY, {});
    const offset = Number(stored.clock);
    if (!Number.isFinite(offset) || offset <= 0) return;
    const realNow = Date.now.bind(Date);
    Date.now = function () { return realNow() + offset; };
  }

  installClock();

  /*
   * The toolbar's own reader, and it is not the product's.
   *
   * The strip rides on the same page as the product now, so its fetch
   * is the replaced one - and the file it needs is a private key, which
   * is exactly what no shipped page may be permitted to read. Held to
   * demo-stub.js's TOOLBAR_FILES rather than to LOCAL_FILES, so
   * widening one list cannot widen the other.
   *
   * Named on a global the product has no word for, which
   * dev/demo.test.mjs scans apps/web to confirm: a shipped page reading
   * this would be a demo hook in the published bytes.
   */
  root.BinderDemoBoot = Object.freeze({
    read: function (path) {
      const decided = Demo.toolbarFileKind(path);
      if (decided.kind !== "file") return Promise.reject(new Error(decided.why));
      return realFetch(decided.path);
    },
  });

  /*
   * Which requests belong to the Worker, and which may leave at all.
   *
   * BINDER_CONFIG is read at call time rather than at load time, because
   * config.js has not run yet when this file does. Both decisions
   * themselves are demo-stub.js's - this file is wiring, and a decision
   * living here is a decision no suite can drive. They compared
   * substrings while they lived here, and two URL classes walked past
   * the refusal; demo-stub.js states what changed and why.
   */
  function endpointOf() {
    const config = root.BINDER_CONFIG || {};
    return typeof config.endpoint === "string" ? config.endpoint : "";
  }

  /*
   * One decision for both directions, made in demo-stub.js.
   *
   * Do not split this back into two questions asked here in sequence -
   * is this the Worker, and failing that is it same-origin. That order
   * breaks only when the demo is hosted: served from a workers.dev
   * URL, the Worker test matches the page's own origin and swallows
   * every request for a file. demo-stub.js states why the same-origin
   * arm runs first and what the file arm is allowed to reach.
   */
  function decide(url) {
    return Demo.requestKindOf(url, root.location.href, endpointOf());
  }

  function respond(answer) {
    return new Response(
      answer.body === undefined ? "" : JSON.stringify(answer.body),
      {
        status: answer.status,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  async function parseBody(init) {
    if (!init || init.body === undefined || init.body === null) return null;
    if (typeof init.body !== "string") return null;
    try {
      return JSON.parse(init.body);
    } catch (error) {
      // A body that is not JSON is a body the Worker would refuse to
      // parse too. Handing the stub a null lets it answer the same way.
      return null;
    }
  }

  root.fetch = async function (input, init) {
    const url = input && input.url ? input.url : input;
    const decided = decide(url);

    if (decided.kind === "refuse") throw new Error(decided.why);
    if (decided.kind === "file") return realFetch(input, init);

    const request = {
      method: (init && init.method) || "GET",
      path: decided.path,
      body: await parseBody(init),
    };

    const answer = Demo.answerFor(request, world());
    remember(answer.next);

    /*
     * A proxied answer goes through the SAME decision rather than
     * straight to the real fetch. realFetch is the untouched browser
     * one, so a path arriving here is a path nothing has checked - and
     * this is the only call site that reaches the network at all. Held
     * to the allowlist, the export route can serve the committed sample
     * and cannot be turned into a read of anything else the build
     * emitted, which on a static host is served to whoever asks.
     *
     * It is also what arms that allowlist: this is the one code path a
     * scenario actually drives through it, so removing the sample from
     * the list breaks the keyholder walk rather than passing unnoticed.
     */
    if (answer.proxy) {
      const proxied = decide(answer.proxy);
      if (proxied.kind !== "file") throw new Error(proxied.why ||
        "The demo refused to proxy " + answer.proxy + ".");
      return realFetch(answer.proxy);
    }
    return respond(answer);
  };
})(globalThis);
