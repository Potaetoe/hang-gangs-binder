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
 * It reads just enough of the SQL to tell the two tables apart, because
 * the snapshot table behaves differently in the way that matters: it
 * replaces rather than appends, and it is read with first() rather than
 * all(). A stub that ignored the statement entirely would let a
 * publish that appended a second row pass.
 */
const stored = [];
let snapshot = null;

const env = {
  EXPORT_TOKEN: "sekrit-token-value",
  DB: {
    prepare: (sql) => {
      const isSnapshot = /snapshots/i.test(sql);
      const isDelete = /^\s*DELETE/i.test(sql);
      return {
        bind: (...a) => ({
          run: async () => {
            if (isSnapshot) snapshot = { body: a[0], updated_at: a[1] };
            else stored.push(a);
            return {};
          },
        }),
        // The delete takes no parameters, so it runs straight off
        // prepare() without a bind() in between.
        run: async () => {
          if (isSnapshot && isDelete) snapshot = null;
          return {};
        },
        first: async () => (isSnapshot ? snapshot : null),
        all: async () => ({
          results: stored.map((r, i) => ({
            id: i + 1,
            ciphertext: r[0],
            received_at: r[1],
          })),
        }),
      };
    },
  },
};

const SITE = "https://potaetoe.github.io";
const good = { Origin: SITE, "Content-Type": "application/json" };
const evil = { Origin: "https://evil.example", "Content-Type": "application/json" };
const call = (method, path, opts = {}) =>
  worker.fetch(new Request("https://w.dev" + path, { method, ...opts }), env);

/* [label, request, expected status, expected Access-Control-Allow-Origin] */
const cases = [
  ["OPTIONS preflight, allowed origin", () => call("OPTIONS", "/submit", { headers: good }), 204, SITE],
  ["OPTIONS preflight, foreign origin", () => call("OPTIONS", "/submit", { headers: evil }), 403, null],
  ["POST valid base64", () => call("POST", "/submit", { headers: good, body: JSON.stringify({ ciphertext: "QUJDRA==" }) }), 200, SITE],
  ["POST not base64", () => call("POST", "/submit", { headers: good, body: JSON.stringify({ ciphertext: "not base64!!" }) }), 400, SITE],
  ["POST missing field", () => call("POST", "/submit", { headers: good, body: JSON.stringify({}) }), 400, SITE],
  ["POST malformed JSON", () => call("POST", "/submit", { headers: good, body: "{{{" }), 400, SITE],
  ["POST oversize", () => call("POST", "/submit", { headers: good, body: JSON.stringify({ ciphertext: "A".repeat(17000) }) }), 413, SITE],
  ["POST from foreign origin", () => call("POST", "/submit", { headers: evil, body: JSON.stringify({ ciphertext: "QUJDRA==" }) }), 403, null],
  ["GET export, no token", () => call("GET", "/export", { headers: good }), 401, SITE],
  ["GET export, wrong token", () => call("GET", "/export", { headers: { ...good, Authorization: "Bearer nope" } }), 401, SITE],
  ["GET export, right token", () => call("GET", "/export", { headers: { ...good, Authorization: "Bearer sekrit-token-value" } }), 200, SITE],
  ["unknown route", () => call("GET", "/whatever", { headers: good }), 404, SITE],

  /*
   * The snapshot routes. Writing is a keyholder action and gated the
   * same way the export is; reading is gated by nothing at all, which
   * is the entire point of the public dashboard - see DESIGN.md, "The
   * public dashboard". The 404-before-publish case matters because the
   * page has to tell "nobody has published yet" apart from "the
   * endpoint is broken", and they are different messages.
   */
  ["GET snapshot before any publish", () => call("GET", "/snapshot", { headers: good }), 404, SITE],
  ["POST snapshot, no token", () => call("POST", "/snapshot", { headers: good, body: "{}" }), 401, SITE],
  ["POST snapshot, wrong token", () => call("POST", "/snapshot", { headers: { ...good, Authorization: "Bearer nope" }, body: "{}" }), 401, SITE],
  ["POST snapshot, not JSON", () => call("POST", "/snapshot", { headers: { ...good, Authorization: "Bearer sekrit-token-value" }, body: "{{{" }), 400, SITE],
  ["POST snapshot, empty", () => call("POST", "/snapshot", { headers: { ...good, Authorization: "Bearer sekrit-token-value" }, body: "" }), 400, SITE],
  ["POST snapshot, oversize", () => call("POST", "/snapshot", { headers: { ...good, Authorization: "Bearer sekrit-token-value" }, body: JSON.stringify({ pad: "A".repeat(300000) }) }), 413, SITE],
  ["POST snapshot, right token", () => call("POST", "/snapshot", { headers: { ...good, Authorization: "Bearer sekrit-token-value" }, body: JSON.stringify({ snapshot: 1, counts: { entries: 2 } }) }), 200, SITE],
  ["GET snapshot after publishing", () => call("GET", "/snapshot", { headers: good }), 200, SITE],
  ["GET snapshot from a foreign origin", () => call("GET", "/snapshot", { headers: evil }), 403, null],

  /*
   * Taking it down. The token and nothing else - requiring the private
   * key here would mean decrypting the corpus in order to remove
   * something, which is both backwards and slowest at exactly the
   * moment speed matters.
   */
  ["DELETE snapshot, no token", () => call("DELETE", "/snapshot", { headers: good }), 401, SITE],
  ["DELETE snapshot, wrong token", () => call("DELETE", "/snapshot", { headers: { ...good, Authorization: "Bearer nope" } }), 401, SITE],
  ["DELETE snapshot from a foreign origin", () => call("DELETE", "/snapshot", { headers: { ...evil, Authorization: "Bearer sekrit-token-value" } }), 403, null],
];

