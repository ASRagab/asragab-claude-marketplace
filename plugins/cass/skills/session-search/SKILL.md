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
version: 0.2.0
---

# Session Search

Search across all indexed coding agent sessions using CASS (Coding Agent Session Search).
Supports lexical (BM25), semantic (vector), and hybrid search modes across conversations
from Claude Code, Codex, Cursor, Gemini CLI, Copilot, and 14 other agents.

## Core Workflow

### 1. Search

Run searches via Bash with `--json` for machine-readable output:

```bash
cass search "<query>" --json --limit 10
```

#### Search Modes

- **Lexical** (default): Keyword matching via BM25. Best for exact terms, error messages, function names.
- **Semantic**: Vector similarity. Best for conceptual queries ("how to handle auth").
- **Hybrid**: Fuses lexical + semantic via Reciprocal Rank Fusion. Best for broad recall.

```bash
# Semantic search
cass search "authentication flow design" --mode semantic --json --limit 10

# Hybrid search
cass search "retry logic for API calls" --mode hybrid --json --limit 10
```

#### Time Filters

Narrow results to a specific time window:

```bash
cass search "error" --today --json                    # today only
cass search "migration" --week --json                 # last 7 days
cass search "feature" --days 30 --json                # last 30 days
cass search "refactor" --since 2025-01-01 --json      # since date
cass search "deploy" --since 2025-03-01 --until 2025-03-15 --json  # date range
```

#### Filtering

```bash
# Filter by agent
cass search "error handling" --agent claude_code --json

# Filter by workspace
cass search "database migration" --workspace /path/to/project --json

# Filter by source (multi-machine)
cass search "deploy" --source work-laptop --json

# Chained searches (narrow results progressively)
cass search "auth" --robot-format sessions | cass search "JWT" --sessions-from - --json
```

#### Aggregation

Get overview counts instead of full results (~99% token reduction):

```bash
# Count by agent
cass search "error" --json --aggregate agent

# Multi-field aggregation
cass search "*" --json --aggregate agent,workspace

# Time distribution
cass search "bug" --json --aggregate date --week

# Match type distribution
cass search "config" --json --aggregate match_type
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

- Start with lexical search for specific terms; switch to hybrid for conceptual queries.
- Use `--aggregate` for overview queries before drilling into details.
- Use `--fields minimal` when scanning many results to save tokens.
- Use `--robot-format toon` for maximum token efficiency.
- Chain searches to narrow: first broad query, then pipe to a more specific query.
- Use time filters to scope searches to relevant periods.
- Always drill down with `cass expand` before synthesizing an answer.
- Store valuable findings to memory immediately after discovery.

## Additional Resources

- **[Command Reference](../../references/command-reference.md)** - Complete CASS CLI v0.2.7 reference
