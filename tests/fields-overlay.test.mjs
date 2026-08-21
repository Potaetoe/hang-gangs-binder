/*
 * The effective field spec: the static spec overlaid by admin edits
 * (0.9-M3-S11, #419; the ruled design #385, rules 6, 7 and 8).
 *
 *     node tests/fields-overlay.test.mjs
 *
 * SIX THINGS ARE ON TRIAL HERE, and each one is a way a form an admin
 * can edit turns into a form that eats what members already saved:
 *
 *   1. THE NO-EDIT IDENTITY. With nothing in the overlay, GET /spec
 *      answers the shipped spec byte for byte. The static file is the
 *      fallback and the fork's starting point, so the composed answer
 *      has to be indistinguishable from it until an admin acts.
 *   2. THE MUTATIONS, BOTH DIRECTIONS. Adding a value, retiring one,
 *      reordering them, retiring a whole field and bringing it back -
 *      each is checked for what it does AND for the state before it,
 *      because an arm that only reads the after picture passes against
 *      a stub that never changed.
 *   3. KEEP THE DATA, ADAPT THE DISPLAY (#385 rule 7). A retire moves
 *      no sealed byte. The proof is a raw ciphertext read on both sides
 *      of the retire, compared as strings - the arm the batch security
 *      consult reads first.
 *   4. A RENAME ASKS WHAT IT MEANS (#385 rule 8). `relabel` keeps the
 *      value's stable id, so existing entries follow the new word;
 *      `replace` retires the old id and mints a new one, so existing
 *      entries keep the retired value and stop being counted under it.
 *   5. NUMERIC FIELDS ARE NOT EDITABLE HERE (#385 rule 6). Weight,
 *      height and BMI carry units and fixed chart bands that are code,
 *      and the consent box is one bit; each is refused by name at the
 *      write route, AND a row written around that route - the only way
 *      one can exist - is ignored by the composer rather than honored.
 *      Both halves, because either alone is a formality.
 *   6. THE SPEC IS NOT SITE COPY. The overlay lives in `site_content`
 *      beside the settings, and GET /content answers with no credential
 *      at all - so the field rows are refused that route in the two
 *      places S8's GET /config allow-list is: in the statement, and
 *      again in the reader that would otherwise serve what it found.
 *
 * WHY THE WHOLE WORKER RATHER THAN ITS PARTS, and why a data: URL: the
 * reasons tests/admin-identity.test.mjs states. The router decides
 * whether a refusal is 401 or 400; server/worker.js has no package.json
 * making a bare import resolve as ESM, and rewriting its relative
 * specifiers is what lets the file run from its own bytes.
 *
 * THE D1 STUB REFUSES WHAT IT DOES NOT RECOGNIZE. Every statement these
 * paths issue is matched by shape and answered; anything else throws by
 * name. A stub that quietly answered "no rows" to a statement it had
 * never seen would turn a route that stopped working into an arm that
 * stays green.
 *
 * AND IT READS THE `LIKE` PATTERN OFF THE STATEMENT AS WELL AS OFF THE
 * BOUND ARGUMENT, for the reason tests/admin-identity.test.mjs parses
 * the `IN` literals: D1 honors a pattern written into the statement, and
 * a stub filtering on `args` alone would answer the same rows for a
 * statement somebody widened - which is the state the second wall in
 * effectiveSpec() exists to catch and the state an arm has to be able
 * to reach.
 *
 * AND IT ORDERS BY CODE UNIT, because D1's TEXT collation is BINARY.
 * `ORDER BY name` decides which of two rows composing onto one id the
 * composer keeps, and localeCompare orders a case-differing pair the
 * other way round from SQLite - so a stub ordering by locale would let
 * an arm about a collision agree with a production that did the
 * opposite.
 *
 * THE ARMS READ REAL SHIPPED STATE. Nothing below asserts an absence
 * against a stub default: every "this is gone", "this is hidden" and
 * "this is not served" check forces the opposite state first - a value
 * that really is offered, a field row that really is in the table, a
 * record that really carries the answer - and then asserts.
 *
 * CANARIES, NOT PLACEHOLDERS. The secrets and ids below are distinctive
 * strings that appear nowhere else. None is key-shaped and none is real.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, createHmac } from "node:crypto";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKER_PATH = ROOT + "server/worker.js";

const readText = async (path) =>
  (await readFile(path, "utf8")).replace(/\r\n/g, "\n");

const workerSrc = await readText(WORKER_PATH);

const serverModule = (name) => pathToFileURL(ROOT + "server/" + name).href;

async function loadWorker(src) {
  const resolved = src.replace(/(\bfrom\s*)"\.\/([\w.-]+\.js)"/g,
    (whole, from, name) => from + '"' + serverModule(name) + '"');
  return import("data:text/javascript," + encodeURIComponent(resolved));
}

const { default: worker } = await loadWorker(workerSrc);

/* The spec, loaded the way server/charts-agg.js loads it: a side-effect
   import that assigns globalThis.BINDER_SITE. The no-edit identity below
   compares against this object rather than against a copy written out
   here, because a second spelling of the spec is a thing that can be
   wrong. */
await import(pathToFileURL(ROOT + "apps/web/site.config.js").href);
const SITE = globalThis.BINDER_SITE;

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* ------------------------------------------------------------------ */
/* Canaries.                                                           */

const BOT_TOKEN = "canary-s11-bot-token-belonging-to-nobody";
const CHAT_ID = "canary-s11-chat-id-belonging-to-nobody";
const ACCOUNT_SECRET = "canary-s11-account-secret-belonging-to-nobody";
const STORE_SECRET = "canary-s11-store-secret-belonging-to-nobody-v1";
const ORIGIN = "http://localhost:8170";

const ADMIN_ID = "711010101";
const MEMBER_ID = "712020202";

/* An account id as this Worker mints one, computed here rather than
   read back off a response: an arm comparing the Worker's answer with
   the Worker's own arithmetic would agree with any mistake in it. */
const accountFor = (numericId) =>
  createHmac("sha256", ACCOUNT_SECRET).update(String(numericId)).digest("hex");

/* Telegram's scheme, written out rather than imported from the Worker:
   an arm that signed with the code it is checking would agree with any
   mistake in it. */
