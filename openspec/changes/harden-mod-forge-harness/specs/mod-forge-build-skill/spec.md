# Spec Delta

## Purpose

Defines what the `build-claude-mod` skill requires of an agent before it reports a Claude Code mod as working, and how the agent must describe UI and color evidence, so a passing report means what it says.

## ADDED Requirements

### Requirement: Definition of done
The skill SHALL require, before the agent reports a mod as working: a passing validation stage, at least one `*.test.ts` that asserts the requested behavior and passes, a passing headless stage with a proof-of-load side effect, a passing type check stage, and, when the mod draws UI or sets a status line, a passing interactive stage that includes proof of load and whose capture contains the expected text. When the mod draws a pane, band, or other element that needs input to appear, the interactive stage SHALL be scripted to produce it. The agent's report SHALL state which stages ran, which passed, and which were not applicable, SHALL NOT describe an unrun stage as passed, and SHALL say whether the UI evidence is limited to a status line or shows the drawn element and its interaction.

#### Scenario: Behavior-only mod
- **WHEN** a mod only rewrites a prompt and has no UI
- **THEN** the report lists validation, tests, headless, and type check as passed and the interactive stage as not applicable with the reason

#### Scenario: UI mod without interactive proof
- **WHEN** a mod draws a pane and the interactive stage did not run
- **THEN** the report states the UI is unverified

#### Scenario: Pane mod verified by status line only
- **WHEN** a mod draws a pane that is opened by a slash command and the interactive stage only matched the mod's status line
- **THEN** the report states the pane itself is unverified

#### Scenario: Type error the other stages accept
- **WHEN** validation, tests, and headless pass but the type check fails
- **THEN** the agent fixes the error and reruns, and does not report the mod as working

### Requirement: Color and layout claims cite color evidence
The skill SHALL tell the agent that a plain-text screen capture cannot establish background or foreground color, and that any statement about color or background SHALL cite the color-escape capture or the raw output stream the interactive stage saves.

#### Scenario: Background question
- **WHEN** a person asks why a pane's background differs from the rest of the screen
- **THEN** the agent answers from the color capture or raw stream and not from the plain-text capture
