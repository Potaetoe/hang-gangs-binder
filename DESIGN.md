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
   categorical fields, with unit choice. The Settings choice is the
   units DEFAULT and the rule of law: a page's units toggle changes
   the view for that one page look only - any reload or fresh visit
   renders the default again, and nothing a toggle does is ever
   stored (owner ruling 2026-08-26; a small script tidies the URL -
   the owner lifted the no-script rule for it). Trend LINES are
   admin-curated (owner ruling 2026-08-26): a checkbox list in the
   admin Settings picks which number fields carry them - the home
   trend cards, the board sparklines, and the focused trend charts
   alike; everything else about a field (tiles, headlines, stats,
   distributions) stays either way. The default is Weight and BMI -
   adult height does not move. The home page's trends sit last: the
   tri-fold's end on desktop, the bottom of the phone's scroll.
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
   title and a day (required), a start time, a place, notes, and a
   gallery of images (all optional). A time always brings its own
   timezone, picked by the admin — never assumed; the admin pages
   show the time in that zone, while members see it converted to
   their own clock (a page script converts; the no-script fallback
   names the zone). An event without a time is all-day — which is
   what every event from before times existed reads as. No end
   date — the chat handles logistics. Images are stored in the database with a size
   cap per image, so a fork still needs nothing beyond D1 — the cap
   is the price of keeping the fork one database. Admins manage
   events in their own admin section: add, edit, delete, every action
   in the change log. The home page is a tri-fold on the desktop
   (owner rulings 2026-08-26): three weighted columns filling the
   page — the calendar card on the left (a month grid with event days
   marked and that month's events under it, flipping months back and
   forward), the entry form in the middle, and trends above the
   member's entries on the right, the entries a real table with one
   column per active field and the widest share of the page. The
   phone stacks the same pieces in one column — events, form, trends,
   entries — every card full width. The month's events sit under the
   grid as wide stacked rows, three at a time with a pager — each row
   the words on the left, the gallery at its side; a day on the grid
   links to the page its event is on. A gallery shows three
   thumbnails, and the rest fold
   into a "+N more" tile. Tapping any of it opens the image in a
   preview overlay with previous/next arrows and a close — built from
   plain links, because member pages ship no JavaScript. The entries
   page by fifty, and the entries card caps its own height — a deep
   page scrolls inside it, headers pinned. The admin's date field is
   the browser's own date box: calendar flyout and typing both work.

6. **Socials** (owner rulings, 2026-08-26) — its own rail page. The
   group's official links sit up top (a short label+link list the
   admins keep in site Settings, logged like any setting); below, a
   roster of every approved member who has listed links — a name,
   then small letter badges for X, Tumblr, Feabie, FetLife, and one
   labelled Other. Links open in a new tab. Handles for X and Tumblr
   (the binder builds the URL); whole https links for the rest,
   domain-checked. **Links are sealed exactly like names** — a leaked
   database shows none of it, and every sealed payload is padded into
   one fixed bucket so even link counts leak nothing. Members edit in
   their Settings; the Socials page nudges the linkless toward it,
   and Home nudges too, waved away with an X (a device cookie).
   Members without links stay off the roster. Admins can clear a
   member's links from the admin member page, logged; the departed
   purge sweeps socials with everything else.

7. **Calculated fields** (owner rulings, 2026-08-26) — admins define
   computed numbers in the form builder, as a field kind beside the
   others. A guided builder, never a typed expression: a starting
   value, then a chain of steps worked left to right, each step an
   operation (add, subtract, multiply, divide, power, min, max)
   against a field, a typed constant, the member's FIRST entry's
   value of a field, or their PREVIOUS entry's value. Inputs are
   typed number fields only — a calculated field never feeds another.
   The admin picks the units mode per field: "follows the units
   toggle" (computed once per system — right for gains and
   differences) or "one number for everyone, from metric" (right for
   BMI-style ratios); and picks 0, 1, or 2 decimals (default 1). A
   live preview shows the recipe's answer before it goes on the form.
   Values compute at save, forward only — no backfill, and editing a
   formula leaves old values standing: history is what it said. An
   entry missing any input gets a blank, never a zero; so does
   division by zero or a result past the number ceiling. Members meet
   it everywhere a number lives — the quiet worked-out-from note on
   the form (inputs named, math private), the entries table, trends,
   and the full charts treatment. **BMI migrates into this system**
   as its first field: still essential, still un-retirable, and its
   formula is locked — renameable, never rewritable. Taking an input
   off the form warns the admin which recipes read it (owner ruling
   2026-08-26); while it is gone their new values are blank, and the
   moment it returns they compute again.

**Later**: (nothing — the 1.0 list is built).

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
desktop only (owner ruling 2026-08-24). A page never restates the
rail (owner ruling 2026-08-26): the highlighted rail item says where
you are, so titles like "Admin" are screen-reader-only — a visible
title must say something the rail does not, like "Hello, Marcus" or
a field's name. The phone rail runs four stops — Home, Group Stats,
Socials, Settings (owner ruling 2026-08-26, after an iPhone drive):
Sign out lives in Settings there, and the Admin door is desktop's
alone, matching the desktop-only admin ruling — though an admin can
call the door onto the phone rail for one sitting with the phone-only
Mobile Admin Mode switch in Settings (owner rulings 2026-08-26): a
session cookie, gone when the browser closes, and the admin pages
come as the squeeze they are. The page never
rubber-bands, and a scrolling card keeps its own momentum. Layout and detail are free to
improve as pages are rebuilt as components. The rebuild changes the
machinery, not the face.

## What a fork is

Clone the repo. Follow the README: create a Cloudflare account, a D1
database, a Telegram bot; set the secrets; deploy. A few hours for a
technical-ish admin is acceptable. Every fork is its own island — no
shared infrastructure, no phoning home.
