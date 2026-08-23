/*
 * tests/run.mjs's own pool, ordering, wall-time, budget and per-arm-
 * timeout printing (0.9-M3-S35, #460, plus its fix waves), armed at the
 * INTEGRATION level - a fixture roster of fake arms, run through the
 * REAL runner and gate-pool.mjs, not a reimplementation of either.
 * tests/gate-pool.test.mjs already proves runPool()'s own ordering and
 * concurrency contract as a unit; this file proves the same properties
 * show up correctly once tests/run.mjs is printing arm names, a
 * wall-time line and a budget verdict around it.
 *
 *     node tests/gate-budget.test.mjs
 *
 * FIX WAVE 2 (#460, re-fire #1, finding F1): every check in this file
 * used to grade two things by comparing REAL measured wall-clock
 * durations against each other - a pool-of-3-vs-pool-of-1 ratio, and
 * the "slowest" line's claimed name ordering. Both flaked twice, on two
 * different checks in the same file, under real contention on this
 * shared machine: fix wave 1 widened the ordering check's fixture gaps
 * (120ms to 2000/800/100ms) to fix the FIRST flake, which made the ideal
 * ratio for the SECOND check (pool 3 wall vs pool 1 wall) climb from
 * ~0.5 to ~0.69 against an unmoved 0.75 threshold - trading nine
 * percentage points of headroom for one, and the re-fire caught the
 * SECOND check flaking twice in 26 runs. Prime's ruling then: no
 * pass/fail decision in this file may depend on real wall-clock timing
 * of real sleeps, except for ONE real-timing smoke check asserting only
 * coarse, un-flakable truths - see tests/run.mjs's own "THE TEST-
 * DURATION SEAM" comment for the mechanism this uses instead: an arm may
 * report its OWN duration by printing a line, and the runner substitutes
 * that EXACT injected number for the real measured one, but ONLY when
 * BINDER_GATE_TEST_DURATIONS_MS=1 is set - never in a real run, CI
 * included.
 *
 * RE-FIRE #2 (#460, Prime's ruling 2026-08-22, "the class is closed
 * whole this time"): the "one real-timing smoke check" carve-out above
 * itself flaked (2 of 30 runs) and is GONE - deleted outright, not
 * loosened, because coarse or not, it was still a real-wall-clock
 * pass/fail decision on a contended machine, which the ruling now
 * forbids without exception in this file. The ONE surviving real-timing
 * scenario is the hung-arm kill (F3 originally, "F1" below): a real kill
 * cannot be simulated by the duration seam, which only overrides what
 * NUMBER a passing arm's own report claims, never whether a process
 * tree actually died. Its fixture now uses a per-arm timeout of 30s
 * (the ruling's own floor) against a 600s sleeper - both numbers far
 * enough apart that killing at ~30s and asserting "well under the 600s
 * sleep" needs no fine margin at all - and its own preflight stub is
 * exempt from that timeout by construction: it is the SAME `preflight`
 * exemption tests/run.mjs's own PREFLIGHT constant carries (this
 * fixture is a byte-identical copy of the real runner, so any exemption
 * built into tests/run.mjs governs the fixture's stub too, with zero
 * separate code here). Every scenario below states which of the two
 * modes (seam-based or the one surviving real-timing exception) it uses
 * and why.
 *
 * HOW IT PROVES IT WITHOUT TOUCHING THE REAL GATE - the same technique
 * tests/roster-two-way.test.mjs uses and explains in its own header: a
 * byte-identical copy of run.mjs and gate-pool.mjs, run from an isolated
 * scratch "tests/" directory this file controls completely, with a stub
 * preflight standing in for worktree hygiene (proven elsewhere).
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const REAL_RUNNER = await readFile(HERE("run.mjs"), "utf8");
const REAL_GATE_POOL = await readFile(HERE("gate-pool.mjs"), "utf8");

const STUB_PREFLIGHT =
  "console.log(\"initialized: CI path (stub for the gate-budget " +
  "fixture, not the real preflight - worktree hygiene is proven in " +
  "tests/worktree-contract.test.mjs, not here)\");\nprocess.exit(0);\n";

/* A REAL-SLEEP arm - it genuinely waits `ms` before printing its own
   verdict and exiting with `code`. RESTRICTED USE, NARROWED FURTHER AT
   RE-FIRE #2: the SMOKE scenario that used to share this builder is
   gone (a real-wall-clock pass/fail decision, forbidden without
   exception now); only the hung-arm scenario below still uses it, for
   the one property nothing else in this file proves - a REAL kill of a
   REAL hung process - every other scenario in this file uses
   `fakeDurationArm` instead, which takes no real time at all and so
   cannot flake regardless of what else is running on this machine. */
