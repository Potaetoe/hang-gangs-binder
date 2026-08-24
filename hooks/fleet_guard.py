"""fleet-guard (WORKING.md, Enforcement #6): agents are tools, held to
the fleet rules - an agent that edits code runs isolated with a
machine-checkable done; Haiku never edits; no agent pushes, merges, or
deploys."""

import re

from _common import read_input, deny

payload = read_input()
tool_input = payload.get("tool_input") or {}
prompt = tool_input.get("prompt") or ""
model = (tool_input.get("model") or "").lower()
subagent = (tool_input.get("subagent_type") or "").lower()
isolation = tool_input.get("isolation") or ""

EDITISH = re.compile(
    r"\b(implement|build|edit|fix|refactor|port|rewrite|add|create)\b"
    r".{0,120}?\b(src/|routes/|hooks/|drizzle/|\.ts\b|\.svelte\b"
    r"|component|migration|schema)", re.I | re.S)
DONE_LINE = re.compile(
    r"\b(done means|done:|machine-checkable|tests? (must )?pass"
    r"|typecheck|check passes|playwright|npm run (check|test))", re.I)
SHIP_ACTS = re.compile(
    r"\b(git push|push the branch|pr merge|merge the (pr|branch)"
    r"|wrangler deploy|deploy (it|the))", re.I)

edits = bool(EDITISH.search(prompt))

if SHIP_ACTS.search(prompt):
    deny("Agents never push, merge, or deploy (WORKING.md, fleet-guard)."
         " They hand back a diff and a report; landing is Claude's, "
         "after the owner's OK.")

if edits and "haiku" in model:
    deny("Haiku is for lookup, never for edits (WORKING.md, the fleet "
         "table). Use Sonnet for bounded coding, or do it directly.")

if edits and isolation != "worktree":
    deny("An agent that edits code runs in an isolated worktree "
         "(WORKING.md, fleet-guard). Add isolation: \"worktree\" to "
         "the dispatch.")

if edits and not DONE_LINE.search(prompt):
    deny("A delegated coding task needs a machine-checkable done "
         "(WORKING.md, fleet-guard): say in the prompt which tests or "
         "checks define success, or keep the work.")
