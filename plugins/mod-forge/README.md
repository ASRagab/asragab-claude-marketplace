# mod-forge

Build and verify Claude Code mods without touching the session you are working in.

**Claude Code only.** Mods exist only in Claude Code 2.1.287 and later. This plugin is not published for Cursor or Codex.

A mod is a plugin whose `hooks/hooks.json` is `{ "modules": ["./register.ts"] }`. When you ask an agent to build one, the `build-claude-mod` skill sends the agent through a harness that runs the mod in separate processes, with their own config directory, and reports evidence the agent can read itself.

## Requirements

- Claude Code >= 2.1.287 (`claude plugin test` must exist)
- `jq`
- For live stages: `ANTHROPIC_API_KEY` and, for the interactive stage, `tmux`

A missing requirement fails the run and names it. No stage is skipped silently.

## Stages

`scripts/run-mod.sh [--stages validate,test,headless,interactive] [--expect TEXT] [--model MODEL] MOD_DIR`

Stages run in the order below and stop at the first failure. Each writes evidence into a per-run directory under `${MOD_FORGE_HOME:-${TMPDIR:-/tmp}/mod-forge}/runs/`.

| Stage | Command | Needs credentials | Evidence |
| --- | --- | --- | --- |
| `validate` | `claude plugin validate --json` | no | `validate.json` |
| `test` | `claude plugin test` (fails if zero tests ran) | no | `test.log` |
| `headless` | `claude -p` on a copy of the mod | yes | `debug.log`, `marker`, `headless.json` |

Every child process starts inside the run directory, and every path handed to a child is absolute.

### Headless stage

The child runs `claude -p --model haiku --plugin-dir <copy> --strict-mcp-config --debug-file <run>/debug.log --output-format json` with `CLAUDE_CONFIG_DIR` pointing at a harness-owned directory (`${MOD_FORGE_HOME}/config`, kept between runs) and `MOD_FORGE_MARKER` pointing at a file in the run directory. A mod proves it loaded by writing that file from its `session.start` hook:

```ts
const marker = await $.env.get('MOD_FORGE_MARKER')
if (marker) await $.fs.write(marker, 'loaded')
```

The write is a no-op when the variable is unset, so it is safe to leave in a mod that ships. The stage passes when all of these hold:

- the child finished without error (the reported cost is printed),
- the debug log has a `hooks module <name>@inline loaded` line,
- the marker file holds the expected text (`--marker-text`, default `loaded`),
- the isolation checks find nothing: the debug log never names your real `~/.claude` or `~/.claude.json`, no hook module loads from outside the mod, and your real config holds no transcript directory or project record for the run directory.

The model's reply is never evidence. The live stages run a copy of the mod because Claude Code writes `.claude-plugin/types/` and a `tsconfig.json` into any folder it loads with `--plugin-dir`.

### Interactive stage

`--stages interactive --expect TEXT` starts `claude` on the same mod copy in a detached tmux session (120x40) under the same harness-owned config directory, answers the first-run prompts by matching their text, and waits up to `--timeout` seconds (default 60) for `TEXT` to appear on the screen. The final capture is saved as `screen.txt` with anything shaped like an API key masked. Status text appears with the plugin name in front, for example `⚠ loop-probe: loop-probe: loaded`, so match on the part your mod sets.

- The child runs on a tmux server of its own (`tmux -L modforge-<pid>`), so your tmux sessions are neither used nor listed, and the server and its socket are removed on every exit path, including `SIGTERM`.
- On a fresh config directory the child shows four prompts: theme, "use this API key?" (answered Yes), security notes, and workspace trust (answered Yes). Later runs reuse the config directory and skip the first three. Trust is recorded per directory, and every run gets a new directory, so the trust prompt appears every run and is always answered.
- The interactive child sends no prompt to the model.

Failure messages name the cause: `tmux not found on PATH`, `ANTHROPIC_API_KEY is not set`, `the interactive stage needs --expect`, `'<text>' did not appear on screen within <n>s` (with the last 12 screen lines), or `the claude process exited before the expected text appeared`.

### Headless cannot draw UI

A headless run has no screen. `$.ui.status`, panes, and bands are not drawn; the engine keeps the status text in the debug log only. A passing headless stage therefore says nothing about UI. Use the interactive stage for any mod that draws.

Exit codes: `0` all requested stages passed, `1` a stage failed, `2` usage error or missing precondition.
