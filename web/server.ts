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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

async function allRecords() {
  const names = (await readdir(RUNS)).filter((n) => n.endsWith(".json"));
  return Promise.all(names.map((name) => file(join(RUNS, name)).json()));
}

/**
 * Conditions, not runs.
 *
 * Repeats of one cell are the same experiment run again, so listing them
 * separately hides the only thing repeating is for: the spread. A condition
 * that scores 100% and 12% is not the condition that scores 56% twice, and a
 * picker full of individual runs cannot tell you which one you have.
 */
async function listConditions() {
  const grouped = new Map<string, any[]>();
  for (const record of await allRecords()) {
    const slug = record.condition.slug;
    if (!grouped.has(slug)) grouped.set(slug, []);
    grouped.get(slug)!.push(record);
  }

  return [...grouped.entries()]
    .map(([slug, records]) => {
      records.sort((a, b) => a.started_at.localeCompare(b.started_at));
      const rates = records
        .map((r) => r.totals.agreement_rate)
        .filter((v) => v !== null && v !== undefined);
      return {
        slug,
        condition: records[0].condition,
        repeats: records.length,
        started_at: records[0].started_at,
        agreed: records.reduce((n, r) => n + r.totals.agreed, 0),
        measurable: records.reduce((n, r) => n + r.totals.measurable, 0),
        well_formed: records.reduce((n, r) => n + r.totals.well_formed, 0),
        returned: records.reduce((n, r) => n + r.totals.returned, 0),
        output_tokens: records.reduce((n, r) => n + r.totals.output_tokens, 0),
        thinking_tokens: records.reduce((n, r) => n + (r.totals.thinking_tokens ?? 0), 0),
        duration_seconds: records.reduce((n, r) => n + r.totals.duration_seconds, 0),
        rate: rates.length
          ? { mean: rates.reduce((a, b) => a + b, 0) / rates.length, min: Math.min(...rates), max: Math.max(...rates) }
          : null,
      };
    })
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
}

/** Every repeat of one condition, so the panel can show them side by side. */
async function condition(slug: string) {
  const records = (await allRecords()).filter((r) => r.condition.slug === slug);
  // Chronological, because `repeat` restarts at 1 on every invocation.
  records.sort((a, b) => a.started_at.localeCompare(b.started_at));
  return records.length ? { slug, condition: records[0].condition, runs: records } : null;
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const { pathname } = new URL(request.url);

    // A tool that logs a console error on every load trains you to ignore them.
    if (pathname === "/favicon.ico") return new Response(null, { status: 204 });

    if (pathname === "/api/conditions") return json(await listConditions());

    if (pathname.startsWith("/api/conditions/")) {
      const slug = decodeURIComponent(pathname.slice("/api/conditions/".length));
      // The slug is matched against record contents, never joined onto a path,
      // so there is nothing here that can walk the disk.
      const found = await condition(slug);
      return found ? json(found) : json({ error: "no such condition" }, 404);
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
