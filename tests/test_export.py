"""The index is read instead of the run records, so it must stay small."""

import json

from bitmap_face.export import build_index, classify


def test_faults_fold_into_countable_kinds() -> None:
    assert classify("grid row 7 is 15 wide: '···'") == "grid_row_width"
    assert classify("grid row 7 uses '─'") == "grid_stray_character"
    assert classify("hex row 2 is '08A'") == "hex_row_malformed"
    assert classify("something new") == "other"


def _record(**over):
    base = {
        "id": "r1",
        "started_at": "2026-01-01T00:00:00+00:00",
        "replicate": 1,
        "schema_version": 3,
        "condition": {
            "model": "claude-haiku-4-5",
            "slug": "haiku-4-5-both-batch-all-ref6",
            "target": "both",
            "batch": "all",
            "references": 6,
            "expressions": [],
        },
        "calls": [
            {
                "index": 0,
                "expressions": ["happy"],
                "duration_seconds": 1.0,
                "input_tokens": 10,
                "output_tokens": 20,
                "prompt": "SECRET_PROMPT_TEXT draw a happy face",
            }
        ],
        "attempts": [
            {
                "expression": "happy",
                "tier": "easy",
                "faults": [],
                "well_formed": True,
                "agrees": True,
                "differing_rows": [],
                "grid": ["████"],
                "hex": ["F"],
            }
        ],
        "totals": {
            "requested": 1,
            "returned": 1,
            "well_formed": 1,
            "measurable": 1,
            "agreed": 1,
            "input_tokens": 10,
            "output_tokens": 20,
            "duration_seconds": 1.0,
            "agreement_rate": 1.0,
        },
        "prompts": {"system": "SECRET_SYSTEM_TEXT", "response_schema": {"type": "object"}},
    }
    return {**base, **over}


def test_the_index_carries_neither_pixels_nor_prompts(tmp_path) -> None:
    (tmp_path / "one.json").write_text(json.dumps(_record()))
    index = build_index(tmp_path)
    blob = json.dumps(index)

    # Prompts are large and replicate per call; the index exists to be read at a
    # glance, and a prompt in it would dwarf everything else.
    assert "SECRET_PROMPT_TEXT" not in blob
    assert "SECRET_SYSTEM_TEXT" not in blob
    assert "█" not in blob
    assert not {"grid", "hex", "prompts", "calls_detail"} & set(index["runs"][0])
    assert index["runs"][0]["calls"] == 1
