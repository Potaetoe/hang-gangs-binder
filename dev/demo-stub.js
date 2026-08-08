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
  ];

  const BOOT_SCRIPTS =
    '<script src="/dev/demo-stub.js"></script>' +
    '<script src="/dev/demo-boot.js"></script>';

  const TELEGRAM_WIDGET = /https:\/\/telegram\.org\/js\/telegram-widget\.js[^"']*/g;
  const TELEGRAM_STANDIN = "/dev/demo-telegram.js";

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
      .split(TELEGRAM_STANDIN).join("https://telegram.org/js/telegram-widget.js?22");
  }

  /* ---------------------------------------------------------------- */
  /* Which routes the stub has to answer.                             */
  /* ---------------------------------------------------------------- */

  /*
   * Every path the shipped code asks the Worker for, read out of the
   * shipped bytes rather than listed by hand.
   *
   * This is what stops the demo going quietly wrong as PR 4 and PR 5
   * land. A slice that adds a call to a route the stub does not answer
   * would otherwise produce a demo page that fails in a way the owner
   * reads as the product being broken - or worse, one that falls through
   * to the live endpoint. dev/demo.test.mjs runs this over apps/web and
   * fails if anything it finds has no answer here.
   *
   * Two idioms, because the shipped code has two. Most call sites build
   * the URL as `config.endpoint + "/path"`; auth.js holds its two routes
   * in a list and passes one in, so the list is read as well.
   */
  const DIRECT_CALL = /config\.endpoint\s*\+\s*\n?\s*"(\/[^"]*)"/g;
  const AUTH_LIST = /AUTH_PATHS\s*=\s*\[([^\]]*)\]/;
  const QUOTED_PATH = /"(\/[^"]*)"/g;

  function endpointPathsIn(source) {
    const text = String(source);
    const found = [];
    let match;

    DIRECT_CALL.lastIndex = 0;
    while ((match = DIRECT_CALL.exec(text)) !== null) found.push(match[1]);

    const list = AUTH_LIST.exec(text);
    if (list) {
      QUOTED_PATH.lastIndex = 0;
      while ((match = QUOTED_PATH.exec(list[1])) !== null) found.push(match[1]);
    }

    return found.filter(function (path, index) {
      return found.indexOf(path) === index;
    }).sort();
  }

  /*
   * A path the stub knows, with the dynamic tails collapsed. The Worker
   * routes /submission/<id> and /content/<name> by prefix, so the demo
   * matches them the same way rather than pretending the id is part of
   * the route name.
   */
  const ROUTES = [
    "/auth/telegram", "/auth/dev", "/session", "/me", "/submit",
    "/export", "/snapshot", "/content", "/membership",
  ];
  const PREFIX_ROUTES = ["/submission/", "/content/", "/membership/"];

  function routeFor(path) {
    const clean = String(path).split("?")[0];
    if (ROUTES.indexOf(clean) !== -1) return clean;
    for (const prefix of PREFIX_ROUTES) {
      if (clean.indexOf(prefix) === 0) return prefix;
    }
    return null;
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
   * documents stop agreeing.
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
        // The chips are named by the page, not here. #122's own text
        // calls one of them Parchment and the shipped chip says
        // Daylight, and a walk-through that names them would have to be
        // corrected every time one is renamed - the same drift this
        // whole demo is built to avoid.
        "Switch every palette chip in the rail in turn. The wordmark is " +
          "Playfair Display - if it renders as a plain serif the font " +
          "did not load, which is the thing to look for.",
        "There is no rail on Sign in, by decision on #73.",
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
   * dev/demo.test.mjs pins the mechanism - every box has a probe, and
   * every probe names a file that exists - and deliberately does not pin
   * the answers. A gate that failed the day PR 5 landed would be a gate
   * asking the project to stand still.
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
      probe: { file: "apps/web/admin.js", pattern: "/content" },
    },
    {
      id: "dashboard",
      title: "The dashboard payoff: hero, deltas, marquee series",
      probe: { file: "apps/web/dashboard.js", pattern: "lineChart" },
    },
    {
      id: "admin-panel",
      title: "The admin instrument panel reads as the admin surface (#68)",
      probe: { file: "apps/web/admin.html", pattern: "instrument" },
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
    const route = routeFor(request.path);
    const state = world || {};
    const scenario = scenarioFor(state.scenario) || {};
    const data = state.data || {};
    const next = Object.assign({}, state);

    if (route === null) {
      return {
        status: 404,
        body: { error: "The demo has no answer for " + request.path + "." },
        next: next,
      };
    }

    // Every gated route refuses once the row is gone, because that is
    // what revocation is: the token is still well formed and names
    // nothing. Two ways to arrive here - the `revoked` scenario stages it
    // directly, and pressing Sign out in any scenario sets it below,
    // which is what makes #90 drivable rather than described. /content is
    // not gated, and answers either way.
    if (scenario.revoked === true || state.revoked === true) {
      if (route !== "/content") {
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
      return {
        status: 200,
        body: {
          ok: true,
          published_at: state.publishedAt || new Date().toISOString(),
          snapshot: typeof published === "string"
            ? JSON.parse(published) : published,
        },
        next: next,
      };
    }

    if (route === "/content" || route === "/content/") {
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

    if (route === "/membership" || route === "/membership/") {
      return {
        status: 200,
        body: { ok: true, membership: state.membership || [] },
        next: next,
      };
    }

    if (route === "/submission/") {
      return { status: 200, body: { ok: true }, next: next };
    }

    return {
      status: 404,
      body: { error: "The demo has no answer for " + request.path + "." },
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
    MIRROR_EDITS: MIRROR_EDITS,
    BOOT_SCRIPTS: BOOT_SCRIPTS,
    TELEGRAM_STANDIN: TELEGRAM_STANDIN,
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
    endpointPathsIn: endpointPathsIn,
    routeFor: routeFor,
    scenarioFor: scenarioFor,
    answerFor: answerFor,
    meFor: meFor,
    corpusInputs: corpusInputs,
    entriesFrom: entriesFrom,
  });
})(globalThis);
