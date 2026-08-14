#!/usr/bin/env python3
"""
One Prime at a time - the twice-bitten guard, as mechanism.

    py -3 tools/prime_lock.py acquire <session-id>
    py -3 tools/prime_lock.py check   <session-id>
    py -3 tools/prime_lock.py release <session-id>

Audit finding F11 named this: this fleet has been bitten by a second
Prime session running concurrently with a first TWICE (#36, then again
on #187/PR#199), both times because nothing on the machine could tell a
second session it was not alone. Ticket #296 turns the warning into a
mechanism a second session actually trips over, rather than a paragraph
it could have read and did not.

WHERE THE LOCK LIVES, AND WHY THIS SCRIPT WRITES NO NEW PRIMITIVE

Machine-held, under the fleet's state directory - the same directory
tools/agent_init.py's leases and worktree records live in, and reached
the same way: `BINDER_FLEET_STATE`, defaulting to `~/.claude/binder-fleet`.
A single JSON record at `<state>/locks/prime.json`. This module imports
`now`, `read_json`, `write_json` and `state_dir` from agent_init rather
than writing them again - two copies of "how a fleet record is read and
written" is two chances for one of them to drift, and agent_init's copy
is the one every other mechanism on this machine already trusts.

THE ATOMICITY THIS SCRIPT DOES OWN

The one new primitive here is the acquire race on a lock nobody holds
yet, and it is closed exactly the way `agent_init.take_lease` closes the
equivalent race for a port block: the lock file is created with
`O_CREAT | O_EXCL`, which the operating system guarantees at most one
caller wins. Two Prime sessions racing to open with neither lock present
cannot both succeed - one gets the descriptor, the other gets
`FileExistsError` and reads what the winner wrote. A read-then-write
without that flag would let both sessions read "no lock", both decide
they are first, and both write last - which is the exact failure this
ticket exists to close, reintroduced by the tool meant to close it.

STALENESS IS NEVER SILENT

A lock older than the threshold (12 hours by default, `--stale-hours`
to change it) is reported STALE rather than treated as absent. Taking it
over requires `--take-stale`, spelled out on the command line - never
implied by any other flag, never automatic on a fresh acquire. The
threshold answers "how old is too old to trust", not "how old is too old
to use" - a stale lock is still read and still named in every message,
because a session about to override one owes the next reader the name of
who it overrode and why the override was thought safe.

WHAT "OWN SESSION" MEANS

`acquire` and `check` both special-case the caller's own session id
before asking whether the lock is stale: a session re-acquiring or
checking a lock it already holds gets a plain "yes", regardless of how
old that lock has become, because staleness is a question about whether
a DIFFERENT session may trust the record, not about whether this one
still may. `release` only ever removes a lock naming the caller's own
session - the same asymmetry `agent_init.release_lease` already holds
for a port block, and for the same reason: a release that could clear
somebody else's claim is a second way to reintroduce the double-session
failure this file exists to prevent.
"""

import argparse
import datetime
import json
import os
import socket
import sys

import agent_init
from agent_init import now, read_json, write_json

# This module's own record shape, versioned independently of
# agent_init.SCHEMA - a lock record and a lease record are different
# facts about different lifetimes, and coupling their version numbers
# would make a change to one look like a change to both.
SCHEMA = 1

# The owner's default (ticket #296's scope line): a session left running
# for half a day without releasing is treated as abandoned rather than
# trusted forever. Always overridable, never silently - see the module
# docstring.
DEFAULT_STALE_HOURS = 12.0


def locks_dir(state=None):
    return os.path.join(state or agent_init.state_dir(), "locks")


def lock_path(state=None):
    return os.path.join(locks_dir(state), "prime.json")


def read_lock(path):
    """The lock record at `path`: None if absent, {} if unreadable.

    The same distinction agent_init.read_lease draws, and for the same
    reason: `O_CREAT | O_EXCL` guarantees the file exists before its
    contents do, so a reader arriving in that gap sees a real file with
    nothing parseable in it. Answering None there would read as "no
    lock" and let a second acquire step straight past a session that is
    mid-write - the opposite error, and the one this mechanism exists to
    rule out.
    """
    if not os.path.exists(path):
        return None
    existing = read_json(path)
    return existing if isinstance(existing, dict) else {}


def lock_record(session, host, started_at):
    return {"schema": SCHEMA, "session": session, "host": host,
            "started_at": started_at}


def write_lock(path, session, host, started_at):
    write_json(path, lock_record(session, host, started_at))


def write_new_lock(handle, session, host, started_at):
    """Fill a lock through the descriptor an exclusive create returned.

    One open, not an open-close-reopen: agent_init.write_new_lease makes
    the same argument for a port lease and it holds here unchanged - the
    gap between the file existing and the file being readable is real on
    this platform, and `read_lock` above exists because that gap cannot
    be closed from this end, only narrowed.
    """
    with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as file:
        json.dump(lock_record(session, host, started_at), file, indent=2,
                  sort_keys=True)
        file.write("\n")


def age_hours(started_at):
    """Hours since `started_at`, or None if it cannot be parsed.

    None is a third answer, not a rounding of the other two: it means
    "this record's age cannot be established", and every caller below
    treats that the same way it treats a lock proven past the threshold
    - acquirable only with --take-stale, never silently. A lock this
    script cannot date is not a lock it can vouch for as fresh.
    """
    if not started_at:
        return None
    try:
        when = datetime.datetime.fromisoformat(
            started_at.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=datetime.timezone.utc)
    delta = datetime.datetime.now(datetime.timezone.utc) - when
    return delta.total_seconds() / 3600.0


