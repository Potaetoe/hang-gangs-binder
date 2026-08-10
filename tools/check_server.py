#!/usr/bin/env python3
"""
Check that server/ holds nothing that must not be committed.

    python tools/check_server.py

A sibling of check_web.py rather than part of it, and the distinction is
the point. check_web.py is about **publishability**: apps/web is what
dist/ is built from and dist/ is the public site, so anything secret
landing there is public permanently - and it is public in two committed
copies. server/ is not published at all. It is dangerous for the
opposite reason - it is the directory that gets *run*, and wrangler.toml
is the file a deploy reads. Bolting this onto a checker whose whole
premise is "this directory becomes a public site" would make the premise
false.

Why it exists: #39 produced the hazard rather than arguing it. With all
six of #30's corrected sentences in place, the four numeric id bindings
were put back as a [vars] block and `python tools/check.py` passed every
check it had. That commit would have published the group's Telegram ids,
and ALWAYS_ALLOW_TELEGRAM_IDS is a membership list - the membership
oracle DESIGN.md spends most of "The identifier is the whole problem" on
preventing.

Nothing was overlooked in #30. It was structural. check_web.py is scoped
to apps/web by construction:

    WEB = os.path.join(REPO, "apps", "web")

so server/ was not partially checked. It was entirely unchecked. No check
in the gate read wrangler.toml, worker.js or server/README.md for
anything at all.

Three checks:

1. Every [vars] block names only ALLOWED_ORIGINS. An **allowlist**, not a
   denylist. A denylist of the three known id bindings passes the day
   somebody adds a fourth, which is the same shape as the bug in #34
   where the rule was right and its reach was wrong.

   Both blocks, not one. wrangler.toml has [vars] and [env.dev.vars], and
   a check reading only the first passes a paste into the second. The dev
   Worker is not a lesser place to leak a member list from: the file is
   in the same public repository either way.

2. DEV_LOGIN_SECRET is never assigned. Its **absence** is what turns
   POST /auth/dev off - see handleDevAuth - so a vars entry for it would
   silently open a development login on production. worker.js says so in
   a comment and nothing enforced it.

   Assignment, not mention. wrangler.toml names DEV_LOGIN_SECRET several
   times in prose, in order to say it must never be set. A check that
   matched the name would fail on the correct file, and the obvious fix
   for that is to weaken the check - so it strips comments first.

3. Nothing in server/ is key-shaped, using check_web's own KEY_PATTERNS.
   Those patterns guard the directory that gets published and not the
   directory that holds the deployment config, which is the wrong way
   round for a bot token: the realistic accident is pasting one into a
   config file, not into a web page.

   The patterns are **imported**, not copied. Two lists of key shapes
   drifting apart is worse than one import, and a copy would not gain the
   next shape somebody adds over there.
"""

import os
import re
import sys

import check_web

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(REPO, "server")
CONFIG_FILE = "wrangler.toml"

# The one binding that may be plaintext. It is the site allowed to POST -
# public information, and the Worker needs no editing when it changes.
VARS_ALLOWED = {"ALLOWED_ORIGINS"}

KEY_PATTERNS = check_web.KEY_PATTERNS

# [vars] and [env.<anything>.vars]. Written as a pattern rather than a
# pair of literals so a second environment is covered the day it is
# added, without this file needing to know its name.
VARS_HEADER = re.compile(r"^\[(?:vars|env\.[^.\]]+\.vars)\]$")

HEADER = re.compile(r"^\s*(\[\[?[^\]]+\]\]?)\s*$")
ASSIGN = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.*)$")
DEV_LOGIN_ASSIGN = re.compile(r"^\s*DEV_LOGIN_SECRET\s*=", re.M)


def strip_comments(text):
    """TOML comments removed, leaving a '#' inside a string alone.

    Character by character rather than by regex because the two cases
    look identical to one: wrangler.toml carries inline comments after
    quoted values, and a URL fragment is a legitimate value. Truncating
    a value is the quiet failure here - it does not raise, it just makes
    the check read something shorter than what ships.
    """
    lines = []
    for line in text.splitlines():
        kept = []
        in_string = False
        for char in line:
            if char == '"':
                in_string = not in_string
            elif char == "#" and not in_string:
                break
            kept.append(char)
        lines.append("".join(kept))
    return "\n".join(lines)


