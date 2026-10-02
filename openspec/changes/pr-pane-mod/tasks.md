# Tasks

## 1. Pure logic

- [x] 1.1 Implement state mapping (draft, changes requested, approved, ready for review) and GraphQL result parsing, with unit tests covering draft precedence and each review decision; verify `claude plugin test` passes and fails when the mapping is altered
- [x] 1.2 Implement the `gh` calls (identity check, PR search) with error handling for missing binary, logged-out state and non-zero exit; verify with tests that stub `$.process.run`

## 2. Mod wiring

- [x] 2.1 Register `/prs` visibility toggle and the AbovePrompt `ui.render` hook with the existing `Select`, the 60 second refresh, and the status line count; verify hidden/visible rendering, survey yielding, downstream composition and autofocus order, no pane calls or explicit background colors, periodic refresh, and Enter opening the URL through the stubbed process
- [x] 2.2 Add the `MOD_FORGE_MARKER` proof of load in `session.start`; verify the headless stage passes

## 3. Verification

- [x] 3.1 Rerun `run-mod.sh --stages validate,test,headless,interactive --expect "PRs"` for the band implementation and verify every stage passes
- [x] 3.2 Show the band in an isolated interactive session and confirm the rows draw, Ctrl+X then Tab focuses the Select, arrows move the highlight, Esc returns to the prompt while leaving the band visible, and `/prs` hides and shows it; Enter was pressed live and `open` exited 0, while the SDK test verifies the exact selected URL
- [x] 3.3 Inspect the band in native Warp with the user's translucent default background; user screenshot confirms translucency is maintained

## 4. Promotion (only when the user asks)

- [x] 4.1 Copy the mod to `plugins/pr-pane/`, register it in `marketplace.json`, document install and the `gh` requirement in the README, and verify the marketplace tests pass

## 5. Status and sorting tweaks

- [x] 5.1 Classify unresolved review threads and active requested changes as feedback, ahead of approval; paginate review threads when needed and retain last good data on failure
- [x] 5.2 Color the full PR description red for feedback, blue for approval, orange for needs review, and dim for drafts, using native Buttons beside Text
- [x] 5.3 Add a single repository/status/date sort choice, descending last-updated time within groups, and eight-row paging
- [x] 5.4 Remove the redundant warning-styled footer count; retain the count, refresh time and errors in the band; investigate separators and recommend dim horizontal rules
- [x] 5.5 Pass validate, 17 SDK tests, headless and interactive stages, generated-type checking, and a color mutation check; inspect live foreground/background output and exercise keyboard sorting, paging and browser opening
