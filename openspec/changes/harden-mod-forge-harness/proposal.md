# Proposal

## Why

Review of this harness found four defects that make its verdicts weaker than its documentation says, and a real session that used `mod-forge` to build a mod (`pr-pane`, merged here as the `pr-pane` plugin) showed more gaps. In that session every stage passed while a type error shipped, the harness never drew or exercised the pane it was verifying, and a background fill that appears only in a truecolor terminal could not be seen at all. Fixing the defects and the gaps together keeps the plugin's claims honest.

Review findings that apply to `plugins/mod-forge` as merged:

- Interactive can pass before the mod loads: any screen text matching `--expect` passes, including the startup banner, so a mod that throws at import still passes.
- Headless ignores the child's exit status: a child that produced the expected evidence and then exited 9 is reported as PASS.
- A relative `MOD_FORGE_HOME` breaks config cache reuse: the config path is resolved after the harness changes directory, so onboarding state is lost between runs.
- The default harness home is a predictable path under `${TMPDIR:-/tmp}` created without an ownership or mode check. On a shared host another user can read run evidence or plant the config directory that live stages reuse. An automated review rated this MEDIUM.

Two other findings from the same review (the interactive fail path aborting under `set -e`, and the no-tmux offline test depending on where `tmux` is installed) are already fixed in the merged copy.

## What Changes

- Interactive stage requires proof of load (the mod's marker file and the module-loaded debug log line) in addition to the expected screen text.
- Headless stage preserves the child's exit status and fails on non-zero.
- `MOD_FORGE_HOME` is resolved to an absolute path before the harness changes directory.
- **BREAKING**: the harness home is created `0700`, and the harness refuses to use an existing home that is a symlink, is not owned by the current user, or is accessible by group or others. Callers with an existing `0755` home must tighten it or choose another.
- New `typecheck` stage between `headless` and `interactive` that type-checks the run copy of the mod against the declarations the engine writes. It fails when no compiler is available instead of skipping.
- Interactive stage accepts a terminal size and a script of keys and expectations, so a pane or other keyboard-driven UI can be opened and exercised, with a capture saved after each step.
- Interactive stage saves color evidence (a capture with escape sequences and the raw terminal stream) next to the plain-text capture.
- The `build-claude-mod` skill requires a passing type check, separates "status line shown" from "UI drawn and driven" in its report, and tells the agent that claims about color or background need color evidence.
- Plugin version moves to 0.2.0.

## Capabilities

### New Capabilities
- `mod-forge-harness`: behavior of the staged runner `scripts/run-mod.sh`: stage order including the type check, evidence each stage must produce, interactive proof of load, scripted input, color evidence, exit status, and the harness home.
- `mod-forge-build-skill`: what the `build-claude-mod` skill requires of an agent before it reports a mod as working, and how it must describe UI and color evidence.

### Modified Capabilities
- `mod-forge-plugin`: the fail-loud requirement forbids opt-in flags, which would literally forbid the new `--script`, `--cols` and `--rows` input options; it is reworded to forbid flags that gate or weaken a stage.

## Impact

- `plugins/mod-forge/scripts/run-mod.sh` and `scripts/isolation.sh` (stages, home resolution, evidence).
- `plugins/mod-forge/tests/harness-offline.test.sh` and `tests/live.test.sh` (new cases).
- `plugins/mod-forge/skills/build-claude-mod/SKILL.md`, fixtures, and the plugin README.
- `plugins/mod-forge/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and the README plugin table (version 0.2.0).
- The plugin's upstream copy carries the same defects; these edits should be mirrored there.
- `bun test tests/` and `bun run test:mod-forge` keep passing; new offline cases are additive and need neither credentials nor `tmux`. Live tests stay out of default test runs.
- New runtime dependency for the `typecheck` stage only: a TypeScript compiler on the path or reachable through `bunx` or `npx`.
