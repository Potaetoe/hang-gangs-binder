"""Contract checks for session-open and the landing door (MAJOR3, #311).

    py -3 tools/session_open_suite.py

WHY THE ARM SITS IN tools/ AND THE ENTRY POINT SITS IN tests/

`tests/` holds `.mjs` entry points and the 0.9 runner reds on anything
else it finds there. `tests/session-open.test.mjs` is the five-line shim
0.9-M0-S7 settled as the durable convention for a Python arm
(tests/prime-lock.test.mjs and tests/reaper.test.mjs are the
precedent); this file holds every assertion and the shim holds none.

WHAT THIS FILE PROVES, AND WHY IT IS ONE ARM RATHER THAN TWO

MAJOR3 named three mechanisms claimed but invoked by nothing:
reaper.py, prime_lock.py and claim_vs_diff.py. tools/session_open.py
wires the first two into `./run session-open`; the third is wired as a
documented door step in AGENTS.md rather than a script, because it runs
once per landing against a branch that does not exist yet at
session-open time. Both wirings are proved here, in one arm, because
they are one finding: a fork reading this repository's own docs, with
no access to the fleet's machine-held charter, needs both to actually
reach the tools they name.

WHY EVERY LOCK-TABLE CHECK RUNS AGAINST A FABRICATED STATE DIRECTORY

tools/prime_lock.py writes into the fleet's real machine-held state by
default, which is live state another session on this machine may be
reading right now. Every check below drives tools/session_open.py
through its own suppressed `--state` and `--repo` (the same overrides
reaper.py and prime_lock.py already carry, "so the suite can drive this
against a fabricated machine instead of the real one") against a fresh
`tempfile.TemporaryDirectory()`, and never touches the real state
directory at all.

WHY THE LANDING-DOOR CHECK BUILDS A REAL REPOSITORY INSTEAD OF ONLY
READING AGENTS.md AS TEXT

Reading the documented command line as a string proves it is SHAPED
like claim_vs_diff.py's real interface; it does not prove that shape
actually works. So this suite also fabricates a two-commit, two-branch
repository and runs claim_vs_diff.py against it with exactly the flags
AGENTS.md's landing-door section shows - positional branch, positional
base, `--repo`, `--declared` - and reads MATCH back, the same
reasoning tools/reaper_suite.py gives for building real repositories
rather than asserting on strings.

Self-contained on purpose: no import from dev/, no framework, no new
dependency.
"""

import datetime
import hashlib
import io
import os
import re
import subprocess
import sys
import tempfile
from contextlib import redirect_stdout

# Every module under test sits in this file's own directory, which
# Python puts on the path for a script it is handed - a plain import is
# the whole wiring. agent_init and reaper are exercised only through
# session_open (the module under test calls them itself), so neither
# is imported here directly.
import claim_vs_diff
import prime_lock
import session_open

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

failures = 0
performed = 0

# Asserted at the end rather than only printed - a hand-written total
# nothing compares against still prints a confident pass when a check
# stops running, which is the armed-looking-but-not failure this
# repository holds to be worse than no check at all.
EXPECTED = 34


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
        print("FAIL  %s" % label)
    else:
        print("ok    %s" % label)


def run_session_open(argv):
    """(exit code, everything session_open.main printed)."""
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = session_open.main(argv)
    return code, buffer.getvalue()


FIXTURE_TIMEOUT = 120


def git(repo, *args):
    done = subprocess.run(
        ["git", "-C", repo, "-c", "user.email=suite@example.invalid",
         "-c", "user.name=suite", *args],
        capture_output=True, text=True,
        encoding="utf-8", errors="replace",
        stdin=subprocess.DEVNULL,
        timeout=FIXTURE_TIMEOUT)
    return done.returncode, done.stdout + done.stderr


def hours_ago(hours):
    when = (datetime.datetime.now(datetime.timezone.utc)
            - datetime.timedelta(hours=hours))
    return when.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def expected_session_id(repo):
    """The identity contract, reconstructed independently of both
    session_open.session_id() and agent_init.record_path() - this
    checks what the contract says rather than re-running the code
    under test against itself."""
    full = os.path.abspath(repo)
    digest = hashlib.sha1(full.encode("utf-8")).hexdigest()[:8]
    return "%s-%s" % (os.path.basename(full), digest)


