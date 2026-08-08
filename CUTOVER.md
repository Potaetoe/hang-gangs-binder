# Cutover

The accounts redesign is fully built on `accounts` and none of it is
deployed. This is the sequence that changes that, in one sitting.

**Follow this file while doing it.** `REDESIGN.md` Part 8 is *why* the order
is the order and is worth reading once beforehand; it is not repeated here.
`HANDOFF.md` is what is true afterwards. `UAT.md` is the acceptance pass, and
part of it runs before you start.

---

## Read this before you begin

**This is not a push. There is a real outage in the middle of it**, and it
starts before either deploy.

Step 4 drops and recreates `submissions`. The new table has
`account_id NOT NULL`, so from that moment the **old** Worker cannot insert
either — it sends no account id. Production submissions are down from step 4
until step 6 completes, whatever you do in between. That is why the Worker
goes in before the site here: the site is useless without
`POST /auth/telegram`, and the old Worker is already broken by then.

**Do not deploy the Worker on its own ahead of this sitting.** Before step 4
the live site is the old public form, and a Worker deploy alone returns 401 to
every submitter for no gain. That is what `server/README.md`'s warning is for,
and it is the only thing it says.

### What does not come back

| Act | Reversible? |
| --- | --- |
| Clearing `submissions` (step 4) | **No.** There is no backup, and an export is not one — nothing turns plaintext back into ciphertext |
| Changing `ACCOUNT_SECRET` | **Not yet — it becomes irreversible at step 8.** It is already set, but no row carries an id derived from it, so today changing it costs nothing. The first real submission closes that |
| Deploying the accounts Worker | **Only if step 0 captured the current script.** A deploy overwrites the only copy |
| Merging `accounts` → `main` | Yes — `apps/web` *is* the build, so `git revert` restores the pages exactly |

`ACCOUNT_SECRET` is configuration in appearance and part of the stored format
in fact. Treat editing it as data loss.

### The secrets are already set — confirmed 2026-08-07

**All six exist on production, as Secrets rather than `[vars]`**, verified by
the owner from the dashboard on 2026-08-07:

```
ACCOUNT_SECRET            ADMIN_TELEGRAM_IDS        ALWAYS_ALLOW_TELEGRAM_IDS
EXPORT_TOKEN              TELEGRAM_BOT_TOKEN        TELEGRAM_GROUP_CHAT_ID
```

`ALLOWED_ORIGINS` is the one **plaintext** variable, reading
`https://potaetoe.github.io`. `DEV_LOGIN_SECRET` is **absent**, which is what
keeps `POST /auth/dev` off — that check has already passed.

This is the only way it could be confirmed: `wrangler` will not authenticate
from a non-interactive shell, so no agent can read the live secret list.

**So step 2 below is a confirmation, not an act.** Glance at the list before
you start and move on.

**Two things the list cannot tell you, and one of them is the likeliest
failure in this whole document.**

`ADMIN_TELEGRAM_IDS` exists — it does not follow that it holds *your* numeric
id, and the value is encrypted so nothing here can check. A wrong id looks
exactly like a working deployment until step 8. That is why step 8 is the
acceptance test and not a formality.

`ACCOUNT_SECRET` exists — but **it is not yet the irreversible thing.** It
becomes permanent when a row carries an id derived from it, and no production
row does: the table was cleared on 2026-08-07 and the live Worker still writes
no `account_id`, so anything added since carries `NULL`. There is still a
window in which changing it would cost nothing, and **it closes at step 8**,
the first real submission after the deploy. After that, changing it detaches
every member from their own history with no way back.

Do not take that as licence to change it. Take it as the reason the order of
this document matters.

---

## The sequence

Each step names what to see before continuing. If you cannot see it, stop
there — the steps after it assume it.

### 0 — Capture what production is now

`REDESIGN.md` Part 10 used to promise a rollback that does not exist. The live
script reports `Source: Unknown (version_upload)`: it was hand-pasted and
matches **no commit in this repository**, so there is nothing to deploy back
from. A deploy overwrites the only copy.

Open the Worker in the dashboard, copy the live script, save it **outside the
repository**. It holds no secrets — bindings and secrets are stored
separately — but do not commit it. It is a recovery artifact, not source.

