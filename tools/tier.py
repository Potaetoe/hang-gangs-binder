#!/usr/bin/env python3
"""Assign a slice's tier from its declared file list (owner ruling
2026-08-21, the M3 delivery shape, #402; carried into ship_check.py by
#403). The tier is read from the FILES, never declared by hand:

  sensitive  any path under server/, the page-side auth/session modules,
             deploy configuration (wrangler.toml, .github/workflows/),
             or crypto. One sensitive file makes the whole slice
             sensitive.
  trivial    every path is documentation, a test, or site-configuration
             text (apps/web/site.config.js and its dist mirror).
             Nothing else.
  normal     everything in between - pages, features, tooling.

WHY THIS IS A MIRROR, NOT AN IMPORT

The rules of record are machine-held at
`~/.claude/binder-tools/tier.py`, per the M3 delivery shape and the
agent pack's own file - but #403's brief is explicit: "mirror its rules
in-repo (a fork needs them), do not import it." A fork of this
repository does not carry the operator's home directory, so a tier read
this project's own gate depends on cannot live only outside the
repository - `ship_check.py` (the required act before every builder's
terminal signal, AGENTS.md's "Verification" section) imports this file
directly, in-tree, the same way it already imports `claim_vs_diff` and
`fleet_status`. Keeping the two files in sync by hand is the accepted
cost the brief names; a later slice that finds them drifted corrects
whichever one is stale against the owner ruling, not against the other
file.

Known cost, accepted in the ruling: a comment-only edit to a sensitive
file tiers as sensitive. A later refinement may diff for comment-only
changes; until then the tier errs toward the heavier path.

Usage:
  py -3 tools/tier.py <declared-file>      one repo-relative path per line
  py -3 tools/tier.py -- path1 path2 ...   paths as arguments
Prints the tier on the first line, then one line per path naming what it
was judged as. Exit 0 always (this is a reading, not a gate); a gate
that wants to refuse reads the first line - `ship_check.py`'s own
`stage_tier()` is that gate for this repository.
"""
import re
import sys

SENSITIVE = [
    (re.compile(r"^server/"), "server"),
    (re.compile(r"^apps/web/(session|signout|auth)[^/]*\.js$"),
     "auth/session module"),
    (re.compile(r"^dist/(session|signout|auth)[^/]*\.js$"),
     "auth/session module (dist)"),
    (re.compile(r"(^|/)wrangler\.toml$"), "deploy configuration"),
    (re.compile(r"^\.github/workflows/"), "CI/deploy workflow"),
    (re.compile(r"store-crypto|crypto\.js$"), "crypto"),
]
TRIVIAL = [
    (re.compile(r"\.md$"), "documentation"),
    (re.compile(r"^tests/"), "test"),
    (re.compile(r"^dev/.*test.*\.(py|mjs)$"), "test"),
    (re.compile(r"^(apps/web|dist)/site\.config\.js$"),
     "site configuration text"),
    (re.compile(r"^tests/ROSTER$"), "test roster"),
]


def judge(path):
    """(tier, why) for one repo-relative path - "sensitive", "trivial"
    or "normal", never None for a non-empty path (the fallback IS
    "normal", per the ruling's "everything in between")."""
    p = path.strip().replace("\\", "/")
    if not p:
        return None, ""
    for rx, why in SENSITIVE:
        if rx.search(p):
            return "sensitive", why
    for rx, why in TRIVIAL:
        if rx.search(p):
            return "trivial", why
    return "normal", "page, feature or tooling"


def tier_of(paths):
    """(tier, [(path, tier, why), ...]) for a whole declared list.

    One sensitive path wins outright; an all-trivial (non-empty) list is
    trivial; every other case, including an empty list, is normal - the
    ruling's own ordering, sensitive > trivial > normal.
    """
    judged = [(p, *judge(p)) for p in paths if p.strip()]
    tiers = {t for _, t, _ in judged if t}
    if "sensitive" in tiers:
        return "sensitive", judged
    if tiers and tiers <= {"trivial"}:
        return "trivial", judged
    return "normal", judged


def main(argv):
    if len(argv) >= 2 and argv[1] == "--":
        paths = argv[2:]
    elif len(argv) == 2:
        with open(argv[1], encoding="utf-8-sig") as f:
            paths = list(f.read().splitlines())
    else:
        print(__doc__)
        return 0
    tier, judged = tier_of(paths)
    print(tier)
    for p, t, why in judged:
        print("  %-9s %s  (%s)" % (t, p, why))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
