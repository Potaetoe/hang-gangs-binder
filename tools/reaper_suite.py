"""Contract checks for the mechanical reaper.

    py -3 tools/reaper_suite.py

WHY THE ARMS SIT IN tools/ AND THE ENTRY POINT SITS IN tests/

`tests/` holds `.mjs` entry points and the 0.9 runner guards that: a file
there under any other extension is a stray. So the arms live beside the
module they test and `tests/reaper.test.mjs` is the entry point - five
lines that find a Python and hand it this file, exiting on its status.
0.9-M0-S7 settled that shim as the durable convention for a Python arm,
weighing this suite's arrival explicitly; this is the second instance of
it. This file holds every assertion and the shim holds none.

Until the runner is registered by the apparatus slice, both halves are
run by hand and no handoff may report either as gated.

WHY THIS BUILDS REAL REPOSITORIES INSTEAD OF ASSERTING ON STRINGS

The subject is a program that deletes directories and branches, and
every interesting question about it is a question about the machine:
whether a Windows junction inside a doomed tree is followed, whether a
recursive delete stops at a sibling whose name shares a prefix, whether
git still registers a worktree whose directory is gone. A fixture made
of dictionaries would be a fixture of my own beliefs about those, and
beliefs about exactly these have been wrong in this repository twice -
once measured deleting a real directory, once measured following a
junction into the primary checkout's shared install.

So every arm below runs against a fabricated MACHINE: a real git
repository with real branches, real linked worktrees, real death
certificates written by `agent-park` itself, a real junction pointing at
a real directory with a sentinel file in it. Nothing here touches the
repository this file is committed to - the fixtures are built under the
system temporary directory and swept afterwards, and the arm that
proves the reaper refuses to delete outside its sanctioned roots is the
arm that would notice if that stopped being true.

THE SENTINEL IS THE POINT, AND THE SECOND LINK IS THE EARLIER POINT

`shared/sentinel.txt` sits behind the junction in the fixture and is
read back after the reap. It stands for the primary checkout's
`node_modules`, and its survival is the non-following requirement:
`git worktree remove --force` follows a junction and deletes the
target's contents, which is the field note this suite exists to keep
true.

A SECOND link, `shared/inner-link`, is hung inside that target, and it
is the arm that decides. The sentinel says the DELETE did not follow;
this says the WALK did not, one step earlier, and one step earlier is
where the answer is settled. It matters because the walk's guard is
counter-intuitive on this platform, measured here: a `mklink /J`
junction answers False to `os.path.islink` and True to
`DirEntry.is_dir(follow_symlinks=False)` on Python 3.14. So a junction
looks like an ordinary directory to the test a recursive walker
naturally reaches for, and the symlink guard that appears to prevent
the accident does nothing at all.

Self-contained on purpose: no import from dev/, no framework, no new
dependency.
"""

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from contextlib import redirect_stdout

# Both modules under test sit in this file's own directory, which Python
# puts on the path for a script it is handed - so a plain import is the
# whole wiring, and there is no path arithmetic to get wrong when the
# entry point launches this from the repository root.
import agent_init
import reaper

failures = 0
performed = 0

# Asserted at the end rather than only printed. A hand-written total
# nothing compares against still prints a confident pass when a check
# stops running - an early return, a renamed helper - which is the
# armed-looking-but-not failure this repository holds to be worse than
# no check at all.
EXPECTED = 118


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
# read as a slow one until somebody goes looking - which is exactly how
# this slice's mutation battery was found wedged rather than slow.
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


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


# The name every working root of this suite is made under, and the only
# name the sweep below will delete.
PREFIX = "reaper-suite-"

# How old a matching directory must be before the sweep believes it
# belongs to a FINISHED run. This suite takes seconds, so an hour is not
# a close call - and what it protects is a second agent running this
# file right now, whose working root carries the same name by
# construction.
STALE_AFTER = 3600


