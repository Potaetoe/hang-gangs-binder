"""Contract checks for the documentation gate.

`tools/check_docs.py` holds two registries - the five operative
documents, and the `security/` folder - plus the falsified-claim
tripwires and the American-spelling rule. It is what makes AGENTS.md's
claim true that adding either kind of document "cannot happen by
accident", so it is the stage standing between this repository and an
unapproved document or an unregistered security record.

That is #34's shape verbatim, and #34 is why this file is written the
way it is. A mutation is written against a *rule* - plant a British
spelling, watch the gate fail - so it never exercises the reader that
has to find a document before any rule can apply. Every mutation
passes while the scanner reads nothing at all, because "no problem
found here" and "nothing read here" print the same sentence.

So the rules are exercised on strings rather than on the documents
they happen to guard, and then the real tree is tested, including the
decisive arm: a real document's real bytes go through the rules and a
planted claim comes back with the right line number. A pass on the
five documents means they are clean, not that they went unread.

Each rule is watched from both sides: an arm that sees it fire, and an
arm that sees it stay silent. A widened pattern is only as good as the
prose it still leaves alone, so every hardening here arrives with the
false-positive case that bounds it - a heading between two words, an
American compound, a number that punctuation separates from its noun.

No framework and no new dependency, matching the suites beside it.
"""

import os
import re
import sys
import tempfile

# tools/ is not a package and check_docs.py is a script, so the import
# has to be made reachable before it can be named. isort would hoist
# the import above the path insertion and break it, hence the explicit
# skip - the same shape as dev/check_contrast.test.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))

import check_docs  # noqa: I001


failures = 0
performed = 0

# Asserted at the end rather than only printed. A hand-written total
# that nothing compares against still prints a confident "OK" when a
# check stops running - an early return, a renamed helper - which is
# the armed-looking-but-not failure this repository holds to be worse
# than having no check at all.
EXPECTED = 74


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
    print("pass " if condition else "FAIL ", label)


def scanned(text, relpath="README.md"):
    return check_docs.scan_text(relpath, text)


def clean(text):
    return scanned(text) == []


def only(problems):
    """The single problem expected, or "" when there is not exactly one.

    Indexing straight into the list would raise instead of reporting,
    and a suite that raises stops: the remaining contracts never run,
    so a mutation shows one break at a time rather than all of them.
    Returning a string keeps a broken rule a FAIL row with a label on
    it.
    """
    return problems[0] if len(problems) == 1 else ""


# ------------------------------------------------------------------ #
# Tripwires - a claim this project has falsified, back in a document.  #

PHRASE, WHY = check_docs.TRIPWIRES[0]

check("a falsified claim in a document is reported",
      len(scanned("The tool %s, we wrote." % PHRASE)) == 1)

check("the report names the document and the line it is on",
      only(scanned("first\nsecond\n%s\n" % PHRASE))
      .startswith("README.md:3:"))

# The reason travels with the report because the reader's next action
# depends on it: the phrase is banned as a *finding*, and somebody
# meeting it for the first time needs to know what falsified it.
check("the report carries why the claim is falsified",
      WHY in only(scanned(PHRASE)))

check("a falsified claim is matched regardless of case",
      len(scanned(PHRASE.upper())) == 1)

# Completeness, the property that makes this a registry rather than a
# description: an entry appended without a working pattern fails here
# rather than sitting inert in the list.
check("every registered tripwire fires on its own phrase",
      all(len(scanned(phrase)) == 1
          for phrase, _ in check_docs.TRIPWIRES))

# Membership, not equality, so appending a newly falsified claim stays
# a one-file act while deleting one cannot be silent. TRIPWIRES says
# "never remove one without the owner" and nothing outside the file
# said so: a list read from the same file it guards cannot notice its
# own entry going missing (AGENTS.md, "The review bar"). Each phrase
# below is a claim this project published and had to correct.
RECORDED = {
    "will not authenticate from a non-interactive shell",
    "mechanically impossible from an agent shell",
    "no agent can read a live secret list",
    "all eleven",
    "cannot be lined up",
    "share no exact series point",
}

check("no falsified claim has dropped off the tripwire list",
      RECORDED <= {phrase for phrase, _ in check_docs.TRIPWIRES})

check("ordinary prose trips nothing",
      clean("The gate prints its own list, and that printout is the "
            "number.\n"))

