"""
bitface — experiments in whether a language model can work in a 1-bit bitmap.

    bitface expressions                       the standard set
    bitface draw happy                        one face, one call
    bitface draw happy --target transcribe
    bitface run --repeats 3 --concurrency 4   the whole set, three times
    bitface export --to ../website/src/data/face-runs
    bitface panel                             the control panel
"""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Annotated

import typer
from anthropic import Anthropic
from rich.console import Console
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
    TimeElapsedColumn,
)
from rich.table import Table

from bitmap_face.expressions import EXPRESSIONS, resolve
from bitmap_face.bitmap import bits_from_grid, bits_from_hex
from bitmap_face.chassis import compose
from bitmap_face.outcome import classify as outcome
from bitmap_face.outcome import note
from bitmap_face.run import DRAFTS, run_condition, save
from bitmap_face.schema import Attempt, Batch, Condition, ReferenceSet, Run, Suite, Target

app = typer.Typer(
    help=__doc__,
    add_completion=False,
    no_args_is_help=True,
    rich_markup_mode="rich",
)
console = Console()
ROOT = Path(__file__).resolve().parent.parent

# The four outcomes, and how each reads at a glance while a run is in flight.
MARKS = {
    "agrees": ("[green]✓[/]", "green"),
    "differs": ("[red]✗[/]", "red"),
    "malformed": ("[yellow]![/]", "yellow"),
    "missing": ("[dim]·[/]", "dim"),
    "drawn": ("[cyan]•[/]", "cyan"),
}


def blocks(bitmap: list[list[int]]) -> list[str]:
    """
    A bitmap as half-block characters, two pixel rows to a line.

    A terminal cell is about twice as tall as it is wide, so one character per
    pixel renders every face stretched to twice its height. Packing two rows
    into one cell with the upper and lower half blocks gets the proportions
    right, which matters when the whole question is whether the thing reads as
    a face.
    """
    lines = []
    width = len(bitmap[0]) if bitmap else 0
    for y in range(0, len(bitmap), 2):
        top = bitmap[y]
        bottom = bitmap[y + 1] if y + 1 < len(bitmap) else [0] * width
        lines.append(
            "".join(
                "\u2588" if t and b else "\u2580" if t else "\u2584" if b else " "
                for t, b in zip(top, bottom)
            )
        )
    return lines


def side_by_side(panes: list[tuple[str, list[str]]], gap: str = "   ") -> str:
    """Lay rendered bitmaps out in a row, each under its label."""
    if not panes:
        return ""
    # Each pane keeps its own width. Padding them all to the widest -- the 32
    # wide chassis -- tripled the line length and wrapped the whole row.
    widths = [max((len(line) for line in lines), default=0) for _, lines in panes]
    widths = [max(w, len(label)) for w, (label, _) in zip(widths, panes)]
    height = max(len(lines) for _, lines in panes)
    header = gap.join(label.ljust(w) for (label, _), w in zip(panes, widths))
    rows = [
        gap.join(
            (lines[i] if i < len(lines) else "").ljust(w) for (_, lines), w in zip(panes, widths)
        )
        for i in range(height)
    ]
    return "\n".join([f"[dim]{header}[/]", *rows])


