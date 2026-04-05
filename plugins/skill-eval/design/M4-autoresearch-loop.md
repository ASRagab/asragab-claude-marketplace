# M4: Autoresearch Loop — Design Document

**Status:** Draft
**Date:** 2026-03-24
**Plugin:** skill-eval
**Script:** `scripts/autoresearch-loop.ts`, `scripts/eval-harness.ts`

---

## 1. Overview

M4 takes a ranked target from M3 (`targets.jsonl`) and runs an autoresearch-style optimization loop: read the mutable artifact, hypothesize an improvement, make one edit, evaluate against a scoring harness, and keep the change (git commit) or revert it (git reset). The loop repeats until a stopping condition is met. This is a direct adaptation of Karpathy's autoresearch pattern — three files (`program.md`, the mutable artifact, and the eval harness) — applied to skill/prompt/code improvement rather than research paper generation.

The critical insight from prior art: the eval harness is immutable during the loop. The agent can only edit the artifact. If the eval is wrong, you fix it before starting the loop, not during. This separation prevents the optimizer from gaming its own scoring function.

---

## 2. Goals & Non-Goals

### Goals

- **G1:** Given a target from M3 (with path, description, and eval criteria), run an automated improvement loop that produces a measurably better artifact.
- **G2:** Use git as the state machine — commit on improvement, hard-reset on regression. Every committed state is at least as good as the previous.
- **G3:** Log every round (hypothesis, diff, score before/after, keep/revert) to an experiment log for auditability.
- **G4:** Support multiple execution backends: Claude Code `--print` mode, direct Anthropic API calls, and Zo `/zo/ask`.
- **G5:** Support multiple eval strategies: LLM-as-judge (API), programmatic checks (script exit code), and hybrid (both).
- **G6:** Enforce stopping criteria: max rounds, score plateau, convergence threshold.
- **G7:** Generate a `program.md` from M3 target data, or accept a hand-written one.

### Non-Goals

