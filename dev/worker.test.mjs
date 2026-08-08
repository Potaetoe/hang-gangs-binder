/*
 * Round-trip checks for server/worker.js.
 *
 *     node dev/worker.test.mjs
 *
 * A Worker is a fetch handler over the same Request/Response/URL that
 * Node ships, so the real routing, validation and CORS logic runs here
 * against a stub D1 binding. No wrangler, no account, no network.
 *
 * The source is imported through a data: URL rather than by path
 * because server/worker.js uses ESM syntax and this repository has no
 * package.json - Node would otherwise read a bare .js as CommonJS and
 * choke on `export default`. Adding a package.json to a project whose
 * whole point is having no build step and no dependencies seemed a
 * worse trade than three lines here. This still tests the file's real
 * bytes, which is what matters.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { suite } from "./harness.mjs";

const SOURCE = fileURLToPath(new URL("../server/worker.js", import.meta.url));
const src = await readFile(SOURCE, "utf8");
const { default: worker } = await import(
  "data:text/javascript," + encodeURIComponent(src)
);

/*
 * A D1 binding that remembers what it was asked to store.
 *
 * It reads just enough of the SQL to tell the tables apart, because
 * they behave differently in the ways that matter: snapshots replaces
 * rather than appends and is read with first(); sessions is looked up
 * by one key, swept by expiry, and has one row's deadline moved forward
 * when it is used; submissions appends, counts per account, can lose a
 * row, and answers the two lookups a correction is checked against;
 * site_content and membership are keyed, so a second write of the same
 * row must replace it rather than sit beside it.
 *
 * A stub that ignored the statement entirely would let a publish that
 * appended a second row pass, and would let a delete that removed
 * everybody's rows pass too.
 */
let stored = [];
let sessions = [];
let snapshot = null;
let content = [];
let roster = [];
let nextId = 1;

/*
 * What was asked, as well as what was stored.
 *
 * `executed` is one entry per statement run, carrying the batch it
 * arrived in (0 for none); `batches` is one entry per batch() call,
 * holding those same entries. Together they are the only way to assert
 * the last-admin guard's MECHANISM rather than its outcome - see the
 * comment on batch() below for why the outcome is not enough.
 */
let executed = [];
let batches = [];

function reset() {
  stored = [];
  sessions = [];
  snapshot = null;
  content = [];
  roster = [];
  nextId = 1;
  executed = [];
  batches = [];
}

const DB = {
  prepare: (sql) => {
    const table = /site_content/i.test(sql) ? "site_content"
      : /membership/i.test(sql) ? "membership"
      : /snapshots/i.test(sql) ? "snapshots"
      : /sessions/i.test(sql) ? "sessions"
      : "submissions";
    const verb = /^\s*(\w+)/.exec(sql)[1].toUpperCase();
    const counting = /COUNT\(\*\)/i.test(sql);

    /*
     * The keyed tables are modelled from the statement rather than by
     * hand: the columns an INSERT names, the ones its ON CONFLICT
     * clause re-writes, and the columns a WHERE binds.
     *
     * Reading them off the SQL is what keeps three mutations visible. A
     * stub that mapped parameters by hand would agree with whatever
     * this file expected rather than with what the Worker sent. One
     * that replaced every column on a conflict would pass an upsert
     * that resets `added_at`, so "when this row was added" would
     * quietly become "when its label was last typed". One that ignored
     * the WHERE would pass a delete that took the row out of both
     * roles, or out of somebody else's.
     */
    const insertInto = /INSERT INTO \w+\s*\(([^)]*)\)/i.exec(sql);
    const insertColumns = insertInto
      ? insertInto[1].split(",").map((c) => c.trim()) : [];
    const conflict = /DO UPDATE SET\s+([\s\S]+?)\s*$/i.exec(sql);
    const conflictColumns = conflict
      ? conflict[1].split(",").map((c) => c.trim().split(/\s*=\s*/)[0]) : [];
    const where = /WHERE\s+([\s\S]+?)(?:\s+ORDER BY[\s\S]*)?$/i.exec(sql);

    /*
     * `COLLATE NOCASE` is read off the statement beside the column it
     * applies to, because a stub that compared every bound column with
     * === would pass a DELETE that dropped the collation - and dropping
     * it is exactly the bug: an account id stored in upper-case hex by
     * `wrangler d1 execute` becomes a row that no request can remove.
     * SQLite applies the explicit collation of either operand, and here
     * only the parameter carries one.
     */
    const bound = where
      ? Array.from(where[1].matchAll(/(\w+)\s*=\s*\?(\s+COLLATE\s+NOCASE)?/gi))
        .map((m) => ({ column: m[1], fold: Boolean(m[2]) })) : [];
    const folded = (value, fold) =>
      (fold && typeof value === "string" ? value.toLowerCase() : value);
    const matches = (row, a) => bound.length > 0 &&
      bound.every((b, index) =>
        folded(row[b.column], b.fold) === folded(a[index], b.fold));

    /*
     * The last-admin guard, which is a subquery inside the DELETE
     * rather than a count the Worker reads first - that is what makes
     * it one statement and therefore atomic. It has no `?` in it, so
     * the parameter reading above cannot see it, and a stub that did
     * not model it would delete the row anyway and pass an
     * implementation carrying no guard at all.
     */
    const guard =
      /AND \(SELECT COUNT\(\*\) FROM membership WHERE role = '(\w+)'\) > (\d+)/i
        .exec(sql);

    const upsert = (rows, key, a) => {
      const row = {};
      insertColumns.forEach((column, index) => { row[column] = a[index]; });
      const existing = rows.find((r) => key.every((k) => r[k] === row[k]));
      if (!existing) {
        rows.push(row);
        return;
      }
      for (const column of conflictColumns) existing[column] = row[column];
    };

    const exec = async (a) => {
      if (table === "snapshots") {
        if (verb === "DELETE") snapshot = null;
        else snapshot = { body: a[0], updated_at: a[1] };
      } else if (table === "sessions") {
        if (verb === "DELETE") {
          if (/token_hash/i.test(sql)) {
            // Revoking removes exactly the row presented. A stub that
            // swept here instead would let a revoke that signed the
            // whole group out pass every assertion in this file.
            sessions = sessions.filter((s) => s.token_hash !== a[0]);
          } else {
            const cutoff = Date.parse(a[0]);
            sessions = sessions.filter((s) => Date.parse(s.expires_at) > cutoff);
          }
        } else if (verb === "UPDATE") {
          // Sliding an idle window finds one row by token hash and moves
          // its deadline and nothing else. A stub that dropped the
          // UPDATE would let an implementation that never writes one
          // pass "using it is what slides the window back out".
          const row = sessions.find((s) => s.token_hash === a[1]);
          if (row) row.expires_at = a[0];
        } else {
          sessions.push({
            token_hash: a[0], account_id: a[1], is_admin: a[2],
            is_dev: a[3], created_at: a[4], expires_at: a[5],
          });
        }
      } else if (table === "site_content") {
        if (verb === "DELETE") content = content.filter((r) => !matches(r, a));
        else upsert(content, ["name"], a);
      } else if (table === "membership") {
        if (verb === "DELETE") {
          // The guard refuses by removing nothing, which is what a
          // conditional DELETE does in SQLite: the statement runs and
          // matches no row. Nothing here reports the refusal, and
          // nothing in D1 would either - the Worker learns it by
          // looking for the row afterwards, inside the same batch.
          const blocked = Boolean(guard) &&
            roster.filter((r) => r.role === guard[1]).length
              <= Number(guard[2]);
          if (!blocked) roster = roster.filter((r) => !matches(r, a));
        } else upsert(roster, ["account_id", "role"], a);
      } else if (verb === "DELETE") {
        stored = stored.filter((r) => r.id !== a[0]);
      } else {
        stored.push({
          id: nextId++, account_id: a[0], ciphertext: a[1], received_at: a[2],
          // A row with no pointer holds null rather than leaving the key
          // off, so a stub row answers `"supersedes" in row` the way a
          // D1 row does - the export assertion reads exactly that.
          supersedes: a[3] === undefined ? null : a[3],
        });
      }
      return {};
    };

    // Which rows a correction hides. `stored` rather than the account's
    // own rows because that is what the Worker's predicate says, and a
    // stub that quietly narrowed it would hide the difference.
    const namedByAnother = (row) =>
      stored.some((r) => r.supersedes === row.id);

    const read = (a) => {
      if (table === "snapshots") return snapshot;
      if (table === "sessions") {
        return sessions.find((s) => s.token_hash === a[0]) || null;
      }
      // Answered from the bound WHERE rather than left null, so a
      // future lookup against either keyed table is visible here. A
      // stub that answered "no such row" whatever was asked would let
      // a Worker that reads the membership table pass the assertions
      // below that say it does not read it yet.
      if (table === "site_content") {
        return content.find((r) => matches(r, a)) || null;
      }
      if (table === "membership") {
        return roster.find((r) => matches(r, a)) || null;
      }
      if (counting) {
        const mine = stored.filter((r) => r.account_id === a[0]);
        const live = mine.filter((r) => !namedByAnother(r));
        return {
          total: mine.length,
          superseded: mine.length - live.length,
          last_at: live.length
            ? live.map((r) => r.received_at).sort().pop() : null,
        };
      }
      // The two lookups POST /submit makes before it stores anything,
      // modelled by their predicates rather than by a fixed answer. A
      // stub that always found a row would pass an implementation that
      // never checked ownership; one that never found a row would pass
      // an implementation whose checks refuse everything.
      //
      // The owner is matched only when the statement bound one, so a
      // lookup that drops `AND account_id = ?` finds somebody else's row
      // here exactly as it would in D1. Reading the parameter list is
      // what keeps that mutation visible rather than turning it into a
      // statement this stub simply fails to recognise.
      if (/WHERE id = \?/i.test(sql)) {
        return stored.find((r) => r.id === a[0] &&
          (a.length < 2 || r.account_id === a[1])) || null;
      }
      if (/WHERE supersedes = \?/i.test(sql)) {
        return stored.find((r) => r.supersedes === a[0]) || null;
      }
      return null;
    };

    // The column list the statement actually asked for. Handing back the
    // whole stored row whatever was selected would pass an export that
    // dropped `supersedes`, which is the one field the keyholder's
    // browser needs in order to tell a correction from a repeat.
    const selected = /^\s*SELECT\s+([\s\S]+?)\s+FROM/i.exec(sql);
    const columns = selected
      ? selected[1].split(",").map((c) => c.trim()) : null;
    const project = (row) => {
      if (!columns) return row;
      const out = {};
      for (const column of columns) {
        if (column in row) out[column] = row[column];
      }
      return out;
    };

    const rowsOf = () => (table === "site_content" ? content
      : table === "membership" ? roster : stored);

    /*
     * Every execution is recorded before it runs, so a check can ask
     * which statements a request sent and how they travelled. That
     * record is the whole of the last-admin guard's mechanism test: two
     * implementations with identical effects on `roster` differ only in
     * whether the count and the delete arrive together.
     */
    const note = (batch) => {
      const record = { sql: sql, table: table, batch: batch || 0 };
      executed.push(record);
      if (batch) batches[batch - 1].push(record);
    };

    return {
      bind: (...a) => ({
        run: () => { note(0); return exec(a); },
        first: async () => { note(0); return read(a); },
        /*
         * D1 answers .all() on a write by running it and handing back
         * an empty result set, which is what lets one shape carry every
         * statement in a batch. Both halves are load-bearing here: a
         * stub that answered reads only would turn the batched delete
         * into a no-op and pass an implementation that removes nothing,
         * and one that ran the write but answered the read from the
         * whole table would pass an implementation whose guard never
         * fires.
         *
         * The `batch` parameter belongs to this stub and not to D1,
         * which hands .all() nothing and is called with nothing. So a
         * statement run outside a batch records 0 without a
         * module-level flag that two overlapping requests would share.
         */
        all: async (batch) => {
          note(batch);
          if (verb !== "SELECT") {
            await exec(a);
            return { results: [] };
          }
          return { results: rowsOf().filter((r) => matches(r, a)).map(project) };
        },
      }),
      // Statements with no parameters run straight off prepare().
      run: () => { note(0); return exec([]); },
      first: async () => { note(0); return read([]); },
      all: async () => {
        note(0);
        return { results: rowsOf().map(project) };
      },
    };
  },

  /*
   * D1 runs a batch as one transaction, statement by statement, and
   * answers with one result per statement in the shape .all() gives.
   *
   * THE TRANSACTION IS NOT MODELLED, and reading this loop as though it
   * were is how the mechanism went unasserted. Statements run here in
   * isolation, exactly as they would if the Worker had sent them one at
   * a time - so an implementation that counts the admins in one round
   * trip, decides in JavaScript, and then sends an unguarded DELETE
   * leaves `roster` in the same state as the batched one, and every
   * outcome assertion in this file agrees with both. That is the race
   * the guard exists to close, so it cannot be the thing no check can
   * see.
   *
   * What IS modelled is the invocation: which statements arrived in
   * which batch() call. The checks read `batches` and `executed` and
   * assert the mechanism directly - one batch call, both statements
   * inside it, and nothing counting admins outside it.
   */
  batch: async (statements) => {
    batches.push([]);
    const id = batches.length;
    const out = [];
    for (const statement of statements) out.push(await statement.all(id));
    return out;
  },
};

