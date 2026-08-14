/*
 * Both gates are wired into CI, and a release cannot pass either one.
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
 * every neighboring edit - the old gate's step going away, the deploy
 * job losing the `needs` that makes either gate block, a gate quietly
 * made advisory with continue-on-error. The uncatchable case is one
 * commit that removes the new gate from CI entirely, and what answers
 * that is a human reading the diff of a workflow file, which is the
 * same thing that has always answered it.
 *
 * The YAML is read structurally rather than grepped whole. A substring
 * search for "node tests/run.mjs" passes on a file where that string
 * sits in the deploy job, in a comment, or in a step belonging to no
 * job at all - and "the gate runs somewhere in this file" is not the
 * claim. The claim is that it is a step of the job the release needs.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKFLOW = ".github/workflows/deploy.yml";

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

const lines = (await readFile(ROOT + WORKFLOW, "utf8")).split(/\r?\n/);

const EXPECTED = 14;
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
const deploy = job("deploy");
const verifySteps = steps(verify);

/* 1. The file is shaped the way the rest of this arm assumes. Asserted
      rather than trusted: every check below reads a job block, and a
      parser that found nothing would pass them all vacuously. */
check("the workflow has a verify job with steps", verifySteps.length > 0);
check("the workflow has a deploy job", deploy.length > 0);

/* 2. Both worlds are steps of the verify job. */
const oldStep = verifySteps.find((step) => runs(step, OLD_GATE));
const newStep = verifySteps.find((step) => runs(step, NEW_GATE));

check("the old gate runs as a step of verify", oldStep !== undefined);
check("the new gate runs as a step of verify", newStep !== undefined);
check("they are two steps and not one", oldStep !== newStep);

/* 3. A red says which world failed, which is what a step name is for
      on the Actions page. Distinct and non-empty, both asserted: two
      steps that run different commands under one name are a run whose
      failure the log has to be opened to explain. */
const oldName = oldStep ? field(oldStep, "name") : null;
const newName = newStep ? field(newStep, "name") : null;

check("the old gate's step is named", Boolean(oldName));
check("the new gate's step is named", Boolean(newName));
check("the two names differ, so a red names its world",
  Boolean(oldName) && oldName !== newName);

/* 4. Both block. `needs` is what makes the release wait on the verify
      job at all, and continue-on-error is the one line that would let
      a gate go red without failing it. */
check("the release needs the job both gates run in",
  deploy.some((line) => /^ {4}needs:.*\bverify\b/.test(line)));
check("neither gate is advisory",
  [oldStep, newStep].every((step) =>
    step && field(step, "continue-on-error") !== "true"));

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

/* 6. The step names a runner that is really there, on the path CI will
      look for it on. A workflow that invokes a moved file is green in
      every review and red on the first push, and no amount of reading
      the YAML finds it - only going to the disk does. */
const named = newStep ? runs(newStep, NEW_GATE)[1] : null;
const runner = named
  ? await readFile(ROOT + named, "utf8").catch(() => null)
  : null;

check("the entry point the workflow names is really there",
  runner !== null);
check("and it is a runner: it discovers arms by their suffix",
  Boolean(runner) && runner.includes(".test.mjs"));

console.log(failures
  ? `\nci-wiring FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nci-wiring ran ${performed} checks, expected ${EXPECTED}`
    : `\nci-wiring OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
