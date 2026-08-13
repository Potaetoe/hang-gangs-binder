/*
 * Checks for the baked static demo - dev/demo-bake.mjs.
 *
 *     node dev/demo-bake.test.mjs
 *
 * The bake turns the demo into files. That changes what can go wrong
 * with it, because the demo-server's guards are code that runs per
 * request and a static host has none of them: whatever the bake wrote
 * is served, forever, to whoever has the URL.
 *
 * So the hazards here are about the EMITTED SET, and there are three.
 *
 * A PAGE WITHOUT THE MIRROR'S EDITS IS A PAGE THAT CALLS THE REAL
 * ENDPOINT. dev/demo-boot.js is what replaces fetch, and it arrives
 * only through the mirror. Any apps/web page emitted un-mirrored is a
 * live copy of the product on a public host, wired to whatever
 * config.js resolves to - which is the one promise this whole demo
 * exists to keep. Every .html under /demo/ is checked to unmirror back
 * to the shipped bytes, and no apps/web page is allowed anywhere else.
 *
 * A GLOB OVER dev/ PUBLISHES THE TEST TREE. dev/ holds fixtures, the
 * suites, throwaway keypairs and whatever the next slice puts there. A
 * pattern that matches "the demo's files" today matches next month's
 * additions too, and nobody re-reads a pattern. The manifest is an
 * allowlist by filename and this suite drives the refusal.
 *
 * A SNAPSHOT THAT DOES NOT SAY WHEN IT WAS TAKEN IS READ AS CURRENT.
 * The live console reads apps/web off disk per request, so it cannot be
 * stale; a bake is stale the moment the next slice merges. The stamp is
 * what makes that visible, so it is checked to be present, to name the
 * commit, and to refuse a tree with uncommitted changes in it - a
 * stamp naming a commit that is not what was baked is worse than none.
 *
 * WHY THE ASSERTIONS SPELL OUT PATHS RATHER THAN ASKING THE MANIFEST.
 * Same reason dev/demo.test.mjs gives one file over: a check that the
 * emitted set equals `manifestFor(...)` cannot fail when the manifest
 * is what changed. The paths that must exist are written here.
 */
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { suite } from "./harness.mjs";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const ROOT = HERE("..");

const load = async (path) => {
  const src = await readFile(HERE(path), "utf8");
  await import("data:text/javascript," + encodeURIComponent(src));
};

await load("./demo-stub.js");
const Demo = globalThis.BinderDemo;

const {
  IMPORT_SCRIPTS, DEMO_ASSETS, manifestFor, webEntriesOf, refuseDirty,
  stampFor, bake,
} = await import("./demo-bake.mjs");

const { check, mustReject, report } = suite("demo bake", 38);

/* ------------------------------------------------------------------ */
/* The manifest: what is emitted, and from where.                      */

const webEntries = await webEntriesOf(ROOT);
const manifest = manifestFor(webEntries);

const emitted = manifest.map((one) => one.to);
const pages = webEntries.filter((name) => name.endsWith(".html"));

await check("apps/web is enumerated, pages and assets and fonts alike", () =>
  pages.length >= 5 && pages.includes("index.html") &&
  pages.includes("404.html") &&
  webEntries.includes("theme.css") &&
  webEntries.some((name) => name.startsWith("fonts/")));

await check("no two manifest entries write the same path", () =>
  new Set(emitted).size === emitted.length);

/*
 * The rule this suite exists for. An apps/web page reachable at a path
 * the mirror did not produce has no dev/demo-boot.js on it, so its own
 * scripts call fetch for real.
 */
await check("every page apps/web ships is emitted, and only under /demo/", () =>
  pages.every((page) => emitted.includes("demo/" + page)) &&
  emitted.filter((path) => path.endsWith(".html")).every((path) =>
    path.indexOf("demo/") === 0 || path === "index.html"));

/*
 * The one .html above that is not under /demo/ is the bake's own root.
 * It is not derived from apps/web, and that is the property that makes
 * it safe rather than its name - so it is asserted rather than assumed.
 */
await check("the page outside /demo/ is not derived from apps/web", () =>
  manifest.filter((one) =>
    one.to.endsWith(".html") && one.to.indexOf("demo/") !== 0
  ).every((one) =>
    one.from === null || one.from.indexOf("apps/web/") !== 0));

