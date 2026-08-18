"""Contract checks for the derived orchestration view.

    py -3 tools/fleet_status_suite.py

WHY THE ARM SITS IN tests/ AND THE ASSERTIONS SIT HERE

Same convention 0.9-M0-S7 settled and 0.9-M0-S8's reaper arms already
follow: `tests/fleet-status.test.mjs` is five lines that find a Python
and hand it this file: the shim is the whole wiring, and every
assertion lives here, beside the module it tests.

WHY THIS BUILDS A REAL REPOSITORY AND REAL WORKTREES

tools/fleet_status.py's whole job is comparing what several real
artifacts say against each other - a fleet record's own claim, git's
live worktree table, a port lease file - and the interesting failure
mode IS the disagreement between them (the "two writers" hazard this
ticket exists to answer). A dict fabricated to already disagree would
be a fixture of my own belief about what disagreement looks like; this
suite instead uses the SAME machinery the real fleet uses to produce
each artifact - `git worktree add` for a live worktree, `agent_init.
main(["park", ...])` for a park certificate (reaper_suite.py's own
docstring makes this argument for the certificate specifically: "the
reaper consumes what park writes, so park is what writes it here", and
the same argument holds one file over) - and only hand-writes the two
shapes reaper_suite.py itself already established as sanctioned to
hand-write: a "live" record (its own fixture at line ~632) and a lease
file via agent_init.write_lease() (its own fixture at line ~677).

Self-contained on purpose, matching every existing suite in this
fleet: no import from dev/, no framework, no new dependency, and
NOTHING imported from reaper_suite.py or any other *_suite.py -
importing one would execute the whole of it as an unguarded module-
level side effect (every suite in this fleet runs at import time, not
behind `if __name__ == "__main__"`), mixing its checks and its own
temporary machine into this run's.

WHY gh IS A STUB SCRIPT RATHER THAN A MOCK OBJECT

tools/fleet_status.py never imports a gh client - it shells out, like
every other boundary in this fleet. BINDER_GH_CMD (the module
docstring explains the seam) replaces the `["gh"]` prefix with an
arbitrary command, so the fixture here is a small, real, standalone
Python script this suite writes to disk and invokes as a real
subprocess - proving the actual seam (argv in, stdout out, exit code)
rather than a shortcut through Python object identity that a real `gh`
invocation could never take.
"""

import io
import json
import os
import subprocess
import sys
import tempfile
import time
from contextlib import redirect_stdout

import agent_init
import fleet_status
import reaper

failures = 0
performed = 0

# Asserted at the end, not merely printed - the same floor every suite
# in this fleet holds itself to (reaper_suite.py's own EXPECTED, this
# file's ancestor in spirit): a hand-counted total nothing compares
# against still prints a confident pass when a check stops running.
EXPECTED = 75


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
        print("FAIL  %s" % label)
    else:
        print("ok    %s" % label)


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


def sha(repo, ref):
    code, out = git(repo, "rev-parse", ref)
    return out.strip() if code == 0 else None


PREFIX = "fleet-status-suite-"
STALE_AFTER = 3600


def sweep_prior_roots(parent, keep, now=None):
    """Remove roots earlier runs of this suite left behind.

    Mirrors reaper_suite.py's own sweep, for the same reason: a
    directly-under-the-parent, full-prefix-with-separator match is the
    safety property, and two agents' worktrees on this machine share
    this parent by construction.
    """
    swept = []
    now = time.time() if now is None else now
    for name in sorted(os.listdir(parent)):
        path = os.path.join(parent, name)
        if not name.startswith(PREFIX) or path == keep:
            continue
        if not os.path.isdir(path):
            continue
        if now - os.path.getmtime(path) < STALE_AFTER:
            continue
        agent_init.rmtree_hard(path)
        swept.append(name)
    return swept


def add_worktree(primary, name, branch, start, parent=None):
    """A real linked worktree on a real branch, under the sanctioned
    root - the same helper reaper_suite.py uses, for the same reason.
    """
    parent = parent or os.path.join(primary, ".claude", "worktrees")
    path = os.path.join(parent, name)
    code, out = git(primary, "worktree", "add", "-b", branch, path, start)
    if code != 0:
        raise SystemExit("fixture: could not add worktree %s: %s"
                         % (name, out))
    return path


