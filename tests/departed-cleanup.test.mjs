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
 *   3. THE GUARDS. A malformed id, an admin's own account, the last
 *      `admin` row that still grants, a membership row spelled in a
 *      letter case the guard and the delete disagree about, and a
 *      pre-check read that did not answer are each refused, and every
 *      refusal leaves the store exactly as it was - counted across all
 *      four row classes, because the failure this covers deleted three
 *      of them and reported success.
 *   4. THE LOG LINE. One line per erase, carrying who erased, the short
 *      id, the verdict and the COUNTS - never a row, never a handle,
 *      never a numeric Telegram id.
 *
 * THE VERDICT COMES FROM THE SEALED NUMERIC ID, and that is an owner
 * ruling rather than a design this slice chose (2026-08-21). The
 * oracle - "has this account left the group?" - cannot be answered from
 * an HMAC: getChatMember takes a numeric Telegram id, and there is no
 * by-username form of it. So the id is sealed into the directory
 * record beside the handle, under the same key and the same AAD, and
 * departedVerdict() is the ONLY thing that unseals it. The condition
 * attached to that ruling is armed here rather than trusted: section 5
 * sweeps both routes' whole answers, and the log line, for every
 * numeric id on the fixture.
 *
 * THREE STATES, NOT TWO, and the third is the ordinary one. An account
 * is departed, current, or UNKNOWN - and every directory row in the
 * live database is unknown until its member next signs in, because it
 * was written before the id was sealed into it. Unknown is never
 * departed, is never erasable, and is never dropped silently from the
 * admin's view, since an account that simply vanished from the list
 * would read as checked and cleared. All three are armed both ways.
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

/* The at-rest format by its own path, so this arm seals directory
   records the Worker really opens. HKDF's salt is fixed, so a store
   built from the same STORE_SECRET seals what the Worker unseals. */
const store = await import(
  pathToFileURL(ROOT + "server/store-crypto.js").href);

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

const OLD = "2020-01-01T00:00:00.000Z";
const RECENT = new Date(Date.now() - 60 * 1000).toISOString();

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

/* Stale, and its directory record predates the sealed numeric id - the
   state every row in the live database is in until its member next
   signs in. */
const STALE_NO_ID_ID = "755050505";
const STALE_NO_ID = accountFor(STALE_NO_ID_ID);

/* Stale, carries its id, and sits on the always_allow bypass - so the
   bot is never asked about it and it is never departed. */
const BYPASSED_ID = "756060606";
const BYPASSED = accountFor(BYPASSED_ID);

/* Stale, carries its id, and the bot says they are still a member - the
   one case where only the verdict keeps an account off the list. */
const STALE_MEMBER_ID = "757070707";
const STALE_MEMBER = accountFor(STALE_MEMBER_ID);

/* Stale, carries its id, has left the group, and the only `membership`
   row an operator wrote for it is spelled in UPPER-CASE hex - what
   `wrangler d1 execute` writes and what nothing in this Worker writes
   (fix wave 3, review finding F1). The granting predicate refuses that
   spelling; the erase's DELETE matches it. */
const NEAR_MISS_ID = "758080808";
const NEAR_MISS = accountFor(NEAR_MISS_ID);
const NEAR_MISS_ROW = NEAR_MISS.toUpperCase();

const STORE_SECRET = "canary-s15-store-secret-belonging-to-nobody-v1";
const direct = await store.openStore({ STORE_SECRET: STORE_SECRET });

/*
 * A directory row as the Worker writes one: the record sealed under
 * purpose 'dir', bound to this account and the directory slot.
 *
 * `telegramId` is passed rather than derived, because the two cases
 * this slice turns on are a record that HAS the numeric id and one
 * written before the id existed - and the second is not a hypothetical.
 * Every directory row in the live database predates the owner ruling
 * that put the id here (2026-08-21), and stays id-less until its member
 * next signs in. Pass null to build one of those.
 */
