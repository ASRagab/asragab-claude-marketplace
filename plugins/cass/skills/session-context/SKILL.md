---
name: session-context
description: >-
  This skill should be used when the user asks "what do I know about",
  "past context for", "related sessions", "session context for this file",
  "what have I worked on in this project", "find related history",
  "context from past sessions", "catch me up", "what happened while I was gone",
  "bring me up to speed", "current session info", "list recent sessions",
  or needs to pull relevant past session context for the current task,
  file, or project to inform decisions.
version: 0.3.0
---

# Session Context

Load relevant past session context for the current task, file, or project.
Uses CASS to find sessions related to what is being worked on right now,
providing historical awareness across all coding agents.

## Token-efficient defaults

Recipes default to `--robot-format toon` and `--fields summary --max-tokens 1600` for any search. The SessionStart hook also exports `CASS_OUTPUT_FORMAT=toon` so the encoding flag is inherited; per-call flags are kept for portability.

## Core Workflow

### 1. Find the Current Session

```bash
cass sessions --current --robot-format toon
```

### 2. List Recent Sessions

```bash
# Sessions for current workspace
cass sessions --workspace "$(pwd)" --robot-format toon --limit 10

# All recent sessions
cass sessions --robot-format toon --limit 15
```

### 3. Find Related Sessions by File

When working on a specific file, find sessions that previously touched it:

```bash
cass context <path-to-session-file> --json --limit 10
```

This returns sessions that referenced the same file, including modifications,
discussions, and debugging sessions.

### 4. Find Related Sessions by Topic

```bash
# Hybrid search within current project
cass search "<current task description>" --workspace "$(pwd)" --mode hybrid --robot-format toon --fields summary --max-tokens 1600 --limit 10

# With time scope
cass search "<topic>" --workspace "$(pwd)" --days 30 --robot-format toon --fields summary --max-tokens 1600 --limit 10

# Across all sources (multi-machine) — omit --source to scan local + every configured remote
cass search "<topic>" --robot-format toon --fields summary --max-tokens 1600 --limit 10

# Scope to remotes only (use the literal "remote" keyword) or to a specific hostname
cass search "<topic>" --source remote --robot-format toon --fields summary --max-tokens 1600 --limit 10
cass search "<topic>" --source <hostname> --robot-format toon --fields summary --max-tokens 1600 --limit 10
```

### 5. Timeline View

See what happened in a project over time:

```bash
# Today's sessions
cass timeline --today --json

# Last 7 days by day
cass timeline --since 7d --json --group-by day

# Last 30 days overview
cass timeline --since 30d --json --group-by day

# Specific agent activity
cass timeline --since 7d --agent claude_code --json
```

### 6. Quick Overview via Aggregation

Get a fast summary without loading full results:

```bash
# Activity by agent (last 7 days). --limit 1 + --max-content-length suppress
# the hit-list dump that --aggregate emits by default. --fields cannot combine
# with --aggregate.
cass search "*" --aggregate agent --week --limit 1 --max-content-length 100 --robot-format toon

# Activity by workspace
cass search "*" --aggregate workspace --days 30 --limit 1 --max-content-length 100 --robot-format toon
```

### 7. Expand Key Sessions

For sessions that look relevant, pull full message context:

```bash
cass expand <source_path> --line <line_number> -C 5 --json
```

### 8. Store Context to Memory

After loading relevant context, invoke the `mcp__memory__remember` MCP tool to store key findings:

- **title**: Context summary for `<file/project>`
- **content**: Key decisions, patterns, or history discovered
- **tags**: `["cass", "session-context", <project-name>]`
- **category**: `"context"`

Before storing, recall existing memories on the topic to avoid duplicates.

## Use Cases

### Starting Work on a File

Before modifying a file, check what past sessions involved it:

```bash
# Find the current session
cass sessions --current --json

# Search for related work
cass search "login refactor" --workspace "$(pwd)" --json
```

### Resuming After a Break

Catch up on recent activity in the project:

```bash
# What happened recently?
cass timeline --since 3d --json --group-by day

# Quick agent breakdown
cass search "*" --aggregate agent --days 3 --limit 1 --max-content-length 100 --robot-format toon

# Drill into specific sessions
cass expand <path> --line <line> -C 10 --json
```

### Understanding a Decision

Find when and why a decision was made:

```bash
cass search "decided to use <technology>" --workspace "$(pwd)" --mode hybrid --json
```

### Multi-Machine Context

Pull context from remote sources:

```bash
# Search across all machines (omit --source for full union of local + remotes)
cass search "deployment script" --robot-format toon --fields summary --max-tokens 1600

# Or scope to remotes only
cass search "deployment script" --source remote --robot-format toon --fields summary --max-tokens 1600

# Search specific remote
cass search "config" --source work-laptop --json
```

## Best Practices

- Use `cass sessions --current` as a starting point for current workspace context.
- Combine timeline views with targeted searches for comprehensive context.
- Use `--aggregate` for quick overviews before drilling into specifics.
- Default flags: `--robot-format toon --fields summary --max-tokens 1600`.
- Use time filters (`--days`, `--since`) to scope context to relevant periods.
- Store discovered context to memory to avoid re-searching in future sessions.
- When context spans multiple sessions, synthesize findings before presenting.

## Related Skills

- **`session-resume`** — when the goal is "pick up where I left off" (returns a runnable command rather than a synthesis). Hand off here once the right session is identified.

## Additional Resources

- **[Command Reference](../../references/command-reference.md)** - CASS CLI v0.3.x reference (hot-path commands inline; long-tail topics via `cass robot-docs <topic>`)
