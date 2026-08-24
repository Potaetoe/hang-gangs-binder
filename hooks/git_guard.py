"""git-guard (WORKING.md, Enforcement #4): no force-pushes, no pushes
to the frozen old branches, no skipping checks."""

import re

from _common import read_input, command_of, segments, strip_quoted, deny

payload = read_input()
for seg in segments(strip_quoted(command_of(payload))):
    is_git_push = bool(re.search(r"\bgit\s+push\b", seg))

    if is_git_push and re.search(r"(\s|^)(-f|--force)(\s|$)", seg):
        deny("Force pushes are blocked (WORKING.md, git-guard). If a "
             "rebase truly needs one, use --force-with-lease and say so "
             "in the report.")

    if is_git_push and re.search(r"\b(old-accounts|old-main)\b", seg):
        deny("old-accounts and old-main are frozen history (the "
             "2026-08-24 reset). Nothing is pushed there, ever.")

    if re.search(r"\bgit\s+(commit|push|merge)\b", seg) and \
            "--no-verify" in seg:
        deny("--no-verify skips the checks that exist to catch us "
             "(WORKING.md, git-guard). Fix what the check refuses "
             "instead.")
