# Scaffolding the accounts redesign

Recorded 2026-08-05. **Step 1 is built and tested. Nothing is deployed.**

`DESIGN.md` says *why* accounts, what was rejected, and what it costs.
This file is the other half: the shape the code lands into, the setup
only the account owner can do, and the order that keeps the site working
while it changes underneath.

Read `DESIGN.md`'s `## Accounts` and `## Build order — accounts` first.
Everything here assumes those decisions and does not re-argue them.

## What is true right now

**The live site and the live endpoint have no accounts.** Nothing a
visitor can reach has changed.

**`server/worker.js`, `server/schema.sql` and `dev/worker.test.mjs` are
ahead of the deployment**, as of 2026-08-05. The accounts Worker is
written and passes 64 checks including mutation testing; the pages that
would sign somebody in do not exist yet.

> **Deploying `worker.js` now would 401 every submitter.** The form
> encrypts fine and is then refused, because it sends no session. The
> schema is worse: the new `submissions` table has a `NOT NULL
> account_id` that nothing on the live site knows how to supply. Step 1
> deliberately stops at "written and tested" — the deploy belongs after
> step 3.

`README.md`, `HANDOFF.md`, `server/README.md` and `server/wrangler.toml`
describe **the deployment as it currently runs**, and every procedure in
them works today. They are deliberately not rewritten ahead of the code
— a runbook that describes a system which does not exist yet is worse
than a stale one, because somebody follows it during an incident. Each
carries a pointer here, and `server/README.md` carries the
do-not-deploy warning in full.

> **One exception found 2026-08-06, corrected 2026-08-07:**
> `server/wrangler.toml`'s comment block said `ADMIN_TELEGRAM_IDS`,
> `TELEGRAM_GROUP_CHAT_ID` and `ALWAYS_ALLOW_TELEGRAM_IDS` "are plaintext
> vars rather than secrets", while all three were already set as
> **secrets** on the live Worker. The paragraph above is why this was
> flagged rather than left: the file claimed to describe what currently
> ran, so a reader had no cue that this part did not. Issue #30 corrected
> the config and the other live copies of that claim. See Part 8b.

## What is done

**Updated 2026-08-07. Every build step is closed.** Everything below is on
`accounts`; `main` is still the last complete release and **nothing here is
deployed.** What remains is not build work — it is the cutover, and it has
its own document: [CUTOVER.md](CUTOVER.md).

> **Cutover progress, 2026-08-08.** Steps **0** (capture the live Worker) and
> **1** (rehearse the migration) are **done**, and step **2**'s secrets are
> confirmed from two independent sources. **UAT Part A is complete** — A2.7
> was its last gap and #64's fix closed it the same day; `UAT.md` holds the
> record. Nothing has been deployed to production and nothing has been
> written to it.
>
> Step 1 falsified its own warning: running `schema.sql` against production's
> shape fails **loudly and immediately**, leaving no half-migrated state,
> because `CREATE INDEX ... (account_id)` dies before `sessions` is reached.
> `CUTOVER.md` step 1 carries the detail.
>
> The next act is step **4**, which is the point of no return.

