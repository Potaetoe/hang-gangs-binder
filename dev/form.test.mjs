/*
 * Checks for the pure half of apps/web/form.js.
 *
 *     node dev/form.test.mjs
 *
 * The form's arithmetic is the kind that is wrong without looking wrong.
 * A bad conversion factor does not throw and does not render badly - it
 * produces a plausible number, seals it inside a blob nobody can read
 * back, and stays invisible until export day, at which point every row
 * ever collected is quietly off and there is no original to recover it
 * from. The encryption has dev/crypto.test.mjs for exactly this reason;
 * the numbers going into it deserve the same.
 *
 * Loaded the way crypto.js and the Worker are: the real file, through a
 * data: URL, so this tests what ships rather than a copy. form.js
 * returns before touching the DOM when there is no document, which is
 * what makes that possible.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));

const formSrc = await readFile(HERE("../apps/web/form.js"), "utf8");
await import("data:text/javascript," + encodeURIComponent(formSrc));
const {
  normalizeTelegram, parseNumber, weightFromKg, weightFromLb,
  heightFromCm, heightFromFeetInches, validate, buildRecord,
} = globalThis.BinderForm;

// The end-to-end check at the bottom needs the real encryption too.
const cryptoSrc = await readFile(HERE("../apps/web/crypto.js"), "utf8");
await import("data:text/javascript," + encodeURIComponent(cryptoSrc));
const keyFile = JSON.parse(await readFile(HERE("test-key.json"), "utf8"));

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let failures = 0;
const results = [];

async function check(label, fn) {
  let ok = false;
  let note = "";
  try {
    ok = (await fn()) === true;
    if (!ok) note = "returned false";
  } catch (error) {
    note = "threw: " + (error && error.message ? error.message : error);
  }
  if (!ok) failures++;
  results.push([ok, label, note]);
}

await check("the exported object is frozen", () =>
  // submit.html holds the submission before crypto.js seals it, so an
  // export a later script can rewrite is a `validate` that waves
  // anything through, or a `buildRecord` that adds a field to what gets
  // encrypted. tools/check_web.py check 15 holds the rule across the
  // whole directory; this asserts it for the shipped bytes.
  Object.isFrozen(globalThis.BinderForm));

/* Every problem `validate` reports for this input, as field names. */
const fieldsFlagged = (input) => validate(input).map((p) => p.field).sort();

/* A form filled in correctly, metric. Cases below vary one thing. */
const GOOD_METRIC = {
  telegram: "@SomeHandle",
  units: "metric",
  weightKg: "90",
  weightLb: "",
  heightCm: "178",
  heightFeet: "",
  heightInches: "",
  gender: "male",
  roles: ["feedee", "gainer"],
  country: "US",
  over18: true,
};

const GOOD_IMPERIAL = Object.assign({}, GOOD_METRIC, {
  units: "imperial",
  weightKg: "",
  weightLb: "200",
  heightCm: "",
  heightFeet: "5",
  heightInches: "10",
});

const vary = (base, changes) => Object.assign({}, base, changes);

/* ------------------------------------------------------------------ */
/* Normalizing the one identifier this project has.                    */

await check("a bare handle is lowercased", () =>
  normalizeTelegram("SomeHandle") === "somehandle");

await check("a leading @ is stripped", () =>
  normalizeTelegram("@SomeHandle") === "somehandle");

await check("surrounding whitespace is stripped", () =>
  normalizeTelegram("  @SomeHandle \n") === "somehandle");

/* People paste links. All three forms name the same person, and a row
 * recording "https://t.me/x" is a row the keyholder has to clean by
 * hand. */
await check("a t.me link is reduced to the handle", () =>
  normalizeTelegram("t.me/SomeHandle") === "somehandle");

await check("a full https t.me link is reduced to the handle", () =>
  normalizeTelegram("https://t.me/SomeHandle") === "somehandle");

await check("normalizing is removal only - nothing is invented", () =>
  normalizeTelegram("") === "" && normalizeTelegram(null) === "");

/* ------------------------------------------------------------------ */
/* Reading a number, strictly.                                         */

