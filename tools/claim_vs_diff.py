#!/usr/bin/env python3
"""Claim-vs-diff: the contract, not yet the mechanism. 0.9-M0-S13 (#297).

Stub for the RED commit: the shim and the suite land first, against
this, so the full gate is run once here to prove the rest of the
world is green around this slice's own red before implementation
lands over it.
"""

import sys


def main(argv=None):
    print("tools/claim_vs_diff.py is not implemented yet (0.9-M0-S13, "
         "#297) - this is the contract-first red commit.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