# A wrap must not launder a falsified claim (#121). These documents are
# hard-wrapped near 72 columns and the registered phrases run to 49
# characters, so a phrase straddling a break is the likely shape rather
# than the exotic one - and a correction reaching a hand-made copy
# reflows it instead of pasting it intact, which is the exact situation
# these entries were registered for.
HEAD, TAIL = PHRASE.split(" ", 1)
check("a tripwire wrapped across a line break is reported",
      len(scanned("The tool %s\n%s, we wrote.\n" % (HEAD, TAIL))) == 1)

# A hard wrap lands wherever the column falls, so no single split point
# is the one that matters; every one of them has to be seen.
WORDS = PHRASE.split(" ")

check("a tripwire wrapped at any of its spaces is reported",
      all(len(scanned("The tool %s\n%s, we wrote.\n"
                      % (" ".join(WORDS[:index]),
                         " ".join(WORDS[index:])))) == 1
          for index in range(1, len(WORDS))))

# The line a reader is sent to is where the phrase starts, not where it
# finishes - the second half is the fragment that means nothing on its
# own.
check("a wrapped tripwire is reported at the line it starts on",
      only(scanned("first\nsecond\nThe tool %s\n%s, we wrote.\n"
                   % (HEAD, TAIL))).startswith("README.md:3:"))

# Blockquotes carry a ">" into the head of every continuation line, and
# security/ quotes requirements that way.
check("a tripwire wrapped inside a blockquote is reported",
      len(scanned("> The tool %s\n> %s, we wrote.\n"
                  % (HEAD, TAIL))) == 1)

# The bound on the gap, written so the marker is the only thing under
# test. A heading with words in it is stopped by its words, whatever
# GAP says - so this one puts the heading marker alone between the two
# halves, and fails the moment "#" is admitted as a continuation
# character. Body text does not bleed into a heading: they are separate
# blocks, and a phrase spanning them is not one sentence.
check("a heading marker does not continue a phrase",
      clean("The tool %s\n\n## %s, we wrote.\n" % (HEAD, TAIL)))

# The same bound from the other side: a word between the halves is a
# different sentence, not a reflowed one, so no word character may act
# as a gap.
check("a phrase interrupted by another word is not a tripwire",
      clean("The tool %s really %s, we wrote.\n" % (HEAD, TAIL)))

# PINNED, NOT ENDORSED - a fourth finding, parked on #121 the way #121
# itself was parked rather than widened here. Emphasis inside a phrase
# defeats it: these documents bold heavily, so "**will not
# authenticate** from a non-interactive shell" is the shape a falsified
# claim plausibly comes back in, and "*" is not a gap character.
#
# It is parked rather than fixed because the fix is a genuine fork,
# not an oversight. tools/check_comments.py admits "*" to GAP, where it
# can only be a continuation marker; in markdown "*" is emphasis AND a
# list bullet, so admitting it here buys the emphasis case at the cost
# of gluing two star-bulleted list items into one phrase nobody wrote.
# The second arm states that cost in the bullet style that pays it, so
# the two flip together under the same mutation and whoever takes the
# fork meets both halves of it at once.
EMPHASIZED = "The tool **%s** %s, we wrote.\n" % (
    " ".join(WORDS[:3]), " ".join(WORDS[3:]))

check("a tripwire broken by emphasis is not detected",
      clean(EMPHASIZED))

check("two star-bulleted list items are not one phrase",
      clean("* The tool %s\n* %s, we wrote.\n" % (HEAD, TAIL)))


# ------------------------------------------------------------------ #
# Spelling - the 2026-08-06 decision, machine-checked.                 #

BRITISH = [
    "centimetre", "kilometre", "millimetre",
    "colour", "behaviour", "favourite",
    "analyse", "analysed", "analysing",
    "quantised", "normalise", "summarising", "organised",
    "initialisation", "recognises", "minimised", "maximising",
    "serialised", "standardisation",
]
AMERICAN = [
    "centimeter", "kilometer", "millimeter",
    "color", "behavior", "favorite",
    "analyze", "analyzed", "analyzing",
    "quantized", "normalize", "summarizing", "organized",
    "initialization", "recognizes", "minimized", "maximizing",
    "serialized", "standardization",
]

check("every British spelling in the corpus is reported",
      all(len(scanned(word)) == 1 for word in BRITISH))

check("no American spelling in the corpus is reported",
      all(clean(word) for word in AMERICAN))

