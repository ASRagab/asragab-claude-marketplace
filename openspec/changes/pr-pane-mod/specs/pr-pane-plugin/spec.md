# Spec Delta

## Purpose

Gives a Claude Code user a one-keystroke view of their open GitHub pull requests and each one's review state, with keyboard access to the browser, without leaving the session or configuring anything.

## ADDED Requirements

### Requirement: Toggle the pull request band
The mod SHALL register a `/prs` slash command that shows the pull request band above the prompt when it is hidden and hides it when it is visible. Visibility SHALL be stored in a plugin-keyed reactive atom so it survives a module reload.

#### Scenario: Show from hidden
- **WHEN** the user runs `/prs` and the band is hidden
- **THEN** the band appears above the prompt, with focus remaining on the prompt

#### Scenario: Hide from visible
- **WHEN** the user runs `/prs` and the band is visible
- **THEN** the band is hidden

#### Scenario: Module reload preserves visibility
- **WHEN** the module reloads while the band is visible
- **THEN** the band remains visible

### Requirement: Preserve the default background and other band output
The mod SHALL render the picker at AbovePrompt without setting `backgroundColor` on its Box or Text elements, SHALL preserve downstream render output from `next(e)`, and SHALL yield while `hasSurvey` is true.

#### Scenario: Other mod renders AbovePrompt
- **WHEN** another mod provides AbovePrompt output
- **THEN** that output remains present whether the PR band is visible or hidden

#### Scenario: Survey is active
- **WHEN** `hasSurvey` is true while the band is visible
- **THEN** the renderer returns downstream output without the PR band and does not change its visibility state

#### Scenario: Use the default terminal background
- **WHEN** the PR band is rendered
- **THEN** it introduces no explicit Box or Text background color

### Requirement: List open pull requests authored by the user
The band SHALL list every open, non-archived pull request authored by the GitHub user that `gh` is authenticated as, across all repositories, up to 100 rows, and the band header SHALL show the true total when it exceeds the rows listed.

#### Scenario: PRs across repositories
- **WHEN** the user has open PRs in two repositories
- **THEN** the band lists both, each row naming the repository, the PR number and the title; the owner is omitted from the repository name unless two listed repositories share a name

#### Scenario: More PRs than one page
- **WHEN** the user has 120 open PRs
- **THEN** the band lists 100 rows and its header shows a total of 120

#### Scenario: No open PRs
- **WHEN** the user has no open PRs
- **THEN** the band says so instead of showing an empty list

### Requirement: Show the review state of each pull request
Each row SHALL show exactly one of four states: draft, changes requested, approved, or ready for review, as a glyph. The band header SHALL carry a legend naming each glyph with the count of listed PRs in that state, and rows SHALL be grouped in the order changes requested, approved, ready for review, draft.

#### Scenario: Legend and grouping
- **WHEN** the list holds 1 draft, 2 ready, 1 approved and 1 changes-requested PR
- **THEN** the rows run changes requested, approved, ready, ready, draft, and the legend shows one count per state present

#### Scenario: Draft wins
- **WHEN** a PR is a draft, whatever its review decision
- **THEN** its state is draft

#### Scenario: Review decision maps to state
- **WHEN** a non-draft PR has review decision CHANGES_REQUESTED, APPROVED, REVIEW_REQUIRED, or none
- **THEN** its state is changes requested, approved, ready for review, and ready for review respectively

### Requirement: Open a pull request in the browser from the keyboard
The user SHALL be able to press Ctrl+X, then Tab to focus the band, move a cursor over the rows with the arrow keys, and press Enter to open the selected PR in the default browser.

#### Scenario: Focus the picker
- **WHEN** the band is visible and the user presses Ctrl+X, then Tab from the prompt
- **THEN** the picker receives keyboard focus

#### Scenario: Enter opens the PR
- **WHEN** the cursor is on a row and the user presses Enter
- **THEN** the PR's URL opens in the default browser

#### Scenario: Escape returns to the prompt
- **WHEN** the picker has focus and the user presses Esc
- **THEN** focus returns to the prompt and the band remains visible

### Requirement: Refresh automatically
The mod SHALL refresh the list at session start and then once every 60 seconds while the session runs, and SHALL refresh when the user shows the band.

#### Scenario: Periodic refresh
- **WHEN** 60 seconds pass after the last refresh
- **THEN** the mod fetches the list again and the band shows the new data

#### Scenario: Failed refresh keeps the last list
- **WHEN** a refresh fails after an earlier one succeeded
- **THEN** the band keeps the last good list and shows that the refresh failed

### Requirement: Validate the GitHub identity without configuration
The mod SHALL take the GitHub identity from the `gh` CLI's authentication and SHALL require no configuration.

#### Scenario: gh is authenticated
- **WHEN** `gh` is logged in
- **THEN** the band header names the authenticated login

#### Scenario: gh is missing or logged out
- **WHEN** `gh` is not installed or not authenticated
- **THEN** the band tells the user to run `gh auth login` and makes no further GitHub calls until the next refresh

### Requirement: Show the open PR count in the status line
The mod SHALL show the number of open PRs in the status line after each successful refresh.

#### Scenario: Count shown with the band hidden
- **WHEN** a refresh succeeds and the band is hidden
- **THEN** the status line shows the open PR count
