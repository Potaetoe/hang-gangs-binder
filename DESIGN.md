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
back, corrects it and deletes it; an admin can erase a departed
member's rows on the bot's own word rather than guessing; charts are
live rather than a ceremony. Every one of those was impossible while
only a key file could read a row.

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

**Who holds admin, and what the directory now is, are both settled
below rather than here.** "Admin accounts and deletion" states the
three arms into the role; "The identifier is the whole problem" states
what the sealed directory holds and who may read it. Both retired the
model this section used to carry in full — a mirror-only admin grant
and a plain roster table an admin could read — because #385 rule 4
(owner ruling, 2026-08-20) closed even an admin's view of a current
member's row. There are still no tiers: every arm into the role holds
identical powers.

**Bot failure stance: last-known-good cache.** When Telegram will not
answer, the Worker trusts the last verified roster for a bounded
window. Members never bounce off an API hiccup, and **"cannot check" is
never treated as "not a member"** — that sentence governs every place
the roster is consulted, including the departed-member check under
"Admin accounts and deletion", which reads the same failure as
**unknown** and refuses to erase on it. **The window is 24 hours by default, then the
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

**The numeric id is stored in exactly one place in this database:
inside the sealed directory record** (owner ruling, 2026-08-21, at the
departed-member cleanup slice). "In this database" is the whole of the
scope and is not a hedge: `ADMIN_TELEGRAM_IDS` and
`ALWAYS_ALLOW_TELEGRAM_IDS` are deployment secrets that hold numeric
ids and always have, and a rule that read wider than the tables would
be false the day anybody checked it. This narrows a rule that used to
read as "the numeric id is stored nowhere", and it was put to the owner
as a decision rather
than taken as an implementation detail, because the two sides of it are
both real. What forced it: admins may erase a **departed** member's
rows, only the bot may say who is departed, and `getChatMember` takes a
numeric id — the directory is keyed by a one-way HMAC of one, and
Telegram has no by-username form of that call. So the erasing power and
the stored id are the same ruling.

The bounds are the reason it is safe, and each is enforced rather than
promised: the id is **never a column, never an index, never served by
any route, and never logged**; it sits under the same key, the same
purpose and the same AAD binding as the handle already sealed beside
it, so a raw dump still shows an HMAC and two timestamps; and exactly
one function unseals it — the departed check — which asks the bot and
drops it. A second reader is a new decision, not a refactor. The
per-request admin re-check still does **not** use it: sessions are not
re-validated against Telegram, and a leaver's sessions still end at
their next sign-in rather than by polling.

A directory record written before that ruling carries no id, and its
member's status reads **unknown until their next sign-in** — never
guessed in either direction.

An account held open by an operator's always-allow list is a **third
answer and not a quiet "still a member"**: an exact match is a bypass
the bot is never asked about, so the cleanup surface reports the list —
and says which entry to remove — rather than putting words in
Telegram's mouth. A **near-miss** — the same account named on the list
in a spelling the granting predicate below refuses — is a different
case: the bot **is** asked, because a row nobody can prove was meant
grants nothing. But its answer is still overridden and the account
stays protected regardless of what Telegram says, because a row that
only has to be found protects on being found, not on being granted.
Never attribute to the bot what the bot did not say, in either
direction.

**A row in either letter case holds an account open**, and the reason
is the erase and not the list. `wrangler d1 execute` writes upper-case
hex, so an operator's hand-written row is spelled in a case the
authority read refuses — it grants nothing, and that is right, because
a row nobody can prove was meant must not admit anybody. But the
erase's own delete matches without regard to case, so it would remove
that row: a guard that could not see it erased the account *and* the
entry protecting it, in one request. **Granting and protecting are
different questions, and they fail closed in opposite directions.** A
near-miss row grants nothing and protects everything; it stays on the
membership surface's malformed list, which is where an operator learns
which spelling to fix. And before it deletes anything, the erase
refuses outright whenever its guard's view of a member's rows and its
delete's view disagree — the general form of the same defect, so a
later branch added to one view and not the other is refused rather
than discovered.

