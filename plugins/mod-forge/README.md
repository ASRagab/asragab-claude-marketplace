# mod-forge

Build and verify Claude Code mods without touching the session you are working in.

**Claude Code only.** Mods exist only in Claude Code 2.1.287 and later. This plugin is not published for Cursor or Codex.

A mod is a plugin whose `hooks/hooks.json` is `{ "modules": ["./register.ts"] }`. When you ask an agent to build one, the `build-claude-mod` skill sends the agent through a harness that runs the mod in separate processes, with their own config directory, and reports evidence the agent can read itself.

## Requirements

- Claude Code >= 2.1.287 (`claude plugin test` must exist)
- `jq`
- For live stages: `ANTHROPIC_API_KEY` and, for the interactive stage, `tmux`
- For the `typecheck` stage: a TypeScript compiler as `tsc` on the path, or reachable through `bunx` or `npx`

A missing requirement fails the run and names it. No stage is skipped silently.

## Stages

`scripts/run-mod.sh [--stages validate,test,headless,typecheck,interactive] [--expect TEXT] [--script FILE] [--cols N] [--rows N] [--model MODEL] MOD_DIR`

Stages run in the order below and stop at the first failure. Each writes evidence into a per-run directory under `${MOD_FORGE_HOME:-${TMPDIR:-/tmp}/mod-forge}/runs/`.

| Stage | Command | Needs credentials | Evidence |
| --- | --- | --- | --- |
| `validate` | `claude plugin validate --json` | no | `validate.json` |
| `test` | `claude plugin test` (fails if zero tests ran) | no | `test.log` |
| `headless` | `claude -p` on a copy of the mod | yes | `debug.log`, `marker`, `headless.json` |
| `typecheck` | `tsc -p` on the copy of the mod (needs `headless` earlier in the same run) | no | `typecheck.log` |
| `interactive` | `claude` in a detached tmux session on the copy of the mod | yes | `screen.txt`, `screen.ansi`, `stream.raw`, `screen-NN.txt` (with `--script`), `interactive.marker`, `interactive.debug.log` |

`--stages` defaults to `validate,test`.

### Harness home

`MOD_FORGE_HOME` is resolved to an absolute path, relative to the directory the harness was invoked from, before any stage runs, so the config cache is reused between runs.

The home is created with mode `0700`. The harness uses an existing home only if it is a real directory owned by the current user with no group or other permissions. A home that is a symlink, belongs to another user, or has any group or other permission bit set is refused with exit code `2` before any stage runs, validate and test included, because the run directory lives in the home. The message gives the path, the reason, and the fix:

```bash
chmod 700 "${MOD_FORGE_HOME:-${TMPDIR:-/tmp}/mod-forge}"
```

Every child process starts inside the run directory, and every path handed to a child is absolute.

### Headless stage

The child runs `claude -p --model haiku --plugin-dir <copy> --strict-mcp-config --debug-file <run>/debug.log --output-format json` with `CLAUDE_CONFIG_DIR` pointing at a harness-owned directory (`${MOD_FORGE_HOME}/config`, kept between runs) and `MOD_FORGE_MARKER` pointing at a file in the run directory. A mod proves it loaded by writing that file from its `session.start` hook:

```ts
const marker = await $.env.get('MOD_FORGE_MARKER')
if (marker) await $.fs.write(marker, 'loaded')
```

The write is a no-op when the variable is unset, so it is safe to leave in a mod that ships. The stage passes when all of these hold:

- the child finished without error (the reported cost is printed) and exited with status 0; a non-zero status fails the stage with `the child exited with status N`, whatever evidence the child produced,
- the debug log has a `hooks module <name>@inline loaded` line,
- the marker file holds the expected text (`--marker-text`, default `loaded`),
- the isolation checks find nothing: the debug log never names your real `~/.claude` or `~/.claude.json`, no hook module loads from outside the mod, and your real config holds no transcript directory or project record for the run directory.

The model's reply is never evidence. The live stages run a copy of the mod because Claude Code writes `.claude-plugin/types/` and a `tsconfig.json` into any folder it loads with `--plugin-dir`.

