/*
 * The Worker serves the site: route precedence, asset delegation and
 * the posture headers (0.9-M1-S3, #329; DESIGN.md, "The constraint
 * that shapes everything" - one Worker serves pages and the API from
 * one origin).
 *
 *     node tests/route-precedence.test.mjs
 *
 * FOUR FACTS, DERIVED FROM THE FILES THAT HOLD THEM.
 *
 * 1. server/worker.js's isApiPath()/API_SEGMENTS decide, in code, which
 *    paths this Worker answers itself. Imported through a data: URL,
 *    the same technique dev/worker.test.mjs uses and for the same
 *    reason: worker.js has no package.json to make a bare import
 *    resolve as ESM, and this still exercises the file's real bytes.
 *    isApiPath is a NAMED export purely for this - the runtime only
 *    ever calls the default export's fetch(), so nothing about what
 *    ships changes.
 * 2. server/wrangler.toml's [assets] and [env.sit.assets] blocks decide,
 *    in CONFIG, which paths reach worker.js at all before Cloudflare's
 *    own asset lookup ever runs (run_worker_first). A fresh line-based
 *    parser reads both blocks, matching the shape of tests/wrangler-
 *    sit.test.mjs's own parser and for the reason it states: a
 *    `[assets]`-shaped block is a `[assets]`-shaped block whatever
 *    else in the file changes around it.
 * 3. The two have to agree, or the deny-by-default claim is false: a
 *    path server/worker.js treats as API-shaped but wrangler.toml's
 *    run_worker_first does not list could be served as a static file
 *    at the edge before this Worker ever sees the request, and no
 *    amount of correct code in worker.js would matter. The sync check
 *    below derives both sets from their own file and asserts equality
 *    - the guard the wrangler.toml and worker.js comments both point
 *    at as living here. Equality of SEGMENTS is not the whole of it,
 *    because `/x` and `/x/*` are one segment and two different rules at
 *    the edge: which spelling each segment needs is derived from the
 *    router's own dispatch lines beside it.
 * 4. AND NEITHER SET MAY NAME A PAGE (0.9-M2-S8, #365). The assets
 *    layer's html_handling answers /x.html with a redirect to /x, so an
 *    API segment sharing a page's basename makes that page unreachable
 *    at its own URL - the router answers the API's refusal instead. The
 *    page basenames are read from apps/web/ at run time rather than
 *    listed here, because a list written down is what let the /charts
 *    collision arrive with nobody noticing.
 *
 * MUTATION EVIDENCE (both directions, run by hand while writing this
 * arm and reported in 0.9-M1-S3's completion): route precedence
 * inverted (`if (!isApiPath(path))` flipped to `if (isApiPath(path))`)
 * reds "mutation: inverted precedence serves a page from the router
 * instead of assets" AND "...withholds an API path from the router
 * instead"; the X-Robots-Tag line deleted from a copy of the _headers
 * text reds "mutation: a dropped posture header is caught"; sit's own
 * origin regressing out of server/wrangler.toml is tests/wrangler-
 * sit.test.mjs's "mutation: sit's own origin regressing back out of
 * [env.sit.vars] is caught" - not repeated here, because that fact
 * lives entirely in wrangler.toml and belongs with its own parser
 * rather than duplicated against a second one.
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKER_PATH = ROOT + "server/worker.js";
const WRANGLER_PATH = ROOT + "server/wrangler.toml";
const HEADERS_PATH = ROOT + "apps/web/_headers";
const DIST_HEADERS_PATH = ROOT + "dist/_headers";

/* CRLF-normalized on every read below, matching tests/wrangler-sit.
   test.mjs's own defensive stance (AGENTS.md field note, 2026-08-09):
   apps/web/_headers has no extension, so `* text=auto` in
   .gitattributes only guesses at its line endings rather than reading
   a pin before this slice's own addition of one, and a parser that
   splits on "\n" alone leaves a trailing "\r" attached to every line's
   content on a checkout where the guess went the Windows way. */
const readText = async (path) =>
  (await readFile(path, "utf8")).replace(/\r\n/g, "\n");

const workerSrc = await readText(WORKER_PATH);

