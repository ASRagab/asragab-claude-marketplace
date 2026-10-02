# Proposal

## Why

Open pull requests in flight are scattered across repositories, and checking their review state means leaving the terminal for GitHub. A Claude Code mod can keep that list one keystroke away inside the session, refreshed automatically, with no setup beyond the `gh` login the user already has.

## What Changes

- Add a Claude Code mod, `pr-pane`, built and verified through the `mod-forge` loop.
- The mod registers a `/prs` slash command that toggles a pane listing every open PR authored by the authenticated GitHub user.
- Each row shows the PR state: draft, ready for review, approved, or changes requested.
- The user moves a cursor over the rows with the arrow keys and presses Enter to open the PR in the default browser.
- The list refreshes on a timer and on demand while the session runs.
- The mod validates the GitHub identity through the `gh` CLI at session start and shows a plain instruction in the pane when `gh` is missing or logged out.
- The status line shows the open PR count so the state is visible with the pane closed.
- No configuration is required.

## Capabilities

### New Capabilities
- `pr-pane-plugin`: a Claude Code mod that shows the user's open GitHub PRs and their review state in a toggleable pane, with keyboard navigation to the browser and automatic refresh.

### Modified Capabilities

## Impact

- New plugin directory, `plugins/pr-pane/`, once the user promotes the mod from the mod-forge workspace. Until then the mod lives in the workspace and loads with `claude --plugin-dir`.
- `marketplace.json` and the README gain an entry on promotion.
- Runtime dependencies on the user's machine: Claude Code 2.1.287 or newer, `gh` authenticated, and the `open` command (macOS) or `xdg-open` (Linux).
- The mod makes read-only GitHub GraphQL calls through `gh`. It writes nothing to GitHub.
