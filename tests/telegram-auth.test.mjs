/*
 * Sign-in and sessions: the Telegram payload, the freshness window, the
 * replay guard, the session token, and the three-way group verdict
 * (0.9-M1-S5, #331; DESIGN.md, "Accounts", "Sessions", "Bot failure
 * stance", "The identifier is the whole problem").
 *
 *     node tests/telegram-auth.test.mjs
 *
 * THE BOT SEAM IS STUBBED AND ALWAYS WILL BE. Nothing in this file
 * reaches Telegram: globalThis.fetch is replaced for the duration of
 * each call, so the arm exercises what server/worker.js does with an
 * answer rather than whether an answer arrives. The live half - a real
 * payload from a real widget against sit's own bot and test group - is
 * landing evidence a person drives after deploy, and tools/check_live.py
 * is where a claim nobody could perform is recorded. An arm that
 * contacted Telegram would be a gate that fails when somebody else's
 * service is unwell, which is a gate nobody trusts.
 *
 * WHY THE WHOLE WORKER RATHER THAN ITS PARTS. verifyTelegramPayload(),
 * groupStanding() and issueSession() are not exported and must not be:
 * the router is what decides whether a refusal is a 401 or a 403, and
 * the OPERATIONS.md "Checking a deployment" table pins those two
 * numbers as the operator's whole diagnostic. Driving the default
 * export's fetch() is the only way to check the number an operator will
 * actually read. The file is imported through a data: URL - the
 * technique tests/route-precedence.test.mjs uses, and for the same
 * reason: server/worker.js has no package.json making a bare import
 * resolve as ESM, and this still runs the shipped file's real bytes.
 *
 * THE STUB REFUSES WHAT IT DOES NOT RECOGNIZE. Every statement the auth
 * path issues is matched by shape and answered; anything else throws by
 * name. A D1 stub that quietly answers "no rows" to a statement it has
 * never seen turns a route that stopped working into an arm that stays
 * green, which this repository holds to be worse than no arm.
 *
 * CANARIES, NOT PLACEHOLDERS. The bot token, the chat id, the account
 * secret, the handle and the numeric id in this file are distinctive
 * strings that appear nowhere else, so the no-secret-in-logs section can
 * assert their absence rather than assert a shape. None of them is
 * key-shaped and none of them is real.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, createHmac } from "node:crypto";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKER_PATH = ROOT + "server/worker.js";
const SCHEMA_PATH = ROOT + "server/schema.sql";

const readText = async (path) =>
  (await readFile(path, "utf8")).replace(/\r\n/g, "\n");

const workerSrc = await readText(WORKER_PATH);
const schemaSrc = await readText(SCHEMA_PATH);

/* server/worker.js imports its neighbours in server/ - ./store-crypto.js
   (0.9-M1-S6, #332) and ./charts-agg.js (0.9-M2-S0, #351) - and a data:
   module has no base URL to resolve a relative specifier against, so
   Node throws ERR_UNSUPPORTED_RESOLVE_REQUEST before a single check
   runs. Each specifier is rewritten to the real file's absolute URL, so
   the worker still runs from its own bytes (the reason for the data: URL
   in the first place) while the imports resolve.
   THE REWRITE IS NOW GENERAL, on purpose. Its predecessor named
   store-crypto.js alone so that a second relative import would fail
   loudly and be handled deliberately rather than absorbed; a second one
   arrived and this is that deliberate handling. It stays anchored to
   `./<name>.js` in server/, so an import reaching outside that directory
   still fails loudly. */
const serverModule = (name) => pathToFileURL(ROOT + "server/" + name).href;

async function loadWorker(src) {
  const resolved = src.replace(/(\bfrom\s*)"\.\/([\w.-]+\.js)"/g,
    (whole, from, name) => from + '"' + serverModule(name) + '"');
  return import("data:text/javascript," + encodeURIComponent(resolved));
}

const { default: worker, DIRECTORY_SLOT } = await loadWorker(workerSrc);

/* store-crypto imported by its own path, to open the directory record a
   sign-in seals (0.9-M1-S11, #340). Built from the same STORE_SECRET the
   Worker uses below: HKDF's salt is fixed, so this store derives the same
   subkeys and opens what the sign-in's store sealed. */
const store = await import(
  pathToFileURL(ROOT + "server/store-crypto.js").href);

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* ------------------------------------------------------------------ */
/* Canaries.                                                           */

const BOT_TOKEN = "canary-bot-token-belonging-to-nobody";
const CHAT_ID = "canary-chat-id-belonging-to-nobody";
const ACCOUNT_SECRET = "canary-account-secret-belonging-to-nobody";
const STORE_SECRET = "canary-store-secret-belonging-to-nobody-v1";
const HANDLE = "canaryhandle";
const NUMERIC_ID = "606060606";
const ORIGIN = "http://localhost:8124";

const ACCOUNT_ID = createHmac("sha256", ACCOUNT_SECRET)
  .update(NUMERIC_ID).digest("hex");

const sha256hex = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/* Telegram's scheme, written out here rather than imported from the
   Worker: an arm that signed with the same code it is checking would
   agree with any mistake in it. Every field but `hash`, sorted, joined
   key=value with newlines, HMAC-SHA256 under the SHA-256 DIGEST of the
   bot token. */