/* server/worker.js imports its neighbours in server/ - ./store-crypto.js
   (0.9-M1-S6, #332) and ./charts-agg.js (0.9-M2-S0, #351) - and a data:
   module has no base URL to resolve a relative specifier against, so
   Node throws before a single check runs. Each specifier is rewritten to
   the real file's absolute URL, so this still exercises the file's own
   bytes while the imports resolve.
   THE REWRITE IS NOW GENERAL, and that is a deliberate widening rather
   than a broadened regex slipped in. Its predecessor named
   store-crypto.js alone so that a second relative import would fail
   loudly and be handled on purpose; a second one arrived, this is that
   handling, and the general form is what stops the next one being a red
   in four arms at once. It stays anchored to `./<name>.js` in server/,
   so an import reaching outside that directory still fails loudly. */
const serverModule = (name) => pathToFileURL(ROOT + "server/" + name).href;

async function loadWorker(src) {
  return import("data:text/javascript," + encodeURIComponent(src.replace(
    /(\bfrom\s*)"\.\/([\w.-]+\.js)"/g,
    (whole, from, name) => from + '"' + serverModule(name) + '"')));
}

const { isApiPath, API_SEGMENTS, default: worker } = await loadWorker(workerSrc);

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* ------------------------------------------------------------------ */
/* 1. isApiPath()/API_SEGMENTS as the pure function they are.          */

check("every registered API segment is recognized on its own",
  [...API_SEGMENTS].every((s) => isApiPath("/" + s)));

check("a sub-path under an API segment is still API-shaped",
  isApiPath("/submission/abc123") && isApiPath("/content/matrix") &&
  isApiPath("/membership/admin/deadbeef") && isApiPath("/auth/telegram"));

check("a page path is not API-shaped",
  !isApiPath("/") && !isApiPath("/index.html") &&
  !isApiPath("/your-page.html") && !isApiPath("/404.html"));

/* The retired /snapshot route (0.9-M2-S3, #354): deletion, not gating -
   the S1 precedent this slice's security mandate names, "the route no
   longer exists is stronger than fail-closed". "snapshot" left
   API_SEGMENTS in the same change that deleted the three handlers, so
   this is no longer a route that refuses; it is a path this Worker
   does not know at all, indistinguishable from any other page path. */
check("the retired /snapshot route is no longer API-shaped",
  !isApiPath("/snapshot"));

check("a nested asset path is not API-shaped",
  !isApiPath("/fonts/dm-sans-400-latin.woff2") &&
  !isApiPath("/theme.css") && !isApiPath("/favicon.svg"));

check("a look-alike path sharing only a prefix is not API-shaped " +
  "(segment match, not substring match)",
  !isApiPath("/auth-evil") && !isApiPath("/sessionstorage.js"));

check("the empty path segment (bare \"/\") is not API-shaped",
  !isApiPath("/"));

/* ------------------------------------------------------------------ */
/* 2. server/wrangler.toml's [assets] / [env.sit.assets] blocks.       */

function tableBody(text, header) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === header);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\[/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join("\n");
}

function assetsBlock(text, header) {
  const body = tableBody(text, header);
  if (body === null) return null;
  const get = (key) => {
    const m = new RegExp("^" + key + '\\s*=\\s*"([^"]*)"', "m").exec(body);
    return m ? m[1] : null;
  };
  const rwf = /run_worker_first\s*=\s*\[([^\]]*)\]/.exec(body);
  return {
    directory: get("directory"),
    binding: get("binding"),
    not_found_handling: get("not_found_handling"),
    runWorkerFirst: rwf
      ? [...rwf[1].matchAll(/"([^"]*)"/g)].map((m) => m[1])
      : null,
  };
}

