"""migration-guard (WORKING.md, Enforcement #8): what passes locally
must be shaped to survive production.

Born 2026-08-26, the day migration 0010 passed the whole local suite
and was rolled back by production. Local D1 applies a migration file
as ONE transaction; remote D1 commits it statement by statement. So
`PRAGMA defer_foreign_keys` holds a local apply together and does
nothing remotely, and `PRAGMA foreign_keys` is refused by D1 outright
- both make a migration that lies about itself.

The rule a regex CAN hold: no migration file may lean on a pragma
that behaves differently between the two worlds. The rule it cannot
hold - that a table-rebuild migration is ordered parent-first so
every statement boundary is FK-consistent - lives in the remedy text
and in the 0010 file's own comments.
"""

import glob
import os
import re

from _common import read_input, command_of, strip_quoted, deny

# Pragmas D1's remote API refuses outright.
REFUSED = re.compile(
    r"PRAGMA\s+(foreign_keys|legacy_alter_table|writable_schema|journal_mode)\b",
    re.IGNORECASE)
# Legal on D1, but scoped to one statement's transaction when wrangler
# applies the file remotely - so it silently does nothing there.
USELESS_REMOTELY = re.compile(r"PRAGMA\s+defer_foreign_keys\b", re.IGNORECASE)


def migration_files():
    directory = os.environ.get("BINDER_MIGRATIONS_DIR") or "drizzle"
    return sorted(glob.glob(os.path.join(directory, "*.sql")))


payload = read_input()
command = strip_quoted(command_of(payload))
if re.search(r"\bd1\s+migrations\s+apply\b.*--remote", command):
    for path in migration_files():
        try:
            with open(path, encoding="utf-8") as f:
                sql = f.read()
        except OSError:
            continue
        name = os.path.basename(path)
        if REFUSED.search(sql):
            deny("migration-guard: %s uses a PRAGMA that remote D1 refuses "
                 "(it rolled production back on 2026-08-26). Rewrite the "
                 "migration without it: rebuild tables PARENT FIRST so every "
                 "statement boundary satisfies every foreign key on its own - "
                 "see drizzle/0010_the-hardening.sql for the shape." % name)
        if USELESS_REMOTELY.search(sql):
            deny("migration-guard: %s leans on PRAGMA defer_foreign_keys. "
                 "Remote D1 commits a migration statement by statement, so "
                 "the deferral will not span them - it passes locally and "
                 "fails production (learned 2026-08-26). Reorder the rebuild "
                 "parent-first instead; drizzle/0010_the-hardening.sql shows "
                 "the shape." % name)