- **NG1:** Identifying what to optimize (that's M3).
- **NG2:** Modifying the eval harness during the loop (immutable by design).
- **NG3:** Multi-artifact optimization (one artifact per loop run).
- **NG4:** Parallel optimization of multiple targets simultaneously (run separate loops).
- **NG5:** Training or fine-tuning models (this operates on prompts/skills/code, not weights).
- **NG6:** Automated eval criteria generation (M3 generates criteria; M4 consumes them).

---

## 3. Architecture

```
                    ┌─────────────────────┐
                    │  Target Loader       │
                    │  (from M3 targets    │
                    │   or manual setup)   │
                    └──────────┬──────────┘
                               │ TargetConfig
                               ▼
                    ┌─────────────────────┐
                    │  Program Generator   │
                    │  (program.md from    │
                    │   target + template) │
                    └──────────┬──────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │         Loop Runner             │
              │                                │
              │  ┌────────────────────────┐    │
              │  │ 1. Read State          │    │
              │  │    artifact + log +    │    │
              │  │    program.md          │    │
              │  └──────────┬─────────────┘    │
              │             ▼                  │
              │  ┌────────────────────────┐    │
              │  │ 2. Hypothesize + Edit  │    │
              │  │    (agent call via     │    │
              │  │     selected backend)  │    │
              │  └──────────┬─────────────┘    │
              │             ▼                  │
              │  ┌────────────────────────┐    │
              │  │ 3. Eval               │    │
              │  │    (eval-harness.ts)   │    │
              │  └──────────┬─────────────┘    │
              │             ▼                  │
              │  ┌────────────────────────┐    │
              │  │ 4. Keep / Revert      │    │
              │  │    git commit or       │    │
              │  │    git reset --hard    │    │
              │  └──────────┬─────────────┘    │
              │             ▼                  │
              │  ┌────────────────────────┐    │
              │  │ 5. Log + Check Stop   │    │
              │  └──────────┬─────────────┘    │
              │             │                  │
              │      ┌──────┴──────┐           │
              │      │ continue?   │           │
              │      └──────┬──────┘           │
              │        yes  │  no              │
              │        ┌────┘  └────┐          │
              │        ▼            ▼          │
              │    loop back    exit loop      │
              └────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Output:             │
                    │  - improved artifact │
                    │  - experiment-log    │
                    │  - summary report    │
                    └─────────────────────┘
```

### Key design decisions

1. **Git is the state machine.** Every improvement is a commit. Every regression is a hard reset. The git log IS the history of successful changes. No separate undo mechanism needed.
2. **Eval is immutable.** The agent never sees or modifies `eval.ts`. If the eval is wrong, you stop the loop, fix the eval, and restart. This is the core insight from George's Three Gulfs — "Take 1 failed because the auto-generated judge measured the wrong things."
3. **One edit per round.** The agent makes exactly one change to the artifact per round. This keeps diffs small, attribution clear, and rollback clean.
4. **Backend-agnostic execution.** The "hypothesize + edit" step can use different backends depending on context: Claude Code `--print` for local runs, Anthropic API for headless, Zo `/zo/ask` for remote.

---

## 4. Target Setup

### 4.1 From M3 (automated)

When M3 produces a target, auto-generate the target directory:

```typescript
interface M3Target {
  rank: number;
  target_type: "skill" | "prompt" | "tool_pattern" | "code" | "missing_capability";
  target_name: string;
  target_path?: string;
  description: string;
  evidence_sessions: string[];       // session IDs where friction was observed
  suggested_eval_criteria: string[];
  friction_summary: string;
  judge_critique: Record<string, string>;
  score: { frequency: number; severity: number; improvability: number; composite: number };
}
```

The loader reads `targets.jsonl`, selects a target (by rank or name), and scaffolds:

```
targets/<target-name>/
├── program.md           # Generated from template + M3 data
├── eval.ts              # Generated from M3 eval criteria
├── inputs.jsonl         # Generated from M3 friction evidence
├── golden.jsonl         # Empty — requires manual annotation
├── artifact-path.txt    # Points to the mutable file (e.g., Skills/zo-memory-system/SKILL.md)
└── experiment-log.jsonl # Populated during the loop
```

### 4.2 Manual setup

For targets not from M3 (ad-hoc optimization), the user creates the directory manually. The only required files are `program.md`, `eval.ts`, and `artifact-path.txt`.

### 4.3 artifact-path.txt

A single line containing the absolute path to the mutable artifact. The loop reads this to know what file the agent should edit.

```
/home/workspace/Skills/zo-memory-system/SKILL.md
```

**Why a separate file?** The artifact may live anywhere in the workspace. The target directory is self-contained metadata; the artifact is the thing being optimized. This separation means you can optimize any file without copying it.

---

## 5. program.md Template

The program.md is the agent's instructions for each round. It follows Karpathy's pattern: describe the task, the constraints, what to try, and what's off-limits.

```markdown
# Optimization Program: {{target_name}}

## Objective
{{description}}

## Mutable Artifact
`{{artifact_path}}`

You may ONLY edit this file. Do not create new files. Do not modify the eval.

## Friction Context
{{friction_summary}}

## What to Try
Based on analysis of {{evidence_count}} friction events across {{session_count}} sessions:
{{#each suggested_directions}}
- {{this}}
{{/each}}

## Constraints
- Make ONE focused change per round.
- Do not add comments explaining your changes (the diff is the explanation).
- Do not reorganize or reformat unchanged sections.
- Do not add features unrelated to the friction being addressed.
- Preserve the artifact's existing structure and conventions.

## Eval Criteria
Your changes will be scored against these binary checks:
{{#each eval_criteria}}
{{@index}}. {{this}}
{{/each}}

## History
Review the experiment log before each round. Do not repeat failed hypotheses.
If the last 3 rounds were all reverted, try a fundamentally different approach.

## Stop Conditions
The loop will stop automatically when:
- Maximum {{max_rounds}} rounds reached
- Score >= {{convergence_threshold}} for {{convergence_count}} consecutive rounds
- Score has not improved for {{plateau_rounds}} consecutive rounds
```

### 5.1 Suggested Directions Generation

The `suggested_directions` are derived from M3's judge critique and friction summary. The program generator extracts actionable suggestions:

```typescript
function generateDirections(target: M3Target): string[] {
  const directions: string[] = [];

  // From friction subcategories
  if (target.friction_summary.includes("user_correction")) {
    directions.push("Clarify ambiguous instructions that lead to user corrections");
  }
  if (target.friction_summary.includes("tool_error")) {
    directions.push("Add error handling guidance or preconditions to prevent tool failures");
  }
  if (target.friction_summary.includes("retry")) {
    directions.push("Improve first-attempt accuracy to reduce retry patterns");
  }
  if (target.friction_summary.includes("long_chain")) {
    directions.push("Consolidate multi-step workflows into more efficient patterns");
  }

  // Always include generic directions
  directions.push("Add examples for common failure cases identified in the friction data");
  directions.push("Remove or clarify instructions that are consistently misinterpreted");

  return directions;
}
```

---

## 6. Eval Harness Design

### 6.1 Overview

`eval-harness.ts` is a standalone script that scores the current state of the mutable artifact against test cases. It returns a single aggregate score (0.0 – 1.0) plus per-case results.

### 6.2 Eval Strategies

Three eval modes, selected via `--eval-mode`:

#### Mode 1: LLM-as-Judge (`llm`)

Each test input is processed by the artifact (skill/prompt), then an LLM judge scores the output against binary criteria.

```typescript
interface LLMJudgeEval {
  mode: "llm";
  model: string;           // e.g., "claude-sonnet-4-6"
  criteria: string[];      // binary yes/no questions from M3
  artifact_path: string;   // the skill/prompt being evaluated
  inputs_path: string;     // test inputs (JSONL)
}
```

**Flow:**
1. Load inputs from `inputs.jsonl`
2. For each input: simulate the artifact's behavior (or replay with the artifact applied)
3. Send each output + criteria to the judge model
4. Judge returns pass/fail per criterion
5. Aggregate: `score = passed_criteria / total_criteria`

#### Mode 2: Programmatic (`script`)

The eval is a script that exits 0 (pass) or 1 (fail) per test case. For code artifacts where correctness is mechanically verifiable.

```typescript
interface ScriptEval {
  mode: "script";
  command: string;         // e.g., "bun test" or "python run_tests.py"
  pass_pattern?: string;   // regex to extract pass count from stdout
  total_pattern?: string;  // regex to extract total count
}
```

#### Mode 3: Hybrid (`hybrid`)

Run programmatic checks first (fast, cheap), then LLM-as-judge on the subset that passes programmatic checks (slower, richer signal).

```typescript
interface HybridEval {
  mode: "hybrid";
  script: ScriptEval;      // programmatic gate
  llm: LLMJudgeEval;       // judge for script-passing cases
  script_weight: number;   // 0.0 - 1.0, default 0.4
  llm_weight: number;      // 0.0 - 1.0, default 0.6
}
```

### 6.3 LLM Judge Prompt

```markdown
# Eval Judge

You are evaluating whether an AI agent's output meets specific quality criteria.

## Agent Output
{{output}}

## Context
- **Input:** {{input}}
- **Artifact:** {{artifact_name}}

## Criteria
For each criterion, respond Pass or Fail. No explanation needed.

{{#each criteria}}
{{@index}}. {{this}}
{{/each}}

## Response Format
```json
{
  "verdicts": ["Pass" | "Fail", ...],
  "score": 0.0-1.0
}
```
```

### 6.4 Test Inputs (inputs.jsonl)

Each line is a test case:

```jsonc
{
  "id": "tc-001",
  "input": "The user message or scenario that triggers the artifact",
  "context": "Optional additional context (e.g., conversation history)",
  "golden_output": "Optional expected output for reference (not used in scoring, just for human review)",
  "tags": ["temporal_query", "memory_search"]  // for filtering/grouping
}
```

**Generation from M3 evidence:** M3's friction events contain the actual user messages and tool contexts that caused problems. These are converted to test inputs:

```typescript
function frictionToTestInput(event: EnrichedFrictionEvent): TestInput {
  return {
    id: `friction-${event.session_id}-${event.sequence}`,
    input: event.text || event.tool_input?.toString() || "",
    context: event.preceding_events.map(e => e.text || "").join("\n"),
    tags: [event.classification.subcategory],
  };
}
```

### 6.5 Output Schema

```typescript
interface EvalResult {
  timestamp: string;
  artifact_path: string;
  artifact_hash: string;         // git short hash of the artifact at eval time
  eval_mode: "llm" | "script" | "hybrid";
  total_cases: number;
  passed_cases: number;
  score: number;                 // 0.0 - 1.0
  per_case: CaseResult[];
  duration_ms: number;
  cost_usd?: number;            // estimated API cost (LLM mode only)
}

interface CaseResult {
  input_id: string;
  passed: boolean;
  verdicts?: string[];           // per-criterion (LLM mode)
  output?: string;               // truncated agent output
  error?: string;                // if the case errored
}
```

### 6.6 CLI Interface

```bash
# Run eval on current artifact state
bun scripts/eval-harness.ts \
  --target targets/zo-memory-system/ \
  --eval-mode llm \
  --model claude-sonnet-4-6

# Programmatic eval
bun scripts/eval-harness.ts \
  --target targets/my-code-fix/ \
  --eval-mode script \
  --command "bun test"

# Output as JSON (for loop consumption)
bun scripts/eval-harness.ts \
  --target targets/zo-memory-system/ \
  --json
```

---

## 7. Execution Backends

The "hypothesize + edit" step needs an agent to read the artifact, the program.md, and the experiment log, then make one edit. Three backend options:

### 7.1 Claude Code `--print` mode

```typescript
interface ClaudeCodeBackend {
  type: "claude-code";
  model?: string;           // default: system default
  maxTokens?: number;       // default: 4096
}

async function executeClaudeCode(
  prompt: string,
  artifactPath: string,
  config: ClaudeCodeBackend
): Promise<string> {
  const args = ["claude", "--print", "--output-format", "text"];
  if (config.model) args.push("--model", config.model);

  const proc = Bun.spawn(args, {
    stdin: new TextEncoder().encode(prompt),
    cwd: path.dirname(artifactPath),
  });

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(`Claude Code exited with code ${proc.exitCode}`);
  }

  return output;
}
```

**Pros:** Full tool access (Read, Edit, Bash), understands the workspace natively.
**Cons:** Slower startup, harder to control token budget, requires Claude Code installed.

### 7.2 Direct Anthropic API

```typescript
interface AnthropicAPIBackend {
  type: "anthropic-api";
  model: string;            // e.g., "claude-sonnet-4-6"
  maxTokens: number;        // default: 4096
  apiKey?: string;          // from env ANTHROPIC_API_KEY
}
```

**Pros:** Fast, predictable, easy to control costs, works headless.
**Cons:** No tool access — agent must output the full edited file or a diff. Requires parsing the response to apply the edit.

### 7.3 Zo `/zo/ask`

```typescript
interface ZoAskBackend {
  type: "zo-ask";
  model?: string;
  identityToken?: string;   // from env ZO_CLIENT_IDENTITY_TOKEN
}
```

**Pros:** Full Zo tool access, works remotely, good for scheduled/automated runs.
**Cons:** Higher latency, requires Zo infrastructure.

### 7.4 Backend Selection Logic

```typescript
function selectBackend(config: LoopConfig): Backend {
  // Explicit override
  if (config.backend) return config.backend;

  // Auto-select based on environment
  if (isClaudeCodeAvailable()) return { type: "claude-code" };
  if (process.env.ZO_CLIENT_IDENTITY_TOKEN) return { type: "zo-ask" };
  if (process.env.ANTHROPIC_API_KEY) return { type: "anthropic-api", model: "claude-sonnet-4-6", maxTokens: 4096 };

  throw new Error("No execution backend available. Install Claude Code, set ANTHROPIC_API_KEY, or run on Zo.");
}
```

---

## 8. Loop Runner

### 8.1 Core Loop

```typescript
async function runLoop(config: LoopConfig): Promise<LoopResult> {
  const target = await loadTarget(config.targetDir);
  const backend = selectBackend(config);
  const artifactPath = await readArtifactPath(target);

  // Ensure clean git state
  await assertCleanGitState(artifactPath);

  // Create optimization branch
  const branchName = `autoresearch/${target.name}/${Date.now()}`;
  await gitCheckoutNewBranch(branchName);

  // Baseline eval
  let baseline = await runEval(target, config);
  let currentScore = baseline.score;
  const log: ExperimentRound[] = [];
  let consecutiveReverts = 0;
  let consecutiveConverged = 0;

  for (let round = 1; round <= config.maxRounds; round++) {
    // 1. Build prompt
    const prompt = buildRoundPrompt(target, artifactPath, currentScore, log, round);

    // 2. Execute agent (hypothesize + edit)
    const agentOutput = await executeBackend(backend, prompt, artifactPath);

    // 3. Verify artifact was actually modified
    const hasChanges = await gitHasChanges(artifactPath);
    if (!hasChanges) {
      log.push(makeNoChangeRound(round, agentOutput));
      consecutiveReverts++;
      if (consecutiveReverts >= config.maxConsecutiveReverts) break;
      continue;
    }

    // 4. Run eval
    const evalResult = await runEval(target, config);

    // 5. Keep or revert
    if (evalResult.score > currentScore) {
      await gitCommit(artifactPath, `autoresearch round ${round}: ${evalResult.score.toFixed(3)} (was ${currentScore.toFixed(3)})`);
      const diff = await gitDiffLastCommit();
      log.push(makeKeptRound(round, agentOutput, currentScore, evalResult, diff));
      currentScore = evalResult.score;
      consecutiveReverts = 0;

      // Convergence check
      if (currentScore >= config.convergenceThreshold) {
        consecutiveConverged++;
        if (consecutiveConverged >= config.convergenceCount) break;
      } else {
        consecutiveConverged = 0;
      }
    } else {
      // Score did not improve — revert the change.
      // Strict > is intentional: equal scores are reverted because we only want
      // monotonic improvement in the git history. Lateral movement (same score,
      // different content) is not valuable enough to commit.
      const diff = await gitDiffUnstaged();  // capture what was tried BEFORE reset
      await gitResetHard(artifactPath);
      log.push(makeRevertedRound(round, agentOutput, currentScore, evalResult, diff));
      consecutiveReverts++;

      // Plateau check: consecutive rounds where eval ran but score didn't improve
      if (consecutiveReverts >= config.plateauRounds) break;
    }

    // 6. Write experiment log after each round (crash-safe)
    await appendLog(target, log[log.length - 1]);
  }

  return {
    target: target.name,
    branch: branchName,
    baselineScore: baseline.score,
    finalScore: currentScore,
    rounds: log.length,
    keptRounds: log.filter(r => r.kept).length,
    revertedRounds: log.filter(r => !r.kept).length,
    log,
  };
}
```

### 8.2 Round Prompt Construction

Each round, the agent receives:

```typescript
function buildRoundPrompt(
  target: Target,
  artifactPath: string,
  currentScore: number,
  log: ExperimentRound[],
  round: number
): string {
  const programMd = readFileSync(path.join(target.dir, "program.md"), "utf-8");
  const artifact = readFileSync(artifactPath, "utf-8");
  const recentLog = log.slice(-5); // last 5 rounds for context

  return `${programMd}

## Current State (Round ${round})

**Current score:** ${currentScore.toFixed(3)}
**Rounds so far:** ${log.length} (${log.filter(r => r.kept).length} kept, ${log.filter(r => !r.kept).length} reverted)

### Current Artifact
\`\`\`
${artifact}
\`\`\`

### Recent Experiment History
${recentLog.map(r => `
Round ${r.round}: ${r.kept ? "KEPT" : "REVERTED"} (${r.score_before.toFixed(3)} → ${r.score_after.toFixed(3)})
Hypothesis: ${r.hypothesis}
${r.kept ? "" : "Why it failed: score did not improve"}
`).join("\n")}

## Your Task

1. Review the artifact and experiment history.
2. Form a hypothesis about ONE change that could improve the score.
3. Output the complete modified artifact.

Respond with ONLY:
- A one-line hypothesis (prefixed with "HYPOTHESIS: ")
- The complete modified artifact content (in a code block)

Do not explain your reasoning. Do not include multiple alternatives.`;
}
```

### 8.3 Response Parsing

```typescript
interface AgentResponse {
  hypothesis: string;
  newContent: string;
}

