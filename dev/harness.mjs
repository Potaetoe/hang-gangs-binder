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
