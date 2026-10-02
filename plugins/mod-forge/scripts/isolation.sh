#!/usr/bin/env bash
# Sourced by run-mod.sh and the live tests. Defines isolation_violations.

# Claude Code names a project's transcript directory after its working
# directory with every non-alphanumeric character replaced by "-".
encode_project_dir() {
  printf '%s' "$1" | sed 's/[^A-Za-z0-9]/-/g'
}

# isolation_violations DEBUG_LOG REAL_CONFIG_DIR REAL_CLAUDE_JSON RUN_DIR PLUGIN
#
# Prints one line per way a child run reached outside its own config directory
# and nothing when it stayed inside. The person's live session rewrites
# ~/.claude.json and ~/.claude/projects while a run is in progress, so this
# looks for records of this run rather than comparing those files before and
# after.
isolation_violations() {
  local log=$1 real_cfg=$2 real_json=$3 run_dir=$4 plugin=$5 n

  n=$(grep -cF -- "$real_cfg" "$log" || true)
  [ "$n" -eq 0 ] || echo "debug log names the real config directory $n time(s): $real_cfg"

  n=$(grep -cF -- "$real_json" "$log" || true)
  [ "$n" -eq 0 ] || echo "debug log names the real config file $n time(s): $real_json"

  grep -E 'hooks module .* loaded' "$log" \
    | grep -vE "@builtin|hooks module ${plugin}@inline" \
    | sed 's/^/hook module from outside the mod: /' || true

  if [ -e "$real_cfg/projects/$(encode_project_dir "$run_dir")" ]; then
    echo "a transcript directory for this run exists under the real config: $real_cfg/projects/$(encode_project_dir "$run_dir")"
  fi

  if [ -f "$real_json" ] \
      && jq -e --arg p "$run_dir" '(.projects // {}) | has($p)' "$real_json" >/dev/null 2>&1; then
    echo "the real config file holds a project record for this run: $real_json"
  fi
}