Also record the live bindings, so a mistaken deploy is repaired against fact
rather than memory. Verified 2026-08-06:

```
EXPORT_TOKEN         secret, present
env.DB               D1 948f3464-e93c-4c8c-b64f-871065c3ee74
env.ALLOWED_ORIGINS  "https://potaetoe.github.io"
compatibility_date   2026-08-04
```

`server/wrangler.toml` already matches all of it, so a deploy will not
silently move production's origin policy. Worth knowing why that was checked:
**`deploy` preserves secrets but applies `[vars]` over whatever the dashboard
had**, so a variable living only in the dashboard is erased by the next
deploy.

**Continue when:** the file exists outside the repo and is not empty.
**Back out:** n/a — nothing has changed.

### 1 — Rehearse the migration on the development database

`hg_binder_db_dev`, not production. Run the same `DROP` and `schema.sql` you
are about to run for real, then submit a row through a local preview and read
it back.

**The trap this rehearsal exists to find:** `schema.sql` uses
`CREATE TABLE IF NOT EXISTS`. Run it against a database that still has the old
`submissions` and it **silently skips that table**, creates `sessions` beside
an unmigrated one, and reports success. Nothing in `dev/` can see this. The
failure surfaces on the first real submission, against `NOT NULL account_id`.

**Continue when:** a row submits and reads back under the new shape.
**Back out:** free — it is the development database.

### 2 — Confirm the secrets, do not set them

**Already done, 2026-08-07** — all six exist as Secrets. This step is a glance
at the list, not an action. It is kept as a step because it is a precondition
for everything after it, and because it was an *act* when this plan was
written; `REDESIGN.md` Part 8 step 2 still reads that way.

Two things to notice while you are looking:

**Every id binding is a Secret and none is a `[vars]` entry.** Ids are not
credentials, and that never made a `[vars]` block safe: the allowlist is the
membership oracle the whole account-id design exists to prevent, and `[vars]`
commits it to a public repository. A dashboard-only *variable* is worse in a
different way — the next deploy erases it. Secrets are private and survive a
deploy. `tools/check_server.py` now refuses a `[vars]` block naming anything
but `ALLOWED_ORIGINS`, so a regression here fails the gate rather than
shipping.

**`DEV_LOGIN_SECRET` is absent, and it must stay that way.** Its absence is the
off switch for `POST /auth/dev`.

If you ever do need to set one: use the **dashboard**, not
`wrangler secret put`. Production's hand-pasted script leaves the Worker in
version-upload state, so the CLI fails with error 10220. After step 5 this
config is what deploys, and the CLI is worth re-testing then rather than
assuming it works or stays broken.

**Continue when:** the six are listed and `DEV_LOGIN_SECRET` is not.
**Back out:** nothing was changed.

### 3 — Confirm the admin id is a secret and is yours

`ADMIN_TELEGRAM_IDS` holds **numeric** ids, comma-separated — not handles. A
handle can be changed and reused; a numeric id cannot.

