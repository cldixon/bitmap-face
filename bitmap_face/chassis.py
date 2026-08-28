"""
The Macintosh the faces sit inside.

The ROM kept the chassis and the face as separate bitmaps and composited them,
and there is no reason to do otherwise: the chassis never changes, so asking a
model to redraw it every time spends tokens on the part of the picture we are
not measuring and adds failure modes that have nothing to do with the question.
Keeping them apart also means a face can be judged on its own terms.

Offsets are constants rather than detected. The chassis is fixed, and a detector
that reads its geometry is a second thing that can be wrong.
"""

from bitmap_face.bitmap import Bits, bits_from_hex

WIDTH = 32
HEIGHT = 32

# A 32 x 32 Macintosh with the screen left empty.
CHASSIS: list[str] = [
    "07FFFFC0",
    "08000020",
    "10000010",
    "13FFFF90",
    "12000090",
    "12000090",
    "12000090",
    "12000090",
    "12000090",
    "12000090",
    "12000090",
    "12000090",
    "12000090",
    "12000090",
    "12000090",
    "12000090",
    "12000090",
    "13FFFF90",
    "10000010",
    "13CF0090",
    "10000010",
    "08000020",
    "07FFFFC0",
    "000F8000",
    "00088000",
    "00088000",
    "007FF000",
    "00800800",
    "01000400",
    "01FFFC00",
    "00000000",
    "00000000",
]

# The screen's frame is rows 3 and 17, with its sides at columns 6 and 24, so
# the usable interior is 17 wide and 13 tall at (7, 4). A 16 x 10 face centres
# there with a column to spare either side and three rows over.
SCREEN_X = 7
SCREEN_Y = 5
SCREEN_W = 17
SCREEN_H = 13


def compose(face: Bits, x: int = SCREEN_X, y: int = SCREEN_Y) -> Bits:
    """Lay a face into the chassis screen. The face wins where they overlap."""
    out = [row[:] for row in bits_from_hex(CHASSIS, WIDTH)]
    for fy, row in enumerate(face):
        for fx, bit in enumerate(row):
            if bit and 0 <= y + fy < HEIGHT and 0 <= x + fx < WIDTH:
                out[y + fy][x + fx] = 1
    return out
