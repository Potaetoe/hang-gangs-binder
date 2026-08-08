/*
 * The storage endpoint. One Cloudflare Worker, one D1 database.
 *
 * The routes:
 *
 *   POST   /auth/telegram    verify a login payload, issue a session.
 *   POST   /auth/dev         development only; 404 everywhere else.
 *   DELETE /session          end the session presented, now.
 *   GET    /me               what this account has on record.
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
 *   ADMIN_TELEGRAM_IDS        secret, comma-separated numeric ids
 *   EXPORT_TOKEN              secret, break-glass admin access
 *   TELEGRAM_GROUP_CHAT_ID    secret, optional; when set, only members
 *                             of that group may sign in
 *   ALWAYS_ALLOW_TELEGRAM_IDS secret, optional; ids that bypass the group
 *                             check, and the way back in if the bot is
 *                             ever removed from the group
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
 * Member sessions have no window, deliberately. A member session appends
 * rows for one account and reads a document carrying no handles and no
 * rows, so there is no plaintext corpus behind it to leave on a screen.
 * DESIGN.md, "Sessions", records that as a decision (V-222389).
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
 * The configured admins, as account ids rather than Telegram ids.
 *
 * This is what lets sessionFor() re-check the admin list on every
 * request without the sessions table ever having to record who a session
 * belongs to. The row already carries the account id, which is the HMAC
 * of a Telegram id under ACCOUNT_SECRET; HMAC the configured ids the
 * same way and the two are comparable. Nothing new is stored and no
 * identity is written down anywhere - both sides of the comparison are
 * things this Worker already had, and the answer lives for one request.
 *
 * Recomputed per request on purpose. A cache would be a copy of the
 * admin list living somewhere other than the secret, which is precisely
 * the stale-admin bug this function exists to remove; the list is a
 * handful of ids and an HMAC each.
 *
 * The secret is the enforcing list and the `membership` table is not -
 * see handleReadMembership below for the whole of that seam. Reading
 * both here would make two places the answer could be true.
 */
