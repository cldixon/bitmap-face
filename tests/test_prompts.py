"""
The prompt is now assembled from templates, so the things that can break are
whitespace and conditionals rather than string formatting. Both are silent: a
run-together line or a missing example still produces a valid request, and the
numbers that come back look fine.
"""

import pytest

from bitmap_face.expressions import resolve
from bitmap_face.prompts import references_for, system_prompt, user_prompt
from bitmap_face.schema import Condition, ReferenceSet, Target

HAPPY = list(resolve(["happy"]))
TWO = list(resolve(["happy", "sad"]))


def cond(**kw) -> Condition:
    return Condition(model="m", **kw)


@pytest.mark.parametrize("target", list(Target))
def test_every_target_renders(target: Target) -> None:
    c = cond(target=target)
    system = system_prompt(c)
    assert "16 pixels wide and 10 pixels tall" in system
    assert user_prompt(c, HAPPY, given=[("happy", ["█" * 16])])


def test_each_target_asks_for_the_forms_it_wants() -> None:
    both = system_prompt(cond(target=Target.BOTH))
    assert '1. "grid"' in both and '2. "hex"' in both
    assert "Draw the grid first" in both

    grid = system_prompt(cond(target=Target.GRID_ONLY))
    assert '"grid"' in grid and '"hex"' not in grid

    hexed = system_prompt(cond(target=Target.HEX_ONLY))
    assert '"hex"' in hexed and '"grid"' not in hexed
    assert "without drawing a grid first" in hexed


def test_paragraphs_stay_separated() -> None:
    # trim_blocks eats the newline after every block tag, so a partial that does
    # not carry its own runs into the next line. That reads as one instruction
    # instead of two and nothing errors.
    both = system_prompt(cond(target=Target.BOTH))
    assert '\n1. "grid"' in both
    assert '\n2. "hex"' in both
    assert "\n\nDraw the grid first" in both
    assert "one.2." not in both

    user = user_prompt(cond(references=0), TWO)
    assert "Draw these 2 faces:\n\n- happy" in user


def test_the_legibility_note_is_for_drawing_not_transcribing() -> None:
    assert "reads at this size" in system_prompt(cond(target=Target.BOTH))
    assert "reads at this size" not in system_prompt(cond(target=Target.TRANSCRIBE))


def test_blind_shows_nothing() -> None:
    user = user_prompt(cond(references=0), HAPPY)
    assert "Here are" not in user
    assert references_for(cond(references=0)) == []


def test_the_two_corpora_are_introduced_differently() -> None:
    faces = user_prompt(cond(references=2, reference_set=ReferenceSet.FACES), HAPPY)
    shapes = user_prompt(cond(references=2, reference_set=ReferenceSet.SHAPES), HAPPY)
    assert "real faces from the Mac ROM" in faces
    assert "patterns in both forms" in shapes
    # Shapes carry no face, which is the whole point of having them.
    assert "happy\n" not in shapes.split("Draw this face")[0]


def test_references_are_shown_in_both_forms() -> None:
    user = user_prompt(cond(references=1, reference_set=ReferenceSet.SHAPES), HAPPY)
    assert "████████████████  FFFF" in user
    assert "█··············█  8001" in user


def test_the_no_copy_directive_needs_something_to_not_copy() -> None:
    with_refs = user_prompt(cond(references=2, no_copy=True), HAPPY)
    assert "Do not reproduce any example above" in with_refs
    # Blind, the directive would refer to examples that are not there.
    blind = user_prompt(cond(references=0, no_copy=True), HAPPY)
    assert "Do not reproduce" not in blind


def test_context_faces_appear_when_supplied() -> None:
    user = user_prompt(cond(references=0), HAPPY, context=[("sad", ["█" * 16])])
    assert "already drawn in this set" in user
    assert "sad" in user


def test_transcribe_shows_the_grid_and_asks_only_for_hex() -> None:
    c = cond(target=Target.TRANSCRIBE, references=0)
    user = user_prompt(c, HAPPY, given=[("happy", ["█" * 16, "·" * 16])])
    assert "Give the hex for this grid above." in user
    assert "█" * 16 in user
    assert "Draw" not in user
