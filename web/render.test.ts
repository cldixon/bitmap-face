/**
 * The panel renders, against real run records.
 *
 * app.js only runs in a browser, and a mistake there fails quietly -- an empty
 * page looks a lot like a suite with no data. This gives it enough of a DOM to
 * load against the live server and checks that each destination puts what it
 * claims on the page.
 *
 *   bun test web/        (needs `bun run panel` on :4400)
 */
import { expect, test } from "bun:test";
import { FORM_BRIEF, FORM_FILTERS, OUTCOMES, QUAD } from "./copy.js";

type Stub = Record<string, any>;

function element(): Stub {
  const node: Stub = {
    innerHTML: "",
    textContent: "",
    value: "",
    hiddenAttr: false,
    fieldHidden: false,
    classes: new Set<string>(),
    onchange: null,
    onclick: null,
    get options() {
      return [...String(node.innerHTML).matchAll(/value="([^"]*)"/g)].map((m) => ({ value: m[1] }));
    },
    classList: {
      toggle: (name: string, on: boolean) => (on ? node.classes.add(name) : node.classes.delete(name)),
    },
    checked: false,
    toggleAttribute: (name: string, on: boolean) => {
      if (name === "hidden") node.hiddenAttr = on;
    },
    setAttribute: () => {},
    // The wrapping <label class="field"> is what gets hidden; record it here so
    // a test can see that it happened.
    closest: (sel: string) =>
      sel === ".field"
        ? { toggleAttribute: (_a: string, on: boolean) => (node.fieldHidden = on) }
        : null,
    querySelectorAll: (sel: string) => {
      const want = sel.replace(/^\./, "").replace(/^\[|\]$/g, "");
      // Parse whole tags, so a matched element carries its data- attributes and
      // a wiring test exercises the same lookup the browser would.
      const tags = [...String(node.innerHTML).matchAll(/<[a-z0-9]+\b[^>]*>/gi)].map((m) => m[0]);
      const build = (tag: string) => ({
        onclick: null,
        onchange: null,
        onkeydown: null,
        checked: /\schecked\b/.test(tag),
        dataset: Object.fromEntries(
          [...tag.matchAll(/data-([\w-]+)="([^"]*)"/g)].map((d) => [
            d[1].replace(/-(\w)/g, (_, c) => c.toUpperCase()),
            d[2],
          ]),
        ),
        setAttribute: () => {},
      });
      // Matches must be stable for the life of a render, or the app wires a
      // handler onto one object and a test reads a different one.
      if (node.memoFor !== node.innerHTML) {
        node.memoFor = node.innerHTML;
        node.memo = new Map<string, Stub[]>();
      }
      if (node.memo.has(sel)) return node.memo.get(sel);
      const byClass = tags.filter((t) => (t.match(/class="([^"]*)"/)?.[1] ?? "").split(" ").includes(want));
      const found = (byClass.length ? byClass : tags.filter((t) => t.includes(`${want}=`))).map(build);
      node.memo.set(sel, found);
      return found;
    },
    memo: new Map<string, Stub[]>(),
    memoFor: null,
    scrollTop: 0,
    querySelector: (sel: string) =>
      sel === ".scroll" && String(node.innerHTML).includes('class="scroll"') ? node.scrollBox : null,
    scrollBox: { scrollTop: 0 },
    click: () => {},
    scrollIntoView: () => {},
  };
  return node;
}

const nodes = new Map<string, Stub>();
const painted: Stub[] = [];
const blobs: Stub[] = [];

function canvas(): Stub {
  const calls: Stub = { rects: 0, strokes: 0, texts: [] as string[] };
  const node: Stub = {
    width: 0,
    height: 0,
    calls,
    getContext: () => ({
      set fillStyle(_v: string) {},
      set strokeStyle(_v: string) {},
      set globalAlpha(_v: number) {},
      set font(_v: string) {},
      set textAlign(_v: string) {},
      set textBaseline(_v: string) {},
      fillRect: () => calls.rects++,
      strokeRect: () => calls.strokes++,
      fillText: (t: string) => calls.texts.push(t),
      measureText: (t: string) => ({ width: String(t).length * 9 }),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(255),
      }),
    }),
    toBlob: () => {},
  };
  painted.push(node);
  return node;
}

(globalThis as any).document = {
  getElementById(id: string) {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  },
  createElement: (tag: string) => (tag === "canvas" ? canvas() : element()),
};
(globalThis as any).location = { hash: "", pathname: "/" };
(globalThis as any).history = {
  pushState: (_s: unknown, _t: string, url: string) => {
    (globalThis as any).location.hash = url.slice(url.indexOf("#"));
  },
  replaceState: (_s: unknown, _t: string, url: string) => {
    (globalThis as any).location.hash = url.slice(url.indexOf("#"));
  },
};
(globalThis as any).addEventListener = () => {};
const copied: string[] = [];
(globalThis as any).navigator = { clipboard: { writeText: async (t: string) => copied.push(t) } };
(globalThis as any).Blob = class {
  constructor(parts: unknown[], opts: Stub) {
    blobs.push({ parts, type: opts?.type });
  }
};
(globalThis as any).URL.createObjectURL = () => "blob:x";
(globalThis as any).URL.revokeObjectURL = () => {};
(globalThis as any).getComputedStyle = () => ({
  backgroundColor: "#fff",
  color: "#000",
  getPropertyValue: () => "#666",
});