/*
 * A bot token, and payloads signed with it the way Telegram signs them.
 *
 * Signing here rather than committing a fixture is deliberate: a fixture
 * would carry a fixed auth_date and the freshness check would start
 * rejecting it five minutes after it was written. What IS committed is
 * the account-id fixture below, where a fixed answer is the whole point.
 */
const BOT_TOKEN = "8123456789:AAtest-bot-token-value-for-the-suite";

const hex = (buffer) => Array.from(new Uint8Array(buffer))
  .map((b) => b.toString(16).padStart(2, "0")).join("");

async function signed(user = {}, secondsAgo = 0) {
  const payload = {
    auth_date: Math.floor(Date.now() / 1000) - secondsAgo,
    first_name: "Test",
    id: 4242,
    username: "somehandle",
    ...user,
  };
  // An absent field is absent from the signature too, which is how
  // Telegram treats a user with no @username.
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }
  const fields = Object.keys(payload).sort()
    .map((k) => k + "=" + payload[k]).join("\n");
  const secret = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(BOT_TOKEN));
  const key = await crypto.subtle.importKey(
    "raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  payload.hash = hex(await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(fields)));
  return payload;
}

const env = {
  EXPORT_TOKEN: "sekrit-token-value",
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  ACCOUNT_SECRET: "account-secret-for-the-suite",
  ADMIN_TELEGRAM_IDS: "99",
  DB: DB,
};

const SITE = "https://potaetoe.github.io";
const LOCAL = "http://localhost:8124";
const LOCAL_IP = "http://127.0.0.1:8124";
const TYPE = { "Content-Type": "application/json" };
const good = { Origin: SITE, ...TYPE };
const evil = { Origin: "https://evil.example", ...TYPE };

const call = (method, path, opts = {}, e = env) =>
  worker.fetch(new Request("https://w.dev" + path, { method, ...opts }), e);

const bearer = (t, headers = good) =>
  ({ ...headers, Authorization: "Bearer " + t });

/*
 * The count is asserted rather than only printed. This file is the
 * gating matrix - the one place where a check that stops running reads
 * as "nothing refused anybody" rather than as a missing row, and where
 * POST /auth/dev failing open is itself the compromise. See
 * dev/harness.mjs.
 */
const { check, report } = suite("worker.js", 277);

async function statusOf(label, promise, want) {
  const res = await promise;
  check(label, res.status === want, `${res.status} (want ${want})`);
  return res;
}

const signIn = async (user, e = env, headers = good) =>
  call("POST", "/auth/telegram",
    { headers, body: JSON.stringify(await signed(user)) }, e);

/* ------------------------------------------------------------------ */
/* Signing in.                                                         */

reset();

const first = await signIn({});
const firstBody = await first.clone().json();
check("a correctly signed payload issues a session",
  first.status === 200 && typeof firstBody.session === "string" &&
  firstBody.username === "somehandle" && firstBody.isAdmin === false &&
  firstBody.isDev === false);

check("sign-in reports the caller's own numeric id",
  firstBody.telegramId === "4242",
  "so ADMIN_TELEGRAM_IDS is set from fact rather than guessed");

/*
 * Tampering, both halves. A verifier that accepts an altered payload has
 * failed at the only thing it does, and it fails silently - every status
 * in this file would still be right.
 */
const claimingSomeoneElse = await signed({});
claimingSomeoneElse.id = 5;
await statusOf("a payload signed for someone else is refused",
  call("POST", "/auth/telegram",
    { headers: good, body: JSON.stringify(claimingSomeoneElse) }), 401);

const badHash = await signed({});
badHash.hash = badHash.hash.replace(/^./, (c) => (c === "a" ? "b" : "a"));
await statusOf("a payload with a changed hash is refused",
  call("POST", "/auth/telegram",
    { headers: good, body: JSON.stringify(badHash) }), 401);

/*
 * Freshness. Without it a captured payload never expires, because
 * nothing else in one does. This is the check that is easiest to leave
 * out, since nothing looks wrong when it is missing.
 */
await statusOf("a payload older than five minutes is refused",
  call("POST", "/auth/telegram",
    { headers: good, body: JSON.stringify(await signed({}, 600)) }), 401);

await statusOf("an unsigned body is refused",
  call("POST", "/auth/telegram",
    { headers: good, body: JSON.stringify({ id: 1 }) }), 401);

/* This binder identifies people by @username, so it says which thing to
 * go and fix rather than storing a blank where a handle should be. */
await statusOf("an account with no Telegram username is turned away",
  call("POST", "/auth/telegram",
    { headers: good, body: JSON.stringify(await signed({ username: undefined })) }),
  403);

const adminBody = await (await signIn({ id: 99 })).clone().json();
check("an id in ADMIN_TELEGRAM_IDS gets an admin session",
  adminBody.isAdmin === true);

const MEMBER = firstBody.session;
const ADMIN = adminBody.session;

/* ------------------------------------------------------------------ */
/* The account id, as a committed fixture.                             */

/*
 * The same argument as the ciphertext fixture in dev/crypto.test.mjs,
 * and the same rule: IF THIS FAILS, DO NOT REGENERATE IT. A changed
 * account id means every stored row has detached from the person who
 * wrote it, with nothing anywhere reporting it. The fix is to find what
 * changed, not to bless it.
 */
const FIXTURE_4242 =
  "a9246ad96523241df2d1823e6d8237ca26fbd848fdb74d12db531abee875a20c";
const FIXTURE_DEV_ALICE =
  "20f2d196dc50d92d29b687e4e6b0ab4f30d622e954715e6f97be07a76e3c8ee1";

await call("POST", "/submit",
  { headers: bearer(MEMBER), body: JSON.stringify({ ciphertext: "QUJDRA==" }) });
check("the account id derivation is unchanged",
  stored.length === 1 && stored[0].account_id === FIXTURE_4242,
  stored.length ? stored[0].account_id.slice(0, 20) + "â€¦" : "no row");

/* ------------------------------------------------------------------ */
/* POST /auth/dev - the deliberate hole, and which way it fails.       */

/*
 * These are the most important assertions in this file. Every other test
 * here protects the data; these protect the boundary that protects the
 * data, and a silent pass is itself the compromise. Each of the three
 * refusals is a separate condition failing closed on its own.
 */
await statusOf("dev login is 404 when DEV_LOGIN_SECRET is unset",
  call("POST", "/auth/dev", { headers: { Origin: LOCAL, ...TYPE },
    body: JSON.stringify({ secret: "anything", subject: "alice" }) }), 404);

const devEnv = {
  ...env,
  DEV_LOGIN_SECRET: "dev-secret",
  ALLOWED_ORIGINS: `${SITE},${LOCAL}`,
};

await statusOf("dev login is 404 from a non-loopback origin",
  call("POST", "/auth/dev", { headers: good,
    body: JSON.stringify({ secret: "dev-secret", subject: "alice" }) }, devEnv),
  404);

await statusOf("dev login is 404 with the wrong secret",
  call("POST", "/auth/dev", { headers: { Origin: LOCAL, ...TYPE },
    body: JSON.stringify({ secret: "wrong", subject: "alice" }) }, devEnv), 404);

const dev = await call("POST", "/auth/dev",
  { headers: { Origin: LOCAL, ...TYPE },
    body: JSON.stringify({ secret: "dev-secret", subject: "alice" }) }, devEnv);
const devBody = await dev.clone().json();
check("dev login works when all four conditions hold",
  dev.status === 200 && devBody.isDev === true &&
  typeof devBody.session === "string");

const devByIp = await call("POST", "/auth/dev",
  { headers: { Origin: LOCAL_IP, ...TYPE },
    body: JSON.stringify({ secret: "dev-secret", subject: "bob" }) },
  { ...devEnv, ALLOWED_ORIGINS: `${LOCAL},${LOCAL_IP}` });
const devByIpBody = await devByIp.clone().json();
check("the numeric loopback origin can use the dev login too",
  devByIp.status === 200 && devByIpBody.isDev === true &&
  typeof devByIpBody.session === "string");

await call("POST", "/submit",
  { headers: bearer(devBody.session, { Origin: LOCAL, ...TYPE }),
    body: JSON.stringify({ ciphertext: "QUJDRA==" }) }, devEnv);
check("a dev subject is namespaced away from every real account id",
  stored.length === 2 && stored[1].account_id === FIXTURE_DEV_ALICE,
  stored.length > 1 ? stored[1].account_id.slice(0, 20) + "â€¦" : "no row");

/* ------------------------------------------------------------------ */
/* The gating matrix.                                                  */

/*
 * Every route against every kind of caller. Cheap to write as a table,
 * and it is the thing most likely to be quietly wrong after a refactor -
 * a route that forgets to ask who is calling is a route with no gate,
 * and it behaves perfectly right up until somebody notices.
 */
const who = (t) => t === null ? "nobody" : t === MEMBER ? "a member"
  : t === ADMIN ? "an admin" : "the export token";

const matrix = [
  ["POST", "/submit", null, 401],
  ["POST", "/submit", MEMBER, 200],
  ["POST", "/submit", "sekrit-token-value", 401],
  ["GET", "/me", null, 401],
  ["GET", "/me", MEMBER, 200],
  ["GET", "/export", null, 401],
  ["GET", "/export", MEMBER, 401],
  ["GET", "/export", ADMIN, 200],
  ["GET", "/export", "sekrit-token-value", 200],
  ["GET", "/snapshot", null, 401],
  ["GET", "/snapshot", MEMBER, 404],
  ["POST", "/snapshot", MEMBER, 401],
  ["POST", "/snapshot", ADMIN, 200],
  ["DELETE", "/snapshot", MEMBER, 401],
  ["DELETE", "/snapshot", ADMIN, 200],
  ["DELETE", "/submission/1", null, 401],
  ["DELETE", "/submission/1", MEMBER, 401],
  // Only the non-destructive halves of DELETE /session belong in the
  // table; a revoke that succeeded here would kill MEMBER or ADMIN for
  // every row below it. The rest of that route is its own section.
  ["DELETE", "/session", null, 401],
  ["DELETE", "/session", "sekrit-token-value", 401],
  /*
   * Site content is the one thing here that answers a caller with no
   * credential at all, and both halves of that are in this table. The
   * read is open because every page's shipped HTML is the fallback for
   * these values and apps/web is copied verbatim to a public site, so
   * the bytes this route enhances are world-readable already; the write
   * is an admin session because an admin is who edits a site.
   */
  ["GET", "/content", null, 200],
  ["GET", "/content", MEMBER, 200],
  ["POST", "/content", null, 401],
  ["POST", "/content", MEMBER, 401],
  ["POST", "/content", ADMIN, 200],
  ["POST", "/content", "sekrit-token-value", 200],
  ["DELETE", "/content/matrix", null, 401],
  ["DELETE", "/content/matrix", MEMBER, 401],
  ["DELETE", "/content/matrix", ADMIN, 200],
  /*
   * Membership is admin in both directions and in every one. The list
   * of who administers is the list DESIGN.md's whole account design
   * exists to keep private, so a member reading it is the failure, and
   * so is a member learning anything by being refused - which the
   * byte-for-byte section below is what actually pins.
   */
  ["GET", "/membership", null, 401],
  ["GET", "/membership", MEMBER, 401],
  ["GET", "/membership", ADMIN, 200],
  ["GET", "/membership", "sekrit-token-value", 200],
  ["POST", "/membership", null, 401],
  ["POST", "/membership", MEMBER, 401],
  ["POST", "/membership", ADMIN, 200],
  ["DELETE", "/membership/admin/" + FIXTURE_4242, null, 401],
  ["DELETE", "/membership/admin/" + FIXTURE_4242, MEMBER, 401],
  ["DELETE", "/membership/admin/" + FIXTURE_4242, ADMIN, 200],
  ["GET", "/whatever", ADMIN, 404],
];

// One body per POST route rather than one shape for all of them. A
// single "whatever this route wants" object would let a route that
// stopped reading its body pass every row above.
const MATRIX_BODY = {
  "/submit": { ciphertext: "QUJDRA==" },
  "/content": { name: "matrix", value: "A line of copy." },
  "/membership": { telegramId: "31337", role: "admin", label: "Sam" },
};

for (const [method, path, token, want] of matrix) {
  const headers = token === null ? good : bearer(token);
  const body = method === "POST"
    ? JSON.stringify(MATRIX_BODY[path] || { snapshot: 1 })
    : undefined;
  await statusOf(`${method} ${path} as ${who(token)}`,
    call(method, path, { headers, body }), want);
}

