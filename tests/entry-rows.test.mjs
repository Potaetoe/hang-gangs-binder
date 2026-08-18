/*
 * Entry rows on the encrypted store, armed. 0.9-M1-S6 (#332), over
 * server/worker.js's submit / read-own / correct / delete routes wired
 * to server/store-crypto.js.
 *
 *     node tests/entry-rows.test.mjs
 *
 * WHAT THIS ARM IS FOR. DESIGN.md, "Trust model: the Worker reads" rules
 * that rows are encrypted at rest under a Worker-held secret and that a
 * member reads their own history back, corrects it and deletes it. This
 * arm drives that whole lifecycle against a REAL local format round trip:
 * server/store-crypto.js runs for real (Node has WebCrypto), so the AAD
 * bindings the routes rest on are exercised rather than stubbed. Only D1
 * is a stub, because D1 is the one dependency Node cannot supply - and
 * the stub reads its scoping off the SQL it is handed (an account clause
 * dropped from a statement changes what the stub returns), so a route
 * that stopped scoping to the caller reds here rather than passing
 * against a stub that hard-coded the rule.
 *
 * WHY THE WORKER IS LOADED BY FILE PATH, not the data: URL the older
 * arms use. server/worker.js now statically imports ./store-crypto.js
 * (0.9-M1-S6); a data: module cannot resolve a relative specifier, so
 * the file has to be imported by its own URL for Node to resolve the
 * import against it. tests/telegram-auth.test.mjs and dev/worker.test.mjs
 * keep their data: loaders and rewrite that one specifier to an absolute
 * URL instead, because they predate this import and their own reasons
 * for the data: URL still hold; this arm is new and takes the simpler
 * path.
 *
 * THE SECURITY PROPERTIES THIS ARM PINS (0.9-M1-S6 security mandates):
 *   1. The accountId reaching the crypto is the 64-hex account-id HMAC,
 *      never a raw Telegram id or a dev: subject - asserted at the store
 *      context and armed by a session carrying a raw id, which reds.
 *   2. Each row's own DB id is the recordId bound into the AAD, so a row
 *      lifted to another id fails to open rather than decrypting.
 *   3. Every route resolves the caller from the session; read-own,
 *      correct and delete act only on rows the caller owns.
 *   4. A correction supersedes rather than mutates: the old row stays
 *      intact and a new row points at it.
 *   5. A raw database dump reveals no plaintext - checked at the store
 *      level and against what the route actually stored.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/* Loaded by path so worker.js's own `import "./store-crypto.js"` resolves
   against the file rather than against a base-less data: URL. */
const worker = await import(pathToFileURL(ROOT + "server/worker.js").href);
const fetchWorker = worker.default.fetch;
const store = await import(pathToFileURL(ROOT + "server/store-crypto.js").href);

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
   ending the run - one route that throws is one red, not sixty skipped. */
