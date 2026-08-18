"""Contract checks for the mechanical ship-check (0.9-M0-S22, #320).

    py -3 tools/ship_check_suite.py

WHY THE ARM SITS IN tests/ AND THE ASSERTIONS SIT HERE

The convention 0.9-M0-S7 settled and every Python arm since has
followed: `tests/ship-check.test.mjs` is five lines that find a Python
and hand it this file - the shim is the whole wiring, and every
assertion lives here, beside the module it tests.

WHY THIS BUILDS A REAL GIT REPOSITORY

Three of ship_check.py's six stages read real git state (the current
branch, the clean-tree status, the diff against a base ref), and the
fourth (declared-vs-diff) is a straight pass-through into
claim_vs_diff.compare(), which claim_vs_diff_suite.py already proves
against real git for its own 29 checks - reasserting that logic here
would be the second-copy failure this file's own tools/claim_vs_diff.py
module docstring warns about ("PER AUDIT F10"). So this suite builds
one small fixture repository with real commits, real branches and a
real `origin/accounts` remote-tracking ref, the same way
claim_vs_diff_suite.py and fleet_status_suite.py both do, and drives
ship_check.py's stage functions directly against it.

WHY tools/check.py AND tests/run.mjs ARE STAND-INS, NOT THE REAL ONES

Stage 1 and stage 2 run whatever sits at `<repo>/tools/check.py` and
`<repo>/tests/run.mjs` as real subprocesses and capture their exact
stdout - that captured-verbatim behavior is the entire reason this
ticket exists, so it has to be proven against a REAL subprocess, not
mocked away. Running the actual gates as part of a suite would make
this suite minutes long and would fail for reasons that have nothing
to do with ship_check.py (a linter warning, a slow suite elsewhere) -
so the fixture repository carries two small stand-in scripts instead,
each one line long, each controllable by an environment variable the
same way agent_init_suite.py's own PROBE_SOURCE stand-in is. What is
under test is whether ship_check.py's stage functions capture and
grade a subprocess's real output correctly, which a tiny real
subprocess proves exactly as well as tools/check.py itself would.

WHY agent_init.initialization_problems IS MONKEYPATCHED, NOT REBUILT

Stage 2 first asks `agent_init.initialization_problems()` whether the
worktree counts as initialized - that function's own contract (eol
scan, dependency probe, record shape) already has 119 checks of its
own in tools/agent_init_suite.py, and reproducing the fixture that
produces a genuinely uninitialized worktree here (a stale eol state, a
missing node_modules) would be the same second-copy failure this
docstring's earlier paragraph names, one function over. What THIS
suite is answerable for is only what ship_check.py's stage_new_gate()
DOES with that function's answer - runs the gate on an empty list,
short-circuits to a "not initialized" row on a non-empty one, and
never lets the gate run in the second case even when it would have
passed - so the function is monkeypatched for the width of one call
each time, proving the routing rather than re-proving the routed-to
function.

WHY gh IS A STUB SCRIPT RATHER THAN A MOCK OBJECT

Same argument fleet_status_suite.py's own module docstring makes for
its own gh stub, one file over: tools/fleet_status.py (and this file,
importing its gh() and sanitize()) never imports a gh client, it
shells out - BINDER_GH_CMD replaces the `["gh"]` prefix with an
arbitrary command, so the fixture is a small, real, standalone script
this suite writes to disk and invokes as a real subprocess, proving
the actual seam rather than a shortcut through Python object identity.

Self-contained on purpose, matching every existing suite in this
fleet: no import from dev/, no framework, no new dependency, and
nothing imported from any sibling *_suite.py (each one runs its own
checks at import time, unguarded by `if __name__ == "__main__"`, so
importing one would run it as a side effect of running this one).
"""

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from contextlib import redirect_stdout

import agent_init
import ship_check

failures = 0
performed = 0

# Asserted at the end, not merely printed - the floor every suite in
# this fleet holds itself to: a hand-counted total nothing compares
# against still prints a confident pass when a check stops running.
EXPECTED = 44


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
        print("FAIL  %s" % label)
    else:
        print("ok    %s" % label)


FIXTURE_TIMEOUT = 120


