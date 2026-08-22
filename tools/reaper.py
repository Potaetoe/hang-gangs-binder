#!/usr/bin/env python3
"""
The mechanical reaper: enumerate, PROVE, act, report.

    py -3 tools/reaper.py            what it would do, and why
    py -3 tools/reaper.py --report   the same thing, spelled out
    py -3 tools/reaper.py --act      do it

Worktree death is a machine's job, not a judgment call. `agent-park`
writes a death certificate (0.9-M0-S5, #283); this reads every
certificate on the machine, re-establishes each fact in it against the
live world, and deletes only what it can still prove. A proof that does
not reproduce is a REPORT - printed, named, and left exactly as it was
found. There is no flag that turns that into a deletion.

Four candidate classes, and nothing else is a candidate:

  parked worktree    a record with state "parked" whose worktree still
                     matches its certificate
  vanished worktree  a worktree git still registers whose directory is
                     gone - the prune class
  debris branch      a `worktree-agent-*` branch whose tip is an
                     ancestor of a mainline AND whose own worktree record
                     says parked or reaped (or names no record at all)
                     AND git registers no worktree directory for it
                     either; the fleet's harness makes these per
                     worktree and nothing else deletes them. A live
                     record protects the branch outright, and a
                     REGISTERED worktree protects it too, whatever that
                     id's own record says - see "WHY A LIVE WORKTREE'S
                     OWN HARNESS BRANCH IS NEVER DEBRIS" below.
  merged branch      any other local branch proven an ancestor of
                     `accounts`

WHY A REPORT IS THE DEFAULT AND THE ACT IS A FLAG

Reading is safe and deleting is not, so the safe verb is the one you
get by typing the program's name. Session-open hygiene runs the report;
`--act` is a sentence somebody has to write. The report is not a
description of the act - it is the same enumeration and the same proofs,
with the acting suppressed, so the two cannot disagree about what would
happen. The suite proves the report changes nothing by comparing a
snapshot of the whole machine across it.

THE TWO WAYS A DELETE HERE COULD DESTROY SOMETHING IT DOES NOT OWN

Both have already happened in this repository, which is why neither is
answered with care:

  1. CONTAINMENT. A teardown built on `startswith` accepted a SIBLING
     whose name began with the root's name and recursively deleted it
     (S5's review, R3, measured on a real directory). The answer is
     `within()`, imported from tools/agent_init.py rather than written
     again: a path test over path COMPONENTS, with the root deliberately
     not inside itself. Two containment tests would be two chances to
     hold the string version, so there is one, and it is the one the
     verb that writes these certificates already trusts.

  2. FOLLOWING A REPARSE POINT. A junctioned `node_modules` inside a
     worktree points at the primary checkout's shared install, and
     `git worktree remove --force` follows it and deletes the TARGET's
     contents (field note, 2026-08-08; re-confirmed as S5's F7, where
     the junction also survived the removal and left a live pointer
     behind). The answer is that the deletion path here does not contain
     that command at all. Every reparse point inside a doomed tree is
     severed first, explicitly, by a walker that asks whether an entry
     is a reparse point BEFORE it asks whether it is a directory; then
     the tree is deleted with nothing left in it to walk through; then
     the registration is pruned. The suite puts a sentinel file behind a
     real junction and reads it back afterwards, because that is the
     only form of this claim that can fail.

WHY A LIVE WORKTREE'S OWN HARNESS BRANCH IS NEVER DEBRIS

Twice on 2026-08-21, `--act` deleted the harness branch `worktree-agent-<id>`
of a running builder or reviewer (0.9-M3-S21, #431) - harmless both times
only because the worktree still had ITS OWN branch checked out, so git
refused the delete and the loss landed on an abandoned ref instead of a
live one. The rule as it stood could not tell a live worktree's timing
accident from a genuinely dead one, for two reasons that compound:

  1. An agent almost always switches off the harness branch within its
     first minutes, onto its slice branch - so `checked_out` (below) no
     longer names the harness branch at all once real work starts, even
     though the worktree is very much alive.
  2. `agent-init` rewrites that SAME record's `branch` field to the
     slice branch on every re-run, so the live-record guard
     branch_items() already carried - protecting a record's OWN branch
     field - stopped naming the harness branch the moment the agent
     switched. That guard answers "is this record's current branch
     live", never "is this record's WORKTREE still live", which is the
     question the harness branch's own name is asking.

So a `worktree-agent-<id>` branch is asked a further question before it
is ever treated as debris: does `<id>`'s own worktree record say
anything other than parked or reaped, OR does git still register a
worktree directory for it at all (`protect_harness_branch`)? Either one
licenses nothing - the branch is printed under "live harness branch,
left alone" with the evidence, and `--report` shows the same answer
`--act` would give, because both walk this one check (act() asks it
again too - see below). Only an id with NEITHER a live record NOR a
registered worktree falls through to the ordinary ancestry proof below -
a reviewer that stays on the harness branch its whole life needs no
special case here at all, because `checked_out` already protects it.

THE REGISTRATION CHECK MUST NOT SIT BEHIND THE RECORD CHECK (fix wave 1,
F1, review comment 5376697023): the first cut of `protect_harness_branch`
returned `None` the instant it found a parked-or-reaped record for
`<id>`, before it ever consulted the worktree table - so the
registration fallback was unreachable whenever ANY record named the id,
whatever the table said. This repository's own machine produced the
live counter-example the review reproduced against it: four worktrees
(agent-a3faf444bda433c36 among them), still registered, whose records
said parked, every one of them planned for reaping anyway. The
registration question is now asked every time, whatever the record said
- a parked or reaped record no longer disqualifies an id from the
registration check, it only means the record-alone answer (the cheaper,
more specific one) is not available, and the id falls to registration
instead of to nothing. `tools/reaper_suite.py`'s fixture E is built
exactly this shape: a parked record, a still-registered worktree,
expected protected.

ACT() ASKS AGAIN TOO (fix wave 1, F2, review comment 5376697023): this
protection is decided once, in plan(), the same as every other proof in
this file - and `act()`'s own docstring is explicit that decisions made
at plan time are not carried across the gap to the act, because the
world does not hold still while a report prints. The first cut of this
slice left the harness-branch check as the one exception: `act()`
re-proves ancestry and re-resolves the branch's tip before a delete, but
never asked `protect_harness_branch` again, so a `worktree-agent-<id>`
classified debris when the plan ran stayed classified debris even if a
record for `<id>` went live, or a worktree for it got registered, before
the act loop reached it. `act()` now re-asks the SAME classifier this
section describes - not a second one - against a freshly-read table,
immediately before a debris-branch delete.

WHY `-d` IS TRIED BEFORE `-D`, AND WHAT MAKES `-D` LEGITIMATE

`git branch -d` asks whether a branch is merged into the CURRENT HEAD
or its upstream. That is a different question from the one this program
proves - "is this tip an ancestor of `accounts` or `main`" - and it
answers "no" for a branch landed on a mainline the reaper is not
standing on. So `-d` is tried first, as a free second opinion from git
itself, and `-D` is the fallback. The floor 0.9-M0-S8 carries is that
no `-D` happens without the ancestry proof STATED in the output beside
it, so the proof sentence is built before the deletion and printed with
it; a deletion line without its proof is a red in the suite.

NOTHING HERE WAITS FOREVER

Every git command this program runs is bounded, started with stdin
closed and with terminal prompting off, and a command that runs out of
time takes the WHOLE RUN's deletions with it rather than only the
candidate it was asked about - a timeout is a fact about the machine's
ability to answer questions, and the next question was going to be
asked of the same machine. That is measured rather than defensive: the
mutation battery for this slice wedged on a git child that had consumed
no CPU for minutes with a parent waiting on it and nothing to report.
A reaper that can wait forever is worse than one that refuses, because
a refusal is visible and a wait is indistinguishable from work.

The residual, stated rather than hidden: `head_state`, `dirty_paths`
and `worktree_kind` are imported from tools/agent_init.py and run git
through that module's own subprocess call, which takes no timeout. This
file closes what it can from outside - the environment those children
inherit - and closing the rest is one `timeout=` in that helper, in the
slice that owns that file.

WHAT THIS DELIBERATELY DOES NOT DO

It does not create worktrees or branches, does not touch the primary
checkout, does not fetch, does not push, and does not delete a
directory that is not a linked worktree of this repository sitting
inside a sanctioned root. It never deletes a record file: a reaped
record keeps its history and gains a "reaped" block, which is what lets
the next reader see that a directory was removed on purpose rather than
lost.
"""

