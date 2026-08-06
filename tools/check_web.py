#!/usr/bin/env python3
"""
Check that apps/web is internally consistent and safe to publish.

    python tools/check_web.py

Derived from what is actually in the directory rather than from a
hand-maintained list, because a hand-maintained list only knows about
files somebody remembered to add to it.

Ten checks:

1. Every local href/src in the HTML resolves to a file that exists. A
   rename that misses one reference publishes a page that 404s its own
   stylesheet and renders a dead form.

2. Nothing in apps/web looks like a private key. This is the one that
   matters. The whole design rests on the private key never being
   published, and apps/web is copied verbatim to a public site - so the
   moment a key lands in that directory it is public, permanently, in
   the git history as well as on the web. A regex is a weak guard, but
   it catches the realistic accidents: pasting a key into config.js
   "just to test the export locally" and forgetting, and - now that
   tools/keygen.html exists - pasting the whole key file into config.js
   when only the publicKey line belongs there. The generator hands over
   two things at once, a few centimetres apart on screen, and only one
   of them may be published.

3. Every page carries the shared head: charset, viewport, title, the
   content security policy, the stylesheet and the pre-paint theme
   script. The pages still to be written - admin.html and the form -
   are the ones that handle plaintext and keys, so "I copied the old
   page and trimmed the head" is exactly the mistake worth catching
   automatically rather than at review.

4. Every endpoint arm in config.js is permitted by the CSP of every page
   that loads config.js. These files must agree, and they fail apart
   silently: change an endpoint alone and the page still looks right but
   the browser drops every request at connect-src.

5. Every environment in config.js has a real, distinct P-256 public key
   and a distinct endpoint. The production arm must be keyed by the
   deployed hostname, both loopback names must select development, and
   an unknown hostname must not fall back to production. This catches
   the dangerous half-finished copy-and-paste: a local preview that
   quietly encrypts to or writes into the live environment.

   Distinctness alone was not enough, and the gap is worth recording
   because the specification that produced it read as though it were.
   REDESIGN.md asked for "no two arms share an endpoint or a public
   key", which catches an arm copied *over* another - and passes
   cleanly when the two are *swapped*, because swapped arms are still
   distinct. DESIGN.md names that exact failure one paragraph before
   prescribing the check: "production shipping the development
   endpoint, or the development public key. Neither throws."

   Confirmed by mutation before this was written: exchanging the two
   publicKey values left the whole gate green. The endpoint half of
   that swap fails loudly at runtime, since each Worker refuses the
   other's origin - but the key half is silent and unrecoverable.
   Production rows seal to a key the keyholder does not hold, the
   export lists them down the rotated-key path, and nothing can turn
   plaintext back into ciphertext.

   So production's key and endpoint are pinned to their literal values
   below rather than merely required to differ from development's. A
   value that cannot be recomputed from the file it guards is the only
   kind that catches a swap - the same reason dev/fixture.json is a
   committed constant rather than something the suite regenerates.

6. Nothing *sends* to the network except through crypto.js. This is the
   design's one rule restated as something a machine can check: the
   whole point is that plaintext never leaves the browser, so a file
   that puts a body on the wire but does not encrypt is the shape of
   the mistake that would break it. Two halves - a script that sends
   must also name BinderCrypto, and a page loading such a script must
   actually load crypto.js.

   Sending, not touching. An earlier version of this check counted any
   fetch at all, which was right while every page here either submitted
   or exported, and became wrong the day dashboard.html arrived: that
   page only reads an aggregate that was published on purpose, sends
   nothing, and deliberately does not load crypto.js so that it cannot
   be talked into decrypting anything. Holding a read-only page to a
   rule about sending would have meant either loading decryption onto a
   page with no use for it, or turning the check off.

   It cannot prove the encryption is *used* - only that the pieces are
   present. A submit handler that posts the form fields and never calls
   encrypt would pass. That failure is loud in review and in the
   round-trip test; this catches the quiet one, which is a page wired
   to the endpoint with no encryption on it at all.

7. The stylesheet honours the hidden attribute. Every piece of this
   site that appears and disappears - the two unit groups, the "not
   open" notice, the success card, each field error - does it by
   setting `hidden` in JavaScript. The browser's own rule for that is
   `display: none` at the weakest specificity there is, so any
   component that sets display beats it: .card and .stack both set
   `flex`, and did, and the published form showed both unit systems at
   once alongside a "thanks for submitting" card nobody had earned.

   Nothing about that fails loudly. The JavaScript is correct, the
   attribute is set, the DOM inspector agrees the element is hidden,
   and reading `element.hidden` returns true - it is only the rendering
   that disagrees. So the one line the whole visibility model rests on
   is checked here rather than trusted.

8. The form's checked units radio and its visible field group agree.
   The site defaults to imperial, and that default is written down in
   two places that must match: which radio carries `checked`, and which
   of the two field groups carries `hidden`.

   applyUnits() reconciles them at DOMContentLoaded, which is what makes
   a mismatch so easy to miss - by the time anyone looks, the page is
   right. But the browser paints the markup before that runs, so a
   disagreement shows the wrong pair of boxes for a frame, and the boxes
   it shows are the ones somebody starts typing into. Worse, both groups
   visible at once is the exact rendering that shipped on 2026-08-04 for
   the different reason check 7 now guards.

9. Every promoted country code names a real country. The dropdown puts
   a short block at the top, listed in countries.js as ISO codes, and
   form.js skips any code it cannot find a name for - which is the right
   behaviour on a live page and the reason a typo would be invisible.
   The country simply would not be in the promoted block, and the only
   way to notice is to know it should have been there.

10. Every page carries the same navigation. The nav links are written
    out in each page's HTML rather than built by nav.js, so that a
    script failure cannot strand somebody on a page with no way off it.
    The cost of that choice is the same list written four times, and
    four copies of anything drift - a page added later gets the nav
    copied from whichever page was open, and a link added to one page
    is missing from three.

    Nothing about that is visible from the page you happen to be
    looking at. This compares the sets and fails if they differ, which
    is what makes the duplication safe to have chosen.
"""

