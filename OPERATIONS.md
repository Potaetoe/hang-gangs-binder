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
| `GET /me` | any session | entry count, last submission, admin flag, own account id |
| `POST /submit` | member session | appends one ciphertext row, tagged with the account id |
| `GET /export` | admin | returns every row |
| `POST /snapshot` | admin | replaces the published aggregate |
| `GET /snapshot` | any session | returns it — members only |
| `DELETE /snapshot` | admin | takes it down |
| `DELETE /submission/:id` | admin | removes one row |

`EXPORT_TOKEN` opens every admin route as break-glass. It is not a
member, so it cannot submit — there is no account for it to write to.
Session lifetimes are constants in `server/worker.js` (member seven
days, admin two hours — the admin session opens the whole corpus's
ciphertext). Both `DELETE` routes are idempotent: deleting what is not
there succeeds, so a success does not prove a row existed.

`[pre-cutover]` The deployed Worker still runs the pre-accounts routes:
an open `POST /submit`, `EXPORT_TOKEN` on the read paths, an ungated
`GET /snapshot`, no auth routes and no per-row delete. **Do not deploy
`server/worker.js` ahead of the cutover** — against the live site it
returns 401 to every submitter, and the new schema's `NOT NULL
account_id` refuses the old form's rows. The ordering inside the
sitting is `CUTOVER.md`'s.

## Secrets

All set in Cloudflare (dashboard → Worker → Settings → Variables and
Secrets), never in this repository, never handled by an agent.

**Production carries six, each a Secret, plus one plaintext variable:**

| Name | What it is |
| --- | --- |
| `EXPORT_TOKEN` | break-glass admin credential; keep it reachable *without* the site — it exists for when sign-in is broken |
| `TELEGRAM_BOT_TOKEN` | from BotFather; verifies every login payload; never logged. Leak costs a `/revoke` and a re-paste |
| `ACCOUNT_SECRET` | the HMAC key behind every account id — **see below** |
| `ADMIN_TELEGRAM_IDS` | comma-separated **numeric** ids, not handles |
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
Telegram group in the same sitting.** `submit.html` shows the key it
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

1. Sign in on the live site with a Telegram account whose numeric id is
   in `ADMIN_TELEGRAM_IDS`, and open the export page in the same tab. A
   member session is refused with a message saying so. The session is
   tab-scoped: closing the tab signs you out, deliberately.
2. Provide the **key file** — pasted or picked; read in the page, never
   uploaded.
3. **Fetch and decrypt**, then download CSV, Excel or JSON. Below them:
   the keyholder dashboard.

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
page is the only place the data exists in the clear.

## Publishing and retracting the dashboard

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

## Making someone an admin

Admin rights are a **numeric Telegram id** in `ADMIN_TELEGRAM_IDS` —
not a handle; handles change and get reused.

1. They sign in on the live site — any member can. Their numeric id
   arrives in the session; until a page displays it (#58), read it from
   devtools → Application → Session storage → `hgb-session` →
   `telegramId`.
2. The owner adds that number to `ADMIN_TELEGRAM_IDS` in the dashboard.
3. They **sign out and back in.** The admin flag is minted at sign-in
   and stored on the session row — an existing session keeps being
   refused, which looks exactly like the id being wrong.

If everyone is locked out — no admin id works, the bot is gone from the
group — `ALWAYS_ALLOW_TELEGRAM_IDS` and `EXPORT_TOKEN` are the two ways
back, both set in the dashboard.

## Handing the project to someone else

**The one thing to understand first: there is no recovery from a lost
private key.** If you are receiving this project, make a second copy of
the key file today.

Five things move, independently — whoever holds one does not
automatically get the others:

| Thing | What it gets them | How to hand it over |
| --- | --- | --- |
| The private key | reads the submissions | the key file, out of band — never email, never the repo |
| An admin id | fetches ciphertext, publishes, deletes rows | add their numeric id to `ADMIN_TELEGRAM_IDS` |
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
them, silently; the detection is a member comparing what `submit.html`
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
   members' dashboard too, which is the intended shape: a visible stop
   beats a silent one. **Owner only** — an admin id does not reach the
   dashboard. Two consequences to expect: your own break-glass `curl`
   in "Publishing and retracting the dashboard" must now send the new
   origin, and the next `wrangler deploy` puts the old value back,
   because `deploy` applies `[vars]` over the dashboard's.
2. **Capture what you are looking at, before touching anything.** The
   value `submit.html` is showing, the text of the pinned message, and
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

## Getting back

The site is a `git revert` — `apps/web` is the build, so reverting
restores the pages exactly. The Worker is not: it deploys separately.
A capture of the pre-accounts production script exists **outside this
repository** at `binder-recovery/` (version
`2d3c73a5-1095-42db-a810-c8c0ba1a5c24`, with its own README), and
Cloudflare's `wrangler rollback` to that version is a second,
**never-exercised** line. A rollback plan naming an artifact nobody has
confirmed exists is not a rollback plan. The hotfix procedure for the
live site is in `README.md`, which is on `main` when you need it.
