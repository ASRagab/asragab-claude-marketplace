# M4 Research: Autoresearch & Agent Self-Improvement Landscape

_Last updated: 2026-03-28_

## Context

Research sweep for M4 (Autoresearch Loop) design. Goal: identify best-of-class patterns, reusable libraries, and architectural decisions from the current ecosystem before building our own loop.

## Key Insight

Our pipeline (M1-M3) already solves the hardest problem most autoresearch systems skip: **knowing what to optimize**. Most repos start with a human-specified goal and metric. We start with friction analysis from real transcripts, ranked by composite severity scores. M4 can therefore be leaner — it only needs the loop mechanics and eval harness, not the target discovery.

---

## Tier 1: Directly Applicable

### 1. drivelineresearch/autoresearch-claude-code
- **URL**: https://github.com/drivelineresearch/autoresearch-claude-code
- **What**: Pure Claude Code skill (no MCP server). Port of pi-autoresearch.
- **Pattern**: Goal + benchmark script + files to modify → loop forever: try ideas, measure, keep winners, discard losers.
- **Key design**: Experiment state persisted as markdown. Git commit on improvement, git reset on regression. Resume-friendly.
- **Borrow**: Loop skeleton, experiment state persistence pattern, git-based keep/revert.
- **Limitation**: No trace-based eval — relies on numeric metrics from a benchmark script.

### 2. Ole Lehmann's Autoresearch Skill
- **URL**: https://aimaker.substack.com/p/how-i-built-skill-improves-all-skills-karpathy-autoresearch-loop
- **What**: Runs the Karpathy loop ON other Claude Code skills. Binary evals, blind scoring.
- **Pattern**: Mutate skill → run all test cases → score with binary yes/no evals → keep or discard → repeat.
- **Key insight**: 3-6 binary eval questions per target is the sweet spot (from his testing). More questions → diminishing returns, fewer → not enough signal.
- **Borrow**: Binary eval question design (we already generate these in M3). Before/after scorecard format.
- **Limitation**: Paywalled architecture details. Skill-specific — doesn't handle tool/config targets.

### 3. MLflow + Claude Code Skill Eval Pipeline
- **URL**: https://mlflow.org/blog/evaluating-skills-mlflow
- **Docs**: https://mlflow.org/docs/latest/genai/eval-monitor/scorers/llm-judge/tool-call/
- **What**: Comprehensive trace-based eval. Traces Claude Code sessions with MLflow, runs automated judges.
- **Built-in judges**: ToolCallCorrectness, ToolCallEfficiency, custom make_judge() API.
- **Key design**: 6 judges per skill eval — "did skill invoke?", "did it follow prerequisites?", "correct tool calls?", "efficient?", etc.
- **Borrow**: Judge design patterns, trace-based evaluation concept. make_judge() API if we adopt MLflow.
- **Consideration**: Heavy dependency (MLflow server). May be overkill for our use case — we already have our own trace pipeline (M1).

### 4. clawinfra/rsi-loop
- **URL**: https://github.com/clawinfra/rsi-loop
- **What**: Universal recursive self-improvement framework. Python.
- **Pattern**: Observe → Analyze → Fix → Verify. Auto error classification, recurrence detection, health scoring.
- **Key design**: Error taxonomy with automatic classification. Recurrence detection prevents re-introducing fixed issues.
- **Borrow**: Recurrence detection pattern (track previously-fixed issues, alert if they reappear). Health scoring formula.
- **Limitation**: Generic framework — not skill-specific.

### 5. Reddit: Recursive Self-Improvement via Trace Analysis
- **URL**: https://www.reddit.com/r/ClaudeCode/comments/1s63tf1/
- **What**: Analyzes agent traces across runs, finds failure patterns, auto-improves code.
- **Pattern**: Collect traces → find failure patterns → prioritize fixes → verify improvement → repeat.
- **Key insight**: "2 lines of code to add tracing" — minimal instrumentation. /recursive-improve command + /benchmark for A/B.
- **Borrow**: A/B benchmark pattern (run before + after on same test cases, compare).

---

## Tier 2: Interesting Architectural Variants

### 6. bertmiller/autoharness
- **URL**: https://github.com/bertmiller/autoharness
- **What**: Multi-GPU parallel autoresearch. Isolated git worktrees per generation.
- **Novel**: Best-of-N selection across parallel runs. Worktree isolation prevents cross-contamination.
- **Relevance**: Parallelism pattern useful if we want to explore multiple improvement hypotheses simultaneously.

### 7. ehmo/autoresearch (Red/Green/Refactor)
- **URL**: https://github.com/ehmo/autoresearch
- **What**: 3 independent agent teams cycle without knowledge of each other's findings.
- **Red**: Find problems. **Green**: Fix issues. **Refactor**: Simplify.
- **Novel**: Adversarial separation — teams can't see each other's work, preventing bias.
- **Relevance**: Interesting for M4 if we want separation between "identify improvement" and "implement improvement" steps.

