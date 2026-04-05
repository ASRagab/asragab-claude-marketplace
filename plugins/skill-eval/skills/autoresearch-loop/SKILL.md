---
name: autoresearch-loop
description: >-
  Run an autoresearch-style optimization loop on a target identified by M3.
  Generates improvements via LLM, evaluates them against the target's eval
  questions, keeps improvements that beat the best score, and tracks all
  experiments in a JSONL state file. Inspired by Karpathy's autoresearch pattern.
version: 1.0.0
compatibility: Claude Code with Bun runtime
---

# Autoresearch Loop (M4)

Iterative optimization of skills, prompts, and code via the autoresearch pattern.

## Status: Complete

## Usage

```bash
# Run optimization loop on the top-ranked target
bun scripts/autoresearch-loop.ts -t targets.jsonl --max-rounds 20

# Optimize a specific target by rank
bun scripts/autoresearch-loop.ts -t targets.jsonl --target-rank 3 --max-rounds 10

# Dry run: show what would be optimized
bun scripts/autoresearch-loop.ts -t targets.jsonl --dry-run

# Use a custom state directory
bun scripts/autoresearch-loop.ts -t targets.jsonl --state-dir ./experiments-v2

# View summary of previous experiments
bun scripts/autoresearch-loop.ts --summary --state-dir ./experiments
```

## CLI Options

| Flag | Description |
|------|-------------|
| `--targets, -t <file>` | Input targets.jsonl from M3 (required unless `--summary`) |
| `--target-rank <n>` | Which target to optimize by rank (default: 1 = highest) |
| `--max-rounds <n>` | Max improvement rounds (default: 10) |
| `--state-dir <dir>` | Directory for experiment state files (default: `./experiments`) |
| `--summary` | Print summary of existing experiments |
| `--dry-run` | Show what would be optimized without running |
| `--help` | Show help |

## Dependencies

- Bun runtime
- `@anthropic-ai/sdk` (npm)
- **Requires `ANTHROPIC_API_KEY` environment variable**

## Loop Mechanics

1. Load target + experiment history from state file
2. LLM generates an improvement hypothesis and concrete patch
3. LLM evaluates the patch against the target's eval questions (yes/no)
4. Score > best score? Keep (update baseline). Otherwise discard.
5. Append round to experiment state JSONL
6. Early stop on: perfect score, 5 consecutive discards, or 3 consecutive crashes
