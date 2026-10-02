#!/usr/bin/env bash
# Live tests for scripts/run-mod.sh. They start real `claude` children, make
# model calls on the harness's default small model, and need ANTHROPIC_API_KEY.
# Run with `bash plugins/mod-forge/tests/live.test.sh`; not part of CI.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PLUGIN=$(cd "$SCRIPT_DIR/.." && pwd -P)
REPO=$(cd "$PLUGIN/../.." && pwd -P)
RUN_MOD="$PLUGIN/scripts/run-mod.sh"
FIXTURE="$PLUGIN/skills/build-claude-mod/fixtures/loop-probe"

# shellcheck source=../scripts/isolation.sh
. "$PLUGIN/scripts/isolation.sh"

[ -n "${ANTHROPIC_API_KEY:-}" ] || { echo "live tests need ANTHROPIC_API_KEY" >&2; exit 2; }

tmp=$(mktemp -d "${TMPDIR:-/tmp}/mod-forge.live.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

failures=0
check() {
  local name=$1; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; failures=$((failures + 1)); fi
}
contains() { grep -Fq -- "$2" <<<"$1"; }
lacks() { ! grep -Fq -- "$2" <<<"$1"; }

# Every path and file hash under a directory, so a stray generated file shows.
snapshot() { (cd "$1" && find . | sort && find . -type f -print0 | sort -z | xargs -0 shasum); }

export MOD_FORGE_HOME="$tmp/home"

# --- headless: a well-formed mod passes and the source folder is untouched ---

before_snapshot=$(snapshot "$FIXTURE")
before_status=$(git -C "$REPO" status --short)
set +e
out=$(cd "$tmp" && bash "$RUN_MOD" --stages validate,test,headless,typecheck "$FIXTURE" 2>&1)
rc=$?
set -e
echo "$out" | sed 's/^/  | /'
run_dir=$(sed -n 's/^RESULT: .* run_dir=//p' <<<"$out")

check "headless: exit 0" test "$rc" -eq 0
check "headless: stage reported passed" contains "$out" "[headless] PASS"
check "headless: cost printed" contains "$out" "[headless] cost: \$"
check "typecheck: engine-written declarations pass the compiler" contains "$out" "[typecheck] PASS"
check "headless: marker written by the mod" test "$(cat "$run_dir/marker")" = "loaded"
check "headless: debug log lists the mod's module and event" \
  grep -Eq "hooks module loop-probe@inline loaded .*events: session.start" "$run_dir/debug.log"
check "headless: engine-written files landed in the copy" test -f "$run_dir/mod/tsconfig.json"
check "headless: source folder byte-identical" test "$before_snapshot" = "$(snapshot "$FIXTURE")"
check "headless: repository status unchanged" test "$before_status" = "$(git -C "$REPO" status --short)"

# --- headless: a mod that throws at import fails the stage ------------------

broken="$tmp/broken"
cp -R "$FIXTURE" "$broken"
printf "throw new Error('boom at import')\n%s" "$(cat "$broken/hooks/register.ts")" >"$broken/hooks/register.ts"
set +e
out=$(cd "$tmp" && bash "$RUN_MOD" --stages headless "$broken" 2>&1)
rc=$?
set -e
echo "$out" | sed 's/^/  | /'
broken_run=$(sed -n 's/^RESULT: .* run_dir=//p' <<<"$out")

check "import failure: exit 1" test "$rc" -eq 1
check "import failure: headless named as failed" contains "$out" "[headless] FAIL"
check "import failure: no marker" test ! -e "$broken_run/marker"
check "import failure: a load-failure log line is printed" contains "$out" "log: "

# --- typecheck: a mod whose only defect is a type error ---------------------
# It runs, so validation, tests and headless accept it; only the compiler objects.

TYPE_ERROR="$PLUGIN/skills/build-claude-mod/fixtures/type-error"
before_type_error=$(snapshot "$TYPE_ERROR")
set +e
out=$(cd "$tmp" && bash "$RUN_MOD" --stages validate,test,headless,typecheck,interactive --expect "type-error-probe" "$TYPE_ERROR" 2>&1)
rc=$?
set -e
echo "$out" | sed 's/^/  | /'

check "type error: exit 1" test "$rc" -eq 1
check "type error: validate passes" contains "$out" "[validate] PASS"
check "type error: tests pass" contains "$out" "[test] PASS"
check "type error: headless passes" contains "$out" "[headless] PASS"
check "type error: typecheck named as failed" contains "$out" "[typecheck] FAIL"
check "type error: the compiler names the defect" contains "$out" "TS2322"
check "type error: no interactive stage after the failure" lacks "$out" "[interactive]"
check "type error: source folder byte-identical" test "$before_type_error" = "$(snapshot "$TYPE_ERROR")"

# --- interactive: status line on screen, wrong text fails fast, no leftovers --

tmux_sockets() { ls "${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)" 2>/dev/null | grep -c '^modforge-' || true; }
sockets_before=$(tmux_sockets)

set +e
out=$(cd "$tmp" && bash "$RUN_MOD" --stages interactive --expect "loop-probe: loaded" "$FIXTURE" 2>&1)
rc=$?
set -e
echo "$out" | sed 's/^/  | /'
screen_run=$(sed -n 's/^RESULT: .* run_dir=//p' <<<"$out")
check "interactive: exit 0" test "$rc" -eq 0
check "interactive: stage reported passed" contains "$out" "[interactive] PASS"
check "interactive: capture holds the status text" grep -Fq "loop-probe: loaded" "$screen_run/screen.txt"
check "interactive: no key material in the saved capture" test "$(grep -Ec 'sk-[A-Za-z0-9]' "$screen_run/screen.txt" || true)" = 0
check "interactive: source folder still byte-identical" test "$before_snapshot" = "$(snapshot "$FIXTURE")"
check "interactive: marker written by this session" test "$(cat "$screen_run/interactive.marker")" = "loaded"
check "interactive: color capture saved with escapes" sh -c 'grep -q "$(printf "\033")" "$1"' _ "$screen_run/screen.ansi"
check "interactive: raw stream saved" test -s "$screen_run/stream.raw"
check "interactive: no key material in the raw stream" test "$(LC_ALL=C grep -Ec 'sk-[A-Za-z0-9]' "$screen_run/stream.raw" || true)" = 0

# A script drives the real prompt: typed text shows up in the input box.
printf 'type zzprobe\nexpect zzprobe\n' >"$tmp/echo.script"
set +e
out=$(cd "$tmp" && bash "$RUN_MOD" --stages interactive --expect "loop-probe: loaded" --script "$tmp/echo.script" "$FIXTURE" 2>&1)
rc=$?
set -e
echo "$out" | sed 's/^/  | /'
script_run=$(sed -n 's/^RESULT: .* run_dir=//p' <<<"$out")
check "script: exit 0" test "$rc" -eq 0
check "script: a capture per step" test -f "$script_run/screen-01.txt" -a -f "$script_run/screen-02.txt"
check "script: typed text reached the prompt" grep -Fq zzprobe "$script_run/screen-02.txt"

started=$SECONDS
set +e
out=$(cd "$tmp" && bash "$RUN_MOD" --stages interactive --expect "text that never appears" --timeout 10 "$FIXTURE" 2>&1)
rc=$?
set -e
elapsed=$((SECONDS - started))
echo "$out" | sed 's/^/  | /'
wrong_run=$(sed -n 's/^RESULT: .* run_dir=//p' <<<"$out")
check "wrong text: exit 1" test "$rc" -eq 1
check "wrong text: fails within the time bound plus startup" test "$elapsed" -le 30
check "wrong text: names the missing text" contains "$out" "text that never appears"
check "wrong text: last capture saved" test -s "$wrong_run/screen.txt"

# A terminated harness takes its tmux server with it.
bash "$RUN_MOD" --stages interactive --expect "text that never appears" --timeout 60 "$FIXTURE" >/dev/null 2>&1 &
pid=$!
sleep 6
kill -TERM "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true
check "no leftover tmux server after success, failure, and termination" test "$(tmux_sockets)" = "$sockets_before"

# --- stream.raw replays: a terminal emulator reproduces the cell background --
# The child is a stand-in that draws one truecolor cell and loads like a mod, so
# the check does not depend on what the engine draws. It runs under real tmux.

emu="$tmp/emu"
mkdir -p "$emu"
(cd "$emu" && bun add @xterm/headless >/dev/null 2>&1) || true
cat >"$emu/replay.cjs" <<'REPLAY'
const { Terminal } = require('@xterm/headless')
const fs = require('fs')
const [file, cols, rows] = process.argv.slice(2)
const term = new Terminal({ cols: Number(cols), rows: Number(rows), allowProposedApi: true })
term.write(fs.readFileSync(file), () => {
  const cell = term.buffer.active.getLine(0).getCell(0)
  console.log(JSON.stringify({ rgb: cell.isBgRGB(), bg: cell.getBgColor().toString(16) }))
})
REPLAY
cat >"$tmp/fake-claude" <<'FAKE'
#!/usr/bin/env bash
case "$1" in
  --version) echo "99.0.0 (Claude Code)"; exit 0 ;;
  plugin) exit 0 ;;
