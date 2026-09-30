# The Binder — Design

This file says what we are building and why. WORKING.md says how.

## What this is

A private stats site for a Telegram group. Members sign in, record
their body stats, and see their own history and the group's charts.
Admins shape what the form asks and who belongs.

Forkability is a core goal: any technical-ish admin, someone
comfortable with a good README, a Cloudflare account and creating a
Telegram bot, can run a copy for their own group. One deployment
serves one group.

## Who it serves

- **Members** sign in, enter stats, and see their page and the group's
  charts.
- **Admins** configure the site, manage the form's fields, approve and
  manage members, and clean up after departures.
- **Operators** deploy a fork and hold the Cloudflare account and
  secrets. Often also an admin.

## Privacy model

The promise: **a leaked copy of the database shows numbers with no
name attached to them.**

The promise is narrow on purpose. The names really are sealed, but the
rows are still one profile per person, and in a group this size a
stable number like height, plus a country and a gender, is close to a
fingerprint. Someone who was in the group can put names to those
profiles from memory. Only throwing the history away would fix that,
and the history is the point of the site. So the promise is the one the
design can keep: the binder itself never hands over the mapping.

- Stat rows are plain data, keyed by one-way scrambled member IDs. An
  ID cannot be reversed into a person.
- The one table that maps IDs to identities (Telegram handle, username,
  display name) is sealed under a server secret, so database access
  alone cannot link a row to a person. Every sealed record is padded to
  a fixed size, so its length gives nothing away either.
- Username lookups for sign-in use one-way scrambles too, so even the
  login path stores no plain identity.
- Cloudflare's built-in encryption covers the disk. TLS covers transit.
- **Day-only timestamps wherever a member is involved**: entries,
  corrections, the change log, accounts, sign-in doors, and the sealed
  directory row itself. A clock reading beside a member ID is an
  activity log, and an activity log can be lined up against the
  group's chat.
- Sessions keep a real expiry because they must enforce one, but it is
  rounded to a day, and nothing records when a session began. A
  session dies after 7 unused days. Using it slides that idle expiry
  forward, recorded only as a day boundary: "alive as of day X" is the
  finest thing the sessions table may say about a member's visits. A
  member holds at most 3 live sessions.
- One deliberate exception to day-only: the sign-in backoff table.
  Repeated failures put an account on a slowing clock, and a
  minute-scale clock cannot be day-granular. The row is keyed by the
  account's opaque lookup hash, never a name. It records failed tries
  only, is deleted the moment the right password arrives, and decays
  after a quiet day. Nothing about a successful visit ever lands there.
- Registration says when a username is taken. That lets an outsider
  probe whether a name has an account, and it is accepted as inherent
  to having usernames: letting lookalike registrations pile up would
  hurt real people more. It is throttled, and the sign-in door stays
  silent either way.
- The app writes no member data to logs. It makes exactly one logging
  call: when the server hits an unexpected error, it records the
  route's shape and the error text, never a URL, a member ID or a
  name. Workers Logs stores those crash lines and nothing else; the
  platform's per-request logs, which would carry URLs, stay off. One
  caveat: Telegram's sign-in widget returns its answer as a redirect,
  so a member's Telegram name passes through a URL, and a hosting
  platform may record URLs. Nothing else about members travels that
  way, and the payload is spent on first use, so a captured link is
  not a key.
- No floor: charts show whatever matches the filters, however few
  members that is. In a small group a narrow filter can point at one
  person's numbers, never their name. The group accepts that openly
  rather than being promised a guard it does not want.

Accepted residual risk: someone with the operator's own Cloudflare
access sees what the server sees. The operator is trusted; that is
what being the operator means.

## Sign-in: two doors

1. **Telegram**: the login widget, verified server-side, with
   membership checked by asking the group's bot. Leave the group, lose
   access.
2. **Username and password**: open registration, but an account works
   only after an admin approves it. Admins reset passwords. No email
   anywhere.

One person can link both doors to a single member record: same
entries, same page, either door works. The password door also covers
people Telegram handles badly (no username, lost account).

## The features of 1.0

Behavior details for each feature are decided with the owner when the
feature is handed over.

