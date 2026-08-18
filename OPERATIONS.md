# Operations

**Read this when you are about to touch the running system** — deploy
it, change a secret, take a backup, answer an incident, or hand it to
somebody else. `DESIGN.md` says why the system is this shape; this file
says how to work it.

Statements about *current* live state — what is deployed right now, who
confirmed a secret and when — belong in issues, never here.

**A line marked *until 0.9-M1 lands* describes the shipped code rather
than the ruled 0.9 design.** Those lines die with the milestone named
in them.

## What runs where

| Piece | Where | Deployed by |
| --- | --- | --- |
| The Worker (`server/worker.js`) | `hgbinderworker.sorcererbiggz.workers.dev` | by hand, `npx wrangler deploy` from `server/` |
| The database | D1 `hg_binder_db` | schema by hand, `wrangler d1 execute` |
| sit pair | `hgbinderworker-sit` + `hg_binder_db_sit` | the same commands with `--env sit`, once built — "Building the sit environment" below |

**The site has nowhere to run today.** GitHub Pages retired outright on
2026-08-13 (owner order, moved up from the 1.0 cutover it was first
scheduled for) — the deploy job is gone from
`.github/workflows/deploy.yml` and the Pages configuration is deleted
at the repository. Nothing serves `apps/web` until 0.9-M1 builds the
Worker's static-asset serving; at 1.0 the row above for the Worker is
also the site's row, one origin and one deploy command for both. See
`README.md`'s Status box for the live fact and `DESIGN.md`, "The
constraint that shapes everything", for the ruled shape.

**This table's sit row is the ruled config shape, not a claim that it
is deployed** (0.9-M1-S1, #325, is what renamed it from `dev`, per the
note this replaced; `server/wrangler.toml`'s own `[env.sit]` block is
the config this row names). Whether it is actually live is exactly the
kind of *current* live-state fact this file's own opening paragraph
sends to an issue rather than keeping here — #282 is where that fact
lands. `hgbinderworker-dev` and `hg_binder_db_dev`, the pre-0.9 pair
this row replaces, are untouched by the rename: they stay live under
their old names, unrenamed, until #282's holder runs "Building the sit
environment" below or somebody retires them on purpose.

## The routes

**Read them out of `server/worker.js`; they are not listed here.** A
table of routes in a document is a copy that goes stale the first time
a slice adds one, and this repository already derives them:
`tools/check_live.py` reads the route list out of the Worker and fails
the gate on a route with no row in the verification ledger, and the
demo stub derives the routes it must answer the same way.

Two rules about that list hold whatever it comes to contain, and
neither is machine-checkable:

- **Nothing about a person goes on an uncredentialed route.** A route
  that answers without a session may only carry what the published site
  already ships.
- **A route that ends a credential is not idempotent.** Deleting
  something that is not there may succeed; telling somebody they are
  signed out when they are not is the failure such a route exists to
  close.

## Secrets

All set in Cloudflare — dashboard → Worker → Settings → Variables and
Secrets — never in this repository, and **never handled by an agent.**

**Which secrets exist is read from `server/wrangler.toml` and
`server/worker.js`**, for the same reason the routes are. What this
document owns is the part no file states:

- **Two are the owner's to supply and nobody else's, and 0.9-M1 cannot
  start without them**: a **Telegram bot token** for a bot that is in
  the gang's group and can see its membership, and the **group's chat
  id**. Both are dashboard work with a Telegram app open; no agent can
  do either, and the token never appears in chat, in this repository or
  in any file — the owner runs the secret command themselves.
- **One is the key member identity is HMACed under, and it is its own
  secret.** Never the bot token: the bot is temporary, and an identity
  derived from it orphans every row at the first rotation. `DESIGN.md`,
  "The bot is temporary", is the rule; this line is where operations
  keeps it, because the trap is exactly the shortcut an operator with
  one secret in hand would take.
