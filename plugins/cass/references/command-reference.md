# CASS CLI Command Reference — v0.2.7

## Global Options

These flags apply to all commands.

| Flag | Description |
|------|-------------|
| `--db <DB>` | Path to SQLite database |
| `-q, --quiet` | Warnings and errors only |
| `-v, --verbose` | Show debug information |
| `--color <auto\|never\|always>` | Color output behavior |
| `--progress <auto\|bars\|plain\|none>` | Progress display style |
| `--wrap <N>` | Wrap output to N columns |
| `--nowrap` | Disable wrapping |
| `--robot-format <FMT>` | Global output format: `json`, `jsonl`, `compact`, `sessions`, `toon` |

---

## Output Formats

| Format | Description |
|--------|-------------|
| `json` | Pretty-printed JSON (default robot output) |
| `jsonl` | Newline-delimited JSON |
| `compact` | Single-line JSON |
| `sessions` | One `source_path` per line |
| `toon` | Token-Optimized Object Notation — most compact |

---

## Commands

### `cass search <QUERY>`

Full-text, semantic, and hybrid search across indexed conversations.

#### Search Mode

| Flag | Description |
|------|-------------|
| `--mode <MODE>` | `lexical` (default), `semantic`, `hybrid` |
| `--approximate` | Use approximate nearest-neighbor (semantic) |
| `--rerank` | Enable reranking |
| `--reranker <MODEL>` | Reranker model to use |
| `--model <MODEL>` | Embedding model for semantic search |
| `--daemon` / `--no-daemon` | Control semantic model daemon |
| `--two-tier` | Two-tier retrieval strategy |
| `--fast-only` / `--quality-only` | Speed vs. quality tradeoff |

#### Filtering

| Flag | Description |
|------|-------------|
| `--agent <AGENT>` | Filter by agent (repeatable) |
| `--workspace <PATH>` | Filter by workspace (repeatable) |
| `--source <SRC>` | Filter: `local`, `remote`, `all`, or hostname |
| `--sessions-from <FILE>` | Filter to sessions from file; use `-` for stdin |
| `--today` | Limit to today |
| `--yesterday` | Limit to yesterday |
| `--week` | Limit to this week |
| `--days <N>` | Limit to last N days |
| `--since <DATE>` | Results after date |
| `--until <DATE>` | Results before date |

#### Pagination

| Flag | Description |
|------|-------------|
| `--limit <N>` | Max results (default: `0` = no limit) |
| `--offset <N>` | Pagination offset (default: `0`) |
| `--cursor <CURSOR>` | Cursor-based pagination |

#### Output

| Flag | Description |
|------|-------------|
| `--json` / `--robot` | JSON output |
| `--robot-format <FMT>` | `json`, `jsonl`, `compact`, `sessions`, `toon` |
| `--robot-meta` | Include extended metadata |
| `--fields <FIELDS>` | Field selection (see below) |
| `--max-content-length <N>` | Truncate content to N characters |
| `--max-tokens <N>` | Soft token budget |
| `--display <FMT>` | Human-readable: `table`, `lines`, `markdown` |
| `--highlight` | Highlight matching terms |

#### Field Selection (`--fields`)

Presets:

| Preset | Fields included |
|--------|----------------|
| `minimal` | `path`, `line`, `agent` |
| `summary` | `minimal` + `title`, `score` |
| `provenance` | `source_id`, `origin_kind`, `origin_host` |

Individual fields: `score`, `agent`, `workspace`, `workspace_original`, `source_path`, `snippet`, `content`, `title`, `created_at`, `line_number`, `match_type`, `source_id`, `origin_kind`, `origin_host`

#### Analysis

| Flag | Description |
|------|-------------|
| `--aggregate <FIELDS>` | Server-side aggregation by `agent`, `workspace`, `date`, `match_type`; returns buckets with counts (~99% token reduction) |
| `--explain` | Include query explanation |
| `--dry-run` | Validate query without executing |
| `--timeout <MS>` | Timeout in milliseconds |
| `--request-id <ID>` | Correlation ID |

