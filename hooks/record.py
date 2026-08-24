"""The state recorder the gates read.

    py -3 hooks/record.py signoff <target> "<the owner's words>"
    py -3 hooks/record.py migrations-applied <file-name>
    py -3 hooks/record.py feature "<name>"

Each write is deliberate: recording a sign-off that was not given is
lying to the merge-gate, and the gate can only ever be as honest as
this record.
"""

import sys
import time

from _common import read_state, write_state


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    kind = argv[0]
    state = read_state()
    if kind == "signoff":
        state["signoff"] = {
            "target": argv[1],
            "words": " ".join(argv[2:]) or "(unrecorded)",
            "when": time.strftime("%Y-%m-%d %H:%M"),
        }
    elif kind == "migrations-applied":
        state["migrations_applied"] = argv[1]
    elif kind == "feature":
        state["feature"] = " ".join(argv[1:])
    else:
        print(__doc__)
        return 1
    write_state(state)
    print("recorded: %s" % kind)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