function segmentsFromPatterns(patterns) {
  return new Set((patterns || []).map((p) =>
    p.replace(/^\//, "").replace(/\/\*$/, "")));
}

const wranglerSrc = await readText(WRANGLER_PATH);
const topAssets = assetsBlock(wranglerSrc, "[assets]");
const sitAssets = assetsBlock(wranglerSrc, "[env.sit.assets]");

check("server/wrangler.toml names a top-level [assets] block",
  topAssets !== null && topAssets.directory !== null);
check("server/wrangler.toml names an [env.sit.assets] block",
  sitAssets !== null && sitAssets.directory !== null);

check("the top-level [assets] block serves dist/, not apps/web/",
  topAssets?.directory === "../dist");
check("the top-level [assets] block declares the ASSETS binding",
  topAssets?.binding === "ASSETS");
check("the top-level [assets] block renders the site's own 404 page " +
  "on a miss", topAssets?.not_found_handling === "404-page");

check("[assets] and [env.sit.assets] serve the same shape - one " +
  "build, both environments",
  topAssets?.directory === sitAssets?.directory &&
  topAssets?.binding === sitAssets?.binding &&
  topAssets?.not_found_handling === sitAssets?.not_found_handling &&
  JSON.stringify(topAssets?.runWorkerFirst) ===
    JSON.stringify(sitAssets?.runWorkerFirst));

/* ------------------------------------------------------------------ */
/* 3. The sync: wrangler.toml's run_worker_first and worker.js's       */
/* API_SEGMENTS name the same set, or the deny-by-default claim is a   */
/* sentence about what the code intends rather than what serves.       */

const configSegments = segmentsFromPatterns(topAssets?.runWorkerFirst);
check("every run_worker_first pattern resolves to a real segment " +
  "(the array parsed, and stripping / and /* left something)",
  configSegments.size > 0 &&
  [...configSegments].every((s) => s.length > 0));

check("wrangler.toml's run_worker_first names exactly the segments " +
  "worker.js's API_SEGMENTS does - no more, no fewer",
  configSegments.size === API_SEGMENTS.size &&
  [...API_SEGMENTS].every((s) => configSegments.has(s)));

/* WHICH SPELLING A SEGMENT NEEDS IS THE ROUTER'S OWN ANSWER, and the
   sync check above cannot ask it: `/x` and `/x/*` reduce to the same
   segment, so a list carrying only one of the two passes it. The two
   are not interchangeable at the edge - `/x/*` does not cover `/x` and
   `/x` does not cover `/x/y`, which is why /content and /membership
   each carry both - so both halves are read off server/worker.js's own
   dispatch lines: a path literal of one segment wants the bare pattern,
   a path literal of more and every bound route pattern want the `/*`
   one. Derived rather than listed here for the reason the page
   basenames below are: a list written down is what let the /charts
   collision arrive with nobody noticing. */
const bareSegments = new Set();
const subSegments = new Set();
for (const found of workerSrc.matchAll(/path === "\/([^"]*)"/g)) {
  const parts = found[1].split("/").filter((part) => part !== "");
  if (parts.length === 1) bareSegments.add(parts[0]);
  if (parts.length > 1) subSegments.add(parts[0]);
}
for (const found of workerSrc.matchAll(/\^\\\/([a-z-]+)\\\//g)) {
  subSegments.add(found[1]);
}

check("the router's own dispatch lines really were read - a derivation " +
  "that found nothing would make both checks below vacuous",
  bareSegments.size > 5 && subSegments.size > 2 &&
  bareSegments.has("spec") && bareSegments.has("content") &&
  subSegments.has("auth") && subSegments.has("submission"));

check("every segment this router answers at a BARE path carries a bare " +
  "run_worker_first pattern - a `/*` pattern alone would leave a file " +
  "of that name in dist/ answering at the edge before this Worker saw " +
  "the request",
  [...bareSegments].every((seg) =>
    (topAssets?.runWorkerFirst || []).includes("/" + seg)));

check("and every segment it answers under a sub-resource carries a /* " +
  "pattern, not only a bare one - a bare pattern alone would leave " +
  "/content/matrix reachable as an asset even though /content is " +
  "guarded",
  [...subSegments].every((seg) =>
    (topAssets?.runWorkerFirst || []).includes("/" + seg + "/*")));

/* mutation: the BARE pattern dropped for a segment answered bare. The
   sync check above stays green through it, which is the whole reason
   these two exist beside it. */
const patternsMissingBare = (topAssets?.runWorkerFirst || [])
  .filter((p) => p !== "/admin-fields");
check("mutation: a run_worker_first list missing the bare pattern for " +
  "a segment answered at a bare path is caught here and is INVISIBLE " +
  "to the segment sync check",
  ![...bareSegments].every((seg) =>
    patternsMissingBare.includes("/" + seg)) &&
  segmentsFromPatterns(patternsMissingBare).size === API_SEGMENTS.size);

/* mutation: a run_worker_first pattern list missing one segment       */
const patternsMissingSubmit = (topAssets?.runWorkerFirst || [])
  .filter((p) => p !== "/submit");
check("mutation: a run_worker_first list silently missing a segment " +
  "is caught by the sync check",
  segmentsFromPatterns(patternsMissingSubmit).size !== API_SEGMENTS.size ||
  ![...API_SEGMENTS].every((s) =>
    segmentsFromPatterns(patternsMissingSubmit).has(s)));

/* ------------------------------------------------------------------ */
/* 4. Behavior: the real fetch() handler, driven end to end. No D1     */
/* stub - callerFor(request, env) returns null on no Authorization     */
/* header without touching env.DB, so every path exercised here stays  */
/* clear of it entirely, deliberately: this arm is about PRECEDENCE,   */
/* not about anything a session or a database could answer.            */

function assetsStub() {
  const calls = [];
  return {
    calls,
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset bytes", { status: 200 });
      },
    },
  };
}

async function get(worker_, path, headers) {
  const request = new Request("https://example.workers.dev" + path, {
    method: "GET",
    headers: headers || {},
  });
  const env = assetsStub();
  const response = await worker_.fetch(request, env);
  return { response, calls: env.calls };
}

{
  const { response, calls } = await get(worker, "/", {});
  check("a page path with no Origin header still gets served - the " +
    "origin gate never runs for it",
    response.status === 200 && calls.length === 1 && calls[0] === "/");
}

{
  const { response, calls } =
    await get(worker, "/fonts/dm-sans-400-latin.woff2", {});
  check("a nested asset path is delegated to env.ASSETS.fetch",
    response.status === 200 &&
    calls[0] === "/fonts/dm-sans-400-latin.woff2");
}

/*
 * The retired /snapshot route, driven end to end (0.9-M2-S3, #354,
 * security mandate 5). POST/GET/DELETE all delegate to env.ASSETS.fetch
 * now, session or admin or nobody alike - the mandate's "with and
 * without a stored row, session and admin alike" is answered more
 * strongly than a 401-vs-404 pair could: isApiPath("/snapshot") is
 * false, so route()'s very first line returns env.ASSETS.fetch(request)
 * before the origin gate, before callerFor and before env.DB is ever
 * touched. Sending a bearer token here and getting the identical
 * delegation is what proves that - a stub env with no DB binding would
 * throw if callerFor ran, and it does not throw. env.ASSETS.fetch
 * itself always answers 200 in this stub; the real 404 a caller sees in
 * production is Cloudflare's own not_found_handling on a directory with
 * no /snapshot file, which is dist/'s own shape and not this Worker's -
 * DESIGN.md's "the route no longer exists" is exactly that a 404 comes
 * from nothing being there, never from a handler refusing.
 */
for (const method of ["GET", "POST", "DELETE"]) {
  for (const [label, headers] of [
    ["nobody", { Origin: "http://localhost:8124" }],
    ["a bearer token", { Origin: "http://localhost:8124",
      Authorization: "Bearer whatever-token" }],
  ]) {
    const request = new Request("https://example.workers.dev/snapshot", {
      method: method, headers: headers,
    });
    const env = assetsStub();
    const response = await worker.fetch(request, env);
    check(`retired route: ${method} /snapshot as ${label} delegates to ` +
      "env.ASSETS.fetch rather than being answered by the router",
      response.status === 200 && env.calls.length === 1 &&
      env.calls[0] === "/snapshot");
  }
}

/* An allowed Origin, so these reach the route table rather than the
   403 "Origin not allowed" every API-shaped path without one gets
   first - that gate is what proves these paths never became assets,
   not what these two checks are about. */
const ALLOWED = { Origin: "http://localhost:8124" };

{
  const { response, calls } = await get(worker, "/session", ALLOWED);
  const body = await response.json();
  check("an API-shaped but unregistered path (GET /session - only " +
    "DELETE is a route) 404s from the router and never reaches " +
    "env.ASSETS.fetch",
    response.status === 404 && body.error === "Not found." &&
    calls.length === 0);
}

{
  const { calls } = await get(worker, "/auth/whatever", ALLOWED);
  check("an unregistered path under a sub-resource segment (auth) " +
    "also never reaches env.ASSETS.fetch",
    calls.length === 0);
}

/* ------------------------------------------------------------------ */
/* 4a. NO API SEGMENT MAY SHARE A PAGE'S BASENAME (0.9-M2-S8, #365).    */
/*                                                                     */
/* The defect this section exists for. The static-assets layer's        */
/* html_handling drops the extension: a request for /charts.html is     */
/* answered with a 307 to /charts, and the browser follows it. When     */
/* "charts" was ALSO an API segment, run_worker_first sent that second  */
/* request straight into this router, which answered the API's refusal  */
/* instead of the page - the charts page was unreachable at its own     */
/* natural URL, and the owner navigating to it met                      */
/* {"error":"Origin not allowed."}. The route was renamed rather than   */
/* the page, because the page's name is what a person types.            */
/*                                                                     */
/* Derived from the directory rather than from a list written here: a   */
/* pinned list of page names would go stale the moment somebody adds a  */
/* page, which is precisely how this collision arrived unnoticed.       */

const pageBasenames = new Set((await readdir(ROOT + "apps/web"))
  .filter((name) => name.endsWith(".html"))
  .map((name) => name.slice(0, -".html".length)));

check("apps/web/ really was read (a directory that answered nothing " +
  "would make the collision check below pass on an empty set)",
  pageBasenames.size > 0 && pageBasenames.has("charts"));

function shadowed(segments, pages) {
  return [...segments].filter((segment) => pages.has(segment));
}

check("no API segment shares a page's basename - html_handling would " +
  "redirect that page to the API route and the router would answer in " +
  "its place",
  shadowed(API_SEGMENTS, pageBasenames).length === 0);

check("the charts route is no longer named for the charts page",
  !API_SEGMENTS.has("charts") && API_SEGMENTS.has("charts-data"));

/* mutation: the collision put back */
check("mutation: an API segment named after a page is caught",
  shadowed(new Set([...API_SEGMENTS, "charts"]), pageBasenames)
    .length === 1);

/* The redirect chain itself, in the two steps this router can decide.
   Cloudflare's own html_handling issues the 307 (nothing in Node can
   run that layer), but BOTH ends of the chain are this router's
   decision, and both must land on assets or the page is unreachable. */
for (const path of ["/charts.html", "/charts"]) {
  const { response, calls } = await get(worker, path, {});
  check(`the charts page chain step ${path} is delegated to env.ASSETS.` +
    "fetch - it ends at HTML, never at this router's JSON",
    response.status === 200 && calls.length === 1 && calls[0] === path);
}

{
  const { calls } = await get(worker, "/charts-data", ALLOWED);
  check("and the renamed route is still the router's own - /charts-data " +
    "never reaches env.ASSETS.fetch", calls.length === 0);
}

/* ------------------------------------------------------------------ */
/* Mutation evidence: precedence inverted.                             */

const inverted = workerSrc.replace(
  "if (!isApiPath(path)) return env.ASSETS.fetch(request);",
  "if (isApiPath(path)) return env.ASSETS.fetch(request);");
check("the inversion fixture actually changed the source (the replace " +
  "found its target)", inverted !== workerSrc);

const { default: invertedWorker } = await loadWorker(inverted);

{
  const { calls } = await get(invertedWorker, "/", {});
  check("mutation: inverted precedence withholds a page from " +
    "env.ASSETS.fetch instead of serving it", calls.length === 0);
}

{
  const { calls } = await get(invertedWorker, "/fonts/x.woff2", {});
  check("mutation: inverted precedence sends a nested asset path " +
    "into the router instead of assets", calls.length === 0);
}

/* ------------------------------------------------------------------ */
/* 5. The posture headers: _headers is read by the static-assets layer #
/* itself, so this is text parsed and asserted, not a header a real    */
/* HTTP round trip could be checked over here.                         */

function headerBlock(text, pattern) {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => l.trim() === pattern);
  if (idx === -1) return null;
  const values = {};
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s+\S/.test(line)) break;
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.+)$/.exec(line);
    if (m) values[m[1]] = m[2].trim();
  }
  return values;
}

