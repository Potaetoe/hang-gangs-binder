# The Hang Gang Binder

A private stats site for a Telegram group. Members sign in, record their
body stats, and see their own history plus the group's charts. Admins
shape what the form asks and decide who belongs.

This is the original — it runs the Hang Gang. Forking it for your own
group is a design goal, not an afterthought: one deployment serves one
group, every copy is its own island, and nothing phones home.

**What it costs to run:** nothing. It fits inside Cloudflare's free
tier.

## What you get

- **Two ways in.** Telegram (verified against your group's membership)
  or a username and password that an admin approves. One person can use
  both and land on the same account.
- **The entry form.** Height, weight and BMI to start, plus whatever
  else you decide to ask. Both metric and imperial are stored, so
  members read their numbers in whichever they think in.
- **Your page.** Your history, small trend lines, and the ability to
  correct or delete any entry you made.
- **Group charts.** A board of tiles, a focused page per field with a
  trend and a distribution, and filters built from your own choice
  fields — "average weight of male members in the US" is three clicks.
- **A form builder.** Admins add fields, reorder them, edit their
  options, and retire them. A field an admin adds reaches the member
  form and the chart filters immediately, with no code change. That is
  the app's central promise to its admins, and it has a test that
  proves it.
- **An admin surface.** Site settings, member approvals and roles,
  password resets, a change log, and a full erase for members who
  leave.
- **No page JavaScript.** Every page is drawn on the server. Charts are
  server-rendered SVG, menus are plain HTML. It works on a bad phone on
  bad signal, and there is no client bundle to leak anything.

## The privacy promise

**A leaked copy of the database shows numbers with no name attached to
them.**

Stat rows are keyed by opaque member ids that reverse to nobody.
Identities live in exactly one table, sealed under a server secret and
padded so even the length tells you nothing. Sign-in lookups are
one-way scrambles, so even the login table holds no plain name.
Timestamps are dates only, never clock times, so a leaked copy cannot
be lined up against chat activity.

Read that promise carefully, because it is deliberately narrow. The
binder will not hand anyone the mapping from a row to a person. It
cannot stop someone who was already in your group from recognising a
profile — one person's height and country and history, sitting
together, is close to a fingerprint in a group of twenty. That is the
cost of keeping history at all, and it is stated here rather than
hidden.

The full model, including what it deliberately does _not_ protect
against, is in [DESIGN.md](DESIGN.md). Read it before you trust it with
anyone's data.

## Run your own copy

You need a Cloudflare account (free), a Telegram group you administer,
and Node 22 or newer. Budget an hour if you have not used Cloudflare
before.

### 1. Get the code

```bash
git clone https://github.com/Potaetoe/hang-gangs-binder.git my-binder
```

```bash
cd my-binder && npm install
```

### 2. Make a Telegram bot

Message [@BotFather](https://t.me/BotFather) on Telegram:

- Send `/newbot`. Give it a display name, then a username ending in
  `bot`. BotFather replies with a **token** — keep it, it is a secret.
- The **username** is that `something_bot` name without the `@`.
- Add the bot to your group and make it a group admin. It needs to be
  there to answer "is this person in the group?".
- Send `/setdomain`, pick your bot, and send the address your site will
  live at. The Telegram login button will not work until you do this,
  and you will not know your address until step 4 — so come back and
  finish this after your first deploy.

Now find two numbers. Send any message in your group, then open this in
a browser, with your token pasted in:

```
https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
```

In the JSON you get back: `chat.id` is your **group's id** (a negative
number like `-1001234567890`), and `from.id` is **your own Telegram
id**. You need both.

### 3. Make the database

```bash
npx wrangler d1 create my-binder-db
```

That prints a `database_id`. Open `wrangler.jsonc` and set three
things: the worker `name`, the `database_name`, and that
`database_id`.

### 4. Set the secrets and deploy

First generate two random secrets and keep them somewhere safe:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Run that twice — once for `ID_SECRET`, once for `DIRECTORY_SECRET`.
**If you lose `DIRECTORY_SECRET`, every stored identity becomes
unreadable forever.** The stats survive; the names do not.

Then set all six values. Each command prompts you to paste the value:

```bash
npx wrangler secret put ID_SECRET
```

```bash
npx wrangler secret put DIRECTORY_SECRET
```

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

```bash
npx wrangler secret put TELEGRAM_BOT_USERNAME
```

```bash
npx wrangler secret put TELEGRAM_CHAT_ID
```

```bash
npx wrangler secret put TELEGRAM_ALLOW_IDS
```

`TELEGRAM_ALLOW_IDS` is how you become the first admin: put **your own
Telegram id** from step 2 in it. Anyone listed there is treated as an
admin the moment they sign in through Telegram. It takes a
comma-separated list, but one id is enough — after that you can promote
people through the admin pages.

Build the schema, then put the site up:

```bash
npx wrangler d1 migrations apply my-binder-db --remote
```

```bash
npm run build && npx wrangler deploy
```

Wrangler prints your address. Go back to BotFather and finish
`/setdomain` with it.

### 5. First sign-in

Open the site and sign in with Telegram. Because your id is in
`TELEGRAM_ALLOW_IDS`, you arrive approved and an admin. Go to
**Admin → Settings** and set the site name, the welcome text, your
timezone, and a default theme. Then **Admin → The form** to shape what
the form asks.

Your members can now sign in with Telegram on their own. Anyone who
registers with a username and password instead waits in
**Admin → Members** until you approve them.

## Adding a custom domain later

Not required — the `workers.dev` address works fine forever. If you
want a nicer one:

1. Buy the domain through **Cloudflare Registrar**, inside your
   Cloudflare account. They sell at cost with no markup, and renewals
   stay at cost too, which is not true of most cheap registrars. A
   domain already on Cloudflare needs no DNS setup.
2. In the Cloudflare dashboard: **Workers & Pages → your worker →
   Settings → Domains & Routes → Add → Custom Domain.**
3. Update BotFather's `/setdomain` to the new address, or Telegram
   sign-in breaks.

Everything else, including the free plan's SSL, is automatic.

## Working on the code

```bash
npm run dev
```

Local development needs a `.dev.vars` file. Copy the example — the
values in it are fake and safe, and the tests expect them exactly:

```bash
cp .dev.vars.example .dev.vars
```

Set up the local database once:

```bash
npx wrangler d1 migrations apply my-binder-db --local
```

Useful commands:

| Command                 | What it does                                       |
| ----------------------- | -------------------------------------------------- |
| `npm run dev`           | Development server                                 |
| `npm run check`         | TypeScript and Svelte checking (strict, must pass) |
| `npm run lint`          | Prettier and ESLint                                |
| `npm test`              | The Playwright suite, end to end                   |
| `npm run db:wipe:local` | Throw the local database away and start clean      |

The tests walk the app the way a person does — a stranger registers, an
admin approves them, they log stats, an admin adds a field and it
appears on their form. They run against a real local Worker with a real
database, not mocks.

### Changing the database

Schema changes go through migration files, never by hand:

```bash
npm run db:generate
```

That reads `src/lib/server/db/schema.ts` and writes a migration into
`drizzle/`. Apply it locally, then remotely, and only then deploy code
that needs it. The app is built to fail loudly, not quietly, when the
schema is behind.

### Where things live

| Path                       | What is in it                                      |
| -------------------------- | -------------------------------------------------- |
| `src/routes/`              | Pages, one folder per URL                          |
| `src/lib/server/`          | Everything that touches data or secrets            |
| `src/lib/server/auth.ts`   | Both sign-in doors, sessions, the sealed directory |
| `src/lib/server/stats.ts`  | Entries, unit conversion, history                  |
| `src/lib/server/charts.ts` | The board, filters, distributions                  |
| `src/lib/server/form.ts`   | The form builder's rules                           |
| `src/app.css`              | The whole look, including the four themes          |
| `drizzle/`                 | Migration files                                    |
| `e2e/`                     | Playwright tests                                   |
| `hooks/`                   | Repo rules, enforced automatically                 |

Nothing in `src/lib/server/` ever reaches the browser. That separation
is load-bearing for the privacy model, not a style preference.

## How this project is run

Two files govern everything. [DESIGN.md](DESIGN.md) says **what** is
being built and why. [WORKING.md](WORKING.md) says **how** — the
contract between the owner and the machine, what "done" means, the
security process, and the rules that ship as code in `hooks/`.

Those hooks are real. They block merging without a recorded sign-off,
block deploying when a migration has not been applied, block writing
secrets into files, and a few more. If you fork this and work
differently, they are yours to change or delete — but they encode
lessons that were expensive to learn.

## Credit

Built for the Hang Gang. If you fork it and make it better, that is the
point.
