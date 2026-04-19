## Why

The cass plugin's `session-start-freshness.sh` SessionStart hook silently terminates with no JSON output if the embedded `python3` block exits non-zero (Python missing, runtime exception, env issue). Under `set -euo pipefail`, the failing command substitution kills the script before the `emit_safe_default` fallback at lines 164-165 can run, so the hook never satisfies its `{"continue":true}` contract. Downstream consumers see a broken hook instead of a graceful no-op.

## What Changes

- Add a fallback guard to the Python command substitution in `plugins/cass/hooks/session-start-freshness.sh` so that any non-zero exit from `python3` sets `output=""` instead of terminating the script.
- Allow the existing `if [ -z "$output" ]` branch on line 164 to fire `emit_safe_default`, preserving the SessionStart hook contract under all failure modes.
- No behavior change on the success path. No CLI changes. No new dependencies.

## Capabilities

### New Capabilities
- `cass-session-start-hook`: Defines the SessionStart hook contract for the cass plugin — when it MUST emit a valid `{"continue":true}` JSON envelope, and how it degrades when its embedded Python composer fails.

### Modified Capabilities
- (none)

## Impact

- File: `plugins/cass/hooks/session-start-freshness.sh` (single-line change near line 162).
- Affected systems: cass plugin SessionStart hook only. No CLI, skill, or marketplace metadata changes.
- Risk: minimal. Worst case prior behavior was silent failure; new behavior is silent fallback to `{"continue":true}`.