let failures = 0;
for (const [label, fn, wantStatus, wantCors] of cases) {
  const res = await fn();
  const cors = res.headers.get("Access-Control-Allow-Origin");
  const body = (await res.text()).slice(0, 58);
  const ok = res.status === wantStatus && cors === wantCors;
  if (!ok) failures++;
  console.log(
    `${ok ? "pass" : "FAIL"}  ${label.padEnd(36)} ${String(res.status).padEnd(4)} ` +
    `cors=${String(cors).padEnd(30)} ${body}`
  );
}

/*
 * ALLOWED_ORIGINS overrides the built-in list, so a new owner can point
 * the endpoint at their own site from the dashboard without editing and
 * re-pasting the Worker. Both directions matter: the override must let
 * their origin in AND shut the old one out, or a handoff quietly leaves
 * the previous owner's site still writing to the new owner's database.
 */
const NEW_OWNER = "https://someone-else.example";
const inherited = {
  ...env,
  ALLOWED_ORIGINS: ` ${NEW_OWNER} , http://localhost:8124 `,
};
const asInherited = (headers) =>
  worker.fetch(
    new Request("https://w.dev/submit", {
      method: "POST",
      headers,
      body: JSON.stringify({ ciphertext: "QUJDRA==" }),
    }),
    inherited
  );

const overrideCases = [
  ["override admits the new origin", { Origin: NEW_OWNER, "Content-Type": "application/json" }, 200],
  ["override shuts out the old origin", good, 403],
];
for (const [label, headers, wantStatus] of overrideCases) {
  const res = await asInherited(headers);
  const ok = res.status === wantStatus;
  if (!ok) failures++;
  console.log(
    `${ok ? "pass" : "FAIL"}  ${label.padEnd(36)} ${String(res.status).padEnd(4)} ` +
    `cors=${String(res.headers.get("Access-Control-Allow-Origin")).padEnd(30)}`
  );
}

/* The rejections must have rejected: only the good rows got through. */
const wroteTwice =
  stored.length === 2 && stored.every((r) => r[0] === "QUJDRA==");
