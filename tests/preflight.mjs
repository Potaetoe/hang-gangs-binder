/*
 * Stage zero of the 0.9 gate - the seam tests/run.mjs left empty. Its
 * own header says the shape: if this file exists it runs before any
 * arm, and a red here stops the gate with no arm run, because a
 * worktree with no node_modules or stale line endings reds every arm
 * for one buried cause and this file exists to name that cause once,
 * up front, instead.
 *
 * THREE PATHS (0.9-M0-S14, #300 - the fix for accounts going RED at
 * tip 95cb8b4). S7 (#287) built this file assuming every checkout
 * that reaches the gate is an agent worktree with `./run agent-init`
 * run in it first, which was true until CI started running the same
 * gate on a plain `actions/checkout`. A CI checkout is not an agent
 * worktree, and `tools/agent_init.py` is machine-held Windows tooling
 * whose initialization record lives under
 * `~/.claude/binder-fleet/worktrees/` on the machine that ran it - a
 * path a GitHub-hosted runner can never have written to, on any run,
 * ever. The old code treated "no record" as one case ("an agent
 * skipped init") and sent it down the --verify refusal every time,
 * which is correct for a forgetful agent and structurally wrong for
 * every CI run there will ever be: the door check was blind to a
 * whole class of caller. Path 2 below is the fix - it does not weaken
 * the door, it teaches it to recognize the runner as a different kind
 * of caller and hold it to a measured standard instead of an
 * impossible one.
 *
 *   1. RECORD EXISTS -> verify via `agent-init --verify`, unchanged.
 *      This is the agent-worktree contract S5/S7 built and it still
 *      applies exactly as before: same interpreter search, same
 *      --verify call, same success line, same remedy text.
 *   2. NO RECORD, and `CI` reads truthy -> measured truth, computed
 *      right here in plain Node: no Python, no path under
 *      `~/.claude/`, nothing that only exists on the machine that
 *      built this file. It re-derives the two things --verify would
 *      have checked, the ones a CI checkout can actually be wrong
 *      about (a stale record can never be the CI failure mode,
 *      because CI never has one):
 *        (a) the eol scan - `git ls-files --eol`, read directly
 *            rather than through agent_init.py's eol_problems(), for
 *            any working-tree state that violates a `.gitattributes`
 *            `eol=` pin. This is the disease the initialization
 *            record exists to certify against on a machine that
 *            reuses worktrees; on a fresh CI clone it can only mean
 *            the pin is violated in the COMMIT, which is a real
 *            defect worth a red.
 *        (b) the dependency probe - `node_modules/.bin/eslint`
 *            resolves. This is `./run bootstrap`'s own probe (see
 *            `run`'s bootstrap case), reused here as the measured
 *            stand-in for agent-init's dependency check, because it
 *            is the exact binary the gate's lint stage needs and
 *            already the project's answer to "did the install run".
 *      Green prints a line starting `initialized: CI path` so a log
 *      reader can tell at a glance which of the two ways this gate
 *      got past stage zero - see the vacuity guard in tests/run.mjs,
 *      which was widened in the same slice to recognize this second
 *      literal alongside path 1's `initialized: contract `. Red names
 *      exactly which file or probe failed; there is no remedy that
 *      says "run agent-init" here, because that verb cannot run on
 *      this machine by construction - the fix a CI red points to is
 *      always in the commit or the install step, never in the
 *      worktree.
 *   3. NO RECORD, and `CI` does not read truthy -> the existing
 *      refusal and remedy, unchanged: the same interpreter search,
 *      the same --verify call, the same "no initialization record"
 *      message an agent that skipped `./run agent-init` has always
 *      seen.
 *
 * The routing question ("does a record exist for this checkout") is
 * answered in plain Node before any Python is invoked, by re-deriving
 * `tools/agent_init.py`'s own `record_path()` (state_dir(), then
 * `<basename>-<sha1(abspath)[:8]>.json` under `worktrees/`) rather
 * than shelling out to ask it - the sole purpose of that
 * re-derivation is ROUTING (record present, so hand off to Python; or
 * absent, so choose between paths 2 and 3), never a substitute for
 * what --verify itself checks once a record is found. Paths 1 and 3
 * still call Python and still trust its answer completely; only the
 * "which path do I even take" decision moved out of Python's hands,
 * because that decision needed to be answerable on a machine that has
 * no Python opinion worth trusting about CI at all.
 *
 * WHAT PATH 1 CONSUMES, AND WHY (unchanged from S7). 0.9-M0-S5 (#283)
 * built the detection and named two entry points to it in
 * tools/agent_init.py's own comments: initialization_problems(repo,
 * state) - whose docstring calls itself "THE CALLABLE THE GATE'S
 * FIRST STAGE CONSUMES" - and the exit status of
 * `./run agent-init --verify`, which is that same function under the
 * CLI do_init() already built and tested around it. This file calls
 * `--verify` rather than importing the function directly: reaching
 * Python from Node means spawning an interpreter either way, so the
 * choice is between reusing do_init()'s --verify branch (the remedy
 * text and the exit-code contract, already the documented surface) or
 * writing a second Python entry point here that reimplements it with
 * nothing to keep the two in sync. `git add --renormalize` is the CLI
 * verb the field evidence names when a fixable file needs one;
 * --verify already speaks in that vocabulary where a new wrapper
 * would just be another paraphrase of it.
 *
 * `--verify` mutates nothing, by its own docstring - it reads a JSON
 * initialization record and runs one `git ls-files --eol` and
 * answers. That is what makes it ATTRIBUTE-BASED rather than
 * stage-inferred: it reads the end-of-line state the .gitattributes
 * pins declare, directly, for every pinned file in the tree, rather
 * than waiting to see which gate stage trips over a stale one first.
 * The field evidence on #287 is exactly the gap a stage-inferred
 * check has: two of the five files the stale-worktree trap can leave
 * wrong are under dev/, and no stage compares them byte-for-byte, so
 * they sit damaged and silent under any check keyed to "which stage
 * failed." Reading the attribute state finds all five the same way,
 * because it never asks a stage anything. Path 2 reads the same
 * attribute state the same way, in Node instead of Python, for
 * exactly the same reason.
 *
 * The interpreter search below (paths 1 and 3 only) is ./run's
 * search, for ./run's reason, and tests/worktree-contract.test.mjs's
 * reason too: bare `python` on the owner's machine is a Microsoft
 * Store stub that exits nonzero on --version, and a Linux runner has
 * only python3. A missing interpreter is a red, never a silent pass -
 * the gate cannot tell "the worktree is fine" from "nothing checked,"
 * so it is not allowed to guess which one this is. Path 2 needs no
 * interpreter search because it needs no interpreter: that is the
 * entire point of measuring in plain Node on the runner.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";

const script = fileURLToPath(new URL("../tools/agent_init.py",
                                      import.meta.url));
const REPO = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/* Mirrors tools/agent_init.py's state_dir() / records_dir() /
   record_path() exactly - same override variable, same join order,
   same digest - because this answer has to name the identical file
   --verify would have read, or "no record" here could just mean "this
   file computed a different path than Python would have," which is a
   bug pretending to be a CI finding. Verified byte-for-byte against
   the Python originals for this worktree before landing (see the
   ship record). */