async function directoryRow(accountId, telegramId, lastSeenAt) {
  const record = { handle: "sealed-handle-" + String(accountId).slice(0, 4),
    displayName: "Sealed Name", role: "member" };
  if (telegramId !== null) record.telegramId = String(telegramId);
  const sealed = await direct.sealDirectory(JSON.stringify(record),
    { accountId: accountId, recordId: "directory" });
  return { account_id: accountId,
    ciphertext: Buffer.from(sealed).toString("base64"),
    joined_at: OLD, last_seen_at: lastSeenAt };
}

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
  /*
   * ONE STATEMENT MADE TO FAIL, NAMED BY THE ROLE IT READS (fix wave 2,
   * review finding F1). A whole D1 taken down proves nothing here: the
   * route would 500 before any verdict was reached, and the branch on
   * trial - a verdict formed while one read did not answer - would
   * never run. So this fails the membership-role read for exactly one
   * role and answers every other statement normally, which is the shape
   * a transient D1 error or a malformed `results` really has.
   */
  const failRole = seed && seed.failRole;
  /* The same hook for the OTHER read on the way to a verdict - the
     directory row the sealed numeric id comes out of. Scoped to one
     account for the same reason: the branch on trial is a verdict
     formed while this row did not answer, and a whole-table failure
     would 500 the route before it ran. */
  const failDirectoryRead = seed && seed.failDirectoryRead;
  /*
   * THE THIRD HOOK, AND THE ONE THE ERASE OWNS (fix wave 3, review
   * finding F2). The two above fail reads on the way to a VERDICT.
   * This one fails the read handleEraseDeparted() makes before it asks
   * for a verdict at all - the membership pre-check - in the three
   * shapes a read can fail in: a throw, no row at all, and a row that
   * came back without the columns it named. The third is the one the
   * route used to spend as "no problem", answering ok:true after
   * deleting three of the four row classes.
   */
  const failPreCheck = seed && seed.failPreCheck;

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
      if (failRole && args[0] === failRole) {
        throw new Error("D1_ERROR: the membership read for role '" +
          args[0] + "' did not answer");
      }
      return { results: membership.filter((row) => row.role === args[0])
        .map((row) => ({ account_id: row.account_id })) };
    }
    /* The erase's own pre-check: does this account hold a granting
       `admin` row, is it the last one, and does the table hold any row
       for this account the DELETE would remove and the guard cannot
       see? Answered as three named columns so the Worker reads a shape
       rather than a position. */
    if (sql.startsWith("SELECT (SELECT COUNT(*) FROM membership")) {
      if (failPreCheck === "throw") {
        throw new Error("D1_ERROR: the erase's membership pre-check " +
          "did not answer");
      }
      /* No row at all, and a row without the columns it named. Both
         are shapes the route used to walk straight past. */
      if (failPreCheck === "null") return null;
      if (failPreCheck === "malformed") return { granting: 1 };
      const bound = String(args[0]);
      const wanted = bound.toLowerCase();
      const target = membership.find((row) =>
        row.account_id.toLowerCase() === wanted && row.role === "admin" &&
        grants(row.account_id));
      /* `COLLATE NOCASE` matches it, `COLLATE BINARY` does not: every
         row the erase would remove whose spelling is not the one the
         guard compared. Answered in JavaScript rather than parsed out
         of the statement, because what this stub has to get right is
         the ANSWER. */
      const nearMiss = membership.filter((row) =>
        String(row.account_id).toLowerCase() === wanted &&
        String(row.account_id) !== bound).length;
      return { granting: grantingAdmins(), holds: target ? 1 : 0,
        nearMiss: nearMiss };
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
    if (sql.startsWith("SELECT ciphertext FROM directory WHERE account_id")) {
      if (failDirectoryRead && args[0] === failDirectoryRead) {
        throw new Error("D1_ERROR: the directory read for that account " +
          "did not answer");
      }
      const found = directory.get(args[0]);
      return found ? { ciphertext: found.ciphertext } : null;
    }
    /*
     * THE CANDIDATE READ, AND THE WINDOW COUNT IT CARRIES (0.9-M3-S38,
     * #471, serving the owner's ruling at #454 item 23).
     *
     * `COUNT(*) OVER ()` is evaluated over every row the WHERE clause
     * admits and BEFORE `LIMIT` truncates, so the count on each
     * returned row is how many candidates there were - which is the
     * whole reason ONE read answers both questions. The steps below
     * are in that order on purpose: filter, count, sort, truncate. A
     * stub that counted after slicing would report `min(total, cap)`
     * as the total and let every arm below pass against a Worker that
     * could never say "showing 50 of 120".
     *
     * Proven against a real engine rather than assumed: SQLite 3.53.3
     * over 120 stale rows returns 50 rows each carrying 120, and 50
     * over exactly 50 rows (0.9-M3-S38's own probe). D1 running that
     * evaluation order on a real `directory` table is what
     * tools/check_live.py's own row for this route holds as live-only.
     */
    if (sql.startsWith("SELECT account_id, last_seen_at, " +
        "COUNT(*) OVER () AS candidates FROM directory")) {
      const limit = Number(/LIMIT (\d+)/.exec(sql)[1]);
      /* The DIRECTION is read out of the statement, never assumed. A
         stub that sorted oldest-first whatever the statement said would
         make the gone-longest-first arm (#454 item 13) unfalsifiable:
         a Worker that asked D1 for DESC would still be served ASC here
         and the arm would go on passing. The mutation that found this
         is in 0.9-M3-S38's own battery. */
      const descending = /ORDER BY last_seen_at DESC/.test(sql);
      const matching = [...directory.values()]
        .filter((row) => row.last_seen_at < args[0]);
      return { results: matching
        .slice()
        .sort((a, b) => (descending ? -1 : 1) *
          String(a.last_seen_at).localeCompare(b.last_seen_at))
        .slice(0, limit)
        .map((row) => ({ account_id: row.account_id,
          last_seen_at: row.last_seen_at, candidates: matching.length })) };
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
    STORE_SECRET: STORE_SECRET,
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

/*
 * A bot that answers DIFFERENTLY PER PERSON, which is what makes "the
 * list never contains a current member" a discrimination rather than a
 * coincidence.
 *
 * With one status for every call, a run where the bot says "left" makes
 * everybody departed and a run where it says "member" makes nobody
 * departed - so an arm asserting that a current member is absent passes
 * in the second run without the filter existing at all. Reading the
 * user_id back out of the URL the Worker built is what lets one answer
 * hold a leaver and a stayer at once, and it also proves the Worker
 * asked about the id it should have asked about.
 */
function botPerPerson(byId) {
  return async (url) => {
    const asked = /user_id=([0-9]+)/.exec(String(url));
    const status = asked ? byId[asked[1]] : undefined;
    if (!status) {
      return new Response(JSON.stringify({ ok: false }), { status: 200,
        headers: { "Content-Type": "application/json" } });
    }
    return new Response(
      JSON.stringify({ ok: true, result: { status: status } }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  };
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
async function fixture(options) {
  return makeDb({
    /* Nothing fails unless an arm asks for it by name, so every
       scenario above this one is untouched by the hooks' existence. */
    failRole: (options && options.failRole) || null,
    failDirectoryRead: (options && options.failDirectoryRead) || null,
    failPreCheck: (options && options.failPreCheck) || null,
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
      /* GONE is stale AND carries its numeric id, so the bot can be
         asked about it - the one row on this fixture that a verdict can
         actually be had for. STALE_NO_ID is stale and pre-dates the
         ruling, so it is the "unknown until next sign-in" case. STAYS
         and ADMIN are recent, so staleness alone keeps them off the
         candidate list before any verdict is sought. */
      await directoryRow(GONE, GONE_ID, OLD),
      await directoryRow(STALE_NO_ID, null, OLD),
      await directoryRow(STAYS, STAYS_ID, RECENT),
      await directoryRow(ADMIN, ADMIN_ID, RECENT),
    ],
    membership: [
      /* An `admin` row rather than an `always_allow` one, and the
         difference is not cosmetic: groupStanding() answers "member"
         for anybody on the bypass list WITHOUT asking the bot, so a
         departed account carrying that row can never be reported
         departed at all. That is correct behavior - the bypass means
         "let them in regardless" - and it is pinned as its own arm
         below rather than left sitting in this fixture, where it
         silently made the erase unreachable and every arm downstream
         of it fail for a reason that had nothing to do with the erase. */
      { account_id: GONE, role: "admin", label: "gone-admin",
        added_at: OLD, added_by: ADMIN },
      { account_id: STAYS, role: "admin", label: "stays-admin",
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

/*
 * Every `membership` row that NAMES this account, in any spelling.
 *
 * belongingTo() above deliberately compares rows whose account_id
 * matches byte for byte, which is every row this Worker writes - and
 * it is blind to exactly the row fix wave 3 is about (review finding
 * F1), an operator's hand-written one in upper-case hex. The erase's
 * DELETE matches `COLLATE NOCASE` and removes that row, so proving it
 * survived a refusal needs a comparison that can see it. Two helpers
 * rather than a flag on one: the byte proof and the any-spelling proof
 * answer different questions and an arm should say which it is asking.
 */
const membershipNaming = (db, accountId) => JSON.stringify(
  db.membership()
    .filter((row) => String(row.account_id).toLowerCase() ===
      String(accountId).toLowerCase())
    .sort((a, b) => (a.account_id + a.role)
      .localeCompare(b.account_id + b.role)));

const ADMIN_BEARER = bearer("admin-token");
const MEMBER_BEARER = bearer("member-token");

/* ------------------------------------------------------------------ */
/* 0. The fixture is real before anything is asked of it.              */

{
  const db = await fixture();
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
/* AND NOT ONLY THROUGH THE ROUTE, which section 1b below does. While   */
/* the verdict source was still an open question the route could not   */
/* erase at all, and this proof - run after a refusal - passed         */
/* vacuously: the survivor's rows were unchanged because NOTHING was   */
/* erased. That is the stub-default failure AGENTS.md names as the     */
/* most-repeated defect of 0.9-M2, sitting in this file's flagship     */
/* arm. Aiming it at the transaction itself is what made it real, and  */
/* it stays aimed there now that the route works: the two prove        */
/* different things, and a route-level proof can always be hollowed    */
/* out by a refusal that happens earlier than the erase.               */

{
  const db = await fixture();
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
/* 1b. The same thing end to end, through the route.                   */

{
  const db = await fixture();
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
  const db = await fixture();
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
  const db = await fixture();
  check("the fixture really does hold a stale directory row for the " +
    "member-session refusal above to be withholding something",
    [...db.directory.values()].some((row) => row.last_seen_at === OLD));
}

/* ------------------------------------------------------------------ */
/* 3. The guards. Each refuses, and each leaves the store as it was.   */

{
  const db = await fixture();
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
  const db = await fixture();
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

/*
 * THE PRE-CHECK ITSELF FAILS CLOSED (fix wave 3, review finding F2).
 *
 * THE HARM: the last-granting-admin pre-check spent a read that did
 * not answer as "no problem". A throw escaped to the catch-all 500 -
 * nothing deleted, but nothing named either - and a null row or a row
 * missing the columns it asked for skipped the check entirely, so the
 * route went on and answered `ok: true` having deleted the
 * submissions, the directory row and the sessions. The membership row
 * survived only because eraseAccount()'s own statement carries the
 * same guard, and that statement protects ONE of the four row classes.
 * `removed.membership: 0` was the only signal, and nothing reads it.
 *
 * ALL-OR-NOTHING IS PROVED BY COUNTING, NOT BY ASSERTING IT. Each arm
 * seeds real rows in all four classes, refuses, and compares the whole
 * lot byte for byte afterwards - the partial erase the finding
 * describes would move three of the four and this comparison sees it.
 * No log line either: the erase's line is written after the write, so
 * a line here would mean a write happened.
 *
 * THE REASON IS ITS OWN. It names the membership table and not the
 * allow list, because "the list that holds people open could not be
 * read" and "the read that counts the rows I am about to delete could
 * not be read" send an admin to different places, and the whole point
 * of telling the unknown reasons apart is the next action.
 */
for (const [shape, why] of [
  ["throw", "the read throws, as a transient D1 error does"],
  ["null", "the read answers no row at all"],
  ["malformed", "the read answers a row without the columns it named"],
]) {
  const db = await fixture({ failPreCheck: shape });
  const env = envFor(db);
  const before = belongingTo(db, GONE);
  const staysBefore = belongingTo(db, STAYS);
  check("the fixture holds rows in all four classes before the refused " +
    "erase: " + why, JSON.stringify(countsFor(db, GONE)) ===
      JSON.stringify({ submissions: 2, directory: 1, membership: 1,
        sessions: 2 }));

  const { value } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + GONE,
      { headers: ADMIN_BEARER }));
  check("the erase is REFUSED rather than answering ok:true when " +
    why, value.status === 409 &&
    !((value.body || {}).ok === true));
  check("the refusal names the membership read as the reason, not the " +
    "allow list and not Telegram: " + why,
    /the membership table could not be read/
      .test(String((value.body || {}).error)) &&
    !/allow list/.test(String((value.body || {}).error)) &&
    !/Telegram/.test(String((value.body || {}).error)));
  check("NOTHING was deleted - not three of four classes, not one: " +
    why, belongingTo(db, GONE) === before);
  check("and the other member's rows are byte-identical too: " + why,
    belongingTo(db, STAYS) === staysBefore);
  check("no log line says an erase happened: " + why,
    db.adminLog.length === 0);
}

/* The baseline the three above are a branch off. Same fixture, same
   bot, same call - with the pre-check answering, the erase goes
   through and every class comes down, so the 409s are the read failing
   and not the route having stopped working. */
{
  const db = await fixture();
  const env = envFor(db);
  const { value } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + GONE,
      { headers: ADMIN_BEARER }));
  check("BASELINE: with the pre-check answering, the same erase goes " +
    "through", value.status === 200 &&
    Boolean(value.body && value.body.ok === true));
  check("...and all four classes came down", JSON.stringify(
    countsFor(db, GONE)) === JSON.stringify({ submissions: 0,
      directory: 0, membership: 0, sessions: 0 }));
  check("...and it wrote its one log line", db.adminLog.length === 1);
}

/* ------------------------------------------------------------------ */
/* 4. The log line: counts and a verdict, never a row and never a      */
/*    handle.                                                          */

{
  const db = await fixture();
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
  const db = await fixture();
  const env = envFor(db);
  await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + GONE,
      { headers: MEMBER_BEARER }));
  check("a refused erase appends no log line", db.adminLog.length === 0);
}

/* ------------------------------------------------------------------ */
/* 5. THE VERDICT, AND THE BOUNDS THE OWNER PUT ON IT.                 */

{
  const db = await fixture();
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
  const db = await fixture();
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
  const db = await fixture();
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

/*
 * THE always_allow BYPASS OUTRANKS THE BOT, and this is where that is
 * pinned rather than left to be discovered in a fixture.
 *
 * groupStanding() answers "member" for anybody on the bypass list
 * WITHOUT asking Telegram at all, so an account carrying that row can
 * never be reported departed and can never be erased through this
 * route - even with the bot saying "kicked". That is the bypass meaning
 * what it says: an explicit standing instruction to let this person in
 * regardless of what the group says. Erasing them on the group's word
 * would be the site overruling the instruction.
 *
 * It cost this slice an hour of wrong diagnosis to find, because a
 * fixture that put the departed account on the bypass made the erase
 * unreachable and every arm downstream fail for an unrelated reason.
 * That is exactly the kind of fact that belongs in an arm.
 *
 * AND THE WORDS ARE THE LIST'S, NEVER TELEGRAM'S (Prime's ruling on
 * review finding F3, 2026-08-21: never attribute to the bot what the
 * bot did not say). The bypass is checked BEFORE the call is made, so
 * the old refusal - "Telegram says that account is still in the group"
 * - reported a verdict nobody gave, and the bot here would have said
 * the exact opposite. These arms hold both directions: never departed,
 * and never attributed. `botSaying("kicked")` is what makes the second
 * one a real check rather than a coincidence, because it puts the
 * bypass in front of a bot that WOULD have said the member is gone.
 */
{
  const db = await fixture();
  db.membership().push({ account_id: BYPASSED, role: "always_allow",
    label: "on-the-bypass", added_at: OLD, added_by: ADMIN });
  db.directory.set(BYPASSED, await directoryRow(BYPASSED, BYPASSED_ID, OLD));
  const env = envFor(db);
  const before = belongingTo(db, BYPASSED);

  const { value: list } = await withBot(botSaying("kicked"), () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));
  check("an always_allow account is never reported departed, even with " +
    "the bot saying kicked - the bypass is not asked about",
    Boolean(list.body && Array.isArray(list.body.departed) &&
      !list.body.departed.some((row) => row.accountId === BYPASSED)));

  const listedAllowed = ((list.body && list.body.allowed) || [])
    .find((row) => row.accountId === BYPASSED);
  check("it is reported in its OWN state rather than dropped - an " +
    "account that vanished from the list would read as checked and " +
    "cleared, exactly as an unknown one would", Boolean(listedAllowed));
  check("and the row's reason names the OPERATOR'S LIST and the next " +
    "action, because removing that entry is the only thing that " +
    "changes this answer", Boolean(listedAllowed) &&
    listedAllowed.reason ===
      "allowed by the operator's list - remove it there first");
  check("the bypassed account is NOT filed as unknown either - the " +
    "answer is known, it is just not the group's",
    !((list.body && list.body.unknown) || [])
      .some((row) => row.accountId === BYPASSED));
  /* The row QUOTES NOBODY: no status word rides with it, and its reason
     names the list. Scoped to the row rather than to the whole answer
     on purpose - a whole-answer sweep for the word "Telegram" also
     fires on the id-never-served mutation, which is a different arm's
     job, and an arm that reds for two reasons proves neither. */
  check("the bypassed row quotes nobody: no status word travels with " +
    "it, and its reason names the operator's list rather than Telegram",
    Boolean(listedAllowed) && listedAllowed.status === undefined &&
    !/telegram/i.test(String(listedAllowed.reason)));

  const { value: erase } = await withBot(botSaying("kicked"), () =>
    call(env, "DELETE", "/admin-departed/" + BYPASSED,
      { headers: ADMIN_BEARER }));
  check("an always_allow account cannot be erased through this route",
    erase.status === 409);
  check("and the erase refuses with THAT SAME REASON - the list's " +
    "words, so an admin learns what to remove",
    /allowed by the operator's list - remove it there first/
      .test(String((erase.body || {}).error)));
  check("the refusal never says Telegram called them a current member, " +
    "which it would have been the opposite of here: this bot says kicked",
    !/Telegram says/.test(String((erase.body || {}).error)));
  check("that refusal moved none of the bypassed account's rows",
    belongingTo(db, BYPASSED) === before);
}

/*
 * THE SAME, THROUGH THE OTHER always_allow ARM - the deployment secret
 * ALWAYS_ALLOW_TELEGRAM_IDS rather than the `membership` row.
 *
 * This is the arm the review's own probe used, and it is the one that
 * survives a Worker that cannot reach D1 at all, so it is the one an
 * operator reaches for on the worst day. Both arms answer "member"
 * before any call is made and both must therefore refuse to speak for
 * Telegram; arming only the table arm would leave the break-glass one
 * free to drift.
 *
 * GONE sits in the same answer as a real leaver, so this is one call
 * telling the two apart rather than a run where nothing is departed.
 */
{
  const db = await fixture();
  db.directory.set(BYPASSED, await directoryRow(BYPASSED, BYPASSED_ID, OLD));
  const env = envFor(db, { ALWAYS_ALLOW_TELEGRAM_IDS: BYPASSED_ID });
  const before = belongingTo(db, BYPASSED);

  const { value: list } = await withBot(botSaying("left"), () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));
  check("an ALWAYS_ALLOW_TELEGRAM_IDS account is not departed either, " +
    "with a bot that says left",
    !((list.body && list.body.departed) || [])
      .some((row) => row.accountId === BYPASSED));
  check("...while the leaver in the very same answer IS departed, so " +
    "the check above is the bypass working and not an empty list",
    ((list.body && list.body.departed) || [])
      .some((row) => row.accountId === GONE));
  check("the secret-list account is reported as allowed by the " +
    "operator's list, in the same words the table arm gets",
    ((list.body && list.body.allowed) || []).some((row) =>
      row.accountId === BYPASSED && row.reason ===
        "allowed by the operator's list - remove it there first"));

  const { value: erase } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + BYPASSED,
      { headers: ADMIN_BEARER }));
  check("erasing it is refused in the list's words, not Telegram's - " +
    "the exact case the review found reported backwards",
    erase.status === 409 &&
    /allowed by the operator's list/.test(String((erase.body || {}).error)) &&
    !/Telegram says/.test(String((erase.body || {}).error)));
  check("and none of that account's rows moved",
    belongingTo(db, BYPASSED) === before);
}

/*
 * A ROW IN THE WRONG LETTER CASE HOLDS AN ACCOUNT OPEN TOO (fix wave 3,
 * review finding F1).
 *
 * THE HARM, IN ONE SENTENCE: two spellings of "this account's row"
 * disagreed inside one request. `wrangler d1 execute` writes upper-case
 * hex, so an operator's hand-written always_allow row is spelled in a
 * case the granting predicate refuses - the account was served as
 * departed, the bot was asked, the erase went through, and the erase's
 * own DELETE, which matches `COLLATE NOCASE`, then removed the very row
 * that was meant to stop it. The reviewer's probe printed the sharp
 * part: `ERASE 200 ... its always_allow row after the erase: []`.
 *
 * TWO WALLS, AND EACH IS ARMED WHERE IT IS THE ONLY ONE STANDING.
 * departedVerdict() now reads the list with the same normalization the
 * DELETE's collation implies, so the LIST route below is where that
 * wall alone decides. handleEraseDeparted()'s pre-check refuses
 * whenever the guard's view and the delete's view disagree at all, so
 * the ERASE route is where that wall answers first - and the arm on
 * the admin-row case further down is where it is the only wall there
 * is. Reverting either one reds a check here and leaves the other
 * holding, which is what belt and braces is supposed to look like.
 *
 * GRANTS NOTHING, PROTECTS EVERYTHING. The row still does not admit
 * anybody - tests/telegram-auth.test.mjs holds that direction, because
 * widening who may sign in on the strength of a row nobody can prove
 * was meant is a different decision from this one.
 */
/* Real rows in every class the erase removes, so "intact" below is a
   comparison of seeded state and never a stub default that already
   satisfied the assertion (AGENTS.md, "Verification"). */
async function seedNearMiss(db, role) {
  db.membership().push({ account_id: NEAR_MISS_ROW, role: role,
    label: "written-by-hand", added_at: OLD, added_by: ADMIN });
  db.directory.set(NEAR_MISS,
    await directoryRow(NEAR_MISS, NEAR_MISS_ID, OLD));
  db.submissions().push({ id: 51, account_id: NEAR_MISS,
    ciphertext: "near-miss-one", received_at: OLD, supersedes: null });
  const session = sessionRow("near-miss-token", NEAR_MISS);
  db.sessions.set(session.token_hash, session);
}

{
  const db = await fixture();
  await seedNearMiss(db, "always_allow");
  const env = envFor(db);
  const before = belongingTo(db, NEAR_MISS);
  const staysBefore = belongingTo(db, STAYS);
  const rowsNaming = membershipNaming(db, NEAR_MISS);
  check("the near-miss fixture really holds rows in all four classes " +
    "before anything is asked of it",
    JSON.stringify(countsFor(db, NEAR_MISS)) ===
      JSON.stringify({ submissions: 1, directory: 1, membership: 0,
        sessions: 1 }) &&
    db.membership().some((row) => row.account_id === NEAR_MISS_ROW));

  const { value: list } = await withBot(botSaying("left"), () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));
  check("the reviewer's probe, first line: an account whose only " +
    "always_allow row is UPPER-CASE hex is NOT reported departed",
    !((list.body && list.body.departed) || [])
      .some((row) => row.accountId === NEAR_MISS));
  check("...while the real leaver in the very same answer IS departed, " +
    "so the check above is the fix working and not an empty list",
    ((list.body && list.body.departed) || [])
      .some((row) => row.accountId === GONE));
  check("it is reported as allowed by the operator's list, in the same " +
    "words a correctly spelled row gets - the operator did put it there",
    ((list.body && list.body.allowed) || []).some((row) =>
      row.accountId === NEAR_MISS && row.reason ===
        "allowed by the operator's list - remove it there first"));
  check("and it is not filed as unknown - the list answered, and what " +
    "it said is that this account is named",
    !((list.body && list.body.unknown) || [])
      .some((row) => row.accountId === NEAR_MISS));

  const { value: erase } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + NEAR_MISS,
      { headers: ADMIN_BEARER }));
  check("the reviewer's probe, second line: the erase is REFUSED " +
    "rather than answering 200", erase.status === 409);
  check("the refusal names the letter case and the next action, which " +
    "is the pre-check answering first - the more specific of the two " +
    "walls, and the one that can say which row to go and fix",
    /different letter case/.test(String((erase.body || {}).error)) &&
    /Nothing was erased/.test(String((erase.body || {}).error)));
  check("the refusal quotes nobody - the bot said 'left' here and is " +
    "not spoken for", !/Telegram says/
      .test(String((erase.body || {}).error)));
  check("the reviewer's probe, third line: that account's rows are all " +
    "still there", belongingTo(db, NEAR_MISS) === before);
  check("the reviewer's probe, SHARP line: the always_allow row that " +
    "protects it is still there too, byte for byte - the erase no " +
    "longer destroys the entry that was meant to stop it",
    membershipNaming(db, NEAR_MISS) === rowsNaming &&
    db.membership().some((row) => row.account_id === NEAR_MISS_ROW));
  check("a refused erase over a near-miss row writes no log line",
    db.adminLog.length === 0);
  check("and the second member's rows are byte-identical afterwards",
    belongingTo(db, STAYS) === staysBefore);
}