/* The break-glass token is admin, but it is nobody - so it cannot
 * submit, because submitting needs an account to submit to. */
check("the break-glass token has admin rights but no account",
  stored.filter((r) => r.account_id === FIXTURE_4242).length === 2,
  "only the member's own two rows");

await statusOf("a foreign origin is refused even with a valid session",
  call("POST", "/submit", { headers: bearer(MEMBER, evil),
    body: JSON.stringify({ ciphertext: "QUJDRA==" }) }), 403);

/* ------------------------------------------------------------------ */
/* GET /me, and removing one row.                                      */

const me = await (await call("GET", "/me", { headers: bearer(MEMBER) })).json();
check("/me counts this account's rows and nobody else's",
  me.entries === 2 && me.isAdmin === false && me.isDev === false,
  `entries=${me.entries}`);

/* #56 keys the device-local prefill on this value, so it has to be the
 * account's real id rather than anything derived on the page. Asserted
 * against the committed fixture rather than against itself: comparing it
 * to `stored[0].account_id` would pass even if both were wrong together,
 * which is the shape of check that #34 paid for. */
check("/me returns the account's own id, matching the committed fixture",
  me.accountId === FIXTURE_4242,
  me.accountId ? me.accountId.slice(0, 20) + "â€¦" : "absent");
check("and it is the id the rows were actually written under",
  me.accountId === stored[0].account_id);

/* The break-glass caller is admin and is nobody, so it has no account id
 * to report. Asserted because handleMe's comment claims it is reported
 * rather than special-cased, and a claim in a comment that nothing checks
 * is how the comment and the code drift apart. It also matters to the
 * page: submit.js must not restore a device-local prefill when there is
 * no account to attribute it to. */
const glass = await (await call("GET", "/me",
  { headers: bearer("sekrit-token-value") })).json();
check("/me reports no account id for the break-glass token",
  glass.ok === true && glass.accountId === null && glass.isAdmin === true,
  `accountId=${JSON.stringify(glass.accountId)}`);

const before = stored.length;
await call("DELETE", "/submission/" + stored[0].id, { headers: bearer(ADMIN) });
check("an admin can remove one submission",
  stored.length === before - 1, `${before} -> ${stored.length}`);

await statusOf("removing a row that is not there still succeeds",
  call("DELETE", "/submission/99999", { headers: bearer(ADMIN) }), 200);

await statusOf("a non-numeric submission id is not a route",
  call("DELETE", "/submission/abc", { headers: bearer(ADMIN) }), 404);

/* ------------------------------------------------------------------ */
/* Sessions expire, and an expired one is refused rather than swept.   */

sessions.find((s) => s.account_id === FIXTURE_4242).expires_at =
  new Date(Date.now() - 1000).toISOString();
await statusOf("an expired session is refused",
  call("GET", "/me", { headers: bearer(MEMBER) }), 401);
check("looking one up is what clears the expired rows out",
  !sessions.some((s) => Date.parse(s.expires_at) <= Date.now()));

/* ------------------------------------------------------------------ */
/* Group membership.                                                   */

/*
 * The widget proves somebody has a Telegram account, not that they are
 * one of yours. With a chat id configured the Worker asks Telegram, and
 * the allowlist is what gets you back in if the bot is ever removed from
 * the group - the failure that would otherwise lock out everybody at
 * once, including whoever could fix it.
 */
const realFetch = globalThis.fetch;
let membership = "member";
globalThis.fetch = async () => new Response(JSON.stringify(
  membership === null
    ? { ok: false, description: "user not found" }
    : { ok: true, result: { status: membership } }), { headers: TYPE });

const gated = { ...env, TELEGRAM_GROUP_CHAT_ID: "-1001234567890" };

await statusOf("a member of the group may sign in", signIn({}, gated), 200);

membership = "left";
await statusOf("somebody who has left the group may not",
  signIn({}, gated), 403);

membership = null;
await statusOf("a stranger to the group may not", signIn({}, gated), 403);

await statusOf("the allowlist overrides the group check",
  signIn({}, { ...gated, ALWAYS_ALLOW_TELEGRAM_IDS: "4242" }), 200);

globalThis.fetch = async () => { throw new Error("Telegram unreachable"); };
await statusOf("an unreachable Telegram refuses rather than admits",
  signIn({}, gated), 403);
globalThis.fetch = realFetch;

/* ------------------------------------------------------------------ */
/* The snapshot. Unchanged except for who may read it.                 */

reset();
const A = (await (await signIn({ id: 99 })).clone().json()).session;

const publishedBody = JSON.stringify({ snapshot: 1, counts: { entries: 2 } });
await call("POST", "/snapshot", { headers: bearer(A), body: publishedBody });
check("the snapshot is stored exactly as sent",
  snapshot !== null && snapshot.body === publishedBody);

const readBack = await (await call("GET", "/snapshot",
  { headers: bearer(A) })).json();
check("the published snapshot reads back inside its envelope",
  readBack.ok === true && typeof readBack.published_at === "string" &&
  readBack.snapshot.counts.entries === 2);

await call("POST", "/snapshot", { headers: bearer(A),
  body: JSON.stringify({ snapshot: 1, counts: { entries: 9 } }) });
check("publishing replaces rather than appends",
  JSON.parse(snapshot.body).counts.entries === 9);

await statusOf("a snapshot that is not JSON is refused",
  call("POST", "/snapshot", { headers: bearer(A), body: "{{{" }), 400);
await statusOf("an empty snapshot is refused",
  call("POST", "/snapshot", { headers: bearer(A), body: "" }), 400);
await statusOf("an oversize snapshot is refused",
  call("POST", "/snapshot", { headers: bearer(A),
    body: JSON.stringify({ pad: "A".repeat(300000) }) }), 413);

check("a refused publish leaves the previous snapshot alone",
  snapshot !== null && JSON.parse(snapshot.body).counts.entries === 9);

await call("DELETE", "/snapshot", { headers: bearer(A) });
check("an authorized DELETE takes the snapshot down", snapshot === null);
await statusOf("reading after a delete is 404 again",
  call("GET", "/snapshot", { headers: bearer(A) }), 404);

/* Deleting nothing is a success. Someone pressing Unpublish twice has
 * got what they wanted, and an error would read as "it did not work"
 * and invite a retry against a system that already did the thing. */
await statusOf("unpublishing twice is not an error",
  call("DELETE", "/snapshot", { headers: bearer(A) }), 200);

/* ------------------------------------------------------------------ */
/* Submission validation, and ALLOWED_ORIGINS.                         */

const M = (await (await signIn({})).clone().json()).session;
const post = (body) => call("POST", "/submit", { headers: bearer(M), body });

await statusOf("a submission that is not base64 is refused",
  post(JSON.stringify({ ciphertext: "not base64!!" })), 400);
await statusOf("a submission with no ciphertext is refused",
  post(JSON.stringify({})), 400);
await statusOf("a malformed body is refused", post("{{{"), 400);
await statusOf("an oversize submission is refused",
  post(JSON.stringify({ ciphertext: "A".repeat(17000) })), 413);

const rowsBefore = stored.length;
await statusOf("a valid submission is accepted",
  post(JSON.stringify({ ciphertext: "QUJDRA==" })), 200);
check("only the valid submission reached the database",
  stored.length === rowsBefore + 1, `${rowsBefore} -> ${stored.length}`);

/*
 * ALLOWED_ORIGINS overrides the built-in list so a new owner points the
 * endpoint at their own site from the dashboard rather than editing and
 * re-pasting the Worker. Both directions matter: it must let their
 * origin in AND shut the old one out, or a handoff quietly leaves the
 * previous owner's site still writing to the new owner's database.
 */
const NEW_OWNER = "https://someone-else.example";
const inherited = { ...env, ALLOWED_ORIGINS: ` ${NEW_OWNER} , ${LOCAL} ` };
await statusOf("an override admits the new origin",
  signIn({}, inherited, { Origin: NEW_OWNER, ...TYPE }), 200);
await statusOf("an override shuts out the old origin",
  signIn({}, inherited), 403);

/*
 * A Worker with no EXPORT_TOKEN must refuse everybody rather than treat
 * an empty string as a match - the same shape as DEV_LOGIN_SECRET above,
 * and the reason both are written as "must be set" rather than "must not
 * differ".
 */
await statusOf("a Worker with no export token refuses the break-glass path",
  call("GET", "/export", { headers: bearer("") }, { ...env, EXPORT_TOKEN: "" }),
  401);

/* ------------------------------------------------------------------ */
/* Ending a session on purpose - DELETE /session.                      */

/*
 * Signing out has to end the session rather than forget it. Without this
 * route the row survives to its natural expiry - seven days for a member
 * - so a token captured before sign-out stays a working credential for
 * all of it, which is the one thing sign-out is pressed to stop.
 *
 * The route is authenticated by the token it destroys, so it needs no
 * new authority, and it refuses anything that is not a live session row:
 * an unknown token gets 401 rather than a courtesy 200. That refusal is
 * load-bearing in two directions. It keeps the route from being an
 * unauthenticated DELETE against `sessions` keyed on a string the caller
 * chose, and it stops the route ever answering "you are signed out" to
 * somebody who is not - the same failure this route exists to fix, moved
 * one level up. Nothing is trapped by the strictness: the page clears
 * its local copy whatever this answers.
 */
reset();

const REVOKE_ME = (await (await signIn({})).clone().json()).session;
const BYSTANDER = (await (await signIn({ id: 7777 })).clone().json()).session;
check("two sessions exist before either is revoked",
  sessions.length === 2, `${sessions.length} row(s)`);

await statusOf("a member can end their own session",
  call("DELETE", "/session", { headers: bearer(REVOKE_ME) }), 200);
check("the row is deleted rather than left to expire",
  sessions.length === 1 &&
  !sessions.some((s) => s.account_id === FIXTURE_4242),
  `${sessions.length} row(s) left`);

await statusOf("the revoked token is refused on the very next request",
  call("GET", "/me", { headers: bearer(REVOKE_ME) }), 401);
await statusOf("and on a route that writes, not only on one that reads",
  call("POST", "/submit", { headers: bearer(REVOKE_ME),
    body: JSON.stringify({ ciphertext: "QUJDRA==" }) }), 401);

/* Revoking must not be a way to sign anybody else out, and must not be a
 * way to find out that anybody else is signed in. */
await statusOf("somebody else's session is untouched",
  call("GET", "/me", { headers: bearer(BYSTANDER) }), 200);

await statusOf("revoking an already-revoked token is refused, not blessed",
  call("DELETE", "/session", { headers: bearer(REVOKE_ME) }), 401);
await statusOf("a token that was never a session revokes nothing",
  call("DELETE", "/session", { headers: bearer("not-a-session-token") }), 401);
check("and neither refusal removed a row",
  sessions.length === 1, `${sessions.length} row(s) left`);

const ADMIN_REVOKE = (await (await signIn({ id: 99 })).clone().json()).session;
await statusOf("an admin can end their own session too",
  call("DELETE", "/session", { headers: bearer(ADMIN_REVOKE) }), 200);
await statusOf("and the admin token is dead on the next request",
  call("GET", "/export", { headers: bearer(ADMIN_REVOKE) }), 401);

/* An expired session is not a credential, so it cannot revoke either -
 * and the opportunistic sweep is what actually removes its row. */
const STALE_TOKEN = (await (await signIn({ id: 8888 })).clone().json()).session;
sessions[sessions.length - 1].expires_at =
  new Date(Date.now() - 1000).toISOString();
await statusOf("an expired session cannot revoke",
  call("DELETE", "/session", { headers: bearer(STALE_TOKEN) }), 401);

/* ------------------------------------------------------------------ */
/* An admin session is admin only while the id is still an admin.      */

/*
 * The admin flag is minted at sign-in. On its own that means taking an
 * id out of ADMIN_TELEGRAM_IDS does nothing until the session expires -
 * up to two hours of holding the whole corpus's ciphertext, with nothing
 * able to force it sooner. The flag on the row is now a necessary
 * condition rather than the whole answer, and the list is re-read on
 * every request that asks whether the caller is an admin.
 *
 * The re-read compares account ids, never Telegram ids: the Worker HMACs
 * each configured id under ACCOUNT_SECRET and looks for the value the
 * row already carries. Nothing new is stored, nothing is written down,
 * and the comparison is made in memory out of two things the Worker
 * already held.
 */
reset();

const staleAdmin = await (await signIn({ id: 99 })).clone().json();
check("the session was minted as an admin", staleAdmin.isAdmin === true);
const STALE_ADMIN = staleAdmin.session;

await statusOf("it exports while 99 is still in ADMIN_TELEGRAM_IDS",
  call("GET", "/export", { headers: bearer(STALE_ADMIN) }), 200);

const demoted = { ...env, ADMIN_TELEGRAM_IDS: "12345" };
await statusOf("the same session cannot export once 99 is off the list",
  call("GET", "/export", { headers: bearer(STALE_ADMIN) }, demoted), 401);
