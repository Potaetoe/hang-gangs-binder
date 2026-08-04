/*
 * The storage endpoint. One Cloudflare Worker, one D1 database.
 *
 * Two routes and nothing else:
 *
 *   POST /submit   append one row of ciphertext. Public.
 *   GET  /export   return every row. Requires the export token.
 *
 * It never decrypts, holds no key, and cannot read what it stores. Both
 * routes move opaque base64 - see DESIGN.md, which explains why the
 * storage layer is untrusted on purpose.
 *
 * Bindings expected (see server/README.md):
 *   DB            D1 database binding
 *   EXPORT_TOKEN  secret, compared against the Authorization header
 */

// The only origins allowed to call this. A submission from anywhere
// else is either a mistake or somebody else's copy of the form, and in
// both cases the row is noise in the export.
const ALLOWED_ORIGINS = [
  "https://potaetoe.github.io",
  "http://localhost:8124",
];

// A submission is a base64 blob of a short record. 16 KB is far more
// than that and far less than anything worth storing by accident.
const MAX_CIPHERTEXT = 16 * 1024;

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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
  const auth = request.headers.get("Authorization") || "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!env.EXPORT_TOKEN || !tokenMatches(given, env.EXPORT_TOKEN)) {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : null;

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

    return json({ error: "Not found." }, 404, allowed);
  },
};