| Step | State |
| --- | --- |
| 0 — `ui.js` | **done** (#14, #1) |
| 0.5 — dev Worker and D1 | **done** (#16, #2), isolation verified both directions |
| 1 — Worker: auth, sessions, account id | **built and tested, not deployed** — the deploy is a cutover step |
| 2 — clear and unpublish | **both done** — unpublish 2026-08-06, clear 2026-08-07 (1 row → 0). **Re-run the clear at cutover**, see below |
| 3 — sign-in page, form to `submit.html` | **done** — session half (#17, #4), widget half (#26) |
| 4 — `POST /submit` requires a session | **done 2026-08-07** (#5); the live half waits on cutover |
| 5 — the panel, `GET /me` | **done 2026-08-07** (#6) |
| 6 — `GET /snapshot` requires a session | **done 2026-08-07** (#7) |
| 7 — `admin.html` on an admin session, row deletion | **done 2026-08-07** (#8) |
| 8 — quantize the series | **done** (#12, #9), plus the suppression floor (#19) |
| 9 — `check_web.py` checks | **done 2026-08-07** (#10) — landed distributed across #26, #34 and #41 rather than as one slice, and the gate ended up **two checks ahead** of what this step specified |
| 10 — rewrite the runbooks | **done 2026-08-07** (#11). The do-not-deploy warning was deliberately **kept**, since the cutover has not happened |

Beyond the build order, three hardening slices the plan did not anticipate
landed the same day and are worth knowing about before the cutover, because
two of them changed what the gate refuses:

| | |
| --- | --- |
| #34 | every page's **whole** CSP is pinned, through a parser that reports rather than skips |
| #41 | check 14 — no file but `config.js` may carry a base64 key-shaped literal |
| #39 | checks 3 and 4 — the gate reads `server/` at all, so a `[vars]` block cannot publish the member ids |
| #56 | the device-local prefill is scoped to an account, so a shared browser does not leak measurements |

**This section is the plan's own record and stops here.** The build is done;
`CUTOVER.md` is what happens next, and `HANDOFF.md` is what is true afterwards.

**The clear is not durable until cutover, and this is new.** It was done
ahead of Part 8 rather than at it. `main` still ships the pre-accounts
public submission form, and production `POST /submit` still answers
`400 Missing ciphertext` rather than `401` — it validates the body and
never asks for a session. So any visitor can put a row back, and that row
carries a `NULL` `account_id`, which is the state accounts exists to
remove.

**Re-run the clear immediately before cutover.** One line, already
rehearsed, written out on #3. The alternative — taking the form off
`main` now — is a live release, which is a much larger act for the same
effect.

Step 1 landed before step 0 because it needed nothing from anybody: no
bot, no Cloudflare, no secrets. The owner errands are now done — the bot
exists and `/setdomain` is set — so nothing in the build order is
blocked on anyone outside it.

**The bot is `@hanggangbinder_bot`.** Its token and the owner's numeric
id are not in this repository and must not be; see Part 8b for where
they belong and why the obvious answer is wrong.

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

The bot token is a credential of the same rank as `EXPORT_TOKEN`:
anyone holding it can forge a login payload for any Telegram user, and
therefore a session for any member. `/revoke` in BotFather issues a new
one if it ever leaks. Revoking it does **not** disturb account ids —
those derive from `ACCOUNT_SECRET` and the numeric user id, and the bot
token is not an input. Losing the bot token costs a re-paste; losing
`ACCOUNT_SECRET` costs the data's structure.

`tools/check_web.py`'s check 2 should learn the bot token's shape —
`\d{8,10}:[A-Za-z0-9_-]{35}` is distinctive enough to catch, and
`apps/web` is exactly where somebody pastes one "just to test the login
locally". It is the same accident the private-key patterns exist for,
with a new credential.

### Sign-in cannot be tested locally, and that is a real cost

`/setdomain` binds the widget to one origin, and Telegram will not
accept `localhost`. So **the login widget does not work on
`http://localhost:8124`**, which collides with this project's rule that
a push to `main` is a release and is verified locally first.

This is a cost of choosing the widget over the bot deep-link flow, which
has no domain binding and would have worked from any origin. It was not
priced in when that choice was made, and it should be recorded as part
of the price rather than discovered at step 3.

**The way through is a development sign-in route on the development
Worker**, specified in Part 1b. It is a real hole in a real boundary and
it is built accordingly: four independent conditions, every one failing
closed, a `404` rather than a `401` so production does not advertise it,
sessions visibly marked as development on screen, and two tests that
assert it refuses when its secret is absent.

What stays unverifiable anywhere but production is the widget rendering
and its callback — a small surface, identical on every deployment, and
checked on the live site once before anyone is told the URL. Everything
downstream of holding a session is exercised locally.

Considered and not chosen: pasting a genuine session token into the
local page, obtained from a real sign-in on the live site. It bypasses
nothing, which is its whole appeal, but the payload's five-minute
freshness window makes it a race every time and it cannot mint a second
member to test against.

### The Cloudflare secrets

Workers & Pages → the Worker → Settings → Variables and Secrets:

| Name | Kind | What it is |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | **secret** | From BotFather. Verifies every login payload. |
| `ACCOUNT_SECRET` | **secret** | A long random string you generate. The HMAC key behind every account id. |
| `ADMIN_TELEGRAM_IDS` | **secret** | Comma-separated **numeric** Telegram ids. Not handles. |
| `TELEGRAM_GROUP_CHAT_ID` | **secret** | Optional. Only members of this group may sign in. |
| `ALWAYS_ALLOW_TELEGRAM_IDS` | **secret** | Optional. Ids that bypass the group check and preserve the way back in. |

The first two are secrets because they are credentials: either one lets
its holder cross a boundary the Worker trusts. The three numeric id
bindings are not credentials, but they still need the two properties a
secret has and a var does not here. A `[vars]` block is committed to this
public repository, exposing the allowlist of group members, while a var
set only in the dashboard is silently erased by the next deploy. Secrets
keep the ids out of the repository and survive a deploy; Part 8b records
the correction in full.

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

## Part 1b — The non-production environment

Added 2026-08-05, before any of the accounts work. See `DESIGN.md`,
"What is deliberately not here", for why this is an *environment* and
still not a branch.

**It fixes something already broken.** `config.js` names one endpoint,
so the local preview writes to the production database — pressing Submit
on `localhost:8124` puts a real row in the live D1. That is how
`zzztestrow` got in. Doing this first also means step 2's `DROP TABLE`
is rehearsed rather than performed for the first time on real data.

### A second Worker and D1

`server/wrangler.toml` gains an environment block. **Set `name`
explicitly** rather than letting wrangler derive it — the file's
existing comment already says why a wrong Worker name is not an error
but a success somewhere else.

```toml
[env.dev]
name = "hgbinderworker-dev"

[env.dev.vars]
ALLOWED_ORIGINS = "http://localhost:8124,http://127.0.0.1:8124"

[[env.dev.d1_databases]]
binding = "DB"
database_name = "hg_binder_db_dev"
database_id = "..."
```

```bash
wrangler d1 create hg_binder_db_dev
wrangler d1 execute hg_binder_db_dev --remote --file=schema.sql --env dev
wrangler secret put EXPORT_TOKEN --env dev
wrangler secret put DEV_LOGIN_SECRET --env dev   # dev only, never prod
wrangler deploy --env dev
```

Each secret is set per environment. **Give development its own values
for all of them** — a shared `EXPORT_TOKEN` would mean a token pasted
into a scratch page also opens production.

`DEV_LOGIN_SECRET` is the exception in the other direction: it is set on
development and **must never be set on production**, where its absence
is what turns the route below off. It is the only secret in this project
whose safety comes from not existing somewhere.

### `config.js` chooses by hostname

One committed file, no build step, and no local edit that can ship by
accident:

```js
const ENVIRONMENTS = {
  "potaetoe.github.io": {
    name: "production",
    endpoint: "https://hgbinderworker.sorcererbiggz.workers.dev",
    publicKey: "BF...",
  },
  "localhost": {
    name: "development",
    endpoint: "https://hgbinderworker-dev.sorcererbiggz.workers.dev",
    publicKey: "BK...",
  },
};
ENVIRONMENTS["127.0.0.1"] = ENVIRONMENTS.localhost;

// No default. An unrecognized host gets no key, which is the state the
// form already handles and says out loud - submissions closed. A
// default of "production" is the accident this whole arrangement exists
// to prevent.
globalThis.BINDER_CONFIG =
  ENVIRONMENTS[location.hostname] || { name: "unknown", publicKey: null };
```

Development needs **its own keypair**, from `tools/keygen.html`. Sharing
production's would mean loading the real private key to read test rows.
The development private key is a convenience and not a secret; it still
does not belong in the repository, because check 2 cannot tell two
private keys apart and should not have to.

### What `check_web.py` gains

Checks 4 and 5 currently assume one endpoint and one key. They become:

- every arm's `publicKey` is a real P-256 point, not just the first one
  the regex finds;
- every arm's origin appears in the `connect-src` of every page that
  loads `config.js`;
- **no two arms share an endpoint or a public key** — that is what a
  half-finished copy-and-paste looks like, and it is the exact shape of
  production silently pointing at development;
- the arm named `production` carries the deployed host as its key.

### Local sign-in: `POST /auth/dev`

The widget is bound to one domain and Telegram will not accept
`localhost`, so the development environment cannot mint a member session
the ordinary way. Decided 2026-08-05: it gets a **development sign-in
route** rather than making local work stop at the session boundary.

This is a deliberate hole in the boundary that now enforces everything,
so the entire design of it is about which way it fails. Four conditions
gate it and **every one of them fails closed**:

1. **`DEV_LOGIN_SECRET` must be set.** Absent, the route does not exist.
   The existing `authorized()` is the pattern to copy exactly — it reads
   `Boolean(env.EXPORT_TOKEN) && tokenMatches(...)`, so a missing secret
   refuses rather than skips the check. A guard written the other way up
   is the whole risk in one line.
2. **The caller must present that secret**, compared with the same
   constant-time helper as the export token.
3. **The `Origin` must be loopback** — `http://localhost:*` or
   `http://127.0.0.1:*`. Positive matching, not a deny list: the route
   never needs to know what production is, so it cannot be wrong about
   it. A development login only makes sense from a local page, and this
   is that sentence written as code.
4. **It answers `404`, not `401`**, when any of the above fails. A
   production deployment does not advertise a route it will not serve.

```
POST /auth/dev   { "secret": "...", "subject": "alice", "admin": false }
```

`account_id = HMAC(ACCOUNT_SECRET, "dev:" + subject)`. The `dev:` prefix
is namespacing, not decoration: a real account id derives from a numeric
Telegram id, so a prefixed subject can never collide with one even if
the two environments were ever handed the same `ACCOUNT_SECRET`.

`subject` being free text is the point — it is what lets local work test
two members, a repeat submitter, and an admin without needing three
Telegram accounts.

**Sessions minted this way are marked.** A `is_dev` column on `sessions`,
returned by `GET /me`, and the pages show a visible banner while one is
in use. A development session must never be mistakable for a real one,
and the cheapest way to guarantee that is for it to say so on screen.

**Two tests carry this, and they are the reason it is safe rather than
merely intended.** With no `DEV_LOGIN_SECRET` in `env`, every body gets
a 404. With the secret set but a non-loopback `Origin`, every body gets
a 404. Both confirmed by mutation — the same discipline the crypto
fixture and check 7 were confirmed with, applied here because this is
the one route where a silent pass is a real compromise.

**Built and mutation-tested 2026-08-05, and the mutation found
something.** Removing the `DEV_LOGIN_SECRET` guard on its own does not
break any test, because `tokenMatches` now refuses an unset secret
rather than comparing against it — two independent conditions, either
one of which alone keeps the route closed. Removing *both* fails two
tests, which is the property being armed. That is the right shape: the
tests assert the property rather than the implementation, and the route
has defence in depth rather than one line standing between development
and production.

`tokenMatches` did not start out that way. Given an undefined secret it
compared against `expected.length` and threw, so the first mutation run
reported a crash as "zero failures" — a reminder that a harness counting
failures has to count a dead run as one too.

Production simply never sets `DEV_LOGIN_SECRET`, and the tests above are
what stop that being the only thing standing between the two.

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
  -- Minted by POST /auth/dev rather than by Telegram. Defaults to 0, so
  -- a session is only ever a development one by having said so. GET /me
  -- returns it and the pages show a banner: a development session must
  -- never be mistakable for a real one.
  is_dev     INTEGER NOT NULL DEFAULT 0,
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
| `POST /auth/dev` | `DEV_LOGIN_SECRET` **and** a loopback origin | **new** — development only; `404` everywhere else. See Part 1b |
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

**Confirmed 2026-08-06, and the warning above earned its keep — it
wanted a third directive.** The real policy is

```
script-src 'self' 'unsafe-eval' https://telegram.org;
frame-src https://oauth.telegram.org
```

`telegram-widget.js` fails before creating its iframe with
`EvalError: Evaluating a string as JavaScript violates script-src`,
because Telegram's source puts `data-onauth` through `__parseFunction`,
which uses `eval`. Callback mode cannot work without it. Redirect mode
needs no eval and was rejected: it returns the signed payload in a URL
query string, putting the numeric id and handle into browser history,
`Referer` headers and host access logs on every sign-in. `DESIGN.md`,
"The policy needed a third exception", carries the full reasoning and
one correction to the sentence above this table — **the sign-in page is
not a page with nothing to steal**, because after sign-in it holds the
session. Trusting Telegram's script with that is inherent to using
Telegram's widget, which is the honest form of the claim.

Still unconfirmed: the real render and callback. BotFather binds the
widget to `potaetoe.github.io`, so localhost shows "Bot domain invalid"
and both remain cutover checks.

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
5. **`POST /auth/dev` fails closed**, which is the most important test
   in this file. With no `DEV_LOGIN_SECRET` in `env`, every body gets a
   404. With the secret set but the `Origin` not loopback, every body
   gets a 404. Confirmed by mutation, both directions — a test that
   passes because the route is broken for an unrelated reason is worth
   nothing here.

   The other tests protect the data. This one protects the boundary that
   protects the data, and it is the only place in the Worker where a
   silently-passing check is itself the compromise.

### `dev/dashboard.test.mjs` gains the assertion that was missing

The existing test asserts no handle appears in a published document.
That always passed and was never the question.

**This section originally specified the missing assertion as:**

> ~~Two snapshots of the same corpus, one with an extra entry, share no
> exact series point.~~

**That criterion is not achievable, and the correction is recorded here
rather than quietly rewritten** — for the same reason the linkage claim
it was meant to fix is recorded as false rather than deleted.

Quantization is a deterministic function of a point. An entry that did
not change quantizes the same way in both documents, so the two
snapshots go on sharing points — and coarsening makes them *more* alike,
not less. Demonstrated while building step 8: all three of one person's
points survived into the second snapshot unchanged. Only per-publication
randomness could satisfy the sentence as written, and that would make
the chart lie without preventing an approximate match.

**What quantization actually buys is ambiguity, not absence.** A
published point stops being a *unique* key, because several people's
different measurements land on the same date and the same bin. So the
assertions are:

> A published point carries the date, not the instant, and a weight on
> the histogram's own bin edge. Two people with different measurements
> share one published point. The keyholder's own snapshot keeps full
> precision. The shape of a line survives.

All five landed in `dev/dashboard.test.mjs`, each confirmed armed by
mutation in both directions.

### CI

`.github/workflows/deploy.yml` currently runs four Node tests. It keeps
running four; they just cover more.

---

## Part 6 — `tools/check_web.py`

| Check | What happens to it |
| --- | --- |
| 2 — nothing key-shaped in `apps/web` | Gains the bot token's shape, `\d{8,10}:[A-Za-z0-9_-]{35}`. A new credential exists and `apps/web` is where somebody pastes one to test a login. |
| 4 — endpoint in `connect-src` | Now spans `index.html` and `submit.html` too. No code change; it derives its own file list. |
| 6 — sending requires encryption | **Third revision.** `index.html` will POST a login payload without loading `crypto.js`. Gains a named exemption list with a reason per entry, rather than being widened again. |
| 8 — units default | **Hardcoded to `index.html` as `FORM_PAGE`.** Must point at `submit.html`, or it fails against a page that no longer has unit radios. |
| 10 — navigation identical | Now five pages, and the nav itself changes. |
| **11 — new** | The sign-in page must not load `crypto.js`. The whole argument for allowing third-party script there is that there is no plaintext to see. |
| **12 — new** | No page except the sign-in page may name `telegram.org` **or `'unsafe-eval'`** in its CSP, **and the sign-in page's own `script-src` and `frame-src` must name exactly the four permitted tokens.** The exception is survivable because it is confined; this keeps it confined when somebody copies a head from whichever page they had open, *and* keeps it narrow where it lives. |

**The second half of check 12 was missing from the first
implementation**, and that is worth stating rather than quietly fixing.
As written it refused the exception on every *other* page and skipped
`index.html` entirely — enforcing *the exception does not spread* while
leaving *the exception stays narrow* unguarded, when narrowness is the
only reason the exception is acceptable at all. Rewriting the sign-in
page's policy as `script-src 'self' 'unsafe-eval' 'unsafe-inline'
https://telegram.org https://evil.example` left the whole gate green.
Same corollary as check 5's: **a check computed entirely from the file
it guards cannot detect that the file's contents were rearranged** —
something outside the file has to say what the file may contain.

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
| 0.5 | **Dev Worker, dev D1, hostname-switched `config.js`** | A local preview submits to the dev database and **cannot** reach production; `check_web.py`'s new arm checks confirmed armed by mutation |
| 1 | Worker: auth, sessions, account id | A real sign-in returns a session, and the Worker reports your numeric id so `ADMIN_TELEGRAM_IDS` can be set from fact |
| 2 | **Clear the table** (unpublish done 2026-08-06) | See Part 8 — it happens at the cutover, and it is the point of no return |
| 3 | `index.html` → sign-in, form → `submit.html` | Sign-in works end to end on the **live site** — it cannot work locally, see Part 1 — with no gate yet behind it |
| 4 | `POST /submit` requires a session | A submission arrives with an `account_id`, and a signed-out `curl` is refused |
| 5 | The panel, `GET /me` | Counts match what is in the table |
| 6 | `GET /snapshot` requires a session | The dashboard still draws for a signed-in member |
| 7 | `admin.html` on an admin session, row deletion | An export still decrypts; a deleted row is gone and the rest are intact |
| 8 | Quantize the series | The two-snapshot test passes |
| 9 | `check_web.py` | Every new check confirmed armed by mutation, both directions |
| 10 | Rewrite the runbooks | Part 9 |

Step 1 before step 2 is the important one. The schema and the account id
have to be settled before anything is destroyed, because the destruction
is what makes them unchangeable.

---

## Part 8 — The cutover

> **The runbook you actually follow on the day is [CUTOVER.md](CUTOVER.md).**
> This part is the reasoning behind it and stays here; it is not duplicated
> there. The split is deliberate: this document is 1000 lines of plan, and
> the cutover is a single pass with a table drop in it and a permanent
> secret — not something to navigate a design document for. Read this part
> once, beforehand, to understand *why* the order is the order. Follow
> `CUTOVER.md` while doing it.

This part was "the two irreversible things" and understated the job. The
redesign does not arrive gradually: it arrives in one sitting that
contains three irreversible acts, one verification that cannot be done
anywhere else, and a capture that has to happen before any of them.

**Unpublishing was the fourth and is already done** — 2026-08-06, ahead
of schedule, because the published snapshot described exactly one person
and was being served unauthenticated. See `DAILY_LOG.md`. What was left
of step 2 is the clear.

### What is irreversible, and what only looks like it

| Act | Reversible? |
| --- | --- |
| Clearing `submissions` | **No.** No backup, and an export is not one — nothing turns plaintext back into ciphertext |
| Setting `ACCOUNT_SECRET` | **No, the moment one row carries an id derived from it.** Irreversible without looking it |
| Deploying the accounts Worker | **Only if the current script was captured first** — see below |
| Merging `accounts` → `main` | Yes. `apps/web` is the build, so a `git revert` restores the pages exactly |
| Unpublishing | Done. Was always reversible — a snapshot is derived from rows |

### Step 0, before anything else: capture what production is now

**Part 10 promises a Worker rollback that does not exist.** It says to
keep the working `worker.js` at a known commit and be ready to
`wrangler deploy` from it. But the live production script reports
`Source: Unknown (version_upload)` — verified 2026-08-06 — meaning it
was hand-pasted and matches **no commit in this repository**. There is
currently nothing to roll back *to*. A deploy overwrites the only copy.

So the first act of the sitting is not a change at all: open the Worker
in the Cloudflare dashboard, copy the live script, and save it outside
the repository. It holds no secrets — bindings and secrets are stored
separately — but do not commit it; it is a recovery artifact, not
source.

The live bindings, verified 2026-08-06, so a mistaken deploy can be
repaired against fact rather than memory:

```
EXPORT_TOKEN         secret, present
env.DB               D1 948f3464-e93c-4c8c-b64f-871065c3ee74
env.ALLOWED_ORIGINS  "https://potaetoe.github.io"
compatibility_date   2026-08-04
```

`server/wrangler.toml` already matches all of it, so a deploy will not
silently move production's origin policy. That was worth checking rather
than assuming: **`deploy` preserves secrets but applies `[vars]` over
whatever the dashboard had**, so a var that lives only in the dashboard
is erased by the next deploy — see Part 8b, which is about exactly that.

### The order

> **Steps 2 and 3 are already done** — the owner confirmed all six production
> secrets from the dashboard on 2026-08-07, every id binding as a Secret
> rather than a `[vars]` entry, with `DEV_LOGIN_SECRET` correctly absent. They
> are struck through below rather than deleted, so the table still reads as
> the plan it was.
>
> `ACCOUNT_SECRET` being set is **not** yet the irreversible moment — no
> production row carries an id derived from it, since the table was cleared
> and the live Worker writes no `account_id`. That closes at step 8.
> [CUTOVER.md](CUTOVER.md) carries the distinction.

| # | Act | Do not continue until | Back out? |
| --- | --- | --- | --- |
| 0 | Capture the live script and bindings | The file exists outside the repo and is not empty | n/a |
| 1 | Rehearse the migration on `hg_binder_db_dev` | A row submits and reads back under the new shape | Free |
| 2 | ~~Set `ACCOUNT_SECRET` and `TELEGRAM_BOT_TOKEN` on production~~ — **done 2026-08-07**, confirm only | All six are listed as Secrets | Nothing to back out |
| 3 | ~~Set the admin id — as a secret, not a var~~ — **done 2026-08-07**, Part 8b | Listed alongside them | Free |
| 4 | `DROP TABLE submissions`, then run `schema.sql` | The new table exists with `account_id NOT NULL` | **POINT OF NO RETURN** |
| 5 | `wrangler deploy` the accounts Worker | The probe matrix in `server/README.md` agrees | Only via step 0's capture |
| 6 | Merge `accounts` → `main` | CI shows `deploy` **ran**, not skipped | `git revert` |
| 7 | Sign in on the live site through the widget | A session is minted and reaches `submit.html` | — |
| 8 | One real submission, then one export | The export decrypts | — |
| 9 | Aftercare | Below | — |

Step 4 is both the clear and the migration, which is why they are one
line. `DROP TABLE` takes the rows, the table and its `sqlite_sequence`
entry together, and `schema.sql` then creates the new shape. The
separate `DELETE FROM sqlite_sequence` is only needed on the
clear-without-migrating path.

### The trap in `schema.sql`

It uses `CREATE TABLE IF NOT EXISTS`. Run it against production without
dropping first and it **silently skips `submissions`**, creating
`sessions` beside an unmigrated table and reporting success. Nothing in
`dev/` can see this; the failure surfaces on the first real submission,
against `NOT NULL account_id`.

The drop must therefore be explicit and deliberate, not a side effect
somebody assumes. Rehearse the whole sequence on `hg_binder_db_dev`
first — that is most of what step 0.5 bought. Every schema change this
project made before it was first executed against production.

### After step 4, forward is the only direction

**The data is not the frightening part.** It is discarded on purpose and
the group re-submits; that is the point of doing it now, while there is
almost nothing to lose.

The frightening part is being live with a sign-in nobody can pass.
Reverting the site does not help: the old form posts to a Worker that by
then requires a session, so the previous pages refuse everybody too.
There is no state left that serves anyone until sign-in works. That is
the risk the sitting is really managing, and it is why step 7 is the one
to rehearse hardest and why Part 8a exists.

### Aftercare

- Delete the `accounts` branch. It was temporary by design, and the
  answer to the staging-branch objection in `DESIGN.md` depends on it
  actually being deleted.
- Unfreeze the runbooks — step 10, Part 9. They have been deliberately
  stale and are now the last thing describing a system that does not
  exist.
- Remove the throwaway sign-in probe page if Part 8a was used.
- Re-publish a snapshot only once the group has re-submitted and the
  suppression floor has something to work with.

---

## Part 8a — Splitting the widget verification (recommended)

Step 7 bundles two questions that fail for different reasons and can be
separated. Only one of them genuinely has to wait.

- **Does the widget render under our CSP, and does Telegram accept the
  domain?** Testable on the live host *before* the point of no return.
- **Does `POST /auth/telegram` mint a session?** Only testable after the
  Worker is deployed. This half cannot be moved.

The first is worth buying early, because a wrong CSP discovered at step
7 is discovered with the table already dropped. Land a throwaway
`noindex` page on `main` through the hotfix path in `README.md`,
carrying only the widget markup and the candidate policy. Load it,
watch `securitypolicyviolation`, record the real directive set, then
remove the page in a second small PR.

The callback will fail at the last hop, because production has no
`/auth/telegram` route yet. That is expected and is precisely the half
this cannot test.

**The cost, stated plainly:** two small pull requests into a frozen
`main`, and the discipline to actually remove the page. It is the
owner's call, not an agent's — `main` is the live site.

---

## Part 8b — `ADMIN_TELEGRAM_IDS` must be a secret, not a var

`wrangler.toml` currently plans for `ADMIN_TELEGRAM_IDS`,
`TELEGRAM_GROUP_CHAT_ID` and `ALWAYS_ALLOW_TELEGRAM_IDS` to be plaintext
`[vars]`, reasoning that they are numeric ids rather than credentials.
The first half of that is true. The conclusion does not follow, for two
reasons that point the same way.

**This repository is public.** A `[vars]` block is committed. The
allowlist in particular is a **list of the numeric Telegram ids of the
members of this group** — which is the membership oracle the entire
account-id design was built to avoid. `DESIGN.md` rejects handle-derived
account ids precisely so the database cannot answer "is this person a
member"; publishing the allowlist answers it directly, in the clear, for
everyone at once. The admin id is smaller in degree and the same in
kind: it links a named Telegram account to running this group.

**A dashboard var does not survive a deploy.** `deploy` preserves
secrets and applies `[vars]` over whatever the dashboard had, so setting
these in the dashboard to keep them out of the repository means the next
deploy silently erases them — and an erased `ADMIN_TELEGRAM_IDS` means
no admin, discovered when somebody needs to be one.

So neither of the two obvious placements works. **They must be
secrets** — not because they are credentials, but because "survives a
deploy" and "not in a public repository" are exactly the two properties
a secret has and a var does not. The cost is that they no longer appear
in the config that documents the deployment; the comment block in
`wrangler.toml` should say where they live and why, which keeps the file
honest without printing the values.

**Done 2026-08-06 — and `wrangler secret put` is not how, which this
section originally prescribed.** All six production secrets are set.
`wrangler secret put --name hgbinderworker` fails:

```
✘ [ERROR] Prod worker settings can not be deployed with a Version Upload.
  [code: 10220]
```

Production's script was hand-pasted, which leaves the Worker in
**version-upload state**, and `secret put` creates a version *and
deploys it* in one step — a combination Cloudflare refuses there. **This
is not an authentication problem and not fixable by a wrapper; it fails
for anyone, however they authenticate.** The documented alternative is
`wrangler versions secret put` then `wrangler versions deploy`, which
puts a hand-built version live and was not attempted while production
must keep serving the pasted script until cutover.

**The dashboard is the tool**, which is where `ALLOWED_ORIGINS` already
landed for the same reason. Once cutover deploys from this repository
the Worker leaves version-upload state and the CLI should work — re-test
it then rather than assuming either way.

Two traps found alongside, recorded so nobody rebuilds the wrapper that
hit them: **piping a value into `wrangler secret put` breaks its
authentication** (a piped stdin makes wrangler non-interactive, and it
then demands `CLOUDFLARE_API_TOKEN`, which nobody here may handle), and
**`npx --yes wrangler@latest` is not reproducible** — two runs minutes
apart resolved to 4.45.0 and 4.119.0 and failed differently.

**Done 2026-08-07 — the remaining correction reached six live
statements across five files, not the one this section named.**
`server/wrangler.toml`, `server/README.md`'s setup table, the bindings
header in `server/worker.js`, the authoritative `DESIGN.md` bullet and
Part 1's setup table all classified the id bindings as vars; this
file's top exception still said the correction was open. All six now
name or point to the completed secret classification, record why
numeric ids still need the two properties only secrets provide here,
and direct this production deployment to the dashboard until cutover
without recording any value.

---

## Part 9 — The runbooks, afterwards

> **Done 2026-08-07, #11 — and one instruction below was not followed, on
> purpose.** This part told the rewrite to remove `server/README.md`'s
> do-not-deploy warning. It was **kept**: the accounts *work* had landed but
> the *cutover* had not, and deploying the Worker against the live old form
> still returns 401 to every submitter. What was stale was the warning's
> reasoning, which claimed the site was unbuilt — false since step 3 — so it
> now names the ordering constraint instead.
>
> `HANDOFF.md` was also not deferred to after the cutover as this part
> intended. Each affected procedure states both forms, marked, because
> deferring it makes the rewrite a step *inside* a busy irreversible
> operation, and that is the step that gets dropped.
>
> The list below is kept as the specification it was, so the two deviations
> are readable against it rather than invisible.

These were correct at the time and wrong the moment step 4 landed. Rewritten
in this order, last:

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
  should name them. It also gains the `[env.dev]` block at step 0.5,
  which is the earlier change and the one that lands first.
- **`README.md`'s "Running it locally"** — after step 0.5 a local
  preview talks to the development Worker rather than production, which
  is worth saying out loud since it is the opposite of what it did
  before and is the reason the section is safe to follow at all.
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
reverted site. `server/README.md`'s probe table is how to tell which
version is actually live, and it exists because "deployed" and "deployed
the thing you meant" are different claims.

**Corrected 2026-08-06 — this part used to say "keep the working
`worker.js` at a known commit and be ready to `wrangler deploy` from
it", and that rollback does not exist.** Production reports
`Source: Unknown (version_upload)`: the live script was hand-pasted and
matches no commit here, so there is no commit to deploy from and the
first deploy overwrites the only copy. Capturing it is now step 0 of the
cutover, Part 8.

The general form is worth keeping, because it will recur wherever a
deployment is edited by hand: **a rollback plan that names an artifact
nobody has confirmed exists is not a rollback plan.** This one read as
sound for a fortnight.

**The data does not come back.** Nothing about steps 3 onwards is
destructive, but the clear is, and no rollback reaches it. That is
deliberate and survivable — the group re-submits. What no rollback
reaches *and* nobody plans for is a live site whose sign-in refuses
everybody; see Part 8's closing section.

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
