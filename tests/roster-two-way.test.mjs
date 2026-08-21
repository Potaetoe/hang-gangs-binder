/*
 * tests/run.mjs's own roster mechanism, armed (0.9-M3-S1, #381, against
 * 0.9-M2-S14's independent review, #380). The runner is supposed to
 * prove tests/ROSTER agrees with what tests/*.test.mjs discovery finds
 * in BOTH directions - before this ticket it only proved one. A roster
 * row naming a file that is gone already reds ("REQUIRED ARM MISSING",
 * MAJOR5, #311) and has been proven since it landed. The reviewer
 * deleted a real suite's row instead, and the gate stayed green at the
 * reduced arm count, because nothing ever asked the other question:
 * does every file discovery FOUND have a row. This arm is the permanent
 * proof neither direction regresses again, plus the explicit exclusion
 * list ("EXCLUDE <path> :: <reason>") this ticket adds so a suite can
 * be deliberately non-gating without going unrostered by accident.
 *
 * WIDENED 0.9-M3-S1b (#410), from 0.9-M3-S1's post-merge independent
 * review (issue 381, comment 5369370080): scenarios 9-11 arm three more
 * failure modes the review found live in the shipped mechanism (an
 * all-EXCLUDE roster asserting nothing, F3; a duplicate required row
 * and a duplicate EXCLUDE line each accepted silently, F5), and
 * scenarios 3 and 5's assertions were tightened (F4) - the reviewer
 * found one of the original 25 checks could not fail, because it
 * asserted a bare filename's presence in output that always contains
 * that filename's own passing result line regardless of whether the
 * roster check fired for it. See each scenario's own comment for the
 * finding it closes.
 *
 *     node tests/roster-two-way.test.mjs
 *
 * HOW IT PROVES IT WITHOUT TOUCHING THE REAL GATE. tests/run.mjs
 * computes its own directory and repo root from its OWN file's URL, not
 * from cwd - so a byte-identical copy of it, run from an isolated
 * scratch "tests/" directory holding a handful of trivial fixture arms
 * and its own tests/ROSTER, is the REAL mechanism running over a small
 * world this file controls completely, rather than a reimplementation
 * that could drift from what actually ships. Only preflight.mjs is not
 * the real file - a stub stands in for it, printing the one line the
 * vacuity guard requires and nothing else, because preflight's own job
 * (worktree hygiene) is proven elsewhere
 * (tests/worktree-contract.test.mjs) and re-deriving --verify's answer
 * for a directory with no git repository under it would test nothing
 * this file is about.
 *
 * The fixture arms are one-line scripts that print a verdict and exit
 * 0 - what they check is not the point; whether the roster mechanism
 * notices them arriving, a row for one leaving, or one being excluded,
 * is.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const REAL_RUNNER = await readFile(HERE("run.mjs"), "utf8");

const STUB_PREFLIGHT =
  "console.log(\"initialized: CI path (stub for the roster-two-way " +
  "fixture, not the real preflight - worktree hygiene is proven in " +
  "tests/worktree-contract.test.mjs, not here)\");\nprocess.exit(0);\n";

const stubArm = (label) =>
  "console.log(\"" + label + " OK\");\nprocess.exit(0);\n";

/* Builds <tmp>/tests/ holding the real run.mjs, the stub preflight, the
   given ROSTER text, and one fixture arm per name in `arms`. Returns
   the scratch root so the caller can clean it up. */
async function buildFixture(rosterText, arms) {
  const root = await mkdtemp(join(tmpdir(), "hgb-roster-two-way-"));
  const testsDir = join(root, "tests");
  await mkdir(testsDir);
  await writeFile(join(testsDir, "run.mjs"), REAL_RUNNER);
  await writeFile(join(testsDir, "preflight.mjs"), STUB_PREFLIGHT);
  await writeFile(join(testsDir, "ROSTER"), rosterText);
  for (const name of arms) {
    await writeFile(join(testsDir, name + ".test.mjs"), stubArm(name));
  }
  return root;
}

/* Runs the fixture's copy of the runner and returns { code, output } -
   stdout and stderr combined, the same way tests/run.mjs's own runFile
   reads its arms, so a message this arm greps for is read exactly the
   way a human reading the real gate's log would see it. */
function runFixture(root) {
  const done = spawnSync(process.execPath, [join(root, "tests", "run.mjs")],
    { encoding: "utf8" });
  return {
    code: done.status,
    output: (done.stdout || "") + (done.stderr || ""),
  };
}

const roots = [];
async function scenario(rosterText, arms) {
  const root = await buildFixture(rosterText, arms);
  roots.push(root);
  return runFixture(root);
}

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* ================================================================== */
/* 1. Agreement: two fixture arms, both rostered. This is the whole     */
/*    apparatus' own precondition - it has to be silent before any      */
/*    direction below means anything.                                   */

