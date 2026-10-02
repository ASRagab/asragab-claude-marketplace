#!/usr/bin/env bash
# Runs a Claude Code mod through isolated verification stages.
#
#   run-mod.sh [--stages validate,test,headless,typecheck,interactive]
#              [--expect TEXT] [--script FILE] [--cols N] [--rows N]
#              [--marker-text TEXT] [--timeout SECONDS] [--model MODEL] MOD_DIR
#
# The interactive stage needs --expect: text that must appear on the screen
# once the mod has loaded. --cols and --rows size the terminal (120 by 40).
#
# --script FILE drives the session after --expect appears. One step per line,
# blank lines and lines starting with # are ignored:
#   type TEXT       send TEXT as typed characters
#   key NAME...     send tmux key names (Enter, Down, C-c)
#   expect TEXT     wait for TEXT on screen
# Each wait, --expect included, is bounded by --timeout on its own. A capture is
# saved after every step as screen-NN.txt. Steps can have real side effects:
# Enter on a row opens whatever the row opens.
#
# Stages run in the order validate, test, headless, typecheck, interactive and
# stop at the first failure. typecheck compiles the run copy of the mod against
# the declarations the engine wrote into it, so it needs headless in the same
# run. Exit codes: 0 every requested stage passed, 1 a stage failed, 2 usage
# error or missing precondition.
#
# Interactive evidence: screen.txt (plain, last capture), screen.ansi (same
# capture with color escapes), stream.raw (the child's terminal output),
# screen-NN.txt (one per script step), interactive.marker and
# interactive.debug.log (proof the mod loaded in that session).
#
# Environment:
#   CLAUDE_BIN      claude executable (default: claude)
#   MOD_FORGE_HOME  harness state: config cache and run directories
#                   (default: ${TMPDIR:-/tmp}/mod-forge). Relative paths are
#                   taken from where the harness is started. The directory is
#                   created 0700 and refused when it is a symlink, not yours,
#                   or open to group or others.

set -euo pipefail

MIN_VERSION=2.1.287
ALL_STAGES=(validate test headless typecheck interactive)

CLAUDE_BIN=${CLAUDE_BIN:-claude}
FORGE_HOME=${MOD_FORGE_HOME:-${TMPDIR:-/tmp}/mod-forge}
STAGES=validate,test
MODEL=haiku
EXPECT=
SCRIPT=
COLS=120
ROWS=40
MARKER_TEXT=loaded
TIMEOUT=60
# Seconds the interactive stage keeps looking for proof that the mod loaded once
# the expected text is on screen: the text can be drawn before the mod loads.
PROOF_GRACE=5
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
    --script) [ $# -ge 2 ] || die "--script needs a value"; SCRIPT=$2; shift 2 ;;
    --cols) [ $# -ge 2 ] || die "--cols needs a value"; COLS=$2; shift 2 ;;
    --rows) [ $# -ge 2 ] || die "--rows needs a value"; ROWS=$2; shift 2 ;;
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

# Script steps, parsed once here so a typo fails before any child starts.
STEP_KIND=()
STEP_ARG=()
parse_script() {
  local line kind rest n=0
  [ -r "$SCRIPT" ] || die "script not readable: $SCRIPT"
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    kind= rest=
    read -r kind rest <<<"$line"
    case $kind in
      ''|'#'*) continue ;;
      type|key|expect) [ -n "$rest" ] || die "$SCRIPT line $n: '$kind' needs an argument" ;;
      *) die "$SCRIPT line $n: unknown step '$kind' (use type, key or expect)" ;;
    esac
    STEP_KIND+=("$kind")
    STEP_ARG+=("$rest")
  done <"$SCRIPT"
  [ ${#STEP_KIND[@]} -gt 0 ] || die "script has no steps: $SCRIPT"
}

if [ -n "$SCRIPT" ]; then
  want interactive || die "--script needs the interactive stage"
  [ -n "$EXPECT" ] || die "--script needs --expect TEXT: the text that shows the session is ready for the first step"
  parse_script
fi

# The first compiler found: tsc, then bunx, then npx without installing.
TSC=()
find_tsc() {
  if command -v tsc >/dev/null 2>&1; then TSC=(tsc)
  elif command -v bunx >/dev/null 2>&1; then TSC=(bunx tsc)
  elif command -v npx >/dev/null 2>&1; then TSC=(npx --no-install tsc)
  else return 1
  fi
}

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
  if want typecheck; then
    find_tsc || die "precondition: no TypeScript compiler: none of tsc, bunx or npx is on PATH (needed by the typecheck stage)"
  fi
  case $TIMEOUT in ''|*[!0-9]*) die "--timeout must be a whole number of seconds" ;; esac
  case $COLS in ''|*[!0-9]*|0) die "--cols must be a positive whole number" ;; esac
  case $ROWS in ''|*[!0-9]*|0) die "--rows must be a positive whole number" ;; esac
}