import argparse
import os
import stat
import subprocess
import sys

# The containment primitive, the hard recursive delete, the git helper,
# the record format and the lease format all come from the verb that
# writes the certificates this program consumes. Importing them is the
# instruction S5's fix wave left for this slice: a second copy of
# `within` is a second chance to hold the string version of it, and the
# string version is the one that was measured deleting a real directory.
import agent_init
from agent_init import rmtree_hard, within

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The branch the fleet's harness creates per worktree, which is where
# the bulk of the debris comes from - nothing else deletes them, so they
# accumulate one per spawned agent.
DEBRIS_PREFIX = "worktree-agent-"

# A landed slice is proven against `accounts` alone, because `accounts`
# is where work lands until the cutover; harness debris is proven
# against either mainline, because a worktree spawned off `main` leaves
# its branch on `main`.
SLICE_MAINLINES = ("accounts",)
DEBRIS_MAINLINES = ("accounts", "main")

# Where a linked worktree of this fleet lives. A path outside these is
# REPORTED rather than deleted, however parked its record says it is:
# the certificate is a claim by one agent and the root is a fact about
# how this machine is laid out, and a recursive delete needs both.
DEFAULT_ROOTS = (os.path.join(".claude", "worktrees"),)

# Every git command this program runs is bounded, and a command that
# runs out of time takes the whole run's deletions with it.
#
# THIS IS A MEASURED FAILURE, not a precaution. Building this slice, the
# mutation battery wedged: a git child that had consumed no CPU for
# minutes, a fixture directory with no writes, and a parent waiting on
# it with nothing to report. A reaper that can wait forever is worse
# than one that refuses, because a refusal is visible and a wait is
# indistinguishable from work.
GIT_TIMEOUT = 120

# A return code no git command produces, so a timeout can never be read
# as an ordinary "no". The difference matters most at `rev-parse` on a
# branch ref, where a plain nonzero means "this branch is gone" and
# licenses deleting a worktree.
GIT_TIMED_OUT = -9999

# Every bounded command that ran out of time or could not be started, in
# this process. `hold_back` below turns a non-empty list into a run that
# reaps nothing at all - see its reasoning for why the answer is that
# blunt rather than per-candidate. Cleared by `survey`, which every
# entry point goes through, so one caller's trouble is not carried into
# the next caller's plan.
TROUBLE = []


def git_environment():
    """The environment every git child here is started with.

    Prompting OFF is the root of the hang class rather than a mitigation
    of it: a git that decides to ask a question, with no terminal to ask
    and nobody to answer, waits for as long as it is allowed to. The
    timeout is the backstop for everything else, and closing stdin at
    the call site is the third lock on the same door.

    `GIT_DIR` and `GIT_WORK_TREE` are dropped because they override
    `-C`: inherited from a hook or a wrapper, they would silently point
    every question below at a different repository than the one this
    program believes it is deleting from.
    """
    environment = dict(os.environ)
    environment["GIT_TERMINAL_PROMPT"] = "0"
    environment["GIT_OPTIONAL_LOCKS"] = "0"
    environment.pop("GIT_DIR", None)
    environment.pop("GIT_WORK_TREE", None)
    return environment


def git(repo, *args):
    """(returncode, stdout and stderr) for a git command that cannot hang.

    Written here rather than imported alongside `within` and
    `rmtree_hard`, and the difference is the point: those two are the
    containment primitives and a second copy of either is a second
    chance to get containment wrong, while this is a subprocess call
    with a bound on it. tools/agent_init.py's helper takes no timeout
    and that file is held by another in-flight slice, so the bound is
    added here rather than there - and the three helpers still imported
    from it are named in the module docstring as the residual.

    Output is NOT stripped, for the reason that file gives: the status
    columns of `git status --porcelain` are significant whitespace.
    """
    try:
        done = subprocess.run(
            ["git", "-C", repo, *args],
            capture_output=True, text=True,
            stdin=subprocess.DEVNULL,
            timeout=GIT_TIMEOUT,
            env=git_environment(),
        )
    except subprocess.TimeoutExpired:
        said = ("`git %s` in %s did not answer within %s seconds and was "
                "killed" % (" ".join(args), repo, GIT_TIMEOUT))
        TROUBLE.append(said)
        return GIT_TIMED_OUT, said
    except OSError as problem:
        said = ("`git %s` in %s could not be run at all: %s"
                % (" ".join(args), repo, problem))
        TROUBLE.append(said)
        return GIT_TIMED_OUT, said
    return done.returncode, done.stdout + done.stderr


def hold_back(items):
    """Downgrade every reap to a report if any git command went wrong.

    Blunt on purpose, and the bluntness is the argument. A timeout is
    not a fact about the candidate it happened to be asked about - it is
    a fact about this machine's ability to answer questions right now,
    and the next question was going to be asked of the same machine. So
    one command that did not answer takes the whole run's deletions,
    rather than the run picking out which proofs the silence could have
    reached.

    It also covers the one place a timeout could otherwise read as a
    licence: `rev-parse` on a branch ref answers "absent" and "timed
    out" with the same None, and an absent branch is a reason to reap.
    """
    if not TROUBLE:
        return items
    said = ("a git command did not answer during this run, so nothing is "
            "provable and nothing is reaped: " + "; ".join(TROUBLE))
    for item in items:
        if item["verdict"] == "reap":
            item["verdict"] = "report"
            item["plan"] = []
            item["proofs"].append(Proof("git", False, said))
    return items


