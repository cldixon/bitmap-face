"""
Building the request for each target condition.

The four targets ask for different things, so they need different instructions
and different response schemas, but they share one parser: every response is
`{"faces": [...]}`, even when only one face was asked for.
"""

from __future__ import annotations

from typing import Any

from bitmap_face.bitmap import EMPTY, FILLED, bits_from_hex, draw
from bitmap_face.expressions import Expression
from bitmap_face.reference import REFERENCE
from bitmap_face.schema import Condition, Target

FORMAT_RULES = """1. "grid" -- {h} strings of exactly {w} characters. "{on}" is a set pixel, "{off}" is an empty one.
2. "hex" -- {h} strings of exactly {digits} hex digits. Each row is {w} bits, most significant bit leftmost, so the first digit is the leftmost four pixels of that row."""

LEGIBILITY = (
    "A face reads at this size only if it is built from a few heavy features with clear "
    "space around them -- eyes near the top, a mouth in the lower half. There is no room "
    "for shading, outlines, or detail smaller than a pixel."
)


def system_prompt(condition: Condition) -> str:
    w, h = condition.width, condition.height
    rules = FORMAT_RULES.format(w=w, h=h, on=FILLED, off=EMPTY, digits=w // 4)
    head = (
        f"You draw 1-bit icons for the original Macintosh, in the exact format its ROM "
        f"stored them.\n\nEvery icon is a face: {w} pixels wide and {h} pixels tall, meant "
        f"to sit inside the screen of a Happy Mac."
    )

    if condition.target is Target.BOTH:
        body = (
            f"You give each face in two forms, and they must describe the same pixels.\n\n{rules}\n\n"
            "Draw the grid first, then read the hex off it row by row."
        )
    elif condition.target is Target.GRID_ONLY:
        body = f"You give each face as a grid.\n\n{rules.splitlines()[0]}"
    elif condition.target is Target.HEX_ONLY:
        body = (
            f"You give each face directly as hex, without drawing a grid first.\n\n"
            f"{rules.splitlines()[1]}"
        )
    else:  # TRANSCRIBE
        return (
            f"You transcribe 1-bit Macintosh icons from their drawn form into hex.\n\n"
            f"Each icon is {w} pixels wide and {h} tall. You are given the grid; return its hex.\n\n"
            f"{rules.splitlines()[1]}\n\n"
            f'In the grid, "{FILLED}" is a set pixel and "{EMPTY}" is an empty one.'
        )

    return f"{head}\n\n{body}\n\n{LEGIBILITY}"


def reference_block(count: int, width: int) -> str:
    """The first `count` ROM faces, shown in both forms."""
    blocks = []
    for name in list(REFERENCE)[:count]:
        rows = REFERENCE[name]
        grid = draw(bits_from_hex(rows, width))
        body = "\n".join(f"{g}  {h}" for g, h in zip(grid, rows))
        blocks.append(f"{name}\n{body}")
    return "\n\n".join(blocks)


def user_prompt(
    condition: Condition,
    wanted: list[Expression],
    *,
    context: list[tuple[str, list[str]]] | None = None,
    given: list[tuple[str, list[str]]] | None = None,
) -> str:
    """
    `context` is faces already drawn in this run, shown so a set can hold a
    consistent style when drawing one at a time. `given` is the grids to
    transcribe.
    """
    parts: list[str] = []

    if condition.target is Target.TRANSCRIBE:
        for name, grid in given or []:
            parts.append(f"{name}\n" + "\n".join(grid))
        parts.append(
            f"Give the hex for {'each' if len(given or []) > 1 else 'this'} grid above. "
            "Return them in the order shown."
        )
        return "\n\n".join(parts)

    if condition.references:
        parts.append(
            "Here are real faces from the Mac ROM, in both forms, so you can see the "
            f"house style:\n\n{reference_block(condition.references, condition.width)}"
        )

    if context:
        drawn = "\n\n".join(f"{name}\n" + "\n".join(grid) for name, grid in context)
        parts.append(
            "Faces you have already drawn in this set. Keep the same construction -- "
            f"eye placement, weight, spacing -- so the set hangs together:\n\n{drawn}"
        )

    listing = "\n".join(f"- {e.name}: {e.description}" for e in wanted)
    verb = "Draw this face" if len(wanted) == 1 else f"Draw these {len(wanted)} faces"
    parts.append(f"{verb}:\n\n{listing}")
    return "\n\n".join(parts)


def response_schema(condition: Condition) -> dict[str, Any]:
    """The schema for one target. Always an array, even for a single face."""
    w, h = condition.width, condition.height
    properties: dict[str, Any] = {
        "expression": {"type": "string", "description": "The expression this face is."}
    }
    required: list[str] = ["expression"]

    grid_prop = {
        "type": "array",
        "items": {"type": "string"},
        "description": f"{h} rows of {w} characters, {FILLED} and {EMPTY}",
    }
    hex_prop = {
        "type": "array",
        "items": {"type": "string"},
        "description": f"{h} rows of {w // 4} hex digits",
    }

    # Property order is the generation order, so grid before hex is "draw it,
    # then read it off" rather than the reverse.
    if condition.target in (Target.BOTH, Target.GRID_ONLY):
        properties["grid"] = grid_prop
        required.append("grid")
    if condition.target in (Target.BOTH, Target.HEX_ONLY, Target.TRANSCRIBE):
        properties["hex"] = hex_prop
        required.append("hex")

    face: dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {"faces": {"type": "array", "items": face}},
        "required": ["faces"],
        "additionalProperties": False,
    }
