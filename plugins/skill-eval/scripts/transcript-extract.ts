#!/usr/bin/env bun
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import type {
  CLIOptions,
  ExtractedEvent,
  BaseEvent,
  RawMessage,
  RawUserMessage,
  RawAssistantMessage,
  RawProgressMessage,
  RawQueueOperation,
  RawLastPrompt,
  RawSystemMessage,
  RawContentBlock,
  SubagentMeta,
} from "./types";

const CLAUDE_DIR = resolve(process.env.HOME ?? "/root", ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

const DURATION_MULTIPLIERS: Record<string, number> = {
  d: 86400000,
  h: 3600000,
  m: 60000,
  s: 1000,
};

function printHelp(): void {
  console.log(
    [
      "Usage: bun scripts/transcript-extract.ts [options]",
      "",
      "Options:",
      "  --session <uuid>         Extract a single session by UUID",
      "  --project <slug>         Filter by project slug",
      "  --since <duration>       Only sessions modified in last N (e.g. 7d, 24h)",
      "  --include-subagents      Also extract subagent transcripts",
      "  --output, -o <file>      Output file (default: stdout)",
      "  --format <format>        jsonl (default) or summary",
      "  --help                   Show help",
    ].join("\n")
  );
}

function parseDuration(raw: string): number {
  const match = raw.match(/^(\d+)(d|h|m|s)$/);
  if (!match) {
    console.error(`Invalid duration: ${raw}. Expected format like "7d", "24h", "30m".`);
    process.exit(1);
  }
  return Date.now() - parseInt(match[1], 10) * DURATION_MULTIPLIERS[match[2]];
}

function parseArgs(argv: string[]): CLIOptions {
  const opts: CLIOptions = {
    session: null,
    project: null,
    since: null,
    includeSubagents: false,
    output: null,
    format: "jsonl",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
        printHelp();
        process.exit(0);
      case "--session":
        opts.session = argv[++i];
        break;
      case "--project":
        opts.project = argv[++i];
        break;
      case "--since":
        opts.since = parseDuration(argv[++i]);
        break;
      case "--include-subagents":
        opts.includeSubagents = true;
        break;
      case "--output":
      case "-o":
        opts.output = argv[++i];
        break;
      case "--format": {
        const fmt = argv[++i];
        if (fmt !== "jsonl" && fmt !== "summary") {
          console.error(`Invalid format: ${fmt}. Expected "jsonl" or "summary".`);
          process.exit(1);
        }
        opts.format = fmt;
        break;
      }
      default:
        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  return opts;
}

interface TranscriptFile {
  path: string;
  projectSlug: string;
  sessionId: string;
  isSubagent: boolean;
  parentSessionId: string | null;
  subagentId: string | null;
}

function collectSubagents(subagentDir: string, slug: string, parentSessionId: string): TranscriptFile[] {
  if (!existsSync(subagentDir)) return [];
  return readdirSync(subagentDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => {
      const agentId = e.name.replace(/\.jsonl$/, "");
      return {
        path: join(subagentDir, e.name),
        projectSlug: slug,
        sessionId: `${parentSessionId}/${agentId}`,
        isSubagent: true,
        parentSessionId,
        subagentId: agentId,
      };
    });
}

function discoverTranscripts(opts: CLIOptions): TranscriptFile[] {
  if (!existsSync(PROJECTS_DIR)) {
    console.error(`Projects directory not found: ${PROJECTS_DIR}`);
    process.exit(1);
  }

  const files: TranscriptFile[] = [];

  for (const slug of readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!slug.isDirectory()) continue;
    if (opts.project && slug.name !== opts.project) continue;

    const projectDir = join(PROJECTS_DIR, slug.name);

    for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

      const sessionId = entry.name.replace(/\.jsonl$/, "");
      if (opts.session && sessionId !== opts.session) continue;

      const filePath = join(projectDir, entry.name);
      if (opts.since && statSync(filePath).mtimeMs < opts.since) continue;

      files.push({
        path: filePath,
        projectSlug: slug.name,
        sessionId,
        isSubagent: false,
        parentSessionId: null,
        subagentId: null,
      });

      if (opts.includeSubagents) {
        files.push(...collectSubagents(join(projectDir, sessionId, "subagents"), slug.name, sessionId));
      }
    }
  }

  return files;
}