{
  const result = await scenario(
    "tests/alpha.test.mjs\ntests/beta.test.mjs\n", ["alpha", "beta"]);
  check("a roster naming exactly what discovery finds exits 0",
    result.code === 0);
  check("a roster naming exactly what discovery finds reports no " +
    "problems", /2 arm\(s\), all green\./.test(result.output));
}

/* ================================================================== */
/* 2. Direction A (MAJOR5, #311, armed since it landed) - a roster row  */
/*    naming a file that is not there.                                  */

{
  const result = await scenario(
    "tests/alpha.test.mjs\ntests/beta.test.mjs\ntests/ghost.test.mjs\n",
    ["alpha", "beta"]);
  check("a roster row naming a missing file exits nonzero",
    result.code !== 0);
  check("the red names REQUIRED ARM MISSING",
    result.output.includes("REQUIRED ARM MISSING"));
  check("the red names the missing path",
    result.output.includes("tests/ghost.test.mjs"));
}

/* ================================================================== */
/* 3. Direction B (0.9-M3-S1, #381) - the gap the review found. A       */
/*    suite discovery finds, with no roster row: first by DELETING a    */
/*    row for a file that is still there (the reviewer's own mutation). */

/* F4 (0.9-M3-S1b, #410): the review found that checking for the bare   */
/* filename here proved nothing, because beta.test.mjs is a fixture arm */
/* that still RUNS and PASSES in this scenario - its name is in the      */
/* result table's "ok" line regardless of whether ARM NOT ON ROSTER ever */
/* fires, so `output.includes("tests/beta.test.mjs")` could not fail.    */
/* The fix is the same everywhere this pattern recurs below: assert the  */
/* full glued message ("ARM NOT ON ROSTER: <path> is a discovered        */
/* suite"), which can only be present if the runner named exactly that   */
/* path in exactly that red - never satisfied by an unrelated "ok" line. */

{
  const result = await scenario("tests/alpha.test.mjs\n", ["alpha", "beta"]);
  check("a discovered suite with no roster row exits nonzero " +
    "(row deleted, file still present)", result.code !== 0);
  check("the red names ARM NOT ON ROSTER for tests/beta.test.mjs " +
    "specifically - not merely present somewhere in the output, which " +
    "beta's own passing result line would already satisfy on its own",
    result.output.includes(
      "ARM NOT ON ROSTER: tests/beta.test.mjs is a discovered suite"));
}

/* ...and second by ADDING a fixture arm no line has ever named - the   */
/* same gap reached the other way: not a row that went stale, a file    */
/* that arrived with none.                                              */

{
  const result = await scenario(
    "tests/alpha.test.mjs\ntests/beta.test.mjs\n",
    ["alpha", "beta", "arrived"]);
  check("a brand-new suite with no roster row exits nonzero " +
    "(file added, no row ever written)", result.code !== 0);
  check("the red names ARM NOT ON ROSTER for tests/arrived.test.mjs " +
    "specifically, the same precise-message technique",
    result.output.includes(
      "ARM NOT ON ROSTER: tests/arrived.test.mjs is a discovered suite"));
}

/* ================================================================== */
/* 4. The exclusion list: a suite left off the required list on         */
/*    purpose, with a reason, is not "ARM NOT ON ROSTER".                */

{
  const result = await scenario(
    "tests/alpha.test.mjs\n" +
    "EXCLUDE tests/beta.test.mjs :: fixture arm intentionally left " +
    "out of the required list for this scenario\n",
    ["alpha", "beta"]);
  check("an excluded suite exits 0", result.code === 0);
  check("an excluded suite is not reported as unrostered",
    !result.output.includes("ARM NOT ON ROSTER"));
  check("an excluded suite still counts as a discovered, run arm",
    /2 arm\(s\), all green\./.test(result.output));
}

/* ================================================================== */
/* 5. A malformed exclusion - no "::" at all, or a reason that is empty */
/*    after it - is its own red, and does NOT quietly excuse the suite  */
/*    it names.                                                         */

{
  const result = await scenario(
    "tests/alpha.test.mjs\nEXCLUDE tests/beta.test.mjs\n",
    ["alpha", "beta"]);
  check("a line reading EXCLUDE <path> with no \"::\" exits nonzero",
    result.code !== 0);
  check("the red names MALFORMED EXCLUSION",
    result.output.includes("MALFORMED EXCLUSION"));
  check("the malformed line does not excuse the suite it names - " +
    "tests/beta.test.mjs is still named, specifically, as unrostered " +
    "(the F4 precise-message technique again)",
    result.output.includes(
      "ARM NOT ON ROSTER: tests/beta.test.mjs is a discovered suite"));
}

