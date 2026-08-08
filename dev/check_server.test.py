"""Contract checks for the gate's server/ scope.

`tools/check_server.py` exists because the gate had none. #39 produced the
hazard rather than arguing it: with all six of #30's corrected sentences in
place, the four numeric id bindings were put back as a `[vars]` block and
`python tools/check.py` passed all eleven checks. That commit would have
published the group's Telegram ids, and `ALWAYS_ALLOW_TELEGRAM_IDS` is the
membership oracle the whole account-id design exists to prevent.

Nothing was overlooked in #30. It was structural: `check_web.py` is scoped
to `apps/web` by construction, so `server/` was not partially checked, it
was entirely unchecked.

This suite tests the parser on strings rather than on the one file it
happens to guard, for the reason #34 paid for: every mutation ever written
against those rules passed, because a mutation exercises a *rule* and never
the parser that has to find the block before any rule can apply. It then
tests the real file, and - the check that would notice this arm rotting -
that the real file's own content is what the rules are reading.

No framework, matching the suites beside it.
"""

import os
import sys

# tools/ is not a package and these are scripts, so the import has to be
# made reachable before it can be named, which is why this sits below a
# statement rather than at the top of the file.
#
# No isort suppression here, unlike dev/check_web.test.py. This file was
# written with one, copied from there, and ruff's RUF100 refused it as an
# unused suppression - correctly: this is a single import in its own
# block and isort has nothing to reorder. A suppression that suppresses
# nothing is the kind that survives into a file where it would have
# mattered.
#
# Nor is the directive spelled out in this comment. Writing it inline as
# prose made ruff parse the comment as a real directive and warn on it,
# which is its own small version of the same problem: a gate emitting
# noise teaches you to skim past the line where it eventually says
# something.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))

import check_server

failures = 0


def check(label, condition):
    global failures
    if not condition:
        failures += 1
    print("pass " if condition else "FAIL ", label)


def toml(*lines):
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------ #
# The parser.                                                         #

blocks, problem = check_server.vars_blocks(toml(
    '[vars]',
    'ALLOWED_ORIGINS = "https://example.test"',
))
check("a vars block is parsed into its keys",
      problem is None and blocks == {"[vars]": {
          "ALLOWED_ORIGINS": "https://example.test"}})

# The detail most likely to be got wrong, and the reason this is a dict of
# blocks rather than one dict: server/wrangler.toml has TWO vars blocks. A
# check reading only the first passes a paste into the dev one, where an
# allowlist of member ids is just as published.
both, _ = check_server.vars_blocks(toml(
    '[vars]',
    'ALLOWED_ORIGINS = "https://example.test"',
    '',
    '[env.dev.vars]',
    'ALLOWED_ORIGINS = "http://localhost:8124"',
))
check("both vars blocks are found, not just the first",
      set(both) == {"[vars]", "[env.dev.vars]"})

# A block ends at the next table header. Keys belonging to something else
# must not be attributed to it - that would be a false positive, which is
# how a gate gets switched off.
scoped, _ = check_server.vars_blocks(toml(
    '[vars]',
    'ALLOWED_ORIGINS = "https://example.test"',
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    'database_id = "948f3464"',
))
check("a following table's keys are not attributed to vars",
      scoped["[vars]"] == {"ALLOWED_ORIGINS": "https://example.test"})

# An empty block is absence of keys, not absence of a block. The two must
# stay distinct or "no vars at all" and "vars with nothing in it" report
# the same way.
empty, empty_problem = check_server.vars_blocks(toml('[vars]'))
check("an empty vars block parses to no keys, not to no block",
      empty_problem is None and empty == {"[vars]": {}})

# Comments are not configuration. server/wrangler.toml's comments name
# every secret it must not contain, including DEV_LOGIN_SECRET, so a check
# that reads comments fails on the correct file - which is worse than not
# having the check, because the fix is to weaken it.
commented, _ = check_server.vars_blocks(toml(
    '# [vars]',
    '# ADMIN_TELEGRAM_IDS = "5551234567"',
    '[vars]',
    'ALLOWED_ORIGINS = "https://example.test"  # the site allowed to POST',
))
check("a commented-out block and an inline comment are both ignored",
      commented == {"[vars]": {"ALLOWED_ORIGINS": "https://example.test"}})

# A '#' inside a quoted value is part of the value. Getting this wrong
# truncates rather than crashing, which is the failure shape this
# repository keeps finding.
hashed, _ = check_server.vars_blocks(toml(
    '[vars]',
    'ALLOWED_ORIGINS = "https://example.test/#anchor"',
))
check("a # inside a quoted value does not truncate it",
      hashed["[vars]"]["ALLOWED_ORIGINS"] == "https://example.test/#anchor")

# The #34 lesson, applied. A parser that cannot find what it was pointed at
# must say so rather than returning "nothing wrong here".
missing, missing_problem = check_server.vars_blocks(toml(
    'name = "hgbinderworker"',
))
check("a file with no vars block at all is a reported problem, not a skip",
      isinstance(missing_problem, str) and missing_problem)
check("and it returns no blocks rather than a silent empty pass",
      missing == {})


# ------------------------------------------------------------------ #
# The rules.                                                          #

check("a vars block naming only ALLOWED_ORIGINS is accepted",
      check_server.vars_problems(toml(
          '[vars]',
          'ALLOWED_ORIGINS = "https://example.test"',
      )) == [])

