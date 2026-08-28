/**
 * bitface — the panel.
 *
 * One suite at a time, laid out the way the question is actually asked: an
 * expression per row, and across it every form the model was asked to produce
 * it in. Reading across a row shows whether "draw a face" and "write the hex
 * for a face" get you the same face; reading down a column shows where one way
 * of asking falls apart.
 *
 * It reports what happened rather than scoring it. Two of the four targets have
 * nothing to check against by construction, so a cell says which of the five
 * states it reached and shows the pixels; judging them is the point of looking.
 */
import { compose, gridToBitmap, hexToBitmap, svg } from "./bitmap.js";

const el = (id) => document.getElementById(id);
const suitesEl = el("suites");
const repeatEl = el("repeat");
const chassisEl = el("chassis");
const configEl = el("config");
const sheetEl = el("sheet");
const detailEl = el("detail");
const viewEl = el("view");
const expressionEl = el("expression");
const legendEl = el("legend");

const TARGET_BLURB = {
  grid_only: "draws a grid",
  transcribe: "encodes its own grid",
  hex_only: "writes hex directly",
  both: "both forms at once",
};

const OUTCOME_LABEL = {
  missing: "never came back",
  malformed: "broke the format",
  drawn: "one form only",
  differs: "forms disagree",
  agrees: "forms agree",
};

let suite = null;
let repeat = "1";
let view = "suite";
let expression = null;
let catalogue = [];
//: Compare mode needs every suite at once. They are small and local, so they are
//: fetched once and kept rather than re-requested on each toggle.
const loaded = new Map();

// --------------------------------------------------------------------------- pixels

/**
 * The bitmap a cell should show, and which rows to band.
 *
 * Each target produces a different artefact, so "the face" means something
 * different in each column. grid_only has only a grid; hex_only has only hex;
 * transcribe's answer is the hex it wrote for a grid it was given; `both`
 * returns two forms that may not agree, and there the grid is shown, with the
 * rows its own hex contradicts banded.
 */
function pixels(entry, target, config) {
  const { width: w, height: h } = config;
  if (!entry) return null;
  const bands = entry.differing_rows ?? [];
  if (target === "hex_only" || target === "transcribe") {
    return entry.hex ? { bitmap: hexToBitmap(entry.hex, w, h), bands } : null;
  }
  if (entry.grid) return { bitmap: gridToBitmap(entry.grid, w, h), bands };
  if (entry.hex) return { bitmap: hexToBitmap(entry.hex, w, h), bands };
  return null;
}

const shown = (byTarget, target) => {
  const entries = byTarget?.[target] ?? [];
  return repeat === "all" ? entries : entries.filter((e) => String(e.repeat) === repeat);
};

// --------------------------------------------------------------------------- render

function face(entry, target, scale, from = suite) {
  const art = pixels(entry, target, from.config);
  if (!art) return `<span class="void" title="${OUTCOME_LABEL[entry?.outcome] ?? "nothing"}">—</span>`;
  const bits = chassisEl.checked ? compose(art.bitmap) : art.bitmap;
  const bands = chassisEl.checked ? art.bands.map((y) => y + 5) : art.bands;
  return svg(bits, { scale: chassisEl.checked ? Math.max(2, scale / 2) : scale, bands });
}

function cell(name, target, from = suite) {
  const entries = shown(from.cells[name], target);
  if (!entries.length) return `<td class="cell"><span class="void">—</span></td>`;
  const scale = entries.length > 1 ? 4 : 6;
  const art = entries
    .map(
      (entry) => `<button class="face" data-name="${esc(name)}" data-target="${target}"
         data-suite="${esc(from.id)}" data-repeat="${entry.repeat}" data-outcome="${entry.outcome}"
         title="r${entry.repeat} · ${OUTCOME_LABEL[entry.outcome]}">${face(entry, target, scale, from)}</button>`,
    )
    .join("");
  return `<td class="cell">${art}</td>`;
}

/**
 * The five states, named. Without this the colours are a private code, and two
 * of the states ("one form only", "never came back") look like failures when
 * one of them is simply the answer to a question we did not ask.
 */
