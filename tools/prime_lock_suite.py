"""Contract checks for the twice-bitten guard (tools/prime_lock.py).

    py -3 tools/prime_lock_suite.py

WHY THE ARM SITS IN tools/ AND THE ENTRY POINT SITS IN tests/

`tests/` holds `.mjs` entry points and the 0.9 runner reds on anything
else it finds there. `tests/prime-lock.test.mjs` is the five-line shim
0.9-M0-S7 settled as the durable convention for a Python arm
(tests/reaper.test.mjs and tests/worktree-contract.test.mjs are the
precedent); this file holds every assertion and the shim holds none.
Until the runner apparatus (#281) is registered, both halves are run by
hand and no handoff may report either as gated.

WHY EVERY CHECK RUNS AGAINST A FABRICATED STATE DIRECTORY, NEVER THE
REAL ONE

`tools/prime_lock.py` writes into the fleet's real machine-held state by
default (`BINDER_FLEET_STATE`, or `~/.claude/binder-fleet`), which is
live state other sessions on this machine may be reading right now. This
suite drives every scenario through the module's own `--state` override
(the same suppressed flag `reaper.py` carries for the same reason:
"so the suite can drive this against a fabricated machine") against a
fresh `tempfile.TemporaryDirectory()`, and touches the real state
directory exactly once, in the one arm whose entire point is proving the
`BINDER_FLEET_STATE` environment variable is read at all.

Self-contained on purpose: no import from dev/, no framework, no new
dependency.
"""

import io
import os
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import redirect_stdout

# Both modules under test sit in this file's own directory, which Python
# puts on the path for a script it is handed - a plain import is the
# whole wiring.
import agent_init
import prime_lock

failures = 0
performed = 0
skipped = 0

# The synchronized-concurrency harness (2nd-audit MAJOR2). A wall-clock
# barrier is not enough on its own to prove a single-winner property, but
# it is what makes the contended op ACTUALLY contend: every worker imports
# the module, then spins on a shared GO file the parent creates only once
# every worker is up, so the race window is the acquire/release itself and
# not the interpreter startup around it. Reuses the shape 0.9-M0-S12's
# review used (subprocesses on a barrier), against a fabricated --state.
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))

_WORKER = r"""
import os, sys
tools_dir, state, verb, session, go = sys.argv[1:6]
flags = sys.argv[6:]
sys.path.insert(0, tools_dir)
import prime_lock
while not os.path.exists(go):
    pass
sys.exit(prime_lock.main([verb, session, "--state", state] + flags))
"""


def barrier_trial(state, specs):
    """Run `specs` [(verb, session, [flags]), ...] against one GO barrier.

    Returns [(session, exit_code, stderr), ...] in spec order. The lock's
    own directory must already exist (every caller seeds a record first),
    so the GO file has somewhere to live that every worker agrees on.

    WHY stderr IS CAPTURED AND NOT DISCARDED (S23 fix wave, #436). Exit
    codes alone graded these storms before, and a contender that CRASHED
    simply exited nonzero, which reads as "did not win" and violates
    nothing - so the very crash this suite's slice was written to remove
    could fire and the arm still exited 0. Twenty-five runs of the
    unfixed module printed a worker traceback in four of them and all
    twenty-five passed. A traceback in a contender's stderr is now a
    failure in its own right (`crashed` below): a lock mechanism whose
    contenders die is not one whose invariant held, it is one whose
    invariant was not tested.
    """
    go = os.path.join(prime_lock.locks_dir(state), "GO")
    procs = []
    for verb, session, flags in specs:
        procs.append((session, subprocess.Popen(
            [sys.executable, "-c", _WORKER, TOOLS_DIR, state, verb,
             session, go, *flags], stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE, text=True,
            encoding="utf-8", errors="replace")))
    # Let every worker reach its spin loop before firing the barrier, so
    # the contention is real. Correctness does not depend on perfect
    # simultaneity - the single-winner invariant holds under any
    # interleaving - but a tighter barrier makes a broken invariant far
    # likelier to be caught.
    time.sleep(0.25)
    open(go, "w").close()
    out = []
    for session, proc in procs:
        _, said = proc.communicate()
        out.append((session, proc.returncode, said or ""))
    return out


def crashed(outcomes):
    """The contenders in `outcomes` that died with a traceback.

    Returns [(session, first line of the traceback), ...] - a list rather
    than a count so a failing arm can print WHO died and of what, which
    is the whole difference between a red that can be acted on and a red
    that sends the next reader back to the storm to reproduce it.
    """
    dead = []
    for session, _, said in outcomes:
        if "Traceback" not in said:
            continue
        lines = [line for line in said.strip().splitlines()
                 if line.strip() and not line.startswith(" ")]
        dead.append((session, lines[-1] if lines else "Traceback"))
    return dead


def exit_codes(outcomes):
    return {session: code for session, code, _ in outcomes}

# Asserted at the end rather than only printed - a hand-written total
# nothing compares against still prints a confident pass when a check
# stops running, which is the armed-looking-but-not failure this
# repository holds to be worse than no check at all.
EXPECTED = 120


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
        print("FAIL  %s" % label)
    else:
        print("ok    %s" % label)


def skip(label, reason):
    """Account for a check whose CONDITION this platform cannot create.

    Counted in `performed` on purpose, so EXPECTED stays one number on
    every platform: the count proves the suite reached every check site,
    and the printed line says which sites could not run here and why. A
    skip left out of the count would make the total platform-dependent,
    and a total nobody can predict is a total nobody can assert - which
    is the whole reason EXPECTED exists.

    Reserved for a condition the operating system genuinely will not
    produce (the Windows-only open-handle denial below is the only user
    today). A property that CAN be proved everywhere is proved
    everywhere, by injection if the real condition is platform-bound -
    never skipped, and never left passing for free on the platform where
    its premise is false (S23 fix wave 2, #436).
    """
    global performed, skipped
    performed += 1
    skipped += 1
    print("skip  %s - skipped: %s" % (label, reason))


# Windows denies a move or a delete against a file another process holds
# open; POSIX does not, and that difference is a fact about the operating
# systems rather than about this module.
NO_OPEN_HANDLE_DENIAL = ("only Windows refuses to move or delete a file "
                         "another process holds open - POSIX rename(2) "
                         "and unlink(2) both succeed against an open "
                         "file, so no live handle can deny a steal here")


