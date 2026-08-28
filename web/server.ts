/**
 * The control panel: a local reader for the run records.
 *
 * Deliberately a plain Bun server over the files the experiments already write.
 * There is no build step and no framework -- the panel reads `data/runs/*.json`
 * straight off disk on every request, so a run that finishes while the panel is
 * open shows up on reload rather than after a rebuild.
 *
 *   bun run panel        ->  http://localhost:4400
 */
import { file } from "bun";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const RUNS = join(ROOT, "data", "runs");
const WEB = join(ROOT, "web");
const PORT = Number(Bun.env.PORT ?? 4400);

const TARGETS = ["grid_only", "transcribe", "hex_only", "both"] as const;

/**
 * What the panel compares.
 *
 * `transcribe` is deliberately absent. The other three ask the model to invent a
 * face; transcribe hands it a finished grid and asks it to bit-pack the rows, so
 * putting them side by side compares two different kinds of task. It is also
 * chained to each model's own drawing, which makes reading down that column
 * unfair in a way the others are not. The records are still written and kept --
 * this filters the view, not the data. See issue #1.
 */
const SHOWN = TARGETS.filter((t) => t !== "transcribe");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

async function allRecords(): Promise<any[]> {
  const names = (await readdir(RUNS)).filter((n) => n.endsWith(".json"));
  return Promise.all(names.map((name) => file(join(RUNS, name)).json()));
}

/**
 * Which of the five states an attempt reached.
 *
 * A mirror of bitmap_face/outcome.py, for the same reason bitmap.js mirrors
 * bitmap.py: the panel must name an outcome exactly the way the run was scored,
 * or it will show a verdict the record does not claim. Keep the two in step.
 */
function classify(a: any): string {
  if (a.missing) return "missing";
  if (!a.well_formed) return "malformed";
  if (a.agrees === true) return "agrees";
  if (a.agrees === false) return "differs";
  return "drawn";
}

/** Runs that predate suites still deserve to be looked at; they group by condition. */
const suiteKey = (r: any) => r.suite?.id ?? `loose:${r.condition.slug}`;

async function listSuites() {
  const grouped = new Map<string, any[]>();
  for (const record of await allRecords()) {
    const key = suiteKey(record);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(record);
  }

  return [...grouped.entries()]
    .map(([id, records]) => {
      records.sort((a, b) => a.started_at.localeCompare(b.started_at));
      const counts: Record<string, Record<string, number>> = {};
      for (const record of records) {
        const target = record.condition.target;
        counts[target] ??= {};
        for (const attempt of record.attempts) {
          const state = classify(attempt);
          counts[target][state] = (counts[target][state] ?? 0) + 1;
        }
      }
      const c = records[0].condition;
      return {
        id,
        loose: !records[0].suite,
        label: records[0].suite?.label ?? c.slug,
        model: c.model,
        effort: c.effort,
        references: c.references,
        reference_set: c.reference_set,
        no_copy: c.no_copy,
        started_at: records[0].started_at,
        targets: SHOWN.filter((t) => t in counts),
        repeats: Math.max(...records.map((r) => r.repeat)),
        counts,
        output_tokens: records.reduce((n, r) => n + r.totals.output_tokens, 0),
        thinking_tokens: records.reduce((n, r) => n + (r.totals.thinking_tokens ?? 0), 0),
        duration_seconds: records.reduce((n, r) => n + r.totals.duration_seconds, 0),
      };
    })
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
}

/**
 * One suite, pivoted for looking at.
 *
 * The records are per run -- one target, one repeat. The panel wants the
 * opposite: for one expression, every way it was asked for. So this inverts
 * them into cells[expression][target] = one entry per repeat, and hands over
 * the prompts and token counts alongside rather than in a second request.
 */
async function suite(id: string) {
  const records = (await allRecords()).filter((r) => suiteKey(r) === id);
  if (!records.length) return null;
  records.sort((a, b) => a.started_at.localeCompare(b.started_at));

  const cells: Record<string, Record<string, any[]>> = {};
  const tiers: Record<string, string> = {};
  for (const record of records) {
    const target = record.condition.target;
    for (const attempt of record.attempts) {
      tiers[attempt.expression] = attempt.tier;
      cells[attempt.expression] ??= {};
      cells[attempt.expression][target] ??= [];
      cells[attempt.expression][target].push({
        repeat: record.repeat,
        run: record.id,
        outcome: classify(attempt),
        grid: attempt.grid,
        hex: attempt.hex,
        hex_from_grid: attempt.hex_from_grid,
        given_grid: attempt.given_grid,
        expected_hex: attempt.expected_hex,
        differing_rows: attempt.differing_rows ?? [],
        faults: attempt.faults ?? [],
        copied: attempt.copied ?? null,
      });
    }
  }
  for (const byTarget of Object.values(cells)) {
    for (const entries of Object.values(byTarget)) entries.sort((a, b) => a.repeat - b.repeat);
  }

  const c = records[0].condition;
  return {
    id,
    loose: !records[0].suite,
    label: records[0].suite?.label ?? c.slug,
    config: {
      model: c.model,
      effort: c.effort,
      references: c.references,
      reference_set: c.reference_set,
      no_copy: c.no_copy,
      batch: c.batch,
      context: c.context,
      width: c.width,
      height: c.height,
    },
    // Presentation order comes from the run, not from sorting: the expression
    // set is authored in a deliberate easy-to-hard order.
    expressions: records[0].attempts.map((a: any) => a.expression),
    tiers,
    targets: SHOWN.filter((t) => records.some((r) => r.condition.target === t)),
    repeats: Math.max(...records.map((r) => r.repeat)),
    cells,
    runs: records.map((r) => ({
      id: r.id,
      target: r.condition.target,
      repeat: r.repeat,
      started_at: r.started_at,
      totals: r.totals,
      system: r.prompts?.system ?? null,
      user: r.calls?.[0]?.prompt ?? null,
    })),
  };
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const { pathname } = new URL(request.url);

    // A tool that logs a console error on every load trains you to ignore them.
    if (pathname === "/favicon.ico") return new Response(null, { status: 204 });

    if (pathname === "/api/suites") return json(await listSuites());

    if (pathname.startsWith("/api/suites/")) {
      const id = decodeURIComponent(pathname.slice("/api/suites/".length));
      // The id is matched against record contents, never joined onto a path,
      // so there is nothing here that can walk the disk.
      const found = await suite(id);
      return found ? json(found) : json({ error: "no such suite" }, 404);
    }

    const asset = pathname === "/" ? "index.html" : pathname.slice(1);
    if (asset.includes("..")) return new Response("no", { status: 400 });
    const served = file(join(WEB, asset));
    if (await served.exists()) return new Response(served);

    return new Response("not found", { status: 404 });
  },
});

console.log(`control panel  http://localhost:${PORT}`);
console.log(`reading        ${RUNS}`);