# The other completeness direction. A pattern added to SPELLING with no
# word behind it here is a rule nothing has ever seen match.
check("every pattern in SPELLING is exercised by the corpus",
      all(any(re.search(pattern, word, re.IGNORECASE)
              for word in BRITISH)
          for pattern in check_docs.SPELLING))

# The checker's own comment names these two as the words the patterns
# are narrow enough not to bite. That is a claim, so it is checked.
check("organism is not mistaken for a British spelling",
      clean("The organism is described in the record."))

check("analysis is not mistaken for a British spelling",
      clean("The analysis is filed beside the assessment."))

check("a British spelling is matched regardless of case",
      len(scanned("Colour")) == 1)

check("the report names the word it found",
      "'colour'" in only(scanned("the colour of it")).replace('"', "'"))

# A British spelling reached through a URL path or a quoted requirement
# is reported, which is what the module docstring asks for: it says a
# colliding requirement quotation "gets paraphrased or taken to the
# owner" rather than exempted.
check("a British spelling inside a URL is reported",
      len(scanned("See https://example.test/colour-guide for it.")) == 1)

check("a British spelling inside a quoted requirement is reported",
      len(scanned('The baseline says the reviewer must "recognise" '
                  'the finding.')) == 1)

# The compound is where a British spelling is least likely to be caught
# by eye, so it is the one the rule can least afford to miss (#121).
BRITISH_COMPOUNDS = [
    "watercolour", "discoloured", "misbehaviour",
    "reorganisation", "deserialised", "psychoanalysed",
]
AMERICAN_COMPOUNDS = [
    "watercolor", "discolored", "misbehavior",
    "reorganization", "deserialized", "psychoanalyzed",
]

check("a British spelling inside a compound word is reported",
      len(scanned("A watercolour illustration sits in the record.")) == 1)

check("every British compound in the corpus is reported",
      all(len(scanned(word)) == 1 for word in BRITISH_COMPOUNDS))

check("no American compound in the corpus is reported",
      all(clean(word) for word in AMERICAN_COMPOUNDS))

# What carries the narrowing once the front anchor is gone. "organism"
# survives on its own because the suffix has to be there too, and the
# compound is the case that proves the suffix is doing that work rather
# than the anchor.
check("microorganism is not mistaken for a British spelling",
      clean("Every microorganism in the sample is listed.")
      and clean("microorganisms"))


# ------------------------------------------------------------------ #
# COUNTS - a gate size written into prose.                            #

check("a spelled-out gate count in prose is reported",
      len(scanned("The gate runs eleven checks today.")) == 1)

check("a gate count written in digits is reported",
      len(scanned("The gate runs 11 checks today.")) == 1)

check("a stage count is reported the same as a check count",
      len(scanned("There are twelve stages.")) == 1)

# The checker's comment: number words below ten are left alone, because
# "three privacy checks" is a reference to a group rather than a claim
# about the gate's size.
check("a number below ten is left alone",
      clean("The three checks that carry privacy are listed there."))

check("a number in front of another noun is not a gate count",
      clean("The eleven checkers each have a suite."))

check("the report says where to look instead of what the number was",
      "prints its own list"
      in only(scanned("The gate runs eleven checks.")))

# The number and the noun need not be adjacent to be the same claim
# (#121). Requiring adjacency is what made the "all eleven" tripwire
# necessary by hand, and a rule needing hand-maintained instances to
# cover its own gaps is a rule that is too tight.
check("a gate count with a word between number and noun is reported",
      len(scanned("The gate runs eleven gate checks.")) == 1)

check("a gate count with two words between number and noun is reported",
      len(scanned("The gate covers eleven of the checks.")) == 1)

# COUNTS is written with `\s+`, which matches a newline. Scanning one
# line at a time is what kept that half of the pattern from ever
# firing.
check("a gate count wrapped across a line break is reported",
      len(scanned("The gate runs eleven\nchecks today.")) == 1)

# The gap stops at the noun, so the first count cannot swallow the
# second into one span and report a pair as a single problem.
check("two gate counts in one sentence are reported as two",
      len(scanned("It runs eleven checks and twelve stages.")) == 2)

# The report flattens the wrap it matched across, so a problem stays one
# line however the prose was broken.
check("a wrapped gate count is quoted on one line",
      "'eleven checks'"
      in only(scanned("The gate runs eleven\nchecks today."))
      .replace('"', "'"))

