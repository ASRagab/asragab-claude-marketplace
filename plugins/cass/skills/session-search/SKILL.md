---
name: session-search
description: >-
  This skill should be used when the user asks to "search past sessions",
  "find where I solved", "how did I fix", "recall previous solution",
  "search agent history", "find in coding history", "what did I do about",
  "search across agents", "grep my sessions", "look up past conversation",
  or needs to locate past solutions, decisions, or code patterns from
  previous coding agent sessions (Claude Code, Codex, Cursor, Gemini CLI,
  and others).
version: 0.1.0
---

# Session Search

Search across all indexed coding agent sessions using CASS (Coding Agent Session Search).
Supports lexical (BM25), semantic (vector), and hybrid search modes across 2,600+ conversations
from Claude Code, Codex, Cursor, Gemini CLI, and other agents.

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

#### Filtering

```bash
# Filter by agent
cass search "error handling" --agent claude_code --json

# Filter by workspace
cass search "database migration" --workspace /path/to/project --json

# Chained searches (narrow results progressively)
cass search "auth" --robot-format sessions | cass search "JWT" --sessions-from - --json
```

#### Token-Efficient Output

For large result sets, control output size:

```bash
# Minimal fields
cass search "<query>" --json --fields minimal

# Summary fields
cass search "<query>" --json --fields summary

# Token budget
cass search "<query>" --json --max-tokens 2000

# Truncate content
cass search "<query>" --json --max-content-length 500
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

## Best Practices

- Start with lexical search for specific terms; switch to hybrid for conceptual queries.
- Use `--fields minimal` when scanning many results to save tokens.
- Chain searches to narrow: first broad query, then pipe to a more specific query.
- Always drill down with `cass expand` before synthesizing an answer.
- Store valuable findings to memory immediately after discovery.

## Additional Resources

### Reference Files

- **`references/command-reference.md`** - Complete CASS CLI reference with all flags and options