import base64
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(REPO, "apps", "web")

# Deliberately broad. A false positive costs somebody thirty seconds of
# reading; a false negative costs every submitter their privacy.
KEY_PATTERNS = [
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "a PEM private key block"),
    (r"\bprivate[_-]?key\s*[:=]\s*['\"][^'\"]{16,}", "an assigned private_key"),
    (r"\bsecret[_-]?key\s*[:=]\s*['\"][^'\"]{16,}", "an assigned secret_key"),
    # What tools/keygen.html actually produces. "d" is the private
    # scalar of a JWK - the member that makes it the secret half, and
    # the one a public JWK does not carry. 32+ base64url characters
    # keeps it clear of any short "d" that means something else.
    (r"[\"']d[\"']\s*:\s*[\"'][A-Za-z0-9_-]{32,}[\"']",
     "the private half of a JWK key (its \"d\" member)"),
    # The key file pasted whole, envelope and all, instead of just the
    # publicKey line out of it.
    (r"[\"']?\bprivate[_-]?key[\"']?\s*[:=]\s*\{",
     "an assigned privateKey object - the generator's key file, pasted whole"),
]


# (description, pattern) for the head every published page shares.
# Matched loosely on purpose - this asserts the piece is present, not
# that it is spelled a particular way.
REQUIRED_HEAD = [
    ("a <meta charset>", r'<meta\s+charset='),
    ("a viewport meta", r'<meta\s+name="viewport"'),
    ("a <title>", r"<title>\s*\S"),
    ("a Content-Security-Policy meta",
     r'http-equiv="Content-Security-Policy"'),
    ("a link to theme.css", r'href="theme\.css"'),
    ("the pre-paint theme-init.js script", r'src="theme-init\.js"'),
]


def html_pages():
    return sorted(n for n in os.listdir(WEB) if n.endswith(".html"))


def html_references():
    """(page, target) for every local href/src in apps/web's HTML."""
    refs = []
    for name in html_pages():
        text = open(os.path.join(WEB, name), encoding="utf-8").read()
        # Comments first: prose in a comment may name a file that
        # deliberately does not exist here (dev/ is never published).
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
        for target in re.findall(r'(?:href|src)="([^"]+)"', text):
            if re.match(r"^(?:https?:)?//|^mailto:|^#|^data:", target):
                continue
            refs.append((name, target.split("?", 1)[0].split("#", 1)[0]))
    return refs


