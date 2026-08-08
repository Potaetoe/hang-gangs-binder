# Handing this project to someone else

Written while the project is being built rather than afterwards,
because the transfer story is a design constraint here and not a
postscript. `DESIGN.md` explains *why* it works this way; this file is
the checklist.

> **Every procedure in this file works against the deployment as it runs
> today.** The export token still opens the export page; the dashboard is
> still public; nothing here needs a Telegram sign-in.
>
> The accounts redesign, decided 2026-08-05, is **fully built as of
> 2026-08-07 and not deployed.** Every build step is done and the live
> endpoint and site are unchanged — see `server/README.md` for why the
> Worker goes after the site and never before.
>
> **What changed here on 2026-08-07, and why the earlier plan was wrong.**
> This file used to say it would be rewritten *after* the cutover, on the
> grounds that a runbook describing a system that does not exist is worse
> than a stale one. That reasoning is right and the conclusion drawn from
> it was not: it makes the rewrite a step **inside** the cutover, which is
> a busy, partly irreversible operation with a table drop in it, and
> "remember to also rewrite the prose" is exactly the step that gets
> dropped. The failure it was protecting against is then reached by a
> different road — the keyholder following a stale file, during the one
> hour it is most likely to be stale.
>
> So each affected procedure now states **both**: what it is today, and
> what it becomes after the cutover, marked. Nothing here describes a
> system that does not exist without saying so. The four places it matters
> are the four-things-move table, reading the submissions, unpublishing,
> and a new bootstrap step for making a successor an admin.

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

**After the cutover there is a fifth thing, and it is the only one that is
not a file or an account.** Admin rights are a **numeric Telegram id** in
the Worker secret `ADMIN_TELEGRAM_IDS` — not a handle, because a handle can
be changed and reused and a numeric id cannot.

| Thing | What it gets you | How to hand it over |
| --- | --- | --- |
| **An admin id** | Fetches the ciphertext, publishes, deletes a row | Add their numeric id to `ADMIN_TELEGRAM_IDS` in the Worker's secrets. |

Read access becomes the private key **plus** an admin session, and the
export token stops being the routine credential — see "Reading the
submissions". It does not stop mattering: it is what gets you in when
sign-in itself is broken.

**Getting a successor's numeric id, which is the part with a chicken-and-egg
in it.** They cannot read it off the export page, because they cannot open
the export page until they are an admin.

They sign in on the live site first — any member can. The sign-in response
carries their own numeric id, and `session.js` keeps it in the tab, so
**today the way to read it is the browser's devtools**: after signing in,
Application → Session storage → the `hgb-session` entry, field
`telegramId`.

That is clumsier than it should be. `worker.js` returns the id with a
comment saying it is *"so a first-time admin can read their own id off the
page"* — and **no page displays it.** The value arrives, is stored, and is
never shown. Filed as its own issue rather than patched here; when a page
shows it, this paragraph gets shorter.

Then add that number to `ADMIN_TELEGRAM_IDS` in the Worker's secrets, and
have them **sign out and back in**. The session is minted with its admin
flag at sign-in and the flag is stored on the session row, so changing the
secret does not upgrade a session already sitting in a tab — it will keep
being refused until a new one is issued, which looks exactly like the id
being wrong.

If both of you are locked out — no admin id works, or the bot has been
removed from the group — `ALWAYS_ALLOW_TELEGRAM_IDS` and `EXPORT_TOKEN` are
the two ways back, and both are set in the Cloudflare dashboard.

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

  **A rotation now has a second step, and it is not optional.** Since
  2026-08-07 the production key's fingerprint is pinned as a message in
  the Telegram group, and `submit.html` displays the key it is actually
  encrypting with so a member can compare the two. The page updates
  itself — it reads the live value — but **the pinned message does not.**

  Update it in the same sitting as the rotation. A fingerprint that
  disagrees with the live site is the one alarm this mechanism can
  raise, and one that disagrees for a benign reason teaches everybody to
  ignore it. A stale anchor is worse than no anchor, which is why this
  is here rather than on a checklist somewhere.

  Nothing enforces it. No agent can see a Telegram group, and no check
  in this repository can reach one.
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

