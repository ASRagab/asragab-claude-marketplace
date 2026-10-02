#!/usr/bin/env bash
# Offline tests for scripts/run-mod.sh. No model calls. Cases that need the
# real CLI use only `claude plugin validate` and `claude plugin test`.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PLUGIN=$(cd "$SCRIPT_DIR/.." && pwd -P)
REPO=$(cd "$PLUGIN/../.." && pwd -P)
RUN_MOD="$PLUGIN/scripts/run-mod.sh"
FIXTURE="$PLUGIN/skills/build-claude-mod/fixtures/loop-probe"

tmp=$(mktemp -d "${TMPDIR:-/tmp}/mod-forge.offline.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

failures=0
check() { # check NAME CONDITION-COMMAND...
  local name=$1; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; failures=$((failures + 1)); fi
}
contains() { grep -Fq -- "$2" <<<"$1"; }
lacks() { ! grep -Fq -- "$2" <<<"$1"; }

# A claude stand-in that logs every invocation. STUB_VERSION sets the reported
# version. With STUB_RM_CWD set, the jq wrapper deletes its working directory
# (the run directory) after the validate check passes, which is the moment
# between two stages.
#
# As a child run (-p headless, no -p interactive) it plays a mod that loaded: it
# writes the debug log line and the marker, and leaves the declarations the
# engine writes into the plugin directory. Switches:
#   STUB_NO_LOAD=1              the mod never loads (no log line, no marker)
#   STUB_INTERACTIVE_NO_LOAD=1  the same, for the interactive child only
#   STUB_MARKER=TEXT            marker content (default: loaded)
#   STUB_NO_TYPES=1             no engine-written declarations
#   STUB_EXIT=N                 headless exit status (default: 0)
# It logs the config directory it was given and whether that directory held
# state from an earlier run.
make_stub() {
  mkdir -p "$tmp/bin"
  cat >"$tmp/bin/claude" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_LOG"
case "$1" in
  --version) echo "${STUB_VERSION:-2.1.287} (Claude Code)"; exit 0 ;;
  plugin)
    case "$2" in
      test) [ "${3:-}" = --help ] && exit 0; echo " 1 pass" ;;
      validate) echo '{"success":true}' ;;
    esac
    exit 0 ;;
esac

headless=0 dir= log= prev=
for a in "$@"; do
  case $prev in --plugin-dir) dir=$a ;; --debug-file) log=$a ;; esac
  [ "$a" = -p ] && headless=1
  prev=$a
done
echo "child cfg=${CLAUDE_CONFIG_DIR:-} headless=$headless" >>"$STUB_LOG"
if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
  if [ -f "$CLAUDE_CONFIG_DIR/onboarded" ]; then
    echo "config cached" >>"$STUB_LOG"
  else
    mkdir -p "$CLAUDE_CONFIG_DIR"; : >"$CLAUDE_CONFIG_DIR/onboarded"
    echo "config onboarding" >>"$STUB_LOG"
  fi
fi

load=1
[ -z "${STUB_NO_LOAD:-}" ] || load=0
[ "$headless" -eq 1 ] || [ -z "${STUB_INTERACTIVE_NO_LOAD:-}" ] || load=0
if [ "$load" -eq 1 ]; then
  name=$("$REAL_JQ" -r .name "$dir/.claude-plugin/plugin.json")
  echo "[DEBUG] hooks module $name@inline loaded (worker); events: session.start" >>"$log"
  [ -z "${MOD_FORGE_MARKER:-}" ] || printf '%s' "${STUB_MARKER:-loaded}" >"$MOD_FORGE_MARKER"
fi
if [ -z "${STUB_NO_TYPES:-}" ]; then
  mkdir -p "$dir/.claude-plugin/types"
  echo '{}' >"$dir/.claude-plugin/types/tsconfig.json"
  echo '{}' >"$dir/tsconfig.json"