check_preconditions

# --- harness home: absolute and private -----------------------------------

# Resolved before any stage changes directory, so a relative MOD_FORGE_HOME means
# relative to where the harness was started. The home holds a config directory
# that live stages run under and the evidence of every run, so another user must
# not be able to read it or plant it.
resolve_home() {
  local home=$FORGE_HOME mode
  while [ "${#home}" -gt 1 ] && [ "${home%/}" != "$home" ]; do home=${home%/}; done
  [ -e "$home" ] || [ -L "$home" ] || mkdir -m 0700 -p "$home" || die "cannot create harness home: $home"
  [ ! -L "$home" ] || die "harness home is a symlink: $home (use a real directory, or set MOD_FORGE_HOME)"
  [ -d "$home" ] || die "harness home is not a directory: $home"
  [ -O "$home" ] || die "harness home is not owned by the current user: $home (set MOD_FORGE_HOME to a directory you own)"
  # ls prints the mode as drwxrwxrwx; characters 5 to 10 are the group and other bits.
  mode=$(ls -ld "$home" | cut -c1-10)
  [ "${mode:4:6}" = ------ ] || die "harness home is open to other users (mode $mode): $home; run: chmod 700 $home"
  FORGE_HOME=$(cd "$home" && pwd -P) || die "cannot resolve harness home: $home"
}
resolve_home

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
# loaded with --plugin-dir, so live stages load a copy. Declarations left in the
# source by an earlier session are dropped from the copy: the typecheck stage
# takes their presence as proof the engine wrote them in this run.
copy_mod() {
  [ -d "$MOD_COPY" ] && return 0
  [ "$CONFIG_CACHE" != "$REAL_CONFIG_DIR" ] || die "harness config cache is the real config directory: $CONFIG_CACHE"
  mkdir -p "$CONFIG_CACHE" || die "cannot create config cache: $CONFIG_CACHE"
  cp -R "$MOD_DIR/." "$MOD_COPY" || die "cannot copy the mod into the run directory"
  rm -rf "$MOD_COPY/.claude-plugin/types"
}

mod_name() { jq -r '.name // empty' "$MOD_DIR/.claude-plugin/plugin.json"; }

# Prints one line per missing proof that the mod loaded in the session whose
# debug log and marker file are given.
load_proof_problems() { # load_proof_problems NAME MARKER LOG
  local name=$1 marker=$2 log=$3
  if ! grep -Fq "hooks module $name@inline loaded" "$log" 2>/dev/null; then
    echo "debug log has no 'hooks module $name@inline loaded' line"
  fi
  if [ ! -f "$marker" ]; then
    echo "the mod did not write its marker file: $marker"
  elif [ "$(cat "$marker")" != "$MARKER_TEXT" ]; then
    echo "marker holds '$(cat "$marker")', expected '$MARKER_TEXT'"
  fi
}