function recordPath() {
  const override = process.env.BINDER_FLEET_STATE;
  const state = override ? path.resolve(override)
    : path.join(homedir(), ".claude", "binder-fleet");
  const digest = createHash("sha1").update(REPO, "utf-8")
    .digest("hex").slice(0, 8);
  return path.join(state, "worktrees",
    path.basename(REPO) + "-" + digest + ".json");
}

/* "Truthy" the way every CI provider actually sets it: GitHub Actions
   writes CI=true, but the bar is "present and not explicitly false,"
   not "equals the literal string true" - a provider that writes CI=1
   is still CI. */
function ciTruthy() {
  const value = process.env.CI;
  if (!value) return false;
  const normal = value.trim().toLowerCase();
  return normal !== "" && normal !== "0" && normal !== "false";
}

/* Path 2, part (a): the same attribute-based eol read --verify does,
   without Python. `git ls-files --eol -z` is the source of truth this
   whole check descends from; -z (NUL-separated) is what the Python
   original uses too, for the reason it always is - a path can hold a
   tab or a newline and this format never has to guess where a record
   ends. */
const EOL_LINE = /^i\/(\S+)\s+w\/(\S+)\s+attr\/(.*?)\s*\t(.*)$/s;
const DECLARED = ["eol=lf", "eol=crlf"];

function declaredEol(attrs) {
  for (const value of DECLARED) {
    if (attrs.includes(value)) return value.split("=")[1];
  }
  return null;
}

/* Returns { ok, detail } - detail is either the violation list (ok:
   false) or null (ok: true), and a third shape, { ok: false, detail:
   <git failure text> }, for the case git itself could not answer. */
