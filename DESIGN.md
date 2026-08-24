# The Binder — Design

Written 2026-08-24 by the owner and Claude, replacing everything before it.
This file says WHAT we are building. WORKING.md says how.

## What this is

A private stats site for a Telegram group. Members sign in, record their
body stats, and see their own history and the group's charts. Admins shape
what the form asks and who belongs.

Forkability is a core goal: any technical-ish admin — someone comfortable
with a good README, a Cloudflare account, and creating a Telegram bot —
can run a copy for their own group. One deployment serves one group.

## Who it serves

- **Members** — sign in, enter stats, see their page and the group's charts.
- **Admins** — configure the site, manage the form's fields, approve and
  manage members, clean up after departures.
- **Operators** — the technical person who deploys a fork and holds the
  Cloudflare account and secrets. Often also an admin.

## Privacy model

The promise: **a leaked copy of the database shows numbers, never who
they belong to.**

- Stat rows are plain data — no per-row encryption — keyed by one-way
  scrambled member IDs. You cannot reverse an ID into a person.
- The one table that maps IDs to identities (Telegram handle, username,
  display name) is sealed under a server secret. Database access alone
  cannot link a row to a person.
- Username lookups for sign-in use one-way scrambles too, so even the
  login path stores no plain identity.
- Cloudflare's built-in encryption covers the disk. TLS covers transit.
- No member data ever goes to logs.
- No floor (owner ruling 2026-08-24, replacing the old N-member floor):
  charts show whatever matches the filters, however few members that
  is. In a small group a narrow filter can point at one person's
  numbers — never their name. The owner accepts that openly rather
  than promising a guard the group does not want.

Accepted residual risk, stated plainly: someone with the operator's own
Cloudflare access sees what the server sees. The operator is trusted —
that is what being the operator means.

## Sign-in: two doors

1. **Telegram** — the login widget, verified server-side; membership
   checked by asking the group's bot. Leaves the group, loses access.
2. **Username and password** — open registration; an account works only
   after an admin approves it. Admins reset passwords. No email anywhere.

One person can link both doors to a single member record: same entries,
same page, either door works. The password door also covers people
Telegram handles badly (no username, lost account).

## The features of 1.0

Behavior details for every feature are decided fresh with the owner when
that feature is handed over to be built. Nothing below inherits old UX
decisions.

1. **Core loop** — sign in, enter stats, your page (history, corrections),
   group charts with trend and distribution views, filtered by the
   categorical fields, with unit choice.
2. **Admin surface** — site settings (name, welcome text, timezone,
   default theme), member management (approvals, roles, resets), a
   change log, departed-member cleanup.
3. **Form builder** — admins shape the form: add fields (choices, or
   numbers that are weights, lengths, or plain), rename and reorder
   them, edit a choice field's options, and retire fields. The rulings
   (owner, 2026-08-24): height, weight and BMI are essential and cannot
   be retired; a new choice field stays off the form until it has at
   least one option; renaming an option renames it in everyone's
   history; removing an option only stops new picks; deleting is only
   for a field that never collected a value. The contract that failed
   last time, now the acceptance test: **a field an admin adds appears
   on the member form and in the chart filters without any code
   change.**

   A choice field can be **pick-several** (owner rulings, 2026-08-24;
   the first planned field is kinks): members tick checkboxes instead
   of picking one, and the answer is the whole set of picks. The boxes
   arrive pre-checked with the member's current picks — that IS the
   carry-forward — so unchecking every box on a new entry is
   deliberate and records "none now", which drops the member from
   that field's counts. In the charts it counts every pick (one member
   can sit in several bars) and filters as checkboxes too: show people
   whose picks include ALL the ticked options. A single-pick choice
   field can be switched to pick-several once, one-way — old answers
   read as one-item picks, and there is no way back down because
   squeezing several picks into one would lose answers.

4. **Combined filters** — multi-filter charts (landed with the core
   loop's charts; floorless by the ruling above).

**Later** (named so they are not forgotten): a calendar/events page, a
socials-links page, admin-defined calculated fields (BMI is the only
computed field in 1.0, wired in code; the door stays open).

## Stack

- **SvelteKit** with **TypeScript (strict)** on **Cloudflare Workers**.
- **D1** (SQLite) through **Drizzle**, with real migration files — the
  schema and the code can never silently drift again. Drizzle also keeps
  a door open to non-Cloudflare hosting for forks, at no extra cost.
- **Playwright** for feature-loop tests. **GitHub Actions** for CI.
- Free and open-source throughout. Runs on Cloudflare's free tier.

## The look

The identity carries over: the wordmark, the four palettes, the fonts,
phone-first layout with the bottom bar. Member-facing pages serve the
phone and the desktop equally; admin-facing pages are designed for
desktop only (owner ruling 2026-08-24). Layout and detail are free to
improve as pages are rebuilt as components. The rebuild changes the
machinery, not the face.

## What a fork is

Clone the repo. Follow the README: create a Cloudflare account, a D1
database, a Telegram bot; set the secrets; deploy. A few hours for a
technical-ish admin is acceptable. Every fork is its own island — no
shared infrastructure, no phoning home.
