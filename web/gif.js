/**
 * A minimal animated GIF encoder.
 *
 * The panel has no dependencies and the only animation it produces is a cycle
 * through the tries of one condition, so this covers exactly that: a handful of
 * equally sized frames sharing one palette. It is not a general encoder.
 *
 * Colours are taken from the frames themselves rather than assumed. The icons
 * are drawn with hard edges, but the labels are antialiased text, so a run
 * typically lands in the low hundreds of distinct colours -- under the 256 a
 * GIF allows. Median cut is there for when it is not.
 */

const MAX_COLOURS = 256;

/** Every distinct colour in the frames, as packed 0xRRGGBB. */
function census(frames) {
  const seen = new Map();
  for (const frame of frames) {
    const { data } = frame;
    for (let i = 0; i < data.length; i += 4) {
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  return seen;
}

/** Split the box with the widest channel until there are enough boxes. */
function medianCut(colours, want) {
  let boxes = [[...colours.keys()]];
  while (boxes.length < want) {
    let widest = -1;
    let pick = -1;
    let channel = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        const shift = 16 - c * 8;
        let lo = 255;
        let hi = 0;
        for (const v of box) {
          const x = (v >> shift) & 255;
          if (x < lo) lo = x;
          if (x > hi) hi = x;
        }
        if (hi - lo > widest) {
          widest = hi - lo;
          pick = i;
          channel = c;
        }
      }
    });
    if (pick < 0) break;
    const shift = 16 - channel * 8;
    const box = boxes[pick].slice().sort((a, b) => ((a >> shift) & 255) - ((b >> shift) & 255));
    const half = box.length >> 1;
    boxes.splice(pick, 1, box.slice(0, half), box.slice(half));
  }
  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const v of box) {
      r += (v >> 16) & 255;
      g += (v >> 8) & 255;
      b += v & 255;
    }
    const n = box.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

function buildPalette(frames) {
  const seen = census(frames);
  if (seen.size <= MAX_COLOURS) {
    const exact = [...seen.keys()].map((v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255]);
    return { palette: exact, exact: true };
  }
  return { palette: medianCut(seen, MAX_COLOURS), exact: false };
}

function indexer(palette, exact) {
  if (exact) {
    const lookup = new Map(palette.map(([r, g, b], i) => [(r << 16) | (g << 8) | b, i]));
    return (r, g, b) => lookup.get((r << 16) | (g << 8) | b) ?? 0;
  }
  const cache = new Map();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestD = Infinity;
    palette.forEach(([pr, pg, pb], i) => {
      const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    cache.set(key, best);
    return best;
  };
}

/** GIF's variable-width LZW, least significant bit first. */
function lzw(indices, minCodeSize) {
  const CLEAR = 1 << minCodeSize;
  const END = CLEAR + 1;
  const out = [];
  let codeSize = minCodeSize + 1;
  let dict = new Map();
  let next = END + 1;
  let bits = 0;
  let width = 0;

  const emit = (code) => {
    bits |= code << width;
    width += codeSize;
    while (width >= 8) {
      out.push(bits & 255);
      bits >>= 8;
      width -= 8;
    }
  };
  const reset = () => {
    dict = new Map();
    next = END + 1;
    codeSize = minCodeSize + 1;
  };

  emit(CLEAR);
  reset();
  if (!indices.length) {
    emit(END);
    if (width) out.push(bits & 255);
    return out;
  }

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    if (dict.has(key)) {
      prefix = dict.get(key);
      continue;
    }
    emit(prefix);
    dict.set(key, next++);
    if (next > 1 << codeSize) {
      if (codeSize < 12) codeSize++;
      else {
        emit(CLEAR);
        reset();
      }
    }
    prefix = k;
  }
  emit(prefix);
  emit(END);
  if (width) out.push(bits & 255);
  return out;
}

/** Image data is written in sub-blocks of at most 255 bytes. */
function subBlocks(bytes, push) {
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    push(chunk.length);
    for (const b of chunk) push(b);
  }
  push(0);
}

/**
 * @param frames  ImageData-alike: `{ data }` in RGBA, all the same size.
 * @param delay   centiseconds between frames, the unit GIF uses.
 */
export function encodeGIF(frames, { width, height, delay = 70, loop = 0 } = {}) {
  if (!frames.length) throw new Error("a GIF needs at least one frame");
  const { palette, exact } = buildPalette(frames);
  const toIndex = indexer(palette, exact);

  // The colour table is a power of two, at least two entries wide.
  let bits = 1;
  while (1 << bits < palette.length) bits++;
  const tableSize = 1 << bits;

  const out = [];
  const push = (b) => out.push(b & 255);
  const short = (v) => {
    push(v);
    push(v >> 8);
  };
  const ascii = (text) => {
    for (const ch of text) push(ch.charCodeAt(0));
  };

  ascii("GIF89a");
  short(width);
  short(height);
  push(0x80 | ((bits - 1) << 4) | (bits - 1)); // global table, its depth and size
  push(0); // background index
  push(0); // pixel aspect ratio

  for (let i = 0; i < tableSize; i++) {
    const [r, g, b] = palette[i] ?? [0, 0, 0];
    push(r);
    push(g);
    push(b);
  }

  // Netscape 2.0: the only way to say "loop" in a GIF.
  push(0x21);
  push(0xff);
  push(11);
  ascii("NETSCAPE2.0");
  push(3);
  push(1);
  short(loop);
  push(0);

  const minCodeSize = Math.max(2, bits);
  for (const frame of frames) {
    push(0x21); // graphic control extension
    push(0xf9);
    push(4);
    push(1 << 2); // do not dispose, no transparency
    short(delay);
    push(0); // transparent index, unused
    push(0);

    push(0x2c); // image descriptor
    short(0);
    short(0);
    short(width);
    short(height);
    push(0); // no local table, not interlaced

    const { data } = frame;
    const indices = new Uint8Array(width * height);
    for (let p = 0, i = 0; i < data.length; i += 4, p++) {
      indices[p] = toIndex(data[i], data[i + 1], data[i + 2]);
    }
    push(minCodeSize);
    subBlocks(lzw(indices, minCodeSize), push);
  }

  push(0x3b); // trailer
  return new Uint8Array(out);
}
