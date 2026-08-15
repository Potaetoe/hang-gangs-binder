"""Contract checks for the worktree contract: agent-init and agent-park.

    py -3 tools/agent_init_suite.py

WHY THE ARMS SIT IN tools/ AND THE ENTRY POINT SITS IN tests/

`tests/` holds `.mjs` entry points, and the new apparatus (0.9-M0-S4)
guards that: a file there under any other extension is a stray, and a
Python suite parked among them fails the guard for being written in the
wrong language rather than for being wrong. So the arms live beside the
module they test, and `tests/worktree-contract.test.mjs` is the entry
point - five lines that find a Python and hand it this file, exiting on
its status. That shim is what makes these arms reachable by a runner
that only knows how to launch `.mjs`, and the two halves are one check:
this file holds every assertion and the shim holds none.

Until #281's runner registers that entry point, both halves are run by
hand and no handoff may report either as gated.

WHY THIS BUILDS REAL REPOSITORIES INSTEAD OF ASSERTING ON STRINGS

The rules under test are rules about a checkout, and the decisive one
is about a state git itself produces: a worktree whose files hold the
wrong end-of-line form while `git status` calls the tree clean. That
state cannot be faked with a fixture - it is the interaction between
.gitattributes, the index, the stat information git recorded at
checkout time, and a pin that arrived after all three. A mock of it
would be a mock of my own belief about how git behaves, which is the
belief that has been wrong here twice.

So the trap is BUILT, by the sequence that builds it in life: commit a
file while nothing pins its line endings, check it out so the working
copy is CRLF and git records that copy's stat information, then commit
the pin. Nothing rewrites the file, so it sits CRLF under a pin that
says LF, and git reports a clean tree. Every arm below runs against
that, in a temporary directory, with real git commands. The linked
worktree the park arms use is a real linked worktree.

The repository is created with core.autocrlf true, which is what makes
these arms mean the same thing on a Linux runner as on the Windows
machine the trap was found on: the checkout step produces CRLF because
the config asks for it, rather than because the platform does.

What this costs is a few seconds and a dependency on git and node.
What it buys is an arm that fails if git behaves differently from what
tools/agent_init.py assumes on the machine actually running it, which
is the only place that question matters. It has already paid: the
uncommitted-work arm found a real defect in the implementation, where
stripping git's output shifted a path by one character and stopped the
repair from recognizing a file it must not touch.

Self-contained on purpose: no import from dev/, no framework, no new
dependency. #281 adopts this pair by registering the entry point, not
by rewriting the arms.
"""

import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from contextlib import redirect_stdout

# The module under test sits in this file's own directory, which Python
# puts on the path for a script it is handed - so a plain import is the
# whole wiring, and there is no path arithmetic here to get wrong when
# the entry point launches this from the repository root.
import agent_init

failures = 0
performed = 0

# Asserted at the end rather than only printed. A hand-written total
# nothing compares against still prints a confident pass when a check
# stops running - an early return, a renamed helper - which is the
# armed-looking-but-not failure this repository holds to be worse than
# no check at all.
EXPECTED = 117


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
        print("FAIL  %s" % label)
    else:
        print("ok    %s" % label)


def git(repo, *args):
    done = subprocess.run(
        ["git", "-C", repo, "-c", "user.email=suite@example.invalid",
         "-c", "user.name=suite", *args],
        capture_output=True, text=True,
    )
    return done.returncode, done.stdout + done.stderr


class InjectGitWarning:
    """While active, every git command still runs for REAL - stdout is
    untouched - but its stderr gets one extra line glued on: the shape
    the documented real-world case took (0.9-M0-S18, #310), a global
    excludes file git could not read, printing `warning: unable to
    access '<path>': Permission denied` while still exiting 0.

    Manufactured on the subprocess boundary rather than by actually
    breaking a global excludes file, because this suite found that case
    turns FATAL rather than a warning on the git version and platform
    that wrote it (git 2.55, Windows) - a fact about that build, not
    about the code these arms exist to prove. What is under test is
    what agent_init's parsers do once a process has produced two
    streams, which does not depend on which git behaviour put a line on
    one of them - so this seam patches subprocess.run itself, one level
    below git(), and every caller downstream runs unmodified against a
    real command's real output plus one synthetic line of noise.
    """

    WARNING = ("warning: unable to access "
               "'/home/agent/.config/git/ignore': Permission denied\n")

    def __enter__(self):
        self._real_run = agent_init.subprocess.run

        def patched(argv, *args, **kwargs):
            done = self._real_run(argv, *args, **kwargs)
            if list(argv[:1]) == ["git"]:
                done.stderr = self.WARNING + (done.stderr or "")
            return done

        agent_init.subprocess.run = patched
        return self

    def __exit__(self, *exc_info):
        agent_init.subprocess.run = self._real_run
        return False


def write(path, data, newline="\n"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data.replace("\n", newline).encode("utf-8"))


def read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def save(path, data):
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle)