const sleepArm = (label, ms, code) =>
  "await new Promise((r) => setTimeout(r, " + ms + "));\n" +
  "console.log(\"" + label + (code ? " NOT OK" : " OK") + "\");\n" +
  "process.exit(" + (code || 0) + ");\n";

/* A FAKE-DURATION arm (fix wave 2, #460, re-fire #1, F1). It does NOT
   sleep - it resolves as fast as node can start and exit - and instead
   PRINTS the duration it wants to be graded as taking, as the marker
   line tests/run.mjs's own test-duration seam reads
   (BINDER_GATE_TEST_DURATIONS_MS=1; see that file's header). A scenario
   built from these arms gets an EXACT, pinned answer with no real
   timing anywhere in its pass/fail decision - nothing here can flake
   because of a busy machine, because nothing here measures the
   machine. `durationMs` is never a real delay; it is only ever a
   number this file chose and the runner is being asked to trust (or,
   in the SEAM OFF scenario below, correctly refuse to trust). */
const fakeDurationArm = (label, durationMs, code) =>
  "console.log(\"__GATE_TEST_DURATION_MS__ " + durationMs + "\");\n" +
  "console.log(\"" + label + (code ? " NOT OK" : " OK") + "\");\n" +
  "process.exit(" + (code || 0) + ");\n";

/* Builds <tmp>/tests/ holding the real run.mjs and gate-pool.mjs, a
   ROSTER naming every given arm as required, and one arm per [label,
   durationOrMs, exitCode] triple, built by `makeArm` (either builder
   above). `preflightSource` defaults to the fast STUB_PREFLIGHT above;
   the preflight-exemption scenario below passes a slow one instead, to
   prove tests/run.mjs's own timeout truly does not govern it. Returns
   the scratch root so the caller can clean it up. */
async function buildFixture(arms, makeArm, preflightSource) {
  const root = await mkdtemp(join(tmpdir(), "hgb-gate-budget-"));
  const testsDir = join(root, "tests");
  await mkdir(testsDir);
  await writeFile(join(testsDir, "run.mjs"), REAL_RUNNER);
  await writeFile(join(testsDir, "gate-pool.mjs"), REAL_GATE_POOL);
  await writeFile(join(testsDir, "preflight.mjs"),
    preflightSource || STUB_PREFLIGHT);
  const rosterText = arms
    .map(([label]) => "tests/" + label + ".test.mjs\n").join("");
  await writeFile(join(testsDir, "ROSTER"), rosterText);
  for (const [label, ms, code] of arms) {
    await writeFile(join(testsDir, label + ".test.mjs"),
      makeArm(label, ms, code));
  }
  return root;
}

/* Runs the fixture's copy of the runner with the given extra
   environment variables layered over this process' own - stdout and
   stderr combined, the same way tests/run.mjs's own runFile reads its
   arms - and returns { code, output, ms }: `ms` is THIS CALL's own
   measured wall time (used only by the F3 hung-arm scenario below, to
   prove the timeout actually cut a real wait short - every other
   scenario in this file ignores it).

   The three levers `tests/run.mjs` itself reads are deleted from the
   base environment FIRST, then `env`'s own choices applied on top - not
   `Object.assign({}, process.env, env)` alone. Without the delete, a
   scenario that wants a lever UNSET (or explicitly OFF) silently
   inherits whatever this OUTER process happens to have set for it -
   exactly what happened running this file's own "RESTORE" checks by
   hand with BINDER_GATE_BUDGET_SECONDS=1 set in the shell to drive a
   different mutation. A scenario that wants a lever unset (or forced to
   a specific OFF-shaped value) passes that choice in `env` and gets
   exactly that, never an inherited one. */