function sign(fields, botToken) {
  const dataCheck = Object.keys(fields)
    .filter((key) => key !== "hash")
    .sort()
    .map((key) => key + "=" + fields[key])
    .join("\n");
  const secret = createHash("sha256").update(botToken, "utf8").digest();
  return Object.assign({}, fields, {
    hash: createHmac("sha256", secret).update(dataCheck, "utf8")
      .digest("hex"),
  });
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function payloadFor(overrides) {
  return sign(Object.assign({
    id: NUMERIC_ID,
    first_name: "Canary",
    username: HANDLE,
    auth_date: String(nowSeconds()),
  }, overrides || {}), BOT_TOKEN);
}

/* ------------------------------------------------------------------ */
/* The D1 stub.                                                        */

function makeDb(seed) {
  const sessions = new Map();
  const replay = new Map();
  const membership = (seed && seed.membership) || [];
  const directory = new Map();
  const inserts = [];
  const statements = [];

  for (const row of (seed && seed.sessions) || []) {
    sessions.set(row.token_hash, row);
  }

  function answer(sql, args) {
    statements.push(sql);

    if (sql.startsWith("INSERT INTO auth_replay")) {
      const [payloadHash, expiresAt] = args;
      if (replay.has(payloadHash)) return { meta: { changes: 0 } };
      replay.set(payloadHash, expiresAt);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM auth_replay")) {
      for (const [key, expiresAt] of [...replay]) {
        if (expiresAt <= args[0]) replay.delete(key);
      }
      return { meta: { changes: 0 } };
    }
    /* The columns are read OFF THE STATEMENT rather than mapped by
       hand, since 0.9-M3-S8 (#414) added `admin_via` in the middle of
       the list. A hand-written positional map agrees with whatever this
       file expected rather than with what the Worker sent: with
       admin_via inserted fifth, `created_at: args[4]` silently became
       the source label, every deadline parsed to NaN, and three checks
       about session expiry failed for a reason that had nothing to do
       with expiry. */
    if (sql.startsWith("INSERT INTO sessions")) {
      const columns = /INSERT INTO sessions\s*\(([^)]*)\)/.exec(sql)[1]
        .split(",").map((name) => name.trim());
      const row = {};
      columns.forEach((name, index) => { row[name] = args[index]; });
      inserts.push(row);
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
    if (sql.startsWith("SELECT account_id FROM membership")) {
      /* One read made to fail, named by the role it asks for
         (0.9-M3-S15 fix wave 2, review finding F1). Failing the whole
         stub would 500 the request before the branch on trial ran; what
         is on trial is a sign-in decided while THIS read did not
         answer. */
      if (seed && seed.failRole && args[0] === seed.failRole) {
        throw new Error("D1_ERROR: the membership read for role '" +
          args[0] + "' did not answer");
      }
      return {
        results: membership
          .filter((row) => row.role === args[0])
          .map((row) => ({ account_id: row.account_id })),
      };
    }
    /* The roster refresh a verified sign-in issues (0.9-M1-S11, #340).
       One UPSERT; joined_at is kept on conflict and last_seen_at moved
       forward, applied off the DO UPDATE SET clause the statement carries
       so a change to that clause is observed rather than assumed. */
    if (sql.startsWith("INSERT INTO directory")) {
      const [account_id, ciphertext, joined_at, last_seen_at] = args;
      const existing = directory.get(account_id);
      if (!existing) {
        directory.set(account_id,
          { account_id, ciphertext, joined_at, last_seen_at });
        return { meta: { changes: 1 } };
      }
      const incoming = { account_id, ciphertext, joined_at, last_seen_at };
      const setClause = sql.match(/DO UPDATE SET\s+(.+)$/i);
      for (const piece of (setClause ? setClause[1] : "").split(",")) {
        const m = piece.match(/(\w+)\s*=\s*excluded\.(\w+)/i);
        if (m) existing[m[1]] = incoming[m[2]];
      }
      return { meta: { changes: 1 } };
    }
    /* The three reads GET /admin-departed issues (0.9-M3-S15, #420).
       They are here because the departed list is the only reader of the
       numeric id a sign-in seals, so the write half is witnessed by
       driving that route against the row THIS sign-in wrote - nothing
       seeded by hand. The stale pre-filter and the label lookup are
       served from the same two collections the sign-in path already
       fills, so an arm cannot accidentally check a row the Worker did
       not write. */
    /* The statement carries `COUNT(*) OVER ()` since 0.9-M3-S38 (#471):
       the route sends the candidate count beside the capped list, and
       the count is evaluated over every row the WHERE clause admits and
       before LIMIT truncates. Modelled in that order, with the ORDER
       BY's direction read out of the statement and the cap applied, so
       this stub and tests/departed-cleanup.test.mjs's - the arm that
       decides the counting rules - describe one statement rather than
       two. This fixture holds a row or two, far under any cap, so the
       truncation never bites here.

       The direction is here for that agreement and not for an
       assertion: no arm in this file reads the list's order. Modelling
       it anyway is what keeps the two stubs from drifting into two
       different statements, which is how the other one came to serve
       a Worker an order it had never asked for. */
    if (sql.startsWith("SELECT account_id, last_seen_at, " +
        "COUNT(*) OVER () AS candidates FROM directory")) {
      const limit = Number(/LIMIT (\d+)/.exec(sql)[1]);
      const descending = /ORDER BY last_seen_at DESC/.test(sql);
      const matching = [...directory.values()]
        .filter((row) => row.last_seen_at < args[0]);
      const results = matching
        .slice()
        .sort((a, b) => (descending ? -1 : 1) *
          String(a.last_seen_at).localeCompare(b.last_seen_at))
        .slice(0, limit)
        .map((row) => ({
          account_id: row.account_id, last_seen_at: row.last_seen_at,
          candidates: matching.length,
        }));
      return { results: results };
    }
    if (sql.startsWith("SELECT ciphertext FROM directory")) {
      const row = directory.get(args[0]);
      return row ? { ciphertext: row.ciphertext } : null;
    }
    if (sql.startsWith("SELECT account_id, label FROM membership")) {
      return {
        results: membership.map((row) => ({
          account_id: row.account_id, label: row.label || null,
        })),
      };
    }
    throw new Error("the D1 stub was handed a statement it does not " +
      "recognize, which means the auth path changed shape without this " +
      "arm being told: " + sql);
  }

  const bound = (sql, args) => ({
    run: async () => answer(sql, args),
    first: async () => answer(sql, args),
    all: async () => answer(sql, args),
  });

  return {
    sessions, replay, directory, inserts, statements,
    DB: {
      prepare: (sql) => Object.assign(
        { bind: (...args) => bound(sql, args) }, bound(sql, [])),
    },
  };
}

/* sit as it is actually configured: a real bot, a real group, and none
   of ADMIN_TELEGRAM_IDS, ALWAYS_ALLOW_TELEGRAM_IDS or DEV_LOGIN_SECRET
   (0.9-M1-S1, #325; the S5 dispatch's mandate 9). Every default here is
   an absence on purpose - a test env that sets one of the three would
   check a Worker nobody deploys.

   STORE_SECRET is present, and that is one of sit's five deployed secrets
   (server/wrangler.toml [env.sit]): a verified sign-in now refreshes the
   member directory on the encrypted store (0.9-M1-S11, #340), so a sit
   env without it would check a Worker whose sign-in fails its roster
   write on every call. */
function sitEnv(db, overrides) {
  return Object.assign({
    DB: db.DB,
    ACCOUNT_SECRET: ACCOUNT_SECRET,
    STORE_SECRET: STORE_SECRET,
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_GROUP_CHAT_ID: CHAT_ID,
    EXPORT_TOKEN: "canary-export-token-belonging-to-nobody",
    ALLOWED_ORIGINS: ORIGIN,
  }, overrides || {});
}

/* ------------------------------------------------------------------ */
/* The bot seam and the console, both swapped for the length of a call. */

function botAnswering(reply) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init });
      if (typeof reply === "function") return reply(url, init);
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify(reply), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    },
  };
}

const memberAnswer = { ok: true, result: { status: "member" } };
const leftAnswer = { ok: true, result: { status: "left" } };

async function withSeams(bot, fn) {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const realWarn = console.warn;
  const realError = console.error;
  const lines = [];
  const capture = (...args) => lines.push(args.map((a) =>
    typeof a === "string" ? a : JSON.stringify(a)).join(" "));

  globalThis.fetch = bot.fetch;
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  try {
    const value = await fn();
    return { value: value, logs: lines.join("\n") };
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
    console.warn = realWarn;
    console.error = realError;
  }
}

