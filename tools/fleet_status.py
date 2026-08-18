#!/usr/bin/env python3
"""
`./run fleet-status` (run.cmd: `.\\run fleet-status`) - the derived
orchestration view (0.9-M0-S20, #317; the fleet-management review's
codified answer to "Prime made the owner the monitor", 2026-08-15).

    py -3 tools/fleet_status.py

Prime read agent state from ephemeral task-notification statuses and
guesswork, could not answer "alive, done, or orphaned", and escalated
to the owner over it. The fix is not a better guess - it is one view,
derived FROM ARTIFACTS this program reads itself, that Prime consults
before every spawn, continuation, or landing decision. A fork's
orchestrator gets the same view for free, because nothing here is
specific to this machine's history: four sections, and every row
carries the fact it was derived from.

  1. BRANCHES   every `0.9-*`/`ticket-*` branch, local and remote, its
                head, and how far it stands from `origin/accounts`.
  2. TICKETS    open issues in the active milestone, whether the
                `claude` label claims them, and the latest completion-
                comment marker on each.
  3. WORKTREES  every fleet worktree record's state against what git
                and the port leases say NOW - the orphaned-vs-live
                distinction a stale notification cannot make.
  4. REAPER     `reaper.py`'s own report-mode plan, folded in rather
                than re-derived, because "what would the reaper do" is
                a question that module already answers correctly.

WHY STATE.JSON IS NOT A SOURCE

`~/.claude/binder-fleet/state.json` is read nowhere in this file. The
routing rows it carries are addresses (which agent to SendMessage),
not facts about the world, and reading it here would give this program
two ideas of "live" that could disagree - exactly the shape of bug
0.9-M0-S8 found once already in a different file (two containment
tests, one held the wrong one). Every fact this program prints instead
comes from something that can be re-derived independently: git, gh,
or a record another verb in this fleet already treats as authoritative
(agent-init's own worktree records and port leases).

WHY `gh` IS AN INJECTABLE SEAM RATHER THAN A HARD DEPENDENCY

The TICKETS section is the only one that leaves this machine. Real
runs shell out to `gh` on PATH; the arms in tests/ do not have network
or a GitHub session, and a suite that skipped this section because gh
was unreachable would be proving nothing about the classification
logic it exists to test. `BINDER_GH_CMD` (a JSON array, e.g.
`["py", "-3", "/path/to/stub.py"]`) replaces the `["gh"]` prefix every
gh subprocess call is built from, the same seam BINDER_FLEET_STATE
already is for the records directory. A real invocation never sets it.

WHAT COUNTS AS EVIDENCE, AND WHY EVERY ROW NAMES ITS SOURCE

AGENTS.md's verification-labeling rule ("label every verification
claim: source, local browser, CI or live") is written for a human
handoff; this file is a machine-printed one, and the same argument
applies to it. A row that says "live" with nothing behind it is a
belief, not a derivation - so a row here that classifies a worktree,
a ticket, or a comment always prints what it read to reach that
answer, in the same line, not in a legend the reader has to hold in
their head across forty lines.

UNTRUSTED TEXT (Prime's hardening note, triaged for this ticket; MAJOR-1
of the 0.9-M0-S20 fix round, #317, is the finding that sharpened this
paragraph): gh returns issue titles and comment bodies that this
repository does not control - anyone with issue-comment access wrote
them, and this repository is PUBLIC, so that is anyone with a GitHub
account. Nothing here executes, evals, or interpolates that text into a
shell command; every subprocess call in this file is list-form (never
`shell=True`, never an f-string built into a command line). List-form
is not the whole safety property, though: a terminal interprets C0
control bytes (ESC included) wherever they sit inside a line, not only
at a line boundary, so an untrusted title or comment carrying
`\x1b[2J\x1b[H` and a forged status line can clear the operator's
screen and print a fake "all four sections derived cleanly." over the
real rows, with nothing in this program's own output marking the
substitution. `sanitize()` below escapes every C0 control byte and DEL
out of gh-derived text - titles and excerpts both - before either
reaches `print()`, so the only thing untrusted text can do is appear,
escaped, in a `print()` line. That is also why the milestone/label/
marker CLASSIFICATION logic below matches against gh's own structured
JSON fields (`labels[].name`, `milestone.number`) rather than parsing
prose, wherever a structured field exists to use.

WHY THIS HAS A TIMEOUT ON EVERY SUBPROCESS, LIKE reaper.py's OWN

This is a tool an operator runs to find out whether something is
stuck, so it cannot itself be a way to get stuck: every git and gh
child here is started with stdin closed, prompting off, and a bound -
reaper.py's own module docstring carries the argument for why a
timeout is correctness here rather than a defensive nicety, and this
file's TROUBLE list is the same shape as that one's for the same
reason - a git or gh command that did not answer is reported as
exactly that, never silently read as "found nothing".
"""

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import time

