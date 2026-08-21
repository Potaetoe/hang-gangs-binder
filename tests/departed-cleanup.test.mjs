/*
 * Departed-member cleanup (0.9-M3-S15, #420; the ruled design #385,
 * rule 4 - the only per-member power is erasing a DEPARTED member's
 * rows).
 *
 *     node tests/departed-cleanup.test.mjs
 *
 * FOUR THINGS ARE ON TRIAL HERE, and each is a way an erasing power can
 * be wrong without anything else noticing:
 *
 *   1. THE TRANSACTION. Erasing one account removes exactly four row
 *      classes for exactly that account and touches nobody else's rows.
 *      The two-member fixture is the proof: erase one, and the other
 *      member's rows are byte-identical afterwards.
 *   2. THE DOOR. Both routes are admin-only, in both directions, and a
 *      refusal erases nothing - a route that 401s and deletes anyway
 *      would pass a status-code check and fail the only thing that
 *      matters.
 *   3. THE GUARDS. A malformed id, an admin's own account, and the last
 *      `admin` row that still grants are each refused, and the refusal
 *      leaves the store exactly as it was.
 *   4. THE LOG LINE. One line per erase, carrying who erased, the short
 *      id, the verdict and the COUNTS - never a row, never a handle,
 *      never a numeric Telegram id.
 *
 * THE VERDICT SOURCE IS UNDER OWNER RULING AND ITS ARMS ARE RED ON
 * PURPOSE (#420, the fork raised at build time). The route's oracle -
 * "has this account left the group?" - cannot be answered from anything
 * this database stores: getChatMember needs the numeric Telegram id,
 * `directory` is keyed by the HMAC of one, and the sealed record holds
 * the handle, the display name and the role and no id at all. Until the
 * owner rules how the verdict may be obtained, departedVerdict() in
 * server/worker.js answers "unknown" for every account and the route
 * fails closed. The arms in section 5 below assert what the route must
 * do once a verdict CAN be had; they are expected to fail, and the
 * count at the foot of this file says how many. Deleting them to make
 * the file green would be deleting the contract.
 *
 * WHY THE WHOLE WORKER RATHER THAN ITS PARTS, and why a data: URL: the
 * same reasons tests/admin-identity.test.mjs and
 * tests/telegram-auth.test.mjs state. The router decides whether a
 * refusal is 401 or 403; server/worker.js has no package.json making a
 * bare import resolve as ESM, and rewriting its relative specifiers is
 * what lets the file run from its own bytes.
 *
 * THE D1 STUB REFUSES WHAT IT DOES NOT RECOGNIZE. Every statement this
 * slice's paths issue is matched by shape and answered; anything else
 * throws by name. A stub that quietly answered "no rows" to a statement
 * it had never seen would turn a route that stopped working into an arm
 * that stays green, which this repository holds to be worse than no arm.
 *
 * THE ARMS READ REAL SHIPPED STATE. Nothing below asserts an absence
 * against a stub default: every "this is gone", "this survived" and
 * "this was refused" check seeds the opposite state first - real rows in
 * all four tables for two real accounts - and then asserts. A default
 * that already satisfies the assertion proves nothing (AGENTS.md,
 * "Verification").
 *
 * CANARIES, NOT PLACEHOLDERS. The secrets and ids below are distinctive
 * strings that appear nowhere else. None is key-shaped and none is real.
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, createHmac } from "node:crypto";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKER_PATH = ROOT + "server/worker.js";

const readText = async (path) =>
  (await readFile(path, "utf8")).replace(/\r\n/g, "\n");

const workerSrc = await readText(WORKER_PATH);

const serverModule = (name) => pathToFileURL(ROOT + "server/" + name).href;

async function loadWorker(src) {
  const resolved = src.replace(/(\bfrom\s*)"\.\/([\w.-]+\.js)"/g,
    (whole, from, name) => from + '"' + serverModule(name) + '"');
  return import("data:text/javascript," + encodeURIComponent(resolved));
}

const workerModule = await loadWorker(workerSrc);
const worker = workerModule.default;

let performed = 0;
let failures = 0;
const failed = [];
function check(label, condition) {
  performed += 1;
  if (!condition) { failures += 1; failed.push(label); }
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* ------------------------------------------------------------------ */
/* Canaries.                                                           */

const ACCOUNT_SECRET = "canary-s15-account-secret-belonging-to-nobody";
const EXPORT_TOKEN = "canary-s15-export-token-belonging-to-nobody";
const BOT_TOKEN = "canary-s15-bot-token-belonging-to-nobody";
const CHAT_ID = "canary-s15-chat-id-belonging-to-nobody";
const ORIGIN = "http://localhost:8130";