await statusOf("nor publish a snapshot",
  call("POST", "/snapshot", { headers: bearer(STALE_ADMIN),
    body: JSON.stringify({ snapshot: 1 }) }, demoted), 401);
await statusOf("nor take one down",
  call("DELETE", "/snapshot", { headers: bearer(STALE_ADMIN) }, demoted), 401);
await statusOf("nor delete somebody's row",
  call("DELETE", "/submission/1", { headers: bearer(STALE_ADMIN) }, demoted),
  401);
await statusOf("an empty admin list leaves nobody an admin",
  call("GET", "/export", { headers: bearer(STALE_ADMIN) },
    { ...env, ADMIN_TELEGRAM_IDS: "" }), 401);

/*
 * The re-read may take adminness away and must never hand it out. Adding
 * an id to ADMIN_TELEGRAM_IDS still needs a fresh sign-in, which is what
 * OPERATIONS.md tells a keyholder to do - and the reason it is worth
 * asserting is that the cheapest way to write the re-read is as the only
 * condition, which would silently promote every live member session
 * belonging to a newly-listed id. sessionFor()'s comment claims the
 * stored flag stays necessary; this is what stops that being a claim
 * nothing checks.
 */
const MEMBER_SESSION = (await (await signIn({})).clone().json()).session;
await statusOf("listing an id does not promote a session already issued",
  call("GET", "/export", { headers: bearer(MEMBER_SESSION) },
    { ...env, ADMIN_TELEGRAM_IDS: "4242" }), 401);

/* Demotion is not revocation. The person is still a member of the group,
 * and the session that stops being an admin session keeps working as the
 * member session it also is - so /me must say so rather than refuse. */
const demotedMe = await call("GET", "/me",
  { headers: bearer(STALE_ADMIN) }, demoted);
const demotedMeBody = await demotedMe.clone().json();
check("the demoted session still works as an ordinary member session",
  demotedMe.status === 200 && demotedMeBody.isAdmin === false,
  `${demotedMe.status}, isAdmin=${demotedMeBody.isAdmin}`);

/*
 * The development session is exempt, on purpose rather than by
 * oversight. A dev admin's authority never came from ADMIN_TELEGRAM_IDS
 * - its account id is namespaced under "dev:" and could not be in that
 * list - it came from DEV_LOGIN_SECRET, so that is what gets re-read for
 * it. Unsetting the secret drops the session exactly the way delisting
 * an id does, which is the same "must be SET" shape the route itself
 * uses. Untested, this exemption would be indistinguishable from having
 * forgotten dev sessions existed.
 */
const devAdmin = await (await call("POST", "/auth/dev",
  { headers: { Origin: LOCAL, ...TYPE },
    body: JSON.stringify(
      { secret: "dev-secret", subject: "root", admin: true }) },
  devEnv)).clone().json();
check("a dev session can be minted as an admin", devAdmin.isAdmin === true);
await statusOf("and ADMIN_TELEGRAM_IDS has no say over it",
  call("GET", "/export", { headers: bearer(devAdmin.session) },
    { ...devEnv, ADMIN_TELEGRAM_IDS: "" }), 200);
await statusOf("but unsetting DEV_LOGIN_SECRET drops it to a member",
  call("GET", "/export", { headers: bearer(devAdmin.session) },
    { ...devEnv, DEV_LOGIN_SECRET: "" }), 401);

/* ------------------------------------------------------------------ */
/* An admin session also ends when nothing uses it.                    */

/*
 * The two-hour cap bounds an admin session that is being used. This is
 * what bounds one that is not: apps/web/admin.html is the only place the
 * whole corpus exists in the clear, and the cap runs whether the tab is
 * in use or not (ASD STIG V-222390).
 *
 * The window is the row's own expires_at moving forward on use and never
 * past the cap - no column, and no second sweep beside the one that
 * already clears expired rows. Three things have to hold at once and
 * each fails on its own: a fresh admin row carries the window rather
 * than the cap, using it moves the window, and no amount of use moves
 * the cap. Together they say a row's deadline is never more than one
 * window past the last request that presented it, which is the whole
 * property.
 *
 * The numbers are restated here rather than read out of the Worker. A
 * suite importing the constant would agree with whatever the Worker
 * said, which is the assertion that cannot fail.
 */
reset();

const IDLE_MS = 15 * 60 * 1000;
const ADMIN_CAP_MS = 2 * 3600 * 1000;
const MEMBER_CAP_MS = 7 * 24 * 3600 * 1000;

/*
 * Deadlines are asserted as windows rather than equalities: real time
 * passes between minting a session and reading its row, and an exact
 * match would fail on a slow machine for a reason that has nothing to do
 * with the rule under test. A minute is far tighter than any of the
 * intervals being told apart here.
 */
const SLACK_MS = 60 * 1000;
const near = (actual, want) => Math.abs(actual - want) < SLACK_MS;
const rowWhere = (isAdmin) =>
  sessions.find((s) => s.is_admin === (isAdmin ? 1 : 0));
const leftOn = (row) => Date.parse(row.expires_at) - Date.now();
const inMinutes = (ms) => Math.round(ms / 60000) + " min";

const idleAdmin = await (await signIn({ id: 99 })).clone().json();
const IDLE_ADMIN = idleAdmin.session;
const IDLE_MEMBER = (await (await signIn({})).clone().json()).session;

check("a fresh admin row expires on the idle window, not on the cap",
  near(leftOn(rowWhere(true)), IDLE_MS), inMinutes(leftOn(rowWhere(true))));

/*
 * The caller is still told the cap, and the two values differ on
 * purpose. apps/web/session.js keeps expiresAt and never rewrites it, so
 * handing it the window would drop an admin's own tab a quarter of an
 * hour after sign-in however busy they had been - a client-side timeout
 * nobody specified, arriving through the wrong value. The row is where
 * the window is enforced.
 */
check("but the caller is told the absolute expiry, not the window",
  near(Date.parse(idleAdmin.expiresAt) - Date.now(), ADMIN_CAP_MS),
  inMinutes(Date.parse(idleAdmin.expiresAt) - Date.now()));
check("so the row dies sooner than the expiry the caller was handed",
  Date.parse(rowWhere(true).expires_at) < Date.parse(idleAdmin.expiresAt));

check("a member row still expires seven days out",
  near(leftOn(rowWhere(false)), MEMBER_CAP_MS),
  inMinutes(leftOn(rowWhere(false))));

await statusOf("an admin session used inside the window is allowed",
  call("GET", "/export", { headers: bearer(IDLE_ADMIN) }), 200);

rowWhere(true).expires_at = new Date(Date.now() + 60 * 1000).toISOString();
await statusOf("and with a minute of the window left it still works",
  call("GET", "/export", { headers: bearer(IDLE_ADMIN) }), 200);
check("using it is what slides the window back out to full",
  near(leftOn(rowWhere(true)), IDLE_MS), inMinutes(leftOn(rowWhere(true))));

/* The cap is still nearly two hours away here, which is what makes the
 * refusal below an idle refusal rather than the ordinary expiry this
 * file already covers further up. */
rowWhere(true).expires_at = new Date(Date.now() - 1000).toISOString();
check("the cap is still hours off when the window runs out",
  Date.parse(rowWhere(true).created_at) + ADMIN_CAP_MS - Date.now() >
    ADMIN_CAP_MS - SLACK_MS);
await statusOf("an admin session idle past the window is refused",
  call("GET", "/export", { headers: bearer(IDLE_ADMIN) }), 401);
check("and the idle row is cleared rather than left to sit",
  !sessions.some((s) => s.is_admin === 1), `${sessions.length} row(s) left`);

const memberDeadline = rowWhere(false).expires_at;
await statusOf("the member session beside it is untouched",
  call("GET", "/me", { headers: bearer(IDLE_MEMBER) }), 200);
check("and using that one moves nothing - members have no window",
  rowWhere(false).expires_at === memberDeadline, memberDeadline);

/*
 * A row in continuous use for just under two hours: every request slid
 * the window, and the last of them ran into the cap. This is what a real
 * row looks like at that moment, and the cap is what stops an admin
 * session renewing itself a quarter of an hour at a time forever.
 */
reset();
const CAP_ADMIN = (await (await signIn({ id: 99 })).clone().json()).session;
const capped = rowWhere(true);
capped.created_at =
  new Date(Date.now() - ADMIN_CAP_MS + 60 * 1000).toISOString();
capped.expires_at = new Date(Date.now() + 60 * 1000).toISOString();

await statusOf("a session a minute short of the cap still works",
  call("GET", "/export", { headers: bearer(CAP_ADMIN) }), 200);
check("but no amount of use slides the deadline past the cap",
  near(leftOn(rowWhere(true)), 60 * 1000), inMinutes(leftOn(rowWhere(true))));

rowWhere(true).expires_at = new Date(Date.now() - 1000).toISOString();
await statusOf("so the cap still ends a session that never went idle",
  call("GET", "/export", { headers: bearer(CAP_ADMIN) }), 401);

/*
 * The window follows the flag on the row rather than the re-read above
 * it. This row was handed the whole corpus's ciphertext once, and taking
 * its owner off ADMIN_TELEGRAM_IDS does not un-hand it - so a demoted
 * session keeps the shorter window along with the member rights it also
 * keeps. Reading the re-read instead would hand a demoted session the
 * longer deadline, which is the wrong direction for a demotion.
 */
reset();
const DEMOTED_IDLE = (await (await signIn({ id: 99 })).clone().json()).session;
rowWhere(true).expires_at = new Date(Date.now() + 60 * 1000).toISOString();
await statusOf("a demoted admin session still works as a member session",
  call("GET", "/me", { headers: bearer(DEMOTED_IDLE) }, demoted), 200);
check("and keeps the admin window, because the row still opened the corpus",
  near(leftOn(rowWhere(true)), IDLE_MS), inMinutes(leftOn(rowWhere(true))));

/* A development admin session is an admin session, with no carve-out of
 * the kind the ADMIN_TELEGRAM_IDS re-read needs: the window bounds what
 * the row can reach, not where its adminness came from. */
const devIdle = await (await call("POST", "/auth/dev",
  { headers: { Origin: LOCAL, ...TYPE },
    body: JSON.stringify(
      { secret: "dev-secret", subject: "root", admin: true }) },
  devEnv)).clone().json();
const devRow = () => sessions.find((s) => s.is_dev === 1);
check("a development admin session gets the window too",
  devIdle.isAdmin === true && near(leftOn(devRow()), IDLE_MS),
  inMinutes(leftOn(devRow())));

/* The break-glass token is a secret rather than a row, so there is
 * nothing to slide and no row to find. Asserted because a slide written
 * one level too high would either move somebody else's deadline or fall
 * over on the row that is not there. */
const deadlinesBefore = sessions.map((s) => s.expires_at).join("|");
await statusOf("the break-glass token still exports",
  call("GET", "/export", { headers: bearer("sekrit-token-value") }), 200);
check("and it moved no session's deadline",
  sessions.map((s) => s.expires_at).join("|") === deadlinesBefore);

/*
 * A row whose created_at will not parse still gets an answer. Sliding a
 * deadline off it unguarded is `new Date(NaN).toISOString()`, which
 * throws - so a single unreadable row would turn every admin request
 * into a 500 rather than a refusal, and a crash is a worse way to find
 * out than a short session. It falls back to the window and never to
 * anything longer, the same failing-closed shape tokenMatches() carries
 * for an unset secret.
 */
reset();
const ODD_ADMIN = (await (await signIn({ id: 99 })).clone().json()).session;
rowWhere(true).created_at = "not a date";
await statusOf("an admin row with an unreadable created_at still answers",
  call("GET", "/export", { headers: bearer(ODD_ADMIN) }), 200);
check("and falls back to the window rather than to anything longer",
  near(leftOn(rowWhere(true)), IDLE_MS), inMinutes(leftOn(rowWhere(true))));

/* ------------------------------------------------------------------ */
/* Corrections - a new row that names the row it supersedes (#84).     */

/*
 * The Worker cannot modify a record, because it cannot read one. A
 * correction is therefore an insert plus a pointer, and the pointer is a
 * clear column so that this side can check three things it could never
 * check from inside a blob: the row exists, it belongs to the caller,
 * and nothing has corrected it already.
 *
 * The third check is the chain shape. Allowing two rows to name the same
 * target would leave both of them current - neither is named by anything
 * - so a member would hold two claims where they meant one and the
 * resolver would need a tie-break rule living in a client this side
 * cannot see. Refusing it keeps "current" meaning "the rows nobody
 * names", which is a total function with no tie-break anywhere.
 */

reset();

const OWNER = (await (await signIn({})).clone().json()).session;
const STRANGER = (await (await signIn({ id: 7777 })).clone().json()).session;
const CURATOR = (await (await signIn({ id: 99 })).clone().json()).session;

