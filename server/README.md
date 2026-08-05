# server/

The storage endpoint: one Cloudflare Worker (`worker.js`) over one D1
database (`schema.sql`). **Not deployed by CI** — it is set up once, by
hand, by whoever owns the Cloudflare account, and it lives outside the
GitHub Pages deploy entirely.

It is kept in the repo so the endpoint's behaviour is reviewable and so
a new owner can stand up their own copy without reverse engineering the
one that exists.

> ## ⚠ Do not deploy `worker.js` yet
>
> **As of 2026-08-05 this file is ahead of the deployment.** The accounts
> Worker is written and tested, and the site is not: `index.html` is
> still the old form with no sign-in on it.
>
> Deploying now would return **401 to every submitter** — the form would
> encrypt correctly and then be refused, and the only way back is
> re-deploying the previous version. The same is true of the schema: the
> new `submissions` table has a `NOT NULL account_id` that nothing on the
> live site knows how to send.
>
> The live endpoint is the last commit before this one, and it still
> works exactly as the rest of this file describes: an open `POST
> /submit`, an `EXPORT_TOKEN` on the read paths, and a `GET /snapshot`
> anyone can call.
>
> `REDESIGN.md`'s build order says when this changes — step 1 for the
> Worker, and not before step 3 has moved sign-in onto the site. Until
> then, read everything below as *what the deployed Worker does*, and
> `worker.js` as *what it will do*.

**Deployed today** — five routes:

| Route | Who can call it | What it does |
| --- | --- | --- |
| `POST /submit` | anyone, from an allowed origin | appends one row of ciphertext |
| `GET /export` | anyone holding the export token | returns every row |
| `POST /snapshot` | anyone holding the export token | replaces the published aggregate |
| `GET /snapshot` | anyone, from an allowed origin | returns it |
| `DELETE /snapshot` | anyone holding the export token | takes it down |

**In `worker.js`, written and not yet deployed** — the accounts version:

| Route | Who can call it | What it does |
| --- | --- | --- |
| `POST /auth/telegram` | anyone, from an allowed origin | verifies a login payload, issues a session |
| `POST /auth/dev` | `DEV_LOGIN_SECRET` **and** a loopback origin | development sign-in; `404` everywhere else |
| `GET /me` | any session | entry count, last submission, admin flag |
| `POST /submit` | a member session | appends one row, tagged with the account id |
| `GET /export` | an admin | returns every row |
| `POST /snapshot` | an admin | replaces the published aggregate |
| `GET /snapshot` | any session | returns it — members only now |
| `DELETE /snapshot` | an admin | takes it down |
| `DELETE /submission/:id` | an admin | removes one row |

`EXPORT_TOKEN` still opens every admin route, as break-glass. It is not
a member, so it cannot `POST /submit` — there is no account for it to
submit to.

It never decrypts, holds no key, and cannot read what it stores. The
export token is not what keeps the data confidential — the rows are
ciphertext either way — it just stops the corpus being casually
harvestable. See DESIGN.md, "Export".

`GET /snapshot` is the one route with no token on it, and that is
deliberate: what it returns has no handles and no rows in it, only
counts, medians and histogram bins. The Worker cannot compute a
snapshot — doing that requires reading the submissions — so it is built
in the keyholder's browser and this endpoint only holds the result. See
DESIGN.md, "The members' dashboard".

`DELETE /snapshot` is the only destructive route here, and the only one
in the Worker at all — the submissions table has no `DELETE` and no
`UPDATE` path and is not touched by it. It needs the export token and
**not** the private key, so a retraction never waits on decrypting the
corpus first. Deleting nothing succeeds, so pressing Unpublish twice is
not an error.

## Setting it up

No CLI required; all of this is in the Cloudflare dashboard.

1. **Create the database.** Workers & Pages → D1 → create a database
   named `hg_binder_db`. Open its console and run the contents of
   `schema.sql`.
2. **Create the Worker.** Workers & Pages → create a Worker, then edit
   its code and paste in `worker.js`.
3. **Bind the database.** Open the Worker from the Workers & Pages list,
   go to its **Bindings** tab, and add a **D1 database** binding with
   variable name **`DB`** pointing at `hg_binder_db`. The name matters —
   `worker.js` reads `env.DB`.

   A *binding* is a connection to another Cloudflare resource, and is
   not the same screen as *Variables and Secrets* below, even though
   both arrive on the same `env` object in the code. `env.DB` is a live
   database client; `env.EXPORT_TOKEN` is a string.

   Check the Worker redeploys afterwards. A binding added without a
   redeploy is the case where the code is right, every test here passes,
   and the first real request still fails on `env.DB` being undefined.
4. **Add the export token.** Settings → Variables and Secrets → add a
   **secret** named **`EXPORT_TOKEN`**. Generate a long random value and
   store it the same way as the private key; the admin page will ask for
   it. A secret, not a plaintext variable — plaintext variables are
   visible in the dashboard to anyone with account access.
5. **Deploy**, then put the Worker's URL in `apps/web/config.js` and add
   its origin to the `connect-src` of every page that loads
   `config.js`. Until both are done the site cannot talk to it, by
   design; `tools/check_web.py` fails the build if only one is done.

### What the accounts version additionally needs

Not yet, but before `worker.js` is deployed. All of it is Settings →
Variables and Secrets, and `REDESIGN.md` Part 1 has the BotFather half.