def sweep_prior_roots(parent, keep, now=None):
    """Remove roots earlier runs of this suite left in `parent`.

    A recursive delete loose in the directory every program on the
    machine shares, so what it matches IS the safety argument. Two
    limits carry it: directly under the parent and never below it, and
    the full prefix including its separator - a neighbor called
    `reaper-suiteless` starts with the same letters and belongs to
    somebody else, which is the same distinction the containment guard
    under test turns on.
    """
    swept = []
    now = time.time() if now is None else now
    for name in sorted(os.listdir(parent)):
        path = os.path.join(parent, name)
        if not name.startswith(PREFIX) or path == keep:
            continue
        if not os.path.isdir(path) or is_link(path):
            continue
        if now - os.path.getmtime(path) < STALE_AFTER:
            continue
        agent_init.rmtree_hard(path)
        swept.append(name)
    return swept


def run_reaper(argv):
    """(exit code, everything it printed)."""
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = reaper.main(argv)
    return code, buffer.getvalue()


def make_link(link, target):
    """A directory link that a naive recursive delete would walk through.

    A junction on Windows and a directory symlink elsewhere. Both are
    reparse-point-shaped to the walker under test and neither needs a
    privilege the suite cannot count on: `mklink /J` is the one link
    form Windows grants an unelevated shell, which is exactly why the
    fleet's worktrees hold junctions rather than symlinks.
    """
    os.makedirs(os.path.dirname(link), exist_ok=True)
    if os.name == "nt":
        done = subprocess.run(["cmd", "/c", "mklink", "/J", link, target],
                              capture_output=True, text=True,
                              stdin=subprocess.DEVNULL,
                              timeout=FIXTURE_TIMEOUT)
        return done.returncode == 0
    os.symlink(target, link, target_is_directory=True)
    return True


def is_link(path):
    """Whether `path` is a link, asked of the PLATFORM.

    Deliberately not `reaper.is_reparse`, though it answers the same
    question: this is the walker the evidence for "a report changes
    nothing" is computed with, and computing it from the module under
    test would let one defect satisfy both sides. `os.path.isjunction`
    is Python's own name for the case `islink` misses on Windows, and
    asking the standard library is how this stays independent without
    becoming a second copy of the reaper's guard.
    """
    return os.path.islink(path) or (
        hasattr(os.path, "isjunction") and os.path.isjunction(path))


def snapshot(root):
    """Every path under `root` with its size, never following a link.

    The evidence for the claim that a report changes nothing. Links are
    recorded as links and never descended, so the snapshot itself cannot
    commit the mistake it is here to detect.
    """
    seen = {}
    stack = [root]
    while stack:
        here = stack.pop()
        for entry in sorted(os.scandir(here), key=lambda item: item.path):
            path = entry.path
            if is_link(path):
                seen[path] = "link"
                continue
            if entry.is_dir():
                seen[path] = "dir"
                stack.append(path)
            else:
                seen[path] = entry.stat().st_size
    return seen


# ----------------------------------------------------------------------
# The fabricated machine.
#
# Three commits and two mainlines that genuinely diverge, because the
# branch classes turn on the difference: a branch merged into `main` and
# not into `accounts` has to be reapable as debris and NOT reapable as a
# landed slice, and a fixture whose mainlines are the same line cannot
# tell those two answers apart.
# ----------------------------------------------------------------------

def build_machine(root):
    """(primary, state, shared) for a machine with a repository on it."""
    primary = os.path.join(root, "primary")
    state = os.path.join(root, "state")
    shared = os.path.join(root, "shared")
    os.makedirs(primary)
    os.makedirs(state)
    write(os.path.join(shared, "sentinel.txt"), "the shared install\n")

    git(primary, "init", "-b", "accounts")
    # Both entries are what the real repository ignores, and the second
    # is load-bearing: park refuses a worktree holding an untracked
    # path, so a junctioned node_modules that git could see would make
    # the junction arm untestable for a reason that has nothing to do
    # with junctions.
    write(os.path.join(primary, ".gitignore"), ".claude/\nnode_modules/\n")
    write(os.path.join(primary, "one.txt"), "one\n")
    git(primary, "add", "-A")
    git(primary, "commit", "-m", "first")
    _, first = git(primary, "rev-parse", "HEAD")

    write(os.path.join(primary, "two.txt"), "two\n")
    git(primary, "add", "-A")
    git(primary, "commit", "-m", "second on accounts")

    # `main` forks from the first commit, so a tip on it is provably not
    # an ancestor of `accounts`.
    git(primary, "branch", "main", first.strip())
    git(primary, "worktree", "add", "--detach",
        os.path.join(root, "mainwork"), "main")
    write(os.path.join(root, "mainwork", "three.txt"), "three\n")
    git(os.path.join(root, "mainwork"), "add", "-A")
    git(os.path.join(root, "mainwork"), "commit", "-m", "on main")
    _, main_tip = git(os.path.join(root, "mainwork"), "rev-parse", "HEAD")
    git(primary, "branch", "-f", "main", main_tip.strip())
    git(primary, "worktree", "remove", "--force",
        os.path.join(root, "mainwork"))
    return primary, state, shared


