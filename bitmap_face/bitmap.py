"""
The two written forms of a 1-bit bitmap, and the conversion between them.

A row is WIDTH bits. As a grid it is WIDTH characters, filled or empty. As hex
it is WIDTH/4 digits, most significant bit leftmost, so the first digit is the
leftmost four pixels. The two forms describe the same pixels, and the whole
experiment turns on whether a model that emits both emits them consistently --
so everything here is deliberately dull, exhaustively tested, and free of any
model in the loop.
"""

FILLED = "█"  # full block
EMPTY = "·"  # middle dot

Bits = list[list[int]]


def bits_from_hex(rows: list[str], width: int) -> Bits:
    """Decode hex rows to bits. Rows that are not hex decode to blank."""
    out: Bits = []
    for row in rows:
        try:
            value = int(row, 16)
        except ValueError:
            value = 0
        out.append([(value >> (width - 1 - x)) & 1 for x in range(width)])
    return out


def bits_from_grid(rows: list[str], width: int) -> Bits:
    """
    Decode grid rows to bits.

    Anything that is not the filled character reads as empty, and short rows are
    padded rather than rejected -- a malformed row is still worth looking at, and
    refusing to render it is how the first version of this harness threw away
    seven of eight faces without saying why.
    """
    out: Bits = []
    for row in rows:
        chars = list(row)[:width]
        chars += [EMPTY] * (width - len(chars))
        out.append([1 if c == FILLED else 0 for c in chars])
    return out


def hex_from_bits(bits: Bits) -> list[str]:
    """Encode bits to hex rows -- the answer a correct conversion would give."""
    rows = []
    for row in bits:
        digits = ""
        for i in range(0, len(row), 4):
            nibble = row[i] * 8 + row[i + 1] * 4 + row[i + 2] * 2 + row[i + 3]
            digits += format(nibble, "X")
        rows.append(digits)
    return rows


def draw(bits: Bits) -> list[str]:
    """Render bits as grid rows."""
    return ["".join(FILLED if b else EMPTY for b in row) for row in bits]


def differing_rows(a: Bits, b: Bits) -> list[int]:
    """Indices where two bitmaps disagree."""
    return [y for y, (ra, rb) in enumerate(zip(a, b)) if ra != rb]
