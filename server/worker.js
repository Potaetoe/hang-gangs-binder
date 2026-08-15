/*
 * The storage endpoint. One Cloudflare Worker, one D1 database.
 *
 * The routes:
 *
 *   POST   /auth/telegram    verify a login payload, issue a session.
 *   POST   /auth/dev         development only; 404 everywhere else.
 *   DELETE /session          end the session presented, now.
 *   GET    /me               what this account has on record.
 *   GET    /my-entries       this account's own rows: an id, a receipt
 *                            time, whether something supersedes it, and
 *                            the sealed bytes as stored. Needs a member
 *                            session, because it needs an account.
 *   POST   /submit           append one row, optionally naming the row
 *                            it supersedes. Needs a member session.
 *   GET    /export           return every row. Admin.
 *   POST   /snapshot         replace the published aggregate. Admin.
 *   GET    /snapshot         return it. Members only since 2026-08-05 -
 *                            it still carries no handles and no rows,
 *                            because gating a document is not a reason
 *                            to relax what goes in it.
 *   DELETE /snapshot         take it down. Admin, and no key - see the
 *                            handler for why that matters.
 *   DELETE /submission/:id   remove one row. Admin.
 *   GET    /content          the site copy an admin has set. The one
 *                            route here that answers without a
 *                            credential - see handleReadContent.
 *   POST   /content          set one name. Admin.
 *   DELETE /content/:name    unset one, so the page shows the copy it
 *                            ships with again. Admin.
 *   GET    /membership       the admin and always-allow lists. Admin.
 *   POST   /membership       add one, or relabel one. Admin.
 *   DELETE /membership/:role/:accountId
 *                            remove one. Admin.
 *
 * It never decrypts, holds no key, and cannot read what it stores. The
 * first two routes move opaque base64 - see DESIGN.md, which explains
 * why the storage layer is untrusted on purpose.
 *
 * The snapshot is the exception that proves it: the Worker cannot
 * compute one, because computing it requires reading the submissions.
 * It is built in the keyholder's browser, where the plaintext already
 * is, and this endpoint only holds the result. That is what keeps a
 * daily public dashboard from requiring the private key to live here.
 *
 * Bindings expected (see server/README.md):
 *   DB                        D1 database binding
 *   TELEGRAM_BOT_TOKEN        secret, verifies every login payload
 *   ACCOUNT_SECRET            secret, the HMAC key behind every account
 *                             id. PERMANENT - changing it detaches every
 *                             member from their own history.
 *   ADMIN_TELEGRAM_IDS        secret, comma-separated numeric ids. One
 *                             of the two admin lists - the `membership`
 *                             table is the other, and adminAccountIds()
 *                             reads both. See handleReadMembership for
 *                             which way that migration runs.
 *   EXPORT_TOKEN              secret, break-glass admin access
 *   TELEGRAM_GROUP_CHAT_ID    secret, REQUIRED on any Worker that signs
 *                             people in: it names the group whose members
 *                             may sign in, and its absence fails closed -
 *                             groupStanding() returns "unknown" (deny), so
 *                             a Worker missing it admits nobody but the
 *                             break-glass ids below.
 *   ALWAYS_ALLOW_TELEGRAM_IDS secret, optional; ids that bypass the group
 *                             check, and the way back in when the group
 *                             check itself cannot answer - the bot removed
 *                             from the group, or the chat id unset. Beside
 *                             the table's `always_allow` rows, never
 *                             replaced by them - groupStanding() says
 *                             why this one keeps a secret arm for good.
 *   ALLOWED_ORIGINS           optional, comma-separated
 *   DEV_LOGIN_SECRET          DEVELOPMENT ONLY. Its absence is what
 *                             turns POST /auth/dev off. Never set this
 *                             on production.
 */

// The only origins allowed to call this. A submission from anywhere
// else is either a mistake or somebody else's copy of the form, and in
// both cases the row is noise in the export.
//
// This is a deployment fact, not a code fact: whoever inherits this
// project will serve the site from their own address, and having to
// edit and re-paste the Worker to say so is exactly the kind of chore
// that gets skipped or got wrong. Set ALLOWED_ORIGINS in the dashboard
// and this file never needs touching. The default below is what this
// deployment happens to use.
const DEFAULT_ORIGINS = [
  "https://potaetoe.github.io",
  "http://localhost:8124",
];

function allowedOrigins(env) {
  if (typeof env.ALLOWED_ORIGINS === "string" && env.ALLOWED_ORIGINS.trim()) {
    return env.ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  }
  return DEFAULT_ORIGINS;
}

// A submission is a base64 blob of a short record. 16 KB is far more
// than that and far less than anything worth storing by accident.
const MAX_CIPHERTEXT = 16 * 1024;

// How many rows one member's listing hands back, and why there is a
// number here at all.
//
// GET /my-entries carries the sealed bytes, so a listing is the largest
// response this Worker ever sends and its size is chosen by whoever has
// been submitting rather than by anything here. This bounds it: 500
// rows against MAX_CIPHERTEXT is roughly 8 MB in the worst case, and
// nine years of weekly entries in the realistic one, so nobody in this
// group reaches it by using the site as intended.
//
// It is a LITERAL in the statement rather than a bound parameter, and
// that is the load-bearing part: a cap D1 is told about is a cap on
// what D1 reads, and nothing on the wire can move it because there is
// nothing on the wire. Slicing the results instead would transfer
// everything and then throw some away, which is a cap in the only place
// it does not help.
//
// If a member ever does reach it their oldest rows are what they get,
// because ORDER BY is ascending and stable. The fix at that point is
// pagination, not a bigger number - and pagination is a parameter on
// this route, which is the property every scope argument here rests on
// not having.
const MAX_ENTRY_LISTING = 500;

// A snapshot is counts, medians and histogram bins, plus at most a
// dozen short weight histories. A few KB in practice; this is the
// ceiling that stops the route being a place to park a file.
const MAX_SNAPSHOT = 256 * 1024;

// A login payload is a handful of short fields. Anything larger is not
// one, and this route runs before any credential has been checked.
const MAX_AUTH_BODY = 4 * 1024;

/*
 * Site content: what a page's own HTML says, when an admin has said
 * something else. A value is a heading, a paragraph, a note - so the
 * ceiling is generous for copy and far below anything worth parking
 * here, and it is a cap on the stored value rather than on the request,
 * because this route runs behind an admin session and there is no
 * pre-credential body to bound the way POST /auth/telegram has.
 */
const MAX_CONTENT_VALUE = 8 * 1024;

/*
 * A content name addresses a slot a page reads; it is not prose and
 * nothing renders it. Lowercase, digits and three separators, bounded -
 * so a name is safe in a URL path without escaping, cannot collide with
 * another by case, and a page and an admin pane can agree on one by
 * spelling it.
 *
 * `name` rather than `key`: in this repository a key is a cryptographic
 * key, and this table holds neither one nor anything derived from one.
 */
const CONTENT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/*
 * The two membership lists, named as roles rather than as tables. The
 * set is closed here rather than accepted from the caller: an unknown
 * role stored would be a row that grants nothing and looks exactly like
 * one that does, which is the undetectable-wrong-value failure the
 * whole issue is about.
 */
const MEMBERSHIP_ROLES = ["admin", "always_allow"];

// A label is a nickname somebody types so the list can be read at all.
const MAX_LABEL = 64;

// An account id as this Worker writes one: SHA-256 HMAC, hex.
const ACCOUNT_ID = /^[0-9a-f]{64}$/;

// A Telegram numeric id, which is what an admin has to hand. Twenty
// digits is past anything Telegram issues and short of a number no
// string comparison should be asked to carry.
const TELEGRAM_ID = /^[0-9]{1,20}$/;

/*
 * How long a session lasts.
 *
 * A member's runs a week, because this is something people come back to
 * and update rather than fill in once - see DESIGN.md, "Sessions". An
 * admin's runs two hours, because an admin session fetches the entire
 * corpus's ciphertext and the difference in what is at stake is the
 * whole reason these are two numbers instead of one.
 *
 * Both are caps on a session that is being used. What bounds one that is
 * not is ADMIN_IDLE_MINUTES below, and only for an admin.
 */
const SESSION_HOURS = { member: 24 * 7, admin: 2 };

/*
 * How long an admin session may go unused before it stops working.
 *
 * apps/web/admin.html is the only place in this system where the whole
 * corpus exists in the clear, and the two-hour cap above runs whether
 * anybody is at the machine or not - so the tab left open on a decrypted
 * corpus is what this cuts, from two hours to a quarter of one
 * (ASD STIG V-222390, #91).
 *
 * Fifteen minutes rather than the STIG's ten for a privileged session,
 * because what this side can measure is requests and not attention: the
 * admin page decrypts once and is then read with nothing crossing the
 * wire, so a window tight enough to be an attention timer would end the
 * session in the middle of a read. The timer that can see real
 * interaction belongs on the page; this is the backstop for the case
 * where the page never gets to run it - the tab killed, the browser
 * gone, the token captured. Any authenticated request slides this
 * window, so that timer needs no route added here to hold it open.
 *
 * Member sessions have no window, deliberately, and the decision stands
 * on two legs rather than one. A member session appends rows for one
 * account and reads a document carrying no handles and no rows, so
 * there is no plaintext corpus behind it to leave on a screen; and the
 * measurable thing here is requests, while somebody filling in
 * apps/web/your-page.html sends none until they submit. A window short
 * enough to behave like an attention timer therefore signs a member out
 * mid-entry, and nothing in apps/web polls to hold one open - so the
 * failure mode is losing what they typed, for a session that had no
 * corpus behind it to protect. DESIGN.md, "Sessions", records that as a
 * decision (V-222389).
 *
 * That leaves the member cap in SESSION_HOURS bounding a second thing
 * besides the lifetime, which is where a reader should go next:
 * revokeAccountSessions() below states the residual the cap is the only
 * bound on, and why a window here would not close it.
 */
const ADMIN_IDLE_MINUTES = 15;

// Telegram signs the moment you pressed the button. A payload older
// than this is refused, which is what stops a captured one being a
// permanent credential - nothing else in it expires. Telegram's own
// guidance allows a day; the page posts it the instant it arrives, so
// five minutes is enough and the difference is the window in which a
// stolen payload is worth anything.
const AUTH_FRESHNESS_SECONDS = 300;

// Being in the group, as Telegram spells it. `restricted` is still a
// member unless it says otherwise, which is why it cannot simply be
// tested for equality.
const MEMBER_STATUSES = ["creator", "administrator", "member", "restricted"];

/*
 * Being gone from it, as Telegram spells that - and this list is NOT the
 * complement of the one above.
 *
 * Telegram's ChatMember carries six statuses; these are the two that
 * mean departed, and `restricted` with `is_member: false` is a third way
 * of saying it that lives in groupStanding() because reading it takes
 * two fields. Anything outside both lists is a status this Worker has
 * never been taught: a reason to refuse, and deliberately not a reason
 * to believe somebody left. Written as "not a member status" instead,
 * every status Telegram ever invents would arrive here as a revocation.
 */
const LEFT_STATUSES = ["left", "kicked"];

const encoder = new TextEncoder();

function hex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(text) {
  return crypto.subtle.digest("SHA-256", encoder.encode(text));
}

async function sha256Hex(text) {
  return hex(await sha256(text));
}