/*
 * THE GUARD'S VIEW AND THE DELETE'S VIEW MUST AGREE, WHATEVER THE ROLE.
 *
 * The arm above is the always_allow case, where the verdict wall
 * answers as well. This is the general one and the pre-check is the
 * ONLY wall standing: an `admin` row in upper-case hex holds nobody
 * open, so the bot is asked, the bot says left, and the verdict is
 * departed. Before fix wave 3 the erase went through and took that row
 * with it - the guard counted it as nothing (`grantsAnythingSql()`
 * refuses the spelling) and the DELETE removed it anyway
 * (`COLLATE NOCASE` matches it), so an operator's hand-written row
 * vanished on an erase nobody meant to reach it.
 *
 * BOTH DIRECTIONS IN ONE BLOCK. The same fixture with the same row
 * spelled the way this Worker writes it is erased, 200, and the row
 * goes - so the refusal above is a branch and not a route that stopped
 * working.
 */
{
  const db = await fixture();
  await seedNearMiss(db, "admin");
  const env = envFor(db);
  const before = belongingTo(db, NEAR_MISS);
  const rowsNaming = membershipNaming(db, NEAR_MISS);

  const { value: erase } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + NEAR_MISS,
      { headers: ADMIN_BEARER }));
  check("an account the bot says has LEFT is still refused when the " +
    "table holds a row for it in another spelling - no allow-list row " +
    "here, so the pre-check is the only wall", erase.status === 409 &&
    /different letter case/.test(String((erase.body || {}).error)));
  check("that refusal deleted nothing of that account's",
    belongingTo(db, NEAR_MISS) === before);
  check("and the hand-written admin row survived it",
    membershipNaming(db, NEAR_MISS) === rowsNaming);
  check("no log line for a refused erase", db.adminLog.length === 0);
}

