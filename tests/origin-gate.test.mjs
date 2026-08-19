/*
 * The origin gate, driven end to end against server/worker.js's real
 * fetch() (0.9-M2-S8, #365).
 *
 *     node tests/origin-gate.test.mjs
 *
 * THE DEFECT THIS ARM EXISTS FOR. A browser attaches an `Origin` header
 * to POST and to cross-origin fetch, and to nothing else - not to a
 * same-origin GET fetch, not to an address-bar navigation. The gate
 * asked one question, `allowedOrigins(env).includes(origin)`, and an
 * absent Origin is in no list, so every read the site made of itself
 * came back 403 while the POST a second earlier succeeded. The owner
 * met it at the first M2 sitting: entries saved, nothing read back.
 *
 * WHY IT HAS ITS OWN FILE rather than joining tests/route-precedence.
 * test.mjs. That arm states in its own header that it drives fetch()
 * with NO D1 stub, deliberately, because precedence is decided before
 * any database is touched. The regression here is the opposite shape:
 * proving a same-origin read now SUCCEEDS needs a session that
 * resolves, which needs a session row, which needs a stub. Keeping the
 * two apart keeps that arm's claim true.
 *
 * WHAT IS PROVEN, in the three states the gate now distinguishes:
 *
 *   present and allowed   reaches the route table, and the answer
 *                         echoes that origin back in CORS headers.
 *   present and foreign   403, every method, unchanged by this slice.
 *   absent                reaches the route table on GET only, and the
 *                         answer carries NO Access-Control-Allow-Origin
 *                         at all - never `*`, never the literal "null".
 *
 * And the property the whole change rests on: the SESSION is still the
 * gate. An absent-Origin read with no credential is 401, exactly as it
 * was; nothing here admits a caller the old gate would have admitted
 * and then let past the session check.
 *
 * MUTATION EVIDENCE lives at the bottom of this file rather than only
 * in a completion comment: the old one-question gate is reconstructed
 * from the shipped source and driven, and this arm asserts it produces
 * the 403 the owner actually saw. A check that cannot show its own
 * failure mode is a check nobody has confirmed is armed.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKER_PATH = ROOT + "server/worker.js";

const worker = await import(pathToFileURL(WORKER_PATH).href);
const fetchWorker = worker.default.fetch;

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

const sha256hex = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/* ------------------------------------------------------------------ */
/* The smallest environment that can answer a member read.             */

const ORIGIN = "https://sit.example";
const FOREIGN = "https://not-the-site.example";
const SESSION_TOKEN = "origin-arm-session-token-belonging-to-nobody";
const ACCOUNT = "a".repeat(64);
const STORE_SECRET = "origin arm store secret / not a real one / v1";

/*
 * A D1 stub that answers exactly the three statements a credentialed
 * GET on this Worker reaches, and THROWS on anything else. A stub that
 * quietly answered an unmodelled statement would let a handler take a
 * path this arm believes it never takes, and the arm would still be
 * green - the failure this whole file is a response to, in miniature.
 */
function makeDb(sessionRow) {
  const answer = (sql, args) => {
    if (/FROM sessions WHERE token_hash/i.test(sql)) {
      // Keyed on the bound hash, not handed back to whoever asks: a
      // stub that answers every token turns "the session is still the
      // gate" into a sentence nothing tests.
      return args[0] === sessionRow.token_hash ? sessionRow : null;
    }
    if (/UPDATE sessions SET expires_at/i.test(sql)) return { meta: {} };
    if (/FROM submissions AS mine/i.test(sql)) {
      // handleMe's aggregate reads through first(); handleMyEntries'
      // listing and handleCharts' corpus read through all(). One table,
      // three readers, and an empty account for all of them - what a
      // read RETURNS is tests/entry-rows.test.mjs's and tests/charts-
      // aggregate.test.mjs's subject, never this file's.
      return { total: 0, superseded: 0, last_at: null, results: [] };
    }
    if (/FROM site_content/i.test(sql)) return { results: [] };
    throw new Error("unmodelled statement: " + sql);
  };
  const bound = (sql, args) => ({
    first: async () => answer(sql, args),
    all: async () => answer(sql, args),
    run: async () => answer(sql, args),
  });
  return {
    prepare: (sql) => Object.assign(bound(sql, []),
      { bind: (...args) => bound(sql, args) }),
  };
}

