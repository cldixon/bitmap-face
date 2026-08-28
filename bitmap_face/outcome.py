"""
What happened to one attempt, in words.

Two questions get confused constantly and must not be: whether the model
produced something in the format asked for, and whether what it produced is
self-consistent. A face 14 pixels wide failed at the first hurdle and never
reached the second, so folding it in with "the grid and the hex disagree"
reports one number for two unrelated failures.

Hence five states, in order of how far an attempt got:

    missing    nothing came back for this expression
    malformed  came back, but broke the format
    drawn      well formed, and there is nothing to check it against
    differs    well formed, but the two written forms contradict each other
    agrees     well formed, and the two forms describe the same pixels

`drawn` is not a lesser `agrees`. It is what grid_only and hex_only produce:
one written form, so no second opinion exists. Treating it as a failure would
punish those targets for the question we chose not to ask them.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bitmap_face.schema import Attempt

#: Ordered worst to best, which is also the order they stack in the panel.
OUTCOMES: tuple[str, ...] = ("missing", "malformed", "differs", "drawn", "agrees")

MEANING: dict[str, str] = {
    "missing": "never came back",
    "malformed": "broke the format",
    "drawn": "one form only — nothing to check against",
    "differs": "the grid and the hex describe different pixels",
    "agrees": "both forms describe the same pixels",
}

# Fault strings are written for a person reading a terminal. These fold them
# into countable kinds, so a run can be characterised without reading every one.
FAULT_KINDS: list[tuple[str, str]] = [
    (r"^grid row \d+ is \d+ wide", "grid_row_width"),
    (r"^grid row \d+ uses", "grid_stray_character"),
    (r"^hex row \d+ is", "hex_row_malformed"),
    (r"^\d+ grid rows, expected", "grid_row_count"),
    (r"^\d+ hex rows, expected", "hex_row_count"),
]

FAULT_LABELS: dict[str, str] = {
    "grid_row_width": "row wrong width",
    "grid_stray_character": "stray character",
    "grid_row_count": "wrong number of rows",
    "hex_row_malformed": "bad hex row",
    "hex_row_count": "wrong number of hex rows",
    "other": "other",
}


def fault_kind(fault: str) -> str:
    for pattern, kind in FAULT_KINDS:
        if re.match(pattern, fault):
            return kind
    return "other"


def classify(attempt: Attempt) -> str:
    """Which of the five states this attempt reached."""
    if attempt.missing:
        return "missing"
    if not attempt.well_formed:
        return "malformed"
    if attempt.agrees is True:
        return "agrees"
    if attempt.agrees is False:
        return "differs"
    return "drawn"


def note(attempt: Attempt) -> str:
    """A short human line for the terminal and the panel, or "" when it went fine."""
    if attempt.missing:
        return "never came back"
    if not attempt.well_formed:
        plural = "s" if len(attempt.faults) != 1 else ""
        return f"{len(attempt.faults)} fault{plural}: {attempt.faults[0]}"
    if attempt.agrees is False:
        rows = attempt.differing_rows
        verb = "row differs" if len(rows) == 1 else "rows differ"
        return f"{len(rows)} {verb} — {', '.join(map(str, rows))}"
    if attempt.agrees is None:
        return "one form only"
    return ""
