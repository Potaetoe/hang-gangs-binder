#!/usr/bin/env python3
"""Claim-vs-diff: did this branch touch exactly what it declared?

    py -3 tools/claim_vs_diff.py <branch-or-sha> <base> [--declared FILE]

0.9-M0-S13 (#297, M0 batch ruling; audit F10/F11). The mechanism a
git-ops merge order runs at the door before any merge lands: the
branch's REAL `git diff --name-status` against `base` (from their
merge-base, so the answer is "what this branch changed" and not "what
also changed on base since it forked") compared against the file list
a CLAIM or completion comment declared. The W2-era lesson, as code: a
declared file list is a claim by the agent that wrote it, same as a
death certificate is in `tools/reaper.py`, and the only thing it is
trusted for is telling this program where to look - the diff itself is
what decides.

EXIT CODES, and nothing else decides them:

  0  MATCH   - the declared set is exactly the touched set.
  1  MISMATCH - the sets differ. Both directions are always printed,
     even when one side is empty, because "empty" is itself a fact
     worth being able to grep for: DECLARED-BUT-UNTOUCHED names a path
     the completion claimed but the diff never touched; TOUCHED-BUT-
     UNDECLARED names a path the diff touched that nothing declared.
     A git-ops door check reading this abort naming the delta both
     directions.
  2  COULD NOT ASK - a ref does not resolve, the two refs share no
     merge-base, git did not answer inside the bound below, or the
     declared list is empty against an empty diff and --allow-empty was
     not passed (NOTHING DECLARED - review finding B3/S13-F3: "nothing
     to compare" is not the same fact as "the declared set is exactly
     the real diff", and it is what a forgotten --declared produces
     too, so it is refused rather than read as a silent match). This is
     never conflated with 1: "the question could not be asked" and
     "the question was asked and the answer was no" are different
     facts, and a caller that greps for exit-nonzero-means-abort still
     gets the abort either way while a caller that wants to tell them
     apart can.

BOUNDED SUBPROCESSES, REIMPLEMENTED RATHER THAN IMPORTED

`tools/reaper.py` already carries this discipline - every git child
started with stdin closed, prompting off, optional locks off, and a
hard wall-clock timeout, because a git that decides to ask a question
with no terminal to ask it of waits for as long as it is allowed to.
This file reimplements the same three-lock pattern rather than
importing `reaper.git`: a git-ops door check has to run this tool
standalone, with no dependency on a sibling module that a different
0.9-M0 slice owns and might change shape under it. The DISCIPLINE is
what is reused; the code is written fresh, once, here.

WHY `-M` IS ALWAYS PASSED TO `git diff`

Rename detection is normally a matter of the running machine's
`diff.renames` config, which means the same two commits could report a
rename as one `R100 old new` record on one machine and as a `D old` +
`A new` pair on another. Either shape ends up naming both paths in the
touched set this file computes (see `touched_paths` below), so the
comparison this tool exists to make is not affected either way - but
forcing `-M` here means the shape itself does not depend on whoever's
git config happens to be active, which is one fewer thing a door check
has to trust about the machine it runs on.

PER AUDIT F10: PRIME MAY RUN THIS AGAINST ITS OWN SUMMARIES

The comparison this file makes - a declared file list against a real
diff - is not specific to a git-ops merge order. A completion summary
IS a declared file list in the same shape a CLAIM comment is, and
`compare()` below takes the branch, the base and the declared text as
plain arguments with no git-ops-specific state threaded through them.
Prime checking one of its own summaries before posting it is the same
call this door check makes, pointed at a different pair of refs - no
special mode, no second entry point, nothing to build.
"""

import argparse
import os
import subprocess
import sys

# A return code no git command produces itself, so a timeout is never
# read as an ordinary git failure - the same reasoning tools/reaper.py
# states for its own GIT_TIMED_OUT, reused here as a value rather than
# an import (see the module docstring: the discipline is reused, the
# code is not).
GIT_TIMED_OUT = -9999

# Wall-clock bound on every git child this file starts. A door check
# that can wait forever is worse than one that refuses, because a
# refusal is visible in a merge order's report and a wait reads as
# nothing happening at all until somebody goes looking.
GIT_TIMEOUT = 120


def git_environment():
    """The environment every git child here is started with.

    Prompting OFF is the root of the hang class rather than a
    mitigation of it: a git that decides to ask a question, with no
    terminal to ask and nobody to answer, waits for as long as it is
    allowed to. `GIT_DIR` and `GIT_WORK_TREE` are dropped because they
    override `-C`, inherited from a caller's shell they would silently
    point every question below at a different repository than the one
    `--repo` named.
    """
    environment = dict(os.environ)
    environment["GIT_TERMINAL_PROMPT"] = "0"
    environment["GIT_OPTIONAL_LOCKS"] = "0"
    environment.pop("GIT_DIR", None)
    environment.pop("GIT_WORK_TREE", None)
    return environment


