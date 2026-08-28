"""
What an experiment produces.

This module is the contract. Everything the runner writes and everything the
panel and the exporter read is defined here, so the shape of the data lives in
one readable place rather than being implied by whichever code touched it last.
Read this file to understand what we collect.

Three ideas, in order of size:

    Condition  the cell being tested -- model, target, batching, references.
               Two runs with the same Condition are repeats of each other.
    Attempt    one requested expression and what came back for it.
    Run        a Condition, the calls it took, and the attempts it produced.

Everything serialises to plain JSON -- dicts, lists, strings, numbers -- because
a TypeScript panel reads it back. Enums are their string values on the wire.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from hashlib import sha1
from typing import Any

SCHEMA_VERSION = 4


class Target(StrEnum):
    """Which written forms we ask for, and how."""

    #: Grid and hex in one response, grid first. Agreement is measurable inside
    #: a single generation -- draw it, then read it off.
    BOTH = "both"
    #: Grid only. The control: does being asked for hex at all degrade the
    #: drawing?
    GRID_ONLY = "grid_only"
    #: Hex only, no grid. Can it compose directly in the encoded form? Nothing
    #: to agree with, so this is scored on legibility, not consistency.
    HEX_ONLY = "hex_only"
    #: We supply a grid the model did not draw and ask only for its hex.
    #: Transcription is deterministic on our side, so this has ground truth --
    #: it isolates encoding from composing.
    TRANSCRIBE = "transcribe"


class ReferenceSet(StrEnum):
    """Which corpus the in-prompt examples are drawn from."""

    #: Nothing shown. The written spec has to carry it alone.
    NONE = "none"
    #: Real Happy Mac faces. Teaches encoding *and* house style -- and four of
    #: the first six are also expressions we request, so copying is possible and
    #: is measured rather than assumed away.
    FACES = "faces"
    #: Geometric patterns. Teaches the grid-to-hex correspondence with no face
    #: to copy and no style to inherit.
    SHAPES = "shapes"


class Batch(StrEnum):
    """How many expressions per API call."""

    ALL = "all"  # one call draws the whole set; faces share a context
    ONE = "one"  # a call per expression; independent, and the latency we can measure


@dataclass(frozen=True)
class Condition:
    """
    One experimental cell. Two runs sharing a Condition are repeats.

    Everything that could change the answer belongs here, and nothing that
    couldn't -- the id is built from these fields, so an added field changes
    what counts as a repeat.
    """

    model: str
    target: Target = Target.BOTH
    batch: Batch = Batch.ALL
    #: Examples shown in the prompt. Zero is the blind control.
    references: int = 6
    reference_set: ReferenceSet = ReferenceSet.FACES
    #: Tell the model in so many words not to reproduce the examples. Its own
    #: axis rather than a default: the instruction is an intervention, and if it
    #: is always on there is no way to see what it changed.
    no_copy: bool = False
    #: When drawing one at a time, how many already-drawn faces to show, so a
    #: set can hold a consistent style. Zero makes the calls independent.
    context: int = 0
    #: None where the model has no effort control (Haiku 4.5).
    effort: str | None = None
    width: int = 16
    height: int = 10
    #: Which expressions were asked for. Empty means the whole standard set.
    #: Part of the cell's identity: a run of one expression is not a repeat of a
    #: run of twelve, and grouping them as though it were produces scores
    #: averaged over faces that were never attempted.
    expressions: tuple[str, ...] = ()

    @property
    def slug(self) -> str:
        """A filename-safe name for this cell, stable across repeats."""
        parts = [
            self.model.removeprefix("claude-"),
            self.target.value,
            f"batch-{self.batch.value}",
            f"ref{self.references}"
            + ("" if not self.references else f"-{self.reference_set.value}"),
        ]
        if self.no_copy:
            parts.append("nocopy")
        if self.context:
            parts.append(f"ctx{self.context}")
        if self.effort:
            parts.append(self.effort)
        if self.expressions:
            parts.append(self._expression_tag)
        return "-".join(parts)

    @property
    def _expression_tag(self) -> str:
        """
        A short, stable tag for a partial expression set.

        Names when there are few enough to read; otherwise a count plus a digest
        of the names, because two different four-expression subsets are two
        different cells and "e4" alone would merge them.
        """
        names = list(self.expressions)
        if len(names) <= 3:
            return "-".join(names)
        digest = sha1("\u0000".join(sorted(names)).encode()).hexdigest()[:4]
        return f"e{len(names)}-{digest}"


@dataclass
class Call:
    """
    One request to the API. Latency lives here: animation is the next step.

    The token fields are kept apart rather than summed because they answer
    different questions. `input_tokens` is the *uncached* prompt, so with a
    stable system prompt and reference block the true prompt size is all three
    input fields together -- and drawing one face per call repeats that prefix
    on every call, which is the cost that makes or breaks batching. Of the
    output, `thinking_tokens` is the part that was reasoning rather than answer:
    without it, a model that spent twenty thousand tokens thinking and two
    hundred drawing looks simply expensive.
    """

    index: int
    expressions: list[str]
    duration_seconds: float
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0
    thinking_tokens: int = 0
    stop_reason: str | None = None
    #: The user message exactly as sent. Per call, because with --batch one it
    #: differs every time, and with --context it carries the faces drawn so far.
    prompt: str = ""

    @property
    def prompt_tokens(self) -> int:
        """Everything that went in, cached or not."""
        return self.input_tokens + self.cache_read_input_tokens + self.cache_creation_input_tokens


@dataclass
class Attempt:
    """
    One requested expression, and what the model returned for it.

    `hex_from_grid` is the deterministic conversion of the model's own grid --
    what its drawing implies its hex should have been. `agrees` compares the two
    forms the model itself produced; it says nothing about whether the drawing
    is any good, which is a separate measurement.
    """

    expression: str
    tier: str
    #: None when the target did not ask for that form.
    grid: list[str] | None = None
    hex: list[str] | None = None
    hex_from_grid: list[str] | None = None
    #: For TRANSCRIBE: the grid we supplied, and the answer we already knew.
    given_grid: list[str] | None = None
    expected_hex: list[str] | None = None
    faults: list[str] = field(default_factory=list)
    well_formed: bool = False
    #: None when the condition cannot produce an agreement (hex only, grid only).
    agrees: bool | None = None
    #: Name of the in-prompt example this face reproduces exactly, if any.
    #: Measured on every run, not only when the model was told not to.
    copied: str | None = None
    differing_rows: list[int] = field(default_factory=list)
    missing: bool = False


@dataclass
class Prompts:
    """
    What was actually sent, so a run can be read without being re-derived.

    The system prompt and the response schema depend only on the condition, so
    they are stored once; the user message varies per call and lives on the Call.
    Without these a record says which parameters were set but not what they
    produced, and the prompt builder is free to change underneath it -- the
    numbers would then belong to a request nobody can reconstruct.
    """

    system: str
    response_schema: dict[str, Any]


@dataclass
class Totals:
    requested: int
    returned: int
    well_formed: int
    #: Of the attempts where agreement is measurable at all.
    measurable: int
    agreed: int
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0
    thinking_tokens: int = 0
    duration_seconds: float = 0.0

    @property
    def prompt_tokens(self) -> int:
        return self.input_tokens + self.cache_read_input_tokens + self.cache_creation_input_tokens

    @property
    def answer_tokens(self) -> int:
        """Output that was not thinking -- the faces themselves."""
        return self.output_tokens - self.thinking_tokens

    @property
    def agreement_rate(self) -> float | None:
        return self.agreed / self.measurable if self.measurable else None


@dataclass
class Suite:
    """
    A model swept across the four targets, repeated.

    The suite is the unit of comparison: a single condition answers one question
    about one target, and the interesting reading is across them -- can it draw
    without the encoding burden, encode what it just drew, compose straight in
    hex, and hold both at once.
    """

    id: str
    label: str
    targets: list[str]
    repeats: int


@dataclass
class Run:
    """A condition, run once. One cell of a suite, when it belongs to one."""

    id: str
    started_at: str
    condition: Condition
    repeat: int
    calls: list[Call]
    attempts: list[Attempt]
    totals: Totals
    prompts: Prompts | None = None
    suite: Suite | None = None
    schema_version: int = SCHEMA_VERSION

    def to_json(self) -> dict[str, Any]:
        data = asdict(self)
        # StrEnum survives asdict as the enum; make the wire format plain.
        data["condition"]["target"] = str(self.condition.target)
        data["condition"]["batch"] = str(self.condition.batch)
        data["condition"]["reference_set"] = str(self.condition.reference_set)
        data["condition"]["slug"] = self.condition.slug
        # A tuple survives asdict but not a JSON round trip, and the panel
        # compares these against arrays.
        data["condition"]["expressions"] = list(self.condition.expressions)
        data["totals"]["agreement_rate"] = self.totals.agreement_rate
        data["totals"]["prompt_tokens"] = self.totals.prompt_tokens
        data["totals"]["answer_tokens"] = self.totals.answer_tokens
        for call, out in zip(self.calls, data["calls"]):
            out["prompt_tokens"] = call.prompt_tokens
        return data
