# Hang Gang's Binder — design

A submission portal for one Telegram group. Members sign in with
Telegram and submit their stats; whoever holds the key reads them back.
Hosted on GitHub Pages, stored by a Cloudflare Worker that cannot read a
single row of what it holds.

This document records *why* the architecture is what it is, so the
reasoning survives the conversation it came from.

**The first version of this document opened with "no accounts for
submitters", and meant it.** That was reversed on 2026-08-05 — see
"Accounts" below, which records what forced it and what it cost. The
reversal is narrower than it sounds: an account establishes *who is
writing*, and changes nothing about who can *read*. Read access is still
a file rather than a login, and that is still the property the whole
design turns on.

---

## The constraint that shapes everything

GitHub Pages serves static files. There is no server, so there is no
place to keep a secret. Whatever the page needs in order to store a
submission is visible to anyone who opens View Source.

That rules out the obvious design — "the page writes to a database using
a key" — because the key is public, and a public write key on a plain
database is also a public *read* key sooner or later.

So the security does not come from hiding a credential. It comes from
the browser encrypting each submission before it leaves the page.

## The design

```
  member's browser             Cloudflare Worker + D1       keyholder's browser
  ────────────────             ──────────────────────       ───────────────────
  signs in with     ── HTTPS ─> verifies the payload
  Telegram                     against the bot token,
                               issues a session, and
                               keeps no handle

  fills the form               one row per submission:
  encrypts to the   ── HTTPS ─> an opaque base64 blob,  <──  fetches the rows
  keyholder's                  an account id, and a          decrypts with the
  PUBLIC key                   receipt timestamp             PRIVATE key, held
  (in the public repo)                                       only on this machine
                                                             exports CSV
```

Four properties fall out of this:

1. **The storage provider cannot read the data.** Cloudflare sees
   base64. A breach of the database, a leaked API token, a subpoena to
   Cloudflare — all yield ciphertext.
2. **The public key being public is fine.** That is what a public key is
   for. It encrypts; it cannot decrypt. Publishing it in the repo is not
   a leak.
3. **Read access is a file, not an account.** Which is what makes it
   transferable — see below. Sign-in did not change this and could not:
   an account authorises *writing*, and no flag in a database can hand
   anybody the ability to decrypt.
4. **The account id is not derived from anything about the person.** It
   is an HMAC of a Telegram numeric id under a secret only the Worker
   holds. Getting that wrong is the single most dangerous mistake
   available in this design, and "Accounts" below spends most of its
   length on why.

### Why not just a database with write-only rules

Rules that keep the public from *reading* would still leave the data
sitting in plaintext under someone's account. Transferring it would mean
transferring the account, and any misconfiguration would expose every
row at once. Encryption makes the storage layer untrusted by design,
which means picking one is a convenience decision rather than a security
decision — and a cheap one to revisit.

### Why a Cloudflare Worker + D1

The first version of this document chose Google Apps Script writing to a
Sheet. That was reconsidered on the grounds of not wanting the data in a
Google product, and the replacement turned out to be better on the
merits, not merely different:

- **It deletes the project's only open risk.** Apps Script cannot set
  its own response headers, so a readable reply depended on POSTing as
  `text/plain;charset=utf-8` and letting a redirect supply the CORS
  header. The entire first step of the build order existed to prove that
  hack worked. A Worker sets its own headers; there is nothing to prove.
- **Free at any volume this will ever see.** 100,000 Worker requests a
  day, and D1 allows 5 GB with 100,000 row-writes a day.
- **It does not pause.** This matters more than it sounds — see
  Supabase below.
- **One account, one deploy, no CLI required.** The Worker can be pasted
  into the dashboard editor.

The Worker is a single file: append a row on `POST`, return the rows on
a token-gated `GET`, and nothing else. It never decrypts and holds no
key.

#### What was rejected, and why

- **Google Apps Script + a Sheet.** Ruled out for being a Google
  product. It kept two genuine advantages worth naming, since losing
  them is the cost of this decision: the Sheet doubled as the export UI
  for a non-technical keyholder, and handing the storage to someone else
  was a Drive menu item. Both now need building or documenting instead.
- **Supabase.** Free projects pause after seven days without traffic,
  and a portal that sits quiet for a fortnight is exactly the case that
  breaks. The workaround is a keep-alive cron — a moving part whose
  failure is silent and whose consequence is a dead form.
- **Netlify Forms and the hosted form services.** They cap submissions
  per month and mean either moving the hosting or adding a third party
  with its own account to inherit.
- **No endpoint at all** — the page encrypts, the submitter pastes the
  blob to the keyholder on Telegram. Genuinely self-contained: no
  account, nothing to expire, nothing to transfer, and no spam surface,
  since a static page cannot receive a POST without something on the
  other end. Rejected for friction: it moves work onto every submitter
  and onto the keyholder, and a form people abandon collects nothing.
  Worth remembering as the fallback if the Worker ever becomes a burden.

### Encryption, concretely

Native WebCrypto. No library, no CDN, no vendored bundle.

Per submission: generate an ephemeral P-256 keypair, ECDH it against the
admin's public key, HKDF the shared secret into an AES-256-GCM key, and
send the ephemeral public key + IV + ciphertext. Standard ECIES, roughly
sixty lines, using only primitives the browser already ships.

The alternative was vendoring libsodium.js for `crypto_box_seal`, which
is the more foolproof primitive — one function call, no composition to
get wrong. It was rejected because it is ~200 KB of third-party code
that sees plaintext before encryption. A compromised or subtly wrong
copy defeats the entire design, and pulling it from a CDN would be worse
still: a supply-chain problem on the one script that handles cleartext.

Composing primitives by hand is the real cost of that choice. The
mitigation is the round-trip test in `dev/`, which is why that test is
built before the form rather than after it — a form that silently
produces undecryptable ciphertext is indistinguishable from a working
one until export day, and by then the data is gone.

#### How a submission is written down

One byte string, then standard base64: a format version byte, the
ephemeral public key as a raw point, the AES-GCM nonce, then ciphertext
and tag. The first three are passed to AES-GCM as additional data, so
none of them can be edited in the database without the tag failing.

Two choices in there are worth their reasons:

- **The version byte.** Rows outlive the code that wrote them. By the
  time anyone wants to change this format the database will hold blobs
  nobody can regenerate, so the alternative to a version byte is
  guessing from the length. One byte now buys a decoder that can read
  both later.
- **No HKDF salt.** A salt has to reach the other side, which here means
  carrying random bytes in every row to seed a derivation whose input is
  already a fresh ECDH secret per submission. The ephemeral key is
  doing that job. (An all-zero salt would be the same thing spelled
  longer — RFC 5869 defines an absent salt as a block of zeros.)

The label mixed into the derivation is part of the format, not a
comment. Changing it makes every stored row undecryptable, silently,
which is the case `dev/crypto.test.mjs` exists to catch — see the
fixture there.

#### How the key itself is written down

Three files have to agree about this — `keygen.html` writes it,
`config.js` carries it, `admin.html` reads it — so it is stated here
rather than inferred from whichever one someone opens first:

- **The public half is a raw uncompressed P-256 point, 65 bytes,
  standard base64.** One short string, because `config.js` is a file
  people hand-edit and a JWK there would be four lines of JSON to
  mangle. Imported with `importKey("raw", …)`.
- **The private half is a JWK**, inside an envelope carrying the curve,
  the date, the matching public key and a sentence saying what the file
  is. The envelope exists for the person who finds this file in three
  years and cannot remember what it opens. `admin.html` accepts the
  envelope or a bare JWK, because someone will eventually paste just the
  inner object.

The envelope repeating the public key is not redundancy for its own
sake: it is what lets a keyholder recover the `config.js` line from the
key file alone, without regenerating and invalidating everything already
submitted.

`crypto.subtle` requires a secure context. Confirmed available on the
deployed site and on `http://localhost`, which is why the README insists
on serving the directory rather than opening a page directly.

Whether a `file://` URL counts as a secure context is **not** confirmed
— browsers differ, and an earlier draft of this document asserted it did
not without checking. Nothing here depends on the answer, because
everything is served: the site over HTTPS, and the generator over
localhost. That is deliberate. A page that silently lacks `crypto.subtle`
looks identical to a working one right up until it produces nothing.

### Export

The admin signs in, supplies the private key, and gets a plaintext CSV
back. The page fetches the ciphertext from the Worker and decrypts it in
the browser; nothing is uploaded, and the private key never leaves the
page.

Until 2026-08-05 the first factor was an export token typed into a box.
It is now an admin session, for the reasons under "Admin accounts" — the
short version is that one shared bearer token can only be revoked for
everybody at once. `EXPORT_TOKEN` still exists as break-glass and is no
longer part of the ordinary path.

Losing the Sheet meant losing a native export button, so the endpoint
gains the read path the Sheet used to provide, gated on being an admin.
To be clear about what that gate is for: **it is not what keeps the data
confidential** — the rows are ciphertext whether or not the request is
authorised, and Cloudflare could read them as readily as Google could
have. It exists so the corpus is not casually harvestable and so bulk
reads are not anonymous. Confidentiality is the encryption's job, and
only the encryption's.

That is also why moving this gate from a shared token to a per-person
account was safe to do: changing who can fetch ciphertext cannot make
ciphertext more or less readable.

