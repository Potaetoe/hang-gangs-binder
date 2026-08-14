/*
 * Both gates are wired into CI, and this workflow cannot publish past
 * them - the deploy job that once needed them retired on 0.9-M0-S6
 * (#286), and staying retired is what half of what follows now holds
 * the line on.
 *
 *     node tests/ci-wiring.test.mjs
 *
 * Subject: .github/workflows/deploy.yml (#281; the transition ruling on
 * #228 - "CI carries both worlds, the old gate shrinking, the new one
 * growing").
 *
 * WHY THIS ARM EXISTS AT ALL. GitHub Actions cannot be run here, so
 * 0.9-M0-S4 could not watch its own CI wiring work; the choice was
 * between asserting the workflow FILE and shipping the wiring on the
 * strength of having read it. This is the first, and the limit is worth
 * naming plainly: everything below is a claim about what the workflow
 * SAYS. That the runner it names then behaves as it does on a clean
 * ubuntu checkout is a claim only the first real run can settle.
 *
 * WHAT IT CANNOT CATCH, and the reason is a circle rather than an
 * oversight: this arm runs under tests/run.mjs, so deleting the step
 * that runs tests/run.mjs in CI also deletes the thing that would have
 * reported it. It still catches that deletion locally, and it catches
 * every neighboring edit - the old gate's step going away, a Pages
 * action, a retired write scope or the write-all shorthand that grants
 * it, a job-level contents:write grant, a wrangler/pages-deploy step,
 * a job key carrying a trailing comment, or a second workflow file
 * joining this one unregistered, a gate quietly made advisory with
 * continue-on-error (0.9-M0-S6 review, #286: F1-F4 named the gaps in
 * this paragraph's first draft; this is the trued version, naming what
 * the checks below actually hold rather than "any write scope
 * anywhere," which they do not and cannot - GitHub Actions has scopes
 * this file has no reason to ever mention). The uncatchable case is
 * one commit that removes the new gate from CI entirely, and what
 * answers that is a human reading the diff of a workflow file, which
 * is the same thing that has always answered it.
 *
 * The YAML is read structurally rather than grepped whole. A substring
 * search for "node tests/run.mjs" passes on a file where that string
 * sits in a comment, or in a step belonging to no job at all - and
 * "the gate runs somewhere in this file" is not the claim. The claim
 * is that it is THE step of the job the release needs: the only one
 * of its shape, and pointed at the runner rather than at something
 * else that would also start. Identifying *a* matching step was not
 * enough, and the checks below say why where they make the
 * distinction.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKFLOW_DIR = ".github/workflows/";
const WORKFLOW = WORKFLOW_DIR + "deploy.yml";

/* The registered set (0.9-M0-S6 review finding F3). Every check in this
   file below this line reads WORKFLOW - one path - so nothing here
   noticed a second file dropped into the same directory; the review's
   M7 proved it: a full Pages-publishing workflow next to this one,
   untouched, and the arm green. The retirement the owner ordered is
   repository-wide (0.9-M0-S6, #286); a file-wide invariant is not that.
   This is the pinned list of workflow files this repository is allowed
   to carry. A legitimate future workflow - M1's deploy job is written
   as its own file, or it is not - joins this array in the same change
   that adds the file to disk; the enumeration check below reds an
   addition that does not, sight-unseen, which is the point: coverage
   does not wait for someone to remember to write a new arm for it. */
const REGISTERED_WORKFLOWS = ["deploy.yml"];

/* The two gates are found by SHAPE, not by their command spelled out
   here. A gate is a step that runs an interpreter against an entry
   point in that world's directory, and which file that is comes back
   out of the workflow to be checked against the disk.

   Pinning the two command strings was the first draft and it was
   wrong twice over: renaming either entry point would have reddened
   this arm for a workflow that was correct and updated, and - the
   worse half - "the file the workflow names exists" degenerated into
   re-reading the constant this file had just declared, so a step
   pointing at a runner that had moved passed that check. Read the
   command, then go and look. */
const OLD_GATE = /python\s+(tools\/\S+\.py)/;
const NEW_GATE = /node\s+(tests\/\S+\.mjs)/;