function parseAgentResponse(output: string): AgentResponse {
  // Extract hypothesis
  const hypMatch = output.match(/HYPOTHESIS:\s*(.+)/i);
  const hypothesis = hypMatch?.[1]?.trim() || "No hypothesis stated";

  // Extract code block content
  const codeMatch = output.match(/```[\w]*\n([\s\S]*?)```/);
  if (!codeMatch) {
    throw new Error("Agent response did not contain a code block with the modified artifact");
  }

  return { hypothesis, newContent: codeMatch[1] };
}
```

After parsing, the loop writes `newContent` to the artifact path and proceeds to eval.

---

## 9. Git Operations

### 9.1 Branch Strategy

Each optimization run creates a new branch:

```
autoresearch/<target-name>/<timestamp>
```

Example: `autoresearch/zo-memory-system/1711324800000`

This means:
- The original artifact is preserved on the base branch
- Multiple optimization runs can coexist
- The user can `git diff main..autoresearch/zo-memory-system/latest` to see all changes
- Failed experiments are fully isolated

### 9.2 Commit Messages

```
autoresearch round 3: 0.720 (was 0.640)

Hypothesis: Add temporal query examples to memory search instructions
Target: Skills/zo-memory-system/SKILL.md
Eval: 22/30 passed (was 19/30)
```

### 9.3 Safety Checks

```typescript
async function assertCleanGitState(artifactPath: string): Promise<void> {
  // 1. No uncommitted changes to the artifact
  const status = await gitStatus(artifactPath);
  if (status !== "") {
    throw new Error(`Artifact has uncommitted changes. Commit or stash before running autoresearch.\n${status}`);
  }

  // 2. Artifact is tracked by git
  const isTracked = await gitIsTracked(artifactPath);
  if (!isTracked) {
    throw new Error(`Artifact is not tracked by git: ${artifactPath}`);
  }
}
```

---

## 10. Stopping Criteria

```typescript
interface StoppingConfig {
  maxRounds: number;               // default: 20
  convergenceThreshold: number;    // default: 0.95
  convergenceCount: number;        // default: 3 (consecutive rounds at threshold)
  plateauRounds: number;           // default: 5 — consecutive rounds where eval ran but
                                   // score did not improve (agent tried, change was bad)
  maxConsecutiveReverts: number;   // default: 5 — consecutive rounds where agent produced
                                   // no change to the artifact (agent is stuck/looping).
                                   // Separate from plateauRounds: plateau = bad changes,
                                   // maxConsecutiveReverts = no changes at all.
  maxCostUsd?: number;             // optional cost cap for LLM eval mode
}

