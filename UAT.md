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

- **The Telegram widget** — rendering, the callback, and the real CSP against
  `telegram.org`. Impossible on localhost.
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

```text
Part A, run on:            <date>   against hgbinderworker-dev
  A1 signed out            pass / fail / not performed
  A2 member panel          …
  A3 prefill and #56       …
  A4 dashboard             …
  A5 admin surface         …
  A6 privacy               …
  Console clean of CSP violations throughout:  yes / no
  Not covered here: the widget, a real numeric id

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
