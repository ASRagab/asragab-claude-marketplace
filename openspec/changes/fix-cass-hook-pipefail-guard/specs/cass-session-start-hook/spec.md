## ADDED Requirements

### Requirement: SessionStart hook always emits valid JSON envelope

The `plugins/cass/hooks/session-start-freshness.sh` script SHALL emit exactly one line of valid JSON to stdout that satisfies the Claude Code SessionStart hook contract (`{"continue": true, ...}`) on every invocation, regardless of the availability or behavior of the embedded `python3` composer.

#### Scenario: Python composer succeeds with cass available

- **WHEN** `cass` CLI is on PATH and returns valid JSON for `api-version`, `health`, and `status`, AND `python3` runs the heredoc to completion
- **THEN** the script emits a single line of JSON containing `"continue": true` and a `"systemMessage"` field whose value is the composed advisory text (healthy/stale/rebuilding/not-found branch)

#### Scenario: Python interpreter is not installed

- **WHEN** `cass` CLI is on PATH but `python3` is not installed or not executable
- **THEN** the embedded command substitution fails non-zero, the shell-side fallback guard sets `output` to empty, and the script emits the safe default `{"continue":true}` exactly once

#### Scenario: Python composer raises an uncaught exception

- **WHEN** `python3` starts but the heredoc exits non-zero (e.g., signal, I/O error, syntax error in the heredoc)
- **THEN** the script does NOT abort under `set -euo pipefail`, and instead emits the safe default `{"continue":true}` exactly once

#### Scenario: cass CLI is missing

- **WHEN** the `cass` binary is not on PATH
- **THEN** the script emits the install-advisory JSON envelope and exits 0 without invoking Python

### Requirement: Hook script preserves strict shell mode

The hook SHALL continue to run under `set -euo pipefail` so that genuine bugs in the cass-probing chain (lines 25–27) are not silently masked. Fallback handling SHALL be localized to the Python command substitution only.

#### Scenario: Strict mode remains enabled

- **WHEN** the script is read after the fix
- **THEN** line 12 still contains `set -euo pipefail` and no `set +e` / `set +u` toggles are introduced elsewhere in the file
