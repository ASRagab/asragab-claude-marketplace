---
name: session-learnings
description: >-
  This skill should be used when the user asks about "lessons learned",
  "past mistakes with", "synthesize learnings", "what went wrong with",
  "recurring issues", "patterns from history", "extract knowledge from sessions",
  "self-improvement from past", "what keeps failing", "common errors",
  "tool usage patterns", "which agent is best for",
  or wants to extract patterns, recurring issues, and actionable lessons
  from past coding agent sessions for self-improvement.
version: 0.3.0
---

# Session Learnings

Extract patterns, recurring issues, and actionable lessons from past coding
agent sessions. Synthesize knowledge from history across all agents to drive
self-improvement and avoid repeating mistakes.

## Token-efficient defaults

Recipes default to `--robot-format toon --fields summary --max-tokens 1600`.

## Core Workflow

### 1. Identify a Topic

```bash
# Errors and failures
cass search "error fix bug" --mode hybrid --robot-format toon --fields summary --max-tokens 1600 --limit 20

# Specific problem domain
cass search "<topic> problem issue" --mode hybrid --robot-format toon --fields summary --max-tokens 1600 --limit 15

# Time-scoped
cass search "error" --days 30 --robot-format toon --fields summary --max-tokens 1600 --limit 20
```

### 2. Quick Pattern Scan via Aggregation

Before diving into individual sessions, get an overview:

```bash
# Error distribution by agent (overview only — --limit 1 + --max-content-length
# suppress the hit-list dump --aggregate emits by default)
cass search "error fix bug" --aggregate agent --days 30 --limit 1 --max-content-length 100 --robot-format toon

# Error distribution over time
cass search "error" --aggregate date --days 30 --limit 1 --max-content-length 100 --robot-format toon

# Topic frequency by workspace
cass search "<topic>" --aggregate workspace --limit 1 --max-content-length 100 --robot-format toon
```

### 3. Tool Usage Analysis

Identify which tools are used most and their efficiency:

```bash
# Top tools by usage
cass analytics tools --limit 20 --json

# Tools for a specific agent
cass analytics tools --agent claude_code --limit 10 --json

# Recent tool patterns
cass analytics tools --days 7 --json
```

### 4. Gather Evidence

Expand relevant sessions to understand the full context:

```bash
# Get full context around a finding
cass expand <source_path> --line <line_number> -C 10 --json

# Find related sessions
cass context <source_path> --json --limit 5
```

### 5. Synthesize Patterns

After gathering evidence from multiple sessions, identify:

- **Recurring errors**: Same mistake appearing across sessions.
- **Successful patterns**: Approaches that consistently worked.
- **Evolution**: How solutions improved over time.
- **Anti-patterns**: Approaches that were tried and abandoned.
- **Tool efficiency**: Which tools deliver results vs. waste tokens.

### 6. Store Learnings

Invoke the `mcp__memory__remember` MCP tool to store each synthesized learning individually:

- **title**: Concise lesson title
- **content**: What happened, why, what to do instead
- **tags**: `["cass", "session-learnings", "<topic>"]`
- **category**: `"learning"` (for insights), `"error"` (for bug patterns), or `"pattern"` (for reusable approaches)
- **importance**: `"high"` (for recurring issues) or `"normal"`

Before storing, recall existing memories on the topic to avoid duplicates.

## Analysis Strategies

### Error Pattern Mining

Find recurring errors and their resolutions:

```bash
# Aggregate errors by agent — find where problems concentrate.
# --limit 1 + --max-content-length 100 keeps overview compact.
# (--fields cannot be combined with --aggregate.)
cass search "error failed exception crash" --aggregate agent --days 30 --limit 1 --max-content-length 100 --robot-format toon

# Drill into specific agents
cass search "error failed" --agent claude_code --mode hybrid --robot-format toon --fields summary --max-tokens 1600 --limit 20

# Specific error types
cass search "TypeError undefined null" --robot-format toon --fields summary --max-tokens 1600 --limit 10
cass search "authentication expired token" --robot-format toon --fields summary --max-tokens 1600 --limit 10
```

For each cluster of similar errors, extract:
- Root cause pattern
- Resolution that worked
- Prevention strategy

### Decision Archaeology

Find past architectural and design decisions:

```bash
cass search "decided chose selected approach" --mode hybrid --json --limit 15
cass search "tradeoff comparison versus" --mode hybrid --json --limit 15
```

Extract:
- What was decided and why
- What alternatives were rejected
- Whether the decision held up over time

### Tool & Library Patterns

Find patterns in tool and library usage:

```bash
cass search "<library-name> setup configure" --json --limit 10
cass search "<tool-name> issue workaround" --json --limit 10
```

Extract:
- Common setup gotchas
- Workarounds that became standard
- Libraries that were swapped out and why

### Cross-Agent Learning

Compare how different agents handled similar problems:

```bash
# Aggregate by agent for a topic
cass search "<topic>" --aggregate agent --limit 1 --max-content-length 100 --robot-format toon

# Then drill into specific agents
cass search "<topic>" --agent claude_code --json --limit 5
cass search "<topic>" --agent codex --json --limit 5
cass search "<topic>" --agent gemini --json --limit 5

# Compare model usage across agents
cass analytics models --json
```

Extract:
- Which agent performed best for which task type
- Complementary strengths across agents

### Token Efficiency Analysis

Understand token consumption patterns:

```bash
# Token usage trends
cass analytics tokens --days 30 --group-by day --json

# Which tools consume the most tokens
cass analytics tools --limit 10 --json
```

Extract:
- High-token-cost operations to optimize
- Efficient vs. wasteful patterns

## Output Structure

When presenting learnings, structure as:

1. **Finding**: What was discovered.
2. **Evidence**: Session references (paths, agents, dates).
3. **Pattern**: The recurring behavior or issue.
4. **Lesson**: Actionable takeaway.
5. **Stored**: Confirmation that the learning was saved to memory.

## Best Practices

- Mine errors first — they contain the highest-value lessons.
- Use `--aggregate` for fast pattern scanning before reading individual sessions.
- Use `cass analytics tools` to identify tool-related patterns.
- Use hybrid search mode for conceptual queries about patterns.
- Always expand sessions to get full context before synthesizing.
- Store every distinct learning to memory individually, not as bulk summaries.
- Tag learnings with specific topics for future recall.
- Cross-reference with existing memories to avoid storing duplicates.

## Additional Resources

- **[Command Reference](../../references/command-reference.md)** - CASS CLI v0.3.x reference (hot-path commands inline; long-tail topics via `cass robot-docs <topic>`)
