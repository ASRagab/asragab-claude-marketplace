import { describe, test, expect } from "bun:test";
import {
  buildToolNameIndex,
  resolveToolName,
  clusterFriction,
  computeScore,
  validateAssessment,
} from "../../../plugins/skill-eval/scripts/target-identify";
import type { ClassifiedEvent, ClassificationLabel } from "../../../plugins/skill-eval/scripts/types";

function makeClassified(
  overrides: Record<string, unknown> & { type: string; classification: ClassificationLabel },
): ClassifiedEvent {
  const base: Record<string, unknown> = {
    session_id: "sess-test",
    timestamp: "2026-03-28T10:00:00Z",
    sequence: 0,
    message_uuid: "msg-1",
    parent_message_uuid: null,
    cwd: "/test",
    git_branch: "main",
    is_subagent: false,
    parent_session_id: null,
    subagent_id: null,
    subagent_type: null,
    model: null,
    version: "2.1.0",
  };
  const defaults: Record<string, Record<string, unknown>> = {
    tool_use: { tool_use_id: "tu-1", tool_name: "Read", tool_input: {} },
    tool_result: { tool_use_id: "tu-1", content: "", is_error: true },
  };
  return { ...base, ...(defaults[overrides.type] ?? {}), ...overrides } as unknown as ClassifiedEvent;
}

describe("buildToolNameIndex", () => {
  test("maps tool_use_id to tool_name", () => {
    const events = [
      makeClassified({
        type: "tool_use",
        tool_use_id: "tu-abc",
        tool_name: "Bash",
        tool_input: {},
        classification: { category: "neutral", subcategory: "unclassified", confidence: 1 },
      }),
    ];
    const index = buildToolNameIndex(events);
    expect(index.get("tu-abc")).toBe("Bash");
  });

  test("ignores non-tool_use events", () => {
    const events = [
      makeClassified({
        type: "tool_result",
        tool_use_id: "tu-xyz",
        content: "ok",
        is_error: false,
        classification: { category: "neutral", subcategory: "unclassified", confidence: 1 },
      }),
    ];
    const index = buildToolNameIndex(events);
    expect(index.size).toBe(0);
  });
});

describe("resolveToolName", () => {
  test("returns tool_name for tool_use events", () => {
    const event = makeClassified({
      type: "tool_use",
      tool_name: "Edit",
      classification: { category: "friction", subcategory: "retry", confidence: 0.8 },
    });
    expect(resolveToolName(event, new Map())).toBe("Edit");
  });

  test("resolves tool_result via index", () => {
    const index = new Map([["tu-1", "Grep"]]);
    const event = makeClassified({
      type: "tool_result",
      tool_use_id: "tu-1",
      classification: { category: "friction", subcategory: "tool_error", confidence: 1 },
    });
    expect(resolveToolName(event, index)).toBe("Grep");
  });

  test("returns null for unresolvable events", () => {
    const event = makeClassified({
      type: "tool_result",
      tool_use_id: "tu-unknown",
      classification: { category: "friction", subcategory: "tool_error", confidence: 1 },
    });
    expect(resolveToolName(event, new Map())).toBeNull();
  });
});

