"""
The standard expression set.

Every run draws the same list so runs can be compared face to face. Before this
existed each model invented its own subjects -- across three runs the models
chose fifteen different expressions and only four were common to all of them,
which made "Haiku did worse" partly a statement about Haiku attempting harder
faces.

The set is grounded in the Happy Mac variants the ROM shipped, minus the ones
that are in-jokes or Apple-specific rather than expressions ("recursive", "lady
mac"), plus the obvious gap in that set: there is no sad face in the ROM.

Each carries a description because the model should not be guessing what we
mean, and a tier because a set with no hard faces in it cannot show where
legibility breaks down.
"""

from dataclasses import dataclass
from enum import StrEnum


class Tier(StrEnum):
    """Roughly how much room 16 x 10 leaves for the idea."""

    EASY = "easy"  # unmistakable from eyes and a mouth alone
    MEDIUM = "medium"  # needs a brow, an asymmetry, or a third feature
    HARD = "hard"  # subtle, or more idea than the pixels comfortably hold
    PROP = "prop"  # an added object rather than an expression


@dataclass(frozen=True)
class Expression:
    name: str
    description: str
    tier: Tier
    #: Name of the ROM face this descends from, where there is one.
    rom: str | None = None


EXPRESSIONS: tuple[Expression, ...] = (
    Expression("happy", "smiling, content", Tier.EASY, rom="happy"),
    Expression("sad", "downturned mouth, dejected", Tier.EASY),
    Expression("surprised", "wide eyes, open mouth", Tier.EASY, rom="surprise"),
    Expression("angry", "brows drawn down and inward, tight mouth", Tier.MEDIUM),
    Expression("sleepy", "eyes closed or half shut, drowsy", Tier.MEDIUM, rom="sleepy"),
    Expression("wink", "one eye shut, the other open, playful", Tier.MEDIUM, rom="shifty"),
    Expression("yuck", "disgusted, tongue out", Tier.MEDIUM, rom="yuck"),
    Expression("kiss", "lips pursed forward", Tier.HARD, rom="kiss"),
    Expression("confused", "asymmetric, uncertain, one brow raised", Tier.HARD),
    Expression("smug", "self-satisfied, a small one-sided smile", Tier.HARD),
    Expression("sunglasses", "wearing dark glasses across both eyes", Tier.PROP, rom="sunglasses"),
    Expression("nerdy", "wearing round spectacles", Tier.PROP, rom="nerdy"),
)

BY_NAME: dict[str, Expression] = {e.name: e for e in EXPRESSIONS}
NAMES: tuple[str, ...] = tuple(e.name for e in EXPRESSIONS)


def resolve(names: list[str] | None) -> tuple[Expression, ...]:
    """
    Turn a list of names into expressions, or all of them when given nothing.

    Unknown names are an error rather than a silent skip: a run that quietly
    drew eleven of twelve faces would compare against one that drew twelve.
    """
    if not names:
        return EXPRESSIONS
    unknown = [n for n in names if n not in BY_NAME]
    if unknown:
        raise ValueError(f"unknown expression(s): {', '.join(unknown)}. Known: {', '.join(NAMES)}")
    return tuple(BY_NAME[n] for n in names)
