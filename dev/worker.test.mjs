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

const SOURCE = fileURLToPath(new URL("../server/worker.js", import.meta.url));
const src = await readFile(SOURCE, "utf8");
const { default: worker } = await import(
  "data:text/javascript," + encodeURIComponent(src)
);

/*
 * A D1 binding that remembers what it was asked to store.
 *
 * It reads just enough of the SQL to tell the three tables apart,
 * because they behave differently in the ways that matter: snapshots
 * replaces rather than appends and is read with first(); sessions is
 * looked up by one key, swept by expiry, and has one row's deadline
 * moved forward when it is used; submissions appends, counts per
 * account, can lose a row, and answers the two lookups a correction is
 * checked against.
 *
 * A stub that ignored the statement entirely would let a publish that
 * appended a second row pass, and would let a delete that removed
 * everybody's rows pass too.
 */
let stored = [];
let sessions = [];
let snapshot = null;
let nextId = 1;

function reset() {
  stored = [];
  sessions = [];
  snapshot = null;
  nextId = 1;
}

const DB = {
  prepare: (sql) => {
    const table = /snapshots/i.test(sql) ? "snapshots"
      : /sessions/i.test(sql) ? "sessions"
      : "submissions";
    const verb = /^\s*(\w+)/.exec(sql)[1].toUpperCase();
    const counting = /COUNT\(\*\)/i.test(sql);

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
      if (/WHERE id = \? AND account_id = \?/i.test(sql)) {
        return stored.find(
          (r) => r.id === a[0] && r.account_id === a[1]) || null;
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

    return {
      bind: (...a) => ({
        run: () => exec(a),
        first: async () => read(a),
      }),
      // Statements with no parameters run straight off prepare().
      run: () => exec([]),
      first: async () => read([]),
      all: async () => ({ results: stored.map(project) }),
    };
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

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "pass" : "FAIL"}  ${label.padEnd(54)} ${detail}`);
}

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
  stored.length ? stored[0].account_id.slice(0, 20) + "…" : "no row");

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
  stored.length > 1 ? stored[1].account_id.slice(0, 20) + "…" : "no row");

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
  ["GET", "/whatever", ADMIN, 404],
];

for (const [method, path, token, want] of matrix) {
  const headers = token === null ? good : bearer(token);
  const body = method === "POST"
    ? JSON.stringify(path === "/submit"
      ? { ciphertext: "QUJDRA==" } : { snapshot: 1 })
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
  me.accountId ? me.accountId.slice(0, 20) + "…" : "absent");
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

const corrected = await (await call("GET", "/me",
  { headers: bearer(OWNER) })).json();
check("/me counts what this account currently claims, not rows written",
  corrected.entries === 2 && corrected.superseded === 1,
  `entries=${corrected.entries} superseded=${corrected.superseded}`);

/*
 * The tombstone is dated after the correction by hand here, which cannot
 * arise through the routes: a correction is always inserted after the
 * row it names. It is the only corpus that tells a last-submitted time
 * computed over current entries from one computed over every row, and
 * without it that clause would agree with a plain MAX on every input the
 * Worker can actually produce - an assertion that cannot fail.
 */
const realDate = tombstone.received_at;
tombstone.received_at = new Date(Date.now() + 60 * 1000).toISOString();
const dated = await (await call("GET", "/me",
  { headers: bearer(OWNER) })).json();
check("and the last-submitted time skips a tombstone the same way",
  dated.lastAt !== tombstone.received_at, `lastAt=${dated.lastAt}`);
tombstone.received_at = realDate;

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

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
