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

/* A D1 binding that remembers what it was asked to store. */
const stored = [];
const env = {
  EXPORT_TOKEN: "sekrit-token-value",
  DB: {
    prepare: () => ({
      bind: (...a) => ({ run: async () => { stored.push(a); return {}; } }),
      all: async () => ({
        results: stored.map((r, i) => ({
          id: i + 1,
          ciphertext: r[0],
          received_at: r[1],
        })),
      }),
    }),
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

/* The rejections must have rejected: only the one good row got through. */
const wroteOnce = stored.length === 1 && stored[0][0] === "QUJDRA==";
if (!wroteOnce) failures++;
console.log(
  `${wroteOnce ? "pass" : "FAIL"}  exactly one row stored, and it is the valid ` +
  `one -> ${JSON.stringify(stored)}`
);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
