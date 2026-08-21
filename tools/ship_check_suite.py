"""Contract checks for the mechanical ship-check (0.9-M0-S22, #320).

    py -3 tools/ship_check_suite.py

WHY THE ARM SITS IN tests/ AND THE ASSERTIONS SIT HERE

The convention 0.9-M0-S7 settled and every Python arm since has
followed: `tests/ship-check.test.mjs` is five lines that find a Python
and hand it this file - the shim is the whole wiring, and every
assertion lives here, beside the module it tests.

WHY THIS BUILDS A REAL GIT REPOSITORY

Three of ship_check.py's six stages read real git state (the current
branch, the clean-tree status, the diff against a base ref), and the
fourth (declared-vs-diff) is a straight pass-through into
claim_vs_diff.compare(), which claim_vs_diff_suite.py already proves
against real git for its own 29 checks - reasserting that logic here
would be the second-copy failure this file's own tools/claim_vs_diff.py
module docstring warns about ("PER AUDIT F10"). So this suite builds
one small fixture repository with real commits, real branches and a
real `origin/accounts` remote-tracking ref, the same way
claim_vs_diff_suite.py and fleet_status_suite.py both do, and drives
ship_check.py's stage functions directly against it.

WHY tools/check.py AND tests/run.mjs ARE STAND-INS, NOT THE REAL ONES

Stage 1 and stage 2 run whatever sits at `<repo>/tools/check.py` and
`<repo>/tests/run.mjs` as real subprocesses and capture their exact
stdout - that captured-verbatim behavior is the entire reason this
ticket exists, so it has to be proven against a REAL subprocess, not
mocked away. Running the actual gates as part of a suite would make
this suite minutes long and would fail for reasons that have nothing
to do with ship_check.py (a linter warning, a slow suite elsewhere) -
so the fixture repository carries two small stand-in scripts instead,
each one line long, each controllable by an environment variable the
same way agent_init_suite.py's own PROBE_SOURCE stand-in is. What is
under test is whether ship_check.py's stage functions capture and
grade a subprocess's real output correctly, which a tiny real
subprocess proves exactly as well as tools/check.py itself would.

WHY agent_init.initialization_problems IS MONKEYPATCHED, NOT REBUILT

Stage 2 first asks `agent_init.initialization_problems()` whether the
worktree counts as initialized - that function's own contract (eol
scan, dependency probe, record shape) already has 119 checks of its
own in tools/agent_init_suite.py, and reproducing the fixture that
produces a genuinely uninitialized worktree here (a stale eol state, a
missing node_modules) would be the same second-copy failure this
docstring's earlier paragraph names, one function over. What THIS
suite is answerable for is only what ship_check.py's stage_new_gate()
DOES with that function's answer - runs the gate on an empty list,
short-circuits to a "not initialized" row on a non-empty one, and
never lets the gate run in the second case even when it would have
passed - so the function is monkeypatched for the width of one call
each time, proving the routing rather than re-proving the routed-to
function.

WHY gh IS A STUB SCRIPT RATHER THAN A MOCK OBJECT

Same argument fleet_status_suite.py's own module docstring makes for
its own gh stub, one file over: tools/fleet_status.py (and this file,
importing its gh() and sanitize()) never imports a gh client, it
shells out - BINDER_GH_CMD replaces the `["gh"]` prefix with an
arbitrary command, so the fixture is a small, real, standalone script
this suite writes to disk and invokes as a real subprocess, proving
the actual seam rather than a shortcut through Python object identity.

Self-contained on purpose, matching every existing suite in this
fleet: no import from dev/, no framework, no new dependency, and
nothing imported from any sibling *_suite.py (each one runs its own
checks at import time, unguarded by `if __name__ == "__main__"`, so
importing one would run it as a side effect of running this one).

0.9-M3-S5 (#393 + #403): TWO ADDITIONS TO THIS SAME FIXTURE, WHY THE
FIXTURE'S OWN TIP COMMIT NOW SAYS "RED"

`stage_tier()` reads the same declared-file-list shape stage 5 already
reads, judges it against `tools/tier.py` (the in-repo mirror of the
machine-held rules - see that file's own module docstring for why it
is a mirror and not an import), and refuses a normal-or-sensitive
slice whose branch carries no RED commit, or whose `--completion` text
never mentions a mutation table, or - when a declared path is a page
file - never says "browser". Every existing fixture branch in this
file already carries exactly one commit ahead of `origin/accounts`
("0.9-m0-s22 RED: fixture slice change"), so that one commit is now
also the POSITIVE fixture for the RED-commit check everywhere it is
reused - a second branch is needed only for the NEGATIVE case (a
commit that never says RED at all), built fresh, checked out, tested,
and torn down inside the tier section below without disturbing
`tip_sha`'s meaning for every test after it.

`render_completion_block()` (`--completion-block`) is the condensed,
GitHub-comment-shaped block #393 asks for - the stage table, the head
SHA, the branch, the declared-vs-diff verdict, and the gating pass
count, all read from the SAME `Stage` objects `render()` already
prints from (`stage.counted`, `stage.verdict`, `stage.branch`,
`stage.head_sha`), never re-derived by a second calculation. That
single-source property is what "arm the block's totals" means below: a
mutation that corrupts a counted tuple corrupts both output shapes
identically, so the block-mode assertions below are exercised through
the SAME fixture-stub scenarios ("pass"/"fail") that already prove
`_count_old_gate_table()`/`_count_new_gate_table()` above, rather than
a second, separately-invented fixture.
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

import agent_init
import ship_check
import tier

failures = 0
performed = 0

# Asserted at the end, not merely printed - the floor every suite in
# this fleet holds itself to: a hand-counted total nothing compares
# against still prints a confident pass when a check stops running.
EXPECTED = 162


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


def sha(repo, ref):
    _code, out = git(repo, "rev-parse", ref)
    return out.strip()


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(data)


# The name every working root of this suite is made under, and the
# only name the sweep below will delete.
PREFIX = "ship-check-suite-"

# How old a matching directory must be before the sweep believes it
# belongs to a FINISHED run. This suite takes seconds; the thing it
# protects is a second agent running this file right now, whose
# working root carries the same name by construction.
STALE_AFTER = 3600


def sweep_prior_roots(parent, keep, now=None):
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
        try:
            shutil.rmtree(path)
        except OSError:
            continue
        swept.append(name)
    return swept


class PatchInitProblems:
    """While active, `agent_init.initialization_problems()` returns a
    fixed list regardless of what it is called with - see the module
    docstring's "WHY agent_init.initialization_problems IS
    MONKEYPATCHED" section for why this is the right boundary for this
    suite to sit on."""

    def __init__(self, problems):
        self.problems = problems

    def __enter__(self):
        self._real = agent_init.initialization_problems
        agent_init.initialization_problems = \
            lambda repo, state: list(self.problems)
        return self

    def __exit__(self, *exc_info):
        agent_init.initialization_problems = self._real
        return False


# ----------------------------------------------------------------------
# Fixture repository. One commit on origin/accounts, one real commit on
# top of it touching apps/web/page.html - exactly the shape a slice's
# own branch has, so stage 5 has a real diff to compare declarations
# against.
# ----------------------------------------------------------------------

# Two-row, real-bordered tables - close enough to tools/check.py's own
# `main()` render step (the "="*(width+10) fence printed twice, one
# "<label padded> ok"/"FAILED" row per stage between them) to prove
# ship_check._count_old_gate_table() reads the actual fence and rows,
# not a position or a hand count. Three scenarios, selected by
# SHIP_CHECK_STUB_OLD_GATE:
#   (unset/"pass") both stages ok
#   "fail"         stage two FAILED, no other change
#   "lie"          stage two FAILED too, PLUS a false "999 stages, 999
#                   ok, 0 FAILED" line printed after the real fence -
#                   the mutation this ticket's DoD names: proof the
#                   counted line below is read from the rows, never
#                   from a number sitting in the same captured text.
OLD_GATE_STUB = '''
import os, sys
scenario = os.environ.get("SHIP_CHECK_STUB_OLD_GATE", "pass")
fail = scenario in ("fail", "lie")
results = [("fixture stage one", True), ("fixture stage two", not fail)]
width = max(len(label) for label, _ in results)
print("=== fixture stage one ===")
print("\\n" + "=" * (width + 10))
for label, ok in results:
    print("%-*s %s" % (width + 2, label, "ok" if ok else "FAILED"))
print("=" * (width + 10))
if scenario == "lie":
    print("999 stages, 999 ok, 0 FAILED")
print("\\nAll checks passed." if not fail else "\\nNot safe to push.")
sys.exit(1 if fail else 0)
'''

# Same shape, one level over: two `tests/<name>.test.mjs` rows in
# tests/run.mjs's own report() format (name.padEnd(52) +
# status.padEnd(8) + seconds.toFixed(1) + "s"), so
# ship_check._count_new_gate_table()'s tests/*.test.mjs pattern has a
# real row to match against - never a "fixture arm 1:" line no real
# runner ever prints. Same three scenarios as the old-gate stub above,
# same "lie" meaning: a false "999 arm(s), all green." printed beside
# rows that say otherwise.
NEW_GATE_STUB = '''
const scenario = process.env.SHIP_CHECK_STUB_NEW_GATE || "pass";
const fail = scenario === "fail" || scenario === "lie";
function report(name, ok, ms) {
  console.log(name.padEnd(52) + (ok ? "ok" : "FAILED").padEnd(8) +
    ms.toFixed(1) + "s");
}
report("tests/fixture-one.test.mjs", true, 0.1);
report("tests/fixture-two.test.mjs", !fail, 0.2);
if (scenario === "lie") {
  console.log("999 arm(s), all green.");
} else {
  console.log(fail ? "2 arm(s), 1 problem(s): tests/fixture-two.test.mjs"
                    : "2 arm(s), all green.");
}
process.exit(fail ? 1 : 0);
'''

GH_STUB_SOURCE = '''
import json
import os
import sys

ISSUE = {
    "claimed": {"title": "0.9-M0-S22: mechanical ship-check",
                "labels": [{"name": "claude"}]},
    "unclaimed": {"title": "0.9-M0-S22: mechanical ship-check",
                  "labels": []},
    # A real ESC byte, the same shape fleet_status_suite.py's own
    # "hostile" fixture uses (S20 MAJOR-1) - the outer \\\\x1b here is
    # two backslashes plus "x1b" in THIS file's own source, so it lands
    # as the four characters \\\\x1b in gh_stub.py's source on disk,
    # which Python parses as one real ESC byte when the stub runs.
    "hostile": {"title": "0.9-M0-S22: hostile \\x1b[2J\\x1b[Htitle",
                "labels": [{"name": "claude"}]},
}


def main():
    args = sys.argv[1:]
    scenario = os.environ.get("SHIP_CHECK_STUB_SCENARIO", "claimed")
    if scenario == "boom":
        sys.stderr.write("stub: simulated gh failure\\n")
        return 7
    if args[:2] == ["issue", "view"]:
        print(json.dumps(ISSUE.get(scenario, ISSUE["claimed"])))
        return 0
    sys.stderr.write("stub: unrecognized args %r\\n" % (args,))
    return 9


if __name__ == "__main__":
    sys.exit(main())
'''


def stub_command(stub_path):
    return json.dumps([sys.executable, stub_path])


def build_repo(root):
    repo = os.path.join(root, "repo")
    os.makedirs(repo)
    git(repo, "init", "-q", "-b", "0.9-m0-s22")
    write(os.path.join(repo, "README.md"), "fixture\n")
    write(os.path.join(repo, "tools", "check.py"), OLD_GATE_STUB)
    write(os.path.join(repo, "tests", "run.mjs"), NEW_GATE_STUB)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "base")
    base_sha = sha(repo, "HEAD")
    git(repo, "update-ref", "refs/remotes/origin/accounts", base_sha)

    # Two commits, not one - review F1(c) (#393): a RED-marked commit
    # must also TOUCH a real arm (tests/, dev/, or a tools/*_suite.py
    # file), never just carry the word in its subject. Commit A carries
    # the marker and touches a throwaway test arm; commit B deletes that
    # throwaway file again in the same breath it adds the real fixture
    # page. The NET two-endpoint diff from origin/accounts to the tip
    # (what every existing MATCH/MISMATCH assertion below reads) is
    # therefore unchanged - only apps/web/page.html - while `git log`
    # over the range still carries a RED-marked commit whose OWN
    # `git show --name-only` names a real tests/ path, which is what
    # `_has_red_commit()` now reads.
    write(os.path.join(repo, "tests", "fixture-contract.test.mjs"),
         "// contract placeholder, undone by the next commit\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "0.9-m0-s22 RED: pin the fixture contract")

    write(os.path.join(repo, "apps", "web", "page.html"), "<html></html>\n")
    os.remove(os.path.join(repo, "tests", "fixture-contract.test.mjs"))
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "0.9-m0-s22 GREEN: fixture slice change")
    tip_sha = sha(repo, "HEAD")
    return repo, base_sha, tip_sha


# ----------------------------------------------------------------------

root = tempfile.mkdtemp(prefix=PREFIX)
try:
    parent = os.path.dirname(root)
    swept = sweep_prior_roots(parent, root)
    if swept:
        print("swept %d stale fixture root(s) from a prior run: %s"
             % (len(swept), ", ".join(swept)))

    print("--- _branch_ok: the naming-standard scanner ---")
    check("the canonical form passes", ship_check._branch_ok("0.9-m0-s22"))
    check("multi-digit milestone and slice numbers pass",
          ship_check._branch_ok("0.9-m12-s345"))
    check("uppercase fails - the standard is lowercase",
          not ship_check._branch_ok("0.9-M0-S22"))
    check("a missing -s segment fails",
          not ship_check._branch_ok("0.9-m0"))
    check("an empty slice number fails",
          not ship_check._branch_ok("0.9-m0-s"))
    check("an empty milestone number fails",
          not ship_check._branch_ok("0.9-m-s1"))
    check("trailing junk after the slice number fails - a fix-wave "
         "suffix does not become part of the naming standard",
          not ship_check._branch_ok("0.9-m0-s22-fw2"))
    check("an unrelated name fails", not ship_check._branch_ok("main"))

    repo, base_sha, tip_sha = build_repo(root)

    print("\n--- stage 3: branch name ---")
    git(repo, "branch", "0.9-M0-S22-bad-case", tip_sha)
    git(repo, "checkout", "-q", "0.9-M0-S22-bad-case")
    stage = ship_check.stage_branch_name(repo)
    check("an uppercase branch name fails the naming standard",
          not stage.ok and "does not match" in stage.lines[0])
    check("its evidence names the exact git command read",
          stage.evidence == "git branch --show-current")

    git(repo, "branch", "scratch-work", tip_sha)
    git(repo, "checkout", "-q", "scratch-work")
    stage = ship_check.stage_branch_name(repo)
    check("a scratch name fails too - no scratch names at signal time",
          not stage.ok)

    git(repo, "checkout", "-q", "--detach", tip_sha)
    stage = ship_check.stage_branch_name(repo)
    check("a detached HEAD fails - git branch --show-current answers "
         "empty",
          not stage.ok and "detached" in stage.lines[0])

    git(repo, "checkout", "-q", "0.9-m0-s22")
    stage = ship_check.stage_branch_name(repo)
    check("the correctly-named branch passes, named exactly",
          stage.ok and stage.lines == ["branch: 0.9-m0-s22"])

    print("\n--- stage 4: working tree clean + head SHA ---")
    stage = ship_check.stage_clean_head(repo)
    check("a clean tree at a real commit passes",
          stage.status_word == "PASS")
    check("the full 40-character SHA is printed for direct copy",
          any(line == "head: " + tip_sha for line in stage.lines))

    write(os.path.join(repo, "README.md"), "fixture, modified\n")
    stage = ship_check.stage_clean_head(repo)
    check("an uncommitted edit fails the clean-tree stage",
          not stage.ok)
    check("...and names the dirty file",
          any("README.md" in line for line in stage.lines))
    git(repo, "checkout", "-q", "--", "README.md")

    print("\n--- stage 5: declared files vs real diff ---")
    declared_good = os.path.join(root, "declared-good.txt")
    write(declared_good, "apps/web/page.html\n")
    stage = ship_check.stage_declared_vs_diff(repo, "origin/accounts",
                                              declared_good)
    check("a declared list matching the real diff passes",
          stage.ok and "MATCH" in "\n".join(stage.lines))

    declared_bad = os.path.join(root, "declared-bad.txt")
    write(declared_bad, "some/other/path.txt\n")
    stage = ship_check.stage_declared_vs_diff(repo, "origin/accounts",
                                              declared_bad)
    check("a mismatched declared list fails, both directions named",
          not stage.ok
          and "DECLARED-BUT-UNTOUCHED" in "\n".join(stage.lines)
          and "TOUCHED-BUT-UNDECLARED" in "\n".join(stage.lines))

    stage = ship_check.stage_declared_vs_diff(repo, "origin/accounts", None)
    check("no --declared file given fails with an actionable message, "
         "not a crash",
          not stage.ok and "no --declared file given" in stage.lines[0])

    missing = os.path.join(root, "does-not-exist.txt")
    stage = ship_check.stage_declared_vs_diff(repo, "origin/accounts",
                                              missing)
    check("an unreadable --declared path fails, names why",
          not stage.ok and "could not read" in stage.lines[0])

    print("\n--- an undecodable --declared path (UTF-16, PowerShell "
         "5.1's plain redirection default) fails with a named reason, "
         "not an uncaught UnicodeDecodeError crash (F2, review "
         "finding, 2026-08-21) ---")
    # UnicodeDecodeError is a ValueError, not an OSError - the except
    # clause directly above this one never caught it, so before the
    # fix this call raised straight through stage_declared_vs_diff()
    # and crashed this suite process itself with a bare traceback
    # instead of returning a failed Stage. tools/claim_vs_diff.py's own
    # main() had the identical gap, fixed the identical way.
    declared_utf16 = os.path.join(root, "declared-utf16.txt")
    with open(declared_utf16, "w", encoding="utf-16") as handle:
        handle.write("apps/web/page.html\n")
    stage = ship_check.stage_declared_vs_diff(repo, "origin/accounts",
                                              declared_utf16)
    check("an undecodable --declared path fails with a named reason, "
         "not a crash",
          not stage.ok and "could not decode" in stage.lines[0])

    print("\n--- tier.py: the in-repo mirror of the machine-held rules "
         "(0.9-M3-S5, #403) ---")
    check("server/ files judge sensitive",
          tier.judge("server/worker.js")[0] == "sensitive")
    check("a page-side auth module judges sensitive",
          tier.judge("apps/web/session.js")[0] == "sensitive")
    check("its dist mirror judges sensitive too",
          tier.judge("dist/session.js")[0] == "sensitive")
    check("wrangler.toml judges sensitive regardless of directory depth",
          tier.judge("infra/wrangler.toml")[0] == "sensitive")
    check("a workflow file judges sensitive",
          tier.judge(".github/workflows/deploy.yml")[0] == "sensitive")
    check("store-crypto.js judges sensitive",
          tier.judge("apps/web/store-crypto.js")[0] == "sensitive")
    check("a markdown file judges trivial",
          tier.judge("DESIGN.md")[0] == "trivial")
    check("a tests/ path judges trivial",
          tier.judge("tests/foo.test.mjs")[0] == "trivial")
    check("site.config.js judges trivial",
          tier.judge("apps/web/site.config.js")[0] == "trivial")
    check("its dist mirror judges trivial too",
          tier.judge("dist/site.config.js")[0] == "trivial")
    check("an ordinary page falls through to normal",
          tier.judge("apps/web/your-page.html")[0] == "normal")
    check("an empty path judges nothing - no tier, no crash",
          tier.judge("   ") == (None, ""))
    check("tier_of: one sensitive path outweighs any number of trivial "
         "ones",
          tier.tier_of(["README.md", "server/worker.js",
                        "tests/x.test.mjs"])[0] == "sensitive")
    check("tier_of: all-trivial, non-empty, is trivial",
          tier.tier_of(["README.md", "tests/x.test.mjs"])[0] == "trivial")
    check("tier_of: one normal path among trivials is normal",
          tier.tier_of(["README.md", "apps/web/your-page.html"])[0]
          == "normal")
    check("tier_of: an empty list is normal, never a crash",
          tier.tier_of([])[0] == "normal")

    print("\n--- stage: slice tier - the evidence-below-tier refusal "
         "(0.9-M3-S5, #403) ---")

    # The one negative fixture for "no RED commit in range": a branch off
    # the SAME base whose one commit never says RED, built, tested, and
    # torn down here so `tip_sha` keeps meaning "0.9-m0-s22's own tip"
    # for every test that follows this section.
    git(repo, "branch", "no-red-fixture", base_sha)
    git(repo, "checkout", "-q", "no-red-fixture")
    write(os.path.join(repo, "apps", "web", "other.html"),
         "<html></html>\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "a slice change with no marker at all")
    no_red_declared = os.path.join(root, "declared-no-red.txt")
    write(no_red_declared, "apps/web/other.html\n")

    stage = ship_check.stage_tier(repo, no_red_declared, "origin/accounts",
                                  None)
    check("a normal-tier slice with no RED commit in its range fails, "
         "naming the gap",
          not stage.ok and "no RED commit" in "\n".join(stage.lines))

    trivial_declared = os.path.join(root, "declared-trivial.txt")
    write(trivial_declared, "README.md\ntests/x.test.mjs\n")
    stage = ship_check.stage_tier(repo, trivial_declared, "origin/accounts",
                                  None)
    check("an all-trivial declared list passes with no RED commit and no "
         "--completion needed at all - trivial owes no evidence",
          stage.ok and "tier: trivial" in stage.lines)

    git(repo, "checkout", "-q", "0.9-m0-s22")
    git(repo, "branch", "-D", "no-red-fixture")

    # Review F1(c) (#393): a RED-marked commit that touches NO arm at
    # all is not contract-first. The reviewer's own adversarial fixture,
    # reproduced verbatim: a commit whose subject carries the marker but
    # whose diff never reaches tests/, dev/, or a tools/*_suite.py path.
    git(repo, "branch", "red-no-arm-fixture", base_sha)
    git(repo, "checkout", "-q", "red-no-arm-fixture")
    write(os.path.join(repo, "apps", "web", "other2.html"),
         "<html></html>\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m",
       "0.9-m9-s9 RED: (this commit adds no arm at all)")
    red_no_arm_declared = os.path.join(root, "declared-red-no-arm.txt")
    write(red_no_arm_declared, "apps/web/other2.html\n")
    # Full evidence otherwise (mutation table + browser note) - isolates
    # the finding to the RED-arm check alone, matching the reviewer's own
    # report shape ("evidence matches the normal tier" - for a branch
    # with no arm, no mutation battery and no browser pass).
    honest_completion = os.path.join(root, "completion-honest.txt")
    write(honest_completion,
         "mutation battery: 3 mutations, each red then green.\n"
         "browser: real browser, phone width.\n")
    stage = ship_check.stage_tier(repo, red_no_arm_declared,
                                  "origin/accounts", honest_completion)
    check("a RED-marked commit that touches no test/dev/suite arm at "
         "all still fails - a marker that marks nothing is not "
         "contract-first (review F1(c), #393)",
          not stage.ok and "no RED commit" in "\n".join(stage.lines))

    git(repo, "checkout", "-q", "0.9-m0-s22")
    git(repo, "branch", "-D", "red-no-arm-fixture")

    sensitive_declared = os.path.join(root, "declared-sensitive.txt")
    write(sensitive_declared, "server/worker.js\n")
    stage = ship_check.stage_tier(repo, sensitive_declared,
                                  "origin/accounts", None)
    check("a sensitive-tier slice is held to the RED-commit bar too - "
         "0.9-m0-s22's own tip carries one, so only the missing "
         "--completion should fail it here",
          not stage.ok and "no RED commit" not in "\n".join(stage.lines)
          and "no --completion" in "\n".join(stage.lines))

    stage = ship_check.stage_tier(repo, declared_good, "origin/accounts",
                                  None)
    check("declared_good (apps/web/page.html, normal) fails for the same "
         "reason - RED commit present, no --completion to confirm the "
         "mutation table",
          not stage.ok and "no --completion" in "\n".join(stage.lines))

    completion_no_mutation = os.path.join(root,
                                          "completion-no-mutation.txt")
    write(completion_no_mutation, "browser: checked at phone width.\n")
    stage = ship_check.stage_tier(repo, declared_good, "origin/accounts",
                                  completion_no_mutation)
    check("a completion mentioning browser but never 'mutation' fails, "
         "naming the gap",
          not stage.ok and "mutation" in "\n".join(stage.lines))

    completion_no_browser = os.path.join(root, "completion-no-browser.txt")
    write(completion_no_browser,
         "mutation battery: broke it, watched it fail, restored it, "
         "watched it pass.\n")
    stage = ship_check.stage_tier(repo, declared_good, "origin/accounts",
                                  completion_no_browser)
    check("apps/web/page.html is declared and the completion never says "
         "'browser' - fails, naming the page file",
          not stage.ok and "browser" in "\n".join(stage.lines)
          and "apps/web/page.html" in "\n".join(stage.lines))

    completion_full = os.path.join(root, "completion-full.txt")
    write(completion_full,
         "mutation battery: broke it, watched it fail, restored it, "
         "watched it pass.\nbrowser: checked at phone width first.\n")
    stage = ship_check.stage_tier(repo, declared_good, "origin/accounts",
                                  completion_full)
    check("RED commit + mutation table + browser note together pass",
          stage.ok and "tier: normal" in stage.lines)

    stage = ship_check.stage_tier(repo, sensitive_declared,
                                  "origin/accounts", completion_full)
    check("a sensitive-tier slice with no page files never demands a "
         "browser note - RED + mutation alone is enough",
          stage.ok and "tier: sensitive" in stage.lines)

    mixed_declared = os.path.join(root, "declared-mixed.txt")
    # Deliberately UNEQUAL bucket sizes (3/2/1, not 1/1/1) - a fixture
    # where every bucket held the same count would not notice the
    # buckets being swapped with each other, only whether a number
    # printed at all.
    write(mixed_declared,
         "server/worker.js\nserver/other.js\nserver/third.js\n"
         "README.md\nDESIGN.md\napps/web/page.html\n")
    stage = ship_check.stage_tier(repo, mixed_declared, "origin/accounts",
                                  completion_full)
    check("a mixed list (sensitive + a page file + docs) tiers "
         "sensitive, and its page file still needs the browser note the "
         "completion above already carries",
          stage.ok and "tier: sensitive" in stage.lines)
    check("...and the printed bucket counts are exact - 3 sensitive, 2 "
         "trivial, 1 normal path(s), never a hand count",
          "3 sensitive, 2 trivial, 1 normal path(s) judged" in stage.lines)

    print("\n--- F1 (#393): evidence-shape, not word-presence - the "
         "reviewer's own five rows, reproduced verbatim ---")
    # Every row below is fed against declared_good (apps/web/page.html,
    # normal tier, RED commit already present on 0.9-m0-s22's own tip) -
    # isolates the finding to the mutation/browser TEXT shape alone.
    row1 = os.path.join(root, "f1-row1-denial.txt")
    write(row1, "I did NOT run a mutation battery. There is no mutation "
                "table.\nbrowser: NOT PERFORMED - I never opened a "
                "browser.\n")
    stage = ship_check.stage_tier(repo, declared_good, "origin/accounts",
                                  row1)
    check("F1 row 1: a completion that says IN PLAIN ENGLISH that no "
         "mutation battery ran and no browser was opened must FAIL - "
         "the word 'mutation'/'browser' sitting inside its own denial "
         "is not evidence",
          not stage.ok)

    row2 = os.path.join(root, "f1-row2-bare-words.txt")
    write(row2, "mutation browser\n")
    stage = ship_check.stage_tier(repo, declared_good, "origin/accounts",
                                  row2)
    check("F1 row 2: two bare words with nothing else must FAIL",
          not stage.ok)

    row3 = os.path.join(root, "f1-row3-unrelated.txt")
    write(row3, "This slice has no tests. The word mutation appears in "
                "the design doc, and browser support is out of scope.\n")
    stage = ship_check.stage_tier(repo, declared_good, "origin/accounts",
                                  row3)
    check("F1 row 3: 'mutation' and 'browser' mentioned only in an "
         "unrelated, non-evidentiary sentence must FAIL",
          not stage.ok)

    row4 = os.path.join(root, "f1-row4-honest-plural.txt")
    write(row4, "I ran five mutations, each red then green. Verified "
                "in browsers at phone width.\n")
    stage = ship_check.stage_tier(repo, declared_good, "origin/accounts",
                                  row4)
    check("F1 row 4: honest evidence using PLURAL nouns ('mutations', "
         "'browsers') must PASS - the old \\b...\\b word-boundary regex "
         "failed this exact text because 's' sits against the boundary",
          stage.ok)

    row5 = os.path.join(root, "f1-row5-labeled.txt")
    write(row5, "mutation battery: 5 mutations, red then green. "
                "browser: phone width.\n")
    stage = ship_check.stage_tier(repo, declared_good, "origin/accounts",
                                  row5)
    check("F1 row 5: a labeled, counted, red/green mutation line plus "
         "a labeled, width-bearing browser line must PASS",
          stage.ok)

    # Two more rows, each isolating ONE of the two checks against a
    # genuinely valid other one - not in the reviewer's own five, but
    # needed to arm _has_mutation_evidence() and _has_browser_evidence()
    # independently: every one of the reviewer's five rows has BOTH
    # checks fail or BOTH pass together, so a mutation that breaks only
    # the shape requirement on ONE of the two checks would still be
    # caught (or missed) by the OTHER check and never show up on its
    # own in those five alone.
    row6 = os.path.join(root, "f1-row6-bare-mutation-only.txt")
    write(row6, "mutation appears in this report, nothing more.\n"
                "browser: real browser, phone width.\n")
    stage = ship_check.stage_tier(repo, declared_good, "origin/accounts",
                                  row6)
    check("F1 row 6: mutation evidence is a bare word (no count, table "
         "or result pair) while browser evidence is genuinely valid - "
         "must FAIL on the mutation side alone",
          not stage.ok
          and "mutation-battery evidence" in "\n".join(stage.lines))

    row7 = os.path.join(root, "f1-row7-bare-browser-only.txt")
    write(row7, "mutation battery: 5 mutations, red then green.\n"
                "browser mentioned here, nothing more.\n")
    stage = ship_check.stage_tier(repo, declared_good, "origin/accounts",
                                  row7)
    check("F1 row 7: browser evidence is a bare word (no width or "
         "device) while mutation evidence is genuinely valid - must "
         "FAIL on the browser side alone",
          not stage.ok
          and "browser evidence" in "\n".join(stage.lines))

    stage = ship_check.stage_tier(repo, None, "origin/accounts",
                                  completion_full)
    check("no --declared file given fails with an actionable message, "
         "not a crash",
          not stage.ok and "no --declared file given" in stage.lines[0])

    missing_tier_declared = os.path.join(root, "does-not-exist-tier.txt")
    stage = ship_check.stage_tier(repo, missing_tier_declared,
                                  "origin/accounts", completion_full)
    check("an unreadable --declared path fails, names why",
          not stage.ok and "could not read" in stage.lines[0])

    print("\n--- stage_totals: hand-typed gate totals vs what THIS run "
         "printed (0.9-M3-S16, #421) - the S12 (#418) case: \"34/34 "
         "stages ok\" typed three times over a printed \"35 stages, 35 "
         "ok, 0 FAILED\" ---")

    # A fabricated pair of already-computed Stage objects, standing in
    # for what stage 1/2 of a real run already produced - stage_totals()
    # never re-runs a gate, only reads what these already carry (module
    # docstring: "NEVER A FRESH TOTAL"), so a hand-built fixture proves
    # the reading exactly as well as a real subprocess would.
    fixture_old_gate = ship_check.Stage(
        "old gate (py -3 tools/check.py)", True,
        ["=== fixture stage one ===", "", "=" * 20,
         "fixture stage one  ok", "=" * 20, "",
         "35 stages, 35 ok, 0 FAILED"],
        "fixture", counted=(35, 35, 0))
    fixture_new_gate = ship_check.Stage(
        "0.9 gate (node tests/run.mjs)", True,
        ["tests/door.test.mjs" + " " * 33 + "ok      0.2s",
         "    door OK - 30 checks",
         "tests/reaper.test.mjs" + " " * 30 + "ok      0.4s",
         "    64 checks, 0 failure(s)",
         "", "2 arms, 2 green, 0 FAILED"],
        "fixture", counted=(2, 2, 0))
    fixture_prior = [fixture_old_gate, fixture_new_gate]

    print("\n--- _find_claims: the scanner alone ---")
    check("\"34/34 stages ok\" near the word stage is one pair claim, "
         "unit stage",
          ship_check._find_claims("34/34 stages ok") ==
          [{"kind": "pair", "quote": "34/34", "ok": 34, "total": 34,
            "unit": "stage"}])
    check("\"6/6 arms green\" is one pair claim, unit arm",
          ship_check._find_claims("6/6 arms green") ==
          [{"kind": "pair", "quote": "6/6", "ok": 6, "total": 6,
            "unit": "arm"}])
    check("\"N of N\" phrasing is read the same way as \"N/N\"",
          ship_check._find_claims("34 of 34 stages passed") ==
          [{"kind": "pair", "quote": "34 of 34", "ok": 34, "total": 34,
            "unit": "stage"}])
    check("a fraction with NO trigger word nearby is not a claim at all "
         "- \"3/4 cups of flour\" is prose, not a gate total",
          ship_check._find_claims("3/4 cups of flour, whisked well") == [])
    check("\"40 stages\" alone (no slash) is a bare unit claim",
          ship_check._find_claims("40 stages, all green") ==
          [{"kind": "unit", "quote": "40 stages", "n": 40, "unit": "stage"}])
    check("\"40 checks\" alone is a bare unit claim, unit bucket 'check' "
         "- the not-anchored-to-either-gate bucket",
          ship_check._find_claims("ran 40 checks total") ==
          [{"kind": "unit", "quote": "40 checks", "n": 40, "unit": "check"}])
    check("a pair claim consumes its own digits - \"34/34 stages\" is "
         "read ONCE, never also as a bare \"34 stages\" unit claim on "
         "the second number",
          len(ship_check._find_claims("34/34 stages ok")) == 1)
    check("a per-file claim, path then count",
          ship_check._find_claims("tests/door.test.mjs - 30 checks") ==
          [{"kind": "per_file", "quote": "tests/door.test.mjs - 30 checks",
            "path": "tests/door.test.mjs", "n": 30}])
    check("a per-file claim, count then path",
          ship_check._find_claims("30 checks in tests/door.test.mjs") ==
          [{"kind": "per_file", "quote": "30 checks in tests/door.test.mjs",
            "path": "tests/door.test.mjs", "n": 30}])
    check("a per-file claim's own digits are never ALSO read as a bare "
         "unit claim",
          len(ship_check._find_claims(
              "tests/door.test.mjs - 30 checks")) == 1)

    print("\n--- stage_totals: matching totals pass ---")
    matching = os.path.join(root, "totals-matching.txt")
    write(matching, "stages: 35/35 ok. arms: 2/2 green.\n")
    stage = ship_check.stage_totals(fixture_prior, matching)
    check("a completion whose claimed totals match what this run "
         "printed passes",
          stage.ok and stage.detail == "match")
    check("...and each claim's own comparison line says match, quoting "
         "the claim",
          all("match: claimed" in line for line in stage.lines
              if line.startswith("match")))

    print("\n--- stage_totals: the S12 (#418) mismatch, reproduced "
         "verbatim - \"34/34 stages ok\" three times over a printed 35 "
         "---")
    s12_shape = os.path.join(root, "totals-s12-shape.txt")
    write(s12_shape,
         "ship-check: 34/34 stages ok.\nThe gate table shows 34/34 "
         "stages ok.\nFinal count: 34/34 stages ok.\n")
    stage = ship_check.stage_totals(fixture_prior, s12_shape)
    check("the S12 shape FAILS the stage - three identical wrong claims, "
         "not caught by a person, caught here",
          not stage.ok and stage.detail == "3 mismatch(es)")
    check("every mismatch line quotes the claim AND the printed numbers "
         "beside it",
          sum(1 for line in stage.lines
              if line.startswith("MISMATCH") and "34/34" in line
              and "35 total, 35 ok" in line) == 3)

    print("\n--- stage_totals: per-file claims - match, mismatch, and "
         "unverified (the run has no data) ---")
    per_file_match = os.path.join(root, "totals-per-file-match.txt")
    write(per_file_match, "tests/door.test.mjs - 30 checks, all green.\n")
    stage = ship_check.stage_totals(fixture_prior, per_file_match)
    check("a per-file claim matching this run's own printed count for "
         "that arm passes",
          stage.ok and "match" in stage.lines[0])

    per_file_mismatch = os.path.join(root, "totals-per-file-mismatch.txt")
    write(per_file_mismatch, "tests/door.test.mjs - 99 checks, all "
                            "green.\n")
    stage = ship_check.stage_totals(fixture_prior, per_file_mismatch)
    check("a per-file claim that disagrees with this run's own printed "
         "count for that arm fails, naming both numbers",
          not stage.ok and "MISMATCH" in stage.lines[0]
          and "99 checks" in stage.lines[0] and "30 checks" in stage.lines[0])

    per_file_unverified = os.path.join(root, "totals-per-file-unknown.txt")
    write(per_file_unverified,
         "tests/no-such-arm-ran.test.mjs - 12 checks, all green.\n")
    stage = ship_check.stage_totals(fixture_prior, per_file_unverified)
    check("a per-file claim about an arm this run never showed a row "
         "for is UNVERIFIED, never FAILED - this run cannot answer for "
         "a number it never printed",
          stage.ok and "unverified" in stage.lines[0].lower())
    check("...the stage still passes (unverified never fails it on its "
         "own) and says so in its detail",
          stage.ok and "unverified" in stage.detail)

    reaper_style = os.path.join(root, "totals-reaper-style.txt")
    write(reaper_style, "tests/reaper.test.mjs - 64 checks, all green.\n")
    stage = ship_check.stage_totals(fixture_prior, reaper_style)
    check("a per-file claim is read off a python-shimmed arm's own "
         "unlabeled \"N checks, N failure(s)\" verdict line too, not "
         "only the node arms' own labeled shape",
          stage.ok and "match" in stage.lines[0])

    print("\n--- stage_totals: THE WIDE CHECK POOL (fix-wave F1, review, "
         "#421) - a bare \"N checks\" claim is graded against the old "
         "gate's stage total, the 0.9 gate's arm total, AND every "
         "individual suite's own printed count, never only the two gate "
         "summaries ---")
    generic_match_stage = os.path.join(root, "totals-generic-stage.txt")
    write(generic_match_stage, "35 checks passed in the old gate.\n")
    stage = ship_check.stage_totals(fixture_prior, generic_match_stage)
    check("a bare \"N checks\" claim that equals the OLD gate's own "
         "total matches, even though the word used was \"checks\" and "
         "not \"stages\"",
          stage.ok and "match" in stage.lines[0]
          and "old gate's own stage total" in stage.lines[0])

    generic_suite_match = os.path.join(root, "totals-generic-suite.txt")
    write(generic_suite_match, "the suite reports 64 checks overall.\n")
    stage = ship_check.stage_totals(fixture_prior, generic_suite_match)
    check("fix-wave F1's own headline defect, fixed: a bare \"N checks\" "
         "claim that equals a SINGLE SUITE's own printed count (64, "
         "tests/reaper.test.mjs's own line - not either gate's summary "
         "total) now matches instead of being wrongly flagged MISMATCH",
          stage.ok and "match" in stage.lines[0]
          and "tests/reaper.test.mjs's own printed count" in stage.lines[0])

    generic_no_match = os.path.join(root, "totals-generic-no-match.txt")
    write(generic_no_match, "37 checks passed overall.\n")
    stage = ship_check.stage_totals(fixture_prior, generic_no_match)
    check("a bare \"N checks\" claim matching NOTHING this run printed - "
         "not either gate's total, not any single suite's own count - "
         "still fails",
          not stage.ok and "MISMATCH" in stage.lines[0]
          and "37 checks" in stage.lines[0])

    print("\n--- stage_totals: fix-wave F1 (review, #421) - a per-file "
         "claim naming a test file ANYWHERE in the same sentence or "
         "bullet is graded per-file, not only within twenty characters "
         "---")
    two_line_shape = os.path.join(root, "totals-two-line-shape.txt")
    # The exact shape tests/run.mjs's own output pastes verbatim into a
    # completion: the arm's path on one line, its own "N checks" detail
    # indented on the NEXT - review evidence, the "145 checks" defect.
    write(two_line_shape,
         "tests/door.test.mjs" + " " * 33 + "ok      0.2s\n"
         "    door OK - 30 checks\n")
    stage = ship_check.stage_totals(fixture_prior, two_line_shape)
    check("the arm-row-then-indented-detail-line shape (path and count "
         "on TWO separate lines, the exact shape a pasted arm table "
         "uses) is read as one per-file claim and matches",
          stage.ok and "match" in stage.lines[0]
          and "tests/door.test.mjs" in stage.lines[0])

    long_bullet_shape = os.path.join(root, "totals-long-bullet-shape.txt")
    # ~100 characters between the path and the number - the S10 review
    # shape ("`tests/charts-page.test.mjs` - ... (242 -> 241 checks).",
    # about 110 characters), reproduced with this fixture's own reaper
    # arm so the printed count (64) is real and checkable.
    write(long_bullet_shape,
         "`tests/reaper.test.mjs` - the retry loop grew its own "
         "coverage over several slices, so its count crept up slowly "
         "and nobody wrote down every step (64 checks).\n")
    stage = ship_check.stage_totals(fixture_prior, long_bullet_shape)
    check("a long bullet whose path sits ~100 characters from its own "
         "\"N checks\" (past the twenty-character short window, well "
         "inside the widened one) is still read as one per-file claim "
         "and matches",
          stage.ok and "match" in stage.lines[0]
          and "tests/reaper.test.mjs" in stage.lines[0])

    wrong_neighbor_shape = os.path.join(root, "totals-wrong-neighbor.txt")
    # The hazard the asymmetric window exists to dodge: door's own
    # detail line is followed almost immediately (next line) by an
    # UNRELATED arm's path - a naive "nearest path either direction"
    # search would attach "30 checks" to reaper (the closer-looking
    # neighbor) instead of door (the correct, PRECEDING one).
    write(wrong_neighbor_shape,
         "tests/door.test.mjs" + " " * 33 + "ok      0.2s\n"
         "    door OK - 30 checks\n"
         "tests/reaper.test.mjs" + " " * 30 + "ok      0.4s\n")
    stage = ship_check.stage_totals(fixture_prior, wrong_neighbor_shape)
    check("...and it is attached to the CORRECT, preceding arm (door, "
         "30) rather than the unrelated arm whose row merely happens "
         "to start on the very next line (reaper) - forward search "
         "never crosses a newline, exactly to prevent this",
          stage.ok and "match" in stage.lines[0]
          and "tests/door.test.mjs" in stage.lines[0]
          and "tests/reaper.test.mjs" not in stage.lines[0])

    false_neighbor_number = os.path.join(root, "totals-false-mismatch.txt")
    # fix-wave F1's own safety net: even when the proximity heuristic
    # DOES attach a number to the wrong nearby file, a number that is
    # genuinely true of the run elsewhere is never called a mismatch -
    # see _grade_claim's own per_file branch, "ask whether it is true
    # of the run AT ALL before calling it wrong".
    write(false_neighbor_number,
         "tests/door.test.mjs is the arm just above this line, and "
         "separately the run also showed 64 checks passing.\n")
    stage = ship_check.stage_totals(fixture_prior, false_neighbor_number)
    check("a number that is real (64, reaper's own count) but gets "
         "proximity-attached to an unrelated nearby path (door) is "
         "still graded a MATCH, never a false MISMATCH, because the "
         "wide pool is consulted before the claim is called wrong",
          stage.ok and "match" in stage.lines[0])

    print("\n--- stage_totals: fix-wave F1 (review, #421) - THE "
         "GATING-STAGE META CLAIM: ship-check's own \"N/N gating "
         "stage(s) passed.\" line - the one it tells a builder to "
         "paste - must pass its own stage ---")
    # fixture_prior holds 2 already-built gating stages (old gate, new
    # gate) - stage_totals() always gates too, so THIS fixture's own
    # gating-stage total is 2 + 1 = 3, never the old gate's 35.
    gating_match = os.path.join(root, "totals-gating-match.txt")
    write(gating_match, "3/3 gating stage(s) passed.\n")
    stage = ship_check.stage_totals(fixture_prior, gating_match)
    check("\"3/3 gating stage(s) passed.\" matches this run's OWN "
         "structural gating-stage count (2 prior + this stage itself), "
         "never the old gate's 35 stages",
          stage.ok and "match" in stage.lines[0]
          and "gating-stage" in stage.lines[0])

    gating_wrong = os.path.join(root, "totals-gating-wrong.txt")
    write(gating_wrong, "5/3 gating stage(s) passed.\n")
    stage = ship_check.stage_totals(fixture_prior, gating_wrong)
    check("...but a WRONG gating-stage claim still fails - this family "
         "is a real, checkable total, not a free pass",
          not stage.ok and "MISMATCH" in stage.lines[0])

    check("_find_claims itself resolves \"7/7 gating stage(s) passed.\" "
         "to the gating_stage unit, never plain \"stage\"",
          ship_check._find_claims("7/7 gating stage(s) passed.") ==
          [{"kind": "pair", "quote": "7/7", "ok": 7, "total": 7,
            "unit": "gating_stage"}])
    check("...while a bare \"stages\" trigger with no \"gating\" before "
         "it still reads as the plain stage unit",
          ship_check._find_claims("7/7 stages passed.") ==
          [{"kind": "pair", "quote": "7/7", "ok": 7, "total": 7,
            "unit": "stage"}])

    print("\n--- _find_claims: fix-wave F2 (review, #421) - ORDINALS "
         "ARE NOT TOTAL CLAIMS: \"stage 1 of 2\", \"part 3/4\", "
         "\"step 2/5\" produce NOTHING, matching the ticket's own "
         "acceptance list verbatim ---")
    check("\"stage 1 of 2\" (this repository's own batch-position "
         "phrasing) is not a claim at all",
          ship_check._find_claims(
              "this slice is stage 1 of 2 in the batch") == [])
    check("\"part 3/4\" (S12's real posted text, "
         "'the paste (part 3/4) correctly showed 35') is not a claim",
          ship_check._find_claims(
              "the paste (part 3/4) correctly showed 35") == [])
    check("\"step 2/5\" is not a claim, even with a real trigger word "
         "elsewhere in the same sentence",
          ship_check._find_claims(
              "step 2/5 of the mutation checks ran clean") == [])
    check("...but the same shape WITH a colon before the fraction - a "
         "real total this repository actually writes - still IS a "
         "claim: the colon breaks the ordinal match on purpose",
          ship_check._find_claims("stages: 35/35 ok.") ==
          [{"kind": "pair", "quote": "35/35", "ok": 35, "total": 35,
            "unit": "stage"}])

    print("\n--- stage_totals: the reviewer's own right-pair case - "
         "\"29/29 stages\" when the real stage total is 35 - still "
         "fails (0.9-M3-S16 fix wave, review acceptance (c)) ---")
    right_pair_wrong = os.path.join(root, "totals-right-pair-wrong.txt")
    write(right_pair_wrong, "29/29 stages ok.\n")
    stage = ship_check.stage_totals(fixture_prior, right_pair_wrong)
    check("this run's actual stage total is 35 (not 29) - written next "
         "to the word \"stages\", \"29/29\" is refused",
          not stage.ok and "MISMATCH" in stage.lines[0]
          and "29/29" in stage.lines[0])

    print("\n--- stage_totals: stage/arm claims stay STRICTLY anchored "
         "to their own family, never falling back to the wide check "
         "pool - the exact property mutation battery direction 3 (the "
         "unit-pairing) arms ---")
    cross_family_leak = os.path.join(root, "totals-cross-family.txt")
    # 2 is this fixture's REAL arm total (fixture_new_gate.counted ==
    # (2, 2, 0)) - if a "stages" claim ever fell through to the wide
    # check pool the way an unanchored "check" claim does, "2/2 stages"
    # would wrongly MATCH (2 is in the pool, as the arm total). The
    # real stage total is 35, so it must MISMATCH instead.
    write(cross_family_leak, "2/2 stages ok.\n")
    stage = ship_check.stage_totals(fixture_prior, cross_family_leak)
    check("\"2/2 stages\" - where 2 is a REAL number this run printed, "
         "just for the WRONG family (the arm total, not the stage "
         "total) - still fails: the wide pool never reaches stage/arm "
         "claims, only the unanchored check bucket",
          not stage.ok and "MISMATCH" in stage.lines[0]
          and "2/2" in stage.lines[0])

    print("\n--- stage_totals: fix-wave F4 (review, #421) - a "
         "--completion draft that is not valid UTF-8 no longer crashes "
         "this stage (or stage_tier, which reads the same file first) "
         "---")
    completion_utf16 = os.path.join(root, "completion-utf16.txt")
    with open(completion_utf16, "w", encoding="utf-16") as handle:
        handle.write("mutation battery: 3 mutations, red then green.\n"
                     "35 checks passed.\n")
    stage = ship_check.stage_totals(fixture_prior, completion_utf16)
    check("stage_totals() no longer raises UnicodeDecodeError on a "
         "non-UTF-8 draft - it reads what decodes and says so",
          any("not valid UTF-8" in line for line in stage.lines))

    tier_utf16_declared = os.path.join(root, "declared-tier-utf16.txt")
    write(tier_utf16_declared, "apps/web/page.html\n")
    stage = ship_check.stage_tier(repo, tier_utf16_declared,
                                  "origin/accounts", completion_utf16)
    check("stage_tier() - which reads the same --completion file TWO "
         "stages earlier - no longer crashes on it either, and its own "
         "output names the same encoding problem",
          any("not valid UTF-8" in line for line in stage.lines))

    print("\n--- stage_totals: no claim, no completion, unreadable path "
         "---")
    no_claim = os.path.join(root, "totals-no-claim.txt")
    write(no_claim, "mutation battery: broke it, watched it fail, "
                    "restored it, watched it pass.\n")
    stage = ship_check.stage_totals(fixture_prior, no_claim)
    check("a completion with no N/N, N of N or N-unit claim at all "
         "passes trivially, saying so",
          stage.ok and stage.detail == "no claims found")

    stage = ship_check.stage_totals(fixture_prior, None)
    check("no --completion given passes trivially, saying so",
          stage.ok and stage.detail == "no completion given")

    missing_totals_path = os.path.join(root, "does-not-exist-totals.txt")
    stage = ship_check.stage_totals(fixture_prior, missing_totals_path)
    check("an unreadable --completion path fails, naming why",
          not stage.ok and "could not read" in stage.lines[0])

    print("\n--- _count_old_gate_table / _count_new_gate_table: pure "
         "counters, 0.9-M1-S0 (#323) ---")
    check("a bordered two-row table (one ok row, one FAILED row) counts "
         "both, from the rows alone",
          ship_check._count_old_gate_table(
              ["=" * 20, "one" + " " * 14 + "ok", "two" + " " * 11 + "FAILED",
               "=" * 20]) == (2, 1, 1))
    check("no bordered pair anywhere in the captured text counts as "
         "None, not a crash or a false zero",
          ship_check._count_old_gate_table(
              ["nothing here looks like a fence at all"]) is None)
    check("a lying line placed AFTER the real fence never changes the "
         "count - only rows BETWEEN the fence pair are read",
          ship_check._count_old_gate_table(
              ["=" * 10, "a  ok", "b  FAILED", "=" * 10,
               "999 stages, 999 ok, 0 FAILED"]) == (2, 1, 1))

    check("an arm row (tests/<name>.test.mjs + ok + seconds) is counted",
          ship_check._count_new_gate_table(
              ["tests/a.test.mjs" + " " * 40 + "ok      0.1s"]) == (1, 1, 0))
    check("...and a FAILED arm row is counted on the other side",
          ship_check._count_new_gate_table(
              ["tests/a.test.mjs" + " " * 40 + "ok      0.1s",
               "tests/b.test.mjs" + " " * 40 + "FAILED  0.2s"]) == (2, 1, 1))
    check("preflight's own row (same report() shape, no .test.mjs suffix) "
         "is never counted as an arm",
          ship_check._count_new_gate_table(
              ["tests/preflight.mjs" + " " * 36 + "ok      0.1s"]) is None)
    check("a lying closing line ('999 arm(s), all green.') never changes "
         "the count - only tests/*.test.mjs rows are read",
          ship_check._count_new_gate_table(
              ["tests/a.test.mjs" + " " * 40 + "ok      0.1s",
               "tests/b.test.mjs" + " " * 40 + "FAILED  0.2s",
               "999 arm(s), all green."]) == (2, 1, 1))

    print("\n--- stage 1 & 2: subprocess capture is VERBATIM, never "
         "summarized (the whole reason this ticket exists), and its own "
         "COUNTED summary line closes the block (0.9-M1-S0, #323) ---")
    for scenario, want_old, want_new in (
        ("pass", (2, 2, 0), (2, 2, 0)),
        ("fail", (2, 1, 1), (2, 1, 1)),
        ("lie", (2, 1, 1), (2, 1, 1)),
    ):
        if scenario == "pass":
            os.environ.pop("SHIP_CHECK_STUB_OLD_GATE", None)
            os.environ.pop("SHIP_CHECK_STUB_NEW_GATE", None)
        else:
            os.environ["SHIP_CHECK_STUB_OLD_GATE"] = scenario
            os.environ["SHIP_CHECK_STUB_NEW_GATE"] = scenario

        stage = ship_check.stage_old_gate(repo)
        old_line = "%d stages, %d ok, %d FAILED" % want_old
        check("old gate (%s): the real stage rows are captured verbatim"
             % scenario,
              any(line.startswith("fixture stage one") and
                  line.endswith("ok") for line in stage.lines))
        check("old gate (%s): the exit code matches - stage.ok never "
             "trusts the summary line alone" % scenario,
              stage.ok == (scenario == "pass"))
        check("old gate (%s): the block's own LAST non-blank line is the "
             "COUNTED summary %r, read from the rows - never the fake "
             "'999...' line the 'lie' scenario also prints"
             % (scenario, old_line),
              [line for line in stage.lines if line][-1] == old_line)

        with PatchInitProblems([]):
            stage = ship_check.stage_new_gate(repo, None)
        new_line = "%d arms, %d green, %d FAILED" % want_new
        check("new gate (%s): the real arm rows are captured verbatim"
             % scenario,
              any(line.startswith("tests/fixture-one.test.mjs")
                  for line in stage.lines))
        check("new gate (%s): the block's own LAST non-blank line is the "
             "COUNTED summary %r, never run.mjs's own closing line "
             "('999 arm(s), all green.' in the 'lie' scenario)"
             % (scenario, new_line),
              [line for line in stage.lines if line][-1] == new_line)

    os.environ.pop("SHIP_CHECK_STUB_OLD_GATE", None)
    os.environ.pop("SHIP_CHECK_STUB_NEW_GATE", None)

    with PatchInitProblems(["fixture: pretend uninitialized"]):
        stage = ship_check.stage_new_gate(repo, None)
    check("an uninitialized worktree short-circuits to its own row",
          not stage.ok and stage.lines[0].startswith("not initialized"))
    check("...naming the real problem initialization_problems() gave",
          "fixture: pretend uninitialized" in stage.lines)
    check("...and no counted summary line is fabricated for a gate that "
         "never ran",
          not any(line.endswith("green, 0 FAILED")
                  or "arms," in line for line in stage.lines))
    check("...and NEVER runs the gate at all - the stub would have "
         "passed, and its telltale line is nowhere in the output",
          not any("tests/fixture-one.test.mjs" in line
                  for line in stage.lines))

    print("\n--- stage 6: ticket label state (report-only) ---")
    stub_path = os.path.join(root, "gh_stub.py")
    write(stub_path, GH_STUB_SOURCE)
    os.environ["BINDER_GH_CMD"] = stub_command(stub_path)

    os.environ["SHIP_CHECK_STUB_SCENARIO"] = "claimed"
    stage = ship_check.stage_ticket_label(320)
    check("a claimed ticket reports the label present",
          stage.gates is False and stage.status_word == "REPORT"
          and any("claude label: present" in line for line in stage.lines))

    os.environ["SHIP_CHECK_STUB_SCENARIO"] = "unclaimed"
    stage = ship_check.stage_ticket_label(320)
    check("an unclaimed ticket reports the label absent, still "
         "report-only and still non-gating",
          stage.gates is False and stage.ok is True
          and any("claude label: absent" in line for line in stage.lines))

    # gh absent: BINDER_GH_CMD pointed at a nonexistent executable,
    # fleet_status_suite.py's own precedent for this exact scenario.
    os.environ["BINDER_GH_CMD"] = json.dumps(["not-a-real-executable-xyz"])
    stage = ship_check.stage_ticket_label(320)
    check("gh absent degrades to a labeled gap, never a crash",
          stage.status_word.startswith("REPORT")
          and any("gh could not be consulted" in line
                  for line in stage.lines))
    check("...and still never gates the overall exit code",
          stage.gates is False and stage.ok is True)

    os.environ["BINDER_GH_CMD"] = stub_command(stub_path)
    os.environ["SHIP_CHECK_STUB_SCENARIO"] = "hostile"
    stage = ship_check.stage_ticket_label(320)
    joined = "\n".join(stage.lines)
    check("a hostile ESC byte from gh is sanitized before it reaches "
         "this stage's own printed lines - gone, not merely alongside",
          "\x1b" not in joined)
    check("...and rendered as visible escaped hex, so nothing legible "
         "is silently dropped",
          "\\x1b" in joined)

    del os.environ["SHIP_CHECK_STUB_SCENARIO"]
    del os.environ["BINDER_GH_CMD"]

    stage = ship_check.stage_ticket_label(None)
    check("no --issue given is report-only and non-failing",
          stage.gates is False and stage.ok is True
          and "no --issue given" in stage.lines[0])

    print("\n--- main(): whole-program exit code and ready-to-paste "
         "framing ---")
    git(repo, "checkout", "-q", "0.9-m0-s22")
    stub_path = os.path.join(root, "gh_stub.py")
    os.environ["BINDER_GH_CMD"] = stub_command(stub_path)
    os.environ["SHIP_CHECK_STUB_SCENARIO"] = "claimed"

    buffer = io.StringIO()
    with PatchInitProblems([]), redirect_stdout(buffer):
        code = ship_check.main(["--repo", repo, "--declared", declared_good,
                                "--base", "origin/accounts",
                                "--issue", "320",
                                "--completion", completion_full])
    rendered = buffer.getvalue()
    check("an all-pass fixture run exits 0", code == 0)
    check("the closing line names this output as the paste-verbatim "
         "block, not a count to remember",
          "Paste this whole block into the completion comment" in rendered)
    check("stage 1's real header and stage 6's report both appear in "
         "the one printed block",
          "--- old gate (py -3 tools/check.py) ---" in rendered
          and "--- ticket label state (report-only) ---" in rendered)
    check("stage 6 prints REPORT, visibly distinct from a gating PASS, "
         "even on an all-pass run",
          "[REPORT]" in rendered)
    check("the full 40-character head SHA appears, ready to copy into "
         "the signal",
          ("head: " + tip_sha) in rendered)
    check("the old gate's own COUNTED summary line reaches the final "
         "rendered paste block, 0.9-M1-S0 (#323)",
          "2 stages, 2 ok, 0 FAILED" in rendered)
    check("...and so does the new gate's, in the same pass-through run",
          "2 arms, 2 green, 0 FAILED" in rendered)
    check("the new slice-tier stage's own row reaches this block too, "
         "0.9-M3-S5 (#403)",
          "--- slice tier ---" in rendered and "tier: normal" in rendered)

    print("\n--- --completion-block: the exact paste block, "
         "0.9-M3-S5 (#393) ---")
    buffer3 = io.StringIO()
    with PatchInitProblems([]), redirect_stdout(buffer3):
        code3 = ship_check.main(["--repo", repo, "--declared", declared_good,
                                 "--base", "origin/accounts",
                                 "--issue", "320",
                                 "--completion", completion_full,
                                 "--completion-block"])
    block = buffer3.getvalue()
    check("--completion-block exits 0 on the same all-pass fixture run",
          code3 == 0)
    check("the block names the slice by its slug, derived from the "
         "branch (0.9-m0-s22 -> 0.9-M0-S22)",
          "0.9-M0-S22: ship-check completion block" in block)
    check("the block carries the branch",
          "branch: 0.9-m0-s22" in block)
    check("the block carries the full 40-character head SHA",
          ("head:   " + tip_sha) in block)
    check("the old gate's own computed totals reach the block, read "
         "from the SAME Stage.counted the full-output line above came "
         "from - never a second calculation",
          "2 total, 2 ok, 0 FAILED" in block)
    check("...and so do the new gate's - both rows carry it, since "
         "both fixture stubs are in the same 'pass' scenario",
          block.count("2 total, 2 ok, 0 FAILED") == 2)
    check("the declared-vs-diff verdict reaches the block",
          "MATCH" in block)
    check("the tier stage's own row reaches the block too",
          "normal" in block)
    check("the gating summary is the block's own computed total, never "
         "a remembered count",
          "7/7 gating stage(s) passed." in block)
    check("an all-pass block says READY TO PASTE",
          "READY TO PASTE." in block)

    # Force the old gate to fail and confirm the block's own totals
    # track it LIVE - the arm #393 names: "the block's totals are the
    # tool's own computed values (a mutation forcing a wrong total into
    # the block must red)". This proves the block never carries a
    # second, independently-typed number: it is driven by exactly the
    # same _count_old_gate_table() call the full-output stage already
    # used, so a real subprocess failure changes both outputs from one
    # source, not two.
    os.environ["SHIP_CHECK_STUB_OLD_GATE"] = "fail"
    buffer4 = io.StringIO()
    with PatchInitProblems([]), redirect_stdout(buffer4):
        code4 = ship_check.main(["--repo", repo, "--declared", declared_good,
                                 "--base", "origin/accounts",
                                 "--completion", completion_full,
                                 "--completion-block"])
    block_fail = buffer4.getvalue()
    check("a failing old gate exits the block mode 1",
          code4 == 1)
    check("...and the block's own totals show the real 2-total/1-ok/"
         "1-FAILED split, computed fresh - never the passing run's "
         "numbers above",
          "2 total, 1 ok, 1 FAILED" in block_fail)
    check("...and the block says it is NOT ready to paste, naming the "
         "failed stage by name",
          "NOT ready to paste" in block_fail
          and "old gate (py -3 tools/check.py)" in block_fail)
    check("...and the gating count itself moved off 7/7 - the SAME "
         "computed total the passing block above printed",
          "7/7 gating stage(s) passed." not in block_fail
          and "gating stage(s) passed." in block_fail)
    os.environ.pop("SHIP_CHECK_STUB_OLD_GATE", None)
    os.environ.pop("SHIP_CHECK_STUB_NEW_GATE", None)

    print("\n--- F4 (#393): ONE gate execution, TWO renderings - not two "
         "runs ---")
    # main() builds the `stages` list exactly once per invocation and
    # hands the SAME list to both renderers, so a condensed block and a
    # full block from one run can never disagree - a flaky arm caught by
    # one execution reaches both renderings identically, never just one
    # of them. Proven here by literally counting
    # calls into stage_old_gate/stage_new_gate during one
    # --completion-block invocation, not by re-reading printed numbers
    # (which would agree by luck on a non-flaky fixture even with the
    # old, broken two-run shape).
    call_counts = {"old": 0, "new": 0}
    real_old_gate = ship_check.stage_old_gate
    real_new_gate = ship_check.stage_new_gate

    def _counting_old_gate(repo_arg):
        call_counts["old"] += 1
        return real_old_gate(repo_arg)

    def _counting_new_gate(repo_arg, state_arg):
        call_counts["new"] += 1
        return real_new_gate(repo_arg, state_arg)

    ship_check.stage_old_gate = _counting_old_gate
    ship_check.stage_new_gate = _counting_new_gate
    try:
        buffer5 = io.StringIO()
        with PatchInitProblems([]), redirect_stdout(buffer5):
            code5 = ship_check.main(
                ["--repo", repo, "--declared", declared_good,
                 "--base", "origin/accounts", "--completion", completion_full,
                 "--completion-block"])
    finally:
        ship_check.stage_old_gate = real_old_gate
        ship_check.stage_new_gate = real_new_gate

    check("F4: one --completion-block invocation runs the old gate "
         "exactly once, never twice for two renderings",
          call_counts["old"] == 1)
    check("...and the new gate exactly once too",
          call_counts["new"] == 1)
    check("...and the run still exits 0", code5 == 0)
    both = buffer5.getvalue()
    check("...and BOTH the full verbatim block and the condensed block "
         "come out of that SAME one run, in one buffer - a mode swap "
         "would print only one of the two headers below",
          "=== ship-check: the executor's pre-signal door" in both
          and "ship-check completion block ===" in both)
    check("...with matching totals in both renderings, since both are "
         "read off the identical Stage objects the one run produced",
          "2 stages, 2 ok, 0 FAILED" in both  # full render's own line
          and "2 total, 2 ok, 0 FAILED" in both)  # condensed block's line

    buffer2 = io.StringIO()
    with PatchInitProblems(["fixture: pretend uninitialized"]), \
         redirect_stdout(buffer2):
        code2 = ship_check.main(["--repo", repo, "--declared", declared_good,
                                 "--issue", "320"])
    check("an uninitialized worktree fails main() overall, exit 1",
          code2 == 1)
    check("...and the summary names which gating stage(s) failed",
          "gating stage(s) failed" in buffer2.getvalue()
          and "0.9 gate (node tests/run.mjs)" in buffer2.getvalue())
    check("a report-only stage passing does not rescue a failed "
         "gating stage from the exit code",
          "[REPORT]" in buffer2.getvalue())

    del os.environ["SHIP_CHECK_STUB_SCENARIO"]
    del os.environ["BINDER_GH_CMD"]

finally:
    shutil.rmtree(root, ignore_errors=True)

print("\n%d checks, %d failure(s)" % (performed, failures))
if performed != EXPECTED:
    print("EXPECTED %d checks and %d ran. A suite that quietly stops "
         "running is a suite that quietly stops checking."
         % (EXPECTED, performed))
    sys.exit(1)
sys.exit(1 if failures else 0)
