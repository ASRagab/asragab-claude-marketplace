# Tasks

## 1. Fixes for the review findings

- [ ] 1.1 Resolve `MOD_FORGE_HOME` to an absolute path at argument handling, before any `cd`, and derive `CONFIG_CACHE` and run paths from it; add an offline case that runs twice with `MOD_FORGE_HOME=forge` from one directory and asserts both runs use the same config directory (the case fails on the current code)
- [ ] 1.2 Create the home with mode `0700` and refuse a home that is a symlink, not owned by the current user, or has group or other permissions, printing the path, the reason, and `chmod 700 <path>`; add offline cases for a fresh home, an existing `0755` home, and a symlinked home, each asserting that no child is started on refusal
- [ ] 1.3 Capture the headless child's exit status instead of `|| true`, and add a problem line when it is non-zero; add an offline case with a stub `claude` that writes the marker, prints success JSON, and exits 9, asserting the stage fails and names the status
- [ ] 1.4 Factor the marker and module-load log checks out of the headless stage into one function and call it from the interactive stage as well; add an offline case (stub `claude` and stub `tmux` serving the startup banner, with no marker and no module-load line) asserting the stage fails naming the missing evidence, and one where the evidence is present and the stage passes

## 2. New evidence and the type check stage

- [ ] 2.1 Add the `typecheck` stage between `headless` and `interactive` with compiler discovery (`tsc`, then `bunx tsc`, then `npx --no-install tsc`), the missing-declarations failure, and the no-compiler precondition failure; add offline cases using a stub compiler for pass, fail, no declarations, and no compiler, and run it once against a fixture with a deliberate type error to confirm it fails
- [ ] 2.2 Add `--cols` and `--rows` (defaults 120 and 40) and pass them to `new-session`; add an offline case with the stub `tmux` asserting the size arguments it receives
- [ ] 2.3 Save `screen.ansi` and `stream.raw` (masked) in the interactive stage; verify in `tests/live.test.sh` by replaying `stream.raw` through a terminal emulator and checking a known cell background, and record the result in the design if the stream does not preserve it, switching to the pty fallback described there
- [ ] 2.4 Add `--script FILE` (`type`, `key`, `expect` lines), require `--expect` as the readiness step, write `screen-NN.txt` per step, and fail at the first unmet `expect` naming the step; add offline cases with the stub `tmux` for a passing script and a script whose second step never appears, asserting the session is killed in both

## 3. Skill, documentation, and release metadata

- [ ] 3.1 Update `SKILL.md`: add the type check to the stage table and definition of done, require scripted interactive runs for panes and other input-driven UI, split the report line into "status line only" versus "drawn and driven", and add the color-evidence rule; verify by re-reading the skill against the `mod-forge-build-skill` spec scenarios
- [ ] 3.2 Update the plugin README for the new stage, flags, evidence files, exit behavior, and the home permission requirement, and verify each documented command runs as written against the fixture
- [ ] 3.3 Add a fixture mod with a deliberate type error for the negative type check case, kept under the fixtures path; verify `claude plugin validate plugins/mod-forge` still passes and the fixture is not listed as a plugin
- [ ] 3.4 Bump `mod-forge` to 0.2.0 in `plugin.json`, `.claude-plugin/marketplace.json`, and the README plugin table, and verify the three versions match

## 4. Verification

- [ ] 4.1 Run `bun test tests/` and `bun run test:mod-forge` with `ANTHROPIC_API_KEY` unset and confirm every case passes and `git status --short` is unchanged afterward
- [ ] 4.2 Run `bash plugins/mod-forge/tests/live.test.sh`, then the harness with all stages and a script against `plugins/pr-pane` (open the pane with `/prs`, move the cursor with Down), and confirm the type check would have failed on the original defects and the scripted run passes on the fixed code
