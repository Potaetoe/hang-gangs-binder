/*
 * The demo driver: serves this repository, and a mirror of apps/web with
 * the demo's two edits applied on the way out.
 *
 *     ./run demo            (or: node dev/demo-server.mjs)
 *     node dev/demo-server.mjs --port 8160
 *
 * Then http://127.0.0.1:8126/dev/demo.html - 127.0.0.1 rather than
 * localhost, for #72's reason.
 *
 * Why a server at all, when `./run serve-root` already serves this tree:
 * the shipped pages have to load from a real path, because
 * apps/web/nav.js marks the current destination by the last segment of
 * location.pathname and apps/web/session.js decides whether to redirect
 * the same way. Rewriting a page into an iframe would break both, and
 * the rail is one of the things the demo exists to show. Mirroring at
 * /demo/ keeps the last segment identical, so every page behaves exactly
 * as it does at /apps/web/.
 *
 * The mirror reads apps/web off disk on every request. Nothing is cached
 * and nothing is copied into dev/, so a page PR 4 or PR 5 changes is a
 * page this demo shows changed with no work here - which is the whole
 * reason the demo is a wrapper rather than a snapshot.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, normalize, resolve, extname, sep } from "node:path";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));

// resolve() rather than the URL's own path, because a directory URL
// converts with a trailing separator and every containment test below
// compares against ROOT + sep. With the separator already there the
// comparison is against a doubled one, and nothing is ever inside the
// repository.
const ROOT = resolve(HERE(".."));

const load = async (path) => {
  const src = await readFile(HERE(path), "utf8");
  await import("data:text/javascript," + encodeURIComponent(src));
};

await load("./demo-stub.js");
const Demo = globalThis.BinderDemo;

// The committed default. 8126 is next in this repository's 8124/8125
// convention, and it is deliberately outside the 8130-8185 range the
// agent fleet assigns itself preview blocks from: a permanent verb whose
// port a future agent's preview can take is a verb that breaks on a day
// nobody changed it. --port is for those previews.
const DEFAULT_PORT = 8126;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

const MIRROR_PREFIX = "/demo/";

function portFrom(argv) {
  const at = argv.indexOf("--port");
  if (at === -1) return DEFAULT_PORT;
  const value = Number(argv[at + 1]);
  return Number.isInteger(value) && value > 0 && value < 65536
    ? value : DEFAULT_PORT;
}

/*
 * A request path turned into a file inside this repository, or null.
 *
 * The normalize-then-check shape is the point rather than a formality:
 * this server exists to be pointed at a checkout that holds throwaway
 * keys, and "..%2f" walking out of the tree is the one way a local
 * static server becomes interesting to anybody.
 */
function fileFor(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch (error) {
    return null;
  }

  const relative = normalize(decoded).replace(/^[\\/]+/, "");
  if (relative.split(sep).indexOf("..") !== -1) return null;

  const full = join(ROOT, relative);
  return full.indexOf(ROOT + sep) === 0 || full === ROOT ? full : null;
}

function typeFor(path) {
  return TYPES[extname(path).toLowerCase()] || "application/octet-stream";
}

async function serve(request, response) {
  const urlPath = (request.url || "/").split("?")[0];

  /*
   * The mirror. A request under /demo/ is answered from apps/web, and an
   * HTML answer goes through demo-stub.js's mirror() on the way out -
   * the one place any byte of the shipped site is changed, and the edits
   * it makes are listed in that file and rendered by the console.
   */
  const mirrored = urlPath.indexOf(MIRROR_PREFIX) === 0;
  const target = mirrored
    ? fileFor("/apps/web/" + urlPath.slice(MIRROR_PREFIX.length))
    : fileFor(urlPath);

  if (target === null) {
    response.writeHead(400, { "Content-Type": "text/plain" });
    response.end("Refused.\n");
    return;
  }

  let bytes;
  try {
    bytes = await readFile(target);
  } catch (error) {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found: " + urlPath + "\n");
    return;
  }

  let body = bytes;
  if (mirrored && extname(target).toLowerCase() === ".html") {
    body = Buffer.from(Demo.mirror(bytes.toString("utf8")).html, "utf8");
  }

  response.writeHead(200, {
    "Content-Type": typeFor(target),
    // Nothing is cached, for the same reason ./run serve turns caching
    // off: a demo showing a page from before the last slice landed is a
    // demo that lies about what has shipped.
    "Cache-Control": "no-store",
  });
  response.end(body);
}

export function start(options) {
  const opts = options || {};
  const server = createServer((request, response) => {
    serve(request, response).catch((error) => {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(String((error && error.message) || error) + "\n");
    });
  });

  return new Promise((resolve) => {
    server.listen(opts.port === undefined ? DEFAULT_PORT : opts.port,
      "127.0.0.1", () => resolve(server));
  });
}

export { DEFAULT_PORT, MIRROR_PREFIX };

// Started directly rather than imported by dev/demo.test.mjs, which
// starts one on an ephemeral port and drives it.
if (process.argv[1] && process.argv[1].endsWith("demo-server.mjs")) {
  const port = portFrom(process.argv);
  await start({ port });
  console.log("Demo console: http://127.0.0.1:" + port + "/dev/demo.html");
  console.log("(127.0.0.1, not localhost - #72)");
}
