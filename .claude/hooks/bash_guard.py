"""PreToolUse guard for Bash/PowerShell in the binder project.

Machine-holds four ruled disciplines that used to live only in briefs
and memory (owner ruling 2026-08-13: a fix in prose is not codified):

1. A push to main is a release - only git-ops on an owner order lands
   main. Deny any `git push` whose command names main.
2. Force pushes without --force-with-lease are denied (the pack allows
   force-with-lease on a rebase, nothing stronger).
3. Cross-tree git into THIS repository's tree (`git -C <path>`,
   `--git-dir`, `--work-tree`) is the containment class that caused
   the "too complex to verify" refusals - plain in-worktree git only.
   `git -C` pointed OUTSIDE the project (e.g. the Codex clone) is not
   this hook's business and passes through to normal permissions.
4. Bare `python`/`python3` hits the Microsoft Store stub on this
   machine - use `py -3` or `./run`.
Plus: `--no-verify` on git commit/push/merge never runs silently; gate
runs never go to the background (rule 6); a milestone's state is never
changed by a recalled number (rule 7, Prime self-review 2026-08-21);
a declared-file list is never written with a BOM (rule 8, until #387).

Reads the PreToolUse JSON on stdin; prints a deny decision and exits 0,
or prints nothing to fall through to the normal permission flow. Any
internal error falls through open (exit 0, no output) - this guard
narrows nothing except its named patterns. `selftest.py` beside it
fires every rule both ways.
"""
import json
import os
import re
import sys


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def norm(path):
    # Git Bash writes absolute paths as /c/Users/...; the harness and
    # Windows write C:\Users\... - fold the former into the latter so
    # the containment comparison cannot be dodged by path spelling.
    m = re.match(r"^/([a-zA-Z])/(.*)$", path)
    if m:
        path = m.group(1) + ":/" + m.group(2)
    return os.path.normcase(os.path.normpath(os.path.abspath(path)))