/*
 * HMAC-SHA256, hex. `key` is either a string or the raw bytes of one -
 * Telegram's scheme uses the SHA-256 *digest* of the bot token as the
 * key rather than the token itself, so both forms are needed.
 */
async function hmacHex(key, message) {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const imported = await crypto.subtle.importKey(
    "raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC", imported, encoder.encode(message)
  );
  return hex(signature);
}

/*
 * The account id: an HMAC of the Telegram numeric id under a secret only
 * this Worker holds.
 *
 * Every part of that sentence is load-bearing and DESIGN.md, "The
 * identifier is the whole problem", spends most of its length on why.
 * The short version: a plain hash of a handle would let anyone holding
 * this database test a guess, and the guesses are the few dozen names in
 * a group's member list. The secret is what makes that impossible.
 *
 * The numeric id rather than the handle, because handles change and ids
 * do not - an account should survive somebody renaming themselves.
 *
 * ACCOUNT_SECRET can never change once a row carries an id derived from
 * it. It looks like configuration and is actually part of the stored
 * format, in the same way crypto.js's derivation label is.
 */
async function accountIdFor(env, subject) {
  return hmacHex(env.ACCOUNT_SECRET, String(subject));
}

function idList(value) {
  return typeof value === "string"
    ? value.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
}

/*
 * The admins named by the secret, as account ids rather than Telegram
 * ids.
 *
 * HMACing the configured ids is what makes them comparable to anything
 * else here: a session row carries an account id, and so does a
 * `membership` row, and both are the HMAC of a numeric id under
 * ACCOUNT_SECRET. Nothing new is stored and no identity is written down
 * - both sides of every comparison are values this Worker already had,
 * and the answer lives for one request.
 *
 * Separate from adminAccountIds() below because the migration needs to
 * ask this half on its own: handleReadMembership answers "which admins
 * does the secret grant that the table has not been told about", and
 * that question has no answer if the two arms are only ever unioned.
 */
async function secretAdminAccountIds(env) {
  const ids = idList(env.ADMIN_TELEGRAM_IDS);
  return new Set(await Promise.all(ids.map((id) => accountIdFor(env, id))));
}

/*
 * Whether this Worker honors a `membership` row at all.
 *
 * ONE HOME FOR THE TEST, because two places ask it and they must never
 * disagree: the authority read below decides who a row grants anything
 * to, and handleReadMembership decides which list to show it in. A row
 * counted as a grant by one and a dud by the other would put an admin
 * in front of a list that does not describe the authority they have.
 *
 * The typeof half is load-bearing beside the pattern, not belt and
 * braces. RegExp.test() stringifies whatever it is handed, so a value
 * that is not a string but spells one passes a check written with the
 * pattern alone - and String(undefined) is "undefined", a perfectly
 * good Set member that matches nobody.
 */
function grantsAnything(row) {
  return Boolean(row) && typeof row.account_id === "string" &&
    ACCOUNT_ID.test(row.account_id);
}

/*
 * The same question, asked of SQLite instead of of a row.
 *
 * A SECOND SPELLING IS UNAVOIDABLE, and this sits against the first so
 * that neither can be read without the other. Every read that decides
 * anything asks grantsAnything() in JavaScript; the last-admin guard
 * cannot, because it has to be one statement to be atomic, and a count
 * the Worker reads first is the race that guard exists to close. So the
 * predicate is written twice and the two spellings must agree about
 * every row, or the guard would protect a set the authority read does
 * not honor.
 *
 * `length() = 64` beside a negated GLOB rather than a pattern spelling
 * sixty-four characters out: GLOB has no repetition count, and it is
 * case-sensitive where LIKE is not - so "sixty-four characters, none of
 * them outside 0-9a-f" is how /^[0-9a-f]{64}$/ is said here. Upper-case
 * hex is exactly what `wrangler d1 execute` writes and exactly what
 * this has to refuse.
 *
 * NULL and non-text answer NULL rather than true, which a WHERE reads
 * as false - the same fail-closed direction the typeof half carries
 * above, for the same reason.
 */
function grantsAnythingSql(column) {
  return "length(" + column + ") = 64 AND " +
    column + " NOT GLOB '*[^0-9a-f]*'";
}

/*
 * The account ids the `membership` table grants one role.
 *
 * FAILS CLOSED IN EVERY DIRECTION A READ CAN GO WRONG, which is the
 * whole of this function's design now that a row is a grant: a thrown
 * query, a missing `results`, a shape that is not an array, a row whose
 * account id is not one - each gives the empty set rather than a partial
 * answer or a permissive default. An error swallowed into "assume they
 * are an admin" is the failure nothing else here would catch, because it
 * looks exactly like a working list on a working database.
 *
 * An unreadable row is dropped rather than coerced, by grantsAnything()
 * above. The near-miss it refuses reads as a working list right up until
 * somebody cannot get in - the undetectable-wrong-value failure #69
 * opens with, arriving through the back door.
 */
async function membershipAccountIds(env, role) {
  const ids = new Set();
  let rows;
  try {
    rows = await env.DB.prepare(
      "SELECT account_id FROM membership WHERE role = ?"
    ).bind(role).all();
  } catch (e) {
    return ids;
  }
  if (!rows || !Array.isArray(rows.results)) return ids;
  for (const row of rows.results) {
    if (grantsAnything(row)) ids.add(row.account_id);
  }
  return ids;
}

/*
 * Who administers: the secret OR the table, both live.
 *
 * This is the dual-read posture #69 asked for, and it is deliberately
 * the shipped state rather than a step passed through. Flipping to
 * table-only before a backfill would take authority away from every
 * admin the secret names and the table does not, so the order is
 * dual-read, verify, flip - and what makes the middle step possible is
 * handleReadMembership's `secretOnly`, which is the only place the two
 * arms can be compared at all: the secret holds numeric ids and the
 * table holds HMACs of them, so nothing outside this Worker can line
 * them up.
 *
 * Whatever the flip does, the founding admin stays in the secret
 * (DESIGN.md, "Admin accounts and deletion"). A table that could rewrite
 * the whole list leaves no root of trust outside itself.
 *
 * Recomputed per request on purpose. A cache would be a copy of the
 * admin list living somewhere other than the two places that own it,
 * which is precisely the stale-admin bug this function exists to remove
 * - and it is what makes removing a row take effect on the next request
 * rather than whenever a session happens to expire.
 */
async function adminAccountIds(env) {
  const ids = await secretAdminAccountIds(env);
  for (const id of await membershipAccountIds(env, "admin")) ids.add(id);
  return ids;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign(
      { "Content-Type": "application/json" },
      origin ? corsHeaders(origin) : {}
    ),
  });
}

/*
 * Constant-time-ish comparison. Worth doing even though the realistic
 * attack on a token this size is guessing rather than timing.
 */
function tokenMatches(given, expected) {
  // An unset secret is not a match with anything, including "". Every
  // caller already guards this - `Boolean(env.EXPORT_TOKEN)` and the
  // DEV_LOGIN_SECRET check both refuse before getting here - but a
  // comparison that throws when the secret is missing turns a forgotten
  // guard into a crash rather than a refusal, and a crash is a worse
  // way to find out. Found by mutation testing on 2026-08-05, which
  // removed one of those guards and got a TypeError instead of a 404.
  if (typeof given !== "string" || typeof expected !== "string") return false;
  if (!expected || given.length !== expected.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/*
 * Telegram's login signature, verified exactly.
 *
 * Every field except `hash`, sorted by key, joined `key=value` with
 * newlines; HMAC-SHA256 of that under the SHA-256 digest of the bot
 * token. Implemented to the letter or it verifies nothing at all, which
 * is the failure that looks like success.
 *
 * Returns the payload on success and null on any failure, so a caller
 * cannot accidentally treat "could not verify" as a user.
 */
async function verifyTelegramPayload(payload, botToken) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.hash !== "string") return null;
  if (!botToken) return null;

  const fields = Object.keys(payload)
    .filter((key) => key !== "hash")
    .sort()
    .map((key) => key + "=" + payload[key])
    .join("\n");

  const expected = await hmacHex(await sha256(botToken), fields);
  if (!tokenMatches(payload.hash.toLowerCase(), expected)) return null;

  // Freshness. Without this a captured payload never expires.
  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate)) return null;
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age > AUTH_FRESHNESS_SECONDS || age < -60) return null;

  return payload;
}

/*
 * Where this person stands with the group, in three answers rather than
 * two.
 *
 * The widget proves somebody has a Telegram account; it says nothing
 * about whether they are one of yours. This is what makes the binder
 * private to the group rather than private to whoever finds the URL.
 *
 * THREE answers, because two of them are refusals that must not be acted
 * on the same way. "left" is Telegram saying this person is gone.
 * "unknown" is Telegram not saying anything this side can read - the call
 * failed, the API answered `ok: false`, the status is one nobody here has
 * taught it. Both refuse a sign-in and always have; only "left" is
 * evidence of anything, and handleTelegramAuth is the one place the
 * difference is spent. Collapsing the two back into one boolean is what
 * turns a Telegram outage into a mass sign-out, which is why they are
 * named rather than counted.
 *
 * The refusal posture is unchanged by that split and has to stay so:
 * anything that is not "member" refuses, exactly as before.
 * dev/worker.test.mjs asserts all four unknown shapes as refusals and
 * asserted them before this split existed.
 *
 * The always-allow list passes regardless, and is not merely a
 * convenience: if the bot is ever removed from the group this call
 * starts refusing everybody, and that list is the way back in.
 *
 * Both arms, and the asymmetry with the admin list is the point.
 * ALWAYS_ALLOW_TELEGRAM_IDS is NOT being migrated to the table and no
 * flip is coming for it: it is the break-glass for the case where the
 * group check itself has failed, so it has to keep working when the
 * database is the thing that is wrong. The table arm is an addition
 * beside it - what makes the list manageable from an admin page - and
 * never a replacement for it.
 *
 * The secret arm is checked first and by numeric id, so it needs no
 * HMAC and no read: that is the arm that must survive a Worker that
 * cannot reach D1 at all. Both allow arms and the unconfigured arm below
 * answer before the URL is built, which is also what keeps a Worker
 * holding no bot token from ever interpolating one.
 *
 * Unconfigured - no chat id - FAILS CLOSED: the check cannot be made, so
 * it admits nobody. Returning "member" here (the pre-0.9 shape) turned a
 * forgotten TELEGRAM_GROUP_CHAT_ID into an open door for every valid
 * Telegram identity - a security-sensitive membership config missing is
 * exactly the case that must deny rather than default open. The two
 * allow arms above are the documented way into a misconfigured deploy
 * and are checked first for that reason. A Worker that legitimately does
 * no Telegram sign-in (the development one) carries no bot token, so
 * verifyTelegramPayload refuses ahead of this call and it is never
 * reached; the mandatory-config story is server/wrangler.toml and
 * OPERATIONS.md, which name the chat id as required.
 */
