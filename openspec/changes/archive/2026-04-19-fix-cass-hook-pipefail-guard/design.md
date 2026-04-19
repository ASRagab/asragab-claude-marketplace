## Context

`plugins/cass/hooks/session-start-freshness.sh` is a SessionStart hook that probes the `cass` CLI, hands the JSON outputs to an embedded `python3` heredoc, and emits a `systemMessage` envelope. The script runs under `set -euo pipefail` (line 12). The Python composer is invoked via `output=$(... python3 - <<'PY' ... PY)` at lines 30–162.

`pipefail` plus `set -e` means: if the command inside `$(...)` exits non-zero, the whole script aborts immediately. There is an `emit_safe_default` fallback at lines 14–16 and a guard at lines 164–168 that fires `emit_safe_default` when `$output` is empty — but under the current code, if `python3` fails (not installed, raises an uncaught exception, killed by signal), the script aborts before reaching line 164, so `emit_safe_default` is unreachable.

Effect: in any environment without a working `python3`, the SessionStart hook produces no stdout. Claude Code treats this as a hook contract violation rather than a no-op.

## Goals / Non-Goals

**Goals:**
- Guarantee the hook always emits a single line of valid JSON satisfying the SessionStart contract, even if the embedded Python composer fails for any reason.
- Preserve existing success-path output byte-for-byte.
- Single-line, surgical change with no new dependencies.

**Non-Goals:**
- Refactoring the hook into pure Bash or pure Python.
- Adding telemetry/logging for Python failures.
- Changing what `recommended_action` text is surfaced.
- Touching any other hook script or skill.

## Decisions

### Decision 1: Add `|| output=""` guard rather than short-circuit `emit_safe_default`

Two viable shapes:

**A.** `) || output=""` — fall through to the existing `if [ -z "$output" ]` block, which already calls `emit_safe_default`.

**B.** `) || { emit_safe_default; exit 0; }` — short-circuit immediately on Python failure.

**Choice: A.** Reuses the existing fallback path on lines 164–168 (single source of truth for the empty-output behavior). It also means a Python script that runs successfully but emits nothing (edge case) is already handled identically — both paths converge. Option B would create two emission sites for the same envelope, which we'd then need to keep in sync.

### Decision 2: Apply the guard to the command substitution closer, not inside Python

The Python heredoc already uses broad `try/except` and `_emit_bare()` for partial failures. The remaining failure modes are environmental (Python missing, syntax error in the heredoc, OS-level kill). None of these can be caught from inside Python. The shell-side guard is the correct layer.

### Decision 3: Do not disable `set -euo pipefail`

`pipefail` is load-bearing for the `cass api-version --json` chain on line 25 (`A || B || true`). Disabling it would mask other genuine failures. Localized `|| output=""` keeps the strict-mode posture intact.

## Risks / Trade-offs

- **Risk:** A bug introduced inside the Python heredoc (e.g., a typo causing `SyntaxError`) would now be silently swallowed by the fallback. **Mitigation:** Acceptable for a SessionStart hook whose contract is best-effort advisory; a CI smoke test (`bash plugins/cass/hooks/session-start-freshness.sh | jq -e '.continue == true'`) catches regressions.
- **Risk:** Future maintainers may not realize the fallback exists and double-emit. **Mitigation:** A short comment above the guard line explains intent.

## Migration Plan

No migration. Single-line edit ships in the next plugin version bump or as a hotfix. Rollback = revert the one-line change.
