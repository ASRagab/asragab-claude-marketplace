import { describe, test, expect } from "bun:test";
import { classifySession, contentToString, type Config } from "../../../plugins/skill-eval/scripts/signal-classify";
import type { ExtractedEvent } from "../../../plugins/skill-eval/scripts/types";

const DEFAULT_CONFIG: Config = {
  retryThreshold: 3,
  longChainThreshold: 10,
  retryWindowSize: 5,
  abandonedLookback: 3,
};

function makeEvent(overrides: Record<string, unknown> & { type: string }): ExtractedEvent {
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
    user_message: { text: "" },
    assistant_text: { text: "" },
    tool_use: { tool_use_id: "tu-1", tool_name: "Read", tool_input: {} },
    tool_result: { tool_use_id: "tu-1", content: "", is_error: false },
    progress: { hook_event: "PostToolUse", hook_name: "test" },
    system: { subtype: "system-prompt", content: "" },
    thinking: { text: "" },
  };
  return { ...base, ...(defaults[overrides.type] ?? {}), ...overrides } as unknown as ExtractedEvent;
}

describe("contentToString", () => {
  test("returns string as-is", () => {
    expect(contentToString("hello")).toBe("hello");
  });

  test("extracts text from content block array", () => {
    const blocks = [{ type: "text", text: "hello" }, { type: "text", text: "world" }];
    expect(contentToString(blocks)).toBe("hello world");
  });

  test("handles null/undefined", () => {
    expect(contentToString(null)).toBe("");
    expect(contentToString(undefined)).toBe("");
  });
});

describe("classifyNoise", () => {
  test("classifies progress events as noise", () => {
    const events = [makeEvent({ type: "progress", sequence: 0 })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).toBe("noise");
    expect(result[0].classification.subcategory).toBe("progress");
  });

  test("classifies queue-operation as noise", () => {
    const events = [makeEvent({ type: "system", subtype: "queue-operation", content: "resume", sequence: 0 })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).toBe("noise");
    expect(result[0].classification.subcategory).toBe("system_meta");
  });

  test("classifies last-prompt as noise", () => {
    const events = [makeEvent({ type: "system", subtype: "last-prompt", content: "...", sequence: 0 })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).toBe("noise");
  });
});

describe("classifyToolError", () => {
  test("detects permission denied errors", () => {
    const events = [makeEvent({
      type: "tool_result",
      content: "Error: EACCES permission denied /src/file.ts",
      is_error: true,
      sequence: 0,
    })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).toBe("friction");
    expect(result[0].classification.subcategory).toBe("tool_error_permission");
  });

  test("detects timeout errors", () => {
    const events = [makeEvent({
      type: "tool_result",
      content: "Error: timeout exceeded TTL 30000ms",
      is_error: true,
      sequence: 0,
    })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).toBe("friction");
    expect(result[0].classification.subcategory).toBe("tool_error_timeout");
  });

  test("detects size limit errors", () => {
    const events = [makeEvent({
      type: "tool_result",
      content: "Error: file exceeds maximum size limit of 1MB",
      is_error: true,
      sequence: 0,
    })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).toBe("friction");
    expect(result[0].classification.subcategory).toBe("tool_error_size");
  });

  test("detects API mismatch errors", () => {
    const events = [makeEvent({
      type: "tool_result",
      content: "Error: unexpected keyword argument 'foo'",
      is_error: true,
      sequence: 0,
    })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).toBe("friction");
    expect(result[0].classification.subcategory).toBe("tool_error_api_mismatch");
  });

  test("detects parallel cancellation", () => {
    const events = [makeEvent({
      type: "tool_result",
      content: "Cancelled: parallel operation aborted",
      is_error: true,
      sequence: 0,
    })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).toBe("friction");
    expect(result[0].classification.subcategory).toBe("parallel_cancellation");
  });

  test("classifies generic tool errors as friction", () => {
    const events = [makeEvent({
      type: "tool_result",
      content: "Error: something went wrong",
      is_error: true,
      sequence: 0,
    })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).toBe("friction");
    expect(result[0].classification.subcategory).toBe("tool_error");
  });

  test("does not flag non-error tool results", () => {
    const events = [makeEvent({
      type: "tool_result",
      content: "file contents here",
      is_error: false,
      sequence: 0,
    })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).not.toBe("friction");
  });
});

describe("classifyUserCorrection", () => {
  test("detects 'no, don't' pattern", () => {
    const events = [makeEvent({ type: "user_message", text: "no, don't do that", sequence: 0 })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).toBe("friction");
    expect(result[0].classification.subcategory).toBe("user_correction");
  });

  test("detects 'instead do' pattern", () => {
    const events = [makeEvent({ type: "user_message", text: "instead try using the other function", sequence: 0 })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).toBe("friction");
    expect(result[0].classification.subcategory).toBe("user_correction");
  });

  test("detects 'that's wrong' pattern", () => {
    const events = [makeEvent({ type: "user_message", text: "that's wrong, the API is different", sequence: 0 })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).toBe("friction");
    expect(result[0].classification.subcategory).toBe("user_correction");
  });

  test("ignores very short messages", () => {
    const events = [makeEvent({ type: "user_message", text: "no", sequence: 0 })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.subcategory).not.toBe("user_correction");
  });
});

