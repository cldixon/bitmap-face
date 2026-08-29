/**
 * Images, drawn from the bitmaps rather than rasterised from the page, so they
 * stay crisp at any scale and need no font or style inlining.
 *
 * Every view exports its own shape, and every export carries the configuration
 * that produced it — a sheet of faces with no note of how they were asked for
 * is evidence of nothing.
 */
import { compose, gridToBitmap, hexToBitmap } from "./bitmap.js";

const SCALE = 8;
const PAD = 48;
const GAP_X = 34;
const GAP_Y = 24;
const TEXT = 18;
const HEAD = 46;
const ROWHEAD = 140;

function palette() {
  const css = getComputedStyle(document.body);
  const read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: css.backgroundColor,
    fg: css.color,
    muted: read("--fg2", css.color),
    amber: read("--amber", css.color),
    red: read("--red", css.color),
  };
}

const LEGEND_W = 420;
const LEGEND_GAP = 60;
const LINE = 22;

/** Canvas has no wrapping, and these are sentences. */
function wrap(ctx, text, width) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

//: `missing` maps to null deliberately -- it draws as an outline, matching the
//: on-screen key. `??` would swallow that, so the lookup is explicit.
function swatchFor(key, p) {
  const map = { agrees: p.fg, drawn: p.muted, malformed: p.red, differs: p.amber, missing: null };
  return key in map ? map[key] : p.muted;
}

/**
 * The key, drawn beside the figure.
 *
 * Returns the height it used so the caller can size the canvas for whichever of
 * the two is taller. Called twice: once against a throwaway context to measure,
 * once for real.
 */
function drawKey(ctx, legend, x, y, p, { measure = false } = {}) {
  const body = LEGEND_W - 24;
  let cursor = y;
  const heading = (text) => {
    if (!measure) {
      ctx.fillStyle = p.muted;
      ctx.fillText(text.toUpperCase(), x, cursor);
    }
    cursor += LINE * 1.4;
  };
  const item = (name, meaning, swatch) => {
    if (!measure) {
      if (swatch !== undefined) {
        if (swatch === null) {
          ctx.strokeStyle = p.muted;
          ctx.strokeRect(x + 0.5, cursor + 4.5, 10, 10);
        } else {
          ctx.fillStyle = swatch;
          ctx.fillRect(x, cursor + 4, 11, 11);
        }
      }
      ctx.fillStyle = p.fg;
      ctx.fillText(name, x + (swatch === undefined ? 0 : 20), cursor);
    }
    cursor += LINE;
    for (const line of wrap(ctx, meaning, body)) {
      if (!measure) {
        ctx.fillStyle = p.muted;
        ctx.fillText(line, x, cursor);
      }
      cursor += LINE;
    }
    cursor += 8;
  };

  ctx.textAlign = "left";
  heading("Forms");
  for (const [name, meaning] of legend.forms) item(name, meaning);
  cursor += LINE * 0.5;
  heading("Outcomes");
  for (const o of legend.outcomes) item(o.name, o.meaning, swatchFor(o.key, p));
  return cursor - y;
}

function paint(ctx, bitmap, x, y, chassis, scale = SCALE) {
  const bits = chassis ? compose(bitmap) : bitmap;
  bits.forEach((row, by) =>
    row.forEach((bit, bx) => {
      if (bit) ctx.fillRect(x + bx * scale, y + by * scale, scale, scale);
    }),
  );
}

/**
 * The matrix: a grid of cells, each holding a small grid of its own.
 *
 * The quad is outlined and tight while the cells are spaced apart, because at
 * this density the only thing keeping the two levels apart is the gap between
 * them.
 */
//: Only these two outcomes tint a face. Everything else is drawn in the ink the
//: icons are meant to be.
const MARKED = { malformed: "red", differs: "amber" };

