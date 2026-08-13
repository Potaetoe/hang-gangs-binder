/*
 * Checks for the drivable demo - the toolbar, the stubbed Worker, the
 * mirror and the server behind them.
 *
 *     node dev/demo.test.mjs
 *
 * What can go wrong with a demo is not what goes wrong with a feature.
 * A demo fails by drifting: it keeps showing last month's product while
 * the pages move underneath it, and it fails silently, because a
 * plausible screen is indistinguishable from a current one. Three of the
 * checks here exist for exactly that:
 *
 *   - unmirroring a mirrored page returns the shipped bytes exactly, so
 *     the mirror cannot be quietly editing anything it does not declare;
 *   - every Worker call the shipped code makes has an answer in the stub,
 *     read out of apps/web rather than listed here, so a route PR 4 or
 *     PR 5 adds fails this suite instead of failing the owner's
 *     walk-through;
 *   - apps/web names nothing in dev/, so the demo has not paid for
 *     itself with a hook in the published bytes.
 *
 * The staged corpora are checked against the shipped aggregation for the
 * same reason: "enough people to draw the marquee" is a fact about
 * MIN_CELL, and MIN_CELL lives in dashboard.js.
 *
 * A DEMO LIES IN TWO DIRECTIONS AND ONLY ONE OF THEM LOOKS LIKE A BUG.
 * The escape direction - a request leaving the machine, a read outside
 * apps/web - is what an attacker wants. The false-confidence direction -
 * a control that reports success while nothing happened, a route the
 * stub answers that the real Worker refuses - is what the owner sees
 * while deciding the cutover, and it is the worse of the two because it
 * produces a screen that looks right. Checks below that carry an
 * F-number are the second kind: each one pins a way this suite was
 * observed to stay green while the demo told one of those two lies. A
 * bare F-number is #140's; one prefixed with an issue - `#154 F2` - is
 * that issue's, because two reviews numbering findings from one is how
 * a citation stops naming anything.
 *
 * WHY SO MANY CHECKS ANCHOR ON LITERALS RATHER THAN THE STUB'S OWN
 * CONSTANTS. A check that asserts the emitted HTML contains
 * `Demo.BOOT_SCRIPTS` cannot fail when BOOT_SCRIPTS is what changed -
 * deleting demo-boot.js from that constant left every check here green
 * with fetch never replaced, which is the zero-egress promise dying in
 * silence. Anything that guards a constant is spelled out here instead.
 *
 * THE TOOLBAR IS DRIVEN, NOT READ. dev/demo-toolbar.js is wiring, so a
 * check that its source CONTAINS a word proves nothing; the real file
 * runs under node:vm against a recorded browser and the recording is
 * asked what each control did. Every enabler is driven in both
 * directions - the press that acts, and the press that cannot act and
 * says so - because a control that quietly does nothing is the exact
 * false-confidence failure above.
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { get as httpGet } from "node:http";
import vm from "node:vm";
import { suite } from "./harness.mjs";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));

const load = async (path) => {
  const src = await readFile(HERE(path), "utf8");
  await import("data:text/javascript," + encodeURIComponent(src));
};

await load("../apps/web/form.js");
await load("../apps/web/dashboard.js");
await load("../apps/web/admin.js");
await load("./demo-stub.js");

const Demo = globalThis.BinderDemo;
const Admin = globalThis.BinderAdmin;
const Dashboard = globalThis.BinderDashboard;
const Form = globalThis.BinderForm;

const { start, MIRROR_PREFIX, portFrom } = await import("./demo-server.mjs");

const { check, mustReject, report } = suite("demo", 186);

/* ------------------------------------------------------------------ */
/* What apps/web actually contains, read once.                         */

/*
 * The page list is READ, not written down (F4).
 *
 * Do not replace this with a hand-written list of page names. apps/web
 * ships five pages, and a list that names four leaves the fifth
 * unchecked: an undeclared mirror edit firing only on 404.html passes
 * every round-trip check below without ever being applied to a page any
 * of them looks at. A list maintained by hand beside an enumeration of
 * the same directory is a list that will disagree with it, and the
 * enumeration is the one that cannot.
 */
const webFiles = await readdir(HERE("../apps/web"));
const PAGES = webFiles.filter((name) => name.endsWith(".html")).sort();

const shipped = {};
for (const page of PAGES) {
  shipped[page] = await readFile(HERE("../apps/web/" + page), "utf8");
}

const webSource = {};
for (const name of webFiles) {
  if (!/\.(js|html|css)$/.test(name)) continue;
  webSource[name] = await readFile(HERE("../apps/web/" + name), "utf8");
}

const toolbarJs = await readFile(HERE("./demo-toolbar.js"), "utf8");
const toolbarCss = await readFile(HERE("./demo-toolbar.css"), "utf8");
const bootJs = await readFile(HERE("./demo-boot.js"), "utf8");
const telegramJs = await readFile(HERE("./demo-telegram.js"), "utf8");
const devKeyFile = await readFile(HERE("./test-key.json"), "utf8");

await check("the page list is read from apps/web and finds every page there", () =>
  PAGES.length >= 5 && PAGES.includes("index.html") &&
  PAGES.includes("404.html") && PAGES.includes("admin.html") &&
  PAGES.every((page) => typeof shipped[page] === "string" &&
    shipped[page].length > 0));

/* ------------------------------------------------------------------ */
/* The mirror changes what it says it changes, and nothing else.       */

const STUB_SRC = "/dev/demo-stub.js";
const BOOT_SRC = "/dev/demo-boot.js";
const BAR_SRC = "/dev/demo-toolbar.js";
const BAR_CSS = "/dev/demo-toolbar.css";

/*
 * F1. The literal, not the constant.
 *
 * demo-boot.js is the file that replaces fetch. If it stops being
 * injected, every page in the demo calls the real dev Worker and nothing
 * on screen looks different - so this is pinned by the path that has to
 * appear in the emitted bytes, the same way the Telegram edit is pinned
 * one check below. Order matters too: demo-boot.js throws without
 * demo-stub.js already on the page, so stub has to come first.
 */
await check("the mirror emits both dev script paths, stub before boot", () =>
  PAGES.every((page) => {
    const html = Demo.mirror(shipped[page]).html;
    const stub = html.indexOf(STUB_SRC);
    const boot = html.indexOf(BOOT_SRC);
    return stub !== -1 && boot !== -1 && stub < boot;
  }));

/*
 * And the strip, pinned by its own two paths for the same reason. The
 * toolbar is what the owner presses; a page that quietly lost it would
 * be a product page with no way to stage anything, which reads as the
 * demo having no enablers rather than as an edit having stopped firing.
 */
await check("the mirror emits the toolbar's script and its stylesheet", () =>
  PAGES.every((page) => {
    const html = Demo.mirror(shipped[page]).html;
    return html.includes(BAR_SRC) && html.includes(BAR_CSS) &&
      html.indexOf(BAR_CSS) < html.indexOf(BAR_SRC);
  }));

/*
 * The toolbar loads AFTER the boot pair, and that ordering is a real
 * dependency rather than tidiness: demo-toolbar.js throws without
 * BinderDemoBoot, which demo-boot.js defines.
 */
await check("the toolbar loads after the pair that defines what it uses", () =>
  PAGES.every((page) => {
    const html = Demo.mirror(shipped[page]).html;
    return html.indexOf(BOOT_SRC) < html.indexOf(BAR_SRC);
  }));

await check("the boot constant itself names both dev scripts", () =>
  Demo.BOOT_SCRIPTS.includes(STUB_SRC) &&
  Demo.BOOT_SCRIPTS.includes(BOOT_SRC) &&
  Demo.TOOLBAR_SCRIPTS.includes(BAR_SRC) &&
  Demo.TOOLBAR_SCRIPTS.includes(BAR_CSS));

/*
 * Inserted after the page's own Content-Security-Policy, deliberately: a
 * script above the policy would not be governed by it, and the demo
 * would stop being evidence that the shipped policy permits what the
 * pages do.
 */
await check("the demo's own scripts land after the page's own CSP", () =>
  PAGES.filter((page) => shipped[page].includes("Content-Security-Policy"))
    .every((page) => {
      const html = Demo.mirror(shipped[page]).html;
      return html.indexOf("Content-Security-Policy") < html.indexOf(STUB_SRC);
    }));

await check("the demo's own scripts land before the page's own first script", () =>
  PAGES.map((page) => Demo.mirror(shipped[page]).html)
    .every((html) => {
      const ours = html.indexOf(BAR_SRC);
      const theirs = html.indexOf("<script src=\"config.js\"");
      return ours !== -1 && (theirs === -1 || ours < theirs);
    }));

/*
 * The strip is served from /dev/, and every page's policy has to already
 * permit that - both as a script and as a stylesheet. Asked of the
 * shipped policy rather than assumed, because a page that tightened
 * style-src to a hash would leave the strip unpainted with no error
 * anybody reads.
 */
await check("every page's own policy already allows the demo's own files", () =>
  PAGES.filter((page) => shipped[page].includes("Content-Security-Policy"))
    .every((page) => {
      const policy = /content="([^"]*)"/.exec(
        /Content-Security-Policy" content="([^"]*)"/.exec(shipped[page])[0]
      )[1];
      return /script-src [^;]*'self'/.test(policy) &&
        /style-src [^;]*'self'/.test(policy);
    }));

await check("only the sign-in page carries the Telegram edit", () =>
  PAGES.every((page) => {
    const applied = Demo.mirror(shipped[page]).applied;
    return applied.includes("telegram") === (page === "index.html");
  }));

await check("the mirrored sign-in page loads no third-party script", () => {
  const html = Demo.mirror(shipped["index.html"]).html;
  return !html.includes("telegram.org/js/telegram-widget.js") &&
    html.includes("/dev/demo-telegram.js");
});

await check("unmirroring a mirrored page returns the shipped bytes", () =>
  PAGES.every((page) =>
    Demo.unmirror(Demo.mirror(shipped[page]).html) === shipped[page]));

/*
 * THE SAME QUESTION ASKED FROM OUTSIDE demo-stub.js, BECAUSE THE ROUND
 * TRIP ABOVE CANNOT ANSWER IT.
 *
 * `unmirror(mirror(x)) === x` is computed entirely from the pair it
 * guards, so an edit that mirror() applies and unmirror() undoes passes
 * it however undeclared it is - and so do the count pin and the
 * every-declared-edit-fires arm, which read the same table and the same
 * `applied` list. AGENTS.md's own corollary: a check computed entirely
 * from the file it guards cannot detect that the file was rearranged;
 * something outside the file has to say what it may contain.
 *
 * So this file says it. The four declared edits are written out HERE,
 * from the table's record, and the mirrored page is rebuilt from the
 * shipped bytes without calling mirror() or unmirror() at all. A
 * mirrored page that differs from that rebuild by one byte is an
 * undeclared difference between the demo and the product, which is the
 * one thing this whole design exists to refuse. A `<title>` rewritten on
 * the way out and undone on the way back reds here and nowhere else.
 *
 * It is deliberately a DUPLICATE of the literals in demo-stub.js: the
 * duplication is the mechanism. A path legitimately renamed there is a
 * two-file change on purpose, so the rename is a decision somebody made
 * rather than one that happened.
 */
const OUR_INSERTION =
  '<script src="' + STUB_SRC + '"></script>' +
  '<script src="' + BOOT_SRC + '"></script>' +
  '<link rel="stylesheet" href="' + BAR_CSS + '">' +
  '<script src="' + BAR_SRC + '"></script>';
