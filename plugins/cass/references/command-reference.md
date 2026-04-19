# CASS CLI Command Reference — v0.3.x

This reference inlines the **stable hot-path commands** used by every skill. For long-tail topics (analytics schemas, sources internals, contracts, exit codes, env vars, paths), call the live machine docs:

```bash
cass robot-docs <topic>     # topics: commands, env, paths, schemas, guide,
                            #         exit-codes, examples, contracts, wrap,
                            #         sources, analytics
cass --robot-help           # deterministic wide-format help
cass introspect --json      # full API schema dump
cass api-version --json     # crate / api / contract version triple
cass capabilities --json    # features, connectors, limits
```

---

## New in v0.3.x (vs v0.2.x)

| Command / Flag | Purpose | Skill exposing it |
|----------------|---------|-------------------|
| `cass resume <path>` | Resolve session path → ready-to-run launch command for native harness (Claude Code, Codex, OpenCode, pi_agent, Gemini) | **session-resume** (new) |
| `cass robot-docs <topic>` | Live machine-readable docs (replaces static long-tail content) | (used across skills) |
| `cass api-version` | Crate/API/contract version triple | hooks (version floor) |
| `cass introspect --json` | Full schema dump (commands, args, response shapes) | future skills (deferred) |
| `cass --robot-help` | Deterministic wide-format help fallback | (debug) |
| `cass pages` | Encrypted searchable static archive (P4.x) | future skill (deferred) |
| `cass sources mappings` | Remote source path-mapping management | session-maintenance |
| `cass sources doctor` | SSH/connectivity diagnostics for remote sources | session-maintenance |
| `cass state` | Alias of `cass status` | (compat) |
| `--robot-format toon` | Token-Optimized Object Notation encoding | all skills (default) |
| `--two-tier`, `--fast-only`, `--quality-only`, `--reranker` | Search retrieval tuning | session-search |
| `--approximate` | HNSW ANN semantic search (after `--build-hnsw` indexing) | session-search |
| `--daemon` / `--no-daemon` | Per-call control of semantic model daemon | session-search |
| `--trace-file <PATH>` | JSONL spans for debugging | (debug) |
| NDJSON event stream on `cass index --json` stderr | `started\|phase\|progress\|completed\|error` events | session-maintenance |
| `--progress-interval-ms N` | Tune index event frequency | session-maintenance |

Live release notes: <https://github.com/Dicklesworthstone/coding_agent_session_search/releases>

---

## Token-efficient defaults

Every skill recipe should default to:

```
--robot-format toon --fields summary --max-tokens 1600
```

Or set the encoding once via env:

```bash
export CASS_OUTPUT_FORMAT=toon
```

Hook `session-start-freshness.sh` exports this when CLI ≥ 0.3.0.

Token-size measurement (search "test" --limit 2):

| Recipe | Bytes | Reduction |
|--------|-------|-----------|
| `--json` (default) | 85,445 | baseline |
| `--robot-format toon` (no field cap) | 84,848 | ~1% |
| `--robot-format toon --fields summary --max-tokens 1600` | 756 | ~99% |

Field/budget caps drive the win; TOON encoding adds 1-2% on top.

---

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
| `--robot-format <FMT>` | Output format: `json`, `jsonl`, `compact`, `sessions`, `toon` |
| `--trace-file <PATH>` | Write JSONL trace spans to PATH (debug) |
| `--robot-help` | Deterministic machine-first help (wide, no TUI) |

---

## Output Formats

| Format | Description |
|--------|-------------|
| `json` | Pretty-printed JSON (default robot output) |
| `jsonl` | Newline-delimited JSON |
| `compact` | Single-line JSON |
| `sessions` | One `source_path` per line |
| `toon` | Token-Optimized Object Notation — encoding-efficient (default for plugin) |

---

## Hot-path Commands

### `cass search <QUERY>`

Full-text, semantic, and hybrid search across indexed conversations.

#### Search Mode

| Flag | Description |
|------|-------------|
| `--mode <MODE>` | `lexical` (default), `semantic`, `hybrid` |
| `--approximate` | Use HNSW approximate nearest-neighbor (semantic) |
| `--rerank` | Enable reranking |
| `--reranker <MODEL>` | Reranker model |
| `--model <MODEL>` | Embedding model for semantic search |
| `--daemon` / `--no-daemon` | Control semantic model daemon |
| `--two-tier` | Two-tier retrieval (cheap shortlist + reranked top-K) |
| `--fast-only` / `--quality-only` | Speed vs quality tradeoff |

