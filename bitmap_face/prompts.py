"""
Assembling the prompt from templates.

The prompt has more knobs than a format string can carry legibly -- four
targets, three reference settings, an optional directive, optional context --
so it lives in `templates/` as markdown with jinja2 partials, and this module
only builds the context and renders it. To change what is asked, edit the
markdown; to change what is available, edit here.

Every rendered prompt is stored on the run record, so a record always says what
was actually sent even after the templates move on.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from bitmap_face.bitmap import EMPTY, FILLED, bits_from_hex, draw
from bitmap_face.expressions import Expression
from bitmap_face.reference import REFERENCE
from bitmap_face.schema import Condition, ReferenceSet, Target
from bitmap_face.shapes import SHAPE_HEX

TEMPLATES = Path(__file__).resolve().parent / "templates"


@cache
def environment() -> Environment:
    return Environment(
        loader=FileSystemLoader(TEMPLATES),
        # A missing variable should be a loud failure, not a silent blank in a
        # prompt we then draw conclusions from.
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
        # Partials keep their own trailing newline. trim_blocks strips the one
        # after an {% include %} tag, so without this a one-line partial runs
        # straight into whatever follows it.
        keep_trailing_newline=True,
    )


@dataclass(frozen=True)
class Row:
    grid: str
    hex: str


@dataclass(frozen=True)
class Reference:
    name: str
    rows: list[Row]


def corpus(kind: ReferenceSet) -> dict[str, list[str]]:
    return SHAPE_HEX if kind is ReferenceSet.SHAPES else REFERENCE


def references_for(c: Condition) -> list[Reference]:
    """The first `c.references` entries of the chosen corpus, in both forms."""
    if not c.references or c.reference_set is ReferenceSet.NONE:
        return []
    chosen = list(corpus(c.reference_set))[: c.references]
    out = []
    for name in chosen:
        hexes = corpus(c.reference_set)[name]
        grids = draw(bits_from_hex(hexes, c.width))
        out.append(Reference(name, [Row(g, h) for g, h in zip(grids, hexes)]))
    return out


def base_context(c: Condition) -> dict[str, Any]:
    return {
        "width": c.width,
        "height": c.height,
        "digits": c.width // 4,
        "filled": FILLED,
        "empty": EMPTY,
        "target": str(c.target),
        "reference_set": str(c.reference_set),
    }


def system_prompt(c: Condition) -> str:
    return environment().get_template("system.md").render(**base_context(c)).strip()


def user_prompt(
    c: Condition,
    wanted: list[Expression],
    *,
    context: list[tuple[str, list[str]]] | None = None,
    given: list[tuple[str, list[str]]] | None = None,
) -> str:
    """
    `context` is faces already drawn in this run; `given` is grids to transcribe.
    Both arrive as (name, grid rows) pairs and are reshaped for the template.
    """
    return (
        environment()
        .get_template("user.md")
        .render(
            **base_context(c),
            wanted=wanted,
            references=references_for(c),
            no_copy=c.no_copy,
            context=[{"name": n, "rows": rows} for n, rows in (context or [])],
            given=[{"name": n, "rows": rows} for n, rows in (given or [])],
        )
        .strip()
    )


def response_schema(c: Condition) -> dict[str, Any]:
    """The schema for one target. Always an array, even for a single face."""
    properties: dict[str, Any] = {
        "expression": {"type": "string", "description": "The expression this face is."}
    }
    required: list[str] = ["expression"]

    grid_prop = {
        "type": "array",
        "items": {"type": "string"},
        "description": f"{c.height} rows of {c.width} characters, {FILLED} and {EMPTY}",
    }
    hex_prop = {
        "type": "array",
        "items": {"type": "string"},
        "description": f"{c.height} rows of {c.width // 4} hex digits",
    }

    # Property order is generation order, so grid before hex is "draw it, then
    # read it off" rather than the reverse.
    if c.target in (Target.BOTH, Target.GRID_ONLY):
        properties["grid"] = grid_prop
        required.append("grid")
    if c.target in (Target.BOTH, Target.HEX_ONLY, Target.TRANSCRIBE):
        properties["hex"] = hex_prop
        required.append("hex")

    return {
        "type": "object",
        "properties": {
            "faces": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                    "additionalProperties": False,
                },
            }
        },
        "required": ["faces"],
        "additionalProperties": False,
    }
