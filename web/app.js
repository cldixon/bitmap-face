/**
 * bitface — the panel.
 *
 * Six destinations over one cell renderer, so a face means the same thing
 * everywhere and any row or column is a fair comparison.
 *
 * `both` takes two columns, not one: that target returns a grid *and* hex which
 * can disagree, and collapsing them hides the only thing it has to say.
 */
import { compose, draw, gridToBitmap, hexFromBitmap, hexToBitmap, svg } from "./bitmap.js";
import { download, downloadBytes, drawPlate, drawQuads, drawTiles } from "./export.js";
import { encodeGIF } from "./gif.js";
import { FORM_BRIEF, FORM_FILTERS, FORMS, METHOD, OUTCOMES, OVERVIEW, PAGES, QUAD, RANK, TARGETS } from "./copy.js";

const el = (id) => document.getElementById(id);
const [navEl, barEl, displayEl, suitesEl, expressionEl, targetsEl, replicateEl, chassisEl] =
  ["nav", "bar", "display", "suites", "expression", "targets", "replicate", "chassis"].map(el);
const [titleEl, introEl, detailsEl, stageEl] = ["title", "intro", "details", "stage"].map(el);

/** Which toolbar fields each destination uses. */
const CONTROLS = {
  overview: [],
  matrix: [], // every control lives in the key, beside what it explains
  index: [], // its controls sit with the attempt, on the bench
  plate: ["suites", "targets"],
  method: [],
};

/** Which of them belong in the address. Inspect filters in-page but is still linkable. */
const PARAMS = {
  overview: [],
  matrix: ["model", "expr", "form", "replicate"],
  index: ["suite", "expr", "form", "replicate"],
  plate: ["suite", "target"],
  method: [],
};

const state = {
  view: "overview",
  expression: null,
  target: "all",
  replicate: "all",
  frame: 0,
  chassis: true,
  format: "png",
  marks: { malformed: true, differs: true },
  form: null,
  //: Matrix starts unfiltered and narrows from there; "all" is a real value.
  //: `expression` is a list because comparing three of the twelve is as
  //: reasonable as comparing one or all. Empty means no filter.
  narrow: { model: "all", expression: [], form: "all" },
  filters: { model: "all", expression: "all", form: "all" },
};
let suite = null;
let catalogue = [];
const loaded = new Map();
let timer = null;

const DATA_VIEWS = ["matrix", "index", "plate"];
//: Pages that show a single written form, so "all forms" is not on offer.
const ONE_FORM = ["expressions", "plate"];

const label = (o) => OUTCOMES[o]?.[0] ?? o;
const formName = (t) => FORMS[t] ?? t;
const SAVE_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" ' +
  'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M8 1.5v8m0 0L5 6.5m3 3 3-3M2.5 11v2.5h11V11"/></svg>';

/** The request behind this face: its prompt, and the run it belonged to. */
function requestFor(target, rep, expression) {
  const run = suite.runs.find((r) => r.target === target && String(r.replicate) === String(rep));
  if (!run) return null;
  const call =
    (run.calls ?? []).find((c) => (c.expressions ?? []).includes(expression)) ?? run.calls?.[0];
  return call ? { prompt: call.prompt, system: run.system } : null;
}

/** Which controls a view offers. Everything that asks goes through here. */
//: The outcomes a reader can choose not to have marked.
const MARKABLE = new Set(["malformed", "differs"]);

//: Outcomes worth naming on a panel; the rest are the normal case.
const NOTABLE = new Set([...MARKABLE, "missing"]);

/**
 * The four things a model actually returned, each named by the option that
 * isolates it. `combined` is one attempt but two faces, and in a list of every
 * output they are two entries.
 */
const LEAVES = QUAD.map((q) => ({ ...q, key: q.target === "both" ? `both:${q.form}` : q.target }));
const leafName = (key) => Object.fromEntries(FORM_FILTERS)[key] ?? key;

//: Views that carry the chassis switch themselves, in their key or their bench.
const OWN_CHASSIS = ["matrix", "index"];

/**
 * Saving the picture, wherever that page keeps its controls.
 *
 * Trailing the figure put it below a full grid, out of sight exactly when there
 * was most to save. It goes with the controls instead -- in the key, on the
 * bench -- both of which stay put.
 *
 * GIF is offered only where something actually moves. The index shows every
 * replicate at once rather than cycling them, so a GIF there would be one frame.
 */
function exportControlHTML() {
  //: The control is rebuilt on every render, so the choice lives in state. Read
  //: back off the element it would reset to the first option each time -- pick
  //: JPEG, change a filter, and it is quietly PNG again.
  const formats = animated() ? [["gif", "GIF"]] : [["png", "PNG"], ["jpeg", "JPEG"]];
  const chosen = exportFormat();
  return `<div class="save">
      <select id="x-format" aria-label="Format">${formats
        .map(([v, t]) => option(v, t, chosen))
        .join("")}</select>
      <button id="x-save" type="button">export</button>
    </div>`;
}

/** Only the matrix cycles; everywhere else "all" lays them out side by side. */
const animated = () => state.view === "matrix" && state.replicate === "all";
const exportFormat = () => (animated() ? "gif" : state.format === "gif" ? "png" : state.format);

const controlsFor = (view) => CONTROLS[view];



/**
 * The cell positions a form filter keeps.
 *
 * "both:grid" is the grid half of the combined answer, on its own -- the last
 * step of drilling down, where a cell is a single icon.
 */
function quadFor(form) {
  if (form === "all") return QUAD;
  const [target, half] = String(form).split(":");
  return QUAD.filter((q) => q.target === target && (!half || q.form === half));
}

const short = (m) => m.replace("claude-", "");
const suiteName = (s) => [short(s.config?.model ?? s.model), s.config?.effort ?? s.effort].filter(Boolean).join(" ");

// --------------------------------------------------------------------------- shape

/** On-screen columns. `both` splits into the two forms it returned. */
function columnsFor(targets) {
  return targets.flatMap((t) =>
    t === "both"
      ? [
          { target: t, label: formName(t), form: "grid", split: "first" },
          { target: t, label: formName(t), form: "hex", split: "last" },
        ]
      : [{ target: t, label: formName(t), form: t === "hex_only" ? "hex" : "grid" }],
  );
}

