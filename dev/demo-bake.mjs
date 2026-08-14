/*
 * The drivable demo, written to a directory of static files (#143).
 *
 *     ./run bake            (or: node dev/demo-bake.mjs)
 *     node dev/demo-bake.mjs --out some/other/place
 *
 * Then serve the output directory with anything at all and open its
 * root, exactly as ./run demo is driven. WHERE IT IS HOSTED IS NOT THIS
 * FILE'S BUSINESS and nothing here deploys: this writes
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
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  "demo-stub.js",
  "demo-boot.js",
  "demo-toolbar.js",
  "demo-toolbar.css",
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
 * purpose. They are here so somebody driving the hosted build can open
 * the sealed rows: the toolbar's key control reads the keyholder's half
 * by path, and the page's own file input reads from the visitor's disk,
 * where a hosted copy leaves them nothing to choose. dev/README.md, "Two kinds of fixture",
 * says what these are and are not.
 */
const DEMO_DATA = [
  "sample-submissions.json",
  "test-key.json",
  "test-member-key.json",
];

export const DEMO_ASSETS = DEMO_FILES.concat(DEMO_DATA);

/*
 * dev/demo-corpus.js builds the published snapshot inside a Web
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
 * Where the root sends a visitor, taken from the stub rather than typed
 * here: the local server redirects to the same address, and two copies
 * of it is two places for the entry to move from.
 */
const DEMO_ENTRY = Demo.MIRROR_PATH + Demo.FIRST_VISIT;

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
 * The root, which is the only page here that is not the product.
 *
 * IT LANDS ON THE SIGN-IN PAGE, because the demo IS the site: the URL
 * somebody is handed has to open where a stranger opens, with the
 * demo's own strip riding above it. A redirect rather than the page's
 * own bytes at the root - a mirrored page resolves `theme.css` and
 * `submit.js` against the directory it is served from, so a copy at the
 * root would ask for /theme.css and get nothing, and the product would
 * look broken from a shortcut nobody needed.
 *
 * It carries no script, so the hop is a `meta refresh` and the policy
 * can be `default-src 'none'`. It loads nothing from apps/web at all -
 * that is what makes it safe to serve outside /demo/, rather than its
 * name.
 *
 * AND IT IS WHERE THE SNAPSHOT SAYS HOW OLD IT IS. The live server
 * reads apps/web off disk on every request and cannot be stale; a bake
 * is stale the moment the next slice merges, and a snapshot on a public
 * URL that cannot name its commit is read as current for as long as it
 * is up. refuseDirty below is built around that sentence being true.
 * The commit is metadata rather than copy (owner, 2026-08-10): present,
 * checkable by anybody who looks, and on nobody's screen.
 */
function landingPage(commit, at) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Hang Gang Binder — demo build</title>
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
${stampFor(commit, at)}
<meta http-equiv="refresh" content="0; url=${DEMO_ENTRY}">
<style>
body { font: 16px/1.6 system-ui, sans-serif; margin: 0 auto; max-width: 40rem;
       padding: 3rem 1.5rem; color: #1a1a1a; background: #fbfbfb; }
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

<p><a href="${DEMO_ENTRY}">Open the demo</a></p>
</body>
</html>
`;
}

export function stampFor(commit, at) {
  return `<meta name="hgb-baked-at" content="${commit} ${at}">`;
}

/*
 * The 404 a static host falls back to for a path nothing above named.
 * Cloudflare Pages, and hosts shaped like it, serve index.html with a
 * 200 for ANY unrecognized path unless a root-level 404.html says
 * otherwise - so without this, every made-up address under a baked
 * demo's origin looked like a live one instead of a dead end. Written
 * beside landingPage() and NOT through it: the two pages must never
 * diverge on the honesty posture (the CSP, the noindex, the stamp),
 * but they say different things, so this repeats the head rather than
 * threading a flag through the one that redirects.
 *
 * No warning paragraph, no console framing - just what the fold page's
 * <head> already asserts about this build, plus the one fact this page
 * exists to state.
 */
function notFoundPage(commit, at) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Hang Gang's Binder — demo build: not found</title>
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
${stampFor(commit, at)}
<style>
body { font: 16px/1.6 system-ui, sans-serif; margin: 0 auto; max-width: 40rem;
       padding: 3rem 1.5rem; color: #1a1a1a; background: #fbfbfb; }
@media (prefers-color-scheme: dark) {
  body { color: #eee; background: #141414; }
}
</style>
</head>
<body>
<h1>Not found</h1>
<p>This address does not exist here.</p>
<p><a href="${DEMO_ENTRY}">Open the demo</a></p>
</body>
</html>
`;
}