class Proof:
    """One named fact, whether it holds, and the sentence either way.

    A namedtuple would do, except that the sentence is the product here:
    a proof that passes still prints WHAT it established, because a
    report whose passing proofs say nothing leaves the reader unable to
    tell a checked fact from an unchecked one.
    """

    __slots__ = ("name", "ok", "said")

    def __init__(self, name, ok, said):
        self.name = name
        self.ok = ok
        self.said = said


def is_reparse(path):
    """Whether `path` is a link of any kind, asked two ways.

    THE QUESTION THAT MUST BE ASKED BEFORE "is it a directory", and the
    measurements below are why - all four taken on this machine against
    a real `mklink /J` junction, Python 3.14 on Windows, because every
    one of them contradicts what the symlink-shaped reading of this
    code would predict:

      os.path.islink                     False
      lstat -> S_ISLNK                   False
      st_file_attributes reparse bit     True
      DirEntry.is_dir(follow_symlinks=False)  True

    So a junction is NOT a symlink to this interpreter, and the entry
    test every recursive walker reaches for says "ordinary directory"
    about it. A walker that asks "is it a directory" first therefore
    descends into the primary checkout's shared install and deletes it,
    and the islink guard that looks like it prevents that does nothing
    whatever on this platform.

    Two independent tests because each covers where the other is blind:
    S_ISLNK is the POSIX answer and catches a symlink, the reparse-point
    attribute is Windows's own answer and catches the junction S_ISLNK
    misses. Either being true is enough - a guard over deletion is
    written to over-report, and the cost of a false yes is a link
    severed that did not have to be. An unreadable path answers yes for
    the same reason.
    """
    try:
        info = os.lstat(path)
    except OSError:
        # Unreadable is not "ordinary directory". Answering yes here
        # keeps the walker from descending into something it cannot
        # describe.
        return True
    if stat.S_ISLNK(info.st_mode):
        return True
    attributes = getattr(info, "st_file_attributes", 0)
    return bool(attributes
                & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))


def unlink_reparse(path):
    """Remove a link without following it.

    `rmdir` is what removes a junction or a directory symlink, and it
    removes the LINK: the system call refuses a path that is a symbolic
    link on POSIX and unmakes the reparse point on Windows, so neither
    platform can reach the target through it. A file symlink falls to
    `unlink`. Nothing here recurses, which is the point - the target's
    contents are somebody else's.
    """
    try:
        os.rmdir(path)
        return
    except OSError:
        pass
    os.unlink(path)


def _walk_links(root, sever):
    """Every link under `root`, optionally removed as it is found.

    One walker for both questions. The report has to name the links it
    would sever and the act has to sever them, and two walkers would be
    two definitions of "link" that can disagree - the same argument
    agent-park makes for computing its dry run and its act from one
    function.

    The loop asks `is_reparse` about every entry BEFORE it asks whether
    the entry is a directory, and only descends into what answered no.
    That order is the whole safety property of this file, and it is not
    belt-and-braces: `is_dir(follow_symlinks=False)` answers TRUE about
    a junction here, so reversing these two lines is enough to walk into
    a shared install. The suite hangs a second link inside the junction
    target and reds if this walk ever reports it.

    AND IT TERMINATES WHATEVER THE TREE LOOKS LIKE. Every directory is
    entered once, keyed by where it RESOLVES rather than by how it was
    reached, which is what closes a link cycle: a junction pointing at
    its own parent is two `os.scandir` calls apart from an unbounded
    walk. That is not hypothetical here - the ordering above was
    mutated during this slice's mutation battery to prove it
    load-bearing, and the mutant did not merely delete the wrong thing,
    it WEDGED, holding a process that consumed no CPU and reported
    nothing. A walk in deletion machinery that cannot be shown to
    finish is a defect on its own, because a wait looks exactly like
    work from outside, so the bound is here rather than in the caller
    that would have to notice.
    """
    if is_reparse(root):
        raise ValueError("%s is itself a link; a walker that entered it "
                         "would be walking somebody else's tree" % root)
    found = []
    entered = set()
    stack = [root]
    while stack:
        here = stack.pop()
        resolved = os.path.realpath(here)
        if resolved in entered:
            continue
        entered.add(resolved)
        try:
            entries = sorted(os.scandir(here), key=lambda item: item.path)
        except OSError:
            continue
        for entry in entries:
            path = entry.path
            if is_reparse(path):
                if sever:
                    unlink_reparse(path)
                found.append(path)
                continue
            if entry.is_dir(follow_symlinks=False):
                stack.append(path)
    return found


def find_links(root):
    return _walk_links(root, False)


def sever_links(root):
    return _walk_links(root, True)


def worktree_table(repo):
    """[{path, head, branch, locked, prunable}] for every registered one.

    The main worktree is the first record git prints, and this program
    needs to know which one that is: the primary checkout is the one
    thing on the machine that is never a candidate for anything.
    """
    code, out = git(repo, "worktree", "list", "--porcelain")
    if code != 0:
        return None
    entries = []
    here = None
    for line in out.splitlines():
        if line.startswith("worktree "):
            here = {"path": os.path.abspath(line[len("worktree "):]),
                    "head": None, "branch": None, "locked": False,
                    "lock_reason": "", "prunable": None}
            entries.append(here)
        elif here is None:
            continue
        elif line.startswith("HEAD "):
            here["head"] = line[len("HEAD "):].strip()
        elif line.startswith("branch "):
            here["branch"] = line[len("branch "):].strip().replace(
                "refs/heads/", "", 1)
        elif line.startswith("locked"):
            here["locked"] = True
            here["lock_reason"] = line[len("locked"):].strip()
        elif line.startswith("prunable"):
            here["prunable"] = line[len("prunable"):].strip() or "git says so"
    return entries


def resolve(repo, ref):
    code, out = git(repo, "rev-parse", "--verify", "--quiet", ref)
    out = out.strip()
    return out if code == 0 and len(out) == 40 else None


def mainlines(repo, names):
    """[(label, sha)] for the mainlines that exist, remote form first.

    `origin/accounts` beats a local `accounts` where both exist, because
    the local one is whatever this machine last fetched into and the
    remote-tracking ref is what a landing actually moved. Where there is
    no remote - every fixture, and a clone that has not fetched - the
    local branch is the only answer available and is used, with the
    label saying which was proved against.
    """
    found = []
    for name in names:
        for ref in ("refs/remotes/origin/" + name, "refs/heads/" + name):
            sha = resolve(repo, ref)
            if sha:
                found.append((ref.split("refs/remotes/")[-1].split(
                    "refs/heads/")[-1], sha))
                break
    return found