function runFixture(root, env, safetyTimeoutMs) {
  const started = Date.now();
  const base = Object.assign({}, process.env);
  delete base.BINDER_GATE_POOL;
  delete base.BINDER_GATE_BUDGET_SECONDS;
  delete base.BINDER_ARM_TIMEOUT_SECONDS;
  // Fix wave 2 (#460, re-fire #1, F1): the fourth lever, cleared the
  // same way and for the same reason - the SEAM OFF scenario below
  // needs a genuinely ABSENT variable, not one this outer shell happens
  // to already have set for an unrelated reason.
  delete base.BINDER_GATE_TEST_DURATIONS_MS;
  // Re-fire #2 (#460, Prime's ruling 2026-08-22): the fifth lever,
  // cleared for the same reason - the ADVISORY-mode budget scenario
  // below needs BINDER_GATE_ENFORCE_BUDGET genuinely ABSENT, not
  // inherited from whatever CI-shaped environment this suite itself
  // happens to run inside.
  delete base.BINDER_GATE_ENFORCE_BUDGET;
  const options = {
    encoding: "utf8", env: Object.assign(base, env || {}),
  };
  // `safetyTimeoutMs` is a HARD OUTER BACKSTOP, never the thing under
  // test: the F3 scenario below tests tests/run.mjs's OWN per-arm
  // timeout (BINDER_ARM_TIMEOUT_SECONDS, seconds), which this file
  // always sets small enough that the real feature fires first. This is
  // only insurance against a genuine regression that removed the
  // feature entirely - without it, a broken build would hang this
  // fixture (and so this whole gate) for as long as the fixture's own
  // hung arm sleeps, rather than failing loudly in seconds. Every other
  // scenario passes nothing here and keeps the unbounded wait it always
  // had.
  if (safetyTimeoutMs) options.timeout = safetyTimeoutMs;
  const done = spawnSync(process.execPath, [join(root, "tests", "run.mjs")],
    options);
  return {
    code: done.status,
    output: (done.stdout || "") + (done.stderr || ""),
    ms: Date.now() - started,
  };
}

const roots = [];
async function scenario(arms, env, makeArm, safetyTimeoutMs,
    preflightSource) {
  const root = await buildFixture(arms, makeArm, preflightSource);
  roots.push(root);
  return runFixture(root, env, safetyTimeoutMs);
}

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* ================================================================== */
/* SEAM OFF - the real-run default. tests/run.mjs's test-duration seam  */
/* (BINDER_GATE_TEST_DURATIONS_MS) is armed ONLY when that variable     */
/* reads EXACTLY "1" - never by CI (.github/workflows/deploy.yml sets   */
/* no BINDER_GATE_* variable at all), never by ./run check, never by    */
/* anything absent or set to some other value. Proven both ways an arm  */
/* could try to slip past the check: the variable genuinely absent (the */
/* real-run and CI shape), and the variable PRESENT but not "1" (a      */
/* stray "0", the shape a careless caller might reach for). Either way, */
/* an arm's own __GATE_TEST_DURATION_MS__ line claiming ~999 real       */
/* seconds is ignored, and the runner reports what actually happened: a */
/* fast, near-instant process. This is the "arm that" proof the ticket  */
/* asks for - the seam cannot be used by an arm to lie about its own    */
/* duration unless a human deliberately opted in by name.               */

