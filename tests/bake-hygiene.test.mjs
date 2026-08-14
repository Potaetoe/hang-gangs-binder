/*
 * The bake's output-directory hygiene and its root 404 - dev/demo-bake.mjs.
 *
 *     node tests/bake-hygiene.test.mjs
 *
 * Subject: what `./run bake` (dev/demo-bake.mjs) does to the DIRECTORY
 * it writes into, and the root-level 404.html it now writes beside the
 * fold page.
 *
 * WHY THIS LIVES IN tests/ AND CARRIES ITS OWN RUNNER, IMPORTING
 * NOTHING FROM dev/ OR tools/. The 0.9 wave treats dev/'s test
 * apparatus (dev/harness.mjs) as retiring with the surfaces it
 * describes, and a new suite does not plug into it (0.9-M0-S4, #281).
 * That leaves one way to exercise dev/demo-bake.mjs's actual,
 * committed behavior without an `import` naming dev/ at all: run it
 * the way a human does, as `node dev/demo-bake.mjs --out <dir>`, and
 * read the directory and the process's own exit code and stderr
 * afterward. That is also the more honest test for a file-writing
 * program - the bytes on disk after the process exits are what a host
 * actually serves, not what an in-process call happened to return.
 * (A data:-URL load of dev/demo-bake.mjs, the trick tests/site-spec.
 * test.mjs and tests/site-parity.test.mjs use for apps/ subjects, does
 * not work here: this file resolves its own ROOT from import.meta.url
 * at load time, and `new URL("..", "data:...")` throws - opaque
 * schemes have no relative resolution. A subprocess sidesteps that
 * rather than fighting it.)
 *
 * WHAT WOULD BE WRONG WITHOUT IT. Two hazards, the 2026-08-13 field
 * note and the ticket that follows it:
 *
 * A BAKE THAT DOES NOT CLEAR ITS OUTPUT DEPLOYS WHAT THE LAST ONE LEFT.
 * Six stale files reached a published build that way. The fix has two
 * directions and both are checked: a directory this bake recognizes as
 * its own previous output (the hgb-baked-at stamp its own root
 * index.html carries) is cleared before the new files land, so nothing
 * this run no longer emits can survive; a directory it does NOT
 * recognize - somebody else's files, or nothing that names this tool
 * at all - is refused outright, naming the path and the remedy, before
 * a single byte is written or removed.
 *
 * AN UNKNOWN PATH ON A BAKED HOST SERVED THE FOLD PAGE WITH 200. Static
 * hosts (Cloudflare Pages among them) fall back to index.html for any
 * path nothing else names, unless a root-level 404.html says otherwise.
 * That is checked here too: the 404 exists, carries the fold page's own
 * honesty posture (its CSP, its noindex, its stamp - not a new one) and
 * nothing more than a title, one line, and a link back in.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const ROOT = HERE("..");
const BAKE = join(ROOT, "dev", "demo-bake.mjs");

const EXPECTED = 24;
let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

const exists = async (path) => {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    return false;
  }
};

// Runs the real CLI entry point as a subprocess - process.execPath
// rather than the bare string "node", so this runs the same binary
// that is running the suite regardless of what a shell's PATH resolves
// "node" to.
async function runBake(out) {
  try {
    const { stdout, stderr } = await run(process.execPath, [BAKE, "--out", out],
      { cwd: ROOT });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
    };
  }
}

/* ------------------------------------------------------------------ */
/* 0. The precondition this whole suite runs under.                    */

// A dirty tree makes the CLI refuse for a reason that has nothing to
// do with output-directory hygiene (dev/demo-bake.mjs's own
// refuseDirty), and every scenario below would fail with the same
// unhelpful cause. Checked and named first so a red run here is never
// mistaken for a hygiene regression.
const { stdout: porcelain } = await run("git", ["status", "--porcelain"], { cwd: ROOT });
check("the tree is clean, so a refusal below is about hygiene and not this",
  porcelain.trim().length === 0);

/* ------------------------------------------------------------------ */
/* 1. A directory this bake recognizes as its own previous output      */
/*    (the stamp its own index.html carries) is cleared, not carried.  */

const staleOut = await mkdtemp(join(tmpdir(), "hgb-bake-hygiene-stale-"));
await writeFile(join(staleOut, "index.html"),
  '<meta name="hgb-baked-at" content="0000000000000000000000000000000000000 old">',
  "utf8");
await mkdir(join(staleOut, "demo"), { recursive: true });
await writeFile(join(staleOut, "demo", "retired-page.html"), "a page nobody ships anymore", "utf8");
await writeFile(join(staleOut, "stale-top-level.txt"), "left by a previous run", "utf8");

const staleResult = await runBake(staleOut);
check("a bake into its own recognized previous output succeeds",
  staleResult.code === 0);
check("a page the current manifest no longer emits does not survive the bake",
  !(await exists(join(staleOut, "demo", "retired-page.html"))));
check("a stray top-level file from the previous bake does not survive either",
  !(await exists(join(staleOut, "stale-top-level.txt"))));
check("the fresh bake's own pages land where the manifest says",
  (await exists(join(staleOut, "index.html"))) &&
  (await exists(join(staleOut, "demo", "index.html"))));

await rm(staleOut, { recursive: true, force: true });