describe("classifyUserAck", () => {
  test("detects positive acknowledgment", () => {
    const events = [makeEvent({ type: "user_message", text: "looks good, thanks!", sequence: 0 })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).toBe("success");
    expect(result[0].classification.subcategory).toBe("user_ack");
  });

  test("detects 'lgtm'", () => {
    const events = [makeEvent({ type: "user_message", text: "lgtm", sequence: 0 })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).toBe("success");
    expect(result[0].classification.subcategory).toBe("user_ack");
  });
});

describe("detectRetry", () => {
  test("detects error-driven retries above threshold", () => {
    const events: ExtractedEvent[] = [
      makeEvent({ type: "tool_use", tool_name: "Bash", tool_use_id: "tu-a", sequence: 0 }),
      makeEvent({ type: "tool_result", tool_use_id: "tu-a", content: "Error: fail", is_error: true, sequence: 1 }),
      makeEvent({ type: "tool_use", tool_name: "Bash", tool_use_id: "tu-b", sequence: 2 }),
      makeEvent({ type: "tool_use", tool_name: "Bash", tool_use_id: "tu-c", sequence: 3 }),
    ];
    const result = classifySession(events, DEFAULT_CONFIG);
    const retries = result.filter(e => e.classification.subcategory === "retry");
    expect(retries.length).toBeGreaterThanOrEqual(1);
  });

  test("does not flag normal sequential tool use without errors", () => {
    const events: ExtractedEvent[] = [
      makeEvent({ type: "tool_use", tool_name: "Read", tool_use_id: "tu-a", sequence: 0 }),
      makeEvent({ type: "tool_result", tool_use_id: "tu-a", content: "ok", is_error: false, sequence: 1 }),
      makeEvent({ type: "tool_use", tool_name: "Read", tool_use_id: "tu-b", sequence: 2 }),
      makeEvent({ type: "tool_result", tool_use_id: "tu-b", content: "ok", is_error: false, sequence: 3 }),
      makeEvent({ type: "tool_use", tool_name: "Read", tool_use_id: "tu-c", sequence: 4 }),
    ];
    const result = classifySession(events, DEFAULT_CONFIG);
    const retries = result.filter(e => e.classification.subcategory === "retry");
    expect(retries.length).toBe(0);
  });
});

describe("detectCleanCompletion", () => {
  test("detects clean completion before user message", () => {
    const events: ExtractedEvent[] = [
      makeEvent({ type: "user_message", text: "do something", sequence: 0 }),
      makeEvent({ type: "tool_use", tool_name: "Read", tool_use_id: "tu-a", sequence: 1 }),
      makeEvent({ type: "tool_result", tool_use_id: "tu-a", content: "ok", is_error: false, sequence: 2 }),
      makeEvent({ type: "assistant_text", text: "Done!", sequence: 3 }),
      makeEvent({ type: "user_message", text: "thanks", sequence: 4 }),
    ];
    const result = classifySession(events, DEFAULT_CONFIG);
    const completions = result.filter(e => e.classification.subcategory === "clean_completion");
    expect(completions.length).toBe(1);
  });

  test("does not fire when preceding error exists", () => {
    const events: ExtractedEvent[] = [
      makeEvent({ type: "user_message", text: "do something", sequence: 0 }),
      makeEvent({ type: "tool_use", tool_name: "Read", tool_use_id: "tu-a", sequence: 1 }),
      makeEvent({ type: "tool_result", tool_use_id: "tu-a", content: "Error", is_error: true, sequence: 2 }),
      makeEvent({ type: "assistant_text", text: "I encountered an error", sequence: 3 }),
      makeEvent({ type: "user_message", text: "ok", sequence: 4 }),
    ];
    const result = classifySession(events, DEFAULT_CONFIG);
    const completions = result.filter(e => e.classification.subcategory === "clean_completion");
    expect(completions.length).toBe(0);
  });
});

describe("classifySession integration", () => {
  test("lone assistant_text triggers clean_completion", () => {
    const events = [makeEvent({ type: "assistant_text", text: "thinking out loud", sequence: 0 })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].classification.category).toBe("success");
    expect(result[0].classification.subcategory).toBe("clean_completion");
  });

  test("preserves event data through classification", () => {
    const events = [makeEvent({
      type: "user_message",
      text: "hello",
      session_id: "sess-preserve",
      sequence: 42,
    })];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].session_id).toBe("sess-preserve");
    expect(result[0].sequence).toBe(42);
    expect(result[0].type).toBe("user_message");
  });

  test("sorts by sequence before classifying", () => {
    const events = [
      makeEvent({ type: "assistant_text", text: "response", sequence: 1 }),
      makeEvent({ type: "user_message", text: "hello", sequence: 0 }),
    ];
    const result = classifySession(events, DEFAULT_CONFIG);
    expect(result[0].sequence).toBe(0);
    expect(result[1].sequence).toBe(1);
  });
});
