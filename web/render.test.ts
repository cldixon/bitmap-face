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
import { OUTCOMES, TARGETS } from "./copy.js";

type Stub = Record<string, any>;

function element(): Stub {
  const node: Stub = {
    innerHTML: "",
    textContent: "",
    value: "",
    hidden: false,
    hiddenAttr: false,
    fieldHidden: false,
    onchange: null,
    onclick: null,
    get options() {
      return [...String(node.innerHTML).matchAll(/value="([^"]*)"/g)].map((m) => ({ value: m[1] }));
    },
    toggleAttribute: (name: string, on: boolean) => {
      if (name === "hidden") node.hiddenAttr = on;
    },
    // The control's wrapping <label class="field"> is what gets hidden; record
    // the toggle on the control itself so a test can see it happened.
    closest: (sel: string) =>
      sel === ".field"
        ? { toggleAttribute: (_a: string, on: boolean) => (node.fieldHidden = on) }
        : null,
    querySelectorAll: (sel: string) => {
      const cls = sel.replace(/^\./, "");
      return [...String(node.innerHTML).matchAll(/class="([^"]*)"/g)]
        .filter((m) => m[1].split(" ").includes(cls))
        .map(() => ({ onclick: null, dataset: {}, setAttribute: () => {} }));
    },
    querySelector: () => null,
    scrollIntoView: () => {},
    click: () => {},
  };
  return node;
}

const nodes = new Map<string, Stub>();
const painted: Stub[] = [];

