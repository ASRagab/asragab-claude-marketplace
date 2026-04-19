# Tasks: improve cass plugin perf + session-resume

## Phase 1 — Version + reference refresh

- [x] Bump `plugins/cass/.claude-plugin/plugin.json` `version` → `0.3.0`
- [x] Bump `version` field in every existing skill (`session-search`, `session-context`, `session-analytics`, `session-export`, `session-learnings`, `session-maintenance`) → `0.3.0`
- [x] Replace every `v0.2.7` string in `references/command-reference.md` and skill files
- [x] Regenerate `references/command-reference.md`:
  - [x] Capture `cass robot-docs commands` and `cass robot-docs schemas` output
  - [x] Inline stable hot-path commands: `search`, `sessions`, `view`, `expand`, `context`, `timeline`, `stats`, `health`, `status`, `doctor`, `index`
  - [x] Replace long-tail sections with pointers to `cass robot-docs <topic>` for `analytics`, `sources`, `contracts`, `exit-codes`, `env`, `paths`
- [x] Add a new "New in v0.3.x" callout listing `resume`, `pages`, `introspect`, `api-version`, `sources mappings`, `sources doctor` (even if not all surfaced as skills yet)

## Phase 2 — Token-perf defaults in skills

- [x] In `skills/session-search/SKILL.md`:
  - [x] Change lead recipe to `cass search "<query>" --robot-format toon --fields summary --max-tokens 1600 --limit 10`
  - [x] Reframe full-content `--json` examples as opt-in for human transcripts
  - [x] Add explicit "default to `--aggregate` for any broad question" guidance up top
  - [x] Add `--two-tier`, `--fast-only`, `--quality-only`, `--reranker` as a "search-mode tuning" subsection
  - [x] Add `--daemon` recommendation when doing repeated semantic search
- [x] In `skills/session-context/SKILL.md`:
  - [x] Change lead recipes to use `--fields summary --max-tokens 1600 --robot-format toon`
  - [x] Cross-reference new `session-resume` skill at the end
- [x] In `skills/session-analytics/SKILL.md`:
  - [x] Update version banner; add `--source` filter to shared flags
  - [x] Document analytics retry guidance (exit 9 + retryable=true → retry after 1s)
- [x] In `skills/session-learnings/SKILL.md`:
  - [x] Lead recipes use `--fields summary --max-tokens 1600 --robot-format toon`
- [x] In `skills/session-export/SKILL.md`:
  - [x] Update version banner
  - [x] Discovery-step recipes use `--fields summary --max-tokens 1600`
- [x] In `skills/session-maintenance/SKILL.md`:
  - [x] Add exit codes 4 (network), 5 (data-corrupt), 6 (incompat), 7 (lock/busy), 8 (partial) to the table
  - [x] Add `cass sources mappings` and `cass sources doctor` recipes
  - [x] Add HNSW build recipe with criterion ("when conversations > ~10k")

## Phase 3 — Hook updates

- [x] In `hooks/session-start-freshness.sh`:
  - [x] After health check, call `cass api-version --json` (fallback `cass capabilities --json`); parse `crate_version`
  - [x] If `crate_version >= 0.3.0`, emit systemMessage that includes `export CASS_OUTPUT_FORMAT=toon` advisory; otherwise emit upgrade advisory
  - [x] Verify whether `systemMessage` env exports propagate to subsequent Bash tool calls in Claude Code; if not, document the per-recipe flag fallback in skills
  - [x] Surface `recommended_action` from `cass status --json` instead of static text when index unhealthy

## Phase 4 — session-resume skill (new)

- [x] Create `plugins/cass/skills/session-resume/SKILL.md` with frontmatter:
  - [x] `name: session-resume`
  - [x] `description` listing trigger phrases: "resume that session", "pick up where I left off", "continue the X session", "go back to that conversation", "rejoin", "reopen session"
  - [x] `version: 0.3.0`
- [x] Document workflow:
  - [x] Step 1 — Discovery (current-workspace lead, then topic-search variant, then explicit-path)
  - [x] Step 2 — Resolve via `cass resume <path> --json`
  - [x] Step 3 — Present command (fenced block + bare line)
- [x] Document edge cases:
  - [x] Multiple matches → compact list, ask user
  - [x] `source_id != local` → ssh wrapper suggestion
  - [x] Cross-agent harness mismatch → explicit warning
  - [x] Resume errors → suggest `cass doctor`
- [x] Document `--agent` override flags (`claude`, `codex`, `opencode`, `pi_agent`/`pi`/`omp`, `gemini`)
- [x] Token budget note: skill stays under ~600 tokens worst case

## Phase 5 — Verify

- [x] Manual probe: run lead recipe from each updated skill; capture token sizes; confirm under 1,600 tokens
  - Search lead: 758 B (~190 tokens). Sessions current: 410 B. Recent sessions limit 10: 3.7 KB. Learnings hybrid: 781 B. All within budget.
  - **Discovery: `--aggregate` returns hits AND aggregations together; default `--limit 0` dumps unbounded hits. `--fields` is incompatible with `--aggregate` (returns 0 hits + 0 aggregations). All aggregate recipes patched to use `--limit 1 --max-content-length 100` instead.**
- [x] Manual probe: trigger session-resume on:
  - [x] Local Claude Code session (current workspace) — works, returns `claude --resume <id>`
  - [x] Topic-search match — works (verified via `cass search` + `cass resume` chain)
  - [x] Explicit path — works (terraform session resolved correctly)
  - [x] Multi-match scenario — `cass sessions --workspace ... --robot-format toon --limit 5` returns picker-ready output
- [x] Confirm hook's TOON env propagation behavior; update skill recipes if env does NOT propagate (revert to per-call `--robot-format toon`)
  - **Decision: keep per-call `--robot-format toon` flags in all recipes. SessionStart hook env exports do NOT propagate to subsequent Bash tool calls in Claude Code (each Bash invocation is its own subprocess). The hook's advisory message tells the user to run `export CASS_OUTPUT_FORMAT=toon` interactively.**
- [x] Check `cass --version` ≥ 0.3.0 advisory shows when CLI older — branch logic verified by code review (cannot mock without uninstall). Current 0.3.2 → no advisory shown, as expected.
- [x] Update marketplace README plugin listing if version-displayed there — bumped to 0.3.0; added session-resume; updated recipes to TOON defaults; updated CLI requirement to v0.3.0+.

## Phase 6 — Ship

- [x] Bump plugin version, update plugin.json — done in Task 1.
- [x] Branch: `feat/cass-plugin-v0.3.0` — created at start of apply.
- [x] Commit per phase for reviewability — 6 commits on `feat/cass-plugin-v0.3.0`.
- [x] PR description includes: token-size before/after table, list of new commands surfaced, version-floor declaration — PR #5: <https://github.com/ASRagab/asragab-claude-marketplace/pull/5>