def run(argv):
    """(exit code, everything prime_lock.main printed)."""
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = prime_lock.main(argv)
    return code, buffer.getvalue()


def read(state):
    return agent_init.read_json(prime_lock.lock_path(state))


HOURS = 3600.0


def hours_ago(hours):
    import datetime
    when = (datetime.datetime.now(datetime.timezone.utc)
            - datetime.timedelta(hours=hours))
    return when.replace(microsecond=0).isoformat().replace("+00:00", "Z")


with tempfile.TemporaryDirectory(prefix="prime-lock-suite-") as root:
    state = os.path.join(root, "state")

    print("--- the lock's own path composition ---")
    check("locks live under <state>/locks/prime.json",
          prime_lock.lock_path(state)
          == os.path.join(state, "locks", "prime.json"))

    print("\n--- an empty machine has no lock ---")
    code, said = run(["check", "session-a", "--state", state])
    check("check on a directory that does not exist yet exits 0",
          code == 0)
    check("it says so in plain language", "no lock" in said)
    check("checking does not create anything",
          not os.path.exists(prime_lock.locks_dir(state)))

    print("\n--- a brand-new acquire ---")
    code, said = run(["acquire", "session-a", "--state", state,
                      "--host", "host-a"])
    check("acquiring a free lock exits 0", code == 0)
    check("it says 'acquired'", "acquired" in said.lower())
    record = read(state)
    check("it wrote a record naming the session",
          record and record.get("session") == "session-a")
    check("the record names the host it was given",
          record and record.get("host") == "host-a")
    check("the record carries this module's schema",
          record and record.get("schema") == prime_lock.SCHEMA)
    check("the record carries a started-at",
          record and record.get("started_at"))

    print("\n--- second-session refusal names the holder ---")
    code, said = run(["check", "session-b", "--state", state])
    check("a second session's check on a FRESH lock exits 1", code == 1)
    check("the refusal names the holding session", "session-a" in said)
    check("the refusal names the mechanism's rule",
          "one Prime at a time" in said or "REFUSED" in said)

    code, said = run(["acquire", "session-b", "--state", state])
    check("a second session's acquire on a fresh lock exits nonzero",
          code != 0)
    check("the acquire refusal ALSO names the holder", "session-a" in said)
    check("the refused acquire wrote nothing over the holder's record",
          read(state).get("session") == "session-a")

    print("\n--- own-session re-acquire ok, regardless of age ---")
    # Seeded far past the default staleness threshold and still under the
    # OWNING session's own name - proving re-acquire ignores staleness
    # for its own session is the point, not merely that it succeeds.
    prime_lock.write_lock(prime_lock.lock_path(state), "session-a",
                          "host-a", hours_ago(20))
    before = read(state)
    check("the seeded record is provably stale on its own terms",
          prime_lock.staleness(before, prime_lock.DEFAULT_STALE_HOURS)
          is not None)
    code, said = run(["check", "session-a", "--state", state])
    check("check for the owning session ignores that staleness", code == 0)
    check("it reads as 'own session'", "own session" in said)

    code, said = run(["acquire", "session-a", "--state", state])
    check("re-acquiring one's own stale lock exits 0 with no flag at all",
          code == 0)
    check("it says 're-acquired'", "re-acquired" in said)
    after = read(state)
    check("re-acquiring refreshed started-at",
          prime_lock.age_hours(after["started_at"]) < 1.0)
    check("re-acquiring did not change who holds it",
          after.get("session") == "session-a")

    print("\n--- release removes only the caller's own lock ---")
    code, said = run(["release", "session-b", "--state", state])
    check("a non-owning session's release is refused", code != 0)
    check("the refusal names the actual holder", "session-a" in said)
    check("the lock survives a refused release",
          os.path.exists(prime_lock.lock_path(state)))

    code, said = run(["release", "session-a", "--state", state])
    check("the owning session's release exits 0", code == 0)
    check("it says 'released'", "released" in said)
    check("the lock file is actually gone",
          not os.path.exists(prime_lock.lock_path(state)))

    code, said = run(["release", "session-a", "--state", state])
    check("releasing an already-free lock is a no-op success", code == 0)

    print("\n--- stale flow requires the explicit flag, never silently ---")
    prime_lock.write_lock(prime_lock.lock_path(state), "old-session",
                          "host-old", hours_ago(20))
    code, said = run(["check", "new-session", "--state", state,
                      "--stale-hours", "12"])
    check("checking another session's STALE lock exits 2 (a --take-stale "
          "decision is required; check refuses to imply it)", code == 2)
    check("it is labeled STALE, not treated as absent", "STALE" in said)
    check("it names --take-stale as the acquire path",
          "--take-stale" in said)

    code, said = run(["acquire", "new-session", "--state", state,
                      "--stale-hours", "12"])
    check("acquiring over a stale lock WITHOUT --take-stale is refused",
          code != 0)
    check("the refusal is labeled STALE, not a plain second-session "
          "refusal", "STALE" in said)
    check("the stale lock was not overwritten",
          read(state).get("session") == "old-session")

    code, said = run(["acquire", "new-session", "--state", state,
                      "--stale-hours", "12", "--take-stale"])
    check("acquiring over a stale lock WITH --take-stale succeeds",
          code == 0)
    check("it says who and why it took over",
          "old-session" in said and "took over" in said)
    check("the lock now names the new holder",
          read(state).get("session") == "new-session")

    print("\n--- the same threshold can call an old lock still fresh ---")
    prime_lock.write_lock(prime_lock.lock_path(state), "old-session",
                          "host-old", hours_ago(20))
    code, said = run(["check", "another-session", "--state", state,
                      "--stale-hours", "1000"])
    check("a wide-enough threshold reads the same 20-hour lock as fresh, "
          "so check exits 1", code == 1)
    check("the refusal still names the holder", "old-session" in said)

    print("\n--- an unreadable lock record fails closed, not open ---")
    os.makedirs(prime_lock.locks_dir(state), exist_ok=True)
    with open(prime_lock.lock_path(state), "w", encoding="utf-8") as handle:
        handle.write("not json at all {")
    code, said = run(["check", "session-c", "--state", state])
    check("checking another session's UNREADABLE lock exits 2 (fails "
          "closed - not provably fresh, needs a --take-stale decision)",
          code == 2)
    check("it says it could not be read", "could not be read" in said)

    code, said = run(["acquire", "session-c", "--state", state])
    check("acquiring over an unreadable lock without --take-stale is "
          "refused", code != 0)

    code, said = run(["acquire", "session-c", "--state", state,
                      "--take-stale"])
    check("acquiring over an unreadable lock WITH --take-stale succeeds",
          code == 0)
    check("the lock is valid JSON again, naming the new session",
          read(state).get("session") == "session-c")

    code, said = run(["release", "session-d", "--state", state])
    # Rewritten valid by the acquire just above, so this exercises the
    # ordinary wrong-session path, not the unreadable one - kept as its
    # own check because release's holder-naming reads a different field
    # path than check's and acquire's.
    check("release also refuses a session that never held the lock",
          code != 0)

    print("\n--- a malformed started-at (numeric or boolean) is STALE, "
          "never a crash ---")
    # Review finding A4 (2026-08-14): age_hours caught (TypeError,
    # ValueError) around started_at.replace(...) but not AttributeError,
    # so a lock record whose started_at is a number or a bool - valid
    # JSON, unreachable through this tool's own writes (now() always
    # returns a string) but reachable by hand-edit or a future writer -
    # raised an uncaught traceback on both check and acquire instead of
    # landing in the same "age cannot be established" path a list or a
    # dict already take. The module's own docstring promises such a lock
    # is "acquirable only with --take-stale, never silently" - a crash
    # breaks that promise by being acquirable with no flag at all
    # possible, since it never reaches the flag check.
    prime_lock.write_lock(prime_lock.lock_path(state), "num-session",
                          "host-num", 12345)
    code, said = run(["check", "session-f", "--state", state])
    check("a numeric started-at does not crash check, and exits 2",
          code == 2)
    check("it is STALE-labeled, its age unreadable",
          "STALE" in said and "could not be read" in said)

    code, said = run(["acquire", "session-f", "--state", state])
    check("acquiring over it without --take-stale does not crash, and "
          "is refused", code != 0)
    check("the refusal is STALE-labeled, not a crash", "STALE" in said)

    code, said = run(["acquire", "session-f", "--state", state,
                      "--take-stale"])
    check("acquiring over it WITH --take-stale succeeds", code == 0)
    check("the lock now names the new holder",
          read(state).get("session") == "session-f")

    prime_lock.write_lock(prime_lock.lock_path(state), "bool-session",
                          "host-bool", True)
    code, said = run(["check", "session-g", "--state", state])
    check("a boolean started-at does not crash check either, exits 2",
          code == 2)
    check("it is STALE-labeled the same way", "STALE" in said)

    print("\n--- BINDER_FLEET_STATE is read, not just documented ---")
    fleet_state = os.path.join(root, "env-state")
    old_env = os.environ.get("BINDER_FLEET_STATE")
    os.environ["BINDER_FLEET_STATE"] = fleet_state
    try:
        code, said = run(["acquire", "session-e"])
    finally:
        if old_env is None:
            os.environ.pop("BINDER_FLEET_STATE", None)
        else:
            os.environ["BINDER_FLEET_STATE"] = old_env
    check("an acquire given no --state at all exits 0", code == 0)
    check("it wrote under BINDER_FLEET_STATE, not the real fleet "
          "directory", os.path.isfile(
              os.path.join(fleet_state, "locks", "prime.json")))

    print("\n--- check's ruled exit table (0.9-M0-S17 MINOR1) ---")
    # The four rows in one place, because 0.9-M0-S19 branches session-open
    # on exactly these codes: 0 no-lock/own, 1 other-fresh, 2 other-stale
    # or other-unreadable. Each row against its own fresh state.
    table_state = os.path.join(root, "exit-table")
    code, _ = run(["check", "holder", "--state", table_state])
    check("row 0a: no lock at all -> exit 0", code == 0)
    prime_lock.write_lock(prime_lock.lock_path(table_state), "holder",
                          "host-h", prime_lock.now())
    code, _ = run(["check", "holder", "--state", table_state])
    check("row 0b: the caller's OWN fresh lock -> exit 0", code == 0)
    prime_lock.write_lock(prime_lock.lock_path(table_state), "holder",
                          "host-h", hours_ago(20))
    code, _ = run(["check", "holder", "--state", table_state])
    check("row 0c: the caller's OWN lock, even past staleness -> exit 0",
          code == 0)
    code, _ = run(["check", "other", "--state", table_state,
                   "--stale-hours", "1000"])
    check("row 1: another session's FRESH lock -> exit 1", code == 1)
    code, _ = run(["check", "other", "--state", table_state,
                   "--stale-hours", "12"])
    check("row 2a: another session's STALE lock -> exit 2", code == 2)
    os.makedirs(prime_lock.locks_dir(table_state), exist_ok=True)
    with open(prime_lock.lock_path(table_state), "w",
              encoding="utf-8") as handle:
        handle.write("}{ not json")
    code, _ = run(["check", "other", "--state", table_state])
    check("row 2b: another session's UNREADABLE lock -> exit 2 (closed)",
          code == 2)

    print("\n--- MAJOR2: concurrent --take-stale, exactly one winner ---")
    # Eight sessions all fire --take-stale at one barrier against a single
    # stale lock. The unconditional-rewrite takeover this slice replaced
    # let every one of them "win" (all exit 0, all believe they hold it);
    # the atomic capture-then-exclusive-install must yield exactly one.
    takeover_state = os.path.join(root, "concurrent-takeover")
    prime_lock.write_lock(prime_lock.lock_path(takeover_state), "victim",
                          "host-v", hours_ago(20))
    outcomes = barrier_trial(takeover_state, [
        ("acquire", "taker-%d" % i, ["--take-stale", "--stale-hours", "12"])
        for i in range(8)])
    dead = crashed(outcomes)
    check("none of the 8 concurrent callers crashed%s"
          % ("" if not dead else " - %s" % dead), not dead)
    winners = [session for session, code, _ in outcomes if code == 0]
    final = read(takeover_state)
    check("exactly one of 8 concurrent --take-stale callers wins",
          len(winners) == 1)
    check("the lock file survives and names a single taker",
          isinstance(final, dict)
          and str(final.get("session", "")).startswith("taker-"))
    check("the surviving holder is the session that reported success",
          bool(winners) and isinstance(final, dict)
          and final.get("session") == winners[0])

    print("\n--- MAJOR2: release never deletes a replacement lock ---")
    # A releasing old holder races takeovers. The bug: it reads its own
    # record, a takeover replaces it, and its unconditional unlink then
    # deletes the REPLACEMENT - leaving a taker that reported success with
    # no lock behind it. Invariant, over repeated synchronized storms: at
    # most one taker wins, and whenever one does the lock exists and names
    # exactly that taker. (Timing-independent for the fixed code; the
    # matching mutation in the handoff shows the reverted code violating.)
    trials = 8
    violations = 0
    protected = 0
    dead = []
    for trial in range(trials):
        rel_state = os.path.join(root, "concurrent-release-%d" % trial)
        prime_lock.write_lock(prime_lock.lock_path(rel_state), "holder",
                              "host-h", hours_ago(20))
        outcomes = barrier_trial(rel_state, [("release", "holder", [])]
                                 + [("acquire", "taker-%d" % i,
                                     ["--take-stale", "--stale-hours",
                                      "12"])
                                    for i in range(3)])
        dead.extend(crashed(outcomes))
        codes = exit_codes(outcomes)
        taker_wins = [s for s in codes
                      if s.startswith("taker-") and codes[s] == 0]
        final = read(rel_state)
        if len(taker_wins) > 1:
            violations += 1
        elif taker_wins:
            protected += 1
            if not (isinstance(final, dict)
                    and final.get("session") == taker_wins[0]):
                violations += 1
    check("over %d release/takeover storms, no invariant violation "
          "(a winner's lock is never deleted by the releaser)" % trials,
          violations == 0)
    check("and the storms actually produced a takeover winner to protect",
          protected > 0)
    # The arm the ticket's own deliverable rests on. This is what an exit-
    # code-only grading could not see: the crash the module was fixed to
    # stop reads as "did not win", never as a violation. See barrier_trial.
    check("and no contender in any of the %d storms crashed%s"
          % (trials, "" if not dead else " - %s" % dead), not dead)

    print("\n--- MAJOR2: the mutation mutex steals a crashed holder's ---")
    # A crashed session can leave its short-lived mutex behind. It must not
    # wedge the fleet forever: an old or unreadable mutex is stolen, and a
    # fresh one is respected. The end-to-end case proves a stale mutex left
    # over a stale lock does not block the takeover that clears both.
    mx_state = os.path.join(root, "mutex")
    prime_lock.write_lock(prime_lock.lock_path(mx_state), "victim",
                          "host-v", hours_ago(20))
    mpath = prime_lock.mutex_path(mx_state)
    # Staleness is the file's mtime age, deliberately NOT its contents: a
    # just-created empty mutex (the O_EXCL-then-write gap) must read fresh,
    # or a spinner would steal a live mutex and two holders would result.
    with open(mpath, "w", encoding="utf-8") as handle:
        handle.write("")
    check("a just-created (even empty) mutex reads fresh, never stale",
          not prime_lock.mutex_is_stale(mpath))
    old = time.time() - (prime_lock.MUTEX_STALE_SECONDS + 5)
    os.utime(mpath, (old, old))
    check("a mutex whose mtime is past the steal threshold is judged stale",
          prime_lock.mutex_is_stale(mpath))
    # End-to-end: a crashed holder's stale mutex left over a stale lock must
    # not wedge the takeover that clears both - it is stolen, single-winner.
    with open(mpath, "w", encoding="utf-8") as handle:
        handle.write('{"pid": 99999, "host": "dead"}')
    os.utime(mpath, (old, old))
    code, said = run(["acquire", "reaper-session", "--state", mx_state,
                      "--take-stale", "--stale-hours", "12"])
    check("a stale mutex does not wedge a takeover; it is stolen",
          code == 0)
    check("the takeover installed the new holder behind the stolen mutex",
          read(mx_state).get("session") == "reaper-session")
    check("a completed mutation leaves no mutex behind",
          not os.path.exists(mpath))

    print("\n--- S23 (#436): a transient PermissionError racing an "
          "exclusive create is contention, not a crash ---")
    # Reproduced live: a 100-iteration loop of the release/takeover storm
    # above crashed about 1 in 100 runs on Windows with an uncaught
    # `PermissionError: [Errno 13] Permission denied` from an exclusive
    # create that only caught FileExistsError. NTFS can present a file
    # mid-delete as access-denied rather than file-exists for a few
    # microseconds (see the module docstring's WINDOWS CAN REPORT A DELETE
    # RACE AS PermissionError section) - a real Windows filesystem fact,
    # not a fixture ordering bug, so it is injected deterministically here
    # rather than chased through another probabilistic storm. os.open is
    # patched process-wide for the span of one call because prime_lock.py
    # reaches it as `os.open` (the same module object this suite imports),
    # so patching the module attribute reaches prime_lock's call too;
    # restored in `finally` before anything else in the suite can observe
    # it.
    real_open = os.open

    def flaky_once(target):
        return flaky_once_matching(lambda path: path == target)

    def flaky_once_under(prefix):
        # publish_lock's create lands on a name it invents per call
        # (pid plus random bytes), so the primary-lock injection below
        # matches the prefix rather than one exact name.
        return flaky_once_matching(
            lambda path: isinstance(path, str) and path.startswith(prefix))

    def flaky_once_matching(wanted):
        calls = {"n": 0}

        def opener(path, flags, *a, **kw):
            if calls["n"] == 0 and wanted(path):
                calls["n"] += 1
                raise PermissionError(13, "Permission denied (injected, "
                                          "S23)")
            return real_open(path, flags, *a, **kw)
        return opener, calls

    # mutation_lock's own exclusive create on the mutex.
    inj_mutex_state = os.path.join(root, "injected-collision-mutex")
    opener, calls = flaky_once(prime_lock.mutex_path(inj_mutex_state))
    os.open = opener
    raised = None
    try:
        with prime_lock.mutation_lock(inj_mutex_state):
            pass
    except Exception as exc:  # proving NONE escapes
        raised = exc
    finally:
        os.open = real_open
    check("mutation_lock retries a transient PermissionError on the mutex "
          "instead of propagating it", raised is None)
    check("the injected collision actually fired once",
          calls["n"] == 1)
    check("the mutex is still cleaned up after the retried acquisition",
          not os.path.exists(prime_lock.mutex_path(inj_mutex_state)))

    # The acquire path's own exclusive create, which since the S23 fix
    # wave lands on the PRIVATE name publish_lock fills before it links
    # rather than on the lock file itself. The same Windows quirk
    # threatens that create exactly the way it threatens the mutex's, and
    # a fresh private name is what the retry buys.
    inj_primary_state = os.path.join(root, "injected-collision-primary")
    os.makedirs(prime_lock.locks_dir(inj_primary_state), exist_ok=True)
    opener, calls = flaky_once_under(
        prime_lock.lock_path(inj_primary_state) + ".filling-")
    os.open = opener
    raised, code = None, None
    try:
        code = prime_lock.main(["acquire", "session-inj", "--state",
                                inj_primary_state])
    except Exception as exc:  # proving NONE escapes
        raised = exc
    finally:
        os.open = real_open
    check("the acquire path retries a transient PermissionError on its "
          "private create instead of propagating it", raised is None)
    check("the injected collision actually fired once", calls["n"] == 1)
    check("the retried acquire still succeeds and installs the lock",
          raised is None and code == 0
          and read(inj_primary_state).get("session") == "session-inj")

    print("\n--- S23 (#436): a second, distinct race - a takeover must "
          "not mistake a two-step writer's unfilled gap for staleness "
          "---")
    # A 500-trial run of the release/takeover storm above (not this
    # suite's fixed 8, which is too few to reach it reliably) hit this
    # twice at the 200-trial mark, back when this module filled the lock
    # file in place after creating it: the create-then-fill gap left a
    # fast-path winner's record reading as {} for a moment, a concurrent
    # takeover read that as "its started-at could not be read" (STALE)
    # and, under --take-stale, unconditionally overwrote a winner it had
    # not finished announcing - two acquire callers both exited 0.
    # publish_lock closed that for this module's OWN writes (the arms
    # below), and settle_unreadable is what is left for a writer this
    # module does not control - an older copy of it out of a parallel
    # checkout is the ordinary case. That is the writer standing in here:
    # a background thread filling a file it created in two steps, on a
    # controlled clock instead of the storm's low, timing-dependent rate.
    settle_state = os.path.join(root, "settle-collision")
    os.makedirs(prime_lock.locks_dir(settle_state), exist_ok=True)
    settle_path = prime_lock.lock_path(settle_state)
    # The exact shape os.open(O_CREAT|O_EXCL) leaves behind before a
    # second call fills it: present, zero bytes, unreadable as JSON.
    os.close(os.open(settle_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY))

    def fill_after_pause():
        time.sleep(prime_lock.WRITE_SETTLE_SECONDS / 5)
        prime_lock.write_lock(settle_path, "winner", "host-w",
                              prime_lock.now())
    filler = threading.Thread(target=fill_after_pause)
    filler.start()
    code, said = run(["acquire", "challenger", "--state", settle_state,
                      "--take-stale", "--stale-hours", "12"])
    filler.join()
    check("a takeover racing a fast-path winner's unfilled gap settles "
          "onto the real, fresh record instead of stealing the gap - "
          "REFUSED, not acquired", code == 1 and "fresh lock" in said
          and "winner" in said)
    check("the winner's record survives untouched",
          read(settle_state).get("session") == "winner")

    print("\n--- S23 (#436): a third, distinct race - steal_mutex against "
          "a mutex it cannot move ---")
    # A review lead on #436 (S11's re-fire reviewer, unable to reproduce
    # the storm flake directly) named this one before it was found here:
    # a contender that loses the takeover race while another process
    # still holds the file handle. On Windows a subprocess holding the
    # mutex path open (standing in for a holder that is slow rather than
    # crashed) while its mtime is aged past the steal threshold makes the
    # graveyard replace raise exactly a `PermissionError` reading "the
    # process cannot access the file because it is being used by another
    # process", a THIRD mechanism behind the same error type as the
    # delete-pending race above but a genuinely different cause (a live
    # handle, not a timing sliver).
    #
    # WHY THE PROPERTY IS PROVED BY INJECTION AND THE LIVE HANDLE IS THE
    # SECOND ARM (S23 fix wave 2, #436). What steal_mutex must do is
    # absorb a denied move, whatever denied it - a property of this
    # module, true on every operating system. The live-handle fixture is
    # a Windows-only way to PRODUCE that denial, because the POSIX rename
    # system call succeeds against an open file; run on Linux it denies
    # nothing, the
    # steal goes through, and the arm passes without ever exercising the
    # catch it names. So the denial is injected into os.replace - the
    # same shape the os.remove and os.stat injections in this file use -
    # and the real handle is kept below as a second arm that SAYS it
    # skipped rather than passing for free.
    deny_state = os.path.join(root, "steal-denied-replace")
    deny_path = prime_lock.mutex_path(deny_state)
    os.makedirs(os.path.dirname(deny_path), exist_ok=True)
    with open(deny_path, "w", encoding="utf-8") as handle:
        handle.write('{"pid": 1, "host": "wedged", "at": "old"}')
    old = time.time() - (prime_lock.MUTEX_STALE_SECONDS + 5)
    os.utime(deny_path, (old, old))
    real_replace = os.replace

    def denied_replace(src, dst, *a, **kw):
        if src == deny_path:
            raise PermissionError(
                13, "The process cannot access the file because it is "
                    "being used by another process (injected, S23)")
        return real_replace(src, dst, *a, **kw)
    os.replace = denied_replace
    raised = None
    try:
        prime_lock.steal_mutex(deny_path)
    except Exception as exc:  # proving NONE escapes
        raised = exc
    finally:
        os.replace = real_replace
    check("steal_mutex against a mutex it cannot move does not crash - "
          "it is ordinary contention, retried by the caller's own spin "
          "loop", raised is None)
    check("and the mutex it could not move is still there, so the next "
          "spin sees a wedged holder rather than a free slot",
          os.path.exists(deny_path))

    if os.name == "nt":
        steal_state = os.path.join(root, "steal-open-handle")
        steal_path = prime_lock.mutex_path(steal_state)
        os.makedirs(os.path.dirname(steal_path), exist_ok=True)
        holder = subprocess.Popen(
            [sys.executable, "-c",
             "import sys, time\n"
             "with open(sys.argv[1], 'w', encoding='utf-8') as f:\n"
             "    f.write('{}')\n"
             "    f.flush()\n"
             "    print('HELD', flush=True)\n"
             "    time.sleep(2.0)\n",
             steal_path],
            stdout=subprocess.PIPE, text=True,
            encoding="utf-8", errors="replace")
        holder.stdout.readline()  # blocks until the subprocess has it open
        old = time.time() - (prime_lock.MUTEX_STALE_SECONDS + 5)
        os.utime(steal_path, (old, old))
        check("the held mutex reads as stale by mtime, same as a crashed "
              "holder's", prime_lock.mutex_is_stale(steal_path))
        raised = None
        try:
            prime_lock.steal_mutex(steal_path)
        except Exception as exc:  # proving NONE escapes
            raised = exc
        check("steal_mutex against a mutex a live process still has open "
              "does not crash - the denial above, produced by a real OS "
              "handle rather than injected", raised is None)
        holder.wait(timeout=10)
    else:
        skip("the held mutex reads as stale by mtime, same as a crashed "
             "holder's", NO_OPEN_HANDLE_DENIAL)
        skip("steal_mutex against a mutex a live process still has open "
             "does not crash - the denial above, produced by a real OS "
             "handle rather than injected", NO_OPEN_HANDLE_DENIAL)

    # The subprocess case above proves os.replace itself can raise
    # PermissionError against a live handle - and steal_mutex already
    # returns cleanly there without ever reaching its cleanup os.remove.
    # This proves the OTHER half of the same lead deterministically: a
    # SUCCESSFUL replace followed by a cleanup os.remove that itself
    # raises (a virus scanner or search indexer touching the graveyard
    # name in that split second is a real-world example, even though
    # this suite cannot force one live) must not crash the caller either
    # - the exclusivity `path` needed was already settled by the
    # successful replace, so a failed cleanup is a harmless orphan, not
    # a correctness problem. Injected by patching os.remove rather than
    # chasing a real race, since the graveyard name is only reachable by
    # the pid+random suffix steal_mutex itself just generated.
    remove_state = os.path.join(root, "steal-remove-collision")
    remove_path = prime_lock.mutex_path(remove_state)
    os.makedirs(os.path.dirname(remove_path), exist_ok=True)
    old = time.time() - (prime_lock.MUTEX_STALE_SECONDS + 5)
    with open(remove_path, "w", encoding="utf-8") as handle:
        handle.write('{"pid": 1, "host": "crashed", "at": "old"}')
    os.utime(remove_path, (old, old))
    real_remove = os.remove

    def flaky_remove(target, *a, **kw):
        if ".stealing-" in os.path.basename(target):
            raise PermissionError(13, "Permission denied (injected, S23)")
        return real_remove(target, *a, **kw)
    os.remove = flaky_remove
    raised = None
    try:
        prime_lock.steal_mutex(remove_path)
    except Exception as exc:  # proving NONE escapes
        raised = exc
    finally:
        os.remove = real_remove
    check("steal_mutex's own cleanup os.remove(graveyard) failing does "
          "not crash the caller", raised is None)
    check("the exclusivity that mattered (path itself) was still won - "
          "only the graveyard cleanup was interrupted",
          not os.path.exists(remove_path))

    print("\n--- S23 fix wave (#436): every arm of the mutex loop tests "
          "its own deadline ---")
    # The review finding this wave opened on. Catching PermissionError on
    # the steal arm without testing the deadline THERE turned a loud
    # crash into a sleepless hot loop: a live process holding a mutex
    # whose mtime is already past the steal threshold makes
    # mutex_is_stale answer True forever and steal_mutex fail forever,
    # and the old loop's `elif` meant the deadline arm was never reached
    # at all. Measured against the unfixed module: still spinning at 25 s
    # with MUTEX_TIMEOUT_SECONDS at 20.
    #
    # The real 20 s bound is shortened for the span of this check alone.
    # What is under test is the SHAPE of the loop - that it terminates at
    # whatever deadline it was given, on the arm the inputs select - and
    # a check that spends 20 s of the gate to prove it would be paid for
    # in every run forever. The constant itself is checked separately,
    # below, against the invariant the module argues for.
    check("the shipped timeout still outlasts the steal threshold, so a "
          "wedged fleet recovers rather than every waiter timing out",
          prime_lock.MUTEX_TIMEOUT_SECONDS > prime_lock.MUTEX_STALE_SECONDS)
    # UNSTEALABLE IS INJECTED, NOT HELD OPEN (S23 fix wave 2, #436). The
    # first version made the mutex unstealable by holding its handle in a
    # live subprocess, which is a Windows-only condition: on Linux the
    # POSIX rename system call succeeds against an open file, so the
    # steal went through,
    # the acquire succeeded, no TimeoutError was raised and the arm's own
    # premise was false - CI on ubuntu-latest red on exactly that while
    # every Windows run was green. What is under test is the loop's
    # SHAPE, so the "cannot steal" condition is injected into os.replace
    # and the property is proved identically on every platform; the real
    # open handle stays as a Windows-only second arm below.
    spin_state = os.path.join(root, "unstealable-mutex")
    spin_path = prime_lock.mutex_path(spin_state)
    os.makedirs(os.path.dirname(spin_path), exist_ok=True)
    with open(spin_path, "w", encoding="utf-8") as handle:
        handle.write('{"pid": 1, "host": "wedged", "at": "old"}')
    old = time.time() - (prime_lock.MUTEX_STALE_SECONDS + 5)
    os.utime(spin_path, (old, old))
    check("the mutex under test reads STALE by mtime, so the steal arm "
          "is the one this loop keeps selecting",
          prime_lock.mutex_is_stale(spin_path))
    real_replace = os.replace
    attempts = {"n": 0}

    def unstealable_replace(src, dst, *a, **kw):
        if src == spin_path:
            attempts["n"] += 1
            raise PermissionError(
                13, "The process cannot access the file because it is "
                    "being used by another process (injected, S23)")
        return real_replace(src, dst, *a, **kw)
    real_timeout = prime_lock.MUTEX_TIMEOUT_SECONDS
    prime_lock.MUTEX_TIMEOUT_SECONDS = 1.0
    os.replace = unstealable_replace
    raised, elapsed = None, None
    try:
        started = time.monotonic()
        try:
            with prime_lock.mutation_lock(spin_state):
                pass
        except Exception as exc:  # the point is WHICH one escapes
            raised = exc
        elapsed = time.monotonic() - started
    finally:
        prime_lock.MUTEX_TIMEOUT_SECONDS = real_timeout
        os.replace = real_replace
    check("mutation_lock against an unstealable stale mutex fails LOUDLY "
          "instead of spinning - it raises TimeoutError",
          isinstance(raised, TimeoutError))
    check("and it does so inside its own deadline rather than past it "
          "(%.2f s against a 1.0 s bound)"
          % (elapsed if elapsed is not None else -1.0),
          elapsed is not None and elapsed < 5.0)
    check("and the timeout names the error that kept it out, not just "
          "'a holder is wedged'",
          raised is not None
          and ("FileExistsError" in str(raised)
               or "PermissionError" in str(raised)))
    # Without this the arm above would still pass if the loop gave up on
    # the FIRST failed steal: the deadline being reached is not by itself
    # proof that the steal arm is where the loop spent the interval.
    check("and the steal arm is where every pass went - the denied move "
          "was attempted many times, not once (%d attempts)"
          % attempts["n"], attempts["n"] > 1)

    if os.name == "nt":
        held_state = os.path.join(root, "unstealable-open-handle")
        held_path = prime_lock.mutex_path(held_state)
        os.makedirs(os.path.dirname(held_path), exist_ok=True)
        live = subprocess.Popen(
            [sys.executable, "-c",
             "import sys, time\n"
             "with open(sys.argv[1], 'w', encoding='utf-8') as f:\n"
             "    f.write('{}')\n"
             "    f.flush()\n"
             "    print('HELD', flush=True)\n"
             "    time.sleep(30.0)\n",
             held_path],
            stdout=subprocess.PIPE, text=True,
            encoding="utf-8", errors="replace")
        live.stdout.readline()  # blocks until the subprocess has it open
        old = time.time() - (prime_lock.MUTEX_STALE_SECONDS + 5)
        os.utime(held_path, (old, old))
        prime_lock.MUTEX_TIMEOUT_SECONDS = 1.0
        raised = None
        try:
            with prime_lock.mutation_lock(held_state):
                pass
        except Exception as exc:  # the point is WHICH one escapes
            raised = exc
        finally:
            prime_lock.MUTEX_TIMEOUT_SECONDS = real_timeout
            live.kill()
            live.wait()
        check("the same bound holds against a REAL open handle rather "
              "than an injected denial - TimeoutError, not a hot loop",
              isinstance(raised, TimeoutError))
    else:
        skip("the same bound holds against a REAL open handle rather "
             "than an injected denial - TimeoutError, not a hot loop",
             NO_OPEN_HANDLE_DENIAL)

    print("\n--- S23 fix wave (#436): settle_unreadable's own stat takes "
          "the same Windows error its siblings do ---")
    # The one function the slice ADDED was the one place it did not apply
    # its own rule: os.stat caught FileNotFoundError alone, so the very
    # PermissionError the slice exists to absorb escaped do_acquire as an
    # uncaught traceback. Injected in the shape of the twelve checks
    # above; os.stat is patched process-wide for the span of one call and
    # restored in `finally` before anything else can observe it.
    stat_state = os.path.join(root, "injected-collision-stat")
    os.makedirs(prime_lock.locks_dir(stat_state), exist_ok=True)
    with open(prime_lock.lock_path(stat_state), "w",
              encoding="utf-8") as handle:
        handle.write("not json at all {")
    real_stat = os.stat
    stat_calls = {"n": 0}

    def flaky_stat(path, *a, **kw):
        if path == prime_lock.lock_path(stat_state) and stat_calls["n"] == 0:
            stat_calls["n"] += 1
            raise PermissionError(13, "Permission denied (injected, S23)")
        return real_stat(path, *a, **kw)
    os.stat = flaky_stat
    raised, code, said = None, None, ""
    try:
        code, said = run(["acquire", "session-stat", "--state", stat_state])
    except Exception as exc:  # proving NONE escapes
        raised = exc
    finally:
        os.stat = real_stat
    check("a transient PermissionError on settle_unreadable's stat does "
          "not escape do_acquire", raised is None)
    check("the injected collision actually fired once", stat_calls["n"] == 1)
    check("the acquire still lands on its ordinary refusal rather than a "
          "traceback", raised is None and code != 0 and "STALE" in said)

    print("\n--- S23 fix wave (#436): the lock is PUBLISHED whole, so no "
          "contender can ever see it half-written ---")
    # The race the slice narrowed to a 0.25 s budget, closed by
    # construction instead. Measured on the budgeted version: a 0.6 s
    # stall between the exclusive create and the fill produced two
    # winners and a permanently unreadable lock file five times out of
    # five. There is no interval to widen here - the record is complete
    # before the name it lands on exists.
    pub_state = os.path.join(root, "publish-contract")
    pub_path = prime_lock.lock_path(pub_state)
    check("publishing onto a free name wins",
          prime_lock.publish_lock(pub_path, "first", "host-p",
                                  prime_lock.now()) is True)
    check("and the record is whole the moment the name exists",
          read(pub_state).get("session") == "first")
    check("publishing onto a taken name LOSES - no retry, no overwrite",
          prime_lock.publish_lock(pub_path, "second", "host-p",
                                  prime_lock.now()) is False)
    check("and the loser wrote nothing over the winner's record",
          read(pub_state).get("session") == "first")
    check("a publish leaves no private file behind",
          os.listdir(prime_lock.locks_dir(pub_state)) == ["prime.json"])

    # The property itself, watched from inside: at the instant before the
    # name is claimed, there is nothing at it to misread.
    watch_state = os.path.join(root, "publish-watch")
    watch_path = prime_lock.lock_path(watch_state)
    real_link = os.link
    seen = []

    def watching_link(src, dst, *a, **kw):
        if dst == watch_path:
            seen.append(prime_lock.read_lock(watch_path))
        return real_link(src, dst, *a, **kw)
    os.link = watching_link
    try:
        run(["acquire", "watched", "--state", watch_state])
    finally:
        os.link = real_link
    check("what a contender would find at the lock path one instant "
          "before the publish: nothing at all, never a partial record",
          seen == [None])

    # Both interleavings of a contender against the publish, driven at
    # the exact instant rather than hoped for by a stall. A nested
    # acquire re-enters os.link, so each hook fires once.
    def publish_race(when, race_state):
        """Drive a rival acquire in immediately before or after a publish.

        Returns (publisher's outcome, rival's outcome, hook fire count).
        A function rather than a loop body because the hook closes over
        `when` and `race_state`, and a closure over a loop variable is
        the bug this shape exists to rule out.
        """
        race_path = prime_lock.lock_path(race_state)
        fired = {"n": 0}
        rival = {}

        def racing_link(src, dst, *a, **kw):
            if dst != race_path or fired["n"]:
                return real_link(src, dst, *a, **kw)
            fired["n"] += 1
            contend = ["acquire", "rival", "--state", race_state,
                       "--take-stale", "--stale-hours", "12"]
            if when == "before":
                rival["out"] = run(contend)
                return real_link(src, dst, *a, **kw)
            result = real_link(src, dst, *a, **kw)
            rival["out"] = run(contend)
            return result
        os.link = racing_link
        try:
            mine = run(["acquire", "publisher", "--state", race_state])
        finally:
            os.link = real_link
        return mine, rival.get("out", (None, "")), fired["n"]

    for when in ("before", "after"):
        race_state = os.path.join(root, "publish-race-%s" % when)
        mine, theirs, fires = publish_race(when, race_state)
        code, said = mine
        rival_code, rival_said = theirs
        # Without this the whole arm passes vacuously if the publish ever
        # stops going through os.link: the rival would simply never be
        # driven in, and one uncontended winner looks exactly like one
        # contended winner.
        check("a rival arriving %s the publish: the rival was actually "
              "driven in at that instant" % when, fires == 1)
        check("a rival arriving %s the publish: exactly one of the two "
              "wins" % when,
              [code, rival_code].count(0) == 1)
        check("a rival arriving %s the publish: the lock file is readable "
              "and names that winner" % when,
              read(race_state).get("session")
              == ("rival" if rival_code == 0 else "publisher"))
        check("a rival arriving %s the publish: the loser is REFUSED "
              "against a FRESH lock, never handed a stale one to take"
              % when,
              "fresh lock" in (said if code else rival_said))

    # And a publisher that DIES between filling and publishing: the name
    # it was going to claim was never created, so the next caller wins it
    # cleanly rather than inheriting a wedged record.
    crash_state = os.path.join(root, "publish-crash")
    os.makedirs(prime_lock.locks_dir(crash_state), exist_ok=True)
    dying = subprocess.run(
        [sys.executable, "-c",
         "import os, sys\n"
         "sys.path.insert(0, sys.argv[1])\n"
         "import prime_lock\n"
         "real = os.link\n"
         "def die(src, dst, *a, **kw):\n"
         "    if dst == prime_lock.lock_path(sys.argv[2]):\n"
         "        os._exit(3)\n"
         "    return real(src, dst, *a, **kw)\n"
         "os.link = die\n"
         "prime_lock.main(['acquire', 'doomed', '--state', sys.argv[2]])\n",
         TOOLS_DIR, crash_state],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
        encoding="utf-8", errors="replace")
    check("a publisher killed between filling and publishing exits "
          "nonzero without a traceback",
          dying.returncode != 0 and "Traceback" not in (dying.stderr or ""))
    check("and it left no lock file for anyone to inherit",
          not os.path.exists(prime_lock.lock_path(crash_state)))
    code, _ = run(["acquire", "after-crash", "--state", crash_state])
    check("so the next caller acquires cleanly, no --take-stale needed",
          code == 0
          and read(crash_state).get("session") == "after-crash")

    print("\n--- S23 fix wave (#436): a contender that CRASHES reds the "
          "storm arms, where an exit code alone did not ---")
    # The ticket's own deliverable ("the storm arm stops flaking") was
    # unproven because barrier_trial graded workers by exit code: a
    # crashed taker exits nonzero, which reads as "did not win", never as
    # a violation. Twenty-five runs of the unfixed module printed a
    # worker traceback in four of them and every one exited 0. This check
    # proves the new grading catches a real dying worker - and that its
    # exit code alone still reads as an ordinary loss, which is exactly
    # why the old grading let it through. A directory where the record
    # belongs is a deterministic way to kill a contender inside the real
    # code path; any real crash would serve.
    dying_state = os.path.join(root, "crashing-contender")
    os.makedirs(prime_lock.locks_dir(dying_state), exist_ok=True)
    os.makedirs(prime_lock.lock_path(dying_state), exist_ok=True)
    outcomes = barrier_trial(dying_state, [
        ("acquire", "doomed", ["--take-stale", "--stale-hours", "12"])])
    dead = crashed(outcomes)
    check("a contender that dies with a traceback is graded as a crash",
          [session for session, _ in dead] == ["doomed"])
    check("the grading names what it died of, so a red can be acted on",
          bool(dead) and "Error" in dead[0][1])
    check("while its exit code alone reads as an ordinary loss - the "
          "reason exit-code grading let the storm crash through",
          exit_codes(outcomes)["doomed"] != 0)
    check("and a clean contender is not graded as a crash",
          crashed([("fine", 1, "REFUSED: somebody else holds it\n")]) == [])

print("\n%d checks, %d failure(s)" % (performed, failures))
if skipped:
    # Printed rather than folded into the total: a skip is counted so
    # EXPECTED stays one number everywhere, and named here so nobody
    # reads a green run as proof of a check this platform never ran.
    print("%d of those checks were SKIPPED on this platform (os.name=%r) "
          "- see the 'skip' lines above for the condition each one needs."
          % (skipped, os.name))
if performed != EXPECTED:
    print("EXPECTED %d checks and %d ran. A suite that quietly stops "
          "running is a suite that quietly stops checking."
          % (EXPECTED, performed))
    sys.exit(1)
sys.exit(1 if failures else 0)