def is_ancestor(repo, sha, ref):
    code, _ = git(repo, "merge-base", "--is-ancestor", sha, ref)
    return code == 0


def ancestry(repo, sha, names):
    """(the mainline label this tip is an ancestor of, or None)."""
    for label, _ in mainlines(repo, names):
        if is_ancestor(repo, sha, label):
            return label
    return None


def leases_on(state, path):
    """Every lease file naming `path` as its holder.

    A lease is a claim against every other worktree on the machine, so a
    lease naming a path is the strongest live signal there is - stronger
    than a certificate saying the holder parked, because the two
    disagreeing means something wrote one of them after the other.
    Disagreement is a report, every time.
    """
    directory = agent_init.leases_dir(state)
    if not os.path.isdir(directory):
        return []
    holding = []
    mine = os.path.abspath(path)
    for name in sorted(os.listdir(directory)):
        full = os.path.join(directory, name)
        lease = agent_init.read_lease(full)
        if lease and os.path.abspath(lease.get("worktree", "")) == mine:
            holding.append(full)
    return holding


def records(state):
    """[(record file, the record)] for everything the fleet has written."""
    directory = agent_init.records_dir(state)
    if not os.path.isdir(directory):
        return []
    found = []
    for name in sorted(os.listdir(directory)):
        if not name.endswith(".json"):
            continue
        full = os.path.join(directory, name)
        record = agent_init.read_json(full)
        if isinstance(record, dict):
            found.append((full, record))
    return found


def contained(path, roots):
    """(whether a recursive delete may touch `path`, the sentence)."""
    for root in roots:
        if within(path, root):
            return True, "it is inside the reaped root %s" % root
    return False, ("it is not under any reaped root (%s), so a recursive "
                   "delete here would be deleting a path this fleet does "
                   "not lay out - remedy: remove it by hand, or add its "
                   "parent to BINDER_WORKTREE_ROOTS if this fleet really "
                   "does own it" % ", ".join(roots))


def branch_proof(repo, park, table, names):
    """The certificate's branch clause, as one Proof.

    Four answers, and only the last one licenses deleting a branch:
    the certificate names none, the ref has already gone, the ref has
    moved off the tip the certificate recorded, or the ref is where the
    certificate says and its tip is an ancestor of a mainline.
    """
    branch = park.get("branch")
    tip = park.get("tip")
    if not branch:
        return Proof("branch", True,
                     "the certificate names no branch - HEAD was already "
                     "detached when this worktree parked")
    checked_out = [entry["path"] for entry in table
                   if entry["branch"] == branch]
    if checked_out:
        return Proof("branch", False,
                     "%s is checked out in %s, which is a live claim on it"
                     % (branch, ", ".join(checked_out)))
    ref = resolve(repo, "refs/heads/" + branch)
    if ref is None:
        return Proof("branch", True,
                     "%s does not exist any more, so nothing holds this "
                     "worktree's work" % branch)
    if ref != tip:
        return Proof("branch", False,
                     "%s points at %s and the certificate records %s, so "
                     "something moved it after this worktree parked"
                     % (branch, ref[:12], (tip or "nothing")[:12]))
    proved = ancestry(repo, tip, names)
    if proved is None:
        return Proof("branch", False,
                     "%s is not an ancestor of %s, so %s still carries "
                     "work that has not landed"
                     % (tip[:12], " or ".join(
                         label for label, _ in mainlines(repo, names))
                        or "any mainline this repository has", branch))
    return Proof("branch", True,
                 "%s is an ancestor of %s, so %s holds nothing that is not "
                 "already on a mainline" % (tip[:12], proved, branch))


def parked_proofs(repo, state, roots, table, primary, source, record, park,
                  path):
    """Every licensing proof for a parked worktree, against the live machine.

    Built for the plan AND re-established in act(), from this one
    function, and that single home is the 2nd audit's BLOCKER 3. The plan
    and the act are separated by however long the report took to print,
    and the world does not hold still for a report: a lease can be taken,
    a lock set, HEAD moved, the branch advanced onto unmerged work, an
    untracked file written. A proof remembered from the plan is a proof
    about a machine that has moved on, so the decisive facts are not
    carried across - they are the SAME proofs, asked again against
    whatever the machine now says. Two definitions of "licensed to reap"
    could disagree, so there is one, the same argument agent-park makes
    for computing its dry run and its act from a single function.
    """
    by_path = {entry["path"]: entry for entry in table}
    proofs = []

    expected = os.path.abspath(agent_init.record_path(path, state))
    proofs.append(Proof(
        "record", expected == os.path.abspath(source)
        and record.get("schema") == agent_init.SCHEMA,
        "the record is %s, schema %s, and it is named for the path it "
        "describes" % (os.path.basename(source), record.get("schema"))
        if expected == os.path.abspath(source)
        and record.get("schema") == agent_init.SCHEMA
        else "%s does not describe its own path under schema %d - a "
             "record that names a path it is not filed under could be "
             "one agent writing another's death certificate"
             % (os.path.basename(source), agent_init.SCHEMA)))

    entry = by_path.get(path)
    proofs.append(Proof(
        "registered", entry is not None and path != primary,
        "git registers %s as a linked worktree of this repository"
        % path if entry is not None and path != primary
        else "%s is not a linked worktree of this repository (or it is "
             "the primary checkout), so nothing here may delete it"
             % path))

    locked = bool(entry and entry["locked"])
    proofs.append(Proof(
        "lock", not locked,
        "git holds no lock on it" if not locked
        else "git worktree lock is held on it%s - a lock is a live "
             "claim by something outside the certificate; remedy: "
             "`git worktree unlock %s` once you have established what "
             "held it" % (", reason: " + entry["lock_reason"]
                          if entry["lock_reason"] else "", path)))

    ok, said = contained(path, roots)
    proofs.append(Proof("containment", ok, said))

    held = leases_on(state, path)
    proofs.append(Proof(
        "lease", not held,
        "no port lease names it" if not held
        else "a port lease still names it: %s - the certificate says "
             "parked and the lease says held, and two records "
             "disagreeing is a report"
             % ", ".join(os.path.basename(name) for name in held)))

    head_branch, head = agent_init.head_state(path)
    proofs.append(Proof(
        "head", head_branch is None and head == park.get("head"),
        "HEAD is detached at %s, exactly as the certificate records"
        % (head or "nothing")[:12]
        if head_branch is None and head == park.get("head")
        else "HEAD is %s and the certificate records a detached %s"
             % (("on " + head_branch) if head_branch
                else "at " + (head or "nothing")[:12],
                (park.get("head") or "nothing")[:12])))

    dirty = agent_init.dirty_paths(path)
    proofs.append(Proof(
        "clean", dirty is not None and not dirty,
        "git status there is empty" if dirty is not None and not dirty
        else "git status could not be read there"
        if dirty is None
        else "%d uncommitted or untracked path(s) appeared after it "
             "parked: %s - deleting the directory would delete that "
             "work" % (len(dirty), ", ".join(sorted(dirty)[:4]))))

    proofs.append(branch_proof(repo, park, table, SLICE_MAINLINES))
    return proofs