await check("every non-page in apps/web is emitted under /demo/ too", () =>
  webEntries.filter((name) => !name.endsWith(".html")).every((name) =>
    emitted.includes("demo/" + name)));

await check("the fonts land under /demo/ so the wordmark resolves", () =>
  emitted.includes("demo/fonts/playfair-display-600-latin.woff2"));

/*
 * dev/demo-corpus.js builds the published snapshots by importScripts on
 * absolute /apps/web/ paths, so those three files have to exist at that
 * prefix as well as inside the mirror. They are copied raw: a worker
 * has no document and needs no mirror edit.
 */
await check("the three files demo-corpus imports are emitted at /apps/web/", () =>
  IMPORT_SCRIPTS.length === 3 &&
  emitted.includes("apps/web/form.js") &&
  emitted.includes("apps/web/dashboard.js") &&
  emitted.includes("apps/web/admin.js"));

await check("nothing emitted under /apps/web/ is a page", () =>
  emitted.filter((path) => path.indexOf("apps/web/") === 0)
    .every((path) => !path.endsWith(".html")));

/*
 * The demo's own files, spelled out rather than compared to DEMO_ASSETS:
 * an arm that asked the list about itself would pass just as well with a
 * file taken off it, and the one that matters is demo-boot.js - the file
 * that replaces fetch. A build missing it is a live copy of the product
 * on a public URL.
 */
await check("the demo's own scripts and the strip are emitted", () =>
  ["dev/demo-stub.js", "dev/demo-boot.js", "dev/demo-toolbar.js",
    "dev/demo-toolbar.css", "dev/demo-corpus.js", "dev/demo-telegram.js",
    "dev/demo-config.js"].every((path) => emitted.includes(path)));

/*
 * And no page of the console era survives on the list. A file the bake
 * still names and the tree no longer holds fails at the copy rather than
 * at the manifest, which is a refusal nobody can act on.
 */
await check("the emitted set names no file this repository does not hold", () =>
  DEMO_ASSETS.every((name) => !name.endsWith(".html")) &&
  !emitted.includes("dev/demo.html") &&
  !emitted.includes("dev/demo-console.js"));

await check("the throwaway sample and its key are emitted, and nothing else opens", () =>
  emitted.includes("dev/sample-submissions.json") &&
  emitted.includes("dev/test-key.json"));

/*
 * The allowlist, driven rather than read. A glob over dev/ would emit
 * every suite, both stored-format fixtures and anything a later slice
 * drops there; the list is by filename for that reason, and this is the
 * check that says so.
 */
await check("no suite, fixture or document from dev/ rides along", () =>
  ["dev/demo.test.mjs", "dev/demo-bake.test.mjs", "dev/worker.test.mjs",
    "dev/fixture.json", "dev/fixture-v2.json", "dev/harness.mjs",
    "dev/README.md", "AGENTS.md"].every((path) => !emitted.includes(path)));

await mustReject("a source outside apps/web and off the allowlist is refused",
  async () => manifestFor(webEntries, ["dev/fixture.json"]),
  "dev/fixture.json");

await check("the same manifest call with a real source is accepted", () =>
  manifestFor(webEntries, ["apps/web/theme.css"]).length > 0);

/*
 * The crawler copy is apps/web's own robots.txt, moved to the root
 * where a crawler reads it. Not retyped: the rule about this site not
 * being findable has one home and it is that file.
 */
await check("robots.txt is emitted at the root, from the shipped one", () =>
  manifest.some((one) =>
    one.to === "robots.txt" && one.from === "apps/web/robots.txt"));

/* ------------------------------------------------------------------ */
/* The stamp, and the refusal behind it.                               */

await mustReject("a tree with uncommitted changes refuses to bake",
  async () => refuseDirty(" M dev/demo-stub.js\n?? dev/scratch.js\n"),
  "dev/demo-stub.js");

/*
 * The pair. A refusal that refuses every input looks exactly like one
 * that refuses correctly, and this repository has already paid for that
 * once - so the clean case is asserted beside it.
 */
await check("a clean tree is not refused", () =>
  refuseDirty("") === true && refuseDirty("\n") === true);

await check("the stamp names the commit and the time it was taken", () => {
  const out = stampFor("0123456789abcdef0123456789abcdef01234567", "2026-08-09T01:02:03Z");
  return out.includes("0123456789abcdef0123456789abcdef01234567") &&
    out.includes("2026-08-09T01:02:03Z");
});

