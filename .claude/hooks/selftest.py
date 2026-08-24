"""Fires every hook rule both ways - the arming the gate cannot give
these scripts, because .claude/ is gitignored and machine-held.

Run: py -3 .claude/hooks/selftest.py   (from the primary checkout)
Exit 0 with a printed table when every expectation holds; exit 1 naming
the first rule that does not. Each case is (hook, tool_name, input,
expect_deny, label). A rule is armed only if it has a denying case AND
a passing near-miss beside it.

This file is written with the Write tool, never through a shell: its
fixtures contain the very strings bash_guard denies, so a heredoc that
carries them is itself refused (that happened, 2026-08-21 - the guard
working as built).
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, "..", ".."))


def fire(hook, tool_name, tool_input, extra_env=None):
    cwd = (extra_env or {}).get("_cwd", PROJECT)
    payload = json.dumps({"tool_name": tool_name, "tool_input": tool_input,
                          "cwd": cwd})
    env = dict(os.environ, CLAUDE_PROJECT_DIR=PROJECT)
    fixture_path = None
    for k, v in (extra_env or {}).items():
        if k.startswith("_"):
            continue
        if v == "__missing__":
            env[k] = os.path.join(HERE, "no-such-record.json")
        elif v == "__fixture__":
            fixture_path = os.path.join(HERE, "selftest-fixture.json")
            with open(fixture_path, "w", encoding="utf-8") as f:
                f.write(extra_env["_fixture"])
            env[k] = fixture_path
        else:
            env[k] = v
    r = subprocess.run([sys.executable, os.path.join(HERE, hook)],
                       input=payload, capture_output=True, text=True,
                       env=env, timeout=60)
    if fixture_path and os.path.exists(fixture_path):
        os.remove(fixture_path)
    out = r.stdout.strip()
    if not out:
        return False, ""
    decision = json.loads(out)
    spec = decision.get("hookSpecificOutput") or {}
    return (spec.get("permissionDecision") == "deny"
            or decision.get("decision") == "block"), out


BG = "bash_guard.py"
DP = "dispatch_premise.py"
MAIN_PUSH = "git push origin HEAD:" + "main"   # split so this file never carries the literal
CASES = [
    # rule 7: milestone by bare number
    (BG, "PowerShell", {"command": "gh api -X PATCH repos/o/r/milestones/4 -f state=closed"}, True,
     "r7 PATCH by bare number with state= is denied"),
    (BG, "PowerShell", {"command": "$n = gh api repos/o/r/milestones --jq '.[] | select(.title == \"0.9-M2\") | .number'; gh api -X PATCH repos/o/r/milestones/$n -f state=closed"}, False,
     "r7 the same command resolving from the title passes"),
    (BG, "Bash", {"command": "gh api repos/o/r/milestones/4 --jq .title"}, False,
     "r7 a read of a milestone by number passes (no state=)"),
    # rule 8: BOM on a declared list
    (BG, "PowerShell", {"command": "Set-Content -Path declared-s9.txt -Value $list -Encoding utf8"}, True,
     "r8 Set-Content -Encoding utf8 on a declared list is denied"),
    (BG, "PowerShell", {"command": "[IO.File]::WriteAllText('declared-s9.txt', $t, (New-Object Text.UTF8Encoding $false))"}, False,
     "r8 the BOM-free writer passes"),
    (BG, "PowerShell", {"command": "Set-Content -Path notes.txt -Value $x -Encoding utf8"}, False,
     "r8 Set-Content utf8 on a non-declared file passes"),
    # older rules, one each way, so a refactor cannot drop them quietly
    (BG, "Bash", {"command": MAIN_PUSH}, True, "r1 push to the release branch denied"),
    (BG, "Bash", {"command": "git push origin 0.9-m3-s1"}, False, "r1 branch push passes"),
    # rule 3: the anchor is the repository (#357) - a worktree-rooted session
    # is refused a -C into the primary or a sibling, and its own tree passes
    (BG, "Bash", {"command": "git -C .claude/worktrees/agent-other status"}, True,
     "r3 primary-rooted: -C into a worktree is denied"),
    (BG, "Bash", {"command": "git -C C:/elsewhere/other-repo status"}, False,
     "r3 primary-rooted: -C outside the repository passes"),
    (BG, "Bash", {"command": "gh issue comment 357 --body \"rule 3: a worktree-rooted -C into the primary is DENIED; never -C/--git-dir into a sibling\""}, False,
     "r3 prose mentioning -C in a quoted comment body passes (only git's own -C counts)"),
    (BG, "Bash", {"command": "git --no-pager -C .claude/worktrees/agent-x log -1"}, True,
     "r3 git with an option before -C into a worktree is still denied"),
    (BG, "Bash", {"command": "git commit -m \"never -C into the primary; --git-dir is not for us\""}, False,
     "r3 a commit message quoting -C and --git-dir passes (quoted strings are stripped)"),
    (BG, "Bash", {"command": "git -C ../../.. status"}, True,
     "r3 worktree-rooted: -C into the primary is denied (#357)",
     {"CLAUDE_PROJECT_DIR": os.path.join(PROJECT, ".claude", "worktrees", "agent-selftest"),
      "_cwd": os.path.join(PROJECT, ".claude", "worktrees", "agent-selftest")}),
    (BG, "Bash", {"command": "git -C ../agent-other status"}, True,
     "r3 worktree-rooted: -C into a sibling worktree is denied (#357)",
     {"CLAUDE_PROJECT_DIR": os.path.join(PROJECT, ".claude", "worktrees", "agent-selftest"),
      "_cwd": os.path.join(PROJECT, ".claude", "worktrees", "agent-selftest")}),
    (BG, "Bash", {"command": "git -C . status"}, False,
     "r3 worktree-rooted: -C into its own tree passes",
     {"CLAUDE_PROJECT_DIR": os.path.join(PROJECT, ".claude", "worktrees", "agent-selftest"),
      "_cwd": os.path.join(PROJECT, ".claude", "worktrees", "agent-selftest")}),
    (BG, "Bash", {"command": "python tools/check.py"}, True, "r4 bare python denied"),
    (BG, "Bash", {"command": "py -3 tools/check.py"}, False, "r4 py -3 passes"),
    (BG, "Bash", {"command": "node tests/run.mjs", "run_in_background": True}, True, "r6 backgrounded gate denied"),
    (BG, "Bash", {"command": "node tests/run.mjs"}, False, "r6 foreground gate passes"),
    (BG, "Bash", {"command": "py -3 tools/reaper_suite.py", "run_in_background": True}, True, "r6 backgrounded python suite denied (S21, 2026-08-21)"),
    (BG, "Bash", {"command": "py -3 dev/check_comments.test.py", "run_in_background": True}, True, "r6 backgrounded dev test denied"),
    (BG, "Bash", {"command": "py -3 tools/reaper_suite.py"}, False, "r6 foreground python suite passes"),
    (BG, "Monitor", {"command": "py -3 tools/ship_check.py --declared d.txt --completion c.md", "description": "ship-check", "timeout_ms": 600000, "persistent": False}, True, "r6 a Monitor wrapping ship-check is denied (S29, 2026-08-22)"),
    (BG, "Monitor", {"command": "tail -f dev.log", "description": "dev log", "timeout_ms": 60000, "persistent": False}, False, "r6 a Monitor on a log passes"),
    # dispatch_premise 5: sensitive-tier paths must be dispatched as sensitive
    (DP, "Agent", {"subagent_type": "opus-specialist", "prompt": "Touch server/charts-agg.js binning. Verify in a real browser."}, True,
     "dp5 builder order naming server/ without the word sensitive is denied"),
    (DP, "Agent", {"subagent_type": "opus-specialist", "prompt": "SENSITIVE tier: touch server/charts-agg.js binning; full review, re-fire, the git-ops door. Verify in a real browser."}, False,
     "dp5 the same order stating the sensitive tier passes"),
    (DP, "Agent", {"subagent_type": "sonnet-builder", "prompt": "Edit apps/web/charts.js captions only. Normal tier. Verify in a real browser."}, False,
     "dp5 a page-only order needs no tier word"),
    (DP, "Agent", {"subagent_type": "binder-reviewer", "prompt": "Review server/charts-agg.js at the head."}, False,
     "dp5 a reviewer dispatch is not a builder order"),
    (DP, "Agent", {"subagent_type": "sonnet-builder", "prompt": "Edit apps/web/_headers to add a cache rule. Verify in a real browser."}, True,
     "dp5 the deployed _headers layer is sensitive-tier (ruled 2026-08-21)"),
    (DP, "Agent", {"subagent_type": "sonnet-builder", "prompt": "Docs slice. Declared files: OPERATIONS.md, AGENTS.md. Point the reader at server/schema.sql's comments. Trivial tier."}, False,
     "dp5 a declared trivial list wins over a mere mention of server/"),
    (DP, "Agent", {"subagent_type": "sonnet-builder", "prompt": "Declared files: server/worker.js, tests/door.test.mjs. Normal tier, build the route."}, True,
     "dp5 a declared list naming server/ without the word sensitive is denied"),
    (DP, "Agent", {"subagent_type": "sonnet-builder", "prompt": "Build 0.9-M3-S99: cache the mainlines in tools/reaper.py once per plan() call. Normal tier."}, True,
     "dp5 a builder order naming tools/reaper.py without the word sensitive is denied (Prime ruling 2026-08-22, S35 F4)"),
    (DP, "Agent", {"subagent_type": "sonnet-builder", "prompt": "Declared files: tools/prime_lock.py, tools/prime_lock_suite.py. Normal tier by path, reviewed on the sensitive bar."}, False,
     "dp5 the same class stating the sensitive bar passes"),
    # bash_guard rule 9: sit deploys need the batch record (BINDER_BATCH_RECORD points the rule at a fixture)
    (BG, "PowerShell", {"command": "npx wrangler deploy --env sit"}, True,
     "r9 sit deploy with no batch record is denied",
     {"BINDER_BATCH_RECORD": "__missing__"}),
    (BG, "PowerShell", {"command": "npx wrangler deploy --env sit"}, True,
     "r9 sit deploy with a sensitive slice and consult pending is denied",
     {"BINDER_BATCH_RECORD": "__fixture__", "_fixture": '{"slices":[{"id":"0.9-m3-s1","tier":"sensitive"}],"consult":"pending"}'}),
    (BG, "PowerShell", {"command": "npx wrangler deploy --env sit"}, False,
     "r9 sit deploy with a sensitive slice and consult done passes",
     {"BINDER_BATCH_RECORD": "__fixture__", "_fixture": '{"slices":[{"id":"0.9-m3-s1","tier":"sensitive"}],"consult":"done:issuecomment-1","schema_applied":"schema.sql at the tip"}'}),
    (BG, "PowerShell", {"command": "npx wrangler deploy --env sit"}, False,
     "r9 sit deploy with no sensitive slice passes without a consult",
     {"BINDER_BATCH_RECORD": "__fixture__", "_fixture": '{"slices":[{"id":"0.9-m3-s2","tier":"normal"}],"consult":"not-needed","schema_applied":"schema.sql at the tip"}'}),
    # rule 9, the schema half (2026-08-24, the sit sign-in outage): a
    # deploy whose record does not say the schema was applied is refused,
    # however green the consult is
    (BG, "PowerShell", {"command": "npx wrangler deploy --env sit"}, True,
     "r9 sit deploy with the consult done but no schema_applied is denied",
     {"BINDER_BATCH_RECORD": "__fixture__", "_fixture": '{"slices":[{"id":"0.9-m3-s1","tier":"sensitive"}],"consult":"done:issuecomment-1"}'}),
    (BG, "PowerShell", {"command": "npx wrangler deploy --env sit"}, True,
     "r9 an empty schema_applied is no answer either",
     {"BINDER_BATCH_RECORD": "__fixture__", "_fixture": '{"slices":[{"id":"0.9-m3-s2","tier":"normal"}],"consult":"not-needed","schema_applied":""}'}),
    (BG, "PowerShell", {"command": "npx wrangler deploy --env dev"}, False,
     "r9 a dev deploy is not this rule's business",
     {"BINDER_BATCH_RECORD": "__missing__"}),
    # dispatch_premise 6: browserless visual dispatch
    (DP, "Agent", {"subagent_type": "sonnet-builder", "prompt": "Move the toggle in apps/web/charts.html and apps/web/charts.js. Security consult: NONE."}, True,
     "dp6 builder order naming page files without 'browser' is denied"),
    (DP, "Agent", {"subagent_type": "sonnet-builder", "prompt": "Move the toggle in apps/web/charts.html. Verify in a real browser at phone width. Security consult: NONE."}, False,
     "dp6 the same order naming browser verification passes"),
    (DP, "Agent", {"subagent_type": "sonnet-builder", "prompt": "Extend tools/check_comments.py coverage. Security consult: NONE."}, False,
     "dp6 a tooling-only order passes"),
    # dispatch_premise 7: UX decisions are the owner's (2026-08-22)
    (DP, "Agent", {"subagent_type": "sonnet-builder", "prompt": "Build 0.9-M3-S99, a NORMAL-tier page slice: a new card on apps/web/charts.html. Verify in a real browser at phone width. Security consult: NONE."}, True,
     "dp7 builder order naming page files with no owner UX ruling is denied"),
    (DP, "Agent", {"subagent_type": "sonnet-builder", "prompt": "Build 0.9-M3-S99, a NORMAL-tier page slice: a new card on apps/web/charts.html. UX decisions ruled by the owner on 2026-08-22 (chips for <=3 options, a drop-down above). Verify in a real browser at phone width. Security consult: NONE."}, False,
     "dp7 the same order citing the owner's UX ruling passes"),
    (DP, "Agent", {"subagent_type": "binder-reviewer", "prompt": "Independent review of 0.9-M3-S99 at the NORMAL tier (apps/web/charts.html). Check it in a real browser. Never edit, never merge, never rule."}, False,
     "dp7 a review order naming page files is exempt"),
]


def main():
    bad = 0
    for case in CASES:
        hook, tool, ti, expect, label = case[:5]
        extra = case[5] if len(case) > 5 else None
        denied, raw = fire(hook, tool, ti, extra)
        ok = denied == expect
        print("%s  %-5s %s" % ("pass" if ok else "FAIL",
                               "deny" if denied else "pass", label))
        if not ok:
            bad += 1
            if raw:
                print("      " + raw[:200])
    print("%d case(s), %d failed" % (len(CASES), bad))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
