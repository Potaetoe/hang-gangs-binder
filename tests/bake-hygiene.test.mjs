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
 * WHY THIS SUITE'S OWN BAKES RUN AGAINST A PRIVATE WORKTREE, NOT THIS
 * CHECKOUT (0.9-M0-S21, #318 - fixes a flake surfaced twice: the S19
 * review's Observation and the S19 landing door). dev/demo-bake.mjs's
 * refuseDirty() looks at THIS ENTIRE CHECKOUT's `git status
 * --porcelain`, by design - a stamped bake claims a commit produced
 * these bytes, and that claim is a lie the moment anything anywhere in
 * the tree is uncommitted, whether or not the bake actually reads that
 * file. Correct for a real `./run bake`. But it means every bake this
 * suite runs is hostage to whatever ELSE is uncommitted in this same
 * checkout at the moment it runs - and the gate's own mutation
 * batteries for OTHER checks routinely leave the tree in exactly that
 * state on purpose (`rm tests/claim-vs-diff.test.mjs && node
 * tests/run.mjs`, reproduced from #311's own landing-door probe, is
 * the exact sequence the S19 review hit this with). Standalone or in a
 * freshly-committed clean gate nothing is uncommitted, so the arm
 * passed every time it was watched directly - which is what made it
 * read as flaky rather than broken. The fix is not a unique temp path
 * (every output directory here already comes from mkdtemp, outside the
 * repository) - it is that the SOURCE this suite bakes FROM was never
 * isolated from the checkout's shared, global, ambient git state. A
 * private worktree checked out fresh at HEAD (`git worktree add
 * <private dir> --detach HEAD`) fixes that at the root: it has its own
 * working tree and its own index, so `git status --porcelain` run
 * inside it answers a question about ONLY that private copy, immune to
 * whatever any other check does to this one. Section 0b below is the
 * regression guard - it proves the immunity by actually dirtying this
 * checkout and watching the isolated bake still succeed, and proves
 * that proof isn't a coincidence by also watching a NON-isolated bake
 * against the same dirty checkout refuse, the way `./run bake` really
 * would.
 *
 * THE COVERAGE TRADE THAT MECHANISM MAKES, AND THE SUBJECT-PIN THAT
 * CLOSES IT (0.9-M0-S21 fix wave 2, #318 F1). `--detach HEAD`
 * materializes HEAD's COMMITTED tree into the private worktree - it does
 * not copy the enclosing checkout's working-tree bytes at all. That is
 * exactly the immunity the paragraph above wants for ambient, UNRELATED
 * dirt (some other check's mutation battery), but it is immunity to ALL
 * working-tree state without distinction, including uncommitted edits to
 * dev/demo-bake.mjs itself: this suite would keep baking HEAD's clean
 * copy of the bake script and reporting green while the enclosing
 * checkout's actual, uncommitted copy carried the exact regression this
 * arm exists to catch (demonstrated: delete the destructive-clear line
 * from the uncommitted script and the suite still runs 36/36). The
 * design's promise was never "immune to all dirt" - it was "immune to
 * dirt this arm's own subject did not cause." The subject-pin below (run
 * before the private worktree is even created) restores that distinction
 * without reopening the flake: it checks `git status --porcelain` in
 * THIS checkout against exactly the files the bake reads to produce its
 * output (the script, the demo assets it names one by one, and the
 * apps/web tree) and refuses early if any differ from HEAD. The flake's
 * own triggers - `rm tests/claim-vs-diff.test.mjs`, other arms' mutation
 * batteries - touch none of those paths, so the pin stays quiet exactly
 * when the worktree mechanism needs it to.
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
 *
 * TWO MORE, ADDED IN THE 2026-08-13 FIX ROUND (review F1/F2):
 *
 * THE COUNT THE CLI PRINTS HAS TO MATCH WHAT IS ACTUALLY ON DISK, IN
 * BOTH DIRECTIONS. 404.html used to be written outside the manifest,
 * so every bake reported one file fewer than it wrote - a check
 * computed only from the manifest's own in-memory arrays could not see
 * a file rearranged outside both of them. Checked here by walking the
 * REAL output directory (not the manifest - this suite still imports
 * nothing from dev/) and comparing its file count against the "Baked N
 * files" the CLI prints, both ways: nothing on disk the count is silent
 * about, and nothing the count claims that is not on disk.
 *
 * THE DESTRUCTIVE CLEAR MUST NEVER RUN BEFORE A REFUSAL THAT WOULD HAVE
 * STOPPED THE BAKE. prepareOut() used to run before the manifest was
 * even built, so a manifest-time refusal fired after a previous good
 * build had already been deleted - a failed bake destroying the last
 * one that worked. There is no input the unmodified CLI accepts that
 * reaches that refusal (the allowlist guard only fires on an argument
 * no caller passes), so this is reproduced the way the review did it:
 * a targeted, restored-in-full mutation of dev/demo-bake.mjs, made
 * invisible to `git status` with `git update-index --assume-unchanged`
 * for exactly the window it is needed, the same trick this file's own
 * refuseDirty precondition below exists to not be fooled by. This
 * mutation runs against the PRIVATE worktree's own copy of the file and
 * its OWN index (not this checkout's), for the same isolation reason as
 * everything else in this file - see the paragraph above.
 */
import { execFile } from "node:child_process";
import {
  mkdir, mkdtemp, readdir, readFile, rm, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const ROOT = HERE("..");
const PRIMARY_BAKE = join(ROOT, "dev", "demo-bake.mjs");

const EXPECTED = 36;
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

// Every FILE (not directory) under `dir`, as paths relative to it - the
// ground truth for "what is actually on disk", read from the directory
// itself rather than from the manifest, which this suite imports nothing
// of.
async function walkFiles(dir, relative) {
  const rel = relative || "";
  const entries = await readdir(join(dir, rel), { withFileTypes: true });
  let out = [];
  for (const entry of entries) {
    const next = rel ? rel + "/" + entry.name : entry.name;
    if (entry.isDirectory()) out = out.concat(await walkFiles(dir, next));
    else out.push(next);
  }
  return out;
}

// Runs the real CLI entry point as a subprocess - process.execPath
// rather than the bare string "node", so this runs the same binary
// that is running the suite regardless of what a shell's PATH resolves
// "node" to. Takes the bake script explicitly rather than a module
// constant, because this suite runs two different copies of it (the
// isolated worktree's, for every real check; the checkout's own, once,
// for the regression guard in 0b that proves the isolation is doing
// something).
async function runBakeAt(bakeScript, out) {
  try {
    const { stdout, stderr } = await run(process.execPath,
      [bakeScript, "--out", out], { cwd: ROOT });
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
/* -1. Subject pin (0.9-M0-S21 fix wave 2, #318 F1) - run before ANYTHING */
/*     else, including the private worktree below, because the whole    */
/*     point is to refuse before that worktree's `--detach HEAD` gets a  */
/*     chance to paper over dirt in its own subject. See "THE COVERAGE   */
/*     TRADE THAT MECHANISM MAKES" in this file's header for why this    */
/*     exists. Not run through check()/EXPECTED: a dirty subject          */
/*     invalidates the premise every other check in this file runs on    */
/*     (they would all still execute, against HEAD's clean copy, and all */
/*     still pass - the exact silent-pass this fix closes), so this      */
/*     stops the run outright with a clear, actionable message rather    */
/*     than adding one more line to a report that would otherwise read   */
/*     as clean.                                                         */

const SUBJECT_PATHS = [
  // dev/demo-bake.mjs's own DEMO_FILES concat DEMO_DATA - named one by
  // one there ("not a pattern over dev/", that file's own header) and
  // mirrored one by one here for the same reason: a slice that adds a
  // demo asset to that allowlist updates this list in the same change,
  // or the pin stops meaning what it says. Verified against the file by
  // hand for this fix (0.9-M0-S21 fix wave 2), not derived from it - this
  // suite imports nothing from dev/, so there is nothing to derive it
  // from without breaking that rule.
  "dev/demo-bake.mjs",
  "dev/demo-stub.js",
  "dev/demo-boot.js",
  "dev/demo-toolbar.js",
  "dev/demo-toolbar.css",
  "dev/demo-corpus.js",
  "dev/demo-telegram.js",
  "dev/demo-config.js",
  "dev/sample-submissions.json",
  "dev/test-key.json",
  "dev/test-member-key.json",
  // The mirrored tree, read directory-not-list by webEntriesOf() itself
  // (dev/demo-bake.mjs, "READ, NEVER LISTED") - a single directory
  // pathspec keeps that same property here: nothing added under
  // apps/web needs a matching edit to this array.
  "apps/web",
];

const { stdout: subjectPorcelain } = await run("git",
  ["status", "--porcelain", "--", ...SUBJECT_PATHS], { cwd: ROOT });
if (subjectPorcelain.trim().length > 0) {
  console.error(
    "bake-hygiene: commit these files first; this arm tests HEAD's " +
    "copy. The private worktree this suite bakes against materializes " +
    "HEAD's committed tree, so testing it while these paths carry " +
    "uncommitted changes would silently exercise the wrong bytes:\n" +
    subjectPorcelain.trim());
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 0a. Stale-probe sweep (0.9-M0-S21 fix wave 2, #318 F2). Section 0b    */
/*     below writes DIRTY_PROBE_PATH into this checkout's root and       */
/*     removes it only in a `finally` - a SIGINT mid-run strands it, and */
/*     a stranded probe then makes the next REAL `./run bake` refuse     */
/*     (refuseDirty sees an uncommitted file that has nothing to do with */
/*     the bake it is about to run). Unconditional and silent: an absent */
/*     probe is the ordinary case and costs one no-op unlink, not a      */
/*     check - the property under test is what 0b below verifies, this   */
/*     is housekeeping for a run that never got to run 0b's own cleanup. */

const DIRTY_PROBE_PATH = join(ROOT,
  "hgb-bake-hygiene-ambient-dirty-probe.tmp");
await rm(DIRTY_PROBE_PATH, { force: true });

/* ------------------------------------------------------------------ */
/* 0. Set-up: a private worktree, checked out fresh at HEAD, that every */
/*    real check below bakes against instead of this checkout - see    */
/*    "WHY THIS SUITE'S OWN BAKES RUN AGAINST A PRIVATE WORKTREE" above */
/*    (0.9-M0-S21, #318). `--detach HEAD` rather than a branch name: it */
/*    is the commit this run is actually testing, whatever that is on  */
/*    whatever machine runs this, and a detached checkout cannot        */
/*    collide with a branch already checked out elsewhere - which a     */
/*    same-named branch could, on a machine running several worktrees   */
/*    of this repository at once (this fleet's normal condition).      */

const worktreeRoot = await mkdtemp(
  join(tmpdir(), "hgb-bake-hygiene-worktree-"));
await run("git", ["worktree", "add", worktreeRoot, "--detach", "HEAD"],
  { cwd: ROOT });
const BAKE = join(worktreeRoot, "dev", "demo-bake.mjs");
const runBake = (out) => runBakeAt(BAKE, out);

const { stdout: worktreePorcelain } = await run("git",
  ["status", "--porcelain"], { cwd: worktreeRoot });
check("the private worktree starts clean, exactly matching HEAD - " +
  "every check below depends on that, so a failure here means `git " +
  "worktree add` did not behave the way this suite assumes",
  worktreePorcelain.trim().length === 0);

