# M1: Transcript ETL -- Design Document

**Status:** Draft
**Date:** 2026-03-24
**Plugin:** skill-eval
**Script:** `scripts/transcript-extract.ts`

---

## 1. Overview

M1 extracts structured, machine-readable events from Claude Code session transcripts (JSONL files stored at `~/.claude/projects/`) into a normalized event stream. The pipeline reads raw session files, discriminates message types, extracts tool use/result pairs, thinking blocks, errors, and metadata, then emits a single `events.jsonl` file where each line is a self-contained event with a stable schema. This output feeds M2 (Signal Classification) and is independently useful for any session analysis.

---

## 2. Goals & Non-Goals

### Goals

- **G1:** Parse all 6 message types in Claude Code transcripts (user, assistant, system, progress, queue-operation, last-prompt) into typed output events.
- **G2:** Extract tool_use and tool_result as paired but separate events, preserving tool name, input, output, and error status.
- **G3:** Surface thinking blocks as first-class events (these are invisible to CASS).
- **G4:** Handle subagent transcripts by recursively parsing nested JSONL files.
- **G5:** Preserve temporal ordering with monotonic sequence numbers per session.
- **G6:** Capture token usage data from assistant messages.
- **G7:** Work standalone with zero dependencies (no CASS required).

### Non-Goals

