# The group channel

Rules for the live channel where the owner, Claude and Codex are all
present at once. **Paste these into the channel when it is created**;
this file is the copy that survives it.

`AGENTS.md` governs how the two agents work on this repository.
This file governs how the three of us talk in a medium that is not this
repository — which is a different problem, and a newer one.

---

## 1. This channel is not the record

Nothing agreed here is real until it lands in the repo. `DESIGN.md` for
decisions and rejected alternatives, `AGENTS.md` for durable rules,
`CHANGELOG.md` and `DAILY_LOG.md` for the day, GitHub issue comments for
anything mutable. When a decision is made here, whoever owns that file
commits it and **posts the SHA back to the channel**.

**This is the rule the channel exists in tension with.** `AGENTS.md`
opens by recording that the slice-not-phase correction was agreed in
conversation, never written down, and went on being contradicted by the
only document that stated it. A chat window is the most comfortable place
in this project to make that mistake again.

## 2. Never paste a secret here

No bot tokens, export tokens, private keys, `ACCOUNT_SECRET`,
`DEV_LOGIN_SECRET`, Cloudflare API tokens, or numeric Telegram ids.
Agents must never ask for one.

**If a secret appears in this channel it is burned.** Say so immediately
and rotate it before anything else — do not carry on and deal with it
later. This has already happened once, on 2026-08-06, with the Telegram
bot token; the recovery was a BotFather revoke, which took a minute
because it was caught in the same minute.

## 3. Address by name, and only the named agent replies

`@claude` or `@codex` at the start of the message. An unaddressed message
from the owner is the owner's to direct — if it is ambiguous, **one agent
asks who is taking it rather than both answering.**

Two agents independently doing the same work is the most likely failure
in a shared channel, not the least. On 2026-08-05 both agents wrote a
changelog and a daily log for the same day, in the same repository,
neither aware of the other; the work was good in both cases and still had
to be merged by hand. Convergent instincts are not coordination, and a
channel makes them converge faster.

## 4. Claiming work still happens on GitHub

The `CLAIM` and `RELEASE` issue comments and the `claude` / `codex`
labels remain the lock — see `AGENTS.md`, "Claiming a slice, concretely".
Announce here *that* you have claimed something, and link the issue.
**Never treat a message here as the claim.** Two sources of truth about
who holds a file is worse than one slow one.

## 5. Label every verification claim

Say which: **source** (the gate, run locally), **CI**, **browser**, or
**live**. Never let one imply another. A check that could not be run is
reported as *not performed*, never omitted.

**A queued CI run is not a green run.**

## 6. The owner's attention is the scarce resource

Bring decisions, blockers, and owner-only actions. Not progress
narration. One agent summarizing beats two agents each reporting.

**When the owner says something is done, it is done.** Do not re-issue
the steps, do not ask for confirmation a second time, and do not treat a
value being absent from your context as evidence the work did not happen.

## 7. Disagreement is expected, and resolved in the open

Either agent may block the other's work; say what the blocker is and what
would clear it. If the two agents disagree on a technical call, **state
both positions once and let the owner decide.** Do not litigate across
twenty messages. The owner is the decision-maker; this is not a
consensus-seeking group.

## 8. Report failures with the evidence

Paste the actual error, not a characterization of it. When something is
broken because of an outside outage, name it **and say what it does not
affect** — on 2026-08-06 every CI failure died before checkout and none
of them reached the code, and that distinction was the entire message.

---

## If rule 3 starts failing

It is the one most likely to break. If duplicate work starts appearing,
tighten the channel — not the split — so that one agent summarizes and
the other implements *in the channel only*. The slice split in
`AGENTS.md` stays as it is: whoever takes a slice specs, tests and builds
it, and the other reviews with authority to block. That was corrected
once already and should not be quietly undone by a chat convention.
