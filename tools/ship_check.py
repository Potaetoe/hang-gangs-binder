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
  7. Hand-typed gate totals in the `--completion` draft vs what stages
     1 and 2 of THIS SAME RUN actually printed (0.9-M3-S16, #421) - a
     claim like "34/34 stages ok" is scanned out of the draft and
     graded against the counted totals stage 1/2 already computed, so
     a wrong hand-typed number is a FAILED stage rather than something
     only a reviewer catches. See "THE HAND-TYPED TOTALS STAGE" below
     for the whole argument.
  8. Ticket label state via `gh` - REPORT-ONLY, and deliberately never
     gates the exit code. This program cannot know whether the
     `claude` label is SUPPOSED to be present or absent at the moment
     it runs (Prime's bookkeeping owns that, per the pack's "Claim
     release" section), and `gh` may simply not be on the machine
     running this - a fork's own posture, the same one
     `tools/fleet_status.py`'s own module docstring argues for its
     TICKETS section. So this stage only ever REPORTS what it read,
     never PASS/FAIL, and a missing `gh` degrades to a labeled gap
     rather than a crash or a silent skip.

Exit 0 iff stages 1-7 all pass; exit 1 if any of them fails. Stage 8
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
M3 shape's own floor: no RED-marked commit in the branch's own range
(`base..HEAD`) whose OWN diff also touches a real arm (tests/, dev/,
or a tools/*_suite.py file - review F1(c), #393: a commit that merely
SAYS "RED" and touches nothing is not contract-first), no real
mutation-battery evidence in the `--completion` text, or - only when a
declared path is a page file (the same `apps/web/*.{html,js,css}`
shape `.claude/hooks/dispatch_premise.py` already gates at dispatch
time) - no real browser-verification evidence in that same text.
"Real evidence" is deliberately NOT a bare word match (review F1,
#393: the first cut tested for the word "mutation"/"browser" anywhere
in the text, which a denial like "I did NOT run a mutation battery"
satisfies and honest plural prose like "five mutations" fails) - see
the MUTATION_*/BROWSER_* regexes and `_has_mutation_evidence()`/
`_has_browser_evidence()` below for the actual shape asked for. A
trivial-tier slice owes none of this; the M3 shape's own floor never
asks it to.

THE HAND-TYPED TOTALS STAGE (0.9-M3-S16, #421; widened in the fix wave
that landed the same ticket after review)

On 2026-08-21 the S12 completion (#418) wrote "34/34 stages ok" three
times while its OWN pasted ship-check block, in the same comment, said
"35 stages, 35 ok, 0 FAILED" - the reviewer caught it, not this
program. 0.9-M3-S5 already taught this file to read the `--completion`
draft for mutation-table and browser-note MENTIONS (see "THE SLICE-TIER
STAGE" above); `stage_totals()` below is the same reading aimed at
NUMBERS instead of words - it never invents a total of its own to check
a claim against, it only compares a claim already sitting in the draft
against a total THIS SAME RUN already computed for stage 1 or 2.

The first cut FAILED numbers the same run had itself printed (fix-wave
review F1, #421): a bare "145 checks" claim was graded only against the
two GATE summary totals, never against the twenty-nine individual
per-suite counts `tests/run.mjs`'s own arm rows print in the very same
run - so a completion quoting its own run's real output, verbatim, lost
to its own gate. The rule below is the corrected one.

WHAT COUNTS AS A CLAIM, AND WHAT NEVER DOES

  - a PER-FILE claim: an arm path (`tests/*.test.mjs`, `dev/*.test.py`,
    `tools/*_suite.py`) sitting near an "N checks" phrase - close (within
    twenty characters, either order: "tests/door.test.mjs - 30 checks" or
    "30 checks in tests/door.test.mjs"), or further off but still the
    same claim's own subject (fix-wave F1: "a claim naming a test file
    anywhere in the same sentence or bullet is graded per-file rather
    than bare") - up to 150 characters BACKWARD (crossing a newline on
    purpose: an arm's row and its own "N checks, M failure(s))" detail
    line are two lines in `tests/run.mjs`'s own output, exactly the
    shape a builder pastes verbatim), or 40 characters FORWARD but never
    past the end of the current line (a wrong, unrelated arm's row
    starting on the very next line sits closer in raw characters than
    the correct, PRECEDING arm a multi-line detail belongs to - forward
    search stays inside one line so it can never reach across that
    boundary by mistake). Graded first against that ARM's own printed
    verdict line in this run's captured stage 1/2 output
    (`tests/run.mjs`'s own `report()` prints an arm's own last-printed
    line right under its row on a green arm); when that number does not
    match (or the run showed no row for that arm at all) the SAME number
    is checked against the wide pool below before being called wrong -
    a proximity heuristic can attach a real, correct number to the
    WRONG nearby file, and "the number is real, just not proven for
    THIS file" is graded a match, never a mismatch (see "THE WIDE CHECK
    POOL" below). Only when the number matches nothing anywhere - not
    that file's own row, not the wide pool - and that file DID print
    its own row, is it a FAILED per-file mismatch. When the run showed
    no row for that file at all AND the number is not in the wide pool,
    the claim is UNVERIFIED, never FAILED: this run simply cannot answer
    for a number it never printed.
  - a PAIR claim: "N/N" or "N of N", within forty characters of one of
    the trigger words (check, gate, stage, arm, suite) - graded as
    "claimed N2 total, N1 ok" against whichever gate's own totals the
    nearby trigger word names. EXCLUDED when the fraction is an ORDINAL,
    not a total - see "ORDINALS ARE NOT TOTAL CLAIMS" below.
  - a bare UNIT claim: "N stages", "N arms", or "N checks" - graded the
    same way, against the totals the unit word itself names.

"stage" claims read the OLD gate's own totals only - its own summary
line (`stage_old_gate()`) literally says "stages" - UNLESS the trigger
word is specifically "gating stage(s)" (see "THE GATING-STAGE META
CLAIM" below), a different total. "arm" claims read the NEW gate's
only - its own summary line (`stage_new_gate()`) literally says "arms".
Neither claim shape has to guess which gate it is about; it is reading
the gate's own word back. A "check"/"gate"/"suite" claim (or a pair
claim whose only nearby trigger word is one of those three) is not
anchored to either gate's own vocabulary, so it is graded against THE
WIDE POOL below - a match on any printed count of that unit is a match,
and a claim that matches none of them is FAILED: an un-anchored number
is unverifiable, and unverifiable is not the same as unclaimed, which
is why this stage does not let it through quietly.

THE WIDE CHECK POOL (fix-wave F1, #421)

A "check" claim - bare, or per-file once its own file's row disagrees
or never ran - is checked against EVERY total this run printed for that
unit, not only the two gate summaries: the old gate's own stage total,
the 0.9 gate's own arm total, AND every individual suite's own printed
count (`tests/run.mjs`'s per-arm "OK - N checks" or "N checks, M
failure(s))" detail line, read the same way `_printed_count_for_path()`
already reads one arm's own line, just for every arm at once). A claim
that equals ANY of those passes; the ticket's own words are the rule:
"a claim that equals any printed total of the same unit passes... only
a claim that contradicts the printed total of its own unit fails."
Matching is on the TOTAL alone (never the ok/failed split) for this
bucket on purpose - the pool mixes numbers from very different printed
shapes (a bordered fence's row count, a JS arm's own free-text detail
line), and inventing a uniform ok/failed reading across all of them
would be a second, less-trustworthy parse standing in for the one this
file already trusts elsewhere. The accepted cost (recorded, not chased,
per this ticket's own review F3): an unrelated arm's check count that
happens to equal another printed total is accepted as proof by
coincidence. Narrowing the pool to prevent that reopens the exact
false-MISMATCH failure this fix wave exists to end - see F3's own
report on issue #421 for the full argument for leaving it be.

ORDINALS ARE NOT TOTAL CLAIMS (fix-wave F2, #421)

"stage 1 of 2", "part 3/4", "step 2/5" - this repository posts split
ship-check pastes routinely ("part 2/4", "part 1 of 3") and labels
which stage of a multi-slice batch a completion is ("this slice is
stage 1 of 2"); neither names a gate total. The distinguishing shape is
WORD ORDER: a genuine total claim always has the NUMBERS first and the
unit word after ("34/34 stages", "arms: 29/29 green" - the colon or
space before the fraction is not a bare word glued to it); an ordinal
has the WORD immediately before the smaller number, no separator but
whitespace ("stage 1 of 2", "(part 3/4)"). `_is_ordinal()` checks the
fifteen characters immediately before a pair claim's own fraction for
one of `part`/`step`/`stage`/`arm`/`check`/`suite`/`gate` (optionally
plural) followed only by whitespace to the fraction - a colon or any
other character in between breaks the match, which is exactly what
keeps "stages: 35/35 ok" (a real total) apart from "stage 1 of 2" (not
one). An excluded ordinal produces NO claim at all, not an unverified
one - it was never a claim about a total to begin with.

THE GATING-STAGE META CLAIM (fix-wave F1, #421)

`render_completion_block()`'s own closing line - "7/7 gating stage(s)
passed." - is the exact line this file tells a builder to paste, and
the ticket names it directly: "the one it tells builders to paste -
must pass its own stage." The word "stage" there is NOT the old gate's
35 stages; it is THIS program's own count of its gating stages (the
ones with `gates=True` - everything except the report-only ticket-label
stage). `_normalize_unit()` recognizes the two-word phrase "gating
stage(s)" (not bare "stage") and grades it against a THIRD, separate
total: `sum(1 for s in prior_stages if s.gates) + 1` - the gating
stages already built by the time `stage_totals()` runs, plus one for
`stage_totals()` itself (which always gates too). This count is
structural, not self-referential - it is the same arithmetic
`gating_summary()` performs at render time, counted here from the same
`gates` flags, never a fresh number invented for this one comparison.

NEVER A FRESH TOTAL

This stage's own printed lines are prose - "claimed X, this run printed
Y" - never a bare "N/M" or "N checks" of its own. Printing one more
total here would hand a tired human a FOURTH number to copy, on top of
the two gates' own two, which is the exact failure this ticket exists
to end, one level up from where it already happened once.

THE --completion-block MODE (0.9-M0-S5-era ticket #393)

`render()` above is the FULL, verbatim paste block - every subprocess
byte, unabridged, because abridging a subprocess's own output by hand
is the exact failure #320 already exists to end. `--completion-block`
ADDS a SECOND, condensed rendering of the SAME `Stage` objects, sized
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

ONE RUN, NOT TWO (review F4, #393)

The first cut had `--completion-block` REPLACE the full output, which
meant an executor had to run this program TWICE per signal - once
plain, once with the flag - to get both pastes a completion needs. Two
separate process runs can disagree even on an unchanged tree (a flaky
arm caught by one run and not the other), which is the exact
hand-abridgement disease this file exists to end, moved one level
down. `main()` below now builds the `stages` list exactly ONCE per
invocation and hands that SAME list to `render()` always, then ALSO to
`render_completion_block()` when `--completion-block` is passed - one
gate execution, both renderings, guaranteed to agree because there is
only one set of `Stage` objects for both to read.
"""

import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

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

# Review F1(c), #393: a RED-marked commit subject is not itself
# contract-first evidence - the reviewer built one whose subject said
# "RED" and whose diff touched a page file and nothing else. A marker
# only counts when the SAME commit's own diff also reaches a real arm:
# a test file, dev/ (this repository's older suite home), or a
# tools/*_suite.py module.
RED_ARM_PATH = re.compile(r"^tests/|^dev/|^tools/[^/]*_suite\.py$")

# The same "a page a person looks at" shape
# `.claude/hooks/dispatch_premise.py` already gates at dispatch time
# (its own rule 6: a builder order naming these paths must say
# "browser") - reused here rather than re-invented, on a declared path
# already normalized to forward slashes by `claim_vs_diff.parse_declared`.
PAGE_FILE = re.compile(r"^apps/web/[\w.-]+\.(html|js|css)$")


def _red_commit_shas(repo, base):
    """[sha, ...] for every commit in `base..HEAD` whose subject carries
    RED_COMMIT_MARK, oldest-first order not guaranteed - only membership
    matters to `_red_commit_touches_arm()` below."""
    code, out = claim_vs_diff.git(repo, "log", "%s..HEAD" % base,
                                  "--format=%H %s")
    if code != 0:
        return []
    shas = []
    for line in out.splitlines():
        commit_sha, _sep, subject = line.partition(" ")
        if RED_COMMIT_MARK.search(subject):
            shas.append(commit_sha)
    return shas


def _red_commit_touches_arm(repo, shas):
    """Whether any commit in `shas` touches a real arm path
    (RED_ARM_PATH) in its OWN diff - review F1(c) (#393): a marker that
    marks nothing is not contract-first. Reads each candidate commit's
    own `git show --name-only`, never the branch's net two-endpoint
    diff, so a RED commit whose file was later reverted by a different
    commit still counts (the marker's own change is what is being asked
    about, not what survives to HEAD)."""
    for commit_sha in shas:
        code, out = claim_vs_diff.git(repo, "show", "--name-only",
                                      "--format=", commit_sha)
        if code != 0:
            continue
        touched = (line.strip().replace("\\", "/")
                  for line in out.splitlines() if line.strip())
        if any(RED_ARM_PATH.search(path) for path in touched):
            return True
    return False


# Review F1 (#393): the ORIGINAL checks tested for the bare word
# "mutation"/"browser" anywhere in the completion text - a denial
# ("I did NOT run a mutation battery") and a bare label ("mutation
# browser") both matched, and honest plural prose ("five mutations",
# "browsers") FAILED because \b...\b sits against the plural "s". Every
# regex below is built against the reviewer's own five test rows
# (tools/ship_check_suite.py, "F1 (#393): evidence-shape").
#
# Mutation evidence needs the WORD, not inside a negation clause, PLUS
# one of: a counted mention ("5 mutations", "five mutations"), a
# markdown table row (`| ... | ... |`), or a red/green (or fail/pass -
# this repository's own completions often say "watched it fail... watched
# it pass" rather than the literal words) result pair near each other.
MUTATION_WORD = re.compile(r"\bmutations?\b", re.I)
_NEGATION_WORD = re.compile(r"\b(no|not|never)\b|n't\b", re.I)
MUTATION_COUNT = re.compile(
    r"\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+"
    r"mutations?\b", re.I)
# Third finding, 0.9-M3-S22 (#435 comment 5376145722): the original
# pattern (`^\s*\|.*\|.*\|`) matched ANY markdown table row - a file
# list, a declared-paths table, anything with two pipes - so an honest
# prose-only draft with an unrelated table in it passed this check with
# no evidence at all. The row itself is never the evidence; the
# red/green (or fail/pass) SHAPE sitting inside that same row is - so
# the pattern now requires both: at least two pipes (a real row, not
# bare prose) AND the result-pair words inside it, in either order.
MUTATION_TABLE_ROW = re.compile(
    r"^\s*\|.*\|.*\|.*\b(?:red|fail(?:ed)?)\b.*\b(?:green|pass(?:ed)?)\b"
    r"|^\s*\|.*\|.*\|.*\b(?:green|pass(?:ed)?)\b.*\b(?:red|fail(?:ed)?)\b",
    re.M | re.I)
MUTATION_RESULT_PAIR = re.compile(
    r"\b(red|fail(?:ed)?)\b[^.\n]{0,60}\b(green|pass(?:ed)?)\b"
    r"|\b(green|pass(?:ed)?)\b[^.\n]{0,60}\b(red|fail(?:ed)?)\b", re.I)

# Browser evidence needs the WORD, refuses the phrases that mean it did
# NOT happen ("not performed", "no browser", "never opened a browser"),
# and needs a width or device mention - the labeled, geometry-bearing
# claim AGENTS.md's Verification section already rules ("Member pages
# are checked at phone width FIRST"), never the bare word alone.
BROWSER_WORD = re.compile(r"\bbrowsers?\b", re.I)
BROWSER_DENY = re.compile(
    r"\bnot\s+performed\b|\bno\s+browsers?\b"
    r"|\bnever\s+(?:opened|used|ran|tested)\b", re.I)
BROWSER_WIDTH_OR_DEVICE = re.compile(
    r"\bphone\s+width\b|\b\d{3,4}\s*px\b|\bmobile\b|\bdesktop\s+width\b"
    r"|\biphone\b|\bandroid\b|\bviewport\b", re.I)


def _clause_before(text, position, window=40):
    """The text immediately before `position`, trimmed back to the last
    sentence boundary inside `window` characters - the scope a negation
    word has to sit inside to count as negating the match at
    `position`, rather than negating some earlier, unrelated clause."""
    start = max(0, position - window)
    chunk = text[start:position]
    for boundary in (".", "\n", ";"):
        index = chunk.rfind(boundary)
        if index != -1:
            chunk = chunk[index + 1:]
    return chunk


def _has_mutation_evidence(text):
    """Whether `text` carries real mutation-battery evidence - see the
    MUTATION_* regexes' own comment above for the shape asked for."""
    matches = list(MUTATION_WORD.finditer(text))
    if not matches:
        return False
    if all(_NEGATION_WORD.search(_clause_before(text, match.start()))
          for match in matches):
        return False
    return bool(MUTATION_COUNT.search(text)
               or MUTATION_TABLE_ROW.search(text)
               or MUTATION_RESULT_PAIR.search(text))


def _has_browser_evidence(text):
    """Whether `text` carries real browser-verification evidence - see
    the BROWSER_* regexes' own comment above for the shape asked for."""
    if not BROWSER_WORD.search(text):
        return False
    if BROWSER_DENY.search(text):
        return False
    return bool(BROWSER_WIDTH_OR_DEVICE.search(text))


# --------------------------------------------------------------------
# THE PROSE-ONLY PATH (0.9-M3-S22, #435)
#
# 0.9-M3-S20 (#424) was a sensitive-by-path slice (apps/web/signout.js
# is an auth/session module - tier.py's own "Known cost" paragraph: a
# comment-only edit to a sensitive file still tiers sensitive) whose
# every changed line was a comment: four files, 72+/53-, comment-
# stripped sources byte-identical to the base, dist/ hashes unchanged.
# This stage refused it anyway, asking for a RED commit, a mutation
# table and a browser note none of which a prose-only slice honestly
# has. A slice whose declared files are PROVEN unchanged under comment
# or token stripping is stronger evidence than a mutation table: the
# code a mutation would have to break never moved.
#
# WHY JS GOES THROUGH build_web.mjs's OWN jsTokens(), NOT A SECOND
# STRIPPER
#
# tools/build_web.mjs already carries the exact function this needs -
# "the token stream, in order, as types and values" (its own docstring)
# - built for the identical reason: proving two JS sources differ only
# in comments and whitespace, never in what they DO. Re-deriving that a
# second way here would be the second-copy failure this file's own
# module docstring already warns against for claim_vs_diff and
# fleet_status, one level over - `_js_or_css_identical()` below bridges
# to the real function fresh each call instead of reimplementing it.
# Token identity also catches what a bare comment-range strip would
# not always isolate cleanly: a string literal is a token like any
# other, so a change hiding inside one changes the stream and is
# correctly NOT prose (the ticket's own words: "a string-literal
# change is NOT prose - strings are code").
#
# THE BRIDGE ALWAYS READS *THIS* WORKTREE'S OWN build_web.mjs
#
# `BUILD_WEB_MJS` is computed from `REPO` (this file's own directory),
# never from the `repo` a stage is judging - the tokenizer is a tool
# applied to file CONTENT read out of git, not a file that belongs to
# whichever repository (real or, under `ship_check_suite.py`,
# fabricated) is under test.
#
# SQL AND TOML GET A PLAIN LINE-COMMENT STRIP, QUOTE-AWARE
#
# Neither has a parser in this tree, so `_strip_line_comments()` below
# walks the text by hand, tracking whether it is inside a quoted
# string so a comment marker sitting inside one is never mistaken for
# a real comment. Known, accepted cost, the same shape tier.py's own
# docstring names for its own heavier-tier default: a TOML triple-
# quoted string is not specially recognized, so a `#` inside one could
# be misread as a comment opener - rare in this repository's own TOML
# (single-line key/value pairs), and the failure mode is SAFE (a false
# "not identical" falls through to the normal evidence path, never a
# false waiver).
#
# MARKDOWN AND DOCS ARE PROSE BY NATURE
#
# A `.md` file carries no executable code to protect - mutation
# batteries and browser passes exist to guard CODE changes, not prose
# changes. Its "stripped" content is therefore always empty on both
# sides of the comparison, which is a real equality (not a special-
# cased skip) computed by the exact same "compare the stripped text"
# rule every other family uses.
#
# THE DIST/ HALF, FOR A DECLARED PAGE FILE
#
# Token identity alone does not prove the PUBLISHED bytes never moved -
# `tools/build_web.mjs`'s own module docstring: "WHITESPACE IS LEFT
# ALONE", so a whitespace-only reflow beside a comment edit changes
# dist/'s bytes while leaving the token stream identical. A declared
# page file (`PAGE_FILE`) therefore ALSO needs its dist/ mirror's own
# git blob id unchanged between base and HEAD before it counts as
# eligible - the mirror is the byte stream a browser actually
# downloads, so an unchanged blob is stronger proof than a passing
# browser check could ever be that nothing a visitor sees moved.
# --------------------------------------------------------------------

PROSE_JS_EXT = (".js",)
PROSE_CSS_EXT = (".css",)
PROSE_SQL_EXT = (".sql",)
PROSE_TOML_EXT = (".toml",)
PROSE_DOC_EXT = (".md", ".markdown")

REPO_TOOLS_DIR = os.path.join(REPO, "tools")
BUILD_WEB_MJS = os.path.join(REPO_TOOLS_DIR, "build_web.mjs")


def _prose_family(path):
    """"js" / "css" / "sql" / "toml" / "doc", or None for an extension
    this stage has no stripper for. None always disqualifies the whole
    prose-only path (see `_prose_only_verdict()`) - the safe default
    when this stage cannot prove a file's code never moved."""
    ext = "." + path.rsplit(".", 1)[-1].lower() if "." in path else ""
    if ext in PROSE_JS_EXT:
        return "js"
    if ext in PROSE_CSS_EXT:
        return "css"
    if ext in PROSE_SQL_EXT:
        return "sql"
    if ext in PROSE_TOML_EXT:
        return "toml"
    if ext in PROSE_DOC_EXT:
        return "doc"
    return None


def _strip_line_comments(text, marker, quotes):
    """`text` with every `marker`-to-end-of-line run removed, except one
    sitting inside a quoted string - any character in `quotes` opens
    one, a backslash escapes the next character inside it, and the
    same quote character closes it. The shared engine behind the SQL
    (`--`) and TOML (`#`) families - see this section's own comment for
    the one known gap (a TOML triple-quoted string)."""
    out = []
    i, n = 0, len(text)
    mlen = len(marker)
    while i < n:
        ch = text[i]
        if ch in quotes:
            quote = ch
            out.append(ch)
            i += 1
            while i < n:
                out.append(text[i])
                if text[i] == "\\" and i + 1 < n:
                    out.append(text[i + 1])
                    i += 2
                    continue
                if text[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if text[i:i + mlen] == marker:
            newline = text.find("\n", i)
            if newline == -1:
                i = n
            else:
                out.append("\n")
                i = newline + 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _sha_of(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


# The bridge script's own dynamic import needs a URL, not a raw Windows
# path (`C:\...` is not a valid ESM import specifier) - `pathlib`'s
# `as_uri()` is what turns `BUILD_WEB_MJS` into one before this runs.
_PROSE_JS_BRIDGE = """
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function hash(text) {
  return createHash("sha256").update(text).digest("hex");
}

// `node --input-type=module -e "..." -- a b c` hands this eval'd
// script argv = [node.exe, a, b, c] - no "eval" placeholder the way a
// real script file gets at argv[1], so the four values this call
// passes after `--` start at index 1, not 2 (checked empirically:
// `node --input-type=module -e "console.log(process.argv)" -- js`
// prints exactly two entries, node.exe and "js").
const [family, pathA, pathB, buildWebUrl] = process.argv.slice(1);
try {
  const { jsTokens, cssShape } = await import(buildWebUrl);
  const textA = readFileSync(pathA, "utf-8");
  const textB = readFileSync(pathB, "utf-8");
  const shapeA = family === "js" ? JSON.stringify(jsTokens(textA))
                                  : cssShape(textA);
  const shapeB = family === "js" ? JSON.stringify(jsTokens(textB))
                                  : cssShape(textB);
  process.stdout.write(JSON.stringify({
    ok: true, identical: shapeA === shapeB,
    hashA: hash(shapeA), hashB: hash(shapeB),
  }));
} catch (err) {
  process.stdout.write(JSON.stringify({
    ok: false, error: String((err && err.message) || err),
  }));
}
"""


def _js_or_css_identical(node, family, text_a, text_b):
    """(identical, hash_a12, hash_b12, error_or_None) for two JS or CSS
    texts, read through `tools/build_web.mjs`'s own `jsTokens()` /
    `cssShape()` - see this section's own module comment for why this
    is a bridge to the real function rather than a second
    implementation of it."""
    if node is None:
        return False, None, None, ("node is not on PATH; cannot run the "
                                   "JS/CSS tokenizer.")
    if not os.path.isfile(BUILD_WEB_MJS):
        return False, None, None, ("%s is not in this worktree."
                                   % BUILD_WEB_MJS)
    fd_a, path_a = tempfile.mkstemp(suffix=".prose-a.txt")
    fd_b, path_b = tempfile.mkstemp(suffix=".prose-b.txt")
    try:
        with os.fdopen(fd_a, "w", encoding="utf-8", newline="") as handle:
            handle.write(text_a)
        with os.fdopen(fd_b, "w", encoding="utf-8", newline="") as handle:
            handle.write(text_b)
        build_web_url = pathlib.Path(BUILD_WEB_MJS).resolve().as_uri()
        try:
            done = subprocess.run(
                [node, "--input-type=module", "-e", _PROSE_JS_BRIDGE, "--",
                 family, path_a, path_b, build_web_url],
                capture_output=True, text=True, timeout=GATE_TIMEOUT,
                stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            return False, None, None, ("the JS/CSS tokenizer did not "
                                       "answer in time.")
        except OSError as problem:
            return False, None, None, ("the JS/CSS tokenizer could not "
                                       "be run: %s" % problem)
        try:
            result = json.loads(done.stdout.strip() or "{}")
        except ValueError:
            return False, None, None, (
                "the JS/CSS tokenizer printed something this stage could "
                "not read: %s" % (done.stdout + done.stderr)[:300])
        if not result.get("ok"):
            return False, None, None, result.get("error",
                                                  "unknown tokenizer error")
        return (result["identical"], result["hashA"][:12],
               result["hashB"][:12], None)
    finally:
        for path in (path_a, path_b):
            try:
                os.remove(path)
            except OSError:
                pass


def _git_show(repo, ref, path):
    """(content_or_None, missing_reason_or_None) for `path` at `ref` -
    None content means the path does not exist there (a brand-new or
    since-deleted file), which safely disqualifies prose-only for it
    rather than comparing against nothing."""
    code, out = claim_vs_diff.git(repo, "show", "%s:%s" % (ref, path))
    if code != 0:
        return None, "%s does not exist at %s" % (path, ref)
    return out, None


def _git_blob(repo, ref, path):
    """The blob SHA for `path` at `ref`, or None when it does not
    resolve (missing at that ref)."""
    code, out = claim_vs_diff.git(repo, "rev-parse", "-q", "--verify",
                                  "%s:%s" % (ref, path))
    if code != 0:
        return None
    return out.strip()


def _dist_path_for(path):
    """The dist/ mirror of an apps/web page path, or None when `path`
    is not under apps/web/ at all - build_web.mjs's own `plan()` mirrors
    apps/web/<rel> to dist/<rel> 1:1 (that file's own "MODE" table)."""
    prefix = "apps/web/"
    if not path.startswith(prefix):
        return None
    return "dist/" + path[len(prefix):]


def _prose_file_eligible(repo, base, path, node):
    """(eligible, [line, ...]) for one declared file - see this
    section's own module comment for the per-family rule. A page file
    (`PAGE_FILE`) additionally needs its dist/ mirror's blob id
    unchanged, since that mirror is the byte stream a browser actually
    downloads."""
    family = _prose_family(path)
    if family is None:
        return False, ["  prose  %s  no stripper for this extension - "
                       "not eligible." % path]

    if family == "doc":
        lines = ["  prose  %s  markdown/docs - prose by nature, no "
                 "stripping needed." % path]
        identical = True
    else:
        base_text, missing = _git_show(repo, base, path)
        if base_text is None:
            return False, ["  prose  %s  %s - not eligible."
                           % (path, missing)]
        head_text, missing = _git_show(repo, "HEAD", path)
        if head_text is None:
            return False, ["  prose  %s  %s - not eligible."
                           % (path, missing)]

        if family in ("sql", "toml"):
            marker, quotes = (("--", {"'"}) if family == "sql"
                              else ("#", {'"', "'"}))
            stripped_base = _strip_line_comments(base_text, marker, quotes)
            stripped_head = _strip_line_comments(head_text, marker, quotes)
            identical = stripped_base == stripped_head
            lines = ["  prose  %s  base=%s head=%s  %s"
                    % (path, _sha_of(stripped_base), _sha_of(stripped_head),
                       "identical" if identical else "differs")]
        else:  # "js" or "css"
            identical, hash_a, hash_b, error = _js_or_css_identical(
                node, family, base_text, head_text)
            if error:
                return False, ["  prose  %s  %s - not eligible."
                               % (path, error)]
            lines = ["  prose  %s  base=%s head=%s  %s"
                    % (path, hash_a, hash_b,
                       "identical" if identical else "differs")]

    if not identical:
        return False, lines

    if PAGE_FILE.match(path):
        dist_path = _dist_path_for(path)
        blob_base = _git_blob(repo, base, dist_path) if dist_path else None
        blob_head = _git_blob(repo, "HEAD", dist_path) if dist_path else None
        if not dist_path or blob_base is None or blob_head is None:
            lines.append("  dist   %s  %s missing at base or HEAD - not "
                         "eligible." % (path, dist_path or "(no mirror)"))
            return False, lines
        dist_ok = blob_base == blob_head
        lines.append("  dist   %s  %s  base=%s head=%s  %s"
                     % (path, dist_path, blob_base[:12], blob_head[:12],
                        "unchanged" if dist_ok else "changed"))
        if not dist_ok:
            return False, lines

    return True, lines


def _prose_only_verdict(repo, base, paths, node):
    """(eligible, [line, ...]) for the whole declared list - eligible
    only when EVERY declared file is (`_prose_file_eligible()`). One
    non-identical or unsupported file turns the whole path off, per the
    ticket's own rule."""
    lines = []
    all_ok = True
    for path in paths:
        ok, file_lines = _prose_file_eligible(repo, base, path, node)
        lines.extend(file_lines)
        all_ok = all_ok and ok
    if all_ok and paths:
        lines.append("prose-only: %d file(s) identical under comment "
                     "stripping." % len(paths))
    return (all_ok and bool(paths)), lines


def _read_completion_text(path):
    """(text, note_or_None) for a `--completion` draft (F4, review fix
    wave, #421). A draft that is not valid UTF-8 (PowerShell 5.1's
    bare `>` redirect writes UTF-16, not the `-Encoding utf8` shape
    #387 fixed) is a real input this file has to answer for, not a
    crash: `stage_tier()` reads this same file two stages before
    `stage_totals()` gets a turn, with a strict decode whose `except
    OSError` never catches `UnicodeDecodeError` (a `ValueError`, not an
    `OSError`), so a bare traceback there would end the whole run
    before any stage could report a named failure. `errors="replace"`
    never raises: it reads every byte that IS valid UTF-8 and swaps
    each one that is not for U+FFFD, and the returned note says so - a
    completion whose own bytes were silently mangled by whatever wrote
    it is worth flagging to whoever reads this stage's output, even
    though it is no longer fatal to read it."""
    with open(path, encoding="utf-8", errors="replace") as handle:
        text = handle.read()
    note = None
    if "\ufffd" in text:
        note = ("%s contains byte(s) that are not valid UTF-8; they "
                "were replaced with U+FFFD (the replacement character) "
                "before reading - fix the file's encoding." % path)
    return text, note


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

    # THE PROSE-ONLY PATH (0.9-M3-S22, #435) - see this module's own
    # section comment above `_prose_only_verdict()` for the whole
    # argument. Tried before any RED-commit/mutation/browser evidence is
    # asked for: a slice PROVEN unchanged under comment or token
    # stripping (and, for a declared page file, an unchanged dist/ blob)
    # owes none of that evidence at all.
    node = agent_init.find_node()
    prose_ok, prose_lines = _prose_only_verdict(repo, base, paths, node)
    lines.append("")
    lines.extend(prose_lines)
    if prose_ok:
        lines.append("")
        lines.append("prose-only slice: no RED commit, mutation table or "
                     "browser note required - the code either of those "
                     "would guard never moved.")
        return Stage("slice tier", True, lines, evidence, detail=tier_name)

    problems = []
    red_shas = _red_commit_shas(repo, base)
    if not red_shas:
        problems.append(
            "no RED commit found in HEAD's own range since %s - a %s "
            "slice needs a contract-first RED commit (this "
            "repository's own convention: a commit subject containing "
            "the word RED)." % (base, tier_name))
    elif not _red_commit_touches_arm(repo, red_shas):
        problems.append(
            "no RED commit in range touches a real arm - %d commit(s) "
            "carry the word RED in their subject, but none of them "
            "touches tests/, dev/, or a tools/*_suite.py file in its own "
            "diff. A marker that marks nothing is not contract-first."
            % len(red_shas))

    completion_text = None
    completion_note = None
    if completion_path is None:
        problems.append(
            "no --completion given - a %s slice's mutation-table (and "
            "any browser-note) evidence has to be confirmed from the "
            "completion text. Write your completion draft to a file "
            "and pass --completion <path>." % tier_name)
    else:
        try:
            completion_text, completion_note = \
                _read_completion_text(completion_path)
        except OSError as problem:
            problems.append("could not read --completion %s: %s"
                            % (completion_path, problem))

    if completion_note:
        lines.append(completion_note)

    if completion_text is not None:
        if not _has_mutation_evidence(completion_text):
            # Second finding, 0.9-M3-S22 (#435 comment 5375692397): this
            # sentence used to say "a red/green (fail/pass) result pair"
            # - a shape MUTATION_RESULT_PAIR itself matches, so pasting
            # this very refusal into a --completion satisfied the check
            # that produced it. Described here without ever putting a
            # failing word and a succeeding word near each other.
            problems.append(
                "no real mutation-battery evidence in the --completion "
                "text - a %s slice's mutation battery needs a count of "
                "mutations, a markdown table row that itself shows a "
                "broken run next to a working one, or a sentence "
                "describing that same before-and-after, not just the "
                "bare word 'mutation' (which also matches inside a "
                "denial like 'no mutation table')." % tier_name)
        page_files = [path for path, judged_tier, _why in judged
                     if PAGE_FILE.match(path)]
        if page_files and not _has_browser_evidence(completion_text):
            problems.append(
                "declared page file(s) changed (%s) and the "
                "--completion text carries no real browser evidence - "
                "a labeled 'browser' claim with a width or device "
                "mention is owed before READY, and a phrase like 'not "
                "performed' or 'no browser' is refused outright."
                % ", ".join(page_files))

    if problems:
        lines.append("")
        lines.extend(problems)
        return Stage("slice tier", False, lines, evidence, detail=tier_name)
    lines.append("")
    lines.append("evidence matches the %s tier." % tier_name)
    return Stage("slice tier", True, lines, evidence, detail=tier_name)


# --------------------------------------------------------------------
# Stage: hand-typed gate totals vs what THIS run printed (0.9-M3-S16,
# #421) - see the module docstring's "THE HAND-TYPED TOTALS STAGE" for
# the whole argument.
# --------------------------------------------------------------------

_TRIGGER_WORD = re.compile(
    r"\b(check|checks|gate|gates|stage|stages|arm|arms|suite|suites)\b",
    re.I)

# Bare unit claims fire only for these three words. "stages" and "arms"
# are the literal words the old/new gate's own summary lines print;
# "checks" is the word this repository's own arms use for their OWN
# internal counts (door.test.mjs's own verdict: "door OK - 45 checks"),
# named explicitly alongside stages/arms in the ticket's own scope.
# "gate"/"suite" stay trigger-only below - "35 gates" and "40 suites"
# are not phrases this repository's convention produces, so treating
# them as claim units would invent a pattern nobody writes rather than
# catch one somebody did.
_UNIT_CLAIM = re.compile(
    r"(?P<n>\d+)\s+(?P<unit>checks?|stages?|arms?)\b", re.I)

# "34/34" or "34 of 34" - the exact shape the S12 completion (#418)
# wrote three times.
_PAIR_CLAIM = re.compile(r"(?P<ok>\d+)\s*(?:/|\bof\b)\s*(?P<total>\d+)",
                         re.I)

_ARM_PATH = (r"(?:tests/[\w.-]+\.test\.mjs|dev/[\w.-]+\.test\.py"
            r"|tools/[\w.-]+_suite\.py)")
_ARM_PATH_RE = re.compile(_ARM_PATH, re.I)

_PER_FILE_CLAIM = re.compile(
    r"(?P<path1>%s)[^\n]{0,20}?(?P<n1>\d+)\s+checks?"
    r"|(?P<n2>\d+)\s+checks?[^\n]{0,20}?(?P<path2>%s)"
    % (_ARM_PATH, _ARM_PATH), re.I)

_PROXIMITY_WINDOW = 40

# Fix-wave F1 (review, #421): the SHORT window above ("close, either
# order") only catches a per-file claim sitting right next to its own
# path. It missed two real shapes: `tests/run.mjs`'s own arm-row-then-
# indented-detail-line pastes (path and count on TWO lines, ~40-70
# characters apart), and a hand-written bullet naming its subject up
# front ("`path` - ... (N checks).", review evidence, ~110 characters
# apart). Both widen the search; see the module docstring's "WHAT
# COUNTS AS A CLAIM" for why the window is asymmetric (generous
# backward, tight same-line-only forward) rather than just bigger both
# ways.
_PER_FILE_BACKWARD_WINDOW = 150
_PER_FILE_FORWARD_WINDOW = 40

# Fix-wave F2 (review, #421) names the three phrases below as what
# must NOT fire - "stage 1 of 2", "part 3/4", "step 2/5" - since each
# names a POSITION in a sequence, never a gate total. See the module
# docstring's "ORDINALS ARE NOT TOTAL CLAIMS" for the word-order
# argument this pattern encodes. The ordinal word must sit immediately
# before the fraction with nothing but whitespace between - a colon
# (as in "stages: 35/35 ok", a real total) breaks the match on purpose.
_ORDINAL_PREFIX = re.compile(
    r"\b(?:part|step|stage|arm|check|suite|gate)s?\s*$", re.I)


def _is_ordinal(text, match):
    """Whether the `_PAIR_CLAIM` match `match` is an ordinal ("stage 1
    of 2", "part 3/4") rather than a gate-total claim - see
    `_ORDINAL_PREFIX` above."""
    before = text[max(0, match.start() - 15):match.start()]
    return bool(_ORDINAL_PREFIX.search(before))


# Fix-wave F1 (review, #421): ship-check's OWN "N/N gating stage(s)
# passed." line - the one this file tells a builder to paste - names a
# THIRD total, never the old gate's stage count. See the module
# docstring's "THE GATING-STAGE META CLAIM".
_GATING_PREFIX = re.compile(r"\bgating\s*$", re.I)

# `tests/run.mjs`'s own arm-row shape, matched again here (see
# `_NEW_GATE_ROW` above) so a per-file claim's row lookup reads the
# exact same fence `_count_new_gate_table()` already trusts.
_ARM_ROW = re.compile(r"^(?P<path>\S+\.test\.mjs)\s+(ok|FAILED)\s+\d+\.\d+s$")
_COUNT_IN_LINE = re.compile(r"(\d+)\s+checks?\b", re.I)


def _normalize_unit(text, word, word_start):
    """"stages"/"stage" -> "stage" (or "gating_stage" when the word
    "gating" sits immediately before it - see `_GATING_PREFIX` above);
    "arms"/"arm" -> "arm"; every other trigger word (check(s), gate(s),
    suite(s)) -> "check", the not-anchored-to-either-gate bucket the
    module docstring's "WHAT COUNTS AS A CLAIM" describes. `word_start`
    is the START of `word` inside `text` - a bare offset rather than a
    match object, since the two call sites read it out of two different
    match shapes (the nearest `_TRIGGER_WORD` for a pair claim; a bare
    unit claim's own captured "unit" group) and only the offset, not
    the match itself, is what the "gating" lookback needs."""
    word = word.lower()
    if word.startswith("stage"):
        before = text[max(0, word_start - 12):word_start]
        if _GATING_PREFIX.search(before):
            return "gating_stage"
        return "stage"
    if word.startswith("arm"):
        return "arm"
    return "check"


def _nearest_trigger_word(text, claim_match):
    """The `_TRIGGER_WORD` match closest to `claim_match`, among those
    within `_PROXIMITY_WINDOW` characters either side - or None when
    none is that close.

    Nearest, not first: a short completion draft routinely names BOTH
    gates close together ("stages: 35/35 ok. arms: 2/2 green.") - a
    plain `.search()` over the window always returns the LEFTMOST
    trigger word in the window, which would tag the second pair claim
    ("2/2") with the first claim's own "stages" trigger just because it
    occurs earlier in the text, misreading it as a stage claim instead
    of an arm claim. Picking the trigger word actually closest to the
    number is what "near" means here.
    """
    window_start = max(0, claim_match.start() - _PROXIMITY_WINDOW)
    window_end = min(len(text), claim_match.end() + _PROXIMITY_WINDOW)
    mid = (claim_match.start() + claim_match.end()) / 2
    best, best_distance = None, None
    for candidate in _TRIGGER_WORD.finditer(text, window_start, window_end):
        candidate_mid = (candidate.start() + candidate.end()) / 2
        distance = abs(candidate_mid - mid)
        if best is None or distance < best_distance:
            best, best_distance = candidate, distance
    return best


def _nearest_path_before(text, position):
    """The `_ARM_PATH_RE` match ending nearest to (and at or before)
    `position`, within `_PER_FILE_BACKWARD_WINDOW` characters, or None.
    Allowed to cross a newline on purpose - see `_PER_FILE_BACKWARD_
    WINDOW`'s own comment for why."""
    start = max(0, position - _PER_FILE_BACKWARD_WINDOW)
    best = None
    for match in _ARM_PATH_RE.finditer(text, start, position):
        best = match
    return best.group(0) if best else None


def _nearest_path_after_same_line(text, position):
    """The `_ARM_PATH_RE` match starting nearest to (and at or after)
    `position`, within `_PER_FILE_FORWARD_WINDOW` characters AND never
    crossing a newline - see `_PER_FILE_BACKWARD_WINDOW`'s own comment
    for why forward search stays inside one line (a wrong, unrelated
    arm's row starting on the very next line sits closer in raw
    characters than the correct PRECEDING arm a multi-line detail
    belongs to)."""
    line_end = text.find("\n", position)
    if line_end == -1:
        line_end = len(text)
    end = min(line_end, position + _PER_FILE_FORWARD_WINDOW)
    match = _ARM_PATH_RE.search(text, position, end)
    return match.group(0) if match else None


def _find_claims(text):
    """[claim, ...] found in `text`, most-specific shape first - a
    claim already consumed by a more specific match is never matched
    again by a looser pattern reading the same digits (so "34/34
    stages" is read ONCE, as a pair claim, never also as a bare "34
    stages" unit claim on the second "34")."""
    claims = []
    consumed = []

    def overlaps(span):
        start, end = span
        return any(s < end and start < e for s, e in consumed)

    for match in _PER_FILE_CLAIM.finditer(text):
        if match.group("path1"):
            path, n = match.group("path1"), int(match.group("n1"))
        else:
            path, n = match.group("path2"), int(match.group("n2"))
        consumed.append(match.span())
        claims.append({"kind": "per_file", "quote": match.group(0).strip(),
                       "path": path, "n": n})

    # Fix-wave F1 (review, #421): everything `_PER_FILE_CLAIM` above
    # missed because its own path sat further than twenty characters
    # away - see `_PER_FILE_BACKWARD_WINDOW`'s own comment for the two
    # real shapes this catches.
    for match in _COUNT_IN_LINE.finditer(text):
        span = match.span()
        if overlaps(span):
            continue
        path = (_nearest_path_before(text, match.start())
               or _nearest_path_after_same_line(text, match.end()))
        if path is None:
            continue
        consumed.append(span)
        claims.append({"kind": "per_file", "quote": match.group(0),
                       "path": path, "n": int(match.group(1))})

    for match in _PAIR_CLAIM.finditer(text):
        if overlaps(match.span()):
            continue
        if _is_ordinal(text, match):
            continue
        trigger = _nearest_trigger_word(text, match)
        if trigger is None:
            continue
        consumed.append(match.span())
        claims.append({"kind": "pair", "quote": match.group(0),
                       "ok": int(match.group("ok")),
                       "total": int(match.group("total")),
                       "unit": _normalize_unit(text, trigger.group(0),
                                               trigger.start())})

    for match in _UNIT_CLAIM.finditer(text):
        if overlaps((match.start("n"), match.end("n"))):
            continue
        consumed.append(match.span())
        claims.append({"kind": "unit", "quote": match.group(0),
                       "n": int(match.group("n")),
                       "unit": _normalize_unit(text, match.group("unit"),
                                               match.start("unit"))})

    return claims


def _printed_totals(prior_stages):
    """{"stage": (total, ok, failed) or None, "arm": (...) or None,
    "gating_stage": (total, total, 0)} - the totals THIS RUN's own
    pipeline carries, read off the SAME Stage objects stage 1/2 already
    built for "stage"/"arm" (never re-run, never re-derived - module
    docstring: "NEVER A FRESH TOTAL"); "gating_stage" is this run's own
    structural gating-stage count (module docstring: "THE GATING-STAGE
    META CLAIM") - every already-built prior stage that gates, plus one
    for `stage_totals()` itself, which always gates too."""
    old = next((s for s in prior_stages if s.name.startswith("old gate")),
              None)
    new = next((s for s in prior_stages if s.name.startswith("0.9 gate")),
              None)
    gating_total = sum(1 for s in prior_stages if s.gates) + 1
    return {"stage": old.counted if old else None,
           "arm": new.counted if new else None,
           "gating_stage": (gating_total, gating_total, 0)}


def _printed_count_for_path(prior_stages, path):
    """The check-count THIS run's own captured output printed for arm
    `path`, or None when this run never showed one - the arm's row
    never appeared in stage 1 or 2's captured lines, or its own verdict
    line (printed right after the row on a green arm) carried no
    parseable number. None is the UNVERIFIED case, not a failure."""
    for stage in prior_stages:
        lines = stage.lines
        for index, line in enumerate(lines):
            stripped = line.strip()
            if not (stripped.startswith(path) and _ARM_ROW.match(stripped)):
                continue
            for peek in lines[index + 1:index + 6]:
                found = _COUNT_IN_LINE.search(peek)
                if found:
                    return int(found.group(1))
            return None
    return None


def _all_printed_arm_counts(prior_stages):
    """{path: n, ...} for every arm row this run's own captured output
    showed a parseable check count for - the exact same row+peek
    reading `_printed_count_for_path()` trusts for one path at a time,
    walked over every row at once (fix-wave F1, review, #421)."""
    counts = {}
    for stage in prior_stages:
        lines = stage.lines
        for index, line in enumerate(lines):
            stripped = line.strip()
            match = _ARM_ROW.match(stripped)
            if not match:
                continue
            for peek in lines[index + 1:index + 6]:
                found = _COUNT_IN_LINE.search(peek)
                if found:
                    counts[match.group("path")] = int(found.group(1))
                    break
    return counts


def _check_family_pool(prior_stages, totals):
    """{n: "where this run printed it", ...} - the WIDE pool a "check"
    claim (bare, or per-file once its own file disagrees or never ran)
    is checked against: the old gate's own stage total, the 0.9 gate's
    own arm total, and every individual suite's own printed count
    (fix-wave F1, review, #421; see the module docstring's "THE WIDE
    CHECK POOL"). Gate totals are entered first so a coincidental
    collision with a per-suite count names the gate in the evidence
    line, not the suite - either way it is a real, run-printed number,
    never invented."""
    pool = {}
    if totals.get("stage"):
        pool[totals["stage"][0]] = "the old gate's own stage total"
    if totals.get("arm"):
        pool[totals["arm"][0]] = "the 0.9 gate's own arm total"
    for path, n in _all_printed_arm_counts(prior_stages).items():
        pool.setdefault(n, "%s's own printed count" % path)
    return pool


def _grade_claim(claim, prior_stages, totals, check_pool):
    """(verdict, detail) - verdict is "match", "mismatch" or
    "unverified"; `detail` is the one prose line this stage prints for
    the claim, always "claimed ... - this run printed/prints ...",
    never a fresh total of its own."""
    if claim["kind"] == "per_file":
        printed = _printed_count_for_path(prior_stages, claim["path"])
        if printed == claim["n"]:
            return "match", (
                "match: claimed \"%s\" - this run's own output for %s "
                "says %d checks." % (claim["quote"], claim["path"], printed))
        # Fix-wave F1 (review, #421): a proximity heuristic can attach
        # a real, correct number to the WRONG nearby file - before
        # calling it wrong, ask whether it is true of the run AT ALL,
        # not only of the one file it happened to sit near. See the
        # module docstring's "WHAT COUNTS AS A CLAIM".
        if claim["n"] in check_pool:
            return "match", (
                "match: claimed \"%s\" - %s (%d checks), which this run "
                "did print, even though it is not %s's own line."
                % (claim["quote"], check_pool[claim["n"]], claim["n"],
                   claim["path"]))
        if printed is None:
            return "unverified", (
                "unverified by this run: claimed \"%s\" - this run's "
                "output never showed a parseable check count for %s, and "
                "%d checks matches nothing else this run printed either."
                % (claim["quote"], claim["path"], claim["n"]))
        return "mismatch", (
            "MISMATCH: claimed \"%s\" (%d checks) - this run's own "
            "output for %s says %d checks, and %d checks matches nothing "
            "else this run printed either."
            % (claim["quote"], claim["n"], claim["path"], printed,
               claim["n"]))

    claimed_ok = claim["ok"] if claim["kind"] == "pair" else claim["n"]
    claimed_total = claim["total"] if claim["kind"] == "pair" else claim["n"]

    if claim["unit"] == "check":
        # THE WIDE POOL (fix-wave F1, review, #421) - total only, never
        # ok/failed, and a match on ANY printed count of this unit is a
        # match. See the module docstring's "THE WIDE CHECK POOL".
        if claimed_total in check_pool:
            return "match", (
                "match: claimed \"%s\" - matches %s (%d checks)."
                % (claim["quote"], check_pool[claimed_total], claimed_total))
        if not check_pool:
            return "unverified", (
                "unverified by this run: claimed \"%s\" - this run "
                "printed no check counts at all to compare against."
                % claim["quote"])
        return "mismatch", (
            "MISMATCH: claimed \"%s\" - this run's own output never "
            "printed %d checks anywhere (not the old gate's stage total, "
            "not the 0.9 gate's arm total, and not any single suite's own "
            "count)." % (claim["quote"], claimed_total))

    unit_label = ("ship-check's own gating-stage count"
                 if claim["unit"] == "gating_stage" else claim["unit"])
    counted = totals.get(claim["unit"])
    if counted is None:
        return "unverified", (
            "unverified by this run: claimed \"%s\" - this run printed "
            "no %s totals to compare against." % (claim["quote"], unit_label))
    total, ok, failed = counted
    matched = (total == claimed_total and ok == claimed_ok
              if claim["kind"] == "pair" else total == claimed_total)
    if matched:
        return "match", (
            "match: claimed \"%s\" - matches this run's %s totals "
            "(%d total, %d ok)." % (claim["quote"], unit_label, total, ok))
    return "mismatch", (
        "MISMATCH: claimed \"%s\" - this run printed %s: %d total, %d ok, "
        "%d FAILED." % (claim["quote"], unit_label, total, ok, failed))


def stage_totals(prior_stages, completion_path):
    """Hand-typed gate totals in `--completion` vs what THIS run
    printed (0.9-M3-S16, #421) - see the module docstring's "THE
    HAND-TYPED TOTALS STAGE" for the whole argument. A claim that
    contradicts every printed total of its own unit is a FAILED stage,
    the claim quoted beside the numbers this run actually printed; a
    claim this run has no data at all to grade (its unit's pool is
    empty) is UNVERIFIED, listed but never failing the stage by itself.
    """
    evidence = "regex scan of --completion text vs stage 1/2's own totals"
    if completion_path is None:
        return Stage("hand-typed gate totals", True,
                     ["no --completion given; nothing to check."],
                     evidence, detail="no completion given")
    try:
        text, note = _read_completion_text(completion_path)
    except OSError as problem:
        return Stage("hand-typed gate totals", False,
                     ["could not read %s: %s" % (completion_path, problem)],
                     evidence)

    claims = _find_claims(text)
    if not claims:
        lines = ["no N/N, N of N, N stages, N arms, or N checks claim "
                 "found near check/gate/stage/arm/suite in the "
                 "--completion text - nothing to compare."]
        if note:
            lines.append(note)
        return Stage("hand-typed gate totals", True, lines, evidence,
                     detail="no claims found")

    totals = _printed_totals(prior_stages)
    check_pool = _check_family_pool(prior_stages, totals)
    lines = []
    mismatches = 0
    unverified = 0
    for claim in claims:
        verdict, detail = _grade_claim(claim, prior_stages, totals,
                                       check_pool)
        lines.append(detail)
        if verdict == "mismatch":
            mismatches += 1
        elif verdict == "unverified":
            unverified += 1

    ok = mismatches == 0
    if unverified:
        lines.append("(%d claim(s) unverified - this run produced no "
                     "data to grade them against, which is never counted "
                     "as a mismatch.)" % unverified)
    if note:
        lines.append(note)
    detail = "match" if ok else "%d mismatch(es)" % mismatches
    if unverified:
        detail += ", %d unverified" % unverified
    return Stage("hand-typed gate totals", ok, lines, evidence,
                detail=detail)


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

    # A blank line first - main() prints this right after render()'s own
    # closing lines in the same run (module docstring, "ONE RUN, NOT
    # TWO"), so this is the separator between the two pastes, not just
    # this block's own opening.
    lines = ["", "=== %s: ship-check completion block ===" % slug]
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
                        help="ALSO print a condensed, GitHub-comment-"
                             "sized block after the full verbatim output "
                             "(#393) - one run prints both; paste both "
                             "into the completion")
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

    # Built EXACTLY ONCE regardless of --completion-block (review F4,
    # #393, module docstring's "ONE RUN, NOT TWO") - both renderings
    # below read this same list, so they cannot disagree about a fact
    # this run computed. Built incrementally, not as one list literal,
    # because stage_totals() (0.9-M3-S16, #421) reads stage 1 and 2's
    # OWN already-computed totals - it needs the stages built so far,
    # never a second run of them (module docstring: "NEVER A FRESH
    # TOTAL").
    stages = []
    stages.append(stage_old_gate(repo))
    stages.append(stage_new_gate(repo, args.state))
    stages.append(stage_branch_name(repo))
    stages.append(stage_clean_head(repo))
    stages.append(stage_declared_vs_diff(repo, args.base, args.declared))
    stages.append(stage_tier(repo, args.declared, args.base,
                             args.completion))
    stages.append(stage_totals(list(stages), args.completion))
    stages.append(stage_ticket_label(args.issue))
    code = render(stages)
    if args.completion_block:
        render_completion_block(stages)
    return code


if __name__ == "__main__":
    sys.exit(main())
