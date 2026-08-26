# The operator's runbook

This is the book you open when something is wrong, or about to change
hands. It is written for the operator: the person who holds the
Cloudflare account and the secrets. Every command here was checked
against Cloudflare's current documentation, and the restore section
was actually rehearsed on 2026-08-26 against a scratch database — not
just read about.

Names below are this deployment's: the worker `hang-gangs-binder`,
the database `binder-db`. A fork substitutes its own.

**The one standing rule: never rehearse anything from this book
against the live `binder-db`.** A restore overwrites the database in
place. When you want to practice — and you should, once — make a
scratch database and drill on that. Section 3 shows how.

---

## 1. Backups

A backup is a plain SQL file of everything in the database. Take one
before every upgrade, and on a calendar habit besides (weekly is
fine for a group this size).

```bash
npx wrangler d1 export binder-db --remote --output=backup-YYYY-MM-DD.sql
```

Three things to know:

- The database pauses serving queries while the export runs. For this
  database that is moments, but do it at a quiet hour anyway.
- Store the file **off Cloudflare** — a second place entirely, like an
  encrypted drive or a private storage bucket you control. A backup
  that lives only inside the account it protects is not a backup.
- The file contains member stats keyed by opaque ids, and the sealed
  identity table. Sealed rows stay sealed — unreadable without
  `DIRECTORY_SECRET` — but treat the file as private data anyway.

The export's first line is `PRAGMA defer_foreign_keys=TRUE;`. Leave it
alone; D1's own import path accepts it. But know that remote D1
commits statement by statement, so that pragma defers nothing there —
it is why section 6's migration rules exist.

## 2. Point-in-time restore (Time Travel)

D1 keeps a rewindable history of every change: 7 days back on the
free plan, 30 on the paid one. Any moment in that window can be
restored — someone deleted the wrong thing, a bad migration wrote
garbage, and you wind the database back to just before it happened.

First, see where the database stands now:

```bash
npx wrangler d1 time-travel info binder-db
```

That prints the current **bookmark** — a long id naming this exact
moment. Write it down before anything risky; it is your undo point.

To restore, pick the moment two ways:

```bash
npx wrangler d1 time-travel restore binder-db --timestamp="2026-08-26T14:00:00Z"
```

```bash
npx wrangler d1 time-travel restore binder-db --bookmark=<bookmark-id>
```

What to expect, seen in the rehearsal:

- Wrangler warns, then asks to confirm. **A restore is destructive:
  it overwrites the whole database in place** and cancels any queries
  running at that moment.
- When it finishes, it prints the bookmark of the state you just left
  — so a restore itself can be undone by restoring to that.

Restore rewinds **everything**, not just the mistake. Entries members
saved after your chosen moment are gone too. Tell the group before
you pull this lever, not after.

## 3. The rehearsal (done, and how to repeat it)

This drill was run for real on 2026-08-26, on a scratch database
named `binder-restore-drill`, on this account. Every command below is
pasted from that session and worked. To rehearse it yourself, repeat
it exactly — **on a scratch database, never on `binder-db`**.

```bash
npx wrangler d1 create binder-restore-drill
```

```bash
npx wrangler d1 execute binder-restore-drill --remote --command "CREATE TABLE drill (id INTEGER PRIMARY KEY, note TEXT); INSERT INTO drill (note) VALUES ('the numbers we care about'), ('a second row to miss');"
```

```bash
npx wrangler d1 time-travel info binder-restore-drill
```

```bash
npx wrangler d1 export binder-restore-drill --remote --output=drill-backup.sql
```

Stage the accident, then check the damage is real:

```bash
npx wrangler d1 execute binder-restore-drill --remote --command "DELETE FROM drill;"
```

Restore to the bookmark the `info` command printed, and read the rows
back:

```bash
npx wrangler d1 time-travel restore binder-restore-drill --bookmark=<bookmark-from-info>
```

```bash
npx wrangler d1 execute binder-restore-drill --remote --command "SELECT * FROM drill;"
```

In the rehearsal both rows came back exactly. The drill then dropped
the table entirely and restored a second way — from the export file:

