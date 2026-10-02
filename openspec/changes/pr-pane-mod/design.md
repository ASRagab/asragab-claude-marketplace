# Design

## Context and goals

Claude Code 2.1.287 fills docked panes with `#262626`; Warp renders that explicit background opaquely. Its AbovePrompt renderer has no corresponding fill, so `/prs` toggles a band using default backgrounds. The user confirmed native Warp translucency after this change. The mod lists authored open PRs and opens them in the browser, without GitHub writes or configuration.

The installed declarations and [official keyboard documentation](https://code.claude.com/docs/en/plugins/mods/interface#what-each-key-does) define the rendering and focus contracts. Validation uses isolated mod-forge processes, never the user's live session.

## Rendering and keyboard controls

Visibility is a plugin-keyed atom, initially hidden. The AbovePrompt hook preserves `await next(e)` and yields during surveys. Box and Text omit `backgroundColor`.

Native Select accepts only plain string labels. Native Button cannot color its label or accept styled children. Each row therefore uses a small plain Button (`›`) beside a colored Text containing the full `glyph repo#number title` description. The owner appears only when short repository names collide. The first row has autofocus; Ctrl+X then Tab hands the band the keyboard. Arrows or Tab move between native controls, Enter opens a PR, and Esc returns to the prompt without hiding the band. If composed output overflows the band, arrows scroll and Tab still moves focus.

Up to eight PRs appear per page, reduced when the available band height is smaller. Previous/Next buttons have `p`/`n` shortcuts. Page changes request focus on the first new row; this is best effort because focus remains the person's to give. Sort buttons use `r`/`s`/`d`, with one active mode: repository, status, or last-updated date. Repository/status sorts use descending updated time within each group. Status order is feedback, approved, needs review, draft. Date means GitHub `updatedAt`; the query requests `sort:updated-desc` so the newest PRs remain included at the 100-row limit.

A Client was considered: its key listener requires click-acquired focus and cannot join the native Button/Input/Select focus ring. Native controls retain keyboard access with less code.

Dim horizontal rules above and below the PR content span the available band width and preserve transparency. They cost two rows, accounted for when choosing the page size.

## Data and statuses

`gh api user --jq .login` verifies identity. GraphQL searches `is:pr is:open author:@me archived:false sort:updated-desc` for up to 100 PRs, returning the true total, repository, URL, draft flag, review decision, updated time, and review thread resolution state.

Status precedence:

1. Draft: dim text, regardless of reviews.
2. Active `CHANGES_REQUESTED` decision or an unresolved review thread: red comments/changes.
3. `APPROVED` without unresolved feedback: blue approved.
4. Otherwise: orange needs review.

Resolved and historical comments do not count. Unresolved threads are not filtered by author, bot, or outdated state. GitHub provides no unresolved-only thread filter. When the first 100 threads are all resolved and more exist, follow cursor pages until unresolved feedback is found or the connection is exhausted. Already-red and draft PRs need no additional pages. A failed or incomplete page aborts the refresh, preserving the last good data.

References: [PullRequest](https://docs.github.com/en/graphql/reference/objects#pullrequest), [PullRequestReviewThread](https://docs.github.com/en/graphql/reference/objects#pullrequestreviewthread), [pagination](https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api), [rate limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api). A live query returned 61 PRs for one point; additional thread pages add calls when necessary.

## Refresh, count and errors

Fetch at startup, every 60 seconds, and on show. Drawing reads atoms and never runs processes. A module-level busy guard prevents overlapping refreshes. Failures preserve the last successful list and timestamp and show an error in the band. These are polling updates, normally visible within one minute plus API latency.

The count and refresh time belong in the band header. `$.ui.status` cannot choose a color or icon: the installed pinned-notice renderer prepends the warning symbol and defaults to warning color even for event notices. Clear the old status at startup and do not publish the count to that footer.

Browser opening tries macOS `open`, then Linux `xdg-open`, accepting HTTPS URLs only. Failure displays a toast. Windows opening and search pagination beyond 100 PRs remain outside scope.

## Verification

Claude Code 2.1.287 passed validation, 17 SDK tests, headless proof of load, and interactive rendering. The SDK tests cover statuses, sorting, paging, composition, refresh and failure retention, review-thread pagination, and browser opening. Typechecking passed; changing approved from blue to green made the rendered-color tests fail.

An isolated terminal session verified show/hide/show, arrows, page focus, all three exclusive sort shortcuts, Enter with `open` exit 0, and Esc. Its captures showed the two dim separator rules and red, blue and orange PR foregrounds with no explicit band background colors. Native Warp translucency was confirmed by the user for the preceding band implementation; the updated colors and separators remain available for their visual inspection.