# Both bounds on the window. Punctuation ends it, so the pattern cannot
# reach across a clause into an unrelated noun; and distance ends it,
# so a number and a noun that merely share a sentence are left alone.
check("a number punctuation separates from the noun is not a count",
      clean("There are eleven. The checks are listed below."))

check("a number far from the noun is not a gate count",
      clean("The eleven documents each carry one of the gate's checks."))


# ------------------------------------------------------------------ #
# The two registries, both directions, on given sets.                 #

check("an unregistered top-level document is reported",
      len(check_docs.registry_problems({"NOTES.md"})) == 1)

check("a registered top-level document is not",
      check_docs.registry_problems({"README.md"}) == [])

# The message is the mechanism: the approval is not recorded anywhere
# else, so the report has to say where to record it.
check("the report says that editing REGISTRY is the approval",
      "REGISTRY" in only(check_docs.registry_problems({"NOTES.md"})))

check("every registered document is accepted by name",
      check_docs.registry_problems(check_docs.REGISTRY) == [])

# The other direction, added with UAT.md (#126). Until it existed,
# registration only caught a document ARRIVING: one could be deleted and
# the gate printed a clean tree, because absence had been made
# unremarkable for CUTOVER.md's sake and nothing separated the document
# that leaves by design from the ones whose loss is silent. Measured
# before the arm was written - UAT.md moved out of the tree, whole run
# still green.
check("a registered document missing from the root is reported",
      len(check_docs.missing_document_problems(
          check_docs.REGISTRY - {"UAT.md"})) == 1)

check("a complete set of documents is not",
      check_docs.missing_document_problems(check_docs.REGISTRY) == [])

# The exemption, and it is a fact about CUTOVER.md rather than a special
# case: it deletes itself in its own aftercare, so it is left out of
# REQUIRED instead of written in and skipped.
check("CUTOVER.md is the one document allowed to be gone",
      check_docs.missing_document_problems(
          check_docs.REGISTRY - {"CUTOVER.md"}) == []
      and "CUTOVER.md" not in check_docs.REQUIRED)

check("the report says that editing REGISTRY records the removal",
      "REGISTRY" in only(check_docs.missing_document_problems(
          check_docs.REGISTRY - {"UAT.md"})))

# Membership, the same shape RECORDED gives the tripwires and for the
# same reason: a set read from the file it guards cannot notice its own
# entry going missing (AGENTS.md, "The review bar"). UAT.md is the
# document this arm was built for - the cutover is gated on the script
# it holds - so it is named from outside rather than trusted from in.
check("UAT.md is registered and required to exist",
      "UAT.md" in check_docs.REGISTRY
      and "UAT.md" in check_docs.REQUIRED)

check("every required document is a registered one",
      check_docs.REQUIRED <= check_docs.REGISTRY)

# Wired, not merely defined - the same failure the floor's arm below
# guards against, driven the same way. A helper problems() never calls
# is absent however well it behaves when called directly, so the reader
# is replaced and the real problems() is made to report through it.
saved_documents = check_docs.top_level_documents
check_docs.top_level_documents = lambda: set(check_docs.REGISTRY) - {"UAT.md"}
try:
    WIRED_MISSING = check_docs.problems()
finally:
    check_docs.top_level_documents = saved_documents

check("the missing-document arm is wired into problems()",
      any("UAT.md" in problem and "missing" in problem
          for problem in WIRED_MISSING))

REGISTERED = set(check_docs.SECURITY)
ONE = sorted(REGISTERED)[0]

check("an unregistered file in security/ is reported",
      len(check_docs.security_registry_problems(
          REGISTERED | {"notes.md"})) == 1)

check("a registered record in security/ is not",
      check_docs.security_registry_problems(REGISTERED) == [])

# The arm the security extension added, and the one that separates this
# registry from the top-level one. A dated record is superseded by a
# later one beside it, never deleted, so a vanished assessment is a
# gate passing on evidence nobody can see.
check("a registered record missing from security/ is reported",
      len(check_docs.security_registry_problems(
          REGISTERED - {ONE})) == 1)

check("the two directions are independent",
      len(check_docs.security_registry_problems(
          (REGISTERED - {ONE}) | {"notes.md"})) == 2)

# Every entry is checked whatever its extension, because the artifact
# most likely to arrive here unnoticed is a .ckl, which is XML.
check("a non-markdown file in security/ is held to the registry",
      len(check_docs.security_registry_problems(
          REGISTERED | {"scan.ckl"})) == 1)

