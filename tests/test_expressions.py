from bitmap_face.expressions import EXPRESSIONS, NAMES, Tier, resolve
import pytest


def test_the_set_spans_the_difficulty_range() -> None:
    tiers = {e.tier for e in EXPRESSIONS}
    assert {Tier.EASY, Tier.MEDIUM, Tier.HARD, Tier.PROP} <= tiers


def test_sad_is_present_because_the_rom_set_lacks_one() -> None:
    assert "sad" in NAMES
    assert next(e for e in EXPRESSIONS if e.name == "sad").rom is None


def test_names_are_unique_and_every_face_is_described() -> None:
    assert len(set(NAMES)) == len(NAMES)
    assert all(e.description for e in EXPRESSIONS)


def test_resolve_defaults_to_the_whole_set() -> None:
    assert resolve(None) == EXPRESSIONS
    assert resolve([]) == EXPRESSIONS


def test_resolve_keeps_the_order_asked_for() -> None:
    assert [e.name for e in resolve(["sad", "happy"])] == ["sad", "happy"]


def test_an_unknown_expression_is_an_error_not_a_silent_skip() -> None:
    # A run that quietly drew eleven of twelve would compare against one that
    # drew twelve, and nothing would say so.
    with pytest.raises(ValueError, match="unknown expression"):
        resolve(["happy", "jubilant"])