Access stays genuinely two-factor, which is the property worth keeping:

- an admin account gets you the ciphertext, and can be taken back
- the private key gets you the plaintext, and cannot

Neither alone is enough, and the two are held independently, which is
the same property that makes the handoff below work. Accounts sharpened
it rather than changing it: the revocable factor is now per person
instead of one secret shared by everyone who has it.

## Accounts

Decided 2026-08-05, reversing this document's opening sentence. Three
problems were open and all three had the same shape — *there is no way
to tell one submitter from another, or a submitter from anybody at all*:

- **Nothing stopped junk.** The endpoint accepted any POST that set an
  `Origin` header, which `curl` does for free. The section below called
  this operational and said nothing would be wired up until junk
  appeared — see "What is deliberately not here", now corrected. That
  posture assumed junk was recoverable. It was not: there was no delete
  path for a submission anywhere in the Worker or the pages, so clearing
  it meant the Cloudflare console and hand-typed SQL, which this
  document had already ruled out as *not a path* when the same gap was
  found in the snapshot.
- **Nobody could withdraw.** The person whose data it is had no route
  at all. This is the argument the keyholder had already won once about
  the published snapshot — it answered "change what is published" and
  ignored "take it down" — reappearing one level down, against the data
  that actually identifies people.
- **Nobody could correct anything.** Storage was append-only and blind,
  so a typo was permanent and a fresh reading was indistinguishable
  from one.

### The identifier is the whole problem

Everything else about accounts is ordinary work. The identifier is not,
and the obvious design is the dangerous one.

The obvious design is `account_id = SHA-256(handle)`, stored in the
clear beside the ciphertext. It is unique per person, survives
resubmission, and needs no new secret. It also destroys the property
this project exists for.

Telegram handles are not a large search space *in practice*. The
relevant ones are the few dozen names visible in the group's member
list, and hashing a few dozen strings is instant. A clear-text hashed
handle therefore turns the database into a **membership oracle**:
anybody holding it can answer "did @foo submit to this?" without
decrypting a single row.

That is exactly the scenario the threat model claims to cover. Today a
leaked export token yields ciphertext and nothing else. With hashed
handles it yields *the list of who is in the binder* — which, for a form
about feedism sitting next to real Telegram handles, is most of the harm
the encryption was there to prevent. It is the same harm as the
plaintext handle column this design refused at the very start, arriving
by a route that looks like a precaution.

A pepper does not save it. In `config.js` the pepper is public along
with everything else on a static site; moved to the Worker it means the
Worker receives the handle, which is the thing being avoided.

**Rejected: an oblivious PRF.** Getting a non-enumerable id *out of* a
handle without the server learning the handle is a solved problem —
RFC 9497, VOPRF over P-256 — and it is implementable here in the sense
that the primitives exist in WebCrypto. It is rejected for the same
reason vendoring libsodium was rejected, only more so: composing ECIES
by hand was about sixty lines with a round-trip test that can prove it
right, and a blinded PRF is neither. Named here so nobody arrives at it
later thinking it was never considered.

**Rejected: invite codes.** The keyholder generates random codes and
hands them out in Telegram; the code is the account. This works, and it
is the smaller build — no third party, no script anywhere near the
cleartext page, no CSP change, and the Worker learns nothing about
anyone. It lost on two counts. A code is a bearer credential people
paste into group chats and lose, and reissuing one is manual work for
the keyholder forever. And it verifies nothing: it proves somebody was
invited, not that the handle they typed is theirs.

### Telegram is the identity provider

The account id is `HMAC-SHA256(ACCOUNT_SECRET, telegram_numeric_id)`,
computed by the Worker, stored in the clear beside the ciphertext.

The numeric id rather than the handle, because handles are changeable
and the numeric id is not — an account should survive somebody renaming
themselves. The HMAC rather than the raw id, and the secret rather than
a constant, because that is what makes the oracle above impossible: an
attacker holding the whole database cannot test a guess without a secret
that lives only in the Worker's environment.

**`ACCOUNT_SECRET` is load-bearing forever.** Change it and every
account id changes, every member's history detaches from them, and there
is no way back — the rows are still readable, but nothing links a
person's four entries to each other. It belongs in the same mental
category as `crypto.js`'s derivation label: a value that looks like
configuration and is actually part of the stored format.

This buys something the old form could not have: **the handle stops
being typed.** The Worker hands the verified username back to the
authenticated browser, which puts it in the record before encrypting.

**It does not make the handle trustworthy, and the difference matters.**
The record is built and sealed in the member's own browser, so a member
who edits their own page can put any handle they like inside the
ciphertext, and the Worker — which cannot read it — has no way to
object. What the Worker *does* control absolutely is the account id: it
is derived from the verified session and no client can influence it.

So a row has two identities, and they are not equally good:

- **The account id is trustworthy.** It is set server-side from a
  Telegram sign-in and cannot be forged by the page.
- **The handle inside the blob is a label.** It is as good as the client
  that wrote it, which for everybody who is not attacking their own
  browser is very good, and for anybody who is, is worthless.

The keyholder should treat the account id as identity and the handle as
display. The useful consequence is that **the two disagreeing is
detectable**: two different handles appearing under one account id is
either a rename or somebody lying, and it is exactly the shape of the
existing height-mismatch panel. Worth building for the same reason that
one exists — it is a fact about the data the keyholder wants before
trusting a name.

What sign-in genuinely closed is anonymous writing. What it narrowed,
rather than closed, is "not protected against: a submitter lying".

### The sign-in page is a page of its own

The Telegram Login Widget is third-party script from `telegram.org`. On
the page that handles cleartext that is precisely the risk this document
rejected a CDN copy of libsodium for, and it would mean opening
`script-src` on the one page where it matters most.

So sign-in is `index.html` and nothing else: the widget, and no
`crypto.js`, no form, no plaintext of any kind. The form moves to its
own page. `index.html`'s policy carries the two exceptions the widget
needs — `script-src https://telegram.org` and
`frame-src https://oauth.telegram.org` — and no other page gains
either.

**This reverses "the form grew into `index.html` rather than being
copied from it".** That decision was right when a landing page's only
content would have been a link to the form, and a click between a
submitter and the only reason they came is a click worth deleting. There
is now something at the front door that has to happen first, so the
landing page has content, and putting the widget on the form page in
order to preserve the old shape would trade the CSP for a URL.

**Rejected: the bot deep-link flow.** A `t.me/YourBot?start=<nonce>`
link, a webhook on the Worker, and the page polling until the nonce is
claimed gets identical verification with *no third-party script at all*
and no CSP exception anywhere. It was the better answer on the merits
and lost on familiarity: a widget that says "Log in with Telegram" is a
thing people recognise, and a link that sends you to a bot and asks you
to come back is a thing people abandon. Worth remembering if the CSP
exception ever becomes a problem — it is the same account id and the
same session on the other side, so it is a swap rather than a rewrite.

### The page is not the gate

`index.html` being the first page anyone sees is routing, not security,
and it is worth being blunt about that because it is the kind of thing
that produces false confidence.

A static site cannot gate a static page. Anyone can type the form page's
URL, and any check written into that page is visible in View Source to
the person it is meant to stop — this document already says exactly that
about granting access, and nothing about sign-in changes it. The form
page bouncing a signed-out visitor back to `index.html` is a courtesy so
that people do not fill in six fields before learning they cannot send
them.

**The gate is the Worker refusing `POST /submit` without a valid
session.** That is enforceable, it is the only thing that is, and it is
what actually delivers "only accounts can submit".

### Sessions

A session is a random token issued when a Telegram payload verifies, and
held in `sessionStorage` for the life of the tab.

**This is a change to a rule this document made in as many words** — that
the project touches `sessionStorage`, `localStorage` and URL fragments
on none of its pages. That rule was about *key material*, and the reason
given was that a page holding the corpus in the clear should discard
everything when it closes. A submitter's session token is not key
material. It authorises appending a row to one account and nothing else:
it cannot read a submission, cannot decrypt one, and cannot reach the
export. Holding it for the tab is the difference between signing in once
and signing in on every page.

The Worker stores `SHA-256(token)` rather than the token, so reading the
sessions table does not yield a working session. Sessions expire, and
expired rows are cleared opportunistically when one is looked up rather
than by a scheduled job — the failure mode of a scheduled job is
silence, and there is nothing here worth a moving part.

### Admin accounts

An admin account grants three things: pulling the ciphertext, publishing
and unpublishing the snapshot, and deleting a submission.

**It cannot grant plaintext, and this is not a limitation to be worked
around.** This document already worked out the honest form of
delegation: a per-holder grant gets someone the ciphertext, and the
private key, once handed over, is permanently theirs and cannot be taken
back by anything. Accounts change which half is assignable, not the
shape. Before, the revocable half was one shared `EXPORT_TOKEN` that
could only be revoked for everybody at once; now it is a per-person flag
that can be dropped for one person on a Tuesday.

**Admins are named in a Worker environment variable**,
`ADMIN_TELEGRAM_IDS`, compared by HMAC the same way an account id is
derived. Deliberately not a button on a page: an admin who can create an
admin means the founding secret stops being the only root of trust, and
a promotion that costs a trip to the Cloudflare dashboard is a promotion
somebody thought about. The cost is that it is a dashboard errand every
time, and it is the right cost at this size.

