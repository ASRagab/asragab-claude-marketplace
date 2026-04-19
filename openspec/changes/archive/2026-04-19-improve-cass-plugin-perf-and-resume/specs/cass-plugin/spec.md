# cass-plugin spec delta

## ADDED Requirements

### Requirement: Token-efficient default output for search-style commands

Skill recipes for `cass` commands that return hits or rows MUST default to a token-budgeted output shape using `--robot-format toon`, `--fields summary` (or equivalent narrowed projection), and `--max-tokens 1600`.

Wasteful raw `--json` recipes MAY still appear, but only as opt-in examples explicitly labeled "for human transcript review".

#### Scenario: Lead recipe in session-search uses TOON + summary + 1600 budget

- **Given** a recipe in `plugins/cass/skills/session-search/SKILL.md`
- **When** the recipe demonstrates `cass search` for an agent caller
- **Then** the first example MUST contain `--robot-format toon`, `--fields summary`, and `--max-tokens 1600`
- **And** an alternative `--robot-format json` recipe MAY follow if labeled as opt-in for human review

#### Scenario: Lead recipes across other skills inherit the same defaults

- **Given** any recipe in `session-context`, `session-learnings`, `session-export`, or `session-resume` that calls `cass search` or `cass sessions`
- **When** the recipe is presented as the first/lead example
- **Then** the recipe MUST include `--robot-format toon` and bound output via `--fields summary --max-tokens 1600` (search) or `--limit N` (sessions)

#### Scenario: Aggregate recipes account for CLI quirks

- **Given** a recipe that uses `--aggregate <fields>`
- **When** the recipe is written
- **Then** the recipe MUST include `--limit 1` (because `--aggregate` returns hits AND aggregations together; default unlimited dumps every hit)
- **And** the recipe MUST include `--max-content-length 100` instead of `--fields summary` (because `--fields` is incompatible with `--aggregate` — combining them returns 0 hits AND 0 aggregations)

### Requirement: SessionStart hook advises TOON encoding when CLI ≥ 0.3.0

The plugin's SessionStart hook MUST detect the cass CLI version (via `cass api-version --json`, falling back to `cass capabilities --json`) and, when the detected `crate_version` is ≥ 0.3.0, MUST include in its `systemMessage` an advisory to `export CASS_OUTPUT_FORMAT=toon` for downstream `cass` calls.

The hook does NOT directly export the env var into subsequent Bash tool calls (Claude Code Bash invocations are independent subprocesses and do not inherit hook-set env). Per-recipe `--robot-format toon` flags MUST remain in skill files for portability.

#### Scenario: Hook detects 0.3.x CLI and emits TOON advisory

- **Given** `cass api-version --json` returns `{ "crate_version": "0.3.x" }`
- **When** the SessionStart hook runs
- **Then** the hook output MUST be a single JSON object with `continue: true`
- **And** the `systemMessage` field MUST contain the substring `export CASS_OUTPUT_FORMAT=toon`

#### Scenario: Hook detects sub-0.3.0 CLI and emits upgrade advisory

- **Given** `cass api-version --json` returns `{ "crate_version": "0.2.7" }`
- **When** the SessionStart hook runs
- **Then** the `systemMessage` MUST contain a substring noting the recommended minimum is `0.3.0`
- **And** the hook MUST NOT include the `CASS_OUTPUT_FORMAT=toon` advisory

### Requirement: session-resume skill resolves a session into a launch command

The plugin MUST provide a `session-resume` skill at `plugins/cass/skills/session-resume/SKILL.md` that resolves a target session into a ready-to-run launch command for the session's native harness (Claude Code, Codex, OpenCode, pi_agent / pi / omp, Gemini) by wrapping `cass resume <path>`.

The skill MUST present the resolved command in two forms: a fenced code block (human readable) and a bare command line (paste).

The skill MUST NOT auto-execute the resolved command.

The skill MUST NOT maintain "last-resumed" state between invocations.

#### Scenario: Trigger phrases activate the skill

- **Given** any of the trigger phrases "resume that session", "pick up where I left off", "continue the X session", "go back to that conversation", "reopen the session about Y", or "rejoin"
- **When** the user issues such a phrase
- **Then** the `session-resume` skill MUST be the activated skill

#### Scenario: Discovery for current workspace