function sign(fields, botToken) {
  const dataCheck = Object.keys(fields)
    .filter((key) => key !== "hash")
    .sort()
    .map((key) => key + "=" + fields[key])
    .join("\n");
  const secret = createHash("sha256").update(botToken, "utf8").digest();
  return Object.assign({}, fields, {
    hash: createHmac("sha256", secret).update(dataCheck, "utf8").digest("hex"),
  });
}

function payloadFor(numericId) {
  return sign({
    id: String(numericId),
    first_name: "Canary",
    username: "canary_s11_" + numericId,
    auth_date: String(Math.floor(Date.now() / 1000)),
  }, BOT_TOKEN);
}

/* ------------------------------------------------------------------ */
/* The D1 stub.                                                        */

function makeDb() {
  const sessions = new Map();
  const replay = new Map();
  const directory = new Map();
  const content = new Map();
  const adminLog = [];
  const submissions = [];
  let logSequence = 0;

  /* SQLite's LIKE, as far as these statements use it: a trailing `%`
     and no other wildcard, folded because LIKE is case-insensitive for
     ASCII. Written out rather than approximated with startsWith on the
     bound argument, so that a statement widened around the parameter is
     visible here. */
  const likeMatch = (name, pattern) => {
    const body = String(pattern).replace(/%$/, "");
    return String(name).toLowerCase().startsWith(body.toLowerCase());
  };

  /* The pattern this read really applies, taken from the statement when
     the statement writes one and from the bound argument otherwise. */
  const patternOf = (sql, args) => {
    const written = /LIKE\s+'([^']*)'/.exec(sql);
    return written ? written[1] : args[0];
  };

  /* `ORDER BY name`, the way D1 orders it: BINARY, by code unit, where
     `F` (0x46) precedes `f` (0x66). localeCompare puts those two the
     other way round, and the row that sorts LAST is the one a composer
     keyed by id keeps - so a stub ordering by locale would hand a
     collision the opposite winner from production, which is the one
     thing an arm about a collision must not do. */
  const binary = (a, b) => (a.name < b.name ? -1 : (a.name > b.name ? 1 : 0));

  const superseded = (row) => submissions.some((other) =>
    other.supersedes === row.id && other.account_id === row.account_id);

  function answer(sql, args) {
    /* -------- auth_replay -------- */
    if (sql.startsWith("INSERT INTO auth_replay")) {
      if (replay.has(args[0])) return { meta: { changes: 0 } };
      replay.set(args[0], args[1]);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM auth_replay")) {
      for (const [key, expiry] of [...replay]) {
        if (expiry <= args[0]) replay.delete(key);
      }
      return { meta: { changes: 0 } };
    }

    /* -------- sessions -------- */
    if (sql.startsWith("INSERT INTO sessions")) {
      const columns = /INSERT INTO sessions\s*\(([^)]*)\)/.exec(sql)[1]
        .split(",").map((c) => c.trim());
      const row = {};
      columns.forEach((column, index) => { row[column] = args[index]; });
      sessions.set(row.token_hash, row);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("SELECT account_id, is_admin")) {
      return sessions.get(args[0]) || null;
    }
    if (sql.startsWith("DELETE FROM sessions WHERE token_hash")) {
      sessions.delete(args[0]);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM sessions WHERE account_id")) {
      for (const [key, row] of [...sessions]) {
        if (row.account_id === args[0]) sessions.delete(key);
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM sessions WHERE expires_at")) {
      for (const [key, row] of [...sessions]) {
        if (row.expires_at <= args[0]) sessions.delete(key);
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE sessions SET expires_at")) {
      const row = sessions.get(args[1]);
      if (row) row.expires_at = args[0];
      return { meta: { changes: row ? 1 : 0 } };
    }

    /* -------- membership -------- */
    if (sql.startsWith("SELECT account_id FROM membership WHERE role")) {
      return { results: [] };
    }

    /* -------- site_content -------- */
    if (sql.startsWith("SELECT name, value FROM site_content WHERE name LIKE")) {
      const pattern = patternOf(sql, args);
      return { results: [...content.values()]
        .filter((row) => likeMatch(row.name, pattern))
        .sort(binary)
        .map((row) => ({ name: row.name, value: row.value })) };
    }
    if (sql.startsWith(
      "SELECT name, value FROM site_content WHERE name NOT LIKE")) {
      const pattern = patternOf(sql, args);
      return { results: [...content.values()]
        .filter((row) => !likeMatch(row.name, pattern))
        .sort(binary)
        .map((row) => ({ name: row.name, value: row.value })) };
    }
    if (sql.startsWith("SELECT name, value FROM site_content WHERE name IN")) {
      const clause = /name IN \(([^)]*)\)/.exec(sql);
      const literals = clause
        ? [...clause[1].matchAll(/'([^']*)'/g)].map((m) => m[1]) : [];
      const wanted = new Set([...args, ...literals]);
      return { results: [...content.values()]
        .filter((row) => wanted.has(row.name))
        .map((row) => ({ name: row.name, value: row.value })) };
    }
    if (sql.startsWith("SELECT name FROM site_content WHERE name")) {
      const folded = String(args[0]).toLowerCase();
      const found = [...content.values()].find((row) =>
        row.name.toLowerCase() === folded);
      return found ? { name: found.name } : null;
    }
    if (sql.startsWith("INSERT INTO site_content")) {
      const [name, value, updated_at, updated_by] = args;
      content.set(name, { name, value, updated_at, updated_by });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM site_content")) {
      const folded = String(args[0]).toLowerCase();
      for (const [key, row] of [...content]) {
        if (row.name.toLowerCase() === folded) content.delete(key);
      }
      return { meta: { changes: 1 } };
    }

    /* -------- admin_log -------- */
    if (sql.startsWith("INSERT INTO admin_log")) {
      logSequence += 1;
      const [at, account_id, action, name, summary] = args;
      adminLog.push({ id: logSequence, at, account_id, action, name,
        summary });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("SELECT at, account_id, action, name, summary")) {
      const limit = Number(/LIMIT (\d+)/.exec(sql)[1]);
      return { results: adminLog.slice()
        .sort((a, b) => (a.at === b.at ? b.id - a.id
          : (a.at < b.at ? 1 : -1)))
        .slice(0, limit)
        .map((row) => ({ at: row.at, account_id: row.account_id,
          action: row.action, name: row.name, summary: row.summary })) };
    }

    /* -------- directory -------- */
    if (sql.startsWith("INSERT INTO directory")) {
      const [account_id, ciphertext, joined_at, last_seen_at] = args;
      directory.set(account_id,
        { account_id, ciphertext, joined_at, last_seen_at });
      return { meta: { changes: 1 } };
    }

    /* -------- submissions -------- */
    if (sql.startsWith("INSERT INTO submissions")) {
      const [id, account_id, ciphertext, received_at, supersedes] = args;
      submissions.push({ id, account_id, ciphertext, received_at,
        supersedes });
      return { meta: { changes: 1 } };
    }
    if (/FROM submissions AS mine/.test(sql) && /WHERE NOT/.test(sql)) {
      return { results: submissions
        .filter((row) => !superseded(row))
        .sort((a, b) => (a.received_at === b.received_at
          ? b.id - a.id : (a.received_at < b.received_at ? 1 : -1)))
        .map((row) => ({ id: row.id, account_id: row.account_id,
          received_at: row.received_at, ciphertext: row.ciphertext })) };
    }
    if (/FROM submissions AS mine/.test(sql) && /WHERE mine.account_id/
      .test(sql)) {
      return { results: submissions
        .filter((row) => row.account_id === args[0])
        .map((row) => ({ id: row.id, received_at: row.received_at,
          superseded: superseded(row) ? 1 : 0,
          ciphertext: row.ciphertext })) };
    }

    throw new Error("the D1 stub was handed a statement it does not " +
      "recognize, which means a path this arm covers changed shape " +
      "without the arm being told: " + sql);
  }

  const bound = (sql, args) => ({
    run: async () => answer(sql, args),
    first: async () => answer(sql, args),
    all: async () => answer(sql, args),
    _sql: sql,
    _args: args,
  });

  return {
    sessions, content, adminLog, submissions,
    DB: {
      prepare: (sql) => Object.assign(
        { bind: (...args) => bound(sql, args) }, bound(sql, [])),
      batch: async (statements) => statements.map((statement) =>
        answer(statement._sql, statement._args)),
    },
  };
}