function shouldStop(config: StoppingConfig, state: LoopState): StopReason | null {
  if (state.round >= config.maxRounds) return "max_rounds";
  if (state.consecutiveConverged >= config.convergenceCount) return "converged";
  if (state.consecutiveReverts >= config.plateauRounds) return "plateau";
  if (config.maxCostUsd && state.totalCostUsd >= config.maxCostUsd) return "cost_cap";
  return null; // continue
}

type StopReason = "max_rounds" | "converged" | "plateau" | "cost_cap";
```

---

## 11. Experiment Log Schema

Each round appends one line to `experiment-log.jsonl`:

```typescript
interface ExperimentRound {
  round: number;
  timestamp: string;
  hypothesis: string;
  change_summary: string;        // first 200 chars of the diff
  score_before: number;
  score_after: number;
  kept: boolean;
  diff: string;                  // full unified diff
  eval_details: {
    total_cases: number;
    passed_cases: number;
    per_criterion_pass_rate?: Record<string, number>;  // criterion text -> pass rate
    duration_ms: number;
    cost_usd?: number;
  };
  backend: "claude-code" | "anthropic-api" | "zo-ask";
  model?: string;
  stop_reason?: StopReason;     // only on final round
}
```

The log is append-only and crash-safe — written after each round, not batched. If the loop crashes mid-run, all completed rounds are preserved.

---

## 12. Summary Report

At loop completion, generate a human-readable summary:

```typescript
interface LoopSummary {
  target_name: string;
  artifact_path: string;
  branch: string;
  baseline_score: number;
  final_score: number;
  improvement: number;           // final - baseline
  total_rounds: number;
  kept_rounds: number;
  reverted_rounds: number;
  stop_reason: StopReason;
  top_hypotheses: string[];      // hypotheses from kept rounds
  duration_minutes: number;
  total_cost_usd?: number;
}
```

Output to stderr (always) and optionally to a `summary.md` file:

```markdown
# Autoresearch Summary: zo-memory-system

