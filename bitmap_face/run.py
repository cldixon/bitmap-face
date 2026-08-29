"""
Executing an experimental condition.

The CLI lives in cli.py; this is the machinery underneath it.

CONCURRENCY

API calls dominate the wall clock -- a twelve-expression run one face at a time
is twelve round trips, and on a thinking model each is tens of seconds. Those
calls are independent, so they are run through a pool.

With one exception, which is load-bearing: `--context N` shows each call the
faces already drawn in that run, so those calls form a chain and *must* run in
order. Parallelising them would silently change the experiment -- every call
would see an empty context and the condition would no longer be the one named in
the record. So a context run parallelises across replicates and stays sequential
within one; everything else parallelises freely.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Lock
from pathlib import Path
from time import perf_counter
from typing import Any

from anthropic import Anthropic

from bitmap_face.bitmap import (
    EMPTY,
    FILLED,
    bits_from_grid,
    bits_from_hex,
    differing_rows,
    draw,
    hex_from_bits,
)
from bitmap_face.expressions import Expression
from bitmap_face.prompts import corpus, response_schema, system_prompt, user_prompt
from bitmap_face.reference import REFERENCE
from bitmap_face.schema import (
    Attempt,
    Batch,
    Call,
    Condition,
    Prompts,
    ReferenceSet,
    Run,
    Suite,
    Target,
    Totals,
)

DATA = Path(__file__).resolve().parent.parent / "data"
RUNS = DATA / "runs"
#: `draw` is for looking at one example, not for building the corpus, so its
#: records land here instead. The panel reads only RUNS, which keeps one-off
#: pokes out of the condition picker without throwing the data away.
DRAFTS = DATA / "drafts"


# --------------------------------------------------------------------------- scoring


def faults_in(grid: list[str] | None, hexes: list[str] | None, c: Condition) -> list[str]:
    """Everything wrong, named per row. Deliberately not a boolean."""
    faults: list[str] = []
    digits = c.width // 4

    if grid is not None:
        if len(grid) != c.height:
            faults.append(f"{len(grid)} grid rows, expected {c.height}")
        for y, row in enumerate(grid):
            chars = list(row)
            if len(chars) != c.width:
                faults.append(f"grid row {y} is {len(chars)} wide: {row!r}")
            strange = sorted({ch for ch in chars if ch not in (FILLED, EMPTY)})
            if strange:
                faults.append(f"grid row {y} uses {''.join(strange)!r}")

    if hexes is not None:
        if len(hexes) != c.height:
            faults.append(f"{len(hexes)} hex rows, expected {c.height}")
        for y, row in enumerate(hexes):
            if not re.fullmatch(rf"[0-9a-fA-F]{{{digits}}}", row):
                faults.append(f"hex row {y} is {row!r}")

    return faults


def copied_from(hexes: list[str] | None, c: Condition) -> str | None:
    """
    Which in-prompt example this face reproduces exactly, if any.

    Checked on every run rather than only when the model was told not to copy:
    Haiku and Sonnet returned four ROM faces pixel-for-pixel without ever being
    asked to, and a score that counts those as successes is measuring
    transcription, not drawing.
    """
    if not hexes or not c.references or c.reference_set is ReferenceSet.NONE:
        return None
    shown = list(corpus(c.reference_set).items())[: c.references]
    return next((name for name, rows in shown if rows == hexes), None)


def score(
    expression: Expression,
    returned: dict[str, Any] | None,
    c: Condition,
    *,
    given: list[str] | None = None,
    expected: list[str] | None = None,
) -> Attempt:
    """Turn one returned face into a scored attempt."""
    if returned is None:
        return Attempt(expression=expression.name, tier=str(expression.tier), missing=True)

    grid = returned.get("grid")
    hexes = returned.get("hex")
    faults = faults_in(grid, hexes, c)
    well_formed = not faults

    # Compare on hex whichever form came back, so a grid-only answer is checked
    # against the examples too.
    as_hex = hexes or (hex_from_bits(bits_from_grid(grid, c.width)[: c.height]) if grid else None)

    attempt = Attempt(
        expression=expression.name,
        tier=str(expression.tier),
        grid=grid,
        hex=hexes,
        faults=faults,
        well_formed=well_formed,
        given_grid=given,
        expected_hex=expected,
        copied=copied_from(as_hex, c),
    )

    if c.target is Target.TRANSCRIBE and expected is not None:
        # Ground truth: we made the grid, so we already know the answer.
        attempt.hex_from_grid = expected
        got = bits_from_hex(hexes or [], c.width)[: c.height]
        want = bits_from_hex(expected, c.width)[: c.height]
        attempt.differing_rows = differing_rows(want, got)
        attempt.agrees = well_formed and not attempt.differing_rows
    elif c.target is Target.BOTH and grid is not None and hexes is not None:
        from_grid = bits_from_grid(grid, c.width)[: c.height]
        from_hex = bits_from_hex(hexes, c.width)[: c.height]
        attempt.hex_from_grid = hex_from_bits(from_grid)
        attempt.differing_rows = differing_rows(from_grid, from_hex)
        attempt.agrees = well_formed and not attempt.differing_rows
    else:
        # GRID_ONLY and HEX_ONLY produce one form, so there is nothing to agree
        # with. Legibility is the measurement there, and it is not this one.
        attempt.agrees = None

    return attempt


# --------------------------------------------------------------------------- execution


def ask(
    client: Anthropic, c: Condition, prompt: str, max_tokens: int
) -> tuple[list[dict], Call, float]:
    """One API call. Streamed, because thinking models blow past a small budget."""
    clock = perf_counter()
    output_config: dict[str, Any] = {
        "format": {"type": "json_schema", "schema": response_schema(c)}
    }
    if c.effort:
        output_config["effort"] = c.effort
    kwargs: dict[str, Any] = {
        "model": c.model,
        "max_tokens": max_tokens,
        "system": system_prompt(c),
        "output_config": output_config,
        "messages": [{"role": "user", "content": prompt}],
    }

    with client.messages.stream(**kwargs) as stream:
        response = stream.get_final_message()
    elapsed = perf_counter() - clock

    if response.stop_reason == "refusal":
        raise SystemExit(f"Refused: {response.stop_details}")
    if response.stop_reason == "max_tokens":
        raise SystemExit(f"Truncated at max_tokens ({max_tokens}); raise --max-tokens.")

    text = next((b.text for b in response.content if b.type == "text"), "")
    faces = json.loads(text).get("faces", [])
    usage = response.usage
    call = Call(
        index=0,
        expressions=[],
        duration_seconds=round(elapsed, 2),
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cache_read_input_tokens=usage.cache_read_input_tokens or 0,
        cache_creation_input_tokens=usage.cache_creation_input_tokens or 0,
        thinking_tokens=getattr(usage.output_tokens_details, "thinking_tokens", 0) or 0,
        stop_reason=response.stop_reason,
    )
    return faces, call, elapsed


def transcribe_source(
    expression: Expression,
    width: int,
    source_grids: dict[str, list[str]] | None = None,
    *,
    allow_fallback: bool = True,
) -> tuple[list[str], list[str]] | None:
    """
    The grid to transcribe, and the hex we already know it to be.

    Inside a suite this is the model's *own* grid from the grid_only pass, so
    the question becomes "can you encode the thing you just drew" -- the sharpest
    form of it, and the one that separates encoding from composing. Either way
    the answer is computed by us, so there is exact ground truth.

    Standalone, with nothing drawn yet, it falls back to the ROM corpus so the
    command still works alone. A suite turns that fallback off: mixing ROM grids
    into a chained condition would both overstate how many faces carried through
    and hand the model the very grids it is most likely to have memorised.
    Returns None when no source is available, and the expression is skipped.
    """
    if source_grids and expression.name in source_grids:
        grid = source_grids[expression.name]
        return grid, hex_from_bits(bits_from_grid(grid, width))

    if allow_fallback and expression.rom in REFERENCE:
        hexes = REFERENCE[expression.rom]
        return draw(bits_from_hex(hexes, width)), hexes
    return None


@dataclass
class Task:
    """One API call: which replicate it belongs to, and which expressions it covers."""

    replicate: int
    index: int
    group: list[Expression]


def plan(c: Condition, wanted: tuple[Expression, ...], replicates: int) -> list[Task]:
    groups = [list(wanted)] if c.batch is Batch.ALL else [[e] for e in wanted]
    return [Task(r, i, g) for r in range(1, replicates + 1) for i, g in enumerate(groups)]


def _call_for(
    client: Anthropic,
    c: Condition,
    task: Task,
    max_tokens: int,
    context: list[tuple[str, list[str]]] | None,
    source_grids: dict[str, list[str]] | None = None,
) -> tuple[list[Attempt], Call]:
    """Run one task and score what comes back."""
    given = None
    if c.target is Target.TRANSCRIBE:
        sources = {
            e.name: transcribe_source(e, c.width, source_grids, allow_fallback=source_grids is None)
            for e in task.group
        }
        given = [(name, src[0]) for name, src in sources.items() if src is not None]

    prompt = user_prompt(c, task.group, context=context, given=given)
    faces, call, _ = ask(client, c, prompt, max_tokens)
    call.index = task.index
    call.expressions = [e.name for e in task.group]
    call.prompt = prompt

    # Match returned faces by name where possible, falling back to position -- a
    # model that renamed "yuck" to "disgusted" has still answered, and dropping
    # it would overstate the miss rate.
    by_name = {str(f.get("expression", "")).strip().lower(): f for f in faces}
    given_map = dict(given or [])
    attempts = []
    for j, expression in enumerate(task.group):
        returned = by_name.get(expression.name) or (faces[j] if j < len(faces) else None)
        expected = None
        if c.target is Target.TRANSCRIBE:
            source = transcribe_source(
                expression, c.width, source_grids, allow_fallback=source_grids is None
            )
            expected = source[1] if source else None
        attempts.append(
            score(expression, returned, c, given=given_map.get(expression.name), expected=expected)
        )
    return attempts, call


def _assemble(
    c: Condition, replicate: int, results: list[tuple[list[Attempt], Call]], started: datetime
) -> Run:
    calls = [call for _, call in results]
    attempts = [a for group, _ in results for a in group]
    measurable = [a for a in attempts if a.agrees is not None]
    totals = Totals(
        requested=len(attempts),
        returned=sum(1 for a in attempts if not a.missing),
        well_formed=sum(1 for a in attempts if a.well_formed),
        measurable=len(measurable),
        agreed=sum(1 for a in measurable if a.agrees),
        input_tokens=sum(k.input_tokens for k in calls),
        output_tokens=sum(k.output_tokens for k in calls),
        cache_read_input_tokens=sum(k.cache_read_input_tokens for k in calls),
        cache_creation_input_tokens=sum(k.cache_creation_input_tokens for k in calls),
        thinking_tokens=sum(k.thinking_tokens for k in calls),
        duration_seconds=round(sum(k.duration_seconds for k in calls), 2),
    )
    stamp = started.strftime("%Y%m%dT%H%M%SZ")
    return Run(
        id=f"{stamp}-{c.slug}-r{replicate}",
        started_at=started.isoformat(),
        condition=c,
        replicate=replicate,
        calls=calls,
        attempts=attempts,
        totals=totals,
        prompts=Prompts(system=system_prompt(c), response_schema=response_schema(c)),
    )


def run_condition(
    client: Anthropic,
    c: Condition,
    wanted: tuple[Expression, ...],
    *,
    replicates: int = 1,
    max_tokens: int = 48000,
    concurrency: int = 1,
    on_attempt: Callable[[int, Attempt], None] | None = None,
    source_grids: dict[int, dict[str, list[str]]] | None = None,
    suite: Suite | None = None,
) -> list[Run]:
    """
    Run a condition `replicates` times and return one Run each.

    `on_attempt(replicate, attempt)` fires as each expression is scored, so a caller
    can show progress while the pool works. It is called from worker threads.
    """
    started = datetime.now(UTC)
    tasks = plan(c, wanted, replicates)
    indices = sorted({t.index for t in tasks})
    results: dict[tuple[int, int], tuple[list[Attempt], Call]] = {}
    lock = Lock()

    def record(task: Task, outcome: tuple[list[Attempt], Call]) -> None:
        with lock:
            results[(task.replicate, task.index)] = outcome
        if on_attempt:
            for attempt in outcome[0]:
                on_attempt(task.replicate, attempt)

    def chain(replicate: int) -> None:
        """One replicate, in order, threading each face's grid into the next prompt."""
        drawn: list[tuple[str, list[str]]] = []
        for task in [t for t in tasks if t.replicate == replicate]:
            context = drawn[-c.context :] if drawn else None
            outcome = _call_for(
                client, c, task, max_tokens, context, (source_grids or {}).get(replicate)
            )
            record(task, outcome)
            for attempt in outcome[0]:
                if attempt.grid and attempt.well_formed:
                    drawn.append((attempt.expression, attempt.grid))

    workers = max(1, concurrency)
    if c.context:
        # Sequential within a replicate, parallel across them: the chain is the
        # experiment, so it cannot be broken up.
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for future in [pool.submit(chain, r) for r in range(1, replicates + 1)]:
                future.result()
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(
                    _call_for, client, c, t, max_tokens, None, (source_grids or {}).get(t.replicate)
                ): t
                for t in tasks
            }
            for future, task in futures.items():
                record(task, future.result())

    runs = [
        _assemble(c, replicate, [results[(replicate, i)] for i in indices], started)
        for replicate in range(1, replicates + 1)
    ]
    for run in runs:
        run.suite = suite
    return runs


# --------------------------------------------------------------------------- reporting


def save(run: Run, into: Path | None = None) -> Path:
    directory = into or RUNS
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{run.id}.json"
    path.write_text(json.dumps(run.to_json(), indent=2, ensure_ascii=False) + "\n")
    return path