export function drawQuads({ rows, columns, cellFor, config, chassis, heading, legend, across = 2 }) {
  const w = (chassis ? 32 : config.width) * SCALE;
  const h = (chassis ? 32 : config.height) * SCALE;
  const INNER = 3;
  const PADQ = 5;
  const quadW = across * w + (across - 1) * INNER + PADQ * 2;
  const quadH = across * h + (across - 1) * INNER + PADQ * 2;
  const lead = heading ? TEXT * 2 : 0;

  const p = palette();
  const rule = document.createElement("canvas").getContext("2d");
  rule.font = `${TEXT}px ui-monospace, Menlo, Consolas, monospace`;
  const keyH = legend ? drawKey(rule, legend, 0, 0, p, { measure: true }) : 0;

  const canvas = document.createElement("canvas");
  canvas.width =
    PAD * 2 + ROWHEAD + columns.length * (quadW + GAP_X) + (legend ? LEGEND_GAP + LEGEND_W : 0);
  canvas.height =
    PAD * 2 + lead + Math.max(HEAD + rows.length * (quadH + GAP_Y), keyH);

  const marked = new Set((legend?.outcomes ?? []).map((o) => o.key));
  const ctx = canvas.getContext("2d");
  const { bg, fg, muted } = p;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${TEXT}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";

  if (heading) {
    ctx.textAlign = "left";
    ctx.fillStyle = fg;
    ctx.fillText(heading, PAD, PAD);
  }

  const top = PAD + lead;
  const colX = (i) => PAD + ROWHEAD + i * (quadW + GAP_X);

  ctx.textAlign = "center";
  columns.forEach((c, i) => {
    ctx.fillStyle = muted;
    ctx.fillText(c.label, colX(i) + quadW / 2, top);
  });

  rows.forEach((row, r) => {
    const y = top + HEAD + r * (quadH + GAP_Y);
    ctx.textAlign = "right";
    ctx.fillStyle = muted;
    ctx.fillText(row.label, PAD + ROWHEAD - 22, y + quadH / 2 - TEXT / 2);

    columns.forEach((column, i) => {
      const x = colX(i);
      ctx.strokeStyle = muted;
      ctx.globalAlpha = 0.35;
      ctx.strokeRect(x + 0.5, y + 0.5, quadW - 1, quadH - 1);
      ctx.globalAlpha = 1;
      //: A face is tinted only if its outcome is one the key still explains, so
      //: switching a mark off removes it from the image and from the key at once.
      cellFor(row, column).forEach((cell, k) => {
        const bitmap = cell?.bitmap ?? cell;
        if (!bitmap) return;
        const key = cell?.outcome;
        ctx.fillStyle = MARKED[key] && marked.has(key) ? p[MARKED[key]] : fg;
        paint(
          ctx,
          bitmap,
          x + PADQ + (k % across) * (w + INNER),
          y + PADQ + Math.floor(k / across) * (h + INNER),
          chassis,
        );
      });
    });
  });

  if (legend) {
    ctx.font = `${TEXT}px ui-monospace, Menlo, Consolas, monospace`;
    drawKey(ctx, legend, PAD + ROWHEAD + columns.length * (quadW + GAP_X) + LEGEND_GAP, top, p);
  }

  return canvas;
}


/**
 * Labelled tiles, laid out in a grid.
 *
 * What the page does when a single model leaves one column of cells: the rows
 * wrap into blocks rather than running down the page. The export has to wrap the
 * same way, or a figure the page arranged three across comes out twelve deep.
 */
