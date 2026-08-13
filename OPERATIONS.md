# Operations

Running, deploying, and handing over the deployed system. `DESIGN.md`
says why; this file says how. Statements about *current* live state
(what is deployed right now, who confirmed a secret and when) belong in
issues, not here.

**Paragraphs tagged `[pre-cutover]` describe the deployment as it runs
today, before `CUTOVER.md` is executed.** The aftercare step of the
cutover deletes every tagged paragraph; everything untagged describes
the accounts system this repository builds.

## What runs where

| Piece | Where | Deployed by |
| --- | --- | --- |
| The site (`apps/web`) | GitHub Pages, `potaetoe.github.io/hang-gangs-binder` | CI, on push to `main` |
| The Worker (`server/worker.js`) | `hgbinderworker.sorcererbiggz.workers.dev` | by hand, `npx wrangler deploy` from `server/` |
| The database | D1 `hg_binder_db` | schema by hand, `wrangler d1 execute` |
| Development pair | `hgbinderworker-dev` + `hg_binder_db_dev` | same commands with `--env dev` |

The site and the Worker deploy independently, so the repository and the
endpoint can disagree; the probe matrix below is how to learn which
Worker is actually answering, from fact rather than memory.

## Routes and who may call them

| Route | Who | What it does |
| --- | --- | --- |
| `POST /auth/telegram` | anyone, allowed origin | verifies a login payload, issues a session |
| `POST /auth/dev` | `DEV_LOGIN_SECRET` **and** loopback origin | development sign-in; `404` everywhere else |
| `DELETE /session` | any session, its own | deletes that session's row; the pages send it on sign out |
| `GET /me` | any session | entry count, last submission, admin flag, own account id |
| `GET /my-entries` | member session | this account's own rows — id, receipt time, whether superseded, and the sealed bytes as stored. Bounded; the cap is a constant in `server/worker.js` |
| `POST /submit` | member session | appends one ciphertext row, tagged with the account id |
| `GET /export` | admin | returns every row |
| `POST /snapshot` | admin | replaces the published aggregate |
| `GET /snapshot` | any session | returns it — members only |
| `DELETE /snapshot` | admin | takes it down |
| `DELETE /submission/:id` | admin | removes one row |
| `GET /content` | anyone, allowed origin | returns the site copy overrides — **no credential, deliberately** |
| `POST /content` | admin | sets one name; last write of a name wins |
| `DELETE /content/:name` | admin | removes one name, so the page falls back to its shipped copy |
| `GET /membership` | admin | lists the rows — account id, role, label, added date |
| `POST /membership` | admin | adds or relabels one person, sent as a numeric Telegram id |
| `DELETE /membership/:role/:id` | admin | removes one row |

`GET /content` is the only route here that answers without a
credential, and the argument for it is in `server/worker.js` above
`handleReadContent`: the values stand in for bytes anybody can already
fetch from the published site, so gating them would promise a
confidentiality the fallback does not have. What follows is a rule, not
a preference — **nothing about a person goes in that table.** The lists
of people are `membership`, on their own routes, admin in every
direction.

`EXPORT_TOKEN` opens every admin route as break-glass. It is not a
member, so the two routes that need an account refuse it: it cannot
submit — there is no account to write to — and it cannot read
`GET /my-entries`, because that answer is one member's and the token is
nobody. Neither withholds anything from it; `GET /export` is the whole
corpus.
Session lifetimes are constants in `server/worker.js` (member seven
days, admin two hours — the admin session opens the whole corpus's
ciphertext), and an admin session nobody is using stops working well
before its cap: the idle window is a constant in the same file, and any
authenticated request slides it. The two admin `DELETE` routes are
idempotent: deleting what
is not there succeeds, so a success does not prove a row existed.
`DELETE /session` is not, and the difference is deliberate — a token
resolving to no row is refused with 401 rather than thanked, because
telling somebody they are signed out when they are not is the failure
that route exists to close. `EXPORT_TOKEN` is refused there too: it is a
secret rather than a session, so there is no row to delete and ending it
means rotating it.

`[pre-cutover]` The deployed Worker still runs the pre-accounts routes:
an open `POST /submit`, `EXPORT_TOKEN` on the read paths, an ungated
`GET /snapshot`, no auth routes, no `DELETE /session`, no per-row
delete, and neither the `/content` nor the `/membership` routes. **Do not deploy `server/worker.js` ahead of the cutover** —
against the live site it returns 401 to every submitter, and the new
schema's `NOT NULL account_id` refuses the old form's rows. The ordering
inside the sitting is `CUTOVER.md`'s.

## Secrets

All set in Cloudflare (dashboard → Worker → Settings → Variables and
Secrets), never in this repository, never handled by an agent.

**Production carries six, each a Secret, plus one plaintext variable:**

| Name | What it is |
| --- | --- |
| `EXPORT_TOKEN` | break-glass admin credential; keep it reachable *without* the site — it exists for when sign-in is broken |
| `TELEGRAM_BOT_TOKEN` | from BotFather; verifies every login payload; never logged. Leak costs a `/revoke` and a re-paste |
| `ACCOUNT_SECRET` | the HMAC key behind every account id — **see below** |
| `ADMIN_TELEGRAM_IDS` | comma-separated **numeric** ids, not handles. One of the two admin lists — see "Making someone an admin" |
| `TELEGRAM_GROUP_CHAT_ID` | optional; set, only members of that group may sign in — unset means anyone with a Telegram account can |
| `ALWAYS_ALLOW_TELEGRAM_IDS` | ids that skip the group check; the way back in if the bot is removed from the group |
| `ALLOWED_ORIGINS` (plaintext var) | origins allowed to call the Worker; setting it *replaces* the defaults |