import agent_init
import reaper

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Bounded for the reason the module docstring gives: an operator tool
# that can hang is worse than one that refuses.
GIT_TIMEOUT = 120
GH_TIMEOUT = 60

# Every bounded command in this run that did not answer. Read at the
# end of main() to decide the exit code, and printed inline wherever a
# section could not be derived - the same shape reaper.py's own
# TROUBLE list is, and for the same reason: a caller that only checks
# "did it print something" cannot tell a real answer from a timeout
# dressed as one.
TROUBLE = []

# Every 0.9 slice and every ticket-prefixed spike branch, and nothing
# else - this is deliberately narrower than "every branch on the
# machine": the harness's own `worktree-agent-*` debris and a stray
# personal branch are noise this view exists to cut, not surface.
BRANCH_PATTERN = re.compile(r"^(?:0\.9-|ticket-)")

# The completion-comment markers this program recognizes, checked in
# order and matched against gh's own comment body text - see the
# module docstring's UNTRUSTED TEXT section for why this is the one
# place prose is pattern-matched rather than read from a structured
# field: there is no structured field for "what kind of comment is
# this" anywhere in the issue-tracker's own schema, so the alternative
# is not reading it at all. Each pattern is anchored to how that
# comment class is written elsewhere in this fleet (the pack's Ship
# discipline and Claim release sections, AGENTS.md's landing door) -
# not invented here. A body matching none of them is not an error: it
# is reported as exactly that, with the comment's own opening line as
# the evidence, so the reader can judge it themselves rather than
# trust a label this program declined to invent.
MARKERS = (
    (re.compile(r"^\s*Landed via PR #(\d+)", re.M),
     lambda m: "landed via PR #%s" % m.group(1)),
    (re.compile(r"^\s*BUILD-AND-HOLD\b"),
     lambda m: "BUILD-AND-HOLD posted (not pushed)"),
    (re.compile(r"ready to push:"),
     lambda m: "ready-to-push signal"),
    (re.compile(r"^\s*CLAIM\b"),
     lambda m: "CLAIM comment"),
    (re.compile(r"^\s*under review\b", re.I),
     lambda m: "under-review status (Prime review-visibility ritual)"),
    (re.compile(r"^\s*BLOCKING\b"),
     lambda m: "review verdict: BLOCKING"),
    (re.compile(r"VERDICT\s+PASS\b"),
     lambda m: "review verdict: PASS"),
)

# Every C0 control byte (0x00-0x1f) and DEL (0x7f), with no exception -
# not even \n or \r, which excerpt()'s own splitlines() already keeps
# out of a single-line excerpt but which a raw ISSUE TITLE (never run
# through splitlines()) could still carry. 0x1b (ESC) is the one that
# matters most: a terminal acts on an ESC sequence wherever it appears
# in a line, not only at a line boundary, which is what MAJOR-1
# (0.9-M0-S20 fix round, #317) found - see the module docstring's
# UNTRUSTED TEXT section for the full argument this pattern closes.
CONTROL_BYTES = re.compile(r"[\x00-\x1f\x7f]")


def sanitize(text):
    """gh-derived text, safe to hand to `print()`.

    Every C0 control byte and DEL becomes a `\\xHH` escape - visible,
    unambiguous, and inert on any terminal. Applied to every string gh
    handed this program before it reaches a `print()` line: issue
    titles in ticket_rows() and the first-line excerpt excerpt() builds
    from a comment body. Text with nothing to escape passes through
    unchanged, which is why this is safe to call unconditionally rather
    than only when a control byte is suspected.
    """
    return CONTROL_BYTES.sub(lambda m: "\\x%02x" % ord(m.group(0)), text)