def parked_items(repo, state, roots, table, primary):
    """Candidates out of the death certificates, and the inert leftovers.

    Every field of the certificate is re-established against the live
    machine. The certificate is a CLAIM by the agent that wrote it, and
    the only thing it is trusted for is telling this program where to
    look.
    """
    items = []
    inert = []
    registered = {entry["path"] for entry in table}
    for source, record in records(state):
        if record.get("state") != "parked":
            continue
        path = record.get("worktree")
        if not path:
            inert.append("%s names no worktree at all" % source)
            continue
        path = os.path.abspath(path)
        if not os.path.isdir(path):
            # The directory is already gone. If git still registers it,
            # the prune class owns it; if it does not, the record
            # describes a worktree that no longer exists in any sense
            # and there is nothing left to act on.
            if path not in registered:
                inert.append("%s describes %s, which is gone and "
                             "unregistered" % (os.path.basename(source),
                                               path))
            continue
        park = record.get("park") or {}
        proofs = parked_proofs(repo, state, roots, table, primary,
                               source, record, park, path)

        verdict = "reap" if all(proof.ok for proof in proofs) else "report"
        steps = []
        if verdict == "reap":
            try:
                links = find_links(path)
            except (ValueError, OSError) as trouble:
                # find_links raises when the registered path is ITSELF a
                # reparse point - act() already guards the same walk
                # (sever_links, below) and turns that into a REPORT for
                # the one candidate. This loop builds the plan whether
                # or not --act was passed, so report mode owes the same
                # fail-closed answer: one unwalkable candidate is a
                # REPORT for that candidate, not a traceback that takes
                # down the enumeration of every other candidate on the
                # machine.
                proofs.append(Proof(
                    "links", False,
                    "the link walk inside %s could not complete, so it "
                    "is reported as unwalkable rather than planned: %s"
                    % (path, trouble)))
                verdict = "report"
            else:
                for link in links:
                    steps.append("sever the link %s, which points at %s, "
                                 "without walking into it"
                                 % (link, os.path.realpath(link)))
                steps.append("delete the directory %s" % path)
                steps.append("prune the worktree registration")
                if park.get("branch") and resolve(
                        repo, "refs/heads/" + park["branch"]):
                    steps.append("delete branch %s" % park["branch"])
                steps.append("mark %s reaped" % os.path.basename(source))
        items.append({"kind": "parked worktree", "subject": path,
                      "proofs": proofs, "verdict": verdict, "plan": steps,
                      "record": source, "park": park})
    return items, inert


def vanished_items(repo, state, table, primary):
    """Registered worktrees with no directory - the prune class."""
    items = []
    for entry in table:
        path = entry["path"]
        if path == primary or os.path.exists(path):
            continue
        proofs = [Proof("absent", True,
                        "%s is registered and there is nothing on disk at "
                        "it%s" % (path, " (git: " + entry["prunable"] + ")"
                                  if entry["prunable"] else ""))]
        proofs.append(Proof(
            "lock", not entry["locked"],
            "git holds no lock on it" if not entry["locked"]
            else "git worktree lock is held on it, and git does not prune "
                 "a locked worktree - remedy: `git worktree unlock %s`"
                 % path))
        verdict = "reap" if all(proof.ok for proof in proofs) else "report"
        steps = []
        if verdict == "reap":
            steps.append("prune the registration for %s" % path)
            held = leases_on(state, path)
            if held:
                steps.append("drop the dead lease(s) %s"
                             % ", ".join(os.path.basename(name)
                                         for name in held))
            if os.path.isfile(agent_init.record_path(path, state)):
                steps.append("mark its record reaped")
        items.append({"kind": "vanished worktree", "subject": path,
                      "proofs": proofs, "verdict": verdict, "plan": steps,
                      "record": agent_init.record_path(path, state),
                      "park": {}})
    return items


def harness_worktree_dirname(name):
    """The worktree directory basename a `worktree-agent-*` branch names.

    The harness's own naming convention (0.9-M3-S21, #431): a worktree at
    `.claude/worktrees/agent-<id>` gets the branch `worktree-agent-<id>`,
    so the directory a harness branch belongs to is recoverable from the
    branch's own name, without reading anything else first. `None` for a
    name outside that shape (not the debris prefix, or an empty id),
    which is not a question this function can answer.
    """
    if not name.startswith(DEBRIS_PREFIX):
        return None
    agent_id = name[len(DEBRIS_PREFIX):]
    return ("agent-" + agent_id) if agent_id else None


def protect_harness_branch(state, table, dirname):
    """A Proof this harness branch's worktree is still live, or None.

    Scope (0.9-M3-S21, #431; corrected fix wave 1, F1): a live record
    (state neither parked nor reaped) protects the branch on its own,
    and a worktree git still registers for `<id>` protects it too -
    REGARDLESS of what `<id>`'s own record says, not only when no record
    exists. Never about a record's `branch` field (that is `live`,
    above, and it answers a different question - see the module
    docstring's "WHY A LIVE WORKTREE'S OWN HARNESS BRANCH IS NEVER
    DEBRIS"). Records are read fresh here rather than passed in, the
    same way every other proof in this file re-reads the machine rather
    than trusting a caller's snapshot of it.

    The first cut of this function returned `None` the instant it found
    a parked-or-reaped record, before it ever looked at the table - so
    the registration fallback below was unreachable whenever ANY record
    named the id, whatever the table said. This repository's own
    machine produced the live counter-example: four worktrees, still
    registered, whose records said parked, all planned for reaping (the
    review that found it: 0.9-M3-S21 comment 5376697023, F1). Only an id
    with NEITHER a live record NOR a registered worktree - the record
    says parked/reaped or names nothing at all, and registration says
    nothing either - returns None: that id's own reap (or the ordinary
    ancestry proof below, once its directory is fully gone and its
    registration pruned) is what disposes of this branch; protecting it
    here regardless would be the mutation this slice's suite arms
    against in the other direction.
    """
    record_name = None
    record_state = None
    for source, record in records(state):
        worktree = record.get("worktree")
        if not worktree:
            continue
        if os.path.basename(os.path.abspath(worktree)) != dirname:
            continue
        record_state = record.get("state")
        if record_state not in ("parked", "reaped"):
            return Proof(
                "harness", True,
                "the worktree record %s for %s says state %s, not parked "
                "or reaped, so this is a live harness ref rather than "
                "debris" % (os.path.basename(source), dirname,
                           record_state))
        # A parked-or-reaped record does not return here any more - it
        # only stops the record loop early (there is at most one record
        # per id) and falls into the registration check below, which
        # decides on its own regardless of what this record said.
        record_name = os.path.basename(source)
        break
    registered = {os.path.basename(entry["path"]) for entry in table}
    if dirname in registered:
        return Proof(
            "harness", True,
            ("git still registers a worktree at %s, so this is a live "
             "harness ref rather than debris - its record %s says state "
             "%s, but registration protects the branch regardless of "
             "what a record claims"
             % (dirname, record_name, record_state))
            if record_name else
            ("no worktree record names %s, but git still registers a "
             "worktree at it, so this is a live harness ref rather than "
             "debris" % dirname))
    return None