async function valueOf(work) {
  try { return await work(); }
  catch (error) { return "<threw " + (error && error.name || error) + ">"; }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256hex = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");
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

/* ------------------------------------------------------------------ */
/* Canaries. Two members, one raw-id session that must never seal, and  */
/* a break-glass admin. None is a real account.                         */

const ORIGIN = "http://localhost:8124";
const STORE_SECRET = "entry-rows arm store secret / not a real one / v1";
const EXPORT_TOKEN = "entry-rows-arm-export-token-belonging-to-nobody";
const ACCT_A =
  "1111111111111111111111111111111111111111111111111111111111111111";
const ACCT_B =
  "2222222222222222222222222222222222222222222222222222222222222222";
const RAW_ID = "606060606";
const TOKEN_A = "session-token-member-a";
const TOKEN_B = "session-token-member-b";
const TOKEN_RAW = "session-token-raw-id-defect";

/* ------------------------------------------------------------------ */
/* A D1 binding that remembers rows and reads its scoping off the SQL.  */
/* It models only the statements these four routes issue; a statement   */
/* it does not recognize throws rather than answering a quiet default,  */
/* so a route that changed shape is caught here rather than passing.    */

function makeDb() {
  const sessions = [];
  const submissions = [];

  const supersededBy = (row) =>
    submissions.some((r) =>
      r.supersedes === row.id && r.account_id === row.account_id);

  function first(sql, args) {
    if (/FROM sessions WHERE token_hash = \?/i.test(sql)) {
      return sessions.find((s) => s.token_hash === args[0]) || null;
    }
    // The correction pre-check: OWNED_BY_CALLER AS mine, ALREADY... AS
    // corrected. `mine` is scoped to the account only because the
    // statement binds one - a lookup that dropped `AND account_id = ?`
    // would find another member's row here exactly as D1 would.
    if (/ AS mine/i.test(sql) && /AS corrected/i.test(sql)) {
      const scoped = /account_id = \?/i.test(sql);
      const [target, account, alreadyTarget] = scoped
        ? [args[0], args[1], args[2]] : [args[0], null, args[1]];
      const mine = submissions.some((r) =>
        r.id === target && (!scoped || r.account_id === account)) ? 1 : 0;
      const corrected =
        submissions.some((r) => r.supersedes === alreadyTarget) ? 1 : 0;
      return { mine, corrected };
    }
    if (/COUNT\(\*\)/i.test(sql) && /FROM submissions/i.test(sql)) {
      const account = /account_id = \?/i.test(sql) ? args[0] : null;
      const mine = submissions.filter((r) =>
        account === null || r.account_id === account);
      const live = mine.filter((r) => !supersededBy(r));
      return {
        total: mine.length,
        superseded: mine.length - live.length,
        last_at: mine.length
          ? mine.map((r) => r.received_at).sort().at(-1) : null,
      };
    }
    throw new Error("unmodelled first(): " + sql);
  }

  function all(sql, args) {
    // The member's own listing. Scoped to the bound account, newest
    // first - the order and the scope are both read off the statement.
    if (/FROM submissions AS mine/i.test(sql) && /ORDER BY/i.test(sql) &&
        !/COUNT/i.test(sql)) {
      const account = /account_id = \?/i.test(sql) ? args[0] : null;
      const mine = submissions.filter((r) =>
        account === null || r.account_id === account);
      mine.sort((a, b) =>
        a.received_at === b.received_at
          ? b.id - a.id
          : (a.received_at < b.received_at ? 1 : -1));
      return {
        results: mine.map((r) => ({
          id: r.id,
          received_at: r.received_at,
          superseded: supersededBy(r) ? 1 : 0,
          ciphertext: r.ciphertext,
        })),
      };
    }
    throw new Error("unmodelled all(): " + sql);
  }

  function run(sql, args) {
    if (/UPDATE sessions SET expires_at/i.test(sql)) {
      const row = sessions.find((s) => s.token_hash === args[1]);
      if (row) row.expires_at = args[0];
      return { meta: {} };
    }
    if (/INSERT INTO submissions/i.test(sql)) {
      const [id, account_id, ciphertext, received_at, supersedes] = args;
      if (submissions.some((r) => r.id === id)) {
        throw new Error("D1_ERROR: UNIQUE constraint failed: submissions.id");
      }
      const pointer = supersedes === undefined ? null : supersedes;
      if (pointer !== null &&
          submissions.some((r) => r.supersedes === pointer)) {
        throw new Error(
          "D1_ERROR: UNIQUE constraint failed: submissions.supersedes");
      }
      submissions.push({ id, account_id, ciphertext, received_at,
        supersedes: pointer });
      return { meta: { changes: 1 } };
    }
    if (/DELETE FROM submissions/i.test(sql)) {
      const scoped = /account_id = \?/i.test(sql);
      const before = submissions.length;
      for (let i = submissions.length - 1; i >= 0; i -= 1) {
        const r = submissions[i];
        if (r.id === args[0] && (!scoped || r.account_id === args[1])) {
          submissions.splice(i, 1);
        }
      }
      return { meta: { changes: before - submissions.length } };
    }
    throw new Error("unmodelled run(): " + sql);
  }

  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => first(sql, args),
            all: async () => all(sql, args),
            run: async () => run(sql, args),
          };
        },
      };
    },
    _sessions: sessions,
    _submissions: submissions,
  };
}