## Reading the submissions

`apps/web/admin.html` on the live site, which is a public page and
useless without both secrets. Publishing it costs nothing; it is the
key and the token that gate the data, not the address.

1. Open it, paste the **export token**, and give it the **key file** —
   either paste the JSON or use the file picker. The file is read in
   the page. It is not uploaded, and nothing is saved.

   **After the cutover there is no token box.** The page requires an
   **admin session** — sign in on the live site with a Telegram account
   whose numeric id is in `ADMIN_TELEGRAM_IDS`, and open the export page in
   the same tab. A member session is refused with a message saying so
   rather than an empty page. The key file step is unchanged: it is still
   the second of two secrets, still read in the page, still never
   uploaded.

   The session is tab-scoped, so closing the tab signs you out. That is
   deliberate and it is the same property that makes "close the tab" a
   safe way to leave this page.
2. **Fetch and decrypt.** It pulls the ciphertext, opens each row in
   your browser and builds the CSV there.
3. **Download CSV**, or **JSON** if something other than a spreadsheet
   is going to read it. Below that is a dashboard built from the same
   rows — weight over time, distributions, breakdowns and BMI.

Things worth knowing before you rely on it:

- **Rows that will not open are listed, not hidden.** If you have
  rotated keys, expect the older rows to fail with the newer key. That
  is not damage — the old key still reads them. This is why a rotated
  key is archived rather than destroyed.
- **Duplicates are normal.** Storage is append-only and the form cannot
  read what is already there, so anyone resubmitting adds a row. Sort
  it out here; the repeats double as weight-over-time history.
- **Both unit systems are in every row**, plus what the submitter
  actually typed. When a rounded value looks wrong, `entered_*` is the
  column to trust.
- **Cells starting `=`, `+`, `-` or `@` arrive with a leading
  apostrophe.** That is deliberate — a spreadsheet would otherwise run
  them as formulas. Nothing legitimate starts that way.
- **"One per person" and "every entry" are different numbers.** The
  dashboard has a toggle because both are legitimate: one answers what
  the group looks like, the other what was submitted. Someone who
  submits monthly pulls every average toward themselves under the
  second.
- **The units toggle changes the charts and nothing else.** Both
  downloads always carry both systems, so an export is never a snapshot
  of whichever radio happened to be selected.

## Publishing the public dashboard

`apps/web/dashboard.html` shows the group's numbers to anyone, with no
key and no token. It is not live: it shows whatever was last published,
and publishing is a button you press.

**After the cutover it is members-only.** Reading the published snapshot
needs a member session — any signed-in member, not an admin. What it
contains did not change and was not relaxed: still counts, medians and
histogram bins, still no handles and no rows. Gating it narrowed who can
see the aggregate; it did not make the aggregate carry more.

At the bottom of the export page, after decrypting:

1. Decide about **weight over time**. It is off by default. Ticked, the
   published page gets one line per repeat submitter, labelled
   "Person 1", "Person 2" — never handles, and renumbered every time.

   **Renumbering does not stop two snapshots being lined up, and an
   earlier version of this file said it did.** Each point currently
   carries an exact timestamp and an exact weight, so the same person's
   line reappears in the next snapshot as the same set of points with
   one added — matching them is trivial. The pseudonyms only stop the
   *labels* being followed.

   So the honest version of the trade-off is: publishing this chart
   twice discloses cumulatively, and anyone who knows roughly what a
   person weighs may recognize their line. Off is the safe answer, and
   it is off unless you tick it. A fix — publishing the date and a
   rounded weight instead of the exact ones — is specified in
   `DESIGN.md` under "The members' dashboard" and not yet built.
2. Press **Show what would be sent** if you want to read it first. It
   sends nothing; it prints the document.
3. Press **Publish snapshot**. It replaces whatever was there before.