### Type check stage

`--stages headless,typecheck` runs `tsc -p <run>/mod --noEmit` over the run copy of the mod, using the declarations and `tsconfig.json` the engine writes into it when the headless stage loads the mod; its output is saved as `typecheck.log`. The compiler is `tsc` on the path, else `bunx tsc`, else `npx --no-install tsc`. The stage fails on any diagnostic. It is never skipped:

- Without `headless` earlier in the same run (for example `--stages typecheck,interactive`), it fails because the engine-written declarations are missing from the copy. Declarations left in your mod directory by an earlier session are not copied, so they never stand in for them.
- With no compiler available, the harness exits `2` as a missing precondition before any child starts.

### Interactive stage

`--stages interactive --expect TEXT` starts `claude` on the same mod copy in a detached tmux session under the same harness-owned config directory, answers the first-run prompts by matching their text, and waits up to `--timeout` seconds (default 60) for `TEXT` to appear on the screen. `--cols` and `--rows` set the terminal size (default 120 and 40). `--timeout` bounds each wait on its own: the wait for `--expect` and every `expect` step. Status text appears with the plugin name in front, for example `⚠ loop-probe: loop-probe: loaded`, so match on the part your mod sets.

The stage passes only when `TEXT` is on the screen, the mod wrote its marker file with the expected text, and the debug log has the `hooks module <name>@inline loaded` line. This session writes its own `interactive.marker` and `interactive.debug.log`, separate from the headless files, so headless evidence never counts here. The startup banner can appear before the mod loads, so after `TEXT` appears the stage polls for this proof for up to 5 seconds. A mod that throws at import fails even when `TEXT` appears in the startup banner, and the failure names the missing evidence.

Evidence saved in the run directory, each with anything shaped like an API key masked:

- `screen.txt`: the final capture as plain text.
- `screen.ansi`: the final capture with color escape sequences.
- `stream.raw`: the child's raw terminal output stream, recorded from the child's first byte.

Plain text carries no color. A claim about a background or foreground color rests on `screen.ansi` or `stream.raw`.

#### Scripted input

`--script FILE` drives the session after `--expect` has appeared, which serves as the readiness step. A script without `--expect`, or without the interactive stage in `--stages`, exits `2`. One step per line; blank lines and lines starting with `#` are ignored:

| Step | Effect |
| --- | --- |
| `type TEXT` | send `TEXT` literally |
| `key NAME...` | send tmux key names, for example `Enter` or `Down` |
| `expect TEXT` | wait up to `--timeout` seconds for `TEXT` on the screen |

```text
type /<command that opens the pane>
key Enter
expect <pane header text>
key Down
expect <pane header text>
```

After each step the stage saves `screen-NN.txt`. The first `expect` that does not appear fails the stage and names the step number and text; the captures up to that step are kept. A step that presses Enter on a row can have real effects, such as opening a browser, so write scripts accordingly.

- The child runs on a tmux server of its own (`tmux -L modforge-<pid>`), so your tmux sessions are neither used nor listed, and the server and its socket are removed on every exit path, including `SIGTERM`.
- On a fresh config directory the child shows four prompts: theme, "use this API key?" (answered Yes), security notes, and workspace trust (answered Yes). Later runs reuse the config directory and skip the first three. Trust is recorded per directory, and every run gets a new directory, so the trust prompt appears every run and is always answered.
- The interactive child sends no prompt to the model.

Failure messages name the cause: `tmux not found on PATH`, `ANTHROPIC_API_KEY is not set`, `the interactive stage needs --expect`, `'<text>' did not appear on screen within <n>s` (with the last 12 screen lines), or `the claude process exited before the expected text appeared`.

### Headless cannot draw UI

A headless run has no screen. `$.ui.status`, panes, and bands are not drawn; the engine keeps the status text in the debug log only. A passing headless stage therefore says nothing about UI. Use the interactive stage for any mod that draws.

Exit codes: `0` all requested stages passed, `1` a stage failed, `2` usage error, missing precondition, or a refused harness home.