const OUR_CONFIG_TAG = '<script src="config.js"></script>';
const OUR_CONFIG_STANDIN = '<script src="/dev/demo-config.js"></script>';
const OUR_WIDGET = /https:\/\/telegram\.org\/js\/telegram-widget\.js[^"']*/g;
const OUR_WIDGET_STANDIN = "/dev/demo-telegram.js";

/*
 * Where the demo's own scripts belong, decided here rather than asked of
 * the mirror: before the page's first script that a browser would
 * actually run. A "<script" whose nearest preceding "<!--" has no "-->"
 * between them is inside a comment and is not that script.
 */
function ourSeamIn(html) {
  let from = 0;
  for (;;) {
    const at = html.indexOf("<script", from);
    if (at === -1) return -1;
    const opened = html.lastIndexOf("<!--", at);
    if (opened === -1) return at;
    const closed = html.indexOf("-->", opened);
    if (closed !== -1 && closed < at) return at;
    from = at + "<script".length;
  }
}

function ourMirrorOf(html) {
  let out = String(html);
  const at = ourSeamIn(out);
  if (at !== -1) out = out.slice(0, at) + OUR_INSERTION + out.slice(at);
  OUR_WIDGET.lastIndex = 0;
  out = out.replace(OUR_WIDGET, OUR_WIDGET_STANDIN);
  OUR_WIDGET.lastIndex = 0;
  return out.split(OUR_CONFIG_TAG).join(OUR_CONFIG_STANDIN);
}

await check("a mirrored page is the shipped bytes plus the four declared edits, byte for byte", () =>
  PAGES.every((page) =>
    Demo.mirror(shipped[page]).html === ourMirrorOf(shipped[page])));

/*
 * And the seam is the first script the BROWSER runs, not the first one
 * the file spells. A script commented out ahead of the page's own -
 * parked work, an ordinary thing to find in a head - would otherwise
 * take the boot pair and the strip into the comment with it: fetch
 * untouched, no strip, and every arm still green, because the policy
 * still precedes the insertion and unmirror() removes the literal
 * wherever it sits.
 *
 * Driven against a page written here rather than asked of apps/web,
 * because no shipped page carries one today - which is exactly why an
 * arm keyed on the shipped bytes would prove nothing.
 */
await check("a script commented out ahead of the page's own does not swallow the demo's", () => {
  const page = "<head>" +
    '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'">' +
    "<!-- parked while the palette work lands:\n" +
    '<script src="theme-probe.js"></script>\n-->\n' +
    OUR_CONFIG_TAG + "</head><body></body>";
  const out = Demo.mirror(page);
  const closed = out.html.indexOf("-->");
  return closed !== -1 &&
    out.html.indexOf(STUB_SRC) > closed &&
    out.html.indexOf(BAR_SRC) > closed &&
    out.html.indexOf(BAR_SRC) < out.html.indexOf(OUR_CONFIG_STANDIN) &&
    out.html.includes('<script src="theme-probe.js"></script>\n-->') &&
    out.applied.includes("boot") && out.applied.includes("toolbar") &&
    Demo.unmirror(out.html) === page;
});

/*
 * Every declared edit is one that really fires somewhere, and the count
 * is spelled out rather than compared to the table: an arm that asked
 * the table about itself would hold just as well for three edits or for
 * five, so an edit added without anybody deciding to add one would pass
 * it. What differs from the product is exactly the thing that cannot be
 * allowed to grow quietly.
 */
await check("the mirror declares exactly four edits, and they are these four", () => {
  const ids = Demo.MIRROR_EDITS.map((one) => one.id).sort();
  return ids.length === 4 &&
    ids.join(",") === "boot,config,telegram,toolbar" &&
    Demo.MIRROR_EDITS.every((one) =>
      typeof one.what === "string" && one.what.length > 10 &&
      typeof one.why === "string" && one.why.length > 40);
});

await check("every declared edit is one the mirror actually applies", () => {
  const applied = new Set();
  PAGES.forEach((page) =>
    Demo.mirror(shipped[page]).applied.forEach((id) => applied.add(id)));
  return Demo.MIRROR_EDITS.every((one) => applied.has(one.id));
});

await check("the config edit points every page that loads config.js at the stand-in", () =>
  PAGES.filter((page) => shipped[page].includes('<script src="config.js">'))
    .every((page) => {
      const html = Demo.mirror(shipped[page]).html;
      return html.includes(Demo.CONFIG_STANDIN) &&
        !html.includes('<script src="config.js">');
    }));

await check("a page that loads no config.js gets no config edit", () =>
  PAGES.filter((page) => !shipped[page].includes('<script src="config.js">'))
    .every((page) => !Demo.mirror(shipped[page]).applied.includes("config")));

/*
 * THE MIRROR TOUCHES NO ANCHOR AT ALL, AND THIS IS WHAT HOLDS THAT.
 * Why anchors are left alone is stated in dev/demo-stub.js, beside the
 * mirror itself.
 *
 * Driven against a page written here rather than asked of apps/web,
 * deliberately: no shipped page carries an anchor that leaves, so an arm
 * keyed on the shipped bytes would pass by having nothing to look at -
 * which is the failure this retirement exists to remove, reintroduced
 * one level up.
 */
await check("an anchor that leaves the product comes back exactly as written", () => {
  const page = '<head><script src="config.js"></script></head>' +
    '<body><a href="https://example.invalid/source">Read the code</a></body>';
  const out = Demo.mirror(page);
  return out.html.includes('<a href="https://example.invalid/source">') &&
    !/target="_blank"/.test(out.html) &&
    !/rel="noopener/.test(out.html) &&
    out.applied.indexOf("links") === -1;
});

/*
 * And the product's own anchors survive, asked of the shipped bytes.
 * Moving around the site is half of what there is to see, and the round
 * trip above this cannot catch a mirror that rewrites an anchor and
 * undoes it again - an exactly-inverted pair passes it. The pages are
 * filtered rather than named, so a page losing its last in-page link is
 * not a failure, but every page losing them all is: this arm is not
 * allowed to end up with nothing to check.
 */
await check("every in-page link the product writes survives mirroring untouched", () => {
  const seen = [];
  const held = PAGES.every((page) => {
    const anchors =
      shipped[page].match(/<a [^>]*href="(?!https?:)[^"]*"[^>]*>/g) || [];
    anchors.forEach((tag) => seen.push(tag));
    const html = Demo.mirror(shipped[page]).html;
    return anchors.every((tag) => html.includes(tag));
  });
  return seen.length > 0 && held;
});

/* ------------------------------------------------------------------ */
/* apps/web has paid nothing for the demo.                             */

await check("nothing in apps/web names the demo", () =>
  Object.values(webSource).every((src) =>
    !src.includes("demo-boot") && !src.includes("demo-stub") &&
    !src.includes("demo-toolbar") &&
    !src.includes("BinderDemo") && !src.includes("/dev/")));

/*
 * F4, second half. The scan above is a handful of literal names, and a
 * hook does not have to use any of them: a shipped page keyed on the
 * demo's own sessionStorage name would read the staged identity and pass
 * that list untouched. The key names are asked of the demo rather than
 * typed here, so renaming one cannot quietly empty this check.
 */
await check("no shipped file is keyed on the demo's own storage names", () =>
  Demo.STORAGE_KEYS.length > 0 &&
  Demo.STORAGE_KEYS.every((key) =>
    Object.values(webSource).every((src) => !src.includes(key))));

/*
 * And the same question about the toolbar's own door. demo-boot.js hands
 * the strip an untouched fetch on a global; a shipped page that named it
 * would be a published page able to read a private key off its own host,
 * which is the one thing this demo's whole file-allowlist design exists
 * to refuse.
 */
await check("no shipped file names the toolbar's own reader", () =>
  bootJs.includes("BinderDemoBoot") &&
  Object.values(webSource).every((src) => !src.includes("BinderDemoBoot")));

/* ------------------------------------------------------------------ */
/* The stub answers every call the shipped code makes - verb included.  */

/*
 * F3. The stub routed by path; the Worker routes by path AND method.
 *
 * GET /session answered 200 and set revoked=true where the Worker 404s,
 * so flipping signout.js's DELETE to POST - a real regression, refused
 * by the live Worker - left this suite green and the demo still showing
 * revocation working. The reader below carries the verb off the call
 * site, and every check downstream compares pairs rather than paths.
 */
const calls = [];
for (const [name, src] of Object.entries(webSource)) {
  if (!name.endsWith(".js")) continue;
  Demo.endpointCallsIn(src).forEach((one) => {
    const seen = calls.some((was) =>
      was.method === one.method && was.path === one.path);
    if (!seen) calls.push(one);
  });
}
const callsHas = (method, path) =>
  calls.some((one) => one.method === method && one.path === path);

/*
 * A reader that finds nothing is indistinguishable from a codebase that
 * calls nothing, and it would make the checks below pass vacuously
 * forever. So the extractor is asserted to work before its output is
 * trusted - the same shape as check_web.py's parser having a suite.
 */
await check("the endpoint reader finds the calls that are plainly there", () =>
  callsHas("GET", "/me") && callsHas("GET", "/my-entries") &&
  callsHas("POST", "/submit") &&
  callsHas("GET", "/snapshot") && callsHas("GET", "/export") &&
  callsHas("POST", "/auth/telegram") && callsHas("POST", "/auth/dev"));

/*
 * The verb arm stated separately from the path arm, because the failure
 * this pins is a call whose PATH is still right. DELETE /session is
 * #90's whole behavior; DELETE /snapshot and POST /snapshot are the same
 * route with opposite meanings.
 */
await check("the endpoint reader carries the verb each call uses", () =>
  callsHas("DELETE", "/session") && !callsHas("GET", "/session") &&
  callsHas("POST", "/snapshot") && callsHas("DELETE", "/snapshot") &&
  callsHas("DELETE", "/submission/"));

/*
 * #154 F2. THE READER SEES ONE WAY OF SPELLING A CALL, SO THAT IS THE
 * ONLY WAY apps/web MAY SPELL ONE.
 *
 * Everything above this line is the stub being held to what apps/web
 * calls - and every one of those checks is only as wide as the idiom
 * `config.endpoint + "/path"` that CALL_SITE matches. A call written
 * any other way is not a call the reader disagrees about; it is a call
 * the reader cannot see at all, so the coverage arms pass over it and
 * the route reaches the demo unanswered, which is a 404 in front of the
 * owner and a green gate behind it.
 */
const ENDPOINT_USE = /\.\s*endpoint\b/g;
const READER_SEES = /^\s*(?:\+\s*(?:"|[A-Za-z_$])|[)|&,;])/;

await check("every endpoint call in apps/web is spelled the way the reader reads", () => {
  let seen = 0;
  for (const [name, src] of Object.entries(webSource)) {
    if (!name.endsWith(".js")) continue;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    ENDPOINT_USE.lastIndex = 0;
    let use;
    while ((use = ENDPOINT_USE.exec(code)) !== null) {
      seen += 1;
      if (!READER_SEES.test(code.slice(use.index + use[0].length))) return false;
    }
  }
  // A pattern that matches nothing passes this arm the way it passes
  // every arm downstream of the reader, and for the same reason.
  return seen >= 15;
});

await check("the stub answers every call apps/web makes, by verb and path", () =>
  calls.every((one) => Demo.routeFor(one.path, one.method) !== null));

await check("a route the stub does not know is refused, not passed on", () =>
  Demo.routeFor("/something-new", "GET") === null &&
  Demo.answerFor({ method: "GET", path: "/something-new" }, {}).status === 404);

/*
 * The direct mutation-catcher for F3. The Worker has DELETE /session and
 * nothing else on that path; a stub that answered GET there was inventing
 * a route, and inventing it in the direction that makes a broken demo
 * look like a working one.
 */
await check("a known path with the wrong verb is a 404, as the Worker answers it", () =>
  Demo.routeFor("/session", "GET") === null &&
  Demo.answerFor({ method: "GET", path: "/session" }, world("member")).status === 404 &&
  Demo.routeFor("/me", "POST") === null &&
  Demo.routeFor("/submit", "GET") === null);

/*
 * And the corollary AGENTS.md's review bar states: a check computed
 * entirely from the file it guards cannot detect that the file was
 * rearranged. What the stub may claim is decided by server/worker.js's
 * dispatch, read here.
 */
const workerSource = await readFile(HERE("../server/worker.js"), "utf8");
const workerRoutes = new Set();
const WORKER_ROUTE = /method === "([A-Z]+)" && path === "(\/[^"]*)"/g;
let workerMatch;
while ((workerMatch = WORKER_ROUTE.exec(workerSource)) !== null) {
  workerRoutes.add(workerMatch[1] + " " + workerMatch[2]);
}

await check("the Worker's dispatch is readable, and it is what the stub is held to", () =>
  workerRoutes.size >= 12 && workerRoutes.has("DELETE /session") &&
  workerRoutes.has("GET /me"));

await check("the stub claims no verb the Worker does not route", () =>
  Demo.ROUTES.every((route) =>
    route.methods.every((method) =>
      workerRoutes.has(method + " " + route.path))));

/* ------------------------------------------------------------------ */
/* The answers themselves.                                             */

function world(who, extra) {
  return Object.assign({ signedInAs: who, data: {} }, extra);
}

const ask = (method, path, state, body) =>
  Demo.answerFor({ method: method, path: path, body: body }, state);

await check("/me reports four effective entries and no tombstones", () => {
  const answer = ask("GET", "/me", world("member"));
  return answer.status === 200 && answer.body.entries === 4 &&
    answer.body.superseded === 0 && answer.body.isAdmin === false;
});

await check("the corrections seed moves the tombstones, not the count", () => {
  const plain = ask("GET", "/me", world("member")).body;
  const seeded = ask("GET", "/me", world("member", { corrections: true })).body;
  return seeded.entries === plain.entries && seeded.superseded === 2 &&
    plain.superseded === 0;
});

/*
 * The listing and the panel are one model. A listing that answered the
 * effective count would let the two disagree about how many times this
 * member has written, with nothing on screen to say which is right.
 */
await check("the listing carries a row per tombstone, marked", () => {
  const rows = ask("GET", "/my-entries",
    world("member", { corrections: true })).body.entries;
  return rows.length === 6 &&
    rows.filter((row) => row.superseded === true).length === 2;
});

await check("with no corrections seeded every row is a live one", () => {
  const rows = ask("GET", "/my-entries", world("member")).body.entries;
  return rows.length === 4 &&
    rows.every((row) => row.superseded === false);
});

await check("the member's account id is the shape submit.js scopes by", () =>
  /^[0-9a-f]{64}$/.test(ask("GET", "/me", world("member")).body.accountId));

await check("two identities are two account ids", () =>
  ask("GET", "/me", world("member")).body.accountId !==
  ask("GET", "/me", world("keyholder")).body.accountId);

await check("an admin identity is reported as one, and a member is not", () =>
  ask("GET", "/me", world("keyholder")).body.isAdmin === true &&
  ask("GET", "/me", world("admin")).body.isAdmin === true &&
  ask("GET", "/me", world("member")).body.isAdmin === false);

await check("a revoked session is refused on every gated route", () => {
  const state = world("member", { revoked: true });
  return ["/me", "/my-entries", "/snapshot", "/export"].every((path) =>
    ask("GET", path, state).status === 401);
});

await check("site copy answers even a caller with no session", () =>
  ask("GET", "/content", world("member", { revoked: true })).status === 200 &&
  ask("POST", "/content", world("member", { revoked: true }),
    { name: "x", value: "y" }).status === 401);

await check("signing out revokes, and the next request is refused", () => {
  const out = ask("DELETE", "/session", world("member"));
  return out.status === 200 && out.next.revoked === true &&
    ask("GET", "/me", out.next).status === 401;
});

/*
 * And signing back in is a live credential again. A demo that left the
 * tab refusing after a sign-out would make Sign out a one-way door, and
 * the driver would read the product as broken.
 */
await check("signing in again clears the refusal", () => {
  const out = ask("DELETE", "/session", world("member"));
  const back = ask("POST", "/auth/telegram", out.next,
    { id: Demo.MEMBER_TELEGRAM_ID });
  return back.status === 200 && back.next.revoked === false &&
    ask("GET", "/me", back.next).status === 200;
});

await check("an unset content document is {} and a 200", () => {
  const answer = ask("GET", "/content", world("keyholder"));
  return answer.status === 200 &&
    Object.keys(answer.body.content).length === 0;
});

await check("a written content name reads back", () => {
  const written = ask("POST", "/content", world("keyholder"),
    { name: "hero", value: "Hello" });
  return ask("GET", "/content", written.next).body.content.hero === "Hello";
});

/* ------------------------------------------------------------------ */
/* Publishing, and the takedown that is not the same as never.         */

const CORPUS = { rich: {}, sparse: {} };
const deps = {
  buildRecord: Form.buildRecord,
  entryFor: Admin.entryFor,
  snapshotOf: Dashboard.snapshotOf,
};
CORPUS.rich = Demo.publishedFrom("rich", deps);
CORPUS.sparse = Demo.publishedFrom("sparse", deps);
// Taken beside the documents rather than when the arm runs: corpusInputs
// stamps from the clock, so a list read a second later is a second later.
const RICH_ROUNDS = Demo.corpusInputs("rich").map((one) => one.at);

const stagedWorld = (document) =>
  world("keyholder", { data: { staged: document, at: "2026-08-01T00:00:00Z" } });

await check("publishing a snapshot makes it the one that reads back", () => {
  const put = ask("POST", "/snapshot", stagedWorld(CORPUS.rich),
    { counts: { entries: 3 } });
  const read = ask("GET", "/snapshot", put.next);
  return put.status === 200 && read.status === 200 &&
    read.body.snapshot.counts.entries === 3;
});

/*
 * THE ARM THAT COST THE MOST. `state.published || <the staged corpus>`
 * reads the null a DELETE writes as "nothing staged yet", so unpublish
 * answers 200, the world honestly reports null, and the very next read
 * hands the same entries back. Unpublish is then indistinguishable from
 * never having pressed it.
 */
await check("taking the snapshot down leaves nothing published", () => {
  const gone = ask("DELETE", "/snapshot", stagedWorld(CORPUS.rich));
  const read = ask("GET", "/snapshot", gone.next);
  return gone.status === 200 && gone.next.published === null &&
    read.status === 404;
});

await check("a world nobody has taken down still draws the staged corpus", () => {
  const read = ask("GET", "/snapshot", stagedWorld(CORPUS.rich));
  return read.status === 200 &&
    read.body.snapshot.counts.entries === CORPUS.rich.counts.entries;
});

await check("a takedown is a takedown in the thin staging too", () => {
  const gone = ask("DELETE", "/snapshot", stagedWorld(CORPUS.sparse));
  return ask("GET", "/snapshot", gone.next).status === 404;
});

/*
 * And the refusal is the WORKER's, word for word. server/worker.js
 * deletes the row and then finds no row, so the live product cannot tell
 * these two apart either - a stub with a sentence of its own here would
 * be demonstrating a Worker that does not exist.
 */
await check("the refusal after a takedown is the Worker's own sentence", () => {
  const gone = ask("DELETE", "/snapshot", stagedWorld(CORPUS.rich));
  const said = ask("GET", "/snapshot", gone.next).body.error;
  return workerSource.includes(said);
});

await check("a binder nobody has staged anything in is empty, not stubbed", () =>
  ask("GET", "/snapshot", world("member")).status === 404);

await check("a poisoned published snapshot is a stated error, not a throw", () => {
  const answer = ask("GET", "/snapshot",
    world("keyholder", { published: "{not json" }));
  return answer.status === 500 && /JSON/.test(answer.body.error);
});

/* ------------------------------------------------------------------ */
/* The membership table.                                               */

await check("granting rows and duds go back in separate lists", () => {
  const answer = ask("GET", "/membership", world("keyholder"));
  return answer.body.membership.every((row) =>
    /^[0-9a-f]{64}$/.test(row.account_id)) &&
    answer.body.malformed.length === 1;
});

await check("secretOnly names an admin no granting row covers", () =>
  ask("GET", "/membership", world("keyholder")).body.secretOnly.length === 1);

await check("adding an id relabels rather than duplicating it", () => {
  const first = ask("POST", "/membership", world("keyholder"),
    { telegramId: "12345", role: "admin", label: "One" });
  const again = ask("POST", "/membership", first.next,
    { telegramId: "12345", role: "admin", label: "Two" });
  const rows = ask("GET", "/membership", again.next).body.membership
    .filter((row) => row.label === "Two");
  return rows.length === 1;
});

await check("an add the Worker would refuse is refused here too", () =>
  ask("POST", "/membership", world("keyholder"),
    { telegramId: "no", role: "admin", label: "x" }).status === 400 &&
  ask("POST", "/membership", world("keyholder"),
    { telegramId: "1", role: "wizard", label: "x" }).status === 400 &&
  ask("POST", "/membership", world("keyholder"),
    { telegramId: "1", role: "admin", label: "" }).status === 400);

/*
 * THE GUARD COUNTS GRANTS, NOT ROWS (#259). The Worker's subquery spells
 * grantsAnything() in SQL, so a row whose account id is not sixty-four
 * lowercase hex characters neither holds the list open nor is held in
 * it. Counting every `admin` row would demonstrate a guard the
 * deployment does not have.
 */
await check("the last admin row does not come off", () => {
  const rows = ask("GET", "/membership", world("keyholder")).body.membership
    .filter((row) => row.role === "admin");
  let state = world("keyholder");
  const gone = ask("DELETE", "/membership/admin/" + rows[0].account_id, state);
  state = gone.next;
  const last = ask("DELETE", "/membership/admin/" + rows[1].account_id, state);
  return gone.status === 200 && last.status === 409 &&
    /last admin/.test(last.body.error);
});

await check("while the row that grants nobody is the one it lets go", () => {
  const dud = ask("GET", "/membership", world("keyholder")).body.malformed[0];
  const gone = ask("DELETE",
    "/membership/admin/" + dud.account_id.toLowerCase(), world("keyholder"));
  return gone.status === 200;
});

await check("removing nothing still succeeds", () =>
  ask("DELETE", "/membership/admin/" + "0".repeat(64),
    world("keyholder")).status === 200);

await check("a role that is not a role is the same 404 as a bad id", () =>
  ask("DELETE", "/membership/wizard/" + "0".repeat(64),
    world("keyholder")).status === 404 &&
  ask("DELETE", "/membership/admin/nope", world("keyholder")).status === 404);

await check("the export rows come from the committed sample, by path", () => {
  const answer = ask("GET", "/export", world("keyholder"));
  return answer.status === 200 &&
    answer.proxy === "/dev/sample-submissions.json";
});

/* ------------------------------------------------------------------ */
/* Who the demo can be.                                                */

await check("an unknown identity refuses, and names it", () => {
  const answer = ask("GET", "/me", world("nobody-by-that-name"));
  return answer.status === 500 &&
    answer.body.error.includes("nobody-by-that-name");
});

await check("a staged identity still answers, so the refusal is not blanket", () =>
  ask("GET", "/me", world("member")).status === 200 &&
  ask("GET", "/me", world(null)).status === 200);

await check("every identity has an id, a label, a handle and a landing page", () =>
  Demo.SIGN_INS.length >= 3 &&
  Demo.SIGN_INS.every((one) =>
    typeof one.id === "string" && one.id.length > 0 &&
    typeof one.label === "string" && one.label.length > 0 &&
    typeof one.what === "string" && one.what.length > 10 &&
    /^[0-9]{1,20}$/.test(one.telegramId) &&
    PAGES.includes(one.lands)));

await check("no two identities share an id, a handle or a Telegram id", () => {
  const field = (name) => new Set(Demo.SIGN_INS.map((one) => one[name]));
  return field("id").size === Demo.SIGN_INS.length &&
    field("handle").size === Demo.SIGN_INS.length &&
    field("telegramId").size === Demo.SIGN_INS.length;
});

/*
 * The picker's three named roles are the ones the owner ruled, and two
 * of them have to be REAL admins in the seeded table - otherwise "sign
 * in as the keyholder" lands on a page that refuses, and the driver
 * reads the demo as broken.
 */
await check("the member, the keyholder and a second admin are all offered", () =>
  Demo.signInFor("member") !== null && Demo.signInFor("keyholder") !== null &&
  Demo.signInFor("admin") !== null &&
  Demo.signInFor("member").isAdmin === false &&
  Demo.signInFor("keyholder").isAdmin === true &&
  Demo.signInFor("admin").isAdmin === true);

await check("every admin identity is a granting row in the seeded table", () => {
  const table = ask("GET", "/membership", world("keyholder")).body.membership
    .filter((row) => row.role === "admin").map((row) => row.account_id);
  return Demo.SIGN_INS.filter((one) => one.isAdmin === true).every((one) =>
    table.includes(Demo.accountIdFor(one.handle)));
});

await check("no member identity is a granting row", () => {
  const table = ask("GET", "/membership", world("keyholder")).body.membership
    .map((row) => row.account_id);
  return Demo.SIGN_INS.filter((one) => one.isAdmin !== true).every((one) =>
    !table.includes(Demo.accountIdFor(one.handle)));
});

await check("some identities are people the staged corpus really holds", () => {
  const handles = new Set(Demo.corpusInputs("rich").map((one) => one.handle));
  const staged = Demo.SIGN_INS.filter((one) => one.staged === true);
  return staged.length >= 2 &&
    staged.every((one) => handles.has(one.handle));
});

/*
 * The sign-in route answers from the POSTED payload. A stub that
 * answered from its own memory would hand back the last identity
 * anybody chose whatever the page sent, which is a sign-in that cannot
 * fail - and the picker would be theatre.
 */
await check("the sign-in route answers as whoever the page posted", () =>
  Demo.SIGN_INS.every((one) => {
    const answer = ask("POST", "/auth/telegram", world(null),
      { id: one.telegramId });
    return answer.status === 200 && answer.body.username === one.handle &&
      answer.body.isAdmin === (one.isAdmin === true) &&
      answer.next.signedInAs === one.id;
  }));

await check("a stranger signs in as an ordinary member, as the Worker allows", () => {
  const answer = ask("POST", "/auth/telegram", world(null), { id: "999999" });
  return answer.status === 200 && answer.body.isAdmin === false &&
    answer.body.telegramId === "999999";
});

await check("the development route answers a null Telegram id", () => {
  const answer = ask("POST", "/auth/dev", world(null), {});
  return answer.status === 200 && answer.body.telegramId === null &&
    answer.body.isDev === true;
});

await check("a lookup by Telegram id finds the identity and refuses a stranger", () =>
  Demo.signInForTelegramId(Demo.MEMBER_TELEGRAM_ID).id === "member" &&
  Demo.signInForTelegramId("999999") === null &&
  Demo.signInForTelegramId(undefined) === null);

await check("a demo session is the shape session.js accepts", () =>
  Demo.SIGN_INS.every((one) => {
    const session = Demo.sessionFor(one);
    return session.ok === true && typeof session.session === "string" &&
      !Number.isNaN(Date.parse(session.expiresAt)) &&
      typeof session.username === "string" &&
      typeof session.isAdmin === "boolean";
  }));

/* ------------------------------------------------------------------ */
/* The toolbar's own tables.                                           */

await check("the strip says what it is and that nothing here is real", () =>
  Demo.TOOLBAR.title.length > 0 && Demo.TOOLBAR.honesty.length > 0 &&
  Demo.TOOLBAR.honesty.split(/\s+/).length <= 6 &&
  /not real|nothing.*real/i.test(Demo.TOOLBAR.honesty));

await check("every enabler has an id, a group, a label and a reason", () =>
  Demo.ENABLERS.length >= 6 &&
  Demo.ENABLERS.every((one) =>
    typeof one.id === "string" && typeof one.group === "string" &&
    typeof one.label === "string" && one.label.length > 0 &&
    typeof one.what === "string" && one.what.length > 20));

await check("no two enablers share an id or a label", () => {
  const ids = new Set(Demo.ENABLERS.map((one) => one.id));
  const labels = new Set(Demo.ENABLERS.map((one) => one.label));
  return ids.size === Demo.ENABLERS.length &&
    labels.size === Demo.ENABLERS.length;
});

/*
 * The owner's ruling, as an arm: only what a visitor could not produce
 * for themselves. Navigating between pages is the case that keeps it
 * honest - the product ships a rail, and a demo that re-implements it is
 * a demo showing its own navigation working.
 */
await check("the strip offers no control the product already gives a visitor", () =>
  Demo.ENABLERS.every((one) =>
    !/^(go|open|visit|navigate)\b/i.test(one.label)) &&
  !Demo.ENABLERS.some((one) => one.id === "sign-out"));

await check("every key box names a page apps/web ships and a real key file", () =>
  Demo.KEY_BOXES.length >= 1 &&
  Demo.KEY_BOXES.every((one) =>
    PAGES.includes(one.page) &&
    shipped[one.page].includes('id="' + one.box + '"') &&
    Demo.TOOLBAR_FILES.includes(one.key)));

/*
 * And no page apps/web ships carries a paste box the table has
 * forgotten - the direction that leaves a control silently doing nothing
 * on a page where it plainly should work.
 */
await check("no page carries a key box the table does not name", () => {
  const named = new Set(Demo.KEY_BOXES.map((one) => one.page));
  return PAGES.filter((page) => /id="keyfile"/.test(shipped[page]))
    .every((page) => named.has(page));
});

await check("a page with no key box is answered with null", () =>
  Demo.keyBoxFor("charts.html") === null &&
  Demo.keyBoxFor(null) === null &&
  Demo.keyBoxFor("admin.html") !== null);

await check("every snapshot row is a corpus this file really builds", () =>
  Demo.PRESETS.length === 3 &&
  Demo.PRESETS.every((one) =>
    one.corpus === null || Demo.corpusInputs(one.corpus).length > 0));

/*
 * The counts are READ off the corpus, never written on the control. A
 * label carrying its own copy of "eighteen from six" is a label free to
 * disagree with the charts underneath it, which is the demo lying with
 * every one of its own checks green.
 */
await check("no snapshot row writes its own counts into its words", () =>
  Demo.PRESETS.every((one) =>
    !/\d/.test(one.label) && !/\b(18|six|eighteen|three)\b/i.test(one.label)));

await check("the counts come out of the corpus, and the two rows differ", () => {
  const full = Demo.countsFor("rich", null);
  const thin = Demo.countsFor("sparse", null);
  return full.entries === Demo.corpusInputs("rich").length &&
    thin.people < full.people && Demo.countsFor(null, 0).entries === 0;
});

await check("a cut takes fewer entries and the same people", () => {
  const one = Demo.countsFor("rich", 1);
  const all = Demo.countsFor("rich", null);
  return one.entries < all.entries && one.people === all.people &&
    one.rounds === 1 && one.of === all.of;
});

await check("the clock steps are the warning and the expiry, in that order", () =>
  Demo.CLOCK_STEPS.length === 2 &&
  Demo.CLOCK_STEPS[0].id === "warning" && Demo.CLOCK_STEPS[1].id === "expiry");

/*
 * The jump is computed from the window the PAGE measures, so the two
 * cannot drift. Driven against admin.js's own frozen constant, and the
 * verdict asked of admin.js's own function - a demo with an opinion
 * about either would jump to a warning the page has stopped showing.
 */
await check("the warning jump lands inside the page's own warning band", () => {
  const by = Demo.clockJumpFor("warning", Admin.IDLE_WINDOW);
  const verdict = Admin.idleVerdict(0, by);
  return verdict.state === "warning";
});

await check("the expiry jump lands past the page's own limit", () => {
  const by = Demo.clockJumpFor("expiry", Admin.IDLE_WINDOW);
  return Admin.idleVerdict(0, by).state === "expired";
});

/*
 * AND IT TRACKS A WINDOW IT HAS NEVER SEEN, which is the arm that makes
 * the two above mean something. Every number that lands in today's band
 * satisfies them, including a constant typed into the demo - so the
 * jump is driven against a window nobody has ever shipped, and only a
 * value computed from the argument can land in it. Found by mutation:
 * replacing the arithmetic with a literal left both arms above green.
 */
await check("the jump follows a window the demo has never seen", () => {
  const invented = { idleMs: 60000, warnMs: 10000 };
  const warning = Demo.clockJumpFor("warning", invented);
  const expiry = Demo.clockJumpFor("expiry", invented);
  return Admin.idleVerdict(0, warning, invented).state === "warning" &&
    Admin.idleVerdict(0, expiry, invented).state === "expired" &&
    warning !== Demo.clockJumpFor("warning", Admin.IDLE_WINDOW);
});

await check("a page with no idle window gets no jump, rather than a made-up one", () =>
  Demo.clockJumpFor("warning", null) === null &&
  Demo.clockJumpFor("warning", { idleMs: "soon", warnMs: 1 }) === null &&
  Demo.clockJumpFor("sideways", Admin.IDLE_WINDOW) === null);

/*
 * RESET SPARES NOTHING IT IS HANDED. The temptation is to clear the
 * demo's own three keys and call it a reset, which leaves a signed-in
 * tab in the chosen palette with a key still in the browser - reset in
 * name only.
 */
await check("reset takes everything the browser is holding", () => {
  const held = {
    session: ["hgb-session", Demo.STORAGE_KEYS[0], "something-else"],
    local: ["hgb-palette", "hgb-submit-prefill"],
    databases: ["hgb-member-key", "hgb-keyholder-key"],
  };
  const plan = Demo.resetPlan(held);
  return held.session.every((n) => plan.session.includes(n)) &&
    held.local.every((n) => plan.local.includes(n)) &&
    held.databases.every((n) => plan.databases.includes(n)) &&
    plan.session.length === 3 && plan.local.length === 2 &&
    plan.databases.length === 2;
});

await check("reset lands on the page a stranger lands on", () =>
  Demo.resetPlan({}).open === Demo.MIRROR_PATH + Demo.FIRST_VISIT &&
  PAGES.includes(Demo.FIRST_VISIT));

await check("the databases reset takes are the ones apps/web really opens", () => {
  const named = /"(hgb-[a-z-]*key)"/g;
  const found = new Set();
  Object.values(webSource).forEach((src) => {
    let hit;
    named.lastIndex = 0;
    while ((hit = named.exec(src)) !== null) found.add(hit[1]);
  });
  // Enumerated by the browser half rather than listed, so the arm is
  // that apps/web really keeps more than one - the fact that makes a
  // hand-written list in the demo wrong.
  return found.size >= 2 &&
    Demo.resetPlan({ databases: [...found] }).databases.length === found.size;
});

/* ------------------------------------------------------------------ */
/* Which page the strip is standing on.                                */

const ORIGIN = "http://127.0.0.1:8126";
const at = (path) => Demo.pageAddressOf(ORIGIN + path);

await check("a mirrored page is named by the address, and it is a destination", () =>
  at("/demo/your-page.html").file === "your-page.html" &&
  at("/demo/your-page.html").inside === true);

await check("a page served without its extension is still that page", () =>
  at("/demo/your-page").file === "your-page.html");

await check("a page served with a trailing slash is still that page", () =>
  at("/demo/your-page/").file === "your-page.html");

await check("a tidied name matching no page is still no destination", () =>
  at("/demo/whatever").file === null &&
  at("/demo/whatever").inside === true);

await check("a real page of the product that is no destination lights none", () =>
  at("/demo/404.html").file === null && at("/demo/404.html").inside === true);

await check("the directory root is the index page the host serves there", () =>
  at("/demo/").file === "index.html" && at("/demo/").inside === true);

/*
 * The destinations are an ARGUMENT, which is what makes the root's fold
 * a checked branch rather than a described one: given destinations the
 * directory index is not among, the root still resolves to nothing.
 * Substituting a bare `return DIRECTORY_INDEX` left the suite green at
 * its full count with the strictness gone.
 */
await check("the directory root is looked up, not assumed", () =>
  Demo.destinationUnder("", [{ file: "charts.html" }]) === null &&
  Demo.destinationUnder("/", [{ file: "charts.html" }]) === null);

await check("the directory root is the index page when that is a destination", () =>
  Demo.destinationUnder("", [{ file: "index.html" }]) === "index.html");

await check("an address outside the mirror is no page of the product", () =>
  at("/apps/web/index.html").inside === false &&
  at("/apps/web/index.html").file === null);

await check("an address that will not parse is refused, not read as a page", () =>
  Demo.pageAddressOf("http://[").inside === false &&
  Demo.pageAddressOf("").inside === false &&
  Demo.pageAddressOf(null).inside === false);

/* ------------------------------------------------------------------ */
/* What may leave the machine.                                         */

const decide = (url) => Demo.requestKindOf(url, ORIGIN + "/demo/admin.html",
  "https://demo.invalid");

await check("a userinfo trick that reads same-origin by substring is refused", () =>
  decide("https://demo.invalid@evil.example/x").kind === "refuse");

await check("a plain third-party URL is refused, with the URL in the message", () => {
  const answer = decide("https://example.com/x");
  return answer.kind === "refuse" && answer.why.includes("example.com");
});

await check("relative and same-origin URLs are still allowed by name", () =>
  decide("/dev/sample-submissions.json").kind === "file" &&
  decide(ORIGIN + "/dev/sample-submissions.json").kind === "file");

await check("a sibling under the same directory is refused, not fetched", () =>
  decide("/dev/test-key.json").kind === "refuse" &&
  decide("/dev/fixture.json").kind === "refuse");

await check("the configured endpoint is answered by the stub, path and all", () =>
  decide("https://demo.invalid/me").kind === "worker" &&
  decide("https://demo.invalid/me").path === "/me");

await check("a URL that will not parse at all is refused rather than allowed", () =>
  decide("http://[").kind === "refuse");

await check("the Worker path is derived by origin, not by substring", () =>
  Demo.workerPathOf("https://x.workers.dev/me", ORIGIN, "") === "/me" &&
  Demo.workerPathOf("https://notworkers.dev.evil.example/me", ORIGIN, "")
    === null);

/*
 * THE TOOLBAR'S DOOR IS NOT THE PRODUCT'S, and neither list may widen
 * the other. The file the strip reads is a private key; the day it joins
 * LOCAL_FILES is the day a published page is permitted to read key
 * material off its own host.
 */
await check("the toolbar may read the committed key, and the product may not", () =>
  Demo.toolbarFileKind(Demo.DEV_KEY_FILE).kind === "file" &&
  decide(Demo.DEV_KEY_FILE).kind === "refuse");

await check("the toolbar may read nothing else at all", () =>
  Demo.toolbarFileKind("/dev/fixture.json").kind === "refuse" &&
  Demo.toolbarFileKind("/dev/sample-submissions.json").kind === "refuse" &&
  Demo.toolbarFileKind("").kind === "refuse" &&
  Demo.toolbarFileKind(undefined).kind === "refuse");

await check("the two allowlists share nothing", () =>
  Demo.LOCAL_FILES.every((path) => !Demo.TOOLBAR_FILES.includes(path)));

/* ------------------------------------------------------------------ */
/* The demo's config stand-in.                                         */

const configJs = await readFile(HERE("../apps/web/config.js"), "utf8");
const demoConfigJs = await readFile(HERE("./demo-config.js"), "utf8");

await check("the demo config seals to the development key config.js ships", () => {
  const key = /publicKey:\s*"([^"]+)"/.exec(demoConfigJs)[1];
  return configJs.includes(key);
});

