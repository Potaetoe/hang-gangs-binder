#!/usr/bin/env python3
"""
Check that apps/web is internally consistent and safe to publish.

    python tools/check_web.py

Derived from what is actually in the directory rather than from a
hand-maintained list, because a hand-maintained list only knows about
files somebody remembered to add to it.

Three checks:

1. Every local href/src in the HTML resolves to a file that exists. A
   rename that misses one reference publishes a page that 404s its own
   stylesheet and renders a dead form.

2. Nothing in apps/web looks like a private key. This is the one that
   matters. The whole design rests on the private key never being
   published, and apps/web is copied verbatim to a public site - so the
   moment a key lands in that directory it is public, permanently, in
   the git history as well as on the web. A regex is a weak guard, but
   it catches the realistic accident: pasting a key into config.js "just
   to test the export locally" and forgetting.

3. Every page carries the shared head: charset, viewport, title, the
   content security policy, the stylesheet and the pre-paint theme
   script. The pages still to be written - admin.html and the form -
   are the ones that handle plaintext and keys, so "I copied the old
   page and trimmed the head" is exactly the mistake worth catching
   automatically rather than at review.
"""

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
    print("apps/web OK - %d page(s), all references resolve, shared head "
          "intact, no key-shaped content" % len(pages))
    return 0


if __name__ == "__main__":
    sys.exit(main())