def main():
    data = json.load(sys.stdin)
    cmd = (data.get("tool_input") or {}).get("command") or ""
    cwd = data.get("cwd") or os.getcwd()
    is_git = re.search(r"\bgit\b", cmd)

    # 1. A push whose TARGET REF is main. Matched precisely, not by the
    # word "main" appearing anywhere - a commit message, an issue body,
    # a heredoc or a doc that merely mentions main is not a push to it
    # (that overbroad match false-fired on Prime's own work, 2026-08-18).
    # The specific refspec forms (:main, refs/heads/main, --delete main)
    # are checked on the raw command - they do not occur in prose. The
    # loose `git push <remote> main` form is checked on a quote-stripped
    # copy, so a quoted body/message saying "a push to main" does not
    # count; and it requires `git push` adjacency, so "git-ops ... push
    # to main" in prose does not match either.
    unq = re.sub(r"'[^']*'", " ", re.sub(r'"[^"]*"', " ", cmd))
    if is_git and re.search(r"\bpush\b", cmd) and (
            re.search(r":\s*(?:refs/heads/)?main\b", cmd)
            or re.search(r"\brefs/heads/main\b", cmd)
            or re.search(r"(?:--delete|(?:^|\s)-d)\s+main\b", cmd)
            or re.search(r"\bgit\s+push\s+(?:-\S+\s+)*\S+\s+main\b", unq)):
        deny("A push to main is a release (owner ruling): PR base is "
             "accounts, and main lands only through git-ops on an owner "
             "order. This command's push targets main - if it does not, "
             "rewrite the refspec so main is not the target.")

    # 2. Force push without a lease.
    if (is_git and re.search(r"\bpush\b", cmd)
            and re.search(r"(^|\s)(--force|-f)(\s|$)", cmd)
            and "--force-with-lease" not in cmd):
        deny("Force pushes are denied: use --force-with-lease (the pack "
             "allows it on a rebase), never bare --force/-f.")

    # 3. Cross-tree git into this REPOSITORY's trees. The anchor is the
    #    repository, not the session's project dir (#357, found by
    #    0.9-M1-S13's review): a session rooted AT a worktree has
    #    CLAUDE_PROJECT_DIR = the worktree, so the primary checkout is
    #    its parent and a sibling worktree is a cousin - anchoring on
    #    the project dir alone denied nothing that mattered there. Two
    #    anchors now: the primary derived textually from a path under
    #    .claude/worktrees, and git's own --git-common-dir when it
    #    answers. A target equal to the command's own cwd passes.
    project = os.environ.get("CLAUDE_PROJECT_DIR") or ""
    if is_git and project:
        roots = {norm(project)}
        marker = os.sep + ".claude" + os.sep + "worktrees" + os.sep
        np = norm(project)
        if marker in np:
            roots.add(np.split(marker)[0])
        try:
            import subprocess
            r = subprocess.run(["git", "rev-parse", "--git-common-dir"],
                               cwd=cwd, capture_output=True, text=True,
                               timeout=10)
            common = (r.stdout or "").strip()
            if r.returncode == 0 and common:
                roots.add(os.path.dirname(norm(os.path.join(cwd, common))))
        except Exception:
            pass
        here = norm(cwd)
        # Only a -C/--git-dir/--work-tree that git itself is given counts
        # (2026-08-22): prose in a quoted comment body - "never -C into
        # the primary" - used to match and refuse Prime's own issue
        # comments, the overbroad class rule 1 was narrowed for. So the
        # command is cut into segments (; && || | newline), only a
        # segment whose first word is git is read, and it is read with
        # its quoted strings removed. A `cd` inside a compound is not
        # tracked - targets resolve from the tool's cwd, as before.
        targets = []
        # Quotes are stripped from the WHOLE command before it is cut,
        # or a ";" inside a commit message halves the quote.
        for seg_unq in re.split(r"\s*(?:;|&&|\|\|?|\n)\s*", unq):
            if not re.match(r"^\s*(?:\w+=\S*\s+)*git\b", seg_unq):
                continue
            targets += re.findall(r"(?:^|\s)-C\s+(\S+)", seg_unq)
            targets += re.findall(r"--git-dir[=\s](\S+)", seg_unq)
            targets += re.findall(r"--work-tree[=\s](\S+)", seg_unq)
        for raw in targets:
            t = norm(os.path.join(cwd, raw.strip("\"'")))
            inside = any(t == r or t.startswith(r + os.sep) for r in roots)
            if inside and t != here:
                deny("Cross-tree git is the refusal class the fleet was "
                     "bitten by twice: plain in-worktree git only - cd "
                     "into the tree you own, never -C/--git-dir into the "
                     "primary checkout or another session's worktree "
                     "(from a worktree-rooted session too, #357). "
                     "(git -C outside this repository is not blocked.)")

    # 4. Bare python (Microsoft Store stub).
    if re.search(r"(?:^|[;&|(]\s*)python3?(?=\s|$)", cmd):
        deny("Bare `python` hits the Microsoft Store stub on this "
             "machine. Use `py -3` (or `./run`, which probes it).")

    # 5. Hook-skipping flags.
    if (is_git and re.search(r"\b(commit|push|merge)\b", cmd)
            and "--no-verify" in cmd):
        deny("--no-verify is denied: if a hook fails, fix the cause; "
             "skipping verification takes an explicit owner ask.")

    # 7. A milestone state change addressed by a BARE NUMBER (Prime
    # self-review, M2: Prime closed milestone 4 from a recalled number
    # and it was the wrong milestone). Acting on a recalled identifier
    # is the class the routing rule already forbids for SendMessage.
    # The honest form resolves the number from the title in the same
    # command (`select(.title == "0.9-M2")`), so a PATCH that carries
    # a literal number and no title lookup is refused.
    if (re.search(r"\bgh\s+api\b", cmd)
            and re.search(r"\bmilestones/\d+\b", cmd)
            and re.search(r"\bstate\s*=", cmd)
            and "select(.title" not in cmd):
        deny("Milestone state changes are never addressed by a recalled "
             "number (Prime self-review, 2026-08-21: the wrong milestone "
             "was closed that way). Resolve the number from the title in "
             "the same command - `gh api .../milestones --jq '.[] | "
             "select(.title == \"0.9-M2\") | .number'` - then PATCH.")

    # 8. A declared-file list written with a BOM (#387, open). PowerShell
    # 5.1's `Set-Content`/`Out-File -Encoding utf8` always writes a BOM,
    # and claim_vs_diff reads it as part of the first path: a false
    # MISMATCH that aborts a good landing. Narrow to commands that name
    # a declared list; everything else passes through.
    if (re.search(r"\b(Set-Content|Out-File)\b", cmd)
            and re.search(r"-Encoding\s+utf8\b", cmd, re.I)
            and re.search(r"declared", cmd, re.I)):
        deny("A declared-file list must be written WITHOUT a BOM until "
             "#387 lands: PowerShell 5.1's -Encoding utf8 adds one and "
             "claim_vs_diff then reports a false MISMATCH. Use "
             "[IO.File]::WriteAllText(path, text, "
             "(New-Object Text.UTF8Encoding $false)) or plain ASCII.")

    # 9. A sit deploy without its batch record (owner ruling 2026-08-21,
    # the M3 delivery shape). sit deploys once per BATCH, and a batch
    # holding a sensitive-tier slice gets one full security consult
    # over the merged batch before it deploys - "no more full consults
    # on unfinished batches". The batch record (machine-held,
    # ~/.claude/binder-fleet/batches/current.json; BINDER_BATCH_RECORD
    # overrides the path for the selftest) names the slices, their
    # tiers, and the consult's state. No record, or a sensitive slice
    # with the consult not done, and the deploy is refused. Other
    # environments (dev) are not this rule's business.
    if (re.search(r"\bwrangler\s+deploy\b", cmd)
            and re.search(r"--env\s+sit\b", cmd)):
        rec_path = os.environ.get("BINDER_BATCH_RECORD") or os.path.join(
            os.path.expanduser("~"), ".claude", "binder-fleet", "batches",
            "current.json")
        try:
            with open(rec_path, encoding="utf-8-sig") as f:
                rec = json.load(f)
        except Exception as exc:
            deny("A sit deploy needs its batch record (owner ruling "
                 "2026-08-21): %s could not be read (%s). Write the "
                 "batch record - slices, tiers, consult state - before "
                 "deploying; sit deploys once per batch." % (rec_path, exc))
        tiers = [str(s.get("tier", "")).lower()
                 for s in (rec.get("slices") or [])]
        consult = str(rec.get("consult", "")).lower()
        if "sensitive" in tiers and not consult.startswith("done"):
            deny("This batch holds a sensitive-tier slice and its security "
                 "consult is %r, not done (owner ruling 2026-08-21: one "
                 "full consult over the merged batch BEFORE it deploys). "
                 "Run binder-security Mode 2 over the batch, record "
                 "consult: \"done:<ref>\", then deploy."
                 % (consult or "absent"))
        # THE SCHEMA GOES FIRST, mechanized (2026-08-24, the sit sign-in
        # outage). OPERATIONS.md, "The schema goes first, and a sign-in is
        # what proves it did", already rules that a redeploy over an
        # existing database applies schema.sql BEFORE the Worker that
        # reads it - and server/schema.sql's own header rules the half a
        # rerun cannot do: CREATE TABLE IF NOT EXISTS skips a table that
        # exists, so a column added to an existing table (sessions gained
        # admin_via at 0.9-M3-S8) needs its ALTER run by hand. Prose did
        # not hold: this batch deployed cdc3a25's Worker over a database
        # missing both admin_log and sessions.admin_via, and every
        # sign-in answered the catch-all 500. The record states what was
        # applied; no state, and the deploy is refused.
        schema = str(rec.get("schema_applied", "")).lower()
        if not schema:
            deny("A sit deploy needs the schema applied FIRST (OPERATIONS."
                 "md, \"The schema goes first\"; mechanized 2026-08-24 "
                 "after the sit sign-in outage). The batch record carries "
                 "no schema_applied. Against a database that already "
                 "holds rows: run the duplicate-supersedes preflight, run "
                 "any ALTER a slice's new COLUMN needs (a rerun of "
                 "schema.sql CANNOT add one - CREATE TABLE IF NOT EXISTS "
                 "skips the table), then "
                 "`npx wrangler d1 execute <db> --remote --file=schema.sql "
                 "--env sit`. Record schema_applied: \"<what was applied, "
                 "at what tip>\", then deploy.")

    # 6. Backgrounded gate runs (owner ruling 2026-08-18). Three
    # builders in one wave backgrounded their gate run and idle-stopped
    # waiting on it - the harness reads that as completion and the
    # orchestrator has to nudge them awake. A gate run blocks in the
    # foreground; long is fine.
    # A Monitor is a background watcher by definition (the S29 builder
    # wrapped its ship-check in one on 2026-08-22 and idle-stopped
    # waiting for a notification that never wakes a stopped agent), so
    # the matcher now includes Monitor and the rule treats it as
    # backgrounded whatever its flags say.
    backgrounded = (data.get("tool_input", {}).get("run_in_background")
                    or data.get("tool_name") == "Monitor")
    if backgrounded:
        if re.search(r"tests[/\\]run\.mjs|tools[/\\]check\.py"
                     r"|\brun\s+(check|gate|ship-check)\b"
                     r"|tools[/\\]ship_check\.py"
                     r"|tools[/\\]\S*_suite\.py"
                     r"|dev[/\\]\S+\.test\.py"
                     r"|node\s+\S*tests[/\\]\S+\.test\.mjs", cmd):
            deny("Gate and suite runs never go to the background "
                 "(owner ruling 2026-08-18): a backgrounded gate run "
                 "makes your session read as idle-stopped and stalls "
                 "the slice. Run it foreground and let it block - the "
                 "reaper arm's ~110s is fine; raise the timeout "
                 "parameter instead of backgrounding.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # fail open: this guard only narrows its named patterns
    sys.exit(0)
