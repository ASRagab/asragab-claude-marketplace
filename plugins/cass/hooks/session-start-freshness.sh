#!/usr/bin/env bash
# CASS Index Freshness + Version Floor — SessionStart hook
#   - Reports index status with actionable guidance
#   - Surfaces `recommended_action` from `cass status` when unhealthy
#   - Advises `export CASS_OUTPUT_FORMAT=toon` when CLI >= 0.3.0
#   - Emits upgrade advisory when CLI < 0.3.0
#
# All systemMessage composition happens in Python via json.dumps so any
# CLI-derived value (containing quotes, backslashes, newlines, etc.) is
# safely escaped — no shell string interpolation into JSON anywhere.

set -euo pipefail

emit_safe_default() {
  printf '%s\n' '{"continue":true}'
}

# --- 0. CLI presence check ---------------------------------------------------
if ! command -v cass >/dev/null 2>&1; then
  printf '%s\n' '{"continue":true,"systemMessage":"cass CLI not found on PATH. Install: https://github.com/Dicklesworthstone/coding_agent_session_search"}'
  exit 0
fi

# --- 1. Probe CLI (best-effort; empty strings on failure) --------------------
ver_json=$(cass api-version --json 2>/dev/null || cass capabilities --json 2>/dev/null || true)
health_json=$(cass health --json 2>/dev/null || true)
status_json=$(cass status --json 2>/dev/null || true)

# --- 2. Hand everything to Python; it composes the final JSON envelope -------
output=$(
  CASS_VER_JSON="$ver_json" \
  CASS_HEALTH_JSON="$health_json" \
  CASS_STATUS_JSON="$status_json" \
  python3 - <<'PY' 2>/dev/null
import json, os, sys

SKILLS = ("session-search, session-context, session-resume, "
          "session-analytics, session-learnings, session-export, "
          "or session-maintenance")
MIN_MAJOR, MIN_MINOR = 0, 3


def _load(env_var):
    raw = os.environ.get(env_var) or ""
    if not raw:
        return {}
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _str(x, default=""):
    if x is None:
        return default
    return str(x)


def _int(x, default=0):
    try:
        return int(x)
    except (TypeError, ValueError):
        return default


def _emit(msg):
    # json.dumps escapes ALL special characters; safe for any payload.
    sys.stdout.write(json.dumps({"continue": True, "systemMessage": msg}))


def _emit_bare():
    sys.stdout.write(json.dumps({"continue": True}))


ver = _load("CASS_VER_JSON")
crate_version = _str(ver.get("crate_version"), "unknown")

version_ok = False
if crate_version != "unknown":
    parts = (crate_version.split(".") + ["0", "0"])[:3]
    try:
        major = int("".join(c for c in parts[0] if c.isdigit()) or 0)
        minor = int("".join(c for c in parts[1] if c.isdigit()) or 0)
        version_ok = (major, minor) >= (MIN_MAJOR, MIN_MINOR)
    except Exception:
        pass

upgrade_advisory = ""
if not version_ok and crate_version != "unknown":
    upgrade_advisory = (
        f" cass CLI v{crate_version} detected; plugin recommends >= "
        f"{MIN_MAJOR}.{MIN_MINOR}.0 (resume command, robot-docs, TOON support). "
        "Upgrade with `brew upgrade cass` or installer."
    )

toon_advisory = ""
if version_ok:
    toon_advisory = " Hook tip: export CASS_OUTPUT_FORMAT=toon for token-efficient cass output."

h = _load("CASS_HEALTH_JSON")
s = _load("CASS_STATUS_JSON")

# Best-effort: gather all index/db signals from either source.
state = h.get("state") or {}
idx = state.get("index") or s.get("index") or {}
db = h.get("db") or s.get("database") or state.get("database") or {}
sdb = state.get("database") or {}
pending = state.get("pending") or s.get("pending") or {}

healthy = bool(h.get("healthy", False))
status_str = _str(h.get("status"), "unknown")
stale = bool(idx.get("stale", False))
exists = bool(idx.get("exists", False))
rebuilding = bool(idx.get("rebuilding", False))
last_indexed = _str(idx.get("last_indexed_at"), "unknown")


def _val(k):
    for src in (db, sdb):
        v = src.get(k)
        if v is not None:
            return v
    return 0


conversations = _int(_val("conversations"))
messages = _int(_val("messages"))
pending_sessions = _int(pending.get("sessions"))
recommended = _str(s.get("recommended_action") or h.get("recommended_action")).strip()

# If we have NO probe data at all, stay silent.
if not h and not s and not ver:
    _emit_bare()
    sys.exit(0)

# Branch composition — pure string assembly, no shell-side escaping.
if healthy and not stale:
    msg = (f"CASS index healthy: {conversations} conversations, "
           f"{messages} messages indexed (last: {last_indexed}).")
    if pending_sessions > 0:
        msg += f" {pending_sessions} sessions pending indexing."
    msg += f" Use {SKILLS} skills to query agent history."
    msg += toon_advisory + upgrade_advisory
elif rebuilding:
    msg = (f"CASS index is rebuilding (status: {status_str}). "
           "Searches may return partial results. "
           "Use session-maintenance skill if rebuild seems stuck."
           + upgrade_advisory)
elif healthy and stale:
    rec = recommended or "Run `cass index` to refresh."
    msg = f"CASS index stale (last indexed: {last_indexed}). {rec}{upgrade_advisory}"
elif not exists:
    rec = recommended or "Run `cass index --full` to build the index."
    msg = f"CASS index not found. {rec}{upgrade_advisory}"
else:
    rec = recommended or "Run `cass doctor --fix` or use session-maintenance skill for diagnostics."
    msg = f"CASS status: {status_str}. {rec}{upgrade_advisory}"

_emit(msg)
PY
)

if [ -z "$output" ]; then
  emit_safe_default
else
  printf '%s\n' "$output"
fi
