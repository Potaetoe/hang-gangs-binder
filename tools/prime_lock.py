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

CHECK'S EXIT CODES ARE A RULED CONTRACT (Prime, 2026-08-14; 0.9-M0-S17)

`check` is what a session-open runs to decide whether it may proceed, so
its exit code is an interface another tool branches on - 0.9-M0-S19 wires
exactly this table into `./run session-open` and depends on it verbatim.
The table, and it fails CLOSED for another session's unusable record:

    0   no lock, OR the caller's OWN lock at any age - staleness is a
        question about whether a DIFFERENT session may trust the record,
        never about whether this one still holds it (see WHAT "OWN
        SESSION" MEANS above), so an own lock past the threshold is still
        a 0 for its own holder.
    1   another session holds a FRESH lock - STOP and surface to the owner.
    2   another session holds a STALE or UNREADABLE lock - proceeding over
        it needs an explicit --take-stale decision, so check refuses to
        imply that decision by exiting 0. Fail closed, not open.

`acquire` and `release` keep their two-valued shells (0 success, 1
refused); only `check` carries this three-way table, because only check
is the branch a caller reads before deciding what to do.

THE ATOMICITY OF TAKEOVER AND RELEASE (0.9-M0-S17, 2nd-audit MAJOR2)

The initial acquire is single-winner because `O_CREAT | O_EXCL` is, and
that fast path is preserved untouched. Taking over a stale lock and
releasing one must be single-winner for the same kind of reason, and
before this slice they were not: the takeover read the stale record and
then rewrote the file UNCONDITIONALLY, so two `--take-stale` callers both
read one stale record and both "won"; the release read the record and
then unlinked UNCONDITIONALLY, so an old holder could delete a
REPLACEMENT lock that a takeover installed in the gap between its read
and its unlink. Both are read-modify-writes, and both are closed by
`mutation_lock` - a short-lived mutex around exactly those critical
sections. A move-based compare-and-swap closes the takeover alone, but
not the release: to inspect a record the release must first move it out
of the slot, and that empty-slot window lets a third caller acquire, so
two callers still end up believing they hold it (a real regression this
slice's synchronized release test caught). The mutex has no such window -
under it there is one read and one write and nobody else mutating - so it
is the single-winner protocol that closes both. `check` stays lock-free:
it only reads, and a torn read fails closed through `read_lock` to exit 2.
The mutex is stealable (a crashed holder's is removed single-winner after
`MUTEX_STALE_SECONDS`) so one dead session cannot wedge the fleet.

WINDOWS CAN REPORT A DELETE RACE AS PermissionError, NOT FileExistsError
(S23, #436, 2026-08-21)

Every `os.open(..., O_CREAT | O_EXCL | O_WRONLY)` in this module - the
mutex's own exclusive create in `mutation_lock`, and the primary lock's
fast-path create in `do_acquire` - catches `PermissionError` alongside
`FileExistsError`. Reproduced live: a 100-iteration loop of the
release/takeover storm scenario crashed once (about 1 in 100) with an
uncaught `PermissionError: [Errno 13] Permission denied` from
`mutation_lock`'s exclusive create, where the module only caught
`FileExistsError`. The cause is NTFS's own delete semantics, not the
storm fixture mis-sequencing its contenders: `os.remove` on Windows
marks a file for deletion and the directory entry can persist for a
short window before it is actually gone, and a concurrent `CREATE_NEW`
open landing in that window is denied (`ERROR_ACCESS_DENIED`) rather
than told the file exists (`ERROR_FILE_EXISTS`) - the same fact
("someone else has this path right now") reported through whichever of
two Windows codes the timing happens to land on. `mutex_is_stale` and
`steal_mutex` catch it too, for the same reason `FileNotFoundError`
already had to be caught there: a file this module cannot even stat or
move during that window is not one it can prove is a crashed holder's,
so the conservative answer ("not stale, retry") is unchanged either way.
None of this widens what counts as a real invariant violation - a
caught `PermissionError` re-enters the exact same stale-check, steal and
retry path `FileExistsError` already used, bounded by the same
`MUTEX_TIMEOUT_SECONDS` and `ACQUIRE_ATTEMPTS`, so a genuinely stuck
permission problem still surfaces as a `TimeoutError` or a refusal
rather than looping forever.
"""

import argparse
import contextlib
import datetime
import json
import os
import socket
import sys
import time

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


# A record that reads unreadable might just be mid-write, not corrupt -
# S23, #436, 2026-08-21. See settle_unreadable below.
WRITE_SETTLE_SECONDS = 0.25
WRITE_SETTLE_SPIN_SECONDS = 0.005


def settle_unreadable(path, existing):
    """Give a just-created, still-filling lock a moment to finish, before
    a takeover decision reads its unreadable gap as staleness.

    FOUND LIVE (S23, #436): a 200-trial storm of do_acquire's own
    fast-path create (`write_new_lock`, below) racing a mutation_lock-
    protected takeover decision hit this twice - the fast-path winner's
    file existed but was not yet filled (the exact gap `read_lock`'s own
    docstring names: "the gap between the file existing and the file
    being readable is real on this platform ... cannot be closed from
    this end, only narrowed"), the takeover reader saw `{}` (unreadable),
    `staleness()` reported "its started-at (None) could not be read" and,
    under an active `--take-stale`, unconditionally overwrote the winner
    it had not finished announcing - two acquire callers both exited 0,
    and the second one's write is what survived. A genuinely corrupt or
    crashed record (the suite's own hand-written-garbage arm) is not
    mid-write and never settles, so it falls through unchanged to the
    existing STALE / --take-stale path exactly as before; the budget only
    ever costs time on the rare unreadable case, never on an ordinary
    read.

    Deliberately narrower than the mutex's own equivalent
    (`mutex_is_stale`, which is mtime-only and never re-reads): `check`
    stays lock-free and instant by design ("check stays lock-free: it
    only reads" - the module docstring) and does not call this, because
    a momentary false UNREADABLE there costs a caller a retry, never a
    corrupted lock. This function is called only from the mutation-lock-
    protected path that can actually WRITE over what it reads, where the
    same momentary gap can cost a real invariant instead.
    """
    if existing != {}:
        return existing
    try:
        age = time.time() - os.stat(path).st_mtime
    except FileNotFoundError:
        return existing  # genuinely gone now; the caller's own "gone in
                        # the gap" path (existing is None) applies instead
    if age >= WRITE_SETTLE_SECONDS:
        # Old enough that "still being filled" is implausible - a real
        # write_new_lock call finishes in microseconds, not a quarter
        # second. Presumptively corrupt or crashed, same as before.
        return existing
    deadline = time.monotonic() + WRITE_SETTLE_SECONDS
    while time.monotonic() < deadline:
        time.sleep(WRITE_SETTLE_SPIN_SECONDS)
        reread = read_lock(path)
        if reread != {}:
            return reread
    return existing


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
    except (TypeError, ValueError, AttributeError):
        # AttributeError covers a started_at that is valid JSON but not a
        # string at all - a number or a bool, unreachable through this
        # module's own writes (now() always returns a string) but
        # reachable by hand-edit or a future writer. Without this catch
        # such a record crashed check/acquire outright instead of
        # landing in the same "age cannot be established" path a list or
        # a dict already take - see review finding A4.
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


# The mutation lock (see mutation_lock below). A critical section here is
# one read and one write of a tiny JSON file - microseconds - so a mutex
# older than this is a crashed holder, not a slow one, and is stolen. It
# sits far below the lock's own DEFAULT_STALE_HOURS because it guards a far
# shorter span: staleness is measured against what the guarded work
# plausibly takes, and a read-modify-write of one file never takes 10 s.
MUTEX_STALE_SECONDS = 10.0
# Longer than MUTEX_STALE_SECONDS on purpose: a caller that waits must
# outlast the moment a crashed holder's mutex becomes stealable, so a
# genuinely wedged fleet recovers (steal, then proceed) rather than every
# waiter timing out just before the steal would have freed them. Normal
# contention drains in milliseconds and never approaches either bound;
# nothing here waits forever, the same rule the acquire-retry cap states.
MUTEX_TIMEOUT_SECONDS = 20.0
MUTEX_SPIN_SECONDS = 0.01


def mutex_path(state=None):
    return lock_path(state) + ".mutex"


def mutex_is_stale(path):
    """Whether the mutex at `path` is a crashed holder's, safe to steal.

    Staleness is the file's MTIME age, not anything parsed from its body,
    and that distinction is load-bearing. The mutex is created empty by the
    exclusive open and filled by a second write, so a spinner that arrived
    in that gap would read a zero-byte or half-written file - and a
    content-based test that called that "unreadable, therefore stale" would
    steal a LIVE mutex the instant after it was created, producing exactly
    the two-holder race the mutex exists to stop (observed as a flaky
    takeover-storm failure before this was mtime-based). An empty mutex
    just created has a fresh mtime and is left alone; only one whose mtime
    is genuinely old - a crashed holder's - is stolen.
    """
    try:
        mtime = os.stat(path).st_mtime
    except (FileNotFoundError, PermissionError):
        # Gone between a spinner's failed create and this stat - not stale,
        # just absent; the caller loops and retries the exclusive create.
        # PermissionError joins FileNotFoundError for the same reason it
        # joins FileExistsError in mutation_lock below: Windows can present
        # a file mid-delete as access-denied rather than not-found for a
        # few microseconds, and a file this call cannot even stat is not
        # one it can prove is a crashed holder's - "not stale, retry" is
        # the same conservative answer either way (S23, #436).
        return False
    return (time.time() - mtime) >= MUTEX_STALE_SECONDS


def steal_mutex(path):
    """Remove a stale mutex, single-winner, so two stealers cannot both win.

    os.replace to a caller-unique name is the same atomic move the port
    allocator and this module lean on elsewhere: exactly one stealer moves
    the file and the rest get FileNotFoundError (or, on Windows, the same
    transient PermissionError mutation_lock's exclusive create can see -
    S23, #436) and simply retry the exclusive create. The winner then
    deletes what it moved.

    A SECOND, DIFFERENT source of that same PermissionError (a review
    lead on #436, confirmed by reproduction): Windows can also raise it
    when the file being replaced or removed is genuinely still open in
    another process - `os.replace(path, graveyard)` against a file a
    real process still has open raised exactly
    `PermissionError(13, 'The process cannot access the file because it
    is being used by another process')` in a direct reproduction (a
    subprocess holding the mutex path open while its mtime was aged past
    the steal threshold, standing in for a holder that is slow rather
    than crashed). This is a different mechanism from the delete-pending
    race above - not a timing sliver but an actual live handle - and it
    is handled the same way for the same reason: a stealer that cannot
    win right now should retry through the caller's spin loop, not crash.
    `os.remove(graveyard)` gets the same guard for the same class of
    reason, even though this module could not force that specific call
    to fail live: by the time replace has succeeded, `graveyard` is a
    name only this stealer's pid+random suffix could reach, so nothing
    else should hold it open - but "should not" is not a promise this
    function makes about a filesystem it does not control, and a failed
    cleanup here is a harmless orphaned `.stealing-*` file, never a
    correctness problem (the exclusivity `path` needed was already
    settled by the successful replace).
    """
    graveyard = "%s.stealing-%d-%s" % (path, os.getpid(),
                                       os.urandom(6).hex())
    try:
        os.replace(path, graveyard)
    except (FileNotFoundError, PermissionError):
        return
    try:
        os.remove(graveyard)
    except (FileNotFoundError, PermissionError):
        pass


@contextlib.contextmanager
def mutation_lock(state):
    """Serialize the read-modify-write of a lock that already exists.

    THE ATOMICITY THE STALE TAKEOVER AND THE RELEASE BOTH OWN (2nd-audit
    MAJOR2). The initial acquire is single-winner because O_CREAT|O_EXCL
    is, but taking over a stale lock and releasing one are read-modify-
    writes, and two of those interleave into the exact double-holder this
    module exists to prevent: a stale takeover that read-then-uncondition-
    ally-rewrote let two --take-stale callers both win, and a release that
    read-then-unconditionally-unlinked let an old holder delete a
    REPLACEMENT lock installed in the gap. A move-based compare-and-swap
    closes the takeover but not the release - to inspect a record the
    release must move it out of the slot first, and that empty-slot window
    lets a third caller acquire, so two callers still end up believing they
    hold it. A mutex around just the critical sections is the single-winner
    protocol that closes both without that window: one read, one write,
    nobody else mutating meanwhile.

    Held only across the read and the write, never across stdout or the
    O_EXCL fast path, so the section is microseconds. A mutex older than
    MUTEX_STALE_SECONDS is a crashed holder and is stolen single-winner;
    a call that cannot acquire within MUTEX_TIMEOUT_SECONDS raises rather
    than hang.

    WHY THE EXCLUSIVE CREATE ALSO CATCHES PermissionError (S23, #436,
    2026-08-21): reproduced live in a 100-iteration storm loop on
    Windows, rate about 1 in 100 - a release/takeover storm's exclusive
    create on this same mutex path raised `PermissionError: [Errno 13]
    Permission denied` instead of `FileExistsError`, crashing the caller
    with an uncaught traceback rather than looping. The cause is NTFS's
    own delete semantics, not a bug in the barrier fixture: `os.remove`
    on Windows marks a file for deletion and the directory entry persists
    for a short window before it is actually gone, and a concurrent
    `CREATE_NEW` open landing in that window is denied
    (`ERROR_ACCESS_DENIED`) rather than told the file exists
    (`ERROR_FILE_EXISTS`) - the two errors are the same fact ("someone
    else has this path right now") reported through two different
    Windows codes depending on which side of the delete the caller's
    open lands. Treating PermissionError as ordinary contention here
    costs nothing extra: it re-enters the exact same stale-check/steal/
    retry loop FileExistsError already does, bounded by the same
    MUTEX_TIMEOUT_SECONDS, so a genuine (non-transient) permission
    problem still surfaces as a TimeoutError rather than looping forever.
    """
    path = mutex_path(state)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    deadline = time.monotonic() + MUTEX_TIMEOUT_SECONDS
    while True:
        try:
            handle = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except (FileExistsError, PermissionError):
            if mutex_is_stale(path):
                steal_mutex(path)
            elif time.monotonic() > deadline:
                raise TimeoutError(
                    "could not acquire the prime-lock mutex at %s within "
                    "%.0f s - a holder is wedged; investigate before "
                    "forcing" % (path, MUTEX_TIMEOUT_SECONDS))
            else:
                time.sleep(MUTEX_SPIN_SECONDS)
            continue
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as file:
            json.dump({"pid": os.getpid(), "host": socket.gethostname(),
                       "at": now()}, file)
        break
    try:
        yield
    finally:
        try:
            os.remove(path)
        except (FileNotFoundError, PermissionError):
            # Stolen out from under us because we somehow ran past the
            # stale threshold - impossible for a real section, but if it
            # happened the stealer already owns the slot and removing again
            # would delete its mutex. Leave it. PermissionError joins
            # FileNotFoundError for the same Windows delete-race reason
            # documented above the exclusive create in this function
            # (S23, #436).
            pass


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
        except (FileExistsError, PermissionError):
            # A lock already exists (or did a moment ago) - or, on Windows,
            # is a moment from not existing: a concurrent release's
            # os.remove(path) can leave this exclusive create seeing
            # ERROR_ACCESS_DENIED (PermissionError) rather than
            # ERROR_FILE_EXISTS for the same narrow NTFS delete-pending
            # window mutation_lock's own exclusive create documents (S23,
            # #436) - the two errors are the same fact reported through
            # different Windows codes, and read_lock below already treats
            # "gone in this exact gap" as a retry regardless of which one
            # brought it here. Deciding what to do about it is a
            # read-modify-write, so it runs under the mutation lock - the
            # section that makes the takeover single-winner and keeps a
            # release from deleting a replacement. Only the read and the
            # write are inside it; the message is printed after it is
            # dropped.
            retry = False
            with mutation_lock(state):
                existing = settle_unreadable(path, read_lock(path))
                if existing is None:
                    # Released in the gap between the failed create and this
                    # read; loop and let the exclusive create try again.
                    retry = True
                elif existing.get("session") == session:
                    write_lock(path, session, host, now())
                    rc, message = 0, ("re-acquired: %s - refreshed "
                                      "started-at" % describe(existing))
                else:
                    reason = staleness(existing, args.stale_hours)
                    if reason is None:
                        rc, message = 1, (
                            "REFUSED: %s holds a fresh lock (%s) - one "
                            "Prime at a time; STOP and surface to the "
                            "owner instead of working"
                            % (existing.get("session", "<unnamed>"),
                               describe(existing)))
                    elif not args.take_stale:
                        rc, message = 1, (
                            "STALE: %s (%s) - acquirable only with "
                            "--take-stale, never silently"
                            % (describe(existing), reason))
                    else:
                        # Safe under the mutex: no other session can slip a
                        # second takeover or a release between this decision
                        # and this write.
                        write_lock(path, session, host, now())
                        rc, message = 0, (
                            "acquired: took over a stale lock - %s (%s)"
                            % (describe(existing), reason))
            if retry:
                continue
            print(message)
            return rc
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
        # Fails CLOSED (exit 2), not open: an unreadable record is not a
        # provably-fresh holder, but neither is it a free lock a caller may
        # silently step past - taking it over is a --take-stale decision,
        # and check refuses to imply that decision by exiting 0. See the
        # ruled exit table in the module header.
        print("the lock file at %s exists but could not be read, so no "
              "fresh holder can be established - failing closed: taking it "
              "over is an explicit --take-stale decision" % path)
        return 2
    if existing.get("session") == args.session:
        print("own session: %s" % describe(existing))
        return 0
    reason = staleness(existing, args.stale_hours)
    if reason is None:
        print("REFUSED: %s holds a fresh lock (%s) - STOP and surface to "
              "the owner instead of working"
              % (existing.get("session", "<unnamed>"), describe(existing)))
        return 1
    # Another session's stale lock: acquirable, but only through an
    # explicit --take-stale, so check exits 2 rather than implying that
    # decision with a 0. The ruled exit table (module header) is what
    # 0.9-M0-S19 wires into session-open.
    print("STALE: %s (%s) - another session's stale lock; take it over "
          "only with an explicit --take-stale, or STOP" % (
              describe(existing), reason))
    return 2


def do_release(args):
    state = args.state
    path = lock_path(state)
    # The read and the unlink are one critical section under the mutation
    # lock: without it, a takeover could replace the record between the
    # "does it name me" read and the remove, and the remove would delete
    # the REPLACEMENT lock rather than this session's own (2nd-audit
    # MAJOR2). Under the mutex, "it names me" is still true at the unlink.
    with mutation_lock(state):
        existing = read_lock(path)
        if existing is None:
            rc, message = 0, "no lock to release: %s" % path
        elif not existing or existing.get("session") != args.session:
            holder = existing.get("session") if existing else "<unreadable>"
            rc, message = 1, (
                "REFUSED: the lock is held by %s, not %s - release only "
                "ever removes its own session's lock"
                % (holder, args.session))
        else:
            os.remove(path)
            rc, message = 0, "released: %s's lock removed" % args.session
    print(message)
    return rc


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
