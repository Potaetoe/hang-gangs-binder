# UAT — accepting the redesigned binder

A pass for the owner, or any member they hand it to, to drive cold.
Every check names what to do, what passing looks like, and **why it
matters**, so a partial failure is a decision you can make rather than
a mystery.

The product this accepts is the accounts redesign: rail navigation on
signed-in pages, a plain sign-in page and a plain error page, the cover
that opens once, a palette set switched from one **Theme** control at
every width on every page but the error page — a dark default, a light
one, a pink-leaning one and a high-contrast one — the wordmark
**Muse's Binder** under the site title **HangGang**, and sign out
reachable from every railed page.

**Palettes are described by character here and never by chip label.**
Nothing compares the chip labels across the four pages that carry them,
so a rename reaching three copies of four passes the whole gate — a step
naming a chip would send a driver looking for one that is not there and
let them record a pass for a palette they never opened. The **Theme**
control in front of you is the list, and counting the chips against it
is what catches one going missing.

**It is in two parts because the split is forced, not a convenience.**

| | Where | What it can cover |
| --- | --- | --- |
| **Part A** | your own machine, before the cutover | everything except the Telegram widget and production |
| **Part B** | the live site, after the cutover | the widget, a real sign-in, and anything needing production |

BotFather binds the widget to `potaetoe.github.io`. Anywhere else it
renders "Bot domain invalid" and there is nothing to be done about it,
so a real sign-in genuinely cannot be accepted before the cutover, and
Part B is not optional tidying.

Run **Part A first, in full.** Everything it catches is something you
would otherwise find during the sitting, after `CUTOVER.md` step 4 has
already taken the rows.

**Steps naming a surface whose slice has not landed are driven when it
lands.** Which slices are outstanding today is mutable, so it is on the
issues rather than here — the acceptance boxes on #122 are the list,
and this document is complete when every one of them has steps above.

---

## Part A — before the cutover

Part A has two arms, and they are run separately rather than
interleaved because they prove different things.

| Arm | What it is | What only it can show |
| --- | --- | --- |
| **A1–A11, staged** | the demo, offline and self-contained | every surface, on demand, including states that are hard to produce by hand |
| **AL1–AL5, live** | the real pages against the development Worker | that a request actually leaves, is answered, and changes stored state |

The staged arm cannot prove a round trip, because nothing in it reaches
an endpoint. The live arm cannot conjure a corpus with six repeat
submitters on demand. Neither substitutes for the other, and a step
recorded from the wrong arm proves less than it claims.

### A0 · Setup

**The staged arm.** From the repository root, on `accounts`:

```bash
./run demo
```

Then <http://127.0.0.1:8126/dev/demo.html> — the console. Pick a
scenario there; it is carried in `sessionStorage`, and the surfaces
open under `/demo/…`. Each section below names the scenario id it
needs in its heading.

**The pages under `/demo/` are the shipped pages, mirrored off disk.**
`apps/web/` takes no demo hook — AGENTS.md makes that a boundary, since
a hook that ships is a hook a visitor can reach. So what you accept
here is the same bytes the cutover publishes, which is the entire
reason the demo is worth driving rather than reading.

**The live arm.** Separately, and never at the same time:

```bash
./run serve
```

Then <http://127.0.0.1:8124>.

**`127.0.0.1`, not `localhost` — #72.** The bare server binds IPv4 only
and a browser tries IPv6 first, so every request pays a failed-connect
fallback: the site reads as slow and the site is not. **Port 8124 is
not optional** either — `config.js` picks the arm by hostname and the
development Worker's allowed origins name that port, so another port
fails CORS quietly, which looks exactly like the endpoint being down.

**Signing in on the live arm has no button, by design.** There is no
development sign-in UI. Open the console on the sign-in page and call:

```js
await BinderAuth.authenticate("/auth/dev", {
  secret: "<your DEV_LOGIN_SECRET>", subject: "alice", admin: false
})
```

Type the secret into the console; never into a file, a note, or
anywhere it persists. Use `admin: true` where a step asks for an admin.
`subject` becomes the handle, so `alice` and `bob` are two different
members — used below. You will also need the **development private
key** for the export steps: the half matching `config.js`'s development
arm, held offline.

**Keep the browser console open for the whole pass** and watch for
`securitypolicyviolation` events. A policy violation is a real failure
even when the page looks right, and several of this project's bugs were
invisible anywhere else.

