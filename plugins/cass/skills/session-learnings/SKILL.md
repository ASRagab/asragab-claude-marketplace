---
name: session-learnings
description: >-
  This skill should be used when the user asks about "lessons learned",
  "past mistakes with", "synthesize learnings", "what went wrong with",
  "recurring issues", "patterns from history", "extract knowledge from sessions",
  "self-improvement from past", "what keeps failing", "common errors",
  or wants to extract patterns, recurring issues, and actionable lessons
  from past coding agent sessions for self-improvement.
version: 0.1.0
---

# Session Learnings

Extract patterns, recurring issues, and actionable lessons from past coding
agent sessions. Synthesize knowledge from history across all agents to drive
self-improvement and avoid repeating mistakes.

## Core Workflow

### 1. Identify a Topic

Start with a specific area to analyze:

```bash
# Search for errors and failures
cass search "error fix bug" --mode hybrid --json --limit 20 --fields summary

# Search for specific problem domains
cass search "<topic> problem issue" --mode hybrid --json --limit 15
```

### 2. Gather Evidence

Expand relevant sessions to understand the full context:

```bash
# Get full context around a finding
cass expand <source_path> --line <line_number> -C 10 --json

# Find related sessions
cass context <source_path> --json --limit 5
```

### 3. Synthesize Patterns

After gathering evidence from multiple sessions, identify:

- **Recurring errors**: Same mistake appearing across sessions.
- **Successful patterns**: Approaches that consistently worked.
- **Evolution**: How solutions improved over time.
- **Anti-patterns**: Approaches that were tried and abandoned.

### 4. Store Learnings

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
# Search for error-related sessions
cass search "error failed exception crash" --mode hybrid --json --limit 20

# Search for specific error types
cass search "TypeError undefined null" --json --limit 10
cass search "authentication expired token" --json --limit 10
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
# Same topic, different agents
cass search "<topic>" --agent claude_code --json --limit 5
cass search "<topic>" --agent codex --json --limit 5
cass search "<topic>" --agent gemini --json --limit 5
```

Extract:
- Which agent performed best for which task type
- Complementary strengths across agents

## Output Structure

When presenting learnings, structure as:

1. **Finding**: What was discovered.
2. **Evidence**: Session references (paths, agents, dates).
3. **Pattern**: The recurring behavior or issue.
4. **Lesson**: Actionable takeaway.
5. **Stored**: Confirmation that the learning was saved to memory.

## Best Practices

- Mine errors first — they contain the highest-value lessons.
- Use hybrid search mode for conceptual queries about patterns.
- Always expand sessions to get full context before synthesizing.
- Store every distinct learning to memory individually, not as bulk summaries.
- Tag learnings with specific topics for future recall.
- Cross-reference with existing memories to avoid storing duplicates.

## Additional Resources

### Reference Files

- **`references/command-reference.md`** - Complete CASS CLI reference with all flags and options