fi
if [ "$headless" -eq 1 ]; then
  echo '{"is_error":false,"total_cost_usd":0.001}'
  exit "${STUB_EXIT:-0}"
fi
STUB
  chmod +x "$tmp/bin/claude"
  cat >"$tmp/bin/jq" <<'WRAP'
#!/usr/bin/env bash
"$REAL_JQ" "$@" && rc=0 || rc=$?
[ -z "${STUB_RM_CWD:-}" ] || rm -rf "$PWD"
exit $rc
WRAP
  chmod +x "$tmp/bin/jq"
}
REAL_JQ=$(command -v jq)
export REAL_JQ
make_stub
export STUB_LOG="$tmp/stub.log"

new_cwd() { local d; d=$(mktemp -d "$tmp/cwd.XXXXXX"); echo "$d"; }
run() { # run CWD ENV... -- ARGS... ; sets $out and $rc
  local cwd=$1; shift
  local envs=()
  while [ "$1" != -- ]; do envs+=("$1"); shift; done; shift
  set +e
  out=$(cd "$cwd" && env "${envs[@]}" bash "$RUN_MOD" "$@" 2>&1)
  rc=$?
  set -e
}

# A tmux stand-in for the interactive stage: no terminal and no credentials.
# `new-session` runs the session command (the stub claude) in the background.
# `capture-pane` serves $STUB_TMUX_DIR/screens/N, where N is the number of
# send-keys calls so far (the highest file not above N), and fails once
# kill-server has run, as a gone session does. Every command it is sent is
# recorded in $STUB_TMUX_DIR/calls. `pipe-pane` feeds the command a stream with
# a truecolor background and a fake key.
make_tmux_stub() {
  mkdir -p "$tmp/tbin"
  cat >"$tmp/tbin/tmux" <<'TMUX'
#!/usr/bin/env bash
d=$STUB_TMUX_DIR
shift 4  # -L SOCKET -f /dev/null
echo "$*" >>"$d/calls"
case "$1" in
  display-message) echo "$d/modforge.sock" ;;
  kill-server) rm -f "$d/session" ;;
  new-session) : >"$d/session"; sh -c "${!#}" </dev/null >/dev/null 2>&1 & ;;
  pipe-pane) [ $# -le 3 ] || printf '\033[48;2;38;38;38mfill sk-ant-FAKEKEY123\033[0m\n' | sh -c "${!#}" ;;
  capture-pane)
    [ -f "$d/session" ] || exit 1
    k=$(grep -c '^send-keys' "$d/calls" || true)
    while [ "$k" -gt 0 ] && [ ! -f "$d/screens/$k" ]; do k=$((k - 1)); done
    case " $* " in *" -e "*) printf '\033[38;5;1m' ;; esac
    cat "$d/screens/$k" ;;
esac
exit 0
TMUX
  chmod +x "$tmp/tbin/tmux"
}
make_tmux_stub

# Fresh tmux stub state; the caller writes screens/N files.
new_tmux() {
  STUB_TMUX_DIR=$(mktemp -d "$tmp/tmux.XXXXXX")
  mkdir "$STUB_TMUX_DIR/screens"
  export STUB_TMUX_DIR
}
tmux_calls() { cat "$STUB_TMUX_DIR/calls" 2>/dev/null || true; }
# The tmux session is gone and kill-server was sent.
tmux_killed() { [ ! -e "$STUB_TMUX_DIR/session" ] && grep -q '^kill-server' "$STUB_TMUX_DIR/calls"; }
run_dir_of() { sed -n 's/^RESULT: .* run_dir=//p' <<<"$1"; }
has_escape() { grep -q "$(printf '\033')" "$1"; }

