"""PostToolUse check: the fleet address book must stay parseable.

state.json (~/.claude/binder-fleet/state.json) is read before every
SendMessage routing decision (owner ruling: never route from recall).
A Write/Edit that leaves it unparseable would silently break routing
for every later dispatch, so this hook re-parses it after any edit and
blocks with the parse error if it no longer loads. Every other file
passes through untouched.
"""
import json
import sys


def main():
    data = json.load(sys.stdin)
    fp = (data.get("tool_input") or {}).get("file_path") or ""
    if not fp.replace("\\", "/").lower().endswith("binder-fleet/state.json"):
        return
    try:
        with open(fp, encoding="utf-8") as f:
            json.load(f)
    except Exception as exc:
        print(json.dumps({
            "decision": "block",
            "reason": ("state.json no longer parses (%s). It is the fleet "
                       "address book - restore valid JSON before anything "
                       "else routes a message." % exc),
        }))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # fail open
    sys.exit(0)
