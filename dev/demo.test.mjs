/*
 * Checks for the drivable demo - dev/demo-stub.js and dev/demo-server.mjs.
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
 * an acceptance box reading "drivable" when nothing is implemented, a
 * route the stub answers that the real Worker refuses - is what the
 * owner sees while deciding the cutover, and it is the worse of the two
 * because it produces a screen that looks right. Checks below that carry
 * an F-number are the second kind: each one pins a way this suite was
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
const Form = globalThis.BinderForm;
const Admin = globalThis.BinderAdmin;
const Dashboard = globalThis.BinderDashboard;

const { start, MIRROR_PREFIX, portFrom } = await import("./demo-server.mjs");

const { check, mustReject, report } = suite("demo", 255);

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

await check("the page list is read from apps/web and finds every page there", () =>
  PAGES.length >= 5 && PAGES.includes("index.html") &&
  PAGES.includes("404.html") && PAGES.includes("admin.html") &&
  PAGES.every((page) => typeof shipped[page] === "string" &&
    shipped[page].length > 0));

/* ------------------------------------------------------------------ */
/* The mirror changes what it says it changes, and nothing else.       */

const STUB_SRC = "/dev/demo-stub.js";
const BOOT_SRC = "/dev/demo-boot.js";

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
    const out = Demo.mirror(shipped[page]).html;
    const stub = out.indexOf(STUB_SRC);
    const boot = out.indexOf(BOOT_SRC);
    return stub !== -1 && boot !== -1 && stub < boot;
  }));

await check("the boot constant itself names both dev scripts", () =>
  String(Demo.BOOT_SCRIPTS).includes(STUB_SRC) &&
  String(Demo.BOOT_SCRIPTS).includes(BOOT_SRC));

/*
 * The boot scripts must land AFTER the policy, or the demo stops being
 * evidence that the shipped policy permits what the pages do - a script
 * above the meta tag is not governed by it. Anchored on demo-boot.js
 * rather than on the whole constant for F1's reason.
 */
await check("the boot scripts land after the page's own CSP", () =>
  PAGES.every((page) => {
    const out = Demo.mirror(shipped[page]).html;
    const csp = out.indexOf("Content-Security-Policy");
    return csp !== -1 && out.indexOf(BOOT_SRC) > csp;
  }));

await check("the boot scripts land before the page's own first script", () =>
  PAGES.every((page) => {
    const out = Demo.mirror(shipped[page]).html;
    const boot = out.indexOf(BOOT_SRC);
    const own = out.indexOf("<script", out.indexOf(BOOT_SRC) + BOOT_SRC.length);
    return boot !== -1 && own !== -1;
  }));

await check("only the sign-in page carries the Telegram edit", () =>
  Demo.mirror(shipped["index.html"]).applied.includes("telegram") &&
  PAGES.filter((page) => page !== "index.html").every((page) =>
    !Demo.mirror(shipped[page]).applied.includes("telegram")));

/*
 * The widget's SCRIPT is what must not load; the page's policy still
 * names telegram.org and should, because the demo runs under the policy
 * the site ships rather than a relaxed copy of it.
 */
await check("the mirrored sign-in page loads no third-party script", () => {
  const out = Demo.mirror(shipped["index.html"]).html;
  return !out.includes("telegram-widget.js") &&
    out.includes(Demo.TELEGRAM_STANDIN) &&
    out.includes("script-src 'self'");
});

/*
 * The check that stops the demo snapshotting. Undoing the declared edits
 * has to give back the shipped file byte for byte; anything else the
 * mirror touched survives the undo and shows up here as a difference.
 * Over every page apps/web ships, which is F4's fix.
 */
await check("unmirroring a mirrored page returns the shipped bytes", () =>
  PAGES.every((page) =>
    Demo.unmirror(Demo.mirror(shipped[page]).html) === shipped[page]));

await check("every declared edit is one the mirror actually applies", () => {
  const applied = new Set();
  PAGES.forEach((page) => {
    Demo.mirror(shipped[page]).applied.forEach((id) => applied.add(id));
  });
  return Demo.MIRROR_EDITS.every((edit) => applied.has(edit.id)) &&
    applied.size === Demo.MIRROR_EDITS.length;
});

/*
 * THE EDITS ARE NAMED HERE, AS LITERALS, AND THE COUNT IS SPELLED OUT.
 * The check above compares the table to itself: it holds just as well
 * for two edits, or for five, so an edit added without anybody deciding
 * to add one passes it. What the console renders and what the owner is
 * asked to take on trust is this list, so this is the check that has to
 * fail when it grows.
 */
await check("the mirror declares exactly four edits, and they are these four", () =>
  Demo.MIRROR_EDITS.length === 4 &&
  Demo.MIRROR_EDITS.map((edit) => edit.id).sort().join(",") ===
    "boot,config,links,telegram" &&
  Demo.MIRROR_EDITS.every((edit) =>
    typeof edit.what === "string" && edit.what.length > 0 &&
    typeof edit.why === "string" && edit.why.length > 0));

/*
 * The third edit, and why the demo cannot be hosted without it.
 *
 * config.js keys on location.hostname and knows two: the published site
 * and localhost. Anywhere else it deliberately hands back no endpoint
 * and a null publicKey, so the page guards close - correct for a
 * stranger's fork, fatal for a demo served from any other host. Worse
 * than dead: `config.endpoint + "/me"` with endpoint undefined is the
 * relative URL "undefined/me", which resolves against whatever origin
 * the build is sitting on.
 */
await check("the config edit points every page that loads config.js at the stand-in", () =>
  PAGES.filter((page) => shipped[page].includes('<script src="config.js">'))
    .every((page) => {
      const out = Demo.mirror(shipped[page]).html;
      return out.includes('<script src="/dev/demo-config.js">') &&
        !out.includes('<script src="config.js">') &&
        Demo.mirror(shipped[page]).applied.includes("config");
    }));

await check("a page that loads no config.js gets no config edit", () =>
  PAGES.filter((page) => !shipped[page].includes('<script src="config.js">'))
    .every((page) => !Demo.mirror(shipped[page]).applied.includes("config")));

/*
 * The fourth edit: a link out of the product cannot take the frame with
 * it.
 *
 * Every page apps/web ships carries `<a href="https://github.com/...">`
 * in its footer, with no target - right on the real site, and inside
 * the console's frame a live escape hatch. Clicking it navigates the
 * FRAME to github.com, which refuses to be framed, so the stage goes
 * white and the only way back is pressing another card. Both analysts
 * found it independently; it is the most literal case of the demo
 * "acting like a live app" there is, because a real cross-origin
 * request leaves the machine.
 *
 * Contained here rather than in apps/web because apps/web is the
 * product: the mirror is the demo's one sanctioned way to differ from
 * the shipped bytes, and it is declared, rendered for the owner, and
 * held to an exact undo one screen up. That undo is what makes this
 * safe - the round-trip check above now runs over this edit too, so a
 * containment that also changed anything else fails there.
 */
await check("the mirror sends a link out of the product to its own tab", () =>
  PAGES.every((page) => {
    const out = Demo.mirror(shipped[page]).html;
    const anchors = out.match(/<a [^>]*href="https?:\/\/[^"]*"[^>]*>/g) || [];
    return anchors.length > 0 &&
      anchors.every((tag) => tag.includes('target="_blank"') &&
        tag.includes('rel="noopener noreferrer"'));
  }));

/*
 * And only those. The walk happens by moving around the product, so the
 * rail, the wordmark and every in-page link have to keep landing in the
 * frame - a target on those would open the demo's own pages in tabs the
 * console cannot see, which is the same walk-breaking failure from the
 * other end.
 */
await check("an in-page link is left in the frame, because that is the walk", () =>
  PAGES.every((page) => {
    const out = Demo.mirror(shipped[page]).html;
    const anchors = out.match(/<a [^>]*>/g) || [];
    return anchors.filter((tag) => !/href="https?:\/\//.test(tag))
      .every((tag) => !tag.includes("target="));
  }));

await check("every page carries the link edit, so no page is an escape", () =>
  PAGES.every((page) => Demo.mirror(shipped[page]).applied.includes("links")));

/* ------------------------------------------------------------------ */
/* apps/web pays nothing for the demo.                                 */

await check("nothing in apps/web names the demo", () =>
  Object.values(webSource).every((src) =>
    !src.includes("demo-boot") && !src.includes("demo-stub") &&
    !src.includes("BinderDemo") && !src.includes("/dev/")));

/*
 * F4, second half. The scan above is four literal names, and a hook does
 * not have to use any of them: a shipped page keyed on the demo's own
 * sessionStorage name would read the staged scenario and pass that list
 * untouched. The key names are asked of the demo rather than typed here,
 * so renaming one cannot quietly empty this check.
 */
await check("no shipped file is keyed on the demo's own storage names", () =>
  Demo.STORAGE_KEYS.length > 0 &&
  Demo.STORAGE_KEYS.every((key) =>
    Object.values(webSource).every((src) => !src.includes(key))));

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
 * #90's whole behavior and UAT AL4 rides on it; DELETE /snapshot and
 * POST /snapshot are the same route with opposite meanings.
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
 * owner and a green gate behind it. The blind spot cannot be closed by
 * a wider regex - `${config.endpoint}/x`, `config.endpoint.concat(...)`
 * and a URL assembled in a local all need the parse this suite is not
 * going to grow - so the endpoint's every appearance in shipped code is
 * held to a shape the reader does demonstrably read:
 *
 *   - `.endpoint +` a quoted path, or an identifier (auth.js hands in
 *     one of AUTH_PATHS, and endpointCallsIn resolves that list);
 *   - `.endpoint` read for its truthiness and nothing else, which is
 *     the guard every caller opens with.
 *
 * Anything else fails here rather than vanishing, including the
 * template literal - `}` is not on that list. Comments and their
 * examples are stripped first, the way memberkey.test.mjs strips before
 * asking a source question, because this arm's subject is what the code
 * does and a false red on a paragraph is a gate nobody can read.
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
 *
 * One direction on purpose - every verb+path the stub claims must be one
 * the Worker really routes. The other direction is not asserted, because
 * the Worker legitimately grows routes that apps/web has not called yet,
 * and a suite that went red on another slice's server change would be
 * this demo blocking work it has no opinion about. What apps/web calls
 * is covered by the check above; what the Worker refuses is covered here.
 * The prefix routes are excluded because the Worker matches those with
 * regexes rather than a literal path, and are pinned by name instead.
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

function world(id, extra) {
  return Object.assign({ scenario: id, data: {} }, extra);
}

await check("/me reports four effective entries and no tombstones", () => {
  const answer = Demo.answerFor({ method: "GET", path: "/me" },
    world("member"));
  return answer.status === 200 && answer.body.entries === 4 &&
    answer.body.superseded === 0;
});

await check("the supersede scenario moves the tombstones, not the count", () => {
  const answer = Demo.answerFor({ method: "GET", path: "/me" },
    world("supersede"));
  return answer.body.entries === 4 && answer.body.superseded === 2;
});

await check("the member's account id is the shape submit.js scopes by", () => {
  const answer = Demo.answerFor({ method: "GET", path: "/me" },
    world("member"));
  return typeof answer.body.accountId === "string" &&
    /^[0-9a-f]{64}$/.test(answer.body.accountId);
});

/*
 * #58's line paints only when a numeric id travels with the session, and
 * the offline arm is where the UAT proves it. If this ever went null the
 * demo would silently stop showing the box it exists to show.
 */
await check("the member session carries a numeric Telegram id", () => {
  const member = Demo.scenarioFor("member");
  return /^[0-9]+$/.test(String(member.session.telegramId));
});

await check("a revoked session is refused on every gated route", () =>
  [["GET", "/me"], ["GET", "/snapshot"], ["GET", "/export"],
    ["POST", "/submit"]].every(([method, path]) =>
    Demo.answerFor({ method, path }, world("revoked")).status === 401));

await check("site copy answers even a caller with no session", () =>
  Demo.answerFor({ method: "GET", path: "/content" },
    world("revoked")).status === 200);

/*
 * Signing out has to kill the tab's own session on the next request, or
 * #90 is described rather than demonstrated.
 */
await check("signing out revokes, and the next request is refused", () => {
  const after = Demo.answerFor({ method: "DELETE", path: "/session" },
    world("member")).next;
  return Demo.answerFor({ method: "GET", path: "/me" }, after).status === 401;
});

await check("an unset content document is {} and a 200", () => {
  const answer = Demo.answerFor({ method: "GET", path: "/content" },
    world("config-fallback"));
  return answer.status === 200 &&
    Object.keys(answer.body.content).length === 0;
});

await check("a written content name reads back", () => {
  const after = Demo.answerFor(
    { method: "POST", path: "/content", body: { name: "site.title", value: "X" } },
    world("config-fallback")).next;
  return Demo.answerFor({ method: "GET", path: "/content" }, after)
    .body.content["site.title"] === "X";
});

await check("publishing a snapshot makes it the one that reads back", () => {
  const after = Demo.answerFor(
    { method: "POST", path: "/snapshot", body: { snapshot: 1, bases: {} } },
    world("admin")).next;
  const back = Demo.answerFor({ method: "GET", path: "/snapshot" }, after);
  return back.status === 200 && back.body.snapshot.snapshot === 1;
});

/*
 * A world with both corpora in it, which is what the console really
 * writes: the snapshot route falls back to whichever one the staging
 * names, so `world()` above - whose `data` is empty - cannot tell
 * "nothing published" from "nothing staged" and every arm below would
 * pass against a stub that never drew anything.
 */
const CORPORA = {
  rich: { snapshot: 1, bases: {} },
  sparse: { snapshot: 2, bases: {} },
};
const stagedWorld = (id) => ({ scenario: id, data: CORPORA });

/*
 * UNPUBLISH HAS TO LEAVE A WORLD WITH NOTHING PUBLISHED IN IT.
 *
 * `state.published || <the corpus this staging carries>` read a takedown
 * as "nothing staged yet": DELETE /snapshot answered 200, the world
 * honestly reported `published: null`, and the very next GET handed back
 * the same eighteen entries from six people. Pressing Unpublish was
 * indistinguishable from never having pressed it - so the charts drew
 * on, and UAT A10.1, the row that accepts "nothing published" being
 * distinguishable from being signed out, was marked not drivable
 * because of exactly this.
 *
 * Never-touched and taken-down are `undefined` and `null`, and the two
 * survive the round trip through this demo's sessionStorage because
 * JSON keeps a null and drops an undefined.
 */
await check("taking the snapshot down leaves nothing published", () => {
  const after = Demo.answerFor({ method: "DELETE", path: "/snapshot" },
    stagedWorld("member")).next;
  return Demo.answerFor({ method: "GET", path: "/snapshot" }, after)
    .status === 404;
});

/*
 * The other direction, and the one that stops the arm above being
 * satisfied by a stub that publishes nothing at all: a world nobody has
 * pressed Unpublish in still draws the corpus its staging carries.
 */
await check("a world nobody has taken down still draws the staged corpus", () => {
  const answer = Demo.answerFor({ method: "GET", path: "/snapshot" },
    stagedWorld("member"));
  return answer.status === 200 && answer.body.snapshot.snapshot === 1;
});

/*
 * And per staging, because the fallback picks its corpus by scenario: a
 * takedown that only bit the branch an arm happened to drive would leave
 * the other one drawing, which is the same defect with one witness.
 */
await check("a takedown is a takedown in the sparse staging too", () => {
  const before = Demo.answerFor({ method: "GET", path: "/snapshot" },
    stagedWorld("suppressed"));
  const after = Demo.answerFor({ method: "DELETE", path: "/snapshot" },
    stagedWorld("suppressed")).next;
  return before.status === 200 && before.body.snapshot.snapshot === 2 &&
    Demo.answerFor({ method: "GET", path: "/snapshot" }, after).status === 404;
});

/*
 * AND IT REFUSES IN THE WORKER'S OWN WORDS.
 *
 * server/worker.js deletes the row and then finds no row, so the live
 * product cannot tell a takedown from a binder nobody has published
 * into - both are one 404 with one sentence. A stub inventing a second
 * sentence here would be demonstrating a Worker that does not exist,
 * which is the failure this whole file is built against. Read out of
 * server/worker.js per AGENTS.md's corollary rather than written down a
 * second time here.
 */
await check("the refusal after a takedown is the Worker's own sentence", () => {
  const after = Demo.answerFor({ method: "DELETE", path: "/snapshot" },
    stagedWorld("member")).next;
  const said = Demo.answerFor({ method: "GET", path: "/snapshot" }, after)
    .body.error;
  return typeof said === "string" && said.length > 0 &&
    workerSource.includes(JSON.stringify(said));
});

/*
 * The membership table the admin pane drives (#69).
 *
 * The pane keeps no local model - every write is followed by a fresh GET
 * - so what these arms are really asserting is that the demo can be
 * WRONG. A stub that answered the same document forever would let the
 * pane look correct whether or not it ever asked again, and would leave
 * the two refusals an operator can provoke undrivable.
 */
const membership = (over) => Demo.answerFor(
  Object.assign({ method: "GET", path: "/membership" }, over || {}),
  world("admin"));

await check("granting rows and duds go back in separate lists", () => {
  const answer = membership();
  return answer.status === 200 &&
    answer.body.membership.every((row) => /^[0-9a-f]{64}$/.test(row.account_id)) &&
    answer.body.malformed.length === 1 &&
    /[A-F]/.test(answer.body.malformed[0].account_id);
});

await check("secretOnly names an admin no granting row covers", () =>
  membership().body.secretOnly.length === 1);

await check("adding an id relabels rather than duplicating it", () => {
  const first = Demo.answerFor({
    method: "POST",
    path: "/membership",
    body: { role: "admin", telegramId: "8675309", label: "first name" },
  }, world("admin")).next;
  const again = Demo.answerFor({
    method: "POST",
    path: "/membership",
    body: { role: "admin", telegramId: "8675309", label: "second name" },
  }, Object.assign(world("admin"), first)).next;
  const rows = Demo.answerFor({ method: "GET", path: "/membership" },
    Object.assign(world("admin"), again)).body.membership
    .filter((row) => row.role === "admin");
  return rows.filter((row) => row.label === "second name").length === 1 &&
    rows.filter((row) => row.label === "first name").length === 0;
});

await check("an add the Worker would refuse is refused here too", () =>
  Demo.answerFor({
    method: "POST",
    path: "/membership",
    body: { role: "admin", telegramId: "not-a-number", label: "x" },
  }, world("admin")).status === 400 &&
  Demo.answerFor({
    method: "POST",
    path: "/membership",
    body: { role: "auditor", telegramId: "7", label: "x" },
  }, world("admin")).status === 400 &&
  Demo.answerFor({
    method: "POST",
    path: "/membership",
    body: { role: "admin", telegramId: "7", label: "  " },
  }, world("admin")).status === 400);

await check("a dud is removable by the bytes GET handed back", () => {
  const dud = membership().body.malformed[0].account_id;
  const after = Demo.answerFor(
    { method: "DELETE", path: "/membership/admin/" + dud }, world("admin"));
  return after.status === 200 &&
    Demo.answerFor({ method: "GET", path: "/membership" },
      Object.assign(world("admin"), after.next)).body.malformed.length === 0;
});

await check("the last admin row does not come off", () => {
  // Down to one admin row by removing the other two, then the guard.
  let state = world("admin");
  for (const row of membership().body.membership
    .filter((one) => one.role === "admin").slice(1)) {
    state = Object.assign({}, state, Demo.answerFor(
      { method: "DELETE", path: "/membership/admin/" + row.account_id },
      state).next);
  }
  const dud = Demo.answerFor({ method: "GET", path: "/membership" }, state)
    .body.malformed[0].account_id;
  state = Object.assign({}, state, Demo.answerFor(
    { method: "DELETE", path: "/membership/admin/" + dud }, state).next);

  const left = Demo.answerFor({ method: "GET", path: "/membership" }, state)
    .body.membership.filter((row) => row.role === "admin");
  const refused = Demo.answerFor(
    { method: "DELETE", path: "/membership/admin/" + left[0].account_id },
    state);
  return left.length === 1 && refused.status === 409 &&
    /last admin row/.test(refused.body.error);
});

await check("removing nothing still succeeds", () =>
  Demo.answerFor({
    method: "DELETE",
    path: "/membership/always_allow/" + "f".repeat(64),
  }, world("admin")).status === 200);

await check("a role that is not a role is the same 404 as a bad id", () =>
  Demo.answerFor({
    method: "DELETE", path: "/membership/auditor/" + "a".repeat(64),
  }, world("admin")).status === 404 &&
  Demo.answerFor({
    method: "DELETE", path: "/membership/admin/not-an-account-id",
  }, world("admin")).status === 404);

await check("the export rows come from the committed sample, by path", () => {
  const answer = Demo.answerFor({ method: "GET", path: "/export" },
    world("keyholder"));
  return answer.proxy === "/dev/sample-submissions.json";
});

/* ------------------------------------------------------------------ */
/* F8. The two silent degradations.                                    */

/*
 * A stale scenario id is the state a tab is in after a rename, which is
 * exactly the failure this suite's own header names. Left to fall
 * through, it draws a generic member: a demo answering plausibly from a
 * world nobody staged, which is the false-confidence failure in its
 * purest form. The refusal has to name the id, because the id is the
 * only thing that tells the reader a rename is what happened.
 */
await check("an unknown scenario id refuses, and names the id", () => {
  const answer = Demo.answerFor({ method: "GET", path: "/me" },
    world("member-renamed-last-week"));
  return answer.status === 500 &&
    String(answer.body.error).includes("member-renamed-last-week");
});

await check("a staged scenario still answers, so the refusal is not blanket", () =>
  Demo.answerFor({ method: "GET", path: "/me" }, world("member")).status === 200);

/*
 * Poisoned world state reached JSON.parse inside the replaced fetch and
 * threw a SyntaxError out of it - an unhandled rejection in the page,
 * with nothing on screen saying the demo's own storage is what broke.
 */
await check("a poisoned published snapshot is a stated error, not a throw", () => {
  const answer = Demo.answerFor({ method: "GET", path: "/snapshot" },
    world("admin", { published: "{not json at all" }));
  return answer.status === 500 &&
    String(answer.body.error).toLowerCase().includes("could not be read");
});

/* ------------------------------------------------------------------ */
/* The cards, the scenarios and the boxes are one contract (#209).     */

/*
 * The console addresses the person deciding whether the product is
 * good, not the person auditing the demo (#209). What that person gets
 * is a table of FEATURE CARDS: a title and a blurb in their own terms,
 * and actions that stage a world and open a shipped page. The
 * scenarios stay - they are the staging - but they are plumbing now,
 * and the walk-through steps are gone outright: UAT.md is where a
 * scripted walk lives, and two homes for one script is how the weaker
 * one survives (#192 fell to exactly that).
 */

await check("every scenario has an id and a real starting page", () =>
  Demo.SCENARIOS.every((one) =>
    typeof one.id === "string" && one.id.length > 0 &&
    Demo.DESTINATIONS.some((d) => d.file === one.start)));

await check("no scenario carries a walk-through: the script lives in UAT.md", () =>
  Demo.SCENARIOS.every((one) => one.steps === undefined));

await check("no two scenarios share an id", () =>
  new Set(Demo.SCENARIOS.map((one) => one.id)).size ===
    Demo.SCENARIOS.length);

await check("every scenario names boxes that exist", () =>
  Demo.SCENARIOS.every((one) =>
    (one.boxes || []).every((id) =>
      Demo.BOXES.some((box) => box.id === id))));

await check("every acceptance box is reachable from some scenario", () => {
  const covered = new Set();
  Demo.SCENARIOS.forEach((one) => {
    (one.boxes || []).forEach((id) => covered.add(id));
  });
  return Demo.BOXES.every((box) => covered.has(box.id));
});

/*
 * No palette-walk pin here, and that is deliberate. #140's rule - a
 * walk naming the palette buttons must start on a page that carries
 * them - needs steps to hold, and the demo scripts nobody's hands. The
 * duty is alive elsewhere: the walk is UAT.md's shell section, which
 * every card sends the reader through, and check_web.py's FLYOUT_PAGES
 * and SWATCH_PAGES pin which pages carry the control and in what
 * shape.
 */

/*
 * The cards themselves. Pure data in demo-stub.js so this suite can
 * hold them without a browser; demo-console.js only paints them.
 */
await check("every card has a title, a blurb and at least one action", () =>
  Array.isArray(Demo.FEATURES) && Demo.FEATURES.length > 0 &&
  Demo.FEATURES.every((card) =>
    typeof card.title === "string" && card.title.length > 0 &&
    typeof card.blurb === "string" && card.blurb.length > 0 &&
    Array.isArray(card.actions) && card.actions.length > 0));

await check("no two cards share a title", () =>
  new Set(Demo.FEATURES.map((card) => card.title)).size ===
    Demo.FEATURES.length);

await check("every card action stages a scenario that exists and opens a shipped page", () =>
  Demo.FEATURES.every((card) => card.actions.every((action) =>
    typeof action.label === "string" && action.label.length > 0 &&
    Demo.SCENARIOS.some((one) => one.id === action.scenario) &&
    (action.open === undefined ||
      Demo.DESTINATIONS.some((d) => d.file === action.open)))));

/*
 * Two directions on purpose. An action naming a scenario that does not
 * exist is the check above; a scenario no card reaches is staging
 * nobody can reach from the page, which is drift's favorite shape -
 * it still answers, so nothing looks broken.
 */
await check("every scenario is reachable from some card", () => {
  const reached = new Set();
  Demo.FEATURES.forEach((card) =>
    card.actions.forEach((action) => reached.add(action.scenario)));
  return Demo.SCENARIOS.every((one) => reached.has(one.id));
});

/*
 * The register is the ruling (#209): the cards speak to the person
 * judging the product. Harness words on a card mean the console has
 * started addressing the auditor again, which is the exact failure the
 * redesign removed - so the words are refused by name. The list is a
 * blocklist rather than a grammar because the failure is specific:
 * these are the words this repository uses for its own machinery.
 */
const CARD_JARGON = /\b(scenario|stub|mirror|probe|corpus|storage|harness)\b/i;
await check("a card speaks the driver's language, not the harness's", () =>
  Demo.FEATURES.every((card) =>
    [card.title, card.blurb].concat(card.actions.map((a) => a.label))
      .every((text) => !CARD_JARGON.test(text) && !text.includes("`"))));

/*
 * The page itself. The audit bench - numbered walk steps, the
 * acceptance table, the mirror-edit table - left the console (#209):
 * what those proved lives in this suite and in the issues, where the
 * auditor already reads. What the page carries is the cards and the
 * rail of destinations, because its reader is deciding whether the
 * product is good, not whether the demo is honest.
 */
const consoleHtml = await readFile(HERE("./demo.html"), "utf8");
const consoleCss = await readFile(HERE("./demo.css"), "utf8");
/*
 * Read here rather than beside the key arms far below, because the
 * recorded browser's fetch hands these bytes back and the walks that
 * stage a key are driven from several places in this file - a fixture
 * declared after its first reader is a TDZ error the console reports as
 * "the throwaway key could not be read", which reads like a defect in
 * the console rather than in the order of this file.
 */
const devKeyFile = await readFile(HERE("./test-key.json"), "utf8");
const consoleJs = await readFile(HERE("./demo-console.js"), "utf8");
const bootSource = await readFile(HERE("./demo-boot.js"), "utf8");

await check("the console page carries the cards and the destinations", () =>
  consoleHtml.includes('id="features"') &&
  consoleHtml.includes('id="destinations"') &&
  consoleHtml.includes('id="stage"') &&
  consoleHtml.includes('id="viewports"'));

await check("the audit bench is off the console page", () =>
  !consoleHtml.includes('id="steps"') &&
  !consoleHtml.includes('id="scenarios"') &&
  !consoleHtml.includes('id="boxes"') &&
  !consoleHtml.includes('id="edits"'));

/*
 * AND SO IS THE NOTE ABOUT THE OTHER ARM (owner, 2026-08-10).
 *
 * The console's footer explained which of the two demos this was and how
 * to run the other one against the dev Worker. Whoever can open this
 * page already knows both, so it was a paragraph of setup instructions
 * standing under the working surface for a reader who does not need
 * them. The owner asked for it gone: "Those who have access to the demo
 * know who it's for and what it's on."
 *
 * Checked rather than trusted because the console page has grown a block
 * back before, and the sibling arm one file over asks the same question
 * of the BAKED copy - the one a stranger is handed - which is a
 * different set of bytes reached by a different transform.
 */
await check("the console page carries no footer under the working surface", () =>
  !/<footer[\s>]/.test(consoleHtml) && !consoleHtml.includes("The other arm"));

/*
 * The rules that dressed it go with it. A stylesheet that keeps styling
 * an element the page no longer has is dead weight nobody can tell is
 * dead by reading it, and the next slice to add a footer here would
 * inherit a look decided for a paragraph nobody kept.
 */
await check("the console stylesheet styles no footer either", () =>
  !/(^|[\s,}])footer\s*(,|\{)/m.test(consoleCss));

/*
 * AND SO IS THE WHOLE BLOCK THAT EXPLAINED THE CONSOLE (owner,
 * 2026-08-10, correcting a half-done removal).
 *
 * The footer above was one part of it. The rest - a "Demo console"
 * heading, a paragraph explaining that there are four walks and what
 * Next does, the pledge that nothing reaches a real endpoint, and a
 * sentence about which commit a hosted copy was taken at - was the same
 * thing in a section of its own: setup prose standing under the working
 * surface for a reader who does not need it. The owner's words cover all
 * of it, and were read against the live page: those who have access to
 * the demo know who it is for and what it is on.
 *
 * Asked by id and by the words rather than by the section's class, so
 * moving the same prose into a different wrapper does not put it back
 * quietly. The sibling arm in dev/demo-bake.test.mjs asks the same of
 * the baked bytes, which are reached through a transform that rewrites
 * part of this very page.
 */
const EXPLAINS_ITSELF = [
  "Demo console",
  "Four walks through the Binder",
  "Nothing here reaches a real endpoint",
  'id="offline-note"',
  'id="stamp"',
  'class="about"',
];

await check("the console page carries no block explaining itself", () =>
  EXPLAINS_ITSELF.every((each) => !consoleHtml.includes(each)));

// The rules that dressed it go with it, for the footer's reason: a
// stylesheet still styling an element the page no longer has is dead
// weight nobody can tell is dead by reading it.
await check("the console stylesheet dresses no such block either", () =>
  !/(^|[\s,}])\.(about|lede|warn)\b/m.test(consoleCss) &&
  !/(^|[\s,}])h1\s*(,|\{)/m.test(consoleCss));