# A compiler stand-in: logs its arguments, fails with STUB_TSC_RC when set.
mkdir -p "$tmp/tscbin" "$tmp/bunxbin"
cat >"$tmp/tscbin/tsc" <<'TSC'
#!/usr/bin/env bash
echo "tsc $*" >>"$STUB_LOG"
[ "${STUB_TSC_RC:-0}" -eq 0 ] || { echo "mod/hooks/register.ts(7,11): error TS2322: Type 'string' is not assignable to type 'number'."; exit "$STUB_TSC_RC"; }
TSC
printf '#!/usr/bin/env bash\necho "bunx $*" >>"$STUB_LOG"\n' >"$tmp/bunxbin/bunx"
chmod +x "$tmp/tscbin/tsc" "$tmp/bunxbin/bunx"

# --- dangling module path: validation fails, later stages do not run -------

mod="$tmp/dangling"
cp -R "$FIXTURE" "$mod"
echo '{ "modules": ["./missing.ts"] }' >"$mod/hooks/hooks.json"
cwd=$(new_cwd)
run "$cwd" MOD_FORGE_HOME="$tmp/home1" -- "$mod"
check "dangling module: exit 1" test "$rc" -eq 1
check "dangling module: validate named as failed" contains "$out" "[validate] FAIL"
check "dangling module: test stage not run" lacks "$out" "[test]"

# --- run directory vanishes before a child starts ---------------------------

: >"$STUB_LOG"
cwd=$(new_cwd)
run "$cwd" CLAUDE_BIN="$tmp/bin/claude" PATH="$tmp/bin:$PATH" STUB_RM_CWD=1 MOD_FORGE_HOME="$tmp/home2" -- "$FIXTURE"
check "missing run dir: exit 2" test "$rc" -eq 2
check "missing run dir: says so" contains "$out" "cannot enter run directory"
check "missing run dir: test child never started" lacks "$(cat "$STUB_LOG")" "plugin test $FIXTURE"
check "missing run dir: caller cwd untouched" test -z "$(ls -A "$cwd")"

# --- preconditions name what is missing ------------------------------------

cwd=$(new_cwd)
run "$cwd" CLAUDE_BIN="$tmp/bin/claude" MOD_FORGE_HOME="$tmp/home3" ANTHROPIC_API_KEY= -- --stages headless "$FIXTURE"
check "no api key: exit 2" test "$rc" -eq 2
check "no api key: names ANTHROPIC_API_KEY" contains "$out" "ANTHROPIC_API_KEY"