The id lists are Secrets even though ids are not credentials: a
`[vars]` block would commit the group's membership to a public
repository (the oracle `DESIGN.md` forbids), and a dashboard-only
variable is silently erased by the next deploy. Secrets have both
properties the ids need. The gate refuses a `[vars]` block naming
anything but `ALLOWED_ORIGINS`.

**`ACCOUNT_SECRET` is permanent the moment one stored row carries an id
derived from it.** Changing it after that detaches every member from
their own history — the rows still decrypt, but nothing links one
person's entries to each other, and there is no way back. Generate it
once, store it beside the private key, and treat editing it as data
loss. It looks like configuration and is part of the stored format.

**The development Worker carries exactly three** — `ACCOUNT_SECRET`
(its own value, not production's), `DEV_LOGIN_SECRET`, `EXPORT_TOKEN` —
and must not carry more. The Telegram bindings are deliberately absent:
no development path reads them. `DEV_LOGIN_SECRET` must **never** exist
on production; its absence is what turns `POST /auth/dev` off.

## Deploying the Worker

From `server/`, and read the reasoning comments in
`server/wrangler.toml` before touching it:

```bash
npx wrangler deploy --env dev      # development
npx wrangler deploy                # PRODUCTION - the bare command is production
```

**`--env dev` is the whole risk.** Dry-run first and read the bindings
back: a dev deploy must report `hg_binder_db_dev` and localhost
origins. Schema changes:

```bash
npx wrangler d1 execute hg_binder_db_dev --remote --file=schema.sql --env dev
```

Wrangler authenticates from an agent shell; the first call in a session
may fail once with error 10000 and succeed on retry (`wrangler whoami`
misdescribes the state — diagnose with a real subcommand). `deploy`
preserves Secrets and applies `[vars]` over the dashboard's.

**Applying the file is no longer purely additive, and one statement in
it can fail.** `schema.sql` drops the old `supersedes` index and
recreates it as UNIQUE under a new name, so it has a pre-flight. Take a
backup first — "Backing up the submissions" below says always, and this
is the case it means — then ask the database whether the rule can be
true of the rows it already holds:

```bash
npx wrangler d1 execute hg_binder_db_dev --remote --env dev \
  --command "SELECT supersedes, COUNT(*) FROM submissions WHERE supersedes IS NOT NULL GROUP BY supersedes HAVING COUNT(*) > 1;"
```

**Zero rows is the only answer that may proceed.** Anything it returns
is a submission corrected twice — two rows claiming to replace one
entry, which the design allows exactly one of. Resolve those before
applying the file: open `admin.html`, decrypt, decide which correction
is the member's real one, and remove the other with
`DELETE /submission/:id`. Ask the member if it is not obvious from the
plaintext; guessing here deletes a measurement.

**Which databases need the pre-flight is a question about the table, not
about the environment.** Run it wherever `submissions` already carries a
`supersedes` column with rows under it. A database predating the column
has nothing to check, and the query answers with an error rather than
with zero rows: there the column and its unique index arrive together in
the first application of this file, and no row is old enough to have
broken a rule that did not exist. `CUTOVER.md` is where that first
application happens for production, and the pre-flight belongs to every
run of the file after it.

**Skipping it costs more than a failed command, because the failure is
not clean.** The `DROP` is a separate statement and it commits; the
`CREATE UNIQUE INDEX` after it is what refuses. A run that hits
duplicates therefore leaves the table with **no index on `supersedes`
at all** — not the old one, not the new one. Nothing breaks visibly:
`GET /me` still answers, more slowly, and the chain rule is enforced
only by the endpoint's own check with nothing underneath it. The
recovery is to resolve the duplicates and run the file again; `DROP
INDEX IF EXISTS` makes the second run safe from either state. Check
which indexes are actually there rather than assuming, before and
after:

```bash
npx wrangler d1 execute hg_binder_db_dev --remote --env dev \
  --command "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='submissions';"
```

*Verification label:* the failure mode above was reproduced against
SQLite 3.50.4 through Python's `sqlite3.executescript`, which is the
same engine D1 runs. **It has not been run through `wrangler d1
execute`** — no wrangler command was issued — so whether D1 wraps a
`--file` run in one transaction of its own is untested here. The
pre-flight and the recovery are written to be correct either way: if D1
does wrap it, the run rolls back and the old index survives, which is a
better outcome than the one described and needs no different action.

`[pre-cutover]` Production's live script was hand-pasted, which leaves
the Worker in version-upload state: `wrangler secret put` fails there
with error 10220 for anyone, and the dashboard is the tool for secrets
until the first repository deploy. Re-test the CLI after cutover.

## Checking a deployment

None of these need a credential and none change anything:

```bash
EP=https://hgbinderworker.sorcererbiggz.workers.dev
curl -s -H "Origin: https://potaetoe.github.io" "$EP/snapshot"
```

| Answer | Meaning |
| --- | --- |
| `Not authorized.` (401) | **accounts Worker live** — snapshot is members-only |
| `No snapshot published yet.` (404) | pre-accounts Worker, nothing published |
| `Origin not allowed.` (403) | the `Origin` header was omitted — not a fault |
| a 500 | the `snapshots` table is missing |

And `POST /auth/telegram` with an empty JSON body: `401` is the
accounts Worker refusing an unsigned payload; `404` is the pre-accounts
Worker, which has no such route. `POST /auth/dev` must return `404` on
production — its presence would be a sign-in bypass.

What no local test can see: that `DB` is bound, the secrets are set,
and the tables exist. A Worker missing any of them passes every suite
and fails on the first real request — a wrong `TELEGRAM_BOT_TOKEN`
refuses every sign-in with the same 401 a tampered payload gets, and a
wrong `ADMIN_TELEGRAM_IDS` looks exactly like a working deployment
until somebody tries to export.

## The keys

| Key | Public half | Private half |
| --- | --- | --- |
| **Production** | `config.js`, `potaetoe.github.io` arm | held offline by the owner |
| **Development** | `config.js`, `localhost` arm | held offline by the owner |
| **Throwaway** | `dev/test-key.json` | committed on purpose; protects nothing |

A fourth secret gets confused with these and is not a keypair:
`TELEGRAM_BOT_TOKEN` has no halves and losing it costs a revoke.
Losing either private key above costs the data encrypted to it,
permanently.

**Generate:** `./run keygen`, then <http://127.0.0.1:8125/keygen.html>,
on the keyholder's own machine. It verifies the halves agree before
showing either. Save the key file somewhere safe, make the second copy
the same day, paste the `publicKey` line into `config.js`.

**Check a key you already have:** `./run serve-root`, then
<http://127.0.0.1:8124/tools/keycheck.html>. It names which key a file
is, and proves function by decrypting a real `ciphertext` value. Its
Self-test decrypts the committed fixture with the throwaway key — if
that fails the tool is broken, not your key.

**Rotate:** the new holder generates a fresh keypair and publishes its
public half in `config.js`; old rows still need the old key, so the old
key is **archived, not destroyed**. A rotation has a second step that
is not optional: **update the pinned fingerprint message in the
Telegram group in the same sitting.** `your-page.html` shows the key it
actually encrypts with; the pinned message is the anchor members
compare against, and a stale anchor teaches everyone to ignore the one
alarm the mechanism can raise. Nothing enforces this — no agent can see
a Telegram group.

## Backing up the submissions

**The rows are the second irreplaceable thing here, and until now only
the first had a procedure.** `server/schema.sql` says why the other two
tables need none: a session is reissued by signing in, and a snapshot
is rebuilt by pressing Publish again. `submissions` has no way back. A
dropped table, a mistaken `DROP`/recreate during a schema change, or an
account-level problem at the provider all end the weight-over-time
history this project exists to accumulate — the same loss as a lost
private key, by a different route.

**A backup is ciphertext in and ciphertext out.** It never touches the
private key, so taking one is not a decryption event and puts plaintext
nowhere new. That is what makes this routine rather than ceremonial.
What it does carry in the clear is the `account_id` column: an HMAC
that groups a person's rows without naming them (`DESIGN.md`, "The
identifier"), which is why a backup is still a thing to keep somewhere
rather than a thing to leave lying about.

**Taking one.** Wrangler's export command, run from `server/`. Here the
**database name** is what chooses the arm — not `--env dev`, which is
how the deploy and schema commands above choose it:

```bash
npx wrangler d1 export hg_binder_db --remote --output=binder-YYYY-MM-DD.sql
npx wrangler d1 export hg_binder_db_dev --remote --output=binder-dev-YYYY-MM-DD.sql
```

The bare command writes schema *and* rows; `--table submissions`
narrows it to the irreplaceable one, and `--no-schema` gives rows only.
Open the file afterwards — it is text. A backup with no `INSERT` in it
is the exact failure this procedure exists to prevent, and it arrives
looking like a success.

**Where it lives: offline, two copies, and never in the same place as
the private key.** The custody pattern is the key file's, in "The keys"
above; the separation is the point. A backup beside the key is the
whole corpus in the clear in one drawer, and the two guard against
different losses — the key against a lost backup, the backup against a
lost provider. Storing them together halves what either is worth.

**How often is a question about rows, not about the calendar.** Nothing
here changes on a schedule, so a weekly ritual would mostly copy the
same file. Take one when the database holds submissions nobody could
reproduce: after a sitting that added entries, and **always immediately
before a schema change**, because the accounts migration DROPs and
recreates on purpose and `server/schema.sql` says so at length.

**Restoring** plays the file back through the same command that applies
the schema:

```bash
npx wrangler d1 execute hg_binder_db_dev --remote --file=binder-YYYY-MM-DD.sql --env dev
```

An export carrying the schema restores into a database that does not
already have those tables, and the rows carry their own `id` values, so
replaying one over a populated table is a collision rather than a
merge. Whether the answer is to empty the target first or to keep a
`--no-schema` export beside the full one is a decision to make in the
rehearsal, once — not on the day it is needed.

**Re-apply `server/schema.sql` after any restore, and read the index
list back.** An export writes the indexes the database had on the day it
was taken, so one taken before `supersedes` became unique restores the
*old*, non-unique index — quietly, as part of a command that reports
success. The chain rule then rests on the endpoint's own check with
nothing under it, which is the state "Deploying the Worker" above
describes and the same state a half-finished migration leaves. The
restore is not finished until the file has been applied over it and the
index list says `submissions_supersedes_unique`; the pre-flight there
applies to this run too, because a restore is exactly how a corpus with
duplicate pointers comes back.

**Rehearse the restore against the development arm before it is ever
needed.** An untested restore is a file, not a backup: this document
already carries one never-exercised recovery line in "Getting back",
and a second one would be the same mistake written twice. The rehearsal
proves three things no exit code does — that the export has rows in it,
that they arrive, and that `admin.html` opens one of them with the
private key. Only the third proves the backup is worth keeping.

**What a backup does not contain is anything readable.** Every field a
submitter typed is inside the sealed blob (`DESIGN.md`, "Encryption"),
so a leaked backup is the breach that design already prices in. That is
the sentence that makes this safe to do often — and it is also the
sentence that stops a backup being mistaken for a spare copy of the
data. It is a spare copy of the *ciphertext*. Lose the key and the
backup is lost with it.

## Reading the submissions

`apps/web/admin.html` on the live site — a public page, useless without
its two factors.

1. Sign in on the live site with a Telegram account on either admin
   list, and open the export page in the same tab. A
   member session is refused with a message saying so. The session is
   tab-scoped: closing the tab takes the credential with it,
   deliberately. It does not delete the session row — only
   `DELETE /session` does, and this page has no **Sign out** control to
   send it yet (#81), so a tab closed here leaves that row live at the
   endpoint until it expires on its own — for a session nobody is using,
   the idle window rather than the two-hour cap.
2. Provide the **key file** — pasted or picked; read in the page, never
   uploaded. This is a first-visit step per browser: the page imports
   the key once and keeps the working copy on that device, so a later
   export there opens without a file and says on the status line that it
   has. `DESIGN.md`, "Key custody", carries what that costs and why the
   offline copy is still the one that matters.
3. **Fetch and decrypt**, then download CSV, Excel or JSON. Below them:
   the keyholder's charts, drawn from the rows just decrypted and the
   same drawing this page publishes.

`[pre-cutover]` Today the page takes the export token in a box instead
of a session, and the dashboard is public. Everything else matches.

Worth knowing before relying on it: rows that will not open are
**listed, not hidden** (a rotated key is the ordinary cause — the old
key still reads them); duplicates are normal and are the weight
history; both unit systems are in every row plus the `entered_*`
strings, which are the columns to trust when a rounded value looks
wrong; cells starting `=`, `+`, `-` or `@` arrive with a leading
apostrophe so a spreadsheet reads text rather than running a formula;
a height that changed between entries is flagged — a typo, a unit
mix-up, or one handle used by two people. Close the tab when done: that
page is the only place the data exists in the clear. **The key does not
close with it.** Press **Clear** to remove it from this browser — that
is the step that matters on a machine anyone else can reach, and the
same button the departure and compromise procedures below name.

## Publishing and retracting the snapshot

At the bottom of the export page, after decrypting: decide about
**weight over time** (off by default — `DESIGN.md` carries what the
quantization does and does not buy), press **Show what would be sent**
to read the document first, then **Publish snapshot**. It replaces
whatever was there. The page says how old the published figures are and
warns past two days; nothing refreshes it but you.

**Unpublish** is a button on the same page and needs the admin session,
not the key — the moment a snapshot needs retracting is not the moment
to decrypt a corpus. If the page itself is unreachable:

```bash
curl -X DELETE -H "Origin: https://potaetoe.github.io" \
  -H "Authorization: Bearer YOUR_EXPORT_TOKEN" \
  https://hgbinderworker.sorcererbiggz.workers.dev/snapshot
```

This is the only routine use left for `EXPORT_TOKEN`, and it is the
reason to keep that token stored somewhere reachable without the site.

**And if the route itself will not answer**, the row can be removed
from the database directly. The admin page says an admin can clear it
by hand and points here rather than printing this, because SQL in
product copy is a thing to type shown to somebody who came to press a
button (#265 row 37):

```bash
npx wrangler d1 execute hg_binder_db --remote --command "DELETE FROM snapshots;"
```

There is at most one row in that table — the Worker replaces rather
than appends — so the unqualified `DELETE` is the whole retraction and
not a blunt instrument. On dev, `hg_binder_db_dev` with `--env dev`.

## Making someone an admin

**There are two admin lists and either one grants it** — the
`ADMIN_TELEGRAM_IDS` secret, and `admin` rows in the `membership` table
that any admin can write through `POST /membership`. The Worker asks
both on every request. Either way it is a **numeric Telegram id** that
identifies the person, not a handle; handles change and get reused, and
the table stores the id's HMAC rather than the id.

Which one to use: **the table, unless this is the founding admin.** The
secret needs a dashboard login and a person who has one; a row needs an
admin who is already here. The founding admin stays in the secret on
purpose — a list that could rewrite itself completely leaves no root of
trust outside itself (`DESIGN.md`, "Admin accounts and deletion").

1. They sign in on the live site — any member can. Their numeric id
   arrives in the session, and `your-page.html` shows it back to them
   under "Your entries".
2. An existing admin adds that number as an `admin` row, or the owner
   adds it to `ADMIN_TELEGRAM_IDS` in the dashboard.
3. They **sign out and back in.** The admin flag is minted at sign-in
   and stored on the session row — an existing session keeps being
   refused, which looks exactly like the id being wrong.

**Taking it away is not the mirror of granting it, and nobody has to
wait.** Removing them from *both* lists takes effect on that session's
*next request*: the Worker re-reads both on every call rather than
trusting the flag minted at sign-in, so there is nothing to press and
nothing to expire. Removing them from only one leaves them an admin,
which is the failure mode that comes with having two — check the row and
the secret in the same sitting. What it does not do is end the session —
demotion is not revocation, the person is still in the group, and the
session goes on working as the ordinary member session it also is.
Ending one outright is `DELETE /session`, which `apps/web/signout.js`
sends when somebody presses **Sign out**. That control is in the rail's
session block, and the rail is on every signed-in page, so it is reached
from wherever the person happens to be standing. The request is what
makes it a revocation rather than a local clear: the row is deleted at
the Worker, so a token captured beforehand stops opening anything
instead of running to its natural expiry (#90).

**The last `admin` row that grants will not come off, and that is not a
bug to work around.** The endpoint refuses it rather than leaving the
table with no granting admin row, so add the next admin before removing
the last one. **What it counts is grants, not rows**: a row whose
account id is not sixty-four lowercase hex characters grants nobody
anything, so it neither counts toward "more than one" nor earns the
protection — the `malformed` rows below come off whenever an admin
presses Remove, and a table whose only `admin` row is one of those is
already an empty admin list in every sense the Worker honors. The secret
is not counted either: it is the root of trust the guard exists to fall
back on.

**Which admins are still only in the secret** is `secretOnly` on
`GET /membership` — the account ids the secret grants that the table has
no row for. Nothing outside the Worker can compute it, because the
secret holds numeric ids and the table holds their HMACs. An empty list
is the go-signal for dropping the secret arm: it means every admin the
secret grants also holds a row, so table-only would take nobody's
authority away.

**Before `ADMIN_TELEGRAM_IDS` goes table-only, two things have to be
true, and only one of them is about the data.** The go-signal above is
the second. The first is that the last-admin guard counts grants rather
than rows — and it does, which is why this is a line to check rather
than work to schedule. A guard counting every `admin` row would count a
`malformed` one, so a single dud beside a single real admin reads as two
and the last real admin comes off against a count that was never
authority; with the secret arm already dropped, the way back in is a
dashboard login. Verify it in the same sitting as the go-signal:
`handleDeleteMembership` in `server/worker.js` is the statement, and its
subquery names `granting` as the copy of the table it counts.

**A row written by hand that grants nothing** comes back under
`malformed` on the same response, separately from the rows that do
grant. `wrangler d1 execute` validates nothing, so an account id pasted
there in the wrong case or short a character is a row that looks
present and is invisible to every check the Worker makes — the failure
this table exists to remove, arriving by the one door `POST` cannot
guard. `DELETE /membership/:role/:accountId` takes the id exactly as
that list gives it and removes it.

`[pre-cutover]` All of that is endpoint behavior — the two lists, the
removal, and what the guard counts — so it arrives with the next
`server/` deploy and not with a merge; see the `[pre-cutover]` note
under "Routes and who may call them" for what the deployed Worker is
still running. **Read the flip's first condition against the deployment
rather than against this repository**, because a guard that counts
grants in `server/worker.js` and rows in production is the one shape
where checking the source makes the flip look safe. Production takes
them at `CUTOVER.md` step 5. It is tagged because it points into a
tagged paragraph — do not untag it and leave the pointer, which is how
the aftercare step ends up deleting a paragraph something still cites.

If everyone is locked out — no admin id works, the bot is gone from the
group — `ALWAYS_ALLOW_TELEGRAM_IDS` and `EXPORT_TOKEN` are the two ways
back, both set in the dashboard. Both are deliberately secrets rather
than table rows: a way back in that lives in the database is no way back
in when the database is what went wrong.

## When somebody leaves

**Belonging here is four separate things, and they come apart
separately.** Being in the Telegram group is what lets somebody sign
in; an entry on either admin list is what makes them an admin; a
live session is a credential already issued and already in their
browser; and the rows they submitted are in the database. Removing one
of these does nothing to the other three, and the ordering below exists
because the step that feels most final is the one that leaves a working
session behind.

1. **Decide first whether this is a departure or a compromise.**
   Somebody leaving on ordinary terms can be asked to press **Sign
   out**, and that is the cleanest end a session has. Somebody whose
   access is being removed against their wishes, or whose device is
   gone, is "When a token or a session may be compromised" below — the
   whole difference is whether the person holding the credential can be
   relied on to end it. **Anyone.**
2. **Take the admin rights away first**, because it is the fastest lever
   and it ends the larger authority — and take them off **both** lists:
   remove their `admin` row, and remove their number from
   `ADMIN_TELEGRAM_IDS` in the dashboard. Either one left behind leaves
   them an admin. "Making someone an admin" above says what that does
   and how soon, and the part worth re-reading before you assume this
   finished the job is that demotion is not revocation. The row is
   **any admin**; the secret is **owner only.**
3. **Then remove them from the Telegram group — and check both
   always-allow lists in the same sitting**, the
   `ALWAYS_ALLOW_TELEGRAM_IDS` secret and their `always_allow` row.
   Group membership is checked when a session is *issued* and never
   during one, so this stops the next sign-in. A sign-in Telegram
   *definitively* refuses — it answered, and it said they are gone —
   also ends every session that account is holding; an unreachable
   Telegram refuses the sign-in and revokes nothing, because a failed
   call is not evidence that anybody left. Do not plan around either:
   both need them to try, so step 4 is still the lever that ends a
   session on your schedule rather than on theirs. If their id is on
   either always-allow list, removing them from the group has no effect
   at all:
   those lists exist to bypass exactly this check ("Secrets" above). It
   is the easiest step to forget, because it is usually empty. The row
   is **any admin**; the secret is **owner only.**
4. **End the session they still hold.** Three ways, and step 1 chooses
   which:

   - **They press Sign out**, which sends `DELETE /session`. Not every
     page carries that control yet; "Making someone an admin" above
     names which one does, and an admin ends their session there like
     anybody else.
   - **You wait.** It ends on its own at the lifetimes named under
     "Routes and who may call them" — and for an admin session nobody
     is using, at the idle window rather than the cap.
   - **You end every session at once.** There is deliberately no route
     that ends *somebody else's* session: one answering differently for
     an account that has sessions than for one that does not would
     disclose whether that account exists, which is what `DESIGN.md`,
     "The identifier is the whole problem", is built to prevent. What
     exists instead is the table, and clearing it signs everybody out.
     That is a real option rather than a last resort — a session is
     reissued by signing in, which is why `server/schema.sql` gives
     that table no backup procedure — and the person who has just left
     the group is the one member who cannot sign back in.

   Clearing it is one command, run from `server/`. **Take a backup
   first** ("Backing up the submissions" above): not because sessions
   are worth keeping, but because this is a hand-typed `DELETE` against
   production and the irreplaceable table in the same schema has a name
   that looks like this one.

   ```bash
   npx wrangler d1 execute hg_binder_db --remote --command "DELETE FROM sessions;"
   ```

   **Owner only** — and **the verification is that it signed you out
   too.** Your own session was a row in that table, so if the export
   page still works without signing in again, the command did not do
   what it appeared to: one that matched nothing, or ran against the
   development arm, reports success exactly like one that worked.
   `EXPORT_TOKEN` keeps working throughout, which is what it is for.
5. **Rotate `EXPORT_TOKEN` if they ever held it.** It is attached to no
   identity — no list names it, no session carries it — so every step
   above leaves it working in their hands. How to rotate it, and how to
   confirm the rotation took, is "When a token or a session may be
   compromised" below. **Owner only.**
6. **Their rows stay, unless they ask otherwise.** The weight history
   is what this project accumulates and somebody leaving does not undo
   it. It is also theirs: they handed it to a person rather than to a
   website, so the honest move is to ask rather than to decide for
   them. If they want it gone, an admin finds their rows in
   `admin.html` (the handle is inside the decrypted record) and
   `DELETE /submission/:id` takes them one at a time. Count what is
   left rather than trusting the answers, for the reason the routes
   table above gives. Afterwards the only copy is whatever backup
   predates the deletion. **Admin, after asking.**

**If the person leaving is the keyholder, this is the wrong
procedure** — "Handing the project to someone else" below is, and the
key is the part with no substitute. One step belongs to them wherever
they leave from: **Clear** on the export page, in every browser they
used it in, which is what removes the working copy of the key from
their devices. Nobody else can press it, and a departure that skips it
leaves a device that opens the submissions.

`[pre-cutover]` Steps 4 and 6 describe the accounts Worker. The
deployed production Worker issues no sessions at all and has no per-row
delete — see the tagged note under "Routes and who may call them" — so
a departure today is steps 2, 3 and 5, and step 5 carries more weight
than it will later, because `EXPORT_TOKEN` is the only credential
production currently has. Which Worker is answering is a thing to
check rather than remember: "Checking a deployment" above.

## Handing the project to someone else

**The one thing to understand first: there is no recovery from a lost
private key.** If you are receiving this project, make a second copy of
the key file today.

Five things move, independently — whoever holds one does not
automatically get the others:

| Thing | What it gets them | How to hand it over |
| --- | --- | --- |
| The private key | reads the submissions | the key file, out of band — never email, never the repo |
| An admin id | fetches ciphertext, publishes, deletes rows | an `admin` row, or their numeric id in `ADMIN_TELEGRAM_IDS` — "Making someone an admin" says which |
| The export token | break-glass when sign-in is broken | read it from the Worker's secrets, or set a new one |
| The Cloudflare account | holds the ciphertext | transfer it, or they deploy their own — below |
| The GitHub repo | the site itself | transfer in settings, or they fork |

Read access to plaintext is the key **plus** an admin session; neither
alone is enough.

**Deploying their own storage** (the likely case): stand up a Worker
and D1 per `server/` and the secrets table above, set `ALLOWED_ORIGINS`
to their site — **never edit `worker.js` to change a URL**; that
variable exists so the code is identical on every deployment — put the
Worker's URL in `config.js` *and* every page's `connect-src` (the gate
fails if only one is done), and generate a fresh keypair. Existing rows
move with `GET /export` and an `INSERT` per row; they are ciphertext in
transit as much as at rest. Rows carry a format version byte read by
`crypto.js` — if they fork and change that file's format, stored rows
stop opening, silently; `dev/crypto.test.mjs`'s fixture is what tells
them.

**Before it counts as handed over:** they have decrypted a real row
from the live database through `admin.html` on their own machine —
nothing else proves the key, the admin id and the endpoint all arrived
intact; they hold two copies of the key file in two places; they have
submitted through the live form and seen the row arrive; you have
deleted anything you no longer hold a right to; and the people
submitting know who the keyholder is now — they handed their data to a
person, not a website.

## When the fingerprint alarm fires

**`DESIGN.md`'s threat model builds one alarm, and this is what to do
when it rings.** Anyone who can write to the repository or the Pages
deployment swaps `publicKey` and every later submission encrypts to
them, silently; the detection is a member comparing what `your-page.html`
displays against the fingerprint pinned in the Telegram group. Its
entire output is a person saying "these do not match," and the order
below is the part that is not obvious — several plausible first moves
are wrong. Rotating first destroys the evidence of *which* key was
substituted. Unpublishing the snapshot answers a leak that is not
happening. And answering "ignore it, that was a rotation" is the
failure "The keys" warns about from the other side.

1. **Stop the writes first.** Every submission from here on is sealed
   to whoever's key is on the page. The lever that does not run through
   the repository — which is one of the two things possibly compromised
   — is the Worker: in the Cloudflare dashboard, set `ALLOWED_ORIGINS`
   to a value that does not include the site's origin, and every route
   answers `Origin not allowed.` **Clearing it does not do this**; an
   empty value falls back to the defaults compiled into `worker.js`,
   and the live origin is one of them. This stops sign-in and the
   members' charts page too, which is the intended shape: a visible stop
   beats a silent one. **Owner only** — an admin id does not reach the
   dashboard. Two consequences to expect: your own break-glass `curl`
   in "Publishing and retracting the snapshot" must now send the new
   origin, and the next `wrangler deploy` puts the old value back,
   because `deploy` applies `[vars]` over the dashboard's.
2. **Capture what you are looking at, before touching anything.** The
   value `your-page.html` is showing, the text of the pinned message, and
   the time. A screenshot is enough. Step 6 overwrites the only record
   of which key was substituted. **Anyone.**
3. **Verify against the served file, not the source.** The site and the
   repository deploy independently and can disagree — that is why this
   step exists at all — so read what a browser actually gets:

   ```bash
   curl -s https://potaetoe.github.io/hang-gangs-binder/config.js | grep publicKey
   ```

   The fingerprint on the page is the leading characters of that value;
   `KEY_FINGERPRINT_LENGTH` in `apps/web/ui.js` is how many. Now
   compare three things: the served value, the literal pinned as
   `PRODUCTION_KEY` in `tools/check_web.py`, and the pinned Telegram
   message. **Anyone** — none of this needs a credential.
4. **Read the disagreement; it names the incident.** The gate refuses a
   `config.js` whose production arm does not carry `PRODUCTION_KEY`, so
   a mismatch that reached the live site already says something about
   how it got there:

   | What disagrees | What it means |
   | --- | --- |
   | served ≠ repository, repository = `check_web.py` | the deployment does not match `main` — something was published the gate never saw |
   | served = repository ≠ `check_web.py` | both literals moved together: the gate was edited or bypassed |
   | all three agree, only the pinned message differs | **the likely false alarm** — a rotation that did not update the pin in the same sitting |

5. **If it is the false alarm, fix the anchor rather than the alarm.**
   Update the pinned message to the current fingerprint now and say the
   key was rotated and when. Never answer with "ignore that": a member
   taught once to ignore this has switched off the only detection the
   design has. **Any group admin.**
6. **If the swap is confirmed, rotate — and only now.** The procedure,
   including the archive-not-destroy rule and the pinned message that
   updates in the same sitting, is "The keys" above. **Keyholder.**
   Before restoring writes, establish how the file changed:
   `git log apps/web/config.js` and the Pages deployment history are
   the two places to look, and if the repository shows nothing then the
   repository was never the route and the deployment credentials are
   what needs attention.
7. **Tell the group in plain language.** Submissions made between the
   swap and step 1 are sealed to somebody else's key: they cannot be
   read, cannot be recovered, and cannot be re-sealed. Name the window
   and say so. The people in it handed their data to a person rather
   than to a website, and this is the moment that is true. **Anyone in
   the group** can send it; the keyholder is who knows the window.
8. **Restore writes last.** Put `ALLOWED_ORIGINS` back, then use the
   probes in "Checking a deployment" and one real submission to confirm
   the site works before saying it does. **Owner.**

## When a token or a session may be compromised

**These credentials fail in different ways, and "rotate everything" is
the one response that can cause permanent loss.** `ACCOUNT_SECRET` sits
in the same list as the others and is not the same kind of thing:
changing it detaches every member from their own history, which
"Secrets" above states at length and `server/wrangler.toml` repeats. It
is never part of an incident response, and the moment somebody proposes
rotating the secrets is the moment that has to be said out loud. So the
first act here is not a rotation — it is naming which credential is
suspected, because each of the others has a different answer and the
answers do not substitute for one another.

1. **Name the credential, and write down why you think so.** The time,
   what was seen, and where: a value pasted into a chat, a laptop gone
   with a tab open on it, an export nobody remembers running. This
   costs a minute and it is what tells you, later, which window to
   describe to people. **Anyone.**
2. **A suspected `EXPORT_TOKEN`: rotate it, and that is the entire
   revocation.** It is a secret rather than a session — there is no row
   to delete and nothing to expire, which is why `DELETE /session`
   refuses it. Set a new value where the other secrets are set
   ("Secrets" above; before the cutover the dashboard is the only tool
   that works there, and "Deploying the Worker" says why). The old
   value stops being accepted on the next request that presents it: it
   is compared against the secret on every call rather than exchanged
   for anything longer-lived. **Owner only.**
3. **Verify the rotation from outside, using the old value.** A secret
   saved into the wrong Worker, or saved with a stray newline, looks
   exactly like a rotation that worked:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' \
     -H "Origin: https://potaetoe.github.io" \
     -H "Authorization: Bearer OLD_VALUE" \
     https://hgbinderworker.sorcererbiggz.workers.dev/export
   ```

   `401` is the rotation holding. `200` is the retired value still
   opening an admin route, and the rotation did not take. The body is
   discarded deliberately: this asks whether the door opens, and there
   is no reason to pull the corpus through a terminal to find out.
   **Owner** — the one step that needs the value being retired, so
   destroy whatever you pasted it into afterwards.
4. **Get the new value to the copies, and fix what carried the old
   one.** The token is kept reachable *without* the site ("Secrets"
   above), so its copies are wherever that is; a rotation that does not
   reach them leaves the next real emergency holding a token that no
   longer works, which is the failure break-glass exists to prevent.
   The `curl` under "Publishing and retracting the snapshot" is the
   other place it is used. **Owner.**
5. **A suspected session is a different mechanism, and no rotation
   touches it.** Rotating `EXPORT_TOKEN` does nothing to an issued
   session and clearing sessions does nothing to the token. If the
   person still has the tab, **Sign out** ends it. If they do not — the
   machine is gone, or somebody else has it — the levers are the ones
   in "When somebody leaves" above: the idle window bounds an admin
   session nobody is using, and clearing the table ends every session
   at once. **Anyone** for the first, **owner** for the last.
6. **Say what a captured session actually got them, because it is less
   than it sounds — and say where that stops being true.** Reading
   plaintext takes the private key **and** an admin session, and neither
   alone is enough ("Handing the project to someone else" above). A
   captured admin session pulls ciphertext it cannot open; a captured
   member session appends rows to one account. Neither is a key
   compromise, and neither is answered by rotating the key — that alarm,
   and its response, is the section above. **The keyholder's own machine
   is the exception, and it is a large one:** the export page keeps the
   working copy of the key on the device it was imported on
   (`DESIGN.md`, "Key custody"), so a keyholder's unlocked browser is
   one factor by itself and both of them while an admin tab is live.
   Treat that as a key compromise rather than a session one. **Clear**
   is what removes the stored key and only whoever holds the machine can
   press it; rotating under "The keys" protects rows written after the
   rotation and not one row already stored. Say which of the two you are
   describing when you tell the group. **Anyone** telling the group.
7. **A suspected `TELEGRAM_BOT_TOKEN`: revoke it in BotFather first,
   re-paste second, and do not treat it as the small one.** "Secrets"
   above prices it at a `/revoke` and a re-paste, which is the repair
   and not the exposure. A login payload is signed under a key derived
   from that token and nothing else, so whoever holds it can mint a
   payload the Worker verifies — for any Telegram id, including one in
   `ADMIN_TELEGRAM_IDS`. The revoke is what stops further sessions
   being minted; it does not touch sessions already issued, so pair it
   with step 5. That asymmetry is the opposite shape to the session
   levers and is the thing most easily got backwards under pressure.
   **Owner only.**

## When the Cloudflare account itself may be compromised

This is the incident the sections above cannot answer, because every
lever they pull — the secrets, the sessions table, `ALLOWED_ORIGINS`,
the Worker script, the database — sits inside the thing compromised.
So the order inverts: control first, levers second, and no lever
counts as pulled until control is back. (A compromise of the
repository or the Pages deployment is the fingerprint section above —
a substituted key is how that one becomes visible.)

What this is **not** is a key compromise, and the write-up exists
partly to let that be said with a straight face on a bad day: the
private key has never been on Cloudflare, and the public key every
submission encrypts to is published from the repository via Pages,
which the Cloudflare account does not touch. `DESIGN.md`'s central
property — plaintext exists in a submitting browser and wherever the
keyholder decrypts, and nowhere else — holds even with the dashboard
in hostile hands. Keeping that sentence true under exactly this
incident is why the design keeps the key out of the place the data
lives.

1. **Recognize it from the account's own record, not from the site.**
   The site can look perfect throughout. What tells the truth:
   deployment and version history showing a deploy nobody here made,
   the dashboard audit log showing sign-ins or secret edits at hours
   nobody was working, `ALLOWED_ORIGINS` holding an origin this
   repository does not name. The fingerprint alarm stays silent in
   this incident — the key was never there for an attacker to swap —
   so its silence says nothing either way. **Owner.**
2. **Take the account back before touching anything inside it.**
   Cloudflare's account recovery, in this order: the owning email
   secured first (recovery flows through it, so a compromised inbox
   re-loses the account behind you), then the password, then
   two-factor re-established, then every active dashboard session
   revoked, then **every API token deleted** — tokens survive a
   password change, and a token is how the account was probably being
   driven. Until this step holds, nothing later in this list can be
   trusted to stay done. **Owner only.**
3. **Write down what was readable, before deciding anything.** In the
   account: the D1 rows — ciphertext and HMAC account ids — every
   secret, the Worker script, and whatever the logs held. Not in the
   account, and worth writing in the same breath: any plaintext, any
   private key. An attacker who owned the dashboard outright holds
   sealed envelopes they cannot open. The minute this costs is what
   makes step 8's message accurate instead of reassuring. **Owner.**
4. **Redeploy the Worker from the repository, not from what is
   sitting there.** What is deployed is whatever the attacker last
   left, however normal it looks; `server/` in this repository is
   what it should be. Deploy per "Deploying the Worker", then run the
   probes in "Checking a deployment" before believing it. Before the
   cutover, the production reference is the `binder-recovery` capture
   ("Getting back" below). **Owner only.**
5. **Rotate from Secrets on — with the one standing exception, which
   survives even this.** `EXPORT_TOKEN`: rotate and verify from
   outside with the retired value, exactly as the token section
   above does it. `TELEGRAM_BOT_TOKEN`: revoke in BotFather — its
   revocation lives at Telegram, not Cloudflare, which makes it the
   one credential the attacker cannot keep by holding the account —
   and remember the revoke stops new sessions being minted, not
   sessions already issued. `DEV_LOGIN_SECRET`, on the dev arm, the
   same sitting. `ACCOUNT_SECRET` is the exception the token section
   states and it holds here too: rotating it cannot un-read what was
   read, and it detaches every member from their own history. What a
   stolen copy changes is the future — whoever holds it can test a
   guessed Telegram id against the account ids on new rows — so
   whether continuity or unlinkability matters more from here is a
   decision the owner puts to the group in plain terms, not a step
   this list can take for them. **Owner only.**
6. **Clear the sessions table.** While the bot token was readable,
   sign-in payloads could be minted for any Telegram id, including an
   admin's, and those sessions outlive every rotation in step 5 —
   the same asymmetry the token section ends on. Clearing ends every
   session at once; members sign back in with nothing lost. **Owner.**
7. **Check the rows against the backup.** Reading was not the only
   option — deletion and alteration were too, and altered ciphertext
   does not announce itself; it just stops decrypting. The backup
   procedure exists for this exact reading: compare row counts,
   spot-check that a sample still opens, restore what is missing, and
   write down the window anything restored came from. **Keyholder**
   for the decrypt check, **owner** for the restore.
8. **Tell the group two true sentences.** First: nobody's entries
   were read — the key that opens them was never in the thing that
   was taken, and that is by design rather than by luck. Second: what
   *was* exposed — the sealed rows, the pseudonymous ids, the
   operating credentials — and what was done about each, including
   the `ACCOUNT_SECRET` decision from step 5 and any window step 7
   restored. A member who reads both sentences knows exactly as much
   as the owner does, which is the standard the fingerprint section
   set. **Owner**, since every step here was theirs.

## Getting back

The site is a `git revert` — the published `dist/` is committed
beside the `apps/web` it was built from, so reverting restores the
pages exactly and cannot leave the two disagreeing. The Worker is not: it deploys separately.
A capture of the pre-accounts production script exists **outside this
repository** at `binder-recovery/` (version
`2d3c73a5-1095-42db-a810-c8c0ba1a5c24`, with its own README), and
Cloudflare's `wrangler rollback` to that version is a second,
**never-exercised** line. A rollback plan naming an artifact nobody has
confirmed exists is not a rollback plan. The hotfix procedure for the
live site is in `README.md`, which is on `main` when you need it.