const accountFor = (numericId) =>
  createHmac("sha256", ACCOUNT_SECRET).update(String(numericId)).digest("hex");

const sha256hex = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/* Four people. GONE has left the group and is what this slice erases;
   STAYS is the second member of the fixture, whose rows must be
   untouched afterwards. ADMIN does the erasing. FLAGGED exists only to
   keep a second granting admin row in the table, so that erasing ADMIN
   is not refused by the last-granting-admin guard for the wrong
   reason. */
const GONE_ID = "751010101";
const STAYS_ID = "752020202";
const ADMIN_ID = "753030303";
const FLAGGED_ID = "754040404";

const GONE = accountFor(GONE_ID);
const STAYS = accountFor(STAYS_ID);
const ADMIN = accountFor(ADMIN_ID);
const FLAGGED = accountFor(FLAGGED_ID);

/* ------------------------------------------------------------------ */
/* The D1 stub.                                                        */

function makeDb(seed) {
  const sessions = new Map();
  const directory = new Map();
  const content = new Map();
  const adminLog = [];
  let membership = ((seed && seed.membership) || []).slice();
  let submissions = ((seed && seed.submissions) || []).slice();
  let logSequence = 0;

  for (const row of (seed && seed.sessions) || []) {
    sessions.set(row.token_hash, row);
  }
  for (const row of (seed && seed.directory) || []) {
    directory.set(row.account_id, row);
  }

  const grants = (id) =>
    typeof id === "string" && /^[0-9a-f]{64}$/.test(id);

  /*
   * THE FOUR ERASING STATEMENTS, PINNED WHOLE AND WRITTEN OUT BY HAND.
   *
   * This is the difference between a proof and a formality, and it was
   * found by mutation rather than by argument: with the branches below
   * dispatching on startsWith() and filtering in JavaScript from the
   * BOUND ARGUMENT, `DELETE FROM submissions WHERE account_id = ? OR
   * 1=1` was answered exactly as the correctly scoped statement was.
   * The two-member proof stayed green over a delete that would have
   * emptied the whole table on real D1 - the arm asserting the one
   * thing it exists to assert, and proving nothing.
   *
   * A stub cannot parse SQL, and tests/admin-identity.test.mjs already
   * records where that road ends ("a SQL engine in a test stub"). So
   * this goes the other way: the statement must be EXACTLY one of the
   * four below, byte for byte, or it falls through to the throw at the
   * foot of answer(). Widening the predicate, dropping a COLLATE,
   * losing the guard clause, or reordering the batch all become an arm
   * that reds and names the statement it did not recognize.
   *
   * WRITTEN OUT RATHER THAN IMPORTED FROM THE WORKER, for the reason
   * this repository already applies to Telegram's signing scheme: an
   * arm built from the code it is checking agrees with any mistake in
   * it. The cost is that a deliberate change to one of these
   * statements edits this file too, which is the intended cost - these
   * four are the whole of the erasing power.
   */
  const HEX64 = (column) =>
    "length(" + column + ") = 64 AND " + column + " NOT GLOB '*[^0-9a-f]*'";
  const ERASING = new Set([
    "DELETE FROM submissions WHERE account_id = ?",
    "DELETE FROM directory WHERE account_id = ?",
    "DELETE FROM sessions WHERE account_id = ?",
    "DELETE FROM membership WHERE account_id = ? COLLATE NOCASE" +
      " AND (role <> 'admin'" +
      " OR NOT (" + HEX64("account_id") + ")" +
      " OR (SELECT COUNT(*) FROM membership AS granting" +
      " WHERE granting.role = 'admin' AND " +
      HEX64("granting.account_id") + ") > 1)",
  ]);
  const erasing = (sql) => /^DELETE FROM (submissions|directory)/.test(sql) ||
    /^DELETE FROM (sessions|membership) WHERE account_id = \?/.test(sql);

  /* The count of `admin` rows that would actually grant - the same
     question grantsAnythingSql() asks in the Worker, answered here in
     JavaScript rather than parsed out of the statement, because the
     shape this stub has to get right is the ANSWER and not the SQL. */
  const grantingAdmins = () => membership.filter((row) =>
    row.role === "admin" && grants(row.account_id)).length;

  function answer(sql, args) {
    /* The pin, checked before any branch below can answer. A statement
       that erases and is not one of the four exact texts is refused
       here rather than served by a prefix match that cannot see what
       was added to it. */
    if (erasing(sql) && !ERASING.has(sql)) {
      throw new Error("an erasing statement did not match the pinned " +
        "text byte for byte, so the predicate this arm proves is scoped " +
        "to one account has changed and the proof no longer covers it: " +
        sql);
    }

    /* -------- sessions -------- */
    if (sql.startsWith("SELECT account_id, is_admin")) {
      return sessions.get(args[0]) || null;
    }
    if (sql.startsWith("DELETE FROM sessions WHERE token_hash")) {
      sessions.delete(args[0]);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM sessions WHERE expires_at")) {
      let changes = 0;
      for (const [key, row] of [...sessions]) {
        if (row.expires_at <= args[0]) { sessions.delete(key); changes += 1; }
      }
      return { meta: { changes: changes } };
    }
    if (sql.startsWith("DELETE FROM sessions WHERE account_id")) {
      let changes = 0;
      for (const [key, row] of [...sessions]) {
        if (row.account_id === args[0]) { sessions.delete(key); changes += 1; }
      }
      return { meta: { changes: changes } };
    }
    if (sql.startsWith("UPDATE sessions SET expires_at")) {
      const row = sessions.get(args[1]);
      if (row) row.expires_at = args[0];
      return { meta: { changes: row ? 1 : 0 } };
    }

    /* -------- membership -------- */
    if (sql.startsWith("SELECT account_id FROM membership WHERE role")) {
      return { results: membership.filter((row) => row.role === args[0])
        .map((row) => ({ account_id: row.account_id })) };
    }
    /* The erase's own pre-check: does this account hold a granting
       `admin` row, and is it the last one? Answered as two named
       columns so the Worker reads a shape rather than a position. */
    if (sql.startsWith("SELECT (SELECT COUNT(*) FROM membership")) {
      const wanted = String(args[0]).toLowerCase();
      const target = membership.find((row) =>
        row.account_id.toLowerCase() === wanted && row.role === "admin" &&
        grants(row.account_id));
      return { granting: grantingAdmins(), holds: target ? 1 : 0 };
    }
    if (sql.startsWith("DELETE FROM membership WHERE account_id = ? COLLATE " +
      "NOCASE AND role")) {
      const [wanted, role] = args;
      const guarded = /granting/.test(sql);
      const target = membership.find((row) =>
        row.account_id.toLowerCase() === wanted && row.role === role);
      let blocked = false;
      if (guarded && target) {
        blocked = grants(target.account_id) && grantingAdmins() <= 1;
      }
      if (!blocked) {
        membership = membership.filter((row) =>
          !(row.account_id.toLowerCase() === wanted && row.role === role));
      }
      return { meta: { changes: blocked || !target ? 0 : 1 } };
    }
    /* The erase deletes every role this account holds, so it names no
       role at all - and it carries the same last-granting-admin guard
       the single-row delete does, which is why the stub has to honor
       the guard here too rather than only on the role-scoped form. */
    if (sql.startsWith("DELETE FROM membership WHERE account_id")) {
      const wanted = String(args[0]).toLowerCase();
      const guarded = /granting/.test(sql);
      const doomed = membership.filter((row) =>
        row.account_id.toLowerCase() === wanted);
      const protectedRow = guarded ? doomed.find((row) =>
        row.role === "admin" && grants(row.account_id) &&
        grantingAdmins() <= 1) : undefined;
      membership = membership.filter((row) =>
        row.account_id.toLowerCase() !== wanted || row === protectedRow);
      return { meta: { changes: doomed.length - (protectedRow ? 1 : 0) } };
    }

    /* -------- submissions -------- */
    if (sql.startsWith("DELETE FROM submissions WHERE account_id")) {
      const before = submissions.length;
      submissions = submissions.filter((row) => row.account_id !== args[0]);
      return { meta: { changes: before - submissions.length } };
    }

    /* -------- directory -------- */
    if (sql.startsWith("DELETE FROM directory WHERE account_id")) {
      const had = directory.has(args[0]);
      directory.delete(args[0]);
      return { meta: { changes: had ? 1 : 0 } };
    }
    if (sql.startsWith("SELECT account_id, last_seen_at FROM directory")) {
      const limit = Number(/LIMIT (\d+)/.exec(sql)[1]);
      return { results: [...directory.values()]
        .filter((row) => row.last_seen_at < args[0])
        .sort((a, b) => String(a.last_seen_at).localeCompare(b.last_seen_at))
        .slice(0, limit)
        .map((row) => ({ account_id: row.account_id,
          last_seen_at: row.last_seen_at })) };
    }

    /* -------- membership labels, for the list -------- */
    if (sql.startsWith("SELECT account_id, label FROM membership")) {
      return { results: membership.map((row) =>
        ({ account_id: row.account_id, label: row.label })) };
    }

    /* -------- admin_log -------- */
    if (sql.startsWith("INSERT INTO admin_log")) {
      logSequence += 1;
      const [at, account_id, action, name, summary] = args;
      adminLog.push({ id: logSequence, at, account_id, action, name,
        summary });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("SELECT at, account_id, action, name, summary")) {
      const limit = Number(/LIMIT (\d+)/.exec(sql)[1]);
      return { results: adminLog.slice()
        .sort((a, b) => (a.at === b.at ? b.id - a.id
          : (a.at < b.at ? 1 : -1)))
        .slice(0, limit)
        .map((row) => ({ at: row.at, account_id: row.account_id,
          action: row.action, name: row.name, summary: row.summary })) };
    }

    throw new Error("the D1 stub was handed a statement it does not " +
      "recognize, which means a path this arm covers changed shape " +
      "without the arm being told: " + sql);
  }

  const bound = (sql, args) => ({
    run: async () => answer(sql, args),
    first: async () => answer(sql, args),
    all: async () => answer(sql, args),
    _sql: sql,
    _args: args,
  });

  return {
    sessions, content, adminLog, directory,
    membership: () => membership,
    submissions: () => submissions,
    DB: {
      prepare: (sql) => Object.assign(
        { bind: (...args) => bound(sql, args) }, bound(sql, [])),
      batch: async (statements) => statements.map((statement) =>
        answer(statement._sql, statement._args)),
    },
  };
}

