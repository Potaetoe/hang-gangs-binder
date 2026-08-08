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

  const SCENARIO_KEY = "hgb-demo-scenario";
  const DATA_KEY = "hgb-demo-data";
  const WORLD_KEY = "hgb-demo-world";

  /*
   * The real fetch, kept before anything can take it away, and used for
   * exactly one thing: same-origin files out of this repository. The
   * demo's export rows are a committed file, so the honest way to serve
   * them is to read them, not to carry eighteen ciphertexts through
   * sessionStorage.
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
   * Which requests belong to the Worker.
   *
   * Read off BINDER_CONFIG at call time rather than at load time,
   * because config.js has not run yet when this file does. The
   * workers.dev test beside it is not redundant: it catches a page that
   * reaches the endpoint by some route other than the configured one,
   * and the whole promise of this demo is that no request leaves the
   * machine.
   */
  function endpointOf() {
    const config = root.BINDER_CONFIG || {};
    return typeof config.endpoint === "string" ? config.endpoint : "";
  }

  function targetOf(url) {
    const text = String(url);
    const endpoint = endpointOf();
    if (endpoint && text.indexOf(endpoint) === 0) {
      return text.slice(endpoint.length) || "/";
    }
    if (/^https?:\/\/[^/]*workers\.dev/.test(text)) {
      return text.replace(/^https?:\/\/[^/]*/, "") || "/";
    }
    return null;
  }

  function sameOrigin(url) {
    const text = String(url);
    if (text.indexOf("//") === -1) return true;
    return text.indexOf(root.location.origin) === 0;
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
    const path = targetOf(url);

    if (path === null) {
      if (sameOrigin(url)) return realFetch(input, init);

      /*
       * Anything else is a third party, and this is where the demo's one
       * promise is kept: it does not reach a real endpoint. Refusing
       * loudly rather than passing it through, because a demo that
       * quietly phoned home would be indistinguishable from one that did
       * not until somebody read a packet capture.
       */
      throw new Error(
        "The demo refused a request to " + url + ". Nothing here " +
        "reaches a real endpoint."
      );
    }

    const request = {
      method: (init && init.method) || "GET",
      path: path,
      body: await parseBody(init),
    };

    const answer = Demo.answerFor(request, world());
    remember(answer.next);

    if (answer.proxy) return realFetch(answer.proxy);
    return respond(answer);
  };
})(globalThis);
