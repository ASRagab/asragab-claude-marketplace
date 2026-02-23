#!/usr/bin/env bash
# CASS Index Freshness Check — SessionStart hook
# Runs 'cass health --json' and warns if the index is stale or missing.

set -euo pipefail

health_json=$(cass health --json 2>/dev/null || echo '{"status":"error"}')
status=$(echo "$health_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "unknown")

if [ "$status" = "healthy" ]; then
  conversations=$(echo "$health_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('conversations',0))" 2>/dev/null || echo "?")
  last_indexed=$(echo "$health_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('last_indexed','unknown'))" 2>/dev/null || echo "unknown")
  echo '{"continue":true,"systemMessage":"CASS index healthy: '"$conversations"' conversations indexed (last: '"$last_indexed"'). Use session-search, session-context, session-analytics, or session-learnings skills to query agent history."}'
elif [ "$status" = "stale" ] || [ "$status" = "outdated" ]; then
  echo '{"continue":true,"systemMessage":"WARNING: CASS index is stale. Run `cass index` to refresh before searching agent history."}'
else
  echo '{"continue":true,"systemMessage":"CASS index status: '"$status"'. Run `cass index --full` if search results seem incomplete."}'
fi