function envFor(db, overrides) {
  return Object.assign({
    DB: db.DB,
    ACCOUNT_SECRET: ACCOUNT_SECRET,
    STORE_SECRET: "canary-s15-store-secret-belonging-to-nobody-v1",
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_GROUP_CHAT_ID: CHAT_ID,
    EXPORT_TOKEN: EXPORT_TOKEN,
    ALLOWED_ORIGINS: ORIGIN,
  }, overrides || {});
}

/* ------------------------------------------------------------------ */
/* Calling, and the seams swapped for the length of a call.            */

async function call(env, method, path, options) {
  const opts = options || {};
  const headers = Object.assign({ Origin: ORIGIN }, opts.headers || {});
  const init = { method: method, headers: headers };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = typeof opts.body === "string"
      ? opts.body : JSON.stringify(opts.body);
  }
  const response = await worker.fetch(
    new Request("https://sit.example.workers.dev" + path, init), env);
  const text = await response.clone().text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
  return { status: response.status, body: parsed, text: text };
}

const bearer = (token) => ({ Authorization: "Bearer " + token });

function botSaying(status) {
  return async () => new Response(
    JSON.stringify({ ok: true, result: { status: status } }),
    { status: 200, headers: { "Content-Type": "application/json" } });
}

async function withBot(botFetch, fn) {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const lines = [];
  globalThis.fetch = botFetch;
  console.log = (...args) => lines.push(args.map((a) =>
    typeof a === "string" ? a : JSON.stringify(a)).join(" "));
  try {
    return { value: await fn(), logs: lines.join("\n") };
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
}

/* A live session seeded straight into the table. Adminness is seeded as
   the shipped columns carry it, so nothing here depends on a sign-in
   this slice does not test. */
function sessionRow(token, accountId, fields) {
  const now = Date.now();
  return Object.assign({
    token_hash: sha256hex(token),
    account_id: accountId,
    is_admin: 0,
    is_dev: 0,
    admin_via: null,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 10 * 60 * 1000).toISOString(),
  }, fields || {});
}