**Score:** 0.56 → 0.78 (+0.22)
**Rounds:** 15 (8 kept, 7 reverted)
**Branch:** `autoresearch/zo-memory-system/1711324800000`
**Stop reason:** plateau (5 consecutive reverts)
**Duration:** 12 minutes
**Cost:** ~$0.45

## Kept Changes (in order)
1. Round 2: Added temporal query examples (+0.08)
2. Round 4: Clarified entity extraction instructions (+0.04)
3. Round 5: Added negative examples for irrelevant matches (+0.06)
...

## Recommendation
Review the branch diff: `git diff main..autoresearch/zo-memory-system/1711324800000`
If satisfied, merge to main.
```

---

## 13. Configuration

```typescript
interface LoopConfig {
  // Target
  targetDir: string;              // path to target directory

  // Execution backend
  backend?: "claude-code" | "anthropic-api" | "zo-ask";
  model?: string;                 // default varies by backend
  maxTokens?: number;             // default: 4096

  // Eval
  evalMode: "llm" | "script" | "hybrid";
  evalModel?: string;             // default: "claude-sonnet-4-6" (for llm mode)

  // Stopping
  maxRounds: number;              // default: 20
  convergenceThreshold: number;   // default: 0.95
  convergenceCount: number;       // default: 3
  plateauRounds: number;          // default: 5