for (const seamValue of [undefined, "0"]) {
  const LYING_ARMS = [["liar", 999000]];
  const env = seamValue === undefined
    ? {} : { BINDER_GATE_TEST_DURATIONS_MS: seamValue };
  const label = seamValue === undefined
    ? "SEAM OFF (absent, the real-run default)"
    : "SEAM OFF (present but not \"1\": \"" + seamValue + "\")";
  const result = await scenario(LYING_ARMS, env, fakeDurationArm);
  check(label + ": the lying arm still exits 0", result.code === 0);
  const printed = /tests\/liar\.test\.mjs\s+ok\s+([\d.]+)s/.exec(
    result.output);
  /* Fix wave 4 (re-fire #3, finding F2): this used to read
     `Number(printed[1]) < 30` - a real measured duration compared
     against a fixed ceiling, the exact shape the ruling closed
     everywhere in this apparatus but the one named exception (the
     hung-arm kill, further down). The property this check actually
     wants - "the runner ignored the marker and reported what really
     happened" - names its own un-flakable test with no clock at all:
     if the seam mistakenly read the arm's injected lie, the printed
     figure would read the EXACT literal string "999.0" (999000ms,
     `toFixed(1)`), the same injected value the arm chose. Checking
     that the printed string is not that one specific literal is an
     exact-value comparison against an INJECTED number, like every
     other check in this file - not a ceiling a busy machine could
     ever cross by running slowly, since a slow real duration would
     land anywhere except exactly "999.0". */
  check(label + ": the printed duration is real measured time, not the "
        + "arm's own lied claim of 999000ms - the printed figure is not "
        + "the literal \"999.0\" the lie would produce if the seam read "
        + "it" + (printed ? " (printed " + printed[1] + "s)" : ""),
        printed !== null && printed[1] !== "999.0");
  check(label + ": the lie's own number never reaches the output at all",
        !result.output.includes("999000"));
}

/* ================================================================== */
/* SEAM ON, EXACT expectations. Three arms, INJECTED durations chosen   */
/* so the "slowest" ranking (by injected duration) and the ROSTER order */
/* (alpha, beta, gamma - alphabetical, which is also discovery order)   */
/* disagree with each other: beta claims the longest, then gamma, then  */
/* alpha the shortest. No real time separates them - all three resolve  */
/* as fast as node can start and exit - so BOTH properties checked here */
/* are exact and un-flakable: the ordinary per-arm report ROWS print in */
/* ROSTER order regardless of which one claims the longest duration,    */
/* and the SLOWEST line reads the injected durations, in the injected   */
/* ranking, with the exact figures a human would expect from 100/5000/  */
/* 2000 milliseconds - not "close to" or "in the right direction", the  */
/* literal string. */

{
  const EXACT_ARMS = [["alpha", 100], ["beta", 5000], ["gamma", 2000]];
  const result = await scenario(EXACT_ARMS,
    { BINDER_GATE_TEST_DURATIONS_MS: "1", BINDER_GATE_POOL: "3" },
    fakeDurationArm);
  check("SEAM ON: exits 0", result.code === 0);
  check("SEAM ON: each arm's own report row shows the EXACT injected "
        + "duration, not a measured one",
        /tests\/alpha\.test\.mjs\s+ok\s+0\.1s/.test(result.output) &&
        /tests\/beta\.test\.mjs\s+ok\s+5\.0s/.test(result.output) &&
        /tests\/gamma\.test\.mjs\s+ok\s+2\.0s/.test(result.output));
  const order = ["alpha", "beta", "gamma"]
    .map((label) => result.output.indexOf("tests/" + label + ".test.mjs"));
  check("SEAM ON: the ordinary report ROWS still print in roster order "
        + "(alpha before beta before gamma) even though beta claims the "
        + "longest duration of the three - roster order is a property "
        + "of the print LOOP's own index, never of any arm's duration, "
        + "injected or real",
        order.every((index) => index >= 0)
          && order[0] < order[1] && order[1] < order[2]);
  const slowestLine = /slowest\s+(.+)/.exec(result.output);
  check("SEAM ON: the slowest line reads the EXACT injected figures in "
        + "the EXACT injected ranking - \"tests/beta.test.mjs 5.0s, "
        + "tests/gamma.test.mjs 2.0s, tests/alpha.test.mjs 0.1s\", not "
        + "an approximation",
        slowestLine !== null && slowestLine[1].trim() ===
          "tests/beta.test.mjs 5.0s, tests/gamma.test.mjs 2.0s, " +
          "tests/alpha.test.mjs 0.1s");
}

