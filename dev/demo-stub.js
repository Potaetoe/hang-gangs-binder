/*
 * The demo's pure half: what the mirror rewrites, what the stubbed
 * Worker answers, and which acceptance box each scenario drives.
 *
 * Nothing here touches a document or a network. That is what lets
 * dev/demo.test.mjs load these real bytes under Node and assert the
 * answers, the same way every other suite in this folder loads the file
 * it checks - and it is why the browser half (dev/demo-boot.js) is a
 * separate file that does nothing but wiring.
 *
 * A classic script rather than a module, because dev/demo-boot.js has to
 * run before the page's own scripts and a module would be deferred until
 * after them. AGENTS.md, "The module shape means something": the
 * `(function (root) {...})(globalThis)` here is assigning a global on
 * purpose.
 */
(function (root) {
  "use strict";

  /*
   * The four destinations, by file name and by the settled label.
   *
   * Both, and that is the load-bearing part: PR 4 renames what the pages
   * say, and a demo console that addressed them only by label would drive
   * a script nobody could follow across the rename. The file name is the
   * stable handle; the label is what the owner reads on screen. #127
   * settled the labels.
   */
  const DESTINATIONS = [
    { file: "index.html", label: "Sign in" },
    { file: "your-page.html", label: "Your page" },
    { file: "charts.html", label: "Muse's charts" },
    { file: "admin.html", label: "Admin" },
  ];

  /*
   * The path the mirrored pages are served under, and its one home.
   *
   * dev/demo-server.mjs serves this path and dev/demo-console.js drives
   * it, so the two have to agree and dev/demo.test.mjs holds them to
   * each other. Do not give either side a spelling of its own: the
   * console decides WHICH PAGE THE FRAME IS ON from this prefix, so a
   * console reading one path while the server serves another reports
   * every page as outside the demo - and the symptom is an address
   * readout refusing a page that is plainly on screen.
   */
  const MIRROR_PATH = "/demo/";

  /*
   * The page the demo opens on, and the page a reset lands back on.
   *
   * It is a file name rather than a path so that both users of it can
   * put their own prefix in front: the toolbar asks for MIRROR_PATH +
   * this, and the baked build's root page redirects to the same address.
   * Naming the sign-in page here rather than in either of them is what
   * keeps "a demo starts where a stranger starts" one fact.
   */
  const FIRST_VISIT = "index.html";

  /*
   * The names the demo writes into the browser's own storage, and their
   * one home.
   *
   * They are here rather than beside the code that writes them because
   * dev/demo.test.mjs scans apps/web for them: a shipped page keyed on
   * `hgb-demo-who` would read the staged identity and change its
   * behavior under the demo, which is exactly the hook apps/web is
   * forbidden to carry - and a hook like that names none of the demo's
   * file or symbol names, so the scan for those cannot see it. One list,
   * read by the scan and destructured by both writers, is what keeps the
   * scan looking for the names actually written.
   *
   * The shipped keys `hgb-session` and `hgb-submit-prefill` are NOT here.
   * Those belong to the product, apps/web is supposed to name them, and
   * putting them in this list would fail the scan on the shipped code
   * doing its job.
   */
  const STORAGE_KEYS = ["hgb-demo-who", "hgb-demo-data", "hgb-demo-world"];

  /* ---------------------------------------------------------------- */
  /* The mirror: the only bytes the demo changes, and why.             */
  /* ---------------------------------------------------------------- */

  /*
   * apps/web is what the published site is made of - `./run build`
   * writes dist/, which is these files with the comments stripped out of
   * the CSS and the scripts and nothing else changed, and dist/ is what
   * deploys (#181). So apps/web holds no test hook, no fixture and no
   * development-only global, and this demo adds none: a hook here would
   * be a hook in the published bytes, the stripping notwithstanding.
   * What the demo does instead is serve a MIRROR of the apps/web files,
   * read off disk on every request, with the edits below applied on the
   * way out.
   *
   * That distinction is the whole design. The prohibition in
   * dev/README.md is on hooks in the shipped bytes; the reason for the
   * prohibition is that a code path loading fake data into a live page is
   * not something to publish. A dev-side wrapper cannot be published at
   * all - `dev/` is never copied - so it keeps the shipped bytes clean
   * instead of spending them.
   *
   * It also means the demo cannot snapshot: the bytes come from
   * apps/web at request time, so a page PR 4 or PR 5 changes is a page
   * the demo shows changed, with no work here.
   *
   * Every edit is listed here rather than applied inline, because a demo
   * that quietly differs from the product is worse than no demo. This
   * table is the whole record of how a demo page differs from the
   * product, and dev/demo.test.mjs asserts that a mirrored page differs
   * from the shipped one in exactly these ways and no others - including
   * that every entry here really fires on some page, so an edit that has
   * stopped applying to anything cannot sit here reading as coverage.
   */
  const MIRROR_EDITS = [
    {
      id: "boot",
      what: "Adds two dev scripts ahead of the page's own.",
      why: "They replace fetch() before any shipped script can call it, " +
        "so no request in this demo reaches a real endpoint. They load " +
        "from /dev/, which the page's own script-src 'self' already " +
        "allows - the demo runs under the same policy the site ships.",
    },
    {
      id: "toolbar",
      what: "Adds the demo's own strip - a stylesheet and a script - " +
        "above the page.",
      why: "The demo IS the site now, so there is no console beside it " +
        "to hold the controls a visitor cannot produce for themselves: " +
        "resetting the tab, signing in as somebody else, filling the " +
        "key box, staging a published snapshot, moving the clock. They " +
        "ride on the page instead, from /dev/, which the page's own " +
        "script-src and style-src 'self' already allow. Nothing here " +
        "reads or changes the product's own markup - the strip is " +
        "appended and the page underneath is the shipped bytes.",
    },
    {
      id: "telegram",
      what: "Points the Telegram widget's script at a local stand-in.",
      why: "The real widget is a third-party script from telegram.org " +
        "and is bound to the published domain, so on 127.0.0.1 it " +
        "reaches the network and then renders nothing. The stand-in " +
        "draws a button and calls the page's own data-onauth, which is " +
        "the one thing the widget contributes.",
    },
    {
      id: "config",
      what: "Points config.js at a stand-in naming an address that " +
        "cannot resolve.",
      why: "config.js chooses by location.hostname and knows two: the " +
        "published site and localhost. Anywhere else it hands back no " +
        "endpoint and a null key, which closes the page guards - and " +
        "makes config.endpoint + \"/me\" the relative URL " +
        "\"undefined/me\", aimed at whatever host is serving. The " +
        "stand-in seals to the same throwaway development key and " +
        "points at a reserved name that resolves nowhere, so the one " +
        "case that reaches the network is the case where this demo " +
        "already failed.",
    },
  ];

  const BOOT_SCRIPTS =
    '<script src="/dev/demo-stub.js"></script>' +
    '<script src="/dev/demo-boot.js"></script>';

  /*
   * The strip, inserted at the same seam and declared as its own edit.
   *
   * A SEPARATE EDIT FROM THE BOOT PAIR BECAUSE THE REASONS ARE
   * SEPARATE. The boot pair exists so no request leaves the machine;
   * this exists so the owner can stage what a visitor cannot. Folding
   * them into one entry would leave the table saying a page carries
   * these files for a reason that is only true of two of them - and the
   * table is the whole record of how a demo page differs from the
   * product.
   *
   * The stylesheet comes first so the strip is painted at its final
   * height before the script fills it in, and the script is not
   * deferred: it appends to the body when the document is ready, and a
   * deferred module would arrive after the page's own scripts have
   * already measured a layout the strip is about to change.
   */
  const TOOLBAR_SCRIPTS =
    '<link rel="stylesheet" href="/dev/demo-toolbar.css">' +
    '<script src="/dev/demo-toolbar.js"></script>';

  const TELEGRAM_WIDGET = /https:\/\/telegram\.org\/js\/telegram-widget\.js[^"']*/g;
  const TELEGRAM_STANDIN = "/dev/demo-telegram.js";

  const CONFIG_TAG = '<script src="config.js"></script>';
  const CONFIG_STANDIN = '<script src="/dev/demo-config.js"></script>';

  /*
   * THERE IS NO ANCHOR EDIT, AND ADDING ONE WOULD BE A MISTAKE.
   *
   * Rewriting anchors that leave the product so they open their own tab
   * is a frame's problem: a frame that navigates itself to a host
   * refusing to be framed goes white with no way back. The demo is the
   * site in the whole window, so a link that leaves is a link that
   * leaves, exactly as it is on the real site. And apps/web ships no
   * off-site anchor for such an edit to act on, so declaring one puts a
   * difference on the table that applies to no page - worse than a
   * missing edit, because it reads as something somebody accounted for.
   *
   * dev/demo.test.mjs drives an anchor that leaves the product through
   * the mirror and asks for it back byte for byte, so adding the rewrite
   * is red rather than quiet.
   */

  /*
   * Inserted before the first <script>, which on every page in apps/web
   * puts it after the Content-Security-Policy meta tag. Deliberately
   * after: a script inserted above the policy would not be governed by
   * it, and the demo would stop being evidence that the shipped policy
   * permits what the pages do.
   */
  function mirror(html) {
    const applied = [];
    let out = String(html);

    const at = out.indexOf("<script");
    if (at !== -1) {
      out = out.slice(0, at) + BOOT_SCRIPTS + TOOLBAR_SCRIPTS + out.slice(at);
      applied.push("boot");
      applied.push("toolbar");
    }

    if (TELEGRAM_WIDGET.test(out)) {
      TELEGRAM_WIDGET.lastIndex = 0;
      out = out.replace(TELEGRAM_WIDGET, TELEGRAM_STANDIN);
      applied.push("telegram");
    }
    TELEGRAM_WIDGET.lastIndex = 0;

    // 404.html loads no config.js, so this edit does not apply to every
    // page and the console's table would be wrong to imply it does.
    if (out.indexOf(CONFIG_TAG) !== -1) {
      out = out.split(CONFIG_TAG).join(CONFIG_STANDIN);
      applied.push("config");
    }

    return { html: out, applied: applied };
  }

  /*
   * The inverse, and the reason it exists: dev/demo.test.mjs runs it over
   * a mirrored page and asserts the result is the shipped file byte for
   * byte. A check that only looked for the inserted script would pass on
   * a mirror that had also quietly changed a heading.
   */
  function unmirror(html) {
    return String(html)
      .replace(BOOT_SCRIPTS + TOOLBAR_SCRIPTS, "")
      .split(CONFIG_STANDIN).join(CONFIG_TAG)
      .split(TELEGRAM_STANDIN).join("https://telegram.org/js/telegram-widget.js?22");
  }

  /* ---------------------------------------------------------------- */
  /* Which routes the stub has to answer.                             */
  /* ---------------------------------------------------------------- */

  /*
   * Every call the shipped code makes to the Worker - VERB and path,
   * read out of the shipped bytes rather than listed by hand.
   *
   * This is what stops the demo going quietly wrong as PR 4 and PR 5
   * land. A slice that adds a call to a route the stub does not answer
   * would otherwise produce a demo page that fails in a way the owner
   * reads as the product being broken - or worse, one that falls through
   * to the live endpoint. dev/demo.test.mjs runs this over apps/web and
   * fails if anything it finds has no answer here.
   *
   * THE VERB IS NOT DECORATION. server/worker.js routes on method AND
   * path together; a reader that collected only paths let the stub
   * answer GET /session where the Worker 404s, so flipping signout.js's
   * DELETE to POST - a regression the live endpoint would refuse - kept
   * the suite green and the demo still showing revocation working. The
   * verb travels with the path from here to routeFor and answerFor.
   *
   * The method is taken from the fetch init that follows the call, up to
   * the end of that call - `);` - and defaults to GET, which is what
   * fetch itself does when no method is given. Bounded by the call's own
   * end rather than a line count, because these init objects are written
   * over four to six lines and a fixed window would clip the longest.
   *
   * Two idioms, because the shipped code has two. Most call sites build
   * the URL as `config.endpoint + "/path"`; auth.js holds its two routes
   * in a list and passes the chosen one in as an identifier, so that
   * call site's verb applies to every path in the list.
   */
  const CALL_SITE =
    /config\.endpoint\s*\+\s*\n?\s*(?:"(\/[^"]*)"|([A-Za-z_$][\w$]*))/g;
  const METHOD_IN_INIT = /method:\s*"([A-Za-z]+)"/;
  const AUTH_LIST = /AUTH_PATHS\s*=\s*\[([^\]]*)\]/;
  const QUOTED_PATH = /"(\/[^"]*)"/g;

  function methodAfter(text, from) {
    const end = text.indexOf(");", from);
    const window = text.slice(from, end === -1 ? from + 400 : end);
    const found = METHOD_IN_INIT.exec(window);
    return found ? found[1].toUpperCase() : "GET";
  }

  function endpointCallsIn(source) {
    const text = String(source);
    const found = [];
    const add = function (method, path) {
      const seen = found.some(function (one) {
        return one.method === method && one.path === path;
      });
      if (!seen) found.push({ method: method, path: path });
    };

    const list = AUTH_LIST.exec(text);
    const listed = [];
    if (list) {
      QUOTED_PATH.lastIndex = 0;
      let one;
      while ((one = QUOTED_PATH.exec(list[1])) !== null) listed.push(one[1]);
    }

    let match;
    CALL_SITE.lastIndex = 0;
    while ((match = CALL_SITE.exec(text)) !== null) {
      const method = methodAfter(text, match.index + match[0].length);
      if (match[1] !== undefined) {
        add(method, match[1]);
      } else {
        // An identifier rather than a literal: this is auth.js handing in
        // one of AUTH_PATHS. Every path that list holds is reachable
        // through this one call site, so they all carry its verb.
        listed.forEach(function (path) { add(method, path); });
      }
    }

    return found.sort(function (a, b) {
      return (a.path + a.method).localeCompare(b.path + b.method);
    });
  }

  /*
   * What the stub knows, with the dynamic tails collapsed and the verbs
   * spelled out. The Worker routes /submission/<id>, /content/<name> and
   * /membership/<a>/<b> by pattern, so the demo matches them the same way
   * rather than pretending the id is part of the route name.
   *
   * The method lists are server/worker.js's dispatch block, and
   * dev/demo.test.mjs reads that block and refuses any verb here the
   * Worker does not actually route - AGENTS.md's corollary that a check
   * computed entirely from the file it guards cannot detect that the
   * file was rearranged. Adding a verb here to make a demo work is
   * therefore a gate failure, not a shortcut.
   */
  const ROUTES = [
    { path: "/auth/telegram", methods: ["POST"] },
    { path: "/auth/dev", methods: ["POST"] },
    { path: "/session", methods: ["DELETE"] },
    { path: "/me", methods: ["GET"] },
    { path: "/my-entries", methods: ["GET"] },
    { path: "/submit", methods: ["POST"] },
    { path: "/export", methods: ["GET"] },
    { path: "/snapshot", methods: ["GET", "POST", "DELETE"] },
    { path: "/content", methods: ["GET", "POST"] },
    { path: "/membership", methods: ["GET", "POST"] },
  ];
  const PREFIX_ROUTES = [
    { path: "/submission/", methods: ["DELETE"] },
    { path: "/content/", methods: ["DELETE"] },
    { path: "/membership/", methods: ["DELETE"] },
  ];

  /*
   * The route a call names, or null. Null for an unknown path AND for a
   * known path with a verb it does not answer, because those are the
   * same 404 from the Worker and a demo that distinguished them would be
   * demonstrating a behavior the product does not have.
   */
  function routeFor(path, method) {
    const clean = String(path).split("?")[0];
    const verb = String(method || "GET").toUpperCase();
    for (const route of ROUTES) {
      if (route.path === clean) {
        return route.methods.indexOf(verb) === -1 ? null : route.path;
      }
    }
    for (const route of PREFIX_ROUTES) {
      if (clean.indexOf(route.path) === 0) {
        return route.methods.indexOf(verb) === -1 ? null : route.path;
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Which requests may leave, and which belong to the Worker.        */
  /* ---------------------------------------------------------------- */

  /*
   * These two decide whether the demo's one promise holds - that nothing
   * here reaches a real endpoint - so they live in the pure half where
   * dev/demo.test.mjs can drive them. In dev/demo-boot.js the only thing
   * that ever exercises them is a person looking at a page.
   *
   * COMPARE ORIGINS, NEVER SUBSTRINGS. Two URL classes defeat a text
   * comparison against the page's own origin.
   * `http://127.0.0.1:8126@evil.example/x` STARTS WITH this origin as
   * text, but everything before the `@` is userinfo and it resolves to
   * evil.example. `https:/evil.example/x` has one slash, so a test for
   * `//` reads it as relative; it resolves to evil.example too. Both
   * would be handed to the real fetch by any test spelled that way.
   * Resolving against the page's own URL and comparing `.origin` is the
   * one test that cannot be spelled around, because it asks the same
   * parser the network stack will ask.
   *
   * A URL that will not parse is refused rather than allowed. An input
   * this cannot make sense of is not evidence that it is harmless.
   */

  /*
   * `base` omitted means "this is already absolute". Passing
   * String(undefined) as a base throws even for an absolute URL, and a
   * resolver that answers null for everything makes every refusal below
   * pass for the wrong reason - which is how a check that refuses
   * nothing looks identical to one that refuses everything.
   */
  function resolved(url, base) {
    try {
      return base === undefined || base === null
        ? new URL(String(url))
        : new URL(String(url), String(base));
    } catch (error) {
      return null;
    }
  }

  function sameOriginAs(url, base) {
    const here = resolved(base, undefined);
    const there = resolved(url, base);
    if (there === null || here === null) return false;
    return there.origin === here.origin;
  }

  /*
   * The path this call is asking the Worker for, or null if it is not a
   * Worker call at all.
   *
   * The workers.dev arm is not redundant beside the configured endpoint:
   * it catches a page that reaches the endpoint by some route other than
   * the configured one. It is an origin test now for the same reason as
   * above - as a substring it accepted an endpoint-prefixed userinfo
   * trick, which would have answered from the stub a request that was
   * actually addressed to somebody else's host.
   */
  function workerPathOf(url, base, endpoint) {
    const there = resolved(url, base);
    if (there === null) return null;

    const target = endpoint ? resolved(endpoint, base) : null;
    if (target !== null && there.origin === target.origin) {
      return (there.pathname || "/") + (there.search || "");
    }

    if (/(^|\.)workers\.dev$/.test(there.hostname)) {
      return (there.pathname || "/") + (there.search || "");
    }

    return null;
  }

  /*
   * The files this demo may really fetch from the origin it is served
   * from. By path, and this list is the whole of it.
   *
   * The export rows are a committed file, so the honest way to serve
   * eighteen ciphertexts is to read them rather than carry them through
   * sessionStorage. That is one file, and it is named here rather than
   * being "anything same-origin". Widen this to an origin test and a
   * hosted build reads whatever else the bake emitted, which a static
   * host serves to anybody without asking.
   */
  const LOCAL_FILES = ["/dev/sample-submissions.json"];

  /*
   * The keyholder's half of the throwaway pair, by path.
   *
   * IT IS DELIBERATELY NOT IN LOCAL_FILES, and the difference is the
   * whole care of it. That list is what the PRODUCT may fetch for real,
   * and no shipped page fetches a key - adding one there would widen
   * what the product is permitted to read to include key material,
   * which is the opposite of what this demo exists to show. The toolbar
   * rides on the same page and has its own door, TOOLBAR_FILES below,
   * held by dev/demo-boot.js to this one path; what it does with the
   * text is write it into the page's key box exactly as a person
   * pasting it would.
   *
   * The file is committed on purpose and says so in its own first
   * field: it protects nothing, opens nothing real, and exists so the
   * suites and this demo can perform a decrypt at all. The key the
   * portal actually uses is held offline and has never been in this
   * repository. dev/demo-bake.mjs already emits this file by name, so a
   * hosted build performs the same act rather than dead-ending where
   * the local one works.
   */
  const DEV_KEY_FILE = "/dev/test-key.json";

  /*
   * The only paths the toolbar may read for real, and its door is not
   * the product's.
   *
   * Two allowlists rather than one widened list. LOCAL_FILES says what
   * a SHIPPED page may fetch, and the day a key file joins it is the
   * day the product is permitted to read key material off its own host.
   * This says what the DEMO's own strip may fetch, and it is checked by
   * dev/demo-boot.js on a call the product has no name for.
   */
  const TOOLBAR_FILES = [DEV_KEY_FILE];

  /*
   * What the toolbar says the moment it puts that key in the page's box.
   *
   * THE DISCLOSURE HAS TO TRAVEL WITH THE ACT. A private key appearing
   * in a box, in front of the person deciding whether to trust this
   * design, teaches the wrong lesson unless the same moment says what
   * kind of key it is. Carried by the control that performs the act
   * rather than by any surface describing it, so a later surface that
   * forgets to mention keys cannot separate the two.
   */
  const KEY_STAGED_LINE =
    "The demo put its own key in the page's key box. It is a throwaway " +
    "pair committed in this repository - it protects nothing and opens " +
    "nothing real, and the key the gang uses is held offline and has " +
    "never been here.";

  /*
   * What a request IS: a call the stub answers, a file in this build the
   * browser may fetch for real, or a refusal.
   *
   * SAME ORIGIN IS DECIDED FIRST, AND NEVER AS A WORKER CALL. This
   * ordering is the fix for a collision that cannot happen on
   * 127.0.0.1 and is guaranteed on the address this demo is hosted at.
   * workerPathOf treats any host ending `.workers.dev` as the Worker -
   * right, because it catches a page reaching the endpoint by some
   * route other than the configured one. Serve the build from a
   * workers.dev URL and that arm matches the PAGE'S OWN origin, so
   * every same-origin request is read as a call to the Worker and
   * answered 404 by a stub that was never asked about files. The demo
   * does not leak; it stops working, and the symptom is a product page
   * failing to load its own data, which reads as the product being
   * broken rather than as the demo being wrong.
   *
   * Ordered rather than keyed on the hosting domain, because a fix that
   * names the host stops working the day the owner moves the build -
   * and because same-origin is the narrower claim in every case, so
   * deciding it first is correct everywhere rather than merely
   * sufficient here.
   *
   * A refusal carries the URL. A demo that quietly declined to fetch
   * something would be debugged as a broken page.
   */
  function requestKindOf(url, base, endpoint) {
    const there = resolved(url, base);
    if (there === null) {
      return {
        kind: "refuse",
        why: "The demo could not make sense of the URL \"" + url +
          "\", so it refused it. An input it cannot parse is not " +
          "evidence that the input is harmless.",
      };
    }

    if (sameOriginAs(url, base)) {
      const path = there.pathname || "/";
      if (LOCAL_FILES.indexOf(path) !== -1) {
        return { kind: "file", path: path };
      }
      return {
        kind: "refuse",
        why: "The demo refused a request for " + path + ". It reads " +
          "only the files it names, and that is not one of them.",
      };
    }

    const path = workerPathOf(url, base, endpoint);
    if (path !== null) return { kind: "worker", path: path };

    /*
     * Anything else is a third party, and this is where the demo's one
     * promise is kept: it does not reach a real endpoint. Refused
     * loudly rather than passed through, because a demo that quietly
     * phoned home would be indistinguishable from one that did not
     * until somebody read a packet capture.
     */
    return {
      kind: "refuse",
      why: "The demo refused a request to " + url + ". Nothing here " +
        "reaches a real endpoint.",
    };
  }

  /*
   * The toolbar's own door, decided the same way and separately.
   *
   * SAME ORIGIN IS NOT THE TEST HERE EITHER. The toolbar reads one
   * committed file and the list above is the whole of it, so the answer
   * is a path match rather than an origin match - which is what keeps a
   * hosted build from turning this door into a read of whatever else
   * the bake emitted.
   *
   * It is a second function rather than a flag on requestKindOf so that
   * neither list can widen the other by accident: what a shipped page
   * may fetch and what the demo's strip may fetch are two questions,
   * and a shared code path is one place for them to become one answer.
   */
  function toolbarFileKind(path) {
    const asked = String(path === undefined || path === null ? "" : path);
    if (TOOLBAR_FILES.indexOf(asked) !== -1) {
      return { kind: "file", path: asked };
    }
    return {
      kind: "refuse",
      why: "The demo's toolbar refused to read " + asked + ". It reads " +
        "only the files it names, and that is not one of them.",
    };
  }

  /* ---------------------------------------------------------------- */
  /* Who the demo can be.                                             */
  /* ---------------------------------------------------------------- */

  /*
   * An account id is a 64-character HMAC in the real system. These are
   * the right shape and mean nothing: they are typed-out hex, derived
   * from no secret, and they open nothing. The shape matters because
   * submit.js scopes the device-local prefill by this string and
   * DESIGN.md's rule is that the id is opaque - a demo id that looked
   * like a name would demonstrate the wrong design.
   */
  function accountIdFor(handle) {
    let out = "";
    let state = 0x811c9dc5;
    for (let round = 0; out.length < 64; round += 1) {
      const text = String(handle) + ":" + round;
      for (let i = 0; i < text.length; i += 1) {
        state = (state ^ text.charCodeAt(i)) >>> 0;
        state = (state * 0x01000193) >>> 0;
      }
      out += ("00000000" + state.toString(16)).slice(-8);
    }
    return out.slice(0, 64);
  }

  const MEMBER_ACCOUNT = accountIdFor("demo_member");
  const ADMIN_ACCOUNT = accountIdFor("demo_keyholder");

  /* ---------------------------------------------------------------- */
  /* The membership table, as a world (#69).                          */

  /*
   * A table rather than a fixed answer, because the admin page's
   * membership pane makes claims about the SECOND read.
   *
   * The pane never keeps a local model: every write is followed by a
   * fresh GET and the pane redraws from the answer. A stub that answered
   * the same document forever would make that unfalsifiable - the screen
   * would look identical whether or not the page ever asked again - and
   * it would make the two refusals that matter undrivable, which is the
   * demo showing a surface working in the one shape where it cannot go
   * wrong.
   */
  const MEMBERSHIP_ROLES = ["admin", "always_allow"];
  const ACCOUNT_ID = /^[0-9a-f]{64}$/;
  const TELEGRAM_ID = /^[0-9]{1,20}$/;
  const MAX_LABEL = 64;

  /* server/worker.js's grantsAnything(), which is what makes the two
   * lists GET returns disagree about nothing: the same predicate decides
   * what is drawn and what actually grants. */
  function grantsAnything(row) {
    return Boolean(row) && typeof row.account_id === "string" &&
      ACCOUNT_ID.test(row.account_id);
  }

  /*
   * What the table holds before anybody touches it.
   *
   * Two admins rather than one, so a removal succeeds; and the last one
   * then cannot come off, which is the guard #69 asked for and the only
   * way to see it is to be holding the last row. The fourth entry is
   * sixty-four correct characters in the WRONG CASE - what `wrangler d1
   * execute` writes without complaint, what the authority read drops,
   * and what GET reports in `malformed`. It is seeded rather than left
   * to be typed because nothing reachable from a browser can create one.
   */
  const MEMBERSHIP_SEED = [
    {
      account_id: ADMIN_ACCOUNT,
      role: "admin",
      label: "The owner",
      added_at: "2026-08-01T09:00:00.000Z",
    },
    {
      account_id: accountIdFor("demo_second_admin"),
      role: "admin",
      label: "Second keyholder",
      added_at: "2026-08-03T14:20:00.000Z",
    },
    {
      account_id: accountIdFor("demo_break_glass"),
      role: "always_allow",
      label: "Break-glass phone",
      added_at: "2026-08-02T11:00:00.000Z",
    },
    {
      account_id: accountIdFor("demo_pasted_by_hand").toUpperCase(),
      role: "admin",
      label: "Pasted into the D1 console",
      added_at: "2026-08-05T16:45:00.000Z",
    },
  ];

  /*
   * An admin ADMIN_TELEGRAM_IDS grants that no row covers - so the
   * demo's `secretOnly` is non-empty until somebody backfills it, which
   * is the state the flip's go-signal is read against. It is computed
   * from the GRANTING rows only, as the Worker computes it: counting a
   * dud would report a backfill complete while the flip it authorizes
   * takes that admin's authority away.
   */
  const MEMBERSHIP_SECRET = [accountIdFor("demo_secret_only_admin")];

  function membershipRows(state) {
    return Array.isArray(state.membership)
      ? state.membership
      : MEMBERSHIP_SEED;
  }

  /*
   * The numeric Telegram ids the sign-in picker offers, one per identity
   * below. They are made-up numbers of the right length and belong to
   * nobody; #58's line paints from whichever one signs in, so the id has
   * to travel the whole way from the picker's press to that line.
   *
   * The opposite case - a development session, whose id is null, where
   * the line correctly stays hidden - is not staged here. POST /auth/dev
   * answers null by construction, so proving it needs the real route.
   */
  const MEMBER_TELEGRAM_ID = "6204915773";

  /*
   * WHO THE DEMO CAN SIGN IN AS, AND WHY THEY ARE THREE PEOPLE RATHER
   * THAN THREE COSTUMES ON ONE.
   *
   * The product has one authority flag, and a picker offering "member",
   * "keyholder" and "admin" over a single account would be three labels
   * for two sessions - a demo teaching a distinction the product does
   * not make. So each row is a DIFFERENT account, and the difference
   * each one demonstrates is a difference the deployment really has:
   *
   *  - the member holds no authority at all, so every admin surface
   *    refuses them;
   *  - the keyholder is the account MEMBERSHIP_SEED labels as the
   *    owner, and is the one whose private half opens the sample rows;
   *  - the second admin is the seed's other granting row, which is what
   *    makes the last-admin guard drivable from both sides: with two
   *    admins in the table a removal succeeds, and the survivor cannot
   *    then be removed.
   *
   * `lands` is where a shortcut press opens, and it is the page that
   * identity is FOR rather than the page they are allowed on - every
   * page stays reachable by the product's own rail in every row, which
   * is half of what there is to look at.
   *
   * `staged` marks the rows that exist because the corpus needed a
   * second, third and fourth person: signing in as one of them is how a
   * driver sees the site as somebody who is not the owner and not the
   * account every other press uses.
   */
  const SIGN_INS = [
    {
      id: "member",
      label: "Member",
      what: "No authority. Every admin surface refuses them.",
      handle: "demo_member",
      telegramId: MEMBER_TELEGRAM_ID,
      isAdmin: false,
      lands: "your-page.html",
    },
    {
      id: "keyholder",
      label: "Keyholder",
      what: "Admin authority, and the account the seeded membership " +
        "table calls the owner.",
      handle: "demo_keyholder",
      telegramId: "5417720084",
      isAdmin: true,
      lands: "admin.html",
    },
    {
      id: "admin",
      label: "Second admin",
      what: "The table's other granting row, so a removal can succeed " +
        "before the last one refuses.",
      handle: "demo_second_admin",
      telegramId: "7731064920",
      isAdmin: true,
      lands: "admin.html",
    },
    {
      id: "birch_lane",
      label: "birch_lane",
      what: "A submitter from the staged corpus.",
      handle: "birch_lane",
      telegramId: "8042117365",
      isAdmin: false,
      staged: true,
      lands: "your-page.html",
    },
    {
      id: "quiet_orbit",
      label: "quiet_orbit",
      what: "Another one, so the picker is not a list of one stranger.",
      handle: "quiet_orbit",
      telegramId: "5560428817",
      isAdmin: false,
      staged: true,
      lands: "your-page.html",
    },
  ];

  function signInFor(id) {
    for (const one of SIGN_INS) {
      if (one.id === id) return one;
    }
    return null;
  }

  /*
   * The identity a sign-in payload names, or null.
   *
   * READ FROM THE POSTED BODY RATHER THAN FROM WHAT THE PICKER
   * REMEMBERS, because the picker is not the only door: the shortcut
   * buttons write a session directly, and the product's own sign-in
   * route is the path a driver watches. A stub that answered from its
   * own memory would hand back the last identity anybody chose no
   * matter what the page posted, which is a sign-in that cannot fail.
   *
   * An id nobody staged is not refused. Anybody with a Telegram account
   * may sign in to this product as an ordinary member, and answering a
   * stranger with a member session is what the Worker does - authority
   * comes from the membership table, which no unknown id is in.
   */
  function signInForTelegramId(id) {
    const wanted = String(id === undefined || id === null ? "" : id);
    for (const one of SIGN_INS) {
      if (one.telegramId === wanted) return one;
    }
    return null;
  }

  /*
   * A session of the shape apps/web/session.js accepts and nothing
   * looser - a demo session the shipped normalizer would reject is a
   * demo of the rejection.
   */
  function sessionFor(who, options) {
    const opts = options || {};
    return {
      ok: true,
      session: "demo-" + who.id,
      // Far enough out that a long walk-through never expires mid-demo,
      // and still a real expiry: session.js refuses a credential without
      // one, so a demo session has to be a well-formed session. The
      // admin page's own idle timer is the clock this demo moves, and
      // the toolbar moves it rather than shortening this.
      expiresAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
      username: who.handle,
      isAdmin: who.isAdmin === true,
      isDev: opts.isDev === true,
      telegramId: opts.telegramId === undefined
        ? who.telegramId : opts.telegramId,
    };
  }

  /*
   * The development sign-in's identity, kept apart from SIGN_INS.
   *
   * POST /auth/dev is a route of the product, not a person the picker
   * offers, and its whole demonstrable property is the null Telegram id
   * that keeps #58's line hidden. Putting it in the picker's list would
   * put a row there that the deployed site has no door for.
   */
  const DEV_SIGN_IN = {
    id: "dev", label: "Development", handle: "demo_dev", isAdmin: false,
    telegramId: null, lands: "your-page.html",
  };

  /* ---------------------------------------------------------------- */
  /* What the toolbar is, and what each of its controls stages.       */
  /* ---------------------------------------------------------------- */

  /*
   * The strip's own two words.
   *
   * The honesty line is a word or two by the owner's ruling and it is
   * the ONLY prose the demo puts on a product page: every other
   * sentence a driver reads on screen is the product's own. Growing it
   * into an explanation is how the console's teaching voice comes back,
   * one page down from where it was removed.
   */
  const TOOLBAR = Object.freeze({
    title: "Demo",
    honesty: "Nothing here is real.",
  });

  /*
   * WHAT MAY BE A BUTTON UP THERE, AND THE TEST THAT DECIDES IT.
   *
   * Only what a visitor could not produce for themselves (the owner's
   * ruling). Signing in is on the list because there is no Telegram
   * here to sign in with; publishing eighteen entries from six people
   * is on it because a driver would have to submit them; moving the
   * clock is on it because the alternative is waiting eight minutes.
   * Navigating between pages is NOT on it - the product's own rail does
   * that, and a demo that re-implements the rail is a demo showing its
   * own navigation working.
   *
   * `group` is the row the control sits in. `needs` is what the page has
   * to carry for the control to be able to act, so the toolbar can say
   * why a press did nothing instead of doing nothing: "key" is a page
   * with a key box, "clock" is a page running the idle timer, and no
   * `needs` is a control that works anywhere.
   */
  const ENABLERS = [
    {
      id: "reset",
      group: "state",
      label: "Reset everything",
      what: "Empties this tab and this origin - sessions, keys, the " +
        "palette, every staged snapshot - and opens the sign-in page " +
        "as a stranger would find it.",
    },
    {
      id: "sign-in",
      group: "who",
      label: "Sign in as",
      what: "Writes the chosen identity's session and opens the page " +
        "that identity is for. The sign-in page's own button offers " +
        "the same list, through the product's own sign-in route.",
    },
    {
      id: "key",
      group: "who",
      label: "Key in the box",
      needs: "key",
      what: "Puts the committed throwaway private key into this page's " +
        "own key box. Everything after that is the page's own code.",
    },
    {
      id: "snapshot",
      group: "data",
      label: "Publish",
      what: "Stages a published snapshot for the charts to draw, built " +
        "by the shipped aggregation from fabricated submissions.",
    },
    {
      id: "grow",
      group: "data",
      label: "Add entries",
      what: "Publishes the same people one round later, so the " +
        "change-since figure has something to measure.",
    },
    {
      id: "corrections",
      group: "data",
      label: "Seed corrections",
      what: "Marks some of the member's rows superseded, so the " +
        "corrections line on the member panel has a count to draw.",
    },
    {
      id: "clock",
      group: "clock",
      label: "Jump the clock",
      needs: "clock",
      what: "Moves this tab's clock forward far enough that the admin " +
        "page's own idle timer warns, then expires, in seconds rather " +
        "than in ten minutes.",
    },
  ];

  /*
   * The key box each page carries, and the committed half that opens
   * what that page is for.
   *
   * A TABLE OF ONE IS STILL A TABLE, because the question the toolbar
   * asks is "does the page I am standing on have a box", and the honest
   * answer on four of the five pages is no. Hard-coding the admin
   * page's box would make the control silently do nothing everywhere
   * else, which is the class of failure this whole demo is built to
   * refuse; the toolbar reads this and says why instead.
   *
   * The member's own key is deliberately absent. It is generated in the
   * browser and cannot be exported, so there is no box to paste one
   * into - which is the custody design being demonstrated rather than a
   * gap in this table.
   */
  const KEY_BOXES = [
    { page: "admin.html", box: "keyfile", key: DEV_KEY_FILE },
  ];

  function keyBoxFor(file) {
    for (const one of KEY_BOXES) {
      if (one.page === file) return one;
    }
    return null;
  }

  /*
   * The snapshot rows: three whole worlds, and the step between them.
   *
   * The counts are NOT written here. "Eighteen entries from six people"
   * is a fact about the corpus tables at the bottom of this file, and a
   * label carrying its own copy of that number is a label free to
   * disagree with the charts underneath it - which is the demo lying
   * with every one of its own checks green. countsFor() reads the
   * corpus; the toolbar renders what it answers.
   *
   * `rounds` is how many of each person's weigh-ins the snapshot
   * carries, and `null` means all of them. It is what "Add entries"
   * advances, so the presets and the incremental button are one
   * mechanism rather than two.
   */
  const PRESETS = [
    {
      id: "full",
      corpus: "rich",
      rounds: null,
      label: "Full group",
      what: "Everybody, every round. Over the floor the published " +
        "series needs, so the charts draw.",
    },
    {
      id: "thin",
      corpus: "sparse",
      rounds: null,
      label: "Thin week",
      what: "Under that floor on purpose, so the suppression is the " +
        "thing on screen.",
    },
    {
      id: "empty",
      corpus: null,
      rounds: 0,
      label: "Empty",
      what: "Nothing published at all, which is what a binder looks " +
        "like before anybody presses Publish.",
    },
  ];

  function presetFor(id) {
    for (const one of PRESETS) {
      if (one.id === id) return one;
    }
    return null;
  }

  /*
   * WHAT RESET TAKES, AND WHY IT IS EVERYTHING IT IS HANDED.
   *
   * The owner's word for this button is EVERYTHING: the tab has to read
   * like a stranger's first arrival, which means the session, the
   * palette a driver chose three presses ago, the entry prefill, the
   * key databases both pages keep, and every world this demo staged.
   * The temptation is to clear the demo's own three keys and call it
   * reset - and that leaves a signed-in tab in the chosen palette with
   * a key still in the browser, which looks reset and is not.
   *
   * So this takes an INVENTORY of what the browser is actually holding
   * and hands all of it back. It names nothing itself: the product's
   * storage keys and its database names belong to apps/web, and a copy
   * of them here would be a second home for a fact that moves. The
   * browser half enumerates - `Object.keys` on both stores and
   * `indexedDB.databases()` - and this decides, so dev/demo.test.mjs
   * can hold the decision to sparing nothing.
   */
  function resetPlan(inventory) {
    const held = inventory || {};
    const all = (list) => (Array.isArray(list) ? list.slice() : []);
    return {
      session: all(held.session),
      local: all(held.local),
      databases: all(held.databases),
      open: MIRROR_PATH + FIRST_VISIT,
    };
  }

  /*
   * How far the toolbar moves this tab's clock, given the window the
   * page it is standing on actually measures.
   *
   * THE BOUNDS ARE AN ARGUMENT, AND THAT IS THE WHOLE HONESTY OF IT.
   * Ten minutes and two are apps/web/admin.js's numbers, and the
   * browser half reads them off `BinderAdmin.IDLE_WINDOW` at press
   * time. Written here instead, this file would carry a second copy of
   * a constant that page is free to change - and the demo would jump to
   * a warning the page is no longer showing, in front of the person
   * deciding whether the timer is right.
   *
   * A second past the boundary rather than exactly on it: the page
   * reads its own clock on a one-second tick, so landing on the edge is
   * a jump whose outcome depends on which side of a tick it arrives.
   *
   * Null for bounds it cannot read, so the caller says "this page runs
   * no idle timer" rather than moving a clock by a made-up amount.
   */
  function clockJumpFor(step, bounds) {
    const window = bounds || {};
    if (!Number.isFinite(window.idleMs) || !Number.isFinite(window.warnMs)) {
      return null;
    }
    if (step === "warning") return window.idleMs - window.warnMs + 1000;
    if (step === "expiry") return window.idleMs + 1000;
    return null;
  }

  const CLOCK_STEPS = [
    { id: "warning", label: "to the warning" },
    { id: "expiry", label: "past it" },
  ];

  /* ---------------------------------------------------------------- */
  /* Which page of the product this is.                                */
  /* ---------------------------------------------------------------- */

  /*
   * What the toolbar is standing on, given the address the browser
   * reports.
   *
   * THE ADDRESS IS READ, NEVER REMEMBERED. The toolbar rides on the
   * product's own pages and the product moves itself: an
   * already-signed-in visitor at Sign in is redirected to Your page, a
   * revoked session bounces back to Sign in on load, an auth guard
   * refuses a gated page, and the rail carries somebody anywhere at any
   * time. A strip that decided where it was from the last press it
   * handled would offer the key box on a page that has none.
   *
   * Pure so dev/demo.test.mjs can assert it: the hazard is a control
   * that acts on the wrong page, and the browser half only reads
   * location and hands the string over.
   *
   * `inside` and `file` are two facts, not one. 404.html is a real page
   * of the product, reachable and named by no destination, so a page
   * can be inside the demo and still be none of the four.
   */
  const AWAY =
    "This is not one of the demo's pages.";

  function pageAddressOf(href) {
    const away = { shown: AWAY, file: null, inside: false };
    if (typeof href !== "string" || href === "") return away;

    const there = resolved(href, undefined);
    if (there === null) return away;

    const path = there.pathname || "/";
    if (path.indexOf(MIRROR_PATH) !== 0) {
      return { shown: href, file: null, inside: false };
    }

    return {
      shown: href,
      file: destinationUnder(path.slice(MIRROR_PATH.length), DESTINATIONS),
      inside: true,
    };
  }

  /*
   * The destination a served path names, allowing for the host having
   * tidied the name on the way out.
   *
   * THE EXTENSION IS THE HOST'S TO DROP. The baked demo sits behind an
   * ordinary static host, and the common ones serve `your-page.html` by
   * redirecting to `your-page` - "clean URLs", on by default and not
   * something the bake can turn off. Matching the file name exactly read
   * that as a page the demo does not have, and then everything keyed on
   * the answer went quiet AT ONCE and WITHOUT SAYING SO: no rail button
   * current, and every stop's errand dropped, because an errand waits
   * for the page it was meant for and that page never appeared to
   * arrive. The tab press and the keyholder's key box died together on
   * the deployed demo while every arm passed here, because the arms all
   * arrived the tidy way.
   *
   * AND THE THIRD TIDYING TAKES THE NAME AWAY ALTOGETHER. The same hosts
   * serve a directory's index page at the directory itself, so
   * `/demo/index.html` answers 308 to `/demo/` and what the frame
   * reports has no file in it at all. That is the tidying that fires on
   * the SIGN-IN page, which two of the four journeys open on - so the
   * silent class above came back on the deployed build for half the
   * journeys while every arm here passed, because all of them probe a
   * name and this case has none.
   *
   * A tidied name that matches nothing is still no destination. Widening
   * a match is one step from inventing a page, and 404.html is the case
   * that keeps it honest: a real page of the product, reachable in the
   * frame, and none of the four rail buttons is its.
   */

  /*
   * What a static host serves for a bare directory. It is the HOST's
   * convention rather than this list's, which is why it is named here
   * and not marked on a destination: the demo does not get to decide
   * what /demo/ resolves to, it only has to recognize the answer.
   */
  const DIRECTORY_INDEX = "index.html";

  /*
   * The demo's own server serves it too, so that the local arm and a
   * static host answer a bare directory the same way - the tidying this
   * function exists to recognize is one a driver should be able to
   * reproduce without deploying anything.
   */

  /*
   * THE DESTINATIONS ARE AN ARGUMENT, AND THAT IS WHAT MAKES THE ROOT'S
   * FOLD A CHECKED BRANCH RATHER THAN A DESCRIBED ONE.
   *
   * The root goes back through this same lookup rather than returning
   * the directory index outright, so a directory index that is not one
   * of the destinations resolves to nothing - the strictness below,
   * kept: recovering from one bad guess is how a console starts making
   * them. `index.html` IS one of the four, so the fold and a bare
   * `return DIRECTORY_INDEX` agree on every address that can be built
   * out of this file's own list, and substituting one for the other left
   * dev/demo.test.mjs green at its full count with the strictness gone.
   * A branch nothing can falsify is a branch nobody is holding.
   *
   * Reading the list from a parameter is what makes the question
   * askable: given destinations the directory index is not among, does
   * the root still resolve to nothing? Do not close this back over
   * DESTINATIONS for tidiness - the closure is the unfalsifiable
   * version, and the one caller passes the same list either way.
   */
  function destinationUnder(served, among) {
    const name = served.endsWith("/") ? served.slice(0, -1) : served;

    if (name === "") return destinationUnder(DIRECTORY_INDEX, among);

    for (const one of among) {
      if (one.file === name) return one.file;
      if (one.file === name + ".html") return one.file;
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* The stubbed Worker.                                              */
  /* ---------------------------------------------------------------- */

  const REFUSED = {
    status: 401,
    body: { error: "This session is no longer valid." },
  };

  /*
   * One answer, as the shipped pages expect to read it.
   *
   * Pure on purpose: it takes the world and returns the answer plus the
   * world that follows, so dev/demo.test.mjs can drive a whole sequence -
   * publish, then read back - with no browser and no server. The browser
   * half stores what comes back and does nothing else.
   *
   * `proxy` is a same-origin path the caller should fetch for real. The
   * export rows are a committed file in this repository, so handing back
   * a path beats copying eighteen ciphertexts through sessionStorage.
   */
  function answerFor(request, world) {
    const method = String(request.method || "GET").toUpperCase();
    const route = routeFor(request.path, method);
    const state = world || {};
    const data = state.data || {};
    const next = Object.assign({}, state);

    /*
     * A staged id that names nobody refuses, loudly, naming the id.
     *
     * Falling through to a generic member would answer with a plausible
     * screen built from a world nobody staged, which is the exact
     * failure this file's own suite header calls the way demos fail.
     * The state that produces it is ordinary rather than exotic - an
     * identity renamed while a tab still holds the old id in
     * sessionStorage.
     *
     * An absent id is not an error. A first arrival is signed out, and
     * dev/demo.test.mjs drives routing with no world at all.
     */
    if (state.signedInAs !== undefined && state.signedInAs !== null &&
        String(state.signedInAs) !== "" &&
        signInFor(state.signedInAs) === null) {
      return {
        status: 500,
        body: {
          error: "The demo has nobody called \"" + state.signedInAs +
            "\". Press Reset everything and sign in again.",
        },
        next: next,
      };
    }

    const who = signInFor(state.signedInAs);

    if (route === null) {
      return {
        status: 404,
        body: {
          error: "The demo has no answer for " + method + " " +
            request.path + ".",
        },
        next: next,
      };
    }

    // Every gated route refuses once the row is gone, because that is
    // what revocation is: the token is still well formed and names
    // nothing. Pressing the product's own Sign out is what sets it,
    // below, which is what makes #90 drivable rather than described -
    // and it is deliberately not a toolbar button, because a visitor
    // can produce it themselves.
    //
    // Two exemptions, and both are routes that take no credential at
    // all. READING site copy is the first, and it is the read alone:
    // handleReadContent takes none, and every write on that path is an
    // admin session like all the others, so exempting the whole path
    // would demonstrate an unauthenticated write the Worker refuses.
    // SIGNING IN is the second, and leaving it out made Sign out a
    // one-way door: the tab that had just revoked itself could never
    // sign in again, which is a dead end reached by pressing the one
    // control this demo most wants driven.
    if (state.revoked === true) {
      const noCredential = (route === "/content" && method === "GET") ||
        route === "/auth/telegram" || route === "/auth/dev";
      if (!noCredential) {
        return { status: REFUSED.status, body: REFUSED.body, next: next };
      }
    }

    /*
     * The sign-in routes, answered from what the page POSTED.
     *
     * The demo's picker chooses an identity and hands the page a widget
     * payload; auth.js posts it; this reads the id back out. That order
     * is the whole reason the picker is worth having - the session a
     * driver ends up holding is one the product's own sign-in produced,
     * not one the demo wrote into storage behind it.
     *
     * The development route answers a null Telegram id by construction,
     * which is what keeps #58's line correctly hidden on that arm.
     */
    if (route === "/auth/telegram" || route === "/auth/dev") {
      const posted = route === "/auth/dev"
        ? null : signInForTelegramId((request.body || {}).id);
      const chosen = route === "/auth/dev" ? DEV_SIGN_IN
        : (posted || signInFor("member"));
      const session = route === "/auth/dev"
        ? sessionFor(DEV_SIGN_IN, { telegramId: null, isDev: true })
        : sessionFor(chosen, {
          telegramId: String((request.body || {}).id || chosen.telegramId),
        });
      next.session = session;
      next.signedInAs = chosen.id;
      // A sign-in is a live credential again, whatever the last one did.
      next.revoked = false;
      return { status: 200, body: session, next: next };
    }

    if (route === "/session") {
      // Signing out deletes the row, and what that costs a captured
      // token is the next request on any gated route.
      next.revoked = true;
      return { status: 200, body: { ok: true }, next: next };
    }

    if (route === "/me") {
      return { status: 200, body: meFor(who, state), next: next };
    }

    /*
     * The listing carries ciphertext, and the demo's is deliberately
     * unopenable: these are placeholder bytes, not rows sealed to
     * anybody's key. That is the honest demonstration rather than a
     * shortcut - a member on a device with no key of its own sees
     * exactly this, every row listed and named as sealed elsewhere,
     * which is the state the re-seal procedure exists for. Sealing
     * demo rows to a demo key would instead demonstrate a key custody
     * story the driver never walked.
     */
    if (route === "/my-entries") {
      /*
       * The rows and the counts on /me are one model, not two.
       *
       * A tombstone is a row that is still stored: the corrections seed
       * makes /me report two of them, so this listing has to carry two
       * more rows than the effective count and mark exactly those. A
       * listing that answered the effective count would let the panel
       * and the history disagree about how many times this member has
       * written, with nothing to say which one is right.
       */
      const mine = meFor(who, state);
      const rows = mine.entries + mine.superseded;
      return {
        status: 200,
        body: {
          ok: true,
          entries: Array.from({ length: rows }, function (_, i) {
            return {
              id: 100 + i,
              receivedAt: new Date(Date.UTC(2026, 6, 1 + i)).toISOString(),
              superseded: i < mine.superseded,
              ciphertext: "AmRlbW8tcm93LW5vdC1zZWFsZWQtdG8tYW55LWtleQ==",
            };
          }),
        },
        next: next,
      };
    }

    if (route === "/submit") {
      return {
        status: 200,
        body: { ok: true, id: (state.nextId || 900) },
        next: Object.assign(next, { nextId: (state.nextId || 900) + 1 }),
      };
    }

    if (route === "/export") {
      return {
        status: 200,
        proxy: "/dev/sample-submissions.json",
        next: next,
      };
    }

    if (route === "/snapshot") {
      if (method === "POST") {
        next.published = request.body;
        next.publishedAt = new Date().toISOString();
        return { status: 200, body: { ok: true }, next: next };
      }
      if (method === "DELETE") {
        next.published = null;
        return { status: 200, body: { ok: true }, next: next };
      }
      /*
       * A TAKEDOWN IS NOT THE SAME WORLD AS ONE NOBODY HAS PUBLISHED IN.
       *
       * Written as an `undefined` test rather than as `state.published
       * || <the staged corpus>`, because `||` reads the null a DELETE
       * writes as "nothing staged yet": the press answers 200, the
       * world honestly reports `published: null`, and the very next
       * read hands back the same entries from the same people.
       * Unpublish is then indistinguishable from never having pressed
       * it, which is the one thing UAT A10.1 exists to accept.
       *
       * `undefined` is never-touched and `null` is taken-down, and the
       * two survive the trip through this demo's sessionStorage because
       * JSON keeps a null and drops an undefined. The toolbar's Publish
       * row writes the staged document into `data` and leaves
       * `published` alone, so a snapshot preset and a takedown stay two
       * different facts about the same world.
       */
      const published = state.published === undefined
        ? data.staged
        : state.published;
      /*
       * And the refusal is the WORKER's, word for word. server/worker.js
       * deletes the row and then finds no row, so the live product
       * cannot tell these two apart either - a stub with a sentence of
       * its own here would be demonstrating a Worker that does not
       * exist, which is how a demo lies while every one of its own
       * checks passes.
       */
      if (!published) {
        return {
          status: 404,
          body: { error: "No snapshot published yet." },
          next: next,
        };
      }
      /*
       * The published snapshot arrives from the demo's own
       * sessionStorage, and anything in a browser's storage can be
       * edited by whoever is sitting at it. An uncaught SyntaxError here
       * escapes the replaced fetch as an unhandled rejection: the page
       * stops, with nothing on screen saying the demo's own storage is
       * what broke rather than the product.
       */
      let snapshot = published;
      if (typeof published === "string") {
        try {
          snapshot = JSON.parse(published);
        } catch (error) {
          return {
            status: 500,
            body: {
              error: "The published snapshot in this demo's storage " +
                "could not be read as JSON. Press Reset to stage it again.",
            },
            next: next,
          };
        }
      }

      return {
        status: 200,
        body: {
          ok: true,
          published_at: state.publishedAt || new Date().toISOString(),
          snapshot: snapshot,
        },
        next: next,
      };
    }

    if (route === "/content") {
      if (method === "GET") {
        // An absent document is {} and a 200, which is what the Worker
        // answers and what the config-fallback scenario is about.
        return {
          status: 200,
          body: { ok: true, content: state.content || {} },
          next: next,
        };
      }
      const content = Object.assign({}, state.content || {});
      if (request.body && typeof request.body.name === "string") {
        content[request.body.name] = String(request.body.value || "");
      }
      next.content = content;
      return { status: 200, body: { ok: true }, next: next };
    }

    // DELETE /content/<name>, which is the only verb the Worker routes
    // on that prefix.
    if (route === "/content/") {
      const content = Object.assign({}, state.content || {});
      const name = decodeURIComponent(
        String(request.path).split("?")[0].slice("/content/".length));
      delete content[name];
      next.content = content;
      return { status: 200, body: { ok: true }, next: next };
    }

    if (route === "/membership") {
      const rows = membershipRows(state);
      if (method === "GET") {
        const granting = rows.filter(grantsAnything);
        const inTable = granting
          .filter((row) => row.role === "admin")
          .map((row) => row.account_id);
        return {
          status: 200,
          body: {
            ok: true,
            membership: granting,
            malformed: rows.filter((row) => !grantsAnything(row)),
            secretOnly: MEMBERSHIP_SECRET.filter((id) =>
              inTable.indexOf(id) === -1),
          },
          next: next,
        };
      }

      /*
       * The Worker's own three refusals, in its own order and its own
       * words. They are here rather than left to a 200 because they are
       * the only thing an operator can provoke by typing, and a demo
       * that accepted anything would be showing a pane whose error
       * handling has never run.
       */
      const sent = request.body || {};
      const telegramId = typeof sent.telegramId === "number" ||
        typeof sent.telegramId === "string" ? String(sent.telegramId) : "";
      if (!TELEGRAM_ID.test(telegramId)) {
        return {
          status: 400,
          body: { error: "A numeric Telegram id is needed." },
          next: next,
        };
      }
      if (MEMBERSHIP_ROLES.indexOf(sent.role) === -1) {
        return {
          status: 400,
          body: {
            error: "A role is one of: " + MEMBERSHIP_ROLES.join(", ") + ".",
          },
          next: next,
        };
      }
      const label = typeof sent.label === "string" ? sent.label.trim() : "";
      if (!label || label.length > MAX_LABEL) {
        return {
          status: 400,
          body: {
            error: "A label of up to " + MAX_LABEL + " characters is " +
              "needed, so the list can be read.",
          },
          next: next,
        };
      }

      // The demo hashes with accountIdFor for the same reason the Worker
      // hashes with HMAC: the numeric id goes no further than the
      // request that carried it, and nothing the demo stores can be read
      // back into a person.
      const accountId = accountIdFor(telegramId);
      const kept = rows.slice();
      const already = kept.findIndex((row) =>
        row.account_id === accountId && row.role === sent.role);
      // Re-adding relabels and leaves added_at alone, which is what
      // makes the call safe to repeat and a mistyped label fixable.
      if (already === -1) {
        kept.push({
          account_id: accountId,
          role: sent.role,
          label: label,
          added_at: new Date().toISOString(),
        });
      } else {
        kept[already] = Object.assign({}, kept[already], { label: label });
      }
      next.membership = kept;
      return { status: 200, body: { ok: true }, next: next };
    }

    if (route === "/membership/") {
      const parts = String(request.path).split("?")[0]
        .slice("/membership/".length).split("/");
      const role = decodeURIComponent(parts[0] || "");
      const wanted = decodeURIComponent(parts[1] || "").toLowerCase();
      if (MEMBERSHIP_ROLES.indexOf(role) === -1 || !ACCOUNT_ID.test(wanted)) {
        return { status: 404, body: { error: "Not found." }, next: next };
      }

      const rows = membershipRows(state);
      const survivors = rows.filter((row) =>
        !(row.role === role &&
          String(row.account_id).toLowerCase() === wanted));

      /*
       * THE LAST ADMIN ROW THAT GRANTS DOES NOT COME OFF, and what the
       * Worker counts is grants rather than rows: its subquery spells
       * grantsAnything() in SQL, so a row whose account id is not
       * sixty-four lowercase hex characters neither holds this list open
       * nor is held in it. Counting every `admin` row instead would
       * demonstrate a guard the deployment does not have, and the
       * viewer would be taught a promise the product does not keep -
       * which is the whole of what #259 found here.
       *
       * The row being removed is spared the count when it grants
       * nothing, because taking out a row cannot empty a set it was
       * never in. That arm is what keeps the staged dud pressable: the
       * seed above puts one in the table precisely so the free stop can
       * remove it, and a mirror without this arm would answer "that is
       * the last admin row" about a row that is no admin at all.
       *
       * OPERATIONS.md, "Making someone an admin", carries the same rule
       * for whoever performs the flip, and says to read it against the
       * deployment rather than against this repository.
       *
       * Deleting nothing still succeeds, as every other deletion here
       * does: an admin who cannot tell "nothing to remove" from "not
       * allowed" goes looking for a bug that is not there.
       */
      const removed = rows.filter((row) =>
        row.role === role &&
        String(row.account_id).toLowerCase() === wanted)[0];
      if (role === "admin" && removed !== undefined &&
          grantsAnything(removed) &&
          rows.filter((row) =>
            row.role === "admin" && grantsAnything(row)).length <= 1) {
        return {
          status: 409,
          body: {
            error: "That is the last admin row. Add another admin before " +
              "removing this one.",
          },
          next: next,
        };
      }

      next.membership = survivors;
      return { status: 200, body: { ok: true }, next: next };
    }

    if (route === "/submission/") {
      return { status: 200, body: { ok: true }, next: next };
    }

    return {
      status: 404,
      body: {
        error: "The demo has no answer for " + method + " " +
          request.path + ".",
      },
      next: next,
    };
  }

  /*
   * What GET /me says about whoever is signed in.
   *
   * `entries` is the effective count and `superseded` sits beside it,
   * exactly as the Worker computes them. The two are staged as two
   * numbers because that is the only way the difference is visible: the
   * corrections seed moves the tombstone count and leaves the effective
   * count where it is, so the number the panel leads with does not
   * change and the only thing that appears on screen is the corrections
   * line beside it. Six rows written, four claimed, is what a member who
   * corrected twice sees.
   */
  function meFor(who, state) {
    const signedIn = who || signInFor("member");
    const world = state || {};
    return {
      ok: true,
      accountId: accountIdFor(signedIn.handle),
      entries: 4,
      superseded: world.corrections === true ? 2 : 0,
      lastAt: new Date(Date.now() - 36 * 3600 * 1000).toISOString(),
      isAdmin: signedIn.isAdmin === true,
      isDev: false,
    };
  }

  /* ---------------------------------------------------------------- */
  /* The corpora the snapshots are built from.                        */
  /* ---------------------------------------------------------------- */

  /*
   * Demo people, as form input rather than as records.
   *
   * The console runs these through the shipped BinderForm.buildRecord and
   * BinderAdmin.entryFor, so what the charts aggregate is what the real
   * form produces. A hand-typed record would be a second opinion about
   * what a submission looks like, free to drift from the one the form
   * writes - the same reason dev/make-sample.mjs builds its sample
   * through the shipped code instead of spelling one out.
   *
   * `rich` is six people with three submissions each. Both numbers are
   * deliberate: the published series needs at least MIN_CELL lines to be
   * published at all, and a line needs at least two points to exist, so
   * anything smaller draws a charts page with its centerpiece missing
   * and nothing to say why.
   *
   * `sparse` is three people, under the floor on purpose. It is the
   * counterpart that proves the suppression, and it has to be a
   * different corpus - one dataset cannot be both above and below a
   * floor.
   */
  const RICH_PEOPLE = [
    { handle: "demo_member", gender: "female", roles: ["gainer"],
      country: "GB", units: "imperial", weights: [186, 194, 203],
      heightFeet: 5, heightInches: 6 },
    { handle: "birch_lane", gender: "male", roles: ["feedee", "gainer"],
      country: "US", units: "imperial", weights: [241, 252, 266],
      heightFeet: 6, heightInches: 1 },
    { handle: "quiet_orbit", gender: "nonbinary", roles: ["feeder"],
      country: "CA", units: "metric", weights: [88.4, 91.2, 93.9],
      heightCm: 172 },
    { handle: "salt_marsh", gender: "female", roles: ["feedee"],
      country: "IE", units: "metric", weights: [104.5, 109.8, 116.2],
      heightCm: 165 },
    { handle: "north_pier", gender: "male", roles: ["admirer"],
      country: "AU", units: "imperial", weights: [212, 218, 221],
      heightFeet: 5, heightInches: 11 },
    { handle: "amber_reed", gender: "other", roles: ["gainer", "feedee"],
      country: "DE", units: "metric", weights: [76.8, 81.3, 87.6],
      heightCm: 158 },
  ];

  const SPARSE_PEOPLE = [
    { handle: "lone_harbor", gender: "female", roles: ["feedee"],
      country: "GB", units: "metric", weights: [98.2, 101.4],
      heightCm: 168 },
    { handle: "still_water", gender: "male", roles: ["gainer"],
      country: "US", units: "imperial", weights: [230, 238],
      heightFeet: 6, heightInches: 0 },
    { handle: "grey_ferry", gender: "nonbinary", roles: ["feeder"],
      country: "CA", units: "metric", weights: [84.1, 86.7],
      heightCm: 175 },
  ];

  const DAY = 24 * 3600 * 1000;

  /*
   * How far apart one person's submissions sit, and the step the two
   * published generations are separated by. Three weeks because the
   * chart quantizes to the day and a series bunched into one week draws
   * as a vertical smudge.
   *
   * ONE NUMBER FOR BOTH, deliberately. publishedFrom() below anchors the
   * earlier document a step back from the newest submission, so a
   * spacing that drifted from the publishing step would leave the two
   * generations either identical - no movement to draw - or separated by
   * rounds nobody submitted in.
   */
  const SPACING = 21 * DAY;

  /*
   * One person's submissions, spread backwards through time so the
   * series has somewhere to run.
   */
  function inputsFor(person) {
    return person.weights.map(function (weight, index) {
      const back = (person.weights.length - 1 - index) * SPACING;
      // Which weigh-in this is for this person, counted from their
      // first. It is what the toolbar's snapshot rows cut on, and it is
      // carried rather than recomputed from the date because two people
      // with different histories do not share a calendar.
      const round = index + 1;
      const input = {
        units: person.units,
        roles: person.roles,
        gender: person.gender,
        country: person.country,
        over18: true,
      };
      if (person.units === "imperial") {
        input.weightLb = String(weight);
        input.heightFeet = String(person.heightFeet);
        input.heightInches = String(person.heightInches);
      } else {
        input.weightKg = String(weight);
        input.heightCm = String(person.heightCm);
      }
      return {
        input: input,
        handle: person.handle,
        round: round,
        at: Date.now() - back,
      };
    });
  }

  function peopleOf(which) {
    return which === "sparse" ? SPARSE_PEOPLE : RICH_PEOPLE;
  }

  function corpusInputs(which) {
    const out = [];
    peopleOf(which).forEach(function (person) {
      inputsFor(person).forEach(function (one) { out.push(one); });
    });
    return out.sort(function (a, b) { return a.at - b.at; });
  }

  /*
   * How many weigh-ins the longest history in a corpus holds, which is
   * the ceiling "Add entries" counts up to.
   */
  function roundsIn(which) {
    return peopleOf(which).reduce(function (most, person) {
      return Math.max(most, person.weights.length);
    }, 0);
  }

  /*
   * What a snapshot row is offering, in numbers read off the corpus.
   *
   * The toolbar renders these; nothing writes "eighteen entries from
   * six people" anywhere, because a label carrying its own copy of a
   * count is a label free to disagree with the charts underneath it.
   */
  function countsFor(which, rounds) {
    if (which === null || which === undefined) {
      return { entries: 0, people: 0, rounds: 0, of: 0 };
    }
    const top = rounds === null || rounds === undefined
      ? roundsIn(which) : rounds;
    const inputs = corpusInputs(which).filter(function (one) {
      return one.round <= top;
    });
    return {
      entries: inputs.length,
      people: new Set(inputs.map(function (one) { return one.handle; })).size,
      rounds: top,
      of: roundsIn(which),
    };
  }

  /*
   * The corpus, built by the shipped code rather than beside it.
   *
   * `deps` is where BinderForm.buildRecord and BinderAdmin.entryFor
   * arrive from. Passed in rather than read off the global, because the
   * two callers reach them differently - the console loads them in a Web
   * Worker, where `document` is undefined and only the pure halves run,
   * and dev/demo.test.mjs loads them under Node the way every suite here
   * does. One function either way is what stops the demo's corpus and
   * the suite's corpus being two different things.
   */
  function entriesOf(inputs, deps) {
    return inputs.map(function (one, index) {
      const record = deps.buildRecord(one.input, one.at, one.handle);
      return deps.entryFor({
        id: index + 1,
        account_id: accountIdFor(one.handle),
        received_at: new Date(one.at).toISOString(),
      }, record);
    });
  }

  function entriesFrom(which, deps) {
    return entriesOf(corpusInputs(which), deps);
  }

  /*
   * The published document a staging serves, built as a SECOND publish.
   *
   * A first publish has nothing to measure from: movementOf() answers
   * null with no comparable predecessor, movementText() answers null on
   * that, and the charts page never appends its change-since line. A
   * journey stop promises exactly that line, so a staging seeded with a
   * first document narrates a figure the screen does not carry - and a
   * demo whose words outrun its screen is the false-confidence failure
   * dev/demo.test.mjs opens on. A binder somebody has published before
   * is also the ordinary state of the product, and the only state in
   * which that figure exists at all.
   *
   * THE PREDECESSOR IS THIS CORPUS ONE PUBLISH AGO, never a second
   * dataset: the same submissions, cut at a stated earlier date, so the
   * movement is this demo's own people moving. Both generations go
   * through `deps.snapshotOf` for the reason entriesFrom goes through
   * the shipped form - a document written out here would be a second
   * opinion about what a snapshot contains, free to drift from the one
   * apps/web/admin.js builds when the keyholder presses Publish.
   *
   * THE ANCHOR IS THE CORPUS, NOT THE CLOCK. The earlier date is one
   * spacing step back from the newest submission, and it is passed as
   * snapshotOf's third argument so the earlier document CARRIES it as
   * its own `generated` - which is the date the mover-count floor and
   * the rendered line are both measured against. Reading the clock here
   * instead would make the movement depend on when the page was opened.
   *
   * One corpusInputs() call feeds both generations: a second call would
   * time-stamp the same people milliseconds later, and the cut would
   * fall between two copies of one round.
   *
   * `rounds` is how much of the corpus this publish carries, and it is
   * what makes the toolbar's Add-entries button a real second publish
   * rather than a relabelling: the cut moves up by one, the document
   * that was current becomes the predecessor, and the change-since
   * figure is this demo's own people moving. Absent, it is the whole
   * corpus - the shape the snapshot presets ask for.
   *
   * THE CUT IS BY ROUND RATHER THAN BY DATE, because a corpus whose
   * people have unequal histories has no single date that means "one
   * publish ago". Nothing about the full-corpus case changes: every
   * person's rounds sit on the same spacing, so the newest round's
   * cut and one step back off the clock select the same submissions.
   *
   * A first publish carries no predecessor and says so by leaving it
   * undefined, rather than by comparing against an empty document: a
   * movement measured from nobody is a figure with no meaning, and the
   * charts correctly draw no change-since line without one.
   */
  function publishedFrom(which, deps, rounds) {
    const all = corpusInputs(which);
    const top = rounds === null || rounds === undefined
      ? roundsIn(which) : rounds;
    const inputs = all.filter(function (one) { return one.round <= top; });
    const before = all.filter(function (one) { return one.round <= top - 1; });
    const options = { identify: false };
    if (before.length > 0) {
      const at = before[before.length - 1].at;
      options.previous = deps.snapshotOf(
        entriesOf(before, deps), { identify: false }, at);
    }
    return deps.snapshotOf(entriesOf(inputs, deps), options);
  }

  root.BinderDemo = Object.freeze({
    DESTINATIONS: DESTINATIONS,
    MIRROR_PATH: MIRROR_PATH,
    FIRST_VISIT: FIRST_VISIT,
    DIRECTORY_INDEX: DIRECTORY_INDEX,
    MIRROR_EDITS: MIRROR_EDITS,
    BOOT_SCRIPTS: BOOT_SCRIPTS,
    TOOLBAR_SCRIPTS: TOOLBAR_SCRIPTS,
    TELEGRAM_STANDIN: TELEGRAM_STANDIN,
    CONFIG_STANDIN: CONFIG_STANDIN,
    LOCAL_FILES: LOCAL_FILES,
    TOOLBAR_FILES: TOOLBAR_FILES,
    STORAGE_KEYS: STORAGE_KEYS,
    TOOLBAR: TOOLBAR,
    ENABLERS: ENABLERS,
    SIGN_INS: SIGN_INS,
    DEV_SIGN_IN: DEV_SIGN_IN,
    KEY_BOXES: KEY_BOXES,
    PRESETS: PRESETS,
    CLOCK_STEPS: CLOCK_STEPS,
    DEV_KEY_FILE: DEV_KEY_FILE,
    KEY_STAGED_LINE: KEY_STAGED_LINE,
    ROUTES: ROUTES,
    PREFIX_ROUTES: PREFIX_ROUTES,
    MEMBER_ACCOUNT: MEMBER_ACCOUNT,
    ADMIN_ACCOUNT: ADMIN_ACCOUNT,
    MEMBER_TELEGRAM_ID: MEMBER_TELEGRAM_ID,
    accountIdFor: accountIdFor,
    mirror: mirror,
    unmirror: unmirror,
    endpointCallsIn: endpointCallsIn,
    routeFor: routeFor,
    sameOriginAs: sameOriginAs,
    workerPathOf: workerPathOf,
    requestKindOf: requestKindOf,
    toolbarFileKind: toolbarFileKind,
    pageAddressOf: pageAddressOf,
    destinationUnder: destinationUnder,
    signInFor: signInFor,
    signInForTelegramId: signInForTelegramId,
    sessionFor: sessionFor,
    keyBoxFor: keyBoxFor,
    presetFor: presetFor,
    resetPlan: resetPlan,
    clockJumpFor: clockJumpFor,
    countsFor: countsFor,
    roundsIn: roundsIn,
    answerFor: answerFor,
    meFor: meFor,
    corpusInputs: corpusInputs,
    entriesFrom: entriesFrom,
    publishedFrom: publishedFrom,
  });
})(globalThis);