{
  const db = await fixture();
  await seedNearMiss(db, "admin");
  /* The same row, respelled the way this Worker writes one. Nothing
     else about the fixture moves. */
  for (const row of db.membership()) {
    if (row.account_id === NEAR_MISS_ROW) row.account_id = NEAR_MISS;
  }
  const env = envFor(db);

  const { value: erase } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + NEAR_MISS,
      { headers: ADMIN_BEARER }));
  check("THE OTHER DIRECTION: the same row spelled the way this Worker " +
    "writes it is erased, 200 - the pre-check refuses a disagreement " +
    "and not an erase", erase.status === 200 &&
    Boolean(erase.body && erase.body.ok === true));
  check("and the row it names is gone, so the 409s above are a branch " +
    "rather than a route that stopped working",
    membershipNaming(db, NEAR_MISS) === "[]");
  check("so are its submissions, its directory row and its sessions",
    JSON.stringify(countsFor(db, NEAR_MISS)) ===
      JSON.stringify({ submissions: 0, directory: 0, membership: 0,
        sessions: 0 }));
  check("that erase wrote its one log line", db.adminLog.length === 1);
}

/*
 * A FAILED READ OF THE OPERATOR'S LIST IS "UNKNOWN", NEVER DEPARTED
 * (fix wave 2, review finding F1).
 *
 * THE MIRROR OF F3, AND THE ONE PERMISSIVE FAILURE ON THIS PATH. F3 was
 * the bypass being reported as the group's verdict; this is the bypass
 * silently ceasing to exist. membershipAccountIds() answered a thrown
 * query with the empty set, which is the right direction for the admin
 * gate above it - a failed read means "not an admin", so nobody gets in
 * - and the WRONG one here, where the empty set means "not on the
 * operator's list" and this slice made that an ERASING decision. One
 * transient D1 error turned a protected account into a departed one:
 * the list served it as departed, the bot was asked about it, the erase
 * went through, and the rows were gone.
 *
 * THE RULE THIS PINS: any read that does not answer on the way to a
 * verdict makes that verdict unknown, with the failure named - never
 * departed, and the erase refuses. DESIGN.md's bot-failure stance is
 * "cannot check is never treated as not a member"; this is that same
 * sentence one level down, because "cannot read the allow list" was
 * being treated as "not on the allow list".
 *
 * THE FIXTURE HOLDS THE ACCOUNT OPEN THROUGH THE TABLE ARM ONLY, with
 * no ALWAYS_ALLOW_TELEGRAM_IDS set, so the failing read is the only
 * thing standing between it and the erase - and the bot says "left"
 * for everybody, so nothing but the operator's list can keep it off
 * the departed list.
 *
 * THE DISCRIMINATION IS THE SAME FIXTURE READ TWICE, once with that
 * statement answering and once with it failing, because within the
 * failing answer there is nothing to contrast against: the rule is
 * that NO verdict reached over that read is acted on, so the real
 * leaver in the same answer goes unknown too. Its blast radius is the
 * point rather than an awkwardness - a rule with an exception for the
 * accounts that "obviously" left is a rule the next branch here can be
 * forgotten from - and the working read proves the fixture really does
 * produce a departed row and an allowed one, so the failing read's
 * answer is a changed answer and not an empty list.
 */
{
  const db = await fixture({ failRole: null });
  db.membership().push({ account_id: BYPASSED, role: "always_allow",
    label: "on-the-bypass", added_at: OLD, added_by: ADMIN });
  db.directory.set(BYPASSED, await directoryRow(BYPASSED, BYPASSED_ID, OLD));
  const { value: working } = await withBot(botSaying("left"), () =>
    call(envFor(db), "GET", "/admin-departed", { headers: ADMIN_BEARER }));
  const before_ = working.body || {};
  check("with that read ANSWERING, the same fixture reports the leaver " +
    "departed and the held-open account allowed - so the answer below " +
    "is a changed answer and not an empty list",
    ((before_.departed) || []).some((row) => row.accountId === GONE) &&
    ((before_.allowed) || []).some((row) => row.accountId === BYPASSED));
}

