#!/usr/bin/env bash
# Runs a Claude Code mod through isolated verification stages.
#
#   run-mod.sh [--stages validate,test,headless,interactive] [--expect TEXT]
#              [--marker-text TEXT] [--timeout SECONDS] [--model MODEL] MOD_DIR
#
# The interactive stage needs --expect: text that must appear on the screen.
#
# Stages run in the order validate, test, headless, interactive and stop at the
# first failure. Exit codes: 0 every requested stage passed, 1 a stage failed,
# 2 usage error or missing precondition.
#
# Environment:
#   CLAUDE_BIN      claude executable (default: claude)
#   MOD_FORGE_HOME  harness state: config cache and run directories
#                   (default: ${TMPDIR:-/tmp}/mod-forge)

set -euo pipefail

MIN_VERSION=2.1.287
ALL_STAGES=(validate test headless interactive)

CLAUDE_BIN=${CLAUDE_BIN:-claude}
FORGE_HOME=${MOD_FORGE_HOME:-${TMPDIR:-/tmp}/mod-forge}
STAGES=validate,test
MODEL=haiku
EXPECT=
MARKER_TEXT=loaded
TIMEOUT=60
MOD_DIR=

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=isolation.sh
. "$SCRIPT_DIR/isolation.sh"

# Where the invoking person's own Claude Code keeps its state. Live stages must
# leave it alone.
REAL_CONFIG_DIR=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
REAL_CLAUDE_JSON=${CLAUDE_CONFIG_DIR:+$CLAUDE_CONFIG_DIR/.claude.json}
REAL_CLAUDE_JSON=${REAL_CLAUDE_JSON:-$HOME/.claude.json}

die() {
  echo "mod-forge: $*" >&2
  exit 2
}

usage() {
  sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case $1 in
    --stages) [ $# -ge 2 ] || die "--stages needs a value"; STAGES=$2; shift 2 ;;
    --expect) [ $# -ge 2 ] || die "--expect needs a value"; EXPECT=$2; shift 2 ;;
    --marker-text) [ $# -ge 2 ] || die "--marker-text needs a value"; MARKER_TEXT=$2; shift 2 ;;
    --timeout) [ $# -ge 2 ] || die "--timeout needs a value"; TIMEOUT=$2; shift 2 ;;
    --model) [ $# -ge 2 ] || die "--model needs a value"; MODEL=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) [ -z "$MOD_DIR" ] || die "only one MOD_DIR is accepted"; MOD_DIR=$1; shift ;;
  esac
done

[ -n "$MOD_DIR" ] || { usage >&2; exit 2; }
[ -d "$MOD_DIR" ] || die "mod directory not found: $MOD_DIR"
MOD_DIR=$(cd "$MOD_DIR" && pwd -P) || die "cannot resolve mod directory: $MOD_DIR"

# Requested stages, validated and put in canonical order.
want() { case ",$STAGES," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }
IFS=, read -r -a requested <<<"$STAGES"
for s in "${requested[@]}"; do
  case " ${ALL_STAGES[*]} " in *" $s "*) ;; *) die "unknown stage: $s" ;; esac
done

wants_live() { want headless || want interactive; }

# --- preconditions: fail loudly, never skip -------------------------------

check_preconditions() {
  command -v "$CLAUDE_BIN" >/dev/null 2>&1 || die "precondition: '$CLAUDE_BIN' not found on PATH"
  command -v jq >/dev/null 2>&1 || die "precondition: jq not found on PATH"

  local version
  version=$("$CLAUDE_BIN" --version 2>/dev/null | awk '{print $1; exit}')
  [ -n "$version" ] || die "precondition: cannot read the claude version from '$CLAUDE_BIN --version'"
  if [ "$(printf '%s\n%s\n' "$MIN_VERSION" "$version" | sort -V | head -n1)" != "$MIN_VERSION" ]; then
    die "precondition: Claude Code $version is older than the required $MIN_VERSION"
  fi

  "$CLAUDE_BIN" plugin test --help >/dev/null 2>&1 \
    || die "precondition: 'claude plugin test' is not available in Claude Code $version"

  if wants_live && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    die "precondition: ANTHROPIC_API_KEY is not set (live stages run under a harness-owned config directory with no stored login)"
  fi
  if want interactive; then
    command -v tmux >/dev/null 2>&1 || die "precondition: tmux not found on PATH (needed by the interactive stage)"
    [ -n "$EXPECT" ] || die "the interactive stage needs --expect TEXT (the text that must appear on screen)"
  fi
  case $TIMEOUT in ''|*[!0-9]*) die "--timeout must be a whole number of seconds" ;; esac
}

check_preconditions

# --- run directory containment --------------------------------------------