def show(attempt: Attempt, c: Condition) -> None:
    """Render one attempt: the picture, then the rows, then any faults."""
    W, H = c.width, c.height

    def fit(bits: list[list[int]]) -> list[list[int]]:
        """Exactly H rows of W. A malformed face still has to draw."""
        rows = [(row + [0] * W)[:W] for row in bits[:H]]
        return rows + [[0] * W for _ in range(H - len(rows))]

    drawn = fit(bits_from_grid(attempt.grid, W)) if attempt.grid else None
    given = fit(bits_from_grid(attempt.given_grid, W)) if attempt.given_grid else None
    written = fit(bits_from_hex(attempt.hex, W)) if attempt.hex else None

    panes: list[tuple[str, list[str]]] = []
    if given:
        panes.append(("given", blocks(given)))
    if drawn:
        panes.append(("drawn", blocks(drawn)))
    if written:
        panes.append(("written", blocks(written)))
    primary = drawn or given or written
    if primary:
        panes.append(("in the chassis", blocks(compose(primary))))

    if panes:
        console.print()
        console.print(side_by_side(panes), highlight=False)

    # The rows, with the disagreements called out. This is where a one-column
    # slip is visible; the pictures alone will not show it.
    grid_rows = attempt.grid or attempt.given_grid
    if attempt.hex or grid_rows:
        table = Table(box=None, pad_edge=False, header_style="dim", padding=(0, 2, 0, 0))
        table.add_column("row", justify="right")
        if grid_rows:
            table.add_column("grid")
        if attempt.hex:
            table.add_column("wrote")
            table.add_column("should be")
        want = attempt.hex_from_grid or attempt.expected_hex
        for y in range(H):
            differs = y in attempt.differing_rows
            style = "red" if differs else None
            cells = [str(y)]
            if grid_rows:
                cells.append((grid_rows[y] if y < len(grid_rows) else "").ljust(W))
            if attempt.hex:
                cells.append(attempt.hex[y] if y < len(attempt.hex) else "—")
                cells.append(want[y] if differs and want and y < len(want) else "")
            table.add_row(*cells, style=style)
        console.print()
        console.print(table)

    for fault in attempt.faults:
        console.print(f"  [yellow]fault[/] {fault}")
    console.print()


# --------------------------------------------------------------------------- shared options

ModelOpt = Annotated[str, typer.Option("--model", "-m", help="Model id.")]
TargetOpt = Annotated[
    Target, typer.Option("--target", "-t", help="Which written forms to ask for.")
]
BatchOpt = Annotated[Batch, typer.Option("--batch", help="One call for the set, or a call each.")]
RefsOpt = Annotated[
    int, typer.Option("--references", "-r", help="ROM examples; 0 is the blind control.")
]
SetOpt = Annotated[
    ReferenceSet,
    typer.Option("--reference-set", help="Which corpus the examples come from."),
]
NoCopyOpt = Annotated[
    bool, typer.Option("--no-copy", help="Tell the model not to reproduce the examples.")
]
CtxOpt = Annotated[
    int, typer.Option("--context", help="Prior faces shown; forces sequential calls.")
]
EffortOpt = Annotated[str | None, typer.Option("--effort", help="low…max; unavailable on Haiku.")]
MaxTokOpt = Annotated[int, typer.Option("--max-tokens", help="Ceiling on thinking plus output.")]


def build(
    model,
    target,
    batch,
    references,
    context,
    effort,
    names=None,
    *,
    reference_set=ReferenceSet.FACES,
    no_copy=False,
) -> Condition:
    """
    Assemble the cell.

    `names` is part of the cell's identity, because a run of two expressions is
    not a repeat of a run of twelve, and grouping them averages a score over
    faces that were never attempted. The full standard set is the default and
    carries no tag, so the common case stays readable.
    """
    wanted = tuple(e.name for e in resolve(names)) if names else ()
    if len(wanted) == len(EXPRESSIONS):
        wanted = ()
    return Condition(
        model=model,
        target=target,
        batch=batch,
        references=references,
        context=context,
        effort=effort,
        expressions=wanted,
        reference_set=reference_set,
        no_copy=no_copy,
    )


