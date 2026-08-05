# Hang Gang's Binder — design

A public submission portal. Anyone can submit their stats; exactly one
person can read them back. No accounts for submitters, no relational
database, hosted on GitHub Pages.

This document records *why* the architecture is what it is, so the
reasoning survives the conversation it came from.

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
  submitter's browser            Cloudflare Worker + D1        admin's browser
  ───────────────────            ──────────────────────        ───────────────
  fills the form
  encrypts to the    ── HTTPS ─>  one row per submission,  <──  fetches the rows
  admin PUBLIC key                each an opaque base64         decrypts with the
  (baked into the                 blob plus a receipt           PRIVATE key, held
  public repo)                    timestamp                     only on this machine
                                                                exports CSV
```

Three properties fall out of this:

1. **The storage provider cannot read the data.** Cloudflare sees
   base64. A breach of the database, a leaked API token, a subpoena to
   Cloudflare — all yield ciphertext.
2. **The public key being public is fine.** That is what a public key is
   for. It encrypts; it cannot decrypt. Publishing it in the repo is not
   a leak.
3. **Read access is a file, not an account.** Which is what makes it
   transferable — see below.

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

The admin opens `admin.html`, pastes in the export token and the private
key, and gets a plaintext CSV back. The page fetches the ciphertext from
the Worker and decrypts it in the browser; nothing is uploaded, and the
private key never leaves the page.

Losing the Sheet meant losing a native export button, so the endpoint
gains the read path the Sheet used to provide. It is gated by a bearer
token held as a Worker secret. To be clear about what that token is for:
**it is not what keeps the data confidential** — the rows are ciphertext
whether or not the request is authorised, and Cloudflare could read them
as readily as Google could have. The token exists so the corpus is not
casually harvestable and so bulk reads are not anonymous. Confidentiality
is the encryption's job, and only the encryption's.

Access stays genuinely two-factor, which is the property worth keeping:

- the export token gets you the ciphertext
- the private key gets you the plaintext

Neither alone is enough, and the two are held independently, which is
the same property that makes the handoff below work.

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
| Read access to the data | Give them the private key file and the export token. Nothing else. |
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
| Telegram username | yes | The only identifier. Normalised: a leading `@` and a `t.me/` link prefix are stripped, then lowercased. |
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
the ciphertext plus a server-side receipt timestamp — nothing else. In
particular the username is **not** stored in the clear, because a column
of Telegram handles next to a form about feedism is the exact thing this
design exists to prevent.

### Duplicates

Storage is append-only and every row is kept. The page cannot read what
is already stored — that is the point — so it cannot detect a repeat
submission or offer an edit. Resubmitting simply adds a row, which also
means the history doubles as weight-over-time data. Sorting out
duplicates happens at export.

## The page shell

Every published page shares one head and one stylesheet. The shell was
built before the form on purpose: the form and `admin.html` are the two
pages that touch plaintext and keys. The form grew into this page rather
than being copied from it — `index.html` *is* the form — so what is left
to copy is `admin.html`.

**A content security policy, in a `<meta>` tag.** `default-src 'none'`
with `script-src 'self'`, so the page can load nothing but its own
files. This is the prose rule in "Encryption, concretely" — no CDNs, no
third-party code — turned into something the browser enforces. It
matters most in the window this whole design is about: the moment
between the submitter typing their handle and the browser encrypting it,
when an injected script would see cleartext. `connect-src` gains the
Worker's origin when the endpoint lands; nothing else is added to it.

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

- **No spam protection yet.** A public endpoint will eventually collect
  junk. The Worker's `POST` path is written with a single early return
  so a Turnstile check can be added without restructuring, but nothing
  is wired up until junk actually appears. Turnstile is the natural fit
  now that the endpoint is Cloudflare's anyway.
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
"The public dashboard" below, which is where the reasoning lives.

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

Storage is append-only and the form cannot detect a repeat, so a
resubmission is a new row. "How many people" and "what was submitted"
are different questions and both are legitimate, so the dashboard has a
toggle rather than an opinion: **one per person (latest)** or **every
entry**. The difference is not cosmetic — a frequent resubmitter drags
every distribution toward themselves.

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

**Both ends, and everything between them.** The site, the storage
endpoint, the form and the export page, wired together and live; a
public dashboard reading a published aggregate; the key generator; a
keypair, whose public half is published in `config.js` and whose
private half is held offline by the keyholder; and `crypto.js`, tested
against both a fresh keypair and a stored fixture.

A submitter fills in the form and their entry is encrypted in their
browser and appended to D1 as ciphertext. The keyholder opens
`admin.html`, supplies the export token and the key file, and gets a
CSV built in their own browser. Nothing in between can read any of it.

The build order is complete. What remains is operational rather than
architectural: spam protection if junk ever appears, and keeping
`HANDOFF.md` honest as things change.

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
feature.** There are no accounts and no sessions. A static page cannot
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

## The public dashboard

`dashboard.html`. No key, no token, no account: it fetches one
published aggregate and hands it to the same function that draws
`admin.html`'s charts.

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
| Height-change panel | shown | dropped entirely |
| Everything else | identical | identical |

The pseudonyms are numbered within one document and renumbered every
time, so two snapshots cannot be lined up to follow one person across
them. That "Person 1" is the most frequent submitter is already visible
from the chart, so the numbering gives away nothing the picture does
not.

The data-quality panel is dropped rather than pseudonymised because it
is a tool for whoever can act on it. Published, it is a list of
strangers' heights and no use to anybody.

### Weight over time is opt-in

It is the one part of a snapshot still about individuals, pseudonyms or
not: anyone who knows what someone weighs may recognise their line. So
the checkbox is off by default and the keyholder ticks it. That is the
right place for the decision — it is theirs, it depends on who is in
the data, and it can be reversed by republishing without it.

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

`POST /snapshot` and `DELETE /snapshot`, both gated by the export
token, and `GET /snapshot`, gated by nothing. That asymmetry is the
point: writing and retracting are keyholder actions, and reading is
what the page is for. The `snapshots` table holds exactly one row,
forced by a `CHECK` — a history of snapshots would be more published
data about the same people, retained for nobody. Publishing replaces.

These are the only `UPDATE` and `DELETE` paths anywhere in the Worker.
The submissions table remains strictly append-only, and nothing about a
snapshot can be turned back into a submission: if it is lost, the
keyholder presses Publish again.

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

- **Retracting needs only the token.** Requiring the key would mean
  decrypting the entire corpus in order to remove something derived
  from it — backwards, and slowest at exactly the wrong time.
- **Reading the published state needs nothing at all.** It is the same
  public route the dashboard reads, so the export page can say what is
  live before anyone has typed a credential.

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

## Open questions

None open. All three that this section's goals raised were answered on
2026-08-05 and are recorded under "Next goals" above, along with the
two the document carried from the start.

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
token, a curious Cloudflare employee, anyone reading the repo, and a
future admin inheriting the site without inheriting the data.

**Not** protected against: someone spamming the endpoint with garbage
rows (nothing stops writes), the admin's own machine being compromised
while the key is in use, or a submitter lying. Traffic analysis is also
unaddressed — the storage owner can see how many submissions arrive and
when, just not what they say.

**The published snapshot is a deliberate exception, and worth stating
plainly.** It is the one thing here anyone can read: group size, group
medians, and the shape of the distributions. That is the feature. Two
honest caveats come with it:

- **Small numbers say more than large ones.** A breakdown over eleven
  people is close to a list of them, and "1 person, Portugal,
  non-binary" is a description of somebody. This matters most while the
  group is small, which is exactly when the dashboard is least
  interesting — the answer if it bites is to untick weight over time
  and republish, not to redesign the format.
- **A weight history is the most identifying thing on it**, pseudonyms
  and renumbering notwithstanding, because anyone who knows what a
  person weighs can look for their line. That is why it is off unless
  the keyholder turns it on, and why the choice sits with them rather
  than in this document.

What the snapshot cannot do is leak a handle, an individual row, or
anything that would let a stranger be matched to a submission by name.
`dev/dashboard.test.mjs` asserts the first of those directly, over a
corpus built for it.
