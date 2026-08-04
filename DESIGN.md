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
  submitter's browser                Google Sheet             admin's browser
  ───────────────────                ────────────             ───────────────
  fills the form
  encrypts to the      ── HTTPS ─>   one row per          <──  fetches rows
  admin PUBLIC key                   submission, each          decrypts with the
  (baked into the                    an opaque base64          PRIVATE key, held
  public repo)                       blob                      only on this machine
                                                               exports CSV
```

Three properties fall out of this:

1. **The storage provider cannot read the data.** Google sees base64.
   A breach of the Sheet, a misconfigured share link, a subpoena to
   Google — all yield ciphertext.
2. **The public key being public is fine.** That is what a public key is
   for. It encrypts; it cannot decrypt. Publishing it in the repo is not
   a leak.
3. **Read access is a file, not an account.** Which is what makes it
   transferable — see below.

### Why not just a database with write-only rules

Firestore rules or a Worker with an allowlist would keep the public from
*reading*, but the data would still sit in plaintext under someone's
account. Transferring it would mean transferring the account, and any
misconfiguration would expose every row at once. Encryption makes the
storage layer untrusted by design, which means picking one is a
convenience decision rather than a security decision.

### Why Google Apps Script + a Sheet

Chosen for transferability and for having no moving parts:

- A Sheet's ownership transfers to any Google account from a Drive menu.
- Free. No billing account, no CLI, no second deploy pipeline.
- Export is native, and each row is one opaque string, so the Sheet is
  doing nothing clever that could break.
- The Apps Script web app is a single `doPost` that appends a row. It
  never decrypts, never validates the contents, and has no read path.

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

The admin downloads the Sheet as CSV from Google the ordinary way, then
drops that file into `admin.html`, which decrypts it locally and returns
a plaintext CSV. Nothing is uploaded and the key never leaves the page.

This is why the endpoint has no read path — it never needed one. It also
makes access genuinely two-factor, without any of it being built:

- the Google login gets you the ciphertext
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
| Read access to the data | Give them the private key file. Nothing else. |
| The storage bucket | Transfer the Sheet's ownership in Drive, **or** have them deploy their own Apps Script and change the endpoint URL in `apps/web/config.js`. |
| The site itself | Transfer the GitHub repo, or they fork it. |

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

Everything above is inside the encrypted blob. The Sheet row carries the
ciphertext plus a server-side receipt timestamp — nothing else. In
particular the username is **not** stored in the clear, because a column
of Telegram handles next to a form about feedism is the exact thing this
design exists to prevent.

### Duplicates

Storage is append-only and every row is kept. The page cannot read what
is already stored — that is the point — so it cannot detect a repeat
submission or offer an edit. Resubmitting simply adds a row, which also
means the history doubles as weight-over-time data. Sorting out
duplicates happens at export.

## What is deliberately not here

- **No spam protection yet.** A public endpoint will eventually collect
  junk. The `doPost` is written with a single early return so a
  Turnstile check can be added without restructuring, but nothing is
  wired up until junk actually appears.
- **No service worker / offline support.** The base project is an
  installable PWA; a submission form that works offline would queue
  writes it cannot confirm. Not worth the complexity.
- **No staging branch.** Same reasoning as the base project: a push to
  `main` is a release, gated by the verify job, and verified locally
  first.

## Build order

Nothing below is built yet. The order is deliberate.

1. **Spike the endpoint before anything is built on it.** Apps Script
   and CORS is the one thing that could sink the storage choice: a
   `doPost` only returns a *readable* response if the request avoids a
   preflight, which in practice means POSTing as
   `text/plain;charset=utf-8` and letting Apps Script's redirect supply
   the CORS header. If that round trip cannot be made to work, the
   storage layer changes — and since the data is encrypted either way,
   swapping it is cheap *now* and expensive later.
2. **`tools/keygen.html`** — offline keypair generator. Produces the
   private key to store and the public key to paste into `config.js`.
3. **`crypto.js` and the `dev/` round-trip test**, in that order, before
   the form. See "Encryption, concretely" above for why.
4. **The form** — fields, unit toggle, country dropdown, 18+ checkbox,
   validation, encrypt, POST.
5. **`admin.html`** — CSV in, key in, decrypted CSV out.
6. **`HANDOFF.md`** — written once there is something real to hand off,
   from the transfer table above.

## Open questions

- **Imperial height entry.** Two inputs (feet + inches) is what people
  expect and is the fiddliest part of the form to validate; a single
  decimal-inches field is trivial but nobody thinks in it. Undecided —
  defaulting to two inputs unless someone says otherwise.

## Threat model, honestly stated

Protected against: a breach of the storage provider, an accidentally
public Sheet, a curious Google employee, anyone reading the repo, and a
future admin inheriting the site without inheriting the data.

**Not** protected against: someone spamming the endpoint with garbage
rows (nothing stops writes), the admin's own machine being compromised
while the key is in use, or a submitter lying. Traffic analysis is also
unaddressed — the storage owner can see how many submissions arrive and
when, just not what they say.
