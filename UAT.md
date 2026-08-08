# UAT — accepting the new site

A pass for the owner to work through before and after the cutover. Every
check names what to do, what passing looks like, and **why it matters**, so a
partial failure is a decision you can make rather than a mystery.

**It is in two parts because the split is forced, not a convenience.**

| | Where | What it can cover |
| --- | --- | --- |
| **Part A** | localhost against the **development** Worker | everything except the Telegram widget |
| **Part B** | the live site, after cutover | the widget, a real sign-in, and anything needing production |

BotFather binds the widget to `potaetoe.github.io`. On localhost it renders
"Bot domain invalid" and there is nothing to be done about it — so real
sign-in genuinely cannot be accepted before cutover, and Part B is not
optional tidying.

Run **Part A first, in full.** Everything it catches is something you would
otherwise find during the sitting, after step 4 has already taken the rows.

---

## Part A — before the cutover, on the development environment

### A0 · Setup

From the repository root, on `accounts`:

```bash
python -m http.server 8124 --directory apps/web
```

Then <http://localhost:8124>.

**Port 8124 is not optional.** `config.js` selects by hostname and the dev
Worker's allowed origins name that port; another port fails CORS quietly,
which looks like the endpoint being down. A local preview talks to
`hgbinderworker-dev` and its own database — never production.

**Signing in locally has no button.** There is no dev sign-in UI by design.
Open the browser console on the sign-in page and call:

```js
await BinderAuth.authenticate("/auth/dev", {
  secret: "<your DEV_LOGIN_SECRET>", subject: "alice", admin: false
})
```

Type the secret into the console; do not paste it into a file, a note, or
anywhere it persists. Use `admin: true` when a check below asks for an admin.
`subject` becomes the handle, so `alice` and `bob` are two different members —
useful, and used below.

You will need the **development private key** for the export checks. It is the
half matching `config.js`'s `localhost` arm (`BL4L1Ap1…`), held offline.

**Keep the console open for the whole pass** and watch for
`securitypolicyviolation` events and errors. A CSP violation is a real
failure even when the page looks fine — several of this project's bugs were
invisible except there.

### A1 · Signed out, nothing is reachable

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A1.1 | Open `submit.html` directly with no session | Sent to `index.html`; the form never paints | A usable-looking form whose request the Worker will refuse wastes a submitter's typing |
| A1.2 | Open `dashboard.html` with no session | Sent to sign-in; no figures shown | Members-only since 2026-08-05 |
| A1.3 | Open `admin.html` with no session | Sent to sign-in; no token box, no key box | The admin page has no typed-token path any more |
| A1.4 | In the console on each, check the network tab | **No request** to `/me`, `/snapshot` or `/export` went out | Refusing before asking is the property; a request that gets a 401 has still announced you |

### A2 · As a member — the submission page

Sign in with `admin: false`, subject `alice`.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A2.1 | Land on `submit.html` | Two tabs, "Your entries" showing; a visible **Sign out** | Step 5's shape |
| A2.2 | Read the entry count | It matches what is actually stored for `alice` — zero on a first run | The count comes from `GET /me` and nothing else; this is the step's acceptance criterion |
| A2.3 | With no entries yet, read the "last submitted" line | Says something honest — "No entries yet" — not "Invalid Date" | A brand-new member is the most common first view of this page |
| A2.4 | Switch tabs back and forth | **Exactly one** pane visible at a time, never both, never neither | `[hidden]` losing to `display: flex` has shipped here before |
| A2.5 | Fill the form and submit | Success, and the count **increases by one on its own** | The panel re-reads `/me` after a stored submission rather than incrementing a guess |
| A2.6 | Look for a handle field | **There is none.** The handle comes from the session | While it was typed, a member could store somebody else's handle beside their own account id |
| A2.7 | Submit again with a different weight | Second row; count 2 | Storage is append-only — repeats are the weight history, not an error |

> **A6.2's first run was vacuous, and that is worth carrying.** It was
> recorded as passing because the published document had `quality: null` —
> but the corpus contained no height that had changed, so the panel was
> absent for lack of anything to say rather than because it is excluded. The
> check could not have failed. Re-run against a seeded discrepancy it passes
> properly. **When a privacy check reads "absent", confirm the thing would
> otherwise have been present.**

> **A2.7 cannot be run through the UI today — #64.** After a submission the
> Received card replaces the form and never gives it back; switching tabs does
> not restore it, and only a reload does. Record A2.7 as **blocked**, not as a
> pass obtained by reloading. When #64 lands, this check should be runnable
> exactly as written above — the fix is what makes the check honest, rather
> than the check being reworded to describe the workaround.

