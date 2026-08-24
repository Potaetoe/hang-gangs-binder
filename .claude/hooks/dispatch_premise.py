"""PreToolUse guard on Agent dispatches: no order ships a false premise.

Owner ruling 2026-08-18: never assign work to an agent on a premise the
dispatcher did not verify. Born from a real abort: a landing order told
git-ops to extract a PR body "from the '## Summary' heading" of a
comment that had no such heading, and the fallback text carried a stale
SHA. The transaction caught it; this hook makes the class impossible to
dispatch.

Six checks against the dispatch prompt:
1. Every 40-hex SHA must resolve to an object in this repository.
2. Every GitHub comment id (issuecomment-N) must exist (via gh; any
   gh/network failure fails OPEN - only a definite 404 denies).
3. If the prompt quotes a markdown heading AND names comment ids, each
   quoted heading must appear in at least one of those comments.
4. A binder-git-ops order that opens a PR must carry its body inline
   between BODY-START/BODY-END markers - publishable text travels in
   the order, never by reference.
5. A builder order naming a privacy/auth module (charts-agg.js,
   worker.js, store-crypto.js) may not carry Prime's own "security
   consult: NONE" - a binder-security Mode 1 consult answers there
   (Prime self-review 2026-08-21, the S17 miss).
6. A builder order naming apps/web page files must say "browser" -
   real-browser verification is the builder's before READY (the S16
   skip).

Fail-open on internal errors, like the other guards: this narrows only
its six named classes. `selftest.py` beside it fires each both ways.
"""
import json
import os
import re
import subprocess
import sys