describe("clusterFriction", () => {
  test("groups friction events by subcategory and tool", () => {
    const events = [
      makeClassified({
        type: "tool_result",
        tool_use_id: "tu-a",
        content: "timeout",
        is_error: true,
        session_id: "s1",
        classification: { category: "friction", subcategory: "tool_error_timeout", confidence: 1 },
      }),
      makeClassified({
        type: "tool_result",
        tool_use_id: "tu-b",
        content: "timeout",
        is_error: true,
        session_id: "s2",
        classification: { category: "friction", subcategory: "tool_error_timeout", confidence: 1 },
      }),
      makeClassified({
        type: "tool_result",
        tool_use_id: "tu-c",
        content: "permission denied",
        is_error: true,
        session_id: "s1",
        classification: { category: "friction", subcategory: "tool_error_permission", confidence: 1 },
      }),
    ];

    const toolIndex = new Map([["tu-a", "Bash"], ["tu-b", "Bash"], ["tu-c", "Read"]]);
    const clusters = clusterFriction(events, toolIndex);

    expect(clusters.length).toBe(2);
    const keys = clusters.map(c => c.key);
    expect(keys).toContain("tool_error_timeout:Bash");
    expect(keys).toContain("tool_error_permission:Read");
  });

  test("ignores non-friction events", () => {
    const events = [
      makeClassified({
        type: "tool_result",
        classification: { category: "success", subcategory: "clean_completion", confidence: 0.8 },
      }),
      makeClassified({
        type: "tool_result",
        classification: { category: "neutral", subcategory: "unclassified", confidence: 1 },
      }),
    ];
    const clusters = clusterFriction(events, new Map());
    expect(clusters.length).toBe(0);
  });

  test("sorts clusters by event count descending", () => {
    const events = [
      makeClassified({
        type: "tool_result",
        session_id: "s1",
        classification: { category: "friction", subcategory: "a", confidence: 1, evidence: "e1" },
      }),
      makeClassified({
        type: "tool_result",
        session_id: "s1",
        classification: { category: "friction", subcategory: "b", confidence: 1, evidence: "e2" },
      }),
      makeClassified({
        type: "tool_result",
        session_id: "s2",
        classification: { category: "friction", subcategory: "b", confidence: 1, evidence: "e3" },
      }),
    ];
    const clusters = clusterFriction(events, new Map());
    expect(clusters[0].key).toBe("b");
    expect(clusters[0].events.length).toBe(2);
  });
});

describe("computeScore", () => {
  test("computes frequency * log2(sessions+1) * severity * improvability", () => {
    const score = computeScore(10, 3, 4, 5);
    expect(score).toBe(Math.round(10 * Math.log2(4) * 4 * 5));
  });

  test("single session still produces a score", () => {
    const score = computeScore(1, 1, 1, 1);
    expect(score).toBe(Math.round(1 * Math.log2(2) * 1 * 1));
    expect(score).toBe(1);
  });

  test("zero frequency produces zero", () => {
    expect(computeScore(0, 5, 5, 5)).toBe(0);
  });
});

describe("validateAssessment", () => {
  test("passes through valid assessment", () => {
    const raw = {
      root_cause: "Missing retry logic",
      target_type: "tool",
      target_path: "/src/client.ts",
      severity: 4,
      improvability: 5,
      suggested_action: "Add retry with backoff",
      eval_questions: ["Does it retry?", "Does it use backoff?"],
    };
    const result = validateAssessment(raw);
    expect(result.root_cause).toBe("Missing retry logic");
    expect(result.target_type).toBe("tool");
    expect(result.severity).toBe(4);
    expect(result.eval_questions).toEqual(["Does it retry?", "Does it use backoff?"]);
  });

  test("clamps severity to 1-5 range", () => {
    expect(validateAssessment({ severity: 0 }).severity).toBe(1);
    expect(validateAssessment({ severity: 10 }).severity).toBe(5);
    expect(validateAssessment({ severity: -3 }).severity).toBe(1);
  });

  test("clamps improvability to 1-5 range", () => {
    expect(validateAssessment({ improvability: 0 }).improvability).toBe(1);
    expect(validateAssessment({ improvability: 99 }).improvability).toBe(5);
  });

  test("defaults invalid target_type to 'workflow'", () => {
    expect(validateAssessment({ target_type: "banana" }).target_type).toBe("workflow");
    expect(validateAssessment({}).target_type).toBe("workflow");
  });

  test("provides default eval question when none given", () => {
    const result = validateAssessment({});
    expect(result.eval_questions.length).toBe(1);
  });

  test("caps eval_questions at 6", () => {
    const raw = {
      eval_questions: ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"],
    };
    expect(validateAssessment(raw).eval_questions.length).toBe(6);
  });
});
