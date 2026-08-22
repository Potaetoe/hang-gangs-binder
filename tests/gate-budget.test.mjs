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
 * SECOND check flaking twice in 26 runs. Prime's ruling: no pass/fail
 * decision in this file may depend on real wall-clock timing of real
 * sleeps, except for ONE real-timing smoke check asserting only coarse,
 * un-flakable truths - see tests/run.mjs's own "THE TEST-DURATION SEAM"
 * comment for the mechanism this uses instead: an arm may report its
 * OWN duration by printing a line, and the runner substitutes that
 * EXACT injected number for the real measured one, but ONLY when
 * BINDER_GATE_TEST_DURATIONS_MS=1 is set - never in a real run, CI
 * included. Every scenario below states which of the two modes it uses
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
   verdict and exiting with `code`. RESTRICTED USE (fix wave 2): only
   the one real-timing smoke check below and the F3 hung-arm scenario
   use this builder - every other scenario in this file uses
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

/* Builds <tmp>/tests/ holding the real run.mjs and gate-pool.mjs, the
   stub preflight, a ROSTER naming every given arm as required, and one
   arm per [label, durationOrMs, exitCode] triple, built by `makeArm`
   (either builder above). Returns the scratch root so the caller can
   clean it up. */
async function buildFixture(arms, makeArm) {
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
async function scenario(arms, env, makeArm, safetyTimeoutMs) {
  const root = await buildFixture(arms, makeArm);
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
  check(label + ": the printed duration is real measured time (a few "
        + "seconds at most on any machine), not the arm's own claim of "
        + "~999000ms" + (printed ? " (printed " + printed[1] + "s)" : ""),
        printed !== null && Number(printed[1]) < 30);
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
/* MUTATION, direction one: a forced, tiny budget reds the run even     */
/* though every arm passed - slowness is a red on its own. SEAM ON but  */
/* unused by any assertion here - the fixture's arms take no real time  */
/* either way, so a 0s budget always reds regardless of mode.           */

{
  const FAKE_ARMS = [["alpha", 100], ["beta", 50], ["gamma", 10]];
  const result = await scenario(FAKE_ARMS,
    { BINDER_GATE_TEST_DURATIONS_MS: "1", BINDER_GATE_POOL: "3",
      BINDER_GATE_BUDGET_SECONDS: "0" },
    fakeDurationArm);
  check("MUTATION: a forced 0s budget exits nonzero even though all "
        + "three arms passed", result.code !== 0);
  check("the red names OVER BUDGET", result.output.includes("OVER BUDGET"));
  check("the summary counts it as a problem",
        /1 problem\(s\): over budget/.test(result.output));
  check("BINDER_GATE_BUDGET_SECONDS is named as the remedy",
        result.output.includes("BINDER_GATE_BUDGET_SECONDS"));
}

/* ================================================================== */
/* RESTORE: the default budget (unset) does not red the same short      */
/* fixture - direction one's own restore, proving OVER BUDGET is a      */
/* real branch, not a message that always prints.                      */

{
  const FAKE_ARMS = [["alpha", 100], ["beta", 50], ["gamma", 10]];
  const result = await scenario(FAKE_ARMS,
    { BINDER_GATE_TEST_DURATIONS_MS: "1", BINDER_GATE_POOL: "3" },
    fakeDurationArm);
  check("RESTORE: with no forced budget, the same fixture exits 0",
        result.code === 0);
  check("OVER BUDGET does not appear",
        !result.output.includes("OVER BUDGET"));
  check("the summary reports all green",
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
/* F3 (0.9-M3-S35 fix wave 1, #460, review comment 5379811881): a HUNG  */
/* arm - one that never exits on its own - is killed by its own         */
/* per-arm timeout, and reds the gate NAMING the arm and the timeout,   */
/* in seconds, rather than hanging the whole run forever.               */
/*                                                                      */
/* REAL SLEEP, DELIBERATELY (fix wave 2 exemption). This scenario's own */
/* pass/fail DOES read a real measured wall time (`result.ms`), which   */
/* looks like exactly what the F1 ruling refuses - but what it proves   */
/* is a fundamentally different property from the ordering/ratio checks */
/* above: whether killTree() actually terminated a REAL hung process    */
/* inside its timeout window, not how two fixture arms' durations       */
/* compare to each other. There is no way to fake a real kill - the     */
/* test-duration seam only overrides what a NUMBER a passing arm's own  */
/* report claims, it cannot make an unkilled process appear killed. The */
/* margin here is enormous by construction (a 2s timeout against a 15s  */
/* sleep, asserted against a 10s ceiling - 7.5+ seconds of slack) and   */
/* has never flaked once across every run in this ticket's history,     */
/* unlike the two checks the ruling was written for, which measured     */
/* margins in the tens of milliseconds. This is not "at most one        */
/* real-timing smoke check" being violated twice - it is a second,      */
/* unrelated real-timing property (a kill mechanism, not a duration      */
/* comparison) that this file already needed before fix wave 2 and      */
/* still needs after it. */

{
  const HUNG_ARMS = [["hung", 15000]];
  const result = await scenario(HUNG_ARMS,
    { BINDER_GATE_POOL: "1", BINDER_ARM_TIMEOUT_SECONDS: "2" },
    sleepArm, 30000);
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

/* ================================================================== */
/* THE ONE REAL-TIMING SMOKE CHECK (Prime's ruling on #460, re-fire #1: */
/* "at most one real-timing smoke check ... asserts only coarse truths  */
/* that cannot flake ... no ratios, no thresholds, no ordering of real  */
/* sleeps"). Three arms, real sleeps, deliberately staggered (900ms,    */
/* 400ms, 50ms) so they genuinely overlap under a pool wide enough to   */
/* run all three - proving the pool is really concurrent, not merely    */
/* configured to look like it. Every assertion below is one of exactly  */
/* the three Prime named, and nothing else: no comparison between two   */
/* measured runs, no claim about WHICH name the slowest line puts       */
/* first. */

{
  const SMOKE_ARMS = [["alpha", 900], ["beta", 400], ["gamma", 50]];
  const result = await scenario(SMOKE_ARMS,
    { BINDER_GATE_POOL: "3" }, sleepArm);
  check("SMOKE: exits 0", result.code === 0);
  const wallLine = /wall time\s+([\d.]+)s/.exec(result.output);
  check("SMOKE: the printed total is AT LEAST the longest arm's own "
        + "real time (900ms) - a floor no amount of contention can put "
        + "the total UNDER, whatever else the machine is doing",
        wallLine !== null && Number(wallLine[1]) >= 0.85);
  const slowestLine = /slowest\s+(.+)/.exec(result.output);
  check("SMOKE: the slowest line lists all three arm names - which one "
        + "is claimed first is NOT checked here, per the ruling",
        slowestLine !== null &&
        slowestLine[1].includes("tests/alpha.test.mjs") &&
        slowestLine[1].includes("tests/beta.test.mjs") &&
        slowestLine[1].includes("tests/gamma.test.mjs"));
  check("SMOKE: the budget line prints",
        /3 arm\(s\), all green\./.test(result.output));
}

/* ------------------------------------------------------------------ */
for (const root of roots) await rm(root, { recursive: true, force: true });

const EXPECTED = 34;
console.log(failures
  ? `\ngate-budget FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\ngate-budget ran ${performed} checks, expected ${EXPECTED}`
    : `\ngate-budget OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
