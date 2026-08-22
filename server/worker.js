/*
 * The storage endpoint. One Cloudflare Worker, one D1 database.
 *
 * The routes:
 *
 *   POST   /auth/telegram    verify a login payload, issue a session.
 *   DELETE /session          end the session presented, now.
 *   GET    /me               what this account has on record.
 *   GET    /my-entries       this account's own rows: an id, a receipt
 *                            time, whether something supersedes it, and
 *                            the row's PLAINTEXT, opened here from the
 *                            at-rest ciphertext. Needs a member session,
 *                            because it needs an account.
 *   POST   /submit           seal one row and append it, optionally
 *                            naming the row it supersedes. The body
 *                            carries the plaintext record; this Worker
 *                            seals it at rest. Needs a member session.
 *   GET    /charts-data      aggregate the whole corpus on request and
 *                            answer one filter and one measure: the
 *                            trend, the distribution and the group
 *                            makeup, with the suppression floor the
 *                            settings hold already applied by
 *                            server/charts-agg.js. Needs a member
 *                            session. The Worker opens every current row
 *                            to compute it - DESIGN.md, "Charts": "The
 *                            Worker aggregates on request".
 *                            NOT /charts, which is the charts PAGE's own
 *                            URL - see API_SEGMENTS below for why a
 *                            route named after a page makes that page
 *                            unreachable (0.9-M2-S8, #365).
 *   GET    /export           return every row, sealed as stored. Admin.
 *                            Server-side opening for admins is a later
 *                            slice (0.9-M3); this route is unchanged by
 *                            0.9-M1-S6 and still hands back ciphertext.
 *   DELETE /submission/:id   remove one row. A member removes their own;
 *                            an admin removes anyone's. See
 *                            handleDeleteSubmission for the whole of the
 *                            difference between the two.
 *   GET    /content          the site copy an admin has set. One of the
 *                            two routes here that answer without a
 *                            credential - see handleReadContent.
 *   POST   /content          set one name. Admin. The five settings
 *                            names are validated on arrival; see
 *                            SETTINGS below.
 *   DELETE /content/:name    unset one, so the page shows the copy it
 *                            ships with again. Admin.
 *   GET    /config           the three values a page needs before
 *                            anybody has signed in - the group's name,
 *                            the door's welcome text, the default
 *                            palette. The other credential-free route,
 *                            and an allow-list on the same table
 *                            /content serves; see handleReadConfig.
 *   GET    /admin-log        every admin change, newest first and
 *                            bounded. Admin.
 *   GET    /membership       the admin and always-allow lists. Admin.
 *   POST   /membership       add one, or relabel one. Admin.
 *   DELETE /membership/:role/:accountId
 *                            remove one. Admin.
 *
 * ROWS ARE ENCRYPTED AT REST UNDER A SECRET ONLY THIS WORKER HOLDS, and
 * this Worker reads them to serve a member their own history back
 * (0.9-M1-S6, #332; DESIGN.md, "Trust model: the Worker reads"). The
 * at-rest format lives in one place, server/store-crypto.js, imported
 * below - this file knows the routes and the database and lets that file
 * know the ciphertext. What a raw database dump alone reveals is
 * argued there; the trade that the operator can read plaintext is ruled
 * knowingly in DESIGN.md and is not this file's to change.
 *
 * The snapshot route - the pre-0.9 client-built aggregate this Worker
 * held until live aggregation replaced it - is GONE (0.9-M2-S3, #354):
 * POST/GET/DELETE /snapshot, their handlers, the `snapshots` table's
 * writer and reader, and the CSP/config surface that reached them.
 * apps/web/charts.html reads GET /charts-data instead, computed on
 * request by server/charts-agg.js. The `snapshots` table itself stays in
 * server/schema.sql - dropping a table is a schema migration and 0.9-M3
 * owns that decision, the same deferral server/schema.sql already
 * carries for `sessions.is_dev`. Deleting the one row it can hold is not
 * a migration and is answered separately, in this slice's completion.
 *
 * Every path above is API-shaped (see isApiPath/API_SEGMENTS below);
 * everything else is a page or an asset, served by env.ASSETS rather
 * than by anything in this file - see route()'s own comment for the
 * precedence and wrangler.toml's [assets] block for the routing that
 * makes it deny-by-default (0.9-M1-S3, #329; DESIGN.md, "The
 * constraint that shapes everything").
 *
 * Bindings expected (see server/README.md):
 *   ASSETS                    static-assets binding, dist/ - GET
 *                              env.ASSETS.fetch(request), never written to
 *   DB                        D1 database binding
 *   TELEGRAM_BOT_TOKEN        secret, verifies every login payload
 *   ACCOUNT_SECRET            secret, the HMAC key behind every account
 *                             id. PERMANENT - changing it detaches every
 *                             member from their own history.
 *   STORE_SECRET              secret, the cipher secret rows are sealed
 *                             under at rest. Its own secret, never the
 *                             account-id HMAC key - server/store-crypto.js
 *                             names it, takes it, and this file passes it
 *                             through openStore(env). Required wherever
 *                             rows are stored.
 *   ADMIN_TELEGRAM_IDS        secret, comma-separated numeric ids. The
 *                             bootstrap admin list - the `membership`
 *                             table is the other, a live Telegram group
 *                             role is the third, and adminVia() reads
 *                             all three. See handleReadMembership for
 *                             which way that migration runs.
 *   EXPORT_TOKEN              secret, break-glass admin access
 *   TELEGRAM_GROUP_CHAT_ID    secret, REQUIRED on any Worker that signs
 *                             people in: it names the group whose members
 *                             may sign in, and its absence fails closed -
 *                             groupStanding() answers a standing of
 *                             "unknown" (deny), so
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
 *
 * Tables: `submissions`, `sessions`, `snapshots`, `site_content`,
 * `membership`, `auth_replay`, `directory`, `admin_log`.
 * server/schema.sql is the whole database and each table's own block
 * there carries its reasoning.
 *
 * ---------------------------------------------------------------------
 * TWO MECHANISMS IN THIS FILE THE 0.9 RECORD RETIRES, AND WHAT IS
 * TRUE OF THEM TODAY (0.9-M1-S5, #331).
 *
 * They are named here rather than only in an issue because a
 * pull-request body is not in the repository and the next person to
 * read this file is the person who needs to know. Each is dead by the
 * record and alive in this code, and each dies WITH the surface that
 * rebuilds it - the wave's own rule about a check retiring in the same
 * change as its surface, applied to the code under the checks.
 *
 *   1. ADMIN_TELEGRAM_IDS and the `membership` table's `admin` rows.
 *      DISCHARGED, AND NOT BY DELETION (0.9-M3-S8, #414). This entry
 *      predicted that the milestone building the mirror would take both
 *      lists out with it. The owner ruled otherwise at the 2026-08-20
 *      design sitting: the ruled design #385, rule 1, makes admin TWO
 *      ways in and one tier - a live Telegram group role, which this
 *      slice wires, OR a member flagged into the role by another admin,
 *      which is what the `admin` rows are for and why they stay.
 *      DESIGN.md's own sentence was corrected in the same change rather
 *      than left to be argued with; read that section for what is true
 *      now. The secret is the bootstrap the flagging needs somewhere to
 *      start from, and GET /me's `adminVia` names all three so nobody
 *      has to guess which one they hold. Retiring the secret arm is a
 *      decision with a live consequence - a deployment whose table is
 *      empty locks itself out - so it stays a later slice's on purpose,
 *      rather than being this one's silent omission.
 *   2. ALWAYS_ALLOW_TELEGRAM_IDS and the `always_allow` rows.
 *      DESIGN.md, "What is deliberately not here": no always-allow
 *      bypass - a list that skips the membership check is a way in that
 *      outlives the reason it was added. Retired with the same surface,
 *      since the same routes maintain it.
 *
 * NEITHER IS REACHABLE ON sit, and the guard is this code rather than an
 * operator remembering: each reads a binding sit does not set, and each
 * fails closed when it is absent. idList() of an unset secret is the
 * empty list, so neither id list grants anybody anything. What is NOT
 * code-guarded is somebody setting one of those bindings, or writing a
 * `membership` row - both would work, which is exactly why they are
 * listed here.
 *
 * AND UNREACHABLE IS NOT ABSENT, which is the whole reason each entry
 * names the milestone that DELETES it rather than resting on the guard.
 * A mechanism gated on a binding comes back the moment somebody sets
 * that binding, on any deployment, and no amount of failing closed
 * changes that; only the deletion does. This list is therefore a work
 * order, and an entry is discharged by its milestone taking the code
 * out - which is what 0.9-M2 did with the local sign-in door this file
 * carried third (0.9-M2-S1, #352).
 * ---------------------------------------------------------------------
 */

// The at-rest format, in one file. This module knows the routes, the
// session and the database; store-crypto knows the ciphertext and holds
// no opinion about any of them. openStore(env) reads STORE_SECRET and
// hands back sealRow/openRow bound to the AAD this file supplies. See
// server/store-crypto.js's own header for the format and the fixture
// rule. Static import so wrangler bundles it into the deployed Worker;
// the arms that load this file as a data: URL rewrite this one specifier
// to an absolute URL, because a data: module cannot resolve a relative
// one (0.9-M1-S6, #332).
import { openStore } from "./store-crypto.js";

// The charts' aggregation, in one file. This module knows the routes,
// the session and the database; charts-agg knows the disclosure rules
// and holds no opinion about any of them. It is a MODULE rather than a
// section of this file because the floor has to be applied somewhere a
// handler cannot reach around: askFor/aggregate/selfSeries are the only
// rows-to-series path, they apply the floor before returning, and
// handleCharts below serializes what they hand back without computing a
// cell of its own (0.9-M2-S0, #351, security mandate 1). Static import
// so wrangler bundles it into the deployed Worker; the arms that load
// this file as a data: URL rewrite its relative specifiers to absolute
// URLs, because a data: module cannot resolve a relative one.
import { askFor, aggregate, selfSeries } from "./charts-agg.js";

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

/*
 * WHETHER A REQUEST MAY REACH THE ROUTE TABLE AT ALL, which is a
 * different question from WHICH origin gets echoed back in the CORS
 * headers. The two were one value until 0.9-M2-S8 (#365), and
 * conflating them refused every read the site made of itself.
 *
 * A browser attaches an Origin header to POST and to cross-origin
 * fetch, and to nothing else - not to a same-origin GET fetch, not to
 * an address-bar navigation. So `allowedOrigins(env).includes(null)`
 * was false, and the page's own GET /my-entries came back 403 while the
 * POST a second earlier succeeded. The owner met exactly that at the
 * first M2 sitting: entries saved, nothing read back.
 *
 * THREE STATES, NOT TWO:
 *
 *   present and allowed   the route table, plus CORS headers echoing it.
 *   present and foreign   403, every method. Unchanged by this slice.
 *   absent                the route table on GET only, and no
 *                         Access-Control-Allow-Origin at all - never
 *                         `*` and never the literal "null", either of
 *                         which would hand a foreign page read access
 *                         to a credentialed answer. fetch() passes null
 *                         to json(), so corsHeaders is simply skipped.
 *
 * WHY ADMITTING AN ABSENT ORIGIN ON A READ IS SAFE, said out loud
 * because the origin check is the only thing here that looks like CSRF
 * protection and this weakens it. Authority on this Worker is
 * `Authorization: Bearer <session token>`, which the page reads out of
 * sessionStorage and sets per request (bearerToken/callerFor below).
 * There are no cookies, so there is no ambient credential a cross-site
 * page could ride: such a page cannot attach that header without
 * turning the request into one that needs a preflight, and the
 * preflight carries an Origin this Worker refuses. The session stays
 * the whole gate - nothing below admits a caller past a CREDENTIAL
 * check it did not already pass, which is what
 * tests/origin-gate.test.mjs asserts from both sides: a no-Origin read
 * with no credential is still 401, and a forged token is still 401.
 *
 * TWO ROUTES ARE WIDER FOR IT, deliberately, and they are named here
 * rather than left for a reader to find: GET /content and GET /config
 * answer without a credential by design, so on those two an absent
 * Origin reaches the site's own copy rather than a 403. That is the
 * intent - the copy and the door's three values are what an
 * unauthenticated page renders - and the arm asserts the widening
 * rather than only the refusals.
 *
 * STATE-CHANGING METHODS KEEP REFUSING AN ABSENT ORIGIN. A browser
 * always sends Origin on POST and DELETE, so the refusal costs a real
 * caller nothing and is one more thing a non-browser caller would have
 * to get right on top of forging a session token.
 *
 * SEC-FETCH-SITE CORROBORATES, AND ONLY HERE. If the browser sent it,
 * the request must be same-origin or none (an address-bar navigation);
 * cross-site and same-site are refused. It is deliberately NOT applied
 * where an Origin is present and allowed: a deployment that serves its
 * pages from a different host than this Worker - which is the whole
 * reason ALLOWED_ORIGINS exists - is cross-site by construction and
 * would refuse itself. An absent header is not a refusal either; a
 * non-browser caller simply omits it, and this header is corroboration
 * rather than the gate.
 */
function originAdmits(request, env) {
  const origin = request.headers.get("Origin");
  if (origin !== null) return allowedOrigins(env).includes(origin);
  if (request.method !== "GET") return false;
  const site = request.headers.get("Sec-Fetch-Site");
  return site === null || site === "same-origin" || site === "none";
}

/*
 * The two request headers that change this Worker's answer, named once.
 *
 * Origin decides between the route table and a 403; Sec-Fetch-Site
 * corroborates an absent Origin (originAdmits above). Every API answer
 * carries this, including the ones with no Access-Control-Allow-Origin
 * at all - a shared cache keyed on the URL alone could otherwise serve
 * one caller's answer to another, and "no CORS headers" is not the same
 * as "does not vary by Origin".
 */
const VARY = "Origin, Sec-Fetch-Site";

// The plaintext a member may submit in one row, bounded before it is
// sealed. A weigh-in is a handful of short fields; this is generous for
// that and small enough that MAX_ENTRY_LISTING rows stay a bounded
// response. A record over this is refused at POST /submit with 413,
// before any seal or write.
//
// The bound is on the PLAINTEXT rather than on the stored blob, and that
// is the only place it can be asserted: nothing on the wire is a sealed
// blob, so there is no caller-supplied ciphertext length to refuse. The
// stored size follows from this one by arithmetic this Worker does
// itself - a fixed header and tag, then base64's third - so bounding the
// input bounds the row.
const MAX_RECORD_BYTES = 8 * 1024;

// How many rows one member's listing hands back, and why there is a
// number here at all.
//
// GET /my-entries carries every row's opened plaintext, so a listing is
// the largest response this Worker ever sends and its size is chosen by
// whoever has been submitting rather than by anything here. This bounds
// it: 500 rows against MAX_RECORD_BYTES is roughly 4 MB in the worst
// case, and nine years of weekly entries in the realistic one, so nobody
// in this group reaches it by using the site as intended.
//
// It is a LITERAL in the statement rather than a bound parameter, and
// that is the load-bearing part: a cap D1 is told about is a cap on
// what D1 reads, and nothing on the wire can move it because there is
// nothing on the wire. Slicing the results instead would transfer
// everything and then throw some away, which is a cap in the only place
// it does not help.
//
// If a member ever does reach it their NEWEST rows are what they get,
// because the listing orders by received_at descending - the right half
// to keep for a page whose top row is the current claim. The fix at that
// point is pagination, not a bigger number - and pagination is a
// parameter on this route, which is the property every scope argument
// here rests on not having.
const MAX_ENTRY_LISTING = 500;

