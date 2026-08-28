/**
 * bitface — the panel.
 *
 * Six destinations over one cell renderer, so a face means the same thing
 * everywhere and any row or column is a fair comparison.
 *
 * `both` takes two columns, not one: that target returns a grid *and* hex which
 * can disagree, and collapsing them hides the only thing it has to say.
 */
import { compose, gridToBitmap, hexFromBitmap, hexToBitmap, svg } from "./bitmap.js";
import { download, downloadBytes, drawBlocks, drawGrid, drawInspect, drawPlate } from "./export.js";
import { encodeGIF } from "./gif.js";
import { FORMS, METHOD, OUTCOMES, OVERVIEW, PAGES, RANK, TARGETS } from "./copy.js";

const el = (id) => document.getElementById(id);
const [navEl, barEl, exportEl, suitesEl, expressionEl, targetsEl, repeatEl, chassisEl] =
  ["nav", "bar", "export", "suites", "expression", "targets", "repeat", "chassis"].map(el);
const [titleEl, introEl, detailsEl, stageEl, formatEl] = ["title", "intro", "details", "stage", "format"].map(el);

/** Which toolbar fields each destination uses. */
const CONTROLS = {
  overview: [],
  sheet: ["suites", "repeat"],
  compare: ["expression", "repeat"],
  inspect: [],
  plate: ["suites", "targets"],
  method: [],
};

/** Which of them belong in the address. Inspect filters in-page but is still linkable. */
const PARAMS = {
  overview: [],
  sheet: ["suite", "try"],
  compare: ["expr", "try"],
  inspect: ["suite", "expr", "form", "try"],
  plate: ["suite", "target"],
  method: [],
};

const state = {
  view: "overview",
  expression: null,
  target: "all",
  repeat: "all",
  frame: 0,
  chassis: true,
  form: null,
  filters: { model: "all", expression: "all", form: "all" },
};
let suite = null;
let catalogue = [];
const loaded = new Map();
let timer = null;

const DATA_VIEWS = ["sheet", "compare", "inspect", "plate"];

const label = (o) => OUTCOMES[o]?.[0] ?? o;
const formName = (t) => FORMS[t] ?? t;
const SAVE_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" ' +
  'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M8 1.5v8m0 0L5 6.5m3 3 3-3M2.5 11v2.5h11V11"/></svg>';

const chassisLabel = () => (state.chassis ? "Remove chassis" : "Add chassis");

const titleCase = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
//: Without the chassis the icon is a different picture, so the title says so.
const figureTitle = () => titleCase(state.expression) + (state.chassis ? "" : " (no chassis)");
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

/** The try on show: the animation frame, or the selected one. */
function entryAt(from, name, target) {
  const all = from.cells[name]?.[target] ?? [];
  if (!all.length) return null;
  if (state.repeat === "all") return all[state.frame % all.length];
  return all.find((e) => String(e.repeat) === state.repeat) ?? null;
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
  return `<button class="face" data-outcome="${entry.outcome}" data-suite="${esc(from.id)}"
     data-name="${esc(name)}" data-target="${column.target}" data-repeat="${entry.repeat}"
     title="${label(entry.outcome)}">${faceSVG(entry, column.form, from, scale)}</button>`;
}