def branch_items(repo, state, table, spoken_for):
    """The three branch classes, over every local branch nothing holds.

    A branch a parked-worktree candidate names is skipped here whatever
    that candidate's verdict was: the worktree owns its own branch, and
    a branch deleted out from under a worktree this program declined to
    delete is the worst of both answers.
    """
    code, out = git(repo, "for-each-ref",
                               "--format=%(refname:short) %(objectname)",
                               "refs/heads")
    if code != 0:
        return []
    checked_out = {entry["branch"]: entry["path"] for entry in table
                   if entry["branch"]}
    live = set()
    for _, record in records(state):
        if record.get("state") == "live" and record.get("branch"):
            live.add(record["branch"])
    reserved = {label for label, _ in
                mainlines(repo, DEBRIS_MAINLINES)} | set(DEBRIS_MAINLINES)

    items = []
    for line in out.splitlines():
        parts = line.split()
        if len(parts) != 2:
            continue
        name, sha = parts
        if name in reserved or name in spoken_for:
            continue
        if name in checked_out or name in live:
            continue
        debris = name.startswith(DEBRIS_PREFIX)
        if debris:
            dirname = harness_worktree_dirname(name)
            harness_proof = (protect_harness_branch(state, table, dirname)
                             if dirname else None)
            if harness_proof is not None:
                items.append({
                    "kind": "live harness branch, left alone",
                    "subject": name, "proofs": [harness_proof],
                    "verdict": "report", "plan": [], "record": None,
                    "park": {}, "sha": sha})
                continue
        names = DEBRIS_MAINLINES if debris else SLICE_MAINLINES
        proved = ancestry(repo, sha, names)
        proof = Proof(
            "ancestry", proved is not None,
            "%s is an ancestor of %s" % (sha[:12], proved)
            if proved is not None
            else "%s is not an ancestor of %s, so this branch carries work "
                 "that has not landed" % (sha[:12], " or ".join(
                     label for label, _ in mainlines(repo, names))
                     or "any mainline this repository has"))
        verdict = "reap" if proof.ok else "report"
        items.append({
            "kind": "debris branch" if debris else "merged branch",
            "subject": name, "proofs": [proof], "verdict": verdict,
            "plan": (["delete branch %s - %s" % (name, proof.said)]
                     if proof.ok else []),
            "record": None, "park": {}, "sha": sha})
    return items


def worktree_roots(primary):
    override = os.environ.get("BINDER_WORKTREE_ROOTS")
    if override:
        return [os.path.abspath(part) for part in
                override.split(os.pathsep) if part]
    return [os.path.join(primary, part) for part in DEFAULT_ROOTS]


def survey(repo, state=None, roots=None):
    """(primary checkout, the worktree table, the roots), or (None, why).

    Every git question below is asked of the PRIMARY checkout rather
    than of whatever directory this was launched from. A linked worktree
    can answer them all, but the sanctioned roots are laid out relative
    to the primary, and computing them from a linked worktree would put
    the root inside a worktree - which is how a reaper ends up unable to
    prove anything about its own siblings.

    Every entry point reaches the machine through here, which is why the
    two pieces of process-wide hardening sit here and not at import
    time. `head_state`, `dirty_paths` and `worktree_kind` come from
    tools/agent_init.py and run git through that module's own untimed
    subprocess call; that file is held by another in-flight slice, so
    what can be closed from here is the environment those children
    inherit - and the prompting variable is the whole of the hang class
    rather than a mitigation of it. The residual, stated rather than
    hidden: one of those three blocking for a reason other than a prompt
    is not bounded by anything in this file, and closing it is one
    `timeout=` in tools/agent_init.py's own helper.
    """
    os.environ["GIT_TERMINAL_PROMPT"] = "0"
    os.environ["GIT_OPTIONAL_LOCKS"] = "0"
    del TROUBLE[:]
    kind, common = agent_init.worktree_kind(repo)
    if kind is None:
        return None, "%s is not a git checkout: %s" % (repo, common)
    table = worktree_table(repo)
    if not table:
        return None, ("git could not list the worktrees of %s%s"
                      % (repo, " - " + "; ".join(TROUBLE) if TROUBLE
                         else ""))
    primary = table[0]["path"]
    return (primary, table, roots or worktree_roots(primary)), None


def plan(repo, state=None, roots=None):
    """Every candidate on this machine, proved, with nothing performed."""
    found, problem = survey(repo, state, roots)
    if problem:
        raise ValueError(problem)
    primary, table, roots = found
    parked, _inert = parked_items(primary, state, roots, table, primary)
    spoken_for = {item["park"].get("branch") for item in parked
                  if item["park"].get("branch")}
    return hold_back(parked
                     + vanished_items(primary, state, table, primary)
                     + branch_items(primary, state, table, spoken_for))