/* ------------------------------------------------------------------ */
/* 2. A directory this bake does NOT recognize is refused outright,    */
/*    before anything is written or removed - both the case with no    */
/*    index.html at all and the case with an unrelated one.            */

const foreignOut = await mkdtemp(join(tmpdir(), "hgb-bake-hygiene-foreign-"));
await writeFile(join(foreignOut, "notes.txt"), "somebody else's working directory", "utf8");

const foreignResult = await runBake(foreignOut);
check("a bake into a directory holding an unrecognized file refuses",
  foreignResult.code !== 0);
check("the refusal names the directory it refused",
  foreignResult.stderr.includes(foreignOut));
check("the refusal states a remedy rather than just failing",
  /empty directory|clear .* yourself|previous bake/i.test(foreignResult.stderr));
check("the file that was never this bake's to touch survives untouched",
  (await readFile(join(foreignOut, "notes.txt"), "utf8")) ===
    "somebody else's working directory");
check("nothing from this bake was written into the refused directory",
  !(await exists(join(foreignOut, "index.html"))));

await rm(foreignOut, { recursive: true, force: true });

// The same refusal for a directory that DOES hold an index.html, but
// one that carries no hgb-baked-at stamp - proving recognition is
// about the stamp, not merely about the filename matching.
const unstampedOut = await mkdtemp(join(tmpdir(), "hgb-bake-hygiene-unstamped-"));
await writeFile(join(unstampedOut, "index.html"), "<h1>Somebody else's site</h1>", "utf8");

const unstampedResult = await runBake(unstampedOut);
check("an index.html with no hgb-baked-at stamp does not count as recognition",
  unstampedResult.code !== 0);
check("that refusal also names the directory",
  unstampedResult.stderr.includes(unstampedOut));
check("the unrelated index.html survives the refusal untouched",
  (await readFile(join(unstampedOut, "index.html"), "utf8")) ===
    "<h1>Somebody else's site</h1>");

await rm(unstampedOut, { recursive: true, force: true });

/* ------------------------------------------------------------------ */
/* 3. An empty or absent directory is neither "recognized" nor         */
/*    "foreign" - a bake proceeds into it outright, no clearing owed.  */

const emptyOut = await mkdtemp(join(tmpdir(), "hgb-bake-hygiene-empty-"));
const emptyResult = await runBake(emptyOut);
check("a bake into an empty directory proceeds without complaint",
  emptyResult.code === 0);

const absentOut = join(await mkdtemp(join(tmpdir(), "hgb-bake-hygiene-parent-")), "not-yet-created");
const absentResult = await runBake(absentOut);
check("a bake into a directory that does not exist yet creates it and proceeds",
  absentResult.code === 0 && (await exists(join(absentOut, "index.html"))));

/* ------------------------------------------------------------------ */
/* 4. The root 404.html: present in a fresh bake, carrying the fold    */
/*    page's own meta/CSP/noindex posture and nothing more.            */

const read404 = await readFile(join(emptyOut, "404.html"), "utf8");
const readIndex = await readFile(join(emptyOut, "index.html"), "utf8");

check("the fresh bake emits a root-level 404.html beside the fold page",
  await exists(join(emptyOut, "404.html")));
check("the 404 states its title in a heading",
  /<h1[^>]*>\s*Not found\s*<\/h1>/i.test(read404));
check("the 404 says, in one line, that the address does not exist here",
  read404.includes("This address does not exist here."));
check("the 404 links back to the same demo entry the fold page links to",
  (() => {
    const foldHref = readIndex.match(/<a href="([^"]+)">Open the demo<\/a>/);
    const notFoundHref = read404.match(/<a href="([^"]+)">Open the demo<\/a>/);
    return foldHref && notFoundHref && foldHref[1] === notFoundHref[1];
  })());
check("the 404 carries the exact same Content-Security-Policy as the fold page",
  (() => {
    const cspOf = (html) => (html.match(/Content-Security-Policy" content="([^"]*)"/) || [])[1];
    const cspIndex = cspOf(readIndex);
    const csp404 = cspOf(read404);
    return cspIndex && csp404 && cspIndex === csp404;
  })());
check("the 404 carries noindex, nofollow, like the fold page",
  read404.includes('name="robots" content="noindex, nofollow"') &&
  readIndex.includes('name="robots" content="noindex, nofollow"'));
check("the 404 carries the no-referrer posture the fold page carries",
  read404.includes('name="referrer" content="no-referrer"') &&
  readIndex.includes('name="referrer" content="no-referrer"'));
check("the 404 carries the same hgb-baked-at stamp the fold page carries",
  (() => {
    const stampOf = (html) => (html.match(/<meta name="hgb-baked-at" content="[^"]*">/) || [])[0];
    const stampIndex = stampOf(readIndex);
    const stamp404 = stampOf(read404);
    return stampIndex && stamp404 && stampIndex === stamp404;
  })());
check("the 404 introduces no new voice - no warning paragraph, no explanation",
  !read404.toLowerCase().includes("fabricat") &&
  !read404.toLowerCase().includes("nothing you do here is recorded"));

await rm(emptyOut, { recursive: true, force: true });

console.log(failures
  ? `\nbake-hygiene FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nbake-hygiene ran ${performed} checks, expected ${EXPECTED}`
    : `\nbake-hygiene OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