function envFor(db) {
  return {
    DB: db.DB,
    ACCOUNT_SECRET: ACCOUNT_SECRET,
    STORE_SECRET: STORE_SECRET,
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_GROUP_CHAT_ID: CHAT_ID,
    ADMIN_TELEGRAM_IDS: ADMIN_ID,
    ALLOWED_ORIGINS: ORIGIN,
  };
}

/* The bot seam and the console, swapped for the length of a call. */
async function withSeams(fn) {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ ok: true, result: { status: "member" } }),
    { status: 200, headers: { "Content-Type": "application/json" } });
  console.log = () => {};
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
}

async function call(env, method, path, options) {
  const opts = options || {};
  const headers = Object.assign({ Origin: ORIGIN }, opts.headers || {});
  const init = { method: method, headers: headers };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = typeof opts.body === "string"
      ? opts.body : JSON.stringify(opts.body);
  }
  const response = await worker.fetch(
    new Request("https://sit.example.workers.dev" + path, init), env);
  const text = await response.clone().text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
  return { status: response.status, body: parsed, text: text,
    headers: response.headers };
}

const bearer = (token) => ({ Authorization: "Bearer " + token });

async function signIn(env, numericId) {
  return withSeams(() =>
    call(env, "POST", "/auth/telegram", { body: payloadFor(numericId) }));
}

/* One binder, signed in both ways, ready for a slice's worth of edits. */
async function freshWorld() {
  const db = makeDb();
  const env = envFor(db);
  const admin = await signIn(env, ADMIN_ID);
  const member = await signIn(env, MEMBER_ID);
  return { db, env, adminToken: admin.body.session,
    memberToken: member.body.session };
}

/* The effective spec off the route, or an empty one when the route did
   not answer with a spec at all. Empty rather than a throw for the
   reason tests/charts-aggregate.test.mjs states about its own countIn:
   reading a field off an undefined body raises a TypeError that takes
   the whole run down and hides every arm after it, so a suite that
   crashes is a suite whose remaining reds nobody saw. */
const specOf = async (env, token) => {
  const answer = await call(env, "GET", "/spec", { headers: bearer(token) });
  return (answer.body && answer.body.spec) || { fields: [] };
};

const fieldIn = (spec, name) =>
  (spec.fields || []).filter((one) => one.name === name)[0] || null;

const valuesIn = (spec, name) => {
  const one = fieldIn(spec, name);
  return one && one.choices ? one.choices.map((c) => c.value) : [];
};

const labelOf = (spec, name) => {
  const one = fieldIn(spec, name);
  return one ? one.label : null;
};

const labelIn = (spec, name, value) => {
  const one = fieldIn(spec, name);
  const found = one && one.choices
    ? one.choices.filter((c) => c.value === value)[0] : null;
  return found ? found.label : null;
};

const putField = (env, token, id, body) =>
  call(env, "PUT", "/admin-fields/" + id, { headers: bearer(token),
    body: body });

/* ================================================================== */
/* 1. The no-edit identity, and the session gate.                      */

{
  const { env, adminToken, memberToken } = await freshWorld();

  const anonymous = await call(env, "GET", "/spec");
  check("GET /spec refuses a caller with no session at all",
    anonymous.status === 401);

  const wrongToken = await call(env, "GET", "/spec",
    { headers: bearer("canary-s11-not-a-session") });
  check("GET /spec refuses a token that resolves to no session",
    wrongToken.status === 401);

  const asMember = await call(env, "GET", "/spec",
    { headers: bearer(memberToken) });
  check("GET /spec answers a plain member session - the spec is " +
    "member-facing data rather than an admin surface",
    asMember.status === 200 && asMember.body.ok === true);

  check("GET /spec is answered private and uncached - a shared cache " +
    "holding one binder's spec would serve it to the next",
    /no-store/.test(asMember.headers.get("Cache-Control") || ""));

  check("no admin edits: GET /spec is the shipped spec BYTE FOR BYTE",
    JSON.stringify(asMember.body.spec) === JSON.stringify(SITE));

  const asAdmin = await call(env, "GET", "/spec",
    { headers: bearer(adminToken) });
  check("no admin edits: an admin session reads the same bytes as a " +
    "member - one spec, not an admin view of one",
    asAdmin.status === 200 &&
    JSON.stringify(asAdmin.body.spec) === JSON.stringify(SITE) &&
    JSON.stringify(asAdmin.body.spec) ===
      JSON.stringify(asMember.body.spec));
}

