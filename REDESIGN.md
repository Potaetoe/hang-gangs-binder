# Scaffolding the accounts redesign

Recorded 2026-08-05. **Nothing in this document is built yet.**

`DESIGN.md` says *why* accounts, what was rejected, and what it costs.
This file is the other half: the shape the code lands into, the setup
only the account owner can do, and the order that keeps the site working
while it changes underneath.

Read `DESIGN.md`'s `## Accounts` and `## Build order — accounts` first.
Everything here assumes those decisions and does not re-argue them.

## What is true right now

The live site has no accounts. `README.md`, `HANDOFF.md`,
`server/README.md`, `server/schema.sql` and `server/wrangler.toml` all
describe **the deployment as it currently runs**, and they are correct.
They are deliberately not rewritten ahead of the code — a runbook that
describes a system which does not exist yet is worse than a stale one,
because somebody follows it during an incident.

Each of those files carries a pointer to this one. They get rewritten as
the steps below land, not before.

---

## Part 1 — What only the account owner can do

None of this is code, none of it can be done from the repository, and
step 1 of the build order cannot be verified against anything real until
it exists.

### The Telegram bot

In Telegram, message `@BotFather`:

1. `/newbot` — pick a name and a username. It hands back a **bot token**
   that looks like `8123456789:AAF...`. This is a credential. It never
   enters the repository, and it never gets logged.
2. `/setdomain` — choose the bot, then send `potaetoe.github.io`.

The domain step is what makes the login widget work at all; without it
the widget renders and refuses to sign anybody in. The domain is the
*host*, not the project path — the widget matches on origin, and
`potaetoe.github.io` is specific to this account since every other
GitHub user is on their own host.

Keep the bot's username. The widget markup names it.

### The Cloudflare secrets

Workers & Pages → the Worker → Settings → Variables and Secrets:

| Name | Kind | What it is |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | **secret** | From BotFather. Verifies every login payload. |
| `ACCOUNT_SECRET` | **secret** | A long random string you generate. The HMAC key behind every account id. |
| `ADMIN_TELEGRAM_IDS` | plaintext var | Comma-separated **numeric** Telegram ids. Not handles. |

Secrets, not plaintext variables, for the first two — a plaintext
variable is visible in the dashboard to anyone with account access, and
these two are as sensitive as `EXPORT_TOKEN`.

**`ACCOUNT_SECRET` is permanent.** Change it and every account id
changes, every member's entries detach from each other, and there is no
way back — the rows still decrypt, but nothing links a person's four
submissions to one another. Generate it once, store it beside the
private key, and treat editing it as data loss. It belongs in the same
mental category as `crypto.js`'s derivation label: a value that looks
like configuration and is actually part of the stored format.

Your own numeric Telegram id is not your handle. The Worker will log it
back to you on your first sign-in during step 1 if you have not found it
another way — that is the intended route, and it means
`ADMIN_TELEGRAM_IDS` gets set after one sign-in rather than guessed at.

---

## Part 2 — The schema

`submissions` gains a `NOT NULL` column, which SQLite cannot add to a
table that already has rows. The table is being cleared anyway, so it is
dropped and recreated rather than altered — one statement instead of
three, and no half-migrated state to reason about.

```sql
DROP TABLE IF EXISTS submissions;

CREATE TABLE submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT NOT NULL,
  ciphertext  TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS submissions_account
  ON submissions(account_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expiry
  ON sessions(expires_at);
```

`DROP TABLE` also clears the `AUTOINCREMENT` counter, so the separate
`DELETE FROM sqlite_sequence` that used to be needed is not.

`token_hash`, never the token. Reading the sessions table then yields
nothing that can be used as a session — the same reasoning that keeps
plaintext out of `submissions`, applied to a much smaller secret.

`snapshots` is unchanged.

---

## Part 3 — The Worker

### Routes, after

| Route | Who | Change |
| --- | --- | --- |
| `POST /auth/telegram` | anyone, allowed origin | **new** — verifies a widget payload, issues a session |
| `GET /me` | member session | **new** — entry count, last submission, admin flag |
| `POST /submit` | member session | was open to any allowed origin |
| `GET /snapshot` | member session | was open to anyone |
| `GET /export` | admin | was `EXPORT_TOKEN` |
| `POST /snapshot` | admin | was `EXPORT_TOKEN` |
| `DELETE /snapshot` | admin | was `EXPORT_TOKEN` |
| `DELETE /submission/:id` | admin | **new** |