async function groupStanding(env, userId) {
  if (idList(env.ALWAYS_ALLOW_TELEGRAM_IDS).includes(String(userId))) {
    return "member";
  }
  if ((await membershipAccountIds(env, "always_allow"))
    .has(await accountIdFor(env, userId))) {
    return "member";
  }
  if (!env.TELEGRAM_GROUP_CHAT_ID) return "unknown";

  const url = "https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN +
    "/getChatMember?chat_id=" +
    encodeURIComponent(env.TELEGRAM_GROUP_CHAT_ID) +
    "&user_id=" + encodeURIComponent(String(userId));

  let body;
  try {
    body = await (await fetch(url)).json();
  } catch (e) {
    // Unreachable Telegram is not a reason to let people in, and not
    // evidence that anybody left either. `e` is discarded rather than
    // reported: the bot token is interpolated into the URL above, and a
    // fetch failure names the URL it failed on.
    return "unknown";
  }
  if (!body || body.ok !== true || !body.result) return "unknown";
  const status = body.result.status;
  if (MEMBER_STATUSES.includes(status)) {
    // A restricted member who has actually left says so here.
    return status === "restricted" && body.result.is_member === false
      ? "left" : "member";
  }
  return LEFT_STATUSES.includes(status) ? "left" : "unknown";
}

/*
 * End every session one account holds.
 *
 * The lever behind #136, and it fires from exactly one place -
 * handleTelegramAuth, when Telegram has definitively said this person is
 * no longer in the group. NOT from sessionFor(), which cannot ask the
 * question at all: a session row carries `account_id`, the HMAC of a
 * Telegram numeric id, and getChatMember needs the numeric id itself.
 * Storing that beside the session is what a per-request re-check would
 * cost, and server/schema.sql states the account-id-never-the-numeric-id
 * rule as a prohibition rather than a preference. So the bound is:
 *
 *   a leaver's session ends at their NEXT SIGN-IN ATTEMPT, or at natural
 *   expiry, whichever comes first.
 *
 * The residual is a leaver who never attempts again, bounded by the
 * member cap in SESSION_HOURS and by nothing here. It is not an attack
 * surface: the only way to reach this line for an account is to present
 * a payload HMAC-signed under the bot token for that account's numeric
 * id, which is that account's own sign-in. A stolen session token cannot
 * forge one, so nobody can revoke anybody but themselves.
 *
 * An idle window on member sessions is the obvious thing to reach for
 * against that residual, and it half-bounds it. A window ends the
 * session nobody is touching; a leaver who keeps using theirs slides it
 * out again on every request, all the way to the cap - so the half a
 * window closes is the half the cap already closes on its own, and the
 * half where somebody is actively using a credential they should not
 * have is the half it cannot reach. The bound is therefore stated here
 * rather than shortened, and ADMIN_IDLE_MINUTES carries what a member
 * window would cost besides. dev/worker.test.mjs pins both this
 * residual and the no-window decision as assertions, so shortening
 * either breaks the suite instead of passing quietly.
 *
 * By account id and never by token, because the point is every session
 * that account holds - a leaver with three tabs open is three rows.
 */
async function revokeAccountSessions(env, accountId) {
  await env.DB.prepare("DELETE FROM sessions WHERE account_id = ?")
    .bind(accountId).run();
}

/*
 * When a session dies, in two answers that are not the same answer.
 *
 * absoluteExpiry() is the cap measured from sign-in and never moves.
 * deadlineAt() is what the row carries: the cap for a member, and for an
 * admin whichever comes first, the cap or the idle window measured from
 * `now`. Every write of `expires_at` goes through deadlineAt(), which is
 * what makes the cap un-slideable - a slide that forgot the Math.min
 * would renew an admin session a quarter of an hour at a time, forever,
 * and nothing else in this file would notice.
 */
function absoluteExpiry(createdAt, isAdmin) {
  const hours = isAdmin ? SESSION_HOURS.admin : SESSION_HOURS.member;
  return createdAt + hours * 3600 * 1000;
}

function deadlineAt(createdAt, isAdmin, now) {
  const absolute = absoluteExpiry(createdAt, isAdmin);
  if (!isAdmin) return absolute;
  return Math.min(absolute, now + ADMIN_IDLE_MINUTES * 60 * 1000);
}

/*
 * A session is 32 random bytes. The database stores only its SHA-256, so
 * reading the sessions table yields nothing that can be used as one -
 * the same reasoning that keeps plaintext out of `submissions`, applied
 * to a much smaller secret.
 *
 * The row gets the deadline and the caller is told the cap, and the two
 * differ for an admin on purpose. apps/web/session.js keeps `expiresAt`
 * for the life of the tab and never rewrites it, so handing it the idle
 * window would drop an admin's own tab a quarter of an hour after
 * sign-in however busy they had been - a client-side timeout nobody
 * specified, arriving through the wrong value. The row is where the
 * window is enforced, and sessionFor() is what enforces it.
 */
async function issueSession(env, accountId, isAdmin, isDev) {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const token = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const now = Date.now();
  const expires = new Date(absoluteExpiry(now, isAdmin));

  await env.DB.prepare(
    "INSERT INTO sessions " +
    "(token_hash, account_id, is_admin, is_dev, created_at, expires_at) " +
    "VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(await sha256Hex(token), accountId, isAdmin ? 1 : 0, isDev ? 1 : 0,
      new Date(now).toISOString(),
      new Date(deadlineAt(now, isAdmin, now)).toISOString())
    .run();

  return { token: token, expiresAt: expires.toISOString() };
}

/*
 * Expired rows are cleared when one is looked up rather than by a
 * scheduled job. The ordinary failure of a scheduled job is silence, and
 * there is nothing here worth a moving part.
 *
 * Using an admin session is also what resets its idle window, and the
 * row this already read is where that is recorded. A write per request
 * on a row that was going to be read anyway is the small version; a
 * `last_used_at` column would need a second sweep predicate beside the
 * one above, which is a moving part rather than fewer of them. Only
 * admin rows are written, so the cost is bounded by admin traffic.
 *
 * The stored flag decides whether the window applies, not the re-read
 * below it: this row was handed the whole corpus's ciphertext once, and
 * taking its owner off the admin list does not un-hand it. Reading the
 * re-read instead would give a demoted session the longer deadline,
 * which is the wrong direction for a demotion.
 *
 * The admin flag is re-checked here rather than trusted from the row,
 * and the re-check reads BOTH the secret and the `membership` table.
 * The row says what was true at sign-in, and the question every caller
 * below is actually asking is whether it is true now: without this,
 * removing somebody's admin row does nothing for up to two hours and
 * nothing can force it sooner. That is the whole reason the table is
 * read per request rather than cached - an admin taken off the list
 * keeps whatever ciphertext they already hold, so the lever that stops
 * the NEXT request is the only lever there is.
 *
 * The stored flag stays a necessary condition - a member session cannot
 * be promoted by an edit to either list, which would be a promotion
 * nobody signed in for, arriving on a session bounded for a member's
 * seven days rather than an admin's two hours - and the lists are what
 * turn it off.
 *
 * Demotion is not revocation. A session that stops being an admin
 * session keeps working as the member session it also is; the person is
 * still in the group. Ending a session is DELETE /session.
 *
 * A development session is exempt, because its adminness never came from
 * either list: a "dev:"-namespaced account id cannot be a numeric id's
 * HMAC, so checking it there would drop every dev admin instantly. What
 * minted it was DEV_LOGIN_SECRET, so that is what is re-read for it -
 * the same "must be SET" shape handleDevAuth uses, so turning the dev
 * login off also drops the sessions it issued. What that exemption does
 * NOT buy is the authority to write an admin row; see the router.
 */
async function sessionFor(env, token) {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT account_id, is_admin, is_dev, created_at, expires_at " +
    "FROM sessions WHERE token_hash = ?"
  ).bind(tokenHash).first();

  if (!row) return null;
  const now = Date.now();
  // One reading of the clock for the refusal, the sweep and the slide.
  // Three would let a row be live for the check and expired for the
  // write, which is a whole class of answer that cannot be reproduced.
  //
  // A deadline must be FINITE and in the future. An unparseable expires_at
  // is Date.parse() -> NaN, and `NaN <= now` is false, so testing expiry
  // alone read a row whose deadline could not be parsed as "not yet
  // expired" and served it forever - a malformed session accepted as live.
  // The finite check refuses it, and it is deleted by its own hash rather
  // than by the expiry sweep below: that sweep compares expires_at as
  // text, and a non-date string does not fall under a `<=` against an ISO
  // timestamp, so it would leave the bad row in place to be served again.
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt)) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(tokenHash).run();
    return null;
  }
  if (expiresAt <= now) {
    await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .bind(new Date(now).toISOString()).run();
    return null;
  }

  if (row.is_admin === 1) {
    // An unparseable created_at falls back to `now`, which yields the
    // idle window and never more than it. Unguarded this is
    // new Date(NaN).toISOString(), which throws - so one unreadable row
    // would turn every admin request into a 500 rather than into a
    // shorter session. The same failing-closed shape tokenMatches()
    // carries for an unset secret.
    const created = Date.parse(row.created_at);
    await env.DB.prepare(
      "UPDATE sessions SET expires_at = ? WHERE token_hash = ?"
    ).bind(
      new Date(deadlineAt(
        Number.isFinite(created) ? created : now, true, now)).toISOString(),
      tokenHash
    ).run();
  }

  const isDev = row.is_dev === 1;
  let isAdmin = row.is_admin === 1;
  if (isAdmin) {
    isAdmin = isDev
      ? Boolean(env.DEV_LOGIN_SECRET)
      : (await adminAccountIds(env)).has(row.account_id);
  }

  return {
    accountId: row.account_id,
    isAdmin: isAdmin,
    isDev: isDev,
  };
}

// Shared with handleRevokeSession, which needs the raw token rather
// than the caller it resolves to - a session is ended by hashing the
// string presented, and there is nowhere else to get it from.
function bearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

/*
 * Who is calling, if anyone.
 *
 * Two kinds of bearer token arrive on the same header and are resolved
 * in a fixed order. EXPORT_TOKEN is break-glass - it is what gets a
 * keyholder to their own data when the pages or Telegram are
 * unreachable - and it is checked first because it is a fixed string no
 * issued session can collide with. Everything else is a session.
 *
 * Boolean(env.EXPORT_TOKEN) is deliberate: a Worker with no secret set
 * must refuse everybody rather than accept an empty string.
 */
async function callerFor(request, env) {
  const given = bearerToken(request);
  if (!given) return null;

  if (env.EXPORT_TOKEN && tokenMatches(given, env.EXPORT_TOKEN)) {
    return { accountId: null, isAdmin: true, isDev: false, breakGlass: true };
  }
  return sessionFor(env, given);
}

function unauthorized(origin) {
  return json({ error: "Not authorized." }, 401, origin);
}

/*
 * Signing in.
 *
 * The username is handed back to the page, which puts it in the record
 * before encrypting. That does NOT make it trustworthy - the record is
 * sealed in the member's own browser and they can write whatever they
 * like into it. The account id is the identity that cannot be forged;
 * the handle is a label. See DESIGN.md, "The identifier is the whole
 * problem".
 */
