---
name: session-analytics
description: >-
  This skill should be used when the user asks to "analyze my sessions",
  "show coding patterns", "session timeline", "activity summary",
  "how much have I used", "agent usage stats", "session statistics",
  "what agents do I use most", "show my activity", "productivity report",
  "usage dashboard", "token usage", "tool usage stats", "model usage",
  "cost analysis", "analytics health",
  or wants to understand their coding agent usage patterns,
  activity trends, token consumption, and session statistics.
version: 0.3.0
---

# Session Analytics

Analyze coding agent session history for usage patterns, activity trends,
token consumption, and productivity insights. Uses the CASS analytics engine
for deep analysis across all indexed coding agents.

## Analytics Engine

CASS v0.3.x includes a dedicated analytics subsystem with six subcommands.
All share common flags: `--since`, `--until`, `--days`, `--agent`, `--workspace`, `--source`, `--json`.

The `--source` filter accepts `local`, `remote`, or a hostname (use `cass sources list` to see configured names).

All JSON responses use an envelope: `{ "command": "analytics/<sub>", "data": {...}, "_meta": {...} }`. Response schemas are documented under `cass robot-docs analytics`.

### Retry guidance

Analytics commands may return exit code `9` with `retryable=true` for transient SQLite lock contention. Wait 1 second and retry. Persistent exit `9` means a real database issue — run `cass doctor --fix`.

### Analytics Health

Check analytics data coverage and integrity:

```bash
cass analytics status --json
```

Key fields in response:
- `data.tables` - Row counts and freshness per rollup table
- `data.coverage` - Total messages, API token coverage %, estimate-only %
- `data.drift` - Signals of data inconsistency
- `data.recommended_action` - What to do next

### Token Usage

Analyze token consumption over time:

```bash
# Last 7 days by day
cass analytics tokens --days 7 --group-by day --json

# Last month by week
cass analytics tokens --days 30 --group-by week --json

# By hour for today
cass analytics tokens --days 1 --group-by hour --json

# Filtered to specific agent
cass analytics tokens --days 7 --agent claude_code --json
```

Response includes per-bucket:
- `counts` - message_count, user/assistant counts, tool_call_count
- `api_tokens` - total, input, output, cache_read, cache_creation, thinking
- `derived` - api_coverage_pct, avg_api_per_message, avg_content_per_message

### Tool Usage

Identify most-used tools and their efficiency:

```bash
# Top 20 tools
cass analytics tools --limit 20 --json

# Top tools for a specific agent
cass analytics tools --agent claude_code --limit 10 --json

# Tools used in last 7 days
cass analytics tools --days 7 --json
```

Response fields per row: tool name, tool_call_count, message_count, api_tokens_total,
tool_calls_per_1k_api_tokens, tool_calls_per_1k_content_tokens.

### Model Usage

See which models are being used:

```bash
cass analytics models --json

# Models used by specific agent
cass analytics models --agent claude_code --json
```

Available for connectors that report model names (claude_code, codex, pi_agent, factory, opencode, cursor).

### Data Repair

Rebuild or validate analytics data:

```bash
# Validate data integrity
cass analytics validate --json

# Auto-fix safe issues
cass analytics validate --fix --json

# Force rebuild all rollup tables
cass analytics rebuild --force --json
```

## Supplementary Commands

### Index Statistics

Quick overview of indexed data:

```bash
cass stats --json
```

Returns: total conversations, messages, per-agent breakdown, top workspaces, date range.

### Timeline Analysis

Visualize activity over time:

```bash
# Today's activity by hour
cass timeline --today --json --group-by hour

# Past week by day
cass timeline --since 7d --json --group-by day

# Past month by day
cass timeline --since 30d --json --group-by day
```

### Aggregation Queries

Fast counts via search aggregation (~99% token reduction):

```bash
# Sessions by agent (overview only — --limit 1 + --max-content-length suppress hit dump)
cass search "*" --aggregate agent --limit 1 --max-content-length 100 --robot-format toon

# Sessions by agent + workspace
cass search "*" --aggregate agent,workspace --days 30 --limit 1 --max-content-length 100 --robot-format toon

# Error distribution by agent
cass search "error" --aggregate agent --week --limit 1 --max-content-length 100 --robot-format toon
```

**Aggregate quirk:** `--aggregate` returns hits AND aggregations. Default unlimited hit list balloons output. Always pass `--limit 1` for true overview. `--fields` cannot combine with `--aggregate` (returns nothing); use `--max-content-length` instead.

## Analysis Workflows

### Quick Health Check

```bash
cass analytics status --json
cass health --json
```

### Weekly Report

1. `cass analytics tokens --days 7 --group-by day --json` - daily token consumption
2. `cass analytics tools --days 7 --limit 10 --json` - top tools used
3. `cass search "*" --aggregate agent --week --limit 1 --max-content-length 100 --robot-format toon` - agent distribution
4. `cass timeline --since 7d --json --group-by day` - activity timeline

### Agent Comparison

```bash
# Token usage by agent
cass analytics tokens --days 30 --agent claude_code --json
cass analytics tokens --days 30 --agent codex --json

# Tool usage by agent
cass analytics tools --agent claude_code --limit 10 --json
cass analytics tools --agent codex --limit 10 --json
```

### Coverage & Uncertainty

- `api_token_coverage_pct`: % of messages with API token data (from Claude, Codex)
- `estimate_only_pct`: % using content-estimated tokens (chars/4 heuristic)
- When coverage is low, derived metrics are estimates, not ground truth
- Content token estimates are always available; API tokens are sparse

## Presenting Results

Structure analytics output as:

1. **Summary**: Total sessions, active agents, time range, data coverage %
2. **Token Consumption**: Daily/weekly trends, total input/output/cache
3. **Agent Distribution**: Which agents used and how often
4. **Tool Patterns**: Most-used tools, efficiency metrics
5. **Model Usage**: Which models, where available
6. **Recommendations**: Insights based on the data

## Additional Resources

- **[Command Reference](../../references/command-reference.md)** - CASS CLI v0.3.x reference (hot-path commands inline; long-tail topics via `cass robot-docs <topic>`)
