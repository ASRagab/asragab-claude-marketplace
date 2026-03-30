export function extractJson(text: string): Record<string, unknown> {
  // Strip markdown code fences
  const stripped = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");

  // Try direct parse first (covers clean responses)
  try {
    const trimmed = stripped.trim();
    if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  } catch { /* fall through to brace scanner */ }

  // Balanced-brace scanner, string-literal-aware
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          return JSON.parse(stripped.slice(start, i + 1));
        } catch {
          start = -1;
        }
      }
    }
  }
  throw new Error("No valid JSON object found in response");
}

export function parseIntOrDie(value: string, name: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n)) {
    process.stderr.write(`Error: Invalid integer for ${name}: "${value}"\n`);
    process.exit(1);
  }
  return n;
}

export async function readJsonl<T>(inputPath: string | null): Promise<T[]> {
  let raw: string;
  if (inputPath) {
    const { readFileSync } = await import("node:fs");
    raw = readFileSync(inputPath, "utf-8");
  } else {
    raw = await Bun.stdin.text();
  }
  const items: T[] = [];
  let skipped = 0;
  for (const line of raw.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      items.push(JSON.parse(line) as T);
    } catch {
      skipped++;
    }
  }
  if (skipped > 0) {
    process.stderr.write(`[warn] Skipped ${skipped} malformed input lines\n`);
  }
  return items;
}