/* ================================================================== */
/* 2. Adding, retiring and reordering values.                          */

{
  const { db, env, adminToken, memberToken } = await freshWorld();

  const before = await specOf(env, memberToken);
  check("before: the shipped gender values are the four the spec lists",
    JSON.stringify(valuesIn(before, "gender")) ===
      JSON.stringify(["male", "female", "nonbinary", "other"]));

  /* ADD. A value with no id is a new one, and the Worker mints the id
     from the label - an admin never types an id, which is the whole
     reason ids and labels are separate. */
  const added = await putField(env, adminToken, "gender", {
    values: [
      { id: "male", label: "Male" },
      { id: "female", label: "Female" },
      { id: "nonbinary", label: "Non-binary" },
      { id: "other", label: "Other" },
      { label: "Agender" },
    ],
  });
  check("add a value: the write is accepted", added.status === 200);

  const afterAdd = await specOf(env, memberToken);
  check("add a value: it is offered, under an id minted from its label",
    valuesIn(afterAdd, "gender").length === 5 &&
    valuesIn(afterAdd, "gender")[4] === "agender" &&
    labelIn(afterAdd, "gender", "agender") === "Agender");
  check("add a value: every value that was already offered is still " +
    "offered, in the order it was",
    JSON.stringify(valuesIn(afterAdd, "gender").slice(0, 4)) ===
      JSON.stringify(["male", "female", "nonbinary", "other"]));

  /* RETIRE. The value stays in the stored row so it can come back; what
     changes is that the effective spec stops offering it. */
  const retired = await putField(env, adminToken, "gender", {
    values: [
      { id: "male", label: "Male" },
      { id: "female", label: "Female" },
      { id: "nonbinary", label: "Non-binary" },
      { id: "other", label: "Other", retired: true },
      { id: "agender", label: "Agender" },
    ],
  });
  check("retire a value: the write is accepted", retired.status === 200);

  const afterRetire = await specOf(env, memberToken);
  check("retire a value: it is no longer offered",
    valuesIn(afterRetire, "gender").indexOf("other") === -1);
  check("retire a value: nothing else moved",
    JSON.stringify(valuesIn(afterRetire, "gender")) ===
      JSON.stringify(["male", "female", "nonbinary", "agender"]));
  check("retire a value: the retired value is KEPT in the stored row, " +
    "which is what makes un-retiring possible at all",
    /"other"/.test(db.content.get("field.gender").value));

  /* UN-RETIRE. The other direction of the same edit, which is what rule
     7 promises: restoring the field brings its answers back. */
  await putField(env, adminToken, "gender", {
    values: [
      { id: "male", label: "Male" },
      { id: "female", label: "Female" },
      { id: "nonbinary", label: "Non-binary" },
      { id: "other", label: "Other" },
      { id: "agender", label: "Agender" },
    ],
  });
  check("un-retire a value: it is offered again, in the place the " +
    "request puts it",
    valuesIn(await specOf(env, memberToken), "gender").indexOf("other") === 3);

  /* REORDER. The array order IS the offered order, so there is no
     separate index to keep in step with it. */
  const reordered = await putField(env, adminToken, "gender", {
    values: [
      { id: "agender", label: "Agender" },
      { id: "other", label: "Other" },
      { id: "nonbinary", label: "Non-binary" },
      { id: "female", label: "Female" },
      { id: "male", label: "Male" },
    ],
  });
  check("reorder: the write is accepted", reordered.status === 200);
  check("reorder: the offered order is the order the request listed",
    JSON.stringify(valuesIn(await specOf(env, memberToken), "gender")) ===
      JSON.stringify(["agender", "other", "nonbinary", "female", "male"]));

  /* OMISSION IS A RETIRE, NEVER A DELETE. A list that leaves a value
     out stops offering it and keeps it in the row - the same answer as
     naming it retired, because #385 rule 7 admits no third one. */
  await putField(env, adminToken, "gender", {
    values: [
      { id: "male", label: "Male" },
      { id: "female", label: "Female" },
    ],
  });
  const afterOmit = await specOf(env, memberToken);
  check("omitting a value retires it rather than destroying it",
    JSON.stringify(valuesIn(afterOmit, "gender")) ===
      JSON.stringify(["male", "female"]) &&
    /"nonbinary"/.test(db.content.get("field.gender").value) &&
    /"agender"/.test(db.content.get("field.gender").value));

  /* A VALUE ID THE FIELD DOES NOT HAVE IS A REFUSAL, not a quiet
     creation: an admin pane sending a stale id would otherwise invent a
     value nobody asked for. */
  const invented = await putField(env, adminToken, "gender", {
    values: [{ id: "invented", label: "Invented" }],
  });
  check("a value id this field has never had is refused",
    invented.status === 400);
  check("the refusal changed nothing",
    JSON.stringify(valuesIn(await specOf(env, memberToken), "gender")) ===
      JSON.stringify(["male", "female"]));
}

/* ================================================================== */
/* 3. A rename asks what it means (#385 rule 8).                       */