const OLD = "2020-01-01T00:00:00.000Z";
const RECENT = new Date(Date.now() - 60 * 1000).toISOString();

/*
 * The two-member fixture, built fresh for every scenario so that no arm
 * below can be made green by an earlier one's leftovers.
 *
 * GONE and STAYS each hold rows in ALL FOUR classes the erase removes -
 * two submissions, a directory row, a membership row and two sessions
 * apiece. That symmetry is the whole point: an erase that scoped
 * anything to the wrong account, or forgot a clause, moves one of
 * STAYS's rows, and the byte comparison below sees it.
 */
function fixture() {
  return makeDb({
    submissions: [
      { id: 11, account_id: GONE, ciphertext: "gone-one",
        received_at: "2025-01-01T00:00:00.000Z", supersedes: null },
      { id: 12, account_id: GONE, ciphertext: "gone-two",
        received_at: "2025-02-01T00:00:00.000Z", supersedes: 11 },
      { id: 21, account_id: STAYS, ciphertext: "stays-one",
        received_at: "2025-01-05T00:00:00.000Z", supersedes: null },
      { id: 22, account_id: STAYS, ciphertext: "stays-two",
        received_at: "2025-02-05T00:00:00.000Z", supersedes: 21 },
      { id: 31, account_id: ADMIN, ciphertext: "admin-one",
        received_at: "2025-03-01T00:00:00.000Z", supersedes: null },
    ],
    directory: [
      { account_id: GONE, ciphertext: "sealed-gone", joined_at: OLD,
        last_seen_at: OLD },
      { account_id: STAYS, ciphertext: "sealed-stays", joined_at: OLD,
        last_seen_at: RECENT },
      { account_id: ADMIN, ciphertext: "sealed-admin", joined_at: OLD,
        last_seen_at: RECENT },
    ],
    membership: [
      { account_id: GONE, role: "always_allow", label: "gone-bypass",
        added_at: OLD, added_by: ADMIN },
      { account_id: STAYS, role: "always_allow", label: "stays-bypass",
        added_at: OLD, added_by: ADMIN },
      { account_id: ADMIN, role: "admin", label: "the-eraser",
        added_at: OLD, added_by: ADMIN },
      { account_id: FLAGGED, role: "admin", label: "the-other-admin",
        added_at: OLD, added_by: ADMIN },
    ],
    sessions: [
      sessionRow("gone-token-a", GONE),
      sessionRow("gone-token-b", GONE),
      sessionRow("stays-token-a", STAYS),
      sessionRow("stays-token-b", STAYS),
      sessionRow("admin-token", ADMIN, { is_admin: 1, admin_via: "flag" }),
      sessionRow("member-token", STAYS),
    ],
  });
}

