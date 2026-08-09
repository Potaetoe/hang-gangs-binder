/*
 * The demo's browser half: replace fetch, answer from dev/demo-stub.js,
 * and refuse everything else out loud.
 *
 * All wiring, no pure half. Every decision this file makes is made in
 * demo-stub.js, which dev/demo.test.mjs drives under Node; what is left
 * here is reading sessionStorage, swapping one global, and shaping an
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
  const [SCENARIO_KEY, DATA_KEY, WORLD_KEY] = Demo.STORAGE_KEYS;

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

  function world() {
    const stored = readJson(WORLD_KEY, {});
    stored.scenario = root.sessionStorage.getItem(SCENARIO_KEY) || "member";
    stored.data = readJson(DATA_KEY, {});
    return stored;
  }

  function remember(next) {
    const keep = Object.assign({}, next);
    // The corpus is rebuilt by the console on every load and is the
    // largest thing here by far; writing it back on every request would
    // spend the whole sessionStorage budget re-storing what has not
    // changed.
    delete keep.data;
    writeJson(WORLD_KEY, keep);
  }

  /*
   * The feed's transport. What to say is Demo.narrate's - a pure
   * decision dev/demo.test.mjs drives - and this file only posts what
   * comes back, when something does. The channel is named by
   * demo-stub.js because dev/demo.test.mjs scans apps/web for the
   * name; a second copy here could drift out from under that scan.
   *
   * Guarded, and failing silent: this file runs before every shipped
   * script, so anything thrown here stops fetch being replaced at all
   * - and a page reaching real endpoints is strictly worse than a
   * feed with nothing in it.
   */
  const channel = typeof root.BroadcastChannel === "function"
    ? new root.BroadcastChannel(Demo.EVENT_CHANNEL)
    : null;

  function tell(event) {
    if (channel === null) return;
    const line = Demo.narrate(event);
    if (line !== null) channel.postMessage({ line: line });
  }

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

    // Told here, on the one path every stubbed answer passes through,
    // so the feed narrates the traffic that happened rather than the
    // traffic some page was expected to make. The /export answer has
    // no body and narrates anyway - the fetch of the sealed rows is
    // the keyholder card's visible moment.
    tell({
      method: request.method,
      path: request.path,
      status: answer.status,
      body: answer.body,
    });

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
