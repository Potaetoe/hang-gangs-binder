/*
 * OPERATIONS.md, "Rotating sit's bot token", is the step-by-step for
 * regenerating sit's TELEGRAM_BOT_TOKEN in place (0.9-M1-S8, #337) - the
 * same-bot case DESIGN.md's "The bot is temporary" #4 assigns to 0.9-M1
 * and "When a credential may be compromised" step 2 names as its own
 * act. This arm is the S19 MAJOR3 class, same as
 * tests/operations-sit-procedure.test.mjs: reading the documented
 * command line as a string proves it is SHAPED like wrangler's real
 * interface, not that wrangler actually accepts it - so every distinct
 * command the section shows is run with `--help` against the real
 * `wrangler` on this machine (read-only, no Cloudflare auth, no network
 * write), and every flag the document uses is checked against what that
 * `--help` actually lists.
 *
 *     node tests/operations-bot-rotation.test.mjs
 *
 * A SECOND, NEW QUESTION this arm answers that operations-sit-
 * procedure.test.mjs does not need to: the ticket's own split-by-actor
 * rule (owner ruling 2026-08-18) - BotFather and typing the token value
 * are the owner's alone, everything else is Claude's or an operator's
 * to run. The section tags every numbered step with which lane it is in
 * ("(owner only)" or "(Claude or an operator)"); this arm reads those
 * tags back rather than trusting prose that could drift from the rule
 * it states, and pins WHICH steps land in which lane so a future edit
 * that quietly moves the secret-typing step out of the owner lane reds
 * here instead of only reading fine on its next skim.
 *
 * WHAT THIS CANNOT CATCH: that the commands, run for real against a
 * real account, do what the surrounding prose claims - `--help` proves
 * the shape of the interface, never its effect, the same limit
 * operations-sit-procedure.test.mjs's own header names. This arm makes
 * no cloud write and runs no `wrangler` subcommand other than `--help`.
 */
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OPERATIONS = ROOT + "OPERATIONS.md";
const WRANGLER = ROOT + "server/wrangler.toml";
const HEADING = "## Rotating sit's bot token";

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* The section: from its own heading to the next "## " heading - matches
   operations-sit-procedure.test.mjs's own section(), so a section that
   grows keeps being covered without a hand-counted line number. */
function section(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.indexOf(heading);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

/* Every fenced ```bash block in a section, each line trimmed and blank
   lines dropped. CRLF-normalized first, same gap
   operations-sit-procedure.test.mjs's own header names. */
function bashLines(rawText) {
  const text = rawText.replace(/\r\n/g, "\n");
  const blocks = [...text.matchAll(/```bash\n([\s\S]*?)```/g)]
    .map((m) => m[1]);
  return blocks.flatMap((block) =>
    block.split("\n").map((l) => l.trim()).filter(Boolean));
}

/* wrangler's two-level subcommands (secret <x>) versus its one-level
   ones. Hand-named, same reasoning operations-sit-procedure.test.mjs
   gives: the set this document's procedures use is small and a person
   adding a new one also reads this file. */
const TWO_LEVEL = new Set(["d1", "secret"]);

/* {path: ["secret", "put"], positionals: [...], flags: [{name, value}]}
   or null if the line is not an `npx wrangler ...` invocation. Unlike
   operations-sit-procedure.test.mjs's parser, this one keeps each
   flag's VALUE too (not just its name) - this section's own claim is
   that both commands are scoped to `--env sit` specifically, not merely
   that they carry *an* --env, so the check needs the value. */
function parseCommand(line) {
  const tokens = line.split(/\s+/);
  if (tokens[0] !== "npx" || tokens[1] !== "wrangler") return null;
  const rest = tokens.slice(2);
  const pathLen = TWO_LEVEL.has(rest[0]) ? 2 : 1;
  const path = rest.slice(0, pathLen);
  const positionals = [];
  const flags = [];
  for (let i = pathLen; i < rest.length; i += 1) {
    const token = rest[i];
    if (token.startsWith("-")) {
      const eq = token.indexOf("=");
      if (eq >= 0) {
        flags.push({ name: token.slice(0, eq), value: token.slice(eq + 1) });
      } else if (i + 1 < rest.length && !rest[i + 1].startsWith("-")) {
        flags.push({ name: token, value: rest[i + 1] });
        i += 1;
      } else {
        flags.push({ name: token, value: null });
      }
    } else {
      positionals.push(token);
    }
  }
  return { path, positionals, flags };
}

/* wrangler's own --help, cached per subcommand path. */
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

function recognizedFlags(helpText) {
  const flags = new Set();
  for (const m of helpText.matchAll(/(?:^|\s)(-\w|--[\w-]+)\b/gm)) {
    flags.add(m[1]);
  }
  return flags;
}

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
  "invocation", commands.every((c) => c !== null));

/* The order the procedure's own numbered steps state: set the new
   value first (step 3), then confirm its name landed (step 4). */
const pathSequence = commands.filter(Boolean).map((c) => c.path.join(" "));
const firstOfEach = [];
for (const path of pathSequence) {
  if (firstOfEach.at(-1) !== path) firstOfEach.push(path);
}
check("the steps run in the procedure's own order: secret put, then " +
  "secret list" +
  (JSON.stringify(firstOfEach) === JSON.stringify(["secret put", "secret list"])
    ? "" : " - got " + firstOfEach.join(" -> ")),
  JSON.stringify(firstOfEach) === JSON.stringify(["secret put", "secret list"]));

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
  const usedFlagNames = [...new Set(
    cmdsOnPath.flatMap((c) => c.flags.map((f) => f.name)))];
  const unknown = usedFlagNames.filter((f) => !recognized.has(f));
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