await check("the demo config points at a name that cannot resolve", () =>
  /endpoint:\s*"https:\/\/[^"]*\.invalid"/.test(demoConfigJs));

await check("no page's connect-src names the demo's endpoint", () =>
  PAGES.every((page) => !shipped[page].includes("demo.invalid")));

/* ------------------------------------------------------------------ */
/* The strip, driven in a recorded browser.                            */

/*
 * THE WIRING, EARNED BY RUNNING THE BYTES (#154 F1's rule).
 *
 * A source-string arm would ask whether demo-toolbar.js CONTAINS a word,
 * which the comment explaining the control contains too. What has to be
 * true is that each press writes the world it claims and then MOVES, so
 * the real file runs under node:vm against a recorded browser and the
 * recording is asked what happened.
 *
 * The navigation is the load-bearing half. The product's pages read
 * their world once, on load, so a control that wrote storage and left
 * the page standing would claim a world the screen is not showing -
 * silently.
 */
function recordedNode(tag) {
  const it = {
    tag: tag,
    className: "",
    children: [],
    attrs: {},
    style: {},
    listeners: {},
    hidden: false,
    value: "",
    title: "",
    type: "",
    setAttribute(name, value) { it.attrs[name] = String(value); },
    removeAttribute(name) { delete it.attrs[name]; },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(it.attrs, name)
        ? it.attrs[name] : null;
    },
    appendChild(child) { it.children.push(child); return child; },
    addEventListener(type, fn) {
      (it.listeners[type] = it.listeners[type] || []).push(fn);
    },
    click() { (it.listeners.click || []).slice().forEach((fn) => fn({})); },
    getBoundingClientRect() { return { height: it.laidOutAt }; },
    laidOutAt: 0,
  };
  let text = "";
  Object.defineProperty(it, "textContent", {
    enumerable: true,
    get: () => text,
    set: (value) => { text = String(value); it.children.length = 0; },
  });
  return it;
}

