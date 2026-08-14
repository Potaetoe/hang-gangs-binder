/*
 * Stage zero of the 0.9 gate - the seam tests/run.mjs left empty. Its
 * own header says the shape: if this file exists it runs before any
 * arm, and a red here stops the gate with no arm run, because a
 * worktree with no node_modules or stale line endings reds every arm
 * for one buried cause and this file exists to name that cause once,
 * up front, instead.
 *
 * WHAT THIS CONSUMES, AND WHY. 0.9-M0-S5 (#283) built the detection
 * and named two entry points to it in tools/agent_init.py's own
 * comments: initialization_problems(repo, state) - whose docstring
 * calls itself "THE CALLABLE THE GATE'S FIRST STAGE CONSUMES" - and
 * the exit status of `./run agent-init --verify`, which is that same
 * function under the CLI do_init() already built and tested around
 * it. This file calls `--verify` rather than importing the function
 * directly: reaching Python from Node means spawning an interpreter
 * either way, so the choice is between reusing do_init()'s --verify
 * branch (the remedy text and the exit-code contract, already the
 * documented surface) or writing a second Python entry point here
 * that reimplements it with nothing to keep the two in sync. `git add
 * --renormalize` is the CLI verb the field evidence names when a
 * fixable file needs one; --verify already speaks in that vocabulary
 * where a new wrapper would just be another paraphrase of it.
 *
 * `--verify` mutates nothing, by its own docstring - it reads a JSON
 * initialization record and runs one `git ls-files --eol` and answers.
 * That is what makes it ATTRIBUTE-BASED rather than stage-inferred: it
 * reads the end-of-line state the .gitattributes pins declare,
 * directly, for every pinned file in the tree, rather than waiting to
 * see which gate stage trips over a stale one first. The field
 * evidence on #287 is exactly the gap a stage-inferred check has: two
 * of the five files the stale-worktree trap can leave wrong are under
 * dev/, and no stage compares them byte-for-byte, so they sit damaged
 * and silent under any check keyed to "which stage failed." Reading
 * the attribute state finds all five the same way, because it never
 * asks a stage anything.
 *
 * The interpreter search below is ./run's search, for ./run's reason,
 * and tests/worktree-contract.test.mjs's reason too: bare `python` on
 * the owner's machine is a Microsoft Store stub that exits nonzero on
 * --version, and a Linux runner has only python3. A missing
 * interpreter is a red, never a silent pass - the gate cannot tell
 * "the worktree is fine" from "nothing checked," so it is not allowed
 * to guess which one this is.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../tools/agent_init.py",
                                      import.meta.url));

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