await check("a plain number parses", () => parseNumber("90") === 90);

await check("a decimal parses", () => parseNumber("90.5") === 90.5);

/* Half the world types a comma. Rejecting it would read as the form
 * refusing a weight that is plainly a weight. */
await check("a comma decimal parses", () => parseNumber("90,5") === 90.5);

/* Number("") is 0, which would sail through validation as a weight
 * nobody entered. This is the case that check exists for. */
await check("empty is not a number", () => parseNumber("") === null);

await check("whitespace is not a number", () => parseNumber("   ") === null);

/* parseFloat("90kg") is 90. Accepting that would silently drop whatever
 * the submitter meant by the rest of it. */
await check("a number with a unit stuck on is rejected", () =>
  parseNumber("90kg") === null);

await check("words are rejected", () => parseNumber("ninety") === null);

/* ------------------------------------------------------------------ */
/* Conversion. Both directions, against values checked by hand.        */

await check("200 lb is 90.7 kg, and keeps its pounds", () =>
  same(weightFromLb(200), { kg: 90.7, lb: 200 }));

await check("90 kg is 198.4 lb, and keeps its kilos", () =>
  same(weightFromKg(90), { kg: 90, lb: 198.4 }));

/* The factors are exact by definition, so a round trip through both
 * should land back within rounding rather than drifting. */
await check("a weight survives a round trip through both systems", () => {
  const there = weightFromLb(200);
  const back = weightFromKg(there.kg);
  return Math.abs(back.lb - 200) < 0.1;
});

await check("5 ft 10 in is 177.8 cm and 70 inches", () =>
  same(heightFromFeetInches(5, 10),
    { cm: 177.8, totalInches: 70, feet: 5, inches: 10 }));

await check("178 cm comes back as 178 cm and about 5 ft 10 in", () => {
  const h = heightFromCm(178);
  return h.cm === 178 && h.feet === 5 && Math.abs(h.inches - 10.1) < 0.05;
});

await check("a round number of feet has no leftover inches", () =>
  same(heightFromFeetInches(6, 0),
    { cm: 182.9, totalInches: 72, feet: 6, inches: 0 }));

/*
 * The carry. 5 ft 11.98 in rounds to 5 ft 12 in, which is not a height
 * anyone writes. Nothing about the stored cm would be wrong, so this
 * would never be caught by looking at the data - only by reading a CSV
 * and noticing.
 */
await check("rounding never produces twelve inches", () => {
  const h = heightFromFeetInches(5, 11.98);
  return h.feet === 6 && h.inches === 0;
});

await check("feet and inches always agree with the total", () => {
  for (let cm = 100; cm <= 250; cm += 0.5) {
    const h = heightFromCm(cm);
    if (h.inches < 0 || h.inches >= 12) return false;
    if (Math.abs(h.feet * 12 + h.inches - h.totalInches) > 0.11) return false;
  }
  return true;
});

/* ------------------------------------------------------------------ */
/* Validation. What it lets through, and what it stops.                */

await check("a correctly filled metric form has no problems", () =>
  validate(GOOD_METRIC).length === 0);

await check("a correctly filled imperial form has no problems", () =>
  validate(GOOD_IMPERIAL).length === 0);

await check("a missing handle is caught", () =>
  same(fieldsFlagged(vary(GOOD_METRIC, { telegram: "" })), ["telegram"]));

await check("a handle that is too short is caught", () =>
  same(fieldsFlagged(vary(GOOD_METRIC, { telegram: "abc" })), ["telegram"]));

await check("a handle with illegal characters is caught", () =>
  same(fieldsFlagged(vary(GOOD_METRIC, { telegram: "some handle!" })),
    ["telegram"]));

await check("a blank weight is caught", () =>
  same(fieldsFlagged(vary(GOOD_METRIC, { weightKg: "" })), ["weight"]));

/*
 * The units mistake this design is most exposed to: someone in pounds
 * typing their weight into the kilos box, or the reverse. 200 is a
 * perfectly ordinary number in one system and impossible in the other,
 * which is the only reason bounds are here at all.
 */