/* ------------------------------------------------------------------ */
/* A real bake, written to a real directory.                           */

const out = await mkdtemp(join(tmpdir(), "hgb-demo-bake-"));
const written = await bake({
  root: ROOT,
  out: out,
  commit: "0123456789abcdef0123456789abcdef01234567",
  at: "2026-08-09T01:02:03Z",
});

const read = (path) => readFile(join(out, path), "utf8");
const exists = async (path) => {
  try {
    await stat(join(out, path));
    return true;
  } catch (error) {
    return false;
  }
};

await check("the bake writes every path its manifest names", async () => {
  for (const path of emitted) {
    if (!(await exists(path))) return false;
  }
  return true;
});

await check("the bake reports what it wrote, and nothing more", () =>
  Array.isArray(written.written) &&
  written.written.length === emitted.length);

/*
 * The check that stops the bake snapshotting something other than the
 * product. Undoing the mirror's declared edits on the emitted page has
 * to give back the shipped file byte for byte - anything the bake
 * touched on the way through survives the undo and shows up here.
 */
await check("every baked page unmirrors back to the shipped bytes", async () => {
  for (const page of pages) {
    const baked = await read("demo/" + page);
    const shipped = await readFile(join(ROOT, "apps", "web", page), "utf8");
    if (Demo.unmirror(baked) !== shipped) return false;
  }
  return true;
});

await check("a baked page carries the fetch replacement, stub before boot", async () => {
  const html = await read("demo/your-page.html");
  const stub = html.indexOf("/dev/demo-stub.js");
  const boot = html.indexOf("/dev/demo-boot.js");
  return stub !== -1 && boot !== -1 && stub < boot;
});

await check("a baked page points config.js at the demo stand-in", async () => {
  const html = await read("demo/your-page.html");
  return html.includes("/dev/demo-config.js") &&
    !html.includes('<script src="config.js">');
});

await check("the baked sign-in page loads no third-party widget", async () => {
  const html = await read("demo/index.html");
  return !html.includes("telegram.org/js/telegram-widget.js") &&
    html.includes("/dev/demo-telegram.js");
});

/*
 * The edits are named here as literals, and the count with them, for
 * the reason dev/demo.test.mjs spells the same list out: an arm that
 * compared the table to itself would hold just as well for three edits
 * or for five, so an edit added without anybody deciding to add one
 * would pass it. A bake emits pages a static host serves to whoever
 * asks, so what differs from the product in them is exactly the thing
 * that cannot be allowed to grow quietly.
 */
await check("all five declared edits are applied across the baked pages",
  async () => {
    const applied = new Set();
    for (const page of pages) {
      const shipped = await readFile(join(ROOT, "apps", "web", page), "utf8");
      Demo.mirror(shipped).applied.forEach((id) => applied.add(id));
    }
    return applied.size === 5 && applied.has("boot") &&
      applied.has("toolbar") && applied.has("telegram") &&
      applied.has("config") && applied.has("links");
  });

/*
 * And the strip is on the emitted bytes of every page, asked of the
 * files rather than of the transform. A hosted build with no strip is a
 * demo a stranger cannot stage anything in.
 */
await check("every baked page carries the demo's own strip", async () => {
  for (const page of pages) {
    const html = await read("demo/" + page);
    if (!html.includes("/dev/demo-toolbar.js")) return false;
    if (!html.includes("/dev/demo-toolbar.css")) return false;
  }
  return true;
});

/*
 * And the fourth edit where it matters most. A hosted build is the one
 * a stranger clicks around in, so the footer's link out of the product
 * has to open its own tab there too - a frame that navigates itself to
 * a host refusing to be framed leaves a white rectangle and no way back.
 */
await check("a baked page sends a link out of the product to its own tab",
  async () => {
    const html = await read("demo/index.html");
    const anchors = html.match(/<a [^>]*href="https?:\/\/[^"]*"[^>]*>/g) || [];
    return anchors.length > 0 &&
      anchors.every((tag) => tag.includes('target="_blank"'));
  });

await check("the raw copies are byte-equal to what apps/web ships", async () => {
  for (const name of IMPORT_SCRIPTS) {
    const baked = await read("apps/web/" + name);
    const shipped = await readFile(join(ROOT, "apps", "web", name), "utf8");
    if (baked !== shipped) return false;
  }
  return true;
});