async function handleTelegramAuth(request, env, origin) {
  const body = await request.text();
  if (body.length > MAX_AUTH_BODY) {
    return json({ error: "Payload too large." }, 413, origin);
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (e) {
    return json({ error: "Body must be JSON." }, 400, origin);
  }

  const user = await verifyTelegramPayload(payload, env.TELEGRAM_BOT_TOKEN);
  if (!user) {
    return json({ error: "That sign-in could not be verified." }, 401, origin);
  }

  // A Telegram account without a username has no handle to record, and
  // this binder identifies people by handle - so it says which thing to
  // go and fix rather than storing a blank.
  if (!user.username) {
    return json({
      error: "Your Telegram account has no username. This binder " +
        "identifies people by @username, so set one in Telegram's " +
        "settings and sign in again.",
    }, 403, origin);
  }

  /*
   * The group check, and the one place its three-way answer is spent.
   *
   * A definitive departure also ends whatever sessions this account is
   * still holding. Sign-in is the only moment the numeric id is in hand,
   * so it is the only moment the question can be asked - the bound that
   * follows from that is written out on revokeAccountSessions().
   *
   * "unknown" refuses and revokes nothing, which is the difference the
   * three-way answer exists to carry. An unreachable Telegram is not
   * evidence that anybody left, and spending it as though it were would
   * make one outage plus one sign-in attempt sign a member out of a
   * session they still legitimately hold.
   *
   * The refusal is one message for all three answers on purpose. Telling
   * "you left" apart from "we could not ask" would report the state of
   * this deployment's Telegram integration to anybody with a signed
   * payload, and neither answer changes what the caller should do.
   */
  const standing = await groupStanding(env, user.id);
  if (standing !== "member") {
    if (standing === "left") {
      await revokeAccountSessions(env, await accountIdFor(env, user.id));
    }
    return json({
      error: "This binder is for members of the group only.",
    }, 403, origin);
  }

  const accountId = await accountIdFor(env, user.id);
  // Both arms, through the one function that unions them. Minting from
  // the secret alone here while sessionFor() re-checks both would hand a
  // table-only admin a member session that could never become an admin
  // one: the stored flag is a necessary condition and nothing would ever
  // set it.
  const isAdmin = (await adminAccountIds(env)).has(accountId);
  const session = await issueSession(env, accountId, isAdmin, false);

  return json({
    ok: true,
    session: session.token,
    expiresAt: session.expiresAt,
    username: String(user.username).toLowerCase(),
    isAdmin: isAdmin,
    isDev: false,
    // Returned so a first-time admin can read their own id off the page
    // and put it in ADMIN_TELEGRAM_IDS, rather than guessing at it or
    // asking a third-party bot. It is their own id and nobody else's.
    telegramId: String(user.id),
  }, 200, origin);
}

/*
 * Signing in locally, and the one deliberate hole in all of this.
 *
 * The login widget is bound to one domain and Telegram will not accept
 * localhost, so a development environment cannot mint a member session
 * the ordinary way. Rather than let local work stop at the session
 * boundary, this exists - and because it is a hole in the boundary that
 * now enforces everything, the whole of its design is which way it
 * fails.
 *
 * Four conditions, every one failing closed:
 *
 *   1. DEV_LOGIN_SECRET must be SET. Absent, the route does not exist.
 *      This is the same shape as Boolean(env.EXPORT_TOKEN) above, and a
 *      guard written the other way up is the entire risk in one line.
 *   2. The caller presents it, compared the same constant-time way.
 *   3. The Origin must be loopback. Positive matching rather than a deny
 *      list, so this route never has to know what production is and
 *      therefore cannot be wrong about it.
 *   4. Anything else is a 404, not a 401. A production deployment does
 *      not advertise a route it will not serve.
 *
 * dev/worker.test.mjs asserts 1 and 3 directly. Those are the most
 * important assertions in that file: the others protect the data, and
 * these protect the boundary that protects the data.
 */
function isLoopback(origin) {
  return /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin || "");
}

async function handleDevAuth(request, env, origin) {
  const missing = json({ error: "Not found." }, 404, origin);
  if (!env.DEV_LOGIN_SECRET) return missing;
  if (!isLoopback(origin)) return missing;

  const body = await request.text();
  if (body.length > MAX_AUTH_BODY) return missing;

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (e) {
    return missing;
  }
  if (typeof payload.secret !== "string") return missing;
  if (!tokenMatches(payload.secret, env.DEV_LOGIN_SECRET)) return missing;

  const subject = String(payload.subject || "").trim();
  if (!subject) {
    return json({ error: "A subject is needed." }, 400, origin);
  }

  // "dev:" is namespacing rather than decoration. A real account id
  // derives from a numeric Telegram id, so a prefixed subject can never
  // collide with one even if the two environments were somehow handed
  // the same ACCOUNT_SECRET.
  const accountId = await accountIdFor(env, "dev:" + subject);
  const isAdmin = payload.admin === true;
  const session = await issueSession(env, accountId, isAdmin, true);

  return json({
    ok: true,
    session: session.token,
    expiresAt: session.expiresAt,
    username: subject.toLowerCase(),
    isAdmin: isAdmin,
    isDev: true,
    telegramId: null,
  }, 200, origin);
}

/*
 * Ending a session, now.
 *
 * A page dropping its copy of the token is not the end of a session -
 * the row is, and without this route the row survives to its natural
 * expiry, seven days for a member. A token captured before sign-out
 * therefore stays a working credential for all of it, and that window is
 * exactly what somebody pressing Sign out is trying to close. Closing it
 * needs the row gone, which only the endpoint can do.
 *
 * Authenticated by the token it destroys, so it grants no new authority
 * and needs no new one: presenting a session is the only proof of
 * ownership a session has. The routing above hands this only a caller
 * that resolved to a live row, which is what keeps this DELETE from
 * being reachable with a string somebody made up.
 *
 * It deletes by token hash and by nothing else. There is no route here
 * that ends anybody else's session, deliberately: a route taking an
 * account id would be an admin capability nothing needs, and answering
 * differently for an id that has sessions than for one that does not is
 * the membership oracle the whole account design exists to prevent.
 * Removing an admin is handled where it belongs - sessionFor() re-reads
 * the list, so delisting an id takes effect on that session's next
 * request without anybody having to reach for a button.
 */
async function handleRevokeSession(request, env, origin) {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(await sha256Hex(bearerToken(request))).run();

  return json({ ok: true }, 200, origin);
}

// A row is superseded when another row OF THE SAME ACCOUNT names it.
//
// The account clause is not a second copy of handleSubmit's ownership
// rule, and reading it as one is what left it off. That rule decides who
// may WRITE a pointer; this one decides whose rows an account's own count
// is computed from, and the second question needs an answer even where
// the first one's enforcement is not the reason it has one. POST is not
// the only door into this table - `wrangler d1 execute` validates nothing
// and is how the schema, every backup and every restore are applied, and
// an ACCOUNT_SECRET rotation renames every account in the clear column
// while leaving these pointers untouched. Unscoped, a single row the
// member cannot see and did not write makes their entry vanish from
// their own panel.
const SUPERSEDED =
  "EXISTS (SELECT 1 FROM submissions AS newer " +
  "WHERE newer.supersedes = mine.id " +
  "AND newer.account_id = mine.account_id)";

/*
 * What this account has on record. Counts and dates, never contents -
 * the Worker could not read the contents if it wanted to.
 *
 * isDev travels with it so the page can say out loud that it is running
 * on a development session. One that looks like a real session is worse
 * than no development session at all.
 *
 * accountId is returned so the page can tell whose device-local data it
 * is looking at - #56. It is safe to hand over and safe for the browser
 * to keep, and both halves of that matter:
 *
 *   - It is an HMAC under ACCOUNT_SECRET, so somebody who reads it out
 *     of another member's browser cannot work back to a Telegram id, and
 *     cannot confirm a guessed handle by recomputing it. That is exactly
 *     what a username, or a bare hash of one, would have allowed in a
 *     group this small.
 *   - It authorizes nothing. Every request is gated on the session
 *     token, and handleSubmit takes account_id from the session and
 *     never from the body, so a stolen account id opens no door.
 *
 * A break-glass EXPORT_TOKEN caller has no account and gets null,
 * reported rather than special-cased. See DESIGN.md, "The prefill is
 * scoped to the account".
 *
 * `entries` is what this account currently claims rather than how many
 * rows it has written. A correction supersedes a row, so a member who
 * corrects twice would otherwise be told they have five entries for
 * three measurements - and the panel that exists to reassure them would
 * read as the correction not having worked. That is the count a pointer
 * inside the ciphertext could never produce, and half of why the pointer
 * is a clear column.
 *
 * The tombstones are reported beside it rather than subtracted in
 * silence. A count that does not move looks the same whether a
 * correction landed or was refused, and `entries + superseded` is still
 * every row this account has written.
 *
 * `lastAt` counts tombstones, and is the one field here that does. It
 * answers when this account last sent something, and a correction is
 * something sent - so the two questions have the same answer on every
 * corpus this Worker can produce anyway: `received_at` is taken from
 * this side's clock at the insert, a correction is always inserted after
 * the row it names, and the newest row therefore can never be one that
 * something else supersedes.
 */
async function handleMe(request, env, origin, caller) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS total, " +
    "SUM(CASE WHEN " + SUPERSEDED + " THEN 1 ELSE 0 END) AS superseded, " +
    "MAX(mine.received_at) AS last_at " +
    "FROM submissions AS mine WHERE mine.account_id = ?"
  ).bind(caller.accountId).first();

  // An account with no rows counts nothing and sums to NULL, which is
  // not the same zero and would arrive as null in the response.
  const total = (row && row.total) || 0;
  const superseded = (row && row.superseded) || 0;

  return json({
    ok: true,
    accountId: caller.accountId == null ? null : caller.accountId,
    entries: total - superseded,
    superseded: superseded,
    lastAt: (row && row.last_at) || null,
    isAdmin: caller.isAdmin === true,
    isDev: caller.isDev === true,
  }, 200, origin);
}

/*
 * The rows this account has written, and the sealed bytes of each.
 *
 * WHY IT EXISTS. A correction names the row it replaces, and until this
 * route a member could name none: POST /submit answers `{ok:true}`, GET
 * /me answers counts and a date, and GET /export is admin. So the
 * member-facing half of the correction path had nothing to point at,
 * and this gives it one - an id per row, the receipt time this side
 * attested to, and whether something supersedes it.
 *
 * THE BYTES TRAVEL NOW, AND THEY DID NOT BEFORE. This route shipped
 * carrying no ciphertext, on the reasoning that the bytes were inert to
 * the only caller allowed to ask for them: nothing in the tree could
 * open one, so the field would have been cost without use. #85's device
 * key is what changes that - apps/web/memberkey.js gives the submitting
 * browser a second recipient it cannot export - and the note that
 * shipped with the refusal said this is how it would come back: a field
 * can be added the day something can read it, and a field that has
 * shipped cannot be taken back.
 *
 * The cost the refusal named is real and is not paid off by the key
 * existing: a stolen member session now downloads that member's whole
 * sealed history rather than counts. Two things bound it. The session
 * gate is one, which is why the arm that matters is the REVOKED one -
 * a token captured before Sign out must read nothing after it, and
 * every call resolves the caller against the session table rather than
 * trusting a token's shape. MAX_ENTRY_LISTING is the other.
 *
 * THE WORKER STILL CANNOT TELL THESE ROWS APART. The column is emitted
 * verbatim - not parsed, not validated, not tried against a shape, and
 * with no per-row branch anywhere in this function. A row sealed to two
 * recipients and a row sealed to the keyholder alone are one opaque
 * string here, so "which of this member's rows are member-readable" is
 * not a question this side can answer, and therefore not one anybody
 * who reaches this side can answer either. It is decided in the browser
 * holding the key, which is the only place that can decide it.
 *
 * WHAT IT STILL DOES NOT CARRY, and why that is a decision rather than
 * an omission:
 *
 *   - No account id. GET /me answers that question, and a fact stated
 *     in two responses is a fact two routes can disagree about.
 *   - No handle and no Telegram id. Neither is reachable from here:
 *     nothing outside handleTelegramAuth in this file ever holds one,
 *     and a row carries the HMAC account id and nothing else.
 *   - No recipient count, and no "this one is yours" flag. Both would
 *     be this side forming an opinion about the envelope, which is the
 *     paragraph above.
 *   - No count, no total, and no distinct answer for an account with
 *     nothing stored. Absent and empty are one 200 with one empty
 *     array, because anything else answers "has this account ever
 *     submitted" to whoever holds the session.
 *
 * THE SCOPE IS IN THE STATEMENT, not applied to what comes back. That
 * is the lesson this route inherits from the one below it, where a
 * read-back keyed on a value the caller had SENT answered 200 about
 * somebody else's row. A clause in the SQL cannot be forgotten by a
 * later map, and there is no parameter on this route at all - the
 * account comes from the session, so there is nothing on the wire for a
 * caller to point somewhere else.
 *
 * THE SUPERSEDE FLAG IS THE SAME PREDICATE GET /me COUNTS WITH, reused
 * rather than restated, so the two member-facing surfaces cannot come to
 * disagree about one corpus. Its account clause is load-bearing for the
 * same reason it is there: a row written through another door - and
 * `wrangler d1 execute` validates nothing - naming this member's entry
 * must not make that entry vanish from their own listing.
 *
 * The flag is advisory and the enforcement stays at POST /submit, which
 * is what bounds the cost of getting it wrong: a page that offered a
 * tombstone as correctable is answered 409 there rather than storing a
 * second current row.
 *
 * ORDER BY is not decoration. Without it the order is D1's to choose,
 * and a listing that reshuffles between loads is one a member cannot
 * read. dev/worker.test.mjs reads the column, the direction and the cap
 * off this statement and sorts by them, so dropping the clause or
 * turning it around goes red there. What that cannot reach is D1: the
 * sequence it compares against is produced by a sort in the suite, and
 * whether the database honors the clause it was handed is a claim only
 * a live round trip makes. tools/check_live.py carries the row that
 * says that half is unmade.
 */