### 8. AutoResearchClaw + MetaClaw
- **URL**: https://github.com/aiming-lab/AutoResearchClaw
- **MetaClaw**: https://github.com/aiming-lab/MetaClaw
- **What**: 23-stage autonomous research pipeline. MetaClaw provides cross-run learning.
- **Novel**: Structured lesson + skill injection between runs (+18% robustness). Persistent cross-session memory.
- **Relevance**: Cross-run learning is highly relevant — improvements from one target should inform optimization of the next.

### 9. autoresearch-anything
- **URL**: https://dev.to/alireza_rezvani/i-turned-karpathys-autoresearch-into-a-skill-that-optimizes-anything-here-is-the-architecture-57j8
- **What**: Any measurable metric as autoresearch target. LLM judges for non-numeric evals.
- **Novel**: Uses LLM-as-judge constrained by the agent's own subscription for subjective metrics.
- **Relevance**: We need this for prompt/skill quality targets that don't have numeric benchmarks.

---

## Tier 3: Eval Infrastructure

### 10. MLflow Trace Judges
- **Docs**: https://mlflow.org/docs/latest/genai/eval-monitor/scorers/llm-judge/
- **What**: make_judge() API for custom LLM judges on execution traces.
- **Built-in**: ToolCallCorrectness, ToolCallEfficiency.
- **Pattern**: Template variables (inputs, outputs, expectations, trace) → LLM judge → binary score.
- **Consideration**: Requires MLflow server running. Our M1 already produces equivalent trace data.

### 11. agent-trace (Siddhant-K-code)
- **URL**: https://github.com/Siddhant-K-code/agent-trace
- **What**: strace for AI agents. Captures every tool call, prompt, response.
- **Key**: Zero deps, Python 3.10+ stdlib only. Exports to Datadog/Honeycomb/Splunk.
- **Relevance**: We already have M1 for this. Not needed.

---

## Key Research Papers/Posts

### 12. "AI Self-Improvement Only Works Where Outcomes Are Verifiable"
- **URL**: https://gist.github.com/AnthonyAlcaraz/a0b70a4bb5ce521129e93bf9d33f9698
- **Key finding**: Code is the ideal self-improvement domain because of: binary test signals, quantitative benchmarks, deterministic static analysis, causal execution traces.
- **Implication**: Our transcript-based approach is well-suited — we have causal traces with clear success/failure signals.

### 13. Yu Su: "An Illusion of Progress?"
- **URL**: https://x.com/ysu_nlp/status/1904592235728896199
- **Key finding**: Web agent benchmark numbers inflated up to 59%. WebJudge achieves 85% human agreement.
- **Implication**: Our eval questions must be validated against human judgment. Binary yes/no with evidence > numeric scores.

### 14. Karpathy's 10 Agent Principles (No Priors Podcast)
- **URL**: https://www.youtube.com/watch?v=kwSVtQ7dziU
- **Key principles**: program.md as tunable code, fixed time budgets for fair comparison, single-file modification constraint.

---

## Synthesis: What to Build vs. Borrow

### BUILD (unique to our pipeline):
- **Target-aware loop orchestrator**: Takes M3 targets.jsonl, scaffolds experiment per target
- **Eval harness using M3 eval questions**: Binary yes/no judges derived from M3's eval_questions
- **Cross-target learning**: Improvements from one target inform the next (MetaClaw-inspired)

### BORROW:
- **Loop skeleton**: drivelineresearch pattern (experiment state as markdown, git keep/revert)
- **Binary eval pattern**: Ole Lehmann's 3-6 questions sweet spot (already in M3 output)
- **Recurrence detection**: rsi-loop pattern (track fixed issues, alert on regression)
- **LLM-as-judge for non-numeric targets**: autoresearch-anything pattern

### SKIP (we already have equivalents):
- MLflow tracing (M1 does this)
- agent-trace (M1 does this)
- Target discovery (M3 does this)
- Friction classification (M2 does this)

---

## Recommended M4 Architecture

```
targets.jsonl (from M3)
       │
       ▼
┌────────────────────────┐
│  Loop Orchestrator     │  For each target:
│  (autoresearch-loop.ts)│  1. Scaffold experiment (program.md + eval)
│                        │  2. Run improvement loop
│                        │  3. Log results
└──────────┬─────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐ ┌──────────┐
│ Editor  │ │ Eval     │  Binary judges from M3 eval_questions
│ (LLM)  │ │ Harness  │  + regression detection from rsi-loop
└────┬────┘ └────┬─────┘
     │           │
     └─────┬─────┘
           ▼
┌────────────────────────┐
│  Git Keep/Revert       │  Commit on improvement
│  + Experiment Log      │  Reset on regression
│  + Cross-target Memory │  Feed learnings forward
└────────────────────────┘
```

### Execution Backend Options (in order of preference):
1. **Anthropic API direct** — cheapest, most control, structured output for eval
2. **Zo /zo/ask** — if we need tool access during improvement
3. **Claude Code --print** — if target is a skill file that needs live testing

### Dependencies to Install:
- `@anthropic-ai/sdk` (already installed)
- No MLflow needed — our M1 trace pipeline is sufficient
- No additional frameworks — keep it lean