/*
 * AND THE STAMP SURVIVES THE REMOVAL, MACHINE-READABLE AND RENDERING
 * NOTHING.
 *
 * The paragraph is gone; the region the bake replaces is not, and it
 * cannot be: dev/demo-bake.mjs refuses to write a snapshot it cannot
 * date, and an undated snapshot on a public URL is read as current
 * forever. So the markers stay and what sits between them is metadata a
 * reader never sees - the property the visible sentence carried, kept,
 * with the sentence itself removed as ordered. Putting it back on screen
 * is a one-line change to stampFor and this file, which is the shape the
 * ruling asked for.
 */
await check("the console keeps the region the bake dates it through", () =>
  Demo.stampInto(consoleHtml, "<meta name=\"x\" content=\"y\">") !== null);

await check("what the live console says about its own age renders nothing", () => {
  const between = consoleHtml.slice(
    consoleHtml.indexOf("<!-- BAKED-AT -->"),
    consoleHtml.indexOf("<!-- /BAKED-AT -->"));
  return /<meta\b[^>]*>/.test(between) &&
    between.replace(/<[^>]*>/g, "").replace(/<!--[\s\S]*?-->/g, "").trim() === "";
});

await check("the console script paints the cards and none of the bench", () =>
  consoleJs.includes('$("features")') &&
  !consoleJs.includes('$("steps")') &&
  !consoleJs.includes('$("scenarios")') &&
  !consoleJs.includes('$("boxes")') &&
  !consoleJs.includes('$("edits")'));

/* ------------------------------------------------------------------ */
/* The console says where the frame IS, never where it was sent.       */

/*
 * The whole routing-desync class, at its one seam.
 *
 * These hold the console to reading its address readout and its
 * "current" destination off THE FRAME, never off the file it asked for.
 * The pages in the frame are real, live JavaScript: an already-signed-in
 * visitor at Sign in is redirected to Your page, a revoked session
 * bounces back to Sign in on load, an auth guard refuses a gated page,
 * and the product's own rail carries somebody anywhere at any time.
 * Every one of those moves the frame without the console being asked, so
 * a console painting from its own press names a page the viewer is
 * plainly not looking at - the owner's "it lands on the wrong forms",
 * reproduced four ways by one analyst and six by the other.
 *
 * So the address is derived from where the frame REALLY IS. The pure
 * half is here, in demo-stub.js, for the reason frameStyleFor is: what
 * the console shows becomes a value this suite can assert, and the
 * browser half only reads a location and assigns.
 */
const CONSOLE_ORIGIN = "http://127.0.0.1:8151";
const at = (href) => Demo.frameAddressOf(href);

await check("the mirror path the console drives is the one the server serves", () =>
  Demo.MIRROR_PATH === MIRROR_PREFIX);

await check("a mirrored page is named by the frame, and its destination is current", () => {
  const there = at(CONSOLE_ORIGIN + Demo.MIRROR_PATH + "charts.html");
  return there.inside === true && there.file === "charts.html" &&
    there.shown === CONSOLE_ORIGIN + Demo.MIRROR_PATH + "charts.html";
});

/*
 * The finding itself, as a value. The console asked for your-page.html
 * and the shipped auth guard answered by putting Sign in on the screen;
 * what the address says is Sign in, because that is what is there.
 */
await check("a page that redirected itself is read at where it landed", () => {
  const asked = "your-page.html";
  const there = at(CONSOLE_ORIGIN + Demo.MIRROR_PATH + "index.html");
  return there.file === "index.html" && there.file !== asked;
});

/*
 * A mirrored page that is no destination highlights none of them.
 * 404.html is a real page of the product and reachable in the frame, and
 * lighting one of the four rail buttons for it would be the same lie in
 * a quieter place.
 */
await check("a mirrored page that is no destination lights none of them", () => {
  const there = at(CONSOLE_ORIGIN + Demo.MIRROR_PATH + "404.html");
  return there.inside === true && there.file === null;
});

/*
 * THE HOST IS ALLOWED TO SERVE A PAGE UNDER A TIDIER NAME, AND THE
 * CONSOLE STILL HAS TO KNOW WHICH PAGE IT IS.
 *
 * The demo is baked to static files and put behind an ordinary static
 * host, and the common ones serve `/demo/your-page.html` by redirecting
 * to `/demo/your-page` - "clean URLs", on by default. The console asks
 * for the file name it knows; what comes back is the same page under a
 * name one character-run shorter.
 *
 * Matching the file name exactly is what broke: the frame is plainly on
 * Your page, `file` reads null, and everything keyed on it goes quiet
 * AT ONCE and WITHOUT SAYING SO - no rail button current, and every
 * stop's errand dropped, because an errand waits for the page it was
 * meant for and that page never appears to arrive. The tour stop that
 * promised the weigh-in form narrated over the list of past entries
 * again, which is the defect this whole file exists to have caught, and
 * it came back through the HOST rather than through the tour.
 *
 * So the extension is the host's to drop, not the console's to depend
 * on. What is NOT allowed is inventing a page: a tidied name that
 * matches nothing is still no destination, or a console recovering from
 * one bad guess would start making them.
 */
await check("a page served without its extension is still that page", () => {
  const there = at(CONSOLE_ORIGIN + Demo.MIRROR_PATH + "your-page");
  return there.inside === true && there.file === "your-page.html";
});

await check("a page served with a trailing slash is still that page", () => {
  const there = at(CONSOLE_ORIGIN + Demo.MIRROR_PATH + "charts/");
  return there.inside === true && there.file === "charts.html";
});

// The other direction, and the one that keeps the tidying honest.
await check("a tidied name matching no page is still no destination", () => {
  const there = at(CONSOLE_ORIGIN + Demo.MIRROR_PATH + "your-pages");
  return there.inside === true && there.file === null;
});

await check("a non-destination page the host tidied lights nothing", () => {
  const there = at(CONSOLE_ORIGIN + Demo.MIRROR_PATH + "404");
  return there.inside === true && there.file === null;
});

/*
 * THE THIRD TIDYING, WHICH IS THE ONE THAT FIRES ON THE SIGN-IN PAGE.
 *
 * The two above are the host shortening a name. This one takes the name
 * away entirely: a clean-URL host serves a directory's index page at the
 * directory, so `/demo/index.html` answers 308 to `/demo/` and the frame
 * reports an address with no file in it at all. The arms above never
 * reached it because all four of them probe a name.
 *
 * Two of the four journeys open on the sign-in page, so on the hosted
 * build they landed with no rail button lit and "Open this page in its
 * own tab" pressing nothing - the same silent class the tidying arms
 * were written for, arriving through the one tidying they did not cover.
 */
await check("the directory root is the index page the host serves there", () => {
  const there = at(CONSOLE_ORIGIN + Demo.MIRROR_PATH);
  return there.inside === true && there.file === "index.html";
});

/*
 * And the strictness, which is what keeps that from becoming "every
 * directory is the sign-in page". The mirror carries a fonts directory
 * that is no page at all, and a fold that resolved it would light a rail
 * button for a folder.
 */
await check("a directory inside the mirror that is no page lights nothing", () => {
  const there = at(CONSOLE_ORIGIN + Demo.MIRROR_PATH + "fonts/");
  return there.inside === true && there.file === null;
});

/*
 * AND THE ROOT'S ANSWER IS LOOKED UP, WHICH HAS TO BE FALSIFIABLE.
 *
 * The fold sends the root back through the destination lookup rather
 * than handing back the directory index outright, so a directory index
 * that is no destination resolves to nothing. `index.html` IS one of the
 * four today, so those two readings agree on every address a suite can
 * build out of the module's own list: substituting the constant for the
 * lookup left this file at its full count, green, with the strictness
 * gone. That is an unfalsifiable branch wearing a checked branch's
 * clothes, and the arms above cannot see it because all of them go
 * through DESTINATIONS.
 *
 * So the list the lookup reads is a parameter of it. It costs one
 * argument and it buys the question being askable at all: given a set of
 * destinations the directory index is NOT in, does the root still
 * resolve to nothing? The console passes its own list and behaves
 * exactly as before.
 */
await check("the directory root is looked up, not assumed", () =>
  Demo.destinationUnder("", [{ file: "charts.html" }]) === null &&
  Demo.destinationUnder("/", [{ file: "charts.html" }]) === null);

// The other direction: with the index among them the root IS the page
// the host serves there, which is what /demo/ really does on the baked
// build - and the arm above alone would be satisfied by a fold that
// resolved nothing at all.
await check("the directory root is the index page when that is a destination", () =>
  Demo.destinationUnder("", Demo.DESTINATIONS) === "index.html" &&
  Demo.destinationUnder("/", [{ file: "index.html" }]) === "index.html");

/*
 * And the escape, which the link containment above now prevents and this
 * refuses to paper over anyway. A frame that left the demo cannot be
 * read at all - the browser refuses the cross-origin location - and the
 * console's last honest act is to say so rather than keep showing the
 * page it last asked for. Defence in depth: the containment is the fix,
 * this is what the viewer sees if anything ever gets past it.
 */
await check("a frame that cannot be read is said to have left, not guessed at", () => {
  const there = at(null);
  return there.inside === false && there.file === null &&
    typeof there.shown === "string" && there.shown.length > 0 &&
    /demo/i.test(there.shown);
});

await check("an address outside the mirror is no page of the product", () => {
  const there = at("https://github.com/Potaetoe/hang-gangs-binder");
  return there.inside === false && there.file === null;
});

await check("an address that will not parse is refused, not read as a page", () =>
  at("http://[").inside === false && at("http://[").file === null);

/*
 * THE WIRING, EARNED BY RUNNING THE BYTES (#154 F1's rule, applied to
 * the console instead of the boot file).
 *
 * A source-string arm here would ask whether demo-console.js CONTAINS
 * the word "load", which the comment explaining the listener contains
 * too. What has to be true is that the console listens to the FRAME and
 * repaints from the frame's own location - so the real file runs under
 * node:vm against a RECORDED browser, exactly the way demo-boot.js is
 * driven below, and the recording is asked what the console did.
 *
 * The recorded frame is the load-bearing part: its contentWindow
 * reports a location the console never set, which is the situation
 * every finding in this class arrives through.
 */
const CONSOLE_IDS = ["features", "destinations", "viewports", "status",
  "feed", "try-next", "stage", "frame-path", "open-tab", "reset",
  "tours", "tour-run", "tour-where", "tour-title", "tour-narration",
  "tour-back", "tour-next", "tour-leave", "glass"];

/*
 * WHY textContent IS A SETTER HERE AND NOT A FIELD. The console empties
 * a holder with `holder.textContent = ""` before repainting it, and in a
 * real document that REMOVES THE CHILDREN. A recording that kept them
 * would accumulate every generation of destination buttons, so a console
 * painting the wrong thing and then the right thing over it would read
 * as two pressed buttons rather than one - which is a fixture that fails
 * for a reason next to the one under test. Found by mutation: M1 failed
 * an arm it was not supposed to reach.
 */
/*
 * `log`, when one is passed, records WHAT WAS DONE TO THIS NODE AND IN
 * WHAT ORDER, which is a different question from what was done at all.
 *
 * A stop can fill the key box, press the page's decrypt button and move
 * the page to the card that press reveals, and every one of those can
 * be true while the sequence is useless: a key written after the press
 * leaves the product answering "paste or choose your key file first",
 * and a move made before the page has revealed the card scrolls to
 * nothing. Sets that record membership cannot see either, so the frame's
 * nodes share one ordered list.
 */
function recordedNode(id, log) {
  const note = (what) => { if (log) log.push(what + " " + id); };
  const it = {
    id: id,
    className: "",
    pressed: false,
    /*
     * A DISABLED CONTROL SWALLOWS click() ENTIRELY - no event is
     * dispatched, nothing throws, and the caller cannot tell that from a
     * press that was received. Recorded that way rather than as a flag
     * an arm could read, because a fixture where the press "worked but
     * was ignored" is a fixture that cannot reproduce the defect: the
     * admin page ships its decrypt button disabled and enables it when
     * its own session check answers.
     */
    click() {
      if (it.disabled === true) return;
      it.pressed = true;
      note("pressed");
      it.fire("click");
    },
    // What a stop's scroll asks of a section: the page brings itself
    // there. Recorded rather than run, because what is under test is
    // WHICH section was asked - a recording that measured a layout
    // would be measuring one this fixture invented.
    broughtIntoView: false,
    scrollIntoView() { it.broughtIntoView = true; note("scrolled"); },
    // Whether this node PAINTS, which is a different question from
    // whether it exists - several of the admin surface's sections are in
    // the markup and hidden until the page's own code reveals them.
    // Rendering by default, so an arm has to opt a node out.
    rendering: true,
    getClientRects() { return it.rendering ? [{}] : []; },
    style: {},
    dataset: {},
    children: [],
    attrs: {},
    scrollTop: 0,
    scrollHeight: 0,
    listeners: {},
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
    fire(type) {
      (it.listeners[type] || []).slice()
        .forEach((fn) => fn({ currentTarget: it, target: it }));
    },
  };
  let text = "";
  Object.defineProperty(it, "textContent", {
    enumerable: true,
    get: () => text,
    set: (value) => { text = String(value); it.children.length = 0; },
  });
  // A form control's own field: the console writes a key into `value`,
  // which is what the shipped page would see from a person pasting one.
  // An accessor rather than a plain field so the write takes its place
  // in the order above - the key going in AFTER the press reads
  // identically to the key going in first, on the value alone.
  let held = "";
  Object.defineProperty(it, "value", {
    enumerable: true,
    get: () => held,
    set: (value) => { held = String(value); note("filled"); },
  });
  return it;
}

