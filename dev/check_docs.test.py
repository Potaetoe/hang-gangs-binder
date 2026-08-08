"""Contract checks for the documentation gate.

`tools/check_docs.py` holds two registries - the five operative
documents, and the `security/` folder - plus the falsified-claim
tripwires and the American-spelling rule. It is what makes AGENTS.md's
claim true that adding either kind of document "cannot happen by
accident", and until this suite existed it was the one checker in the
gate with nothing behind it.

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

Three arms below pin behavior that is narrower than the checker's
prose suggests, each marked where it sits. They are pinned rather than
corrected because widening a pattern changes what the gate enforces,
which is an owner-sized question; #121 carries them.

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
EXPECTED = 50


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


# ------------------------------------------------------------------ #
# Tripwires - a claim this project has falsified, back in a document.  #

PHRASE, WHY = check_docs.TRIPWIRES[0]

check("a falsified claim in a document is reported",
      len(scanned("The tool %s, we wrote." % PHRASE)) == 1)

check("the report names the document and the line it is on",
      scanned("first\nsecond\n%s\n" % PHRASE)[0].startswith("README.md:3:"))

# The reason travels with the report because the reader's next action
# depends on it: the phrase is banned as a *finding*, and somebody
# meeting it for the first time needs to know what falsified it.
check("the report carries why the claim is falsified",
      WHY in scanned(PHRASE)[0])

check("a falsified claim is matched regardless of case",
      len(scanned(PHRASE.upper())) == 1)

# Completeness, the property that makes this a registry rather than a
# description: an entry appended without a working pattern fails here
# rather than sitting inert in the list.
check("every registered tripwire fires on its own phrase",
      all(len(scanned(phrase)) == 1
          for phrase, _ in check_docs.TRIPWIRES))

check("ordinary prose trips nothing",
      clean("The gate prints its own list, and that printout is the "
            "number.\n"))

# PINNED, NOT ENDORSED (#121). The scan is line-based, so a phrase is
# only ever compared against one line at a time. These documents are
# hard-wrapped near 72 columns and the registered phrases run to 49
# characters, so a falsified sentence coming back in ordinary prose can
# straddle a break and pass. The docstring calls the falsified sentence
# "the only way that scales"; a line break defeats it. Pinned so the
# limit is visible and so widening it is a deliberate, reviewed act.
HEAD, TAIL = PHRASE.split(" ", 1)
check("a tripwire wrapped across a line break is not detected",
      clean("The tool %s\n%s, we wrote.\n" % (HEAD, TAIL)))


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
      "'colour'" in scanned("the colour of it").pop().replace('"', "'"))

# PINNED, NOT ENDORSED (#121). Every pattern is anchored with \b at the
# front only, so a British spelling reached through a URL path or a
# quoted requirement is reported, and one buried inside a compound word
# is not. The first two are what the module docstring asks for - it
# says a colliding requirement quotation "gets paraphrased or taken to
# the owner" rather than exempted - so they are endorsed. The compound
# is the gap.
check("a British spelling inside a URL is reported",
      len(scanned("See https://example.test/colour-guide for it.")) == 1)

check("a British spelling inside a quoted requirement is reported",
      len(scanned('The baseline says the reviewer must "recognise" '
                  'the finding.')) == 1)

check("a British spelling inside a compound word is not reported",
      clean("A watercolour illustration sits in the record."))


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
      "prints its own list" in scanned("The gate runs eleven checks.")[0])

# PINNED, NOT ENDORSED (#121). The pattern requires the number and the
# noun to be adjacent, so any word between them evades it. The "all
# eleven" tripwire covers one instance of this by hand, which is what a
# rule needing hand-maintained instances looks like.
check("a gate count with a word between number and noun is not reported",
      clean("The gate runs eleven gate checks."))


# ------------------------------------------------------------------ #
# The two registries, both directions, on given sets.                 #

check("an unregistered top-level document is reported",
      len(check_docs.registry_problems({"NOTES.md"})) == 1)

check("a registered top-level document is not",
      check_docs.registry_problems({"README.md"}) == [])

# The message is the mechanism: the approval is not recorded anywhere
# else, so the report has to say where to record it.
check("the report says that editing REGISTRY is the approval",
      "REGISTRY" in check_docs.registry_problems({"NOTES.md"})[0])

check("every registered document is accepted by name",
      check_docs.registry_problems(check_docs.REGISTRY) == [])

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
      len(gone) == 1 and "missing" in gone[0])


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
      len(FOUND) == 1
      and FOUND[0].startswith(
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
      "read" in check_docs.null_scan_problems([])[0])

# Defined and not called is the same as absent. This drives the floor
# through problems(), which is what the gate actually runs.
saved_targets = check_docs.targets
check_docs.targets = list
try:
    WIRED = check_docs.problems()
finally:
    check_docs.targets = saved_targets

check("the floor is wired into problems(), not merely defined",
      check_docs.null_scan_problems([])[0] in WIRED)

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
