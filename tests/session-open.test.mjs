/*
 * The entry point for session-open and the landing door's arms, which
 * are Python.
 *
 * Every assertion lives in tools/session_open_suite.py, beside the
 * module it tests; this file holds none. It is the shim convention
 * 0.9-M0-S7 settled for a Python arm - the runner launches
 * `tests/*.test.mjs` and cannot reach a `.py` file, and a Python suite
 * sitting in this directory reads as a stray to the guard that keeps
 * this directory to one language. Shelling out is the seam, and it
 * stays five lines so that nothing about the check can hide in it.
 *
 * The interpreter search is ./run's search, for ./run's reason: bare
 * `python` on the owner's machine is a Microsoft Store stub that exits
 * nonzero on --version, and a Linux runner has only python3. A missing
 * interpreter exits nonzero rather than skipping - a suite that reports
 * success because it never ran is the failure this repository holds to
 * be worse than no suite at all.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const suite = fileURLToPath(new URL("../tools/session_open_suite.py",
                                    import.meta.url));

for (const [exe, flags] of [["py", ["-3"]], ["python3", []],
                            ["python", []]]) {
  if (spawnSync(exe, [...flags, "--version"], { stdio: "ignore" })
      .status !== 0) {
    continue;
  }
  const done = spawnSync(exe, [...flags, suite], { stdio: "inherit" });
  process.exit(done.status === null ? 1 : done.status);
}

console.error("No working Python found, so session-open's and the " +
              "landing door's arms did not run. Install one from " +
              "python.org or enable the py launcher.");
process.exit(1);
