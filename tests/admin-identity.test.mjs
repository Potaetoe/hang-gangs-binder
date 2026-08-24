/*
 * Admin identity and the settings seam (0.9-M3-S8, #414; the ruled
 * design #385, rules 1, 5, 9 and 11).
 *
 *     node tests/admin-identity.test.mjs
 *
 * FIVE THINGS ARE ON TRIAL HERE, and each one is a way the admin system
 * can be wrong without anything else noticing:
 *
 *   1. WHO IS AN ADMIN. A Telegram group creator or administrator gets
 *      an admin session, beside the two lists this Worker already read -
 *      the `membership` flag and the bootstrap secret. One tier:
 *      identical powers whichever way in.
 *   2. THE SETTINGS KEYS. Five names in `site_content`, validated on
 *      write, refused in both directions.
 *   3. THE FLOOR AND THE UNIT LOCK, read from the store rather than
 *      from a frozen constant - and byte for byte the same answer as
 *      that constant gave while nothing is set.
 *   4. THE CHANGE LOG. Appended on every admin write, with the actor
 *      the write really had; readable by an admin and by nobody else.
 *   5. GET /config, the credential-free door read, which serves exactly
 *      three names and can never serve a fourth.
 *
 * WHY THE WHOLE WORKER RATHER THAN ITS PARTS, and why a data: URL: the
 * same reasons tests/telegram-auth.test.mjs states. The router decides
 * whether a refusal is 401 or 403 and OPERATIONS.md pins those two
 * numbers as the operator's diagnostic; server/worker.js has no
 * package.json making a bare import resolve as ESM, and the rewrite of
 * its relative specifiers is what lets the file run from its own bytes.
 *
 * THE D1 STUB REFUSES WHAT IT DOES NOT RECOGNIZE. Every statement this
 * slice's paths issue is matched by shape and answered; anything else
 * throws by name. A stub that quietly answered "no rows" to a statement
 * it had never seen would turn a route that stopped working into an arm
 * that stays green, which this repository holds to be worse than no arm.
 *
 * THE ARMS READ REAL SHIPPED STATE. Nothing below asserts an absence
 * against a stub default: every "this is hidden", "this is unset" and
 * "this is not served" check forces the opposite state first - a floor
 * that really is 5, a fourth `site_content` row that really is there, a
 * log that really has lines in it - and then asserts. A default that
 * already satisfies the assertion proves nothing (AGENTS.md,
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

const { default: worker } = await loadWorker(workerSrc);

/* The at-rest format, by its own path, so this arm can seal the corpus
   GET /charts-data reads. HKDF's salt is fixed, so a store built from
   the same STORE_SECRET seals what the Worker opens. */
const store = await import(
  pathToFileURL(ROOT + "server/store-crypto.js").href);

/* The spec, loaded the way server/charts-agg.js loads it: a side-effect
   import that assigns globalThis.BINDER_SITE. This arm reads the unit
   systems and the group name from it rather than writing either down -
   a second copy of a spec value is a thing that can be wrong. */
await import(pathToFileURL(ROOT + "apps/web/site.config.js").href);
const SITE = globalThis.BINDER_SITE;

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* ------------------------------------------------------------------ */
/* Canaries.                                                           */

const BOT_TOKEN = "canary-s8-bot-token-belonging-to-nobody";
const CHAT_ID = "canary-s8-chat-id-belonging-to-nobody";
const ACCOUNT_SECRET = "canary-s8-account-secret-belonging-to-nobody";
const STORE_SECRET = "canary-s8-store-secret-belonging-to-nobody-v1";
const EXPORT_TOKEN = "canary-s8-export-token-belonging-to-nobody";
const ORIGIN = "http://localhost:8124";

const accountFor = (numericId) =>
  createHmac("sha256", ACCOUNT_SECRET).update(String(numericId)).digest("hex");

const sha256hex = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/* Four people: the group's own creator, a plain member, a member the
   table flags as an admin, and one the bootstrap secret names. */
const CREATOR_ID = "701010101";
const MEMBER_ID = "702020202";
const FLAGGED_ID = "703030303";
const SECRET_ID = "704040404";

const CREATOR = accountFor(CREATOR_ID);
const MEMBER = accountFor(MEMBER_ID);
const FLAGGED = accountFor(FLAGGED_ID);
const SECRET = accountFor(SECRET_ID);

/* Telegram's scheme, written out rather than imported from the Worker:
   an arm that signed with the code it is checking would agree with any
   mistake in it. */
