#!/usr/bin/env python3
"""
`./run ship-check` (run.cmd: `.\\run ship-check`) - the mechanical
ship-check (owner ruling 2026-08-18, #320).

    py -3 tools/ship_check.py --declared <path> [--issue N] [options]

WHY THIS EXISTS

Three consecutive completions this wave misreported the transitional
gate's stage count ("38", then "39") as a remembered number with no
table attached, while the tree was 40/40 green each time - the pack
already rules "report the EXACT printed stage table, never a
remembered count," and prose failed at that three times running. This
is the machine-held answer: an executor runs it AFTER its last commit
and BEFORE its terminal signal, and its own stdout - the whole of it,
unedited - IS the ready-to-paste block the completion comment carries.
The executor never re-types a count; it copies what this program
printed.

WHAT IT CHECKS, AND WHY EACH ONE IS ITS OWN STAGE

  1. The old gate (`py -3 tools/check.py`), run as a real subprocess so
     its own exact stage table is captured and echoed verbatim, not
     summarized. This is the stage the wave's three misreports were
     about.
  2. The 0.9 gate (`node tests/run.mjs`), same treatment - EXCEPT this
     stage first asks whether the worktree is initialized at all
     (`agent_init.initialization_problems()`, the same callable
     `tests/preflight.mjs` already gates the whole 0.9 apparatus on).
     Running the real gate against an uninitialized worktree would
     fail at its own stage zero with a wall of arms that never ran,
     which reads as "the gate is broken" rather than "the worktree
     needs `./run agent-init`" - so this stage asks the sharper
     question first and never lets the confusing failure happen.
  3. Branch name against the naming standard (`0.9-m<n>-s<n>`,
     lowercase) - AGENTS.md and the pack both rule this is law, and a
     scratch name reaching the signal is exactly the report-discipline
     slip this ticket's own issue names alongside the stage-count one.
  4. Working tree clean, full 40-character head SHA printed for direct
     copy into the ready-to-push signal - a signal naming a SHA nobody
     can `git checkout` because the tree moved after it was read is a
     second class of the same "hand-typed instead of read" failure.
  5. Declared files vs the real diff - `tools/claim_vs_diff.py`'s own
     `compare()`, imported and called directly rather than
     reimplemented. AGENTS.md already runs this exact mechanism at the
     landing door; this stage moves it earlier, into the builder's own
     hands, on the theory a mismatch is cheaper to fix before the door
     than to fail at it. See "WHY claim_vs_diff IS IMPORTED, NOT
     REBUILT" below for why this is safe here where claim_vs_diff.py's
     own docstring insists on reimplementing the same discipline
     itself.
  6. Ticket label state via `gh` - REPORT-ONLY, and deliberately never
     gates the exit code. This program cannot know whether the
     `claude` label is SUPPOSED to be present or absent at the moment
     it runs (Prime's bookkeeping owns that, per the pack's "Claim
     release" section), and `gh` may simply not be on the machine
     running this - a fork's own posture, the same one
     `tools/fleet_status.py`'s own module docstring argues for its
     TICKETS section. So this stage only ever REPORTS what it read,
     never PASS/FAIL, and a missing `gh` degrades to a labeled gap
     rather than a crash or a silent skip.

Exit 0 iff stages 1-5 all pass; exit 1 if any of them fails. Stage 6
never changes the exit code - see its own paragraph above for why.

WHY claim_vs_diff IS IMPORTED, NOT REBUILT

`tools/claim_vs_diff.py`'s own module docstring reimplements the
bounded-subprocess git discipline rather than importing a sibling
module, and gives the reason: a git-ops door check has to run
standalone, with no dependency on a module a different 0.9-M0 slice
might change shape under it. That reason does not hold here -
ship_check.py already imports `agent_init` (for the initialization
check) and runs from inside a live worktree exactly the way
`session_open.py` and `fleet_status.py` already do, so it is already
coupled to this fleet's tooling shape by construction. Importing
`claim_vs_diff.compare()` and `claim_vs_diff.git()` directly reuses
the real mechanism (and its own timeout discipline) instead of forking
a third copy of it, and it is the exact reuse `claim_vs_diff.py`'s own
docstring names as intentional: "PER AUDIT F10: PRIME MAY RUN THIS
AGAINST ITS OWN SUMMARIES ... no special mode, no second entry point,
nothing to build." This program is that same call, run one stage
earlier by the builder instead of at the door by a git-ops order.

WHY fleet_status.gh() AND .sanitize() ARE IMPORTED, NOT REBUILT

The same argument again, for the same reason: `sanitize()` at
tools/fleet_status.py:173 is the S20 MAJOR-1 hardening - every C0
control byte and DEL escaped out of gh-derived text before it reaches
`print()`, because a forged control sequence in an issue title or
comment can clear an operator's screen and print a fake status line
over the real one. Re-typing that regex a second time here would be a
second place it could quietly drift from the first; importing it means
a future fix to the escaping rule fixes both call sites at once.
`fleet_status.gh()` is imported for the identical reason: it already
carries the `BINDER_GH_CMD` test seam (the module docstring's WHY `gh`
IS AN INJECTABLE SEAM section), the prompt-off/no-optional-locks
subprocess discipline, and the bounded timeout - this file's own suite
drives stage 6 through that exact seam rather than a second one.

SEAMS FOR THE SUITE

`--repo` and `--state` are accepted and suppressed from `--help`,
mirroring `session_open.py` and `fleet_status.py`: a real caller never
passes either one, and `tools/ship_check_suite.py` drives every
scenario against a fabricated repository instead of this one. `--base`
defaults to `origin/accounts` - AGENTS.md's landing door rule, "the
base is always origin/accounts" - but stays a real, documented flag
because a fork's default branch may differ.

THE COUNTED SUMMARY LINE (0.9-M1-S0, #323)

Four completions in the M0 close wave hand-typed the WRONG count
beside a correct, fully-pasted table - the table itself was never the
problem, the number a tired human wrote next to it was. Stage 1 and
stage 2's captured lines now grow one more line each, appended after
everything the subprocess printed: `_count_old_gate_table()` and
`_count_new_gate_table()` below read that same captured text back and
COUNT it, so the last line of each gate's own block is a number this
program computed, never one it remembered or asked the subprocess for.

Both counters are deliberately blind to any total the subprocess
itself may have printed - `tools/check.py` prints no summary today and
`tests/run.mjs` prints its own ("N arm(s), all green." or "...,
problem(s): ..."), and this file never reads that line as the answer.
Trusting a subprocess's self-report would make this exactly the
failure the ticket exists to end, one level down: a number sitting
beside the evidence that nothing here checked against the evidence.
Instead each counter re-derives the same fact a human eye reads off
the table - `tools/check.py`'s own bordered block of "<label> ok" /
"<label> FAILED" rows for the old gate, `tests/run.mjs`'s own
`tests/<name>.test.mjs` arm rows for the new one - so a subprocess
whose own self-reported count disagreed with its own rows would be
caught here, not echoed.
"""