function bitmapOf(entry, form, config) {
  if (!entry) return null;
  const { width: w, height: h } = config;
  if (form === "hex") return entry.hex ? hexToBitmap(entry.hex, w, h) : null;
  return entry.grid ? gridToBitmap(entry.grid, w, h) : null;
}

/** The replicate on show: the animation frame, or the selected one. */
function entryAt(from, name, target) {
  const all = from.cells[name]?.[target] ?? [];
  if (!all.length) return null;
  if (state.replicate === "all") return all[state.frame % all.length];
  return all.find((e) => String(e.replicate) === state.replicate) ?? null;
}

/** The attempt that best represents a cell, for the plate. */
function bestAt(from, name, target) {
  const all = from.cells[name]?.[target] ?? [];
  return [...all].sort((a, b) => RANK.indexOf(a.outcome) - RANK.indexOf(b.outcome))[0] ?? null;
}

// --------------------------------------------------------------------------- cells

function faceSVG(entry, form, from, scale) {
  const bitmap = bitmapOf(entry, form, from.config);
  if (!bitmap) return `<span class="void">—</span>`;
  const bits = state.chassis ? compose(bitmap) : bitmap;
  const rows = entry.differing_rows ?? [];
  return svg(bits, {
    scale: state.chassis ? Math.max(2, Math.round(scale / 2)) : scale,
    bands: state.chassis ? rows.map((y) => y + 5) : rows,
  });
}

function faceButton(entry, column, from, name, scale) {
  if (!entry) return `<span class="void">—</span>`;
  //: The leaf is the exact output this face stands for, so the index opens on
  //: it rather than on whichever half of a combined answer comes first.
  const leaf = column.target === "both" ? `both:${column.form}` : column.target;
  return `<button class="face" data-outcome="${entry.outcome}" data-suite="${esc(from.id)}"
     data-name="${esc(name)}" data-target="${column.target}" data-leaf="${leaf}"
     data-replicate="${entry.replicate}" title="Inspect icon">${faceSVG(
       entry,
       column.form,
       from,
       scale,
     )}</button>`;
}

/** One face per expression, four across. The shape a figure wants. */
function plateHTML(from, target, pick) {
  const column = columnsFor([target])[0];
  const cells = from.expressions
    .map((name) => {
      const entry = pick(from, name, target);
      return `<figure>${faceButton(entry, column, from, name, 8)}<figcaption>${esc(name)}</figcaption></figure>`;
    })
    .join("");
  return `<div class="plate">${cells}</div>`;
}

// --------------------------------------------------------------------------- views

/**
 * The key that reads a figure: what each form asked for, and what each outcome
 * means. `lead` is for a page whose cells need explaining before its colours do.
 */
/**
 * The key, which is also the controls.
 *
 * The form was being said three times over -- a selector, a diagram, and a list
 * of definitions. Here it is said once: the selector sits above the diagram, and
 * the diagram carries the descriptions in the positions they describe.
 */