/* Everything STAYS owns, as bytes, so "untouched" is a comparison
   rather than a count. Sorted by a stable key first: a row order that
   changed while the rows did not is not a finding, and folding it in
   would make this proof fire on the wrong thing. */
function belongingTo(db, accountId, options) {
  const sliding = Boolean(options && options.callerOwnSession);
  return JSON.stringify({
    submissions: db.submissions()
      .filter((row) => row.account_id === accountId)
      .sort((a, b) => a.id - b.id),
    directory: [...db.directory.values()]
      .filter((row) => row.account_id === accountId),
    membership: db.membership()
      .filter((row) => row.account_id === accountId)
      .sort((a, b) => a.role.localeCompare(b.role)),
    sessions: [...db.sessions.values()]
      .filter((row) => row.account_id === accountId)
      .sort((a, b) => a.token_hash.localeCompare(b.token_hash))
      /* THE CALLER'S OWN DEADLINE SLIDES, BY DESIGN, and only the
         caller's. sessionFor() moves `expires_at` forward on every
         request the session makes (server/schema.sql's `sessions`
         block: "every row's deadline moves forward each time the
         session is used"), so the erasing admin's own row differs
         after any call they make - including a refused one. Comparing
         it raw would fail on the idle window rather than on anything
         this slice does, so the deadline is dropped for the CALLER's
         rows alone. Every other account's sessions, including the two
         the survivor holds, are compared whole: nothing this Worker
         does may move those, and if one moves, the proof must see it. */
      .map((row) => sliding
        ? Object.assign({}, row, { expires_at: "(slides per request)" })
        : row),
  });
}

const countsFor = (db, accountId) => ({
  submissions: db.submissions()
    .filter((row) => row.account_id === accountId).length,
  directory: [...db.directory.values()]
    .filter((row) => row.account_id === accountId).length,
  membership: db.membership()
    .filter((row) => row.account_id === accountId).length,
  sessions: [...db.sessions.values()]
    .filter((row) => row.account_id === accountId).length,
});

const ADMIN_BEARER = bearer("admin-token");
const MEMBER_BEARER = bearer("member-token");

/* ------------------------------------------------------------------ */
/* 0. The fixture is real before anything is asked of it.              */

{
  const db = fixture();
  const gone = countsFor(db, GONE);
  const stays = countsFor(db, STAYS);
  check("the fixture seeds GONE rows in all four classes (so an erase " +
    "below has something to remove and the counts cannot be satisfied " +
    "by an empty table)",
    gone.submissions === 2 && gone.directory === 1 &&
    gone.membership === 1 && gone.sessions === 2);
  check("the fixture seeds STAYS rows in all four classes (so the " +
    "byte-identity proof below is comparing something)",
    stays.submissions === 2 && stays.directory === 1 &&
    stays.membership === 1 && stays.sessions === 3);
}

/* ------------------------------------------------------------------ */
/* 1. THE TRANSACTION, CALLED DIRECTLY. This is the proof the batch    */
/*    consult reads first, and it is aimed at eraseAccount() itself    */
/*    rather than at the route.                                        */
/*                                                                     */
/* WHY NOT THROUGH THE ROUTE, when section 1b below does exactly that: */
/* because the route cannot erase anything while departedVerdict()     */
/* answers "unknown" for every account, and a byte-identity proof that */
/* runs after a refusal proves NOTHING - the survivor's rows are       */
/* unchanged because nothing was erased at all, and the check passes   */
/* vacuously. That is the stub-default failure AGENTS.md names as the  */
/* most-repeated defect of 0.9-M2, and it would have been sitting in   */
/* this file's flagship arm. Calling the transaction directly is what  */
/* makes the proof real TODAY, independent of the open verdict         */
/* question; section 1b re-proves it end to end once there is a        */
/* verdict, and its arms are red until then.                           */