import argparse
import os
import re
import subprocess
import sys

import agent_init
import claim_vs_diff
from fleet_status import gh, sanitize

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Bounded the way every subprocess in this fleet's tooling is bounded
# (reaper.py's own module docstring carries the argument this file
# does not repeat): a stage that hangs has to be reported as exactly
# that, never silently waited on. The real gate is "~14s wall" per the
# pack's own economy-of-verification section for a small slice; ten
# minutes is headroom for a slice that also rebuilt dist/ or touched
# every dev/ suite, not an invitation to let a genuine hang run quiet.
GATE_TIMEOUT = 600

BRANCH_STANDARD = "0.9-m<n>-s<n> (lowercase)"


def _branch_ok(name):
    """Whether `name` matches the naming standard, char by char.

    Written as a scanner rather than a regular expression on purpose -
    this file's own review bar (AGENTS.md, "The review bar") is read
    the hazard and try to produce it, and the hazard named in the
    ticket is a SCRATCH name reaching the signal. A regex with a typo'd
    quantifier can accept more than it should silently; a scanner that
    names each piece it consumed is the one shape that cannot drift
    from what it claims to accept without becoming visibly wrong.
    """
    prefix = "0.9-m"
    if not name.startswith(prefix):
        return False
    rest = name[len(prefix):]
    milestone, sep, tail = rest.partition("-s")
    if not sep:
        return False
    return milestone.isdigit() and tail.isdigit() and tail != ""


