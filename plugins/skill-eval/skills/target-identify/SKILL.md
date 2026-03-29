---
name: target-identify
description: >-
  Use LLM-as-judge to analyze friction clusters from M2 classified events and
  identify which skills, prompts, tools, or workflows are the best candidates
  for optimization. Clusters friction by root cause, scores targets by
  frequency x severity x improvability, and outputs a ranked target list.
version: 1.0.0
compatibility: Claude Code with Bun runtime
---

# Target Identify (M3)

LLM-as-judge analysis to surface ranked optimization targets from session friction clusters.

## Status: Complete

## Usage

```bash
# Identify targets from classified events
bun scripts/target-identify.ts -i classified-all.jsonl -o targets.jsonl

# Limit to top 3 targets
bun scripts/target-identify.ts -i classified-all.jsonl --top 3 -o targets.jsonl

# Use a specific model
bun scripts/target-identify.ts -i classified-all.jsonl --model claude-sonnet-4-5-20250514 -o targets.jsonl

# Dry run: show clusters without calling LLM
bun scripts/target-identify.ts -i classified-all.jsonl --dry-run

# Stats only: show cluster sizes
bun scripts/target-identify.ts -i classified-all.jsonl --stats

# Require more evidence per cluster
bun scripts/target-identify.ts -i classified-all.jsonl --min-events 5 -o targets.jsonl

# Pipe from stdin
cat classified-all.jsonl | bun scripts/target-identify.ts --top 5 -o targets.jsonl
```

## CLI Options

| Flag | Description |
|------|-------------|
| `--input, -i <file>` | Input classified-events.jsonl from M2 (or stdin) |
| `--output, -o <file>` | Output file (default: stdout) |
| `--model <model>` | Anthropic model (default: claude-haiku-4-5-20251001) |
| `--min-events <n>` | Minimum events per cluster to assess (default: 2) |
| `--top <n>` | Output top N targets (default: 10) |
| `--concurrency <n>` | Parallel LLM calls (default: 5) |
| `--stats` | Print summary stats only |
| `--dry-run` | Show clusters without calling LLM |
| `--help` | Show help |

## Dependencies

- Bun runtime
- `@anthropic-ai/sdk` (npm)
- **Requires `ANTHROPIC_API_KEY` environment variable**

## Scoring

Targets are ranked by composite score: `frequency * log2(session_count + 1) * severity * improvability`. The LLM judge assesses each friction cluster for root cause, target type, severity (1-5), improvability (1-5), suggested action, and eval questions.
