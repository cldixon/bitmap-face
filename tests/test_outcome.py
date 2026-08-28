"""The five states, and the line between "broke the format" and "contradicted itself"."""

from bitmap_face.outcome import MEANING, OUTCOMES, classify, fault_kind, note
from bitmap_face.schema import Attempt


def make(
    *,
    well_formed: bool = True,
    agrees: bool | None = None,
    missing: bool = False,
    faults: list[str] | None = None,
    differing_rows: list[int] | None = None,
) -> Attempt:
    return Attempt(
        expression="happy",
        tier="easy",
        well_formed=well_formed,
        agrees=agrees,
        missing=missing,
        faults=faults or [],
        differing_rows=differing_rows or [],
    )


def test_missing_beats_every_other_state():
    assert classify(make(missing=True, well_formed=False, agrees=False)) == "missing"


def test_malformed_is_not_reported_as_disagreement():
    # The bug this whole module exists to prevent: a face that broke the format
    # never got to the point of having two forms to compare.
    a = make(well_formed=False, agrees=False, faults=["grid row 1 is 14 wide: '..'"])
    assert classify(a) == "malformed"


def test_one_form_only_is_drawn_not_a_failure():
    assert classify(make(agrees=None)) == "drawn"


def test_agreement_states():
    assert classify(make(agrees=True)) == "agrees"
    assert classify(make(agrees=False)) == "differs"


def test_every_state_has_a_meaning_and_an_order():
    assert set(OUTCOMES) == set(MEANING)


def test_fault_kinds_cover_the_real_strings():
    assert fault_kind("grid row 1 is 14 wide: '····'") == "grid_row_width"
    assert fault_kind("10 grid rows, expected 12") == "grid_row_count"
    assert fault_kind("something new") == "other"


def test_note_names_the_differing_rows():
    assert note(make(agrees=False, differing_rows=[2, 3])) == "2 rows differ — 2, 3"
    assert note(make(agrees=True)) == ""
