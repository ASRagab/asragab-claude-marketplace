#!/usr/bin/env bash
# CASS Index Freshness Check — SessionStart hook
# Runs 'cass health --json' and reports index status with actionable guidance.

set -euo pipefail

health_json=$(cass health --json 2>/dev/null || echo '{}')

# Parse health JSON — handle both top-level 'db' and 'state.database' paths,
# and null values for conversations/messages (counts_skipped during rebuilds).
parsed=$(echo "$health_json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
healthy = d.get('healthy', False)
status = d.get('status', 'unknown')
idx = d.get('state', {}).get('index', {})
db = d.get('db', {})
sdb = d.get('state', {}).get('database', {})
pending = d.get('state', {}).get('pending', {})
stale = idx.get('stale', False)
exists = idx.get('exists', False)
rebuilding = idx.get('rebuilding', False)
last = idx.get('last_indexed_at', 'unknown')
convos = db.get('conversations') or sdb.get('conversations') or 0
msgs = db.get('messages') or sdb.get('messages') or 0
pending_sessions = pending.get('sessions', 0)
print(f'healthy={str(healthy).lower()}')
print(f'status=\"{status}\"')
print(f'stale={str(stale).lower()}')
print(f'exists={str(exists).lower()}')
print(f'rebuilding={str(rebuilding).lower()}')
print(f'last_indexed=\"{last}\"')
print(f'conversations={convos}')
print(f'messages={msgs}')
print(f'pending_sessions={pending_sessions}')
" 2>/dev/null) || { echo '{"continue":true}'; exit 0; }

eval "$parsed" || { echo '{"continue":true}'; exit 0; }

skills_list="session-search, session-context, session-analytics, session-learnings, session-export, or session-maintenance"

if [ "$healthy" = "true" ] && [ "$stale" = "false" ]; then
  msg="CASS index healthy: ${conversations} conversations, ${messages} messages indexed (last: ${last_indexed})."
  if [ "$pending_sessions" -gt 0 ] 2>/dev/null; then
    msg="${msg} ${pending_sessions} sessions pending indexing."
  fi
  msg="${msg} Use ${skills_list} skills to query agent history."
  echo '{"continue":true,"systemMessage":"'"$msg"'"}'
elif [ "$rebuilding" = "true" ]; then
  echo '{"continue":true,"systemMessage":"CASS index is rebuilding (status: '"$status"'). Searches may return partial results. Use session-maintenance skill if rebuild seems stuck."}'
elif [ "$healthy" = "true" ] && [ "$stale" = "true" ]; then
  echo '{"continue":true,"systemMessage":"CASS index stale (last indexed: '"$last_indexed"'). Run `cass index` to refresh. Use session-maintenance skill for diagnostics."}'
elif [ "$exists" = "false" ]; then
  echo '{"continue":true,"systemMessage":"CASS index not found. Run `cass index --full` to build the index. Use session-maintenance skill for setup guidance."}'
else
  echo '{"continue":true,"systemMessage":"CASS status: '"$status"'. Run `cass doctor --fix` or use session-maintenance skill for diagnostics."}'
fi
