#!/usr/bin/env python3
"""
Check that apps/web is internally consistent and safe to publish.

    python tools/check_web.py

Derived from what is actually in the directory rather than from a
hand-maintained list, because a hand-maintained list only knows about
files somebody remembered to add to it.

Five checks:

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

4. The endpoint in config.js is permitted by the CSP of every page that
   loads config.js. These are two files that must agree, and they fail
   apart silently: change the endpoint alone and the pages still load,
   still look right, and drop every submission at the connect-src
   check. Whoever inherits this project and points it at their own
   Worker will change the obvious file and not the other one - so the
   build says so instead of the site failing quietly on their first
   real submitter.

5. The publicKey in config.js is a real P-256 point. It arrives by
   copy-and-paste out of a browser window, which is a step that can
   drop a character or clip an end without looking like it did. The
   result passes every check above and every eye: a plausible base64
   blob in the right place. It fails at the one moment nobody is
   watching - in a submitter's browser, at importKey, after they have
   filled the form. So this decodes it, checks it is a 65-byte
   uncompressed point, and does the curve arithmetic to confirm it
   actually lies on P-256. Cheap, and it moves the discovery from a
   stranger's browser to the terminal of the person who pasted it.
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


def endpoint_origin():
    """The origin of the endpoint in config.js, or None if not set up."""
    path = os.path.join(WEB, "config.js")
    if not os.path.exists(path):
        return None  # not wired up yet; nothing to disagree about
    text = open(path, encoding="utf-8").read()
    match = re.search(r'endpoint\s*:\s*["\'](https://[^"\']+)["\']', text)
    if not match:
        return None
    parts = match.group(1).split("/")
    return "%s//%s" % (parts[0], parts[2])


def csp_gaps(origin):
    """(page, origin) for pages whose CSP would block the endpoint.

    Only pages that actually load config.js are checked. A page with no
    reason to reach the endpoint should not be given permission to - the
    404 page is the current example.
    """
    if not origin:
        return []
    users = set(page for page, target in html_references()
                if target == "config.js")
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
        if not connect or origin not in connect.group(1):
            gaps.append((name, origin))
    return gaps


# P-256, from FIPS 186-4. Only what is needed to test whether a point
# satisfies y^2 = x^3 - 3x + b (mod p); nothing here does cryptography.
P256_P = (1 << 256) - (1 << 224) + (1 << 192) + (1 << 96) - 1
P256_B = int("5ac635d8aa3a93e7b3ebbd55769886bc"
             "651d06b0cc53b0f63bce3c3e27d2604b", 16)


def key_is_set():
    """True once config.js names a key rather than null."""
    path = os.path.join(WEB, "config.js")
    if not os.path.exists(path):
        return False
    text = open(path, encoding="utf-8").read()
    text = re.sub(r"^\s*//.*$", "", text, flags=re.M)
    return bool(re.search(r"publicKey\s*:\s*[\"'][^\"']+[\"']", text))


def public_key_problem():
    """A description of what is wrong with config.js's publicKey, or None.

    None also covers "not set yet" - publicKey: null is the honest state
    before a key exists, and the form refuses to submit while it holds.
    """
    path = os.path.join(WEB, "config.js")
    if not os.path.exists(path):
        return None
    text = open(path, encoding="utf-8").read()
    text = re.sub(r"^\s*//.*$", "", text, flags=re.M)

    if re.search(r"publicKey\s*:\s*null", text):
        return None
    match = re.search(r"publicKey\s*:\s*[\"']([^\"']*)[\"']", text)
    if not match:
        return ("no publicKey is set, and it is not null either - the form "
                "will not know what to encrypt to")

    try:
        raw = base64.b64decode(match.group(1), validate=True)
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

    for page, target in html_references():
        if not os.path.exists(os.path.join(WEB, target.replace("/", os.sep))):
            problems.append("%s references %s, which does not exist"
                            % (page, target))

    for page, description in missing_head_pieces():
        problems.append("%s is missing %s" % (page, description))

    for page, origin in csp_gaps(endpoint_origin()):
        problems.append(
            "%s does not allow %s in its CSP connect-src, but that is the "
            "endpoint config.js points at - every submission would be "
            "blocked by the browser." % (page, origin))

    problem = public_key_problem()
    if problem:
        problems.append(
            "config.js: %s. Every submission would be encrypted to it - or "
            "rather would not be, since the browser rejects it. Re-copy the "
            "line from tools/keygen.html." % problem)

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
    # Say which state the key is in rather than a blanket "OK". "No key
    # yet" is a legitimate state, but it is not the same as a working
    # one, and a run that prints OK either way hides which you are in.
    key_note = ("a valid P-256 public key" if key_is_set()
                else "no public key yet (publicKey: null)")
    print("apps/web OK - %d page(s), all references resolve, shared head "
          "intact, no key-shaped content, %s" % (len(pages), key_note))
    return 0


if __name__ == "__main__":
    sys.exit(main())