# The name every working root of this suite is made under, and the only
# name the sweep below will delete.
PREFIX = "worktree-contract-"

# How old a matching directory must be before the sweep believes it
# belongs to a FINISHED run. This suite takes seconds, so an hour is not
# a close call - and the thing it protects is a second agent running
# this file right now, whose working root carries the same name by
# construction. Deleting that would be this sweep doing to a live run
# exactly what the leak did to a shared directory.
STALE_AFTER = 3600


def sweep_prior_roots(parent, keep, now=None):
    """Remove roots earlier runs of this suite left in `parent`.

    A recursive delete loose in the directory every program on the
    machine shares, so what it matches IS the safety argument. Two
    limits carry it: directly under the parent and never below it, and
    the full prefix including its separator - a neighbour called
    `worktree-contractor` starts with the same letters, belongs to
    somebody else, and is the same distinction park's containment guard
    turns on.
    """
    swept = []
    now = time.time() if now is None else now
    for name in sorted(os.listdir(parent)):
        path = os.path.join(parent, name)
        if not name.startswith(PREFIX) or path == keep:
            continue
        if not os.path.isdir(path) or os.path.islink(path):
            continue
        if now - os.path.getmtime(path) < STALE_AFTER:
            continue
        agent_init.rmtree_hard(path)
        swept.append(name)
    return swept


def run_verb(argv):
    """(exit code, everything it printed)."""
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = agent_init.main(argv)
    return code, buffer.getvalue()


# A stand-in for the gate stage the readiness probe runs. The probe's
# contract is that it runs a real stage and believes its exit code, and
# a stand-in is what lets both directions of that be exercised - the
# real generator has no failing mode to ask for on demand.
PROBE_SOURCE = "process.exit(process.env.PROBE_FAIL ? 1 : 0);\n"

ATTRS = "* text=auto\n*.txt text eol=lf\n*.cmd text eol=crlf\n"


def build_repo(root):
    """A repository holding the trap, built the way life builds it."""
    os.makedirs(root, exist_ok=True)
    git(root, "init", "-q")
    git(root, "config", "core.autocrlf", "true")
    write(os.path.join(root, ".gitattributes"), "* text=auto\n")
    write(os.path.join(root, ".gitignore"), "node_modules/\n")
    write(os.path.join(root, "pinned.txt"), "one\ntwo\nthree\n")
    write(os.path.join(root, "windows.cmd"), "@echo off\n")
    write(os.path.join(root, "loose.dat"), "unpinned\ncontent\n")
    write(os.path.join(root, "tools", "build_web.mjs"), PROBE_SOURCE)
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "the tree, before any pin")

    # Deleted and re-checked-out so git WRITES the working copies: they
    # come back CRLF because the config asks for it, and git records
    # that copy's stat information. Without this step the files on disk
    # are the ones written above and no checkout ever touched them,
    # which is a different state that git reports honestly.
    for name in ("pinned.txt", "windows.cmd"):
        os.remove(os.path.join(root, name))
    git(root, "checkout", "-q", "--", "pinned.txt", "windows.cmd")

    write(os.path.join(root, ".gitattributes"), ATTRS)
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "the pins arrive, and nothing rewrites")
    return root


def link_dir(target, link):
    """A junction or symlink, or None if this machine allows neither."""
    try:
        os.symlink(target, link, target_is_directory=True)
        return "symlink"
    except (OSError, NotImplementedError, AttributeError):
        pass
    if os.name == "nt":
        done = subprocess.run(["cmd", "/c", "mklink", "/J", link, target],
                              capture_output=True, text=True)
        if done.returncode == 0:
            return "junction"
    return None


base = tempfile.mkdtemp(prefix=PREFIX)
state = os.path.join(base, "fleet-state")

# Scratch directories are made under a root this suite owns and deletes.
# Without this every run left one behind in the shared parent, because
# the temporary repositories here are never parked and park is what
# removes a scratch directory - a suite that leaks while testing the
# verb that cleans up.
os.environ["BINDER_SCRATCH_ROOT"] = os.path.join(base, "scratch")

# What earlier runs of this file left behind before its teardown could
# survive Windows. Swept at the start rather than at the end because a
# run that dies partway is exactly the run that leaks, and a cleanup
# that only happens on the way out never runs for it.
leaked = sweep_prior_roots(tempfile.gettempdir(), base)
if leaked:
    print("swept %d root(s) left by earlier runs: %s\n"
          % (len(leaked), ", ".join(leaked)))