function tableHTML(rows, columns, scale = 6) {
  const top = columns
    .map((c) =>
      c.split === "first"
        ? `<th colspan="2" class="split-first" title="${esc(TARGETS[c.target])}">${c.label}</th>`
        : c.split === "last"
          ? ""
          : `<th rowspan="2" title="${esc(TARGETS[c.target])}">${c.label}</th>`,
    )
    .join("");
  const sub = columns.map((c) => (c.split ? `<th class="sub split-${c.split}">${c.form}</th>` : "")).join("");
  const body = rows
    .map(
      ({ label: rl, sub: rsub, name, from }) =>
        `<tr><th class="rowhead"><span>${esc(rl)}</span>${rsub ? `<span class="dim">${esc(rsub)}</span>` : ""}</th>` +
        columns
          .map((c) => {
            const cls = ["cell", c.split && `split-${c.split}`].filter(Boolean).join(" ");
            return `<td class="${cls}">${faceButton(entryAt(from, name, c.target), c, from, name, scale)}</td>`;
          })
          .join("") +
        `</tr>`,
    )
    .join("");
  return `<table><thead><tr><th rowspan="2"></th>${top}</tr><tr>${sub}</tr></thead><tbody>${body}</tbody></table>`;
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
    ["tries per condition", String(suite.repeats)],
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

/** One model, every expression, every form: a block each. */
function renderSheet() {
  const groups = columnsFor(suite.targets).reduce((acc, c) => {
    const last = acc.at(-1);
    if (last && last.target === c.target) last.columns.push(c);
    else acc.push({ target: c.target, label: c.label, columns: [c] });
    return acc;
  }, []);

  const blocks = suite.expressions
    .map((name) => {
      const forms = groups
        .map(
          (g) =>
            `<figure><div class="pair">${g.columns
              .map((c) => faceButton(entryAt(suite, name, c.target), c, suite, name, 6))
              .join("")}</div><figcaption>${g.label}</figcaption></figure>`,
        )
        .join("");
      return `<section class="block"><h2>${esc(name)}</h2>
        <button class="snap" data-only="${esc(name)}" title="Export ${esc(name)}"
          aria-label="Export ${esc(name)}">${SAVE_ICON}</button>
        <div class="forms">${forms}</div></section>`;
    })
    .join("");
  stageEl.innerHTML = `<div class="blocks">${blocks}</div>`;
}

function renderCompare() {
  const suites = catalogue.map((s) => loaded.get(s.id)).filter(Boolean);
  const targets = [...new Set(suites.flatMap((s) => s.targets))];
  const rows = suites.map((s) => ({ label: suiteName(s), name: state.expression, from: s }));
  const forms = targets.map((t) => `<div><dt>${formName(t)}</dt><dd>${TARGETS[t]}</dd></div>`).join("");
  const outcomes = Object.entries(OUTCOMES)
    .map(([k, [name, meaning]]) => `<div data-outcome="${k}"><dt><i></i>${name}</dt><dd>${meaning}</dd></div>`)
    .join("");
  stageEl.innerHTML = `<div class="figure">
      <figure class="comparison">
        <h2>${esc(figureTitle())}</h2>${tableHTML(rows, columnsFor(targets), 8)}
      </figure>
      <aside class="key">
        <section><h3>Forms</h3><dl>${forms}</dl></section>
        <section><h3>Outcomes</h3><dl>${outcomes}</dl></section>
      </aside>
    </div>`;
}

function renderPlate() {
  const target = state.target === "all" ? suite.targets.at(-1) : state.target;
  stageEl.innerHTML = plateHTML(suite, target, bestAt);
}

/** Every attempt as a row -- model, expression, form -- beside the selected one. */
function renderInspect() {
  const rep = state.repeat === "all" ? "1" : state.repeat;
  const suites = catalogue.map((s) => loaded.get(s.id)).filter(Boolean);
  const rows = suites.flatMap((s) =>
    s.expressions.flatMap((name) => s.targets.map((target) => ({ from: s, name, target }))),
  );
  const f = state.filters;
  const shown = rows.filter(
    (r) =>
      (f.model === "all" || r.from.id === f.model) &&
      (f.expression === "all" || r.name === f.expression) &&
      (f.form === "all" || r.target === f.form),
  );

  const option = (value, text, current) =>
    `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(text)}</option>`;
  const allTargets = [...new Set(suites.flatMap((s) => s.targets))];
  const filters = `<div class="filters">
      <select id="f-model">${[option("all", "model", f.model)]
        .concat(suites.map((s) => option(s.id, suiteName(s), f.model)))
        .join("")}</select>
      <select id="f-expression">${[option("all", "expression", f.expression)]
        .concat((suites[0]?.expressions ?? []).map((n) => option(n, n, f.expression)))
        .join("")}</select>
      <select id="f-form">${[option("all", "form", f.form)]
        .concat(allTargets.map((t) => option(t, formName(t), f.form)))
        .join("")}</select>
    </div>`;

  const index = shown
    .map(({ from, name, target }) => {
      const entry = (from.cells[name]?.[target] ?? []).find((e) => String(e.repeat) === rep);
      const outcome = entry?.outcome ?? "missing";
      const current = from.id === suite.id && name === state.expression && target === state.form;
      return `<tr class="row" tabindex="0" data-suite="${esc(from.id)}" data-name="${esc(name)}"
          data-target="${target}" aria-current="${String(current)}">
          <td>${esc(suiteName(from))}</td><td class="lead">${esc(name)}</td><td>${formName(target)}</td>
          <td class="mark"><i data-outcome="${outcome}" title="${label(outcome)}"></i></td>
        </tr>`;
    })
    .join("");

  //: The tools sit with the attempt rather than in the page toolbar: this is the
  //: bench where one result is taken apart, and it will grow more of them.
  const tries = Array.from(
    { length: suite.repeats },
    (_, i) => `<option value="${i + 1}"${String(i + 1) === rep ? " selected" : ""}>try ${i + 1}</option>`,
  ).join("");
  const tools = `<div class="tools">
      <label class="field">try<select id="t-try">${tries}</select></label>
      <button id="t-chassis" type="button" class="ghost">${chassisLabel()}</button>
    </div>`;

  stageEl.innerHTML = `<div class="explorer">
      <div class="index">${filters}
        <div class="scroll"><table>
          <thead><tr><th>model</th><th>expression</th><th>form</th><th></th></tr></thead>
          <tbody>${index}</tbody>
        </table></div>
        <p class="count">${shown.length} of ${rows.length}</p></div>
      <div class="detail">${tools}${inspectPanel(rep)}</div>
    </div>`;
}

/** The selected attempt, in full. */
function inspectPanel(rep) {
  const target = state.form ?? suite.targets[0];
  const all = suite.cells[state.expression]?.[target] ?? [];
  const entry = all.find((e) => String(e.repeat) === rep) ?? all[0];
  if (!entry) return `<p class="empty">Nothing recorded for this one.</p>`;
  const forms = columnsFor([target])
    .map((c) =>
      bitmapOf(entry, c.form, suite.config)
        ? `<figure>${faceSVG(entry, c.form, suite, 14)}<figcaption>${c.form}</figcaption></figure>`
        : "",
    )
    .join("");
  return `<section class="panel" data-outcome="${entry.outcome}">
      <h3 title="${esc(TARGETS[target])}">${esc(suiteName(suite))} · ${esc(state.expression)} · ${formName(target)}
        <span class="tag">${label(entry.outcome)}</span></h3>
      <div class="big">${forms}</div>
      ${rowsTable(entry)}
      ${entry.faults.length ? `<ul class="faults">${entry.faults.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </section>`;
}

/** Row by row: the drawing, the hex it implies, the hex the model wrote. */
function rowsTable(entry) {
  const grid = entry.grid ?? entry.given_grid;
  const w = suite.config.width;
  const implied = entry.hex_from_grid ?? (grid ? hexFromBitmap(gridToBitmap(grid, w, grid.length)) : null);
  const wrote = entry.hex ?? entry.expected_hex;
  const n = Math.max(grid?.length ?? 0, wrote?.length ?? 0);
  if (!n) return "";
  const bad = new Set(entry.differing_rows ?? []);
  const head = ["", grid && "grid", implied && "from grid", wrote && "hex"].filter(Boolean);
  const body = Array.from({ length: n }, (_, y) => {
    const cells = [`<td class="n">${y}</td>`];
    if (grid) cells.push(`<td>${esc(grid[y] ?? "")}</td>`);
    if (implied) cells.push(`<td>${esc(implied[y] ?? "")}</td>`);
    if (wrote) cells.push(`<td>${esc(wrote[y] ?? "")}</td>`);
    return `<tr${bad.has(y) ? ' class="bad"' : ""}>${cells.join("")}</tr>`;
  }).join("");
  return `<table class="rows"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

// --------------------------------------------------------------------------- chrome

function renderChrome() {
  const page = PAGES[state.view];
  titleEl.textContent = page.title;
  introEl.textContent = page.intro;
  barEl.toggleAttribute("hidden", CONTROLS[state.view].length === 0);
  //: Nothing to save on a prose page.
  exportEl.toggleAttribute("hidden", !DATA_VIEWS.includes(state.view));

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
          ["tries", String(suite.repeats)],
        ];
  detailsEl.toggleAttribute("hidden", rows.length === 0);
  detailsEl.innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");

  chassisEl.textContent = chassisLabel();
}

function render() {
  if (!suite) return;
  renderChrome();
  ({
    overview: renderOverview,
    method: renderMethod,
    sheet: renderSheet,
    compare: renderCompare,
    inspect: renderInspect,
    plate: renderPlate,
  })[state.view]();
  wire();
}

function wire() {
  for (const b of stageEl.querySelectorAll?.(".face") ?? []) {
    b.onclick = () => {
      state.expression = b.dataset.name;
      state.form = b.dataset.target;
      suite = loaded.get(b.dataset.suite) ?? suite;
      if (state.repeat !== "all") state.repeat = b.dataset.repeat;
      setView("inspect");
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
  const tryEl = el("t-try");
  if (tryEl)
    tryEl.onchange = () => {
      state.repeat = tryEl.value;
      render();
      writeHash(false);
    };
  const chassisToggle = el("t-chassis");
  if (chassisToggle)
    chassisToggle.onclick = () => {
      state.chassis = !state.chassis;
      render();
      writeHash(false);
    };
  for (const b of stageEl.querySelectorAll?.(".snap") ?? []) {
    b.onclick = (event) => {
      event.stopPropagation?.();
      runExport(b.dataset.only);
    };
  }
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
  const used = CONTROLS[state.view];
  for (const [id, node] of [["suites", suitesEl], ["expression", expressionEl], ["targets", targetsEl], ["repeat", repeatEl]]) {
    node.closest?.(".field")?.toggleAttribute("hidden", !used.includes(id));
  }
  for (const tab of navEl.querySelectorAll?.("[data-view]") ?? []) {
    tab.setAttribute("aria-selected", String(tab.dataset.view === state.view));
  }
}

/** "all" cycles the tries in place, so variance reads as movement. */
function setTimerFor(mode) {
  if (timer) clearInterval(timer);
  timer = null;
  if (mode !== "all") return;
  timer = setInterval(() => {
    state.frame++;
    render();
  }, 700);
}

/** The cycle exports as a GIF; a single try exports as a still. */
function syncFormats() {
  const animated = state.repeat === "all";
  const options = animated ? [["gif", "GIF"]] : [["png", "PNG"], ["jpeg", "JPEG"]];
  const keep = formatEl.value;
  formatEl.innerHTML = options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  formatEl.value = options.some(([v]) => v === keep) ? keep : options[0][0];
}

function fillExpressions() {
  const names = suite?.expressions ?? [];
  expressionEl.innerHTML = names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  state.expression = names.includes(state.expression) ? state.expression : names[0];
  expressionEl.value = state.expression;
}

function fillTargets() {
  const targets = suite?.targets ?? [];
  const all = state.view === "plate" ? "" : `<option value="all">all forms</option>`;
  targetsEl.innerHTML = all + targets.map((t) => `<option value="${t}">${formName(t)}</option>`).join("");
  if (state.view === "plate" && state.target === "all") state.target = targets.at(-1) ?? "all";
  if (![...targetsEl.options].some((o) => o.value === state.target)) state.target = targetsEl.options[0]?.value ?? "all";
  targetsEl.value = state.target;
}

function fillRepeats() {
  const n = state.view === "compare" ? Math.min(...[...loaded.values()].map((s) => s.repeats)) : suite.repeats;
  const keep = state.repeat;
  repeatEl.innerHTML =
    Array.from({ length: n }, (_, i) => `<option value="${i + 1}">try ${i + 1}</option>`).join("") +
    (n > 1 && state.view !== "inspect" ? `<option value="all">all ${n}</option>` : "");
  const has = (v) => [...repeatEl.options].some((o) => o.value === v);
  state.repeat = has(keep) ? keep : has("all") ? "all" : "1";
  repeatEl.value = state.repeat;
  setTimerFor(state.repeat);
  syncFormats();
}

async function setView(next, { push = true } = {}) {
  state.view = next;
  applyChrome();
  if (next === "compare" || next === "inspect") await Promise.all(catalogue.map((s) => fetchSuite(s.id)));
  fillExpressions();
  fillTargets();
  fillRepeats();
  state.form = suite.targets.includes(state.form) ? state.form : suite.targets[0];
  render();
  writeHash(push);
}

// --------------------------------------------------------------------------- address
//
// The view is the route; everything else is a parameter. A view change earns a
// history entry and a control change does not, so Back moves between views
// rather than undoing a dropdown, and any state is a shareable link.

function writeHash(push) {
  const wanted = PARAMS[state.view];
  const params = new URLSearchParams();
  if (wanted.includes("suite")) params.set("suite", suite.id);
  if (wanted.includes("expr")) params.set("expr", state.expression);
  if (wanted.includes("form")) params.set("form", state.form ?? suite.targets[0]);
  if (wanted.includes("target")) params.set("target", state.target);
  if (wanted.includes("try")) params.set("try", state.repeat);
  if (!state.chassis) params.set("chassis", "0");
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
  state.repeat = params.get("try") ?? "all";
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
  fillRepeats();
  render();
}

async function boot() {
  catalogue = await fetch("/api/suites").then((r) => r.json());
  if (!catalogue.length) {
    stageEl.innerHTML = `<p class="empty">No runs yet — <code>bitface suite</code>.</p>`;
    return;
  }
  suitesEl.innerHTML = catalogue.map((s) => `<option value="${esc(s.id)}">${esc(suiteName(s))}</option>`).join("");
  suitesEl.onchange = () => load(suitesEl.value).then(() => writeHash(false));
  expressionEl.onchange = () => {
    state.expression = expressionEl.value;
    render();
    writeHash(false);
  };
  targetsEl.onchange = () => {
    state.target = targetsEl.value;
    render();
    writeHash(false);
  };
  repeatEl.onchange = () => {
    state.repeat = repeatEl.value;
    setTimerFor(state.repeat);
    syncFormats();
    render();
    writeHash(false);
  };
  navEl.onclick = (event) => {
    const view = event.target?.dataset?.view;
    if (view) setView(view);
  };
  chassisEl.onclick = () => {
    state.chassis = !state.chassis;
    render();
    writeHash(false);
  };
  addEventListener("hashchange", readHash);
  await load(catalogue[0].id);
  await readHash();
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// --------------------------------------------------------------------------- export

/** Draw the current view once, at whichever try `state.frame` is on. */
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

  if (state.view === "inspect") {
    const rep = state.repeat === "all" ? "1" : state.repeat;
    const panels = [state.form ?? suite.targets[0]]
      .map((target) => {
        const all = suite.cells[state.expression]?.[target] ?? [];
        const entry = all.find((e) => String(e.repeat) === rep) ?? all[0];
        if (!entry) return null;
        const forms = columnsFor([target])
          .map((c) => ({ label: c.form, bitmap: bitmapOf(entry, c.form, suite.config) }))
          .filter((f) => f.bitmap);
        return forms.length
          ? { target: formName(target), outcome: label(entry.outcome), forms, hex: entry.hex, bad: new Set(entry.differing_rows ?? []) }
          : null;
      })
      .filter(Boolean);
    if (!panels.length) return null;
    return drawInspect({ panels, config: suite.config, chassis });
  }

  if (state.view === "sheet") {
    const groups = columnsFor(suite.targets).reduce((acc, c) => {
      const last = acc.at(-1);
      if (last && last.target === c.target) last.columns.push(c);
      else acc.push({ target: c.target, label: c.label, columns: [c] });
      return acc;
    }, []);
    const wanted = only ? [only] : suite.expressions;
    const blocks = wanted.map((name) => ({
      label: name,
      groups: groups.map((g) => ({
        label: g.label,
        bitmaps: g.columns.map((c) => bitmapOf(entryAt(suite, name, c.target), c.form, suite.config)),
      })),
    }));
    return drawBlocks({ blocks, config: suite.config, chassis, across: only ? 1 : 2 });
  }

  const targets = [...new Set(suites.flatMap((s) => s.targets))];
  return drawGrid({
    rows: suites.map((s) => ({ label: suiteName(s), name: state.expression, from: s })),
    columns: columnsFor(targets),
    config: suite.config,
    chassis,
    legend: {
      forms: targets.map((t) => [formName(t), TARGETS[t]]),
      outcomes: Object.entries(OUTCOMES).map(([k, [name, meaning]]) => ({ key: k, name, meaning })),
    },
    heading: figureTitle(),
    cellFor: (row, column) => bitmapOf(entryAt(row.from, row.name, column.target), column.form, row.from.config),
  });
}

const fileName = (only = null) => {
  if (only) return `${suite.id}-${only}`;
  return (
    {
      plate: `${suite.id}-plate`,
      inspect: `${suite.id}-${state.expression}-${formName(state.form ?? suite.targets[0])}`,
      compare: `compare-${state.expression}`,
    }[state.view] ?? suite.id
  );
};

/** Save what is on screen, or just one block of it. */
function runExport(only = null) {
  const format = formatEl.value;
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
  for (let i = 0; i < suite.repeats; i++) {
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

el("save").onclick = () => runExport();

boot();
export { state, setView, runExport, columnsFor, bitmapOf, entryAt, bestAt };