async function handleMyEntries(env, origin, caller) {
  const rows = await env.DB.prepare(
    "SELECT mine.id AS id, mine.received_at AS received_at, " +
    "CASE WHEN " + SUPERSEDED + " THEN 1 ELSE 0 END AS superseded, " +
    "mine.ciphertext AS ciphertext " +
    "FROM submissions AS mine WHERE mine.account_id = ? " +
    "ORDER BY mine.id LIMIT " + MAX_ENTRY_LISTING
  ).bind(caller.accountId).all();

  return json({
    ok: true,
    entries: rows.results.map((row) => ({
      id: row.id,
      receivedAt: row.received_at,
      // SQLite answers a CASE with an integer and the page wants a
      // boolean. The comparison is strict, so anything else this column
      // could ever arrive as reads as NOT superseded - which is the
      // direction whose failure something else still catches. A page
      // that offers a tombstone is answered 409 by POST /submit; a page
      // wrongly told an entry is already corrected offers the member
      // nothing to press and no refusal to explain why.
      superseded: row.superseded === 1,
      // Straight off the column, with no coercion and no default. An
      // undefined here would be this function inventing a value for a
      // row whose bytes it failed to select; the browser's decoder says
      // so plainly, and a "" would look to it like an empty envelope.
      ciphertext: row.ciphertext,
    })),
  }, 200, origin);
}

/*
 * The two rules a correction is checked against, each written once.
 *
 * Both statements below are built from these fragments - one reports why
 * a correction was refused, the other refuses it - and a rule spelled out
 * twice is a rule that can be changed in one place and not the other.
 * The ownership question binds the session's account and never anything
 * from the body, and it asks about existence and ownership together so
 * that no answer here distinguishes them.
 *
 * THE SECOND RULE IS SCOPED TO NOTHING, on purpose, and it is not an
 * oversight left where the first one has an account clause. It asks the
 * question the UNIQUE index on `supersedes` asks, because that index is
 * what enforces the same rule when this check is raced - and a narrower
 * question here would accept writes the database then refuses, turning a
 * refusal the member can act on into an exception. server/schema.sql
 * holds that reasoning beside the index, along with why GET /me's count
 * is scoped where this is not.
 *
 * WHAT IT COSTS, so that nobody has to rediscover it from a support
 * question. POST /submit refuses a pointer at somebody else's row, so
 * this cannot be reached through this door - but the door is not the
 * only one. `wrangler d1 execute` validates nothing and is how the
 * schema, every backup and every restore are applied. A row written that
 * way, naming a member's entry from another account, leaves that member
 * an entry their own panel still calls current - the count IS scoped, so
 * the foreign row hides nothing - and no correction of it they can ever
 * make: this predicate finds the foreign row and answers 409 for as long
 * as it is there. Only a delete through the other door clears it.
 *
 * That outcome is accepted rather than unnoticed, and the alternative is
 * worse in a way that is easy to miss: an account clause here would
 * disagree with the global index, so the raced correction the index
 * still refuses would come back as a 500 instead of the 409 that tells
 * the member what to do next. Fixing the rarer harm by making the
 * common path lie is not a trade this route takes.
 */
const OWNED_BY_CALLER =
  "EXISTS (SELECT 1 FROM submissions WHERE id = ? AND account_id = ?)";
const ALREADY_CORRECTED_ROW =
  "EXISTS (SELECT 1 FROM submissions WHERE supersedes = ?)";

// Byte-identical refusals are the point, so the text is a constant rather
// than a string repeated at each exit. The 404 covers absent, foreign and
// deleted alike; the 409 is answered both by the check and by the index,
// and those two must not be tellable apart.
const NOT_YOURS = "That entry is not one of yours.";
const ALREADY_CORRECTED =
  "That entry has already been corrected. Correct the correction instead.";

async function handleSubmit(request, env, origin, caller) {
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: "Body must be JSON." }, 400, origin);
  }

  const ciphertext = payload && payload.ciphertext;
  if (typeof ciphertext !== "string" || ciphertext.length === 0) {
    return json({ error: "Missing ciphertext." }, 400, origin);
  }
  if (ciphertext.length > MAX_CIPHERTEXT) {
    return json({ error: "Ciphertext too large." }, 413, origin);
  }
  // Shape check only. The contents are unreadable here by design, so
  // this asserts the field is base64 and stops there - but base64 is
  // length-and-padding, not just alphabet. apps/web/crypto.js seals
  // through btoa(), which emits standard base64 in quanta of four with
  // padding only on the final group, so a length that is not a multiple
  // of four is proof the field is not a submission this project wrote.
  // The alphabet-only regex this replaced accepted "A", "AA" and any
  // odd-length run as ciphertext; the `% 4` is what makes the check
  // match what the client can actually produce.
  if (ciphertext.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) {
    return json({ error: "Ciphertext must be base64." }, 400, origin);
  }

  /*
   * A correction, if this is one.
   *
   * There is no UPDATE path here and there cannot be one: the Worker
   * cannot read what it stores, so it cannot modify a record. A
   * correction is an insert of freshly-sealed ciphertext plus a pointer
   * at the row it replaces, and the row it replaces stays as a
   * tombstone. DESIGN.md, "Admin accounts and deletion", holds the rule.
   *
   * THE CHECKS AND THE WRITE ARE ONE BATCH, which is one transaction,
   * and the write carries the rules in its own WHERE. Do not separate
   * them back into a question and an insert that follows it: the gap
   * between those is not theoretical, and two corrections of one entry -
   * two tabs, or a request the browser retried - both pass the question
   * before either reaches the write, so both commit. That is fan-in, two
   * current rows where the design allows one. The database refuses it as
   * well, by a UNIQUE index on `supersedes`, and server/schema.sql
   * carries the reasoning for why the rule is stated in both places.
   *
   * A refused correction stores nothing. Storing it as an ordinary new
   * row instead would be the worst available outcome: the member sees a
   * success, and the row they meant to replace is still counted and
   * still in the series.
   *
   * Absent, foreign and deleted answer identically on purpose. Telling
   * "no such row" apart from "not your row" would make this route a
   * probe for which ids are live across the whole corpus - more than the
   * grouping DESIGN.md's threat model accepts, and reachable with any
   * member session rather than with the database. One predicate asks for
   * a row that is both there and the caller's, so no branch here learns
   * that a row exists without also knowing whose it is.
   *
   * The already-corrected answer is told apart, and safely: reaching it
   * means the caller has proved the row is theirs, so the answer is
   * about their own data. It is where the chain shape lives. A row may
   * be superseded once, which is what keeps "current" meaning "the rows
   * nobody names" - a total function needing no tie-break in a client
   * this side cannot see.
   *
   * A pointer at a row that is gone is not checked for and not an error.
   * It resolves as no pointer everywhere that reads one, which is what
   * lets DELETE /submission/:id stay a single unconditional delete:
   * removing a correction puts the row it corrected back among the
   * current ones, and no deletion ever becomes two.
   */
  const supersedes = payload.supersedes;

  // The account id comes from the session and never from the body. It is
  // the one identity on a row that a client cannot influence, which is
  // what lets the ownership rule below be asked about the session's
  // account rather than about anything the caller said.
  const columns = "INSERT INTO submissions " +
    "(account_id, ciphertext, received_at, supersedes) ";

  if (supersedes === undefined || supersedes === null) {
    await env.DB.prepare(columns + "VALUES (?, ?, ?, ?)")
      .bind(caller.accountId, ciphertext, new Date().toISOString(), null)
      .run();
    return json({ ok: true }, 200, origin);
  }

  // The id of a row, or nothing. A client sending the string "1" has a
  // bug worth hearing about rather than a value worth coercing.
  if (!Number.isInteger(supersedes) || supersedes < 1) {
    return json({
      error: "supersedes must be the id of one of your entries.",
    }, 400, origin);
  }

  const now = new Date().toISOString();
  let checked;
  let landed;
  try {
    [checked, , landed] = await env.DB.batch([
      env.DB.prepare(
        "SELECT " + OWNED_BY_CALLER + " AS mine, " +
        ALREADY_CORRECTED_ROW + " AS corrected"
      ).bind(supersedes, caller.accountId, supersedes),
      env.DB.prepare(
        columns + "SELECT ?, ?, ?, ? WHERE " +
        OWNED_BY_CALLER + " AND NOT " + ALREADY_CORRECTED_ROW
      ).bind(
        caller.accountId, ciphertext, now, supersedes,
        supersedes, caller.accountId, supersedes
      ),
      env.DB.prepare(
        "SELECT ciphertext FROM submissions " +
        "WHERE supersedes = ? AND account_id = ?"
      ).bind(supersedes, caller.accountId),
    ]);
  } catch (error) {
    /*
     * The index refusing a correction of a row somebody else corrected
     * in the same instant. It is the same event as the check below
     * catching it a moment earlier, so it is the same answer - a member
     * who lost a race and a member who corrected twice have identical
     * work to do next, and telling them apart would publish which of
     * them the database happened to serve first.
     *
     * Only that violation is absorbed, and the constraint is named down
     * to its column. Anything else is a failure this route has no answer
     * for and must not report as a refusal the member could act on, so
     * it goes to fetch()'s handler: "that entry has already been
     * corrected", told to somebody whose entry was not corrected, sends
     * them looking for a correction that does not exist and turns a
     * fault into a refusal nobody investigates.
     *
     * Matching the whole message class instead would be a ratchet rather
     * than a present bug - `submissions` carries exactly one unique
     * constraint, so today every UNIQUE violation reachable here IS this
     * one. The cost of the wide match falls on whoever adds the second
     * index to this table, and it falls silently. SQLite names the table
     * and the column in that order, which is what makes the narrow form
     * available.
     */
    if (!/UNIQUE constraint failed: submissions\.supersedes/i
      .test(String(error && error.message))) {
      throw error;
    }
    return json({ error: ALREADY_CORRECTED }, 409, origin);
  }

  /*
   * Whether the row LANDED, rather than whether it should have.
   *
   * The three statements are one batch and therefore one transaction,
   * and the insert carries the rules in its own WHERE - so a refused
   * correction stores nothing even if the diagnosis beside it were read
   * wrong, and a stored one was stored under rules that held at the
   * moment of the write rather than at the moment of the question.
   * Reading the outcome back inside the same batch is what keeps this
   * from depending on the isolation the store happens to offer: a
   * diagnosis that says "fine" and a write that quietly did nothing is
   * exactly the 200-with-no-row the member cannot see, and it is the
   * worst outcome available on this route.
   *
   * The row is identified by its ciphertext AND by the caller's account,
   * and the account clause is the load-bearing half. The ciphertext is
   * the one thing about the row the caller already knows, which is what
   * makes it a usable handle - but it is a value the caller SENT, not a
   * fact about them: ciphertext is not a secret, every blob travels to
   * the keyholder in the export, and the field is free text on the wire.
   * Ask only "is there a row naming this target whose bytes are these"
   * and a member naming somebody else's entry, replaying the ciphertext
   * of the correction that already supersedes it, reads back a row they
   * did not write and is told 200 while nothing was stored. Do not
   * simplify this WHERE back to the pointer alone. Nothing legitimate
   * depends on the wider question: a row this statement is looking for is
   * one the insert above would have written, and that row always carries
   * the caller's own account id.
   *
   * Every row naming the target is examined rather than the first one,
   * and the difference is only visible against a database this index has
   * not reached yet: there, two rows can already name one target, and
   * taking whichever came back first would answer 409 to the member
   * whose row did land. The reply must not depend on the order a result
   * set happens to arrive in.
   */
  if (landed.results.some((r) => r.ciphertext === ciphertext)) {
    return json({ ok: true }, 200, origin);
  }

  /*
   * It did not land, and the diagnosis says why. The first answer covers
   * absent, foreign and deleted alike: one statement asks for a row that
   * is both there and the caller's, so no branch here learns that a row
   * exists without also knowing it belongs to the person asking, and
   * telling those apart would make this route a probe for which ids are
   * live across the whole corpus.
   *
   * Everything else is the chain rule, including the case where the
   * diagnosis found nothing wrong and the write still did nothing -
   * which is another correction of the same row arriving first.
   */
  if (!checked.results[0] || !checked.results[0].mine) {
    return json({ error: NOT_YOURS }, 404, origin);
  }
  return json({ error: ALREADY_CORRECTED }, 409, origin);
}

