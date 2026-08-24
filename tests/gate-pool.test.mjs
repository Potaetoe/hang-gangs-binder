/*
 * Contract checks for gate-pool.mjs's runPool() - the concurrency-
 * limited scheduler tests/run.mjs now runs every arm through (0.9-M3-
 * S35, #460).
 *
 * RE-FIRE #2 (#460, Prime's ruling 2026-08-22, "the class is closed
 * whole this time" - no arm in this file may decide pass/fail on real
 * wall-clock timing): the "pool of size N overlaps N tasks" check below
 * used to compare a REAL measured elapsed time for three 150ms tasks
 * against a fixed 400ms ceiling, and it reded 1 run in 8 under 24
 * synthetic CPU spinners (review comment on #460, re-fire #2, finding
 * F2) - the same class of flake the ordering/ratio checks in
 * tests/gate-budget.test.mjs already moved off real timing for. This
 * file now proves the same three properties - results come back in
 * input order regardless of finish order; a pool of size N genuinely
 * runs N tasks concurrently; concurrency 1 is genuinely sequential -
 * with DEFERRED PROMISES this file resolves BY HAND, in a chosen order,
 * rather than real `setTimeout` delays whose relative ORDER a busy
 * machine can invert. A task's synchronous prelude (pushing its own id
 * into `started` before it awaits anything) plus JavaScript's own
 * single-threaded execution order - not any clock - is what proves
 * "these N tasks are all in flight before any of them was released":
 * runPool's own worker loop (see gate-pool.mjs) launches every worker up
 * to its own first await SYNCHRONOUSLY, before yielding control back to
 * the caller at all, so by the time `runPool(tasks, N)` returns a
 * pending promise, every task that pool size permits has already run to
 * its own await point - no tick-counting, no timer, and so nothing here
 * can flake regardless of what else is running on this machine. The
 * `edge shapes` and `a task's own rejection propagates` blocks further
 * down still use real `setTimeout`-based tasks for realism, but neither
 * one's pass/fail ever compares an elapsed time against a threshold -
 * only counts, ids and a thrown error's message - so neither needed to
 * change.
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

/* A task that sleeps `ms` and returns its own identity - used only
   where the PROPERTY under test never compares an elapsed time against
   anything (the edge-shape and rejection-propagation blocks below), so
   a real delay is realistic without being load-bearing for pass/fail. */
function timedTask(id, ms, finishOrder) {
  return async () => {
    await sleep(ms);
    if (finishOrder) finishOrder.push(id);
    return { id, ms };
  };
}

/* A promise this file resolves BY HAND, on its own schedule - the
   deterministic replacement for a real `setTimeout` delay wherever the
   property under test is about ORDER or COUNT, never duration. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/* Drains a fixed number of microtask ticks - NOT a real-time wait (no
   timer anywhere in this function): resolving a deferred promise
   schedules its `.then()` reactions on the microtask queue, and an
   async function chain needs a small, FIXED number of ticks to run to
   its next await - independent of CPU load, because microtask draining
   is plain single-threaded JS execution, never an OS-scheduled delay. A
   generous tick count costs nothing (an already-settled `Promise.
   resolve()` resolves on the very next tick regardless), so this is
   insurance, not a margin anything can flake on. */
async function flushMicrotasks(times = 10) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

console.log("--- results come back in input order, not finish order "
            + "(deterministic - each task blocked on its own hand-"
            + "resolved promise, resolved in the REVERSE of input "
            + "order) ---");
{
  const finishOrder = [];
  const d = [deferred(), deferred(), deferred()];
  const tasks = d.map((def, id) => async () => {
    await def.promise;
    finishOrder.push(id);
    return id;
  });
  const resultsPromise = runPool(tasks, 3);
  // Resolve 2 first, then 1, then 0 - the opposite of input order. If
  // runPool merely returned things in the order they settled, the
  // result array would read [2, 1, 0].
  d[2].resolve();
  d[1].resolve();
  d[0].resolve();
  const results = await resultsPromise;
  check("three results came back for three tasks", results.length === 3);
  check("results came back in INPUT order (0,1,2), not the reverse "
        + "order they were released in",
        results.join(",") === "0,1,2");
  check("THE TASKS ACTUALLY FINISHED IN THE REVERSE ORDER THEY WERE "
        + "RELEASED (2,1,0) - proving the ordered result array above is "
        + "the pool's own doing, not an accident of these tasks "
        + "happening to finish in input order anyway",
        finishOrder.join(",") === "2,1,0");
}

console.log("\n--- a pool of size N overlaps N tasks, not one at a time "
            + "(deterministic - proven by which tasks have STARTED, "
            + "never by an elapsed time) ---");
{
  // No clock anywhere. If the pool ran tasks one at a time instead of
  // three concurrently, task 1 and task 2 could not have reached their
  // own `started.push` before task 0's deferred is released, because a
  // serial scheduler would still be blocked awaiting task 0. Genuine
  // concurrency is what lets all three reach that line before any of
  // them is released - the exact property the deleted 400ms-ceiling
  // check inferred from a margin instead of observing directly.
  const started = [];
  const d = [deferred(), deferred(), deferred()];
  const tasks = d.map((def, id) => async () => {
    started.push(id);
    return await def.promise;
  });
  const resultsPromise = runPool(tasks, 3);
  check("all three tasks had already started - none is waiting on a "
        + "predecessor to finish first - before any of the three was "
        + "released",
        started.length === 3 && started.slice().sort().join(",") ===
          "0,1,2");
  d.forEach((def, id) => def.resolve(id));
  const results = await resultsPromise;
  check("results still returned in input order once every task "
        + "resolves",
        results.join(",") === "0,1,2");
}

console.log("\n--- pool size 1 is genuinely sequential - proven by "
            + "which task has started, never by an elapsed time ---");
{
  // The direct mutation the ticket asks for, made deterministic: with
  // concurrency forced to 1, task 1 must not have started at all until
  // task 0's own deferred is released, and task 2 must not start until
  // task 1's is - proven by observing `started`'s own length after each
  // release, never by comparing a measured duration against a sum.
  const started = [];
  const d = [deferred(), deferred(), deferred()];
  const tasks = d.map((def, id) => async () => {
    started.push(id);
    return await def.promise;
  });
  const resultsPromise = runPool(tasks, 1);
  check("with concurrency 1, only the first task has started",
        started.length === 1 && started[0] === 0);
  d[0].resolve(0);
  await flushMicrotasks();
  check("only after task 0 resolves does task 1 begin",
        started.length === 2 && started[1] === 1);
  d[1].resolve(1);
  await flushMicrotasks();
  check("only after task 1 resolves does task 2 begin",
        started.length === 3 && started[2] === 2);
  d[2].resolve(2);
  const results = await resultsPromise;
  check("results are still in input order at concurrency 1 too",
        results.join(",") === "0,1,2");
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
