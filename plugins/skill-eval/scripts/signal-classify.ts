#!/usr/bin/env bun

import { parseArgs } from "util";
import type {
  ExtractedEvent,
  ClassificationLabel,
  ClassifiedEvent,
} from "./types";

function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object" && "text" in c) return String((c as { text: unknown }).text);
        if (c && typeof c === "object" && "tool_name" in c) return String((c as { tool_name: unknown }).tool_name);
        return "";
      })
      .join(" ");
  }
  return String(content ?? "");
}

const CORRECTION_PATTERNS = [
  { pattern: /\bno[,.]?\s+(not|don't|instead|that's wrong)/i, confidence: 0.9 },
  { pattern: /\binstead\b.*\b(do|try|use)\b/i, confidence: 0.8 },
  { pattern: /\bactually[,.]?\s+(let|can|I|we)/i, confidence: 0.7 },
  { pattern: /\bwait[,.]?\s+(don't|stop|no)/i, confidence: 0.9 },
  { pattern: /\bthat's (not|wrong)/i, confidence: 0.9 },
  { pattern: /\bdon't do that\b/i, confidence: 0.95 },
  { pattern: /\brevert\b/i, confidence: 0.7 },
  { pattern: /\bundo\b/i, confidence: 0.7 },
];

const ACK_PATTERNS = [
  /\b(looks good|lgtm|perfect|great|thanks|thank you|nice|awesome|exactly)\b/i,
  /^(yes|yep|yup|correct|right)\b/i,
  /\bgood (job|work)\b/i,
];

const NOISE_SYSTEM_SUBTYPES = new Set([
  "queue-operation",
  "last-prompt",
  "system-prompt",
]);

interface Config {
  retryThreshold: number;
  longChainThreshold: number;
  retryWindowSize: number;
  abandonedLookback: number;
}

function classifyNoise(event: ExtractedEvent): ClassificationLabel | null {
  if (event.type === "progress") {
    return { category: "noise", subcategory: "progress", confidence: 1.0 };
  }

  if (event.type === "system") {
    if (NOISE_SYSTEM_SUBTYPES.has(event.subtype)) {
      return { category: "noise", subcategory: "system_meta", confidence: 1.0 };
    }
  }

  return null;
}

function classifyToolError(event: ExtractedEvent): ClassificationLabel | null {
  if (event.type !== "tool_result" || !event.is_error) return null;

  const raw = contentToString(event.content);
  const content = raw.toLowerCase();

  if (content.includes("cancelled: parallel") || content.includes("canceled: parallel")) {
    return {
      category: "friction",
      subcategory: "parallel_cancellation",
      confidence: 1.0,
      evidence: `Parallel cancellation: ${raw.slice(0, 100)}`,
    };
  }

  if (content.includes("unexpected keyword") || content.includes("unexpected argument") || content.includes("invalid argument")) {
    return {
      category: "friction",
      subcategory: "tool_error_api_mismatch",
      confidence: 1.0,
      evidence: `API mismatch: ${raw.slice(0, 100)}`,
    };
  }

  if (content.includes("exceeds maximum") || content.includes("too large") || content.includes("size limit")) {
    return {
      category: "friction",
      subcategory: "tool_error_size",
      confidence: 1.0,
      evidence: `Size limit: ${raw.slice(0, 100)}`,
    };
  }

  if (content.includes("timeout") || content.includes("ttl")) {
    return {
      category: "friction",
      subcategory: "tool_error_timeout",
      confidence: 1.0,
      evidence: `Timeout: ${raw.slice(0, 100)}`,
    };
  }

  if (content.includes("permission") || content.includes("denied") || content.includes("eacces")) {
    return {
      category: "friction",
      subcategory: "tool_error_permission",
      confidence: 1.0,
      evidence: `Permission denied: ${raw.slice(0, 100)}`,
    };
  }

  return {
    category: "friction",
    subcategory: "tool_error",
    confidence: 1.0,
    evidence: `Tool error: ${raw.slice(0, 100)}`,
  };
}

function classifyUserCorrection(event: ExtractedEvent): ClassificationLabel | null {
  if (event.type !== "user_message") return null;
  if (event.text.length < 5 || event.text.length > 500) return null;

  for (const { pattern, confidence } of CORRECTION_PATTERNS) {
    if (pattern.test(event.text)) {
      return {
        category: "friction",
        subcategory: "user_correction",
        confidence,
        evidence: `Matched: ${pattern.source}`,
      };
    }
  }
  return null;
}

function classifyUserAck(event: ExtractedEvent): ClassificationLabel | null {
  if (event.type !== "user_message") return null;

  for (const pattern of ACK_PATTERNS) {
    if (pattern.test(event.text)) {
      return {
        category: "success",
        subcategory: "user_ack",
        confidence: 0.7,
        evidence: `Ack: "${event.text.slice(0, 50)}"`,
      };
    }
  }
  return null;
}

function classifyPerEvent(event: ExtractedEvent): ClassificationLabel | null {
  return classifyToolError(event)
    ?? classifyUserCorrection(event)
    ?? classifyUserAck(event);
}

function detectRetry(
  events: ExtractedEvent[],
  index: number,
  config: Config,
): ClassificationLabel | null {
  const current = events[index];
  if (current.type !== "tool_use") return null;

  const windowStart = Math.max(0, index - config.retryWindowSize);
  let count = 1;
  let hasErrorInWindow = false;
  for (let i = windowStart; i < index; i++) {
    const e = events[i];
    if (e.type === "tool_use" && e.tool_name === current.tool_name) {
      count++;
    }
    if (e.type === "tool_result" && e.is_error) {
      hasErrorInWindow = true;
    }
  }

  // Only flag as retry when repeated calls follow an error — distinguishes
  // error-driven retries from normal multi-step tool use (e.g., reading
  // several files in sequence).
  if (count >= config.retryThreshold && hasErrorInWindow) {
    return {
      category: "friction",
      subcategory: "retry",
      confidence: 0.8,
      evidence: `"${current.tool_name}" called ${count}x in ${index - windowStart + 1}-event window (error-driven)`,
    };
  }
  return null;
}

function detectLongChain(
  events: ExtractedEvent[],
  index: number,
  config: Config,
): ClassificationLabel | null {
  const current = events[index];
  if (current.type !== "tool_use") return null;

  let chainLength = 0;
  for (let i = index; i >= 0; i--) {
    if (events[i].type === "user_message") break;
    if (events[i].type === "tool_use") chainLength++;
  }

  // Only label the event that first crosses the threshold, not every
  // subsequent tool_use in the same chain
  if (chainLength === config.longChainThreshold) {
    return {
      category: "friction",
      subcategory: "long_chain",
      confidence: 0.6,
      evidence: `${chainLength} tool calls since last user message`,
    };
  }
  return null;
}

function detectCleanCompletion(
  events: ExtractedEvent[],
  index: number,
): ClassificationLabel | null {
  const current = events[index];

  // Only fire on the last assistant_text before a user_message (actual turn completion),
  // not on every intermediate text block in a multi-block response.
  const next = events[index + 1];
  if (next && next.type !== "user_message") return null;
  if (current.type !== "assistant_text") return null;

  for (let i = index - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "user_message") break;
    if (e.type === "tool_result" && e.is_error) return null;
  }

  return {
    category: "success",
    subcategory: "clean_completion",
    confidence: 0.8,
    evidence: "Assistant completed turn without preceding errors",
  };
}

function detectAbandoned(
  events: ExtractedEvent[],
  index: number,
  config: Config,
): ClassificationLabel | null {
  const current = events[index];
  if (current.type !== "tool_result" || current.is_error) return null;

  let nextAssistant: (ExtractedEvent & { type: "assistant_text" }) | null = null;
  let nextUser: (ExtractedEvent & { type: "user_message" }) | null = null;

  const lookLimit = Math.min(events.length, index + config.abandonedLookback + 2);
  for (let i = index + 1; i < lookLimit; i++) {
    const e = events[i];
    if (e.type === "assistant_text" && !nextAssistant) {
      nextAssistant = e;
    }
    if (e.type === "user_message" && !nextUser) {
      nextUser = e;
      break;
    }
  }

  if (!nextAssistant || !nextUser) return null;

  const outputTokens = contentToString(current.content)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 4);
  const assistantLower = nextAssistant.text.toLowerCase();
  const referencesOutput = outputTokens.some((token) => assistantLower.includes(token));

  if (!referencesOutput) {
    const directionChange = /\b(actually|instead|forget|never\s?mind|different|let's try|switch)\b/i;
    if (directionChange.test(nextUser.text)) {
      return {
        category: "friction",
        subcategory: "abandoned",
        confidence: 0.5,
        evidence: "Tool result not referenced, user changed direction",
      };
    }
  }

  return null;
}

function classifyWindowed(
  events: ExtractedEvent[],
  index: number,
  config: Config,
): ClassificationLabel | null {
  return detectRetry(events, index, config)
    ?? detectLongChain(events, index, config)
    ?? detectCleanCompletion(events, index)
    ?? detectAbandoned(events, index, config);
}

function classifySession(
  events: ExtractedEvent[],
  config: Config,
): ClassifiedEvent[] {
  const sorted = events.toSorted((a, b) => a.sequence - b.sequence);
  const results: ClassifiedEvent[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i];

    const label =
      classifyNoise(event)
      ?? classifyPerEvent(event)
      ?? classifyWindowed(sorted, i, config)
      ?? { category: "neutral" as const, subcategory: "unclassified", confidence: 1.0 };

    results.push({ ...event, classification: label });
  }

  return results;
}

function printStats(events: ClassifiedEvent[]): void {
  const total = events.length;
  if (total === 0) {
    process.stderr.write("No events to classify.\n");
    return;
  }

  const byCat: Record<string, number> = { noise: 0, friction: 0, success: 0, neutral: 0 };
  const bySub: Record<string, number> = {};

  for (const e of events) {
    const c = e.classification;
    byCat[c.category] = (byCat[c.category] ?? 0) + 1;
    if (c.category === "friction" || c.category === "success") {
      bySub[c.subcategory] = (bySub[c.subcategory] ?? 0) + 1;
    }
  }

  const pct = (n: number) => ((n / total) * 100).toFixed(1);
  const pad = (s: string, w: number) => s.padEnd(w);

  const lines: string[] = [];
  lines.push("Signal Classification Summary");
  lines.push("=".repeat(40));
  lines.push(`Total events:        ${total.toLocaleString()}`);
  lines.push(`Noise (filtered):    ${byCat.noise.toLocaleString().padStart(6)} (${pct(byCat.noise)}%)`);

  lines.push(`Friction:            ${byCat.friction.toLocaleString().padStart(6)} (${pct(byCat.friction)}%)`);
  const frictionSubs = Object.entries(bySub)
    .filter(([k]) => !["clean_completion", "user_ack"].includes(k))
    .sort(([, a], [, b]) => b - a);
  for (const [sub, count] of frictionSubs) {
    lines.push(`  ${pad(sub + ":", 26)} ${count}`);
  }

  lines.push(`Success:             ${byCat.success.toLocaleString().padStart(6)} (${pct(byCat.success)}%)`);
  const successSubs = Object.entries(bySub)
    .filter(([k]) => ["clean_completion", "user_ack"].includes(k))
    .sort(([, a], [, b]) => b - a);
  for (const [sub, count] of successSubs) {
    lines.push(`  ${pad(sub + ":", 26)} ${count}`);
  }

  lines.push(`Neutral:             ${byCat.neutral.toLocaleString().padStart(6)} (${pct(byCat.neutral)}%)`);

  process.stderr.write(lines.join("\n") + "\n");
}

function printHelp(): void {
  const help = `Usage: bun scripts/signal-classify.ts [options]

Classify M1 extracted events into noise/friction/success/neutral categories.

Options:
  --input, -i <file>          Input events.jsonl (or stdin)
  --output, -o <file>         Output file (default: stdout)
  --filter <category>         Only output events of this category
  --stats                     Print summary stats only
  --retry-threshold <n>       Retry detection threshold (default: 3)
  --long-chain-threshold <n>  Long chain threshold (default: 10)
  --min-confidence <n>        Minimum confidence to include (default: 0.0)
  --include-noise             Include noise events in output (default: filter them)
  --help                      Show this help
`;
  process.stderr.write(help);
}

async function readInput(inputPath: string | null): Promise<ExtractedEvent[]> {
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

  const events: ExtractedEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as ExtractedEvent);
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      input: { type: "string", short: "i" },
      output: { type: "string", short: "o" },
      filter: { type: "string" },
      stats: { type: "boolean", default: false },
      "retry-threshold": { type: "string", default: "3" },
      "long-chain-threshold": { type: "string", default: "10" },
      "min-confidence": { type: "string", default: "0.0" },
      "include-noise": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const config: Config = {
    retryThreshold: parseInt(values["retry-threshold"]!, 10),
    longChainThreshold: parseInt(values["long-chain-threshold"]!, 10),
    retryWindowSize: 5,
    abandonedLookback: 3,
  };

  const minConfidence = parseFloat(values["min-confidence"]!);
  const filterCategory = values.filter as ClassificationLabel["category"] | undefined;
  if (filterCategory && !["noise", "friction", "success", "neutral"].includes(filterCategory)) {
    process.stderr.write(`Invalid --filter category: "${filterCategory}". Valid: noise, friction, success, neutral\n`);
    process.exit(1);
  }
  const includeNoise = values["include-noise"]!;
  const statsOnly = values.stats!;

  const events = await readInput(values.input ?? null);

  if (events.length === 0) {
    process.stderr.write("No events found in input.\n");
    process.exit(1);
  }

  const sessionMap = new Map<string, ExtractedEvent[]>();
  for (const event of events) {
    const list = sessionMap.get(event.session_id);
    if (list) {
      list.push(event);
    } else {
      sessionMap.set(event.session_id, [event]);
    }
  }

  const allClassified: ClassifiedEvent[] = [];
  for (const sessionEvents of sessionMap.values()) {
    allClassified.push(...classifySession(sessionEvents, config));
  }

  if (statsOnly) {
    printStats(allClassified);
    process.exit(0);
  }

  let output = allClassified;

  if (!includeNoise && filterCategory !== "noise") {
    output = output.filter((e) => e.classification.category !== "noise");
  }

  if (filterCategory) {
    output = output.filter((e) => e.classification.category === filterCategory);
  }

  if (minConfidence > 0) {
    output = output.filter((e) => e.classification.confidence >= minConfidence);
  }

  const lines = output.map((e) => JSON.stringify(e)).join("\n");

  if (values.output) {
    await Bun.write(values.output, lines + "\n");
    process.stderr.write(`Wrote ${output.length} events to ${values.output}\n`);
  } else {
    process.stdout.write(lines + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(2);
});