  // Cost control
  maxCostUsd?: number;            // optional cap

  // Output
  outputDir?: string;             // default: target dir
  verbose: boolean;               // default: false
  dryRun: boolean;                // default: false (show what would happen without executing)
}
```

---

## 14. CLI Interface

```bash
# Basic usage with a target from M3
bun scripts/autoresearch-loop.ts \
  --target targets/zo-memory-system/ \
  --max-rounds 20

# Use specific backend and model
bun scripts/autoresearch-loop.ts \
  --target targets/zo-memory-system/ \
  --backend anthropic-api \
  --model claude-sonnet-4-6 \
  --eval-mode llm

# Programmatic eval (for code targets)
bun scripts/autoresearch-loop.ts \
  --target targets/my-code-fix/ \
  --eval-mode script \
  --max-rounds 10

# Dry run — show target setup without running
bun scripts/autoresearch-loop.ts \
  --target targets/zo-memory-system/ \
  --dry-run

# Cost-capped run
bun scripts/autoresearch-loop.ts \
  --target targets/zo-memory-system/ \
  --max-cost 5.00

# Full pipeline from M3 output
bun scripts/autoresearch-loop.ts \
  --from-targets targets.jsonl \
  --rank 1 \
  --max-rounds 20

# Verbose output (per-round details to stderr)
bun scripts/autoresearch-loop.ts \
  --target targets/zo-memory-system/ \
  --verbose