function keyHTML(lead = "") {
  const chosen = state.narrow.form;
  const picked = state.narrow.expression;
  const options = FORM_FILTERS.map(([v, t]) => option(v, t, chosen)).join("");

  //: Every position names the option that isolates it, so the diagram reads the
  //: dropdown as well as the cell. Four real cells rather than a spanned row:
  //: the bottom pair are two faces, and a rule through the middle of one wide
  //: cell would run through its own text.
  const LABEL = Object.fromEntries(FORM_FILTERS);
  const cell = (v) => `<td><b>${LABEL[v]}</b><span>${FORM_BRIEF[v]}</span></td>`;
  const shape =
    chosen === "all"
      ? `<table class="quadkey">
         <tr>${cell("grid_only")}${cell("hex_only")}</tr>
         <tr>${cell("both:grid")}${cell("both:hex")}</tr></table>`
      : chosen === "both"
        ? `<table class="quadkey"><tr>${cell("both:grid")}${cell("both:hex")}</tr></table>`
        : `<p class="one">${FORM_BRIEF[chosen]}</p>`;

  //: Only the outcomes a reader can switch. A valid face needs no explaining and
  //: a missing one is its own evidence; the full set is on Method.
  const outcomes = Object.entries(OUTCOMES)
    .filter(([k]) => MARKABLE.has(k))
    .map(
      ([k, [name, meaning]]) =>
        `<div data-outcome="${k}"><dt><input type="checkbox" class="mark" data-mark="${k}"${
          state.marks[k] ? " checked" : ""
        } aria-label="mark ${esc(name)}">${name}</dt><dd>${meaning}</dd></div>`,
    )
    .join("");

  const facets = `<div class="picks">
      <label class="field">model<select id="k-model">${modelOptions(state.narrow.model)}</select></label>
      <div class="field">
        <span class="row">expression${
          picked.length ? `<button class="chip-clear" data-clear="expression">clear</button>` : ""
        }</span>
        <div class="chips">${(suite?.expressions ?? [])
          .map(
            (n) =>
              `<button class="chip" data-expr="${esc(n)}" aria-pressed="${String(
                picked.includes(n),
              )}">${esc(n)}</button>`,
          )
          .join("")}</div>
      </div>
      <label class="field">form<select id="k-form">${options}</select></label>
      ${shape}
      <label class="field">replicate<select id="k-replicate">${replicateOptions(
        state.replicate,
        replicateCount(),
      )}</select></label>
    </div>`;

  const narrowed =
    state.narrow.model !== "all" || state.narrow.form !== "all" || picked.length > 0;

  return `<aside class="key">
      ${lead}
      <div class="key-head"><button id="k-reset" class="reset"${
        narrowed ? "" : " disabled"
      }>reset</button></div>
      ${facets}
      <section><h3>Outcomes</h3><dl class="marks">${outcomes}</dl></section>
      <label class="check last"><input type="checkbox" class="chassis-check"${
        state.chassis ? " checked" : ""
      }> desktop chassis</label>
      ${exportControlHTML()}
    </aside>`;
}

function renderProse(sections) {
  stageEl.innerHTML = `<div class="prose">${sections
    .map(([heading, body]) => `<section><h2>${esc(heading)}</h2><p>${esc(body)}</p></section>`)
    .join("")}</div>`;
}

function renderOverview() {
  renderProse(OVERVIEW);
}

function renderMethod() {
  const targets = Object.entries(TARGETS)
    .filter(([t]) => t !== "transcribe")
    .map(([t, d]) => `<div><dt>${formName(t)}</dt><dd>${d}</dd></div>`)
    .join("");
  const outcomes = Object.entries(OUTCOMES)
    .map(([k, [name, meaning]]) => `<div data-outcome="${k}"><dt><i></i>${name}</dt><dd>${meaning}</dd></div>`)
    .join("");
  const c = suite.config;
  const run = [
    ["models", catalogue.map(suiteName).join(", ")],
    ["expressions", String(suite.expressions.length)],
    ["references", c.references ? `${c.references}, ${c.reference_set}` : "none"],
    ["copy directive", c.no_copy ? "instructed not to reproduce them" : "none"],
    ["grid", `${c.width} × ${c.height} pixels`],
    ["replicates per condition", String(suite.replicates)],
  ]
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join("");

  stageEl.innerHTML = `<div class="prose">${METHOD.map(
    ([h, b]) => `<section><h2>${esc(h)}</h2><p>${esc(b)}</p></section>`,
  ).join("")}</div>
    <div class="defs">
      <div><h2>Targets</h2><dl>${targets}</dl></div>
      <div><h2>Outcomes</h2><dl>${outcomes}</dl></div>
      <div><h2>This run</h2><dl class="run">${run}</dl></div>
    </div>`;
}


/**
 * Everything at once: expressions down, models across, four outputs per cell.
 *
 * Collapsing the form axis into the cell means all three parameters are on one
 * page. It only reads if the levels stay visually distinct -- the quad is boxed
 * and tight, the cells are spaced apart, so a reader can tell which faces belong
 * together without counting.
 */
/**
 * Everything, then less of it.
 *
 * Three orthogonal facets, each defaulting to "all". Narrowing one does not
 * change the page's structure, only how much of it there is: filtering models
 * or expressions removes columns or rows, and filtering forms changes what sits
 * inside a cell -- four outputs, two, or one. The cell keeps its shape either
 * way, which is why the earlier separate pages were all this page filtered.
 */
/**
 * How big the faces can be, and how many blocks fit on a line.
 *
 * Filtering frees space, and leaving it empty wastes the page while scaling by a
 * step function overflows it. So the size is solved for the width that is
 * actually there: the largest that still fits, clamped so a full grid stays
 * legible and a single icon does not become a poster.
 *
 * The arithmetic mirrors the stylesheet's gaps rather than measuring them. It is
 * approximate on purpose -- the figure scrolls if it is ever wrong, and the
 * clamps keep the error small.
 */
const KEY_WIDTH = 240 + 40; // the aside and the gap beside it
const ROW_HEAD = 112; // 7rem
const CELL_GAP = 20;
const QUAD_PAD = 10;
const MIN_SCALE = 4;
const MAX_SCALE = 13;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function figureWidth() {
  //: Falls back to a typical window when nothing has been laid out yet, so the
  //: first render is sensible and tests are deterministic.
  const stage = stageEl.clientWidth || 1200;
  return Math.max(360, stage - KEY_WIDTH);
}

/** What one face actually measures on screen at a given scale. */
function faceWidthAt(scale) {
  //: `faceSVG` halves the scale for the chassis, which is 32 wide rather than
  //: 16. Solving against the requested scale rather than the drawn size is how
  //: you end up with everything at half the width you asked for.
  return state.chassis ? 32 * Math.max(2, Math.round(scale / 2)) : 16 * scale;
}

function layoutFor({ columns, across, ribbon }) {
  const avail = figureWidth();
  const quad = (scale) => across * faceWidthAt(scale) + (across - 1) * 2 + QUAD_PAD;

  //: Search downwards for the largest that fits rather than solving for it: the
  //: chassis rounds, so the algebra and the rendered width disagree.
  const largest = (fits) => {
    for (let scale = MAX_SCALE; scale > MIN_SCALE; scale--) if (fits(scale)) return scale;
    return MIN_SCALE;
  };

  if (!ribbon) {
    const scale = largest((n) => ROW_HEAD + columns * (quad(n) + CELL_GAP) <= avail);
    return { scale, min: null, columns };
  }

  //: One model wraps into blocks, so the choice is between bigger faces and more
  //: per line. Prefer more columns while the faces stay a usable size.
  for (const want of [4, 3, 2]) {
    const scale = largest((n) => want * (quad(n) + CELL_GAP) <= avail);
    if (scale >= 6) return { scale, min: quad(scale) + CELL_GAP, columns: want };
  }
  const scale = largest((n) => quad(n) + CELL_GAP <= avail);
  return { scale, min: quad(scale) + CELL_GAP, columns: 1 };
}

function matrixParts() {
  const { model, expression, form } = state.narrow;
  const every = catalogue.map((s) => loaded.get(s.id)).filter(Boolean);
  const suites = model === "all" ? every : every.filter((s) => s.id === model);
  const allNames = every[0]?.expressions ?? [];
  const names = expression.length ? allNames.filter((n) => expression.includes(n)) : allNames;
  const quad = quadFor(form);
  const across = Math.min(2, quad.length);

  //: One model is a tall ribbon with a page of blank space beside it, so its
  //: rows wrap into blocks instead of stacking in a single column.
  const ribbon = suites.length === 1;
  const { scale, min } = layoutFor({ columns: suites.length, across, ribbon });

  const cell = (from, name) =>
    quad
      .map(({ target, form: f }) => {
        if (!from.targets.includes(target)) return `<span class="void">—</span>`;
        return faceButton(entryAt(from, name, target), { target, form: f }, from, name, scale);
      })
      .join("");

  const quadOf = (from, name) => `<div class="quad" style="--across:${across}">${cell(from, name)}</div>`;

  const figure = ribbon
    ? `<div class="blocks cells" style="--min:${min}px">${names
        .map(
          (name) =>
            `<section class="block"><h2><button class="pin" data-expr="${esc(name)}">${esc(name)}</button></h2>` +
            `${quadOf(suites[0], name)}</section>`,
        )
        .join("")}</div>`
    : `<table class="matrix"><thead><tr><th></th>${suites
        .map((s) => `<th><button class="pin" data-model="${esc(s.id)}">${esc(suiteName(s))}</button></th>`)
        .join("")}</tr></thead><tbody>${names
        .map(
          (name) =>
            `<tr><th class="rowhead"><button class="pin" data-expr="${esc(name)}">${esc(name)}</button></th>` +
            suites.map((s) => `<td class="cell">${quadOf(s, name)}</td>`).join("") +
            `</tr>`,
        )
        .join("")}</tbody></table>`;

  return { figure };
}

function renderMatrix() {
  const { figure } = matrixParts();
  stageEl.innerHTML = `<div class="figure wide">
      <figure id="figure" class="comparison">${figure}</figure>
      ${keyHTML()}
    </div>`;
}

/**
 * Advance the cycle without rebuilding the page around it.
 *
 * Only the faces change between frames. Re-rendering the whole stage would also
 * rebuild the key, which closes an open dropdown every 700ms and makes the form
 * selector unusable while the animation runs.
 */
function renderFrame() {
  const host = state.view === "matrix" ? el("figure") : null;
  if (!host) return render();
  host.innerHTML = matrixParts().figure;
  wire();
}

function renderPlate() {
  const target = state.target === "all" ? suite.targets.at(-1) : state.target;
  //: The plate has neither a key nor a bench, so its saving control sits above
  //: the figure rather than below it, where a twelve-cell plate would bury it.
  stageEl.innerHTML = exportControlHTML() + plateHTML(suite, target, bestAt);
}

/** Every output as a row -- model, expression, form -- beside the selected one. */
function renderInspect() {
  const rep = state.replicate === "all" ? "1" : state.replicate;
  const suites = catalogue.map((s) => loaded.get(s.id)).filter(Boolean);
  const rows = suites.flatMap((from) =>
    from.expressions.flatMap((name) =>
      LEAVES.filter((leaf) => from.targets.includes(leaf.target)).map((leaf) => ({ from, name, leaf })),
    ),
  );
  const f = state.filters;
  const shown = rows.filter(
    (r) =>
      (f.model === "all" || r.from.id === f.model) &&
      (f.expression === "all" || r.name === f.expression) &&
      (f.form === "all" || r.leaf.key === f.form),
  );

  const filters = `<div class="filters">
      <select id="f-model">${[option("all", "every model", f.model)]
        .concat(suites.map((x) => option(x.id, suiteName(x), f.model)))
        .join("")}</select>
      <select id="f-expression">${[option("all", "every expression", f.expression)]
        .concat((suites[0]?.expressions ?? []).map((n) => option(n, n, f.expression)))
        .join("")}</select>
      <select id="f-form">${[option("all", "every form", f.form)]
        .concat(LEAVES.map((leaf) => option(leaf.key, leafName(leaf.key), f.form)))
        .join("")}</select>
    </div>`;

  const index = shown
    .map(({ from, name, leaf }) => {
      const entry = (from.cells[name]?.[leaf.target] ?? []).find((e) => String(e.replicate) === rep);
      const outcome = entry?.outcome ?? "missing";
      const current = from.id === suite.id && name === state.expression && leaf.key === state.form;
      //: The row itself carries the outcome. A column of swatches beside a
      //: hundred and forty rows is a column mostly saying nothing happened;
      //: colouring the entry says the same thing only where it is true.
      return `<tr class="row" tabindex="0" data-suite="${esc(from.id)}" data-name="${esc(name)}"
          data-target="${leaf.key}" data-outcome="${outcome}" title="${label(outcome)}"
          aria-current="${String(current)}">
          <td>${esc(suiteName(from))}</td><td class="lead">${esc(name)}</td>
          <td>${leafName(leaf.key)}</td>
        </tr>`;
    })
    .join("");

  const samples = replicateOptions(state.replicate, replicateCount());
  const tools = `<div class="tools">
      <label class="field">replicate<select id="t-replicate">${samples}</select></label>
      <label class="check"><input type="checkbox" class="chassis-check"${
        state.chassis ? " checked" : ""
      }> desktop chassis</label>
      ${exportControlHTML()}
    </div>`;

  stageEl.innerHTML = `<div class="explorer">
      <div class="index">${filters}
        <div class="scroll"><table>
          <thead><tr><th>model</th><th>expression</th><th>form</th></tr></thead>
          <tbody>${index}</tbody>
        </table></div>
        <p class="count">${shown.length} of ${rows.length}</p></div>
      <div class="detail">${selectionHTML()}${tools}${inspectPanel()}</div>
    </div>`;
}

/** What is being looked at, said once, above everything that varies. */
function selectionHTML() {
  const leaf = LEAVES.find((l) => l.key === state.form) ?? LEAVES[0];
  return `<h2 class="selection" title="${esc(TARGETS[leaf.target])}">${esc(suiteName(suite))} ·
    ${esc(state.expression)} · ${leafName(leaf.key)}</h2>`;
}

/** The selected output in full, or every replicate of it, one under another. */
function inspectPanel() {
  const leaf = LEAVES.find((l) => l.key === state.form) ?? LEAVES[0];
  const all = suite.cells[state.expression]?.[leaf.target] ?? [];
  if (!all.length) return `<p class="empty">Nothing recorded for this one.</p>`;

  //: "all" stacks the same panel rather than reducing to a strip of faces. The
  //: point of being this far in is the hex beside the picture; a row of icons
  //: is what the matrix is for.
  const wanted =
    state.replicate === "all"
      ? all
      : [all.find((e) => String(e.replicate) === state.replicate) ?? all[0]];

  return promptHTML(leaf.target, wanted) + wanted.map((entry) => attemptPanel(entry, leaf)).join("");
}

/**
 * One attempt, as the three things it actually is: the face, the grid, the hex.
 *
 * Each is shown once. The grid and the hex are the two written forms, so a
 * table carrying both and a readout carrying one of them again was the same
 * hex twice. Side by side their rows line up, which is what made the table
 * worth having in the first place.
 *
 * Where a target produced only one form, the other is derived and says so --
 * an icon that only ever drew still has a hex, and it is worth taking away.
 */
function attemptPanel(entry, leaf) {
  const { width: w } = suite.config;
  const bad = new Set(entry.differing_rows ?? []);

  const written = entry.hex?.length ? entry.hex : null;
  const drawn = entry.grid?.length ? entry.grid : entry.given_grid?.length ? entry.given_grid : null;
  const grid = drawn ?? (written ? draw(hexToBitmap(written, w, written.length)) : null);
  const hex =
    written ??
    (entry.hex_from_grid?.length
      ? entry.hex_from_grid
      : drawn
        ? hexFromBitmap(gridToBitmap(drawn, w, drawn.length))
        : null);

  const lines = (rows) =>
    rows
      .map((row, y) => (bad.has(y) ? `<span class="bad">${esc(row)}</span>` : esc(row)))
      .join("\n");

  const readout = (name, derived, rows) =>
    rows
      ? `<div class="readout">
          <h4>${name}${derived ? `<span class="from">${derived}</span>` : ""}</h4>
          <button class="copy" data-copy="${esc(rows.join("\n"))}" title="Copy ${name}"
            aria-label="Copy ${name}">${COPY_ICON}${TICK_ICON}</button>
          <pre>${lines(rows)}</pre>
        </div>`
      : "";

  const bitmap = bitmapOf(entry, leaf.form, suite.config);
  //: Only an outcome worth acting on is named. "valid" and "one form" are the
  //: normal case, and a tag on every panel saying nothing happened is noise.
  const tag = NOTABLE.has(entry.outcome) ? `<span class="tag">${label(entry.outcome)}</span>` : "";
  return `<section class="panel" data-outcome="${entry.outcome}">
      <button class="snap" data-only="${entry.replicate}" title="Export this icon"
        aria-label="Export this icon">${SAVE_ICON}</button>
      <h3>replicate ${entry.replicate}${tag}</h3>
      <div class="spread">
        ${bitmap ? `<figure class="shown">${faceSVG(entry, leaf.form, suite, 12)}</figure>` : ""}
        ${readout("grid", drawn ? "" : "from its hex", grid)}
        ${readout("hex", written ? "" : "from its grid", hex)}
      </div>
      ${entry.faults.length ? `<ul class="faults">${entry.faults.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </section>`;
}