try {
  /* ------------------------------------------------------------------ */
  /* 0b. Regression guard for the isolation above (0.9-M0-S21, #318):    */
  /*     both halves of the claim, not just the encouraging one. The     */
  /*     isolated worktree has to bake fine while THIS checkout carries  */
  /*     an unrelated, uncommitted file - reproducing the exact shape of */
  /*     the flake (some other check's mutation battery left the tree    */
  /*     dirty; every bake in this suite refused). And this checkout has */
  /*     to have genuinely BEEN dirty enough to matter - checked by      */
  /*     running the SAME probe against the checkout's own, non-isolated */
  /*     copy of the bake and watching it refuse, the way `./run bake`   */
  /*     really would. Without that second half, a future edit that      */
  /*     quietly broke the isolation (BAKE resolving back to a copy      */
  /*     under ROOT, say) would still pass the first half for free on a  */
  /*     tree that happened to be clean regardless - dirtying an         */
  /*     already-clean tree on purpose is the only way to tell whether   */
  /*     the isolation is doing anything at all.                         */

  await writeFile(DIRTY_PROBE_PATH,
    "an unrelated mutation battery's leftover, uncommitted on purpose " +
    "by this suite's own regression guard (0.9-M0-S21, #318)",
    "utf8");
  try {
    const isolatedWhileDirty = await mkdtemp(
      join(tmpdir(), "hgb-bake-hygiene-isolated-while-dirty-"));
    const isolatedResult = await runBake(isolatedWhileDirty);
    check("the isolated worktree bakes cleanly even while this " +
      "checkout carries an unrelated, uncommitted file",
      isolatedResult.code === 0);
    await rm(isolatedWhileDirty, { recursive: true, force: true });

    const primaryWhileDirty = await mkdtemp(
      join(tmpdir(), "hgb-bake-hygiene-primary-while-dirty-"));
    const primaryResult = await runBakeAt(PRIMARY_BAKE, primaryWhileDirty);
    check("...and a NON-isolated bake against this same dirty " +
      "checkout really does refuse, naming the uncommitted change - " +
      "confirming the guard above proves isolation and is not passing " +
      "by coincidence",
      primaryResult.code !== 0 &&
      /uncommitted changes/.test(primaryResult.stderr) &&
      primaryResult.stderr.includes("hgb-bake-hygiene-ambient-dirty-probe.tmp"));
    await rm(primaryWhileDirty, { recursive: true, force: true });
  } finally {
    await rm(DIRTY_PROBE_PATH, { force: true });
  }

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

  const absentParent = await mkdtemp(join(tmpdir(), "hgb-bake-hygiene-parent-"));
  const absentOut = join(absentParent, "not-yet-created");
  const absentResult = await runBake(absentOut);
  check("a bake into a directory that does not exist yet creates it and proceeds",
    absentResult.code === 0 && (await exists(join(absentOut, "index.html"))));

  await rm(absentParent, { recursive: true, force: true });

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

  /* ------------------------------------------------------------------ */
  /* 5. Completeness, both directions (2026-08-13 review, F1): what the  */
  /*    CLI reports writing and what is actually on disk have to be the  */
  /*    same set. 404.html used to be written outside the manifest, so   */
  /*    every bake under-reported its own size by one - a bake writing   */
  /*    50 files while printing "Baked 49 files". Read from the real     */
  /*    directory, not the manifest, per this file's own zero-imports    */
  /*    rule above.                                                      */

  const reportedMatch = emptyResult.stdout.match(/Baked (\d+) files/);
  const reportedCount = reportedMatch ? Number(reportedMatch[1]) : -1;
  const realFiles = await walkFiles(emptyOut, "");

  check("the bake's own stdout states how many files it wrote",
    reportedMatch !== null);
  check("every file the bake reported writing is one that actually exists " +
    "on disk (the count is not overstated)",
    realFiles.length >= reportedCount);
  check("every file actually on disk is one the bake reported writing " +
    "(the count is not understated - the exact way 404.html went " +
    "uncounted before this fix)",
    realFiles.length <= reportedCount);

  await rm(emptyOut, { recursive: true, force: true });

  /* ------------------------------------------------------------------ */
  /* 6. The destructive clear must never run before a refusal that would */
  /*    have stopped the bake (2026-08-13 review, F2). Reproduced        */
  /*    against a directory holding a complete previous build: no input  */
  /*    the unmodified CLI accepts reaches manifestFor()'s own refusal   */
  /*    (its allowlist guard only fires on an argument no caller passes),*/
  /*    so the refusal is induced the way the review induced it - a      */
  /*    targeted mutation of the private worktree's own copy of          */
  /*    dev/demo-bake.mjs, hidden from that worktree's `git status` with */
  /*    `git update-index --assume-unchanged` for exactly the window it  */
  /*    runs in, then restored byte-for-byte and un-flagged before this  */
  /*    suite reports anything.                                          */

  const goodOut = await mkdtemp(join(tmpdir(), "hgb-bake-hygiene-f2-"));
  const goodBake = await runBake(goodOut);
  check("setup: a real bake into a fresh directory succeeds - this is the " +
    "'complete previous build' the refusal below must not destroy",
    goodBake.code === 0);
  const beforeFiles = (await walkFiles(goodOut, "")).sort();
  check("setup: the previous build this probe protects actually holds files",
    beforeFiles.length > 0);

  const bakeSrcOriginal = await readFile(BAKE, "utf8");
  const anchor = "export function manifestFor(webEntries, raw) {";
  if (bakeSrcOriginal.indexOf(anchor) === -1) {
    throw new Error(
      "F2 regression probe: manifestFor()'s signature moved - update the " +
      "anchor string in tests/bake-hygiene.test.mjs rather than let this " +
      "probe silently stop mutating anything.");
  }
  const probeMessage =
    "F2-regression-probe: manifest refused before any output was touched";
  const bakeSrcMutated = bakeSrcOriginal.replace(anchor,
    anchor + "\n  throw new Error(\"" + probeMessage + "\");");

  await run("git", ["update-index", "--assume-unchanged", BAKE],
    { cwd: worktreeRoot });
  try {
    await writeFile(BAKE, bakeSrcMutated, "utf8");
    const probeResult = await runBake(goodOut);
    check("F2: a refusal ahead of any write refuses rather than silently " +
      "succeeding",
      probeResult.code !== 0 && probeResult.stderr.includes(probeMessage));

    const afterFiles = (await walkFiles(goodOut, "")).sort();
    check("F2: the refusal deleted nothing from the previous build it was " +
      "pointed at - the destructive clear runs only after every guard " +
      "that can refuse",
      JSON.stringify(afterFiles) === JSON.stringify(beforeFiles));
    check("F2: the refusal wrote nothing new either",
      afterFiles.length === beforeFiles.length);
  } finally {
    await writeFile(BAKE, bakeSrcOriginal, "utf8");
    await run("git", ["update-index", "--no-assume-unchanged", BAKE],
      { cwd: worktreeRoot });
  }

  const restoredSrc = await readFile(BAKE, "utf8");
  check("F2 probe: dev/demo-bake.mjs was restored exactly, byte for byte",
    restoredSrc === bakeSrcOriginal);

  await rm(goodOut, { recursive: true, force: true });
} finally {
  // Reported rather than swallowed: a worktree this suite forgot to
  // remove is a leak the next run (or the reaper) has to notice on its
  // own, so whether the removal actually happened is part of this
  // suite's own verdict, not a side note. Retried a few times rather
  // than judged on one attempt: the F2 probe above writes and restores
  // dev/demo-bake.mjs inside this same private worktree moments before
  // this runs, and on Windows a file that was just written can still be
  // held by something else for a beat (an indexer, a virus scanner) -
  // long enough for `git worktree remove` to lose that specific race
  // even though nothing this suite did was actually wrong. That is a
  // timing accommodation for a housekeeping step, not a retry over the
  // property under test - every check above still runs exactly once.
  let removed = false;
  for (let attempt = 0; attempt < 5 && !removed; attempt += 1) {
    if (attempt > 0) await delay(200);
    removed = await run("git",
      ["worktree", "remove", worktreeRoot, "--force"], { cwd: ROOT })
      .then(() => true, () => false);
  }
  check("the private worktree was removed when this run finished",
    removed);
}

console.log(failures
  ? `\nbake-hygiene FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nbake-hygiene ran ${performed} checks, expected ${EXPECTED}`
    : `\nbake-hygiene OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