const db = makeDb();
const nowIso = () => new Date().toISOString();
const future = new Date(Date.now() + 3600_000).toISOString();
function seedSession(token, accountId, isAdmin) {
  db._sessions.push({
    token_hash: sha256hex(token), account_id: accountId,
    is_admin: isAdmin ? 1 : 0, is_dev: 0,
    created_at: nowIso(), expires_at: future,
  });
}
seedSession(TOKEN_A, ACCT_A, false);
seedSession(TOKEN_B, ACCT_B, false);
seedSession(TOKEN_RAW, RAW_ID, false);

const env = {
  DB: db,
  STORE_SECRET,
  EXPORT_TOKEN,
  ALLOWED_ORIGINS: ORIGIN,
  // No ACCOUNT_SECRET / ADMIN_TELEGRAM_IDS / DEV_LOGIN_SECRET: member
  // sessions never reach the admin re-read, and none of these routes
  // needs them. Their absence is deliberate, not an oversight.
};

/* Safe views, so an unexpected refusal is one red check rather than a
   crashed run (a bare entries[0] on a 500 body ends the whole arm). */
const ents = (r) =>
  r && r.body && Array.isArray(r.body.entries) ? r.body.entries : [];
const rowById = (id) => db._submissions.find((r) => r.id === id) || null;
const openStored = (id) => {
  const row = rowById(id);
  if (!row) return "<no row>";
  return valueOf(() => direct.openRow(
    new Uint8Array(Buffer.from(row.ciphertext, "base64")),
    { accountId: row.account_id, recordId: String(id) }));
};

