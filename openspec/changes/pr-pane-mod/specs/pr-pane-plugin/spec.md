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
The band SHALL list up to 100 of the most recently updated open, non-archived pull requests authored by the GitHub user that `gh` is authenticated as, across all repositories, and the band header SHALL show the true total when it exceeds the rows listed.

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
Each row SHALL show exactly one of four states as a glyph and color the full PR description: draft (dim), unresolved comments/requested changes (red), approved (blue), or needs review (orange). The band header SHALL carry a legend naming each glyph with the count of listed PRs in that state. Default status sorting SHALL group feedback, approved, needs review, draft.

#### Scenario: Legend and grouping
- **WHEN** the list holds 1 draft, 2 needs-review, 1 approved and 1 feedback PR and status sorting is active
- **THEN** the rows run feedback, approved, needs review, needs review, draft, and the legend shows one count per state present

#### Scenario: Draft wins
- **WHEN** a PR is a draft, whatever its review decision
- **THEN** its state is draft

#### Scenario: Review decision maps to state
- **WHEN** a non-draft PR has review decision CHANGES_REQUESTED, APPROVED, REVIEW_REQUIRED, or none
- **THEN** its state is feedback, approved, needs review, and needs review respectively, unless unresolved review threads take precedence over approval

#### Scenario: Unresolved feedback wins over approval
- **WHEN** a non-draft approved PR has an unresolved review thread
- **THEN** its row is red and shows comments/changes, including when that thread is found on a later API page

#### Scenario: Historical and resolved comments
- **WHEN** an approved PR has only resolved threads or historical comments and no active changes-requested decision
- **THEN** its row remains blue and approved

### Requirement: Select one sort mode
The band SHALL offer repository, status, or last-updated date sorting, with one active mode at a time. Repository and status groups SHALL use descending last-updated time within each group. Date sorting SHALL use descending last-updated time globally. Changing mode SHALL reset the displayed page.

#### Scenario: Switch from repository to date
- **WHEN** repository sorting is active and the user chooses date
- **THEN** date becomes the sole active sort mode and the newest-updated PR appears first on page one

#### Scenario: Repository or status grouping
- **WHEN** repository or status sorting is active
- **THEN** PRs are grouped by that key, with newest-updated PRs first within each group

### Requirement: Page the colored rows
The band SHALL draw up to eight PR rows at once, reducing that number for smaller available heights, and offer Previous/Next controls with p/n shortcuts while it has keyboard focus.

#### Scenario: Next page
- **WHEN** more PRs remain and the user activates Next
- **THEN** the next rows appear and the page indicator advances

### Requirement: Open a pull request in the browser from the keyboard
The user SHALL be able to press Ctrl+X, then Tab to focus the band, move between row controls with arrows or Tab, and press Enter to open the selected PR in the default browser. When composed band output overflows, arrows MAY scroll; Tab SHALL remain available for moving focus.

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

### Requirement: Show the count and refresh information inside the band
The band header SHALL show the open PR count and last successful refresh time. Refresh failures SHALL appear in the band while retaining the last good data. The mod SHALL clear its old pinned status at session start and SHALL NOT publish a redundant count to the warning-styled status footer.

#### Scenario: Count shown in the band
- **WHEN** a refresh succeeds and the band is visible
- **THEN** its header shows the count and refresh time without a duplicate PR warning below the prompt