{
  const db = fixture();
  const env = envFor(db);
  const staysBefore = belongingTo(db, STAYS);
  const goneBefore = countsFor(db, GONE);

  const removed = await workerModule.eraseAccount(env, GONE);

  check("the transaction really had something to erase (the proof " +
    "below is not passing over an empty table)",
    goneBefore.submissions === 2 && goneBefore.directory === 1 &&
    goneBefore.membership === 1 && goneBefore.sessions === 2);

  const gone = countsFor(db, GONE);
  check("the transaction removes every submissions row for the account",
    gone.submissions === 0);
  check("the transaction removes the account's directory row",
    gone.directory === 0);
  check("the transaction removes every membership row the account held",
    gone.membership === 0);
  check("the transaction removes every session the account held",
    gone.sessions === 0);

  check("THE TWO-MEMBER PROOF: the other member's rows are byte-" +
    "identical after the transaction, in all four classes",
    belongingTo(db, STAYS) === staysBefore);

  check("the transaction reports the count it removed in each class",
    removed.submissions === 2 && removed.directory === 1 &&
    removed.membership === 1 && removed.sessions === 2);

  /* The survivor's superseding row pointed at a row of their own, and
     the erased account's chain is gone entirely - so nothing here
     followed a `supersedes` pointer out of the account it was scoped
     to. A cascade would turn erasing one member into deleting another
     member's entry, which is the one thing this must never do. */
  check("no `supersedes` pointer dragged another account's row out " +
    "with the erased chain",
    db.submissions().filter((row) => row.account_id === STAYS).length === 2 &&
    db.submissions().filter((row) => row.account_id === ADMIN).length === 1);
}

/* ------------------------------------------------------------------ */
/* 1b. The same thing end to end, through the route. RED until the     */
/*     verdict question at #420 is ruled - see this file's header.     */

{
  const db = fixture();
  const env = envFor(db);
  const staysBefore = belongingTo(db, STAYS);
  const adminBefore = belongingTo(db, ADMIN, { callerOwnSession: true });

  const { value: answer } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + GONE,
      { headers: ADMIN_BEARER }));

  check("the erase answers 200 for a departed account",
    answer.status === 200);

  const gone = countsFor(db, GONE);
  check("every submissions row belonging to the erased account is gone",
    gone.submissions === 0);
  check("the erased account's directory row is gone", gone.directory === 0);
  check("every membership row the erased account held is gone",
    gone.membership === 0);
  check("every session the erased account held is gone",
    gone.sessions === 0);

  check("through the route too: the other member's rows are byte-" +
    "identical after the erase, in all four classes",
    belongingTo(db, STAYS) === staysBefore);
  check("the erasing admin's own rows are byte-identical after the " +
    "erase (the third account nobody named)",
    belongingTo(db, ADMIN, { callerOwnSession: true }) === adminBefore);

  check("the answer reports the counts it removed, per row class",
    answer.body && answer.body.removed &&
    answer.body.removed.submissions === 2 &&
    answer.body.removed.directory === 1 &&
    answer.body.removed.membership === 1 &&
    answer.body.removed.sessions === 2);
}

/* ------------------------------------------------------------------ */
/* 2. The door: admin only, in both directions, and a refusal erases   */
/*    nothing.                                                         */

for (const [who, headers] of [
  ["a member session", MEMBER_BEARER],
  ["no credential at all", {}],
  ["a token that resolves to no session", bearer("not-a-session")],
]) {
  const db = fixture();
  const env = envFor(db);
  const before = belongingTo(db, GONE);

  const { value: erase } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + GONE, { headers: headers }));
  check("the erase refuses " + who, erase.status === 401);
  check("the erase erased nothing when it refused " + who +
    " (the refusal is a refusal, not a status code over a deletion)",
    belongingTo(db, GONE) === before);

  const { value: list } = await withBot(botSaying("left"), () =>
    call(env, "GET", "/admin-departed", { headers: headers }));
  check("the departed list refuses " + who, list.status === 401);
  check("the departed list tells " + who + " nothing about who is in " +
    "the group (no list in the refusal body)",
    !list.body || !Object.prototype.hasOwnProperty.call(list.body,
      "departed"));
}

