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
EXPECTED = 221


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
    #
    # `node_modules` carries NO trailing slash, unlike `.claude/` above
    # it. A trailing slash restricts a gitignore pattern to directories
    # only (git's own documented rule), and `.claude` is safe under
    # that restriction because every fixture path under it is a real
    # directory made by `git worktree add`. `node_modules` is not safe
    # under it: `make_link` below makes it a junction on Windows, which
    # answers True to "is a directory" here and so stayed ignored, but
    # the identical fixture makes it a SYMLINK on POSIX, which is a
    # non-directory dirent to git - `node_modules/` does not match it,
    # `git status` sees `?? node_modules`, and `agent-init park`
    # refuses the "1 uncommitted path" before the reaper is ever
    # reached (measured: CI run 31827576127, died in fixture setup).
    # Dropping the slash matches the entry regardless of the shape the
    # fixture gives it - directory, junction, symlink, or plain file.
    #
    # The real repository's own .gitignore keeps the trailing slash on
    # this entry, and that is not a second instance of this bug: a real
    # worktree's node_modules is always genuinely directory-shaped there
    # - either an `npm install` result or the owner's manual Windows
    # junction (also directory-shaped, per ESLINT_ENTRY's comment in
    # agent_init.py) - and nothing in this codebase makes it a POSIX
    # symlink outside this fixture. The symlink shape below exists only
    # to test the reaper's own walk/sever logic; it is this suite that
    # needs the unslashed pattern, to be able to fabricate that shape
    # without the fabrication itself falsely tripping park.
    write(os.path.join(primary, ".gitignore"), ".claude/\nnode_modules\n")
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

    print("\n--- a non-directory node_modules is ignored too, not only "
          "a link ---")

    # The comment on the .gitignore write above promises this arm: a
    # trailing-slash pattern matches directories only, so it covers the
    # junction fixture above (a junction answers True to "is a
    # directory" on this platform) but would NOT cover node_modules the
    # day it is not directory-shaped at all - the shape a POSIX symlink
    # has to git, and the shape that died in CI (run 31827576127): the
    # same suite, same fixture, a Linux runner - `git status` saw
    # `?? node_modules`, and `agent-init park` refused the "1
    # uncommitted path" before the reaper's own checks ever ran, which
    # is why the run died in fixture setup rather than in a check. A
    # plain FILE reproduces that same non-directory shape on any
    # platform, including this one, without a symlink privilege the
    # fixture cannot assume it has.
    nondir = add_worktree(primary, "wt-nondir-nodemodules",
                          "slice-nondir-nodemodules", first)
    write(os.path.join(nondir, "node_modules"), "not a directory\n")
    code, status = git(nondir, "status", "--porcelain")
    check("a non-directory node_modules is fully ignored, the same as "
          "a directory one",
          status.strip() == "")
    code, out = agent_init_park(nondir, state)
    check("park succeeds over it rather than refusing an uncommitted "
          "path",
          code == 0)

    print("\n--- the plan survives one candidate it cannot walk ---")

    # F3 (review-0.9-m0-s8-2026-08-14.md): find_links(path) raises when
    # `path` is ITSELF a reparse point. act() already guards the same
    # walk (sever_links) and turns that into a REPORT for one candidate;
    # this proves parked_items() owes the same answer, because it builds
    # this same steps-list whether or not --act was passed. Reachable
    # rather than asserted: a real parked worktree, relocated under the
    # sanctioned root and replaced at its REGISTERED path by a junction
    # to itself. within() resolves through the junction so containment
    # still holds, and git reads straight through a junction so every
    # other proof still passes - the one new fact is that the registered
    # path answers True to is_reparse, which is exactly what find_links
    # raises on.
    neighbor = add_worktree(primary, "wt-selfneighbor", "slice-selfneighbor",
                            first)
    park(neighbor, state)

    selflinked = add_worktree(primary, "wt-selflink", "slice-selflink",
                              first)
    park(selflinked, state)
    relocated = os.path.join(roots[0], "wt-selflink-relocated")
    shutil.move(selflinked, relocated)
    check("the fixture can make the registered path itself a link",
          make_link(selflinked, relocated))
    check("the registered path now reads as a reparse point",
          reaper.is_reparse(selflinked))

    items = reaper.plan(primary, state, roots)
    broken = find(items, "parked worktree", selflinked)
    check("the unwalkable candidate still enumerates rather than "
          "crashing the plan", broken is not None)
    check("it is reported, not planned, because the walk could not "
          "complete", broken is not None and broken["verdict"] == "report")
    check("the refusal names the walk, not a traceback",
          broken is not None and "could not complete" in reason(broken))
    check("its neighbor is unaffected and still reapable in the same "
          "plan",
          verdict(find(items, "parked worktree", neighbor)) == "reap")

    code, said = run_reaper(["--repo", primary, "--state", state,
                             "--roots", os.pathsep.join(roots)])
    check("report mode survives the unwalkable candidate and exits 0",
          code == 0)
    check("the report names the unwalkable candidate as REPORTED",
          "REPORTED" in said and selflinked in said)
    check("and still reports the neighbor as reapable in the same run",
          "WOULD REAP" in said and neighbor in said)

    code, said = run_reaper(["--act", "--repo", primary, "--state", state,
                             "--roots", os.pathsep.join(roots)])
    check("the unwalkable candidate survives an act",
          os.path.isdir(relocated))
    check("the neighbor IS reaped in the same act",
          not os.path.exists(neighbor))

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

    # F1 (review-0.9-m0-s8-2026-08-14.md): the arm above is satisfied by
    # `checked_out` (slice-live IS checked out in `live`), not by the
    # live-record guard in branch_items() it names - `slice-live` would
    # survive with that guard deleted. This is the case only that guard
    # owns: a live record naming a branch NOTHING has checked out,
    # landed on `accounts`. Mutating branch_items()'s live-record loop
    # to `if False:` makes this branch a "merged branch" candidate and
    # deletes it on --act; the two checks below are what reds.
    detached = os.path.join(root, "landed-and-detached")
    git(primary, "branch", "b-livework", first)
    agent_init.write_json(agent_init.record_path(detached, state), {
        "schema": agent_init.SCHEMA, "contract": agent_init.CONTRACT,
        "worktree": detached, "kind": "linked", "branch": "b-livework",
        "state": "live", "initialized_at": agent_init.now(),
        "ports": [8160, 8165], "scratch": None,
    })
    items = reaper.plan(primary, state, roots)
    check("a live record naming a branch NOTHING has checked out is "
          "still not a branch candidate",
          find(items, "merged branch", "b-livework") is None)
    code, said = run_reaper(["--act", "--repo", primary, "--state", state,
                             "--roots", os.pathsep.join(roots)])
    check("that branch survives an act", "b-livework" in branches(primary))

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

    print("\n--- the harness branch of a live worktree is left alone "
          "(0.9-M3-S21, #431) ---")

    # Twice on 2026-08-21 `--act` deleted the harness branch of a running
    # agent that had already switched to its slice branch: the branch was
    # no longer checked out anywhere, and agent-init had already
    # overwritten the SAME record's `branch` field to name the slice
    # branch instead of the harness branch - so neither existing guard
    # named it. Fixture A reproduces exactly that shape: its tip is an
    # ancestor of `accounts`, so the old code would have reaped it.
    harness_live = add_worktree(primary, "agent-harnesslive",
                                "worktree-agent-harnesslive", first)
    git(harness_live, "checkout", "-b", "slice-harnesslive", accounts)
    agent_init.write_json(agent_init.record_path(harness_live, state), {
        "schema": agent_init.SCHEMA, "contract": agent_init.CONTRACT,
        "worktree": harness_live, "kind": "linked",
        "branch": "slice-harnesslive", "state": "live",
        "initialized_at": agent_init.now(), "ports": [8170, 8175],
        "scratch": None,
    })

    # Fixture B: a registered worktree that never wrote a record at all -
    # the shape of a reviewer that detaches without ever running
    # agent-init, the ticket's other named timing accident.
    harness_norecord = add_worktree(
        primary, "agent-harnessnorecord", "worktree-agent-harnessnorecord",
        first)
    git(harness_norecord, "checkout", "--detach", accounts)

    # Fixture C: a PARKED record whose worktree directory is gone AND
    # whose registration is gone too. The branch is orphaned in every
    # sense and MUST fall through to the ordinary ancestry proof - the
    # worktree's own reap is what disposes of a parked worktree's
    # branch, and protecting it here on top of that would be a live
    # branch that can never be reaped once its worktree is gone.
    #
    # Fix wave 1, F1 (0.9-M3-S21 review, #431): `shutil.rmtree` ALONE
    # does not deregister a worktree - only `git worktree prune` (or a
    # `git worktree remove`) touches `.git/worktrees/`, so a fixture
    # built by rmtree alone still answers "registered" to
    # `protect_harness_branch`'s own check (confirmed against a real
    # repository: `git worktree list --porcelain` keeps listing the
    # path, marked prunable, until pruned). Without the explicit prune
    # below, this fixture was secretly the SAME shape as fixture E
    # below it - still registered - and its assertion locked in the
    # pre-fix answer (reap) for the wrong reason: the old
    # `protect_harness_branch` returned on the parked record before it
    # ever consulted the table, so registered-or-not made no difference
    # to it. Pruning here makes fixture C unambiguously the
    # NEITHER-record-nor-registration case that the ordinary ancestry
    # proof is supposed to own.
    harness_parked = add_worktree(
        primary, "agent-harnessparked", "worktree-agent-harnessparked",
        first)
    park(harness_parked, state)
    shutil.rmtree(harness_parked)
    git(primary, "worktree", "prune")

    # Fixture E (fix wave 1, F1, 0.9-M3-S21 review, #431): a PARKED
    # record whose worktree directory is still there and still
    # registered - the exact shape this repository's own machine
    # produced when the review found it (agent-a3faf444bda433c36 and
    # three more, all still registered with parked records, all planned
    # for reaping). `park()` alone would leave `record["branch"]` naming
    # THIS worktree's own harness branch, which would make it
    # `spoken_for` in plan() and hide it from branch_items() entirely -
    # so, matching fixture A and the real bug (`agent-init` rewrites a
    # record's `branch` field to the SLICE branch on every run), this
    # checks out a different branch before parking, so the certificate
    # names "slice-harnessparkedregistered", never the harness branch.
    harness_parked_registered = add_worktree(
        primary, "agent-harnessparkedregistered",
        "worktree-agent-harnessparkedregistered", first)
    git(harness_parked_registered, "checkout", "-b",
        "slice-harnessparkedregistered", accounts)
    park(harness_parked_registered, state)

    # Fixture D: a live record naming a worktree that was NEVER a real,
    # registered git worktree - the same shape the pre-existing "F1"
    # fixture below uses for a slice branch (agent_init.record_path only
    # needs a path string, not a real directory). This is the ONE
    # fixture the record check protects that the registered-worktree
    # fallback does not also protect on its own, which is what makes it
    # the mutation target for "remove the live-record check": disarming
    # ONLY that check, with fixtures A and B's real worktrees still
    # registered, would otherwise leave both of THEM protected by the
    # fallback and prove nothing about the record path specifically.
    harness_record_only = os.path.join(root, "agent-harnessrecordonly")
    git(primary, "branch", "worktree-agent-harnessrecordonly", first)
    agent_init.write_json(agent_init.record_path(harness_record_only, state), {
        "schema": agent_init.SCHEMA, "contract": agent_init.CONTRACT,
        "worktree": harness_record_only, "kind": "linked",
        "branch": "slice-harnessrecordonly", "state": "live",
        "initialized_at": agent_init.now(), "ports": [8190, 8195],
        "scratch": None,
    })

    items = reaper.plan(primary, state, roots)
    protected_live = find(items, "live harness branch, left alone",
                          "worktree-agent-harnesslive")
    check("a live, switched-away worktree's own harness branch is "
          "protected rather than planned as debris",
          protected_live is not None and verdict(protected_live) == "report")
    check("it is NOT also a debris-branch candidate",
          find(items, "debris branch", "worktree-agent-harnesslive") is None)
    check("the protection proof names the live record's state",
          protected_live and "state live" in " ".join(
              proof.said for proof in protected_live["proofs"]))

    protected_norecord = find(items, "live harness branch, left alone",
                              "worktree-agent-harnessnorecord")
    check("a registered worktree with no record at all still protects "
          "its own harness branch",
          protected_norecord is not None
          and verdict(protected_norecord) == "report")
    check("the protection proof names the registration, not a record",
          protected_norecord and "registers" in " ".join(
              proof.said for proof in protected_norecord["proofs"]))

    protected_record_only = find(items, "live harness branch, left alone",
                                 "worktree-agent-harnessrecordonly")
    check("a live record protects its harness branch even when no real "
          "worktree was ever registered for it",
          protected_record_only is not None
          and verdict(protected_record_only) == "report")
    check("it is NOT also a debris-branch candidate",
          find(items, "debris branch",
               "worktree-agent-harnessrecordonly") is None)
    check("the protection proof names the live record's state, same as "
          "fixture A",
          protected_record_only and "state live" in " ".join(
              proof.said for proof in protected_record_only["proofs"]))
    said_record_only = reaper.act(primary, protected_record_only, state,
                                  roots)
    check("acting on the record-only-protected item performs nothing",
          said_record_only == ["REPORTED and left alone."])
    check("its branch survives being acted on directly",
          "worktree-agent-harnessrecordonly" in branches(primary))

    # Fixture E's assertions (fix wave 1, F1, #431): a registered
    # worktree protects its harness branch REGARDLESS of what its own
    # record says - the record here says parked, which alone protects
    # nothing (fixture C proves that half), but the registration still
    # does. This is the ticket's own promised sentence, and the arm that
    # goes red if the early return the old code took on a parked record
    # is ever restored.
    protected_parked_registered = find(
        items, "live harness branch, left alone",
        "worktree-agent-harnessparkedregistered")
    check("a parked record's harness branch IS protected while its "
          "worktree is still registered - registration outranks a "
          "stale record",
          protected_parked_registered is not None
          and verdict(protected_parked_registered) == "report")
    check("it is NOT also a debris-branch candidate",
          find(items, "debris branch",
               "worktree-agent-harnessparkedregistered") is None)
    check("the protection proof names the registration, since the "
          "record alone (parked) does not license it",
          protected_parked_registered and "registers" in " ".join(
              proof.said for proof in
              protected_parked_registered["proofs"]))
    said_parked_registered = reaper.act(
        primary, protected_parked_registered, state, roots)
    check("acting on the registration-protected parked item performs "
          "nothing",
          said_parked_registered == ["REPORTED and left alone."])
    check("its branch survives being acted on directly",
          "worktree-agent-harnessparkedregistered" in branches(primary))
    # Retired here rather than left lingering: unlike fixtures A/B/D,
    # this worktree is NOT protected as a "parked worktree" candidate in
    # its own right (only its BRANCH is protected), so a later blanket
    # `--act` elsewhere in this suite would genuinely reap the directory
    # - harmless, but it would make a much later assertion's evidence
    # depend on this fixture's fate. Removing it here keeps this
    # fixture's proof scoped to what it was built to show.
    git(primary, "worktree", "remove", "--force",
        harness_parked_registered)
    git(primary, "branch", "-D", "worktree-agent-harnessparkedregistered")

    orphaned_debris = find(items, "debris branch",
                           "worktree-agent-harnessparked")
    check("a parked record's harness branch is NOT protected once its "
          "worktree is gone - it falls to the ordinary ancestry proof",
          orphaned_debris is not None and verdict(orphaned_debris) == "reap")
    check("it is not misfiled under the protected heading",
          find(items, "live harness branch, left alone",
               "worktree-agent-harnessparked") is None)

    # `code`/`said` are deliberately NOT reused here: the "no branch is
    # deleted without the proof" check right after this section reads
    # `said` from the branch-classes act() above, and shadowing it with
    # a report-mode call (which performs nothing and prints no "deleted
    # branch" lines) would starve that check of its evidence.
    _code_report, said_report = run_reaper(
        ["--repo", primary, "--state", state,
         "--roots", os.pathsep.join(roots)])
    check("report mode prints the new heading",
          "live harness branch, left alone" in said_report)
    check("the report names both protected branches as evidence under it",
          "worktree-agent-harnesslive" in said_report
          and "worktree-agent-harnessnorecord" in said_report)
    check("report mode changed nothing - both protected branches still "
          "exist",
          "worktree-agent-harnesslive" in branches(primary)
          and "worktree-agent-harnessnorecord" in branches(primary))

    said_live = reaper.act(primary, protected_live, state, roots)
    check("acting on a protected item performs nothing",
          said_live == ["REPORTED and left alone."])
    said_norecord = reaper.act(primary, protected_norecord, state, roots)
    check("acting on the no-record-protected item performs nothing too",
          said_norecord == ["REPORTED and left alone."])
    check("both harness branches survive being acted on directly",
          "worktree-agent-harnesslive" in branches(primary)
          and "worktree-agent-harnessnorecord" in branches(primary))

    said_parked = reaper.act(primary, orphaned_debris, state, roots)
    check("the orphaned parked-record's harness branch IS deleted, with "
          "its ancestry proof in the output",
          any("ancestor of" in line for line in said_parked))
    check("--report predicted exactly what --act did: it is gone now",
          "worktree-agent-harnessparked" not in branches(primary))

    print("\n--- F2 (fix wave 1, 0.9-M3-S21 review, #431): act() re-checks "
          "harness protection too, not only plan() ---")

    # The general shape of every race arm in this file (see BLOCKER 2 and
    # BLOCKER 3 below): plan a candidate, then change the fact the plan
    # relied on, then drive the STALE item through act() directly. Here
    # the fact that changes is the one this fix wave added -
    # `protect_harness_branch`'s own answer - which act() did not
    # re-ask at all before this fix (F2): a `worktree-agent-<id>`
    # classified debris when the plan ran stayed classified debris
    # forever, even if a record for `<id>` went live before the act
    # loop reached it.
    git(primary, "branch", "worktree-agent-actgap", first)
    before_race = reaper.plan(primary, state, roots)
    raced_debris = find(before_race, "debris branch",
                        "worktree-agent-actgap")
    check("the not-yet-protected harness branch is planned for reaping "
          "before the race",
          raced_debris is not None and verdict(raced_debris) == "reap")

    # The record appears between the plan and the act - an agent-init
    # that finally ran, or (the two-step race the docstring names) one
    # that ran and then wrote a fresh worktree record for an id the plan
    # had already looked at and found nothing for.
    agent_init.write_json(
        agent_init.record_path(os.path.join(root, "agent-actgap"), state),
        {"schema": agent_init.SCHEMA, "contract": agent_init.CONTRACT,
         "worktree": os.path.join(root, "agent-actgap"), "kind": "linked",
         "branch": "slice-actgap", "state": "live",
         "initialized_at": agent_init.now(), "ports": [8196, 8197],
         "scratch": None})

    said_actgap = reaper.act(primary, raced_debris, state, roots)
    check("act() refuses the branch that went live during the race, "
          "naming the new record",
          any("live harness ref" in line for line in said_actgap))
    check("THE RACED HARNESS BRANCH SURVIVES THE ACT",
          "worktree-agent-actgap" in branches(primary))

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

    # The escalation this program must never make, driven directly.
    # `-d` failing is the reason `-D` is reached, and a `-d` that never
    # ANSWERED has not failed - it has said nothing. Reading silence as
    # a refusal and answering it with the forced form would turn the
    # safest branch in the plan into the one deleted with no second
    # opinion at all, which is the precise inverse of the hold_back law
    # above.
    #
    # ONLY `git branch -d` is silenced, not the whole clock. delete_branch
    # now re-resolves the tip before it reaches `-d` (BLOCKER 2), and a
    # blanket tiny timeout would expire that rev-parse first - so the arm
    # would prove the re-resolve refuses, not the `-D`-not-tried
    # escalation it is here for. Silencing the one command reaches the
    # escalation guard with the tip check having genuinely passed.
    tip_now = sha(primary, "slice-timeout")
    honest_for_d = reaper.git

    def silent_branch_d(repo, *args):
        if args[:2] == ("branch", "-d"):
            said = "`git branch -d` in %s did not answer" % repo
            reaper.TROUBLE.append(said)
            return reaper.GIT_TIMED_OUT, said
        return honest_for_d(repo, *args)

    reaper.git = silent_branch_d
    try:
        went, said = reaper.delete_branch(primary, "slice-timeout", tip_now,
                                          "a proof nobody checked")
    finally:
        reaper.git = honest_for_d
        del reaper.TROUBLE[:]
    check("a branch deletion whose -d never answered does not go",
          went is False)
    check("and says `-D` was NOT tried", "NOT tried" in said)
    check("AND THE BRANCH IS STILL THERE",
          "slice-timeout" in branches(primary))

    # BLOCKER 2 at the unit: the same call refuses outright when the tip
    # no longer equals what was planned, whatever else would license it.
    # first IS an ancestor of accounts, so nothing but the moved tip
    # stops the delete here.
    git(primary, "branch", "b-moved-unit", first)
    went, said = reaper.delete_branch(primary, "b-moved-unit", accounts,
                                      "a proof that named the wrong tip")
    check("delete_branch refuses a tip that moved off the planned SHA",
          went is False and "moved" in said and "NOT deleted" in said)
    check("and the moved-tip branch is untouched",
          "b-moved-unit" in branches(primary))
    went, said = reaper.delete_branch(primary, "b-moved-unit", first,
                                      "first is an ancestor of accounts")
    check("delete_branch deletes when the tip matches the planned SHA",
          went is True)
    check("and that branch is then gone",
          "b-moved-unit" not in branches(primary))

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

    print("\n--- an --act run fully held back says so, not \"reaped\" ---")

    # Honesty pair (review-0.9-m0-s8-2026-08-14.md): hold_back() above is
    # driven directly; this is the END-TO-END shape it exists for - a
    # command going silent PARTWAY through a run that started fine, so
    # `main()`'s survey succeeds and the act loop finds nothing with
    # verdict "reap" left to try. `is_ancestor` is the one call every
    # branch proof reaches for, so making `git merge-base` silent (and
    # nothing else) reproduces that shape without the survey refusing
    # first, the way the blanket GIT_TIMEOUT arm above does.
    check("the timeout survivor is reapable again before this arm",
          verdict(find(reaper.plan(primary, state, roots),
                       "parked worktree", survivor)) == "reap")

    honest_git = reaper.git

    def silent_merge_base(repo, *args):
        if args[:1] == ("merge-base",):
            said = "`git merge-base` in %s did not answer" % repo
            reaper.TROUBLE.append(said)
            return reaper.GIT_TIMED_OUT, said
        return honest_git(repo, *args)

    reaper.git = silent_merge_base
    try:
        code, said = run_reaper(["--act", "--repo", primary, "--state",
                                 state, "--roots", os.pathsep.join(roots)])
    finally:
        reaper.git = honest_git
        del reaper.TROUBLE[:]

    check("a fully held-back --act exits nonzero", code != 0)
    check("it prints WOULD REAP/REAPING zero times - every reap was "
          "downgraded", "WOULD REAP" not in said and "REAPING" not in said)
    check("it does NOT claim every proven candidate was reaped",
          "Every proven candidate was reaped" not in said)
    check("it says what actually happened instead: held back, nothing "
          "reaped",
          "held back" in said.lower() and "nothing was reaped"
          in said.lower())
    check("the survivor worktree was never touched", os.path.isdir(survivor))
    check("its branch was never touched", "slice-timeout" in branches(
        primary))
    check("it is reapable again once merge-base answers",
          verdict(find(reaper.plan(primary, state, roots),
                       "parked worktree", survivor)) == "reap")

    print("\n--- --report is a real flag, not only the shape typing "
          "nothing gets you ---")

    # The reviewer ran `--report` expecting the documented invocation and
    # got argparse's exit 2 instead ("--report is not a flag"). Accepted
    # here as an explicit, inert alias of the default so that invocation
    # is real. A rejection would raise SystemExit(2) rather than return,
    # which is why the check is inside the try - a suite that let that
    # propagate would crash instead of failing one line.
    try:
        code, said = run_reaper(["--report", "--repo", primary, "--state",
                                 state, "--roots", os.pathsep.join(roots)])
        accepted = True
    except SystemExit:
        code, said, accepted = 2, "", False
    check("--report is accepted as a flag rather than rejected by "
          "argparse", accepted)
    check("--report reads as report mode, the same the default gets",
          accepted and "reaper: report" in said)
    check("--report performs nothing, same as the default",
          accepted and "Nothing above was performed" in said)

    print("\n--- a prune nobody could confirm is not a prune ---")

    # The one reader in act() is SUBSTITUTED here rather than driven,
    # and it is worth saying why: the confirming read happens partway
    # through an act, so no bound set before the act begins can single
    # it out - a timeout small enough to reach it kills the prune in
    # front of it too. Three answers is the whole of what this arm is
    # about, and folding 'could not be read' into 'nothing there' is
    # how a timed-out confirmation prints as a success.
    ghost = {"kind": "vanished worktree",
             "subject": os.path.join(roots[0], "wt-never-existed"),
             "proofs": [], "verdict": "reap", "plan": [], "park": {},
             "record": None}
    honest = reaper.worktree_table
    try:
        reaper.worktree_table = lambda repo: None
        said = reaper.act(primary, ghost, state, roots)
        check("an unreadable table reports the prune as unconfirmed",
              any("could NOT be confirmed" in line for line in said))
        reaper.worktree_table = lambda repo: []
        said = reaper.act(primary, ghost, state, roots)
        check("a table without it reports a prune",
              any("pruned the worktree registration" in line
                  for line in said))
        reaper.worktree_table = lambda repo: [{"path": ghost["subject"]}]
        said = reaper.act(primary, ghost, state, roots)
        check("a table still holding it reports a survival",
              any("SURVIVED the prune" in line for line in said))
    finally:
        reaper.worktree_table = honest

    print("\n--- BLOCKER 2: a branch that advances between plan and act is "
          "refused, not force-deleted ---")

    # The real git race the 2nd audit named, end to end: a branch proven
    # landed is planned for reaping, then - before the act - another
    # process advances it onto unmerged work. Deleting the NAME now would
    # lose commit B, having proved only that the SHA the name pointed at
    # when the plan ran had landed. act() re-resolves the tip immediately
    # before deleting and refuses the moved name. Driven through act()
    # on the stale plan item, which is exactly the plan-to-act gap.
    git(primary, "branch", "b-race-merged", first)
    items = reaper.plan(primary, state, roots)
    raced = find(items, "merged branch", "b-race-merged")
    check("the landed race branch is planned for reaping",
          verdict(raced) == "reap")
    planned_sha = raced["sha"] if raced else None

    racewt = os.path.join(root, "race-merged-wt")
    git(primary, "worktree", "add", "--detach", racewt, "accounts")
    write(os.path.join(racewt, "raced.txt"), "unmerged work after the plan\n")
    git(racewt, "add", "-A")
    git(racewt, "commit", "-m", "raced ahead of the plan")
    raced_b = sha(racewt, "HEAD")
    git(primary, "branch", "-f", "b-race-merged", raced_b)
    git(primary, "worktree", "remove", "--force", racewt)
    check("the fixture actually moved the branch after the plan",
          raced_b != planned_sha and raced_b is not None)

    said = reaper.act(primary, raced, state, roots)
    check("the moved branch is refused at act time, naming the move",
          any("moved" in line and "NOT deleted" in line for line in said))
    check("THE RACED BRANCH SURVIVES THE ACT",
          "b-race-merged" in branches(primary))
    check("IT STILL POINTS AT THE UNMERGED COMMIT B",
          sha(primary, "b-race-merged") == raced_b)
    check("AND COMMIT B IS STILL A REACHABLE OBJECT",
          git(primary, "cat-file", "-e", raced_b)[0] == 0)

    print("\n--- BLOCKER 3: every parked-worktree licensing proof is "
          "re-established at act time ---")

    # One helper per case: a fresh parked, reapable worktree, and the
    # STALE plan item that licenses it. Each case then mutates the live
    # machine the way a race would - a lease taken, a lock set, HEAD
    # moved, an untracked file written, the branch advanced - and drives
    # the stale item through act(). A reap that re-proved only
    # containment and registration would delete every one of these; the
    # re-established proof set refuses each and leaves it exactly as
    # found.
    def fresh_parked(name, branch):
        wt = add_worktree(primary, name, branch, first)
        park(wt, state)
        it = find(reaper.plan(primary, state, roots), "parked worktree", wt)
        check("%s is planned for reaping before the race" % name,
              verdict(it) == "reap")
        return wt, it

    def reported(said):
        return any(line.startswith("REPORTED") for line in said)

    def retire(wt):
        # Each survival is asserted before this runs, so the fixture has
        # done its job; retiring it keeps it out of every later plan's
        # enumeration. The enumeration is one git spawn per registered
        # worktree, so an accumulating fixture makes the whole suite grow
        # quadratically - measured on Windows, where a git spawn is the
        # dominant cost. `--force` because the mutation left the tree
        # dirty or off its recorded HEAD on purpose.
        if os.path.isdir(wt):
            git(primary, "worktree", "remove", "--force", wt)

    # A lease taken after the plan.
    wt, it = fresh_parked("wt-race-lease", "slice-race-lease")
    lease_race = agent_init.lease_path((8150, 8151), state)
    agent_init.write_lease(lease_race, os.path.abspath(wt),
                           "slice-race-lease", (8150, 8151))
    said = reaper.act(primary, it, state, roots)
    check("a lease taken after the plan refuses the reap", reported(said))
    check("the refusal names the lease",
          any("lease" in line and "8150" in line for line in said))
    check("the raced-lease worktree survives untouched", os.path.isdir(wt))
    check("its branch survives", "slice-race-lease" in branches(primary))
    # Guarded: under a GREEN reaper the reap was refused and the lease is
    # still here, so this removes it to keep the next arm's plan clean.
    # A mutation that made act() ignore the lease would already have
    # dropped it, and this must not crash the mutation battery before it
    # reaches the arms below.
    if os.path.isfile(lease_race):
        os.remove(lease_race)
    retire(wt)

    # A git worktree lock set after the plan.
    wt, it = fresh_parked("wt-race-lock", "slice-race-lock")
    git(primary, "worktree", "lock", wt)
    said = reaper.act(primary, it, state, roots)
    check("a lock set after the plan refuses the reap", reported(said))
    check("the refusal names the lock",
          any("lock" in line for line in said))
    check("the raced-lock worktree survives", os.path.isdir(wt))
    git(primary, "worktree", "unlock", wt)
    retire(wt)

    # HEAD moved off the certificate's recorded SHA after the plan.
    wt, it = fresh_parked("wt-race-head", "slice-race-head")
    git(wt, "checkout", "--detach", accounts)
    said = reaper.act(primary, it, state, roots)
    check("HEAD moving after the plan refuses the reap", reported(said))
    check("the refusal names HEAD",
          any("HEAD" in line for line in said))
    check("the raced-head worktree survives", os.path.isdir(wt))
    retire(wt)

    # An untracked file written into the worktree after the plan.
    wt, it = fresh_parked("wt-race-dirty", "slice-race-dirty")
    write(os.path.join(wt, "raced-unsaved.txt"),
          "work created after the plan\n")
    said = reaper.act(primary, it, state, roots)
    check("an untracked file appearing after the plan refuses the reap",
          reported(said))
    check("the refusal names the uncommitted path",
          any("raced-unsaved.txt" in line for line in said))
    check("the raced-dirty worktree keeps its unsaved work",
          os.path.isfile(os.path.join(wt, "raced-unsaved.txt")))
    retire(wt)

    # The worktree's own branch advanced onto unmerged work after the
    # plan - BLOCKER 2's tip check reached as one of BLOCKER 3's proof
    # set. Nothing has the branch checked out (park detached HEAD), so
    # `branch -f` moves it; the reap must refuse and the unmerged commit
    # must survive.
    wt, it = fresh_parked("wt-race-tip", "slice-race-tip")
    tipwt = os.path.join(root, "race-tip-wt")
    git(primary, "worktree", "add", "--detach", tipwt, "accounts")
    write(os.path.join(tipwt, "tipwork.txt"), "unmerged branch work\n")
    git(tipwt, "add", "-A")
    git(tipwt, "commit", "-m", "advance the branch past its certificate")
    tip_b = sha(tipwt, "HEAD")
    git(primary, "worktree", "remove", "--force", tipwt)
    git(primary, "branch", "-f", "slice-race-tip", tip_b)
    said = reaper.act(primary, it, state, roots)
    check("the branch tip moving after the plan refuses the reap",
          reported(said))
    check("the raced-tip worktree survives", os.path.isdir(wt))
    check("its branch still points at the unmerged commit",
          sha(primary, "slice-race-tip") == tip_b)
    check("and the unmerged commit survives as a reachable object",
          git(primary, "cat-file", "-e", tip_b)[0] == 0)
    retire(wt)

    # Registration withdrawn after the plan: the worktree is moved out
    # from under git so it is no longer a linked worktree of this
    # repository. The re-established registered proof - or the table read
    # ahead of it - must refuse rather than delete a path the repository
    # no longer owns.
    wt, it = fresh_parked("wt-race-unreg", "slice-race-unreg")
    git(primary, "worktree", "remove", "--force", wt)
    check("the fixture left no directory behind after the removal",
          not os.path.exists(wt))
    said = reaper.act(primary, it, state, roots)
    check("a worktree git no longer registers is refused, not deleted",
          reported(said))

    print("\n--- MAJOR 1: a registration that survives the prune is an "
          "incomplete reap, not a success ---")

    # A real vanished worktree - registered, directory gone - carrying a
    # dead lease and a real record. The prune is forced to appear to fail
    # by keeping the doomed path in the worktree table after
    # `git worktree prune` runs. The old code printed SURVIVED but still
    # dropped the lease, stamped the record reaped and exited 0. The reap
    # is now incomplete: the lease stays, the record stays parked, and
    # the run exits nonzero.
    survived = add_worktree(primary, "wt-survive", "slice-survive", first)
    park(survived, state)
    lease_survive = agent_init.lease_path((8154, 8155), state)
    agent_init.write_lease(lease_survive, os.path.abspath(survived),
                           "slice-survive", (8154, 8155))
    shutil.rmtree(survived)
    survivor_abs = os.path.abspath(survived)
    item = find(reaper.plan(primary, state, roots), "vanished worktree",
                survived)
    check("the vanished-with-lease worktree is a reap candidate",
          verdict(item) == "reap")

    honest_tbl = reaper.worktree_table

    def prune_never_takes(repo):
        tbl = honest_tbl(repo)
        if tbl is None:
            return None
        if not any(entry["path"] == survivor_abs for entry in tbl):
            tbl = [*tbl, {"path": survivor_abs, "head": None,
                          "branch": None, "locked": False,
                          "lock_reason": "", "prunable": None}]
        return tbl

    reaper.worktree_table = prune_never_takes
    try:
        said = reaper.act(primary, item, state, roots)
        check("the act reports the registration SURVIVED the prune",
              any("SURVIVED the prune" in line for line in said))
        check("a survived prune is flagged incomplete, counted as trouble",
              any("could NOT" in line for line in said))
        check("the dead lease is NOT dropped on an incomplete reap",
              os.path.isfile(lease_survive))
        rec = agent_init.read_json(agent_init.record_path(survived, state))
        check("the record is NOT marked reaped on an incomplete reap",
              rec.get("state") != "reaped")
        # And end to end: a full --act run in which the prune survives
        # exits nonzero rather than claiming success.
        code, whole = run_reaper(["--act", "--repo", primary, "--state",
                                  state, "--roots", os.pathsep.join(roots)])
        check("an --act run whose prune survived exits nonzero", code != 0)
        check("it does not claim every proven candidate was reaped",
              "Every proven candidate was reaped" not in whole)
        check("and the dead lease is still not dropped after the run",
              os.path.isfile(lease_survive))
    finally:
        reaper.worktree_table = honest_tbl

finally:
    agent_init.rmtree_hard(root)

print("\n%d checks, %d failure(s)" % (performed, failures))
if performed != EXPECTED:
    print("EXPECTED %d checks and %d ran. A suite that quietly stops "
          "running is a suite that quietly stops checking."
          % (EXPECTED, performed))
    sys.exit(1)
sys.exit(1 if failures else 0)