def git(repo, *args):
    done = subprocess.run(
        ["git", "-C", repo, "-c", "user.email=suite@example.invalid",
         "-c", "user.name=suite", *args],
        capture_output=True, text=True, stdin=subprocess.DEVNULL,
        timeout=FIXTURE_TIMEOUT,
    )
    return done.returncode, done.stdout + done.stderr


def sha(repo, ref):
    _code, out = git(repo, "rev-parse", ref)
    return out.strip()


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(data)


# The name every working root of this suite is made under, and the
# only name the sweep below will delete.
PREFIX = "ship-check-suite-"

# How old a matching directory must be before the sweep believes it
# belongs to a FINISHED run. This suite takes seconds; the thing it
# protects is a second agent running this file right now, whose
# working root carries the same name by construction.
STALE_AFTER = 3600


def sweep_prior_roots(parent, keep, now=None):
    swept = []
    now = time.time() if now is None else now
    for name in sorted(os.listdir(parent)):
        path = os.path.join(parent, name)
        if not name.startswith(PREFIX) or path == keep:
            continue
        if not os.path.isdir(path) or os.path.islink(path):
            continue
        if now - os.path.getmtime(path) < STALE_AFTER:
            continue
        try:
            shutil.rmtree(path)
        except OSError:
            continue
        swept.append(name)
    return swept


class PatchInitProblems:
    """While active, `agent_init.initialization_problems()` returns a
    fixed list regardless of what it is called with - see the module
    docstring's "WHY agent_init.initialization_problems IS
    MONKEYPATCHED" section for why this is the right boundary for this
    suite to sit on."""

    def __init__(self, problems):
        self.problems = problems

    def __enter__(self):
        self._real = agent_init.initialization_problems
        agent_init.initialization_problems = \
            lambda repo, state: list(self.problems)
        return self

    def __exit__(self, *exc_info):
        agent_init.initialization_problems = self._real
        return False


# ----------------------------------------------------------------------
# Fixture repository. One commit on origin/accounts, one real commit on
# top of it touching apps/web/page.html - exactly the shape a slice's
# own branch has, so stage 5 has a real diff to compare declarations
# against.
# ----------------------------------------------------------------------

OLD_GATE_STUB = '''
import os, sys
ok = os.environ.get("SHIP_CHECK_STUB_OLD_GATE") != "fail"
print("=== fixture stage one ===")
print("fixture stage one    " + ("ok" if ok else "FAILED"))
print("\\nAll checks passed." if ok else "\\nNot safe to push.")
sys.exit(0 if ok else 1)
'''

NEW_GATE_STUB = '''
const ok = process.env.SHIP_CHECK_STUB_NEW_GATE !== "fail";
console.log("fixture arm 1: " + (ok ? "ok" : "FAILED"));
console.log(ok ? "1 arm(s), all green."
               : "1 arm(s), 1 problem(s): fixture arm 1");
process.exit(ok ? 0 : 1);
'''

GH_STUB_SOURCE = '''
import json
import os
import sys

ISSUE = {
    "claimed": {"title": "0.9-M0-S22: mechanical ship-check",
                "labels": [{"name": "claude"}]},
    "unclaimed": {"title": "0.9-M0-S22: mechanical ship-check",
                  "labels": []},
    # A real ESC byte, the same shape fleet_status_suite.py's own
    # "hostile" fixture uses (S20 MAJOR-1) - the outer \\\\x1b here is
    # two backslashes plus "x1b" in THIS file's own source, so it lands
    # as the four characters \\\\x1b in gh_stub.py's source on disk,
    # which Python parses as one real ESC byte when the stub runs.
    "hostile": {"title": "0.9-M0-S22: hostile \\x1b[2J\\x1b[Htitle",
                "labels": [{"name": "claude"}]},
}


def main():
    args = sys.argv[1:]
    scenario = os.environ.get("SHIP_CHECK_STUB_SCENARIO", "claimed")
    if scenario == "boom":
        sys.stderr.write("stub: simulated gh failure\\n")
        return 7
    if args[:2] == ["issue", "view"]:
        print(json.dumps(ISSUE.get(scenario, ISSUE["claimed"])))
        return 0
    sys.stderr.write("stub: unrecognized args %r\\n" % (args,))
    return 9


if __name__ == "__main__":
    sys.exit(main())
'''