REPO = "Potaetoe/hang-gangs-binder"


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def main():
    data = json.load(sys.stdin)
    if data.get("tool_name") != "Agent":
        return
    ti = data.get("tool_input") or {}
    prompt = ti.get("prompt") or ""
    project = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()

    # 1. Every full SHA must resolve.
    shas = set(re.findall(r"\b[0-9a-f]{40}\b", prompt))
    for sha in list(shas)[:10]:
        r = subprocess.run(["git", "cat-file", "-t", sha], cwd=project,
                           capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            deny("False premise (owner ruling 2026-08-18): this order "
                 "names commit %s, which does not exist in the "
                 "repository. Verify every SHA before dispatching - do "
                 "not send an agent to work on an object you have not "
                 "confirmed." % sha)

    # 2 + 3. Comment ids exist; quoted headings appear in them.
    comment_ids = set(re.findall(r"issuecomment-(\d{6,})", prompt))
    bodies = []
    for cid in list(comment_ids)[:5]:
        try:
            r = subprocess.run(
                ["gh", "api",
                 "repos/%s/issues/comments/%s" % (REPO, cid),
                 "--jq", ".body"],
                capture_output=True, text=True, timeout=30)
        except Exception:
            continue  # network trouble: fail open
        if r.returncode != 0:
            if "404" in (r.stderr or "") or "Not Found" in (r.stderr or ""):
                deny("False premise (owner ruling 2026-08-18): this "
                     "order cites comment %s, which does not exist. "
                     "Fetch and read every artifact an order names "
                     "before dispatching." % cid)
            continue  # other gh failure: fail open
        bodies.append(r.stdout)
    if bodies:
        quoted = re.findall(r"[\"'“](#{1,3} [^\"'”]{2,60})[\"'”]",
                            prompt)
        for heading in quoted:
            if not any(heading in b for b in bodies):
                deny("False premise (owner ruling 2026-08-18): this "
                     "order says the heading %r is in a cited comment, "
                     "and it is not. This exact class aborted a landing "
                     "on 2026-08-18. Quote real text or carry the "
                     "payload inline." % heading)

    # 5 + 6. Builder dispatches (Prime self-review, M2). Two classes of
    # Prime's own misses, made impossible to dispatch:
    #   5. Prime triaged a security consult as NONE on a slice that
    #      reshaped how members are partitioned (S17, #396) and missed
    #      that it negated a privacy rule - the builder caught it. The
    #      triage question is not "is there a new surface" but "does
    #      this touch partitioning, aggregation, the floor, or auth".
    #      So: a builder order naming the privacy/auth modules may not
    #      carry Prime's own NONE; binder-security Mode 1 answers.
    #   6. A builder skipped real-browser verification because the
    #      brief never demanded it (S16, #390). A builder order that
    #      names page files says "browser".
    builders = {"sonnet-builder", "opus-specialist", "opus-refactor",
                "binder-executor"}
    if ti.get("subagent_type") in builders:
        # The tier is read from the DECLARED files when the order states
        # them ("Declared files: a, b" / "declared: a, b") - a docs order
        # that merely POINTS at server/schema.sql is not a sensitive
        # slice (false positive 2026-08-21 on 0.9-M3-S9). Without a
        # declared line, fall back to path mentions anywhere in the order.
        # The list ends at the first sentence end (". " or a newline), so
        # prose after it - "Point the reader at server/schema.sql" - is
        # not read as a declared path.
        declared = re.search(
            r"[Dd]eclared(?: files)?\s*(?:are|:)\s*(.*?)(?:\.\s|\n|$)", prompt)
        sensitive = None
        if declared:
            try:
                sys.path.insert(0, os.path.join(os.path.expanduser("~"),
                                                ".claude", "binder-tools"))
                import tier as tier_mod  # noqa: E402
                paths = [p.strip(" `'\".") for p in
                         re.split(r"[,\s]+", declared.group(1)) if "/" in p
                         or "." in p]
                tier_name, _ = tier_mod.tier_of(paths)
                sensitive = tier_name == "sensitive"
            except Exception:
                sensitive = None  # fall through to the mention rule
        if sensitive is None:
            sensitive = bool(re.search(
                r"(^|[\s`'\"(])(server/|server\\|\.github/workflows/"
                r"|wrangler\.toml|store-crypto|apps/web/_headers|dist/_headers"
                r"|tools/reaper\.py|tools/prime_lock\.py)",
                prompt))
        if sensitive and not re.search(r"\bsensitive\b", prompt, re.I):
            deny("Tier by file (owner ruling 2026-08-21, the M3 delivery "
                 "shape): this builder order names a sensitive-tier path "
                 "(server/, deploy configuration, crypto, the reaper, the prime lock) and never says "
                 "'sensitive'. A sensitive slice runs the full path - full "
                 "review, re-fire, Prime's ruling, the git-ops door - and "
                 "the order states that tier and its obligations. (The "
                 "per-slice security consult is retired; the batch's "
                 "consult runs over the merged batch before it deploys.)")
        pages = re.search(r"apps[/\\]web[/\\][\w.-]+\.(html|js|css)\b",
                          prompt)
        if pages and not re.search(r"\bbrowser\b", prompt, re.I):
            deny("Visual slices verify in a real browser at builder time "
                 "(M2 gate rule 1): this order names apps/web page files "
                 "and never says 'browser'. State the browser "
                 "verification the builder owes before its READY signal "
                 "(phone width first for member pages).")

        # 7. UX decisions are the owner's (owner ruling 2026-08-22: "any
        #    time you assume something is correct you should verify with
        #    me in terms of UX decisioning" - after the charts chips
        #    rendered every country as a chip). A BUILDER order that
        #    names page files must cite the owner's UX ruling for the
        #    slice - the interaction choices (control types, defaults,
        #    empty and error states, what a member sees first) were put
        #    to the owner before dispatch. Review orders are exempt.
        builder_order = re.search(r"\bBuild 0\.9-|\bbuilder\b", prompt) \
            and not re.search(r"\b(independent review|re-fire review|"
                              r"never edit, never merge)\b", prompt, re.I)
        if pages and builder_order and not re.search(
                r"UX (decisions?|ruling)[^.\n]{0,80}(owner|ruled)", prompt,
                re.I):
            deny("UX decisions are the owner's (owner ruling 2026-08-22): "
                 "this builder order names apps/web page files and never "
                 "cites the owner's UX ruling. Put the slice's UX "
                 "decisions (control types, defaults, empty/error states, "
                 "what a member sees first) to the owner first, then say "
                 "'UX decisions ruled by the owner on <date / comment>' "
                 "in the order.")

    # 4. Git-ops PR orders carry their body inline.
    if (ti.get("subagent_type") == "binder-git-ops"
            and re.search(r"\bPR\b", prompt)
            and re.search(r"\bBody\b\s*[:：]", prompt)
            and "BODY-START" not in prompt
            and not re.search(r"no PR|PR: none", prompt, re.I)):
        deny("Publishable text travels inline (owner ruling "
             "2026-08-18): a git-ops order that opens a PR carries the "
             "body between BODY-START and BODY-END markers in the "
             "order itself - never a pointer to text elsewhere. A "
             "pointer is a premise the transaction cannot safely "
             "resolve when it turns out wrong.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # fail open
    sys.exit(0)