function consoleInRecordedBrowser() {
  const nodes = {};
  const kept = {};
  const timers = [];
  const fetched = [];
  const opened = [];
  CONSOLE_IDS.forEach((id) => { nodes[id] = recordedNode(id); });

  const replaced = [];
  nodes.stage.contentWindow = {
    location: {
      href: null,
      replace(href) { replaced.push(String(href)); },
    },
  };

  /*
   * The page inside the frame, as much of it as the console touches:
   * it looks controls up by id, presses one, writes a key into another,
   * and pokes the document itself to say somebody is here. Nodes are
   * made on demand, so an errand naming a control this recording never
   * heard of still gets an object - which is the case worth recording,
   * because a console that quietly found nothing is exactly what the
   * arms above are trying to catch.
   */
  const frameNodes = {};
  const acts = [];
  const inFrame = (id) => {
    if (!(id in frameNodes)) frameNodes[id] = recordedNode(id, acts);
    return frameNodes[id];
  };
  const poked = [];
  // Controls this recording answers for with null, so an arm can stand a
  // page up that does NOT carry what a stop asked for - the rename that
  // lands between the page and the tour. Everything else is made on
  // demand, so the default page has whatever it is asked for.
  const absent = new Set();
  /*
   * Listeners the console puts on the page in the frame, and the real
   * DOM's registration rule with them: one listener per (type, function)
   * pair, so re-arming on every arrival adds nothing. A recording that
   * stacked them would answer one press as several, which is the shape
   * of fixture that makes a console counting arrivals look correct.
   */
  const frameWatchers = {};
  nodes.stage.contentDocument = {
    getElementById: (id) => (absent.has(id) ? null : inFrame(id)),
    dispatchEvent: (event) => { poked.push(event.type); },
    addEventListener(type, fn) {
      const kept = (frameWatchers[type] = frameWatchers[type] || []);
      if (!kept.includes(fn)) kept.push(fn);
    },
  };

  const context = {
    BinderDemo: Demo,
    document: {
      getElementById: (id) => nodes[id] || null,
      createElement: (tag) => recordedNode(tag),
    },
    location: { origin: CONSOLE_ORIGIN },
    // A real store rather than a sink: the staging IS three writes into
    // it, so a recording that swallowed them could not tell a stop that
    // staged its world from one that staged nothing.
    sessionStorage: {
      getItem: (key) => (key in kept ? kept[key] : null),
      setItem: (key, value) => { kept[key] = String(value); },
      removeItem: (key) => { delete kept[key]; },
    },
    localStorage: {
      setItem: (key, value) => { kept[key] = String(value); },
      removeItem: (key) => { delete kept[key]; },
    },
    // The corpus worker is refused rather than recorded: buildCorpus
    // already has an arm for a browser that cannot start one, and what
    // is under test here is the frame, not the charts.
    Worker: function () { throw new Error("no worker in this recording"); },
    /*
     * A tab of its own, recorded rather than swallowed. "Open this page
     * in its own tab" was keyed on the frame being on one of the four
     * destinations with no else, so on a page that is none of them the
     * press did nothing and said nothing - and a recording that dropped
     * the call could not tell that from a press that opened something.
     */
    open(url, target) { opened.push(String(url) + " " + String(target)); },
    /*
     * The keep-awake timer, recorded rather than run. What matters is
     * WHETHER one is pending, because that is the whole claim: the
     * console tells the frame somebody is here while a stop is being
     * narrated, and stops the moment the frame is handed over. Actually
     * firing it would make these arms wait a minute each.
     */
    setInterval: (fn, every) => {
      timers.push({ fn, every });
      return timers.length;
    },
    clearInterval: (handle) => {
      if (handle >= 1 && handle <= timers.length) timers[handle - 1] = null;
    },
    /*
     * The console's wait for a section the page reveals by its own work,
     * run at once rather than on a clock.
     *
     * The wait is spent in TRIES, not in milliseconds, precisely so a
     * recording can spend all of them without waiting - a fixture that
     * honored the delay would make the give-up arms below take the
     * console's whole budget each, and one that swallowed the callback
     * would prove the console gives up rather than that it waits. This
     * spends the budget the console really has, immediately.
     */
    setTimeout: (fn) => { fn(); return 0; },
    Event: function (type) { this.type = type; },
    /*
     * The console's own fetch, which is NOT the one demo-boot.js
     * replaces: the console runs outside the frame, so this is the real
     * one, and the only thing it is ever asked for is the committed
     * throwaway key. Recorded by URL so an arm can say which file was
     * read, and answered with the bytes on disk so what lands in the
     * key box is the file rather than a stand-in for it.
     */
    fetch: (url) => {
      fetched.push(String(url));
      return Promise.resolve({ text: () => Promise.resolve(devKeyFile) });
    },
  };
  vm.createContext(context);
  vm.runInContext(consoleJs, context, { filename: "demo-console.js" });

  const arrive = (file) => {
    nodes.stage.contentWindow.location.href =
      CONSOLE_ORIGIN + Demo.MIRROR_PATH + file;
    nodes.stage.fire("load");
  };
  /*
   * A press landing on the page INSIDE the frame, and the one field that
   * says whose press it was.
   *
   * `isTrusted` is the browser's own answer to "did a person do this",
   * and it is the only thing separating the viewer clicking the
   * product's nav rail from the console's own control.click() or a
   * page's script clicking something for itself. Recorded with the flag
   * settable so an arm can stand up either, because the console's whole
   * new distinction is between them and a fixture that could only
   * produce one of the two could not test it.
   */
  const pressInFrame = (trusted) => {
    (frameWatchers.click || []).slice().forEach((fn) =>
      fn({ type: "click", isTrusted: trusted }));
  };
  const pressed = () => nodes.destinations.children
    .filter((one) => one.getAttribute("aria-pressed") === "true")
    .map((one) => one.title);
  const destination = (file) =>
    nodes.destinations.children.find((one) => one.title === file);
  // The walk button lives inside its journey's card, so this looks
  // through the card rather than only at it - the recording has no
  // querySelector, and adding one would be a fixture inventing a
  // convenience the console does not use.
  const journey = (id) => {
    let found;
    nodes.tours.children.forEach((card) => {
      card.children.forEach((child) => {
        if (child.dataset.tour === id) found = child;
      });
    });
    return found;
  };
  /*
   * A free-drive card's action button, one level deeper than a journey's:
   * the buttons share a row inside the card, so this walks the card's
   * children and then that row's. Looked up by the LABEL a viewer reads,
   * because that is the button an arm is claiming somebody presses.
   */
  const cardAction = (label) => {
    let found;
    nodes.features.children.forEach((card) => {
      card.children.forEach((part) => {
        part.children.forEach((button) => {
          if (button.textContent === label) found = button;
        });
      });
    });
    return found;
  };
  const locked = () => nodes.glass.getAttribute("hidden") === null;
  const staged = () => kept[Demo.STORAGE_KEYS[0]];
  const waking = () => timers.filter((one) => one !== null);
  const frameField = (id) =>
    (id in frameNodes ? frameNodes[id].value : "");
  const framePressed = () =>
    Object.keys(frameNodes).filter((id) => frameNodes[id].pressed === true);
  // Staging the key is asynchronous - the console reads the file and
  // then writes it - so an arm has to let those settle before asking
  // what is in the box. A macrotask drains the microtasks under it.
  const settled = () => new Promise((done) => { setTimeout(done, 0); });

  const missingInFrame = (id) => { absent.add(id); };
  const frameScrolled = () =>
    Object.keys(frameNodes).filter((id) => frameNodes[id].broughtIntoView);
  // Everything the console did to the page in the frame, in order.
  const frameActs = () => acts.slice();
  // A section the page carries but is not showing - the hidden admin
  // tools, which is the case a present-or-absent test cannot see.
  const unpaintedInFrame = (id) => { inFrame(id).rendering = false; };

  /*
   * A section the page reveals BY ITS OWN WORK, some way after the press
   * that starts it - which is what the admin surface really does with
   * its publishing card, because the decrypt in between is a fetch and a
   * few hundred unseals.
   *
   * Not painting at all until the control is pressed, and then not for
   * `after` more looks. Both halves matter: a fixture that painted on
   * the press would be satisfied by a console that looked exactly once
   * and happened to be lucky, and one that never painted could not tell
   * waiting from giving up.
   */
  /*
   * A control the page has not enabled yet, and enables `after` looks
   * later - which is what the admin surface really does with its
   * decrypt button while its session check is in flight.
   *
   * The count is spent on READS of `disabled`, so the console has to be
   * the one asking: a fixture that flipped on a timer would go pressable
   * whether or not anybody looked, and could not tell waiting from
   * getting lucky.
   */
  const pressableAfter = (id, after) => {
    let left = after;
    Object.defineProperty(inFrame(id), "disabled", {
      configurable: true,
      get: () => {
        if (left <= 0) return false;
        left -= 1;
        return true;
      },
      set: () => {},
    });
  };
  const neverPressable = (id) => { inFrame(id).disabled = true; };

  const paintedAfterPressing = (id, controlId, after) => {
    const section = inFrame(id);
    let left = Infinity;
    section.getClientRects = () => {
      if (left <= 0) return [{}];
      left -= 1;
      return [];
    };
    inFrame(controlId).addEventListener("click", () => { left = after; });
  };

  return {
    nodes, replaced, arrive, pressInFrame, pressed, destination, journey,
    cardAction, locked, staged, waking, frameField, framePressed, poked,
    fetched, opened, settled,
    missingInFrame, frameScrolled, frameActs, unpaintedInFrame,
    paintedAfterPressing, pressableAfter, neverPressable,
  };
}

await check("the console repaints its address from the frame's own arrival", () => {
  const browser = consoleInRecordedBrowser();
  browser.destination("your-page.html").fire("click");
  // The shipped auth guard answers by putting Sign in on the screen.
  browser.arrive("index.html");
  return browser.nodes["frame-path"].textContent ===
      CONSOLE_ORIGIN + Demo.MIRROR_PATH + "index.html" &&
    browser.pressed().join(",") === "index.html";
});

/*
 * The compounding half, and the reason the resync alone is not the whole
 * repair: setting an iframe's `src` to the string it already holds
 * reloads nothing in any browser. Once a page has redirected itself, the
 * string the frame still holds is the page the viewer wants back - so
 * the button for it is a press that does nothing, with no way for the
 * console to say so. Replacing the frame's own location is the
 * navigation that always happens.
 */
await check("a press moves the frame even when the frame already holds that page", () => {
  const browser = consoleInRecordedBrowser();
  browser.destination("index.html").fire("click");
  const first = browser.nodes.stage.getAttribute("src");
  browser.arrive("your-page.html");
  browser.destination("index.html").fire("click");
  return first === Demo.MIRROR_PATH + "index.html" &&
    browser.replaced.join(",") === Demo.MIRROR_PATH + "index.html";
});

/*
 * Non-vacuity for the two arms above: a recording whose frame never
 * moves on its own would let a console that still paints from its own
 * press pass both. This one asserts the console does NOT claim a page
 * before the frame has arrived at it - the press assigns, the arrival
 * paints, and between them the readout still names the page actually on
 * screen.
 */
await check("a press claims nothing until the frame has arrived", () => {
  const browser = consoleInRecordedBrowser();
  browser.arrive("index.html");
  browser.destination("charts.html").fire("click");
  return browser.nodes["frame-path"].textContent ===
      CONSOLE_ORIGIN + Demo.MIRROR_PATH + "index.html" &&
    browser.pressed().join(",") === "index.html";
});

/*
 * OPEN THIS PAGE IN ITS OWN TAB, AND THE PAGE IT CANNOT OPEN.
 *
 * The button takes whichever of the four destinations the frame is
 * showing out of the frame, and it was written as that answer being
 * non-null with no else at all. On `404.html` - a real page of the
 * product, reachable in the frame and none of the four, which is why
 * frameAddressOf reports it as inside with no file - the press did
 * nothing and SAID nothing: the same silent class the address readout
 * exists to end, sitting on the one control UAT A1.19 sends a driver
 * through for every page it compares against the mockup.
 */
await check("the own-tab press opens the destination the frame is on",
  async () => {
    const browser = consoleInRecordedBrowser();
    // Setting up says its own last word from a promise - this recording
    // has no worker, so the corpus reports itself missing. Draining it
    // first is what makes "the press changed nothing here" a claim about
    // the press.
    await browser.settled();
    browser.arrive("charts.html");
    const before = browser.nodes.status.textContent;
    browser.nodes["open-tab"].fire("click");
    return browser.opened.join(",") ===
        Demo.MIRROR_PATH + "charts.html _blank" &&
      browser.nodes.status.textContent === before;
  });

/*
 * And the direction that was missing. The sentence names the address the
 * frame is really on, because that address is what a viewer does next -
 * asking for it by hand is the only way to read that page at the
 * window's own width, and it is what UAT's own names paragraph sends
 * them to do.
 */
await check("the own-tab press says so when the frame is on no destination",
  async () => {
    const browser = consoleInRecordedBrowser();
    await browser.settled();
    browser.arrive("404.html");
    browser.nodes["open-tab"].fire("click");
    return browser.opened.length === 0 &&
      browser.nodes.status.textContent.includes(
        CONSOLE_ORIGIN + Demo.MIRROR_PATH + "404.html");
  });

/* ------------------------------------------------------------------ */
/* The journeys: nine chips become four walks (#238).                  */

/*
 * A grid of nine state names is not a walk. It tells somebody what the
 * product HAS and never what to press first, so a cold viewer builds
 * their own order and the demo is different every time it is shown.
 * The owner's ruling is a scripted one: four journeys, each a sequence
 * of stops, each stop a staged world plus a page plus the sentence
 * that says what to look at.
 *
 * The cards do not go. They keep every arm above - the register, the
 * two-way scenario coverage, the pointer per action - and move behind a
 * free-drive disclosure for a tester who wants one feature rather than
 * a story. What changes is which of the two is the landing screen.
 */
await check("every journey has an id, a title, a blurb and stops", () =>
  Array.isArray(Demo.TOURS) && Demo.TOURS.length === 4 &&
  Demo.TOURS.every((walk) =>
    typeof walk.id === "string" && walk.id.length > 0 &&
    typeof walk.title === "string" && walk.title.length > 0 &&
    typeof walk.blurb === "string" && walk.blurb.length > 0 &&
    Array.isArray(walk.stops) && walk.stops.length > 0));

await check("no two journeys share an id or a title", () =>
  new Set(Demo.TOURS.map((walk) => walk.id)).size === Demo.TOURS.length &&
  new Set(Demo.TOURS.map((walk) => walk.title)).size === Demo.TOURS.length);

/*
 * One journey is where somebody starts, and the table of contents says
 * so. A reader given four equal doors picks one at random, which is the
 * problem the journeys exist to solve, moved up a level.
 */
await check("exactly one journey is the one to start with", () =>
  Demo.TOURS.filter((walk) => walk.first === true).length === 1);

/*
 * DRIVABLE, in the sense the two-way promise uses: a stop names a
 * staging that exists and a page apps/web actually ships. A stop naming
 * neither is a step in a script nobody can walk.
 */
await check("every stop stages a real world and opens a shipped page", () =>
  Demo.TOURS.every((walk) => walk.stops.every((stop) =>
    Demo.SCENARIOS.some((one) => one.id === stop.scenario) &&
    (stop.open === undefined ||
      Demo.DESTINATIONS.some((d) => d.file === stop.open)))));

/*
 * The other direction, and it is the one that catches drift: a staging
 * no journey reaches is a world the scripted demo never shows. The
 * cards keep their own copy of this arm, so both surfaces are held -
 * losing either is how a staging goes quietly unwalked.
 */
await check("every staging is reached by some journey stop", () => {
  const reached = new Set();
  Demo.TOURS.forEach((walk) =>
    walk.stops.forEach((stop) => reached.add(stop.scenario)));
  return Demo.SCENARIOS.every((one) => reached.has(one.id));
});

/*
 * THE GLASS COMES OFF AT THE END OF A JOURNEY, NEVER IN THE MIDDLE
 * (the owner's re-cut). Every journey finishes on a stop that hands the
 * frame over, and no earlier stop does - which is the whole shape of
 * the promise: read along, then drive. A journey with the free stop in
 * the middle would leave the rest of its script being narrated over a
 * page the viewer has already wandered off.
 */
await check("every journey ends by handing the frame over, and only then", () =>
  Demo.TOURS.every((walk) =>
    walk.stops[walk.stops.length - 1].free === true &&
    walk.stops.slice(0, -1).every((stop) => stop.free !== true)));

await check("a journey speaks the driver's language, not the harness's", () =>
  Demo.TOURS.every((walk) =>
    [walk.title, walk.blurb]
      .concat(walk.stops.map((stop) => stop.title))
      .concat(walk.stops.map((stop) => stop.narration))
      .every((text) => typeof text === "string" && text.length > 0 &&
        !CARD_JARGON.test(text) && !text.includes("`"))));

/*
 * A stop that presses something in the frame names a control THE
 * SHIPPED PAGE ACTUALLY CARRIES, read out of apps/web rather than
 * trusted.
 *
 * This is AGENTS.md's corollary: a check computed entirely from the
 * file it guards cannot detect that the file was rearranged. The
 * prefill stop exists because the staging lands on the tab that does
 * not show the prefilled form, and the fix is the tour pressing the
 * other tab - so the day that tab is renamed, this fails here rather
 * than becoming a stop that silently presses nothing and shows the
 * wrong tab again.
 */
await check("a stop that presses a control names one the page really has", () =>
  Demo.TOURS.every((walk) => walk.stops.every((stop) => {
    if (stop.press === undefined) return true;
    const page = stop.open ||
      Demo.SCENARIOS.find((one) => one.id === stop.scenario).start;
    return shipped[page].includes('id="' + stop.press + '"');
  })));

// Non-vacuity: an arm over no presses passes forever.
await check("at least one stop really does press a control", () =>
  Demo.TOURS.some((walk) =>
    walk.stops.some((stop) => typeof stop.press === "string")));

/*
 * A stop that moves the page names a section THE SHIPPED PAGE REALLY
 * CARRIES, read out of apps/web exactly as a press is.
 *
 * The admin surface is one long page - key box, publishing, membership -
 * so a stop can be on the right page with its subject a screen and a
 * half below the fold, which is the tab defect at a different
 * granularity. The day a section is renamed this fails here, rather than
 * becoming a stop that scrolls nowhere and narrates over the top of the
 * page again.
 */
await check("a stop that scrolls names a section the page really has", () =>
  Demo.TOURS.every((walk) => walk.stops.every((stop) => {
    if (stop.scroll === undefined) return true;
    const page = stop.open ||
      Demo.SCENARIOS.find((one) => one.id === stop.scenario).start;
    return shipped[page].includes('id="' + stop.scroll + '"');
  })));

// Non-vacuity: an arm over no scrolls passes forever.
await check("at least one stop really does move the page", () =>
  Demo.TOURS.some((walk) =>
    walk.stops.some((stop) => typeof stop.scroll === "string")));

/* ------------------------------------------------------------------ */
/* A stop that promises a control the page has not revealed yet.        */

/*
 * THE DEFECT: THE NARRATION WAS TRUE ABOUT A CARD NOBODY COULD SEE.
 *
 * "Publishing a fresh set of figures is one press" was narrated over an
 * admin page whose publishing card is `hidden` in the shipped markup and
 * revealed only after a successful decrypt. So the stop opened on the
 * key box, the one press it named was not on the screen at all, and the
 * only visible control from that family was Unpublish - the opposite act
 * - which is worse than a missing control because it reads as the one
 * being described.
 *
 * The stop cannot be fixed by scrolling: scrollIntoView on a section
 * that is not rendering moves nothing. What makes the sentence true is
 * doing the work the page gates the card behind - the key in the box,
 * the page's own decrypt pressed - and then moving to the card. So the
 * arms below hold three things at once, and the third is the reviewer's
 * sharpening: the card that gets scrolled to has to be the PUBLISH one.
 *
 * The card and the button are read out of apps/web rather than named
 * here, per AGENTS.md's corollary: a check computed entirely from the
 * tour cannot notice that the page was rearranged under it.
 */
const ADMIN_PAGE = "admin.html";

/*
 * The element the shipped page keeps a control inside, by id.
 *
 * The last `<div>` carrying an id opened before the control is its
 * section - the wrappers in between (`field`, `row`) carry classes and
 * no id. A page that nests two identified divs around a control breaks
 * this reading, and it fails loudly here rather than quietly resolving
 * to the outer one, because every arm below compares the answer to
 * another answer from this same function.
 */
function sectionHolding(html, controlId) {
  const at = html.indexOf('id="' + controlId + '"');
  if (at === -1) return null;
  const opened = Array.from(
    html.slice(0, at).matchAll(/<div\b[^>]*\bid="([^"]+)"[^>]*>/g));
  return opened.length === 0 ? null : opened[opened.length - 1][1];
}

const publishSection = sectionHolding(shipped[ADMIN_PAGE], "publish");
const DECRYPT = "run";

/*
 * The hazard itself, as a fact about the shipped page: the card is in
 * the markup and hidden, and the page's own code is what reveals it.
 * Without this, every arm below is a set of promises about a card that
 * might have been on screen all along - and the restage they hold would
 * be ceremony rather than a fix.
 */
await check("the shipped page keeps its publishing card hidden until it decrypts", () =>
  new RegExp('<div[^>]*id="' + publishSection + '"[^>]*\\shidden')
    .test(shipped[ADMIN_PAGE]) &&
  webSource["admin.js"].includes('show($("' + publishSection + '"), true)'));

/*
 * F0's sharpening, held to the page. Unpublish lives in its own section
 * above the key gate, so it is visible in this staging from the start -
 * which is exactly why "scroll to the publishing controls" is not
 * satisfied by scrolling to it.
 */
await check("the card those stops move to holds Publish and not Unpublish", () =>
  typeof publishSection === "string" && publishSection.length > 0 &&
  sectionHolding(shipped[ADMIN_PAGE], "unpublish") !== publishSection);

/*
 * And the control they press is the page's own decrypt button, pinned by
 * its id AND by the words on it. Either half alone rots: an id can be
 * renamed under the tour, and a button can keep its id while becoming
 * something else entirely.
 */
await check("the control those stops press is the page's own decrypt button", () =>
  new RegExp('<button[^>]*id="' + DECRYPT + '"[^>]*>\\s*Fetch and decrypt\\s*<')
    .test(shipped[ADMIN_PAGE]));

/*
 * WHICH stops have to declare all three, and which must declare none -
 * the same both-directions shape the tab arm carries, for the same
 * reason: "names a control the page has" is satisfied by declaring
 * nothing, so an arm that only ran one way would go green the day
 * somebody deleted the declaration.
 *
 * The trigger is the shipped button's own first word, so a stop is about
 * publishing when it uses the page's word for it. Read rather than
 * written down, because a trigger typed here is a trigger that stops
 * matching the day the product renames the act and says nothing.
 */
const publishLabel = /<button[^>]*id="publish"[^>]*>\s*([^<]+?)\s*</
  .exec(shipped[ADMIN_PAGE]);
/*
 * A page with no such button falls back to the word rather than throwing
 * here. Not a softening: the arm above already fails in that case, and
 * it fails as a reported check - where a throw at file scope takes the
 * hundred checks after it down with it and leaves a gate that says which
 * line died rather than which invariant broke. Found by mutation (M20).
 */
const PROMISES_PUBLISHING = new RegExp("\\b" +
  (publishLabel === null ? "publish" : publishLabel[1].split(/\s+/)[0]) +
  "\\w*", "i");

const onAdminPage = (stop) =>
  (stop.open || Demo.SCENARIOS.find((one) => one.id === stop.scenario).start)
    === ADMIN_PAGE;

await check("a stop that promises publishing stages its way to the card, and only those do",
  () => Demo.TOURS.every((walk) => walk.stops.every((stop) => {
    if (!onAdminPage(stop)) return true;
    const about = PROMISES_PUBLISHING.test(stop.title + " " + stop.narration);
    const staged = stop.key === true && stop.press === DECRYPT &&
      stop.scroll === publishSection;
    return about === staged;
  })));

// Non-vacuity in both directions: the partition is real, not one side.
await check("the admin page carries stops on both sides of that line", () => {
  const stops = Demo.TOURS.flatMap((walk) => walk.stops).filter(onAdminPage);
  return stops.some((stop) =>
    PROMISES_PUBLISHING.test(stop.title + " " + stop.narration)) &&
    stops.some((stop) =>
      !PROMISES_PUBLISHING.test(stop.title + " " + stop.narration));
});