**And a read that does not answer is unknown too.** The erasing path
fails closed on every read it makes, not only on the bot. Seven reads
stand between an erase request and a deleted row, and every one of them
refuses when it does not answer — named here so the sentence can be
checked rather than believed: the **directory row**, the **sealed
record** it opens, the **operator's allow list**, the **bot**, the
erase's own **membership pre-check**, which counts the rows the delete
would remove, the **session read** that resolves who is calling, and
the **admin re-check** that read makes on every request. A read that
throws, answers nothing, or answers a shape without the columns it
named is the same fact to all seven — the question could not be asked —
and none of them is ever spent as an answer. The refusals say which read failed rather than which is
nearest, because the next action differs: a record with no usable id is
fixed by that member signing in, and the other three waits are fixed by
waiting on different systems. The list is the case worth writing down,
because it is the one where an empty answer looks exactly like a real
one — "not on the list" and "the list did not answer" are the same
empty set — and spending the second as the first erased the rows of an
account an operator was holding open. So "cannot check" is never "not a
member", and it is never "not on the list" either. Sign-in carries the same
fact the other way round: a member the group still confirms signs in
regardless, because refusing everybody over one unreadable table is a
worse outage than the one that caused it, while a sign-in that would
otherwise be refused answers as the Worker answers any error rather
than telling somebody they are not allowed on the word of a list
nobody could read.

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
2026-08-14).** M1's first slice verifies this platform claim against a
live bot before anything is built on it. Membership and departed
status are both asked live, per request, rather than through an event
stream and a sweep: a sign-in's `groupStanding()` call and an admin's
departed check (0.9-M3-S15, #420) are the same `getChatMember` lookup,
made fresh each time. "Cannot check" never reads as departed — see "The
identifier is the whole problem" for the fail-closed rule that carries.

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

**An admin reaches the role three arms wide, one tier.** A Telegram
group admin; a member another admin flagged into the role — the two
ways a person is *put* into the role (owner ruling, 2026-08-20, #385
rule 1) — and the founding-admin secret the first flag starts from.
Identical powers on all three; `GET /me` reports which one an admin
holds, because a person who cannot see why they are an admin cannot
tell a flag another admin can remove from a group role that lives in
Telegram. The root of trust is still the group: every admin is a
signed-in member, and there is no outside-the-group superadmin, an
earlier idea considered and dropped. The flagged list carries the
last-admin guard that keeps a deployment from tidying its way into a
lockout.

**No admin surface exposes a current member's data (#385 rule 4).**
Admins are members, so they see the members' side as members; the admin
surfaces add settings, content, the role list, the change log, and
cleanup — never a current member's rows, handle, or history. **Per-
member actions are exactly two: flag or un-flag the admin role, and
erase a departed member's rows.** Opening a member's own entries and
backfilling one on their behalf are gone from the admin surfaces along
with the roster table that used to make them possible.

**Deletion is deletion.** A member corrects and deletes their own rows,
in full self-service — no trace, no admin notice, and the charts move
with it. Their data, their delete.

A correction is a new row naming the row it supersedes rather than an
edit in place, so the repeats are the history the binder exists to
accumulate. The list shows current values only, with a reveal for the
replaced ones. The pointer is a column the Worker can read, because a
pointer it cannot read is one it can neither check against the caller
nor subtract from what a member is told they have.

**Departed-member cleanup is the one per-member erasing power (#385
rule 4; built 0.9-M3-S15, #420).** "Departed" is never a guess: the
bot's live `getChatMember` answer decides it, the same call a sign-in
already makes, so an admin's list is departed, current, or **unknown**
— unknown is the ordinary case for a directory row written before the
id-sealing ruling below, until its member next signs in, and it is
never erasable.

An erase removes four row classes for one account in a single
transaction — submissions, the directory row, every membership row,
every session — with no cascade through a superseded row's pointer, and
it refuses outright before touching anything if it would take the last
admin who grants the role. **The erasing path fails closed on every
read it makes, not only the bot's** — "The identifier is the whole
problem" names the seven and the always-allow/near-miss distinction the
checks make.

The erase logs once — actor, twelve characters of the account id, the
bot's verdict, and a count of rows removed per class, never a row, a
label, a handle, or a numeric id. A member's own self-delete stays
unlogged, since it is the member's own act; whether an admin's ordinary
`DELETE /submission/:id` on a live member should log too is an open
question for the batch security consult, not settled here.

**A member sees a pre-leave notice before they act (#294 F3, ruled
2026-08-14): delete your own rows before you leave, or ask an admin to
erase them after.** This is a mechanism note, not the shipped copy —
the exact wording is authored at the M4 register sitting. What changed
since the ruling: there is no guarded window and no restore-on-rejoin —
an admin's erase is available as soon as the bot confirms a departure,
and rejoining the group does not undo an erase already done.

**Every admin write lands in the append-only change log — who, what,
when** (#385 rule 5, generalizing #294 F4's deletion-only line to every
admin action once M3 built `admin_log`, 0.9-M3-S8, #414). Members never
see it; **Admin surfaces** below states what it shows for a departed-
member erase specifically. **Backups are a ruled obligation, not a
suggestion** (#294 F4): the first rehearsal happens before the first
real entry is ever stored, and the cadence is displayed beside bot
health on the Settings page rather than living only in
`OPERATIONS.md`. No specific cadence number was ruled — the obligation
and its visibility were.

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
- **No member backdating.** The form has no date field, and backfilling
  a member's entry is not an admin action any more (#385 rule 4: exactly
  two per-member actions, and adding an entry is not one). A historical
  import, if the group ever wants one, is a bulk operator act outside
  any per-member admin surface, and it is unbuilt.
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

**One measure, and a filter that composes.** A caller names any
categorical field with any subset of its values — several values on one
field **ORed** together, several fields **ANDed** together, and a field
named not at all matches everybody (0.9-M3-S24/S31, #438/#455, the
Worker half of the owner's multi-select chip ruling, #454 items 16-18).
The floor is applied to the answer, per response, exactly as it is to
an unfiltered group. **The answer echoes the caller's own filter
pairs back, in the order asked, and never enumerates what the group
holds** — a list of which values exist would itself be a membership
oracle reachable in one request (`server/charts-agg.js`'s response
contract, mandate 5). **The measures derive from the form's field
spec** — every numeric field charts, weight and height and computed
BMI today — so a fork that edits its fields gets matching charts with
no chart code to write. The spec carries kind, unit and range metadata,
which is what lets conversion, computed fields and the band edges
derive too; it is `apps/web/site.config.js` and this page is one of the
two things it exists for.

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

**The group sees its own figures. The suppression floor ships at 0.**
The owner re-took the whole disclosure regime at the charts sitting of
2026-08-19 — five rounds of questions including an adversarial one, the
record at #243 comment 5346978974 — and this section is that ruling.
It supersedes what stood here, the floor default in the #228 record,
the #153 cumulative-channel acceptance and the #351 cross-filter
acceptance, all of which described a regime the owner has now ruled off
by default, eyes open. Put adversarially and accepted in the owner's own
words: **"members chose to share."** The consequence was stated plainly
and accepted with it — *a filter isolating one member shows that
member's number to every signed-in member* — so a one-person view
drawing its true value is this design working, not a hole in it.

- **Categories are counted, never charted.** Gender, affiliation and
  country are never bars. In their place the page carries a **group
  makeup** block of plain count lines — one line per value, exact
  counts including small ones and zeros ("Men: 10", "Non-binary: 2",
  "Other: 0"). **Each member counts once, and their most recent entry
  decides their current category**; the filter uses that same
  latest-entry person rule. Asking for a category as a measure is
  refused exactly as an unknown measure is. **The country lines name the
  countries the group really holds**, in filtered views as well — the
  owner ruled that one explicitly on 2026-08-19 (#371 comment
  5347769320), since a list whose choices live outside the spec can carry
  no zeros and so says which countries are present: *"the group sees its
  own makeup; the members-only door is what protects it."* That door is
  the protection, which is why widening the readership re-takes this
  question.
- **Distributions draw on fixed bands from the spec, in the unit being
  read.** The edges are the field's own minimum, maximum and band
  width; they never move to fit the data and never merge. **The band
  width is a nice number IN THAT UNIT — 25 lb, 10 kg, 5 BMI, 5 cm,
  2 in — and every edge is a multiple of it, so the spec's own bounds
  snap outward onto the same grid** (owner ruling, the 2026-08-21 axis
  sitting, #396). That is what puts round numbers on the axis: the
  chart is binned in the unit a member is looking at rather than in one
  canonical unit and converted, which is where an axis reading 44, 64,
  84 came from. **The x-axis is tick marks with those edge numbers
  under them**, thinned by measured width with the first and last
  always painted — a number under an axis reads as a boundary, which is
  what it now is. The midpoint captions this replaced asked readers to
  know a convention nobody has; the owner's words on the live chart
  were *"no person in their right mind would understand the bar to the
  right was 504–524 lbs"*. **The unit is named once, in the status line
  — "Showing Weight (lb)." — and nowhere else on the page**; the exact
  range with its unit is one hover away, in the tooltip. A leading or
  interior empty band still draws an empty slot, and there are no
  suppression notes. **At the
  shipped floor of 0, the drawn range stops at the band holding the
  data's own maximum** (owner ruling, the 2026-08-20 sitting, #390):
  the chart still starts at the spec minimum, and an empty TAIL past
  the heaviest member simply does not paint. The axis still ends on
  one of the spec's own fixed edges, never a number fitted to the
  data, so this is not the open edge #351 refused - a raised floor's
  merged tail band always carries a count, which is why the trim finds
  nothing there and the drawn axis still reaches the spec ceiling: a
  raised floor is what hides whether the heaviest member sits near
  that ceiling or far below it. Fixed edges are what makes two views
  comparable, and they are also why no edge can report the heaviest
  member's band the way an edge fitted to the group did (#351, F2).
  **A range is set so that no form-valid member draws clipped** — for a
  computed field with no unit table of its own, that means deriving it
  from the form's own bounds rather than picking a cap that looks
  reasonable (owner ruling, 2026-08-19, #371 comment 5347769320: *"in a
  gaining community the high end IS the story"*). The arithmetic sits
  beside the numbers in `apps/web/site.config.js`, which is their one
  home. **And "form-valid" means valid in ANY unit the form offers**:
  the axis covers the union of every unit's declared limits, converted,
  before it snaps outward onto the grid. A member typing 3 ft is 91.44
  cm — under the 100 cm the metric row declares — so an axis built from
  one row alone clamps the shortest member the form accepts into a band
  that reports a height he does not have.
- **Every month with data draws its true mean, and lines never break.**
  Truly empty months are bridged on the page, and a bridged segment
  looks exactly like a real one. The member's own "You" line follows
  the same rule.
- **The empty view is the only refusal left.** Zero matching entries
  answers "not enough people for this view" plus a hint to widen the
  filter — the honest sentence, not an error and not a status code.

**The suppression machinery stays, and the floor is a number an admin
can move.** Nothing was ripped out of `server/charts-agg.js`: the
`Other` bucket, person-pooling and band merging all remain and obey
whatever floor the setting holds. At 0 each of them is the identity,
reached by the same code path a raised floor takes rather than skipped.
The unit lock below joined them at #396: it is the one piece that does
nothing at 0 and everything above it, because two served unit systems
are harmless while every band draws its true count and are a
differencing oracle the moment they do not.
The way back is a number, so this group's choice is not every
fork's fate — the setting and its shipped default are stated with the
other Settings defaults under **Admin surfaces** below, and
`tests/charts-aggregate.test.mjs` proves the machinery at a raised
floor so that raising it stays a supported act rather than a hope.
What a raised floor then means:

- **A drawn cell describes at least the floor's number of people.**
  Suppression is by subtraction, not redaction — removed cells fold
  into an `Other` bucket that itself clears the floor, so within a
  single view the remainder cannot be differenced back. **The floor
  counts people, never value-holdings**, for every fold including that
  bucket: a field a member may answer more than once lets one person
  feed a count into every value they hold, so a bucket that added those
  counts up could clear the floor with two people behind it (#351).
  Adjacent bands merge rather than being dropped.
- **A trend of one line is a chart of one person**, so the floor
  applies to lines as it does to cells.
- **The charts serve one unit system**, so the same people are never
  binned two ways at once — see **One partition, not two** below.

**One partition, not two — held by a unit lock.** A group is never
sliced two ways at once. Two independently-binned unit systems can be
overlaid into a finer reading than either gives, differenced back into
sub-floor cells in 2899 of 3000 random groups, which is why this is a
rule rather than a caution.

What changed at #396 is how it is held, not what it forbids. Bands are
binned in the unit being read, so both systems really are their own
grids. **At the shipped floor of 0 both are served**, and there is
nothing to difference back to: every band already draws its true count,
so a reader keeping two documents learns what a reader keeping one
already knew. **At a raised floor the charts lock to one unit system** —
named beside the floor in the same setting, and **defaulting to the
spec's own declared default**, the field that already decides what the
form and the charts start in. Falling back to anything else would mean
an admin typing a number into the floor silently re-expressed every
chart in a system nobody chose. Every answer says which system it got
and whether the caller chose it, so the page disables its units toggle
and tells the member why rather than leaving a control that cannot move.
With one slicing in existence there is no second grid to overlay, so the
protection is structural rather than a rule about what a caller may
request.

This makes the rule part of the suppression machinery after all, which
is the opposite of what the shape it replaced was: that one served a
single partition to everybody and took no floor at all, and #371's
finding F1 was right about it. `tests/charts-aggregate.test.mjs` runs
the overlay attack as an instrument rather than describing it — it
recovers sub-floor cells from two answers computed under two different
locks, then turns the same instrument on the pair a caller can actually
obtain inside one deployment and finds nothing.

**A weight and a height and a country is a person to anyone who knows
her**, with or without a name column. That sentence is still the test
to apply to a new view; what the sitting changed is the answer this
group gives for the views it already has, not the question.

**The cumulative-disclosure channel is subsumed rather than
outstanding.** A count and a mean multiply back to a total, so a reader
who keeps two views can compute the movement between them; the owner
ruled on #153 to accept that channel, and the #351 ruling extended the
acceptance to filters. At a floor of 0 there is nothing left for that
arithmetic to recover that the response did not already say. Both
rulings, and this one, rest on a **members-only readership**, which the
members-only rule above preserves — that premise is what to re-take if
the readership ever widens.

**Value sets open a channel the floor does not bound, held rather than
closed — real only past a raised floor.** At the shipped floor of 0
there is nothing to subtract back out, exactly as the cumulative
channel above. Past 0, two **allowed** answers can still be subtracted:
ask a broad union of values, then the same union missing one, both
clear the floor, neither is ever refused, and the difference is that
missing value's own count exactly — no small question is ever asked.
The owner accepted the per-response floor and the combined-filter reach
that sharpens it (#243, #384) with this cost named rather than hidden.
Closing it is 0.9-M3-S36's candidate mitigation (#462,
difference-aware flooring), awaiting the batch security consult before
it is built — stated here, not designed here. Until it rules, the page
gates both combining across fields and several values within one field
behind that same open question (0.9-M3-S14).

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

## The UX record

**Every page is built against one record, #454** (owner ruling,
2026-08-22, five rounds under the standing rule that a UI decision is
put to the owner before its slice is dispatched). This section carries
it in the document's voice; #454 itself stays the source a builder
cites by item number, and a UX choice this record does not answer is a
STOP and ask, never a sensible-looking pick.

**The page.** A focused page with a few clearly separated sections to
scroll — not one thing per screen, not a dense dashboard. Controls are
native first — the phone's own drop-downs, pickers and keyboards,
styled in color only — and custom only where the site's identity lives:
the chips, the theme picker, the charts. Every tap target is at least
44 px, body text at least 16 px, and the primary action sits within
one-hand reach, near the bottom on a phone. Transitions are gentle —
roughly 150 ms fades and slides, charts settling into place — and
honor the phone's reduce-motion setting. Icons carry text on desktop;
alone, with a label under them, only where space is tight, which is the
phone's bottom bar: 3-4 items — your page, charts, sign out, the admin
page for admins only — the same items in a top rail on desktop.

**Words and feedback.** The voice is plain and warm — "Saved." or
"That didn't work - the Worker is down, try again in a minute." — never
jargon. Feedback after an action is a brief toast that disappears on
its own, never an inline status line, never a modal. A dangerous action
(erasing a departed member, retiring a field) confirms in place: the
button becomes a sentence with the real consequence — "This removes 14
rows for <label>. Remove them?" — with Yes and Cancel right there. An
empty state is one friendly sentence and the next step: "No entries yet
- add your first one." with the button; a chart's is "The picture
appears once N members have entered."

**Forms.** A mistake is pointed out as the member leaves the field, in
a short note under it — never on submit, never while typing. On a
phone the label sits above a full-width control with one line of help
or the error below. A long list — the change log, an admin's departed
list, a big value list — shows the newest 20 with a "more" button; a
search box only where a list can grow without bound.

**The door and the first visit.** The door carries the group's name,
the admin's welcome sentence, and the Telegram sign-in button — nothing
else above the fold. The first visit paints only the phone's own
light-or-dark choice; the phone's separate more-contrast setting is
**not** honored while scripts run, a decision rather than an oversight
(owner ruling, 2026-08-22, closing a needs-owner question raised by
0.9-M3-S32's review, #456) — the CSS high-contrast fallback stays
reachable only with scripts off. The admin's chosen palette applies
once a member opens the theme picker, and the member's own choice wins
from there on.

**The charts filters** (refining #384). Chips are multi-select and feel
natural: every option starts lit — everyone — tapping one turns it off
and narrows, and at least one stays lit; there is no "All" chip,
because everyone IS every option selected. Values of one field are
ORed, fields are ANDed (see **Charts** above). A field renders as chips
only if they fit two rows at the device's own width, measured on the
device without a flicker; past that it becomes a drop list, offering
only the values that have entries — the floor rule for presence too —
with US/GB/CA pinned first. The status line still reads in plain words
("male feeders, weight"), and combining across fields still carries the
honest disabled sentence on a second row while the batch security
consult decides it.

**Admin surfaces.** Tabs, not stacked cards — Settings, Roles, Fields,
the change log, and Departed — desktop-first, with one phone pass for
legibility rather than the phone-first treatment a member page gets
(#454 item 22, following a wrap-row defect 0.9-M3-S30's phone check
found). Rename is one button meaning "the same thing, a new word";
retiring a value is the separate action. Exports stay off the admin
page.

**Label/value rows stack on a phone** (#454 item 21, ruled from the
same wrap-row defect): the label sits above its value at phone widths,
nothing squeezed, a long label wrapping on its own line; side by side
stays for desktop.

## Admin surfaces

**Five tabs, one page** (owner ruling, 2026-08-22, #385/#454 item 20;
built 0.9-M3-S10/S30, #416/#452): Settings, Roles, Fields, the change
log, and Departed — one `[role="tablist"]`, desktop-first and checked
at one phone width for legibility rather than the phone-first pass a
member page gets (#454 item 22). The pre-0.9 `admin.html` dies with the
keys, and nothing it carried survives unruled: **no entry exports**
(bulk member data leaves only through the operator's own token-gated
`/export` route, by hand — Prime's ruling on #416, amending #385 rule
4), **no keyfile tool**, **no publish controls**. Bulk import is a
future slice.

**Roles** lists the flagged admins with their labels (`GET
/membership`) and is where flagging and un-flagging happen — the one
identity-shaping per-member action #385 rule 4 gives an admin over
another member. It is not a member directory: a row here says only
that an account holds the role, never what the account entered.

**Settings** carries exactly what this design makes an admin
responsible for, one control per setting, each read from `site_content`
(0.9-M3-S8, #414) and validated on write:

- **The suppression floor and the locked unit system are one control**,
  not two — raising the floor above 0 carries the unit-lock choice with
  it, because a floor-protected group must not be binned two ways at
  once (see **One partition, not two** under **Charts**). Shipped
  default: floor 0, the unit unlocked (the spec's own declared
  default). Zero is a value of the setting rather than an off switch —
  the machinery reads it on every request and applies it, so an admin
  typing 5 gets exactly the regime the charts sitting described,
  unchanged and still proven. The Worker holds the default in one
  place, `server/charts-agg.js`'s `DEFAULT_FLOOR`, and this page edits
  the setting that overrides it. **The page states when the floor is
  active** ("groups smaller than N are hidden," #385 rule 11) — the
  honest-empty-state rule extended to the setting itself.
- **`site.groupName`, `site.welcomeText` and `site.defaultTheme`** are
  the three editable content facts #385 rule 9 names for M3 — the
  door's welcome text, the group's name and title, and the default
  palette. Form explainer text stays code.
- **Bot health** — "membership last verified N minutes ago".

**Fields is the categorical form builder** (#385 rules 6-8, built
0.9-M3-S11's Worker half and S13/S25/S30's page). Admins add, rename and
remove choice fields and their values; numeric fields (weight, height)
stay code-defined, since admin-editable bins would collide with the
fixed-bands comparability ruling. **Existing data always survives an
edit: keep the data, adapt the display** — a removed field's answers
stay sealed in members' rows and stop rendering; restoring the field
brings them back, from any admin session, not only the one that retired
it (0.9-M3-S25/S30, #440/#452). **Rename is one button, the smarter
default** (owner ruling, 2026-08-22): a rename always means the same
word for the same thing, so old entries follow it instantly; retiring a
value to introduce a genuinely new option is the separate action it
always was. New categorical fields flow automatically into the charts
filter chips (#384) and the group-makeup block.

**The change log** is `admin_log` (0.9-M3-S8): every admin write — a
settings edit, a content edit, a flag, a field edit, an erase — appends
one line (who, what, when), admin-only reading. Members see results,
not the paper trail.

**Departed** is the one per-member erasing power's own tab (#385 rule
4; the Worker half at 0.9-M3-S15, #420; the page half at 0.9-M3-S34,
#458): the newest 20 departed accounts with a "more" button, an unknown
section with each reason in plain words, and an allowed section naming
the operator's-list entry to remove first — never a handle, never a
numeric id. Erase confirms in place, the button becoming the real
sentence and consequence (#454 item 9), and the result is a toast.

**Content lives as one admin-owned config the pages read** (#385 rule
9, "content-as-data"). Nothing here bypasses **Where configuration
lives** below: the categorical half of the field spec composes through
`GET /spec`; the three content facts above are the same shape, one row
per name in `site_content`, so a later milestone adding a whole page —
a calendar, a socials-links page, both owner-floated futures — is a new
config section rather than a rebuild.

## Where configuration lives

The line is not static against dynamic. It is **whether a wrong value
gets written into a row.**

**The form's field spec is a repository data file, and it exists:**
`apps/web/site.config.js`, read through `apps/web/fields.js`. It
carries which fields there are, of what kind, in what units and within
what bounds — a repository file rather than a runtime one because a bad
bound produces a plausible record, stores it, and is discovered much
later. No Worker check could catch that: the Worker has no opinion
about meaning, deliberately. So the spec ships in a release that
somebody read, and an admin-editable form means a surface that
*composes* a spec rather than one that bypasses this.

**That composing surface is the effective spec** (0.9-M3-S11, #419),
and it is where the line falls in practice. `GET /spec` answers the
static file overlaid by what admins have edited, computed in one place
on the Worker and read by the pages and by the aggregation alike; with
no admin edits it is the static file byte for byte, so that file stays
the fallback and the fork's starting point. **Only the categorical half
composes.** Values, their words and their order are admin data stored
one row per field in `site_content`; the units, the limits and the
chart bands stay code, which is the same line #385 rule 6 draws from
the admin's side. Nothing an admin does rewrites a sealed row — a
retired field or value stays inside members' entries and the spec
simply stops offering it, and a rename asks whether the word changed or
the option did.

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
- **Members seeing each other's contributions to the figures.** Not a
  channel to sample any more: it is the ruled default. The charts draw
  every cell, band and month at its true value, so a filter that
  isolates one member shows that member's number to every signed-in
  member. Put adversarially at the 2026-08-19 charts sitting and
  accepted in the owner's own words — "members chose to share" — with
  the one-person view named as the price (#243 comment 5346978974).
  The earlier acceptances of the same disclosure arriving by arithmetic
  (#153 over time, #351 across filters) are subsumed by it. An admin
  who wants the old regime raises the floor; see **Charts**.

## What is deliberately not here

- **No site-side ban list.** Removing somebody means removing them in
  Telegram; a second roster is a second thing to get wrong.
- **No published snapshot.** The Worker aggregates on request, so there
  is nothing to be stale.
- **No member backdating.** Nobody backfills a member's entry any more
  (#385 rule 4 retired the admin power that used to); a member typing
  an old date would be a correctness problem nobody could check either
  way.
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
| The form's units, limits and bands served from the Worker | a wrong bound is silent until somebody reads the data; the categorical half composes instead, see "Where configuration lives" |
| A hash of the handle as the row's identity | the membership oracle, above |
| Invite codes | bearer credentials people paste in chats; they verify nothing |
| Widget redirect mode | signed payload in URLs — the oracle in a log file |
| Bot deep-link sign-in | better on the merits, lost on familiarity; the recorded way out if the CSP exception must ever widen |
| A second render function for a second audience | two things that look alike until one is wrong |
