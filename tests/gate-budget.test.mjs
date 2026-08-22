/*
 * tests/run.mjs's own pool, ordering, wall-time, budget and per-arm-
 * timeout printing (0.9-M3-S35, #460, plus its fix wave 1), armed at the
 * INTEGRATION level - a fixture roster of fake arms with KNOWN durations,
 * run through the REAL runner and gate-pool.mjs, not a reimplementation
 * of either. tests/gate-pool.test.mjs already proves runPool()'s own
 * ordering and concurrency contract as a unit; this file proves the same
 * properties show up correctly once tests/run.mjs is printing arm names,
 * a wall-time line and a budget verdict around it - "prints in order
 * with the right total", the ticket's own Apparatus wording - and, since
 * fix wave 1 (review comment 5379811881, F3), that a hung arm is killed
 * and named rather than left to hang the gate forever.
 *
 *     node tests/gate-budget.test.mjs
 *
 * HOW IT PROVES IT WITHOUT TOUCHING THE REAL GATE - the same technique
 * tests/roster-two-way.test.mjs uses and explains in its own header: a
 * byte-identical copy of run.mjs and gate-pool.mjs, run from an isolated
 * scratch "tests/" directory this file controls completely, with a stub
 * preflight standing in for worktree hygiene (proven elsewhere). The
 * fixture arms here are not one-line stubs, unlike that file's - each
 * SLEEPS a known number of milliseconds before printing its verdict, so
 * the wall time this file gets back is a real, measurable fact about
 * concurrency rather than a value nothing produced.
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

/* A fixture arm that sleeps `ms` - a real, measurable delay, not a
   value this file merely asserts about - then prints its own verdict
   and exits with `code` (0 unless a third element says otherwise).
   `label` is embedded in the printed line so a scenario can confirm
   PRINTED ORDER by searching for each label's position in the combined
   output, the same evidence a human reading the real gate's log would
   have. A failing arm still prints its own line before exiting nonzero
   - `spill()` in the real runner reads that line back out of the
   captured output, and scenario 6 below checks it is still there. */
const sleepArm = (label, ms, code) =>
  "await new Promise((r) => setTimeout(r, " + ms + "));\n" +
  "console.log(\"" + label + (code ? " NOT OK" : " OK") + "\");\n" +
  "process.exit(" + (code || 0) + ");\n";

/* Builds <tmp>/tests/ holding the real run.mjs and gate-pool.mjs, the
   stub preflight, a ROSTER naming every given arm as required, and one
   sleeping fixture arm per [label, ms] or [label, ms, exitCode] triple.
   Returns the scratch root so the caller can clean it up. */
async function buildFixture(arms) {
  const root = await mkdtemp(join(tmpdir(), "hgb-gate-budget-"));
  const testsDir = join(root, "tests");
  await mkdir(testsDir);
  await writeFile(join(testsDir, "run.mjs"), REAL_RUNNER);
  await writeFile(join(testsDir, "gate-pool.mjs"), REAL_GATE_POOL);
  await writeFile(join(testsDir, "preflight.mjs"), STUB_PREFLIGHT);
  const rosterText = arms
    .map(([label]) => "tests/" + label + ".test.mjs\n").join("");
  await writeFile(join(testsDir, "ROSTER"), rosterText);
  for (const [label, ms, code] of arms) {
    await writeFile(join(testsDir, label + ".test.mjs"),
      sleepArm(label, ms, code));
  }
  return root;
}

/* Runs the fixture's copy of the runner with the given extra
   environment variables layered over this process' own - stdout and
   stderr combined, the same way tests/run.mjs's own runFile reads its
   arms - and returns { code, output, ms }: `ms` is THIS CALL's own
   measured wall time, an independent cross-check against the runner's
   own printed "wall time" line rather than trusting that line to grade
   itself.

   The two levers `tests/run.mjs` itself reads are deleted from the base
   environment FIRST, then `env`'s own choices applied on top - not
   `Object.assign({}, process.env, env)` alone. Without the delete, a
   scenario that wants the DEFAULT (the "RESTORE" ones below) silently
   inherits whatever this OUTER process happens to have set for either
   variable - which is exactly what happened running this file's own
   "RESTORE" checks by hand with BINDER_GATE_BUDGET_SECONDS=1 set in the
   shell to drive a different mutation: the fixture read the outer
   value, not the absence this scenario asked for, and reported OVER
   BUDGET where it should not have. A scenario that WANTS a lever unset
   passes nothing for it in `env`, and gets a genuinely absent variable
   rather than an inherited one. */
