/**
 * The panel renders, against real run records.
 *
 * app.js only runs in a browser, and a mistake there fails silently -- an empty
 * sheet looks a lot like a suite with no data. This gives it just enough of a
 * DOM to load against the live server, then checks that both views actually put
 * faces on the page. It is a smoke test for "did it throw", not a design review.
 *
 *   bun test web/render.test.ts        (needs `bun run panel` on :4400)
 */
import { expect, test } from "bun:test";

type Stub = Record<string, any>;

function element(): Stub {
  const node: Stub = {
    innerHTML: "",
    textContent: "",
    value: "",
    hidden: false,
    checked: false,
    onchange: null,
    get options() {
      return [...String(node.innerHTML).matchAll(/value="([^"]*)"/g)].map((m) => ({ value: m[1] }));
    },
    querySelectorAll: () => [],
    querySelector: () => ({ onclick: null }),
    scrollIntoView: () => {},
  };
  return node;
}

const nodes = new Map<string, Stub>();

//: Enough <canvas> for the exporter to draw into and be checked afterwards.
const painted: Stub[] = [];
function canvas(): Stub {
  const calls: Stub = { rects: 0, texts: [] as string[] };
  const node: Stub = {
    width: 0,
    height: 0,
    calls,
    getContext: () => ({
      set fillStyle(_v: string) {},
      set font(_v: string) {},
      set textAlign(_v: string) {},
      set textBaseline(_v: string) {},
      fillRect: () => calls.rects++,
      fillText: (t: string) => calls.texts.push(t),
    }),
    toBlob: () => {},
  };
  painted.push(node);
  return node;
}

const doc: Stub = {
  getElementById(id: string) {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  },
  createElement: (tag: string) => (tag === "canvas" ? canvas() : element()),
};

(globalThis as any).document = doc;
(globalThis as any).getComputedStyle = () => ({
  backgroundColor: "#fff",
  color: "#000",
  getPropertyValue: () => "#666",
});

const base = "http://localhost:4400";
const real = globalThis.fetch;
(globalThis as any).fetch = (url: string, init?: any) => real(url.startsWith("http") ? url : base + url, init);

// boot() fires on import; give its two awaits room to settle.
await import("./app.js");
await new Promise((r) => setTimeout(r, 400));

const sheet = () => String(nodes.get("sheet")!.innerHTML);

test("the suite view draws a row per expression", () => {
  const html = sheet();
  expect(html).toContain("<table>");
  const rows = html.match(/<tr>/g)?.length ?? 0;
  expect(rows).toBeGreaterThan(2); // header + expressions
  expect(html).toContain('class="face"');
});

test("every face carries the attributes the click handler needs", () => {
  for (const attr of ["data-name", "data-target", "data-repeat", "data-outcome", "data-suite"]) {
    expect(sheet()).toContain(attr);
  }
});

test("the configuration is stated, not left implicit", () => {
  expect(String(nodes.get("config")!.textContent)).toMatch(/claude-/);
});

test("the legend names all five states", () => {
  const legend = String(nodes.get("legend")!.innerHTML);
  for (const state of ["missing", "malformed", "drawn", "differs", "agrees"]) {
    expect(legend).toContain(`data-outcome="${state}"`);
  }
});

test("the compare view swaps the rows for suites and still draws faces", async () => {
  const view = nodes.get("view")!;
  view.value = "compare";
  await view.onchange();
  const html = sheet();
  expect(html).toContain('class="face"');
  // Rows are now models, so a model name appears in a row heading.
  expect(html).toMatch(/rowhead[^]*?(haiku|sonnet|opus)/);
});

test("the exporter draws pixels and labels every row and column", () => {
  painted.length = 0;
  nodes.get("save")!.onclick();
  expect(painted.length).toBe(1);
  const { calls } = painted[0];
  // Real pixels, not an empty sheet.
  expect(calls.rects).toBeGreaterThan(100);
  // In compare mode the rows are models and the columns are targets.
  expect(calls.texts).toContain("grid_only");
  expect(calls.texts.some((t: string) => /haiku|sonnet|opus/.test(t))).toBe(true);
  // The configuration travels with the image, or it is evidence of nothing.
  expect(calls.texts.some((t: string) => t.includes("suites"))).toBe(true);
});
