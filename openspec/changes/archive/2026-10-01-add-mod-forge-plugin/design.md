# Design

## Context

The source plugin is `plugins/mod-forge` in another marketplace repository (11 files). It is self-contained: scripts resolve their own directory with `BASH_SOURCE`, and the skill refers to `${CLAUDE_PLUGIN_ROOT}`. The only coupling to its host repository is in the two test scripts, which set `REPO=$PLUGIN/../..` and compare `git -C "$REPO" status --short` before and after a run to prove the run left the repository untouched. Here `plugins/mod-forge/../..` is this repository's root, which is a git repository, so that check keeps its meaning.

This repository uses OpenSpec, `bun test` for the skill-eval tests, no Makefile, MIT-licensed plugin manifests with `repository` and `author.url` fields, and is public on GitHub. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- A plugin that installs from this marketplace and behaves exactly as the source plugin does.
- One command for the offline test, one documented command for the live test.

**Non-Goals:**
- Keeping the two copies in sync after this change.
- Removing the plugin from the source repository.
- Teaching any validator about the `modules` form of `hooks.json`.
- Porting the tests to `bun test`.

## Decisions

**Keep the name `mod-forge`.** Claude Code reserves names that start with `claude-`, which is why `claude-mods` was rejected at the source. Renaming would also break the skill's documented paths and `MOD_FORGE_*` variables.

**Copy with `cp -p`, then scrub in place.** Git history of the source is not carried over. A copy keeps the diff reviewable as "11 new files plus 3 small edits". `git subtree` or `filter-repo` would preserve history but add tooling for no stated need.

**Edit only attribution, one comment, and docs.** The manifest author becomes `ASRagab` with the repository URL, and the license becomes `MIT` like `cass` and `skill-eval`. The `live.test.sh` header comment changes from `make mod-forge-test` to the direct `bash` invocation. All other bytes stay identical to the source at copy time, which tasks 1.2 and 2.2 check by diff. The spec does not pin that, because the copy is free to diverge afterwards.

**Keep the bash tests as bash.** Both tests exercise shell scripts through stubs and real `claude` children. Wrapping them in `bun test` would hide failures behind a second runner. `package.json` gets one script, `test:mod-forge`, for the offline test only. The live test is excluded from every script because it spends money and needs a key; the README documents the command. No env gate is added, per the repository owner's rule that live tests make real calls.

**Relicense to MIT.** The source plugin is licensed `Private`. This repository is public and its manifests say `MIT`. The repository owner approved publishing `mod-forge` here under MIT on 2026-10-01.

## Risks / Trade-offs

- [Publishing employer-authored code under a new license] → Owner approval recorded above; task 1.1 quotes it in the PR description.
- [Two copies drift] → Accepted and not documented in the README, which would name an internal repository in a public file. A later change can decide which copy is canonical.
- [A bare `bun test` at the root discovers `plugins/mod-forge/skills/build-claude-mod/fixtures/loop-probe/hooks/register.test.ts`, which imports `claude-code/testing` and would fail under bun] → Task 3.3 checks this; if it is picked up, a `bunfig.toml` with `[test] root = "tests"` scopes discovery. The root `tsconfig.json` includes only `tests/**` and `plugins/skill-eval/scripts/**`, so `tsc` is unaffected.
- [Offline test depends on `claude` 2.1.287 and `jq` on the machine] → The test already fails with a named precondition; the README lists the requirements.
- [`git status` unchanged check false-fails when unrelated files change during the run] → Same behavior as at the source. Run it on a quiet tree.
- [`bun run test` fails on a fresh checkout because `@anthropic-ai/sdk` is declared only in `plugins/skill-eval/scripts/package.json`] → The README prerequisites tell the reader to run `bun install` there; after it, 75 tests pass. Hoisting the dependency to the root is a separate change.