It also survives the table being cleared, which a promoted-in-the-
database scheme would not — there is no state in which nobody can
administer the thing.

`EXPORT_TOKEN` stays, as break-glass and nothing else. `HANDOFF.md`
already documents recovering by `curl` for the case where the pages
themselves are unreachable, and a Telegram outage is not a reason to be
locked out of your own data. It is no longer typed into `admin.html`,
which now works from an admin session — one less shared secret on
screen, and one less field to paste the wrong thing into.

### Deleting a submission

Deletion is an admin action. A member who wants their entry gone asks,
which in a Telegram group is a message, and the admin clicks a row.

**This ends "the submissions table remains strictly append-only".** That
sentence was true and is now false, and the reason is the same one that
put a `DELETE` route on the snapshot: the moment somebody wants their
data gone is not the moment to make them wait for a console login and
hand-typed SQL. The same route is what makes spam recoverable, which is
what allowed the answer to spam to stay "nothing until it appears".

**Member self-deletion is now cheap and is deliberately not built.** A
session proves which rows are yours, so the route would be a few lines.
It is left out because "ask an admin" is one message in a group where
everyone can already reach each other, and because a delete button on a
member's own page is a thing to press by accident. If the group grows
past the point where asking is reasonable, this is the first thing to
add.

### What this costs, stated plainly

Two disclosures that did not exist before. Both are in the threat model
as well; they are repeated here because they are the price of this
section and should not be discoverable only by reading a schema.

- **Grouping.** A stable account id in the clear reveals which rows
  belong to one person. Cloudflare, or anyone with a leaked export
  token, learns that some account submitted twelve times over eight
  months. Before, they saw twelve unrelated opaque rows. This is
  unavoidable if accounts are to work at all — an identifier that cannot
  be grouped is not an identifier.
- **The Worker sees Telegram ids.** Verification happens there, so the
  numeric id and the handle pass through it on every sign-in. The Worker
  must store neither and log neither, and Cloudflare still learns the
  set of ids that authenticated. What it never learns is what any of
  them weigh.

## Key custody

**The private key never enters this repository, and never enters a
browser other than the admin's own.**

- Generated locally by `tools/keygen.html`, on the keyholder's own
  machine. `tools/` is never published, so the generator is not
  reachable from the deployed site and cannot be run by accident from
  a page someone else controls.

  **Serve it from `http://localhost`, do not open it as a `file://`
  URL.** An earlier draft of this document said both "opened from disk"
  and "`crypto.subtle` is not available over `file://`", which cannot
  both be true. Rather than resolve which browsers treat a file URL as
  a secure context — a question whose answer varies and can change
  under you — the generator is served over localhost, which is
  confirmed to work and costs one command. A generator that silently
  lacks `crypto.subtle` is a page that appears to work and produces
  nothing. The page checks `isSecureContext` itself and refuses to
  generate rather than fail obscurely, since the cause is never the
  page but how it was opened.
- **It proves the pair before it shows it.** Both halves are exported,
  re-imported from exactly the strings that will be saved and pasted,
  and an ECDH secret is derived from each side and compared. Nothing is
  displayed unless they agree. Every failure this tool can have is
  otherwise silent: a key that generates fine but serialises to
  something `admin.html` cannot import gives a page that looks like it
  worked, a `config.js` that looks right, and a year of submissions
  nobody can read. What it does *not* test is HKDF and AES-GCM — that
  is `crypto.js`'s format, tested in `dev/`, and implementing it twice
  would mean two copies to drift apart.
- **It is one self-contained file, with inline script and style** —
  which the published pages forbid. The ban exists because an injected
  script on those pages would see plaintext before encryption; this
  page loads nothing, and its policy sets `connect-src 'none'`, so
  there is no such path. What it buys is a generator a successor can
  carry to whatever machine they trust as a single file, rather than a
  page plus a stylesheet plus three scripts that must all arrive
  intact. It is also served from `tools/`, so it could not share
  `apps/web`'s stylesheet in any case.
- Stored by the holder — password manager, encrypted volume, paper in a
  safe. Two copies, or the data is one dead laptop away from gone.
- Used only by `apps/web/admin.html`, which decrypts in-page and never
  transmits the key. The admin page is public; it is useless without the
  key, so publishing it costs nothing.

**There is no recovery.** Lose the private key and every stored
submission is permanently unreadable. This is the price of the storage
provider not being able to read them either. Say so in the handoff.

### Handing the project to someone else

Two things move, independently:

| To transfer | Do this |
| --- | --- |
| Read access to the data | Give them the private key file, and make them an admin by adding their Telegram id to `ADMIN_TELEGRAM_IDS`. Nothing else. The admin flag gets them the ciphertext and is revocable; the key gets them the plaintext and is not. |
| The storage itself | Move the Cloudflare account, **or** have them deploy their own Worker and D1 database and change the endpoint URL in `apps/web/config.js`. Existing rows come across with a `SELECT`, and they are ciphertext in transit as much as at rest. |
| The site itself | Transfer the GitHub repo, or they fork it. |

Handing over storage is more work than the Drive menu item the Sheet
offered — this is the cost of the storage decision, paid here. The
checklist is in `HANDOFF.md`, written early rather than last, because
transferability is a constraint on the code and not a document produced
at the end.

Three things arrange the code so a handover is configuration rather than
editing:

- **Neither side names the other in code.** The Worker learns which
  site may call it from `ALLOWED_ORIGINS`, a dashboard variable; the
  site learns the endpoint from `config.js`. A new owner changes two
  settings and deploys identical code. The moment someone has to edit
  `worker.js` to change a URL, this property is lost.
- **The pairing that fails silently is checked.** The endpoint lives in
  `config.js` and the permission to reach it lives in each page's
  `connect-src`. Change one and the site still loads, still looks
  right, and drops every submission at the browser's CSP check. That is
  the failure a new owner will hit, so `tools/check_web.py` fails the
  build instead.
- **`server/wrangler.toml` is the deployment**, not a description of
  one. It was documentation-only until 2026-08-05 and had drifted in
  both of the ways documentation-only config drifts: the wrong Worker
  name, and a `REPLACE_ME` where the database id goes. A `deploy`
  against that would not have errored — it would have created a second
  Worker beside the real one, which is the failure mode this whole
  document keeps circling, where the wrong thing succeeds quietly.

  It is now what actually deploys, and that is the point: a file that
  gets run cannot be quietly wrong, and the dashboard-paste path leaves
  no trace in the repository at all. The dashboard is kept as the
  fallback for a successor who cannot install wrangler, and
  `server/README.md` says which is which — because two equal options is
  how the endpoint and the repository come to disagree.

Rotating instead of sharing: the new holder generates a fresh keypair,
publishes their public key in `config.js`, and new submissions are
encrypted to them. Old rows still need the old key, so the old key gets
archived rather than destroyed.

## Data collected

| Field | Required | Notes |
| --- | --- | --- |
| Telegram username | yes | **Not typed — taken from the verified sign-in.** The Worker hands it back to the authenticated page, which puts it in the record before encrypting. Still normalised to lowercase, since Telegram's own casing is display only. |
| Weight | yes | Stored in **both** kg and lb, whichever was typed. |
| Height | yes | Stored in **both** cm and feet+inches (and total inches), whichever was typed. |
| Units | — | lb/ft+in or kg/cm toggle; conversion happens client-side. Which one was used is recorded. |
| What was typed | — | The weight and height exactly as entered, as strings. |
| Gender | no | male / female / nonbinary / other |
| Roles | no | multi-select: feeder, feedee, gainer, admirer. Shown to submitters as "Feedism Affiliation(s)" — the label is display only; the stored field is `roles` and its values are unchanged. |
| Country | no | dropdown, ISO 3166 list; the **code** is stored, not the name |
| 18+ confirmation | yes | checkbox, recorded with the row |
| Submitted at | — | timestamp, added client-side inside the ciphertext |

### Why every row carries both unit systems

An earlier draft of this table stored one canonical value — kg and cm —
plus the raw text, and converted at export. Storing both was chosen
instead, on the keyholder's instruction, and it is the better shape for
two reasons beyond the asking:

- **The conversion exists once.** Deriving pounds at export would put
  this same arithmetic in `admin.html`, as a second copy free to drift
  from the one in `form.js`. Two implementations of a conversion is two
  chances to be wrong and one of them is not tested.
- **The CSV is readable without the code.** An export that reads
  `90.7 kg / 200 lb` is a file a person can use. One that reads `90.7`
  and requires knowing the factor is a file that needs this repository
  to interpret, which is the opposite of what `HANDOFF.md` is for.

The cost is a few bytes inside a blob already padded to an AES block.

What is **not** derived is the `entered` field: exactly what the
submitter typed, kept verbatim as a string. Rounding is lossy in both
directions, and "what did they actually say" is a question worth being
able to answer without inverting a conversion.

`feet` and `inches` are computed from the total rather than carried
alongside it, so the two cannot disagree — and the rounding carry is
handled, because 5 ft 11.98 in otherwise rounds to a height written
`5 ft 12 in`. `dev/form.test.mjs` holds that case.

Everything above is inside the encrypted blob. The stored row carries
the ciphertext, a server-side receipt timestamp, and the account id —
nothing else. In particular the username is **not** stored in the clear,
because a column of Telegram handles next to a form about feedism is the
exact thing this design exists to prevent. The account id is what
replaces it, and the reason it can sit in the clear where a handle
cannot is the whole of "The identifier is the whole problem" above.