- **One is the secret entries are encrypted under at rest.** It never
  leaves the Worker. Losing it costs the entries; leaking it costs the
  entries to whoever holds a copy of the database. It is generated
  once, kept where a backup is not, and treated as part of the stored
  format rather than as configuration — see `DESIGN.md`, "Encryption".
- **`ALLOWED_ORIGINS` is a plaintext variable, not a secret**, and
  setting it *replaces* the defaults compiled into the Worker. The gate
  refuses a `[vars]` block naming anything else, because a
  dashboard-only variable is silently erased by the next deploy while a
  committed one is public.

**Rotating the bot is a planned act, and its procedure ships with
0.9-M1** — written against the Worker that exists then rather than
guessed at now. What is settled today is its shape: a new bot created
and added to the group with member visibility and the site's domain
registered, the owner putting the new token in as a secret, the bot's
username changed in the one config place and deployed, a sign-in
round-trip and the Settings page's bot-health line read back as
verification, and the old bot revoked **last**.

*Until 0.9-M1 lands* the deployed Worker still carries the pre-0.9 set,
including the key-world credentials and the two admin-id lists. They
die with the milestone; do not add to them.

## Building the sit environment

**The sequence #282's holder runs, once its two secrets are in hand**
(0.9-M1-S1, #325). Every command is safe to re-run except the first —
running `d1 create` twice makes a second, unlinked database under the
same name. From `server/`. No token, id or generated value is typed
into this repository at any step: each command below that wants one
either prompts for it directly or takes it as a CLI argument typed at
the terminal, never pasted into a file.

1. **Create the database.** It does not exist yet, which is why
   `server/wrangler.toml` carries no `[[env.sit.d1_databases]]` block —
   see that file's own comment on why an id that names nothing is worse
   than no block at all.

   ```bash
   npx wrangler d1 create hg_binder_db_sit
   ```

   Paste the id it prints into `server/wrangler.toml`, in the shape the
   file's own comment shows, and commit that one line before
   continuing — the database exists from this point on, and re-running
   the command above would create a second one under the same name.

2. **Apply the schema.** `hg_binder_db_sit` is new and holds no rows, so
   the "0.9 arrives on an empty database" exception under "Before
   re-running schema.sql" above applies without running its preflight
   query first. A *later* rerun against sit, once it holds rows, is the
   general case that section describes and wants the preflight query
   run against `hg_binder_db_sit` first.

   ```bash
   npx wrangler d1 execute hg_binder_db_sit --remote --file=schema.sql --env sit
   ```

3. **Deploy the Worker.** Dry-run first and read the bindings back — the
   same discipline "Deploying the Worker" below asks of every deploy: a
   sit deploy must report `hg_binder_db_sit` and the origins
   `server/wrangler.toml`'s `[env.sit.vars]` names, or stop.

   ```bash
   npx wrangler deploy --dry-run --env sit
   npx wrangler deploy --env sit
   ```

4. **Set the secrets**, in the order `server/wrangler.toml`'s `[env.sit]`
   comment lists and explains them. Each command prompts for the value
   at the terminal; type or paste it into that prompt, never into a
   file, an issue or this document:

   ```bash
   npx wrangler secret put ACCOUNT_SECRET --env sit
   npx wrangler secret put TELEGRAM_BOT_TOKEN --env sit
   npx wrangler secret put TELEGRAM_GROUP_CHAT_ID --env sit
   npx wrangler secret put EXPORT_TOKEN --env sit
   ```

   The bot token and the group chat id are #282's two inputs, exactly as
   supplied there. `ACCOUNT_SECRET` is a fresh value generated for sit
   alone — never production's, never reused, per `DESIGN.md`, "The bot
   is temporary". `EXPORT_TOKEN` is any value the operator keeps.

   **This is the act that closes #282.** Comment there with which
   secrets were set — names only, never values — once done.

5. **Verify.** "Checking a deployment" below, sent at the localhost
   origin `[env.sit.vars]` names: it should read back as the healthy
   401, not a 403 or a 500. **Not sit's own origin yet** — see the note
   under that section on why a probe sent from it currently reads 403
   rather than confirming anything.

## Deploying the Worker

From `server/`, and read the reasoning comments in
`server/wrangler.toml` before touching it:

```bash
npx wrangler deploy --env dev      # development
npx wrangler deploy                # PRODUCTION - the bare command is production
```

**`--env dev` is the whole risk.** Dry-run first and read the bindings
back: a development deploy must report `hg_binder_db_dev` and localhost
origins, or stop. Schema:

```bash
npx wrangler d1 execute hg_binder_db_dev --remote --file=schema.sql --env dev
```

Wrangler authenticates from an agent shell; the first call in a session
may fail once with error 10000 and succeed on retry — `wrangler whoami`
misdescribes that state, so diagnose with a real subcommand. `deploy`
preserves secrets and applies `[vars]` over the dashboard's.

### Before re-running `schema.sql` against a database that already holds rows

**This is the general case** — the currently deployed, manually-managed
transitional Worker's database, and any future rerun of `schema.sql`
against a database that is not empty. The narrower one-time exception,
where none of this applies, is below.

`schema.sql`'s own header explains why a rerun is not purely additive:
every run DROPs the old `submissions_supersedes` index before
recreating it under a unique name, and if two rows already name the
same `supersedes` target, the `CREATE UNIQUE INDEX` fails **after** the
DROP has already committed — the table is left with no index on
`supersedes` at all, a working database with a silently slower
`GET /me` and no chain rule enforced under it.

**Run this first, against the same database `schema.sql` is about to
run against:**

```bash
npx wrangler d1 execute hg_binder_db --remote --command "SELECT supersedes, COUNT(*) AS n FROM submissions WHERE supersedes IS NOT NULL GROUP BY supersedes HAVING COUNT(*) > 1;"
```

**Any row back is a STOP, not a warning — do not run `schema.sql`.**
Resolving a duplicate needs the plaintext, which only a live admin
session can read (`DESIGN.md`, "Encryption": a raw dump reveals
nothing, by design): open each row the query names through the admin's
entries view, decide which is the genuine current correction, and clear
the loser's pointer by hand —

```bash
npx wrangler d1 execute hg_binder_db --remote --command "UPDATE submissions SET supersedes = NULL WHERE id = <the-losing-row>;"
```

— **take a backup first**, the same reason "When a credential may be
compromised" (below) gives for the session-clearing command: this is a
hand-typed write against production. Re-run the preflight query above
and confirm it returns nothing before running `schema.sql`. **Owner, or
an admin with a backup already in hand.**

**Recovery, if a rerun already dropped the index and failed to recreate
it.** `schema.sql`'s `CREATE` is `IF NOT EXISTS`, so a repeat attempt
over an unresolved duplicate fails the same way silently, and the only
proof of the real state is asking directly — the same "read the index
list back" step "Backing up the entries" (below) already asks of a
restore:

```bash
npx wrangler d1 execute hg_binder_db --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND name='submissions_supersedes_unique';"
```

An empty answer is the failure state. Resolve every duplicate the
preflight query names first, then create the index directly rather than
rerunning the whole file:

```bash
npx wrangler d1 execute hg_binder_db --remote --command "CREATE UNIQUE INDEX IF NOT EXISTS submissions_supersedes_unique ON submissions(supersedes);"
```

Confirm with the same `sqlite_master` query before treating the
database as healthy again. The same three steps — preflight, resolve
if named, recreate if missing — apply to `hg_binder_db_dev` with the
database name swapped, per "Backing up the entries" (below) on how this
project chooses between the two.

**0.9 arrives on an empty database — the one-time exception.** The
record rules no migration: the pre-0.9 rows are discarded rather than
carried, so the 0.9 schema is applied to a database with nothing in it,
and the preflight query above is answerable in advance without running
it — an empty `submissions` table has no duplicate `supersedes` to
find. That is a one-time property of this wave alone, true only for the
single rerun that performs the 0.9 cutover migration, and it is the
reason dropping the old database is an owner act rather than a step in
a script — see "Handing the project to someone else" for the same rule
about anything irreversible. It does not extend past that one rerun: the
currently deployed transitional database already holds rows, and every
other rerun of `schema.sql` — before the cutover or after it — is the
general case above.

## Checking a deployment

Ask the endpoint rather than the repository, with a request that needs
no credential and changes nothing: a `curl` at any route that requires
a session, with the site's `Origin` header set.

| Answer | Meaning |
| --- | --- |
| a refusal (401) | the Worker is up and the route is gated, which is the healthy answer |
| `Origin not allowed.` (403) | the `Origin` header was omitted — not a fault |
| a 404 | that Worker does not have this route: an older build is deployed |
| a 500 | a table the route reads is missing |

Send the site's own origin — the Worker's `workers.dev` subdomain until
1.0 registers a custom domain — and the localhost origin on `sit`, and
read the exact status rather than the body. There is no production
origin to probe today; "What runs where" above is the live fact.

**sit's own origin is not in `[env.sit.vars]`'s `ALLOWED_ORIGINS` yet**
(0.9-M1-S1, #325: loopback only, matching the pre-0.9 dev arm's shape,
until the Worker actually serves the static site from sit's own origin
— `server/wrangler.toml`'s own comment on `[env.sit.vars]` carries the
full reasoning and the finding this leaves open). Until whichever slice
adds it, a probe sent from sit's own origin reads 403 honestly rather
than 401 — that is the ALLOWED_ORIGINS list working as configured, not
a broken deployment, and the localhost origin is what actually
corroborates a healthy sit today.

What no local test can see: that the database binding is bound, the
secrets are set, and the tables exist. A Worker missing any of them
passes every suite and fails on the first real request — a wrong bot
token refuses every sign-in with the same 401 a tampered payload gets.

## Backing up the entries

**The entries are the irreplaceable thing here.** Sessions are reissued
by signing in and aggregates are recomputed on request, which is why
`server/schema.sql` gives those tables no procedure. The entries have
no way back: a dropped table, a mistaken recreate during a schema
change, or an account-level problem at the provider all end the history
this project exists to accumulate.

**A backup is stored bytes in and stored bytes out.** It never touches
plaintext and never decrypts anything, which is what makes it routine
rather than ceremonial. What it does carry is rows encrypted under the
Worker's secret — so **a backup kept beside that secret is the corpus
in one place**, and keeping them apart is the whole of the custody
rule. Two copies, offline, never in the same place as the secret.

**Taking one.** Wrangler's export command, run from `server/`. Here the
**database name** chooses the arm — not `--env dev`, which is how the
deploy and schema commands above choose it:

```bash
npx wrangler d1 export hg_binder_db --remote --output=binder-YYYY-MM-DD.sql
npx wrangler d1 export hg_binder_db_dev --remote --output=binder-dev-YYYY-MM-DD.sql
```

The bare command writes schema *and* rows; `--no-schema` gives rows
only. Open the file afterwards — it is text. **A backup with no
`INSERT` in it is the exact failure this procedure exists to prevent,
and it arrives looking like a success.**

**How often is a question about rows, not about the calendar.** Take
one when the database holds entries nobody could reproduce: after a
sitting that added them, and **always immediately before a schema
change.**

**Restoring** plays the file back through the same command that applies
the schema:

```bash
npx wrangler d1 execute hg_binder_db_dev --remote --file=binder-YYYY-MM-DD.sql --env dev
```

An export carrying the schema restores into a database that does not
already have those tables, and the rows carry their own ids, so
replaying one over a populated table is a collision rather than a
merge. Whether to empty the target first or to keep a `--no-schema`
export beside the full one is a decision to make in the rehearsal,
once — not on the day it is needed. **Re-apply `server/schema.sql`
after any restore and read the index list back**: an export writes the
indexes the database had on the day it was taken, quietly, as part of a
command that reports success.

**Rehearse the restore against the development arm before it is ever
needed.** An untested restore is a file, not a backup. The rehearsal
proves three things no exit code does: that the export has rows in it,
that they arrive, and that a signed-in member can read one of them
back. Only the third proves the backup is worth keeping.

## Making someone an admin

**Make them an admin of the Telegram group.** That is the whole
procedure: the site mirrors the group's admins, so there is no list
here to edit, no id to paste and no secret to change.

Taking it away is the mirror image — remove their admin status in
Telegram. Both directions take effect as the roster syncs; the bound is
the last-known-good window under `DESIGN.md`, "Bot failure stance", and
not a thing anybody presses here.

**The group's own hygiene is the site's access control.** Everyone with
admin in Telegram can read the directory and every member's entries.
That was put to the owner adversarially and the mirror stands, so the
honest operating advice is the one sentence this replaces a procedure
with: be as careful with admin in the group as you would be with a
password.

*Until 0.9-M1 lands* the deployed Worker still reads admin from its own
lists. Read the deployment rather than this file while that is true —
"Checking a deployment" above.

## When somebody leaves

**Remove them from the Telegram group.** Site access goes with it: the
roster syncs, the next sign-in is refused, and any session they hold
ends at the idle window rather than running to a cap.

Then, and only if it applies:

1. **Their data starts a visible countdown** on their row on the
   Members page. An admin may delete it sooner; re-adding them in
   Telegram inside the window restores them and their data reattaches.
   The window's length is on the Settings page.
2. **Nothing here starts a clock on a failure to check.** If Telegram
   will not answer, the Worker holds the last verified roster and no
   countdown arms — see `DESIGN.md`, "Bot failure stance". A mass
   departure freezes rather than arming every countdown at once.
3. **Their entries are theirs.** Departure does not delete them and
   neither does silence; the countdown is what eventually does, and an
   admin who wants them gone sooner presses the row's own control.

**If the person leaving ran the deployment**, this is the wrong
procedure — "Handing the project to someone else" is, and the Worker's
secret is the part with no substitute.

## Handing the project to someone else

**There is no recovery from losing the secret entries are encrypted
under.** If you are receiving this project, make a second copy of it
today, kept apart from the backups.

Four things move, independently — whoever holds one does not
automatically get the others:

| Thing | What it gets them | How to hand it over |
| --- | --- | --- |
| The Cloudflare account | the Worker, its secrets and the entries | transfer it, or they deploy their own — below |
| Admin of the Telegram group | the directory and every member's entries | make them an admin in Telegram |
| The bot | membership checks | BotFather, or their own bot and a new token |
| The GitHub repository | the site itself | transfer it in settings, or they fork |

**Deploying their own storage** (the likely case): stand up a Worker
and a database per `server/`, set the secrets per "Secrets" above,
point `ALLOWED_ORIGINS` at their site — **never edit `worker.js` to
change a URL**; that variable exists so the code is identical on every
deployment — and put the Worker's URL in `apps/web/config.js` *and*
every page's `connect-src`, which the gate fails if only one is done.
A fork also edits the group's name in the one place `DESIGN.md`,
"Where configuration lives", names, and the field spec if their group
measures something else.

**Before it counts as handed over:** they have signed in on their own
deployment and read a real entry back; they hold two copies of the
Worker's secret in two places; they have taken and rehearsed a backup;
and the people entering data know who runs it now — the trust model
says the operator can read entries, so that is a person the group knows
by name.

## When a credential may be compromised

**"Rotate everything" is the one response that can cause permanent
loss**, because the secret entries are encrypted under is not the same
kind of thing as the others: rotating it does not un-read anything and
it can cost the entries. It is never part of an incident response, and
the moment somebody proposes rotating the secrets is the moment that
has to be said out loud.

1. **Name the credential and write down why you think so** — the time,
   what was seen, and where. It costs a minute and it is what tells you
   later which window to describe to people. **Anyone.**
2. **A suspected bot token: revoke it in BotFather first, re-paste
   second, and do not treat it as the small one.** A login payload is
   signed under a key derived from that token and nothing else, so
   whoever holds it can mint a payload the Worker verifies for any
   Telegram id. The revoke stops further sessions being minted; it does
   not touch sessions already issued, so pair it with step 3. That
   asymmetry is the thing most easily got backwards under pressure.
   **Owner only.**
3. **A suspected session is a different mechanism and no rotation
   touches it.** If the person still has the tab, signing out ends it.
   If they do not, the levers are the idle window and clearing the
   session table, which signs everybody out at once and costs nothing
   but a sign-in. There is deliberately no route that ends somebody
   *else's* session: one answering differently for an account that has
   sessions would disclose whether that account exists.

   ```bash
   npx wrangler d1 execute hg_binder_db --remote --command "DELETE FROM sessions;"
   ```

   **Take a backup first** — not because sessions are worth keeping,
   but because this is a hand-typed `DELETE` against production and the
   irreplaceable table is in the same schema. **The verification is
   that it signed you out too**: a command that matched nothing, or ran
   against the development arm, reports success exactly like one that
   worked. **Owner only.**
4. **Say what a captured session actually got them.** A member session
   reads and writes one member's entries. An admin session reads the
   directory and every member's entries, which is the whole corpus in
   the clear — there is no second factor in front of it, and the design
   says so rather than pretending a key still stands there. Say which
   of the two you are describing when you tell the group. **Anyone.**

## When the Cloudflare account itself may be compromised

This is the incident the section above cannot answer, because every
lever it pulls — the secrets, the sessions, the Worker, the database —
sits inside the thing compromised. So the order inverts: control first,
levers second, and no lever counts as pulled until control is back.

**Say the true thing about this one.** Under 0.9 the Worker holds the
secret that opens the entries, so an attacker who held the account held
everything needed to read them. The pre-0.9 answer — that the key was
never in the place the data lives — died with the key world, and
repeating it would be the largest false claim this project could make.

1. **Recognize it from the account's own record, not from the site.**
   The site can look perfect throughout. What tells the truth: a deploy
   nobody here made, an audit log showing sign-ins or secret edits at
   hours nobody was working, `ALLOWED_ORIGINS` holding an origin this
   repository does not name. **Owner.**
2. **Take the account back before touching anything inside it.**
   Cloudflare's recovery, in this order: the owning email secured first
   — recovery flows through it, so a compromised inbox re-loses the
   account behind you — then the password, then two-factor
   re-established, then every dashboard session revoked, then **every
   API token deleted**, because tokens survive a password change and a
   token is how the account was probably being driven. **Owner only.**
3. **Write down what was readable, before deciding anything.** The
   entries, the directory, every secret, the Worker script, and
   whatever the logs held. The minute this costs is what makes step 7's
   message accurate instead of reassuring. **Owner.**
4. **Redeploy the Worker from this repository, not from what is sitting
   there.** What is deployed is whatever the attacker last left,
   however normal it looks. Deploy per "Deploying the Worker", then run
   the probe in "Checking a deployment" before believing it. **Owner
   only.**
5. **Revoke the bot token in BotFather.** Its revocation lives at
   Telegram rather than at Cloudflare, which makes it the one
   credential an attacker cannot keep by holding the account.
   **Owner.**
6. **Clear the sessions table**, per step 3 of the section above:
   sign-in payloads could be minted while the bot token was readable,
   and those sessions outlive every rotation. **Owner.**
7. **Tell the group plainly, and do not soften it.** Whoever held the
   account could read the entries; say so, say what window, and say
   what was done about each credential. Then check the rows against a
   backup — reading was not the only option, and altered rows do not
   announce themselves — and name anything restored and where it came
   from. A member who reads the message knows exactly as much as the
   owner does, which is the standard. **Owner.**

## Getting back

The site is a `git revert`: the published `dist/` is committed beside
the `apps/web` it was built from, so reverting restores the pages
exactly and cannot leave the two disagreeing. The Worker is not — it
deploys separately, and Cloudflare's `wrangler rollback` to a named
version is a **never-exercised** line. A rollback plan naming an
artifact nobody has confirmed exists is not a rollback plan. The hotfix
procedure for the live site is in `README.md`, which is on `main` when
you need it.
