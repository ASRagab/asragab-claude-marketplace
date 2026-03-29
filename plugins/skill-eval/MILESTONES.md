# skill-eval: Milestones

Automated skill/prompt/tool evaluation and improvement pipeline.
Optionally uses CASS for session discovery; can also parse raw transcripts directly. Adds signal classification, LLM-as-judge target identification, and autoresearch-style optimization loops.

## Architecture

```
Session Logs (CASS / raw transcripts)
        │
        ▼
┌──────────────────────┐
│  M1: Transcript ETL  │  Extract structured events from session logs
│  (transcript-extract)│  Output: events.jsonl per session
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  M2: Signal Classify │  Categorize events: noise / friction / success
│  (signal-classify)   │  Output: classified-events.jsonl
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  M3: Target Identify │  LLM-as-judge: which skills/prompts/tools to improve
│  (target-identify)   │  Output: targets.jsonl (ranked improvement targets)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  M4: Autoresearch    │  Optimization loop: edit → eval → keep/revert
│  (autoresearch-loop) │  Output: improved artifacts + experiment-log.jsonl
└──────────────────────┘
```

---

## M1: Transcript ETL

**Goal:** Extract structured, machine-readable events from Claude Code session transcripts (and optionally CASS-indexed data) into a normalized format suitable for classification.

### Research
- [x] Fully document the Claude Code transcript JSONL schema (message types, tool_use block structure, content block types)
- [x] Inventory what CASS already extracts vs. what we need that CASS doesn't provide (raw tool inputs/outputs, thinking blocks, error details, user correction patterns)
- [x] Determine whether to parse raw transcripts directly, use CASS export, or both
- [x] Identify session metadata needed: model, session duration, tool count, compaction events

### Discuss
- [x] Decide: raw transcript parsing vs. CASS as data source vs. hybrid approach
- [x] Decide: scope of extraction — all sessions or filtered (by date, project, agent)?
- [x] Decide: output schema for extracted events

### Plan
- [x] Define the event schema (TypeScript types or JSON schema)
- [x] Design the extraction pipeline: input → parse → normalize → output
- [x] Identify edge cases: compacted sessions, subagent transcripts, meta/system messages

### Implement
- [x] Build `scripts/transcript-extract.ts` — parses session JSONL, emits normalized events
- [x] Handle: user messages, assistant messages, tool_use blocks, tool_result blocks, thinking blocks, system/compaction boundaries
- [x] Handle: subagent transcripts (nested JSONL files)
- [x] Implement `--source cass` discovery path with CASS availability detection (skipped — direct parsing chosen)
- [x] Output: `events.jsonl` with one event per line

### Validate
- [x] Run on 5 real sessions manually, verify completeness and correctness
- [x] Compare extraction against manual reading of the same sessions
- [x] Verify subagent events are captured
- [x] Check for data loss: are any meaningful events dropped?

---

## M2: Signal Classification

**Goal:** Categorize extracted events into noise (filter out) vs. signal (friction, success, neutral) to surface the events worth analyzing.

### Research
- [x] Study George's Three Gulfs framework — how does noise/signal classification relate to Gulf of Comprehension?
- [x] Define friction signal heuristics: user re-prompts, tool errors, retries, long chains, abandoned approaches, compaction events
- [x] Define success signal heuristics: clean completions, user acknowledgment, short chains
- [x] Study whether rule-based classification is sufficient or if we need LLM-assisted classification

### Discuss
- [x] Decide: rule-based first (faster, cheaper, deterministic) vs. LLM-assisted from the start
- [x] Decide: granularity of classification — per-event, per-turn, or per-session?
- [x] Decide: how to handle ambiguous cases (e.g., user rephrasing that might be a correction or just a new request)

### Plan
- [x] Define the classification taxonomy: noise, friction (with subcategories), success, neutral
- [x] Design the classifier pipeline: events.jsonl → classify → classified-events.jsonl
- [x] Plan the rule-based heuristics (pattern matching, temporal proximity, tool chain analysis)
- [x] If LLM-assisted: design the classification prompt