try:
    # ------------------------------------------------------------------
    # A. The trap, and the whole init path over it.
    # ------------------------------------------------------------------
    repo = build_repo(os.path.join(base, "primary"))

    fixable, committed, binary = agent_init.eol_problems(repo)
    check("a CRLF working file under an eol=lf pin is reported",
          [entry[0] for entry in fixable] == ["pinned.txt"])
    check("it is reported as fixable, not as a committed defect",
          committed == [] and binary == [])
    check("the unpinned file is not reported",
          all(entry[0] != "loose.dat" for entry in fixable))
    check("git calls the tree CLEAN while that is true - the trap",
          git(repo, "status", "--porcelain")[1] == "")

    problems = agent_init.initialization_problems(repo, state)
    check("an uninitialized worktree reports exactly one problem",
          len(problems) == 1)
    check("and the problem names the verb that fixes it",
          "agent-init" in problems[0])

    code, out = run_verb(["init", "--repo", repo, "--state", state,
                          "--no-install"])
    check("agent-init succeeds on the trapped tree", code == 0)
    check("and says it renormalized the file",
          "renormalized" in out and "pinned.txt" in out)
    check("and the bytes on disk are LF afterwards",
          read_bytes(os.path.join(repo, "pinned.txt")) == b"one\ntwo\nthree\n")
    check("and nothing is left to report",
          agent_init.eol_problems(repo)[0] == [])
    check("and it prints the contract rather than narrating it",
          "the environment contract" in out and "teardown" in out)
    check("and it says the environment is ready without claiming the gate",
          "THE ENVIRONMENT IS READY" in out)
    check("the scratch directory is made under the root, outside the tree",
          os.path.isdir(load(agent_init.record_path(repo, state))["scratch"])
          and load(agent_init.record_path(repo, state))["scratch"].startswith(
              os.environ["BINDER_SCRATCH_ROOT"]))
    # An init that was told not to install is still an honest init, and
    # the detection says so: the lint stage would report a missing
    # node_modules as FAILED, so a worktree without one is not one the
    # gate can be trusted to run in.
    check("an init that skipped the install still reports the lint entry",
          any("eslint" in line for line in
              agent_init.initialization_problems(repo, state)))

    # The readiness probe is a real program with real imports, so with
    # the dependencies absent its red says nothing whatever about the
    # tree. Which of the two the verb is looking at has to be in the
    # message, or the verb commits the cry-wolf failure it exists to end.
    os.environ["PROBE_FAIL"] = "1"
    code, out = run_verb(["init", "--repo", repo, "--state", state,
                          "--no-install"])
    check("a probe that fails with no install is not blamed on the tree",
          code == 1 and "could not RUN" in out)
    check("and its remedy is the install, not a tree to go and fix",
          "let it install" in out)
    del os.environ["PROBE_FAIL"]

    # ------------------------------------------------------------------
    # B. The other direction of a pin, and the two states it refuses.
    # ------------------------------------------------------------------
    write(os.path.join(repo, "windows.cmd"), "@echo off\n")
    fixable, _, _ = agent_init.eol_problems(repo)
    check("an LF working file under an eol=crlf pin is reported",
          [entry[0] for entry in fixable] == ["windows.cmd"])
    agent_init.renormalize(repo, ["windows.cmd"])
    check("it is repaired to CRLF, not to LF",
          read_bytes(os.path.join(repo, "windows.cmd")) == b"@echo off\r\n")

    # CRLF in the INDEX, which re-checking-out cannot fix. Built the way
    # it happens for real: the bytes go in while nothing normalizes
    # them, and the pin that says they are wrong arrives afterwards.
    write(os.path.join(repo, ".gitattributes"), ATTRS + "later.txt -text\n")
    write(os.path.join(repo, "later.txt"), "a\nb\n", newline="\r\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "bytes nothing normalized")
    write(os.path.join(repo, ".gitattributes"),
          ATTRS + "later.txt text eol=lf\n")
    _, committed, _ = agent_init.eol_problems(repo)
    check("CRLF in the index is classified as a committed defect",
          ("later.txt", "crlf") in committed)
    code, out = run_verb(["init", "--repo", repo, "--state", state,
                          "--no-install"])
    check("agent-init refuses on a committed-CRLF file", code == 1)
    check("and its remedy names renormalize rather than a re-checkout",
          "git add --renormalize" in out)
    check("and it changed nothing on the way to refusing",
          read_bytes(os.path.join(repo, "later.txt")) == b"a\r\nb\r\n")
    git(repo, "checkout", "--", ".gitattributes")
    git(repo, "rm", "-q", "-f", "later.txt")
    git(repo, "commit", "-q", "-m", "back to a healthy tree")

    # The mutation-restore lesson, mechanized: a repair that would
    # restore a file holding uncommitted work is a repair that deletes
    # the work, so it does not happen.
    write(os.path.join(repo, "pinned.txt"), "one\ntwo\nEDITED\n",
          newline="\r\n")
    code, out = run_verb(["init", "--repo", repo, "--state", state,
                          "--no-install"])
    check("agent-init refuses to renormalize over uncommitted work",
          code == 1)
    check("and says which file, and what would have been lost",
          "pinned.txt" in out and "delete that work" in out)
    check("and the uncommitted bytes are still there",
          b"EDITED" in read_bytes(os.path.join(repo, "pinned.txt")))
    git(repo, "checkout", "--", "pinned.txt")

    # ------------------------------------------------------------------
    # C. Dependencies, junction-safe.
    # ------------------------------------------------------------------
    present, junctioned, _ = agent_init.dependency_state(repo)
    check("an absent node_modules is absent and not junctioned",
          (present, junctioned) == (False, False))

    entry = os.path.join(repo, agent_init.ESLINT_ENTRY)
    write(entry, "// the entry point the gate runs\n")
    present, junctioned, _ = agent_init.dependency_state(repo)
    check("the probe is the entry point the gate runs",
          (present, junctioned) == (True, False))

    shutil.rmtree(os.path.join(repo, "node_modules"))
    shared = os.path.join(base, "shared-modules")
    os.makedirs(os.path.join(shared, "eslint", "bin"), exist_ok=True)
    kind = link_dir(shared, os.path.join(repo, "node_modules"))
    check("this machine can make a junction or a symlink to test with",
          kind is not None)
    if kind:
        present, junctioned, _ = agent_init.dependency_state(repo)
        check("a linked node_modules missing the entry point is caught",
              (present, junctioned) == (False, True))
        code, out = run_verb(["init", "--repo", repo, "--state", state])
        check("agent-init refuses rather than installing through it",
              code == 1 and "THROUGH the junction" in out)
        write(os.path.join(shared, "eslint", "bin", "eslint.js"), "//\n")
        present, junctioned, _ = agent_init.dependency_state(repo)
        check("an entry point that resolves through the link is present",
              (present, junctioned) == (True, True))
    else:
        check("a linked node_modules missing the entry point is caught",
              False)
        check("agent-init refuses rather than installing through it", False)
        check("an entry point that resolves through the link is present",
              False)

    # ------------------------------------------------------------------
    # C2. A repo root with no package.json is not installed into.
    # ------------------------------------------------------------------
    # Field note, 0.9-M0-S6 (#286): a worktree spawned at a tip with no
    # package.json let `npm ci` walk UP the directory tree and reinstall
    # a DIFFERENT checkout's node_modules before this verb went on to
    # refuse for its real reason - no damage that time, only because the
    # shared install verified intact afterwards. build_repo() never
    # writes a package.json, so a second instance of it already IS the
    # rootless case; it gets its own state directory so its PRIMARY_BLOCK
    # lease cannot collide with `repo`'s in `state`.
    no_pkg_state = os.path.join(base, "no-pkg-state")
    rootless = build_repo(os.path.join(base, "rootless"))
    check("the rootless fixture really has no package.json",
          not os.path.isfile(os.path.join(rootless, "package.json")))
    code, out = run_verb(["init", "--repo", rootless,
                          "--state", no_pkg_state])
    check("agent-init still succeeds - the readiness probe here needs no "
          "install",
          code == 0)
    check("and it never reaches the installing line",
          "installing" not in out)
    check("and it says why, naming the file that is missing",
          "no package.json" in out and "skipping the install" in out)
    check("and node_modules was never created",
          not os.path.exists(os.path.join(rootless, "node_modules")))

    # ------------------------------------------------------------------
    # D. The readiness probe, in both directions.
    # ------------------------------------------------------------------
    ok, _ = agent_init.probe_readiness(repo)
    check("the probe passes when the stage it runs passes", ok)
    os.environ["PROBE_FAIL"] = "1"
    ok, _ = agent_init.probe_readiness(repo)
    check("the probe fails when the stage fails", not ok)
    code, out = run_verb(["init", "--repo", repo, "--state", state])
    check("agent-init refuses on a failing probe", code == 1)
    check("and says to believe this red, the line endings being right",
          "believe this one" in out)
    del os.environ["PROBE_FAIL"]

    # ------------------------------------------------------------------
    # E. What makes an initialized worktree count as uninitialized again.
    # ------------------------------------------------------------------
    run_verb(["init", "--repo", repo, "--state", state])
    check("a fully initialized worktree reports no problems at all",
          agent_init.initialization_problems(repo, state) == [])
    record_file = agent_init.record_path(repo, state)
    record = load(record_file)
    record["contract"] = agent_init.CONTRACT - 1
    save(record_file, record)
    check("a record written under an older contract reads as stale",
          len(agent_init.initialization_problems(repo, state)) == 1)
    record["contract"] = agent_init.CONTRACT
    record["state"] = "parked"
    save(record_file, record)
    check("a parked worktree is not a worktree to keep working in",
          any("parked" in line for line in
              agent_init.initialization_problems(repo, state)))
    record["state"] = "live"
    save(record_file, record)
    write(os.path.join(repo, "pinned.txt"), "one\ntwo\nthree\n",
          newline="\r\n")
    check("line endings drifting after init reads as uninitialized",
          any("stale-worktree trap" in line for line in
              agent_init.initialization_problems(repo, state)))
    agent_init.renormalize(repo, ["pinned.txt"])

    # ------------------------------------------------------------------
    # F. Port leases.
    # ------------------------------------------------------------------
    lease_state = os.path.join(base, "lease-state")
    block, note = agent_init.take_lease(repo, "slice-a", lease_state)
    check("the first lease is the first block",
          block == agent_init.PORT_BLOCKS[0])
    again, note = agent_init.take_lease(repo, "slice-a", lease_state)
    check("the same worktree gets the same block back, not a new one",
          again == block and "already leased" in note)

    # The defect this arm exists for: the scan finds a worktree's own
    # lease only when it REACHES it, so a worktree holding a later block
    # and asking again was handed an earlier free one as well. Two
    # leases, one agent, and a block nobody else could take.
    later = os.path.join(base, "moved-on")
    os.makedirs(later, exist_ok=True)
    agent_init.take_lease(later, "slice-b", lease_state,
                          agent_init.PORT_BLOCKS[2][0])
    kept, note = agent_init.take_lease(later, "slice-b", lease_state)
    check("a worktree holding a later block keeps it when asked again",
          kept == agent_init.PORT_BLOCKS[2])
    check("and no earlier block is quietly leased to it as well",
          not os.path.isfile(agent_init.lease_path(
              agent_init.PORT_BLOCKS[1], lease_state)))
    moved, note = agent_init.take_lease(later, "slice-b", lease_state,
                                        agent_init.PORT_BLOCKS[3][0])
    check("asking for a different block moves the worktree onto it",
          moved == agent_init.PORT_BLOCKS[3] and "releasing" in note)
    check("and the block it left goes back to the pool",
          not os.path.isfile(agent_init.lease_path(
              agent_init.PORT_BLOCKS[2], lease_state)))
    agent_init.release_lease(later, lease_state)

    others = []
    for index in range(1, len(agent_init.PORT_BLOCKS)):
        other = os.path.join(base, "other-%d" % index)
        os.makedirs(other, exist_ok=True)
        others.append(other)
        taken, _ = agent_init.take_lease(other, "slice-%d" % index,
                                         lease_state)
        if index == 1:
            check("a second worktree gets the next block, never the first",
                  taken == agent_init.PORT_BLOCKS[1])

    full = os.path.join(base, "one-too-many")
    os.makedirs(full, exist_ok=True)
    taken, why = agent_init.take_lease(full, "slice-late", lease_state)
    check("a full lease table is a refusal, not a silent double-claim",
          taken is None)
    check("and it names the holders and the remedy",
          others[0] in why and "agent-park" in why)

    shutil.rmtree(others[0])
    taken, why = agent_init.take_lease(full, "slice-late", lease_state)
    check("a lease whose worktree is gone is reclaimed",
          taken == agent_init.PORT_BLOCKS[1])
    check("and the reclaim says what it superseded and why",
          others[0] in why and "not on disk" in why)

    released = agent_init.release_lease(full, lease_state)
    check("release_lease drops this worktree's block",
          released == agent_init.PORT_BLOCKS[1])
    check("and only this worktree's block",
          os.path.isfile(agent_init.lease_path(agent_init.PORT_BLOCKS[0],
                                               lease_state)))

    # A lease file that exists and holds nothing readable is the state a
    # death between creating the file and writing it leaves behind, and
    # it is the one state no documented remedy reached: it names no
    # holder, so nothing can prove it live, and a block treated as taken
    # forever is a sixth of this fleet's ports gone per occurrence. It
    # is reclaimable for the same reason it is dangerous - a lease that
    # names nobody is a lease nobody can be shown to hold.
    broken = os.path.join(base, "broken-lease-state")
    os.makedirs(agent_init.leases_dir(broken), exist_ok=True)
    first = agent_init.PORT_BLOCKS[0]
    with open(agent_init.lease_path(first, broken), "wb"):
        pass
    asker = os.path.join(base, "asks-for-the-broken-block")
    os.makedirs(asker, exist_ok=True)
    taken, why = agent_init.take_lease(asker, "slice-z", broken, first[0])
    check("a zero-byte lease is reclaimed rather than held forever",
          taken == first)
    check("and the reclaim says the lease named no holder",
          "names no worktree" in why)
    check("and what replaces it is readable, so the next reader is free",
          (agent_init.read_json(agent_init.lease_path(first, broken))
           or {}).get("worktree") == os.path.abspath(asker))

    # The other direction, and the one that makes the repair safe: a
    # lease naming a worktree that is on disk is not reclaimable, so
    # taking over an unreadable one is not a licence to take any block.
    second = agent_init.PORT_BLOCKS[1]
    agent_init.write_lease(agent_init.lease_path(second, broken), repo,
                           "slice-live", second)
    check("a lease naming a live worktree is not reclaimable",
          agent_init.lease_reclaimable(
              agent_init.read_json(agent_init.lease_path(second, broken)),
              asker, broken) is None)
    denied, why = agent_init.take_lease(asker, "slice-z", broken, second[0])
    check("and asking for its block is refused rather than granted",
          denied is None and "leased" in why)

    # The window that produces the state above: the lease is created and
    # written, and a reader arriving between the two steps must not see
    # an empty file. Reading back what a fresh lease holds is the only
    # way to assert that from outside.
    fresh = os.path.join(base, "fresh-lease-state")
    third = agent_init.PORT_BLOCKS[2]
    agent_init.take_lease(asker, "slice-z", fresh, third[0])
    check("a lease is readable the moment it exists",
          os.path.getsize(agent_init.lease_path(third, fresh)) > 0
          and agent_init.read_json(
              agent_init.lease_path(third, fresh)) is not None)

    # ------------------------------------------------------------------
    # G. The death protocol and the marker the reaper consumes.
    # ------------------------------------------------------------------
    code, out = run_verb(["park", "--repo", repo, "--state", state])
    check("park refuses the primary checkout", code == 1)
    check("and says why the primary is different",
          "PRIMARY checkout" in out)

    linked = os.path.join(base, "agent-worktree")
    git(repo, "worktree", "add", "-q", "-b", "slice-branch", linked)
    check("the linked worktree is linked, and git says so",
          agent_init.worktree_kind(linked)[0] == "linked")
    run_verb(["init", "--repo", linked, "--state", state, "--no-install"])
    _, tip = agent_init.head_state(linked)

    # --verify is the dry-run flag and park is the destructive verb, so
    # an agent reaching for the safe form of the dangerous one must get
    # the report and not the act. The two things a wrong answer costs
    # here are exactly the consequential ones: a LIVE worktree's block
    # goes back to a pool another agent allocates from, and the worktree
    # acquires the death certificate a reaper deletes on.
    live = load(agent_init.record_path(linked, state))
    code, out = run_verb(["park", "--repo", linked, "--state", state,
                          "--verify"])
    check("park --verify answers 0 for a worktree it would park", code == 0)
    check("and it says what it would do rather than doing it",
          "would" in out)
    check("and the record still says live",
          load(agent_init.record_path(linked, state))["state"] == "live")
    check("and the port block is still leased to this worktree",
          agent_init.current_lease(linked, state) is not None)
    check("and the scratch directory is still there",
          os.path.isdir(live["scratch"]))
    check("and the branch is still attached",
          agent_init.head_state(linked)[0] == "slice-branch")

    write(os.path.join(linked, "unfinished.txt"), "work\n")
    code, out = run_verb(["park", "--repo", linked, "--state", state,
                          "--verify"])
    check("park --verify answers 1 for a worktree it would refuse",
          code == 1)
    check("and names the uncommitted path in the refusal it reports",
          "unfinished.txt" in out)
    check("and changes nothing on the way to reporting a refusal",
          load(agent_init.record_path(linked, state))["state"] == "live"
          and agent_init.current_lease(linked, state) is not None)

    code, out = run_verb(["park", "--repo", linked, "--state", state])
    check("park refuses over uncommitted work", code == 1)
    check("and no marker is written for a worktree it refused",
          load(agent_init.record_path(linked, state)).get("state") == "live")
    os.remove(os.path.join(linked, "unfinished.txt"))

    code, out = run_verb(["park", "--repo", linked, "--state", state])
    check("park succeeds on a clean linked worktree", code == 0)
    marker = load(agent_init.record_path(linked, state))
    park = marker.get("park", {})
    check("the marker says parked", marker.get("state") == "parked")
    check("the marker carries every field the reaper contract names",
          set(park) == {"at", "branch", "tip", "head", "clean", "merged",
                        "ports", "scratch"})
    check("it records the branch and the tip that branch pointed at",
          park["branch"] == "slice-branch" and park["tip"] == tip)
    check("HEAD is detached at that same commit",
          agent_init.head_state(linked) == (None, tip)
          and park["head"] == tip)
    check("clean is true, and it is only ever written true",
          park["clean"] is True)
    check("merged is false where no mainline holds the tip",
          park["merged"] is False)
    check("the block is released back to the pool",
          agent_init.release_lease(linked, state) is None)
    check("the scratch directory is gone",
          not os.path.isdir(marker["scratch"]))

    code, out = run_verb(["park", "--repo", linked, "--state", state])
    check("parking twice is idempotent", code == 0)
    twice = load(agent_init.record_path(linked, state))
    check("and the second park records the same tip",
          twice["park"]["tip"] == tip and twice["park"]["branch"] is None)

    # ------------------------------------------------------------------
    # H. What park may delete, and what it may not.
    # ------------------------------------------------------------------
    # Containment is a question about paths and `startswith` answers a
    # question about strings: a SIBLING whose name merely begins with
    # the root's name satisfies the string test, and a teardown that
    # believes it is deleting its own scratch directory deletes
    # somebody else's tree instead. It needs no malice to happen -
    # BINDER_SCRATCH_ROOT is read at park time, so a root that differs
    # between init and park makes prefix collisions ordinary - and the
    # guard exists for exactly the case of a record this verb did not
    # write, which is the case the string test fails on.
    within = getattr(agent_init, "within", None)
    check("agent_init exports a containment primitive", within is not None)
    root = os.path.join(base, "root")
    if within:
        check("a child of the root is inside it",
              within(os.path.join(root, "scratch-abc"), root))
        check("a sibling that merely starts with the root's name is not",
              not within(root + "-elsewhere", root))
        check("and the root is not inside itself, so no teardown takes it",
              not within(root, root))
    else:
        check("a child of the root is inside it", False)
        check("a sibling that merely starts with the root's name is not",
              False)
        check("and the root is not inside itself, so no teardown takes it",
              False)

    # The same property through the verb, which is where it bites.
    run_verb(["init", "--repo", linked, "--state", state, "--no-install"])
    sibling = os.path.join(os.environ["BINDER_SCRATCH_ROOT"] + "-elsewhere",
                           "someone-elses-data")
    write(os.path.join(sibling, "precious.txt"), "not this verb's to take\n")
    record_file = agent_init.record_path(linked, state)
    record = load(record_file)
    record["scratch"] = sibling
    save(record_file, record)
    code, out = run_verb(["park", "--repo", linked, "--state", state])
    check("park still parks a worktree whose scratch path it refuses",
          code == 0)
    check("and the path outside the root is still on disk",
          os.path.isfile(os.path.join(sibling, "precious.txt")))
    check("and it reports the refusal rather than printing it removed",
          "REFUSED" in out and sibling in out)
    check("and records no scratch removal it did not perform",
          load(record_file)["park"]["scratch"] is None)
    shutil.rmtree(os.path.dirname(sibling))

    # A teardown that swallows what it cannot delete leaves a directory
    # per run and says nothing. On Windows git writes loose objects
    # read-only, which is the file shutil.rmtree raises on, and the
    # suite building repositories was leaking its own root that way -
    # the suite for the verb that cleans up being the thing not
    # cleaning up.
    rmtree_hard = getattr(agent_init, "rmtree_hard", None)
    check("agent_init exports a teardown that survives a read-only file",
          rmtree_hard is not None)
    stubborn = os.path.join(base, "read-only-tree")
    write(os.path.join(stubborn, "loose-object"), "written read-only\n")
    os.chmod(os.path.join(stubborn, "loose-object"), stat.S_IREAD)
    if rmtree_hard:
        rmtree_hard(stubborn)
        check("a tree holding a read-only file is removed, not left behind",
              not os.path.isdir(stubborn))
        raised = False
        try:
            rmtree_hard(os.path.join(base, "was-never-there"))
        except OSError:
            raised = True
        check("and a teardown that cannot run says so instead of passing",
              raised)
    else:
        os.chmod(os.path.join(stubborn, "loose-object"), stat.S_IWRITE)
        shutil.rmtree(stubborn)
        check("a tree holding a read-only file is removed, not left behind",
              False)
        check("and a teardown that cannot run says so instead of passing",
              False)

    # The sweep runs against the directory every program on this machine
    # shares, so the arm that matters is the one it must NOT take.
    parent = os.path.join(base, "a-shared-temporary-directory")
    old = time.time() - STALE_AFTER - 60
    plots = {"prior": PREFIX + "aaaa", "neighbour": "worktree-contractor-x",
             "running": PREFIX + "bbbb", "mine": PREFIX + "cccc"}
    for name in plots.values():
        write(os.path.join(parent, name, "content.txt"), "something\n")
    for name in (plots["prior"], plots["neighbour"]):
        os.utime(os.path.join(parent, name), (old, old))
    swept = sweep_prior_roots(parent, os.path.join(parent, plots["mine"]))

    def still_there(key):
        return os.path.isdir(os.path.join(parent, plots[key]))

    check("the sweep removes a finished run's root", not still_there("prior"))
    check("and leaves a name that merely starts the same way",
          still_there("neighbour"))
    check("and leaves a matching root too new to be finished",
          still_there("running"))
    check("and never sweeps the run doing the sweeping",
          still_there("mine") and swept == [plots["prior"]])

    # ------------------------------------------------------------------
    # G. Stderr separation: MAJOR4 (0.9-M0-S18, #310).
    # ------------------------------------------------------------------
    # A dedicated repository built the same trap-bearing way as A, so a
    # parser that expects "nothing to report" (status) and one that
    # expects "here is exactly one mismatch" (ls-files --eol) are both
    # exercised for real while a warning rides on stderr alongside their
    # genuinely successful stdout.
    warn_repo = build_repo(os.path.join(base, "stderr-separation"))
    warn_sha = git(warn_repo, "rev-parse", "HEAD")[1].strip()

    with InjectGitWarning() as warned:
        # Tolerant of git() still returning the old 2-tuple - this arm
        # is run once against the pre-fix contract to prove the whole
        # section red (0.9-M0-S18 completion record), and an unpack
        # crash there is a true statement about that contract rather
        # than a reason to lose every check after it.
        try:
            code, out, err = agent_init.git(warn_repo, "status",
                                            "--porcelain", "-z")
            separated = code == 0 and out == "" and err == warned.WARNING
        except ValueError:
            separated = False
        check("git() keeps stdout and stderr as two separate strings",
              separated)

        dirty = agent_init.dirty_paths(warn_repo)
        check("dirty_paths reads a clean tree as clean with a warning on "
              "stderr",
              dirty == set())

        branch, head = agent_init.head_state(warn_repo)
        check("head_state's branch name is not glued to the warning",
              branch is not None and "warning" not in branch)
        check("head_state's sha is still exactly the real 40 characters",
              head == warn_sha)

        worktrees = agent_init.registered_worktrees(warn_repo)
        check("registered_worktrees still finds this worktree with a "
              "warning on stderr",
              os.path.realpath(warn_repo) in
              {os.path.realpath(path) for path in worktrees})

        fixable, committed, binary = agent_init.eol_problems(warn_repo)
        check("eol_problems reports the real path, not path-plus-warning",
              [entry[0] for entry in fixable] == ["pinned.txt"]
              and committed == [] and binary == [])

    check("the patch is fully undone once the block exits",
          agent_init.subprocess.run is subprocess.run)

    # ------------------------------------------------------------------
    # H. Python gate tooling: MINOR4 code-half (0.9-M0-S18, #310).
    # ------------------------------------------------------------------
    # python_gate_tools_present() answers a MACHINE fact, not a
    # worktree one - pip installs into the interpreter this process
    # runs under, not into any one repo - so these arms drive it
    # through a seam rather than through this machine's real global
    # site-packages, the same reason PROBE_FAIL stands in for a real
    # gate stage in section A: asserting on what this machine happens
    # to have installed already would make the suite's own answer
    # depend on the machine running it, which is exactly what a suite
    # exists to rule out.
    real_present = agent_init.python_gate_tools_present
    real_install = agent_init.install_python_gate_tools
    py_repo = build_repo(os.path.join(base, "py-deps"))
    py_state = os.path.join(base, "py-deps-state")

    try:
        agent_init.python_gate_tools_present = lambda: (True, True)
        code, out = run_verb(["init", "--repo", py_repo,
                              "--state", py_state])
        check("py deps already present is reported and not reinstalled",
              code == 0 and "already importable" in out
              and "installing from" not in out)

        agent_init.python_gate_tools_present = lambda: (False, False)
        code, out = run_verb(["init", "--repo", py_repo,
                              "--state", py_state, "--no-install"])
        check("--no-install reports absence instead of installing",
              code == 0 and "FAILED" in out and "installing from" not in out)

        # No tools/requirements-gate.txt in this fixture yet -
        # build_repo() never writes one - so this is the branch every
        # arm above this one exercises unless a test opts into the
        # manifest existing, same shape as C2's no-package.json skip.
        code, out = run_verb(["init", "--repo", py_repo,
                              "--state", py_state])
        check("a worktree with no manifest skips the install rather than "
              "refusing",
              code == 0 and "is not in this worktree" in out
              and "installing from" not in out)

        write(os.path.join(py_repo, "tools", "requirements-gate.txt"),
              "ruff==0.16.1\nfonttools[woff]==4.63.0\n")
        installs = []

        def fake_install_ok(requirements):
            installs.append(requirements)
            return 0

        agent_init.install_python_gate_tools = fake_install_ok
        agent_init.python_gate_tools_present = lambda: (False, False)
        code, out = run_verb(["init", "--repo", py_repo,
                              "--state", py_state])
        check("with the manifest present, absence installs from it - but "
              "python_gate_tools_present still says absent afterward, so "
              "this reports the partial-install refusal rather than ready",
              code == 1 and "installing from" in out and len(installs) == 1
              and "still cannot be imported" in out)
        check("the exact command install_python_gate_tools ran against is "
              "tools/requirements-gate.txt, the file S19 documents",
              installs[0].endswith(
                  os.path.join("tools", "requirements-gate.txt")))

        present_calls = []

        def present_then_ok():
            present_calls.append(True)
            return (True, True) if len(present_calls) > 1 else (False,
                                                                 False)

        agent_init.python_gate_tools_present = present_then_ok
        code, out = run_verb(["init", "--repo", py_repo,
                              "--state", py_state])
        check("a real install that lands is reported ready, not refused",
              code == 0 and "installing from" in out)

        agent_init.python_gate_tools_present = lambda: (False, False)
        agent_init.install_python_gate_tools = lambda requirements: 1
        code, out = run_verb(["init", "--repo", py_repo,
                              "--state", py_state])
        check("a failing pip install refuses rather than reporting ready",
              code == 1 and "pip install -r" in out)
    finally:
        agent_init.python_gate_tools_present = real_present
        agent_init.install_python_gate_tools = real_install

finally:
    # No ignore_errors. Swallowing a teardown failure is what left one
    # repository per run in the shared temporary directory while this
    # file reported clean - the suite for the verb that cleans up being
    # the thing that did not.
    agent_init.rmtree_hard(base)

print("\n%d checks, %d failure(s)" % (performed, failures))
if performed != EXPECTED:
    print("EXPECTED %d checks and %d ran. A suite that quietly stops "
          "running is a suite that quietly stops checking."
          % (EXPECTED, performed))
    sys.exit(1)
sys.exit(1 if failures else 0)