{
  const { db, env, adminToken, memberToken } = await freshWorld();

  const ambiguous = await putField(env, adminToken, "gender", {
    values: [
      { id: "male", label: "Man" },
      { id: "female", label: "Female" },
      { id: "nonbinary", label: "Non-binary" },
      { id: "other", label: "Other" },
    ],
  });
  check("a rename with no mode is REFUSED - the Worker does not guess " +
    "which of the two things the admin meant",
    ambiguous.status === 400);
  check("the refused rename changed nothing",
    labelIn(await specOf(env, memberToken), "gender", "male") === "Male");

  const badMode = await putField(env, adminToken, "gender", {
    mode: "rename",
    values: [
      { id: "male", label: "Man" },
      { id: "female", label: "Female" },
      { id: "nonbinary", label: "Non-binary" },
      { id: "other", label: "Other" },
    ],
  });
  check("a mode that is neither relabel nor replace is refused",
    badMode.status === 400);

  /* RELABEL: the same thing re-worded. The id does not move, so every
     stored answer follows the new word. */
  const relabeled = await putField(env, adminToken, "gender", {
    mode: "relabel",
    values: [
      { id: "male", label: "Man" },
      { id: "female", label: "Female" },
      { id: "nonbinary", label: "Non-binary" },
      { id: "other", label: "Other" },
    ],
  });
  check("relabel: the write is accepted", relabeled.status === 200);

  const afterRelabel = await specOf(env, memberToken);
  check("relabel: the stable id is untouched and only the word changed",
    valuesIn(afterRelabel, "gender")[0] === "male" &&
    labelIn(afterRelabel, "gender", "male") === "Man");
  check("relabel: no second value was minted",
    valuesIn(afterRelabel, "gender").length === 4);
  check("relabel: the change log says which of the two it was",
    db.adminLog.some((row) => row.action === "field.set" &&
      row.name === "gender" && /relabel/.test(row.summary)));

  /* REPLACE: a genuinely new option. The old id retires with its old
     word, and the new one is minted in its place. */
  const replaced = await putField(env, adminToken, "gender", {
    mode: "replace",
    values: [
      { id: "male", label: "Man" },
      { id: "female", label: "Woman" },
      { id: "nonbinary", label: "Non-binary" },
      { id: "other", label: "Other" },
    ],
  });
  check("replace: the write is accepted", replaced.status === 200);

  const afterReplace = await specOf(env, memberToken);
  check("replace: the old value is no longer offered",
    valuesIn(afterReplace, "gender").indexOf("female") === -1);
  check("replace: a new value stands in its place, in the same position",
    valuesIn(afterReplace, "gender")[1] === "woman" &&
    labelIn(afterReplace, "gender", "woman") === "Woman");
  check("replace: the retired value keeps the word it was retired " +
    "under, so a reader of the row can tell what it meant",
    /"label":"Female"/.test(
      db.content.get("field.gender").value.replace(/\s+/g, "")));
  check("replace: the change log says which of the two it was",
    db.adminLog.some((row) => row.action === "field.set" &&
      row.name === "gender" && /replace/.test(row.summary)));

  /* A MINTED ID NEVER LANDS ON ONE THAT IS ALREADY SPOKEN FOR, retired
     ids included - resurrecting a retired id would silently re-adopt
     every entry saved under it. */
  await putField(env, adminToken, "gender", {
    mode: "replace",
    values: [
      { id: "male", label: "Man" },
      { id: "woman", label: "Female" },
      { id: "nonbinary", label: "Non-binary" },
      { id: "other", label: "Other" },
    ],
  });
  const afterCollision = await specOf(env, memberToken);
  check("a minted id steps around an id the field already had, even a " +
    "retired one",
    valuesIn(afterCollision, "gender")[1] === "female-2" &&
    labelIn(afterCollision, "gender", "female-2") === "Female");
}

/* ================================================================== */
/* 4. Keep the data, adapt the display (#385 rule 7).                  */
/*                                                                     */
/* THE ARM THE BATCH SECURITY CONSULT READS FIRST: an admin edit moves  */
/* no sealed byte. The comparison is on the raw stored ciphertext,      */
/* string against string, on both sides of a retire that really did     */
/* take the value out of the effective spec.                           */

{
  const { db, env, adminToken, memberToken } = await freshWorld();

  const record = JSON.stringify({
    record: 1,
    submittedAt: "2026-08-01T00:00:00.000Z",
    telegram: "canary_s11_712020202",
    entered: { units: "metric", weight: "100 kg", height: "170 cm" },
    weight: { kg: 100, lb: 220.5 },
    height: { cm: 170, totalInches: 66.9 },
    gender: "other",
    roles: ["gainer"],
    country: "US",
    over18: true,
  });

  const submitted = await call(env, "POST", "/submit",
    { headers: bearer(memberToken), body: { record: record } });
  check("a member's entry is sealed and stored", submitted.status === 200 &&
    db.submissions.length === 1);

  /* THE WHOLE TABLE, not one row of it, and the mutation battery is why
     this is a snapshot rather than a single string: a comparison on
     `submissions[0]` alone stayed green against a retire path that
     appended a row of its own, because a row added at the end moves no
     byte at the front. What "moves no sealed byte" has to mean is the
     table before and the table after, ids and ciphertexts and all. */
  const sealedBefore = db.submissions[0].ciphertext;
  const sealedTable = () => JSON.stringify(db.submissions);
  const tableBefore = sealedTable();

  check("before the retire: the value the member saved is offered",
    valuesIn(await specOf(env, memberToken), "gender").indexOf("other") !== -1);

  const retired = await putField(env, adminToken, "gender", {
    values: [
      { id: "male", label: "Male" },
      { id: "female", label: "Female" },
      { id: "nonbinary", label: "Non-binary" },
      { id: "other", label: "Other", retired: true },
    ],
  });
  check("the retire is accepted", retired.status === 200);
  check("after the retire: the value really is out of the effective spec",
    valuesIn(await specOf(env, memberToken), "gender").indexOf("other") === -1);

  check("KEEP THE DATA: the sealed row is BYTE-IDENTICAL across the " +
    "retire - not re-sealed, not rewritten, not re-encoded",
    db.submissions[0].ciphertext === sealedBefore);
  check("KEEP THE DATA: the whole submissions table is unchanged - no " +
    "row added, none taken away, no column touched",
    sealedTable() === tableBefore);

  const mine = await call(env, "GET", "/my-entries",
    { headers: bearer(memberToken) });
  check("KEEP THE DATA: the member's own entry still opens, and still " +
    "carries the answer the admin retired",
    mine.status === 200 && mine.body.entries.length === 1 &&
    JSON.parse(mine.body.entries[0].record).gender === "other");

  /* THE WHOLE FIELD, and the same promise. DELETE retires the field; the
     answers inside sealed rows are untouched, and un-retiring brings the
     field back. */
  const droppedField = await call(env, "DELETE", "/admin-fields/roles",
    { headers: bearer(adminToken) });
  check("DELETE /admin-fields/<id> retires the whole field",
    droppedField.status === 200 &&
    fieldIn(await specOf(env, memberToken), "roles") === null);
  check("KEEP THE DATA: retiring a whole field leaves the same table " +
    "behind, byte for byte",
    db.submissions[0].ciphertext === sealedBefore &&
    sealedTable() === tableBefore);

  await putField(env, adminToken, "roles", { retired: false });
  const restored = await specOf(env, memberToken);
  check("un-retiring a field brings it back, with its values",
    fieldIn(restored, "roles") !== null &&
    JSON.stringify(valuesIn(restored, "roles")) ===
      JSON.stringify(["feeder", "feedee", "gainer", "admirer"]));
  check("un-retiring a field the admin never otherwise edited restores " +
    "the shipped field exactly",
    JSON.stringify(fieldIn(restored, "roles")) ===
      JSON.stringify(SITE.fields.filter((one) => one.name === "roles")[0]));
}

