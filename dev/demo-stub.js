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
   * The sizes the console can give the frame, in CSS pixels.
   *
   * An iframe's width IS the viewport the page inside it lays out
   * against, so a shipped page in a 375-pixel frame takes its own phone
   * rules - the rail as a strip, its destinations still in flow, no
   * sideways scroll - with nothing changed in apps/web and nothing
   * recorded here. That is the whole feature: a width.
   *
   * The palette control is deliberately not in that list. It is one
   * control at every width (#150), so it sits outside every media
   * query and is not something narrowing the frame reveals. What
   * narrowing the frame DOES reach it for is the flyout's flip: on a
   * short viewport the panel has no room above the footer and opens
   * downward instead, which is a measurement rather than a breakpoint.
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

  /*
   * The one channel the feed's narrations travel on, named here for the
   * same reason the keys above are: dev/demo.test.mjs scans apps/web
   * for this name, because a shipped page listening on it would be a
   * demo hook in the published bytes - one that names none of the
   * demo's files, so the scan for those cannot see it. A
   * BroadcastChannel rather than a reference between documents, because
   * the mirrored pages run inside the console's frame AND in their own
   * tab, and a channel reaches the console from both.
   */
  const EVENT_CHANNEL = "hgb-demo-events";

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
   * read off disk on every request, with the three edits below applied
   * on the way out.
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
      id: "links",
      what: "Sends a link that leaves the product to its own tab.",
      why: "Every page ships a footer link to the source on GitHub, " +
        "with no target - right on the real site, and inside this " +
        "frame a live escape hatch. Clicking it navigates the FRAME to " +
        "github.com, which refuses to be framed, so the stage goes " +
        "white and the only way back is pressing another card. A new " +
        "tab keeps the link working and keeps the walk in the frame. " +
        "Links inside the product are deliberately untouched: moving " +
        "around the site in the frame is half of what there is to see.",
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
   * The link edit, spelled as an exact pair so unmirror can undo it.
   *
   * Anchored on `<a href="` rather than on any anchor carrying an
   * absolute href, because the undo has to be exact and a looser match
   * would have to guess where to put the attributes back. If a page
   * ever writes its external link with another attribute first, this
   * stops matching it - and dev/demo.test.mjs asks the emitted bytes
   * whether EVERY external anchor is contained, so that page fails the
   * gate instead of quietly shipping an escape hatch.
   */
  const EXTERNAL_LINK = /<a href="(https?:\/\/)/g;
  const EXTERNAL_LINK_OPENED =
    '<a target="_blank" rel="noopener noreferrer" href="';

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

    if (EXTERNAL_LINK.test(out)) {
      EXTERNAL_LINK.lastIndex = 0;
      out = out.replace(EXTERNAL_LINK, EXTERNAL_LINK_OPENED + "$1");
      applied.push("links");
    }
    EXTERNAL_LINK.lastIndex = 0;

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
      .split(EXTERNAL_LINK_OPENED).join('<a href="')
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
   * whole care of it. That list is what a page INSIDE the frame may
   * fetch for real, and no shipped page fetches a key - adding one
   * there would widen what the product is permitted to read to include
   * key material, which is the opposite of what this demo exists to
   * show. This path is fetched by the CONSOLE, which runs outside the
   * frame with its own real fetch, and the console writes the text into
   * the page's key box exactly as a person pasting it would.
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
   * What the console says, in the feed, the moment it puts that key in
   * the page's box.
   *
   * THE DISCLOSURE HAS TO TRAVEL WITH THE ACT. A private key appearing
   * in a box, in front of the person deciding whether to trust this
   * design, teaches the wrong lesson unless the same moment says what
   * kind of key it is - and a sentence carried by one stop's narration
   * only covers the stop somebody wrote it for. Two journeys stage this
   * key now, for different reasons, and the next one will not come with
   * a narration about keys either.
   *
   * The feed is where it goes because the feed is already the place a
   * viewer reads what just happened, and this is a thing the console
   * really did rather than a line about what should be true.
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
   * The scenarios are the STAGING: which session the tab holds, which
   * corpus the stubbed snapshot route serves, whether a prefill or a
   * revocation is waiting. The person-facing half lives on the
   * FEATURES cards below (#209); the ids are plumbing, cited by the
   * cards' actions and by dev/demo.test.mjs and by nothing a reader
   * sees. No walk-through belongs here: UAT.md is the one home for a
   * scripted walk, because #192 already showed what a script kept in
   * two homes costs.
   *
   * `start` is where a card's action lands unless the action says
   * otherwise. Every destination stays reachable in every scenario,
   * because half of what this demo has to show is the rail carrying
   * somebody between them.
   */
  const SCENARIOS = [
    {
      id: "signed-out",
      label: "Arriving for the first time, signed out",
      start: "index.html",
      session: null,
      boxes: ["shell", "signin-id"],
    },
    {
      id: "member",
      label: "Signed in, with a history",
      start: "your-page.html",
      session: MEMBER_SESSION,
      boxes: ["shell", "signin-id", "panel", "dashboard"],
    },
    {
      id: "member-prefilled",
      label: "Coming back to a form that remembers you",
      start: "your-page.html",
      session: MEMBER_SESSION,
      prefill: true,
      boxes: ["panel", "signout"],
    },
    {
      id: "supersede",
      label: "A mistake, corrected",
      start: "your-page.html",
      session: MEMBER_SESSION,
      boxes: ["panel", "supersede"],
    },
    {
      id: "revoked",
      label: "Signed out somewhere else",
      start: "your-page.html",
      session: MEMBER_SESSION,
      revoked: true,
      boxes: ["signout", "revocation"],
    },
    {
      id: "keyholder",
      label: "The keyholder opens the corpus",
      start: "admin.html",
      session: ADMIN_SESSION,
      boxes: ["keyholder", "admin-panel"],
    },
    {
      id: "admin",
      label: "Running the admin panel",
      start: "admin.html",
      session: ADMIN_SESSION,
      boxes: ["admin-panel", "signout"],
    },
    {
      id: "config-fallback",
      label: "Before anyone has written the site copy",
      start: "admin.html",
      session: ADMIN_SESSION,
      boxes: ["config"],
    },
    {
      id: "suppressed",
      label: "Too few people to publish",
      start: "charts.html",
      session: MEMBER_SESSION,
      boxes: ["dashboard", "privacy"],
    },
  ];

  /*
   * The feature cards, and the register they are written in (#209).
   *
   * A card addresses the person deciding whether the PRODUCT is good:
   * what the thing does, in their words, and a button that shows it
   * happening. The machinery's own vocabulary is refused on a card by
   * dev/demo.test.mjs, word by word, because the day a card needs
   * those words is the day the console has gone back to addressing
   * the auditor.
   *
   * Every action names a staging id from SCENARIOS and optionally a
   * page to open instead of that staging's `start`. The suite holds
   * the coverage two-way - no action without its staging, no staging
   * no card can reach - and holds UAT.md to one section per card,
   * marked `card "Title"` in its heading, titles agreeing exactly in
   * both directions.
   *
   * An action may also carry the `press`, `key` and `scroll` a journey
   * stop carries, and the console sequences them through the same
   * errand. They are here because a card can land on the wrong tab or
   * in front of a locked box exactly as a stop can, and a second
   * staging path for the free drive is the drift the stops' own header
   * warns about one surface up.
   *
   * `try` is the one thing to touch in the frame after the press,
   * carried on the action itself rather than painted from a separate
   * list, because a pointer that cannot name its action is a pointer
   * that outlives it. Same register as the cards, held to it by the
   * same word list.
   */
  const FEATURES = [
    {
      title: "Sign in with Telegram",
      blurb: "Press the Telegram button and you are in - no password, " +
        "no account form. The demo swaps the real widget for a local " +
        "stand-in; everything after the press is the shipped code.",
      actions: [{
        label: "Arrive signed out",
        scenario: "signed-out",
        try: "Press the Telegram button on the page - everything " +
          "after the press is the shipped sign-in.",
      }],
    },
    {
      title: "Weigh in",
      blurb: "Your page keeps two tabs: what is on record, and the " +
        "form for a new weigh-in. Your numbers are sealed inside your " +
        "browser before anything is sent, so the server only ever " +
        "holds them locked.",
      actions: [{
        label: "Open Your page",
        scenario: "member",
        try: "Fill in a weight and submit it - what leaves the form " +
          "is already sealed.",
      }],
    },
    {
      title: "The form remembers you",
      blurb: "Come back and the form is already filled with your last " +
        "measurements. They are kept on this device and keyed to your " +
        "account - signing out wipes them.",
      actions: [{
        label: "Return to a filled form",
        scenario: "member-prefilled",
        try: "Look at the form: your last measurements are already " +
          "in it. Sign out and watch it empty.",
      }],
    },
    {
      title: "Fix a mistake",
      blurb: "A correction replaces its row instead of adding another, " +
        "so the count on record only claims what stands.",
      actions: [{
        label: "See a corrected record",
        scenario: "supersede",
        try: "Read the counts on your page: four entries stand, and " +
          "two corrections rest behind them.",
      }],
    },
    {
      title: "Signed out means signed out",
      blurb: "Sign out on one device and every other tab finds out the " +
        "moment it asks for anything. A token captured before sign-out " +
        "opens nothing.",
      actions: [{
        label: "Arrive after signing out elsewhere",
        scenario: "revoked",
        try: "Touch anything on the page - the first request is " +
          "refused and you land back at Sign in.",
      }],
    },
    {
      title: "The keyholder's desk",
      blurb: "The export opens only for the key. Fetch the sealed " +
        "rows, unlock them with the demo's throwaway key, store the " +
        "key for next time, and clear both copies with one press.",
      /*
       * `key` for the journey's reason, on the surface the journey does
       * not cover. The card opens the same desk and its pointer tells a
       * viewer to unlock the rows with the demo key - and it staged
       * none, so a tester who opened the free drive met exactly the dead
       * end the errand was added to remove: the product answering "paste
       * or choose your key file first" about a key that exists only as a
       * file in this repository. UAT sends a driver here by name for
       * every state no stop leaves live, so this is a main road.
       */
      actions: [{
        label: "Sit at the desk",
        scenario: "keyholder",
        key: true,
        try: "Fetch the sealed rows, unlock them with the throwaway " +
          "demo key, then clear both copies with one press.",
      }],
    },
    {
      title: "The admin's panel",
      blurb: "One surface for the gang's controls: publish a fresh " +
        "snapshot, manage who counts as an admin, export the rows.",
      /*
       * ALL THREE, FOR THE SAME REASON THE PUBLISHING STOPS CARRY THEM.
       *
       * The page keeps its publishing card in the markup and hidden, and
       * reveals it only after a successful decrypt. This card promises
       * publishing in its blurb and in its pointer, and staged none of
       * that - so it opened on the key box with Publish reporting
       * `disabled: false` and rendering nothing at all. The press did
       * nothing and nothing said so, on the one card UAT sends a driver
       * to by name for the taken-down charts.
       *
       * The promise is kept rather than withdrawn, which is the owner's
       * ruling on this class: the screen is made to show what the words
       * say. The order is the errand's, not this list's - the key before
       * the press, or the product asks for a key file.
       */
      actions: [{
        label: "Run the panel",
        scenario: "admin",
        key: true,
        press: "run",
        scroll: "publish-card",
        try: "Publish a fresh snapshot, then open Muse's charts and " +
          "see it drawn.",
      }],
    },
    {
      title: "Before anything is written",
      blurb: "A brand-new deployment has no site copy yet, and every " +
        "page shows the words it ships with. The first run is a " +
        "normal day, not an error.",
      actions: [{
        label: "Start from empty",
        scenario: "config-fallback",
        try: "Read the page's wording - it is the shipped fallback, " +
          "shown because nothing is written over it yet.",
      }],
    },
    {
      title: "Muse's charts",
      blurb: "Everyone's progress drawn as one line - the combined " +
        "weight, the deltas, the weight-over-time chart. Muse sees " +
        "everyone and no one.",
      actions: [{
        label: "See the charts",
        scenario: "member",
        open: "charts.html",
        try: "Scroll the charts: the combined weight, the deltas, " +
          "and everyone's line drawn together.",
      }],
    },
    {
      title: "Too few to show",
      blurb: "When fewer people have weighed in than the privacy floor " +
        "allows, the charts hold back rather than point at somebody. " +
        "A missing cell is the promise being kept.",
      actions: [{
        label: "See a thin week",
        scenario: "suppressed",
        try: "Look for the missing cells in the charts - each one is " +
          "the privacy floor holding.",
      }],
    },
  ];

  /* ---------------------------------------------------------------- */
  /* The journeys (#238).                                             */
  /* ---------------------------------------------------------------- */

  /*
   * Four walks through the binder, and the reason they exist.
   *
   * The cards above answer "what does this product do", one feature at
   * a time, and a person who already knows the product can drive them
   * in any order. A person seeing it for the first time cannot: nine
   * chips is a list of state names with no first press, so everybody
   * builds their own order and the demo is a different demo every time
   * it is shown. A journey is the order, written down.
   *
   * A STOP IS A CARD PRESS WITH A SENTENCE ON IT. Nothing new is
   * staged - a stop names a staging id from SCENARIOS and optionally a
   * page to open instead of that staging's start, exactly as a card's
   * action does, and the console sequences the same stage()/open() the
   * cards use. There is no second staging path to keep in step, which
   * is the one way a scripted layer over a working console goes wrong.
   *
   * THE NARRATION IS THE MEMBER'S VOICE, NOT THE DRIVER'S (#192, ruled
   * for this slice). UAT.md is the acceptance script and stays
   * auditor-precise; it POINTS at these stops by number rather than
   * repeating them. Two audiences reading one walk is not two homes for
   * one fact - it is one walk described to the two people who need it,
   * and the pointers are held to resolving by dev/demo.test.mjs so the
   * two cannot drift apart silently.
   *
   * `free` is the last stop of every journey and only the last. Every
   * earlier stop is read behind glass, because a walk whose viewer has
   * already clicked away is a walk being narrated over the wrong page -
   * and then the frame is handed over deliberately, which is the point
   * the whole demo has been building to. The owner re-cut this from a
   * per-stop toggle: one unlock per journey is a simpler promise and a
   * better story.
   *
   * `press` is the one control the stop presses in the frame once the
   * page has arrived, and it exists for a specific failure: a staging
   * can be correct and land on the wrong TAB, so a stop promising "your
   * last measurements are already in it" showed a list of past entries
   * instead. dev/demo.test.mjs holds every `press` to naming a control
   * the shipped page really carries.
   *
   * `scroll` is that same promise one page-shape down. A stop can land
   * on the right page and the right tab and still narrate something
   * below the fold: the admin page carries the key box, the publishing
   * controls and the membership lists on one long surface, so the stop
   * about who holds admin opened with its subject a screen and a half
   * away. It names a section of the page and the page brings itself
   * there. dev/demo.test.mjs holds every `scroll` to naming a section
   * the shipped page really carries, the same way it holds `press`.
   *
   * `key` stages the committed throwaway key into the page's own key
   * box, so the keyholder's headline act is performable by somebody who
   * has never seen this repository. The stop's own words have to name
   * it a throwaway, and that is checked rather than trusted: a key
   * going into a box in front of the person judging this design teaches
   * the wrong lesson unless the sentence beside it says what kind of
   * key it is.
   */
  const TOURS = [
    {
      id: "member",
      title: "Your first weigh-in",
      blurb: "The whole of what a member does: arrive, sign in, put a " +
        "number in, correct one, and see where everyone stands.",
      first: true,
      stops: [
        {
          scenario: "signed-out",
          title: "Arriving with no account",
          narration: "This is what a stranger sees. There is no sign-up " +
            "form and no password to choose - one Telegram button, and " +
            "the gang already knows who you are. Nothing else on the " +
            "site is reachable from here, and the pages do not just " +
            "hide themselves: they refuse to ask for anything at all.",
        },
        {
          scenario: "member",
          title: "What is on record",
          narration: "Signed in, and Your page opens on what the binder " +
            "already holds for you. The count is what stands right now, " +
            "not how many times you have written something down.",
        },
        {
          scenario: "member",
          press: "add-entry-tab",
          title: "Putting a number in",
          narration: "The other tab is the weigh-in itself. Your " +
            "measurements are sealed inside this browser before " +
            "anything is sent, so what the server stores it cannot " +
            "read - it holds your numbers locked, and only the " +
            "keyholder's key opens them.",
        },
        {
          scenario: "member-prefilled",
          press: "add-entry-tab",
          title: "The form remembers you",
          narration: "Come back another week and the form is already " +
            "filled with what you put in last time, so a weigh-in is " +
            "one number and a press. It is kept on this device and " +
            "tied to your account - sign out and it goes.",
        },
        {
          scenario: "supersede",
          title: "Fixing a mistake",
          narration: "A correction replaces the row it corrects instead " +
            "of piling up beside it. Four entries stand and two " +
            "corrections rest behind them, so the number on your page " +
            "is what you meant, not what you typed.",
        },
        {
          scenario: "member",
          open: "charts.html",
          scroll: "charts",
          title: "Where everyone stands",
          /*
           * THE PICTURE IS BELOW THE PAGE'S OWN CONTROLS, so the stop
           * moves to the container it is drawn into: charts.html opens
           * on Count and Units, and the combined weight is about 574 px
           * down a frame that is 544 px tall at a 1280x800 window.
           * Landing on the container puts the hero - the weight, and
           * the change since last time under it - at the top of it.
           *
           * AND THE SENTENCE STOPS AT THE HERO, because the hero is
           * what lands with it. The weight-over-time chart is another
           * four hundred pixels below that line at every size, and this
           * stop is behind glass like the membership one - naming the
           * lines running through it would name something the viewer
           * cannot reach. The free stop at the end of this walk hands
           * the page over, and the site's own navigation reaches the
           * rest of it.
           */
          narration: "Everybody's numbers drawn as one picture - the " +
            "combined weight, and under it the change since last " +
            "time. Nobody's name is in any of it.",
        },
        {
          scenario: "member",
          press: "add-entry-tab",
          free: true,
          title: "Now you try",
          narration: "The page is yours from here. Fill the form in and " +
            "submit it, move around with the site's own navigation, " +
            "sign out and back in. Everything you press is the real " +
            "code - only the answers are staged.",
        },
      ],
    },
    {
      id: "keyholder",
      title: "The keyholder's desk",
      blurb: "The one act the whole design turns on: the sealed rows " +
        "come back, and only the key opens them.",
      stops: [
        {
          scenario: "keyholder",
          title: "Sealed, even to the people running it",
          narration: "This is the desk the gang's numbers are read " +
            "from. What the server hands over is locked - every row " +
            "sealed in the browser that wrote it, and nothing here has " +
            "ever seen a key.",
        },
        {
          scenario: "keyholder",
          key: true,
          title: "The key goes in the box",
          narration: "The key is in the box now, put there for you. It " +
            "is a throwaway pair kept in this project on purpose - it " +
            "protects nothing and opens nothing real, so it is safe to " +
            "show. The one the gang actually uses is held offline and " +
            "has never been anywhere near here.",
        },
        {
          scenario: "keyholder",
          key: true,
          free: true,
          title: "Now you try",
          narration: "Press Fetch and decrypt. The rows arrive sealed " +
            "and open in front of you, and Clear takes both copies " +
            "away again - the one on screen and the one this browser " +
            "was keeping for next time.",
        },
      ],
    },
    {
      id: "admin",
      title: "Running the gang",
      blurb: "Publishing the figures, deciding who counts as an admin, " +
        "and what the site does on its very first day.",
      stops: [
        {
          scenario: "admin",
          key: true,
          press: "run",
          scroll: "publish-card",
          title: "One surface for the gang's controls",
          narration: "Publishing a fresh set of figures is one press, " +
            "and what goes out carries no names and no rows - only the " +
            "totals the charts draw.",
        },
        {
          scenario: "admin",
          scroll: "membership-admin",
          title: "Who is allowed in here",
          /*
           * THE ANCHOR IS THE LIST, NOT THE CARD AROUND IT. `scroll`
           * aligns the TOP of what it names, and this card carries an
           * add-a-member form - two fields, a pair of radios and a
           * button - before the list starts 568 px down it. Naming the
           * card therefore fills the frame with an empty form and puts
           * every element this sentence points at below the fold; the
           * demo frame is 544 px tall at a 1280x800 window, and the
           * stop is behind glass, so a viewer cannot go and look.
           *
           * The rows that grant nothing are a screen further down that
           * same card, which is why the sentence states the guard's
           * rule rather than naming them. The free stop at the end of
           * this walk is where they can be pressed.
           */
          narration: "The list of people who hold admin, kept where it " +
            "can be read and changed. The last admin row cannot be " +
            "removed - but the guard counts rows, not grants, so a row " +
            "that grants nobody satisfies it and the admins on this " +
            "list can all still come off. What keeps the gang from " +
            "being locked out is the line under it: one admin is " +
            "granted by a setting the server holds and by no row here.",
        },
        {
          scenario: "config-fallback",
          open: "charts.html",
          title: "The first day, before anyone has written anything",
          narration: "A brand-new binder has no words written into it " +
            "yet, and this is what it shows: the words every page ships " +
            "with, standing in until somebody writes their own. The " +
            "first run is an ordinary day, not an error. Editing them " +
            "from the admin panel is still being built.",
        },
        {
          scenario: "admin",
          title: "It closes itself if you walk away",
          narration: "This page holds everybody's numbers open, so it " +
            "watches the clock: two minutes' warning, and after ten " +
            "minutes with nobody touching it, it signs itself out and " +
            "throws away what it had decrypted. The console has been " +
            "keeping this page awake while we talked. From the next " +
            "stop it stops, and the clock is the real one.",
        },
        {
          scenario: "admin",
          key: true,
          press: "run",
          scroll: "publish-card",
          free: true,
          title: "Now you try",
          narration: "Publish a set of figures, then open Muse's charts " +
            "and find them drawn. Add somebody to the admin list and " +
            "watch the panel read the list back rather than trusting " +
            "what it just sent.",
        },
      ],
    },
    {
      id: "refuses",
      title: "What the binder will not hand over",
      blurb: "Two refusals, and both of them are the promise being " +
        "kept rather than something going wrong.",
      stops: [
        {
          scenario: "revoked",
          title: "Signed out somewhere else",
          narration: "You signed out on your phone, and this tab still " +
            "holds what looks like a valid pass. It is not: the first " +
            "thing this page asks for comes back refused and you land " +
            "at sign-in. A pass copied before you signed out opens " +
            "nothing afterwards.",
        },
        {
          scenario: "suppressed",
          title: "Too few people to show",
          narration: "The same charts, on a week when hardly anyone " +
            "weighed in. Cells are missing, and that is the point - " +
            "with few enough people a total stops being everybody and " +
            "starts being somebody. The binder holds those back rather " +
            "than pointing at a person.",
        },
        {
          scenario: "suppressed",
          free: true,
          title: "Now you try",
          narration: "Go looking for the gaps. Every one of them is a " +
            "figure the binder could have drawn and decided not to.",
        },
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
  /* Where the frame really is.                                        */
  /* ---------------------------------------------------------------- */

  /*
   * What the console should say, given the address the FRAME reports.
   *
   * THE ADDRESS IS DERIVED FROM THE FRAME, NEVER FROM THE PRESS, and
   * this function plus the load listener that feeds it are the whole of
   * that. Compute either value from the file the console ASKED for and
   * the console names a page nobody is looking at: the pages in the
   * frame are real, live JavaScript, so an already-signed-in visitor at
   * Sign in is redirected to Your page, a revoked session bounces back
   * to Sign in on load, an auth guard refuses a gated page, and the
   * product's own rail carries somebody anywhere at any time. None of
   * that goes through the console.
   *
   * Pure here for frameStyleFor's reason: the hazard is a readout that
   * disagrees with the screen, and a value dev/demo.test.mjs can assert
   * is the only version of this the suite can hold. The browser half
   * reads a location and assigns.
   *
   * A null href is the frame refusing to be read - a cross-origin
   * location throws rather than answering. The mirror's link edit is
   * what stops the frame ever leaving, so arriving here means something
   * got past it, and the honest answer is to say the frame is gone. The
   * alternative is keeping the last page the console asked for on
   * screen, which is the same lie this function exists to end, told
   * about a blank frame.
   *
   * `inside` and `file` are two facts, not one. 404.html is a real page
   * of the product, reachable in the frame, and no destination: it is
   * inside the demo with none of the four rail buttons current, and
   * lighting one for it would be this lie in a quieter place.
   */
  const FRAME_AWAY =
    "The frame has left the demo - this is not one of its pages.";

  function frameAddressOf(href) {
    const away = { shown: FRAME_AWAY, file: null, inside: false };
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
      return {
        status: 200,
        body: {
          ok: true,
          entries: (meFor(scenario).entries
            ? Array.from({ length: meFor(scenario).entries }, function (_, i) {
              return {
                id: 100 + i,
                receivedAt: new Date(Date.UTC(2026, 6, 1 + i)).toISOString(),
                superseded: false,
                ciphertext: "AmRlbW8tcm93LW5vdC1zZWFsZWQtdG8tYW55LWtleQ==",
              };
            })
            : []),
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
       * This was `state.published || <the corpus this staging carries>`,
       * and `||` reads the null DELETE writes as "nothing staged yet":
       * the press answered 200, the world honestly reported
       * `published: null`, and the very next read handed back the same
       * eighteen entries from six people. Unpublish was
       * indistinguishable from never having pressed it, which is the one
       * thing UAT A10.1 exists to accept.
       *
       * `undefined` is never-touched and `null` is taken-down, and the
       * two survive the trip through this demo's sessionStorage because
       * JSON keeps a null and drops an undefined.
       */
      const published = state.published === undefined
        ? (scenario.id === "suppressed" ? data.sparse : data.rich)
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
       * THE LAST ADMIN ROW DOES NOT COME OFF - and this counts ALL admin
       * rows, malformed ones included, because that is what the shipped
       * Worker counts (the subquery is `WHERE role = 'admin'`, with no
       * grants test). Modelling the fixed version would demonstrate a
       * guard this deployment does not have; the runbook records the
       * narrowing as work for the flip slice, and until then a dud row
       * counting toward "more than one" is the live behavior.
       *
       * Deleting nothing still succeeds, as every other deletion here
       * does: an admin who cannot tell "nothing to remove" from "not
       * allowed" goes looking for a bug that is not there.
       */
      if (role === "admin" && survivors.length !== rows.length &&
          rows.filter((row) => row.role === "admin").length <= 1) {
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
  /* The feed: one line per thing that actually happened.             */
  /* ---------------------------------------------------------------- */

  /*
   * Both halves of the console's feed, pure so dev/demo.test.mjs can
   * drive every line under Node.
   *
   * The lines are computed from what occurred - the staging a press
   * just wrote, the status and body the stubbed Worker just answered -
   * never from a script of what a press should do. A scripted feed
   * would be the false-confidence lie dev/demo.test.mjs's header
   * names, told in the one place built to dispel it.
   *
   * narrate() turns one answer into one line of the driver's language,
   * or into null. Null is load-bearing: every page asks for site copy
   * on load, so narrating that read would bury the press being watched
   * under a line per page view - and a route nobody taught this
   * function stays silent rather than guessing, because a guessed
   * sentence in the feed is a plausible screen with no event under it.
   */
  function narrate(event) {
    const method = String(event.method || "GET").toUpperCase();
    const path = String(event.path || "").split("?")[0];
    const status = event.status;
    const body = event.body || {};

    /*
     * Refusals come first, and they carry the Worker's own words:
     * those words are the product behavior being demonstrated, and a
     * paraphrase would put a second opinion between the driver and the
     * thing they are judging. The 401 arm adds where the page goes,
     * because the bounce to Sign in is all the screen itself shows -
     * and it is one arm for every path, because every gated route
     * refuses a dead session the same way.
     */
    if (status === 401) {
      return "Refused: " + (body.error || "the session is gone.") +
        " Every gated page answers this by returning you to Sign in.";
    }
    if (status >= 400) {
      return "The Worker said no: " +
        (body.error || "status " + status + ".");
    }

    if (path === "/me" && method === "GET") {
      const line = "Your record came back: " + body.entries +
        " entries stand";
      return body.superseded > 0
        ? line + ", with " + body.superseded +
          " corrections resting behind them."
        : line + ".";
    }

    if (path === "/my-entries" && method === "GET") {
      const listed = (body.entries || []).length;
      return "Your own rows came back, still sealed: " + listed +
        " of them, ciphertext the Worker cannot read and this demo has " +
        "no key for. On a real device the page opens the ones that " +
        "browser sealed and names the rest.";
    }

    if (path === "/session" && method === "DELETE") {
      return "Signed out - the Worker deleted the session row, so a " +
        "token captured before this press opens nothing.";
    }

    if (path === "/submit" && method === "POST") {
      return "A weigh-in landed, sealed in the browser before it was " +
        "sent" + (body.id ? " - row " + body.id + " holds it." : ".");
    }

    if (path === "/export" && method === "GET") {
      return "The export rows arrived, still sealed - nothing in " +
        "them opens without the key.";
    }

    if (path === "/snapshot") {
      if (method === "POST") {
        return "A fresh snapshot is published - the charts draw from " +
          "it on their next load.";
      }
      if (method === "DELETE") {
        return "The published snapshot is taken down.";
      }
      return "The published snapshot arrived and the charts drew it.";
    }

    if (path === "/membership" && method === "GET") {
      const rows = Array.isArray(body.membership)
        ? body.membership.length : 0;
      return "The membership list came back: " + rows +
        " rows that grant access.";
    }
    if (path === "/membership" && method === "POST") {
      return "A membership row was written; the pane reads the list " +
        "back rather than trusting what it sent.";
    }
    if (path.indexOf("/membership/") === 0 && method === "DELETE") {
      return "A membership row came off, and the pane reads the " +
        "list back to prove it.";
    }

    if (path === "/content" && method === "POST") {
      return "Site copy saved - every page reads it from here on.";
    }

    return null;
  }

  /*
   * The press's own half: what the staging just did to this tab, told
   * from the staging's fields rather than from a description written
   * beside them.
   *
   * The session line is unconditional because every staging decides
   * what the tab holds, including deciding it holds nothing - and
   * "nothing" is the line a driver most needs said out loud, because
   * a signed-out tab looks exactly like a tab nobody staged.
   *
   * WHICH IS ALSO WHY THIS FUNCTION CANNOT BE HELD TO "IT SAID
   * SOMETHING". That line is there for every scenario, so a length test
   * passes for a staging this function has never heard of, and the
   * staging then lands silent in the feed with the whole gate green.
   * dev/demo.test.mjs holds it two ways instead, and both are worth
   * knowing before adding to SCENARIOS above: a field outside the
   * plumbing set has to change what comes back, proven by taking it
   * away; and the stagings whose whole story IS the session line are
   * named there as literals, so a new one fails until somebody says
   * out loud that it stages nothing a driver can see.
   */
  function stagingStory(scenario) {
    const staged = scenario || {};
    const lines = [];

    lines.push(staged.session
      ? "This tab is signed in as " + staged.session.username +
        (staged.session.isAdmin ? ", who holds admin." : ".")
      : "This tab is not signed in, so the pages treat you as a " +
        "stranger.");

    if (staged.prefill) {
      lines.push("Your last measurements are already saved on this " +
        "device, keyed to your account, so the form arrives filled in.");
    }
    if (staged.revoked) {
      lines.push("The session was signed out somewhere else - the " +
        "next thing this page asks for is refused.");
    }
    if (staged.id === "supersede") {
      lines.push("The record holds a correction: one row is replaced " +
        "rather than added beside.");
    }
    if (staged.id === "suppressed") {
      lines.push("Too few people have weighed in for every chart to " +
        "publish - the held-back cells are the point.");
    }
    if (staged.id === "config-fallback") {
      lines.push("No site copy is written yet, so every page shows " +
        "the words it ships with.");
    }

    return lines;
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
   */
  function publishedFrom(which, deps) {
    const inputs = corpusInputs(which);
    const at = inputs[inputs.length - 1].at - SPACING;
    const before = inputs.filter(function (one) { return one.at <= at; });
    return deps.snapshotOf(entriesOf(inputs, deps), {
      identify: false,
      previous: deps.snapshotOf(
        entriesOf(before, deps), { identify: false }, at),
    });
  }

  root.BinderDemo = Object.freeze({
    DESTINATIONS: DESTINATIONS,
    MIRROR_PATH: MIRROR_PATH,
    VIEWPORTS: VIEWPORTS,
    MIRROR_EDITS: MIRROR_EDITS,
    BOOT_SCRIPTS: BOOT_SCRIPTS,
    TELEGRAM_STANDIN: TELEGRAM_STANDIN,
    CONFIG_STANDIN: CONFIG_STANDIN,
    LOCAL_FILES: LOCAL_FILES,
    STORAGE_KEYS: STORAGE_KEYS,
    EVENT_CHANNEL: EVENT_CHANNEL,
    SCENARIOS: SCENARIOS,
    FEATURES: FEATURES,
    TOURS: TOURS,
    DEV_KEY_FILE: DEV_KEY_FILE,
    KEY_STAGED_LINE: KEY_STAGED_LINE,
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
    frameAddressOf: frameAddressOf,
    destinationUnder: destinationUnder,
    viewportFor: viewportFor,
    frameStyleFor: frameStyleFor,
    scenarioFor: scenarioFor,
    answerFor: answerFor,
    meFor: meFor,
    narrate: narrate,
    stagingStory: stagingStory,
    corpusInputs: corpusInputs,
    entriesFrom: entriesFrom,
    publishedFrom: publishedFrom,
  });
})(globalThis);
