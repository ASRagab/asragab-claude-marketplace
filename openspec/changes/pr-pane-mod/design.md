# Design

## Context

See proposal.md for motivation. A Claude Code mod is a plugin whose `hooks/hooks.json` lists one function-hook module. The API is documented by the declaration file the engine writes (`claude-code.d.ts`, build 2.1.287), which this design follows. Mods are built and verified through `mod-forge`, not in the live session.

Facts taken from the declarations:

- A pane is opened with `$.ui.open({ id, title, focus, closeOnEscape })` and drawn by a `ui.render` hook on `{ component: 'Pane', requestId }`. An open the user caused (a typed command) is placed at any width. An open the mod makes on its own is not drawn below 144 terminal columns.
- In a focused pane, Tab walks the elements and the arrow keys scroll. A `Select` moves with the arrows and picks with Enter.
- `$.process.run(argv)` runs a command with no shell and resolves `{ exitCode, stdout, stderr }`. It is available in the CLI only.
- `$.clock.every(ms, fn)` runs `fn` on a timer. `$.ui.status(text)` sets the status line.
- Values a drawing reads live in `atom(...)` state; `read` is called while drawing and `update` from handlers.
- A `Link` element is `https:` only and bounded, so it is not the primary way to open a URL here.

## Goals / Non-Goals

**Goals:**
- One command toggles a pane of the user's open PRs with their review state.
- Arrow keys and Enter reach the browser.
- No configuration; identity comes from `gh`.

**Non-Goals:**
- PRs the user is only a reviewer on, merging, commenting, or any write to GitHub.
- Organisation filters, sorting options, notifications, or persistence across sessions.
- Windows support for opening the browser.

## Decisions

**Pane toggled by `/prs`, not opened at session start.** A command-driven open is placed at any width, while an unasked open waits below 144 columns. The toggle is decided from `$.ui.panes()`, the engine's record, so it survives a module reload. Alternative considered: auto-open at start. Rejected because it fails on narrow terminals and intrudes unasked.

**One `Select` for the cursor.** Arrows move and Enter picks inside a `Select`, which is the documented keyboard-cursor element. A row of Buttons would need Tab to move. Observed in a live terminal: the `Select` draws as a dropdown that is open on arrival, with a reverse-video highlight that moves one row per arrow key. The pane asks for a 110-column dock so titles are not cut off. Alternative considered: Buttons with digit hotkeys. Rejected as the primary control because it limits the list to nine rows; the pane header still tells the user to press Enter.

**Data from one `gh api graphql` search.** `gh search prs --json` has no review-decision field. The GraphQL `search` query returns `isDraft`, `reviewDecision`, the URL and the repository in one call: `is:pr is:open author:@me archived:false`. State mapping: draft first, then CHANGES_REQUESTED, APPROVED, and everything else (REVIEW_REQUIRED or none) as ready for review.

**Identity from `gh`.** `gh api user --jq .login` is the identity check. A non-zero exit or a missing binary produces one stored error string shown in the pane. This is the same credential source `gh` uses everywhere (stored login or `GH_TOKEN`).

**Refresh on a 60 second `$.clock.every`, plus on open.** A refresh runs `gh`, then writes an atom; `ui.render` only reads it and never runs processes. A failed refresh keeps the last good list and sets an error note. A refresh in flight blocks a second one so slow calls do not stack.

**Browser through `open` (macOS), `xdg-open` on Linux.** Chosen over a `Link` element because Enter on a `Select` pick must open it. The mod tries `open` first and falls back to `xdg-open` when `open` is missing or fails; if both fail it shows a toast with the URL.

**Status line shows the count.** `$.ui.status` gives a pane-independent signal and lets the interactive harness check the mod on an 120-column terminal where an unasked pane cannot be drawn.

**Compact rows with a colored legend.** A `Select` label is one plain string, so per-row color is not possible. Each row is `glyph repo#N title` (no repeated state word, owner dropped unless two repos share a name) and the state is named once in a colored legend line under the header. Rows are grouped changes requested, approved, ready, draft. Alternative considered: draw rows and a cursor ourselves with a `Client` element and `surface.onKey` for per-row color. Deferred: more code for a cosmetic gain.

**Background.** In a truecolor terminal the engine fills the whole docked pane with `#262626` (`48;2;38;38;38`) under whatever the mod draws, so it differs from a transparent or themed terminal background. Replaying the raw bytes through a terminal emulator showed that a `Box backgroundColor` repaints the cells it covers (a test color did), but `transparent` and `default` are ignored, so a mod cannot make the pane see through. The mod leaves the background alone.

**`Select` header.** Without a `value`, the collapsed header reads `<label>: none`, and the open list holds only PR rows. The mod sets `label="Selected"` and no `value`; setting `value` to the first PR would repeat that row above the list.

**No `Client` element.** A `Client` could draw colored rows with its own cursor, but its key listener is reached only after a mouse click, which would make the pane mouse-dependent.

## Risks / Trade-offs

- [`search` returns at most 100 PRs per call] → The query asks for 100 and reads `issueCount`; the status line and header show the true total, and the header adds `(showing 100)` when the page is smaller than the total. No pagination.
- [A mobile surface draws no `Select`] → The pane lists the rows without a cursor there.
- [The `Select` shows about eight rows at a time and ends with `… N more`] → Accepted; the highlight scrolls the list.
- [`gh` rate limits or network failure] → Keep the last list, show the failure, retry on the next tick.
- [The mod-forge interactive stage cannot type `/prs`] → The stage checks the status line; the pane is checked by a separate scripted tmux session that types `/prs` and presses Down.