// How many rows one aggregation reads, and why a cap is here at all.
//
// GET /charts-data opens EVERY current row in the corpus - the group is the
// subject, so there is no account clause to bound it the way
// MAX_ENTRY_LISTING bounds one member's listing. Each row costs one
// AES-GCM open, so the number is a CPU bound rather than a response
// bound: the answer is counts and bins whatever the corpus size.
//
// Ten thousand against one Telegram group is nine years of weekly
// entries for twenty people, so nobody reaches it by using the site as
// intended. It is a LITERAL in the statement rather than a bound
// parameter, for the same reason MAX_ENTRY_LISTING is: a cap D1 is told
// about is a cap on what D1 reads, and nothing on the wire can move it
// because there is nothing on the wire.
//
// What it costs if a corpus ever does reach it: the OLDEST rows fall
// out of the aggregate, because the read orders by received_at
// descending. That is a chart quietly drawn from part of the history,
// which is the one failure mode here worth naming - the fix at that
// point is a precomputed aggregate on a schedule, not a bigger number,
// and a bigger number would only move the day it happens.
const MAX_AGGREGATE_ROWS = 10000;

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
 *
 * It is also the ceiling on a serialized field-spec row, which is the
 * one value in this table that is a document rather than a sentence
 * (0.9-M3-S11, #419). MAX_FIELD_VALUES bounds what goes in that
 * document; this bounds the row it becomes, so the two cannot be
 * satisfied separately and leave an unservable row behind.
 */
const MAX_CONTENT_VALUE = 8 * 1024;

/*
 * A content name addresses a slot a page reads; it is not prose and
 * nothing renders it. Letters, digits and three separators, bounded -
 * so a name is safe in a URL path without escaping, and a page and an
 * admin pane can agree on one by spelling it.
 *
 * `name` rather than `key`: in this repository a key is a cryptographic
 * key, and this table holds neither one nor anything derived from one.
 *
 * UPPER CASE IS ADMITTED IN THE TAIL, and the property a lowercase-
 * only charset gave for free is enforced by a check instead
 * (0.9-M3-S8, #414). The ruled settings names are camel case -
 * `chart.lockedUnit`, `site.groupName` - so the charset had to widen or
 * the names had to change, and the names are the spec. What widening
 * costs is that two names could differ only by case, which is a list an
 * admin cannot read and a slot two panes disagree about; handleWriteContent
 * refuses the second spelling outright, so the collision is closed by a
 * check rather than by an alphabet. The first character stays lower
 * case or a digit, which keeps every name that already exists valid and
 * gives the fold below one obvious canonical form to compare against.
 */
const CONTENT_NAME = /^[a-z0-9][A-Za-z0-9._-]{0,63}$/;

/*
 * THE SETTINGS, AND WHAT EACH ONE ACCEPTS (0.9-M3-S8, #414; the ruled
 * design #385, rules 9 and 11).
 *
 * These five names live in `site_content` beside the site's copy, and
 * that is a deliberate re-use rather than a shortcut: the table already
 * holds admin-owned, page-read values with an audit column, and giving
 * settings a second table of their own would give the change log two
 * writers and the admin pane two shapes to render.
 *
 * VALIDATED HERE AND NOWHERE ELSE. A value that reaches the table is a
 * value some page will act on, and the readers downstream are all
 * deliberately forgiving: floorOf() in server/charts-agg.js answers its
 * own shipped default for a value it cannot use, since "answering on a
 * grid nobody has would be worse than answering on the default one".
 * That forgiveness is correct for a row `wrangler d1 execute` wrote and wrong
 * as a substitute for refusing a bad write, which is why the strictness
 * is on this side: an admin who types "five" is told, rather than
 * watching a floor silently stay 0.
 *
 * EVERY VALUE IS TEXT, because `site_content.value` is TEXT and the
 * route that writes it takes text (a route accepting an object would be
 * storing a shape no page knows how to draw). So `chart.floor` is the
 * SPELLING of a whole number and the check is on the spelling: "5.0" and
 * "05" both parse to numbers, and neither is what an admin typed to two
 * different readers.
 *
 * AN EMPTY STRING IS A REAL VALUE for two of them and is refused for the
 * third. Empty means "not locked" for `chart.lockedUnit` and "follow the
 * visitor's own system" for `site.defaultTheme` - both are states the
 * shipped code already has, so an admin needs a way back to them that is
 * not "delete the row". `site.groupName` has no such state: a site with
 * no name over the door is a broken page, and the way back to the
 * spec's own name is DELETE /content/site.groupName.
 */
const MAX_GROUP_NAME = 64;

/*
 * The door's welcome paragraph, bounded far below MAX_CONTENT_VALUE.
 *
 * The ceiling on this one is about a rendered page rather than about
 * storage: the value replaces a paragraph the door ships with, and a
 * value that cannot fit the space it draws in is a broken page the
 * admin who typed it cannot see from the settings pane. Generous for a
 * paragraph, short of an essay.
 */
const MAX_WELCOME_TEXT = 500;

/*
 * A floor is a count of PEOPLE, so its ceiling is about the size of a
 * group rather than about the size of a number. Anything at or past
 * this hides every cell in any group this binder is for, which is a
 * setting an admin can reach on purpose but never by a typo of one
 * digit too many.
 */
const MAX_FLOOR = 999999;

/*
 * The palettes, named here because the file that paints them cannot be
 * imported by this one.
 *
 * apps/web/theme.js holds the four as the keys of its BG map and is the
 * page-side authority; it is a browser IIFE that exports nothing, so
 * this Worker cannot read it at run time the way it reads
 * apps/web/site.config.js through server/charts-agg.js's import. A
 * second spelling of a set is a thing that can be wrong, so the guard
 * is outside both files: tests/admin-identity.test.mjs parses
 * theme.js's own BG map and this constant and fails if they ever name a
 * different set - the same both-files-derived shape
 * tests/route-precedence.test.mjs uses for API_SEGMENTS and
 * wrangler.toml.
 */
const SITE_THEMES = ["pink", "daylight", "midnight", "contrast"];

/*
 * The unit systems the spec offers, read at call time.
 *
 * globalThis.BINDER_SITE is assigned by apps/web/site.config.js, which
 * server/charts-agg.js imports for its own reading of the same field -
 * so the systems this refuses a value against are the systems the
 * charts are actually binned in, rather than a list kept in step by
 * hand. Read inside the function for the reason charts-agg states: it
 * keeps this file indifferent to the order a bundler evaluates the two
 * modules in.
 */
function unitSystems() {
  const site = globalThis.BINDER_SITE;
  return site && site.units && Array.isArray(site.units.systems)
    ? site.units.systems : [];
}

const SETTINGS = Object.freeze({
  "chart.floor": {
    ok: (value) => /^(0|[1-9][0-9]*)$/.test(value) &&
      Number(value) <= MAX_FLOOR,
    error: "The floor is a whole number from 0 to " + MAX_FLOOR +
      ", written in digits.",
  },
  "chart.lockedUnit": {
    ok: (value) => value === "" || unitSystems().indexOf(value) !== -1,
    error: "The locked unit is one of the systems this form offers, or " +
      "is left empty for no lock.",
  },
  "site.groupName": {
    ok: (value) => value.trim() !== "" && value.length <= MAX_GROUP_NAME,
    error: "A group name is text, up to " + MAX_GROUP_NAME + " characters.",
  },
  "site.welcomeText": {
    ok: (value) => value.length <= MAX_WELCOME_TEXT,
    error: "The welcome text is up to " + MAX_WELCOME_TEXT + " characters.",
  },
  "site.defaultTheme": {
    ok: (value) => value === "" || SITE_THEMES.indexOf(value) !== -1,
    error: "A default theme is one of: " + SITE_THEMES.join(", ") +
      ", or is left empty to follow the visitor's own setting.",
  },
});

/*
 * The settings names folded to lower case, so a spelling that differs
 * only in case can be told apart from a name that is not a setting at
 * all.
 *
 * The hole this closes: with upper case admitted above, an admin could
 * write `Chart.Floor` as ordinary free content, and the case-collision
 * check would then refuse `chart.floor` forever - one settings key made
 * unsettable by a row that never looked like a setting.
 */
const SETTINGS_BY_FOLD = new Map(
  Object.keys(SETTINGS).map((name) => [name.toLowerCase(), name]));

/*
 * The three names GET /config serves, and the whole of what it may
 * serve (0.9-M3-S8, #414 scope 4).
 *
 * An ALLOW-LIST, checked twice on purpose. The statement binds exactly
 * these names, which is what stops a fourth row leaving the database at
 * all; handleReadConfig then REFUSES any row that is not one of them
 * rather than dropping it, so a statement somebody widens later answers
 * 500 instead of quietly serving what it found. The second wall would
 * be pointless if it filtered - a filter makes a widened statement
 * invisible, which is the failure the wall is for.
 */
const PUBLIC_CONFIG = Object.freeze([
  "site.groupName", "site.welcomeText", "site.defaultTheme",
]);

/*
 * The statement, built FROM the allow-list rather than beside it.
 *
 * A hand-written `IN (?, ?, ?)` with the names bound one by one is the
 * shape where the two drift: a fourth name added above would then be
 * refused by the wall in handleReadConfig while never being asked for,
 * which reads as a working allow-list and proves nothing about the
 * statement. Derived, the list is the single place a name is added or
 * removed - and the mutation that adds one really does widen what the
 * database is asked for, which is the state
 * tests/admin-identity.test.mjs pins from both directions.
 */
const PUBLIC_CONFIG_SQL = "SELECT name, value FROM site_content WHERE " +
  "name IN (" + PUBLIC_CONFIG.map(() => "?").join(", ") + ")";

/*
 * THE FIELD-SPEC OVERLAY: one `site_content` row per categorical field,
 * named `field.` plus the field's own id (0.9-M3-S11, #419; the ruled
 * design #385, rules 6, 7 and 8).
 *
 * WHY THIS TABLE. It already holds admin-owned, page-read values with
 * an audit column and a change-log writer, which is the same re-use
 * SETTINGS above makes. A second table would give the log two writers
 * and the admin pane two shapes to render, and neither buys anything
 * the namespace does not.
 *
 * WHAT COMPOSES AND WHAT STAYS CODE. DESIGN.md, "Where configuration
 * lives", draws the line at whether a wrong value gets sealed into a
 * row and read back much later, and a BOUND is the thing that does: a
 * weight typed against a wrong ceiling is a plausible record nobody can
 * tell from a real one. A choice field carries no bound. Its values are
 * strings the spec listed, and a value the spec stops listing reads as
 * unstated rather than as a wrong number - so the categorical half is
 * data an admin edits and the measured half is a release somebody read,
 * which is #385 rule 6 arriving at the same line from the other side.
 *
 * THE NAMESPACE IS FENCED AT EVERY DOOR ONTO THIS TABLE. GET /content
 * answers a caller with no credential, so these rows are refused that
 * route in the statement AND again in the reader - the same two walls
 * PUBLIC_CONFIG stands behind, for the same reason: a filter makes a
 * widened statement invisible. POST /content and DELETE /content/<name>
 * refuse the namespace outright, so a field row can only be written by
 * the route that validates one.
 */
const FIELD_PREFIX = "field.";

/*
 * The pattern both content reads bind, one including the namespace and
 * the other excluding it. Built from FIELD_PREFIX rather than written
 * out, so the two statements and the two walls cannot come apart.
 *
 * `_` is a single-character wildcard in LIKE and `%` is the rest; the
 * prefix carries neither, so this pattern means what it reads as.
 */
const FIELD_LIKE = FIELD_PREFIX + "%";

/*
 * A field id, and a value id: one charset, LOWER CASE ONLY.
 *
 * Narrower than CONTENT_NAME's tail, which 0.9-M3-S8 widened for the
 * camel-cased settings names, and the difference is what these ids are.
 * A field id is a KEY INSIDE A SEALED RECORD and a value id is the
 * string stored under it, so two ids differing only in case would be
 * two different answers on one form with nothing able to say which row
 * meant which - and unlike a settings name, no ruled spelling forces
 * the widening: every id here is either a shipped field's own `name` or
 * one this Worker mints, and both are lower case.
 *
 * Forty-eight characters, so FIELD_PREFIX plus an id still fits inside
 * CONTENT_NAME's sixty-four and the row is addressable as content.
 */
const SPEC_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/*
 * A field's label, its term inside a sentence, its blank line and one
 * value's label: each is a word somebody reads on a form rather than
 * prose, and MAX_CONTENT_VALUE is the wrong ceiling for all four.
 */
const MAX_FIELD_LABEL = 64;

/*
 * How many values one field may carry, RETIRED ONES COUNTED.
 *
 * Retired values stay in the row forever - that is what makes
 * un-retiring possible and what stops a minted id landing on one a
 * member's stored answer already uses - so the bound has to be on the
 * row's whole history rather than on what is offered today. A hundred
 * is far past any list a person picks from and far short of a document
 * that costs anything to serve on every page load.
 */
const MAX_FIELD_VALUES = 100;

/*
 * How many fields the effective spec may hold, shipped ones counted.
 *
 * Every categorical field is a block in the group-makeup answer and a
 * dimension in the charts' filter chips (#384), so this is a bound on
 * work per request rather than on storage. Forty is a form far longer
 * than anybody fills in, which is the right side to be wrong on.
 */
const MAX_SPEC_FIELDS = 40;

/*
 * What an admin means by a rename (#385 rule 8), and the reason there
 * are two words rather than a guess.
 *
 * `relabel` is the same thing re-worded: the value keeps its stable id,
 * so every sealed answer already stored follows the new word instantly.
 * `replace` is a genuinely new option: the old id retires under the
 * word it had, and a new id is minted for the new one, so stored
 * answers keep the retired value and stop being counted under either.
 * The two are indistinguishable from the request alone, which is why
 * this Worker refuses a rename that does not say which.
 */
const RENAME_MODES = ["relabel", "replace"];

/*
 * The overlay row's own format version.
 *
 * A stored format that changes takes a new number and a decoder for
 * both, never a regenerated row (AGENTS.md, "Code standards"), and a
 * row this Worker cannot read falls back to the shipped field rather
 * than serving an empty one - which is the safe direction for a
 * deployment rolled back under rows a newer one wrote.
 */
const FIELD_FORMAT = 1;

/*
 * The two reads of `site_content` that split it in half, written from
 * one pattern so neither can drift out of agreement with the other.
 *
 * The excluding one is GET /content's, and the exclusion is in the
 * STATEMENT rather than in the loop that serializes the answer: what
 * stops a field row leaving the database at all is that the database
 * was never asked for one.
 */
const CONTENT_ROWS_SQL = "SELECT name, value FROM site_content " +
  "WHERE name NOT LIKE ? ORDER BY name";
const FIELD_ROWS_SQL = "SELECT name, value FROM site_content " +
  "WHERE name LIKE ? ORDER BY name";

/*
 * Whether a content name addresses the field namespace.
 *
 * FOLDED, because LIKE is folded: SQLite compares ASCII case-
 * insensitively in a LIKE, so `Field.Gender` is a row the excluding
 * statement above withholds and the including one hands over. A test
 * written byte for byte here would disagree with both statements about
 * exactly the row `wrangler d1 execute` is the way to write.
 */
function isFieldName(name) {
  return String(name).toLowerCase().startsWith(FIELD_PREFIX);
}

/*
 * One row of `site_content`, written or replaced.
 *
 * One home for the statement because two routes issue it - the copy
 * route and the field-spec route - and an UPSERT spelled twice is a
 * conflict clause that can be right in one place and wrong in the
 * other. The audit column is `writerOf(caller)`, which is the account
 * id or the break-glass literal, never an invented id.
 */
async function writeContentRow(env, name, value, caller) {
  await env.DB.prepare(
    "INSERT INTO site_content (name, value, updated_at, updated_by) " +
    "VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET " +
    "value = excluded.value, updated_at = excluded.updated_at, " +
    "updated_by = excluded.updated_by"
  )
    .bind(name, value, new Date().toISOString(), writerOf(caller))
    .run();
}

/*
 * How many change-log lines one read hands back.
 *
 * The log is append-only and nothing prunes it, so an unbounded read is
 * a response that grows without limit on a table that only grows. The
 * newest hundred answers "what changed lately", which is the question
 * the surface asks; anything older is a database read, the same way
 * every other archive here is.
 */
const ADMIN_LOG_LIMIT = 100;

/*
 * How much of a written value the log records.
 *
 * Enough to see what a setting was changed to - every settings value is
 * far shorter than this - and far short of copying a kilobyte of site
 * copy into a second table nothing keeps in step with the first. The
 * value itself is in `site_content`, which GET /content serves without
 * a credential.
 */
const MAX_LOG_SUMMARY = 200;

/*
 * How stale a directory row must be before the departed list will even
 * ask about it (0.9-M3-S15, #420; the ruled design #385, rule 4).
 *
 * STALENESS IS THE PRE-FILTER AND NEVER THE VERDICT. `last_seen_at`
 * moves forward on every verified sign-in, so a row nobody has touched
 * in a month belongs to somebody who has not signed in for a month -
 * which is not the same fact as having left the group, and must never
 * be read as it. A member on holiday is stale; a member who left is
 * departed; only the bot can tell the two apart, and departedVerdict()
 * is the only thing that says which. What this number buys is a bound
 * on how many accounts the list asks about at all.
 *
 * Thirty days rather than a shorter window because the cost of being
 * wrong is asymmetric: a departed member who stays on the list one
 * cycle longer costs nothing, and a current member dragged into an
 * erasing surface costs the thing #385 rule 4 is careful about.
 */
const DEPARTED_STALE_DAYS = 30;

/*
 * How many stale rows one request may ask the bot about.
 *
 * Each candidate is one getChatMember call, so an unbounded list would
 * make a single admin request into as many outbound calls as the
 * directory has rows - a self-inflicted rate limit at best, and at
 * worst a request that never returns. The list is ordered oldest-first,
 * so the accounts most likely to have left are the ones a capped read
 * reaches; the rest arrive on the next read once these are cleared.
 */
const DEPARTED_LIST_CAP = 50;

/*
 * What an admin is told about an account an operator's list is holding
 * open (Prime's ruling on review finding F3, 2026-08-21: never
 * attribute to the bot what the bot did not say).
 *
 * ONE STRING, TWO SURFACES, because the list and the erase are the same
 * fact reached twice: an admin reads it on the row and meets it again
 * on the refusal, and two hand-kept wordings would be two chances for
 * one of them to drift back into speaking for Telegram. Either
 * always_allow arm - the deployment secret or the `membership` row -
 * answers "member" before any call is made, so this account's departed
 * state is the operator's decision and not the group's.
 *
 * IT NAMES THE NEXT ACTION, which is the whole reason it exists.
 * Removing the always_allow entry is the only thing that changes this
 * answer, and an admin met with a bare refusal has no way to learn
 * that: the bypass is a deployment secret on one arm and a role row on
 * the other, and neither is visible from the cleanup surface.
 */
const ALLOWED_BY_LIST =
  "allowed by the operator's list - remove it there first";

/*
 * The two ways an account is unknown, told apart (review finding F4).
 *
 * Both mean "the question could not be asked" and both fail closed
 * identically - that part is deliberate and unchanged. What differs is
 * the NEXT ACTION, and the reason string is the only thing an admin
 * acts on. A record with no sealed id is fixed by that member signing
 * in, and by nothing else; a Telegram outage is fixed by waiting, and a
 * next sign-in will not touch it. Printing the sign-in wording over an
 * outage told an admin to wait for the wrong event.
 */
const UNKNOWN_UNTIL_SIGN_IN = "unknown until next sign-in";
const UNKNOWN_BOT_SILENT =
  "Telegram could not be asked, so try again shortly";

/*
 * How much of an account id the change log records for an erase.
 *
 * ENOUGH TO TELL TWO ERASES APART, and deliberately not the whole HMAC.
 * The log is read to answer "what happened to this group's data", and a
 * prefix answers that; a full id would let the log be joined against
 * `submissions` and `membership` rows that still exist for everybody
 * else, turning the paper trail into a second index over the members
 * who remain. Twelve hex characters is forty-eight bits, which is far
 * past collision inside one group's roster and far short of a key.
 */
const SHORT_ID_CHARS = 12;

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

/*
 * Who wrote a row, when the writer might be a secret rather than a
 * person. A break-glass EXPORT_TOKEN caller is an admin with no
 * account, so an audit column has to say that: inventing an account id
 * would attribute an act to somebody who did not do it, and a null
 * reads as "nobody recorded it" rather than as "this was the way back
 * in being used". The literal cannot collide with an account id, which
 * is sixty-four hex characters.
 *
 * It is also the fourth value GET /me's `adminVia` can carry, for the
 * same reason and by the same word: a break-glass caller is an admin,
 * and none of the three admin paths is how (0.9-M3-S8, #414).
 */
const BREAK_GLASS = "break-glass";

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
 * How long ANY session may go unused before it stops working.
 *
 * ONE RULE EVERYWHERE, which is DESIGN.md, "Sessions", in one constant.
 * The pre-0.9 shape exempted member sessions and argued the exemption
 * from a member page that held no history and no plaintext worth
 * leaving on a screen. 0.9's your-page shows the member their whole
 * history, so the premise is false and the exemption goes with it - a
 * tab left open on somebody's own record is the thing this bounds, and
 * whose record it is does not change that. The admin half of the
 * argument is unchanged and is why the number is this one
 * (ASD STIG V-222390, #91).
 *
 * Fifteen minutes rather than the STIG's ten for a privileged session,
 * because what this side can measure is requests and not attention: a
 * page that has already been served its data is then read with nothing
 * crossing the wire, so a window tight enough to be an attention timer
 * would end the session in the middle of a read. The timer that can see
 * real interaction belongs on the page, and DESIGN.md fixes the
 * ordering rather than either value: the page's window is deliberately
 * SHORTER than this one, so the page always acts first, on its own
 * initiative, warning before it acts. This is the backstop for the case
 * where the page never gets to run it - the tab killed, the browser
 * gone, the token captured. Any authenticated request slides it, so
 * that timer needs no route added here to hold it open.
 *
 * The number is not repeated in DESIGN.md on purpose: that document
 * says every lifetime and window is a constant in this file, and a
 * second copy of one is a thing that can be wrong.
 *
 * The caps in SESSION_HOURS are untouched by this and still bound a
 * session that is being used; revokeAccountSessions() below states the
 * one residual neither a cap nor a window closes.
 */
const SESSION_IDLE_MINUTES = 15;

// Telegram signs the moment you pressed the button. A payload older
// than this is refused, which is what stops a captured one being a
// permanent credential - nothing else in it expires. Telegram's own
// guidance allows a day; the page posts it the instant it arrives, so
// five minutes is enough and the difference is the window in which a
// stolen payload is worth anything.
const AUTH_FRESHNESS_SECONDS = 300;

/*
 * The other edge of the same window: how far ahead of this Worker's
 * clock a payload may be dated.
 *
 * A named constant rather than a literal because it is a SECOND
 * refusal and not a rounding allowance on the first. Telegram's clock
 * and Cloudflare's are not the same clock, so a payload arriving a few
 * seconds "in the future" is ordinary; one dated minutes ahead is a
 * payload whose freshness window has been extended by whoever wrote the
 * field, which is the ceiling above defeated from the other side.
 */
const AUTH_SKEW_SECONDS = 60;

/*
 * What auth_date is allowed to look like, read as written.
 *
 * Number() is not a shape check: it trims whitespace, reads "1e12" and
 * "0x10" as numbers, and turns null into 0. Every one of those would
 * pass a Number.isFinite() test and none of them is the seconds-since-
 * the-epoch integer Telegram signs. The field is inside the HMAC, so
 * this is defense in depth rather than the first gate - but a shape
 * check the caller cannot reach around is cheap, and "the signature
 * covers it" is exactly the reasoning that stops holding the day a
 * signing key is shared with something else.
 *
 * Fifteen digits is past any epoch second this system will see and
 * short of a number a string comparison should be asked to carry, the
 * same bound TELEGRAM_ID above is chosen for.
 */
const AUTH_DATE = /^[0-9]{1,15}$/;

/*
 * How long a spent payload is remembered, so it cannot be spent twice.
 *
 * The two guards compose rather than overlap, and the arithmetic is the
 * whole reason this is neither AUTH_FRESHNESS_SECONDS alone nor simply
 * the sum of the two window edges. A payload stops being fresh at
 * auth_date + AUTH_FRESHNESS_SECONDS, and auth_date may legitimately be
 * as much as AUTH_SKEW_SECONDS ahead of now - so a row that lived only
 * for the freshness window could age out while its payload was still
 * inside one, which would re-open exactly the replay this table exists
 * to refuse. That sum is the floor; the trailing + 1 is what makes the
 * property strictly true rather than true only to the whole second.
 *
 * Freshness is counted in WHOLE seconds: verifyTelegramPayload() floors
 * Date.now() to seconds before subtracting auth_date, so a payload is
 * accepted through the ENTIRE final second - fresh right up to
 * auth_date + AUTH_FRESHNESS_SECONDS + 1 seconds, one millisecond short
 * of that. The replay row, by contrast, expires in MILLISECONDS at the
 * claim instant plus this many seconds. Held for exactly
 * AUTH_FRESHNESS_SECONDS + AUTH_SKEW_SECONDS the row can therefore fall
 * due as much as 999 ms BEFORE its payload stops being acceptable - a
 * sub-second window in which the prune inside claimPayload() deletes a
 * spent row while a replay of it would still pass freshness. The extra
 * second covers exactly that flooring: with it the row's expiry lands
 * strictly after the last millisecond the payload is acceptable, at
 * every sub-second alignment of the claim instant. The skew-ceiling
 * boundary is armed in tests/telegram-auth.test.mjs, both directions.
 */
const REPLAY_HOLD_SECONDS = AUTH_FRESHNESS_SECONDS + AUTH_SKEW_SECONDS + 1;

/*
 * How long the group check may take before it is abandoned.
 *
 * A fetch with no bound is a sign-in with no bound: a Telegram that
 * accepts the connection and then says nothing holds the request open
 * for the platform's own ceiling, and the member is left looking at a
 * page that has not refused and has not signed them in. Abandoning is
 * safe here precisely because the abandoned answer is "unknown", which
 * already refuses - see groupStanding(). Five seconds is far past a
 * healthy getChatMember and far short of anybody's patience.
 */
const GROUP_CHECK_TIMEOUT_MS = 5000;

// Being in the group, as Telegram spells it. `restricted` is still a
// member unless it says otherwise, which is why it cannot simply be
// tested for equality.
const MEMBER_STATUSES = ["creator", "administrator", "member", "restricted"];

/*
 * Administering it, as Telegram spells that - a SUBSET of the list
 * above rather than a list beside it (0.9-M3-S8, #414; the ruled
 * design #385, rule 1 - two ways in, one tier).
 *
 * Both of these are member statuses first: a creator and an
 * administrator are in the group, so they sign in for the same reason
 * everybody else does, and this list only decides whether the session
 * they get is an admin one. Written as a subset rather than as a
 * separate list because the moment the two disagree - a status that
 * administers without being a member - the sign-in path would grant
 * admin to somebody groupStanding() had already refused.
 */
const GROUP_ADMIN_STATUSES = ["creator", "administrator"];

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

/*
 * The one thing that reaches the store's accountId context is the
 * account-id HMAC, and this refuses anything else BEFORE a seal or an
 * open (0.9-M1-S6, #332, security mandate 1; #294 F6). sessionFor()
 * returns row.account_id, which is that HMAC for a real member - but a
 * raw Telegram numeric id, a bare user.id, or a "dev:"-namespaced dev
 * subject would each be a caller identity that is NOT the HMAC, and
 * binding a row to one of those would put the membership oracle back
 * inside the ciphertext where no dump-reveals-nothing property could
 * reach it (DESIGN.md, "The identifier is the whole problem"). So the
 * shape is asserted here rather than trusted: sixty-four lowercase hex
 * characters, the same ACCOUNT_ID pattern the account id is written
 * with. What this throw guards against is a RAW identity - a bare
 * numeric id, a user.id, or an un-HMAC'd "dev:"-namespaced string -
 * reaching the crypto. The "dev:" spelling is named among them because a
 * namespaced subject is still a subject: it is only safe once it has
 * been through accountIdFor, and a session row written by hand can carry
 * whatever its author typed (0.9-M2-S1, #352). This throws
 * rather than returning a refusal shape a caller chose: on a Worker
 * signing real members in it can only fire on a bug, and a bug that binds
 * a row to the wrong identity must be loud, not a 4xx a page interprets.
 */
function rowIdentity(accountId) {
  if (typeof accountId !== "string" || !ACCOUNT_ID.test(accountId)) {
    throw new Error("row identity is not an account-id HMAC");
  }
  return accountId;
}

/*
 * Uint8Array <-> base64, so a sealed row (bytes) rides the TEXT
 * `ciphertext` column. btoa/atob rather than Buffer because Buffer is
 * not in the Workers runtime; a sealed row is a few KB, well within the
 * spread the chunked loop avoids needing to worry about at all.
 */
function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/*
 * A row's DB id, assigned here rather than by AUTOINCREMENT, and the
 * reason is the AAD (0.9-M1-S6, #332, security mandate 2). The record's
 * own id is bound into the ciphertext, so a row lifted to another id
 * fails to open - which means the id has to be known BEFORE the seal.
 * An autoincrement id is known only AFTER the insert, so binding it
 * would force a seal-then-update over a half-written row; choosing the
 * id here keeps the write a single atomic INSERT of already-sealed
 * bytes. It is a random 48-bit integer: unique enough that a collision
 * is astronomically unlikely for one small group's corpus, caught by
 * the PRIMARY KEY when it does (handleSubmit retries), and - unlike a
 * sequence - it leaks no row count and no ordering. The listing orders
 * by received_at because the id no longer carries time.
 */
function randomRowId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let id = 0;
  for (const byte of bytes) id = id * 256 + byte;
  return id + 1;
}

/*
 * The record half of a directory record's AAD, bound alongside the
 * account-id HMAC (security mandate 2). server/schema.sql keys the
 * `directory` table on account_id and holds exactly one row per member,
 * so the account is what separates one directory record from another and
 * this slot id is a stable constant rather than a per-record value - the
 * job an entry row's own random id does is already done here by the
 * account. What it earns is the cross-purpose and cross-account
 * bindings: server/store-crypto.js's boundData() binds purpose, account
 * and record together, so a record sealed for this slot under one
 * account cannot open under another account's context, and a directory
 * record and an entry row cannot open as each other.
 */
const DIRECTORY_SLOT = "directory";

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
 * Separate from adminVia() below because the migration needs to ask
 * this half on its own: handleReadMembership answers which admins the
 * secret grants that the table has not been told about, and that
 * question has no answer if the arms are only ever folded together.
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
 * WHO ADMINISTERS AND WHY, IN ONE FUNCTION - null if they do not
 * (0.9-M3-S8, #414; the ruled design #385, rule 1).
 *
 * ONE FUNCTION AND NOT TWO. A set of account ids answers whether and
 * cannot say which arm matched, and the answer has to: GET /me reports
 * it, and sessionFor() needs it to know which arms it may re-check at
 * all. Splitting whether from why would be two reads of the same table
 * per request and two places a new arm could be forgotten.
 *
 * THREE WAYS IN AND ONE TIER. Nothing anywhere below branches on which
 * of these a session holds, and that is the ruling rather than an
 * omission. What the value is for is telling a person which lever
 * applies to them: a flag another admin can take off, a group role that
 * lives in Telegram, or a deployment secret no page can reach.
 *
 * THE ORDER IS BY WHAT SOMEBODY CAN ACT ON, not by precedence in any
 * authority sense: an account can be all three at once and the powers
 * are identical either way. 'telegram' first because it is the one the
 * group's own membership decides; then 'flag', the row an admin can see
 * in the role list and remove; then 'secret', last because it is the
 * bootstrap and the only one invisible from inside the product.
 *
 * THE DUAL READ IS THE SHIPPED POSTURE, not a step passed through, and
 * that is what the 'flag' and 'secret' arms are (#69). Flipping to
 * table-only before a backfill would take authority away from every
 * admin the secret names and the table does not, so the order is
 * dual-read, verify, flip - and what makes the middle step possible is
 * handleReadMembership's `secretOnly`, the only place the two arms can
 * be compared at all: the secret holds numeric ids and the table holds
 * HMACs of them, so nothing outside this Worker can line them up.
 * Whatever the flip does, the founding admin stays in the secret. A
 * table that could rewrite the whole list leaves no root of trust
 * outside itself.
 *
 * RECOMPUTED PER REQUEST ON PURPOSE. A cache would be a copy of the
 * admin list living somewhere other than the places that own it, which
 * is precisely the stale-admin bug this exists to remove - and it is
 * what makes removing a row take effect on the next request rather than
 * whenever a session happens to expire.
 *
 * `status` IS THE GROUP ROLE FROM THIS SIGN-IN and never a stored one.
 * It is null everywhere except inside handleTelegramAuth, which is the
 * only place a numeric id REACHES THIS DECISION - see groupStanding().
 * So the 'telegram' arm is unreachable on any later request, which is
 * exactly why sessionFor() has to read that one from the session row.
 *
 * Reaching this decision is a narrower claim than being in hand, and
 * the difference is deliberate: since 0.9-M3-S15 (#420) a sealed
 * numeric id exists in the directory record, and departedVerdict()
 * holds one during a request on both /admin-departed routes. Neither
 * reaches this function. Unsealing that id per request to re-ask the
 * group role is the per-request re-check the design has declined twice,
 * and departedVerdict() is the one reader the owner's ruling attached
 * to that field.
 */
async function adminVia(env, accountId, status) {
  if (typeof status === "string" && GROUP_ADMIN_STATUSES.includes(status)) {
    return "telegram";
  }
  if ((await membershipAccountIds(env, "admin")).has(accountId)) return "flag";
  if ((await secretAdminAccountIds(env)).has(accountId)) return "secret";
  return null;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    // PUT is here for PUT /admin-fields/<id> (0.9-M3-S11, #419). A
    // method the preflight does not name is a method the browser
    // refuses before the request is made, so a route added without its
    // verb here works from curl and never from the admin page.
    "Access-Control-Allow-Methods": "POST, PUT, GET, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: VARY,
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign(
      { "Content-Type": "application/json", Vary: VARY },
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
  // caller already guards this - `Boolean(env.EXPORT_TOKEN)` refuses
  // before getting here - but a
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

  /*
   * Freshness, in three refusals rather than one, because they fail for
   * three different reasons and a reader changing one should not have to
   * work out which of the others they just moved.
   *
   * The shape first: AUTH_DATE says why reading the field as written
   * beats coercing it. Then the two edges. Without the ceiling a
   * captured payload never expires and is a permanent credential; without
   * the floor the same payload dated far enough ahead buys itself an
   * arbitrarily long one, which is the ceiling defeated by arithmetic.
   */
  if (!AUTH_DATE.test(String(payload.auth_date))) return null;
  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate)) return null;
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age > AUTH_FRESHNESS_SECONDS) return null;
  if (age < -AUTH_SKEW_SECONDS) return null;

  return payload;
}

/*
 * One session per payload, claimed atomically.
 *
 * WHAT THIS ADDS THAT FRESHNESS DOES NOT. A verified payload is a bearer
 * credential for the length of the freshness window: anybody who
 * captures it inside those five minutes can present it again and be
 * issued a session of their own, alongside the one the real member is
 * already holding. The window bounds how long that is worth doing; it
 * cannot make the payload single-use. This can.
 *
 * THE CLAIM IS THE INSERT, and that is the load-bearing part. Reading
 * the table and then writing to it leaves a gap two simultaneous posts
 * both fit through - the same race the `submissions` unique index
 * exists for, arriving at a route where losing it mints a credential.
 * `ON CONFLICT DO NOTHING` over a primary key makes the database decide,
 * once, and `changes` reports which caller won: 1 is a claim, 0 is a
 * payload already spent. Nothing here matches on an error string.
 *
 * A HASH OF THE HASH is what is stored. payload.hash is itself a
 * credential inside its window, so keeping it in a table would be
 * keeping spent-but-not-yet-stale credentials in the clear - the same
 * reasoning that keeps the session token out of `sessions`, applied to
 * something with a shorter life. SHA-256 is as good a key for a lookup
 * and useless to whoever reads the table.
 *
 * FAILING CLOSED. A throw here refuses the sign-in rather than falling
 * through to issue one: an unreadable replay table is the one condition
 * under which this guard cannot be honored, and a guard that yields
 * when its storage is unwell is not a guard. The member sees the same
 * refusal every other unverifiable sign-in gets and can simply press
 * the button again, which mints a new payload with a new hash.
 *
 * The prune runs after the claim, never before it, so housekeeping
 * cannot be what decides whether the guard held.
 */
async function claimPayload(env, payloadHash) {
  const now = Date.now();
  let claimed;
  try {
    claimed = await env.DB.prepare(
      "INSERT INTO auth_replay (payload_hash, expires_at) VALUES (?, ?) " +
      "ON CONFLICT(payload_hash) DO NOTHING"
    ).bind(
      await sha256Hex(payloadHash),
      new Date(now + REPLAY_HOLD_SECONDS * 1000).toISOString()
    ).run();
  } catch (e) {
    return false;
  }

  if (!claimed || !claimed.meta || claimed.meta.changes !== 1) return false;

  try {
    await env.DB.prepare("DELETE FROM auth_replay WHERE expires_at <= ?")
      .bind(new Date(now).toISOString()).run();
  } catch (e) {
    // Housekeeping. The claim above already succeeded, and a table that
    // grows is a smaller problem than a sign-in refused for it.
  }
  return true;
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
 *
 * IT RETURNS TWO THINGS SINCE 0.9-M3-S8 (#414), and only one of them
 * decides the sign-in. `standing` is the three-way verdict everything
 * above argues about and it is unchanged: member, left, unknown, and
 * anything but "member" refuses. `status` is the raw word Telegram
 * used, and it rides along for one reason - #385 rule 1 makes a group
 * creator or administrator an admin, and this call is the only moment
 * anything here knows which one somebody is.
 *
 * `status` IS NULL WHENEVER THE ANSWER DID NOT COME FROM THE GROUP, and
 * that is the property that keeps the two halves from being confused
 * for each other. Both allow arms return "member" with no status: a
 * break-glass bypass is a way past the membership check, not evidence
 * of a role inside the group, and reading it as one would let
 * ALWAYS_ALLOW_TELEGRAM_IDS mint admins. An unreachable Telegram is
 * null for the same reason it is "unknown".
 *
 * `bypassed` SAYS SO OUT LOUD rather than leaving it to be inferred
 * from the null (0.9-M3-S15 fix wave 1, review finding F3). A caller
 * that has to work out "member with no status must mean an operator
 * allowed them" is one refactor away from getting it wrong, and the
 * departed check got it wrong in exactly that shape: it told an admin
 * "Telegram says that account is still in the group" about an account
 * Telegram was never asked about, and could say so while the bot would
 * have said the opposite. Sign-in ignores this field - both arms are
 * "member" there and always were - so what it adds is a caller's
 * ability to refuse to speak for the bot.
 */
async function groupStanding(env, userId) {
  if (idList(env.ALWAYS_ALLOW_TELEGRAM_IDS).includes(String(userId))) {
    return { standing: "member", status: null, bypassed: true };
  }
  if ((await membershipAccountIds(env, "always_allow"))
    .has(await accountIdFor(env, userId))) {
    return { standing: "member", status: null, bypassed: true };
  }
  if (!env.TELEGRAM_GROUP_CHAT_ID) return { standing: "unknown", status: null };

  const url = "https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN +
    "/getChatMember?chat_id=" +
    encodeURIComponent(env.TELEGRAM_GROUP_CHAT_ID) +
    "&user_id=" + encodeURIComponent(String(userId));

  let body;
  try {
    body = await (await fetch(url, {
      signal: AbortSignal.timeout(GROUP_CHECK_TIMEOUT_MS),
    })).json();
  } catch (e) {
    // Unreachable Telegram is not a reason to let people in, and not
    // evidence that anybody left either. A timeout arrives here as a
    // throw and is therefore the same "unknown" - deliberately, because
    // "the answer did not come" and "the answer could not be read" are
    // the same fact to everything downstream.
    //
    // `e` is discarded rather than reported, and that is not tidiness:
    // the bot token is interpolated into the URL above, and a fetch
    // failure names the URL it failed on. Logging this error logs the
    // token.
    return { standing: "unknown", status: null };
  }
  if (!body || body.ok !== true || !body.result) {
    return { standing: "unknown", status: null };
  }
  const status = body.result.status;
  if (MEMBER_STATUSES.includes(status)) {
    // A restricted member who has actually left says so here.
    return status === "restricted" && body.result.is_member === false
      ? { standing: "left", status: status }
      : { standing: "member", status: status };
  }
  return {
    standing: LEFT_STATUSES.includes(status) ? "left" : "unknown",
    status: status,
  };
}

/*
 * End every session one account holds.
 *
 * The lever behind #136, and it fires from exactly one place -
 * handleTelegramAuth, when Telegram has definitively said this person is
 * no longer in the group. NOT from sessionFor(), which cannot ask the
 * question: a session row carries `account_id`, the HMAC of a Telegram
 * numeric id, and getChatMember needs the numeric id itself.
 *
 * A NUMERIC ID DOES NOW EXIST AT REST, and it deliberately does not
 * change this bound (owner ruling, 2026-08-21, at 0.9-M3-S15, #420). It
 * is sealed inside the DIRECTORY record, and the ruling that allowed it
 * there attached one reader to it: the departed check, which an admin
 * invokes deliberately over a stale roster. Wiring it into sessionFor()
 * instead would make every authenticated request an outbound call to
 * Telegram - a per-request re-check whose cost the design has weighed
 * and declined twice - and would turn one admin-invoked lookup into
 * traffic proportional to the whole site's use. So the bound below
 * stands as written, and this paragraph is here so the next reader
 * knows it was re-examined against the new fact rather than left
 * un-revisited. The bound is:
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
 * absoluteExpiry() is the cap measured from sign-in and never moves, and
 * it is the one place the member and admin caps differ. deadlineAt() is
 * what the row carries: whichever comes first, that cap or the idle
 * window measured from `now` - the same rule for both kinds of session
 * since 0.9-M1-S5, per DESIGN.md, "Sessions". Every write of
 * `expires_at` goes through deadlineAt(), which is what makes the cap
 * un-slideable: a slide that forgot the Math.min would renew a session
 * a quarter of an hour at a time, forever, and nothing else in this
 * file would notice.
 */
function absoluteExpiry(createdAt, isAdmin) {
  const hours = isAdmin ? SESSION_HOURS.admin : SESSION_HOURS.member;
  return createdAt + hours * 3600 * 1000;
}

function deadlineAt(createdAt, isAdmin, now) {
  const absolute = absoluteExpiry(createdAt, isAdmin);
  return Math.min(absolute, now + SESSION_IDLE_MINUTES * 60 * 1000);
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
async function issueSession(env, accountId, via, isDev) {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const token = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  // Adminness is DERIVED from the source rather than passed beside it
  // (0.9-M3-S8, #414). Two arguments that have to agree are two
  // arguments that can disagree, and the disagreement that matters -
  // an admin flag with no source recorded - is exactly the row
  // sessionFor() cannot re-check correctly.
  const isAdmin = via !== null;
  const now = Date.now();
  const expires = new Date(absoluteExpiry(now, isAdmin));

  await env.DB.prepare(
    "INSERT INTO sessions " +
    "(token_hash, account_id, is_admin, is_dev, admin_via, created_at, " +
    "expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(await sha256Hex(token), accountId, isAdmin ? 1 : 0, isDev ? 1 : 0,
      via,
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
 * Using a session is also what resets its idle window, and the row this
 * already read is where that is recorded. A write per request on a row
 * that was going to be read anyway is the small version; a
 * `last_used_at` column would need a second sweep predicate beside the
 * one above, which is a moving part rather than fewer of them. Every
 * session is written now rather than admin rows alone, because the
 * window applies to every session (SESSION_IDLE_MINUTES) - the cost is
 * one small UPDATE per authenticated request, against a corpus that is
 * one Telegram group.
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
 * THE LISTS ARE THE ONLY SOURCE OF ADMINNESS HERE, and a session row
 * carrying is_dev = 1 gets no exemption from them. No route in this
 * Worker writes that flag, so a row that has it was written straight
 * into D1 - a `wrangler d1 execute`, a restored backup - and it is
 * refused for the ordinary reason every other session is: a
 * "dev:"-namespaced account id cannot be a numeric Telegram id's HMAC,
 * so it is in neither list and this re-read makes it a member.
 *
 * That is the fail-closed direction, and it is worth saying out loud
 * because the tempting shape is the other one. An exemption reading the
 * adminness of such a row out of a binding is an exemption that hands
 * admin authority to whoever can write one row, on any deployment where
 * that binding is set (0.9-M2-S1, #352). The flag stays in the schema
 * and `caller.isDev` still refuses an admin-row write, which costs
 * nothing and is a second wall on the same hand-written row; dropping
 * the column is a schema migration for the milestone that owns the
 * table.
 *
 * ---------------------------------------------------------------------
 * ONE SOURCE OF ADMINNESS IS NOW THE ROW ITSELF, AND ONLY ONE
 * (0.9-M3-S8, #414; #385 rule 1). The paragraph above said the lists
 * are the only source; that stopped being the whole truth the moment a
 * Telegram group role could grant admin, because the role CANNOT be
 * re-asked here. getChatMember needs the numeric Telegram id, and this
 * database holds none beside the session on purpose - storing one there
 * is the membership oracle the whole account design exists to kill, and
 * it is the same bound revokeAccountSessions() is written out for.
 *
 * The directory record has held a SEALED numeric id since 0.9-M3-S15
 * (#420, owner ruling 2026-08-21), and that deliberately does not open
 * this door. Unsealing it here would put an outbound Telegram call on
 * every authenticated request; the ruling attached exactly one reader
 * to that field, the admin-invoked departed check, and this is not it.
 *
 * So a row carrying admin_via = 'telegram' keeps its adminness without
 * a list to be found in, and three things bound that rather than one:
 *
 *   1. THE ADMIN CAP, RE-DERIVED FROM created_at ON THIS READ, AND
 *      CLOSED AT BOTH ENDS. Every row this Worker writes already
 *      satisfies it - deadlineAt() never sets an expiry past the cap,
 *      and nothing here writes a created_at in the future - so the
 *      check costs a real session nothing and is aimed squarely at a
 *      row somebody wrote by hand with dates of their choosing.
 *      THE LOWER BOUND IS THE HALF THAT LOOKS REDUNDANT AND IS NOT:
 *      created_at is written by the same statement that would lie
 *      about expires_at, so a window measured only from its start is a
 *      window the writer positions. A row dated an hour ahead sits
 *      inside its own two hours from the moment it is written, and the
 *      slide above renews its expiry on every read, which is a
 *      credential with no end at all. With both ends, one `wrangler d1
 *      execute` buys at most the two hours the cap allows and cannot
 *      buy them starting whenever it likes. Two hours is also the whole
 *      exposure of a demotion in Telegram that this side cannot see.
 *   2. NO DEVELOPMENT SESSION TAKES THIS PATH. is_dev = 1 means
 *      Telegram never authenticated the row, and the one un-re-checkable
 *      path is the last place to make an exception for a session that
 *      arrived by hand.
 *   3. EVERY OTHER VALUE IS STILL RE-READ FROM THE LISTS, including
 *      NULL. A row from before this column, or one whose source is
 *      'flag' or 'secret', is exactly as revocable as it was before -
 *      delisting takes effect on the next request, which is the lever
 *      #69 asked for and this slice does not weaken.
 * ---------------------------------------------------------------------
 */
async function sessionFor(env, token) {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT account_id, is_admin, is_dev, admin_via, created_at, expires_at " +
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

  // An unparseable created_at falls back to `now`, which yields the
  // idle window and never more than it. Unguarded this is
  // new Date(NaN).toISOString(), which throws - so one unreadable row
  // would turn every request on it into a 500 rather than into a
  // shorter session. The same failing-closed shape tokenMatches()
  // carries for an unset secret.
  //
  // The STORED flag decides which cap the slide is bounded by, not the
  // re-read below it: an admin row was handed the whole corpus once,
  // and taking its owner off the admin list does not un-hand it.
  // Reading the re-read instead would give a demoted session the longer
  // member cap, which is the wrong direction for a demotion.
  const created = Date.parse(row.created_at);
  await env.DB.prepare(
    "UPDATE sessions SET expires_at = ? WHERE token_hash = ?"
  ).bind(
    new Date(deadlineAt(Number.isFinite(created) ? created : now,
      row.is_admin === 1, now)).toISOString(),
    tokenHash
  ).run();

  const isDev = row.is_dev === 1;
  let isAdmin = row.is_admin === 1;
  let via = isAdmin && typeof row.admin_via === "string"
    ? row.admin_via : null;
  if (isAdmin) {
    if (via === "telegram") {
      // The three bounds the block above argues, in the order they
      // fail closed: no development row, and no row outside the admin
      // window measured from when it was written rather than from the
      // expiry whoever wrote it chose. `created <= now` is the start of
      // that window and belongs to the same hand-written row the cap is
      // for: without it a future date opens the window instead of
      // closing it.
      const within = Number.isFinite(created) && created <= now &&
        now < absoluteExpiry(created, true);
      isAdmin = !isDev && within;
    } else {
      // The lists, re-read - and the SOURCE re-derived with them rather
      // than trusted from the row, so an admin who was flagged and is
      // now named by the secret instead reads as what is true today.
      // One call, so one read of the table per request.
      via = await adminVia(env, row.account_id, null);
      isAdmin = via !== null;
    }
    if (!isAdmin) via = null;
  }

  /*
   * `accountId` HERE IS THE ACCOUNT-ID HMAC AND NEVER A TELEGRAM
   * NUMERIC ID, and anything downstream that binds a caller to stored
   * data must take it from here rather than deriving one of its own.
   *
   * This is the only identity a route below can reach: the numeric id
   * exists inside handleTelegramAuth for the length of one sign-in and
   * is written to nothing, so a route that wanted one would have to
   * invent a way to get it. Said out loud because the storage work that
   * encrypts rows binds each one to a caller identity, and binding to a
   * raw numeric id would put the membership oracle back inside the
   * ciphertext where no dump-reveals-nothing property could reach it -
   * DESIGN.md, "The identifier is the whole problem". Sixty-four
   * lowercase hex characters is the shape; ACCOUNT_ID is the pattern.
   */
  return {
    accountId: row.account_id,
    isAdmin: isAdmin,
    isDev: isDev,
    adminVia: via,
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
    // Its own source of adminness, named rather than borrowed. Calling
    // it "secret" would put the break-glass token and
    // ADMIN_TELEGRAM_IDS behind one word, and they are answered by
    // different levers: this one is rotated, that one is edited. The
    // literal is the same one the audit columns already carry for it.
    return {
      accountId: null, isAdmin: true, isDev: false, breakGlass: true,
      adminVia: BREAK_GLASS,
    };
  }
  return sessionFor(env, given);
}

function unauthorized(origin) {
  return json({ error: "Not authorized." }, 401, origin);
}

/*
 * The only thing this Worker says out loud about a sign-in.
 *
 * AN ALLOWLIST OF TWO FIELDS, not a habit of being careful. Everything a
 * sign-in touches is either a secret or an identifier that resolves to a
 * person: the bot token, the chat id, the numeric id, the handle, the
 * payload's own hash, the session token and its hash. A log line is
 * durable, it leaves this Worker, and whoever reads it is not
 * necessarily whoever may read the group's membership - so the field
 * list is fixed here rather than decided at each call site, where the
 * next person adding a line has to remember the whole list to get it
 * right.
 *
 * The account id is the one identifier that may travel: it is an HMAC
 * under a secret this Worker holds, so it cannot be worked back to a
 * Telegram id or confirmed against a guessed handle - the property
 * DESIGN.md, "The identifier is the whole problem", turns the whole
 * store on. The reason for a refusal is folded into the event NAME
 * rather than carried as a field, so there is no free-text slot for a
 * later caller to interpolate something into.
 */
function log(event, accountId) {
  console.log(JSON.stringify(
    accountId ? { event: event, accountId: accountId } : { event: event }));
}

/*
 * Refresh one account's directory record from a verified sign-in.
 *
 * THE DIRECTORY IS THE ROSTER, ENCRYPTED AT REST. DESIGN.md, "The
 * identifier is the whole problem", rules the directory INSIDE what is
 * encrypted rather than beside it: a clear-text roster of handles next to
 * the rows is the membership oracle the whole design exists to kill, by a
 * shorter route than any hash of a handle. So the handle, the display name
 * and the role go through sealDirectory (purpose 'dir') and live in the
 * ciphertext; the only clear columns are the account-id HMAC that keys the
 * row and the two timestamps (server/schema.sql, `directory`).
 *
 * THE MEMBERSHIP KEY IS THE ACCOUNT-ID HMAC AND NEVER A RAW ID OR HANDLE.
 * rowIdentity() refuses anything that is not the 64-hex HMAC before a seal
 * is reached (security mandate 3; the same guard the entry rows use), so a
 * raw Telegram id or a handle can never become the clear key of a
 * directory row - which would be the oracle relocated into the one column
 * a dump reads without opening anything. It is the same function the entry
 * rows reach for because it is the same property: the value bound into the
 * store's accountId context is the HMAC, full stop.
 *
 * THE SEAL IS BOUND TO THIS ACCOUNT AND THIS SLOT. The AAD binds the
 * account-id HMAC and DIRECTORY_SLOT, so a record lifted into another
 * account's row fails to open rather than decrypting into it (mandate 2),
 * and purpose 'dir' is half of what boundData() binds, so a directory
 * record cannot open as an entry row nor an entry row as a directory
 * record (mandate 1). server/store-crypto.js is the one door that seals or
 * opens either; this reaches for sealDirectory and nothing else.
 *
 * A RE-SYNC KEEPS joined_at. The UPSERT rewrites the ciphertext and moves
 * last_seen_at forward on every verified sign-in; joined_at is written
 * once and never touched again, so it stays the first-seen date.
 *
 * THE NUMERIC TELEGRAM ID IS IN THIS RECORD, by owner ruling
 * (2026-08-21, at 0.9-M3-S15, #420) rather than by a builder's choice.
 * It exists at rest ONLY inside this sealed blob, under the same key,
 * the same purpose and the same AAD binding as the handle beside it,
 * and for one purpose only - departedVerdict() unseals it to ask the
 * bot whether that member has left, and drops it.
 *
 * WHY IT HAS TO BE HERE, so nobody removes it as an oversight: #385
 * rule 4 gives admins the power to erase a DEPARTED member's rows, and
 * only the bot may say who is departed. getChatMember takes a numeric
 * id; `directory` is keyed by a one-way HMAC of one, and there is no
 * by-username form of that call. So an id this Worker can read is what
 * the ruled power costs, and the two are one decision rather than two.
 *
 * WHAT DID NOT CHANGE, which is most of it. The id is never a column,
 * never an index, never served by any route, never logged, and never
 * read by the per-request admin re-check - sessionFor() still cannot
 * re-ask the group role, and revokeAccountSessions() still ends a
 * leaver's sessions at their next sign-in rather than by polling. A
 * dump of the tables still shows the HMAC and two timestamps and
 * nothing that resolves to a person. The id is as protected as the
 * handle already sealed next to it, which is the whole of the argument
 * the ruling accepted.
 *
 * A record written before that ruling HAS NO id, and every reader must
 * treat its absence as "unknown" rather than as anything else - the
 * departed check refuses to guess, and the row's id arrives when that
 * member next signs in and this UPSERT rewrites the ciphertext.
 */
async function syncDirectoryEntry(store, env, accountId, fields, now) {
  const bound = rowIdentity(accountId);
  const record = JSON.stringify({
    handle: fields.handle,
    displayName: fields.displayName,
    role: fields.role,
    telegramId: fields.telegramId,
  });
  const sealed = bytesToBase64(await store.sealDirectory(
    record, { accountId: bound, recordId: DIRECTORY_SLOT }));
  await env.DB.prepare(
    "INSERT INTO directory (account_id, ciphertext, joined_at, last_seen_at) " +
    "VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET " +
    "ciphertext = excluded.ciphertext, last_seen_at = excluded.last_seen_at"
  ).bind(bound, sealed, now, now).run();
}

/*
 * Signing in.
 *
 * The username is handed back to the page for display, and the account id
 * is the identity that cannot be forged: the id is set server-side from a
 * verified sign-in, while a handle is a label the person can change. See
 * DESIGN.md, "The identifier is the whole problem".
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
    log("signin.refused.unverified");
    return json({ error: "That sign-in could not be verified." }, 401, origin);
  }

  /*
   * Spent, before anything is done with it.
   *
   * Immediately after verification and before every other step, which
   * is the narrowest place it can sit: a payload that reaches the group
   * check twice is a payload that can be made to cost two Telegram
   * calls, and one that reaches issueSession() twice is two credentials
   * from one press of the button.
   *
   * The refusal is byte-identical to the one above it, deliberately.
   * Telling "already used" apart from "does not verify" would report,
   * to anybody holding a captured payload, whether the real member had
   * got there first - and neither answer changes what the caller should
   * do, which is press the button again.
   */
  const claimed = await claimPayload(env, payload.hash);
  if (claimed !== true) {
    log("signin.refused.replay");
    return json({ error: "That sign-in could not be verified." }, 401, origin);
  }

  // A Telegram account without a username has no handle to record, and
  // this binder identifies people by handle - so it says which thing to
  // go and fix rather than storing a blank.
  if (!user.username) {
    log("signin.refused.no-username", await accountIdFor(env, user.id));
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
   * still holding. Sign-in is the only moment this path has the numeric
   * id in hand, so it is the only moment THIS lever can fire - the
   * bound that follows is written out on revokeAccountSessions(), which
   * also records why the sealed id added in 0.9-M3-S15 (#420) does not
   * shorten it.
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
  const { standing, status } = await groupStanding(env, user.id);
  if (standing !== "member") {
    if (standing === "left") {
      await revokeAccountSessions(env, await accountIdFor(env, user.id));
    }
    // The event name carries the verdict because an operator watching a
    // Telegram outage needs to tell one refusal from the other; the
    // CALLER is told neither, per the paragraph above.
    log("signin.refused." + standing, await accountIdFor(env, user.id));
    return json({
      error: "This binder is for members of the group only.",
    }, 403, origin);
  }

  const accountId = await accountIdFor(env, user.id);
  // All three arms, through the one function that decides between them.
  // Minting from one arm here while sessionFor() re-checks another
  // would hand that arm's admins a member session that could never
  // become an admin one: the stored flag is a necessary condition and
  // nothing would ever set it.
  //
  // `status` is this sign-in's own group role and is the only moment it
  // is knowable - see groupStanding(). It is passed rather than
  // re-derived because there is nothing to re-derive it from once this
  // handler returns.
  const via = await adminVia(env, accountId, status);
  const isAdmin = via !== null;
  const session = await issueSession(env, accountId, via, false);
  log("signin.ok", accountId);

  /*
   * The roster follows the group, and a verified sign-in is where it is
   * refreshed. DESIGN.md, "Accounts": the directory syncs from the
   * Telegram group; "Bot failure stance": the roster cache is the
   * Worker's last-known-good record of who is in it. This is the one
   * moment the group has confirmed this account is a member AND the
   * handle, display name and role are in hand, so the directory row is
   * written here.
   *
   * BEST-EFFORT, BECAUSE THE MEMBER IS ALREADY SIGNED IN. The session is
   * minted above; the directory is a cache of who has been seen, not a
   * gate on being seen. A write that fails must not bounce a verified
   * member off an infrastructure hiccup (DESIGN.md, "Bot failure stance":
   * "cannot check" is never "not a member"), so a failure is logged - the
   * event name and account id only, like every other line here - and the
   * sign-in still succeeds. The staleness that leaves is visible in
   * last_seen_at, not a silent lie. The entry-row seal at POST /submit
   * fails loud instead, and the difference is which is the point of the
   * request: there the seal IS the request, here it is a side effect of
   * one that has already succeeded.
   */
  try {
    const store = await openStore(env);
    await syncDirectoryEntry(store, env, accountId, {
      handle: String(user.username).toLowerCase(),
      displayName: [user.first_name, user.last_name]
        .filter((part) => typeof part === "string" && part.trim() !== "")
        .join(" "),
      role: isAdmin ? "admin" : "member",
      // The numeric id, sealed and never stored beside the row. It is
      // written HERE because a verified sign-in is the only place it
      // arrives from outside this Worker; after this it exists only
      // inside the sealed record, where departedVerdict() unseals it -
      // see syncDirectoryEntry's own comment for what it is for and
      // what may read it.
      telegramId: String(user.id),
    }, new Date().toISOString());
  } catch (e) {
    log("directory.sync.failed", accountId);
  }

  /*
   * NO TELEGRAM NUMERIC ID IN THIS ANSWER, and nothing may put one back.
   * The numeric id is the one identifier that resolves to a person -
   * DESIGN.md, "The identifier is the whole problem" - so a route that
   * hands one out needs a reason strong enough to carry that, and no
   * admin arm supplies one. DESIGN.md, "Admin accounts and deletion",
   * does keep a founding-admin secret for the first flag to start
   * from, and ADMIN_TELEGRAM_IDS holds numeric ids, so the bootstrap
   * is the one place this design still needs them. It is set from
   * outside the product, by whoever holds this deployment's
   * configuration and reads the id from Telegram; this Worker carries
   * no route that writes it, and a member reading this answer is not
   * the person setting it. Every admin after the first is made by a
   * `membership` row keyed to the account-id HMAC, or by the group role
   * groupStanding() reads at sign-in, and neither puts a numeric id in
   * front of anybody.
   *
   * The handle stays, and the difference is who already holds it. The
   * page POSTed this payload, handle included, and is handed back the
   * same string it sent, so nothing is disclosed that the caller did not
   * supply - while the numeric id, though also in the payload, is the
   * value everything else here is careful never to store, log or repeat.
   * Neither reaches a log line; see log() above.
   */
  return json({
    ok: true,
    session: session.token,
    expiresAt: session.expiresAt,
    username: String(user.username).toLowerCase(),
    isAdmin: isAdmin,
    isDev: false,
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
 * isDev travels with it and NO PAGE READS IT (0.9-M2-S4, #355 removed
 * the card that announced a development session, and tests/door.test.mjs
 * pins that session.js carries no such field). It is still reported
 * because the flag itself is live behind the door: the admin-write
 * refusals below take `caller.isDev` and refuse an admin-row write from
 * a session Telegram never authenticated, so an operator reading /me can
 * see which kind of session they hold. Whether the field and the
 * `sessions.is_dev` column survive at all is 0.9-M3's question.
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
 * `adminVia` SAYS WHY, WHICH IS THE HALF `isAdmin` CANNOT (0.9-M3-S8,
 * #414; #385 rule 1). Three ways in and identical powers, so nothing
 * branches on this - what it is for is the admin surface being able to
 * tell a person which lever applies to them: a flag another admin can
 * take off, a group role that lives in Telegram, or a deployment secret
 * no page can reach. 'break-glass' is the fourth value and names the
 * EXPORT_TOKEN caller. A member gets null, and so does an admin session
 * whose source this Worker never recorded - a row written before the
 * column existed, which is admin by the lists exactly as it was.
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
    adminVia: typeof caller.adminVia === "string" ? caller.adminVia : null,
  }, 200, origin);
}

/*
 * The rows this account has written, opened here to their plaintext.
 *
 * WHAT IT RETURNS. An id per row, the receipt time this side attested
 * to, whether something supersedes it, and the record's PLAINTEXT -
 * opened from the at-rest ciphertext with store-crypto, using the same
 * accountId HMAC and the row's own id as the AAD the seal was written
 * under (0.9-M1-S6, #332). The correction path needs the id to name a
 * row; your page needs the plaintext to show it.
 *
 * THE SCOPE IS IN THE STATEMENT, and doubly so at rest. The account
 * clause is what makes this the member's own rows - there is no
 * parameter on the wire for a caller to point elsewhere, the account
 * comes from the session, and a clause in the SQL cannot be forgotten
 * by a later map. And even a row that somehow reached this listing under
 * the wrong account would not open: openRow binds accountId into the
 * AAD, so a cross-account row fails closed rather than decrypting into
 * this member's page. The two guards are independent on purpose.
 *
 * A ROW THAT WILL NOT OPEN FAILS THE READ. openRow throws store-crypto's
 * uniform StoreFormatError on tamper or a cross-binding, and that throw
 * is left to propagate to fetch()'s handler, which answers 500 with no
 * detail. This is fail-closed by design: a row that does not open is a
 * row the database no longer holds honestly, and serving the rest while
 * quietly dropping it would hide exactly the tampering the AAD exists to
 * catch. DESIGN.md, "Encryption", rules the format part of the data.
 *
 * THE SUPERSEDE FLAG IS THE SAME PREDICATE GET /me COUNTS WITH, reused
 * rather than restated, so the two member-facing surfaces cannot come to
 * disagree about one corpus. Its account clause is load-bearing: a row
 * written through another door - `wrangler d1 execute` validates nothing
 * - naming this member's entry must not make that entry vanish from
 * their own listing.
 *
 * ORDER BY received_at, not id. The id is a random value now (see
 * randomRowId), so it no longer carries insertion order; the receipt
 * time this side stamped does. Newest first, with the id as a stable
 * tie-break for two rows stamped in the same millisecond, so a listing
 * does not reshuffle between loads. Whether the database honors the
 * clause is a live-only claim; tools/check_live.py carries that row.
 */
async function handleMyEntries(env, origin, caller) {
  const accountId = rowIdentity(caller.accountId);
  const store = await openStore(env);
  const rows = await env.DB.prepare(
    "SELECT mine.id AS id, mine.received_at AS received_at, " +
    "CASE WHEN " + SUPERSEDED + " THEN 1 ELSE 0 END AS superseded, " +
    "mine.ciphertext AS ciphertext " +
    "FROM submissions AS mine WHERE mine.account_id = ? " +
    "ORDER BY mine.received_at DESC, mine.id DESC LIMIT " + MAX_ENTRY_LISTING
  ).bind(accountId).all();

  const entries = await Promise.all(rows.results.map(async (row) => ({
    id: row.id,
    receivedAt: row.received_at,
    // Strict compare: SQLite answers the CASE with an integer, and
    // anything this column could otherwise arrive as reads as NOT
    // superseded - the direction POST /submit's 409 still catches.
    superseded: row.superseded === 1,
    // The plaintext, opened under this row's own id as the recordId AAD.
    // A row that will not open throws here and the read fails closed.
    record: await store.openRow(base64ToBytes(row.ciphertext),
      { accountId: accountId, recordId: String(row.id) }),
  })));

  return json({ ok: true, entries: entries }, 200, origin);
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

/*
 * Seal one record and write it as a new row, returning the id assigned.
 *
 * ONE ATOMIC INSERT of already-sealed bytes, and randomRowId above is
 * what makes that possible: the row's own id is the recordId bound into
 * the AAD (security mandate 2), so it has to be known before the seal.
 * A seal-then-update over a half-written row is the alternative an
 * autoincrement id would force, and it opens a window where a row exists
 * that nothing can read. Choosing the id here closes that window - the
 * bytes are sealed under the id they are stored beside, in one statement.
 *
 * THE ID COLLISION IS CAUGHT, NOT ASSUMED AWAY. A 48-bit random id
 * collides only astronomically rarely for one group's corpus, but the
 * PRIMARY KEY is what makes "rarely" safe rather than "never" a hope:
 * a clash throws, and this re-rolls the id and RE-SEALS under it, because
 * the AAD must match the id actually stored. Any other constraint - the
 * UNIQUE index on `supersedes` refusing a raced correction - is not this
 * function's to interpret, so it propagates to the caller.
 */
async function insertSealed(store, env, accountId, record, supersedes,
  receivedAt) {
  const columns = "INSERT INTO submissions " +
    "(id, account_id, ciphertext, received_at, supersedes) " +
    "VALUES (?, ?, ?, ?, ?)";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const id = randomRowId();
    const sealed = bytesToBase64(await store.sealRow(record,
      { accountId: accountId, recordId: String(id) }));
    try {
      await env.DB.prepare(columns)
        .bind(id, accountId, sealed, receivedAt, supersedes).run();
      return id;
    } catch (error) {
      if (/UNIQUE constraint failed: submissions\.id\b/i
        .test(String(error && error.message))) {
        continue;
      }
      throw error;
    }
  }
  // Four 48-bit collisions in a row is not a state a real corpus reaches;
  // reaching it is a broken RNG, which is a bug to surface, not to retry.
  throw new Error("could not assign a free row id");
}

async function handleSubmit(request, env, origin, caller) {
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: "Body must be JSON." }, 400, origin);
  }

  // The record is the row's PLAINTEXT, and this Worker seals it. It is
  // opaque to this route on purpose: what a record contains is the
  // form's business (apps/web/site.config.js, form-as-data), not the store's,
  // and validating fields here would be a second place the shape could
  // drift from the one the page enforces. The bound is on bytes because
  // the ceiling is a storage fact, not a character count.
  const record = payload && payload.record;
  if (typeof record !== "string" || record.length === 0) {
    return json({ error: "Missing record." }, 400, origin);
  }
  if (encoder.encode(record).length > MAX_RECORD_BYTES) {
    return json({ error: "Record too large." }, 413, origin);
  }

  // The identity every seal on this route is bound to, asserted before
  // the crypto is reached: the account-id HMAC and nothing else (mandate
  // 1). rowIdentity throws on a raw id or an un-HMAC'd "dev:" subject
  // string - never on the account-id HMAC a dev session's caller.accountId
  // actually holds, which submits like any account - and that throw is a
  // bug being made loud rather than a refusal the member acts on.
  const accountId = rowIdentity(caller.accountId);
  const store = await openStore(env);
  const receivedAt = new Date().toISOString();

  const supersedes = payload.supersedes;

  /*
   * An ordinary submission: seal and append, no pointer. The account id
   * comes from the session (rowIdentity above) and never from the body -
   * the one identity on a row a client cannot influence.
   */
  if (supersedes === undefined || supersedes === null) {
    const id = await insertSealed(store, env, accountId, record, null,
      receivedAt);
    return json({ ok: true, id: id }, 200, origin);
  }

  // The id of a row, or a bug. A client sending "1" as a string, or a
  // value past what a row id can be, is worth hearing about rather than
  // coercing. Row ids are 48-bit, comfortably inside a safe integer.
  if (!Number.isInteger(supersedes) || supersedes < 1 ||
      supersedes > Number.MAX_SAFE_INTEGER) {
    return json({
      error: "supersedes must be the id of one of your entries.",
    }, 400, origin);
  }

  /*
   * A correction supersedes rather than mutates (DESIGN.md, "Admin
   * accounts and deletion"): a NEW row naming the row it replaces, and
   * the replaced row is never rewritten. The Worker could open and
   * re-seal the old row now, but must not - the history the binder
   * exists to accumulate IS the repeats.
   *
   * PRE-CHECK, THEN THE INDEX. The two rules are asked once here for a
   * clean diagnosis - is the target the caller's, is it already
   * corrected - and the UNIQUE index on `supersedes` is what actually
   * holds the chain rule when two corrections of one row race: the
   * pre-check can pass for both, and the index refuses the second. So
   * the pre-check does not need to be atomic with the insert; the index
   * is the guard, and the pre-check is the courtesy of a 404-vs-409 the
   * member can act on. server/schema.sql carries why the ownership rule
   * is scoped to the account and the chain rule is scoped to nothing.
   *
   * Absent, foreign and deleted answer 404 alike, so this route is not a
   * probe for which ids are live across the corpus. The already-corrected
   * 409 is told apart safely: reaching it means the caller proved the row
   * is theirs, so the answer is about their own data.
   */
  const check = await env.DB.prepare(
    "SELECT " + OWNED_BY_CALLER + " AS mine, " +
    ALREADY_CORRECTED_ROW + " AS corrected"
  ).bind(supersedes, accountId, supersedes).first();

  if (!check || !check.mine) {
    return json({ error: NOT_YOURS }, 404, origin);
  }
  if (check.corrected) {
    return json({ error: ALREADY_CORRECTED }, 409, origin);
  }

  try {
    const id = await insertSealed(store, env, accountId, record, supersedes,
      receivedAt);
    return json({ ok: true, id: id }, 200, origin);
  } catch (error) {
    /*
     * The index refusing a correction of a row corrected in the same
     * instant - the same answer as the pre-check catching it a moment
     * earlier, because a member who lost a race and one who corrected
     * twice have identical work to do next. Only that violation is
     * absorbed, named down to its column; anything else is a failure
     * this route cannot honestly report as a refusal and goes to
     * fetch()'s handler. `submissions` carries exactly this one unique
     * constraint on `supersedes`, and SQLite names the table and column
     * in that order, which is what makes the narrow match available.
     */
    if (/UNIQUE constraint failed: submissions\.supersedes/i
      .test(String(error && error.message))) {
      return json({ error: ALREADY_CORRECTED }, 409, origin);
    }
    throw error;
  }
}

/*
 * Deleting one submission - a member deleting their own, or an admin
 * deleting anyone's.
 *
 * DELETION IS DELETION (DESIGN.md, "Admin accounts and deletion"): a
 * member corrects and deletes their own rows in full self-service, no
 * trace and no admin notice, and the charts move with it. An admin can
 * also remove any row - what answers "please take mine down" without a
 * Cloudflare console and what makes junk recoverable.
 *
 * WHO MAY DELETE WHAT IS THE WHOLE OF THE DIFFERENCE. An admin deletes
 * by id alone; a member's delete carries `AND account_id = ?` bound to
 * their session, so a member can only ever remove a row that is theirs
 * (security mandate 3). The id is in the path, but the account clause is
 * from the session, so a member naming another member's id deletes
 * nothing - and deleting nothing succeeds, for the same reason
 * unpublishing twice does: the caller has got what they wanted, and a
 * distinct answer would tell them whether that id exists.
 *
 * IT STAYS A SINGLE DELETE, no cascade, now that rows point at each
 * other. `supersedes` is advisory: a pointer at a row that is gone
 * resolves as no pointer, so removing a correction simply puts the row
 * it corrected back among the current ones. Cascading would turn one
 * "take mine down" into two rows disappearing; refusing would make a row
 * undeletable because somebody corrected it. What remains are the
 * tombstones of a coherent chain, which is the design.
 */
async function handleDeleteSubmission(env, origin, id, caller) {
  if (!/^\d+$/.test(id)) {
    return json({ error: "Not found." }, 404, origin);
  }
  if (caller.isAdmin) {
    await env.DB.prepare("DELETE FROM submissions WHERE id = ?")
      .bind(Number(id)).run();
  } else {
    await env.DB.prepare(
      "DELETE FROM submissions WHERE id = ? AND account_id = ?"
    ).bind(Number(id), caller.accountId).run();
  }
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
 * Every row that is still somebody's current claim, for one aggregation.
 *
 * NO ACCOUNT CLAUSE, and that is the difference between this read and
 * every other one over `submissions`: the subject is the group, so the
 * scope that makes a member's listing theirs would make this answer
 * nothing. What replaces it as the guard is the ROUTER's session gate
 * and the fact that nothing row-shaped survives the aggregation - the
 * response is counts and bins, and server/charts-agg.js is what
 * guarantees that rather than this statement.
 *
 * The tombstones are excluded HERE rather than after opening, because
 * whether a row is superseded is answerable in the clear (that is half
 * of why `supersedes` is a clear column at all) and opening a corrected
 * row in order to discard it is one AES-GCM open bought for nothing.
 * SUPERSEDED is the same predicate GET /me counts with and GET
 * /my-entries flags with, reused rather than restated, so the three
 * member-facing surfaces cannot come to disagree about one corpus.
 */
const CHART_ROWS =
  "SELECT mine.id AS id, mine.account_id AS account_id, " +
  "mine.received_at AS received_at, mine.ciphertext AS ciphertext " +
  "FROM submissions AS mine WHERE NOT " + SUPERSEDED + " " +
  "ORDER BY mine.received_at DESC, mine.id DESC LIMIT " + MAX_AGGREGATE_ROWS;

/*
 * The charts, computed now rather than published earlier.
 *
 * DESIGN.md, "Charts": "The Worker aggregates on request. Publish,
 * unpublish, the published snapshot document and its freshness line are
 * all gone, along with the class of failure where the figures on screen
 * were as old as the last time somebody remembered to press a button."
 *
 * THIS HANDLER COMPUTES NO CELL (0.9-M2-S0, #351, security mandate 1).
 * It reads rows, opens them, and hands them to server/charts-agg.js,
 * which applies whatever floor the settings hold before it returns
 * anything - so there is no moment in this function where a count
 * charts-agg did not decide exists, and no second path a later route
 * could take to the same data. That is why the mandate survives the
 * shipped floor being 0: the boundary is about who decides, and raising
 * the setting changes one object rather than this function. The self
 * overlay comes from its own function keyed on the session's account
 * (mandate 3) and is attached as its own field, never merged into the
 * group series.
 *
 * A ROW THAT WILL NOT OPEN FAILS THE WHOLE READ, exactly as it does at
 * GET /my-entries: openRow throws store-crypto's StoreFormatError on
 * tamper or a cross-binding, and that throw propagates to fetch()'s
 * handler, which answers 500 with no detail. Serving the rest while
 * quietly dropping it would hide the tampering the AAD exists to catch,
 * and a chart is exactly the surface where one missing person is
 * invisible. The remedy is an admin removing the row (DELETE
 * /submission/:id), which is why the failure has to be loud enough to
 * send somebody looking.
 *
 * A ROW THAT OPENS BUT IS NOT A JSON OBJECT IS DROPPED, and the split is
 * deliberate rather than inconsistent. Opening it already PROVED its
 * integrity - the AAD binds the account and the row id - so a record
 * whose plaintext is not a record is a submitter's shape problem, not
 * evidence of tampering, and it can contribute no value to any measure.
 * Failing the whole group's charts over one member's malformed record
 * would let one row take the page down for everybody.
 *
 * PRIVATE AND NEVER STORED (mandate 6). This body is aggregate figures
 * about a private group, computed for one member's session; a shared
 * cache holding it is a copy of the group's numbers sitting somewhere
 * the session gate does not reach.
 */

/*
 * THE CHARTS SETTINGS, AND THE ONE SEAM THE FLOOR ARRIVES THROUGH.
 *
 * server/charts-agg.js reads `floor` from this object and falls back to
 * its own shipped default of 0 when it is absent: the floor ships off,
 * per the owner's ruling at the 2026-08-19 charts sitting (#243 comment
 * 5346978974). This WAS a frozen empty object with a note saying 0.9-M3
 * would replace it with a read of the stored setting; 0.9-M3-S8 (#414)
 * is that slice, and this is that read.
 *
 * AN UNSET STORE IS THE EMPTY OBJECT, byte for byte. Nothing is
 * defaulted in here - no `{ floor: 0 }`, which would behave identically
 * and still be a different fact - because the shipped behavior at floor
 * 0 has to be provably unchanged by wiring the seam, and the honest
 * form of that proof is the same object the constant was.
 * tests/admin-identity.test.mjs pins it by driving GET /charts-data
 * against this function and against a copy of this file with this
 * function replaced by `return Object.freeze({})`, and comparing the
 * response bodies as text.
 *
 * IT CARRIES A SECOND SETTING, `units`, AND THE TWO ARE ONE DECISION
 * (0.9-M2-S17, #396). Raising the floor locks the charts to a single
 * unit system, because two independently-binned systems can be overlaid
 * into cells the floor was meant to hide; `units` names which system a
 * locked view is served in, and an absent one is the spec's own default
 * system. There is nothing to lock while the floor is 0 - both systems
 * are served then and the setting is not read - so a stored
 * `chart.lockedUnit` with no floor beside it changes nothing, which is
 * charts-agg's rule rather than a special case here.
 *
 * THE STORED NAMES ARE NOT THE OBJECT'S NAMES, and the mapping is here
 * because this is the seam: `chart.floor` and `chart.lockedUnit` are
 * what an admin sets and what the settings pane renders, `floor` and
 * `units` are what charts-agg reads. Renaming either side is a one-file
 * change rather than a hunt.
 *
 * A ROW THIS SIDE COULD NOT HAVE WRITTEN IS LEFT TO charts-agg, which
 * answers its own shipped default for anything it cannot read - and
 * that is the correct division. `wrangler d1 execute` validates
 * nothing, so a `chart.floor` of "banana" can exist; refusing the whole
 * view over it would let one hand-written row take the charts down for
 * everybody, and floorOf()'s own comment argues the fallback in full.
 * What this Worker will not do is store such a row: POST /content
 * validates on arrival (SETTINGS above).
 *
 * NOTHING ON THE WIRE REACHES EITHER. askFor() refuses a query
 * parameter it does not know, so `?floor=1` is a 400 rather than a
 * lowered floor (0.9-M2-S0 security mandate 2); the `units` parameter it
 * does accept is OVERRIDDEN by this object whenever a floor is set,
 * never merged with it. This object is built from server-side state
 * alone - two rows of a table only an admin session may write.
 */
async function chartSettings(env) {
  const rows = await env.DB.prepare(
    "SELECT name, value FROM site_content WHERE name IN (?, ?)"
  ).bind("chart.floor", "chart.lockedUnit").all();

  const held = {};
  for (const row of (rows && rows.results) || []) {
    if (row.name === "chart.floor" && SETTINGS["chart.floor"].ok(row.value)) {
      held.floor = Number(row.value);
    }
    // An empty lockedUnit is "no lock" and is deliberately NOT carried
    // over: charts-agg reads an absent `units` and a value it does not
    // offer the same way, and leaving the key off is what keeps the
    // unset store identical to the empty object above.
    if (row.name === "chart.lockedUnit" && row.value !== "" &&
        SETTINGS["chart.lockedUnit"].ok(row.value)) {
      held.units = row.value;
    }
  }
  return Object.freeze(held);
}

async function handleCharts(request, env, origin, caller) {
  const accountId = rowIdentity(caller.accountId);

  /*
   * THE EFFECTIVE SPEC, not the shipped one (0.9-M3-S11, #419). Every
   * refusal, every measure and every group-makeup block below is
   * decided against the form members are actually filling in - so a
   * categorical field an admin added is a filter dimension and a makeup
   * block with no code change here, and a value an admin retired stops
   * being an ask this route accepts. Read ONCE for the request, for the
   * reason the settings are: two reads could straddle an admin's write
   * and answer half of it.
   */
  const site = await effectiveSpec(env);

  const asked = askFor(new URL(request.url).searchParams, site);
  if (!asked.ok) return json({ error: asked.error }, 400, origin);

  const settings = await chartSettings(env);
  const store = await openStore(env);
  const rows = await env.DB.prepare(CHART_ROWS).all();

  const opened = [];
  for (const row of rows.results) {
    const plaintext = await store.openRow(base64ToBytes(row.ciphertext),
      { accountId: row.account_id, recordId: String(row.id) });
    let record;
    try {
      record = JSON.parse(plaintext);
    } catch (e) {
      continue;
    }
    if (!record || typeof record !== "object") continue;
    opened.push({
      id: row.id,
      accountId: row.account_id,
      receivedAt: row.received_at,
      record: record,
    });
  }

  const answer = aggregate(opened, asked.ask, site, settings);
  /* The same settings object both ways, and READ ONCE for the request:
     the overlay is drawn over the group trend on one pair of axes, so
     it has to be in whatever unit system the group's own answer came
     back in (0.9-M2-S17, #396 - a raised floor decides that, not the
     caller). Two reads of the table could straddle an admin's write and
     put a member's own line on a different grid from the group's. */
  answer.self = selfSeries(opened, accountId, asked.ask, site, settings);

  return new Response(JSON.stringify(answer), {
    status: 200,
    headers: Object.assign(
      {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        Vary: VARY,
      },
      origin ? corsHeaders(origin) : {}
    ),
  });
}

function writerOf(caller) {
  return caller && caller.accountId ? caller.accountId : BREAK_GLASS;
}

/*
 * One line in the change log (0.9-M3-S8, #414; the ruled design #385,
 * rule 5, which makes the log a property of every admin change).
 *
 * AFTER THE WRITE, NEVER BEFORE, at every call site. A line written
 * first would record an act that then failed, and a log an admin cannot
 * trust is worse than none: the two admins tidying the same list -
 * handleDeleteMembership's own scenario - are exactly the readers who
 * need "this happened" to mean it. The other order was considered and
 * rejected: recording an intention is a different record with a
 * different name.
 *
 * IT IS NOT BEST-EFFORT. A failed append fails the request, which is
 * the opposite of the directory sync at sign-in, and the difference is
 * what the request is for: there the roster is a cache of a sign-in
 * that already succeeded, here the log is half of what an admin write
 * IS - #385 rule 5 states the log as a property of every admin change,
 * not as a convenience beside it. The throw reaches fetch()'s handler
 * and answers 500 with no detail, exactly as any other D1 failure on a
 * write does.
 *
 * `subject` IS WHAT CHANGED and the actor is the caller: a content
 * name for a `site_content` write, the account id whose row moved for a
 * `membership` write. `summary` is bounded here rather than at the call
 * sites, so no future caller can put a kilobyte in it by forgetting.
 *
 * NOTHING A MEMBER WROTE PASSES THROUGH HERE, which is a property of
 * what the call sites pass rather than of this function, and is why the
 * list of them is worth knowing. Most write `site_content` or
 * `membership`, whose values are site copy, settings, roles, field
 * definitions and labels an admin typed - the form's own words in every
 * case, never a member's answer to one of them. The exception is
 * handleEraseDeparted (0.9-M3-S15, #420), which passes COUNTS of rows
 * removed and Telegram's own verdict - no row, no label, no handle -
 * for an account the bot has said is gone.
 *
 * DELETE /submission/:id still appends nothing, in either direction,
 * and that is a decision rather than an omission: a member deleting
 * their own row is not an admin change at all, and an admin removing
 * one row belongs to a member who is still here, where a line naming
 * the act is a fact about a present member's data. server/schema.sql's
 * `admin_log` block carries the whole argument for both.
 */
async function noteAdminWrite(env, caller, action, subject, summary) {
  const text = String(summary);
  await env.DB.prepare(
    "INSERT INTO admin_log (at, account_id, action, name, summary) " +
    "VALUES (?, ?, ?, ?, ?)"
  ).bind(
    new Date().toISOString(), writerOf(caller), action, subject,
    text.length > MAX_LOG_SUMMARY ? text.slice(0, MAX_LOG_SUMMARY) : text
  ).run();
}

/*
 * The change log, read.
 *
 * ADMIN ONLY, gated in the router like every other admin read here.
 * The ruled design #385, rule 5, states the gate rather than leaving
 * it to be inferred: the log is admin-only reading, and members see
 * results rather than the paper trail. What it holds is who did what
 * - the account ids of the people
 * who administer, and which names they touched - which is the same
 * shape as GET /membership and belongs behind the same door.
 *
 * NEWEST FIRST AND BOUNDED. `id` breaks the tie inside one millisecond
 * (server/schema.sql's `admin_log` block says why the column exists),
 * so two writes in the same instant come back in the order they were
 * made rather than in whatever order SQLite returns them.
 *
 * The rows go out with camel-cased field names rather than the table's
 * own, and that is the one place this file re-spells a column: `at`,
 * `action`, `name` and `summary` are already the words a reader wants,
 * while `account_id` is not - and a surface rendering "who" from a
 * field called account_id beside three plain words is a surface that
 * has to explain itself.
 */
async function handleReadAdminLog(env, origin) {
  const rows = await env.DB.prepare(
    "SELECT at, account_id, action, name, summary FROM admin_log " +
    "ORDER BY at DESC, id DESC LIMIT " + ADMIN_LOG_LIMIT
  ).all();

  return json({
    ok: true,
    log: ((rows && rows.results) || []).map((row) => ({
      at: row.at,
      accountId: row.account_id,
      action: row.action,
      name: row.name,
      summary: row.summary,
    })),
  }, 200, origin);
}

/*
 * The three values a page needs BEFORE anybody has signed in
 * (0.9-M3-S8, #414 scope 4; the ruled design #385, rule 9).
 *
 * WHY A SECOND CREDENTIAL-FREE ROUTE BESIDE GET /content, when
 * handleReadContent's own comment argues that a route named for
 * configuration in general is an invitation to move the form
 * definition into a table. That argument stands and this route does not
 * weaken it: what makes /content safe is that every value in it stands
 * in for bytes anybody can already fetch from the published site, and
 * this route is a strictly SMALLER window on the same table - three
 * names, fixed in code. The form's BOUNDS are still refused this
 * table, still a repository file the gate reads before it ships, and
 * DESIGN.md, "Where configuration lives", still holds the rule; what
 * moved is the group's name, the door's welcome text and the default
 * palette, which that same section already ruled are runtime state,
 * and the categorical fields, which the 2026-08-20 sitting made admin
 * data (#385 rule 6). Neither door here serves a field row: the
 * allow-list below names three settings and nothing else, and every
 * `field.` row is behind the session on GET /spec.
 *
 * SO WHY NOT LET THE DOOR READ /content? Because /content answers with
 * whatever is in the table, and the table is where the floor and every
 * future setting live. A door reading it would be handed the group's
 * privacy floor before sign-in, on every page load, forever - not
 * because anybody put something private in a copy table, but because
 * settings and copy share it by design. The allow-list is what keeps
 * the credential-free surface from growing every time a setting is
 * added.
 *
 * DEFAULTS RATHER THAN ABSENCES. A page asking this before sign-in has
 * to render something, and a missing key would make every first-run
 * deployment look like a failure - the same reason handleReadContent
 * answers `{}` and a 200 rather than a 404. The group's name defaults
 * to the spec's own, which is where it lives when nobody has overridden
 * it (apps/web/site.config.js, read through the import
 * server/charts-agg.js makes); the other two default to the empty
 * string, which means "the page's own HTML is the fallback" - this
 * Worker holding a copy of the door's paragraph would be a second home
 * for a fact that has one.
 */
function publicConfigDefaults() {
  const site = globalThis.BINDER_SITE;
  return {
    "site.groupName": site && site.group && typeof site.group.name === "string"
      ? site.group.name : "",
    "site.welcomeText": "",
    "site.defaultTheme": "",
  };
}

async function handleReadConfig(env, origin) {
  const rows = await env.DB.prepare(PUBLIC_CONFIG_SQL)
    .bind(...PUBLIC_CONFIG).all();

  const config = publicConfigDefaults();
  for (const row of (rows && rows.results) || []) {
    /*
     * REFUSED, NOT DROPPED. A row outside the allow-list cannot reach
     * here while the statement above binds exactly three names, so one
     * that does means the statement was widened - and a filter would
     * make that widening invisible, which is the whole failure this
     * second wall exists for. The throw reaches fetch()'s handler and
     * answers 500 with no detail, so nothing leaks on the way out
     * either.
     */
    if (PUBLIC_CONFIG.indexOf(row.name) === -1) {
      throw new Error("the public config read returned a name outside " +
        "its allow-list");
    }
    config[row.name] = row.value;
  }

  return json({ ok: true, config: config }, 200, origin);
}

/*
 * The site copy an admin can change without a release.
 *
 * This route answers a caller with no credential at all. The argument
 * is what these values are: each page ships the copy it needs in its
 * own HTML and reads this document to override it, so the bytes this
 * route serves stand in for bytes anybody can already fetch from the
 * published site. Gating it would promise a confidentiality the
 * fallback does not have, and the cost of promising it is that somebody
 * eventually puts something private in a table designed for site copy.
 *
 * What follows from that is a rule with a structural expression rather
 * than a warning: nothing about a person goes in this table. The lists
 * of people are `membership`, on their own routes, gated admin - a
 * filter on a shared route is one `if` away from serving the list to a
 * member session, and that mistake would look like nothing at all.
 *
 * THE FORM'S BOUNDS ARE REFUSED THIS TABLE, and that is the rule this
 * paragraph is really about: "a wrong value gets written into a row",
 * which is what a bound does - it gets sealed into a record and is
 * discovered on export day. So the units, the limits and the chart
 * bands stay a repository file the gate reads before it ships.
 * DESIGN.md, "Where configuration lives", holds it.
 *
 * The CATEGORICAL half of the spec does live here, in the `field.`
 * namespace, and it is not an exception to that rule (0.9-M3-S11,
 * #419; the ruled design #385 rule 6). A choice field carries no
 * bound: its values are strings the spec listed, and one the spec
 * stops listing reads as unstated rather than as a wrong number. Those
 * rows are refused THIS ROUTE, in the statement above and in the
 * reader below, because this route answers without a credential and
 * the spec is a member read - GET /spec serves it behind a session.
 *
 * There IS a route named /config, and the rule above is unchanged by
 * it (0.9-M3-S8, #414). A route named for configuration in general
 * would be an invitation to move the whole spec into this table; this
 * one is not that route. The owner ruled it at the 2026-08-20 sitting
 * (#385 rule 9), and what it serves is three names
 * fixed in code - the group's name, the door's welcome text, the
 * default palette - which DESIGN.md's same section already calls
 * runtime state. handleReadConfig carries the argument for why the
 * door does not simply read this route instead.
 *
 * An absent document is `{}` and a 200. A page whose value has never
 * been set is in its normal state, not in an error, and answering 404
 * would make every page treat first-run as a failure.
 */
async function handleReadContent(env, origin) {
  const rows = await env.DB.prepare(CONTENT_ROWS_SQL).bind(FIELD_LIKE).all();

  // Names and values only. `updated_by` is an account id, and a
  // document anybody may fetch is the wrong place to publish which
  // account did anything; the audit stays in the table for a surface
  // that reads it behind the admin gate.
  const content = {};
  for (const row of rows.results) {
    /*
     * REFUSED, NOT DROPPED, exactly as handleReadConfig refuses a name
     * outside its allow-list. The statement above already excludes the
     * field namespace, so a row reaching here means somebody widened
     * it - and a filter would make that widening invisible, which is
     * the whole failure this second wall exists for. The throw reaches
     * fetch()'s handler and answers 500 with no detail.
     */
    if (isFieldName(row.name)) {
      throw new Error("the credential-free content read returned a " +
        "field-spec row");
    }
    content[row.name] = row.value;
  }

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
      error: "A content name starts with a lowercase letter or a digit, " +
        "then letters, digits, dot, dash or underscore, up to 64 " +
        "characters.",
    }, 400, origin);
  }

  /*
   * THE FIELD NAMESPACE HAS ONE DOOR, and it is not this one
   * (0.9-M3-S11, #419). A field row is a JSON document whose value ids,
   * labels and retirements are checked against what members have
   * already saved; a copy route that stored the same name as free text
   * would be that validation with a second entrance and none of it.
   * Folded, so a spelling this route admits in the tail cannot take the
   * slot the real name needs - the same hole SETTINGS_BY_FOLD closes
   * one paragraph down.
   */
  if (isFieldName(name)) {
    return json({
      error: "A field of the form is edited at /admin-fields, not here.",
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

  /*
   * A SETTINGS NAME IS SPELLED ONE WAY (0.9-M3-S8, #414). Matched by
   * the fold rather than exactly, so a near-miss is told apart from a
   * name that is not a setting: `Chart.Floor` stored as ordinary
   * content would take the slot `chart.floor` needs, and the collision
   * check below would then refuse the real setting forever. Refusing
   * the near-miss here is what keeps every settings key reachable.
   */
  const canonical = SETTINGS_BY_FOLD.get(name.toLowerCase());
  if (canonical !== undefined && canonical !== name) {
    return json({
      error: "That is a setting, and its name is spelled " + canonical + ".",
    }, 400, origin);
  }

  // Validated on arrival, never on the way out. Every reader downstream
  // answers its own shipped default for a value it cannot use, which is
  // right for a row `wrangler d1 execute` wrote and wrong as a
  // substitute for telling an admin their number did not take.
  const setting = SETTINGS[name];
  if (setting && !setting.ok(value)) {
    return json({ error: setting.error }, 400, origin);
  }

  /*
   * TWO NAMES DIFFERING ONLY BY CASE ARE ONE SLOT AS FAR AS A PERSON IS
   * CONCERNED, and the charset admits both since this slice. So the
   * second spelling is refused rather than stored: a settings pane
   * listing `door.motto` beside `Door.Motto` is a list an admin cannot
   * read, and the page that renders one of them would answer to the
   * wrong row for reasons nothing on screen explains.
   *
   * A read before a write is a race in general, and it is not one here:
   * the loser of two simultaneous writes of two spellings gets its own
   * row through the UPSERT, which is a duplicate an admin can see and
   * remove, not a lost write. What this refuses is the ordinary case -
   * somebody typing a name that is nearly one that exists.
   */
  const clash = await env.DB.prepare(
    "SELECT name FROM site_content WHERE name = ? COLLATE NOCASE"
  ).bind(name).first();
  if (clash && clash.name !== name) {
    return json({
      error: "A content name differing only in case is already set: " +
        clash.name + ". Use that spelling, or unset it first.",
    }, 409, origin);
  }

  await writeContentRow(env, name, value, caller);

  await noteAdminWrite(env, caller, "content.set", name, value);
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
async function handleDeleteContent(env, origin, name, caller) {
  // A field row is retired at DELETE /admin-fields/<id>, which keeps
  // what members saved (#385 rule 7); deleting the row here would be
  // the same URL shape doing a different thing, and 404 is what every
  // other name this route cannot address already answers.
  if (!CONTENT_NAME.test(name) || isFieldName(name)) {
    return json({ error: "Not found." }, 404, origin);
  }
  // CASE IS FOLDED, the same way handleDeleteMembership folds it and
  // for a related reason: at most one row can exist per spelling
  // (handleWriteContent's collision guard), so folding here cannot
  // remove a row the caller did not mean, while matching byte for byte
  // would answer 200-and-nothing-happened to an admin who typed one
  // capital differently from whoever set the row.
  await env.DB.prepare(
    "DELETE FROM site_content WHERE name = ? COLLATE NOCASE"
  ).bind(name).run();

  await noteAdminWrite(env, caller, "content.unset", name, "");
  return json({ ok: true }, 200, origin);
}

/* ------------------------------------------------------------------ */
/* The effective field spec (0.9-M3-S11, #419).                        */

/*
 * The shipped spec, as a value this file may edit.
 *
 * A JSON round trip rather than a shallow copy, and it is safe here for
 * a reason the file it copies states in its own header: what may be
 * written in apps/web/site.config.js is text, numbers, true/false,
 * lists and tables of them, and nothing computed. So the clone is total
 * and there is nothing to lose. It is also NECESSARY rather than
 * defensive, because apps/web/fields.js deep-freezes whatever spec it
 * is handed: "the reader freezes what it reads, and the table stays a
 * table". The shipped object is the one every other reader on this
 * Worker holds, so composing into it would edit the form for the life
 * of the isolate rather than for one request.
 *
 * The throw is the loud half, and it is fields.js's own stance: a spec
 * that will not load beats a form that quietly asks nothing. It reaches
 * fetch()'s handler and answers 500.
 */
function staticSpec() {
  const site = globalThis.BINDER_SITE;
  if (!site) {
    throw new Error("apps/web/site.config.js has not been loaded, so " +
      "nothing knows what this form asks");
  }
  return JSON.parse(JSON.stringify(site));
}

/*
 * One overlay row, read - or null for a row this Worker cannot use.
 *
 * FORGIVING ON THE READ AND STRICT ON THE WRITE, which is the same
 * split floorOf() takes in server/charts-agg.js and for the same
 * reason: `wrangler d1 execute` validates nothing and is how every
 * backup and restore is applied, so a row that arrived some other way
 * has to leave the shipped field standing rather than blank it. An
 * admin who types something wrong is told at PUT /admin-fields/<id>,
 * where the value can still be corrected.
 */
function readFieldDoc(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  if (doc.v !== FIELD_FORMAT) return null;
  if (doc.values !== undefined && !Array.isArray(doc.values)) return null;
  return doc;
}

/*
 * The values one field OFFERS, in the spec's own `{value, label}`
 * shape.
 *
 * `id` here becomes `value` there, and that rename is the whole of the
 * label-to-id migration this slice is sometimes described as needing:
 * apps/web/site.config.js already separates the two - a choice is
 * `{ value: "admirer", label: "Fat admirer" }` and a stored record
 * carries the VALUE - so the stable id a relabel needs is the string
 * members' rows have always held. Nothing stored is rewritten and
 * nothing has to be, which is why there is no migration step to run.
 */
function offeredValues(doc) {
  return (doc.values || [])
    .filter((one) => one && typeof one === "object" && one.retired !== true)
    .map((one) => ({ value: one.id, label: one.label }));
}

/*
 * Every overlay row, keyed by field id.
 *
 * ORDER BY name, so two admin-added fields land in the effective spec
 * in the same order on every request - a form whose boxes swapped
 * places between page loads would be this Worker handing SQLite's row
 * order to a person.
 */
async function fieldDocs(env) {
  const rows = await env.DB.prepare(FIELD_ROWS_SQL).bind(FIELD_LIKE).all();
  const docs = new Map();
  for (const row of (rows && rows.results) || []) {
    /*
     * REFUSED, NOT DROPPED, the same wall handleReadConfig and
     * handleReadContent stand behind: the statement asks only for the
     * namespace, so a row outside it means the statement was widened,
     * and a filter here would make that widening invisible.
     */
    if (!isFieldName(row.name)) {
      throw new Error("the field-spec read returned a name outside the " +
        "field namespace");
    }
    /*
     * THE PREFIX'S OWN CASE IS PART OF THE ID, and SPEC_ID cannot say
     * so because it never sees the prefix. LIKE folds, so the statement
     * above hands back `FIELD.gender` exactly as readily as
     * `field.gender`, and a blind six-character cut composes both onto
     * `gender` - two rows of a BINARY primary key answering as one
     * field, with nothing able to say which of them the form meant.
     * Ignored rather than refused, because a row written by hand is
     * what the stored format promises to read forgivingly; the write
     * routes are where a folded spelling is told no.
     */
    if (!row.name.startsWith(FIELD_PREFIX)) continue;
    const id = row.name.slice(FIELD_PREFIX.length);
    // A row whose id this Worker could never have written - upper case,
    // too long, an empty tail - is ignored rather than composed, for
    // readFieldDoc's reason.
    if (!SPEC_ID.test(id)) continue;
    const doc = readFieldDoc(row.value);
    if (doc) docs.set(id, doc);
  }
  return docs;
}

/*
 * One overlay applied to the spec being composed.
 *
 * A ROW THAT NAMES A MEASURED FIELD IS IGNORED HERE, not honored. The
 * write route refuses one, so the only way to store it is the other
 * door, and a Worker that composed it would let a hand-written row move
 * a chart band - which is exactly what #385 rule 6 keeps in the
 * release.
 */
function applyOverlay(site, id, doc) {
  const index = site.fields.findIndex((one) => one.name === id);

  if (index === -1) {
    // A retired field the shipped spec never had is simply not there;
    // the row stays so that un-retiring can bring it back with its
    // values, which is the whole of #385 rule 7 for a whole field.
    if (doc.retired === true) return;
    const made = { name: id, kind: "choice" };
    if (doc.multiple === true) made.multiple = true;
    made.label = typeof doc.label === "string" ? doc.label : id;
    made.term = typeof doc.term === "string" ? doc.term : made.label;
    if (typeof doc.blank === "string" && doc.blank !== "") {
      made.blank = doc.blank;
    }
    made.choices = offeredValues(doc);
    // Charted always, which is #385 rule 6's other half: a categorical
    // field an admin adds becomes a filter chip and a group-makeup
    // block with no code change, and an admin-facing switch for that
    // would be a setting nobody asked for.
    made.chart = true;
    site.fields.push(made);
    return;
  }

  const field = site.fields[index];
  if (field.kind !== "choice") return;
  if (doc.retired === true) {
    site.fields.splice(index, 1);
    return;
  }
  if (typeof doc.label === "string") field.label = doc.label;
  if (typeof doc.term === "string") field.term = doc.term;
  if (typeof doc.blank === "string") field.blank = doc.blank;
  // `multiple` is deliberately not composed: it decides whether a
  // stored answer is a string or an array, so changing it would re-read
  // every sealed row under a shape they were not written in. The write
  // route refuses the change; this is the second refusal.
  if (Array.isArray(doc.values) && !field.choicesFrom) {
    field.choices = offeredValues(doc);
  }
}

/*
 * THE EFFECTIVE SPEC: the shipped spec overlaid by what admins have
 * edited, composed in this one place.
 *
 * ONE PLACE, because everything that reads a spec has to read the same
 * one: GET /spec serves it to the pages, and GET /charts-data hands it
 * to server/charts-agg.js so a filter, a measure and a group-makeup
 * block are decided against the form members are actually filling in.
 * Two compositions would be two forms, and the one that decided a
 * refusal would not be the one that drew the boxes.
 *
 * WITH NO OVERLAY ROWS IT IS THE SHIPPED SPEC, byte for byte. That is
 * the property the static file's whole role rests on: it is the
 * fallback, the fork's starting point and the thing a release review
 * reads, so a composed answer that differed from it by so much as a key
 * order would make all three claims approximate.
 */
async function effectiveSpec(env) {
  const site = staticSpec();
  const docs = await fieldDocs(env);
  for (const [id, doc] of docs) applyOverlay(site, id, doc);
  return site;
}

/*
 * The spec, read by a member.
 *
 * A SESSION, not the credential-free door GET /content is. The copy
 * that route serves stands in for bytes anybody can already fetch from
 * the published site; this document is what a group's admins have built
 * their form into, including the words they chose for a question about
 * their own members, and it is not published anywhere. The pages that
 * read it are member pages behind the same gate.
 *
 * `private, no-store` for the reason GET /charts-data carries it: one
 * binder's spec is not a document a shared cache may hand to the next
 * caller.
 */
async function handleReadSpec(env, origin) {
  const site = await effectiveSpec(env);
  return new Response(JSON.stringify({ ok: true, spec: site }), {
    status: 200,
    headers: Object.assign(
      {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        Vary: VARY,
      },
      origin ? corsHeaders(origin) : {}
    ),
  });
}

/*
 * A value id minted from the label an admin typed.
 *
 * ADMINS DO NOT TYPE IDS. #385 rules 6 and 8 describe a person adding,
 * renaming and removing options in words; an id is this Worker's own
 * bookkeeping, and a surface that asked for one would be asking a
 * person to know why the two are different.
 *
 * IT STEPS AROUND EVERY ID THE FIELD HAS EVER HAD, retired ones
 * included, and that is the load-bearing part rather than tidiness:
 * re-issuing a retired id would silently re-adopt every sealed answer
 * stored under it, so an option somebody removed a year ago would come
 * back holding people it was never offered to.
 */
function mintId(label, taken) {
  const base = String(label).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    // A label with nothing this charset admits still needs an id, and a
    // refusal would make a perfectly good option unaddable for a reason
    // about the alphabet rather than about the form.
    .replace(/^$/, "value");
  let candidate = base;
  let next = 2;
  while (taken.has(candidate)) {
    candidate = base + "-" + next;
    next += 1;
  }
  return candidate;
}

/*
 * What a field holds now, as the write route's own shape.
 *
 * The stored row when there is one, and the shipped field otherwise -
 * NEVER the effective spec, which is the trap this function exists to
 * step around: a retired field is spliced out of the effective spec, so
 * a route that read its current state from there would see nothing and
 * treat un-retiring as a fresh creation, losing every value the admin
 * expects back.
 */
function currentValues(shipped, held) {
  if (held && Array.isArray(held.values)) {
    return held.values
      .filter((one) => one && typeof one === "object" &&
        typeof one.id === "string" && typeof one.label === "string")
      .map((one) => ({ id: one.id, label: one.label,
        retired: one.retired === true }));
  }
  return ((shipped && shipped.choices) || []).map((one) => ({
    id: one.value, label: one.label, retired: false }));
}

const TOO_MANY_VALUES =
  "A field carries up to " + MAX_FIELD_VALUES +
  " values, retired ones counted.";

const RENAME_NEEDS_MODE =
  "Renaming a value asks what it means: \"relabel\" if it is the same " +
  "thing re-worded, so entries already saved follow the new word, or " +
  "\"replace\" if it is a genuinely new option, so the old one retires " +
  "and entries keep it.";

/*
 * The requested value list, merged over the one the field holds.
 *
 * THE REQUEST IS THE WHOLE OFFERED LIST, in the order it should be
 * offered in, so there is no separate index to keep in step with the
 * values and no per-value verb an admin pane has to compose. What the
 * request leaves OUT is retired rather than destroyed - #385 rule 7
 * admits no third answer, and a pane that dropped a value it had not
 * rendered would otherwise take somebody's stored answer out of the
 * spec's reach for good.
 *
 * AN ID THE FIELD HAS NEVER HAD IS A REFUSAL. An item with no id is a
 * new value and is minted one; an item WITH an id is a claim about a
 * value that exists, and honoring a stale one would create a value
 * under an id nobody chose - the shape where an admin pane a release
 * behind quietly invents options.
 */
function mergeValues(current, requested, mode) {
  /*
   * THE BOUND IS READ BEFORE ANYTHING IS MINTED. Every requested item
   * contributes at least one entry, so a list already past the ceiling
   * can only end past it - and mintId steps over every id taken so far,
   * which makes a list of same-labeled values quadratic to merge. The
   * answer is the same 400 either way; reading the length first is what
   * keeps a body an admin could paste by accident from buying seconds
   * of Worker time to say no.
   */
  if (requested.length > MAX_FIELD_VALUES) {
    return { error: TOO_MANY_VALUES };
  }

  const byId = new Map(current.map((one) => [one.id, one]));
  const taken = new Set(current.map((one) => one.id));
  const out = [];
  const seen = new Set();
  let renames = 0;

  for (const item of requested) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { error: "Each value is an object carrying a label." };
    }
    const label = item.label;
    if (typeof label !== "string" || label.trim() === "" ||
        label.length > MAX_FIELD_LABEL) {
      return { error: "A value's label is text, up to " + MAX_FIELD_LABEL +
        " characters." };
    }
    const retired = item.retired === true;

    if (item.id === undefined || item.id === null) {
      const minted = mintId(label, taken);
      taken.add(minted);
      seen.add(minted);
      out.push({ id: minted, label: label, retired: retired });
      continue;
    }
    if (typeof item.id !== "string" || !byId.has(item.id)) {
      return { error: "That is not a value this field has. A new value " +
        "is sent with no id and is given one here." };
    }
    if (seen.has(item.id)) {
      return { error: "That value is listed more than once." };
    }
    seen.add(item.id);

    const was = byId.get(item.id);
    if (was.label === label) {
      out.push({ id: item.id, label: label, retired: retired });
      continue;
    }

    renames += 1;
    if (mode === "relabel") {
      out.push({ id: item.id, label: label, retired: retired });
      continue;
    }
    if (mode !== "replace") return { error: RENAME_NEEDS_MODE };

    // The old value keeps the word it was retired under, so whoever
    // reads a sealed answer later can still tell what the member was
    // offered; the new one takes its place in the list rather than the
    // end, because the admin edited a box in a position.
    out.push({ id: item.id, label: was.label, retired: true });
    const minted = mintId(label, taken);
    taken.add(minted);
    seen.add(minted);
    out.push({ id: minted, label: label, retired: retired });
  }

  for (const one of current) {
    if (!seen.has(one.id)) {
      out.push({ id: one.id, label: one.label, retired: true });
    }
  }

  // The bound again, on the list that came OUT: `replace` pushes two
  // entries for one requested item and every value the request left out
  // is carried over retired, so a merge can pass the ceiling from a
  // request that was under it.
  if (out.length > MAX_FIELD_VALUES) {
    return { error: TOO_MANY_VALUES };
  }
  return { values: out, renames: renames };
}

const NOT_A_CHOICE_FIELD =
  "That field is not a choice field. Its units, bounds and chart bands " +
  "are part of a release somebody read rather than something to edit " +
  "here.";

/*
 * Adding a categorical field, or changing one (#385 rules 6, 7 and 8).
 *
 * THE WHOLE DESIRED STATE, not a patch. The row that comes out is
 * everything the field is - its label, its term, its blank line, every
 * value it has ever offered and which of them are retired - so a reader
 * needs one row rather than a row and a replay. Names the request does
 * not carry keep what they had, which is what lets a pane that renders
 * only the values post only the values.
 *
 * VALIDATED HERE AND NOWHERE ELSE, the same posture SETTINGS takes: the
 * readers downstream are deliberately forgiving, and forgiveness is
 * right for a row written through `wrangler d1 execute` and wrong as a
 * substitute for telling an admin their edit did not take.
 */
async function handleWriteField(request, env, origin, id, caller) {
  if (!SPEC_ID.test(id)) return json({ error: "Not found." }, 404, origin);

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: "Body must be JSON." }, 400, origin);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json({ error: "Body must be a JSON object." }, 400, origin);
  }

  const site = staticSpec();
  const shipped = site.fields.filter((one) => one.name === id)[0] || null;
  if (shipped && shipped.kind !== "choice") {
    return json({ error: NOT_A_CHOICE_FIELD }, 400, origin);
  }

  const docs = await fieldDocs(env);
  const held = docs.get(id) || null;

  const text = (name, given, fallback) => {
    if (given === undefined) return { value: fallback };
    if (typeof given !== "string" || given.length > MAX_FIELD_LABEL) {
      return { error: "A field's " + name + " is text, up to " +
        MAX_FIELD_LABEL + " characters." };
    }
    return { value: given };
  };

  const heldLabel = held && typeof held.label === "string" ? held.label : null;
  const label = text("label", payload.label,
    heldLabel !== null ? heldLabel : (shipped ? shipped.label : null));
  if (label.error) return json({ error: label.error }, 400, origin);
  if (typeof label.value !== "string" || label.value.trim() === "") {
    return json({
      error: "A new field needs a label - the words a member reads " +
        "beside the box.",
    }, 400, origin);
  }

  const heldTerm = held && typeof held.term === "string" ? held.term : null;
  const term = text("term", payload.term,
    heldTerm !== null ? heldTerm
      : (shipped ? shipped.term : label.value.toLowerCase()));
  if (term.error) return json({ error: term.error }, 400, origin);

  const heldBlank = held && typeof held.blank === "string" ? held.blank : null;
  const blank = text("blank line", payload.blank,
    heldBlank !== null ? heldBlank
      : (shipped && typeof shipped.blank === "string" ? shipped.blank : null));
  if (blank.error) return json({ error: blank.error }, 400, origin);

  /*
   * `multiple` IS FIXED AT CREATION. It decides whether a stored answer
   * is one string or a list of them, so flipping it re-reads every
   * sealed row under a shape it was not written in - values would
   * silently read as unstated and the group makeup would empty out,
   * with nothing destroyed and nothing showing. A new field takes it;
   * an existing one refuses a different value and ignores the same one.
   */
  const exists = Boolean(shipped || held);
  const multiple = shipped ? shipped.multiple === true
    : (held ? held.multiple === true : payload.multiple === true);
  if (exists && payload.multiple !== undefined &&
      Boolean(payload.multiple) !== multiple) {
    return json({
      error: "Whether a field takes one answer or several is fixed when " +
        "it is added, because it decides how every entry already saved " +
        "is read.",
    }, 400, origin);
  }

  if (payload.retired !== undefined &&
      typeof payload.retired !== "boolean") {
    return json({ error: "Retiring a field is true or false." }, 400,
      origin);
  }
  const retired = payload.retired === undefined
    ? Boolean(held && held.retired === true) : payload.retired;

  if (payload.mode !== undefined &&
      RENAME_MODES.indexOf(payload.mode) === -1) {
    return json({ error: RENAME_NEEDS_MODE }, 400, origin);
  }

  /*
   * A FIELD WHOSE CHOICES LIVE OUTSIDE THE SPEC TAKES NO VALUE LIST.
   * `choicesFrom` points at a list a page holds - the country table is
   * the shipped one - so there is nothing here to edit, and accepting a
   * list would store an edit every reader then ignores: an admin
   * watching their change not happen, with a 200 saying it did.
   */
  const outside = Boolean(shipped && shipped.choicesFrom);
  if (payload.values !== undefined && outside) {
    return json({
      error: "This field's choices live outside the form spec, so its " +
        "values are not edited here. Its label is.",
    }, 400, origin);
  }
  if (payload.values !== undefined && !Array.isArray(payload.values)) {
    return json({ error: "Values are a list, in the order they are " +
      "offered in." }, 400, origin);
  }

  let values = currentValues(shipped, held);
  let renames = 0;
  if (payload.values !== undefined) {
    const merged = mergeValues(values, payload.values, payload.mode);
    if (merged.error) return json({ error: merged.error }, 400, origin);
    values = merged.values;
    renames = merged.renames;
  }

  /*
   * THE CEILING COUNTS THE FORM, not the rows behind it. `docs` holds
   * one entry per overlay row, and an overlay on a shipped field is
   * that field a second time - so adding the two numbers refuses a
   * binder whose admins have edited three shipped fields three fields
   * early, while the sentence it prints says the form carries forty.
   * Composing is what makes the number the one an admin can count on
   * the page, and it is the same composition the readers do.
   */
  if (!exists) {
    const effective = staticSpec();
    for (const [key, overlay] of docs) applyOverlay(effective, key, overlay);
    if (effective.fields.length + 1 > MAX_SPEC_FIELDS) {
      return json({
        error: "This form already carries " + MAX_SPEC_FIELDS + " fields.",
      }, 409, origin);
    }
  }

  const doc = { v: FIELD_FORMAT, label: label.value, term: term.value,
    multiple: multiple, retired: retired };
  if (blank.value !== null && blank.value !== undefined) {
    doc.blank = blank.value;
  }
  if (!outside) doc.values = values;

  const stored = JSON.stringify(doc);
  if (stored.length > MAX_CONTENT_VALUE) {
    return json({ error: "That field is too large to store." }, 413, origin);
  }

  await writeContentRow(env, FIELD_PREFIX + id, stored, caller);

  /*
   * The log line carries what an admin typed and the answer they gave
   * about a rename, which is the half of the rename ruling a later
   * reader needs: the same-thing-re-worded case and the genuinely-new-
   * option case leave the same spec behind and different data behind,
   * so a log that recorded only the spec could not tell them apart. It
   * carries no id, no handle and no member's answer, and noteAdminWrite
   * bounds the rest.
   */
  await noteAdminWrite(env, caller, "field.set", id,
    (renames > 0 ? payload.mode + ": " : "") + label.value + " (" +
    offeredValues(doc).map((one) => one.label).join(", ") + ")");
  return json({ ok: true }, 200, origin);
}

/*
 * Retiring a field: it stops being offered, and every answer members
 * gave it stays exactly where it is (#385 rule 7).
 *
 * RETIRE RATHER THAN DELETE, which is why this route writes a row where
 * a delete route would remove one. The row is what remembers the values
 * and their words, so PUT with `retired: false` brings the field back
 * whole; a deleted row would bring back the shipped field and lose
 * every value an admin had added to it.
 *
 * A field this binder does not have at all is 404 rather than a
 * retirement of nothing, because a row naming a field that never
 * existed would be an overlay the reader spends every request stepping
 * over.
 */
async function handleRetireField(env, origin, id, caller) {
  if (!SPEC_ID.test(id)) return json({ error: "Not found." }, 404, origin);

  const site = staticSpec();
  const shipped = site.fields.filter((one) => one.name === id)[0] || null;
  if (shipped && shipped.kind !== "choice") {
    return json({ error: NOT_A_CHOICE_FIELD }, 400, origin);
  }

  const docs = await fieldDocs(env);
  const held = docs.get(id) || null;
  if (!shipped && !held) return json({ error: "Not found." }, 404, origin);

  const label = held && typeof held.label === "string" ? held.label
    : (shipped ? shipped.label : id);
  const term = held && typeof held.term === "string" ? held.term
    : (shipped ? shipped.term : label);
  const doc = { v: FIELD_FORMAT, label: label, term: term,
    multiple: shipped ? shipped.multiple === true
      : Boolean(held && held.multiple === true),
    retired: true };
  if (held && typeof held.blank === "string") doc.blank = held.blank;
  else if (shipped && typeof shipped.blank === "string") {
    doc.blank = shipped.blank;
  }
  if (!(shipped && shipped.choicesFrom)) {
    doc.values = currentValues(shipped, held);
  }

  await writeContentRow(env, FIELD_PREFIX + id, JSON.stringify(doc), caller);
  await noteAdminWrite(env, caller, "field.retire", id, label);
  return json({ ok: true }, 200, origin);
}

/*
 * The membership lists - who administers, and who bypasses the group
 * check (#69).
 *
 * THIS TABLE IS ENFORCING, and it is the first thing to know about all
 * three of these routes. A row here grants what it says it grants:
 * adminVia() reads `admin` rows beside ADMIN_TELEGRAM_IDS and beside
 * the group role the bot reports, and groupStanding() unions
 * `always_allow` rows with ALWAYS_ALLOW_TELEGRAM_IDS. Every arm is
 * live, and that is the shipped posture rather than a moment in a
 * migration.
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
   * NOTHING MINTS ONE ANY MORE - the local sign-in that did was removed
   * with its binding (0.9-M2-S1, #352) - so the only session that can
   * reach this carrying is_dev is a row written straight into D1. That
   * makes this refusal narrower than it was and worth MORE, not less: a
   * hand-written session is exactly the caller who should not be able to
   * turn itself into a durable admin row, which outlives the session and
   * is the whole authority once the flip to table-only happens.
   *
   * There is deliberately no escape hatch. A second secret to gate the
   * exception is a second secret to forget, and no route here issues the
   * flag at all - so this refusal costs every deployment nothing and is
   * a real boundary on any database somebody has written to by hand.
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
  // The change log records every admin write, this one included, and it
  // is not the same record as the line above: noteSelfWrite is a
  // console line about an admin changing their OWN row, which is a
  // narrower question and one nobody reads through a route.
  await noteAdminWrite(env, caller, "membership.add", accountId,
    role + ": " + label);
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
  // Reached only past the 409, so the line records a removal that
  // happened. A removal of nothing still appends: "I pressed remove and
  // the row was already gone" is a thing the next reader of the log
  // needs to be able to tell from "nobody touched it".
  await noteAdminWrite(env, caller, "membership.remove", wanted, role);
  return json({ ok: true }, 200, origin);
}

/*
 * HAS THIS ACCOUNT LEFT THE GROUP? The one question this whole slice
 * turns on (0.9-M3-S15, #420; the ruled design #385, rule 4).
 *
 * THE BOT IS THE ONLY JUDGE, and nothing on this side may stand in for
 * it. Staleness is a fact about sign-ins, a label is a nickname
 * somebody typed, and neither is evidence anybody left. groupStanding()
 * asks Telegram and its answer is the verdict - reached through that
 * function rather than around it, so the timeout, the always_allow
 * bypass and the error path that must never log the bot token all keep
 * one home.
 *
 * THE NUMERIC ID COMES OUT OF THE SEALED DIRECTORY RECORD AND GOES
 * NOWHERE ELSE. It is unsealed here, handed to groupStanding(), and
 * dropped when this function returns: it is never written to another
 * table, never put in a response, never logged, and never returned from
 * this function - what leaves here is two booleans and, when somebody
 * actually said one, a word. This is the ONLY reader of that field,
 * which is the condition the owner attached to letting the field exist
 * at all (2026-08-21). A second reader is not a refactor; it is a new
 * decision.
 *
 * THREE ANSWERS, NOT TWO. Departed, still here, or allowed by an
 * operator's list - and the third is not a flavor of the second. It is
 * reached without asking Telegram at all, so a caller that reports it
 * as the group's verdict is speaking for somebody who never spoke; the
 * `allowed` flag below carries that, and `status` stays null with it.
 * Unknown sits outside all three, as its own refusal.
 *
 * FOUR WAYS TO GET "UNKNOWN", AND UNKNOWN IS NEVER DEPARTED. No
 * directory row; a row whose record will not open; a record written
 * before the id existed, which is every row from before that ruling
 * until its member next signs in; and Telegram not answering. All four
 * collapse to the same answer on purpose, because "the question could
 * not be asked" is one fact however it arose, and every caller must
 * fail closed on all of it. (A fifth branch below catches a standing
 * that carries no word at all, which groupStanding() does not produce
 * today; it is a guard against inventing a quotation, not a fifth way
 * for a real deployment to get here.) DESIGN.md's bot-failure stance
 * governs here exactly as it governs sign-in: "cannot check" is never
 * treated as "not a member".
 *
 * IT THROWS NOTHING. A directory row that will not open is a real
 * possibility across a key rotation, and an admin looking at a cleanup
 * list should see that one account sit the list out rather than watch
 * the whole page fail. The catches are wide for that reason and narrow
 * in what they can hide: every branch inside them ends in the same
 * "unknown" the callers already refuse on.
 */
async function departedVerdict(env, accountId) {
  /*
   * The reason travels WITH the refusal rather than being reconstructed
   * by the caller: this function is the only place that knows which of
   * the ways it failed actually happened, and a caller guessing from a
   * bare `known: false` is how the sign-in wording ended up printed
   * over a Telegram outage.
   */
  const unknown = (reason) => ({
    known: false, departed: false, allowed: false, status: null,
    reason: reason,
  });

  let row;
  try {
    row = await env.DB.prepare(
      "SELECT ciphertext FROM directory WHERE account_id = ?"
    ).bind(accountId).first();
  } catch (e) {
    return unknown(UNKNOWN_UNTIL_SIGN_IN);
  }
  if (!row || typeof row.ciphertext !== "string") {
    return unknown(UNKNOWN_UNTIL_SIGN_IN);
  }

  let telegramId;
  try {
    const store = await openStore(env);
    const record = JSON.parse(await store.openDirectory(
      base64ToBytes(row.ciphertext),
      { accountId: accountId, recordId: DIRECTORY_SLOT }));
    telegramId = record && record.telegramId;
  } catch (e) {
    return unknown(UNKNOWN_UNTIL_SIGN_IN);
  }
  /*
   * TELEGRAM_ID rather than a truthiness test, and the difference is
   * what reaches the network: a record from before the field existed
   * reads undefined, and one carrying anything that is not a bare
   * numeric id is not a record this Worker wrote. Both are "cannot
   * ask", and neither may be interpolated into the bot URL.
   */
  if (typeof telegramId !== "string" || !TELEGRAM_ID.test(telegramId)) {
    return unknown(UNKNOWN_UNTIL_SIGN_IN);
  }

  /*
   * FROM HERE ON A FAILURE IS TELEGRAM'S, NOT THE RECORD'S, and that is
   * where the two reasons part company (review finding F4). Everything
   * above is fixed by that member signing in again; nothing below is.
   */
  const standing = await groupStanding(env, telegramId);
  if (standing.standing === "unknown") return unknown(UNKNOWN_BOT_SILENT);

  /*
   * AN OPERATOR'S LIST IS ITS OWN ANSWER, not a quiet "still a member"
   * (Prime's ruling on review finding F3, 2026-08-21: never attribute
   * to the bot what the bot did not say).
   *
   * groupStanding() answers "member" for an account on either
   * always_allow arm WITHOUT asking Telegram, so such an account's
   * departed state is decided by the operator's list and not by the
   * group. The previous shape folded that into the same "still a
   * member" answer a real bot verdict produces, and the refusal built
   * on it told an admin Telegram had spoken - which it can do while the
   * bot would have said the exact opposite, since the bypass is checked
   * before the call is ever made.
   *
   * `status` STAYS NULL HERE on purpose. Every word this function hands
   * out is a word somebody said; there is nobody to quote for this one,
   * so the callers name the list instead.
   */
  if (standing.bypassed) {
    return { known: true, departed: false, allowed: true, status: null };
  }

  /*
   * Everything left came from the group and carries the group's own
   * word. A member-or-left standing with no word is a shape
   * groupStanding() does not produce; if one ever arrives it is
   * "cannot ask" rather than a word to invent, because a quoted status
   * that nobody said is the whole of what F3 was.
   */
  if (typeof standing.status !== "string" || standing.status === "") {
    return unknown(UNKNOWN_BOT_SILENT);
  }
  return {
    known: true,
    departed: standing.standing === "left",
    allowed: false,
    status: standing.status,
  };
}

async function eraseAccount(env, accountId) {
  const lastGrantingAdmin =
    " AND (role <> 'admin'" +
    " OR NOT (" + grantsAnythingSql("account_id") + ")" +
    " OR (SELECT COUNT(*) FROM membership AS granting" +
    " WHERE granting.role = 'admin' AND " +
    grantsAnythingSql("granting.account_id") + ") > 1)";

  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM submissions WHERE account_id = ?")
      .bind(accountId),
    env.DB.prepare("DELETE FROM directory WHERE account_id = ?")
      .bind(accountId),
    env.DB.prepare(
      "DELETE FROM membership WHERE account_id = ? COLLATE NOCASE" +
      lastGrantingAdmin
    ).bind(accountId),
    env.DB.prepare("DELETE FROM sessions WHERE account_id = ?")
      .bind(accountId),
  ]);

  const changed = (index) => {
    const meta = results[index] && results[index].meta;
    return meta && typeof meta.changes === "number" ? meta.changes : 0;
  };
  return {
    submissions: changed(0),
    directory: changed(1),
    membership: changed(2),
    sessions: changed(3),
  };
}

/*
 * The departed list, admin only (#420 scope 1).
 *
 * TWO STEPS THAT ARE NOT THE SAME STEP. Staleness picks the candidates
 * - directory rows nobody has signed in behind for DEPARTED_STALE_DAYS,
 * oldest first, capped - and the bot decides which of those have
 * actually left. Only the second list is served. A surface built from
 * the first would be a list of members who have been quiet, offered to
 * an admin under a heading that says they are gone.
 *
 * WHAT A ROW CARRIES, and what it deliberately does not: the account id
 * this Worker already writes in the clear beside every entry, the label
 * `membership` holds when one exists, and `last_seen_at`. Never the
 * handle - the directory's record stays sealed and this route does not
 * open it - and never a numeric Telegram id, which is not stored
 * anywhere to serve. The label is a nickname an admin typed, so it
 * names nobody Telegram would recognize.
 *
 * IT IS A MEMBERSHIP ORACLE, BOUNDED TO ADMINS, and that is the reason
 * the gate is in the router beside the other admin reads rather than
 * in this function: answering a non-admin at all - even with an empty
 * list - would tell them whether anybody has left, which is a fact
 * about the group's composition and not theirs to have.
 */
async function handleReadDeparted(env, origin) {
  const cutoff = new Date(
    Date.now() - DEPARTED_STALE_DAYS * 24 * 3600 * 1000).toISOString();

  const stale = await env.DB.prepare(
    "SELECT account_id, last_seen_at FROM directory WHERE last_seen_at < ? " +
    "ORDER BY last_seen_at ASC LIMIT " + DEPARTED_LIST_CAP
  ).bind(cutoff).all();

  const labels = new Map();
  const rows = await env.DB.prepare(
    "SELECT account_id, label FROM membership"
  ).all();
  for (const row of ((rows && rows.results) || [])) {
    labels.set(String(row.account_id).toLowerCase(), row.label);
  }

  const departed = [];
  const unknown = [];
  const allowed = [];
  for (const row of ((stale && stale.results) || [])) {
    const verdict = await departedVerdict(env, row.account_id);
    const entry = {
      accountId: row.account_id,
      label: labels.get(String(row.account_id).toLowerCase()) || null,
      lastSeenAt: row.last_seen_at,
    };
    /*
     * THREE LISTS, BECAUSE THE TWO REASONS AN ACCOUNT IS NOT ERASABLE
     * ARE DIFFERENT REASONS AND NEITHER IS NOTHING.
     *
     * An account the bot could not be asked about must never appear
     * among the departed - an erase offered against that list has to be
     * safe, and that is the list's whole meaning. But dropping it
     * silently is its own lie: the commonest reason to be unaskable is
     * a directory record written before the numeric id was sealed into
     * it (owner ruling, 2026-08-21), which every row carries until its
     * member next signs in. An admin who saw a stale account simply
     * vanish would conclude it had been checked and cleared. The row
     * carries the verdict's OWN reason rather than a wording chosen
     * here, because a Telegram outage and a record with no sealed id
     * are both unknown and call for opposite next actions (review
     * finding F4).
     *
     * `allowed` is the same argument for a different fact (Prime's
     * ruling on review finding F3): an account on either always_allow
     * arm is held here by the OPERATOR'S LIST, not by the group, and
     * the bot was never asked about it. Reporting it as still-a-member
     * would put words in Telegram's mouth, and dropping it would leave
     * an admin unable to erase it and unable to find out why. The
     * reason names the list and the next action, because removing the
     * always_allow row is the only thing that changes this answer.
     *
     * A current member simply is not listed: the bot answered, the
     * answer was "still here", and that is a fact about somebody who is
     * not being cleaned up.
     */
    if (!verdict.known) {
      unknown.push(Object.assign({ reason: verdict.reason }, entry));
      continue;
    }
    if (verdict.allowed) {
      allowed.push(Object.assign({ reason: ALLOWED_BY_LIST }, entry));
      continue;
    }
    if (!verdict.departed) continue;
    departed.push(Object.assign({ status: verdict.status }, entry));
  }

  return json(
    { ok: true, departed: departed, unknown: unknown, allowed: allowed },
    200, origin);
}

/*
 * Erase one departed member's rows (#420 scope 2).
 *
 * THE VERDICT IS RE-ASKED HERE AND NEVER CARRIED FROM THE LIST. The
 * list is a page an admin may have been looking at for an hour, and a
 * member can rejoin a Telegram group in a second. Trusting the list
 * would make this route's safety a property of how fresh somebody's
 * browser tab was, which is not a property at all.
 *
 * EVERY REFUSAL HAPPENS BEFORE ANYTHING IS DELETED, and the order is
 * cheapest-and-most-certain first: the shape of the id, then who is
 * asking about whom, then the membership invariant, then the bot. An
 * erase that deleted three row classes and then discovered it should
 * not have would have no way back.
 *
 * A CURRENT MEMBER IS REFUSED WITH THE VERDICT QUOTED BACK, because the
 * admin needs to be able to tell "Telegram says they are still here"
 * from "Telegram did not answer" - the two look identical from a
 * surface that only says no, and they call for opposite next actions.
 * The status is Telegram's own word and names nobody.
 *
 * AND AN ACCOUNT AN OPERATOR'S LIST IS HOLDING OPEN IS A THIRD
 * REFUSAL, in the list's words rather than Telegram's (Prime's ruling
 * on review finding F3). The bot is never asked about such an account,
 * so quoting it here reported a verdict nobody gave - and could report
 * the opposite of the one the bot would have given, since the bypass
 * short-circuits the call. Worse, that refusal was permanent and said
 * nothing about why: the branch below names the list and the next
 * action instead. It sits ABOVE the still-a-member branch because a
 * bypassed account satisfies that test too, and the more specific
 * reason is the true one.
 *
 * AN ADMIN MAY NOT ERASE THEMSELVES here. The route is for members who
 * are gone, and a caller holding a live admin session is demonstrably
 * present; a self-erase would also delete the session mid-request and
 * answer through a credential that no longer exists. Somebody wanting
 * their own data gone deletes their entries as a member, which is
 * self-service and needs no admin at all.
 */
async function handleEraseDeparted(env, origin, accountId, caller) {
  const wanted = String(accountId);
  if (!ACCOUNT_ID.test(wanted)) {
    return json({ error: "Not found." }, 404, origin);
  }
  if (caller.accountId && caller.accountId === wanted) {
    return json({
      error: "This removes a departed member's rows, and you are signed " +
        "in. To remove your own entries, delete them from your own page.",
    }, 409, origin);
  }

  /*
   * The membership invariant, asked before the transaction rather than
   * inside it. eraseAccount()'s own statement carries the same guard,
   * so the invariant does not rest on this read winning a race - what
   * this read buys is that the ordinary case is a clean refusal that
   * erases nothing, instead of an erase that silently leaves one row
   * behind and reports a count nobody expected.
   */
  const held = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM membership AS granting" +
    " WHERE granting.role = 'admin' AND " +
    grantsAnythingSql("granting.account_id") + ") AS granting," +
    " (SELECT COUNT(*) FROM membership AS held" +
    " WHERE held.account_id = ? COLLATE NOCASE AND held.role = 'admin'" +
    " AND " + grantsAnythingSql("held.account_id") + ") AS holds"
  ).bind(wanted).first();
  if (held && held.holds > 0 && held.granting <= 1) {
    return json({
      error: "That is the last admin row. Add another admin before " +
        "erasing this account.",
    }, 409, origin);
  }

  const verdict = await departedVerdict(env, wanted);
  if (!verdict.known) {
    return json({
      error: "The bot could not say whether that member has left - " +
        verdict.reason + ". Nothing was erased.",
    }, 409, origin);
  }
  if (verdict.allowed) {
    return json({
      error: "That account is " + ALLOWED_BY_LIST + ". Telegram was " +
        "never asked about it, so nothing was erased.",
    }, 409, origin);
  }
  if (!verdict.departed) {
    return json({
      error: "Telegram says that account is still in the group " +
        "(“" + verdict.status + "”), so nothing was erased.",
    }, 409, origin);
  }

  const removed = await eraseAccount(env, wanted);

  /*
   * The line, after the write like every other one (noteAdminWrite
   * carries that rule and why it is not best-effort).
   *
   * COUNTS AND A VERDICT, NEVER A ROW. server/schema.sql's `admin_log`
   * block rules that nothing a member typed goes in this table, and
   * that is what makes this line writable at all: "four entries and a
   * directory row came down" is a fact about an administrative act,
   * while a line naming WHICH entry came down would be a fact about a
   * member's data sitting in the clear beside the entries themselves.
   * The subject is the short id for the same reason - enough to tell
   * two erases apart, not enough to join the log against the rows of
   * everybody who remains.
   */
  await noteAdminWrite(env, caller, "erase",
    wanted.slice(0, SHORT_ID_CHARS),
    "telegram said " + verdict.status + "; removed " +
    removed.submissions + " submissions, " + removed.directory +
    " directory, " + removed.membership + " membership, " +
    removed.sessions + " sessions");

  return json({ ok: true, removed: removed }, 200, origin);
}

/*
 * The path shapes this Worker answers for itself; every other path is
 * static-asset territory. One segment per route family below -
 * "submission" rather than "submission/:id", because this guard only
 * needs to know THAT a path is this Worker's, not which row it names;
 * route() below still resolves the rest exactly as it always has.
 *
 * server/wrangler.toml's [assets] and [env.sit.assets] blocks carry
 * the same set, as their own run_worker_first pattern lists (a bare
 * pattern for a segment with no sub-resource, plus a "/*" pattern for
 * one that takes one) - see the comment above [assets] there for why:
 * in short, so Cloudflare's own routing layer never lets a static file
 * answer in this Worker's place, on any of these paths, whether or not
 * one happens to exist at that path in dist/ today. tests/route-
 * precedence.test.mjs derives both lists from the two files and fails
 * if they ever name a different set - the guard a hand-kept comment
 * cannot give itself.
 *
 * AND NO SEGMENT HERE MAY BE A PAGE'S BASENAME. The static-assets
 * layer's html_handling answers a request for /x.html with a redirect
 * to /x, and the browser follows it - so a segment named after a page
 * makes that page unreachable at its own URL: the redirect lands on a
 * run_worker_first pattern and this router answers the API's refusal
 * where the HTML should be. "charts" was exactly that, and the charts
 * page was unreachable until the ROUTE was renamed /charts-data
 * (0.9-M2-S8, #365) - the route moved rather than the page, because the
 * page's name is what a person types. tests/route-precedence.test.mjs
 * reads apps/web/ at run time and fails on any new collision; do not
 * turn that into a list written down here, because a list written down
 * is how this one arrived unnoticed.
 */
const API_SEGMENTS = new Set([
  "auth", "session", "me", "my-entries", "submit", "charts-data", "export",
  "submission", "content", "membership", "config", "admin-log", "spec",
  "admin-departed", "admin-fields",
]);

function isApiPath(pathname) {
  return API_SEGMENTS.has(pathname.split("/")[1] || "");
}

/*
 * Every route, once the origin is settled.
 *
 * Split from fetch() so that one try/catch can stand around all of it -
 * see fetch() for why an escaped throw is a refusal shape this Worker
 * does not otherwise have.
 */
async function route(request, env, url, allowed, admitted) {
  const path = url.pathname;
  const method = request.method;

  /*
   * Decided before anything else in this function runs, including the
   * origin gate just below: an ordinary page navigation and a request
   * for a font file carry no Origin header at all, and gating them on
   * ALLOWED_ORIGINS would 403 the site itself rather than serve it.
   * Reaching this line means Cloudflare's own asset lookup already
   * missed - wrangler.toml's run_worker_first sends every API-shaped
   * path straight past that lookup and into this function; every other
   * path tries it first and only lands here on a miss - so handing the
   * request back to env.ASSETS.fetch is what applies this deployment's
   * own not_found_handling to it, rather than this function inventing
   * a second, different "not found" of its own.
   */
  if (!isApiPath(path)) return env.ASSETS.fetch(request);

  // The preflight is unchanged by 0.9-M2-S8 and gates on `allowed`
  // rather than on `admitted`: a real preflight always carries an
  // Origin, so a preflight without one is not a browser and has nothing
  // to be told.
  if (method === "OPTIONS") {
    if (!allowed) {
      return new Response(null, { status: 403, headers: { Vary: VARY } });
    }
    return new Response(null, { status: 204, headers: corsHeaders(allowed) });
  }

  // `admitted`, not `allowed` - the two are different questions and
  // originAdmits() carries the whole argument. In one line: `allowed`
  // is the origin to echo back and is null for a same-origin read,
  // which has no Origin header to echo; refusing on it refused the site
  // its own reads (#365).
  if (!admitted) {
    return json({ error: "Origin not allowed." }, 403, null);
  }

  // The one route that ISSUES a credential, and it answers without one
  // because that is what it is for. There is no local sign-in beside it: a second
  // credential-issuing door gated on a binding is a door that opens
  // wherever that binding is set, and this Worker has none (0.9-M2-S1,
  // #352). Anything else under /auth falls through to this function's
  // closing 404, which is the answer a path this Worker does not serve
  // gets - not a route declining to answer.
  if (method === "POST" && path === "/auth/telegram") {
    return handleTelegramAuth(request, env, allowed);
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
  // The charts, members only (DESIGN.md, "Charts": "Charts require a
  // session; the public URL shows the door and nothing else"). A
  // break-glass EXPORT_TOKEN caller has no account and is refused here
  // for the same reason POST /submit and GET /my-entries refuse it -
  // there is no member whose line the overlay would be. Nothing is
  // withheld from that caller: GET /export is the whole corpus, and an
  // aggregate of it is a strictly smaller answer.
  if (method === "GET" && path === "/charts-data") {
    if (!caller || !caller.accountId) return unauthorized(allowed);
    return handleCharts(request, env, allowed, caller);
  }
  if (method === "GET" && path === "/export") {
    return handleExport(request, env, allowed, caller);
  }

  // A member deletes their own row here, and an admin deletes anyone's -
  // the handler scopes the member's delete to their session account and
  // leaves the admin's unscoped (0.9-M1-S6, #332; DESIGN.md, "Admin
  // accounts and deletion"). A break-glass EXPORT_TOKEN caller is an
  // admin and takes the admin path; a caller with neither adminness nor
  // an account has nothing to delete and is refused here, so the handler
  // never runs with an account of null in its member branch.
  const submission = /^\/submission\/([^/]+)$/.exec(path);
  if (method === "DELETE" && submission) {
    if (!caller || (!caller.isAdmin && !caller.accountId)) {
      return unauthorized(allowed);
    }
    return handleDeleteSubmission(env, allowed, submission[1], caller);
  }

  // The site copy. The read takes no credential, which is argued in
  // handleReadContent; the two writes are an admin session like every
  // other write here.
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
    return handleDeleteContent(env, allowed, contentName[1], caller);
  }

  // The three values a page needs before anybody has signed in - the
  // second route here that answers without a credential, and the
  // narrower of the two. GET only: this is a window on a table the
  // admin routes above write, and a second write door onto the same
  // rows would be a second place the settings validation has to be
  // remembered. Anything else under /config falls through to the
  // closing 404.
  if (method === "GET" && path === "/config") {
    return handleReadConfig(env, allowed);
  }

  // The change log, admin only (#385 rule 5). Gated here rather than in
  // the handler, so a member and a stranger meet the same refusal -
  // that lines exist at all is an answer only an admin may have.
  if (method === "GET" && path === "/admin-log") {
    if (!admin) return unauthorized(allowed);
    return handleReadAdminLog(env, allowed);
  }

  // Departed-member cleanup, admin only in both directions (#385 rule
  // 4). Gated here beside the other admin reads rather than in the
  // handlers, and for the list that gate is the whole privacy property
  // rather than a formality: who has left is a fact about the group's
  // composition, so a member and a stranger meet the same refusal and
  // neither learns whether the list would have been empty.
  //
  // The route is hyphenated because "admin" cannot be an API segment at
  // all: the static-assets layer redirects /admin.html to /admin, so a
  // segment by that name would answer this router's refusal where the
  // admin page belongs - the defect /charts had in #365, measured again
  // at 0.9-M3-S8 (#414).
  if (method === "GET" && path === "/admin-departed") {
    if (!admin) return unauthorized(allowed);
    return handleReadDeparted(env, allowed);
  }
  const departed = /^\/admin-departed\/([^/]+)$/.exec(path);
  if (method === "DELETE" && departed) {
    if (!admin) return unauthorized(allowed);
    return handleEraseDeparted(env, allowed, departed[1], caller);
  }

  /*
   * The form, as the admins have built it (0.9-M3-S11, #419).
   *
   * A SESSION AND NOT AN ADMIN ONE: the pages that draw the form and
   * the charts are member pages, and the spec is what they draw from.
   * A break-glass EXPORT_TOKEN caller reads it too and is not refused
   * here the way POST /submit refuses it, because nothing in this
   * answer is scoped to an account - there is no member whose spec this
   * would be.
   *
   * READ ONLY. The writes are the two routes below, whose whole job is
   * checking an edit against what members have already saved; a second
   * write door onto the same rows would be that checking with a way
   * around it.
   */
  if (method === "GET" && path === "/spec") {
    if (!caller) return unauthorized(allowed);
    return handleReadSpec(env, allowed);
  }

  /*
   * The form builder, admin in both directions - and HYPHENATED,
   * never /admin/<anything>. The static-assets layer's html_handling
   * redirects /admin.html to /admin, so an "admin" API segment would
   * answer this router's refusal where the admin page belongs; that is
   * the defect the /charts route hit in #365, and the comment above
   * API_SEGMENTS carries the whole of it.
   */
  const adminField = /^\/admin-fields\/([^/]+)$/.exec(path);
  if (method === "PUT" && adminField) {
    if (!admin) return unauthorized(allowed);
    return handleWriteField(request, env, allowed, adminField[1], caller);
  }
  if (method === "DELETE" && adminField) {
    if (!admin) return unauthorized(allowed);
    return handleRetireField(env, allowed, adminField[1], caller);
  }

  // Membership, admin in every direction, and these two lists are the
  // authority itself rather than data behind it. The gate is here
  // rather than inside the handlers so that a malformed role and a
  // real one are the same refusal to anybody who may not read the list
  // at all.
  //
  // A session flagged `is_dev` is not an admin by virtue of the flag,
  // and two different things say so. On the 'flag' and 'secret' arms
  // adminness is read from the admin lists, so such a session is a
  // member unless its account id sits in one. On the 'telegram' arm the
  // lists are not consulted at all, because the session row is the
  // authority there, so what refuses the development row is the
  // explicit !isDev in sessionFor(): drop that clause trusting the
  // lists to handle it and a hand-written row gets the arm it named for
  // itself. The flag buys a second refusal on top of both, a caller
  // carrying it may not touch the admin list at all, which
  // handleAddMembership argues in full. The
  // role is in the path here, so the refusal is in the router where the
  // rest of the gate is; on POST it is the first thing past the body
  // parse, which is the earliest the role is knowable at all.
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

/*
 * A named export beside the default one Cloudflare actually deploys -
 * the runtime only ever calls the default export's fetch(), so this
 * changes nothing about what ships. It lets
 * tests/route-precedence.test.mjs exercise the precedence decision as
 * the pure function it is, without needing a D1 stub the decision
 * itself never touches - matching the pure/DOM split AGENTS.md asks
 * for everywhere else in this repository, applied here for the first
 * time because this is the first piece of server/worker.js's own logic
 * simple enough to have one.
 *
 * eraseAccount IS IRREVERSIBLE and is exported anyway (0.9-M3-S15,
 * #420), so the reason it is safe is written here rather than assumed:
 * the runtime reaches this module only through the default export's
 * fetch(), which never calls a named export, and nothing else in the
 * deployed Worker imports this file at all. What the export buys is a
 * proof that could not otherwise be real - the two-member byte-identity
 * arm aims at the transaction itself, because a route-level proof can
 * always be hollowed out by a refusal that fires before the erase.
 */
export { isApiPath, API_SEGMENTS, rowIdentity, syncDirectoryEntry,
         DIRECTORY_SLOT, eraseAccount };

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
    const admitted = originAdmits(request, env);

    try {
      return await route(request, env, url, allowed, admitted);
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