| Name | Kind | Notes |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | **secret** | From BotFather. Verifies every login payload. Never logged. |
| `ACCOUNT_SECRET` | **secret** | The HMAC key behind every account id. **Permanent** — see below. |
| `ADMIN_TELEGRAM_IDS` | variable | Comma-separated **numeric** ids, not handles. |
| `TELEGRAM_GROUP_CHAT_ID` | variable | Optional. Set it and only members of that group may sign in. |
| `ALWAYS_ALLOW_TELEGRAM_IDS` | variable | Optional. Ids that skip the group check — and the way back in if the bot is ever removed from the group. |
| `DEV_LOGIN_SECRET` | **secret** | **Development only. Never set this on production** — its absence is what turns `POST /auth/dev` off. |

**`ACCOUNT_SECRET` can never change.** Once one row carries an id
derived from it, changing it detaches every member from their own
history — the rows still decrypt, but nothing links a person's four
entries to each other, and there is no way back. Generate it once, store
it beside the private key, and treat editing it as data loss. It is
configuration in appearance and part of the stored format in fact, in
the same way `crypto.js`'s derivation label is.

Leaving `TELEGRAM_GROUP_CHAT_ID` unset means **anyone with a Telegram
account can sign in**, which is a deployment decision rather than an
oversight — but for a private group it is almost certainly not the one
you want. Getting the chat id needs the bot in the group.

Optionally, add a plaintext variable **`ALLOWED_ORIGINS`** — a
comma-separated list of the origins allowed to POST here. Left unset,
the Worker falls back to the `DEFAULT_ORIGINS` in `worker.js`: this
site, plus `http://localhost:8124` for local work.

**Anyone running their own copy should set it.** It is what lets the
Worker code stay byte-identical across deployments — if you are editing
`worker.js` to change a URL, use this variable instead. Note that
setting it *replaces* the defaults rather than adding to them, which is
deliberate: an inherited deployment should stop accepting the previous
owner's site, not keep quietly writing rows from it.

`server/wrangler.toml` records the same bindings for anyone who would
rather deploy from the command line than the dashboard.

## Updating an existing deployment

**Use wrangler. The dashboard is the fallback, not the default.** From
this directory:

```bash
npx wrangler deploy
```

and, when `schema.sql` has changed:

```bash
npx wrangler d1 execute hg_binder_db --remote --file=schema.sql
```

Authentication is `npx wrangler login` once, which is an OAuth flow in
your own browser.

There are two ways to deploy this Worker and **they can silently
diverge**, which is the whole reason this section names one. Pasting
into the dashboard leaves no trace in the repository, so the code
running at the endpoint and the code in `worker.js` can differ with
nothing anywhere reporting it — and that is not hypothetical: this
file's `wrangler.toml` sat with a `REPLACE_ME` database id and the
wrong Worker name for a day, because nothing ever ran it. A config that
gets executed cannot quietly be wrong.

Use the dashboard when wrangler cannot be installed or authenticated,
and treat that as the exception. Either way, verify against the live
endpoint afterwards rather than trusting that it took — see "Checking a
deployment" below.

`schema.sql` uses `CREATE TABLE IF NOT EXISTS`, so re-running the whole
file against a live database is safe and adds whatever is missing
without touching what is there.

### Checking a deployment

The routes answer differently depending on what is wrong, which makes a
few unauthenticated requests enough to tell deployment problems apart.
None of these need a token, and none of them change anything:

```bash
EP=https://hgbinderworker.sorcererbiggz.workers.dev
curl -s -H "Origin: https://potaetoe.github.io" "$EP/snapshot"
```

| What comes back | What it means |
| --- | --- |
| `Not authorised.` (401) | **the accounts Worker is live** — the snapshot is members-only now |
| `No snapshot published yet.` (404) | the pre-accounts Worker, table present, nothing published |
| `Not found.` (404) | the Worker is running older code than either |
| a 500 | the `snapshots` table is missing |
| `Origin not allowed.` (403) | the `Origin` header was omitted or is not allowed |

That first row is the one to check after the accounts deploy: a 401 on
an unauthenticated `GET /snapshot` is the healthy answer, and a 404 with
`No snapshot published yet.` means the paste did not take.

And on `GET /export`, `Not authorised.` (401) means the request had no
usable credential — which after the accounts deploy is the healthy
answer whether or not `EXPORT_TOKEN` is set, since a session works too.
On the deployed Worker it still distinguishes: 401 means the secret is
set, a 500 means it is not.

A quick way to tell which Worker answers, needing no credential at all:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Origin: https://potaetoe.github.io" \
  -H "Content-Type: application/json" -d '{}' "$EP/auth/telegram"
```

`401` is the accounts Worker refusing an unsigned payload. `404` is the
deployed one, which has no such route.

**The snapshot feature needs both halves**, and the failure if only one
is done is quiet in the usual way:

- Worker updated, table missing → Publish returns a 500 and the public
  dashboard stays empty.
- Table created, Worker not updated → Publish gets a 404 from a route
  that does not exist yet, which reads as "Not found" rather than
  "you have not deployed this".

Neither breaks the form or the export, which keep working throughout.

## Changing it

Run the checks before pasting a new version into the dashboard:

```bash
node dev/worker.test.mjs
```

That exercises the real routing, validation and CORS logic against a
stub database — no account and no network needed. It now also covers
sign-in, sessions, the account id, group membership, and the full
route-by-caller gating matrix.

What it cannot check is the part only the dashboard knows: that `DB` is
bound, that the secrets are set, and that every table exists. A Worker
missing any of them will pass every test here and fail on the first real
request. After the accounts deploy that list grows — a wrong
`TELEGRAM_BOT_TOKEN` refuses every sign-in with the same 401 a tampered
payload gets, and an `ADMIN_TELEGRAM_IDS` holding the wrong number looks
exactly like a working deployment until somebody tries to export.