#### Filtering

| Flag | Description |
|------|-------------|
| `--agent <AGENT>` | Filter by agent (repeatable) |
| `--workspace <PATH>` | Filter by workspace (repeatable) |
| `--source <SRC>` | Filter: `local`, `remote`, or hostname. **Omit the flag entirely to search local + all remotes (no `all` keyword exists).** |
| `--sessions-from <FILE>` | Filter to sessions from file; `-` for stdin |
| `--today` / `--yesterday` / `--week` / `--days <N>` | Time scopes |
| `--since <DATE>` / `--until <DATE>` | Date range |

#### Pagination

| Flag | Description |
|------|-------------|
| `--limit <N>` | Max results (default: `0` = no limit) |
| `--offset <N>` | Pagination offset |
| `--cursor <CURSOR>` | Cursor-based pagination (preferred for large pages) |

#### Output (token control)

| Flag | Description |
|------|-------------|
| `--robot-format <FMT>` | Encoding (`toon` recommended) |
| `--robot` / `--json` | Force structured output |
| `--robot-meta` | Include `_meta` (cursor, freshness, timing) |
| `--fields <FIELDS>` | Field selection (presets: `minimal`, `summary`, `provenance`) |
| `--max-content-length <N>` | Truncate snippet/title/content to N chars |
| `--max-tokens <N>` | Soft token budget (default for plugin: `1600`) |
| `--display <FMT>` | Human format: `table`, `lines`, `markdown` |
| `--highlight` | Highlight matching terms |

#### Field presets

| Preset | Fields |
|--------|--------|
| `minimal` | `path`, `line`, `agent` |
| `summary` | `minimal` + `title`, `score` |
| `provenance` | `source_id`, `origin_kind`, `origin_host` |

Individual: `score`, `agent`, `workspace`, `workspace_original`, `source_path`, `snippet`, `content`, `title`, `created_at`, `line_number`, `match_type`, `source_id`, `origin_kind`, `origin_host`

#### Aggregation (overview, ~99% token reduction)

| Flag | Description |
|------|-------------|
| `--aggregate <FIELDS>` | Server-side counts by `agent`, `workspace`, `date`, `match_type` |
| `--explain` | Include query explanation |
| `--dry-run` | Validate query without executing |
| `--timeout <MS>` | Timeout in milliseconds |
| `--request-id <ID>` | Correlation ID |

---

### `cass sessions`

| Flag | Description |
|------|-------------|
| `--workspace <PATH>` | Filter by workspace |
| `--current` | Resolve current workspace and return best match |
| `--limit <N>` | Max results (default: `10`; `1` when `--current`) |
| `--json` / `--robot-format <FMT>` | Structured output |

---

### `cass view <PATH>`

| Flag | Description |
|------|-------------|
| `-n, --line <LINE>` | Target line |
| `-C, --context <N>` | Lines of context (default: `5`) |
| `--source <SOURCE>` | Source filter |
| `--json` | JSON output |

---

### `cass expand <PATH>`

| Flag | Description |
|------|-------------|
| `-n, --line <LINE>` | Target line (required) |
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

### `cass timeline`

| Flag | Description |
|------|-------------|
| `--since <TIME>` / `--until <TIME>` | Range |
| `--today` | Limit to today |
| `--agent <AGENT>` | Filter by agent (repeatable) |
| `--group-by <hour\|day\|none>` | Granularity (default: `hour`) |
| `--source <SRC>` | Source filter |
| `--json` | JSON output |

---

### `cass stats`

Returns: total conversations, messages, per-agent counts, top workspaces, date range. Single `--json` flag.

---

### `cass health`

Pre-flight check (<50ms). Exit `0` healthy, `1` unhealthy. Single `--json` flag.

---

### `cass status` (alias `cass state`)

| Flag | Description |
|------|-------------|
| `--json` | JSON output |
| `--stale-threshold <N>` | Staleness threshold in seconds (default: `1800`) |
| `--robot-meta` | Extended metadata |

Returns `recommended_action` when unhealthy. Skills should surface this verbatim.

---