def missing_head_pieces():
    """(page, description) for every shared head element a page lacks."""
    gaps = []
    for name in html_pages():
        text = open(os.path.join(WEB, name), encoding="utf-8").read()
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
        for description, pattern in REQUIRED_HEAD:
            if not re.search(pattern, text, re.I):
                gaps.append((name, description))
    return gaps


CONFIG_FILE = "config.js"
PRODUCTION_HOST = "potaetoe.github.io"

# What production must ship, written down where config.js cannot reach it.
#
# These are not secrets - a public key is published on purpose and the
# endpoint accepts writes from one origin - so the only thing they do here
# is refuse to move. That is the point. Every other assertion about
# config.js is computed *from* config.js, which means editing that file
# edits the standard it is held to; two arms with their values exchanged
# satisfy every one of them.
#
# PRODUCTION_KEY is safe to pin because it is already permanent. Replacing
# it is a rotation, not an edit - every submission encrypted to the old key
# stops being readable by the new one - so a change here should be rare,
# deliberate, and accompanied by the archive step in HANDOFF.md. If this
# check ever fires during ordinary work, the answer is almost never to
# update the constant.
PRODUCTION_KEY = ("BEKFlvIzxk0/nOTskgzbKfYoqmMW3ds4EmUpn6rqx9rD"
                  "1d5PhnxXT9kD917khzW07MUT2yAX18Wc7rD4K0BTSQ8=")
PRODUCTION_ENDPOINT = "https://hgbinderworker.sorcererbiggz.workers.dev"


def crossed_wire_problems(environments):
    """Problems where production carries a value that is not production's.

    Two failures, and they are not the same one twice:

    the swap - production's arm holding development's key or endpoint. The
    endpoint half announces itself, because each Worker refuses the other's
    origin, so the site fails at the first request rather than quietly. The
    key half does not announce anything at all: submissions encrypt, POST,
    store, and are unreadable by the only person who is supposed to read
    them.

    the copy - some *other* arm holding production's key. Development then
    seals its test rows to production's key, so reading them back means
    loading the real private key on a page served over plain HTTP from a
    local directory. REDESIGN.md gives that as the whole reason development
    has a keypair of its own.
    """
    problems = []
    for environment in environments:
        is_production = environment["name"] == "production"
        key = environment["publicKey"]
        endpoint = environment["endpoint"]

        if is_production:
            if key and key != PRODUCTION_KEY:
                problems.append(
                    "the production arm does not carry the production "
                    "public key. Rows written by the live site would be "
                    "sealed to a key the keyholder does not hold, and no "
                    "export could ever read them back")
            if endpoint and endpoint != PRODUCTION_ENDPOINT:
                problems.append(
                    "the production arm does not carry the production "
                    "endpoint, so the live site would write somewhere it "
                    "was never meant to")
        else:
            if key == PRODUCTION_KEY:
                problems.append(
                    "the %s arm carries the production public key. Reading "
                    "its rows back would mean loading the real private key "
                    "outside production, which is what a separate "
                    "development keypair exists to avoid" %
                    environment["host"])
            if endpoint == PRODUCTION_ENDPOINT:
                problems.append(
                    "the %s arm carries the production endpoint, so local "
                    "work would write into the live database" %
                    environment["host"])
    return problems


