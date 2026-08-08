/*
 * The storage endpoint. One Cloudflare Worker, one D1 database.
 *
 * The routes:
 *
 *   POST   /auth/telegram    verify a login payload, issue a session.
 *   POST   /auth/dev         development only; 404 everywhere else.
 *   DELETE /session          end the session presented, now.
 *   GET    /me               what this account has on record.
 *   POST   /submit           append one row. Needs a member session.
 *   GET    /export           return every row. Admin.
 *   POST   /snapshot         replace the published aggregate. Admin.
 *   GET    /snapshot         return it. Members only since 2026-08-05 -
 *                            it still carries no handles and no rows,
 *                            because gating a document is not a reason
 *                            to relax what goes in it.
 *   DELETE /snapshot         take it down. Admin, and no key - see the
 *                            handler for why that matters.
 *   DELETE /submission/:id   remove one row. Admin.
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
 * How long a session lasts.
 *
 * A member's runs a week, because this is something people come back to
 * and update rather than fill in once - see DESIGN.md, "Sessions". An
 * admin's runs two hours, because an admin session fetches the entire
 * corpus's ciphertext and the difference in what is at stake is the
 * whole reason these are two numbers instead of one.
 */
const SESSION_HOURS = { member: 24 * 7, admin: 2 };

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
 * starts refusing everybody, and that list is the way back in.
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
 * A session is 32 random bytes. The database stores only its SHA-256, so
 * reading the sessions table yields nothing that can be used as one -
 * the same reasoning that keeps plaintext out of `submissions`, applied
 * to a much smaller secret.
 */
async function issueSession(env, accountId, isAdmin, isDev) {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const token = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const hours = isAdmin ? SESSION_HOURS.admin : SESSION_HOURS.member;
  const now = new Date();
  const expires = new Date(now.getTime() + hours * 3600 * 1000);

  await env.DB.prepare(
    "INSERT INTO sessions " +
    "(token_hash, account_id, is_admin, is_dev, created_at, expires_at) " +
    "VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(await sha256Hex(token), accountId, isAdmin ? 1 : 0, isDev ? 1 : 0,
      now.toISOString(), expires.toISOString())
    .run();

  return { token: token, expiresAt: expires.toISOString() };
}

/*
 * Expired rows are cleared when one is looked up rather than by a
 * scheduled job. The ordinary failure of a scheduled job is silence, and
 * there is nothing here worth a moving part.
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
  const row = await env.DB.prepare(
    "SELECT account_id, is_admin, is_dev, expires_at FROM sessions " +
    "WHERE token_hash = ?"
  ).bind(await sha256Hex(token)).first();

  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .bind(new Date().toISOString()).run();
    return null;
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
function bearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

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
 */
async function handleMe(request, env, origin, caller) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS entries, MAX(received_at) AS last_at " +
    "FROM submissions WHERE account_id = ?"
  ).bind(caller.accountId).first();

  return json({
    ok: true,
    accountId: caller.accountId == null ? null : caller.accountId,
    entries: (row && row.entries) || 0,
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

  // The account id comes from the session and never from the body. It is
  // the one identity on a row that a client cannot influence.
  await env.DB.prepare(
    "INSERT INTO submissions (account_id, ciphertext, received_at) " +
    "VALUES (?, ?, ?)"
  )
    .bind(caller.accountId, ciphertext, new Date().toISOString())
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
  const rows = await env.DB.prepare(
    "SELECT id, account_id, ciphertext, received_at FROM submissions " +
    "ORDER BY id"
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
 * The public read. No token, because there is nothing here to protect -
 * the document carries no handles and no rows. If that ever stops being
 * true, this route is the reason it matters.
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

    return json({ error: "Not found." }, 404, allowed);
  },
};