def staleness(record, threshold_hours):
    """None if `record` is fresh; else the sentence saying why it is not.

    The sentence is the product, not a side effect of computing it: a
    caller printing "STALE" with no reason attached cannot be checked by
    a reader who was not in the room when it ran.
    """
    hours = age_hours(record.get("started_at"))
    if hours is None:
        return ("its started-at (%r) could not be read, so its age "
                "cannot be established" % record.get("started_at"))
    if hours < threshold_hours:
        return None
    return ("it started %.1f hour(s) ago, at or past the %.1f hour "
            "staleness threshold" % (hours, threshold_hours))


def describe(record):
    hours = age_hours(record.get("started_at"))
    age = ("%.1f hour(s) old" % hours) if hours is not None \
        else "of unreadable age"
    return ("session %s on host %s, started %s (%s)"
            % (record.get("session", "<unnamed>"),
               record.get("host", "<unknown>"),
               record.get("started_at", "<unknown>"), age))


# A lock file that vanished between a failed exclusive create and the
# read that follows it means a release raced this call in the gap - real,
# but narrow, and worth one more attempt rather than either an infinite
# retry (nothing here waits forever) or reporting a race as a refusal.
ACQUIRE_ATTEMPTS = 3


def do_acquire(args):
    state = args.state
    path = lock_path(state)
    session = args.session
    host = args.host or socket.gethostname()
    os.makedirs(locks_dir(state), exist_ok=True)

    for _ in range(ACQUIRE_ATTEMPTS):
        try:
            handle = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            existing = read_lock(path)
            if existing is None:
                continue
            if existing.get("session") == session:
                write_lock(path, session, host, now())
                print("re-acquired: %s - refreshed started-at"
                      % describe(existing))
                return 0
            reason = staleness(existing, args.stale_hours)
            if reason is None:
                print("REFUSED: %s holds a fresh lock (%s) - one Prime "
                      "at a time; STOP and surface to the owner instead "
                      "of working"
                      % (existing.get("session", "<unnamed>"),
                         describe(existing)))
                return 1
            if not args.take_stale:
                print("STALE: %s (%s) - acquirable only with "
                      "--take-stale, never silently"
                      % (describe(existing), reason))
                return 1
            write_lock(path, session, host, now())
            print("acquired: took over a stale lock - %s (%s)"
                  % (describe(existing), reason))
            return 0
        else:
            write_new_lock(handle, session, host, now())
            print("acquired: new lock for session %s" % session)
            return 0

    print("REFUSED: could not establish %s's state after %d attempt(s) - "
          "something is racing this call" % (path, ACQUIRE_ATTEMPTS))
    return 1


def do_check(args):
    state = args.state
    path = lock_path(state)
    existing = read_lock(path)
    if existing is None:
        print("no lock: %s" % path)
        return 0
    if not existing:
        print("the lock file at %s exists but could not be read, so no "
              "fresh holder can be established" % path)
        return 0
    if existing.get("session") == args.session:
        print("own session: %s" % describe(existing))
        return 0
    reason = staleness(existing, args.stale_hours)
    if reason is None:
        print("REFUSED: %s holds a fresh lock (%s) - STOP and surface to "
              "the owner instead of working"
              % (existing.get("session", "<unnamed>"), describe(existing)))
        return 1
    print("STALE: %s (%s) - acquirable with --take-stale" % (
        describe(existing), reason))
    return 0


def do_release(args):
    state = args.state
    path = lock_path(state)
    existing = read_lock(path)
    if existing is None:
        print("no lock to release: %s" % path)
        return 0
    if not existing or existing.get("session") != args.session:
        holder = existing.get("session") if existing else "<unreadable>"
        print("REFUSED: the lock is held by %s, not %s - release only "
              "ever removes its own session's lock"
              % (holder, args.session))
        return 1
    os.remove(path)
    print("released: %s's lock removed" % args.session)
    return 0


VERBS = {"acquire": do_acquire, "check": do_check, "release": do_release}


def build_parser():
    parser = argparse.ArgumentParser(
        prog="py -3 tools/prime_lock.py",
        description="One Prime session at a time - the twice-bitten "
                    "guard (audit F11; #36, #187/PR#199) as mechanism.")
    parser.add_argument("verb", choices=sorted(VERBS),
                        help="acquire, check, or release the lock")
    parser.add_argument("session", help="this session's identifier")
    parser.add_argument("--stale-hours", type=float,
                        default=DEFAULT_STALE_HOURS,
                        help="age in hours past which the lock counts as "
                             "stale (default %(default)s)")
    parser.add_argument("--take-stale", action="store_true",
                        help="acquire only: take over a lock already "
                             "proven stale. Never implied by any other "
                             "flag, and ignored by check/release.")
    # Suppressed: real callers use BINDER_FLEET_STATE (see agent_init's
    # own pattern) or the machine default. This exists so a suite can
    # drive the mechanism against a fabricated state directory instead
    # of the real one - the same reason reaper.py's --state is
    # suppressed rather than documented.
    parser.add_argument("--state", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--host", default=None, help=argparse.SUPPRESS)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    return VERBS[args.verb](args)


if __name__ == "__main__":
    sys.exit(main())