const COPY_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="6" y="6" width="8" height="8" rx="1.5"/>' +
  '<path d="M10 4V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1"/></svg>';
const TICK_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 8.5l3.5 3.5L13 5"/></svg>';

/**
 * Put text on the clipboard, by whichever route is open.
 *
 * The modern call is refused more often than it looks -- an insecure origin, a
 * permission not granted. Selecting the text and asking the document to copy is
 * the older way and still works in those cases. If even that is refused the
 * selection is left standing, which is worth more than a button that quietly
 * did nothing.
 */
async function copyText(text, from) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const range = document.createRange?.();
      if (range && from) {
        range.selectNodeContents(from);
        const selection = getSelection?.();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      return document.execCommand?.("copy") ?? false;
    } catch {
      return false;
    }
  }
}

/**
 * The prompt behind the selection, once.
 *
 * It belongs to the condition rather than to any one replicate -- every
 * replicate of a condition is the same request sent again. Repeating it under
 * each of them said the same page of text five times over.
 *
 * Chained targets are the exception: `transcribe` embeds the grid the model
 * itself drew, so its prompt differs per replicate. That target is not shown
 * here, but rather than assume it never will be, the divergence is checked and
 * declared instead of quietly showing the first one.
 */
function promptHTML(target, entries) {
  const seen = entries
    .map((e) => requestFor(target, e.replicate, state.expression))
    .filter(Boolean);
  if (!seen.length) return "";
  const distinct = new Set(seen.map((r) => `${r.system}\u0000${r.prompt}`));
  const found = seen[0];
  const sent = [found.system && ["system", found.system], found.prompt && ["user", found.prompt]]
    .filter(Boolean)
    .map(([k, v]) => `<section><h4>${k}</h4><pre>${esc(v)}</pre></section>`)
    .join("");
  if (!sent) return "";
  const caveat =
    distinct.size > 1
      ? `<p class="warn">This target varies its prompt by replicate; showing the first of ${distinct.size}.</p>`
      : "";
  return `<details class="prompt"><summary>view prompt</summary>${caveat}${sent}</details>`;
}

