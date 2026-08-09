/*
 * The drivable demo, written to a directory of static files (#143).
 *
 *     ./run bake            (or: node dev/demo-bake.mjs)
 *     node dev/demo-bake.mjs --out some/other/place
 *
 * Then serve the output directory with anything at all and drive
 * /dev/demo.html, exactly as ./run demo is driven. WHERE IT IS HOSTED
 * IS NOT THIS FILE'S BUSINESS and nothing here deploys: this writes
 * files, and putting them somewhere is a separate act with a separate
 * approval. See dev/README.md, "Hosting the demo off this machine".
 *
 * WHY A BAKE AND NOT THE SERVER. dev/demo-server.mjs mirrors apps/web on
 * every request, which is what keeps the local demo honest - it cannot
 * show last month's pages because it never holds a copy. That property
 * is exactly what a static host cannot have. So this emits the same
 * mirror as files and stamps the commit it read them at, because the
 * alternative to a snapshot that admits its age is not a fresh demo, it
 * is a stale one nobody can tell is stale.
 *
 * WHAT IS DELIBERATELY NOT EMITTED. Everything. The set is an allowlist:
 * apps/web in full, plus the demo's own files named one by one below.
 * Not a pattern over dev/ - dev/ holds both stored-format fixtures, the
 * suites, a throwaway keypair and whatever the next slice puts there,
 * and a pattern that matches "the demo's files" today matches next
 * month's additions too. No pattern is re-read before it publishes
 * something.
 *
 * THE ONE RULE WITH NO EXCEPTIONS: no page from apps/web is written
 * anywhere but /demo/. dev/demo-boot.js is what replaces fetch, it
 * arrives only through the mirror, and a page without it is a live copy
 * of the product on a public URL calling whatever config.js resolves
 * to. manifestFor() cannot express such a path and this file's own
 * verification re-reads the emitted bytes to confirm it.
 *
 * Nothing real is in the output by construction: the corpus is
 * fabricated, the key is the committed throwaway public half, and the
 * only address any page names is one that cannot resolve.
 */
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const ROOT = HERE("..");

const load = async (path) => {
  const src = await readFile(HERE(path), "utf8");
  await import("data:text/javascript," + encodeURIComponent(src));
};

await load("./demo-stub.js");
const Demo = globalThis.BinderDemo;

/*
 * The demo's own files, by name.
 *
 * Written out rather than globbed for the reason in the header, and
 * split into two lists because they answer different questions: the
 * first is "what is the demo", the second is "what fake material may a
 * public copy carry".
 */
const DEMO_FILES = [
  "demo.html",
  "demo.css",
  "demo-stub.js",
  "demo-boot.js",
  "demo-console.js",
  "demo-corpus.js",
  "demo-telegram.js",
  "demo-config.js",
];

/*
 * The only data that ships, and every item is already public in this
 * repository and opens nothing real.
 *
 * sample-submissions.json is the fabricated export corpus, sealed to
 * the throwaway pair below; test-key.json is the keyholder's half of
 * that pair and test-member-key.json a member's, both committed on
 * purpose. They are here so somebody driving the hosted build can load
 * a key in the picker the way the keyholder scenario asks - the file
 * input reads from the visitor's disk, and on a hosted copy there is no
 * checkout to take one from. dev/README.md, "Two kinds of fixture",
 * says what these are and are not.
 */
const DEMO_DATA = [
  "sample-submissions.json",
  "test-key.json",
  "test-member-key.json",
];

export const DEMO_ASSETS = DEMO_FILES.concat(DEMO_DATA);

/*
 * dev/demo-corpus.js builds both published snapshots inside a Web
 * Worker, and reaches the shipped aggregation by importScripts on
 * absolute /apps/web/ paths. A worker has no document, so those files
 * run their pure halves and need no mirror edit - they are copied raw.
 *
 * Named here rather than parsed out of demo-corpus.js: a reader that
 * scanned for importScripts would emit whatever that call names, which
 * is the same delegation of the emitted set that the allowlist exists
 * to refuse.
 */
