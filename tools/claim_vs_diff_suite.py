"""Contract checks for the git-ops claim-vs-diff mechanism.

    py -3 tools/claim_vs_diff_suite.py

WHY THE ARMS SIT IN tools/ AND THE ENTRY POINT SITS IN tests/

`tests/` holds `.mjs` entry points and the 0.9 runner guards that: a
file there under any other extension is a stray. So the arms live
beside the module they test and `tests/claim-vs-diff.test.mjs` is the
entry point - five lines that find a Python and hand it this file.
0.9-M0-S7 settled that shim as the durable convention for a Python arm;
`tests/worktree-contract.test.mjs` and `tests/reaper.test.mjs` are the
first two instances, this is the third. This file holds every
assertion and the shim holds none.

Until the runner apparatus's own registration slice reaches this one
(if it has not already by the time this is read), both halves are run
by hand and no handoff may report either as gated.

WHY THIS BUILDS A REAL GIT REPOSITORY INSTEAD OF ASSERTING ON STRINGS

The subject under test is a comparison against a real `git diff`, and
the only trustworthy source of what git calls a rename, a deletion, or
an addition is git itself - a fixture made of hand-written dictionaries
would be a fixture of my own beliefs about git's own output shape, not
a proof about it. So every arm below runs against a small repository
built fresh under the system temporary directory with real commits and
real branches, and swept afterward the same way tools/reaper_suite.py
sweeps its own leftover roots.

Self-contained on purpose: no import from tools/reaper.py (the mission
brief's instruction - the timeout discipline is reused, the code is
not), no framework, no new dependency.
"""

import io
import os
import shutil
import subprocess
import sys
import tempfile
import time
from contextlib import redirect_stdout

# The module under test sits in this file's own directory, which Python
# puts on the path for a script it is handed - a plain import is the
# whole wiring.
import claim_vs_diff

failures = 0
performed = 0

# Asserted at the end rather than only printed. A hand-written total
# nothing compares against still prints a confident pass when a check
# stops running - an early return, a renamed helper - which is the
# armed-looking-but-not failure this repository holds to be worse than
# no check at all.
EXPECTED = 25


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
        print("FAIL  %s" % label)
    else:
        print("ok    %s" % label)


# No subprocess this suite starts may outlive it. A fixture git that
# waits for something is a suite that hangs a gate, and a hung gate is
# read as a slow one until somebody goes looking.
FIXTURE_TIMEOUT = 120


def git(repo, *args):
    done = subprocess.run(
        ["git", "-C", repo, "-c", "user.email=suite@example.invalid",
         "-c", "user.name=suite", *args],
        capture_output=True, text=True, stdin=subprocess.DEVNULL,
        timeout=FIXTURE_TIMEOUT,
    )
    return done.returncode, done.stdout + done.stderr


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(data)


# The name every working root of this suite is made under, and the only
# name the sweep below will delete.
PREFIX = "claim-vs-diff-suite-"

# How old a matching directory must be before the sweep believes it
# belongs to a FINISHED run. This suite takes seconds, so an hour is
# not a close call, and what it protects is a second agent running this
# file right now, whose working root carries the same name by
# construction.
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


def run_tool(argv, stdin_text=None):
    """(exit code, everything it printed) for one claim_vs_diff.main() call.

    Driven in-process rather than as a subprocess, the same way
    tools/reaper_suite.py drives reaper.main(): stdin and stdout are
    both swapped out around the call, so a --declared-less invocation
    reads the fixture text this suite hands it rather than this
    process's real stdin.
    """
    buffer = io.StringIO()
    old_stdin = sys.stdin
    try:
        if stdin_text is not None:
            sys.stdin = io.StringIO(stdin_text)
        with redirect_stdout(buffer):
            code = claim_vs_diff.main(argv)
    finally:
        sys.stdin = old_stdin
    return code, buffer.getvalue()


parent = tempfile.gettempdir()
root = tempfile.mkdtemp(prefix=PREFIX, dir=parent)
swept = sweep_prior_roots(parent, root)
if swept:
    print("swept %d leftover root(s): %s" % (len(swept), ", ".join(swept)))