async function post(worker_, env, path, body, headers) {
  const request = new Request("https://sit.example.workers.dev" + path, {
    method: "POST",
    headers: Object.assign({ Origin: ORIGIN,
      "Content-Type": "application/json" }, headers || {}),
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const response = await worker_.fetch(request, env);
  let parsed = null;
  try {
    parsed = await response.clone().json();
  } catch (error) {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

async function send(worker_, env, method, path, headers) {
  const request = new Request("https://sit.example.workers.dev" + path, {
    method: method, headers: headers || {},
  });
  const response = await worker_.fetch(request, env);
  let parsed = null;
  try {
    parsed = await response.clone().json();
  } catch (error) {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

/* One sign-in, all seams in place. Returns the answer, the logs it
   produced, the rows it wrote and what the bot was asked. */
async function signIn(options) {
  const opts = options || {};
  const db = opts.db || makeDb(opts.seed);
  const env = sitEnv(db, opts.env);
  const bot = botAnswering(
    Object.prototype.hasOwnProperty.call(opts, "bot")
      ? opts.bot : memberAnswer);
  const target = opts.worker || worker;
  const { value, logs } = await withSeams(bot, () =>
    post(target, env, "/auth/telegram",
      opts.payload === undefined ? payloadFor() : opts.payload));
  return { db, env, bot, logs, status: value.status, body: value.body };
}

/* ------------------------------------------------------------------ */
/* 1. Payload verification, exactly (mandate 1).                       */

{
  const { status, body } = await signIn({});
  check("a correctly signed, fresh payload from a group member is " +
    "signed in", status === 200 && body && body.ok === true &&
    typeof body.session === "string");
}

{
  const good = payloadFor();
  const tampered = Object.assign({}, good, { id: "111111111" });
  const { status, body } = await signIn({ payload: tampered });
  check("a payload whose fields were edited after signing is refused " +
    "401 - the hash no longer covers them",
    status === 401 && body && body.error &&
    /could not be verified/.test(body.error));
}

{
  const good = payloadFor();
  const flipped = Object.assign({}, good, {
    hash: good.hash.slice(0, -1) + (good.hash.endsWith("a") ? "b" : "a"),
  });
  const { status } = await signIn({ payload: flipped });
  check("a payload with one character changed in its hash is refused 401",
    status === 401);
}

{
  const unsigned = payloadFor();
  delete unsigned.hash;
  const { status } = await signIn({ payload: unsigned });
  check("a payload carrying no hash at all is refused 401", status === 401);
}

{
  const { status } = await signIn({ payload: payloadFor(),
    env: { TELEGRAM_BOT_TOKEN: undefined } });
  check("a Worker holding no bot token verifies nothing and refuses 401 " +
    "- it never reaches the group check", status === 401);
}

{
  /* The signature covers every field, so a field the Worker does not
     know about still has to be inside the data-check string. A payload
     signed WITHOUT an extra field but presented WITH it must fail. */
  const good = payloadFor();
  const smuggled = Object.assign({}, good, { photo_url: "https://x/y.jpg" });
  const { status } = await signIn({ payload: smuggled });
  check("a field added after signing is refused - verification covers " +
    "every field, not a known subset", status === 401);
}

{
  const { status, body } = await signIn({
    payload: payloadFor({ username: "" }) });
  check("a verified member with no Telegram username is refused 403 and " +
    "told which thing to fix", status === 403 && body && body.error &&
    /username/i.test(body.error));
}

{
  const { status } = await signIn({ payload: "not json at all" });
  check("a body that is not JSON is refused 400 before any verification",
    status === 400);
}

{
  const { status } = await signIn({ payload: "x".repeat(5000) });
  check("a body past the pre-credential ceiling is refused 413",
    status === 413);
}

/* ------------------------------------------------------------------ */
/* 2. Freshness, both edges, and a strictly numeric auth_date          */
/* (mandate 2).                                                        */

{
  const { status } = await signIn({
    payload: payloadFor({ auth_date: String(nowSeconds() - 299) }) });
  check("a payload 299 seconds old is still inside the window",
    status === 200);
}

{
  const { status } = await signIn({
    payload: payloadFor({ auth_date: String(nowSeconds() - 301) }) });
  check("a payload 301 seconds old is past the window and refused 401 " +
    "- without this a captured payload never expires", status === 401);
}

{
  const { status } = await signIn({
    payload: payloadFor({ auth_date: String(nowSeconds() + 30) }) });
  check("a payload 30 seconds in the future is inside the clock-skew " +
    "allowance", status === 200);
}

{
  const { status } = await signIn({
    payload: payloadFor({ auth_date: String(nowSeconds() + 120) }) });
  check("a payload 120 seconds in the future is refused 401 - a clock " +
    "nobody here set is not a reason to extend the window",
    status === 401);
}

{
  const { status } = await signIn({
    payload: payloadFor({ auth_date: "yesterday" }) });
  check("a non-numeric auth_date is refused 401 rather than coerced",
    status === 401);
}

{
  const { status } = await signIn({
    payload: payloadFor({ auth_date: " " + nowSeconds() + " " }) });
  check("an auth_date that is only numeric after JavaScript trims it is " +
    "refused - the check reads the field as written", status === 401);
}

/* ------------------------------------------------------------------ */
/* 3. Replay: one session per payload (mandate 3).                     */

{
  const payload = payloadFor();
  const db = makeDb();
  const first = await signIn({ payload: payload, db: db });
  const second = await signIn({ payload: payload, db: db });
  check("the same payload posted twice mints exactly one session",
    first.status === 200 && second.status !== 200 &&
    db.inserts.length === 1);
  check("the replayed payload is refused with the same 401 body a " +
    "tampered one gets - the two are not tellable apart",
    second.status === 401 && second.body && second.body.error &&
    /could not be verified/.test(second.body.error));
  check("the replay guard stores a HASH of the payload's hash, never " +
    "the payload's own hash", db.replay.size === 1 &&
    ![...db.replay.keys()].includes(payload.hash) &&
    [...db.replay.keys()][0] === sha256hex(payload.hash));
}

{
  // Both payloads are pinned to ONE captured second (0.9-M3-S35, #460,
  // found by the gate's new pool: two separate `nowSeconds()` calls, one
  // inside `payloadFor()`'s own default and one in this block's second
  // override, can straddle a real second boundary if the `await` between
  // them runs long enough - under a contended pool that is no longer
  // astronomically rare. When they do, "auth_date - 1" for the second
  // payload lands on the SAME second the first payload's own auth_date
  // used, making the two payloads byte-identical and turning "two
  // different payloads" into a same-payload replay the guard correctly
  // refuses - a false red about the guard, not evidence against it. A
  // single `anchor` read once, before either payload exists, removes the
  // race instead of shrinking its window.
  const db = makeDb();
  const anchor = nowSeconds();
  await signIn({ payload: payloadFor({ auth_date: String(anchor) }),
    db: db });
  await signIn({ payload: payloadFor({ auth_date: String(anchor - 1) }),
    db: db });
  check("two DIFFERENT payloads from the same account both mint a " +
    "session - the guard is per payload, not per account",
    db.inserts.length === 2);
}

{
  const db = makeDb();
  await signIn({ payload: payloadFor(), db: db });
  const claimed = [...db.replay.values()][0];
  const parsed = Date.parse(claimed);
  check("a claimed payload's replay row outlives the freshness window " +
    "it was accepted in, so ageing the row out can never re-open a " +
    "payload freshness would still accept",
    Number.isFinite(parsed) && parsed >= Date.now() + 300 * 1000);
}

{
  /* An unverifiable payload must not be able to fill the table: the
     claim runs after the signature and the window, never before. */
  const db = makeDb();
  await signIn({ payload: payloadFor({ auth_date: "yesterday" }), db: db });
  check("a payload that fails verification writes no replay row - junk " +
    "cannot fill the table", db.replay.size === 0);
}

/* ------------------------------------------------------------------ */
/* 3b. The replay hold outlasts freshness AT THE SKEW CEILING.         */
/*                                                                     */
/* Freshness floors Date.now() to whole seconds, so a payload dated at */
/* the skew ceiling stays acceptable through the entire final second - */
/* a millisecond short of auth_date + AUTH_FRESHNESS_SECONDS + 1. The  */
/* replay row expires in milliseconds, so a hold of exactly            */
/* AUTH_FRESHNESS_SECONDS + AUTH_SKEW_SECONDS falls due up to 999 ms   */
/* early and an intervening prune can delete the spent row while a     */
/* replay of it still passes freshness. Time is pinned (Date.now       */
/* stubbed to whole-second instants) so the boundary is exact rather   */
/* than racing the wall clock, and the claim instant carries no        */
/* sub-second remainder - the worst case, where the un-padded hold     */
/* expires a full 999 ms too soon.                                     */

{
  const realNow = Date.now;
  // A whole-second claim instant, so the freshness ceiling and the
  // row's due time compare to the millisecond.
  const T0 = 1760000000000;
  const claimSec = T0 / 1000;
  // The skew ceiling: auth_date as far ahead of the claim as the floor
  // in verifyTelegramPayload() allows (age === -AUTH_SKEW_SECONDS).
  const ceilingDate = String(claimSec + 60);
  // Fresh through auth_date + AUTH_FRESHNESS_SECONDS entire; the last
  // millisecond it is still accepted is (auth_date + 300 + 1) * 1000 - 1.
  const lastFreshMs = (claimSec + 60 + 300 + 1) * 1000 - 1;

  const db = makeDb();
  const spent = payloadFor({ auth_date: ceilingDate });
  try {
    Date.now = () => T0;
    const first = await withSeams(botAnswering(memberAnswer), () =>
      post(worker, sitEnv(db), "/auth/telegram", spent));
    check("skew-ceiling replay: the first sign-in at the claim instant " +
      "is accepted, so the boundary is measured against a real claim",
      first.value.status === 200 && db.replay.has(sha256hex(spent.hash)));

    // An intervening, unrelated sign-in at the last-fresh millisecond
    // runs the prune (DELETE FROM auth_replay WHERE expires_at <= now).
    // A different auth_date keeps its hash distinct from the spent one,
    // so it mints its own session rather than reading as a replay.
    Date.now = () => lastFreshMs;
    await withSeams(botAnswering(memberAnswer), () =>
      post(worker, sitEnv(db), "/auth/telegram",
        payloadFor({ auth_date: String(claimSec + 360) })));
    check("skew-ceiling replay: the spent payload's row survives that " +
      "prune - it is held past the last millisecond the payload is fresh",
      db.replay.has(sha256hex(spent.hash)));

    // Replay the ORIGINAL payload at that same last-fresh instant: it is
    // still fresh, so only the surviving row can refuse it.
    const replay = await withSeams(botAnswering(memberAnswer), () =>
      post(worker, sitEnv(db), "/auth/telegram", spent));
    check("skew-ceiling replay: replaying the spent payload at the last " +
      "millisecond it is still fresh is refused 401 and mints nothing " +
      "new", replay.value.status === 401 && db.inserts.length === 2);
  } finally {
    Date.now = realNow;
  }
}

/* ------------------------------------------------------------------ */
/* 4. The session token and how it is stored (mandate 4).              */

{
  const { db, body } = await signIn({});
  const row = db.inserts[0];
  check("the session token is base64url with no padding, the shape 32 " +
    "random bytes take", /^[A-Za-z0-9_-]{43}$/.test(body.session));
  check("the row stores the SHA-256 of the token and never the token",
    row && row.token_hash === sha256hex(body.session) &&
    row.token_hash !== body.session);
  check("no row anywhere in the stub holds the token verbatim",
    !JSON.stringify([...db.sessions.values()]).includes(body.session));
  check("the session travels in the response body for an Authorization " +
    "header and sets no cookie", body.session &&
    !/set-cookie/i.test(JSON.stringify(body)));
  check("two sign-ins mint two different tokens",
    body.session !== (await signIn({})).body.session);
}

{
  const { db, body } = await signIn({});
  const row = db.inserts[0];
  check("the row is keyed to the account id - the HMAC of the numeric " +
    "id under ACCOUNT_SECRET - and the numeric id appears in no column",
    row && row.account_id === ACCOUNT_ID &&
    !JSON.stringify(row).includes(NUMERIC_ID));
  check("the sign-in answer no longer echoes the Telegram numeric id: " +
    "the field existed to bootstrap ADMIN_TELEGRAM_IDS, which sit does " +
    "not carry", !("telegramId" in body) || body.telegramId === null);
}

/* ------------------------------------------------------------------ */
/* 5. Idle expiry is one rule everywhere (mandate 5; DESIGN.md,        */
/* "Sessions" - the pre-0.9 member exemption is gone).                 */

{
  const { db, body } = await signIn({});
  const row = db.inserts[0];
  const created = Date.parse(row.created_at);
  const deadline = Date.parse(row.expires_at);
  check("a MEMBER row's stored deadline is the idle window, not the " +
    "seven-day cap - the exemption DESIGN.md retired is retired here",
    deadline - created < 60 * 60 * 1000);
  check("the caller is still told the absolute cap rather than the idle " +
    "window, so a page does not invent a timeout nobody specified",
    Date.parse(body.expiresAt) - created > 24 * 60 * 60 * 1000);
}

{
  /* Using a session slides its window; the cap it cannot slide past is
     what makes the slide safe. A row created a week ago carries a
     deadline in the past, so it is swept rather than renewed. */
  const token = "canary-session-token-belonging-to-nobody";
  const longAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  const db = makeDb({ sessions: [{
    token_hash: sha256hex(token), account_id: ACCOUNT_ID, is_admin: 0,
    is_dev: 0, created_at: longAgo, expires_at: longAgo,
  }] });
  const { value } = await withSeams(botAnswering(memberAnswer), () =>
    send(worker, sitEnv(db), "GET", "/me",
      { Origin: ORIGIN, Authorization: "Bearer " + token }));
  check("an expired row is refused 401 and swept rather than served",
    value.status === 401 && db.sessions.size === 0);
}

{
  const token = "canary-session-token-belonging-to-nobody";
  const created = new Date(Date.now() - 60 * 1000).toISOString();
  const soon = new Date(Date.now() + 60 * 1000).toISOString();
  const db = makeDb({ sessions: [{
    token_hash: sha256hex(token), account_id: ACCOUNT_ID, is_admin: 0,
    is_dev: 0, created_at: created, expires_at: soon,
  }] });
  const before = db.sessions.get(sha256hex(token)).expires_at;
  await withSeams(botAnswering(memberAnswer), () =>
    send(worker, sitEnv(db), "GET", "/me",
      { Origin: ORIGIN, Authorization: "Bearer " + token }));
  const after = db.sessions.get(sha256hex(token)).expires_at;
  check("using a MEMBER session slides its idle window forward",
    Date.parse(after) > Date.parse(before));
}

{
  const token = "canary-session-token-belonging-to-nobody";
  const created = new Date(Date.now() - 60 * 1000).toISOString();
  const soon = new Date(Date.now() + 60 * 1000).toISOString();
  const db = makeDb({ sessions: [{
    token_hash: sha256hex(token), account_id: ACCOUNT_ID, is_admin: 0,
    is_dev: 0, created_at: created, expires_at: soon,
  }] });
  const { value } = await withSeams(botAnswering(memberAnswer), () =>
    send(worker, sitEnv(db), "DELETE", "/session",
      { Origin: ORIGIN, Authorization: "Bearer " + token }));
  check("DELETE /session removes the row rather than only the page's " +
    "copy of the token", value.status === 200 && db.sessions.size === 0);
}

{
  const { value } = await withSeams(botAnswering(memberAnswer), () =>
    send(worker, sitEnv(makeDb()), "DELETE", "/session",
      { Origin: ORIGIN, Authorization: "Bearer made-up-string" }));
  check("DELETE /session with a token that resolves to no row is " +
    "refused 401 rather than thanked", value.status === 401);
}

/* ------------------------------------------------------------------ */
/* 6. The group verdict: fail-closed, bounded, and three-way           */
/* (mandate 6; DESIGN.md, "Bot failure stance").                       */

{
  const { status, body } = await signIn({
    env: { TELEGRAM_GROUP_CHAT_ID: undefined } });
  check("a Worker with no TELEGRAM_GROUP_CHAT_ID admits nobody - the " +
    "check cannot be made, so it fails closed", status === 403 &&
    body && /members of the group only/.test(body.error));
}

{
  const { bot } = await signIn({
    env: { TELEGRAM_GROUP_CHAT_ID: undefined } });
  check("the unconfigured Worker never builds a Telegram URL, so it " +
    "cannot interpolate a bot token it was not going to use",
    bot.calls.length === 0);
}

{
  const { bot } = await signIn({});
  check("the group check is bounded by an abort signal rather than " +
    "left to hang", bot.calls.length === 1 && bot.calls[0].init &&
    bot.calls[0].init.signal &&
    typeof bot.calls[0].init.signal.aborted === "boolean");
}

/* An AbortSignal does not publish its own duration, so the number is
   read off the source - both halves, because either alone is passable
   while the other is wrong: a constant nothing uses, or a use of a
   constant somebody set to five minutes. */
check("the bound is five seconds",
  /GROUP_CHECK_TIMEOUT_MS = 5000;/.test(workerSrc));
check("and it is that constant the group check is bounded by",
  /signal: AbortSignal\.timeout\(GROUP_CHECK_TIMEOUT_MS\)/.test(workerSrc));

{
  const { status } = await signIn({ bot: new Error("network is down") });
  check("a throwing bot call refuses the sign-in 403", status === 403);
}

{
  const { status } = await signIn({
    bot: async () => new Response("<html>bad gateway</html>",
      { status: 502 }) });
  check("a bot answer that is not JSON refuses the sign-in 403",
    status === 403);
}

{
  const { status } = await signIn({ bot: { ok: false, description: "no" } });
  check("a bot answer of ok:false refuses the sign-in 403", status === 403);
}

{
  const { status } = await signIn({
    bot: { ok: true, result: { status: "something_new" } } });
  check("a chat status nobody here has been taught refuses the sign-in " +
    "403 rather than being read as a departure", status === 403);
}

{
  const { status } = await signIn({
    bot: { ok: true, result: { status: "restricted", is_member: false } } });
  check("a restricted member who has actually left is refused 403",
    status === 403);
}

{
  const { status } = await signIn({
    bot: { ok: true, result: { status: "restricted", is_member: true } } });
  check("a restricted member who is still in the group signs in",
    status === 200);
}

{
  const token = "canary-session-token-belonging-to-nobody";
  const soon = new Date(Date.now() + 3600 * 1000).toISOString();
  const seed = { sessions: [{
    token_hash: sha256hex(token), account_id: ACCOUNT_ID, is_admin: 0,
    is_dev: 0, created_at: new Date().toISOString(), expires_at: soon,
  }] };

  const gone = makeDb(seed);
  await signIn({ db: gone, bot: leftAnswer });
  check("a definitive departure ends every session that account holds",
    gone.sessions.size === 0);

  const unreachable = makeDb(seed);
  await signIn({ db: unreachable, bot: new Error("network is down") });
  check("an unreachable Telegram revokes NOTHING - cannot check is " +
    "never read as not a member (DESIGN.md, 'Bot failure stance')",
    unreachable.sessions.size === 1);

  const unteached = makeDb(seed);
  await signIn({ db: unteached,
    bot: { ok: true, result: { status: "something_new" } } });
  check("an unteached status revokes nothing either", unteached.sessions.size === 1);
}

{
  const left = await signIn({ bot: leftAnswer });
  const unknown = await signIn({ bot: new Error("network is down") });
  check("left and cannot-check are one refusal to the caller - the " +
    "difference is spent inside, never reported outward",
    left.status === unknown.status &&
    JSON.stringify(left.body) === JSON.stringify(unknown.body));
}

/*
 * A SIGN-IN NEVER SAYS "NOT ALLOWED" OVER AN UNREADABLE ALLOW LIST
 * (0.9-M3-S15 fix wave 2, review finding F1).
 *
 * ALWAYS_ALLOW is checked before the bot, so the answer to "may this
 * person in regardless of the group" is decided by a read of the
 * `membership` table. That read used to answer a thrown query with the
 * empty set, which reads as "not on the list" - so one D1 error could
 * refuse somebody an operator had explicitly allowed, and tell them
 * they are not a member of the group. That is a claim the Worker was
 * not entitled to make.
 *
 * TWO PROPERTIES, AND THEY PULL IN OPPOSITE DIRECTIONS, which is why
 * both are pinned here. A failed list read must not lock out members
 * the GROUP still confirms - refusing every sign-in during a partial
 * D1 problem would be a worse outage than the one that caused it. And
 * a failed list read must not be spent as a refusal, because the
 * unread list may have been holding this person open. So: the bot's
 * "member" still signs in, and anything else answers as this Worker
 * answers any error rather than as a verdict about membership.
 *
 * AND NOTHING IS REVOKED on that answer. Ending sessions is the other
 * irreversible act this path can take, and a departure the operator's
 * list may have overridden is not grounds for it.
 */
{
  const { status, body, bot } = await signIn({
    seed: { failRole: "always_allow" }, bot: memberAnswer });
  check("with the always_allow read failing, a member the GROUP still " +
    "confirms signs in normally - an unreadable list is not an outage " +
    "for everybody", status === 200 && body && body.ok === true &&
    bot.calls.length === 1);
}

{
  const { status, body } = await signIn({
    seed: { failRole: "always_allow" }, bot: leftAnswer });
  check("with that read failing, a sign-in the bot would refuse is NOT " +
    "told it is not a member - the list that might have allowed it is " +
    "exactly what could not be read", status !== 403 &&
    !/members of the group only/.test(String((body || {}).error)));
  check("it answers as this Worker answers any error instead, so the " +
    "page shows a failure rather than a verdict",
    status === 500 && body && body.error === "Something went wrong.");
}

{
  const token = "canary-allow-list-token-belonging-to-nobody";
  const soon = new Date(Date.now() + 3600 * 1000).toISOString();
  const db = makeDb({ failRole: "always_allow", sessions: [{
    token_hash: sha256hex(token), account_id: ACCOUNT_ID, is_admin: 0,
    is_dev: 0, created_at: new Date().toISOString(), expires_at: soon,
  }] });
  await signIn({ db: db, bot: leftAnswer });
  check("and it revokes NOTHING - a departure the unread list may have " +
    "overridden is not grounds for ending sessions", db.sessions.size === 1);
}

/*
 * AN always_allow ROW IN THE WRONG LETTER CASE STILL GRANTS NOTHING
 * (0.9-M3-S15 fix wave 3, review finding F1).
 *
 * THIS IS THE HALF THAT MUST NOT MOVE. Fix wave 3 made the departed
 * check read the operator's list without regard to letter case,
 * because the erase's own DELETE matches that way and a guard that
 * could not see the row let the erase destroy it. That is PROTECTION.
 * Sign-in asks a different question - may this person in - and the
 * answer there is unchanged: a row spelled in a case nothing in this
 * Worker writes is a row nobody can prove was meant, and admitting
 * somebody on the strength of it would widen an authentication
 * boundary that no ruling widened.
 *
 * Grants nothing, protects everything - and the protecting half is
 * armed in tests/departed-cleanup.test.mjs. Both directions here: the
 * same row spelled the way this Worker writes it DOES bypass, so the
 * refusal below is the case check working and not the bypass being
 * broken outright.
 */
{
  const rowFor = (accountId) => [{ account_id: accountId,
    role: "always_allow", label: "written-by-hand",
    added_at: "2020-01-01T00:00:00.000Z", added_by: accountId }];

  const near = await signIn({
    seed: { membership: rowFor(ACCOUNT_ID.toUpperCase()) },
    bot: leftAnswer });
  check("an always_allow row in UPPER-CASE hex does not let a leaver " +
    "sign in - the near-miss row grants nobody anything",
    near.status === 403 || near.status === 401);
  check("and the bot WAS asked about them, so that row was never read " +
    "as a bypass", near.bot.calls.length === 1);

  const exact = await signIn({
    seed: { membership: rowFor(ACCOUNT_ID) }, bot: leftAnswer });
  check("the same row spelled the way this Worker writes it DOES " +
    "bypass, so the refusal above is the letter case and not a broken " +
    "list", exact.status === 200 &&
    Boolean(exact.body && exact.body.ok === true));
  check("...and that one asked the bot nothing at all",
    exact.bot.calls.length === 0);
}

/* ------------------------------------------------------------------ */
/* 7. The 401/403 contract OPERATIONS.md's check table pins.           */

{
  const { value } = await withSeams(botAnswering(memberAnswer), () =>
    send(worker, sitEnv(makeDb()), "GET", "/me", { Origin: ORIGIN }));
  check("a gated route with an allowed Origin and no credential answers " +
    "401 - the healthy answer OPERATIONS.md's table names",
    value.status === 401 && value.body &&
    value.body.error === "Not authorized.");
}

{
  const { value } = await withSeams(botAnswering(memberAnswer), () =>
    send(worker, sitEnv(makeDb()), "GET", "/me", {}));
  // 401, not the 403 this check pinned until 0.9-M2-S8 (#365). A GET
  // with no Origin header is what every same-origin read looks like,
  // so the gate admits it and the SESSION refuses it - which is the
  // answer OPERATIONS.md's check table now names as healthy. The whole
  // three-state gate is tests/origin-gate.test.mjs's subject; this
  // check is here because OPERATIONS.md's table is what it pins.
  check("the same route with NO Origin header answers 401 - the gate " +
    "admits a same-origin read and the credential refuses it, exactly " +
    "as the table says",
    value.status === 401 && value.body &&
    value.body.error === "Not authorized.");
}

{
  const { value } = await withSeams(botAnswering(memberAnswer), () =>
    send(worker, sitEnv(makeDb()), "GET", "/me",
      { Origin: "https://somewhere.else.example" }));
  check("an origin this Worker does not allow answers 403 as well",
    value.status === 403);
}

/* ------------------------------------------------------------------ */
/* 8. sit's posture: a session's kind follows the group role, and       */
/* nothing else on sit grants one (mandate 9, as 0.9-M3-S8 leaves it).  */

{
  const { db, body } = await signIn({});
  check("a sit sign-in by an ordinary member mints a MEMBER session - " +
    "no ADMIN_TELEGRAM_IDS and no seeded membership row, so nothing on " +
    "sit hands adminness to somebody the group does not administer",
    body.isAdmin === false && db.inserts[0].is_admin === 0 &&
    db.inserts[0].admin_via === null);
}

/* The Telegram-admin mirror, wired at 0.9-M3-S8 (#414; the ruled design
   #385, rule 1: two ways in, one tier). These two checks asserted the
   opposite until that slice - the mirror was a later milestone's and
   the arm said so - and they are rewritten here rather than left,
   because an arm retires WITH the surface it describes. */
{
  const { db, body } = await signIn({
    bot: { ok: true, result: { status: "creator" } } });
  check("the group's own creator signs in as an ADMIN, and the row " +
    "records that the group role is why",
    body.isAdmin === true && db.inserts[0].is_admin === 1 &&
    db.inserts[0].admin_via === "telegram");
}

{
  const { db, body } = await signIn({
    bot: { ok: true, result: { status: "administrator" } } });
  check("a Telegram group administrator signs in as an ADMIN too - one " +
    "tier, whichever of the two group roles they hold",
    body.isAdmin === true && db.inserts[0].is_admin === 1 &&
    db.inserts[0].admin_via === "telegram");
}

/* The development sign-in door, retired (0.9-M2-S1, #352; the
   retirement server/worker.js's own header note 3 named). It is GONE
   rather than turned off, and these two arms are what says so.

   The second one is the whole point and the first one alone would not
   have caught the difference. While the route existed, its absence was
   a CONFIGURATION fact - DEV_LOGIN_SECRET unset - so an arm posting
   without the secret went green against a Worker that would have minted
   a session the moment somebody set one. This ORIGIN is loopback
   (http://localhost:8124), which is the other condition the old handler
   wanted, so a Worker still carrying the route answers 200 here. A 404
   with the secret set and the origin right is only available to a
   Worker that has no such route at all, and that is the property this
   slice is for. */
{
  const { value } = await withSeams(botAnswering(memberAnswer), () =>
    post(worker, sitEnv(makeDb()), "/auth/dev",
      { secret: "anything", subject: "someone" }));
  check("POST /auth/dev does not exist on a Worker carrying no " +
    "DEV_LOGIN_SECRET: 404, not 401 - a deployment does not advertise " +
    "a route it will not serve", value.status === 404);
}

{
  const db = makeDb();
  const env = sitEnv(db, { DEV_LOGIN_SECRET: "a-development-secret" });
  const { value } = await withSeams(botAnswering(memberAnswer), () =>
    post(worker, env, "/auth/dev",
      { secret: "a-development-secret", subject: "someone" }));
  check("POST /auth/dev is 404 WITH the secret set and the origin " +
    "loopback - the route is gone, not fail-closed, so setting the " +
    "binding cannot open it again", value.status === 404);
  check("and the retired door mints nothing - no session row is written",
    db.inserts.length === 0);
}

{
  const db = makeDb();
  const env = sitEnv(db, { DEV_LOGIN_SECRET: "a-development-secret" });
  const { value } = await withSeams(botAnswering(memberAnswer), () =>
    post(worker, env, "/auth/dev",
      { secret: "a-development-secret", subject: "someone", admin: true }));
  check("nor for an admin subject, which is the shape that used to hand " +
    "out the whole corpus", value.status === 404 && db.inserts.length === 0);
}

{
  const { status } = await signIn({
    env: { ALWAYS_ALLOW_TELEGRAM_IDS: undefined },
    bot: { ok: true, result: { status: "left" } } });
  check("with no always-allow ids configured, a departed account has no " +
    "way past the group check", status === 403);
}

/* ------------------------------------------------------------------ */
/* 8b. The roster: a verified sign-in refreshes the directory          */
/* (0.9-M1-S11, #340; DESIGN.md, "Accounts" - the roster syncs from    */
/* the group - and "Bot failure stance" - the roster cache is the      */
/* Worker's last-known-good). This is the wiring INTO sign-in; the      */
/* format's own properties are armed in tests/roster-directory.test.mjs */
/* and tests/store-crypto.test.mjs.                                     */

{
  const { db, status } = await signIn({});
  const row = db.directory.get(ACCOUNT_ID);
  check("a verified sign-in writes a directory row keyed by the account " +
    "id - the roster's last-known-good record of who is in the group",
    status === 200 && Boolean(row) && row.account_id === ACCOUNT_ID);

  const dstore = await store.openStore({ STORE_SECRET });
  const opened = row ? await dstore.openDirectory(
    new Uint8Array(Buffer.from(row.ciphertext, "base64")),
    { accountId: ACCOUNT_ID, recordId: DIRECTORY_SLOT }) : "";
  let parsed = {};
  try { parsed = JSON.parse(opened); } catch (error) { parsed = {}; }
  check("the directory record opens under the account id and the slot to " +
    "the signed-in handle and a member role, sealed with purpose 'dir'",
    parsed.handle === HANDLE && parsed.role === "member");

  check("the directory row's clear columns carry neither the numeric id " +
    "nor the handle - only the account-id HMAC and the timestamps",
    Boolean(row) && ![row.account_id, row.joined_at, row.last_seen_at]
      .some((value) => String(value).includes(NUMERIC_ID) ||
        String(value).includes(HANDLE)));
}

/* THE WRITE HALF OF THE SEALED NUMERIC ID (0.9-M3-S15, #420; the owner
   ruling of 2026-08-21). server/worker.js seals the numeric id into the
   directory record at exactly one place - this sign-in - and
   departedVerdict() is its only reader. Every arm in
   tests/departed-cleanup.test.mjs builds its directory rows by hand, so
   the read half is proven there and the write half is proven by nothing
   at all: deleting `telegramId: String(user.id)` left the entire gate
   green. These two checks are what witnesses it, and they are HERE
   because this is the only file that drives a real verified sign-in.
   The first opens the record the Worker actually sealed; the second
   hands that same record to the route that consumes it. */
{
  const { db, env, body, status } = await signIn({
    bot: { ok: true, result: { status: "creator" } } });
  const row = db.directory.get(ACCOUNT_ID);
  const dstore = await store.openStore({ STORE_SECRET });
  const opened = row ? await dstore.openDirectory(
    new Uint8Array(Buffer.from(row.ciphertext, "base64")),
    { accountId: ACCOUNT_ID, recordId: DIRECTORY_SLOT }) : "";
  let parsed = {};
  try { parsed = JSON.parse(opened); } catch (error) { parsed = {}; }
  check("the sealed record carries the NUMERIC TELEGRAM ID the sign-in " +
    "had in hand, beside the handle and the role - the write half the " +
    "departed check is the only reader of",
    status === 200 && parsed.telegramId === NUMERIC_ID);

  /* Staleness is a fact about time, so time is the only thing moved
     here: the ciphertext - the bytes under test - stays exactly what
     the Worker sealed a moment ago, and the pre-filter that picks
     candidates is what the older date reaches. */
  if (row) row.last_seen_at = "2020-01-01T00:00:00.000Z";
  const { value } = await withSeams(botAnswering(leftAnswer), () =>
    send(worker, env, "GET", "/admin-departed",
      { Origin: ORIGIN, Authorization: "Bearer " + body.session }));
  const departed = (value.body && value.body.departed) || [];
  check("and departedVerdict() reads THAT record: the row this sign-in " +
    "wrote is asked about by numeric id and judged departed, so the " +
    "write and its only reader are proven against each other end to end",
    value.status === 200 && departed.length === 1 &&
    departed[0].accountId === ACCOUNT_ID && departed[0].status === "left");
}

/* ------------------------------------------------------------------ */
/* 9. Nothing secret reaches a log line (mandate 7).                   */

const SECRETS = [
  ["the bot token", BOT_TOKEN],
  ["the chat id", CHAT_ID],
  ["the account secret", ACCOUNT_SECRET],
  ["the store secret", STORE_SECRET],
  ["the Telegram handle", HANDLE],
  ["the numeric id", NUMERIC_ID],
  ["api.telegram.org", "api.telegram.org"],
];

{
  const runs = [
    await signIn({}),
    await signIn({ bot: new Error(
      "connect ECONNREFUSED api.telegram.org/bot" + BOT_TOKEN) }),
    await signIn({ bot: leftAnswer }),
    await signIn({ payload: payloadFor({ auth_date: "yesterday" }) }),
    await signIn({ env: { TELEGRAM_GROUP_CHAT_ID: undefined } }),
  ];
  const logs = runs.map((r) => r.logs).join("\n");

  for (const [name, value] of SECRETS) {
    check("no log line carries " + name, !logs.includes(value));
  }
  check("no log line carries an issued session token or its hash",
    runs.every((r) => !r.body || !r.body.session ||
      (!logs.includes(r.body.session) &&
        !logs.includes(sha256hex(r.body.session)))));
  check("sign-in does log something - a probe over an empty string " +
    "proves nothing", logs.trim().length > 0);
  check("what it logs is an event name, and the account id where there " +
    "is one", logs.split("\n").filter(Boolean).every((line) => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        return false;
      }
      return typeof parsed.event === "string" &&
        Object.keys(parsed).every((key) =>
          key === "event" || key === "accountId");
    }));
}

{
  const { status, body } = await signIn({});
  check("the sign-in answer itself carries no bot token, chat id, " +
    "account secret or numeric id", status === 200 &&
    ![BOT_TOKEN, CHAT_ID, ACCOUNT_SECRET, NUMERIC_ID]
      .some((value) => JSON.stringify(body).includes(value)));
}

/* ------------------------------------------------------------------ */
/* 10. The schema half of the replay guard.                            */

check("server/schema.sql creates the auth_replay table the guard " +
  "writes to", /CREATE TABLE IF NOT EXISTS auth_replay/.test(schemaSrc));
check("payload_hash is the primary key, which is what makes the claim " +
  "atomic rather than a read followed by a write",
  /payload_hash\s+TEXT\s+PRIMARY KEY/.test(schemaSrc));
check("auth_replay carries an index on expires_at so ageing rows out " +
  "does not scan the table",
  /CREATE INDEX IF NOT EXISTS auth_replay_expiry/.test(schemaSrc));

/* ------------------------------------------------------------------ */
/* 11. Mutations. Each fixture is asserted to have CHANGED the source  */
/* before its behavior is read, because a replace that missed its      */
/* target produces a mutant identical to the original and a check that */
/* passes for the wrong reason.                                        */

async function mutant(label, from, to) {
  const src = workerSrc.replace(from, to);
  check("mutation fixture applied: " + label, src !== workerSrc);
  const { default: mutated } = await loadWorker(src);
  return mutated;
}

{
  const mutated = await mutant("the signature comparison removed",
    "if (!tokenMatches(payload.hash.toLowerCase(), expected)) return null;",
    "if (false) return null;");
  const good = payloadFor();
  const { status } = await signIn({ worker: mutated,
    payload: Object.assign({}, good, { id: "111111111" }) });
  check("mutation: without the hash comparison a tampered payload signs " +
    "in", status === 200);
}

{
  const mutated = await mutant("the freshness ceiling removed",
    "if (age > AUTH_FRESHNESS_SECONDS) return null;", "");
  const { status } = await signIn({ worker: mutated,
    payload: payloadFor({ auth_date: String(nowSeconds() - 4000) }) });
  check("mutation: without the ceiling an hour-old payload signs in",
    status === 200);
}

{
  const mutated = await mutant("the clock-skew floor removed",
    "if (age < -AUTH_SKEW_SECONDS) return null;", "");
  const { status } = await signIn({ worker: mutated,
    payload: payloadFor({ auth_date: String(nowSeconds() + 4000) }) });
  check("mutation: without the floor a payload dated an hour ahead " +
    "signs in", status === 200);
}

{
  const mutated = await mutant("the auth_date shape check loosened",
    "if (!AUTH_DATE.test(String(payload.auth_date))) return null;", "");
  const { status } = await signIn({ worker: mutated,
    payload: payloadFor({ auth_date: " " + nowSeconds() + " " }) });
  check("mutation: without the shape check a padded auth_date is " +
    "coerced and accepted", status === 200);
}

{
  const mutated = await mutant("the replay claim ignored",
    "if (claimed !== true) {", "if (false) {");
  const payload = payloadFor();
  const db = makeDb();
  await signIn({ worker: mutated, payload: payload, db: db });
  await signIn({ worker: mutated, payload: payload, db: db });
  check("mutation: without the claim check one payload mints two " +
    "sessions", db.inserts.length === 2);
}

{
  /* The branch is wrapped in answer() since 0.9-M3-S15 fix wave 2 -
     every verdict reached past the always_allow read carries whether
     that read answered - so the fixture edits the word inside the
     wrapper rather than the whole one-line return it used to be. */
  const mutated = await mutant("the unconfigured-chat-id verdict flipped",
    "  if (!env.TELEGRAM_GROUP_CHAT_ID) {\n" +
      '    return answer({ standing: "unknown", status: null });\n  }',
    "  if (!env.TELEGRAM_GROUP_CHAT_ID) {\n" +
      '    return answer({ standing: "member", status: null });\n  }');
  const { status } = await signIn({ worker: mutated,
    env: { TELEGRAM_GROUP_CHAT_ID: undefined } });
  check("mutation: a Worker that defaults open on a missing chat id " +
    "admits any valid Telegram identity", status === 200);
}

{
  const mutated = await mutant("the abort signal removed",
    "      signal: AbortSignal.timeout(GROUP_CHECK_TIMEOUT_MS),\n", "");
  const { bot } = await signIn({ worker: mutated });
  check("mutation: without the signal the group check is unbounded",
    bot.calls.length === 1 &&
    !(bot.calls[0].init && bot.calls[0].init.signal));
}

{
  const mutated = await mutant("the idle window narrowed back to admins",
    "  return Math.min(absolute, now + SESSION_IDLE_MINUTES * 60 * 1000);",
    "  if (!isAdmin) return absolute;\n" +
    "  return Math.min(absolute, now + SESSION_IDLE_MINUTES * 60 * 1000);");
  const { db } = await signIn({ worker: mutated });
  const row = db.inserts[0];
  check("mutation: with the member exemption back a member row carries " +
    "the seven-day cap as its deadline and no idle window",
    Date.parse(row.expires_at) - Date.parse(row.created_at) >
      24 * 60 * 60 * 1000);
}

{
  const mutated = await mutant("the revoke condition widened",
    'if (standing === "left") {', 'if (standing !== "member") {');
  const token = "canary-session-token-belonging-to-nobody";
  const db = makeDb({ sessions: [{
    token_hash: sha256hex(token), account_id: ACCOUNT_ID, is_admin: 0,
    is_dev: 0, created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
  }] });
  await signIn({ worker: mutated, db: db, bot: new Error("network down") });
  check("mutation: widening the revoke to every refusal turns one " +
    "Telegram outage into a sign-out", db.sessions.size === 0);
}

{
  const mutated = await mutant("the token stored in the clear",
    "    .bind(await sha256Hex(token), accountId,",
    "    .bind(token, accountId,");
  const { db, body } = await signIn({ worker: mutated });
  check("mutation: a row storing the token verbatim is caught",
    db.inserts[0].token_hash === body.session);
}

{
  const mutated = await mutant("the handle folded into a log line",
    'log("signin.ok", accountId);',
    'log("signin.ok " + user.username, accountId);');
  const { logs } = await signIn({ worker: mutated });
  check("mutation: a handle reaching a log line is caught by the canary " +
    "probe", logs.includes(HANDLE));
}

{
  /* The other direction of the skew-ceiling arm above: dropping the + 1
     back to the bare sum re-opens the replay it closes. Same scenario,
     against a worker whose hold is one second too short - the spent
     row is pruned by the intervening sign-in and the replay mints a
     second session. */
  const mutated = await mutant(
    "the replay hold dropped back to the un-padded sum",
    "const REPLAY_HOLD_SECONDS = " +
      "AUTH_FRESHNESS_SECONDS + AUTH_SKEW_SECONDS + 1;",
    "const REPLAY_HOLD_SECONDS = " +
      "AUTH_FRESHNESS_SECONDS + AUTH_SKEW_SECONDS;");
  const realNow = Date.now;
  const T0 = 1760000000000;
  const claimSec = T0 / 1000;
  const lastFreshMs = (claimSec + 60 + 300 + 1) * 1000 - 1;
  const db = makeDb();
  const spent = payloadFor({ auth_date: String(claimSec + 60) });
  try {
    Date.now = () => T0;
    await withSeams(botAnswering(memberAnswer), () =>
      post(mutated, sitEnv(db), "/auth/telegram", spent));
    Date.now = () => lastFreshMs;
    await withSeams(botAnswering(memberAnswer), () =>
      post(mutated, sitEnv(db), "/auth/telegram",
        payloadFor({ auth_date: String(claimSec + 360) })));
    const replay = await withSeams(botAnswering(memberAnswer), () =>
      post(mutated, sitEnv(db), "/auth/telegram", spent));
    check("mutation: with the un-padded hold the spent row is pruned a " +
      "second too early and the replay mints a second session",
      replay.value.status === 200 && db.inserts.length === 3);
  } finally {
    Date.now = realNow;
  }
}

{
  /* The roster refresh removed from sign-in: the object literal is left
     for Promise.resolve to swallow, so the call is gone but the code
     still parses. A verified sign-in then writes no directory row - and
     still succeeds, because the roster is best-effort and the session is
     already minted (0.9-M1-S11, #340; DESIGN.md, "Bot failure stance"). */
  const mutated = await mutant("the directory sync call removed from sign-in",
    "await syncDirectoryEntry(store, env, accountId, {",
    "await Promise.resolve({");
  const { db, status } = await signIn({ worker: mutated });
  check("mutation: without the sync call a verified sign-in writes no " +
    "directory row, yet still signs in - the write is best-effort",
    status === 200 && db.directory.size === 0);
}

/* ------------------------------------------------------------------ */

const EXPECTED = 116;
console.log(failures
  ? `\ntelegram-auth FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\ntelegram-auth ran ${performed} checks, expected ${EXPECTED}`
    : `\ntelegram-auth OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