/* A member session is refused even though rows really are there to
   return - the refusal is about who is asking, never about an empty
   table. Forced rather than assumed, per AGENTS.md, "Verification". */
{
  const db = fixture();
  check("the fixture really does hold a stale directory row for the " +
    "member-session refusal above to be withholding something",
    [...db.directory.values()].some((row) => row.last_seen_at === OLD));
}

/* ------------------------------------------------------------------ */
/* 3. The guards. Each refuses, and each leaves the store as it was.   */

{
  const db = fixture();
  const env = envFor(db);
  const before = belongingTo(db, GONE);
  for (const [why, bad] of [
    ["not hex at all", "not-hex"],
    ["one character short", GONE.slice(0, 63)],
    ["one character long", GONE + "0"],
    ["the right bytes in the wrong case", GONE.toUpperCase()],
    ["a traversal attempt", "../../etc"],
  ]) {
    const { value } = await withBot(botSaying("left"), () =>
      call(env, "DELETE", "/admin-departed/" + encodeURIComponent(bad),
        { headers: ADMIN_BEARER }));
    check("a malformed account id is refused rather than matched " +
      "loosely: " + why, value.status === 404);
  }
  check("no malformed id erased anything", belongingTo(db, GONE) === before);
}

{
  const db = fixture();
  const env = envFor(db);
  const before = belongingTo(db, ADMIN, { callerOwnSession: true });
  const { value } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + ADMIN,
      { headers: ADMIN_BEARER }));
  /* THE STATUS ALONE IS NOT THE ASSERTION, and a mutation proved why:
     every refusal this route can give is a 409, so deleting the
     self-erase guard leaves the caller falling through to the
     unknown-verdict refusal - same status, same shape, arm still
     green over a guard that is gone. The refusal is therefore
     identified by the reason it gives, which is the thing that
     actually differs. */
  check("an admin may not erase their own account through this route",
    value.status === 409 &&
    /you are signed/.test(JSON.stringify(value.body || {})));
  check("the refused self-erase left the admin's own rows untouched",
    belongingTo(db, ADMIN, { callerOwnSession: true }) === before);
}

/*
 * The last granting `admin` row is not erasable through this door
 * either. server/schema.sql states the invariant - an empty admin table
 * locks everybody out - and handleDeleteMembership guards it inside its
 * own DELETE. An erase that deleted every membership row for an account
 * would be a back door around that guard, so this route refuses BEFORE
 * it deletes anything, and the membership DELETE carries the same guard
 * clause underneath as a second wall.
 */
{
  const db = makeDb({
    submissions: [{ id: 41, account_id: GONE, ciphertext: "x",
      received_at: OLD, supersedes: null }],
    directory: [{ account_id: GONE, ciphertext: "y", joined_at: OLD,
      last_seen_at: OLD }],
    membership: [
      { account_id: GONE, role: "admin", label: "the-only-admin",
        added_at: OLD, added_by: GONE },
    ],
    sessions: [
      sessionRow("solo-admin-token", ADMIN, { is_admin: 1,
        admin_via: "secret" }),
    ],
  });
  const env = envFor(db, { ADMIN_TELEGRAM_IDS: ADMIN_ID });
  const before = belongingTo(db, GONE);
  const { value } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + GONE,
      { headers: bearer("solo-admin-token") }));
  check("erasing the holder of the last granting admin row is refused, " +
    "by THAT guard and not by some later refusal that shares its status",
    value.status === 409 &&
    /last admin row/.test(JSON.stringify(value.body || {})));
  check("that refusal erased nothing at all - not the submissions, not " +
    "the directory row, not the admin row",
    belongingTo(db, GONE) === before);
}

/* ------------------------------------------------------------------ */
/* 4. The log line: counts and a verdict, never a row and never a      */
/*    handle.                                                          */

{
  const db = fixture();
  const env = envFor(db);
  await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + GONE,
      { headers: ADMIN_BEARER }));

  check("exactly one log line is appended per erase",
    db.adminLog.length === 1);
  const line = db.adminLog[0] || {};
  check("the log line names the erasing admin as the actor",
    line.account_id === ADMIN);
  check("the log line's action names the erase", line.action === "erase");
  check("the log line's subject is the SHORT id, not the whole HMAC",
    typeof line.name === "string" && line.name.length < GONE.length &&
    line.name.length > 0 && GONE.startsWith(line.name));
  check("the log line's summary carries the bot's verdict",
    typeof line.summary === "string" && /left/.test(line.summary));
  check("the log line's summary carries the counts of what was removed",
    /2/.test(line.summary) && /submission/i.test(line.summary));

  const whole = JSON.stringify(db.adminLog);
  check("no ciphertext of any erased row reaches the log",
    !/gone-one|gone-two|sealed-gone/.test(whole));
  check("no label of any erased row reaches the log",
    !/gone-bypass/.test(whole));
  check("no numeric Telegram id reaches the log",
    !whole.includes(GONE_ID) && !whole.includes(ADMIN_ID));
  check("the erased account's full HMAC does not reach the log's " +
    "subject column",
    line.name !== GONE);
  check("the log line's summary is bounded rather than unbounded",
    typeof line.summary === "string" && line.summary.length <= 200);
}