const SNAPSHOT = { counts: { entries: 7 }, series: [] };

function toolbarInRecordedBrowser(options) {
  const opts = options || {};
  const page = opts.page || "admin.html";
  const store = { session: {}, local: {} };
  Object.assign(store.session, opts.session || {});
  Object.assign(store.local, opts.local || {});

  const went = [];
  const reloads = [];
  const read = [];
  const built = [];
  const dropped = [];
  const body = recordedNode("body");
  const rootStyle = {};
  const pageNodes = {};
  const absent = new Set(opts.absent || []);
  const databases = (opts.databases || []).slice();
  const listened = [];
  const jumped = [];
  const observed = [];
  const observers = [];

  const storeFor = (kept) => ({
    getItem: (key) => (key in kept ? kept[key] : null),
    setItem: (key, value) => { kept[key] = String(value); },
    removeItem: (key) => { delete kept[key]; },
    get length() { return Object.keys(kept).length; },
    key: (index) => Object.keys(kept)[index],
  });

  const context = {
    BinderDemo: Demo,
    BinderDemoBoot: {
      jump: (by) => { jumped.push(by); return by; },
      read: (path) => {
        read.push(String(path));
        const decided = Demo.toolbarFileKind(path);
        if (decided.kind !== "file") {
          return Promise.reject(new Error(decided.why));
        }
        return Promise.resolve({ text: () => Promise.resolve(devKeyFile) });
      },
    },
    document: {
      readyState: "complete",
      body: body,
      documentElement: {
        style: {
          setProperty(name, value) { rootStyle[name] = String(value); },
        },
      },
      createElement: (tag) => recordedNode(tag),
      getElementById: (id) => {
        if (absent.has(id)) return null;
        if (!(id in pageNodes)) pageNodes[id] = recordedNode("input");
        return pageNodes[id];
      },
      addEventListener() {},
    },
    location: {
      href: ORIGIN + Demo.MIRROR_PATH + page,
      assign(url) { went.push(String(url)); },
      reload() { reloads.push(true); },
    },
    // The window's own listener, which the strip registers only where
    // there is no observer to watch the element itself.
    addEventListener(type) { listened.push(String(type)); },
    /*
     * The observer, recorded rather than run. `noResizeObserver` takes
     * it away, which is the browser the window listener exists for -
     * both branches are driven, so neither is a path nobody enters.
     */
    ResizeObserver: opts.noResizeObserver === true ? undefined
      : function (fn) {
        observers.push(fn);
        this.observe = (node) => { observed.push(node); };
        this.disconnect = () => {};
      },
    sessionStorage: storeFor(store.session),
    localStorage: storeFor(store.local),
    /*
     * The corpus worker, recorded rather than run. What the aggregation
     * produces has its own arms further down; what is under test here is
     * that the press asks for the corpus and the cut it claims, and
     * stores what comes back.
     */
    Worker: function (url) {
      const worker = this;
      built.push(String(url));
      worker.listeners = {};
      worker.addEventListener = (type, fn) => {
        (worker.listeners[type] = worker.listeners[type] || []).push(fn);
      };
      worker.terminate = () => {};
      worker.postMessage = (message) => {
        built.push(message);
        if (opts.workerFails === true) {
          (worker.listeners.error || []).forEach((fn) =>
            fn({ message: "the worker failed" }));
          return;
        }
        (worker.listeners.message || []).forEach((fn) => fn({
          data: {
            ok: true,
            snapshot: SNAPSHOT,
            rounds: message.rounds === null || message.rounds === undefined
              ? Demo.roundsIn(message.corpus) : message.rounds,
            entries: SNAPSHOT.counts.entries,
          },
        }));
      };
    },
    indexedDB: opts.noDatabases === true ? {} : {
      databases: () => Promise.resolve(databases.map((name) => ({ name }))),
      deleteDatabase(name) {
        dropped.push(String(name));
        const request = {};
        Promise.resolve().then(() => {
          if (typeof request.onsuccess === "function") request.onsuccess();
        });
        return request;
      },
    },
    BinderAdmin: opts.noIdleTimer === true ? undefined : Admin,
    setTimeout: (fn) => { fn(); return 0; },
    Date: Date,
  };

  // The height the browser lays the strip out at, answered by this
  // recording so the measurement the file takes is one an arm chose.
  const plain = context.document.createElement;
  context.document.createElement = (tag) => {
    const node = plain(tag);
    if (tag === "div") {
      node.laidOutAt = opts.barHeight === undefined ? 40 : opts.barHeight;
    }
    return node;
  };

  vm.createContext(context);
  vm.runInContext(toolbarJs, context, { filename: "demo-toolbar.js" });

  const bar = body.children[0];
  const everyButton = [];
  const walk = (node) => {
    node.children.forEach((child) => {
      if (child.tag === "button") everyButton.push(child);
      walk(child);
    });
  };
  if (bar) walk(bar);

  const press = (label) => {
    const found = everyButton.find((one) => one.textContent === label);
    if (!found) throw new Error("the strip has no control called " + label);
    found.click();
  };
  const startsWith = (prefix) =>
    everyButton.find((one) => one.textContent.indexOf(prefix) === 0);
  const said = () => {
    const line = (bar ? bar.children : [])
      .find((one) => one.className === "demo-status");
    return line ? line.textContent : "";
  };
  const worldNow = () => {
    const raw = store.session[Demo.STORAGE_KEYS[2]];
    return raw ? JSON.parse(raw) : {};
  };
  const settled = () => new Promise((done) => { setTimeout(done, 0); });

  // The browser laying the strip out at a new height - a status line
  // wrapping it onto another row, a narrower window, a font arriving.
  const laidOutAt = (height) => {
    if (bar) bar.laidOutAt = height;
    observers.forEach((fn) => fn([{ target: bar }]));
  };

  return {
    bar, body, everyButton, press, startsWith, said, worldNow, settled,
    went, reloads, read, built, dropped, store, pageNodes, rootStyle,
    listened, jumped, observed, laidOutAt,
    labels: () => everyButton.map((one) => one.textContent),
  };
}

