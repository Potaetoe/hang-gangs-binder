"""session-open (WORKING.md, Enforcement #1): every session starts
knowing where it is - the two docs, the current feature, the state -
and warns loudly if another session looks live on this repo."""

import json
import os
import time

from _common import read_input, read_state, state_path

payload = read_input()
session = payload.get("session_id") or str(os.getpid())

print("=== The Binder - session open ===")
print("DESIGN.md says what we build; WORKING.md says how. Both live at "
      "the repo root and are the only things that govern.")

state = read_state()
feature = state.get("feature")
print("Current feature: %s" % (feature or "none handed over yet"))
signoff = state.get("signoff")
if signoff:
    print("Pending sign-off recorded for: %s" % signoff.get("target"))
applied = state.get("migrations_applied")
if applied:
    print("Last migration recorded applied: %s" % applied)

lock_path = os.path.join(os.path.dirname(state_path()), "session.lock")
try:
    with open(lock_path, encoding="utf-8") as f:
        lock = json.load(f)
    age_hours = (time.time() - lock.get("when", 0)) / 3600
    if lock.get("session") != session and age_hours < 8:
        print("WARNING: another session (%s) touched this repo %.1f "
              "hours ago and may still be live. One session at a time "
              "(WORKING.md, the contract) - make sure it is finished "
              "before changing anything."
              % (lock.get("session", "?")[:8], age_hours))
except Exception:
    pass

try:
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    with open(lock_path, "w", encoding="utf-8") as f:
        json.dump({"session": session, "when": time.time()}, f)
except Exception:
    pass