/* ================================================================== */
/* THE RULED DEFAULT, ARMED (fix wave 5, #460, review 5388869388,       */
/* finding F2, Prime's ruling: the reviewer's cheap remedy, ordered -   */
/* "one exact-value scenario in gate-budget's fixture, BINDER_GATE_POOL */
/* deleted, asserting the runner prints '(pool size 4)'. No clock,      */
/* mutation both ways."). Every other scenario in this file either SETS */
/* BINDER_GATE_POOL explicitly (to drive concurrency for its own        */
/* purpose) or, like roster-two-way's own fixture, deletes it without   */
/* reading what the runner then falls back to - so before this          */
/* scenario, nothing anywhere told the ruled fixed default (4) apart    */
/* from the retired one (this machine's own CPU count): a straight      */
/* revert of tests/run.mjs's DEFAULT_POOL back to `cpus().length`       */
/* passed every other check in this file green (F2's own evidence,      */
/* reproduced below in this file's own mutation record). This scenario  */
/* reads the runner's OWN printed wall-time line - "wall time  N.Ns     */
/* (pool size 4)" - an exact string match against the literal figure    */
/* 4, never a real measured duration: exact-value and un-flakable the   */
/* same way every other check in this file is, per the ruling's own     */
/* "no clock" instruction. `runFixture` already deletes BINDER_GATE_    */
/* POOL from the base environment before layering `env` on top (see     */
/* its own header above); this scenario's `env` does not set it either, */
/* so it reaches the runner genuinely absent. */

{
  const DEFAULT_POOL_ARMS = [["alpha", 100], ["beta", 50], ["gamma", 10]];
  const result = await scenario(DEFAULT_POOL_ARMS,
    { BINDER_GATE_TEST_DURATIONS_MS: "1" },
    fakeDurationArm);
  check("THE RULED DEFAULT: with BINDER_GATE_POOL absent from the child "
        + "env, the runner's own wall-time line reads pool size 4, the "
        + "ruled fixed default - never this machine's own CPU count",
        /\(pool size 4\)/.test(result.output));
}

/* ================================================================== */
/* THE BUDGET, BOTH MODES (re-fire #2, F1/F5, Prime's ruling            */
/* 2026-08-22): a forced, tiny budget against three arms that all pass  */
/* - SEAM ON but unused by any assertion here, since the fixture's arms */
/* take no real time either way, so a 0s budget is over budget          */
/* regardless of mode. What differs between the two scenarios below is  */
/* ONLY BINDER_GATE_ENFORCE_BUDGET - the CI-only lever - never a        */
/* real-timing margin.                                                  */

{
  const FAKE_ARMS = [["alpha", 100], ["beta", 50], ["gamma", 10]];
  const result = await scenario(FAKE_ARMS,
    { BINDER_GATE_TEST_DURATIONS_MS: "1", BINDER_GATE_POOL: "3",
      BINDER_GATE_BUDGET_SECONDS: "0", BINDER_GATE_ENFORCE_BUDGET: "1" },
    fakeDurationArm);
  check("ENFORCED: a forced 0s budget exits nonzero even though all "
        + "three arms passed, when BINDER_GATE_ENFORCE_BUDGET=1",
        result.code !== 0);
  check("ENFORCED: the red names OVER BUDGET",
        result.output.includes("OVER BUDGET"));
  check("ENFORCED: the summary counts it as a problem",
        /1 problem\(s\): over budget/.test(result.output));
  check("ENFORCED: BINDER_GATE_BUDGET_SECONDS is named as the remedy",
        result.output.includes("BINDER_GATE_BUDGET_SECONDS"));
}

