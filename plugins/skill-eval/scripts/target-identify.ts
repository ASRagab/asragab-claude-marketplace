#!/usr/bin/env bun

import { parseArgs } from "util";
import Anthropic from "@anthropic-ai/sdk";
import type { ClassifiedEvent, ClassificationLabel, FrictionCluster, TargetAssessment, RankedTarget } from "./types";
import { extractJson } from "./shared";

const VALID_TARGET_TYPES = new Set(["skill", "prompt", "tool", "config", "workflow"]);

function buildToolNameIndex(events: ClassifiedEvent[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const e of events) {
    if (e.type === "tool_use") {
      index.set(e.tool_use_id, e.tool_name);
    }
  }
  return index;
}

function resolveToolName(
  event: ClassifiedEvent,
  toolIndex: Map<string, string>,
): string | null {
  if ((event as any).tool_name) return (event as any).tool_name;
  if (event.type === "tool_result" && event.tool_use_id) {
    return toolIndex.get(event.tool_use_id) ?? null;
  }
  return null;
}

function clusterFriction(
  events: ClassifiedEvent[],
  toolIndex: Map<string, string>,
): FrictionCluster[] {
  const map = new Map<string, ClassifiedEvent[]>();

  for (const e of events) {
    if (e.classification.category !== "friction") continue;
    const sub = e.classification.subcategory;
    const tool = resolveToolName(e, toolIndex);
    const key = tool ? `${sub}:${tool}` : sub;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }

  const clusters: FrictionCluster[] = [];
  for (const [key, evts] of map) {
    const sessions = new Set(evts.map((e) => e.session_id));
    const evidence = evts
      .map((e) => e.classification.evidence)
      .filter((e): e is string => !!e);
    const dedupedEvidence = [...new Set(evidence)].slice(0, 5);

    clusters.push({
      key,
      subcategory: key.split(":")[0],
      tool_name: key.includes(":") ? key.split(":").slice(1).join(":") : null,
      events: evts,
      session_count: sessions.size,
      representative_evidence: dedupedEvidence,
    });
  }

  return clusters.sort((a, b) => b.events.length - a.events.length);
}

function buildJudgePrompt(cluster: FrictionCluster): string {
  const evidenceBlock = cluster.representative_evidence
    .map((e, i) => `  ${i + 1}. ${e}`)
    .join("\n");

  return `You are an expert evaluating friction in AI agent sessions. Given a cluster of friction events, identify the optimization target.

FRICTION CLUSTER:
- Category: ${cluster.subcategory}
- Tool involved: ${cluster.tool_name ?? "N/A"}
- Occurrences: ${cluster.events.length} events across ${cluster.session_count} sessions
- Representative evidence:
${evidenceBlock}

Assess this friction cluster:

1. ROOT CAUSE: What is the underlying cause? (1-2 sentences)
2. TARGET TYPE: One of: skill, prompt, tool, config, workflow
3. TARGET PATH: If you can identify a specific file, config key, or tool parameter to change, name it. Otherwise null.
4. SEVERITY (1-5): How much does this friction degrade the user experience?
   1=minor annoyance, 3=noticeable delay/confusion, 5=blocks task completion
5. IMPROVABILITY (1-5): How feasible is it to fix this?
   1=fundamental limitation, 3=requires moderate effort, 5=straightforward fix
6. SUGGESTED ACTION: What specific change would reduce this friction? (1-2 sentences)
7. EVAL QUESTIONS: Write 3-5 binary yes/no questions that would verify the fix works. Each must be answerable YES or NO by examining a single proposed patch. Do NOT include quantitative thresholds (percentages, counts, timing) that require runtime measurement. Focus on structural/behavioral properties verifiable from the change itself.

Respond with ONLY a JSON object, no surrounding text:
{
  "root_cause": "...",
  "target_type": "skill|prompt|tool|config|workflow",
  "target_path": "..." or null,
  "severity": N,
  "improvability": N,
  "suggested_action": "...",
  "eval_questions": ["Does ...?", "Does ...?", "Does ...?"]
}`;
}

function validateAssessment(raw: Record<string, unknown>): TargetAssessment {
  const clamp = (v: unknown, lo: number, hi: number): number => {
    const n = typeof v === "number" ? v : parseInt(String(v), 10);
    if (isNaN(n)) return 3;
    return Math.max(lo, Math.min(hi, n));
  };

  const targetType = String(raw.target_type ?? "workflow");

  return {
    root_cause: String(raw.root_cause ?? "Unknown"),
    target_type: VALID_TARGET_TYPES.has(targetType)
      ? (targetType as TargetAssessment["target_type"])
      : "workflow",
    target_path: raw.target_path ? String(raw.target_path) : null,
    severity: clamp(raw.severity, 1, 5),
    improvability: clamp(raw.improvability, 1, 5),
    suggested_action: String(raw.suggested_action ?? "Investigate further"),
    eval_questions: Array.isArray(raw.eval_questions)
      ? raw.eval_questions.map(String).slice(0, 6)
      : ["Does this friction still occur after the fix?"],
  };
}

async function assessCluster(
  client: Anthropic,
  cluster: FrictionCluster,
  model: string,
): Promise<TargetAssessment> {
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: "user", content: buildJudgePrompt(cluster) }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const raw = extractJson(text);
  return validateAssessment(raw);
}