def git(repo, *args):
    """(returncode, stdout+stderr) for a git command that cannot hang."""
    try:
        done = subprocess.run(
            ["git", "-C", repo, *args],
            capture_output=True, text=True,
            stdin=subprocess.DEVNULL,
            timeout=GIT_TIMEOUT,
            env=git_environment(),
        )
    except subprocess.TimeoutExpired:
        said = ("`git %s` in %s did not answer within %s seconds and was "
                "killed" % (" ".join(args), repo, GIT_TIMEOUT))
        return GIT_TIMED_OUT, said
    except OSError as problem:
        said = ("`git %s` in %s could not be run at all: %s"
                % (" ".join(args), repo, problem))
        return GIT_TIMED_OUT, said
    return done.returncode, done.stdout + done.stderr


def resolve(repo, ref):
    """(the full 40-char SHA, or None) plus a problem sentence either way."""
    code, out = git(repo, "rev-parse", "--verify", "--quiet", ref)
    if code == GIT_TIMED_OUT:
        return None, out
    out = out.strip()
    if code != 0 or len(out) != 40:
        return None, "%r does not resolve to a commit in %s" % (ref, repo)
    return out, None


def merge_base(repo, base_sha, branch_sha):
    """(the merge-base SHA, or None) plus a problem sentence either way.

    Diffing FROM the merge-base rather than from `base` directly is
    what makes the answer "what this branch changed" instead of "what
    differs between two tips that may also have diverged on base's own
    side" - a branch cut before a later, unrelated commit landed on
    base must not have that later commit's files show up as something
    IT touched.
    """
    code, out = git(repo, "merge-base", base_sha, branch_sha)
    if code == GIT_TIMED_OUT:
        return None, out
    if code != 0:
        return None, ("no merge base between %s and %s: %s"
                      % (base_sha[:12], branch_sha[:12], out.strip()))
    return out.strip(), None


def diff_entries(repo, since_sha, branch_sha):
    """[(status, (path,) or (old, new))] for the real name-status diff.

    `-z` throughout: a normal `--name-status` listing quotes a path
    holding non-ASCII or special bytes in a C-style-escaped string, and
    parsing that back out by hand is exactly the kind of "looks right
    on the paths I tried" code this tool cannot afford. `-z`'s NUL-
    terminated records are git's own documented way around it, at the
    cost of splitting the output by hand instead of by line - done
    below.
    """
    code, out = git(repo, "diff", "--name-status", "-M", "-z",
                    since_sha, branch_sha)
    if code == GIT_TIMED_OUT:
        return None, out
    if code != 0:
        return None, "git diff failed: %s" % out.strip()
    tokens = out.split("\0")
    if tokens and tokens[-1] == "":
        tokens.pop()
    entries = []
    i = 0
    while i < len(tokens):
        status = tokens[i]
        i += 1
        if status[:1] in ("R", "C"):
            if i + 1 >= len(tokens):
                return None, "truncated rename/copy record in diff output"
            old, new = tokens[i], tokens[i + 1]
            i += 2
            entries.append((status, (old, new)))
        else:
            if i >= len(tokens):
                return None, "truncated record in diff output"
            entries.append((status, (tokens[i],)))
            i += 1
    return entries, None


def touched_paths(entries):
    """Every path the diff names, old and new sides both.

    A rename or a copy touches TWO paths from a claim's point of view:
    the old one stopped existing there and the new one started, so a
    completion that declared either name is describing something real
    about this diff. A pure deletion touches only the path it removed;
    a pure addition touches only the path it created; an ordinary
    modification touches its one path.
    """
    paths = set()
    for _status, parts in entries:
        paths.update(parts)
    return paths


def parse_declared(text):
    """The path set out of a completion-comment-shaped file list.

    One path per line is the documented contract, but this is
    deliberately forgiving of the shape this fleet's own CLAIM and
    completion comments actually use - a markdown bullet, a backtick-
    quoted path, then a dash and prose ("`tools/reaper.py` - new. The
    ... machine."), because the source text is written by a person-
    shaped process, not by this tool. A line is, in order: stripped of
    surrounding whitespace; dropped if blank or a `#` comment; stripped
    of one leading `-` or `*` bullet marker; read as the text inside
    the first matching pair of backticks, double, or single quotes if
    one opens the line, else the ENTIRE remainder of the line, never
    only its first whitespace-delimited token: an undecorated line
    already IS one path, per this docstring's own "one path per line"
    contract, so splitting it on whitespace would truncate any
    space-containing path at its first space (review finding B1/
    S13-F1). The result is normalized to forward slashes and a leading
    `./` is dropped, so a path copied out of a Windows terminal and a
    path copied out of a Linux one land on the same set.
    """
    declared = set()
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line[:1] in ("-", "*"):
            line = line[1:].strip()
        if not line:
            continue
        wrapper = line[0] if line[0] in ("`", '"', "'") else None
        if wrapper:
            end = line.find(wrapper, 1)
            candidate = line[1:end] if end != -1 else (
                line.split()[0] if line.split() else "")
        else:
            candidate = line
        candidate = candidate.strip().rstrip(",").replace("\\", "/")
        if candidate.startswith("./"):
            candidate = candidate[2:]
        if candidate:
            declared.add(candidate)
    return declared


