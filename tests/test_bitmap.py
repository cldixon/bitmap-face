"""
The conversion is the measuring instrument, so it gets tested before it is
trusted to judge anything. Every case here is checkable by hand against the ROM
dump in bitmap_face.reference.
"""

import pytest

from bitmap_face.bitmap import (
    EMPTY,
    FILLED,
    bits_from_grid,
    bits_from_hex,
    differing_rows,
    draw,
    hex_from_bits,
)
from bitmap_face.reference import HEIGHT, REFERENCE, WIDTH


@pytest.mark.parametrize("name", sorted(REFERENCE))
def test_every_reference_face_round_trips(name: str) -> None:
    rows = REFERENCE[name]
    assert len(rows) == HEIGHT
    assert hex_from_bits(bits_from_hex(rows, WIDTH)) == rows


@pytest.mark.parametrize("name", sorted(REFERENCE))
def test_the_two_forms_decode_alike(name: str) -> None:
    bits = bits_from_hex(REFERENCE[name], WIDTH)
    assert bits_from_grid(draw(bits), WIDTH) == bits


def test_the_happy_face_is_the_face_we_think_it_is() -> None:
    # Row 1 of the ROM's happy face is 0x1110: pixels at columns 3, 7 and 11.
    row = bits_from_hex(REFERENCE["happy"], WIDTH)[1]
    assert [x for x, bit in enumerate(row) if bit] == [3, 7, 11]


def test_a_single_flipped_pixel_is_caught_on_the_right_row() -> None:
    bits = bits_from_hex(REFERENCE["happy"], WIDTH)
    tampered = [row[:] for row in bits]
    tampered[3][8] ^= 1
    assert differing_rows(bits, tampered) == [3]


def test_identical_bitmaps_differ_nowhere() -> None:
    bits = bits_from_hex(REFERENCE["sleepy"], WIDTH)
    assert differing_rows(bits, bits) == []


def test_the_error_the_model_actually_made() -> None:
    """
    Blind Sonnet 5 wrote 0808 for a row that was 0810, three times, on the same
    shape: it lost count crossing the middle of the row. Pinned here because it
    is the finding, and a conversion that quietly agreed with it would hide it.
    """
    grid = ["····█······█····"]
    assert hex_from_bits(bits_from_grid(grid, WIDTH)) == ["0810"]
    assert draw(bits_from_hex(["0808"], WIDTH)) == ["····█·······█···"]


def test_short_and_junk_rows_are_padded_not_rejected() -> None:
    assert draw(bits_from_grid(["█"], WIDTH))[0] == FILLED + EMPTY * (WIDTH - 1)
    assert draw(bits_from_hex(["zzzz"], WIDTH))[0] == EMPTY * WIDTH