The origin check stays exactly where it is and keeps doing exactly what
it did, which is to say: not very much, and not security. It is worth
saying plainly now that something real sits behind it — `Origin` is a
header `curl` sets for free, and the reason junk cannot be posted any
more is the session check, not the origin check.

### Verifying a login payload

Telegram's scheme, and it must be implemented exactly or it verifies
nothing:

1. Take every field of the payload **except** `hash`.
2. Sort the keys, join as `key=value` with `\n` between them.
3. `secret = SHA-256(bot_token)` — the raw digest, used as an HMAC key.
4. Compare `hash` against `HMAC-SHA256(data_check_string, secret)`,
   in constant time, hex.
5. Reject if `auth_date` is more than **300 seconds** old.

The freshness check is the one people leave out. Without it a captured
payload is a permanent credential, because nothing else in it expires.
Telegram's own guidance allows a day; five minutes is enough for a page
that posts the payload the instant it arrives, and the difference is the
window in which a leaked payload is worth stealing.

### Deriving the account id

```
account_id = hex(HMAC-SHA256(ACCOUNT_SECRET, String(telegram_user.id)))
```

The **numeric id**, not the handle: handles change and ids do not, and
an account should survive somebody renaming themselves.

Admin is decided at sign-in by testing the same HMAC against each id in
`ADMIN_TELEGRAM_IDS`, and recorded on the session. It is not re-read
per request, which means demoting somebody takes effect when their
session expires rather than immediately — an acceptable lag at two
hours, and worth knowing before somebody expects otherwise.

### Sessions

Issued as 32 random bytes, base64url. Stored as `SHA-256(token)`.

| | Lifetime | Why |
| --- | --- | --- |
| Member | 24 hours | Long enough to come back and update the same day. |
| Admin | 2 hours | It opens the entire corpus's ciphertext. |

Expired rows are deleted opportunistically when a session is looked up,
not by a scheduled job. The failure mode of a scheduled job is silence,
and there is nothing here worth a moving part.

**Two kinds of bearer token now arrive on the same header.** `EXPORT_TOKEN`
is break-glass and must keep working; session tokens are the ordinary
path. Resolve in that order — compare against `EXPORT_TOKEN` first, in
constant time, and treat a match as an admin caller; otherwise hash the
value and look it up in `sessions`. Unambiguous, because `EXPORT_TOKEN`
is a fixed string that no issued session can collide with.

### The response the page needs

```json
{ "ok": true, "session": "...", "expiresAt": "...",
  "username": "somehandle", "isAdmin": false }
```

`username` comes back from the Worker rather than being taken from the
widget's own payload client-side, so the page uses the value that was
actually verified.

**This does not make the handle trustworthy** — see `DESIGN.md`,
"Telegram is the identity provider". The record is sealed in the
member's browser, so a member editing their own page can write any
handle into the ciphertext. The account id is the identity that cannot
be forged; the handle is a label. Build accordingly, and treat two
handles under one account id as a data-quality flag rather than an
impossibility.

---

## Part 4 — The site

### Page map

| Page | Was | Becomes |
| --- | --- | --- |
| `index.html` | the form | **sign-in, and nothing else** |
| `submit.html` | — | **new** — the panel and the form |
| `dashboard.html` | public charts | member charts, behind a session |
| `admin.html` | token + key | admin session + key, plus row deletion |
| `404.html` | unchanged | unchanged |

### What each page may load

This table is the security boundary, not a convenience. The one page
permitted third-party script is the one page with nothing to steal.

| Page | `crypto.js` | `telegram.org` | Holds plaintext |
| --- | --- | --- | --- |
| `index.html` | **no** | **yes** | no |
| `submit.html` | yes | **no** | yes |
| `dashboard.html` | no | no | no |
| `admin.html` | yes | no | yes — all of it |
| `404.html` | no | no | no |

`index.html`'s policy gains `script-src https://telegram.org` and
`frame-src https://oauth.telegram.org`. **Confirm the exact directive
set by watching `securitypolicyviolation` on the real page rather than
trusting this table** — the widget opens an iframe and may want more
than the two obvious directives, and this project has been bitten
before by asserting a policy instead of testing one. The `blob:`
question on `admin.html` was settled the same way.