/*
 * THE SAME PARTITION OVER THE FREE DRIVE, BECAUSE THE DEAD END CAME
 * BACK THROUGH THE CARDS AGAIN (#254 F5).
 *
 * The partition above was written over journey stops, and the card that
 * says "Publish a fresh snapshot, then open Muse's charts and see it
 * drawn" staged none of it. So the button that promises publishing
 * opened the admin page on its key box, with the publishing card still
 * hidden: `#publish` reported `disabled: false` and rendered nothing at
 * all, the press did nothing, and nothing said so. It is the neighbour
 * of the desk card whose key dead end this slice already removed, and it
 * is the card UAT sends a driver to by name for A10.1.
 *
 * The rule is extended rather than the card exempted. A card promising
 * an act is the same promise a stop makes - same page, same hidden
 * section, same viewer - and the day a card is allowed to promise what
 * the screen does not show is the day this partition stops meaning
 * anything.
 *
 * The words read are everything a viewer has in front of them before
 * pressing: the card's title and blurb, and the button's own label and
 * pointer. A trigger read off the button alone would miss a card whose
 * promise is in its blurb, which is where this one's is.
 */
const cardActionsOnAdmin = Demo.FEATURES.flatMap((card) =>
  card.actions
    .filter((action) =>
      (action.open || Demo.scenarioFor(action.scenario).start) === ADMIN_PAGE)
    .map((action) => ({
      action: action,
      words: [card.title, card.blurb, action.label, action.try].join(" "),
    })));

await check("a card action that promises publishing stages its way to the card, and only those do",
  () => cardActionsOnAdmin.length > 0 && cardActionsOnAdmin.every((one) => {
    const about = PROMISES_PUBLISHING.test(one.words);
    const staged = one.action.key === true && one.action.press === DECRYPT &&
      one.action.scroll === publishSection;
    return about === staged;
  }));

await check("the free drive carries admin-page cards on both sides of that line", () =>
  cardActionsOnAdmin.some((one) => PROMISES_PUBLISHING.test(one.words)) &&
  cardActionsOnAdmin.some((one) => !PROMISES_PUBLISHING.test(one.words)));

/* ------------------------------------------------------------------ */
/* #259 F7. The stop about the admin list narrates the guard there is. */

/*
 * THE DEFECT: THE NARRATION PROMISED A GUARD NOBODY HAS.
 *
 * "The last one cannot be removed" is narrated over a list whose every
 * granting row comes off in front of the viewer. The guard counts ADMIN
 * ROWS and not grants - the shipped Worker's subquery is
 * `WHERE role = 'admin'` with no grants test, and the stub models that
 * deployment rather than the fixed one - and this staging seeds a row
 * that grants nobody. So the rows that do grant admin can all be
 * removed while the dud keeps the count above one, and a viewer who
 * follows the sentence and presses Remove twice ends on the empty admin
 * list the sentence said was impossible.
 *
 * What is true is on the page already, in the page's own words: the
 * malformed list says the guard "counts these too", and the notice under
 * the admin list says an admin is granted "by no row above". Both are
 * read out of apps/web below and the stop is held to saying the same two
 * things, because a narration checked only against itself is a sentence
 * nothing can falsify - which is how this one survived.
 */

/*
 * The container the admin rows are drawn into, and the card it sits in -
 * the same reading `publishSection` takes, one level further down.
 */
const ADMIN_LIST = "membership-admin";
const membershipCard = sectionHolding(shipped[ADMIN_PAGE], ADMIN_LIST);

/*
 * The stops about that card, selected by WHERE INSIDE IT they land
 * rather than by the exact element they name.
 *
 * The exact element is one of the things held below, so a set selected
 * on it would go vacuous the moment the anchor moved - and a vacuous set
 * turns every `every()` arm under it into a sentence nothing can
 * falsify, which is the failure the exclusion arm at the end of this
 * section exists to stop.
 */
const inMembershipCard = (id) =>
  typeof id === "string" && membershipCard !== null &&
  (id === membershipCard ||
    sectionHolding(shipped[ADMIN_PAGE], id) === membershipCard);

const membershipStops = Demo.TOURS.flatMap((walk) => walk.stops)
  .filter(onAdminPage)
  .filter((stop) => inMembershipCard(stop.scroll));

const adminHtmlFlat = shipped[ADMIN_PAGE].replace(/\s+/g, " ");
const adminJsFlat = webSource["admin.js"].replace(/\s+/g, " ");

/*
 * The guard DRIVEN rather than read - every granting admin row removed
 * in the order the pane offers them, then the row that is left.
 *
 * Bounded by the row count it started with, because a stub that answered
 * 200 without removing anything would otherwise spin here forever, and a
 * suite that hangs is a suite that reports nothing at all.
 */
const drivenAdmin = (() => {
  let state = world("admin");
  const read = () =>
    Demo.answerFor({ method: "GET", path: "/membership" }, state).body;
  const removals = [];
  const started = read().membership.length + read().malformed.length;
  for (let i = 0; i < started; i += 1) {
    const row = read().membership.find((one) => one.role === "admin");
    if (row === undefined) break;
    const answer = Demo.answerFor(
      { method: "DELETE", path: "/membership/admin/" + row.account_id },
      state);
    removals.push(answer.status);
    if (answer.status !== 200) break;
    state = Object.assign({}, state, answer.next);
  }
  const left = read();
  const survivor = left.malformed[0];
  return {
    removals: removals,
    left: left,
    refused: survivor === undefined ? null : Demo.answerFor(
      { method: "DELETE", path: "/membership/admin/" + survivor.account_id },
      state),
  };
})();

/*
 * WHERE THE STOP LANDS, which is not the same question as which card it
 * names - and the difference is a whole screen.
 *
 * `scroll` aligns the TOP of what it names. Naming the membership card
 * aligned the top of an 1131 px card, so the frame filled with the
 * card's add-a-member form and every element this stop's sentence points
 * at was below the fold: measured on the baked build, the admin list
 * starts 568 px into that card and the line under it ends at 764 px, so
 * the sentence needed a frame ~765 px tall to be true. A 1280x800
 * browser window gives the demo frame 544 px. The stop is behind glass -
 * `elementFromPoint` at the frame centre is the glass and the wheel is
 * dead - so the viewer could not go and look. True of the card, false of
 * the screen.
 *
 * So the anchor is the FIRST thing the sentence names, and this holds
 * the two structural facts that make the screen follow: the stop lands
 * on the admin list itself, and between that list and the last thing the
 * sentence names there is nothing a viewer would have to scroll past -
 * no field, no button, no fieldset. The form that filled the frame is
 * ABOVE the anchor now rather than inside the span, which is the whole
 * of the fix. A layout is not measurable from Node; what is measurable
 * is that nothing stands between the anchor and the referents, and the
 * three-viewport measurement that settles the rest is in the commit
 * message.
 */
const anchorAt = adminHtmlFlat.indexOf('id="' + ADMIN_LIST + '"');
const floorAt = adminHtmlFlat.indexOf('id="secret-only"');
const SOMETHING_TO_SCROLL_PAST = /<(?:input|button|fieldset|textarea|select)\b/;

await check("that stop lands on the list its sentence starts with, not a screen above it", () =>
  typeof membershipCard === "string" && membershipCard.length > 0 &&
  membershipCard !== publishSection &&
  membershipStops.length > 0 &&
  membershipStops.every((stop) => stop.scroll === ADMIN_LIST) &&
  anchorAt !== -1 && floorAt !== -1 && anchorAt < floorAt &&
  !SOMETHING_TO_SCROLL_PAST.test(adminHtmlFlat.slice(anchorAt, floorAt)));

await check("every row that really grants admin comes off in front of the viewer", () =>
  drivenAdmin.removals.length >= 2 &&
  drivenAdmin.removals.every((status) => status === 200) &&
  drivenAdmin.left.membership
    .filter((row) => row.role === "admin").length === 0);

await check("what the guard holds back is a row, and it is one that grants nobody", () =>
  drivenAdmin.left.malformed.length === 1 &&
  drivenAdmin.refused !== null && drivenAdmin.refused.status === 409 &&
  /last admin row/.test(drivenAdmin.refused.body.error));

/*
 * The floor that makes the empty list survivable, and the reason the
 * stop may name one at all: the pane goes on reporting an admin the
 * secret grants after every row is gone.
 */
await check("an admin no row covers is still granted when the list is empty", () =>
  drivenAdmin.left.secretOnly.length > 0);

await check("the stop about the admin list says what the page says the guard counts", () =>
  membershipStops.length > 0 &&
  adminHtmlFlat.includes(
    "the guard that refuses to remove the last admin row counts these too") &&
  membershipStops.every((stop) => /\bcounts rows\b/i.test(stop.narration)));

await check("the stop about the admin list names the floor the panel reports", () =>
  adminJsFlat.includes("and by no row above") &&
  membershipStops.every((stop) => /\bby no row\b/i.test(stop.narration)));

/*
 * The general rule the defect was a case of: what a removal guard
 * protects here is a ROW, so a stop promising that something cannot be
 * removed has to say which. "The last one" reads as the last person
 * holding admin, and that is the claim the drive above falsifies.
 */
await check("a stop saying something cannot be removed says it is a row", () =>
  Demo.TOURS.every((walk) => walk.stops.every((stop) =>
    !/cannot be removed/i.test(stop.narration) ||
    /\brows?\b/i.test(stop.narration))));

/*
 * Non-vacuity, and it has to be stated as an EXCLUSION rather than as
 * "some other stop exists". admin.html is the keyholder's page as well
 * as the admin one, so seven stops land on it and an arm asking only
 * that some of them differ has six stops of slack - mutation could not
 * make it fail, which is the definition of an arm that is not one. What
 * the two arms above are worth is that those words belong to the stop
 * about the list and to no other: add either sentence to a stop that is
 * not about the list and this goes red.
 */
await check("the words those arms require belong to that stop and no other", () => {
  const others = Demo.TOURS.flatMap((walk) => walk.stops)
    .filter(onAdminPage)
    .filter((stop) => !inMembershipCard(stop.scroll));
  return membershipStops.length > 0 && others.length > 0 &&
    others.every((stop) => !/\bcounts rows\b/i.test(stop.narration) &&
      !/\bby no row\b/i.test(stop.narration));
});

/*
 * WHICH stops have to declare one - the half the arm above cannot see.
 *
 * "Names a control the page really has" is satisfied by declaring
 * nothing, so the two stops that carried the fix were the only thing
 * holding it: delete one declaration and this suite stayed green while
 * the stop went back to narrating the weigh-in form over the list of
 * past entries. The arm has to run the other way too - a stop whose own
 * words are ABOUT the other tab must press its way there.
 *
 * The trigger is read out of the shipped page rather than written down
 * here: the tab that does not open the page names itself ("Weigh in"),
 * and the pane it controls is the one holding the page's form. So a stop
 * that says either word is a stop about that tab. Restating the two here
 * would be the corollary AGENTS.md names - a check computed from the
 * thing it guards cannot notice the thing was renamed.
 *
 * And the reverse direction in the same arm, which is what keeps it from
 * becoming "press everything": a stop whose words do NOT name that tab
 * must not press it, or the two stops that correctly open on the list of
 * past entries would be dragged onto the form.
 */
const TABBED_PAGE = "your-page.html";
const tabsOf = (html) =>
  Array.from(html.matchAll(
    /<button[^>]*id="([^"]+)"[^>]*role="tab"[^>]*aria-selected="(true|false)"[^>]*>\s*([^<]+?)\s*</g))
    .map((hit) => ({ id: hit[1], opens: hit[2] === "true", label: hit[3] }));

const pageTabs = tabsOf(shipped[TABBED_PAGE]);
const otherTab = pageTabs.find((one) => one.opens === false);

// The page really does carry a tablist with a tab it does not open on,
// or every arm below is asserting over an empty list.
await check("the tabbed page carries one tab it does not open on", () =>
  pageTabs.length === 2 && otherTab !== undefined &&
  pageTabs.filter((one) => one.opens).length === 1);

/*
 * The pane that tab controls holds the page's form, which is the second
 * word a stop uses for it. Read rather than assumed: the day the form
 * moves to the other pane, "the form" stops meaning this tab and this
 * arm has to be re-argued rather than quietly kept passing.
 */
const paneOf = (html, id) => {
  const opened = html.indexOf('id="' + id + '"');
  if (opened === -1) return "";
  // Past this pane's own opening tag before looking for the next pane,
  // because role="tabpanel" sits beside the id INSIDE that tag - a search
  // from the id finds this pane again and reads it as empty.
  const after = html.indexOf(">", opened);
  const next = html.indexOf('role="tabpanel"', after);
  return html.slice(after, next === -1 ? html.length : next);
};

await check("the tab the page does not open on is the one holding the form",
  () => paneOf(shipped[TABBED_PAGE], otherTab.id.replace(/-tab$/, "-pane"))
    .includes("<form"));

const NAMES_OTHER_TAB = new RegExp(
  "(" + otherTab.label.trim().replace(/\s+/g, "[\\s-]") + "|\\bform\\b)", "i");

const onTabbedPage = (stop) =>
  (stop.open || Demo.SCENARIOS.find((one) => one.id === stop.scenario).start)
    === TABBED_PAGE;

await check("a stop about the other tab presses its way there, and only those do",
  () => Demo.TOURS.every((walk) => walk.stops.every((stop) => {
    if (!onTabbedPage(stop)) return true;
    const about = NAMES_OTHER_TAB.test(stop.title + " " + stop.narration);
    return about === (stop.press === otherTab.id);
  })));

// Non-vacuity in both directions: the partition is real, not one side.
await check("the tabbed page carries stops on both sides of that line", () => {
  const stops = Demo.TOURS.flatMap((walk) => walk.stops).filter(onTabbedPage);
  return stops.some((stop) => stop.press === otherTab.id) &&
    stops.some((stop) => stop.press === undefined);
});

/* ------------------------------------------------------------------ */
/* UAT.md walks the journeys (#238, the owner's re-cut).               */

/*
 * F9, re-keyed from cards to journey stops and NOT weakened.
 *
 * The contract was one UAT.md section per card, titles agreeing exactly
 * in both directions. The journeys replace the cards as what a driver
 * is sent through, so the pointer has to move with them - but the two
 * directions are the whole value, and a re-key that kept one is a
 * re-key that threw the contract away and left the word.
 *
 * TWO VOICES, RULED AND NOT MERGED. UAT.md is the DRIVER's acceptance
 * script, auditor-precise, and it REFERENCES a journey stop; the tour's
 * narration is the member-facing voice #192 settled. Different readers,
 * same walk. So this asserts the pointers resolve, never that the two
 * documents say the same words - the day it asserted that, one of the
 * two voices would have to go.
 *
 * The section IDs stay A0-A12 and the recording template's row names
 * stay exactly as they were, because the posting format is what a
 * recorded pass is filed as and re-keying that costs a record nobody
 * can compare.
 */
const uat = await readFile(HERE("../UAT.md"), "utf8");
const uatStops = [];
uat.split("\n").forEach((line) => {
  if (!/^##/.test(line)) return;
  const named = /journey "([^"]+)", stop ([0-9]+)/.exec(line);
  if (named) uatStops.push({ title: named[1], stop: Number(named[2]) });
});

await check("UAT.md's journey pointers are readable at all", () =>
  uatStops.length >= 10);

/*
 * REACHABLE: every staged section points at a journey that exists and a
 * stop that journey really has. A section pointing at stop 9 of a
 * seven-stop walk sends a driver somewhere there is nothing to do.
 */
await check("every UAT section points at a journey stop that exists", () =>
  uatStops.every((pointer) => {
    const walk = Demo.TOURS.find((one) => one.title === pointer.title);
    return walk !== undefined && pointer.stop >= 1 &&
      pointer.stop <= walk.stops.length;
  }));

/*
 * And the direction that catches a journey nobody accepts: four walks
 * exist and the acceptance script has to send a driver through all of
 * them. Without this half a journey could be added, shown to the owner,
 * and never appear in the document that decides whether it passed.
 */
await check("every journey is walked by some UAT section", () => {
  const walked = new Set(uatStops.map((pointer) => pointer.title));
  return Demo.TOURS.every((walk) => walked.has(walk.title));
});

/*
 * The cards keep their own home. They are the free drive, and UAT.md
 * names journeys rather than cards - so nothing here holds the two
 * documents to one card list, and nothing should: the cards are a
 * complete surface in their own right, which the scenario-coverage arms
 * above hold in both directions without UAT.md's help.
 */
await check("no UAT section still points at a card", () =>
  !/^##.*card "/m.test(uat));

/*
 * A POINTER CAN RESOLVE AND STILL SEND A DRIVER NOWHERE (#254 F1).
 *
 * The arms above ask whether a section names a journey that exists and a
 * stop it really has. A8's routing note did exactly that and was still
 * undrivable: it sent six rows about a decrypted table, a publishing
 * card and an idle timer hanging off a decrypt to a stop that stages the
 * key and never presses anything - key box filled, zero rows, no card on
 * screen. Every pointer arm was green while five acceptance rows could
 * not be performed as written, by the owner, on the build being
 * accepted. Existing is not the same as being in the state the rows
 * need, and nothing asked the second question.
 *
 * So a section that wants the corpus ALREADY OPEN when the frame reaches
 * the driver says so in the pointer, and the phrase is the contract: the
 * stop it names has to stage the key, press the page's own decrypt, and
 * hand the frame over. All three, because any two of them leave a row
 * undrivable - the key without the press is F1 itself, the press without
 * the hand-over leaves the glass on, and either without the key leaves
 * the product asking for a key file.
 *
 * A7 deliberately carries no such pointer and must not: its rows tell
 * the driver to press Fetch and decrypt themselves, and A7.6 replaces
 * the key first, so a stop that had already decrypted would be the wrong
 * surface for it. The marker is opt-in for exactly that reason.
 */
const uatSections = [];
uat.split("\n").forEach((line) => {
  if (/^###\s/.test(line)) {
    uatSections.push({ heading: line, lines: [] });
  } else if (uatSections.length > 0) {
    uatSections[uatSections.length - 1].lines.push(line);
  }
});

const CORPUS_OPEN =
  /driven with the corpus already open at journey "([^"]+)", stop ([0-9]+)/;
const drivenOpen = [];
uatSections.forEach((section) => {
  // Whitespace collapsed first: this is a wrapped markdown paragraph, so
  // the phrase carrying the contract straddles a line break as often as
  // not, and a contract that depended on where the prose happened to
  // wrap would be re-broken by the next edit that changed a word length.
  const named = CORPUS_OPEN.exec(section.lines.join(" ").replace(/\s+/g, " "));
  if (named === null) return;
  const walk = Demo.TOURS.find((one) => one.title === named[1]);
  drivenOpen.push({
    heading: section.heading,
    at: walk === undefined ? undefined : walk.stops[Number(named[2]) - 1],
  });
});

await check("UAT.md says where its corpus-open rows are driven", () =>
  drivenOpen.length > 0);

await check("a UAT row driven with the corpus open names a stop that opens it", () =>
  drivenOpen.length > 0 && drivenOpen.every((one) =>
    one.at !== undefined && one.at.key === true &&
    one.at.press === DECRYPT && one.at.free === true));

/* ------------------------------------------------------------------ */
/* The walk, and the glass over it, driven for real.                   */

await check("the console page carries the journeys, the walk and the glass", () =>
  consoleHtml.includes('id="tours"') &&
  consoleHtml.includes('id="tour-run"') &&
  consoleHtml.includes('id="tour-narration"') &&
  consoleHtml.includes('id="tour-next"') &&
  consoleHtml.includes('id="tour-back"') &&
  consoleHtml.includes('id="glass"'));

/*
 * The cards are still on the page and still behind a disclosure, which
 * is the whole of the demotion: a tester who wants one feature opens
 * it, and a cold viewer is not asked to choose among nine states before
 * anything has been explained.
 */
await check("the cards are on the page, behind the free-drive disclosure", () =>
  /<details[^>]*id="free-drive"/.test(consoleHtml) &&
  consoleHtml.indexOf('id="free-drive"') <
    consoleHtml.indexOf('id="features"'));

/*
 * The glass has to be a real element with real CSS behind it, because
 * an overlay that does not cover anything is a promise of read-only
 * that the first click disproves - in front of the owner.
 */
await check("the glass is laid over the frame by the stylesheet", () =>
  /#glass\s*\{[^}]*position:\s*absolute/.test(consoleCss) &&
  /#glass\s*\{[^}]*inset:/.test(consoleCss) &&
  /\[hidden\]\s*\{[^}]*display:\s*none/.test(consoleCss));

/*
 * And now the engine, run rather than read. Same reasoning as the
 * resync arms above: every string a source-level check could pin here
 * is one the comment explaining the engine also contains.
 */
await check("the console opens on the journeys with none running", () => {
  const browser = consoleInRecordedBrowser();
  return browser.nodes.tours.children.length === Demo.TOURS.length &&
    browser.nodes["tour-run"].getAttribute("hidden") !== null &&
    browser.locked() === false;
});

await check("starting a journey stages its first stop behind the glass", () => {
  const browser = consoleInRecordedBrowser();
  const walk = Demo.TOURS[0];
  browser.journey(walk.id).fire("click");
  return browser.nodes["tour-title"].textContent === walk.stops[0].title &&
    browser.nodes["tour-narration"].textContent === walk.stops[0].narration &&
    browser.nodes["tour-run"].getAttribute("hidden") === null &&
    browser.locked() === true;
});

await check("Next and Back move along the journey's own stops", () => {
  const browser = consoleInRecordedBrowser();
  const walk = Demo.TOURS[0];
  browser.journey(walk.id).fire("click");
  browser.nodes["tour-next"].fire("click");
  const second = browser.nodes["tour-title"].textContent;
  browser.nodes["tour-next"].fire("click");
  const third = browser.nodes["tour-title"].textContent;
  browser.nodes["tour-back"].fire("click");
  return second === walk.stops[1].title && third === walk.stops[2].title &&
    browser.nodes["tour-title"].textContent === walk.stops[1].title;
});

/*
 * The ruling itself, as an executed fact: the glass stays on for every
 * narrated stop and comes off at the end. Walked stop by stop rather
 * than jumped to the last one, because what is being asserted is that
 * nothing in the middle unlocks it.
 */
await check("the glass holds all the way to the stop that hands it over", () =>
  Demo.TOURS.every((walk) => {
    const browser = consoleInRecordedBrowser();
    browser.journey(walk.id).fire("click");
    for (let i = 0; i < walk.stops.length; i += 1) {
      if (browser.locked() !== (walk.stops[i].free !== true)) return false;
      if (i < walk.stops.length - 1) browser.nodes["tour-next"].fire("click");
    }
    return browser.locked() === false;
  }));