#### JSON Output Fields (per hit)

`source_path`, `line_number`, `agent`, `title`, `score`, `content`, `workspace`, `created_at`, `match_type`, `source_id`, `origin_kind`, `origin_host`

---

### `cass view <PATH>`

View a source file at a specific line with surrounding context.

| Flag | Description |
|------|-------------|
| `-n, --line <LINE>` | Target line number |
| `-C, --context <N>` | Lines of context (default: `5`) |
| `--source <SOURCE>` | Source filter |
| `--json` | JSON output |

---

### `cass expand <PATH>`

Show messages surrounding a specific line.

| Flag | Description |
|------|-------------|
| `-n, --line <LINE>` | Target line number (required) |
| `-C, --context <N>` | Messages of context (default: `3`) |
| `--source <SOURCE>` | Source filter |
| `--json` | JSON output |

---

### `cass context <PATH>`

Find related sessions for a given source path.

| Flag | Description |
|------|-------------|
| `--source` | Source filter |
| `--limit <N>` | Max results (default: `5`) |
| `--json` | JSON output |

---

### `cass sessions`

List recent sessions.

| Flag | Description |
|------|-------------|
| `--workspace <PATH>` | Filter by workspace |
| `--current` | Resolve current workspace and return best match |
| `--limit <N>` | Max results (default: `10`; `1` when `--current` is set) |
| `--json` | JSON output |

---

### `cass timeline`

Show activity timeline grouped by time bucket.

| Flag | Description |
|------|-------------|
| `--since <TIME>` | Start time |
| `--until <TIME>` | End time |
| `--today` | Limit to today |
| `--agent <AGENT>` | Filter by agent (repeatable) |
| `--group-by <hour\|day\|none>` | Grouping granularity (default: `hour`) |
| `--source <SRC>` | Source filter |
| `--json` | JSON output |

---

### `cass stats`

Show index statistics.

| Flag | Description |
|------|-------------|
| `--json` | JSON output |

Returns: total conversations, messages, per-agent counts, workspace stats, date range.

---

### `cass health`

Minimal health check. Completes in under 50ms.

| Flag | Description |
|------|-------------|
| `--json` | JSON output |

Exit codes: `0` = healthy, `1` = unhealthy.

---

### `cass status`

Quick health check with recommendations.

| Flag | Description |
|------|-------------|
| `--json` | JSON output |
| `--stale-threshold <N>` | Staleness threshold in seconds (default: `1800`) |
| `--robot-meta` | Include extended metadata |

---

### `cass analytics <SUBCOMMAND>`

Token, tool, and model analytics.

#### Subcommands

| Subcommand | Description |
|------------|-------------|
| `status` | Row counts, freshness, coverage, drift warnings |
| `tokens` | Token usage over time |
| `tools` | Per-tool invocation counts |
| `models` | Top models by usage |
| `rebuild` | Rebuild rollup tables |
| `validate` | Check invariants, detect drift |

#### Subcommand Options

| Flag | Applies to | Description |
|------|-----------|-------------|
| `--group-by <hour\|day\|week\|month>` | `tokens` | Time grouping |
| `--limit <N>` | `tools` | Max results (default: `20`) |
| `--force` | `rebuild` | Force full rebuild |
| `--fix` | `validate` | Apply safe repairs |

#### Shared Flags

`--since`, `--until`, `--days`, `--agent`, `--workspace`, `--source`, `--json`

---

### `cass export <PATH>`

Export a conversation to a readable format.

| Flag | Description |
|------|-------------|
| `--format <markdown\|text\|json\|html>` | Export format (default: `markdown`) |
| `-o, --output <FILE>` | Output file path |
| `--include-tools` | Include tool calls |
| `--include-skills` | Include skill invocations |
| `--source` | Source filter |

---

### `cass export-html <PATH>`

Export a self-contained HTML file with optional AES-256-GCM encryption.