def config_environments():
    """([environment], [problem]) parsed from the shipped config.js.

    This is deliberately a narrow parser for the literal object this project
    ships, not a JavaScript interpreter. A computed endpoint or key would make
    the publish-time invariant unknowable, which is itself a build failure.
    """
    path = os.path.join(WEB, CONFIG_FILE)
    if not os.path.exists(path):
        return [], ["does not exist"]

    text = strip_js_comments(open(path, encoding="utf-8").read())
    block = re.search(
        r"\bconst\s+ENVIRONMENTS\s*=\s*\{(.*?)\n\s*\};", text, re.S)
    if not block:
        return [], ["does not define a literal ENVIRONMENTS object"]

    arms = re.compile(
        r'(?:"([^"]+)"|\'([^\']+)\'|([A-Za-z0-9_.-]+))\s*:\s*'
        r'\{([^{}]*)\}\s*,?', re.S)
    environments = []
    problems = []
    for match in arms.finditer(block.group(1)):
        host = next(value for value in match.groups()[:3]
                    if value is not None)
        body = match.group(4)

        def field(name):
            found = re.search(
                r"\b%s\s*:\s*[\"']([^\"']+)[\"']" % name, body)
            return found.group(1) if found else None

        environment = {
            "host": host,
            "name": field("name"),
            "endpoint": field("endpoint"),
            "publicKey": field("publicKey"),
        }
        environments.append(environment)
        for required in ("name", "endpoint", "publicKey"):
            if not environment[required]:
                problems.append("the %s arm has no literal %s" %
                                (host, required))

    if not environments:
        problems.append("ENVIRONMENTS has no literal hostname arms")

    hosts = [environment["host"] for environment in environments]
    if len(hosts) != len(set(hosts)):
        problems.append("ENVIRONMENTS defines one hostname more than once")

    production = [environment for environment in environments
                  if environment["name"] == "production"]
    if len(production) != 1:
        problems.append("must contain exactly one arm named production")
    elif production[0]["host"] != PRODUCTION_HOST:
        problems.append(
            "the production arm is keyed by %s, not the deployed hostname %s"
            % (production[0]["host"], PRODUCTION_HOST))

    development = [environment for environment in environments
                   if environment["name"] == "development"]
    if len(development) != 1 or development[0]["host"] != "localhost":
        problems.append(
            "must contain exactly one localhost arm named development")

    alias = re.search(
        r'ENVIRONMENTS\s*\[\s*["\']127\.0\.0\.1["\']\s*\]\s*=\s*'
        r'ENVIRONMENTS(?:\.localhost|\s*\[\s*["\']localhost["\']\s*\])',
        text)
    if not alias:
        problems.append("127.0.0.1 is not aliased to the localhost arm")

    no_default = re.search(
        r'globalThis\.BINDER_CONFIG\s*=\s*'
        r'ENVIRONMENTS\s*\[\s*location\.hostname\s*\]\s*\|\|\s*\{'
        r'\s*name\s*:\s*["\']unknown["\']\s*,\s*'
        r'publicKey\s*:\s*null\s*,?\s*\}', text, re.S)
    if not no_default:
        problems.append(
            "an unknown hostname does not resolve to the closed, keyless arm")

    for field_name in ("endpoint", "publicKey"):
        values = [environment[field_name] for environment in environments
                  if environment[field_name]]
        if len(values) != len(set(values)):
            problems.append("two environment arms share the same %s" %
                            field_name)

    return environments, problems


def endpoint_origin(endpoint):
    """The HTTPS origin of one literal endpoint, or None if malformed."""
    match = re.match(r"^(https://[^/]+)(?:/.*)?$", endpoint or "")
    return match.group(1) if match else None


def csp_gaps(origins):
    """(page, origin) for pages whose CSP would block an endpoint.

    Only pages that actually load config.js are checked. A page with no
    reason to reach an endpoint should not be given permission to - the
    404 page is the current example.
    """
    origins = [origin for origin in origins if origin]
    if not origins:
        return []
    users = set(page for page, target in html_references()
                if target == CONFIG_FILE)
    gaps = []
    for name in sorted(users):
        text = open(os.path.join(WEB, name), encoding="utf-8").read()
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
        policy = re.search(
            r'http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"',
            text, re.I)
        if not policy:
            continue  # already reported by the shared-head check
        connect = re.search(r"connect-src ([^;\"]*)", policy.group(1))
        allowed = connect.group(1).split() if connect else []
        for origin in origins:
            if origin not in allowed:
                gaps.append((name, origin))
    return gaps


# P-256, from FIPS 186-4. Only what is needed to test whether a point
# satisfies y^2 = x^3 - 3x + b (mod p); nothing here does cryptography.
P256_P = (1 << 256) - (1 << 224) + (1 << 192) + (1 << 96) - 1
P256_B = int("5ac635d8aa3a93e7b3ebbd55769886bc"
             "651d06b0cc53b0f63bce3c3e27d2604b", 16)


