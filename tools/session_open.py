#!/usr/bin/env python3
"""
`./run session-open` (run.cmd: `.\\run session-open`) - the first act of
a session (MAJOR3, #311; the mechanisms audit named reaper.py:31,
prime_lock.py:12 and claim_vs_diff.py:6 as claimed but invoked by
nothing on this machine).

    py -3 tools/session_open.py

This is the real invocation for two of the three: it runs
`prime_lock.py check` against this session's own identity and
`reaper.py --report`, both printed for the operator to read before
doing anything else. The third, claim_vs_diff.py's door step, is a
different kind of act - it runs once per landing, against a branch that
does not exist yet at session-open time - so it is documented in
AGENTS.md's landing/git-ops section rather than wired here; this file
and its suite cover only the two mechanisms it actually calls.

WHAT THIS SESSION'S IDENTITY IS

prime_lock.py's `check` takes a session id as a plain string with no
convention anywhere in this fleet for producing one - its own module
docstring leaves that to the caller. Inventing a second identity scheme
here would be a second place this worktree's identity gets computed,
and a second chance for it to disagree with the first:
agent_init.record_path() already answers "what identifies this
worktree" for the park record every worktree already carries under it
- a basename paired with an 8-character digest of its absolute path,
unique across two worktrees that happen to share a basename under
different parents. session_id() below reuses that exact pair rather
than deriving a new one.

WHY THE EXIT CODE IS PRIME_LOCK'S ALONE

session-open's contract is prime_lock.py check's ruled exit table,
verbatim: 0 for no lock or this session's own, 1 for another session's
fresh lock, 2 for another session's stale or unreadable one. Read
prime_lock.py's own module docstring, "CHECK'S EXIT CODES ARE A RULED
CONTRACT", which names this file as the caller depending on that table
exactly as written. reaper.py --report can itself exit 1 for a reason
that has nothing to do with any lock - a git command that did not
answer, which its own main() calls out as the reason a session-open
caller exists to notice - and folding that into this file's exit code
would make one number answer two unrelated questions: an operator
reading exit 1 could not tell "another session holds the lock" from
"reaper's git calls timed out" without reading the printed text anyway.
Nothing here hides the second fact - a nonzero reaper exit is named on
stdout - it only keeps the process's single exit code tied to the one
table this file exists to wire in.
"""

import argparse
import os
import sys

import agent_init
import prime_lock
import reaper


def session_id(repo):
    """This worktree's identity: agent_init.record_path()'s own
    basename-and-digest pair, without the records directory or the
    .json suffix either one adds. See the module docstring for why
    this reuses that primitive rather than computing a second one."""
    record = agent_init.record_path(repo)
    return os.path.splitext(os.path.basename(record))[0]


def build_parser():
    parser = argparse.ArgumentParser(
        prog="py -3 tools/session_open.py",
        description="The first act of a session (MAJOR3, #311): "
                    "prime_lock.py check against this session's own "
                    "identity, then reaper.py --report, both printed "
                    "for the operator.")
    # Suppressed for the reason reaper.py's own --repo/--state are: a
    # real caller never passes either one, and a suite can drive this
    # against a fabricated machine instead of the real one.
    parser.add_argument("--repo", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--state", default=None, help=argparse.SUPPRESS)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    repo = os.path.abspath(args.repo or agent_init.REPO)
    sid = session_id(repo)

    print("=== prime_lock check: is another session's lock held? ===")
    lock_argv = ["check", sid]
    if args.state:
        lock_argv += ["--state", args.state]
    lock_rc = prime_lock.main(lock_argv)

    print()
    print("=== reaper --report: what a later --act would clean up ===")
    reaper_argv = ["--report", "--repo", repo]
    if args.state:
        reaper_argv += ["--state", args.state]
    reaper_rc = reaper.main(reaper_argv)
    if reaper_rc != 0:
        print()
        print("reaper --report exited %d - read what it printed above. "
              "session-open's own exit code answers only the "
              "prime_lock question above (see this file's module "
              "docstring for why)." % reaper_rc)

    return lock_rc


if __name__ == "__main__":
    sys.exit(main())