{
  const FAKE_ARMS = [["alpha", 100], ["beta", 50], ["gamma", 10]];
  const result = await scenario(FAKE_ARMS,
    { BINDER_GATE_TEST_DURATIONS_MS: "1", BINDER_GATE_POOL: "3",
      BINDER_GATE_BUDGET_SECONDS: "0" },
    fakeDurationArm);
  check("ADVISORY (the local default, ENFORCE_BUDGET unset): the same "
        + "forced 0s budget still exits 0 - a locally over-budget run "
        + "is visible, never a red for a fact that might be nothing but "
        + "this one machine's own load",
        result.code === 0);
  check("ADVISORY: the line reads ADVISORY OVER BUDGET, never the bare "
        + "enforced OVER BUDGET: wording",
        result.output.includes("ADVISORY OVER BUDGET: this run took") &&
        !result.output.includes("\nOVER BUDGET: this run took"));
  check("ADVISORY: BINDER_GATE_ENFORCE_BUDGET is named as what turns "
        + "this same line into a red",
        result.output.includes("BINDER_GATE_ENFORCE_BUDGET"));
  check("ADVISORY: the summary still reports all green - advisory means "
        + "advisory, not a problem the count includes",
        /3 arm\(s\), all green\./.test(result.output));
}

/* ================================================================== */
/* RESTORE: the default budget (unset) does not red the same short      */
/* fixture, in EITHER mode - the two scenarios above's own restore,     */
/* proving OVER BUDGET/ADVISORY OVER BUDGET are real branches, not a    */
/* message that always prints regardless of whether the budget was      */
/* actually exceeded.                                                   */

{
  const FAKE_ARMS = [["alpha", 100], ["beta", 50], ["gamma", 10]];
  const result = await scenario(FAKE_ARMS,
    { BINDER_GATE_TEST_DURATIONS_MS: "1", BINDER_GATE_POOL: "3",
      BINDER_GATE_ENFORCE_BUDGET: "1" },
    fakeDurationArm);
  check("RESTORE (enforced mode): with no forced budget, the same "
        + "fixture exits 0", result.code === 0);
  check("RESTORE (enforced mode): neither OVER BUDGET line appears",
        !result.output.includes("OVER BUDGET"));
  check("RESTORE (enforced mode): the summary reports all green",
        /3 arm\(s\), all green\./.test(result.output));
}

{
  const FAKE_ARMS = [["alpha", 100], ["beta", 50], ["gamma", 10]];
  const result = await scenario(FAKE_ARMS,
    { BINDER_GATE_TEST_DURATIONS_MS: "1", BINDER_GATE_POOL: "3" },
    fakeDurationArm);
  check("RESTORE (advisory mode): with no forced budget, the same "
        + "fixture exits 0", result.code === 0);
  check("RESTORE (advisory mode): neither OVER BUDGET line appears",
        !result.output.includes("OVER BUDGET"));
  check("RESTORE (advisory mode): the summary reports all green",
        /3 arm\(s\), all green\./.test(result.output));
}

/* ================================================================== */
/* A failing arm mixed with passing ones under a real pool: roster      */
/* order, per-arm evidence and the summary all still have to be right   */
/* when one of the concurrently-running arms is the one that reds -     */
/* "each arm's output captured and printed whole in roster order" is    */
/* the ticket's own wording, and every other scenario here only ever    */
/* exercises the all-green path. No duration comparison anywhere below  */
/* - every assertion is text-content or exit-code, so SEAM ON/OFF makes */
/* no difference to what is proven; SEAM ON is used only for            */
/* consistency with the other fake-duration scenarios above.            */