const future = new Date(Date.now() + 3600_000).toISOString();
const env = {
  DB: makeDb({
    token_hash: sha256hex(SESSION_TOKEN),
    account_id: ACCOUNT,
    is_admin: 0,
    is_dev: 0,
    created_at: new Date().toISOString(),
    expires_at: future,
  }),
  STORE_SECRET,
  ALLOWED_ORIGINS: ORIGIN,
  ASSETS: { fetch: async () => new Response("asset bytes", { status: 200 }) },
};

/*
 * `origin: null` means the header is ABSENT, which is the whole subject
 * of this file - not the string "null", which is a real header value an
 * opaque origin sends and which this Worker refuses like any other
 * foreign one (checked below).
 */
async function callWith(fetchFn, method, path,
  { origin, token, site, body } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = "Bearer " + token;
  if (site) headers["Sec-Fetch-Site"] = site;
  const init = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const response = await fetchFn(
    new Request("https://sit.example" + path, init), env);
  let parsed = null;
  try { parsed = await response.clone().json(); } catch { parsed = null; }
  return { status: response.status, body: parsed, headers: response.headers };
}

const call = (method, path, options) => callWith(fetchWorker, method, path, options);
const acao = (r) => r.headers.get("Access-Control-Allow-Origin");

/* ------------------------------------------------------------------ */
/* 1. The regression: a same-origin read, which carries no Origin.      */

const meAbsent = await call("GET", "/me", { token: SESSION_TOKEN });
check("REGRESSION: a GET with NO Origin header and a valid session is " +
  "answered, not refused - this is what every same-origin read the " +
  "page makes looks like on the wire",
  meAbsent.status === 200 && meAbsent.body && meAbsent.body.ok === true);

/* The 200 is asserted again in each no-CORS check below, on purpose: a
   403 carries no Access-Control-Allow-Origin either, so "no ACAO" alone
   is a claim the defect itself satisfies. The pair is the claim. */
check("and it carries NO Access-Control-Allow-Origin - there is no " +
  "origin to echo, and inventing `*` or \"null\" would hand a foreign " +
  "page read access to a credentialed answer",
  meAbsent.status === 200 && acao(meAbsent) === null);

const entriesAbsent = await call("GET", "/my-entries", { token: SESSION_TOKEN });
check("REGRESSION: GET /my-entries with no Origin answers the listing - " +
  "the exact read your-page.html fires and the owner saw 403",
  entriesAbsent.status === 200 && entriesAbsent.body &&
  entriesAbsent.body.ok === true &&
  Array.isArray(entriesAbsent.body.entries));
check("and it carries no Access-Control-Allow-Origin either",
  entriesAbsent.status === 200 && acao(entriesAbsent) === null);

/* The Cache-Control header is the discriminator, and it has to be: this
   path is no longer API-shaped if the rename went wrong, and an asset
   delegation answers 200 with no ACAO too - which is exactly the shape
   this check would otherwise accept as a pass. Only handleCharts sets
   `private, no-store`. */
const chartsAbsent = await call("GET", "/charts-data?measure=weight",
  { token: SESSION_TOKEN });
check("REGRESSION: the renamed charts route with no Origin is answered " +
  "by the ROUTER (its own private, no-store answer), never a 403 and " +
  "never a static asset standing in for it",
  chartsAbsent.status === 200 && acao(chartsAbsent) === null &&
  /private/i.test(String(chartsAbsent.headers.get("Cache-Control"))) &&
  /no-store/i.test(String(chartsAbsent.headers.get("Cache-Control"))));

const contentAbsent = await call("GET", "/content");
check("the one credential-free route answers a no-Origin read too",
  contentAbsent.status === 200 && contentAbsent.body.ok === true);

/* ------------------------------------------------------------------ */
/* 2. The session is still the whole gate.                             */

const meNoSession = await call("GET", "/me");
check("THE GATE THAT MATTERS: a no-Origin read with no credential is " +
  "401, not 200 - admitting the absent Origin moved nothing about who " +
  "may read what",
  meNoSession.status === 401);

const entriesNoSession = await call("GET", "/my-entries");
check("and the same for the member listing", entriesNoSession.status === 401);

const meBadSession = await call("GET", "/me",
  { token: "not-a-token-anybody-issued" });
check("a forged bearer token with no Origin is 401 as well - the " +
  "session lookup answers, and it answers no",
  meBadSession.status === 401);