esac
prev=
for a in "$@"; do
  case $prev in --debug-file) log=$a ;; --plugin-dir) dir=$a ;; esac
  prev=$a
done
echo "hooks module $(jq -r .name "$dir/.claude-plugin/plugin.json")@inline loaded" >>"$log"
printf loaded >"$MOD_FORGE_MARKER"
# What a color-choosing child would see in tmux, for the log of this run.
echo "TERM=$TERM COLORTERM=${COLORTERM:-}" >"$(dirname "$MOD_FORGE_MARKER")/child.env"
printf '\033[2J\033[H\033[48;2;38;38;38m  REPLAYCELL  \033[0m\n'
sleep 60
FAKE
chmod +x "$tmp/fake-claude"

set +e
out=$(cd "$tmp" && CLAUDE_BIN="$tmp/fake-claude" bash "$RUN_MOD" --stages interactive --expect REPLAYCELL --timeout 20 "$FIXTURE" 2>&1)
rc=$?
set -e
echo "$out" | sed 's/^/  | /'
replay_run=$(sed -n 's/^RESULT: .* run_dir=//p' <<<"$out")
echo "  | child environment under tmux: $(cat "$replay_run/child.env" 2>/dev/null)"
check "replay: stand-in child run passes" test "$rc" -eq 0
check "replay: a terminal emulator is installed (bun add @xterm/headless)" test -d "$emu/node_modules/@xterm/headless"
cell=$(cd "$emu" && bun run replay.cjs "$replay_run/stream.raw" 120 40 2>&1 || true)
check "replay: stream.raw reproduces the drawn cell background (#262626)" contains "$cell" '"rgb":true,"bg":"262626"'
check "replay: screen.ansi keeps the color escape" sh -c 'grep -q "$(printf "\033")" "$1"' _ "$replay_run/screen.ansi"
check "replay: screen.txt has the text and no escapes" sh -c '! grep -q "$(printf "\033")" "$1" && grep -Fq REPLAYCELL "$1"' _ "$replay_run/screen.txt"

