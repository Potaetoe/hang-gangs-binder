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
import sys
import tempfile
from contextlib import redirect_stdout

# Both modules under test sit in this file's own directory, which Python
# puts on the path for a script it is handed - a plain import is the
# whole wiring.
import agent_init
import prime_lock

failures = 0
performed = 0

# Asserted at the end rather than only printed - a hand-written total
# nothing compares against still prints a confident pass when a check
# stops running, which is the armed-looking-but-not failure this
# repository holds to be worse than no check at all.
EXPECTED = 49


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
    check("a second session's check on a fresh lock exits nonzero",
          code != 0)
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
    check("checking a lock stale under the given threshold exits 0",
          code == 0)
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
    check("a wide-enough threshold reads the same 20-hour lock as fresh",
          code != 0)
    check("the refusal still names the holder", "old-session" in said)

    print("\n--- an unreadable lock record fails closed, not open ---")
    os.makedirs(prime_lock.locks_dir(state), exist_ok=True)
    with open(prime_lock.lock_path(state), "w", encoding="utf-8") as handle:
        handle.write("not json at all {")
    code, said = run(["check", "session-c", "--state", state])
    check("checking an unreadable lock exits 0 (not provably fresh)",
          code == 0)
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

print("\n%d checks, %d failure(s)" % (performed, failures))
if performed != EXPECTED:
    print("EXPECTED %d checks and %d ran. A suite that quietly stops "
          "running is a suite that quietly stops checking."
          % (EXPECTED, performed))
    sys.exit(1)
sys.exit(1 if failures else 0)