function eolScan() {
  const done = spawnSync("git", ["ls-files", "--eol", "-z"],
    { cwd: REPO, encoding: "utf-8" });
  if (done.status !== 0) {
    return { ok: false, gitFailed: true,
      detail: (done.stderr || done.error?.message ||
        "git ls-files --eol exited " + done.status).trim() };
  }
  const violations = [];
  for (const record of done.stdout.split("\0")) {
    if (!record.trim()) continue;
    const match = EOL_LINE.exec(record);
    if (!match) continue;
    const [, indexEol, workEol, attrs, filePath] = match;
    const declared = declaredEol(attrs);
    if (declared === null) continue;
    // An empty file, or one with no line break in it at all, has no
    // end-of-line form to be wrong about.
    if (workEol === "none") continue;
    if (workEol === "-text") {
      violations.push(filePath + " (declared text, reads as binary)");
      continue;
    }
    // Every text pin stores LF in the index, eol=crlf included: the
    // attribute describes the CHECKOUT, not the object. So anything
    // other than LF in the index is a defect committed into the repo,
    // not a checkout artifact - the same distinction eol_problems()
    // draws in tools/agent_init.py.
    if (indexEol !== "lf" && indexEol !== "none") {
      violations.push(filePath + " (index holds " + indexEol +
        " under an eol=" + declared + " pin)");
      continue;
    }
    if (workEol !== declared) {
      violations.push(filePath + " (working tree is " + workEol +
        ", pin declares eol=" + declared + ")");
    }
  }
  return { ok: violations.length === 0, gitFailed: false,
    detail: violations.length ? violations : null };
}

/* Path 2, part (b): ./run's own bootstrap probe (see the `bootstrap`
   case in `run`), reused rather than re-invented - it is already the
   exact binary the gate's lint stage needs and the project's existing
   answer to "did the dependency install run." */
function eslintPresent() {
  return existsSync(path.join(REPO, "node_modules", ".bin", "eslint"));
}

function measuredTruth() {
  const problems = [];
  const eol = eolScan();
  if (eol.gitFailed) {
    problems.push("git ls-files --eol could not be read on this " +
      "checkout: " + eol.detail);
  } else if (!eol.ok) {
    const shown = eol.detail.slice(0, 5).join(", ");
    const more = eol.detail.length > 5
      ? ", and " + (eol.detail.length - 5) + " more" : "";
    problems.push(eol.detail.length + " file(s) violate their eol= " +
      "pin on this checkout - " + shown + more + ". No initialization " +
      "record can exist on a CI runner (agent-init is machine-held " +
      "Windows tooling), so this is measured directly from `git " +
      "ls-files --eol`; the fix is in the commit, not the worktree - " +
      "renormalize and push again.");
  }
  if (!eslintPresent()) {
    problems.push("node_modules/.bin/eslint is not present on this " +
      "checkout, so the gate's lint stage will fail before it starts. " +
      "No initialization record can exist on a CI runner, so this is " +
      "the bootstrap probe (`npm ci`, the same one `./run bootstrap` " +
      "runs) checked directly; confirm the install step ran before " +
      "this one.");
  }
  if (problems.length) {
    console.error(problems.join("\n\n"));
    process.exit(1);
  }
  // The last line printed on the success path, and the one
  // tests/run.mjs's vacuity guard looks for: it must start with
  // "initialized: CI path" so a log reader (and the guard) can tell
  // this ran the measured-truth path rather than --verify's record
  // path, which starts "initialized: contract " instead.
  console.log("initialized: CI path (no init record) - eol clean, " +
    "eslint present");
  process.exit(0);
}

if (!existsSync(recordPath()) && ciTruthy()) {
  measuredTruth();
}

for (const [exe, flags] of [["py", ["-3"]], ["python3", []],
                            ["python", []]]) {
  if (spawnSync(exe, [...flags, "--version"], { stdio: "ignore" })
      .status !== 0) {
    continue;
  }
  const done = spawnSync(exe, [...flags, script, "init", "--verify"],
                         { stdio: "inherit" });
  process.exit(done.status === null ? 1 : done.status);
}

console.error("No working Python found, so preflight could not check " +
              "whether this worktree is initialized. Install one from " +
              "python.org or enable the py launcher, then run " +
              "`./run agent-init` (PowerShell: `.\\run agent-init`).");
process.exit(1);
