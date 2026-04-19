---
name: session-resume
description: >-
  This skill should be used when the user wants to "resume that session",
  "pick up where I left off", "continue the X session", "go back to that
  conversation", "reopen the session about Y", "rejoin", "rerun that chat",
  or otherwise wants a ready-to-run command to relaunch a prior coding agent
  session in its native harness (Claude Code, Codex, OpenCode, pi_agent / pi /
  omp, Gemini). Returns the exact command to paste; does NOT auto-execute.
version: 0.3.0
---

# Session Resume

Resolve any indexed session into a ready-to-run launch command for the session's native harness. Wraps `cass resume <path>` (CLI v0.3.0+).

The skill emits both:

1. **Fenced code block** — for human readability with brief context.
2. **Bare command line** — for direct paste.

Token budget stays under ~600 tokens worst case.

## Discovery (in order)

### A. Explicit path provided

If the user gave a session file path (e.g. from a previous search result), skip discovery and go straight to **Resolve**.

### B. Current workspace (highest-frequency case)

```bash
cass sessions --current --robot-format toon
```

If exactly one session matches, use its `path`. If multiple, present the picker (see below).

### C. Topic-search-then-resume

When the user names a topic ("the auth refactor session", "the one about the migration bug"):

```bash
cass search "<topic>" --workspace . --robot-format toon --fields summary --max-tokens 1600 --limit 5
```

If exactly one hit, use its `source_path`. Otherwise present the picker.

### Picker for multiple candidates

When 2+ candidates remain, present a compact list — one line per candidate — and ask the user to pick:

```
1. claude_code · 2026-04-18 14:35 · Issues applying the latest terraform stack…
2. claude_code · 2026-04-17 09:12 · Auth refactor follow-up — JWT rotation
3. codex       · 2026-04-15 18:02 · Auth refactor — initial scaffolding
```

Do NOT auto-pick.

## Resolve

Once the path is known:

```bash
cass resume <path> --json
```

Returns:

```json
{
  "success": true,
  "agent": "claude",
  "session_id": "845f5d84-…",
  "command": ["claude", "--resume", "845f5d84-…"],
  "shell_command": "claude --resume 845f5d84-…",
  "detection": "path contains .claude/projects",
  "path": "<absolute path>"
}
```

Use `shell_command` for the bare paste line. Use `command[]` argv tokens if wrapping (e.g. SSH).

## Output shape

Present result as:

> **Resume target:** `<agent>` session from `<modified-time>` — *<title-or-fragment>*

```
<shell_command>
```

`<shell_command>`

(Yes, both fenced and bare — fenced for glance, bare for terminal paste.)

## Edge cases

### Session lives on a remote machine

When the session's `source_id` is not `local` (multi-machine setup with `cass sources`), the resume command must run on the host where the session file lives. Detect via the session's `origin_host` and offer an SSH wrapper:

```bash
ssh <origin_host> "<shell_command>"
```

Warn explicitly: *"This session lives on `<host>`. Run on that machine, or use the ssh wrapper above."*

### Cross-agent harness mismatch

If the resolved harness differs from the agent currently running this skill (e.g. user is in Claude Code, the session is a Codex session), state plainly:

> **Note:** This opens a `<resolved-agent>` session in a different harness than your current `<current-agent>` session.

### Resume fails / path missing

When `cass resume` returns non-success or errors, surface the structured error and suggest:

```bash
cass doctor
cass doctor --fix      # if doctor identifies repairable issues
```

If doctor can't help, the underlying session file may have been deleted or moved — re-index with `cass index`.

### Wrong harness auto-detected

If the user reports the resolved harness is wrong (e.g. detected as `pi` but they want `omp`), retry with `--agent` override:

```bash
cass resume <path> --json --agent <override>
```

## `--agent` override values

| Value | Effect |
|-------|--------|
| `claude` / `claude-code` / `claude_code` | Force Claude Code |
| `codex` | Force Codex |
| `opencode` | Force OpenCode |
| `pi_agent` / `pi-agent` | Let path inference pick `pi` vs `omp` |
| `pi` | Force pi-mono binary |
| `omp` / `oh-my-pi` / `ohmypi` | Force Oh My Pi binary |
| `gemini` | Force Gemini CLI |

## Token budget (worst case)

| Step | Approx tokens |
|------|---------------|
| `cass sessions --current --robot-format toon` | ~150 |
| `cass search ... --robot-format toon --fields summary --max-tokens 1600` | ~400 |
| `cass resume <path> --json` | ~200 |
| **Total worst case** | **~600** |

Skill stays cheap. If picker is needed, list lines compress further.

## Related Skills

- **`session-context`** — for "catch me up on this project" (synthesis of past sessions, not a launch command).
- **`session-search`** — for "find that thing about X" (discovery without resume).
- **`session-export`** — for "save this session" (artifact, not relaunch).

## Additional Resources

- **[Command Reference](../../references/command-reference.md)** — `cass resume` row + flag table.
- Live help: `cass resume --help`
- Live machine docs: `cass robot-docs commands`
