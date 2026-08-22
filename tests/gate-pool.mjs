/*
 * A small, generic concurrency-limited task runner - the seam
 * tests/run.mjs's own arm loop is built on (0.9-M3-S35, #460), pulled
 * out on its own so tests/gate-pool.test.mjs can drive it directly
 * against a fixture roster of fake, known-duration tasks instead of
 * real spawned arm processes. Generic on purpose: it knows nothing
 * about `.test.mjs` files, git, or this repository - a task is any
 * zero-argument async function, so the same code is exercised whether
 * the caller is the real gate or a suite feeding it timed stand-ins.
 *
 * NOT AN ARM: this exports a function and nothing here calls a check()
 * or exits the process - tests/run.mjs's own NOT_ARMS set names this
 * file, and that set's own header comment is where the convention for
 * a non-arm helper living in tests/ is argued for.
 */

/**
 * Run `tasks` with at most `concurrency` in flight at once, and resolve
 * to an array of their results IN THE SAME ORDER AS `tasks` - regardless
 * of which one finishes first. Each of a fixed pool of workers pulls the
 * next task off one shared, monotonically advancing index the moment
 * its own slot frees, so the pool is never left idle waiting on one slow
 * task while faster ones queue behind it - only the RETURNED ARRAY is
 * ordered, never the execution, which is what lets a caller print in a
 * fixed roster order while still running concurrently underneath it.
 */
export async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;

  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  }

  // At least one worker even if `concurrency` is given as 0 or
  // negative - a pool that runs nothing on a bad argument is a silent
  // no-op gate, the same "armed-looking-but-not" failure tests/run.mjs's
  // own header refuses elsewhere. Never more workers than tasks: an
  // idle worker that never claims an index is harmless, but a size
  // computed from a large CPU count against a short roster is a pool
  // that never demonstrates its own concurrency ceiling in a small test.
  const size = Math.max(1, Math.min(concurrency, tasks.length || 1));
  const workers = [];
  for (let i = 0; i < size; i += 1) workers.push(worker());
  await Promise.all(workers);

  return results;
}
