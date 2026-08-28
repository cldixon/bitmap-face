"""The schema is the contract between the runner, the exporter and the panel."""

import json

from bitmap_face.schema import Attempt, Batch, Call, Condition, Prompts, Run, Target, Totals


def condition(**kw) -> Condition:
    return Condition(model="claude-opus-5", **kw)


def test_the_slug_names_the_cell_not_the_moment() -> None:
    assert condition().slug == "opus-5-both-batch-all-ref6"
    assert condition(target=Target.HEX_ONLY, references=0).slug == "opus-5-hex_only-batch-all-ref0"
    assert condition(batch=Batch.ONE, context=2).slug == "opus-5-both-batch-one-ref6-ctx2"
    assert condition(effort="max").slug == "opus-5-both-batch-all-ref6-max"


def test_conditions_are_hashable_so_repeats_can_be_grouped() -> None:
    assert condition() == condition()
    assert len({condition(), condition(), condition(effort="low")}) == 2


def test_optional_axes_stay_out_of_the_slug_when_unused() -> None:
    # A cell that never set context should not be renamed by adding the field.
    assert "ctx" not in condition().slug
    assert "None" not in condition().slug


def test_agreement_rate_is_none_when_nothing_is_measurable() -> None:
    totals = Totals(
        1, 1, 1, measurable=0, agreed=0, input_tokens=0, output_tokens=0, duration_seconds=0
    )
    assert totals.agreement_rate is None
    totals = Totals(
        4, 4, 4, measurable=4, agreed=3, input_tokens=0, output_tokens=0, duration_seconds=0
    )
    assert totals.agreement_rate == 0.75


def test_a_run_serialises_to_plain_json() -> None:
    run = Run(
        id="x",
        started_at="now",
        condition=condition(),
        repeat=1,
        calls=[Call(0, ["happy"], 1.0, 10, 20)],
        attempts=[Attempt(expression="happy", tier="easy", well_formed=True, agrees=True)],
        totals=Totals(
            requested=1,
            returned=1,
            well_formed=1,
            measurable=1,
            agreed=1,
            input_tokens=10,
            output_tokens=20,
            duration_seconds=1.0,
        ),
    )
    blob = run.to_json()
    # Round trips through JSON with no custom encoder -- the panel reads this.
    assert json.loads(json.dumps(blob)) == blob
    assert blob["condition"]["target"] == "both"
    assert blob["condition"]["slug"] == "opus-5-both-batch-all-ref6"
    assert blob["totals"]["agreement_rate"] == 1.0
    assert blob["schema_version"] >= 2


def test_prompt_tokens_include_the_cached_prefix() -> None:
    # input_tokens is the *uncached* remainder, so a run that caches heavily
    # would look almost free if only that field were read.
    call = Call(
        0,
        ["happy"],
        1.0,
        input_tokens=100,
        output_tokens=50,
        cache_read_input_tokens=900,
        cache_creation_input_tokens=20,
    )
    assert call.prompt_tokens == 1020


def test_answer_tokens_separate_reasoning_from_output() -> None:
    totals = Totals(
        1,
        1,
        1,
        1,
        1,
        input_tokens=10,
        output_tokens=21957,
        thinking_tokens=21000,
        duration_seconds=1.0,
    )
    assert totals.answer_tokens == 957
    assert totals.prompt_tokens == 10


def test_the_expression_set_is_part_of_the_cell() -> None:
    # A run of one expression is not a repeat of a run of twelve. Grouping them
    # produced scores averaged over faces that were never attempted.
    full = condition()
    one = condition(expressions=("happy",))
    assert full.slug != one.slug
    assert one.slug.endswith("-happy")


def test_two_different_subsets_of_the_same_size_stay_distinct() -> None:
    a = condition(expressions=("happy", "sad", "angry", "wink"))
    b = condition(expressions=("kiss", "smug", "yuck", "nerdy"))
    assert a.slug != b.slug
    assert a.slug.startswith("opus-5-both-batch-all-ref6-e4-")


def test_subset_order_does_not_change_the_cell() -> None:
    a = condition(expressions=("happy", "sad", "angry", "wink"))
    b = condition(expressions=("wink", "angry", "sad", "happy"))
    assert a.slug == b.slug


def test_the_full_set_carries_no_tag() -> None:
    assert condition().slug == "opus-5-both-batch-all-ref6"


def test_the_record_carries_what_was_actually_sent() -> None:
    run = Run(
        id="x",
        started_at="now",
        condition=condition(),
        repeat=1,
        calls=[Call(0, ["happy"], 1.0, 10, 20, prompt="draw a happy face")],
        attempts=[Attempt(expression="happy", tier="easy")],
        totals=Totals(
            requested=1,
            returned=1,
            well_formed=1,
            measurable=0,
            agreed=0,
            input_tokens=10,
            output_tokens=20,
            duration_seconds=1.0,
        ),
        prompts=Prompts(system="you draw icons", response_schema={"type": "object"}),
    )
    blob = run.to_json()
    assert blob["prompts"]["system"] == "you draw icons"
    assert blob["prompts"]["response_schema"] == {"type": "object"}
    assert blob["calls"][0]["prompt"] == "draw a happy face"
    assert json.loads(json.dumps(blob)) == blob
