/**
 * The two written forms, and the chassis, for the browser.
 *
 * A deliberate mirror of bitmap_face/bitmap.py and bitmap_face/chassis.py --
 * the panel has to decode exactly the way the experiment scored, or it would
 * show a disagreement the record does not claim. Kept as plain ES modules so
 * the panel has no build step. If a third copy ever appears, that is the point
 * at which this should become a shared package rather than a mirror.
 */
export const FILLED = "█";
export const EMPTY = "·";

export function hexToBitmap(rows, width, height = width) {
  return Array.from({ length: height }, (_, y) => {
    const value = parseInt(rows[y] ?? "0", 16);
    const safe = Number.isNaN(value) ? 0 : value;
    return Array.from({ length: width }, (_, x) => (safe >>> (width - 1 - x)) & 1);
  });
}

export function gridToBitmap(rows, width, height = width) {
  return Array.from({ length: height }, (_, y) => {
    const chars = Array.from(rows[y] ?? "");
    return Array.from({ length: width }, (_, x) => (chars[x] === FILLED ? 1 : 0));
  });
}

/** A bitmap back as grid rows, the inverse of `gridToBitmap`. */
export function draw(bitmap) {
  return bitmap.map((row) => row.map((bit) => (bit ? FILLED : EMPTY)).join(""));
}

export function hexFromBitmap(bitmap) {
  return bitmap.map((row) => {
    let out = "";
    for (let i = 0; i < row.length; i += 4) {
      out += (row[i] * 8 + row[i + 1] * 4 + row[i + 2] * 2 + row[i + 3]).toString(16).toUpperCase();
    }
    return out;
  });
}

/** One SVG path, horizontal runs merged. Width and height are free. */
export function bitmapToPath(bitmap) {
  let d = "";
  bitmap.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) { x++; continue; }
      let run = 0;
      while (row[x + run]) run++;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return d;
}

export const CHASSIS = [
  "07FFFFC0","08000020","10000010","13FFFF90","12000090","12000090","12000090","12000090",
  "12000090","12000090","12000090","12000090","12000090","12000090","12000090","12000090",
  "12000090","13FFFF90","10000010","13CF0090","10000010","08000020","07FFFFC0","000F8000",
  "00088000","00088000","007FF000","00800800","01000400","01FFFC00","00000000","00000000",
];
export const SCREEN_X = 7;
export const SCREEN_Y = 5;

/** Lay a face into the chassis screen. The face wins where they overlap. */
export function compose(face, x = SCREEN_X, y = SCREEN_Y) {
  const out = hexToBitmap(CHASSIS, 32).map((row) => row.slice());
  face.forEach((row, fy) =>
    row.forEach((bit, fx) => {
      const ty = y + fy, tx = x + fx;
      if (bit && ty >= 0 && ty < 32 && tx >= 0 && tx < 32) out[ty][tx] = 1;
    }),
  );
  return out;
}

/** An <svg> for a bitmap, with optional rows banded as disagreeing. */
export function svg(bitmap, { scale = 6, bands = [] } = {}) {
  const h = bitmap.length;
  const w = bitmap[0]?.length ?? 0;
  const banded = bands
    .map((y) => `<rect x="0" y="${y}" width="${w}" height="1" class="band"/>`)
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}"
    shape-rendering="crispEdges">${banded}<path d="${bitmapToPath(bitmap)}" fill="currentColor"/></svg>`;
}
