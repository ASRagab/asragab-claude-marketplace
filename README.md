# asragab-claude-marketplace

A Claude Code plugin marketplace containing plugins for session search/analytics, skill evaluation, Claude Code mod development, and a PR picker mod.

## Plugins

| Plugin | Version | Description |
|--------|---------|-------------|
| [cass](#cass) | 0.3.0 | Cross-agent session search, context, analytics, export, learnings, and **session resume** powered by CASS CLI |
| [skill-eval](#skill-eval) | 1.0.0 | Automated skill/prompt/tool evaluation and improvement via session log analysis and autoresearch optimization |
| [mod-forge](#mod-forge) | 0.1.0 | Build and verify Claude Code mods in isolated child processes, never in the live session (Claude Code 2.1.287+) |
| [pr-pane](#pr-pane) | 0.2.0 | `/prs` toggles a band above the prompt with your open GitHub PRs and review state; arrows and Enter open one in the browser (Claude Code 2.1.287+, needs `gh`) |

## Installation

### 1. Add the marketplace

```bash
claude plugin marketplace add https://github.com/ASRagab/asragab-claude-marketplace
```

### 2. Install plugins

```bash
# Install by name (use plugin@marketplace to disambiguate)
claude plugin install cass
claude plugin install skill-eval
claude plugin install mod-forge
claude plugin install pr-pane
```

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- [Bun runtime](https://bun.sh) (required by skill-eval scripts)
  - To run `bun run test`, first run `bun install` in `plugins/skill-eval/scripts` (installs `@anthropic-ai/sdk`).
- [GitHub CLI](https://cli.github.com) (`gh`), logged in with `gh auth login` (required by pr-pane)
- [CASS CLI](https://github.com/Dicklesworthstone/coding_agent_session_search) v0.3.0+ (required by cass plugin)

---

## cass

Cross-agent session search, context loading, token analytics, session export, **session resume**, and learning synthesis powered by [CASS](https://github.com/Dicklesworthstone/coding_agent_session_search) (Coding Agent Session Search). Searches across Claude Code, Codex, Cursor, Gemini CLI, Copilot, and 14+ other agents.

Recipes default to token-efficient output (`--robot-format toon --fields summary --max-tokens 1600`). The plugin's SessionStart hook surfaces the CASS index health, recommended next action, and a `CASS_OUTPUT_FORMAT=toon` advisory.

### Skills

#### `/cass:session-search`

Search across all indexed coding agent sessions. Supports lexical (BM25), semantic (vector), and hybrid search modes.

```bash
cass search "authentication flow" --mode hybrid --robot-format toon --fields summary --max-tokens 1600 --limit 10
cass search "error" --days 30 --aggregate agent --limit 1 --max-content-length 100 --robot-format toon
```

#### `/cass:session-context`

Load relevant past session context for the current task, file, or project.

```bash
cass sessions --current --robot-format toon
cass timeline --since 7d --json --group-by day
```

#### `/cass:session-analytics`

Analyze session history for usage patterns, token consumption, and tool efficiency.

```bash
cass analytics tokens --days 7 --group-by day --json
cass analytics tools --limit 20 --json
```

#### `/cass:session-export`

Export sessions to markdown, text, JSON, HTML, or self-contained encrypted HTML.

```bash
cass export <session_path> -o conversation.md
cass export-html <session_path> --encrypt --password "secret" --filename report.html
```

#### `/cass:session-learnings`

Extract patterns, recurring issues, and actionable lessons from past sessions.

```bash
cass search "error fix bug" --mode hybrid --robot-format toon --fields summary --max-tokens 1600 --limit 20
cass analytics tools --limit 20 --json
```

#### `/cass:session-resume` ★ NEW v0.3.0

Resolve a session into a ready-to-run launch command for its native harness (Claude Code, Codex, OpenCode, pi_agent, Gemini). Triggered by phrases like "resume that session", "pick up where I left off", "continue the X session".

```bash
cass resume "$(cass sessions --current --json | jq -r '.sessions[0].path')" --json
```

#### `/cass:session-maintenance`

Diagnose, repair, and maintain CASS installation, index, analytics, and remote sources.

```bash
cass health --json
cass doctor --fix
cass index --full --json
```

---

## skill-eval

A four-stage pipeline for identifying friction in coding agent sessions and iteratively optimizing skills, prompts, and tools. Inspired by Karpathy's autoresearch pattern.

### Skills

The stages run sequentially — each consumes the output of the previous stage.

#### `/skill-eval:transcript-extract` (M1)

Extract structured events from Claude Code session transcripts into JSONL.

```bash
bun scripts/transcript-extract.ts --since 7d -o events.jsonl
```

#### `/skill-eval:signal-classify` (M2)

Classify extracted events into friction, success, noise, and neutral categories using rule-based heuristics. No LLM calls required.

```bash
bun scripts/signal-classify.ts -i events.jsonl -o classified.jsonl
bun scripts/signal-classify.ts -i events.jsonl --stats
```

#### `/skill-eval:target-identify` (M3)

Use LLM-as-judge to rank friction clusters by frequency, severity, and improvability.

```bash
bun scripts/target-identify.ts -i classified.jsonl --top 5 -o targets.jsonl
```

Requires `ANTHROPIC_API_KEY` environment variable.

#### `/skill-eval:autoresearch-loop` (M4)

Iteratively generate and evaluate improvements against a target's eval criteria.

```bash
bun scripts/autoresearch-loop.ts -t targets.jsonl --max-rounds 20
```

Requires `ANTHROPIC_API_KEY` environment variable.

### Full Pipeline Example

```bash
cd plugins/skill-eval

# 1. Extract events from recent sessions
bun scripts/transcript-extract.ts --since 7d -o events.jsonl

# 2. Classify friction signals
bun scripts/signal-classify.ts -i events.jsonl -o classified.jsonl

# 3. Identify top optimization targets
bun scripts/target-identify.ts -i classified.jsonl --top 5 -o targets.jsonl

# 4. Run autoresearch loop on the top target
bun scripts/autoresearch-loop.ts -t targets.jsonl --max-rounds 10
```

---

## mod-forge

Build and verify Claude Code mods without touching the session you are working in. **Claude Code only**, version 2.1.287 or later.

The `build-claude-mod` skill sends an agent through `scripts/run-mod.sh`, which runs a mod through four fail-fast stages (`validate`, `test`, `headless`, `interactive`) in separate processes under a harness-owned `CLAUDE_CONFIG_DIR`. See [plugins/mod-forge/README.md](plugins/mod-forge/README.md) for stages, evidence files, and exit codes.

Requires `jq`. Live stages also need `ANTHROPIC_API_KEY`, and the interactive stage needs `tmux`.

```bash
# Offline test: no model calls, no API key
bun run test:mod-forge

# Live test: starts real claude children and makes real model calls
# (about $0.01 to $0.03 per headless run). Needs ANTHROPIC_API_KEY and tmux.
bash plugins/mod-forge/tests/live.test.sh
```

---

## pr-pane

A Claude Code mod for keeping your open pull requests one keystroke away. **Claude Code only**, version 2.1.287 or later.

`/prs` toggles a band above the prompt listing your open PRs across repositories. The whole PR description carries its status color: `✗` unresolved comments or requested changes in red, `✓` approved in blue, `●` needs review in orange, and `○` draft in dim text. Draft takes precedence; unresolved review threads take precedence over approval. Resolved threads and historical comments do not make a PR red.

Press Ctrl+X, then Tab to focus the band; arrows or Tab move between controls and Enter opens a PR in your browser (`open` on macOS, `xdg-open` on Linux). While the band has focus, `r` sorts by repository, `s` by status, and `d` by last-updated date. One sort mode is active at a time; repository/status groups use newest-updated first. The default status order is feedback, approved, needs review, draft. Up to eight rows appear per page; `p`/`n` switch pages. If other band output makes the drawing overflow, arrows scroll and Tab still moves focus. Esc returns to the prompt and leaves the band visible; `/prs` hides it. The band sets no background color and yields while a survey is active.

Dim horizontal rules above and below the PR content visually separate it while preserving the default background. Smaller bands reduce the page size to leave room for the rules.

It needs no configuration. The GitHub user is whoever `gh` is logged in as. Background polling runs at startup, every 60 seconds, and when you show the band; updates normally appear within a minute plus API latency. The header shows the open PR count and last successful refresh time. A failed refresh keeps the last good list and shows the error in the band. If `gh` is missing or logged out, it says to run `gh auth login`. The list includes the 100 most recently updated PRs; the header shows the true total when there are more.

```bash
# Run the mod's tests (no network, no API key)
claude plugin test plugins/pr-pane
```

---

## Uninstallation

```bash
claude plugin uninstall cass
claude plugin uninstall skill-eval
claude plugin uninstall mod-forge
claude plugin uninstall pr-pane

# To remove the marketplace itself
claude plugin marketplace remove asragab-claude-marketplace
```

## License

MIT