# A PATH holding every system tool except tmux, wherever the host installs it.
notmux=$tmp/notmux
mkdir "$notmux"
for f in /usr/bin/* /bin/* "$(command -v jq)"; do
  [ -x "$f" ] && [ "${f##*/}" != tmux ] && ln -sf "$f" "$notmux/${f##*/}"
done
run "$cwd" CLAUDE_BIN="$tmp/bin/claude" MOD_FORGE_HOME="$tmp/home4" ANTHROPIC_API_KEY=x PATH="$tmp/bin:$notmux" -- --stages interactive "$FIXTURE"
check "no tmux: exit 2" test "$rc" -eq 2
check "no tmux: names tmux" contains "$out" "tmux"
check "no tmux: not reported as passed or skipped" lacks "$out" "PASS"

run "$cwd" CLAUDE_BIN="$tmp/bin/claude" STUB_VERSION=2.1.286 MOD_FORGE_HOME="$tmp/home5" -- "$FIXTURE"
check "old version: exit 2" test "$rc" -eq 2
check "old version: names the floor" contains "$out" "2.1.287"

# --- caller's repository stays clean ---------------------------------------

before=$(git -C "$REPO" status --short)
run "$REPO" MOD_FORGE_HOME="$tmp/home6" -- "$FIXTURE"
after=$(git -C "$REPO" status --short)
check "in-repo fixture run: exit 0" test "$rc" -eq 0
check "in-repo fixture run: git status unchanged" test "$before" = "$after"

# --- a relative MOD_FORGE_HOME is resolved once, so the config cache is reused ---

: >"$STUB_LOG"
cwd=$(new_cwd)
abs_cwd=$(cd "$cwd" && pwd -P)
for i in 1 2; do
  run "$cwd" CLAUDE_BIN="$tmp/bin/claude" ANTHROPIC_API_KEY=x MOD_FORGE_HOME=forge -- --stages headless "$FIXTURE"
done
check "relative home: second run exits 0" test "$rc" -eq 0
check "relative home: both runs get the same absolute config directory" \
  test "$(grep -c "^child cfg=$abs_cwd/forge/config headless=1" "$STUB_LOG")" -eq 2
check "relative home: first run onboards, second reuses the cache" \
  test "$(grep '^config ' "$STUB_LOG" | tr '\n' ,)" = "config onboarding,config cached,"

# --- the harness home is private --------------------------------------------

STUBS=(CLAUDE_BIN="$tmp/bin/claude" ANTHROPIC_API_KEY=x)

: >"$STUB_LOG"
cwd=$(new_cwd)
run "$cwd" "${STUBS[@]}" MOD_FORGE_HOME="$tmp/fresh/home" -- --stages validate "$FIXTURE"
check "fresh home: run passes" test "$rc" -eq 0
check "fresh home: created with mode 0700" test "$(ls -ld "$tmp/fresh/home" | cut -c1-10)" = "drwx------"

refuses() { # refuses NAME HOME REASON-TEXT
  : >"$STUB_LOG"
  run "$cwd" "${STUBS[@]}" MOD_FORGE_HOME="$2" -- --stages validate,headless "$FIXTURE"
  check "$1: exit 2" test "$rc" -eq 2
  check "$1: names the path" contains "$out" "$2"
  check "$1: says why" contains "$out" "$3"
  check "$1: no child started" lacks "$(cat "$STUB_LOG")" "plugin validate"
  check "$1: no headless child started" lacks "$(cat "$STUB_LOG")" "child cfg="
}

mkdir -m 0700 "$tmp/open755" "$tmp/open750" "$tmp/real700"
chmod 755 "$tmp/open755"
chmod 750 "$tmp/open750"
ln -s "$tmp/real700" "$tmp/link"
refuses "home 0755" "$tmp/open755" "drwxr-xr-x"
check "home 0755: tells how to fix it" contains "$out" "chmod 700 $tmp/open755"
check "home 0755: nothing written into it" test -z "$(ls -A "$tmp/open755")"
refuses "home 0750" "$tmp/open750" "drwxr-x---"
refuses "symlinked home" "$tmp/link" "symlink"
check "symlinked home: nothing written through the link" test -z "$(ls -A "$tmp/real700")"
if [ "$(id -u)" -ne 0 ]; then
  refuses "home owned by someone else" /usr "not owned by the current user"
fi

# --- headless: the child's exit status is part of the verdict ----------------

cwd=$(new_cwd)
run "$cwd" "${STUBS[@]}" MOD_FORGE_HOME="$tmp/home7" STUB_EXIT=9 -- --stages headless "$FIXTURE"
check "exit 9 after good evidence: exit 1" test "$rc" -eq 1
check "exit 9 after good evidence: headless named as failed" contains "$out" "[headless] FAIL"
check "exit 9 after good evidence: status named" contains "$out" "status 9"
check "exit 9 after good evidence: the status alone decided" lacks "$out" "did not finish cleanly"
run "$cwd" "${STUBS[@]}" MOD_FORGE_HOME="$tmp/home7" -- --stages headless "$FIXTURE"
check "exit 0 with the same evidence: passes" contains "$out" "[headless] PASS"

# --- interactive: proof of load ----------------------------------------------

IT=("${STUBS[@]}" PATH="$tmp/tbin:$tmp/bin:$PATH" MOD_FORGE_HOME="$tmp/ihome")

new_tmux
printf 'Welcome to claude code\n' >"$STUB_TMUX_DIR/screens/0"
run "$cwd" "${IT[@]}" STUB_NO_LOAD=1 -- --stages interactive --expect "claude code" --timeout 3 "$FIXTURE"
check "banner text, mod never loaded: exit 1" test "$rc" -eq 1
check "banner text, mod never loaded: interactive named as failed" contains "$out" "[interactive] FAIL"
check "banner text, mod never loaded: missing marker named" contains "$out" "did not write its marker file"
check "banner text, mod never loaded: missing load line named" contains "$out" "hooks module loop-probe@inline loaded"
check "banner text, mod never loaded: not reported as passed" lacks "$out" "PASS"
check "banner text, mod never loaded: tmux session killed" tmux_killed

new_tmux
printf 'Welcome to claude code\nloop-probe: loaded\n' >"$STUB_TMUX_DIR/screens/0"
run "$cwd" "${IT[@]}" -- --stages interactive --expect "loop-probe: loaded" --timeout 3 "$FIXTURE"
run_dir=$(run_dir_of "$out")
check "mod loaded and text shown: exit 0" test "$rc" -eq 0
check "mod loaded and text shown: stage passes" contains "$out" "[interactive] PASS"
check "mod loaded and text shown: marker written in this session" test "$(cat "$run_dir/interactive.marker")" = loaded
check "mod loaded and text shown: tmux session killed" tmux_killed
check "mod loaded and text shown: default size 120 by 40" contains "$(tmux_calls)" "new-session -d -s main -x 120 -y 40"
check "mod loaded and text shown: plain capture has the text" grep -Fq "loop-probe: loaded" "$run_dir/screen.txt"
check "mod loaded and text shown: plain capture has no escapes" test "$(has_escape "$run_dir/screen.txt" && echo yes || echo no)" = no
check "mod loaded and text shown: color capture has escapes and the text" \
  sh -c 'grep -q "$(printf "\033")" "$1" && grep -Fq "loop-probe: loaded" "$1"' _ "$run_dir/screen.ansi"
check "mod loaded and text shown: raw stream keeps the background escape" \
  grep -Fq "$(printf '\033[48;2;38;38;38m')" "$run_dir/stream.raw"
check "mod loaded and text shown: raw stream is masked" \
  sh -c 'grep -Fq "sk-***" "$1" && ! grep -Fq FAKEKEY123 "$1"' _ "$run_dir/stream.raw"
check "mod loaded and text shown: no unmasked stream left behind" test ! -e "$run_dir/stream.raw.tmp"
check "mod loaded and text shown: source folder untouched" test ! -e "$FIXTURE/tsconfig.json"

# Headless evidence from the same run is not proof that the interactive
# session loaded the mod.
new_tmux
printf 'Welcome to claude code\nloop-probe: loaded\n' >"$STUB_TMUX_DIR/screens/0"
run "$cwd" "${IT[@]}" STUB_INTERACTIVE_NO_LOAD=1 -- --stages headless,interactive --expect "loop-probe: loaded" --timeout 3 "$FIXTURE"
check "headless evidence does not stand in for interactive: headless passes" contains "$out" "[headless] PASS"
check "headless evidence does not stand in for interactive: interactive fails" contains "$out" "[interactive] FAIL"
check "headless evidence does not stand in for interactive: marker named" contains "$out" "did not write its marker file"

# --- interactive: terminal size ------------------------------------------------

new_tmux
printf 'loop-probe: loaded\n' >"$STUB_TMUX_DIR/screens/0"
run "$cwd" "${IT[@]}" -- --stages interactive --expect "loop-probe: loaded" --cols 160 --rows 50 "$FIXTURE"
check "size: run passes" test "$rc" -eq 0
check "size: session created at 160 by 50" contains "$(tmux_calls)" "new-session -d -s main -x 160 -y 50"
run "$cwd" "${IT[@]}" -- --stages interactive --expect "loop-probe: loaded" --cols wide "$FIXTURE"
check "size: a non-number is refused" test "$rc" -eq 2

# --- interactive: scripted input ------------------------------------------------

cat >"$tmp/pane.script" <<'SCRIPT'
# open the pane and move the cursor
type /prs
key Enter
expect PR PANE
key Down
expect > beta
SCRIPT
new_tmux
printf 'loop-probe: loaded\n' >"$STUB_TMUX_DIR/screens/0"
printf 'PR PANE\n> alpha\n  beta\n' >"$STUB_TMUX_DIR/screens/2"
printf 'PR PANE\n  alpha\n> beta\n' >"$STUB_TMUX_DIR/screens/3"
run "$cwd" "${IT[@]}" -- --stages interactive --expect "loop-probe: loaded" --script "$tmp/pane.script" --timeout 3 "$FIXTURE"
run_dir=$(run_dir_of "$out")
check "script: exit 0" test "$rc" -eq 0
check "script: typed text sent literally" contains "$(tmux_calls)" "send-keys -t main -l -- /prs"
check "script: keys sent by name" contains "$(tmux_calls)" "send-keys -t main Enter"
check "script: Down sent" contains "$(tmux_calls)" "send-keys -t main Down"
check "script: one capture per step" test "$(ls "$run_dir" | grep -c '^screen-0[1-5]\.txt$')" -eq 5
check "script: capture before the pane opens has no pane" lacks "$(cat "$run_dir/screen-01.txt")" "PR PANE"
check "script: capture after Enter shows the pane" contains "$(cat "$run_dir/screen-03.txt")" "PR PANE"
check "script: capture after Down shows the cursor moved" contains "$(cat "$run_dir/screen-05.txt")" "> beta"
check "script: tmux session killed" tmux_killed

cat >"$tmp/missing.script" <<'SCRIPT'
key Down
expect text the mod never draws
SCRIPT
new_tmux
printf 'loop-probe: loaded\n' >"$STUB_TMUX_DIR/screens/0"
started=$SECONDS
run "$cwd" "${IT[@]}" -- --stages interactive --expect "loop-probe: loaded" --script "$tmp/missing.script" --timeout 2 "$FIXTURE"
elapsed=$((SECONDS - started))
run_dir=$(run_dir_of "$out")
check "script step never appears: exit 1" test "$rc" -eq 1
check "script step never appears: second step named" contains "$out" "step 02"
check "script step never appears: missing text named" contains "$out" "text the mod never draws"
check "script step never appears: not reported as passed" lacks "$out" "PASS"
check "script step never appears: stops within the time bound" test "$elapsed" -le 10
check "script step never appears: captures up to the step saved" test -f "$run_dir/screen-01.txt" -a -f "$run_dir/screen-02.txt"
check "script step never appears: tmux session killed" tmux_killed

run "$cwd" "${IT[@]}" -- --stages interactive --script "$tmp/pane.script" "$FIXTURE"
check "script without --expect: refused with exit 2" test "$rc" -eq 2
check "script without --expect: names --expect" contains "$out" "--expect"
run "$cwd" "${IT[@]}" -- --stages validate --expect x --script "$tmp/pane.script" "$FIXTURE"
check "script without the interactive stage: refused, not skipped" test "$rc" -eq 2
printf 'tpye /prs\n' >"$tmp/bad.script"
run "$cwd" "${IT[@]}" -- --stages interactive --expect x --script "$tmp/bad.script" "$FIXTURE"
check "script with an unknown step: refused naming the line" test "$rc" -eq 2
check "script with an unknown step: names the step" contains "$out" "tpye"

# --- typecheck ---------------------------------------------------------------

# A notsc PATH holds every system tool except a compiler runner.
notsc=$tmp/notsc
mkdir "$notsc"
for f in /usr/bin/* /bin/* "$(command -v jq)"; do
  case ${f##*/} in tsc|bunx|npx) continue ;; esac
  [ -x "$f" ] && ln -sf "$f" "$notsc/${f##*/}"