/* ------------------------------------------------------------------ */
/* 3. State-changing methods keep refusing an absent Origin.           */

const submitAbsent = await call("POST", "/submit",
  { token: SESSION_TOKEN, body: { record: "{}" } });
check("a POST with no Origin is still 403 - a browser always sends " +
  "Origin on a state-changing request, so refusing costs a real caller " +
  "nothing and is one more thing a forger has to get right",
  submitAbsent.status === 403 && submitAbsent.body.error === "Origin not allowed.");

const deleteAbsent = await call("DELETE", "/session", { token: SESSION_TOKEN });
check("and a DELETE with no Origin is still 403",
  deleteAbsent.status === 403);

const submitAbsentNoBody = await call("POST", "/auth/telegram", {});
check("the credential-issuing route refuses a no-Origin POST too - the " +
  "gate runs before any route is chosen",
  submitAbsentNoBody.status === 403);

/* ------------------------------------------------------------------ */
/* 4. A present but foreign Origin: unchanged, every method.           */

for (const [method, path, options] of [
  ["GET", "/me", { token: SESSION_TOKEN }],
  ["GET", "/my-entries", { token: SESSION_TOKEN }],
  ["GET", "/content", {}],
  ["POST", "/submit", { token: SESSION_TOKEN, body: { record: "{}" } }],
  ["DELETE", "/session", { token: SESSION_TOKEN }],
]) {
  const refused = await call(method, path,
    Object.assign({ origin: FOREIGN }, options));
  check(`a foreign Origin is refused on ${method} ${path} (403), session ` +
    "or no session",
    refused.status === 403 && acao(refused) === null);
}

const opaque = await call("GET", "/me",
  { origin: "null", token: SESSION_TOKEN });
check("the literal string \"null\" is a PRESENT origin, not an absent " +
  "one - an opaque origin (a sandboxed frame, a file:// page) sends it " +
  "and is refused like any other foreign origin",
  opaque.status === 403);

/* ------------------------------------------------------------------ */
/* 5. A present and allowed Origin: reaches the table, echoes back.    */

const allowedRead = await call("GET", "/me",
  { origin: ORIGIN, token: SESSION_TOKEN });
check("an allowed Origin still reaches the route table and still gets " +
  "its CORS echo",
  allowedRead.status === 200 && acao(allowedRead) === ORIGIN);

const allowedWrite = await call("POST", "/submit",
  { origin: ORIGIN, token: SESSION_TOKEN, body: {} });
check("an allowed Origin still reaches a state-changing route - the " +
  "refusal it earns there is the handler's, not the gate's",
  allowedWrite.status !== 403);

/* ------------------------------------------------------------------ */
/* 6. Sec-Fetch-Site: corroboration on the absent branch only.         */

const sameOrigin = await call("GET", "/me",
  { token: SESSION_TOKEN, site: "same-origin" });
check("no Origin plus Sec-Fetch-Site: same-origin is answered - the " +
  "browser is corroborating exactly what the absent header implies",
  sameOrigin.status === 200);

const none = await call("GET", "/me", { token: SESSION_TOKEN, site: "none" });
check("no Origin plus Sec-Fetch-Site: none (an address-bar navigation) " +
  "is answered", none.status === 200);

for (const site of ["cross-site", "same-site"]) {
  const refused = await call("GET", "/me", { token: SESSION_TOKEN, site: site });
  check(`no Origin but Sec-Fetch-Site: ${site} is refused (403) - the ` +
    "browser is saying this request did not come from this site",
    refused.status === 403);
}

const crossSiteButAllowed = await call("GET", "/me",
  { origin: ORIGIN, token: SESSION_TOKEN, site: "cross-site" });
check("Sec-Fetch-Site is NOT applied where an Origin is present and " +
  "allowed - a deployment serving its pages from a different host than " +
  "this Worker is cross-site by construction, and ALLOWED_ORIGINS is " +
  "what that deployment sets to say so",
  crossSiteButAllowed.status === 200);

/* ------------------------------------------------------------------ */
/* 7. Caching: what the answer varies by.                              */

/*
 * Sampled PER RESPONSE-BUILDER, not per answer shape, and that is the
 * whole point of the list: three of these come out of json()/corsHeaders
 * and would all stay green while a builder that sets its own headers
 * dropped Vary entirely. Every Response this Worker constructs by hand
 * gets its own row here - handleCharts' below, and the preflight refusal
 * in section 8 - because a `Vary` written once per builder is a header
 * that can be deleted once per builder.
 */
