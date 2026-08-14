"""Contract checks for the worktree contract: agent-init and agent-park.

    py -3 tests/worktree-contract.test.py

Run by hand. `tests/` is deliberately unregistered until the new
apparatus (0.9-M0-S4) wires its runner, so nothing in the gate executes
this file yet and no handoff may report it as gated.

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
dependency. #281 adopts this file by moving it, not by rewriting it.
"""

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
from contextlib import redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "tools"))

import agent_init  # noqa: I001


failures = 0
performed = 0

# Asserted at the end rather than only printed. A hand-written total
# nothing compares against still prints a confident pass when a check
# stops running - an early return, a renamed helper - which is the
# armed-looking-but-not failure this repository holds to be worse than
# no check at all.
EXPECTED = 63


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


base = tempfile.mkdtemp(prefix="worktree-contract-")
state = os.path.join(base, "fleet-state")

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

    write(os.path.join(linked, "unfinished.txt"), "work\n")
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

finally:
    shutil.rmtree(base, ignore_errors=True)

print("\n%d checks, %d failure(s)" % (performed, failures))
if performed != EXPECTED:
    print("EXPECTED %d checks and %d ran. A suite that quietly stops "
          "running is a suite that quietly stops checking."
          % (EXPECTED, performed))
    sys.exit(1)
sys.exit(1 if failures else 0)
