---
name: transcript-extract
description: >-
  Extract structured events from Claude Code session transcripts into normalized
  JSONL format. Parses user messages, tool_use blocks, tool results, thinking
  blocks, errors, progress events, and subagent transcripts.
version: 1.0.0
compatibility: Claude Code with Bun runtime
---

# Transcript Extract (M1)

Extract structured, machine-readable events from Claude Code session transcripts stored in `~/.claude/projects/`.

## Status: Complete

## Usage

```bash
# Extract all sessions from last 7 days
bun scripts/transcript-extract.ts --since 7d -o events.jsonl

# Extract a single session by UUID
bun scripts/transcript-extract.ts --session <uuid> -o events.jsonl

# Filter by project slug
bun scripts/transcript-extract.ts --project my-project --since 3d -o events.jsonl

# Include subagent transcripts
bun scripts/transcript-extract.ts --since 7d --include-subagents -o events.jsonl

# Output summary stats instead of JSONL
bun scripts/transcript-extract.ts --since 7d --format summary

# Pipe single session to jq
bun scripts/transcript-extract.ts --session abc-123 | jq '.type'
```

## CLI Options

| Flag | Description |
|------|-------------|
| `--session <uuid>` | Extract a single session by UUID |
| `--project <slug>` | Filter by project slug |
| `--since <duration>` | Only sessions modified in last N (e.g. `7d`, `24h`, `30m`) |
| `--include-subagents` | Also extract subagent transcripts |
| `--output, -o <file>` | Output file (default: stdout) |
| `--format <format>` | `jsonl` (default) or `summary` |
| `--help` | Show help |

## Dependencies

- Bun runtime
- No external packages (reads `~/.claude/projects/` directly)

## Output

Each line in the output JSONL is a normalized event. Event types: `user_message`, `assistant_text`, `tool_use`, `tool_result`, `thinking`, `progress`, `system`.