You need your own numeric id, and there is a gap here worth knowing about:
`worker.js` returns it at sign-in with a comment saying it is *"so a
first-time admin can read their own id off the page"*, and **no page shows
it** (#58). Until that is built, read it after signing in from devtools →
Application → Session storage → `hgb-session` → `telegramId`.

A wrong id here **looks exactly like a working deployment** until somebody
tries to export.

**The binding exists — that is not the same as it being right.** Its value is
encrypted, so nothing outside the dashboard can check it, and step 8 is the
only thing that does. If you are confident it is yours, note that confidence
here and let step 8 be the proof rather than the surprise.

**Continue when:** the id is listed as a secret, and you know what value you
put in it.
**Back out:** free.

### 4 — Drop and migrate. POINT OF NO RETURN

```sql
DROP TABLE submissions;
```

then run the whole of `server/schema.sql`.

One step rather than two because `DROP TABLE` takes the rows, the table and
its `sqlite_sequence` entry together, and `schema.sql` then creates the new
shape. The separate `DELETE FROM sqlite_sequence` is only needed on the
clear-without-migrating path.

**The clear was already done once**, on 2026-08-07, 1 row → 0. It is **not
durable**: `main` still ships the public form and production `POST /submit`
still answers `400 Missing ciphertext` rather than `401`, so any visitor can
put a row back — and that row carries a `NULL` `account_id`, the state
accounts exists to remove. So re-run it here rather than trusting the earlier
one.

**Continue when:** the new `submissions` exists with `account_id NOT NULL`,
and `sessions` and `snapshots` exist.
**Back out:** no. Production submissions are down from here until step 6.

### 5 — Deploy the accounts Worker

From `server/`:

```bash
npx wrangler deploy
```

Then verify with the probe matrix in `server/README.md` — a few
unauthenticated requests, none of which change anything. The healthy answer
you are looking for:

```bash
EP=https://hgbinderworker.sorcererbiggz.workers.dev
curl -s -H "Origin: https://potaetoe.github.io" "$EP/snapshot"
```

**`Not authorized.` (401)** means the accounts Worker is live — the snapshot
is members-only now. `No snapshot published yet.` (404) means the deploy did
not take. These expectations come from the code, not from a live run; nothing
here has been deployed yet.

**Continue when:** the probe matrix agrees with the accounts row.
**Back out:** only via step 0's capture.

### 6 — Merge `accounts` → `main`

This publishes the site. `apps/web` is the build and CI copies it verbatim.

**Confirm the `deploy` job actually ran**, rather than that a run exists. It
is gated on `github.ref == 'refs/heads/main'`, and a run that skipped deploy
looks like a green run.

**Continue when:** CI shows `deploy` ran, and the live site serves the sign-in
page.
**Back out:** `git revert` restores the pages exactly.

The outage ends here.

### 7 — Sign in on the live site, through the real widget

**This is the one verification that cannot be done anywhere else.** BotFather
binds the widget to `potaetoe.github.io`, so it cannot render on localhost —
it says "Bot domain invalid" — and no test in this repository can substitute.

`UAT.md` has the pass to run. The minimum before you call the cutover done: a
session is minted and reaches `submit.html`.

If the widget fails to render at all, the CSP is the first suspect.
`index.html` needs `script-src 'self' 'unsafe-eval' https://telegram.org` and
`frame-src https://oauth.telegram.org`. The `'unsafe-eval'` is not optional:
`telegram-widget.js` puts `data-onauth` through a function that uses `eval`.

### 8 — One real submission, then one export

Submit through the live form as yourself, then open `admin.html` on an admin
session and decrypt.

This is the only check that proves the key, the admin id and the endpoint all
reached production intact. A wrong `ADMIN_TELEGRAM_IDS` passes everything
before it.

**This is also where `ACCOUNT_SECRET` stops being changeable.** It has been
set since 2026-08-07, but no row carried an id derived from it until this
submission. From here, changing it detaches every member from their own
history and there is no way back — the rows still decrypt, but nothing links
one person's entries to each other.

If anything about the secret is in doubt, resolve it **before** pressing
submit. This is the last cheap moment.

**Continue when:** the export decrypts and the row is yours.

### 9 — Aftercare

- Re-test `wrangler secret put` now that this config is what deploys. It
  failed with 10220 only because of the hand-pasted version-upload state.
- Work through the post-cutover half of `UAT.md`.
- Publish a snapshot so the dashboard is not empty for members.
- `DEV_LOGIN_SECRET` must still be absent from production. Check, do not
  assume.
- Update the pinned key fingerprint in the Telegram group **only if the key
  changed.** It did not, if you followed this — but a rotation and a cutover
  in the same sitting is exactly when a stale anchor gets left behind. See
  `HANDOFF.md`.
- `REDESIGN.md` becomes history at this point. `HANDOFF.md` is the operating
  document.

---

## If it goes wrong

**Before step 4**, everything is free. Stop and change nothing else.

**After step 4**, the rows are gone and the only forward is forward. The
Worker and the site can both be put back — step 0's capture for one, a
`git revert` for the other — but an empty `submissions` is the state you are
in either way.

**The data does not come back.** Nothing about steps 5 onward is destructive;
step 4 is, and no rollback reaches it.

`REDESIGN.md` Part 10 has the general form of the lesson, and it is worth
carrying: **a rollback plan naming an artifact nobody has confirmed exists is
not a rollback plan.** That one read as sound for a fortnight.