def public_key_problem(value):
    """A description of what is wrong with one environment key, or None."""
    if not value:
        return "no publicKey is set"
    try:
        raw = base64.b64decode(value, validate=True)
    except Exception:
        return "the publicKey is not valid base64 - the paste was mangled"

    if len(raw) != 65:
        return ("the publicKey decodes to %d bytes, not the 65 an "
                "uncompressed P-256 point takes - the paste was truncated"
                % len(raw))
    if raw[0] != 0x04:
        return ("the publicKey does not begin with the 0x04 that marks an "
                "uncompressed point")

    x = int.from_bytes(raw[1:33], "big")
    y = int.from_bytes(raw[33:], "big")
    if x >= P256_P or y >= P256_P:
        return "the publicKey's coordinates are out of range for P-256"
    if (y * y - (x * x * x - 3 * x + P256_B)) % P256_P != 0:
        return ("the publicKey is not a point on P-256 - the paste is "
                "corrupt, or it is a key for some other curve")
    return None


CRYPTO_FILE = "crypto.js"

# What "this file puts something on the wire" looks like in a directory
# with no build step and no framework. A bare fetch() is a read and is
# not enough: reading is what the public dashboard does, and what the
# export does, and neither is the risk this check exists for.
#
# sendBeacon is here because its whole purpose is sending a body, and
# an XMLHttpRequest with an explicit method is the older spelling of
# the same thing.
SENDS_TO_NETWORK = re.compile(
    r"method\s*:\s*[\"'](?:POST|PUT|PATCH)[\"']|"
    r"\bsendBeacon\s*\(|"
    r"\.open\s*\(\s*[\"'](?:POST|PUT|PATCH)[\"']",
    re.I)


def strip_js_comments(text):
    """Prose about fetch() is not a fetch()."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"^\s*//.*$", "", text, flags=re.M)


def unencrypted_paths():
    """(file, problem) for anything that could put plaintext on the wire."""
    problems = []

    senders = set()
    for name in sorted(n for n in os.listdir(WEB) if n.endswith(".js")):
        if name == CRYPTO_FILE:
            continue
        code = strip_js_comments(
            open(os.path.join(WEB, name), encoding="utf-8").read())
        if not SENDS_TO_NETWORK.search(code):
            continue
        senders.add(name)
        if "BinderCrypto" not in code:
            problems.append((
                name,
                "sends a body to the endpoint but never mentions "
                "BinderCrypto, so whatever it sends has not been through "
                "crypto.js"))

    for page, target in html_references():
        if target in senders:
            loaded = set(t for p, t in html_references() if p == page)
            if CRYPTO_FILE not in loaded:
                problems.append((
                    page,
                    "loads %s, which sends to the endpoint, but does not "
                    "load %s - the encryption would not be there to call"
                    % (target, CRYPTO_FILE)))

    return problems


STYLESHEET = "theme.css"

# `[hidden] { display: none !important }`, however it is spaced. The
# !important is required, not stylistic: without it the rule loses to
# any component that sets display, which is the exact failure this
# checks for.
HONOURS_HIDDEN = re.compile(
    r"\[hidden\][^{}]*\{[^{}]*display\s*:\s*none\s*!\s*important", re.I | re.S)


def hidden_attribute_problem():
    """A description of the stylesheet failing to honour [hidden], or None."""
    path = os.path.join(WEB, STYLESHEET)
    if not os.path.exists(path):
        return None  # the missing-stylesheet case is check 1's to report
    css = re.sub(r"/\*.*?\*/", "", open(path, encoding="utf-8").read(),
                 flags=re.S)
    if HONOURS_HIDDEN.search(css):
        return None
    return ("%s does not force [hidden] to display:none !important. Every "
            "element this site shows and hides - both unit groups, the "
            "closed notice, the success card, the field errors - relies on "
            "that one rule, and .card and .stack set display:flex, which "
            "beats the browser's own [hidden] rule. The pages would render "
            "every hidden element at once, with nothing reporting it"
            % STYLESHEET)


def nav_links(text):
    """The (href, label) pairs inside a page's .nav-menu, in order."""
    menu = re.search(r'<ul[^>]*class="nav-menu".*?</ul>', text, re.S | re.I)
    if not menu:
        return None
    return re.findall(r'<a\s+href="([^"]+)"[^>]*>(.*?)</a>',
                      menu.group(0), re.S | re.I)