def delete_branch(repo, name, expected, proof):
    """(whether it went, what to print) - and the proof is in the print.

    THE TIP IS RE-RESOLVED AGAINST `expected` IMMEDIATELY BEFORE THE
    DELETE, and this is the whole of the 2nd audit's BLOCKER 2. The plan
    proves a tip has landed, then the report prints, and the world does
    not hold still for a report: another process can advance the branch
    onto unmerged work while the report scrolls. Deleting the NAME then
    destroys that work on the strength of a proof about the SHA the name
    pointed at when the plan ran - and `-D` would do it without even
    git's merged check dissenting, because the moved branch is genuinely
    not merged.
    So the last question asked before the delete is whether the name
    still points where the plan proved, and a name that has moved - or
    vanished - is refused, not deleted. `expected` is the planned tip:
    `item["sha"]` for a branch candidate, the certificate's recorded tip
    for a parked worktree's own branch.

    `-d` first, as a free second opinion from git. It asks whether the
    branch is merged into the CURRENT HEAD, which is a narrower question
    than the one already proved, so its refusal is not evidence against
    the deletion - and `-D` carries the ancestry proof in the same line,
    which is the floor this slice is held to.
    """
    current = resolve(repo, "refs/heads/" + name)
    if current != expected:
        return False, ("REPORTED: branch %s was at %s when it was planned "
                       "and is at %s now, so it moved between the plan and "
                       "the act and was NOT deleted - a landed tip does not "
                       "license deleting a name that has left it"
                       % (name, (expected or "nothing")[:12],
                          (current or "gone")[:12]))
    code, out = git(repo, "branch", "-d", name)
    if code == 0:
        return True, ("deleted branch %s - %s; git's own merged check "
                      "agreed" % (name, proof))
    if code == GIT_TIMED_OUT:
        # The one escalation this program must never make. `-d` failing
        # is the reason `-D` is reached, and a `-d` that never ANSWERED
        # has not failed - it has said nothing. Reading silence as a
        # refusal and answering it with the forced form would turn the
        # safest branch in the plan into the one deleted without any
        # second opinion at all.
        return False, ("could NOT delete branch %s: %s - and `-D` was NOT "
                       "tried, because escalating to a forced delete on "
                       "the strength of an unanswered command is the one "
                       "escalation this program refuses" % (name, out))
    code, out = git(repo, "branch", "-D", name)
    if code == 0:
        return True, ("deleted branch %s - %s; `-d` declined because the "
                      "branch is not merged into the HEAD this ran from, "
                      "which is a different question" % (name, proof))
    return False, "could NOT delete branch %s: %s" % (name, out.strip())


def mark_reaped(path, state, what):
    """Stamp the record, without deleting it.

    A record that disappears leaves the next reader unable to tell a
    directory that was removed on purpose from one that was lost.
    """
    source = agent_init.record_path(path, state)
    record = agent_init.read_json(source)
    if record is None:
        return None
    record["state"] = "reaped"
    record["reaped"] = {"at": agent_init.now(), "by": "tools/reaper.py",
                        "what": what}
    agent_init.write_json(source, record)
    return source


def act(repo, item, state=None, roots=None):
    """Perform one reap. Every proof is re-established first.

    The plan and the act are separated by however long the report took
    to print, and the world does not hold still for a report - so the
    decisive facts are asked again here rather than carried across. The
    2nd audit found three ways the old separation leaked, and each is
    closed below:

      BLOCKER 2  a branch that advanced onto unmerged work after the plan
                 was force-deleted on the strength of the SHA it pointed
                 at when the plan ran. delete_branch re-resolves the tip
                 against the planned SHA immediately before deleting,
                 and refuses a name that moved.
      BLOCKER 3  a parked worktree whose lock, lease, HEAD, cleanliness or
                 branch tip changed after the report was still deleted,
                 because act() re-proved only containment and
                 registration. Every licensing proof is re-established
                 here, from the same function the plan built them with.
      MAJOR 1    a registration that survived the prune was counted a
                 success, its lease dropped and its record stamped reaped.
                 A surviving registration is now an incomplete reap:
                 nonzero, nothing further touched, safely retryable.
      F2         (fix wave 1, 0.9-M3-S21 review, #431) a `worktree-agent-
                 <id>` branch's harness protection is decided by plan()
                 and act() never asked again, so a record that went live
                 or a worktree that got (re-)registered between the two
                 was still deleted on the strength of the plan's stale
                 answer. `protect_harness_branch` - the SAME classifier
                 the plan used, not a second one - is asked again here,
                 against a freshly-read table, immediately before a
                 debris-branch delete.
    """
    if item["verdict"] != "reap":
        return ["REPORTED and left alone."]
    kind = item["kind"]
    roots = roots or worktree_roots(repo)
    if kind in ("debris branch", "merged branch"):
        if kind == "debris branch":
            # F2: re-ask the harness-branch question before deleting one.
            # `kind == "debris branch"` already means the name matches
            # DEBRIS_PREFIX (branch_items is the only place that sets
            # this kind), so `harness_worktree_dirname` never returns
            # None here - the guard is defensive symmetry with the plan
            # side, not a case this can reach.
            table = worktree_table(repo)
            if table is None:
                return ["REPORTED: the worktree table could not be read "
                        "between the plan and the act, so %s was left "
                        "untouched." % item["subject"]]
            dirname = harness_worktree_dirname(item["subject"])
            harness_proof = (protect_harness_branch(state, table, dirname)
                             if dirname else None)
            if harness_proof is not None:
                return ["REPORTED: %s became a live harness ref between "
                        "the plan and the act, so it was left untouched: "
                        "%s" % (item["subject"], harness_proof.said)]
        proof = item["proofs"][0]
        if not is_ancestor(repo, item["sha"],
                           proof.said.split("an ancestor of ")[-1]):
            return ["REPORTED: %s stopped being provable between the plan "
                    "and the act." % item["subject"]]
        # The ancestry above re-proves the SHA is landed; delete_branch
        # re-proves the NAME still points at it (BLOCKER 2).
        _ok, said = delete_branch(repo, item["subject"], item["sha"],
                                  proof.said)
        return [said]

    path = item["subject"]
    done = []
    park = item.get("park") or {}
    if kind == "parked worktree":
        # BLOCKER 3: re-establish EVERY licensing proof against the
        # machine as it is now, not only containment and registration.
        # Re-read the table and the certificate first, because both are
        # what the proofs are computed from, and a proof computed from a
        # stale reading is the very staleness this is here to close.
        table = worktree_table(repo)
        if table is None:
            return ["REPORTED: the worktree table could not be read "
                    "between the plan and the act, so %s was left "
                    "untouched." % path]
        record = agent_init.read_json(item["record"])
        if record is None:
            return ["REPORTED: the death certificate for %s could not be "
                    "re-read at act time, so it was left untouched." % path]
        park = record.get("park") or {}
        proofs = parked_proofs(repo, state, roots, table, table[0]["path"],
                               item["record"], record, park, path)
        failed = [proof for proof in proofs if not proof.ok]
        if failed:
            return ["REPORTED: %s stopped being provable between the plan "
                    "and the act, so it was left untouched." % path,
                    *["    %-12s %s" % (proof.name, proof.said)
                      for proof in failed]]
        try:
            severed = sever_links(path)
        except (ValueError, OSError) as trouble:
            return ["REPORTED: the links inside %s could not be severed, "
                    "so nothing was deleted: %s" % (path, trouble)]
        for link in severed:
            done.append("severed the link %s without walking into it"
                        % link)
        try:
            rmtree_hard(path)
        except OSError as trouble:
            return [*done, "REPORTED: %s could NOT be deleted: %s"
                    % (path, trouble)]
        done.append("deleted the directory %s" % path)

    git(repo, "worktree", "prune")
    # Three answers, not two. A table that could not be READ is not a
    # table with nothing in it, and folding the two together turns a
    # timeout into a printed success - the shape of lie this whole file
    # is built to avoid.
    after = worktree_table(repo)
    if after is None:
        done.append("the registration for %s could NOT be confirmed "
                    "pruned: git did not answer the question that would "
                    "confirm it. The directory is gone, so the next run "
                    "reaps this as a vanished worktree; nothing further "
                    "was done here." % path)
        return done
    if path in {entry["path"] for entry in after}:
        # MAJOR 1: a registration still present after the prune is an
        # INCOMPLETE reap, not a success. Dropping the lease and stamping
        # the record reaped here would erase the two signals that let the
        # next run finish the job, and returning without a trouble marker
        # would let the run exit 0 on work it did not complete. So this
        # stops before either, and the line carries "could NOT" so the
        # run counts it. It is safely retryable: the directory is already
        # gone, so the next run reaps the leftover registration as a
        # vanished worktree.
        done.append("the registration for %s SURVIVED the prune, so this "
                    "reap could NOT be completed: no lease was dropped and "
                    "the record was not marked reaped. The directory is "
                    "gone, so the next run reaps the leftover registration "
                    "as a vanished worktree." % path)
        return done
    done.append("pruned the worktree registration for %s" % path)

    for lease in leases_on(state, path):
        os.remove(lease)
        done.append("dropped the dead port lease %s"
                    % os.path.basename(lease))

    branch = park.get("branch")
    if kind == "parked worktree" and branch and resolve(
            repo, "refs/heads/" + branch):
        proof = next(one for one in item["proofs"] if one.name == "branch")
        # BLOCKER 2 at the worktree's own branch: parked_proofs above
        # already re-proved the tip is where the certificate recorded,
        # and delete_branch re-resolves it one last time against that
        # tip immediately before deleting.
        _ok, said = delete_branch(repo, branch, park.get("tip"), proof.said)
        done.append(said)

    source = mark_reaped(path, state, done)
    if source:
        done.append("marked %s reaped" % os.path.basename(source))
    return done