1. **Core loop**: sign in, enter stats, your page (history,
   corrections), and group charts with trend and distribution views,
   filtered by the choice fields, with a choice of units.
   - The Settings choice is the units default and the rule. A page's
     units toggle changes that one page view only: any reload or fresh
     visit renders the default again, and nothing a toggle does is
     stored. A small page script tidies the URL afterwards.
   - Admins choose which number fields carry trend lines, with a
     checkbox list in the admin Settings. That covers the home trend
     cards, the board sparklines and the focused trend charts alike;
     everything else about a field (tiles, headlines, stats,
     distributions) stays either way. The default is Weight and BMI,
     because adult height does not move.
   - The home page's trends sit last: the end of the desktop's three
     columns, and the bottom of the phone's scroll.
2. **Admin surface**: site settings (name, welcome text, timezone,
   default theme), member management (approvals, roles, resets), a
   change log, and departed-member cleanup.
3. **Form builder**: admins add fields (choices, or numbers that are
   weights, lengths or plain), rename and reorder them, edit a choice
   field's options, and retire fields.
   - Height, weight and BMI are essential and cannot be retired.
   - A new choice field stays off the form until it has at least one
     option.
   - Renaming an option renames it in everyone's history.
   - Removing an option only stops new picks.
   - Deleting is only for a field that never collected a value.
   - The acceptance test: **a field an admin adds appears on the member
     form and in the chart filters without any code change.**

   A choice field can be **pick-several**. Members tick checkboxes
   instead of picking one, and the answer is the whole set of picks.
   The boxes arrive pre-checked with the member's current picks, which
   is how the answer carries forward, so unchecking every box on a new
   entry is deliberate: it records "none now" and drops the member from
   that field's counts. The charts count every pick (one member can sit
   in several bars) and filter with checkboxes too, showing people
   whose picks include all the ticked options. A single-pick field can
   be switched to pick-several once, one way only: old answers read as
   one-item picks, and there is no way back, because squeezing several
   picks into one would lose answers.

4. **Combined filters**: multi-filter charts, floorless by the rule
   above.