**Names.** Each destination is addressed by file name, with the label
it carries beside it: `index.html` (**Sign in**), `submit.html` (**Your
binder**), `dashboard.html` (**Progress**), `admin.html` (**Admin**).
The file name is the anchor because it is the part that does not move.

### A1 · The shell and the identity — scenarios `signed-out`, `member`

The redesign's own surface. Everything here is visible without a
request, so it is the cheapest section and the one that fails first.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A1.1 | On `signed-out`, open `index.html` | The cover leaf paints closed and swings open once, revealing **Muse's Binder** | The one animation in the product; it is the first thing anyone sees |
| A1.2 | Reload with the browser window narrowed and widened | The cover opens once per load and never traps the page behind it | Its resting state is *open*, so every way the animation can fail leaves the sign-in reachable |
| A1.3 | Turn on the operating system's reduced-motion setting and reload | The binder is **already open** — no frame of the closed cover at all | At a shortened duration the first frame still paints, and a full-screen flash is the exact thing that setting asks not to be given |
| A1.4 | Confirm `index.html` and `404.html` carry **no rail** | Both are plain, with a single way onward | The owner's decision: no rail before sign-in, and an error page goes plain on principle |
| A1.5 | On `member`, open `submit.html`, `dashboard.html` and `admin.html` | All three carry the same rail, same four destinations, same order | Three hand-written copies; a rail that differs per page is how somebody gets stranded |
| A1.6 | On each, check which destination is marked current | The one you are on, and only it | The rail is also the answer to "where am I" |
| A1.7 | Open **Theme** and press **every chip it offers, in turn** — the control is the list, and working from a remembered set of names instead is how a palette goes undriven | Each one repaints the whole page, the control marks which is active, and the choice survives a reload | A preference that does not persist is not a preference. Counting the chips against the control rather than against a list written here is also what catches one going missing |
| A1.8 | On the **high-contrast** palette — the one the site applies when the operating system asks for increased contrast — read a card, a muted line and a link | All legible, nothing washed out | It exists for readers who need it, so "looks fine to me" is not the test. Identified by what it does, because that is the part of it that will not be renamed |
| A1.9 | On `signed-out`, open **Theme** on `index.html` and press a chip. Then, with no palette ever chosen, load the site with the operating system set to light, then to dark, then to increased contrast | The sign-in page carries the same single control the rail pages do, its chips open **in place below the button** and repaint the page, and the choice survives a reload. With nothing ever chosen the site answers each system setting without a script running, and a chosen palette still beats all three afterwards | Signed out is where a visitor meets this site, so the palette is offered there too (#150). What answers a visitor who never opens the control is the pre-paint and the stylesheet's own media blocks, which is also all `404.html` has — it carries no chips at all |
| A1.10 | **On `admin.html`** — narrow to a phone width, then widen back up through a tablet width until the rail returns | The rail becomes a strip **that reaches both edges** at every one of those widths, all four destinations stay in flow, and the page never scrolls sideways | The destinations are what somebody needs, and they are what stays. Driven on any other page this step passes without asking the question: `admin.html` is the only one carrying a control whose intrinsic width refuses to shrink — the key file picker — so a shell rule that sizes the column to its content instead of to the screen shows up there and nowhere else (#148). The widths between the phone and the rail belong to the same rule, and are where a strip narrower than the page under it is visible |
| A1.11 | **At every width, on each of the four pages that offer one** — open the **Theme** disclosure, then press Escape | The chips appear in place and push what is below them down, nothing floats over the page, and Escape closes them and returns focus to the button | Focus left inside something no longer on screen restarts the next Tab from the top. It is one control with one behavior at every width (#150), so a pass at one width is not a pass |
| A1.12 | Prove the fonts **paint** rather than fall back — in the console, `await document.fonts.load('600 1rem "DM Sans"')`, then `document.fonts.check('600 1rem "DM Sans"')`; repeat for `Playfair Display` and `JetBrains Mono` | `true` for each | **`check()` alone is misleading.** A face the page has not needed yet reports `false` for being unloaded, not for being missing — loading it first is what makes the answer mean anything |
| A1.13 | Read the browser tab on every page | Every title ends **— HangGang**, and the page's own name is the same word the rail uses | One name per destination; a tab disagreeing with the nav is #127's whole complaint |

### A2 · Signed out, nothing is reachable — scenario `signed-out`

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A2.1 | Open `submit.html` | Sent to `index.html`; the form never paints | A usable-looking form whose request would be refused wastes a submitter's typing |
| A2.2 | Open `dashboard.html` | Sent to sign-in; no figures | Members-only since 2026-08-05 |
| A2.3 | Open `admin.html` | Sent to sign-in; no key box, no rows | The admin page has no typed-token path any more |
| A2.4 | Watch the network panel on all three | **No request** went out at all | Refusing before asking is the property; a request that earns a 401 has still announced you |
| A2.5 | Open `404.html` | An error page that says so plainly and offers one way back | Reached by strangers and by mistyped links, so it must not look broken |

### A3 · Your binder — the member panel — scenario `member`

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A3.1 | Land on `submit.html` | Two tabs, **Entries** showing, and the rail carrying your name and a **Sign out** | The session has one home on every page rather than one page |
| A3.2 | Read the entry count | It matches what is actually stored for you | The count comes from `GET /me` and nothing else; this is the acceptance criterion |
| A3.3 | On a member with nothing stored, read the "last submitted" line | Something honest — "No entries yet" — never "Invalid Date" | A brand-new member is the most common first view of this page |
| A3.4 | Switch between **Entries** and **New entry**, repeatedly | **Exactly one** pane visible at a time, never both, never neither | `[hidden]` losing to `display: flex` has shipped here before |
| A3.5 | Fill the form and submit | Success, and the count **moves on its own** | The panel re-reads `/me` after a stored submission rather than incrementing a guess |
| A3.6 | Return to **New entry** after a submission | The form is back, with a note saying the earlier entry is kept | #64: before it, the received card replaced the form and never gave it back |
| A3.7 | Look for a handle field | **There is none.** The handle comes from the session | While it was typed, a member could store somebody else's handle beside their own account id |
| A3.8 | Read your numeric Telegram id under **Entries** | It is shown | #58. Being made an admin needs that number, and a page that does not show it sends people to a third-party bot to ask for it |
| A3.9 | Read the key fingerprint on the page | 32 characters, matching the **development** public key in `config.js` | On anything but production it will not match the pinned group message, and that is expected |

### A4 · The device-local prefill — scenario `member-prefilled`

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A4.1 | Reload the page | Weight and height come back | The point of the feature — mostly so a height that never changes is not retyped |
| A4.2 | Press **Sign out**, then sign back in | The fields are **empty** | A sign-out leaving body measurements on the device would be a lie |
| A4.3 | Fill the fields as one member, close the tab without signing out, open a new tab as a **different** member | The second member's form is **empty** | This is #56. The session dies with the tab and `localStorage` does not, so before the fix the second member saw the first one's measurements |
| A4.4 | With the second member signed in, look at `localStorage` in devtools | The first member's prefill entry is **gone**, not merely ignored | Data already on the device had to be erased, not just stopped from growing |
| A4.5 | Hand-edit the prefill entry to something malformed and reload | The page starts normally with empty fields and no error | Someone hand-editing storage, or an older format, must not produce a dead page |

### A5 · A correction supersedes — scenario `supersede`

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A5.1 | Correct an existing entry rather than adding one | It is accepted as a correction | #84. Members mistype, and a product whose only remedy is "submit it again" turns one mistake into two rows |
| A5.2 | Read the count on the panel afterwards | It counts **effective** entries — the correction replaced the row, it did not add one | The count is what a member trusts; a correction that inflates it teaches them not to |
| A5.3 | Try to correct the same entry twice | The second attempt is refused | A row is superseded once, which is what keeps "current" meaning the current rows |
| A5.4 | Try to correct an entry that is not yours | Refused | Otherwise a correction is a write into somebody else's history |
| A5.5 | Look at what the keyholder sees for that member | Both rows are present, and which supersedes which is legible | Storage is append-only on purpose; the correction is a pointer, not an erasure |

### A6 · Sign out ends the session — scenario `revoked`

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A6.1 | Press **Sign out** from `submit.html` | Returned to `index.html`, and the session is gone from `sessionStorage` | The user-visible half, and it must always succeed |
| A6.2 | Repeat from `dashboard.html`, then from `admin.html` | Identical behavior from each | Sign out is on every railed page, so every page has to mean the same thing by it |
| A6.3 | With a revoked session, make the page request again | It is refused and you are sent to sign in | Dropping this tab's copy of the token is not the end of a session — the row is |
| A6.4 | Read what the page says while the revoke is in flight | Nothing about the revoke | The act you performed is the local clear; a message about the other half would describe a sign-out that did not happen |

> **Sign out on `admin.html` ends the session and nothing else. The
> stored private key stays on the device, and Clear is the one lever
> that removes it.** This is deliberate, decided by the owner, and it is
> written here so it is not filed as a bug. #70 made the key persistent
> so that later exports need no file; sign out is about the session,
> which is tab-scoped anyway. The card on that page names Clear, and
> A7.5 is where you exercise it.

### A7 · The keyholder's key — scenario `keyholder`

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A7.1 | Open `admin.html` | It opens on the session. **No export-token box** | The page runs on the session now |
| A7.2 | Provide the private key and decrypt | Rows appear; CSV, Excel and JSON are all offered | The whole product |
| A7.3 | Leave and come back to the page | It decrypts again **without another paste or file** | The point of #70: a keyholder retyping a key on every visit ends up storing it somewhere worse |
| A7.4 | Read the "Before you close this" card | It says the page is the only place the submissions exist in the clear, and names **Clear** | The warning whose reader's next action depends on it |
| A7.5 | Press **Clear**, then reload | Both copies are gone — the decrypted rows and the stored key — and the page asks for the key again | "Press Clear before you leave this browser" is only true if Clear does that |
| A7.6 | Decrypt with the **wrong** key | Rows are **listed with their ids**, not silently skipped | The ordinary cause is a rotated key, not damage, and hiding them looks like data loss |
| A7.7 | Put a `=`-leading value in a text field, then export the CSV | The cell arrives with a **leading apostrophe** | Otherwise a spreadsheet runs it as a formula |

### A8 · Admin — scenario `admin`

Written against what the surface must *be*, not against its chrome:
the instrument-panel treatment is a slice of its own, and steps pinned
to today's ornament would be falsified by the work they are meant to
accept.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A8.1 | Open `admin.html` and look at it beside `submit.html` | It is unmistakably a different kind of surface — dense, instrument-like, obviously the place the site is operated from | #68. A member page and an admin page that read alike is how somebody operates the site by accident |
| A8.2 | Reach it on a **member** session | Refused, **with a message saying an admin session is needed** | A member reaching the admin surface is the failure; a blank page is a bad way to say so |
| A8.3 | Delete a row | It disappears from the table | Step 7's behavior |
| A8.4 | **Immediately press Publish, then read the published document** | The deleted row's data is **not** in it | The sharp hazard: a deleted row surviving in derived state is resurrected by the next Publish |
| A8.5 | Read the member's own count afterwards | It agrees with the table | Counts and the table disagreeing is what the member panel is measured on |
| A8.6 | Press **Unpublish** with the key field empty | It works | It needs the session, not the key — and submissions are left untouched |

### A9 · Site content and its fallback — scenario `config-fallback`

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A9.1 | Edit a piece of site copy through the admin surface | The page reflects it | #87. Copy that only an agent can change is copy that never changes |
| A9.2 | Remove the override again | The **shipped copy** comes back, intact | The fallback is what stops an empty configuration row from publishing a blank page |
| A9.3 | Drive the site with the configuration unreachable | Every page still reads correctly, on the shipped copy | The site must not depend on a route answering to be readable |
| A9.4 | Check that no edited copy has become a second home for a fact | Content is wording, never a claim stated in full only here | One home per fact, and an admin-editable second copy is the one nobody corrects |

### A10 · Progress — the dashboard payoff — scenario `member`

> `member` is the scenario that stages a **rich** published snapshot:
> several repeat submitters above the five-person floor, and series with
> enough points to draw. `suppressed` is its sparse counterpart and is
> what A11 uses. Driving A10 on the sparse one produces an empty
> dashboard that looks like a failure and is not.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A10.1 | Open `dashboard.html` with nothing published | "No figures have been published yet" — a first-publication message | This must be **distinguishable** from being signed out |
| A10.2 | Clear the session and reload | Sent to sign-in, **not** the "nothing published" message | A member told "nothing published" because their session expired learns something false |
| A10.3 | With figures published, open it again | The combined-weight hero reads first, before any chart | It is the number the group actually came for |
| A10.4 | Read the movement under the hero | Either a signed figure against a stated earlier date, or a line saying too few entries have moved since that date to say by how much. **A blank is a failure** | A delta with no baseline named is decoration, and a blank where a group has plainly changed reads as "nothing moved" |
| A10.5 | Read the marquee series | It draws, and it is legible on all four palettes | The one chart worth the space |
| A10.6 | Read how old the figures are | Stated on the page | Figures with no date are trusted longer than they deserve |
| A10.7 | Look for any handle, any individual row, anywhere on the page | **None** | Members see totals; the corpus is the keyholder's |

### A11 · Privacy — scenario `suppressed`

The checks whose failure is not visible from the page. **A failure here
stops the cutover** — these are the claims the project makes to the
people whose data it holds.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A11.1 | Read the raw published document — the "Show what would be sent" button prints it | **No handles. No individual rows.** Counts, medians and bins only | The entire published-data claim |
| A11.2 | Look for the height-discrepancy panel in it | **Absent.** It is a tool for the keyholder | Published, it would be a list of strangers' heights |
| A11.3 | With fewer than five repeat submitters, tick the weight series and publish | **No series is published at all** | A chart of one line is a chart of one person (#19) |
| A11.4 | With five or more, publish twice and compare | Points carry a **date**, not an instant, and weights sit on bin edges | Rounding is what makes following one person across snapshots an inference rather than a lookup |
| A11.5 | Read the series labels | "Person 1", never a handle | A stable label across snapshots would rebuild the thing the rounding removed |
| A11.6 | On every page: devtools → Application → both storages | The session is in `sessionStorage`, never `localStorage`; only the prefill is in `localStorage` | A credential outliving the tab is a different exposure |
| A11.7 | Publish, have **one** member submit, publish again, and read the raw document | The movement figures are **absent from the JSON**, not merely undrawn — and the page says too few entries have moved | A combined weight is a group figure; its delta can be one person's gain, and the served body is readable by anybody holding a member session |

> **When a privacy check reads "absent", confirm the thing would
> otherwise have been present.** A11.2's first run in the previous pass
> was recorded as passing while the corpus held no changed height — the
> panel was missing for lack of anything to say, not because it is
> excluded, so the check could not have failed. Seed a real discrepancy
> and repeat it. This is the trap that makes a whole privacy section
> worthless while reading green.

---

## Part A, live — against the development Worker

Everything above is staged and offline. These are the steps that need a
request to actually leave and be answered, and they are recorded
separately so a staged result is never mistaken for a live one.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| AL1 | Sign in through `POST /auth/dev` per A0, submit one entry | The row arrives and the count moves | The round trip the staged arm cannot make |
| AL2 | Read the numeric Telegram id line on `submit.html` | It is **hidden** — a development session has none | `POST /auth/dev` mints an account for a subject string rather than for a Telegram user, and "Your Telegram id:" followed by nothing reads as a broken page to somebody on their way to configure something |
| AL3 | Press **Sign out**, then confirm server-side that the session row is gone | It is | #90. The user-visible clear always succeeds; this is the half that closes the window a captured token would otherwise keep open |
| AL4 | Reuse the revoked token by hand against the endpoint | Refused | Otherwise the row survived to its natural expiry and Sign out hardened nothing |
| AL5 | Publish, then re-run A11.1 through A11.3 against what the Worker actually stored | Same answers | The staged document is built for the check; this one is not |

### What Part A cannot cover

State these as not performed rather than assuming them.

- **The Telegram widget's callback.** Narrower than it sounds, measured
  on loopback 2026-08-08: the policy admits `telegram-widget.js` from
  `telegram.org`, the `oauth.telegram.org` frame instantiates and
  paints, and no `securitypolicyviolation` fires. The widget then says
  **"Bot domain invalid"** — Telegram's own server refusing the origin,
  which is the domain binding and not the policy. So what remains
  unproven is only that the `potaetoe.github.io` binding yields a
  successful callback and a minted session. If the widget fails to
  render live after this, the policy is a **less** likely cause than it
  was.
- **A real numeric Telegram id**, and therefore the admin-bootstrap
  path end to end.
- **Anything about production data or secrets.**

---

## Part B — after the cutover, on the live site

Run in order; B1 gates the rest.

### B1 · The widget and a real sign-in

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| B1.1 | Open the live `index.html` | The cover opens and the Telegram widget **renders** | It cannot be tested anywhere else. If it does not, suspect the policy first |
| B1.2 | Watch the console while it loads | No `securitypolicyviolation` | The sign-in page's policy is in `DESIGN.md`, "The sign-in page and the CSP" |
| B1.3 | Sign in as yourself | A session is minted and you reach `submit.html` | |
| B1.4 | Read your numeric id on the page | It is shown, under **Entries** | #58 replaced digging it out of session storage by hand |
| B1.5 | If `TELEGRAM_GROUP_CHAT_ID` is set: have someone outside the group try | Refused | Otherwise anyone with a Telegram account can sign in |

### B2 · A real submission and a real export

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| B2.1 | Submit as yourself through the live form | The row arrives; the count moves | |
| B2.2 | Open the live `admin.html` on your admin session, provide the **production** key, decrypt | Your row decrypts | **The only check that proves the key, the admin id and the endpoint all reached production intact** |
| B2.3 | If B2.2 fails with "not authorized" | Your numeric id did not reach `ADMIN_TELEGRAM_IDS` | A wrong id there looks exactly like a working deployment until this moment |
| B2.4 | Press **Clear** before leaving the machine | The stored key is gone | Sign out does not do this, and B2.2 is the step that put it there |

### B3 · The live probe matrix

The matrix, and the commands, are in `OPERATIONS.md`, "Checking a
deployment". Two answers matter here: an unauthenticated `GET /snapshot`
returning **401** is the healthy one, and `POST /auth/dev` returning
**404** is what proves `DEV_LOGIN_SECRET` is absent from production. Its
presence would be a sign-in bypass.

### B4 · The fingerprint anchor

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| B4.1 | Compare `submit.html`'s fingerprint with the pinned group message | They **match** | A fingerprint disagreeing with the live site is the only alarm this mechanism can raise |
| B4.2 | If you rotated the key during the cutover | Update the pinned message **in the same sitting** | A stale anchor is worse than none: it teaches everybody to ignore the one alarm |

### B5 · The shell and the privacy checks, on live

A1 and A11.1 through A11.3 again, against the real corpus. The palettes
and the cover are worth re-driving because live serves different bytes
through a different cache, and A11.3's five-person floor behaves
differently with real data than with staged members.

---

## Recording the result

**The filled record goes on the issue, not into this file.** A result is
what one run found on one date, which AGENTS.md sends to issues and pull
requests; this document carries the script, which is corrected in place
as the product changes. Post the completed template as a comment on the
UAT issue and link it from the demo issue.

**A check you did not run is recorded as not performed, never omitted.**
That distinction is the whole value of the pass — and record which arm
each section was driven on, because a staged pass and a live pass are
different evidence.

```text
Part A staged, run on:     <date>   commit <full 40-char SHA>
  A1  shell and identity   …
  A2  signed out           …
  A3  your binder          …
  A4  prefill and #56      …
  A5  supersede            …
  A6  sign out             …
  A7  keyholder            …
  A8  admin                …
  A9  content and fallback …
  A10 progress             …
  A11 privacy              …
  Console clean of policy violations throughout:  <yes / what fired>

Part A live, run on:       <date>   against hgbinderworker-dev
  AL1 round trip           …
  AL2 development id line  …
  AL3 revocation           …
  AL4 revoked token        …
  AL5 privacy on stored    …

Part B, run on:            <date>   live
  B1 widget and sign-in    …
  B2 submission and export …
  B3 probe matrix          …
  B4 fingerprint           …
  B5 shell and privacy     …

Anything failed:           <what, and what you did>
Test data seeded:          <what, and confirm it was removed>
```

## If something fails

**In Part A, before the cutover:** good — that is the point, and it
costs a branch rather than the rows. Nothing has been deployed and
nothing is lost.

**In Part B, after `CUTOVER.md` step 4:** the rows are already gone, so
the question is never "roll back the data" — it is which of the two
deploys to put back. The Worker restores from step 0's capture; the
site restores with a `git revert`. Decide which is broken before
touching either.

**A failure in A11 or B5 stops the cutover.** Everything else is a bug
to fix; those are the claims the project makes to the people whose data
it holds.
