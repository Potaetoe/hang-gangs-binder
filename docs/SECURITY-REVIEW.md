# Defensive code review — 2026-08-26

A first-party review of our own source before we open the binder to the
group. This is quality assurance on code we own and run: the same class
of pass as the linter or the test suite, aimed at finding weaknesses in
our own handling so we can fix them ourselves.

Everything below was read in the source. Where a claim was checked
against the deployed site, it says so. Where it was not, it says that
too.

**Reference points, fetched live rather than recalled** — the OWASP Top
10 was reissued as the **2025** list, which reorders the 2021 one and
adds two categories, so the older list's numbering is not used here.
Also consulted: the OWASP Session Management and Password Storage cheat
sheets, and DISA's Application Security and Development STIG (V6R1) at
the owner's request.

---

## The short version

One real defect found and fixed: **removing an admin did not always
stick.** Nine smaller findings, none of them urgent, all listed below
with what we decided. A number of things that usually go wrong in an app
this size are genuinely right here, and those are listed too — a review
that only lists faults gives a false picture of where the risk sits.

---

## Findings, worst first

### 1. Admin removal could be silently undone — FIXED

**Severity: medium.** Broken access control (OWASP A01:2025).

The Telegram door re-granted admin on **every** sign-in to anyone the
Telegram group called an administrator. So an admin demoted through the
admin page was an admin again at their next Telegram sign-in — silently,
with nothing in the change log to explain it, and no way for another
admin to make the demotion hold.

This also quietly defeated the careful rules next to it: `setAdminRole`
refuses to let an admin demote themselves and refuses to let the site
lose its last admin, and all of that could be undone by simply signing
in again.

**Fixed** in `auth.ts`: Telegram group standing now grants admin only
when the member record is first created. Only the operator's
`TELEGRAM_ALLOW_IDS` allow-list re-grants on later sign-ins — that list
is a secret only the person holding the Cloudflare account can set, and
it is the runbook's documented way back in when the binder's own admins
are gone.

### 2. Test endpoints ship inside the production bundle

**Severity: low, with a high ceiling.** Security misconfiguration
(A02:2025).

The six `/test/*` routes are compiled into the deployed Worker and
disabled at runtime by `TEST_HOOKS !== '1'`. One of them,
`/test/admin`, makes any named account an approved admin. So a single
misplaced environment variable is a total authorization bypass.

**Checked on production**, signed in as a member: all six answer the
generic `{"message":"Not found"}` — the guard's 404, not the endpoint's
own error — and `wrangler secret list` shows no `TEST_HOOKS`. So the
control is working today.

Not fixed, because the fix is a build change rather than a code change:
the honest improvement is to exclude these routes from the production
build entirely, so the capability does not exist to be switched on. Left
for the owner to schedule.

### 3. Login CSRF on the Telegram door

**Severity: low.**

`/auth/telegram` is a GET that creates a session, so it sits outside
SvelteKit's origin checking (which covers POST form actions). Someone
could feed a victim's browser their _own_ signed payload and land the
victim in the attacker's account, where the victim's next entry would be
recorded against the wrong person.

Three things already blunt it: the payload is single-use (burned on
first use), it expires in 120 seconds, and the victim lands on a page
greeting them by somebody else's name. Closing it properly needs a
pre-authentication state token, which means giving anonymous visitors
session state — a real cost for a narrow attack. Recorded, not fixed.

### 4. Password minimum is 12 characters

**Severity: low.** Owner's call.

DISA's ASD STIG makes 15 characters a CAT I requirement (V-222536). We
require 12, and additionally check every new password against the
Have I Been Pwned breach corpus — which the STIG does not require and
which arguably stops more real compromises than three extra characters.
Raising the minimum would not invalidate anyone's existing password.

### 5. No idle session timeout — deliberate

**Severity: low, accepted.**

Sessions last 30 days with no inactivity expiry. Both the OWASP session
guidance and the ASD STIG (V-222389: 15 minutes for users, V-222390: 10
for admins) want much shorter.

This one is a genuine collision with the design, not an oversight. An
idle timeout has to record when a session was last used, and a
last-used timestamp beside a member id is exactly the activity log
DESIGN.md refuses to keep, because it could be lined up against the
group's chat. The session row deliberately carries no `created_at` and
rounds its expiry to a day boundary for the same reason. Keeping the
privacy promise costs us this control; that is the trade, now written
down.

### 6. No cap on concurrent sessions per member

**Severity: low.** ASD STIG V-222387 asks for one. A member may hold any
number of live sessions. Signing out kills one; changing a password
kills all the others; an admin passphrase reset kills all of them.

### 7. `style-src 'unsafe-inline'` in the CSP

**Severity: low.** The palette ships as an inline `<style>` in the
layout head, so inline styles must be allowed. The block is built purely
from the hardcoded palette map and never from anything anyone typed, and
a stylesheet cannot execute code. A nonce would close it properly.

### 8. Session cookie is `SameSite=Lax`, not `Strict`

**Severity: low.** Strict is the stronger setting, but the Telegram door
returns the member through a cross-site redirect, which Strict would
break. The gap Lax leaves for POSTs is already covered twice over by
SvelteKit's origin check on form actions and by `form-action 'self'` in
the CSP.

### 9. Rate limiting is per edge location, not global

**Severity: low, already documented.** `throttle.ts` says this plainly:
six tries a minute is six _per edge_, measured against production. It
turns password guessing from a script's work into a crawl; it is not a
global cap and nothing should be planned as though it were.

### 10. Registration confirms whether a username exists