### Repeat entries

Every update writes a new row. Members do not edit an entry; they submit
their current numbers again, and the account id is what ties the entries
together.

This is a deliberate choice between two readings of "update". Replacing
in place would give one live row per account, which is the tidier data
model and the more literal reading of a unique account — and it would
delete weight over time, since a history nobody keeps is a history
nobody can plot. Appending keeps both questions answerable: *what does
this person weigh* is the latest row, *what has happened to them* is all
of them.

The consequence is that "how many people" and "how many entries" stay
different questions, both legitimate, which is why the dashboard has a
toggle rather than an opinion. What has changed is that the answer no
longer requires decryption to work out — the account id groups rows
without opening them, where before the only way to tell two submissions
apart was to decrypt both and compare handles.

A typo is still permanent, since nothing rewrites a row. The route back
is submitting again, and asking an admin to delete the wrong one.

## The page shell

Every published page shares one head and one stylesheet. The shell was
built before the form on purpose: the form and `admin.html` are the two
pages that touch plaintext and keys.

`index.html` was the form until 2026-08-05 and is now the sign-in page —
see "The sign-in page is a page of its own". The pages that touch
plaintext are the form and `admin.html`; the pages that touch a session
are all of them except `404.html`.

**A content security policy, in a `<meta>` tag.** `default-src 'none'`
with `script-src 'self'`, so the page can load nothing but its own
files. This is the prose rule in "Encryption, concretely" — no CDNs, no
third-party code — turned into something the browser enforces. It
matters most in the window this whole design is about: the moment
between the form being filled in and the browser encrypting it, when an
injected script would see cleartext. `connect-src` gains the Worker's
origin when the endpoint lands; nothing else is added to it.

**`index.html` is the one exception, and it is why sign-in is a separate
page.** It carries `script-src https://telegram.org` and
`frame-src https://oauth.telegram.org` because the login widget needs
both. That is a real weakening — Telegram can run code on that page —
and it is survivable only because there is nothing on that page to
steal: no form, no record, no key, no `crypto.js`. The exception must
not spread. A page that holds cleartext and a page that loads a third
party are two different pages, permanently, and if that ever has to
change the bot deep-link flow is the way out rather than a wider policy.

GitHub Pages serves no headers, so this is a meta policy, which means
`frame-ancestors` and `report-uri` are unavailable — the site can be
framed, and violations are not reported anywhere. Neither changes the
threat model: there is nothing to clickjack on a page with no read path.

**The pre-paint theme script is a file, not an inline block.** An inline
script needs `'unsafe-inline'`, which would defeat the policy above, or
a hash that silently breaks on every edit. A blocking same-origin script
in the head runs at the same moment for the cost of one request.

**No webfont.** Not an oversight and not only a taste call — a font from
a CDN is third-party code on the page that handles plaintext, and the
CSP above forbids it. The type carries itself on scale, weight and
tracking, over the system stack.

**A theme-aware SVG favicon.** It reads `prefers-color-scheme` itself,
because a favicon cannot see the page's `data-theme`.

**The stylesheet is desktop-first**, which is the opposite of the usual
advice and deliberate. This form is filled in once, mostly at a desk,
and the page that matters most — the export — has an eighteen-column
table and a grid of charts. Building those up from a phone layout made
every desktop rule an exception; this way the exceptions are the small
screen, where there is only ever one answer: one column, in the order
the markup already has. The mobile override is one block at the bottom
of `theme.css` and is short because of it.

Two measures, not one. `--measure` is the reading column for prose and
forms; `--measure-wide` is for `admin.html`, which is looking at data
rather than reading. `body.wide` opts into it and `.narrow` opts an
individual card back out — the credentials card is inputs and prose, and
a password field stretched to 84rem looks broken because it is.

Breakpoints are in `rem` and chosen from the layout rather than from
any device: 52rem is where two fields stop fitting side by side with
room to type in them.

**One rule forcing `[hidden]` to `display: none !important`.** Every
part of this site that appears and disappears does it by setting the
`hidden` attribute — both unit groups, the "not open" notice, the
success card, each field error. The browser's own rule for that is
`display: none` at the weakest specificity there is, so any component
setting `display` beats it, and `.card` and `.stack` both set `flex`.

This shipped broken on 2026-08-04: the published form showed both unit
systems at once, under a "not open" notice and a "thanks for
submitting" card nobody had earned. Nothing about it fails loudly —
the JavaScript is right, the attribute is set, and `element.hidden`
reads `true`; only the rendering disagrees. **Verifying `element.hidden`
does not verify that anything is hidden.** `tools/check_web.py` check 7
now refuses to publish a stylesheet without the rule.

**A `404.html` and a `robots.txt`.** GitHub Pages serves the former for
any unknown path; without it a typo lands on GitHub's own 404, which is
branded as a repository error and tells a visitor nothing. The latter
says the same thing as the `noindex` meta each page carries, in the file
a crawler reads first — this site is meant to be handed to people, not
found in a search result next to somebody's Telegram handle.

`tools/check_web.py` fails the build if any page is missing a piece of
that head, so a page added later cannot quietly ship without the policy.

## What is deliberately not here

- **No bot check, because there is no longer an open endpoint.**
  Submitting requires a session, and a session requires Telegram to have
  vouched for you, so the cost of a junk row is a Telegram account
  rather than a `curl` invocation. Turnstile would now be a second lock
  on a door that is already locked.

  **This replaces a worse answer, recorded because the reasoning was
  wrong rather than merely superseded.** The old text said a public
  endpoint would eventually collect junk, that the `POST` path had an
  early return ready for a Turnstile check, and that nothing would be
  wired up until junk actually appeared. Waiting is a reasonable posture
  when the damage is recoverable, and it was not: there was no delete
  path for a submission anywhere, so junk would have been permanent
  short of hand-typed SQL in the Cloudflare console. The early return is
  still there and now holds the session check.

  What remains unaddressed is a member submitting junk deliberately.
  That is a moderation problem rather than a security one, and it has an
  answer now that it did not before — an admin can delete the rows, and
  demote or ignore the account.
- **No service worker, and no web app manifest either.** The base
  project is an installable PWA; a submission form that works offline
  would queue writes it cannot confirm. Without the service worker a
  manifest only buys an install prompt for a page most people will open
  once — and an icon on a phone's home screen naming this project is a
  privacy cost, not a feature.

- **No framework and no build step.** `apps/web` is the build, so a
  bundler would add a step that can fail between the source and the
  published site. There is no state here that hand-written DOM code
  cannot hold.
- **No staging branch.** Same reasoning as the base project: a push to
  `main` is a release, gated by the verify job, and verified locally
  first.

## Build order

The order is deliberate. State as of 2026-08-04:

1. ✅ **The Worker and its database.** Deployed, bound and verified end
   to end — including from the live site under the real content
   security policy, which is the only check that proves the D1 binding
   exists at all. A Worker missing it passes every test in `dev/` and
   fails on the first real request.

   This was a *spike* while the storage was Apps Script, because the
   CORS round trip might not have worked at all. With a Worker setting
   its own headers it was ordinary work — see "Why a Cloudflare Worker
   + D1".

2. ✅ **`tools/keygen.html`** — local keypair generator. Built and
   exercised over `http://localhost`: it generates, verifies the two
   halves agree, and refuses to show anything when they do not (checked
   by forcing the mismatch). Never published — `tools/` is not part of
   the build. The private half never enters this repository.

   `tools/check_web.py` gained two things because of this step. The
   patterns for what the generator produces, since it creates a new way
   to leak — it hands over the public line and the private file a few
   centimetres apart, and only one of them may be published. And a
   validity check on the public key itself, because the key reaches
   `config.js` by copy-and-paste out of a browser window, and a paste
   that drops a character produces a plausible-looking blob that fails
   in a submitter's browser rather than in the terminal of whoever
   pasted it. Decode, length, prefix, and the curve arithmetic.

   **Done for this deployment on 2026-08-04.** The keypair was
   generated by the keyholder on their own machine; the public half is
   in `config.js` and verified importable, the private half is held
   offline and has never been in this repository. Step 4's form can now
   have something to encrypt to — though it must still refuse to submit
   if `publicKey` is ever `null` again, which is what a fork starts
   from.

3. ✅ **`crypto.js` and the `dev/` round-trip test.** Built and passing:
   `node dev/crypto.test.mjs`. A classic script assigning
   `globalThis.BinderCrypto`, matching `config.js` rather than
   introducing modules into a directory that has none — which also lets
   the test load the shipped file's real bytes under Node, the way
   `dev/worker.test.mjs` loads the Worker.

   The test has two halves and the second is the one worth having. A
   fresh keypair round-tripping proves encrypt and decrypt agree *with
   each other*; a **committed fixture ciphertext** proves they still
   agree with what is already stored. Every other check passes happily
   after a change that quietly alters the format — a different label, a
   different salt, a reordered header — and such a change would leave
   the live database unreadable with nothing anywhere reporting it.
   Both directions were confirmed by mutation: altering the label, the
   hash, the salt or the additional data breaks the fixture, and
   reordering the header breaks the round trip.

   `dev/crypto-browser-check.html` repeats the platform-dependent part
   in a browser, under the published pages' policy and against the real
   `crypto.js` rather than a copy. Node is the same specification and
   is what CI runs; it is not what a submitter uses, and the
   differences that would bite — the content security policy, the
   secure context, the engine's own WebCrypto — are precisely the ones
   Node cannot have.

   `tools/check_web.py` gained a sixth check with this step, stating
   the design's central rule in a form a machine can hold: a script
   that can reach the network must also name `BinderCrypto`, and a page
   loading such a script must load `crypto.js`. Vacuous today on
   purpose — it arms on the day the file that handles cleartext is
   written, which is step 4.