def execute_and_report(
    condition: Condition,
    names: list[str] | None,
    repeats: int,
    concurrency: int,
    max_tokens: int,
    *,
    into: Path | None = None,
    render: bool = False,
    source_grids: dict[int, dict[str, list[str]]] | None = None,
    suite: Suite | None = None,
    quiet: bool = False,
) -> list[Run]:
    """Run a condition with a live progress display, then summarise."""
    wanted = resolve(names)
    calls_each = 1 if condition.batch is Batch.ALL else len(wanted)

    if condition.context and concurrency > 1:
        console.print(
            f"[dim]--context {condition.context} chains the calls, so within a repeat they stay "
            f"sequential; {concurrency} workers run across repeats.[/]"
        )

    console.print(
        f"[bold]{condition.slug}[/]  ·  {len(wanted)} expression(s)  ·  "
        f"{repeats} repeat(s)  ·  {calls_each * repeats} call(s)  ·  {concurrency} worker(s)\n"
    )

    lock = Lock()
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(bar_width=28),
        TaskProgressColumn(),
        TimeElapsedColumn(),
        console=console,
        transient=True,
    ) as progress:
        bars = {
            r: progress.add_task(f"repeat {r}/{repeats}", total=len(wanted))
            for r in range(1, repeats + 1)
        }

        def on_attempt(repeat: int, attempt: Attempt) -> None:
            mark, colour = MARKS[outcome(attempt)]
            with lock:
                progress.advance(bars[repeat])
                # When each attempt is about to be rendered in full, the
                # one-line version underneath it is just noise.
                if render:
                    return
                detail = note(attempt)
                progress.console.print(
                    f"  {mark} [bold]{attempt.expression}[/] [dim]{attempt.tier}[/]"
                    + (f"  [{colour}]{detail}[/]" if detail else "")
                    + (f" [dim]r{repeat}[/]" if repeats > 1 else "")
                )

        runs = run_condition(
            Anthropic(),
            condition,
            wanted,
            repeats=repeats,
            max_tokens=max_tokens,
            concurrency=concurrency,
            on_attempt=on_attempt,
            source_grids=source_grids,
            suite=suite,
        )

    if render:
        for run in runs:
            for attempt in run.attempts:
                mark, _ = MARKS[outcome(attempt)]
                console.print(f"\n{mark} [bold]{attempt.expression}[/] [dim]{attempt.tier}[/]")
                show(attempt, condition)

    if not quiet:
        summarise(runs)
    # Relative, and never wrapped: a wrapped path cannot be copied.
    for run in runs:
        console.print(
            f"[dim]wrote {save(run, into).relative_to(ROOT)}[/]", crop=False, overflow="ignore"
        )
    return runs


def summarise(runs: list[Run]) -> None:
    table = Table(box=None, pad_edge=False, header_style="dim")
    for name, justify in (
        ("repeat", "right"),
        ("formed", "right"),
        ("agreed", "right"),
        ("rate", "right"),
        ("prompt", "right"),
        ("output", "right"),
        ("thinking", "right"),
        ("elapsed", "right"),
    ):
        table.add_column(name, justify=justify)

    for run in runs:
        t = run.totals
        rate = "n/a" if t.agreement_rate is None else f"{t.agreement_rate:.0%}"
        table.add_row(
            str(run.repeat),
            f"{t.well_formed}/{t.returned}",
            f"{t.agreed}/{t.measurable}",
            rate,
            f"{t.prompt_tokens:,}",
            f"{t.output_tokens:,}",
            f"{t.thinking_tokens:,}" if t.thinking_tokens else "—",
            f"{t.duration_seconds:.0f}s",
        )

    console.print()
    console.print(table)

    if len(runs) > 1:
        rates = [r.totals.agreement_rate for r in runs if r.totals.agreement_rate is not None]
        if rates:
            spread = (
                f"{min(rates):.0%}–{max(rates):.0%}"
                if min(rates) != max(rates)
                else f"{rates[0]:.0%}"
            )
            console.print(
                f"\n[bold]agreement across repeats[/]  {sum(rates) / len(rates):.0%}  ({spread})"
            )
    console.print()


# --------------------------------------------------------------------------- commands


@app.command()
def expressions() -> None:
    """List the standard expression set."""
    table = Table(box=None, pad_edge=False, header_style="dim")
    table.add_column("name")
    table.add_column("tier")
    table.add_column("description")
    table.add_column("from ROM", style="dim")
    for e in EXPRESSIONS:
        table.add_row(e.name, str(e.tier), e.description, e.rom or "—")
    console.print(table)
    console.print(f"\n[dim]{len(EXPRESSIONS)} expressions[/]")