### Implement
- [x] Build `scripts/signal-classify.ts` — reads events.jsonl, applies classification rules
- [x] Implement friction detectors:
  - [x] Tool error detector with subcategories (timeout, permission, size, api_mismatch)
  - [x] Parallel cancellation detector
  - [x] User rejection detector
  - [x] User correction detector (re-prompt after tool use with negation/correction language)
  - [x] Retry detector (same tool, similar input, within N turns)
  - [x] Long chain detector (>N tool calls for a single user request)
  - [x] Abandoned approach detector (tool result not referenced in subsequent assistant message)
  - [x] Compaction detector
- [x] Implement noise filters: queue-ops, progress events, meta/system messages, routine reads
- [x] Output: `classified-events.jsonl` with classification labels and confidence

### Validate
- [ ] Manual review of 50 classified events — check precision and recall of friction detection
- [x] Calculate noise reduction ratio: what % of events are filtered?
- [ ] Verify no true friction signals are classified as noise
- [ ] Test on sessions with known issues vs. clean sessions

---

## M3: Target Identification

**Goal:** Use LLM-as-judge to analyze friction signals and identify which skills, prompts, tools, or workflows are the best optimization targets.

### Research
- [x] Study Hamel Husain's judge prompt design patterns (from evals-skills)
- [x] Study Ole Lehmann's scoring criteria (yes/no checklist, 3-6 questions sweet spot)
- [x] Define what makes a good optimization target: frequency × severity × improvability
- [x] Identify the categories of targets: skill files, system prompts, tool invocation patterns, missing capabilities

### Discuss
- [x] Decide: scoring formula for target ranking (frequency × severity × improvability, or something else?)
- [x] Decide: human-in-the-loop checkpoint before committing to targets, or fully automated?
- [x] Decide: how many targets to surface per analysis run (top-N)

### Plan
- [x] Design the judge prompt: given a cluster of friction events, identify the target
- [x] Design the target schema: what fields describe an optimization target?
- [x] Design the aggregation: how to cluster friction events by root cause vs. by surface symptom
- [x] Plan the output format: targets.jsonl with ranked targets + evidence

### Implement
- [x] Build `scripts/target-identify.ts` — reads classified friction events, clusters them, runs LLM-as-judge
- [x] Implement friction clustering: group by skill/tool/workflow involved
- [x] Implement judge pipeline: for each cluster, call LLM with friction evidence, get target assessment
- [x] Implement eval criteria generation and validation (3-6 binary yes/no questions per target)
- [x] Implement ranking: score targets by frequency × severity × improvability
- [x] Output: `targets.jsonl` with ranked targets, evidence references, and suggested improvement type

### Validate
- [ ] Manual review of identified targets — do they match intuition from reading sessions?
- [ ] Check for false positives: targets that aren't actually improvable
- [ ] Check for missed targets: known friction not surfaced
- [ ] Validate ranking: does the top target feel like the highest-value improvement?

---

## M4: Autoresearch Loop

**Goal:** Given a target from M3, run an autoresearch-style optimization loop: edit artifact → eval → keep/revert → repeat.

### Research
- [x] Study Karpathy's autoresearch program.md and loop mechanics (git commit/reset pattern)
- [x] Study Ole Lehmann's autoresearch-skill adaptation for skill improvement
- [x] Study drivelineresearch/autoresearch-claude-code JSONL protocol and loop design
- [x] Survey 13+ autoresearch repos/posts (see references/m4-autoresearch-landscape.md)
- [x] Determine eval execution strategy: API calls (LLM-as-judge) via Anthropic SDK + Haiku

### Discuss
- [x] Decide: script-driven Anthropic API calls (not --print or /zo/ask — direct SDK is simpler and cheaper)
- [x] Decide: per-target eval criteria — auto-generated from M3 evidence (binary yes/no questions)
- [x] Decide: stopping criteria — perfect score OR 5 consecutive discards (plateau) OR max rounds
- [x] Decide: experiment state as append-only JSONL (drivelineresearch pattern), no git branching needed