try:
    primary = os.path.join(root, "primary")
    os.makedirs(primary)
    git(primary, "init", "-b", "accounts")
    write(os.path.join(primary, "kept.txt"), "kept\n")
    write(os.path.join(primary, "old-name.txt"), "renamed content\n")
    write(os.path.join(primary, "to-delete.txt"), "going away\n")
    git(primary, "add", "-A")
    git(primary, "commit", "-m", "base")

    git(primary, "checkout", "-b", "slice-exact")
    write(os.path.join(primary, "new-file.txt"), "brand new\n")
    git(primary, "add", "-A")
    git(primary, "commit", "-m", "add new-file.txt")

    print("\n--- an exact declared match is MATCH, exit 0 ---")
    code, said = run_tool(["slice-exact", "accounts", "--repo", primary],
                          stdin_text="new-file.txt\n")
    check("exact match exits 0", code == 0)
    check("the report says MATCH", "MATCH" in said)
    check("declared-but-untouched is empty",
          "DECLARED-BUT-UNTOUCHED (0)" in said)
    check("touched-but-undeclared is empty",
          "TOUCHED-BUT-UNDECLARED (0)" in said)

    print("\n--- a declared-but-untouched path is named, mismatch exits "
          "1 ---")
    code, said = run_tool(["slice-exact", "accounts", "--repo", primary],
                          stdin_text="new-file.txt\nghost.txt\n")
    check("mismatch exits 1", code == 1)
    check("MISMATCH is printed", "MISMATCH" in said)
    check("ghost.txt is named as declared-but-untouched",
          "DECLARED-BUT-UNTOUCHED (1): ghost.txt" in said)
    check("touched-but-undeclared stays empty",
          "TOUCHED-BUT-UNDECLARED (0)" in said)

    print("\n--- a touched-but-undeclared path is named, mismatch exits "
          "1 ---")
    code, said = run_tool(["slice-exact", "accounts", "--repo", primary],
                          stdin_text="")
    check("mismatch exits 1", code == 1)
    check("new-file.txt is named as touched-but-undeclared",
          "TOUCHED-BUT-UNDECLARED (1): new-file.txt" in said)
    check("declared-but-untouched stays empty",
          "DECLARED-BUT-UNTOUCHED (0)" in said)

    print("\n--- a rename is counted on both sides, not dropped ---")
    git(primary, "checkout", "accounts")
    git(primary, "checkout", "-b", "slice-rename")
    git(primary, "mv", "old-name.txt", "new-name.txt")
    git(primary, "commit", "-m", "rename old-name.txt to new-name.txt")

    code, said = run_tool(["slice-rename", "accounts", "--repo", primary],
                          stdin_text="new-name.txt\n")
    check("declaring only the new name of a rename is a mismatch naming "
          "the old one",
          code == 1 and "TOUCHED-BUT-UNDECLARED (1): old-name.txt"
          in said)
    code, said = run_tool(["slice-rename", "accounts", "--repo", primary],
                          stdin_text="old-name.txt\nnew-name.txt\n")
    check("declaring both sides of the rename matches",
          code == 0 and "MATCH" in said)

    print("\n--- a deletion is counted, not dropped ---")
    git(primary, "checkout", "accounts")
    git(primary, "checkout", "-b", "slice-delete")
    git(primary, "rm", "to-delete.txt")
    git(primary, "commit", "-m", "remove to-delete.txt")

    code, said = run_tool(["slice-delete", "accounts", "--repo", primary],
                          stdin_text="")
    check("an undeclared deletion is touched-but-undeclared",
          code == 1 and "TOUCHED-BUT-UNDECLARED (1): to-delete.txt"
          in said)
    code, said = run_tool(["slice-delete", "accounts", "--repo", primary],
                          stdin_text="to-delete.txt\n")
    check("declaring the deleted path matches",
          code == 0 and "MATCH" in said)

    print("\n--- the declared-list parser tolerates a completion "
          "comment's own shape ---")
    messy = ("# a completion comment\n"
             "- `new-file.txt` - new, the whole point of this slice.\n"
             "\n"
             "  \n")
    check("bullets, backticks, comments and blank lines all parse to "
          "one path",
          claim_vs_diff.parse_declared(messy) == {"new-file.txt"})
    check("a backslash path normalizes to forward slashes",
          claim_vs_diff.parse_declared("tools\\x.py\n") == {"tools/x.py"})
    check("a leading ./ is stripped",
          claim_vs_diff.parse_declared("./tools/x.py\n") == {"tools/x.py"})

    print("\n--- --declared reads a real file, not only stdin ---")
    declared_path = os.path.join(root, "declared.txt")
    write(declared_path, "new-file.txt\n")
    code, said = run_tool(["slice-exact", "accounts", "--repo", primary,
                           "--declared", declared_path])
    check("--declared FILE is honored", code == 0 and "MATCH" in said)

    print("\n--- refs that do not resolve are refused, not misread as a "
          "clean diff ---")
    code, said = run_tool(["no-such-branch", "accounts", "--repo", primary],
                          stdin_text="")
    check("an unresolvable branch exits 2, distinct from 0 or 1",
          code == 2)
    code, said = run_tool(["slice-exact", "no-such-base", "--repo", primary],
                          stdin_text="")
    check("an unresolvable base exits 2 too",
          code == 2 and "could not resolve base" in said)

    print("\n--- a git that does not answer is refused, not read as a "
          "clean diff ---")
    patient = claim_vs_diff.GIT_TIMEOUT
    claim_vs_diff.GIT_TIMEOUT = 0.000001
    try:
        code, said = run_tool(["slice-exact", "accounts", "--repo", primary],
                              stdin_text="")
        check("an unanswering git exits 2, distinct from 0 or 1",
              code == 2)
        check("the report names the timeout, not a silent 'no diff'",
              "did not answer" in said)
    finally:
        claim_vs_diff.GIT_TIMEOUT = patient

    print("\n--- a branch with nothing new against its base matches an "
          "empty declared list ---")
    git(primary, "checkout", "-b", "slice-empty", "accounts")
    code, said = run_tool(["slice-empty", "accounts", "--repo", primary],
                          stdin_text="")
    check("no diff and no declaration is still a real MATCH, not an "
          "error",
          code == 0 and "MATCH" in said)

    print("\n--- the tool's own header carries the F10 extension note "
          "---")
    check("the module docstring names Prime running this against its "
          "own summaries (audit F10), so that note cannot silently "
          "drift out of the header",
          "F10" in claim_vs_diff.__doc__
          and "Prime" in claim_vs_diff.__doc__
          and "own summaries" in claim_vs_diff.__doc__)

finally:
    shutil.rmtree(root, ignore_errors=True)

print("\n%d checks, %d failure(s)" % (performed, failures))
if performed != EXPECTED:
    print("EXPECTED %d checks and %d ran. A suite that quietly stops "
          "running is a suite that quietly stops checking."
          % (EXPECTED, performed))
    sys.exit(1)
sys.exit(1 if failures else 0)