/*
 * THE ROOT IS THE ENTRY, AND IT LANDS ON THE SIGN-IN PAGE. A hosted
 * build's root is the URL somebody is handed; a root that does not open
 * where a stranger opens is a demo that looks broken before anything has
 * been driven. Asked of the emitted bytes, because the redirect is the
 * only thing standing between that URL and an empty page.
 */
await check("the root sends a visitor to the mirrored sign-in page", async () => {
  const html = await read("index.html");
  const target = "/demo/" + Demo.FIRST_VISIT;
  return new RegExp('http-equiv="refresh"[^>]*url=' + target).test(html) &&
    html.includes('href="' + target + '"');
});

/*
 * THE DATE SURVIVES, AND RENDERS NOTHING.
 *
 * The stamp is why a bake is more than a copy: a snapshot on a public
 * URL that cannot say which commit it is gets read as current forever,
 * and refuseDirty is built around that one sentence being true. What the
 * owner removed is the SENTENCE (2026-08-10), so what is written is the
 * same fact as metadata - present, checkable, and on nobody's screen.
 * Asked of the emitted bytes with the tags taken out, because
 * "invisible" is a claim about what a reader sees rather than about
 * which element it is in.
 */
await check("the root names the commit without putting it on screen",
  async () => {
    const html = await read("index.html");
    const commit = "0123456789abcdef0123456789abcdef01234567";
    const readable =
      new RegExp("<meta\\b[^>]*" + commit + "[^>]*>").test(html);
    const onScreen = html.replace(/<[^>]*>/g, " ").includes(commit);
    return readable && !onScreen;
  });

/*
 * The root carries no console and no explanation of one. The console
 * era's heading, its four-walks paragraph and its own footer are gone
 * with the surface they described (owner, 2026-08-10, and #272), and
 * this copy is the one that mattered most to that ruling: a hosted URL
 * is where a stranger meets whatever the demo says about itself.
 */
await check("the root carries no console, no footer and no walk-through",
  async () => {
    const html = await read("index.html");
    return !/<footer[\s>]/.test(html) &&
      ["demo console", "Four walks", "free drive", "journey", "scenario"]
        .every((each) => !html.toLowerCase().includes(each.toLowerCase()));
  });

await check("the root says the data is fabricated and refuses crawlers",
  async () => {
    const html = await read("index.html");
    return html.includes("noindex") && /fabricat|made up|not real/i.test(html);
  });

await check("the root names the commit this build was taken at",
  async () => (await read("index.html"))
    .includes("0123456789abcdef0123456789abcdef01234567"));

await check("the root robots.txt refuses every crawler", async () =>
  /Disallow:\s*\/\s*$/m.test(await read("robots.txt")));

/*
 * Nothing in the emitted tree may reach off the origin. The scripts are
 * checked in dev/demo.test.mjs against the stub's own decision; what is
 * checked here is the emitted BYTES, because a static host serves those
 * and no guard runs.
 */
await check("no baked page names a real Worker as a script or a frame",
  async () => {
    for (const page of pages) {
      const html = await read("demo/" + page);
      const tags = (html.match(/<(script|iframe|link|img)[^>]*>/g) || [])
        .join("\n");
      if (/https?:\/\//.test(tags)) return false;
    }
    return true;
  });

await check("the baked demo config names no real Worker origin", async () => {
  const src = await read("dev/demo-config.js");
  return !src.includes("hgbinderworker") && !src.includes("workers.dev");
});

/*
 * Every page apps/web ships already carries noindex, and the bake must
 * not be the thing that drops it - which it would, silently, if the
 * mirror ever gained an edit that rewrote the head.
 */
await check("every baked page keeps the noindex the shipped page carries",
  async () => {
    for (const page of pages) {
      if (!(await read("demo/" + page)).includes("noindex")) return false;
    }
    return true;
  });

await rm(out, { recursive: true, force: true });

await check("the emitted tree held no directory the allowlist does not name",
  async () => {
    const top = new Set(emitted.map((path) => path.split("/")[0]));
    return top.has("demo") && top.has("dev") && top.has("apps") &&
      [...top].every((name) =>
        ["demo", "dev", "apps", "index.html", "robots.txt"].includes(name));
  });

report();