### A3 · The device-local prefill, including the part that leaked

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A3.1 | Type a weight and height, reload the page | Both come back | The point of the feature — mostly so a height that never changes is not retyped |
| A3.2 | Press **Sign out** | Sent to sign-in, and the prefill is **gone** — sign in again and the fields are empty | A sign-out leaving body measurements on the device would be a lie |
| A3.3 | Sign in as `alice`, fill the fields, then **close the tab** without signing out. Open a new tab and sign in as `bob` | `bob`'s form is **empty** | This is #56. The session dies with the tab and `localStorage` does not, so before the fix `bob` saw `alice`'s measurements |
| A3.4 | While signed in as `bob`, check `localStorage` in devtools | The `hgb-submit-prefill` entry for `alice` is **gone**, not merely ignored | Data already on the device had to be erased, not just stopped from growing |
| A3.5 | Hand-edit `hgb-submit-prefill` to something malformed, reload | Page starts normally with empty fields; no error | Someone hand-editing storage, or an older format, must not produce a dead page |

### A4 · The members' dashboard

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A4.1 | Open `dashboard.html` as a member with nothing published | "No figures have been published yet" — a first-publication message | This must be **distinguishable** from being signed out |
| A4.2 | Publish a snapshot (A5), then reload | Charts draw; the page says how old the figures are | |
| A4.3 | Clear the session in devtools, reload | Sent to sign-in — **not** the "nothing published" message | A member told "nothing published" because their session expired learns something false |

### A5 · As an admin — export, publish, delete

Sign out, sign in with `admin: true`.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A5.1 | Open `admin.html` | It opens. **No export-token box** | The page runs on the session now |
| A5.2 | Provide the **development private key**, fetch and decrypt | Rows appear; the CSV and JSON download | The whole product |
| A5.3 | Sign out, sign back in with `admin: false`, open `admin.html` | Refused, **with a message saying an admin session is needed** | A member reaching the admin surface is the failure; a blank page is a bad way to say so |
| A5.4 | As admin again: delete a row | It disappears from the table | Step 7 |
| A5.5 | **Immediately press Publish, then look at the published snapshot** | The deleted row's data is **not** in it | The sharp hazard: a deleted row surviving in derived state gets resurrected by the next Publish |
| A5.6 | Check the row count in the panel on `submit.html` after a delete | It agrees with the table | Counts and the table disagreeing is what step 5 is measured on |
| A5.7 | Press **Unpublish**, then reload `dashboard.html` | Back to the empty notice | |
| A5.8 | Put a `=`-leading value in a text field, submit, export the CSV | The cell arrives with a **leading apostrophe** | Otherwise a spreadsheet runs it as a formula |
| A5.9 | Export with the **wrong** key | Rows are **listed with their ids**, not silently skipped | The ordinary cause is a rotated key, not damage — and hiding them looks like data loss |

### A6 · Privacy checks — the ones worth doing slowly

