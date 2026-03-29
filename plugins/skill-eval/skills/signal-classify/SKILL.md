---
name: signal-classify
description: >-
  Classify extracted session events into noise, friction, success, and neutral
  categories. Identifies friction signals (tool errors, user corrections, retries,
  long chains, abandoned approaches) and success signals (clean completions,
  user acknowledgments). Rule-based, no LLM calls required.
version: 1.0.0
compatibility: Claude Code with Bun runtime
---

# Signal Classify (M2)

Categorize M1 extracted events into noise, friction, success, and neutral using rule-based heuristics.

## Status: Complete

## Usage

```bash
# Classify events from M1 output
bun scripts/signal-classify.ts -i events.jsonl -o classified-all.jsonl

# Show only friction signals
bun scripts/signal-classify.ts -i events.jsonl --filter friction

# Summary stats only
bun scripts/signal-classify.ts -i events.jsonl --stats

# Include noise events (filtered by default)
bun scripts/signal-classify.ts -i events.jsonl --include-noise -o classified-all.jsonl

# Pipe from stdin
cat events.jsonl | bun scripts/signal-classify.ts --filter friction

# Tune detection thresholds
bun scripts/signal-classify.ts -i events.jsonl --retry-threshold 4 --long-chain-threshold 15
```

## CLI Options

| Flag | Description |
|------|-------------|
| `--input, -i <file>` | Input events.jsonl from M1 (or stdin) |
| `--output, -o <file>` | Output file (default: stdout) |
| `--filter <category>` | Only output events of this category (`noise`, `friction`, `success`, `neutral`) |
| `--stats` | Print summary stats only |
| `--retry-threshold <n>` | Retry detection threshold (default: 3) |
| `--long-chain-threshold <n>` | Long chain threshold (default: 10) |
| `--min-confidence <n>` | Minimum confidence to include (default: 0.0) |
| `--include-noise` | Include noise events in output (default: filter them) |
| `--help` | Show help |

## Dependencies

- Bun runtime
- No external packages (pure rule-based classification)

## Classification Taxonomy

| Category | Subcategory | Description |
|----------|-------------|-------------|
| noise | progress | Progress events (hook, mcp, bash, agent) |
| noise | system_meta | Queue ops, last-prompt, system prompts, isMeta |
| friction | tool_error | Tool returned is_error=true |
| friction | tool_error_timeout | Timeout or TTL exceeded |
| friction | tool_error_permission | Permission denied / EACCES |
| friction | tool_error_size | File or content size exceeded |
| friction | tool_error_api_mismatch | Unexpected keyword/argument errors |
| friction | parallel_cancellation | Cascading cancellation from parallel failure |
| friction | user_correction | User text with correction language |
| friction | retry | Same tool called 3+ times in window after an error |
| friction | long_chain | >N tool calls for single user request |
| friction | abandoned | Tool result not referenced, direction changed |
| success | clean_completion | Turn ended without preceding errors |
| success | user_ack | Positive user acknowledgment |