const varies = (response) => {
  const vary = String(response.headers.get("Vary") || "");
  return /\bOrigin\b/.test(vary) && /\bSec-Fetch-Site\b/.test(vary);
};

for (const [label, response] of [
  ["a no-CORS answer", meAbsent],
  ["a CORS answer", allowedRead],
  ["a refusal", submitAbsent],
  ["the charts answer, whose Response handleCharts builds itself rather " +
    "than through json()", chartsAbsent],
]) {
  check(`${label} names both request headers it varies by, so no shared ` +
    "cache can serve one caller's answer to another",
    varies(response));
}

/* ------------------------------------------------------------------ */
/* 8. The preflight, unchanged.                                        */

const preflightAllowed = await call("OPTIONS", "/submit", { origin: ORIGIN });
check("a preflight from an allowed origin is 204 with the CORS headers",
  preflightAllowed.status === 204 && acao(preflightAllowed) === ORIGIN);

const preflightForeign = await call("OPTIONS", "/submit", { origin: FOREIGN });
check("a preflight from a foreign origin is 403",
  preflightForeign.status === 403);

const preflightAbsent = await call("OPTIONS", "/submit", {});
check("a preflight with no Origin at all is 403 - a real preflight " +
  "always carries one, so this shape is not a browser",
  preflightAbsent.status === 403);

/* The preflight refusal is the OTHER hand-built Response, and it is the
   one most easily left bare: it carries no body and no CORS headers, so
   nothing else about it would notice a missing Vary. Both refusals are
   asserted because both are what a cache would key. */
for (const [label, response] of [
  ["a preflight refused for a foreign Origin", preflightForeign],
  ["a preflight refused for an absent Origin", preflightAbsent],
]) {
  check(`${label} names both request headers it varies by too`,
    varies(response));
}

/* ------------------------------------------------------------------ */
/* 9. Nothing anywhere hands out a wildcard.                           */

check("no answer in this whole arm carried Access-Control-Allow-Origin: " +
  "* or \"null\"",
  [meAbsent, entriesAbsent, chartsAbsent, contentAbsent, meNoSession,
    submitAbsent, allowedRead, sameOrigin, none, preflightAllowed]
    .every((r) => acao(r) !== "*" && acao(r) !== "null"));

/* ------------------------------------------------------------------ */
/* 10. Mutation: the old one-question gate, reconstructed and driven.  */
/*                                                                     */
/* The shipped source with originAdmits() replaced by the single        */
/* `includes` test it replaced. If this fixture answers anything but    */
/* the 403 the owner saw, the arms above are measuring something other  */
/* than the fix.                                                        */

const workerSrc = (await readFile(WORKER_PATH, "utf8")).replace(/\r\n/g, "\n");

/* server/worker.js imports its neighbours in server/ by relative
   specifier, and a data: module has no base URL to resolve one
   against - rewritten to absolute file URLs exactly as tests/route-
   precedence.test.mjs does, and for the reason its own comment gives. */
const loadWorker = (src) =>
  import("data:text/javascript," + encodeURIComponent(src.replace(
    /(\bfrom\s*)"\.\/([\w.-]+\.js)"/g,
    (whole, from, name) => from + '"' +
      pathToFileURL(ROOT + "server/" + name).href + '"')));

const OLD_GATE_TARGET =
  "  if (origin !== null) return allowedOrigins(env).includes(origin);";
const oldGateSrc = workerSrc.replace(OLD_GATE_TARGET,
  "  return allowedOrigins(env).includes(origin);");
check("the old-gate fixture actually changed the source (the replace " +
  "found its target)", oldGateSrc !== workerSrc);

const { default: oldGateWorker } = await loadWorker(oldGateSrc);
const oldGateRead = await callWith(oldGateWorker.fetch, "GET", "/me",
  { token: SESSION_TOKEN });

check("mutation: the old one-question gate refuses the same-origin read " +
  "(403), which is the defect the owner met - and the shipped gate " +
  "answers the same call 200",
  oldGateRead.status === 403 && meAbsent.status === 200);

/* ------------------------------------------------------------------ */

const EXPECTED = 37;
console.log(failures
  ? `\norigin-gate FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\norigin-gate ran ${performed} checks, expected ${EXPECTED}`
    : `\norigin-gate OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
