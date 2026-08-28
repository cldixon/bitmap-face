# bitmap-face

Can a language model work natively in a 1-bit bitmap format?

A 16 x 10 Macintosh face has two equally valid written forms — a grid of filled
and empty cells, and rows of hex — and both are text, so any model can emit
either. The open question is whether it holds both at once. This asks for a face
in both forms and checks them against each other.

Three outcomes, all worth recording:

| Result | Reading |
| --- | --- |
| Grid reads as a face, hex agrees | It works in this space |
| Grid reads as a face, hex disagrees | It can draw but not encode — the step done by hand in 1983 |
| Neither | It does not work in this space |

Experiments only. The interactive editors live in the blog repo; this produces
the data those posts draw on.

## Running

Needs an Anthropic API key:

```sh
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
set -a; . ./.env; set +a
```

```sh
uv run face-lab expressions                 # the standard set
uv run face-lab draw -e happy               # one face, one call — the atomic unit
uv run face-lab draw -e happy --target transcribe
uv run face-lab run --model claude-opus-5 --repeats 3
uv run face-lab run --batch one --context 2 --references 0
uv run face-export --to ../website/src/data/face-runs
uv run panel                                # control panel at :4400
```

Every run writes a complete record to `data/runs/`, malformed and missing faces
included — keeping only the successes would throw away the most interesting
material and would bias the corpus toward whichever faces were copied most
closely from the references.

## The axes

| Flag | What it varies |
| --- | --- |
| `--model` | Haiku 4.5, Sonnet 5, Opus 5 |
| `--target` | `both` · `grid_only` · `hex_only` · `transcribe` |
| `--batch` | `all` (one call for the set) or `one` (a call each) |
| `--references` | ROM faces shown as examples; `0` is the blind control |
| `--context` | prior faces shown when drawing one at a time |
| `--effort` | `low`…`max`; unavailable on Haiku 4.5 |
| `--repeats` | independent runs of the same cell |

The four targets answer different questions. **`both`** asks for the grid and the
hex together and measures whether they agree — consistency inside one
generation. **`grid_only`** is the control: does being asked for hex at all
degrade the drawing? **`hex_only`** asks whether it can compose directly in the
encoded form, with no grid to work from. **`transcribe`** hands it a grid from
the ROM and asks only for the hex — transcription is deterministic on our side,
so there is exact ground truth, which separates *can it encode* from *can it
encode while also composing a face*.

## What the record holds

```jsonc
{
  "run":   { "model": …, "references": 6, "input_tokens": …, "well_formed": 8, "agreed": 8 },
  "faces": [{
    "expression":     "laughing",
    "grid":           ["················", …],  // 10 rows, as drawn
    "hex":            ["0000", …],              // 10 rows, as the model wrote them
    "hex_from_grid":  ["0000", …],              // what a correct conversion gives
    "faults":         [],                       // per-row, named
    "well_formed":    true,
    "agrees":         true,
    "differing_rows": []
  }]
}
```

## Findings so far

Superseded. The numbers below came from runs where each model invented its own
expressions, so they were never comparable face to face — Sonnet drew *Laughing*
and *Crying* while Haiku drew *love* and *cool*, and part of "Haiku did worse"
was "Haiku attempted harder faces". Those runs have been dropped; the standard
expression set exists to fix exactly this.

What survived and is worth re-testing:

- Sonnet 5 with references produced 80 rows of hex that all matched their own
  grids. Opus 5 matched that at a third of the output tokens.
- Blind, Sonnet's failures were all the same error: `····█······█····`
  written `0808` when it is `0810` — it loses count crossing the middle of the
  row, which is the error a person doing this by hand makes. Pinned as a test in
  `tests/test_bitmap.py`.
- Haiku's failures were a different species: whole rows unrelated to its own
  grid, not near misses.
- Haiku swung between 3/4 and 1/7 agreement on the same condition, so single
  runs prove very little. Hence `--repeats`.


## Layout

```
bitmap_face/schema.py       what an experiment produces — read this first
bitmap_face/expressions.py  the standard expression set
bitmap_face/bitmap.py       the two forms and the conversion — no model in the loop
bitmap_face/reference.py    16 Happy Mac faces from the ROM
bitmap_face/chassis.py      the Mac the faces sit inside; compositing is ours
bitmap_face/prompts.py      per-target instructions and response schemas
bitmap_face/run.py          the experiment
bitmap_face/export.py       run records -> a compact index
web/                        the control panel: vanilla JS, no dependencies
tests/                      the conversion is the instrument, so it is tested first
data/runs/                  run records
```

`schema.py` is the contract. The runner writes it, the exporter and the panel
read it, and the panel's `web/bitmap.js` mirrors `bitmap.py` deliberately —
if a third copy appears, that is the moment to make it a shared package rather
than a mirror.

The reference faces are transcribed from Big Mess o' Wires,
[Hacking the Happy Mac](https://www.bigmessowires.com/2015/02/05/hacking-the-happy-mac/).
Faces only — the surrounding chassis is Apple's artwork and is not included.
