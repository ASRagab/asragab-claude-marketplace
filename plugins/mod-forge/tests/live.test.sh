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
out=$(cd "$tmp" && bash "$RUN_MOD" --stages validate,test,headless "$FIXTURE" 2>&1)
rc=$?
set -e
echo "$out" | sed 's/^/  | /'
run_dir=$(sed -n 's/^RESULT: .* run_dir=//p' <<<"$out")

check "headless: exit 0" test "$rc" -eq 0
check "headless: stage reported passed" contains "$out" "[headless] PASS"
check "headless: cost printed" contains "$out" "[headless] cost: \$"
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
