---
name: session-search
description: >-
  This skill should be used when the user asks to "search past sessions",
  "find where I solved", "how did I fix", "recall previous solution",
  "search agent history", "find in coding history", "what did I do about",
  "search across agents", "grep my sessions", "look up past conversation",
  "aggregate session data", "count sessions by agent",
  or needs to locate past solutions, decisions, or code patterns from
  previous coding agent sessions (Claude Code, Codex, Cursor, Gemini CLI,
  and others).
version: 0.3.0
---

# Session Search

Search across all indexed coding agent sessions using CASS (Coding Agent Session Search).
Supports lexical (BM25), semantic (vector), and hybrid search modes across conversations
from Claude Code, Codex, Cursor, Gemini CLI, Copilot, and 14 other agents.

## Token-efficient defaults

Every search recipe in this skill defaults to:

```
--robot-format toon --fields summary --max-tokens 1600
```

This caps a typical search at ~756 bytes (vs ~85 KB for raw `--json`). The plugin's SessionStart hook also exports `CASS_OUTPUT_FORMAT=toon` so the encoding flag is inherited from the environment when available; the per-call flag is kept in recipes for portability.

**Always start broad with `--aggregate` for any conceptual or exploratory question.** Drill into hits only after the aggregate scan narrows scope.

## Core Workflow

### 1. Aggregate first (broad question)

```bash
# Count hits by agent + date. --limit 1 + --max-content-length 100 keeps the
# response under ~1 KB. Note: `--fields` is incompatible with `--aggregate`
# (returns 0 hits + 0 aggregations); use --max-content-length to cap content
# size instead.
cass search "<query>" --aggregate agent,date --limit 1 --max-content-length 100 --robot-format toon
```

### 2. Search (lead recipe)

```bash
cass search "<query>" --robot-format toon --fields summary --max-tokens 1600 --limit 10
```

For human transcript review (verbose), opt in explicitly:

```bash
cass search "<query>" --robot-format json --limit 5     # opt-in: verbose, human-friendly
```

#### Search Modes

- **Lexical** (default): Keyword matching via BM25. Best for exact terms, error messages, function names.
- **Semantic**: Vector similarity. Best for conceptual queries ("how to handle auth").
- **Hybrid**: Fuses lexical + semantic via Reciprocal Rank Fusion. Best for broad recall.

```bash
# Semantic
cass search "authentication flow design" --mode semantic --robot-format toon --fields summary --max-tokens 1600 --limit 10

# Hybrid
cass search "retry logic for API calls" --mode hybrid --robot-format toon --fields summary --max-tokens 1600 --limit 10
```

#### Search-mode tuning (v0.3.x)

| Goal | Flags |
|------|-------|
| Broad recall, large index | `--mode hybrid --two-tier --fast-only` |
| Final synthesis pass | `--mode hybrid --rerank --quality-only` |
| Repeated semantic queries | start `cass daemon` once; pass `--daemon` |
| Large semantic index (after `--build-hnsw` indexing) | `--mode semantic --approximate` |
| Custom reranker | `--reranker <model>` |

#### Time Filters

```bash
cass search "error"     --today                          --robot-format toon --fields summary --max-tokens 1600
cass search "migration" --week                           --robot-format toon --fields summary --max-tokens 1600
cass search "feature"   --days 30                        --robot-format toon --fields summary --max-tokens 1600
cass search "refactor"  --since 2025-01-01               --robot-format toon --fields summary --max-tokens 1600
cass search "deploy"    --since 2025-03-01 --until 2025-03-15 --robot-format toon --fields summary --max-tokens 1600
```

#### Filtering

```bash
# Filter by agent
cass search "error handling" --agent claude_code --robot-format toon --fields summary --max-tokens 1600

# Filter by workspace
cass search "database migration" --workspace /path/to/project --robot-format toon --fields summary --max-tokens 1600

# Filter by source (multi-machine)
cass search "deploy" --source work-laptop --robot-format toon --fields summary --max-tokens 1600

# Chained: pipe sessions list into a narrower second query
cass search "auth" --robot-format sessions | cass search "JWT" --sessions-from - --robot-format toon --fields summary --max-tokens 1600
```

#### Aggregation

Overview counts instead of full results (~99% token reduction).

