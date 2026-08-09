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
    { file: "submit.html", label: "Your binder" },
    { file: "dashboard.html", label: "Progress" },
    { file: "admin.html", label: "Admin" },
  ];

  /*
   * The sizes the console can give the frame, in CSS pixels.
   *
   * An iframe's width IS the viewport the page inside it lays out
   * against, so a shipped page in a 375-pixel frame takes its own phone
   * rules - the rail as a strip, the theme chips behind the disclosure,
   * no sideways scroll - with nothing changed in apps/web and nothing
   * recorded here. That is the whole feature: a width.
   *
   * NOTHING HERE EMULATES A DEVICE. No touch, no user agent, no pixel
   * ratio. The demo is never driven on a phone (the owner's ruling on
   * #142), the console around this frame stays a desktop tool, and a
   * faked device would put a screen in front of the owner that no
   * browser on the machine can be asked to reproduce - which is the
   * false-confidence direction this whole demo is built to refuse.
   *
   * One residual, stated rather than hidden: a desktop browser draws a
   * classic scrollbar inside the frame, so a page here gets 375 pixels
   * of viewport and about 360 of content, where a phone with an overlay
   * scrollbar gives it all 375. That is the direction that makes a page
   * look narrower than it will be, never wider, so what the owner is
   * shown is the harder of the two cases.
   *
   * `desktop` carries no size of its own on purpose, and leads the list
   * because the console opens on whichever viewport comes first. It is
   * the frame filling the stage the way dev/demo.css sizes it, so the
   * default cannot drift into a number nobody chose and switching back
   * is a clear rather than a second measurement to keep in step.
   */
  const VIEWPORTS = [
    { id: "desktop", label: "Desktop", width: null, height: null },
    { id: "phone", label: "Phone", width: 375, height: 812 },
  ];

  /*
   * The names the demo writes into the browser's own storage, and their
   * one home.
   *
   * They are here rather than beside the code that writes them because
   * dev/demo.test.mjs scans apps/web for them: a shipped page keyed on
   * `hgb-demo-scenario` would read the staged scenario and change its
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
  const STORAGE_KEYS = ["hgb-demo-scenario", "hgb-demo-data", "hgb-demo-world"];

  /* ---------------------------------------------------------------- */
  /* The mirror: the only bytes the demo changes, and why.             */
  /* ---------------------------------------------------------------- */

  /*
   * apps/web is copied verbatim to the published site, so it holds no
   * test hook, no fixture and no development-only global - and this demo
   * adds none. What it does instead is serve a MIRROR of those files,
   * read off disk on every request, with the two edits below applied on
   * the way out.
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
   * that quietly differs from the product is worse than no demo. The
   * console renders this table so the owner can see what is not the real
   * thing, and dev/demo.test.mjs asserts that a mirrored page differs
   * from the shipped one in exactly these ways and no others.
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

  const TELEGRAM_WIDGET = /https:\/\/telegram\.org\/js\/telegram-widget\.js[^"']*/g;
  const TELEGRAM_STANDIN = "/dev/demo-telegram.js";

  const CONFIG_TAG = '<script src="config.js"></script>';
  const CONFIG_STANDIN = '<script src="/dev/demo-config.js"></script>';

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
      out = out.slice(0, at) + BOOT_SCRIPTS + out.slice(at);
      applied.push("boot");
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
      .replace(BOOT_SCRIPTS, "")
      .split(CONFIG_STANDIN).join(CONFIG_TAG)
      .split(TELEGRAM_STANDIN).join("https://telegram.org/js/telegram-widget.js?22");
  }

  /*
   * Where a baked build writes what it is a snapshot OF.
   *
   * The live console cannot go stale - it reads apps/web off disk on
   * every request - so this region says so, and a bake replaces it with
   * the commit it was taken at. That asymmetry is the whole point: a
   * hosted copy is stale the moment the next slice merges, and a
   * snapshot that does not say when it was taken is read as current for
   * as long as it is up.
   *
   * A console whose markers have gone answers null rather than being
   * written through unstamped. Refusing is the safe direction here: an
   * unstamped build on a public URL is indistinguishable from a current
   * one, which is the failure this region exists to prevent.
   */
  const STAMP_OPEN = "<!-- BAKED-AT -->";
  const STAMP_CLOSE = "<!-- /BAKED-AT -->";

  /*
   * THE MARKERS SURVIVE THE STAMP, so a stamped console is still
   * stampable. Consuming them would make the operation one-way: a bake
   * over a directory that already holds one would refuse for the reason
   * that means "somebody removed the region", and the two situations
   * would be indistinguishable from the error. It is also what lets
   * dev/demo-bake.test.mjs assert that a baked console differs from the
   * source in this region and nowhere else, by stamping both the same
   * way and comparing.
   */
  function stampInto(html, replacement) {
    const text = String(html);
    const open = text.indexOf(STAMP_OPEN);
    const close = text.indexOf(STAMP_CLOSE);
    if (open === -1 || close === -1 || close < open) return null;
    return text.slice(0, open) + STAMP_OPEN + String(replacement) +
      STAMP_CLOSE + text.slice(close + STAMP_CLOSE.length);
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

  /* ---------------------------------------------------------------- */
  /* The scenarios.                                                   */
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

  /*
   * A numeric Telegram id on the member session, so #58's line paints on
   * the offline arm. It is a made-up number of the right length and
   * belongs to nobody; the live arm is where a real one appears.
   *
   * The opposite case - a development session, whose id is null, where
   * the line correctly stays hidden - is not staged here. POST /auth/dev
   * answers null by construction, so proving it needs the real route.
   */
  const MEMBER_TELEGRAM_ID = "6204915773";

  function sessionFor(id, options) {
    const opts = options || {};
    return {
      ok: true,
      session: "demo-" + id,
      // Far enough out that a long walk-through never expires mid-demo,
      // and still a real expiry: session.js refuses a credential without
      // one, so a demo session has to be a well-formed session.
      expiresAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
      username: opts.username || "demo_member",
      isAdmin: opts.isAdmin === true,
      isDev: false,
      telegramId: opts.telegramId === undefined
        ? MEMBER_TELEGRAM_ID : opts.telegramId,
    };
  }

  const MEMBER_SESSION = sessionFor("member", { username: "demo_member" });
  const ADMIN_SESSION = sessionFor("admin", {
    username: "demo_keyholder", isAdmin: true,
  });

  /*
   * The scenarios, one per acceptance box on #122. The ids are cited by
   * UAT.md and by the console, so they are a contract: rename one and two
   * documents stop agreeing. dev/demo.test.mjs reads UAT.md's section
   * headings and fails on any disagreement in either direction - until
   * it did, "contract" was a word in this comment and nothing else.
   *
   * `start` is where the walk-through begins. Every destination stays
   * reachable in every scenario, because half of what this demo has to
   * show is the rail carrying somebody between them.
   */
  const SCENARIOS = [
    {
      id: "signed-out",
      label: "Signed out, arriving cold",
      start: "index.html",
      session: null,
      boxes: ["shell", "signin-id"],
      steps: [
        "The cover is closed and opens once. Reload to see it again; " +
          "turn on reduced motion in the operating system and reload to " +
          "see it snap open instead of animating.",
        "The wordmark is Playfair Display - if it renders as a plain " +
          "serif the font did not load, which is the thing to look for.",
        "There is no rail on Sign in, by decision on #73, and no " +
          "palette switch with it: theme-init.js paints whatever was " +
          "saved and this page offers no way to change it. Switching " +
          "is the member scenario's step, on a page that has the rail.",
        "Press the Telegram button. It is a local stand-in for the " +
          "widget and calls the page's own callback, so what happens " +
          "after the press is the shipped code.",
        "Sign-in lands on Your binder with the member's own numeric id " +
          "on screen (#58).",
      ],
    },
    {
      id: "member",
      label: "A member with a history",
      start: "submit.html",
      session: MEMBER_SESSION,
      boxes: ["shell", "signin-id", "panel", "dashboard"],
      steps: [
        "Entries shows what this account currently claims, and the " +
          "numeric id line is painted.",
        // The chips are named by the page, not here, and the driver is
        // sent to read the rail rather than a list. Two reasons, both
        // still live now that the owner has ruled the light palette's
        // label on #127: a walk-through that spells out a label needs
        // correcting every time one moves, and nothing in the gate
        // compares these four buttons across the three pages that carry
        // them, so counting them against the rail is what makes this
        // step notice one going missing.
        "Switch every palette chip in the rail in turn. This is the " +
          "first scenario that starts on a page carrying them.",
        "New entry opens the form; the rail carries you to Progress and " +
          "back without losing the tab you were on.",
        "Progress draws the full payoff for this scenario: the " +
          "combined-weight hero, the deltas, and the marquee " +
          "weight-over-time series.",
      ],
    },
    {
      id: "member-prefilled",
      label: "A member returning to a filled form",
      start: "submit.html",
      session: MEMBER_SESSION,
      prefill: true,
      boxes: ["panel", "signout"],
      steps: [
        "New entry is already filled in. That prefill is device-local " +
          "and scoped to this account id (#56), never to the browser.",
        "Sign out, then come back: the prefill is gone with the " +
          "session. Signing out clears both.",
      ],
    },
    {
      id: "supersede",
      label: "A correction that supersedes",
      start: "submit.html",
      session: MEMBER_SESSION,
      boxes: ["panel", "supersede"],
      steps: [
        "Entries reads the effective count from GET /me and nowhere " +
          "else: four entries with two superseded, not six.",
        "The tombstones are reported beside the count rather than " +
          "subtracted in silence, so a correction that landed looks " +
          "different from one that was refused.",
      ],
    },
    {
      id: "revoked",
      label: "A session revoked on the server",
      start: "submit.html",
      session: MEMBER_SESSION,
      revoked: true,
      boxes: ["signout", "revocation"],
      steps: [
        "The tab still holds a session, and the server has already " +
          "deleted the row - which is the state a member is in one " +
          "moment after signing out somewhere else.",
        "The next request is refused, the page drops its copy and " +
          "returns to Sign in. A token captured before sign-out is not " +
          "a working credential (#90).",
      ],
    },
    {
      id: "keyholder",
      label: "The keyholder opens the corpus",
      start: "admin.html",
      session: ADMIN_SESSION,
      boxes: ["keyholder", "admin-panel"],
      steps: [
        "Fetch and decrypt. The rows are dev/sample-submissions.json, " +
          "sealed to the throwaway dev/test-key.json and to nothing real.",
        "Load dev/test-key.json in the key picker. Expect 17 of 18 rows " +
          "to open and row 16 to be named as unopenable - that is the " +
          "rotated-key case, not a fault.",
        "Store the key, reload, and Fetch and decrypt again: it needs no " +
          "paste the second time (#70).",
        "Clear destroys both copies.",
      ],
    },
    {
      id: "admin",
      label: "The admin instrument panel",
      start: "admin.html",
      session: ADMIN_SESSION,
      boxes: ["admin-panel", "signout"],
      steps: [
        "Read the page as a surface rather than a stack of boxes (#68): " +
          "the instrument panel, its measures, and the export controls.",
        "Publish. The stub keeps the snapshot, so Progress then draws " +
          "what this page just published.",
        "Sign out here ends the session and leaves the stored key in " +
          "place; Clear is what removes the key. That is the designed " +
          "behavior, not a gap.",
      ],
    },
    {
      id: "config-fallback",
      label: "Site copy falling back to the shipped words",
      start: "admin.html",
      session: ADMIN_SESSION,
      boxes: ["config"],
      steps: [
        "The stub answers GET /content with an empty document, which is " +
          "what the Worker answers before an admin has set anything.",
        "Every page shows the copy it ships with. The fallback is the " +
          "normal first-run state, not an error.",
        "The pane that edits this copy is PR 5. The console says " +
          "whether it has landed, and the answer is read out of the " +
          "shipped bytes rather than written down here.",
      ],
    },
    {
      id: "suppressed",
      label: "Too few people to publish",
      start: "dashboard.html",
      session: MEMBER_SESSION,
      boxes: ["dashboard", "privacy"],
      steps: [
        "The same page, drawn from a sparse corpus: three people where " +
          "the floor is five.",
        "Cells below the floor are suppressed and the weight-over-time " +
          "series is withheld entirely - a line is one person, so four " +
          "lines would be four identifiable trajectories.",
        "Nothing published carries a handle or a row.",
      ],
    },
  ];

  /* ---------------------------------------------------------------- */
  /* Reading the shipped bytes for what a box needs.                  */
  /* ---------------------------------------------------------------- */

  /*
   * A source file with its comments removed, so a probe cannot be
   * satisfied by somebody writing about the feature.
   *
   * WHY THIS IS A SCANNER AND NOT TWO REGULAR EXPRESSIONS. Stripping
   * `//` to end of line would delete the line holding
   * "https://telegram.org", and deleting real code is how a probe
   * arrives at "not yet" for a feature that shipped. So string, template
   * and comment state are tracked together: whichever opens first wins,
   * which is also how the language reads it. A `//` inside a string
   * stays; a quote inside a comment cannot open a string.
   *
   * Regex literals are not tracked, and that is a bounded gamble rather
   * than an oversight: a regular expression cannot contain an unescaped
   * `//` or `/*` without ending itself, so the sequences this scanner
   * reacts to cannot appear inside one.
   */
  function withoutComments(source, extension) {
    const text = String(source);

    if (extension === ".html") {
      return text.replace(/<!--[\s\S]*?-->/g, " ");
    }

    let out = "";
    let index = 0;
    let quote = null;
    const block = extension === ".css";

    while (index < text.length) {
      const here = text[index];
      const next = text[index + 1];

      if (quote !== null) {
        out += here;
        if (here === "\\") {
          out += next === undefined ? "" : next;
          index += 2;
          continue;
        }
        if (here === quote) quote = null;
        index += 1;
        continue;
      }

      if (here === "/" && next === "*") {
        const end = text.indexOf("*/", index + 2);
        out += " ";
        index = end === -1 ? text.length : end + 2;
        continue;
      }

      if (!block && here === "/" && next === "/") {
        const end = text.indexOf("\n", index);
        out += " ";
        index = end === -1 ? text.length : end;
        continue;
      }

      if (!block && (here === '"' || here === "'" || here === "`")) {
        quote = here;
      }

      out += here;
      index += 1;
    }

    return out;
  }

  /*
   * Only what is inside a tag - attributes, element names - with text
   * content dropped.
   *
   * The second half of the same problem. "instrument" is an ordinary
   * English word, and a page describing the panel in a paragraph carries
   * it just as readily as a page implementing one. Markup is where a
   * feature actually lands: a class, an id, an element. Prose is not.
   *
   * This can report "not yet" for a panel whose only occurrence of the
   * word is a heading, and that is the direction to be wrong in. A box
   * reading "not yet" when the work landed costs somebody a second look;
   * a box reading "drivable" when nothing landed is a false PASS handed
   * to the person deciding the cutover.
   */
  function markupOf(html) {
    return (String(html).match(/<[^>]*>/g) || []).join("\n");
  }

  function extensionOf(file) {
    const at = String(file).lastIndexOf(".");
    return at === -1 ? "" : String(file).slice(at).toLowerCase();
  }

  /*
   * Whether the shipped bytes carry what a box needs. The console paints
   * this answer and dev/demo.test.mjs drives it, so the verdict the owner
   * reads and the verdict the gate reasons about are one function.
   */
  function probeHit(source, probe) {
    const extension = extensionOf(probe.file);
    let text = withoutComments(source, extension);
    if (probe.markup === true) text = markupOf(text);
    return text.indexOf(probe.pattern) !== -1;
  }

  /*
   * Where the console fetches a probe's bytes from, and how it gets the
   * SHIPPED bytes back out of them.
   *
   * A page probe is read through the mirror, and the reason is the one
   * rule a hosted build cannot bend: an apps/web page served at a path
   * the mirror did not produce carries no dev/demo-boot.js, so its own
   * scripts call fetch for real. So a bake emits no page anywhere but
   * /demo/, and the console reads the mirrored copy and undoes the
   * edits - which returns the shipped file byte for byte, the round
   * trip dev/demo.test.mjs already holds the mirror to.
   *
   * Everything else is read from its own path: unmirror is a no-op on a
   * stylesheet, and routing it through /demo/ would only add a way for
   * the two paths to disagree.
   *
   * One rule for both arms, so what the local server serves and what a
   * bake emits are answering the same question.
   */
  function probeUrlFor(file) {
    const path = String(file);
    if (extensionOf(path) !== ".html") return "/" + path;
    return "/demo/" + path.slice(path.lastIndexOf("/") + 1);
  }

  function probeSourceOf(file, text) {
    return extensionOf(String(file)) === ".html"
      ? unmirror(text) : String(text);
  }

  /*
   * The acceptance boxes from #122, and how the console decides whether
   * each one is drivable yet.
   *
   * A probe reads the shipped bytes for the thing the box needs. It is
   * derived rather than written down for the reason #122 states: boxes
   * whose UI slices have not landed block the demo exactly as long as
   * they block the cutover, so the demo has to report that state rather
   * than assert one. When PR 5 adds the pane, the pane's own bytes flip
   * its box to drivable and nobody edits this file.
   *
   * A PATTERN IS CHOSEN FOR WHAT ONLY THE IMPLEMENTATION CAN CONTAIN.
   * The three boxes still waiting on a slice are the three whose probes
   * were plain enough to be satisfied by a sentence - one TODO comment
   * mentioning "instrument" flipped admin-panel to drivable with nothing
   * built. Comments no longer count anywhere; `instrument` is anchored to
   * markup on top of that; and the config probe asks for the quoted path
   * as the call sites write it rather than for the four characters
   * `/content` wherever they fall.
   *
   * dev/demo.test.mjs pins the mechanism - every box has a probe, every
   * probe names a file that exists, and none of them can be satisfied
   * from a comment - and deliberately does not pin the answers. A gate
   * that failed the day PR 5 landed would be a gate asking the project
   * to stand still.
   */
  const BOXES = [
    {
      id: "shell",
      title: "The identity and shell",
      probe: { file: "apps/web/theme.css", pattern: "cover-leaf" },
    },
    {
      id: "signin-id",
      title: "Sign-in surfaces the member's own numeric id (#58)",
      probe: { file: "apps/web/submit.js", pattern: "showTelegramId" },
    },
    {
      id: "revocation",
      title: "Sign-out revokes server-side (#90)",
      probe: { file: "apps/web/signout.js", pattern: "\"DELETE\"" },
    },
    {
      id: "keyholder",
      title: "Import the key once, return without a paste; Clear (#70)",
      probe: { file: "apps/web/admin.js", pattern: "storedKeyVerdict" },
    },
    {
      id: "panel",
      title: "The member panel and its prefill (#56)",
      probe: { file: "apps/web/submit.js", pattern: "restorePrefill" },
    },
    {
      id: "supersede",
      title: "A correction supersedes; /me counts effective entries (#84)",
      probe: { file: "apps/web/submit.js", pattern: "superseded" },
    },
    {
      id: "config",
      title: "Admin edits site content through the config routes (#87)",
      // The quoted path, because that is how every call site in apps/web
      // writes one: `config.endpoint + "/content"`. The bare four
      // characters also occur in any sentence naming the route.
      probe: { file: "apps/web/admin.js", pattern: "\"/content\"" },
    },
    {
      id: "dashboard",
      title: "The dashboard payoff: hero, deltas, marquee series",
      probe: { file: "apps/web/dashboard.js", pattern: "lineChart" },
    },
    {
      id: "admin-panel",
      title: "The admin instrument panel reads as the admin surface (#68)",
      // Anchored to markup: the word is ordinary English, and #68's own
      // text uses it. A class or an id carrying it is the panel; a
      // paragraph carrying it is a plan.
      probe: {
        file: "apps/web/admin.html", pattern: "instrument", markup: true,
      },
    },
    {
      id: "signout",
      title: "Sign-out everywhere",
      probe: { file: "apps/web/signout.js", pattern: "BinderSignOut" },
    },
    {
      id: "privacy",
      title: "No handles, no rows, no sub-floor cells in anything published",
      probe: { file: "apps/web/dashboard.js", pattern: "MIN_CELL" },
    },
  ];

  /* ---------------------------------------------------------------- */
  /* The frame's size.                                                 */
  /* ---------------------------------------------------------------- */

  function viewportFor(id) {
    for (const one of VIEWPORTS) {
      if (one.id === id) return one;
    }
    return null;
  }

  /*
   * What the console writes onto the frame element, and why the two
   * assignments are computed here rather than there.
   *
   * The hazard this control carries is a frame that LOOKS phone-shaped
   * around a page still laid out at desktop width - a screen that reads
   * as evidence and is not, shown to the person deciding the cutover.
   * Sizing anything other than the frame itself produces it, so the size
   * is a value dev/demo.test.mjs can assert and the browser half only
   * assigns.
   *
   * An unknown id is refused rather than answered with the default. A
   * silent fall back to desktop paints a desktop page under a control
   * reading Phone, which is the same lie an unstaged scenario id told
   * before it was made to refuse.
   *
   * The empty strings are a clear, not a size: assigning "" removes the
   * inline declaration and hands the frame back to dev/demo.css, so
   * there is one place that says how big the desktop frame is.
   */
  function frameStyleFor(id) {
    const view = viewportFor(id);
    if (view === null) return null;
    if (view.width === null) return { width: "", height: "" };
    return { width: view.width + "px", height: view.height + "px" };
  }

  /* ---------------------------------------------------------------- */
  /* The stubbed Worker.                                              */
  /* ---------------------------------------------------------------- */

  function scenarioFor(id) {
    for (const scenario of SCENARIOS) {
      if (scenario.id === id) return scenario;
    }
    return null;
  }

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
     * A staged id that names no scenario refuses, loudly, naming the id.
     *
     * Falling through to `{}` here would answer as a generic member:
     * a plausible screen built from a world nobody staged, which is the
     * exact failure this file's own suite header calls the way demos
     * fail. The state that produces it is ordinary rather than exotic -
     * a scenario renamed while a tab still holds the old id in
     * sessionStorage.
     *
     * An absent id is not an error. The console has not staged anything
     * yet at first paint, and dev/demo.test.mjs drives routing with no
     * world at all.
     */
    if (state.scenario !== undefined && state.scenario !== null &&
        String(state.scenario) !== "" &&
        scenarioFor(state.scenario) === null) {
      return {
        status: 500,
        body: {
          error: "The demo has no scenario \"" + state.scenario + "\". " +
            "It was probably renamed - reset the demo and pick one again.",
        },
        next: next,
      };
    }

    const scenario = scenarioFor(state.scenario) || {};

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
    // nothing. Two ways to arrive here - the `revoked` scenario stages it
    // directly, and pressing Sign out in any scenario sets it below,
    // which is what makes #90 drivable rather than described.
    //
    // READING site copy is the one exemption, and it is the read alone:
    // handleReadContent takes no credential and every write on that path
    // is an admin session like all the others, so exempting the whole
    // path would demonstrate an unauthenticated write the Worker refuses.
    if (scenario.revoked === true || state.revoked === true) {
      const openRead = route === "/content" && method === "GET";
      if (!openRead) {
        return { status: REFUSED.status, body: REFUSED.body, next: next };
      }
    }

    if (route === "/auth/telegram" || route === "/auth/dev") {
      const session = route === "/auth/dev"
        ? sessionFor("dev", { username: "demo_dev", telegramId: null })
        : sessionFor("member", { username: "demo_member" });
      next.session = session;
      return { status: 200, body: session, next: next };
    }

    if (route === "/session") {
      // Signing out deletes the row. The scenario that demonstrates what
      // that costs a captured token is `revoked`; here it is enough that
      // the answer is the Worker's.
      next.revoked = true;
      return { status: 200, body: { ok: true }, next: next };
    }

    if (route === "/me") {
      return { status: 200, body: meFor(scenario), next: next };
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
      const published = state.published ||
        (scenario.id === "suppressed" ? data.sparse : data.rich);
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
      if (method === "GET") {
        return {
          status: 200,
          body: { ok: true, membership: state.membership || [] },
          next: next,
        };
      }
      return { status: 200, body: { ok: true }, next: next };
    }

    if (route === "/membership/" || route === "/submission/") {
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
   * What GET /me says in each scenario.
   *
   * `entries` is the effective count and `superseded` sits beside it,
   * exactly as the Worker computes them - the supersede scenario is the
   * one that makes the difference visible, and it is only visible if the
   * two numbers are staged as two numbers.
   */
  function meFor(scenario) {
    const supersede = scenario.id === "supersede";
    return {
      ok: true,
      accountId: scenario.session && scenario.session.isAdmin
        ? ADMIN_ACCOUNT : MEMBER_ACCOUNT,
      // Four effective entries in both, so the number the panel leads
      // with does not move between the two scenarios and the only
      // difference on screen is the tombstone count beside it. Six rows
      // written, four claimed, is what a member who corrected twice sees.
      entries: 4,
      superseded: supersede ? 2 : 0,
      lastAt: new Date(Date.now() - 36 * 3600 * 1000).toISOString(),
      isAdmin: Boolean(scenario.session && scenario.session.isAdmin),
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
   * anything smaller draws a Progress page with its centerpiece missing
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
   * One person's submissions, spread backwards through time so the
   * series has somewhere to run. The spacing is three weeks because the
   * chart quantizes to the day and a series bunched into one week draws
   * as a vertical smudge.
   */
  function inputsFor(person) {
    return person.weights.map(function (weight, index) {
      const back = (person.weights.length - 1 - index) * 21 * DAY;
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
      return { input: input, handle: person.handle, at: Date.now() - back };
    });
  }

  function corpusInputs(which) {
    const people = which === "sparse" ? SPARSE_PEOPLE : RICH_PEOPLE;
    const out = [];
    people.forEach(function (person) {
      inputsFor(person).forEach(function (one) { out.push(one); });
    });
    return out.sort(function (a, b) { return a.at - b.at; });
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
  function entriesFrom(which, deps) {
    return corpusInputs(which).map(function (one, index) {
      const record = deps.buildRecord(one.input, one.at, one.handle);
      return deps.entryFor({
        id: index + 1,
        account_id: accountIdFor(one.handle),
        received_at: new Date(one.at).toISOString(),
      }, record);
    });
  }

  root.BinderDemo = Object.freeze({
    DESTINATIONS: DESTINATIONS,
    VIEWPORTS: VIEWPORTS,
    MIRROR_EDITS: MIRROR_EDITS,
    BOOT_SCRIPTS: BOOT_SCRIPTS,
    TELEGRAM_STANDIN: TELEGRAM_STANDIN,
    CONFIG_STANDIN: CONFIG_STANDIN,
    LOCAL_FILES: LOCAL_FILES,
    STORAGE_KEYS: STORAGE_KEYS,
    SCENARIOS: SCENARIOS,
    BOXES: BOXES,
    ROUTES: ROUTES,
    PREFIX_ROUTES: PREFIX_ROUTES,
    MEMBER_ACCOUNT: MEMBER_ACCOUNT,
    ADMIN_ACCOUNT: ADMIN_ACCOUNT,
    MEMBER_TELEGRAM_ID: MEMBER_TELEGRAM_ID,
    accountIdFor: accountIdFor,
    mirror: mirror,
    unmirror: unmirror,
    stampInto: stampInto,
    endpointCallsIn: endpointCallsIn,
    routeFor: routeFor,
    probeHit: probeHit,
    probeUrlFor: probeUrlFor,
    probeSourceOf: probeSourceOf,
    sameOriginAs: sameOriginAs,
    workerPathOf: workerPathOf,
    requestKindOf: requestKindOf,
    viewportFor: viewportFor,
    frameStyleFor: frameStyleFor,
    scenarioFor: scenarioFor,
    answerFor: answerFor,
    meFor: meFor,
    corpusInputs: corpusInputs,
    entriesFrom: entriesFrom,
  });
})(globalThis);