```

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Loop completed, score improved |
| 1 | Loop completed, no improvement (score unchanged from baseline) |
| 2 | Invalid arguments or target setup |
| 3 | Git state error (uncommitted changes, untracked artifact) |
| 4 | Backend unavailable |
| 5 | Cost cap reached |

---

## 15. Implementation Plan

### Phase 1: Target Loader & Program Generator (Day 1)

1. **Define TypeScript types** in `src/autoresearch/types.ts` — `LoopConfig`, `ExperimentRound`, `LoopResult`, `LoopSummary`, target types.
2. **Build target loader** in `src/autoresearch/target.ts` — reads target directory, validates required files, loads M3 target data.
3. **Build program.md generator** in `src/autoresearch/program.ts` — template rendering from M3 target fields.
4. **Build `artifact-path.txt` reader** — resolve and validate the artifact path.

### Phase 2: Eval Harness (Day 1-2)

5. **Build eval runner** in `scripts/eval-harness.ts` — CLI entry point.
6. **Implement LLM judge eval** in `src/autoresearch/eval-llm.ts` — Anthropic API call, response parsing, per-criterion scoring.
7. **Implement script eval** in `src/autoresearch/eval-script.ts` — spawn command, parse pass/fail from output.
8. **Implement hybrid eval** in `src/autoresearch/eval-hybrid.ts` — orchestrate script then LLM.
9. **Build test input loader** in `src/autoresearch/inputs.ts` — read `inputs.jsonl`, validate schema.

### Phase 3: Git Operations (Day 2)

10. **Build git helpers** in `src/autoresearch/git.ts` — branch, commit, reset, diff, status, isTracked.
11. **Implement safety checks** — clean state assertion, tracked file check.
12. **Implement branch strategy** — create branch, commit messages with metadata.

### Phase 4: Execution Backends (Day 2-3)

13. **Build backend interface** in `src/autoresearch/backend.ts` — common interface for all backends.
14. **Implement Claude Code backend** — spawn `claude --print`, parse response.
15. **Implement Anthropic API backend** — direct messages API call.
16. **Implement Zo `/zo/ask` backend** — HTTP call with identity token.
17. **Implement response parser** — extract hypothesis + artifact content.

### Phase 5: Loop Runner (Day 3)

18. **Build loop runner** in `src/autoresearch/loop.ts` — main loop logic.
19. **Implement stopping criteria** — max rounds, convergence, plateau, cost cap.
20. **Implement experiment log** — append-only JSONL writer.
21. **Build summary report** — human-readable markdown output.

### Phase 6: CLI & Polish (Day 3-4)

22. **Build CLI** in `scripts/autoresearch-loop.ts` — parse args, wire up pipeline.
23. **Implement `--from-targets` mode** — load from M3 output and scaffold target directory.
24. **Implement `--dry-run`** — show setup and first prompt without executing.
25. **Implement verbose logging** — per-round progress to stderr.

### File structure

```
plugins/skill-eval/
  scripts/
    autoresearch-loop.ts       # CLI entry point (loop runner)
    eval-harness.ts            # CLI entry point (eval only)
  src/
    autoresearch/
      types.ts                 # All type definitions
      target.ts                # Target loader + validator
      program.ts               # program.md template + generator
      inputs.ts                # Test input loader
      eval-llm.ts              # LLM-as-judge eval
      eval-script.ts           # Programmatic eval
      eval-hybrid.ts           # Hybrid eval orchestrator
      git.ts                   # Git operations
      backend.ts               # Backend interface
      backend-claude-code.ts   # Claude Code --print backend
      backend-anthropic.ts     # Direct API backend
      backend-zo.ts            # Zo /zo/ask backend
      loop.ts                  # Core loop runner
      summary.ts               # Report generation