function renderLegend() {
  legendEl.innerHTML = Object.entries(OUTCOME_LABEL)
    .map(([state, label]) => `<li data-outcome="${state}"><span class="swatch"></span>${label}</li>`)
    .join("");
}

/** One expression, every suite: the same face asked for by three models. */
function renderCompare() {
  const suites = catalogue.map((s) => loaded.get(s.id)).filter(Boolean);
  const targets = [...new Set(suites.flatMap((s) => s.targets))];
  configEl.textContent = `${expression}  ·  ${suites.length} suites  ·  repeat ${repeat}`;

  const head = targets
    .map((t) => `<th><span class="target">${t}</span><span class="blurb">${TARGET_BLURB[t] ?? ""}</span></th>`)
    .join("");
  const rows = suites
    .map((s) => {
      const label = [s.config.model.replace("claude-", ""), s.config.effort].filter(Boolean).join(" · ");
      const has = s.cells[expression];
      return (
        `<tr><th class="rowhead"><span>${esc(label)}</span><span class="tier">${s.config.references || "no"} refs</span></th>` +
        targets.map((t) => (has ? cell(expression, t, s) : `<td class="cell"><span class="void">—</span></td>`)).join("") +
        `</tr>`
      );
    })
    .join("");
  sheetEl.innerHTML = `<table><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  wireFaces();
}

function wireFaces() {
  for (const button of sheetEl.querySelectorAll(".face")) {
    button.onclick = () =>
      showDetail(button.dataset.name, button.dataset.target, button.dataset.repeat, button.dataset.suite);
  }
}

function render() {
  if (!suite) return;
  renderLegend();
  if (view === "compare") return renderCompare();
  const c = suite.config;
  const refs = c.references
    ? `${c.references} ${c.reference_set ?? "faces"} reference${c.references === 1 ? "" : "s"}`
    : "no references";
  configEl.textContent = [
    c.model,
    c.effort ?? "no effort setting",
    refs,
    c.no_copy ? "told not to copy" : "no copy directive",
    `${c.width}×${c.height}`,
    `${suite.repeats} repeat${suite.repeats === 1 ? "" : "s"}`,
  ].join("  ·  ");

  const head = suite.targets
    .map((t) => `<th><span class="target">${t}</span><span class="blurb">${TARGET_BLURB[t] ?? ""}</span></th>`)
    .join("");
  const rows = suite.expressions
    .map(
      (name) =>
        `<tr><th class="rowhead"><span>${esc(name)}</span><span class="tier">${esc(suite.tiers[name] ?? "")}</span></th>` +
        suite.targets.map((t) => cell(name, t)).join("") +
        `</tr>`,
    )
    .join("");
  sheetEl.innerHTML = `<table><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  wireFaces();
}

// --------------------------------------------------------------------------- detail