4. ✅ **The form** — fields, unit toggle, country dropdown, 18+
   checkbox, validation, encrypt, POST. Built on `index.html` itself
   rather than a page of its own: this site does one thing, and a
   landing page whose only content is a link to the form is a click
   between a submitter and the only reason they came.

   `form.js` is split in two. The pure half — normalising, converting,
   validating, building the record — touches no DOM and is exported as
   `BinderForm`, so `dev/form.test.mjs` loads the shipped file under
   Node the way the crypto and Worker tests already do. The wiring
   returns early when there is no `document`.

   That split is not tidiness. It is the same argument that put
   `crypto.js`'s test before the form: **a wrong conversion factor
   cannot be discovered after the fact.** It does not throw, it does not
   render badly, and it produces a plausible number which is then sealed
   correctly. There is no original kept anywhere to compare against — so
   the arithmetic is tested, and CI runs it.

   Two smaller decisions worth their reasons:

   - **The unit toggle swaps which inputs exist**, rather than
     relabelling one pair. Someone who types 200 into a pounds box and
     then switches to metric has not become 200 kg, and a form that
     quietly records that they have is a form that stores a lie. The
     two systems have separate inputs, and validation reads only the
     system in use.
   - **The form refuses to open at all** when `crypto.subtle` is absent
     or `config.publicKey` is `null`, and says which. Both are states a
     submitter can do nothing about; the alternative is six filled
     fields and a dead button. The `publicKey` case is what a fork
     starts from.

   `tools/check_web.py`'s sixth check is no longer vacuous — `form.js`
   is the first file in `apps/web` that reaches the network, and it is
   held to naming `BinderCrypto`, with `index.html` held to loading
   `crypto.js`. Confirmed armed rather than assumed.

5. ✅ **`admin.html`** — token in, key in, decrypted CSV out. Built,
   and split like the form: the CSV logic is pure, exported as
   `BinderAdmin`, and tested in `dev/admin.test.mjs`, which CI runs.
   The CSV *is* the product, and a quoting bug does not throw — it
   shifts one column into the next and produces a file that opens
   cleanly in a spreadsheet and is wrong.

   Four decisions worth their reasons:

   - **The key is imported before the network is touched.** A bad key
     is the admin's own mistake and can be reported instantly; spending
     the request first would report it as a failure of the fetch, which
     sends them to check the wrong thing.
   - **A row that will not open is named, not skipped.** `crypto.js`
     throws, which is right, but stopping the export on the first
     failure is not: the ordinary cause is a rotated key, where the old
     rows fail and the new ones are exactly what is wanted. Failures
     are counted and listed with their row ids beside the result.
   - **Cells that a spreadsheet would execute are defused.** A cell
     beginning `=`, `+`, `-` or `@` is a formula in Excel, Numbers and
     Sheets. Nothing that passes the form's validation starts that way,
     but a record is whatever arrived, and this design assumes the
     submitter's browser is the submitter's. A leading apostrophe is
     the conventional fix; the only honest false positive would be a
     negative number, and no field here can be negative.
   - **`connect-src` does not list `blob:`.** The CSV is handed over as
     an object URL on a download link, and a download is not a fetch —
     confirmed by watching `securitypolicyviolation` while clicking it.
     Adding `blob:` would permit only the thing this page never does:
     reading an object URL back through `fetch()`.

   The page holds the whole corpus in the clear, which nothing else
   does, so it also has a **Clear** button and says plainly that
   closing the tab discards everything. Nothing is written to
   `localStorage`.

   **JSON alongside the CSV.** It keeps the nesting the CSV has to
   flatten and has no quoting rules to get wrong. The CSV stays the
   default because the likeliest thing anyone does with an export is
   open it in a spreadsheet.

## The dashboard

Charts on `admin.html`, from the same decrypted rows the CSV is built
from. `dashboard.js` holds the aggregation and draws the charts as
inline SVG.

Since 2026-08-05 it draws a *snapshot* rather than the rows themselves,
and `admin.html` builds one of its own entries to hand it. That
indirection is what lets the same function draw the public page — see
"The members' dashboard" below, which is where the reasoning lives.

**No chart library, and this is not a preference.** `admin.html` runs
under `default-src 'none'; script-src 'self'`, and it is the one page
where every submission exists in the clear at once — a CDN script here
would see the whole corpus. That is the rule the rest of this document
argues for, so the charts are about a hundred lines of arithmetic and
some `<rect>`s instead.

Two consequences worth stating, because both were learned by getting
them wrong:

- **Colour comes from classes in `theme.css`, never from a `style`
  attribute.** `style-src` carries no `'unsafe-inline'`, so an inline
  style would be dropped and the chart would render in the browser's
  defaults. `fill` and `stroke` are ordinary CSS properties, so a class
  works and inherits the palette for free.
- **A `polyline` needs `fill: none` from a rule that outranks the
  series colour.** The `fill="none"` presentation attribute does not
  survive: attributes lose to any CSS rule, so the per-series `fill`
  won and every weight history rendered as a filled wedge. Selecting
  `polyline.chart-series` is what makes it stick.

### Entries are not people

Every update writes a new row, so "how many people" and "what was
submitted" are different questions and both are legitimate. The
dashboard has a toggle rather than an opinion: **one per person
(latest)** or **every entry**. The difference is not cosmetic — a
frequent resubmitter drags every distribution toward themselves.

Since accounts, "one per person" is a fact about the account id rather
than a guess from the decrypted handle. The toggle and the charts are
unchanged; what changed is that grouping no longer depends on two rows
having spelled a handle the same way.

The **weight-over-time** chart ignores the toggle and always uses every
entry, because the repeats are what it is made of. It draws only people
with more than one entry: a single entry is a point, not a trend, and
drawing it as a line implies a history that does not exist.

### Two smaller judgements

- **Blank answers are a bar, not a deletion.** "60% male" reads very
  differently from "60% of the third of people who answered", and a
  chart that drops the blanks claims the first while meaning the
  second. `Not stated` is always shown, and always sorts last.
- **BMI is reported as a number and nothing else.** The clinical
  category labels are deliberately absent. They are a judgement this
  page has no business making about people who filled in a form, and
  they would be the part everybody read.

**Heights that changed between entries get their own panel.** Height
does not change in adults, so a difference is a typo, a unit mix-up, or
one handle used by two people — all things the keyholder wants to know
before trusting a height figure. A centimetre of slack absorbs the
rounding between the two unit systems.

6. ✅ **`HANDOFF.md`** — written up front, from the transfer table
   above, and revisited as each piece landed. The original plan was to
   write it last; that was wrong. Transferability shapes the code, so
   the checklist had to exist while there was still time for the code
   to accommodate it. It now carries the export procedure, which only
   became writable once `admin.html` existed. Revisit it whenever the
   key, the endpoint or the export changes.

### What exists now

*As of 2026-08-05, before the accounts work began. Kept as the record of
what the first build order produced; "Build order — accounts" below is
what is being built on top of it.*

**Both ends, and everything between them.** The site, the storage
endpoint, the form and the export page, wired together and live; a
dashboard reading a published aggregate; the key generator; a keypair,
whose public half is published in `config.js` and whose private half is
held offline by the keyholder; and `crypto.js`, tested against both a
fresh keypair and a stored fixture.

A submitter fills in the form and their entry is encrypted in their
browser and appended to D1 as ciphertext. The keyholder opens
`admin.html`, supplies the export token and the key file, and gets a
CSV built in their own browser. Nothing in between can read any of it.

The line that used to close this section — that the build order was
complete and what remained was operational rather than architectural,
namely spam protection if junk ever appeared — was wrong on its own
terms, and the way it was wrong is instructive. Spam was filed as
operational because it looked like a nuisance. It was architectural,
because nothing built could undo it, and pulling that thread produced
accounts, sessions, a deletion path and a gated dashboard. **A problem
whose damage cannot be reversed by anything in the system is not an
operational problem, whatever it looks like from the outside.**

## Next goals — recorded 2026-08-05, all built the same day

Seven asks, written down as given. They were **goals, not decisions**
when this section was written; the decisions came back the same day and
the work is done. What follows is kept as the reasoning that produced
the shape, with each goal marked with what actually happened.

The three open questions this section raised were answered:

- **Where the private key is during a refresh:** nowhere new. Option D
  — publish a snapshot from `admin.html` — was chosen, so the key stays
  where it was and no scheduled job holds one.
- **What "European countries" means:** popular EU member states. Taken
  as the ten most populous, which is a criterion that can be checked.
- **Whether weight over time can be public:** yes, eventually. Built,
  pseudonymous, and off by default until the keyholder ticks it.

