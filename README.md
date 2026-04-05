# asragab-claude-marketplace

A Claude Code plugin marketplace containing plugins for session search/analytics and skill evaluation.

## Plugins

| Plugin | Version | Description |
|--------|---------|-------------|
| [cass](#cass) | 0.2.0 | Cross-agent session search, context, analytics, export, and learnings powered by CASS CLI |
| [skill-eval](#skill-eval) | 1.0.0 | Automated skill/prompt/tool evaluation and improvement via session log analysis and autoresearch optimization |

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
```

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- [Bun runtime](https://bun.sh) (required by skill-eval scripts)
- [CASS CLI](https://github.com/search?q=cass+coding+agent+session+search) v0.2.7+ (required by cass plugin)

---

## cass

Cross-agent session search, context loading, token analytics, session export, and learning synthesis powered by [CASS](https://github.com/search?q=cass+coding+agent+session+search) (Coding Agent Session Search). Searches across Claude Code, Codex, Cursor, Gemini CLI, Copilot, and 14+ other agents.

### Skills

#### `/cass:session-search`

Search across all indexed coding agent sessions. Supports lexical (BM25), semantic (vector), and hybrid search modes.

```bash
cass search "authentication flow" --mode hybrid --json --limit 10
cass search "error" --days 30 --json --aggregate agent
```

#### `/cass:session-context`

Load relevant past session context for the current task, file, or project.

```bash
cass sessions --current --json
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
cass search "error fix bug" --mode hybrid --json --limit 20
cass analytics tools --limit 20 --json
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

## Uninstallation

```bash
claude plugin uninstall cass
claude plugin uninstall skill-eval

# To remove the marketplace itself
claude plugin marketplace remove asragab-claude-marketplace
```

## License

MIT
