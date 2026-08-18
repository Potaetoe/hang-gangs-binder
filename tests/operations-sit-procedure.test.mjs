/*
 * OPERATIONS.md, "Building the sit environment", is the sequence #282's
 * holder runs (0.9-M1-S1, #325). This arm is the S19 MAJOR3 class,
 * applied to wrangler instead of git: reading the documented command
 * line as a string proves it is SHAPED like wrangler's real interface;
 * it does not prove wrangler actually accepts it. So every distinct
 * command this document shows is run with `--help` against the real
 * `wrangler` on this machine (read-only, no Cloudflare auth, no
 * network write - the boundary this slice's own issue names: "wrangler
 * may be invoked read-only/offline only if a test needs its parser"),
 * and every flag the document uses is checked against what that `--help`
 * actually lists. A documented `--enviroment` typo, or a flag wrangler
 * renamed since this was written, reds here instead of on the day
 * #282's holder pastes it into a terminal.
 *
 *     node tests/operations-sit-procedure.test.mjs
 *
 * WHAT THIS CANNOT CATCH: that the commands, run for real against a
 * real account, do what the surrounding prose claims. `--help` proves
 * the shape of the interface, never its effect - the same limit
 * tools/session_open_suite.py's own header names for claim_vs_diff.py.
 * Boundary carried from #325 itself: this arm makes no cloud write and
 * runs no `wrangler` subcommand other than `--help`.
 */
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OPERATIONS = ROOT + "OPERATIONS.md";
const WRANGLER = ROOT + "server/wrangler.toml";
const HEADING = "## Building the sit environment";

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* The section: from its own heading to the next "## " heading, matching
   ci-wiring.test.mjs's job() - read until the next thing at the same
   level, not to a hand-counted line number that would silently stop
   covering the tail of a section somebody extends. */
