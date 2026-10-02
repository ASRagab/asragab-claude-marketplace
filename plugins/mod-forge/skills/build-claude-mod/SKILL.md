---
name: build-claude-mod
description: Build, change, debug, or verify a Claude Code mod (a plugin whose hooks/hooks.json lists function-hook modules) and prove it works in isolated child processes, never in the live session. Use when the user asks for "a mod that ..." or to test a mod. Not for settings-based command hooks or ordinary plugins.
---

# Build a Claude Code mod

A mod is a plugin whose `hooks/hooks.json` is `{ "modules": ["./register.ts"] }`. The user is usually inside a live Claude Code session. Do not test in that session and do not ask it to hot-reload anything. Verify through the harness at `${CLAUDE_PLUGIN_ROOT}/scripts/run-mod.sh`, which runs the mod in separate processes under their own config directory.

Does not apply to: shell-command hooks in `settings.json` or in a plugin's `hooks.json` `hooks` key, and plugins without function-hook modules.

## Where to write the mod

Write the mod to `${MOD_FORGE_HOME:-${TMPDIR:-/tmp}/mod-forge}/workspace/<mod-name>/`, with these three files:

- `.claude-plugin/plugin.json` with `name`, `version`, `description`
- `hooks/hooks.json` with `{ "modules": ["./register.ts"] }`
- `hooks/register.ts`, plus at least one `hooks/*.test.ts`

**This location overrides the one in the bundled `plugin-authoring` skill.** That skill tells you to write under `~/.claude/dev-mods/<session>/`; its first write there raises "Enable hot reloading for this session?" in the user's live session. If both skills are loaded, follow this one. Create no file under `~/.claude/dev-mods/`.

## Getting the API right

Do not rely on memory for event names, `$` methods, or element props. Read them from the declarations Claude Code writes:

1. Before the first run: load the bundled `plugin-authoring` skill for reading only. Take the API types file and `reference.md` it names. Ignore its instructions about where to write the mod and about hot reloading.
2. After the first `headless` run: the engine has written `.claude-plugin/types/` (the API, built-in tools, connected MCP tools, and a `tsconfig.json` for `tsc -p`) into the run directory's copy of the mod, at `<run>/mod/.claude-plugin/types/`. It is not written into your workspace mod, because live stages load a copy.

Grep the file for the name you need and read the declaration. The test kit (`claude-code/testing`) is in the same file. The fixture at `${CLAUDE_PLUGIN_ROOT}/skills/build-claude-mod/fixtures/loop-probe/` is a complete working mod with a test; copy its shape.

## Proof of load

In `session.start`, the mod reads the environment variable `MOD_FORGE_MARKER` and, when it is set, writes the text `loaded` to that path. The harness sets the variable per run. Leave this in; it does nothing when the variable is unset. The fixture's `register.ts` shows it.

## Run the loop

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/run-mod.sh" [--stages validate,test,headless,interactive] [--expect TEXT] <mod-dir>
```

Stages run in order and stop at the first failure. Each prints an evidence path; read those files instead of guessing. Exit `0` passed, `1` a stage failed, `2` a precondition is missing (read the message; the usual causes are no `ANTHROPIC_API_KEY` or no `tmux`). Do not work around a missing precondition by skipping the stage.

| The mod... | Run | Why |
| --- | --- | --- |
| only changes behavior (rewrites prompts, tool calls, system prompt, plays sound) | `validate,test,headless` | no screen involved |
| sets a status line, toast, band, pane, or any UI | `validate,test,headless,interactive --expect <text it shows>` | headless runs draw nothing |

The interactive status line shows the plugin name in front of the mod's own text. Pass the part the mod sets.

## Definition of done

Report a mod as working only when:

1. `validate` passed.
2. A `*.test.ts` asserting the requested behavior exists and `test` passed. A test that cannot fail when the behavior changes does not count; change the behavior once to see it fail.
3. `headless` passed (marker written, module listed in the debug log).
4. If the mod draws anything: `interactive` passed with the expected text in the capture.

Never describe a stage you did not run as passed. A headless pass says nothing about UI.

## Report

End with this, one line per stage, using only `ran and passed`, `ran and FAILED`, `not applicable (reason)`, or `unverified (reason)`:

```text
validate     <status> <evidence path>
test         <status> <evidence path>
headless     <status> <evidence path>
interactive  <status> <evidence path>
Mod: <absolute path>
Load it:  claude --plugin-dir <absolute path>
```

A UI mod without a passing interactive stage is reported as `UI unverified`.

## When a stage keeps failing

Fix and rerun. A failure signature is the stage name plus the first error line. After three consecutive failures with the same signature, stop. Report the error, the evidence paths, and what you tried; do not keep spending on a stage that cannot pass.

## Promotion is the user's call

Do not install the mod, enable it, copy it into `~/.claude`, a marketplace, or a repository unless the user asks. Finish with the mod's absolute path and the load command above.
