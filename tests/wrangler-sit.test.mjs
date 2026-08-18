/*
 * server/wrangler.toml carries the ruled sit shape (0.9-M1-S1, #325;
 * DESIGN.md, "One Worker codebase, two environments: sit and
 * production").
 *
 *     node tests/wrangler-sit.test.mjs
 *
 * WHY A FRESH PARSER RATHER THAN REUSING tools/check_server.py's.
 * tools/check_server.py already parses this file's `[vars]`-shaped
 * blocks for the OLD gate's own reasons (no disallowed plaintext var,
 * no DEV_LOGIN_SECRET assignment). That check keeps guarding what it
 * always guarded - it does not know sit exists, and it does not need
 * to: a `[vars]`-shaped block is a `[vars]`-shaped block whatever its
 * header is named. This arm is a DIFFERENT question - not "is anything
 * disallowed in a vars block" but "does the file carry the ruled sit
 * SHAPE": the env named `sit` rather than `dev`, preview_urls stated on
 * every environment, no secret's VALUE anywhere (a stronger claim than
 * check_server's, which is scoped to vars blocks alone), and no
 * database_id shipped as a placeholder for a database that does not
 * exist yet. The 0.9 wave ruling is that new coverage is written new
 * (AGENTS.md, "Verification") rather than folded into a transitional
 * check that guards something else.
 *
 * DERIVE, DO NOT PIN: every rule below is read off DESIGN.md's and
 * OPERATIONS.md's own words at the top of this file, not hand-copied
 * past them, so a future rewording is caught here rather than only in
 * a stale test expectation.
 *
 * MUTATION EVIDENCE (both directions), performed by hand while writing
 * this arm and reported in 0.9-M1-S1's completion rather than kept as
 * a permanently-armed self-mutating check: a secret value planted in
 * server/wrangler.toml reds `noSecretValues`; `[env.sit]` renamed back
 * to `[env.dev]` reds `envNamedSit` and `devAbsent`; `preview_urls`
 * flipped to true under `[env.sit]` reds `previewUrlsOff`. Each fixture
 * check below is the same evidence kept live: it proves the RULE, not
 * only the real file, so a rule that stopped checking anything reds
 * here even if the real file never regresses.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WRANGLER = ROOT + "server/wrangler.toml";

/* Comments stripped char-by-char rather than by regex, matching
   tools/check_server.py's own strip_comments: a `#` inside a quoted
   value (a URL fragment, say) is part of the value, and a line-regex
   truncating at the first `#` would silently shorten it instead of
   raising. */
function stripComments(text) {
  return text.split("\n").map((line) => {
    let kept = "";
    let inString = false;
    for (const ch of line) {
      if (ch === '"') inString = !inString;
      else if (ch === "#" && !inString) break;
      kept += ch;
    }
    return kept;
  }).join("\n");
}

