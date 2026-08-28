"""Compositing is ours, not the model's, so it is pinned here."""

from bitmap_face.bitmap import bits_from_hex, draw
from bitmap_face.chassis import (
    CHASSIS,
    HEIGHT,
    SCREEN_H,
    SCREEN_W,
    SCREEN_X,
    SCREEN_Y,
    WIDTH,
    compose,
)
from bitmap_face.reference import REFERENCE


def test_the_chassis_is_32_square() -> None:
    assert len(CHASSIS) == HEIGHT
    assert all(len(row) == WIDTH // 4 for row in CHASSIS)


def test_the_empty_screen_is_empty() -> None:
    body = bits_from_hex(CHASSIS, WIDTH)
    for y in range(SCREEN_Y, SCREEN_Y + SCREEN_H - 3):
        assert sum(body[y][SCREEN_X : SCREEN_X + SCREEN_W]) == 0


def test_a_face_lands_inside_the_screen() -> None:
    body = bits_from_hex(CHASSIS, WIDTH)
    composed = compose(bits_from_hex(REFERENCE["happy"], 16))
    lit = {(y, x) for y, row in enumerate(composed) for x, b in enumerate(row) if b}
    was = {(y, x) for y, row in enumerate(body) for x, b in enumerate(row) if b}
    added = lit - was
    assert added, "the face added no pixels"
    assert all(SCREEN_X <= x < SCREEN_X + SCREEN_W for _, x in added)
    assert all(SCREEN_Y <= y < SCREEN_Y + SCREEN_H for y, _ in added)


def test_the_chassis_itself_is_never_erased() -> None:
    body = bits_from_hex(CHASSIS, WIDTH)
    composed = compose([[1] * 16 for _ in range(10)])
    for y, row in enumerate(body):
        for x, bit in enumerate(row):
            if bit:
                assert composed[y][x] == 1


def test_every_reference_face_composes() -> None:
    for name in REFERENCE:
        assert len(draw(compose(bits_from_hex(REFERENCE[name], 16)))) == HEIGHT
