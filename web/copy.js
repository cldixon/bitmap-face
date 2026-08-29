/** Every word the panel says, in one place. */

export const PAGES = {
  overview: {
    title: "Bitmap faces",
    intro:
      "A record of what language models do when asked to draw a 16 × 10 icon in the " +
      "format the original Macintosh stored it in.",
  },
  matrix: {
    title: "Matrix",
    intro:
      "Every parameter at once. Expressions run down, models across, and each cell holds " +
      "all four written outputs: the two produced on their own, and the pair produced together.",
  },
  index: {
    title: "Index",
    intro:
      "Every attempt, one row each. Selecting one shows it in full: the written forms " +
      "returned, and the rows of the grid set against the hex written for them.",
  },
  plate: {
    title: "Plate",
    intro:
      "One face per expression, taking each model's best attempt. Intended for " +
      "reproduction alongside the note.",
  },
  method: {
    title: "Method",
    intro: "How the faces were requested, and how the responses were classified.",
  },
};

/**
 * What each target is called on screen.
 *
 * The stored values stay `grid_only` / `hex_only` / `both` -- they are written
 * into every run record and the Python schema -- so this renames the label
 * without touching the data.
 */
export const FORMS = {
  grid_only: "grid",
  hex_only: "hex",
  both: "combined",
  transcribe: "transcribe",
};

/**
 * The four outputs in one cell, in reading order.
 *
 * Columns are the written form, rows are how it was asked for -- so the cell is
 * itself a small crossing, and the same position means the same thing in every
 * cell of the page.
 */
export const QUAD = [
  { target: "grid_only", form: "grid" },
  { target: "hex_only", form: "hex" },
  { target: "both", form: "grid" },
  { target: "both", form: "hex" },
];

/**
 * What the form facet can be narrowed to.
 *
 * The four cell positions are already these five options: `combined` is the
 * pair, and each half of it can be asked for on its own. Filtering to one is
 * how a reader drills all the way down to a single icon.
 */
export const FORM_FILTERS = [
  ["all", "all"],
  ["grid_only", "grid-only"],
  ["hex_only", "hex-only"],
  ["both", "combined pair"],
  ["both:grid", "grid-combined"],
  ["both:hex", "hex-combined"],
];

/**
 * A line for each cell position, keyed by the option that selects it.
 *
 * The diagram is the legend for both the cell and the selector: each position
 * names the option that isolates it, so the layout, its explanation, and the
 * control are one thing. The full sentences are on Method.
 */
export const FORM_BRIEF = {
  grid_only: "drawn as a character grid",
  hex_only: "written straight as hex",
  "both:grid": "the grid half of a combined answer",
  "both:hex": "the hex half of that same answer",
  both: "both halves, from one answer",
};

export const TARGETS = {
  grid_only: "The model draws the face as a character grid.",
  hex_only: "The model writes the hex directly.",
  both: "The model returns a grid and its hex together.",
  transcribe: "The model is given a finished grid and asked only to encode it.",
};

export const OUTCOMES = {
  agrees: ["valid", "Output results in valid icon."],
  differs: ["disagree", "Combined outputs do not match."],
  //drawn: ["one form", "Only one form was requested, so there is nothing to check against."],
  malformed: ["malformed", "The response is invalid shape."],
  missing: ["missing", "Did not return output."],
};

/** Ranked best to worst, for picking a representative attempt. */
export const RANK = ["agrees", "drawn", "differs", "malformed", "missing"];

export const OVERVIEW = [
  [
    "Two written forms",
    "A 1-bit icon has two exact textual representations. One is a grid of characters, " +
      "one glyph per pixel. The other is hexadecimal: each row of sixteen pixels packs " +
      "into four hex digits. Neither is an image, and either can be produced by a model " +
      "that only emits text.",
  ],
  [
    "The question",
    "Whether a model can compose a legible face at this size, and whether it can move " +
      "between the two forms without losing the correspondence between them. These are " +
      "separable abilities, and the targets below separate them.",
  ],
  [
    "What is here",
    "Sheet holds one model against the full expression set. Compare places the models " +
      "side by side. Inspect opens a single attempt down to its rows. Plate assembles a " +
      "figure for reproduction. Method records how the requests were made.",
  ],
];

export const METHOD = [
  [
    "Expressions",
    "Twelve expressions are requested in a fixed order, graded easy to hard, with two " +
      "drawn from Macintosh ROM iconography. The order is held constant so that position " +
      "in the response is never confounded with difficulty.",
  ],
  [
    "References",
    "Each prompt carries a small number of worked examples in both written forms. These " +
      "are geometric patterns — a frame, a checker, a diagonal, a wedge — rather than " +
      "faces, so they demonstrate the encoding without supplying a face to copy. The " +
      "prompt additionally instructs the model not to reproduce them.",
  ],
  [
    "Repetition",
    "Every condition is run more than once, and each run is a replicate. Nothing here " +
      "rests on one of them; the replicate selector moves between them.",
  ],
  [
    "Classification",
    "Responses are checked mechanically, never judged. A grid must be the requested " +
      "number of rows at the requested width; hex must be four digits per row. Where a " +
      "target returns both forms, the grid is converted and compared against the hex the " +
      "model wrote. Legibility is not scored.",
  ],
];