await check("the strip paints itself, and says what it is", () => {
  const browser = toolbarInRecordedBrowser();
  return browser.bar !== undefined &&
    browser.bar.getAttribute("data-demo-toolbar") === "" &&
    browser.bar.children.some((one) =>
      one.textContent === Demo.TOOLBAR.title) &&
    browser.bar.children.some((one) =>
      one.textContent === Demo.TOOLBAR.honesty);
});

/*
 * It is APPENDED to the body rather than inserted at its head. The
 * signed-in pages lay their body out as a grid, and a new first child
 * becomes a grid item and moves the rail - a demo rearranging the
 * product's layout in front of the person judging that layout.
 */
await check("the strip is appended, so it is no grid item of the product's", () => {
  const browser = toolbarInRecordedBrowser();
  return browser.body.children.length === 1 &&
    browser.body.children[0] === browser.bar;
});

await check("every identity the demo offers has a control on the strip", () => {
  const labels = toolbarInRecordedBrowser().labels();
  return Demo.SIGN_INS.every((one) => labels.includes(one.label));
});

await check("every snapshot row has a control, with the counts on it", () => {
  const browser = toolbarInRecordedBrowser();
  return Demo.PRESETS.every((preset) => {
    const control = browser.startsWith(preset.label);
    if (!control) return false;
    if (preset.corpus === null) return control.textContent === preset.label;
    const counts = Demo.countsFor(preset.corpus, preset.rounds);
    return control.textContent.includes(counts.entries + "/" + counts.people);
  });
});