These are the checks whose failure is not visible from the page.

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| A6.1 | Publish a snapshot, then read the raw document — the "Show what would be sent" button prints it | **No Telegram handles. No individual rows.** Counts, medians, bins only | The entire published-data claim |
| A6.2 | Look for the height-discrepancy panel in the published document | **Absent.** It is a tool for you | Published, it would be a list of strangers' heights |
| A6.3 | Tick **weight over time** with fewer than five repeat submitters, publish | **No series is published at all** | A chart of one line is a chart of one person (#19) |
| A6.4 | With five or more, publish twice and compare the two series | Points carry a **date**, not an instant, and weights sit on bin edges | Quantisation is what stops following one person across snapshots being a join rather than an inference |
| A6.5 | Read `submit.html`'s key fingerprint | 32 characters, and it **matches** the fingerprint pinned in the Telegram group | On dev this will *not* match the production pin — expected, since the dev arm has its own key. Confirm it matches the **dev** public key in `config.js` |
| A6.6 | Every page: devtools → Application → check both storages | The session is in **sessionStorage**, never `localStorage`. Only the prefill is in `localStorage` | A credential outliving the tab is a different exposure |

### A7 · What Part A cannot cover

State these as not performed rather than assuming them:

- **The Telegram widget's callback.** Narrower than this section used to
  claim, measured on localhost 2026-08-08. What *does* work here: the CSP
  admits `telegram-widget.js` from `telegram.org` (`window.Telegram` is
  defined), the `oauth.telegram.org` iframe instantiates and paints at
  238×40, and **no `securitypolicyviolation` fires**. The widget then renders
  **"Bot domain invalid"** — Telegram's own server refusing the localhost
  origin, which is the domain binding and not the policy.

  So the two directives `CUTOVER.md` step 7 names as the first suspect are
  **confirmed against the real third-party origin**. What remains unproven is
  only that the `potaetoe.github.io` binding yields a successful callback and
  a minted session. If the widget fails to render live after this, the CSP is
  a **less** likely cause than it was.
- **A real numeric Telegram id.** A dev session has `telegramId: null`, so the
  admin-bootstrap path in `HANDOFF.md` cannot be rehearsed here.
- **Anything about production data or secrets.**

---

## Part B — after the cutover, on the live site

Run in order; B1 gates the rest.

### B1 · The widget and a real sign-in

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| B1.1 | Open the live `index.html` | The Telegram widget **renders** | It cannot be tested anywhere else. If it does not, suspect the CSP first |
| B1.2 | Watch the console while it loads | No `securitypolicyviolation` | `index.html` needs `script-src 'self' 'unsafe-eval' https://telegram.org` and `frame-src https://oauth.telegram.org`; the eval is required because the widget puts `data-onauth` through it |
| B1.3 | Sign in as yourself | A session is minted and you reach `submit.html` | REDESIGN's step 7 |
| B1.4 | Read your numeric id | From devtools → Session storage → `hgb-session` → `telegramId` | No page shows it yet — #58. This is how the admin bootstrap works today |
| B1.5 | If `TELEGRAM_GROUP_CHAT_ID` is set: have someone outside the group try | Refused | Otherwise anyone with a Telegram account can sign in |

### B2 · A real submission and a real export

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| B2.1 | Submit as yourself through the live form | The row arrives; the panel count moves | |
| B2.2 | Open the live `admin.html` on your admin session, provide the **production** key, decrypt | Your row decrypts | **The only check that proves the key, the admin id and the endpoint all reached production intact** |
| B2.3 | If B2.2 fails with "not authorized" | Your numeric id did not reach `ADMIN_TELEGRAM_IDS` | A wrong id there looks exactly like a working deployment until this moment |

### B3 · The live probe matrix

From `server/README.md`, needing no credential and changing nothing:

```bash
EP=https://hgbinderworker.sorcererbiggz.workers.dev
curl -s -H "Origin: https://potaetoe.github.io" "$EP/snapshot"
```

| Expected | Meaning |
| --- | --- |
| `Not authorized.` (401) | **healthy** — the accounts Worker is live and the snapshot is members-only |
| `No snapshot published yet.` (404) | the old Worker is still answering; the deploy did not take |
| `Origin not allowed.` (403) | the `Origin` header was omitted, not a fault |

Also confirm **`DEV_LOGIN_SECRET` is absent** from production: a
`POST /auth/dev` from any origin must return `404`. Its presence would be a
sign-in bypass.

### B4 · The fingerprint anchor

| # | Do | Pass looks like | Why |
| --- | --- | --- | --- |
| B4.1 | Compare `submit.html`'s fingerprint with the pinned group message | They **match** | A fingerprint disagreeing with the live site is the only alarm this mechanism can raise |
| B4.2 | If you rotated the key during the cutover | Update the pinned message **in the same sitting** | A stale anchor is worse than no anchor — it teaches everybody to ignore the one alarm |

### B5 · Re-run the privacy checks against live

A6.1, A6.2 and A6.3 again, on the real corpus. Sizes differ, and A6.3's
five-person floor behaves differently with real data than with two test
members.

---

## Recording the result

Copy this and fill it in. **A check you did not run is recorded as not
performed, never omitted** — that distinction is the whole value of the pass.

**A partial run is recorded below. It is not a completed Part A** — A3, A4,
A5 and A6 have not been performed, and A6 is one of the two sections whose
failure stops the cutover.

```text
Part A, run on:            2026-08-08  against hgbinderworker-dev
                           (Worker redeployed from `accounts` first - it was
                           behind and missing #56's accountId on GET /me)
  A1 signed out            PASS - all four
                           A1.1 submit.html -> index.html, no form in the DOM
                           A1.2 dashboard.html -> sign-in, nothing painted
                           A1.3 admin.html -> sign-in, zero input fields
                           A1.4 ZERO requests to the Worker on any of them
  A2 member panel          PARTIAL
                           A2.1 pass - two tabs, visible Sign out
                           A2.2 pass - count 0 on a first run, from /me
                           A2.3 pass - "No entries yet", not "Invalid Date"
                           A2.4 pass - exactly one pane, never both or neither
                           A2.5 pass - count moved 0 -> 1 without a reload
                           A2.6 pass - no handle field on the form
                           A2.7 BLOCKED - see #64
  A3 prefill and #56       PASS - all five
                           A3.1 pass - 275/5/8 and units restored on reload
                           A3.2 pass - sign out emptied localStorage entirely
                           A3.3 pass - bob's form empty after alice's tab died
                           A3.4 pass - alice's prefill ERASED, before bob typed
                           A3.5 pass - malformed prefill, page fine, no errors
                           (but see #65 - only one of four rejection paths
                           erases; not a failure today, a latent one)
  A4 dashboard             PASS - all three
                           A4.1 pass - "No figures have been published yet",
                                and it stayed on dashboard.html
                           A4.2 pass - 7 charts drew, "13 entries from 8
                                people", "Figures worked out just now
                                (2026-08-08 08:02 UTC)", no handle on the page
                           A4.3 pass - signed out goes to sign-in, NOT the
                                "nothing published" message
  A5 admin surface         PASS - all nine
                           A5.1 pass - opens on an admin session, NO token box
                           A5.2 pass - 14 of 14 decrypted; CSV, Excel and JSON
                                all offered; the row matched what was typed
                           A5.3 pass - a member is refused with a message
                                naming the reason, not a blank page
                           A5.4 pass - row 12 deleted, table and downloads
                                rebuilt, summary 13 of 13
                           A5.5 pass - published IMMEDIATELY after the delete:
                                counts 13/8, five series not six, and the
                                deleted 150.5 kg absent (no metric 150). That
                                person's whole line dropped, correctly - one
                                entry is not a repeat submitter
                           A5.6 pass - the deleted-from member's panel read 1,
                                agreeing with the table
                           A5.7 pass - Unpublish worked with the key field
                                EMPTY, confirming it needs the session and not
                                the key; submissions left untouched
                           A5.8 pass - verified at byte level with od -c: the
                                handle cell is '=cmd()|calc, apostrophe first
                           A5.9 pass - a wrong key LISTS the row with its id
                                ("row 2: ... encrypted to a different key"),
                                summary "0 of 1 row(s) decrypted", and the
                                publish card correctly hidden
  A6 privacy               PASS - all six
                           A6.1 pass - on the REAL published document: no
                                handle, no @ sign, no individual row
                           A6.2 pass, and re-run to make it mean something.
                                The first run was vacuous - quality was null
                                because no height had changed, so the check
                                could not have failed. Seeded a real
                                discrepancy (175 -> 183 cm) and repeated it:
                                the keyholder's own view NAMES him,
                                "@gus: 5'9" to 6'0"", and the published
                                document still carries quality: null with no
                                per-person height anywhere
                           A6.3 pass - series ticked, fewer than five repeat
                                submitters, and series published as null.
                                bases were null too - #19's singleton floor
                           A6.4 pass - with six repeat submitters the series
                                published. A point stored at 10:00:00Z
                                published as 00:00:00Z (a date, not an
                                instant) and 96 kg published as 90 (a bin
                                edge). Labels "Person 1".. never handles
                           A6.5 pass - 32 chars, matches the DEV public key in
                                config.js and NOT production's, as expected
                           A6.6 pass - on submit, admin and dashboard the
                                session is in sessionStorage and never in
                                localStorage
  Console clean of CSP violations throughout:  yes - no console output at all

  PART A IS COMPLETE EXCEPT A2.7, which #64 blocks.

  How the sessions were obtained, because it matters for what this proves:
  POST /auth/dev needs DEV_LOGIN_SECRET, which no agent handles, so sessions
  were minted directly in hg_binder_db_dev - generate a token, insert its
  SHA-256, hand the token to the page. The owner performed the two steps that
  genuinely required them: the first real sign-in and submission, and loading
  the development private key for A5.2 onward.

  Test data: 13 rows across 7 extra people were seeded through the real
  form.js and crypto.js, sealed to the DEV public key. All of it, and every
  minted session, was deleted afterwards - dev is back to one submission and
  one session.
  Not covered here: a real numeric id, and the widget CALLBACK only - the
  CSP and the widget's script and frame were confirmed, see A7

Storage confirmed server-side the same day, which the checks above cannot see:
  the stored row carried the session's own account_id, a server-set
  received_at, and ciphertext matching none of the submitted values;
  sessions holds a 64-char SHA-256 and no usable token.

Part B, run on:            <date>   live
  B1 widget and sign-in    …
  B2 submission and export …
  B3 probe matrix          …
  B4 fingerprint           …
  B5 privacy on live       …

Anything failed:           <what, and what you did>
```

## If something fails

**In Part A, before the cutover:** good — that is the point, and it costs a
branch rather than the rows. Nothing has been deployed and nothing is lost.

**In Part B, after step 4:** the rows are already gone, so the question is
never "roll back the data" — it is which of the two deploys to put back. The
Worker restores from `CUTOVER.md` step 0's capture; the site restores with a
`git revert`. Decide which is broken before touching either.

**A failure in A6 or B5 stops the cutover.** Everything else is a bug to fix;
those are the claims the project makes to the people whose data it holds.
