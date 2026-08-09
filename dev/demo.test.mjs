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
 * observed to stay green while the demo told one of those two lies.
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

const { check, mustReject, report } = suite("demo", 96);

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
await check("the mirror declares exactly three edits, and they are these three", () =>
  Demo.MIRROR_EDITS.length === 3 &&
  Demo.MIRROR_EDITS.map((edit) => edit.id).sort().join(",") ===
    "boot,config,telegram" &&
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
  callsHas("GET", "/me") && callsHas("POST", "/submit") &&
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
/* The scenarios and the boxes are a contract two documents cite.      */

await check("every scenario has an id, steps and a real starting page", () =>
  Demo.SCENARIOS.every((one) =>
    typeof one.id === "string" && one.id.length > 0 &&
    Array.isArray(one.steps) && one.steps.length > 0 &&
    Demo.DESTINATIONS.some((d) => d.file === one.start)));

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
 * A step must not send the driver to a control its own starting page
 * does not carry.
 *
 * #140's residue was exactly this and nothing here could see it: the
 * signed-out walk said to switch every palette chip in the rail, and
 * the next line of the same walk said there is no rail on Sign in.
 * index.html carries no `data-set-theme` element at all, so the step
 * was not merely misplaced - it could not be performed. The only check
 * over `steps` asserted the array was not empty, which is how the text
 * survived a nine-finding adversarial pass.
 *
 * ASSERTED IN ONE DIRECTION ON PURPOSE: a walk that names the chips
 * must start on a page that has them. Not the converse - #150 is adding
 * the control to the sign-in page, and a check demanding that every
 * page with chips be walked for them would turn this suite red on a
 * neighboring slice's merge for no defect.
 *
 * The page is read rather than remembered, so this follows the markup
 * wherever it goes.
 */
const CHIP_MARKUP = "data-set-theme";

await check("a walk naming the palette chips starts on a page that has them", () =>
  Demo.SCENARIOS.every((one) => {
    const namesChips = (one.steps || []).some((step) =>
      /palette chip|theme chip/i.test(step));
    if (!namesChips) return true;
    return String(shipped[one.start] || "").includes(CHIP_MARKUP);
  }));

/*
 * The pair, so the check above cannot pass by matching nothing. Some
 * scenario has to be walking the chips somewhere, or the demo has
 * quietly stopped showing the palette at all.
 */
await check("some scenario does walk the chips, on a page that carries them", () =>
  Demo.SCENARIOS.some((one) =>
    (one.steps || []).some((step) => /palette chip/i.test(step)) &&
    String(shipped[one.start] || "").includes(CHIP_MARKUP)));

/*
 * F9. The stub's comment calls the scenario ids a contract with UAT.md,
 * and until now nothing read UAT.md. A contract enforced by nobody is a
 * comment; this is what makes it a contract. The ids are pulled out of
 * the section headings, which is where UAT.md names the scenario each
 * section is walked in.
 */
const uat = await readFile(HERE("../UAT.md"), "utf8");
const uatIds = new Set();
uat.split("\n").forEach((line) => {
  if (!/^###\s/.test(line)) return;
  const tail = /scenarios?\s+(.*)$/.exec(line);
  if (!tail) return;
  (tail[1].match(/`([a-z][a-z-]*)`/g) || []).forEach((raw) => {
    uatIds.add(raw.slice(1, -1));
  });
});

await check("UAT.md's scenario headings are readable at all", () =>
  uatIds.size > 0 && uatIds.has("signed-out"));

await check("UAT.md and the stub name exactly the same scenarios", () => {
  const mine = new Set(Demo.SCENARIOS.map((one) => one.id));
  return uatIds.size === mine.size &&
    [...mine].every((id) => uatIds.has(id)) &&
    [...uatIds].every((id) => mine.has(id));
});

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
 * 375 is a phone width only because apps/web says so. What UAT A1.10
 * asks the owner to see - the rail as a strip, its four destinations
 * still in flow - is one media block in the shipped stylesheet, and the
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
 * The chips are not one of those rules any more. #150 made the Theme
 * disclosure one control at every width, so it sits outside every media
 * query - and a marker that no width block contains would make this arm
 * match nothing and fail for a reason that has nothing to do with the
 * frame. What is left is the rail itself: the links becoming a row and
 * the session becoming the end of it.
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
 * Same-origin is an ALLOWLIST, not a pass. The fall-through used to
 * hand any same-origin URL to the real fetch, which on a static host is
 * a read of whatever else got baked - and the emitted set is the one
 * thing a static host will serve without asking.
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
  const answer = await get(MIRROR_PREFIX + "dashboard.html");
  return Demo.unmirror(answer.text) === shipped["dashboard.html"];
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