await check("a weight far outside the metric range is caught", () =>
  same(fieldsFlagged(vary(GOOD_METRIC, { weightKg: "900" })), ["weight"]));

await check("a weight far outside the imperial range is caught", () =>
  same(fieldsFlagged(vary(GOOD_IMPERIAL, { weightLb: "20" })), ["weight"]));

/* Bounds are stated per system, so 200 is fine in pounds and not in
 * kilos - the whole point of not deriving one from the other. */
await check("200 is valid as pounds and invalid as kilos", () =>
  validate(vary(GOOD_IMPERIAL, { weightLb: "200" })).length === 0 &&
  fieldsFlagged(vary(GOOD_METRIC, { weightKg: "200" })).length === 0 &&
  fieldsFlagged(vary(GOOD_METRIC, { weightKg: "600" })).length === 1);

await check("a height outside the metric range is caught", () =>
  same(fieldsFlagged(vary(GOOD_METRIC, { heightCm: "70" })), ["height"]));

await check("twelve inches or more is caught", () =>
  same(fieldsFlagged(vary(GOOD_IMPERIAL, { heightInches: "14" })), ["height"]));

await check("an empty inches box means a round number of feet", () =>
  validate(vary(GOOD_IMPERIAL, { heightInches: "" })).length === 0);

/* Only the fields of the system in use are read. Leftovers in the other
 * one are what the toggle produces every time someone changes their
 * mind, and they must not fail the form. */
await check("the unused system's fields are ignored", () =>
  validate(vary(GOOD_IMPERIAL, { weightKg: "nonsense", heightCm: "x" }))
    .length === 0);

await check("an unconfirmed 18+ box is caught", () =>
  same(fieldsFlagged(vary(GOOD_METRIC, { over18: false })), ["over18"]));

/* All at once rather than one per attempt. */
await check("several problems are reported together", () =>
  same(fieldsFlagged(vary(GOOD_METRIC,
    { telegram: "", weightKg: "", over18: false })),
    ["over18", "telegram", "weight"]));

/* ------------------------------------------------------------------ */
/* The record. What actually gets stored.                              */

const WHEN = Date.UTC(2026, 7, 4, 12, 0, 0);
const SESSION_USERNAME = "verified_member";

await check("a typed handle is refused without a session username", () => {
  try {
    buildRecord(GOOD_METRIC, WHEN);
  } catch {
    return true;
  }
  return false;
});

await check("a submission carries the session username", () =>
  buildRecord(vary(GOOD_METRIC, { telegram: "" }), WHEN, SESSION_USERNAME)
    .telegram === SESSION_USERNAME);

await check("a typed handle cannot override the session username", () =>
  buildRecord(
    vary(GOOD_METRIC, { telegram: "different_member" }),
    WHEN,
    SESSION_USERNAME,
  ).telegram === SESSION_USERNAME);

await check("an imperial submission stores both systems", () => {
  const r = buildRecord(GOOD_IMPERIAL, WHEN, SESSION_USERNAME);
  return same(r.weight, { kg: 90.7, lb: 200 }) &&
    same(r.height, { cm: 177.8, totalInches: 70, feet: 5, inches: 10 });
});

await check("a metric submission stores both systems", () => {
  const r = buildRecord(GOOD_METRIC, WHEN, SESSION_USERNAME);
  return r.weight.kg === 90 && r.weight.lb === 198.4 &&
    r.height.cm === 178 && r.height.feet === 5;
});

/* Rounding is lossy in both directions, so the honest answer to "what
 * did they actually type" is kept verbatim beside the derived numbers. */
await check("what was typed is recorded verbatim", () =>
  same(buildRecord(GOOD_IMPERIAL, WHEN, SESSION_USERNAME).entered,
    { units: "imperial", weight: "200 lb", height: "5 ft 10 in" }) &&
  same(buildRecord(GOOD_METRIC, WHEN, SESSION_USERNAME).entered,
    { units: "metric", weight: "90 kg", height: "178 cm" }));