def nav_problems():
    """(page, problem) for pages whose navigation is missing or differs."""
    problems = []
    found = {}
    for name in html_pages():
        text = re.sub(r"<!--.*?-->", "", open(os.path.join(WEB, name),
                                              encoding="utf-8").read(),
                      flags=re.S)
        links = nav_links(text)
        if links is None:
            problems.append((name, "has no navigation menu"))
            continue
        if not links:
            problems.append((name, "has a navigation menu with no links"))
            continue
        found[name] = links

        # A menu that cannot be opened is a menu that is not there. The
        # toggle and the list have to agree about the id, or the button
        # controls nothing and nav.js gives up.
        if 'id="nav-toggle"' not in text or 'id="nav-menu"' not in text:
            problems.append((
                name,
                "has nav markup but is missing the nav-toggle or nav-menu "
                "id that nav.js and aria-controls both rely on"))

    # Compared against whichever page sorts first, so the message names a
    # specific page to go and look at rather than "they differ".
    if len(found) > 1:
        reference = sorted(found)[0]
        for name in sorted(found):
            if name != reference and found[name] != found[reference]:
                problems.append((
                    name,
                    "has different navigation from %s. Every page carries "
                    "its own copy, so they have to be kept identical by "
                    "hand - %s has %s, this has %s"
                    % (reference, reference,
                       [h for h, _ in found[reference]],
                       [h for h, _ in found[name]])))

    # A nav link to a page that does not exist is caught by check 1 as a
    # broken reference, so it is not repeated here.
    return problems


COUNTRIES_FILE = "countries.js"


def promoted_country_problems():
    """(code, problem) for promoted codes with no country behind them."""
    path = os.path.join(WEB, COUNTRIES_FILE)
    if not os.path.exists(path):
        return []  # check 1's to report
    text = strip_js_comments(open(path, encoding="utf-8").read())

    promoted = re.search(
        r"BINDER_COUNTRIES_PROMOTED\s*=\s*\[(.*?)\]", text, re.S)
    if not promoted:
        return []  # no promoted block is a legitimate state
    codes = re.findall(r"[\"']([^\"']+)[\"']", promoted.group(1))

    known = set(re.findall(r"^\s*([A-Z]{2})\s*:", text, re.M))
    problems = []
    seen = set()
    for code in codes:
        if code in seen:
            problems.append((
                code,
                "is promoted twice, so it appears twice in the block at the "
                "top of the dropdown"))
        seen.add(code)
        if code not in known:
            problems.append((
                code,
                "is not a country in %s. form.js skips it, so the dropdown "
                "would simply be missing it at the top with nothing "
                "reporting why" % COUNTRIES_FILE))
    return problems


FORM_PAGE = "index.html"

# The two halves of the units default, as they appear in the markup.
UNIT_SYSTEMS = ("imperial", "metric")


def units_default_problem():
    """A description of the units default contradicting itself, or None."""
    path = os.path.join(WEB, FORM_PAGE)
    if not os.path.exists(path):
        return None  # check 1's to report
    text = re.sub(r"<!--.*?-->", "", open(path, encoding="utf-8").read(),
                  flags=re.S)

    checked = [
        system for system in UNIT_SYSTEMS
        if re.search(
            r'<input[^>]*name="units"[^>]*value="%s"[^>]*\bchecked\b' % system,
            text, re.I)
        or re.search(
            r'<input[^>]*\bchecked\b[^>]*name="units"[^>]*value="%s"' % system,
            text, re.I)
    ]
    if len(checked) != 1:
        return ("%s has %d units radio marked checked, not exactly one - the "
                "form would open with no unit system selected, or with two"
                % (FORM_PAGE, len(checked)))

    hidden = {}
    for system in UNIT_SYSTEMS:
        group = re.search(r'<div[^>]*id="%s-fields"[^>]*>' % system, text, re.I)
        if not group:
            return ("%s has no #%s-fields group, so the units toggle has "
                    "nothing to show" % (FORM_PAGE, system))
        hidden[system] = bool(re.search(r"\bhidden\b", group.group(0), re.I))

    wanted = checked[0]
    other = UNIT_SYSTEMS[1 - UNIT_SYSTEMS.index(wanted)]
    if hidden[wanted]:
        return ("%s checks the %s radio but ships #%s-fields hidden, so the "
                "form paints with no inputs at all until applyUnits() runs"
                % (FORM_PAGE, wanted, wanted))
    if not hidden[other]:
        return ("%s checks the %s radio but does not ship #%s-fields hidden, "
                "so the form paints both unit systems at once"
                % (FORM_PAGE, wanted, other))
    return None


