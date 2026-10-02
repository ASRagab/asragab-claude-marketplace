# Postmortem: building `pr-pane` with mod-forge

Session: one conversation that used the lifted `mod-forge` plugin (the `build-claude-mod` skill and `scripts/run-mod.sh`) to build a Claude Code mod, `pr-pane`, a `/prs` pane listing the user's open GitHub PRs with review state, arrow-key navigation, and open-in-browser. The mod was built, verified, redesigned twice from screenshots, and merged into this repository as the `pr-pane` plugin. Evidence below is from run directories and captures made during that session.

## What worked well

- **Isolation held.** Live stages ran under a harness-owned config directory; the real `~/.claude` was not written. Four stages passed in about a minute per run, and the headless stage cost between about $0.013 and $0.026.
- **Proof of load was cheap and concrete.** The marker file plus the `hooks module <name>@inline loaded` debug line made "the mod loaded" checkable on every run.
- **Engine tests covered behavior without a network.** `claude plugin test` with the mock clock, environment, and process hooks tested the toggle, the 60 second refresh, a failed refresh keeping the last list, and a select opening a URL. Breaking the state mapping on purpose made two tests fail, so the tests were able to fail.
- **Reading the generated declarations instead of recalling the API paid off.** It surfaced that in a focused pane Tab walks elements and arrow keys only scroll, which decided the choice of the `Select` element, and it supplied the exact test kit shapes.
- **Checking the data source before coding.** Running the GitHub GraphQL query once in a shell showed the search returns at most the requested page and that `reviewDecision` exists only there; a later check showed 58 open PRs against a first-draft cap of 50.
- **The skill's location rule held.** Writing the mod under the harness workspace meant no "Enable hot reloading" prompt and no file under `~/.claude/dev-mods/`, even though the `plugin-authoring` skill was loaded in the same session.

## What had friction

- **Two skills, one of them arming a watch.** The API types file is reachable only by loading `plugin-authoring`, which starts a watch on `~/.claude/dev-mods/` and tells the agent to write there. The build skill overrides the location, but the first write there would have prompted the user. It worked because the agent followed the build skill.
- **A 20,000-line declaration file.** Grepping for names worked, but there is no helper and the right declaration is easy to miss (the pane focus rules were in a different place from the element props).
- **Fixed terminal size.** The interactive stage runs at 120 by 40. A pane the mod opens unasked is drawn only from 144 columns, so a mod that opens its pane on its own would pass nothing visible there.
- **`--expect` is easy to satisfy loosely.** The expected text `PRs` matched the mod's status line, which was fine here, but the same stage would accept a banner string. The status line also appeared with a warning glyph, which took a debug-log search to rule out as a failure.
- **Command safety hook friction.** The environment blocked shell redirects to paths built from variables and recursive deletes. Probes had to be written as script files. This is environment-specific rather than a harness defect, but agent-written verification scripts hit it twice.
- **Workspace trust prompt.** A bare-pty probe started in a new directory stopped at the trust prompt. The harness answers the prompt only inside its own run directory.
- **Two spellings of one path.** Output alternated between `/var/folders/...` and `/private/var/folders/...` on macOS, which made evidence paths look different when they were the same.

## What failed (the harness passed or could not see it)

1. **Type errors passed every stage.** `validate`, `test`, `headless`, and `interactive` all passed while the module used a `Select` element that the mobile surface does not have, a test used `setTimeout` (not defined in the module environment), and later an indexed access was possibly undefined. A manual `tsc -p` over the engine-written run copy found each one. This is the strongest argument for a type check stage.
2. **The feature itself was never driven by the harness.** The interactive stage matched the status line `PRs: N open`. The pane, the cursor, and the Enter path were checked only by scripts the agent wrote around tmux, and Enter was never exercised live. The harness cannot type a command or a key.
3. **Color was invisible.** The user's screenshot showed the pane with a solid grey fill that the rest of the screen lacked. Plain tmux captures and 256-color captures showed no fill on the pane body. Replaying the raw bytes of a bare-pty run through a terminal emulator showed the engine painting the whole docked pane (every row, columns 49 to 159 at 160 wide) with truecolor `#262626`, and a `Box` background test showed a mod can repaint cells but cannot make them transparent. Why tmux's capture differed is not established.
4. **A wrong element assumption survived until a live capture.** `Select` was expected to draw a list. It draws a dropdown that is open on arrival, ends in `… N more`, and, when given a preselected value, repeats that row above the list. Both were found from captures and screenshots, not from tests.
5. **The four review findings** are real defects in the harness itself: interactive passes before the mod loads (the marker is passed to the child but never read), headless discards the exit status, a relative `MOD_FORGE_HOME` loses the config cache, and the default home under a shared temp directory has no ownership or mode check.
6. **A cap the tests could not catch.** A search page of 50 hid the true total of 58. A real-data check found it; no stage could have.

## Improvements this change proposes

| Finding | Addressed by |
| --- | --- |
| Type errors pass all stages (1) | `typecheck` stage after headless |
| Feature never driven (2) | `--script` steps with per-step captures |
| Fixed size, 144-column floor | `--cols`, `--rows` |
| Color invisible (3) | `screen.ansi`, `stream.raw`, and the skill's color-evidence rule |
| Loose `--expect`, interactive passes before load (5) | interactive proof of load |
| Exit status, relative home, shared home (5) | exit status check, absolute home, private home |
| Report said UI verified from a status line (2) | skill report separates status line from drawn and driven |

Not addressed here: the two-skill ordering friction, the declaration file size, the command safety hook, the trust prompt outside the run directory, and theme passthrough (one inconclusive attempt). The data-cap issue (6) is outside the harness.