export const IMPORT_SCRIPTS = ["form.js", "dashboard.js", "admin.js"];

export const OUT_DEFAULT = "_demo";

/*
 * apps/web rather than dist/, matching dev/demo-server.mjs (#181), and
 * chosen rather than inherited.
 *
 * A baked demo is not a release. It is the same instrument the server
 * drives, written to files so it can be hosted off this machine, and the
 * thing it has to stay true to is the tree somebody is working in - so
 * `./run bake` on an unbuilt checkout must not emit last week's build.
 * The published site is dist/ and it has its own gate stage saying so.
 *
 * The demo's absolute /apps/web/ paths below are the other half of this:
 * they name where the corpus worker reads its scripts from, and pointing
 * the bake at a different tree while those stay put is how a manifest
 * comes to describe files nobody emitted.
 */
const WEB = "apps/web/";
const MIRROR = "demo/";

/*
 * Every file under apps/web, fonts included, as paths relative to it.
 *
 * READ, NEVER LISTED. dev/demo.test.mjs learned this the hard way as
 * its F4: a hand-written page list that names four of five leaves the
 * fifth unmirrored, and here that would put an un-booted page on a
 * public host. The directory is the only list that cannot disagree with
 * itself.
 */
export async function webEntriesOf(root) {
  const base = join(root, "apps", "web");
  const out = [];

  const walk = async (relative) => {
    const entries = await readdir(join(base, relative), {
      withFileTypes: true,
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const next = relative ? relative + "/" + entry.name : entry.name;
      if (entry.isDirectory()) await walk(next);
      else out.push(next);
    }
  };

  await walk("");
  return out;
}

/*
 * The landing page, which is the only page here that is not the product
 * and not the console.
 *
 * It exists because the root of a hosted build is the URL somebody is
 * handed, and an empty root is a build that looks broken. It also
 * carries the two sentences a static host has nowhere else to put: that
 * every figure in here was made up, and which commit this copy was
 * taken at. It loads nothing from apps/web - that is what makes it safe
 * to serve outside /demo/, rather than its name.
 */
function landingPage(commit, at) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Muse's Binder — demo build</title>
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<style>
body { font: 16px/1.6 system-ui, sans-serif; margin: 0 auto; max-width: 40rem;
       padding: 3rem 1.5rem; color: #1a1a1a; background: #fbfbfb; }
code { font-family: ui-monospace, monospace; font-size: 0.9em; }
.warn { border-left: 4px solid #b23; padding-left: 1rem; }
@media (prefers-color-scheme: dark) {
  body { color: #eee; background: #141414; }
}
</style>
</head>
<body>
<h1>Hang Gang's Binder — demo build</h1>

<p class="warn">
  <strong>Every figure, handle and entry in here is fabricated.</strong>
  No real person's data is in this build and none can reach it. The
  Worker's answers are stubbed in the page itself, the sample rows are
  sealed to a throwaway key committed in the public repository, and the
  only address any page names is one that cannot resolve. Nothing you do
  here is recorded anywhere.
</p>

<p>
  <a href="/dev/demo.html">Open the demo console</a> — pick a scenario and
  it stages the session and the corpus that scenario needs, then puts a
  real page in the frame.
</p>

<p>
  This is a snapshot, not the live site. It was baked from commit
  <code>${commit}</code> at <code>${at}</code>, and it shows the product
  as of that commit and no later.
</p>

<p>
  Drive it on a desktop browser. The console has a phone-width frame for
  looking at the narrow layout; the console itself is not built for a
  phone.
</p>
</body>
</html>
`;
}

export function stampFor(commit, at) {
  return `<p class="small" id="stamp">
    Baked from commit <code>${commit}</code> at <code>${at}</code>. This
    is a snapshot: it shows the pages as they were at that commit, and
    anything merged since is not in it. The live console reads
    <code>apps/web</code> off disk per request and cannot go stale — this
    copy can, which is why it says which one it is.
  </p>`;
}

/*
 * A tree with uncommitted changes cannot be stamped honestly, so it is
 * not baked at all.
 *
 * The stamp's whole value is that somebody can check out the named
 * commit and get these bytes back. Baked from a dirty tree it names a
 * commit that is not what was baked - which is worse than an unstamped
 * build, because it is confidently wrong rather than merely silent.
 *
 * Returns true rather than nothing, so a caller cannot mistake "did not
 * throw" for "was never called".
 */
export function refuseDirty(porcelain) {
  const lines = String(porcelain).split("\n")
    .map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) return true;
  throw new Error(
    "The tree has uncommitted changes, so the commit a stamp would " +
    "name is not what would be baked: " + lines.join(", ") + ". Commit " +
    "or stash them first."
  );
}

/*
 * Everything the build contains, as {from, to, transform}.
 *
 * `from` is repository-relative and `to` is output-relative. A null
 * `from` is a file this bake authors rather than copies.
 *
 * THE REFUSAL IS HERE, NOT AT THE WRITE. A source that is neither under
 * apps/web nor on the named list throws while the manifest is being
 * built, so nothing is written at all - a bake that emitted eleven
 * files and then refused the twelfth would leave a half-built directory
 * somebody could still upload.
 */
export function manifestFor(webEntries, boxes) {
  const entries = [];
  const add = (from, to, transform) => {
    if (from !== null && from.indexOf(WEB) !== 0 &&
        DEMO_ASSETS.indexOf(from.slice("dev/".length)) === -1) {
      throw new Error(
        "Refusing to bake " + from + ": the only sources this build may " +
        "carry are apps/web and the demo files named in demo-bake.mjs. " +
        "Add it to that list on purpose, or leave it out."
      );
    }
    entries.push({ from: from, to: to, transform: transform });
  };

  // The mirror. Pages go through it; everything else is the byte the
  // page asks for, and both are needed because a page at /demo/ resolves
  // its own `src="theme.js"` to /demo/theme.js.
  for (const relative of webEntries) {
    add(WEB + relative, MIRROR + relative,
      relative.endsWith(".html") ? "mirror" : "copy");
  }

  /*
   * The files something loads by an absolute /apps/web/ path: the three
   * the corpus worker imports, and every probe the console reads that
   * is not a page. Derived from the console's own table, so a box added
   * later brings its file along instead of 404ing in front of the owner.
   *
   * Pages are absent from this list by construction - probeUrlFor sends
   * those through the mirror - and the suite asserts nothing under this
   * prefix ends in .html.
   */
  const raw = new Set(IMPORT_SCRIPTS.map((name) => WEB + name));
  for (const box of boxes) {
    const url = Demo.probeUrlFor(box.probe.file);

    /*
     * A page probe reads back through the mirror, which the loop above
     * already emitted, so there is nothing to add - but it must BE a
     * page apps/web ships, or the console fetches a /demo/ path with
     * nothing behind it.
     */
    if (url.indexOf("/" + MIRROR) === 0) {
      if (box.probe.file.indexOf(WEB) !== 0) {
        throw new Error(
          "Refusing to bake " + box.probe.file + ": a page probe is " +
          "read through the mirror, and the mirror only holds apps/web."
        );
      }
      continue;
    }

    /*
     * Everything else is added at the path the console will ask for,
     * WHATEVER that path is - not filtered down to the ones under
     * apps/web first. Filtering silently dropped a probe pointing
     * anywhere else, so a box reading a file this build does not carry
     * would have baked cleanly and then painted "unreadable" in the
     * acceptance table. Routed through add(), it is a refusal at bake
     * time instead.
     */
    raw.add(url.slice(1));
  }
  for (const from of [...raw].sort()) add(from, from, "copy");

  for (const name of DEMO_ASSETS) {
    add("dev/" + name, "dev/" + name,
      name === "demo.html" ? "stamp" : "copy");
  }

  // The crawler copy is the shipped one, moved to where a crawler reads
  // it. Not retyped: "this site is not to be found in a search result"
  // has one home and it is that file.
  add(WEB + "robots.txt", "robots.txt", "copy");
  add(null, "index.html", "landing");

  return entries;
}

export async function bake(options) {
  const opts = options || {};
  const root = opts.root || ROOT;
  const out = opts.out || join(root, OUT_DEFAULT);
  const commit = String(opts.commit);
  const at = String(opts.at);

  const manifest = manifestFor(await webEntriesOf(root), Demo.BOXES);
  const written = [];

  for (const entry of manifest) {
    const target = join(out, entry.to.split("/").join(sep));
    await mkdir(dirname(target), { recursive: true });

    if (entry.transform === "landing") {
      await writeFile(target, landingPage(commit, at), "utf8");
    } else if (entry.transform === "copy") {
      // Copied as bytes rather than read as text: fonts are here too,
      // and a woff2 through a utf8 round trip is a corrupt font that
      // renders as a fallback nobody notices.
      await cp(join(root, entry.from.split("/").join(sep)), target);
    } else if (entry.transform === "mirror") {
      const source = await readFile(
        join(root, entry.from.split("/").join(sep)), "utf8");
      const mirrored = Demo.mirror(source).html;

      /*
       * Checked here, on the bytes about to be written, and not only in
       * the suite. The suite runs against this repository; a bake runs
       * against whatever tree it is pointed at, and the failure it
       * would produce - a page whose edits did not apply - is a page
       * that calls a real endpoint from a public URL. That is not a
       * thing to learn about from a test run that happened earlier.
       */
      if (Demo.unmirror(mirrored) !== source) {
        throw new Error(
          "Refusing to bake " + entry.from + ": undoing the mirror's " +
          "declared edits did not return the shipped bytes, so the " +
          "mirror changed something it does not declare."
        );
      }
      await writeFile(target, mirrored, "utf8");
    } else {
      const source = await readFile(
        join(root, entry.from.split("/").join(sep)), "utf8");
      const stamped = Demo.stampInto(source, stampFor(commit, at));
      if (stamped === null) {
        throw new Error(
          "Refusing to bake " + entry.from + ": it carries no region " +
          "for the baked-at stamp, and an undated snapshot on a public " +
          "URL reads as current for as long as it is up."
        );
      }
      await writeFile(target, stamped, "utf8");
    }

    written.push(entry.to);
  }

  return { written: written, out: out, commit: commit, at: at };
}

/*
 * Run directly rather than imported by dev/demo-bake.test.mjs, which
 * calls bake() with a stamp of its own into a temporary directory. The
 * git questions live out here on purpose: what the tree's state is, is
 * not something a suite should have an opinion about, and refuseDirty
 * is driven on strings instead.
 */
if (process.argv[1] && process.argv[1].endsWith("demo-bake.mjs")) {
  const argv = process.argv;
  const at = argv.indexOf("--out");
  const out = at === -1 ? join(ROOT, OUT_DEFAULT) : argv[at + 1];
  if (out === undefined) {
    console.error("Refused: --out was given with no path after it.");
    process.exit(2);
  }

  const git = async (args) =>
    (await run("git", args, { cwd: ROOT })).stdout;

  try {
    refuseDirty(await git(["status", "--porcelain"]));
    const commit = (await git(["rev-parse", "HEAD"])).trim();
    const result = await bake({
      root: ROOT,
      out: out,
      commit: commit,
      at: new Date().toISOString(),
    });
    console.log("Baked " + result.written.length + " files into " +
      result.out);
    console.log("From commit " + commit);
    console.log("Serve that directory and open /dev/demo.html.");
    console.log("Nothing was deployed - see dev/README.md.");
  } catch (error) {
    console.error("Refused: " + ((error && error.message) || error));
    process.exit(2);
  }
}
