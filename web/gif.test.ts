/**
 * The GIF encoder, checked against the format rather than against itself.
 *
 * A malformed GIF still downloads and still has a plausible size, so the only
 * useful assertions are structural: the signature, the loop block, one control
 * extension per frame, and a trailer.
 */
import { expect, test } from "bun:test";
import { encodeGIF } from "./gif.js";

const frame = (w: number, h: number, fill: (i: number) => [number, number, number]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = fill(i);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { data };
};

const twoColour = (w: number, h: number, flip = false) =>
  frame(w, h, (i) => ((i % 3 === 0) !== flip ? [0, 0, 0] : [255, 255, 255]));

const count = (bytes: Uint8Array, ...pattern: number[]) => {
  let n = 0;
  for (let i = 0; i <= bytes.length - pattern.length; i++) {
    if (pattern.every((b, k) => bytes[i + k] === b)) n++;
  }
  return n;
};

test("it writes a GIF89a with a trailer", () => {
  const bytes = encodeGIF([twoColour(8, 8)], { width: 8, height: 8 });
  expect(String.fromCharCode(...bytes.slice(0, 6))).toBe("GIF89a");
  expect(bytes.at(-1)).toBe(0x3b);
  // Logical screen descriptor carries the dimensions, little endian.
  expect(bytes[6] | (bytes[7] << 8)).toBe(8);
  expect(bytes[8] | (bytes[9] << 8)).toBe(8);
});

test("it loops, via the only extension that can say so", () => {
  const bytes = encodeGIF([twoColour(4, 4)], { width: 4, height: 4 });
  const text = String.fromCharCode(...bytes);
  expect(text).toContain("NETSCAPE2.0");
});

test("one graphic control extension per frame, carrying the delay", () => {
  const frames = [twoColour(4, 4), twoColour(4, 4, true), twoColour(4, 4)];
  const bytes = encodeGIF(frames, { width: 4, height: 4, delay: 70 });
  // 0x21 0xF9 0x04 introduces a graphic control extension.
  expect(count(bytes, 0x21, 0xf9, 0x04)).toBe(3);
  // Delay sits two bytes in, little endian.
  const at = bytes.findIndex((_, i) => bytes[i] === 0x21 && bytes[i + 1] === 0xf9);
  expect(bytes[at + 4] | (bytes[at + 5] << 8)).toBe(70);
});

test("an exact palette is used when the frames are simple enough", () => {
  const bytes = encodeGIF([twoColour(16, 16)], { width: 16, height: 16 });
  // Two colours need one bit, so the packed field's size nibble is 0.
  expect(bytes[10] & 0b111).toBe(0);
  expect(bytes[10] & 0x80).toBe(0x80); // a global colour table is present
});

test("more colours than a GIF allows are quantised, not dropped", () => {
  // 4096 distinct colours in one frame.
  const many = frame(64, 64, (i) => [(i * 5) % 256, (i * 13) % 256, (i * 29) % 256]);
  const bytes = encodeGIF([many], { width: 64, height: 64 });
  expect(String.fromCharCode(...bytes.slice(0, 6))).toBe("GIF89a");
  // Full 256-entry table: eight bits.
  expect(bytes[10] & 0b111).toBe(7);
  expect(bytes.at(-1)).toBe(0x3b);
});

test("frames compress rather than being stored raw", () => {
  const flat = frame(200, 200, () => [0, 0, 0]);
  const bytes = encodeGIF([flat], { width: 200, height: 200 });
  // 40,000 identical pixels should not survive as 40,000 bytes.
  expect(bytes.length).toBeLessThan(5000);
});

test("it refuses to encode nothing", () => {
  expect(() => encodeGIF([], { width: 4, height: 4 })).toThrow();
});

// --------------------------------------------------------------------------- round trip
//
// Structure alone does not prove the compressor. This decodes what the encoder
// wrote and compares it pixel for pixel, which is the only assertion that can
// actually fail if the LZW is wrong.

function decodeFirstFrame(bytes: Uint8Array) {
  let p = 6;
  const width = bytes[p] | (bytes[p + 1] << 8);
  const height = bytes[p + 2] | (bytes[p + 3] << 8);
  const packed = bytes[p + 4];
  p += 7;
  const table: number[][] = [];
  const entries = 1 << ((packed & 0b111) + 1);
  for (let i = 0; i < entries; i++, p += 3) table.push([bytes[p], bytes[p + 1], bytes[p + 2]]);

  // Skip extensions until the first image descriptor.
  while (bytes[p] !== 0x2c) {
    if (bytes[p] === 0x21) {
      p += 2;
      while (bytes[p]) p += bytes[p] + 1;
      p++;
    } else p++;
  }
  p += 10; // descriptor: separator, x, y, w, h, packed

  const minCodeSize = bytes[p++];
  const data: number[] = [];
  while (bytes[p]) {
    const n = bytes[p++];
    for (let i = 0; i < n; i++) data.push(bytes[p++]);
  }

  const CLEAR = 1 << minCodeSize;
  const END = CLEAR + 1;
  let codeSize = minCodeSize + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < CLEAR; i++) dict[i] = [i];
    dict[CLEAR] = [];
    dict[END] = [];
    codeSize = minCodeSize + 1;
  };
  reset();

  const out: number[] = [];
  let bit = 0;
  let prev: number[] | null = null;
  const read = () => {
    let code = 0;
    for (let i = 0; i < codeSize; i++, bit++) {
      code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    }
    return code;
  };

  for (;;) {
    const code = read();
    if (code === END) break;
    if (code === CLEAR) {
      reset();
      prev = null;
      continue;
    }
    let entry: number[];
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error(`bad code ${code}`);
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
  }

  return { width, height, table, indices: out };
}

test("what comes out is what went in", () => {
  const W = 37; // deliberately not a multiple of anything
  const H = 21;
  const source = frame(W, H, (i) => {
    const x = i % W;
    const y = (i / W) | 0;
    return (x * y) % 7 === 0 ? [17, 17, 17] : [238, 238, 238];
  });
  const bytes = encodeGIF([source], { width: W, height: H });
  const got = decodeFirstFrame(bytes);

  expect(got.width).toBe(W);
  expect(got.height).toBe(H);
  expect(got.indices.length).toBe(W * H);

  for (let i = 0; i < W * H; i++) {
    const [r, g, b] = got.table[got.indices[i]];
    expect([r, g, b]).toEqual([source.data[i * 4], source.data[i * 4 + 1], source.data[i * 4 + 2]]);
  }
});

test("a long run round trips, which is where the code width grows", () => {
  const W = 90;
  const H = 90;
  const source = frame(W, H, (i) => {
    const band = ((i / W) | 0) % 5;
    return [band * 50, 255 - band * 40, (i % W) % 2 ? 10 : 200];
  });
  const bytes = encodeGIF([source], { width: W, height: H });
  const got = decodeFirstFrame(bytes);
  expect(got.indices.length).toBe(W * H);
  for (let i = 0; i < W * H; i += 7) {
    const [r, g, b] = got.table[got.indices[i]];
    expect([r, g, b]).toEqual([source.data[i * 4], source.data[i * 4 + 1], source.data[i * 4 + 2]]);
  }
});
