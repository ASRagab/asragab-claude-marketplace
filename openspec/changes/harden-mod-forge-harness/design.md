# Design

## Context

See proposal.md for motivation and `postmortem.md` in this change for the session evidence behind the additions. The harness is `plugins/mod-forge/scripts/run-mod.sh` (302 lines, `set -euo pipefail`) with helpers in `scripts/isolation.sh`. As merged in this repository:

- The harness home defaults to `${MOD_FORGE_HOME:-${TMPDIR:-/tmp}/mod-forge}` and is never resolved to an absolute path. `CONFIG_CACHE=$FORGE_HOME/config` is used after a stage has changed into the run directory.
- The headless child runs with `|| true`; the verdict comes from `is_error`, the module-load log line, and the marker file.
- The interactive child is started with `MOD_FORGE_MARKER` and `--debug-file`, but the stage only greps the screen for `--expect`; neither the marker nor the log is read.
- Live stages load a copy of the mod at `$RUN_DIR/mod`. The engine writes declarations and a `tsconfig.json` into that copy at load, which is the only place a project type check can run.
- Offline tests (`tests/harness-offline.test.sh`, run by `bun run test:mod-forge`) drive the harness with a stub `claude` and a jq wrapper and need neither credentials nor `tmux`; live tests start real children.

## Goals / Non-Goals

**Goals:**
- Close the four review findings with the smallest changes that make each verdict true.
- Make "all stages passed" mean the mod type-checks, loaded in the interactive session, and, when asked, that a keyboard-driven element was drawn and exercised.
- Keep color evidence so a claim about background or foreground color can be checked.

**Non-Goals:**
- Settings or theme passthrough. One attempt to run under the user's theme showed no difference, but the attempt used a quoted `--settings` value through a wrapper script and is not trustworthy. Revisit with evidence.
- A terminal-emulator analysis tool in the plugin. The plugin saves the evidence; replaying it is the caller's job.
- Driving the `Client` element or desktop and VS Code surfaces.
- Changing the stage defaults: `--stages` still defaults to `validate,test`.

## Decisions

**Interactive proof of load reuses the headless checks.** Factor the marker and module-load log checks out of `stage_headless` into one function and call it from both stages. The marker env var and debug file are already passed to the interactive child, so no new plumbing is needed. Alternative: require a second `--expect` that only the mod can print. Rejected because it pushes the burden to every caller and still lets a stale string pass.

**Headless records the exit status.** Replace `|| true` with `rc=0; ... || rc=$?` and add a problem line when `rc` is not zero. The JSON and marker checks stay, since they say why a run failed; the exit status decides whether a run with otherwise good evidence passes.

**Resolve the home once, before anything changes directory.** At argument handling time, create the home (`mkdir -m 0700 -p`) and replace it with `cd "$home" && pwd -P`. A relative `MOD_FORGE_HOME` therefore means "relative to where the harness was invoked", and every derived path is absolute. This also normalizes `/var` to `/private/var` on macOS, so evidence paths stop alternating between the two forms.

**Keep the default home, verify it.** The security finding is that a predictable path under a shared temp directory can be pre-created by another user. The check is: the path is not a symlink (`[ -L ]`), is a directory owned by the effective user (`[ -O ]`), and `find "$home" -maxdepth 0 -perm -077` prints nothing. Failure aborts before any live stage and prints the `chmod 700` fix. This makes the shared-`/tmp` case safe (a planted directory is refused) without changing the documented default or the skill text. Alternative: default to `${XDG_CACHE_HOME:-$HOME/.cache}/mod-forge` as the bot suggested. It also removes the denial-of-service case, but it changes documented paths in the skill, the README, and agents' habits. Listed under Open Questions. The portable `[ -O ]` and `find -perm` forms are used because `stat` flags differ between macOS and Linux.

**Type check is its own stage after headless.** The engine writes the declarations only when it loads the mod, so the check has to follow a live stage in the same run. Running it before the interactive stage means a type error stops the run before the slower, tmux-based stage. Invocation: `tsc -p "$MOD_COPY" --noEmit`, with `tsc` found on the path, else `bunx tsc`, else `npx --no-install tsc`; none available is a precondition failure naming the compiler. A missing `$MOD_COPY/.claude-plugin/types` fails with a message that a live stage must run first. In the pr-pane session this check found real defects that validation, tests, headless, and interactive all passed: a `Select` used on a surface that has none, unguarded indexing, and a test using a global that the module environment does not define.

**Interactive scripts are a small line format.** `--script FILE`, one step per line: `type TEXT` (literal text, `send-keys -l`), `key NAME...` (tmux key names such as `Enter`, `Down`), and `expect TEXT` (wait for text within the stage time bound). `--expect` stays as the readiness signal, so steps start only after the child has loaded and drawn; a script without `--expect` is refused. After each step the harness writes `screen-NN.txt`. The first failing `expect` fails the stage and names the step number and text. Alternative: `--send "KEYS"` flags. Rejected because a pane test needs typed text, waits, and several keys in sequence, which flags express poorly. Scripts that press Enter on a row can have real side effects, such as opening a browser; that is the script author's responsibility and is stated in the skill.

**Color evidence is saved, not analyzed.** In the pr-pane session the plain tmux capture and a 256-color capture showed no fill on the pane body, while replaying the raw bytes of a run on a bare pty through a terminal emulator showed the engine painting the whole docked pane with `#262626`. The reason tmux's capture differed is not established. The stage therefore saves three artifacts: `screen.txt` (masked, as now), `screen.ansi` (`capture-pane -e`), and `stream.raw` (`tmux pipe-pane` of the child's output, passed through the same secret mask). Whether `stream.raw` preserves what a bare pty receives is the assumption this design depends on; the task list verifies it by replaying the stream through an emulator in a test, and if it does not hold the fallback is to run the interactive child on a harness-owned pty instead of tmux. Alternative: always use a pty and drop tmux. Rejected for now because tmux already handles first-run prompts and key sending.

**Size options.** `--cols` and `--rows` (defaults 120 and 40) feed `new-session -x -y`. This matters because a pane opened without a person's input is only drawn from 144 columns; a command-driven open is drawn at any width.

## Risks / Trade-offs

- [The home permission check turns an existing `0755` home into a hard failure] → The message names the path and prints `chmod 700 <path>`; called out as **BREAKING** in the proposal.
- [Reviewers may judge the shared-temp risk acceptable] → It is included because a planted config directory runs with the caller's API key on a shared host. If the risk is accepted, drop the "private home" requirement and its tasks; nothing else depends on it.
- [`stream.raw` may not reproduce truecolor fills] → Verified by test before the requirement is relied on; fallback described above.
- [First `bunx tsc` may need the network] → It is a named precondition, not a silent skip, and offline tests use a stub compiler.
- [Scripted steps can hang on a wrong `expect`] → Every `expect` shares the stage time bound and the tmux session is killed on every exit path, as today.
- [The offline test must keep working without `tmux`, per the `mod-forge-plugin` spec] → New interactive cases use a stub `tmux` that serves canned screens and records the keys it is sent, next to the existing stub `claude`; checks that need real terminal behavior, such as replaying `stream.raw` through an emulator, live in `tests/live.test.sh`.

## Open Questions

- Should the default harness home move to a per-user cache directory (`$XDG_CACHE_HOME` or `~/.cache/mod-forge`) in a follow-up? It does not change the specs here.