# --- isolation detector: clean logs pass, leaking logs are caught -----------

real_cfg=/home/someone/.claude
real_json=/home/someone/.claude.json
clean=$(isolation_violations "$run_dir/debug.log" "$real_cfg" "$real_json" "$run_dir" loop-probe)
check "isolation: the isolated run's log is clean" test -z "$clean"

leaky="$tmp/leaky.log"
cat >"$leaky" <<LOG
[DEBUG] Reading installed plugins from $real_cfg/plugins/installed_plugins.json
[DEBUG] Loading config from $real_json
[DEBUG] hooks module somebody-elses-plugin@user loaded (worker); events: session.start
[DEBUG] hooks module loop-probe@inline loaded (worker); events: session.start
[DEBUG] hooks module cc-plugin-telemetry@builtin loaded (native); events: session.start
LOG
found=$(isolation_violations "$leaky" "$real_cfg" "$real_json" "$run_dir" loop-probe)
check "isolation: real config directory in a log is caught" contains "$found" "real config directory"
check "isolation: real config file in a log is caught" contains "$found" "real config file"
check "isolation: foreign hook module is caught" contains "$found" "somebody-elses-plugin@user"
check "isolation: the mod and builtin modules are allowed" lacks "$found" "cc-plugin-telemetry"

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all checks passed"
