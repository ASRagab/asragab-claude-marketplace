import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { parseIntOrDie, readJsonl } from "../../../plugins/skill-eval/scripts/shared";

const TMP_DIR = join(import.meta.dir, "../fixtures/.tmp");

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  try {
    const { readdirSync } = require("node:fs");
    for (const f of readdirSync(TMP_DIR)) unlinkSync(join(TMP_DIR, f));
  } catch {}
});

describe("parseIntOrDie", () => {
  test("parses valid integer string", () => {
    expect(parseIntOrDie("42", "test")).toBe(42);
  });

  test("parses negative integer", () => {
    expect(parseIntOrDie("-7", "test")).toBe(-7);
  });

  test("parses zero", () => {
    expect(parseIntOrDie("0", "test")).toBe(0);
  });

  test("truncates decimals (parseInt behavior)", () => {
    expect(parseIntOrDie("3.14", "test")).toBe(3);
  });
});

describe("readJsonl", () => {
  test("reads valid JSONL file", async () => {
    const path = join(TMP_DIR, "valid.jsonl");
    writeFileSync(path, '{"a":1}\n{"a":2}\n{"a":3}\n');
    const items = await readJsonl<{ a: number }>(path);
    expect(items).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  test("skips blank lines", async () => {
    const path = join(TMP_DIR, "blanks.jsonl");
    writeFileSync(path, '{"a":1}\n\n{"a":2}\n  \n');
    const items = await readJsonl<{ a: number }>(path);
    expect(items).toEqual([{ a: 1 }, { a: 2 }]);
  });

  test("skips malformed lines without crashing", async () => {
    const path = join(TMP_DIR, "malformed.jsonl");
    writeFileSync(path, '{"a":1}\nnot json\n{"a":3}\n');
    const items = await readJsonl<{ a: number }>(path);
    expect(items).toEqual([{ a: 1 }, { a: 3 }]);
  });

  test("returns empty array for empty file", async () => {
    const path = join(TMP_DIR, "empty.jsonl");
    writeFileSync(path, "  \n");
    const items = await readJsonl<unknown>(path);
    expect(items).toEqual([]);
  });

  test("handles single-line file without trailing newline", async () => {
    const path = join(TMP_DIR, "single.jsonl");
    writeFileSync(path, '{"x":"y"}');
    const items = await readJsonl<{ x: string }>(path);
    expect(items).toEqual([{ x: "y" }]);
  });
});
