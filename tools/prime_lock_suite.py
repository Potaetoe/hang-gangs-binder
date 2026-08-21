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

    Returns [(session, exit_code), ...] in spec order. The lock's own
    directory must already exist (every caller seeds a record first), so
    the GO file has somewhere to live that every worker agrees on.
    """
    go = os.path.join(prime_lock.locks_dir(state), "GO")
    procs = []
    for verb, session, flags in specs:
        procs.append((session, subprocess.Popen(
            [sys.executable, "-c", _WORKER, TOOLS_DIR, state, verb,
             session, go, *flags])))
    # Let every worker reach its spin loop before firing the barrier, so
    # the contention is real. Correctness does not depend on perfect
    # simultaneity - the single-winner invariant holds under any
    # interleaving - but a tighter barrier makes a broken invariant far
    # likelier to be caught.
    time.sleep(0.25)
    open(go, "w").close()
    return [(session, proc.wait()) for session, proc in procs]

# Asserted at the end rather than only printed - a hand-written total
# nothing compares against still prints a confident pass when a check
# stops running, which is the armed-looking-but-not failure this
# repository holds to be worse than no check at all.
EXPECTED = 85


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
        print("FAIL  %s" % label)
    else:
        print("ok    %s" % label)


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
    winners = [session for session, code in outcomes if code == 0]
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
    for trial in range(trials):
        rel_state = os.path.join(root, "concurrent-release-%d" % trial)
        prime_lock.write_lock(prime_lock.lock_path(rel_state), "holder",
                              "host-h", hours_ago(20))
        outcomes = dict(barrier_trial(rel_state, [("release", "holder", [])]
                        + [("acquire", "taker-%d" % i,
                            ["--take-stale", "--stale-hours", "12"])
                           for i in range(3)]))
        taker_wins = [s for s in outcomes
                      if s.startswith("taker-") and outcomes[s] == 0]
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
        calls = {"n": 0}

        def opener(path, flags, *a, **kw):
            if path == target and calls["n"] == 0:
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

    # do_acquire's own exclusive create on the primary lock file - the
    # same Windows quirk threatens this fast path exactly the same way,
    # racing a concurrent release rather than a concurrent takeover.
    inj_primary_state = os.path.join(root, "injected-collision-primary")
    os.makedirs(prime_lock.locks_dir(inj_primary_state), exist_ok=True)
    opener, calls = flaky_once(prime_lock.lock_path(inj_primary_state))
    os.open = opener
    raised, code = None, None
    try:
        code = prime_lock.main(["acquire", "session-inj", "--state",
                                inj_primary_state])
    except Exception as exc:  # proving NONE escapes
        raised = exc
    finally:
        os.open = real_open
    check("do_acquire retries a transient PermissionError on the primary "
          "lock instead of propagating it", raised is None)
    check("the injected collision actually fired once", calls["n"] == 1)
    check("the retried acquire still succeeds and installs the lock",
          raised is None and code == 0
          and read(inj_primary_state).get("session") == "session-inj")

    print("\n--- S23 (#436): a second, distinct race - a takeover must "
          "not mistake a fast-path winner's unfilled gap for staleness "
          "---")
    # A 500-trial run of the release/takeover storm above (not this
    # suite's fixed 8, which is too few to reach it reliably) hit this
    # twice at the 200-trial mark: write_new_lock's own create-then-fill
    # gap (its docstring already names it: "the gap between the file
    # existing and the file being readable ... cannot be closed from
    # this end, only narrowed") left a fast-path winner's record reading
    # as {} for a moment, a concurrent takeover read that as "its
    # started-at could not be read" (STALE) and, under --take-stale,
    # unconditionally overwrote a winner it had not finished announcing -
    # two acquire callers both exited 0. settle_unreadable gives the gap
    # a bounded moment to close before a takeover decision trusts it.
    # Injected deterministically with a background thread standing in
    # for the racing fast-path winner, on a controlled clock instead of
    # the storm's own low, timing-dependent rate.
    settle_state = os.path.join(root, "settle-collision")
    os.makedirs(prime_lock.locks_dir(settle_state), exist_ok=True)
    settle_path = prime_lock.lock_path(settle_state)
    # The exact shape os.open(O_CREAT|O_EXCL) leaves behind before
    # write_new_lock fills it: present, zero bytes, unreadable as JSON.
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
          "a mutex a real process still has open ---")
    # A review lead on #436 (S11's re-fire reviewer, unable to reproduce
    # the storm flake directly) named this one before it was found here:
    # a contender that loses the takeover race while another process
    # still holds the file handle. Reproduced directly - a subprocess
    # holding the mutex path open (standing in for a holder that is slow
    # rather than crashed) while its mtime is aged past the steal
    # threshold makes os.replace(path, graveyard) raise exactly
    # `PermissionError(13, 'The process cannot access the file because
    # it is being used by another process')`, a THIRD mechanism behind
    # the same error type as the delete-pending race above but a
    # genuinely different cause (a live handle, not a timing sliver).
    # steal_mutex already treats it as ordinary contention; this proves
    # that call, live, with a real OS-level open handle rather than a
    # monkeypatched os.open.
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
        stdout=subprocess.PIPE, text=True)
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
          "does not crash - it is ordinary contention, retried by the "
          "caller's own spin loop", raised is None)
    holder.wait(timeout=10)

    # The subprocess case above proves os.replace itself can raise
    # PermissionError against a live handle - and steal_mutex already
    # returns cleanly there without ever reaching os.remove(graveyard).
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

print("\n%d checks, %d failure(s)" % (performed, failures))
if performed != EXPECTED:
    print("EXPECTED %d checks and %d ran. A suite that quietly stops "
          "running is a suite that quietly stops checking."
          % (EXPECTED, performed))
    sys.exit(1)
sys.exit(1 if failures else 0)
