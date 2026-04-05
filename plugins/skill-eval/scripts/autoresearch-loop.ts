#!/usr/bin/env bun

import { parseArgs } from "util";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { RankedTarget, ExperimentConfig, ExperimentResult, ExperimentLine } from "./types";
import { extractJson, parseIntOrDie } from "./shared";

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8", timeout: 30000 }).trim();
  } catch {
    return null;
  }
}

export function loadTargets(path: string): RankedTarget[] {
  const raw = readFileSync(path, "utf-8");
  return raw
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .reduce<RankedTarget[]>((acc, l) => {
      try {
        acc.push(JSON.parse(l) as RankedTarget);
      } catch {
        process.stderr.write(`[warn] Skipping malformed target line\n`);
      }
      return acc;
    }, []);
}

export function loadExperimentState(
  stateFile: string,
): { config: ExperimentConfig | null; results: ExperimentResult[]; bestScore: number } {
  if (!existsSync(stateFile)) return { config: null, results: [], bestScore: 0 };

  const lines = readFileSync(stateFile, "utf-8")
    .trim()
    .split("\n")
    .filter((l) => l.trim());

  let config: ExperimentConfig | null = null;
  const results: ExperimentResult[] = [];
  let bestScore = 0;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as ExperimentLine;
      if (obj.type === "config") config = obj;
      if (obj.type === "result") {
        results.push(obj);
        if (obj.status === "keep" && obj.score > bestScore) bestScore = obj.score;
      }
    } catch {
      process.stderr.write(`[warn] Skipping malformed experiment state line\n`);
    }
  }

  return { config, results, bestScore };
}

async function generateImprovement(
  client: Anthropic,
  target: RankedTarget,
  previousAttempts: ExperimentResult[],
  model: string,
): Promise<{ description: string; patch: string }> {
  const attemptsContext =
    previousAttempts.length > 0
      ? `\n\nPREVIOUS ATTEMPTS (learn from these):\n${previousAttempts
          .map(
            (a) =>
              `- Run ${a.run}: "${a.description}" → ${a.status} (${a.score}/${a.total_questions} passed)` +
              (a.failed.length > 0 ? `\n  Failed: ${a.failed.join("; ")}` : ""),
          )
          .join("\n")}`
      : "";

  const prompt = `You are improving an AI agent's behavior to fix a specific friction pattern.

TARGET:
- Cluster: ${target.cluster_key}
- Root cause: ${target.assessment.root_cause}
- Type: ${target.assessment.target_type}
- Suggested action: ${target.assessment.suggested_action}
- Evidence: ${target.evidence_sample.slice(0, 3).join("\n  ")}
${attemptsContext}

Generate a CONCRETE improvement. This should be:
1. A specific, actionable change (not vague guidance)
2. Different from previous attempts if any failed
3. Targeted at the root cause, not symptoms

Respond with JSON:
{
  "description": "1-sentence description of the change",
  "patch": "The actual content to add/modify (e.g., a rule, prompt section, config change, or code fix)"
}`;

  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    system: "You are a JSON-only responder. Always respond with a single valid JSON object. No markdown, no explanation, no code fences. The patch field must be a single string with newlines escaped as \\n.",
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = extractJson(text);
  return { description: String(parsed.description ?? ""), patch: String(parsed.patch ?? "") };
}

async function evaluateImprovement(
  client: Anthropic,
  target: RankedTarget,
  improvement: { description: string; patch: string },
  model: string,
): Promise<{ passed: string[]; failed: string[]; score: number }> {
  const questions = target.assessment.eval_questions;

  const prompt = `You are a strict evaluator. Given an improvement patch and evaluation questions, determine if each question would be answered YES after the improvement is applied.

IMPROVEMENT:
Description: ${improvement.description}
Patch:
${improvement.patch}

CONTEXT:
- Original problem: ${target.assessment.root_cause}
- Evidence of the problem: ${target.evidence_sample.slice(0, 2).join("\n  ")}

EVAL QUESTIONS (answer each YES or NO with brief reasoning):
${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Respond with JSON:
{
  "answers": [
    {"question": "...", "answer": "yes" | "no", "reason": "..."},
    ...
  ]
}`;

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: "You are a JSON-only responder. Always respond with a single valid JSON object. No markdown, no explanation, no code fences.",
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = extractJson(text);
  const answers: Record<string, string | undefined>[] =
    Array.isArray((parsed as Record<string, unknown>).answers)
      ? (parsed as Record<string, unknown>).answers as Record<string, string | undefined>[]
      : [];

  if (answers.length === 0) {
    return { passed: [], failed: questions.map(q => `${q} (no answer from judge)`), score: 0 };
  }

  const passed: string[] = [];
  const failed: string[] = [];

  for (const a of answers) {
    const answer = a.answer ?? a.verdict ?? "";
    const question = a.question ?? "unknown";
    const reason = a.reason ?? "";
    if (String(answer).toLowerCase() === "yes") {
      passed.push(question);
    } else {
      failed.push(`${question} (${reason})`);
    }
  }

  return { passed, failed, score: passed.length };
}