{
  const db = await fixture({ failRole: "always_allow" });
  db.membership().push({ account_id: BYPASSED, role: "always_allow",
    label: "on-the-bypass", added_at: OLD, added_by: ADMIN });
  db.directory.set(BYPASSED, await directoryRow(BYPASSED, BYPASSED_ID, OLD));
  const env = envFor(db);
  const before = belongingTo(db, BYPASSED);

  const { value: list } = await withBot(botSaying("left"), () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));
  const body = list.body || {};

  check("with the operator's-list read failing, the account it holds " +
    "open is NOT reported departed - one failed read may not decide an " +
    "erase", !((body.departed) || [])
      .some((row) => row.accountId === BYPASSED));
  check("and neither is the real leaver the same fixture reported " +
    "departed a moment ago: the rule is about the READ, so no verdict " +
    "formed over it is acted on and the departed list is empty",
    ((body.departed) || []).length === 0 &&
    ((body.unknown) || []).some((row) => row.accountId === GONE));
  check("it is not dropped either, and not filed as allowed - the " +
    "list cannot be read, so whether it allows this account is exactly " +
    "what is unknown",
    ((body.unknown) || []).some((row) => row.accountId === BYPASSED) &&
    !((body.allowed) || []).some((row) => row.accountId === BYPASSED));
  check("and the reason names THE READ THAT FAILED - neither a next " +
    "sign-in nor waiting on Telegram fixes an unreadable membership " +
    "table, so borrowing either wording sends an admin to the wrong act",
    ((body.unknown) || []).some((row) => row.accountId === BYPASSED &&
      row.reason ===
        "the operator's allow list could not be read, so try again shortly"));

  const { value: erase } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + BYPASSED,
      { headers: ADMIN_BEARER }));
  const refusal = String((erase.body || {}).error);
  check("the erase REFUSES rather than destroying the account's rows " +
    "on a verdict formed while a read did not answer", erase.status === 409);
  check("and the refusal carries the same named failure the row did",
    /the operator's allow list could not be read/.test(refusal));
  /* The string's PRESENCE is half of this check on purpose. An erase
     that went through carries no error at all, and a wording assertion
     over a missing string passes while proving nothing - the vacuous
     arm AGENTS.md names as the most-repeated defect of 0.9-M2. */
  check("the refusal speaks for nobody: it names neither Telegram nor " +
    "the bot, because the bot is not what failed and its answer is not " +
    "what is being acted on",
    typeof (erase.body || {}).error === "string" &&
    !/telegram|\bbot\b/i.test(refusal));
  check("nothing of that account moved on the refusal - the whole " +
    "point of the fail-closed direction",
    belongingTo(db, BYPASSED) === before);
}

/*
 * THE OTHER TWO READS ON THE WAY TO A VERDICT, ARMED (fix wave 2, the
 * audit finding F1 asked for).
 *
 * F1 was found by asking one question of every read this path makes:
 * when it does not answer, does the verdict come out unknown or does it
 * come out confident? Four of the five ways to be unknown were already
 * correct and only two of them were pinned - the record with no sealed
 * id, and the bot. These are the remaining two, and they are here
 * because "correct today and unarmed" is exactly the state the allow
 * list was in when it stopped being correct.
 *
 * A THROWN DIRECTORY READ, and a record that will not open - the second
 * is the key-rotation case departedVerdict()'s own comment names as a
 * real possibility. Neither may be departed, neither may be dropped,
 * and both are fixed by that member signing in, which is why they share
 * the sign-in wording rather than the bot's.
 */
{
  const db = await fixture({ failDirectoryRead: GONE });
  const env = envFor(db);
  const before = belongingTo(db, GONE);

  const { value: list } = await withBot(botSaying("left"), () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));
  const body = list.body || {};
  check("a directory read that THREW is never departed, with a bot " +
    "that says left about that very account",
    !((body.departed) || []).some((row) => row.accountId === GONE));
  check("it is reported unknown with the sign-in reason, since a next " +
    "sign-in rewrites the row this read could not fetch",
    ((body.unknown) || []).some((row) => row.accountId === GONE &&
      row.reason === "unknown until next sign-in"));

  const { value: erase } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + GONE,
      { headers: ADMIN_BEARER }));
  check("and the erase refuses it rather than destroying rows over a " +
    "read that did not answer", erase.status === 409);
  check("nothing of that account moved on that refusal",
    belongingTo(db, GONE) === before);
}