/*
 * Deleting one submission. An admin action, and the second destructive
 * route in this Worker.
 *
 * It is what answers "please take mine down" without a Cloudflare
 * console, and it is what makes junk recoverable - which is the reason
 * spam protection was allowed to stay "nothing until it appears". See
 * DESIGN.md, "Admin accounts and deletion", including why members cannot yet
 * do this for themselves.
 *
 * Deleting nothing succeeds, for the same reason unpublishing twice
 * does: the caller has got what they wanted.
 *
 * It stays a single unconditional delete now that rows can point at each
 * other, and the temptation to make it more than that is worth naming:
 * `supersedes` is advisory, so a pointer at a row that is gone resolves
 * as no pointer, and removing a correction simply puts the row it
 * corrected back among the current ones. Cascading instead would turn
 * one "please take mine down" into two rows disappearing, and refusing
 * instead would make a row undeletable because somebody corrected it.
 */
async function handleDeleteSubmission(env, origin, id) {
  if (!/^\d+$/.test(id)) {
    return json({ error: "Not found." }, 404, origin);
  }
  await env.DB.prepare("DELETE FROM submissions WHERE id = ?")
    .bind(Number(id)).run();
  return json({ ok: true }, 200, origin);
}

async function handleExport(request, env, origin, caller) {
  if (!caller || !caller.isAdmin) {
    // Answered with CORS headers on purpose. The origin was already
    // checked before this ran, so the only person who sees this is the
    // admin on the admin page - and "Not authorized" is a far better
    // thing for them to read than the opaque CORS failure a bare
    // rejection would produce when they mistype the token.
    return json({ error: "Not authorized." }, 401, origin);
  }

  // account_id travels with the row. The export page groups by it rather
  // than by the decrypted handle, which is what makes "one per person" a
  // fact instead of a guess about two rows spelling a name the same way.
  //
  // `supersedes` travels for the same reason and is resolved in the same
  // place. This side knows which row a correction replaces and cannot
  // know what either of them says, so dropping tombstones from a series
  // is work for the keyholder's browser, where the plaintext already is.
  // Without the column in this response that resolution is not possible
  // at all, and a correction reads as a repeat measurement.
  const rows = await env.DB.prepare(
    "SELECT id, account_id, ciphertext, received_at, supersedes " +
    "FROM submissions ORDER BY id"
  ).all();

  return json({ ok: true, submissions: rows.results }, 200, origin);
}

/*
 * One snapshot, replaced in place. There is no history kept, and that
 * is deliberate: a series of snapshots is more published data about the
 * same people, retained for nobody's benefit. The current picture is
 * the entire product.
 *
 * The body is stored as the text that arrived rather than being parsed
 * and re-serialised. This endpoint has no opinion about what a snapshot
 * contains - the page that built it does - and re-encoding here would
 * be a second place the format could change.
 */
async function handlePublishSnapshot(request, env, origin) {
  const body = await request.text();
  if (!body) {
    return json({ error: "Missing snapshot." }, 400, origin);
  }
  if (body.length > MAX_SNAPSHOT) {
    return json({ error: "Snapshot too large." }, 413, origin);
  }
  // Parsed only to refuse something that is not JSON at all. A page
  // reading this cannot recover from a body that will not parse, and
  // the failure would surface there rather than here.
  try {
    JSON.parse(body);
  } catch (e) {
    return json({ error: "Snapshot must be JSON." }, 400, origin);
  }

  await env.DB.prepare(
    "INSERT INTO snapshots (id, body, updated_at) VALUES (1, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET body = excluded.body, " +
    "updated_at = excluded.updated_at"
  )
    .bind(body, new Date().toISOString())
    .run();

  return json({ ok: true }, 200, origin);
}

/*
 * Reading it back. A member session, because the audience is exactly
 * the people who might recognize somebody - and the gate decides who
 * reads this document, not what may go in it. It carries no handles and
 * no rows, which is why losing the session check here would be a
 * smaller failure than losing one anywhere else and is still a failure.
 * See DESIGN.md, "The charts and the snapshot".
 */
async function handleReadSnapshot(env, origin) {
  const row = await env.DB.prepare(
    "SELECT body, updated_at FROM snapshots WHERE id = 1"
  ).first();

  if (!row) {
    return json({ error: "No snapshot published yet." }, 404, origin);
  }

  // The stored text is dropped in as-is rather than parsed and
  // re-serialised, so this endpoint stays incapable of changing a
  // snapshot's contents. `published_at` sits beside it rather than
  // inside it: the snapshot says when it was computed, this says when
  // it arrived, and the two disagreeing is information.
  const envelope = '{"ok":true,"published_at":' +
    JSON.stringify(row.updated_at) + ',"snapshot":' + row.body + "}";

  return new Response(envelope, {
    status: 200,
    headers: Object.assign(
      { "Content-Type": "application/json" },
      origin ? corsHeaders(origin) : {}
    ),
  });
}

/*
 * Taking it down.
 *
 * This is the one destructive route in the Worker, and it exists
 * because the alternative was worse. Without it, retracting a published
 * snapshot means opening the Cloudflare console and writing SQL - and
 * the moment someone wants to retract one is the moment they have just
 * realised it says more than they meant it to. An emergency path that
 * runs through a dashboard login and a hand-typed DELETE is not a path.
 *
 * It needs the export token and nothing else. Deliberately: the private
 * key is for reading submissions, and requiring it here would mean
 * decrypting the whole corpus in order to remove something - the wrong
 * way round, and slower at exactly the wrong time.
 *
 * Deleting nothing is a success. Someone pressing Unpublish twice, or
 * pressing it when nothing was published, has got what they wanted, and
 * an error there would read as "it did not work" and invite a retry.
 *
 * Nothing is lost that cannot be rebuilt: a snapshot is derived from
 * the submissions, which are untouched by this. The way back is to
 * press Publish again.
 */
async function handleDeleteSnapshot(env, origin) {
  await env.DB.prepare("DELETE FROM snapshots WHERE id = 1").run();

  return json({ ok: true }, 200, origin);
}

/*
 * Who wrote a row, when the writer might be a secret rather than a
 * person. A break-glass EXPORT_TOKEN caller is an admin with no
 * account, so an audit column has to say that: inventing an account id
 * would attribute an act to somebody who did not do it, and a null
 * reads as "nobody recorded it" rather than as "this was the way back
 * in being used". The literal cannot collide with an account id, which
 * is sixty-four hex characters.
 */
const BREAK_GLASS = "break-glass";

function writerOf(caller) {
  return caller && caller.accountId ? caller.accountId : BREAK_GLASS;
}

/*
 * The site copy an admin can change without a release.
 *
 * This route answers a caller with no credential at all, and it is the
 * only one here that does. The argument is what these values are: each
 * page ships the copy it needs in its own HTML and reads this document
 * to override it, so the bytes this route serves stand in for bytes
 * anybody can already fetch from the published site. Gating it would
 * promise a confidentiality the fallback does not have, and the cost of
 * promising it is that somebody eventually puts something private in a
 * table designed for site copy.
 *
 * What follows from that is a rule with a structural expression rather
 * than a warning: nothing about a person goes in this table. The lists
 * of people are `membership`, on their own routes, gated admin - a
 * filter on a shared route is one `if` away from serving the list to a
 * member session, and that mistake would look like nothing at all.
 *
 * `/content` rather than `/config`, because the form definition is
 * configuration and is refused this table on purpose: a wrong bound
 * gets sealed into a record and is discovered on export day, so it
 * stays a repo file the gate reads before it ships. A route named for
 * configuration in general is an invitation to move it here.
 * DESIGN.md, "Where configuration lives", holds the rule.
 *
 * An absent document is `{}` and a 200. A page whose value has never
 * been set is in its normal state, not in an error, and answering 404
 * would make every page treat first-run as a failure.
 */
async function handleReadContent(env, origin) {
  const rows = await env.DB.prepare(
    "SELECT name, value FROM site_content ORDER BY name"
  ).all();

  // Names and values only. `updated_by` is an account id, and a
  // document anybody may fetch is the wrong place to publish which
  // account did anything; the audit stays in the table for a surface
  // that reads it behind the admin gate.
  const content = {};
  for (const row of rows.results) content[row.name] = row.value;

  return json({ ok: true, content: content }, 200, origin);
}

/*
 * Setting one name.
 *
 * One name per request rather than a whole document, because an admin
 * pane that re-posted the document it rendered would delete every name
 * added since it loaded - a second admin's work disappearing with no
 * error anywhere. The last write of a name wins; names nobody wrote in
 * this request are untouched.
 */
