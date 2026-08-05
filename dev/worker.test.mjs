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
 * looked up by one key and swept by expiry; submissions appends, counts
 * per account, and can now lose a row.
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
          const cutoff = Date.parse(a[0]);
          sessions = sessions.filter((s) => Date.parse(s.expires_at) > cutoff);
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
        });
      }
      return {};
    };

    const read = (a) => {
      if (table === "snapshots") return snapshot;
      if (table === "sessions") {
        return sessions.find((s) => s.token_hash === a[0]) || null;
      }
      if (counting) {
        const mine = stored.filter((r) => r.account_id === a[0]);
        return {
          entries: mine.length,
          last_at: mine.length
            ? mine.map((r) => r.received_at).sort().pop() : null,
        };
      }
      return null;
    };

    return {
      bind: (...a) => ({
        run: () => exec(a),
        first: async () => read(a),
      }),
      // Statements with no parameters run straight off prepare().
      run: () => exec([]),
      first: async () => read([]),
      all: async () => ({ results: stored.slice() }),
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
check("an authorised DELETE takes the snapshot down", snapshot === null);
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

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