```

---

## 16. Validation Plan

### V1: Eval Harness Correctness

1. Create a synthetic target with a known-good and known-bad artifact version.
2. Run eval on both versions. Verify known-good scores higher.
3. Test each eval mode (llm, script, hybrid) independently.

### V2: Git State Machine

1. Run 5 rounds on a test artifact.
2. After each round, verify:
   - If kept: `git log` shows a new commit, artifact matches the round's output.
   - If reverted: artifact matches the pre-round state, no new commit.
3. At the end: `git log --oneline` should show exactly N commits (where N = kept rounds).

### V3: Stopping Criteria

1. **Max rounds:** Set `maxRounds: 3`, verify loop exits after 3 rounds regardless of score.
2. **Convergence:** Mock eval to always return 0.96. Verify loop exits after `convergenceCount` rounds.
3. **Plateau:** Mock eval to always return lower than baseline. Verify loop exits after `plateauRounds` consecutive reverts.

### V4: End-to-End (Real Target)

1. Pick one real target from M3 output (or manually construct one for a known-bad skill).
2. Run the full loop with `--max-rounds 10 --verbose`.
3. Verify:
   - Baseline score is recorded correctly.
   - Final score >= baseline score (monotonic improvement guarantee from git strategy).
   - Experiment log is complete and well-formed.
   - Summary report matches the log data.
   - Git branch is clean with the expected commits.
4. Manually diff the artifact: does the change look reasonable?

### V5: Backend Parity

1. Run the same target through all three backends (where available).
2. Compare: do they produce similar quality improvements? (Scores won't be identical, but should be in the same ballpark.)

### V6: Cost Tracking

1. Run an LLM-mode eval loop with `--verbose`.
2. Verify reported costs match expected API usage (input tokens × rate + output tokens × rate).
3. Test `--max-cost` cap: verify loop exits when cost is reached.

---

## Appendix A: Example Run

```
$ bun scripts/autoresearch-loop.ts --target targets/zo-memory-system/ --max-rounds 10 --verbose

[autoresearch] Target: zo-memory-system
[autoresearch] Artifact: /home/workspace/Skills/zo-memory-system/SKILL.md
[autoresearch] Backend: claude-code
[autoresearch] Eval mode: llm (claude-sonnet-4-6)
[autoresearch] Branch: autoresearch/zo-memory-system/1711324800000

[autoresearch] Baseline eval: 0.567 (17/30 passed)

[autoresearch] Round 1:
  Hypothesis: Add temporal query handling examples
  Eval: 0.633 (19/30 passed)
  → KEPT (git commit: abc1234)

[autoresearch] Round 2:
  Hypothesis: Clarify entity extraction format requirements
  Eval: 0.600 (18/30 passed)
  → REVERTED (score decreased)

[autoresearch] Round 3:
  Hypothesis: Add negative examples for off-topic queries
  Eval: 0.700 (21/30 passed)
  → KEPT (git commit: def5678)

...

[autoresearch] Round 8:
  Hypothesis: Reorder instruction sections by frequency of use
  Eval: 0.767 (23/30 passed)
  → KEPT (git commit: mno3456)

[autoresearch] Rounds 9-10: REVERTED (plateau)

[autoresearch] Stopping: plateau (3 consecutive reverts)

═══════════════════════════════════════
  Score: 0.567 → 0.767 (+0.200)
  Rounds: 10 (5 kept, 5 reverted)
  Duration: 8 minutes
  Cost: ~$0.32
  Branch: autoresearch/zo-memory-system/1711324800000
═══════════════════════════════════════

Review: git diff main..autoresearch/zo-memory-system/1711324800000
```

---

## Appendix B: Relationship to Prior Art

| Concept | Karpathy's autoresearch | This implementation |
|---------|------------------------|---------------------|
| Mutable artifact | `train.py` (research code) | Skill, prompt, or code file |
| Agent instructions | `program.md` | `program.md` (templated from M3) |
| Eval | `prepare.py` (data prep + metrics) | `eval-harness.ts` (LLM/script/hybrid) |
| State machine | Git commit/reset | Git commit/reset (identical) |
| Experiment log | In-memory, printed | `experiment-log.jsonl` (persistent) |
| Target selection | Manual | Automated via M1→M2→M3 pipeline |
| Stopping | Manual / fixed rounds | Max rounds + convergence + plateau + cost cap |
| Execution | Claude Code in terminal | Multi-backend (Claude Code / API / Zo) |