/*
 * IT WATCHES THE STRIP, NOT THE WINDOW - and that difference is a
 * defect somebody drove. The status line lives INSIDE the strip, so one
 * sentence about what a press did wraps it onto another row at a window
 * nobody touched: the strip grew from 60px to 104px on the first press
 * of an enabler while the offset the page uses stayed at 60px, and the
 * page's own heading went behind it. A window `resize` listener cannot
 * see that. The element can, so the element is what is observed - which
 * also covers the width, the font arriving late, and whatever the next
 * slice puts on the strip.
 */
await check("the strip watches its own box, and follows it both ways", () => {
  const browser = toolbarInRecordedBrowser({ barHeight: 60 });
  if (browser.observed[0] !== browser.bar) return false;
  if (browser.rootStyle["--hgb-demo-bar"] !== "60px") return false;
  browser.laidOutAt(104);
  if (browser.rootStyle["--hgb-demo-bar"] !== "104px") return false;
  browser.laidOutAt(60);
  return browser.rootStyle["--hgb-demo-bar"] === "60px" &&
    !browser.listened.includes("resize");
});

/*
 * The defect's own path, driven end to end: a press writes a status
 * line, the browser lays the strip out taller for it, and the room the
 * page makes moves with it rather than staying at the height the strip
 * had before anybody pressed anything.
 */
await check("a status line that grows the strip moves the room the page makes", async () => {
  const browser = toolbarInRecordedBrowser({ page: "admin.html", barHeight: 60 });
  browser.press(Demo.ENABLERS.find((one) => one.id === "key").label);
  await browser.settled();
  if (browser.said().length < 40) return false;
  browser.laidOutAt(104);
  return browser.rootStyle["--hgb-demo-bar"] === "104px";
});

/*
 * And a browser with no observer still re-measures on the one cause it
 * can see. Kept because the alternative is a strip that silently stops
 * measuring at all there - the offset frozen at the stylesheet's floor,
 * with nothing on screen saying so.
 */
await check("a browser with no observer falls back to the window's own resize", () => {
  const browser = toolbarInRecordedBrowser({ noResizeObserver: true });
  return browser.listened.includes("resize") && browser.observed.length === 0;
});

await check("both clock steps have a control", () => {
  const labels = toolbarInRecordedBrowser().labels();
  return Demo.CLOCK_STEPS.every((one) => labels.includes(one.label));
});

/* -- Sign in as ---------------------------------------------------- */

await check("signing in as somebody writes their session and opens their page", () => {
  const browser = toolbarInRecordedBrowser();
  browser.press("Keyholder");
  const session = JSON.parse(browser.store.session["hgb-session"]);
  return session.isAdmin === true && session.username === "demo_keyholder" &&
    browser.store.session[Demo.STORAGE_KEYS[0]] === "keyholder" &&
    browser.went[0] === Demo.MIRROR_PATH + Demo.signInFor("keyholder").lands;
});

await check("signing in as the member writes a session with no authority", () => {
  const browser = toolbarInRecordedBrowser();
  browser.press("Member");
  const session = JSON.parse(browser.store.session["hgb-session"]);
  return session.isAdmin === false &&
    browser.went[0] === Demo.MIRROR_PATH + "your-page.html";
});

/*
 * The other direction: the session it writes has to be one the SHIPPED
 * normalizer accepts. A demo session apps/web/session.js would reject is
 * a demo of the rejection - the tab signs itself out on the next page.
 */
await check("the session it writes is one the shipped page would keep", async () => {
  const browser = toolbarInRecordedBrowser();
  browser.press("Second admin");
  const written = JSON.parse(browser.store.session["hgb-session"]);
  return written.ok === true &&
    Date.parse(written.expiresAt) > Date.now() &&
    typeof written.session === "string" && written.session.length > 0;
});

await check("signing in clears a refusal the last sign-out left", () => {
  const browser = toolbarInRecordedBrowser({
    session: { [Demo.STORAGE_KEYS[2]]: JSON.stringify({ revoked: true }) },
  });
  browser.press("Member");
  return browser.worldNow().revoked === false;
});

/* -- The key ------------------------------------------------------- */

await check("the key control fills the page's own box and says what it is",
  async () => {
    const browser = toolbarInRecordedBrowser({ page: "admin.html" });
    browser.press(Demo.ENABLERS.find((one) => one.id === "key").label);
    await browser.settled();
    return browser.read[0] === Demo.DEV_KEY_FILE &&
      browser.pageNodes.keyfile.value === devKeyFile &&
      browser.said() === Demo.KEY_STAGED_LINE;
  });

/*
 * The other direction, and it is the one that matters: a control that
 * quietly did nothing on a page with no box is the false-confidence
 * failure this suite opens on.
 */
await check("the key control says so on a page that has no box", async () => {
  const browser = toolbarInRecordedBrowser({ page: "charts.html" });
  browser.press(Demo.ENABLERS.find((one) => one.id === "key").label);
  await browser.settled();
  return browser.read.length === 0 &&
    /no key box/i.test(browser.said()) &&
    browser.said().includes("admin.html");
});

await check("a page whose box has been renamed is reported, not written to",
  async () => {
    const browser = toolbarInRecordedBrowser({
      page: "admin.html", absent: ["keyfile"],
    });
    browser.press(Demo.ENABLERS.find((one) => one.id === "key").label);
    await browser.settled();
    return /moved under the demo/i.test(browser.said());
  });

/* -- The snapshot -------------------------------------------------- */

await check("a snapshot row builds its corpus and stages what comes back",
  async () => {
    const browser = toolbarInRecordedBrowser();
    browser.press(browser.startsWith("Full group").textContent);
    await browser.settled();
    const asked = browser.built.find((one) => one && one.corpus);
    const staged = JSON.parse(browser.store.session[Demo.STORAGE_KEYS[1]]);
    return asked.corpus === "rich" &&
      staged.staged.counts.entries === SNAPSHOT.counts.entries &&
      browser.worldNow().staged.corpus === "rich" &&
      browser.reloads.length === 1;
  });

await check("the thin row asks for the corpus under the floor", async () => {
  const browser = toolbarInRecordedBrowser();
  browser.press(browser.startsWith("Thin week").textContent);
  await browser.settled();
  return browser.built.find((one) => one && one.corpus).corpus === "sparse";
});

/*
 * Emptying clears the staged DATA and leaves `published` alone, because
 * `undefined` is never-touched and `null` is taken-down and the product
 * really has both states. Writing null here would collapse them.
 */
await check("the empty row stages nothing and takes nothing down", async () => {
  const browser = toolbarInRecordedBrowser({
    session: { [Demo.STORAGE_KEYS[1]]: JSON.stringify({ staged: SNAPSHOT }) },
  });
  browser.press("Empty");
  await browser.settled();
  return browser.store.session[Demo.STORAGE_KEYS[1]] === undefined &&
    browser.worldNow().staged === null &&
    !("published" in browser.worldNow()) &&
    browser.built.length === 0;
});

await check("a snapshot the browser could not build is said, not staged",
  async () => {
    const browser = toolbarInRecordedBrowser({ workerFails: true });
    browser.press(browser.startsWith("Full group").textContent);
    await browser.settled();
    return /could not be built/.test(browser.said()) &&
      browser.store.session[Demo.STORAGE_KEYS[1]] === undefined &&
      browser.reloads.length === 0;
  });

await check("Add entries publishes one round more than is staged", async () => {
  const browser = toolbarInRecordedBrowser({
    session: {
      [Demo.STORAGE_KEYS[2]]: JSON.stringify({
        staged: { corpus: "rich", rounds: 1 },
      }),
    },
  });
  browser.press("Add entries");
  await browser.settled();
  const asked = browser.built.find((one) => one && one.corpus);
  return asked.corpus === "rich" && asked.rounds === 2 &&
    browser.worldNow().staged.rounds === 2;
});

await check("Add entries with nothing staged starts at the first round",
  async () => {
    const browser = toolbarInRecordedBrowser();
    browser.press("Add entries");
    await browser.settled();
    const asked = browser.built.find((one) => one && one.corpus);
    return asked.corpus === "rich" && asked.rounds === 1;
  });

await check("Add entries at the last round says so rather than doing nothing",
  async () => {
    const browser = toolbarInRecordedBrowser({
      session: {
        [Demo.STORAGE_KEYS[2]]: JSON.stringify({
          staged: { corpus: "rich", rounds: Demo.roundsIn("rich") },
        }),
      },
    });
    browser.press("Add entries");
    await browser.settled();
    return browser.built.length === 0 &&
      browser.said().includes(String(Demo.roundsIn("rich"))) &&
      browser.reloads.length === 0;
  });

/* -- Corrections --------------------------------------------------- */

await check("the corrections control seeds them, and pressing again clears", () => {
  const browser = toolbarInRecordedBrowser();
  browser.press("Seed corrections");
  const on = browser.worldNow().corrections === true;
  const second = toolbarInRecordedBrowser({
    session: {
      [Demo.STORAGE_KEYS[2]]: JSON.stringify({ corrections: true }),
    },
  });
  second.press("Seed corrections");
  return on && second.worldNow().corrections === false &&
    browser.reloads.length === 1;
});

/* -- The clock ----------------------------------------------------- */