/* ================================================================== */
/* 5. Numeric and consent fields are code (#385 rule 6).               */

{
  const { db, env, adminToken, memberToken } = await freshWorld();

  for (const name of ["weight", "height", "bmi", "over18"]) {
    const refused = await putField(env, adminToken, name,
      { label: "Anything" });
    check("PUT /admin-fields/" + name + " is refused - its units and " +
      "bands are code, not admin data", refused.status === 400);
    const dropped = await call(env, "DELETE", "/admin-fields/" + name,
      { headers: bearer(adminToken) });
    check("DELETE /admin-fields/" + name + " is refused for the same " +
      "reason", dropped.status === 400);
  }

  check("no refusal wrote a row", db.content.size === 0);
  check("the shipped spec is untouched by four refused writes",
    JSON.stringify(await specOf(env, memberToken)) === JSON.stringify(SITE));

  /* A FIELD WHOSE CHOICES LIVE OUTSIDE THE SPEC takes a label and
     refuses a value list: there is no list here to edit, and accepting
     one would half-apply an edit the reader then ignores. */
  const country = await putField(env, adminToken, "country", {
    values: [{ label: "Somewhere" }],
  });
  check("a value list is refused on a field whose choices live " +
    "elsewhere", country.status === 400);
  const countryLabel = await putField(env, adminToken, "country",
    { label: "Where you live" });
  check("that field still takes a label", countryLabel.status === 200 &&
    labelOf(await specOf(env, memberToken), "country") === "Where you live");
}

/* THE READ SIDE OF THE SAME RULE. The refusals above are one half of a
   double wall and the composer is the other: a row naming a measured
   field can only be written the way that goes around the route -
   `wrangler d1 execute` - and what reaches the effective spec is
   NOTHING. Without this half, a hand-written row would relabel a
   measure, hang choices off a number, or splice the consent box out of
   the form, and the write route's refusal would be a formality. Every
   non-choice kind the shipped spec has is here: a weight, a length, a
   computed number and a consent bit. */

{
  const { db, env, memberToken } = await freshWorld();

  const seed = (name, value) => db.content.set(name,
    { name: name, value: value, updated_at: "2026-01-01T00:00:00.000Z",
      updated_by: "seed" });

  seed("field.weight", JSON.stringify({ v: 1, label: "Tonnage",
    term: "tonnage", values: [{ id: "heavy", label: "Heavy" }] }));
  seed("field.height", JSON.stringify({ v: 1, term: "tallness" }));
  seed("field.bmi", JSON.stringify({ v: 1, label: "Body mass" }));
  seed("field.over18", JSON.stringify({ v: 1, retired: true }));

  check("all four measured-field rows really are in the table - what " +
    "follows is an absence forced against real rows, not a stub default",
    db.content.size === 4 && ["weight", "height", "bmi", "over18"]
      .every((name) => db.content.has("field." + name)));

  const overlaid = await specOf(env, memberToken);
  check("a hand-written `field.weight` row does not relabel the measure " +
    "and does not hang choices off a number",
    labelOf(overlaid, "weight") === labelOf(SITE, "weight") &&
    fieldIn(overlaid, "weight").choices === undefined);
  check("a hand-written `field.height` row does not change the term the " +
    "form asks the question in",
    fieldIn(overlaid, "height").term === fieldIn(SITE, "height").term);
  check("a hand-written `field.bmi` row does not relabel the computed " +
    "number", labelOf(overlaid, "bmi") === labelOf(SITE, "bmi"));
  check("a hand-written `field.over18` row does not retire consent",
    fieldIn(overlaid, "over18") !== null);
  check("and the whole effective spec is the shipped one byte for byte " +
    "with four measured-field rows sitting in the table",
    JSON.stringify(overlaid) === JSON.stringify(SITE));

  /* THE OTHER READER. server/charts-agg.js decides every measure and
     every band against the same composed spec, so a hand-written retire
     that this half honored would take a chart away rather than merely
     mislabel a box. */
  seed("field.weight", JSON.stringify({ v: 1, retired: true }));
  check("a hand-written row cannot retire a measured field either",
    fieldIn(await specOf(env, memberToken), "weight") !== null);
  const charted = await call(env, "GET", "/charts-data?measure=weight",
    { headers: bearer(memberToken) });
  check("and the aggregation, composing the same spec on its own " +
    "request, still charts the measure",
    charted.status === 200);
}

/* ================================================================== */
/* 6. Admin-added fields, and what reads them.                         */