/* The suffix an arm declares itself by. Pinned here rather than read
   out of the runner, because it is the convention this arm asserts and
   deriving it from the file under test would let the file redefine what
   it is being held to. */
const ARM_SUFFIX = ".test.mjs";

/* Retirement invariant (0.9-M0-S6, #286; widened by the #286 review's
   F1 and F4). The strings a Pages release took - the two actions that
   ship it, the write scope and the id token, the environment key that
   names it - are what re-adding a deploy job would bring back, whatever
   that job is called. Reading for the strings rather than for a job
   named "deploy" is the point: a publishing job under another name
   still reds.

   Two widenings past that original set, both from mutations the review
   put past it green. First, scope grants: `permissions: write-all` is
   GitHub Actions' shorthand for every scope at once, so it grants both
   retired scopes - `pages: write` and `id-token: write` - without
   spelling either, and the review's M4 walked it straight past the old
   set. `contents: write` is checked alongside it for a different
   reason: it is not one of the two retired scopes, but it is what a
   git-push-style publish needs instead of the Pages API (a `gh-pages`
   branch push via peaceiris/actions-gh-pages, the review's M8), so
   granting it back is the same breach in a different shape. Second,
   deploy-shaped steps: `wrangler deploy` and `wrangler pages deploy`
   are caught by command shape (the review's M6, a step added inside
   verify itself) because M1's own eventual deploy job runs exactly one
   of those - THIS IS THE UNLOCK PATH. When that job is written for
   real, it re-shapes this invariant deliberately, in the same change
   that adds it; until then, nothing here deploys, and a step of that
   shape appearing early is precisely what this line exists to catch. */
const PUBLISHES =
  /(configure-pages|upload-pages-artifact|deploy-pages|pages:\s*write|id-token:\s*write|permissions:\s*write-all|contents:\s*write|wrangler\s+(pages\s+)?deploy|^ {4}environment:)/;

const lines = (await readFile(ROOT + WORKFLOW, "utf8")).split(/\r?\n/);
const workflowFiles = (await readdir(ROOT + WORKFLOW_DIR)).sort();

const EXPECTED = 18;
let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* The block of lines belonging to one top-level job: from `  <name>:`
   down to the next line indented exactly two spaces, which is the next
   job. Everything deeper belongs to this one. */
