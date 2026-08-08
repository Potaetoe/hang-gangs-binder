# security/

Dated security records: assessments against a named baseline, the STIG
checklist, and whatever penetration test or audit record comes later.
The owner created this folder on 2026-08-08, deciding the placement
question issue #79 closed on.

Everything in here is a **snapshot** — what one reviewer found, on one
date, against one named catalog. That is the opposite of how the five
top-level documents work, and the distinction is the whole point of
giving these their own folder: `README.md`, `AGENTS.md`, `DESIGN.md`,
`OPERATIONS.md` and `CUTOVER.md` carry current truth and are corrected
in place, while a record in here is never corrected. It is superseded by
a later record, and the older one stays as it was written.

## What belongs here

- A dated assessment against a published baseline — the DISA
  Application Security and Development STIG being the one issue #79
  established as covering code this project owns.
- A filled checklist artifact, if somebody ever needs one handed to
  them. A `.ckl` is XML and reads badly in an issue comment, which was
  the argument for a folder in the first place.
- A penetration test report, a third-party audit, a vulnerability scan
  result — anything that is a finding made on a date rather than a rule
  that holds until changed.

## What does not belong here

- **The threat model.** It lives in `DESIGN.md`, "Threat model, honestly
  stated", and records in here cite it by section name. One home per
  fact: an assessment that restated the threat model would become a
  second copy nobody corrects, which is exactly the failure the
  five-document system was built to end. If a finding changes the threat
  model, `DESIGN.md` is what gets edited.
- **Mutable state.** Which findings are still open, who holds the fix,
  whether an accepted deviation is still accepted — GitHub issues and
  pull requests, by owner direction. A record in here names the issue
  each finding was filed as and stops there; it does not track it.
- **Operating procedure.** How to respond to an incident, how to check a
  deployment, how to rotate a credential: `OPERATIONS.md`. A finding
  that a procedure is missing belongs here; the procedure itself does
  not.
- **Anything a reader would take as current.** A record dated eight
  months ago read as today's posture is worse than no record, so the
  stamp below is not decoration.

The boundary on secrets in `AGENTS.md` applies here with no softening. A
security assessment is exactly the document that feels like it has a
reason to quote one.

## How a record is stamped

Three things, in the header, before any finding:

1. **A date.** The date the assessment was made, not the date the file
   was last touched — `git log` already answers the second question and
   answers it better.
2. **The catalog or scope it was made against**, at revision
   granularity: which baseline, which revision, which benchmark date,
   and where the copy came from. A verdict is meaningless without the
   requirement text it was judged against, and baselines revise faster
   than assessments get repeated.
3. **A pointer to the issue that is its system of record.** The issue
   holds the discussion, the corrections and the current status of every
   finding; this folder holds the snapshot. When the two disagree, the
   issue wins, because it is the one that gets updated.

The filename names the baseline and its revision
(`stig-asd-v6r4.md`), so a later revision arrives as a new file beside
the old one rather than as an edit to it. That is what makes the diff
between two revisions readable, which is the reason a folder beat an
issue comment.

## Adding one

Same discipline as a top-level document, and enforced the same way:
`tools/check_docs.py` names every file in this folder and **fails the
gate on any file it does not know**, so a record cannot arrive quietly.
Editing that list is the act that records the owner's approval, and
asking for it is one line in chat.

The registration here is stricter than the top-level one in a way worth
knowing before you trip it: the top-level scan only looks at `.md`,
because the repository root legitimately holds code and configuration,
while this folder holds records only — so **every** entry is checked,
whatever its extension. A `.ckl` dropped in unregistered fails, which is
the behavior asked for, since a checklist artifact arriving unnoticed
was the specific worry.

Records in here are scanned for the same falsified-claim tripwires and
the same American spelling as the operative documents, and for the same
reason: a reader hands a security assessment to somebody, so a claim
this project has already falsified is more damaging in here than in a
document only agents read. `archive/` is exempt from that scan because
its wrong claims are deliberately preserved as history; this folder is
not history in that sense. A record here is presented as a finding, and
a finding is answerable. If a requirement quotation ever collides with a
tripwire phrase, paraphrase it or take it to the owner — the tripwire
list does not lose an entry without the owner, and a folder-wide
exemption would be the same thing by another route.