def sha(primary, ref):
    code, out = git(primary, "rev-parse", ref)
    return out.strip() if code == 0 else None


def add_worktree(primary, name, branch, start, parent=None):
    """A real linked worktree on a real branch, under the reaped root."""
    parent = parent or os.path.join(primary, ".claude", "worktrees")
    path = os.path.join(parent, name)
    code, out = git(primary, "worktree", "add", "-b", branch, path, start)
    if code != 0:
        raise SystemExit("fixture: could not add worktree %s: %s"
                         % (name, out))
    return path


def park(path, state):
    """A death certificate written by agent-park itself.

    Fabricating the JSON would make every arm below a test of my reading
    of the marker contract rather than of the contract. The reaper
    consumes what park writes, so park is what writes it here.
    """
    code, out = agent_init_park(path, state)
    if code != 0:
        raise SystemExit("fixture: park refused %s: %s" % (path, out))
    return agent_init.read_json(agent_init.record_path(path, state))


def agent_init_park(path, state):
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = agent_init.main(["park", "--repo", path, "--state", state])
    return code, buffer.getvalue()


def registered(primary):
    return agent_init.registered_worktrees(primary) or set()


def branches(primary):
    code, out = git(primary, "for-each-ref", "--format=%(refname:short)",
                    "refs/heads")
    return set(out.split()) if code == 0 else set()


def git_impatiently(repo):
    """One bounded command run under whatever bound is set right now."""
    return reaper.git(repo, "rev-parse", "HEAD")


def find(items, kind, subject):
    for item in items:
        if item["kind"] == kind and item["subject"] == subject:
            return item
    return None


def failed_proofs(item):
    return [proof for proof in item["proofs"] if not proof.ok] if item else []


def reason(item):
    return " ".join(proof.said for proof in failed_proofs(item))


# The three accessors below tolerate a MISSING candidate rather than
# raising on it, and that is about the mutation battery rather than
# about tidiness. A mutation that makes the reaper eat something it
# should have reported takes that candidate out of the next plan, and a
# suite that raises there stops - so the remaining arms never run and
# the mutation's real blast radius is hidden behind one traceback. The
# sentinel value is a string no verdict can equal, so a vanished
# candidate reds the arm that expected it instead.
def verdict(item):
    return item["verdict"] if item else "no candidate at all"


def steps(item):
    return item["plan"] if item else []


# ----------------------------------------------------------------------

parent = tempfile.gettempdir()
root = tempfile.mkdtemp(prefix=PREFIX, dir=parent)
swept = sweep_prior_roots(parent, root)
if swept:
    print("swept %d leftover root(s): %s" % (len(swept), ", ".join(swept)))