function showDetail(name, target, rep, suiteId) {
  const from = (suiteId && loaded.get(suiteId)) || suite;
  const entry = (from.cells[name]?.[target] ?? []).find((e) => String(e.repeat) === String(rep));
  if (!entry) return;
  const run = from.runs.find((r) => r.target === target && String(r.repeat) === String(rep));
  const { width: w, height: h } = from.config;

  // Where two forms exist, show both renderings rather than picking one. A
  // disagreement is the finding, and it is only legible as two faces.
  const panes = [];
  if (entry.given_grid) panes.push(["given grid", gridToBitmap(entry.given_grid, w, h)]);
  if (entry.grid) panes.push(["its grid", gridToBitmap(entry.grid, w, h)]);
  if (entry.hex) panes.push(["its hex, decoded", hexToBitmap(entry.hex, w, h)]);
  if (entry.expected_hex && !entry.grid)
    panes.push(["the correct hex, decoded", hexToBitmap(entry.expected_hex, w, h)]);

  const art = panes
    .map(
      ([label, bitmap]) =>
        `<figure>${svg(bitmap, { scale: 7, bands: entry.differing_rows })}<figcaption>${label}</figcaption></figure>`,
    )
    .join("");

  const text = [
    entry.grid && ["grid", entry.grid.join("\n")],
    entry.hex && ["hex", entry.hex.join("\n")],
    entry.hex_from_grid && ["hex read off its grid", entry.hex_from_grid.join("\n")],
    entry.expected_hex && ["hex it should have written", entry.expected_hex.join("\n")],
  ]
    .filter(Boolean)
    .map(([label, body]) => `<section><h4>${label}</h4><pre>${esc(body)}</pre></section>`)
    .join("");

  const faults = entry.faults.length
    ? `<section><h4>faults</h4><ul>${entry.faults.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></section>`
    : "";
  const copied = entry.copied
    ? `<p class="warn">reproduces the reference “${esc(entry.copied)}”</p>`
    : "";

  detailEl.hidden = false;
  detailEl.innerHTML = `
    <button class="close" type="button" aria-label="Close">×</button>
    <h3>${esc(name)} <span class="dim">${target} · repeat ${rep} · ${esc(from.config.model.replace("claude-", ""))}</span></h3>
    <p class="outcome" data-outcome="${entry.outcome}">${OUTCOME_LABEL[entry.outcome]}</p>
    ${copied}
    <div class="panes">${art}</div>
    ${faults}${text}
    ${run ? `<details><summary>prompt sent</summary><pre>${esc(run.system ?? "")}\n\n---\n\n${esc(run.user ?? "")}</pre></details>` : ""}`;
  detailEl.querySelector(".close").onclick = () => {
    detailEl.hidden = true;
  };
  detailEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// --------------------------------------------------------------------------- boot

async function fetchSuite(id) {
  if (!loaded.has(id)) {
    loaded.set(id, await fetch(`/api/suites/${encodeURIComponent(id)}`).then((r) => r.json()));
  }
  return loaded.get(id);
}

async function load(id) {
  suite = await fetchSuite(id);
  detailEl.hidden = true;
  expression ??= suite.expressions[0];
  fillRepeats();
  fillExpressions();
  render();
}

/** Repeats available depends on the view: compare spans suites, so take the smallest. */
function fillRepeats() {
  const n =
    view === "compare"
      ? Math.min(...[...loaded.values()].map((s) => s.repeats))
      : suite.repeats;
  const keep = repeat;
  repeatEl.innerHTML =
    Array.from({ length: n }, (_, i) => `<option value="${i + 1}">repeat ${i + 1}</option>`).join("") +
    (n > 1 && view === "suite" ? `<option value="all">all ${n}</option>` : "");
  repeat = [...repeatEl.options].some((o) => o.value === keep) ? keep : "1";
  repeatEl.value = repeat;
}

function fillExpressions() {
  expressionEl.innerHTML = suite.expressions
    .map((n) => `<option value="${esc(n)}">${esc(n)}</option>`)
    .join("");
  expressionEl.value = expression;
}

async function setView(next) {
  view = next;
  const compare = view === "compare";
  expressionEl.hidden = !compare;
  suitesEl.hidden = compare;
  //: Compare only means something once every suite is in hand.
  if (compare) await Promise.all(catalogue.map((s) => fetchSuite(s.id)));
  fillRepeats();
  detailEl.hidden = true;
  render();
}

async function boot() {
  catalogue = await fetch("/api/suites").then((r) => r.json());
  if (!catalogue.length) {
    sheetEl.innerHTML = `<p class="empty">No runs in data/runs yet. Try <code>bitface suite</code>.</p>`;
    return;
  }
  suitesEl.innerHTML = catalogue
    .map((s) => {
      const bits = [s.model, s.effort, s.references ? `${s.references} ${s.reference_set ?? ""}`.trim() : "blind"];
      const tag = s.loose ? " (loose)" : "";
      return `<option value="${esc(s.id)}">${esc(bits.filter(Boolean).join(" · "))}${tag}</option>`;
    })
    .join("");
  suitesEl.onchange = () => load(suitesEl.value);
  repeatEl.onchange = () => {
    repeat = repeatEl.value;
    render();
  };
  expressionEl.onchange = () => {
    expression = expressionEl.value;
    render();
  };
  viewEl.onchange = () => setView(viewEl.value);
  chassisEl.onchange = render;
  await load(catalogue[0].id);
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

boot();

// --------------------------------------------------------------------------- export

/**
 * Draw the sheet to a canvas and hand it back as a file.
 *
 * Redrawn from the bitmaps rather than rasterised from the page: every pixel is
 * a filled rectangle at whatever scale is asked for, so the export is crisp at
 * any size instead of an upscaled screenshot of a 96px icon. It also sidesteps
 * having to inline fonts and styles into serialised SVG. The configuration is
 * printed along the bottom, because a sheet of faces with no note of how they
 * were asked for is not evidence of anything.
 */
const SCALE = 8;
const PAD = 56;
const GAP_X = 44;
const GAP_Y = 26;
const LABEL = 20;
const HEAD = 34;
const ROWHEAD = 130;

function styles() {
  const css = getComputedStyle(document.body);
  return { bg: css.backgroundColor, fg: css.color, muted: css.getPropertyValue("--fg2").trim() };
}

function drawSheet() {
  if (!suite) return null;
  const withChassis = chassisEl.checked;
  const w = (withChassis ? 32 : suite.config.width) * SCALE;
  const h = (withChassis ? 32 : suite.config.height) * SCALE;
  //: Export what is on screen. In compare mode the rows are suites, not
  //: expressions, so the row label and the source of each cell both change.
  const compare = view === "compare";
  const sources = compare ? catalogue.map((x) => loaded.get(x.id)).filter(Boolean) : [suite];
  const targets = compare ? [...new Set(sources.flatMap((x) => x.targets))] : suite.targets;
  const rows = compare
    ? sources.map((x) => ({
        label: [x.config.model.replace("claude-", ""), x.config.effort].filter(Boolean).join(" · "),
        name: expression,
        from: x,
      }))
    : suite.expressions.map((n) => ({ label: n, name: n, from: suite }));

  const canvas = document.createElement("canvas");
  canvas.width = PAD * 2 + ROWHEAD + targets.length * w + (targets.length - 1) * GAP_X;
  canvas.height = PAD * 2 + HEAD + rows.length * (h + GAP_Y) + LABEL * 2;

  const ctx = canvas.getContext("2d");
  const { bg, fg, muted } = styles();
  // JPEG has no transparency, so both formats get the page's own background
  // rather than one of them silently coming out black.
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${LABEL}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";

  const colX = (i) => PAD + ROWHEAD + i * (w + GAP_X);

  ctx.textAlign = "center";
  ctx.fillStyle = muted || fg;
  targets.forEach((t, i) => ctx.fillText(t, colX(i) + w / 2, PAD));

  rows.forEach(({ label, name, from }, r) => {
    const y = PAD + HEAD + r * (h + GAP_Y);
    ctx.textAlign = "right";
    ctx.fillStyle = muted || fg;
    ctx.fillText(label, PAD + ROWHEAD - 24, y + h / 2 - LABEL / 2);

    targets.forEach((target, i) => {
      const entry = shown(from.cells[name], target)[0];
      const art = pixels(entry, target, from.config);
      if (!art) return;
      const bits = withChassis ? compose(art.bitmap) : art.bitmap;
      ctx.fillStyle = fg;
      bits.forEach((row, by) =>
        row.forEach((bit, bx) => {
          if (bit) ctx.fillRect(colX(i) + bx * SCALE, y + by * SCALE, SCALE, SCALE);
        }),
      );
    });
  });

  ctx.textAlign = "left";
  ctx.fillStyle = muted || fg;
  ctx.fillText(configEl.textContent, PAD, canvas.height - PAD + 4);
  return canvas;
}

el("save").onclick = () => {
  const canvas = drawSheet();
  if (!canvas) return;
  const format = el("format").value;
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${view === "compare" ? `compare-${expression}` : suite.id}-r${repeat}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    },
    format === "jpeg" ? "image/jpeg" : "image/png",
    format === "jpeg" ? 0.95 : undefined,
  );
};