# The hazard #39 produced, verbatim. Not a string shaped like the rule -
# the four bindings as they were actually written.
HAZARD = toml(
    '[vars]',
    'ALLOWED_ORIGINS = "https://potaetoe.github.io"',
    'ADMIN_TELEGRAM_IDS = "5551234567"',
    'TELEGRAM_GROUP_CHAT_ID = "-1001234567890"',
    'ALWAYS_ALLOW_TELEGRAM_IDS = "5551234567,5559876543"',
)
hazard_problems = check_server.vars_problems(HAZARD)
check("the exact [vars] block from #39 is refused",
      len(hazard_problems) == 3)
check("and each disallowed binding is named, so the message is actionable",
      all(any(name in p for p in hazard_problems) for name in (
          "ADMIN_TELEGRAM_IDS", "TELEGRAM_GROUP_CHAT_ID",
          "ALWAYS_ALLOW_TELEGRAM_IDS")))

# An allowlist, not a denylist. A denylist of the three known names passes
# the day somebody adds a fourth binding - the same shape as #34, where the
# rule was right and its reach was wrong.
check("a binding nobody has thought of yet is refused too",
      check_server.vars_problems(toml(
          '[vars]',
          'ALLOWED_ORIGINS = "https://example.test"',
          'SOME_FUTURE_BINDING = "whatever"',
      )) != [])

# The dev block is not a lesser place to leak from.
check("a disallowed binding in [env.dev.vars] is refused",
      check_server.vars_problems(toml(
          '[vars]',
          'ALLOWED_ORIGINS = "https://example.test"',
          '',
          '[env.dev.vars]',
          'ALLOWED_ORIGINS = "http://localhost:8124"',
          'ADMIN_TELEGRAM_IDS = "5551234567"',
      )) != [])

# DEV_LOGIN_SECRET's *absence* is what turns POST /auth/dev off, so a vars
# entry for it would silently open a development login on production. The
# Worker says so in a comment; this is what enforces it.
check("DEV_LOGIN_SECRET assigned in a vars block is refused",
      check_server.dev_login_problems(toml(
          '[vars]',
          'DEV_LOGIN_SECRET = "hunter2"',
      )) != [])
check("DEV_LOGIN_SECRET assigned anywhere is refused",
      check_server.dev_login_problems(toml(
          '[env.dev.vars]',
          'DEV_LOGIN_SECRET = "hunter2"',
      )) != [])

# And the half that keeps the check usable: the real file discusses
# DEV_LOGIN_SECRET at length in prose. Naming a secret in order to say it
# must never be set is the opposite of setting it.
check("naming DEV_LOGIN_SECRET in a comment is not an assignment",
      check_server.dev_login_problems(toml(
          '# DEV_LOGIN_SECRET is development-only and must never be set',
          '# here or on the production Worker.',
          '[vars]',
          'ALLOWED_ORIGINS = "https://example.test"',
      )) == [])


# ------------------------------------------------------------------ #
# Key-shaped content, over the directory that holds the config.       #

# check 2 guards the directory that gets published. The realistic accident
# with a bot token is pasting it into the file that holds the deployment
# config, which is this directory - the wrong way round until now.
BOT_TOKEN = "1234567890:AAH" + "E" * 32
check("a Telegram bot token in server/ config is caught",
      check_server.key_shaped_problem(toml(
          '[vars]',
          'TELEGRAM_BOT_TOKEN = "%s"' % BOT_TOKEN,
      )) is not None)
check("a PEM private key block in server/ is caught",
      check_server.key_shaped_problem(
          "-----BEGIN PRIVATE KEY-----\nMIIE\n") is not None)
check("ordinary deployment config is not key-shaped",
      check_server.key_shaped_problem(toml(
          '[vars]',
          'ALLOWED_ORIGINS = "https://potaetoe.github.io"',
      )) is None)

# The patterns are imported from check_web rather than restated. Two lists
# of key shapes drifting apart is worse than one import, and a copy would
# not gain the next shape somebody adds there.
check("the key shapes are check_web's, not a second copy",
      check_server.KEY_PATTERNS is check_server.check_web.KEY_PATTERNS)


# ------------------------------------------------------------------ #
# The real tree.                                                      #

REAL = open(os.path.join(check_server.SERVER, "wrangler.toml"),
            encoding="utf-8").read()

# The decisive pair. If the parser simply found nothing in the real file,
# every check above would still pass and this arm would be inert - a null
# result wearing a positive result's clothes.
real_blocks, real_problem = check_server.vars_blocks(REAL)
check("the real wrangler.toml parses, and its blocks are found",
      real_problem is None and
      set(real_blocks) == {"[vars]", "[env.dev.vars]"})
check("the real file's vars are what the rules are actually reading",
      all(list(keys) == ["ALLOWED_ORIGINS"]
          for keys in real_blocks.values()))

check("server/ as it stands has no disallowed vars",
      check_server.vars_problems(REAL) == [])
check("server/ as it stands assigns no DEV_LOGIN_SECRET",
      check_server.dev_login_problems(REAL) == [])
check("server/ as it stands holds nothing key-shaped",
      check_server.key_shaped_hits() == [])


if failures:
    print("\ncheck_server.py FAILED %d of 25 checks" % failures)
    sys.exit(1)
print("\ncheck_server.py OK - 25 checks")