/* A refused erase writes NO line. A log that recorded attempts would be
   answering a different question from the one it is asked, and the
   append-after-the-write rule noteAdminWrite states is what makes
   "this happened" mean it. */
{
  const db = fixture();
  const env = envFor(db);
  await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + GONE,
      { headers: MEMBER_BEARER }));
  check("a refused erase appends no log line", db.adminLog.length === 0);
}

/* ------------------------------------------------------------------ */
/* 5. THE VERDICT SOURCE - RED UNTIL THE OWNER RULES (#420).           */
/*                                                                     */
/* These are the contract for the half that cannot be built yet. They  */
/* fail today because departedVerdict() answers "unknown" for every    */
/* account and the route fails closed. See this file's header.         */

{
  const db = fixture();
  const env = envFor(db);
  const { value } = await withBot(botSaying("left"), () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));
  check("the departed list answers an admin 200", value.status === 200);
  check("the departed list names the account the bot calls departed",
    Boolean(value.body && Array.isArray(value.body.departed) &&
      value.body.departed.some((row) => row.accountId === GONE)));
  check("the departed list NEVER names a current member (the filter " +
    "is the bot's verdict, not staleness alone)",
    Boolean(value.body && Array.isArray(value.body.departed) &&
      !value.body.departed.some((row) => row.accountId === STAYS ||
        row.accountId === ADMIN)));
  check("the departed list serves no handle and no numeric id",
    !/sealed-|75[0-9]{7}/.test(JSON.stringify(value.body || {})));
}

{
  const db = fixture();
  const env = envFor(db);
  const before = belongingTo(db, STAYS);
  const { value } = await withBot(botSaying("member"), () =>
    call(env, "DELETE", "/admin-departed/" + STAYS,
      { headers: ADMIN_BEARER }));
  check("the erase refuses a CURRENT member, with the bot's verdict " +
    "quoted back", value.status === 409 &&
    /member/.test(JSON.stringify(value.body || {})));
  check("the refused erase of a current member moved none of their rows",
    belongingTo(db, STAYS) === before);
}

{
  const db = fixture();
  const env = envFor(db);
  const before = belongingTo(db, GONE);
  /* An unreachable bot is not evidence that anybody left. */
  const { value } = await withBot(async () => { throw new Error("down"); },
    () => call(env, "DELETE", "/admin-departed/" + GONE,
      { headers: ADMIN_BEARER }));
  check("an unknown verdict refuses the erase (fail closed)",
    value.status === 409);
  check("the fail-closed refusal erased nothing",
    belongingTo(db, GONE) === before);
}

/* ------------------------------------------------------------------ */
/* 6. The route names, checked against the shipped surfaces.           */

{
  const pages = (await readdir(ROOT + "apps/web"))
    .filter((name) => name.endsWith(".html"))
    .map((name) => name.slice(0, -".html".length));
  check("the route is not named after a page - html_handling would " +
    "redirect that page into the router",
    !pages.includes("admin-departed"));
  check("the route family is registered as an API segment",
    workerModule.API_SEGMENTS.has("admin-departed"));
  check("no route this slice adds sits under /admin/, which cannot be " +
    "an API segment at all",
    ![...workerModule.API_SEGMENTS].includes("admin"));

  const wrangler = await readText(ROOT + "server/wrangler.toml");
  const lists = [...wrangler.matchAll(/run_worker_first = \[([^\]]*)\]/g)]
    .map((match) => match[1]);
  check("both run_worker_first lists exist to be checked",
    lists.length === 2);
  check("both run_worker_first lists carry the new segment, bare and " +
    "with its sub-resource - a missing pattern lets a static file " +
    "answer in the router's place",
    lists.every((list) => /"\/admin-departed"/.test(list) &&
      /"\/admin-departed\/\*"/.test(list)));
}

/* ------------------------------------------------------------------ */

const EXPECTED = 66;
if (failures) {
  console.log("\nfailing checks:");
  for (const label of failed) console.log("  - " + label);
}
console.log(failures
  ? `\ndeparted-cleanup FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\ndeparted-cleanup ran ${performed} checks, expected ${EXPECTED}`
    : `\ndeparted-cleanup OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
