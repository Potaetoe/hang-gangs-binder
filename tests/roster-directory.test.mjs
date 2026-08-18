/*
 * The member directory on the encrypted store, armed. 0.9-M1-S11 (#340),
 * over server/worker.js's syncDirectoryEntry wired to
 * server/store-crypto.js's sealDirectory/openDirectory (purpose 'dir').
 *
 *     node tests/roster-directory.test.mjs
 *
 * WHAT THIS ARM IS FOR. DESIGN.md, "The identifier is the whole problem",
 * rules the directory INSIDE what is encrypted at rest rather than beside
 * it: a clear-text roster of handles next to the rows is the membership
 * oracle the whole design exists to kill. This arm drives the directory's
 * write path against a REAL local format round trip - server/store-crypto.js
 * runs for real (Node has WebCrypto), so the AAD bindings are exercised
 * rather than stubbed. Only D1 is a stub, and it models exactly the one
 * UPSERT syncDirectoryEntry issues, reading the ON CONFLICT clause off the
 * SQL it is handed so a route that changed the clause is caught here.
 *
 * WHERE THE CRYPTO HALF IS PROVEN, AND WHERE THIS ONE IS. S4 (#330) proves
 * and arms the format itself in tests/store-crypto.test.mjs - that a swap
 * of account, record or PURPOSE fails to open. This arm proves the WIRING:
 * that the Worker's directory path routes through sealDirectory (purpose
 * 'dir') and never sealRow, binds the account-id HMAC and the slot, and
 * that a directory record and an entry row cannot open as each other. The
 * ticket names that split exactly.
 *
 * THE SECURITY PROPERTIES THIS ARM PINS (0.9-M1-S11 mandates):
 *   1. Directory data is sealed through sealDirectory only; a directory
 *      record cannot open as a row, nor a row as a directory record.
 *   2. The AAD binds the account-id HMAC and a stable slot; a record does
 *      not open under another account's context.
 *   3. The membership key stored in the clear is the account-id HMAC,
 *      never a raw Telegram id or a handle - refused before a seal.
 *   4. Handles, display names and roles live inside the ciphertext; only
 *      the account-id HMAC and the timestamps are clear.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKER_PATH = ROOT + "server/worker.js";
const SCHEMA_PATH = ROOT + "server/schema.sql";

const readText = async (path) =>
  (await readFile(path, "utf8")).replace(/\r\n/g, "\n");

const workerSrc = await readText(WORKER_PATH);
const schemaSrc = await readText(SCHEMA_PATH);

/* server/worker.js statically imports ./store-crypto.js; a data: module
   has no base URL to resolve a relative specifier against, so the one
   specifier is rewritten to the real file's absolute URL and the worker
   still runs from its own bytes. Scoped to that one specifier so a second
   relative import would fail loudly rather than be silently absorbed -
   the technique tests/telegram-auth.test.mjs uses, and for the same
   reason. Loading through a string is also what lets the mutation battery
   below reload a modified copy. */
const STORE_CRYPTO_URL = pathToFileURL(ROOT + "server/store-crypto.js").href;
async function loadWorker(src) {
  const resolved = src.replace(
    /(\bfrom\s*)"\.\/store-crypto\.js"/, '$1"' + STORE_CRYPTO_URL + '"');
  return import("data:text/javascript," + encodeURIComponent(resolved));
}
const worker = await loadWorker(workerSrc);

/* The store, imported by its own path (it has no relative imports of its
   own, so a direct import resolves). Built from the same secret the
   Worker uses: HKDF's salt is fixed, so two stores over one secret derive
   the same subkeys and this one opens what the Worker's sealed. */
const store = await import(
  pathToFileURL(ROOT + "server/store-crypto.js").href);

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* Whatever it threw, or null. */
async function threw(work) {
  try { await work(); return null; } catch (error) { return error; }
}
/* What it returned, or a sentinel that fails a comparison rather than
   ending the run. */
async function valueOf(work) {
  try { return await work(); }
  catch (error) { return "<threw " + (error && error.name || error) + ">"; }
}