function loadSubagentMeta(transcriptPath: string): SubagentMeta | null {
  const metaPath = join(dirname(transcriptPath), basename(transcriptPath, ".jsonl") + ".meta.json");
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8")) as SubagentMeta;
  } catch {
    return null;
  }
}

function makeBase(
  tf: TranscriptFile,
  seq: number,
  overrides: Partial<BaseEvent>,
  subagentMeta: SubagentMeta | null
): BaseEvent {
  return {
    session_id: tf.sessionId,
    timestamp: overrides.timestamp ?? "",
    sequence: seq,
    message_uuid: overrides.message_uuid ?? "",
    parent_message_uuid: overrides.parent_message_uuid ?? null,
    cwd: overrides.cwd ?? "",
    git_branch: overrides.git_branch ?? null,
    is_subagent: tf.isSubagent,
    parent_session_id: tf.parentSessionId,
    subagent_id: tf.subagentId,
    subagent_type: subagentMeta?.agentType ?? null,
    model: overrides.model ?? null,
    version: overrides.version ?? null,
  };
}

function extractTextFromContent(content: string | RawContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function extractToolResults(
  content: string | RawContentBlock[]
): Array<{ tool_use_id: string; content: string; is_error: boolean }> {
  if (typeof content === "string") return [];
  return content
    .filter(
      (b): b is { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean } =>
        b.type === "tool_result"
    )
    .map((b) => ({ tool_use_id: b.tool_use_id, content: b.content, is_error: b.is_error ?? false }));
}

type Emitter = (event: ExtractedEvent) => void;

function handleUser(m: RawUserMessage, tf: TranscriptFile, seq: { n: number }, meta: SubagentMeta | null, emit: Emitter): void {
  const base: Partial<BaseEvent> = {
    timestamp: m.timestamp,
    message_uuid: m.uuid,
    parent_message_uuid: m.parentUuid || null,
    cwd: m.cwd,
    git_branch: m.gitBranch ?? null,
    version: m.version,
  };

  const text = extractTextFromContent(m.message.content);
  if (text) {
    emit({ ...makeBase(tf, seq.n++, base, meta), type: "user_message", text });
  }

  for (const tr of extractToolResults(m.message.content)) {
    emit({ ...makeBase(tf, seq.n++, base, meta), type: "tool_result", ...tr });
  }
}

function handleAssistant(m: RawAssistantMessage, tf: TranscriptFile, seq: { n: number }, meta: SubagentMeta | null, emit: Emitter): void {
  const base: Partial<BaseEvent> = {
    timestamp: m.timestamp,
    message_uuid: m.uuid,
    parent_message_uuid: m.parentUuid || null,
    cwd: m.cwd,
    git_branch: m.gitBranch ?? null,
    model: m.message.model,
    version: m.version,
  };

  for (const block of m.message.content) {
    switch (block.type) {
      case "text":
        emit({ ...makeBase(tf, seq.n++, base, meta), type: "assistant_text", text: block.text });
        break;
      case "thinking":
        emit({ ...makeBase(tf, seq.n++, base, meta), type: "thinking", text: block.thinking });
        break;
      case "tool_use":
        emit({
          ...makeBase(tf, seq.n++, base, meta),
          type: "tool_use",
          tool_use_id: block.id,
          tool_name: block.name,
          tool_input: block.input,
        });
        break;
    }
  }
}

function processTranscript(tf: TranscriptFile): ExtractedEvent[] {
  const raw = readFileSync(tf.path, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  const subagentMeta = tf.isSubagent ? loadSubagentMeta(tf.path) : null;
  const events: ExtractedEvent[] = [];
  const emit: Emitter = (e) => events.push(e);
  const seq = { n: 0 };

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    let msg: RawMessage;
    try {
      msg = JSON.parse(lines[lineNum]);
    } catch {
      console.error(`[warn] Malformed JSON at ${tf.path}:${lineNum + 1}, skipping`);
      continue;
    }

    if (!msg || typeof msg !== "object" || !("type" in msg)) {
      console.error(`[warn] Missing type field at ${tf.path}:${lineNum + 1}, skipping`);
      continue;
    }

    switch (msg.type) {
      case "queue-operation": {
        const m = msg as RawQueueOperation;
        emit({
          ...makeBase(tf, seq.n++, { timestamp: m.timestamp, message_uuid: `queue-${m.sessionId}-${lineNum}` }, subagentMeta),
          type: "system",
          subtype: "queue-operation",
          content: m.content,
        });
        break;
      }
      case "user":
        handleUser(msg as RawUserMessage, tf, seq, subagentMeta, emit);
        break;
      case "assistant":
        handleAssistant(msg as RawAssistantMessage, tf, seq, subagentMeta, emit);
        break;
      case "progress": {
        const m = msg as RawProgressMessage;
        emit({
          ...makeBase(tf, seq.n++, {
            timestamp: m.timestamp ?? "",
            message_uuid: `progress-${tf.sessionId}-${lineNum}`,
            parent_message_uuid: m.parentUuid || null,
          }, subagentMeta),
          type: "progress",
          hook_event: m.data.hookEvent,
          hook_name: m.data.hookName,
        });
        break;
      }
      case "last-prompt": {
        const m = msg as RawLastPrompt;
        emit({
          ...makeBase(tf, seq.n++, { timestamp: m.timestamp ?? "", message_uuid: `last-prompt-${m.sessionId}` }, subagentMeta),
          type: "system",
          subtype: "last-prompt",
          content: m.lastPrompt,
        });
        break;
      }
      case "system": {
        const m = msg as RawSystemMessage;
        emit({
          ...makeBase(tf, seq.n++, {
            timestamp: m.timestamp ?? "",
            message_uuid: m.uuid ?? `system-${tf.sessionId}-${lineNum}`,
            parent_message_uuid: m.parentUuid ?? null,
            cwd: m.cwd ?? "",
            git_branch: m.gitBranch ?? null,
            version: m.version ?? null,
          }, subagentMeta),
          type: "system",
          subtype: "system-prompt",
          content: extractTextFromContent(m.message?.content ?? ""),
        });
        break;
      }
      case "file-history-snapshot":
        break;
      default:
        console.error(`[warn] Unknown message type "${(msg as any).type}" at ${tf.path}:${lineNum + 1}, skipping`);
    }
  }

  return events;
}

function printSummary(allEvents: ExtractedEvent[]): void {
  const sessions = new Set(allEvents.map((e) => e.session_id));
  const typeCounts: Record<string, number> = {};
  let minTs = Infinity;
  let maxTs = -Infinity;

  for (const ev of allEvents) {
    typeCounts[ev.type] = (typeCounts[ev.type] ?? 0) + 1;
    if (ev.timestamp) {
      const t = new Date(ev.timestamp).getTime();
      if (!isNaN(t)) {
        if (t < minTs) minTs = t;
        if (t > maxTs) maxTs = t;
      }
    }
  }

  console.log(`Sessions:     ${sessions.size}`);
  console.log(`Total events: ${allEvents.length}`);
  console.log("");
  console.log("Events by type:");
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(20)} ${count}`);
  }
  console.log("");
  if (minTs !== Infinity) {
    console.log(`Date range: ${new Date(minTs).toISOString()} .. ${new Date(maxTs).toISOString()}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const transcripts = discoverTranscripts(opts);

  if (transcripts.length === 0) {
    console.error("No transcripts found matching the given filters.");
    process.exit(1);
  }

  console.error(`[info] Found ${transcripts.length} transcript file(s)`);

  const allEvents: ExtractedEvent[] = [];
  for (const tf of transcripts) {
    allEvents.push(...processTranscript(tf));
  }

  console.error(`[info] Extracted ${allEvents.length} events`);

  if (opts.format === "summary") {
    printSummary(allEvents);
    return;
  }

  const outputLines = allEvents.map((e) => JSON.stringify(e));
  const outputText = outputLines.join("\n") + (outputLines.length > 0 ? "\n" : "");

  if (opts.output) {
    await Bun.write(opts.output, outputText);
    console.error(`[info] Wrote ${allEvents.length} events to ${opts.output}`);
  } else {
    process.stdout.write(outputText);
  }
}

main();