function section(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.indexOf(heading);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

/* Every fenced ```bash block in a section, each line trimmed and blank
   lines dropped - the commands as a reader would actually type them. */
function bashLines(text) {
  const blocks = [...text.matchAll(/```bash\n([\s\S]*?)```/g)]
    .map((m) => m[1]);
  return blocks.flatMap((block) =>
    block.split("\n").map((l) => l.trim()).filter(Boolean));
}

/* wrangler's two-level subcommands (d1 <x>, secret <x>) versus its
   one-level ones (deploy). Hand-named rather than derived, because the
   set of two-level top commands this repository's procedure uses is
   exactly two and will not silently grow without a person adding a
   line to a procedure a person also reads. */
const TWO_LEVEL = new Set(["d1", "secret"]);

/* {path: ["d1", "execute"], positionals: [...], flags: [{name, value}]}
   or null if the line is not an `npx wrangler ...` invocation. Split on
   whitespace only - every command in this document's procedure is
   simple enough that no token needs quoting, and a future line that
   did would want its own parser, not a silently-wrong split here. */
function parseCommand(line) {
  const tokens = line.split(/\s+/);
  if (tokens[0] !== "npx" || tokens[1] !== "wrangler") return null;
  const rest = tokens.slice(2);
  const pathLen = TWO_LEVEL.has(rest[0]) ? 2 : 1;
  const path = rest.slice(0, pathLen);
  const positionals = [];
  const flags = [];
  for (const token of rest.slice(pathLen)) {
    if (token.startsWith("-")) {
      const eq = token.indexOf("=");
      flags.push(eq < 0 ? token : token.slice(0, eq));
    } else {
      positionals.push(token);
    }
  }
  return { path, positionals, flags };
}

/* wrangler's own --help, cached per subcommand path so four documented
   lines that share "d1 execute" spawn it once rather than four times. */
const helpCache = new Map();
function wranglerHelp(path) {
  const key = path.join(" ");
  if (helpCache.has(key)) return helpCache.get(key);
  const result = spawnSync("npx", ["wrangler", ...path, "--help"],
    { cwd: ROOT + "server", encoding: "utf8", shell: true });
  const text = (result.stdout || "") + (result.stderr || "");
  helpCache.set(key, { text, ok: result.status === 0 });
  return helpCache.get(key);
}

/* Every -x and --xxx wrangler's own --help lists for this subcommand -
   read out of its GLOBAL FLAGS and OPTIONS sections together, since a
   documented command may legitimately use either. */
function recognizedFlags(helpText) {
  const flags = new Set();
  for (const m of helpText.matchAll(/(?:^|\s)(-\w|--[\w-]+)\b/gm)) {
    flags.add(m[1]);
  }
  return flags;
}

/* wrangler prints the positional's own name and whether it is
   [required] in its usage/POSITIONALS block - "database  The name or
   binding of the DB  [string] [required]". Counting required
   positionals this way, rather than pinning a number per subcommand
   here, is what makes this DERIVE rather than PIN: if wrangler ever
   makes a positional optional, this reads that from --help instead of
   arguing with a stale expectation. */
function requiredPositionalCount(helpText) {
  return [...helpText.matchAll(/^\s+\S+.*\[required\]\s*$/gm)].length;
}

const markdown = await readFile(OPERATIONS, "utf8");
const wranglerToml = await readFile(WRANGLER, "utf8");

const body = section(markdown, HEADING);
check("OPERATIONS.md carries a \"" + HEADING + "\" section", body !== null);

const lines = body ? bashLines(body) : [];
check("the section carries at least one fenced ```bash command " +
  "(a present-but-empty section would pass every check below " +
  "vacuously otherwise)", lines.length > 0);

const commands = lines.map(parseCommand);
check("every command line in the section is an `npx wrangler ...` " +
  "invocation - nothing hand-runs a bare wrangler, a curl or anything " +
  "else that would not benefit from this arm's own --help check",
  commands.every((c) => c !== null));

/* The exact order the ticket names: d1 create, schema apply, deploy,
   then the secret put list. Read as subcommand PATHS so a flag
   reordering (dry-run before or after --env) does not fail an order
   check that is about which THING happens first. */
const pathSequence = commands.filter(Boolean).map((c) => c.path.join(" "));
const firstOfEach = [];
for (const path of pathSequence) {
  if (firstOfEach.at(-1) !== path) firstOfEach.push(path);
}
check("the steps run in the ticket's own order: d1 create, then d1 " +
  "execute (schema), then deploy, then secret put" +
  (JSON.stringify(firstOfEach) === JSON.stringify(
    ["d1 create", "d1 execute", "deploy", "secret put"]) ? "" :
    " - got " + firstOfEach.join(" -> ")),
  JSON.stringify(firstOfEach) === JSON.stringify(
    ["d1 create", "d1 execute", "deploy", "secret put"]));

/* Every distinct subcommand path, checked against wrangler's real
   --help exactly once each - the MAJOR3 class itself. */
const distinctPaths = [...new Set(pathSequence)];
for (const path of distinctPaths) {
  const cmdsOnPath = commands.filter((c) => c && c.path.join(" ") === path);
  const help = wranglerHelp(path.split(" "));
  check("`wrangler " + path + " --help` runs (offline, no Cloudflare " +
    "auth needed for --help)", help.ok);
  if (!help.ok) continue;

  const recognized = recognizedFlags(help.text);
  const usedFlags = [...new Set(cmdsOnPath.flatMap((c) => c.flags))];
  const unknown = usedFlags.filter((f) => !recognized.has(f));
  check("every flag OPERATIONS.md's `wrangler " + path + "` line(s) use " +
    "is one `--help` actually lists" +
    (unknown.length ? " - unrecognized: " + unknown.join(", ") : ""),
    unknown.length === 0);

  const need = requiredPositionalCount(help.text);
  const have = Math.min(...cmdsOnPath.map((c) => c.positionals.length));
  check("`wrangler " + path + "` gets at least the " + need +
    " positional argument(s) --help marks [required]",
    have >= need);
}

/* Nothing that looks like a real secret VALUE appears in any documented
   command line - the boundary this section's own prose states ("No
   token, id ... is typed into this repository"). Shape-matched rather
   than length-matched: a length rule alone flags TELEGRAM_GROUP_CHAT_ID
   (22 characters, a symbolic secret NAME every command is expected to
   carry) as if it were a value. What a real value looks like here is
   narrower - a Telegram bot token (digits, a colon, then a long
   mixed-case run) or a UUID (server/wrangler.toml's own database_id
   shape) - and neither belongs in a command line this document ships,
   since every value-taking command in this procedure prompts instead. */
const BOT_TOKEN_SHAPED = /\d+:[A-Za-z0-9_-]{20,}/;
const UUID_SHAPED = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
check("no documented command line carries a bot-token- or UUID-shaped " +
  "value",
  !lines.some((l) => BOT_TOKEN_SHAPED.test(l) || UUID_SHAPED.test(l)));

/* Cross-file consistency, derived rather than pinned: the four secrets
   this procedure sets are exactly the four server/wrangler.toml's own
   [env.sit] comment names as sit's roster, in the same order - so a
   roster edited in one file and not the other reds here instead of
   silently drifting. */
const putOrder = commands.filter((c) => c && c.path.join(" ") === "secret put")
  .map((c) => c.positionals[0]);
const rosterMatch = wranglerToml.match(
  /SIT WORKER CARRIES[\s\S]*?\n#\n((?:#\s+[A-Z_]+[\s\S]*?\n)+)#\n# DELIBERATELY ABSENT/);
const rosterOrder = rosterMatch
  ? [...rosterMatch[1].matchAll(/^#\s+([A-Z_]+)\s/gm)].map((m) => m[1])
  : [];
check("the secret put order matches server/wrangler.toml's own [env.sit] " +
  "roster order" +
  (JSON.stringify(putOrder) === JSON.stringify(rosterOrder) ? "" :
    " - procedure has " + JSON.stringify(putOrder) + ", wrangler.toml has " +
    JSON.stringify(rosterOrder)),
  rosterOrder.length > 0 && JSON.stringify(putOrder) === JSON.stringify(rosterOrder));

const EXPECTED = 18;
console.log(failures
  ? `\noperations-sit-procedure FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\noperations-sit-procedure ran ${performed} checks, expected ${EXPECTED}`
    : `\noperations-sit-procedure OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
