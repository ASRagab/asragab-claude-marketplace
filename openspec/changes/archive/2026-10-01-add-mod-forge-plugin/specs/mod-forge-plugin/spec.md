# Spec Delta

## Purpose

Defines how the `mod-forge` plugin, which builds and verifies Claude Code mods in isolated child processes, is packaged, registered, and tested inside this marketplace.

## ADDED Requirements

### Requirement: Plugin is installable from this marketplace
The marketplace SHALL list a plugin named `mod-forge` whose source is `./plugins/mod-forge`, and the plugin directory SHALL contain a valid plugin manifest at `.claude-plugin/plugin.json` with the same name and version as the marketplace entry.

#### Scenario: Marketplace entry resolves
- **WHEN** `.claude-plugin/marketplace.json` is read
- **THEN** it contains one entry named `mod-forge` with source `./plugins/mod-forge`
- **AND** `plugins/mod-forge/.claude-plugin/plugin.json` exists with matching `name` and `version`

#### Scenario: Plugin validates
- **WHEN** `claude plugin validate plugins/mod-forge` runs with Claude Code 2.1.287 or later
- **THEN** it exits 0

#### Scenario: Name is not reserved
- **WHEN** the plugin name is checked against Claude Code's reserved-name rule
- **THEN** the name does not start with `claude-`

### Requirement: Harness keeps its fail-loud behavior
The packaged harness SHALL NOT gain opt-in flags, dry-run defaults, mock fallbacks, or silently skipped stages, and its entry script SHALL be executable.

#### Scenario: Entry script stays executable
- **WHEN** the mode of `plugins/mod-forge/scripts/run-mod.sh` is read
- **THEN** the owner execute bit is set

#### Scenario: Missing precondition fails loudly
- **WHEN** a live stage is requested and `ANTHROPIC_API_KEY` is unset
- **THEN** the harness exits 2 and names `ANTHROPIC_API_KEY`
- **AND** the stage is not reported as passed or skipped

### Requirement: Offline test passes without credentials
The plugin SHALL ship an offline test that makes no model calls and needs neither `ANTHROPIC_API_KEY` nor `tmux`, and the repository SHALL expose it as a single command.

#### Scenario: Offline test from repository root
- **WHEN** `bun run test:mod-forge` runs at the repository root with `claude` 2.1.287 or later, `jq`, and no `ANTHROPIC_API_KEY`
- **THEN** every case prints `ok` and the command exits 0

#### Scenario: Offline test leaves the repository clean
- **WHEN** the offline test finishes
- **THEN** `git status --short` at the repository root is the same as before the run

### Requirement: Live test is a documented manual command
The plugin SHALL ship a live test that starts real `claude` children and makes real model calls, and its documented invocation SHALL name the `ANTHROPIC_API_KEY` and `tmux` requirements and the approximate cost. The live test SHALL NOT run from `bun test` or any default script.

#### Scenario: Live test is not part of default test runs
- **WHEN** `bun test tests/` or `bun run test` runs
- **THEN** no `claude` child is started by `mod-forge`

#### Scenario: Live test without credentials
- **WHEN** `bash plugins/mod-forge/tests/live.test.sh` runs with `ANTHROPIC_API_KEY` unset
- **THEN** it prints `live tests need ANTHROPIC_API_KEY` and exits 2

### Requirement: Documentation reflects the new location
The repository README SHALL list `mod-forge` in the plugin table with its version, give its install command, and state that it works only with Claude Code 2.1.287 or later. Documentation inside the plugin SHALL NOT reference `make mod-forge-test` or any path outside this repository.

#### Scenario: README lists the plugin
- **WHEN** the README plugin table is read
- **THEN** it has a `mod-forge` row whose version equals the manifest version

#### Scenario: No stale source-repo references
- **WHEN** `plugins/mod-forge` is searched for `make mod-forge-test`, `handshake-ade-tools`, and `joinhandshake`
- **THEN** there are no matches