```bash
npx wrangler d1 execute binder-restore-drill --remote --file=drill-backup.sql
```

That worked too, unedited. If an import ever fails partway, D1 rolls
the database back to how it was and you can retry safely. Two limits:
an import file caps at 5 GiB, and because remote D1 commits statement
by statement, an import into a **fresh empty** database must create
parent tables before children — D1's own exports already order the
schema that way.

Clean up after yourself:

```bash
npx wrangler d1 delete binder-restore-drill --skip-confirmation
```

When to use which restore: Time Travel while the mistake is inside
the retention window — it is exact and fast. The export file when the
window has passed, or the database itself is gone. That second case
is why section 1's backups exist.

## 4. Secret custody

Six secrets run this site. They live in the worker, set with
`npx wrangler secret put <NAME>`, and are never written into files.
List what is set with `npx wrangler secret list` — names only, never
values, which is why **you** must keep the values somewhere: a
password manager, plus one offline copy (paper counts).

The six, and what losing or leaking each means:

| Secret                  | Can it be replaced?                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DIRECTORY_SECRET`      | **No.** It seals the identity table. Lose it and every stored name and handle is unreadable forever — stats survive, names do not. Guard this one above the rest. |
| `ID_SECRET`             | **No.** It scrambles member ids and sign-in lookups. Replace it and every existing account stops matching — nobody can sign in. Same custody as above.            |
| `TELEGRAM_BOT_TOKEN`    | Yes. Message @BotFather, `/revoke`, get a fresh token, `wrangler secret put` it. Telegram sign-in is down between the two steps.                                  |
| `TELEGRAM_BOT_USERNAME` | Not secret in the usual sense (it is public), but the widget needs it to match the bot.                                                                           |
| `TELEGRAM_CHAT_ID`      | Yes — it only changes if the group itself is recreated.                                                                                                           |
| `TELEGRAM_ALLOW_IDS`    | Yes, freely. It bootstraps a fork's first admin; once real admins exist it can even sit unset.                                                                    |

The short version: the top two are custody-for-life, the rest are
plumbing. If you believe the top two have leaked **together with a
copy of the database**, no rotation un-leaks the names — read
section 7.

## 5. Code rollback

Every deploy is kept as a version. If a deploy goes bad, put the
previous one back:

```bash
npx wrangler deployments list
```

```bash
npx wrangler rollback <version-id> --message "why"
```

Leaving `<version-id>` off rolls back to the version before the
current one. `--message` also skips the interactive prompt, which
matters if you are scripting.

The one thing to think about first: **code and schema roll back
separately.** Rolling code back past a migration leaves newer tables
in the database — harmless here, since the app only refuses when the
schema is _behind_ the code, never ahead. Rolling the _database_ back
past a migration while keeping new code is the dangerous direction;
that is a schema-behind state, and the app will refuse loudly until
you re-apply migrations (section 6).

## 6. A behind-schema recovery

The symptom: pages fail loudly saying the schema is behind. The app
does this on purpose instead of limping — it means code that expects
a migration is running against a database that has not had it.

The fix is to apply what is missing:

```bash
npx wrangler d1 migrations apply binder-db --remote
```

Then tell the repo's deploy-gate the truth, naming the newest file in
`drizzle/`:

```bash
py -3 hooks/record.py migrations-applied <newest-file-name>.sql
```

If the apply itself fails partway, know how remote D1 behaves — this
was learned the expensive way on 2026-08-26:

- Remote D1 commits **statement by statement**. A migration that
  passed the whole local suite can still die mid-file in production,
  leaving the early statements applied.
- `PRAGMA foreign_keys` is refused remotely, and `defer_foreign_keys`
  silently does nothing there. The repo's migration-guard hook blocks
  both from ever shipping in a migration.
- So migrations must satisfy every foreign key **at every statement
  boundary**: rebuild parent tables before children, never lean on a
  pragma. `drizzle/0010_the-hardening.sql` is the worked example.

If production is half-migrated and confused, do not hand-patch it:
take the Time Travel bookmark, restore to just before the apply
(section 2), fix the migration file, and apply again. This is exactly
the situation the pre-upgrade bookmark in section 8 exists for.

## 7. A compromised operator account

Assume the worst honestly: whoever held the operator's Cloudflare
access saw what the server sees — including the ability to read
secrets' names, change code, and query the database. Move in this
order:

1. **Take the account back.** Change the Cloudflare password, reset
   2FA, sign out all sessions (Cloudflare dashboard → My Profile),
   and revoke every API token (My Profile → API Tokens). Wrangler
   logins are OAuth tokens — revoke those too.
2. **Freeze a copy of now.** `npx wrangler d1 time-travel info
binder-db` for the bookmark, and a full export (section 1). If the
   intruder changed data, you will want both the evidence and the
   restore point.
3. **Check what they touched.** The Cloudflare audit log (dashboard →
   Manage Account → Audit Log) shows account actions.
   `npx wrangler deployments list` shows whether unknown code was
   deployed — roll back if so (section 5).
4. **Rotate what rotates.** The bot token via @BotFather (`/revoke`),
   then `wrangler secret put TELEGRAM_BOT_TOKEN`.
5. **Say it plainly to the group.** The privacy promise is that the
   _database_ never hands over the name mapping. An intruder with
   operator access is past that promise — DESIGN.md names this as the
   accepted residual risk. If you believe secrets and a database copy
   left together, the sealed names must be treated as exposed. The
   honest remedies are the group's to choose: full purge of affected
   members, or re-keying by starting a fresh database and having
   members re-register (stats can be carried over by export/import;
   identities cannot — they re-enroll).

## 8. The normal upgrade sequence

The boring path, in order. Steps 3 and 4 are the seatbelts.

1. `git pull` the release you are moving to, then `npm ci`.
2. `npm test` — the full Playwright suite against a local throwaway
   database. Green before anything touches production.
3. Take a backup (section 1).
4. `npx wrangler d1 time-travel info binder-db` — write the bookmark
   down. This is the undo point if the upgrade goes wrong.
5. If `drizzle/` gained migration files:
   `npx wrangler d1 migrations apply binder-db --remote`, then record
   it: `py -3 hooks/record.py migrations-applied <newest-file>.sql`.
   Schema always moves before code.
6. `npm run build`, then `npx wrangler deploy`.
7. Open the site in a real browser and click through what changed.
   A deploy is not done because wrangler said success.

(Repo policy note, WORKING.md: until launch, production is the test
site and deploys go straight to the one URL. At launch this flips to
`wrangler versions upload` previews, with production moving only on
promotion after sign-off.)

## 9. Ownership transfer

Two ways to hand the binder to a new operator. The first is almost
always right.

**Hand over the account.** The site, database, secrets and history
all stay exactly where they are; only the person changes:

1. New operator takes the Cloudflare account: change the account
   email to theirs (dashboard → My Profile), then password and 2FA.
   Old operator revokes their own API tokens and wrangler logins.
2. Hand over the secret values themselves (section 4's custody copy)
   — in person or over an end-to-end-encrypted channel, never chat
   history that others can scroll.
3. Transfer the Telegram bot: @BotFather → `/mybots` → the bot →
   Transfer Bot Ownership. The new operator should then `/revoke` for
   a fresh token and `wrangler secret put` it.
4. Transfer the GitHub repository (or fork it) so deploys keep a
   source.

**Move to a fresh account** (when sharing the old account is not
acceptable): follow the fork instructions in the README on the new
account, then carry the data over — export from the old database
(section 1), import into the new one with
`npx wrangler d1 execute <new-db> --remote --file=backup.sql`, and
set the **same** `ID_SECRET` and `DIRECTORY_SECRET` values on the new
worker, or every carried identity and login stops working. Finish
with BotFather's `/setdomain` pointing at the new address. Delete the
old worker only after the new one is driven and working; the old
database only when the group says so.

---

## What this book cannot do

It cannot restore what was never backed up past the Time Travel
window, cannot recover a lost `DIRECTORY_SECRET`, and cannot undo a
leak. The habits that make it work are three: take the backups,
write the two unreplaceable secrets down twice, and capture a
bookmark before anything risky.