await check("the handle is stored normalized", () =>
  buildRecord(
    vary(GOOD_METRIC, { telegram: "https://t.me/SomeHandle" }),
    WHEN,
    "@SomeHandle",
  )
    .telegram === "somehandle");

await check("the timestamp is the one it was given", () =>
  buildRecord(GOOD_METRIC, WHEN, SESSION_USERNAME).submittedAt ===
    "2026-08-04T12:00:00.000Z");

await check("the 18+ confirmation is recorded with the row", () =>
  buildRecord(GOOD_METRIC, WHEN, SESSION_USERNAME).over18 === true);

/*
 * The optional fields are the ones a tampered page or a future edit
 * could put anything into. They are filtered rather than trusted, so
 * the export has a fixed vocabulary to read.
 */
await check("unknown roles are dropped", () =>
  same(buildRecord(
    vary(GOOD_METRIC, { roles: ["feedee", "wizard"] }),
    WHEN,
    SESSION_USERNAME,
  ).roles, ["feedee"]));

await check("an unknown gender becomes nothing rather than itself", () =>
  buildRecord(
    vary(GOOD_METRIC, { gender: "made up" }),
    WHEN,
    SESSION_USERNAME,
  ).gender === null);

await check("an unselected optional field is null, not empty string", () => {
  const r = buildRecord(
    vary(GOOD_METRIC, { gender: "", country: "", roles: [] }),
    WHEN,
    SESSION_USERNAME,
  );
  return r.gender === null && r.country === null && same(r.roles, []);
});

await check("a country that is not a two-letter code is dropped", () =>
  buildRecord(
    vary(GOOD_METRIC, { country: "United States" }),
    WHEN,
    SESSION_USERNAME,
  )
    .country === null);

/* ------------------------------------------------------------------ */
/* The two halves together.                                            */

/*
 * The record shape has to survive the trip crypto.js takes it on. It is
 * JSON either way, so this should be uninteresting - which is why it is
 * worth one check rather than an argument: nested objects, an array and
 * three nulls, through encrypt and back, compared whole.
 */
await check("a record encrypts and comes back identical", async () => {
  const record = buildRecord(GOOD_IMPERIAL, WHEN, SESSION_USERNAME);
  const blob = await globalThis.BinderCrypto.encrypt(record, keyFile.publicKey);
  const back = await globalThis.BinderCrypto.decrypt(blob, keyFile);
  return same(back, record);
});

/* What server/worker.js will accept. A record that encrypts to
 * something the endpoint rejects fails at the last possible moment,
 * after the submitter has filled everything in. */
await check("the ciphertext is base64 the endpoint accepts", async () => {
  const blob = await globalThis.BinderCrypto.encrypt(
    buildRecord(GOOD_METRIC, WHEN, SESSION_USERNAME), keyFile.publicKey);
  return /^[A-Za-z0-9+/]+={0,2}$/.test(blob) && blob.length < 16 * 1024;
});

/*
 * The member panel re-reads /me when this event fires. Its placement is the
 * contract: every network refusal returns before it, and the success UI comes
 * after it. More than one dispatch would make one stored row trigger several
 * route reads and would obscure which result the panel is rendering.
 */
await check("the stored event exists only on the successful network path",
  () => {
    const dispatch =
      'document.dispatchEvent(new CustomEvent("binder:submitted"));';
    const occurrences = formSrc.split(dispatch).length - 1;
    const failureMessage = formSrc.indexOf(
      '" Nothing was stored - try again.", "bad");');
    const failureReturn = formSrc.indexOf("return;", failureMessage);
    const dispatchAt = formSrc.indexOf(dispatch);
    const successUi = formSrc.indexOf("show(form, false);", dispatchAt);
    return occurrences === 1 && failureMessage !== -1 && failureReturn !== -1 &&
      failureReturn < dispatchAt && dispatchAt < successUi;
  });

/* ------------------------------------------------------------------ */

for (const [ok, label, note] of results) {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (note ? " - " + note : ""));
}
console.log(
  failures === 0
    ? "\nform.js OK - " + results.length + " checks"
    : "\nform.js FAILED " + failures + " of " + results.length + " checks");

process.exit(failures === 0 ? 0 : 1);