try:
    primary, state, shared = build_machine(root)
    accounts = sha(primary, "accounts")
    first = sha(primary, "accounts~1")
    main_tip = sha(primary, "main")
    roots = [os.path.join(primary, ".claude", "worktrees")]

    print("\n--- the primitives are imported, not reimplemented ---")

    # The S5 fix wave's instruction to this slice, as a mechanical arm.
    # Two containment tests are two chances to hold the string version,
    # and the string version is the one that was measured deleting a
    # real directory.
    check("reaper.within IS agent_init.within",
          reaper.within is agent_init.within)
    check("reaper.rmtree_hard IS agent_init.rmtree_hard",
          reaper.rmtree_hard is agent_init.rmtree_hard)
    check("the reaper defines no containment test of its own",
          "def within" not in open(reaper.__file__, encoding="utf-8").read())

    print("\n--- a reparse point is recognized, and severed without "
          "being followed ---")

    probe = os.path.join(root, "probe")
    os.makedirs(probe)
    linked = make_link(os.path.join(probe, "node_modules"), shared)
    # A SECOND link, hung inside the junction TARGET. Nothing the walker
    # is allowed to see, and the only thing that can tell a walk that
    # stopped at the junction from one that went through it: the
    # sentinel proves the delete did not follow, and this proves the
    # WALK did not, which is one step earlier and the step that decides.
    os.makedirs(os.path.join(shared, "inner"))
    make_link(os.path.join(shared, "inner-link"),
              os.path.join(shared, "inner"))
    check("the fixture could make a directory link", linked)
    check("a plain directory is not a reparse point",
          not reaper.is_reparse(probe))
    check("a plain file is not a reparse point",
          not reaper.is_reparse(os.path.join(shared, "sentinel.txt")))
    check("the link IS a reparse point",
          reaper.is_reparse(os.path.join(probe, "node_modules")))
    check("the link resolves to the shared directory",
          os.path.realpath(os.path.join(probe, "node_modules"))
          == os.path.realpath(shared))
    check("THE WALK NAMES THE LINK AND NOTHING BEHIND IT",
          reaper.find_links(probe)
          == [os.path.join(probe, "node_modules")])
    severed = reaper.sever_links(probe)
    check("severing names the link it removed",
          [os.path.basename(path) for path in severed] == ["node_modules"])
    check("the link is gone",
          not os.path.exists(os.path.join(probe, "node_modules")))
    check("the sentinel BEHIND the link survives severing",
          os.path.isfile(os.path.join(shared, "sentinel.txt")))
    check("the link BEHIND the link was never touched",
          os.path.isdir(os.path.join(shared, "inner-link")))
    check("severing a tree with no links removes nothing",
          reaper.sever_links(probe) == [])

    # A link pointing at its own parent - the shape that turns a walk
    # into a wait. Correct code never follows it, so this arm passes
    # either way and is worth its line for a different reason: it is
    # the fixture that catches a walk which HAS started following,
    # before that walk is loose on a real machine. The mutation that
    # reverses the two questions in the walker wedged on this slice's
    # battery, and a mutant that hangs teaches nothing while a mutant
    # that reds teaches everything.
    loopy = os.path.join(root, "loopy")
    os.makedirs(os.path.join(loopy, "down"))
    make_link(os.path.join(loopy, "down", "up"), loopy)
    check("a link pointing at its own parent is walked, not followed",
          reaper.find_links(loopy)
          == [os.path.join(loopy, "down", "up")])
    check("and severing it terminates and leaves the parent",
          reaper.sever_links(loopy)
          == [os.path.join(loopy, "down", "up")]
          and os.path.isdir(os.path.join(loopy, "down")))

    print("\n--- the parked, provable worktree ---")

    landed = add_worktree(primary, "wt-landed", "slice-landed", first)
    park(landed, state)
    items = reaper.plan(primary, state, roots)
    item = find(items, "parked worktree", landed)
    check("a parked worktree is a candidate", item is not None)
    check("every proof holds", item and not failed_proofs(item))
    check("the verdict is reap", verdict(item) == "reap")
    check("the ancestry proof names the mainline it proved against",
          item and any("accounts" in proof.said for proof in item["proofs"]
                       if proof.name == "branch"))

    before = snapshot(root)
    code, said = run_reaper(["--repo", primary, "--state", state,
                             "--roots", os.pathsep.join(roots)])
    check("the report exits 0", code == 0)
    check("the report says it would reap the worktree",
          landed in said and "WOULD REAP" in said)
    check("the report is the default mode", "--act" in said)
    check("a report changes NOTHING on disk", snapshot(root) == before)
    check("the worktree is still registered after a report",
          os.path.abspath(landed) in registered(primary))
    check("the branch is still there after a report",
          "slice-landed" in branches(primary))

    code, said = run_reaper(["--act", "--repo", primary, "--state", state,
                             "--roots", os.pathsep.join(roots)])
    check("the act exits 0", code == 0)
    check("the directory is gone", not os.path.exists(landed))
    check("git no longer registers it",
          os.path.abspath(landed) not in registered(primary))
    check("its branch is gone", "slice-landed" not in branches(primary))
    check("the act states the ancestry proof for the branch it deleted",
          "ancestor of" in said)
    record = agent_init.read_json(agent_init.record_path(landed, state))
    check("the record is marked reaped", record.get("state") == "reaped")
    check("the record carries when it was reaped",
          bool(record.get("reaped", {}).get("at")))
    check("a second run finds it no more",
          find(reaper.plan(primary, state, roots),
               "parked worktree", landed) is None)

    print("\n--- the junction hazard, both directions ---")

    junctioned = add_worktree(primary, "wt-junction", "slice-junction",
                              first)
    make_link(os.path.join(junctioned, "node_modules"), shared)
    park(junctioned, state)
    items = reaper.plan(primary, state, roots)
    item = find(items, "parked worktree", junctioned)
    check("the junctioned worktree is reapable", verdict(item) == "reap")
    check("the plan says the link will be severed rather than walked",
          any("node_modules" in line for line in steps(item)))

    code, said = run_reaper(["--act", "--repo", primary, "--state", state,
                             "--roots", os.pathsep.join(roots)])
    check("the act exits 0", code == 0)
    check("the junctioned worktree is gone", not os.path.exists(junctioned))
    check("the act names the link it severed", "node_modules" in said)
    check("THE SENTINEL BEHIND THE JUNCTION SURVIVES",
          os.path.isfile(os.path.join(shared, "sentinel.txt")))
    check("the shared directory itself survives", os.path.isdir(shared))
    check("the shared directory is untouched, to the entry",
          sorted(os.listdir(shared))
          == ["inner", "inner-link", "sentinel.txt"])

    print("\n--- the live worktree is never touched ---")

    live = add_worktree(primary, "wt-live", "slice-live", first)
    agent_init.write_json(agent_init.record_path(live, state), {
        "schema": agent_init.SCHEMA, "contract": agent_init.CONTRACT,
        "worktree": live, "kind": "linked", "branch": "slice-live",
        "state": "live", "initialized_at": agent_init.now(),
        "ports": [8130, 8135], "scratch": None,
    })
    items = reaper.plan(primary, state, roots)
    check("a live record is not a parked candidate",
          find(items, "parked worktree", live) is None)
    check("its branch is not a branch candidate either",
          find(items, "merged branch", "slice-live") is None)
    code, said = run_reaper(["--act", "--repo", primary, "--state", state,
                             "--roots", os.pathsep.join(roots)])
    check("the live worktree survives an act", os.path.isdir(live))
    check("the live branch survives an act",
          "slice-live" in branches(primary))

    print("\n--- a parked record under a held lease is refused ---")

    leased = add_worktree(primary, "wt-leased", "slice-leased", first)
    park(leased, state)
    agent_init.write_lease(agent_init.lease_path((8140, 8145), state),
                           os.path.abspath(leased), "slice-leased",
                           (8140, 8145))
    items = reaper.plan(primary, state, roots)
    item = find(items, "parked worktree", leased)
    check("a leased worktree is still enumerated", item is not None)
    check("its verdict is report, not reap", verdict(item) == "report")
    check("the refusal names the lease", "8140" in reason(item))
    code, said = run_reaper(["--act", "--repo", primary, "--state", state,
                             "--roots", os.pathsep.join(roots)])
    check("the leased worktree survives an act", os.path.isdir(leased))
    check("its branch survives too", "slice-leased" in branches(primary))
    check("the act names it as reported rather than reaped",
          "REPORTED" in said and leased in said)
    os.remove(agent_init.lease_path((8140, 8145), state))
    item = find(reaper.plan(primary, state, roots), "parked worktree",
                leased)
    check("dropping the lease makes it reapable again",
          verdict(item) == "reap")

    print("\n--- the unprovable cases are reported, never deleted ---")

    dirty = add_worktree(primary, "wt-dirty", "slice-dirty", first)
    park(dirty, state)
    write(os.path.join(dirty, "unsaved.txt"), "work nobody can recover\n")
    item = find(reaper.plan(primary, state, roots), "parked worktree",
                dirty)
    check("a worktree that went dirty after parking is reported",
          verdict(item) == "report")
    check("the refusal names the uncommitted path",
          "unsaved.txt" in reason(item))

    moved = add_worktree(primary, "wt-moved", "slice-moved", first)
    park(moved, state)
    git(moved, "checkout", "--detach", accounts)
    item = find(reaper.plan(primary, state, roots), "parked worktree",
                moved)
    check("a worktree whose HEAD moved after parking is reported",
          verdict(item) == "report")
    check("the refusal names the certificate's head", "HEAD" in reason(item))

    slipped = add_worktree(primary, "wt-slipped", "slice-slipped", first)
    park(slipped, state)
    git(primary, "branch", "-f", "slice-slipped", accounts)
    item = find(reaper.plan(primary, state, roots), "parked worktree",
                slipped)
    check("a branch that moved off its certificate's tip is reported",
          verdict(item) == "report")

    unlanded = add_worktree(primary, "wt-unlanded", "slice-unlanded",
                            accounts)
    write(os.path.join(unlanded, "unlanded.txt"), "work not yet landed\n")
    git(unlanded, "add", "-A")
    git(unlanded, "commit", "-m", "build and hold")
    park(unlanded, state)
    item = find(reaper.plan(primary, state, roots), "parked worktree",
                unlanded)
    check("a parked worktree carrying unlanded work is reported",
          verdict(item) == "report")
    check("the refusal says the tip is not an ancestor of a mainline",
          "ancestor" in reason(item))

    locked = add_worktree(primary, "wt-locked", "slice-locked", first)
    park(locked, state)
    git(primary, "worktree", "lock", locked)
    item = find(reaper.plan(primary, state, roots), "parked worktree",
                locked)
    check("a locked worktree is reported", verdict(item) == "report")
    check("the refusal prints the unlock remedy",
          "worktree unlock" in reason(item))

    code, said = run_reaper(["--act", "--repo", primary, "--state", state,
                             "--roots", os.pathsep.join(roots)])
    for name, path in (("dirty", dirty), ("moved", moved),
                       ("slipped", slipped), ("unlanded", unlanded),
                       ("locked", locked)):
        check("the %s worktree survives an act" % name, os.path.isdir(path))
    check("slice-unlanded's branch survives an act",
          "slice-unlanded" in branches(primary))
    check("nothing unprovable was deleted", "deleted" not in reason(
        find(reaper.plan(primary, state, roots), "parked worktree", dirty)))

    print("\n--- containment at worktree size ---")

    outside = add_worktree(primary, "wt-outside", "slice-outside", first,
                           parent=os.path.join(root, "outside"))
    park(outside, state)
    item = find(reaper.plan(primary, state, roots), "parked worktree",
                outside)
    check("a worktree outside the sanctioned roots is enumerated",
          item is not None)
    check("its verdict is report", verdict(item) == "report")
    check("the refusal names containment", "not under" in reason(item))

    # `<...>/worktrees-elsewhere` satisfies startswith("<...>/worktrees")
    # and is a different directory. This is the string-prefix defect at
    # worktree size, and it is the reason this slice imports `within`.
    sibling = add_worktree(
        primary, "wt-sibling", "slice-sibling", first,
        parent=os.path.join(primary, ".claude", "worktrees-elsewhere"))
    park(sibling, state)
    item = find(reaper.plan(primary, state, roots), "parked worktree",
                sibling)
    check("a PREFIX-SIBLING of the sanctioned root is not contained",
          verdict(item) == "report")
    check("the string test would have accepted it",
          os.path.abspath(sibling).startswith(roots[0]))
    check("`within` says otherwise", not reaper.within(sibling, roots[0]))
    code, said = run_reaper(["--act", "--repo", primary, "--state", state,
                             "--roots", os.pathsep.join(roots)])
    check("the outside worktree survives an act", os.path.isdir(outside))
    check("the prefix-sibling survives an act", os.path.isdir(sibling))

    print("\n--- the prune class: a registered worktree with no directory "
          "---")

    vanished = add_worktree(primary, "wt-vanished", "slice-vanished", first)
    park(vanished, state)
    shutil.rmtree(vanished)
    items = reaper.plan(primary, state, roots)
    item = find(items, "vanished worktree", vanished)
    check("a registered worktree whose directory is gone is a candidate",
          item is not None)
    check("its verdict is reap", verdict(item) == "reap")
    check("it is NOT also a parked-worktree candidate",
          find(items, "parked worktree", vanished) is None)
    code, said = run_reaper(["--act", "--repo", primary, "--state", state,
                             "--roots", os.pathsep.join(roots)])
    check("git no longer registers the vanished worktree",
          os.path.abspath(vanished) not in registered(primary))
    record = agent_init.read_json(agent_init.record_path(vanished, state))
    check("its record is marked reaped", record.get("state") == "reaped")
    check("a second run finds it no more",
          find(reaper.plan(primary, state, roots), "vanished worktree",
               vanished) is None)

    print("\n--- the branch classes ---")

    git(primary, "branch", "worktree-agent-onaccounts", first)
    git(primary, "branch", "worktree-agent-onmain", main_tip)
    git(primary, "branch", "worktree-agent-unmerged", accounts)
    git(primary, "worktree", "add", "--detach",
        os.path.join(root, "spur"), "accounts")
    write(os.path.join(root, "spur", "spur.txt"), "unmerged\n")
    git(os.path.join(root, "spur"), "add", "-A")
    git(os.path.join(root, "spur"), "commit", "-m", "unmerged work")
    spur = sha(os.path.join(root, "spur"), "HEAD")
    git(primary, "branch", "-f", "worktree-agent-unmerged", spur)
    git(primary, "worktree", "remove", "--force", os.path.join(root, "spur"))

    git(primary, "branch", "0.9-m0-s1", first)
    git(primary, "branch", "0.9-m0-s2", main_tip)

    items = reaper.plan(primary, state, roots)
    debris = find(items, "debris branch", "worktree-agent-onaccounts")
    check("a worktree-agent branch on accounts is debris",
          debris and debris["verdict"] == "reap")
    check("the proof names accounts", "accounts" in " ".join(
        proof.said for proof in debris["proofs"]))
    onmain = find(items, "debris branch", "worktree-agent-onmain")
    check("a worktree-agent branch on main is debris too",
          onmain and onmain["verdict"] == "reap")
    check("the proof names main", "main" in " ".join(
        proof.said for proof in onmain["proofs"]))
    stray = find(items, "debris branch", "worktree-agent-unmerged")
    check("an unmerged worktree-agent branch is reported",
          stray and stray["verdict"] == "report")

    landedslice = find(items, "merged branch", "0.9-m0-s1")
    check("a slice branch on accounts is a merged-branch candidate",
          landedslice and landedslice["verdict"] == "reap")
    onmainslice = find(items, "merged branch", "0.9-m0-s2")
    check("a slice branch on main only is reported, not reaped",
          onmainslice and onmainslice["verdict"] == "report")
    check("the mainlines are never candidates",
          find(items, "merged branch", "accounts") is None
          and find(items, "merged branch", "main") is None)
    check("a branch checked out in a live worktree is never a candidate",
          find(items, "merged branch", "slice-live") is None
          and find(items, "debris branch", "slice-live") is None)

    code, said = run_reaper(["--act", "--repo", primary, "--state", state,
                             "--roots", os.pathsep.join(roots)])
    now_there = branches(primary)
    check("the accounts-merged debris branch is deleted",
          "worktree-agent-onaccounts" not in now_there)
    check("the main-merged debris branch is deleted",
          "worktree-agent-onmain" not in now_there)
    check("the unmerged debris branch survives",
          "worktree-agent-unmerged" in now_there)
    check("the landed slice branch is deleted", "0.9-m0-s1" not in now_there)
    check("the main-only slice branch survives", "0.9-m0-s2" in now_there)
    check("accounts survives", "accounts" in now_there)
    check("main survives", "main" in now_there)
    check("the act named an ancestry proof for every branch it deleted",
          said.count("ancestor of") >= 3)

    print("\n--- no branch is deleted without the proof in the output ---")

    # The floor, asserted against the program rather than against its
    # prose: every deletion the act performs is preceded by the sentence
    # that justifies it, so a report with a deletion and no proof in it
    # is a red here.
    deleted = [line for line in said.splitlines()
               if "deleted branch" in line]
    check("every branch deletion line carries its proof",
          deleted and all("ancestor of" in line for line in deleted))

    print("\n--- the reaper answers about the machine it is pointed at "
          "---")

    empty = os.path.join(root, "empty-state")
    code, said = run_reaper(["--repo", primary, "--state", empty,
                             "--roots", os.pathsep.join(roots)])
    check("an empty state directory is not an error", code == 0)
    check("it says there are no certificates to read",
          "no worktree record" in said.lower() or "0 record" in said)

    code, said = run_reaper(["--repo", os.path.join(root, "not-a-repo"),
                             "--state", state])
    check("a path that is not a checkout exits nonzero", code != 0)
    check("and says so", "not a git checkout" in said.lower())

    print("\n--- a git that does not answer reaps nothing ---")

    # The arm the wedged mutation battery earned. Every git command the
    # reaper runs is bounded, and the bound is driven to nothing here so
    # that the timeout path runs for real rather than being reasoned
    # about: a spawn cannot complete inside a microsecond, so every
    # command in the run expires.
    survivor = add_worktree(primary, "wt-timeout", "slice-timeout", first)
    park(survivor, state)
    check("it is reapable while git answers",
          verdict(find(reaper.plan(primary, state, roots),
                       "parked worktree", survivor)) == "reap")
    check("a clean run leaves no trouble behind", reaper.TROUBLE == [])

    patient = reaper.GIT_TIMEOUT
    reaper.GIT_TIMEOUT = 0.000001
    try:
        code, said = git_impatiently(primary)
        check("a bounded command that expires returns the timeout code",
              code == reaper.GIT_TIMED_OUT)
        check("and names the command it killed",
              "rev-parse" in said and "did not answer" in said)
        code, said = run_reaper(["--act", "--repo", primary,
                                 "--state", state, "--roots",
                                 os.pathsep.join(roots)])
        check("an --act run over an unanswering git exits nonzero",
              code != 0)
        # It refuses at the survey rather than reaching hold_back,
        # because the first thing this program asks the machine is which
        # worktrees it has - a machine that has stopped answering stops
        # answering THAT, and refusing before enumerating is one step
        # earlier than downgrading verdicts afterwards. hold_back covers
        # the other shape, where a command goes silent partway through a
        # run that started fine, and is armed directly below.
        check("and refuses, naming the command that went unanswered",
              "REFUSED" in said and "did not answer" in said)
    finally:
        reaper.GIT_TIMEOUT = patient

    check("THE WORKTREE SURVIVED THE UNANSWERED RUN",
          os.path.isdir(survivor))
    check("its branch survived too", "slice-timeout" in branches(primary))
    check("and it is reapable again once git answers",
          verdict(find(reaper.plan(primary, state, roots),
                       "parked worktree", survivor)) == "reap")

    # hold_back, driven directly: a command that goes silent PARTWAY
    # through a run that started fine. The plan is already built by
    # then, so the answer is not a refusal - it is every reap in that
    # plan turning into a report, whatever the reap was about.
    standing = reaper.plan(primary, state, roots)
    reapable = [item for item in standing if verdict(item) == "reap"]
    # Not vacuous: without this the three arms below would pass over an
    # empty list and say nothing whatever about hold_back.
    check("the fixture has a reap to hold back", len(reapable) >= 1)
    reaper.TROUBLE.append("`git something` did not answer")
    try:
        held = reaper.hold_back(standing)
        check("every reap is downgraded to a report",
              all(verdict(item) == "report" for item in held))
        check("each downgraded item carries a failing git proof",
              all(any(proof.name == "git" and not proof.ok
                      for proof in item["proofs"]) for item in reapable))
        check("and their plans are emptied",
              all(steps(item) == [] for item in reapable))
    finally:
        del reaper.TROUBLE[:]

finally:
    agent_init.rmtree_hard(root)

print("\n%d checks, %d failure(s)" % (performed, failures))
if performed != EXPECTED:
    print("EXPECTED %d checks and %d ran. A suite that quietly stops "
          "running is a suite that quietly stops checking."
          % (EXPECTED, performed))
    sys.exit(1)
sys.exit(1 if failures else 0)