async function runLoop(
  target: RankedTarget,
  workDir: string,
  maxRounds: number,
  stateFile: string,
  model: string,
): Promise<void> {
  const client = new Anthropic({ maxRetries: 3 });

  // Initialize state
  let { config, results, bestScore } = loadExperimentState(stateFile);
  const startRun = results.length > 0 ? Math.max(...results.map(r => r.run)) : 0;

  if (!config) {
    const newConfig: ExperimentConfig = {
      type: "config",
      target_key: target.cluster_key,
      target_type: target.assessment.target_type,
      eval_questions: target.assessment.eval_questions,
      suggested_action: target.assessment.suggested_action,
      timestamp: Math.floor(Date.now() / 1000),
    };
    appendFileSync(stateFile, JSON.stringify(newConfig) + "\n");
    config = newConfig;
    process.stderr.write(`[init] Target: ${target.cluster_key}\n`);
    process.stderr.write(`[init] Eval questions: ${target.assessment.eval_questions.length}\n`);
    process.stderr.write(`[init] Suggested action: ${target.assessment.suggested_action}\n`);
  }

  const totalQuestions = target.assessment.eval_questions.length;

  // Compute trailing streaks from loaded state so resumption respects
  // the plateau/crash bailout thresholds correctly.
  let consecutiveDiscards = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].status === "discard") consecutiveDiscards++;
    else break;
  }

  let consecutiveCrashes = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].status === "crash") consecutiveCrashes++;
    else break;
  }

  for (let round = 0; round < maxRounds; round++) {
    const runNum = startRun + round + 1;
    process.stderr.write(`\n[run ${runNum}] Generating improvement...\n`);

    let improvement: { description: string; patch: string };
    try {
      improvement = await generateImprovement(client, target, results.slice(-5), model);
    } catch (err) {
      process.stderr.write(`[run ${runNum}] CRASH generating improvement: ${(err as Error).message}\n`);
      const crashResult: ExperimentResult = {
        type: "result",
        run: runNum,
        score: 0,
        passed: [],
        failed: ["Generation failed"],
        total_questions: totalQuestions,
        status: "crash",
        description: `Generation error: ${(err as Error).message}`,
        commit: git(["rev-parse", "--short=7", "HEAD"], workDir) ?? "unknown",
        timestamp: Math.floor(Date.now() / 1000),
      };
      appendFileSync(stateFile, JSON.stringify(crashResult) + "\n");
      results.push(crashResult);
      consecutiveCrashes++;
      consecutiveDiscards = 0;
      if (consecutiveCrashes >= 3) { process.stderr.write("\n[done] 3 consecutive crashes — bailing out.\n"); break; }
      continue;
    }

    process.stderr.write(`[run ${runNum}] Improvement: ${improvement.description}\n`);
    process.stderr.write(`[run ${runNum}] Evaluating...\n`);

    let evalResult: { passed: string[]; failed: string[]; score: number };
    try {
      evalResult = await evaluateImprovement(client, target, improvement, model);
    } catch (err) {
      process.stderr.write(`[run ${runNum}] CRASH evaluating: ${(err as Error).message}\n`);
      const crashResult: ExperimentResult = {
        type: "result",
        run: runNum,
        score: 0,
        passed: [],
        failed: ["Eval failed"],
        total_questions: totalQuestions,
        status: "crash",
        description: improvement.description,
        commit: git(["rev-parse", "--short=7", "HEAD"], workDir) ?? "unknown",
        timestamp: Math.floor(Date.now() / 1000),
      };
      appendFileSync(stateFile, JSON.stringify(crashResult) + "\n");
      results.push(crashResult);
      consecutiveCrashes++;
      if (consecutiveCrashes >= 3) { process.stderr.write("\n[done] 3 consecutive crashes — bailing out.\n"); break; }
      continue;
    }

    consecutiveCrashes = 0;
    const status: "keep" | "discard" = evalResult.score > bestScore ? "keep" : "discard";

    if (status === "keep") {
      bestScore = evalResult.score;
      consecutiveDiscards = 0;
      process.stderr.write(
        `[run ${runNum}] KEEP — ${evalResult.score}/${totalQuestions} (new best)\n`,
      );
    } else {
      consecutiveDiscards++;
      process.stderr.write(
        `[run ${runNum}] DISCARD — ${evalResult.score}/${totalQuestions} (best: ${bestScore})\n`,
      );
    }

    if (evalResult.failed.length > 0) {
      process.stderr.write(`[run ${runNum}] Failed: ${evalResult.failed.slice(0, 2).join("; ")}\n`);
    }

    const experimentResult: ExperimentResult = {
      type: "result",
      run: runNum,
      score: evalResult.score,
      passed: evalResult.passed,
      failed: evalResult.failed,
      total_questions: totalQuestions,
      status,
      description: improvement.description,
      commit: git(["rev-parse", "--short=7", "HEAD"], workDir) ?? "unknown",
      timestamp: Math.floor(Date.now() / 1000),
    };

    appendFileSync(stateFile, JSON.stringify(experimentResult) + "\n");
    results.push(experimentResult);

    // Early stop: all questions passed
    if (evalResult.score === totalQuestions) {
      process.stderr.write(`\n[done] Perfect score — all ${totalQuestions} eval questions passed.\n`);
      break;
    }

    // Early stop: 5 consecutive discards — likely stuck
    if (consecutiveDiscards >= 5) {
      process.stderr.write(`\n[done] 5 consecutive discards — plateau reached.\n`);
      break;
    }
  }
}