# ----------------------------------------------------------------------
# Reporting. The report and the act print the same enumeration and the
# same proofs; the only difference is the verb in the header and whether
# anything below it happened.
# ----------------------------------------------------------------------

ORDER = ("parked worktree", "vanished worktree",
         "live harness branch, left alone", "debris branch",
         "merged branch")


def render(items, inert, primary, state, roots, acting, repo):
    print("=== the mechanical reaper: %s ===\n"
          % ("ACTING" if acting else "report"))
    print("repository   %s" % primary)
    directory = agent_init.records_dir(state)
    parked = [item for item in items if item["kind"] == "parked worktree"]
    print("records      %s" % (
        "%s - no worktree record found there" % directory
        if not os.path.isdir(directory) or not records(state)
        else "%s - %d record(s), %d parked"
             % (directory, len(records(state)), len(parked))))
    print("roots        %s" % ", ".join(roots))
    found = mainlines(repo, DEBRIS_MAINLINES)
    print("mainlines    %s" % (", ".join(
        "%s @ %s" % (label, sha[:12]) for label, sha in found)
        or "none of %s resolves here" % ", ".join(DEBRIS_MAINLINES)))

    reaped = 0
    reported = 0
    for kind in ORDER:
        here = [item for item in items if item["kind"] == kind]
        if not here:
            continue
        print("\n--- %s (%d) ---" % (kind, len(here)))
        for item in here:
            verdict = item["verdict"]
            if verdict == "reap":
                reaped += 1
                print("\n%s  %s" % ("REAPING" if acting else "WOULD REAP",
                                    item["subject"]))
            else:
                reported += 1
                print("\nREPORTED  %s" % item["subject"])
            for proof in item["proofs"]:
                print("    %-12s %s %s" % (proof.name,
                                           "ok  " if proof.ok else "FAIL",
                                           proof.said))
            for line in item["plan"] if not acting else []:
                print("    plan         %s" % line)

    if inert:
        print("\n--- inert records (%d), nothing to act on ---" % len(inert))
        for line in inert:
            print("    %s" % line)

    if TROUBLE:
        print("\n--- git did not answer (%d), so this run reaps nothing "
              "---" % len(TROUBLE))
        for line in TROUBLE:
            print("    %s" % line)

    print("\n%d to reap, %d reported and left alone." % (reaped, reported))
    if not acting:
        print("Nothing above was performed. `--act` is what performs it, "
              "and it re-proves\nevery line before it touches anything.")
    return reaped, reported


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="py -3 tools/reaper.py",
        description="Prove which worktrees and branches on this machine "
                    "are dead, and report them. --act deletes the proven.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--act", action="store_true",
                      help="perform the reap; without it, nothing on "
                           "disk or in git is changed")
    mode.add_argument("--report", action="store_true",
                      help="report mode, explicitly - the default when "
                           "neither flag is given; accepted so the "
                           "documented invocation is a real flag rather "
                           "than an argparse error")
    # These three exist so the suite can drive this against a fabricated
    # machine. A rule exercised only against the machine it guards
    # cannot be shown to fail.
    parser.add_argument("--repo", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--state", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--roots", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    repo = os.path.abspath(args.repo or REPO)
    roots = ([os.path.abspath(part)
              for part in args.roots.split(os.pathsep) if part]
             if args.roots else None)
    found, problem = survey(repo, args.state, roots)
    if problem:
        print("=== the mechanical reaper: REFUSED ===\n")
        print(problem)
        return 1
    primary, table, roots = found

    parked, inert = parked_items(primary, args.state, roots, table, primary)
    spoken_for = {item["park"].get("branch") for item in parked
                  if item["park"].get("branch")}
    items = hold_back(parked
                      + vanished_items(primary, args.state, table, primary)
                      + branch_items(primary, args.state, table,
                                     spoken_for))

    render(items, inert, primary, args.state, roots, args.act, primary)
    # A run in which any git command went unanswered is a failed run in
    # both modes, and the exit status says so - session-open hygiene
    # calls this, and a hygiene step that exits 0 on a machine that
    # stopped answering is a hygiene step nobody will look at again.
    if not args.act:
        return 1 if TROUBLE else 0

    trouble = 0
    print("")
    for item in items:
        if item["verdict"] != "reap":
            continue
        print("--- %s: %s" % (item["kind"], item["subject"]))
        for line in act(primary, item, args.state, roots):
            print("    %s" % line)
            if line.startswith("REPORTED") or "could NOT" in line:
                trouble += 1
    if trouble:
        print("\n%d act(s) could not be completed." % trouble)
    elif TROUBLE:
        # hold_back already downgraded every reap to a report before this
        # loop ran, so the loop above did nothing at all - "every proven
        # candidate was reaped" would say the opposite of what happened.
        # Say what happened instead: a git command went silent during
        # this run, so nothing was reaped.
        print("\nheld back: a git command did not answer during this "
              "run, so nothing was reaped.")
    else:
        print("\nEvery proven candidate was reaped.")
    return 1 if trouble or TROUBLE else 0


if __name__ == "__main__":
    sys.exit(main())