Two of the seven turned out to be the same build, and it is the same
build goal 1 needed — see "One build serves 1, 5 and 6" below.

### 1. A dashboard that refreshes daily from the database

✅ **Built as option D — publishing from `admin.html`.** The keyholder
presses a button and the aggregate goes out; nothing new holds a key.
Options B and C below remain the upgrade path if that turns out to be
too manual, and both write to the same endpoint this now uses, so
neither is a rewrite.

**The whole question is where the private key is when the refresh
runs.** Something has to decrypt, decryption needs the key, and today
the key exists only in the keyholder's browser for as long as the tab
is open. "Daily and automatic" means naming a second place it lives,
which is the one decision this project has spent every other page
avoiding. Four ways, in the order they should be considered:

- **D. Publish a snapshot from `admin.html`.** No scheduling at all: a
  button on the page the keyholder already opens computes the
  aggregate and POSTs it to a new Worker route, and the dashboard
  reads that. "Daily" becomes "as of the last time anyone looked",
  which for a portal seeing a few submissions a week may be the
  truthful answer. Nothing new holds a key. **Start here** — it is
  small, it needs no new secret, and it settles the snapshot format
  that every other option also needs.
- **B. A scheduled job on the keyholder's machine.** The same
  computation as D, run by Task Scheduler against a key file on that
  disk, POSTing to the same route. Genuinely daily; the key still
  never leaves the machine. Costs: the machine has to be on, and a
  key sitting in a file for a script to read is a weaker custody
  story than a key pasted into a tab. **This is the recommended
  answer if D turns out to be too manual** — it is additive, not a
  rewrite.
- **C. A second "analytics" keypair, and a reduced record.** Each
  submission encrypted twice: once to the keyholder in full, once to
  an analytics key over a record carrying no Telegram handle. The
  analytics private key can then live in a Cloudflare Cron Trigger,
  because losing it leaks de-identified statistics rather than a list
  of who. Fully automatic, honest about what Cloudflare can see, and
  the right answer if "the machine has to be on" is unacceptable.
  Costs a wire-format change — a new version byte and a decoder that
  reads both, per the rule under "How a submission is written down" —
  and a second ciphertext per row forever.
- **A. The real private key as a Worker secret, on a Cron Trigger.**
  The obvious implementation and **the one to refuse**. It hands
  Cloudflare the ability to read every submission, which is property
  1 of this design and the reason the storage provider was allowed to
  be a convenience decision in the first place. Named here so nobody
  arrives at it later thinking it was never considered.

Three rules bind whichever is chosen:

- **The snapshot is public data.** It is served to a page with no key
  and no token, so it carries no Telegram handles and nothing
  per-person that identifies. That rules out the weight-over-time
  chart in its current form — a per-person series is re-identifiable
  by anyone who knows one person's weight — so it either stays behind
  the key or is keyed by an opaque per-handle id.
- **The snapshot carries the time it was made, and the page shows
  it.** A dashboard quietly displaying week-old numbers is worse than
  one that admits it is stale, and a scheduled job's ordinary failure
  mode is silence.
- **The aggregation is `dashboard.js`, not a second implementation.**
  Same argument as the conversion in `form.js`: two copies drift, and
  the one nobody tests is the one still passing. It follows that the
  snapshot must precompute *both* bases — one-per-person and
  every-entry — since deduplicating by handle is exactly what a
  handle-free file cannot do later.

### 2. A unit choice on the dashboard

✅ **Built**, on both dashboards, imperial by default. The unit table
in `dashboard.js` says which stored field each system reads and how it
is written down; nothing converts. Imperial heights are shown as
`5'8"`, which is formatting rather than conversion — the total inches
are already the number being displayed, and rounding to whole inches
before dividing by twelve is what keeps a "5 ft 12 in" out of it.

Presentation only, and cheap for a reason already banked: **every row
already stores both systems**, so nothing needs converting at read
time and no stored row changes. What is metric-only today is the
display and the arithmetic in `dashboard.js` — `summarise`, the
histograms, the weight-over-time axis and the height-mismatch panel
all read `entry.kg` and `entry.cm` and hard-code the suffix.

The one rule: the toggle **selects which stored value to read**, never
converts a displayed number. A conversion here would be the second
copy of the arithmetic that "Why every row carries both unit systems"
exists to prevent. BMI stays metric internally and unitless in
display, because that is what BMI is.

### 3. Default to imperial

✅ **Built.** The form and both dashboards start imperial.
`tools/check_web.py` gained a check for it — not for the default
itself, but for the two places it is written down agreeing: the radio
that carries `checked` and the field group that carries `hidden`.
`applyUnits()` reconciles them a moment after the browser has already
painted the disagreement, which is what makes that mismatch easy to
ship and hard to see.

This is safe to change precisely because the record keeps both systems
plus the `entered` string: the default changes what most people type,
not what is stored, and no existing row is reinterpreted. It does need
`dev/form.test.mjs` to stop assuming the default, and the check that
the toggle swaps *inputs* rather than relabelling them still holds —
that decision is unaffected.

### 4. Country ordering: USA, Canada, Mexico, UK, Europe, then the rest

✅ **Built** as `BINDER_COUNTRIES_PROMOTED` in `countries.js` — a list
of ISO codes, so the ordering survives a display-name correction and no
stored row or exported column changes.

Display order only. The stored value is the ISO code, never the name,
which is what makes this a `countries.js` edit with no effect on a
single stored row or on the export — the reason for that split,
written down when `countries.js` was created, is being collected here.

Three decisions were needed and all three are in the file's own
comment. **"European" means popular EU member states**, taken as the
ten most populous — a criterion someone else can check and extend,
rather than a guess about who counts as popular, and the tenth place is
a near-tie so the bottom of the list is arbitrary on purpose. Non-EU
Europe stays in the alphabetical run. **The separator is an
`<optgroup>`**, whose label cannot be selected and cannot be stored — a
drawn `--------` row is an option somebody can pick. **The promoted
countries also appear in the alphabetical group**, because a country
missing from the A–Z run reads as a bug to whoever is scrolling for it,
and both options carry the same value.

`tools/check_web.py` gained a check that every promoted code names a
real country. `form.js` skips one that does not, which is right on a
live page and is exactly what makes a typo invisible: the country is
simply absent from the top of the list, and the only way to notice is
to know it should have been there.

### 5. Splitting dashboard, admin and export into separate pages

✅ **Built as a split by sensitivity rather than by feature.**
`admin.html` still does one decrypt and holds the table, the CSV and
the charts; `dashboard.html` is a new page that never sees plaintext,
takes no key and no token, and reads a published aggregate.

### 6. The admin page granting access to the export page

✅ **Built as the only form of it that is not theatre.** `admin.html`
has a Publish button, and what it grants access to is the public
dashboard — a page that can be handed to anyone, permanently, with
nothing to revoke, because it never contained anything worth
protecting.

### Rethinking 5 and 6

**Why splitting the keyholder page three ways costs more than it
looks.** Every page that shows plaintext has to fetch and decrypt for
itself. Three such pages means either entering the token and the key
three times, or keeping key material somewhere all three can reach —
`sessionStorage`, `localStorage`, or a URL fragment. This project
touches none of those on purpose, and `admin.html` says in as many
words that closing the tab discards everything. Trading that for
navigation is trading the security model for a menu. There is a
smaller cost too: three pages means three copies of a content
security policy that must not drift, and three more entries for
`tools/check_web.py` to hold to the shared head.

**But the ask is pointing at something real.** An eighteen-column
table of handles, weights and kinks and a chart of median weight are
not the same kind of data, and they do not have the same audience.
The split worth making is along that line rather than along the
feature line.

**And "give access" has no meaning in this architecture, which is a
feature.** There are no accounts and no sessions.

> **Superseded 2026-08-05 in its first sentence and vindicated in the
> rest.** There are now accounts and sessions. What did not change is
> the conclusion this paragraph reaches: a page still cannot gate a
> page, and an account still cannot confer the ability to decrypt. The
> "honest options" this section arrives at below turned out to be the
> design that got built — a revocable per-holder grant of ciphertext,
> which is exactly what an admin account is. See "Admin accounts".

A static page cannot
gate another static page: anyone can type the URL, and any check
written in the page is visible in View Source to the person it is
meant to stop. Access here is possession of two things, and they
behave differently — the export token is a Worker secret and is
**revocable**; the private key, once handed to someone, is
**permanently theirs**, and every row it opens is theirs for good.
So an admin page could plausibly *issue* a scoped export token, and
that would get someone the ciphertext and nothing else. It could
never grant the ability to read plaintext, and it could never take it
back.

**One build serves 1, 5 and 6.** A **public dashboard page reading a
published aggregate snapshot** — no token, no key, no personal data
in the file it loads:

- it is goal 1, since a snapshot is exactly what a daily refresh
  produces;
- it is goal 5 done along the line that matters, since the dashboard
  leaves the page that holds the corpus in the clear and the
  keyholder page keeps one decrypt for the table and the CSV;
- it is goal 6 in the only form that is not theatre — a page that can
  be handed to anyone, permanently, with nothing to revoke, because
  it never contained anything worth protecting.

If real delegation is wanted later — someone who can pull the actual
rows — the honest options stay what the handover table already says:
a per-holder export token from the Worker (revocable, gets ciphertext
only), or a second keypair for the delegate so encryption to them can
be stopped going forward (option C above, no revocation of what was
already sent).

