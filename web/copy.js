/** Every word the panel says, in one place. */

export const PAGES = {
  overview: {
    title: "Bitmap faces",
    intro:
      "A record of what language models do when asked to draw a 16 × 10 icon in the " +
      "format the original Macintosh stored it in.",
  },
  sheet: {
    title: "Form comparison",
    intro:
      "One model across the full expression set, in every written form it was asked " +
      "for. Each block is an expression.",
  },
  compare: {
    title: "Model comparison",
    intro:
      "One expression across every model, in all three written forms, with the prompt " +
      "held fixed. Only the model and its effort setting differ.",
  },
  inspect: {
    title: "Inspect",
    intro:
      "A single attempt in full: each written form returned, and the rows of the grid " +
      "set against the hex written for them.",
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
    "Every condition is run more than once. Nothing here is a single sample, and the " +
      "try selector moves between them.",
  ],
  [
    "Classification",
    "Responses are checked mechanically, never judged. A grid must be the requested " +
      "number of rows at the requested width; hex must be four digits per row. Where a " +
      "target returns both forms, the grid is converted and compared against the hex the " +
      "model wrote. Legibility is not scored.",
  ],
];
