"""secret-guard (WORKING.md, Enforcement #5): secret-shaped values never
land in repo files. Remedy: `wrangler secret put` for the server,
`.env` (gitignored) for local dev."""

import os
import re

from _common import read_input, deny

# A Telegram bot token, and any assignment of a long opaque value to a
# name that says it is a secret. Placeholders and env reads pass.
TELEGRAM_TOKEN = re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b")
SECRET_ASSIGN = re.compile(
    r"(SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)\s*[=:]\s*"
    r"[\"']?([A-Za-z0-9+/_-]{24,})", re.I)
PLACEHOLDER = re.compile(
    r"(example|placeholder|canary|xxxx|your[-_]|<|\$\{|process\.env"
    r"|env\.|platform\.env)", re.I)

payload = read_input()
tool_input = payload.get("tool_input") or {}
path = (tool_input.get("file_path") or "").replace("\\", "/")
text = tool_input.get("content") or tool_input.get("new_string") or ""

skip = (not path
        or "/.env" in path or path.endswith(".env")
        or path.endswith(".dev.vars")
        or "/Temp/" in path or "/tmp/" in path
        or "/scratchpad/" in path)

if not skip and text:
    if TELEGRAM_TOKEN.search(text):
        deny("That looks like a real Telegram bot token headed into a "
             "repo file (WORKING.md, secret-guard). Secrets go through "
             "`wrangler secret put` or the gitignored .env, never into "
             "the tree.")
    for match in SECRET_ASSIGN.finditer(text):
        context = text[max(0, match.start() - 40):match.end() + 20]
        if not PLACEHOLDER.search(context):
            deny("A value assigned to %r looks like a real secret "
                 "(WORKING.md, secret-guard). Secrets go through "
                 "`wrangler secret put` or the gitignored .env, never "
                 "into the tree." % match.group(1))
