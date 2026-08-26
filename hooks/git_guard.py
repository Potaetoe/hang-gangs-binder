"""git-guard (WORKING.md, Enforcement #4): no force-pushes, no pushes
to the frozen old branches, no skipping checks - and the prose-by-file
rules (owner order 2026-08-26, after repeated PowerShell 5.1 argument
mangling): commit messages and gh bodies travel in files, never
inline, and a sign-off recording never shares a command with the
merge it unlocks unless && makes the pair atomic."""

import re

from _common import read_input, command_of, segments, strip_quoted, \
    chained, deny

payload = read_input()
command = strip_quoted(command_of(payload))

for seg in segments(command):
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

    # Prose travels by file (owner order 2026-08-26). PowerShell 5.1
    # rebuilds native-command arguments naively: any message holding a
    # double quote or a newline gets word-split into garbage - git saw
    # fragments of a commit message as pathspecs twice before this
    # rule. The file path is never wrong, so the file path is the law.
    if re.search(r"\bgit\s+commit\b", seg) and \
            re.search(r"(\s|^)(-[a-zA-Z]*m|--message(=|\s|$))", seg):
        deny("Inline commit messages are blocked (WORKING.md, "
             "git-guard): PowerShell 5.1 mangles quotes and newlines "
             "in native arguments. Write the message to a scratchpad "
             "file with the Write tool, then: git commit -F <file>.")

    if re.search(r"\bgh\s+(pr|issue|release)\b", seg) and \
            re.search(r"(\s|^)(-b|--body)(=|\s|$)", seg):
        deny("Inline gh bodies are blocked (WORKING.md, git-guard): "
             "PowerShell 5.1 mangles quotes and newlines in native "
             "arguments. Write the body to a scratchpad file with the "
             "Write tool, then use --body-file <file>.")

# A sign-off recording and the merge it unlocks in ONE command: on
# this machine the shell is PowerShell 5.1, which has no && - and with
# `;` the merge-gate reads its state BEFORE the command runs, so the
# merge is refused every time. Two separate commands, record first,
# is the only sequence that works; && chains (the Bash tool) stay
# honored, matching the merge-gate.
if re.search(r"record\.py\s+signoff\b", command) and \
        re.search(r"\bgh\s+pr\s+merge\b", command):
    parts = chained(command)
    atomic = all(
        joiner == "&&"
        for i, (_seg, joiner) in enumerate(parts) if i > 0
    )
    if not atomic:
        deny("Recording a sign-off and merging in one command is "
             "blocked (WORKING.md, git-guard): the merge-gate reads "
             "its state before the command runs, and PowerShell 5.1 "
             "has no && to make the pair atomic. Run record.py "
             "signoff as its own command first, then gh pr merge as "
             "the next command.")
