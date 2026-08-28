"""
Geometric references: teach the encoding without teaching a face.

The evidence is that the ROM examples were not teaching house style so much as
teaching the grid-to-hex correspondence -- blind, the models still drew
well-formed faces and it was the *conversion* that drifted, always at a nibble
boundary. If that is what references buy, they need not be faces at all.

These teach exactly that, and nothing else. There is no face to copy, no style
to inherit, and no need to hold up the ROM's oddest icons -- pirate, zombie,
recursive -- as the canonical example of "happy".

Each is chosen for the lesson it carries:

    frame     both ends of a row at once: FFFF and 8001
    checker   nibble alignment, as plainly as it can be put: CCCC and 3333
    diagonal  one pixel walking every column, straight through the middle
    wedge     the row filling one pixel at a time, all the way across
"""

from bitmap_face.bitmap import Bits, hex_from_bits

WIDTH = 16
HEIGHT = 10


def _make(fn) -> Bits:
    return [[1 if fn(x, y) else 0 for x in range(WIDTH)] for y in range(HEIGHT)]


SHAPES: dict[str, Bits] = {
    "frame": _make(lambda x, y: x in (0, WIDTH - 1) or y in (0, HEIGHT - 1)),
    "checker": _make(lambda x, y: (x // 2 + y // 2) % 2 == 0),
    "diagonal": _make(lambda x, y: abs(x - y * 1.6) < 1.2),
    "wedge": _make(lambda x, y: x < y * 1.6),
    "bars": _make(lambda x, y: y % 3 == 0),
    "corners": _make(lambda x, y: (x < 3 or x >= WIDTH - 3) and (y < 2 or y >= HEIGHT - 2)),
}

#: Same shape as bitmap_face.reference.REFERENCE, so either can be handed to the
#: prompt builder without it caring which it got.
SHAPE_HEX: dict[str, list[str]] = {name: hex_from_bits(bits) for name, bits in SHAPES.items()}