{
  const { db, env, adminToken, memberToken } = await freshWorld();

  const anonymous = await putField(env, null, "mood", { label: "Mood" });
  check("PUT /admin-fields/<id> refuses a caller with no session",
    anonymous.status === 401);
  const asMember = await putField(env, memberToken, "mood",
    { label: "Mood" });
  check("PUT /admin-fields/<id> refuses a member session",
    asMember.status === 401);
  const memberDelete = await call(env, "DELETE", "/admin-fields/gender",
    { headers: bearer(memberToken) });
  check("DELETE /admin-fields/<id> refuses a member session",
    memberDelete.status === 401);
  check("the refusals wrote nothing", db.content.size === 0);

  const created = await putField(env, adminToken, "mood", {
    label: "Mood",
    term: "mood",
    blank: "Prefer not to say",
    values: [{ label: "Great" }, { label: "Grim" }],
  });
  check("an admin adds a categorical field the shipped spec has never " +
    "heard of", created.status === 200);

  const withMood = await specOf(env, memberToken);
  const mood = fieldIn(withMood, "mood");
  check("the invented field arrives in the effective spec as a choice " +
    "field, charted, with its minted value ids",
    mood !== null && mood.kind === "choice" && mood.chart === true &&
    JSON.stringify(valuesIn(withMood, "mood")) ===
      JSON.stringify(["great", "grim"]));
  check("a field with no label is refused rather than created nameless",
    (await putField(env, adminToken, "nameless", {})).status === 400);

  /* THE FIXTURE-FIELD PROOF: a categorical field no code has ever heard
     of reaches the group-makeup block through the same path the shipped
     fields take, with no code change anywhere. */
  const record = (mood_) => JSON.stringify({
    record: 1,
    submittedAt: "2026-08-01T00:00:00.000Z",
    telegram: "canary_s11_712020202",
    entered: { units: "metric", weight: "100 kg", height: "170 cm" },
    weight: { kg: 100, lb: 220.5 },
    height: { cm: 170, totalInches: 66.9 },
    gender: "male",
    roles: [],
    country: "US",
    mood: mood_,
    over18: true,
  });

  await call(env, "POST", "/submit",
    { headers: bearer(memberToken), body: { record: record("great") } });

  const charts = await call(env, "GET", "/charts-data?measure=weight",
    { headers: bearer(memberToken) });
  const moodBlock = (charts.body.groups || [])
    .filter((one) => one.field === "mood")[0];
  check("an admin-added categorical field appears in the group-makeup " +
    "block with no code change",
    charts.status === 200 && moodBlock !== undefined &&
    moodBlock.label === "Mood");
  const countIn = (cells, value) => {
    const found = (cells || []).filter((one) => one.value === value)[0];
    return found ? found.count : null;
  };
  check("and its counts are the real ones, drawn from a sealed record " +
    "the admin's field taught the aggregation to read",
    countIn(moodBlock && moodBlock.values, "great") === 1 &&
    countIn(moodBlock && moodBlock.values, "grim") === 0);

  /* The other direction: the charts also stop offering what an admin
     retires, which is the filter half of the same seam. */
  const filtered = await call(env,
    "GET", "/charts-data?measure=weight&filter=mood&value=great",
    { headers: bearer(memberToken) });
  check("an admin-added field is a filter dimension too",
    filtered.status === 200 && filtered.body.enough === true);

  await call(env, "DELETE", "/admin-fields/mood",
    { headers: bearer(adminToken) });
  const afterRetire = await call(env,
    "GET", "/charts-data?measure=weight&filter=mood&value=great",
    { headers: bearer(memberToken) });
  check("retiring the field takes the filter away again - the charts " +
    "read the effective spec on every request",
    afterRetire.status === 400);
}

/* ================================================================== */
/* 7. The spec is not site copy.                                       */

{
  const { db, env, adminToken } = await freshWorld();

  await putField(env, adminToken, "mood", {
    label: "Mood", values: [{ label: "Great" }],
  });
  await call(env, "POST", "/content", { headers: bearer(adminToken),
    body: { name: "site.welcomeText", value: "Canary welcome" } });

  check("the field row really is in the table beside the copy",
    db.content.has("field.mood") && db.content.has("site.welcomeText"));

  const content = await call(env, "GET", "/content");
  check("GET /content answers with no credential, as it always has",
    content.status === 200 &&
    content.body.content["site.welcomeText"] === "Canary welcome");
  check("and it serves NO field row - the spec is behind the session " +
    "gate on GET /spec, and a credential-free read of the same table " +
    "would make that gate a fiction",
    content.status === 200 &&
    Object.keys((content.body && content.body.content) || {}).every((name) =>
      !name.toLowerCase().startsWith("field.")));

  const config = await call(env, "GET", "/config");
  check("GET /config is unchanged and still serves its three names only",
    config.status === 200 &&
    Object.keys((config.body && config.body.config) || {}).length === 3);

  /* THE OTHER DOOR. A field row is written through PUT /admin-fields
     and nowhere else, so the copy route refuses the namespace outright -
     otherwise the validation this slice added would have a second
     entrance with none of it. */
  const squat = await call(env, "POST", "/content",
    { headers: bearer(adminToken),
      body: { name: "field.gender", value: "not a spec" } });
  check("POST /content refuses the field namespace", squat.status === 400);
  const squatFolded = await call(env, "POST", "/content",
    { headers: bearer(adminToken),
      body: { name: "fIELD.gender", value: "not a spec" } });
  check("and refuses it however it is capitalized - a fold-only " +
    "difference would take the slot the real name needs, and this " +
    "spelling is one CONTENT_NAME itself admits so the fold is what " +
    "has to catch it",
    squatFolded.status === 400);
  const unset = await call(env, "DELETE", "/content/field.mood",
    { headers: bearer(adminToken) });
  check("DELETE /content/<name> refuses it too, so a field is retired " +
    "through its own route rather than deleted through the copy one",
    unset.status === 404 && db.content.has("field.mood"));
}

/* ================================================================== */
/* 8. The stored format, and a reader that fails safe.                 */