# The #34 way, and the checker already does this for the folder: a
# scanner that cannot find what it was pointed at has to say so.
with tempfile.TemporaryDirectory() as empty:
    saved_repo = check_docs.REPO
    check_docs.REPO = empty
    try:
        gone = check_docs.security_problems()
    finally:
        check_docs.REPO = saved_repo

check("a missing security/ folder is reported, not skipped",
      "missing" in only(gone))


# ------------------------------------------------------------------ #
# The real tree. Everything above is strings; these arms are the ones  #
# that fail if the checker stops reading the repository.               #

TARGETS = check_docs.targets()

check("the scan target list is not empty", TARGETS != [])

check("every registered document that exists is a scan target",
      all(name in TARGETS for name in check_docs.REGISTRY
          if os.path.isfile(os.path.join(check_docs.REPO, name))))

check("both directory guides are scan targets",
      all(guide in TARGETS for guide in check_docs.ALSO_SCANNED))

check("every registered markdown record in security/ is a scan target",
      all(os.path.join(check_docs.SECURITY_DIR, name) in TARGETS
          for name in check_docs.SECURITY
          if name.lower().endswith(".md")))

check("the scan targets all exist on disk",
      all(os.path.isfile(os.path.join(check_docs.REPO, rel))
          for rel in TARGETS))

check("every scan target reads as text with content in it",
      all(check_docs.document_text(rel).strip() for rel in TARGETS))

SECURITY_FOLDER = os.path.join(check_docs.REPO, check_docs.SECURITY_DIR)
check("the security folder holds exactly what SECURITY names",
      {name for name in os.listdir(SECURITY_FOLDER)
       if os.path.isfile(os.path.join(SECURITY_FOLDER, name))}
      == set(check_docs.SECURITY))

check("every top-level markdown file in the tree is registered",
      check_docs.registry_problems(check_docs.top_level_documents()) == [])

# The decisive arm. A real document's real bytes go through the rules,
# and a claim planted at a known line comes back at that line. Without
# it, every arm above could pass while the reader returned "" for each
# of the five documents and the gate reported a clean tree.
REAL = check_docs.document_text("AGENTS.md")

check("a real document reads back as substantial text",
      len(REAL) > 5000 and "documentation system" in REAL.lower())

PLANTED = REAL + "The tool %s, we wrote.\n" % PHRASE
FOUND = check_docs.scan_text("AGENTS.md", PLANTED)

check("the rules run over a real document's real bytes",
      only(FOUND).startswith(
          "AGENTS.md:%d:" % len(PLANTED.splitlines())))

check("so the gate passes on the tree as it stands",
      check_docs.problems() == [])


# ------------------------------------------------------------------ #
# The floor under the whole scan.                                      #

# A run that read no document is not a clean tree, and the checker has
# no other way to tell the two apart - absence of a registered document
# is deliberately never an error, so every document going missing is a
# silent, total loss of the scan rather than a failure.
check("a scan that read nothing is a reported problem",
      len(check_docs.null_scan_problems([])) == 1)

check("a scan that read something is not",
      check_docs.null_scan_problems(["README.md"]) == [])

check("the report says the scan found nothing to read",
      "read" in only(check_docs.null_scan_problems([])))

# Defined and not called is the same as absent. This drives the floor
# through problems(), which is what the gate actually runs.
saved_targets = check_docs.targets
check_docs.targets = list
try:
    WIRED = check_docs.problems()
finally:
    check_docs.targets = saved_targets

check("the floor is wired into problems(), not merely defined",
      only(check_docs.null_scan_problems([])) in WIRED)

# The floor sits on the empty list and nowhere else. CUTOVER.md deletes
# itself in its own aftercare, so one registered document going absent
# has to stay unremarkable.
check("one absent registered document is still not an error",
      check_docs.registry_problems({"README.md"}) == []
      and check_docs.null_scan_problems(["README.md"]) == [])


if failures:
    print("\ncheck_docs.py FAILED %d of %d checks"
          % (failures, performed))
    sys.exit(1)
if performed != EXPECTED:
    print("\ncheck_docs.py ran %d checks, expected %d - a check "
          "stopped running, or one was added without updating EXPECTED"
          % (performed, EXPECTED))
    sys.exit(1)
print("\ncheck_docs.py OK - %d checks" % performed)