### New shared files

- **`session.js` → `globalThis.BinderSession`.** Reads and writes the
  session in `sessionStorage`, builds the `Authorization` header, and
  sends a signed-out visitor back to `index.html`. Loaded by every page
  except `404.html`.
- **`auth.js`.** Only on `index.html`. Defines the global the widget
  calls, POSTs the payload, stores what comes back, and redirects.

### Do the shared-wiring refactor here, not after

There are about to be five pages instead of four, two of them new. The
duplication already identified — `$` and `show` in three files, four
copies of the checked-radio reader, four copies of the status setter,
three copies of the `DOMContentLoaded` boot guard — becomes seven and
five copies if the new pages are written the way the old ones were.

So `ui.js` lands as part of the scaffolding and the new pages are
written against it. **It must contain no `fetch` and no POST**: check 6
keys on files that send, and a shared network helper would either fail
that check or force it to be weakened, which is how a rule stops meaning
anything. Network stays in each page's own file.

The CSV column table in `admin.js` — eighteen names in `COLUMNS` and
eighteen `blank(entry.…)` calls held in correspondence by line order —
is independent of all of this and can land whenever.

---

## Part 5 — Test scaffolding

### `dev/worker.test.mjs` grows four groups

1. **Payload verification.** A correct payload verifies; a payload with
   one byte changed does not; a payload with a stale `auth_date` does
   not. Confirm each by mutation, both directions, the way the crypto
   fixture was confirmed.
2. **A committed account-id fixture.** Given a fixed secret and a fixed
   numeric id, `account_id` must equal a recorded hex string.

   This is the same argument as the ciphertext fixture in
   `dev/crypto.test.mjs`, and it deserves the same rule: **if it ever
   fails, do not regenerate it.** A changed account id means every
   stored row has detached from its account, and the fix is to find what
   changed, not to bless it.
3. **Session issue, lookup and expiry**, including that a session past
   `expires_at` is refused rather than merely tidied up later.
4. **The route gating matrix.** Every route × {no auth, member session,
   admin session, `EXPORT_TOKEN`} → expected status. Cheap to write as a
   table and it is the thing most likely to be quietly wrong after a
   refactor.

### `dev/dashboard.test.mjs` gains the assertion that was missing

The existing test asserts no handle appears in a published document.
That always passed and was never the question. Add:

> Two snapshots of the same corpus, one with an extra entry, share no
> exact series point.

That is the property the quantisation exists for, and it is the one that
was claimed in prose and never checked.

### CI

`.github/workflows/deploy.yml` currently runs four Node tests. It keeps
running four; they just cover more.

---

## Part 6 — `tools/check_web.py`

| Check | What happens to it |
| --- | --- |
| 4 — endpoint in `connect-src` | Now spans `index.html` and `submit.html` too. No code change; it derives its own file list. |
| 6 — sending requires encryption | **Third revision.** `index.html` will POST a login payload without loading `crypto.js`. Gains a named exemption list with a reason per entry, rather than being widened again. |
| 8 — units default | **Hardcoded to `index.html` as `FORM_PAGE`.** Must point at `submit.html`, or it fails against a page that no longer has unit radios. |
| 10 — navigation identical | Now five pages, and the nav itself changes. |
| **11 — new** | The sign-in page must not load `crypto.js`. The whole argument for allowing third-party script there is that there is no plaintext to see. |
| **12 — new** | No page except the sign-in page may name `telegram.org` in its CSP. The exception is survivable because it is confined; this is what keeps it confined when somebody copies a head from whichever page they had open. |

Check 6's rule has now met three cases it did not mean — "anything
touching the network", then "anything sending a body", now this. Neither
spelling says the thing it is for, which is *the submission record must
be encrypted before it is sent*. An exemption list is an admission that
the check approximates; it is better than a fourth guess at a regex,
because an approximation with a written-down reason beside each
exception is reviewable and a cleverer regex is not.

---

## Part 7 — Order, and the checkpoints between

Follows `DESIGN.md`'s build order. What is added here is what to look at
before moving on.

