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
  6. The slice's tier (owner ruling 2026-08-21, #402), read from the
     same declared file list by `tools/tier.py`'s in-repo mirror of
     the machine-held rules, and refused when a normal-or-sensitive
     slice's own branch evidence falls short of what the M3 delivery
     shape asks of that tier - no RED commit in range, no
     `--completion` text mentioning a mutation table, or a declared
     page file with no browser-note mention (#403). See "THE
     SLICE-TIER STAGE" below for the whole argument; a trivial-tier
     slice owes none of this.
  7. Ticket label state via `gh` - REPORT-ONLY, and deliberately never
     gates the exit code. This program cannot know whether the
     `claude` label is SUPPOSED to be present or absent at the moment
     it runs (Prime's bookkeeping owns that, per the pack's "Claim
     release" section), and `gh` may simply not be on the machine
     running this - a fork's own posture, the same one
     `tools/fleet_status.py`'s own module docstring argues for its
     TICKETS section. So this stage only ever REPORTS what it read,
     never PASS/FAIL, and a missing `gh` degrades to a labeled gap
     rather than a crash or a silent skip.

Exit 0 iff stages 1-6 all pass; exit 1 if any of them fails. Stage 7
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

THE SLICE-TIER STAGE (0.9-M3-S5, #403)

The M3 delivery shape (owner ruling 2026-08-21, #402) reads a slice's
review path off its declared files, never by hand. `tools/tier.py`
carries the judging rules as an IN-REPO MIRROR of the machine-held
`~/.claude/binder-tools/tier.py` - #403's brief is explicit that this
file is mirrored, not imported, so a fork of this repository keeps the
rule without the operator's home directory. `stage_tier()` below reads
the same `--declared` file stage 5 already reads (through
`claim_vs_diff.parse_declared()`, so a completion's bulleted or
backtick-quoted file list is judged the same way it is compared), then
refuses a normal-or-sensitive slice whose evidence falls short of the
M3 shape's own floor: no RED commit anywhere in the branch's own range
(`base..HEAD`, checked by name against this repository's own commit
convention - a commit subject containing the word "RED", the exact
shape `git log --grep` finds in this project's history), no
`--completion` text mentioning a mutation table, or - only when a
declared path is a page file (the same `apps/web/*.{html,js,css}`
shape `.claude/hooks/dispatch_premise.py` already gates at dispatch
time) - no mention of "browser" in that same text. A trivial-tier
slice owes none of this; the M3 shape's own floor never asks it to.

THE --completion-block MODE (0.9-M0-S5-era ticket #393)

`render()` above is the FULL, verbatim paste block - every subprocess
byte, unabridged, because abridging a subprocess's own output by hand
is the exact failure #320 already exists to end. `--completion-block`
is a SECOND, condensed rendering of the SAME `Stage` objects, sized
for a GitHub comment: one row per stage, the totals each gate stage
already computed (`Stage.counted`), the declared-vs-diff verdict
(`Stage.verdict`), the branch and the full head SHA, and the same
gating pass/fail count `render()`'s own closing line is built from
(`gating_summary()`, the one function both renderers call). Nothing in
the block is a second, hand-derived number: every value it prints is
read off a `Stage` attribute a stage function already set while
computing the SAME fact for the full block, so a mutation that
corrupts a stage's own computed total corrupts both renderings from
one source, never just one of them quietly.
"""

import argparse
import os
import re
import subprocess
import sys

import agent_init
import claim_vs_diff
import tier
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

    The five fields below `status_word` exist for exactly one reader,
    `render_completion_block()` (module docstring: "THE
    --completion-block MODE") - each is the SAME value a stage already
    computed for its own full-output `lines`, carried on the object
    instead of re-parsed back out of text, so the condensed block can
    never disagree with the full one about a fact both describe:
      counted    (total, ok, failed) - the old/new gate stages' own
                 machine-counted tuple (see "THE COUNTED SUMMARY LINE").
      verdict    "match" | "mismatch" | "error" - stage 5's own
                 `claim_vs_diff.compare()` status string.
      branch     the real branch name stage 3 read.
      head_sha   the full 40-character SHA stage 4 read.
      detail     a short, stage-specific one-line summary (the slice
                 tier stage uses this for "<tier>; N sensitive, ...").
    """

    def __init__(self, name, ok, lines, evidence, gates=True,
                 status_word=None, counted=None, verdict=None,
                 branch=None, head_sha=None, detail=None):
        self.name = name
        self.ok = ok
        self.lines = lines
        self.evidence = evidence
        self.gates = gates
        self.status_word = status_word or ("PASS" if ok else "FAIL")
        self.counted = counted
        self.verdict = verdict
        self.branch = branch
        self.head_sha = head_sha
        self.detail = detail


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
                 "%s, captured verbatim above" % label, counted=counted)


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
                 "%s, captured verbatim above" % label, counted=counted)


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
                      % (branch, BRANCH_STANDARD)], evidence, branch=branch)
    return Stage("branch name", True, ["branch: %s" % branch], evidence,
                branch=branch)


def stage_clean_head(repo):
    scode, sout = claim_vs_diff.git(repo, "status", "--porcelain")
    hcode, hout = claim_vs_diff.git(repo, "rev-parse", "HEAD")
    head = hout.strip()
    evidence = "git status --porcelain, git rev-parse HEAD"
    lines = []
    ok = True
    head_sha = None
    if hcode != 0 or len(head) != 40:
        ok = False
        lines.append("head SHA could not be read: %s" % hout.strip())
    else:
        lines.append("head: %s" % head)
        head_sha = head
    if scode != 0:
        ok = False
        lines.append("git status --porcelain failed: %s" % sout.strip())
    elif sout.strip():
        ok = False
        lines.append("working tree is NOT clean:")
        lines.extend("    " + line for line in sout.splitlines())
    else:
        lines.append("working tree clean.")
    return Stage("working tree clean + head SHA", ok, lines, evidence,
                head_sha=head_sha)


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
    except UnicodeDecodeError as problem:
        # F2 (review finding, 2026-08-21): a declared list PowerShell
        # 5.1 wrote with a bare `>` redirect (its own default, UTF-16,
        # not the `-Encoding utf8` shape #387 fixed) is not valid UTF-8
        # at all. Uncaught, that crashed this stage with a bare
        # traceback instead of a named, failed stage - matched to
        # tools/claim_vs_diff.py's own fix for the same gap.
        return Stage("declared files vs real diff", False,
                     ["could not decode %s: %s"
                      % (declared_path, problem)], evidence)
    status, report = claim_vs_diff.compare(repo, "HEAD", base, declared_text)
    return Stage("declared files vs real diff", status == "match",
                 report.splitlines(), evidence, verdict=status)


# This repository's own commit-message convention for a contract-first
# commit (git log: "0.9-M2-S16 RED: ...", later "... GREEN: ..."), read
# as a whole word so a subject that merely contains "RED" as a
# substring of some other word ("REDACTED") does not count - and
# case-sensitive, since the convention is always written in caps and a
# lowercase "red" is never the marker in this repository's history.
RED_COMMIT_MARK = re.compile(r"\bRED\b")

# The same "a page a person looks at" shape
# `.claude/hooks/dispatch_premise.py` already gates at dispatch time
# (its own rule 6: a builder order naming these paths must say
# "browser") - reused here rather than re-invented, on a declared path
# already normalized to forward slashes by `claim_vs_diff.parse_declared`.
PAGE_FILE = re.compile(r"^apps/web/[\w.-]+\.(html|js|css)$")


def _has_red_commit(repo, base):
    """Whether any commit subject in `base..HEAD` carries the marker
    above - see RED_COMMIT_MARK's own comment for the convention this
    reads."""
    code, out = claim_vs_diff.git(repo, "log", "%s..HEAD" % base,
                                  "--format=%s")
    if code != 0:
        return False
    return any(RED_COMMIT_MARK.search(subject)
              for subject in out.splitlines())


def stage_tier(repo, declared_path, base, completion_path):
    """The M3 delivery shape's own tier (owner ruling 2026-08-21, #402),
    read from the declared file list by `tools/tier.py` - the in-repo
    mirror of the machine-held rules, see that file's own module
    docstring - and refused when the branch's evidence falls short of
    what the tier owes (#403). See this module's own docstring, "THE
    SLICE-TIER STAGE", for the full argument; a trivial-tier slice
    short-circuits before any evidence is asked for, since the M3
    shape's own floor never asks it of one.
    """
    evidence = ("tools/tier.py judge() + git log %s..HEAD + --completion "
               "text" % base)
    if declared_path is None:
        return Stage("slice tier", False,
                     ["no --declared file given. Write the paths this "
                      "slice touched, one per line, to a file and pass "
                      "--declared <path> - the tier is read from them."],
                     evidence)
    try:
        with open(declared_path, encoding="utf-8") as handle:
            declared_text = handle.read()
    except OSError as problem:
        return Stage("slice tier", False,
                     ["could not read %s: %s" % (declared_path, problem)],
                     evidence)

    # The SAME parser stage 5 already uses (claim_vs_diff.parse_declared),
    # never tools/tier.py's own naive line reader - a completion's real
    # shape is bulleted and backtick-quoted, and re-deriving that parse a
    # second, simpler way here would judge the identical declared list
    # differently between the two stages that both read it.
    paths = sorted(claim_vs_diff.parse_declared(declared_text))
    tier_name, judged = tier.tier_of(paths)

    lines = ["tier: %s" % tier_name]
    for path, judged_tier, why in judged:
        lines.append("  %-9s %s  (%s)" % (judged_tier, path, why))
    n_sensitive = sum(1 for _, t, _ in judged if t == "sensitive")
    n_trivial = sum(1 for _, t, _ in judged if t == "trivial")
    n_normal = sum(1 for _, t, _ in judged if t == "normal")
    lines.append("%d sensitive, %d trivial, %d normal path(s) judged"
                 % (n_sensitive, n_trivial, n_normal))

    if tier_name == "trivial":
        lines.append("")
        lines.append("trivial tier: no RED-commit, mutation-table or "
                     "browser-note evidence required.")
        return Stage("slice tier", True, lines, evidence, detail="trivial")

    problems = []
    if not _has_red_commit(repo, base):
        problems.append(
            "no RED commit found in HEAD's own range since %s - a %s "
            "slice needs a contract-first RED commit (this "
            "repository's own convention: a commit subject containing "
            "the word RED)." % (base, tier_name))

    completion_text = None
    if completion_path is None:
        problems.append(
            "no --completion given - a %s slice's mutation-table (and "
            "any browser-note) evidence has to be confirmed from the "
            "completion text. Write your completion draft to a file "
            "and pass --completion <path>." % tier_name)
    else:
        try:
            with open(completion_path, encoding="utf-8") as handle:
                completion_text = handle.read()
        except OSError as problem:
            problems.append("could not read --completion %s: %s"
                            % (completion_path, problem))

    if completion_text is not None:
        if not re.search(r"\bmutation\b", completion_text, re.I):
            problems.append(
                "no mention of 'mutation' in the --completion text - a "
                "%s slice's mutation battery belongs in the completion."
                % tier_name)
        page_files = [path for path, judged_tier, _why in judged
                     if PAGE_FILE.match(path)]
        if page_files and not re.search(r"\bbrowser\b", completion_text,
                                        re.I):
            problems.append(
                "declared page file(s) changed (%s) and the "
                "--completion text never says 'browser' - a real-"
                "browser pass is owed before READY."
                % ", ".join(page_files))

    if problems:
        lines.append("")
        lines.extend(problems)
        return Stage("slice tier", False, lines, evidence, detail=tier_name)
    lines.append("")
    lines.append("evidence matches the %s tier." % tier_name)
    return Stage("slice tier", True, lines, evidence, detail=tier_name)


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


def gating_summary(stages):
    """(gating stages, the ones that passed, the ones that failed) - the
    ONE place both `render()` and `render_completion_block()` read the
    pass/fail totals from (module docstring, "THE --completion-block
    MODE"), so the two renderings of the same run can never disagree
    about how many stages passed."""
    gating = [stage for stage in stages if stage.gates]
    passed = [stage for stage in gating if stage.ok]
    failed = [stage for stage in gating if not stage.ok]
    return gating, passed, failed


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

    _gating, _passed, failed = gating_summary(stages)
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


def _stage_detail(stage):
    """The one-line detail printed beside a stage's status word in the
    completion block - always a value the STAGE ITSELF already
    computed (module docstring, "THE --completion-block MODE"), never a
    second calculation this function performs on its own. Checked in
    the order a reader would want it: a gate's own counted total first,
    then a verdict word, then a stage-specific detail string."""
    if stage.counted is not None:
        total, ok, failed = stage.counted
        return "%d total, %d ok, %d FAILED" % (total, ok, failed)
    if stage.verdict is not None:
        return stage.verdict.upper()
    if stage.detail is not None:
        return stage.detail
    return ""


def _slug_from_branch(branch):
    """`0.9-m3-s5` -> `0.9-M3-S5` - the exact naming-standard transform
    AGENTS.md's table describes (branch lowercase; issue title, PR
    title and every other string uppercase M/S). Falls back to the raw
    branch name when it does not match the standard so the block still
    renders something readable instead of crashing on a scratch name -
    `stage_branch_name()` already fails the branch-name stage in that
    case; this is display only."""
    if not _branch_ok(branch):
        return branch
    milestone, _sep, tail = branch[len("0.9-m"):].partition("-s")
    return "0.9-M%s-S%s" % (milestone, tail)


def render_completion_block(stages):
    """The condensed, GitHub-comment-shaped block #393 asks for - see
    the module docstring's "THE --completion-block MODE" for why every
    value here is read off a `Stage` attribute a stage already computed
    for the full block above, never re-derived."""
    branch_stage = next((s for s in stages if s.name == "branch name"),
                        None)
    clean_stage = next(
        (s for s in stages if s.name == "working tree clean + head SHA"),
        None)
    branch = branch_stage.branch if branch_stage else None
    head_sha = clean_stage.head_sha if clean_stage else None
    slug = _slug_from_branch(branch) if branch else "ship-check"

    lines = ["=== %s: ship-check completion block ===" % slug]
    if branch:
        lines.append("branch: %s" % branch)
    if head_sha:
        lines.append("head:   %s" % head_sha)
    lines.append("")

    width = max(len(stage.name) for stage in stages)
    for stage in stages:
        detail = _stage_detail(stage)
        row = "%-*s %-7s" % (width + 2, stage.name, stage.status_word)
        if detail:
            row += "  (%s)" % detail
        lines.append(row)

    gating, passed, failed = gating_summary(stages)
    lines.append("")
    lines.append("%d/%d gating stage(s) passed."
                 % (len(passed), len(gating)))
    if failed:
        lines.append("NOT ready to paste - failed: %s"
                     % ", ".join(stage.name for stage in failed))
    else:
        lines.append("READY TO PASTE.")
    print("\n".join(lines))
    return 1 if failed else 0


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
    parser.add_argument("--completion", default=None,
                        help="path to your drafted completion text - the "
                             "slice-tier stage reads it for a mutation-"
                             "table mention and, when a declared path is "
                             "a page file, a browser-note mention (#403)")
    parser.add_argument("--completion-block", action="store_true",
                        help="print the condensed, GitHub-comment-sized "
                             "block instead of the full verbatim output "
                             "(#393) - run this ONCE per signal, ALONGSIDE "
                             "a plain run, and paste both")
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
        stage_tier(repo, args.declared, args.base, args.completion),
        stage_ticket_label(args.issue),
    ]
    if args.completion_block:
        return render_completion_block(stages)
    return render(stages)


if __name__ == "__main__":
    sys.exit(main())
