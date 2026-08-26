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

The promise: **a leaked copy of the database shows numbers with no name
attached to them.**

That sentence was narrowed on 2026-08-24, after the security pass, and
the narrowing matters. It used to read "never who they belong to,"
which claimed more than the design delivers. The names really are
sealed — but the rows are still one profile per person, and in a group
this size a stable number like height, plus a country and a gender, is
close to a fingerprint. Someone who was _in_ the group can put names to
those profiles from memory. Nothing short of not keeping the history
would fix that, and the history is the point of the site. So the
promise is the one the design can actually keep: the binder itself
never hands over the mapping.

- Stat rows are plain data — no per-row encryption — keyed by one-way
  scrambled member IDs. You cannot reverse an ID into a person.
- The one table that maps IDs to identities (Telegram handle, username,
  display name) is sealed under a server secret. Database access alone
  cannot link a row to a person. Every sealed record is padded to a
  fixed size, so its length gives nothing away either.
- Username lookups for sign-in use one-way scrambles too, so even the
  login path stores no plain identity.
- Cloudflare's built-in encryption covers the disk. TLS covers transit.
- **Day-only timestamps, everywhere a member is involved** — entries,
  corrections, the change log, accounts, sign-in doors, and the sealed
  directory row itself. A clock reading beside a member ID would be an
  activity log, and an activity log can be lined up against the group's
  chat. Sessions keep a real expiry because they must enforce one, but
  it is rounded to a day and nothing records when a session began.
- The app writes no member data to logs — there is not one logging call
  in it. One caveat, stated plainly: Telegram's sign-in widget returns
  its answer as a redirect, so a member's Telegram name passes through
  a URL, and a hosting platform may record URLs. Nothing else about
  them travels that way, and the payload is now spent on first use, so
  a captured link is not a key.
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

5. **Calendar and events** (owner rulings, 2026-08-26) — the group's
   events live on the home page, not a separate page. An event is a
   title and a day (required), a place, notes, and a gallery of
   images (all optional). No time of day, no end date — the chat
   handles logistics. Images are stored in the database with a size
   cap per image, so a fork still needs nothing beyond D1 — the cap
   is the price of keeping the fork one database. Admins manage
   events in their own admin section: add, edit, delete, every action
   in the change log. The home page shows, in this order on every
   screen size: trends, the calendar card (a month grid with event
   days marked and that month's events listed under it, flipping
   months back and forward), the entry form, and the member's entries
   as a real table — one column per active field.

**Later** (named so they are not forgotten): a socials-links page,
admin-defined calculated fields (BMI is the only computed field in
1.0, wired in code; the door stays open).

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