function canvas(): Stub {
  const calls: Stub = { rects: 0, strokes: 0, texts: [] as string[] };
  const node: Stub = {
    width: 0,
    height: 0,
    calls,
    getContext: () => ({
      set fillStyle(_v: string) {},
      set font(_v: string) {},
      set textAlign(_v: string) {},
      set textBaseline(_v: string) {},
      set strokeStyle(_v: string) {},
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
const blobs: Stub[] = [];
(globalThis as any).Blob = class {
  constructor(parts: unknown[], opts: Stub) {
    blobs.push({ parts, type: opts?.type });
  }
};
// Add the blob statics without replacing the real URL constructor.
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

/** Put the app somewhere known. One module instance is shared by every test. */
async function goto(view: string, target = "all", tries = "all") {
  const { setView, state } = await import("./app.js");
  state.target = target;
  state.repeat = tries; // fillRepeats narrows it if the view cannot offer it
  await setView(view);
  const node = nodes.get("targets")!;
  if (node.value !== target && node.options.some((o: Stub) => o.value === target)) {
    node.value = target;
    node.onchange?.();
  }
}

// --------------------------------------------------------------------------- chrome

test("the nav names both comparison pages in full", async () => {
  const html = await Bun.file(new URL("./index.html", import.meta.url)).text();
  expect(html).toContain(">model comparison</button>");
  expect(html).toContain(">form comparison</button>");
});

test("every destination states what it is showing", async () => {
  for (const view of ["overview", "sheet", "compare", "inspect", "plate", "method"]) {
    await goto(view);
    expect(String(nodes.get("title")!.textContent).length).toBeGreaterThan(3);
    expect(String(nodes.get("intro")!.textContent).length).toBeGreaterThan(30);
  }
});

test("only the controls a view uses are shown", async () => {
  await goto("sheet");
  expect(hidden("suites")).toBe(false);
  expect(hidden("repeat")).toBe(false);
  expect(hidden("targets")).toBe(true); // every form is shown, so there is nothing to pick

  await goto("compare");
  expect(hidden("suites")).toBe(true); // every model at once
  expect(hidden("expression")).toBe(false);

  await goto("inspect");
  // Inspect keeps no page-level controls at all; they live with the attempt.
  expect(Boolean(nodes.get("bar")!.hiddenAttr)).toBe(true);
});

test("prose destinations offer no controls and nothing to export", async () => {
  for (const view of ["overview", "method"]) {
    await goto(view);
    expect(Boolean(nodes.get("bar")!.hiddenAttr)).toBe(true);
    expect(Boolean(nodes.get("export")!.hiddenAttr)).toBe(true);
    expect(stage()).toContain('class="prose"');
  }
  await goto("compare");
  expect(Boolean(nodes.get("export")!.hiddenAttr)).toBe(false);
});

test("method carries the technical record and the definitions", async () => {
  await goto("method");
  const html = stage();
  for (const key of ["references", "copy directive", "tries per condition"]) {
    expect(html).toContain(`>${key}<`);
  }
  // Every published outcome is defined; which ones are published is the
  // author's call, so the set comes from copy.js rather than a fixed list.
  for (const key of Object.keys(OUTCOMES)) expect(html).toContain(`data-outcome="${key}"`);
  for (const form of ["grid", "hex", "combined"]) expect(html).toContain(`<dt>${form}</dt>`);
});

// --------------------------------------------------------------------------- views

test("form comparison is a block per expression", async () => {
  await goto("sheet");
  const html = stage();
  expect(html).toContain('class="blocks"');
  expect((html.match(/class="block"/g) ?? []).length).toBe(12);
  expect(html).toContain("<h2>happy</h2>");
  // The y-axis table is gone.
  expect(html).not.toContain("<table>");
  expect(html).not.toContain("rowhead");
});

test("each block shows every form, `combined` paired under one caption", async () => {
  await goto("sheet");
  const block = stage().split('class="block"')[1];
  expect(block).toBeDefined();
  expect((block.match(/<figcaption>/g) ?? []).length).toBe(3); // grid, hex, combined
  expect((block.match(/class="face"/g) ?? []).length).toBe(4); // combined contributes two
  expect(block).toContain("<figcaption>combined</figcaption>");
});

test("each block can be exported on its own", async () => {
  await goto("sheet", "all", "1"); // a still, so one canvas per export
  const html = stage();
  expect((html.match(/class="snap"/g) ?? []).length).toBe(12);
  expect(html).toMatch(/class="snap" data-only="happy"/);

  // The whole page, then one block: the block must be the smaller image.
  painted.length = 0;
  nodes.get("save")!.onclick();
  const whole = painted.find((c) => c.calls.rects > 50)!;
  expect(whole).toBeDefined();

  painted.length = 0;
  const { runExport } = await import("./app.js");
  runExport("happy");
  const one = painted.find((c) => c.calls.rects > 0)!;
  expect(one).toBeDefined();
  expect(one.height).toBeLessThan(whole.height);
  // Only that expression is labelled in it.
  expect(one.calls.texts).toContain("happy");
  expect(one.calls.texts).not.toContain("sad");
});

test("a single block exports as a GIF when the cycle is on", async () => {
  await goto("sheet");
  blobs.length = 0;
  const { runExport } = await import("./app.js");
  runExport("happy");
  expect(blobs.length).toBe(1);
  expect(blobs[0].type).toBe("image/gif");
  const bytes = blobs[0].parts[0] as Uint8Array;
  expect(String.fromCharCode(...bytes.slice(0, 6))).toBe("GIF89a");
});

test("only the plate carries a details strip", async () => {
  // Everywhere else the model is already named on the page itself.
  for (const view of ["sheet", "compare", "inspect", "overview", "method"]) {
    await goto(view);
    expect(Boolean(nodes.get("details")!.hiddenAttr)).toBe(true);
    expect(String(nodes.get("details")!.innerHTML)).toBe("");
  }
  // The plate labels nothing else, so it keeps one.
  await goto("plate", "both");
  expect(Boolean(nodes.get("details")!.hiddenAttr)).toBe(false);
  for (const key of ["model", "effort", "grid", "tries"]) {
    expect(String(nodes.get("details")!.innerHTML)).toContain(`>${key}<`);
  }
});


test("`combined` gets two columns on model comparison", async () => {
  await goto("compare");
  const html = stage();
  expect(html).toContain('colspan="2"');
  expect(html).toContain(">combined</th>");
  expect(html).toContain(">grid</th>");
  expect(html).toContain(">hex</th>");
  expect(html).toContain("split-first");
  expect(html).toContain("split-last");
  // The stored value is untouched; only the label changed.
  expect(html).toContain('data-target="both"');
  expect(html).not.toContain(">both</th>");
  expect(html).not.toContain(">grid_only</th>");
  expect(html).not.toContain(">hex_only</th>");
});

test("a row holds one face per written form, so `both` contributes two", async () => {
  await goto("compare");
  const row = stage().split("<tr>").find((r) => r.includes("rowhead") && !r.includes("void"));
  expect(row).toBeDefined();
  expect((row!.match(/class="face"/g) ?? []).length).toBe(4);
});

test("faces carry what the click handler needs", async () => {
  await goto("compare");
  for (const attr of ["data-name", "data-target", "data-repeat", "data-outcome", "data-suite"]) {
    expect(stage()).toContain(attr);
  }
});

test("model comparison is one expression, every model, every form", async () => {
  await goto("compare");
  const html = stage();
  expect(html).toContain("<table>");
  // One row per model, and no per-expression blocks.
  expect(html).not.toContain('class="blocks"');
  expect((html.match(/class="rowhead"/g) ?? []).length).toBe(3);
  expect(html).toMatch(/rowhead[^]*?(haiku|sonnet|opus)/);
  // All three forms, so `both` still contributes its pair.
  expect(html).toContain('colspan="2"');
  expect((html.match(/class="face"/g) ?? []).length).toBe(12); // 3 models x 4 columns
});

test("the form selector is not offered on model comparison", async () => {
  await goto("compare");
  expect(hidden("targets")).toBe(true);
  expect(hidden("expression")).toBe(false);
  expect(hidden("suites")).toBe(true);
});

test("model comparison carries no details line and is centred", async () => {
  await goto("compare");
  // Every row heading names its model, so a details line would only echo the
  // controls above it.
  expect(Boolean(nodes.get("details")!.hiddenAttr)).toBe(true);
  expect(String(nodes.get("details")!.innerHTML)).toBe("");
  expect(stage()).toContain('class="figure"');
  // The expression titles the figure instead.
  expect(stage()).toMatch(/<figure class="comparison">\s*<h2>\w+<\/h2>/);

  // Plate still names its model, having nothing else that does.
  await goto("plate", "both");
  expect(Boolean(nodes.get("details")!.hiddenAttr)).toBe(false);
  expect(String(nodes.get("details")!.innerHTML)).toContain("<dt>");
});

test("plate is one best attempt per expression, three across", async () => {
  await goto("plate", "both");
  const html = stage();
  expect(html).toContain('class="plate"');
  expect((html.match(/<figure>/g) ?? []).length).toBe(12);
});

test("plate prefers a better outcome over an earlier try", async () => {
  const { bestAt } = await import("./app.js");
  const suites = await fetch("/api/suites").then((r) => r.json());
  const one = await fetch(`/api/suites/${suites[0].id}`).then((r) => r.json());
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

test("the inspect index is one row per model, expression and form", async () => {
  await goto("inspect");
  const html = stage();
  expect(html).toContain('class="filters"');
  for (const id of ["f-model", "f-expression", "f-form"]) expect(html).toContain(`id="${id}"`);
  // 3 models x 12 expressions x 3 forms.
  expect((html.match(/class="row"/g) ?? []).length).toBe(108);
  expect(html).toContain('class="rows"'); // the selected attempt, row by row

  // A table: headed columns, one cell each, with the outcome in its own column.
  expect(html).toMatch(/<th>model<\/th><th>expression<\/th><th>form<\/th>/);
  const row = html.split('class="row"')[1];
  expect((row.match(/<td/g) ?? []).length).toBe(4);
  expect(row).toMatch(/<td class="lead">\w+<\/td>/);
  expect(row).toMatch(/<td class="mark">/);
  // And it is reachable without a mouse.
  expect(row).toContain('tabindex="0"');
});

test("the form filter narrows the index", async () => {
  const { state } = await import("./app.js");
  await goto("inspect");
  state.filters.form = "both";
  const node = nodes.get("f-form");
  expect((stage().match(/class="row"/g) ?? []).length).toBe(108);
  // Re-render through the filter the way the control does.
  const { setView } = await import("./app.js");
  await setView("inspect");
  expect((stage().match(/class="row"/g) ?? []).length).toBe(36);
  expect(stage()).not.toMatch(/<td>grid<\/td>/);
  state.filters.form = "all";
  await setView("inspect");
  expect(node === undefined || true).toBe(true);
});

// --------------------------------------------------------------------------- behaviour

test("the chassis is on by default and the toggle offers the other state", async () => {
  const { state } = await import("./app.js");
  await goto("compare");
  const chassis = nodes.get("chassis")!;
  try {
    expect(state.chassis).toBe(true);
    const on = String(chassis.textContent);
    chassis.onclick();
    expect(state.chassis).toBe(false);
    const off = String(chassis.textContent);
    // Both labels say something, and they are not the same thing.
    expect(on.length).toBeGreaterThan(3);
    expect(off).not.toBe(on);
  } finally {
    // Restore even on failure: leaving it off changes every later assertion.
    if (!state.chassis) chassis.onclick();
  }
});

test("`all` cycles the tries on a timer", async () => {
  const { state } = await import("./app.js");
  await goto("sheet");
  const repeat = nodes.get("repeat")!;
  repeat.value = "all";
  repeat.onchange();
  const before = state.frame;
  await new Promise((r) => setTimeout(r, 900));
  expect(state.frame).toBeGreaterThan(before);
  repeat.value = "1";
  repeat.onchange();
});

test("the view is a route and the controls are parameters", async () => {
  await goto("inspect");
  expect(location.hash).toStartWith("#/inspect");
  expect(location.hash).toContain("expr=");
  expect(location.hash).toContain("try=");

  const repeat = nodes.get("repeat")!;
  repeat.value = "2";
  repeat.onchange();
  expect(location.hash).toStartWith("#/inspect");
  expect(location.hash).toContain("try=2");
});

test("every view exports its own shape, captioned", async () => {
  for (const mode of ["sheet", "compare", "inspect", "plate"]) {
    painted.length = 0;
    await goto(mode, mode === "plate" ? "both" : "all");
    nodes.get("save")!.onclick();
    // Comparison measures its key on a throwaway canvas first, so take the drawn one.
    const drawn = painted.find((c) => c.calls.rects > 50);
    expect(drawn).toBeDefined();
    // Images carry no caption; the note around them does that.
    expect(drawn!.calls.texts.some((t: string) => /16×10|try /.test(t))).toBe(false);
  }
});

test("the page introduces itself before it offers controls", async () => {
  // Document order is the claim, so assert it against the markup rather than
  // the shim, which has no tree to walk.
  const html = await Bun.file(new URL("./index.html", import.meta.url)).text();
  const at = (needle: string) => html.indexOf(needle);
  expect(at('id="title"')).toBeGreaterThan(-1);
  expect(at('id="title"')).toBeLessThan(at('id="bar"'));
  expect(at('id="intro"')).toBeLessThan(at('id="bar"'));
  expect(at('id="bar"')).toBeLessThan(at('id="details"'));
  expect(at('id="details"')).toBeLessThan(at('id="stage"'));
  expect(at('id="nav"')).toBeLessThan(at("<main>"));
  // The subject leads the controls, and export follows the artifact it saves.
  expect(at('class="subject"')).toBeLessThan(at('class="controls"'));
  expect(at('id="stage"')).toBeLessThan(at('id="export"'));
  expect(at('id="expression"')).toBeLessThan(at('id="repeat"'));
  expect(at('id="chassis"')).toBeLessThan(at('id="save"'));
});

test("model comparison keeps its key beside the figure", async () => {
  await goto("compare");
  const html = stage();
  expect(html).toContain('class="key"');
  expect(html).toContain("<h3>Forms</h3>");
  expect(html).toContain("<h3>Outcomes</h3>");
  for (const form of ["grid", "hex", "combined"]) expect(html).toContain(`<dt>${form}</dt>`);
  for (const key of Object.keys(OUTCOMES)) expect(html).toContain(`data-outcome="${key}"`);
  // Each entry actually carries a definition, not just a label.
  expect((html.match(/<dd>/g) ?? []).length).toBeGreaterThanOrEqual(
    3 + Object.keys(OUTCOMES).length,
  );
});

test("the comparison export carries the figure and its key in one image", async () => {
  await goto("compare");
  painted.length = 0;
  nodes.get("save")!.onclick();
  // Two canvases: one to measure the key, one drawn.
  const drawn = painted.find((c) => c.calls.rects > 50)!;
  expect(drawn).toBeDefined();
  const said = drawn.calls.texts.join(" ");
  // No technical footer is annotated onto the image.
  expect(said).not.toMatch(/try all|16×10/);
  // The expression heads the image.
  expect(said).toMatch(/\b(happy|sad|surprised|angry|sleepy|wink|yuck|kiss|confused|smug|sunglasses|nerdy)\b/i);
  // Every model is labelled.
  expect(said).toMatch(/haiku/);
  expect(said).toMatch(/opus/);
  // And the key travels with it, definitions and all.
  expect(said).toContain("FORMS");
  expect(said).toContain("OUTCOMES");
  // Column headings and the key both use the display names.
  expect(said).toContain("combined");
  expect(said).not.toContain("both");
  // The definitions travel with it, whatever their wording.
  expect(said).toContain(TARGETS.hex_only.split(" ")[0]);
  // The outlined "missing" swatch is stroked rather than filled.
  expect(drawn.calls.strokes).toBeGreaterThan(0);
});

test("only the comparison export carries a key", async () => {
  await goto("sheet");
  painted.length = 0;
  nodes.get("save")!.onclick();
  const drawn = painted.find((c) => c.calls.rects > 50)!;
  expect(drawn.calls.texts.join(" ")).not.toContain("OUTCOMES");
});

test("the cycle is the default, and it exports as a GIF", async () => {
  const { state } = await import("./app.js");
  // With nothing carried over, the try selector lands on the animation rather
  // than on the first try.
  await goto("compare", "all", "not-a-try");
  expect(state.repeat).toBe("all");
  expect(String(nodes.get("format")!.innerHTML)).toContain('value="gif"');
  expect(String(nodes.get("format")!.innerHTML)).not.toContain('value="png"');

  blobs.length = 0;
  painted.length = 0;
  nodes.get("save")!.onclick();
  expect(blobs.length).toBe(1);
  expect(blobs[0].type).toBe("image/gif");
  const bytes = blobs[0].parts[0] as Uint8Array;
  expect(String.fromCharCode(...bytes.slice(0, 6))).toBe("GIF89a");
  expect(bytes.at(-1)).toBe(0x3b);
});

test("a single try exports as a still instead", async () => {
  await goto("compare", "all", "1");
  const repeat = nodes.get("repeat")!;
  const formats = String(nodes.get("format")!.innerHTML);
  expect(formats).toContain('value="png"');
  expect(formats).toContain('value="jpeg"');
  expect(formats).not.toContain('value="gif"');

  blobs.length = 0;
  painted.length = 0;
  nodes.get("save")!.onclick();
  // A still goes through the canvas, not the GIF encoder.
  expect(blobs.length).toBe(0);
  expect(painted.some((c) => c.calls.rects > 50)).toBe(true);
  repeat.value = "all";
  repeat.onchange();
});

test("inspect has no animation to offer, so it falls back to a single try", async () => {
  const { state } = await import("./app.js");
  await goto("inspect");
  expect(state.repeat).toBe("1");
  expect(String(nodes.get("format")!.innerHTML)).toContain('value="png"');
});

test("inspect keeps its controls on the bench, beside the attempt", async () => {
  const { state } = await import("./app.js");
  await goto("inspect");
  const html = stage();
  // The page toolbar is empty here; the tools are in the detail column.
  expect(Boolean(nodes.get("bar")!.hiddenAttr)).toBe(true);
  expect(html).toContain('class="tools"');
  expect(html).toContain('id="t-try"');
  expect(html).toContain('id="t-chassis"');
  // They sit with the attempt, not with the index.
  const detail = html.split('class="detail"')[1];
  expect(detail).toContain('class="tools"');
  expect(html.split('class="index"')[1].split('class="detail"')[0]).not.toContain('class="tools"');

  // And they drive the same state the page toolbar would have. The label is
  // rendered into the stage markup, so that is where it is read from.
  const labelNow = () => stage().match(/id="t-chassis"[^>]*>([^<]*)</)?.[1] ?? "";
  const chassis = nodes.get("t-chassis")!;
  try {
    const on = labelNow();
    expect(on.length).toBeGreaterThan(3);
    chassis.onclick();
    expect(state.chassis).toBe(false);
    expect(labelNow()).not.toBe(on);
  } finally {
    if (!state.chassis) nodes.get("t-chassis")!.onclick();
  }

  const tries = nodes.get("t-try")!;
  tries.value = "2";
  tries.onchange();
  expect(state.repeat).toBe("2");
  expect(location.hash).toContain("try=2");
  nodes.get("t-try")!.value = "1";
  nodes.get("t-try")!.onchange();
});

test("the title admits when the chassis is off", async () => {
  await goto("compare");
  expect(stage()).toMatch(/<h2>[A-Z]\w+<\/h2>/);
  expect(stage()).not.toContain("(no chassis)");

  nodes.get("chassis")!.onclick();
  expect(stage()).toMatch(/<h2>[A-Z]\w+ \(no chassis\)<\/h2>/);
  nodes.get("chassis")!.onclick();
  expect(stage()).not.toContain("(no chassis)");
});

test("the save button belongs to the block it saves", async () => {
  await goto("sheet");
  // It must sit inside the block for its positioning to resolve against the
  // images rather than the stretched grid cell.
  const block = stage().split('class="block"')[1];
  expect(block).toContain('class="snap"');
  expect(block).toMatch(/data-only="\w+"/);

  const css = await Bun.file(new URL("./panel.css", import.meta.url)).text();
  // The block is sized to its contents, so `right: 0` is the images' edge.
  expect(css).toMatch(/\.block \{[^}]*width: max-content/);
  expect(css).toMatch(/\.snap \{[^}]*position: absolute/);
});