mkdir -p "$FORGE_HOME/runs" || die "cannot create harness home: $FORGE_HOME/runs"
RUN_DIR="$FORGE_HOME/runs/$(date +%Y%m%d-%H%M%S)-$$"
mkdir "$RUN_DIR" || die "cannot create run directory: $RUN_DIR"
RUN_DIR=$(cd "$RUN_DIR" && pwd -P) || die "cannot resolve run directory: $RUN_DIR"

# Every child starts with cwd == RUN_DIR. A child started anywhere else once
# wrote its debug log into the caller's repository.
enter_run_dir() {
  cd "$RUN_DIR" || die "cannot enter run directory: $RUN_DIR"
  [ "$(pwd -P)" = "$RUN_DIR" ] || die "not inside run directory $RUN_DIR (in $(pwd -P))"
}
enter_run_dir

# --- stages ---------------------------------------------------------------

pass() { echo "[$1] PASS  evidence: $2"; }
fail() { echo "[$1] FAIL  evidence: $2"; echo "RESULT: FAIL stage=$1 run_dir=$RUN_DIR"; exit 1; }

stage_validate() {
  enter_run_dir
  local out=$RUN_DIR/validate.json
  if "$CLAUDE_BIN" plugin validate --json "$MOD_DIR" >"$out" 2>"$RUN_DIR/validate.err" \
      && jq -e '.success == true' "$out" >/dev/null 2>&1; then
    pass validate "$out"
  else
    jq -r '[.manifest.errors[]?, (.contents[]?.errors[]?)] | .[] | "  \(.path): \(.message)"' "$out" 2>/dev/null \
      || sed 's/^/  /' "$RUN_DIR/validate.err"
    fail validate "$out"
  fi
}

stage_test() {
  enter_run_dir
  local out=$RUN_DIR/test.log
  # A run that executed zero tests must not pass.
  if "$CLAUDE_BIN" plugin test "$MOD_DIR" >"$out" 2>&1 && grep -Eq '^ *[1-9][0-9]* pass' "$out"; then
    pass test "$out"
  else
    tail -n 30 "$out" | sed 's/^/  /'
    fail test "$out"
  fi
}

# --- live stages ----------------------------------------------------------

# The harness-owned config directory holds onboarding and trust state for
# scratch paths and nothing else. It is kept between runs.
CONFIG_CACHE=$FORGE_HOME/config
MOD_COPY=$RUN_DIR/mod

# Claude Code writes type declarations and a tsconfig.json into any folder
# loaded with --plugin-dir, so live stages load a copy.
copy_mod() {
  [ -d "$MOD_COPY" ] && return 0
  [ "$CONFIG_CACHE" != "$REAL_CONFIG_DIR" ] || die "harness config cache is the real config directory: $CONFIG_CACHE"
  mkdir -p "$CONFIG_CACHE" || die "cannot create config cache: $CONFIG_CACHE"
  cp -R "$MOD_DIR/." "$MOD_COPY" || die "cannot copy the mod into the run directory"
}

mod_name() { jq -r '.name // empty' "$MOD_DIR/.claude-plugin/plugin.json"; }