const base = "http://localhost:4400";
const real = globalThis.fetch;
(globalThis as any).fetch = (url: string, init?: any) => real(url.startsWith("http") ? url : base + url, init);

await import("./app.js");
await new Promise((r) => setTimeout(r, 400));

const stage = () => String(nodes.get("stage")!.innerHTML);
const hidden = (id: string) => Boolean(nodes.get(id)!.fieldHidden);
const VIEWS = ["overview", "matrix", "index", "plate", "method"];

/** One module instance is shared, so every test states what it needs. */
async function goto(view: string) {
  const { setView } = await import("./app.js");
  await setView(view);
}

/** The matrix, with its facets set explicitly. */
async function matrix(narrow: Record<string, string> = {}) {
  const { setView, state } = await import("./app.js");
  state.narrow = { model: "all", expression: [], form: "all", ...narrow };
  state.replicate = "1";
  await setView("matrix");
}

const el = (id: string) => nodes.get(id)!;
const suiteIds = async () => (await fetch("/api/suites").then((r) => r.json())).map((s: Stub) => s.id);

// --------------------------------------------------------------------------- chrome

test("the nav holds exactly the destinations that exist", async () => {
  const html = await Bun.file(new URL("./index.html", import.meta.url)).text();
  for (const view of VIEWS) expect(html).toContain(`data-view="${view}"`);
  expect((html.match(/data-view="/g) ?? []).length).toBe(VIEWS.length);
  // The pages the matrix replaced are gone, not merely unlinked.
  for (const gone of ["sheet", "compare", "expressions", "cross"]) {
    expect(html).not.toContain(`data-view="${gone}"`);
  }
});

test("every destination states what it is showing", async () => {
  for (const view of VIEWS) {
    await goto(view);
    expect(String(nodes.get("title")!.textContent).length).toBeGreaterThan(3);
    expect(String(nodes.get("intro")!.textContent).length).toBeGreaterThan(30);
  }
});

test("prose destinations offer no controls and nothing to export", async () => {
  for (const view of ["overview", "method"]) {
    await goto(view);
    expect(Boolean(nodes.get("bar")!.hiddenAttr)).toBe(true);
    expect(Boolean(nodes.get("export")!.hiddenAttr)).toBe(true);
    expect(stage()).toContain('class="prose"');
  }
});

test("a page shows the control bar only if it has nowhere better", async () => {
  // Plate has neither key nor bench, so it uses the bar.
  await goto("plate");
  expect(Boolean(nodes.get("bar")!.hiddenAttr)).toBe(false);
  // Matrix puts every control in its key; the index puts them on its bench.
  for (const view of ["matrix", "index"]) {
    await goto(view);
    expect(Boolean(nodes.get("bar")!.hiddenAttr)).toBe(true);
  }
});

test("the matrix key carries every control the page has", async () => {
  await matrix();
  const aside = stage().split('class="key"')[1];
  for (const id of ["k-model", "k-form", "k-replicate"]) expect(aside).toContain(`id="${id}"`);
  // Expression is a set, so it is offered as toggles rather than a select.
  expect((aside.match(/class="chip"/g) ?? []).length).toBe(12);
  expect(aside).toContain('class="mark"');
  expect(aside).toContain("desktop chassis");
  // Nothing is left duplicated in the bar above.
  expect(Boolean(nodes.get("bar")!.hiddenAttr)).toBe(true);

  // Each one drives the same state the bar used to.
  const { state } = await import("./app.js");
  const model = el("k-model");
  const [first] = await suiteIds();
  model.value = first;
  model.onchange();
  expect(state.narrow.model).toBe(first);
  expect(location.hash).toContain(`model=${first}`);
  await matrix();
});

test("method carries the technical record and the definitions", async () => {
  await goto("method");
  const html = stage();
  for (const key of ["references", "copy directive", "replicates per condition"]) {
    expect(html).toContain(`>${key}<`);
  }
  for (const key of Object.keys(OUTCOMES)) expect(html).toContain(`data-outcome="${key}"`);
  for (const form of ["grid", "hex", "combined"]) expect(html).toContain(`<dt>${form}</dt>`);
});

test("only the plate carries a details strip", async () => {
  for (const view of ["matrix", "index", "overview", "method"]) {
    await goto(view);
    expect(Boolean(nodes.get("details")!.hiddenAttr)).toBe(true);
  }
  await goto("plate");
  expect(Boolean(nodes.get("details")!.hiddenAttr)).toBe(false);
});

// --------------------------------------------------------------------------- matrix

test("the matrix puts every parameter on one page", async () => {
  await matrix();
  const html = stage();
  expect((html.match(/class="rowhead"/g) ?? []).length).toBe(12);
  for (const model of ["haiku", "sonnet", "opus"]) {
    expect(html).toMatch(new RegExp(`class="pin" data-model="[^"]*">${model}`));
  }
  expect((html.match(/class="quad"/g) ?? []).length).toBe(36);
});

test("each cell holds all four written outputs, in a fixed order", async () => {
  await matrix();
  const html = stage();
  const faces = (html.match(/class="face"/g) ?? []).length;
  const voids = (html.match(/class="void"/g) ?? []).length;
  expect(faces + voids).toBe(36 * QUAD.length);

  const quad = html.split('class="quad"')[1].split("</div>")[0];
  expect([...quad.matchAll(/data-target="(\w+)"/g)].map((m) => m[1])).toEqual([
    "grid_only",
    "hex_only",
    "both",
    "both",
  ]);
});

test("narrowing a facet removes rows, columns, or the inside of a cell", async () => {
  await matrix();
  expect((stage().match(/class="quad"/g) ?? []).length).toBe(36);

  await matrix({ expression: ["happy"] });
  expect((stage().match(/class="quad"/g) ?? []).length).toBe(3);

  await matrix({ form: "grid_only" });
  expect((stage().match(/class="quad"/g) ?? []).length).toBe(36);
  expect(stage()).toContain("--across:1");
  expect((stage().match(/class="face"/g) ?? []).length).toBe(36);
});

test("the form facet drills down to either half of the combined answer", async () => {
  await matrix();
  const offered = String(nodes.get("targets")!.innerHTML);
  for (const [value, label] of FORM_FILTERS) {
    expect(offered).toContain(`value="${value}"`);
    expect(offered).toContain(label);
  }

  for (const form of ["both:grid", "both:hex"]) {
    await matrix({ form });
    expect(stage()).toContain("--across:1");
    expect((stage().match(/class="face"/g) ?? []).length).toBe(36);
    const quad = stage().split('class="quad"')[1].split("</div>")[0];
    expect([...quad.matchAll(/data-target="(\w+)"/g)].map((m) => m[1])).toEqual(["both"]);
  }

  await matrix({ form: "both" });
  expect(stage()).toContain("--across:2");
  expect((stage().match(/class="face"/g) ?? []).length).toBe(72);
});

test("drilling every facet down reaches one icon", async () => {
  const [first] = await suiteIds();
  await matrix({ model: first, expression: ["happy"], form: "both:hex" });
  expect((stage().match(/class="quad"/g) ?? []).length).toBe(1);
  expect((stage().match(/class="face"/g) ?? []).length).toBe(1);
});

test("one model wraps into blocks instead of a tall single column", async () => {
  const [first] = await suiteIds();
  await matrix({ model: first });
  const html = stage();
  expect(html).not.toContain('class="matrix"');
  expect(html).toContain("blocks cells");
  expect((html.match(/class="block"/g) ?? []).length).toBe(12);
  expect(html).toMatch(/class="pin" data-expr="happy"/);

  await matrix();
  expect(stage()).toContain('class="matrix"');
});

test("headings narrow to themselves, and one control puts it all back", async () => {
  const { state } = await import("./app.js");
  await matrix();
  // Nothing above the figure: the key already shows what is selected.
  expect(stage()).not.toContain('class="narrowed"');
  expect(stage()).not.toContain('class="crumb"');
  // Reset is present but has nothing to do.
  expect(stage()).toMatch(/id="k-reset"[^>]*disabled/);

  await matrix({ expression: ["sad"], form: "hex_only" });
  expect(stage()).not.toMatch(/id="k-reset"[^>]*disabled/);
  expect(stage()).toMatch(/class="pin" data-model="/);

  el("k-reset").onclick();
  expect(state.narrow).toEqual({ model: "all", expression: [], form: "all" });
  expect(location.hash).not.toContain("expr=");
  expect(location.hash).not.toContain("form=");
});

test("a narrowed view is a link, an unfiltered one carries no clutter", async () => {
  await matrix();
  expect(location.hash).toStartWith("#/matrix");
  expect(location.hash).not.toContain("model=");
  expect(location.hash).not.toContain("expr=");

  await matrix({ expression: ["wink"], form: "hex_only" });
  expect(location.hash).toContain("expr=wink");
  expect(location.hash).toContain("form=hex_only");
});

const faceWidth = () => Number(stage().match(/<svg viewBox="[^"]*" width="(\d+)"/)?.[1] ?? 0);

test("freeing width makes the faces bigger", async () => {
  await matrix();
  const dense = faceWidth();
  expect(dense).toBeGreaterThan(0);

  // A single form halves how many faces sit across a cell, so each can grow.
  await matrix({ form: "grid_only" });
  expect(faceWidth()).toBeGreaterThan(dense);

  // `combined` is still two across, so it is the same width as the full quad --
  // filtering it removes rows, not columns.
  await matrix({ form: "both" });
  expect(faceWidth()).toBe(dense);
});

test("the solved layout never asks for more width than there is", async () => {
  const { layoutFor, state } = await import("./app.js");
  // 280 for the key and its gap, matching the stylesheet.
  const avail = Math.max(360, 1200 - 280);
  const drawn = (scale: number) => (state.chassis ? 32 * Math.max(2, Math.round(scale / 2)) : 16 * scale);
  for (const columns of [1, 2, 3]) {
    for (const across of [1, 2]) {
      const { scale } = layoutFor({ columns, across, ribbon: false });
      expect(scale).toBeGreaterThanOrEqual(4);
      const content = 112 + columns * (across * drawn(scale) + 2 + 10 + 20);
      // The floor can overflow a very narrow case; anything above it must fit.
      if (scale > 4) expect(content).toBeLessThanOrEqual(avail);
    }
  }
});

test("one model wraps into as many blocks as the width allows", async () => {
  const { layoutFor } = await import("./app.js");
  // A single-face cell packs more per line than a 2x2 one.
  const wide = layoutFor({ columns: 1, across: 1, ribbon: true });
  const square = layoutFor({ columns: 1, across: 2, ribbon: true });
  expect(wide.min).toBeLessThan(square.min);
  expect(wide.min).toBeGreaterThan(0);

  const [first] = await suiteIds();
  await matrix({ model: first });
  // The wrap width is handed to the grid, rather than guessed in the stylesheet.
  expect(stage()).toMatch(/class="blocks cells" style="--min:\d+px"/);
});

test("the form is stated once: a control, over a diagram that describes itself", async () => {
  await matrix();
  const aside = stage().split('class="key"')[1];
  expect(aside).toBeDefined();

  // One control, one diagram, and the descriptions live inside the diagram.
  expect(aside).toContain('id="k-form"');
  expect(aside).toContain('class="quadkey"');
  for (const [value, label] of FORM_FILTERS) {
    expect(aside).toContain(`value="${value}"`);
    expect(aside).toContain(`>${label}<`);
  }
  for (const v of ["grid_only", "hex_only", "both:grid", "both:hex"]) {
    expect(aside).toContain(FORM_BRIEF[v]);
  }
  // Not also repeated as a separate definition list beneath it.
  expect(aside).not.toContain("<h3>Forms</h3>");
  expect(aside.match(/drawn as a character grid/g)!.length).toBe(1);
  expect(stage()).not.toContain("<figcaption>");

  // And the top bar no longer carries a second copy of the same choice.
  expect(hidden("targets")).toBe(true);
});

test("narrowing the form replaces the diagram with one line", async () => {
  await matrix({ form: "grid_only" });
  let aside = stage().split('class="key"')[1];
  expect(aside).not.toContain('class="quadkey"');
  expect(aside).toContain(FORM_BRIEF.grid_only);
  expect(aside).toContain('id="k-form"');

  // The pair keeps a diagram, since it still has two positions to explain.
  await matrix({ form: "both" });
  aside = stage().split('class="key"')[1];
  expect(aside).toContain('class="quadkey"');
  const table = aside.split('class="quadkey"')[1].split("</table>")[0];
  expect((table.match(/<td>/g) ?? []).length).toBe(2);
  expect([...table.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1])).toEqual([
    "grid-combined",
    "hex-combined",
  ]);
});

test("the chassis switch is the last thing in the key", async () => {
  await matrix();
  const { state } = await import("./app.js");
  const aside = stage().split('class="key"')[1];
  expect(aside).toContain('class="check last"');
  expect(aside.indexOf("chassis")).toBeGreaterThan(aside.indexOf("<h3>Outcomes</h3>"));

  const box = nodes.get("stage")!.querySelectorAll(".chassis-check")[0];
  expect(box).toBeDefined();
  expect(box.checked).toBe(true);
  box.checked = false;
  box.onchange();
  expect(state.chassis).toBe(false);
  box.checked = true;
  box.onchange();
});

// --------------------------------------------------------------------------- marks

test("the key is the control: each mark switches where its swatch was", async () => {
  const { state } = await import("./app.js");
  await matrix();
  try {
    const aside = stage().split('class="key"')[1].split('class="check last"')[0];
    // Only the outcomes a reader can switch, each carrying its own control.
    expect(aside).toMatch(/data-outcome="malformed"><dt><input type="checkbox" class="mark"/);
    expect(aside).toMatch(/data-outcome="differs"><dt><input type="checkbox" class="mark"/);
    expect((aside.match(/class="mark"/g) ?? []).length).toBe(2);
    expect((aside.match(/data-outcome=/g) ?? []).length).toBe(2);
    // A valid face and a missing one have no colour to withhold.
    for (const gone of ["agrees", "missing", "drawn"]) {
      expect(aside).not.toContain(`data-outcome="${gone}"`);
    }

    // Switching one off drives the same state the old row did.
    const boxes = nodes.get("stage")!.querySelectorAll(".mark");
    const differs = boxes.find((b: Stub) => b.dataset.mark === "differs")!;
    expect(differs).toBeDefined();
    expect(differs.checked).toBe(true);
    differs.checked = false;
    differs.onchange();
    expect(state.marks.differs).toBe(false);
    expect(nodes.get("stage")!.classes.has("hide-differs")).toBe(true);
    expect(nodes.get("stage")!.classes.has("hide-malformed")).toBe(false);
    expect(location.hash).toContain("differs=0");
    expect(location.hash).not.toContain("malformed=0");

    // The row stays on screen, unchecked -- removing it would leave no way to
    // switch the mark back on. It is the static export that drops it.
    const after = stage().split('class="key"')[1];
    expect(after).toContain('data-outcome="differs"');
    expect(after).toMatch(/data-mark="differs"(?![^>]*\schecked)/);
    expect(after).toMatch(/data-mark="malformed"[^>]*\schecked/);
  } finally {
    state.marks = { malformed: true, differs: true };
  }
});

test("an export carries only the marks that were switched on", async () => {
  const { state } = await import("./app.js");
  await matrix();
  try {
    painted.length = 0;
    nodes.get("save")!.onclick();
    const all = painted.find((c) => c.calls.rects > 50)!.calls.texts.join(" ");
    expect(all).toContain("disagree");
    expect(all).toContain("malformed");
    // The image's key matches the panel's: switchable marks only.
    expect(all).not.toContain("missing");

    state.marks.differs = false;
    await matrix();
    painted.length = 0;
    nodes.get("save")!.onclick();
    const some = painted.find((c) => c.calls.rects > 50)!.calls.texts.join(" ");
    // The image explains what it shows, and no longer claims a colour it drops.
    expect(some).not.toContain("disagree");
    expect(some).toContain("malformed");
  } finally {
    state.marks = { malformed: true, differs: true };
  }
});

test("each page carries the chassis switch exactly once", async () => {
  // Matrix keeps it in the key, the index on its bench, and the plate -- which
  // has neither -- in the standalone row. Never two of them at once.
  await matrix();
  expect(Boolean(nodes.get("display")!.hiddenAttr)).toBe(true);
  expect(stage().split('class="key"')[1]).toContain("chassis");

  await goto("index");
  expect(Boolean(nodes.get("display")!.hiddenAttr)).toBe(true);
  expect(stage().split('class="tools"')[1]).toContain("chassis-check");

  await goto("plate");
  expect(Boolean(nodes.get("display")!.hiddenAttr)).toBe(false);
  expect(stage()).not.toContain("chassis-check");

  await matrix();
  expect(Boolean(nodes.get("bar")!.hiddenAttr)).toBe(true);

  const html = await Bun.file(new URL("./index.html", import.meta.url)).text();
  const at = (n: string) => html.indexOf(n);
  expect(at('id="bar"')).toBeLessThan(at('id="display"'));
  expect(at('id="display"')).toBeLessThan(at('id="stage"'));
  // Selectors choose what is on the page; the row below only affects how it is
  // drawn, and holds nothing that changes the data.
  // The bar still exists for a page with nowhere better to put its controls.
  const bar = html.slice(at('id="bar"'), at('id="display"'));
  for (const id of ["suites", "expression", "targets", "replicate"]) {
    expect(bar).toContain(`id="${id}"`);
  }
  // The standalone row exists only for a page with neither key nor bench.
  const row = html.slice(at('id="display"'), at('id="stage"'));
  expect(row).toContain('id="chassis"');
  for (const id of ["suites", "expression", "targets", "replicate"]) {
    expect(row).not.toContain(`id="${id}"`);
  }
  await goto("plate");
  expect(Boolean(nodes.get("display")!.hiddenAttr)).toBe(false);
  await matrix();
  expect(Boolean(nodes.get("display")!.hiddenAttr)).toBe(true);

  // The index carries its own bench instead of this row.
  await goto("index");
  expect(Boolean(nodes.get("display")!.hiddenAttr)).toBe(true);
});

test("red is the fatal one", async () => {
  const css = await Bun.file(new URL("./panel.css", import.meta.url)).text();
  // Malformed means unusable; a disagreement is a finding about two forms, and
  // does not make either of them individually bad.
  expect(css).toMatch(/\.face\[data-outcome="malformed"\] \{ color: var\(--red\)/);
  expect(css).toMatch(/\.face\[data-outcome="differs"\] \{ color: var\(--amber\)/);
  // Each mark is a class the faces inherit, not a re-render of each face.
  expect(css).toMatch(/\.hide-malformed \.face\[data-outcome="malformed"\]/);
  expect(css).toMatch(/\.hide-differs \.face\[data-outcome="differs"\]/);
});

// --------------------------------------------------------------------------- index

test("the index is one row per output, not per attempt", async () => {
  await goto("index");
  const html = stage();
  expect(html).toContain('class="filters"');
  for (const id of ["f-model", "f-expression", "f-form"]) expect(html).toContain(`id="${id}"`);
  // 3 models x 12 expressions x 4 outputs -- combined counts as two.
  expect((html.match(/class="row"/g) ?? []).length).toBe(144);
  for (const form of ["grid-only", "hex-only", "grid-combined", "hex-combined"]) {
    expect(html).toContain(`<td>${form}</td>`);
  }
  expect(html).toMatch(/<th>model<\/th><th>expression<\/th><th>form<\/th><\/tr>/);
  const row = html.split('class="row"')[1];
  expect((row.match(/<td/g) ?? []).length).toBe(3);
  expect(row).toContain('tabindex="0"');
});

test("the entry is the mark, rather than a column of swatches", async () => {
  await goto("index");
  const html = stage();
  // No swatch column at all.
  expect(html).not.toContain('class="mark"');
  expect(html).not.toMatch(/<i data-outcome=/);

  // The row carries its outcome, and names it on hover.
  const rows = [...html.matchAll(/class="row"[^>]*data-outcome="(\w+)"[^>]*title="([^"]*)"/g)];
  expect(rows.length).toBe(144);
  expect(new Set(rows.map((m) => m[1])).size).toBeGreaterThan(1);

  // Only the failures and a missing answer are coloured.
  const css = await Bun.file(new URL("./panel.css", import.meta.url)).text();
  expect(css).toMatch(/\.index \.row\[data-outcome="malformed"\] td \{ color: var\(--red\)/);
  expect(css).toMatch(/\.index \.row\[data-outcome="differs"\] td \{ color: var\(--amber\)/);
  for (const quiet of ["agrees", "drawn"]) {
    expect(css).not.toMatch(new RegExp(`\\.index \\.row\\[data-outcome="${quiet}"\\] td \\{ color`));
  }
});

test("the index keeps its controls on the bench, beside the attempt", async () => {
  const { state } = await import("./app.js");
  await goto("index");
  const html = stage();
  expect(html).toContain('class="tools"');
  expect(html).toContain('id="t-replicate"');
  expect(html).toContain('type="checkbox"');
  expect(html.split('class="detail"')[1]).toContain('class="tools"');
  // The bench offers the cycle too, as a grid of every replicate. Read from the
  // stage: the select is rendered into it, not a standalone element.
  expect(html.split('id="t-replicate"')[1]).toMatch(/>all \(\d+\)</);

  const replicate = nodes.get("t-replicate")!;
  replicate.value = "2";
  replicate.onchange();
  expect(state.replicate).toBe("2");
  expect(location.hash).toContain("replicate=2");
  nodes.get("t-replicate")!.value = "1";
  nodes.get("t-replicate")!.onchange();
});

test("the attempt is shown in full, row by row", async () => {
  const { setView, state } = await import("./app.js");
  await goto("index");
  for (const form of ["grid_only", "hex_only", "both:grid"]) {
    state.form = form;
    await setView("index");
    const table = stage().split('class="rows"')[1];
    expect(table).toBeDefined();
    const heads = (table.split("<tbody>")[0].match(/<th>/g) ?? []).length;
    const cells = (table.split("<tbody>")[1].split("</tr>")[0].match(/<td/g) ?? []).length;
    expect(heads).toBe(cells);
  }

  state.form = "both:hex";
  await setView("index");
  let table = stage().split('class="rows"')[1];
  expect(table).toContain("<th>hex from grid</th>");
  expect(table).toContain("<th>hex written</th>");

  state.form = "grid_only";
  await setView("index");
  table = stage().split('class="rows"')[1];
  expect(table).toContain("<th>hex</th>");
  expect(table).not.toContain("hex written");
});

test("the request that produced the face is available in full", async () => {
  await goto("index");
  const panel = stage().split('class="panel"')[1];
  expect(panel).toContain("the request as sent");
  expect(panel).toContain("<h4>system</h4>");
  expect(panel).toContain("<h4>user</h4>");
  // Tokens are billed per request, not per icon, so no per-icon cost is claimed.
  expect(panel).not.toContain("tokens in");
  expect(panel).not.toContain("latency");
});

// --------------------------------------------------------------------------- plate

test("plate is one best attempt per expression", async () => {
  await goto("plate");
  const html = stage();
  expect(html).toContain('class="plate"');
  expect((html.match(/<figure>/g) ?? []).length).toBe(12);
});

test("plate prefers a better outcome over an earlier replicate", async () => {
  const { bestAt } = await import("./app.js");
  const [first] = await suiteIds();
  const one = await fetch(`/api/suites/${first}`).then((r) => r.json());
  const RANKED = ["agrees", "drawn", "differs", "malformed", "missing"];
  for (const name of one.expressions) {
    for (const target of one.targets) {
      const all = one.cells[name]?.[target] ?? [];
      if (all.length < 2) continue;
      const best = bestAt(one, name, target);
      const ranks = all.map((e: Stub) => RANKED.indexOf(e.outcome));
      expect(RANKED.indexOf(best.outcome)).toBe(Math.min(...ranks));
    }
  }
});

// --------------------------------------------------------------------------- behaviour

test("a run of a condition is a replicate, and nothing calls it anything else", async () => {
  await goto("index");
  expect(stage()).toMatch(/replicate \d/);
  for (const wrong of [/\btry \d/, /\bsample \d/]) expect(stage()).not.toMatch(wrong);

  const html = await Bun.file(new URL("./index.html", import.meta.url)).text();
  expect(html).toContain(">replicate<");
  expect(html).not.toContain(">try<");
  expect(html).not.toContain(">sample<");

  // The word matches the data underneath it, so a reader and a record agree.
  const suites = await fetch("/api/suites").then((r) => r.json());
  expect(suites[0].replicates).toBeGreaterThan(0);
  expect(suites[0].repeats).toBeUndefined();
  const one = await fetch(`/api/suites/${suites[0].id}`).then((r) => r.json());
  expect(one.replicates).toBeGreaterThan(0);
  expect(one.cells.happy.both[0].replicate).toBe(1);
});

test("the chassis is on by default and the toggle offers the other state", async () => {
  const { state } = await import("./app.js");
  await matrix();
  const chassis = nodes.get("chassis")!;
  try {
    expect(state.chassis).toBe(true);
    expect(chassis.checked).toBe(true);
    chassis.checked = false;
    chassis.onchange();
    expect(state.chassis).toBe(false);
  } finally {
    chassis.checked = true;
    chassis.onchange();
  }
});

test("`all` cycles the replicates without rebuilding the controls", async () => {
  const { state } = await import("./app.js");
  await matrix();
  const replicate = nodes.get("replicate")!;
  replicate.value = "all";
  replicate.onchange();

  // The figure has its own container precisely so a frame can change alone.
  expect(stage()).toContain('id="figure"');
  const keyBefore = stage().split('class="key"')[1];

  const before = state.frame;
  await new Promise((r) => setTimeout(r, 900));
  expect(state.frame).toBeGreaterThan(before);
  // A tick redraws the faces only. Rebuilding the key would shut an open
  // dropdown every 700ms and make the form selector unusable.
  expect(stage().split('class="key"')[1]).toBe(keyBefore);

  replicate.value = "1";
  replicate.onchange();
});

test("the diagram is four real cells, matching the four in every cell", async () => {
  await matrix();
  const aside = stage().split('class="key"')[1];
  const table = aside.split('class="quadkey"')[1].split("</table>")[0];

  // Two rows of two. No spanned cell, so no rule has to be drawn through text.
  expect((table.match(/<tr>/g) ?? []).length).toBe(2);
  expect((table.match(/<td>/g) ?? []).length).toBe(4);
  expect(table).not.toContain("colspan");

  // Each position names the option that isolates it, in the order the faces sit.
  const named = [...table.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1]);
  expect(named).toEqual(["grid-only", "hex-only", "grid-combined", "hex-combined"]);
  // ...and every one of those is a real option in the selector above it.
  const options = [...aside.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g)].map((m) => m[2]);
  for (const n of named) expect(options).toContain(n);
});

// --------------------------------------------------------------------------- export

test("each view exports its own shape, and none carries a caption", async () => {
  for (const view of ["matrix", "index", "plate"]) {
    painted.length = 0;
    if (view === "matrix") await matrix();
    else await goto(view);
    nodes.get("save")!.onclick();
    const drawn = painted.find((c) => c.calls.rects > 50);
    expect(drawn).toBeDefined();
    // No technical footer annotated onto the image. Cell labels are not a
    // caption -- a plate naming its cells is the point of a plate.
    expect(drawn!.calls.texts.some((t: string) => /16×10/.test(t))).toBe(false);
  }
});

test("the matrix export follows the facets and carries its key", async () => {
  await matrix();
  painted.length = 0;
  nodes.get("save")!.onclick();
  let drawn = painted.find((c) => c.calls.rects > 50)!;
  // One outline per cell. The key strokes its outlined swatch too, so this is a
  // floor rather than an exact count.
  expect(drawn.calls.strokes).toBeGreaterThanOrEqual(36);
  const said = drawn.calls.texts.join(" ");
  expect(said).toContain("happy");
  expect(said).toContain("OUTCOMES");

  // Narrowed, it exports what is on screen rather than the whole thing.
  await matrix({ expression: ["happy"] });
  painted.length = 0;
  nodes.get("save")!.onclick();
  drawn = painted.find((c) => c.calls.rects > 0)!;
  // Three cells now, not thirty-six.
  expect(drawn.calls.strokes).toBeLessThan(10);
  expect(drawn.calls.texts).not.toContain("sad");
});

test("the cycle exports as a GIF, a single replicate as a still", async () => {
  const { state } = await import("./app.js");
  await goto("matrix");
  state.replicate = "all";
  nodes.get("replicate")!.value = "all";
  nodes.get("replicate")!.onchange();
  expect(String(nodes.get("format")!.innerHTML)).toContain('value="gif"');

  blobs.length = 0;
  nodes.get("save")!.onclick();
  expect(blobs.length).toBe(1);
  expect(blobs[0].type).toBe("image/gif");
  expect(String.fromCharCode(...(blobs[0].parts[0] as Uint8Array).slice(0, 6))).toBe("GIF89a");

  nodes.get("replicate")!.value = "1";
  nodes.get("replicate")!.onchange();
  expect(String(nodes.get("format")!.innerHTML)).toContain('value="png"');
});

test("the page introduces itself before it offers controls", async () => {
  const html = await Bun.file(new URL("./index.html", import.meta.url)).text();
  const at = (needle: string) => html.indexOf(needle);
  expect(at('id="title"')).toBeLessThan(at('id="bar"'));
  expect(at('id="bar"')).toBeLessThan(at('id="details"'));
  expect(at('id="details"')).toBeLessThan(at('id="stage"'));
  expect(at('id="stage"')).toBeLessThan(at('id="export"'));
  expect(at('id="nav"')).toBeLessThan(at("<main>"));
  expect(at('class="subject"')).toBeLessThan(at('id="display"'));
});

test("the cycling option reads as a count, not a quantity", async () => {
  await goto("matrix");
  const options = String(nodes.get("replicate")!.innerHTML);
  expect(options).toMatch(/>all \(\d+\)</);
  expect(options).not.toMatch(/>all \d+</);
});

test("method still carries the full outcome reference", async () => {
  // The key on the matrix is a control, not a glossary; the glossary is here.
  await goto("method");
  const html = stage();
  for (const key of Object.keys(OUTCOMES)) expect(html).toContain(`data-outcome="${key}"`);
  expect(Object.keys(OUTCOMES).length).toBeGreaterThan(2);
});

test("filtering does not move the figure", async () => {
  const css = await Bun.file(new URL("./panel.css", import.meta.url)).text();
  // The row headings keep their width when a shorter name is the only one left.
  expect(css).toMatch(/table\.matrix \.rowhead \{[^}]*width: 7rem/);

  // Nothing appears above the figure when a filter goes on, so nothing shifts.
  await matrix();
  expect(stage().trimStart()).toStartWith('<div class="figure wide">');
  await matrix({ expression: ["happy"] });
  expect(stage().trimStart()).toStartWith('<div class="figure wide">');

  // The reset is always in the key, so the panel does not shift either.
  expect((stage().match(/id="k-reset"/g) ?? []).length).toBe(1);
});

test("expressions can be compared as an arbitrary subset", async () => {
  const { state } = await import("./app.js");
  await matrix({ expression: ["happy", "sad", "wink"] });
  const html = stage();
  expect((html.match(/class="rowhead"/g) ?? []).length).toBe(3);
  for (const kept of ["happy", "sad", "wink"]) expect(html).toContain(`>${kept}<`);
  expect(html).not.toMatch(/data-expr="nerdy"[^>]*>nerdy<\/button><\/th>/);

  // The chips carry the selection, and the crumb counts it.
  const aside = html.split('class="key"')[1];
  expect((aside.match(/aria-pressed="true"/g) ?? []).length).toBe(3);
  // The chips are the record of what is selected; nothing repeats it above.
  expect(html).not.toContain('class="narrowed"');
});

test("a chip toggles one expression in or out", async () => {
  const { state } = await import("./app.js");
  await matrix({ expression: ["happy"] });
  const chips = nodes.get("stage")!.querySelectorAll(".chip");
  const sad = chips.find((c: Stub) => c.dataset.expr === "sad")!;
  expect(sad).toBeDefined();
  sad.onclick();
  expect(state.narrow.expression.sort()).toEqual(["happy", "sad"]);

  const happy = nodes.get("stage")!.querySelectorAll(".chip").find((c: Stub) => c.dataset.expr === "happy")!;
  happy.onclick();
  expect(state.narrow.expression).toEqual(["sad"]);
  await matrix();
});

test("a subset is a link, and an empty selection carries nothing", async () => {
  await matrix({ expression: ["happy", "wink"] });
  expect(location.hash).toContain("expr=happy%2Cwink");
  await matrix();
  expect(location.hash).not.toContain("expr=");
});

test("the index can show every replicate at once", async () => {
  const { setView, state } = await import("./app.js");
  await goto("index");
  state.expression = "happy";
  state.form = "grid_only";
  state.replicate = "all";
  await setView("index");
  const html = stage();
  expect(html).toContain('class="draws"');
  // One drawing per replicate, each labelled and carrying its own outcome.
  const draws = (html.match(/class="draw"/g) ?? []).length;
  expect(draws).toBeGreaterThan(1);
  expect(html).toMatch(/replicate 1 ·/);
  // Reading one in full is the other mode, so the row table steps aside.
  expect(html).not.toContain('class="rows"');

  state.replicate = "1";
  await setView("index");
  expect(stage()).toContain('class="rows"');
});

test("a matrix face says what clicking it does", async () => {
  await matrix();
  const html = stage();
  expect(html).toContain('title="Inspect icon"');
  // And carries the exact output it stands for, so the index opens on it.
  expect(html).toMatch(/data-leaf="both:hex"/);
  expect(html).toMatch(/data-leaf="grid_only"/);
});

test("the index keeps its place when you pick a row", async () => {
  const { setView, state } = await import("./app.js");
  await goto("index");
  const box = nodes.get("stage")!.scrollBox;
  box.scrollTop = 640;

  // Selecting a row re-renders the explorer; the list should not jump.
  state.expression = "nerdy";
  await setView("index");
  expect(box.scrollTop).toBe(640);
});

test("`all` does not animate the index", async () => {
  const { setView, state } = await import("./app.js");
  await goto("index");
  state.replicate = "all";
  await setView("index");
  // Side by side, not a cycle: no timer, so no redraw under the reader.
  const before = state.frame;
  await new Promise((r) => setTimeout(r, 900));
  expect(state.frame).toBe(before);
  expect(stage()).toContain('class="draws"');

  state.replicate = "1";
  await setView("index");
});

test("the attempt fills the width: face, rows, and hex to take away", async () => {
  const { setView, state } = await import("./app.js");
  await goto("index");
  state.expression = "happy";
  state.form = "grid_only";
  state.replicate = "1";
  await setView("index");

  const panel = stage().split('class="panel"')[1];
  expect(panel).toContain('class="spread"');
  // All three side by side, rather than a narrow column.
  expect(panel).toContain('class="shown"');
  expect(panel).toContain('class="rows"');
  expect(panel).toContain('class="readout"');
});

test("the hex can be taken to the clipboard", async () => {
  const { setView, state } = await import("./app.js");
  await goto("index");
  state.expression = "happy";
  state.form = "grid_only";
  state.replicate = "1";
  await setView("index");

  const button = nodes.get("stage")!.querySelectorAll(".copy")[0];
  expect(button).toBeDefined();
  copied.length = 0;
  await button.onclick();
  expect(copied.length).toBe(1);
  // Ten rows of four hex digits, which is what the icon actually is.
  const lines = copied[0].split("\n");
  expect(lines.length).toBe(10);
  for (const line of lines) expect(line).toMatch(/^[0-9A-F]{4}$/);
});

test("a target that only drew still offers its hex, and says where it came from", async () => {
  const { setView, state } = await import("./app.js");
  await goto("index");
  state.expression = "happy";
  state.form = "grid_only";
  state.replicate = "1";
  await setView("index");
  // grid-only wrote no hex, so the readout is honest about deriving it.
  expect(stage()).toContain("hex, read off its grid");

  state.form = "hex_only";
  await setView("index");
  expect(stage()).toMatch(/<h4>hex<\/h4>/);
  expect(stage()).not.toContain("read off its grid");
});
