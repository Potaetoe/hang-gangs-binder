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

`crypto.subtle` requires a secure context. Confirmed available on the
deployed site and on `http://localhost`; it is *not* available over
`file://`, which is why the README insists on serving the directory.

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

- Generated offline by `tools/keygen.html`, opened from disk.
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
| Telegram username | yes | The only identifier. Normalised (strip a leading `@`, lowercase). |
| Weight | yes | Stored canonically in kg, alongside what was typed. |
| Height | yes | Stored canonically in cm, alongside what was typed. |
| Units | — | lbs/in or kg/cm toggle; conversion happens client-side. |
| Gender | no | male / female / nonbinary / other |
| Roles | no | multi-select: feeder, feedee, gainer, fat admirer |
| Country | no | dropdown, ISO 3166 list |
| 18+ confirmation | yes | checkbox, recorded with the row |
| Submitted at | — | timestamp, added client-side inside the ciphertext |

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
pages that touch plaintext and keys, and both will start life as a copy
of this one.

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

Nothing below is built yet. The order is deliberate.

1. **Stand up the Worker and its database first**, so everything after
   it has something real to talk to. This was a *spike* while the
   storage was Apps Script, because the CORS round trip might not have
   worked at all; with a Worker setting its own headers it is ordinary
   work. Confirm the round trip from `dev/` anyway before the form
   depends on it — a preflight, a POST, a token-gated read back.
2. **`tools/keygen.html`** — offline keypair generator. Produces the
   private key to store and the public key to paste into `config.js`.
3. **`crypto.js` and the `dev/` round-trip test**, in that order, before
   the form. See "Encryption, concretely" above for why.
4. **The form** — fields, unit toggle, country dropdown, 18+ checkbox,
   validation, encrypt, POST.
5. **`admin.html`** — token in, key in, decrypted CSV out.
6. **`HANDOFF.md`** — written up front, from the transfer table above,
   and revisited as each piece lands. The original plan was to write it
   last; that was wrong. Transferability shapes the code, so the
   checklist has to exist while there is still time for the code to
   accommodate it.

## Open questions

- **Imperial height entry.** Two inputs (feet + inches) is what people
  expect and is the fiddliest part of the form to validate; a single
  decimal-inches field is trivial but nobody thinks in it. Undecided —
  defaulting to two inputs unless someone says otherwise.

## Threat model, honestly stated

Protected against: a breach of the storage provider, a leaked export
token, a curious Cloudflare employee, anyone reading the repo, and a
future admin inheriting the site without inheriting the data.

**Not** protected against: someone spamming the endpoint with garbage
rows (nothing stops writes), the admin's own machine being compromised
while the key is in use, or a submitter lying. Traffic analysis is also
unaddressed — the storage owner can see how many submissions arrive and
when, just not what they say.