/*
 * Whether `out` is a directory THIS TOOL wrote before, so a second bake
 * pointed at it may clear it rather than refuse or - the 2026-08-13
 * field note - silently leave last run's files sitting beside this
 * run's. landingPage() stamps every bake's root index.html with
 * hgb-baked-at; that stamp is the one fact that says "I made this
 * directory", so it is what is checked, rather than anything about
 * the directory's name or location.
 */
async function isOwnBakeOutput(out) {
  let html;
  try {
    html = await readFile(join(out, "index.html"), "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
  return html.indexOf('name="hgb-baked-at"') !== -1;
}

/*
 * The refusal a bake owes a directory it did not write, run before a
 * single byte of THIS run goes down. Three cases: empty or absent is
 * fine outright and needs no clearing; recognized as a previous bake's
 * own output (isOwnBakeOutput above) is cleared and rebuilt fresh, so
 * a page this run no longer emits cannot survive into a published
 * build the way six of them did on 2026-08-13; anything else - a
 * directory with somebody else's files in it - is a hard refusal
 * naming the path and the remedy, because clearing it would be
 * throwing away something that was never this tool's to own.
 */
export async function prepareOut(out) {
  let entries;
  try {
    entries = await readdir(out);
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
    entries = [];
  }

  if (entries.length === 0) {
    await mkdir(out, { recursive: true });
    return { cleared: false };
  }

  if (await isOwnBakeOutput(out)) {
    await rm(out, { recursive: true, force: true });
    await mkdir(out, { recursive: true });
    return { cleared: true };
  }

  throw new Error(
    "Refusing to bake into " + out + ": it already holds files and " +
    "none of them is this bake's own stamp (a root index.html with " +
    "hgb-baked-at), so clearing it could destroy something that is " +
    "not this bake's to throw away. Point --out at an empty " +
    "directory, at one a previous bake wrote, or clear " + out +
    " yourself first."
  );
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
export function manifestFor(webEntries, raw) {
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
   * The three files the corpus worker loads by an absolute /apps/web/
   * path. A worker has no document, so those files run their pure
   * halves and need no mirror edit - they are copied raw, at the exact
   * prefix demo-corpus.js asks for. Nothing under this prefix is a
   * page, and the suite asserts it: a page emitted outside /demo/ is a
   * page without dev/demo-boot.js on it.
   *
   * AN ARGUMENT, so the refusal above is a checked branch rather than a
   * described one. Everything else this function emits comes from
   * constants in this file, and a guard whose input nobody can vary is
   * a guard nothing can falsify - dev/demo-bake.test.mjs hands it a path
   * off the allowlist and reads the refusal. The one caller passes
   * nothing and gets the same list either way.
   */
  const extra = new Set(raw === undefined
    ? IMPORT_SCRIPTS.map((name) => WEB + name) : raw);
  for (const from of [...extra].sort()) add(from, from, "copy");

  for (const name of DEMO_ASSETS) add("dev/" + name, "dev/" + name, "copy");

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

  await prepareOut(out);

  const manifest = manifestFor(await webEntriesOf(root));
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
      throw new Error(
        "Refusing to bake " + entry.to + ": the manifest asks for a " +
        "transform called \"" + entry.transform + "\" and this file " +
        "performs three. A transform nobody implements writes nothing " +
        "and reports success."
      );
    }

    written.push(entry.to);
  }

  /*
   * The root 404 (see notFoundPage above), written directly rather
   * than through the manifest. Not a manifest omission by accident:
   * dev/demo-bake.test.mjs pins the manifest's one non-/demo/ page as
   * index.html by name and pins the written count against its own
   * independent manifestFor() call, and this file's constraints hold
   * that suite untouched. 404.html carries no source (from: null,
   * exactly like the root it sits beside) and leaks nothing by being
   * outside that count.
   */
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "404.html"), notFoundPage(commit, at), "utf8");

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
    console.log("Serve that directory and open its root.");
    console.log("Nothing was deployed - see dev/README.md.");
  } catch (error) {
    console.error("Refused: " + ((error && error.message) || error));
    process.exit(2);
  }
}
