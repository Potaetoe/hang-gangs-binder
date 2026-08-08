# Daily log

The working record for this repository, newest first — decisions,
coordination, and what is left blocked on whom. What *changed in the
product* belongs in `CHANGELOG.md`; this file is for the day itself.

**One entry per day, written by both agents.** If Claude and Codex both
worked, the day has one entry describing both — append to it rather than
starting a parallel one. See `AGENTS.md`, "Where the record lives".

Starts 2026-08-05.

---

## 2026-08-07

**Landed on `accounts`:** the MCP-delegation rules and the `owner-only`
rewrite in `AGENTS.md`; **step 4** (#5) and **step 3b** (#26); the
whole-CSP pin and the gate's first self-test (#34); and the id-bindings
correction (#30). Owner-side: production `submissions` cleared (step 2,
#3), the key fingerprint pinned in the group (#29), and dev
`ACCOUNT_SECRET` set (#33). Every issue closed by hand. `main` untouched
throughout.

Step 4 was built by Codex as an MCP tool and published by Claude — the
first slice run under that arrangement. #30 was the standalone Codex,
which has its own GitHub access; the two are different instances and
cannot see each other's working tree, which is why the publishing rule
distinguishes them.

Both were rebase-merged rather than squashed, against this repository's
convention. Each is a contract commit followed by its implementation, and
squashing collapses the one place a future reader can see that the test
went in red first. History stays linear; `accounts` still has no merge
commits.

### Closing the day: two documents that had gone stale under us

`DESIGN.md`'s threat model still said the member had no way to read the
live key and pointed at #36 as open. #36 merged the same day, so the
paragraph now records what closed it and — more usefully — **why neither
half works alone**: the page is not the anchor, an attacker controlling
it controls what it shows, and the pinned message is what they do not
control.

`HANDOFF.md` had a real gap rather than a stale sentence, and it was
created today. It describes key rotation and knew nothing about the
pinned fingerprint, so **rotating the key would silently invalidate the
anchor**. The page updates itself because it reads the live value; the
pinned message does not. A fingerprint disagreeing with the live site is
the only alarm this mechanism can raise, and one that disagrees for a
benign reason teaches everybody to ignore it — a stale anchor is worse
than no anchor.

Deliberately *not* the step 10 rewrite (#11), which is still blocked and
is a whole slice. This is one obligation added where rotation is already
discussed, because it became true today and the file that owns the
subject did not know.

### #34 — the fix, and the check that could never fail

Claude. Contract first: `dev/check_web.test.py` went in red, raising
`AttributeError` on a `parse_csp` that did not exist. Left as a crash
rather than wrapped in a `try`/`except` that would have reported a tidy
failure — the contract was that the parser becomes testable, and "the
function is not there" is the honest first state of that.

**`check_web.py` had never had a test, and that is the whole cause.** Its
only verification has been manual mutation, and a mutation is written
against a *rule* — add `telegram.org` to a page, watch it fail — so it
exercises the rules and never the parser that has to find the policy
before any rule can apply. Every mutation on checks 11 and 12 passed
while the policy was simply never read. That is not an argument about
test coverage in general; it is the specific reason this bug was
invisible to the method that was supposed to catch it.

Nine mutations now fire, including three things that were not checkable
before: `default-src` widening on any page, an unreadable `content`
attribute (which now *reports* rather than skips), and a page nobody
pinned. **And a control**, because the fix has to be about the policy and
not the formatting: `admin.html` with its attributes reversed and its
policy unchanged stays green.

**One mistake worth keeping, caught before it was committed.** The first
version of the pin derived its page list from `html_pages()`. That reads
as thorough and is inert: a new page would silently inherit the baseline,
so "every page has a pinned policy" could never fail. An armed-looking
check that cannot fire is the thing this repository holds to be worse
than no check, and I had just written one while fixing another. The page
list is now written out. `DEVELOPMENT_ENDPOINT` is a literal for the
adjacent reason — `csp_gaps()` already reconciles the two files, and a
pin that reads its expectation from the thing it guards is check 5's
mistake again.

### #30 — six sentences, and a hazard the gate still cannot see

Codex, reviewed by Claude, merged as `00798a6`. The correction was wider
than the issue asked: six live statements across five files, found by
going back to the hazard in its own words rather than re-checking the
criterion — including `DESIGN.md`, which `AGENTS.md` ranks *above*
`REDESIGN.md` and which was therefore the worst remaining copy. The
argument in the commit message is better than the one the issue was filed
with: the ids are secrets **not because they are credentials**, but
because "survives a deploy" and "not in a public repository" are exactly
the two properties a secret has and a var does not.

**The review found that the hazard is still reachable.** Produced on the
branch, not argued: adding `ADMIN_TELEGRAM_IDS`, `TELEGRAM_GROUP_CHAT_ID`
and `ALWAYS_ALLOW_TELEGRAM_IDS` back under `[vars]` in
`server/wrangler.toml` leaves **all eleven checks green**. That commit
publishes the group's numeric ids in a public repository — the membership
oracle the account-id design exists to prevent — by the exact route the
issue was filed to close.

The reason is structural: `check_web.py` is `WEB = apps/web`, so
**nothing in the gate looks at `server/` at all.** Merged anyway, because
the prose fix is correct and independent, and holding it hostage to work
in another directory would pay for the check with the documentation.
Filed separately.

### Step 3b, and a check that fails open

Merged after review. Five mutations confirmed checks 11 and 12 armed in
both directions — including the pair the earlier review asked for, where
`index.html` can neither widen nor narrow its own policy, because the
expected token sets live outside the page. That is the check 5 corollary
applied correctly: a check computed entirely from the file it guards
cannot detect that the file was rearranged.

**Then the review found the thing the mutations could not.** Both CSP
searches match `http-equiv` *and then* `content`, in that order, inside
one tag. HTML does not care about attribute order; reverse them and the
search returns `None`, the exact-token pin and the spread check both
silently skip, and check 3 still passes because it only looks for the
`http-equiv` substring. Produced, not inferred: `index.html` carrying
`script-src * 'unsafe-inline' 'unsafe-eval'`, and `submit.html` carrying
the Telegram origin, **both with the gate green.**

Not fixed here and not a finding against the slice — `csp_gaps` already
carried the identical `if not policy: continue`, so it is a house idiom
reaching its limit. Filed on #34 with the reproduction. The lesson worth
keeping is narrower than the bug: **a parser that cannot read a thing
currently reports "no problem found".** Order-insensitivity fixes two
cases; failing loudly on an unreadable policy fixes the shape.

**Step 3b's CSP is provisional and its live check has not been made.**
BotFather's domain binding means localhost cannot prove the real render
or callback, so the first sign-in on `potaetoe.github.io` is the
observation. Recorded as not performed.

### Step 4, and the first delegation under the new rules

Codex wrote it in its clone; Claude posted the claim, reviewed, ran the
gate and the browser check, and pushed. Two rounds, and the review found
something in each.

**The first round's contract had a hole of exactly the shape the review
bar describes.** Two checks pinned the new three-argument `buildRecord`
while every pre-existing check still called it with two, so an
implementation making the third argument optional — falling back to
`input.telegram` when absent — would have satisfied every new criterion
and every old one and handed the typed handle straight back into the
record, gate green. That is check 5's failure again: each bullet correct,
each armed, the hazard untouched. A third check now requires the throw,
and thirteen call sites were updated to pass a session username. Twelve
were unaffected in meaning; "the handle is stored normalized" genuinely
depended on `input.telegram` reaching the record and now makes the same
claim about the session argument.

**The second round stopped at a file boundary, correctly.**
`dev/admin.test.mjs` calls `buildRecord` as a pipeline check and was
outside the claimed file list. The list was wrong, not the slice — the
claim was amended on the issue rather than the boundary crossed.

### Two operational findings about Codex-as-MCP

**Codex cannot run `tools/check.py`.** The sandbox refused to execute a
Python interpreter outside the workspace — `Access is denied`, from the
restricted token, not a missing install. Node and eslint run fine. So a
Codex report of "suites green" covers the Node suites and the linters
and never checks 1 or 3, and **running the gate is Claude's job** under
this arrangement. Working around it would be defeating a boundary, not
fixing a fault.

**The clone had no `node_modules` at all**, so checks 2 and 3 had never
run there. Installed with `--ignore-scripts`, per the reasoning in #20.

### Codex as an MCP tool, and who pushes

Codex now also runs as an MCP server that Claude drives, in its own clone,
under `workspace-write` with the network blocked. The owner chose, from
four options, that **Claude publishes what that Codex writes** — reading
the whole diff first and setting `--author` to Codex. The rejected ones
are worth recording: the owner pushing by hand puts them in the loop on
trivial commits, and routing through the standalone Codex's GitHub
connector means hand-carrying diffs between two Codexes that cannot see
each other's working tree.

The rule that keeps this honest is that **publishing a slice does not
transfer it.** The label is still the lock and still says Codex; only the
hands on `git push` moved.

### The Codex clone had drifted, silently

Found before any delegation: the clone was checked out on
`step-3-session-plumbing`, tracking `origin/main`, four commits ahead of a
branch that no longer exists on the remote. Two of those four had already
landed as squashes under different SHAs (#16, #17). Its working tree was
clean the whole time.

**A clone that cannot fetch drifts without a symptom.** `git status`
reports nothing to commit while the branch underneath it has been deleted
upstream. Nothing was rebased or discarded — the old branch ref is left
where it was, and a new `accounts` tracking `origin/accounts` was checked
out beside it. Re-syncing before *every* delegation is now the rule rather
than a thing to remember.

### Dev sign-in works — #33, and how to debug a route that will not say why

The owner set `ACCOUNT_SECRET` on `hgbinderworker-dev`. A live
`POST /auth/dev` returns a session, which is the proof that matters: it
can only be produced by `accountIdFor` completing, the exact line that
was throwing. Local dev sign-in no longer has to be faked — step 4's
browser check had to write a session into `sessionStorage` by hand.

**The debugging is the part worth keeping.** The first attempt returned
`404 Not found`, and my first diagnosis — an unset `$s` — was wrong;
`$s.Length` came back `44` and disproved it.

**All six of `handleDevAuth`'s early returns are the same 404.** Absent
secret, non-loopback origin, oversized body, unparseable JSON, non-string
secret, wrong secret: indistinguishable. That is correct — it refuses to
tell an attacker which check they failed — and it means the response can
never diagnose itself. The only method left is to enumerate the branches
in source and eliminate them.

Five fell. The one piece of real evidence *in* the response was the
status code: a disallowed origin makes `allowed` null and returns **403**
at the router, before this handler, so **a 404 proves the origin
passed**. A code that says where it failed without saying why.

What identified the last one was a length. **44 characters is base64 of
32 bytes** — exactly what the `ACCOUNT_SECRET` generator emits — so `$s`
was carrying the freshly-made account secret rather than the dev login
secret. Re-running with the right value worked first time.

**A deliberately uninformative error is good security and blinds the
owner's own debugging.** Both halves are true and the design should keep
the ambiguity; the answer is to write the elimination table down, which
is now on the issue.

Two smaller things. The 2026-08-06 note called this a 500; it is closer
to a thrown `TypeError`, because `hmacHex` guards with
`typeof key === "string"` and an absent binding reaches `importKey` as
`undefined` instead of becoming an HMAC under an empty key — that guard
is the reason the failure was loud rather than silently minting account
ids from nothing. And an **admin** dev session is available by sending
`admin: true`, which step 7 (#8) will want.

### The key fingerprint is published — #29

Pinned in the group by the owner. **Attested, not verified**: no agent
here can see a Telegram group, and that distinction is the point of the
verification rule rather than pedantry about it.

Before posting, the key was compared across four sources — the live
site, `main`, `accounts`, and the string quoted in the issue — and all
four were byte-identical, decoding to a well-formed 65-byte uncompressed
P-256 point. That comparison is a small version of the attack the issue
exists to detect, so running it was worth more than a formality.

**The recommendation changed while doing it.** The issue had said group
description; a pinned message is strictly better on the property that
matters. A description edited quietly by whoever compromised the account
is indistinguishable from one never touched, while an edited message
carries an "edited" marker and pinning posts a service message.
Visibility was the lesser reason.

**A correction to the issue's own advice.** It said "a short prefix is
enough" with no floor. Base64 carries 6 bits a character and the leading
~8 bits are structural — every uncompressed P-256 key starts `0x04` — so
an 8-character prefix is ~40 effective bits and grindable in about a day
at 10M keygens/sec. The attack is not breaking the key; it is generating
keys until one matches the published prefix. 16 characters is safe with
margin; 32 was published.

Two structural alternatives were ruled out and written into `DESIGN.md`
so they are not re-proposed: the Worker cannot verify which key a
submission used, because the ciphertext carries an *ephemeral* public
key rather than the recipient's; and the Worker cannot be the anchor
either, because after cutover it deploys from this repository and stops
being a separate trust domain.

Filed #36 for the remaining gap — a member has no easy way to read the
live key to compare against, so the anchor exists without being usable
by anyone who will not view-source `config.js`.

### Step 2 — production cleared, and a check that could not run

The owner cleared `submissions`: 1 row, dated 2026-08-05, gone, with
`sqlite_sequence` reset. Rehearsed on `hg_binder_db_dev` first — that
database was already empty, so the rehearsal proved the command ran
cleanly rather than proving it deleted anything. Step 2 is complete.

**The pre-clear snapshot check was skipped, and the reason is worth more
than the near-miss.** It was written as `curl -s -H …`; PowerShell aliases
`curl` to `Invoke-WebRequest`, which rejected `-s` with
`Missing an argument for parameter 'SessionVariable'`. The clear went
ahead without it. Checked immediately after: nothing had been
republished, so the check would have passed.

**A verification step that cannot run on the machine it was written for is
not a verification step.** It failed in the way that matters — the
sequence continued past it. The instructions now say `curl.exe`.

### The clear has a shelf life

Found after the fact, and it is the part that needs carrying forward.
`main` still ships the pre-accounts public submission form, and
production `POST /submit` answers **`400 Missing ciphertext`, not `401`**
— it validates the body and never asks for a session. So the table is
empty and refillable by any visitor, and a row arriving now carries a
`NULL` `account_id`: exactly the state accounts exists to remove.

That is why `REDESIGN.md` Part 8 put the clear *at* cutover. Doing it
early is not wrong, but it is not finished either — **re-run the clear
immediately before cutover.** One rehearsed line, against a live release
as the alternative.

### The correction that was flagged this morning, now made

`DESIGN.md`'s accounts build order marked only steps 1 and 8, and had
recorded neither step 2's unpublish nor step 3's session half. Steps 2, 3
and 4 now carry ✅ with what actually happened, including the two things a
status mark usually hides: step 3's CSP is provisional until a live
sign-in is observed, and step 4's live half cannot be proved before
cutover. `REDESIGN.md`'s table is updated in the same pass, and #10 is
noted as needing re-scoping since #26 already landed checks 11 and 12.

### The three id bindings are recorded as secrets — #30

Codex, under MCP. The remaining correction reached six live statements
across five files, not the one Part 8b still named: `server/wrangler.toml`,
the accounts setup table in `server/README.md`, the bindings header in
`server/worker.js`, the authoritative `DESIGN.md` bullet, Part 1's setup
table and `REDESIGN.md`'s top exception. All six now agree with the live
Worker and explain the rejected inference: numeric ids are not credentials,
but that does not make a committed `[vars]` block safe or make a
dashboard-only var survive a deploy.

The deployment notes also stop prescribing `wrangler secret put` for
production. The production Worker's hand-pasted script leaves it in
version-upload state, so the command fails with error 10220 for anyone;
the dashboard remains the tool until cutover, when the CLI needs to be
tested again rather than assumed fixed or permanently broken.

No executable behavior changed and no regression test was invented. A
check that greps these comments would be computed entirely from the files
it guards, so it could confirm wording while missing the deployment fact
the wording is meant to preserve.

### The pinned key became comparable — #36

Contract first across the two agents, in the arrangement `AGENTS.md`
describes: Claude committed the failing 28-check UI contract, then Codex
implemented it to green. Claude read the diff, committed `a83cc1d` with
Codex as author, and performed the local browser check. The submission
page now prints the configured public key's first 32 base64 characters
beside instructions to compare it with the pinned group message. The
pinned anchor from #29 was only half a mechanism while reading the other
half required view-source on `config.js`.

**The contract had a defect, and its first repair was worse before it was
better.** `showFingerprint truncates rather than hashing` searched the
whole of `ui.js` for `crypto` and `digest`, so the comment explaining why
the file contains no cryptography failed the check. Codex first replaced
that with a comparison against a value an earlier assertion had already
proved. It could not fail independently: a green line that added no
coverage and therefore made the suite look more armed than it was.
Review found it, not mutation. The final check guards actual Web Crypto
access syntax; explanatory prose containing both words stays green, and
a real `crypto.subtle.digest(...)` call makes that check fail alone.

The coincidence matters. #34's entry above records the check Claude
nearly shipped that could never fail; this is a second, independent
instance in the same afternoon, written by the other agent and caught in
review. Different code and different authors arrived at the same failure
shape: a check whose reassuring output exceeded what it could prove.

**Monospace is a security property here wearing cosmetic clothes.** A
member compares 32 base64 characters by eye. In the body font `I` and
`l` can be identical and `0` and `O` close enough to let a mismatch pass.
The value therefore remains a `<code>` element, inline inside the sentence
that refers to it rather than a bare child of `.card`; it gets the existing
monospace rule without inline style or a CSP change.

Source and local checks are distinct. The UI suite passed 28 checks and
ESLint passed in Codex's clone. After rebasing over #30 and #34, Claude's
twelve-check local gate passed. Claude also checked the rendered page on
localhost: the development fingerprint appeared, changed when driven with
production's key, and became computed `display: none` with zero client
rects when handed no key; there were no console errors or CSP violations.
**The widget-bound sign-in was not tested.** That browser session was
written into `sessionStorage` by hand, so the local render proves nothing
server-side and is not a live authentication check. No separate CI or
live-site result is claimed here.

One follow-up is newly unblocked rather than part of this slice. #34 held
`tools/check_web.py` when #36 was claimed and has now merged, so the gate
can gain the suggested hard-coded-public-key arm. It is worth doing:
`KEY_PATTERNS` recognizes private-key shapes only, which means a public
key pasted into a page passes check 2 today. The UI suite protects
`submit.html` in the meantime; the publishability gate should own the
repository-wide boundary next.

### The gate owns it now — #41

Claude. Check 14: no published file except `config.js` may carry a base64
key-shaped literal. The interim assertion **left** `dev/ui.test.mjs` rather
than being duplicated there, and the deletion is commented as deliberate so
the next reader does not restore it "for safety".

The design decision worth recording is where the exemption lives. Exempting
`config.js` **by name** creates a way for this arm to be inert: if the
pattern simply matched nothing in the repository, every test would pass and
nobody would know the check was dead. So `dev/check_web.test.py` asserts the
inverse — that `config.js`'s real content *does* match, and that it is the
name-based exemption sparing it. That check is the one that would notice the
arm rotting.

The mutation was run on the real gate, not just on the rule: the production
key pasted into `submit.html` fails `tools/check_web.py`. The message reports
a length and a 12-character prefix rather than the literal, because it goes
into a CI log and printing the value would publish the thing the check exists
to keep out of public places.

One honest limitation: base64's character class contains hex, so a 60+
character hex constant in a published page would also trip this. Left as-is
rather than narrowed — a long hex literal on a published page is worth a
human look too, and narrowing the pattern to exclude it would be tuning the
check against a false positive that has not happened.

### Running Codex and Claude at the same time, and what it actually cost

Coordination, not product. The two ran in parallel for the first time: Codex
on step 7 (#8, PR #42) then step 6 (#7), Claude on #41 throughout.

**The mechanism is batching, not backgrounding.** Claude Code auto-backgrounds
an MCP call at two minutes, but a Codex call that stops to ask returns in
well under that, so the auto-background rarely fires. What produced real
overlap was issuing the `codex` call in the *same* tool block as Claude's own
work. Waiting on the reply before starting is the failure mode, and it looked
exactly like working.

**Codex stopped and asked three times, and was right every time.** Twice it
found that a suite's stated scope forbade what it had been told to do —
`dev/admin.test.mjs` and `dev/dashboard.test.mjs` both declare themselves
pure-half suites with no DOM harness — and once it found that registering a
new suite would collide with an unmerged branch. That last one mattered: PR
#42 renumbered `tools/check.py`'s docstring and both its counts, so #7
branched off `accounts` would have disagreed with it about the total. #7 is
therefore based on #42's branch, said out loud on the issue per `AGENTS.md`
rather than discovered in a diff.

**Both issues' file lists were wrong in the same direction**, and this is the
reusable part: the Worker was gated ahead of the pages. #8 named
`server/worker.js`, which needed nothing, and turned up a *fourth*
unauthenticated request nobody had noticed — `refreshPublishedState` fetching
`GET /snapshot` bare, with a comment above it still asserting the route was
public. #7 named `dashboard.js`, which contains no `fetch` at all; the bare
request was in `public.js`. **Anyone taking #6 or #10 should read the Worker
before trusting the issue's file list.**

**A third thing the MCP Codex cannot do:** create or switch a branch. Its
clone's `.git` is not writable by the sandbox — `fatal: Unable to create
'.git/index.lock': Permission denied`. Claude must create the branch before
every delegation, alongside the re-sync. Unlike the network failures, Codex
reports this one honestly instead of treating it as ordinary shell noise.

**What did not parallelize**, and is the real ceiling: posting the claim,
running the Python gate, reading the whole diff, and pushing are all Claude's.
Reading a diff properly is not a rubber stamp, so the join is a genuine
bottleneck and the throughput gain is smaller than two agents suggests.
`AGENTS.md`'s "do not manufacture parallelism" held up — what made this work
was that #41 and the two Codex slices had genuinely disjoint file lists, and
the moment they stopped being disjoint the base had to change.

### Merged: steps 7 and 6, and #41 — and what the stack cost on the way out

All three landed on `accounts` by rebase, in that order: `49dae8c` (step 7),
`3e2bead` (#41), `7000a28` (step 6). Rebase rather than squash so the two
Codex commits keep `Codex Sol 5.6` as author with Claude as committer;
`accounts` still has no merge commits. The gate was then run on the **merged
result** rather than only on each branch — all 14, both new suites — because a
new file has never been linted before it lands and three disjoint branches
combining is exactly where that bites.

**The stacked PR cost two things, neither of which was the conflict it
avoided.** First, it got no CI at all: `deploy.yml` filters
`pull_request` on the **base** branch, so a PR based on another slice's branch
never triggers a run — not a queued one, none. `workflow_dispatch` on the
branch was the fix, and it is safe rather than a workaround, since the deploy
job is gated on `github.ref == 'refs/heads/main'`.

Second, and this was avoidable: merging the parent with `--delete-branch`
**auto-closed the child PR**, and a closed PR whose base branch no longer
exists can be neither reopened nor retargeted. #44 had to be replaced by #45
off a rebased branch. The right order is retarget the child to `accounts`
first, then merge the parent — or merge the parent without deleting its branch
until the child is retargeted. Both findings are worth a rule; spun out as a
separate documentation slice rather than bolted on here.

Product entries for both Codex slices are in `CHANGELOG.md` under 2026-08-07.
They were deliberately kept off both branches: `CHANNEL.md` records 2026-08-05,
when both agents wrote a changelog and a daily log for the same day unaware of
each other and the work had to be merged by hand. Two parallel branches both
appending to one day's entry is that same collision with a git conflict
attached, so the publisher wrote them once, after the merges.

### The documentation slice that was spun out — #46

Claude. Three findings from today became durable rules in `AGENTS.md`; the
two above and the branch-creation one recorded further up under "Running
Codex and Claude at the same time". Nothing new was discovered here, and the
entry exists so the loop the section above left open is visibly closed rather
than left as an intention.

**Where each one went is the part worth recording, because the placement was
the decision.** The two CI hazards went into "When CI is backed up", directly
under the bullet that *causes* them — the file already said to branch from an
unmerged branch when nothing disjoint is left, and that instruction is what
walks an agent into a PR with no checks. A hazard filed away from the advice
that produces it is a hazard nobody reads in time. The branch-creation
finding went into "When Codex runs as an MCP tool" as a numbered step
**between the re-sync and the claim**, because its whole content is *when* it
has to happen: discovered at commit time it is a rebase, done before the
delegation it is one command.

**The `workflow_dispatch` rule is now stated in both directions and
cross-linked**, which was not merely tidiness. Verification already said a
dispatch on `main` *is* a release and to never reach for it as a routine
re-trigger; the stacked-PR remedy is that same dispatch, and it is safe for
exactly the reason the warning is true — the deploy job tests the ref. One
sentence in each place, each pointing at the other, so neither reads as
contradicting the one an agent happens to find first.

**Also cross-linked into Verification's "a run that is absent may appear
minutes later".** That rule tells you to wait, and waiting is precisely wrong
here. Two absences that look identical and want opposite responses is the
shape this repository keeps finding — `wrangler whoami`'s misdiagnosis, the
abbreviated `head_sha` returning `total_count: 0` — and the fix is the same
each time: name the second case where the first one is written down.

The machine-local half of the branch finding — that this is a property of the
Codex sandbox on this machine, alongside its inability to run
`tools/check.py` — went to the workspace's `SETUP_NOTES.md`, which is not in
this repository.

**Verification note, and it is not this change.** The gate reads 14/14 green
from this branch, but it was run from a worktree under `.claude/worktrees/`.
That directory is *inside* the repository, and it is the same worktree whose
stale `main` checkout made another session's eslint run report 168 errors
against a change that touched two Markdown files — fixed in `05b92b6` while
this slice was in progress, by ignoring `.claude/**`. The base moved twice
underneath this branch in the course of a documentation-only change, which is
the workspace note about more than two live agents being right in practice.

### The board was lying in three different ways — #48

Claude, auditing labels after #46 merged. All three are fixed; the reusable
part is that **none of them was visible from `gh issue list`**, which is the
command `AGENTS.md` tells you to run before claiming anything.

**Six closed issues still carried a lock label** — `codex` on #1, #2, #4 and
#25, `claude` on #9 and #19, every one with a merged PR. The rule was already
written: *"An issue whose PR has merged but whose label is still on it reads
as held."* Nothing was wrong with it. It simply was not run six times, which
is what a rule enforced only by remembering looks like after a month. Removed.

**Two `blocked` labels outlived their blockers**, and each issue **names its
own blocker in its body**, so the staleness was derivable without judgment.
#6 says "blocked by step 4" and step 4 (#5) merged as PR #35. #10 says
"blocked by steps 0 and 3" and both closed long ago.

**#10 was worse than mislabelled — it was finished.** Every row of its table
had already landed through #26, #34 and #41: check 2's bot-token shape, check
6's named exemption list, `FORM_PAGE` pointing at `submit.html`, check 10's
five-page nav, and checks 11 and 12 themselves. The gate is **14 checks, not
the 12 this step planned**, because #34 and #41 added two nobody had planned
at all. Its own "done when" — mutation coverage on 11 and 12 — is recorded as
met further up this same entry.

**So a build-order step can be completed by other slices without anyone
updating the step that planned it**, and the board shows no sign of it. The
label said blocked, the state said open, and the two were wrong for different
reasons at the same time.

That is the shape this repository keeps meeting rather than a new one. A run
that was never created reads as green. A stale claim reads as held. An
abbreviated `head_sha` reads as "never ran". **The common failure is an
absence that renders as a normal state**, and the fix has been the same every
time: find the second reading and write it down beside the first.

The cheap check, worth doing at claim time rather than in an audit: **if an
issue names a blocker, look at whether the blocker is closed.** It is one
query and it would have caught both.

Not closed: #10 itself. The evidence is a source read rather than work done,
and closing a build-order step changes the build order, so it went on the
issue as a recommendation. The label was fixed because a wrong label is wrong
whoever fixes it; the close is a decision.

---

## 2026-08-06

**Landed on `accounts`:** step 3's session half merged, repo-wide code
standards, and the suppression floor. `main` untouched at `b6a984f`
throughout; every CI run shows `deploy: skipped`.

Claude and Codex. Codex resumed with the two deliberately ordered slices
that both touch the sign-in page; issue #25 goes first so issue #26 starts
from settled navigation.

### Standards, decided and built

The owner chose external linters, a full retrofit, American spelling,
and a review bar of *attack the named threat*. Three of the four went
against my recommendation and the fourth was mine.

- **ESLint and Ruff**, registered in *both* suite lists. A linter is a
  gate, not a build — `apps/web` still ships verbatim, nothing is
  rewritten, formatting is never automatic. `DESIGN.md`'s no-bundler
  paragraph is amended rather than contradicted, and the test for future
  tooling is written down: **does it change what ships, or refuse to
  ship?**
- Ruff immediately found a **loop-variable closure** in
  `check_web.py`'s config parser. It read correctly only while called in
  the same iteration; stored and called later it would report the last
  arm's values for every arm — a config check passing while describing
  the wrong environment.
- **`.gitattributes`** — and a correction: the repo was never broken.
  `core.autocrlf=true` is one machine's setting and git storage was
  uniformly LF all along. The exposure was that nothing in the repo said
  what the answer should be, so it was whoever committed last.
- **American spelling**, 114 replacements. Four were identifiers and one
  crossed a file boundary: `normaliseTelegram` is an exported API.

### The adversarial review

Attacked the whole project on request. Seven findings, all filed as
slices (#20–#26), and the sharpest ones were against **my own decisions
from the same day**: 87 npm packages added to a repo that documented a
rejection of third-party code, and a frozen `main` with no hotfix path.

### The suppression floor — #19, merged as `265dfbe`

The finding that mattered. A published snapshot of a plausible
24-person group said *"exactly one member is in Japan"* and *"exactly
one member is nonbinary"*, and `ROLE_VOCABULARY` is
feeder/feedee/gainer/admirer, so a singleton published a named person's
kink role to the open web.

**The reasoning it replaced was nearly right**, which is why it lasted:
rows are dangerous, aggregates are safe. True for large N. **At
twenty-four an aggregate of one is a row.** Worse, the quantisation work
had closed a real join key and left confidence *higher* than before.

`MIN_CELL = 5`, with three properties that each took a mistake to find:

- **Subtraction is the attack, not redaction.** Published cells still
  sum to the group, so nothing is recoverable by arithmetic.
- **Histograms merge rather than bucket**, so shape and total survive.
- **One partition, not two.** Found by attacking the hazard rather than
  confirming the rule, and the same shape as the check 5 gap: the two
  unit systems bin different fields at different widths, so both could
  satisfy the floor while an overlay recovered a finer partition.
  Differencing cumulative counts produced sub-floor cells in **2899 of
  3000** random groups.

**My first fix for that was worse than the bug** — it took each
system's edges from the min and max actually in the group, fitting the
edge to a real person's weight. Edges are converted, never re-derived.

**A false alarm worth keeping:** my initial intersection test measured
against the raw values, which an attacker does not have. An attack must
run against the published document alone or it measures the wrong thing.

Also caught: `render()` dereferences the basis immediately, so a
suppressed `null` basis would have **white-screened the public page**.

Nine mutations. One survived the first pass — BMI bins — because the
check named the bin sets I thought of rather than gathering them all.

### Learned about the tooling

**`Closes #N` does not fire while `main` is frozen.** GitHub auto-closes
only on the default branch. #19 merged green and left its issue open.
Now in `AGENTS.md`; every slice needs closing by hand until cutover.

### The suppression floor shipped and the exposure stayed up

Found while probing production to write the cutover procedure, hours
after #19 was closed as fixed: `GET /snapshot` was still serving the
snapshot published 2026-08-05T17:24, unauthenticated, describing
**exactly one person** — gender, both roles, a 65–70 weight bin. The
thing #19 is about, live, on the day it was fixed.

**Neither half of the fix could have reached it.** The floor runs in the
code that *assembles* a snapshot; the published artifact is an assembled
row in the `snapshots` table, and nothing re-evaluates it. And the floor
is on `accounts`, undeployed, so even rebuilding would not have applied
it.

**The plan had no one going back for it either.** Unpublishing belongs
to step 2, and step 2 had moved to the cutover — so the live object was
scheduled for retraction at the *end* of the redesign, on an unstated
assumption that it was harmless meanwhile. At n=1 it was not.

Taken down with `DELETE FROM snapshots WHERE id = 1` against
`hg_binder_db`, verified at the endpoint. `submissions` untouched at 1
row, so the snapshot is rebuildable from `admin.html` — nothing lost.
Step 2 is now only the clear.

**Carry forward: a fix that prevents producing a bad artifact does not
retract the ones already produced.** When a privacy fix lands against a
publisher, ask separately what is published *right now*. The code
review answers "will this happen again", not "is it happening".

Second-order, and the reason it went unnoticed for a day: this project
verifies deployments with unauthenticated probes designed to tell
failure modes apart, and a *successful* `GET /snapshot` reads as healthy.
Nothing looks at what the success contains.

### The sign-in route and honest UI contract — #25 (Codex)

Started from the current `accounts` tree after reading the consolidated
instructions and the issue handoff. `BinderUI.checkedValue` accepted a
third `scope` argument that no product caller passed, so the apparent
collision protection was inert. The parameter is removed rather than
wiring three additional caller files outside the slice; the global lookup
is now the visible, test-pinned choice.

All five static navigation blocks gain an explicit route to `index.html`.
The old navigation check only compared the blocks, so five identical
omissions passed. Its contract now requires the sign-in route itself — the
hazard is a signed-out visitor stranded away from the only page that can
mint a session, not merely markup drift.

The two contracts were committed before the implementation. Against the
base, the UI suite failed the arity assertion and the publishability check
reported all five missing routes; both passed after the product change.

### The Telegram widget and the CSP it actually requires — #26 (Codex)

The expected two-origin policy was not enough. On the real local page,
Telegram's legacy `telegram-widget.js?22` failed before creating its iframe:
callback mode turns `data-onauth` into a function with `eval`, so the browser
reported the missing `'unsafe-eval'` directive. Reading the shipped script
confirmed that behavior rather than inferring it from the design table.

The owner chose the narrow callback policy over redirect mode. Redirect mode
avoids eval by putting the signed Telegram payload in a URL, which would send
the numeric id and handle through a GitHub Pages request before the page could
clear it. The accepted policy instead confines `'unsafe-eval'`, Telegram's
script origin, and the observed OAuth iframe origin to the sign-in-only page.
That page holds no form, plaintext, key, or `crypto.js`.

Checks 11 and 12 were committed first. Mutations proved that loading
`crypto.js` on `index.html`, copying a Telegram origin to `submit.html`, or
copying `'unsafe-eval'` there each fails independently. The unsafe-eval
mutation found a bug in its own first regex: a semicolon after the token let
it pass. The corrected parser treats whitespace and semicolons as CSP token
boundaries. Check 2 also recognizes the structural BotFather token shape;
only a fake value was used to arm it.

Claude's review produced the hazard the first version did not cover:
`index.html` itself could gain `'unsafe-inline'` and an arbitrary script
origin while all eleven stages stayed green. The review fix rebases onto
`accounts` at `4d8f278` and pins that page's `script-src` and `frame-src` to
the exact observed token sets outside the page. Widening the script policy,
removing `'unsafe-eval'`, and replacing the OAuth frame origin with `'none'`
each now fail exactly once; restoring each returns the gate to green. The
page and checker comments also say what is actually true: the widget cannot
reach submission plaintext or the private key, but it can reach the session
after sign-in.

With the final local policy the 238×40 OAuth iframe has a rendered box and no
console violation, then says `Bot domain invalid` as expected on localhost.
The real widget render and callback remain a cutover check on
`potaetoe.github.io`; source and localhost cannot prove BotFather's binding.

The spike also found the previous preview server still listening on 8124 and
serving the #25 tree alongside the new process. PID 31516 was terminated only
after its exact provenance was known. The final preview used one listener,
and port 8124 was confirmed free afterward.

### Open threads

**BotFather is done** — bot created, `/setdomain` → `potaetoe.github.io`
returned success. That was the only owner errand blocking the build order.
#26 followed #25 from the settled `index.html` and is now implemented for
review; live rendering and callback stay on the cutover checklist.

Remaining owner items are not blocking: #29 (key fingerprint in the
group description) and the live `/auth/dev` mint.

Claude is writing the cutover procedure into `REDESIGN.md` — the sitting
is now four irreversible acts, not the two Part 8 describes, and Part
10's Worker rollback names a commit that production does not match.

---

## 2026-08-05

**Landed:** 17 commits, `main` at `b6a984f`, CI green. Later the same day
`main` was frozen there and work moved to the `accounts` branch.

**Open at end of day:** draft PR #17 (step 3, session half); review issue
#18; one owner errand on the critical path.

Two agents worked: **Claude Opus 5** and **Codex Sol 5.6**. Codex took
steps 0, 0.5 and the session half of step 3; Claude took step 8, the CI
and release-model work, and review.

### The shape of the day

Three phases, and the middle one changed how the rest of the project gets
built.

**Morning — finishing the first system.** The export page and its
dashboard, the spreadsheet writer, the public dashboard, site navigation,
the desktop layout. At the end of it both ends of the original design
existed and were live: submitters encrypt in the browser, the keyholder
exports in theirs, nothing in between can read anything.

**Midday — the redesign, and the correction that caused it.** A privacy
claim in `DESIGN.md` was false: renumbering pseudonyms between published
snapshots never stopped anyone lining two snapshots up, because exact
timestamps and weights were a join key. Fixing it properly meant
quantization, which landed the same day.

The larger thread was spam, filed as an operational problem — a nuisance
if junk ever appeared. Pulling on it produced accounts, sessions, a
deletion path and a gated dashboard, because nothing built could undo a
flood of junk rows. **A problem whose damage cannot be reversed by
anything in the system is not an operational problem, whatever it looks
like from the outside.** `REDESIGN.md` is the plan that came out of it.

**Afternoon and evening — two agents.**

### Decisions taken today

- **The split is by slice, not by phase.** `CODEX.md` was committed saying
  Claude-plans / Codex-implements and was revised the same day: whoever
  takes a slice specs it, tests it and builds it; the other reviews with
  authority to block.

  The reason is specific to this repository — its design facts have
  consistently come *out of* implementation. A wall between planning and
  building sits exactly where the information flows.

  **This revision was never written into the repository**, which is why
  Codex went on describing itself as the implementer in its own
  documents. Corrected at the end of the day in `AGENTS.md`.

- **The contract between agents is a failing test, not a paragraph.**
  Commit the test first, implement to green. Where behavior cannot be
  known in advance, *spike then specify*.

- **Coordination runs through GitHub, not through the owner.** Eleven
  issues, one per build step, each naming the files its slice may touch.

- **The lock is a label, not an assignee** — both agents publish as
  `Potaetoe`, so GitHub cannot tell them apart.

- **Refer to slices by step number, never by issue number.** Issue #9 is
  step 8.

- **Parallelism is limited and should not be manufactured.** On a chain
  the second agent's value is review, not throughput.

### Coordination mechanics that had to be worked out

- Codex works in a **separate clone**, not a worktree of the main tree —
  stronger isolation than planned, and it means an uncommitted edit in
  one tree can never surprise the other.
- Codex's local Git and GitHub CLI could not read the machine's existing
  GitHub credentials, so it published through the GitHub connector
  instead. **Consequence worth knowing:** the connector constructs its own
  commit objects, so an identical tree arrives on the remote under a
  different SHA. Codex's local `60e50c2` and the pushed `21deba7` have
  byte-identical trees. Verify integrity by comparing blob and tree SHAs,
  not commit SHAs.
- Deployment authority stayed narrow throughout: Codex ran no Wrangler
  command, handled no secret, and made no D1 or production change.

### Step 0 — shared page wiring (Codex)

Issue #1, merged in PR #14; CI registration followed in PR #15.

- Added frozen `globalThis.BinderUI` in `apps/web/ui.js` — element lookup,
  visibility, checked-radio selection, status messages, guarded startup.
- Rewired form, dashboard, public dashboard and admin onto it **without**
  moving network behavior into `ui.js`; `dev/ui.test.mjs` pins that as an
  architectural rule (no `fetch`, no POST).
- The suite landed registered in `tools/check.py` but **not** in GitHub
  Actions, so it passed locally and never ran in the pipeline. Caught and
  fixed in PR #15. **There are two suite lists and they have to be edited
  together.**

### Step 0.5 — development isolation (Codex)

Issue #2, merged in PR #16.

- Added the `hgbinderworker-dev` Wrangler environment with preview URLs
  disabled and the development D1 bound as `DB` — not the binding name
  `d1 create` prints, which would have deployed cleanly and failed on the
  first query.
- Removed loopback origins from the production Worker; they live in the
  development environment now.
- `config.js` selects by exact hostname, aliases `127.0.0.1`, and fails
  closed on unknown hosts.
- Expanded `check_web.py` to validate both arms, and moved its
  `connect-src` test from substring to exact token matching.
- Nine deliberate mutations run before handoff.

### Step 3 — session half, before the bot (Codex)

Issue #4, draft PR #17. Session commit `21deba7`, later rewritten to
`539e6ea` — same tree, rebased onto `accounts` with the reasoning moved
from the PR body into the commit message.

- Frozen `globalThis.BinderSession`: validated tab-scoped storage, expiry,
  removal of malformed values, bearer headers, signed-out redirects,
  visible development-session markers.
- The common half of `auth.js` — development auth and the future widget
  callback share one POST/store/redirect path.
- Form moved to `submit.html`; `index.html` is a sign-in-only shell that
  does not load `crypto.js`.
- Break-glass preserved: loading `session.js` does not gate `admin.html`.

Verified green: nine gates, 303 Node assertions, 27 focused session/auth
checks, browser checks using computed styles and client rectangles, and
three mutations.

### What the day cost, and what it bought

The two-agent setup immediately exposed a gap it created: CI fired only on
pushes to `main`, so under branch-and-review every check ran *after* the
merge. PR #12 was merged on a local gate alone. Fixed the same day.

### Review of PR #17 (Claude)

Reviewed in a scratch worktree, gate re-run rather than accepted: all 9
pass. The code is good — the pure/DOM split holds, tests load the shipped
files, `index.html` genuinely does not load `crypto.js`.

**Blocked initially, and not for a code defect.** The PR said the deployed
Worker already refuses unsigned submissions. It does not:

```
POST https://hgbinderworker.sorcererbiggz.workers.dev/auth/telegram
  -> 404 {"error":"Not found."}
```

The live Worker is still the old hand-pasted one. Merging to `main` would
have published a portal that refuses everybody. Resolved by the release
model change below rather than by changing the code.

### The release model changed

Owner's call: **`main` stays at the last complete release until every step
of the redesign is finished.** Steps go to the `accounts` branch.

**`main` is the last state worth serving, not the newest state that passed
its tests.**

One trap surfaced implementing it. The `deploy` job was gated by
`if: github.event_name != 'pull_request'` — which excludes pull requests
and nothing else, correct only while `main` was the single branch in the
`push` trigger list. Adding `accounts` there would have published a
half-built redesign on every push. The condition now names the branch that
releases.

**A branch that deploys because of what it is *not* is one trigger-list
edit away from deploying.**

Falls out of it: step 2 leaves the critical path and moves to the cutover,
alongside deploying the accounts Worker — both irreversible, both the same
moment.

### Full review of Codex's work, and a live gap it turned up (Claude)

All four Codex commits reviewed, posted as issue #18.

`check_web.py` check 5 exists to catch production pointing at development.
It did not. Swapping the production and development `publicKey` values
left the entire gate green — mutation-proven.

The endpoint half of that swap fails loudly. **The key half is silent and
unrecoverable**: production rows seal to a key the keyholder does not
hold, and nothing can turn plaintext back into ciphertext.

**The specification was at fault, not the implementation.** `REDESIGN.md`
asked for "no two arms share an endpoint or a public key"; Codex built all
four bullets correctly and every one is armed. But **two swapped arms are
still distinct**. `DESIGN.md` names that exact failure one paragraph
before prescribing the check that cannot catch it.

**The reusable lesson: a check computed entirely from the file it guards
cannot detect that the file's contents were rearranged.** When the
invariant is "this specific value belongs *here*", something outside the
file has to say so.

Fixed in `460ffef` — production's key and endpoint pinned as constants,
plus the reverse direction. Six mutations, both directions.

Also raised: empty commit message bodies on all four Codex commits; a dead
`scope` parameter on `checkedValue` alongside a `name="units"` collision
across pages; and an open question about who holds the development private
key.

### End of day — one record instead of two

Both agents independently wrote a changelog and a daily log for the same
day, in the same repository, neither aware of the other. Both were good
and both still had to be merged by hand. **Convergent instincts are not
coordination.**

Consolidated:

- `AGENTS.md` is now the single instructions file. `CODEX.md` and
  `CODEX_CHECKLIST.md` are deleted into it, and the superseded
  planner/implementer split is corrected there — it had never reached the
  repository.
- `CHANGELOG.md` and `DAILY_LOG.md` are one file each, written by both
  agents, with the ownership table in `AGENTS.md` naming what goes where.
- Two orphaned preview servers from 6:47 PM and 9:14 PM were found still
  listening on 8124, serving a branch checkout to anything asking for a
  local preview. Killed. `AGENTS.md` now requires shutting down your own
  servers before reporting done.
- `step-3-session-plumbing` was rewritten to `539e6ea`: the same tree,
  rebased onto `accounts`, with the reasoning moved out of the PR body
  into the commit message and the `check_web.py` docstring conflict
  resolved (both halves kept). Codex's three documentation commits were
  dropped from that branch **after** their four blobs were confirmed
  byte-identical to what had already been merged here — nothing was
  lost, and PR #17 is now purely the step 3 code slice.

### Later the same day — configuration, and two CI findings

Claude. Issue #25 reviewed and merged (rebase, so the test-first commit
survives as its own commit); #26 reviewed and **blocked**; the Worker's
configuration finished with the owner.

**All six production Worker secrets are now set** — `EXPORT_TOKEN`,
`TELEGRAM_BOT_TOKEN`, `ACCOUNT_SECRET`, `TELEGRAM_GROUP_CHAT_ID`,
`ADMIN_TELEGRAM_IDS`, `ALWAYS_ALLOW_TELEGRAM_IDS`, all as secrets. The
group is a supergroup, so its `-100…` id is stable and will not shift
under a basic-group upgrade.

**Issue #30's prescribed fix does not work**, which is the finding rather
than the chore. `wrangler secret put --name hgbinderworker` fails with
`error 10220, Prod worker settings can not be deployed with a Version
Upload`: production's script was hand-pasted, `secret put` creates *and
deploys* a version in one step, and Cloudflare refuses the combination —
for anyone, however they authenticate. The dashboard is the tool until
cutover. `AGENTS.md` carries this, along with the two smaller traps: a
piped stdin makes wrangler non-interactive and it then demands
`CLOUDFLARE_API_TOKEN`, and `wrangler@latest` resolved to two different
versions minutes apart that failed differently.

**The widget's CSP needed a third exception, and the owner confirmed
it.** `'unsafe-eval'`, because Telegram's script puts `data-onauth`
through `__parseFunction`. Redirect mode avoids eval and was rejected:
it returns the signed payload in a URL query string, putting the numeric
id and handle into browser history, `Referer` headers and host access
logs on every sign-in — the membership oracle the account-id design
exists to prevent, relocated into a log. `DESIGN.md` `ef8c17c` carries
the reasoning and one correction: the sign-in page is **not** a page with
nothing to steal, because after sign-in it holds the session.

**#26 is blocked on one item.** Check 12 skips `index.html`, so it
enforces that the exception does not spread and not that it stays narrow
— and narrowness is the only reason the exception is acceptable.
Rewriting that page's policy with `'unsafe-inline'` and an arbitrary
third-party origin left all eleven stages green.

**A CI incident, and a wrong diagnosis of it worth more than the
incident.** A GitHub Actions incident failed five runs in `Set up job`
before checkout; none of it reached the code, and `ffd48b2` was never
broken. It was intermittent rather than a window, and one success was
misread as recovery.

Then a push to `accounts` appeared to have produced no run at all, and I
reported that GitHub had dropped it. **That was wrong twice over.**
`?head_sha=` was queried with a *seven-character* SHA, and the API
answers `total_count: 0` for an abbreviated SHA exactly as it does for a
commit that never ran — a silent false negative on the check written to
catch silent failures. The full SHA showed two runs. And run *creation*
was lagging during the incident: the push run did exist, queued, minutes
later. "Not created yet" and "never created" are indistinguishable at the
moment of looking, and only one of them is a problem.

The `workflow_dispatch` I fired to "fix" it was harmless on `accounts`
and would not have been on `main` — a manual dispatch satisfies the
deploy job's condition and releases the site. `AGENTS.md` now carries all
three: the full-SHA requirement, the creation lag, and the dispatch
hazard.

### Open threads

**Blocked on the owner:**

1. **The dev Worker has no `ACCOUNT_SECRET`** (#33). `handleDevAuth`
   HMACs with it, so every development sign-in 500s at the last line of
   the handler, after both guards have passed. One command, a fresh value
   that is never production's.
2. **Publish the production key fingerprint out-of-band** (#29).
3. **A live `/auth/dev` mint**, to confirm a session reaches
   `submit.html`. Needs the owner-held `DEV_LOGIN_SECRET`; neither agent
   asks for or handles it.

**Done, and previously listed here as the critical path: BotFather.** The
bot is `@hanggangbinder_bot` and `/setdomain` → `potaetoe.github.io`
succeeded. No owner errand blocks forward progress now.

**Moved to the cutover:** step 2 — clear `submissions`, unpublish the
snapshot, in one sitting with deploying the accounts Worker and merging
`accounts` into `main`. Rehearse on the development database first. Plus
the widget's real render and callback, which BotFather's host binding
makes unprovable from localhost.

**Blocked on Codex:** #26's check 12 pin is implemented on its rebased PR
branch and awaits Claude's re-review. `wrangler.toml`'s comment block on #30
still calls the three id secrets plaintext vars, which is the sentence that
would talk the next person into re-creating the defect. Plus the #18
findings.

**Not started:** steps 4–7, 9, 10.

### Other projects

`Weight-Goal-Calculator`: one commit, `bef9fc0` — finding node when it is
installed but not on `PATH`.
