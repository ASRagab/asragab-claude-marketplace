# M3: Target Identification — Design Document

**Status:** Draft
**Date:** 2026-03-24
**Plugin:** skill-eval
**Script:** `scripts/target-identify.ts`

---

## 1. Overview

M3 takes classified friction events from M2 (`classified-events.jsonl`), clusters them by likely root cause, and uses an LLM-as-judge to identify which skills, prompts, tools, or workflows are the best candidates for autoresearch optimization. It outputs a ranked list of targets with evidence, scoring, and suggested eval criteria that feed directly into M4.

## 2. Goals & Non-Goals

### Goals
- Close the **Gulf of Specification** — translate raw friction signals into actionable improvement targets with grounded eval criteria
- Cluster friction events by root cause, not just surface symptom
- Use LLM-as-judge with critique-before-verdict pattern for target assessment
- Score targets by `frequency × severity × improvability`
- Auto-generate binary eval criteria for each target (feeds M4)
- Support human-in-the-loop checkpoint before committing to targets

### Non-Goals
- Actually improving the targets (that's M4)
- Real-time analysis (batch only)
- Classifying events (that's M2)
- Replacing manual error analysis for novel failure modes — M3 augments, not replaces

## 3. Architecture

```
classified-events.jsonl (M2 output)  +  events.jsonl (M1 output, for context enrichment)
       │                                        │
       ▼                                        │
┌──────────────────┐                            │
│  Friction Filter  │  Extract only friction-    │
│  & Enrichment     │  labeled events; enrich   ◄┘
│                   │  with context from M1 events
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Clustering       │  Group by: tool_name, skill_path, error_pattern
│  (code-based)     │  Merge clusters with same root cause
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  LLM-as-Judge     │  Per cluster: assess target type, improvability,
│  (API calls)      │  severity, and generate eval criteria
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Scoring &        │  Rank by composite score
│  Ranking          │  Apply minimum evidence threshold
└──────┬───────────┘
       │
       ▼
targets.jsonl (ranked improvement targets)
```

> **Note:** M3 requires two inputs: M2's classified events (for friction labels and filtering) and M1's full event stream (for context enrichment). M2 may filter noise events, but M3 needs surrounding context events — including those classified as neutral — to enrich friction clusters before sending them to the judge. If `--events` is not provided, M3 falls back to using only the classified events for context, which may be incomplete.

## 4. Friction Clustering

### 4.1 Grouping Strategy

Friction events are grouped using a multi-key clustering approach:

```typescript
interface ClusterKey {
  // Primary grouping (at least one must match)
  tool_name?: string;       // e.g., "mcp__zo__run_bash_command"
  skill_path?: string;      // e.g., "skills/memory-search/SKILL.md"
  error_pattern?: string;   // normalized error pattern (see below)

  // Secondary grouping (used to split large clusters)
  session_count: number;    // how many unique sessions
  subcategory: string;      // friction subcategory from M2
}
```

### 4.2 Error Pattern Normalization

Raw error messages are noisy. Normalize before clustering:

```typescript
function normalizeErrorPattern(error: string): string {
  return error
    .replace(/\/[\w\-\/\.]+/g, "<PATH>")          // file paths
    .replace(/\b[0-9a-f]{8,}\b/gi, "<ID>")        // hex IDs
    .replace(/\d+/g, "<N>")                        // numbers
    .replace(/toolu_\w+/g, "<TOOL_ID>")            // tool use IDs
    .replace(/\s+/g, " ")                          // whitespace
    .trim()
    .slice(0, 200);                                // truncate
}
```

### 4.3 Cluster Merging

After initial grouping, merge clusters that share:
- Same tool_name AND overlapping error_pattern (>50% token overlap)
- Same skill_path regardless of error type
- Different tools but same underlying skill (detected via skill_path in tool context)

### 4.4 Minimum Cluster Size

Clusters with fewer than `minEvidence` events (default: 3) are dropped. Single-occurrence errors aren't worth optimizing — they may be transient.

## 5. Context Enrichment

Before sending clusters to the judge, enrich each friction event with surrounding context. Context events are loaded from M1's `events.jsonl` (the full event stream) rather than M2's classified output, because M2 may have filtered noise events that provide useful surrounding context.

```typescript
interface EnrichedFrictionEvent {
  // From classified event
  session_id: string;
  timestamp: string;
  sequence: number;
  type: string;
  tool_name?: string;
  error?: string;
  text?: string;
  classification: ClassificationLabel;

  // Enrichment: surrounding events (from M1 full event stream)
  preceding_events: NormalizedEvent[];  // 2-3 events before (what led to this)
  following_events: NormalizedEvent[];  // 1-2 events after (how was it handled)
  session_metadata: {
    total_events: number;
    total_friction: number;
    duration_minutes: number;
  };
}
```

This gives the judge enough context to understand *why* the friction occurred, not just *what* happened.

## 6. LLM-as-Judge Design

### 6.1 Judge Prompt Template

Following Hamel's write-judge-prompt pattern: one judge per assessment, binary verdict, critique-before-verdict.

```markdown
# Target Assessment Judge

You are evaluating a cluster of friction events from Claude Code sessions to determine
if they represent a worthwhile optimization target.

## Friction Cluster

**Tool/Skill:** {{cluster_key}}
**Occurrence count:** {{event_count}} across {{session_count}} sessions
**Friction subcategories:** {{subcategory_distribution}}

## Representative Events ({{sample_size}} of {{event_count}})

{{#each sampled_events}}
### Event {{@index}}
- **Session:** {{session_id}} ({{session_metadata.duration_minutes}} min, {{session_metadata.total_friction}} friction events)
- **What happened:** {{type}} {{#if tool_name}}(tool: {{tool_name}}){{/if}}
- **Error/Text:** {{error || text}}
- **Context before:** {{preceding_events_summary}}
- **Context after:** {{following_events_summary}}
{{/each}}

## Assessment Criteria

For each criterion, provide your reasoning FIRST, then a binary Pass/Fail verdict.

### Criterion 1: Identifiable Target
Is there a specific, editable artifact (skill file, prompt, tool config, code) that could be modified to reduce this friction?
- Pass: A specific file path or artifact can be named
- Fail: The friction is caused by external factors (API limits, model capability, user error)

### Criterion 2: Pattern Consistency
Do the friction events share a consistent root cause, or are they unrelated issues that happen to involve the same tool?
- Pass: Events share a recognizable pattern (same error type, same failure mode)
- Fail: Events are heterogeneous with different root causes

### Criterion 3: Improvability
Could editing the target artifact plausibly reduce the friction rate?
- Pass: The friction stems from missing instructions, ambiguous prompts, or suboptimal patterns that could be improved
- Fail: The friction stems from fundamental limitations that prompt editing can't fix

## Output Format

Respond with this exact JSON structure:
```json
{
  "critique": {
    "identifiable_target": "Your reasoning about whether a specific artifact can be named...",
    "pattern_consistency": "Your reasoning about whether the events share a root cause...",
    "improvability": "Your reasoning about whether editing the artifact could help..."
  },
  "verdicts": {
    "identifiable_target": "Pass" | "Fail",
    "pattern_consistency": "Pass" | "Fail",
    "improvability": "Pass" | "Fail"
  },
  "target": {
    "type": "skill" | "prompt" | "tool_pattern" | "code" | "missing_capability",
    "name": "human-readable name for this target",
    "path": "file path to the mutable artifact, if identifiable",
    "description": "one-sentence description of the problem",
    "severity": 0.0-1.0,
    "improvability": 0.0-1.0
  },
  "suggested_eval_criteria": [
    "Binary yes/no question that would pass if the friction is resolved",
    "Another binary check...",
    "3-6 total criteria"
  ],
  "friction_summary": "2-3 sentence summary of the friction pattern and its impact"
}
```

IMPORTANT: Suggested eval criteria MUST be binary yes/no questions. No scales. No vibe checks.
Each criterion should be specific enough that two different agents would agree on the verdict.
```

### 6.2 Judge Input Preparation

```typescript
function prepareJudgeInput(cluster: FrictionCluster): JudgeInput {
  // Sample representative events (max 10 per cluster to control prompt size)
  const sampled = sampleRepresentative(cluster.events, 10);

  // Summarize context for each sampled event
  const enrichedSamples = sampled.map(event => ({
    ...event,
    preceding_events_summary: summarizeEvents(event.preceding_events),
    following_events_summary: summarizeEvents(event.following_events),
  }));

  return {
    cluster_key: cluster.key.tool_name || cluster.key.skill_path || cluster.key.error_pattern,
    event_count: cluster.events.length,
    session_count: new Set(cluster.events.map(e => e.session_id)).size,
    subcategory_distribution: countBy(cluster.events, e => e.classification.subcategory),
    sampled_events: enrichedSamples,
    sample_size: enrichedSamples.length,
  };
}
```

### 6.3 What NOT to Feed the Judge

- Raw transcript JSONL (too verbose, wastes tokens)
- Noise events (already filtered)
- Full session transcripts (only friction cluster + context)
- More than 10 events per cluster (diminishing returns, use representative sample)

## 7. Scoring Formula

```typescript
interface TargetScore {
  frequency: number;      // 0.0 - 1.0: how often this friction occurs
  severity: number;       // 0.0 - 1.0: from judge assessment
  improvability: number;  // 0.0 - 1.0: from judge assessment
  composite: number;      // weighted combination
}

function computeScore(
  cluster: FrictionCluster,
  judgeResult: JudgeResult,
  totalFrictionEvents: number
): TargetScore {
  // Frequency: proportion of all friction events in this cluster
  const frequency = cluster.events.length / totalFrictionEvents;

  // Severity and improvability from judge
  const severity = judgeResult.target.severity;
  const improvability = judgeResult.target.improvability;

  // Composite: weighted geometric mean (weights sum to 1.0)
  // Improvability weighted highest — no point optimizing something that can't be improved
  const composite =
    Math.pow(frequency, 0.3) *
    Math.pow(severity, 0.3) *
    Math.pow(improvability, 0.4);

  return { frequency, severity, improvability, composite };
}
```

**Weight rationale:**
- `improvability: 0.4` — Most important. A frequent, severe problem that can't be fixed by editing artifacts is not a valid target.
- `frequency: 0.3` — Frequent friction has more impact.
- `severity: 0.3` — Severe friction blocks users more.

## 8. Target Schema (Output)

```typescript
interface Target {
  rank: number;
  target_type: "skill" | "prompt" | "tool_pattern" | "code" | "missing_capability";
  target_name: string;
  target_path?: string;                // file path to mutable artifact
  description: string;
  evidence_count: number;
  evidence_sessions: string[];         // session IDs
  score: TargetScore;
  suggested_eval_criteria: string[];   // 3-6 binary yes/no questions
  friction_summary: string;
  judge_critique: {                    // transparency: show the judge's reasoning
    identifiable_target: string;
    pattern_consistency: string;
    improvability: string;
  };
  verdicts: {
    identifiable_target: "Pass" | "Fail";
    pattern_consistency: "Pass" | "Fail";
    improvability: "Pass" | "Fail";
  };
}
```

**Filtering:** Only targets where ALL three verdicts are "Pass" are included in the output. Targets with any "Fail" verdict are logged but not ranked.

## 9. Eval Criteria Generation

The judge generates 3-6 binary eval criteria per target. These feed directly into M4's eval harness.

**Quality checks on generated criteria (applied post-judge):**
1. Must be a question ending with `?`
2. Must be answerable with yes/no
3. Must not contain vague terms ("good", "appropriate", "reasonable")
4. Must be distinct from each other (no overlapping criteria)
5. Must reference observable behavior (not intent or internal state)

```typescript
function validateEvalCriteria(criteria: string[]): string[] {
  return criteria.filter(c => {
    if (!c.endsWith("?")) return false;
    if (c.length < 20) return false;  // too short to be specific
    const vague = ["good", "appropriate", "reasonable", "nice", "well", "properly"];
    if (vague.some(v => c.toLowerCase().includes(v))) return false;
    return true;
  });
}
```

## 10. Configuration

```typescript
interface TargetIdentifyConfig {
  // Input
  inputPath: string;              // classified-events.jsonl

  // Clustering
  minEvidence: number;            // default: 3 (min events per cluster)
  maxClusters: number;            // default: 20 (cap before judging)
  contextWindow: number;          // default: 3 (events before/after for enrichment)

  // Judge
  model: string;                  // default: "claude-sonnet-4-6" (fast + cheap for judging)
  maxSamplesPerCluster: number;   // default: 10
  temperature: number;            // default: 0.0 (deterministic)

  // Output
  topN: number;                   // default: 5
  outputPath: string;             // targets.jsonl
  minCompositeScore: number;      // default: 0.3

  // Human-in-the-loop
  interactive: boolean;           // default: false (if true, pause for review)
}
```

## 11. CLI Interface

```bash
# Basic usage (classified events + full events for context)
bun scripts/target-identify.ts \
  --input classified-events.jsonl \
  --events events.jsonl \
  --output targets.jsonl

# Without full event context (falls back to classified events only)
bun scripts/target-identify.ts \
  --input classified-events.jsonl \
  --output targets.jsonl

# Limit to top 3 targets, use specific model
bun scripts/target-identify.ts \
  --input classified-events.jsonl \
  --events events.jsonl \
  --top 3 \
  --model claude-sonnet-4-6 \
  --output targets.jsonl

# Interactive mode — pause for human review
bun scripts/target-identify.ts \
  --input classified-events.jsonl \
  --events events.jsonl \
  --interactive \
  --output targets.jsonl

# Require more evidence per cluster
bun scripts/target-identify.ts \
  --input classified-events.jsonl \
  --events events.jsonl \
  --min-evidence 5 \
  --output targets.jsonl

# Full pipeline (two-step: M1+M2 produce files, M3 consumes both)
bun scripts/transcript-extract.ts --since 30d -o events.jsonl
bun scripts/signal-classify.ts --input events.jsonl --output classified-events.jsonl
bun scripts/target-identify.ts \
  --input classified-events.jsonl \
  --events events.jsonl \
  --top 5 \
  --output targets.jsonl
```

## 12. Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success, targets identified |
| 1 | No friction events found in input |
| 2 | Invalid arguments |
| 3 | LLM API error (authentication, rate limit) |

## 13. Implementation Plan

### Phase 1: Clustering (2-3 hours)
1. Set up `scripts/target-identify.ts` with CLI parsing
2. Read classified-events.jsonl, filter to friction only
3. Implement error pattern normalization
4. Implement multi-key clustering (tool_name, skill_path, error_pattern)
5. Implement cluster merging
6. Apply minimum evidence threshold

### Phase 2: Context Enrichment (1-2 hours)
7. Build event index by session_id for quick lookups
8. Implement surrounding event retrieval (preceding/following)
9. Implement event summarization (truncate, extract key info)
10. Build representative sampling (diverse events from each cluster)

### Phase 3: LLM-as-Judge (2-3 hours)
11. Implement judge prompt template (Handlebars-style rendering)
12. Implement Anthropic API client (messages API, structured output)
13. Implement response parsing with JSON extraction
14. Implement retry logic for malformed judge responses
15. Implement eval criteria validation

### Phase 4: Scoring & Output (1-2 hours)
16. Implement composite scoring formula
17. Implement ranking and top-N selection
18. Write targets.jsonl output
19. Implement `--interactive` mode (display targets, wait for user confirmation)

### Phase 5: Validation (1-2 hours)
20. Test on real classified events from M2
21. Manual review of judge outputs
22. Verify eval criteria quality

## 14. Validation Plan

### Judge Quality Assessment
1. Run M3 on classified events from 10+ sessions
2. For each identified target, manually review:
   - Does the target make sense given the friction evidence?
   - Are the eval criteria specific and binary?
   - Is the improvability assessment realistic?
3. Track agreement rate between judge and human reviewer

### TPR/TNR Measurement (Following Hamel's validate-evaluator)
1. Manually annotate 30 friction clusters as "valid target" or "not a target"
2. Split: 10% train (few-shot examples), 45% dev (iterate), 45% test (final measurement)
3. Run judge on dev set, measure TPR and TNR
4. Target: TPR > 85%, TNR > 85% (lower bar than Hamel's 90% because our input is noisier)
5. Inspect disagreements, iterate on judge prompt

### End-to-End Sanity Check
1. Run full M1 → M2 → M3 pipeline on 7 days of real sessions
2. Review top 5 targets: would a human have identified the same targets from reading sessions?
3. Check: are the suggested eval criteria actionable for M4?

### Score Gaming Detection
- Ensure the judge doesn't always give high improvability scores
- Check distribution: if all targets score > 0.8, the judge may be too optimistic
- Cross-validate: does frequency correlate with session count? (it should)