def compare(repo, branch, base, declared_text, allow_empty=False):
    """("match" | "mismatch" | "error", the printable report).

    `allow_empty` guards one specific collapse (review finding B3): an
    empty declared list against a branch already contained in base
    (merge_base == branch_sha, so the diff is empty too) is otherwise
    two literally empty sets, which is not the same fact as "the
    declared set is exactly the real diff" - an empty diff is exactly
    what an accidentally-empty declaration (a forgotten --declared, a
    stdin fed nothing) would also produce, so the two are refused
    together at exit 2 unless the caller opts in explicitly.
    """
    branch_sha, problem = resolve(repo, branch)
    if problem:
        return "error", "could not resolve branch %r: %s" % (branch,
                                                               problem)
    base_sha, problem = resolve(repo, base)
    if problem:
        return "error", "could not resolve base %r: %s" % (base, problem)
    since, problem = merge_base(repo, base_sha, branch_sha)
    if problem:
        return "error", problem
    entries, problem = diff_entries(repo, since, branch_sha)
    if problem:
        return "error", problem

    touched = touched_paths(entries)
    declared = parse_declared(declared_text)
    untouched = sorted(declared - touched)
    undeclared = sorted(touched - declared)

    lines = [
        "repo       %s" % repo,
        "base       %s @ %s (merge-base with branch: %s)"
        % (base, base_sha[:12], since[:12]),
        "branch     %s @ %s" % (branch, branch_sha[:12]),
        "declared   %d path(s): %s"
        % (len(declared), ", ".join(sorted(declared)) or "none"),
        "touched    %d path(s): %s"
        % (len(touched), ", ".join(sorted(touched)) or "none"),
        "",
        "DECLARED-BUT-UNTOUCHED (%d): %s"
        % (len(untouched), ", ".join(untouched) or "none"),
        "TOUCHED-BUT-UNDECLARED (%d): %s"
        % (len(undeclared), ", ".join(undeclared) or "none"),
    ]
    if not declared and not touched and not allow_empty:
        lines.append(
            "\nNOTHING DECLARED: the declared file list is empty and "
            "the diff is empty too - this is never silently a match. "
            "Pass --allow-empty if an empty declaration against an "
            "empty diff is genuinely intended (e.g. a branch already "
            "merged into base with nothing new to declare); otherwise "
            "this reads as a forgotten declaration, not a real no-op.")
        return "error", "\n".join(lines)
    if untouched or undeclared:
        lines.append("\nMISMATCH: the declared file list is not the real "
                     "diff. Abort the merge and ask what actually moved.")
        return "mismatch", "\n".join(lines)
    lines.append("\nMATCH: the declared file list is exactly the real "
                 "diff.")
    return "match", "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="py -3 tools/claim_vs_diff.py",
        description="Compare a branch's real diff against a base to a "
                    "declared file list. Exit 0 on an exact match, 1 on "
                    "a named mismatch, 2 if the question could not be "
                    "asked at all.")
    parser.add_argument("branch", help="the branch or SHA under review")
    parser.add_argument("base", help="the base ref to diff against, "
                                     "compared from their merge-base")
    parser.add_argument("--declared", default=None,
                        help="path to the declared file list; omit or "
                             "pass - to read it from stdin, one path per "
                             "line (a completion comment's own shape)")
    parser.add_argument("--repo", default=None,
                        help="repository to run git in (default: this "
                             "file's own repository)")
    parser.add_argument("--allow-empty", action="store_true",
                        help="allow an empty declared list to match an "
                             "empty diff. Default: refused at exit 2, "
                             "naming 'nothing declared', since this "
                             "combination is usually a forgotten "
                             "declaration rather than a real no-op "
                             "branch.")
    args = parser.parse_args(argv)

    repo = os.path.abspath(args.repo or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))))

    try:
        if args.declared in (None, "-"):
            declared_text = sys.stdin.read()
        else:
            with open(args.declared, encoding="utf-8") as handle:
                declared_text = handle.read()
    except OSError as problem:
        print("could not read the declared file list: %s" % problem)
        return 2

    status, report = compare(repo, args.branch, args.base, declared_text,
                             allow_empty=args.allow_empty)
    print(report)
    return {"match": 0, "mismatch": 1, "error": 2}[status]


if __name__ == "__main__":
    sys.exit(main())