def stub_command(stub_path):
    return json.dumps([sys.executable, stub_path])


def build_repo(root):
    repo = os.path.join(root, "repo")
    os.makedirs(repo)
    git(repo, "init", "-q", "-b", "0.9-m0-s22")
    write(os.path.join(repo, "README.md"), "fixture\n")
    write(os.path.join(repo, "tools", "check.py"), OLD_GATE_STUB)
    write(os.path.join(repo, "tests", "run.mjs"), NEW_GATE_STUB)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "base")
    base_sha = sha(repo, "HEAD")
    git(repo, "update-ref", "refs/remotes/origin/accounts", base_sha)

    write(os.path.join(repo, "apps", "web", "page.html"), "<html></html>\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "slice change")
    tip_sha = sha(repo, "HEAD")
    return repo, base_sha, tip_sha


# ----------------------------------------------------------------------

root = tempfile.mkdtemp(prefix=PREFIX)
try:
    parent = os.path.dirname(root)
    swept = sweep_prior_roots(parent, root)
    if swept:
        print("swept %d stale fixture root(s) from a prior run: %s"
             % (len(swept), ", ".join(swept)))

    print("--- _branch_ok: the naming-standard scanner ---")
    check("the canonical form passes", ship_check._branch_ok("0.9-m0-s22"))
    check("multi-digit milestone and slice numbers pass",
          ship_check._branch_ok("0.9-m12-s345"))
    check("uppercase fails - the standard is lowercase",
          not ship_check._branch_ok("0.9-M0-S22"))
    check("a missing -s segment fails",
          not ship_check._branch_ok("0.9-m0"))
    check("an empty slice number fails",
          not ship_check._branch_ok("0.9-m0-s"))
    check("an empty milestone number fails",
          not ship_check._branch_ok("0.9-m-s1"))
    check("trailing junk after the slice number fails - a fix-wave "
         "suffix does not become part of the naming standard",
          not ship_check._branch_ok("0.9-m0-s22-fw2"))
    check("an unrelated name fails", not ship_check._branch_ok("main"))

    repo, base_sha, tip_sha = build_repo(root)

    print("\n--- stage 3: branch name ---")
    git(repo, "branch", "0.9-M0-S22-bad-case", tip_sha)
    git(repo, "checkout", "-q", "0.9-M0-S22-bad-case")
    stage = ship_check.stage_branch_name(repo)
    check("an uppercase branch name fails the naming standard",
          not stage.ok and "does not match" in stage.lines[0])
    check("its evidence names the exact git command read",
          stage.evidence == "git branch --show-current")

    git(repo, "branch", "scratch-work", tip_sha)
    git(repo, "checkout", "-q", "scratch-work")
    stage = ship_check.stage_branch_name(repo)
    check("a scratch name fails too - no scratch names at signal time",
          not stage.ok)

    git(repo, "checkout", "-q", "--detach", tip_sha)
    stage = ship_check.stage_branch_name(repo)
    check("a detached HEAD fails - git branch --show-current answers "
         "empty",
          not stage.ok and "detached" in stage.lines[0])

    git(repo, "checkout", "-q", "0.9-m0-s22")
    stage = ship_check.stage_branch_name(repo)
    check("the correctly-named branch passes, named exactly",
          stage.ok and stage.lines == ["branch: 0.9-m0-s22"])

    print("\n--- stage 4: working tree clean + head SHA ---")
    stage = ship_check.stage_clean_head(repo)
    check("a clean tree at a real commit passes",
          stage.status_word == "PASS")
    check("the full 40-character SHA is printed for direct copy",
          any(line == "head: " + tip_sha for line in stage.lines))

    write(os.path.join(repo, "README.md"), "fixture, modified\n")
    stage = ship_check.stage_clean_head(repo)
    check("an uncommitted edit fails the clean-tree stage",
          not stage.ok)
    check("...and names the dirty file",
          any("README.md" in line for line in stage.lines))
    git(repo, "checkout", "-q", "--", "README.md")

    print("\n--- stage 5: declared files vs real diff ---")
    declared_good = os.path.join(root, "declared-good.txt")
    write(declared_good, "apps/web/page.html\n")
    stage = ship_check.stage_declared_vs_diff(repo, "origin/accounts",
                                              declared_good)
    check("a declared list matching the real diff passes",
          stage.ok and "MATCH" in "\n".join(stage.lines))

    declared_bad = os.path.join(root, "declared-bad.txt")
    write(declared_bad, "some/other/path.txt\n")
    stage = ship_check.stage_declared_vs_diff(repo, "origin/accounts",
                                              declared_bad)
    check("a mismatched declared list fails, both directions named",
          not stage.ok
          and "DECLARED-BUT-UNTOUCHED" in "\n".join(stage.lines)
          and "TOUCHED-BUT-UNDECLARED" in "\n".join(stage.lines))

    stage = ship_check.stage_declared_vs_diff(repo, "origin/accounts", None)
    check("no --declared file given fails with an actionable message, "
         "not a crash",
          not stage.ok and "no --declared file given" in stage.lines[0])

    missing = os.path.join(root, "does-not-exist.txt")
    stage = ship_check.stage_declared_vs_diff(repo, "origin/accounts",
                                              missing)
    check("an unreadable --declared path fails, names why",
          not stage.ok and "could not read" in stage.lines[0])

    print("\n--- stage 1 & 2: subprocess capture is VERBATIM, never "
         "summarized (the whole reason this ticket exists) ---")
    os.environ.pop("SHIP_CHECK_STUB_OLD_GATE", None)
    stage = ship_check.stage_old_gate(repo)
    check("a passing old gate's own line is captured verbatim",
          stage.ok
          and any("fixture stage one    ok" in line for line in stage.lines))
    check("the real exit code is echoed as its own line",
          any("exited 0" in line for line in stage.lines))

    os.environ["SHIP_CHECK_STUB_OLD_GATE"] = "fail"
    stage = ship_check.stage_old_gate(repo)
    check("a failing old gate is reported FAILED with its real output",
          not stage.ok
          and any("FAILED" in line for line in stage.lines)
          and any("exited 1" in line for line in stage.lines))
    del os.environ["SHIP_CHECK_STUB_OLD_GATE"]

    with PatchInitProblems([]):
        stage = ship_check.stage_new_gate(repo, None)
    check("an initialized worktree runs the real 0.9 gate and captures "
         "its exact line",
          stage.ok
          and any("fixture arm 1: ok" in line for line in stage.lines))

    os.environ["SHIP_CHECK_STUB_NEW_GATE"] = "fail"
    with PatchInitProblems([]):
        stage = ship_check.stage_new_gate(repo, None)
    check("a failing 0.9 gate is reported FAILED too",
          not stage.ok
          and any("FAILED" in line for line in stage.lines))
    del os.environ["SHIP_CHECK_STUB_NEW_GATE"]

    with PatchInitProblems(["fixture: pretend uninitialized"]):
        stage = ship_check.stage_new_gate(repo, None)
    check("an uninitialized worktree short-circuits to its own row",
          not stage.ok and stage.lines[0].startswith("not initialized"))
    check("...naming the real problem initialization_problems() gave",
          "fixture: pretend uninitialized" in stage.lines)
    check("...and NEVER runs the gate at all - the stub would have "
         "passed, and its telltale line is nowhere in the output",
          not any("fixture arm 1" in line for line in stage.lines))

    print("\n--- stage 6: ticket label state (report-only) ---")
    stub_path = os.path.join(root, "gh_stub.py")
    write(stub_path, GH_STUB_SOURCE)
    os.environ["BINDER_GH_CMD"] = stub_command(stub_path)

    os.environ["SHIP_CHECK_STUB_SCENARIO"] = "claimed"
    stage = ship_check.stage_ticket_label(320)
    check("a claimed ticket reports the label present",
          stage.gates is False and stage.status_word == "REPORT"
          and any("claude label: present" in line for line in stage.lines))

    os.environ["SHIP_CHECK_STUB_SCENARIO"] = "unclaimed"
    stage = ship_check.stage_ticket_label(320)
    check("an unclaimed ticket reports the label absent, still "
         "report-only and still non-gating",
          stage.gates is False and stage.ok is True
          and any("claude label: absent" in line for line in stage.lines))

    # gh absent: BINDER_GH_CMD pointed at a nonexistent executable,
    # fleet_status_suite.py's own precedent for this exact scenario.
    os.environ["BINDER_GH_CMD"] = json.dumps(["not-a-real-executable-xyz"])
    stage = ship_check.stage_ticket_label(320)
    check("gh absent degrades to a labeled gap, never a crash",
          stage.status_word.startswith("REPORT")
          and any("gh could not be consulted" in line
                  for line in stage.lines))
    check("...and still never gates the overall exit code",
          stage.gates is False and stage.ok is True)

    os.environ["BINDER_GH_CMD"] = stub_command(stub_path)
    os.environ["SHIP_CHECK_STUB_SCENARIO"] = "hostile"
    stage = ship_check.stage_ticket_label(320)
    joined = "\n".join(stage.lines)
    check("a hostile ESC byte from gh is sanitized before it reaches "
         "this stage's own printed lines - gone, not merely alongside",
          "\x1b" not in joined)
    check("...and rendered as visible escaped hex, so nothing legible "
         "is silently dropped",
          "\\x1b" in joined)

    del os.environ["SHIP_CHECK_STUB_SCENARIO"]
    del os.environ["BINDER_GH_CMD"]

    stage = ship_check.stage_ticket_label(None)
    check("no --issue given is report-only and non-failing",
          stage.gates is False and stage.ok is True
          and "no --issue given" in stage.lines[0])

    print("\n--- main(): whole-program exit code and ready-to-paste "
         "framing ---")
    git(repo, "checkout", "-q", "0.9-m0-s22")
    stub_path = os.path.join(root, "gh_stub.py")
    os.environ["BINDER_GH_CMD"] = stub_command(stub_path)
    os.environ["SHIP_CHECK_STUB_SCENARIO"] = "claimed"

    buffer = io.StringIO()
    with PatchInitProblems([]), redirect_stdout(buffer):
        code = ship_check.main(["--repo", repo, "--declared", declared_good,
                                "--base", "origin/accounts",
                                "--issue", "320"])
    rendered = buffer.getvalue()
    check("an all-pass fixture run exits 0", code == 0)
    check("the closing line names this output as the paste-verbatim "
         "block, not a count to remember",
          "Paste this whole block into the completion comment" in rendered)
    check("stage 1's real header and stage 6's report both appear in "
         "the one printed block",
          "--- old gate (py -3 tools/check.py) ---" in rendered
          and "--- ticket label state (report-only) ---" in rendered)
    check("stage 6 prints REPORT, visibly distinct from a gating PASS, "
         "even on an all-pass run",
          "[REPORT]" in rendered)
    check("the full 40-character head SHA appears, ready to copy into "
         "the signal",
          ("head: " + tip_sha) in rendered)

    buffer2 = io.StringIO()
    with PatchInitProblems(["fixture: pretend uninitialized"]), \
         redirect_stdout(buffer2):
        code2 = ship_check.main(["--repo", repo, "--declared", declared_good,
                                 "--issue", "320"])
    check("an uninitialized worktree fails main() overall, exit 1",
          code2 == 1)
    check("...and the summary names which gating stage(s) failed",
          "gating stage(s) failed" in buffer2.getvalue()
          and "0.9 gate (node tests/run.mjs)" in buffer2.getvalue())
    check("a report-only stage passing does not rescue a failed "
         "gating stage from the exit code",
          "[REPORT]" in buffer2.getvalue())

    del os.environ["SHIP_CHECK_STUB_SCENARIO"]
    del os.environ["BINDER_GH_CMD"]

finally:
    shutil.rmtree(root, ignore_errors=True)

print("\n%d checks, %d failure(s)" % (performed, failures))
if performed != EXPECTED:
    print("EXPECTED %d checks and %d ran. A suite that quietly stops "
         "running is a suite that quietly stops checking."
         % (EXPECTED, performed))
    sys.exit(1)
sys.exit(1 if failures else 0)
