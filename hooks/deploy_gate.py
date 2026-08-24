"""deploy-gate (WORKING.md, Enforcement #3): the schema goes first.

A deploy is refused while the newest migration file is not recorded as
applied - the failure that once shut sign-in for every member was a
Worker deployed over a database missing its columns. After applying,
record it:

    npx wrangler d1 migrations apply binder-db --remote
    py -3 hooks/record.py migrations-applied <newest-file-name>

A record command standing EARLIER in an unbroken && chain also counts:
if the record fails, && never reaches the deploy. Denying that twice
taught the gate to read it (owner, 2026-08-24).
"""

import glob
import os
import re

from _common import read_input, read_state, command_of, chained, strip_quoted, deny


def newest_migration():
    directory = os.environ.get("BINDER_MIGRATIONS_DIR") or "drizzle"
    files = sorted(os.path.basename(p)
                   for p in glob.glob(os.path.join(directory, "*.sql")))
    return files[-1] if files else None


def recorded_earlier(parts, index, newest):
    pattern = re.compile(
        r"record\.py\s+migrations-applied\s+" + re.escape(newest))
    for j in range(index - 1, -1, -1):
        if parts[j + 1][1] != "&&":
            return False
        if pattern.search(parts[j][0]):
            return True
    return False


payload = read_input()
parts = chained(strip_quoted(command_of(payload)))
for index, (seg, _joiner) in enumerate(parts):
    if not re.search(r"\bwrangler\s+(deploy|versions\s+upload)\b", seg):
        continue
    newest = newest_migration()
    if newest is None:
        continue  # no migrations exist yet - nothing to be behind on
    if recorded_earlier(parts, index, newest):
        continue
    applied = read_state().get("migrations_applied")
    if applied != newest:
        deny("The schema goes first (WORKING.md, deploy-gate): newest "
             "migration is %r but the record says %r was last applied. "
             "Run: npx wrangler d1 migrations apply binder-db --remote "
             "then: py -3 hooks/record.py migrations-applied %s - and "
             "deploy again." % (newest, applied, newest))