await check("the clock control moves this tab's clock by the page's own window",
  () => {
    const browser = toolbarInRecordedBrowser({ page: "admin.html" });
    browser.press(Demo.CLOCK_STEPS[0].label);
    return browser.jumped[0] ===
      Demo.clockJumpFor("warning", Admin.IDLE_WINDOW);
  });

/*
 * AND IT DOES NOT NAVIGATE, which is the half the running server
 * taught. Every other control reloads, because the product's pages read
 * their world on load; this one must not, because the page captured its
 * last-interaction instant on that same load. Reload and the page reads
 * the shifted clock for both instants and finds no idleness at all - a
 * press that reports a jump and changes nothing on screen.
 */
await check("the clock control leaves the page standing, alone among them",
  () => {
    const browser = toolbarInRecordedBrowser({ page: "admin.html" });
    browser.press(Demo.CLOCK_STEPS[1].label);
    return browser.reloads.length === 0 && browser.went.length === 0 &&
      /next tick/i.test(browser.said());
  });

await check("a page running no idle timer is told so, and its clock is left",
  () => {
    const browser = toolbarInRecordedBrowser({
      page: "charts.html", noIdleTimer: true,
    });
    browser.press(Demo.CLOCK_STEPS[0].label);
    return /no idle timer/i.test(browser.said()) &&
      browser.jumped.length === 0 &&
      browser.reloads.length === 0;
  });

/*
 * The boot file is what installs the shifted clock, and only `Date.now`
 * moves. Shifting the constructor too would move every rendered date on
 * screen, which is the demo's own data quietly disagreeing with its
 * corpus.
 */
await check("the boot file shifts the clock the page reads, and only that",
  () => {
    const jumped = bootInRecordedBrowser({ world: { clock: 480000 } });
    const drift = jumped.context.Date.now() - jumped.realNow;
    const constructor = new jumped.context.Date().getTime() - jumped.realNow;
    return drift >= 470000 && drift <= 490000 && Math.abs(constructor) < 5000;
  });

await check("a tab nobody jumped reads the real clock", () => {
  const plain = bootInRecordedBrowser({ world: {} });
  return Math.abs(plain.context.Date.now() - plain.realNow) < 5000;
});

/*
 * A JUMP MOVES A TAB THAT WAS NEVER JUMPED. Installing the shim only
 * when an offset already exists leaves the first press with nothing to
 * bump: the demo reports a jump, the page's clock does not move, and
 * nothing on screen says so.
 */
await check("a first jump moves a clock nothing had shifted yet", () => {
  const boot = bootInRecordedBrowser({ world: {} });
  boot.context.BinderDemoBoot.jump(480000);
  const drift = boot.context.Date.now() - boot.realNow;
  return drift >= 470000 && drift <= 490000;
});

await check("jumps accumulate, and survive into the next page", () => {
  const boot = bootInRecordedBrowser({ world: { clock: 100000 } });
  boot.context.BinderDemoBoot.jump(50000);
  boot.context.BinderDemoBoot.jump(25000);
  const stored = JSON.parse(boot.kept[Demo.STORAGE_KEYS[2]]);
  return stored.clock === 175000 &&
    boot.context.Date.now() - boot.realNow >= 170000;
});

await check("a jump of nothing is refused rather than corrupting the offset", () => {
  const boot = bootInRecordedBrowser({ world: { clock: 100000 } });
  return boot.context.BinderDemoBoot.jump("soon") === 100000 &&
    boot.context.BinderDemoBoot.jump(-5000) === 100000;
});

/* -- Reset --------------------------------------------------------- */

await check("reset empties both stores, both databases, and lands on sign-in",
  async () => {
    const browser = toolbarInRecordedBrowser({
      session: { "hgb-session": "x", [Demo.STORAGE_KEYS[2]]: "{}" },
      local: { "hgb-palette": "pink", "hgb-submit-prefill": "{}" },
      databases: ["hgb-member-key", "hgb-keyholder-key"],
    });
    browser.press(Demo.ENABLERS.find((one) => one.id === "reset").label);
    await browser.settled();
    await browser.settled();
    return Object.keys(browser.store.session).length === 0 &&
      Object.keys(browser.store.local).length === 0 &&
      browser.dropped.length === 2 &&
      browser.dropped.includes("hgb-keyholder-key") &&
      browser.went[0] === Demo.MIRROR_PATH + Demo.FIRST_VISIT;
  });

/*
 * The direction that makes the button honest. A browser that cannot list
 * its own databases cannot be reset by enumeration, and a partial reset
 * called a whole one leaves key material in a tab that has just told the
 * driver it holds nothing.
 */
await check("a browser that cannot enumerate its databases is told, not half-reset",
  async () => {
    const browser = toolbarInRecordedBrowser({
      session: { "hgb-session": "x" }, noDatabases: true,
    });
    browser.press(Demo.ENABLERS.find((one) => one.id === "reset").label);
    await browser.settled();
    return browser.store.session["hgb-session"] === "x" &&
      browser.went.length === 0 &&
      /cannot list its own databases/i.test(browser.said());
  });

/* ------------------------------------------------------------------ */
/* The boot file, driven the same way.                                 */

function bootInRecordedBrowser(options) {
  const opts = options || {};
  const kept = {};
  if (opts.world) kept[Demo.STORAGE_KEYS[2]] = JSON.stringify(opts.world);
  const fetched = [];
  const realNow = Date.now();

  const context = {
    BinderDemo: Demo,
    BINDER_CONFIG: { endpoint: "https://demo.invalid" },
    location: { href: ORIGIN + Demo.MIRROR_PATH + "admin.html" },
    sessionStorage: {
      getItem: (key) => (key in kept ? kept[key] : null),
      setItem: (key, value) => { kept[key] = String(value); },
      removeItem: (key) => { delete kept[key]; },
    },
    fetch: (url) => {
      fetched.push(String(url));
      return Promise.resolve({ text: () => Promise.resolve(devKeyFile) });
    },
    Response: function (body, init) {
      this.body = body;
      this.status = (init || {}).status;
    },
    Date: Date,
  };
  vm.createContext(context);
  vm.runInContext(bootJs, context, { filename: "demo-boot.js" });
  return { context, kept, fetched, realNow };
}

await check("the boot file replaces fetch and refuses a third party", async () => {
  const boot = bootInRecordedBrowser({});
  let why = "";
  try {
    await boot.context.fetch("https://example.com/x");
  } catch (error) {
    why = error.message;
  }
  return why.includes("example.com");
});

await check("the toolbar's reader is on a global, held to its own list",
  async () => {
    const boot = bootInRecordedBrowser({});
    const ok = await boot.context.BinderDemoBoot.read(Demo.DEV_KEY_FILE);
    let why = "";
    try {
      await boot.context.BinderDemoBoot.read("/dev/fixture.json");
    } catch (error) {
      why = error.message;
    }
    return typeof ok.text === "function" && why.includes("fixture.json");
  });

await check("a stubbed answer is remembered, and who signed in with it", async () => {
  const boot = bootInRecordedBrowser({});
  await boot.context.fetch("https://demo.invalid/auth/telegram", {
    method: "POST",
    body: JSON.stringify({ id: Demo.MEMBER_TELEGRAM_ID }),
  });
  return boot.kept[Demo.STORAGE_KEYS[0]] === "member";
});

/* ------------------------------------------------------------------ */
/* The sign-in picker, driven in a recorded browser.                   */

function pickerInRecordedBrowser() {
  const inserted = [];
  const signedIn = [];
  const script = recordedNode("script");
  script.attrs["data-onauth"] = "onTelegramAuth(user)";
  script.attrs["data-telegram-login"] = "hanggangbinder_bot";
  script.parentNode = {
    insertBefore(node) { inserted.push(node); return node; },
  };

  const context = {
    BinderDemo: Demo,
    document: {
      currentScript: script,
      createElement: (tag) => recordedNode(tag),
    },
    onTelegramAuth: (payload) => { signedIn.push(payload); },
  };
  vm.createContext(context);
  vm.runInContext(telegramJs, context, { filename: "demo-telegram.js" });

  const button = inserted[0];
  const picker = inserted[1];
  return { button, picker, signedIn, inserted };
}

await check("the sign-in page's own button is the one that opens the picker", () => {
  const browser = pickerInRecordedBrowser();
  return browser.button.tag === "button" &&
    browser.picker.hidden === true &&
    browser.button.getAttribute("aria-expanded") === "false";
});

await check("pressing it reveals the picker, and pressing again puts it away", () => {
  const browser = pickerInRecordedBrowser();
  browser.button.click();
  const open = browser.picker.hidden === false &&
    browser.button.getAttribute("aria-expanded") === "true";
  browser.button.click();
  return open && browser.picker.hidden === true &&
    browser.button.getAttribute("aria-expanded") === "false";
});

await check("the picker offers every identity the demo has", () => {
  const browser = pickerInRecordedBrowser();
  const labels = browser.picker.children.map((one) => one.textContent);
  return labels.length === Demo.SIGN_INS.length &&
    Demo.SIGN_INS.every((one) => labels.includes(one.label));
});

/*
 * The press goes through the PAGE'S OWN callback, which is what makes
 * the picker worth having: everything after it is apps/web/auth.js
 * posting the payload and session.js keeping what comes back. A picker
 * that wrote a session itself would be demonstrating the demo's sign-in
 * rather than the product's.
 */
await check("choosing somebody calls the page's own callback with their id", () => {
  const browser = pickerInRecordedBrowser();
  browser.button.click();
  const choice = browser.picker.children.find((one) =>
    one.textContent === Demo.signInFor("keyholder").label);
  choice.click();
  const payload = browser.signedIn[0];
  return browser.signedIn.length === 1 &&
    String(payload.id) === Demo.signInFor("keyholder").telegramId &&
    payload.username === "demo_keyholder";
});

await check("the whole picker posts through one route, and it is the shipped one",
  () => {
    const browser = pickerInRecordedBrowser();
    browser.button.click();
    browser.picker.children.forEach((one) => one.click());
    return browser.signedIn.length === Demo.SIGN_INS.length &&
      webSource["auth.js"].includes("/auth/telegram");
  });

/* ------------------------------------------------------------------ */
/* The strip's stylesheet, and the one product rule it is coupled to.  */

/*
 * THE COUPLING IS CHECKED RATHER THAN DESCRIBED. The rail is
 * `position: sticky; top: 0` in apps/web/theme.css, so a fixed strip
 * over it makes the rail's first destination unreadable at every scroll
 * position but the top - and demo-toolbar.css offsets it. The day
 * theme.css stops sticking the rail there, this arm fails and tells the
 * next reader to take the demo's rule out, instead of leaving a rule
 * that silently offsets nothing.
 */
await check("the rail apps/web sticks to the top is the one the strip offsets", () =>
  /\.rail\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/.test(webSource["theme.css"]) &&
  /\.rail\s*\{[^}]*top:\s*var\(--hgb-demo-bar\)/.test(toolbarCss));

await check("the strip makes room for itself rather than covering the page", () =>
  /body\s*\{[^}]*padding-top:\s*var\(--hgb-demo-bar\)/.test(toolbarCss) &&
  /--hgb-demo-bar-floor:\s*[0-9.]+/.test(toolbarCss) &&
  /--hgb-demo-bar:\s*var\(--hgb-demo-bar-floor\)/.test(toolbarCss));

