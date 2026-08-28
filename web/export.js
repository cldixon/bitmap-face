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
  const map = { agrees: p.fg, drawn: p.muted, malformed: p.amber, differs: p.red, missing: null };
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
 * A grid of faces with row and column headings.
 *
 * `rows` and `columns` come straight from the view, so the exported image has
 * the same shape as the screen — including `both` occupying two columns.
 */
export function drawGrid({ rows, columns, cellFor, config, chassis, legend, heading }) {
  const side = chassis ? 32 : null;
  const w = (side ?? config.width) * SCALE;
  const h = (side ?? config.height) * SCALE;
  const p = palette();

  // Measure the key first: the canvas has to be tall enough for whichever of the
  // figure and the key runs longer, and resizing a canvas clears it.
  const rule = document.createElement("canvas").getContext("2d");
  rule.font = `${TEXT}px ui-monospace, Menlo, Consolas, monospace`;
  const keyH = legend ? drawKey(rule, legend, 0, 0, p, { measure: true }) : 0;
  const lead = heading ? TEXT * 2 : 0;

  const canvas = document.createElement("canvas");
  canvas.width = PAD * 2 + ROWHEAD + columns.length * (w + GAP_X) + (legend ? LEGEND_GAP + LEGEND_W : 0);
  canvas.height =
    PAD * 2 + lead + Math.max(HEAD + rows.length * (h + GAP_Y) - GAP_Y, keyH);

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
  const colX = (i) => PAD + ROWHEAD + i * (w + GAP_X);

  ctx.textAlign = "center";
  columns.forEach((c, i) => {
    ctx.fillStyle = muted;
    ctx.fillText(c.label ?? c.target, colX(i) + w / 2, top);
    if (c.split) ctx.fillText(c.form, colX(i) + w / 2, top + TEXT + 4);
  });

  rows.forEach((row, r) => {
    const y = top + HEAD + r * (h + GAP_Y);
    ctx.textAlign = "right";
    ctx.fillStyle = muted;
    ctx.fillText(row.label, PAD + ROWHEAD - 22, y + h / 2 - TEXT / 2);
    columns.forEach((c, i) => {
      const bitmap = cellFor(row, c);
      if (!bitmap) return;
      ctx.fillStyle = fg;
      paint(ctx, bitmap, colX(i), y, chassis);
    });
  });

  if (legend) {
    ctx.font = `${TEXT}px ui-monospace, Menlo, Consolas, monospace`;
    drawKey(ctx, legend, PAD + ROWHEAD + columns.length * (w + GAP_X) + LEGEND_GAP, top, p);
  }

  return canvas;
}

/** One try, large, with its written forms beside it. */
export function drawInspect({ panels, config, chassis }) {
  const BIG = SCALE * 2;
  const side = chassis ? 32 : null;
  const w = (side ?? config.width) * BIG;
  const h = (side ?? config.height) * BIG;

  const canvas = document.createElement("canvas");
  canvas.width = PAD * 2 + Math.max(760, panels.length * (w * 2 + GAP_X * 2));
  canvas.height = PAD * 2 + HEAD + h + TEXT * (config.height + 3);

  const ctx = canvas.getContext("2d");
  const { bg, fg, muted } = palette();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${TEXT}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  let x = PAD;
  for (const panel of panels) {
    ctx.fillStyle = muted;
    ctx.fillText(`${panel.target}  ${panel.outcome}`, x, PAD);
    panel.forms.forEach((form, i) => {
      const fx = x + i * (w + GAP_X);
      ctx.fillStyle = fg;
      const scaled = form.bitmap.map((row) => row);
      const bits = chassis ? compose(scaled) : scaled;
      bits.forEach((row, by) =>
        row.forEach((bit, bx) => {
          if (bit) ctx.fillRect(fx + bx * BIG, PAD + HEAD + by * BIG, BIG, BIG);
        }),
      );
      ctx.fillStyle = muted;
      ctx.fillText(form.label, fx, PAD + HEAD + h + 8);
    });
    (panel.hex ?? []).forEach((line, i) => {
      ctx.fillStyle = panel.bad?.has(i) ? "#c0392b" : muted;
      ctx.fillText(line, x, PAD + HEAD + h + TEXT * (i + 3));
    });
    x += panel.forms.length * (w + GAP_X) + GAP_X;
  }

  return canvas;
}


/**
 * Blocks: one labelled group per expression, laid out across the page.
 *
 * Mirrors the form comparison view, where a block is an expression and each
 * group inside it is a written form -- `combined` holding two faces from a
 * single attempt, so they sit together under one caption.
 */
export function drawBlocks({ blocks, config, chassis, across = 2 }) {
  const w = (chassis ? 32 : config.width) * SCALE;
  const h = (chassis ? 32 : config.height) * SCALE;
  const INNER = 6;
  const BETWEEN = 30;

  const groupW = (g) => g.bitmaps.length * w + (g.bitmaps.length - 1) * INNER;
  const blockW = (b) =>
    b.groups.reduce((n, g) => n + groupW(g), 0) + (b.groups.length - 1) * BETWEEN;
  const cellW = Math.max(...blocks.map(blockW));
  const cellH = TEXT + 10 + h + TEXT + 10;

  const cols = Math.min(across, blocks.length);
  const rows = Math.ceil(blocks.length / cols);

  const canvas = document.createElement("canvas");
  canvas.width = PAD * 2 + cols * cellW + (cols - 1) * GAP_X * 2;
  canvas.height = PAD * 2 + rows * cellH + (rows - 1) * GAP_Y;

  const ctx = canvas.getContext("2d");
  const { bg, fg, muted } = palette();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${TEXT}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";

  blocks.forEach((block, i) => {
    const x = PAD + (i % cols) * (cellW + GAP_X * 2);
    const y = PAD + Math.floor(i / cols) * (cellH + GAP_Y);

    ctx.textAlign = "left";
    ctx.fillStyle = fg;
    ctx.fillText(block.label, x, y);

    let gx = x;
    for (const group of block.groups) {
      group.bitmaps.forEach((bitmap, k) => {
        if (!bitmap) return;
        ctx.fillStyle = fg;
        paint(ctx, bitmap, gx + k * (w + INNER), y + TEXT + 10, chassis);
      });
      ctx.textAlign = "center";
      ctx.fillStyle = muted;
      ctx.fillText(group.label, gx + groupW(group) / 2, y + TEXT + 10 + h + 8);
      gx += groupW(group) + BETWEEN;
    }
  });

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
