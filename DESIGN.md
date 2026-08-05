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
- **`server/wrangler.toml` records the deployment shape** — which
  bindings exist and what they are called. The dashboard remains the
  normal path; this is for a successor who would rather run one command
  than learn someone else's console, and it documents the bindings
  either way.

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
| Roles | no | multi-select: feeder, feedee, gainer, fat admirer |
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

5. ⬜ **`admin.html`** — token in, key in, decrypted CSV out. **Next.**

6. 🔄 **`HANDOFF.md`** — written up front, from the transfer table
   above, and revisited as each piece lands. The original plan was to
   write it last; that was wrong. Transferability shapes the code, so
   the checklist has to exist while there is still time for the code to
   accommodate it. Revisit it when the key and the form exist, since
   both add steps to it.

### What exists now

The site, the storage endpoint and the form, wired together and live;
the key generator; a keypair, whose public half is published in
`config.js` and whose private half is held offline by the keyholder;
and `crypto.js`, tested against both a fresh keypair and a stored
fixture. **The portal collects data.** A submitter fills in the form,
their entry is encrypted in their browser and appended to D1 as
ciphertext.

What is missing is the other end: `admin.html`. Until it exists the
rows accumulate and cannot be read back by anything with a user
interface — the data is safe and the key is held, but there is no
export. That is the next thing built, and it is the reason step 5 is
not optional.

## Open questions

None open. Both of the questions this document carried are settled and
recorded below.

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