async function handleWriteContent(request, env, origin, caller) {
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: "Body must be JSON." }, 400, origin);
  }

  const name = payload && payload.name;
  if (typeof name !== "string" || !CONTENT_NAME.test(name)) {
    return json({
      error: "A content name is lowercase letters, digits, dot, dash or " +
        "underscore, up to 64 characters.",
    }, 400, origin);
  }

  // Text, and only text. A page renders these with textContent, so a
  // value is never markup - and a route that accepted an object would
  // be storing a shape no page knows how to draw.
  const value = payload.value;
  if (typeof value !== "string") {
    return json({ error: "A content value is text." }, 400, origin);
  }
  if (value.length > MAX_CONTENT_VALUE) {
    return json({ error: "Content too large." }, 413, origin);
  }

  await env.DB.prepare(
    "INSERT INTO site_content (name, value, updated_at, updated_by) " +
    "VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET " +
    "value = excluded.value, updated_at = excluded.updated_at, " +
    "updated_by = excluded.updated_by"
  )
    .bind(name, value, new Date().toISOString(), writerOf(caller))
    .run();

  return json({ ok: true }, 200, origin);
}

/*
 * Unsetting one name, which is how a page goes back to the copy it
 * ships with. Without this route a value can only be written over, and
 * the shipped fallback is unreachable for as long as anything sits on
 * top of it - so the way back from a bad edit would be another edit.
 *
 * Deleting nothing succeeds, for the reason unpublishing twice does.
 */
async function handleDeleteContent(env, origin, name) {
  if (!CONTENT_NAME.test(name)) {
    return json({ error: "Not found." }, 404, origin);
  }
  await env.DB.prepare("DELETE FROM site_content WHERE name = ?")
    .bind(name).run();

  return json({ ok: true }, 200, origin);
}

/*
 * The membership lists - who administers, and who bypasses the group
 * check (#69).
 *
 * THIS TABLE IS ENFORCING, and it is the first thing to know about all
 * three of these routes. A row here grants what it says it grants:
 * adminAccountIds() unions `admin` rows with ADMIN_TELEGRAM_IDS, and
 * groupStanding() unions `always_allow` rows with
 * ALWAYS_ALLOW_TELEGRAM_IDS. Both arms are live, and that is the
 * shipped posture rather than a moment in a migration.
 *
 * Why dual-read is what ships. Table-only before a backfill takes
 * authority away from every admin the secret names and the table does
 * not, and the deployment where that hurts is the one where somebody
 * forgot - so the order is dual-read, verify, flip, and the verify step
 * needs a fact rather than a belief. `secretOnly` below is that fact,
 * and this route is the only place it can be computed: the secret holds
 * numeric ids and the table holds their HMACs, so lining the two up
 * needs ACCOUNT_SECRET and therefore has to happen here. Empty means the
 * backfill is complete and a flip would take nobody's authority away.
 *
 * The always-allow list is NOT on that path and no flip is coming for
 * it - groupStanding() says why. Only the admin arm is migrating, so
 * only the admin arm is measured here.
 *
 * The lockout guards live with this change rather than with the routes
 * that landed first, and the reason is that a guard is only worth having
 * where it can bite: refusing to remove the last admin ROW protects
 * nothing while the row grants nothing, and a guard that refuses a safe
 * act while explaining a danger that does not exist is worse than no
 * guard. handleDeleteMembership carries the one that now can.
 *
 * Read gated admin, and every refusal identical to every other refusal
 * this Worker gives. The list of who administers is the list DESIGN.md's
 * account design exists to keep private: a route that answered a member
 * differently from a stranger, or answered differently for an account
 * that is on the list than for one that is not, would be that oracle
 * reachable with a member session rather than with the database. That is
 * why the gate runs in the router, ahead of every shape check here - a
 * 404 for a role that is not a role is an answer only an admin may have.
 *
 * The rows go out with the table's own column names. The admin surface
 * that renders them maps them once; a second spelling of the same field
 * would be a second thing to keep true.
 *
 * TWO LISTS, BECAUSE A ROW CAN BE IN THIS TABLE AND GRANT NOTHING.
 * `membership` holds exactly the rows the authority read honors - the
 * same grantsAnything() it asks, so the two can never disagree about a
 * row - and `malformed` holds the rest.
 * A row whose account id is not sixty-four lowercase hex characters -
 * which `wrangler d1 execute` writes without complaint, since it
 * validates nothing - is dropped by every read that decides anything,
 * so listing it beside the rows that grant is the undetectable-wrong-
 * value failure #69 opens with, wearing the interface's own clothes.
 *
 * The split rather than a flag on each row, because the fail-safe
 * direction matters more than the tidier shape: a surface that has
 * never heard of `malformed` renders only rows that grant, and one that
 * has can show the duds and offer to remove them. A flag has to be read
 * to be obeyed, and the reader who most needs it is the one who does
 * not know it is there.
 */
async function handleReadMembership(env, origin) {
  const rows = await env.DB.prepare(
    "SELECT account_id, role, label, added_at FROM membership " +
    "ORDER BY role, added_at"
  ).all();

  const granting = [];
  const malformed = [];
  for (const row of rows.results) {
    (grantsAnything(row) ? granting : malformed).push(row);
  }

  // From the granting rows only. A dud cannot stand in for the secret's
  // grant, so counting it here would report a backfill complete while
  // the flip it authorizes would take that admin's authority away.
  const inTable = new Set(granting
    .filter((row) => row.role === "admin")
    .map((row) => row.account_id));
  const secretOnly = [];
  for (const id of await secretAdminAccountIds(env)) {
    if (!inTable.has(id)) secretOnly.push(id);
  }

  // Account ids, never the numeric ids they came from. These are the
  // same un-invertible values the rows beside them already carry, going
  // to a caller who may read every one of those rows anyway.
  return json({
    ok: true,
    membership: granting,
    malformed: malformed,
    secretOnly: secretOnly.sort(),
  }, 200, origin);
}

/*
 * An admin changing their own row, recorded.
 *
 * `added_by` answers who wrote a row that still exists. A removal leaves
 * no row to carry it, and the removal worth recording most is an admin
 * taking their own authority away, or handing themselves a role nobody
 * else granted them - so the record is a log line rather than a column.
 *
 * Account ids only. That is the same HMAC already sitting in the clear
 * in the table beside it, so this puts nothing anywhere it was not
 * already; a numeric id would be the membership oracle relocated into a
 * log file, which is the trade DESIGN.md rejects redirect-mode sign-in
 * over. Nothing here is echoed in a response - the caller already knows
 * what they did, and a response field would put it where anything
 * holding the session could read it.
 *
 * A break-glass caller is nobody and so can never be the subject: its
 * accountId is null, which matches no row.
 */
function noteSelfWrite(action, caller, accountId, role) {
  if (!caller || caller.accountId !== accountId) return;
  console.log(JSON.stringify({
    event: "membership.self",
    action: action,
    role: role,
    account_id: accountId,
  }));
}

/*
 * Adding somebody, or relabeling somebody already there.
 *
 * The caller sends a numeric Telegram id and the Worker HMACs it on
 * receipt; the id itself is never stored and never sent back.
 * DESIGN.md, "The identifier is the whole problem", states that as a
 * prohibition - a numeric id resolves to a person for anyone who can
 * point a bot at it, so a table of them turns a database breach into
 * the group's membership by name, which is most of the harm the
 * encryption exists to prevent.
 *
 * The numeric id rather than the account id on the wire, even though
 * the account id is what gets stored and GET /me already hands a member
 * their own. A 64-character HMAC typed or pasted by a human cannot be
 * checked by anything: one wrong character produces a row that grants
 * nothing, looks completely correct, and is discovered when somebody
 * cannot get in - which is the undetectable-wrong-value complaint #69
 * opens with, moved into the table it asked for. A numeric id has a
 * shape this side can refuse, and it goes through the one function that
 * derives account ids, so a row can never carry a value computed by
 * some other rule.
 *
 * The label is required rather than optional. A list of HMACs answers
 * nobody, and an admin who cannot tell which row is which will remove
 * the wrong one; it is a label somebody typed and not a verified
 * handle, which is the same id-is-identity, handle-is-display split a
 * submission row already carries.
 *
 * Adding a row that is there relabels it and leaves `added_at` and
 * `added_by` alone, because those answer when this account was given
 * this role and by whom - questions a change of nickname does not
 * change the answer to.
 */
async function handleAddMembership(request, env, origin, caller) {
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: "Body must be JSON." }, 400, origin);
  }

  const role = payload && payload.role;

  /*
   * A development session may not write an admin row.
   *
   * POST /auth/dev mints an admin whose authority comes from
   * DEV_LOGIN_SECRET and nothing else, which is harmless only while the
   * table grants nothing. A row written from a local login is a real
   * admin row, and after a flip to table-only it is the whole
   * authority. So a dev session keeps every power it had over the data
   * and loses this one; it may still manage the always-allow list,
   * which is what makes a local admin page workable at all.
   *
   * There is deliberately no escape hatch. A second secret to gate the
   * exception is a second secret to forget, and on production
   * DEV_LOGIN_SECRET is unset and no dev session can exist - so this
   * refusal costs that deployment nothing and is a real boundary on
   * every other one.
   *
   * It stands ahead of every shape check below, and in the router's own
   * words - the same bytes every other refusal here gives - so a caller
   * who may not write this row cannot use a malformed body to learn
   * what the route would have said next. The body parse above is the
   * one thing that cannot follow it: `role` lives inside the body, so
   * there is nothing to refuse until the body is an object.
   */
  if (caller && caller.isDev && role === "admin") return unauthorized(origin);

  // String(anything) would accept an array of one id, which is a caller
  // with a bug rather than a value worth coercing.
  const given = payload && payload.telegramId;
  const telegramId = typeof given === "number" || typeof given === "string"
    ? String(given) : "";
  if (!TELEGRAM_ID.test(telegramId)) {
    return json({
      error: "A numeric Telegram id is needed.",
    }, 400, origin);
  }

  if (!MEMBERSHIP_ROLES.includes(role)) {
    return json({
      error: "A role is one of: " + MEMBERSHIP_ROLES.join(", ") + ".",
    }, 400, origin);
  }

  const label = typeof payload.label === "string" ? payload.label.trim() : "";
  if (!label || label.length > MAX_LABEL) {
    return json({
      error: "A label of up to " + MAX_LABEL + " characters is needed, so " +
        "the list can be read.",
    }, 400, origin);
  }

  const accountId = await accountIdFor(env, telegramId);
  await env.DB.prepare(
    "INSERT INTO membership (account_id, role, label, added_at, added_by) " +
    "VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id, role) " +
    "DO UPDATE SET label = excluded.label"
  )
    .bind(accountId, role, label, new Date().toISOString(), writerOf(caller))
    .run();

  noteSelfWrite("add", caller, accountId, role);
  return json({ ok: true }, 200, origin);
}

