#!/usr/bin/env bash
# CASS Index Freshness Check — SessionStart hook
# Runs 'cass health --json' and warns if the index is stale or missing.

set -euo pipefail

health_json=$(cass health --json 2>/dev/null || echo '{}')

eval "$(echo "$health_json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
healthy = d.get('healthy', False)
idx = d.get('state', {}).get('index', {})
db = d.get('state', {}).get('database', {})
stale = idx.get('stale', False)
exists = idx.get('exists', False)
last = idx.get('last_indexed_at', 'unknown')
convos = db.get('conversations', 0)
msgs = db.get('messages', 0)
print(f'healthy={str(healthy).lower()}')
print(f'stale={str(stale).lower()}')
print(f'exists={str(exists).lower()}')
print(f'last_indexed=\"{last}\"')
print(f'conversations={convos}')
print(f'messages={msgs}')
" 2>/dev/null)" || { echo '{"continue":true}'; exit 0; }

if [ "$healthy" = "true" ] && [ "$stale" = "false" ]; then
  echo '{"continue":true,"systemMessage":"CASS index healthy: '"$conversations"' conversations, '"$messages"' messages indexed (last: '"$last_indexed"'). Use session-search, session-context, session-analytics, or session-learnings skills to query agent history."}'
elif [ "$healthy" = "true" ] && [ "$stale" = "true" ]; then
  echo '{"continue":true,"systemMessage":"CASS index stale (last indexed: '"$last_indexed"'). Run `cass index` to refresh before searching agent history."}'
elif [ "$exists" = "false" ]; then
  echo '{"continue":true,"systemMessage":"CASS index not found. Run `cass index --full` to build the index."}'
else
  echo '{"continue":true,"systemMessage":"CASS index status: unknown. Run `cass index --full` if search results seem incomplete."}'
fi
