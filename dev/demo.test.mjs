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
 *   - every Worker path the shipped code calls has an answer in the stub,
 *     read out of apps/web rather than listed here, so a route PR 4 or
 *     PR 5 adds fails this suite instead of failing the owner's
 *     walk-through;
 *   - apps/web names nothing in dev/, so the demo has not paid for
 *     itself with a hook in the published bytes.
 *
 * The staged corpora are checked against the shipped aggregation for the
 * same reason: "enough people to draw the marquee" is a fact about
 * MIN_CELL, and MIN_CELL lives in dashboard.js.
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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

const { start, MIRROR_PREFIX } = await import("./demo-server.mjs");

let failures = 0;
const results = [];

async function check(label, fn) {
  let ok = false;
  let note = "";
  try {
    ok = (await fn()) === true;
    if (!ok) note = "returned false";
  } catch (error) {
    note = "threw: " + (error && error.message ? error.message : error);
  }
  if (!ok) failures++;
  results.push([ok, label, note]);
}

const PAGES = ["index.html", "submit.html", "dashboard.html", "admin.html"];
const shipped = {};
for (const page of PAGES) {
  shipped[page] = await readFile(HERE("../apps/web/" + page), "utf8");
}

/* ------------------------------------------------------------------ */
/* The mirror changes what it says it changes, and nothing else.       */

await check("every shipped page gets the boot scripts", () =>
  PAGES.every((page) =>
    Demo.mirror(shipped[page]).html.includes(Demo.BOOT_SCRIPTS)));

/*
 * The boot scripts must land AFTER the policy, or the demo stops being
 * evidence that the shipped policy permits what the pages do - a script
 * above the meta tag is not governed by it.
 */
await check("the boot scripts land after the page's own CSP", () =>
  PAGES.every((page) => {
    const out = Demo.mirror(shipped[page]).html;
    const csp = out.indexOf("Content-Security-Policy");
    return csp !== -1 && out.indexOf(Demo.BOOT_SCRIPTS) > csp;
  }));

await check("the boot scripts land before the page's own first script", () =>
  PAGES.every((page) => {
    const out = Demo.mirror(shipped[page]).html;
    const boot = out.indexOf(Demo.BOOT_SCRIPTS);
    const own = out.indexOf("<script", boot + Demo.BOOT_SCRIPTS.length);
    return boot !== -1 && own !== -1;
  }));

await check("only the sign-in page carries the Telegram edit", () =>
  Demo.mirror(shipped["index.html"]).applied.includes("telegram") &&
  PAGES.slice(1).every((page) =>
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

/* ------------------------------------------------------------------ */
/* apps/web pays nothing for the demo.                                 */

const webFiles = await readdir(HERE("../apps/web"));
const webSource = {};
for (const name of webFiles) {
  if (!/\.(js|html|css)$/.test(name)) continue;
  webSource[name] = await readFile(HERE("../apps/web/" + name), "utf8");
}

await check("nothing in apps/web names the demo", () =>
  Object.values(webSource).every((src) =>
    !src.includes("demo-boot") && !src.includes("demo-stub") &&
    !src.includes("BinderDemo") && !src.includes("/dev/")));

/* ------------------------------------------------------------------ */
/* The stub answers every route the shipped code calls.                */

const calledPaths = [];
for (const [name, src] of Object.entries(webSource)) {
  if (!name.endsWith(".js")) continue;
  Demo.endpointPathsIn(src).forEach((path) => {
    if (!calledPaths.includes(path)) calledPaths.push(path);
  });
}

/*
 * A reader that finds nothing is indistinguishable from a codebase that
 * calls nothing, and it would make the check below pass vacuously
 * forever. So the extractor is asserted to work before its output is
 * trusted - the same shape as check_web.py's parser having a suite.
 */
await check("the endpoint reader finds the routes that are plainly there", () =>
  calledPaths.includes("/me") && calledPaths.includes("/submit") &&
  calledPaths.includes("/snapshot") && calledPaths.includes("/export") &&
  calledPaths.includes("/session") && calledPaths.includes("/auth/telegram") &&
  calledPaths.includes("/auth/dev"));

await check("the stub answers every route apps/web calls", () =>
  calledPaths.every((path) => Demo.routeFor(path) !== null));

await check("a route the stub does not know is refused, not passed on", () =>
  Demo.routeFor("/something-new") === null &&
  Demo.answerFor({ method: "GET", path: "/something-new" }, {}).status === 404);

/* ------------------------------------------------------------------ */
/* The answers themselves.                                             */

const world = (id, extra) => Object.assign({ scenario: id, data: {} }, extra);

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
  ["/me", "/snapshot", "/export", "/submit"].every((path) =>
    Demo.answerFor({ method: "GET", path }, world("revoked")).status === 401));

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
 * The probes are how the console reports what has landed. This pins the
 * mechanism - every box has one, and every one names a file that is
 * really there - and deliberately not the answers. A check that failed
 * the day PR 5 landed would be a gate asking the project to stand still.
 */
await check("every box has a probe naming a file that exists", async () => {
  for (const box of Demo.BOXES) {
    if (!box.probe || !box.probe.file || !box.probe.pattern) return false;
    await readFile(HERE("../" + box.probe.file), "utf8");
  }
  return true;
});

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
/* The server serves the mirror, and only inside this repository.      */

const server = await start({ port: 0 });
const base = "http://127.0.0.1:" + server.address().port;
const get = async (path) => {
  const response = await fetch(base + path);
  return { status: response.status, text: await response.text() };
};

await check("the mirror serves a page the demo has booted", async () => {
  const answer = await get(MIRROR_PREFIX + "index.html");
  return answer.status === 200 && answer.text.includes(Demo.BOOT_SCRIPTS);
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

await check("a path walking out of the repository is refused", async () => {
  const answer = await get("/../../etc/hosts");
  return answer.status === 400 || answer.status === 404;
});

await check("a missing file is a 404 rather than a blank page", async () => {
  const answer = await get(MIRROR_PREFIX + "nothing.html");
  return answer.status === 404;
});

/*
 * Waited on rather than fired and forgotten. fetch() leaves its
 * connections alive, and reaching process.exit() while libuv is still
 * tearing them down prints an assertion failure to stderr after the
 * result table - a run that passed, reported in the shape of a crash.
 */
await new Promise((done) => {
  server.closeAllConnections();
  server.close(done);
});

/* ------------------------------------------------------------------ */

for (const [ok, label, note] of results) {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (note ? " - " + note : ""));
}
console.log(
  failures === 0
    ? "\ndemo OK - " + results.length + " checks"
    : "\ndemo FAILED " + failures + " of " + results.length + " checks");

/*
 * exitCode rather than exit(). This is the one suite here that opens a
 * listening socket, and calling process.exit() while libuv is still
 * tearing the last connections down prints an assertion failure to
 * stderr after the result table - a passing run wearing the shape of a
 * crash. Setting the code lets the loop drain and exit on its own.
 */
process.exitCode = failures === 0 ? 0 : 1;