// --------------------------------------------------------------------------- chrome

function renderChrome() {
  const page = PAGES[state.view];
  titleEl.textContent = page.title;
  introEl.textContent = page.intro;
  const used = controlsFor(state.view);
  //: Selectors above choose what is on the page -- which model, which
  //: expression, which form, which replicate. The row below only affects how it
  //: is drawn, so it keeps its own line.
  barEl.toggleAttribute("hidden", used.length === 0);
  displayEl.toggleAttribute("hidden", OWN_CHASSIS.includes(state.view) || !DATA_VIEWS.includes(state.view));

  //: Only the plate needs a strip: it is the one page that labels nothing else,
  //: since a figure for reproduction carries no headings of its own. Everywhere
  //: else the model is already named -- in a row heading, a figure title, or the
  //: attempt itself -- and the experiment record lives on Method.
  const rows =
    state.view !== "plate"
      ? []
      : [
          ["model", short(suite.config.model)],
          ["effort", suite.config.effort ?? "not applicable"],
          ["grid", `${suite.config.width} × ${suite.config.height}`],
          ["replicates", String(suite.replicates)],
        ];
  detailsEl.toggleAttribute("hidden", rows.length === 0);
  detailsEl.innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");

  chassisEl.checked = state.chassis;
  //: Malformed and disagreement are different findings, so they are marked
  //: independently. A malformed answer is unusable; a disagreement means the two
  //: written forms differ, which does not make either of them individually bad.
  stageEl.classList?.toggle("hide-malformed", !state.marks.malformed);
  stageEl.classList?.toggle("hide-differs", !state.marks.differs);
}

function render() {
  if (!suite) return;
  //: Rebuilding the stage throws away where the reader had scrolled to. Selecting
  //: a row is a re-render, so without this the list jumps to the top every time
  //: you pick something from the bottom of it.
  const scrolled = stageEl.querySelector?.(".scroll")?.scrollTop ?? 0;
  renderChrome();
  ({
    overview: renderOverview,
    method: renderMethod,
    matrix: renderMatrix,
    index: renderInspect,
    plate: renderPlate,
  })[state.view]();
  const box = stageEl.querySelector?.(".scroll");
  if (box && scrolled) box.scrollTop = scrolled;
  wire();
}