5. **Calendar and events**: the group's events live on the home page,
   not a separate page.
   - An event is a title and a day (required), plus an optional start
     time, place, notes, and a gallery of images. No end date; the chat
     handles logistics.
   - A time always brings its own timezone, picked by the admin and
     never assumed. Admin pages show the time in that zone; members see
     it converted to their own clock (a page script converts, and
     without it the page names the zone). An event without a time is
     all-day.
   - Images are stored in the database with a size cap per image, so a
     fork still needs nothing beyond D1. The cap is the price of
     keeping a fork to one database.
   - Admins manage events in their own admin section: add, edit,
     delete, with every action in the change log. The admin's date
     field is the browser's own date box, so the calendar flyout and
     typing both work.
   - The desktop home page is three weighted columns filling the page:
     the calendar card on the left (a month grid with event days marked
     and that month's events under it, flipping months back and
     forward), the entry form in the middle, and trends above the
     member's entries on the right. The entries are a real table with
     one column per active field, and take the widest share. The phone
     stacks the same pieces in one column (events, form, entries,
     trends), every card full width.
   - The month's events sit under the grid as wide rows, three at a
     time with a pager: the words on the left, the gallery at the side.
     A day on the grid links to the page its event is on.
   - A gallery shows three thumbnails, and the rest fold into a "+N
     more" tile. Tapping any of it opens the image in an overlay with
     previous and next arrows and a close, built from plain links
     because member pages ship no JavaScript.
   - Entries page by fifty, and the entries card caps its own height:
     a deep page scrolls inside it, headers pinned.

   **RSVPs**: each event card carries one "I'm interested" toggle, a
   plain form you tap in and out of. Members see the count and whether
   they are in it, never who else. The admin event page lists the
   names, and the admin events table carries the count. The admin who
   makes the event picks the last day it takes RSVPs ("RSVP open
   through", optional). Blank means the event's own day, and a past day
   closes it at once. Days are read on the site's calendar, like
   everything else. After it closes, the button goes and the count
   stays. An RSVP row is an opaque member ID beside an event ID with no
   timestamp, because when someone tapped is an activity clock the
   binder does not keep. Deleting an event takes its RSVPs, and the
   departed purge sweeps a member's.

6. **Socials**: its own rail page.
   - The group's panel sits at the top: a message the admins write in
     HTML in site Settings, logged like any setting. It is cut to a
     safe allowlist (headings, paragraphs, emphasis, lists, quotes,
     code, rules, and whole-https links that open in a new tab),
     cleaned on save and again on render. Scripts, styles, images and
     anything else are removed, and the CSP stays strict. An empty
     message hides the panel.
   - Below it, a roster of every approved member who has listed links:
     a name, then small letter badges for X, Tumblr, Feabie, FetLife,
     and one labelled Other. Links open in a new tab. X and Tumblr take
     handles (the binder builds the URL); the rest take whole https
     links, domain-checked. Members without links stay off the roster.
   - **Links are sealed exactly like names.** A leaked database shows
     none of them, and every sealed payload is padded into one fixed
     size, so even the number of links leaks nothing.
   - Members edit their links in Settings. The Socials page nudges the
     linkless toward it, and Home nudges too, dismissed with an X
     (remembered in a device cookie).
   - Admins can clear a member's links from the admin member page,
     logged. The departed purge sweeps socials with everything else.

7. **Calculated fields**: admins define computed numbers in the form
   builder, as a field kind beside the others.
   - A guided builder, never a typed expression: a starting value, then
     a chain of steps worked left to right. Each step is an operation
     (add, subtract, multiply, divide, power, min, max) against a
     field, a typed constant, the member's first entry's value of a
     field, or their previous entry's value. Inputs are typed number
     fields only; a calculated field never feeds another.
   - The admin picks the units mode per field: "follows the units
     toggle" (worked once per system, right for gains and differences)
     or "one number for everyone, from metric" (right for ratios like
     BMI). They also pick 0, 1 or 2 decimals (default 1).
   - A live preview shows the recipe's answer before it goes on the
     form.
   - Values compute at save, forward only, with no backfill. A recipe
     locks the moment its field holds a stored value, so one field's
     history keeps to one formula; changing the math means retiring the
     field and building a new one. While a recipe is still unlocked,
     every change writes old recipe → new to the change log.
   - An entry missing any input gets a blank, never a zero, and so
     does a division by zero or a result past the number ceiling.
   - Members meet a calculated field everywhere a number lives: a quiet
     "worked out from" note on the form (inputs named, math private),
     the entries table, trends, and the full charts treatment.
   - **BMI is a calculated field**: still essential, still
     un-retirable, and its formula is locked. It can be renamed, never
     rewritten.
   - Taking an input off the form warns the admin which recipes read
     it. While it is gone their new values are blank; the moment it
     returns, they compute again.

The 1.0 list is built.

## Stack

- **SvelteKit** with **TypeScript (strict)** on **Cloudflare
  Workers**, as one Worker.
- **D1** (SQLite) through **Drizzle**, with real migration files, so
  the schema and the code cannot silently drift. Drizzle also keeps a
  door open to non-Cloudflare hosting for forks.
- **Playwright** for feature-loop tests. **GitHub Actions** for CI.
- Free and open-source throughout. Runs on Cloudflare's free tier.

## The look

The identity carries over: the wordmark, the four palettes, the fonts,
and a phone-first layout with a bottom rail.

- Member-facing pages serve the phone and the desktop equally.
  Admin-facing pages are designed for the desktop only.
- A page never restates the rail. The highlighted rail item says where
  you are, so titles like "Admin" are for screen readers only. A
  visible title must say something the rail does not, like "Hello,
  Marcus" or a field's name.
- The phone rail runs four stops: Home, Group Stats, Socials,
  Settings. Sign out lives in Settings there, and the Admin door is
  desktop only. An admin can put the door on the phone rail for one
  sitting with the phone-only Mobile Admin Mode switch in Settings: a
  session cookie, gone when the browser closes, and the admin pages
  come as the squeeze they are.
- On the phone the page never rubber-bands and the rail never floats,
  because iOS ignores gentler hints, bounces the document, and floats
  fixed bars in the installed app. So the page is a one-screen app
  shell: nothing is position-fixed, the main column is the one
  scroller, and the rail rests in flow on the bottom edge. A scrolling
  card keeps its own momentum.
- The binder installs as a home-screen app: a manifest carrying the
  fork's own name and default palette, real icons, and no service
  worker, since the pages stay free of JavaScript.
- Layout and detail are free to improve as pages are rebuilt. A
  rebuild changes the machinery, not the face.

## What a fork is

Clone the repo. Follow the README: create a Cloudflare account, a D1
database and a Telegram bot, set the secrets, deploy. A few hours for
a technical-ish admin is acceptable. Every fork is its own island: no
shared infrastructure, no phoning home.

Until launch this is the Hang Gang's site, which others may copy, and
the fork story above is all it promises. A generalized community kit
(a non-Telegram bootstrap, configurable starting fields and branding,
tagged releases) is a separate branch that starts after launch, not
before.