@app.command()
def draw(
    expression: Annotated[
        list[str] | None, typer.Argument(help="Names; defaults to happy.")
    ] = None,
    model: ModelOpt = "claude-haiku-4-5",
    target: TargetOpt = Target.BOTH,
    batch: BatchOpt = Batch.ALL,
    references: RefsOpt = 6,
    reference_set: SetOpt = ReferenceSet.FACES,
    no_copy: NoCopyOpt = False,
    context: CtxOpt = 0,
    effort: EffortOpt = None,
    max_tokens: MaxTokOpt = 48000,
) -> None:
    """One expression, one call. The atomic unit — reach for this first."""
    names = expression or ["happy"]
    execute_and_report(
        build(
            model,
            target,
            batch,
            references,
            context,
            effort,
            names,
            reference_set=reference_set,
            no_copy=no_copy,
        ),
        names,
        repeats=1,
        concurrency=1,
        max_tokens=max_tokens,
        into=DRAFTS,
        render=True,
    )


@app.command()
def run(
    expression: Annotated[list[str] | None, typer.Argument(help="Names; defaults to all.")] = None,
    model: ModelOpt = "claude-haiku-4-5",
    target: TargetOpt = Target.BOTH,
    batch: BatchOpt = Batch.ALL,
    references: RefsOpt = 6,
    reference_set: SetOpt = ReferenceSet.FACES,
    no_copy: NoCopyOpt = False,
    context: CtxOpt = 0,
    effort: EffortOpt = None,
    max_tokens: MaxTokOpt = 48000,
    repeats: Annotated[
        int, typer.Option("--repeats", "-n", help="Independent runs of the cell.")
    ] = 1,
    concurrency: Annotated[
        int, typer.Option("--concurrency", "-c", help="Calls in flight at once.")
    ] = 4,
) -> None:
    """The whole expression set, optionally repeated."""
    execute_and_report(
        build(
            model,
            target,
            batch,
            references,
            context,
            effort,
            expression,
            reference_set=reference_set,
            no_copy=no_copy,
        ),
        expression,
        repeats=repeats,
        concurrency=concurrency,
        max_tokens=max_tokens,
    )


@app.command()
def export(
    to: Annotated[Path | None, typer.Option("--to", help="Also sync run files here.")] = None,
) -> None:
    """Rebuild the index, and optionally sync runs to the blog."""
    from bitmap_face.export import main as export_main

    sys.argv = ["bitface export"] + (["--to", str(to)] if to else [])
    export_main()


@app.command()
def panel(
    port: Annotated[int, typer.Option("--port", "-p")] = 4400,
) -> None:
    """Start the control panel (needs bun)."""
    console.print(f"[bold]control panel[/]  http://localhost:{port}")
    try:
        subprocess.run(
            ["bun", "run", "web/server.ts"],
            cwd=ROOT,
            env={**os.environ, "PORT": str(port)},
            check=True,
        )
    except FileNotFoundError:
        console.print("[red]bun not found.[/] The panel is a Bun app: https://bun.sh")
        raise typer.Exit(1) from None
    except KeyboardInterrupt:
        console.print("\n[dim]stopped[/]")


