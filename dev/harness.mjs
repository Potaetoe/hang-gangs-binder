/*
 * The one check/report/EXPECTED the Node suites in dev/ share.
 *
 *     import { suite } from "./harness.mjs";
 *
 *     const { check, mustReject, report } = suite("crypto.js", 63);
 *     check("a label somebody can act on", value === want);
 *     await check("the same, computed lazily", () => value === want);
 *     report();
 *
 * TWO EXPORTS, ONE PER RUNNER. `nodeTestSuite` at the bottom of this
 * file is the same three functions on Node's builtin `node:test`, and
 * it takes the same arguments and returns the same shape, so a suite
 * adopts it by changing the name it imports and nothing else. Both are
 * here because the adoption is one suite per commit by mandate (#74,
 * from #75's evaluation): a runner swap that lands for fourteen suites
 * at once is a red gate with fourteen candidate causes. `suite` serves
 * every suite that has not adopted the other one, and it goes away
 * with the last of them.
 *
 * WHY ONE FILE. A harness is not what a suite proves, so a copy of it in
 * every suite is a copy of every fix to it in one file and not the other
 * thirteen. The count arm below is the case in point: some suites assert
 * how many checks ran and some only print it, and the ones that only
 * print it announce a confident pass over however many checks they
 * happened to reach. Adopting this module is how a suite gains that arm
 * without anyone writing a fifteenth version of it.
 *
 * WHAT A SUITE STILL OWNS. Its stubs, its fixtures, its labels, and its
 * own EXPECTED number. Nothing here knows anything about any subject
 * under test, which is the property that keeps this file from being able
 * to weaken a check: the worst it can do is fail to report one, and the
 * count arm is what catches that.
 *
 * TWO WAYS TO STATE A CHECK, AND WHY BOTH SURVIVE. A condition computed
 * up front (`check(label, a === b)`) and a condition wrapped in a thunk
 * (`await check(label, () => a === b)`) are both here because the suites
 * are written both ways, and rewriting a thousand call sites to agree is
 * a diff in which a silently inverted assertion would be invisible. The
 * two forms are judged differently ON PURPOSE:
 *
 *   - A thunk's result must be exactly `true`. A thunk that returns a
 *     Promise - `() => somethingAsync()` with the await forgotten - is
 *     truthy, and a check that passes because it returned a Promise is a
 *     check that never ran.
 *   - A direct condition is judged by truthiness, because the suites
 *     written that way pass regex matches, element lookups and lengths
 *     straight in. Tightening that here would change what those suites
 *     prove, in the diff that claims to change nothing.
 *
 * WHY EACH RESULT PRINTS AS IT IS RECORDED rather than in a block at the
 * end. A suite that builds its fixtures at file scope can die before it
 * reaches its own report - a throw there takes the process with it, and
 * a run that buffered its results prints nothing at all about the
 * eighty checks that had already passed. The gate still goes red either
 * way; what streaming buys is a run that says WHICH invariant broke,
 * which is the report a real regression has to produce.
 */

import { test } from "node:test";

export function suite(name, expected) {
  let failures = 0;
  let performed = 0;

  function record(ok, label, note) {
    performed++;
    if (!ok) failures++;
    console.log(`${ok ? "pass" : "FAIL"}  ${label}${note ? " - " + note : ""}`);
  }

  async function checkThunk(label, fn) {
    let ok = false;
    let note = "";
    try {
      ok = (await fn()) === true;
      if (!ok) note = "returned false";
    } catch (error) {
      note = "threw: " + (error && error.message ? error.message : error);
    }
    record(ok, label, note);
  }

  /*
   * The third argument is the detail a status assertion wants to print
   * on the way past - "404 (want 401)" - which is worth having on a
   * passing row too, since the number a check accepted is what a reader
   * compares against when the next one fails.
   */
  function check(label, subject, note = "") {
    if (typeof subject === "function") return checkThunk(label, subject);
    record(Boolean(subject), label, note);
    return undefined;
  }

  /*
   * A failure path asserted as a failure path. A decrypt that returns
   * garbage instead of throwing is a corrupt export nobody notices, so
   * the throw is not enough on its own: the message has to name the
   * thing that went wrong, or the next person reads "Error" and guesses.
   */
  async function mustReject(label, fn, fragment) {
    let ok = false;
    let note = "did not throw";
    try {
      await fn();
    } catch (error) {
      const message = String(error && error.message);
      ok = message.toLowerCase().includes(fragment.toLowerCase());
      note = ok ? "" : `threw, but not about "${fragment}": ${message}`;
    }
    record(ok, label, note);
  }

  function report() {
    if (failures) {
      console.log(`\n${name} FAILED ${failures} of ${performed} check(s)`);
      process.exit(1);
    }
    if (performed !== expected) {
      console.log(`\n${name} ran ${performed} checks, expected ${expected} - ` +
        "a check stopped running, or one was added without updating the " +
        "count passed to suite()");
      process.exit(1);
    }
    console.log(`\n${name} OK - ${performed} checks`);
    process.exit(0);
  }

  return { check, mustReject, report };
}

