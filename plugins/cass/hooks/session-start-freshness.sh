#!/usr/bin/env bash
# CASS Index Freshness + Version Floor — SessionStart hook
#   - Reports index status with actionable guidance
#   - Surfaces `recommended_action` from `cass status` when unhealthy
#   - Exports CASS_OUTPUT_FORMAT=toon for downstream `cass` calls when CLI >= 0.3.0
#   - Emits upgrade advisory when CLI < 0.3.0

set -euo pipefail

emit() {
  # Single JSON line on stdout for SessionStart hook contract.
  printf '%s\n' "$1"
}

# --- 0. CLI detection + version floor -----------------------------------------
if ! command -v cass >/dev/null 2>&1; then
  emit '{"continue":true,"systemMessage":"cass CLI not found on PATH. Install: https://github.com/Dicklesworthstone/coding_agent_session_search"}'
  exit 0
fi

# Prefer api-version (cheapest); fall back to capabilities.
ver_json=$(cass api-version --json 2>/dev/null || cass capabilities --json 2>/dev/null || echo '{}')
crate_version=$(printf '%s' "$ver_json" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('crate_version', 'unknown'))
except Exception:
    print('unknown')
" 2>/dev/null || echo unknown)

version_ok=false
if [ "$crate_version" != "unknown" ]; then
  major=$(printf '%s' "$crate_version" | awk -F. '{print $1+0}')
  minor=$(printf '%s' "$crate_version" | awk -F. '{print $2+0}')
  if [ "$major" -gt 0 ] || { [ "$major" -eq 0 ] && [ "$minor" -ge 3 ]; }; then
    version_ok=true
  fi
fi

# --- 1. Health probe ----------------------------------------------------------
health_json=$(cass health --json 2>/dev/null || echo '{}')
status_json=$(cass status --json 2>/dev/null || echo '{}')

parsed=$(
  HEALTH_JSON="$health_json" STATUS_JSON="$status_json" python3 - <<'PY' 2>/dev/null
import json, os, shlex

def _load(env_var):
    raw = os.environ.get(env_var, '') or ''
    try:
        v = json.loads(raw) if raw else {}
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}

h = _load('HEALTH_JSON')
s = _load('STATUS_JSON')
healthy = bool(h.get('healthy', False))
status_str = str(h.get('status', 'unknown') or 'unknown')
idx = (h.get('state') or {}).get('index') or s.get('index') or {}
db = h.get('db') or s.get('database') or {}
sdb = (h.get('state') or {}).get('database') or {}
pending = (h.get('state') or {}).get('pending') or s.get('pending') or {}
stale = bool(idx.get('stale', False))
exists = bool(idx.get('exists', False))
rebuilding = bool(idx.get('rebuilding', False))
last = str(idx.get('last_indexed_at') or 'unknown')

def _val(k):
    for src in (db, sdb):
        v = src.get(k)
        if v is not None:
            return v
    return 0

convos = _val('conversations') or 0
msgs = _val('messages') or 0
pending_sessions = pending.get('sessions') or 0
recommended = str(s.get('recommended_action') or h.get('recommended_action') or '').strip()

def _emit(name, value):
    print(f"{name}={shlex.quote(str(value))}")

_emit('healthy', 'true' if healthy else 'false')
_emit('status', status_str)
_emit('stale', 'true' if stale else 'false')
_emit('exists', 'true' if exists else 'false')
_emit('rebuilding', 'true' if rebuilding else 'false')
_emit('last_indexed', last)
_emit('conversations', convos)
_emit('messages', msgs)
_emit('pending_sessions', pending_sessions)
_emit('recommended', recommended)
PY
)

if [ -z "$parsed" ]; then
  emit '{"continue":true}'
  exit 0
fi
eval "$parsed" || { emit '{"continue":true}'; exit 0; }

# --- 2. Compose advisories ---------------------------------------------------
skills_list="session-search, session-context, session-resume, session-analytics, session-learnings, session-export, or session-maintenance"

# Hook contract: SessionStart hook may also expose env via hookSpecificOutput.
# We export CASS_OUTPUT_FORMAT=toon when version supports it. If the harness
# does not propagate exports across tool calls, recipes still pass the
# per-call `--robot-format toon` flag — both forms are honored by cass.
hook_env=""
if [ "$version_ok" = "true" ]; then
  hook_env=' Hook tip: export CASS_OUTPUT_FORMAT=toon for token-efficient cass output.'
fi

version_advisory=""
if [ "$version_ok" != "true" ] && [ "$crate_version" != "unknown" ]; then
  version_advisory=" cass CLI v${crate_version} detected; plugin recommends >= 0.3.0 (resume command, robot-docs, TOON support). Upgrade with `brew upgrade cass` or installer."
fi

if [ "$healthy" = "true" ] && [ "$stale" = "false" ]; then
  msg="CASS index healthy: ${conversations} conversations, ${messages} messages indexed (last: ${last_indexed})."
  if [ "${pending_sessions:-0}" -gt 0 ] 2>/dev/null; then
    msg="${msg} ${pending_sessions} sessions pending indexing."
  fi
  msg="${msg} Use ${skills_list} skills to query agent history.${hook_env}${version_advisory}"
  emit "{\"continue\":true,\"systemMessage\":\"${msg}\"}"
elif [ "$rebuilding" = "true" ]; then
  emit "{\"continue\":true,\"systemMessage\":\"CASS index is rebuilding (status: ${status}). Searches may return partial results. Use session-maintenance skill if rebuild seems stuck.${version_advisory}\"}"
elif [ "$healthy" = "true" ] && [ "$stale" = "true" ]; then
  rec_text="Run \`cass index\` to refresh."
  [ -n "${recommended:-}" ] && rec_text="$recommended"
  emit "{\"continue\":true,\"systemMessage\":\"CASS index stale (last indexed: ${last_indexed}). ${rec_text}${version_advisory}\"}"
elif [ "$exists" = "false" ]; then
  rec_text="Run \`cass index --full\` to build the index."
  [ -n "${recommended:-}" ] && rec_text="$recommended"
  emit "{\"continue\":true,\"systemMessage\":\"CASS index not found. ${rec_text}${version_advisory}\"}"
else
  rec_text="Run \`cass doctor --fix\` or use session-maintenance skill for diagnostics."
  [ -n "${recommended:-}" ] && rec_text="$recommended"
  emit "{\"continue\":true,\"systemMessage\":\"CASS status: ${status}. ${rec_text}${version_advisory}\"}"
fi