{
  const { db, env, adminToken, memberToken } = await freshWorld();

  const write = (name, value) => db.content.set(name,
    { name: name, value: value, updated_at: "2026-01-01T00:00:00.000Z",
      updated_by: "seed" });

  /* Every one of these is a row `wrangler d1 execute` can write and no
     route can: unparseable, a version this Worker does not know, an id
     the charset refuses. Each falls back to the shipped field rather
     than throwing or half-applying, which is the same forgiving-reader
     direction floorOf() takes - the strictness is on the write side. */
  write("field.gender", "{not json");
  check("an unparseable field row falls back to the shipped field",
    JSON.stringify(valuesIn(await specOf(env, memberToken), "gender")) ===
      JSON.stringify(["male", "female", "nonbinary", "other"]));

  write("field.gender", JSON.stringify({ v: 99, values: [] }));
  check("a field row written under a version this Worker does not know " +
    "falls back rather than serving an empty field",
    JSON.stringify(valuesIn(await specOf(env, memberToken), "gender")) ===
      JSON.stringify(["male", "female", "nonbinary", "other"]));

  db.content.delete("field.gender");
  write("FIELD.Gender", JSON.stringify({ v: 1, values: [] }));
  check("a field row whose id the charset refuses is ignored",
    JSON.stringify(await specOf(env, memberToken)) === JSON.stringify(SITE));

  /* THE SPELLING THE CHARSET CANNOT SEE. `FIELD.gender` differs from
     the real name only in the PREFIX's case, which SPEC_ID never reads,
     and D1's LIKE folds - so the statement hands this row over and a
     blind cut at six characters would compose it onto `gender`. Alone
     in the table it would retire the shipped field; the id charset is
     no help, because the id it produces is a perfectly good one. */
  db.content.delete("FIELD.Gender");
  write("FIELD.gender", JSON.stringify({ v: 1, retired: true }));
  check("a row differing from the real name only in the PREFIX's case " +
    "is ignored, alone in the table, where nothing else could hide it",
    db.content.size === 1 && db.content.has("FIELD.gender") &&
    JSON.stringify(await specOf(env, memberToken)) === JSON.stringify(SITE));

  await putField(env, adminToken, "gender", { label: "Canonical gender" });
  check("with BOTH spellings in the table it is the exact one that " +
    "composes - one field, never two rows answering as one",
    db.content.size === 2 && db.content.has("field.gender") &&
    labelOf(await specOf(env, memberToken), "gender") === "Canonical gender");

  /* AND THE COLLISION IS ORDERED THE WAY D1 ORDERS IT. `ORDER BY name`
     is BINARY on a real deployment, so the folded row comes back FIRST
     and the exact one last; under localeCompare the two swap, and the
     row a composer keyed by id keeps is the last one. The arm above
     would then be asking a different question from production, which is
     why the stub's collation is pinned here rather than assumed. */
  const ordered = await db.DB.prepare(
    "SELECT name, value FROM site_content WHERE name LIKE ? ORDER BY name")
    .bind("field.%").all();
  check("the stub orders a colliding pair by code unit, as D1 does - " +
    "the folded spelling first, the exact one last",
    ordered.results.map((row) => row.name).join(",") ===
      "FIELD.gender,field.gender");

  /* The write side of the same wall: the read ignores a folded spelling
     and the write never makes one. POST /content refuses the namespace
     folded (section 7); the field route refuses the id itself. */
  check("PUT /admin-fields/<id> refuses an id the charset folds - so " +
    "there is no route that writes the row the composer skips",
    (await putField(env, adminToken, "Gender", { label: "x" }))
      .status === 404);

  db.content.clear();

  /* AND THE SHAPE THE ROUTE REALLY WRITES carries the version byte, so
     the next format change has something to branch on rather than a
     regenerated row (AGENTS.md, "Code standards"). */
  await putField(env, adminToken, "gender",
    { values: [{ id: "male", label: "Male" }] });
  check("the stored row carries its own version byte",
    JSON.parse(db.content.get("field.gender").value).v === 1);
  check("the stored row is written by the admin who wrote it",
    db.content.get("field.gender").updated_by === accountFor(ADMIN_ID));

  /* THE CHANGE LOG. One line per write, naming the field and carrying
     what the admin typed - and never a handle or a numeric id. */
  const log = await call(env, "GET", "/admin-log",
    { headers: bearer(adminToken) });
  check("the change log carries the field write",
    log.status === 200 &&
    log.body.log.some((row) => row.action === "field.set" &&
      row.name === "gender"));
  check("the change log's actor is the account id, never the handle",
    log.body.log.every((row) => !/canary_s11/.test(row.accountId) &&
      !/canary_s11/.test(row.summary) &&
      !/71[12]0/.test(row.summary)));

  await call(env, "DELETE", "/admin-fields/gender",
    { headers: bearer(adminToken) });
  const afterRetire = await call(env, "GET", "/admin-log",
    { headers: bearer(adminToken) });
  check("a retire is its own line, told apart from an edit",
    afterRetire.body.log.some((row) => row.action === "field.retire" &&
      row.name === "gender"));
}

/* ================================================================== */
/* 9. Bounds, so an admin cannot make the spec unservable.             */

{
  const { db, env, adminToken } = await freshWorld();

  const longLabel = "x".repeat(200);
  check("a field label past the bound is refused",
    (await putField(env, adminToken, "mood", { label: longLabel }))
      .status === 400);
  check("a value label past the bound is refused",
    (await putField(env, adminToken, "mood",
      { label: "Mood", values: [{ label: longLabel }] })).status === 400);

  const many = [];
  for (let i = 0; i < 200; i += 1) many.push({ label: "Value " + i });
  check("a value list past the bound is refused",
    (await putField(env, adminToken, "mood",
      { label: "Mood", values: many })).status === 400);

  check("an id the charset refuses is a 404 rather than a 400 - the " +
    "path names no field this Worker has",
    (await putField(env, adminToken, "Not An Id", { label: "x" }))
      .status === 404);

  check("nothing above wrote a row", db.content.size === 0);

  /* MULTIPLE IS FIXED AT CREATION. Changing it changes how every stored
     answer is read - a string where an array was - so the request is
     refused rather than quietly re-reading everybody's rows. */
  await putField(env, adminToken, "mood",
    { label: "Mood", multiple: true, values: [{ label: "Great" }] });
  const flipped = await putField(env, adminToken, "mood",
    { multiple: false });
  check("flipping `multiple` on a field that already exists is refused",
    flipped.status === 400);
}

/* THE FIELD CEILING COUNTS THE FORM, not the rows behind it. An overlay
   on a SHIPPED field is that field a second time, so a count that added
   the shipped list to the row list would refuse a binder three fields
   early for every shipped field its admins had edited - and print a
   sentence claiming the form carries forty while it carried thirty-
   seven. The arm drives the ceiling from a table that has one such
   overlay in it, which is the state where the two counts disagree. */

{
  const { env, adminToken, memberToken } = await freshWorld();

  const shipped = SITE.fields.length;
  await putField(env, adminToken, "gender", { label: "Gender, edited" });

  let added = 0;
  let refusedAt = 0;
  for (let i = 1; i <= shipped + 40; i += 1) {
    const answer = await putField(env, adminToken, "extra" + i,
      { label: "Extra " + i });
    if (answer.status === 200) {
      added += 1;
      continue;
    }
    refusedAt = answer.status;
    break;
  }

  check("the form fills up to exactly the ceiling, counting an edited " +
    "shipped field once rather than twice",
    added === 40 - shipped && refusedAt === 409);
  const full = await specOf(env, memberToken);
  check("and the effective spec at that point really carries forty " +
    "fields, which is what the refusal says it carries",
    (full.fields || []).length === 40);
}

/* ------------------------------------------------------------------ */

console.log("");
console.log(failures === 0
  ? "fields-overlay OK - " + performed + " checks"
  : "fields-overlay FAILED " + failures + " of " + performed);
process.exit(failures === 0 ? 0 : 1);