const submit = (token, body) =>
  call("POST", "/submit",
    { headers: bearer(token), body: JSON.stringify(body) });

await submit(OWNER, { ciphertext: "QUJDRA==" });
await submit(OWNER, { ciphertext: "RUZHSA==" });
await submit(STRANGER, { ciphertext: "SUpLTA==" });

const mineOnly = stored.filter((r) => r.account_id === FIXTURE_4242);
const firstEntry = mineOnly[0];
const secondEntry = mineOnly[1];
const strangersEntry = stored.find((r) => r.account_id !== FIXTURE_4242);

const CORRECTION = "Y29ycmVjdGlvbg==";
const accepted = await submit(OWNER,
  { ciphertext: CORRECTION, supersedes: firstEntry.id });
const correctionRow = stored.find((r) => r.ciphertext === CORRECTION);
check("a correction stores the new row and the pointer together",
  accepted.status === 200 && correctionRow !== undefined &&
  correctionRow.supersedes === firstEntry.id,
  `${accepted.status}, supersedes=${correctionRow &&
    correctionRow.supersedes}`);

/* Erasing the earlier row is the admin deletion, not this. A correction
 * that removed what it replaced would leave the keyholder unable to tell
 * a typo fix from a rewrite, which is the whole reason the tombstone is
 * retained rather than tidied away. */
const tombstone = stored.find((r) => r.id === firstEntry.id);
check("and the row it supersedes stays as a tombstone",
  tombstone !== undefined && tombstone.ciphertext === "QUJDRA==");

/* The earlier entries are backdated, because four rows inserted inside
 * one millisecond all carry the same timestamp and any assertion about
 * which one `lastAt` picked would hold whatever the route returned. Rows
 * written on different days are what the corpus really looks like. */
const DAY = 24 * 3600 * 1000;
firstEntry.received_at = new Date(Date.now() - 2 * DAY).toISOString();
secondEntry.received_at = new Date(Date.now() - DAY).toISOString();

const corrected = await (await call("GET", "/me",
  { headers: bearer(OWNER) })).json();
check("/me counts what this account currently claims, not rows written",
  corrected.entries === 2 && corrected.superseded === 1,
  `entries=${corrected.entries} superseded=${corrected.superseded}`);

/* `lastAt` answers when this account last sent something, and a
 * correction is something sent - so it counts tombstones where `entries`
 * does not. The two questions coincide on every corpus reachable through
 * these routes anyway: a correction is inserted after the row it names,
 * so the newest row is never one that something supersedes. */
check("and the last-submitted time is the correction's own",
  corrected.lastAt === correctionRow.received_at, `lastAt=${corrected.lastAt}`);

/*
 * The refusals. Each one refuses the whole submission - a correction
 * that quietly became an ordinary new row is a failure the member cannot
 * see, and the row they meant to replace would still be counted.
 */
const rowsBeforeRefusals = stored.length;

const unknown = await submit(OWNER,
  { ciphertext: "QUJDRA==", supersedes: 99999 });
const unknownBody = await unknown.clone().json();
check("superseding a row that is not there is refused",
  unknown.status === 404, `${unknown.status}`);

const foreign = await submit(OWNER,
  { ciphertext: "QUJDRA==", supersedes: strangersEntry.id });
const foreignBody = await foreign.clone().json();
check("superseding somebody else's row is refused",
  foreign.status === 404, `${foreign.status}`);

/*
 * And the two are the same answer, to the byte. Telling "no such row"
 * apart from "not your row" would make this route a probe for which ids
 * are live across the whole corpus - more than the grouping DESIGN.md's
 * threat model accepts, and reachable with any member session rather
 * than with the database.
 */
check("neither refusal says whether that row exists",
  foreign.status === unknown.status &&
  JSON.stringify(foreignBody) === JSON.stringify(unknownBody),
  JSON.stringify(foreignBody.error));

/* Told apart from the two above, and safely: reaching this means the
 * caller has already proved the row is theirs, so the answer is about
 * their own data and nobody else's. */
const already = await submit(OWNER,
  { ciphertext: "QUJDRA==", supersedes: firstEntry.id });
check("superseding a row that has already been corrected is refused",
  already.status === 409 && already.status !== unknown.status,
  `${already.status}`);

/*
 * A row cannot supersede itself. It cannot name its own id honestly
 * either, since the id is assigned by the insert - so this is really the
 * assertion that every check runs BEFORE anything is stored. An
 * implementation that inserted first and validated after would find the
 * row present, accept it, and leave a member holding an entry that hides
 * itself from their own count.
 */
const ownId = nextId;
const selfRef = await submit(OWNER,
  { ciphertext: "QUJDRA==", supersedes: ownId });
check("a row cannot supersede itself, because the checks precede the insert",
  selfRef.status === 404 && !stored.some((r) => r.id === ownId),
  `${selfRef.status}`);

/* The id of a row, or nothing. A client sending the string "1" has a bug
 * worth hearing about rather than a value worth coercing. */
for (const [label, value] of [
  ["a string", "1"],
  ["zero", 0],
  ["a negative id", -1],
  ["a fraction", 1.5],
]) {
  await statusOf(`supersedes as ${label} is refused`,
    submit(OWNER, { ciphertext: "QUJDRA==", supersedes: value }), 400);
}

check("and not one refused correction reached the database",
  stored.length === rowsBeforeRefusals,
  `${rowsBeforeRefusals} -> ${stored.length}`);

await statusOf("an explicit null supersedes is an ordinary submission",
  submit(OWNER, { ciphertext: "bnVsbA==", supersedes: null }), 200);
check("and it stores no pointer",
  stored[stored.length - 1].supersedes === null);

/* Correcting the correction is how a second correction lands, and the
 * chain still resolves to one current entry per measurement. */
const TWICE = "dHdpY2U=";
await statusOf("correcting the correction is how a member corrects twice",
  submit(OWNER, { ciphertext: TWICE, supersedes: correctionRow.id }), 200);
const chained = await (await call("GET", "/me",
  { headers: bearer(OWNER) })).json();
check("a chain of corrections leaves one current entry, not a pile",
  chained.entries === 3 && chained.superseded === 2,
  `entries=${chained.entries} superseded=${chained.superseded}`);

/*
 * The export is where resolution becomes possible at all: the Worker
 * knows which row a correction replaces and cannot know what either of
 * them says, so dropping tombstones from a series happens in the
 * keyholder's browser. Without the column in this response it cannot.
 */
const exported = await (await call("GET", "/export",
  { headers: bearer(CURATOR) })).json();
const exportedCorrection = exported.submissions.find(
  (r) => r.id === correctionRow.id);
const exportedPlain = exported.submissions.find(
  (r) => r.id === secondEntry.id);
check("the export carries the pointer the keyholder's browser resolves",
  exportedCorrection !== undefined &&
  exportedCorrection.supersedes === firstEntry.id &&
  exportedPlain !== undefined && "supersedes" in exportedPlain &&
  exportedPlain.supersedes === null,
  `supersedes=${exportedCorrection && exportedCorrection.supersedes}`);

/*
 * The pointer is advisory, which is what keeps DELETE /submission/:id
 * needing no cascade and no change at all. Removing a correction puts
 * the row it corrected back among the current ones, and the dangling
 * pointer left on the row that corrected THAT one hides nothing. Any
 * other rule would make one deletion silently become two, or refuse a
 * deletion that answers "please take mine down".
 */
await call("DELETE", "/submission/" + correctionRow.id,
  { headers: bearer(CURATOR) });
const afterDelete = await (await call("GET", "/me",
  { headers: bearer(OWNER) })).json();
check("deleting a correction puts the row it corrected back in the count",
  afterDelete.entries === 4 && afterDelete.superseded === 0,
  `entries=${afterDelete.entries} superseded=${afterDelete.superseded}`);

await statusOf("and that row can be corrected again",
  submit(OWNER, { ciphertext: "QWdhaW4=", supersedes: firstEntry.id }), 200);

/* ------------------------------------------------------------------ */
/* Site content - the one document served without a credential (#87).  */

/*
 * The read is open and the write is an admin session, and the asymmetry
 * is the design rather than an oversight.
 *
 * Each page's shipped HTML is the fallback for these values, and
 * apps/web is copied verbatim to a public site - so the bytes this
 * route enhances can be fetched by anybody already. A session gate here
 * would promise a confidentiality the fallback does not have, and the
 * cost of promising it is that somebody eventually puts something
 * private in a table designed for site copy. What follows from the open
 * read is the rule the membership section below enforces structurally:
 * nothing about a person goes in this table, and the list of people has
 * a table and a gate of its own.
 */
reset();

const CONTENT_ADMIN = (await (await signIn({ id: 99 })).clone().json()).session;
const editorId = (await (await call("GET", "/me",
  { headers: bearer(CONTENT_ADMIN) })).json()).accountId;

const setContent = (token, body) =>
  call("POST", "/content",
    { headers: bearer(token), body: JSON.stringify(body) });
const readContent = () => call("GET", "/content", { headers: good });

const blank = await readContent();
const blankBody = await blank.clone().json();
check("an absent site content document is not an error",
  blank.status === 200 && blankBody.ok === true &&
  JSON.stringify(blankBody.content) === "{}",
  `${blank.status} ${JSON.stringify(blankBody.content)}`);

await setContent(CONTENT_ADMIN, { name: "welcome", value: "Weigh in." });
const written = await (await readContent()).json();
check("a value an admin set reads back under its name, to anybody",
  written.content.welcome === "Weigh in.", JSON.stringify(written.content));

await setContent(CONTENT_ADMIN, { name: "welcome", value: "Weigh in weekly." });
const replaced = await (await readContent()).json();
check("writing a name again replaces it rather than adding a row",
  content.length === 1 && replaced.content.welcome === "Weigh in weekly.",
  `${content.length} row(s)`);

await setContent(CONTENT_ADMIN,
  { name: "dashboard.note", value: "Updated Fridays." });
const both = await (await readContent()).json();
check("a second name sits beside the first",
  Object.keys(both.content).length === 2 &&
  both.content["dashboard.note"] === "Updated Fridays.",
  JSON.stringify(both.content));

/*
 * The document carries names and values and nothing else. `updated_by`
 * is an account id, and a document anybody may fetch is the wrong place
 * to publish which account did anything - the audit belongs to the
 * table and to whatever admin surface reads it behind a gate.
 */
const publicText = await (await readContent()).text();
check("the public document names no writer and no time",
  !publicText.includes(editorId) && !publicText.includes("updated_by") &&
  !publicText.includes("updated_at"), publicText.slice(0, 50) + "â€¦");

check("but the row records the admin who wrote it",
  content[0].updated_by === editorId,
  content[0].updated_by ? content[0].updated_by.slice(0, 20) + "â€¦" : "absent");

/* The break-glass caller is an admin and is nobody, so an audit column
 * has to say that rather than invent an account or store a null that
 * reads as "nobody knows". */
await setContent("sekrit-token-value", { name: "welcome", value: "Back in." });
const glassWrite = content.find((r) => r.name === "welcome");
check("a break-glass write is recorded as break-glass, not as an account",
  glassWrite.updated_by === "break-glass", glassWrite.updated_by);

const contentBefore = content.length;
for (const [label, name] of [
  ["upper case", "Welcome"],
  ["a path", "a/b"],
  ["empty", ""],
  ["a leading dash", "-lead"],
  ["longer than sixty-four characters", "a".repeat(65)],
]) {
  await statusOf(`a content name that is ${label} is refused`,
    setContent(CONTENT_ADMIN, { name: name, value: "x" }), 400);
}

await statusOf("a content value that is not text is refused",
  setContent(CONTENT_ADMIN, { name: "welcome", value: { html: "<b>" } }), 400);
await statusOf("an oversize content value is refused",
  setContent(CONTENT_ADMIN, { name: "welcome", value: "A".repeat(9000) }), 413);
await statusOf("a malformed content body is refused",
  call("POST", "/content",
    { headers: bearer(CONTENT_ADMIN), body: "{{{" }), 400);

check("and not one refused write reached the table",
  content.length === contentBefore &&
  content.find((r) => r.name === "welcome").value === "Back in.",
  `${contentBefore} -> ${content.length}`);

/* Unsetting a name is how a page goes back to the copy it ships with.
 * Without it a typo can only be written over, and the shipped fallback
 * becomes unreachable for as long as any value sits on top of it. */
await statusOf("an admin can unset a name",
  call("DELETE", "/content/welcome",
    { headers: bearer(CONTENT_ADMIN) }), 200);
const afterUnset = await (await readContent()).json();
check("that name is gone from the document and the others are not",
  afterUnset.content.welcome === undefined &&
  afterUnset.content["dashboard.note"] === "Updated Fridays.",
  JSON.stringify(afterUnset.content));

await statusOf("unsetting a name that is not there still succeeds",
  call("DELETE", "/content/nothing.here",
    { headers: bearer(CONTENT_ADMIN) }), 200);
check("and removed nothing", content.length === 1, `${content.length} row(s)`);