def key_shaped_content():
    """(file, description) for anything in apps/web resembling a key."""
    hits = []
    for root, _dirs, names in os.walk(WEB):
        for name in sorted(names):
            full = os.path.join(root, name)
            rel = os.path.relpath(full, WEB).replace(os.sep, "/")
            try:
                text = open(full, encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                continue  # binary asset - not where a pasted key lands
            for pattern, description in KEY_PATTERNS:
                if re.search(pattern, text, re.I):
                    hits.append((rel, description))
    return hits


def main():
    problems = []
    environments, config_problems = config_environments()

    for page, target in html_references():
        if not os.path.exists(os.path.join(WEB, target.replace("/", os.sep))):
            problems.append("%s references %s, which does not exist"
                            % (page, target))

    for page, description in missing_head_pieces():
        problems.append("%s is missing %s" % (page, description))

    for problem in config_problems:
        problems.append("%s: %s." % (CONFIG_FILE, problem))

    for problem in crossed_wire_problems(environments):
        problems.append("%s: %s." % (CONFIG_FILE, problem))

    origins = []
    for environment in environments:
        origin = endpoint_origin(environment["endpoint"])
        if environment["endpoint"] and not origin:
            problems.append(
                "%s: the %s endpoint is not a literal HTTPS URL." %
                (CONFIG_FILE, environment["host"]))
        if origin:
            origins.append(origin)

        problem = public_key_problem(environment["publicKey"])
        if problem:
            problems.append(
                "%s: the %s arm has %s. Every submission on that hostname "
                "would fail at encryption time." %
                (CONFIG_FILE, environment["host"], problem))

    for page, origin in csp_gaps(origins):
        problems.append(
            "%s does not allow %s in its CSP connect-src, but that is the "
            "endpoint one config.js arm points at - every request would be "
            "blocked by the browser." % (page, origin))

    problem = hidden_attribute_problem()
    if problem:
        problems.append(problem + ".")

    for page, problem in nav_problems():
        problems.append("%s %s." % (page, problem))

    for code, problem in promoted_country_problems():
        problems.append("%s: the promoted country %s %s."
                        % (COUNTRIES_FILE, code, problem))

    problem = units_default_problem()
    if problem:
        problems.append(
            "%s. The checked radio and the visible field group are the same "
            "decision written twice; applyUnits() hides the disagreement a "
            "moment after the browser has already shown it." % problem)

    for name, problem in unencrypted_paths():
        problems.append(
            "%s %s. Encrypting before anything leaves the browser is the "
            "whole design - see DESIGN.md." % (name, problem))

    for rel, description in key_shaped_content():
        problems.append(
            "apps/web/%s contains %s. apps/web is published verbatim to a "
            "public site - this must not be committed." % (rel, description))

    if problems:
        for p in problems:
            print("::error::%s" % p)
        print("\napps/web FAILED %d check(s)" % len(problems))
        return 1

    pages = html_pages()
    # "distinct" was the whole claim once, and it was too weak to be worth
    # printing on its own - two arms with their values exchanged are
    # distinct. Say that production was pinned, so the line reports what
    # was actually established rather than the part that is easy to check.
    key_note = ("%d distinct environment keys and endpoints, production "
                "pinned" % len(environments))
    print("apps/web OK - %d page(s), all references resolve, shared head "
          "intact, no key-shaped content, %s" % (len(pages), key_note))
    return 0


if __name__ == "__main__":
    sys.exit(main())