stage_headless() {
  copy_mod
  enter_run_dir
  local name marker=$RUN_DIR/marker log=$RUN_DIR/debug.log out=$RUN_DIR/headless.json
  local violations=$RUN_DIR/isolation.txt
  name=$(mod_name)
  [ -n "$name" ] || die "cannot read the plugin name from $MOD_DIR/.claude-plugin/plugin.json"

  CLAUDE_CONFIG_DIR=$CONFIG_CACHE MOD_FORGE_MARKER=$marker \
    "$CLAUDE_BIN" -p --model "$MODEL" --plugin-dir "$MOD_COPY" --strict-mcp-config \
      --debug-file "$log" --output-format json "Reply with the single word ok." \
      </dev/null >"$out" 2>"$RUN_DIR/headless.err" || true

  local cost problems=()
  cost=$(jq -r '.total_cost_usd // empty' "$out" 2>/dev/null || true)
  [ -z "$cost" ] || echo "[headless] cost: \$$cost"

  if ! jq -e '.is_error == false' "$out" >/dev/null 2>&1; then
    problems+=("the child did not finish cleanly (see $out and $RUN_DIR/headless.err)")
  fi
  if ! grep -Fq "hooks module $name@inline loaded" "$log" 2>/dev/null; then
    problems+=("debug log has no 'hooks module $name@inline loaded' line")
  fi
  if [ ! -f "$marker" ]; then
    problems+=("the mod did not write its marker file: $marker")
  elif [ "$(cat "$marker")" != "$MARKER_TEXT" ]; then
    problems+=("marker holds '$(cat "$marker")', expected '$MARKER_TEXT'")
  fi
  if [ -f "$log" ]; then
    isolation_violations "$log" "$REAL_CONFIG_DIR" "$REAL_CLAUDE_JSON" "$RUN_DIR" "$name" >"$violations"
    local line
    while IFS= read -r line; do problems+=("isolation: $line"); done <"$violations"
  fi

  if [ ${#problems[@]} -eq 0 ]; then
    pass headless "$log (marker: $marker)"
  else
    printf '  %s\n' "${problems[@]}"
    if [ -f "$log" ]; then
      # Module-load failures first; the log is otherwise full of unrelated errors.
      { grep -E 'hooks module .*(failed to load|did not load)|HooksError|ui\.render .*refused' "$log" \
          || grep -iE 'error|refus' "$log" | grep -v 'Failed to stat' | head -n 5; } \
        | sed 's/^/  log: /' || true
    fi
    fail headless "$log"
  fi
}

# The interactive child runs on a tmux server of its own (-L), started from this
# process so it inherits ANTHROPIC_API_KEY, and never touches the person's tmux
# sessions. The server is killed on every exit path.
TMUX_SOCKET=modforge-$$
tmux_cmd() { tmux -L "$TMUX_SOCKET" -f /dev/null "$@"; }
cleanup() {
  local socket
  socket=$(tmux_cmd display-message -p '#{socket_path}' 2>/dev/null) || socket=
  tmux_cmd kill-server >/dev/null 2>&1 || true
  # kill-server leaves the socket file behind.
  [ -z "$socket" ] || rm -f "$socket"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

mask_secrets() { sed -E 's/sk-[A-Za-z0-9._-]+/sk-***/g'; }

# Answers a first-run prompt by matching its text. Prints nothing and returns 1
# when the screen is not a prompt it knows.
answer_prompt() { # answer_prompt SCREEN
  local screen=$1
  case $screen in
    *"Choose the text style"*) tmux_cmd send-keys -t main Enter ;;
    *"Do you want to use this API key?"*)
      if grep -Eq '^ *❯ .*Yes' <<<"$screen"; then tmux_cmd send-keys -t main Enter
      else tmux_cmd send-keys -t main Up Enter; fi ;;
    *"Press Enter to continue"*) tmux_cmd send-keys -t main Enter ;;
    *"Is this a project you created or one you trust"*)
      if grep -Eq '^ *❯ .*Yes, I trust' <<<"$screen"; then tmux_cmd send-keys -t main Enter
      else tmux_cmd send-keys -t main Down Enter; fi ;;
    *) return 1 ;;
  esac
}

stage_interactive() {
  copy_mod
  enter_run_dir
  local name marker=$RUN_DIR/marker log=$RUN_DIR/debug.log capture=$RUN_DIR/screen.txt
  local violations=$RUN_DIR/isolation.txt
  name=$(mod_name)
  [ -n "$name" ] || die "cannot read the plugin name from $MOD_DIR/.claude-plugin/plugin.json"

  local cmd
  cmd=$(printf 'exec env CLAUDE_CONFIG_DIR=%q MOD_FORGE_MARKER=%q %q --model %q --plugin-dir %q --strict-mcp-config --debug-file %q' \
    "$CONFIG_CACHE" "$marker" "$CLAUDE_BIN" "$MODEL" "$MOD_COPY" "$log")
  tmux_cmd new-session -d -s main -x 120 -y 40 -c "$RUN_DIR" "$cmd" || die "cannot start tmux session"

  local screen prev_answered= found=0 deadline=$((SECONDS + TIMEOUT)) problems=()
  : >"$capture"
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! screen=$(tmux_cmd capture-pane -p -t main 2>/dev/null); then
      problems+=("the claude process exited before the expected text appeared")
      break
    fi
    printf '%s\n' "$screen" | mask_secrets >"$capture"
    if grep -Fq -- "$EXPECT" <<<"$screen"; then found=1; break; fi
    if [ "$screen" != "$prev_answered" ] && answer_prompt "$screen"; then
      prev_answered=$screen
      sleep 1
      continue
    fi
    sleep 0.5
  done
  [ "$found" -eq 1 ] || problems+=("'$EXPECT' did not appear on screen within ${TIMEOUT}s")

  if [ -f "$log" ]; then
    isolation_violations "$log" "$REAL_CONFIG_DIR" "$REAL_CLAUDE_JSON" "$RUN_DIR" "$name" >"$violations"
    local line
    while IFS= read -r line; do problems+=("isolation: $line"); done <"$violations"
  fi

  if [ ${#problems[@]} -eq 0 ]; then
    pass interactive "$capture"
  else
    printf '  %s\n' "${problems[@]}"
    echo "  last screen:"
    { grep -v '^[[:space:]]*$' "$capture" || true; } | tail -n 12 | sed 's/^/    /'
    fail interactive "$capture"
  fi
}

echo "mod-forge: mod=$MOD_DIR run_dir=$RUN_DIR"
for s in "${ALL_STAGES[@]}"; do
  want "$s" || continue
  "stage_$s"
done
echo "RESULT: PASS stages=$STAGES run_dir=$RUN_DIR"
