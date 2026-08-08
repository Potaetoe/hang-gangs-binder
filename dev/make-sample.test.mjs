/*
 * Contract checks for dev/make-sample.mjs, the sample generator.
 *
 * The generator is the one piece of this tree that loads the shipped
 * form.js and crypto.js and is not itself exercised by anything - which
 * is how issue #66 happened: buildRecord grew a third argument, this
 * caller kept passing two, and the script threw for weeks with every
 * stage green. A suite that merely re-tested the crypto would not have
 * caught it. What catches it is running the real script end to end and
 * insisting it still produces what it says it produces.
 *
 * So this suite is deliberately thin on cryptography and thick on "it
 * still runs". The generator already validates its own table, refuses
 * to write when a row the form would reject is not marked, and prints a
 * summary of what it wrote; the job here is to run it, hold it to that
 * summary, and hold the summary to the file.
 *
 * It runs the generator to a scratch directory outside the repository.
 * A check that rewrote dev/sample-submissions.json to test it would
 * leave a clean checkout dirty on every gate run, and a real change to
 * that file would then hide inside the churn - so the untouchedness of
 * the committed sample is itself one of the assertions below.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync, mkdtempSync, readFileSync, rmSync, statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nodeTestSuite } from "./harness.mjs";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));

// Asserted at the end rather than only printed, the same shape
// dev/check_budget.test.py uses. A suite that stops part way - an early
// return, a rename that makes a block unreachable - still prints a
// confident "all checks passed" over the checks it did reach, which is
// the armed-looking-but-not failure this repository holds to be worse
// than having no check at all.
const { check, report } = nodeTestSuite("make-sample.mjs", 27);

const GENERATOR = HERE("make-sample.mjs");
const COMMITTED = HERE("sample-submissions.json");
const source = readFileSync(GENERATOR, "utf8");

/*
 * The one arm that gates the rest, checked before anything is spawned.
 * Handed no output path the generator writes dev/sample-submissions.json,
 * so a run here would rewrite the committed sample instead of testing
 * it. Refusing to start is the correct behavior for a check whose
 * precondition is false; starting anyway would corrupt the very file
 * the last assertion in this suite protects.
 */
const takesOutputPath = /process\.argv\[2\]/.test(source);
check("the generator takes an output path, so nothing here writes over " +
  "the committed sample", takesOutputPath);
if (!takesOutputPath) {
  console.log("\nStopping before the run. dev/make-sample.mjs must accept " +
    "an output path as its first argument; without one this suite would " +
    "overwrite dev/sample-submissions.json.");
  process.exit(1);
}

const committedBytes = readFileSync(COMMITTED);
const committedMtime = statSync(COMMITTED).mtimeMs;

const scratch = mkdtempSync(join(tmpdir(), "binder-sample-"));
const out = join(scratch, "sample-submissions.json");

check("the scratch file does not exist before the run", !existsSync(out));

const run = spawnSync(process.execPath, [GENERATOR, out], { encoding: "utf8" });
const stdout = (run.stdout || "").replace(/\r/g, "");
const stderr = (run.stderr || "").replace(/\r/g, "");
if (run.status !== 0) {
  console.log("--- the generator's output ---");
  console.log(stdout);
  console.log(stderr);
  console.log("------------------------------");
}

check("the generator exits zero", run.status === 0);

// Its own table check writes that banner and exits non-zero when a row
// the form would reject is not marked, or a marked one is accepted.
// Named rather than asserting an empty stderr, so an unrelated runtime
// warning cannot fail this suite for something that is not its subject.
check("and its own table check finds nothing to reject",
  !stderr.includes("does not match what the form accepts"));

const summary = /^(.*) written - (\d+) row\(s\), (\d+) handle\(s\), (\d+) unopenable\.$/m
  .exec(stdout);
check("and prints a summary a machine can read", summary !== null);
check("and names the path it was handed", summary !== null && summary[1] === out);

const claimedRows = summary ? Number(summary[2]) : -1;
const claimedPeople = summary ? Number(summary[3]) : -1;
const claimedUnopenable = summary ? Number(summary[4]) : -1;

check("the run creates the file it was pointed at", existsSync(out));

const raw = existsSync(out) ? readFileSync(out, "utf8") : "";
check("and the file is not empty", raw.length > 0);

let payload = null;
try {
  payload = JSON.parse(raw);
} catch {
  payload = null;
}
check("and it parses as JSON", payload !== null);

const rows = payload && Array.isArray(payload.submissions)
  ? payload.submissions : [];

