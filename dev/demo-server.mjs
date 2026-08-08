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

/*
 * The port to bind, or a refusal naming the argument.
 *
 * WHY THIS THROWS INSTEAD OF FALLING BACK. A fallback to DEFAULT_PORT
 * turns every bad argument into 8126 in silence - the port the owner's
 * own demo answers on - so `--port 8199x` and a `--port` with nothing
 * after it take a port somebody else was told to expect, while the
 * operator sees the server start normally. Worse, Number() reads
 * hexadecimal: `0x1FE0` is 8160, inside the 8130-8185 range agent
 * sessions assign themselves preview blocks from, so a typo can bind
 * another session's port while looking like it honored the request.
 *
 * The parse is a digits-only test rather than Number(), for that last
 * reason: `0x1FE0`, `8e3` and ` 8160 ` are all numbers to Number() and
 * none of them is a port anybody typed on purpose.
 *
 * Both launchers hand --port straight through and exec this file, so a
 * throw here is a non-zero exit with the reason on stderr, which is the
 * loud failure the operator needs. Nothing in run or run.cmd needed to
 * change for that.
 */
function portFrom(argv) {
  const at = argv.indexOf("--port");
  if (at === -1) return DEFAULT_PORT;

  const raw = argv[at + 1];
  if (raw === undefined) {
    throw new Error("--port was given with no value after it.");
  }
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error("--port wants a plain decimal port number, and got \"" +
      raw + "\". Hexadecimal and exponent forms are refused on purpose: " +
      "0x1FE0 is 8160, which is inside the range agent previews use.");
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("--port " + raw + " is outside 1-65535.");
  }
  return value;
}

// Where the mirror is allowed to read, and nowhere else. /demo/ says
// "this is apps/web", so apps/web is the boundary it is held to -
// containment at the repository root was never the promise that prefix
// makes.
//
// THIS IS DEFENSE IN DEPTH AND NO SUITE PINS IT INDEPENDENTLY. Measured,
// not assumed: with the ".." guard below running in the right order,
// there is no request that distinguishes a mirror rooted here from one
// rooted at the repository - every path is stripped of leading
// separators and joined, so it can only ever go downward, and the guard
// refuses the one construct that goes up. Reverting this line alone
// leaves dev/demo.test.mjs green; reverting the guard's position, or
// both, turns three checks red. The guard is the load-bearing half.
// Keeping this one anyway, because it is the line that stays correct if
// a future decode path reaches fileFor by some route the guard has not
// been taught about - but a reader should not mistake it for something
// the gate is watching.
const WEB_ROOT = resolve(join(ROOT, "apps", "web"));

/*
 * A request path turned into a file inside `within`, or null.
 *
 * THE ".." CHECK RUNS BEFORE normalize(), AND THAT ORDER IS THE WHOLE
 * GUARD. Run after it, as it was, the check is dead code: normalize
 * clamps at the root, so "/../../etc/hosts" is already "/etc/hosts" by
 * the time anything looks for a "..", and the request was refused by
 * the file not existing rather than by this function. Refusals that
 * depend on the attacker asking for something absent are not refusals.
 * dev/demo.test.mjs pins the status at 400 for exactly that reason -
 * accepting 400-or-404 is what let this sit here looking armed.
 *
 * It matters because this server exists to be pointed at a checkout
 * that holds throwaway keys: "..%2f" walking out of the tree is the one
 * way a local static server becomes interesting to anybody, and through
 * the mirror it reached AGENTS.md, dev/test-key.json, and dev/demo.html
 * served back with the demo's own boot scripts injected into it.
 */
function fileFor(urlPath, within) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch (error) {
    return null;
  }

  if (decoded.split(/[\\/]+/).indexOf("..") !== -1) return null;

  const base = within;
  const relative = normalize(decoded).replace(/^[\\/]+/, "");
  const full = join(base, relative);
  return full.indexOf(base + sep) === 0 || full === base ? full : null;
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
   *
   * The tail is resolved against apps/web itself rather than pasted onto
   * "/apps/web/" and resolved against the repository: pasting made every
   * file in the checkout reachable through a prefix that claims to serve
   * one directory, and injected the boot scripts into anything under it
   * ending in .html - including this demo's own console.
   */
  const mirrored = urlPath.indexOf(MIRROR_PREFIX) === 0;
  const target = mirrored
    ? fileFor("/" + urlPath.slice(MIRROR_PREFIX.length), WEB_ROOT)
    : fileFor(urlPath, ROOT);

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

// portFrom is exported so dev/demo.test.mjs can drive the argument
// matrix without binding anything. It had no coverage at all while it
// was silently answering every bad argument with the owner's own port.
export { DEFAULT_PORT, MIRROR_PREFIX, WEB_ROOT, portFrom };

// Started directly rather than imported by dev/demo.test.mjs, which
// starts one on an ephemeral port and drives it.
if (process.argv[1] && process.argv[1].endsWith("demo-server.mjs")) {
  let port;
  try {
    port = portFrom(process.argv);
  } catch (error) {
    // Exit rather than fall back. A demo that binds a port nobody asked
    // for is how two servers end up serving two different trees on one
    // number, and the operator reads the first one they find.
    console.error("Refused: " + error.message);
    process.exit(2);
  }
  await start({ port });
  console.log("Demo console: http://127.0.0.1:" + port + "/dev/demo.html");
  console.log("(127.0.0.1, not localhost - #72)");
}