### `cass index`

| Flag | Description |
|------|-------------|
| `--full` | Full reindex |
| `--semantic` | Build semantic index |
| `--build-hnsw` | Build HNSW for ANN (requires `--semantic`; recommended when conversations > ~10k) |
| `--watch` | Watch for changes and reindex continuously |
| `--json` | NDJSON event stream on stderr (`started\|phase\|progress\|completed\|error`) |
| `--progress-interval-ms <N>` | Event interval (250-60000, default 2000) |
| `--no-progress-events` | Suppress NDJSON events |

---

### `cass doctor`

Diagnose and repair index issues. Safe by default — never deletes user data.

| Flag | Description |
|------|-------------|
| `--fix` | Apply repairs (rebuilds derived data only) |

---

### `cass resume <PATH>` ★ NEW v0.3.0

Resolve a session file path into a ready-to-run resume command for the session's native harness.

| Flag | Description |
|------|-------------|
| `--agent <AGENT>` | Override detected harness: `claude` / `claude-code` / `claude_code`, `codex`, `opencode`, `pi_agent` / `pi` / `omp` / `oh-my-pi` / `ohmypi`, `gemini` |
| `--exec` | Replace current process with resume command (mutually exclusive with `--shell` / `--json`) |
| `--shell` | Emit single shell-escaped command line (suitable for `eval "$(cass resume ...)"`) |
| `--json` / `--robot` | Structured output: `{ agent, session_id, command[], shell_command, detection, path }` |

---

### `cass export <PATH>`

| Flag | Description |
|------|-------------|
| `--format <markdown\|text\|json\|html>` | Export format (default: `markdown`) |
| `-o, --output <FILE>` | Output file |
| `--include-tools` | Include tool calls |
| `--include-skills` | Include skill invocations |
| `--source` | Source filter |

### `cass export-html <PATH>`

Self-contained HTML with optional AES-256-GCM encryption. See `cass export-html --help` for full flag list.

---

## Long-tail topics (live docs)

```bash
cass robot-docs analytics    # cass analytics * subcommands, schemas, exit codes
cass robot-docs sources      # cass sources setup wizard + flags
cass robot-docs schemas      # full response schema reference
cass robot-docs contracts    # stdout/stderr contract, color, JSON-error policy
cass robot-docs exit-codes   # all exit codes with meanings
cass robot-docs env          # environment variables (CASS_*, TOON_*)
cass robot-docs paths        # default data dir / db path / log path
cass robot-docs guide        # robot-mode handbook
cass robot-docs examples     # canonical command examples
cass robot-docs commands     # full command catalog
```

---

## Supported connectors (19)

`claude_code`, `codex`, `gemini`, `cursor`, `opencode`, `cline`, `aider`, `amp`, `chatgpt`, `pi_agent`, `factory`, `vibe`, `clawdbot`, `copilot`, `copilot_cli`, `qwen`, `kimi`, `crush`, `openclaw`

(Verify current set with `cass capabilities --json | jq .connectors`)

---

## Recipe quickref

### Token-budget search (default)

```bash
cass search "<query>" --robot-format toon --fields summary --max-tokens 1600 --limit 10
```

### Aggregate-first overview (~99% token reduction)

```bash
# --limit 1 + --max-content-length suppress the hit-list dump --aggregate
# emits by default. --fields cannot combine with --aggregate.
cass search "<query>" --aggregate agent,date --limit 1 --max-content-length 100 --robot-format toon
```

### Chained search (narrow scope)

```bash
cass search "auth" --robot-format sessions | cass search "JWT" --sessions-from - --robot-format toon --fields summary --max-tokens 1600
```

### Time-bounded

```bash
cass search "deploy" --today --robot-format toon --fields summary --max-tokens 1600
cass search "error" --days 7 --robot-format toon --fields summary --max-tokens 1600
```

### Semantic / hybrid

```bash
cass search "authentication flow" --mode semantic --approximate --daemon --robot-format toon --fields summary
cass search "authentication flow" --mode hybrid --rerank --quality-only --robot-format toon --fields summary --max-tokens 1600
```

### Current-workspace session

```bash
cass sessions --current --robot-format toon
```

### Resume current-workspace session

```bash
cass resume "$(cass sessions --current --json | jq -r '.sessions[0].path')" --json
```
