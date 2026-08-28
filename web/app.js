/**
 * The panel's client. Pick a condition, pick an expression, see every repeat.
 *
 * Organised around conditions rather than runs. Repeats of one cell are the
 * same experiment run again, so the interesting view is all of them at once:
 * a face that agreed twice and failed once is a different result from one that
 * agreed three times, and a list of separate runs cannot show that.
 *
 * Shapes come from bitmap_face/schema.py -- read that for what a record holds.
 */
import { compose, gridToBitmap, hexToBitmap, svg } from "./bitmap.js";

const runsEl = document.getElementById("runs");
const paramsEl = document.getElementById("params");
const facesEl = document.getElementById("faces");
const detailEl = document.getElementById("detail");

let current = null; // { slug, condition, runs: [...] }
let names = []; // expression names, in the order the run asked for them
let selected = 0;

function state(a) {
  if (!a) return "missing";
  if (a.missing) return "missing";
  if (!a.well_formed) return "malformed";
  if (a.agrees === true) return "agrees";
  if (a.agrees === false) return "differs";
  return "drawn";
}

const MARK = { agrees: "✓", differs: "✗", malformed: "!", missing: "·", drawn: "•" };

const VERDICT = {
  missing: () => "never came back",
  malformed: (a) => `malformed — ${a.faults.length} fault${a.faults.length === 1 ? "" : "s"}`,
  agrees: (a) => (a.expected_hex ? "matches the known hex" : "grid and hex agree"),
  differs: (a) => {
    const n = a.differing_rows.length;
    return n === 1 ? "1 row differs" : `${n} rows differ`;
  },
  drawn: () => "one form only — nothing to compare",
};

const pct = (v) => (v === null || v === undefined ? "n/a" : `${Math.round(v * 100)}%`);

/** The call within a run that covered this expression. */
function callFor(run, name) {
  return run.calls.find((c) => c.expressions.includes(name)) ?? run.calls[0] ?? null;
}

/** A disclosure holding text sent to the model, collapsed by default. */
function prompt(label, text) {
  if (!text) return "";
  const size = `${text.length.toLocaleString()} chars`;
  return `<details class="prompt"><summary>${label} <span>${size}</span></summary><pre>${escape(text)}</pre></details>`;
}

/** Every repeat's attempt at one expression, in repeat order. */
const attemptsFor = (name) =>
  current.runs.map((run) => run.attempts.find((a) => a.expression === name) ?? null);

async function loadConditions() {
  const conditions = await fetch("/api/conditions").then((r) => r.json());
  if (!conditions.length) {
    detailEl.innerHTML = `<p class="empty">No runs in data/runs yet.</p>`;
    return;
  }
  runsEl.innerHTML = conditions
    .map((c, i) => {
      const spread =
        c.rate === null
          ? "n/a"
          : c.rate.min === c.rate.max
            ? pct(c.rate.mean)
            : `${pct(c.rate.mean)} (${pct(c.rate.min)}–${pct(c.rate.max)})`;
      const reps = c.repeats === 1 ? "" : ` · ${c.repeats}×`;
      return `<option value="${c.slug}"${i === 0 ? " selected" : ""}>${c.slug}${reps} · ${spread}</option>`;
    })
    .join("");
  runsEl.onchange = () => loadCondition(runsEl.value);
  await loadCondition(conditions[0].slug);
}

async function loadCondition(slug) {
  current = await fetch(`/api/conditions/${encodeURIComponent(slug)}`).then((r) => r.json());
  selected = 0;
  names = current.runs[0].attempts.map((a) => a.expression);

  const c = current.condition;
  const runs = current.runs;
  const rates = runs.map((r) => r.totals.agreement_rate).filter((v) => v !== null);
  const mean = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  const totals = (key) => runs.reduce((n, r) => n + (r.totals[key] ?? 0), 0);

  paramsEl.textContent = [
    c.model,
    `target ${c.target}`,
    `batch ${c.batch}`,
    `${c.references} ref`,
    c.context ? `ctx ${c.context}` : null,
    c.effort ? `effort ${c.effort}` : null,
    `${runs.length} repeat${runs.length === 1 ? "" : "s"}`,
    `${totals("well_formed")}/${totals("returned")} formed`,
    `${totals("agreed")}/${totals("measurable")} agreed (${pct(mean)})`,
    totals("thinking_tokens") ? `${totals("thinking_tokens").toLocaleString()} thinking tok` : null,
    `${Math.round(totals("duration_seconds"))}s`,
  ]
    .filter(Boolean)
    .join("  ·  ");

  renderList();
  renderDetail();
}