/*
 * Removing one row: one account, one role. Removing an account from one
 * list is not removing them from the other, and a route that took only
 * an account id would have to guess which was meant.
 *
 * THE LAST ADMIN ROW THAT GRANTS DOES NOT COME OFF. Now that a row
 * grants what it says, an admin list with no granting row left is a
 * lockout with no lever inside the product to undo it - and the way it
 * happens is not recklessness, it is two admins tidying the same list.
 *
 * GRANTS AND NOT ROWS, which is the whole of the subquery's shape. A
 * row whose account id is not sixty-four lowercase hex characters
 * grants nobody anything - grantsAnything() above drops it from every
 * read that decides - so counting it here would let one real admin
 * beside one dud read as two, and the last granting row would come off
 * against a count that was never authority. The dual-read is the only
 * reason that is not a live lockout today: the secret still grants
 * while the flip has not happened. OPERATIONS.md, "Making someone an
 * admin", carries the precondition in the other direction, for whoever
 * performs the flip.
 *
 * AND A ROW THAT GRANTS NOTHING IS SPARED THE GUARD ENTIRELY, which is
 * the second arm and not a refinement of the first. Removing a dud
 * cannot empty a set it was never in, so the guard has nothing to
 * protect there - and narrowing the count alone would make the dud
 * unremovable in the very staging that matters, one real admin beside
 * one dud, while answering "that is the last admin row" about a row
 * that is no admin at all. GET's `malformed` list hands an admin that
 * id so it can be pressed; a refusal here would answer 409 to the id
 * that list just gave out.
 *
 * Counted and deleted in ONE statement, inside one D1 batch, and that is
 * the whole design rather than an implementation taste. A count read
 * first and acted on second is a race with the other admin pressing
 * Remove at the same moment: both reads see two, both writes succeed,
 * and the table is empty with neither request having done anything
 * wrong. The guard is a subquery inside the DELETE, so SQLite evaluates
 * it against the same snapshot the delete applies to and no window
 * exists between them.
 *
 * The second statement asks for the ROW rather than for a count, because
 * a count cannot tell the two success cases apart: with one admin left,
 * "delete a row that was never there" and "delete the last admin's row"
 * leave the same number behind. Whether that row is still there is
 * exactly the question.
 *
 * Deleting nothing still succeeds, the way every other deletion here
 * does. The guard must not turn a no-op into a refusal - an admin who
 * cannot tell "nothing to remove" from "not allowed" starts looking for
 * a bug that is not there.
 *
 * The refusal explains itself, and that is not an exception to the
 * identical-refusal rule above it. Only somebody who may already read
 * the whole list can provoke this, so it says nothing they could not
 * read directly; the rule exists to stop a caller who may NOT read the
 * list learning anything from being refused.
 *
 * CASE IS FOLDED ON BOTH SIDES, which is what makes a row this Worker
 * cannot honor removable at all. POST is not the only door into the
 * table - `wrangler d1 execute` is the other, it validates nothing, and
 * an account id pasted there in upper-case hex is sixty-four correct
 * characters that ACCOUNT_ID refuses and the authority read drops. That
 * row grants nothing and has to be removable by the admin who is
 * looking at it in GET's `malformed` list; matching it byte for byte
 * would answer 404 to the very id that list just handed back. SQLite
 * takes the explicit collation of either operand, so the parameter
 * carries it and the stored column needs no rewriting.
 */
async function handleDeleteMembership(env, origin, role, accountId, caller) {
  const wanted = String(accountId).toLowerCase();
  if (!MEMBERSHIP_ROLES.includes(role) || !ACCOUNT_ID.test(wanted)) {
    return json({ error: "Not found." }, 404, origin);
  }

  /*
   * The subquery names its own copy of the table, because both halves
   * of this guard test `account_id` and only the alias says which row
   * each one means: unqualified inside a subquery, SQLite resolves the
   * column to the inner FROM, so the two tests would read identically
   * and mean opposite things.
   */
  const lastGrantingAdmin =
    " AND (NOT (" + grantsAnythingSql("account_id") + ")" +
    " OR (SELECT COUNT(*) FROM membership AS granting" +
    " WHERE granting.role = 'admin' AND " +
    grantsAnythingSql("granting.account_id") + ") > 1)";

  const [, survivors] = await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM membership WHERE account_id = ? COLLATE NOCASE AND role = ?" +
      (role === "admin" ? lastGrantingAdmin : "")
    ).bind(wanted, role),
    env.DB.prepare(
      "SELECT account_id FROM membership " +
      "WHERE account_id = ? COLLATE NOCASE AND role = ?"
    ).bind(wanted, role),
  ]);

  if (survivors.results.length > 0) {
    return json({
      error: "That is the last admin row. Add another admin before " +
        "removing this one.",
    }, 409, origin);
  }

  // The folded id rather than the path's spelling, so an admin removing
  // their own row is recorded as themselves however they typed it.
  noteSelfWrite("remove", caller, wanted, role);
  return json({ ok: true }, 200, origin);
}

/*
 * Every route, once the origin is settled.
 *
 * Split from fetch() so that one try/catch can stand around all of it -
 * see fetch() for why an escaped throw is a refusal shape this Worker
 * does not otherwise have.
 */
async function route(request, env, url, allowed) {
  if (request.method === "OPTIONS") {
    if (!allowed) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(allowed) });
  }

  if (!allowed) {
    return json({ error: "Origin not allowed." }, 403, null);
  }

  const path = url.pathname;
  const method = request.method;

  // The two sign-in routes are the only ones that answer without a
  // credential, because issuing one is what they are for.
  if (method === "POST" && path === "/auth/telegram") {
    return handleTelegramAuth(request, env, allowed);
  }
  if (method === "POST" && path === "/auth/dev") {
    return handleDevAuth(request, env, allowed);
  }

  // Everything below needs to know who is asking, so it is resolved
  // once here rather than in each handler - a route that forgot to ask
  // would be a route with no gate, and that is not a mistake worth
  // leaving available.
  const caller = await callerFor(request, env);
  const admin = Boolean(caller && caller.isAdmin);

  // Only a live session may be ended, and only its own. A token that
  // resolves to no row is refused rather than thanked: answering 200
  // would make this an unauthenticated DELETE keyed on a string the
  // caller chose, and would tell somebody they were signed out when
  // they were not - which is the failure this route exists to fix.
  // The break-glass EXPORT_TOKEN is refused for the same honesty: it
  // is a secret rather than a session, there is no row to remove, and
  // ending it means rotating it. Nothing is trapped by any of this,
  // because the page clears its local copy whatever the answer is.
  if (method === "DELETE" && path === "/session") {
    if (!caller || caller.breakGlass) return unauthorized(allowed);
    return handleRevokeSession(request, env, allowed);
  }
  if (method === "GET" && path === "/me") {
    if (!caller) return unauthorized(allowed);
    return handleMe(request, env, allowed, caller);
  }
  // A break-glass EXPORT_TOKEN caller has no account whose rows these
  // would be, so it is refused here exactly as it is at POST /submit -
  // and the gate is in this router rather than in the handler, so that
  // the read is never sent scoped to an account id of null. Nothing is
  // withheld: the break-glass caller is an admin and GET /export is the
  // whole corpus. What has no answer is which member it is.
  if (method === "GET" && path === "/my-entries") {
    if (!caller || !caller.accountId) return unauthorized(allowed);
    return handleMyEntries(env, allowed, caller);
  }
  if (method === "POST" && path === "/submit") {
    // A break-glass EXPORT_TOKEN caller has no account to write to.
    // Submitting is a member action and it needs a member.
    if (!caller || !caller.accountId) return unauthorized(allowed);
    return handleSubmit(request, env, allowed, caller);
  }
  if (method === "GET" && path === "/export") {
    return handleExport(request, env, allowed, caller);
  }
  if (method === "POST" && path === "/snapshot") {
    if (!admin) return unauthorized(allowed);
    return handlePublishSnapshot(request, env, allowed);
  }
  if (method === "GET" && path === "/snapshot") {
    // Members only since 2026-08-05. The document still carries no
    // handles and no rows - gating it is not a reason to relax what
    // goes in it. See DESIGN.md, "The charts and the snapshot".
    if (!caller) return unauthorized(allowed);
    return handleReadSnapshot(env, allowed);
  }
  if (method === "DELETE" && path === "/snapshot") {
    if (!admin) return unauthorized(allowed);
    return handleDeleteSnapshot(env, allowed);
  }

  const submission = /^\/submission\/([^/]+)$/.exec(path);
  if (method === "DELETE" && submission) {
    if (!admin) return unauthorized(allowed);
    return handleDeleteSubmission(env, allowed, submission[1]);
  }

  // The site copy. The read takes no credential, which is the one
  // exception in this router and is argued in handleReadContent; the
  // two writes are an admin session like every other write here.
  if (method === "GET" && path === "/content") {
    return handleReadContent(env, allowed);
  }
  if (method === "POST" && path === "/content") {
    if (!admin) return unauthorized(allowed);
    return handleWriteContent(request, env, allowed, caller);
  }
  const contentName = /^\/content\/([^/]+)$/.exec(path);
  if (method === "DELETE" && contentName) {
    if (!admin) return unauthorized(allowed);
    return handleDeleteContent(env, allowed, contentName[1]);
  }

  // Membership, admin in every direction, and these two lists are the
  // authority itself rather than data behind it. The gate is here
  // rather than inside the handlers so that a malformed role and a
  // real one are the same refusal to anybody who may not read the list
  // at all.
  //
  // A development session is an admin that may not touch the admin
  // list - handleAddMembership argues that in full. The role is in the
  // path here, so the refusal is in the router where the rest of the
  // gate is; on POST it is the first thing past the body parse, which
  // is the earliest the role is knowable at all.
  if (method === "GET" && path === "/membership") {
    if (!admin) return unauthorized(allowed);
    return handleReadMembership(env, allowed);
  }
  if (method === "POST" && path === "/membership") {
    if (!admin) return unauthorized(allowed);
    return handleAddMembership(request, env, allowed, caller);
  }
  const listed = /^\/membership\/([^/]+)\/([^/]+)$/.exec(path);
  if (method === "DELETE" && listed) {
    if (!admin) return unauthorized(allowed);
    if (caller.isDev && listed[1] === "admin") return unauthorized(allowed);
    return handleDeleteMembership(env, allowed, listed[1], listed[2], caller);
  }

  return json({ error: "Not found." }, 404, allowed);
}

export default {
  /*
   * A THROW THAT ESCAPES IS A REFUSAL NOTHING ELSE HERE GIVES, and that
   * is what this catch exists to prevent. The runtime answers an
   * uncaught exception with a bare 500: no CORS headers, so a browser
   * reports a network failure rather than the refusal it is, and no
   * `{error}` body, so a page that reads one has nothing to show. Every
   * other refusal on this Worker is the same two things, and the day an
   * admin meets this one is the day D1 is unwell - the worst possible
   * day to be told nothing.
   *
   * The origin is settled before the try, so a refusal keeps its CORS
   * headers even when the route that would have set them never ran; a
   * caller from an origin this Worker does not allow gets no headers
   * here either, exactly as the 403 above it gives none.
   *
   * The message says nothing about what failed. A D1 error text can
   * carry a fragment of the statement or the value that broke it, and a
   * caller who provoked the failure is the last party who should be
   * handed either. The method and path go to the log instead, where
   * they are already visible to whoever is running the Worker.
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = allowedOrigins(env).includes(origin) ? origin : null;

    try {
      return await route(request, env, url, allowed);
    } catch (e) {
      console.log(JSON.stringify({
        event: "unhandled",
        method: request.method,
        path: url.pathname,
      }));
      return json({ error: "Something went wrong." }, 500, allowed);
    }
  },
};