await check("a stop stages the world it names, not the one before it", () => {
  const browser = consoleInRecordedBrowser();
  const walk = Demo.TOURS[0];
  browser.journey(walk.id).fire("click");
  const first = browser.staged();
  browser.nodes["tour-next"].fire("click");
  return first === walk.stops[0].scenario &&
    browser.staged() === walk.stops[1].scenario;
});

/* ------------------------------------------------------------------ */
/* Three fixture gaps, told honestly rather than papered over (#238).  */

/*
 * THE PREFILL STOP LANDS ON THE TAB THE PREFILLED FORM IS ON.
 *
 * The staging was always right - the measurements really are written
 * into the device's own store - and Your page opens on the list of past
 * entries, which is a different tab. So the card promising "your last
 * measurements are already in it" showed a list of dates, and the
 * promise was true about a screen nobody was looking at. Held by
 * driving it: the stop is walked to and the frame is asked which
 * control was pressed.
 */
await check("the prefill stop presses its way to the form it promises",
  async () => {
    const walk = Demo.TOURS.find((one) =>
      one.stops.some((stop) => stop.scenario === "member-prefilled"));
    const index = walk.stops.findIndex((stop) =>
      stop.scenario === "member-prefilled");
    const browser = consoleInRecordedBrowser();
    browser.journey(walk.id).fire("click");
    for (let i = 0; i < index; i += 1) {
      browser.nodes["tour-next"].fire("click");
    }
    browser.arrive("your-page.html");
    await browser.settled();
    return browser.framePressed().join(",") === "add-entry-tab";
  });

/*
 * THE SAME STOP, ON THE HOST THE DEMO IS ACTUALLY PUBLISHED TO.
 *
 * The arm above proves the errand runs when the frame arrives under the
 * file name the console asked for. This one proves it runs when the host
 * hands the page back under its tidied name, which is what the baked
 * demo behind a static host really does - and where the tab press and
 * the key staging were BOTH dead while every arm in this file passed,
 * because all of them arrived the tidy way.
 *
 * Driven rather than reasoned: the walk is walked, the frame arrives at
 * the extensionless address, and the frame is asked what was pressed.
 */
await check("a stop's errand runs when the host drops the extension",
  async () => {
    const walk = Demo.TOURS.find((one) =>
      one.stops.some((stop) => stop.scenario === "member-prefilled"));
    const index = walk.stops.findIndex((stop) =>
      stop.scenario === "member-prefilled");
    const browser = consoleInRecordedBrowser();
    browser.journey(walk.id).fire("click");
    for (let i = 0; i < index; i += 1) {
      browser.nodes["tour-next"].fire("click");
    }
    browser.arrive("your-page");
    await browser.settled();
    return browser.framePressed().join(",") === "add-entry-tab";
  });

/*
 * EVERY stop that declares a press, not the one this file happened to
 * grow an arm for.
 *
 * The prefill stop had a driven arm of its own from the day it was
 * written; the stop before it declared the same press and had none, so
 * deleting that declaration left this suite green and put the original
 * defect back on a stop nobody was watching. A per-stop arm is a per-stop
 * promise, and the stops outnumber the arms.
 */
await check("every stop that declares a press really presses it", async () => {
  for (const walk of Demo.TOURS) {
    for (let index = 0; index < walk.stops.length; index += 1) {
      const stop = walk.stops[index];
      if (typeof stop.press !== "string") continue;
      const browser = consoleInRecordedBrowser();
      browser.journey(walk.id).fire("click");
      for (let i = 0; i < index; i += 1) {
        browser.nodes["tour-next"].fire("click");
      }
      const page = stop.open ||
        Demo.SCENARIOS.find((one) => one.id === stop.scenario).start;
      browser.arrive(page);
      await browser.settled();
      if (!browser.framePressed().includes(stop.press)) return false;
    }
  }
  return true;
});

/*
 * And the same, driven, for every stop that moves the page: the walk is
 * walked and the frame is asked which section was brought into view.
 */
await check("every stop that declares a scroll really moves the page",
  async () => {
    for (const walk of Demo.TOURS) {
      for (let index = 0; index < walk.stops.length; index += 1) {
        const stop = walk.stops[index];
        if (typeof stop.scroll !== "string") continue;
        const browser = consoleInRecordedBrowser();
        browser.journey(walk.id).fire("click");
        for (let i = 0; i < index; i += 1) {
          browser.nodes["tour-next"].fire("click");
        }
        const page = stop.open ||
          Demo.SCENARIOS.find((one) => one.id === stop.scenario).start;
        browser.arrive(page);
        await browser.settled();
        if (!browser.frameScrolled().includes(stop.scroll)) return false;
      }
    }
    return true;
  });

/*
 * A section the page cannot answer for is said out loud too - the scroll
 * half of the arm below, and the same hazard: a stop narrating a part of
 * the page nobody is looking at.
 */
await check("a scroll the page cannot answer is reported, not swallowed",
  async () => {
    const browser = consoleInRecordedBrowser();
    await browser.settled();
    const walk = Demo.TOURS.find((one) =>
      one.stops.some((stop) => typeof stop.scroll === "string"));
    const index = walk.stops.findIndex((stop) =>
      typeof stop.scroll === "string");
    browser.missingInFrame(walk.stops[index].scroll);
    browser.journey(walk.id).fire("click");
    for (let i = 0; i < index; i += 1) {
      browser.nodes["tour-next"].fire("click");
    }
    const stop = walk.stops[index];
    browser.arrive(stop.open ||
      Demo.SCENARIOS.find((one) => one.id === stop.scenario).start);
    await browser.settled();
    return browser.nodes.status.textContent.includes(stop.scroll) &&
      browser.frameScrolled().length === 0;
  });

/*
 * RESET MID-WALK RESTAGES THE STOP INSTEAD OF ONLY SAYING IT DID.
 *
 * Reset restaged the last card pressed, and during a walk there is no
 * card - so it dropped the world key, announced that the state was
 * reset, and left the frame standing in the world from before it with
 * the walk card still on its stop. A console whose whole job is to say
 * what really happened cannot have a button that reports an act it did
 * not perform. Driven: the stop's world is staged again and the frame is
 * asked to move.
 */
await check("reset during a walk stages the stop again, not just a message",
  async () => {
    const browser = consoleInRecordedBrowser();
    await browser.settled();
    const walk = Demo.TOURS[0];
    browser.journey(walk.id).fire("click");
    browser.nodes["tour-next"].fire("click");
    const moved = browser.replaced.length + browser.nodes.stage.attrs.src;
    browser.nodes.reset.fire("click");
    await browser.settled();
    return browser.staged() === walk.stops[1].scenario &&
      moved !== browser.replaced.length + browser.nodes.stage.attrs.src &&
      /stop/i.test(browser.nodes.status.textContent);
  });

/*
 * A SECTION THAT IS THERE AND NOT ON SCREEN IS THE CASE THAT NEARLY GOT
 * THROUGH.
 *
 * The admin surface keeps its publishing tools in the markup and hidden
 * until the page's own code reveals them, and scrollIntoView on a
 * section that is not painting moves nothing and says nothing. A stop
 * declaring one would narrate over the top of the page with an errand
 * that believed it ran - the original defect, reached through a
 * declaration that LOOKS honored. Found by driving it in a browser: a
 * scroll to the publishing card left the frame at the top of the page
 * with no report anywhere, so that declaration was withdrawn and this
 * arm stands where it was.
 */
await check("a section the page is not showing is reported, not scrolled to",
  async () => {
    const browser = consoleInRecordedBrowser();
    await browser.settled();
    const walk = Demo.TOURS.find((one) =>
      one.stops.some((stop) => typeof stop.scroll === "string"));
    const index = walk.stops.findIndex((stop) =>
      typeof stop.scroll === "string");
    const stop = walk.stops[index];
    browser.unpaintedInFrame(stop.scroll);
    browser.journey(walk.id).fire("click");
    for (let i = 0; i < index; i += 1) {
      browser.nodes["tour-next"].fire("click");
    }
    browser.arrive(stop.open ||
      Demo.SCENARIOS.find((one) => one.id === stop.scenario).start);
    await browser.settled();
    return browser.nodes.status.textContent.includes(stop.scroll) &&
      browser.frameScrolled().length === 0;
  });

/*
 * F0, DRIVEN: the whole restage, in the order that makes it work.
 *
 * Every stop whose words promise publishing is walked to and the frame
 * is asked what was done to it. The sequence is the assertion: a key
 * written after the press leaves the product answering "paste or choose
 * your key file first", and a move made before the page has revealed the
 * card scrolls to a section that is not rendering - which is the
 * original defect with an errand that believes it ran.
 */
await check("a stop that promises publishing lands with that card on screen",
  async () => {
    const want = ["filled keyfile", "pressed " + DECRYPT,
      "scrolled " + publishSection].join(" | ");
    let walked = 0;
    for (const walk of Demo.TOURS) {
      for (let index = 0; index < walk.stops.length; index += 1) {
        const stop = walk.stops[index];
        if (!onAdminPage(stop)) continue;
        if (!PROMISES_PUBLISHING.test(stop.title + " " + stop.narration)) {
          continue;
        }
        const browser = consoleInRecordedBrowser();
        await browser.settled();
        browser.journey(walk.id).fire("click");
        for (let i = 0; i < index; i += 1) {
          browser.nodes["tour-next"].fire("click");
        }
        browser.arrive(ADMIN_PAGE);
        await browser.settled();
        if (browser.frameActs().join(" | ") !== want) return false;
        walked += 1;
      }
    }
    return walked > 0;
  });

/*
 * AND THE CARD, DRIVEN THE SAME WAY - WHICH IS ALSO WHAT ARMS THE
 * PASS-THROUGH (#254 F4 and F5, one arm).
 *
 * stage() builds an errand out of a card action's `press`, `key` and
 * `scroll` with two lines deliberately identical to goToStop's, and
 * until this card carried a press and a scroll no card carried either:
 * dropping both from that object left this whole file green. An
 * unfalsifiable pass-through is the same class of hole as an
 * unfalsifiable branch, so it is armed here rather than deleted -
 * deleting it would have taken the fix for F5 with it, because staging
 * this card's way to a rendered Publish is exactly what the two fields
 * are for.
 *
 * The ORDER is the assertion, as it is for the stops: a key written
 * after the press leaves the product asking for a key file, and a move
 * made before the page has revealed the card scrolls to nothing.
 */
await check("a card action that promises publishing lands with that card on screen",
  async () => {
    const want = ["filled keyfile", "pressed " + DECRYPT,
      "scrolled " + publishSection].join(" | ");
    let driven = 0;
    for (const one of cardActionsOnAdmin) {
      if (!PROMISES_PUBLISHING.test(one.words)) continue;
      const browser = consoleInRecordedBrowser();
      await browser.settled();
      browser.cardAction(one.action.label).fire("click");
      browser.arrive(ADMIN_PAGE);
      await browser.settled();
      if (browser.frameActs().join(" | ") !== want) return false;
      driven += 1;
    }
    return driven > 0;
  });

/*
 * A CONTROL THE PAGE HAS NOT ENABLED YET, WHICH IS THE QUIETEST FAILURE
 * IN THIS WHOLE FILE.
 *
 * click() on a disabled button dispatches nothing at all: no event, no
 * throw, and no way for the caller to tell it from a press that was
 * received and ignored. The admin page ships its decrypt button
 * disabled and enables it when its own session check answers, about a
 * frame after the frame reports `load` - so the errand pressed a dead
 * button, said nothing, and the stop narrated over a page where nothing
 * had happened. Found by driving the baked build behind a clean-URL
 * host; every arm in this file passed while it was true, because the
 * recording's controls were pressable from the first instant.
 */
await check("a control the page has not enabled yet is waited for, then pressed",
  async () => {
    const browser = consoleInRecordedBrowser();
    await browser.settled();
    browser.pressableAfter(DECRYPT, 4);
    const walk = Demo.TOURS.find((one) =>
      one.stops.some((stop) => stop.press === DECRYPT));
    const index = walk.stops.findIndex((stop) => stop.press === DECRYPT);
    browser.journey(walk.id).fire("click");
    for (let i = 0; i < index; i += 1) {
      browser.nodes["tour-next"].fire("click");
    }
    browser.arrive(ADMIN_PAGE);
    await browser.settled();
    return browser.framePressed().includes(DECRYPT) &&
      !browser.nodes.status.textContent.includes(DECRYPT);
  });

// And the other direction: one it never enables is said, not swallowed.
await check("a control the page never makes pressable is reported, not pressed",
  async () => {
    const browser = consoleInRecordedBrowser();
    await browser.settled();
    browser.neverPressable(DECRYPT);
    const walk = Demo.TOURS.find((one) =>
      one.stops.some((stop) => stop.press === DECRYPT));
    const index = walk.stops.findIndex((stop) => stop.press === DECRYPT);
    browser.journey(walk.id).fire("click");
    for (let i = 0; i < index; i += 1) {
      browser.nodes["tour-next"].fire("click");
    }
    browser.arrive(ADMIN_PAGE);
    await browser.settled();
    return !browser.framePressed().includes(DECRYPT) &&
      browser.nodes.status.textContent.includes(DECRYPT);
  });

/*
 * AND THE WAIT, WHICH IS THE PART A SINGLE LOOK CANNOT HAVE.
 *
 * The card appears when the page finishes a fetch and a few hundred
 * unseals, so a console that pressed decrypt and looked once would find
 * nothing rendering and report the card missing - a true statement made
 * too early, which reads to a viewer exactly like the defect. The
 * recording holds the card back for several looks after the press, and
 * the console has to still be there when it arrives.
 */
await check("a card the page reveals only after its own work is waited for",
  async () => {
    let found = null;
    for (const walk of Demo.TOURS) {
      for (let index = 0; index < walk.stops.length; index += 1) {
        const stop = walk.stops[index];
        if (onAdminPage(stop) && stop.scroll === publishSection) {
          found = { walk: walk, index: index };
          break;
        }
      }
      if (found) break;
    }
    if (found === null) return false;
    const browser = consoleInRecordedBrowser();
    await browser.settled();
    browser.paintedAfterPressing(publishSection, DECRYPT, 3);
    browser.journey(found.walk.id).fire("click");
    for (let i = 0; i < found.index; i += 1) {
      browser.nodes["tour-next"].fire("click");
    }
    browser.arrive(ADMIN_PAGE);
    await browser.settled();
    return browser.frameScrolled().includes(publishSection) &&
      !browser.nodes.status.textContent.includes(publishSection);
  });

/*
 * A DECLARATION THE PAGE CANNOT HONOR IS SAID OUT LOUD.
 *
 * The arm above holds every declared press to naming a control the
 * shipped page carries, so this cannot happen while the gate is green.
 * The day it does - a rename landing between the page and the tour - the
 * stop is narrated over whatever the page opened on, and the console's
 * whole job is to say what really happened rather than to let a stop
 * describe a screen nobody is looking at. Recorded by asking the console
 * for the missing control BY A NAME THE RECORDING REFUSES.
 */
await check("a press the page cannot answer is reported, not swallowed",
  async () => {
    const browser = consoleInRecordedBrowser();
    // Setting up says its own last word - this recording has no worker,
    // so the corpus reports itself missing - and it says it from a
    // promise. Draining that first is what leaves the status line
    // holding THIS stop's report rather than the boot's.
    await browser.settled();
    browser.missingInFrame("add-entry-tab");
    const walk = Demo.TOURS.find((one) =>
      one.stops.some((stop) => stop.press === "add-entry-tab"));
    const index = walk.stops.findIndex((stop) =>
      stop.press === "add-entry-tab");
    browser.journey(walk.id).fire("click");
    for (let i = 0; i < index; i += 1) {
      browser.nodes["tour-next"].fire("click");
    }
    browser.arrive("your-page.html");
    await browser.settled();
    return browser.nodes.status.textContent.includes("add-entry-tab") &&
      browser.framePressed().length === 0;
  });

/* ------------------------------------------------------------------ */
/* An errand the viewer has already walked away from (#251 F1/F2).      */

/*
 * AN ERRAND OUTLIVES THE STOP THAT ARMED IT, AND HAD NO WAY TO BE
 * CANCELLED.
 *
 * The errand waits up to five seconds for what it is about to touch.
 * Nothing stopped that wait when the walk moved on, so the give-up
 * sentence landed in the status line ON TOP of whatever the viewer had
 * moved to - a report about a page that is not on screen, delivered by
 * the one surface built to say what really happened. Reproduced on the
 * baked build behind a clean-URL host: an admin walk left at t=1.2s
 * narrated "presses the page's run control..." over the member
 * journey's sign-in stop at t=6.2s and again at t=12.4s.
 *
 * Driven the only way that can catch it: the frame arrives, and the
 * walk moves on before the errand's wait has ended.
 */
const firstStopWith = (has) => {
  for (const walk of Demo.TOURS) {
    const index = walk.stops.findIndex(has);
    if (index !== -1 && index < walk.stops.length - 1) {
      return { walk: walk, index: index, stop: walk.stops[index] };
    }
  }
  return null;
};
const pageOfStop = (stop) => stop.open ||
  Demo.SCENARIOS.find((one) => one.id === stop.scenario).start;

const abandonedPress = firstStopWith((stop) => typeof stop.press === "string");

await check("an errand the walk has moved on from says nothing", async () => {
  if (abandonedPress === null) return false;
  const browser = consoleInRecordedBrowser();
  await browser.settled();
  browser.neverPressable(abandonedPress.stop.press);
  browser.journey(abandonedPress.walk.id).fire("click");
  for (let i = 0; i < abandonedPress.index; i += 1) {
    browser.nodes["tour-next"].fire("click");
  }
  browser.arrive(pageOfStop(abandonedPress.stop));
  // Before the wait's own resumption, which is where the viewer really
  // is when this bites: the press is still pending and the walk has
  // already gone somewhere else.
  browser.nodes["tour-next"].fire("click");
  await browser.settled();
  return browser.nodes.status.textContent === "";
});

/*
 * The other direction, and it is the same script with one line removed:
 * an errand still on its own stop DOES say what it could not do. Without
 * this half, a console that had simply stopped reporting give-ups would
 * pass the arm above.
 */
await check("an errand still on its own stop does say when it gives up",
  async () => {
    if (abandonedPress === null) return false;
    const browser = consoleInRecordedBrowser();
    await browser.settled();
    browser.neverPressable(abandonedPress.stop.press);
    browser.journey(abandonedPress.walk.id).fire("click");
    for (let i = 0; i < abandonedPress.index; i += 1) {
      browser.nodes["tour-next"].fire("click");
    }
    browser.arrive(pageOfStop(abandonedPress.stop));
    await browser.settled();
    return browser.nodes.status.textContent
      .includes(abandonedPress.stop.press);
  });

/*
 * LEAVING A WALK IS THE ABANDONMENT THAT MOVES NO FRAME, which is why
 * it is the one that needs saying separately: every other way out of a
 * stop asks the frame to go somewhere, and this one only puts the table
 * of contents back. An errand still waiting would finish afterwards and
 * report about a stop the viewer has just left - over the farewell this
 * button ends on, which is the sentence a viewer is reading when it
 * lands.
 */
await check("leaving a walk ends the errand it abandons", async () => {
  if (abandonedPress === null) return false;
  const browser = consoleInRecordedBrowser();
  await browser.settled();
  browser.neverPressable(abandonedPress.stop.press);
  browser.journey(abandonedPress.walk.id).fire("click");
  for (let i = 0; i < abandonedPress.index; i += 1) {
    browser.nodes["tour-next"].fire("click");
  }
  browser.arrive(pageOfStop(abandonedPress.stop));
  browser.nodes["tour-leave"].fire("click");
  const farewell = browser.nodes.status.textContent;
  await browser.settled();
  return farewell.length > 0 &&
    browser.nodes.status.textContent === farewell;
});

/*
 * And the half that is not a sentence: an abandoned errand must not go
 * on WRITING into the frame either. The key goes into the page's own box
 * after a fetch, so an errand carrying one resumes on whatever document
 * the frame holds by then - which is how key material reaches a page
 * that has no business holding it, silently, with the disclosure line
 * for it landing in the feed of a stop that staged no key.
 */
const abandonedKey = firstStopWith((stop) => stop.key === true);

await check("an errand the walk has moved on from stages no key", async () => {
  if (abandonedKey === null) return false;
  const browser = consoleInRecordedBrowser();
  await browser.settled();
  browser.journey(abandonedKey.walk.id).fire("click");
  for (let i = 0; i < abandonedKey.index; i += 1) {
    browser.nodes["tour-next"].fire("click");
  }
  browser.arrive(pageOfStop(abandonedKey.stop));
  browser.nodes["tour-next"].fire("click");
  await browser.settled();
  return browser.frameField("keyfile") === "" &&
    !browser.nodes.feed.children.map((one) => one.textContent)
      .includes(Demo.KEY_STAGED_LINE);
});

/*
 * A GIVE-UP SENTENCE HAS TO SURVIVE THE ERRAND'S REMAINING ACTS (F2).
 *
 * The errand says what it could not do and then carries on doing the
 * rest, and the next thing it said REPLACED the last one. A stop whose
 * press found a control the page never enabled and whose move then found
 * a section the page was not showing left the viewer holding the
 * symptom - "the page is not showing that section" - with the cause,
 * the press that never happened, already gone from the line. The cause
 * is the half that explains why the screen does not match the words.
 */
const twoAct = firstStopWith((stop) =>
  typeof stop.press === "string" && typeof stop.scroll === "string");

await check("a give-up sentence survives the errand's remaining acts",
  async () => {
    if (twoAct === null) return false;
    const browser = consoleInRecordedBrowser();
    await browser.settled();
    browser.neverPressable(twoAct.stop.press);
    browser.unpaintedInFrame(twoAct.stop.scroll);
    browser.journey(twoAct.walk.id).fire("click");
    for (let i = 0; i < twoAct.index; i += 1) {
      browser.nodes["tour-next"].fire("click");
    }
    browser.arrive(pageOfStop(twoAct.stop));
    await browser.settled();
    const said = browser.nodes.status.textContent;
    return said.includes(twoAct.stop.press) &&
      said.includes(twoAct.stop.scroll);
  });

/* ------------------------------------------------------------------ */
/* Who moved the frame: the viewer, or the page moving itself (#254).   */