function sign(fields, botToken) {
  const dataCheck = Object.keys(fields)
    .filter((key) => key !== "hash")
    .sort()
    .map((key) => key + "=" + fields[key])
    .join("\n");
  const secret = createHash("sha256").update(botToken, "utf8").digest();
  return Object.assign({}, fields, {
    hash: createHmac("sha256", secret).update(dataCheck, "utf8").digest("hex"),
  });
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function payloadFor(numericId, handle) {
  return sign({
    id: String(numericId),
    first_name: "Canary",
    username: handle,
    auth_date: String(nowSeconds()),
  }, BOT_TOKEN);
}

/* ------------------------------------------------------------------ */
/* The D1 stub.                                                        */

function makeDb(seed) {
  const sessions = new Map();
  const replay = new Map();
  const directory = new Map();
  let membership = ((seed && seed.membership) || []).slice();
  const content = new Map();
  const adminLog = [];
  const submissions = ((seed && seed.submissions) || []).slice();
  let logSequence = 0;

  for (const [name, value] of Object.entries((seed && seed.content) || {})) {
    content.set(name, { name: name, value: value,
      updated_at: "2026-01-01T00:00:00.000Z", updated_by: "seed" });
  }
  for (const row of (seed && seed.sessions) || []) {
    sessions.set(row.token_hash, row);
  }

  const grants = (id) =>
    typeof id === "string" && /^[0-9a-f]{64}$/.test(id);

  const superseded = (row) => submissions.some((other) =>
    other.supersedes === row.id && other.account_id === row.account_id);

  function answer(sql, args) {
    /* -------- auth_replay -------- */
    if (sql.startsWith("INSERT INTO auth_replay")) {
      if (replay.has(args[0])) return { meta: { changes: 0 } };
      replay.set(args[0], args[1]);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM auth_replay")) {
      for (const [key, expiry] of [...replay]) {
        if (expiry <= args[0]) replay.delete(key);
      }
      return { meta: { changes: 0 } };
    }

    /* -------- sessions -------- */
    if (sql.startsWith("INSERT INTO sessions")) {
      const columns = /INSERT INTO sessions\s*\(([^)]*)\)/.exec(sql)[1]
        .split(",").map((c) => c.trim());
      const row = {};
      columns.forEach((column, index) => { row[column] = args[index]; });
      sessions.set(row.token_hash, row);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("SELECT account_id, is_admin")) {
      return sessions.get(args[0]) || null;
    }
    if (sql.startsWith("DELETE FROM sessions WHERE token_hash")) {
      sessions.delete(args[0]);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM sessions WHERE account_id")) {
      for (const [key, row] of [...sessions]) {
        if (row.account_id === args[0]) sessions.delete(key);
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM sessions WHERE expires_at")) {
      for (const [key, row] of [...sessions]) {
        if (row.expires_at <= args[0]) sessions.delete(key);
      }
      return { meta: { changes: 1 } };
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
    if (sql.startsWith("SELECT account_id, role, label, added_at")) {
      return { results: membership.slice().sort((a, b) =>
        a.role === b.role
          ? String(a.added_at).localeCompare(String(b.added_at))
          : a.role.localeCompare(b.role)) };
    }
    if (sql.startsWith("INSERT INTO membership")) {
      const [account_id, role, label, added_at, added_by] = args;
      const found = membership.find((row) =>
        row.account_id === account_id && row.role === role);
      if (found) found.label = label;
      else membership.push({ account_id, role, label, added_at, added_by });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM membership")) {
      const [wanted, role] = args;
      const guarded = /granting/.test(sql);
      const target = membership.find((row) =>
        row.account_id.toLowerCase() === wanted && row.role === role);
      let blocked = false;
      if (guarded && target) {
        const granting = membership.filter((row) =>
          row.role === "admin" && grants(row.account_id));
        blocked = grants(target.account_id) && granting.length <= 1;
      }
      if (!blocked) {
        membership = membership.filter((row) =>
          !(row.account_id.toLowerCase() === wanted && row.role === role));
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("SELECT account_id FROM membership WHERE account_id")) {
      return { results: membership.filter((row) =>
        row.account_id.toLowerCase() === args[0] && row.role === args[1])
        .map((row) => ({ account_id: row.account_id })) };
    }

    /* -------- site_content -------- */
    if (sql.startsWith("SELECT name, value FROM site_content WHERE name IN")) {
      /* THE IN LIST IS READ FROM THE STATEMENT, NOT ONLY FROM THE BOUND
         ARGUMENTS. D1 answers an `IN` clause with a literal in it; a
         stub filtering on `args` alone does not, so the smallest
         widening anybody would actually write - one more name inside
         the parentheses - would come back with the same rows as the
         allow-list asks for and every check here would stay green over
         a genuinely widened read. Parsing the literals is what makes
         handleReadConfig's second wall reachable from a test at all.

         WHAT THIS SEES, AND WHAT IT DOES NOT. It sees extra literals
         placed INSIDE the `IN (...)` parentheses, and only those. A
         statement widened AROUND that clause is invisible to it: write
         `name IN (?, ?, ?) OR name = 'chart.floor'` and the added
         clause falls outside the parentheses this regex reads, so it
         parses no literal out of it at all; `wanted` is then the three
         bound names alone, the rows come back as the allow-list asks
         for, the behavioral check below stays green, and /config
         answers 200 where real D1 reaches the second wall and answers
         500. Reaching the rewritten shape means parsing the whole
         predicate, which is a SQL engine in a test stub. The bound is
         stated instead, so that a slice rewriting this statement can
         tell it is outside what the arm covers rather than inside it. */
      const clause = /name IN \(([^)]*)\)/.exec(sql);
      const literals = clause
        ? [...clause[1].matchAll(/'([^']*)'/g)].map((m) => m[1]) : [];
      const wanted = new Set([...args, ...literals]);
      return { results: [...content.values()]
        .filter((row) => wanted.has(row.name))
        .map((row) => ({ name: row.name, value: row.value })) };
    }
    if (sql.startsWith("SELECT name FROM site_content WHERE name")) {
      const folded = String(args[0]).toLowerCase();
      const found = [...content.values()].find((row) =>
        row.name.toLowerCase() === folded);
      return found ? { name: found.name } : null;
    }
    /* THE `LIKE` PATTERN IS READ FROM THE STATEMENT AS WELL AS FROM THE
       BOUND ARGUMENT, for the reason the `IN` clause below is parsed:
       D1 honors a pattern written into the statement, so a stub
       filtering on `args` alone would answer the same rows for a read
       somebody widened, and the second wall in each of these two
       readers would be unreachable from a test. The two statements are
       the halves 0.9-M3-S11 (#419) split this table into - the field
       namespace, and everything else. */
    if (/FROM site_content WHERE name (NOT )?LIKE/.test(sql)) {
      const written = /LIKE\s+'([^']*)'/.exec(sql);
      const pattern = written ? written[1] : args[0];
      const body = String(pattern).replace(/%$/, "").toLowerCase();
      const inside = (name) => name.toLowerCase().startsWith(body);
      const wanted = /NOT LIKE/.test(sql)
        ? (name) => !inside(name) : inside;
      return { results: [...content.values()]
        .filter((row) => wanted(row.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((row) => ({ name: row.name, value: row.value })) };
    }
    if (sql.startsWith("INSERT INTO site_content")) {
      const [name, value, updated_at, updated_by] = args;
      content.set(name, { name, value, updated_at, updated_by });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM site_content")) {
      const folded = String(args[0]).toLowerCase();
      for (const [key, row] of [...content]) {
        if (row.name.toLowerCase() === folded) content.delete(key);
      }
      return { meta: { changes: 1 } };
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

    /* -------- directory -------- */
    if (sql.startsWith("INSERT INTO directory")) {
      const [account_id, ciphertext, joined_at, last_seen_at] = args;
      directory.set(account_id,
        { account_id, ciphertext, joined_at, last_seen_at });
      return { meta: { changes: 1 } };
    }
    // The member picker's own read (owner ruling 2026-08-24): everyone
    // who has signed in, newest first.
    if (sql.startsWith("SELECT account_id, ciphertext FROM directory")) {
      return { results: [...directory.values()]
        .sort((a, b) => (a.last_seen_at < b.last_seen_at ? 1 : -1))
        .map((row) => ({ account_id: row.account_id,
          ciphertext: row.ciphertext })) };
    }
    // "does this account's own record open" - what POST /membership
    // asks before it will write a row for a picked account id. It reads
    // the ciphertext rather than testing for a row, so that it answers
    // over exactly the set the picker listed (mandate 3).
    if (sql.startsWith("SELECT ciphertext FROM directory")) {
      const row = directory.get(args[0]);
      return row ? { ciphertext: row.ciphertext } : null;
    }

    /* -------- submissions -------- */
    if (/COUNT\(\*\)/.test(sql) && /FROM submissions AS mine/.test(sql)) {
      const mine = submissions.filter((row) => row.account_id === args[0]);
      const live = mine.filter((row) => !superseded(row));
      return {
        total: mine.length,
        superseded: mine.length - live.length,
        last_at: mine.length
          ? mine.map((row) => row.received_at).sort().at(-1) : null,
      };
    }
    if (/FROM submissions AS mine/.test(sql) && /ORDER BY/.test(sql)) {
      return { results: submissions
        .filter((row) => !superseded(row))
        .sort((a, b) => (a.received_at === b.received_at
          ? b.id - a.id : (a.received_at < b.received_at ? 1 : -1)))
        .map((row) => ({ id: row.id, account_id: row.account_id,
          received_at: row.received_at, ciphertext: row.ciphertext })) };
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
/* The bot seam and the console, swapped for the length of a call.     */

function botSaying(status) {
  return async () => new Response(
    JSON.stringify({ ok: true, result: { status: status } }),
    { status: 200, headers: { "Content-Type": "application/json" } });
}

async function withSeams(botFetch, fn) {
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

async function call(target, env, method, path, options) {
  const opts = options || {};
  const headers = Object.assign({ Origin: ORIGIN }, opts.headers || {});
  const init = { method: method, headers: headers };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = typeof opts.body === "string"
      ? opts.body : JSON.stringify(opts.body);
  }
  const response = await target.fetch(
    new Request("https://sit.example.workers.dev" + path, init), env);
  const text = await response.clone().text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
  // headers too: a response's cache directives are part of its
  // contract, and the security consult of 2026-08-24 turned one of them
  // into a rule rather than a habit.
  const got = {};
  response.headers.forEach((value, key) => { got[key.toLowerCase()] = value; });
  return { status: response.status, body: parsed, text: text, headers: got };
}

const bearer = (token) => ({ Authorization: "Bearer " + token });

/* One sign-in, all seams in place. */
async function signIn(db, numericId, handle, status, target) {
  const env = envFor(db);
  const { value } = await withSeams(botSaying(status || "member"), () =>
    call(target || worker, env, "POST", "/auth/telegram",
      { body: payloadFor(numericId, handle) }));
  return value;
}

/* A live session seeded straight into the table, for the checks that
   are about a session's re-read rather than about minting one. */
function seedSession(db, token, accountId, fields) {
  const now = Date.now();
  db.sessions.set(sha256hex(token), Object.assign({
    token_hash: sha256hex(token),
    account_id: accountId,
    is_admin: 0,
    is_dev: 0,
    admin_via: null,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 10 * 60 * 1000).toISOString(),
  }, fields || {}));
}

/* ------------------------------------------------------------------ */
/* 1. Who is an admin (#385 rule 1; #414 scope 1).                     */

{
  const db = makeDb();
  const body = (await signIn(db, CREATOR_ID, "creatorhandle", "creator")).body;
  check("the group's own creator signs in as an ADMIN - the Telegram " +
    "mirror is wired", body && body.ok === true && body.isAdmin === true);
}

{
  const db = makeDb();
  const body = (await signIn(db, CREATOR_ID, "adminhandle",
    "administrator")).body;
  check("a Telegram group administrator signs in as an ADMIN too",
    body && body.isAdmin === true);
}

{
  const db = makeDb();
  const body = (await signIn(db, MEMBER_ID, "memberhandle", "member")).body;
  check("a plain group member signs in as a MEMBER - the mirror grants " +
    "nothing to somebody the group does not administer",
    body && body.ok === true && body.isAdmin === false);
}

{
  const db = makeDb();
  const body = (await signIn(db, MEMBER_ID, "restrictedhandle",
    "restricted")).body;
  check("a restricted member is a member and not an admin",
    body && body.isAdmin === false);
}

{
  const db = makeDb({ membership: [{ account_id: FLAGGED, role: "admin",
    label: "flagged one", added_at: "2026-01-01T00:00:00.000Z",
    added_by: "seed" }] });
  const body = (await signIn(db, FLAGGED_ID, "flaggedhandle", "member")).body;
  check("a member the `membership` table flags is an admin without any " +
    "group role - the second way in", body && body.isAdmin === true);
}

{
  const db = makeDb();
  const env = envFor(db, { ADMIN_TELEGRAM_IDS: SECRET_ID });
  const { value } = await withSeams(botSaying("member"), () =>
    call(worker, env, "POST", "/auth/telegram",
      { body: payloadFor(SECRET_ID, "secrethandle") }));
  check("the bootstrap secret still grants admin - the union is all " +
    "three arms, not the mirror alone",
    value.body && value.body.isAdmin === true);
}

/* ------------------------------------------------------------------ */
/* 1a. adminVia on GET /me (#414 scope 5).                             */

async function meFor(db, numericId, handle, status, env) {
  const signed = await signIn(db, numericId, handle, status);
  return call(worker, env || envFor(db), "GET", "/me",
    { headers: bearer(signed.body.session) });
}

{
  const db = makeDb();
  const { body } = await meFor(db, CREATOR_ID, "creatorhandle", "creator");
  check("/me reports adminVia \"telegram\" for a group admin",
    body && body.isAdmin === true && body.adminVia === "telegram");
}

{
  const db = makeDb({ membership: [{ account_id: FLAGGED, role: "admin",
    label: "flagged one", added_at: "2026-01-01T00:00:00.000Z",
    added_by: "seed" }] });
  const { body } = await meFor(db, FLAGGED_ID, "flaggedhandle", "member");
  check("/me reports adminVia \"flag\" for a flagged admin",
    body && body.isAdmin === true && body.adminVia === "flag");
}

{
  const db = makeDb();
  const env = envFor(db, { ADMIN_TELEGRAM_IDS: SECRET_ID });
  const signed = await withSeams(botSaying("member"), () =>
    call(worker, env, "POST", "/auth/telegram",
      { body: payloadFor(SECRET_ID, "secrethandle") }));
  const { body } = await call(worker, env, "GET", "/me",
    { headers: bearer(signed.value.body.session) });
  check("/me reports adminVia \"secret\" for an admin the bootstrap " +
    "secret names", body && body.adminVia === "secret");
}

{
  const db = makeDb();
  const { body } = await meFor(db, MEMBER_ID, "memberhandle", "member");
  check("/me reports adminVia null for a member - the field names a " +
    "source of adminness and a member has none",
    body && body.isAdmin === false && body.adminVia === null);
}

{
  const db = makeDb();
  const { body } = await call(worker, envFor(db), "GET", "/me",
    { headers: bearer(EXPORT_TOKEN) });
  check("/me reports adminVia \"break-glass\" for the EXPORT_TOKEN " +
    "caller - it is an admin by a fourth route and says so rather than " +
    "borrowing one of the three", body && body.isAdmin === true &&
    body.adminVia === "break-glass");
}

/* The re-read, in both directions. A flagged admin's row taken away
   demotes on the very next request; a group admin's session cannot be
   re-asked (the numeric id is gone) and stands to its own cap. */
{
  const db = makeDb({ membership: [{ account_id: FLAGGED, role: "admin",
    label: "flagged one", added_at: "2026-01-01T00:00:00.000Z",
    added_by: "seed" }] });
  const signed = await signIn(db, FLAGGED_ID, "flaggedhandle", "member");
  const before = await call(worker, envFor(db), "GET", "/me",
    { headers: bearer(signed.body.session) });
  db.membership().length = 0;
  const after = await call(worker, envFor(db), "GET", "/me",
    { headers: bearer(signed.body.session) });
  check("removing a flagged admin's row demotes their live session on " +
    "its next request, and the label goes with it",
    before.body.isAdmin === true && after.body.isAdmin === false &&
    after.body.adminVia === null);
}

{
  const db = makeDb();
  const signed = await signIn(db, CREATOR_ID, "creatorhandle", "creator");
  const after = await call(worker, envFor(db), "GET", "/me",
    { headers: bearer(signed.body.session) });
  check("a group admin's session survives its own next request with no " +
    "list to be found in - the mirror is checked at sign-in and the " +
    "session carries the verdict", after.body.isAdmin === true &&
    after.body.adminVia === "telegram");
}

{
  /* A session row written straight into D1 claiming the mirror's own
     verdict, dated past the admin cap. The cap is measured from
     created_at on the read, so a hand-written expires_at cannot make
     the one un-re-checkable path a durable credential. */
  const db = makeDb();
  const old = Date.now() - 6 * 3600 * 1000;
  seedSession(db, "hand-written-token", MEMBER, {
    is_admin: 1, admin_via: "telegram",
    created_at: new Date(old).toISOString(),
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
  });
  const { body } = await call(worker, envFor(db), "GET", "/me",
    { headers: bearer("hand-written-token") });
  check("a hand-written session claiming adminVia \"telegram\" past the " +
    "admin cap is a MEMBER - the cap is read from created_at, not from " +
    "the expiry whoever wrote the row chose",
    body && body.isAdmin === false && body.adminVia === null);
}

{
  /* The other end of the same window. created_at is written by the same
     statement that would lie about expires_at, so a date in the FUTURE
     puts the row inside its own two hours indefinitely - the cap read
     from below alone is a cap the writer positions. One hour ahead is
     the smallest lie that does it. */
  const db = makeDb();
  const ahead = Date.now() + 3600 * 1000;
  seedSession(db, "future-dated-token", MEMBER, {
    is_admin: 1, admin_via: "telegram",
    created_at: new Date(ahead).toISOString(),
    expires_at: new Date(ahead + 3600 * 1000).toISOString(),
  });
  const { body } = await call(worker, envFor(db), "GET", "/me",
    { headers: bearer("future-dated-token") });
  check("a hand-written session claiming adminVia \"telegram\" dated an " +
    "hour in the FUTURE is a MEMBER - the admin window is closed at " +
    "both ends, so a chosen created_at cannot open it",
    body && body.isAdmin === false && body.adminVia === null);
}

{
  /* The control the check above needs: the same seam, dated where a
     real row is dated, must still read as an admin. Without it a
     sessionFor() that refused every telegram row would satisfy the
     future-dated check while breaking the feature. */
  const db = makeDb();
  const recent = Date.now() - 30 * 60 * 1000;
  seedSession(db, "recent-token", MEMBER, {
    is_admin: 1, admin_via: "telegram",
    created_at: new Date(recent).toISOString(),
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
  });
  const { body } = await call(worker, envFor(db), "GET", "/me",
    { headers: bearer("recent-token") });
  check("a telegram session dated half an hour ago is still an ADMIN - " +
    "the window's lower bound refuses a future date and nothing else",
    body && body.isAdmin === true && body.adminVia === "telegram");
}

{
  const db = makeDb();
  seedSession(db, "dev-token", MEMBER, {
    is_admin: 1, is_dev: 1, admin_via: "telegram",
  });
  const { body } = await call(worker, envFor(db), "GET", "/me",
    { headers: bearer("dev-token") });
  check("a development session claiming adminVia \"telegram\" is a " +
    "MEMBER - no session Telegram never authenticated takes the " +
    "un-re-checkable path", body && body.isAdmin === false);
}

/* ------------------------------------------------------------------ */
/* 1b. One tier: identical powers whichever way in (#385 rule 1).      */

const ADMIN_ONLY = [
  ["GET", "/membership"],
  ["GET", "/admin-log"],
  ["GET", "/admin-directory"],
  ["POST", "/content"],
];

for (const [method, path] of ADMIN_ONLY) {
  const db = makeDb();
  const signed = await signIn(db, CREATOR_ID, "creatorhandle", "creator");
  const { status } = await call(worker, envFor(db), method, path, {
    headers: bearer(signed.body.session),
    body: method === "POST"
      ? { name: "site.groupName", value: "Canary Gang" } : undefined,
  });
  check(`a Telegram group admin may reach ${method} ${path} - one tier, ` +
    "identical powers", status === 200);
}

for (const [method, path] of ADMIN_ONLY) {
  const db = makeDb();
  const signed = await signIn(db, MEMBER_ID, "memberhandle", "member");
  const { status } = await call(worker, envFor(db), method, path, {
    headers: bearer(signed.body.session),
    body: method === "POST"
      ? { name: "site.groupName", value: "Canary Gang" } : undefined,
  });
  check(`a member is refused ${method} ${path} with 401`, status === 401);
}

/* ------------------------------------------------------------------ */
/* 2. The settings keys, validated on write (#414 scope 2).            */

async function adminSession(db) {
  const signed = await signIn(db, CREATOR_ID, "creatorhandle", "creator");
  return signed.body.session;
}

async function setContent(db, token, name, value) {
  return call(worker, envFor(db), "POST", "/content", {
    headers: bearer(token), body: { name: name, value: value },
  });
}

const SYSTEMS = SITE.units.systems;

const ACCEPTED = [
  ["chart.floor", "0"],
  ["chart.floor", "5"],
  ["chart.floor", "999999"],
  ["chart.lockedUnit", ""],
  ["chart.lockedUnit", SYSTEMS[0]],
  ["chart.lockedUnit", SYSTEMS[1]],
  ["site.groupName", "Canary Gang"],
  ["site.welcomeText", "Come in and weigh yourself."],
  ["site.defaultTheme", "midnight"],
  ["site.defaultTheme", ""],
];

for (const [name, value] of ACCEPTED) {
  const db = makeDb();
  const token = await adminSession(db);
  const { status } = await setContent(db, token, name, value);
  check(`settings: ${name} accepts ${JSON.stringify(value)}`,
    status === 200);
}

const REFUSED = [
  ["chart.floor", "-1", "a negative floor"],
  ["chart.floor", "5.5", "a fractional floor"],
  ["chart.floor", "05", "a floor with a leading zero"],
  ["chart.floor", "five", "a floor spelled in words"],
  ["chart.floor", "", "an empty floor"],
  ["chart.floor", "1000000", "a floor past the ceiling"],
  ["chart.lockedUnit", "furlongs", "a unit system the spec does not offer"],
  ["chart.lockedUnit", "METRIC", "a unit system in the wrong case"],
  ["site.groupName", "", "an empty group name"],
  ["site.groupName", "   ", "a group name of spaces"],
  ["site.groupName", "x".repeat(65), "a group name past the ceiling"],
  ["site.welcomeText", "x".repeat(501), "welcome text past the ceiling"],
  ["site.defaultTheme", "chartreuse", "a palette nothing paints"],
  ["site.defaultTheme", "Midnight", "a palette in the wrong case"],
];

for (const [name, value, why] of REFUSED) {
  const db = makeDb();
  const token = await adminSession(db);
  const { status, body } = await setContent(db, token, name, value);
  check(`settings: ${name} refuses ${why} with 400 and says why`,
    status === 400 && body && typeof body.error === "string" &&
    body.error.length > 0);
}

{
  const db = makeDb();
  const token = await adminSession(db);
  await setContent(db, token, "chart.floor", "-1");
  check("a refused settings write stores nothing - the refusal is not " +
    "a value that failed to render", db.content.size === 0);
}

{
  const db = makeDb();
  const token = await adminSession(db);
  const { status, body } = await setContent(db, token, "chart.Floor", "5");
  check("a settings name in the wrong case is refused rather than " +
    "stored beside the real one - it would shadow the key nothing " +
    "would then be able to set", status === 400 && body &&
    /chart\.floor/.test(body.error));
}

{
  const db = makeDb();
  const token = await adminSession(db);
  await setContent(db, token, "door.motto", "Welcome.");
  const { status } = await setContent(db, token, "door.Motto", "Welcome.");
  check("two free-content names differing only by case cannot both " +
    "exist - the second is refused 409", status === 409);
}

{
  const db = makeDb();
  const token = await adminSession(db);
  const first = await setContent(db, token, "door.motto", "Welcome.");
  const again = await setContent(db, token, "door.motto", "Come in.");
  check("rewriting the same name in the same case is not a collision",
    first.status === 200 && again.status === 200 &&
    db.content.get("door.motto").value === "Come in.");
}

/* ------------------------------------------------------------------ */
/* 3. chartSettings() read from the store (#414 scope 2, #385 rule 11). */

/* A corpus of six people, one row each, sealed the way POST /submit
   seals one. Six clears a floor of five; three of them share a
   filterable value so a raised floor really has something to hide. */
const direct = await store.openStore({ STORE_SECRET: STORE_SECRET });

async function corpus() {
  const rows = [];
  const people = [
    [MEMBER, 80, "male"], [FLAGGED, 84, "male"], [SECRET, 88, "male"],
    [accountFor("705050505"), 92, "female"],
    [accountFor("706060606"), 96, "female"],
    [accountFor("707070707"), 100, "female"],
  ];
  let id = 1000;
  for (const [account, kg, gender] of people) {
    id += 1;
    const record = {
      record: 1,
      submittedAt: "2026-02-01T00:00:00.000Z",
      telegram: "canaryhandle",
      entered: { units: "metric", weight: kg + " kg" },
      weight: { kg: kg, lb: Math.round((kg / 0.45359237) * 10) / 10 },
      gender: gender,
    };
    const sealed = await direct.sealRow(JSON.stringify(record),
      { accountId: account, recordId: String(id) });
    rows.push({ id: id, account_id: account,
      received_at: "2026-02-0" + (rows.length + 1) + "T00:00:00.000Z",
      ciphertext: Buffer.from(sealed).toString("base64"),
      supersedes: null });
  }
  return rows;
}

const CORPUS = await corpus();

async function chartsFor(seedContent, target) {
  const db = makeDb({ submissions: CORPUS, content: seedContent || {} });
  const signed = await signIn(db, MEMBER_ID, "memberhandle", "member", target);
  return call(target || worker, envFor(db), "GET",
    "/charts-data?measure=weight&units=metric",
    { headers: bearer(signed.body.session) });
}

/* The seam's own before-state: chartSettings() replaced by the frozen
   empty object the constant used to be. Comparing the shipped read
   against THAT is the honest form of "byte for byte unchanged at floor
   0" - a fixture of last week's bytes would only say the fixture was
   regenerated, and a comparison against the file at some git ref stops
   proving anything the moment that ref moves. */
const frozenSrc = workerSrc.replace(
  /async function chartSettings\(env\) \{[\s\S]*?\n\}/,
  "async function chartSettings(env) {\n  return Object.freeze({});\n}");
check("the frozen-settings fixture actually changed the source",
  frozenSrc !== workerSrc);
const { default: frozenWorker } = await loadWorker(frozenSrc);

{
  const live = await chartsFor({});
  const frozen = await chartsFor({}, frozenWorker);
  check("floor 0: an unset store gives byte-for-byte the answer the " +
    "frozen empty settings object gave - the seam is wired and the " +
    "shipped behavior did not move",
    live.status === 200 && live.text === frozen.text &&
    live.text.length > 0);
}

{
  const live = await chartsFor({ "chart.floor": "0" });
  const frozen = await chartsFor({}, frozenWorker);
  check("floor 0 set explicitly is the same answer as floor 0 unset",
    live.text === frozen.text);
}

{
  const open = await chartsFor({});
  const floored = await chartsFor({ "chart.floor": "5" });
  const openBody = JSON.parse(open.text);
  const flooredBody = JSON.parse(floored.text);
  check("floor 5 from the store really suppresses - the same corpus " +
    "draws fewer named cells than it does at floor 0",
    floored.status === 200 && open.text !== floored.text &&
    JSON.stringify(flooredBody).length < JSON.stringify(openBody).length);
}

{
  const floored = await chartsFor({ "chart.floor": "5" });
  const body = JSON.parse(floored.text);
  check("a raised floor from the store locks the unit system and says " +
    "so", body.units && body.units.locked === true);
}

{
  /* THE SYSTEM LOCKED TO IS THE ONE THE SPEC DOES NOT DEFAULT TO, and
     the whole check turns on that. charts-agg falls back to
     `units.default` for a lock it cannot read, so locking to the
     default proves nothing: a Worker that ignored the stored value
     entirely would answer the same system and this arm would pass. */
  const other = SYSTEMS.filter((name) => name !== SITE.units.default)[0];
  const db = makeDb({ submissions: CORPUS, content: {
    "chart.floor": "5", "chart.lockedUnit": other } });
  const signed = await signIn(db, MEMBER_ID, "memberhandle", "member");
  const locked = await call(worker, envFor(db), "GET",
    "/charts-data?measure=weight&units=" + SITE.units.default,
    { headers: bearer(signed.body.session) });
  const body = JSON.parse(locked.text);
  check("the locked unit comes from the store, overriding both the ask " +
    "and the spec's own default", other !== SITE.units.default &&
    body.units && body.units.system === other);
}

{
  const open = await chartsFor({ "chart.lockedUnit": SYSTEMS[1] });
  const plain = await chartsFor({});
  check("a locked unit with no floor changes nothing - the lock is the " +
    "raised floor's, and a setting that is not read is not applied",
    open.text === plain.text);
}

{
  const junk = await chartsFor({ "chart.floor": "not-a-number" });
  const plain = await chartsFor({});
  check("a `chart.floor` row the write path could never have stored - " +
    "wrangler validates nothing - falls back to the shipped default " +
    "rather than to some other number", junk.text === plain.text);
}

{
  const db = makeDb({ submissions: CORPUS, content: { "chart.floor": "5" } });
  const signed = await signIn(db, MEMBER_ID, "memberhandle", "member");
  const asked = await call(worker, envFor(db), "GET",
    "/charts-data?measure=weight&units=metric&floor=1",
    { headers: bearer(signed.body.session) });
  check("nothing on the wire reaches the floor - ?floor=1 is still a " +
    "400 with the store holding 5", asked.status === 400);
}

/* ------------------------------------------------------------------ */
/* 4. The change log (#414 scope 3, #385 rule 5).                      */

{
  const db = makeDb();
  const token = await adminSession(db);
  await setContent(db, token, "site.groupName", "Canary Gang");
  const line = db.adminLog[0];
  check("POST /content appends one line naming the actor, the name and " +
    "the new value", db.adminLog.length === 1 && line &&
    line.account_id === CREATOR && line.action === "content.set" &&
    line.name === "site.groupName" && line.summary === "Canary Gang");
}

{
  const db = makeDb();
  const token = await adminSession(db);
  await setContent(db, token, "door.motto", "Welcome.");
  const { status } = await call(worker, envFor(db), "DELETE",
    "/content/door.motto", { headers: bearer(token) });
  check("DELETE /content/:name appends its own line",
    status === 200 && db.adminLog.length === 2 &&
    Boolean(db.adminLog[1]) &&
    db.adminLog[1].action === "content.unset" &&
    db.adminLog[1].name === "door.motto");
}

{
  const db = makeDb();
  const token = await adminSession(db);
  await call(worker, envFor(db), "POST", "/membership", {
    headers: bearer(token),
    body: { telegramId: FLAGGED_ID, role: "admin", label: "flagged one" },
  });
  const line = db.adminLog[0];
  check("POST /membership appends one line naming the actor and the " +
    "account whose row moved", db.adminLog.length === 1 && line &&
    line.account_id === CREATOR && line.action === "membership.add" &&
    line.name === FLAGGED && /admin/.test(line.summary));
}

{
  const db = makeDb({ membership: [
    { account_id: FLAGGED, role: "admin", label: "one",
      added_at: "2026-01-01T00:00:00.000Z", added_by: "seed" },
    { account_id: SECRET, role: "admin", label: "two",
      added_at: "2026-01-02T00:00:00.000Z", added_by: "seed" },
  ] });
  const token = await adminSession(db);
  const { status } = await call(worker, envFor(db), "DELETE",
    "/membership/admin/" + FLAGGED, { headers: bearer(token) });
  check("DELETE /membership/:role/:id appends its own line",
    status === 200 && db.adminLog.length === 1 &&
    Boolean(db.adminLog[0]) &&
    db.adminLog[0].action === "membership.remove" &&
    db.adminLog[0].name === FLAGGED);
}

{
  const db = makeDb();
  const token = await adminSession(db);
  await setContent(db, token, "site.welcomeText", "y".repeat(400));
  check("a long value is summarized rather than copied whole - the log " +
    "is a change record, not a second copy of the table",
    Boolean(db.adminLog[0]) && db.adminLog[0].summary.length <= 200);
}

{
  const db = makeDb();
  const token = await adminSession(db);
  await setContent(db, token, "chart.floor", "-1");
  check("a REFUSED admin write appends nothing - the log records what " +
    "happened, not what was attempted", db.adminLog.length === 0);
}

{
  const db = makeDb({ submissions: CORPUS });
  const signed = await signIn(db, MEMBER_ID, "memberhandle", "member");
  await call(worker, envFor(db), "GET", "/me",
    { headers: bearer(signed.body.session) });
  await call(worker, envFor(db), "GET", "/content",
    { headers: bearer(signed.body.session) });
  check("a member's own requests append nothing", db.adminLog.length === 0);
}

{
  const db = makeDb();
  const env = envFor(db);
  await call(worker, env, "POST", "/content", {
    headers: bearer(EXPORT_TOKEN),
    body: { name: "site.groupName", value: "Canary Gang" },
  });
  check("a break-glass write is recorded as the break glass rather " +
    "than attributed to an account that did not do it",
    db.adminLog.length === 1 && Boolean(db.adminLog[0]) &&
    db.adminLog[0].account_id === "break-glass");
}

{
  const db = makeDb();
  const token = await adminSession(db);
  await setContent(db, token, "site.groupName", "One");
  await setContent(db, token, "site.welcomeText", "Two");
  const { status, body } = await call(worker, envFor(db), "GET",
    "/admin-log", { headers: bearer(token) });
  check("GET /admin-log answers an admin newest first",
    status === 200 && body && Array.isArray(body.log) &&
    body.log.length === 2 && Boolean(body.log[0]) &&
    body.log[0].name === "site.welcomeText" &&
    body.log[0].accountId === CREATOR);
}

{
  const db = makeDb();
  const token = await adminSession(db);
  await setContent(db, token, "site.groupName", "One");
  const member = await signIn(db, MEMBER_ID, "memberhandle", "member");
  const { status } = await call(worker, envFor(db), "GET", "/admin-log",
    { headers: bearer(member.body.session) });
  check("GET /admin-log refuses a member session 401 even with lines " +
    "in the table to withhold", status === 401);
}

{
  const db = makeDb();
  const token = await adminSession(db);
  await setContent(db, token, "site.groupName", "One");
  const { status } = await call(worker, envFor(db), "GET", "/admin-log", {});
  check("GET /admin-log refuses a caller with no credential at all",
    status === 401);
}

{
  const db = makeDb();
  const token = await adminSession(db);
  for (let i = 0; i < 5; i += 1) {
    await setContent(db, token, "door.line" + i, "value " + i);
  }
  const { body } = await call(worker, envFor(db), "GET", "/admin-log",
    { headers: bearer(token) });
  check("the listing is bounded and the bound is the statement's own",
    Boolean(body) && Array.isArray(body.log) && body.log.length === 5);
}

/* ------------------------------------------------------------------ */
/* 5. GET /config, the public door read (#414 scope 4).                */

const PUBLIC_NAMES = ["site.groupName", "site.welcomeText",
  "site.defaultTheme"];

{
  const db = makeDb();
  const { status, body } = await call(worker, envFor(db), "GET", "/config",
    { headers: {} });
  check("GET /config answers with no credential at all and carries " +
    "exactly the three public names",
    status === 200 && body && body.ok === true && Boolean(body.config) &&
    JSON.stringify(Object.keys(body.config || {}).sort()) ===
      JSON.stringify(PUBLIC_NAMES.slice().sort()));
}

{
  const db = makeDb();
  const { body } = await call(worker, envFor(db), "GET", "/config",
    { headers: {} });
  check("an unset store gives the shipped defaults - the group name " +
    "from the spec, and empty strings where the page's own HTML is the " +
    "fallback", Boolean(body.config) &&
    body.config["site.groupName"] === SITE.group.name &&
    body.config["site.welcomeText"] === "" &&
    body.config["site.defaultTheme"] === "");
}

{
  const db = makeDb({ content: {
    "site.groupName": "Canary Gang",
    "site.welcomeText": "Come in.",
    "site.defaultTheme": "daylight",
    "chart.floor": "5",
    "door.motto": "a private note nobody asked for",
  } });
  const { body } = await call(worker, envFor(db), "GET", "/config",
    { headers: {} });
  check("with five names really in the table, /config serves the three " +
    "and no other - the floor and a free-content name stay behind the " +
    "admin gate",
    Boolean(body.config) &&
    JSON.stringify(Object.keys(body.config || {}).sort()) ===
      JSON.stringify(PUBLIC_NAMES.slice().sort()) &&
    body.config["site.groupName"] === "Canary Gang" &&
    body.config["site.defaultTheme"] === "daylight");
}

{
  const db = makeDb({ content: { "chart.floor": "5" } });
  const { text } = await call(worker, envFor(db), "GET", "/config",
    { headers: {} });
  check("the floor's value does not appear anywhere in the answer, " +
    "including in a place a key check would miss",
    !/chart\.floor/.test(text));
}

{
  /* The mutation the ticket names: a fourth name in the allow-list.
     The answer gains a key, so an arm pinning the key set reds. */
  const widened = workerSrc.replace(
    /const PUBLIC_CONFIG = Object\.freeze\(\[([\s\S]*?)\]\);/,
    (whole, inner) =>
      "const PUBLIC_CONFIG = Object.freeze([" + inner + ", \"chart.floor\"]);");
  check("the widened-allow-list fixture actually changed the source",
    widened !== workerSrc);
  const { default: widenedWorker } = await loadWorker(widened);
  const db = makeDb({ content: { "chart.floor": "5" } });
  const { body } = await call(widenedWorker, envFor(db), "GET", "/config",
    { headers: {} });
  check("mutation: a fourth name added to the allow-list is served, " +
    "which is what the key-set check above refuses",
    Boolean(body.config) && Object.keys(body.config).length === 4 &&
    body.config["chart.floor"] === "5");
}

{
  /* The other direction: the statement widened while the allow-list
     stays three. The handler refuses the row rather than dropping it,
     so a widened read is loud instead of quiet. */
  const leaky = workerSrc.replace(
    /const PUBLIC_CONFIG_SQL = [\s\S]*?;\n/,
    "const PUBLIC_CONFIG_SQL = \"SELECT name, value FROM site_content " +
    "ORDER BY name\";\n");
  check("the leaky-statement fixture actually changed the source",
    leaky !== workerSrc);
  const { default: leakyWorker } = await loadWorker(leaky);
  const db = makeDb({ content: { "door.motto": "a private note" } });
  const { status, text } = await call(leakyWorker, envFor(db), "GET",
    "/config", { headers: {} });
  check("mutation: a statement widened past the allow-list answers 500 " +
    "rather than serving the extra row",
    status === 500 && !/a private note/.test(text));
}

{
  /* THE WIDENING SOMEBODY WOULD ACTUALLY WRITE, and the one the check
     above cannot see: not a different statement but the same one with
     one more name inside its parentheses. Replacing the whole statement
     proves the wall against a shape nobody types by accident; a literal
     appended to the IN list is the shape a hurry produces, and it is
     invisible to any stub that filters on the bound arguments. This arm
     therefore reads the IN list out of the statement text (see the D1
     stub above), and this check is what pins that it does. */
  const inList = workerSrc.replace(
    /(const PUBLIC_CONFIG_SQL = [\s\S]*?)\+\n(\s*)"name IN \(" \+ ([\s\S]*?) \+ "\)";/,
    (whole, head, indent, middle) =>
      head + "+\n" + indent + "\"name IN (\" + " + middle +
      " + \", 'chart.floor')\";");
  check("the widened-IN-list fixture actually changed the source",
    inList !== workerSrc);
  const { default: inListWorker } = await loadWorker(inList);
  const db = makeDb({ content: { "chart.floor": "5" } });
  const { status, text } = await call(inListWorker, envFor(db), "GET",
    "/config", { headers: {} });
  check("mutation: one extra literal in the statement's IN list answers " +
    "500 too - the wall catches a widened read, not a rewritten one",
    status === 500 && !/chart\.floor/.test(text));
}

{
  const db = makeDb();
  const { status } = await call(worker, envFor(db), "POST", "/config", {
    headers: bearer(EXPORT_TOKEN), body: { name: "x", value: "y" },
  });
  check("/config is read-only - a POST is 404, not a second write door",
    status === 404);
}

/* ------------------------------------------------------------------ */
/* 6. The palette list, derived from the file that paints them.        */

{
  const themeSrc = await readText(ROOT + "apps/web/theme.js");
  const bg = /const BG = \{([\s\S]*?)\};/.exec(themeSrc);
  const painted = new Set([...(bg ? bg[1] : "")
    .matchAll(/(\w+)\s*:/g)].map((m) => m[1]));
  const named = /const SITE_THEMES = (\[[^\]]*\]);/.exec(workerSrc);
  const declared = new Set(named ? JSON.parse(named[1]) : []);
  check("apps/web/theme.js really was read (an empty set would make " +
    "the comparison below pass on nothing)", painted.size === 4);
  check("server/worker.js's palette list names exactly the palettes " +
    "apps/web/theme.js paints - no more, no fewer",
    painted.size === declared.size &&
    [...declared].every((name) => painted.has(name)));
}

{
  const pages = (await readdir(ROOT + "apps/web"))
    .filter((name) => name.endsWith(".html"))
    .map((name) => name.slice(0, -".html".length));
  check("neither new route is named after a page - html_handling would " +
    "redirect that page into the router",
    !pages.includes("config") && !pages.includes("admin-log"));
}

/* ------------------------------------------------------------------ */
/* 9. THE MEMBER PICKER (owner ruling 2026-08-24, after the owner       */
/* walked the sit: "normal users don't know how to find telegram ids"). */
/* GET /admin-directory names everyone who has signed in, so an admin   */
/* promotes a person instead of typing a number Telegram will not even  */
/* look up from an @username.                                           */
/*                                                                      */
/* THE ARM THAT MATTERS IS THE ONE THAT SEARCHES THE WHOLE RESPONSE for */
/* the numeric id. The directory record carries handle, displayName,    */
/* role AND telegramId under one seal, so the route opens a blob that   */
/* holds the number and has to put back everything except it. A field   */
/* check would pass while a spread of the record leaked it in a key     */
/* nobody thought to assert on; searching the raw body for the digits   */
/* is what actually holds the owner's 2026-08-21 blob-only ruling.      */

{
  const db = makeDb();
  const token = await adminSession(db);
  await signIn(db, MEMBER_ID, "memberhandle", "member");
  const { status, body, text } = await call(worker, envFor(db), "GET",
    "/admin-directory", { headers: bearer(token) });
  const listed = (body && body.members) || [];
  const mine = listed.find((row) => row.accountId === MEMBER);
  check("GET /admin-directory names a member who has signed in, by " +
    "handle and by the account id the membership table keys on",
    status === 200 && Boolean(mine) && mine.handle === "memberhandle" &&
    mine.accountId === MEMBER);
  check("...and the member's NUMERIC Telegram id appears nowhere in the " +
    "whole response - the seal opens for a handle and closes again, " +
    "which is the owner's blob-only ruling (2026-08-21) holding",
    typeof text === "string" && text.indexOf(MEMBER_ID) === -1);
  check("...and no member carries a telegramId field at all, however " +
    "the record it came from was shaped",
    listed.every((row) => row.telegramId === undefined));
  // EXACTLY THESE THREE KEYS, not "the ones we thought to check for".
  // The sealed record also carries `role`, and naming the absent field
  // one at a time only ever refuses the leaks somebody already
  // imagined - an allow-list refuses the next field added to
  // syncDirectoryEntry too, which is the one nobody will re-read this
  // comment before adding.
  check("...and a member carries EXACTLY accountId, handle and " +
    "displayName - an allow-list, so a field added to the sealed " +
    "record later cannot ride out through here unnoticed",
    listed.length > 0 && listed.every((row) =>
      JSON.stringify(Object.keys(row).sort()) ===
      JSON.stringify(["accountId", "displayName", "handle"])));
}

/*
 * THE HARDENING MANDATES (security consult, 2026-08-24). Each of these
 * is a property the route did not have when it first passed review, so
 * each one is armed rather than trusted to the comment beside it.
 */
{
  const db = makeDb();
  const token = await adminSession(db);
  await signIn(db, MEMBER_ID, "memberhandle", "member");
  const { headers } = await call(worker, envFor(db), "GET",
    "/admin-directory", { headers: bearer(token) });
  check("the member list is never stored - `private` refuses a shared " +
    "cache and `no-store` refuses the browser's own disk, on the first " +
    "route here that answers with real people's handles",
    String(headers["cache-control"] || "").includes("no-store") &&
    String(headers["cache-control"] || "").includes("private"));
}

{
  // A record this Worker cannot open is the shape a wrong or rotated
  // STORE_SECRET takes, and an empty list would read to the page as an
  // empty GROUP. The count is what tells the two apart.
  const db = makeDb();
  const token = await adminSession(db);
  await signIn(db, MEMBER_ID, "memberhandle", "member");
  for (const row of db.directory.values()) row.ciphertext = "not-a-seal";
  const { status, body } = await call(worker, envFor(db), "GET",
    "/admin-directory", { headers: bearer(token) });
  check("a directory whose records will not open answers with an " +
    "unreadable COUNT rather than an empty list - a deployment fault " +
    "must not wear the costume of a group nobody has joined",
    status === 200 && body && Array.isArray(body.members) &&
    body.members.length === 0 &&
    body.unreadable === db.directory.size && db.directory.size > 0);
  check("...and the count is the whole of what a failed row reports - " +
    "no id, no ciphertext, nothing out of the record itself",
    JSON.stringify(body).indexOf("not-a-seal") === -1);
}

{
  const db = makeDb();
  const token = await adminSession(db);
  const signed = await signIn(db, MEMBER_ID, "memberhandle", "member");
  const { status } = await call(worker, envFor(db), "POST", "/membership", {
    headers: bearer(token),
    body: { accountId: MEMBER, role: "admin", label: "picked one" },
  });
  const row = db.membership().find((r) => r.account_id === MEMBER);
  check("POST /membership writes the row for an account id the admin " +
    "PICKED, with no numeric id anywhere in the request",
    status === 200 && Boolean(row) && row.role === "admin" &&
    row.label === "picked one" && Boolean(signed));
}

{
  const db = makeDb();
  const token = await adminSession(db);
  const { status, body } = await call(worker, envFor(db), "POST",
    "/membership", {
      headers: bearer(token),
      body: { accountId: MEMBER, role: "admin", label: "never here" },
    });
  check("an account id that has never signed in is refused - sixty-four " +
    "hex characters is a thing anyone can type, and a row for nobody " +
    "would sit in the list looking like authority",
    status === 400 && body && /has not signed in/.test(body.error) &&
    db.membership().every((r) => r.account_id !== MEMBER));
}

{
  const db = makeDb();
  const token = await adminSession(db);
  const { status, body } = await call(worker, envFor(db), "POST",
    "/membership", {
      headers: bearer(token),
      body: { accountId: "not-an-account-id", role: "admin", label: "no" },
    });
  // THE STATUS IS NOT THE ASSERTION HERE. A malformed id also misses the
  // directory, so both refusals are 400 and a status check would pass
  // with the shape guard deleted. The REASON is what tells the two
  // apart, which is this batch's own standing lesson about shared
  // status codes.
  check("a malformed account id is refused on SHAPE - not by falling " +
    "through to the directory miss, which answers 400 as well",
    status === 400 && body && /could not be read/.test(body.error) &&
    !/has not signed in/.test(body.error));
}

/* ------------------------------------------------------------------ */

const EXPECTED = 98;
console.log(failures
  ? `\nadmin-identity FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nadmin-identity ran ${performed} checks, expected ${EXPECTED}`
    : `\nadmin-identity OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