done

tcmod=$tmp/tcmod
cp -R "$FIXTURE" "$tcmod"
TC=("${STUBS[@]}" PATH="$tmp/tscbin:$tmp/bin:$PATH" MOD_FORGE_HOME="$tmp/thome")

: >"$STUB_LOG"
run "$cwd" "${TC[@]}" -- --stages headless,typecheck "$tcmod"
run_dir=$(run_dir_of "$out")
check "typecheck: clean mod passes" contains "$out" "[typecheck] PASS"
check "typecheck: compiles the run copy" contains "$(cat "$STUB_LOG")" "tsc -p $run_dir/mod --noEmit"
check "typecheck: source folder gets no tsconfig.json" test ! -e "$tcmod/tsconfig.json"
check "typecheck: compiler output is the evidence" test -f "$run_dir/typecheck.log"

: >"$STUB_LOG"
new_tmux
run "$cwd" "${TC[@]}" PATH="$tmp/tbin:$tmp/tscbin:$tmp/bin:$PATH" STUB_TSC_RC=2 -- --stages headless,typecheck,interactive --expect x "$tcmod"
check "typecheck fails after headless passes: exit 1" test "$rc" -eq 1
check "typecheck fails after headless passes: headless passed" contains "$out" "[headless] PASS"
check "typecheck fails after headless passes: typecheck named as failed" contains "$out" "[typecheck] FAIL"
check "typecheck fails after headless passes: diagnostic shown" contains "$out" "TS2322"
check "typecheck fails after headless passes: no interactive stage" lacks "$out" "[interactive]"
check "typecheck fails after headless passes: no tmux session started" lacks "$(tmux_calls)" "new-session"