/*
 * THE THIRD PATH INTO THE FRAME, AND WHY THE OBVIOUS FIX FOR IT IS
 * WRONG.
 *
 * The era is bumped when the CONSOLE navigates and when a walk is left,
 * so pressing Next or a destination or Leave cancels the errand it walks
 * away from. Neither covers the page inside the frame navigating itself
 * because the viewer clicked one of ITS links - and the product's own
 * nav rail is inside the frame, which the console's own copy invites a
 * viewer to use. So the original defect came back through that door: an
 * admin walk abandoned by a real click on the product's rail still put
 * the key-disclosure line into the feed while the CHARTS page - a page
 * with no key box at all - was on screen, and still landed its give-up
 * sentence over the stop the viewer had moved to.
 *
 * And bumping the era on every arrival, which is the one-line repair
 * that looks right, breaks the half the design insists on: a shipped
 * page that redirects itself fires `load` again with nobody having asked
 * for anything, and an errand cancelled by that is an errand that never
 * finishes on a self-redirecting page.
 *
 * So the discriminator is neither the navigation nor the arrival - it is
 * WHOSE PRESS caused it, which the browser answers with `isTrusted`. The
 * four arms below are that distinction from all four sides, because
 * three of them pass under at least one wrong implementation:
 *
 *   1. the page redirecting itself does NOT cancel  (era bumped on
 *      arrival fails here - the reviewer's non-equivalence probe)
 *   2. the viewer's own press DOES cancel           (the shipped-at-9d8f16c
 *      behavior fails here - this is the finding)
 *   3. a press that is not the viewer's does NOT    (an implementation
 *      counting any event fails here)
 *   4. a press on the page BEFORE the console moves the frame does not
 *      cancel what the console then arms  (an implementation that never
 *      forgets the press fails here)
 */
const elsewhereInProduct = Demo.DESTINATIONS.map((one) => one.file)
  .find((file) => file !== pageOfStop(abandonedKey.stop));

const keyStopWalked = (browser) => {
  browser.journey(abandonedKey.walk.id).fire("click");
  for (let i = 0; i < abandonedKey.index; i += 1) {
    browser.nodes["tour-next"].fire("click");
  }
  browser.arrive(pageOfStop(abandonedKey.stop));
};
const keyReached = (browser) =>
  browser.frameField("keyfile") === devKeyFile &&
  browser.nodes.feed.children.map((one) => one.textContent)
    .includes(Demo.KEY_STAGED_LINE);

await check("a page that redirects itself does not cancel the errand in flight",
  async () => {
    if (abandonedKey === null) return false;
    const browser = consoleInRecordedBrowser();
    await browser.settled();
    keyStopWalked(browser);
    // The same navigation arriving a second time, which is what a page
    // that redirects itself on load really does to the frame. Nobody
    // pressed anything between the two.
    browser.arrive(pageOfStop(abandonedKey.stop));
    await browser.settled();
    return keyReached(browser);
  });

await check("a press the viewer made inside the frame ends the errand it leaves",
  async () => {
    if (abandonedKey === null || elsewhereInProduct === undefined) return false;
    const browser = consoleInRecordedBrowser();
    await browser.settled();
    keyStopWalked(browser);
    // The product's own nav rail is inside the frame, and this is a
    // person pressing it - the act the console's own copy invites.
    browser.pressInFrame(true);
    browser.arrive(elsewhereInProduct);
    await browser.settled();
    return browser.frameField("keyfile") === "" &&
      !browser.nodes.feed.children.map((one) => one.textContent)
        .includes(Demo.KEY_STAGED_LINE);
  });

/*
 * The console's own press is not a viewer, and neither is a page's
 * script clicking something for itself: both dispatch an UNTRUSTED
 * click, and both bubble to the same document this watches. An errand
 * that counted them would cancel itself the moment its own press moved
 * the page - which is the errand's whole job, undone by the guard added
 * to protect it.
 */
await check("a press that is not the viewer's does not cancel the errand",
  async () => {
    if (abandonedKey === null) return false;
    const browser = consoleInRecordedBrowser();
    await browser.settled();
    keyStopWalked(browser);
    browser.pressInFrame(false);
    browser.arrive(pageOfStop(abandonedKey.stop));
    await browser.settled();
    return keyReached(browser);
  });

/*
 * And the press has to be FORGOTTEN when the console itself moves the
 * frame. A viewer who touches the page without navigating it - a tab, a
 * disclosure, anything the product does in place - and then presses Next
 * would otherwise have that press cancel the errand of the stop they
 * just asked for, on its very first arrival. The console's own
 * navigation is the newer instruction, so it supersedes whatever was
 * pressed on the page it is leaving.
 */
await check("a press on the page before the console moves the frame cancels nothing",
  async () => {
    // A stop BEFORE the key stop is what this arm presses on, so a walk
    // that staged its key first would make it vacuous rather than green.
    if (abandonedKey === null || abandonedKey.index < 1) return false;
    const browser = consoleInRecordedBrowser();
    await browser.settled();
    browser.journey(abandonedKey.walk.id).fire("click");
    for (let i = 0; i < abandonedKey.index; i += 1) {
      browser.arrive(pageOfStop(abandonedKey.walk.stops[i]));
      browser.pressInFrame(true);
      browser.nodes["tour-next"].fire("click");
    }
    browser.arrive(pageOfStop(abandonedKey.stop));
    await browser.settled();
    return keyReached(browser);
  });

/*
 * THE EMPTY-SITE-COPY STOP DOES NOT CLAIM A FEATURE THAT HAS NOT
 * SHIPPED.
 *
 * That staging exists to demonstrate #87 - an admin editing the site's
 * words - and #87 has not landed: nothing in apps/web calls /content at
 * all. What the page shows is therefore materially the same admin panel
 * as its two neighbours, and a stop presenting it as the feature would
 * be the false-confidence direction this suite's header names, told to
 * the person deciding the cutover.
 *
 * The condition is read out of apps/web rather than written down, so
 * the day #87 lands this arm stops applying on its own rather than
 * pinning the demo to an apology it has outgrown.
 */
const contentShipped = Demo.probeHit(webSource["admin.js"],
  { file: "apps/web/admin.js", pattern: "\"/content\"" });

await check("the empty-copy stop says the editing surface is still to come", () => {
  const stop = Demo.TOURS.flatMap((one) => one.stops)
    .find((each) => each.scenario === "config-fallback");
  return stop !== undefined &&
    (contentShipped || /still being built|not yet|to come/i.test(stop.narration));
});

/*
 * THE IDLE TIMER IS KEPT AWAY WHILE A STOP IS READ, AND HANDED BACK
 * WITH THE FRAME.
 *
 * The admin page's ten-minute expiry is real, correct product
 * behavior - it exists so a keyholder's decrypted corpus is not left
 * open on an unattended screen - and it is measured against interaction
 * with the FRAME's document, so a presenter talking over the console
 * does not count as being there. Ten minutes into a narrated walk it
 * signs itself out and throws away what it decrypted, mid-sentence.
 *
 * Both halves are asserted, and the second is the one that keeps this
 * honest: a console that simply held the page awake forever would have
 * disabled a security feature and told nobody. It stops at the stop
 * that hands the frame over, so the viewer who was just told about the
 * clock is handed the real one.
 */
await check("a narrated stop tells the frame somebody is here", () => {
  const browser = consoleInRecordedBrowser();
  const walk = Demo.TOURS.find((one) => one.id === "admin");
  browser.journey(walk.id).fire("click");
  const awake = browser.waking();
  return awake.length === 1 && awake[0].every < 8 * 60 * 1000;
});

await check("and stops the moment the frame is handed over", () => {
  const browser = consoleInRecordedBrowser();
  const walk = Demo.TOURS.find((one) => one.id === "admin");
  browser.journey(walk.id).fire("click");
  for (let i = 1; i < walk.stops.length; i += 1) {
    browser.nodes["tour-next"].fire("click");
  }
  return walk.stops[walk.stops.length - 1].free === true &&
    browser.waking().length === 0;
});

await check("leaving a journey stops it too", () => {
  const browser = consoleInRecordedBrowser();
  browser.journey("admin").fire("click");
  browser.nodes["tour-leave"].fire("click");
  return browser.waking().length === 0;
});

/*
 * And the disclosure, because a demo that quietly defeats a security
 * feature to look better is the false-confidence direction again. The
 * admin journey says out loud what the timer does and that the console
 * has been holding it off.
 */
await check("the admin journey narrates the timer rather than hiding it", () =>
  Demo.TOURS.find((one) => one.id === "admin").stops
    .some((stop) => /ten minutes/i.test(stop.narration) &&
      /awake/i.test(stop.narration)));

/* ------------------------------------------------------------------ */
/* The keyholder's key, staged so the act is performable cold (#238).  */

/*
 * The demo's headline act was not performable by anybody who had not
 * cloned this repository.
 *
 * The keyholder journey promises sealed rows coming back and opening.
 * The page asks for a key; nothing in the console, the page or the
 * frame ever surfaced one; and the key it wants exists only as a file
 * in this repository. So the press answered "paste or choose your key
 * file first" and the walk dead-ended - and Publish snapshot, which the
 * admin page only reveals after a successful decrypt, was unreachable
 * behind the same missing ingredient.
 *
 * The fix is the tour putting the committed throwaway key in the page's
 * own box, the same way a person would paste it. Everything after that
 * is the shipped code.
 *
 * IT IS A THROWAWAY, AND THE COPY HAS TO SAY SO. A demo that shows a
 * private key going into a box, in front of the person deciding whether
 * to trust this design, teaches the wrong lesson unless it says in the
 * same breath that this pair protects nothing and that the real one has
 * never been in this repository. That is a claim about what the viewer
 * is told, so it is checked rather than trusted.
 */
await check("the key the tour stages is the committed throwaway one", () =>
  Demo.DEV_KEY_FILE === "/dev/test-key.json" &&
  /THROWAWAY TEST KEY/i.test(devKeyFile));

await check("the stop that stages the key says out loud that it is a throwaway", () =>
  Demo.TOURS.some((one) => one.stops.some((stop) =>
    stop.key === true && /throwaway/i.test(stop.narration) &&
      /offline|never/i.test(stop.narration))));

/*
 * The box it goes in is the one the shipped page actually reads, read
 * out of apps/web rather than trusted - the same corollary the press
 * arm carries. A stop writing into a renamed textarea would fill
 * nothing and report nothing.
 */
await check("the key box the tour fills is the one admin.html carries", () =>
  shipped["admin.html"].includes('id="keyfile"'));

/*
 * And the transport, run rather than read: the console fetches the
 * committed file and writes its text into the frame's key box. Driven
 * through the recorded browser because the claim is that a viewer who
 * presses Fetch and decrypt finds a key already there - not that the
 * source mentions one.
 *
 * EVERY stop that stages it, not the first one this file finds. The arm
 * took the first journey with a key stop and the first key stop in it,
 * so one journey was held and the second journey's two staging stops
 * were unguarded - the shape the press arm had already been widened out
 * of, arriving again on a different declaration.
 */
await check("every stop that stages the key puts it in the frame's box",
  async () => {
    let staged = 0;
    for (const walk of Demo.TOURS) {
      for (let index = 0; index < walk.stops.length; index += 1) {
        const stop = walk.stops[index];
        if (stop.key !== true) continue;
        const browser = consoleInRecordedBrowser();
        await browser.settled();
        browser.journey(walk.id).fire("click");
        for (let i = 0; i < index; i += 1) {
          browser.nodes["tour-next"].fire("click");
        }
        browser.arrive(pageOfStop(stop));
        await browser.settled();
        if (browser.frameField("keyfile") !== devKeyFile) return false;
        if (browser.fetched.join(",") !== Demo.DEV_KEY_FILE) return false;
        staged += 1;
      }
    }
    return staged > 1;
  });

/*
 * Non-vacuity, and the arm that says the key is not simply always
 * there: a stop that does not ask for it leaves the box alone. A
 * console that filled every page's key box would pass the arm above and
 * be staging key material into pages that have no business holding it.
 */
await check("a stop that does not ask for the key leaves the box empty",
  async () => {
    const browser = consoleInRecordedBrowser();
    const walk = Demo.TOURS.find((one) =>
      one.stops.some((stop) => stop.key === true));
    browser.journey(walk.id).fire("click");
    browser.arrive(walk.stops[0].open || "admin.html");
    await browser.settled();
    return walk.stops[0].key !== true &&
      browser.frameField("keyfile") === "" &&
      browser.fetched.length === 0;
  });

/*
 * THE DISCLOSURE TRAVELS WITH THE ACT, NOT WITH ONE STOP'S NARRATION.
 *
 * The narration arm above asks that the stop built around the key says
 * what kind of key it is. That was the whole story while one stop staged
 * one; a second journey now stages the same key to reach the publishing
 * card, and a viewer walking only that one would watch a private key
 * appear in a box with nothing beside it saying what it protects - which
 * is the lesson this demo cannot afford to teach, arriving through a
 * stop nobody wrote a sentence for.
 *
 * So the console says it, in the feed, at the moment it does it. The
 * feed is where "what just happened" is already read and this is a thing
 * that just happened; the line lives in demo-stub.js so there is one
 * home for it and this suite can hold its words rather than its shape.
 */
await check("the line the console says when it stages the key names it a throwaway", () =>
  typeof Demo.KEY_STAGED_LINE === "string" &&
  /throwaway/i.test(Demo.KEY_STAGED_LINE) &&
  /offline|never|nothing real/i.test(Demo.KEY_STAGED_LINE));

/*
 * EVERY STAGING OF THE KEY, ON BOTH SURFACES (#251 F3).
 *
 * The disclosure is the sentence that stops a private key appearing in a
 * box in front of the person judging this design with nothing beside it
 * saying what it protects, so an arm that took the FIRST journey with a
 * key stop guarded exactly one of them and left the rest unwatched -
 * which is the same shape the finding above describes, in the arm
 * written to answer it. The free drive stages the key too now, and the
 * cards are a surface a driver is sent to by name, so both are walked.
 */
const saidWhileStaging = async (press, page) => {
  const browser = consoleInRecordedBrowser();
  await browser.settled();
  press(browser);
  browser.arrive(page);
  await browser.settled();
  return browser.nodes.feed.children.map((one) => one.textContent)
    .includes(Demo.KEY_STAGED_LINE);
};

await check("every staging of the key says so in the feed", async () => {
  let stops = 0;
  for (const walk of Demo.TOURS) {
    for (let index = 0; index < walk.stops.length; index += 1) {
      const stop = walk.stops[index];
      if (stop.key !== true) continue;
      const said = await saidWhileStaging((browser) => {
        browser.journey(walk.id).fire("click");
        for (let i = 0; i < index; i += 1) {
          browser.nodes["tour-next"].fire("click");
        }
      }, pageOfStop(stop));
      if (!said) return false;
      stops += 1;
    }
  }
  let cards = 0;
  for (const card of Demo.FEATURES) {
    for (const action of card.actions) {
      if (action.key !== true) continue;
      const said = await saidWhileStaging((browser) => {
        browser.cardAction(action.label).fire("click");
      }, action.open || Demo.scenarioFor(action.scenario).start);
      if (!said) return false;
      cards += 1;
    }
  }
  return stops > 1 && cards > 0;
});

/*
 * And the silence, which is what keeps the line meaning something: a
 * console that said it on every stop would be a console saying a key was
 * staged on stops where none was.
 */
await check("a stop that stages no key says nothing about one", async () => {
  const walk = Demo.TOURS.find((one) =>
    one.stops.some((stop) => stop.key === true));
  const browser = consoleInRecordedBrowser();
  browser.journey(walk.id).fire("click");
  browser.arrive(walk.stops[0].open || "admin.html");
  await browser.settled();
  return walk.stops[0].key !== true &&
    !browser.nodes.feed.children.map((one) => one.textContent)
      .includes(Demo.KEY_STAGED_LINE);
});

/* ------------------------------------------------------------------ */
/* The free drive reaches the same desk, so it needs the same key.      */

/*
 * THE DEAD END CAME BACK THROUGH THE OTHER SURFACE.
 *
 * The keyholder JOURNEY stages the throwaway key, and the card that
 * opens the same desk staged none - so a tester who opened the free
 * drive met exactly the dead end the key errand was added to remove:
 * Fetch and decrypt answering "paste or choose your key file first",
 * with no key anywhere on the machine to paste. That surface is not a
 * corner: UAT sends a driver to the cards by name for every state no
 * stop leaves live, and the card's own pointer tells them to unlock the
 * rows with the demo key.
 *
 * Stated as a rule over the staging rather than over one card's title,
 * because a card is a title somebody can rename and the desk is the
 * world that needs the key.
 */
await check("every card action that opens the keyholder's desk stages the key",
  () => {
    const desk = Demo.FEATURES.flatMap((card) => card.actions)
      .filter((action) => action.scenario === "keyholder");
    return desk.length > 0 && desk.every((action) => action.key === true);
  });

/*
 * Driven, for the same reason the journey's staging is: the claim is
 * that a viewer who presses this card and then presses Fetch and decrypt
 * finds a key already in the box, not that a field says `key: true`.
 */
await check("every card action that stages the key really fills the box",
  async () => {
    let filled = 0;
    for (const card of Demo.FEATURES) {
      for (const action of card.actions) {
        if (action.key !== true) continue;
        const browser = consoleInRecordedBrowser();
        await browser.settled();
        browser.cardAction(action.label).fire("click");
        browser.arrive(action.open || Demo.scenarioFor(action.scenario).start);
        await browser.settled();
        if (browser.frameField("keyfile") !== devKeyFile) return false;
        if (browser.fetched.join(",") !== Demo.DEV_KEY_FILE) return false;
        filled += 1;
      }
    }
    return filled > 0;
  });

// The other direction, exactly as the journeys carry it: a card that
// asks for no key leaves the box alone, or the console would be writing
// key material into pages that have no business holding it.
await check("a card that asks for no key leaves the box empty", async () => {
  const quiet = Demo.FEATURES.flatMap((card) => card.actions)
    .find((action) => action.key !== true);
  if (quiet === undefined) return false;
  const browser = consoleInRecordedBrowser();
  await browser.settled();
  browser.cardAction(quiet.label).fire("click");
  browser.arrive(quiet.open || Demo.scenarioFor(quiet.scenario).start);
  await browser.settled();
  return browser.frameField("keyfile") === "" &&
    browser.fetched.length === 0;
});

/*
 * The contents are the LANDING screen and step aside while a walk runs.
 * Four journey cards stacked above the walk panel push the narration -
 * the one thing a viewer is here to read - below the fold on an
 * ordinary window, which was found by walking it in a browser rather
 * than by reading the markup.
 */
await check("the contents step aside while a walk is running", () => {
  const browser = consoleInRecordedBrowser();
  const before = browser.nodes.tours.getAttribute("hidden");
  browser.journey(Demo.TOURS[0].id).fire("click");
  return before === null &&
    browser.nodes.tours.getAttribute("hidden") !== null;
});

await check("leaving a journey puts the glass away and the contents back", () => {
  const browser = consoleInRecordedBrowser();
  browser.journey(Demo.TOURS[0].id).fire("click");
  browser.nodes["tour-leave"].fire("click");
  return browser.locked() === false &&
    browser.nodes["tour-run"].getAttribute("hidden") !== null &&
    browser.nodes.tours.getAttribute("hidden") === null;
});

/* ------------------------------------------------------------------ */
/* #212. The feed: a press narrates what actually happened.            */

/*
 * The cards stage correctly and the frame shows the right page, and the
 * owner still could not see anything HAPPEN - a press that proves
 * "signed out means signed out" looks like nothing more than the
 * sign-in page appearing (#212). So the console carries a feed, and the
 * feed is honest by construction: every line is computed from an event
 * that occurred - the staging the press just wrote, or an answer the
 * stubbed Worker just gave - never from a script of what should happen.
 * A scripted feed would be the false-confidence lie this suite's header
 * names, told in the one place built to dispel it.
 *
 * Both halves are pure and live in demo-stub.js so they are driven
 * here: narrate() turns one Worker answer into a line or into null,
 * stagingStory() turns one staging into its lines. demo-boot.js posts
 * narrations on a BroadcastChannel as the traffic happens, and the
 * console only paints what arrives.
 */

await check("the demo names one event channel, and apps/web never says it", () =>
  typeof Demo.EVENT_CHANNEL === "string" &&
  Demo.EVENT_CHANNEL.startsWith("hgb-demo") &&
  Object.values(webSource).every((src) =>
    !src.includes(Demo.EVENT_CHANNEL)));

await check("a /me answer is narrated with the count on record", () => {
  const line = Demo.narrate({ method: "GET", path: "/me", status: 200,
    body: { ok: true, entries: 4, superseded: 0 } });
  return typeof line === "string" && line.includes("4");
});

/*
 * The supersede card's whole payoff is two numbers moving differently,
 * and the feed is where the difference gets said out loud: a replaced
 * row is a CORRECTION, in the driver's word for it, with its count.
 */
await check("a superseded row is narrated as a correction, with its count", () => {
  const line = Demo.narrate({ method: "GET", path: "/me", status: 200,
    body: { ok: true, entries: 4, superseded: 2 } });
  return typeof line === "string" && /correction/i.test(line) &&
    line.includes("2");
});

/*
 * The 401 is the revoked card's one visible moment - the page just
 * bounces to Sign in, and only the feed can say WHY. Whatever the path:
 * every gated route refuses the same way, so the narration must not be
 * keyed to one of them.
 */
await check("a 401 is narrated as the session refusing, whatever the path", () =>
  ["/me", "/submit", "/export"].every((path) => {
    const line = Demo.narrate({ method: "GET", path, status: 401,
      body: { error: "This session is no longer valid." } });
    return typeof line === "string" && /session/i.test(line) &&
      /sign in/i.test(line);
  }));

await check("signing out is narrated as the deletion it is", () => {
  const line = Demo.narrate({ method: "DELETE", path: "/session",
    status: 200, body: { ok: true } });
  return typeof line === "string" && /signed out/i.test(line);
});

await check("a submission is narrated sealed, because sealed is its point", () => {
  const line = Demo.narrate({ method: "POST", path: "/submit", status: 200,
    body: { ok: true, id: 900 } });
  return typeof line === "string" && /sealed/i.test(line);
});

/*
 * Null is a real answer and the feed depends on it: every page asks for
 * site copy on load, so narrating it would bury the signal under a line
 * per page view - and a route nobody taught the narrator must stay
 * silent rather than guess.
 */
await check("chatter is not narrated, so the feed stays signal", () =>
  Demo.narrate({ method: "GET", path: "/content", status: 200,
    body: { ok: true, content: {} } }) === null &&
  Demo.narrate({ method: "GET", path: "/never-taught", status: 200,
    body: { ok: true } }) === null);

/*
 * A refusal the operator provoked carries the Worker's own words,
 * because those words are the product behavior being demonstrated -
 * paraphrasing them would put a second opinion between the driver and
 * the thing they are judging.
 */
await check("a refusal is narrated with the Worker's words in it", () => {
  const line = Demo.narrate({ method: "POST", path: "/membership",
    status: 400, body: { error: "A numeric Telegram id is needed." } });
  return typeof line === "string" && line.includes("numeric Telegram id");
});

/*
 * The sweep: real requests through the real stub, and every line that
 * comes out speaks the driver's language. Driven through answerFor
 * rather than hand-built events so the narrations are held against the
 * answers the stub actually gives - a narrate() tuned to events the
 * stub never produces would pass any hand-written list.
 */