if (!wroteTwice) failures++;
console.log(
  `${wroteTwice ? "pass" : "FAIL"}  only the 2 valid posts reached the database ` +
  `-> ${stored.length} row(s)`
);

/*
 * A snapshot is stored as the bytes that arrived, not parsed and
 * written back out. This endpoint has no opinion about what a snapshot
 * contains - the page that built it does - and re-encoding here would
 * be a second place the format could change without anyone deciding to.
 */
const publishedBody = JSON.stringify({ snapshot: 1, counts: { entries: 2 } });
const keptVerbatim = snapshot !== null && snapshot.body === publishedBody;
if (!keptVerbatim) failures++;
console.log(
  `${keptVerbatim ? "pass" : "FAIL"}  the snapshot is stored exactly as sent`
);

/*
 * And it comes back inside an envelope rather than merged into one: the
 * snapshot says when it was computed, the envelope says when it
 * arrived, and a scheduled publisher that has silently stopped is
 * exactly the case where those two disagree.
 */
const readBack = await (await call("GET", "/snapshot", { headers: good })).json();
const envelopeOk = readBack.ok === true &&
  typeof readBack.published_at === "string" &&
  readBack.snapshot.counts.entries === 2;
if (!envelopeOk) failures++;
console.log(
  `${envelopeOk ? "pass" : "FAIL"}  the published snapshot reads back intact`
);

/* Publishing replaces. A history of snapshots would be more published
 * data about the same people, kept for nobody. */
await call("POST", "/snapshot", {
  headers: { ...good, Authorization: "Bearer sekrit-token-value" },
  body: JSON.stringify({ snapshot: 1, counts: { entries: 9 } }),
});
const replaced = JSON.parse(snapshot.body).counts.entries === 9;
if (!replaced) failures++;
console.log(
  `${replaced ? "pass" : "FAIL"}  publishing replaces rather than appends`
);

/*
 * The retraction path, end to end. The rejected DELETEs above must not
 * have removed anything - a route that deletes on an unauthorised
 * request would have passed every status check in the table, because
 * the status it returns is right either way.
 */
const survivedRejections = snapshot !== null;
if (!survivedRejections) failures++;
console.log(
  `${survivedRejections ? "pass" : "FAIL"}  a rejected DELETE removes nothing`
);

const deleted = await call("DELETE", "/snapshot", {
  headers: { ...good, Authorization: "Bearer sekrit-token-value" },
});
const wentAway = deleted.status === 200 && snapshot === null;
if (!wentAway) failures++;
console.log(
  `${wentAway ? "pass" : "FAIL"}  an authorised DELETE takes the snapshot down`
);

/* The public page must go back to its empty state, not to a stale one. */
const afterDelete = await call("GET", "/snapshot", { headers: good });
const backToEmpty = afterDelete.status === 404;
if (!backToEmpty) failures++;
console.log(
  `${backToEmpty ? "pass" : "FAIL"}  reading after a delete is 404 again`
);

/*
 * Deleting nothing is a success. Someone pressing Unpublish twice has
 * got what they wanted, and an error would read as "it did not work"
 * and invite a retry against a system that already did the thing.
 */
const again = await call("DELETE", "/snapshot", {
  headers: { ...good, Authorization: "Bearer sekrit-token-value" },
});
const idempotent = again.status === 200;
if (!idempotent) failures++;
console.log(
  `${idempotent ? "pass" : "FAIL"}  unpublishing twice is not an error`
);

/* The submissions are untouched by any of it. A snapshot is derived
 * from them; retracting one must not cost the thing it came from. */
const rowsIntact = stored.length === 2;
if (!rowsIntact) failures++;
console.log(
  `${rowsIntact ? "pass" : "FAIL"}  unpublishing leaves the submissions alone ` +
  `-> ${stored.length} row(s)`
);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