: >"$STUB_LOG"
run "$cwd" "${TC[@]}" ANTHROPIC_API_KEY= -- --stages typecheck "$tcmod"
check "typecheck alone: exit 1" test "$rc" -eq 1
check "typecheck alone: names the missing declarations" contains "$out" "declarations are missing"
check "typecheck alone: compiler not run" lacks "$(cat "$STUB_LOG")" "tsc -p"

# Declarations left in the source by an earlier session are not proof that the
# engine wrote them in this run.
stale=$tmp/stale
cp -R "$FIXTURE" "$stale"
mkdir -p "$stale/.claude-plugin/types"
echo '{}' >"$stale/.claude-plugin/types/tsconfig.json"
echo '{}' >"$stale/tsconfig.json"
: >"$STUB_LOG"
run "$cwd" "${TC[@]}" STUB_NO_TYPES=1 -- --stages headless,typecheck "$stale"
check "typecheck: stale source declarations do not count" contains "$out" "declarations are missing"
check "typecheck: stale source declarations, compiler not run" lacks "$(cat "$STUB_LOG")" "tsc -p"

: >"$STUB_LOG"
run "$cwd" "${STUBS[@]}" PATH="$tmp/bin:$notsc" MOD_FORGE_HOME="$tmp/thome" -- --stages headless,typecheck "$tcmod"
check "no compiler: exit 2" test "$rc" -eq 2
check "no compiler: names the compiler" contains "$out" "TypeScript compiler"
check "no compiler: not reported as passed or skipped" lacks "$out" "PASS"
check "no compiler: no child started" lacks "$(cat "$STUB_LOG")" "child cfg="

: >"$STUB_LOG"
run "$cwd" "${STUBS[@]}" PATH="$tmp/bunxbin:$tmp/bin:$notsc" MOD_FORGE_HOME="$tmp/thome" -- --stages headless,typecheck "$tcmod"
check "compiler discovery: bunx is used when tsc is absent" contains "$(cat "$STUB_LOG")" "bunx tsc -p"

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all checks passed"
