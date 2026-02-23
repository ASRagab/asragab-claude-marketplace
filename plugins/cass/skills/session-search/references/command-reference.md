# CASS Command Reference

Complete reference for CASS CLI v0.1.64 (Coding Agent Session Search).

## Global Options

| Flag | Description |
|------|-------------|
| `--db <DB>` | Path to SQLite database |
| `-q, --quiet` | Warnings and errors only |
| `-v, --verbose` | Show debug information |
| `--color <auto\|never\|always>` | Color output behavior |
| `--progress <auto\|bars\|plain\|none>` | Progress display style |
| `--wrap <N>` | Wrap output to N columns |
| `--nowrap` | Disable wrapping |

## Commands

### `cass search <QUERY>`

Full-text and semantic search across all sessions.

**Arguments:**
- `<QUERY>` - Search query string

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--agent <AGENT>` | Filter by agent (repeatable) | all |
| `--workspace <PATH>` | Filter by workspace (repeatable) | all |
| `--limit <N>` | Max results | 10 |
| `--offset <N>` | Pagination offset | 0 |
| `--json` / `--robot` | JSON output | off |
| `--robot-format <FMT>` | Output format: json, jsonl, compact, sessions, toon | json |
| `--robot-meta` | Include extended metadata | off |
| `--fields <FIELDS>` | Select fields: minimal, summary, or comma-separated | all |
| `--max-content-length <N>` | Truncate content to N chars | unlimited |
| `--max-tokens <N>` | Soft token budget for output | unlimited |
| `--mode <MODE>` | Search mode: lexical, semantic, hybrid | lexical |
| `--highlight` | Highlight matching terms | off |
| `--source <SRC>` | Filter: local, remote, all, or hostname | all |
| `--sessions-from <FILE>` | Filter to sessions from file (use `-` for stdin) | - |
| `--approximate` | Use ANN/HNSW for faster semantic search | off |
| `--rerank` | Enable result reranking | off |
| `--two-tier` | Progressive search: fast then refined | off |
| `--fast-only` | Lightweight embedder only | off |
| `--quality-only` | Full transformer model only | off |
| `--request-id <ID>` | Correlation ID for robot output | - |

**JSON Output Fields:**

| Field | Description |
|-------|-------------|
| `source_path` | Path to session file |
| `line_number` | Line number in session |
| `agent` | Agent slug (claude_code, codex, etc.) |
| `title` | Session title |
| `score` | Relevance score |
| `content` | Matching text snippet |
| `workspace` | Workspace path |

**Field Presets:**
- `minimal` = source_path, line_number, agent
- `summary` = source_path, line_number, agent, title, score

### `cass view <PATH>`

View a source file at a specific line.

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --line <LINE>` | Line number (1-indexed) | - |
| `-C, --context <N>` | Context lines before/after | 5 |
| `--json` | JSON output | off |

### `cass expand <PATH>`

Show messages around a specific line in a session file.

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --line <LINE>` | Line number (required) | - |
| `-C, --context <N>` | Messages before/after | 3 |
| `--json` | JSON output | off |

### `cass context <PATH>`

Find related sessions for a given source path.

| Flag | Description | Default |
|------|-------------|---------|
| `--limit <N>` | Max results per relation type | 5 |
| `--json` | JSON output | off |

### `cass timeline`

Show activity timeline for a time range.

| Flag | Description | Default |
|------|-------------|---------|
| `--since <TIME>` | Start: ISO date, today, yesterday, Nd | - |
| `--until <TIME>` | End time | now |
| `--today` | Show today only | off |
| `--agent <AGENT>` | Filter by agent (repeatable) | all |
| `--group-by <GROUP>` | Group: hour, day, none | hour |
| `--source <SRC>` | Filter: local, remote, all, hostname | all |
| `--json` | JSON output | off |

### `cass stats`

Show statistics about indexed data.

| Flag | Description |
|------|-------------|
| `--json` | JSON output |

Returns: total conversations, messages, per-agent counts, workspace stats.

### `cass health`

Minimal health check (<50ms).

| Flag | Description |
|------|-------------|
| `--json` | JSON output |

Exit 0 = healthy, 1 = unhealthy.

### `cass index`

Build or update the search index.

| Flag | Description |
|------|-------------|
| `--full` | Full re-index (not incremental) |
| `--semantic` | Build semantic embeddings |
| `--approximate` | Build HNSW index for ANN search |

### `cass export <SESSION>`

Export a conversation to markdown or other formats.

### `cass export-html <SESSION>`

Export session as self-contained HTML with optional AES-256-GCM encryption.

### `cass doctor`

Diagnose and repair installation issues. Safe by default.

| Flag | Description |
|------|-------------|
| `--fix` | Apply automatic repairs |

## Supported Agents

| Slug | Agent |
|------|-------|
| `claude_code` | Claude Code |
| `codex` | OpenAI Codex CLI |
| `cursor` | Cursor |
| `gemini` | Gemini CLI |
| `opencode` | OpenCode |
| `cline` | Cline |
| `aider` | Aider |
| `amp` | Amp |
| `chatgpt` | ChatGPT |
| `pi_agent` | Pi Agent |
| `factory` | Factory (Droid) |
| `vibe` | Vibe (Mistral) |
| `clawdbot` | Clawdbot |

## Chained Search Pattern

Narrow results progressively by piping session paths:

```bash
cass search "auth" --robot-format sessions | cass search "JWT token" --sessions-from - --json
```

## Token Optimization

For agent consumption, minimize token usage:

```bash
# Minimal fields + token budget
cass search "<query>" --json --fields minimal --max-tokens 1000

# Toon format (most compact)
cass search "<query>" --robot-format toon --max-tokens 1000
```
