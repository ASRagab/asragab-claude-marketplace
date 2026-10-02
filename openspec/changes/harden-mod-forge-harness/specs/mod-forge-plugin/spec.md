# Spec Delta

## MODIFIED Requirements

### Requirement: Harness keeps its fail-loud behavior
The packaged harness SHALL NOT gain opt-in flags that gate or weaken a stage, dry-run defaults, mock fallbacks, or silently skipped stages, and its entry script SHALL be executable.

#### Scenario: Entry script stays executable
- **WHEN** the mode of `plugins/mod-forge/scripts/run-mod.sh` is read
- **THEN** the owner execute bit is set

#### Scenario: Missing precondition fails loudly
- **WHEN** a live stage is requested and `ANTHROPIC_API_KEY` is unset
- **THEN** the harness exits 2 and names `ANTHROPIC_API_KEY`
- **AND** the stage is not reported as passed or skipped

#### Scenario: Input options leave verdicts unchanged
- **WHEN** the interactive stage is run with a terminal size or a script of steps
- **THEN** every check that runs without them still runs and still decides the stage's verdict
