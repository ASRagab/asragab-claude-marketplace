# Design

## Context

See proposal.md for motivation. A Claude Code mod is a plugin whose `hooks/hooks.json` lists one function-hook module. The API is documented by the declaration file the engine writes (`claude-code.d.ts`, build 2.1.287), which this design follows. Mods are built and verified through `mod-forge`, not in the live session.

Facts taken from the declarations:

- An AbovePrompt band is drawn by a `ui.render` hook on `{ component: 'AbovePrompt' }`; it does not need `$.ui.open` or `$.ui.close`.
- AbovePrompt is raised on the terminal surface only.
- Ctrl+X, then Tab moves keyboard focus from the prompt into a band. A focused `Select` moves with the arrows and picks with Enter; Esc returns focus to the prompt.
- `hasSurvey` signals an active survey, during which the PR band yields. `await next(e)` obtains other mods' render output for composition.
- `$.process.run(argv)` runs a command with no shell and resolves `{ exitCode, stdout, stderr }`. It is available in the CLI only.
- `$.clock.every(ms, fn)` runs `fn` on a timer. `$.ui.status(text)` sets the status line.
- Values a drawing reads live in `atom(...)` state; `read` is called while drawing and `update` from handlers.
- A `Link` element is `https:` only and bounded, so it is not the primary way to open a URL here.

## Goals / Non-Goals

**Goals:**
- One command toggles a band above the prompt with the user's open PRs and their review state.
- Arrow keys and Enter reach the browser.
- No configuration; identity comes from `gh`.
- Avoid the docked pane's explicit background fill so the band can use Warp's default translucent background.

**Non-Goals:**
- PRs the user is only a reviewer on, merging, commenting, or any write to GitHub.
- Organisation filters, sorting options, notifications, or persistence across sessions.
- Windows support for opening the browser.

## Decisions

**AbovePrompt band toggled by `/prs`.** Visibility lives in a plugin-keyed reactive atom, initially hidden, so it survives a module reload. The command changes that atom and refreshes on show; it makes no pane open or close calls. Prompt focus stays with the engine until the user presses Ctrl+X, then Tab. Esc returns focus to the prompt without hiding the band; `/prs` hides it.

**Compose with other mods and yield during surveys.** The AbovePrompt renderer calls `await next(e)` and retains that output when adding the PR band. When hidden or `hasSurvey` is true, it returns the downstream output alone. BelowPrompt is not used for the interactive picker.

**One `Select` for the cursor.** Arrows move and Enter picks inside the existing `Select`, which is the documented keyboard-cursor element. A row of Buttons would need Tab to move. The band uses the prompt area's available width. The existing Select keeps the PR rows and Enter-to-browser handler; band focus is checked in an isolated interactive session.

**Data from one `gh api graphql` search.** `gh search prs --json` has no review-decision field. The GraphQL `search` query returns `isDraft`, `reviewDecision`, the URL and the repository in one call: `is:pr is:open author:@me archived:false`. State mapping: draft first, then CHANGES_REQUESTED, APPROVED, and everything else (REVIEW_REQUIRED or none) as ready for review.

**Identity from `gh`.** `gh api user --jq .login` is the identity check. A non-zero exit or a missing binary produces one stored error string shown in the band. This is the same credential source `gh` uses everywhere (stored login or `GH_TOKEN`).

**Refresh on a 60 second `$.clock.every`, plus on show.** A refresh runs `gh`, then writes an atom; `ui.render` only reads it and never runs processes. A failed refresh keeps the last good list and sets an error note. A refresh in flight blocks a second one so slow calls do not stack.

**Browser through `open` (macOS), `xdg-open` on Linux.** Chosen over a `Link` element because Enter on a `Select` pick must open it. The mod tries `open` first and falls back to `xdg-open` when `open` is missing or fails; if both fail it shows a toast with the URL.

**Status line shows the count.** `$.ui.status` gives a signal even while the band is hidden and lets the mod-forge interactive harness check the mod without typing `/prs`.

**Compact rows with a colored legend.** A `Select` label is one plain string, so per-row color is not possible. Each row is `glyph repo#N title` (no repeated state word, owner dropped unless two repos share a name) and the state is named once in a colored legend line under the header. Rows are grouped changes requested, approved, ready, draft. Alternative considered: draw rows and a cursor ourselves with a `Client` element and `surface.onKey` for per-row color. Deferred: more code for a cosmetic gain.

**Background.** Claude Code 2.1.287 fills docked panes with `#262626` (`48;2;38;38;38`), while its AbovePrompt band renderer has no corresponding background fill. Warp renders explicit background colors opaquely and its default background translucently. The PR band's `Box` and `Text` elements therefore omit `backgroundColor`. This avoids the pane fill by moving the picker to the band; native Warp transparency still requires a visual check. Native inspection was blocked by the computer-use tool's safety check, so terminal rendering evidence does not establish that visual result.

**`Select` header.** With no initial `value`, the collapsed header starts at `Selected: none` and shows the selected row after a pick. The open list holds only PR rows.

**No `Client` element.** The existing Select handles keyboard navigation without introducing a separate cursor or mouse-dependent key listener.

## Risks / Trade-offs

- [`search` returns at most 100 PRs per call] → The query asks for 100 and reads `issueCount`; the status line and header show the true total, and the header adds `(showing 100)` when the page is smaller than the total. No pagination.
- [The `Select` shows about eight rows at a time and ends with `… N more`] → Accepted; the highlight scrolls the list.
- [`gh` rate limits or network failure] → Keep the last list, show the failure, retry on the next tick.
- [The mod-forge interactive stage cannot type `/prs`] → The stage checks the status line; a separate isolated terminal session checks `/prs`, Ctrl+X then Tab, arrows, Esc, and hide/show.
- [Native Warp inspection is blocked] → Record the gap explicitly; do not claim visual transparency from ANSI or terminal-emulator checks alone.

## Verification

Claude Code 2.1.287 passed mod-forge's validate, test (11 SDK tests), headless, and interactive stages. Typechecking against its generated declarations passed; changing the render matcher back to Pane made the band tests fail. An isolated terminal session verified show/hide/show, Ctrl+X then Tab focus, arrow navigation, Enter (`open` exited 0), and Esc returning to the prompt. Captured band rows emitted no explicit background-color SGRs; the selected row used inverse SGR 7. Native Warp appearance remains unverified.