{
  const db = await fixture();
  /* The row exists and is the right shape; the bytes simply do not
     open under this Worker's key - a key rotation, or a row written by
     a different deployment. Read as a real ciphertext right up to the
     point where it is unsealed, which is where the branch under test
     lives. */
  db.directory.set(GONE, Object.assign({}, db.directory.get(GONE),
    { ciphertext: Buffer.from("not-a-sealed-record-at-all")
      .toString("base64") }));
  const env = envFor(db);
  const before = belongingTo(db, GONE);

  const { value: list } = await withBot(botSaying("left"), () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));
  const body = list.body || {};
  check("a directory record that will not OPEN is never departed either",
    !((body.departed) || []).some((row) => row.accountId === GONE));
  check("it is reported unknown rather than dropped, so an admin sees " +
    "the row sit the list out instead of watching it vanish",
    ((body.unknown) || []).some((row) => row.accountId === GONE &&
      row.reason === "unknown until next sign-in"));
  check("and one unopenable record does not take the whole page down " +
    "with it - the answer is still 200 and still carries the other " +
    "stale rows", list.status === 200 &&
    ((body.unknown) || []).some((row) => row.accountId === STALE_NO_ID));

  const { value: erase } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + GONE,
      { headers: ADMIN_BEARER }));
  check("erasing it is refused, and nothing of it moved",
    erase.status === 409 && belongingTo(db, GONE) === before);
}

/*
 * TELEGRAM FAILING DURING THE LIST READ IS "UNKNOWN", AND SAYS SO
 * (review finding F4).
 *
 * The erase already refused on an unreachable bot and was armed for it.
 * The LIST was not: every unknown fixture reached that state through a
 * record with no sealed id, which is a different branch, so a mutation
 * making a bot failure read as departed reddened only erase-side arms.
 * This is that input class - a row that IS askable, in front of a bot
 * that will not answer.
 *
 * TWO FAILURE SHAPES, because they arrive on different code paths: a
 * thrown fetch (the network is gone, or the timeout fired) and a 200
 * carrying `ok: false` (Telegram answered and refused). Neither may be
 * departed, neither may be dropped, and both must say the bot is the
 * problem - a next sign-in fixes a record with no id and does nothing
 * at all about an outage, so printing the sign-in wording here sends an
 * admin to wait for the wrong event.
 */
{
  const db = await fixture();
  db.directory.set(STALE_MEMBER,
    await directoryRow(STALE_MEMBER, STALE_MEMBER_ID, OLD));
  const env = envFor(db);

  /* Throws for STALE_MEMBER, answers for everybody else - so one call
     holds a leaver, an unaskable record and a bot failure at once. */
  const flaky = async (url) => {
    if (String(url).includes("user_id=" + STALE_MEMBER_ID)) {
      throw new Error("connect ECONNREFUSED");
    }
    return new Response(
      JSON.stringify({ ok: true, result: { status: "left" } }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const { value: list } = await withBot(flaky, () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));

  const unknownRows = (list.body && list.body.unknown) || [];
  check("a row the bot call THREW on is never departed - an outage is " +
    "not evidence that anybody left",
    !((list.body && list.body.departed) || [])
      .some((row) => row.accountId === STALE_MEMBER));
  check("...in an answer that DOES carry the leaver, so the check above " +
    "is the failure being handled and not an empty list",
    ((list.body && list.body.departed) || [])
      .some((row) => row.accountId === GONE));
  check("it is not dropped either: the list reports it as unknown",
    unknownRows.some((row) => row.accountId === STALE_MEMBER));
  check("and the reason names TELEGRAM as the thing that failed - " +
    "waiting fixes this, and a next sign-in does not",
    unknownRows.some((row) => row.accountId === STALE_MEMBER &&
      row.reason === "Telegram could not be asked, so try again shortly"));
  check("the record-side unknown in the same answer keeps its OWN " +
    "reason, so the two are told apart rather than sharing one wording",
    unknownRows.some((row) => row.accountId === STALE_NO_ID &&
      row.reason === "unknown until next sign-in"));
}

{
  const db = await fixture();
  db.directory.set(STALE_MEMBER,
    await directoryRow(STALE_MEMBER, STALE_MEMBER_ID, OLD));
  const env = envFor(db);
  const before = belongingTo(db, STALE_MEMBER);

  /* A 200 that carries ok:false - Telegram answered and refused, which
     is what a 4xx from the bot API looks like once it is parsed. */
  const refusing = botPerPerson({ [GONE_ID]: "left" });
  const { value: list } = await withBot(refusing, () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));

  check("a 4xx-shaped answer from Telegram is not departed on the list " +
    "either", !((list.body && list.body.departed) || [])
      .some((row) => row.accountId === STALE_MEMBER));
  check("it is reported unknown with the bot named",
    ((list.body && list.body.unknown) || []).some((row) =>
      row.accountId === STALE_MEMBER &&
      row.reason === "Telegram could not be asked, so try again shortly"));

  const { value: erase } = await withBot(refusing, () =>
    call(env, "DELETE", "/admin-departed/" + STALE_MEMBER,
      { headers: ADMIN_BEARER }));
  check("and the erase refuses it with the same named failure rather " +
    "than telling an admin to wait for a sign-in",
    erase.status === 409 &&
    /Telegram could not be asked/.test(String((erase.body || {}).error)));
  check("nothing of that account moved on the refusal",
    belongingTo(db, STALE_MEMBER) === before);
}

/*
 * A RECORD WRITTEN BEFORE THE NUMERIC ID EXISTED IS "UNKNOWN", BOTH
 * DIRECTIONS (owner ruling, 2026-08-21, bound 3).
 *
 * Every directory row in the live database is in this state until its
 * member next signs in, so this is the ordinary case rather than an
 * edge one. It must not be guessed at in either direction: not reported
 * departed, and not erasable - and it must not vanish from the admin's
 * view either, or the admin concludes it was checked and cleared.
 */
{
  const db = await fixture();
  const env = envFor(db);
  const before = belongingTo(db, STALE_NO_ID);

  const { value: list } = await withBot(botSaying("left"), () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));

  check("a stale row with no sealed id is NOT reported departed, even " +
    "with the bot saying left",
    Boolean(list.body && Array.isArray(list.body.departed) &&
      !list.body.departed.some((row) => row.accountId === STALE_NO_ID)));
  check("it is reported as unknown rather than dropped silently - an " +
    "account that simply vanished would read as checked and cleared",
    Boolean(list.body && Array.isArray(list.body.unknown) &&
      list.body.unknown.some((row) => row.accountId === STALE_NO_ID)));
  check("the unknown row carries the reason a person can act on",
    Boolean(list.body && (list.body.unknown || []).some((row) =>
      row.accountId === STALE_NO_ID &&
      /unknown until next sign-in/.test(String(row.reason)))));
  check("the row that DOES carry a sealed id is reported departed in " +
    "the same answer (so the check above is a discrimination, not a " +
    "list that is empty for everybody)",
    Boolean(list.body && (list.body.departed || []).some((row) =>
      row.accountId === GONE)));

  const { value: erase } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + STALE_NO_ID,
      { headers: ADMIN_BEARER }));
  /* The lead sentence is the same for all three unknowns and names
     nobody, because the bot IS asked on one of the three (the failed
     allow-list read, fix wave 2 finding F1) and a lead that said the
     bot could not speak would be false there - the same
     never-attribute-to-the-bot rule F3 settled, applied to the
     refusal's first clause rather than to its reason. */
  check("erasing a row with no sealed id is refused - unknown is never " +
    "departed", erase.status === 409 &&
    /could not be confirmed/.test(JSON.stringify(erase.body || {})));
  check("that refusal moved none of its rows",
    belongingTo(db, STALE_NO_ID) === before);
}

/*
 * THE NUMERIC ID NEVER LEAVES THE WORKER (owner ruling, bound 1).
 *
 * The id was allowed to exist at rest on the condition that
 * departedVerdict() is its only reader and nothing serves it. This
 * sweeps the whole of both routes' answers for every numeric id on the
 * fixture rather than checking one field, because the failure this
 * guards against is a future field somebody adds "just for the admin
 * page", not a mistake in the two fields written today.
 */
{
  const db = await fixture();
  const env = envFor(db);
  const { value: list } = await withBot(botSaying("left"), () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));
  const { value: erase } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + GONE,
      { headers: ADMIN_BEARER }));

  const served = JSON.stringify(list.body) + JSON.stringify(erase.body) +
    JSON.stringify(db.adminLog);
  const ids = [GONE_ID, STAYS_ID, ADMIN_ID, FLAGGED_ID, STALE_NO_ID_ID,
    BYPASSED_ID];
  check("no numeric Telegram id appears anywhere in either route's " +
    "answer or in the log line the erase writes",
    ids.every((id) => !served.includes(id)));
  check("no sealed handle appears there either - the directory record " +
    "is opened for the id and nothing else is carried out of it",
    !/sealed-handle|Sealed Name/.test(served));
  check("the erase really did happen in that sweep (so the two checks " +
    "above are reading a populated answer, not an empty one)",
    erase.status === 200 && db.adminLog.length === 1);
}

