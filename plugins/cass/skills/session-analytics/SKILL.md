---
name: session-analytics
description: >-
  This skill should be used when the user asks to "analyze my sessions",
  "show coding patterns", "session timeline", "activity summary",
  "how much have I used", "agent usage stats", "session statistics",
  "what agents do I use most", "show my activity", "productivity report",
  "usage dashboard", or wants to understand their coding agent usage patterns,
  activity trends, and session statistics.
version: 0.1.0
---

# Session Analytics

Analyze coding agent session history for usage patterns, activity trends,
and productivity insights. Uses CASS stats, timeline, and search to provide
data-driven analysis of how coding agents are being used.

## Core Commands

### Index Statistics

Get an overview of all indexed data:

```bash
cass stats --json
```

Returns: total conversations, messages, breakdown by agent, workspace stats.

### Timeline Analysis

Visualize activity over time periods:

```bash
# Today's activity by hour
cass timeline --today --json --group-by hour

# Past week by day
cass timeline --since 7d --json --group-by day

# Past month by day
cass timeline --since 30d --json --group-by day

# Specific agent activity
cass timeline --since 30d --agent claude_code --json --group-by day
```

### Health & Freshness

Check index health and coverage:

```bash
cass health --json
```

## Analysis Workflows

### Agent Usage Breakdown

1. Run `cass stats --json` to get per-agent conversation counts.
2. Calculate percentages and identify primary vs. secondary agents.
3. Correlate with project types if workspace data is available.

### Activity Patterns

1. Run `cass timeline --since 30d --json --group-by day` for daily trends.
2. Identify peak days, quiet periods, and patterns.
3. Run `cass timeline --since 7d --json --group-by hour` for hourly patterns.

### Topic Analysis

Search for recurring themes across sessions:

```bash
# Find sessions about specific topics
cass search "debugging" --json --fields summary --limit 20
cass search "refactoring" --json --fields summary --limit 20
cass search "architecture" --json --fields summary --limit 20
```

### Cross-Agent Comparison

Compare how different agents are used:

```bash
# Claude Code sessions
cass search "*" --agent claude_code --json --fields minimal --limit 50

# Codex sessions
cass search "*" --agent codex --json --fields minimal --limit 50
```

## Presenting Results

When presenting analytics, structure the output as:

1. **Summary**: Total sessions, active agents, time range covered.
2. **Agent Distribution**: Which agents are used and how often.
3. **Activity Trends**: Daily/weekly patterns, peak usage periods.
4. **Topic Clusters**: Common themes across sessions.
5. **Recommendations**: Insights based on the data (e.g., underused agents, recurring problems).

## Storing Insights

After generating analytics, invoke the `mcp__memory__remember` MCP tool to store key findings:

- **title**: Session analytics summary (`<date range>`)
- **content**: Key stats, patterns, and insights discovered
- **tags**: `["cass", "session-analytics", "insights"]`
- **category**: `"context"`

Before storing, recall existing memories on the topic to avoid duplicates.

## Additional Resources

### Reference Files

- **`references/command-reference.md`** - Complete CASS CLI reference with all flags and options