stage_headless() {
  copy_mod
  enter_run_dir
  local name marker=$RUN_DIR/marker log=$RUN_DIR/debug.log out=$RUN_DIR/headless.json
  local violations=$RUN_DIR/isolation.txt rc=0
  name=$(mod_name)
  [ -n "$name" ] || die "cannot read the plugin name from $MOD_DIR/.claude-plugin/plugin.json"

  CLAUDE_CONFIG_DIR=$CONFIG_CACHE MOD_FORGE_MARKER=$marker \
    "$CLAUDE_BIN" -p --model "$MODEL" --plugin-dir "$MOD_COPY" --strict-mcp-config \
      --debug-file "$log" --output-format json "Reply with the single word ok." \
      </dev/null >"$out" 2>"$RUN_DIR/headless.err" || rc=$?

  local cost line problems=()
  cost=$(jq -r '.total_cost_usd // empty' "$out" 2>/dev/null || true)
  [ -z "$cost" ] || echo "[headless] cost: \$$cost"

  # Whatever evidence the child left, a non-zero exit is a failed run.
  if [ "$rc" -ne 0 ]; then
    problems+=("the child exited with status $rc (see $RUN_DIR/headless.err)")
  fi
  if ! jq -e '.is_error == false' "$out" >/dev/null 2>&1; then
    problems+=("the child did not finish cleanly (see $out and $RUN_DIR/headless.err)")
  fi
  while IFS= read -r line; do problems+=("$line"); done < <(load_proof_problems "$name" "$marker" "$log")
  if [ -f "$log" ]; then
    isolation_violations "$log" "$REAL_CONFIG_DIR" "$REAL_CLAUDE_JSON" "$RUN_DIR" "$name" >"$violations"
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

# Compiles the run copy, never the source: the engine writes the declarations and
# the tsconfig.json it compiles against into the copy when it loads the mod, and
# a compile in the source would leave those files in the caller's tree.
stage_typecheck() {
  enter_run_dir
  local out=$RUN_DIR/typecheck.log
  if [ ! -f "$MOD_COPY/tsconfig.json" ] || [ ! -f "$MOD_COPY/.claude-plugin/types/tsconfig.json" ]; then
    echo "  the engine-written declarations are missing from $MOD_COPY: run headless in the same run so the engine loads the mod first"
    fail typecheck "$MOD_COPY"
  fi
  if "${TSC[@]}" -p "$MOD_COPY" --noEmit >"$out" 2>&1; then
    pass typecheck "$out"
  else
    tail -n 30 "$out" | sed 's/^/  /'
    fail typecheck "$out"
  fi
}

# The interactive child runs on a tmux server of its own (-L), started from this
# process so it inherits ANTHROPIC_API_KEY, and never touches the person's tmux
# sessions. The server is killed on every exit path.
TMUX_SOCKET=modforge-$$
tmux_cmd() { tmux -L "$TMUX_SOCKET" -f /dev/null "$@"; }

mask_secrets() { sed -E 's/sk-[A-Za-z0-9._-]+/sk-***/g'; }

# The child's terminal output is recorded to stream.raw.tmp while it runs and
# masked into stream.raw once the pipe is closed, so a key the terminal echoes
# never lands in the evidence. Byte-wise (LC_ALL=C): a terminal stream is not
# always valid text.
STREAM_RAW=
finish_stream() {
  [ -n "$STREAM_RAW" ] || return 0
  tmux_cmd pipe-pane -t main >/dev/null 2>&1 && sleep 0.3
  [ ! -f "$STREAM_RAW.tmp" ] || { LC_ALL=C mask_secrets <"$STREAM_RAW.tmp" >"$STREAM_RAW"; rm -f "$STREAM_RAW.tmp"; }
}

cleanup() {
  local socket
  socket=$(tmux_cmd display-message -p '#{socket_path}' 2>/dev/null) || socket=
  tmux_cmd kill-server >/dev/null 2>&1 || true
  # kill-server leaves the socket file behind.
  [ -z "$socket" ] || rm -f "$socket"
  finish_stream
}
trap cleanup EXIT
trap 'exit 130' INT TERM

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

# Saves the current screen to $CAPTURE (masked) and leaves the raw text in
# $SCREEN. Returns 1 when the tmux session or its process is gone.
CAPTURE=
SCREEN=
child_gone=0
snapshot_screen() {
  SCREEN=$(tmux_cmd capture-pane -p -t main 2>/dev/null) || { child_gone=1; return 1; }
  printf '%s\n' "$SCREEN" | mask_secrets >"$CAPTURE"
}

# Waits up to --timeout seconds for TEXT to appear, answering first-run prompts
# on the way. Returns 1 when it does not, with child_gone=1 when the process
# exited instead.
wait_for_text() { # wait_for_text TEXT
  local text=$1 prev= deadline=$((SECONDS + TIMEOUT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    snapshot_screen || return 1
    if grep -Fq -- "$text" <<<"$SCREEN"; then return 0; fi
    if [ "$SCREEN" != "$prev" ] && answer_prompt "$SCREEN"; then
      prev=$SCREEN
      sleep 1
      continue
    fi
    sleep 0.5
  done
  return 1
}

# Runs the script steps against the session. Appends to the caller's problems
# and returns 1 at the first step that cannot complete.
run_script() {
  local i n kind arg keys
  for ((i = 0; i < ${#STEP_KIND[@]}; i++)); do
    n=$(printf '%02d' $((i + 1)))
    kind=${STEP_KIND[$i]}
    arg=${STEP_ARG[$i]}
    case $kind in
      type)
        tmux_cmd send-keys -t main -l -- "$arg" || { problems+=("step $n (type): the claude process has exited"); return 1; }
        sleep 0.5; snapshot_screen || true ;;
      key)
        read -r -a keys <<<"$arg"
        tmux_cmd send-keys -t main "${keys[@]}" || { problems+=("step $n (key): the claude process has exited"); return 1; }
        sleep 0.5; snapshot_screen || true ;;
      expect)
        if ! wait_for_text "$arg"; then
          cp "$CAPTURE" "$RUN_DIR/screen-$n.txt"
          if [ "$child_gone" -eq 1 ]; then problems+=("step $n: the claude process exited before '$arg' appeared")
          else problems+=("step $n: '$arg' did not appear on screen within ${TIMEOUT}s"); fi
          return 1
        fi ;;
    esac
    cp "$CAPTURE" "$RUN_DIR/screen-$n.txt"
  done
}

stage_interactive() {
  copy_mod
  enter_run_dir
  # The marker and log belong to this session: headless evidence from the same
  # run must not count as proof the mod loaded here.
  local name marker=$RUN_DIR/interactive.marker log=$RUN_DIR/interactive.debug.log
  local go=$RUN_DIR/interactive.go violations=$RUN_DIR/isolation.txt
  CAPTURE=$RUN_DIR/screen.txt
  STREAM_RAW=$RUN_DIR/stream.raw
  name=$(mod_name)
  [ -n "$name" ] || die "cannot read the plugin name from $MOD_DIR/.claude-plugin/plugin.json"

  # The child waits for $go so the terminal stream is being recorded before it
  # writes its first byte.
  local cmd
  cmd=$(printf 'while [ ! -e %q ]; do sleep 0.1; done; exec env CLAUDE_CONFIG_DIR=%q MOD_FORGE_MARKER=%q %q --model %q --plugin-dir %q --strict-mcp-config --debug-file %q' \
    "$go" "$CONFIG_CACHE" "$marker" "$CLAUDE_BIN" "$MODEL" "$MOD_COPY" "$log")
  tmux_cmd new-session -d -s main -x "$COLS" -y "$ROWS" -c "$RUN_DIR" "$cmd" || die "cannot start tmux session"
  tmux_cmd pipe-pane -t main "cat >>$(printf '%q' "$STREAM_RAW.tmp")" || die "cannot record the terminal stream"
  : >"$go"

  local line proof grace problems=()
  : >"$CAPTURE"
  if ! wait_for_text "$EXPECT"; then
    if [ "$child_gone" -eq 1 ]; then problems+=("the claude process exited before the expected text appeared")
    else problems+=("'$EXPECT' did not appear on screen within ${TIMEOUT}s"); fi
  else
    # The text alone proves nothing: the startup banner can match it. The mod
    # must also have written its marker and be named as loaded in the debug log.
    grace=$((SECONDS + PROOF_GRACE))
    while :; do
      proof=$(load_proof_problems "$name" "$marker" "$log")
      if [ -z "$proof" ] || [ "$SECONDS" -ge "$grace" ]; then break; fi
      sleep 0.5
    done
    while IFS= read -r line; do [ -z "$line" ] || problems+=("$line"); done <<<"$proof"
    [ ${#problems[@]} -gt 0 ] || run_script || true
  fi

  tmux_cmd capture-pane -p -e -t main 2>/dev/null | mask_secrets >"$RUN_DIR/screen.ansi" || true
  finish_stream

  if [ -f "$log" ]; then
    isolation_violations "$log" "$REAL_CONFIG_DIR" "$REAL_CLAUDE_JSON" "$RUN_DIR" "$name" >"$violations"
    while IFS= read -r line; do problems+=("isolation: $line"); done <"$violations"
  fi

  local evidence="$CAPTURE (color: $RUN_DIR/screen.ansi, stream: $STREAM_RAW)"
  if [ ${#problems[@]} -eq 0 ]; then
    [ ${#STEP_KIND[@]} -eq 0 ] || echo "[interactive] script steps: ${#STEP_KIND[@]} (screen-NN.txt in $RUN_DIR)"
    pass interactive "$evidence"
  else
    printf '  %s\n' "${problems[@]}"
    echo "  last screen:"
    { grep -v '^[[:space:]]*$' "$CAPTURE" || true; } | tail -n 12 | sed 's/^/    /'
    fail interactive "$evidence"
  fi
}

echo "mod-forge: mod=$MOD_DIR run_dir=$RUN_DIR"
for s in "${ALL_STAGES[@]}"; do
  want "$s" || continue
  "stage_$s"
done
echo "RESULT: PASS stages=$STAGES run_dir=$RUN_DIR"
