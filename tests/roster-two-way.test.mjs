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
 * WIDENED 0.9-M3-S7 (#410), from 0.9-M3-S1's post-merge independent
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
 * FIX WAVE 1 (#410, from S7's own post-merge review, comment
 * 5369810514): the same loose-substring defect class F4 removed from
 * scenarios 3 and 5 turned up TWICE more in the scenarios that fixed
 * F3 and F5. Scenario 11 (F1) checked only the DUPLICATE EXCLUSION
 * label, never that the message actually carries the first, surviving
 * reason rather than a decoy built from the second, rejected one.
 * Scenarios 8 and 9 (F2) checked "asserts nothing", a substring the
 * new DUPLICATE REQUIRED ROW message also emits - latent today because
 * neither scenario can produce a duplicate row, but the same fragile
 * shape F4 exists to refuse. All three tightened to the full or
 * distinguishing text.
 *
 * WIDENED AGAIN 0.9-M3-S18 (#428): scenarios 13-14 arm the ordering
 * rule `.gitattributes`' new `tests/ROSTER merge=union` line made
 * necessary - that driver reconciles two branches that each append a
 * row (the shape that stopped the door on 2026-08-21) but has no notion
 * the file is supposed to stay alphabetically ordered, so a real merge
 * can land two real rows out of order with neither existing direction
 * ever noticing. tests/roster-merge-driver.test.mjs is the sibling arm
 * that proves the driver itself, over a real `git merge`; this file
 * stays about the reader's own rules.
 *
 *     node tests/roster-two-way.test.mjs
 *
 * HOW IT PROVES IT WITHOUT TOUCHING THE REAL GATE. tests/run.mjs
 * computes its own directory and repo root from its OWN file's URL, not
 * from cwd - so a byte-identical copy of it, run from an isolated
 * scratch "tests/" directory holding a handful of trivial fixture arms
 * and its own tests/ROSTER, is the REAL mechanism running over a small
 * world this file controls completely, rather than a reimplementation
 * that could drift from what actually ships. gate-pool.mjs (0.9-M3-S35,
 * #460) is copied byte-identical alongside it for the same reason - the
 * runner imports it as a sibling module now, so the copy needs its own
 * copy to import. Only preflight.mjs is not the real file - a stub
 * stands in for it, printing the one line the vacuity guard requires
 * and nothing else, because preflight's own job (worktree hygiene) is
 * proven elsewhere (tests/worktree-contract.test.mjs) and re-deriving
 * --verify's answer for a directory with no git repository under it
 * would test nothing this file is about.
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
// The runner's own pool (0.9-M3-S35, #460): run.mjs now imports
// "./gate-pool.mjs" as a sibling module, so a byte-identical copy of
// run.mjs is not runnable on its own any more - the copy's relative
// import would resolve against the FIXTURE directory, where nothing
// answered it, and every scenario below would fail at module load
// before the roster logic this file is actually about ever ran. Copied
// alongside run.mjs for the same "real mechanism, not a
// reimplementation" reason the module docstring above gives for run.mjs
// itself - gate-pool.mjs is not roster-gated (it is not a `.test.mjs`
// file and run.mjs's own NOT_ARMS names it), so no fixture ROSTER row
// is needed for it, only the file.
const REAL_GATE_POOL = await readFile(HERE("gate-pool.mjs"), "utf8");

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
  await writeFile(join(testsDir, "gate-pool.mjs"), REAL_GATE_POOL);
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

/* F4 (0.9-M3-S7, #410): the review found that checking for the bare   */
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
  /* F2 (0.9-M3-S7 fix wave 1, #410): "asserts nothing" is a loose
     substring the DUPLICATE REQUIRED ROW message in scenario 10 also
     emits ("...a repeat asserts nothing a single line did not
     already..."), so it could not tell the two reds apart - the exact
     defect class F4 was raised to remove, reintroduced one message
     over. "names no required arms" is unique to the empty-roster red. */
  check("the red names no required arms - the distinguishing text, " +
    "not a substring the newer duplicate-required-row message also " +
    "emits",
    result.output.includes("names no required arms"));
}

/* ================================================================== */
/* 9. F3 (0.9-M3-S7, #410) - a roster made ENTIRELY of EXCLUDE lines,  */
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
  check("the red names no required arms - the same distinguishing " +
    "text as scenario 8, not the loose \"asserts nothing\" substring " +
    "(F2)",
    result.output.includes("names no required arms"));
}

/* ================================================================== */
/* 10. F5 (0.9-M3-S7, #410) - the same required path listed twice is   */
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
  /* F1 (0.9-M3-S7 fix wave 1, #410): the label alone does not prove the
     claimed behavior - "the first, surviving reason" - actually
     survives. A runner that built the message from `reason` (the
     second, discarded one) for BOTH slots would still print this
     label and still pass a check that only looks for the label. The
     full compound substring can only be present if the FIRST reason
     shown is "first reason" (the stored, surviving one) and the
     second shown is "second reason" (the rejected one) - exactly the
     claim the fix and the completion both make. */
  check("the red names DUPLICATE EXCLUSION and carries BOTH reasons in " +
    "order - the first, surviving reason named first, the second, " +
    "rejected reason named second - not just the bare label",
    result.output.includes("DUPLICATE EXCLUSION") &&
    result.output.includes(
      "(\"first reason\" and now \"second reason\")"));
}