/*
 * THE LIST NEVER CONTAINS A CURRENT MEMBER - the arm #420 names, and
 * the mutation it names (drop the verdict filter) is what it is armed
 * against.
 *
 * STALE_MEMBER is the case that matters and the one the fixture did not
 * have until this arm needed it: an account that IS stale, so staleness
 * lets it through the pre-filter, and whose sealed id the bot answers
 * "member" for. Only the verdict keeps it off the list. GONE sits in
 * the same answer as a leaver, so this is one call telling two people
 * apart rather than two runs agreeing with themselves.
 */
{
  const db = await fixture();
  db.directory.set(STALE_MEMBER,
    await directoryRow(STALE_MEMBER, STALE_MEMBER_ID, OLD));
  const env = envFor(db);

  const bot = botPerPerson({ [GONE_ID]: "left",
    [STALE_MEMBER_ID]: "member" });
  const { value } = await withBot(bot, () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));

  const listed = (value.body && value.body.departed) || [];
  check("a stale account the bot calls a current member is NOT on the " +
    "departed list", !listed.some((row) => row.accountId === STALE_MEMBER));
  /* An EXACT SET rather than one absence, because the absences are what
     the verdict filter is for and naming them one at a time only ever
     arms the cases somebody thought of. This fixture's stale candidates
     are the leaver, the current member and the record with no id; only
     the first may be here (0.9-M3-S15 fix wave 1: the F3 branch now
     gates bypassed rows above the verdict filter, so a set assertion is
     what keeps #420's own mutation reddening more than one arm). */
  check("and the departed list is EXACTLY the leaver - one row, that " +
    "account - so every other stale candidate is kept off it by the " +
    "verdict and not by luck",
    listed.length === 1 && listed[0].accountId === GONE);
  check("...in the very same answer that DOES carry the leaver, so the " +
    "check above is the verdict filter working and not an empty list",
    listed.some((row) => row.accountId === GONE));
  check("the current member is not quietly moved to `unknown` either - " +
    "the bot answered about them, so nothing is unknown",
    !((value.body && value.body.unknown) || [])
      .some((row) => row.accountId === STALE_MEMBER));

  const before = belongingTo(db, STALE_MEMBER);
  const { value: erase } = await withBot(bot, () =>
    call(env, "DELETE", "/admin-departed/" + STALE_MEMBER,
      { headers: ADMIN_BEARER }));
  check("erasing that current member is refused with Telegram's own " +
    "word quoted back", erase.status === 409 &&
    /member/.test(JSON.stringify(erase.body || {})));
  check("and none of their rows moved", belongingTo(db, STALE_MEMBER) === before);
}

/*
 * THE VERDICT IS RE-ASKED AT ERASE TIME, NEVER CARRIED FROM THE LIST
 * (#420 scope 2). The list is a page an admin may have had open for an
 * hour, and a person can rejoin a Telegram group in a second.
 *
 * Proved by making the two moments DISAGREE: the bot says "left" while
 * the list is built, then "member" when the erase arrives. An
 * implementation that trusted the list would erase; this one refuses.
 */
{
  const db = await fixture();
  const env = envFor(db);
  const before = belongingTo(db, GONE);

  const { value: list } = await withBot(botSaying("left"), () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));
  check("the list offered the account as departed (the setup for the " +
    "check below, not an assumption)",
    ((list.body && list.body.departed) || [])
      .some((row) => row.accountId === GONE));

  const { value: erase } = await withBot(botSaying("member"), () =>
    call(env, "DELETE", "/admin-departed/" + GONE,
      { headers: ADMIN_BEARER }));
  check("the erase refuses once the bot changes its mind - the verdict " +
    "is re-asked, not carried from the list", erase.status === 409);
  check("nothing was erased on that stale verdict",
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
/* 7. THE TOTAL BESIDE THE CAP (0.9-M3-S38, #471; the owner's ruling at */
/*    #454 item 23 - a capped list sends its total).                    */
/*                                                                      */
/* The cap is not new and does not move: DEPARTED_LIST_CAP bounds how   */
/* many accounts one request asks the bot about. What the route was     */
/* missing is any way for a reader to tell a list that stopped short    */
/* from a complete one, so the page's "more" could never reach past the */
/* cap and nothing said so (0.9-M3-S34's review, #458 finding F2).      */
/*                                                                      */
/* THE ORDER IS NOT ON TRIAL AND MUST NOT MOVE - gone-longest-first,    */
/* by the same owner's item 13. Every arm below reads counts, and the   */
/* one that reads position asserts the oldest row is still first.       */

const CAP_IN_SOURCE = Number(
  /const DEPARTED_LIST_CAP = (\d+);/.exec(workerSrc)[1]);

/* Stale by minutes-apart timestamps, so "oldest first" is a total order
   and the arms can say exactly which candidates the cap reaches. */
const staleAt = (i) =>
  new Date(Date.UTC(2020, 0, 1) + i * 60000).toISOString();

const ADMIN_ONLY_MEMBERSHIP = () => [{ account_id: ADMIN, role: "admin",
  label: "the-eraser", added_at: OLD, added_by: ADMIN }];

const ADMIN_SESSION = () => [
  sessionRow("admin-token", ADMIN, { is_admin: 1, admin_via: "flag" })];

/* `count` stale rows and nothing else. Every record is written without
   a sealed numeric id - the ordinary state of every directory row in
   the live database - so each is UNKNOWN without a bot call, and the
   list's length is the candidate count the cap let through and nothing
   about what Telegram said. */
async function candidatesDb(count) {
  const directory = [];
  for (let i = 0; i < count; i += 1) {
    directory.push(await directoryRow(
      accountFor(String(760000000 + i)), null, staleAt(i)));
  }
  return makeDb({ directory: directory, submissions: [],
    membership: ADMIN_ONLY_MEMBERSHIP(), sessions: ADMIN_SESSION() });
}

{
  check("the cap the response sends is the Worker's own constant, read " +
    "out of the shipped source rather than typed here - a response that " +
    "hard-coded 50 would go on saying 50 after the constant moved",
    CAP_IN_SOURCE === 50);
  check("and the candidate read asks D1 for that same constant, so the " +
    "number sent and the number enforced cannot drift apart",
    new RegExp("ORDER BY last_seen_at ASC LIMIT \" \\+ DEPARTED_LIST_CAP")
      .test(workerSrc));
}

for (const count of [0, 1, 50, 51, 120]) {
  const db = await candidatesDb(count);
  const env = envFor(db);
  const { value: list } = await withBot(botSaying("member"), () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));
  const body = list.body || {};
  const served = ((body.departed) || []).length +
    ((body.unknown) || []).length + ((body.allowed) || []).length;

  check("with " + count + " candidates the response's total is " + count +
    " - the count BEFORE the cap, which is the only number that can " +
    "tell a short list from a complete one", body.total === count);
  check("with " + count + " candidates the response's cap is the " +
    "constant's own value", body.cap === CAP_IN_SOURCE);
  check("with " + count + " candidates the list holds min(total, cap) = " +
    Math.min(count, CAP_IN_SOURCE) + " rows - the cap still truncates " +
    "and the total still does not", served === Math.min(count, CAP_IN_SOURCE));
}

{
  /* The oldest candidate is still the first row served: the count is
     added beside the list, never in front of the ORDER BY. */
  const db = await candidatesDb(120);
  const env = envFor(db);
  const { value: list } = await withBot(botSaying("member"), () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));
  const unknown = ((list.body || {}).unknown) || [];
  check("gone-longest-first survives the count (#454 item 13): the " +
    "oldest candidate is the first row and the fiftieth-oldest is the " +
    "last, with none of the seventy beyond the cap served",
    unknown.length === CAP_IN_SOURCE &&
    unknown[0].accountId === accountFor("760000000") &&
    unknown[49].accountId === accountFor(String(760000000 + 49)) &&
    !unknown.some((row) => row.accountId === accountFor(String(760000050))));
}

