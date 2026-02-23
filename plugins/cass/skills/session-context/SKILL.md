---
name: session-context
description: >-
  This skill should be used when the user asks "what do I know about",
  "past context for", "related sessions", "session context for this file",
  "what have I worked on in this project", "find related history",
  "context from past sessions", "catch me up", "what happened while I was gone",
  "bring me up to speed", or needs to pull relevant past session context for
  the current task, file, or project to inform decisions.
version: 0.1.0
---

# Session Context

Load relevant past session context for the current task, file, or project.
Uses CASS to find sessions related to what is being worked on right now,
providing historical awareness across all coding agents.

## Core Workflow

### 1. Find Related Sessions by File

When working on a specific file, find sessions that previously touched it:

```bash
cass context <path-to-current-file> --json --limit 10
```

This returns sessions that referenced the same file, including modifications,
discussions, and debugging sessions.

### 2. Find Related Sessions by Project

Search for sessions within a specific workspace:

```bash
cass search "*" --workspace "$(pwd)" --json --limit 15 --fields summary
```

### 3. Find Related Sessions by Topic

Combine workspace filtering with topical search:

```bash
cass search "<current task description>" --workspace "$(pwd)" --mode hybrid --json --limit 10
```

### 4. Timeline View

See what happened in a project over time:

```bash
# Today's sessions
cass timeline --today --json

# Last 7 days
cass timeline --since 7d --json

# Filter to specific agent
cass timeline --since 7d --agent claude_code --json

# Group by day for overview
cass timeline --since 30d --group-by day --json
```

### 5. Expand Key Sessions

For sessions that look relevant, pull full message context:

```bash
cass expand <source_path> --line <line_number> -C 5 --json
```

### 6. Store Context to Memory

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
# Find related sessions
cass context src/auth/login.ts --json --limit 5

# Search for specific context
cass search "login refactor" --workspace "$(pwd)" --json
```

### Resuming After a Break

Catch up on recent activity in the project:

```bash
# What happened recently?
cass timeline --since 3d --json --group-by day

# Drill into specific sessions
cass expand <path> --line <line> -C 10 --json
```

### Understanding a Decision

Find when and why a decision was made:

```bash
cass search "decided to use <technology>" --workspace "$(pwd)" --mode hybrid --json
```

## Best Practices

- Use `cass context <file>` as the first step when working on any existing file.
- Combine timeline views with targeted searches for comprehensive context.
- Store discovered context to memory to avoid re-searching in future sessions.
- When context spans multiple sessions, synthesize findings before presenting.

## Additional Resources

### Reference Files

- **`references/command-reference.md`** - Complete CASS CLI reference with all flags and options