await check("every narration of real traffic speaks the driver's language", () =>
  [
    { request: { method: "POST", path: "/auth/telegram", body: {} },
      state: world("signed-out") },
    { request: { method: "GET", path: "/me" }, state: world("member") },
    { request: { method: "GET", path: "/me" }, state: world("supersede") },
    { request: { method: "POST", path: "/submit", body: {} },
      state: world("member") },
    { request: { method: "DELETE", path: "/session" }, state: world("member") },
    { request: { method: "GET", path: "/me" }, state: world("revoked") },
    { request: { method: "GET", path: "/export" }, state: world("keyholder") },
    { request: { method: "GET", path: "/snapshot" }, state: world("member") },
    { request: { method: "POST", path: "/snapshot", body: { snapshot: 1 } },
      state: world("admin") },
    { request: { method: "GET", path: "/membership" }, state: world("admin") },
    { request: { method: "POST", path: "/membership",
      body: { role: "admin", telegramId: "x" } }, state: world("admin") },
    { request: { method: "GET", path: "/content" }, state: world("member") },
    { request: { method: "POST", path: "/content",
      body: { name: "site.title", value: "X" } }, state: world("admin") },
    { request: { method: "GET", path: "/nothing" }, state: world("member") },
  ].every((one) => {
    const answer = Demo.answerFor(one.request, one.state);
    const line = Demo.narrate({
      method: one.request.method,
      path: one.request.path,
      status: answer.status,
      body: answer.body,
    });
    return line === null ||
      (typeof line === "string" && line.length > 0 &&
        !CARD_JARGON.test(line) && !line.includes("`"));
  }));

/*
 * The other half of the feed: what the press itself just did. Also pure,
 * also derived - from the staging's own fields, not from a description
 * beside them.
 *
 * WHAT THIS ARM DOES AND DOES NOT SAY. It says every line is a line, in
 * the driver's language. It says nothing about whether a staging is
 * narrated at all: stagingStory's session line is unconditional, so
 * `length >= 1` holds for a scenario nothing else in the function has
 * ever heard of. The two arms under it are the ones that make the
 * coverage claim, and they are separate because this one is about the
 * REGISTER and those are about REACH - a single arm mixing them fails
 * for two unrelated reasons and reads as one.
 */
await check("every staging tells its story, in the driver's language", () =>
  Demo.SCENARIOS.every((one) => {
    const story = Demo.stagingStory(one);
    return Array.isArray(story) && story.length >= 1 &&
      story.every((line) => typeof line === "string" && line.length > 0 &&
        !CARD_JARGON.test(line) && !line.includes("`"));
  }));

/*
 * #154 F3, first half. EVERY STAGED FLAG IS NARRATED, PROVEN BY TAKING
 * IT AWAY.
 *
 * A scenario is plumbing - id, label, start, session, boxes - plus the
 * flags that make it worth staging: a prefill waiting on the device, a
 * session revoked somewhere else. The plumbing is listed here and
 * everything outside the list is treated as a flag that has to change
 * what the feed says, which is asserted the only way that cannot be
 * faked: build the same scenario without the flag and require a
 * different story. An arm phrased as "the story is long enough" holds
 * for a flag nothing reads.
 *
 * The list is deliberately the thing a new plumbing field trips over.
 * Adding one fails here until somebody says out loud that it stages
 * nothing a driver can see - which is the cheaper failure, because the
 * other direction is a staged behavior that the console never mentions
 * and nobody notices for a release.
 */
const STAGING_PLUMBING = ["id", "label", "start", "session", "boxes"];
const flagsOn = (one) =>
  Object.keys(one).filter((key) => !STAGING_PLUMBING.includes(key));
// Non-vacuity, for the reason the endpoint reader has an arm of its own:
// a differential test over an empty set of differences passes forever.
const stagedFlagCount =
  Demo.SCENARIOS.reduce((total, one) => total + flagsOn(one).length, 0);

await check("every flag a staging sets is a flag the story tells", () =>
  stagedFlagCount >= 2 &&
  Demo.SCENARIOS.every((one) => {
    const told = Demo.stagingStory(one).join("\n");
    return flagsOn(one).every((flag) => {
      const without = Object.assign({}, one);
      delete without[flag];
      return Demo.stagingStory(without).join("\n") !== told;
    });
  }));

/*
 * #154 F3, second half. THE SILENT STAGINGS ARE NAMED HERE, AS
 * LITERALS.
 *
 * A staging keyed on its id rather than on a flag - the correction, the
 * suppressed charts, the empty site copy - is invisible to the arm
 * above, because there is no field to take away. And most of the
 * scenarios legitimately say nothing beyond the session line: arriving
 * signed out, or signed in, IS the whole staging. So the ones that are
 * allowed to be silent are spelled out, the same way the mirror's three
 * edits are spelled out one screen up rather than counted from the
 * table they guard.
 *
 * What this buys is the case #154 found: a staging added with a card to
 * reach it passes every other arm in this file and lands silent in the
 * feed, because every one of them is computed from SCENARIOS and holds
 * as well over ten stagings as over nine. It fails here, and the author
 * chooses - write the story, or say here that this one has none.
 */
await check("only the stagings named here narrate nothing beyond the session line", () =>
  Demo.SCENARIOS.filter((one) => Demo.stagingStory(one).length < 2)
    .map((one) => one.id).sort().join(",") ===
    "admin,keyholder,member,signed-out");

await check("the stories say the thing each staging exists to show", () => {
  const storyOf = (id) => Demo.stagingStory(Demo.scenarioFor(id)).join(" ");
  return /signed out/i.test(storyOf("revoked")) &&
    /device/i.test(storyOf("member-prefilled")) &&
    /few/i.test(storyOf("suppressed")) &&
    /signed in/i.test(storyOf("signed-out"));
});

/*
 * One pointer per action, so a driver who just watched the feed knows
 * what to touch in the frame. On the action rather than painted from a
 * separate list, because a pointer that cannot name its action is a
 * pointer that outlives it.
 */
await check("every card action tells the driver what to try next", () =>
  Demo.FEATURES.every((card) => card.actions.every((action) =>
    typeof action.try === "string" && action.try.length > 0 &&
    !CARD_JARGON.test(action.try) && !action.try.includes("`"))));

/*
 * #154 F1. THE TRANSPORT IS EARNED BY RUNNING THE BYTES, BECAUSE A
 * SOURCE-STRING ARM HERE IS SATISFIABLE BY A COMMENT.
 *
 * demo-boot.js is the one file every stubbed answer passes through, and
 * its `tell()` is what puts narrate's sentence on the channel. Asking
 * that file's TEXT for "Demo.narrate", "BroadcastChannel" and
 * "EVENT_CHANNEL" does not ask whether any of it runs: the comment
 * above `tell()` names Demo.narrate in prose, so a `tell()` emptied to
 * a no-op keeps every one of those three strings and leaves the whole
 * suite green. The demo then paints its staging lines exactly as it
 * does now and
 * narrates nothing that actually happened - a feed that looks live with
 * no event under it, which is the false-confidence lie told on the one
 * instrument the owner accepts the cutover with.
 *
 * So the file is loaded the way memberkey.test.mjs loads a shipped
 * script: its real bytes under node:vm, with the browser it needs
 * RECORDED rather than described - a BroadcastChannel that keeps what
 * it is handed, a fetch it wraps, and the real Demo behind it. One
 * stubbed answer is driven through the fetch this file installs and the
 * channel has to carry narrate's own line for that answer. No seam is
 * added to demo-boot.js to make this possible; a testability hook in
 * the file under test is one more thing the shipped page does not do.
 *
 * There is no source-level arm beside this one, deliberately. Every
 * literal such an arm could pin - the channel's name, the narrator, the
 * transport - is spelled by the execution below, and a comment cannot
 * execute.
 */
const DEMO_ORIGIN = "http://127.0.0.1:8126";
const WORKER_ORIGIN = "https://worker.example";

function bootInRecordedBrowser() {
  const posted = [];
  const opened = [];
  const proxied = [];
  const stored = {};
  const context = {
    BinderDemo: Demo,
    BINDER_CONFIG: { endpoint: WORKER_ORIGIN },
    location: { href: DEMO_ORIGIN + "/your-page.html" },
    Response,
    sessionStorage: {
      getItem: (key) => (key in stored ? stored[key] : null),
      setItem: (key, value) => { stored[key] = String(value); },
    },
    /*
     * A constructor rather than an object, because the file asks
     * `typeof root.BroadcastChannel === "function"` and then news it -
     * and the name it is newed with is the thing worth recording.
     */
    BroadcastChannel: function (name) {
      opened.push(name);
      this.postMessage = (message) => { posted.push(message); };
    },
    fetch: (input) => { proxied.push(input); return Promise.resolve(null); },
  };
  vm.createContext(context);
  vm.runInContext(bootSource, context, { filename: "demo-boot.js" });
  return { context, posted, opened, proxied };
}

const BOOT_STATE = { scenario: "member", data: {} };

await check("the boot file puts narrate's own line for a stubbed answer on the channel",
  async () => {
    const { context, posted, opened, proxied } = bootInRecordedBrowser();
    const response = await context.fetch(WORKER_ORIGIN + "/me",
      { method: "GET" });
    const answer = Demo.answerFor({ method: "GET", path: "/me", body: null },
      BOOT_STATE);
    const want = Demo.narrate({ method: "GET", path: "/me",
      status: answer.status, body: answer.body });
    return opened.join(",") === Demo.EVENT_CHANNEL &&
      typeof want === "string" && want.length > 0 &&
      posted.length === 1 && posted[0].line === want &&
      response.status === answer.status &&
      // The stubbed answer is stubbed: nothing reached the wrapped fetch.
      proxied.length === 0;
  });

/*
 * And the silence, which is half of what makes the feed readable: a
 * channel that posted every answer would pass the arm above while
 * burying the press being watched under a line per page load. Site copy
 * is the case that actually occurs - every page asks for it.
 */
await check("and it stays silent for an answer narrate has no line for",
  async () => {
    const { context, posted } = bootInRecordedBrowser();
    const answer = Demo.answerFor(
      { method: "GET", path: "/content", body: null }, BOOT_STATE);
    await context.fetch(WORKER_ORIGIN + "/content", { method: "GET" });
    return answer.status === 200 &&
      Demo.narrate({ method: "GET", path: "/content", status: answer.status,
        body: answer.body }) === null &&
      posted.length === 0;
  });

await check("the console page carries the feed and the pointer", () =>
  consoleHtml.includes('id="feed"') &&
  consoleHtml.includes('id="try-next"'));

await check("the console script paints the feed from the channel and the stories", () =>
  consoleJs.includes('$("feed")') &&
  consoleJs.includes("BroadcastChannel") &&
  consoleJs.includes("stagingStory") &&
  consoleJs.includes("try-next"));

/* ------------------------------------------------------------------ */
/* F2. A box must not flip to drivable on a comment.                   */

/*
 * paintBoxes counted raw substring hits, so a TODO comment mentioning
 * "instrument" flipped admin-panel to drivable with nothing implemented
 * - a false PASS shown to the person deciding the cutover, which is the
 * worst thing this tool can do. The verdict is a pure function now, so
 * it is driven here rather than only in a browser.
 *
 * The answers are deliberately NOT pinned. A check that failed the day
 * PR 5 landed would be a gate asking the project to stand still; what is
 * pinned is that the mechanism cannot be fooled.
 */
await check("every box has a probe naming a file that exists", async () => {
  for (const box of Demo.BOXES) {
    if (!box.probe || !box.probe.file || !box.probe.pattern) return false;
    await readFile(HERE("../" + box.probe.file), "utf8");
  }
  return true;
});

await check("a probe does not count its pattern inside an HTML comment", () =>
  Demo.probeHit("<!-- TODO: build the instrument panel -->\n<main></main>",
    { file: "apps/web/admin.html", pattern: "instrument", markup: true })
    === false);

await check("a probe does not count its pattern inside a JS comment", () =>
  Demo.probeHit("// TODO: read superseded off /me one day\nconst x = 1;\n",
    { file: "apps/web/submit.js", pattern: "superseded" }) === false);

await check("a probe does not count its pattern inside a JS block comment", () =>
  Demo.probeHit("/*\n * config.endpoint + \"/content\" is PR 5's job.\n */\n",
    { file: "apps/web/admin.js", pattern: '"/content"' }) === false);

/*
 * The other half of F2's fix: a low-cardinality English word has to be
 * anchored to markup, because prose on the page carries it as readily as
 * a comment does. "instrument" appears in a sentence describing the
 * panel long before the panel exists.
 */
await check("a markup-anchored probe ignores the word in body prose", () =>
  Demo.probeHit("<main><p>The instrument panel is coming.</p></main>",
    { file: "apps/web/admin.html", pattern: "instrument", markup: true })
    === false);

await check("a markup-anchored probe finds the word inside a tag", () =>
  Demo.probeHit('<section class="instrument-panel"><p>Hi</p></section>',
    { file: "apps/web/admin.html", pattern: "instrument", markup: true })
    === true);

await check("a probe still finds its pattern in real code", () =>
  Demo.probeHit("function restorePrefill() { return 1; }",
    { file: "apps/web/submit.js", pattern: "restorePrefill" }) === true);

/*
 * And the whole board is computed here the way the console computes it,
 * so a probe that throws on the shipped bytes fails the gate rather than
 * painting "unreadable" in front of the owner.
 */
await check("every probe runs against its real shipped file", async () => {
  for (const box of Demo.BOXES) {
    const src = await readFile(HERE("../" + box.probe.file), "utf8");
    if (typeof Demo.probeHit(src, box.probe) !== "boolean") return false;
  }
  return true;
});

/* ------------------------------------------------------------------ */
/* #142. The frame's width is the viewport the page lays out against.   */

/*
 * The phone view is one number applied to one element, and both halves
 * of that carry a way to lie.
 *
 * The NUMBER is spelled out here rather than read back off the table,
 * for F1's reason one file over: a check asserting the frame is
 * `viewportFor("phone").width` cannot fail when that width is the thing
 * that changed. 375 x 812 is what the owner ruled on #142.
 *
 * The ELEMENT is pinned by making the size a pure function, so this
 * suite can drive what the console assigns. The failure this control
 * can have while still looking right is a phone-shaped box around a
 * page laid out at desktop width - an iframe's own width is the
 * viewport of the page inside it, and a width put on any wrapper
 * produces exactly that screen, in front of the person deciding the
 * cutover.
 *
 * Nothing here asserts a device, because nothing here emulates one: no
 * touch, no user agent, no pixel ratio. The demo is never driven on a
 * phone (owner ruling on #142), and a faked device would put a screen
 * in front of the owner that no browser on the machine can be asked to
 * reproduce.
 */
await check("the phone frame is the size #142 ruled, and desktop carries none", () => {
  const phone = Demo.viewportFor("phone");
  const desktop = Demo.viewportFor("desktop");
  return phone !== null && phone.width === 375 && phone.height === 812 &&
    desktop !== null && desktop.width === null && desktop.height === null;
});

/*
 * The console starts the frame in the first viewport the table lists
 * and paints no size for it, so the order here is a contract rather
 * than a presentation detail: a table led by a sized viewport opens the
 * console with a phone frame nobody chose.
 */
await check("the table leads with the viewport that carries no size", () =>
  Demo.VIEWPORTS.length >= 2 &&
  Demo.VIEWPORTS[0].id === "desktop" && Demo.VIEWPORTS[0].width === null &&
  Demo.VIEWPORTS.every((one) =>
    typeof one.id === "string" && one.id.length > 0 &&
    typeof one.label === "string" && one.label.length > 0) &&
  new Set(Demo.VIEWPORTS.map((one) => one.id)).size === Demo.VIEWPORTS.length);

/*
 * F8's lesson, one control over. A viewport id the table does not know
 * has to refuse rather than fall back to desktop: falling back paints a
 * desktop page under a control reading Phone, which is the
 * false-confidence direction this suite's header names as the worse of
 * the two lies.
 */
await check("an unknown viewport id is refused, not quietly made desktop", () =>
  Demo.viewportFor("phone-xl") === null &&
  Demo.frameStyleFor("phone-xl") === null);

await check("the phone size is written in CSS pixels, and desktop clears it", () => {
  const phone = Demo.frameStyleFor("phone");
  const desktop = Demo.frameStyleFor("desktop");
  return phone.width === "375px" && phone.height === "812px" &&
    desktop.width === "" && desktop.height === "";
});

/*
 * The cross-file arm, and the one that can go red without anybody
 * touching dev/.
 *
 * 375 is a phone width only because apps/web says so. What UAT A1.12
 * asks the owner to see - the rail as a strip, its destinations still
 * in flow - is one media block in the shipped stylesheet, and the
 * frame is only worth looking at if that block fires inside it. A later
 * slice moving that breakpoint below 375 leaves this console framing a
 * desktop rail at phone width: a screen the product does not have,
 * shown as if it were the product.
 *
 * The breakpoint is READ out of theme.css rather than written down
 * here, for the same reason the page list is read out of apps/web. It
 * is found by the rules that turn the rail into a strip rather than by
 * being the largest, because "the largest max-width in the file" is a
 * fact about ordering that any unrelated block can change - a first
 * attempt at this check compared the largest and the smallest
 * breakpoints, and moving the rail-folding block from 64rem to 20rem
 * left it green, with an unrelated 52rem block satisfying it.
 *
 * The palette control is not one of those rules. It is one control at
 * every width (#150), so it sits outside every media query - and a
 * marker that no width block contains would make this arm match nothing
 * and fail for a reason that has nothing to do with the frame. What is
 * left is the rail itself: the links becoming a row and the session
 * becoming the end of it.
 */
const themeCss = await readFile(HERE("../apps/web/theme.css"), "utf8");
const ROOT_PX = 16;

function widthBlocks(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [];
  const OPEN = /@media\s*\(max-width:\s*([\d.]+)rem\s*\)\s*\{/g;
  let found;
  while ((found = OPEN.exec(clean)) !== null) {
    let depth = 1;
    let index = OPEN.lastIndex;
    while (index < clean.length && depth > 0) {
      if (clean[index] === "{") depth++;
      else if (clean[index] === "}") depth--;
      index++;
    }
    blocks.push({
      px: Number(found[1]) * ROOT_PX,
      body: clean.slice(OPEN.lastIndex, index - 1),
    });
  }
  return blocks;
}

const foldingBlocks = widthBlocks(themeCss)
  .filter((one) => /\.rail-links\s*\{/.test(one.body) &&
    /\.rail-session\s*\{/.test(one.body));

await check("the block that folds the rail into a strip fires in the phone frame", () => {
  const phone = Demo.viewportFor("phone");
  return foldingBlocks.length === 1 && foldingBlocks[0].px >= phone.width;
});

/* ------------------------------------------------------------------ */
/* F5. Which URLs the demo will let through.                           */

/*
 * The egress refusal compared substrings, and two URL classes walked
 * past it: a userinfo trick, where everything before the @ is a
 * credential and the host is what follows it, and a one-slash scheme,
 * which is a relative path to no host the substring test recognized.
 * Both are resolved against the page's own URL now and compared by
 * .origin, which is the only comparison that cannot be spelled around.
 */
const BASE = "http://127.0.0.1:8126/dev/demo.html";

await check("a userinfo trick that reads same-origin by substring is refused", () =>
  Demo.sameOriginAs("http://127.0.0.1:8126@evil.example/x", BASE) === false);

await check("a one-slash scheme is refused", () =>
  Demo.sameOriginAs("https:/evil.example/x", BASE) === false);

await check("a plain third-party URL is still refused", () =>
  Demo.sameOriginAs("https://evil.example/x", BASE) === false);

await check("relative and same-origin URLs are still allowed", () =>
  Demo.sameOriginAs("/dev/sample-submissions.json", BASE) === true &&
  Demo.sameOriginAs("sample.json", BASE) === true &&
  Demo.sameOriginAs("http://127.0.0.1:8126/apps/web/index.html", BASE) === true);

await check("a URL that will not parse at all is refused rather than allowed", () =>
  Demo.sameOriginAs("http://[not a host]/x", BASE) === false);

/*
 * The Worker test is the same shape: it decided by substring too, so an
 * endpoint-prefixed userinfo trick was read as a Worker call and answered
 * from the stub - which hides an escape rather than causing one, but hides
 * it in the logs the owner would check.
 */
await check("the Worker path is derived by origin, not by substring", () => {
  const endpoint = "https://api.example.workers.dev";
  return Demo.workerPathOf(endpoint + "/me", BASE, endpoint) === "/me" &&
    Demo.workerPathOf("https://api.example.workers.dev@evil.example/me",
      BASE, endpoint) === null;
});

/* ------------------------------------------------------------------ */
/* #143. Hosting the demo puts it ON an origin the demo has opinions   */
/* about, and the two decisions collide there.                         */

/*
 * THE COLLISION, AND WHY IT ONLY EXISTS ONCE THE DEMO IS HOSTED.
 *
 * workerPathOf has a wildcard arm: any host ending `.workers.dev` is
 * treated as the Worker, so a page reaching the endpoint by some route
 * other than the configured one is still stubbed rather than let out.
 * That arm is right, and on 127.0.0.1 it can never match the page's own
 * origin.
 *
 * Host the build on a workers.dev URL and it matches the page itself.
 * Every same-origin request - the console's own probes, an asset, the
 * committed sample - is then read as a call to the Worker and answered
 * 404 by a stub that was never asked about files. The demo does not
 * leak; it stops working, in a way whose symptom is a product page
 * failing to load its own data, which reads as the product being
 * broken.
 *
 * So same-origin is decided FIRST and never as a Worker call, on every
 * host rather than on the one that exposed it - a fix keyed on the
 * hosting domain is a fix that stops working when the owner moves the
 * build.
 */
const HOSTED = "https://hgbinder-demo.example.workers.dev/dev/demo.html";
const ENDPOINT = "https://demo.invalid";

await check("on a workers.dev host, a same-origin URL is not read as a Worker call", () =>
  Demo.requestKindOf(
    "https://hgbinder-demo.example.workers.dev/dev/sample-submissions.json",
    HOSTED, ENDPOINT).kind === "file");

await check("the same URL one host over is still the stub's to answer", () =>
  Demo.requestKindOf("https://hgbinderworker-dev.sorcererbiggz.workers.dev/me",
    HOSTED, ENDPOINT).kind === "worker");

/*
 * Same-origin is an ALLOWLIST, not a pass. A fall-through handing any
 * same-origin URL to the real fetch is, on a static host, a read of
 * whatever else got baked - and the emitted set is the one thing a
 * static host will serve to anybody without asking.
 */
await check("the one file the demo really fetches is allowed by name", () =>
  Demo.requestKindOf("/dev/sample-submissions.json", HOSTED, ENDPOINT)
    .kind === "file" &&
  Demo.LOCAL_FILES.length === 1 &&
  Demo.LOCAL_FILES[0] === "/dev/sample-submissions.json");

await check("a sibling under the same directory is refused, not fetched", () =>
  Demo.requestKindOf("/dev/test-key.json", HOSTED, ENDPOINT).kind === "refuse" &&
  Demo.requestKindOf("/dev/demo-stub.js", HOSTED, ENDPOINT).kind === "refuse");

await check("the configured endpoint is answered by the stub, path and all", () => {
  const decided = Demo.requestKindOf(ENDPOINT + "/me?x=1", HOSTED, ENDPOINT);
  return decided.kind === "worker" && decided.path === "/me?x=1";
});

await check("a plain third party is refused with the URL in the message", () => {
  const decided = Demo.requestKindOf("https://evil.example/x", HOSTED, ENDPOINT);
  return decided.kind === "refuse" && String(decided.why).includes("evil.example");
});

await check("a URL that will not parse is refused rather than fetched", () =>
  Demo.requestKindOf("http://[not a host]/x", HOSTED, ENDPOINT)
    .kind === "refuse");

/*
 * And the same decisions still hold where the demo has always run, so
 * the hosted arm is not a second set of rules nobody drives locally.
 */
await check("the local demo decides the same three ways", () =>
  Demo.requestKindOf("/dev/sample-submissions.json", BASE, ENDPOINT)
    .kind === "file" &&
  Demo.requestKindOf(ENDPOINT + "/session", BASE, ENDPOINT).kind === "worker" &&
  Demo.requestKindOf("https://evil.example/x", BASE, ENDPOINT)
    .kind === "refuse");

/* ------------------------------------------------------------------ */
/* #143. The stand-in behind the config edit.                          */

const demoConfig = await readFile(HERE("./demo-config.js"), "utf8");

/*
 * PINNED AGAINST config.js, NOT AGAINST ITSELF. The stand-in carries a
 * copy of the development public key, and a copy is a thing that
 * drifts: rotate the development pair and the demo would go on sealing
 * to a key the committed sample was never sealed to, which surfaces as
 * rows that will not open and reads as a crypto bug.
 *
 * The comparison is one-directional - the stand-in's key must be one
 * config.js names - so adding an environment to config.js does not turn
 * this red.
 */
await check("the demo config seals to the development key config.js ships", () => {
  const keys = (webSource["config.js"].match(/publicKey:\s*"([^"]+)"/g) || [])
    .map((one) => /"([^"]+)"/.exec(one)[1]);
  const mine = /publicKey:\s*"([^"]+)"/.exec(demoConfig);
  return keys.length >= 2 && mine !== null && keys.includes(mine[1]);
});