### The order it was built in

The sample fixture first, then 3, 4, 2, and the snapshot last. The
fixture came first because none of the rest could be looked at without
data to draw — see `dev/README.md`, which specced it before it existed
and now documents it.

## The members' dashboard

`dashboard.html`. No key and no export token: it fetches one published
aggregate and hands it to the same function that draws `admin.html`'s
charts. **It does require a session.** `GET /snapshot` is gated on one,
decided 2026-08-05, and that gate is real rather than decorative — the
Worker enforces it, which is the one place in this design where a gate
can be enforced at all.

This narrows what the page is for. It was built as something that could
be handed to anyone, permanently, with nothing to revoke, because it
never contained anything worth protecting — and that argument is now
only half used: the file still contains nothing worth protecting, and
the audience for it is the group rather than the world.

**The pseudonymisation stays, and matters more rather than less.** The
instinct on gating a page is to relax what is on it, and it is exactly
backwards here. The people who can recognise somebody from a weight
history are the people who know what that person weighs, and those
people are the other members of the group. A stranger reading an
unlabelled line learns nothing; a groupmate reading it may learn who.
Everything below — the pseudonyms, the dropped data-quality panel, the
opt-in series, the quantisation — is aimed at the reader who is now the
only reader.

**The aggregation happens in the keyholder's browser, and only the
result is published.** That is the sentence the whole feature turns on.
A daily public dashboard sounds like it needs a server that can read
the submissions, and a server that can read the submissions is the one
thing this design does not have. Computing the numbers where the
plaintext already is means nothing new ever holds the private key.

### Why aggregates and not de-identified rows

Publishing rows with the handles stripped would have been far less
code. It is also not de-identification: `female, GB, 241 lb, 5 ft 8 in`
is a person to anyone who knows her, and four such columns are a
fingerprint even when the name column is blank. Counts, medians and
histogram bins are not. So the published document has no rows in it at
all.

### One render function, two pages

`render()` takes a **snapshot**, never rows — and `admin.html` draws
its own charts by building a snapshot of its own entries first. That is
not a detour. It means the keyholder's dashboard and the public one are
the same code path, so Publish is a preview rather than a leap: what
goes out was drawn by the same function that drew what is on screen.
Two render functions would have been two things that look alike until
one of them is wrong.

The only difference between the two documents is a flag:

| | keyholder | published |
| --- | --- | --- |
| Series labels | `@handle` | `Person 1`, `Person 2` |
| Series precision | exact | date, and the weight histogram's bin |
| Height-change panel | shown | dropped entirely |
| Everything else | identical | identical |

The pseudonyms are numbered within one document and renumbered every
time. That "Person 1" is the most frequent submitter is already visible
from the chart, so the numbering gives away nothing the picture does
not.

### Renumbering does not prevent linkage — a correction

**An earlier version of this section claimed that renumbering meant "two
snapshots cannot be lined up to follow one person across them". That was
false, and it is worth recording as false rather than quietly
rewritten**, because the keyholder was being asked to make the opt-in
decision below on the strength of it.

The series carried each point as an exact millisecond timestamp and a
weight to a tenth of a unit. Publish twice and Person 3's line in the
first document is a set of points that reappears verbatim in the second,
with one new point on the end. Matching them is not analysis, it is a
join on an exact key. Renumbering prevents *label* continuity, which
nobody was relying on; it does nothing whatsoever about linkage.

`dev/dashboard.test.mjs` asserts that no handle appears anywhere in a
published document. That passes, and always would have — linkage here
has nothing to do with handles, so the test was giving comfort about a
question nobody had asked.

**The fix is in the format, not the prose.** A published point carries
the date rather than the instant, and the weight rounded to the bin
width the histogram already uses. Cross-snapshot matching becomes
ambiguous instead of exact, and the chart loses precision that a 620-
pixel plot could not draw in the first place. The keyholder's own
snapshot keeps full precision, because it never leaves their tab.

Two smaller things fall out of it and both are improvements. The shape
of a line survives quantisation, so the chart still says what it was
for. And a submission's exact time stops being published at all, which
was a stray disclosure nobody had decided to make — it was simply what
`timeOf` happened to return.

### While correcting: the small-numbers worry was aimed at the wrong thing

The threat model warns that "1 person, Portugal, non-binary" is a
description of somebody. It is not derivable from a snapshot: the
document publishes marginals — gender counts, country counts, each on
its own — and never a cross-tabulation, so a reader learns that somebody
is Portuguese and that somebody is non-binary, and cannot join the two.

The genuine per-person exposure was always the weight series, and the
document was confident about it while being anxious about the counts.
Both statements are corrected below.

The data-quality panel is dropped rather than pseudonymised because it
is a tool for whoever can act on it. Published, it is a list of
strangers' heights and no use to anybody.

### Weight over time is opt-in

It is the one part of a snapshot still about individuals, pseudonyms and
quantisation or not: anyone who knows what someone weighs may recognise
their line. So the checkbox is off by default and the keyholder ticks
it. That is the right place for the decision — it is theirs, it depends
on who is in the data, and it can be reversed by republishing without
it, or by unpublishing outright.

Three things now stand between a series and a name, and the opt-in is
still the load-bearing one. The label is a pseudonym, the points are
rounded to a date and a bin, and the audience is the group rather than
the internet. None of that helps against the reader who already knows
roughly what one member weighs and roughly when they joined, which is
the reader this chart has to be safe against and is not.

### Three rules the format follows

- **Both counting bases and both unit systems are precomputed.** The
  public page has no rows, so it cannot recompute either. A toggle it
  cannot honour is a toggle that would have to be removed.
- **It carries the time it was computed, and the page shows it** — in
  words and as a timestamp, and it says so plainly past two days. A
  dashboard quietly showing last month's numbers is worse than one that
  admits it is stale, and the ordinary failure of anything that
  refreshes this is silence rather than an error.
- **The Worker stores the bytes that arrived.** It parses the body only
  far enough to refuse something that is not JSON, and never
  re-serialises it. This endpoint has no opinion about what a snapshot
  contains — the page that built it does — and re-encoding here would
  be a second place the format could change without anyone deciding to.

### What the endpoint gained

`POST /snapshot` and `DELETE /snapshot`, both admin actions, and
`GET /snapshot`, which any member's session opens. That asymmetry is
still the point: writing and retracting are keyholder actions, and
reading is what the page is for — it is the audience for "reading" that
narrowed, not the principle.

**`GET /snapshot` was gated by nothing until 2026-08-05**, and the route
was the reason the format carries no rows and no handles. It still is.
Gating a document is not a reason to relax it, and the moment the gate
is treated as the protection rather than the format is the moment
somebody puts a handle back in.

The `snapshots` table holds exactly one row, forced by a `CHECK` — a
history of snapshots would be more published data about the same people,
retained for nobody. Publishing replaces.

Snapshot writes are no longer the only `UPDATE` and `DELETE` paths in
the Worker: deleting a submission is one too, and the sentence that used
to sit here — that the submissions table remains strictly append-only —
is retracted in "Deleting a submission" above. What still holds is that
nothing about a snapshot can be turned back into a submission. If it is
lost, an admin presses Publish again.

### Unpublishing needs the token and not the key

The first version of this shipped without a retraction path at all, on
the reasoning that republishing without a chart was enough. That was
wrong, and worth recording as wrong: it answered "change what is
published" and ignored "take it down". The only route left was opening
the Cloudflare console and writing a `DELETE`, and the moment somebody
wants to retract a snapshot is precisely the moment they have realised
it says more than they meant — which is not the moment for a dashboard
login and hand-typed SQL.

So there is a `DELETE` route and an Unpublish button, and the button
sits **outside everything the private key gates**, in a card that also
reports what is currently published. Two properties follow, and both
are the point rather than conveniences:

- **Retracting needs no key.** Requiring it would mean decrypting the
  entire corpus in order to remove something derived from it —
  backwards, and slowest at exactly the wrong time. Until 2026-08-05
  this read "needs only the token"; it is now an admin session, and the
  property that mattered is unchanged.
- **Reading the published state needs no key either.** It is the same
  route the dashboard reads, so the export page can say what is live
  before anyone has opened a key file. Since the snapshot became
  members-only it does need a session, which an admin already has by the
  time they are looking at this card.

Deleting nothing returns success. Someone pressing Unpublish twice, or
pressing it when nothing was published, has got what they wanted; an
error there would read as "it did not work" and invite a retry against
a system that had already done the thing.

`HANDOFF.md` carries the same instruction as a `curl`, for the case
where the page itself is what is unreachable.

### What this cost check 6

`tools/check_web.py` used to hold every file that touched the network
to naming `BinderCrypto`. `dashboard.html` is the first page that
*reads* without sending, and holding it to that rule would have meant
either loading decryption onto a page with no use for it or turning the
check off. The rule now says what it always meant: a file that **sends
a body** must encrypt. Reading is not the risk — the export returns
ciphertext and the snapshot was published on purpose.

## Build order — accounts

Decided 2026-08-05. The order is chosen so that the site is never in a
state where a member can submit something nothing can read, and so that
the two irreversible steps happen where they can be checked.