What goes out is counts, medians and histogram bins. No handles, no
rows, and the height-discrepancy panel is dropped entirely — it is a
tool for you, and published it would be a list of strangers' heights.

Things worth knowing:

- **It goes stale, and it says so.** The page shows how old the figures
  are and warns past two days. Nothing refreshes it but you.
- **There is an Unpublish button, and it needs only the token.** Not
  the key. It is in the "Public dashboard" card near the top of the
  export page, which also tells you what is currently published and how
  old it is — that part needs no credentials at all. Taking a snapshot
  down is immediate, leaves the submissions untouched, and is undone by
  publishing again.

  **After the cutover: the admin session, not the token — and the "what is
  currently published" line needs a credential too.** Reading the snapshot
  became members-only on 2026-08-05, so that part is no longer
  credential-free; it works because an admin already holds a member
  session. Still no key either way, which is the property that matters: the
  moment somebody wants a snapshot retracted is not the moment to make them
  find a key file and decrypt the corpus first.

  To change part of it rather than remove it, republish: untick weight
  over time and press Publish. The previous snapshot is replaced, not
  kept.

  If the page itself is unreachable, the same thing from a terminal:

  ```bash
  curl -X DELETE -H "Origin: https://potaetoe.github.io" \
    -H "Authorization: Bearer YOUR_EXPORT_TOKEN" \
    https://hgbinderworker.sorcererbiggz.workers.dev/snapshot
  ```

  **This command does not change at the cutover, and after it this is the
  only place the export token is used.** `EXPORT_TOKEN` stays break-glass in
  the Worker — resolved ahead of any session, deliberately — precisely so
  that a retraction does not depend on sign-in working. Keep it set and keep
  it stored somewhere you can reach without the site: the case it exists for
  is Telegram sign-in being broken, the bot token being wrong, or your admin
  id having been edited out.

  It cannot submit, and that is not an oversight — it is admin without being
  anybody, so there is no account for it to write a row to.
- **Publishing needs the export token but not the key**, and reading
  needs neither. That asymmetry is the point: the public page can be
  handed to anyone, permanently, because it never contained anything
  worth protecting.

  **After the cutover: publishing needs an admin session, and reading needs
  a member one.** The half that still holds is the half worth keeping —
  neither needs the key. What the page contains is unchanged, so it remains
  safe to hand to anyone; it is simply no longer handed to everyone.
- **A height that changed between entries is flagged.** Height does not
  change in adults, so that panel means a typo, a unit mix-up, or one
  handle used by two people. Check it before quoting a height figure.
- **Close the tab when you are done**, or press Clear. That page is the
  only place this data exists in the clear — and the dashboard makes it
  the one screen worth not leaving open behind you.

If the token is refused, it is the Worker secret `EXPORT_TOKEN` — reset
it in the Cloudflare dashboard rather than guessing. If the key is
refused, the page says which way it is wrong; a common one is pasting
the public half.

## Before you consider it handed over

- [ ] They can decrypt a real submission — not a test fixture, an
      actual row from the live database, through `admin.html` on their
      own machine. Nothing else proves the key, the token and the
      endpoint all reached them intact.

      **After the cutover this checks one more thing**, and it is the one
      most likely to be wrong: it proves their numeric id actually reached
      `ADMIN_TELEGRAM_IDS`. A wrong id there looks exactly like a working
      deployment until somebody tries to export.
- [ ] They have two copies of the private key, in two places.
- [ ] They have submitted through the live form themselves and seen the
      row arrive.

      **After the cutover they must sign in to do this**, and it is worth
      doing in that order — sign-in first, submission second — because the
      two fail for different reasons and a single "it did not work" cannot
      tell them apart.
- [ ] You have removed your own copies of anything you are no longer
      meant to hold.
- [ ] The people submitting know who the keyholder is now. They handed
      their data to a person, not to a website.

That last one is not paperwork. The whole design rests on exactly one
person being able to read this, and the submitters having agreed to
*that* person.