await statusOf("a content name that is not a name is not a route",
  call("DELETE", "/content/Welcome",
    { headers: bearer(CONTENT_ADMIN) }), 404);

await statusOf("a session off the admin list cannot write content",
  call("POST", "/content", { headers: bearer(CONTENT_ADMIN),
    body: JSON.stringify({ name: "welcome", value: "x" }) }, demoted), 401);

/* ------------------------------------------------------------------ */
/* Membership - the list the account design exists to keep private.    */

/*
 * #69's id lists as rows, keyed by the account id rather than by the
 * numeric Telegram id. A numeric id resolves to a person for anyone who
 * can point a bot at it, so a table of them would turn a database
 * breach from "some account submitted twelve times" - the grouping
 * DESIGN.md accepts knowingly - into "here are the group's admins, by
 * name". The HMAC is exactly as un-invertible as the ids stored beside
 * it in `submissions`, under the same secret, for the same reason.
 *
 * The numeric id arrives in the request body and the Worker HMACs it on
 * receipt. Taking the account id from the caller instead would move a
 * 64-character string nobody can check through a human being: a typo in
 * it produces a row that grants nothing and looks completely right,
 * which is the undetectable-wrong-value complaint #69 opens with, moved
 * into the table it asked for.
 */
reset();

const ROOT = (await (await signIn({ id: 99 })).clone().json()).session;
const ORDINARY = (await (await signIn({})).clone().json()).session;

const addMember = (token, body) =>
  call("POST", "/membership",
    { headers: bearer(token), body: JSON.stringify(body) });

/*
 * An admin writing their own row emits a record, which the last section
 * of this file is about. Where such a write is only scaffolding for a
 * different assertion, it goes through here - a log line printed into
 * the middle of a check list is the kind of noise that teaches people to
 * skim the output, and skimmed output is how a FAIL gets missed.
 */
const quietly = async (run) => {
  const before = console.log;
  console.log = () => {};
  try {
    return await run();
  } finally {
    console.log = before;
  }
};

await statusOf("an admin adds somebody by their numeric Telegram id",
  addMember(ROOT, { telegramId: "4242", role: "admin", label: "Alex" }), 200);

/* Against the committed fixture rather than against whatever the Worker
 * computed a moment ago: comparing the row to a value derived the same
 * way would pass even if both were wrong together. */
check("the row is keyed by the account id, not by the numeric id",
  roster.length === 1 && roster[0].account_id === FIXTURE_4242,
  roster.length ? roster[0].account_id.slice(0, 20) + "â€¦" : "no row");
check("and the numeric id is nowhere in the row",
  !JSON.stringify(roster[0]).includes("4242"), JSON.stringify(roster[0]));

const listed = await (await call("GET", "/membership",
  { headers: bearer(ROOT) })).json();
check("the list an admin reads carries the label somebody typed",
  listed.membership.length === 1 && listed.membership[0].label === "Alex" &&
  listed.membership[0].account_id === FIXTURE_4242,
  JSON.stringify(listed.membership[0]));
check("and no numeric id travels back out with it",
  !JSON.stringify(listed).includes("4242"));

/* Backdated for the same reason the corrections above are: two writes
 * inside one millisecond carry the same timestamp, and an assertion
 * about which one survived would hold whatever the upsert did. */
roster[0].added_at = new Date(Date.now() - 3 * DAY).toISOString();
const addedAt = roster[0].added_at;
await statusOf("adding the same account and role again relabels it",
  addMember(ROOT,
    { telegramId: "4242", role: "admin", label: "Alexandra" }), 200);
check("one row, the new label, and the date it was added left alone",
  roster.length === 1 && roster[0].label === "Alexandra" &&
  roster[0].added_at === addedAt,
  `${roster.length} row(s), label=${roster[0].label}`);

await statusOf("the same account can hold both roles",
  addMember(ROOT,
    { telegramId: "4242", role: "always_allow", label: "Alexandra" }), 200);
check("which is two rows rather than one being written over",
  roster.length === 2 &&
  roster.filter((r) => r.account_id === FIXTURE_4242).length === 2,
  `${roster.length} row(s)`);

const rosterBefore = roster.length;
for (const [label, body] of [
  ["an unknown role", { telegramId: "4242", role: "moderator", label: "A" }],
  ["a role that is not a string", { telegramId: "4242", role: 1, label: "A" }],
  ["a handle instead of an id", { telegramId: "@alex", role: "admin", label: "A" }],
  ["an account id instead of an id",
    { telegramId: FIXTURE_4242, role: "admin", label: "A" }],
  ["no Telegram id at all", { role: "admin", label: "A" }],
  ["an id inside an array", { telegramId: ["4242"], role: "admin", label: "A" }],
  ["no label", { telegramId: "4242", role: "admin" }],
  ["a label of spaces", { telegramId: "4242", role: "admin", label: "   " }],
  ["an oversize label",
    { telegramId: "4242", role: "admin", label: "N".repeat(65) }],
]) {
  await statusOf(`adding with ${label} is refused`,
    addMember(ROOT, body), 400);
}
await statusOf("a malformed membership body is refused",
  call("POST", "/membership", { headers: bearer(ROOT), body: "{{{" }), 400);
check("and not one refused add reached the table",
  roster.length === rosterBefore, `${rosterBefore} -> ${roster.length}`);

/*
 * A second admin before any admin row is removed, because the guard
 * below refuses to remove the last one. Without this the delete that
 * follows would be asserting the guard's refusal while calling itself a
 * successful removal - the same row count, the wrong reason.
 *
 * ROOT's own account, which is also what the demotion probe further
 * down needs: a session whose authority the table carries and the
 * secret does not have to.
 */
await statusOf("a second admin joins the list",
  quietly(() =>
    addMember(ROOT, { telegramId: "99", role: "admin", label: "Root" })), 200);

await statusOf("an admin removes one role and leaves the other",
  call("DELETE", "/membership/admin/" + FIXTURE_4242,
    { headers: bearer(ROOT) }), 200);
check("exactly that row is gone",
  roster.length === 2 &&
  !roster.some((r) => r.account_id === FIXTURE_4242 && r.role === "admin"),
  `${roster.length} row(s)`);

await statusOf("removing a membership row that is not there still succeeds",
  call("DELETE", "/membership/admin/" + FIXTURE_4242,
    { headers: bearer(ROOT) }), 200);
check("and removed nothing else", roster.length === 2);

await statusOf("a role that is not a role is not a route",
  call("DELETE", "/membership/moderator/" + FIXTURE_4242,
    { headers: bearer(ROOT) }), 404);
await statusOf("an account id that is not one is not a route",
  call("DELETE", "/membership/admin/4242", { headers: bearer(ROOT) }), 404);
check("and neither refusal removed a row", roster.length === 2);

/*
 * Dual-read on the enforcing side, asserted where it is easiest to get
 * backwards: taking somebody out of the secret is no longer a demotion
 * on its own, because the row still says they administer. Both arms
 * have to stop saying so, and the section further down removes the row
 * to show the other direction.
 */
await statusOf("dropping out of the secret is not a demotion while the row stands",
  call("GET", "/membership", { headers: bearer(ROOT) }, demoted), 200);
await statusOf("and the row carries the write as well as the read",
  call("POST", "/membership", { headers: bearer(ROOT),
    body: JSON.stringify({ telegramId: "5", role: "always_allow", label: "S" }) },
  demoted), 200);
check("which is the row it says it is",
  roster.some((r) => r.role === "always_allow" && r.label === "S"),
  `${roster.length} row(s)`);

/*
 * The refusals, byte for byte, the way POST /submit's two are.
 *
 * A membership route that answered a member differently from a stranger
 * would say the route is worth pressing. One that answered differently
 * for an account that is on the list than for one that is not would be
 * the membership oracle itself, reachable with any member session
 * rather than with the database. The shape checks are in here too - a
 * role that is not a role answers an admin with 404, and a non-admin
 * must not be able to tell that from anything else, which is only true
 * if the gate runs before the shape check rather than after it.
 */
const refusalTo = async (token, method, path) => {
  const res = await call(method, path, {
    headers: token === null ? good : bearer(token),
    body: method === "POST" ? JSON.stringify({}) : undefined,
  });
  return res.status + " " + (await res.text());
};

const UNLISTED = "0".repeat(64);
const answers = [];
for (const [method, path] of [
  ["GET", "/membership"],
  ["POST", "/membership"],
  ["DELETE", "/membership/always_allow/" + FIXTURE_4242],
  ["DELETE", "/membership/always_allow/" + UNLISTED],
  ["DELETE", "/membership/admin/" + FIXTURE_4242],
  ["DELETE", "/membership/moderator/" + FIXTURE_4242],
]) {
  answers.push(await refusalTo(null, method, path));
  answers.push(await refusalTo(ORDINARY, method, path));
}
check("every membership route refuses a non-admin with the same bytes",
  new Set(answers).size === 1, JSON.stringify(answers[0]));
check("and it is the refusal every other admin route already gives",
  answers[0] === await refusalTo(ORDINARY, "GET", "/export"), answers[0]);
check("no refused call touched the list",
  roster.length === 3 &&
  roster.filter((r) => r.role === "admin").length === 1,
  `${roster.length} row(s)`);

/*
 * Two tables and two routes rather than one route with a filter: a
 * filter is one `if` away from serving the list to a member session,
 * and that mistake would look like nothing at all. Asserted against a
 * document that has something in it, because a route serving an empty
 * document mentions no membership either.
 */
await setContent(ROOT, { name: "welcome", value: "Weigh in." });
const publicAfter = await (await call("GET", "/content",
  { headers: good })).text();
check("the public content document carries copy and knows no membership",
  publicAfter.includes("Weigh in.") &&
  !publicAfter.includes(FIXTURE_4242) && !publicAfter.includes("Alexandra"),
  publicAfter.slice(0, 60) + "â€¦");

/* ------------------------------------------------------------------ */
/* The table is the enforcing truth now, beside the secret.            */

/*
 * The seam #69 was filed about, closed and asserted from both sides.
 *
 * The shipped posture is dual-read: a caller administers if the secret
 * says so OR the table does, and each of the four places the answer is
 * asked has to agree, because they are four separate decisions and no
 * one probe sees them all - what a sign-in mints, what the router
 * gates, what a per-request re-check reads, and what the group check
 * accepts. The flip to table-only is a later decision the owner takes
 * after a backfill; what makes it takeable is `secretOnly` below, not a
 * promise here.
 */
reset();

const KEEPER = (await (await signIn({ id: 99 })).clone().json()).session;
const HOPEFUL = (await (await signIn({})).clone().json()).session;

await addMember(KEEPER, { telegramId: "4242", role: "admin", label: "Alex" });
check("the account is listed as an admin in the table",
  roster.length === 1 && roster[0].role === "admin" &&
  roster[0].account_id === FIXTURE_4242, `${roster.length} row(s)`);

/*
 * A row does not promote a session that is already open. The stored
 * flag stays a necessary condition and the lists only ever turn it off:
 * a member session promoted by somebody else's edit is a promotion
 * nobody signed in for, and the session's own bounds - seven member
 * days rather than two admin hours - were set for the authority it had
 * when it was minted.
 */
await statusOf("the row does not promote a session already open",
  call("GET", "/export", { headers: bearer(HOPEFUL) }), 401);
await statusOf("nor hand it the list it is on",
  call("GET", "/membership", { headers: bearer(HOPEFUL) }), 401);

const rejoined = await (await signIn({})).clone().json();
check("but signing in again reads the table and mints an admin",
  rejoined.isAdmin === true, `isAdmin=${rejoined.isAdmin}`);
await statusOf("and that session administers",
  call("GET", "/membership", { headers: bearer(rejoined.session) }), 200);

/*
 * The group check reads the table too. `ALWAYS_ALLOW_TELEGRAM_IDS` is
 * NOT being migrated - it stays the secret-side break-glass, the way
 * back in when the bot is gone from the group - so this arm is an
 * addition beside it and never a replacement for it.
 */
const beforeGroupStub = globalThis.fetch;
globalThis.fetch = async () => new Response(
  JSON.stringify({ ok: true, result: { status: "left" } }), { headers: TYPE });
await statusOf("somebody the group has lost is refused",
  signIn({ id: 777, username: "outsider" }, gated), 403);
await addMember(KEEPER,
  { telegramId: "777", role: "always_allow", label: "Outsider" });
await statusOf("and an always_allow row is what lets them back in",
  signIn({ id: 777, username: "outsider" }, gated), 200);
check("the secret still does it too, with no row of its own",
  (await signIn({ id: 555, username: "bypass" },
    { ...gated, ALWAYS_ALLOW_TELEGRAM_IDS: "555" })).status === 200 &&
  !roster.some((r) => r.label === "bypass"));
globalThis.fetch = beforeGroupStub;

/* ------------------------------------------------------------------ */
/* Removing a row takes effect on the next request.                    */

