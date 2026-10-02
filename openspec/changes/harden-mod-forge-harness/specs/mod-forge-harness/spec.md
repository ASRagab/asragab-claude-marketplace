# Spec Delta

## Purpose

Defines the staged runner that exercises a Claude Code mod in processes separate from the invoking session, and the evidence each stage must produce so an agent can verify a mod without a person watching.

## ADDED Requirements

### Requirement: Staged execution with fail-fast ordering
The harness SHALL run a mod through these stages in order: static validation, engine tests, headless run, type check, interactive run. It SHALL stop at the first failing stage, name that stage in its output, and exit non-zero. It SHALL exit zero only when every requested stage passed.

#### Scenario: Static validation fails
- **WHEN** the mod's `hooks.json` names a module path that does not exist
- **THEN** the harness reports the validation stage as failed, runs no later stage, and exits non-zero

#### Scenario: All stages pass
- **WHEN** a well-formed mod with a passing test file is run with all stages
- **THEN** each stage is reported as passed with its evidence path and the harness exits zero

#### Scenario: Type check fails after earlier stages pass
- **WHEN** a mod has a type error that validation, tests, and the headless run accept
- **THEN** the harness reports the type check stage as failed, runs no interactive stage, and exits non-zero

### Requirement: Screen evidence for interactive runs
The interactive stage SHALL start the child in a detached tmux session sized to a width and height (120 by 40 unless the caller sets them), drive it through first-run prompts, wait for a caller-supplied expected string to appear in the captured screen within a bounded time, and kill the tmux session on every exit path. It SHALL save the final capture to the run directory as plain text, as a capture that keeps color escape sequences, and as the child's raw terminal output stream.

#### Scenario: Status line appears
- **WHEN** a mod sets a status line in `session.start` and the expected text is the status text
- **THEN** the capture contains that text, the stage passes, and the tmux session no longer exists

#### Scenario: Expected text never appears
- **WHEN** the expected string is absent after the time bound
- **THEN** the stage fails, the last capture is saved, and the tmux session is killed

#### Scenario: Caller sets the terminal size
- **WHEN** the caller requests a width of 160 and a height of 40
- **THEN** the tmux session is created at that size and the saved capture has lines of up to 160 columns

#### Scenario: Color evidence is kept
- **WHEN** an interactive run completes
- **THEN** the run directory holds the plain-text capture, a capture with color escape sequences, and the raw output stream, and replaying the raw stream in a terminal emulator reproduces the cell background colors the child drew

### Requirement: Interactive proof of load
The interactive stage SHALL NOT pass on matching screen text alone. It SHALL also require that the mod wrote its marker file with the expected content in that run and that the child's debug log names the mod's module as loaded. When either is missing, the stage SHALL fail and name what is missing.

#### Scenario: Mod throws at import and the expected text is on the startup screen
- **WHEN** a mod whose module throws at import is run with an expected string that appears in the startup banner
- **THEN** the stage fails, names the missing marker and module-load evidence, and does not report a pass

#### Scenario: Mod loads and shows its text
- **WHEN** the marker exists with the expected content, the debug log names the module as loaded, and the expected text appears
- **THEN** the stage passes

### Requirement: Scripted interactive input
The interactive stage SHALL accept a script of steps, each either keys to send to the session or text to wait for, run in order after the child reaches its prompt. It SHALL save a plain-text capture after each step and SHALL fail at the first step whose expected text does not appear within the time bound, naming the step.

#### Scenario: Open a pane and move the cursor
- **WHEN** a script types a slash command that opens a pane, waits for the pane's header text, sends a Down key, and waits for the pane text again
- **THEN** the run directory holds one capture per step and the stage passes only if every wait succeeded

#### Scenario: A step's text never appears
- **WHEN** the second step waits for text the mod never draws
- **THEN** the stage fails naming that step, the captures up to that step are saved, and the tmux session is killed

### Requirement: Type check stage
The type check stage SHALL run a TypeScript compiler over the run copy of the mod using the declarations and `tsconfig.json` the engine wrote into it, and SHALL fail on any diagnostic. It SHALL fail naming the prerequisite when the engine has not yet written those declarations in this run, and SHALL fail naming the compiler when none is available. It SHALL NOT be skipped.

#### Scenario: Clean mod
- **WHEN** the mod has no type errors and the headless stage ran earlier in the same run
- **THEN** the stage passes and its evidence is the compiler output

#### Scenario: Declarations not yet written
- **WHEN** the type check is requested without a live stage having loaded the mod in the same run
- **THEN** the stage fails stating that the engine-written declarations are missing

#### Scenario: No compiler
- **WHEN** no TypeScript compiler is on the path and neither `bunx` nor `npx` is available
- **THEN** the harness fails naming the compiler as the missing precondition and does not report the stage as passed or skipped

### Requirement: Headless child exit status is part of the verdict
The headless stage SHALL record the child's exit status and SHALL fail the stage when it is non-zero, whatever evidence the child produced.

#### Scenario: Child exits non-zero after producing evidence
- **WHEN** the child writes the marker, prints a successful JSON result, and exits with status 9
- **THEN** the stage fails and its output names the exit status

### Requirement: The harness home is an absolute path
The harness SHALL resolve `MOD_FORGE_HOME` to an absolute path, relative to the directory it was invoked from, before it changes directory for any stage, and every path derived from it SHALL be absolute.

#### Scenario: Relative home keeps the config cache
- **WHEN** `MOD_FORGE_HOME=forge` is set and two runs are started from the same directory
- **THEN** both runs use the same config directory under that resolved path and the second run does not repeat onboarding

### Requirement: The harness home is private
The harness SHALL create its home with mode `0700`. When the home already exists the harness SHALL use it only if it is a real directory owned by the current user with no group or other permissions, and otherwise SHALL refuse before starting any live stage, naming the path and the reason.

#### Scenario: Fresh home
- **WHEN** the home does not exist
- **THEN** it is created with mode `0700`

#### Scenario: Existing home open to others
- **WHEN** the home exists with mode `0755`
- **THEN** the harness refuses to run live stages, names the path and the mode, and starts no child

#### Scenario: Home is a symlink
- **WHEN** the home path is a symlink
- **THEN** the harness refuses to run live stages and names the path