function job(name) {
  const start = lines.findIndex((line) => line === "  " + name + ":");
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

/* The steps of a job, each one from its `      - ` to the next. Blank
   lines and comments are dropped first so a step's shape is not a
   question about how much prose sits above it. */
function steps(block) {
  const at = block.findIndex((line) => /^ {4}steps:/.test(line));
  if (at < 0) return [];
  const body = block.slice(at + 1)
    .filter((line) => line.trim() !== "" && !/^\s*#/.test(line));
  const out = [];
  for (const line of body) {
    if (/^ {6}- /.test(line)) out.push([line]);
    else if (out.length) out[out.length - 1].push(line);
  }
  return out;
}

/* One key out of one step. A step's keys sit at eight spaces, except
   the first, which wears the `- ` - so both shapes are read and a
   pattern that allowed only one would find every step's `run` missing
   and report a workflow with no gates in it at all.

   `run: |` puts the command on the following lines, so a block scalar
   is joined rather than read as empty - a parser that missed that
   would call every multi-line step's command blank and agree with
   anything. */
function field(step, key) {
  const at = step.findIndex((line) =>
    new RegExp("^ {6}(- |  )" + key + ":").test(line));
  if (at < 0) return null;
  const first = step[at].split(new RegExp(key + ":"))[1].trim();
  if (first !== "|" && first !== ">") return first;
  return step.slice(at + 1).map((line) => line.trim()).join("\n");
}

const runs = (step, pattern) => pattern.exec(field(step, "run") || "");

const verify = job("verify");
const verifySteps = steps(verify);

/* The top-level job names in the file, in one pass over `jobs:` rather
   than one `job()` call per candidate name - so this reads as "what
   jobs exist" rather than "does a job called X exist", which is the
   distinction retirement needs: a publishing job renamed away from
   "deploy" is still every job but verify.

   A job key line may carry a trailing comment - YAML accepts it, and a
   temporarily-restored job is exactly how one gets written, key and
   all (0.9-M0-S6 review finding F2: `  deploy:  # restored, remove
   before merge` walked straight past the old `\s*$` anchor and the job
   it introduced was invisible to every check below). The key line is
   matched with an optional comment tail rather than requiring the rest
   of the line to be blank, and the name itself is read out of the
   match rather than by trimming the trailing colon off the whole
   trimmed line - the second half matters on its own: with a comment
   present, "trim the last character off" cuts a character off the
   comment, not the colon. */
function jobNames() {
  const at = lines.findIndex((line) => line === "jobs:");
  if (at < 0) return [];
  return lines.slice(at + 1)
    .filter((line) => /^ {2}\S+:\s*(#.*)?$/.test(line))
    .map((line) => line.trim().match(/^(\S+):/)[1]);
}

/* 1. The file is shaped the way the rest of this arm assumes. Asserted
      rather than trusted: every check below reads a job block, and a
      parser that found nothing would pass them all vacuously. */
check("the workflow has a verify job with steps", verifySteps.length > 0);
check("and verify is the only job: nothing in this workflow deploys",
  jobNames().length === 1 && jobNames()[0] === "verify");
check("and .github/workflows/ holds exactly the registered set: no " +
  "second workflow publishes unseen",
  JSON.stringify(workflowFiles) ===
    JSON.stringify([...REGISTERED_WORKFLOWS].sort()));

/* 2. Each world is EXACTLY ONE step of the verify job.

      `find` was the first draft and it is the shape a gate hides
      behind. It takes the first step whose command matches, so any
      earlier step running `node tests/<anything>.mjs` becomes the step
      every check below is evaluated against, and the real gate is then
      never looked at - green, with the actual gate step carrying a
      `continue-on-error` nobody read. A debugging "run just this arm"
      step left behind in a workflow edit does it without anyone
      intending it, which is why this is not an adversarial case.

      So every step of the matching shape is collected, and more than
      one is a red that names them. Accounting for all of them is the
      point: an unexamined step of gate shape is exactly as bad as a
      missing one, because the log will show it running. */
const nameOf = (step) =>
  field(step, "name") || field(step, "run") || "(an unnamed step)";
const listing = (found) => found.map(nameOf).join(", ");

const oldSteps = verifySteps.filter((step) => runs(step, OLD_GATE));
const newSteps = verifySteps.filter((step) => runs(step, NEW_GATE));

check("the old gate runs as exactly one step of verify" +
  (oldSteps.length > 1 ? " - found " + listing(oldSteps) : ""),
  oldSteps.length === 1);
check("the 0.9 gate runs as exactly one step of verify" +
  (newSteps.length > 1 ? " - found " + listing(newSteps) : ""),
  newSteps.length === 1);

/* Nothing below may speak about "the" gate step unless there is one to
   speak about, so an ambiguous workflow reds the rest of this file
   rather than picking a candidate it can be right about. */
const oldStep = oldSteps.length === 1 ? oldSteps[0] : undefined;
const newStep = newSteps.length === 1 ? newSteps[0] : undefined;

check("they are two steps and not one",
  oldStep !== undefined && newStep !== undefined && oldStep !== newStep);

/* 3. A red says which world failed, which is what a step name is for
      on the Actions page. Distinct and non-empty, both asserted: two
      steps that run different commands under one name are a run whose
      failure the log has to be opened to explain. */
const oldName = oldStep ? field(oldStep, "name") : null;
const newName = newStep ? field(newStep, "name") : null;

check("the old gate's step is named", Boolean(oldName));
check("the new gate's step is named", Boolean(newName));
/* Both names asserted before they are compared. `oldName !== newName`
   is satisfied by a missing new step, whose name reads as null - the
   check would pass, in a run where there is no second step to name a
   world at all, and a check that passes hardest when its subject is
   absent is the shape this arm exists to refuse. */
check("the two names differ, so a red names its world",
  Boolean(oldName) && Boolean(newName) && oldName !== newName);

/* 4. Nothing here can publish, and neither gate is advisory - one
      check per way the file could quietly stop meaning what it says.

      PRESENCE is the test for both, not a value read out of either,
      each for its own reason.

      The publish check is the direct measurement of the retirement
      itself (0.9-M0-S6, #286): any of the strings PUBLISHES names,
      anywhere outside a comment, is what re-adding a deploy job (or a
      publishing job under any other name) would bring back. Comments
      are filtered first, so prose that NAMES what was retired - the
      header above does exactly that - stays free to without tripping
      its own check.

      For continue-on-error: comparing against the string "true" was
      the first draft, and it was wrong. `continue-on-error: True` and
      `continue-on-error: ${{ true }}` both walked past it, and Actions
      documents the key as taking an expression - so the set of
      spellings that make a gate advisory is open-ended and is not a
      set this file can enumerate. Whether any particular spelling is
      honored is also not something this machine can run, and failing
      closed is what stops that unknowable question from mattering. A
      blocking gate needs no spelling of this key at all, so the key
      itself is the red and deleting the line is the whole remedy. */
check("and nothing here can publish past them: no Pages action, no " +
  "write scope",
  !lines.filter((line) => !/^\s*#/.test(line))
    .some((line) => PUBLISHES.test(line)));
check("neither gate is advisory: no continue-on-error, in any spelling",
  [oldStep, newStep].every((step) =>
    step !== undefined && field(step, "continue-on-error") === null));

/* 5. The new gate's condition earns its keep and gives nothing away.
      It exists so a red old gate does not skip this step and hide the
      other world; it must not be always(), which would also run it on
      a cancelled job. Neither shape can make a failure pass - a step
      cannot un-fail a job - so what is checked here is that the
      condition is the one the comment above it claims. */
const condition = newStep ? field(newStep, "if") : null;
check("the new gate still runs after a red old gate",
  Boolean(condition) && condition.includes("!cancelled()"));
check("and not on a cancelled run",
  Boolean(condition) && !condition.includes("always()"));

/* 6. The step names the RUNNER, and it is really there, on the path CI
      will look for it on. A workflow that invokes a moved file is green
      in every review and red on the first push, and no amount of
      reading the YAML finds it - only going to the disk does.

      "it is a runner" was `runner.includes(".test.mjs")`, and every arm
      in tests/ satisfies that: each one carries the literal in its own
      usage line. A step pointing at tests/site-spec.test.mjs therefore
      passed, and CI would have run one arm's checks and never the
      runner, the other arms, or this file. A substring the subject is
      free to mention is not evidence about the subject.

      What replaces it is one fact about the path and three about the
      file. The path fact is decisive and is not a substring test at
      all: an arm is anything ending in the arm suffix, so a step naming
      an arm is refused for its NAME whatever its contents say. The
      three marks are the runner's structure - it declares the suffix it
      discovers by, it reads tests/ to find them, and it starts each one
      as its own process - and they are the parts an honest rename of
      the runner carries with it, so renaming the file and updating the
      workflow stays green.

      The limit, plainly: these are marks in the text of a file. They
      establish that it is SHAPED like the runner, never that it behaves
      like one, and nothing readable from a workflow could establish the
      second. What they close is every shape where the workflow names
      something that is plainly not the runner - which is the failure
      that was actually observed. */
const entry = newStep ? runs(newStep, NEW_GATE)[1] : null;
const runner = entry
  ? await readFile(ROOT + entry, "utf8").catch(() => null)
  : null;

check("the entry point the workflow names is really there",
  runner !== null);
check("and what it names is not itself an arm",
  Boolean(entry) && !entry.endsWith(ARM_SUFFIX));
check("it declares the arm suffix it discovers by",
  Boolean(runner) && /\bARM_SUFFIX\s*=\s*["'`]\.test\.mjs["'`]/.test(runner));
check("it reads tests/ to find them",
  Boolean(runner) && /\breaddir/.test(runner));
check("and it starts each arm as its own process",
  Boolean(runner) && /\bspawn\s*\(/.test(runner));

console.log(failures
  ? `\nci-wiring FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nci-wiring ran ${performed} checks, expected ${EXPECTED}`
    : `\nci-wiring OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
