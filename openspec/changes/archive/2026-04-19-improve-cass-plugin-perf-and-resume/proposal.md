# Improve cass plugin: token-perf defaults + session-resume skill

## Why

The `cass` plugin tracks `cass` CLI v0.2.7. Local CLI is v0.3.2 (latest v0.3.4). Five releases of new behavior unsurfaced, and current skill recipes burn ~85 KB on a default `cass search` because no field/budget caps are applied.

Two acute pains:

1. **Token waste.** Default `cass search "x" --json --limit 10` returns full `content` per hit. Measured: 85,445 bytes for `--limit 2`. Same query with `--fields summary --max-tokens 1600 --robot-format toon` = 756 bytes (~99% reduction). The skills mention these flags but lead every recipe with the wasteful form.
2. **No path back into a session.** CLI v0.3.0 added `cass resume <path>` that resolves any session file to a ready-to-run launch command for its native harness (Claude Code, Codex, OpenCode, pi_agent, Gemini). Plugin never exposes it. Users who say "pick up that auth session" have no skill to reach for.

## What Changes

- Plugin manifest version `0.2.0` → `0.3.0`; all six existing skill `version` fields bumped likewise.
- `references/command-reference.md` regenerated for CLI v0.3.x; long-tail topics defer to `cass robot-docs <topic>`.
- Every existing skill's lead recipe reshaped to default token-efficient output (`--robot-format toon --fields summary --max-tokens 1600`); aggregate recipes patched for `--limit 1 --max-content-length 100` (CLI quirks documented).
- New `session-resume` skill wraps `cass resume <path>` with current-workspace, topic-search, and explicit-path discovery + multi-match picker + remote/cross-agent edge cases.
- `session-maintenance` exit-code table extended with codes 4/5/6/7/8 + `cass sources doctor` / `cass sources mappings` recipes + HNSW build criterion.
- SessionStart hook detects CLI version (`cass api-version --json`), emits `CASS_OUTPUT_FORMAT=toon` advisory when ≥ 0.3.0, emits upgrade advisory when below; surfaces `recommended_action` from `cass status` when index unhealthy. Hook env exports do not propagate to subsequent Bash tool calls in Claude Code, so per-call flags remain in recipes.
- `README.md` plugin row + cass section updated to v0.3.0; lists session-resume; recipes use new defaults.

## Goals

1. Cut default token spend on every skill call by making `--fields summary --max-tokens 1600` the lead recipe and exporting `CASS_OUTPUT_FORMAT=toon` from the SessionStart hook.
2. Add a `session-resume` skill that takes "resume that session", "pick up where I left off", "continue X" and returns a ready-to-run command.
3. Refresh all skill files + reference doc to v0.3.x. Drop the static command-reference for long-tail topics in favor of `cass robot-docs <topic>`.

## Non-goals

- Wrapping `cass` in a shell shim that injects flags transparently (too magic).
- Soft memory of "last resumed session" for follow-up resumes (state cost > value).
- Surfacing every new v0.3.x command. Only `resume` ships in this change. `pages`, `introspect`, `api-version`, `sources mappings`, `sources doctor` deferred to a follow-up change.
- Hook redesign (jq swap, PreCompact injector, capability cache). Deferred.
- Implementing TOON output as a hard requirement for non-search commands where output is naturally tiny.

## Scope

- Plugin manifest: bump `version` to `0.3.0`.
- All skill `version` fields: bump to `0.3.0`.
- `references/command-reference.md`: regenerate from `cass robot-docs commands + schemas + examples`. Add v0.3.x version banner. Keep stable hot-path commands inline; link to `cass robot-docs <topic>` for analytics/sources/contracts/exit-codes/env.
- Each existing skill SKILL.md: lead recipe rewritten with `--fields summary --max-tokens 1600 --robot-format toon`. Wasteful raw `--json` examples reframed as opt-in for human review.
- `hooks/session-start-freshness.sh`: export `CASS_OUTPUT_FORMAT=toon` to the session env so subsequent `cass` calls inherit it.
- New skill: `skills/session-resume/SKILL.md`. Follows existing skill format.
- Add exit codes 4/5/6/7/8 to `session-maintenance` skill table.

## Success criteria

- A representative `cass search` invocation in any skill recipe stays under 1,600 output tokens by default.
- `session-resume` skill activates on triggers `resume that session`, `pick up where I left off`, `continue the X session`, returns a ready-to-run command for the matched session's native harness.
- Plugin works against `cass` ≥ 0.3.0 (version-gate the resume skill on `cass capabilities` or `cass api-version` if needed).
- All v0.2.7 references replaced.