| # | Step | Do not proceed until |
| --- | --- | --- |
| 0 | Bot, secrets, `ui.js` | `node dev/worker.test.mjs` passes; secrets exist in the dashboard |
| 1 | Worker: auth, sessions, account id | A real sign-in returns a session, and the Worker reports your numeric id so `ADMIN_TELEGRAM_IDS` can be set from fact |
| 2 | **Clear the table, unpublish** | See Part 8 — this is the point of no return |
| 3 | `index.html` → sign-in, form → `submit.html` | Sign-in works end to end with no gate yet behind it |
| 4 | `POST /submit` requires a session | A submission arrives with an `account_id`, and a signed-out `curl` is refused |
| 5 | The panel, `GET /me` | Counts match what is in the table |
| 6 | `GET /snapshot` requires a session | The dashboard still draws for a signed-in member |
| 7 | `admin.html` on an admin session, row deletion | An export still decrypts; a deleted row is gone and the rest are intact |
| 8 | Quantise the series | The two-snapshot test passes |
| 9 | `check_web.py` | Every new check confirmed armed by mutation, both directions |
| 10 | Rewrite the runbooks | Part 9 |

Step 1 before step 2 is the important one. The schema and the account id
have to be settled before anything is destroyed, because the destruction
is what makes them unchangeable.

---

## Part 8 — The two irreversible things

**Clearing `submissions`.** There is no backup and an export is not one
— nothing can turn plaintext back into ciphertext, and a downloaded
export is unencrypted and should be deleted rather than filed. Take an
export first anyway if the current rows are worth reading once, then
delete the file when you are done with it.

**Unpublishing.** Do it in the same sitting as the clear, not after. The
live snapshot describes a group that is about to stop existing, and
leaving it up publishes people whose rows are gone.

And one thing that is irreversible without looking like it:
**setting `ACCOUNT_SECRET`.** The moment one row carries an id derived
from it, it can never change.

---

## Part 9 — The runbooks, afterwards

These are correct today and wrong the moment step 4 lands. Rewrite in
this order, last:

- **`server/README.md`** — the route table, the setup steps for three
  new secrets, and the response table under "Checking a deployment":
  `GET /snapshot` answering 401 rather than 404 becomes the healthy
  signal for an unauthenticated probe. Also fix its cross-reference to
  `DESIGN.md`, "The public dashboard", now "The members' dashboard".
- **`server/schema.sql`** — its header comment says the table is
  append-only with no `DELETE` anywhere, and that `received_at` is the
  only metadata. Both stop being true.
- **`server/wrangler.toml`** — the three new secrets are absent from it
  deliberately, exactly as `EXPORT_TOKEN` is, and the comment saying so
  should name them.
- **`HANDOFF.md`** — the four-things-move table, the export procedure
  (no more token box), the `curl` recovery, and the bootstrap procedure
  for a successor who has to make themselves an admin. Its statement
  that renumbering means two snapshots cannot be lined up is **already
  false about the live system** and has been corrected ahead of the
  code, since the keyholder makes a real decision on it.
- **`README.md`** — "Submitters need no account" is its third sentence.

`dev/README.md` needs nothing: the sample fixture is unaffected, since
it is built from decrypted records and account ids live outside the
blob.

---

## Part 10 — Getting back

The site is a `git revert` — `apps/web` is the build, so reverting the
commit and letting CI run restores the previous pages exactly.

**The Worker is not.** It deploys separately, so a bad Worker outlives a
reverted site. Keep the working `worker.js` at a known commit and be
ready to `wrangler deploy` from it; `server/README.md`'s probe table is
how to tell which version is actually live, and it exists because
"deployed" and "deployed the thing you meant" are different claims.

**The data does not come back.** Nothing about steps 3 onwards is
destructive, but step 2 is, and no rollback reaches it.

---

## What is deliberately not scaffolded

- **Member self-deletion.** A session already proves which rows are
  yours, so the route is small. Left out because "ask an admin" is one
  message in a group where everyone can reach each other. First thing to
  add if the group outgrows asking.
- **A UI for creating admins.** `ADMIN_TELEGRAM_IDS` is a Worker
  variable, so promotion is a Cloudflare dashboard errand. Deliberate:
  an admin who can create an admin means the founding secret stops being
  the only root of trust.
- **Rate limiting.** A session costs a Telegram account, which is enough
  friction at this size.
- **The bot deep-link flow.** The better answer on the merits — no
  third-party script anywhere and no CSP exception — and rejected on
  familiarity. It produces the same account id and the same session, so
  it stays a swap rather than a rewrite if the CSP exception ever
  becomes a problem.