check("the payload is shaped like the Worker's GET /export reply",
  payload !== null && payload.ok === true &&
  typeof payload.generated === "string" && typeof payload.note === "string");
check("and it carries rows", rows.length > 0);
check("as many rows as the summary claims", rows.length === claimedRows);

// The Worker returns ORDER BY id and ids follow the order things
// arrived, so the sample has to look like that or the export page is
// being tested against a table shape it never sees.
check("ids run 1..n, the way an append-only table numbers",
  rows.length > 0 && rows.every((row, i) => row.id === i + 1));
check("and received_at never goes backwards",
  rows.every((row, i) => i === 0 ||
    Date.parse(row.received_at) >= Date.parse(rows[i - 1].received_at)));
check("every row carries a received_at that parses",
  rows.length > 0 && rows.every((row) => Number.isFinite(
    Date.parse(row.received_at))));
check("every row carries a non-empty ciphertext",
  rows.length > 0 && rows.every((row) =>
    typeof row.ciphertext === "string" && row.ciphertext.length > 0));

// The export page groups on this and treats the handle as a caption, so
// a row without one is a person the dashboard cannot count. Hex and
// length, because that is the whole of what the page reads.
check("every row carries a server-set account id",
  rows.length > 0 && rows.every((row) => /^[0-9a-f]{64}$/.test(row.account_id)));

/*
 * The account ids are the assertion that normalizeTelegram still folds
 * the three spellings of one handle in the table together: the script
 * counts distinct normalized handles, this counts distinct account ids
 * in the file it wrote, and a normalization that stopped normalizing
 * makes the two disagree. A table row that sets `account` to model a
 * rename would also separate them - that is the case to remember when
 * this arm goes red for a reason nobody expected.
 */
const people = new Set(rows.map((row) => row.account_id)).size;
check("account ids group the rows into the people the summary counts",
  people === claimedPeople && people > 0);
check("and fewer people than rows, so repeat submitters really fold together",
  people < rows.length);

/*
 * The decisive arm, and the reason this suite spawns a process instead
 * of asserting against a file. A check that quietly read the committed
 * sample rather than generating anything would pass every structural
 * assertion above; it cannot pass this one, because every row is sealed
 * to a fresh ephemeral key and no ciphertext ever repeats.
 */
const distinct = new Set(rows.map((row) => row.ciphertext)).size;
check("every ciphertext is distinct - one ephemeral key per row",
  rows.length > 0 && distinct === rows.length);

const committed = JSON.parse(committedBytes.toString("utf8"));
const committedTexts = new Set(committed.submissions.map((r) => r.ciphertext));
check("and none repeats the committed sample's, so this run really encrypted",
  rows.length > 0 &&
  rows.every((row) => !committedTexts.has(row.ciphertext)));

/*
 * The regeneration property dev/README.md states, held as a fact rather
 * than as prose: a fresh run reproduces every record and rewrites every
 * blob. Everything here is derived - the ids from the order, the
 * account ids from a SHA-256 of the handle, received_at from the table's
 * `at` - so this failing means the table and the committed sample have
 * come apart, and the fix is to regenerate the sample in the change that
 * moved the table and say in the commit what moved.
 */
const shape = (p) => JSON.stringify(
  p.submissions.map((r) => [r.id, r.account_id, r.received_at]));
check("everything but the ciphertexts matches the committed sample",
  payload !== null && shape(payload) === shape(committed));

/*
 * Two rows carry the branches most likely to be lost in an edit, and
 * losing either leaves this suite green while the coverage goes: the
 * spreadsheet-formula handle is the row admin.js's leading-apostrophe
 * guard exists for, and it is deliberately the one row the generator's
 * own validate() pass expects to be rejected.
 */
check("the table still carries the row the form must reject",
  /expect:\s*"invalid"/.test(source));

const marked = (source.match(/wrongKey:\s*true/g) || []).length;
check("and the unopenable count it reports is the number the table marks",
  claimedUnopenable === marked && marked > 0);

/*
 * The point of the output path. Byte comparison and timestamp, because
 * a rewrite that happened to produce identical bytes would still be a
 * check writing to a tracked file, and the next record-shape change
 * makes the bytes differ.
 */
check("the committed sample is untouched, byte for byte",
  readFileSync(COMMITTED).equals(committedBytes));
check("and its modification time did not move",
  statSync(COMMITTED).mtimeMs === committedMtime);

rmSync(scratch, { recursive: true, force: true });
check("the scratch directory is cleaned up", !existsSync(scratch));

report();