class Stage:
    """One row of the ship-check table.

    `gates` is False for exactly one stage (ticket label state) - see
    the module docstring's paragraph on stage 6 for why that stage
    never changes the exit code no matter what it finds.
    """

    def __init__(self, name, ok, lines, evidence, gates=True,
                 status_word=None):
        self.name = name
        self.ok = ok
        self.lines = lines
        self.evidence = evidence
        self.gates = gates
        self.status_word = status_word or ("PASS" if ok else "FAIL")


def _run_captured(argv, cwd, label):
    """(ok, lines) for a subprocess whose ENTIRE stdout+stderr is the
    evidence - never summarized, because a summary is exactly what the
    three misreports this ticket exists to end already were."""
    try:
        done = subprocess.run(argv, cwd=cwd, capture_output=True,
                              text=True, timeout=GATE_TIMEOUT,
                              stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return False, ["%s did not answer within %ss and was killed."
                       % (label, GATE_TIMEOUT)]
    except OSError as problem:
        return False, ["%s could not be run at all: %s" % (label, problem)]
    lines = (done.stdout + done.stderr).splitlines()
    lines.append("")
    lines.append("[%s exited %d]" % (label, done.returncode))
    return done.returncode == 0, lines


# `tools/check.py`'s own render step prints this border twice, verbatim
# ("=" * (width + 10)), sandwiching one "<label padded> ok"/"FAILED" row
# per stage - see check.py's own `main()`, the block right after
# `results.append(("check.py roster rules", ...))`. A line entirely made
# of "=" cannot occur as one of check.py's own labels (none of them are
# "="-only), so it is an unambiguous fence; the LAST such pair is taken
# so a stray look-alike line earlier in a checker's own chatty stdout
# (none is known to print one, but nothing here assumes that stays true)
# can never be mistaken for the fence around the real table.
_BORDER = "="
_OLD_GATE_OK_SUFFIX = " ok"
_OLD_GATE_FAILED_SUFFIX = " FAILED"


def _count_old_gate_table(lines):
    """(total, ok, failed) counted from the old gate's own bordered
    table, or None when no such table was found in the captured text -
    which only happens when the subprocess died before rendering one,
    a case the stage already reports FAILED for on its own terms.

    Deliberately reads the ROWS, never any total `tools/check.py` might
    print (it prints none today) - see this module's docstring, "THE
    COUNTED SUMMARY LINE", for why a subprocess's own self-report is
    never the source here.
    """
    borders = [index for index, line in enumerate(lines)
              if line and set(line) == {_BORDER}]
    if len(borders) < 2:
        return None
    start, end = borders[-2], borders[-1]
    ok = failed = 0
    for line in lines[start + 1:end]:
        if line.endswith(_OLD_GATE_OK_SUFFIX):
            ok += 1
        elif line.endswith(_OLD_GATE_FAILED_SUFFIX):
            failed += 1
    total = ok + failed
    return (total, ok, failed) if total else None


# `tests/run.mjs`'s own `report()` prints one row per arm as
# `name.padEnd(52) + status.padEnd(8) + seconds.toFixed(1) + "s"` - see
# run.mjs's own `report` and the loop over `arms` that calls it. Every
# arm's name is `tests/<name>.test.mjs` by construction (`ARM_SUFFIX`,
# the same file's own header), which is what lets this pattern exclude
# `tests/preflight.mjs`'s row (same shape, no `.test.mjs` suffix) without
# any position-based reasoning - a python line ending the same way by
# coincidence would need to both start with `tests/` and end in
# `.test.mjs ` immediately followed by a status word, which nothing else
# in the captured stdout does.
_NEW_GATE_ROW = re.compile(
    r"^tests/[^\s]+\.test\.mjs\s+(ok|FAILED)\s+\d+\.\d+s$")


def _count_new_gate_table(lines):
    """(total, ok, failed) counted from tests/run.mjs's own arm rows, or
    None when none were found - the "not initialized" short-circuit
    below never calls this, and a subprocess that died before printing
    any row is already FAILED on its own terms.

    Deliberately never reads `tests/run.mjs`'s own closing line ("N
    arm(s), all green." or "..., N problem(s): ...") - see this module's
    docstring, "THE COUNTED SUMMARY LINE".
    """
    ok = failed = 0
    for line in lines:
        match = _NEW_GATE_ROW.match(line)
        if not match:
            continue
        if match.group(1) == "ok":
            ok += 1
        else:
            failed += 1
    total = ok + failed
    return (total, ok, failed) if total else None


def stage_old_gate(repo):
    script = os.path.join(repo, "tools", "check.py")
    label = "py -3 tools/check.py"
    if not os.path.isfile(script):
        return Stage("old gate (%s)" % label, False,
                     ["%s is not in this worktree." % script], script)
    ok, lines = _run_captured([sys.executable, script], repo, label)
    counted = _count_old_gate_table(lines)
    if counted is not None:
        total, passed, failed = counted
        lines = [*lines, "", "%d stages, %d ok, %d FAILED"
                             % (total, passed, failed)]
    return Stage("old gate (%s)" % label, ok, lines,
                 "%s, captured verbatim above" % label)


def stage_new_gate(repo, state):
    """The 0.9 gate, or the sharper "not initialized" row.

    `agent_init.initialization_problems()` is the same callable
    `tests/preflight.mjs` gates the whole 0.9 apparatus on (its own
    module docstring: "THE CALLABLE THE GATE'S FIRST STAGE CONSUMES"),
    reused here rather than re-probed so this stage and preflight can
    never disagree about what "initialized" means.
    """
    problems = agent_init.initialization_problems(repo, state)
    label = "node tests/run.mjs"
    if problems:
        lines = ["not initialized - run `./run agent-init` "
                 "(PowerShell: `.\\run agent-init`).", *problems]
        return Stage("0.9 gate (%s)" % label, False, lines,
                     "tools/agent_init.py initialization_problems()")
    node = agent_init.find_node()
    if node is None:
        return Stage("0.9 gate (%s)" % label, False,
                     ["node is not on PATH or in the usual install "
                      "locations, and the 0.9 gate needs it."],
                     "shutil.which(\"node\")")
    script = os.path.join(repo, "tests", "run.mjs")
    if not os.path.isfile(script):
        return Stage("0.9 gate (%s)" % label, False,
                     ["%s is not in this worktree." % script], script)
    ok, lines = _run_captured([node, script], repo, label)
    counted = _count_new_gate_table(lines)
    if counted is not None:
        total, passed, failed = counted
        lines = [*lines, "", "%d arms, %d green, %d FAILED"
                             % (total, passed, failed)]
    return Stage("0.9 gate (%s)" % label, ok, lines,
                 "%s, captured verbatim above" % label)


def stage_branch_name(repo):
    code, out = claim_vs_diff.git(repo, "branch", "--show-current")
    branch = out.strip() if code == 0 else ""
    evidence = "git branch --show-current"
    if not branch:
        return Stage("branch name", False,
                     ["HEAD is detached, or git could not answer: %s"
                      % out.strip()], evidence)
    if not _branch_ok(branch):
        return Stage("branch name", False,
                     ["branch %r does not match the naming standard `%s` "
                      "- no scratch names at signal time."
                      % (branch, BRANCH_STANDARD)], evidence)
    return Stage("branch name", True, ["branch: %s" % branch], evidence)


def stage_clean_head(repo):
    scode, sout = claim_vs_diff.git(repo, "status", "--porcelain")
    hcode, hout = claim_vs_diff.git(repo, "rev-parse", "HEAD")
    head = hout.strip()
    evidence = "git status --porcelain, git rev-parse HEAD"
    lines = []
    ok = True
    if hcode != 0 or len(head) != 40:
        ok = False
        lines.append("head SHA could not be read: %s" % hout.strip())
    else:
        lines.append("head: %s" % head)
    if scode != 0:
        ok = False
        lines.append("git status --porcelain failed: %s" % sout.strip())
    elif sout.strip():
        ok = False
        lines.append("working tree is NOT clean:")
        lines.extend("    " + line for line in sout.splitlines())
    else:
        lines.append("working tree clean.")
    return Stage("working tree clean + head SHA", ok, lines, evidence)


def stage_declared_vs_diff(repo, base, declared_path):
    evidence = ("py -3 tools/claim_vs_diff.py HEAD %s --declared %s"
               % (base, declared_path or "<none>"))
    if declared_path is None:
        return Stage("declared files vs real diff", False,
                     ["no --declared file given. Write the paths this "
                      "slice touched, one per line, to a file and pass "
                      "--declared <path>."], evidence)
    try:
        with open(declared_path, encoding="utf-8") as handle:
            declared_text = handle.read()
    except OSError as problem:
        return Stage("declared files vs real diff", False,
                     ["could not read %s: %s" % (declared_path, problem)],
                     evidence)
    status, report = claim_vs_diff.compare(repo, "HEAD", base, declared_text)
    return Stage("declared files vs real diff", status == "match",
                 report.splitlines(), evidence)


def stage_ticket_label(issue):
    evidence = ("gh issue view %d --json labels,title" % issue
               if issue is not None else "none")
    if issue is None:
        return Stage("ticket label state (report-only)", True,
                     ["no --issue given; ticket-label state not checked."],
                     evidence, gates=False, status_word="REPORT")
    data, problem = gh("issue", "view", str(issue), "--json", "labels,title")
    if problem:
        return Stage("ticket label state (report-only)", True,
                     ["gh could not be consulted: %s" % sanitize(problem),
                      "report-only: this never fails the gate - Prime's "
                      "bookkeeping owns the label, not this stage."],
                     evidence, gates=False, status_word="REPORT (gap)")
    labels = [entry.get("name") for entry in data.get("labels", [])]
    title = sanitize(str(data.get("title", "")))
    claimed = "claude" in labels
    lines = ["issue #%d: %s" % (issue, title),
            "claude label: %s" % ("present" if claimed else "absent")]
    return Stage("ticket label state (report-only)", True, lines, evidence,
                gates=False, status_word="REPORT")


def render(stages):
    print("=== ship-check: the executor's pre-signal door "
         "(0.9-M0-S22, #320) ===")
    for stage in stages:
        print("\n--- %s ---" % stage.name)
        for line in stage.lines:
            print(line)
        print("[%s]" % stage.status_word)

    width = max(len(stage.name) for stage in stages)
    print("\n" + "=" * (width + 12))
    for stage in stages:
        print("%-*s %s" % (width + 2, stage.name, stage.status_word))
    print("=" * (width + 12))

    gating = [stage for stage in stages if stage.gates]
    failed = [stage for stage in gating if not stage.ok]
    if failed:
        print("\nNot safe to signal - %d gating stage(s) failed: %s"
             % (len(failed), ", ".join(stage.name for stage in failed)))
        print("Paste this whole block into the completion comment; it "
             "names its own failures and their evidence.")
        return 1
    print("\nAll gating stages passed. Paste this whole block into the "
         "completion comment - it is the exact table, not a remembered "
         "count.")
    return 0


def build_parser():
    parser = argparse.ArgumentParser(
        prog="py -3 tools/ship_check.py",
        description="The mechanical ship-check (0.9-M0-S22, #320): run "
                    "after your last commit and before your terminal "
                    "signal. Its stdout is the ready-to-paste block.")
    parser.add_argument("--declared", default=None,
                        help="path to a file naming the paths this slice "
                             "touched, one per line - the same shape "
                             "claim_vs_diff.py's --declared reads")
    parser.add_argument("--base", default="origin/accounts",
                        help="base ref for the declared-vs-diff "
                             "comparison (default: origin/accounts, per "
                             "AGENTS.md's landing door)")
    parser.add_argument("--issue", type=int, default=None,
                        help="the ticket number, for the report-only "
                             "label-state stage")
    # Suppressed for the reason session_open.py's and fleet_status.py's
    # own --repo/--state are: a real caller never passes either one, and
    # tools/ship_check_suite.py drives this against a fabricated
    # repository instead of the real one.
    parser.add_argument("--repo", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--state", default=None, help=argparse.SUPPRESS)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    repo = os.path.abspath(args.repo or REPO)

    stages = [
        stage_old_gate(repo),
        stage_new_gate(repo, args.state),
        stage_branch_name(repo),
        stage_clean_head(repo),
        stage_declared_vs_diff(repo, args.base, args.declared),
        stage_ticket_label(args.issue),
    ]
    return render(stages)


if __name__ == "__main__":
    sys.exit(main())