### Plan
- [x] Design the loop runner: targets.jsonl → per-target loop → experiments/*.jsonl
- [x] Design the eval harness: binary yes/no questions scored by LLM-as-judge (Haiku)
- [x] Design the experiment log schema: JSONL with config header + result lines (round, score, hypothesis, kept)
- [x] Borrow best-of-class: drivelineresearch JSONL protocol, rsi-loop error classification, Ole Lehmann binary evals

### Implement
- [x] Build `scripts/autoresearch-loop.ts` — orchestrates the optimization loop
- [x] Implement LLM-as-judge eval via Anthropic SDK (Haiku model)
- [x] Implement target scaffolding from M3 output (`--targets` + `--target-rank`)
- [x] Implement experiment log: append-only JSONL in experiments/ directory
- [x] Implement stopping logic: perfect score, plateau (5 consecutive discards), max rounds
- [x] Implement `--summary` flag for experiment review
- [x] Implement `--dry-run` mode
- [ ] Build `scripts/eval-harness.ts` — standalone eval runner (currently inline in autoresearch-loop)
- [ ] Implement git-based keep/revert: commit on improvement, reset on regression (currently log-only)

### Validate
- [x] End-to-end test: pick one real target from M3, run the loop, verify improvement
- [ ] Verify git history is clean: only improvements committed, regressions reverted
- [x] Verify experiment log captures all rounds with correct scores
- [x] Compare before/after artifact quality manually
- [ ] Check for score gaming: did the artifact actually improve, or did it just satisfy the eval in a trivial way?

### Key Fixes (M4 Pipeline Hardening)
Three issues were identified and resolved to make the eval loop reliable:

1. **System message enforcing JSON output** — Added a system prompt to the eval judge call requiring strict JSON responses. Without this, Haiku would sometimes return conversational prose instead of structured verdicts, causing parse failures.

2. **String-aware `extractJson` parser** — The original regex-based JSON extractor broke on JSON containing string literals with braces (e.g., error messages with `{` or `}`). Replaced with a balanced-brace scanner that tracks string literal boundaries and escape sequences.

3. **Improved eval questions from M3** — Refined the eval criteria to be unambiguous binary yes/no questions. Vague or compound questions caused inconsistent judge verdicts.

### Results
- **`long_chain:mcp__zo__run_bash_command`** (prompt target): Perfect 5/5 on round 1. Kept.
- **`tool_error`** (tool target): Scored 3/4, 2/4, 3/4, then 4/4 on round 4. The loop correctly kept improvements and discarded regressions.
- **Zero crashes** across all runs after the fixes above.
- Full pipeline proven: M1 extract → M2 classify → M3 targets → M4 autoresearch loop with working keep/discard logic.

---

## Cross-Cutting Concerns

### Plugin Packaging
- [x] All scripts runnable standalone via `bun scripts/<name>.ts --help`
- [x] Skills reference scripts and provide agent-facing instructions
- [ ] Hooks capture telemetry during optimization runs (optional)
- [x] Plugin registered in marketplace.json

### Dependencies
- [ ] CASS CLI (optional — can parse raw transcripts if CASS not installed)
- [ ] Anthropic API key (for LLM-as-judge in M3 and eval in M4)
- [ ] Git (for autoresearch keep/revert in M4)

### Data Flow
```
M1 output (events.jsonl) → M2 input
M2 output (classified-events.jsonl) → M3 input
M3 output (targets.jsonl) → M4 input
M4 output (improved artifact + experiment-log.jsonl) → commit / review
```

Each milestone is independently useful:
- M1 alone: structured session data for any downstream analysis
- M1+M2: noise-filtered view of agent sessions
- M1+M2+M3: data-driven target list for manual improvement
- M1+M2+M3+M4: fully automated improvement pipeline
