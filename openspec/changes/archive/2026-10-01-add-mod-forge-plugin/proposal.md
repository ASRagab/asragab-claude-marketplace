# Proposal

## Why

The `mod-forge` plugin lets an agent build and verify Claude Code mods in isolated child processes, never in the live session. It lives only inside a private marketplace, so it cannot be installed in other environments. Moving it into this marketplace makes it installable with `claude plugin install mod-forge` anywhere this marketplace is added.

## What Changes

- Copy the 11 files of the source `plugins/mod-forge` to `plugins/mod-forge/` in this repository, preserving the executable bit on `scripts/run-mod.sh`. Scripts, skill text, fixture, and test logic are unchanged.
- Change `plugins/mod-forge/.claude-plugin/plugin.json` author to `ASRagab` and license from `Private` to `MIT`, matching `cass` and `skill-eval`. Add `repository` and `url` fields to match the sibling manifests. The source is licensed `Private` and this repository is public; the owner approved the relicense (see design.md).
- Replace the `make mod-forge-test` reference in the `tests/live.test.sh` header comment with the direct `bash plugins/mod-forge/tests/live.test.sh` invocation, since this repository has no Makefile.
- Register `mod-forge` in `.claude-plugin/marketplace.json`.
- Add a `mod-forge` row to the README plugin table, an install line, and a `mod-forge` section that points to the plugin README and states the Claude Code >= 2.1.287 requirement.
- Add a `test:mod-forge` script to `package.json` that runs the offline harness test. The live test stays a manual command and is not part of `bun test` or any default script.
- Add `bunfig.toml` (`[test] root = "tests"`) so a bare `bun test` does not discover the fixture's `register.test.ts`, which imports `claude-code/testing` and cannot run under bun.
- Bump the `cass` marketplace entry from 0.2.0 to 0.3.0 to match its `plugin.json` and the README.
- Document in the README that `bun run test` needs `bun install` in `plugins/skill-eval/scripts` first, which fixes the two existing test failures (missing `@anthropic-ai/sdk`).
- No harness behavior changes. No new opt-in gates, dry-run defaults, or mock fallbacks on the live test.

## Capabilities

### New Capabilities
- `mod-forge-plugin`: How the `mod-forge` plugin is packaged, registered, and tested inside this marketplace: install path, plugin manifest, verbatim behavior of the harness, and the offline and live test entry points.

### Modified Capabilities
- (none)

## Impact

- New directory: `plugins/mod-forge/` (11 files, about 740 lines).
- New file: `bunfig.toml`.
- Edited: `.claude-plugin/marketplace.json`, `README.md`, `package.json`.
- Runtime requirements of the plugin (unchanged): Claude Code >= 2.1.287, `jq`, and for live stages `ANTHROPIC_API_KEY` and `tmux`.
- Live test makes real model calls (about $0.01 to $0.03 per headless run) when run.
- The source plugin is left untouched. Two copies will exist; the new copy is not kept in sync automatically.