def agent_init_call(argv):
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = agent_init.main(argv)
    return code, buffer.getvalue()


def park_worktree(path, state):
    """A real death certificate, written by agent-park itself."""
    code, out = agent_init_call(["park", "--repo", path, "--state", state])
    if code != 0:
        raise SystemExit("fixture: park refused %s: %s" % (path, out))
    return agent_init.read_json(agent_init.record_path(path, state))


def write_live_record(path, branch, state, ports=None):
    """The one hand-written record shape reaper_suite.py's own fixture
    sanctions - see this file's module docstring."""
    agent_init.write_json(agent_init.record_path(path, state), {
        "schema": agent_init.SCHEMA, "contract": agent_init.CONTRACT,
        "worktree": path, "kind": "linked", "branch": branch,
        "state": "live", "initialized_at": agent_init.now(),
        "ports": list(ports) if ports else None, "scratch": None,
    })


# ----------------------------------------------------------------------
# The fabricated machine: a repository with a real `origin/accounts`
# remote-tracking ref (fleet_status.branch_rows() resolves that literal
# ref, never a local `accounts`) and branches positioned to exercise
# both ahead and behind in one row.
# ----------------------------------------------------------------------

def build_machine(root):
    primary = os.path.join(root, "primary")
    state = os.path.join(root, "state")
    os.makedirs(primary)
    os.makedirs(state)

    git(primary, "init", "-b", "accounts")
    write(os.path.join(primary, ".gitignore"), ".claude/\n")
    write(os.path.join(primary, "one.txt"), "one\n")
    git(primary, "add", "-A")
    git(primary, "commit", "-m", "first")
    base = sha(primary, "HEAD")
    git(primary, "update-ref", "refs/remotes/origin/accounts", base)

    write(os.path.join(primary, "two.txt"), "two\n")
    git(primary, "add", "-A")
    git(primary, "commit", "-m", "second, landed on origin/accounts")
    landed = sha(primary, "HEAD")
    git(primary, "update-ref", "refs/remotes/origin/accounts", landed)

    # Forked BEFORE `landed` landed: behind 1 (missing `landed`), and it
    # carries 2 commits of its own the remote-tracking ref never saw -
    # both directions nonzero in the same row, on purpose.
    slice_work = os.path.join(root, "slice-work-scratch")
    git(primary, "worktree", "add", "-b", "0.9-m0-s99", slice_work, base)
    write(os.path.join(slice_work, "a.txt"), "a\n")
    git(slice_work, "add", "-A")
    git(slice_work, "commit", "-m", "slice commit 1")
    write(os.path.join(slice_work, "b.txt"), "b\n")
    git(slice_work, "add", "-A")
    git(slice_work, "commit", "-m", "slice commit 2")
    local_tip = sha(slice_work, "HEAD")
    git(primary, "worktree", "remove", "--force", slice_work)

    # The remote-tracking ref for that SAME branch lags a commit behind
    # local - proving "local and remote are two different questions"
    # with two different numbers for the one branch name.
    git(primary, "update-ref", "refs/remotes/origin/0.9-m0-s99", base)

    # Same tip as the remote: ahead 0, behind 0.
    git(primary, "branch", "ticket-7", landed)

    # Excluded by the naming pattern - proves the filter rather than
    # merely documenting it.
    write(os.path.join(primary, "c.txt"), "c\n")
    git(primary, "add", "-A")
    git(primary, "commit", "-m", "unrelated")
    git(primary, "branch", "just-a-branch", "HEAD")
    git(primary, "reset", "--hard", landed)

    return primary, state, base, landed, local_tip


# ----------------------------------------------------------------------
# The gh stub. A real, standalone script this suite writes to disk and
# runs as a subprocess - see the module docstring's closing section.
# ----------------------------------------------------------------------