/* ================================================================== */
/* 12. F2 (0.9-M3-S7 fix wave 1, #410) - the review's own probe (P2):  */
/*     a run that is red ONLY for a duplicate required row must NOT be  */
/*     mistaken for the empty-roster red. The DUPLICATE REQUIRED ROW    */
/*     message itself contains the words "asserts nothing" ("...a       */
/*     repeat asserts nothing a single line did not already..."), so a  */
/*     check using that loose substring would have reported the         */
/*     empty-roster red as present here when it is not - required ends  */
/*     up length 1 (tests/alpha.test.mjs, once, after the duplicate is   */
/*     rejected), never 0. This scenario proves both halves: the tight   */
/*     "names no required arms" text correctly stays absent, and the     */
/*     loose "asserts nothing" text is present anyway - which is         */
/*     exactly why scenarios 8 and 9 no longer use it.                   */

{
  const result = await scenario(
    "tests/alpha.test.mjs\ntests/alpha.test.mjs\n" +
    "EXCLUDE tests/beta.test.mjs :: r\n",
    ["alpha", "beta"]);
  check("a run red only for a duplicate required row does NOT also " +
    "report the empty-roster red (required ends up length 1, not 0)",
    !result.output.includes("names no required arms"));
  check("...even though the loose \"asserts nothing\" substring the " +
    "pre-fix-wave checks used IS present, from the unrelated " +
    "duplicate-row message - the false positive F2 found, made " +
    "concrete",
    result.output.includes("DUPLICATE REQUIRED ROW") &&
    result.output.includes("asserts nothing"));
}

/* ================================================================== */
/* 13. THE ORDERING RULE (0.9-M3-S18, #428). tests/ROSTER's own union    */
/*     merge driver (.gitattributes' `tests/ROSTER merge=union`) has no  */
/*     notion the file has an ordering rule - it just concatenates both  */
/*     sides' added lines at their own positions - so a real merge can   */
/*     leave two required rows out of alphabetical order with neither    */
/*     direction A nor B above ever noticing (discovery still finds      */
/*     both files, and both are correctly required). Required rows out   */
/*     of order is its own red now, naming both offending lines - the    */
/*     F4 precise-message technique again, since a bare filename would   */
/*     already appear in the two arms' own passing result lines.         */

{
  const result = await scenario(
    "tests/beta.test.mjs\ntests/alpha.test.mjs\n", ["alpha", "beta"]);
  check("a required roster out of alphabetical order exits nonzero",
    result.code !== 0);
  check("the red names ROSTER OUT OF ORDER and the exact adjacent pair, " +
    "not merely the two filenames present anywhere (which the arms' " +
    "own passing result lines would already satisfy)",
    result.output.includes(
      "ROSTER OUT OF ORDER: tests/ROSTER lists tests/alpha.test.mjs " +
      "immediately after tests/beta.test.mjs"));
}

/* ================================================================== */
/* 14. The same rule, checked as its own sequence for EXCLUDE rows -     */
/*     required order and EXCLUDE order are two separate questions, so   */
/*     a required list that happens to be in order does not excuse an    */
/*     EXCLUDE list that is not.                                         */

{
  const result = await scenario(
    "tests/alpha.test.mjs\n" +
    "EXCLUDE tests/gamma.test.mjs :: z\n" +
    "EXCLUDE tests/beta.test.mjs :: y\n",
    ["alpha", "beta", "gamma"]);
  check("EXCLUDE rows out of alphabetical order exits nonzero",
    result.code !== 0);
  check("the red names ROSTER OUT OF ORDER for the EXCLUDE pair " +
    "specifically",
    result.output.includes(
      "ROSTER OUT OF ORDER: tests/ROSTER lists tests/beta.test.mjs " +
      "immediately after tests/gamma.test.mjs"));
}

/* ------------------------------------------------------------------ */
for (const root of roots) await rm(root, { recursive: true, force: true });

const EXPECTED = 36;
console.log(failures
  ? `\nroster-two-way FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nroster-two-way ran ${performed} checks, expected ${EXPECTED}`
    : `\nroster-two-way OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
