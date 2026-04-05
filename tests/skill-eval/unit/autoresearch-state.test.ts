import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { loadExperimentState, loadTargets } from "../../../plugins/skill-eval/scripts/autoresearch-loop";
import type { ExperimentResult } from "../../../plugins/skill-eval/scripts/types";

const TMP_DIR = join(import.meta.dir, "../fixtures/.tmp");
const FIXTURE_DIR = join(import.meta.dir, "../fixtures");

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  try {
    const { readdirSync } = require("node:fs");
    for (const f of readdirSync(TMP_DIR)) unlinkSync(join(TMP_DIR, f));
  } catch {}
});

describe("loadExperimentState", () => {
  test("returns empty state for nonexistent file", () => {
    const { config, results, bestScore } = loadExperimentState(join(TMP_DIR, "nonexistent.jsonl"));
    expect(config).toBeNull();
    expect(results).toEqual([]);
    expect(bestScore).toBe(0);
  });

  test("loads config and results from fixture", () => {
    const { config, results, bestScore } = loadExperimentState(
      join(FIXTURE_DIR, "experiment-state.jsonl"),
    );
    expect(config).not.toBeNull();
    expect(config!.target_key).toBe("tool_error:Read");
    expect(results.length).toBe(4);
    expect(bestScore).toBe(2);
  });

  test("tracks best score from keep results only", () => {
    const lines = [
      JSON.stringify({ type: "config", target_key: "test", target_type: "tool", eval_questions: ["q1"], suggested_action: "fix", timestamp: 1 }),
      JSON.stringify({ type: "result", run: 1, score: 3, passed: [], failed: [], total_questions: 5, status: "keep", description: "a", commit: "x", timestamp: 2 }),
      JSON.stringify({ type: "result", run: 2, score: 5, passed: [], failed: [], total_questions: 5, status: "discard", description: "b", commit: "x", timestamp: 3 }),
      JSON.stringify({ type: "result", run: 3, score: 4, passed: [], failed: [], total_questions: 5, status: "keep", description: "c", commit: "x", timestamp: 4 }),
    ].join("\n");

    const path = join(TMP_DIR, "best-score.jsonl");
    writeFileSync(path, lines + "\n");
    const { bestScore } = loadExperimentState(path);
    expect(bestScore).toBe(4);
  });

  test("skips malformed lines", () => {
    const lines = [
      JSON.stringify({ type: "config", target_key: "test", target_type: "tool", eval_questions: [], suggested_action: "fix", timestamp: 1 }),
      "not valid json",
      JSON.stringify({ type: "result", run: 1, score: 1, passed: [], failed: [], total_questions: 3, status: "keep", description: "a", commit: "x", timestamp: 2 }),
    ].join("\n");

    const path = join(TMP_DIR, "malformed.jsonl");
    writeFileSync(path, lines + "\n");
    const { config, results } = loadExperimentState(path);
    expect(config).not.toBeNull();
    expect(results.length).toBe(1);
  });
});

describe("loadTargets", () => {
  test("loads valid JSONL targets", () => {
    const target = {
      rank: 1,
      cluster_key: "tool_error:Bash",
      subcategory: "tool_error",
      tool_name: "Bash",
      frequency: 10,
      session_count: 3,
      score: 200,
      assessment: {
        root_cause: "test",
        target_type: "tool",
        target_path: null,
        severity: 4,
        improvability: 5,
        suggested_action: "fix",
        eval_questions: ["q1"],
      },
      evidence_sample: ["ev1"],
    };

    const path = join(TMP_DIR, "targets.jsonl");
    writeFileSync(path, JSON.stringify(target) + "\n");
    const targets = loadTargets(path);
    expect(targets.length).toBe(1);
    expect(targets[0].cluster_key).toBe("tool_error:Bash");
  });

  test("skips malformed lines", () => {
    const path = join(TMP_DIR, "bad-targets.jsonl");
    writeFileSync(path, '{"rank":1}\nnot json\n{"rank":2}\n');
    const targets = loadTargets(path);
    expect(targets.length).toBe(2);
  });
});

describe("trailing streak computation (resume correctness)", () => {
  test("computes trailing discard streak", () => {
    const fixture = loadExperimentState(join(FIXTURE_DIR, "experiment-state.jsonl"));
    const results = fixture.results;

    let consecutiveDiscards = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].status === "discard") consecutiveDiscards++;
      else break;
    }
    // Fixture ends: keep, discard, crash, crash → trailing discard streak = 0
    expect(consecutiveDiscards).toBe(0);
  });

  test("computes trailing crash streak", () => {
    const fixture = loadExperimentState(join(FIXTURE_DIR, "experiment-state.jsonl"));
    const results = fixture.results;

    let consecutiveCrashes = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].status === "crash") consecutiveCrashes++;
      else break;
    }
    // Fixture ends: keep, discard, crash, crash → trailing crash streak = 2
    expect(consecutiveCrashes).toBe(2);
  });

  test("streak is zero for empty results", () => {
    const results: ExperimentResult[] = [];
    let streak = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].status === "discard") streak++;
      else break;
    }
    expect(streak).toBe(0);
  });

  test("all-discard results gives full-length streak", () => {
    const results: ExperimentResult[] = Array.from({ length: 5 }, (_, i) => ({
      type: "result" as const,
      run: i + 1,
      score: 0,
      passed: [],
      failed: [],
      total_questions: 3,
      status: "discard" as const,
      description: `attempt ${i + 1}`,
      commit: "abc",
      timestamp: 1000 + i,
    }));

    let streak = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].status === "discard") streak++;
      else break;
    }
    expect(streak).toBe(5);
  });

  test("mixed sequence: streak counts only trailing", () => {
    const statuses: Array<"keep" | "discard" | "crash"> = [
      "keep", "discard", "keep", "discard", "discard", "discard",
    ];
    const results: ExperimentResult[] = statuses.map((status, i) => ({
      type: "result" as const,
      run: i + 1,
      score: status === "keep" ? 3 : 0,
      passed: [],
      failed: [],
      total_questions: 3,
      status,
      description: `attempt ${i + 1}`,
      commit: "abc",
      timestamp: 1000 + i,
    }));

    let streak = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].status === "discard") streak++;
      else break;
    }
    expect(streak).toBe(3);
  });
});