/* Both commands are scoped to --env sit specifically - the whole point
   of this section being about sit and not production. A command that
   drifted to --env production, or dropped --env entirely, reds here
   even though it would still pass the generic flag-recognition check
   above (the flag NAME is still valid; only the VALUE would be wrong). */
check("every documented command carries --env sit, not some other " +
  "environment or none at all",
  commands.every((c) => c && c.flags.some(
    (f) => (f.name === "--env" || f.name === "-e") && f.value === "sit")));

/* No documented command line carries a bot-token- or UUID-shaped value -
   same boundary and same shapes operations-sit-procedure.test.mjs
   checks, since a rotation procedure is exactly the place a real value
   would be tempting to paste "for clarity". */
const BOT_TOKEN_SHAPED = /\d+:[A-Za-z0-9_-]{20,}/;
const UUID_SHAPED = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
check("no documented command line carries a bot-token- or UUID-shaped " +
  "value",
  !lines.some((l) => BOT_TOKEN_SHAPED.test(l) || UUID_SHAPED.test(l)));

/* The secret this procedure names, TELEGRAM_BOT_TOKEN, is derived from
   the `secret put` command itself and checked against sit's real
   secret roster in server/wrangler.toml - not hand-copied here, so a
   future rename in one file and not the other reds instead of drifting
   silently, same cross-file discipline
   operations-sit-procedure.test.mjs already applies to the full roster. */
const putCommand = commands.find((c) => c && c.path.join(" ") === "secret put");
const namedSecret = putCommand ? putCommand.positionals[0] : null;
const rosterMatch = wranglerToml.match(
  /SIT WORKER CARRIES[\s\S]*?\n#\n((?:#\s+[A-Z_]+[\s\S]*?\n)+)#\n# DELIBERATELY ABSENT/);
const rosterNames = rosterMatch
  ? [...rosterMatch[1].matchAll(/^#\s+([A-Z_]+)\s/gm)].map((m) => m[1])
  : [];
check("the secret this procedure rotates is one server/wrangler.toml's " +
  "own [env.sit] roster actually names" +
  (namedSecret ? " (" + namedSecret + ")" : " - no `secret put` line found"),
  rosterNames.length > 0 && rosterNames.includes(namedSecret));

/* THE SPLIT-BY-ACTOR RULE (owner ruling 2026-08-18, this ticket's own
   key rule): every numbered step in the section is tagged with which
   lane runs it, and BotFather plus typing the token value are the two
   steps pinned to the owner lane - read back from the section's own
   text rather than assumed, so a rewrite that drops a tag, or moves the
   wrong step into the wrong lane, reds here. */
const OWNER_TAG = "(owner only)";
const REACHABLE_TAG = "(Claude or an operator)";
const stepLines = body
  ? body.split(/\r?\n/).filter((line) => /^\d+\.\s+\*\*/.test(line))
  : [];
check("the section has exactly 5 numbered top-level steps" +
  (stepLines.length !== 5 ? " - found " + stepLines.length : ""),
  stepLines.length === 5);

const tags = stepLines.map((line) =>
  line.includes(OWNER_TAG) ? "owner"
    : line.includes(REACHABLE_TAG) ? "reachable"
      : "untagged");
check("every numbered step is tagged with exactly one of \"" + OWNER_TAG +
  "\" or \"" + REACHABLE_TAG + "\"" +
  (tags.includes("untagged") ? " - untagged step(s) present" : ""),
  !tags.includes("untagged"));

/* Which steps land where is the claim, not just that every step has
   SOME tag: step 2 (BotFather) and step 3 (typing the value at
   wrangler's prompt) are owner-only; steps 1, 4 and 5 (the probes and
   the name-only confirmation) are reachable. */
const EXPECTED_TAGS = ["reachable", "owner", "owner", "reachable", "reachable"];
check("the owner-only steps are exactly step 2 (BotFather) and step 3 " +
  "(typing the new value at wrangler's prompt), matching the ticket's " +
  "own split-by-actor rule" +
  (JSON.stringify(tags) === JSON.stringify(EXPECTED_TAGS) ? ""
    : " - got " + JSON.stringify(tags)),
  JSON.stringify(tags) === JSON.stringify(EXPECTED_TAGS));

/* The "What breaks, and for how long" subsection is the ticket's other
   named requirement - present, and naming the two facts the brief
   itself states: sign-in refuses during the gap, sessions already open
   are unaffected. */
const breaksHeading = "### What breaks, and for how long";
check("the section carries a \"" + breaksHeading + "\" subsection",
  body !== null && body.includes(breaksHeading));
check("the breaks subsection says sign-in is refused during the gap",
  body !== null && /sign-in attempt.{0,40}refused/i.test(body));
check("the breaks subsection says sessions already open are unaffected",
  body !== null && /[Ss]essions already open are unaffected/.test(body));

const EXPECTED = 19;
console.log(failures
  ? `\noperations-bot-rotation FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\noperations-bot-rotation ran ${performed} checks, expected ${EXPECTED}`
    : `\noperations-bot-rotation OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
