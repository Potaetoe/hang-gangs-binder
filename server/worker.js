/*
 * The storage endpoint. One Cloudflare Worker, one D1 database.
 *
 * Four routes and nothing else:
 *
 *   POST   /submit    append one row of ciphertext. Public.
 *   GET    /export    return every row. Requires the export token.
 *   POST   /snapshot  replace the published aggregate. Requires the token.
 *   GET    /snapshot  return it. Public - this is the one route that
 *                     answers anybody, because what it returns has no
 *                     handles and no rows in it.
 *   DELETE /snapshot  take it down. Requires the token, and nothing
 *                     else - see the handler for why that matters.
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
 *   DB               D1 database binding
 *   EXPORT_TOKEN     secret, compared against the Authorization header
 *   ALLOWED_ORIGINS  optional, comma-separated; overrides the default
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
  if (typeof given !== "string" || given.length !== expected.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

async function handleSubmit(request, env, origin) {
  // Anti-abuse goes here, as one early return, so adding a Turnstile
  // check later is an insert rather than a rewrite. See DESIGN.md,
  // "What is deliberately not here".

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

  await env.DB.prepare(
    "INSERT INTO submissions (ciphertext, received_at) VALUES (?, ?)"
  )
    .bind(ciphertext, new Date().toISOString())
    .run();

  return json({ ok: true }, 200, origin);
}

async function handleExport(request, env, origin) {
  if (!authorised(request, env)) {
    // Answered with CORS headers on purpose. The origin was already
    // checked before this ran, so the only person who sees this is the
    // admin on the admin page - and "Not authorised" is a far better
    // thing for them to read than the opaque CORS failure a bare
    // rejection would produce when they mistype the token.
    return json({ error: "Not authorised." }, 401, origin);
  }

  const rows = await env.DB.prepare(
    "SELECT id, ciphertext, received_at FROM submissions ORDER BY id"
  ).all();

  return json({ ok: true, submissions: rows.results }, 200, origin);
}

function authorised(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return Boolean(env.EXPORT_TOKEN) && tokenMatches(given, env.EXPORT_TOKEN);
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
  if (!authorised(request, env)) {
    return json({ error: "Not authorised." }, 401, origin);
  }

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
async function handleDeleteSnapshot(request, env, origin) {
  if (!authorised(request, env)) {
    return json({ error: "Not authorised." }, 401, origin);
  }

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

    if (request.method === "POST" && url.pathname === "/submit") {
      return handleSubmit(request, env, allowed);
    }
    if (request.method === "GET" && url.pathname === "/export") {
      return handleExport(request, env, allowed);
    }
    if (request.method === "POST" && url.pathname === "/snapshot") {
      return handlePublishSnapshot(request, env, allowed);
    }
    if (request.method === "GET" && url.pathname === "/snapshot") {
      return handleReadSnapshot(env, allowed);
    }
    if (request.method === "DELETE" && url.pathname === "/snapshot") {
      return handleDeleteSnapshot(request, env, allowed);
    }

    return json({ error: "Not found." }, 404, allowed);
  },
};