/* Does the raw stored blob contain this plaintext anywhere in its bytes? */
function bytesContain(bytes, text) {
  const needle = new TextEncoder().encode(text);
  outer: for (let i = 0; i + needle.length <= bytes.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}
const unb64 = (text) => new Uint8Array(Buffer.from(text, "base64"));

/* ------------------------------------------------------------------ */
/* Canaries. Two accounts, one raw id that must never key a row, and    */
/* handles/names distinctive enough to find in a dump.                  */

const STORE_SECRET = "roster-directory arm store secret / not a real one / v1";
const ACCOUNT_SECRET = "roster-directory arm account secret / not real";
const ACCT_A =
  "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
const ACCT_B =
  "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";
const RAW_ID = "606060606";
const HANDLE = "torvaldsmxyz";
const DISPLAY = "Linus Canary";
const ROLE = "member";

/* ------------------------------------------------------------------ */
/* A D1 binding that remembers the directory and reads its UPSERT off    */
/* the SQL. It models only the one INSERT syncDirectoryEntry issues; a   */
/* statement it does not recognize throws, so a write that changed shape */
/* is caught rather than answered by a quiet default. The ON CONFLICT    */
/* SET clause is APPLIED per its own column list, so a slice that added  */
/* joined_at to that clause is observed here rather than assumed away.   */

function makeDb() {
  const directory = new Map();

  function run(sql, args) {
    if (/INSERT INTO directory/i.test(sql)) {
      const [account_id, ciphertext, joined_at, last_seen_at] = args;
      const existing = directory.get(account_id);
      if (!existing) {
        directory.set(account_id,
          { account_id, ciphertext, joined_at, last_seen_at });
        return { meta: { changes: 1 } };
      }
      // Apply exactly the columns the DO UPDATE SET clause names, as
      // `col = excluded.col`, so the stub reflects the real upsert. The
      // incoming row is the "excluded" side.
      const incoming = { account_id, ciphertext, joined_at, last_seen_at };
      const setClause = sql.match(/DO UPDATE SET\s+(.+)$/i);
      const assignments = setClause ? setClause[1] : "";
      for (const piece of assignments.split(",")) {
        const m = piece.match(/(\w+)\s*=\s*excluded\.(\w+)/i);
        if (m) existing[m[1]] = incoming[m[2]];
      }
      return { meta: { changes: 1 } };
    }
    throw new Error("the D1 stub was handed a statement it does not " +
      "recognize, which means the directory write changed shape without " +
      "this arm being told: " + sql);
  }

  return {
    directory,
    DB: {
      prepare: (sql) => ({
        bind: (...args) => ({ run: async () => run(sql, args) }),
      }),
    },
  };
}

const env = (db) => ({ DB: db.DB, STORE_SECRET, ACCOUNT_SECRET });

const direct = await store.openStore({ STORE_SECRET });
const SLOT = worker.DIRECTORY_SLOT;

/* ================================================================== */
/* 1. The schema: a whole new table, the rerun-safe easy case.         */

check("schema: the directory table is created with CREATE TABLE IF NOT " +
  "EXISTS", /CREATE TABLE IF NOT EXISTS directory/i.test(schemaSrc));
check("schema: account_id is the primary key - the membership key, in " +
  "the clear", /account_id\s+TEXT\s+PRIMARY KEY/i.test(
    schemaSrc.slice(schemaSrc.indexOf("CREATE TABLE IF NOT EXISTS directory"))
  ));
check("schema: an index on last_seen_at, so a freshness read does not " +
  "scan the table",
  /CREATE INDEX IF NOT EXISTS directory_last_seen/i.test(schemaSrc));
/* Flatten the comment prefixes and line wraps so the rerun sentence can
   be read across the lines it is wrapped over in the house style. */
const schemaFlat = schemaSrc.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");
check("schema: the rerun story names directory as a whole-new-table case",
  /re-running this file creates[^.]*\bdirectory\b/i.test(schemaFlat));

/* ================================================================== */
/* 2. The write path: a real round trip through sealDirectory.         */

{
  const db = makeDb();
  const t0 = "2026-08-18T10:00:00.000Z";
  await worker.syncDirectoryEntry(direct, env(db), ACCT_A,
    { handle: HANDLE, displayName: DISPLAY, role: ROLE }, t0);
  const row = db.directory.get(ACCT_A);

  check("write: a directory row is written keyed by the account-id HMAC",
    Boolean(row) && row.account_id === ACCT_A);

  const opened = await valueOf(() => direct.openDirectory(
    unb64(row.ciphertext), { accountId: ACCT_A, recordId: SLOT }));
  const parsed = typeof opened === "string"
    ? (await valueOf(() => JSON.parse(opened))) : null;
  check("round trip: the record opens under its own account and slot to " +
    "the sealed handle, display name and role",
    Boolean(parsed) && parsed.handle === HANDLE &&
    parsed.displayName === DISPLAY && parsed.role === ROLE);

  /* Mandate 4: only the account-id HMAC and the timestamps are clear. */
  const bytes = unb64(row.ciphertext);
  check("dump: the stored ciphertext carries neither the handle nor the " +
    "display name anywhere in its bytes",
    !bytesContain(bytes, HANDLE) && !bytesContain(bytes, DISPLAY));
  check("dump: the clear columns are the account-id HMAC and the two " +
    "timestamps - no raw id, no handle among them",
    row.account_id === ACCT_A && row.joined_at === t0 &&
    row.last_seen_at === t0 &&
    !JSON.stringify({ a: row.account_id, j: row.joined_at, l: row.last_seen_at })
      .includes(HANDLE) &&
    !JSON.stringify({ a: row.account_id, j: row.joined_at, l: row.last_seen_at })
      .includes(RAW_ID));

  /* Mandate 2: a directory record does not open under another account. */
  check("cross-account: the record does not open under another account's " +
    "context",
    (await threw(() => direct.openDirectory(
      unb64(row.ciphertext), { accountId: ACCT_B, recordId: SLOT }))) !== null);

  /* Mandate 1: the wiring. A directory record cannot open as a row. */
  check("cross-purpose: a directory record does not open as an entry row " +
    "(the path sealed with purpose 'dir', not 'row')",
    (await threw(() => direct.openRow(
      unb64(row.ciphertext), { accountId: ACCT_A, recordId: SLOT }))) !== null);
}

/* Mandate 1, the other direction: an entry row does not open as a
   directory record. Sealed with sealRow here, then offered to
   openDirectory - which is what would happen if a row's ciphertext were
   ever routed into the directory read. */
{
  const rowBytes = await direct.sealRow(
    JSON.stringify({ weight_kg: 100 }), { accountId: ACCT_A, recordId: "1" });
  check("cross-purpose: an entry row does not open as a directory record",
    (await threw(() => direct.openDirectory(
      rowBytes, { accountId: ACCT_A, recordId: "1" }))) !== null);
}

/* ================================================================== */
/* 3. The membership-key guard (mandate 3): the HMAC, never a raw id.   */

{
  const db = makeDb();
  const thrown = await threw(() => worker.syncDirectoryEntry(direct, env(db),
    RAW_ID, { handle: HANDLE, displayName: DISPLAY, role: ROLE },
    "2026-08-18T10:00:00.000Z"));
  check("guard: a raw Telegram id is refused before a seal - the " +
    "membership oracle never becomes the clear key of a row",
    thrown !== null);
  check("guard: the refused sync stored nothing", db.directory.size === 0);
}

{
  /* And the HMAC itself is accepted: a 64-hex account id seals and stores
     a row, so the guard refuses a raw id without refusing a real one. */
  const db = makeDb();
  const ok = await threw(() => worker.syncDirectoryEntry(direct, env(db),
    ACCT_B, { handle: "someone", displayName: "Someone", role: "admin" },
    "2026-08-18T11:00:00.000Z"));
  check("guard: an account-id HMAC is accepted and stores a row",
    ok === null && db.directory.has(ACCT_B));
}

/* ================================================================== */
/* 4. Roster sync stays current: the UPSERT keeps joined_at and moves   */
/* last_seen_at forward, rewriting the ciphertext each sign-in.         */

{
  const db = makeDb();
  const t0 = "2026-08-18T10:00:00.000Z";
  const t1 = "2026-08-19T10:00:00.000Z";
  await worker.syncDirectoryEntry(direct, env(db), ACCT_A,
    { handle: HANDLE, displayName: DISPLAY, role: ROLE }, t0);
  await worker.syncDirectoryEntry(direct, env(db), ACCT_A,
    { handle: "renamedxyz", displayName: "Renamed Canary", role: "admin" },
    t1);
  const row = db.directory.get(ACCT_A);

  check("upsert: a second sign-in rewrites the ciphertext to the new " +
    "handle, display name and role",
    Boolean(row) && await (async () => {
      const opened = await valueOf(() => direct.openDirectory(
        unb64(row.ciphertext), { accountId: ACCT_A, recordId: SLOT }));
      const parsed = typeof opened === "string"
        ? (await valueOf(() => JSON.parse(opened))) : null;
      return Boolean(parsed) && parsed.handle === "renamedxyz" &&
        parsed.displayName === "Renamed Canary" && parsed.role === "admin";
    })());
  check("upsert: last_seen_at moves forward on the second sign-in",
    Boolean(row) && row.last_seen_at === t1);
  check("upsert: joined_at is unchanged - the first-seen date is stable",
    Boolean(row) && row.joined_at === t0);
}

/* ================================================================== */
/* 5. Mutations. Each fixture is asserted to have CHANGED the source     */
/* before its behavior is read, then it breaks exactly one property the  */
/* checks above rest on - the other direction of each.                   */

async function mutant(label, from, to) {
  const src = workerSrc.replace(from, to);
  check("mutation fixture applied: " + label, src !== workerSrc);
  return loadWorker(src);
}

{
  /* The seal removed: the plaintext record is stored in the clear. The
     dump property must red. */
  const mutated = await mutant("the directory seal removed",
    "const sealed = bytesToBase64(await store.sealDirectory(\n" +
    "    record, { accountId: bound, recordId: DIRECTORY_SLOT }));",
    "const sealed = record;");
  const db = makeDb();
  await mutated.syncDirectoryEntry(direct, env(db), ACCT_A,
    { handle: HANDLE, displayName: DISPLAY, role: ROLE },
    "2026-08-18T10:00:00.000Z");
  const stored = db.directory.get(ACCT_A);
  check("mutation: with the record stored in the clear, the handle is in " +
    "the stored value - the dump check would red",
    Boolean(stored) && stored.ciphertext.includes(HANDLE));
}

{
  /* The purpose flipped to 'row': the record is now an entry row, so it
     opens with openRow and no longer with openDirectory. */
  const mutated = await mutant("the directory purpose flipped to a row",
    "await store.sealDirectory(", "await store.sealRow(");
  const db = makeDb();
  await mutated.syncDirectoryEntry(direct, env(db), ACCT_A,
    { handle: HANDLE, displayName: DISPLAY, role: ROLE },
    "2026-08-18T10:00:00.000Z");
  const stored = db.directory.get(ACCT_A);
  const asDir = await threw(() => direct.openDirectory(
    unb64(stored.ciphertext), { accountId: ACCT_A, recordId: SLOT }));
  const asRow = await valueOf(() => direct.openRow(
    unb64(stored.ciphertext), { accountId: ACCT_A, recordId: SLOT }));
  check("mutation: sealed as a row, the record no longer opens as a " +
    "directory record - the wiring check would red",
    asDir !== null && typeof asRow === "string" && asRow.includes(HANDLE));
}

{
  /* The guard removed: a raw id reaches the seal and keys a row. The
     membership-key check must red. */
  const mutated = await mutant("the membership-key guard removed",
    "const bound = rowIdentity(accountId);", "const bound = accountId;");
  const db = makeDb();
  const thrown = await threw(() => mutated.syncDirectoryEntry(direct, env(db),
    RAW_ID, { handle: HANDLE, displayName: DISPLAY, role: ROLE },
    "2026-08-18T10:00:00.000Z"));
  check("mutation: without the guard a raw Telegram id seals a directory " +
    "row instead of being refused - the guard check would red",
    thrown === null && db.directory.has(RAW_ID));
}

{
  /* The UPSERT widened to touch joined_at: the first-seen date is no
     longer stable. The joined_at check must red. */
  const mutated = await mutant("the upsert widened to overwrite joined_at",
    "last_seen_at = excluded.last_seen_at\"",
    "last_seen_at = excluded.last_seen_at, joined_at = excluded.joined_at\"");
  const db = makeDb();
  const t0 = "2026-08-18T10:00:00.000Z";
  const t1 = "2026-08-19T10:00:00.000Z";
  await mutated.syncDirectoryEntry(direct, env(db), ACCT_A,
    { handle: HANDLE, displayName: DISPLAY, role: ROLE }, t0);
  await mutated.syncDirectoryEntry(direct, env(db), ACCT_A,
    { handle: HANDLE, displayName: DISPLAY, role: ROLE }, t1);
  const row = db.directory.get(ACCT_A);
  check("mutation: with joined_at in the upsert clause it is overwritten " +
    "on the second sign-in - the stable-joined check would red",
    Boolean(row) && row.joined_at === t1);
}

/* ------------------------------------------------------------------ */
const EXPECTED = 25;
console.log(failures
  ? `\nroster-directory FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nroster-directory ran ${performed} checks, expected ${EXPECTED}`
    : `\nroster-directory OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
