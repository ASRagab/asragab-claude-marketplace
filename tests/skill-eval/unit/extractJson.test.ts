import { describe, test, expect } from "bun:test";
import { extractJson } from "../../../plugins/skill-eval/scripts/shared";

describe("extractJson", () => {
  test("parses clean JSON object", () => {
    const result = extractJson('{"key": "value"}');
    expect(result).toEqual({ key: "value" });
  });

  test("parses JSON wrapped in markdown code fences", () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(extractJson(input)).toEqual({ key: "value" });
  });

  test("parses JSON with surrounding prose", () => {
    const input = 'Here is the result:\n{"answer": "yes", "reason": "looks good"}\nThat is my assessment.';
    expect(extractJson(input)).toEqual({ answer: "yes", reason: "looks good" });
  });

  test("handles braces inside JSON string values", () => {
    const obj = { patch: 'function foo() { return { x: 1 }; }' };
    const input = `Some text ${JSON.stringify(obj)} more text`;
    expect(extractJson(input)).toEqual(obj);
  });

  test("handles escaped quotes inside strings", () => {
    const obj = { description: 'He said \\"hello\\"' };
    const raw = JSON.stringify(obj);
    expect(extractJson(raw)).toEqual(JSON.parse(raw));
  });

  test("handles newlines escaped as \\n in string values", () => {
    const input = '{"patch": "line1\\nline2\\nline3"}';
    const result = extractJson(input);
    expect(result.patch).toBe("line1\nline2\nline3");
  });

  test("handles nested objects", () => {
    const input = '{"a": {"b": {"c": 1}}}';
    expect(extractJson(input)).toEqual({ a: { b: { c: 1 } } });
  });

  test("skips malformed first brace group, finds valid second", () => {
    const input = '{broken json here} {"valid": true}';
    expect(extractJson(input)).toEqual({ valid: true });
  });

  test("throws on no valid JSON", () => {
    expect(() => extractJson("no json here at all")).toThrow(
      "No valid JSON object found",
    );
  });

  test("throws on empty input", () => {
    expect(() => extractJson("")).toThrow("No valid JSON object found");
  });

  test("handles JSON with array values containing braces", () => {
    const input = '{"items": ["a{b}", "c}d"]}';
    expect(extractJson(input)).toEqual({ items: ["a{b}", "c}d"] });
  });

  test("strips code fences without language tag", () => {
    const input = '```\n{"key": 42}\n```';
    expect(extractJson(input)).toEqual({ key: 42 });
  });
});
