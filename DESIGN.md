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

## Threat model, honestly stated

Protected against: a breach of the storage provider, an accidentally
public Sheet, a curious Google employee, anyone reading the repo, and a
future admin inheriting the site without inheriting the data.

**Not** protected against: someone spamming the endpoint with garbage
rows (nothing stops writes), the admin's own machine being compromised
while the key is in use, or a submitter lying. Traffic analysis is also
unaddressed — the storage owner can see how many submissions arrive and
when, just not what they say.