- **Given** the user gives no explicit path and no topic
- **When** the skill runs
- **Then** the skill MUST run `cass sessions --current --robot-format toon`
- **And** if exactly one session is returned, the skill MUST proceed directly to resolution

#### Scenario: Discovery via topic search

- **Given** the user names a topic (e.g. "the auth refactor session")
- **When** the skill runs
- **Then** the skill MUST run `cass search "<topic>" --workspace . --robot-format toon --fields summary --max-tokens 1600 --limit 5`

#### Scenario: Multiple candidates require user choice

- **Given** discovery returns 2 or more candidate sessions
- **When** the skill prepares output
- **Then** the skill MUST present a compact picker formatted as `agent · time · title-fragment` per line
- **And** the skill MUST NOT auto-pick a candidate

#### Scenario: Resume on a remote-source session

- **Given** the resolved session has `source_id != "local"`
- **When** the skill prepares output
- **Then** the skill MUST warn that the session lives on the remote machine
- **And** the skill MUST suggest wrapping the command via `ssh <origin_host> "<shell_command>"`

#### Scenario: Cross-agent harness mismatch

- **Given** the resolved harness differs from the agent currently running this skill (e.g. user is in Claude Code and the session is a Codex session)
- **When** the skill prepares output
- **Then** the skill output MUST state explicitly that running the command opens a different harness than the current one

#### Scenario: Resume command failure

- **Given** `cass resume <path>` returns non-success
- **When** the skill handles the error
- **Then** the skill output MUST suggest running `cass doctor`
- **And** the skill MUST surface the structured error from the JSON response

### Requirement: Maintenance skill documents all current CLI exit codes

The `session-maintenance` skill MUST document every cass exit code: 0 (success), 2 (usage), 3 (missing-db/index), 4 (network), 5 (data-corrupt), 6 (incompatible-version), 7 (lock/busy), 8 (partial), 9 (unknown).

#### Scenario: Exit-code table includes 4-8 alongside legacy 0/2/3/9

- **Given** the exit-codes section in `session-maintenance/SKILL.md`
- **When** an agent reads it
- **Then** the table MUST contain rows for codes 0, 2, 3, 4, 5, 6, 7, 8, and 9
- **And** code 9 MUST distinguish the `retryable=true` (transient lock) case from the persistent case

#### Scenario: Remote-source recipes surfaced

- **Given** the maintenance skill
- **When** a recipe section addresses remote sources
- **Then** the skill MUST include `cass sources doctor` and `cass sources mappings` recipes

### Requirement: Reference doc uses hybrid (inline hot-path, live long-tail) strategy

The plugin's `references/command-reference.md` MUST inline only the stable hot-path command set (`search`, `sessions`, `view`, `expand`, `context`, `timeline`, `stats`, `health`, `status`, `doctor`, `index`, `resume`) and MUST point at `cass robot-docs <topic>` for long-tail topics (`analytics`, `sources`, `contracts`, `exit-codes`, `env`, `paths`, `schemas`).

The reference MUST include a "New in v0.3.x" callout listing `resume`, `pages`, `introspect`, `api-version`, `sources mappings`, `sources doctor`.

#### Scenario: Long-tail topics defer to live docs

- **Given** the reference doc
- **When** an agent looks up `cass analytics`, `cass sources`, exit codes, contracts, env vars, or response schemas
- **Then** the reference MUST point the reader at `cass robot-docs <topic>` rather than inline the content

#### Scenario: New v0.3.x command set listed

- **Given** the reference doc
- **When** an agent looks up "what's new in v0.3.x"
- **Then** the reference MUST list `resume`, `pages`, `introspect`, `api-version`, `sources mappings`, `sources doctor`

### Requirement: Plugin declares minimum CLI floor at 0.3.0

The plugin's SessionStart hook MUST emit a `systemMessage` upgrade advisory when the detected cass CLI `crate_version` is below `0.3.0`. Individual skills MUST NOT version-gate per recipe (single floor handled centrally).

#### Scenario: CLI 0.2.x present

- **Given** `cass api-version --json` returns `crate_version: "0.2.x"`
- **When** the hook runs
- **Then** the `systemMessage` MUST contain text recommending upgrade to `>= 0.3.0`

#### Scenario: CLI 0.3.x present

- **Given** `cass api-version --json` returns `crate_version: "0.3.x"`
- **When** the hook runs
- **Then** the `systemMessage` MUST NOT contain an upgrade advisory
