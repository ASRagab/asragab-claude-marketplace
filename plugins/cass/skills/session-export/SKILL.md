---
name: session-export
description: >-
  This skill should be used when the user asks to "export session",
  "save conversation", "share session", "create HTML report",
  "export to markdown", "download session", "archive conversation",
  "export chat history", "create session report",
  or needs to export a coding agent session to markdown, text, JSON, HTML,
  or encrypted HTML format for sharing, archiving, or review.
version: 0.3.0
---

# Session Export

Export coding agent sessions to various formats for sharing, archiving, or review.
Supports markdown, plain text, JSON, HTML, and self-contained encrypted HTML.

## Core Workflow

### 1. Find the Session to Export

Discovery uses token-efficient output (`--robot-format toon --fields summary --max-tokens 1600`); only the actual export step produces verbose content.

```bash
# Current session
cass sessions --current --robot-format toon

# Recent sessions for this project
cass sessions --workspace "$(pwd)" --robot-format toon --limit 10

# Search for a specific session
cass search "<topic>" --robot-format toon --fields summary --max-tokens 1600 --limit 10
```

### 2. Export to Markdown (Default)

```bash
# Basic markdown export to stdout
cass export <session_path>

# Save to file
cass export <session_path> -o conversation.md

# Include tool usage details
cass export <session_path> --include-tools -o conversation.md

# Include skill content
cass export <session_path> --include-tools --include-skills -o conversation.md
```

### 3. Export to Other Formats

```bash
# Plain text
cass export <session_path> --format text -o conversation.txt

# JSON (structured)
cass export <session_path> --format json -o conversation.json

# HTML
cass export <session_path> --format html -o conversation.html
```

### 4. Export to Self-Contained HTML

For beautiful, shareable reports with optional encryption:

```bash
# Self-contained HTML (no external dependencies)
cass export-html <session_path> --filename report.html

# Encrypted HTML (AES-256-GCM) — recipient needs password to view
cass export-html <session_path> --encrypt --password "secret" --filename report.html
```

The HTML export is fully self-contained — CSS, JS, and content are all embedded
in a single file that can be opened in any browser.

## Use Cases

### Share a Session with a Colleague

```bash
# Find the session
cass search "the fix for auth bug" --robot-format toon --fields summary --max-tokens 1600 --limit 5

# Export with full tool details
cass export <session_path> --include-tools --format html -o auth-fix-session.html
```

### Archive a Project's Sessions

```bash
# List all sessions for a project
cass sessions --workspace /path/to/project --robot-format toon --limit 50

# Export each (in a script or one at a time)
cass export <session_path> -o archive/session-001.md
```

### Create a Secure Report

```bash
# Encrypted HTML — safe to share via email or upload
cass export-html <session_path> --encrypt --password "secret" --filename confidential-report.html
```

### Export for Code Review

Include tool usage to see exactly what changes were made:

```bash
cass export <session_path> --include-tools --format markdown -o review.md
```

## Export Formats

| Format | Flag | Best For |
|--------|------|----------|
| Markdown | `--format markdown` (default) | Documentation, README inclusion |
| Text | `--format text` | Simple sharing, grep-friendly |
| JSON | `--format json` | Programmatic processing |
| HTML | `--format html` | Browser viewing |
| Self-contained HTML | `cass export-html` | Sharing, archiving, offline viewing |

## Options

| Flag | Description |
|------|-------------|
| `--format <FMT>` | markdown, text, json, html |
| `-o, --output <FILE>` | Output file (stdout if omitted) |
| `--include-tools` | Include tool use details |
| `--include-skills` | Include skill content (stripped by default for privacy) |
| `--source <SOURCE>` | Source ID for remote sessions |

## Best Practices

- Use `cass sessions --current` to quickly find the active session path.
- Include `--include-tools` when exporting for code review or debugging.
- Use `cass export-html` for self-contained reports that work offline.
- Omit `--include-skills` unless needed — skill content is stripped by default for privacy.
- Use `--format json` when you need to programmatically process the export.

## Additional Resources

- **[Command Reference](../../references/command-reference.md)** - CASS CLI v0.3.x reference (hot-path commands inline; long-tail topics via `cass robot-docs <topic>`)
