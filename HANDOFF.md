# Handing this project to someone else

Written while the project is being built rather than afterwards,
because the transfer story is a design constraint here and not a
postscript. `DESIGN.md` explains *why* it works this way; this file is
the checklist.

## The one thing to understand first

**There is no recovery from a lost private key.** Every stored
submission is encrypted to it. Not the site owner, not Cloudflare, not
the person who wrote this — nobody can read the data without that file.
That is the point of the design, and it is also the way this project
most easily dies. If you are receiving it, make a second copy today.

## Four things move, and they move independently

That independence is the whole trick: whoever holds one does not
automatically get the others, and each can be handed over without
touching the rest.

| Thing | What it gets you | How to hand it over |
| --- | --- | --- |
| **The private key** | Reads the submissions | Give them the key file, out of band. Never by email, never in the repo. |
| **The export token** | Fetches the ciphertext | Read it from the Worker's secrets, or set a new one. |
| **The Cloudflare account** | Holds the ciphertext | Transfer the account, or they deploy their own — see below. |
| **The GitHub repo** | The site itself | Transfer it in GitHub's settings, or they fork it. |

Read access to the data is the private key **plus** the export token.
Neither alone is enough, and neither is an account you have to share.

## If they are deploying their own storage

The likely case, and the one the code is arranged for. They need no
help from you beyond the data itself.

1. They follow [server/README.md](server/README.md) to stand up their
   own Worker and D1 database.
2. They set `ALLOWED_ORIGINS` in their dashboard to their own site.
   **They do not edit `worker.js`.** If they find themselves editing it
   to change a URL, something has gone wrong — that variable exists so
   the code is identical on every deployment.
3. They put their Worker's URL in `apps/web/config.js` and add its
   origin to the `connect-src` of every page that loads `config.js`.
   Both. `python tools/check_web.py` fails the build if they do one and
   not the other, which is exactly the mistake this hands out — change
   the endpoint alone and the site still loads, still looks right, and
   silently drops every submission at the browser's CSP check.
4. They generate a fresh keypair with `tools/keygen.html` and publish
   the public half in `config.js`.

## Moving the existing data

New submissions are encrypted to whatever public key is in `config.js`,
so the moment step 4 above happens, old and new rows need different
keys. Decide which you are doing:

- **Rotating** — they use a new key. Old rows still need the old key,
  so the old key gets **archived, not destroyed**, and whoever holds it
  stays able to read the history. Cleanest when the handover is a
  change of custody rather than a change of person.
- **Inheriting** — they use your key. One key, all rows readable, and
  you should no longer hold a copy.

Whichever you choose, the rows carry a format version byte and their own
`crypto.js` is what reads it. If they fork and change that file's
format, rows written before the change stop opening — silently. The
fixture in `dev/crypto.test.mjs` is what tells them; point them at it.

To move the rows themselves: `GET /export` with the token returns every
row as JSON. Those rows are ciphertext, so they can be sent over any
channel you like, and inserted into the new database with an `INSERT`
per row. Nothing in them is readable in transit.

## Before you consider it handed over

- [ ] They can decrypt a real submission — not a test fixture, an
      actual row from the live database. Nothing else proves the key,
      the token and the endpoint all reached them intact.
- [ ] They have two copies of the private key, in two places.
- [ ] They have submitted through the live form themselves and seen the
      row arrive.
- [ ] You have removed your own copies of anything you are no longer
      meant to hold.
- [ ] The people submitting know who the keyholder is now. They handed
      their data to a person, not to a website.

That last one is not paperwork. The whole design rests on exactly one
person being able to read this, and the submitters having agreed to
*that* person.