export function drawTiles({ tiles, config, chassis, across, quadAcross, legend }) {
  const w = (chassis ? 32 : config.width) * SCALE;
  const h = (chassis ? 32 : config.height) * SCALE;
  const INNER = 3;
  const PADQ = 5;
  const rowsIn = Math.ceil(quadAcross > 0 ? tiles[0].cells.length / quadAcross : 1);
  const quadW = quadAcross * w + (quadAcross - 1) * INNER + PADQ * 2;
  const quadH = rowsIn * h + (rowsIn - 1) * INNER + PADQ * 2;
  const cellH = TEXT + 8 + quadH;

  const p = palette();
  const rule = document.createElement("canvas").getContext("2d");
  rule.font = `${TEXT}px ui-monospace, Menlo, Consolas, monospace`;
  const keyH = legend ? drawKey(rule, legend, 0, 0, p, { measure: true }) : 0;

  const cols = Math.max(1, Math.min(across, tiles.length));
  const rows = Math.ceil(tiles.length / cols);

  const canvas = document.createElement("canvas");
  canvas.width = PAD * 2 + cols * (quadW + GAP_X) + (legend ? LEGEND_GAP + LEGEND_W : 0);
  canvas.height = PAD * 2 + Math.max(rows * (cellH + GAP_Y), keyH);

  const ctx = canvas.getContext("2d");
  const { bg, fg, muted } = p;
  const marked = new Set((legend?.outcomes ?? []).map((o) => o.key));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${TEXT}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  tiles.forEach((tile, i) => {
    const x = PAD + (i % cols) * (quadW + GAP_X);
    const y = PAD + Math.floor(i / cols) * (cellH + GAP_Y);
    ctx.fillStyle = muted;
    ctx.fillText(tile.label, x, y);

    const top = y + TEXT + 8;
    ctx.strokeStyle = muted;
    ctx.globalAlpha = 0.35;
    ctx.strokeRect(x + 0.5, top + 0.5, quadW - 1, quadH - 1);
    ctx.globalAlpha = 1;

    tile.cells.forEach((cell, k) => {
      const bitmap = cell?.bitmap ?? cell;
      if (!bitmap) return;
      const key = cell?.outcome;
      ctx.fillStyle = MARKED[key] && marked.has(key) ? p[MARKED[key]] : fg;
      paint(
        ctx,
        bitmap,
        x + PADQ + (k % quadAcross) * (w + INNER),
        top + PADQ + Math.floor(k / quadAcross) * (h + INNER),
        chassis,
      );
    });
  });

  if (legend) {
    ctx.font = `${TEXT}px ui-monospace, Menlo, Consolas, monospace`;
    drawKey(ctx, legend, PAD + cols * (quadW + GAP_X) + LEGEND_GAP, PAD, p);
  }
  return canvas;
}

/**
 * The plate: one face per expression, four across.
 *
 * This is the figure that goes beside the note, so it is laid out for
 * reproduction rather than for scanning — larger cells and generous gutters.
 * Nothing is annotated onto the image; the note around it does that.
 */
export function drawPlate({ cells, config, chassis, across = 3 }) {
  const BIG = SCALE * 1.5;
  const w = (chassis ? 32 : config.width) * BIG;
  const h = (chassis ? 32 : config.height) * BIG;
  const drawn = cells.filter((c) => c.bitmap);
  const cols = Math.min(across, Math.max(1, drawn.length));
  const rows = Math.ceil(drawn.length / cols);
  const cellH = h + TEXT + 14;

  const canvas = document.createElement("canvas");
  canvas.width = PAD * 2 + cols * w + (cols - 1) * GAP_X * 1.5;
  canvas.height = PAD * 2 + rows * cellH + (rows - 1) * GAP_Y;

  const ctx = canvas.getContext("2d");
  const { bg, fg, muted } = palette();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${TEXT}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";
  ctx.textAlign = "center";

  drawn.forEach(({ label, bitmap }, i) => {
    const x = PAD + (i % cols) * (w + GAP_X * 1.5);
    const y = PAD + Math.floor(i / cols) * (cellH + GAP_Y);
    ctx.fillStyle = fg;
    paint(ctx, bitmap, x, y, chassis, BIG);
    ctx.fillStyle = muted;
    ctx.fillText(label, x + w / 2, y + h + 10);
  });

  return canvas;
}

/** Hand raw bytes over as a file, for formats a canvas cannot produce itself. */
export function downloadBytes(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function download(canvas, name, format) {
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    },
    format === "jpeg" ? "image/jpeg" : "image/png",
    format === "jpeg" ? 0.95 : undefined,
  );
}

export { gridToBitmap, hexToBitmap };