/*
 * The whole reason the re-check reads the table rather than trusting
 * the flag on the session row: an admin taken off the list keeps the
 * ciphertext they already hold, and there has to be a lever that stops
 * the next request without waiting two hours for a clock. Demotion is
 * still not revocation - the member session underneath goes on working.
 */
reset();

const CHAIR = (await (await signIn({ id: 99 })).clone().json()).session;
await addMember(CHAIR, { telegramId: "4242", role: "admin", label: "Alex" });
// A second admin row, or the removal below meets the last-admin guard
// and this section would be testing that instead.
await addMember(CHAIR, { telegramId: "31337", role: "admin", label: "Sam" });
const PROMOTED = (await (await signIn({})).clone().json()).session;

await statusOf("a table admin can read the list",
  call("GET", "/membership", { headers: bearer(PROMOTED) }), 200);

await statusOf("the row is removed",
  call("DELETE", "/membership/admin/" + FIXTURE_4242,
    { headers: bearer(CHAIR) }), 200);

await statusOf("and the very next request is refused",
  call("GET", "/membership", { headers: bearer(PROMOTED) }), 401);
await statusOf("but the session still works as the member session it is",
  call("GET", "/me", { headers: bearer(PROMOTED) }), 200);

/* ------------------------------------------------------------------ */
/* The last admin row cannot be removed.                               */

/*
 * A lockout guard is only worth having where it can actually bite, and
 * the table becoming enforcing is what moves it there: a list that
 * grants nothing loses nothing by going empty, and a list that grants
 * everything loses everybody.
 *
 * Counted and deleted in ONE statement pair, inside one D1 batch. A
 * count read first and acted on second is a race with the other admin
 * pressing Remove at the same moment - both reads see two, both writes
 * succeed, and the table is empty with neither request having done
 * anything wrong. The guard is a subquery inside the DELETE, so SQLite
 * evaluates it against the same snapshot the delete applies to, and the
 * second statement is how the Worker finds out whether the row went.
 */
reset();

const SOLE = (await (await signIn({ id: 99 })).clone().json()).session;
await addMember(SOLE, { telegramId: "4242", role: "admin", label: "Alex" });

const lastAdmin = await call("DELETE", "/membership/admin/" + FIXTURE_4242,
  { headers: bearer(SOLE) });
check("removing the last admin row is refused",
  lastAdmin.status === 409, `${lastAdmin.status}`);
check("and the row is still there",
  roster.length === 1 && roster[0].role === "admin", `${roster.length} row(s)`);

/*
 * The refusal explains itself, and that is deliberate rather than an
 * exception to the identical-refusal rule above. Only somebody who may
 * already read the whole list can provoke it, so it tells them nothing
 * they could not read directly - while an admin who could not tell "the
 * last admin" from "no such row" would press Remove again, or start
 * looking for the bug.
 */
check("with a refusal that says which refusal it is",
  String((await lastAdmin.clone().json()).error).includes("last admin"),
  JSON.stringify(await lastAdmin.clone().json()));

await statusOf("an always_allow row has no such guard",
  addMember(SOLE, { telegramId: "4242", role: "always_allow", label: "Alex" }),
  200);
await statusOf("and comes off freely, even as the only one",
  call("DELETE", "/membership/always_allow/" + FIXTURE_4242,
    { headers: bearer(SOLE) }), 200);
check("which leaves the admin row untouched",
  roster.length === 1 && roster[0].role === "admin", `${roster.length} row(s)`);

await statusOf("a second admin is what unlocks the removal",
  addMember(SOLE, { telegramId: "31337", role: "admin", label: "Sam" }), 200);
await statusOf("and then the first one comes off",
  call("DELETE", "/membership/admin/" + FIXTURE_4242,
    { headers: bearer(SOLE) }), 200);
check("leaving exactly one admin row",
  roster.filter((r) => r.role === "admin").length === 1,
  `${roster.length} row(s)`);

/*
 * Removing a row that was never there still succeeds, and the guard
 * must not turn that into a refusal. The two are told apart by whether
 * the row is there afterwards rather than by counting admins, which is
 * why the batch asks for the row rather than for a number: with one
 * admin left, "delete nobody's row" and "delete the last admin's row"
 * have the same admin count on both sides of the statement.
 */
await statusOf("removing a row that is not there still succeeds",
  call("DELETE", "/membership/admin/" + "1".repeat(64),
    { headers: bearer(SOLE) }), 200);
check("and the last admin is still the last admin",
  roster.filter((r) => r.role === "admin").length === 1,
  `${roster.length} row(s)`);

/*
 * The MECHANISM, and not only the outcome.
 *
 * Every assertion above survives an implementation that counts the
 * admins in one round trip, decides in JavaScript, and then sends an
 * unguarded DELETE - the exact read-then-write race the guard exists to
 * close. It survives because a table's state afterwards is the same
 * either way, and no stub short of a real database can make the race
 * happen on demand. So the statements themselves are the assertion:
 * both halves arrive through ONE batch() call, and no admin is counted
 * outside it.
 *
 * The one membership statement that legitimately runs alone is the
 * per-request authority read behind every admin route, which counts
 * nothing and decides nothing about this delete. Naming it rather than
 * excluding a pattern is what keeps a smuggled-in count visible.
 */
reset();

const PAIR = (await (await signIn({ id: 99 })).clone().json()).session;
await addMember(PAIR, { telegramId: "4242", role: "admin", label: "Alex" });
await addMember(PAIR, { telegramId: "31337", role: "admin", label: "Sam" });

executed = [];
batches = [];
await call("DELETE", "/membership/admin/" + FIXTURE_4242,
  { headers: bearer(PAIR) });

const together = batches.length === 1 ? batches[0] : [];
const alone = executed.filter((s) => s.table === "membership" && !s.batch);

check("removing a row makes exactly one batch() call",
  batches.length === 1, `${batches.length} batch call(s)`);
check("carrying exactly the two statements the guard is made of",
  together.length === 2, `${together.length} statement(s) in the batch`);
check("the first deletes with the count as a subquery, not as a round trip",
  together.length === 2 && /^\s*DELETE FROM membership/i.test(together[0].sql) &&
  /AND \(SELECT COUNT\(\*\) FROM membership WHERE role = 'admin'\) > 1/i
    .test(together[0].sql),
  together.length ? together[0].sql : "no statement");
check("the second asks for the row, which is what a count cannot answer",
  together.length === 2 &&
  /^\s*SELECT account_id FROM membership WHERE/i.test(together[1].sql) &&
  !/COUNT\(\*\)/i.test(together[1].sql),
  together.length > 1 ? together[1].sql : "no statement");
check("and the only membership statement outside it is the authority read",
  alone.length === 1 &&
  alone[0].sql === "SELECT account_id FROM membership WHERE role = ?",
  JSON.stringify(alone.map((s) => s.sql)));

/* ------------------------------------------------------------------ */
/* A development session may not write an admin row.                   */

/*
 * POST /auth/dev mints a session whose adminness comes from
 * DEV_LOGIN_SECRET and from nothing else, and that was harmless while
 * the table granted nothing. It is not harmless now: a row written from
 * a development login is a real admin row, and after the flip to
 * table-only it is the whole authority. So the dev session keeps every
 * power it had over the data and loses this one - it may still manage
 * the always-allow list, which is what makes a local admin page
 * workable at all.
 *
 * There is deliberately no escape hatch. "Unless the gating is
 * explicit" is satisfied by a refusal, not by a second secret to
 * forget: on production DEV_LOGIN_SECRET is unset and no dev session
 * can exist, so this guard costs that deployment nothing and is a real
 * boundary on every other one.
 */
reset();

const DEV_ADMIN = (await (await call("POST", "/auth/dev",
  { headers: { Origin: LOCAL, ...TYPE },
    body: JSON.stringify(
      { secret: "dev-secret", subject: "alice", admin: true }) },
  devEnv)).clone().json()).session;

await statusOf("the dev session administers",
  call("GET", "/membership", { headers: bearer(DEV_ADMIN) }, devEnv), 200);
await statusOf("and may write the always-allow list",
  call("POST", "/membership", { headers: bearer(DEV_ADMIN),
    body: JSON.stringify(
      { telegramId: "4242", role: "always_allow", label: "Alex" }) },
  devEnv), 200);

const devWrite = await call("POST", "/membership",
  { headers: bearer(DEV_ADMIN),
    body: JSON.stringify({ telegramId: "4242", role: "admin", label: "Alex" }) },
  devEnv);
check("but an admin row from a dev session is refused", devWrite.status === 401,
  `${devWrite.status}`);
check("with the refusal every other one gives, byte for byte",
  (await devWrite.text()) === JSON.stringify({ error: "Not authorized." }));
check("and nothing reached the table",
  !roster.some((r) => r.role === "admin"), `${roster.length} row(s)`);

/*
 * The refusal stands ahead of every shape check, which is what its
 * comment claims and what this asserts. A malformed body that would
 * otherwise earn a 400 gets the same 401: a caller who may not write
 * this row cannot use the route to find out what it would have said
 * next. The gain is small - the same rule is reachable with a
 * well-formed body - and the comment is load-bearing for whoever
 * reorders these checks later.
 */
const devEarly = await call("POST", "/membership",
  { headers: bearer(DEV_ADMIN),
    body: JSON.stringify({ telegramId: "not-a-number", role: "admin" }) },
  devEnv);
check("and a malformed body earns that refusal rather than a shape complaint",
  devEarly.status === 401 &&
  (await devEarly.text()) === JSON.stringify({ error: "Not authorized." }),
  `${devEarly.status}`);

await addMember(
  (await (await signIn({ id: 99 })).clone().json()).session,
  { telegramId: "4242", role: "admin", label: "Alex" });
await statusOf("nor may a dev session remove one",
  call("DELETE", "/membership/admin/" + FIXTURE_4242,
    { headers: bearer(DEV_ADMIN) }, devEnv), 401);
check("that row is still there",
  roster.some((r) => r.role === "admin"), `${roster.length} row(s)`);

/* ------------------------------------------------------------------ */
/* A row this side cannot honor is shown as a dud, and comes off.      */

/*
 * POST is not the only way into this table. `wrangler d1 execute` is the
 * other, OPERATIONS.md reaches for it by name, and it validates nothing
 * - so an account id pasted there in upper-case hex is sixty-four
 * correct characters that are not the string the Worker compares
 * against. The authority read drops it, so the row grants exactly
 * nothing, while the list would show it beside the rows that do. That is
 * the undetectable-wrong-value failure #69 opens with, arriving by the
 * one door POST cannot guard.
 *
 * Two directions, because either alone leaves the trap open. The list
 * has to tell a granting row from a dud, or nobody learns the row is
 * broken; and DELETE has to fold case rather than refuse the id, or the
 * only thing an admin can do about the dud is open a database console.
 */
reset();

const WARDEN = (await (await signIn({ id: 99 })).clone().json()).session;
await addMember(WARDEN, { telegramId: "4242", role: "admin", label: "Alex" });

const SHOUTER = { id: 31337, username: "shouted" };
const shoutedFor = (await (await call("GET", "/me", {
  headers: bearer((await (await signIn(SHOUTER)).clone().json()).session),
})).json()).accountId;
const SHOUTED = shoutedFor.toUpperCase();

const handWritten = () => roster.push({
  account_id: SHOUTED, role: "admin", label: "Shouted",
  added_at: "2026-08-08T00:00:00.000Z", added_by: "by hand",
});
handWritten();

const shoutedIn = await (await signIn(SHOUTER)).clone().json();
check("an upper-case row grants nothing, the way every unreadable row does",
  shoutedIn.isAdmin === false, `isAdmin=${shoutedIn.isAdmin}`);

const dudList = await (await call("GET", "/membership",
  { headers: bearer(WARDEN) })).json();
check("so it is kept out of the list of rows that do grant",
  dudList.membership.length === 1 &&
  dudList.membership[0].account_id === FIXTURE_4242,
  JSON.stringify(dudList.membership.map((r) => r.account_id)));
check("and named as malformed instead, with the label that says which row",
  Array.isArray(dudList.malformed) && dudList.malformed.length === 1 &&
  dudList.malformed[0].account_id === SHOUTED &&
  dudList.malformed[0].label === "Shouted",
  JSON.stringify(dudList.malformed));

await statusOf("the id the list handed back is an id that removes it",
  call("DELETE", "/membership/admin/" + SHOUTED,
    { headers: bearer(WARDEN) }), 200);
check("and the row is gone",
  !roster.some((r) => r.account_id === SHOUTED), JSON.stringify(roster));

handWritten();
await statusOf("so is the canonical spelling of the same sixty-four characters",
  call("DELETE", "/membership/admin/" + shoutedFor,
    { headers: bearer(WARDEN) }), 200);
check("which is one row normalized, not two rows that happen to agree",
  !roster.some((r) => r.account_id === SHOUTED) &&
  roster.filter((r) => r.role === "admin").length === 1,
  JSON.stringify(roster.map((r) => r.account_id)));

