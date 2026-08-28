"""
Turn a directory of run records into something small enough to read.

A run record holds every pixel of every attempt, which is what the panel needs
and exactly what nobody -- human or model -- should page through to answer "how
did Haiku do at transcription". This writes an index: one compact row per run,
plus a roll-up per condition so repeats can be compared, and no pixels anywhere.

Read the index. Reach for a run record only to render it.

    face-export                                      rebuild data/index.json
    face-export --to ../website/src/data/face-runs   and sync for the blog
"""

from __future__ import annotations

import argparse
import json
import shutil
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from statistics import mean
from typing import Any

from bitmap_face.outcome import fault_kind as classify

RUNS = Path(__file__).resolve().parent.parent / "data" / "runs"
INDEX = Path(__file__).resolve().parent.parent / "data" / "index.json"


def summarise(path: Path) -> dict[str, Any]:
    record = json.loads(path.read_text())
    condition, totals, attempts = record["condition"], record["totals"], record["attempts"]

    faults: Counter[str] = Counter()
    for attempt in attempts:
        for fault in attempt["faults"]:
            faults[classify(fault)] += 1

    # How wrong the disagreements were, not just how many. A one-row slip and a
    # face whose hex bears no relation to its grid are different findings.
    spread = [len(a["differing_rows"]) for a in attempts if a["agrees"] is False]

    # Per-expression outcome, so a heat map needs nothing but the index.
    by_expression = {
        a["expression"]: {
            "tier": a["tier"],
            "well_formed": a["well_formed"],
            "agrees": a["agrees"],
            "differing_rows": len(a["differing_rows"]),
        }
        for a in attempts
    }

    return {
        "id": record["id"],
        "file": path.name,
        "schema_version": record.get("schema_version", 1),
        "started_at": record["started_at"],
        "repeat": record["repeat"],
        "condition": condition,
        "slug": condition["slug"],
        "totals": totals,
        "calls": len(record["calls"]),
        "faults": dict(sorted(faults.items())),
        "differing_rows": {
            "count": len(spread),
            "median": sorted(spread)[len(spread) // 2] if spread else 0,
            "max": max(spread, default=0),
        },
        "expressions": by_expression,
    }


def roll_up(runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per condition, across its repeats. This is the comparison table."""
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for run in runs:
        grouped[run["slug"]].append(run)

    out = []
    for slug, group in sorted(grouped.items()):
        rates = [
            r["totals"]["agreement_rate"]
            for r in group
            if r["totals"]["agreement_rate"] is not None
        ]
        out.append(
            {
                "slug": slug,
                "condition": group[0]["condition"],
                "repeats": len(group),
                "runs": [r["id"] for r in group],
                "well_formed": sum(r["totals"]["well_formed"] for r in group),
                "returned": sum(r["totals"]["returned"] for r in group),
                "agreed": sum(r["totals"]["agreed"] for r in group),
                "measurable": sum(r["totals"]["measurable"] for r in group),
                # Spread across repeats is the point of repeating: a condition that
                # scores 100% and 12% is not the same as one that scores 56% twice.
                "agreement_rate": {
                    "mean": round(mean(rates), 4) if rates else None,
                    "min": min(rates, default=None),
                    "max": max(rates, default=None),
                },
                "output_tokens": sum(r["totals"]["output_tokens"] for r in group),
                "duration_seconds": round(sum(r["totals"]["duration_seconds"] for r in group), 2),
            }
        )
    return out


def build_index(runs_dir: Path = RUNS) -> dict[str, Any]:
    runs = [summarise(p) for p in sorted(runs_dir.glob("*.json"))]
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "count": len(runs),
        "conditions": roll_up(runs),
        "runs": runs,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=Path, default=RUNS)
    parser.add_argument("--to", type=Path, default=None, help="also sync run files here")
    args = parser.parse_args()

    index = build_index(args.runs)
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(index, indent=2) + "\n")

    print(f"{'condition':<44} {'rep':>3} {'formed':>7} {'agreed':>8} {'rate':>16} {'out tok':>8}")
    print("-" * 92)
    for c in index["conditions"]:
        rate = c["agreement_rate"]
        band = (
            "n/a"
            if rate["mean"] is None
            else f"{rate['mean']:.0%}"
            if rate["min"] == rate["max"]
            else f"{rate['mean']:.0%} ({rate['min']:.0%}-{rate['max']:.0%})"
        )
        print(
            f"{c['slug']:<44} {c['repeats']:>3} {c['well_formed']:>3}/{c['returned']:<3} "
            f"{c['agreed']:>3}/{c['measurable']:<4} {band:>16} {c['output_tokens']:>8}"
        )
    print(f"\n{index['count']} runs across {len(index['conditions'])} conditions -> {INDEX}")

    if args.to:
        args.to.mkdir(parents=True, exist_ok=True)
        for run in index["runs"]:
            shutil.copyfile(args.runs / run["file"], args.to / f"{run['id']}.json")
        synced = {**index, "runs": [{**r, "file": f"{r['id']}.json"} for r in index["runs"]]}
        (args.to / "index.json").write_text(json.dumps(synced, indent=2) + "\n")
        print(f"Synced {index['count']} runs + index to {args.to}")


if __name__ == "__main__":
    main()