{
  const MIXED_ARMS = [["alpha", 20], ["beta", 20, 1], ["gamma", 20]];
  const result = await scenario(MIXED_ARMS,
    { BINDER_GATE_TEST_DURATIONS_MS: "1", BINDER_GATE_POOL: "3" },
    fakeDurationArm);
  check("a roster with one failing arm exits nonzero", result.code !== 0);
  const order = ["alpha", "beta", "gamma"]
    .map((label) => result.output.indexOf("tests/" + label + ".test.mjs"));
  check("all three still appear, in roster order, beta's failure "
        + "included - the pool does not reorder or drop a neighbor of "
        + "the one that failed",
        order.every((index) => index >= 0)
          && order[0] < order[1] && order[1] < order[2]);
  check("beta's own result line says FAILED, not ok",
        /tests\/beta\.test\.mjs\s+FAILED\s+[\d.]+s/.test(result.output));
  check("the spilled block below it names beta's own exit code - a "
        + "SEPARATE line from the result line above, report() and "
        + "spill() being two different prints in tests/run.mjs",
        /--- tests\/beta\.test\.mjs, exit 1 -+/.test(result.output));
  check("beta's own printed line survives into the spilled output - "
        + "captured whole, not dropped for the arm that failed",
        result.output.includes("beta NOT OK"));
  check("alpha and gamma still report ok, despite running alongside a "
        + "failing neighbor in the same pool",
        /tests\/alpha\.test\.mjs\s+ok/.test(result.output)
          && /tests\/gamma\.test\.mjs\s+ok/.test(result.output));
  check("the summary counts exactly one problem, naming beta",
        /3 arm\(s\), 1 problem\(s\): tests\/beta\.test\.mjs/
          .test(result.output));
  check("the wall time and slowest lines still print despite the "
        + "failure - the budget stage runs whether or not an arm failed",
        /wall time\s+[\d.]+s/.test(result.output)
          && /slowest\s+/.test(result.output));
}

/* ================================================================== */
/* THE ONE SURVIVING REAL-TIMING SCENARIO (0.9-M3-S35 fix wave 1, #460, */
/* review comment 5379811881, originally "F3"; RE-MEASURED AND WIDENED */
/* at re-fire #2, Prime's ruling 2026-08-22): a HUNG arm - one that     */
/* never exits on its own - is killed by its own per-arm timeout, and   */
/* reds the gate NAMING the arm and the timeout, in seconds, rather     */
/* than hanging the whole run forever.                                  */
/*                                                                      */
/* REAL SLEEP, DELIBERATELY, THE ONE EXCEPTION THE RULING NAMES. This   */
/* scenario's own pass/fail DOES read a real measured wall time         */
/* (`result.ms`), which looks like exactly what the ruling refuses -    */
/* but what it proves is a fundamentally different property from every  */
/* other check in this file: whether killTree() actually terminated a   */
/* REAL hung process inside its timeout window, not how two fixture     */
/* arms' durations compare to each other. There is no way to fake a     */
/* real kill - the test-duration seam only overrides what a NUMBER a    */
/* passing arm's own report claims, it cannot make an unkilled process   */
/* appear killed.                                                       */
/*                                                                      */
/* RE-FIRE #2 FOUND THE OLD MARGIN WAS NOT ENOUGH (findings F1 and F3): */
/* a 2s per-arm timeout covered the fixture's OWN stub preflight too -  */
/* under 24 synthetic CPU spinners the reviewer's probe measured that   */
/* stub taking 5.8-8.4s, so the 2s deadline killed PREFLIGHT, not the   */
/* hung arm, and the scenario graded an arm that never ran. Two fixes,  */
/* both named in the ruling, and BOTH proven by this ONE scenario -     */
/* re-fire #2 is explicit that the exemption is a property of THIS      */
/* fixture, not a second real-timing scenario: (1) tests/run.mjs's own  */
/* preflight call now passes NO timeout at all (see its "PREFLIGHT IS   */
/* EXEMPT" comment) - this fixture is a byte-identical copy of that     */
/* file, so the exemption already covers a stub preflight with no       */
/* separate code here; (2) the fixture's own per-arm timeout is raised  */
/* to the ruling's floor of 30s against a 600s sleeper. SLOW_PREFLIGHT   */
/* below deliberately sleeps 32s - just PAST the 30s timeout - so this   */
/* single scenario proves BOTH properties at once with no numeric        */
/* margin anywhere but the one the ruling names: under the OLD bug (the  */
/* timeout governing preflight too), a 32s preflight sleep against a 30s */
/* timeout would have killed PREFLIGHT ITSELF at ~30s, and the gate      */
/* would have printed "preflight is red, so no arm ran" - never reaching */
/* the hung arm at all, so none of the TIMED-OUT/hung.test.mjs checks    */
/* below could ever pass. Every one of them passing is only possible if  */
/* preflight survived its own sleep well past the timeout that would     */
/* have killed an arm running that long - which is exactly what          */
/* "exempt" means. The outer safetyTimeoutMs backstop (150s) is, as       */
/* before, insurance against a genuine regression that removed the kill  */
/* entirely - never the thing under test, and comfortably above the      */
/* ~62s (32s preflight + ~30s to kill the arm) this scenario actually     */
/* takes on a correct build. */