def unquote(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        return value[1:-1]
    return value


def vars_blocks(text):
    """({header: {key: value}}, problem).

    `problem` is a string when the file names no vars block at all, and
    that is deliberate rather than tidy. #34's actual lesson was that a
    parser which cannot find what it was pointed at must report rather
    than return "nothing wrong here" - every mutation against the CSP
    rules passed while the policy was simply never being read. A
    wrangler.toml with no [vars] has changed shape, and the rules below
    would pass it while reading nothing.
    """
    blocks = {}
    current = None
    for line in strip_comments(text).splitlines():
        header = HEADER.match(line)
        if header:
            name = header.group(1)
            current = name if VARS_HEADER.match(name) else None
            if current is not None:
                blocks.setdefault(current, {})
            continue
        if current is None:
            continue
        assign = ASSIGN.match(line)
        if assign:
            blocks[current][assign.group(1)] = unquote(assign.group(2))
    if not blocks:
        return {}, ("%s names no [vars] block. The file has changed shape, "
                    "and the bindings check would pass while reading "
                    "nothing" % CONFIG_FILE)
    return blocks, None


def vars_problems(text):
    """A description for every binding a vars block may not name."""
    blocks, problem = vars_blocks(text)
    if problem:
        return [problem]
    problems = []
    for header in sorted(blocks):
        for name in sorted(blocks[header]):
            if name in VARS_ALLOWED:
                continue
            problems.append(
                "%s names %s. Only %s may be plaintext; everything else "
                "is a secret set outside this repository. A [vars] entry "
                "publishes it here permanently, and the id bindings are a "
                "membership list"
                % (header, name, ", ".join(sorted(VARS_ALLOWED))))
    return problems


def dev_login_problems(text):
    """A description if DEV_LOGIN_SECRET is assigned anywhere."""
    if DEV_LOGIN_ASSIGN.search(strip_comments(text)):
        return ["DEV_LOGIN_SECRET is assigned. Its absence is what turns "
                "POST /auth/dev off, so setting it here opens a "
                "development sign-in on the deployed Worker"]
    return []


def key_shaped_problem(text):
    """A description of key-shaped content in text, or None.

    Run against the raw text, comments included: a key pasted into a
    comment is in the repository exactly as much as one pasted into a
    value, and this repository is public.
    """
    for pattern, description in KEY_PATTERNS:
        if re.search(pattern, text, re.I):
            return description
    return None


def key_shaped_hits():
    """(file, description) for anything in server/ resembling a key."""
    hits = []
    for root, _dirs, names in os.walk(SERVER):
        for name in sorted(names):
            full = os.path.join(root, name)
            rel = os.path.relpath(full, SERVER).replace(os.sep, "/")
            try:
                text = open(full, encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                continue  # binary - not where a pasted key lands
            problem = key_shaped_problem(text)
            if problem:
                hits.append((rel, problem))
    return hits


def main():
    path = os.path.join(SERVER, CONFIG_FILE)
    if not os.path.exists(path):
        print("::error::server/%s does not exist. The deploy reads it, so "
              "its absence is not a missing check - it is a missing "
              "deployment." % CONFIG_FILE)
        print("\nserver/ FAILED 1 check(s)")
        return 1

    text = open(path, encoding="utf-8").read()
    problems = []

    for problem in vars_problems(text):
        problems.append("server/%s: %s." % (CONFIG_FILE, problem))

    for problem in dev_login_problems(text):
        problems.append("server/%s: %s." % (CONFIG_FILE, problem))

    for rel, description in key_shaped_hits():
        problems.append(
            "server/%s contains %s. This repository is public - it must "
            "not be committed, and rotating is the only fix once it is."
            % (rel, description))

    if problems:
        for problem in problems:
            print("::error::%s" % problem)
        print("\nserver/ FAILED %d check(s)" % len(problems))
        return 1

    blocks, _ = vars_blocks(text)
    # Report what was established rather than the part that is easy to
    # check: "no disallowed vars" is true of a file the parser never read.
    # Naming the blocks it did read is what makes the line worth printing.
    print("server/ OK - %d vars block(s) (%s) naming only %s, no dev "
          "sign-in secret, nothing key-shaped"
          % (len(blocks), ", ".join(sorted(blocks)),
             ", ".join(sorted(VARS_ALLOWED))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
