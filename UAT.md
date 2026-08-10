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
switched from the footer of every page but the error page — a **Theme**
disclosure whose panel floats on the signed-in pages, and a row of
always-visible swatches on the sign-in page; and page titles that end
**— Hang Gang Binder**, agreeing with the rail (#191).

**The mockup is the bar.** The "Binder — Site Mockup (post-cutover)"
artifact, held by the owner, is what the shipped pages are accepted
against: where the site and the mockup disagree, the site is wrong,
**even where the site agrees with itself**. A shell that is internally
consistent in the wrong typeface passes every self-comparison and still
fails this pass. A1 is where that comparison is driven.

**Sections are keyed to the demo console's journeys.** A section that
drives a stop names the journey and the stop number in its heading —
`dev/demo.test.mjs` holds every pointer to a journey and a stop that
exist, and holds every journey to being walked by some section, so a
renamed journey and a stale section cannot coexist quietly. Open the
journey, press Next to the stop named, and the console has staged
everything that step needs. **A section with no journey in its heading
drives nothing**, and says in its own words why: the surface it was
written for does not exist yet, and the rows are here so their absence
is something a driver reads rather than something they have to notice.

**This document and the console's narration are two voices, and they
stay two.** What you are reading is the driver's script: precise about
what passes, written for somebody deciding whether to accept the
product. The sentence the console reads out at each stop is the
member's, written for somebody being shown the product for the first
time (#192). They describe the same walk and neither is a copy of the
other, which is why the check between them holds that the pointers
resolve and never that the words agree.

**Palettes are described by character here and never by chip label.**
The palette control in front of you is the list, and counting its
buttons against it is what catches one going missing — a step naming a
palette works from a list written down elsewhere, which lets a driver
record a pass for one they never opened and goes stale the day a fifth
palette ships. What the gate settles is that the four pages agree about
the names; what it cannot settle is that a button repaints the page, so
pressing every one of them is the part worth driving.

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

Then <http://127.0.0.1:8126/dev/demo.html> — the console. It opens on
**Take a walk through the binder**: four journeys, each offering
**Walk this one**, with the number of stops on the button. Each section
below names the journey and the stop it drives. Walking a journey
stages everything each stop needs — the session this tab should hold,
the figures the charts draw, the throwaway key where a stop needs one —
opens the right page in the frame, and where the stop's words are about
one tab or one section of that page, opens that too.

While a walk is running the journey cards step aside for the walk
panel: the journey's name and **stop *n* of *m***, the stop's title,
its narration, and **Back**, **Next** and **Leave this walk**. Leaving
brings the four journeys back.

**The frame is behind glass while a journey is being read, and the last
stop of every journey hands it over.** That is deliberate: a walk whose
viewer has already clicked away is a walk being narrated over the wrong
page. The glass is over the frame and nothing else — every control in
the column beside it stays live at every stop. Where a section below
asks you to *do* something **in the frame**, it names the stop that
hands it over; where it needs a state no stop leaves live, it sends you
to **Free drive — every feature on its own card**, the disclosure under
the walk panel, whose cards stage one state at a time — including the
throwaway key, where the page a card opens asks for one — and never put
the glass on.

**What just happened**, the card under the journeys, is the console
saying what a press really did — the staging first, then a line for
each answer the stubbed Worker gives as the page asks. Under it is the
one thing to try in the frame next. **The address above the frame is
always the page the frame is really on**, including when a shipped page
redirects itself, so a readout disagreeing with what you can see is a
defect rather than the console lagging. **Go anywhere** keeps every
page reachable regardless of what you pressed last — including from
behind the glass — and marks which of the four the frame is on.
**Open this page in its own tab** takes whichever of the four
destinations the frame is showing out of the frame, which is the way to
read a page at the window's own width; on a page that is none of them it
says so and names the address to ask for by hand instead of opening
nothing. **Reset the demo state** puts the published snapshot and any
revocation back and stages the current stop again, so the frame is
showing the world the console has just claimed. **Desktop** and
**Phone** size the frame, which is a width and not a device.

**The pages in the frame are the shipped pages, mirrored off disk**, so
what you accept here is the same bytes the cutover publishes. That is
the entire reason the demo is worth driving rather than reading.

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
charts** has found a defect rather than a naming gap. In the demo the
label is what you press under **Go anywhere**, and the address above the
frame reads the tidied form the site serves — `/demo/your-page` for
`your-page.html`, the directory itself for `index.html`. `404.html` is
mirrored beside the other four but is not one of the destinations,
because nothing on a working site links to it: reach it by asking for
it by name under the same path the address readout shows.

### A1 · The shell, held to the mockup — every journey

The redesign's own surface, driven with the mockup open beside it.
Everything here is visible without a request, so it is the cheapest
section and the one that fails first. Every journey's every stop shows
the shell, so no row here needs a particular one — it needs one of two
states, signed out and railed, and most of these rows **press
something**, which the glass does not allow. So drive the section from
the free drive: **Arrive signed out** on the **Sign in with Telegram**
card gives you the sign-in page live, and **Open Your page** on the
**Weigh in** card gives you a railed one. **Your first weigh-in** stop
1 and stop 2 are the same two states to read rather than to press.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A1.1 | Arrive signed out on `index.html` | The cover leaf paints closed and swings open once, revealing the wordmark | The one animation in the product; it is the first thing anyone sees |
| A1.2 | Load the sign-in page again at both frame widths — **Desktop**, then **Phone** | The cover opens once per load and never traps the page behind it | Its resting state is *open*, so every way the animation can fail leaves the sign-in reachable |
| A1.3 | Turn on the operating system's reduced-motion setting and reload | The binder is **already open** — no frame of the closed cover at all | At a shortened duration the first frame still paints, and a full-screen flash is the exact thing that setting asks not to be given |
| A1.4 | Read the wordmark against the mockup | Two lines: **Hang Gang** small, uppercase, letter-spaced, in the gold accent and the monospace face; **Binder** under it in the italic serif and the rose accent. A plain default serif or a single-line wordmark is a failure | The wordmark is the identity, and it is the first place a font that did not load shows |
| A1.5 | Confirm `index.html` and `404.html` carry **no rail** | Both are plain, with a single way onward | The owner's decision: no rail before sign-in, and an error page goes plain on principle |
| A1.6 | Signed in, open `your-page.html`, `charts.html` and `admin.html` | All three carry the same rail — three destinations in the same order, and the session block under them: your name and **Sign out** while the session lives, **Sign in** when this tab holds none (#187) | Three hand-written copies; a rail that differs per page is how somebody gets stranded, and the door lives beside the words that say whether you need it |
| A1.7 | On each, check which destination is marked current | The one you are on, and only it | The rail is also the answer to "where am I" |
| A1.8 | Find the palette control | In the **page footer** on every page but `404.html`. On the three signed-in pages it is a **Theme** button that opens a panel; on `index.html`, signed out, it is a row of colored dots with nothing to open | #187 moved the picker out of the rail: the palette belongs to the reader, not to the session, and the footer is the one place every page shares. The sign-in page shows its dots outright because nothing there may ever be open over the Telegram widget |
| A1.9 | On each page, press **every palette the control offers, in turn** — the control is the list, and working from a remembered set of names instead is how a palette goes undriven | Each one repaints the whole page, the control marks which is active, and the choice survives a reload. On `index.html` each dot shows the palette it offers, so the row is four different pairs of colors and never four of the same | A preference that does not persist is not a preference. Counting the buttons against the control rather than against a list written here is also what catches one going missing, and a dot that stopped meaning its palette is the way this control goes quietly wrong |
| A1.10 | On the **high-contrast** palette — the one the site applies when the operating system asks for increased contrast — read a card, a muted line and a link | All legible, nothing washed out | It exists for readers who need it, so "looks fine to me" is not the test. Identified by what it does, because that is the part of it that will not be renamed |
| A1.11 | With no palette ever chosen, load the site with the operating system set to light, then to dark, then to increased contrast | The site answers each system setting without a script running, and a chosen palette still beats all three afterwards | What answers a visitor who never opens the control is the pre-paint and the stylesheet's own media blocks, which is also all `404.html` has — it carries no palette control at all |
| A1.12 | **On `admin.html`** — the frame offers two widths and this row needs the ones between, so **Open this page in its own tab** and drag the window narrow to a phone width, then wide again through a tablet width until the rail returns | The rail becomes a strip **that reaches both edges** at every one of those widths, all three destinations stay in flow, and the page never scrolls sideways | The destinations are what somebody needs, and they are what stays. Driven on any other page this step passes without asking the question: `admin.html` is the only one carrying a control whose intrinsic width refuses to shrink — the key file picker — so a shell rule that sizes the column to its content instead of to the screen shows up there and nowhere else (#148) |
| A1.13 | **On each signed-in page, at a wide width and a narrow one** — open **Theme**, and watch what is beside and below it while you do | The panel appears **over** the page and **nothing else moves**: no footer link shifts, no card reflows, the scroll position holds. It opens upward from the footer, and flips to open downward only where there is no room above | A control at the foot of a working page has to be free to reach for. A panel that displaced the layout would charge every reader for every glance at it, and the flip is what keeps it on screen when the footer is already near the top |
| A1.14 | With the panel open: press **Escape**; open it again and click **anywhere outside it**; open it again and pick a palette | Each of the three closes it, and after Escape and after the pick the focus ring is back on the **Theme** button | Focus left inside something no longer on screen restarts the next Tab from the top. A floating panel is the one that owes a reader these: something IS covered while it is open |
| A1.15 | Tab into the control with the keyboard alone — on a signed-in page and then on `index.html` | **Theme** takes focus with a visible ring, Enter or Space opens it, Tab walks the palettes inside; on `index.html` Tab walks the four dots directly and each shows a visible ring | The palette is a setting, and a setting only reachable with a mouse is one some readers do not have |
| A1.16 | **Block the page's scripts** and reload a signed-in page, then `index.html` | **Theme** still opens and closes, and the four dots are still on the sign-in page. Nothing repaints when pressed, which is expected — what matters is that the control is still there and still operable | The disclosure is an element, not a script, and the swatches are simply in the page. A palette control that vanishes with its script is one nobody can reach on the day it is needed most |
| A1.17 | Prove the fonts **paint** rather than fall back — in the console, `await document.fonts.load('600 1rem "DM Sans"')`, then `document.fonts.check('600 1rem "DM Sans"')`; repeat for `Playfair Display` and `JetBrains Mono` | `true` for each | **`check()` alone is misleading.** A face the page has not needed yet reports `false` for being unloaded, not for being missing — loading it first is what makes the answer mean anything |
| A1.18 | Read the browser tab on every page | Every title ends **— Hang Gang Binder**, and the page's own name is the same words the rail uses | One name per destination; a tab disagreeing with the nav is #127's whole complaint, and #191 settled the set |
| A1.19 | Put the mockup beside each of the five pages and read them together — **Open this page in its own tab** takes the four destinations out of the frame; `404.html` is none of them, so the button says so and names the address, which you then ask for by hand | Same faces, same accents, same rail geometry, same footer, same names. Anything the mockup draws that the site does not do — or does differently — is recorded as a failure here, not explained away | The mockup is the ruling. This row is what makes drift from it a defect rather than a taste. Read in the frame it is a page at somebody else's width, which is the one comparison that finds differences that are not there |

### A2 · Signed out, nothing is reachable — journey "Your first weigh-in", stop 1

The stop opens on `index.html` with no session. Rows A2.1 to A2.4 are
driven from there with **Go anywhere**, which stays live behind the
glass; A2.6 needs the frame, so it is driven from the **Sign in with
Telegram** card in the free drive.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A2.1 | Press **Your page** under **Go anywhere** | The frame lands back on the sign-in page; the form never paints | A usable-looking form whose request would be refused wastes a submitter's typing |
| A2.2 | Press **Muse's charts** | Back to sign-in; no figures | Members-only since 2026-08-05 |
| A2.3 | Press **Admin** | Back to sign-in; no key box, no rows | The admin page has no typed-token path any more |
| A2.4 | Repeat all three with the network panel open | **No request** went out at all | Refusing before asking is the property; a request that earns a 401 has still announced you |
| A2.5 | Open `404.html` | An error page that says so plainly and offers one way back | Reached by strangers and by mistyped links, so it must not look broken |
| A2.6 | In the free drive, press **Arrive signed out** on the **Sign in with Telegram** card, then press **Log in with Telegram** in the frame | You land on **Your page**, signed in | The entrance is one press. The button is the demo's local stand-in and everything after the press is the shipped code, so the press is where the substitution ends |

### A3 · Your page — journey "Your first weigh-in", stop 2

Stop 2 opens the page on **On record**, which is what most of this
section reads. Stop 3 is the same page with **Weigh in** opened for
you, and stop 7 hands the frame over — A3.4 to A3.6 are driven there.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A3.1 | Read the page the stop opens on | Two tabs, **On record** showing, and the rail carrying your name and a **Sign out** | The session has one home on every page rather than one page |
| A3.2 | Read the entry count | It matches what is actually stored for you | The count comes from `GET /me` and nothing else; this is the acceptance criterion |
| A3.3 | On a member with nothing stored, read the "last submitted" line | Something honest — "No entries yet" — never "Invalid Date" | A brand-new member is the most common first view of this page |
| A3.4 | At stop 7, switch between **On record** and **Weigh in**, repeatedly | **Exactly one** pane visible at a time, never both, never neither | `[hidden]` losing to `display: flex` has shipped here before |
| A3.5 | Fill the form and submit | It is accepted, and **What just happened** names the store. **The count does not move here, and that is not the failure** — the stubbed Worker answers `/me` with a fixed corpus, so this arm cannot show the re-read. **AL6 is where the count moving is accepted**; recording A3.5 as proof that it moves is the vacuous pass this document warns about | The staged arm proves the form seals and sends; only a real store can prove the panel re-reads `/me` rather than incrementing a guess |
| A3.6 | Return to **Weigh in** after a submission | The form is back, with a note saying the earlier entry is kept | #64: before it, the received card replaced the form and never gave it back |
| A3.7 | Look for a handle field | **There is none.** The handle comes from the session | While it was typed, a member could store somebody else's handle beside their own account id |
| A3.8 | Read your numeric Telegram id under **On record** | It is shown | #58. Being made an admin needs that number, and a page that does not show it sends people to a third-party bot to ask for it |
| A3.9 | Read the key fingerprint on the page | 32 characters, matching the **development** public key in `config.js` | On anything but production it will not match the pinned group message, and that is expected |
| A3.10 | Under **On record**, find **Your entries, opened** and read what it says about the rows it could not open | Every row this browser cannot open is **counted and named** — "*n* sealed to a device this browser is not" — and the answer above it is not quietly computed over the rest. #85's personal pane. **The demo's rows are placeholder bytes sealed to nobody by design**, so what this arm accepts is that the pane reports its own blindness honestly; a pane that drew a confident answer over rows it never opened would pass a check written any other way | An answer computed over fewer rows than the member has is an answer they cannot tell from a correct one. Staged, this is the only half that can be driven — AL7 is the round trip |
| A3.11 | Ask the pane two different questions — change **About**, then **Measure** | The answer changes with them, and there is **no counting choice and no combining control** | It asks over one member's own rows with no five-person floor, because their own data is theirs; the levers that exist to keep a coarsening above a floor would be ceremony over a safety property that is not in play, and offering them would teach the wrong model of what the floor is for |

### A4 · The device-local prefill — journey "Your first weigh-in", stop 4

The stop is the return visit: it arrives on **Weigh in** with the
remembered values already in the fields. Every row after the first
needs the frame, and no stop leaves this staging live — press **Return
to a filled form** on the **The form remembers you** card in the free
drive for those.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A4.1 | Read the form the stop opens | It is already filled — **every field it remembers**, not just weight | The point of the feature — mostly so a height that never changes is not retyped |
| A4.2 | Read what the page says above the form | It says the values are kept **on this browser** rather than on the account, and that signing out erases them | #172. A member deserves to know where their measurements live before deciding to leave them there |
| A4.3 | From the card, press **Sign out**, then arrive again | The fields are **empty** | A sign-out leaving body measurements on the device would be a lie |
| A4.4 | Fill the fields as one member, close the tab without signing out, open a new tab as a **different** member | The second member's form is **empty** | This is #56. The session dies with the tab and `localStorage` does not, so before the fix the second member saw the first one's measurements |
| A4.5 | With the second member signed in, read `hgb-submit-prefill` in devtools | The first member's prefill entry is **gone**, not merely ignored | Data already on the device had to be erased, not just stopped from growing |
| A4.6 | Hand-edit that entry to something malformed and reload | The page starts normally with empty fields and no error | Someone hand-editing storage, or an older format, must not produce a dead page |

### A5 · A correction, as the member reads it — journey "Your first weigh-in", stop 5

> **This section accepts the DISPLAY of a correction, never the act of
> making one.** No member-facing correction control ships: `form.js`
> never sends `supersedes`, and #84 is post-cutover. The stop stages a
> member whose record was **already** corrected — four entries
> standing, two rows resting behind them — so every row below is read
> off a state the demo arrived in, and none of them can be recorded as
> acceptance that a correction can be *made*. Those rows are A12, and
> they are not drivable on either arm today. Recording A5 green while
> reading it as coverage of the act is the exact vacuous pass A11's own
> sidebar warns about, arriving through the one section built to look
> like it covers the act.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A5.1 | Read **On record**, which the stop opens on | Two numbers, not one: the entries standing, and a separate line naming the rows resting behind them | The whole of #193. Six rows written and four claimed is what a member who corrected twice has, and one number cannot say it |
| A5.2 | Read the entry count itself | It counts **effective** entries — a correction replaced its row, it did not add one — **and the corrections line is beside it, accounting for the difference** | The count is what a member trusts. Without the second line the number simply shrinks, which reads as the correction having eaten an entry; a count that teaches a member their fix cost them a row teaches them not to fix things |
| A5.3 | Read the corrections line's wording | It names them as kept rather than erased, and the noun agrees with the number — "1 correction", never "1 corrections" | Storage is append-only on purpose, and a member deserves to be told that in their own words rather than in the column's. A number pasted into a sentence is the tell that nobody read it back |
| A5.4 | In the free drive, press **Open Your page** on the **Weigh in** card to reach a member who has corrected nothing, and look for the line | **It is absent**, not showing "0 corrections" | Most members on most days have corrected nothing, and a zero invites the question of what a correction is from the one person who has never made one |
| A5.5 | Read **What just happened** at this stop | It reports the two numbers the stop staged, and they are the two the panel then shows | Those lines are computed from the staging rather than scripted (#212), so this is the one place the demo can be caught disagreeing with itself |

### A6 · Sign out ends the session — journey "What the binder will not hand over", stop 1

The stop arrives one moment **after** a sign-out somewhere else: this
tab still holds a session the server has already revoked, and the page
it was sent to asks for something before you can touch anything, so the
refusal has already happened when the stop lands. For the rows that
begin from a *live* session, press **Open Your page** on the **Weigh
in** card in the free drive first.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A6.1 | From a live session, press **Sign out** on `your-page.html` | Returned to the sign-in page, and the session is gone from `sessionStorage` | The user-visible half, and it must always succeed |
| A6.2 | Repeat from `charts.html`, then from `admin.html` | Identical behavior from each | Sign out is on every railed page, so every page has to mean the same thing by it |
| A6.3 | At the stop, read the frame and **What just happened** together | The frame is on the sign-in page, and the feed carries the refusal that put it there — the request was refused, this tab dropped its copy, and you were sent to sign in **in words, not a spinner** | Dropping this tab's copy of the token is not the end of a session — the row is. A token captured before sign-out opens nothing (#90) |
| A6.4 | From a live session, press **Sign out** and watch the rail as the session dies | The session block changes with it: your name goes, **Sign in** returns, without a reload | #166. A rail still offering Sign out for a session that no longer exists is a door painted on a wall |
| A6.5 | Read what the page says while that revoke is in flight | Nothing about the revoke | The act you performed is the local clear; a message about the other half would describe a sign-out that did not happen |

> **Sign out on `admin.html` ends the session and nothing else. The
> stored private key stays on the device, and Clear is the one lever
> that removes it.** This is deliberate, decided by the owner, and it is
> written here so it is not filed as a bug. #70 made the key persistent
> so that later exports need no file; sign out is about the session,
> which is tab-scoped anyway. The card on that page names Clear, and
> A7.5 is where you exercise it.

### A7 · The keyholder's key — journey "The keyholder's desk", stop 2

Stop 2 puts the demo's throwaway key into the page's own key box, so
the headline act is performable by somebody who has never seen this
repository. The key is in the box at the last stop too, and that one
hands the frame over, so every act below is driven there.

**The demo's key is not the site's key, and the page says so.** It
opens this export and nothing else, and the page refuses to keep a key
that is not the private half of the one it encrypts to — so the two
rows about a key that survives the visit cannot be driven on this arm
and are marked accordingly.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A7.1 | Read the page the stop opens | It opens on the session. **No export-token box** | The page runs on the session now |
| A7.2 | At the last stop, press **Fetch and decrypt** — the key is already in the box | Rows appear, and **Download CSV**, **Download Excel** and **Download JSON** are all offered | The whole product |
| A7.3 | Leave and come back to the page | **Not drivable on this arm.** The page reports that the demo's key is not the one this site encrypts to and is **not kept on this device**, so there is nothing stored to come back to and the store stays empty. **B2.2 imports a real key and B2.4 is where keeping it is accepted.** Record A7.3 as not performed | The point of #70: a keyholder retyping a key on every visit ends up storing it somewhere worse. Only the site's own key exercises it, and a throwaway that opened the same door would be a key kept on the strength of nobody checking |
| A7.4 | Read the "Before you close this" card | It says the page is the only place the submissions exist in the clear, and names **Clear** | The warning whose reader's next action depends on it |
| A7.5 | Press **Clear** | The decrypted rows and the built files are gone and the page asks for a key again. The stored-key half of Clear rides on A7.3 and is accepted at B2.4 | "Press Clear before you leave this browser" is only true if Clear does that |
| A7.6 | Replace the box's contents with a **wrong** key and decrypt | Rows are **listed with their ids**, not silently skipped | The ordinary cause is a rotated key, not damage, and hiding them looks like data loss |
| A7.7 | Put a `=`-leading value in a text field, then export the CSV | **Not drivable on this arm.** The rows the stubbed export hands back are a fixed set, so a value submitted here never reaches them, and none of them leads with `=`. **AL1 puts a real value in and B2.2 is the export that carries it.** Record A7.7 as not performed. Live, the cell arrives with a **leading apostrophe** | Otherwise a spreadsheet runs it as a formula |
| A7.8 | Read the three download controls without pressing any | Three buttons of **one rank**, none of them filled or singled out | #174. They do the same thing to the same data, so ranking one makes the eye invent a difference that is not there — and the filled treatment on this page is reserved for the acts that change the world |
| A7.9 | Press one download, and read what the page says | It acknowledges **the press**, naming the format, and says it cannot know whether the file arrived. **Nothing claims the file was saved** | The one act on this page whose result lands somewhere the page cannot see. A timer that claimed arrival would be worse than no acknowledgement, which is at least honest about knowing nothing |
| A7.10 | Press a second download while the first is still lit, then wait out the acknowledgement | **Exactly one is lit at a time** — the second press takes the light from the first — and the lit state clears on its own afterwards | Three lit buttons say three files are in flight and cannot say which press produced which; the acknowledgement's whole job is telling one press from another at the moment the data is in the clear |

### A8 · Admin — journey "Running the gang", stop 1

Written against what the surface must *be*, not against its chrome:
the instrument-panel treatment is a slice of its own, and steps pinned
to today's ornament would be falsified by the work they are meant to
accept.

**Where each row is driven.** Stop 1 opens the surface behind glass,
publishing controls and all, and A8.1 is read there. Stop 5, **Now you
try**, hands the frame over — it is the only stop of this journey that
does — so A8.6 is pressed there. That hand-over also matters for the
clock: the console holds this page awake at every reading stop and
lets go at the last one, which is what makes the idle rows measure the
real thing rather than a page nobody is touching. The rows table, what
Publish sends and the idle warning all wait on a decrypt; two journeys
reach one, since this one's stops 1 and 5 stage the throwaway key and
press the page's own **Fetch and decrypt** for you as well. Drive A8.3,
A8.4 and A8.7 to A8.10 on **The keyholder's desk**, last stop, so those
five are read off one open surface rather than two. A8.2 needs a member
session on the admin page: press **Open
Your page** on the **Weigh in** card in the free drive, then **Admin**
under **Go anywhere**.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A8.1 | Look at the page this stop opens beside `your-page.html` | It is unmistakably a different kind of surface — dense, instrument-like, obviously the place the site is operated from | #68. A member page and an admin page that read alike is how somebody operates the site by accident |
| A8.2 | Reach it on a **member** session | Refused, **with a message saying an admin session is needed** | A member reaching the admin surface is the failure; a blank page is a bad way to say so |
| A8.3 | Delete a row from the decrypted table | It disappears from the table | Step 7's behavior |
| A8.4 | **Immediately press Publish, then press Show what would be sent and read it** | The deleted row's data is **not** in it | The sharp hazard: a deleted row surviving in derived state is resurrected by the next Publish |
| A8.5 | Read the member's own count afterwards | **Not drivable on this arm** — the stubbed Worker answers `/me` with a fixed corpus, so the count cannot move whatever the table does, and a driver reading "they agree" here has compared two constants. **AL8 is the row that accepts it.** Record A8.5 as not performed | Counts and the table disagreeing is what the member panel is measured on, and a staged agreement is not evidence of it |
| A8.6 | Press **Unpublish** with the key field empty | It works, and **What just happened** says the snapshot is taken down. What the charts then show is A10.1 | It needs the session, not the key — and submissions are left untouched |
| A8.7 | With the page decrypted, stop touching it. In the console: `let skip = 8*60*1000; const real = Date.now; Date.now = () => real.call(Date) + skip;` and wait a second | The warning card appears, counting **down from 2:00** to the second, and focus moves to **Stay on this page** | Ten minutes idle, two of them warning — the owner's numbers, ratified on #91. The page measures the clock rather than counting its own ticks, which is what makes this drivable in seconds and what makes a sleeping laptop wake up expired instead of rested |
| A8.8 | Press **Stay on this page**. **Leave the offset in place** — winding the clock back is read as expired, deliberately, so restoring `Date.now` now would end the session rather than the test | The warning goes at once, not at the next tick, and the page is still decrypted | A card that lingered after the press reads as a control that did not work. And a last-interaction time that is somehow ahead of now is not evidence somebody is here; it is the absence of it, which the page treats as expired on purpose |
| A8.9 | Push the offset past ten minutes from that press — `skip += 11*60*1000` — and watch both the page and **What just happened** | The decrypted rows and the files built from them are **gone**, the key boxes are empty, you land on the sign-in page signed out — and the feed shows a `DELETE /session` going out, so the credential is **revoked at the Worker** and not merely dropped in the tab | This is the page that holds every submitter's plaintext. The tab going quietly on working is the failure the whole timer exists to prevent, and a local clear alone would leave the captured-token window open that #90 closed |
| A8.10 | Confirm what A8.9 did **not** do — arrive on the admin page with a session again, and fetch | **Not drivable on this arm**, for A7.3's reason: the demo's key is never kept, so there is no stored key for the timer to have spared. **B2.4 is where the key outliving a visit is accepted.** Record A8.10 as not performed | The key is not authority. Nothing issued it and nothing can revoke it, so an idle timer that destroyed it would make walking away cost the keyholder their key — **Clear** stays the one lever that removes it (A7.5) |

### A9 · Site content and its fallback — journey "Running the gang", stop 3

**Only the fallback half of this section exists.** The stop stages a
binder nobody has written any copy into and opens **Muse's charts** on
it, which is A9.3 and is the row worth driving. No editing surface
ships — the admin page carries no content control, and the stop's own
narration says editing them is still being built — so A9.1 and A9.2
have nothing to press. #87 is post-cutover.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A9.1 | Edit a piece of site copy through the admin surface | **No surface, on either arm.** Record A9.1 as not performed | #87. Copy that only an agent can change is copy that never changes |
| A9.2 | Remove the override again | **No surface, on either arm** — there is nothing to override. Record A9.2 as not performed | The fallback is what stops an empty configuration row from publishing a blank page |
| A9.3 | Read the page this stop opens, then walk the rest with **Go anywhere** | Every page reads correctly on the shipped copy, with nothing blank and nothing announcing a missing configuration | The site must not depend on a route answering to be readable, and the first run is an ordinary day rather than an error |
| A9.4 | Read that shipped copy against the rest of this document | It is wording, never a claim stated in full only there | One home per fact, and copy that later becomes admin-editable is the second home nobody corrects |

### A10 · The published figures — journey "Your first weigh-in", stop 6

> This stop stages a full corpus: several repeat submitters above the
> five-person floor, and series with enough points to draw. **See a
> thin week**, on the "Too few to show" card, is its sparse counterpart
> and is what A11 uses. Driving A10 on the thin week produces an empty
> charts page that looks like a failure and is not.

The stop is the charts drawn on that corpus, and the rows that only
read them are driven there. A10.1, A10.2 and A10.5 press something, so
drive those from the free drive: A10.2 and A10.5 from **See the charts**
on the **Muse's charts** card, which stages the same corpus and leaves
the frame live, and A10.1 from the card its own row names.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A10.1 | Take the figures down and then open the charts — in the free drive press **Run the panel** on **The admin's panel** card, press **Unpublish** in the frame, then press **Muse's charts** under **Go anywhere** | The page reports that **nothing has been published** and draws no figures at all — not the staged corpus over again. **What just happened** carries the takedown and then the charts' own refusal. **Reset the demo state** puts the snapshot back | This must be **distinguishable** from being signed out |
| A10.2 | Press **Sign out**, then press **Muse's charts** under **Go anywhere** | Sent to sign-in, **not** a "nothing published" message | A member told "nothing published" because their session expired learns something false |
| A10.3 | With figures published, open it again | The combined-weight hero reads first, before any chart | It is the number the group actually came for |
| A10.4 | Read the movement under the hero | Either a signed figure against a stated earlier date, or a line saying too few entries have moved since that date to say by how much. **A blank is a failure** | A delta with no baseline named is decoration, and a blank where a group has plainly changed reads as "nothing moved" |
| A10.5 | Read the marquee series, then press each palette in turn under **Theme** | It draws, and it stays legible on every one of them | The one chart worth the space |
| A10.6 | Read how old the figures are | Stated on the page | Figures with no date are trusted longer than they deserve |
| A10.7 | Look for any handle, any individual row, anywhere on the page | **None** | Members see totals; the corpus is the keyholder's |

### A11 · Privacy — journey "What the binder will not hand over", stop 2

Everything here fails invisibly: nothing on the page looks wrong when
one of these breaks. **A failure here stops the cutover** — these are
the claims the project makes to the people whose data it holds.

**Where each row is driven.** This stop is the sparse corpus drawn on
`charts.html`, and it is where the held-back cells are read. The rows
that read the *raw published document* need the admin surface with the
export open: **The keyholder's desk**, last stop, **Fetch and decrypt**,
then **Show what would be sent**. The storage rows are driven in
devtools wherever you already are.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A11.1 | Press **Show what would be sent** and read what it prints | **No handles. No individual rows.** Counts, medians and bins only | The entire published-data claim |
| A11.2 | Look for the height-discrepancy panel in it | **Absent.** It is a tool for the keyholder | Published, it would be a list of strangers' heights |
| A11.3 | Read the charts this stop opens, with fewer than five repeat submitters behind them | Cells are **held back rather than drawn thin**, and the page says why. The raw document for this corpus is **not reachable on this arm** — the sparse staging carries a member session, so the admin surface cannot be opened on it, and **AL5 is where the stored document is read**. Record that half as not performed | A chart of one line is a chart of one person (#19) |
| A11.4 | With five or more, publish twice and compare the two documents | Points carry a **date**, not an instant, and weights sit on bin edges | Rounding is what makes following one person across snapshots an inference rather than a lookup |
| A11.5 | Read the series labels in it | "Person 1", never a handle | A stable label across snapshots would rebuild the thing the rounding removed |
| A11.6 | Devtools → Application → **Session storage** and **Local storage** | The session is in `sessionStorage` and **never** in `localStorage`. `localStorage` holds two things and both belong there: `hgb-submit-prefill`, the device-local entry prefill, and `hgb-palette`, the chosen theme — A1.9 writes the second one, so a sweep that expects an empty `localStorage` is failing a step earlier in this pass rather than finding an exposure | A credential outliving the tab is a different exposure. A row that would be red for a reason the pass itself caused is a row nobody trusts the third time |
| A11.7 | Devtools → **IndexedDB**, reading what each store **holds** rather than which store exists | Two databases, and each holds something only for as long as its page has business holding it: `hgb-member-key` carries the member's key while the session lives and is **empty after Sign out** (A4.3 already made you press it); `hgb-keyholder-key` is **empty on this arm** — nothing was kept, for A7.3's reason — and holds a key only after a real import, until **Clear** (A7.5, accepted at B2.4). A stored key that outlives the lever named for it is a finding | Both key stores were added after this section was written and it never inspected them — a privacy sweep that reads two storages while the key material sits in a third is the sweep reporting on where it happened to look. The panel is per origin and every page shares one, so which page has a database open says nothing; what each store *holds*, and when it empties, is the claim |
| A11.8 | Publish, have **one** member submit, publish again, and read the raw document | The movement figures are **absent from the JSON**, not merely undrawn — and the page says too few entries have moved. A submission on this arm never joins the export, so this is **AL5's row to close**; record what the staged document shows and mark the round trip not performed | A combined weight is a group figure; its delta can be one person's gain, and the served body is readable by anybody holding a member session |

> **When a privacy check reads "absent", confirm the thing would
> otherwise have been present.** A11.2's first run in the previous pass
> was recorded as passing while the corpus held no changed height — the
> panel was missing for lack of anything to say, not because it is
> excluded, so the check could not have failed. Seed a real discrepancy
> and repeat it. This is the trap that makes a whole privacy section
> worthless while reading green.

### A12 · Making a correction — nothing to drive yet (#84)

**No journey, deliberately.** Every other section names the journey stop
that stages it; this one has nothing to stage because the surface does
not exist on either arm. It is a section rather than a line in the issue so
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
A1.19's side-by-side with the mockup, because live serves different
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
  A2  signed out, nothing opens  …
  A3  your page                  …
  A4  the device-local prefill   …
  A5  a correction, displayed    …
  A6  sign out ends the session  …
  A7  the keyholder's key        …
  A8  admin                      …
  A9  site content and fallback  <expected: A9.1 and A9.2 not performed, no surface>
  A10 the published figures      …
  A11 privacy                    …
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
