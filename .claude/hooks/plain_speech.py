"""Inject the owner's plain-speech rule (2026-08-18) into context.

The rule: everyone - Prime and every agent - writes for an 18-year-old
reader. Simple, direct statements. No jargon without a plain-word
explanation. Lead with the point. The owner can ask for more detail
any time; "unless asked otherwise" is the escape hatch.

Fires on UserPromptSubmit (reminds the main session every turn) and
SubagentStart (reminds each agent at spawn). Emits additionalContext;
if an event ignores that field, the pack carries the same rule.
"""
import json
import sys

RULE = (
    "OWNER RULE (2026-08-18, standing): write all replies and reports "
    "at the level an 18-year-old reads easily. Short, direct "
    "sentences. Say the point first. No jargon unless you explain it "
    "in plain words right there. Keep repo files (code, commits, "
    "docs) in the repo's own ruled style - this rule is about how you "
    "talk to people. If the owner asks for more depth, give it."
)


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        data = {}
    event = data.get("hook_event_name") or "UserPromptSubmit"
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": event,
            "additionalContext": RULE,
        }
    }))


if __name__ == "__main__":
    main()
    sys.exit(0)