1. **The Worker: sign-in, sessions, and the account id.** Everything
   else depends on the account id existing and being right, and
   `ACCOUNT_SECRET` is unchangeable once a row carries an id derived
   from it. `dev/worker.test.mjs` grows to cover payload verification,
   session issue and expiry, and the admin list — all of it pure
   arithmetic over a fake `env`, so none of it needs a deployment.

   Two things only a live round trip can prove, exactly as with `DB`
   and `EXPORT_TOKEN` before them: that `TELEGRAM_BOT_TOKEN` matches the
   bot the widget names, and that `ADMIN_TELEGRAM_IDS` holds the id you
   think it does. A Worker wrong about either passes every local test
   and fails on the first real sign-in.

2. **Clear the table, and unpublish.** Both irreversible, and this is
   the moment for them: after the schema is settled and before anybody
   has an account to lose. Unpublishing is not optional housekeeping —
   the live snapshot describes people whose rows are about to stop
   existing, and leaving it up would publish a group that is no longer
   there.

3. **`index.html` becomes the sign-in page**, and the form moves to
   `submit.html`. Nothing is gated yet; this is the page shell, the
   widget, the session in `sessionStorage`, and the two CSP exceptions.
   Doing it before the gate means a broken sign-in is visible as a
   broken sign-in rather than as a form that refuses everybody.

4. **`POST /submit` starts requiring a session**, and the form takes its
   handle from the verified sign-in rather than from a text box. This is
   the step that makes the sign-in load-bearing, so it is the step where
   a mistake locks the group out — hence third, after the page it
   depends on is known to work.

5. **The account panel.** Metadata only: how many entries are on record
   and when the last one was, from `GET /me`. No read-back, because the
   member holds no key and every way of giving them one is worse than
   not — see "Accounts". The form itself stays blank, optionally
   prefilled from `localStorage` on that device.

6. **`GET /snapshot` starts requiring a session**, and `dashboard.html`
   learns to sign in. Small, and separable from everything above.

7. **`admin.html` moves to an admin session**, gaining row deletion and
   losing the export-token box. `EXPORT_TOKEN` stays in the Worker as
   break-glass and moves to `HANDOFF.md` as a `curl`.

8. **Quantise the published series** — date and histogram bin — with the
   test that the correction above showed was missing: not "no handle
   appears", which always passed, but "two snapshots of the same corpus
   plus one entry do not share an exact point".

9. **`tools/check_web.py`.** Check 6 needs a third revision and two new
   checks are worth having; see below.

10. **`HANDOFF.md`**, last as usual and revisited throughout: three new
    secrets, a new bootstrap procedure, and the fact that losing
    `ACCOUNT_SECRET` orphans every member's history.

### What the deployment gains

Three secrets and two tables, all of which have to exist before step 1
is testable against anything real:

- `TELEGRAM_BOT_TOKEN` — verifies the login payload. Also the thing that
  must never be logged.
- `ACCOUNT_SECRET` — the HMAC key behind every account id. Permanent.
- `ADMIN_TELEGRAM_IDS` — plaintext var, comma-separated numeric ids.

`submissions` gains an `account_id` column and an index on it; a
`sessions` table holds `SHA-256(token)`, the account id, whether it is
an admin session, and an expiry.

### Check 6, for the third time

`index.html` will POST a Telegram payload without loading `crypto.js`,
which fails check 6 as written — for the third time the rule has met a
case it did not mean. It was "anything touching the network", then
"anything sending a body", and neither spelling can say the thing it is
actually for, which is *the submission record must be encrypted before
it is sent*.

The answer is not to widen it again. It gains a named exemption list,
with a reason beside each entry, so that a file which sends without
encrypting is either a failure or a decision somebody wrote down. Two
checks are worth adding beside it, both stating a rule this design now
depends on and neither of which any existing check covers:

- **The sign-in page must not load `crypto.js`.** It is the one page
  permitted third-party script, and the entire argument for permitting
  it is that there is no plaintext there to see.
- **No page except the sign-in page may name `telegram.org` in its
  CSP.** The exception is survivable because it is confined; a check is
  what keeps it confined once somebody is copying a head from whichever
  page they had open.

## Open questions

**Whether members should be able to delete their own entries.** Not
built — deletion is an admin action and "ask an admin" is one message in
a group where everyone can reach each other. A session already proves
which rows are yours, so the route is a few lines whenever the group
outgrows asking. Recorded as a decision rather than an omission.

The five that this document carried before are all closed: private-key
custody and imperial height entry were settled 2026-08-04, and the three
raised by the dashboard goals were answered 2026-08-05, all recorded in
their own sections above.

**Settled 2026-08-04 — imperial height is two inputs.** Feet and
inches, as separate boxes, which is how people think about their height
and therefore how they will type it. A single decimal-inches field
would have been trivial to validate and nobody would have filled it in
correctly.

The fiddly parts were the ones expected: an empty inches box means a
round number of feet rather than an error, inches are rejected at 12 or
more, and the rounding carry that turns 5 ft 11.98 in into 5 ft 12 in
is handled. All three are in `dev/form.test.mjs`.

Settled together with it: **every row stores both unit systems**, not
just the canonical one — see "Why every row carries both unit systems".

**Settled 2026-08-04 — who holds the private key.** The key is
generated locally, by the person building this, who is therefore the
keyholder. No transfer, so none of the ways a moved key leaves copies
behind apply.

If custody ever changes hands, that is a *handover*, not a copy: see
`HANDOFF.md`, and prefer rotating to a fresh keypair over shipping this
one around. The old key then gets archived rather than destroyed, or the
history it encrypted becomes unreadable.

## Threat model, honestly stated

Protected against: a breach of the storage provider, a leaked export
token, a curious Cloudflare employee, anyone *reading* the repo, an
unauthenticated stranger writing rows, and a future admin inheriting the
site without inheriting the data.

**Not** protected against, in rough order of how likely it is to matter:

- **Anyone who can *write* to the repository, or to the Pages
  deployment.** They replace `publicKey` in `config.js` with one of
  their own, and every subsequent submission is encrypted to them. It is
  silent, `tools/check_web.py` passes — a substituted key is still a
  valid P-256 point — and nothing in a submitter's browser could tell.
  This is unfixable in a static site with no way to pin a key, and it
  was missing from a section titled "honestly stated" until 2026-08-05.
  The cheap mitigation is out-of-band: publish the key's fingerprint in
  the group description, so that somebody who wants to check, can.
- **The keyholder's own machine, while the key is in use.** `admin.html`
  holds the entire corpus in the clear for as long as the tab is open.
- **A member lying, including about their handle.** Sign-in verifies who
  is *writing*, not what they write, and the record is sealed in their
  own browser before the Worker ever sees it. The account id on the row
  is trustworthy; the handle inside the blob is a label the client
  supplied. See "Telegram is the identity provider" — the two
  disagreeing is at least detectable.
- **Telegram, and Cloudflare, learning who participates.** See the two
  disclosures below.
- **Traffic analysis.** The storage owner sees how many submissions
  arrive and when, just not what they say.

### What accounts added to this list

Both are the price of "Accounts" above, and both were accepted
knowingly rather than discovered afterwards.

- **Rows are groupable.** The account id sits in the clear, so a breach
  or a leaked export token now reveals that some account submitted
  twelve times over eight months. Before, that was twelve unrelated
  opaque rows. It reveals *that* somebody is a frequent submitter, never
  *who* — the id is an HMAC under a Worker secret, so it cannot be
  tested against a guessed handle. An identifier that could not be
  grouped would not be an identifier.
- **The Worker sees Telegram ids.** Verification happens there, so a
  numeric id and a handle pass through it at every sign-in. It stores
  neither and logs neither, which bounds the exposure to the request
  itself — but Cloudflare is in a position to see the set of people who
  sign in, and Telegram already knows. What neither learns is what any
  of them weigh.

And `index.html` loads a script from `telegram.org`, which is
third-party code with execution rights on that page. It is confined
there deliberately: no form, no record, no key, no `crypto.js`. A
compromise of `telegram.org` breaks sign-in and cannot reach a
submission.

### The snapshot, and two corrections

The snapshot is the one document here that is read by people who cannot
decrypt anything: group size, group medians, and the shape of the
distributions. Since 2026-08-05 that readership is the group rather than
the world. Three honest caveats:

- **A weight history is the most identifying thing on it.** Anyone who
  knows roughly what a person weighs can look for their line, and after
  gating, the readers are precisely the people who might. Pseudonyms,
  renumbering and quantisation all narrow this and none of them close
  it, which is why the chart is off unless the keyholder turns it on.
- **Renumbering never prevented cross-snapshot linkage**, contrary to
  what this document claimed until 2026-08-05. Exact timestamps and
  exact weights were a join key. The points are now rounded to a date
  and a histogram bin; the correction and its reasoning are under "The
  members' dashboard".
- **Small numbers say more than large ones** — but less than this
  section used to claim. "1 person, Portugal, non-binary" is *not*
  derivable, because the document publishes marginals and never a
  cross-tabulation. What a small group does expose is that somebody in
  it is Portuguese, and a histogram bin holding one person pins that
  person to a band.

What the snapshot cannot do is leak a handle, an individual row, or
anything that would let a reader be matched to a submission by name.
`dev/dashboard.test.mjs` asserts the first of those directly, over a
corpus built for it — and, as noted above, asserting it was never the
same as asserting the second.