async function adminAccountIds(env) {
  const ids = idList(env.ADMIN_TELEGRAM_IDS);
  return new Set(await Promise.all(ids.map((id) => accountIdFor(env, id))));
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
 * Is this person actually in the group?
 *
 * The widget proves somebody has a Telegram account; it says nothing
 * about whether they are one of yours. This is what makes the binder
 * private to the group rather than private to whoever finds the URL.
 *
 * ALWAYS_ALLOW_TELEGRAM_IDS passes regardless, and is not merely a
 * convenience: if the bot is ever removed from the group this call
 * starts refusing everybody, and that list is the way back in. It is
 * read from the secret and not from the `membership` table, for the
 * reason handleReadMembership gives.
 *
 * Unconfigured - no chat id - means the check is off and everybody with
 * a Telegram account passes. That is a deployment decision rather than a
 * silent default, and server/README.md says so.
 */
async function isGroupMember(env, userId) {
  if (idList(env.ALWAYS_ALLOW_TELEGRAM_IDS).includes(String(userId))) {
    return true;
  }
  if (!env.TELEGRAM_GROUP_CHAT_ID) return true;

  const url = "https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN +
    "/getChatMember?chat_id=" +
    encodeURIComponent(env.TELEGRAM_GROUP_CHAT_ID) +
    "&user_id=" + encodeURIComponent(String(userId));

  let body;
  try {
    body = await (await fetch(url)).json();
  } catch (e) {
    return false;   // unreachable Telegram is not a reason to let people in
  }
  if (!body || body.ok !== true || !body.result) return false;
  const status = body.result.status;
  if (!MEMBER_STATUSES.includes(status)) return false;
  // A restricted member who has actually left says so here.
  return !(status === "restricted" && body.result.is_member === false);
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
 * taking its owner off ADMIN_TELEGRAM_IDS does not un-hand it. Reading
 * the re-read instead would give a demoted session the longer deadline,
 * which is the wrong direction for a demotion.
 *
 * The admin flag is re-checked here rather than trusted from the row.
 * The row says what was true at sign-in, and the question every caller
 * below is actually asking is whether it is true now: without this,
 * taking an id out of ADMIN_TELEGRAM_IDS does nothing for up to two
 * hours and nothing can force it sooner. The stored flag stays a
 * necessary condition - a member session cannot be promoted by editing a
 * secret, which would be a promotion nobody signed in for - and the list
 * is what turns it off.
 *
 * Demotion is not revocation. A session that stops being an admin
 * session keeps working as the member session it also is; the person is
 * still in the group. Ending a session is DELETE /session.
 *
 * A development session is exempt, because its adminness never came from
 * ADMIN_TELEGRAM_IDS: a "dev:"-namespaced account id cannot be in that
 * list, so checking it there would drop every dev admin instantly. What
 * minted it was DEV_LOGIN_SECRET, so that is what is re-read for it -
 * the same "must be SET" shape handleDevAuth uses, so turning the dev
 * login off also drops the sessions it issued.
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
  if (Date.parse(row.expires_at) <= now) {
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

  if (!(await isGroupMember(env, user.id))) {
    return json({
      error: "This binder is for members of the group only.",
    }, 403, origin);
  }

  const accountId = await accountIdFor(env, user.id);
  const isAdmin = idList(env.ADMIN_TELEGRAM_IDS).includes(String(user.id));
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

// A row is superseded when another row names it. Not restricted to the
// same account, because handleSubmit refuses a pointer at anybody else's
// row - a second copy of that rule here would be a second place it could
// be true, and the two could disagree.
const SUPERSEDED =
  "EXISTS (SELECT 1 FROM submissions AS newer " +
  "WHERE newer.supersedes = mine.id)";

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
 * scoped to an account".
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
  // this asserts the field is base64 and stops there.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) {
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
   * All three checks run before anything is written, and the write is
   * one statement, so a refused correction stores nothing. Storing it as
   * an ordinary new row instead would be the worst available outcome:
   * the member sees a success, and the row they meant to replace is
   * still counted and still in the series.
   *
   * The first two failures answer identically on purpose. Telling "no
   * such row" apart from "not your row" would make this route a probe
   * for which ids are live across the whole corpus - more than the
   * grouping DESIGN.md's threat model accepts, and reachable with any
   * member session rather than with the database. One statement asks for
   * a row that is both, so there is no branch here that knows a row
   * exists without knowing it is the caller's.
   *
   * The third is told apart, and safely: reaching it means the caller
   * has already proved the row is theirs, so the answer is about their
   * own data. It is also where the chain shape lives. A row may be
   * superseded once, which is what keeps "current" meaning "the rows
   * nobody names" - a total function needing no tie-break in a client
   * this side cannot see. Two rows naming the same target would both be
   * current, and the member would hold two claims where they meant one.
   *
   * A pointer at a row that is gone is not checked for and not an error.
   * It resolves as no pointer everywhere that reads one, which is what
   * lets DELETE /submission/:id stay a single unconditional delete:
   * removing a correction puts the row it corrected back among the
   * current ones, and no deletion ever becomes two.
   */
  const supersedes = payload.supersedes;
  let pointer = null;
  if (supersedes !== undefined && supersedes !== null) {
    // The id of a row, or nothing. A client sending the string "1" has a
    // bug worth hearing about rather than a value worth coercing.
    if (!Number.isInteger(supersedes) || supersedes < 1) {
      return json({
        error: "supersedes must be the id of one of your entries.",
      }, 400, origin);
    }

    const target = await env.DB.prepare(
      "SELECT id FROM submissions WHERE id = ? AND account_id = ?"
    ).bind(supersedes, caller.accountId).first();
    if (!target) {
      return json({ error: "That entry is not one of yours." }, 404, origin);
    }

    const corrected = await env.DB.prepare(
      "SELECT id FROM submissions WHERE supersedes = ?"
    ).bind(supersedes).first();
    if (corrected) {
      return json({
        error: "That entry has already been corrected. Correct the " +
          "correction instead.",
      }, 409, origin);
    }

    pointer = supersedes;
  }

  // The account id comes from the session and never from the body. It is
  // the one identity on a row that a client cannot influence, and it is
  // also what makes the ownership check above the only place the
  // same-account rule has to be enforced.
  await env.DB.prepare(
    "INSERT INTO submissions " +
    "(account_id, ciphertext, received_at, supersedes) " +
    "VALUES (?, ?, ?, ?)"
  )
    .bind(caller.accountId, ciphertext, new Date().toISOString(), pointer)
    .run();

  return json({ ok: true }, 200, origin);
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
 * See DESIGN.md, "The dashboard and the snapshot".
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
 * THE SEAM, because it is the first thing to know about all three of
 * these routes: this table enforces nothing. adminAccountIds() reads
 * ADMIN_TELEGRAM_IDS and isGroupMember() reads
 * ALWAYS_ALLOW_TELEGRAM_IDS, and those secrets stay the enforcing copy
 * until a slice that changes what a sign-in means migrates them
 * deliberately. Two lists that both granted access would be two places
 * the answer could be true, and the migration is where the lockout
 * guards belong - refusing the removal of the last admin means nothing
 * while a secret nobody here can read is what actually grants the
 * authority, and a guard that refuses a safe act while explaining a
 * danger that does not exist is worse than no guard. dev/worker.test.mjs
 * asserts the inert half, so the day the seam closes a check says so.
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
 */
async function handleReadMembership(env, origin) {
  const rows = await env.DB.prepare(
    "SELECT account_id, role, label, added_at FROM membership " +
    "ORDER BY role, added_at"
  ).all();

  return json({ ok: true, membership: rows.results }, 200, origin);
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

  const role = payload.role;
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

  await env.DB.prepare(
    "INSERT INTO membership (account_id, role, label, added_at, added_by) " +
    "VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id, role) " +
    "DO UPDATE SET label = excluded.label"
  )
    .bind(await accountIdFor(env, telegramId), role, label,
      new Date().toISOString(), writerOf(caller))
    .run();

  return json({ ok: true }, 200, origin);
}

/*
 * Removing one row: one account, one role. Removing an account from one
 * list is not removing them from the other, and a route that took only
 * an account id would have to guess which was meant.
 *
 * Deleting nothing succeeds, the way every other deletion here does.
 */
async function handleDeleteMembership(env, origin, role, accountId) {
  if (!MEMBERSHIP_ROLES.includes(role) || !ACCOUNT_ID.test(accountId)) {
    return json({ error: "Not found." }, 404, origin);
  }
  await env.DB.prepare(
    "DELETE FROM membership WHERE account_id = ? AND role = ?"
  ).bind(accountId, role).run();

  return json({ ok: true }, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = allowedOrigins(env).includes(origin) ? origin : null;

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
      // goes in it. See DESIGN.md, "The dashboard and the snapshot".
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

    // Membership, admin in every direction. The gate is here rather
    // than inside the handlers so that a malformed role and a real one
    // are the same refusal to anybody who may not read the list at all.
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
      return handleDeleteMembership(env, allowed, listed[1], listed[2]);
    }

    return json({ error: "Not found." }, 404, allowed);
  },
};