async function assessClustersParallel(
  client: Anthropic,
  clusters: FrictionCluster[],
  model: string,
  concurrency: number,
): Promise<{ cluster: FrictionCluster; assessment: TargetAssessment }[]> {
  const results: { cluster: FrictionCluster; assessment: TargetAssessment }[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < clusters.length) {
      const idx = cursor++;
      const cluster = clusters[idx];
      process.stderr.write(`[info] Assessing: ${cluster.key} ...\n`);
      try {
        const assessment = await assessCluster(client, cluster, model);
        results.push({ cluster, assessment });
      } catch (err) {
        process.stderr.write(
          `[warn] Failed to assess ${cluster.key}: ${(err as Error).message}\n`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, clusters.length) }, () => worker()));
  return results;
}

function computeScore(
  frequency: number,
  sessionCount: number,
  severity: number,
  improvability: number,
): number {
  const breadth = Math.log2(sessionCount + 1);
  return Math.round(frequency * breadth * severity * improvability);
}

function printHelp(): void {
  const help = `Usage: bun scripts/target-identify.ts [options]

Identify optimization targets from M2 classified friction events using LLM-as-judge.

Options:
  --input, -i <file>       Input classified-events.jsonl (or stdin)
  --output, -o <file>      Output file (default: stdout)
  --model <model>          Anthropic model (default: claude-haiku-4-5-20251001)
  --min-events <n>         Minimum events per cluster to assess (default: 2)
  --top <n>                Output top N targets (default: 10)
  --concurrency <n>        Parallel LLM calls (default: 5)
  --stats                  Print summary stats only
  --dry-run                Show clusters without calling LLM
  --help                   Show this help
`;
  process.stderr.write(help);
}

async function readInput(inputPath: string | null): Promise<ClassifiedEvent[]> {
  let raw: string;
  if (inputPath) {
    raw = await Bun.file(inputPath).text();
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of Bun.stdin.stream()) {
      chunks.push(Buffer.from(chunk));
    }
    raw = Buffer.concat(chunks).toString("utf-8");
  }

  const events: ClassifiedEvent[] = [];
  let skipped = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as ClassifiedEvent);
    } catch {
      skipped++;
    }
  }
  if (skipped > 0) {
    process.stderr.write(`[warn] Skipped ${skipped} malformed input lines\n`);
  }
  return events;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      input: { type: "string", short: "i" },
      output: { type: "string", short: "o" },
      model: { type: "string", default: "claude-haiku-4-5-20251001" },
      "min-events": { type: "string", default: "2" },
      top: { type: "string", default: "10" },
      concurrency: { type: "string", default: "5" },
      stats: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const minEvents = parseInt(values["min-events"]!, 10);
  const topN = parseInt(values.top!, 10);
  const concurrency = parseInt(values.concurrency!, 10);
  const dryRun = values["dry-run"]!;
  const statsOnly = values.stats!;
  const model = values.model!;

  const allEvents = await readInput(values.input ?? null);
  const toolIndex = buildToolNameIndex(allEvents);
  const frictionEvents = allEvents.filter(
    (e) => e.classification.category === "friction",
  );

  if (frictionEvents.length === 0) {
    process.stderr.write("No friction events found in input.\n");
    process.exit(1);
  }

  const clusters = clusterFriction(frictionEvents, toolIndex);
  const eligible = clusters.filter((c) => c.events.length >= minEvents);

  process.stderr.write(
    `[info] ${clusters.length} clusters, ${eligible.length} eligible (>=${minEvents} events)\n`,
  );

  if (statsOnly) {
    for (const c of eligible) {
      process.stderr.write(
        `  ${c.key}: ${c.events.length} events, ${c.session_count} sessions\n`,
      );
    }
    process.exit(0);
  }

  if (dryRun) {
    for (const c of eligible) {
      process.stderr.write(
        `  ${c.key}: ${c.events.length} events, ${c.session_count} sessions\n`,
      );
      for (const ev of c.representative_evidence.slice(0, 2)) {
        process.stderr.write(`    ex: ${ev}\n`);
      }
    }
    process.stderr.write(
      `\n[dry-run] Would assess ${eligible.length} clusters with ${model}\n`,
    );
    process.exit(0);
  }

  const client = new Anthropic();
  const assessed = await assessClustersParallel(client, eligible, model, concurrency);

  const targets: RankedTarget[] = assessed.map(({ cluster, assessment }) => ({
    rank: 0,
    cluster_key: cluster.key,
    subcategory: cluster.subcategory,
    tool_name: cluster.tool_name,
    frequency: cluster.events.length,
    session_count: cluster.session_count,
    score: computeScore(
      cluster.events.length,
      cluster.session_count,
      assessment.severity,
      assessment.improvability,
    ),
    assessment,
    evidence_sample: cluster.representative_evidence,
  }));

  targets.sort((a, b) => b.score - a.score);
  targets.forEach((t, i) => (t.rank = i + 1));

  const topTargets = targets.slice(0, topN);

  const lines = topTargets.map((t) => JSON.stringify(t)).join("\n");
  if (values.output) {
    await Bun.write(values.output, lines + "\n");
    process.stderr.write(
      `Wrote ${topTargets.length} targets to ${values.output}\n`,
    );
  } else {
    process.stdout.write(lines + "\n");
  }

  process.stderr.write("\nTarget Ranking\n" + "=".repeat(60) + "\n");
  for (const t of topTargets) {
    process.stderr.write(
      `#${t.rank} [score=${t.score}] ${t.cluster_key}\n` +
        `   ${t.assessment.root_cause}\n` +
        `   → ${t.assessment.suggested_action}\n` +
        `   type=${t.assessment.target_type} sev=${t.assessment.severity} imp=${t.assessment.improvability} freq=${t.frequency} sessions=${t.session_count}\n\n`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(2);
});
