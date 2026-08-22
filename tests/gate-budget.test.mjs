/*
 * tests/run.mjs's own pool, ordering, wall-time and budget printing
 * (0.9-M3-S35, #460), armed at the INTEGRATION level - a fixture roster
 * of fake arms with KNOWN durations, run through the REAL runner and
 * gate-pool.mjs, not a reimplementation of either. tests/gate-pool.
 * test.mjs already proves runPool()'s own ordering and concurrency
 * contract as a unit; this file proves the same properties show up
 * correctly once tests/run.mjs is printing arm names, a wall-time line
 * and a budget verdict around it - "prints in order with the right
 * total", the ticket's own Apparatus wording.
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
   and exits 0. `label` is embedded in the printed line so a scenario
   can confirm PRINTED ORDER by searching for each label's position in
   the combined output, the same evidence a human reading the real
   gate's log would have. */
const sleepArm = (label, ms) =>
  "await new Promise((r) => setTimeout(r, " + ms + "));\n" +
  "console.log(\"" + label + " OK\");\nprocess.exit(0);\n";

/* Builds <tmp>/tests/ holding the real run.mjs and gate-pool.mjs, the
   stub preflight, a ROSTER naming every given arm as required, and one
   sleeping fixture arm per [label, ms] pair. Returns the scratch root
   so the caller can clean it up. */
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
  for (const [label, ms] of arms) {
    await writeFile(join(testsDir, label + ".test.mjs"), sleepArm(label, ms));
  }
  return root;
}

/* Runs the fixture's copy of the runner with the given extra
   environment variables layered over this process' own - stdout and
   stderr combined, the same way tests/run.mjs's own runFile reads its
   arms - and returns { code, output, ms }: `ms` is THIS CALL's own
   measured wall time, an independent cross-check against the runner's
   own printed "wall time" line rather than trusting that line to grade
   itself. */
function runFixture(root, env) {
  const started = Date.now();
  const done = spawnSync(process.execPath, [join(root, "tests", "run.mjs")], {
    encoding: "utf8", env: Object.assign({}, process.env, env || {}),
  });
  return {
    code: done.status,
    output: (done.stdout || "") + (done.stderr || ""),
    ms: Date.now() - started,
  };
}

const roots = [];
async function scenario(arms, env) {
  const root = await buildFixture(arms);
  roots.push(root);
  return runFixture(root, env);
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
   (300ms) but sorts FIRST; "gamma" is the FASTEST (60ms) but sorts
   LAST. Under any real pool they finish in roughly reverse-alphabetical
   order; discovery's own sort (tests/run.mjs's `everyFile`) still walks
   them alpha, beta, gamma. */
const THREE_ARMS = [["alpha", 300], ["beta", 180], ["gamma", 60]];
const SUM_MS = 300 + 180 + 60;

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

/* ------------------------------------------------------------------ */
for (const root of roots) await rm(root, { recursive: true, force: true });

const EXPECTED = 17;
console.log(failures
  ? `\ngate-budget FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\ngate-budget ran ${performed} checks, expected ${EXPECTED}`
    : `\ngate-budget OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