function runFixture(root, env, safetyTimeoutMs) {
  const started = Date.now();
  const base = Object.assign({}, process.env);
  delete base.BINDER_GATE_POOL;
  delete base.BINDER_GATE_BUDGET_SECONDS;
  // F3 fix wave 1 (#460): a third lever, cleared the same way the first
  // two are, for the same reason - a scenario testing the DEFAULT timeout
  // must not silently inherit whatever this outer process happens to
  // have set.
  delete base.BINDER_ARM_TIMEOUT_SECONDS;
  const options = {
    encoding: "utf8", env: Object.assign(base, env || {}),
  };
  // `safetyTimeoutMs` is a HARD OUTER BACKSTOP, never the thing under
  // test: scenario 7 below tests tests/run.mjs's OWN per-arm timeout
  // (BINDER_ARM_TIMEOUT_SECONDS, seconds), which this file always sets
  // small enough that the real feature fires first. This is only insurance
  // against a genuine regression that removed the feature entirely -
  // without it, a broken build would hang this fixture (and so this
  // whole gate) for as long as the fixture's own hung arm sleeps, rather
  // than failing loudly in seconds. Every other scenario passes nothing
  // here and keeps the unbounded wait it always had.
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
async function scenario(arms, env, safetyTimeoutMs) {
  const root = await buildFixture(arms);
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

/* Three arms, deliberately built so pooled concurrency and printed
   order are DISTINGUISHABLE from each other: "alpha" is the SLOWEST
   (2000ms) but sorts FIRST; "gamma" is the FASTEST (100ms) but sorts
   LAST. Under any real pool they finish in roughly reverse-alphabetical
   order; discovery's own sort (tests/run.mjs's `everyFile`) still walks
   them alpha, beta, gamma.

   F1 fix wave 1 (#460, review comment 5379811881): these were 300/180/60
   - 120ms apart - and the "slowest line names alpha before beta before
   gamma" check below sorts on `runFile()`'s own `ms`, which starts
   BEFORE `spawn()` and so includes node's process start-up. Under a
   12-wide pool competing with the reaper suite's own git storm, that
   start-up jitter routinely exceeded 120ms - the reviewer's own 46-run
   probe caught beta and gamma landing in the same 0.1s printed bucket
   twice - so gamma (fastest sleep, slowest name) could measure slower
   than beta and invert the "slowest" line's order. That is a genuine
   flake in THIS FIXTURE's margin, not in the pool or the runner: the
   ordering property is real, but 120ms of designed gap is smaller than
   the noise a real, loaded machine adds on top of a real sleep. The fix
   is not a tighter assertion - it is gaps (900ms, 1700ms) far past any
   spawn jitter measured anywhere in this ticket's own numbers (the
   worst observed was under 150ms), so an inversion is no longer
   possible without the machine falling over entirely. This is the SAME
   CLASS of defect this file's own wall-time check already hit once
   (the fixed-millisecond ceiling that flaked and was rewritten as a
   ratio, described in the block below) - that rewrite fixed the
   wall-time check's margin and left this ordering check with the
   original, too-tight one; this is the second half of the same fix,
   applied to the check the first pass did not touch. */
const THREE_ARMS = [["alpha", 2000], ["beta", 800], ["gamma", 100]];
const SUM_MS = 2000 + 800 + 100;

/* ================================================================== */
/* 1. Printed order matches roster/discovery order, not finish order,   */
/*    under a real pool wide enough to overlap all three.               */

{
  const result = await scenario(THREE_ARMS, { BINDER_GATE_POOL: "3" });
  check("a fixture roster of three known-duration arms exits 0 under "
        + "a pool wide enough to run all three at once", result.code === 0);
  const order = ["alpha", "beta", "gamma"]
    .map((label) => result.output.indexOf("tests/" + label + ".test.mjs"));
  check("all three arm names appear in the output",
        order.every((index) => index >= 0));
  check("PRINTED in roster order (alpha before beta before gamma) even "
        + "though gamma - the fastest, sorted last - finishes first "
        + "under the pool",
        order[0] < order[1] && order[1] < order[2]);
}

/* ================================================================== */
/* 2 & 3. THE RIGHT TOTAL, and MUTATION direction one, together: pool    */
/*    size 1 restores AT LEAST the sequential sum (a floor sequential    */
/*    execution can never beat, however busy the machine is), and a     */
/*    pool of 3 is measured against THAT SAME RUN's own pool-of-1        */
/*    figure - a RATIO, not a fixed millisecond ceiling.                 */
/*                                                                        */
/*    A fixed ceiling ("pool 3 must finish under 450ms") is exactly the  */
/*    kind of assertion this ticket's own pool exists to stop needing:   */
/*    this fixture is itself one of 35 arms the real gate runs           */
/*    CONCURRENTLY, on a machine other builders share, so its own        */
/*    absolute wall time is not something an idle-machine number can     */
/*    promise (measured: 0.4s alone, 0.8s as one arm among the pool -    */
/*    a real gate run, not a flake). The ratio between two measurements  */
/*    taken back to back under the SAME contention is the stable         */
/*    signal: whatever the machine's mood, three tasks overlapped are    */
/*    reliably well under three tasks serialized.                        */

let pool1Wall;
{
  const result = await scenario(THREE_ARMS, { BINDER_GATE_POOL: "1" });
  check("pool size 1 exits 0", result.code === 0);
  const printed = /wall time\s+([\d.]+)s/.exec(result.output);
  pool1Wall = printed ? Number(printed[1]) : NaN;
  check("MUTATION: pool size 1 takes AT LEAST the arms' " + SUM_MS +
    "ms sequential sum (printed " + (printed && printed[1]) + "s) - " +
    "sequential execution has a floor contention can only push past, " +
    "never under, so this bound holds whatever else the machine is " +
    "doing right now",
    Number.isFinite(pool1Wall) && pool1Wall >= SUM_MS / 1000 - 0.05);
  check("pool size 1 is named in its own wall-time line",
    result.output.includes("pool size 1"));
}

{
  const result = await scenario(THREE_ARMS, { BINDER_GATE_POOL: "3" });
  check("a fixture roster of three known-duration arms exits 0 under "
        + "a pool wide enough to run all three at once", result.code === 0);
  const printed = /wall time\s+([\d.]+)s/.exec(result.output);
  check("the runner prints a wall time line", printed !== null);
  const pool3Wall = printed ? Number(printed[1]) : NaN;
  check("THE RIGHT TOTAL: a pool of 3 finishes in well under three "
        + "quarters of THIS SAME test's own pool-of-1 figure (pool 3: "
        + (printed && printed[1]) + "s, pool 1: " + pool1Wall + "s)",
        Number.isFinite(pool3Wall) && Number.isFinite(pool1Wall)
          && pool3Wall < pool1Wall * 0.75);
  check("the slowest line names alpha before beta before gamma - "
        + "true duration order, independent of finish order or print "
        + "order",
        (() => {
          const line = /slowest\s+(.+)/.exec(result.output);
          if (!line) return false;
          const names = line[1];
          return names.indexOf("alpha") < names.indexOf("beta")
            && names.indexOf("beta") < names.indexOf("gamma");
        })());
}

/* ================================================================== */
/* 4. MUTATION, direction two: a forced, tiny budget reds the run even  */
/*    though every arm passed - slowness is a red on its own.           */

{
  const result = await scenario(THREE_ARMS,
    { BINDER_GATE_POOL: "3", BINDER_GATE_BUDGET_SECONDS: "0" });
  check("MUTATION: a forced 0s budget exits nonzero even though all "
        + "three arms passed", result.code !== 0);
  check("the red names OVER BUDGET", result.output.includes("OVER BUDGET"));
  check("the summary counts it as a problem",
        /1 problem\(s\): over budget/.test(result.output));
  check("BINDER_GATE_BUDGET_SECONDS is named as the remedy",
        result.output.includes("BINDER_GATE_BUDGET_SECONDS"));
}

/* ================================================================== */
/* 5. RESTORE: the default budget (unset) does not red the same short   */
/*    fixture - direction two's own restore, proving OVER BUDGET is a   */
/*    real branch, not a message that always prints.                    */

{
  const result = await scenario(THREE_ARMS, { BINDER_GATE_POOL: "3" });
  check("RESTORE: with no forced budget, the same fixture exits 0",
        result.code === 0);
  check("OVER BUDGET does not appear",
        !result.output.includes("OVER BUDGET"));
  check("the summary reports all green",
        /3 arm\(s\), all green\./.test(result.output));
}

/* ================================================================== */
/* 6. A failing arm mixed with passing ones under a real pool: roster   */
/*    order, per-arm evidence and the summary all still have to be      */
/*    right when one of the concurrently-running arms is the one that   */
/*    reds - "each arm's output captured and printed whole in roster    */
/*    order" is the ticket's own wording, and every other scenario here */
/*    only ever exercises the all-green path.                           */

{
  const MIXED_ARMS = [["alpha", 200], ["beta", 120, 1], ["gamma", 60]];
  const result = await scenario(MIXED_ARMS, { BINDER_GATE_POOL: "3" });
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
/* 7. F3 fix wave 1 (#460, review comment 5379811881): a HUNG arm - one */
/*    that never exits on its own - is killed by its own per-arm       */
/*    timeout, and reds the gate NAMING the arm and the timeout, in    */
/*    seconds, rather than hanging the whole run forever.              */
/*                                                                      */
/*    The fixture arm sleeps 15s; BINDER_ARM_TIMEOUT_SECONDS is forced */
/*    to 2s. A WORKING timeout kills the arm at ~2s, so this whole      */
/*    scenario - which waits for tests/run.mjs itself to exit - takes   */
/*    a few seconds, nowhere near 15s. A timeout that silently did      */
/*    nothing (the exact regression this proves against) would make    */
/*    this scenario take the full 15s instead - an OBSERVABLE          */
/*    difference in this scenario's own measured wall time, not only   */
/*    a different exit code, which is why `runFixture`'s `ms` is        */
/*    checked here and nowhere else in this file. `safetyTimeoutMs`     */
/*    (30s) is pure insurance against a genuine regression hanging      */
/*    this fixture, and this file's own wall time, indefinitely -       */
/*    every assertion below still runs against the 15s-vs-~2s gap,      */
/*    never against the 30s backstop.                                  */

{
  const HUNG_ARMS = [["hung", 15000]];
  const result = await scenario(HUNG_ARMS,
    { BINDER_GATE_POOL: "1", BINDER_ARM_TIMEOUT_SECONDS: "2" }, 30000);
  check("F3: this scenario's own measured wall time shows the arm was "
        + "actually killed early, not merely reported as timed out - "
        + "took " + (result.ms / 1000).toFixed(1) + "s against a 15s "
        + "sleep and a 2s per-arm timeout",
        result.ms < 10000);
  check("F3: a hung arm reds the gate", result.code !== 0);
  check("F3: the red names the arm and TIMED OUT",
        /TIMED OUT: tests\/hung\.test\.mjs/.test(result.output));
  check("F3: the red states the timeout in seconds and names the "
        + "override lever",
        result.output.includes("its 2s per-arm timeout") &&
        result.output.includes("BINDER_ARM_TIMEOUT_SECONDS"));
  check("F3: the summary counts exactly one problem, naming the arm "
        + "and the timeout",
        /1 problem\(s\): tests\/hung\.test\.mjs \(timed out after 2s\)/
          .test(result.output));
}

/* ------------------------------------------------------------------ */
for (const root of roots) await rm(root, { recursive: true, force: true });

const EXPECTED = 30;
console.log(failures
  ? `\ngate-budget FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\ngate-budget ran ${performed} checks, expected ${EXPECTED}`
    : `\ngate-budget OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