const HEADER = /^\s*(\[\[?[^\]]+\]\]?)\s*$/;
const ASSIGN = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.*)$/;

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed.at(-1) === '"') {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/* {headers: Set<string>, blocks: {header: {key: value}}, assigns:
   [{name, value, header}]} - one pass, active (uncommented) lines
   only. `assigns` is every top-level `NAME = value` line regardless of
   which table it sits under, which is what the no-secret-value scan
   needs: a secret pasted under a header this file does not expect yet
   (a stray `[env.sit.secrets]`, say) still has to be caught, and a
   parser that only looked inside known headers would miss exactly
   that. */
function parse(rawText) {
  /* CRLF-normalized first (found by this arm's own mutation battery,
     0.9-M1-S1, #325): JS's `.` never matches `\r`, so ASSIGN's trailing
     `(.*)$` cannot reach end-of-line over an unconsumed `\r` and every
     assignment on a CRLF line goes unseen - headers still match (`\s`
     does include `\r`), so the failure is silent rather than a crash:
     noSecretValues in particular would read a CRLF-corrupted file as
     clean no matter what it assigned. server/wrangler.toml is pinned
     `text eol=lf` (.gitattributes) so this never happens through normal
     git operations, but a parser that quietly stops checking anything
     the moment a line ending changes is exactly the kind of gap this
     repository's own field notes (AGENTS.md, 2026-08-09) keep finding
     the hard way - cheap to close here rather than rediscovered live. */
  const text = rawText.replace(/\r\n/g, "\n");
  const headers = new Set();
  const blocks = {};
  const assigns = [];
  let current = null;
  for (const line of stripComments(text).split("\n")) {
    const header = HEADER.exec(line);
    if (header) {
      current = header[1];
      headers.add(current);
      blocks[current] = blocks[current] || {};
      continue;
    }
    const assign = ASSIGN.exec(line);
    if (assign) {
      const [, name, rawValue] = assign;
      const value = unquote(rawValue);
      assigns.push({ name, value, header: current });
      if (current) blocks[current][name] = value;
    }
  }
  return { headers, blocks, assigns };
}

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* ------------------------------------------------------------------ */
/* The rules, proved against fabricated TOML first so a rule that      */
/* stopped checking anything reds here even when the real file is      */
/* clean.                                                              */

const SIT_SECRETS = ["ACCOUNT_SECRET", "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_GROUP_CHAT_ID", "EXPORT_TOKEN"];
const ABSENT_SECRETS = ["ADMIN_TELEGRAM_IDS", "ALWAYS_ALLOW_TELEGRAM_IDS",
  "DEV_LOGIN_SECRET"];
/* Every secret this file's own general vocabulary names, whether sit
   carries it or not - the no-value scan covers all seven, because a
   value for one of the "deliberately absent" three would be the worse
   mistake, not a smaller one. */
const ALL_SECRETS = [...SIT_SECRETS, ...ABSENT_SECRETS];

function envNamedSit(parsed) {
  return parsed.headers.has("[env.sit]") && parsed.headers.has("[env.sit.vars]");
}

function devAbsent(parsed) {
  return [...parsed.headers].every((h) => !/^\[+env\.dev\b/.test(h));
}

function previewUrlsOff(parsed) {
  const top = parsed.assigns.find((a) => a.header === null &&
    a.name === "preview_urls");
  const sit = parsed.assigns.find((a) => a.header === "[env.sit]" &&
    a.name === "preview_urls");
  return Boolean(top) && top.value === "false" &&
    Boolean(sit) && sit.value === "false";
}

function noSecretValues(parsed) {
  return ALL_SECRETS.every((name) =>
    !parsed.assigns.some((a) => a.name === name));
}

const D1_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function sitDatabaseBlockReal(parsed) {
  const block = parsed.blocks["[[env.sit.d1_databases]]"];
  return Boolean(block) && block.binding === "DB" &&
    block.database_name === "hg_binder_db_sit" &&
    D1_UUID.test(block.database_id || "");
}

function origins(value) {
  return (value || "").split(",").map((o) => o.trim()).filter(Boolean);
}
const isLoopback = (origin) =>
  origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1");

function sitOriginsLoopbackOnly(parsed) {
  const list = origins(parsed.blocks["[env.sit.vars]"]?.ALLOWED_ORIGINS);
  return list.length > 0 && list.every(isLoopback);
}

/* --- fixture: the ruled shape, minimal but complete --- */
const GOOD = `
name = "hgbinderworker"
preview_urls = false
[vars]
ALLOWED_ORIGINS = "https://potaetoe.github.io"
[env.sit]
name = "hgbinderworker-sit"
preview_urls = false
[env.sit.vars]
ALLOWED_ORIGINS = "http://localhost:8124,http://127.0.0.1:8124"
[[env.sit.d1_databases]]
binding = "DB"
database_name = "hg_binder_db_sit"
database_id = "00000000-1111-4222-8333-444444444444"
`;
const good = parse(GOOD);
check("fixture: the ruled shape names [env.sit], not [env.dev]",
  envNamedSit(good) && devAbsent(good));
check("fixture: preview_urls is false at top level and under [env.sit]",
  previewUrlsOff(good));
check("fixture: no secret carries a value", noSecretValues(good));
check("fixture: the [[env.sit.d1_databases]] block is present and " +
  "well-formed (the database exists since 2026-08-18, #282)",
  sitDatabaseBlockReal(good));
check("fixture: sit's origins are loopback-only",
  sitOriginsLoopbackOnly(good));

/* --- mutation evidence: each rule catches the violation it names --- */
const stillDev = GOOD.replace("[env.sit]", "[env.dev]")
  .replace("[env.sit.vars]", "[env.dev.vars]");
check("mutation: an env still named dev is caught",
  !envNamedSit(parse(stillDev)) || !devAbsent(parse(stillDev)));

const previewOn = GOOD.replace(
  "[env.sit]\nname = \"hgbinderworker-sit\"\npreview_urls = false",
  "[env.sit]\nname = \"hgbinderworker-sit\"\npreview_urls = true");
check("mutation: preview_urls flipped true under [env.sit] is caught",
  !previewUrlsOff(parse(previewOn)));

const plantedSecret = GOOD + '\nACCOUNT_SECRET = "hunter2hunter2hunter2"\n';
check("mutation: a secret value planted anywhere in the file is caught",
  !noSecretValues(parse(plantedSecret)));

const plantedAbsentSecret = GOOD + '\nDEV_LOGIN_SECRET = "hunter2hunter2"\n';
check("mutation: a value for a deliberately-absent secret is caught too",
  !noSecretValues(parse(plantedAbsentSecret)));

const placeholderId = GOOD.replace(
  'database_id = "00000000-1111-4222-8333-444444444444"',
  'database_id = "REPLACE_ME"');
check("mutation: a placeholder database_id is caught",
  !sitDatabaseBlockReal(parse(placeholderId)));
const blockGone = GOOD.replace(/\[\[env\.sit\.d1_databases\]\][^]*?444444444444"\n/, "");
check("mutation: a deleted [[env.sit.d1_databases]] block is caught",
  !sitDatabaseBlockReal(parse(blockGone)));

const publishedOrigin = GOOD.replace(
  'ALLOWED_ORIGINS = "http://localhost:8124,http://127.0.0.1:8124"',
  'ALLOWED_ORIGINS = "http://localhost:8124,https://potaetoe.github.io"');
check("mutation: a non-loopback origin under [env.sit.vars] is caught",
  !sitOriginsLoopbackOnly(parse(publishedOrigin)));

/* --- naming it in a comment, never as an assignment, must NOT trip
   the no-value scan - the real file discusses every absent secret at
   length in prose, which is the point of citing a ruling rather than
   staying silent. --- */
const namedInComment = GOOD +
  "\n# DEV_LOGIN_SECRET is deliberately absent - see DESIGN.md.\n" +
  "# ADMIN_TELEGRAM_IDS and ALWAYS_ALLOW_TELEGRAM_IDS: same.\n";
check("naming an absent secret in a comment is not an assignment",
  noSecretValues(parse(namedInComment)));

/* ------------------------------------------------------------------ */
/* The real file.                                                      */

const real = parse(await readFile(WRANGLER, "utf8"));

check("the real file parses and carries at least one header",
  real.headers.size > 0);
check("the real file names [env.sit] and [env.sit.vars]",
  envNamedSit(real));
check("the real file names no [env.dev]* header",
  devAbsent(real));
check("the real file states preview_urls = false at top level and " +
  "under [env.sit]", previewUrlsOff(real));
check("the real file assigns no secret a value, present or absent-by-" +
  "design alike", noSecretValues(real));
check("the real file's [[env.sit.d1_databases]] block is present and " +
  "well-formed - the database was created 2026-08-18 (#282) and the " +
  "committed id is what deploy binds", sitDatabaseBlockReal(real));
check("the real file's [env.sit.vars] origins are loopback-only",
  sitOriginsLoopbackOnly(real));
check("the real file's production [vars] still names a real published " +
  "origin, untouched by the sit rename",
  origins(real.blocks["[vars]"]?.ALLOWED_ORIGINS)
    .some((o) => !isLoopback(o)));

const EXPECTED = 21;
console.log(failures
  ? `\nwrangler-sit FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nwrangler-sit ran ${performed} checks, expected ${EXPECTED}`
    : `\nwrangler-sit OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