STUB_SOURCE = '''
import json
import os
import sys


ISSUES = {
    "tickets": [
        {"number": 501, "title": "0.9-M0-Sxx: alpha ticket",
         "labels": [], "milestone": {"number": 1, "title": "0.9-M0"},
         "url": "https://example.invalid/501"},
        {"number": 502, "title": "0.9-M0-Sxx: beta ticket (claimed)",
         "labels": [{"name": "claude"}],
         "milestone": {"number": 1, "title": "0.9-M0"},
         "url": "https://example.invalid/502"},
        {"number": 503, "title": "0.9-M0-Sxx: gamma ticket (no comments)",
         "labels": [], "milestone": {"number": 1, "title": "0.9-M0"},
         "url": "https://example.invalid/503"},
        {"number": 504, "title": "0.9-M0-Sxx: delta ticket (odd comment)",
         "labels": [], "milestone": {"number": 1, "title": "0.9-M0"},
         "url": "https://example.invalid/504"},
        {"number": 601, "title": "0.9-M1 prerequisite, wrong milestone",
         "labels": [], "milestone": {"number": 2, "title": "0.9-M1"},
         "url": "https://example.invalid/601"},
        {"number": 999, "title": "untriaged, no milestone at all",
         "labels": [], "milestone": None,
         "url": "https://example.invalid/999"},
    ],
    "view-fail": [
        {"number": 701, "title": "0.9-M0-Sxx: view always fails",
         "labels": [], "milestone": {"number": 1, "title": "0.9-M0"},
         "url": "https://example.invalid/701"},
    ],
}

COMMENTS = {
    "501": {"comments": [
        {"body": "BUILD-AND-HOLD on branch `x`, base `y`. Not pushed.\\n\\n"
                 "Files touched: none really, this is a fixture.",
         "createdAt": "2026-08-17T00:00:00Z"},
    ]},
    "502": {"comments": [
        {"body": "first, irrelevant comment", "createdAt":
         "2026-08-17T00:00:00Z"},
        {"body": "Landed via PR #999 into `accounts`.\\n\\nMerge SHA: "
                 "`deadbeef`.",
         "createdAt": "2026-08-17T01:00:00Z"},
    ]},
    "503": {"comments": []},
    "504": {"comments": [
        {"body": "just chatting, nothing structured here",
         "createdAt": "2026-08-17T00:00:00Z"},
    ]},
}


def main():
    args = sys.argv[1:]
    scenario = os.environ.get("FLEET_STATUS_STUB_SCENARIO", "tickets")
    if scenario == "boom":
        sys.stderr.write("stub: simulated gh failure\\n")
        return 7
    if scenario == "badjson":
        if args[:2] == ["issue", "list"]:
            print("this is not json")
            return 0
    if args[:2] == ["issue", "list"]:
        print(json.dumps(ISSUES.get(scenario, ISSUES["tickets"])))
        return 0
    if args[:2] == ["issue", "view"]:
        if scenario == "view-fail":
            sys.stderr.write("stub: simulated gh issue view failure\\n")
            return 3
        number = args[2]
        print(json.dumps(COMMENTS.get(number, {"comments": []})))
        return 0
    sys.stderr.write("stub: unrecognized args %r\\n" % (args,))
    return 9


if __name__ == "__main__":
    sys.exit(main())
'''


def stub_command(stub_path):
    return json.dumps([sys.executable, stub_path])


# ----------------------------------------------------------------------

