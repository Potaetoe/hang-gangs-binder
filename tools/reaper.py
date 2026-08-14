#!/usr/bin/env python3
"""
The mechanical reaper: enumerate, PROVE, act, report.

    py -3 tools/reaper.py            what it would do, and why
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
                     ancestor of a mainline; the fleet's harness makes
                     these per worktree and nothing else deletes them
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
import sys

# The containment primitive, the hard recursive delete, the git helper,
# the record format and the lease format all come from the verb that
# writes the certificates this program consumes. Importing them is the
# instruction S5's fix wave left for this slice: a second copy of
# `within` is a second chance to hold the string version of it, and the
# string version is the one that was measured deleting a real directory.
import agent_init
from agent_init import within, rmtree_hard

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


class Proof(object):
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

    THE QUESTION THAT MUST BE ASKED BEFORE "is it a directory". A
    Windows junction answers "yes" to a directory test and resolves
    somewhere else entirely, so a walker that tests for a directory
    first walks into the primary checkout's shared install and deletes
    it.

    Two independent tests because they cover each other. `lstat`
    reports a junction as a link on Python 3.8 and later, which is the
    portable half; the reparse-point attribute bit is Windows's own
    answer and covers a reparse tag Python does not map to a link at
    all. Either one being true is enough - a guard over deletion is
    written to over-report, and the cost of a false yes is a link
    severed that did not have to be.
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
    That order is the whole safety property of this file.
    """
    if is_reparse(root):
        raise ValueError("%s is itself a link; a walker that entered it "
                         "would be walking somebody else's tree" % root)
    found = []
    stack = [root]
    while stack:
        here = stack.pop()
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
    code, out = agent_init.git(repo, "worktree", "list", "--porcelain")
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
    code, out = agent_init.git(repo, "rev-parse", "--verify", "--quiet", ref)
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
    code, _ = agent_init.git(repo, "merge-base", "--is-ancestor", sha, ref)
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
    by_path = {entry["path"]: entry for entry in table}
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

        verdict = "reap" if all(proof.ok for proof in proofs) else "report"
        steps = []
        if verdict == "reap":
            for link in find_links(path):
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


def branch_items(repo, state, table, spoken_for):
    """The two branch classes, over every local branch nothing holds.

    A branch a parked-worktree candidate names is skipped here whatever
    that candidate's verdict was: the worktree owns its own branch, and
    a branch deleted out from under a worktree this program declined to
    delete is the worst of both answers.
    """
    code, out = agent_init.git(repo, "for-each-ref",
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
    """
    kind, common = agent_init.worktree_kind(repo)
    if kind is None:
        return None, "%s is not a git checkout: %s" % (repo, common)
    table = worktree_table(repo)
    if not table:
        return None, "git could not list the worktrees of %s" % repo
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
    return (parked
            + vanished_items(primary, state, table, primary)
            + branch_items(primary, state, table, spoken_for))


def delete_branch(repo, name, proof):
    """(whether it went, what to print) - and the proof is in the print.

    `-d` first, as a free second opinion from git. It asks whether the
    branch is merged into the CURRENT HEAD, which is a narrower question
    than the one already proved, so its refusal is not evidence against
    the deletion - and `-D` carries the ancestry proof in the same line,
    which is the floor this slice is held to.
    """
    code, out = agent_init.git(repo, "branch", "-d", name)
    if code == 0:
        return True, ("deleted branch %s - %s; git's own merged check "
                      "agreed" % (name, proof))
    code, out = agent_init.git(repo, "branch", "-D", name)
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
    decisive facts are asked again here rather than carried across.
    """
    if item["verdict"] != "reap":
        return ["REPORTED and left alone."]
    kind = item["kind"]
    if kind in ("debris branch", "merged branch"):
        proof = item["proofs"][0]
        if not is_ancestor(repo, item["sha"],
                           proof.said.split("an ancestor of ")[-1]):
            return ["REPORTED: %s stopped being provable between the plan "
                    "and the act." % item["subject"]]
        _ok, said = delete_branch(repo, item["subject"], proof.said)
        return [said]

    path = item["subject"]
    done = []
    if kind == "parked worktree":
        ok, said = contained(path, roots or worktree_roots(repo))
        if not ok:
            return ["REPORTED: " + said]
        table = worktree_table(repo) or []
        if path not in {entry["path"] for entry in table} or path == (
                table[0]["path"] if table else None):
            return ["REPORTED: %s stopped being a linked worktree of this "
                    "repository between the plan and the act." % path]
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
            return done + ["REPORTED: %s could NOT be deleted: %s"
                           % (path, trouble)]
        done.append("deleted the directory %s" % path)

    agent_init.git(repo, "worktree", "prune")
    if path not in {entry["path"] for entry in (worktree_table(repo) or [])}:
        done.append("pruned the worktree registration for %s" % path)
    else:
        done.append("the registration for %s SURVIVED the prune" % path)

    for lease in leases_on(state, path):
        os.remove(lease)
        done.append("dropped the dead port lease %s"
                    % os.path.basename(lease))

    branch = item["park"].get("branch")
    if kind == "parked worktree" and branch and resolve(
            repo, "refs/heads/" + branch):
        proof = next(one for one in item["proofs"] if one.name == "branch")
        _ok, said = delete_branch(repo, branch, proof.said)
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

ORDER = ("parked worktree", "vanished worktree", "debris branch",
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
    parser.add_argument("--act", action="store_true",
                        help="perform the reap; without it, nothing on "
                             "disk or in git is changed")
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
    items = (parked
             + vanished_items(primary, args.state, table, primary)
             + branch_items(primary, args.state, table, spoken_for))

    render(items, inert, primary, args.state, roots, args.act, primary)
    if not args.act:
        return 0

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
    print("\n%d act(s) could not be completed." % trouble
          if trouble else "\nEvery proven candidate was reaped.")
    return 1 if trouble else 0


if __name__ == "__main__":
    sys.exit(main())
