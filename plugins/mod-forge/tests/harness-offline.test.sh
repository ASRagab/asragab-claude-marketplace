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
make_stub() {
  mkdir -p "$tmp/bin"
  cat >"$tmp/bin/claude" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_LOG"
case "$1" in
  --version) echo "${STUB_VERSION:-2.1.287} (Claude Code)" ;;
  plugin)
    case "$2" in
      test) [ "${3:-}" = --help ] && exit 0; echo " 1 pass" ;;
      validate) echo '{"success":true}' ;;
    esac ;;
esac
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

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all checks passed"