| Flag | Description |
|------|-------------|
| `--output-dir <DIR>` | Output directory (default: current) |
| `--filename <NAME>` | Custom filename (default: auto-generated) |
| `--encrypt` | Enable password encryption (Web Crypto) |
| `--password <PASS>` | Password for encryption (requires `--encrypt`) |
| `--password-stdin` | Read password from stdin |
| `--include-tools` | Include tool calls (default: true) |
| `--include-skills` | Include skill content (stripped by default) |
| `--show-timestamps` | Show message timestamps |
| `--theme <dark\|light>` | Default theme (default: `dark`) |
| `--no-cdns` | Fully offline (larger file) |
| `--open` | Open in browser after export |
| `--dry-run` | Validate without writing |
| `--json` | JSON output |

---

### `cass index`

Build or update the search index.

| Flag | Description |
|------|-------------|
| `--full` | Full reindex |
| `--semantic` | Build semantic index |
| `--build-hnsw` | Build HNSW index for approximate nearest-neighbor search (requires `--semantic`) |
| `--watch` | Watch for changes and reindex continuously |
| `--json` | JSON output |

---

### `cass doctor`

Diagnose and repair index issues. Safe by default — never deletes user data.

| Flag | Description |
|------|-------------|
| `--fix` | Apply repairs |

---

### `cass import`

Import conversations from external sources.

---

### `cass models <SUBCOMMAND>`

Manage semantic search models.

| Subcommand | Description |
|------------|-------------|
| `status` | Show model installation status |
| `install` | Download and install the semantic search model |
| `verify` | Verify model integrity (SHA256 checksums) |
| `remove` | Remove model files to free disk space |
| `check-update` | Check for model updates |

```bash
cass models status --json   # Show installed models and status
```

---

### `cass sources <SUBCOMMAND>`

Manage remote sources.

| Subcommand | Description |
|------------|-------------|
| `setup` | Interactive wizard to discover and configure remote sources |
| `list` | List configured sources |
| `sync` | Sync sessions from remote sources |
| `discover` | Auto-discover SSH hosts from ~/.ssh/config |
| `add <URL>` | Add a new remote source (e.g. `user@hostname`) |
| `remove` | Remove a configured source |
| `doctor` | Diagnose source connectivity issues |
| `mappings` | Manage path mappings for a source |

---

### `cass introspect`

Full API schema introspection.

| Flag | Description |
|------|-------------|
| `--json` | JSON output |

---

### `cass daemon`

Run the semantic model daemon (Unix only).

---

### `cass capabilities`

Discover supported features, versions, and limits.

| Flag | Description |
|------|-------------|
| `--json` | JSON output |

---

### `cass diag`

Show diagnostic information.

| Flag | Description |
|------|-------------|
| `--json` | JSON output |
| `--verbose` | Verbose diagnostic output |

---

## Supported Connectors

CASS supports 19 connectors:

`claude_code`, `codex`, `gemini`, `cursor`, `opencode`, `cline`, `aider`, `amp`, `chatgpt`, `pi_agent`, `factory`, `vibe`, `clawdbot`, `copilot`, `copilot_cli`, `qwen`, `kimi`, `crush`, `openclaw`

---

## Patterns and Recipes

### Chained Search

Pipe session results from one search into a second search to narrow by session scope:

```bash
cass search "auth" --robot-format sessions | cass search "JWT" --sessions-from - --json
```

### Token Optimization

Minimize output token cost for agent pipelines:

```bash
# Minimal fields + token budget
cass search "query" --fields minimal --max-tokens 500

# Most compact format
cass search "query" --robot-format toon

# Aggregate overview (99% token reduction)
cass search "query" --aggregate agent,date
```

### Time-Bounded Search

```bash
cass search "deploy" --today
cass search "error" --days 7
cass search "migration" --since 2025-01-01 --until 2025-03-31
```

### Semantic Search

```bash
cass search "authentication flow" --mode semantic
cass search "authentication flow" --mode hybrid --rerank
```

### Current Workspace Session

```bash
cass sessions --current   # Returns best matching session for cwd
```