with tempfile.TemporaryDirectory(prefix="session-open-suite-") as root:
    # A plain repository whose sole branch names neither mainline
    # (reaper.py's SLICE_MAINLINES / DEBRIS_MAINLINES are "accounts"
    # and "main"), so a --report against it always finds zero
    # candidates - the clean baseline every lock-table case below reads
    # its reaper half against.
    clean_repo = os.path.join(root, "clean-repo")
    os.makedirs(clean_repo)
    git(clean_repo, "init", "-b", "trunk")
    with open(os.path.join(clean_repo, "f.txt"), "w",
             encoding="utf-8") as handle:
        handle.write("x\n")
    git(clean_repo, "add", "-A")
    git(clean_repo, "commit", "-m", "first")

    other_repo = os.path.join(root, "clean-repo-2")
    os.makedirs(other_repo)

    # Not a git checkout at all - reaper.py's survey() refuses this
    # cleanly (REFUSED, exit 1) rather than raising, which is what lets
    # the cases below use it to prove reaper's own trouble never
    # changes session-open's exit code.
    not_a_repo = os.path.join(root, "not-a-repo")
    os.makedirs(not_a_repo)

    counter = [0]

    def fresh_state():
        counter[0] += 1
        state = os.path.join(root, "state-%d" % counter[0])
        os.makedirs(state)
        return state

    # =====================================================================
    # session_id(): the identity contract (agent_init.record_path()'s
    # basename-and-digest pair, reused rather than re-derived)
    # =====================================================================
    check("session_id() matches the basename-and-digest contract, "
          "independently reconstructed",
          session_open.session_id(clean_repo) ==
          expected_session_id(clean_repo))
    check("session_id() is stable across repeated calls for one repo",
          session_open.session_id(clean_repo) ==
          session_open.session_id(clean_repo))
    check("session_id() differs for a different repository path",
          session_open.session_id(clean_repo) !=
          session_open.session_id(other_repo))

    # =====================================================================
    # the lock table, wired through session-open end to end
    # =====================================================================

    # Case A: no lock at all.
    state = fresh_state()
    code, said = run_session_open(["--repo", clean_repo, "--state", state])
    check("no lock: session-open exits 0", code == 0)
    check("no lock: prime_lock's own text is printed", "no lock" in said)
    check("no lock: the reaper report is printed",
          "the mechanical reaper" in said)

    # Case B: another session holds a FRESH lock.
    state = fresh_state()
    os.makedirs(prime_lock.locks_dir(state), exist_ok=True)
    prime_lock.write_lock(prime_lock.lock_path(state), "someone-else",
                          "otherhost", prime_lock.now())
    code, said = run_session_open(["--repo", clean_repo, "--state", state])
    check("another session's FRESH lock: session-open exits 1", code == 1)
    check("... and names the holder", "someone-else" in said)
    check("... and the reaper report still runs",
          "the mechanical reaper" in said)

    # Case C: another session holds a STALE lock.
    state = fresh_state()
    os.makedirs(prime_lock.locks_dir(state), exist_ok=True)
    prime_lock.write_lock(prime_lock.lock_path(state), "someone-else",
                          "otherhost", hours_ago(999))
    code, said = run_session_open(["--repo", clean_repo, "--state", state])
    check("another session's STALE lock: session-open exits 2", code == 2)
    check("... and says STALE", "STALE" in said)
    check("... and the reaper report still runs",
          "the mechanical reaper" in said)

    # Case D: THIS session's own lock, however old, is still a 0 - the
    # own-session branch does not consult staleness at all.
    state = fresh_state()
    os.makedirs(prime_lock.locks_dir(state), exist_ok=True)
    own = session_open.session_id(clean_repo)
    prime_lock.write_lock(prime_lock.lock_path(state), own, "thishost",
                          hours_ago(999))
    code, said = run_session_open(["--repo", clean_repo, "--state", state])
    check("this session's own lock, however old: session-open exits 0",
          code == 0)
    check("... and reads as its own session", "own session" in said)

    # Case E: the lock is fine, but reaper itself is in trouble (--repo
    # points at something that is not a git checkout at all) - proves
    # session-open's exit code is the lock's alone, never blended.
    state = fresh_state()
    code, said = run_session_open(["--repo", not_a_repo, "--state", state])
    check("reaper trouble with an ok lock: session-open still exits 0, "
          "the lock table's code and not reaper's", code == 0)
    check("... reaper's own trouble is named, not swallowed",
          "REFUSED" in said and "not a git checkout" in said)

    # Case F: a STALE lock (2) AND a troubled reaper together - the exit
    # code is 2, not some blend of 2 and reaper's own 1.
    state = fresh_state()
    os.makedirs(prime_lock.locks_dir(state), exist_ok=True)
    prime_lock.write_lock(prime_lock.lock_path(state), "someone-else",
                          "otherhost", hours_ago(999))
    code, said = run_session_open(["--repo", not_a_repo, "--state", state])
    check("a STALE lock and a troubled reaper together: session-open "
          "exits 2, the lock's code alone", code == 2)
    check("... reaper's own trouble is still named", "REFUSED" in said)

    # =====================================================================
    # the shell entry points really reach tools/session_open.py
    # =====================================================================
    with open(os.path.join(REPO_ROOT, "run"), encoding="utf-8") as handle:
        run_sh = handle.read()
    with open(os.path.join(REPO_ROOT, "run.cmd"),
             encoding="utf-8") as handle:
        run_cmd = handle.read()

    sh_case = re.search(r"\n  session-open\)\n(.*?)\n  [\w-]+\)\n",
                        run_sh, re.S)
    check("./run declares a session-open) case", sh_case is not None)
    check("... and it execs tools/session_open.py",
          sh_case is not None and "exec" in sh_case.group(1) and
          "tools/session_open.py" in sh_case.group(1))

    check("run.cmd dispatches session-open to its own label",
          'if "%~1"=="session-open" goto :session_open' in run_cmd)
    # The label DEFINITION, not the `goto :session_open` dispatch line
    # above it - anchored on a leading newline so only a line that
    # starts with the colon (a label) matches, never one where it
    # follows "goto ".
    cmd_block = re.search(r"\n:session_open\r?\n(.*?)\r?\n:\w", run_cmd,
                         re.S)
    check("... and the label really runs tools\\session_open.py",
          cmd_block is not None and
          "tools\\session_open.py" in cmd_block.group(1))
    check("... and exits with its own errorlevel",
          cmd_block is not None and
          "exit /b %ERRORLEVEL%" in cmd_block.group(1))

    # =====================================================================
    # AGENTS.md documents session-open as the session's first act
    # =====================================================================
    with open(os.path.join(REPO_ROOT, "AGENTS.md"),
             encoding="utf-8") as handle:
        agents_md = handle.read()

    check("AGENTS.md names ./run session-open",
          "./run session-open" in agents_md)
    check("... as the first act of a session",
          "first act of a session" in agents_md)
    check("... and names prime_lock.py check",
          "prime_lock.py check" in agents_md)
    check("... and names reaper.py --report",
          "reaper.py --report" in agents_md)

    # =====================================================================
    # AGENTS.md's landing-door invocation is claim_vs_diff.py's REAL CLI
    # =====================================================================
    door_line = re.search(r"py -3 tools/claim_vs_diff\.py[^\n`]*",
                          agents_md)
    check("AGENTS.md quotes the claim_vs_diff.py door invocation",
          door_line is not None)
    line = door_line.group(0) if door_line else ""
    check("... the base is origin/accounts", "origin/accounts" in line)
    check("... --repo is explicit", "--repo" in line)
    check("... --declared is always passed", "--declared" in line)

    with open(os.path.join(REPO_ROOT, "tools", "claim_vs_diff.py"),
             encoding="utf-8") as handle:
        claim_vs_diff_src = handle.read()
    check('AGENTS.md\'s "--repo" is a real claim_vs_diff.py flag',
          'add_argument("--repo"' in claim_vs_diff_src)
    check('AGENTS.md\'s "--declared" is a real claim_vs_diff.py flag',
          'add_argument("--declared"' in claim_vs_diff_src)

    # The functional proof: the exact flag shape AGENTS.md quotes -
    # positional branch, positional base, --repo, --declared - actually
    # works, run against a fabricated repository rather than only read
    # as text.
    door_repo = os.path.join(root, "door-repo")
    os.makedirs(door_repo)
    git(door_repo, "init", "-b", "base")
    with open(os.path.join(door_repo, "a.txt"), "w",
             encoding="utf-8") as handle:
        handle.write("one\n")
    git(door_repo, "add", "-A")
    git(door_repo, "commit", "-m", "on base")
    git(door_repo, "checkout", "-b", "feature")
    with open(os.path.join(door_repo, "a.txt"), "w",
             encoding="utf-8") as handle:
        handle.write("two\n")
    git(door_repo, "add", "-A")
    git(door_repo, "commit", "-m", "on feature")
    declared_path = os.path.join(root, "declared.txt")
    with open(declared_path, "w", encoding="utf-8") as handle:
        handle.write("a.txt\n")

    door_argv = ["feature", "base", "--repo", door_repo,
                "--declared", declared_path]
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        door_rc = claim_vs_diff.main(door_argv)
    check("the doc's flag shape (positional branch, positional base, "
          "--repo, --declared) really runs against claim_vs_diff.py "
          "and reports MATCH",
          door_rc == 0 and "MATCH" in buffer.getvalue())

print("\n%d checks, %d failure(s)" % (performed, failures))
if performed != EXPECTED:
    print("EXPECTED %d checks and %d ran. A suite that quietly stops "
          "running is a suite that quietly stops checking."
          % (EXPECTED, performed))
    sys.exit(1)
sys.exit(1 if failures else 0)