def git_environment():
    """The environment every git/gh child here is started with.

    Prompting off is the root of the hang class, not a mitigation of
    it - reaper.py's own git_environment() carries the full argument.
    Reproduced here rather than imported: this file already imports
    `reaper` for the fold-in section, and reaching into its private
    subprocess helper for an unrelated call would tie two call sites
    that answer different questions (this one also runs gh, which
    reaper.py never does) to one function neither owns.
    """
    environment = dict(os.environ)
    environment["GIT_TERMINAL_PROMPT"] = "0"
    environment["GIT_OPTIONAL_LOCKS"] = "0"
    environment.pop("GIT_DIR", None)
    environment.pop("GIT_WORK_TREE", None)
    return environment


def git(repo, *args):
    """(stdout, None) on success, or (None, why) - stdout alone, never
    joined with stderr.

    Split for the reason agent_init.py's own git() docstring gives: a
    caller here parses `for-each-ref` and `rev-list` output as machine
    records, and a warning line git wrote to stderr on an otherwise
    successful call would corrupt that parse if the two streams were
    ever joined before this function returns.
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
        said = "`git %s` did not answer within %ss" % (
            " ".join(args), GIT_TIMEOUT)
        TROUBLE.append(said)
        return None, said
    except OSError as problem:
        said = "`git %s` could not be run: %s" % (" ".join(args), problem)
        TROUBLE.append(said)
        return None, said
    if done.returncode != 0:
        said = (done.stdout + done.stderr).strip() or (
            "git exited %d with no output" % done.returncode)
        return None, said
    return done.stdout, None


def gh_command():
    """The command every gh call in this file is built on top of.

    See the module docstring's WHY `gh` IS AN INJECTABLE SEAM section.
    BINDER_GH_CMD is read once per call rather than cached, which costs
    nothing here and means a test driving two different stubs in the
    same process (the marker suite does, one per comment class) never
    has to worry about which one a cached value remembers.
    """
    override = os.environ.get("BINDER_GH_CMD")
    if override:
        try:
            parsed = json.loads(override)
        except ValueError as problem:
            return None, "BINDER_GH_CMD is not valid JSON: %s" % problem
        if not isinstance(parsed, list) or not parsed:
            return None, "BINDER_GH_CMD must be a non-empty JSON array"
        return [str(part) for part in parsed], None
    found = shutil.which("gh")
    if not found:
        return None, "gh is not on PATH"
    return [found], None


def gh(*args):
    """(parsed JSON, None) on success, or (None, why).

    Bounded and prompt-closed for the same reason git() above is - see
    the module docstring's WHY THIS HAS A TIMEOUT section.
    """
    command, problem = gh_command()
    if problem:
        return None, problem
    try:
        done = subprocess.run(
            [*command, *args],
            capture_output=True, text=True,
            stdin=subprocess.DEVNULL,
            timeout=GH_TIMEOUT,
            env=git_environment(),
        )
    except subprocess.TimeoutExpired:
        said = "`gh %s` did not answer within %ss" % (
            " ".join(args), GH_TIMEOUT)
        TROUBLE.append(said)
        return None, said
    except OSError as problem:
        said = "`gh %s` could not be run: %s" % (" ".join(args), problem)
        TROUBLE.append(said)
        return None, said
    if done.returncode != 0:
        said = (done.stdout + done.stderr).strip() or (
            "gh exited %d with no output" % done.returncode)
        return None, said
    try:
        return json.loads(done.stdout), None
    except ValueError as problem:
        return None, "gh printed non-JSON output: %s" % problem


# ----------------------------------------------------------------------
# 1. Branches
# ----------------------------------------------------------------------

def _refs(repo, pattern):
    out, problem = git(repo, "for-each-ref", "--format=%(refname:short) "
                       "%(objectname)", pattern)
    if out is None:
        return None, problem
    found = []
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 2:
            found.append((parts[0], parts[1]))
    return found, None


def branch_rows(repo):
    """[{kind, name, sha, ahead, behind, note}], evidence-labeled.

    Local and remote are two different questions on purpose - a branch
    pushed but not yet checked out anywhere, and a branch checked out
    here but not yet pushed, are both facts a spawn/continuation
    decision needs and neither implies the other.
    """
    rows = []
    base, base_problem = git(repo, "rev-parse", "--verify", "--quiet",
                             "refs/remotes/origin/accounts")
    base = base.strip() if base else None

    local, problem = _refs(repo, "refs/heads")
    if problem:
        return rows, "local branches: %s" % problem
    remote, rproblem = _refs(repo, "refs/remotes/origin")
    if rproblem:
        return rows, "remote branches: %s" % rproblem

    for kind, refs, strip in (("local", local, ""),
                              ("remote", remote, "origin/")):
        for name, sha in refs:
            bare = name[len(strip):] if strip and name.startswith(strip) \
                else name
            if bare == "HEAD" or not BRANCH_PATTERN.match(bare):
                continue
            if base is None:
                rows.append({"kind": kind, "name": name, "sha": sha,
                            "ahead": None, "behind": None,
                            "note": "origin/accounts does not resolve "
                                    "here (%s), so ahead/behind could "
                                    "not be computed"
                                    % (base_problem or "no such ref")})
                continue
            counts, cproblem = git(repo, "rev-list", "--left-right",
                                   "--count", "%s...%s" % (base, sha))
            if counts is None:
                rows.append({"kind": kind, "name": name, "sha": sha,
                            "ahead": None, "behind": None,
                            "note": "rev-list failed: %s" % cproblem})
                continue
            parts = counts.split()
            behind = int(parts[0]) if len(parts) == 2 else None
            ahead = int(parts[1]) if len(parts) == 2 else None
            rows.append({"kind": kind, "name": name, "sha": sha,
                        "ahead": ahead, "behind": behind, "note": None})
    rows.sort(key=lambda row: (row["name"], row["kind"]))
    return rows, None


# ----------------------------------------------------------------------
# 2. Tickets
# ----------------------------------------------------------------------

def active_milestone(issues):
    """(number, title) for the lowest-numbered milestone carrying an
    open issue, or None.

    "Active" is not a field GitHub exposes - milestones stay `open`
    indefinitely once created, so 0.9-M1 through 0.9-M4 all read
    `state: open` the same as 0.9-M0 does the day 0.9-M0 is the only
    one anybody may work (the inter-milestone fleet-review gate,
    AGENTS.md, is precisely the rule that keeps it that way). What
    distinguishes the milestone actually in flight is that it is the
    EARLIEST one with open work left, which is exactly `min(number)`
    over the milestones this call's own open-issue list touches - no
    second gh call to the milestones endpoint needed, and no date or
    naming convention to keep in sync with the wave numbering by hand.
    """
    numbered = [issue["milestone"] for issue in issues
               if issue.get("milestone")]
    if not numbered:
        return None
    lowest = min(numbered, key=lambda milestone: milestone["number"])
    return lowest["number"], lowest["title"]


def classify_comment(body):
    for pattern, label in MARKERS:
        match = pattern.search(body)
        if match:
            return label(match)
    return None


def excerpt(text, width=88):
    first = next((line.strip() for line in text.splitlines()
                 if line.strip()), "")
    trimmed = (first[:width] + "...") if len(first) > width else first
    return sanitize(trimmed)


def ticket_rows():
    """([row, ...], milestone title, problem) - problem stops nothing
    else from being derived; the caller prints it and moves on.

    One gh call fetches every open issue with its milestone and labels
    already attached, so "which milestone is active" and "is this
    ticket claimed" cost nothing beyond the one call every row already
    needed - a second call per ticket is spent only on the comment
    marker, which gh's list form does not carry.
    """
    issues, problem = gh("issue", "list", "--state", "open", "--json",
                         "number,title,labels,milestone,url", "--limit",
                         "200")
    if problem:
        return [], None, "gh issue list: %s" % problem
    picked = active_milestone(issues)
    if picked is None:
        return [], None, ("no open issue carries a milestone, so no "
                          "active milestone could be determined")
    number, title = picked
    rows = []
    for issue in issues:
        milestone = issue.get("milestone")
        if not milestone or milestone["number"] != number:
            continue
        claimed = any(label.get("name") == "claude"
                     for label in issue.get("labels", []))
        comments, cproblem = gh("issue", "view", str(issue["number"]),
                                "--json", "comments")
        if cproblem:
            marker = "gh issue view: %s" % cproblem
        else:
            found = comments.get("comments", [])
            if not found:
                marker = "no comments yet"
            else:
                latest = max(found, key=lambda c: c.get("createdAt", ""))
                label = classify_comment(latest.get("body", ""))
                quoted = excerpt(latest.get("body", ""))
                marker = ("%s - \"%s\"" % (label, quoted) if label
                          else "no recognized marker - \"%s\"" % quoted)
        rows.append({"number": issue["number"],
                    "title": sanitize(issue["title"]),
                    "url": issue["url"], "claimed": claimed,
                    "marker": marker})
    rows.sort(key=lambda row: row["number"])
    return rows, title, None


# ----------------------------------------------------------------------
# 3. Worktrees
# ----------------------------------------------------------------------

def valid_block(block):
    """Whether a lease's `block` field is the two-integer pair every
    other line in this file assumes it is - never assumed true. bool is
    excluded even though it subclasses int in Python, because a lease
    file is JSON on disk that this program treats as untrusted until
    checked, not a value this program constructed itself."""
    return (isinstance(block, (list, tuple)) and len(block) == 2
           and all(isinstance(item, int) and not isinstance(item, bool)
                  for item in block))


def read_leases(state):
    """([{file, path, block, branch, worktree}], [{file, block}]) - the
    well-formed leases, and separately every lease whose `block` field
    is not a two-integer pair.

    MINOR-1 (0.9-M0-S20 fix round, #317): a lease file is JSON on disk,
    read here as untrusted until its shape is checked - and every other
    line in this file that formats a block assumes `lease["block"]` is
    already a two-integer pair. Without a guard at the read, the FIRST
    malformed one reaches `"%d-%d" % tuple(lease["block"])`, raises,
    and blanks all four sections of the view - one bad lease file
    taking down the report of every other row that has nothing to do
    with it. Shape is validated here instead, so nothing downstream
    ever calls `tuple()` on a block it has not already been told is
    well-formed; a malformed lease is carried separately and
    worktree_rows() renders it as its own row rather than silently
    dropping it or letting it corrupt a row it is not part of - the
    same property the gh boundary already has (one unreadable comment
    cannot blank the tickets section, only its own row).

    Not filtered to any one worktree, unlike reaper.leases_on(),
    because this section's job is to name every lease that has NOTHING
    live behind it, and that requires seeing all of them at once rather
    than asking one at a time.
    """
    directory = agent_init.leases_dir(state)
    if not os.path.isdir(directory):
        return [], []
    found = []
    malformed = []
    for name in sorted(os.listdir(directory)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(directory, name)
        lease = agent_init.read_json(path)
        if not isinstance(lease, dict):
            continue
        block = lease.get("block")
        if not valid_block(block):
            malformed.append({"file": name, "block": block})
            continue
        found.append({"file": name, "path": path, "block": block,
                     "branch": lease.get("branch"),
                     "worktree": lease.get("worktree")})
    return found, malformed


def _hours_ago(timestamp, now=None):
    """Hours between a UNIX timestamp and now, one decimal - or None if
    there is no timestamp to measure from. Never guessed."""
    if timestamp is None:
        return None
    now = time.time() if now is None else now
    return (now - timestamp) / 3600.0


def _record_age_hours(record, now=None):
    """Hours since a fleet record's own `initialized_at`, or None if
    the field is missing or does not parse - MAJOR-2's age derivation,
    read from the one artifact that carries a "when" at all."""
    when = record.get("initialized_at")
    if not when:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(when.replace("Z", "+00:00"))
    except ValueError:
        return None
    now = now or datetime.datetime.now(datetime.timezone.utc)
    return (now - parsed).total_seconds() / 3600.0


def _lease_age_hours(held, now=None):
    """Hours since the OLDEST of a worktree's held port leases was last
    written (its file mtime) - the second artifact MAJOR-2 names,
    corroborating (or not) the record's own initialized_at."""
    stamps = [os.path.getmtime(lease["path"]) for lease in held
             if lease.get("path") and os.path.exists(lease["path"])]
    return _hours_ago(min(stamps), now) if stamps else None


def _format_hours(hours):
    return "%.1fh" % hours if hours is not None else "unknown"


def worktree_rows(repo, state):
    """([row, ...], problem) - the orphaned-vs-live distinction.

    Built from three artifacts read independently and then compared,
    rather than trusted one at a time: the fleet's own records (a
    claim written by the worktree about itself), git's live worktree
    table (a fact about this machine right now), and the port leases
    (a claim written by agent-init at lease time). The two-writers
    hazard this ticket exists to answer is exactly what a record and
    the live table DISAGREEING looks like, so agreement or the lack of
    it is the row - never a single source read alone.
    """
    table = reaper.worktree_table(repo)
    if not table:
        return [], "git worktree list --porcelain failed"
    # table[0] is always the primary checkout - reaper.py's own
    # worktree_table() docstring establishes this ("the main worktree
    # is the first record git prints"), and it is the one path that is
    # never a fleet worktree: agent-init writes no record for it and
    # never will, so counting it against the record set below would
    # print a permanent, meaningless "UNRECORDED" row every single run.
    primary = table[0]["path"]
    registered = {entry["path"] for entry in table}

    reaper_items = None
    reaper_problem = None
    try:
        reaper_items = reaper.plan(repo, state)
    except ValueError as problem:
        reaper_problem = str(problem)
    by_path = ({item["subject"]: item for item in reaper_items
               if item["kind"] in ("parked worktree", "vanished worktree")}
              if reaper_items is not None else {})

    leases, malformed_leases = read_leases(state)
    leases_by_path = {}
    for lease in leases:
        if lease["worktree"]:
            leases_by_path.setdefault(
                os.path.abspath(lease["worktree"]), []).append(lease)

    rows = []
    known_paths = set()
    for source, record in reaper.records(state):
        path = record.get("worktree")
        if not path:
            rows.append({"status": "MALFORMED", "path": "(none)",
                        "detail": "%s names no worktree at all"
                                  % os.path.basename(source),
                        "evidence": os.path.basename(source)})
            continue
        path = os.path.abspath(path)
        known_paths.add(path)
        is_registered = path in registered
        branch = record.get("branch")
        # NIT (0.9-M0-S20 fix round): a detached-HEAD record's `branch`
        # is Python `None`, and `"branch %s" % None` prints the literal
        # word "None" - a reader's-eye defect, not a derivation one, but
        # confusing enough on an operator's screen to fix here.
        branch_label = branch if branch else "detached"
        state_field = record.get("state")
        held = leases_by_path.pop(path, [])
        lease_note = (", ".join("%d-%d" % tuple(lease["block"])
                                for lease in held)
                     if held else "no lease held")

        if state_field == "live":
            if is_registered:
                # MAJOR-2 (0.9-M0-S20 fix round, #317): a bare "live"
                # status here would print the same word a working
                # agent's row prints, from a record and a git
                # registration that a dead-without-parking agent leaves
                # behind identically to a working one - the weakest
                # evidence in this whole view printing the strongest
                # word. No process-state inference is added (still no
                # psutil, no pid); instead the two artifacts that ARE
                # derivable, the record's own initialized_at and the
                # port lease file's mtime, are surfaced as ages, with a
                # caveat that says outright what neither of them
                # proves.
                status = "CLAIMS LIVE"
                detail = ("branch %s, ports %s - record claims live, "
                          "written %s ago (port lease written %s ago); "
                          "nothing here proves a process is running"
                          % (branch_label, lease_note,
                             _format_hours(_record_age_hours(record)),
                             _format_hours(_lease_age_hours(held))))
            else:
                status = "ORPHANED"
                detail = ("record says live and git does not register "
                          "this worktree - a resumed-vs-two-writers "
                          "signal")
        elif state_field == "parked":
            if not os.path.isdir(path):
                status = "GONE"
                detail = ("branch %s, %s - the parked record's directory "
                          "no longer exists on disk; reaper.py treats a "
                          "missing directory as inert (nothing left to "
                          "act on), not a reap candidate"
                          % (branch_label, lease_note))
            else:
                reaped = by_path.get(path)
                if reaped is not None:
                    verdict = ("reaper would reap it" if reaped["verdict"]
                               == "reap" else
                               "reaper reports it (blocked): %s"
                               % "; ".join(proof.said for proof in
                                           reaped["proofs"] if not proof.ok))
                elif reaper_problem:
                    verdict = "reaper could not be consulted: %s" \
                             % reaper_problem
                else:
                    verdict = "not currently a reap candidate"
                # MINOR-2 (0.9-M0-S20 fix round, #317): appended
                # unconditionally rather than living behind its own
                # `elif is_registered:` slot, because reaper.plan()'s
                # own parked_items() emits an item for ANY parked
                # record whose directory still exists, registered or
                # not - so an `elif` here competing with the block
                # above would only run on a path `reaped is not None`
                # never takes once the directory exists, which is
                # always. `agent-park` detaches HEAD but never runs
                # `git worktree remove` (agent_init.py's own park
                # command only detaches; only a reap prunes the
                # registration), so a freshly parked worktree is
                # ordinarily STILL registered - the reviewer's "three
                # such worktrees on the real machine" is that ordinary
                # case, not a rare one, and it deserves a row that says
                # so on a path this program actually reaches.
                if is_registered:
                    verdict += (" - still registered by git as a live "
                               "worktree despite the parked record, a "
                               "two-writers signal")
                status = "parked"
                detail = "branch %s, %s - %s" % (branch_label, lease_note,
                                                 verdict)
        elif state_field == "reaped":
            status = "gone (reaped)"
            reaped_meta = record.get("reaped") or {}
            what = reaped_meta.get("what") or []
            detail = "branch %s - %s" % (
                branch_label, what[-1] if what else "(no detail recorded)")
        else:
            status = "UNKNOWN STATE"
            detail = "record's state field is %r" % state_field
        # MINOR-3 (Prime ruling, 0.9-M0-S20 fix round, #317): the
        # naming standard is law and BRANCH_PATTERN is right to exclude
        # a branch like `work-0.9-m0-s21-fw2` from the BRANCHES section
        # - the branch name is the violation, not the filter. A
        # worktree row still names its branch regardless of the
        # pattern, so it says outright when the two sections disagree
        # rather than leaving the reader to notice a name missing from
        # BRANCHES on their own.
        if branch and not BRANCH_PATTERN.match(branch):
            detail += (" - non-standard branch name (not in BRANCHES "
                      "section)")
        rows.append({"status": status, "path": path, "detail": detail,
                    "evidence": os.path.basename(source)})

    for path in sorted(registered - known_paths - {primary}):
        rows.append({"status": "UNRECORDED", "path": path,
                    "detail": "git registers this worktree and no "
                              "fleet record names it",
                    "evidence": "git worktree list --porcelain"})

    for path, held in sorted(leases_by_path.items()):
        rows.append({"status": "ORPHANED LEASE", "path": path,
                    "detail": "port block(s) %s held, no fleet record "
                              "names this worktree"
                              % ", ".join("%d-%d" % tuple(lease["block"])
                                          for lease in held),
                    "evidence": ", ".join(lease["file"] for lease in
                                          held)})

    # MINOR-1 (0.9-M0-S20 fix round, #317): a lease whose `block` field
    # is not a well-formed two-integer pair is carried separately by
    # read_leases() rather than crashing every OTHER row's format call
    # - rendered here as its own row, named by the lease file that
    # holds it, same as a malformed fleet record already renders above.
    for bad in malformed_leases:
        rows.append({"status": "MALFORMED LEASE", "path": "(none)",
                    "detail": "%s names a port block that is not a "
                              "well-formed two-integer pair: %r"
                              % (bad["file"], bad["block"]),
                    "evidence": bad["file"]})

    rows.sort(key=lambda row: (row["status"] != "ORPHANED",
                               row["status"] != "ORPHANED LEASE",
                               row["status"] != "UNRECORDED", row["path"]))
    return rows, None


# ----------------------------------------------------------------------
# 4. Reaper fold-in
# ----------------------------------------------------------------------

def reaper_summary(repo, state):
    """(counts by kind, trouble) - reaper.plan()'s own answer, not a
    re-derivation of it.

    "What would the reaper do" is a question tools/reaper.py already
    answers correctly, proofs and all; recomputing it here would be a
    second implementation of every rule that file's own module
    docstring argues for at length (containment, reparse-point
    handling, the ancestry proofs), which is exactly the "two chances
    to get it wrong" shape that file itself was written to avoid one
    level down. This calls reaper.plan() - report mode, `--act` never
    reached - and only counts what came back.
    """
    del reaper.TROUBLE[:]
    try:
        items = reaper.plan(repo, state)
    except ValueError as problem:
        return None, [str(problem)]
    counts = {}
    for item in items:
        key = (item["kind"], item["verdict"])
        counts[key] = counts.get(key, 0) + 1
    return counts, list(reaper.TROUBLE)


# ----------------------------------------------------------------------
# Rendering
# ----------------------------------------------------------------------

def render(repo, state):
    problems = []
    print("=== fleet-status: the derived orchestration view "
         "(0.9-M0-S20, #317) ===\n")
    print("repository   %s" % repo)
    print("fleet state  %s" % (state or agent_init.state_dir()))

    print("\n--- branches (0.9-*/ticket-*) "
         "--- evidence: git for-each-ref, git rev-list")
    rows, problem = branch_rows(repo)
    if problem:
        problems.append("branches: %s" % problem)
        print("PROBLEM: %s" % problem)
    if not rows:
        print("(none found)")
    for row in rows:
        span = ("ahead %d, behind %d" % (row["ahead"], row["behind"])
               if row["ahead"] is not None else row["note"])
        print("%-7s %-32s %s  %s" % (row["kind"], row["name"],
                                     row["sha"][:12], span))

    print("\n--- tickets (open issues in the active milestone) "
         "--- evidence: gh issue list, gh issue view --json comments")
    rows, milestone_title, problem = ticket_rows()
    if problem:
        problems.append("tickets: %s" % problem)
        print("PROBLEM: %s" % problem)
    else:
        print("active milestone: %s" % milestone_title)
    for row in rows:
        print("#%-5d %-60s claimed:%-3s"
             % (row["number"], row["title"][:60],
                "yes" if row["claimed"] else "no"))
        print("        %s" % row["marker"])

    print("\n--- worktrees --- evidence: fleet records, port leases, "
         "git worktree list --porcelain")
    rows, problem = worktree_rows(repo, state)
    if problem:
        problems.append("worktrees: %s" % problem)
        print("PROBLEM: %s" % problem)
    if not rows:
        print("(no fleet records found)")
    for row in rows:
        print("%-15s %s" % (row["status"], row["path"]))
        print("                %s  [%s]" % (row["detail"], row["evidence"]))

    print("\n--- reaper --report fold-in --- "
         "evidence: reaper.plan() (report mode; nothing performed)")
    counts, trouble = reaper_summary(repo, state)
    if counts is None:
        problems.append("reaper: %s" % "; ".join(trouble))
        print("PROBLEM: reaper.plan() could not run: %s"
             % "; ".join(trouble))
    else:
        for kind in reaper.ORDER:
            reap = counts.get((kind, "reap"), 0)
            report = counts.get((kind, "report"), 0)
            if reap or report:
                print("%-18s %d to reap, %d reported and left alone"
                     % (kind, reap, report))
        if trouble:
            problems.append("reaper: %s" % "; ".join(trouble))
            print("git trouble during the reaper fold-in: %s"
                 % "; ".join(trouble))

    if TROUBLE:
        print("\n--- unanswered commands during this run (%d) ---"
             % len(TROUBLE))
        for line in TROUBLE:
            print("    %s" % line)

    print("\n%s" % ("%d section(s) could not be fully derived: %s"
                    % (len(problems), "; ".join(problems))
                    if problems or TROUBLE
                    else "all four sections derived cleanly."))
    return 1 if problems or TROUBLE else 0


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="py -3 tools/fleet_status.py",
        description="The derived orchestration view (0.9-M0-S20, #317): "
                    "branches, tickets, worktrees and the reaper's own "
                    "report, each row naming the artifact it came from.")
    # Suppressed for the reason every other verb in this fleet suppresses
    # the same pair: a real caller never passes either one, and a suite
    # drives this against a fabricated machine instead of the real one.
    parser.add_argument("--repo", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--state", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    del TROUBLE[:]
    repo = os.path.abspath(args.repo or REPO)
    return render(repo, args.state)


if __name__ == "__main__":
    sys.exit(main())
