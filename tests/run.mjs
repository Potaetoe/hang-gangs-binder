/*
 * The 0.9 gate. One entry point, and everything else here is an arm.
 *
 *     node tests/run.mjs
 *
 * Exit 0 is green, anything else is red. It is the whole apparatus:
 * there is no framework under this file, no assertion library, and
 * nothing for an arm to import. 0.9-M0-S4 (#281), built new under the
 * owner ruling on #228 - the old gate in tools/check.py guards the
 * surfaces that still exist and retires with them, and the two run
 * side by side until it has none left.
 *
 * ------------------------------------------------------------------
 * WRITING AN ARM
 *
 *   1. Put a file at tests/<name>.test.mjs. That is the declaration:
 *      the suffix is how this runner finds it and there is no list to
 *      add it to. `git add` is registration.
 *   2. Print what you checked, one line per check.
 *   3. Exit non-zero if anything was wrong. `process.exit(failures ?
 *      1 : 0)` at the bottom is the entire contract.
 *
 * Nothing else is required and nothing else is read. An arm is a
 * program this runner starts and grades by its exit code, so it may
 * import what it likes, spawn what it likes, and be written in any
 * shape its subject deserves - the three site-* arms that arrived
 * with this runner do exactly that and were adopted without an edit.
 *
 * DERIVE, DO NOT PIN. Read the spec, the config, or the shipped file
 * and compute what should be true; a hand-copied expected value is a
 * second copy of the fact, and it is the copy that goes stale. Where
 * a count IS the claim - "four pages carry the wordmark" - pin it and
 * say why in the arm, because subtraction is the failure a derived
 * count cannot see.
 *
 * ------------------------------------------------------------------
 * HOW A RED READS
 *
 * Each arm gets its own `node` process, so a red names the arm by
 * path, prints its exit code, and prints everything it wrote. Nothing
 * is summarized away and nothing is interpreted: an arm that throws
 * exits non-zero and is a red, never a skip, because the exit code is
 * the only thing consulted. On green the runner shows the arm's last
 * line - its own verdict - and drops the rest.
 *
 * Arms run one at a time. Not for speed: a suite that binds a socket
 * or writes a scratch directory is a suite this ordering lets stay
 * simple, and the old gate learned that with its demo stage.
 *
 * TWO WAYS TO GO GREEN WITHOUT CHECKING ANYTHING, both refused here.
 * Finding no arms is a red - a gate that passes because it swept an
 * empty directory is the armed-looking-but-not failure this project
 * holds to be worse than no gate. And ANY file under tests/ that is not
 * an arm, not this file and not the preflight below is a red too: under
 * discovery the way coverage disappears is a file that stops matching
 * the pattern, which is the same hole #204 found in the old hand list
 * from the other side.
 *
 * Any file, and the sweep is deliberately not itself a pattern. It
 * looked at *.mjs first, which left half of its own sentence open:
 * package.json says "type": "module", so tests/site-spec.test.js is a
 * live arm - it loads, it runs, it passes - that this gate never calls
 * again, and renaming one letter took forty-four checks out with every
 * remaining arm green and no warning printed. A guard that only
 * inspects the extension it is guarding cannot see a file leave by
 * changing its extension. The cost is that tests/ holds arms and the
 * two exemptions and nothing else: a fixture, a helper or a README
 * wanted here needs its own line in NOT_ARMS, added by whoever needs
 * it and argued for there, which is the point rather than the price.
 * Whether an arm ran ENOUGH is the arm's own job,
 * and the site-* three do it by pinning their check counts; this
 * runner counts arms and never their contents, because a total kept
 * here would be a hand-pinned expectation in the one file that exists
 * to argue against them.
 *
 * ------------------------------------------------------------------
 * RETIRING AN OLD ARM WITH ITS SURFACE - the M2/M3/M4 pattern, one
 * line, in the rebuild slice's own pull request:
 *
 *     delete dev/<x>.test.mjs AND its NODE_SUITES row in
 *     tools/check.py, in the same commit that lands
 *     tests/<x>.test.mjs over the rebuilt surface.
 *
 * Same commit is the whole of it: the new arm exists before the old
 * one is gone, so no window has neither. Half a retirement cannot
 * hide - check.py's roster_problems() reds on a row whose file is
 * missing and on a dev/*.test.mjs no row names - and this side needs
 * no bookkeeping at all, because the replacement is registered by
 * existing. The old runner's final removal is its own M4-era slice,
 * not something that falls out of the last retirement.
 *
 * THE FIRST STAGE IS A SEAM, and it is deliberately empty. If
 * tests/preflight.mjs exists it runs before any arm and a red stops
 * the gate there, arms unrun: 0.9-M0-S5 (#283) is building the
 * uninitialized-worktree detection that belongs in it, and the reason
 * it short-circuits is that a worktree with no node_modules reds
 * every arm for one cause and buries it. Absent, the gate runs and
 * says the stage is missing rather than passing over it in silence.
 * Adopting it means landing that path and nothing else; hardening the
 * absence into a red is S5's to make once the file is real.
 */
import { readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ARM_SUFFIX = ".test.mjs";
const PREFLIGHT = "tests/preflight.mjs";
const NOT_ARMS = new Set(["tests/run.mjs", PREFLIGHT]);

/* Repo-relative and forward-slashed, so a name reads the same in a
   Windows terminal and in the Actions log. */
const rel = (absolute) =>
  absolute.slice(ROOT.length).split("\\").join("/");

const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch (error) { return false; }
};

/* Every file under tests/, sorted, so the gate runs in one order
   everywhere and a diff of two logs is about the arms. Every file and
   not every .mjs: the arms are picked out of this list by suffix below,
   and everything left over is the stray sweep, which has to see the
   extensions it is not looking for or it cannot notice one leaving. */
async function everyFile(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = dir + entry.name;
    if (entry.isDirectory()) found.push(...await everyFile(path + "/"));
    else found.push(path);
  }
  return found.sort();
}

/* Start it, wait for it, and report what it did. The exit code is the
   verdict; the output is the evidence and is never parsed. */
function runFile(path) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", (error) => resolve({
      code: 1, output: "could not start it: " + error.message,
      ms: Date.now() - started,
    }));
    child.on("close", (code, signal) => resolve({
      // A signal is a death, not a pass. Without this an arm killed
      // for running long arrives with code null and reads as zero.
      code: code === null ? "signal " + signal : code,
      output, ms: Date.now() - started,
    }));
  });
}

const verdictLine = (output) => {
  const lines = output.split("\n").map((line) => line.trimEnd())
    .filter((line) => line !== "");
  return lines.length ? lines[lines.length - 1] : "(said nothing)";
};

const report = (name, ok, ms) =>
  console.log(name.padEnd(52) + (ok ? "ok" : "FAILED").padEnd(8) +
    (ms / 1000).toFixed(1) + "s");

function spill(name, result) {
  console.log("--- " + name + ", exit " + result.code + " " +
    "-".repeat(Math.max(3, 56 - name.length)));
  console.log(result.output.trimEnd() || "(it printed nothing)");
  console.log("-".repeat(60));
}

const problems = [];
console.log("the 0.9 gate - " + rel(HERE) + "\n");

/* Stage zero: the seam. */
if (await exists(ROOT + PREFLIGHT)) {
  const result = await runFile(ROOT + PREFLIGHT);
  report(PREFLIGHT, result.code === 0, result.ms);
  if (result.code !== 0) {
    spill(PREFLIGHT, result);
    console.log("\npreflight is red, so no arm ran. Fix that first.");
    process.exit(1);
  }
  console.log("    " + verdictLine(result.output));
} else {
  console.log("no preflight stage: " + PREFLIGHT + " is absent " +
    "(0.9-M0-S5, #283, is what lands it)");
}

/* Stage one onward: the arms. */
const files = await everyFile(HERE);
const arms = files.filter((path) => path.endsWith(ARM_SUFFIX));
const strays = files.filter((path) =>
  !path.endsWith(ARM_SUFFIX) && !NOT_ARMS.has(rel(path)));

console.log("");
for (const path of arms) {
  const name = rel(path);
  const result = await runFile(path);
  const ok = result.code === 0;
  report(name, ok, result.ms);
  if (ok) console.log("    " + verdictLine(result.output));
  else {
    spill(name, result);
    problems.push(name);
  }
}

console.log("=".repeat(60));

for (const path of strays) {
  const name = rel(path);
  problems.push(name);
  console.log(name + " is in tests/ and nothing runs it. Name it " +
    "*" + ARM_SUFFIX + " so the gate finds it, or take it out." +
    /* The near-miss is worth its own sentence, because it is the case
       that arrives looking like a tidy-up rather than a deletion. */
    (/\.test\.[^./]+$/.test(name)
      ? " One suffix from being an arm is how coverage leaves quietly:" +
        " a file this close still runs by hand and still passes."
      : ""));
}
if (arms.length === 0) {
  problems.push("no arms");
  console.log("no *" + ARM_SUFFIX + " under " + rel(HERE) + ". An empty " +
    "gate passes everything, so this is a failure.");
}

console.log(problems.length
  ? "\n" + arms.length + " arm(s), " + problems.length + " problem(s): " +
    problems.join(", ") + "\nNot safe to push."
  : "\n" + arms.length + " arm(s), all green.");
process.exit(problems.length ? 1 : 0);