{
  const SLOW_PREFLIGHT =
    "await new Promise((r) => setTimeout(r, 32000));\n" +
    "console.log(\"initialized: CI path (deliberately slow stub, past " +
    "the 30s per-arm timeout, proving preflight is exempt from it - " +
    "re-fire #2, F1/F3)\");\nprocess.exit(0);\n";
  const HUNG_ARMS = [["hung", 600000]];
  const result = await scenario(HUNG_ARMS,
    { BINDER_GATE_POOL: "1", BINDER_ARM_TIMEOUT_SECONDS: "30" },
    sleepArm, 150000, SLOW_PREFLIGHT);
  check("this scenario's own measured wall time shows the arm was "
        + "actually killed well before its own 600s sleep could finish "
        + "- took " + (result.ms / 1000).toFixed(1) + "s total "
        + "(32s of that is the fixture's own deliberately slow "
        + "preflight, which is supposed to run to completion - see "
        + "the PREFLIGHT EXEMPTION check below)",
        result.ms < 90000);
  check("a hung arm reds the gate", result.code !== 0);
  check("the red names the arm and TIMED OUT",
        /TIMED OUT: tests\/hung\.test\.mjs/.test(result.output));
  check("the red states the timeout in seconds and names the override "
        + "lever",
        result.output.includes("its 30s per-arm timeout") &&
        result.output.includes("BINDER_ARM_TIMEOUT_SECONDS"));
  check("the summary counts exactly one problem, naming the arm and "
        + "the timeout",
        /1 problem\(s\): tests\/hung\.test\.mjs \(timed out after 30s\)/
          .test(result.output));
  check("PREFLIGHT EXEMPTION (re-fire #2, F1/F3), proven WITHOUT a "
        + "second real-timing scenario - the same fixture's own stub "
        + "preflight (built above with SLOW_PREFLIGHT) deliberately "
        + "sleeps LONGER than the 30s per-arm timeout before succeeding; "
        + "every check above already required tests/hung.test.mjs's own "
        + "TIMED OUT text to appear, which is only reachable if "
        + "preflight survived its own 32s sleep FAR past the 30s "
        + "timeout that would have killed an arm taking that long - "
        + "under the old bug (the timeout governing preflight too) "
        + "preflight itself would have been killed at ~30s and the gate "
        + "would have printed 'preflight is red, so no arm ran' "
        + "instead, which none of the checks above would have matched",
        !result.output.includes("preflight is red"));
}

/* ------------------------------------------------------------------ */
for (const root of roots) await rm(root, { recursive: true, force: true });

const EXPECTED = 39;
console.log(failures
  ? `\ngate-budget FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\ngate-budget ran ${performed} checks, expected ${EXPECTED}`
    : `\ngate-budget OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