async function call(method, path, { token, body } = {}) {
  const headers = { Origin: ORIGIN };
  if (token) headers.Authorization = "Bearer " + token;
  const init = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetchWorker(new Request("https://sit.example" + path, init),
    env);
  let parsed = null;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

/* ================================================================== */
/* Store level: the AAD properties the routes rest on, exercised       */
/* directly against the real format so a route bug and a format bug    */
/* stay separable.                                                     */

const direct = await store.openStore({ STORE_SECRET });
const HANDLE = "torvaldsmxyz";
const SEALED = await valueOf(() =>
  direct.sealRow(JSON.stringify({ handle: HANDLE, weight_kg: 118.4 }),
    { accountId: ACCT_A, recordId: "1" }));

check("store: a row seals and opens under its own account and record id",
  (await valueOf(() =>
    direct.openRow(SEALED, { accountId: ACCT_A, recordId: "1" })))
  .includes(HANDLE));

check("store: dump reveals nothing - the handle is nowhere in the bytes",
  SEALED instanceof Uint8Array && !bytesContain(SEALED, HANDLE));

check("store: a row lifted to another record id fails to open (recordId " +
  "AAD binds the slot)",
  (await threw(() =>
    direct.openRow(SEALED, { accountId: ACCT_A, recordId: "2" }))) !== null);

check("store: a row read under another account fails to open (accountId " +
  "AAD binds the owner)",
  (await threw(() =>
    direct.openRow(SEALED, { accountId: ACCT_B, recordId: "1" }))) !== null);

/* ================================================================== */
/* The HMAC-not-raw-id guard (security mandate 1), as a pure helper.    */

check("rowIdentity accepts a 64-hex account-id HMAC unchanged",
  (await valueOf(() => worker.rowIdentity(ACCT_A))) === ACCT_A);
check("rowIdentity refuses a raw Telegram numeric id",
  (await threw(() => worker.rowIdentity(RAW_ID))) !== null);
check("rowIdentity refuses a dev: subject (mandate 1 names it)",
  (await threw(() => worker.rowIdentity("dev:someone"))) !== null);
check("rowIdentity refuses a missing identity",
  (await threw(() => worker.rowIdentity(undefined))) !== null);

/* ================================================================== */
/* The route lifecycle.                                                 */

/* submit -> read-own, a real round trip through the Worker's own seal. */
const R1 = JSON.stringify({ weight_kg: 118.4, note: HANDLE });
const submitA = await call("POST", "/submit", { token: TOKEN_A, body: { record: R1 } });
check("submit: a member's row is accepted (200)", submitA.status === 200);
const id1 = submitA.body && submitA.body.id;
check("submit: the response carries the new row's id",
  Number.isInteger(id1) && id1 >= 1);

const listA1 = await call("GET", "/my-entries", { token: TOKEN_A });
check("read-own: the member reads their row back (200)", listA1.status === 200);
check("read-own: the round trip returns the plaintext the Worker sealed",
  ents(listA1).length === 1 && ents(listA1)[0].record === R1);
check("read-own: a fresh row is not superseded",
  ents(listA1).length === 1 && ents(listA1)[0].superseded === false);

check("dump: what the route actually stored carries no plaintext",
  (() => {
    const row = rowById(id1);
    if (!row) return false;
    const bytes = new Uint8Array(Buffer.from(row.ciphertext, "base64"));
    return bytes.length > 0 && !bytesContain(bytes, HANDLE);
  })());

/* A correction supersedes: the old row stays intact, a new row points
   at it. */
const R2 = JSON.stringify({ weight_kg: 117.0, note: HANDLE });
const correctA = await call("POST", "/submit",
  { token: TOKEN_A, body: { record: R2, supersedes: id1 } });
check("correct: a correction of an owned row is accepted (200)",
  correctA.status === 200);
const id2 = correctA.body && correctA.body.id;

check("correct: the superseded row was not rewritten - its own supersedes " +
  "stays null (supersede, never mutate)",
  (() => {
    const row = rowById(id1);
    return Boolean(row) && row.supersedes === null;
  })());
check("correct: the old row's sealed bytes are unchanged and still open",
  (await openStored(id1)) === R1);
check("correct: the new row points at the row it supersedes",
  (() => {
    const row = rowById(id2);
    return Boolean(row) && row.supersedes === id1;
  })());

const listA2 = await call("GET", "/my-entries", { token: TOKEN_A });
check("correct: both rows are present after a correction",
  ents(listA2).length === 2);
check("correct: the superseded row reads back flagged, the correction does not",
  (() => {
    const old = ents(listA2).find((r) => r.id === id1);
    const now = ents(listA2).find((r) => r.id === id2);
    return Boolean(old) && Boolean(now) &&
      old.superseded === true && now.superseded === false;
  })());

const meA = await call("GET", "/me", { token: TOKEN_A });
check("me: the count is current-rows-only with tombstones reported beside it",
  Boolean(meA.body) && meA.body.entries === 1 && meA.body.superseded === 1);

/* Correcting an already-corrected row is refused, and told apart safely
   because the caller has proved the row is theirs. */
const twice = await call("POST", "/submit",
  { token: TOKEN_A, body: { record: R2, supersedes: id1 } });
check("correct: correcting an already-corrected row is refused (409)",
  twice.status === 409);

/* ---- cross-account: read, correct and delete all refuse. ---- */
const listB0 = await call("GET", "/my-entries", { token: TOKEN_B });
check("cross-account: member B's listing never carries member A's rows",
  listB0.status === 200 && ents(listB0).length === 0);

const foreignCorrect = await call("POST", "/submit",
  { token: TOKEN_B, body: { record: R1, supersedes: id1 } });
check("cross-account: a correction of another member's row is refused (404 " +
  "- absent and foreign answer alike)", foreignCorrect.status === 404);
check("cross-account: the refused correction stored nothing under B",
  db._submissions.filter((r) => r.account_id === ACCT_B).length === 0);

/* A member deletes their own row: gone from their listing. */
const submitB = await call("POST", "/submit",
  { token: TOKEN_B, body: { record: JSON.stringify({ weight_kg: 90 }) } });
const idB = submitB.body && submitB.body.id;
const delOwn = await call("DELETE", "/submission/" + idB, { token: TOKEN_B });
check("delete: a member deletes their own row (200)", delOwn.status === 200);
const listBAfter = await call("GET", "/my-entries", { token: TOKEN_B });
check("delete: the deleted row is gone from the member's listing",
  listBAfter.status === 200 && ents(listBAfter).length === 0);

/* A member cannot delete another member's row: the call succeeds
   (deleting nothing succeeds) but the row survives. */
const submitA2 = await call("POST", "/submit",
  { token: TOKEN_A, body: { record: JSON.stringify({ weight_kg: 120 }) } });
const idA2 = submitA2.body && submitA2.body.id;
const delForeign = await call("DELETE", "/submission/" + idA2, { token: TOKEN_B });
check("delete: a member's delete of another's row deletes nothing",
  delForeign.status === 200 &&
  db._submissions.some((r) => r.id === idA2));

/* Break-glass admin may delete any row. */
const delAdmin = await call("DELETE", "/submission/" + idA2,
  { token: EXPORT_TOKEN });
check("delete: a break-glass admin deletes any row",
  delAdmin.status === 200 && !db._submissions.some((r) => r.id === idA2));

/* The raw-id session cannot seal a row: the guard refuses before the
   crypto is reached (mandate 1's route arm). */
const rawSubmit = await call("POST", "/submit",
  { token: TOKEN_RAW, body: { record: JSON.stringify({ weight_kg: 1 }) } });
check("guard: a session carrying a raw id cannot submit - it never reaches " +
  "the seal", rawSubmit.status >= 500);
check("guard: the raw-id session stored nothing",
  db._submissions.every((r) => r.account_id !== RAW_ID));

/* ---- shape and auth guards on submit. ---- */
const noBody = await call("POST", "/submit", { token: TOKEN_A });
check("submit: a request with no body is refused (400)", noBody.status === 400);
const noRecord = await call("POST", "/submit", { token: TOKEN_A, body: {} });
check("submit: a missing record is refused (400)", noRecord.status === 400);
const empty = await call("POST", "/submit", { token: TOKEN_A, body: { record: "" } });
check("submit: an empty record is refused (400)", empty.status === 400);
const huge = await call("POST", "/submit",
  { token: TOKEN_A, body: { record: "x".repeat(100_000) } });
check("submit: an over-large record is refused (413)", huge.status === 413);
const noSession = await call("POST", "/submit", { body: { record: R1 } });
check("submit: no session is refused (401)", noSession.status === 401);
const readNoSession = await call("GET", "/my-entries");
check("read-own: no session is refused (401)", readNoSession.status === 401);

/* Newest-first ordering, proved with two rows a moment apart so their
   receipt times differ. */
const firstOfPair = await call("POST", "/submit",
  { token: TOKEN_B, body: { record: JSON.stringify({ n: 1 }) } });
await sleep(3);
const secondOfPair = await call("POST", "/submit",
  { token: TOKEN_B, body: { record: JSON.stringify({ n: 2 }) } });
const listOrder = await call("GET", "/my-entries", { token: TOKEN_B });
check("read-own: the listing is newest first",
  ents(listOrder).length === 2 &&
  ents(listOrder)[0].id === (secondOfPair.body && secondOfPair.body.id) &&
  ents(listOrder)[1].id === (firstOfPair.body && firstOfPair.body.id));

/* ------------------------------------------------------------------ */
const EXPECTED = 38;
console.log(failures
  ? `\nentry-rows FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nentry-rows ran ${performed} checks, expected ${EXPECTED}`
    : `\nentry-rows OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