/*
 * AND THE ROOM IS ACTUALLY MADE, WHICH IS A DIFFERENT CLAIM FROM THE
 * RULE EXISTING. Found by driving, not by reading: on /demo/admin.html
 * the strip's height reached the custom property correctly and the
 * heading was still behind it, because apps/web/theme.css says
 * `body.railed { padding: 0 }` for the signed-in pages' grid and a class
 * beats a bare element selector in every sheet order. The demo's offset
 * was cancelled on every page the owner spends the demo in; one row
 * fitted under the content's own top margin, so it looked right until
 * the strip wrapped. Measured: heading top 86.14px, strip bottom
 * 103.77px, on the first press of a ruled enabler.
 *
 * Both halves are asked, the product's and the demo's, so the day
 * theme.css stops zeroing that padding this arm reds and says the
 * `!important` can come out - rather than leaving a word nobody dares
 * remove.
 */
await check("the room the strip makes survives the product's own body rule", () =>
  /body\.[a-z-]+\s*\{[^}]*padding:\s*0/.test(webSource["theme.css"]) &&
  /body\s*\{[^}]*padding-top:\s*var\(--hgb-demo-bar\)\s*!important/
    .test(toolbarCss));

/*
 * THE STRIP'S OWN MINIMUM IS THE FLOOR, NEVER THE HEIGHT IT LAST
 * MEASURED - and this arm exists because the two were one token, which
 * made the measurement a ratchet. The script writes the measured height
 * onto `--hgb-demo-bar`; a strip whose `min-height` read the same token
 * could never come back down, so a status line that pushed it to three
 * rows left the page permanently offset for three rows after the line
 * was gone. Two tokens: one the stylesheet states, one the script
 * writes.
 */
await check("the strip's own minimum is the floor, not the height it last measured", () =>
  /\[data-demo-toolbar\]\s*\{[^}]*min-height:\s*var\(--hgb-demo-bar-floor\)/
    .test(toolbarCss) &&
  !/\[data-demo-toolbar\]\s*\{[^}]*min-height:\s*var\(--hgb-demo-bar\)/
    .test(toolbarCss));

/*
 * And the room is MEASURED rather than declared. The strip wraps onto
 * several rows at ordinary window widths, so a stylesheet's single
 * number is a floor - left as the answer, the strip sits over the
 * page's own heading, which is the product being hidden exactly where
 * the owner is looking at it. Driven rather than read: the recording
 * lays the strip out at a height and the arm asks what was written back.
 */
await check("the strip measures its own height and writes it back", () => {
  const browser = toolbarInRecordedBrowser({ barHeight: 96 });
  return browser.rootStyle["--hgb-demo-bar"] === "96px";
});

await check("a strip that has not been laid out yet writes no height", () => {
  const browser = toolbarInRecordedBrowser({ barHeight: 0 });
  return browser.rootStyle["--hgb-demo-bar"] === undefined;
});

/*
 * ABOVE EVERYTHING THE PRODUCT STACKS - ASKED OF THE PRODUCT, NOT
 * PINNED TO ONE ELEMENT.
 *
 * The property is that a driver can always see the strip: it has to
 * out-stack whatever the product paints over the page. Naming one page
 * element and comparing the strip to that element's literal keys the arm
 * to a piece of furniture instead of to the property, so removing the
 * furniture turns the arm red for a reason that has nothing to do with
 * the strip.
 *
 * So every z-index apps/web declares is read out and the strip is
 * required to top all of them. That set is allowed to be empty, and it
 * is READ rather than pinned for exactly that reason: the day a page
 * element declares one, it is measured against the strip by this arm
 * rather than by whoever notices the strip has gone missing.
 *
 * A STYLESHEET IS NOT THE ONLY PLACE A PRODUCT DECLARES ONE. A scan
 * that read the pages and the stylesheets and dropped the scripts went
 * green with a shipped script raising the rail to 99999 - ten times the
 * strip - so the scripts are read too, in the three forms they can take
 * it: the CSS property, the DOM property, and setProperty by name. A
 * value computed at run time is out of reach of any source scan and
 * says so here rather than being implied.
 *
 * A floor of its own, because topping an empty set is free: the strip's
 * number has to be positive. Most of what the product paints is stacked
 * by paint order rather than by a declared z-index, and a positive one
 * on a `fixed` element beats all of it, where zero or a negative would
 * put the strip under the page while satisfying every comparison above.
 */
const Z_FORMS = [
  /z-index:\s*(-?\d+)/g,
  /zIndex\s*[:=]\s*["']?\s*(-?\d+)/g,
  /setProperty\(\s*["']z-index["']\s*,\s*["']?\s*(-?\d+)/g,
];

await check("the strip's stacking tops every z-index the product declares", () => {
  const bar = /\[data-demo-toolbar\]\s*\{[^}]*z-index:\s*(-?\d+)/.exec(toolbarCss);
  if (bar === null || Number(bar[1]) <= 0) return false;
  const declared = [];
  // Every top-level .js, .html and .css in apps/web, which is what
  // webSource is built from - deliberately unfiltered here.
  Object.values(webSource).forEach((src) => {
    Z_FORMS.forEach((form) => {
      form.lastIndex = 0;
      let found = form.exec(src);
      while (found !== null) {
        declared.push(Number(found[1]));
        found = form.exec(src);
      }
    });
  });
  return declared.every((value) => Number(bar[1]) > value);
});

/*
 * And the strip carries no palette of the product's. A strip painted in
 * the site's own tokens puts the demo and the product in one visual
 * field, which makes the thing being judged harder to see rather than
 * easier.
 */
await check("the strip borrows none of the product's color tokens", () =>
  !/var\(--color-/.test(toolbarCss));

/* ------------------------------------------------------------------ */
/* The corpora, measured against the shipped aggregation.              */

const MIN_CELL = /MIN_CELL\s*=\s*(\d+)/.exec(webSource["dashboard.js"]);

await check("the floor the published series needs is readable in dashboard.js", () =>
  MIN_CELL !== null && Number(MIN_CELL[1]) >= 2);

await check("the rich corpus clears the floor the published series needs", () =>
  CORPUS.rich.counts.people >= Number(MIN_CELL[1]));

await check("the sparse corpus is below it, and publishes no series", () =>
  CORPUS.sparse.counts.people < Number(MIN_CELL[1]));

await check("every rich submitter has a series with more than one point", () => {
  const rounds = {};
  Demo.corpusInputs("rich").forEach((one) => {
    rounds[one.handle] = (rounds[one.handle] || 0) + 1;
  });
  return Object.values(rounds).every((count) => count > 1);
});

await check("the two corpora are different people", () => {
  const rich = new Set(Demo.corpusInputs("rich").map((one) => one.handle));
  return Demo.corpusInputs("sparse")
    .every((one) => !rich.has(one.handle));
});

await check("nothing published carries a handle", () =>
  !JSON.stringify(CORPUS.rich).includes("birch_lane") &&
  !JSON.stringify(CORPUS.rich).includes("demo_member"));

/*
 * The document a snapshot row stages is a SECOND publish, so the charts
 * have a change-since figure to draw. A first document has nothing to
 * measure from and the page correctly draws no line - which is the state
 * the first round is honestly in.
 */
await check("the full corpus is published as a second document", () =>
  CORPUS.rich.movement !== undefined && CORPUS.rich.movement !== null);

await check("the first round is a first publish, with nothing to compare", () => {
  const first = Demo.publishedFrom("rich", deps, 1);
  return first.movement === undefined || first.movement === null;
});

await check("a later round carries more entries than the one before it", () => {
  const one = Demo.publishedFrom("rich", deps, 1);
  const two = Demo.publishedFrom("rich", deps, 2);
  return two.counts.entries > one.counts.entries &&
    two.movement !== undefined && two.movement !== null;
});

await check("the cut by round agrees with the whole corpus at its ceiling", () =>
  Demo.publishedFrom("rich", deps, Demo.roundsIn("rich")).counts.entries ===
  CORPUS.rich.counts.entries);

await check("the movement is measured from a round, not from a clock reading", () => {
  const when = Date.parse(CORPUS.rich.movement.since);
  // Both halves: it is one of this corpus's own rounds, and it is far
  // enough back that a clock reading could not be mistaken for one.
  return RICH_ROUNDS.some((one) => Math.abs(one - when) < 2000) &&
    Date.now() - when > 20 * 24 * 3600 * 1000;
});

/* ------------------------------------------------------------------ */
/* The server.                                                         */

const server = await start({ port: 0 });
const port = server.address().port;
const fetchText = (path) => new Promise((resolve, reject) => {
  httpGet({ host: "127.0.0.1", port: port, path: path }, (response) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { body += chunk; });
    response.on("end", () => resolve({
      status: response.statusCode,
      location: response.headers.location,
      body: body,
    }));
  }).on("error", reject);
});

await check("--port accepts a plain in-range number, and no flag is the default", () =>
  portFrom(["node", "demo-server.mjs", "--port", "8151"]) === 8151 &&
  portFrom(["node", "demo-server.mjs"]) === 8126);

await mustReject("--port refuses a hexadecimal that lands in the preview range",
  async () => portFrom(["node", "demo-server.mjs", "--port", "0x1FE0"]),
  "0x1FE0");

/*
 * THE ROOT IS THE SIGN-IN PAGE. The address somebody is handed has to
 * land where a stranger lands - a root that answers 404 is a demo that
 * looks broken before anything has been driven.
 */
await check("the root sends a visitor to the sign-in page", async () => {
  const answer = await fetchText("/");
  return answer.status === 302 &&
    answer.location === MIRROR_PREFIX + Demo.FIRST_VISIT;
});

/*
 * And the bare directory answers with its index, which is the tidying an
 * ordinary static host performs. Serving it here makes the clean-URL
 * case reproducible without deploying anything.
 */
await check("a bare directory is answered with the page a host serves there",
  async () => {
    const answer = await fetchText(MIRROR_PREFIX);
    return answer.status === 200 && answer.body.includes("<h1>Sign in</h1>");
  });

await check("the mirror serves a page the demo has booted", async () => {
  const answer = await fetchText(MIRROR_PREFIX + "your-page.html");
  return answer.status === 200 && answer.body.includes(BOOT_SRC) &&
    answer.body.includes(BAR_SRC);
});

await check("the same page under /apps/web/ is served unchanged", async () => {
  const answer = await fetchText("/apps/web/your-page.html");
  return answer.status === 200 && !answer.body.includes(BOOT_SRC) &&
    answer.body === shipped["your-page.html"];
});

await check("the mirror tracks the file on disk rather than a copy", async () => {
  const answer = await fetchText(MIRROR_PREFIX + "admin.html");
  return Demo.unmirror(answer.body) === shipped["admin.html"];
});

/*
 * The ".." check runs BEFORE normalize(), and that order is the whole
 * guard: run after it, normalize has already clamped the path at the
 * root and the request is refused by the file not existing rather than
 * by the guard. The status is pinned at 400 for exactly that reason -
 * accepting 400-or-404 is what let a dead guard sit there looking armed.
 */
await check("a traversal is refused by the guard, not by a missing file", async () =>
  (await fetchText(MIRROR_PREFIX + "../../AGENTS.md")).status === 400);

await check("an encoded traversal cannot leave apps/web through the mirror",
  async () =>
    (await fetchText(MIRROR_PREFIX + "..%2f..%2fAGENTS.md")).status === 400);

await check("the mirror cannot reach dev/ and inject into its own files",
  async () =>
    (await fetchText(MIRROR_PREFIX + "..%2f..%2fdev%2ftest-key.json"))
      .status === 400);

await check("a missing file is a 404 rather than a blank page", async () => {
  const answer = await fetchText(MIRROR_PREFIX + "nothing-here.html");
  return answer.status === 404;
});

await check("the toolbar's own files are served to the pages that ask for them",
  async () => {
    const script = await fetchText(BAR_SRC);
    const style = await fetchText(BAR_CSS);
    return script.status === 200 && style.status === 200 &&
      script.body === toolbarJs && style.body === toolbarCss;
  });

server.close();

report();
