/*
 * Contract checks for gate-pool.mjs's runPool() - the concurrency-
 * limited scheduler tests/run.mjs now runs every arm through (0.9-M3-
 * S35, #460). This is the fixture roster of fake, known-duration tasks
 * the ticket asks for: real Promises with a real `setTimeout` delay,
 * never a spawned process, because the property under test - "the
 * returned order matches input order, not finish order, and a pool of
 * size N genuinely overlaps N tasks rather than serializing them" - is
 * a property of the scheduler itself, independent of what a task does.
 *
 *     node tests/gate-pool.test.mjs
 */
import { runPool } from "./gate-pool.mjs";

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) {
    failures += 1;
    console.log("FAIL  " + label);
  } else {
    console.log("ok    " + label);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* A task that sleeps `ms`, records when it FINISHED into the shared
   `finishOrder` array (proving real overlap: a shorter sleep started
   later can still finish first), and returns its own identity so the
   result array can be checked against INPUT position rather than
   finish position. */
function timedTask(id, ms, finishOrder) {
  return async () => {
    await sleep(ms);
    finishOrder.push(id);
    return { id, ms };
  };
}

console.log("--- results come back in input order, not finish order ---");
{
  // Descending delays: task 0 is the SLOWEST, task 2 the FASTEST - if
  // the pool merely returned things in the order they settled, this
  // would come back [2, 1, 0]. runPool's contract is that it never
  // does, whatever order the tasks actually finish in.
  const finishOrder = [];
  const tasks = [
    timedTask(0, 150, finishOrder),
    timedTask(1, 80, finishOrder),
    timedTask(2, 20, finishOrder),
  ];
  const results = await runPool(tasks, 3);
  check("three results came back for three tasks", results.length === 3);
  check("result[0] is task 0's own result, not whichever finished first",
        results[0] && results[0].id === 0);
  check("result[1] is task 1's own result", results[1] && results[1].id === 1);
  check("result[2] is task 2's own result", results[2] && results[2].id === 2);
  check("THE TASKS ACTUALLY FINISHED OUT OF INPUT ORDER - proving the "
        + "ordered result above is the pool's own doing, not an accident "
        + "of these tasks happening to finish in input order anyway",
        finishOrder.join(",") !== "0,1,2" &&
        finishOrder[finishOrder.length - 1] === 0);
}

console.log("\n--- a pool of size N overlaps N tasks, not one at a time ---");
{
  // Three 150ms tasks. Run one at a time, this is >= 450ms; run three
  // at once, this is close to 150ms. A wide, one-sided tolerance
  // (250ms) absorbs scheduler jitter on a loaded machine without
  // hiding a regression to serial execution, which would land north of
  // 450ms.
  const finishOrder = [];
  const tasks = [
    timedTask(0, 150, finishOrder),
    timedTask(1, 150, finishOrder),
    timedTask(2, 150, finishOrder),
  ];
  const started = Date.now();
  await runPool(tasks, 3);
  const elapsedMs = Date.now() - started;
  check("three 150ms tasks at concurrency 3 finish in well under their "
        + "150*3=450ms sequential sum (took " + elapsedMs + "ms)",
        elapsedMs < 400);
}

console.log("\n--- pool size 1 is genuinely sequential - the old wall "
            + "time, restored by mutation ---");
{
  // The direct mutation the ticket asks for: pool size 1 restores the
  // wall time the un-pooled runner used to pay. Same three 150ms tasks,
  // concurrency forced to 1.
  const finishOrder = [];
  const tasks = [
    timedTask(0, 150, finishOrder),
    timedTask(1, 150, finishOrder),
    timedTask(2, 150, finishOrder),
  ];
  const started = Date.now();
  const results = await runPool(tasks, 1);
  const elapsedMs = Date.now() - started;
  check("concurrency 1 takes at least the sum of the delays (took "
        + elapsedMs + "ms, sum is 450ms)", elapsedMs >= 440);
  check("finish order equals input order when nothing overlaps",
        finishOrder.join(",") === "0,1,2");
  check("results are still in input order at concurrency 1 too",
        results.map((r) => r.id).join(",") === "0,1,2");
}

console.log("\n--- edge shapes: empty, one task, more workers than tasks, "
            + "a bad concurrency argument ---");
{
  const empty = await runPool([], 4);
  check("an empty task list resolves to an empty result array, not a "
        + "hang or a throw", Array.isArray(empty) && empty.length === 0);

  const finishOrder = [];
  const one = await runPool([timedTask("solo", 10, finishOrder)], 4);
  check("a pool larger than the task list still runs the one task",
        one.length === 1 && one[0].id === "solo");

  const zeroFinish = [];
  const zeroConcurrency = await runPool(
    [timedTask("a", 5, zeroFinish), timedTask("b", 5, zeroFinish)], 0);
  check("concurrency 0 still runs every task (at least one worker), "
        + "rather than silently completing nothing",
        zeroConcurrency.length === 2 && zeroFinish.length === 2);

  const negFinish = [];
  const negativeConcurrency = await runPool(
    [timedTask("c", 5, negFinish)], -3);
  check("a negative concurrency argument still runs its task the same "
        + "way",
        negativeConcurrency.length === 1 && negFinish.length === 1);
}

console.log("\n--- a task's own rejection propagates out of runPool() "
            + "---");
{
  // gate-pool.mjs itself never wraps a task in a try/catch - runFile()
  // in tests/run.mjs never rejects (every failure path there resolves
  // with a code), so the pool has never needed to catch one. This arm
  // pins the actual, honest behavior (a rejection propagates out of
  // runPool() itself) rather than asserting a swallow-and-continue
  // contract nothing here implements - AGENTS.md's own rule against a
  // comment that claims a property no test enforces applies to a
  // README-shaped assertion here just as much as to a code comment.
  const finishOrder = [];
  const tasks = [
    timedTask(0, 10, finishOrder),
    async () => { throw new Error("task 1 exploded"); },
    timedTask(2, 10, finishOrder),
  ];
  let threw = null;
  try {
    await runPool(tasks, 3);
  } catch (error) {
    threw = error;
  }
  check("a throwing task's rejection propagates out of runPool() rather "
        + "than being silently swallowed",
        threw !== null && threw.message === "task 1 exploded");
}

console.log("\n" + performed + " checks, " + failures + " failure(s)");
process.exit(failures ? 1 : 0);