function wire() {
  for (const b of stageEl.querySelectorAll?.(".face") ?? []) {
    b.onclick = () => {
      state.expression = b.dataset.name;
      state.form = b.dataset.leaf ?? b.dataset.target;
      suite = loaded.get(b.dataset.suite) ?? suite;
      if (state.replicate !== "all") state.replicate = b.dataset.replicate;
      setView("index");
    };
  }
  for (const b of stageEl.querySelectorAll?.(".row") ?? []) {
    b.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault?.();
        b.onclick();
      }
    };
    b.onclick = () => {
      suite = loaded.get(b.dataset.suite) ?? suite;
      state.expression = b.dataset.name;
      state.form = b.dataset.target;
      render();
      writeHash(false);
    };
  }
  //: The key doubles as the control panel, so its switches are wired with the
  //: rest of the stage on every render.
  //: The key's selectors are the matrix's only controls, so they are wired with
  //: the rest of the stage on every render.
  const saveEl = el("x-save");
  if (saveEl) saveEl.onclick = () => runExport();
  const fmtEl = el("x-format");
  if (fmtEl) fmtEl.onchange = () => (state.format = fmtEl.value);
  for (const [id, key] of [["k-model", "model"], ["k-form", "form"]]) {
    const node = el(id);
    if (node)
      node.onchange = () => {
        state.narrow[key] = node.value;
        syncFacets();
      };
  }
  for (const chip of stageEl.querySelectorAll?.(".chip") ?? []) {
    chip.onclick = () => {
      const name = chip.dataset.expr;
      const picked = state.narrow.expression;
      state.narrow.expression = picked.includes(name)
        ? picked.filter((x) => x !== name)
        : [...picked, name];
      syncFacets();
    };
  }
  for (const b of stageEl.querySelectorAll?.(".chip-clear") ?? []) {
    b.onclick = () => {
      state.narrow.expression = [];
      syncFacets();
    };
  }
  const replEl = el("k-replicate");
  if (replEl)
    replEl.onchange = () => {
      state.replicate = replEl.value;
      setTimerFor(state.replicate);
      syncFacets();
    };
  for (const box of stageEl.querySelectorAll?.(".chassis-check") ?? []) {
    box.onchange = () => {
      state.chassis = Boolean(box.checked);
      render();
      writeHash(false);
    };
  }
  for (const box of stageEl.querySelectorAll?.(".mark") ?? []) {
    box.onchange = () => {
      state.marks[box.dataset.mark] = Boolean(box.checked);
      render();
      writeHash(false);
    };
  }
  for (const b of stageEl.querySelectorAll?.(".pin") ?? []) {
    b.onclick = () => {
      if (b.dataset.model) state.narrow.model = b.dataset.model;
      if (b.dataset.expr) state.narrow.expression = [b.dataset.expr];
      syncFacets();
    };
  }
  for (const b of stageEl.querySelectorAll?.(".copy") ?? []) {
    b.onclick = async () => {
      const ok = await copyText(b.dataset.copy, b.parentNode);
      //: A button with no room for a word still has room for a different shape.
      if (ok) {
        b.setAttribute?.("data-copied", "");
        setTimeout(() => b.removeAttribute?.("data-copied"), 1200);
      }
    };
  }
  const resetEl = el("k-reset");
  if (resetEl)
    resetEl.onclick = () => {
      state.narrow = { model: "all", expression: [], form: "all" };
      syncFacets();
    };
  for (const b of stageEl.querySelectorAll?.(".snap") ?? []) {
    b.onclick = (event) => {
      event?.stopPropagation?.();
      runExport(b.dataset.only);
    };
  }
  const tryEl = el("t-replicate");
  if (tryEl)
    tryEl.onchange = () => {
      state.replicate = tryEl.value;
      render();
      writeHash(false);
    };
  for (const [id, key] of [["f-model", "model"], ["f-expression", "expression"], ["f-form", "form"]]) {
    const node = el(id);
    if (node)
      node.onchange = () => {
        state.filters[key] = node.value;
        render();
      };
  }
}

// --------------------------------------------------------------------------- controls

function applyChrome() {
  //: On the crossing page the visible selector is whichever parameter is held,
  //: so the control set is computed rather than fixed.
  const used = controlsFor(state.view);
  for (const [id, node] of [["suites", suitesEl], ["expression", expressionEl], ["targets", targetsEl], ["replicate", replicateEl]]) {
    node.closest?.(".field")?.toggleAttribute("hidden", !used.includes(id));
  }
  for (const tab of navEl.querySelectorAll?.("[data-view]") ?? []) {
    tab.setAttribute("aria-selected", String(tab.dataset.view === state.view));
  }
}

/**
 * "all" cycles the replicates in place, so variance reads as movement.
 *
 * Only on the matrix. On the index "all" lays them out side by side, and a
 * timer there would redraw the whole page -- and its scroll position -- every
 * 700ms for an animation nobody asked for.
 */
function setTimerFor(mode) {
  if (timer) clearInterval(timer);
  timer = null;
  if (mode !== "all" || state.view !== "matrix") return;
  timer = setInterval(() => {
    state.frame++;
    renderFrame();
  }, 700);
}