function gridOf(a, W, H) {
  if (!a) return Array.from({ length: H }, () => Array(W).fill(0));
  if (a.grid) return gridToBitmap(a.grid, W, H);
  if (a.given_grid) return gridToBitmap(a.given_grid, W, H);
  if (a.hex) return hexToBitmap(a.hex, W, H);
  return Array.from({ length: H }, () => Array(W).fill(0));
}

function renderList() {
  const c = current.condition;
  facesEl.innerHTML = names
    .map((name, i) => {
      const across = attemptsFor(name);
      const agreed = across.filter((a) => a?.agrees === true).length;
      const measurable = across.filter((a) => a && a.agrees !== null).length;
      // One mark per repeat: the distribution, at a glance, in the list itself.
      const marks = across.map((a) => `<i class="m ${state(a)}">${MARK[state(a)]}</i>`).join("");
      const thumb = svg(gridOf(across[0], c.width, c.height), { scale: 2 });
      const worst = across.some((a) => state(a) !== "agrees") ? "differs" : "agrees";
      return `<button data-i="${i}" aria-current="${i === selected}">
        <span class="dot ${measurable ? worst : "drawn"}"></span>${thumb}
        <span class="name">${escape(name)}</span>
        <span class="marks">${marks}</span>
        ${measurable > 1 ? `<span class="score">${agreed}/${measurable}</span>` : ""}
      </button>`;
    })
    .join("");
  for (const button of facesEl.querySelectorAll("button")) {
    button.onclick = () => {
      selected = Number(button.dataset.i);
      renderList();
      renderDetail();
    };
  }
}

function renderDetail() {
  const c = current.condition;
  const { width: W, height: H } = c;
  const name = names[selected];
  const across = attemptsFor(name);

  const cards = across
    .map((a, i) => {
      if (!a) return "";
      const bands = a.differing_rows ?? [];
      const views = [];
      if (a.given_grid) views.push(["given", gridToBitmap(a.given_grid, W, H)]);
      if (a.grid) views.push(["drawn", gridToBitmap(a.grid, W, H)]);
      if (a.hex) views.push(["written", hexToBitmap(a.hex, W, H)]);

      const panes = views
        .map(([label, bm]) => `<div class="view"><span>${label}</span>${svg(bm, { scale: 7, bands })}</div>`)
        .join("");
      const chassis = `<div class="view"><span>chassis</span>${svg(compose(gridOf(a, W, H)), { scale: 4 })}</div>`;
      const want = a.hex_from_grid ?? a.expected_hex ?? null;
      const rows = bands.length
        ? `<table><thead><tr><th>row</th><th>wrote</th><th>should be</th></tr></thead><tbody>${bands
            .map(
              (y) =>
                `<tr data-differs="true"><td>${y}</td><td>${escape(a.hex?.[y] ?? "—")}</td>` +
                `<td class="want">${want ? escape(want[y]) : ""}</td></tr>`,
            )
            .join("")}</tbody></table>`
        : "";
      const faults = a.faults?.length
        ? `<ul class="faults">${a.faults.map((f) => `<li>${escape(f)}</li>`).join("")}</ul>`
        : "";

      // Numbered by position in the condition, not by the record's own
      // `repeat`: that counter restarts at 1 on every invocation, so three
      // separate runs of one cell all call themselves repeat 1.
      const when = new Date(current.runs[i].started_at).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
      const call = callFor(current.runs[i], name);
      return `<section class="repeat" data-state="${state(a)}">
        <h3>run ${i + 1} of ${current.runs.length} <span class="when">${when}</span>
          <span class="verdict ${state(a)}">${VERDICT[state(a)](a)}</span></h3>
        <div class="views">${panes}${chassis}</div>
        ${rows}${faults}
        ${prompt("user prompt", call?.prompt)}
      </section>`;
    })
    .join("");

  const measurable = across.filter((a) => a && a.agrees !== null).length;
  const agreed = across.filter((a) => a?.agrees === true).length;
  const score = measurable > 1 ? ` <span class="tier">${agreed}/${measurable} agreed</span>` : "";

  // The system prompt depends only on the condition, so it is shown once.
  const system = current.runs[0]?.prompts?.system;
  detailEl.innerHTML =
    `<h2>${escape(name)} <span class="tier">${escape(across.find(Boolean)?.tier ?? "")}</span>${score}</h2>` +
    prompt("system prompt", system) +
    cards;
}

function escape(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

document.addEventListener("keydown", (event) => {
  if (!current) return;
  if (event.key === "j" || event.key === "ArrowDown") selected = (selected + 1) % names.length;
  else if (event.key === "k" || event.key === "ArrowUp") selected = (selected - 1 + names.length) % names.length;
  else return;
  event.preventDefault();
  renderList();
  renderDetail();
});

loadConditions();