/*
 * The list and the authority read have to agree about every row, so the
 * row that separates a pattern test from a typeof one is asked of the
 * list as well. RegExp.test() stringifies whatever it is handed: a value
 * that is not a string but spells a valid account id passes the pattern
 * alone, and a list that showed it as a grant would be describing
 * authority that no request will honor.
 */
roster.push({ account_id: { toString: () => shoutedFor }, role: "admin",
  label: "Spelled", added_at: "2026-08-08T00:00:00.000Z", added_by: "by hand" });
const spelledList = await (await call("GET", "/membership",
  { headers: bearer(WARDEN) })).json();
check("a row that only spells an account id is a dud to the list too",
  spelledList.membership.every((r) => r.label !== "Spelled") &&
  spelledList.malformed.length === 1 &&
  spelledList.malformed[0].label === "Spelled",
  JSON.stringify(spelledList.malformed.map((r) => r.label)));
roster.pop();

/* An ordinary list still answers with the field, so a reader that looks
 * for duds is not left guessing whether the Worker computes them. */
const cleanList = await (await call("GET", "/membership",
  { headers: bearer(WARDEN) })).json();
check("a list with no duds in it says so rather than leaving the field off",
  Array.isArray(cleanList.malformed) && cleanList.malformed.length === 0,
  JSON.stringify(cleanList.malformed));

/* ------------------------------------------------------------------ */
/* A D1 failure closes.                                                */

/*
 * The table is a grant now, so every way of failing to read it has to
 * end in "not an admin, not a member". Asserted against a binding that
 * throws on the membership read only: an error swallowed into a
 * permissive default is the failure mode nothing else here would catch,
 * because it looks exactly like a working list on a working database.
 *
 * The refusal is the ordinary one rather than a 500. A 500 carries no
 * CORS headers, so the page would report a network failure - and "the
 * database is unwell" is not something a refusal should be telling an
 * unauthenticated caller in any case.
 */
reset();

const CHAIR2 = (await (await signIn({ id: 99 })).clone().json()).session;
await addMember(CHAIR2, { telegramId: "4242", role: "admin", label: "Alex" });
const TABLE_ONLY = (await (await signIn({})).clone().json()).session;

await statusOf("the table-granted session administers while D1 answers",
  call("GET", "/membership", { headers: bearer(TABLE_ONLY) }), 200);

// Every other statement still works, so this is the membership read
// failing rather than the database being gone - which is the harder
// case and the one a fallback would quietly survive.
const brokenRoster = {
  ...env,
  DB: {
    ...DB,
    prepare: (sql) => (/FROM membership/i.test(sql)
      ? {
        bind: () => ({
          run: () => { throw new Error("D1_ERROR"); },
          first: () => { throw new Error("D1_ERROR"); },
          all: () => { throw new Error("D1_ERROR"); },
        }),
        run: () => { throw new Error("D1_ERROR"); },
        first: () => { throw new Error("D1_ERROR"); },
        all: () => { throw new Error("D1_ERROR"); },
      }
      : DB.prepare(sql)),
  },
};

await statusOf("a membership read that throws refuses the session it granted",
  call("GET", "/membership", { headers: bearer(TABLE_ONLY) }, brokenRoster),
  401);
await statusOf("and refuses it everywhere else too",
  call("GET", "/export", { headers: bearer(TABLE_ONLY) }, brokenRoster), 401);
await statusOf("the secret-side admin is unaffected, which is the dual-read",
  call("GET", "/export", { headers: bearer(CHAIR2) }, brokenRoster), 200);

const brokenSignIn = await (await signIn({}, brokenRoster)).clone().json();
check("and a sign-in that cannot read the table mints a member",
  brokenSignIn.isAdmin === false, `isAdmin=${brokenSignIn.isAdmin}`);

/*
 * The routes fail closed too, and not only the authority read.
 *
 * A caller whose adminness comes from the secret gets past the gate on a
 * database whose membership table throws, and then the handler's own
 * query is the thing that fails. Unhandled, that leaves the Worker with
 * a status and nothing else: no CORS headers, so a browser reports a
 * network error rather than a refusal, and no `{error}` body, so the
 * page has nothing to show. Every other refusal on this Worker is the
 * same shape, and a 500 is the one an admin is most likely to meet on a
 * bad day.
 *
 * The header list is compared against a real refusal rather than
 * asserted item by item, because "the same shape" is the claim and a
 * hand-written list would drift away from corsHeaders() silently.
 */
const shapeOf = async (res) => {
  // A body that is not JSON is reported rather than thrown, so a refusal
  // that answers a bare status fails this check instead of ending the
  // run - a crashed suite says less about which claim broke.
  let keys;
  try {
    keys = Object.keys(await res.clone().json());
  } catch (e) {
    keys = "no JSON body";
  }
  return JSON.stringify({
    cors: ["Access-Control-Allow-Origin", "Access-Control-Allow-Methods",
      "Access-Control-Allow-Headers", "Access-Control-Max-Age", "Vary",
      "Content-Type"].map((h) => res.headers.get(h)),
    keys: keys,
  });
};

const ordinaryRefusal = await shapeOf(
  await call("GET", "/membership", { headers: bearer("nobody") }));

const escaped = await call("GET", "/membership",
  { headers: bearer(CHAIR2) }, brokenRoster).catch((e) => e);
check("a D1 throw inside GET is answered rather than escaping the Worker",
  escaped instanceof Response && escaped.status === 500,
  escaped instanceof Response ? `${escaped.status}` : `threw ${escaped}`);
check("in the same shape every other refusal here has",
  escaped instanceof Response && (await shapeOf(escaped)) === ordinaryRefusal,
  escaped instanceof Response
    ? `${await shapeOf(escaped)} want ${ordinaryRefusal}` : "no response");

const escapedDelete = await call("DELETE", "/membership/admin/" + FIXTURE_4242,
  { headers: bearer(CHAIR2) }, brokenRoster).catch((e) => e);
check("and a D1 throw inside DELETE is answered the same way",
  escapedDelete instanceof Response && escapedDelete.status === 500 &&
  (await shapeOf(escapedDelete)) === ordinaryRefusal,
  escapedDelete instanceof Response
    ? `${escapedDelete.status} ${await shapeOf(escapedDelete)}` : "no response");

/*
 * The other two ways a read comes back wrong, armed separately from the
 * throw above. An absent `rows` and a `results` that is not a list both
 * reach the loop that walks the rows, and iterating either one throws -
 * so without the guards a database answering oddly turns every sign-in
 * into a 500 rather than into a session with no authority. The shapes
 * are asserted through sign-in because that is where the loop runs
 * before anything else can refuse.
 */
const answeredWith = (results) => ({
  ...env,
  DB: {
    ...DB,
    prepare: (sql) => (/FROM membership WHERE role = \?/i.test(sql)
      ? { bind: () => ({ all: async () => results }) }
      : DB.prepare(sql)),
  },
});

await statusOf("a membership read answering nothing still signs somebody in",
  signIn({}, answeredWith(undefined)), 200);
await statusOf("and so does one whose `results` is not a list at all",
  signIn({}, answeredWith({ results: { length: 1, 0: { account_id: "x" } } })),
  200);

/*
 * An unreadable row grants nothing either, and is dropped rather than
 * coerced.
 *
 * The third row is the one that makes this check worth running, and it
 * is why the guard tests `typeof` and not only the pattern:
 * RegExp.test() stringifies whatever it is handed, so a value that is
 * not a string but spells one passes a check written with the pattern
 * alone. The first two rows are the ordinary junk - and on their own
 * they prove nothing, because "null" and "not-an-account-id" are
 * perfectly good Set members that simply match nobody. A check that
 * only had those would pass whether the guard existed or not.
 */
const OUTSIDER = { id: 31337, username: "junk" };
const strangerId = (await (await call("GET", "/me",
  { headers: bearer(
    (await (await signIn(OUTSIDER)).clone().json()).session) })).json())
  .accountId;

roster.push({ account_id: null, role: "admin", label: "Broken",
  added_at: "", added_by: "" });
roster.push({ account_id: "not-an-account-id", role: "admin", label: "Broken",
  added_at: "", added_by: "" });
roster.push({ account_id: { toString: () => strangerId }, role: "admin",
  label: "Broken", added_at: "", added_by: "" });

const afterJunk = await (await signIn(OUTSIDER)).json();
check("a row this side cannot read grants nobody anything",
  afterJunk.isAdmin === false, `isAdmin=${afterJunk.isAdmin}`);

/* ------------------------------------------------------------------ */
/* Dual-read equivalence, and the signal that makes the flip takeable. */

/*
 * The three configurations that must answer identically while both arms
 * are live: the secret alone, the table alone, and both together. If
 * they ever diverge, the flip to table-only is not a migration but a
 * change of who administers - and the point of shipping dual-read
 * rather than table-only is that this is checkable before anybody's
 * authority moves.
 *
 * `secretOnly` is the live half of the same question. The secret holds
 * numeric ids and the table holds HMACs of them, so nobody can compare
 * the two by reading a dashboard - only the Worker holds ACCOUNT_SECRET
 * and can. An empty `secretOnly` is what says the backfill is complete
 * and the flip would take nobody's authority away.
 */
const secretOnly = { ...env, ADMIN_TELEGRAM_IDS: "99" };
const tableOnly = { ...env, ADMIN_TELEGRAM_IDS: "" };

const equivalent = [];
for (const [label, e, seed] of [
  ["the secret alone", secretOnly, false],
  ["the table alone", tableOnly, true],
  ["both at once", secretOnly, true],
]) {
  reset();
  if (seed) {
    // Seeded through the break-glass token, because with an empty
    // secret and an empty table there is no admin session to seed with
    // - which is the state a real backfill starts from.
    await call("POST", "/membership", { headers: bearer("sekrit-token-value"),
      body: JSON.stringify({ telegramId: "99", role: "admin", label: "Root" }) },
    e);
  }
  const who = await (await signIn({ id: 99, username: "root" }, e)).clone().json();
  const list = await call("GET", "/membership",
    { headers: bearer(who.session) }, e);
  equivalent.push([label, who.isAdmin, list.status].join(" "));
}
check("the secret alone, the table alone and both agree exactly",
  new Set(equivalent.map((a) => a.split(" ").slice(-2).join(" "))).size === 1,
  JSON.stringify(equivalent));

reset();
const AUDITOR = (await (await signIn({ id: 99 })).clone().json()).session;
const notYet = await (await call("GET", "/membership",
  { headers: bearer(AUDITOR) })).json();
check("an un-backfilled secret admin is named as one",
  Array.isArray(notYet.secretOnly) && notYet.secretOnly.length === 1,
  JSON.stringify(notYet.secretOnly));
check("and never as the numeric id it was derived from",
  !String(JSON.stringify(notYet.secretOnly)).includes("99"),
  JSON.stringify(notYet.secretOnly));

await quietly(() =>
  addMember(AUDITOR, { telegramId: "99", role: "admin", label: "Root" }));
const backfilled = await (await call("GET", "/membership",
  { headers: bearer(AUDITOR) })).json();
check("and once the row exists the list is empty, which is the go-signal",
  Array.isArray(backfilled.secretOnly) && backfilled.secretOnly.length === 0,
  JSON.stringify(backfilled.secretOnly));

/* ------------------------------------------------------------------ */
/* An admin changing their own row is recorded.                        */

/*
 * `added_by` answers who wrote a row that exists. A removal leaves no
 * row to carry it, and the removal worth recording most is an admin
 * taking their own authority away or handing themselves somebody
 * else's. So the record is a log line carrying account ids and nothing
 * else - the same HMAC already sitting in the clear in the table beside
 * it, never the numeric id, and never echoed back in a response where
 * anything holding the session could read it.
 */
reset();

const SELF = (await (await signIn({ id: 99 })).clone().json()).session;
const selfId = (await (await call("GET", "/me",
  { headers: bearer(SELF) })).json()).accountId;

const recorded = [];
const beforeLog = console.log;
console.log = (line) => recorded.push(String(line));
const selfWrite = await addMember(SELF,
  { telegramId: "99", role: "always_allow", label: "Root" });
const otherWrite = await addMember(SELF,
  { telegramId: "4242", role: "always_allow", label: "Alex" });
const selfBody = await selfWrite.clone().text();
console.log = beforeLog;

check("an admin adding their own row is recorded, by account id",
  recorded.length === 1 && recorded[0].includes(selfId),
  JSON.stringify(recorded));
check("a row about somebody else is not that record",
  !recorded.join("").includes(FIXTURE_4242) && otherWrite.status === 200,
  JSON.stringify(recorded));
check("and the record carries no numeric id",
  !recorded.join("").includes("\"99\"") && !recorded.join("").includes(":99"),
  JSON.stringify(recorded));
check("nor is any of it echoed back to the caller",
  selfBody === JSON.stringify({ ok: true }), selfBody);

report();
