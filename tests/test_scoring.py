"""
Scoring decides what every chart later says, so the agreement logic is pinned
here against faces built by hand.
"""

from bitmap_face.expressions import BY_NAME
from bitmap_face.reference import REFERENCE
from bitmap_face.run import faults_in, score
from bitmap_face.schema import Condition, Target
from bitmap_face.bitmap import bits_from_hex, draw

HAPPY = REFERENCE["happy"]
GRID = draw(bits_from_hex(HAPPY, 16))
E = BY_NAME["happy"]


def cond(**kw) -> Condition:
    return Condition(model="m", **kw)


def test_matching_forms_agree() -> None:
    a = score(E, {"expression": "happy", "grid": GRID, "hex": HAPPY}, cond())
    assert a.well_formed and a.agrees and a.differing_rows == []
    assert a.hex_from_grid == HAPPY


def test_one_wrong_digit_is_caught_on_its_row() -> None:
    wrong = list(HAPPY)
    wrong[7] = "0804"  # the real row is 0840
    a = score(E, {"expression": "happy", "grid": GRID, "hex": wrong}, cond())
    assert a.agrees is False
    assert a.differing_rows == [7]
    assert a.hex_from_grid is not None and a.hex_from_grid[7] == "0840"


def test_a_short_row_is_a_fault_not_a_crash() -> None:
    grid = list(GRID)
    grid[3] = grid[3][:15]
    a = score(E, {"expression": "happy", "grid": grid, "hex": HAPPY}, cond())
    assert not a.well_formed
    assert any("15 wide" in f for f in a.faults)
    assert a.agrees is False


def test_single_form_targets_have_nothing_to_agree_with() -> None:
    for target, payload in (
        (Target.GRID_ONLY, {"grid": GRID}),
        (Target.HEX_ONLY, {"hex": HAPPY}),
    ):
        a = score(E, {"expression": "happy", **payload}, cond(target=target))
        assert a.well_formed
        # None, not False -- "not measurable" and "measured and wrong" must not
        # collapse into the same number.
        assert a.agrees is None


def test_transcribe_scores_against_ground_truth_we_already_hold() -> None:
    wrong = list(HAPPY)
    wrong[8] = "07B0"  # the real row is 0780
    a = score(
        E,
        {"expression": "happy", "hex": wrong},
        cond(target=Target.TRANSCRIBE),
        given=GRID,
        expected=HAPPY,
    )
    assert a.agrees is False and a.differing_rows == [8]
    assert a.expected_hex == HAPPY


def test_a_face_that_never_came_back_is_marked_missing() -> None:
    a = score(E, None, cond())
    assert a.missing and not a.well_formed and a.agrees is None


def test_faults_name_every_kind_of_wrong() -> None:
    c = cond()
    assert faults_in(GRID, HAPPY, c) == []
    assert any("9 grid rows" in f for f in faults_in(GRID[:9], HAPPY, c))
    assert any("uses" in f for f in faults_in(["─" * 16] + GRID[1:], HAPPY, c))
    assert any("hex row 0" in f for f in faults_in(GRID, ["ZZZZ"] + HAPPY[1:], c))