@app.command()
def suite(
    model: ModelOpt = "claude-haiku-4-5",
    effort: EffortOpt = None,
    references: RefsOpt = 0,
    reference_set: SetOpt = ReferenceSet.SHAPES,
    no_copy: NoCopyOpt = False,
    batch: BatchOpt = Batch.ALL,
    repeats: Annotated[
        int, typer.Option("--repeats", "-n", help="Independent runs per target.")
    ] = 3,
    concurrency: Annotated[int, typer.Option("--concurrency", "-c")] = 4,
    max_tokens: MaxTokOpt = 48000,
) -> None:
    """
    One model, swept across all four targets. The unit of comparison.

    The targets chain on the same expression: draw it with no encoding burden,
    then encode that exact grid, then compose straight in hex, then do both at
    once. So grid_only runs first and its output becomes what transcribe is
    asked to encode -- the question is "can you encode the thing you just drew",
    not "can you encode a face somebody else drew".
    """
    started = datetime.now(UTC)
    suite_id = f"{started.strftime('%Y%m%dT%H%M%SZ')}-{model.removeprefix('claude-')}"
    order = [Target.GRID_ONLY, Target.TRANSCRIBE, Target.HEX_ONLY, Target.BOTH]
    meta = Suite(
        id=suite_id,
        label=f"{model.removeprefix('claude-')} · {references or 'no'} {reference_set.value if references else ''} refs".strip(),
        targets=[str(t) for t in order],
        repeats=repeats,
    )

    console.print(f"[bold]suite {suite_id}[/]  ·  {len(order)} targets × {repeats} repeats\n")

    #: grid_only's drawings, per repeat, are what transcribe is handed.
    source_grids: dict[int, dict[str, list[str]]] = {}
    collected: list[Run] = []

    for target in order:
        condition = build(
            model,
            target,
            batch,
            references,
            0,
            effort,
            reference_set=reference_set,
            no_copy=no_copy,
        )
        console.rule(f"[bold]{target.value}[/]", style="dim")
        if target is Target.TRANSCRIBE and not any(source_grids.values()):
            #: Nothing was drawn well enough to hand back, so there is no grid to
            #: ask about. Sending the prompt anyway would spend a call on "encode
            #: the following grids:" followed by nothing, and record the shrug as
            #: data. That the model never got this far is the finding.
            console.print(
                "[yellow]skipped:[/] no well formed grid came out of grid_only, "
                "so there is nothing of the model's own to encode."
            )
            continue
        runs = execute_and_report(
            condition,
            None,
            repeats,
            concurrency,
            max_tokens,
            source_grids=source_grids if target is Target.TRANSCRIBE else None,
            suite=meta,
        )
        collected.extend(runs)

        if target is Target.TRANSCRIBE:
            #: The whole point of this cell is that the model encodes its own
            #: drawing. A grid from anywhere else means the chain broke, and the
            #: number it produces would answer a different question -- so say so
            #: rather than let it read as a result.
            mine = {tuple(g) for per_repeat in source_grids.values() for g in per_repeat.values()}
            given = [a.given_grid for r in runs for a in r.attempts if a.given_grid]
            foreign = [g for g in given if tuple(g) not in mine]
            if foreign or not given:
                console.print(
                    f"[bold red]chain broken:[/] {len(foreign)}/{len(given)} transcribed grids "
                    "did not come from this suite's grid_only pass."
                )
            else:
                console.print(f"[dim]chain intact: all {len(given)} grids are the model's own.[/]")

        if target is Target.GRID_ONLY:
            for run in runs:
                source_grids[run.repeat] = {
                    a.expression: a.grid for a in run.attempts if a.grid and a.well_formed
                }
            #: transcribe can only ask about faces that came out well formed, so a
            #: weak grid_only pass narrows it. Say so rather than let the smaller
            #: denominator read as a smaller sample.
            carried = sum(len(g) for g in source_grids.values())
            asked = sum(len(r.attempts) for r in runs)
            if carried < asked:
                console.print(
                    f"[yellow]{carried}/{asked} grids were well formed; "
                    f"transcribe runs on those only.[/]"
                )

    console.print()
    console.rule("[bold]suite[/]", style="dim")
    table = Table(box=None, pad_edge=False, header_style="dim")
    for name in ("target", "formed", "agreed", "rate", "copied", "output", "elapsed"):
        table.add_column(name, justify="right" if name != "target" else "left")
    for target in order:
        runs = [r for r in collected if r.condition.target is target]
        t = [r.totals for r in runs]
        rates = [x.agreement_rate for x in t if x.agreement_rate is not None]
        copies = sum(1 for r in runs for a in r.attempts if a.copied)
        table.add_row(
            target.value,
            f"{sum(x.well_formed for x in t)}/{sum(x.returned for x in t)}",
            f"{sum(x.agreed for x in t)}/{sum(x.measurable for x in t)}"
            if any(x.measurable for x in t)
            else "—",
            f"{sum(rates) / len(rates):.0%}" if rates else "—",
            str(copies) if references else "—",
            f"{sum(x.output_tokens for x in t):,}",
            f"{sum(x.duration_seconds for x in t):.0f}s",
        )
    console.print(table)
    console.print(f"\n[dim]{len(collected)} runs · suite {suite_id}[/]")
    console.print("[dim]transcribe is chained to this suite's own grid_only output.[/]")


if __name__ == "__main__":
    app()
