# Tasks

## 1. Pure logic

- [x] 1.1 Implement state mapping (draft, changes requested, approved, ready for review) and GraphQL result parsing, with unit tests covering draft precedence and each review decision; verify `claude plugin test` passes and fails when the mapping is altered
- [x] 1.2 Implement the `gh` calls (identity check, PR search) with error handling for missing binary, logged-out state and non-zero exit; verify with tests that stub `$.process.run`

## 2. Mod wiring

- [x] 2.1 Register `/prs` toggle, the pane `ui.render` hook with a `Select` cursor, the 60 second refresh, and the status line count; verify with tests for toggle open/close, periodic refresh using the mock clock, and Enter opening the URL through the stubbed process
- [x] 2.2 Add the `MOD_FORGE_MARKER` proof of load in `session.start`; verify the headless stage passes

## 3. Verification

- [x] 3.1 Run `run-mod.sh --stages validate,test,headless,interactive --expect "PRs"` and verify every stage passes
- [x] 3.2 Open the pane in an isolated interactive session and confirm the rows draw and the arrow keys move the highlight (done in a scripted tmux session; Enter-to-browser is covered only by a test with a stubbed `open`, not live)

## 4. Promotion (only when the user asks)

- [x] 4.1 Copy the mod to `plugins/pr-pane/`, register it in `marketplace.json`, document install and the `gh` requirement in the README, and verify the marketplace tests pass