const FACETED = ["matrix"];
const faceted = () => FACETED.includes(state.view);
const option = (v, t, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(t)}</option>`;

const modelOptions = (current) =>
  option("all", "all", current) +
  catalogue.map((c) => option(c.id, suiteName(c), current)).join("");

const expressionOptions = (current) =>
  option("all", "all", current) +
  (suite?.expressions ?? []).map((n) => option(n, n, current)).join("");

const replicateOptions = (current, n) =>
  Array.from({ length: n }, (_, i) => option(String(i + 1), `replicate ${i + 1}`, current)).join("") +
  (n > 1 ? option("all", `all (${n})`, current) : "");

function fillExpressions() {
  const names = suite?.expressions ?? [];
  if (faceted()) {
    //: The matrix offers the whole set as chips in its key; here we only keep
    //: the selection honest against the suite that is loaded.
    state.narrow.expression = state.narrow.expression.filter((n) => names.includes(n));
    return;
  }
  expressionEl.innerHTML = names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  state.expression = names.includes(state.expression) ? state.expression : names[0];
  expressionEl.value = state.expression;
}

function fillSuites() {
  const models = catalogue.map((c) => option(c.id, suiteName(c), faceted() ? state.narrow.model : suite?.id));
  suitesEl.innerHTML = faceted()
    ? option("all", "all", state.narrow.model) + models.join("")
    : models.join("");
  suitesEl.value = faceted() ? state.narrow.model : suite?.id;
}

function fillTargets() {
  const targets = suite?.targets ?? [];
  const single = ONE_FORM.includes(state.view);
  const chosen = faceted() ? state.narrow.form : state.target;
  const all = single ? "" : option("all", "all", chosen);
  targetsEl.innerHTML = all + targets.map((t) => option(t, formName(t), chosen)).join("");
  if (faceted()) {
    const offered = FORM_FILTERS.filter(([v]) => v === "all" || targets.includes(v.split(":")[0]));
    targetsEl.innerHTML = offered.map(([v, t]) => option(v, t, state.narrow.form)).join("");
    if (!offered.some(([v]) => v === state.narrow.form)) state.narrow.form = "all";
    targetsEl.value = state.narrow.form;
    return;
  }
  if (single && state.target === "all") state.target = targets[0] ?? "all";
  if (![...targetsEl.options].some((o) => o.value === state.target)) state.target = targetsEl.options[0]?.value ?? "all";
  targetsEl.value = state.target;
}

/** How many replicates every suite on the page has in common. */
function replicateCount() {
  const spans = state.view === "matrix";
  return spans ? Math.min(...[...loaded.values()].map((s) => s.replicates)) : suite.replicates;
}

function fillReplicates() {
  const n = replicateCount();
  const keep = state.replicate;
  //: The index used to offer no cycle, so it was capped to one. Its bench shows
  //: every replicate as a grid now, so it takes the same options as anywhere.
  replicateEl.innerHTML = replicateOptions(state.replicate, n);
  const has = (v) => [...replicateEl.options].some((o) => o.value === v);
  state.replicate = has(keep) ? keep : has("all") ? "all" : "1";
  replicateEl.value = state.replicate;
  setTimerFor(state.replicate);
}

/** Re-read the facets into the controls, redraw, and record it in the address. */
function syncFacets() {
  fillSuites();
  fillExpressions();
  fillTargets();
  render();
  writeHash(false);
}

async function setView(next, { push = true } = {}) {
  state.view = next;
  applyChrome();
  if (["matrix", "index"].includes(next))
    await Promise.all(catalogue.map((s) => fetchSuite(s.id)));
  fillSuites();
  fillExpressions();
  fillTargets();
  fillReplicates();
  if (!LEAVES.some((l) => l.key === state.form)) state.form = LEAVES[0].key;
  render();
  writeHash(push);
}

// --------------------------------------------------------------------------- address
//
// The view is the route; everything else is a parameter. A view change earns a
// history entry and a control change does not, so Back moves between views
// rather than undoing a dropdown, and any state is a shareable link.

/** Only the marks that are switched off need saying. */
function markParams(params) {
  for (const [k, on] of Object.entries(state.marks)) if (!on) params.set(k, "0");
}

function writeHash(push) {
  const wanted = PARAMS[state.view];
  const params = new URLSearchParams();
  //: A faceted view's address is its filters and nothing else -- an unfiltered
  //: page should produce a bare link, not one restating every default.
  if (faceted()) {
    for (const [k, param] of [["model", "model"], ["form", "form"]]) {
      if (state.narrow[k] !== "all") params.set(param, state.narrow[k]);
    }
    if (state.narrow.expression.length) params.set("expr", state.narrow.expression.join(","));
    if (wanted.includes("replicate")) params.set("replicate", state.replicate);
    if (!state.chassis) params.set("chassis", "0");
    markParams(params);
    const query = params.toString();
    const hash = `#/${state.view}${query ? `?${query}` : ""}`;
    if (location.hash === hash) return;
    const url = location.pathname + hash;
    if (push) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
    return;
  }
  if (wanted.includes("suite")) params.set("suite", suite.id);
  if (wanted.includes("expr")) params.set("expr", state.expression);
  if (wanted.includes("form")) params.set("form", state.form ?? suite.targets[0]);
  if (wanted.includes("target")) params.set("target", state.target);
  if (wanted.includes("replicate")) params.set("replicate", state.replicate);
  if (!state.chassis) params.set("chassis", "0");
  markParams(params);
  const query = params.toString();
  const hash = `#/${state.view}${query ? `?${query}` : ""}`;
  if (location.hash === hash) return;
  const url = location.pathname + hash;
  if (push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

async function readHash() {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  const params = new URLSearchParams(query ?? "");
  const view = path in CONTROLS ? path : "overview";
  if (params.get("form")) state.target = params.get("form");
  if (view === "matrix") {
    state.narrow = {
      model: params.get("model") ?? "all",
      expression: (params.get("expr") ?? "").split(",").filter(Boolean),
      form: params.get("form") ?? "all",
    };
  }
  const id = params.get("suite");
  if (id && catalogue.some((s) => s.id === id)) {
    suite = await fetchSuite(id);
    suitesEl.value = id;
  }
  const expr = params.get("expr");
  if (expr && suite.expressions.includes(expr)) state.expression = expr;
  state.expression ??= suite.expressions[0];
  state.target = params.get("target") ?? "all";
  state.form = params.get("form") ?? state.form;
  state.chassis = params.get("chassis") !== "0";
  state.marks = { malformed: params.get("malformed") !== "0", differs: params.get("differs") !== "0" };
  state.replicate = params.get("replicate") ?? "all";
  await setView(view, { push: false });
}

async function fetchSuite(id) {
  if (!loaded.has(id)) loaded.set(id, await fetch(`/api/suites/${encodeURIComponent(id)}`).then((r) => r.json()));
  return loaded.get(id);
}

async function load(id) {
  suite = await fetchSuite(id);
  suitesEl.value = id;
  fillExpressions();
  fillTargets();
  fillReplicates();
  render();
}

async function boot() {
  catalogue = await fetch("/api/suites").then((r) => r.json());
  if (!catalogue.length) {
    stageEl.innerHTML = `<p class="empty">No runs yet — <code>bitface suite</code>.</p>`;
    return;
  }
  suitesEl.innerHTML = catalogue.map((s) => `<option value="${esc(s.id)}">${esc(suiteName(s))}</option>`).join("");
  suitesEl.onchange = () => {
    if (faceted()) {
      state.narrow.model = suitesEl.value;
      return syncFacets();
    }
    load(suitesEl.value).then(() => writeHash(false));
  };
  expressionEl.onchange = () => {
    state.expression = expressionEl.value;
    render();
    writeHash(false);
  };
  targetsEl.onchange = () => {
    if (faceted()) {
      state.narrow.form = targetsEl.value;
      return syncFacets();
    }
    state.target = targetsEl.value;
    render();
    writeHash(false);
  };
  replicateEl.onchange = () => {
    state.replicate = replicateEl.value;
    setTimerFor(state.replicate);
    render();
    writeHash(false);
  };
  navEl.onclick = (event) => {
    const view = event.target?.dataset?.view;
    if (view) setView(view);
  };
  chassisEl.onchange = () => {
    state.chassis = Boolean(chassisEl.checked);
    render();
    writeHash(false);
  };
  addEventListener("hashchange", readHash);
  //: The size is solved against the window, so it has to be solved again when
  //: the window changes. Debounced, because resize fires continuously.
  let resizing = null;
  addEventListener("resize", () => {
    clearTimeout(resizing);
    resizing = setTimeout(() => {
      if (state.view === "matrix") render();
    }, 120);
  });
  await load(catalogue[0].id);
  await readHash();
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// --------------------------------------------------------------------------- export

/** Draw the current view once, at whichever replicate `state.frame` is on. */
function drawCurrent(chassis, only = null) {
  const suites = catalogue.map((s) => loaded.get(s.id)).filter(Boolean);

  if (state.view === "plate") {
    const target = state.target === "all" ? suite.targets.at(-1) : state.target;
    const column = columnsFor([target])[0];
    const cells = suite.expressions.map((name) => ({
      label: name,
      bitmap: bitmapOf(bestAt(suite, name, target), column.form, suite.config),
    }));
    return drawPlate({ cells, config: suite.config, chassis });
  }

  if (state.view === "index") {
    const leaf = LEAVES.find((l) => l.key === state.form) ?? LEAVES[0];
    const all = suite.cells[state.expression]?.[leaf.target] ?? [];
    const pick = only ?? (state.replicate === "all" ? null : state.replicate);
    const wanted = pick ? all.filter((e) => String(e.replicate) === String(pick)) : all;
    const cells = wanted
      .map((entry) => ({
        label: `replicate ${entry.replicate}`,
        bitmap: bitmapOf(entry, leaf.form, suite.config),
      }))
      .filter((c) => c.bitmap);
    if (!cells.length) return null;
    return drawPlate({ cells, config: suite.config, chassis, across: Math.min(3, cells.length) });
  }

  //: The matrix is the only grid left, and it exports what the facets left on
  //: screen -- not the whole thing regardless of what the reader narrowed to.
  const { model, expression, form } = state.narrow;
  const every = catalogue.map((x) => loaded.get(x.id)).filter(Boolean);
  const shown = model === "all" ? every : every.filter((x) => x.id === model);
  const allNames = every[0]?.expressions ?? [];
  const names = expression.length ? allNames.filter((n) => expression.includes(n)) : allNames;
  const quad = quadFor(form);
  const targets = [...new Set(quad.map((q) => q.target))];

  const across = Math.min(2, quad.length);
  const legend = {
    forms: targets.map((t) => [formName(t), TARGETS[t]]),
    outcomes: Object.entries(OUTCOMES)
      .filter(([k]) => MARKABLE.has(k) && state.marks[k])
      .map(([k, [name, meaning]]) => ({ key: k, name, meaning })),
  };
  const faces = (from, name) =>
    quad.map(({ target, form: f }) => {
      if (!from.targets.includes(target)) return null;
      const entry = entryAt(from, name, target);
      return { bitmap: bitmapOf(entry, f, from.config), outcome: entry?.outcome };
    });

  //: One model wraps into blocks on the page, so it wraps in the image too --
  //: otherwise a figure arranged three across comes out twelve deep.
  if (shown.length === 1) {
    const { columns } = layoutFor({ columns: 1, across, ribbon: true });
    return drawTiles({
      tiles: names.map((n) => ({ label: n, cells: faces(shown[0], n) })),
      config: suite.config,
      chassis,
      across: columns,
      quadAcross: across,
      legend,
    });
  }

  return drawQuads({
    rows: names.map((n) => ({ label: n, name: n })),
    columns: shown.map((x) => ({ label: suiteName(x), from: x })),
    across,
    config: suite.config,
    chassis,
    legend,
    cellFor: (row, column) => faces(column.from, row.name),
  });
}

const fileName = (only = null) => {
  if (only) return `${suite.id}-${only}`;
  return (
    {
      plate: `${suite.id}-plate`,
      index: `${suite.id}-${state.expression}-${leafName(state.form)}`,
      matrix: `${suite.id.split("-")[0]}-matrix`,
    }[state.view] ?? suite.id
  );
};

/** Save what is on screen, or just one block of it. */
function runExport(only = null) {
  const format = exportFormat();
  const chassis = state.chassis;

  if (format !== "gif") {
    const canvas = drawCurrent(chassis, only);
    if (canvas) download(canvas, fileName(only), format);
    return;
  }

  // One drawing per try, cycled the way the page does, then encoded together.
  const was = state.frame;
  const frames = [];
  let size = null;
  for (let i = 0; i < suite.replicates; i++) {
    state.frame = i;
    const canvas = drawCurrent(chassis, only);
    if (!canvas) continue;
    size ??= { width: canvas.width, height: canvas.height };
    if (canvas.width !== size.width || canvas.height !== size.height) continue;
    frames.push(canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height));
  }
  state.frame = was;
  if (!frames.length) return;
  downloadBytes(encodeGIF(frames, { ...size, delay: 70 }), `${fileName(only)}.gif`, "image/gif");
}



boot();
export { state, setView, runExport, layoutFor, columnsFor, bitmapOf, entryAt, bestAt };