**Important quirks:**
- `--aggregate` returns BOTH aggregations AND a hit list. Default `--limit 0` (unlimited) dumps every hit alongside buckets — always pass `--limit 1` for overview-only.
- `--fields` is incompatible with `--aggregate` — combining them returns 0 hits AND 0 aggregations. Use `--max-content-length N` to cap the single returned hit's content size.

```bash
# Count by agent (overview only)
cass search "error" --aggregate agent --limit 1 --max-content-length 100 --robot-format toon

# Multi-field aggregation
cass search "*" --aggregate agent,workspace --limit 1 --max-content-length 100 --robot-format toon --week

# Time distribution
cass search "bug" --aggregate date --week --limit 1 --max-content-length 100 --robot-format toon

# Match type distribution
cass search "config" --aggregate match_type --limit 1 --max-content-length 100 --robot-format toon
```

#### Token-Efficient Output

For large result sets, control output size:

```bash
# Minimal fields
cass search "<query>" --json --fields minimal

# Summary fields
cass search "<query>" --json --fields summary

# Provenance fields (source tracking)
cass search "<query>" --json --fields provenance

# Token budget
cass search "<query>" --json --max-tokens 2000

# Truncate content
cass search "<query>" --json --max-content-length 500

# Most compact format (Token-Optimized Object Notation)
cass search "<query>" --robot-format toon --max-tokens 2000
```

#### Query Analysis

Understand how a query will be executed before running it:

```bash
# Explain query plan
cass search "complex query" --explain --json

# Dry run (no execution)
cass search "complex query" --dry-run --json
```

#### Cursor Pagination

Iterate through large result sets efficiently:

```bash
# First page
cass search "error" --json --limit 10 --robot-meta --request-id page1

# Next page (use next_cursor from _meta)
cass search "error" --json --limit 10 --cursor <next_cursor> --request-id page2
```

### 2. Drill Down

After finding a relevant result, expand context around it:

```bash
# View source at a specific line
cass view <source_path> -n <line_number> -C 10 --json

# Expand to see surrounding messages
cass expand <source_path> --line <line_number> -C 5 --json
```

### 3. Store Findings

After finding a useful solution or pattern, invoke the `mcp__memory__remember` MCP tool to store it:

- **title**: Brief description of the finding
- **content**: The key solution, pattern, or decision found
- **tags**: `["cass", "session-search", <relevant-topic-tags>]`
- **category**: `"learning"` or `"pattern"` or `"error"` (as appropriate)

Before storing, recall existing memories on the topic to avoid duplicates.

## Output Parsing

JSON search results contain these key fields per hit:

| Field | Description |
|-------|-------------|
| `source_path` | Path to the session file |
| `line_number` | Line in the session file |
| `agent` | Which agent (claude_code, codex, gemini, etc.) |
| `title` | Session or conversation title |
| `score` | Relevance score |
| `content` | Matching text snippet |
| `workspace` | Project workspace path |
| `created_at` | Timestamp |
| `match_type` | How the match was found |
| `source_id` | Source identifier (local, remote hostname) |

When using `--robot-meta`, the `_meta` block includes:
- `elapsed_ms` - Query time
- `next_cursor` - For pagination
- `index_freshness` - Staleness info
- `tokens_estimated` - Approximate token count

## Best Practices

- **Aggregate first** for any broad/conceptual question. Drill into hits only after aggregate scan narrows scope.
- **Default flags**: `--robot-format toon --fields summary --max-tokens 1600`. Add explicit `--fields snippet` or `--fields content` only when the agent must read text to answer.
- Start with lexical search for specific terms; switch to hybrid for conceptual queries.
- Chain searches to narrow: first broad `--robot-format sessions`, then pipe to a more specific `--sessions-from -` query.
- Use time filters to scope searches.
- Drill down with `cass expand` before synthesizing.
- Use cursor pagination (`--cursor <value>`) for large pages, not `--offset`.
- Run `cass daemon` once for a session of repeated semantic queries.
- Store valuable findings to memory immediately after discovery.

## Additional Resources

- **[Command Reference](../../references/command-reference.md)** - CASS CLI v0.3.x reference (hot-path commands inline; long-tail topics via `cass robot-docs <topic>`)