- **NG1:** Signal classification (M2's job).
- **NG2:** Semantic analysis or summarization of message content.
- **NG3:** Deduplication across sessions (each session is processed independently).
- **NG4:** Real-time / streaming extraction (batch only for now).
- **NG5:** Modifying or writing back to transcript files.
- **NG6:** Handling non-Claude-Code JSONL formats.

---

## 3. Architecture

```
                         ┌─────────────────────┐
                         │  Session Discovery   │
                         │  (fs glob or CASS)   │
                         └──────────┬──────────┘
                                    │ list of .jsonl paths
                                    ▼
                         ┌─────────────────────┐
                         │   JSONL Line Reader  │
                         │  (streaming, per-file)│
                         └──────────┬──────────┘
                                    │ raw message objects
                                    ▼
                         ┌─────────────────────┐
                         │  Message Router      │
                         │  (by message.type)   │
                         └──────────┬──────────┘
                          ┌────┬────┼────┬────┐
                          ▼    ▼    ▼    ▼    ▼
                        user asst system prog other
                          │    │    │    │    │
                          ▼    ▼    ▼    ▼    ▼
                         ┌─────────────────────┐
                         │  Content Block       │
                         │  Extractor           │
                         │  (text, tool_use,    │
                         │   tool_result,       │
                         │   thinking)          │
                         └──────────┬──────────┘
                                    │ NormalizedEvent[]
                                    ▼
                         ┌─────────────────────┐
                         │  Subagent Resolver   │
                         │  (recurse into       │
                         │   subagent .jsonl)   │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │  Sequence Stamper    │
                         │  + JSONL Writer      │
                         └─────────────────────┘
                                    │
                                    ▼
                              events.jsonl
```

### Key design decisions

1. **Streaming line reader.** Sessions can be large after extended use. Read line-by-line with `readline` or Bun's line-based file reader; never load a full session into memory.
2. **One message produces N events.** A single assistant message may contain multiple content blocks (text + thinking + 3 tool_use calls). Each block becomes its own event; they share the same `message_uuid` for re-grouping.
3. **Subagent recursion is bounded.** Subagents are parsed with the same pipeline, with `is_subagent: true` and `parent_session_id` set. Max recursion depth: 3 (subagent of a subagent of a subagent).

---

## 4. Input Format

### File locations

- **Sessions:** `~/.claude/projects/<project-hash>/<session-uuid>.jsonl`
- **Subagents:** `~/.claude/projects/<project-hash>/<session-uuid>/subagents/agent-<id>.jsonl`

### Raw message structure (from R1)

Each line is a JSON object. The discriminator field is `type`.

```jsonc
{
  "type": "user" | "assistant" | "system" | "progress" | "queue-operation" | "last-prompt",
  "uuid": "msg-uuid",
  "parentUuid": "parent-msg-uuid",
  "sessionId": "session-uuid",
  "timestamp": "2026-03-24T10:00:00.000Z",
  "version": "1.0.0",
  "cwd": "/home/user/project",
  "gitBranch": "main",
  "message": {
    "role": "user" | "assistant" | "system",
    "content": [ /* content blocks */ ]
  },
  // Assistant messages only:
  "usage": {
    "input_tokens": 1234,
    "output_tokens": 567,
    "cache_creation_input_tokens": 100,
    "cache_read_input_tokens": 800
  }
}
```

### Content block types (inside `message.content`)

| Block type    | Found in   | Key fields |
|---------------|------------|------------|
| `text`        | user, assistant | `type: "text"`, `text: string` |
| `thinking`    | assistant  | `type: "thinking"`, `thinking: string` |
| `tool_use`    | assistant  | `type: "tool_use"`, `id: string`, `name: string`, `input: object` |
| `tool_result` | user       | `type: "tool_result"`, `tool_use_id: string`, `content: string \| object[]`, `is_error: boolean` |

### Progress message subtypes

Progress messages have a `subtype` field:

- `hook_progress` -- Hook execution updates
- `mcp_progress` -- MCP server communication
- `bash_progress` -- Bash command streaming output
- `agent_progress` -- Subagent execution updates

### System message signals

- `compact_boundary` in content indicates a compaction event (context window was compressed).

---

## 5. Output Schema

### TypeScript type definitions

```typescript
/** Discriminated union of all event types */
type NormalizedEvent =
  | UserMessageEvent
  | AssistantTextEvent
  | ToolUseEvent
  | ToolResultEvent
  | ToolErrorEvent
  | ThinkingEvent
  | SystemEvent
  | CompactionEvent
  | ProgressEvent;

/** Fields shared by every event */
interface BaseEvent {
  /** The session this event belongs to */
  session_id: string;
  /** ISO 8601 timestamp from the source message */
  timestamp: string;
  /** Monotonically increasing position within the session (0-based) */
  sequence: number;
  /** UUID of the source message in the transcript */
  message_uuid: string;
  /** UUID of the parent message (for threading / turn reconstruction) */
  parent_message_uuid: string | null;
  /** Working directory at the time of the message */
  cwd: string | null;
  /** Git branch at the time of the message */
  git_branch: string | null;
  /** Whether this event came from a subagent transcript */
  is_subagent: boolean;
  /** If is_subagent, the parent session that spawned it */
  parent_session_id: string | null;
  /** Subagent identifier (e.g., "agent-1") if applicable */
  subagent_id: string | null;
}

interface UserMessageEvent extends BaseEvent {
  type: "user_message";
  /** The user's text content (concatenated if multiple text blocks) */
  text: string;
}

interface AssistantTextEvent extends BaseEvent {
  type: "assistant_text";
  /** The assistant's text response */
  text: string;
  /** Model identifier from the message metadata */
  model: string | null;
  /** Token usage for the full assistant turn (attached to first event in the turn) */
  usage: TokenUsage | null;
}

interface ToolUseEvent extends BaseEvent {
  type: "tool_use";
  /** The tool_use block id (links to the corresponding tool_result) */
  tool_use_id: string;
  /** Tool name: Bash, Read, Edit, Write, Glob, Grep, etc. */
  tool_name: string;
  /** The input parameters sent to the tool */
  tool_input: Record<string, unknown>;
  /** Model that made the tool call */
  model: string | null;
}

interface ToolResultEvent extends BaseEvent {
  type: "tool_result";
  /** The tool_use block id this result corresponds to */
  tool_use_id: string;
  /** Tool name (resolved from the matching tool_use event) */
  tool_name: string | null;
  /** The tool's output, truncated to max_output_length */
  tool_output: string;
  /** Whether the output was truncated */
  output_truncated: boolean;
}

interface ToolErrorEvent extends BaseEvent {
  type: "tool_error";
  /** The tool_use block id this error corresponds to */
  tool_use_id: string;
  /** Tool name (resolved from the matching tool_use event) */
  tool_name: string | null;
  /** The error message */
  error: string;
}

interface ThinkingEvent extends BaseEvent {
  type: "thinking";
  /** The assistant's internal reasoning, truncated to max_thinking_length */
  text: string;
  /** Whether the text was truncated */
  text_truncated: boolean;
  /** Model identifier */
  model: string | null;
}

interface SystemEvent extends BaseEvent {
  type: "system";
  /** The system message content */
  text: string;
}

interface CompactionEvent extends BaseEvent {
  type: "compaction";
  /** Signals that a context compaction boundary was encountered */
  /** All messages before this point were compressed */
}

interface ProgressEvent extends BaseEvent {
  type: "progress";
  /** The progress subtype */
  subtype: "hook_progress" | "mcp_progress" | "bash_progress" | "agent_progress";
  /** Raw progress payload (structure varies by subtype) */
  payload: Record<string, unknown>;
}

interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}
```

### Output constraints

| Field | Constraint |
|-------|-----------|
| `tool_output` | Truncated to 10,000 characters by default (configurable via `--max-output-length`) |
| `text` on ThinkingEvent | Truncated to 5,000 characters by default (configurable via `--max-thinking-length`) |
| `tool_input` | Preserved as-is (no truncation; inputs are typically small) |
| `sequence` | Globally unique within a session; events from the same message get consecutive numbers |

---

## 6. Extraction Rules

### Message type -> event type mapping

#### `type: "user"` messages

Iterate `message.content` blocks:

| Content block type | Output event type | Field mapping |
|-------------------|-------------------|---------------|
| `text` | `user_message` | `text` <- `block.text` |
| `tool_result` with `is_error: false` | `tool_result` | `tool_use_id` <- `block.tool_use_id`, `tool_output` <- stringify(`block.content`), `tool_name` <- lookup from `tool_use_id_map` |
| `tool_result` with `is_error: true` | `tool_error` | `tool_use_id` <- `block.tool_use_id`, `error` <- stringify(`block.content`), `tool_name` <- lookup from `tool_use_id_map` |

**Note:** A single user message often contains both `tool_result` blocks (responses to previous tool calls) and a `text` block (the user's next instruction). Each becomes a separate event.

#### `type: "assistant"` messages

Iterate `message.content` blocks:

| Content block type | Output event type | Field mapping |
|-------------------|-------------------|---------------|
| `text` | `assistant_text` | `text` <- `block.text`, `model` <- message metadata, `usage` <- `message.usage` (first text event only) |
| `thinking` | `thinking` | `text` <- `block.thinking` (truncated) |
| `tool_use` | `tool_use` | `tool_use_id` <- `block.id`, `tool_name` <- `block.name`, `tool_input` <- `block.input` |

**Side effect:** For each `tool_use` block, register `block.id -> block.name` in the `tool_use_id_map` (used to resolve tool names on subsequent `tool_result` events).

#### `type: "system"` messages

- If content contains `compact_boundary`: emit `compaction` event.
- Otherwise: emit `system` event with `text` <- stringify content.

#### `type: "progress"` messages

- Emit `progress` event with `subtype` <- `message.subtype`, `payload` <- remaining message fields.
- **Default behavior:** Progress events are **excluded** from output unless `--include-progress` flag is set (they are noisy and rarely useful for M2).

#### `type: "queue-operation"` and `type: "last-prompt"` messages

- **Skipped by default.** These are internal bookkeeping. Not emitted as events.
- If `--include-meta` flag is set, emit as `system` events with the raw content.

### The tool_use_id_map

A per-session in-memory map: `Map<string, string>` mapping `tool_use_id -> tool_name`.

- **Populated** when processing `tool_use` blocks from assistant messages.
- **Consumed** when processing `tool_result` / `tool_error` blocks from user messages.
- **Handles parallel tool calls:** An assistant message can contain multiple `tool_use` blocks. All IDs are registered before the next user message is processed.
- **Fallback:** If a `tool_result` references an unknown `tool_use_id` (e.g., from a compacted prefix), `tool_name` is set to `null`.

---

## 7. Edge Cases

### 7.1 Compacted sessions

When Claude Code hits the context window limit, it compacts earlier messages. The transcript contains a `system` message with `compact_boundary`. After compaction:

- Messages before the boundary are still in the file but may reference tool_use_ids that appear in the compacted (summarized) prefix.
- **Handling:** Process the entire file linearly. The `tool_use_id_map` accumulates across the full file, so IDs from pre-compaction messages are still resolvable. Emit a `compaction` event at the boundary so downstream consumers know the context was compressed.

### 7.2 Subagent transcripts

- Subagent files live at `<session-dir>/subagents/agent-<id>.jsonl`.
- **Discovery:** After processing the main session file, glob for `<session-uuid>/subagents/agent-*.jsonl`.
- **Processing:** Run the same extraction pipeline recursively, setting `is_subagent: true`, `parent_session_id` to the parent session, and `subagent_id` to the agent identifier.
- **Sequence numbering:** Subagent events get their own sequence counter (scoped to the subagent). They are interleaved into the output after the main session events, grouped by subagent.
- **Depth limit:** Max recursion depth of 3. If exceeded, log a warning and skip.

### 7.3 Parallel tool calls

An assistant message may issue multiple `tool_use` blocks in a single turn. The corresponding `tool_result` blocks arrive in the next user message, potentially in a different order.

- **Handling:** Each `tool_use` and `tool_result` becomes its own event. They are linked by `tool_use_id`, not by position. The `tool_use_id_map` ensures correct name resolution regardless of ordering.

### 7.4 Empty or missing content

- `message.content` is an empty array: skip, emit no events.
- `message.content` is a string (not array): wrap in a synthetic text block and process normally.
- `message` field is missing entirely: skip the line, log a warning.

### 7.5 Malformed JSONL lines

- Lines that fail `JSON.parse`: skip, log a warning with line number and file path.
- Lines that parse but lack expected fields (`type`, `message`): skip, log a warning.
- **Principle:** Never crash on bad input. Log and continue.

### 7.6 Large tool outputs

Some tool results (e.g., `Read` on a large file, `Bash` with verbose output) can be tens of thousands of characters.

- **Handling:** Truncate `tool_output` to `--max-output-length` (default 10,000 chars). Set `output_truncated: true` on the event.

### 7.7 Duplicate messages

If the same `uuid` appears multiple times in a file (e.g., due to a crash/replay):

- **Handling:** Deduplicate by `uuid`. Keep the last occurrence (latest write wins).

---

## 8. CASS Integration

CASS integration is an **optional alternative path** for session discovery. It does not replace the raw transcript parser.

### What CASS provides

- **Session listing:** `cass sessions` returns session IDs, timestamps, project paths.
- **Text search:** `cass search <query>` finds sessions containing specific text (BM25, semantic, or hybrid).
- **Session stats:** `cass stats <session-id>` returns message counts, tool usage, duration.

### How CASS is used

```
┌─────────────────────────┐     ┌─────────────────────────┐
│  Session Discovery      │     │  Session Discovery      │
│  (default: fs glob)     │ OR  │  (--source cass)        │
│  ~/.claude/projects/**  │     │  cass sessions --since  │
│  *.jsonl                │     │  cass search <query>    │
└────────────┬────────────┘     └────────────┬────────────┘
             │                               │
             │  list of session paths/ids    │
             └──────────────┬────────────────┘
                            ▼
             ┌─────────────────────────────┐
             │  Raw Transcript Parser      │
             │  (always reads .jsonl files)│
             └─────────────────────────────┘
```

- **`--source fs` (default):** Glob `~/.claude/projects/**/*.jsonl`, filter by `--since` using file mtime.
- **`--source cass`:** Shell out to `cass sessions --since <period> --json` to get session IDs, then resolve each to its `.jsonl` file path. Optionally use `cass search <query>` to pre-filter sessions by content.
- **In both cases:** The actual extraction always reads the raw `.jsonl` file. CASS is never used as the data source for event extraction (it lacks the required granularity per R2 findings).

### CASS availability detection

```typescript
async function isCassAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["cass", "--version"]);
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}
```

If `--source cass` is specified but CASS is not installed, exit with a clear error message.

---

## 9. CLI Interface

### Command

```bash
bun scripts/transcript-extract.ts [options]
```

### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--output`, `-o` | string | `stdout` | Output file path (JSONL). Use `-` for stdout. |
| `--session` | string | (all) | Extract from a specific session ID only. |
| `--since` | string | `7d` | Time window: `1d`, `7d`, `30d`, `2026-03-01`, etc. |
| `--source` | `fs` \| `cass` | `fs` | Session discovery method. |
| `--search` | string | (none) | If `--source cass`, pre-filter sessions by search query. |
| `--project` | string | (all) | Filter to a specific project hash or path. |
| `--include-progress` | boolean | `false` | Include progress events in output. |
| `--include-meta` | boolean | `false` | Include queue-operation and last-prompt as system events. |
| `--include-subagents` | boolean | `true` | Recursively parse subagent transcripts. |
| `--max-output-length` | number | `10000` | Max characters for tool_output before truncation. |
| `--max-thinking-length` | number | `5000` | Max characters for thinking text before truncation. |
| `--claude-dir` | string | `~/.claude` | Override the Claude config directory. |
| `--verbose`, `-v` | boolean | `false` | Print extraction stats to stderr (sessions found, events emitted, warnings). |

### Usage examples

```bash
# Extract all sessions from last 7 days to a file
bun scripts/transcript-extract.ts --since 7d -o events.jsonl

# Extract a single session to stdout (pipe to jq)
bun scripts/transcript-extract.ts --session abc-123-def | jq '.type'

# Use CASS to find sessions mentioning "deploy" and extract them
bun scripts/transcript-extract.ts --source cass --search "deploy" -o deploy-events.jsonl

# Extract with full fidelity (progress + meta + no truncation)
bun scripts/transcript-extract.ts --include-progress --include-meta --max-output-length 0 -o full.jsonl

# Extract from a non-default Claude directory
bun scripts/transcript-extract.ts --claude-dir /tmp/test-claude -o test-events.jsonl
```

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | No sessions found matching criteria |
| 2 | Invalid arguments |
| 3 | CASS not available (when `--source cass`) |

### Stderr output (with `--verbose`)

```
[transcript-extract] Discovered 12 sessions (source: fs, since: 7d)
[transcript-extract] Processing session abc-123-def (1/12)...
[transcript-extract]   WARNING: Skipping malformed line 47 in abc-123-def.jsonl
[transcript-extract] Processing session ghi-456-jkl (2/12)...
[transcript-extract]   Found 2 subagent transcripts
[transcript-extract] Done. 12 sessions, 1847 events emitted, 1 warning.
```

---

## 10. Implementation Plan

### Phase 1: Core types and reader (Day 1)

1. **Define TypeScript types** in `src/types.ts` -- `NormalizedEvent`, `BaseEvent`, and all event variants as specified in Section 5.
2. **Build the JSONL line reader** in `src/reader.ts` -- streaming line-by-line reader using `Bun.file().stream()` with `TextDecoderStream` + line splitting. Returns `AsyncIterable<unknown>` (parsed JSON objects).
3. **Build session discovery** in `src/discovery.ts`:
   - `discoverSessionsFs(claudeDir, options)` -- glob for `.jsonl` files, filter by mtime.
   - `discoverSessionsCass(options)` -- shell out to `cass sessions`, parse JSON output.
   - Both return `SessionInfo[]` with `{ sessionId, filePath, projectHash }`.

### Phase 2: Message router and extractors (Day 1-2)

4. **Build the message router** in `src/router.ts` -- switch on `message.type`, delegate to the appropriate extractor function.
5. **Build content block extractors** in `src/extractors.ts`:
   - `extractFromUserMessage(msg, ctx): NormalizedEvent[]`
   - `extractFromAssistantMessage(msg, ctx): NormalizedEvent[]`
   - `extractFromSystemMessage(msg, ctx): NormalizedEvent[]`
   - `extractFromProgressMessage(msg, ctx): NormalizedEvent[]`
   - Each returns zero or more events. The `ctx` object carries the `tool_use_id_map`, sequence counter, and session metadata.
6. **Build the extraction context** in `src/context.ts`:
   ```typescript
   interface ExtractionContext {
     sessionId: string;
     toolUseIdMap: Map<string, string>;
     sequenceCounter: { value: number };
     isSubagent: boolean;
     parentSessionId: string | null;
     subagentId: string | null;
     options: ExtractOptions;
     warnings: string[];
   }
   ```

### Phase 3: Subagent handling and writer (Day 2)

7. **Build subagent resolver** in `src/subagents.ts` -- after processing a session file, glob for `<session-dir>/subagents/agent-*.jsonl`, process each with a fresh context (linked via `parent_session_id`).
8. **Build the JSONL writer** in `src/writer.ts` -- accepts `AsyncIterable<NormalizedEvent>`, writes to file or stdout. One `JSON.stringify` + newline per event.

### Phase 4: CLI entry point (Day 2-3)

9. **Build CLI** in `scripts/transcript-extract.ts` -- parse args (use `parseArgs` from `node:util` or a lightweight arg parser), wire up discovery -> extraction -> writing pipeline.
10. **Add verbose logging** to stderr.
11. **Add CASS availability check** and `--source cass` path.

### Phase 5: Hardening (Day 3)

12. **Error handling sweep** -- ensure no uncaught exceptions; all malformed input is logged and skipped.
13. **Add deduplication** -- track seen `uuid` values, skip duplicates.
14. **Add truncation** -- enforce `max-output-length` and `max-thinking-length`.
15. **Test with real sessions** (see Validation Plan).

### File structure

```
plugins/skill-eval/
  scripts/
    transcript-extract.ts        # CLI entry point
  src/
    transcript-etl/
      types.ts                   # NormalizedEvent types
      reader.ts                  # Streaming JSONL reader
      discovery.ts               # Session discovery (fs + cass)
      router.ts                  # Message type router
      extractors.ts              # Content block -> event extractors
      context.ts                 # ExtractionContext
      subagents.ts               # Subagent resolution
      writer.ts                  # JSONL output writer
```

---

## 11. Validation Plan

### V1: Unit-level correctness (automated)

Create a `test/fixtures/` directory with synthetic JSONL files covering each message type:

| Fixture file | Covers |
|-------------|--------|
| `user-text.jsonl` | Simple user text message -> `user_message` event |
| `assistant-text.jsonl` | Assistant text response -> `assistant_text` event |
| `assistant-thinking.jsonl` | Thinking block -> `thinking` event |
| `tool-call-single.jsonl` | Single tool_use + tool_result pair |
| `tool-call-parallel.jsonl` | 3 parallel tool_use blocks + 3 tool_result blocks |
| `tool-error.jsonl` | tool_result with `is_error: true` -> `tool_error` event |
| `compaction.jsonl` | System message with compact_boundary -> `compaction` event |
| `progress-events.jsonl` | Various progress subtypes |
| `malformed-lines.jsonl` | Invalid JSON, missing fields (verify graceful skip) |
| `empty-content.jsonl` | Empty content arrays, string content, missing message |

For each fixture: run extraction, assert exact expected output events (type, field values, count).

### V2: Integration test on real sessions

1. Select 5 real sessions of varying complexity:
   - A short session (< 20 messages)
   - A long session (100+ messages, with compaction)
   - A session with subagents
   - A session with multiple parallel tool calls
   - A session with tool errors and user corrections

2. For each session:
   - Run extraction, capture output.
   - Manually read the raw `.jsonl` and verify:
     - Every meaningful message produced at least one event.
     - `tool_use_id` linkage is correct (every `tool_result` references a real `tool_use`).
     - Sequence numbers are monotonically increasing.
     - No events are duplicated.
     - Timestamps are preserved accurately.

### V3: Completeness check

For a real session, count:
- Total lines in source `.jsonl` (minus progress/meta if excluded).
- Total events in output `events.jsonl`.
- Verify the ratio is reasonable (should be >= 1:1 since one message can produce multiple events).

### V4: Roundtrip test

For a session, verify that the set of all `tool_use_id` values in `tool_use` events exactly matches the set of all `tool_use_id` values in `tool_result` + `tool_error` events (within the same session, accounting for compaction).

### V5: Performance baseline

Measure extraction time on a large session (1000+ messages). Target: < 2 seconds for a single session, < 30 seconds for a full 7-day extraction across all projects.

---

## Appendix A: Example Input/Output

### Input (3 lines from a session JSONL)

```jsonc
// Line 1: User asks a question
{"type":"user","uuid":"u1","parentUuid":null,"sessionId":"sess-1","timestamp":"2026-03-24T10:00:00Z","message":{"role":"user","content":[{"type":"text","text":"What files are in src/?"}]}}

// Line 2: Assistant calls a tool
{"type":"assistant","uuid":"a1","parentUuid":"u1","sessionId":"sess-1","timestamp":"2026-03-24T10:00:01Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"I should list the files in src/"},{"type":"tool_use","id":"tu-1","name":"Bash","input":{"command":"ls src/"}}]},"usage":{"input_tokens":500,"output_tokens":50,"cache_creation_input_tokens":0,"cache_read_input_tokens":400}}

// Line 3: Tool result comes back
{"type":"user","uuid":"u2","parentUuid":"a1","sessionId":"sess-1","timestamp":"2026-03-24T10:00:02Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu-1","content":"index.ts\nutils.ts\ntypes.ts","is_error":false}]}}
```

### Output (5 events)

```jsonc
{"session_id":"sess-1","timestamp":"2026-03-24T10:00:00Z","sequence":0,"message_uuid":"u1","parent_message_uuid":null,"cwd":null,"git_branch":null,"is_subagent":false,"parent_session_id":null,"subagent_id":null,"type":"user_message","text":"What files are in src/?"}
{"session_id":"sess-1","timestamp":"2026-03-24T10:00:01Z","sequence":1,"message_uuid":"a1","parent_message_uuid":"u1","cwd":null,"git_branch":null,"is_subagent":false,"parent_session_id":null,"subagent_id":null,"type":"thinking","text":"I should list the files in src/","text_truncated":false,"model":null}
{"session_id":"sess-1","timestamp":"2026-03-24T10:00:01Z","sequence":2,"message_uuid":"a1","parent_message_uuid":"u1","cwd":null,"git_branch":null,"is_subagent":false,"parent_session_id":null,"subagent_id":null,"type":"tool_use","tool_use_id":"tu-1","tool_name":"Bash","tool_input":{"command":"ls src/"},"model":null}
{"session_id":"sess-1","timestamp":"2026-03-24T10:00:02Z","sequence":3,"message_uuid":"u2","parent_message_uuid":"a1","cwd":null,"git_branch":null,"is_subagent":false,"parent_session_id":null,"subagent_id":null,"type":"tool_result","tool_use_id":"tu-1","tool_name":"Bash","tool_output":"index.ts\nutils.ts\ntypes.ts","output_truncated":false}
```

Note: 3 input lines produced 4 output events (the assistant message expanded into a `thinking` event and a `tool_use` event).