function printSummary(stateFile: string): void {
  const { results, bestScore } = loadExperimentState(stateFile);
  if (results.length === 0) {
    process.stderr.write("No experiments run yet.\n");
    return;
  }

  const keeps = results.filter((r) => r.status === "keep");
  const discards = results.filter((r) => r.status === "discard");
  const crashes = results.filter((r) => r.status === "crash");
  const totalQ = results[0]?.total_questions ?? 0;

  process.stderr.write("\nExperiment Summary\n" + "=".repeat(50) + "\n");
  process.stderr.write(`Runs: ${results.length} | Kept: ${keeps.length} | Discarded: ${discards.length} | Crashed: ${crashes.length}\n`);
  process.stderr.write(`Best score: ${bestScore}/${totalQ}\n\n`);

  for (const r of results) {
    const icon = r.status === "keep" ? "+" : r.status === "discard" ? "-" : "!";
    process.stderr.write(
      `  [${icon}] Run ${r.run}: ${r.score}/${r.total_questions} — ${r.description}\n`,
    );
  }
}

function printHelp(): void {
  process.stderr.write(`Usage: bun scripts/autoresearch-loop.ts [options]

Run autoresearch optimization loop on M3 targets.

Options:
  --targets, -t <file>    Input targets.jsonl from M3
  --target-rank <n>       Which target to optimize (default: 1 = highest ranked)
  --max-rounds <n>        Max improvement rounds (default: 10)
  --state-dir <dir>       Directory for experiment state (default: ./experiments)
  --model <model>         Anthropic model for generation and eval (default: claude-haiku-4-5-20251001)
  --summary               Print summary of existing experiments
  --dry-run               Show what would be optimized without running
  --help                  Show this help
`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      targets: { type: "string", short: "t" },
      "target-rank": { type: "string", default: "1" },
      "max-rounds": { type: "string", default: "10" },
      "state-dir": { type: "string", default: "./experiments" },
      model: { type: "string", default: "claude-haiku-4-5-20251001" },
      summary: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const stateDir = resolve(values["state-dir"]!);
  mkdirSync(stateDir, { recursive: true });

  if (values.summary) {
    // Show summary for all experiment files
    for (const f of readdirSync(stateDir)) {
      if (f.endsWith(".jsonl")) {
        process.stderr.write(`\n--- ${f} ---\n`);
        printSummary(join(stateDir, f));
      }
    }
    process.exit(0);
  }

  if (!values.targets) {
    process.stderr.write("Error: --targets is required\n");
    printHelp();
    process.exit(1);
  }

  const targets = loadTargets(values.targets);
  const targetRank = parseIntOrDie(values["target-rank"]!, "--target-rank");
  const maxRounds = parseIntOrDie(values["max-rounds"]!, "--max-rounds");

  const target = targets.find((t) => t.rank === targetRank);
  if (!target) {
    process.stderr.write(`Error: No target with rank ${targetRank}\n`);
    process.exit(1);
  }

  const stateFile = join(stateDir, `${target.cluster_key.replace(/[:/]/g, "_")}.jsonl`);
  const workDir = process.cwd();

  if (values["dry-run"]) {
    process.stderr.write(`[dry-run] Would optimize target #${target.rank}: ${target.cluster_key}\n`);
    process.stderr.write(`  Root cause: ${target.assessment.root_cause}\n`);
    process.stderr.write(`  Type: ${target.assessment.target_type}\n`);
    process.stderr.write(`  Action: ${target.assessment.suggested_action}\n`);
    process.stderr.write(`  Eval questions (${target.assessment.eval_questions.length}):\n`);
    for (const q of target.assessment.eval_questions) {
      process.stderr.write(`    - ${q}\n`);
    }
    process.stderr.write(`  State file: ${stateFile}\n`);
    process.stderr.write(`  Max rounds: ${maxRounds}\n`);
    process.exit(0);
  }

  process.stderr.write(`\nAutoresearch Loop\n${"=".repeat(50)}\n`);
  process.stderr.write(`Target #${target.rank}: ${target.cluster_key}\n`);
  process.stderr.write(`Score: ${target.score} (freq=${target.frequency}, sessions=${target.session_count})\n`);
  process.stderr.write(`Rounds: up to ${maxRounds}\n\n`);

  await runLoop(target, workDir, maxRounds, stateFile, values.model!);
  printSummary(stateFile);
}

if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(2);
  });
}