root = tempfile.mkdtemp(prefix=PREFIX)
try:
    parent = os.path.dirname(root)
    swept = sweep_prior_roots(parent, root)
    if swept:
        print("swept %d stale fixture root(s) from a prior run: %s"
             % (len(swept), ", ".join(swept)))

    print("--- branches: pattern filter, local vs. remote, ahead/behind "
         "---")
    primary, state, base, landed, local_tip = build_machine(root)

    rows, problem = fleet_status.branch_rows(primary)
    check("branch_rows derives cleanly against the fixture repo",
          problem is None)
    by_key = {(row["kind"], row["name"]): row for row in rows}

    local99 = by_key.get(("local", "0.9-m0-s99"))
    check("the local slice branch is found", local99 is not None)
    check("its head is the local tip, not the remote-tracking one",
          local99 is not None and local99["sha"] == local_tip)
    check("it is 2 ahead of origin/accounts (its own unlanded commits)",
          local99 is not None and local99["ahead"] == 2)
    check("and 1 behind (it forked before `landed` landed)",
          local99 is not None and local99["behind"] == 1)

    remote99 = by_key.get(("remote", "origin/0.9-m0-s99"))
    check("the remote-tracking ref for the SAME branch is a separate row",
          remote99 is not None)
    check("its head is the remote-tracking sha, distinct from local's",
          remote99 is not None and remote99["sha"] == base
          and remote99["sha"] != local_tip)
    check("its ahead/behind differ from the local row's - local and "
         "remote are two different questions",
          remote99 is not None and remote99["ahead"] == 0
          and remote99["behind"] == 1)

    ticket7 = by_key.get(("local", "ticket-7"))
    check("a ticket-* branch is picked up by the pattern",
          ticket7 is not None)
    check("level with origin/accounts reads ahead 0, behind 0",
          ticket7 is not None and ticket7["ahead"] == 0
          and ticket7["behind"] == 0)

    check("a branch matching neither pattern is excluded",
          ("local", "just-a-branch") not in by_key)
    check("origin/accounts itself is not listed as a candidate branch",
          ("remote", "origin/accounts") not in by_key)

    bogus_repo = os.path.join(root, "not-a-repo-at-all")
    out, problem = fleet_status.git(bogus_repo, "rev-parse", "HEAD")
    check("git() reports a problem rather than raising, against a "
         "directory that is not a repository",
          out is None and problem)

    print("\n--- tickets: milestone selection, claim state, comment "
         "markers ---")

    stub_path = os.path.join(root, "gh_stub.py")
    write(stub_path, STUB_SOURCE)
    os.environ["BINDER_GH_CMD"] = stub_command(stub_path)
    os.environ["FLEET_STATUS_STUB_SCENARIO"] = "tickets"

    rows, milestone_title, problem = fleet_status.ticket_rows()
    check("ticket_rows derives cleanly against the stub", problem is None)
    check("the active milestone is the LOWEST-numbered one carrying an "
         "open issue (0.9-M0, not 0.9-M1)",
          milestone_title == "0.9-M0")
    numbers = {row["number"] for row in rows}
    check("issues in the active milestone are included",
          {501, 502, 503, 504} <= numbers)
    check("an issue in a later milestone is excluded",
          601 not in numbers)
    check("an issue with no milestone at all is excluded",
          999 not in numbers)

    by_number = {row["number"]: row for row in rows}
    check("the claude label marks a ticket claimed",
          by_number[502]["claimed"] is True)
    check("no claude label reads unclaimed",
          by_number[501]["claimed"] is False)
    check("a BUILD-AND-HOLD comment is classified and quoted",
          "BUILD-AND-HOLD posted" in by_number[501]["marker"]
          and "Not pushed" in by_number[501]["marker"])
    check("the LATEST comment is classified, not the first one posted",
          "landed via PR #999" in by_number[502]["marker"])
    check("zero comments reads as exactly that",
          by_number[503]["marker"] == "no comments yet")
    check("an unrecognized comment is reported, not misclassified",
          by_number[504]["marker"].startswith("no recognized marker")
          and "just chatting" in by_number[504]["marker"])

    os.environ["FLEET_STATUS_STUB_SCENARIO"] = "boom"
    rows, milestone_title, problem = fleet_status.ticket_rows()
    check("a gh issue list failure is reported, not raised", rows == []
          and problem is not None
          and "simulated gh failure" in problem)

    os.environ["FLEET_STATUS_STUB_SCENARIO"] = "badjson"
    rows, milestone_title, problem = fleet_status.ticket_rows()
    check("non-JSON gh output is reported as a problem, not a crash",
          rows == [] and problem is not None
          and "non-JSON" in problem)

    os.environ["FLEET_STATUS_STUB_SCENARIO"] = "view-fail"
    rows, milestone_title, problem = fleet_status.ticket_rows()
    check("gh issue list succeeding while gh issue view fails is a "
         "per-ticket problem, not a whole-section one",
          problem is None and len(rows) == 1)
    check("the per-ticket marker names the gh issue view failure",
          rows and "gh issue view" in rows[0]["marker"]
          and "simulated gh issue view failure" in rows[0]["marker"])

    del os.environ["FLEET_STATUS_STUB_SCENARIO"]
    del os.environ["BINDER_GH_CMD"]

    print("\n--- classify_comment, active_milestone, excerpt: unit "
         "checks ---")

    check("BUILD-AND-HOLD is recognized",
          fleet_status.classify_comment(
              "BUILD-AND-HOLD on branch `x`.") is not None)
    check("a landed comment captures the PR number",
          fleet_status.classify_comment(
              "Landed via PR #42 into `accounts`.")
          == "landed via PR #42")
    check("a ready-to-push signal is recognized",
          fleet_status.classify_comment(
              "ready to push: 0.9-m0-s20 @ deadbeef") is not None)
    check("a CLAIM comment is recognized",
          fleet_status.classify_comment(
              "CLAIM: branch 0.9-m0-s1, base deadbeef") is not None)
    check("an under-review status is recognized case-insensitively",
          fleet_status.classify_comment(
              "Under review by Prime, verdict pending.") is not None)
    check("a BLOCKING verdict is recognized",
          fleet_status.classify_comment(
              "BLOCKING: the gate is red") is not None)
    check("a VERDICT PASS is recognized anywhere in the body",
          fleet_status.classify_comment(
              "Independent review complete. VERDICT PASS.") is not None)
    check("unrelated prose classifies as nothing",
          fleet_status.classify_comment(
              "just chatting, nothing structured here") is None)
    check("the word CLAIM inside a sentence, not at the start, does "
         "not false-positive",
          fleet_status.classify_comment(
              "this session did not post a CLAIM comment") is None)

    check("active_milestone on an empty list is None",
          fleet_status.active_milestone([]) is None)
    check("active_milestone where nothing carries a milestone is None",
          fleet_status.active_milestone(
              [{"milestone": None}, {"milestone": None}]) is None)
    check("active_milestone picks the LOWEST number, not first-seen",
          fleet_status.active_milestone([
              {"milestone": {"number": 3, "title": "0.9-M2"}},
              {"milestone": {"number": 1, "title": "0.9-M0"}},
              {"milestone": {"number": 1, "title": "0.9-M0"}},
          ]) == (1, "0.9-M0"))

    check("excerpt takes the first non-blank line, stripped",
          fleet_status.excerpt("  \n  hello world  \nsecond line")
          == "hello world")
    long_line = "x" * 100
    excerpted = fleet_status.excerpt(long_line)
    check("excerpt truncates a long line and marks the cut",
          len(excerpted) == 91 and excerpted.endswith("..."))
    check("excerpt of nothing is nothing", fleet_status.excerpt("") == "")

    print("\n--- gh_command(): the injectable seam's own edges ---")

    os.environ["BINDER_GH_CMD"] = json.dumps(["not-a-real-executable-xyz"])
    command, problem = fleet_status.gh_command()
    check("a syntactically valid override is accepted verbatim",
          command == ["not-a-real-executable-xyz"] and problem is None)
    result, problem = fleet_status.gh("issue", "list")
    check("an override naming a binary that does not exist is reported, "
         "not raised", result is None and problem
          and "could not be run" in problem)

    os.environ["BINDER_GH_CMD"] = "not json at all {"
    command, problem = fleet_status.gh_command()
    check("invalid JSON in the override is reported",
          command is None and "not valid JSON" in problem)

    os.environ["BINDER_GH_CMD"] = json.dumps([])
    command, problem = fleet_status.gh_command()
    check("an empty array override is refused",
          command is None and "non-empty" in problem)

    del os.environ["BINDER_GH_CMD"]
    old_path = os.environ.get("PATH", "")
    empty_dir = os.path.join(root, "empty-path-dir")
    os.makedirs(empty_dir, exist_ok=True)
    os.environ["PATH"] = empty_dir
    command, problem = fleet_status.gh_command()
    check("with no override and gh nowhere on PATH, the seam says so "
         "rather than guessing",
          command is None and problem == "gh is not on PATH")
    os.environ["PATH"] = old_path

    print("\n--- worktrees: the orphaned-vs-live distinction ---")

    live_ok = add_worktree(primary, "wt-live-ok", "0.9-m0-slive", landed)
    write_live_record(live_ok, "0.9-m0-slive", state, ports=(8130, 8135))
    agent_init.write_lease(agent_init.lease_path((8130, 8135), state),
                           os.path.abspath(live_ok), "0.9-m0-slive",
                           (8130, 8135))

    live_stale = add_worktree(primary, "wt-live-stale", "0.9-m0-sstale",
                              landed)
    write_live_record(live_stale, "0.9-m0-sstale", state)
    # Unregister it from git WITHOUT touching the record - the record
    # still says "live" and git now knows nothing about it. This is the
    # two-writers shape the ticket names explicitly.
    code, out = git(primary, "worktree", "remove", "--force", live_stale)
    if code != 0:
        raise SystemExit("fixture: could not unregister %s: %s"
                         % (live_stale, out))

    parked_reap = add_worktree(primary, "wt-parked-reap", "0.9-m0-sreap",
                               landed)
    park_worktree(parked_reap, state)

    parked_blocked = add_worktree(primary, "wt-parked-blocked",
                                  "0.9-m0-sblocked", base)
    write(os.path.join(parked_blocked, "extra.txt"), "extra\n")
    git(parked_blocked, "add", "-A")
    git(parked_blocked, "commit", "-m", "unlanded work, not on accounts")
    park_worktree(parked_blocked, state)

    parked_gone = add_worktree(primary, "wt-parked-gone", "0.9-m0-sgone",
                               landed)
    park_worktree(parked_gone, state)
    agent_init.rmtree_hard(parked_gone)

    unrecorded = add_worktree(primary, "wt-unrecorded", "0.9-m0-sunrec",
                              landed)

    ghost_path = os.path.join(root, "ghost-worktree-never-created")
    agent_init.write_lease(
        agent_init.lease_path((8170, 8175), state),
        os.path.abspath(ghost_path), "ghost-branch", (8170, 8175))

    rows, problem = fleet_status.worktree_rows(primary, state)
    check("worktree_rows derives cleanly against the fixture machine",
          problem is None)
    by_path = {row["path"]: row for row in rows}

    check("a live record matching git's own registration reads live",
          by_path[os.path.abspath(live_ok)]["status"] == "live")
    check("its detail names the branch and the ports it holds",
          "0.9-m0-slive" in by_path[os.path.abspath(live_ok)]["detail"]
          and "8130-8135" in by_path[os.path.abspath(live_ok)]["detail"])

    check("a live record git no longer registers reads ORPHANED - the "
         "stale/orphaned distinction this ticket exists for",
          by_path[os.path.abspath(live_stale)]["status"] == "ORPHANED")

    check("a cleanly parked, landed-branch worktree is a reap candidate "
         "per the reaper fold-in",
          "reaper would reap it"
          in by_path[os.path.abspath(parked_reap)]["detail"])

    check("a parked worktree whose branch carries unlanded work is "
         "reported blocked, not silently a candidate",
          "blocked" in by_path[os.path.abspath(parked_blocked)]["detail"]
          and "not an ancestor"
          in by_path[os.path.abspath(parked_blocked)]["detail"])

    check("a parked record whose directory is already gone reads GONE, "
         "not crashes",
          by_path[os.path.abspath(parked_gone)]["status"] == "GONE")

    check("a worktree git registers with no fleet record reads "
         "UNRECORDED",
          by_path[os.path.abspath(unrecorded)]["status"] == "UNRECORDED")

    orphaned_lease_row = next(
        (row for row in rows if row["status"] == "ORPHANED LEASE"), None)
    check("a lease naming nothing any record claims reads ORPHANED "
         "LEASE",
          orphaned_lease_row is not None
          and os.path.abspath(ghost_path) == orphaned_lease_row["path"])

    check("the primary checkout itself is never flagged UNRECORDED - "
         "it is registered by git and never gets a fleet record by "
         "design",
          os.path.abspath(primary) not in
          {row["path"] for row in rows if row["status"] == "UNRECORDED"})

    print("\n--- reaper fold-in: derived, not re-derived, and read-only "
         "---")

    before = {path: os.path.isdir(path) for path in
             (parked_reap, parked_blocked)}
    counts, trouble = fleet_status.reaper_summary(primary, state)
    check("the fold-in reports cleanly", trouble == []
         and counts is not None)
    independent = reaper.plan(primary, state)
    independent_counts = {}
    for item in independent:
        key = (item["kind"], item["verdict"])
        independent_counts[key] = independent_counts.get(key, 0) + 1
    check("the fold-in's counts equal an independent reaper.plan() "
         "call's own counts - this section derives reaper's answer, "
         "it does not recompute it",
          counts == independent_counts)
    check("the fold-in is report mode: nothing it touched was deleted",
          all(os.path.isdir(path) == before[path] for path in before))
    check("the reap-eligible worktree is counted",
          counts.get(("parked worktree", "reap"), 0) >= 1)
    check("the blocked worktree is counted as reported, not reaped",
          counts.get(("parked worktree", "report"), 0) >= 1)

    print("\n--- after a real --act, a reaped record renders as such ---")

    reaper.main(["--act", "--repo", primary, "--state", state])
    rows, problem = fleet_status.worktree_rows(primary, state)
    by_path = {row["path"]: row for row in rows}
    check("the reap-eligible worktree is now gone (reaped), derived "
         "from the record --act itself wrote - not from this suite "
         "having claimed so",
          by_path[os.path.abspath(parked_reap)]["status"]
          == "gone (reaped)")
    check("its detail carries real evidence from the record's own "
         "'reaped' block, not a placeholder",
          by_path[os.path.abspath(parked_reap)]["detail"] != "branch "
          "0.9-m0-sreap - (no detail recorded)")
    check("the live worktree is untouched by the act",
          by_path[os.path.abspath(live_ok)]["status"] == "live")
    check("the orphaned live record is untouched by the act - reaper's "
         "own rules never reap a state=live record, however stale",
          by_path[os.path.abspath(live_stale)]["status"] == "ORPHANED")

    print("\n--- end to end: main() / render() ---")

    os.environ["BINDER_GH_CMD"] = stub_command(stub_path)
    os.environ["FLEET_STATUS_STUB_SCENARIO"] = "tickets"
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = fleet_status.main(["--repo", primary, "--state", state])
    output = buffer.getvalue()
    check("a fully-derivable run exits 0", code == 0)
    check("it says so in its own closing line",
          "all four sections derived cleanly." in output)
    check("the branches section is present", "0.9-m0-s99" in output)
    check("the tickets section is present", "0.9-M0" in output)
    check("the worktrees section is present", "wt-live-ok" in output
          or os.path.abspath(live_ok) in output)

    os.environ["FLEET_STATUS_STUB_SCENARIO"] = "boom"
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = fleet_status.main(["--repo", primary, "--state", state])
    output = buffer.getvalue()
    check("a run with an unreachable gh exits nonzero", code != 0)
    check("it names the section that could not be derived, not a "
         "silent partial success",
          "PROBLEM: gh issue list:" in output
          and "section(s) could not be fully derived" in output)
    check("the OTHER three sections still rendered - one unreachable "
         "artifact does not blank the whole view",
          ("0.9-m0-s99" in output and "wt-live-ok" in output)
          or os.path.abspath(live_ok) in output)

    del os.environ["FLEET_STATUS_STUB_SCENARIO"]
    del os.environ["BINDER_GH_CMD"]

finally:
    agent_init.rmtree_hard(root)

print("\n%d checks, %d failure(s)" % (performed, failures))
if performed != EXPECTED:
    print("EXPECTED %d checks and %d ran. A suite that quietly stops "
         "running is a suite that quietly stops checking."
         % (EXPECTED, performed))
    sys.exit(1)
sys.exit(1 if failures else 0)
