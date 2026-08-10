# UAT — accepting the redesigned binder

A pass for the owner, or any member they hand it to, to drive cold.
Every check names what to do, what passing looks like, and **why it
matters**, so a partial failure is a decision you can make rather than
a mystery.

The product this accepts is the accounts redesign as the site mockup
draws it: the wordmark set as **Hang Gang** in small gold capitals over
**Binder** in the italic serif; rail navigation on signed-in pages — a
column beside the page on a desktop, a strip across it when narrow —
with the session block under the destinations offering **Sign in**
whenever this tab holds no live session (#187, #166); a plain sign-in
page and a plain error page; the cover that opens once; a palette set
switched from one **Theme** control in the footer of every page but the
error page; and page titles that end **— Hang Gang Binder**, agreeing
with the rail (#191).

**The mockup is the bar.** The "Binder — Site Mockup (post-cutover)"
artifact, held by the owner, is what the shipped pages are accepted
against: where the site and the mockup disagree, the site is wrong,
**even where the site agrees with itself**. A shell that is internally
consistent in the wrong typeface passes every self-comparison and still
fails this pass. A1 is where that comparison is driven.

**Sections are keyed to the demo console's feature cards.** A section
that drives a card names it in the heading, exactly as the card titles
itself — `dev/demo.test.mjs` holds the two documents to the same set,
in both directions, so a renamed card and a stale section cannot
coexist quietly. The staging that used to be named by scenario id in
these headings is the console's plumbing now; press the card's button
and it is done for you. **A section with no card in its heading drives
nothing**, and says in its own words why: the surface it was written
for does not exist yet, and the rows are here so their absence is
something a driver reads rather than something they have to notice.

**Palettes are described by character here and never by chip label.**
The **Theme** control in front of you is the list, and counting the
chips against it is what catches one going missing — a step naming a
chip works from a list written down elsewhere, which lets a driver
record a pass for a palette they never opened and goes stale the day a
fifth palette ships. What the gate settles is that the four pages agree
about the labels; what it cannot settle is that a chip repaints the
page, so pressing every one of them is the part worth driving.

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

Then <http://127.0.0.1:8126/dev/demo.html> — the console. Under **What
the Binder does** is one card per feature; each section below names its
card in the heading. Press the card's button and the console stages
everything that feature needs — the session this tab should hold, the
figures the charts draw — and opens the right page in the frame.
Above the frame, the feed narrates what actually happened — the
press's own staging first, then a line for each answer the stubbed
Worker gives as the page asks — and the pointer under it names the
one thing to try in the frame next.
**Go anywhere** keeps every page reachable regardless of what you
pressed last, **Reset the demo state** puts the current card's world
back how its button starts it, and the frame-size buttons show the
narrow layout without pretending to be a phone.

**The pages in the frame are the shipped pages, mirrored off disk.**
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

**Names.** Each destination is addressed by file name, with the label it
carries beside it: `index.html` (**Sign in**), `your-page.html` (**Your
page**), `charts.html` (**Muse's charts**), `admin.html` (**Admin**).
The file name is the address because the label is part of what several
of these steps are checking, and a step cannot be addressed by the thing
it is testing. Since #179 the two agree, so a step that sends you to
`charts.html` and finds a rail entry reading anything but **Muse's
charts** has found a defect rather than a naming gap.

### A1 · The shell, held to the mockup — every card

The redesign's own surface, driven with the mockup open beside it.
Everything here is visible without a request, so it is the cheapest
section and the one that fails first. Any card's button stages it;
start from **Sign in with Telegram**'s for the signed-out rows and
**Weigh in**'s for the railed ones.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A1.1 | Arrive signed out on `index.html` | The cover leaf paints closed and swings open once, revealing the wordmark | The one animation in the product; it is the first thing anyone sees |
| A1.2 | Reload with the browser window narrowed and widened | The cover opens once per load and never traps the page behind it | Its resting state is *open*, so every way the animation can fail leaves the sign-in reachable |
| A1.3 | Turn on the operating system's reduced-motion setting and reload | The binder is **already open** — no frame of the closed cover at all | At a shortened duration the first frame still paints, and a full-screen flash is the exact thing that setting asks not to be given |
| A1.4 | Read the wordmark against the mockup | Two lines: **Hang Gang** small, uppercase, letter-spaced, in the gold accent and the monospace face; **Binder** under it in the italic serif and the rose accent. A plain default serif or a single-line wordmark is a failure | The wordmark is the identity, and it is the first place a font that did not load shows |
| A1.5 | Confirm `index.html` and `404.html` carry **no rail** | Both are plain, with a single way onward | The owner's decision: no rail before sign-in, and an error page goes plain on principle |
| A1.6 | Signed in, open `your-page.html`, `charts.html` and `admin.html` | All three carry the same rail — three destinations in the same order, and the session block under them: your name and **Sign out** while the session lives, **Sign in** when this tab holds none (#187) | Three hand-written copies; a rail that differs per page is how somebody gets stranded, and the door lives beside the words that say whether you need it |
| A1.7 | On each, check which destination is marked current | The one you are on, and only it | The rail is also the answer to "where am I" |
| A1.8 | Find the **Theme** control | In the **page footer**, on every page but `404.html` — including signed-out on `index.html` | #187 moved the picker out of the rail: the palette belongs to the reader, not to the session, and the footer is the one place every page shares |
| A1.9 | Open **Theme** and press **every chip it offers, in turn** — the control is the list, and working from a remembered set of names instead is how a palette goes undriven | Each one repaints the whole page, the control marks which is active, and the choice survives a reload | A preference that does not persist is not a preference. Counting the chips against the control rather than against a list written here is also what catches one going missing |
| A1.10 | On the **high-contrast** palette — the one the site applies when the operating system asks for increased contrast — read a card, a muted line and a link | All legible, nothing washed out | It exists for readers who need it, so "looks fine to me" is not the test. Identified by what it does, because that is the part of it that will not be renamed |
| A1.11 | With no palette ever chosen, load the site with the operating system set to light, then to dark, then to increased contrast | The site answers each system setting without a script running, and a chosen palette still beats all three afterwards | What answers a visitor who never opens the control is the pre-paint and the stylesheet's own media blocks, which is also all `404.html` has — it carries no chips at all |
| A1.12 | **On `admin.html`** — narrow to a phone width, then widen back up through a tablet width until the rail returns | The rail becomes a strip **that reaches both edges** at every one of those widths, all three destinations stay in flow, and the page never scrolls sideways | The destinations are what somebody needs, and they are what stays. Driven on any other page this step passes without asking the question: `admin.html` is the only one carrying a control whose intrinsic width refuses to shrink — the key file picker — so a shell rule that sizes the column to its content instead of to the screen shows up there and nowhere else (#148) |
| A1.13 | **At every width, on each page that offers one** — open the **Theme** disclosure, then press Escape | The chips appear in place and push what is below them down, nothing floats over the page, and Escape closes them and returns focus to the button | Focus left inside something no longer on screen restarts the next Tab from the top. It is one control with one behavior at every width (#150), so a pass at one width is not a pass |
| A1.14 | Prove the fonts **paint** rather than fall back — in the console, `await document.fonts.load('600 1rem "DM Sans"')`, then `document.fonts.check('600 1rem "DM Sans"')`; repeat for `Playfair Display` and `JetBrains Mono` | `true` for each | **`check()` alone is misleading.** A face the page has not needed yet reports `false` for being unloaded, not for being missing — loading it first is what makes the answer mean anything |
| A1.15 | Read the browser tab on every page | Every title ends **— Hang Gang Binder**, and the page's own name is the same words the rail uses | One name per destination; a tab disagreeing with the nav is #127's whole complaint, and #191 settled the set |
| A1.16 | Put the mockup beside each of the five pages and read them together | Same faces, same accents, same rail geometry, same footer, same names. Anything the mockup draws that the site does not do — or does differently — is recorded as a failure here, not explained away | The mockup is the ruling. This row is what makes drift from it a defect rather than a taste |

### A2 · Signed out, nothing is reachable — card "Sign in with Telegram"

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A2.1 | Open `your-page.html` | Sent to `index.html`; the form never paints | A usable-looking form whose request would be refused wastes a submitter's typing |
| A2.2 | Open `charts.html` | Sent to sign-in; no figures | Members-only since 2026-08-05 |
| A2.3 | Open `admin.html` | Sent to sign-in; no key box, no rows | The admin page has no typed-token path any more |
| A2.4 | Watch the network panel on all three | **No request** went out at all | Refusing before asking is the property; a request that earns a 401 has still announced you |
| A2.5 | Open `404.html` | An error page that says so plainly and offers one way back | Reached by strangers and by mistyped links, so it must not look broken |
| A2.6 | Press the Telegram button — in the demo it is a local stand-in; everything after the press is the shipped code | You land on **Your page**, signed in | The entrance is one press, and the press is where the demo's substitution ends |

### A3 · Your page — card "Weigh in"

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A3.1 | Land on `your-page.html` | Two tabs, **On record** showing, and the rail carrying your name and a **Sign out** | The session has one home on every page rather than one page |
| A3.2 | Read the entry count | It matches what is actually stored for you | The count comes from `GET /me` and nothing else; this is the acceptance criterion |
| A3.3 | On a member with nothing stored, read the "last submitted" line | Something honest — "No entries yet" — never "Invalid Date" | A brand-new member is the most common first view of this page |
| A3.4 | Switch between **On record** and **Weigh in**, repeatedly | **Exactly one** pane visible at a time, never both, never neither | `[hidden]` losing to `display: flex` has shipped here before |
| A3.5 | Fill the form and submit | It is accepted, and the feed above the frame names the store. **The count does not move here, and that is not the failure** — the stubbed Worker answers `/me` with a fixed corpus, so this arm cannot show the re-read. **AL6 is where the count moving is accepted**; recording A3.5 as proof that it moves is the vacuous pass this document warns about | The staged arm proves the form seals and sends; only a real store can prove the panel re-reads `/me` rather than incrementing a guess |
| A3.6 | Return to **Weigh in** after a submission | The form is back, with a note saying the earlier entry is kept | #64: before it, the received card replaced the form and never gave it back |
| A3.7 | Look for a handle field | **There is none.** The handle comes from the session | While it was typed, a member could store somebody else's handle beside their own account id |
| A3.8 | Read your numeric Telegram id under **On record** | It is shown | #58. Being made an admin needs that number, and a page that does not show it sends people to a third-party bot to ask for it |
| A3.9 | Read the key fingerprint on the page | 32 characters, matching the **development** public key in `config.js` | On anything but production it will not match the pinned group message, and that is expected |
| A3.10 | Under **On record**, find **Your entries, opened** and read what it says about the rows it could not open | Every row this browser cannot open is **counted and named** — "*n* sealed to a device this browser is not" — and the answer above it is not quietly computed over the rest. #85's personal pane. **The demo's rows are placeholder bytes sealed to nobody by design**, so what this arm accepts is that the pane reports its own blindness honestly; a pane that drew a confident answer over rows it never opened would pass a check written any other way | An answer computed over fewer rows than the member has is an answer they cannot tell from a correct one. Staged, this is the only half that can be driven — AL7 is the round trip |
| A3.11 | Ask the pane two different questions — change **About**, then **Measure** | The answer changes with them, and there is **no counting choice and no combining control** | It asks over one member's own rows with no five-person floor, because their own data is theirs; the levers that exist to keep a coarsening above a floor would be ceremony over a safety property that is not in play, and offering them would teach the wrong model of what the floor is for |

### A4 · The device-local prefill — card "The form remembers you"

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A4.1 | Reload the page | The form comes back filled — **every field it remembers**, not just weight | The point of the feature — mostly so a height that never changes is not retyped |
| A4.2 | Read what the page says about the remembered values | It says they are kept **on this device only**, in words beside the form | #172. A member deserves to know where their measurements live before deciding to leave them there |
| A4.3 | Press **Sign out**, then sign back in | The fields are **empty** | A sign-out leaving body measurements on the device would be a lie |
| A4.4 | Fill the fields as one member, close the tab without signing out, open a new tab as a **different** member | The second member's form is **empty** | This is #56. The session dies with the tab and `localStorage` does not, so before the fix the second member saw the first one's measurements |
| A4.5 | With the second member signed in, look at `localStorage` in devtools | The first member's prefill entry is **gone**, not merely ignored | Data already on the device had to be erased, not just stopped from growing |
| A4.6 | Hand-edit the prefill entry to something malformed and reload | The page starts normally with empty fields and no error | Someone hand-editing storage, or an older format, must not produce a dead page |

### A5 · A correction, as the member reads it — card "Fix a mistake"

> **This section accepts the DISPLAY of a correction, never the act of
> making one.** No member-facing correction control ships: `form.js`
> never sends `supersedes`, and #84 is post-cutover. The card's button
> stages a member whose record was **already** corrected — four entries
> standing, two rows resting behind them — so every row below is read
> off a state the demo arrived in, and none of them can be recorded as
> acceptance that a correction can be *made*. Those rows are A12, and
> they are not drivable on either arm today. Recording A5 green while
> reading it as coverage of the act is the exact vacuous pass A11's own
> sidebar warns about, arriving through the one section built to look
> like it covers the act.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A5.1 | Press **See a corrected record**, then read **On record** | Two numbers, not one: the entries standing, and a separate line naming the rows resting behind them | The whole of #193. Six rows written and four claimed is what a member who corrected twice has, and one number cannot say it |
| A5.2 | Read the entry count itself | It counts **effective** entries — a correction replaced its row, it did not add one — **and the corrections line is beside it, accounting for the difference** | The count is what a member trusts. Without the second line the number simply shrinks, which reads as the correction having eaten an entry; a count that teaches a member their fix cost them a row teaches them not to fix things |
| A5.3 | Read the corrections line's wording | It names them as kept rather than erased, and the noun agrees with the number — "1 correction", never "1 corrections" | Storage is append-only on purpose, and a member deserves to be told that in their own words rather than in the column's. A number pasted into a sentence is the tell that nobody read it back |
| A5.4 | Press **Weigh in**'s button to reach a member who has corrected nothing, and look for the line | **It is absent**, not showing "0 corrections" | Most members on most days have corrected nothing, and a zero invites the question of what a correction is from the one person who has never made one |
| A5.5 | Watch the feed above the frame as the card stages | It reports the two numbers it just staged, and they are the two the panel then shows | The feed is computed from the staging rather than scripted (#212), so this is the one place the demo can be caught disagreeing with itself |

### A6 · Sign out ends the session — card "Signed out means signed out"

The card's button arrives one moment **after** a sign-out somewhere
else: this tab still holds a session the server has already revoked.
For the rows that begin from a live session, press **Open Your page**
on the Weigh in card first.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A6.1 | From a live session, press **Sign out** on `your-page.html` | Returned to `index.html`, and the session is gone from `sessionStorage` | The user-visible half, and it must always succeed |
| A6.2 | Repeat from `charts.html`, then from `admin.html` | Identical behavior from each | Sign out is on every railed page, so every page has to mean the same thing by it |
| A6.3 | On the card's own arrival — a revoked session — make the page request anything: reload, or switch panel tabs | It is refused, this tab drops its copy, and you are sent to sign in **in words, not a spinner** | Dropping this tab's copy of the token is not the end of a session — the row is. A token captured before sign-out opens nothing (#90) |
| A6.4 | Watch the rail as the session dies | The session block changes with it: your name goes, **Sign in** returns, without a reload | #166. A rail still offering Sign out for a session that no longer exists is a door painted on a wall |
| A6.5 | Read what the page says while the revoke is in flight | Nothing about the revoke | The act you performed is the local clear; a message about the other half would describe a sign-out that did not happen |

> **Sign out on `admin.html` ends the session and nothing else. The
> stored private key stays on the device, and Clear is the one lever
> that removes it.** This is deliberate, decided by the owner, and it is
> written here so it is not filed as a bug. #70 made the key persistent
> so that later exports need no file; sign out is about the session,
> which is tab-scoped anyway. The card on that page names Clear, and
> A7.5 is where you exercise it.

### A7 · The keyholder's key — card "The keyholder's desk"

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A7.1 | Open `admin.html` | It opens on the session. **No export-token box** | The page runs on the session now |
| A7.2 | Provide the private key and decrypt | Rows appear; CSV, Excel and JSON are all offered | The whole product |
| A7.3 | Leave and come back to the page | It decrypts again **without another paste or file** | The point of #70: a keyholder retyping a key on every visit ends up storing it somewhere worse |
| A7.4 | Read the "Before you close this" card | It says the page is the only place the submissions exist in the clear, and names **Clear** | The warning whose reader's next action depends on it |
| A7.5 | Press **Clear**, then reload | Both copies are gone — the decrypted rows and the stored key — and the page asks for the key again | "Press Clear before you leave this browser" is only true if Clear does that |
| A7.6 | Decrypt with the **wrong** key | Rows are **listed with their ids**, not silently skipped | The ordinary cause is a rotated key, not damage, and hiding them looks like data loss |
| A7.7 | Put a `=`-leading value in a text field, then export the CSV | The cell arrives with a **leading apostrophe** | Otherwise a spreadsheet runs it as a formula |
| A7.8 | Read the three download controls without pressing any | Three buttons of **one rank**, none of them filled or singled out | #174. They do the same thing to the same data, so ranking one makes the eye invent a difference that is not there — and `primary` on this page is reserved for the acts that change the world |
| A7.9 | Press one download, and read what the page says | It acknowledges **the press**, naming the format, and says it cannot know whether the file arrived. **Nothing claims the file was saved** | The one act on this page whose result lands somewhere the page cannot see. A timer that claimed arrival would be worse than no acknowledgement, which is at least honest about knowing nothing |
| A7.10 | Press a second download while the first is still lit, then wait out the acknowledgement | **Exactly one is lit at a time** — the second press takes the light from the first — and the lit state clears on its own afterwards | Three lit buttons say three files are in flight and cannot say which press produced which; the acknowledgement's whole job is telling one press from another at the moment the data is in the clear |

### A8 · Admin — card "The admin's panel"

Written against what the surface must *be*, not against its chrome:
the instrument-panel treatment is a slice of its own, and steps pinned
to today's ornament would be falsified by the work they are meant to
accept.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A8.1 | Open `admin.html` and look at it beside `your-page.html` | It is unmistakably a different kind of surface — dense, instrument-like, obviously the place the site is operated from | #68. A member page and an admin page that read alike is how somebody operates the site by accident |
| A8.2 | Reach it on a **member** session | Refused, **with a message saying an admin session is needed** | A member reaching the admin surface is the failure; a blank page is a bad way to say so |
| A8.3 | Delete a row | It disappears from the table | Step 7's behavior |
| A8.4 | **Immediately press Publish, then read the published document** | The deleted row's data is **not** in it | The sharp hazard: a deleted row surviving in derived state is resurrected by the next Publish |
| A8.5 | Read the member's own count afterwards | **Not drivable on this arm** — the stubbed Worker answers `/me` with a fixed corpus, so the count cannot move whatever the table does, and a driver reading "they agree" here has compared two constants. **AL8 is the row that accepts it.** Record A8.5 as not performed | Counts and the table disagreeing is what the member panel is measured on, and a staged agreement is not evidence of it |
| A8.6 | Press **Unpublish** with the key field empty | It works | It needs the session, not the key — and submissions are left untouched |
| A8.7 | With the page decrypted, stop touching it. In the console: `const t = Date.now; Date.now = () => t.call(Date) + 8*60*1000;` and wait a second | The warning card appears, counting **down from 2:00** to the second, and focus moves to **Stay on this page** | Ten minutes idle, two of them warning — the owner's numbers, ratified on #91. The page measures the clock rather than counting its own ticks, which is what makes this drivable in seconds and what makes a sleeping laptop wake up expired instead of rested |
| A8.8 | Press **Stay on this page**, then undo the console line | The warning goes at once, not at the next tick, and the page is still decrypted | A card that lingered after the press reads as a control that did not work |
| A8.9 | Re-arm it, push the offset past ten minutes, and watch both the page and the feed above the frame | The decrypted rows and the files built from them are **gone**, the key boxes are empty, you land on `index.html` signed out — and the feed shows a `DELETE /session` going out, so the credential is **revoked at the Worker** and not merely dropped in the tab | This is the page that holds every submitter's plaintext. The tab going quietly on working is the failure the whole timer exists to prevent, and a local clear alone would leave the captured-token window open that #90 closed |
| A8.10 | Confirm what A8.9 did **not** do — return and provide the key path again | The **stored private key is still there**: the page decrypts without another paste or file | The key is not authority. Nothing issued it and nothing can revoke it, so an idle timer that destroyed it would make walking away cost the keyholder their key — **Clear** stays the one lever that removes it (A7.5) |

### A9 · Site content and its fallback — card "Before anything is written"

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A9.1 | Edit a piece of site copy through the admin surface | The page reflects it | #87. Copy that only an agent can change is copy that never changes |
| A9.2 | Remove the override again | The **shipped copy** comes back, intact | The fallback is what stops an empty configuration row from publishing a blank page |
| A9.3 | Drive the site with the configuration unreachable | Every page still reads correctly, on the shipped copy | The site must not depend on a route answering to be readable |
| A9.4 | Check that no edited copy has become a second home for a fact | Content is wording, never a claim stated in full only here | One home per fact, and an admin-editable second copy is the one nobody corrects |

### A10 · The published figures — card "Muse's charts"

> **See the charts** stages a full corpus: several repeat submitters
> above the five-person floor, and series with enough points to draw.
> **See a thin week**, on the "Too few to show" card, is its sparse
> counterpart and is what A11 uses. Driving A10 on the thin week
> produces an empty charts page that looks like a failure and is not.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A10.1 | Open `charts.html` with nothing published | "No figures have been published yet" — a first-publication message | This must be **distinguishable** from being signed out |
| A10.2 | Clear the session and reload | Sent to sign-in, **not** the "nothing published" message | A member told "nothing published" because their session expired learns something false |
| A10.3 | With figures published, open it again | The combined-weight hero reads first, before any chart | It is the number the group actually came for |
| A10.4 | Read the movement under the hero | Either a signed figure against a stated earlier date, or a line saying too few entries have moved since that date to say by how much. **A blank is a failure** | A delta with no baseline named is decoration, and a blank where a group has plainly changed reads as "nothing moved" |
| A10.5 | Read the marquee series | It draws, and it is legible on all four palettes | The one chart worth the space |
| A10.6 | Read how old the figures are | Stated on the page | Figures with no date are trusted longer than they deserve |
| A10.7 | Look for any handle, any individual row, anywhere on the page | **None** | Members see totals; the corpus is the keyholder's |

### A11 · Privacy — card "Too few to show"

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
| A11.6 | On every page: devtools → Application → **Session storage, Local storage, and IndexedDB** | The session is in `sessionStorage` and **never** in `localStorage`. `localStorage` holds two things and both belong there: `hgb-submit-prefill`, the device-local entry prefill, and `hgb-palette`, the chosen theme — A1.9 writes the second one, so a sweep that expects an empty `localStorage` is failing a step earlier in this pass rather than finding an exposure | A credential outliving the tab is a different exposure. A row that would be red for a reason the pass itself caused is a row nobody trusts the third time |
| A11.7 | In the same panel, open **IndexedDB** and read what is there per page | Two databases, each on the one page that has any business holding it: `hgb-keyholder-key` on `admin.html` only, present **after** a key import and gone after **Clear** (A7.5); `hgb-member-key` on `your-page.html` only, and **gone after Sign out** (A4.3 already made you press it). Neither exists on `charts.html`, `index.html` or `404.html`; a key on any of those is a finding | Both key stores were added after this section was written and it never inspected them — a privacy sweep that reads two storages while the key material sits in a third is the sweep reporting on where it happened to look. The two lifetimes differ on purpose and the difference is the claim: the member's key dies with the session, the keyholder's outlives it and answers to **Clear** alone |
| A11.8 | Publish, have **one** member submit, publish again, and read the raw document | The movement figures are **absent from the JSON**, not merely undrawn — and the page says too few entries have moved | A combined weight is a group figure; its delta can be one person's gain, and the served body is readable by anybody holding a member session |

> **When a privacy check reads "absent", confirm the thing would
> otherwise have been present.** A11.2's first run in the previous pass
> was recorded as passing while the corpus held no changed height — the
> panel was missing for lack of anything to say, not because it is
> excluded, so the check could not have failed. Seed a real discrepancy
> and repeat it. This is the trap that makes a whole privacy section
> worthless while reading green.

### A12 · Making a correction — nothing to drive yet (#84)

**No card, deliberately.** Every other section names the demo card that
stages it; this one has nothing to stage because the surface does not
exist on either arm. It is a section rather than a line in the issue so
that the rows are *written down where a driver looks for them* — A5 is
the section a reader reaches for when they want this, and A5 accepts the
display instead. A pass that simply omits these leaves the reader to
notice an absence, which is the failure mode a document made of present
rows cannot report.

**Why nothing runs.** `form.js` never sends `supersedes`, so no member
can make a correction: the field exists on the wire and in the Worker,
and the control does not exist on the page. #84 is post-cutover, which
is a scheduling fact and lives on the issue rather than here.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A12.1 | Correct an existing entry rather than adding one | It is accepted as a correction | #84. Members mistype, and a product whose only remedy is "submit it again" turns one mistake into two rows |
| A12.2 | Try to correct the same entry twice | The second attempt is refused | A row is superseded once, which is what keeps "current" meaning the current rows |
| A12.3 | Try to correct an entry that is not yours | Refused | Otherwise a correction is a write into somebody else's history |
| A12.4 | Look at what the keyholder sees for that member | Both rows are present, and which supersedes which is legible | Storage is append-only on purpose; the correction is a pointer, not an erasure. This surface exists on neither arm today — it is the keyholder half of the same missing feature |

---

## Part A, live — against the development Worker

Everything above is staged and offline. These are the steps that need a
request to actually leave and be answered, and they are recorded
separately so a staged result is never mistaken for a live one.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| AL1 | Sign in through `POST /auth/dev` per A0, submit one entry | The row arrives and the count moves | The round trip the staged arm cannot make |
| AL2 | Read the numeric Telegram id line on `your-page.html` | It is **hidden** — a development session has none | `POST /auth/dev` mints an account for a subject string rather than for a Telegram user, and "Your Telegram id:" followed by nothing reads as a broken page to somebody on their way to configure something |
| AL3 | Press **Sign out**, then confirm server-side that the session row is gone | It is | #90. The user-visible clear always succeeds; this is the half that closes the window a captured token would otherwise keep open |
| AL4 | Reuse the revoked token by hand against the endpoint | Refused | Otherwise the row survived to its natural expiry and Sign out hardened nothing |
| AL5 | Publish, then re-run A11.1 through A11.3 against what the Worker actually stored | Same answers | The staged document is built for the check; this one is not |
| AL6 | Submit again and watch the entry count on `your-page.html` without reloading | It **moves on its own** | A3.5's other half, and it can only be driven here: the panel re-reads `/me` after a stored submission rather than incrementing a guess, and a stub answering with a fixed corpus cannot tell those two apart |
| AL7 | With a device key of your own, submit an entry, then open **Your entries, opened** | The row you just submitted **opens** — the pane draws an answer over it, and it is not in the sealed-elsewhere count | A3.10's round trip: #85's personal arm is a seal to two recipients and an open by the member's own key, and the staged arm proves neither half because its rows are sealed to nobody. Rows submitted before this browser had a key stay in the sealed count, which is the honest result and not a failure |
| AL8 | As an admin, delete one of `alice`'s rows, then read `alice`'s own count on `your-page.html` | It has moved, and it **agrees with the admin table** | A8.5's other half. Counts and the table disagreeing is what the member panel is measured on, and only a real store can make both numbers move from one act |

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
- **Making a correction**, on either arm — A12 says why, and it is not a
  gap in the pass but the absence of the surface.

---

## Part B — after the cutover, on the live site

Run in order; B1 gates the rest.

### B1 · The widget and a real sign-in

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| B1.1 | Open the live `index.html` | The cover opens and the Telegram widget **renders** | It cannot be tested anywhere else. If it does not, suspect the policy first |
| B1.2 | Watch the console while it loads | No `securitypolicyviolation` | The sign-in page's policy is in `DESIGN.md`, "The sign-in page and the CSP" |
| B1.3 | Sign in as yourself | A session is minted and you reach `your-page.html` | |
| B1.4 | Read your numeric id on the page | It is shown, under **On record** | #58 replaced digging it out of session storage by hand |
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
| B4.1 | Compare `your-page.html`'s fingerprint with the pinned group message | They **match** | A fingerprint disagreeing with the live site is the only alarm this mechanism can raise |
| B4.2 | If you rotated the key during the cutover | Update the pinned message **in the same sitting** | A stale anchor is worse than none: it teaches everybody to ignore the one alarm |

### B5 · The shell and the privacy checks, on live

A1 and A11.1 through A11.3 again, against the real corpus — including
A1.16's side-by-side with the mockup, because live serves different
bytes through a different cache, and A11.3's five-person floor behaves
differently with real data than with staged members.

---

## Recording the result

**The filled record goes on the issue, not into this file.** A result is
what one run found on one date, which AGENTS.md sends to issues and pull
requests; this document carries the script, which is corrected in place
as the product changes. Post the completed template as a comment on
**issue #126** — that issue is the home for every record — and link it
from the demo issue. The filled Part A in `archive/` is a record of a
different product against a script that no longer exists; read it as
history, never as a section already covered.

**A check you did not run is recorded as not performed, never omitted.**
That distinction is the whole value of the pass — and record which arm
each section was driven on, because a staged pass and a live pass are
different evidence.

```text
Part A staged, run on:     <date>   commit <full 40-char SHA>
  A1  shell against the mockup   …
  A2  sign in with Telegram      …
  A3  weigh in                   …
  A4  the form remembers you     …
  A5  fix a mistake (display)    …
  A6  signed out means it        …
  A7  the keyholder's desk       …
  A8  the admin's panel          …
  A9  before anything is written …
  A10 Muse's charts              …
  A11 too few to show            …
  A12 making a correction        <expected: not performed, no surface>
  Console clean of policy violations throughout:  <yes / what fired>

Part A live, run on:       <date>   against hgbinderworker-dev
  AL1 round trip           …
  AL2 development id line  …
  AL3 revocation           …
  AL4 revoked token        …
  AL5 privacy on stored    …
  AL6 the count moves      …
  AL7 your own rows open   …
  AL8 delete reaches /me   …

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
