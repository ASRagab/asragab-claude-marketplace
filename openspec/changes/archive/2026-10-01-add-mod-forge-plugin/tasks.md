# Tasks

## 1. Authorization and copy

- [x] 1.1 Owner approved MIT relicensing on 2026-10-01 and waived quoting the approval in the PR description; verify the approval is recorded in design.md
- [x] 1.2 Copy the source `plugins/mod-forge` directory to `plugins/mod-forge` with `cp -Rp`; verify `diff -r` against the source shows no differences and `plugins/mod-forge/scripts/run-mod.sh` is executable (`test -x`)

## 2. Scrub and manifest

- [x] 2.1 Edit `plugins/mod-forge/.claude-plugin/plugin.json`: author `{ "name": "ASRagab", "url": "https://github.com/ASRagab" }`, `repository` `https://github.com/ASRagab/asragab-claude-marketplace`, license `MIT`, matching the field order of `plugins/cass/.claude-plugin/plugin.json`; verify with `jq -e '.license=="MIT" and .author.name=="ASRagab"'`
- [x] 2.2 Replace the `make mod-forge-test` line in the `plugins/mod-forge/tests/live.test.sh` header with `bash plugins/mod-forge/tests/live.test.sh`; verify `grep -rn 'make mod-forge-test' plugins/mod-forge` returns nothing and `diff -r` against the source shows only `plugin.json` and that one comment line
- [x] 2.3 Verify the plugin manifest with `claude plugin validate plugins/mod-forge` (Claude Code >= 2.1.287); expected exit 0

## 3. Register and expose tests

- [x] 3.1 Add the `mod-forge` entry (name, source `./plugins/mod-forge`, description, version `0.1.0`) to `.claude-plugin/marketplace.json`; verify with `jq -e '.plugins[] | select(.name=="mod-forge")'` and `claude plugin validate .` exits 0 (two pre-existing warnings remain: no marketplace description, skill-eval `compatibility` field; this change adds none)
- [x] 3.2 Add `"test:mod-forge": "bash plugins/mod-forge/tests/harness-offline.test.sh"` to `package.json`; verify `bun run test:mod-forge` exits 0 with every case `ok`, and `git status --short` is unchanged apart from this change's files
- [x] 3.3 Record the file list and exit code of `bun run test` before the copy (task 1.2) and verify they are identical after it; verify a bare `bun test --dry-run` (or `bun test` with output inspected) does not list the fixture's `register.test.ts`, and if it does add `bunfig.toml` with `[test] root = "tests"` and re-verify; verify root `tsconfig.json` includes do not reach `plugins/mod-forge`

## 4. Documentation and existing-state fixes

- [x] 4.1 Add a `mod-forge` row (version 0.1.0), an install line (`claude plugin install mod-forge`), and a `mod-forge` section to `README.md` with the Claude Code >= 2.1.287 requirement, the offline command `bun run test:mod-forge`, and the live command with its `ANTHROPIC_API_KEY` and `tmux` requirements and the roughly $0.01 to $0.03 per headless run cost; verify each documented command runs as written (the live command is run in task 5.1)

- [x] 4.2 Bump the `cass` entry in `.claude-plugin/marketplace.json` to 0.3.0; verify `claude plugin validate .` no longer warns about the cass version
- [x] 4.3 Document `bun install` in `plugins/skill-eval/scripts` as a prerequisite for `bun run test`; verify `bun install --frozen-lockfile` there followed by `bun run test` gives 0 failures

## 5. Live verification

- [x] 5.1 Run `ANTHROPIC_API_KEY=... bash plugins/mod-forge/tests/live.test.sh` for real, with no mocks or gates; verify every case prints `ok` and the exit code is 0, and report the actual cost
- [x] 5.2 Install check: add this marketplace from the local path in a scratch Claude Code config (`CLAUDE_CONFIG_DIR` set to a temp directory), run `claude plugin install mod-forge@asragab-claude-marketplace`, and verify `claude plugin list` shows `mod-forge`; confirm the real `~/.claude` is untouched