const headersSrc = await readText(HEADERS_PATH);
const block = headerBlock(headersSrc, "/*");

check("apps/web/_headers carries a /* block", block !== null);
check("apps/web/_headers sets X-Robots-Tag to noindex, nofollow",
  block?.["X-Robots-Tag"] === "noindex, nofollow");
check("apps/web/_headers sets Referrer-Policy to no-referrer",
  block?.["Referrer-Policy"] === "no-referrer");

const distHeadersSrc = await readText(DIST_HEADERS_PATH);
check("dist/_headers is what apps/web/_headers builds to (byte for " +
  "byte - _headers has no recognized extension, so tools/build_web." +
  "mjs copies it rather than transforming it)",
  distHeadersSrc === headersSrc);

/* mutation: the posture header dropped */
const droppedRobots = headersSrc.replace(
  /^\s*X-Robots-Tag:.*$/m, "");
check("mutation: a dropped X-Robots-Tag line is caught",
  headerBlock(droppedRobots, "/*")?.["X-Robots-Tag"] === undefined);

const droppedReferrer = headersSrc.replace(
  /^\s*Referrer-Policy:.*$/m, "");
check("mutation: a dropped Referrer-Policy line is caught",
  headerBlock(droppedReferrer, "/*")?.["Referrer-Policy"] === undefined);

/* ------------------------------------------------------------------ */

const EXPECTED = 46;
console.log(failures
  ? `\nroute-precedence FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nroute-precedence ran ${performed} checks, expected ${EXPECTED}`
    : `\nroute-precedence OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