/*
 * The same three functions on `node:test`, Node's builtin runner.
 *
 *     import { nodeTestSuite } from "./harness.mjs";
 *
 *     const { check, mustReject, report } = nodeTestSuite("ui.js", 28);
 *
 * Zero packages: `node:test` ships with Node, so adopting it adds no
 * lockfile entry and leaves the repository's no-third-party-runtime
 * position exactly where it was. What it buys is a runner the rest of
 * the world already knows - `node --test`, filtering, subtests,
 * machine-readable output - in place of fourteen hand-rolled loops.
 *
 * WHY EVERY CONDITION IS STILL EVALUATED AT THE CALL SITE. `test()`
 * registers a callback; it does not run it there. Node drains the queue
 * once the module body yields, so a callback written as
 * `test(label, () => panel.hidden === false)` reads `panel` minutes of
 * mutations later and asserts about a fixture nobody was describing.
 * These suites are linear scripts that mutate one stub across a dozen
 * checks on purpose - that is what makes them readable - so `check`
 * takes the ALREADY-COMPUTED result exactly as it always has, and the
 * test it registers asserts that captured value. The suites keep their
 * order and their proofs; only the reporting moves. Rewriting them into
 * self-contained callbacks is a separate change with a separate review,
 * and it is not one that can ride inside a runner swap claiming to
 * change nothing.
 *
 * WHY THE COUNT ARM IS A REGISTERED TEST AND NEVER AN after() HOOK.
 * This is the whole reason the arm needs writing at all: `node:test`
 * reports how many tests RAN and never asserts how many SHOULD have.
 * The obvious place to put the assertion is a root `after()` hook, and
 * that place is a trap. Measured on Node v24.19.0: a failing root
 * `after()` hook prints `✖ failing tests` and a complete
 * AssertionError, the summary above it still says `fail 0`, and THE
 * PROCESS EXITS 0. The gate reads exit codes, so the arm would be
 * decoration - armed-looking and unable to fail, which this repository
 * holds to be worse than no arm at all. The identical assertion
 * registered as a test exits 1. Do not move it into a hook.
 *
 * WHY report() DOES NOT CALL process.exit. `suite` above ends on
 * `process.exit(0)`, and copying that line down here would end the
 * process while every test is still queued: nothing runs, nothing
 * fails, and the suite is green forever. `node:test` sets the exit code
 * itself - 1 when a test fails. report() only registers the last test.
 *
 * WHAT A FILE-SCOPE THROW DOES NOW. `suite` prints each result as it is
 * recorded, so a throw while building fixtures leaves the passing rows
 * on screen. Here the run reports after the body, so a throw at file
 * scope prints no rows - it prints the exception with its file and its
 * line, and exits non-zero. Which non-zero code depends on whether the
 * runner has begun draining the queue by then, so do not assert on the
 * number; assert that it is not 0, which is what the gate reads. The
 * suite still fails loudly, and it names the statement that broke
 * rather than leaving the reader to infer it from where the labels
 * stopped. What neither shape catches is a module that returns early
 * and never reaches report(): no count arm is registered, so nothing
 * asserts. That hole is the same size in both.
 */
export function nodeTestSuite(name, expected) {
  let performed = 0;

  /*
   * The note rides as a diagnostic rather than being appended to the
   * label, so a suite's labels are the same strings under either
   * runner - which is what makes "the same set of checks fails" a
   * comparison anyone can run rather than a claim to be trusted.
   */
  function record(ok, label, note) {
    performed++;
    test(label, (t) => {
      if (note) t.diagnostic(note);
      if (!ok) throw new Error(note ? `${label} - ${note}` : label);
    });
  }

  async function checkThunk(label, fn) {
    let ok = false;
    let note = "";
    try {
      ok = (await fn()) === true;
      if (!ok) note = "returned false";
    } catch (error) {
      note = "threw: " + (error && error.message ? error.message : error);
    }
    record(ok, label, note);
  }

  function check(label, subject, note = "") {
    if (typeof subject === "function") return checkThunk(label, subject);
    record(Boolean(subject), label, note);
    return undefined;
  }

  async function mustReject(label, fn, fragment) {
    let ok = false;
    let note = "did not throw";
    try {
      await fn();
    } catch (error) {
      const message = String(error && error.message);
      ok = message.toLowerCase().includes(fragment.toLowerCase());
      note = ok ? "" : `threw, but not about "${fragment}": ${message}`;
    }
    record(ok, label, note);
  }

  /*
   * `performed` is read when this callback runs, not when it is
   * registered, and by then the module body has finished handing over
   * every check it has. Registering the arm at construction instead
   * would read the counter while the body is still filling it, because
   * an `await` anywhere in a suite lets the runner start draining.
   */
  function report() {
    test(`${name} ran every check it declares`, () => {
      if (performed !== expected) {
        throw new Error(`${name} ran ${performed} checks, expected ` +
          `${expected} - a check stopped running, or one was added ` +
          "without updating the count passed to nodeTestSuite()");
      }
    });
  }

  return { check, mustReject, report };
}