{
  const result = await scenario(
    "tests/alpha.test.mjs\nEXCLUDE tests/beta.test.mjs :: \n",
    ["alpha", "beta"]);
  check("a line reading EXCLUDE <path> :: with an empty reason exits " +
    "nonzero", result.code !== 0);
  check("the red names MALFORMED EXCLUSION for an empty reason",
    result.output.includes("MALFORMED EXCLUSION"));
}

/* ================================================================== */
/* 6. A stale exclusion - the file it names is gone - excuses nothing   */
/*    and is its own red, the same way tools/check.py's                 */
/*    NODE_SUITES_EXCLUDED is already checked (#204).                   */

{
  const result = await scenario(
    "tests/alpha.test.mjs\ntests/beta.test.mjs\n" +
    "EXCLUDE tests/ghost.test.mjs :: retired fixture, line left behind\n",
    ["alpha", "beta"]);
  check("an exclusion for a file discovery cannot find exits nonzero",
    result.code !== 0);
  check("the red names STALE EXCLUSION",
    result.output.includes("STALE EXCLUSION"));
  check("the red names the stale path",
    result.output.includes("tests/ghost.test.mjs"));
}

/* ================================================================== */
/* 7. A path both required and excluded is a contradiction, not a       */
/*    silent required-wins-or-excluded-wins choice.                     */

{
  const result = await scenario(
    "tests/alpha.test.mjs\ntests/beta.test.mjs\n" +
    "EXCLUDE tests/beta.test.mjs :: contradiction fixture\n",
    ["alpha", "beta"]);
  check("a suite both required and excluded exits nonzero",
    result.code !== 0);
  check("the red names REQUIRED AND EXCLUDED",
    result.output.includes("REQUIRED AND EXCLUDED"));
}

/* ================================================================== */
/* 8. An empty roster (no required lines, no exclusions) asserts        */
/*    nothing and fails the way no roster at all does.                  */

{
  const result = await scenario("# nothing but a comment\n", ["alpha"]);
  check("a roster with no required lines and no exclusions exits " +
    "nonzero", result.code !== 0);
  check("the red says the roster asserts nothing",
    result.output.includes("asserts nothing"));
}

/* ================================================================== */
/* 9. F3 (0.9-M3-S1b, #410) - a roster made ENTIRELY of EXCLUDE lines,  */
/*    with zero required rows, still asserts nothing: the review's own  */
/*    probe (P-EXCL-ONLY / P-EXCL-EVERY) found the merged guard read     */
/*    `required.length === 0 && excluded.size === 0`, so any number of   */
/*    exclusions made an empty required list pass green - delete every   */
/*    arm file, delete every required row, leave the EXCLUDE lines       */
/*    standing, and the gate would stay green, which is exactly the      */
/*    whole-arm SUBTRACTION MAJOR5/#311 built this file to catch. The    */
/*    guard now reds on `required.length === 0` alone.                   */

{
  const result = await scenario(
    "EXCLUDE tests/alpha.test.mjs :: everything is optional now\n" +
    "EXCLUDE tests/beta.test.mjs :: so is this\n",
    ["alpha", "beta"]);
  check("a roster with zero required rows and only EXCLUDE lines " +
    "exits nonzero, however many exclusions it carries",
    result.code !== 0);
  check("the red says the roster asserts nothing",
    result.output.includes("asserts nothing"));
}

/* ================================================================== */
/* 10. F5 (0.9-M3-S1b, #410) - the same required path listed twice is   */
/*     refused by name, not silently accepted as a harmless repeat.      */

{
  const result = await scenario(
    "tests/alpha.test.mjs\ntests/alpha.test.mjs\ntests/beta.test.mjs\n",
    ["alpha", "beta"]);
  check("a roster listing the same required path twice exits nonzero",
    result.code !== 0);
  check("the red names DUPLICATE REQUIRED ROW",
    result.output.includes("DUPLICATE REQUIRED ROW"));
}

/* ================================================================== */
/* 11. F5 - the same path EXCLUDEd twice is refused too, rather than    */
/*     the second reason silently overwriting the first (a Map's        */
/*     ordinary behavior, and exactly the silent state the exclusion     */
/*     mechanism exists to avoid - the review's P-EXCL-DUPPATH probe).   */

{
  const result = await scenario(
    "tests/alpha.test.mjs\n" +
    "EXCLUDE tests/beta.test.mjs :: first reason\n" +
    "EXCLUDE tests/beta.test.mjs :: second reason\n",
    ["alpha", "beta"]);
  check("a roster excluding the same path twice exits nonzero",
    result.code !== 0);
  check("the red names DUPLICATE EXCLUSION",
    result.output.includes("DUPLICATE EXCLUSION"));
}

/* ------------------------------------------------------------------ */
for (const root of roots) await rm(root, { recursive: true, force: true });

const EXPECTED = 30;
console.log(failures
  ? `\nroster-two-way FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nroster-two-way ran ${performed} checks, expected ${EXPECTED}`
    : `\nroster-two-way OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
