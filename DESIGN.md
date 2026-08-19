# Hang Gang's Binder — design

**Read this before changing the architecture.** It says why the system
is the shape it is; `README.md` says what it is, `OPERATIONS.md` says
how to run it. Decisions here are settled — do not re-derive them and
do not re-litigate them without a new reason.

The 0.9 design was ruled by the owner on 2026-08-13 in five elicitation
sittings, and the record of that ruling is issue #228, comment
5287071398. This file is that record turned into the shape a builder
reads. Where the shipped code still implements the pre-0.9 key world, a
line says so and names the milestone that ends it; the full history of
every decision is `git log` and `archive/`.

## The core ideology

> "we want our product to be easily forkable, user modifiable, and user
> friendly" — the owner, 2026-08-13.

Every ruling below was made under that lens, and every build decision
this file does not cover is judged by it.

## The constraint that shapes everything

The site is still just static files: whatever a page holds is in View
Source, and a static page cannot gate itself or keep a secret.
Everything that needs either is the Worker.

What the 0.9 hosting ruling (#228, 2026-08-13) changed is who serves
those files and from where. **One Cloudflare Worker serves the static
site and the API from the same origin** — Workers static assets for the
pages, the Worker's own routes for everything that reads or writes —
replacing the GitHub Pages-plus-separate-Worker split. One deployable,
one `wrangler deploy`, no CORS, and the `ALLOWED_ORIGINS` github.io pin
dies with it. **GitHub Pages retired outright, ahead of 1.0**: the
owner moved the retirement up the day it was ruled and took the live
deployment down, because nobody had used the site and there was nothing
to lose by waiting for the cutover. `README.md`'s Status box carries the
live fact; this section is the shape, not the schedule.

**One Worker codebase, two environments: `sit` and production.** Same
bytes, different bindings — each environment gets its own D1 database
and its own bot secrets. `sit` is where every non-production act
happens against a real bot and real persistence with zero risk to
production data. `server/wrangler.toml` carries `[env.sit]` where the
pre-0.9 `dev` environment stood (0.9-M1-S1, #325) — a ruled shape, and
still not a deployed one: OPERATIONS.md, "Building the sit
environment", is the operator act that makes it one, and it waits on
#282's two secrets.

Subdomains (`workers.dev`, `pages.dev`) carry the whole wave; the custom
domain is a cutover act. The production origin is noindexed and sends
no-referrer, the same posture the demo and mockup previews already
carry — a private-group site is not meant to be crawled or linked from.

```
  member's browser            Cloudflare Worker + D1        admin's browser
  ────────────────            ──────────────────────        ───────────────
  signs in with    ── HTTPS ─> asks the bot whether this
  Telegram                     account is in the group,
                               issues a session

  fills the form   ── HTTPS ─> one row per entry, stored
                               encrypted at rest under a
  reads their own  <─────────  secret only the Worker      <─  reads the
  history                      holds                           directory and
                                                               any member's
  reads the group  <─────────  aggregates on request           entries
  charts
```

## Trust model: the Worker reads

- **The Worker enforces roles and serves plaintext to signed-in
  users.** It is the only place enforcement is possible, so it is the
  only place enforcement lives.
- **Rows are encrypted at rest under a secret only the Worker holds**,
  so a raw database dump alone reveals nothing.
- **The host can technically read entries, and the site says so rather
  than implying otherwise.** The "we cannot read it" pitch is retired.
  Whoever runs the Worker is trusted; that is the trade, ruled
  knowingly.
- **All client-side crypto is gone**: sealing before send, member
  device keys, the admin key box, the key fingerprint, the key files
  and their sign-out destruction. There is no key for an end user to
  think about, which was the owner's opening requirement.

What the trade buys is the product: a member reads their own history
back, corrects it and deletes it; an admin can backfill honestly and
answer a takedown; charts are live rather than a ceremony. Every one of
those was impossible while only a key file could read a row.

**0.9 starts empty.** No migration and no final ceremony — the old
sealed rows are discarded, because nobody has used the site yet. The
new privacy copy ships with no announcement.

## Encryption

At rest, and only at rest. The rows and the directory are stored
encrypted under a Worker-held secret; the algorithm and the wire layout
are the Worker's and are settled in 0.9-M1. Two properties are ruled
now and constrain whatever M1 picks:

- the secret never leaves the Worker, and no page, fork or backup
  carries it;
- a raw database dump alone reveals nothing — which is a property of
  the **whole** store and not of the entry rows alone, for the reason
  under "The identifier is the whole problem" below.

One rule survives from the key world unchanged, because it is about
storage rather than about keys: **the format is part of the stored
data.** Change the layout and every stored row goes silently
unreadable, so a stored format carries a version byte and a committed
fixture that must always decode. **If the fixture fails, never
regenerate it**; add a version byte and a decoder for both.

*Until 0.9-M1 lands the shipped code still seals in the browser to a
public key.* That code and its fixtures are the pre-0.9 world and die
with M1.

## Accounts

**Membership truth is the Telegram group, whole.** Signing in requires
current membership in the gang's group, checked with the bot; the
roster syncs from it; leaving the group removes site access. There is
no site-side ban machinery and there will not be one — removing
somebody means removing them in Telegram, which is where the group
already does it. **Removal-to-lockout is a Constant tied to sweep
cadence, not instant** (#294 F6, ruled 2026-08-14): a departed member's
sessions end at the Worker's next verification sweep, and an admin
surface additionally re-checks per request rather than waiting on the
sweep alone.

**Group composition, in the owner's own words (#294, 2026-08-14): "All
members of the group are 18+ and it's verified before given
entrance."** Group-side verification is the age gate; membership
implies verified adulthood, so nothing on this site re-derives it. The
form's own over-18 attestation remains as the door's assertion in
addition, not instead — exact register wording lands at the M4 sitting.

**Admins mirror Telegram admins.** Whoever administers the Telegram
group is a site Admin, automatically. All admins are equal and hold
full powers including deletion. There are no tiers: Telegram's own
owner-and-admin distinction is Telegram's, and the site neither models
it nor mentions it. The casual-promotion risk — a group that hands out
admin lightly hands out the directory with it — was put to the owner
adversarially, and the mirror stands.

**The directory** holds one row per user: handle, display name, role,
joined date, last-active date. It is visible to admins only; members
never see a roster.

**Bot failure stance: last-known-good cache.** When Telegram will not
answer, the Worker trusts the last verified roster for a bounded
window. Members never bounce off an API hiccup, and **"cannot check" is
never treated as "not a member"** — that sentence governs every place
the roster is consulted, including the leaver countdown under "Admin
accounts and deletion". **The window is 24 hours by default, then the
cache fails closed** (#294 F6, ruled 2026-08-14): a new sign-in past the
window is refused honestly rather than trusted on stale data, while a
session already open lives on to its own idle expiry. A Setting, not a
constant — an admin may shorten or lengthen it.

### The identifier is the whole problem

A row is keyed to the Telegram **numeric id**, not the handle. The
numeric id is what makes an account survive a rename; the handle is a
label the person can change and is display only. What the Worker stores
is that id under an HMAC, **and the key of that HMAC is a secret of its
own** — see "The bot is temporary" below for the trap that rule exists
to kill.

The reason this is the dangerous part of the design has not changed
with the keys. The relevant handles are the few dozen in one group's
member list, so anything that names them in the clear beside the data
is a **membership oracle**: it answers "did @foo submit?" without
reading an entry. That is most of the harm the storage encryption
exists to prevent, for a binder about feedism sitting next to real
handles.

0.9's answer is the store rather than a hash. **The directory is inside
what is encrypted at rest, not beside it** — derived directly from the
record's ruled property that a raw dump reveals nothing, because a
clear-text roster is the oracle by a shorter route than any hash of a
handle would be.

A row has two identities and they are not equally good: the id is set
server-side from a verified sign-in and cannot be forged by the page;
anything the client typed is a claim. Treat the id as identity.

### The bot is temporary

The bot that checks membership is provided for 0.9-M1 and is expected
to be replaced. Moving to another one must stay a cheap, documented
act, which puts four requirements on every slice that touches
authentication:

1. **Member identity is never keyed to the bot token.** The account id
   HMACs the numeric id under its **own** Worker secret. HMACing under
   the bot token — the convenient secret already in hand — orphans
   every row the moment the bot rotates, silently and with no way back.
   This is the trap the rule exists to kill.
2. **The bot's username lives in the one config place**, beside the
   group's name, and the Telegram login widget names its bot from
   there. A hard-typed username is a second place to change.
3. **Sessions and the roster cache are the Worker's, not the bot's.**
   A rotation gap signs nobody out, and the last-known-good cache
   covers sign-ins while a new bot settles.
4. **The rotation procedure ships with 0.9-M1**, in `OPERATIONS.md`,
   written against the Worker that exists then.

**Two bots exist by design, split by world (#228 Worker-topology
addendum, 2026-08-13).** One bot plus a small test Telegram group is
the membership truth for `sit`, permanently — not a stand-in but the
environment's own bot. A second bot plus the real group serves
production, arriving at 1.0; standing it up and cutting over to it is
what exercises the rotation procedure above for the first time, on
purpose, as a cutover step rather than an emergency.

**The production bot is granted group-admin (#294 F5, ruled
2026-08-14).** `chat_member` leave events are the primary membership
signal; a per-id verification sweep is the fallback for whatever the
event stream misses. Purge clocks arm only off a **verified** signal —
an event or a sweep result — never off silence; "Bot failure stance"
below is what that protects. M1's first slice verifies these platform
claims against a live bot before anything is built on them.

### Sessions

A session is a random token issued when a Telegram payload verifies,
held for the life of the tab; the Worker stores only its hash. Payload
verification is Telegram's HMAC scheme plus a freshness window —
without one, a captured payload is a permanent credential. Every
lifetime and window is a constant in `server/worker.js`; this document
does not repeat numbers the code already carries.

**Idle expiry is one rule everywhere.** Member pages carry the same
warn-then-expire timer the admin pages do. The pre-0.9 exemption for
member sessions was argued from a member page that held no history and
no plaintext worth leaving on a screen — 0.9's your-page shows the
member their whole history, so the argument is gone and the exemption
with it. The page warns before it acts, visibly and counting down,
because a page that simply stopped working mid-read sends the reader
back to sign in and re-open everything, which discloses more than the
timer saves.

The page's window is deliberately shorter than the Worker's, and the
ordering carries the design rather than either value: at the shorter
one the page always acts first, on its own initiative; reversed, the
page timer is unreachable and plaintext sits on screen until some
request happens to be refused. What counts as interaction is device
events — pointer, key, wheel, touch — and never `scroll`, which the
page produces itself when it moves focus to its own warning.

**The page is not the gate.** A form page bouncing signed-out visitors
is a courtesy; the gate is the Worker refusing the write.

### Admin accounts and deletion

There is no admin list to maintain, no founding-admin secret and no
last-admin guard: the root of trust is the Telegram group, and every
one of those mechanisms existed to hold a list the site no longer
keeps.

**Deletion is deletion.** A member corrects and deletes their own rows,
in full self-service — no trace, no admin notice, and the charts move
with it. Their data, their delete. A member owns **every** row about
them, including one an admin backfilled (derived by Prime, reversible:
the record rules self-service without carving out backfilled rows, and
the ideology reads a row about a person as theirs).

A correction is a new row naming the row it supersedes rather than an
edit in place, so the repeats are the history the binder exists to
accumulate. The list shows current values only, with a reveal for the
replaced ones. The pointer is a column the Worker can read, because a
pointer it cannot read is one it can neither check against the caller
nor subtract from what a member is told they have.

Admins can open any member's entries. That is not a convenience: an
admin who cannot see the rows cannot backfill honestly, cannot fix a
mistyped entry and cannot answer a takedown. **It is deliberately not
stated to members** — an explicit owner ruling, taken over the
recommendation to state it at the form, and a security review should
read it as ruled rather than overlooked.

**Leaver data purges after a window, guarded.** A confirmed departure
starts a visible countdown on the member's row; an admin may delete
sooner; re-adding the person in Telegram inside the window restores
them and their data reattaches. Two guards, both of them about the
failure modes rather than the happy path: **"cannot check" never starts
a clock**, and a mass-departure anomaly freezes the countdowns rather
than arming them all at once — **ruled 2026-08-14 (#294 F6) at 3 or
more departures in one sweep, or more than 25% of the roster, whichever
fires first, and raises `needs-owner` when it does.** Both the window
and the mass-departure threshold are Settings, editable by an admin. The
window's ruled default is 30 days, stated with the other Settings
defaults under **Admin surfaces** below.

**A member sees a pre-leave notice before they act (#294 F3, ruled
2026-08-14): delete your own rows before you leave, or ask an admin
after.** This is a mechanism note, not the shipped copy — the exact
wording is authored at the M4 register sitting, and this line only
fixes that member surfaces carry the reminder and that the guarded
window and restore-on-rejoin above are unchanged by it.

**Every admin deletion writes an append-only, admin-visible action
line: who deleted what, when (#294 F4, ruled 2026-08-14).** M1 carries
the line's schema; M3 carries its display. **Backups are a ruled
obligation, not a suggestion**, on the same ruling: the first rehearsal
happens before the first real entry is ever stored, and the cadence is
displayed beside bot health on the Settings page rather than living
only in `OPERATIONS.md`. No specific cadence number was ruled — the
obligation and its visibility were.

## Your page

**One page, stacked: form → personal trend → entries list.** The tabs
die, and so does the pane they held — the counts card, the corrections
count, the Telegram-id line, the custody cards, the sealed-rows line.

- **Rows are date, weight, height, BMI, newest first.** Corrections
  show current-only with a reveal, the replaced ones muted in place.
- **A personal trend line sits above the list.** A history in mixed
  units converts to the member's current units choice and says so. The
  old pick-a-system-and-never-convert rule yields to the one-line
  picture: a chart that refuses to draw is worth less than a labeled
  conversion.
- **No member backdating.** The form has no date field. Admins add
  dated entries per member, and a bulk import follows as its own slice.
- **A download button exports the member's own rows** in the existing
  spreadsheet format.

The device-memory prefill dies with the reason it existed (**derived,
not ruled** — the record's list of what this pane loses does not name
it; this follows from the ruled design rather than from a sentence in
it, and is reversible on an argument). It was the only memory a member
had while no route could answer "what did I say last time"; the server
answers that now, so a store of one member's last entry sitting in a
shared browser's `localStorage` is a privacy cost buying nothing.

## Charts

**One filter and one measure.** The filter is one of: everyone, a
gender, an affiliation, a country. **The measures derive from the
form's field spec** — every numeric field charts, weight and height and
computed BMI today — so a fork that edits its fields gets matching
charts with no chart code to write. The spec carries kind and unit
metadata, which is what lets conversion and computed fields derive too;
it is `apps/web/site.config.js` and this page is one of the two things
it exists for.

- **Both pictures behind one toggle**: the trend over time, and the
  distribution now.
- **The line is the mean and it is called "average".** No statistics
  vocabulary anywhere on the page.
- **Members only.** Charts require a session; the public URL shows the
  door and nothing else.
- **A member may draw their own line over the group trend.**
- Of the pre-0.9 controls, **units survive and nothing else does**:
  basis, widen and combine die. The page is exactly filter, measure,
  picture toggle, units, show-me, download, and honest empty states.

**The Worker aggregates on request.** Publish, unpublish, the published
snapshot document and its freshness line are all gone, along with the
class of failure where the figures on screen were as old as the last
time somebody remembered to press a button.

The disclosure rules that governed the published document govern the
live one, because they were always about what a **reader** can
reconstruct rather than about publishing:

- **A drawn cell describes at least the floor's number of people**, and
  the floor is a group setting rather than a constant — on by default
  and starting at 5, stated with the other Settings defaults under
  **Admin surfaces** below. Suppression is by subtraction, not
  redaction — removed cells fold into an `Other` bucket that itself
  clears the floor, so within a single view the remainder cannot be
  differenced back. **The floor counts people, never value-holdings**,
  for every fold including that bucket: a field a member may answer more
  than once lets one person feed a count into every value they hold, so
  a bucket that added those counts up could clear the floor with two
  people behind it (#351). Histograms merge adjacent bins.
  A cut below the floor says "not enough people for this view", which
  is the honest sentence and not an error.
- **One partition, not two.** Both unit systems report the same groups
  under converted edges. Two independently-binned partitions can be
  differenced back into sub-floor cells — demonstrated in 2899 of 3000
  random groups, which is why this is a rule rather than a caution.
- **A trend of one line is a chart of one person**, so the floor
  applies to lines as it does to cells.
- **A weight and a height and a country is a person to anyone who knows
  her**, with or without a name column. That sentence is the reason for
  every rule above and is the test to apply to a new view.

**Live aggregation changes when the old cumulative-disclosure channel
is open, not whether.** A count and a mean multiply back to a total,
so a reader who keeps two views taken at different times can compute
the movement between them whatever the floor declined to print; the
owner ruled on #153 to accept that channel rather than charge every
member the mean's real value to close it. What live charts change is
that the reader no longer waits for a publish. The ruling's premise is
untouched — it is argued from a members-only readership, which the
members-only rule above preserves — and it is the premise to re-take
if that readership ever widens.

## Roles and vocabulary

- **Exactly two user-facing types: Member and Admin.** The collective
  noun is **the group**. Keyholder, always-allow, second admin and
  owner are gone as user-facing words.
- **The charts page is named Charts.** Muse dies everywhere: no voice,
  no characters, two roles.
- **The wordmark stays** — "Hang Gang" over "Binder", the ruled static
  form. A gang's name on its own door outs no individual.
- **The outsider door is a plain refusal.** A real Telegram account
  outside the group sees one sentence saying this binder belongs to a
  private group. No join hint, no application, no next step.
- **Telegram mechanics appear on admin surfaces only** — "membership
  and admin status follow the Telegram group" is an admin's sentence.
  Member surfaces never mention the machinery.
- **The privacy line is one sentence on the door**, with More cards
  carrying the rest on member pages. The owner authors the exact
  sentences at the 0.9 register sitting, scheduled for 0.9-M4; until
  then the surviving pre-0.9 sentences are "Signed out." and the
  download acknowledgment, and every sentence about key checks and
  sealed rows is dead with the keys.

## Admin surfaces

Two pages. The pre-0.9 `admin.html` dies with the keys and with
Publish, and nothing inherits its shape.

**Members** is the directory as a table — handle, display name, role,
joined, last-active, leaver countdown — with per-row actions: add an
entry as a backfill, delete their data, edit their display name, open
their entries. One line explains that membership and admin status
follow the Telegram group. Bulk import arrives as its own slice.

**Settings** is its own page with room to grow, and it carries exactly
the three facts this design makes an admin responsible for: the
suppression floor, the purge window's length, and bot health —
"membership last verified N minutes ago".

Its two editable controls ship with **ruled defaults**, and they are
written here because a builder implements this page from this document.
Both come from the design record (#228 comment 5287071398): the floor
from Part 3 and its open-items list, the window from Part 4.

- **The suppression floor is on by default, and it starts at 5.** The
  5 is not invented here: it is what `MIN_CELL` holds in
  `apps/web/dashboard.js`, and the setting inherits that rather than
  picking a new one — the record schedules the value itself as an open
  item, to be re-taken when this page ships it as editable and not
  before. The number is written out rather than only pointed at
  because the file holding it today is one the 0.9 rebuild deletes:
  whoever writes the Worker's copy carries the 5 across, and this line
  is what they carry it from. A group never starts with the floor off —
  turning it off is an admin's deliberate act.
- **The purge window is 30 days by default.** It is the length of the
  countdown a confirmed departure starts, and the two guards stated
  with it above — a "cannot check" never starts a clock, a
  mass-departure anomaly freezes rather than arms — hold whatever an
  admin sets it to.

## Where configuration lives

The line is not static against dynamic. It is **whether a wrong value
gets written into a row.**

**The form's field spec is a repository data file, and it exists:**
`apps/web/site.config.js`, read by `apps/web/fields.js` and by nothing
else. It carries which fields there are, of what kind, in what units
and within what bounds — a repository file rather than a runtime one
because a bad bound produces a plausible record, stores it, and is
discovered much later. No Worker check could catch that: the Worker
has no opinion about meaning, deliberately. So the spec ships in a
release that somebody read, and an admin-editable form means a surface
that *composes* a spec rather than one that bypasses this.

*Your page renders its fields from the spec (0.9-M2-S2); Charts and the
admin surfaces do not yet.* Deriving each page's own fields from the
spec is a 0.9-M2 requirement each slice closes at its own page; the
spec, its reader, and the chartable-measure list Charts is built on
have existed since 0.9-M0.

**The group's name lives in exactly one place** — the same file — and
every wordmark, title and sentence derives from it. That is the
forkability rule with teeth: the class of trap where four wordmarks are
kept by hand and one of them is wrong dies structurally rather than by
vigilance. **The bot's username lives in that same place**, for the
reason under "The bot is temporary" — a fork points at its own bot by
editing one line.

**Site copy and the group settings are runtime state** the Worker
serves, with each page's shipped HTML as the fallback. A site that
looks like last week is a failure somebody notices and nobody is harmed
by; the alternative hands an admin repository write to change a label,
which is the first thing the threat model below says this design does
not protect against.

**Membership is not configuration at all.** It is the Telegram group.

## The sign-in page and the CSP

Every page carries `default-src 'none'` with `script-src 'self'` in a
`<meta>` policy — nothing loads on a page its own policy does not name,
enforced by the browser in the window that matters. That is a per-page
boundary and not a project-wide ban on third-party code; #75 records
the correction after it was over-read as one. The positional rule is
what holds: **nothing third-party runs where plaintext is in reach.**

The Telegram widget is third-party script, so sign-in is a page of its
own and the exception is confined there. `'unsafe-eval'` on that page
is not negotiable and not laziness: the widget puts `data-onauth`
through `eval`. Redirect mode needs no eval and was **rejected** —
it returns the signed payload, numeric id and handle, in a URL query
string, into browser history, `Referer` headers and access logs on
every sign-in. That is the membership oracle relocated into a log file.

The policy of every page is pinned in `tools/check_web.py`, page by
page, and the gate refuses one that does not match — both that the
exception does not spread and that it stays exactly this narrow where
it lives. Read the pin rather than a table here; a table here would be
a second copy of a machine-checked fact. If the exception ever has to
widen, the answer is the bot deep-link flow, not a wider policy.

## Threat model, honestly stated

Protected against: a raw dump of the database, an unauthenticated
stranger writing rows, anyone outside the Telegram group, anyone
reading this repository, and a leaked backup separated from the
Worker's secret.

**Not** protected against, most likely first:

- **Whoever runs the Worker.** It reads plaintext in order to serve it,
  so its operator — and anyone who takes the account it runs in — can
  read every entry. This is the ruled trade, it is the largest item on
  this list, and no sentence anywhere in the product may imply
  otherwise.
- **Anyone who can write to the repository or deploy the Worker.** They
  change what the page does, silently. Mitigations raise effort and
  make it detectable, not impossible: `main` is a protected branch with
  admins included, and the directory that ships is committed so what
  ships arrives in a diff somebody read.
- **A member lying**, including about their own measurements. Sign-in
  verifies who is writing, not what they write.
- **A Telegram group that hands out admin lightly.** Admin mirrors the
  group, so the group's own hygiene is the site's access control. Put
  adversarially to the owner; accepted.
- **Telegram and Cloudflare learning who participates.**
- **Traffic analysis** — when entries arrive, not what they say.
- **Somebody at a signed-in member's own browser.** A live session
  shows that member their whole history; a live admin session shows the
  directory and any member's entries. The unified idle timer is what
  bounds it, and it bounds a tab left open rather than a machine handed
  over.
- **A member sampling the charts over time**, per the #153 channel
  above.

## What is deliberately not here

- **No site-side ban list.** Removing somebody means removing them in
  Telegram; a second roster is a second thing to get wrong.
- **No always-allow bypass.** A list that skips the membership check is
  a way in that outlives the reason it was added.
- **No published snapshot.** The Worker aggregates on request, so there
  is nothing to be stale.
- **No member backdating.** Admins backfill; a member typing an old
  date is a correctness problem nobody can check.
- **No framework and no bundler, and one build step that meets the
  test below.** The test is the durable part: *can this tooling change
  what ships without the repository noticing?* Linters cannot — nothing
  they run rewrites a file, and a failure refuses a release rather than
  producing one. `tools/build_web.mjs` does write a file and still
  cannot: it generates `dist/` from `apps/web` by removing comments and
  nothing else, `dist/` is **committed** so what ships arrives in a diff
  somebody reviews, and the gate rebuilds and byte-compares it in both
  directions. A source edited without rebuilding and an artifact edited
  by hand are the same failing check.
- **No service worker, no manifest** — offline queueing of writes it
  cannot confirm, and a home-screen icon naming this project is a
  privacy cost.
- **No webfont** — third-party code on a page that handles plaintext.
- **No staging branch** — the build is a committed directory in the
  same commit as its source, so there is nothing to promote. The
  development *environment* answers what a staging branch would have
  pretended to.
- **No chart library** — the pages that draw are the pages where real
  data is on screen.
- **No rate limiting** — writing costs membership of one Telegram
  group, which is a stronger lock than an account was.
- **No standing data-request playbook.** Ruled 2026-08-14 (#294): a
  legal or personal data request is handled ad hoc — an explicit owner
  acceptance of that gap rather than an oversight, and the owner
  decides case by case if one ever arrives.

## Rejected alternatives, so they are not re-proposed

| Alternative | Why it lost |
| --- | --- |
| Client-side sealing to a key file | an end user thinking about a physical key; no history, no self-service, no live charts. The 0.9 ruling |
| A published snapshot with a publish button | figures as old as the last press; live aggregation costs nothing here |
| A site-side member or ban list | a second roster beside the Telegram group, wrong the first time they disagree |
| Admin tiers | describes Telegram's own reality; the site modeling it invents authority the group did not grant |
| Member backdating | an unverifiable date on a measurement nobody witnessed |
| Google Apps Script + Sheet | data in a Google product; the CORS hack was the project's only open risk |
| Supabase | free projects pause when quiet — a dead form, silently |
| No endpoint (paste the blob) | moves work onto every member; the fallback if the Worker becomes a burden |
| Form spec served from the Worker | a wrong field is silent until somebody reads the data; see "Where configuration lives" |
| A hash of the handle as the row's identity | the membership oracle, above |
| Invite codes | bearer credentials people paste in chats; they verify nothing |
| Widget redirect mode | signed payload in URLs — the oracle in a log file |
| Bot deep-link sign-in | better on the merits, lost on familiarity; the recorded way out if the CSP exception must ever widen |
| A second render function for a second audience | two things that look alike until one is wrong |