/*
 * The endpoint is deliberately NOT the development Worker. The stub
 * intercepts every call, so the name never resolves in normal
 * operation - which is exactly why it matters what it says: the one
 * case that reaches the network is the case where the interception
 * failed, and that case must not arrive at a Worker that exists.
 * `.invalid` is reserved and resolves nowhere, and the pages' own
 * connect-src does not name it either, so the browser refuses it a
 * second time.
 */
await check("the demo config points at a name that cannot resolve", () => {
  const endpoint = /endpoint:\s*"([^"]+)"/.exec(demoConfig);
  return endpoint !== null && /\.invalid(\/|$)/.test(endpoint[1]) &&
    !demoConfig.includes("workers.dev");
});

await check("no page's connect-src names the demo's endpoint", () =>
  PAGES.every((page) => !shipped[page].includes(".invalid")));

/* ------------------------------------------------------------------ */
/* #143. A probe has to be readable in a build with no server.         */

/*
 * The console reads the shipped bytes to fill the acceptance table, and
 * a baked build cannot serve apps/web's PAGES at their own path -
 * an un-mirrored page is one with no fetch replacement on it. So an
 * HTML probe is read through the mirror and undone, which gives back
 * the shipped bytes exactly (the round trip is checked above), and
 * everything else is read from its own path.
 */
await check("an HTML probe is read through the mirror, not from apps/web", () =>
  Demo.probeUrlFor("apps/web/admin.html") === "/demo/admin.html");

await check("a source probe is read from its own path", () =>
  Demo.probeUrlFor("apps/web/submit.js") === "/apps/web/submit.js" &&
  Demo.probeUrlFor("apps/web/theme.css") === "/apps/web/theme.css");

await check("an HTML probe's bytes are undone back to what apps/web ships", () =>
  Demo.probeSourceOf("apps/web/admin.html",
    Demo.mirror(shipped["admin.html"]).html) === shipped["admin.html"]);

await check("a source probe's bytes are passed through untouched", () =>
  Demo.probeSourceOf("apps/web/submit.js", webSource["submit.js"]) ===
    webSource["submit.js"]);

/*
 * And the verdict is unchanged by the trip, which is the property that
 * makes the detour honest rather than merely convenient.
 */
await check("reading a probe through the mirror gives the same verdict", () => {
  const box = Demo.BOXES.find((one) => one.probe.file.endsWith(".html"));
  const direct = Demo.probeHit(shipped["admin.html"], box.probe);
  const round = Demo.probeHit(
    Demo.probeSourceOf(box.probe.file,
      Demo.mirror(shipped["admin.html"]).html), box.probe);
  return direct === round;
});

/* ------------------------------------------------------------------ */
/* F7. --port refuses loudly rather than landing on somebody's port.   */

/*
 * A silent fallback sends every bad argument to 8126 - the owner's own
 * demo port. 0x1FE0 is worse than silent: Number() reads hex, so it
 * binds 8160, inside the block the agent fleet assigns itself previews
 * from. A launcher that binds a port nobody asked for is how two
 * servers end up serving two different trees on one number, and the
 * operator reads whichever they find first.
 */
await mustReject("--port refuses a value that is not a plain number",
  async () => portFrom(["node", "demo-server.mjs", "--port", "8199x"]),
  "8199x");

await mustReject("--port refuses a hexadecimal value rather than reading it",
  async () => portFrom(["node", "demo-server.mjs", "--port", "0x1FE0"]),
  "0x1FE0");

await mustReject("--port refuses a missing value",
  async () => portFrom(["node", "demo-server.mjs", "--port"]),
  "--port");

await mustReject("--port refuses a value outside the range",
  async () => portFrom(["node", "demo-server.mjs", "--port", "-1"]),
  "-1");

await check("--port accepts a plain in-range number, and no flag is the default", () =>
  portFrom(["node", "demo-server.mjs", "--port", "8166"]) === 8166 &&
  portFrom(["node", "demo-server.mjs"]) === 8126);

/* ------------------------------------------------------------------ */
/* The staged corpora, measured against the shipped floor.             */

const deps = { buildRecord: Form.buildRecord, entryFor: Admin.entryFor };
const rich = Demo.entriesFrom("rich", deps);
const sparse = Demo.entriesFrom("sparse", deps);
const richSnapshot = Dashboard.snapshotOf(rich);
const sparseSnapshot = Dashboard.snapshotOf(sparse);

await check("the rich corpus clears the floor the published series needs", () =>
  richSnapshot.series !== null &&
  richSnapshot.series.length >= Dashboard.MIN_CELL);

await check("every rich submitter has a series with more than one point", () =>
  richSnapshot.series.every((line) => line.points.length >= 2));

await check("the rich corpus is above the people floor", () =>
  richSnapshot.counts.people >= Dashboard.MIN_CELL);

await check("the sparse corpus is below it, and publishes no series", () =>
  sparseSnapshot.counts.people < Dashboard.MIN_CELL &&
  sparseSnapshot.series === null);

/*
 * The two corpora have to stay two. Collapsing them into one dataset
 * would leave the demo unable to show either the payoff or the
 * suppression honestly, and the collapse is the kind of tidying that
 * looks like a simplification.
 */
await check("the two corpora are different people", () => {
  const of = (entries) => new Set(entries.map((entry) => entry.accountId));
  const a = of(rich);
  const b = of(sparse);
  return [...a].every((id) => !b.has(id));
});

await check("nothing published carries a handle", () =>
  !JSON.stringify(richSnapshot).includes("demo_member"));

/* ------------------------------------------------------------------ */
/* #259 F5. The document the journey narrates a change over.           */

/*
 * THE DEFECT: THE NARRATION PROMISED A FIGURE THE STAGING COULD NOT
 * DRAW.
 *
 * "the combined weight, the change since last time, and the lines
 * running together" is narrated over a FIRST publish. movementOf()
 * answers null when there is no comparable predecessor, movementText()
 * answers null on that, and the hero delta is simply never appended - so
 * the one line the sentence named was the only thing on that page the
 * viewer could not find, with nothing on screen to say why. It is the
 * false-confidence direction this suite's header names: a plausible
 * screen, missing the thing being described.
 *
 * So the staged document is a SECOND publish, built the way
 * apps/web/admin.js builds one - the earlier generation from the
 * corpus's own earlier submissions, both generations through the shipped
 * snapshotOf. Nothing writes a document by hand: a predecessor spelled
 * out beside the aggregation would be the demo holding a second opinion
 * about what a snapshot is, which is the thing dev/demo-corpus.js exists
 * to avoid.
 */
const corpusDeps = Object.assign({ snapshotOf: Dashboard.snapshotOf }, deps);

/*
 * Built lazily and memoized, so a builder that is missing or throws
 * fails the arms that need it by name instead of dying at file scope and
 * taking every check after it down with it.
 */
const publishedCache = new Map();
const publishedFor = (which) => {
  if (!publishedCache.has(which)) {
    publishedCache.set(which, Demo.publishedFrom(which, corpusDeps));
  }
  return publishedCache.get(which);
};

/*
 * Read back through the stub's own /snapshot route rather than off the
 * builder, because the seed a journey stop reads is the one at that
 * route: a builder producing a perfect document the staging never served
 * would satisfy an arm written the other way.
 */
const stagedDocument = (scenario) => {
  const answer = Demo.answerFor({ method: "GET", path: "/snapshot" }, {
    scenario: scenario,
    data: { rich: publishedFor("rich"), sparse: publishedFor("sparse") },
  });
  return answer.status === 200 ? answer.body.snapshot : null;
};

await check("the document the charts staging serves is a second publish", () => {
  const doc = stagedDocument("member");
  return doc !== null && doc.movement !== null &&
    typeof doc.movement.since === "string" &&
    Number.isFinite(Date.parse(doc.movement.since)) &&
    Date.parse(doc.movement.since) < Date.parse(doc.generated);
});

await check("and it carries a movement over the floor, in both bases and both systems", () => {
  const movement = stagedDocument("member").movement;
  return movement.bases !== null &&
    ["people", "entries"].every((basis) =>
      movement.bases[basis] !== null &&
      Object.keys(Dashboard.UNITS).every((unit) =>
        Number.isFinite(movement.bases[basis][unit].weight) &&
        movement.bases[basis][unit].weight !== 0));
});

/*
 * The predecessor is this corpus one publish ago and not a second
 * dataset: the staged document counts what the plain aggregation counts,
 * and only the movement is new. Without this the builder could be
 * measuring against people the demo never shows.
 */
await check("the staged document is the same corpus, one publish later", () => {
  const doc = stagedDocument("member");
  return doc.counts.entries === richSnapshot.counts.entries &&
    doc.counts.people === richSnapshot.counts.people &&
    doc.series !== null && doc.series.length === richSnapshot.series.length;
});

/*
 * WHICH field the line is drawn from, read out of apps/web rather than
 * asserted here - AGENTS.md's corollary: a check computed entirely from
 * the demo cannot notice that the page stopped reading `movement`, and
 * would go on certifying a staging nothing renders.
 */
await check("the change-since line the charts draw is drawn from that field", () =>
  webSource["dashboard.js"].includes(
    "function movementText(snapshot, basis, spec) {") &&
  webSource["dashboard.js"].includes("const movement = snapshot.movement;") &&
  webSource["dashboard.js"].includes(
    "const moved = movementText(snapshot, basis, spec);"));

/*
 * And the coherence arm the slice is for: the demo narrates only what
 * the staging shows. A stop whose own words promise the change since
 * last time has to open on a document that has one.
 */
const PROMISES_MOVEMENT = /\bsince last time\b/i;

await check("a stop promising a change since last time opens on a document with one", () =>
  Demo.TOURS.every((walk) => walk.stops.every((stop) => {
    if (!PROMISES_MOVEMENT.test(stop.title + " " + stop.narration)) return true;
    const doc = stagedDocument(stop.scenario);
    return doc !== null && doc.movement !== null && doc.movement.bases !== null;
  })));

// Non-vacuity in both directions: some stop really promises it, and a
// staging with nothing comparable really says nothing - so the arm above
// is a partition rather than a sentence true of everything.
await check("some stop promises it, and a staging with nothing to compare stays silent", () =>
  Demo.TOURS.some((walk) => walk.stops.some((stop) =>
    PROMISES_MOVEMENT.test(stop.title + " " + stop.narration))) &&
  stagedDocument("suppressed").movement === null);

/*
 * NEVER A HAND-WRITTEN DOCUMENT - the condition the scope amendment on
 * #259 widened this slice's file list on, and the one the five arms
 * above cannot see.
 *
 * Every one of them reads the served document's SHAPE: a movement that
 * is not null, a `since` that parses and precedes `generated`, bases
 * non-zero in both bases and both systems, counts equal to the plain
 * aggregation's. An object literal carrying plausible totals, spelled
 * out beside the aggregation as the predecessor, satisfies all of it -
 * and what the demo would then serve is a second opinion about what a
 * snapshot contains, free to drift from the one apps/web/admin.js builds
 * when the keyholder presses Publish. That drift is the whole reason
 * dev/demo-corpus.js has no opinion of its own.
 *
 * So this drives the builder through a RECORDING aggregation and holds
 * the mechanism instead of the output: it is asked twice, the earlier
 * generation is the smaller one and is the one handed a date, and the
 * predecessor the later generation carries is IDENTICALLY the object the
 * earlier call returned. A literal cannot be identical to a return value
 * nobody asked for, and neither can a copy of one.
 */
const publishedThrough = (which) => {
  const calls = [];
  const recording = (entries, options, now) => {
    const made = Dashboard.snapshotOf(entries, options, now);
    calls.push({ entries: entries, options: options, now: now, made: made });
    return made;
  };
  const made = Demo.publishedFrom(which,
    Object.assign({}, corpusDeps, { snapshotOf: recording }));
  return { calls: calls, made: made };
};

const richThrough = publishedThrough("rich");

await check("both generations come out of the aggregation, and neither is written out here", () => {
  const calls = richThrough.calls;
  if (calls.length !== 2) return false;
  const earlier = calls[0];
  const later = calls[1];
  return earlier.entries.length > 0 &&
    earlier.entries.length < later.entries.length &&
    later.options.previous === earlier.made &&
    richThrough.made === later.made;
});

/*
 * THE ANCHOR IS THE CORPUS, NOT THE CLOCK - the other half of that
 * design, and the half the shape arms also cannot see. A cut at a date
 * nobody submitted in still yields two different generations and a
 * movement to draw, so reading the clock here would leave every arm
 * above green while "one publish ago" quietly became "some number of
 * days before the page was opened", and the figure on screen moved
 * because a viewer opened the demo on a different day.
 *
 * The corpus answers where the cut belongs. Its submissions arrive in
 * rounds weeks apart, so the round below the newest is what one publish
 * ago MEANS here, and the date the earlier document carries has to land
 * on it. Nothing below names three weeks: the round is read back off the
 * corpus, so the day the spacing changes this goes on saying the same
 * thing rather than needing to be re-tuned.
 *
 * READ OFF THE ENTRIES THE BUILDER WAS HANDED, never off a second
 * corpusInputs() call. Every call stamps the same people afresh from the
 * clock, so a corpus fetched here to compare against is a corpus
 * milliseconds younger than the one the document was cut from - and the
 * comparison fails or passes depending on how long the two lines took,
 * which is a flake rather than an arm. It failed exactly that way once,
 * before this read the recorded entries.
 */
const HOUR = 3600 * 1000;

await check("the date the earlier document carries is a round this corpus has, not a clock reading", () => {
  const earlier = richThrough.calls[0];
  const times = richThrough.calls[1].entries
    .map((entry) => Date.parse(entry.receivedAt));
  const newest = Math.max(...times);
  /*
   * An hour tells the rounds apart with room to spare in both
   * directions: a round is stamped within milliseconds of itself, and
   * the rounds are weeks apart.
   */
  const roundBelow = Math.max(...times.filter((at) => newest - at > HOUR));
  const since = Date.parse(richThrough.made.movement.since);
  return times.length > 0 && Number.isFinite(earlier.now) &&
    earlier.now === since &&
    since >= roundBelow && since - roundBelow < HOUR && since < newest &&
    earlier.entries.length === times.filter((at) => at <= since).length;
});

/* ------------------------------------------------------------------ */
/* #259 F4. The stop that names that line lands where it is drawn.     */

/*
 * THE MEMBERSHIP STOP'S DEFECT, one page over: a sentence naming three
 * things on a screen that carries one.
 *
 * charts.html opens on its Count and Units controls and draws the
 * picture below them, so the stop that exists to show the change-since
 * line opened with the whole picture past the fold - measured on the
 * baked build, the hero starts ~574 px down and a 1280x800 window gives
 * the demo frame 544 px. The weight-over-time chart is ~400 px below the
 * hero again, at every size measured. This stop is behind glass like the
 * membership one, so none of it could be scrolled to.
 *
 * Two things make the sentence true of the screen, and both are held
 * below. The stop moves to the container the member surface draws into,
 * which puts the hero - the combined weight, and the change since last
 * time under it - at the top of the frame. And the sentence stops at the
 * hero: no window this project supports fits the hero and a chart four
 * hundred pixels beneath it in one frame, so naming the lines is naming
 * something the viewer cannot reach. The free stop at the end of the
 * walk is where the rest of the page is gone and looked at.
 *
 * The container and the drawing order are read out of apps/web rather
 * than asserted here, per AGENTS.md's corollary: a check computed
 * entirely from the tour cannot notice the page reordered itself.
 */
const CHARTS_PAGE = "charts.html";
const chartsContainer = (webSource["public.js"]
  .match(/renderProgress\(\s*\$\("([^"]+)"\)/) || [])[1];

const dashboardSrc = webSource["dashboard.js"];
const progressBody = dashboardSrc.slice(
  dashboardSrc.indexOf("function renderProgress("),
  dashboardSrc.indexOf("function drawPanels("));

const movementStops = Demo.TOURS.flatMap((walk) => walk.stops)
  .filter((stop) => PROMISES_MOVEMENT.test(stop.title + " " + stop.narration));

await check("the stop that promises that line lands where the member page draws it", () =>
  typeof chartsContainer === "string" && chartsContainer.length > 0 &&
  shipped[CHARTS_PAGE].includes('id="' + chartsContainer + '"') &&
  movementStops.length > 0 &&
  movementStops.every((stop) => stop.open === CHARTS_PAGE &&
    stop.scroll === chartsContainer) &&
  progressBody.includes("container.appendChild(hero)") &&
  progressBody.indexOf("container.appendChild(hero)") <
    progressBody.indexOf("drawPanels(container"));

const BELOW_THE_HERO = /\blines?\b|\bseries\b|\bover time\b/i;

await check("and its sentence stops at the hero, which is what lands with it", () =>
  movementStops.length > 0 &&
  dashboardSrc.indexOf('figure("Weight over time"') >
    dashboardSrc.indexOf("function drawPanels(") &&
  movementStops.every((stop) => !BELOW_THE_HERO.test(stop.narration)));

/* ------------------------------------------------------------------ */
/* The server serves the mirror, and only out of apps/web.             */

const server = await start({ port: 0 });
const port = server.address().port;

/*
 * node:http with the agent off, rather than the global fetch.
 *
 * fetch keeps its connections in a pool that outlives the request, and
 * this is the one suite here that both opens a listening socket and
 * closes it: reaching the end of the run with those sockets still being
 * torn down prints a libuv assertion to stderr after the result table,
 * so a passing run reports in the shape of a crash. `agent: false` means
 * there is nothing left holding the loop open when the report exits.
 */
const get = (path) => new Promise((resolve, reject) => {
  const request = httpGet({
    host: "127.0.0.1", port, path, agent: false,
  }, (response) => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { text += chunk; });
    response.on("end", () => resolve({ status: response.statusCode, text }));
  });
  request.on("error", reject);
});

await check("the mirror serves a page the demo has booted", async () => {
  const answer = await get(MIRROR_PREFIX + "index.html");
  return answer.status === 200 && answer.text.includes(BOOT_SRC);
});

/*
 * The same file under its own path is untouched. Without this the mirror
 * could be rewriting apps/web for every reader of the served tree, and
 * the demo's one claim - that it changes nothing shipped - would be
 * false in the very server that makes the claim.
 */
await check("the same page under /apps/web/ is served unchanged", async () => {
  const answer = await get("/apps/web/index.html");
  return answer.status === 200 && answer.text === shipped["index.html"];
});

await check("the mirror tracks the file on disk rather than a copy", async () => {
  const answer = await get(MIRROR_PREFIX + "charts.html");
  return Demo.unmirror(answer.text) === shipped["charts.html"];
});

/*
 * F6, first half. The traversal guard is asserted to RUN.
 *
 * It was dead code: normalize() clamps at the root before the ".."
 * check ever saw a segment, so this request was refused by the file not
 * existing, not by the guard - and the comments credited the guard.
 * Accepting 400-or-404 is what let that sit there, so the status is
 * pinned to the guard's own refusal.
 */
await check("a traversal is refused by the guard, not by a missing file", async () => {
  const answer = await get("/../../etc/hosts");
  return answer.status === 400;
}, "want 400 from the guard");

/*
 * F6, second half. Containment at the repository root was never the
 * promise the mirror makes - /demo/ says "this is apps/web" - and an
 * encoded traversal walked out of apps/web into the repository, which is
 * a checkout holding throwaway keys. The first of these served AGENTS.md;
 * the second served the demo console itself, mirrored, which means the
 * boot scripts were injected into the page doing the injecting.
 */
await check("an encoded traversal cannot leave apps/web through the mirror",
  async () => {
    const answer = await get(MIRROR_PREFIX + "..%2f..%2fAGENTS.md");
    return answer.status === 400 && !answer.text.includes("Repository");
  });

/*
 * Percent-encoded rather than a literal "..", because node:http's client
 * resolves a literal one in the request line before it is sent - so the
 * literal form never reached this server's guard at all, and a check
 * written that way passes without exercising anything. The encoded form
 * is the one that came back 200 with dev/demo.html mirrored: the demo's
 * own boot scripts injected into the console doing the injecting.
 */
await check("the mirror cannot reach dev/ and inject into the console itself",
  async () => {
    const answer = await get(MIRROR_PREFIX + "..%2f..%2fdev%2fdemo.html");
    return answer.status === 400 && !answer.text.includes(BOOT_SRC);
  });

await check("a missing file is a 404 rather than a blank page", async () => {
  const answer = await get(MIRROR_PREFIX + "nothing.html");
  return answer.status === 404;
});

// Waited on rather than fired and forgotten, so the report below runs
// against a socket that is already gone.
await new Promise((done) => server.close(done));

report();