{
  /*
   * ALL FOUR OUTCOMES AT ONCE, PAST THE CAP. Fifty-five candidates: the
   * fifty the cap reaches are ten departed, ten current members, ten
   * held by the operator's list and twenty unknown, and five more sit
   * beyond it. A current member is the one outcome that is served on no
   * list at all, so the three states add up to the candidates examined
   * only when it is counted as the dropped row it is.
   */
  const DEPARTED_N = 10;
  const CURRENT_N = 10;
  const ALLOWED_N = 10;
  const UNKNOWN_N = 20;
  const BEYOND_N = 5;
  const directory = [];
  const membership = ADMIN_ONLY_MEMBERSHIP();
  const bot = {};
  const beyond = [];
  let seq = 0;
  const seed = async (kind) => {
    const i = seq;
    seq += 1;
    const numericId = String(770000000 + i);
    const accountId = accountFor(numericId);
    if (kind === "departed" || kind === "current") {
      bot[numericId] = kind === "departed" ? "left" : "member";
    }
    if (kind === "allowed") {
      membership.push({ account_id: accountId, role: "always_allow",
        label: null, added_at: OLD, added_by: ADMIN });
    }
    if (kind === "beyond") beyond.push(accountId);
    directory.push(await directoryRow(accountId,
      kind === "unknown" || kind === "beyond" ? null : numericId,
      staleAt(i)));
  };
  for (let i = 0; i < DEPARTED_N; i += 1) await seed("departed");
  for (let i = 0; i < CURRENT_N; i += 1) await seed("current");
  for (let i = 0; i < ALLOWED_N; i += 1) await seed("allowed");
  for (let i = 0; i < UNKNOWN_N; i += 1) await seed("unknown");
  for (let i = 0; i < BEYOND_N; i += 1) await seed("beyond");

  const db = makeDb({ directory: directory, submissions: [],
    membership: membership, sessions: ADMIN_SESSION() });
  const env = envFor(db);
  const { value: list } = await withBot(botPerPerson(bot), () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));
  const body = list.body || {};
  const departedRows = (body.departed) || [];
  const unknownRows = (body.unknown) || [];
  const allowedRows = (body.allowed) || [];

  check("the mixed fixture is real before it is counted - ten of the " +
    "fifty the cap reaches really are departed, twenty really are " +
    "unknown and ten really are held by the operator's list, so the " +
    "arithmetic below is over a populated answer",
    departedRows.length === DEPARTED_N &&
    unknownRows.length === UNKNOWN_N &&
    allowedRows.length === ALLOWED_N);
  check("the total counts every candidate, including the five past the " +
    "cap and the ten current members that appear on no list",
    body.total === DEPARTED_N + CURRENT_N + ALLOWED_N + UNKNOWN_N +
      BEYOND_N);
  check("the three states plus the current members the route drops add " +
    "up to exactly min(total, cap) - the candidates it examined",
    departedRows.length + unknownRows.length + allowedRows.length +
      CURRENT_N === Math.min(body.total, body.cap));
  check("nothing past the cap is served on any of the three lists",
    ![...departedRows, ...unknownRows, ...allowedRows]
      .some((row) => beyond.includes(row.accountId)));

  /* THE NEW FIELDS CARRY NUMBERS AND NOTHING ELSE. The whole-answer
     sweep in section 5 covers every numeric id on its own fixture; this
     is the other direction - the answer's shape, so a later field that
     smuggled a per-member datum in beside the counts is a red rather
     than a thing the sweep happens to catch. */
  check("the answer's top-level keys are exactly the three lists, ok, " +
    "and the two counts - no new field beside them",
    Object.keys(body).sort().join(",") ===
      "allowed,cap,departed,ok,total,unknown");
  check("both new fields are plain numbers, so neither can hold a " +
    "handle, an id, or any per-member datum at all",
    typeof body.total === "number" && typeof body.cap === "number");
  check("the two counts, serialized alone, carry no numeric Telegram id " +
    "and no sealed handle from the fixture",
    !Object.keys(bot).some((numericId) =>
      JSON.stringify({ total: body.total, cap: body.cap })
        .includes(numericId)) &&
    !JSON.stringify({ total: body.total, cap: body.cap })
      .includes("sealed-handle"));
}

{
  /*
   * THE COUNT READ IS NOT ON THE ERASE PATH, PROVEN BY COUNTING IT.
   * S15's rule - the erasing path fails closed on every read it makes -
   * is about the reads that path makes, and this slice adds none to it:
   * the candidate read belongs to the list route alone. A prose claim
   * would be exactly the kind nothing falsifies, so the statement is
   * counted as it is issued.
   */
  const db = await fixture();
  const base = db.DB;
  let candidateReads = 0;
  const watched = Object.assign({}, base, {
    prepare: (sql) => {
      if (/COUNT\(\*\) OVER \(\)/.test(sql)) candidateReads += 1;
      return base.prepare(sql);
    },
  });
  const env = envFor(db, { DB: watched });
  const before = countsFor(db, GONE);

  await withBot(botSaying("left"), () =>
    call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));
  check("the list route makes the candidate read exactly once - one " +
    "read answers the list and the count, and no second read can " +
    "disagree with it", candidateReads === 1);

  candidateReads = 0;
  const { value: erase } = await withBot(botSaying("left"), () =>
    call(env, "DELETE", "/admin-departed/" + GONE,
      { headers: ADMIN_BEARER }));
  check("the erase still erases - the fixture had rows in all four " +
    "classes and the transaction took them",
    erase.status === 200 && before.submissions === 2 &&
    countsFor(db, GONE).submissions === 0 &&
    countsFor(db, GONE).directory === 0 &&
    countsFor(db, GONE).membership === 0 &&
    countsFor(db, GONE).sessions === 0);
  check("and it made the candidate read ZERO times: the count is not a " +
    "read the erasing path makes, so S15's fail-closed rule has nothing " +
    "new to cover", candidateReads === 0);
  check("the erase's own answer carries neither count - they belong to " +
    "the list and nothing else",
    (erase.body || {}).total === undefined &&
    (erase.body || {}).cap === undefined);
}

{
  /*
   * A COUNT CELL THAT COMES BACK UNUSABLE. This is a display number and
   * not a guard - nothing is erased on it - so the route falls back to
   * the rows already in its hand rather than failing closed: NaN would
   * serialize as null and tell the page less than it could see itself.
   * The floor is what makes the fallback safe to state: the total is
   * never smaller than the list it stands beside.
   */
  for (const [label, bogus] of [["null", null], ["a string", "lots"],
      ["missing", undefined], ["below the list", 3]]) {
    const db = await candidatesDb(51);
    const base = db.DB;
    const spoil = (bound) => Object.assign({}, bound, {
      all: async () => {
        const answer = await bound.all();
        return { results: (answer.results || []).map((row) =>
          Object.assign({}, row, { candidates: bogus })) };
      },
    });
    const watched = Object.assign({}, base, {
      prepare: (sql) => {
        const statement = base.prepare(sql);
        if (!/COUNT\(\*\) OVER \(\)/.test(sql)) return statement;
        return Object.assign({},
          spoil(statement),
          { bind: (...args) => spoil(statement.bind(...args)) });
      },
    });
    const env = envFor(db, { DB: watched });
    const { value: list } = await withBot(botSaying("member"), () =>
      call(env, "GET", "/admin-departed", { headers: ADMIN_BEARER }));
    const body = list.body || {};
    check("a count cell that arrives as " + label + " leaves a usable " +
      "total: a real number, never below the rows the same read " +
      "returned, and never null in the JSON",
      typeof body.total === "number" && Number.isFinite(body.total) &&
      body.total >= ((body.unknown) || []).length &&
      /"total":\s*\d+/.test(list.text));
  }
}

/* ------------------------------------------------------------------ */

const EXPECTED = 198;
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