**Severity: low, inherent.** "That username is taken" is a roster oracle
for a private group. It is throttled, and the alternative — accepting
duplicate-looking registrations — is worse. The sign-in door, by
contrast, gives one answer for both "no such user" and "wrong password",
and takes the same amount of time either way.

---

## What is right

Listed because it is the honest half of the picture.

- **Password storage.** PBKDF2-SHA256 at 600,000 effective iterations —
  six chained passes of 100,000, which is how you reach OWASP's current
  floor on a platform that refuses more than 100,000 in one call. Random
  16-byte salt per password, constant-time comparison, and a decoy hash
  so that an unknown username costs exactly as long as a wrong password.
  Old hashes are upgraded silently at the next sign-in. Meets ASD STIG
  V-222542.
- **Sessions.** 256-bit random tokens — four times OWASP's entropy floor
  — stored only as SHA-256, so a leaked table holds no usable
  credential. Cookies are `HttpOnly`, `Secure`, path-scoped. Sign-out
  deletes the row server-side, not just the cookie.
- **Authorization.** Every admin action across all seven admin route
  files re-checks `isAdmin` itself rather than trusting the layout, and
  there are no `+server.ts` endpoints under `/admin` (a layout would not
  protect those). Authority is read fresh from the member row on every
  request and is never cached in the session, so a role change takes
  effect on the next click in either direction.
- **Injection.** Every query goes through Drizzle's parameter binding.
  The two hand-written SQL spots are a constant template with no
  interpolation and `.bind()` calls. There is no string-built SQL in the
  app.
- **Cross-site scripting.** Exactly one `{@html}` in the whole codebase,
  building a `<style>` from the hardcoded palette map; everything else
  is Svelte-escaped by default. `image/svg+xml` is deliberately absent
  from the allowed upload types — an SVG upload would have been a script
  delivery vector. Meets the intent of ASD STIG V-222602.
- **The calculation engine.** Operations are looked up with
  `Object.hasOwn`, so a prototype name like `toString` cannot be
  submitted as an operation. Steps, exponents, and results are all
  capped; division by zero and any missing input produce a blank rather
  than a zero pretending to be data. Recipe inputs are re-validated on
  the server at save time instead of being trusted from the form.
- **The sealed identity.** AES-GCM with every record padded to a fixed
  block, so a row's length gives nothing away; socials are padded into a
  single 1 KB bucket so even the _number_ of someone's links leaks
  nothing. A record that will not open throws rather than being treated
  as empty — which is what stops a wrong secret from quietly overwriting
  a member's identity with a blank.
- **Day-only timestamps.** Verified across the schema: every
  member-linked row stores a date and no clock time.
- **Dependencies.** `npm audit` reports zero known vulnerabilities, and
  the production dependency tree is empty — everything is bundled at
  build time from dev dependencies. This matters more than it used to:
  supply chain is new at #3 in the 2025 OWASP list.

**The privacy floor:** DESIGN.md's ruling is that there is _no_ floor —
charts show whatever matches, however few people that is. Confirmed in
the code: the focused chart applies no minimum. The code matches the
ruling exactly; there is nothing to fix.

---

## Against the DoD ASD STIG (V6R1)

Checked at the owner's request. Their assumption was right: **the
Application Security and Development STIG is the only one that maps.**
The Web Server and Application Server SRGs do not apply, because we do
not operate either — Cloudflare Workers is the platform, and those
controls belong to Cloudflare. Large parts of the ASD STIG are also
structurally inapplicable to a private hobby site: DoD PKI and CAC
authentication, SAML and WS-Security assertions (four of the CAT I
items, V-222399/400/403/404), classification handling, and the
accreditation paperwork.

What does map, and where we stand:

| Requirement                                                                               | Us                                                                                             |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| V-222536 — 15-character password minimum (CAT I)                                          | **Gap.** We require 12, plus a breach-corpus check. Finding 4.                                 |
| V-222542 — only cryptographic representations of passwords stored (CAT I)                 | **Pass.** Salted PBKDF2, never reversible.                                                     |
| V-222425 — enforce approved authorizations (CAT I)                                        | **Pass**, and stronger after today's fix.                                                      |
| V-222602 — protect against cross-site scripting                                           | **Pass.**                                                                                      |
| V-222389 / V-222390 — 15- and 10-minute idle timeouts                                     | **Gap, deliberate.** Finding 5.                                                                |
| V-222387 — limit concurrent sessions per user                                             | **Gap.** Finding 6.                                                                            |
| V-222388 — sensitive data cleared at session end                                          | **Pass.** Cookie deleted, session row deleted.                                                 |
| V-222391 — a logoff capability                                                            | **Pass.**                                                                                      |
| V-222413–V-222421 — audit account creation, modification, disabling, removal              | **Partial.** See below.                                                                        |
| V-222653 / V-222654 — documented coding standards, design document maintained per release | **Pass**, unusually so: DESIGN.md and WORKING.md are exactly this, and the hooks enforce them. |

**The interesting collision.** The STIG wants the account lifecycle
audited in detail. We do log it — every approval, denial, role change,
passphrase reset and purge writes a change-log line naming the actor —
but the lines carry a **date and no clock time**, because DESIGN.md
forbids finer. An assessor would mark that insufficient granularity.
The design chose the opposite of what the STIG mandates, on purpose, and
for a reason that is right for this group. Worth the owner knowing the
two frameworks genuinely disagree here rather than discovering it later.

The general shape: on the engineering controls that survive translation
from DoD to a private community site — password storage, injection,
XSS, authorization, documented process — we are in good order. The gaps
are concentrated in session lifetime and audit granularity, and both
trace to the same deliberate privacy decision.
