# M2: Signal Classification — Design Document

**Status:** Draft
**Date:** 2026-03-24
**Plugin:** skill-eval
**Script:** `scripts/signal-classify.ts`

---

## 1. Overview

M2 takes the normalized event stream from M1 (`events.jsonl`) and classifies each event as **noise** (filter out), **friction** (problems worth investigating), **success** (things working well), or **neutral** (normal flow). The classifier is entirely rule-based — no LLM calls — producing deterministic, fast, cheap classification that surfaces the ~2-3% of events that carry diagnostic value.

## 2. Goals & Non-Goals

### Goals
- Filter out ~50% of events that are pure noise (progress, queue-ops, meta)
- Detect friction signals with high precision: tool errors, user corrections, retries, long chains, abandoned approaches, compaction
- Detect success signals: clean completions, user acknowledgments
- Produce classified events with labels, subcategories, and confidence scores
- Be deterministic and fast — no API calls, no model inference
- Support per-session and cross-session analysis

### Non-Goals
- LLM-assisted classification (deferred to M2.5)
- Root cause analysis (that's M3)
- Modifying or enriching the events (just labeling)
- Real-time / streaming classification (batch only for now)

## 3. Architecture

```
events.jsonl (M1 output)
       │
       ▼
┌──────────────┐
│ Noise Filter │  Remove progress, queue-ops, meta, last-prompt
│  (Stage 1)   │  ~50% of events eliminated
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Friction    │  Detect: tool_error, user_correction, retry,
│  Detectors   │  long_chain, abandoned, compaction, user_rejection
│  (Stage 2)   │  parallel_cancellation, timeout, permission_denied
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Success    │  Detect: clean_completion, user_ack
│  Detectors   │
│  (Stage 3)   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Windowed    │  Detect: retry patterns, long chains, abandoned
│  Detectors   │  approaches (require multi-event context)
│  (Stage 4)   │
└──────┬───────┘
       │
       ▼
classified-events.jsonl
```

Events flow through stages sequentially. Stage 1 filters noise. Stages 2-3 classify individual events. Stage 4 applies windowed/contextual detectors that look at sequences of events.

## 4. Classification Taxonomy

```typescript
type SignalCategory = "noise" | "friction" | "success" | "neutral";

type NoiseSubcategory =
  | "queue_op"        // queue-operation events (only present if M1 --include-meta used)
  | "progress"        // progress events (only present if M1 --include-progress used)
  | "meta"            // isMeta messages, system reminders
  | "last_prompt";    // last-prompt events (only present if M1 --include-meta used)

type FrictionSubcategory =
  | "tool_error"             // is_error=true on tool_result
  | "tool_error_timeout"     // timeout/TTL in error content
  | "tool_error_permission"  // permission denied / EACCES
  | "tool_error_size"        // file/content size exceeded
  | "tool_error_api_mismatch" // unexpected keyword/argument errors
  | "parallel_cancellation"  // cascading cancellation from parallel tool failure
  | "user_rejection"         // user explicitly rejected tool use
  | "user_correction"        // user text with correction language
  | "retry"                  // same tool called 3+ times in window
  | "long_chain"             // >N tool calls for single user request
  | "abandoned"              // tool result not referenced, direction changed
  | "compaction";            // compact_boundary event

type SuccessSubcategory =
  | "clean_completion"  // end_turn without prior errors
  | "user_ack";         // positive user acknowledgment

type ClassificationLabel = {
  category: SignalCategory;
  subcategory: NoiseSubcategory | FrictionSubcategory | SuccessSubcategory | "unclassified";
  confidence: number;   // 0.0 - 1.0
  evidence?: string;    // brief explanation of why this label was applied
};
```

> **Note:** The `queue_op`, `progress`, and `last_prompt` noise subcategories are only relevant when M1 is run with `--include-meta` or `--include-progress` flags. Under default M1 settings, these event types are not emitted and these filters act as defensive no-ops.

## 5. Detection Rules

### 5.1 Noise Filter (Stage 1)

```typescript
function isNoise(event: NormalizedEvent): ClassificationLabel | null {
  // Progress events — dedicated type from M1 (only present if --include-progress)
  if (event.type === "progress") {
    return { category: "noise", subcategory: "progress", confidence: 1.0 };
  }

  // System events — may contain meta or queue-op content (if M1 --include-meta)
  if (event.type === "system") {
    const text = (event.text || "").toLowerCase();

    // Queue operations injected via --include-meta
    if (text.includes("queue-operation") || text.includes("queue_op")) {
      return { category: "noise", subcategory: "queue_op", confidence: 1.0 };
    }

    // Last-prompt events injected via --include-meta
    if (text.includes("last-prompt") || text.includes("last_prompt")) {
      return { category: "noise", subcategory: "last_prompt", confidence: 1.0 };
    }

    // Meta messages (system reminders, injected context)
    if (text.includes("ismeta") || text.includes("system-reminder")) {
      return { category: "noise", subcategory: "meta", confidence: 1.0 };
    }
  }

  return null; // not noise
}
```

**Note:** M1 filters most noise at extraction time by default. This stage is a defensive second pass that catches events only present when M1 is run with `--include-progress` or `--include-meta` flags. Under default M1 settings, most events reaching M2 will pass through this stage untouched.

### 5.2 Tool Error Detector

The strongest friction signal. Binary — `is_error` flag is unambiguous.

```typescript
function detectToolError(event: NormalizedEvent): ClassificationLabel | null {
  if (event.type !== "tool_error") return null;

  const content = (event.error || "").toLowerCase();

  // Subcategorize by error content
  if (content.includes("cancelled: parallel")) {
    return { category: "friction", subcategory: "parallel_cancellation", confidence: 1.0,
             evidence: `Parallel tool cancellation: ${event.error?.slice(0, 100)}` };
  }
  if (content.includes("user rejected") || content.includes("doesn't want to proceed")) {
    return { category: "friction", subcategory: "user_rejection", confidence: 1.0,
             evidence: "User explicitly rejected tool execution" };
  }
  if (content.includes("timeout") || content.includes("ttl")) {
    return { category: "friction", subcategory: "tool_error_timeout", confidence: 1.0,
             evidence: `Timeout: ${event.error?.slice(0, 100)}` };
  }
  if (content.includes("permission") || content.includes("denied") || content.includes("eacces")) {
    return { category: "friction", subcategory: "tool_error_permission", confidence: 1.0,
             evidence: `Permission denied: ${event.error?.slice(0, 100)}` };
  }
  if (content.includes("exceeds maximum") || content.includes("too large")) {
    return { category: "friction", subcategory: "tool_error_size", confidence: 1.0,
             evidence: `Size limit: ${event.error?.slice(0, 100)}` };
  }
  if (content.includes("unexpected keyword") || content.includes("unexpected argument")) {
    return { category: "friction", subcategory: "tool_error_api_mismatch", confidence: 1.0,
             evidence: `API mismatch: ${event.error?.slice(0, 100)}` };
  }

  // Generic tool error
  return { category: "friction", subcategory: "tool_error", confidence: 1.0,
           evidence: `Tool error: ${event.error?.slice(0, 100)}` };
}
```

### 5.3 User Correction Detector

Heuristic keyword matching on user text. Lower confidence than tool errors because language is ambiguous.

```typescript
const CORRECTION_PATTERNS = [
  { pattern: /\bno[,.]?\s+(not|don't|instead|that's wrong)/i, confidence: 0.9 },
  { pattern: /\blet's try\b/i, confidence: 0.7 },
  { pattern: /\binstead\b.*\b(do|try|use)\b/i, confidence: 0.8 },
  { pattern: /\bactually[,.]?\s+(let|can|I|we)/i, confidence: 0.7 },
  { pattern: /\bwait[,.]?\s+(don't|stop|no)/i, confidence: 0.9 },
  { pattern: /\bstop\b/i, confidence: 0.6 },
  { pattern: /\bthat's (not|wrong)/i, confidence: 0.9 },
  { pattern: /\bdifferent approach\b/i, confidence: 0.8 },
  { pattern: /\bdon't do that\b/i, confidence: 0.95 },
  { pattern: /\brevert\b/i, confidence: 0.7 },
  { pattern: /\bundo\b/i, confidence: 0.7 },
];

function detectUserCorrection(event: NormalizedEvent): ClassificationLabel | null {
  if (event.type !== "user_message") return null;
  const text = event.text || "";
  if (text.length < 5) return null;

  for (const { pattern, confidence } of CORRECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { category: "friction", subcategory: "user_correction", confidence,
               evidence: `Matched pattern: ${pattern.source}` };
    }
  }
  return null;
}
```

### 5.4 Compaction Detector

```typescript
function detectCompaction(event: NormalizedEvent): ClassificationLabel | null {
  if (event.type === "compaction") {
    return { category: "friction", subcategory: "compaction", confidence: 1.0,
             evidence: "Session hit context window limit, conversation compacted" };
  }
  return null;
}
```

### 5.5 Success Detectors

```typescript
const ACK_PATTERNS = [
  /\b(looks good|lgtm|perfect|great|thanks|thank you|nice|awesome|exactly)\b/i,
  /^(yes|yep|yup|correct|right)\b/i,
  /\bgood (job|work)\b/i,
];

function detectSuccess(event: NormalizedEvent): ClassificationLabel | null {
  // Clean completion: assistant end_turn
  if (event.type === "assistant_text") {
    // This needs context — was there a preceding error?
    // Stage 4 handles this with windowed detection
    return null;
  }

  // User acknowledgment
  if (event.type === "user_message") {
    const text = event.text || "";
    for (const pattern of ACK_PATTERNS) {
      if (pattern.test(text)) {
        return { category: "success", subcategory: "user_ack", confidence: 0.7,
                 evidence: `User acknowledgment: "${text.slice(0, 50)}"` };
      }
    }
  }
  return null;
}
```

### 5.6 Windowed Detectors (Stage 4)

These operate on sequences of events, not individual events.

```typescript
interface WindowedDetectorConfig {
  retryWindowSize: number;      // default: 5 events
  retryThreshold: number;       // default: 3 (same tool called N times)
  longChainThreshold: number;   // default: 10 tool calls per user turn
  abandonedLookback: number;    // default: 3 events
}

function detectRetryPattern(
  events: NormalizedEvent[],
  index: number,
  config: WindowedDetectorConfig
): ClassificationLabel | null {
  const current = events[index];
  if (current.type !== "tool_use") return null;

  // Look backward in window for same tool name
  const windowStart = Math.max(0, index - config.retryWindowSize);
  let sameToolCount = 0;
  for (let i = windowStart; i < index; i++) {
    if (events[i].type === "tool_use" && events[i].tool_name === current.tool_name) {
      sameToolCount++;
    }
  }

  if (sameToolCount >= config.retryThreshold - 1) {
    return { category: "friction", subcategory: "retry", confidence: 0.8,
             evidence: `Tool "${current.tool_name}" called ${sameToolCount + 1} times in ${config.retryWindowSize}-event window` };
  }
  return null;
}

function detectLongChain(
  events: NormalizedEvent[],
  index: number,
  config: WindowedDetectorConfig
): ClassificationLabel | null {
  const current = events[index];
  if (current.type !== "tool_use") return null;

  // Count consecutive tool_use/tool_result events without user_message
  let chainLength = 0;
  for (let i = index; i >= 0; i--) {
    if (events[i].type === "user_message") break;
    if (events[i].type === "tool_use") chainLength++;
  }

  if (chainLength >= config.longChainThreshold) {
    return { category: "friction", subcategory: "long_chain", confidence: 0.6,
             evidence: `${chainLength} tool calls since last user message` };
  }
  return null;
}

function detectCleanCompletion(
  events: NormalizedEvent[],
  index: number
): ClassificationLabel | null {
  const current = events[index];
  if (current.type !== "assistant_text") return null;

  // Look backward — any friction events since last user_message?
  let hasFriction = false;
  for (let i = index - 1; i >= 0; i--) {
    if (events[i].type === "user_message") break;
    if (events[i].type === "tool_error") {
      hasFriction = true;
      break;
    }
  }

  if (!hasFriction) {
    return { category: "success", subcategory: "clean_completion", confidence: 0.8,
             evidence: "Assistant completed turn without preceding errors" };
  }
  return null;
}

function detectAbandoned(
  events: NormalizedEvent[],
  index: number,
  config: WindowedDetectorConfig
): ClassificationLabel | null {
  const current = events[index];
  if (current.type !== "tool_result") return null;

  // Look forward: find the next assistant_text after this tool_result
  let nextAssistantText: NormalizedEvent | null = null;
  let nextUserMessage: NormalizedEvent | null = null;
  for (let i = index + 1; i < Math.min(events.length, index + config.abandonedLookback + 2); i++) {
    if (events[i].type === "assistant_text" && !nextAssistantText) {
      nextAssistantText = events[i];
    }
    if (events[i].type === "user_message" && !nextUserMessage) {
      nextUserMessage = events[i];
      break;
    }
  }

  if (!nextAssistantText || !nextUserMessage) return null;

  // Heuristic: if the assistant's response does not reference the tool output
  // AND the next user message starts a new direction (no continuation language),
  // this tool result was likely abandoned.
  const toolOutput = (current.tool_output || "").slice(0, 100);
  const assistantText = (nextAssistantText.text || "").toLowerCase();
  const userText = (nextUserMessage.text || "").toLowerCase();

  // Check if assistant acknowledged the tool output (simple heuristic)
  const outputTokens = toolOutput.toLowerCase().split(/\s+/).filter(t => t.length > 4);
  const referencesOutput = outputTokens.some(token => assistantText.includes(token));

  if (!referencesOutput) {
    // Check if user changed direction
    const directionChangePatterns = [
      /\b(actually|instead|forget|never\s?mind|different|let's try|switch)/i,
    ];
    const userChangedDirection = directionChangePatterns.some(p => p.test(userText));

    if (userChangedDirection) {
      return { category: "friction", subcategory: "abandoned", confidence: 0.5,
               evidence: `Tool result not referenced in assistant response, user changed direction` };
    }
  }

  return null;
}
```

> **Note:** The abandoned approach detector is the weakest heuristic in M2 (confidence capped at 0.5). It relies on token overlap and direction-change keywords, which are noisy. This is a primary candidate for LLM-assisted reclassification in M2.5.

## 6. Output Schema

```typescript
interface ClassifiedEvent {
  // All fields from NormalizedEvent BaseEvent (M1 output)
  session_id: string;
  timestamp: string;
  sequence: number;
  message_uuid: string;
  parent_message_uuid: string | null;
  cwd: string | null;
  git_branch: string | null;
  is_subagent: boolean;
  parent_session_id: string | null;
  subagent_id: string | null;

  // Per-type fields (present depending on event type)
  type: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: string;
  output_truncated?: boolean;
  error?: string;
  text?: string;
  text_truncated?: boolean;
  model?: string;
  usage?: TokenUsage | null;

  // Classification fields (added by M2)
  classification: {
    category: "noise" | "friction" | "success" | "neutral";
    subcategory: string;
    confidence: number;
    evidence?: string;
  };
}
```

**Output file:** `classified-events.jsonl` — one classified event per line. All fields from M1's `NormalizedEvent` are preserved verbatim; M2 only appends the `classification` field. This ensures downstream consumers (M3) can access all original event data including fields needed for context enrichment (`cwd`, `git_branch`, `message_uuid`, etc.).

## 7. Configuration

```typescript
interface ClassifierConfig {
  // Noise filtering
  filterNoise: boolean;            // default: true (omit noise from output)

  // Windowed detector thresholds
  retryWindowSize: number;         // default: 5
  retryThreshold: number;          // default: 3
  longChainThreshold: number;      // default: 10
  abandonedLookback: number;       // default: 3

  // Output options
  includeNeutral: boolean;         // default: true
  minConfidence: number;           // default: 0.0 (include all)
  filterCategory?: SignalCategory; // optional: only output one category
}
```

All thresholds configurable via CLI flags.

## 8. CLI Interface

```bash
# Basic usage
bun scripts/signal-classify.ts --input events.jsonl --output classified-events.jsonl

# Filter to friction only
bun scripts/signal-classify.ts --input events.jsonl --filter friction --output friction.jsonl

# Adjust thresholds
bun scripts/signal-classify.ts --input events.jsonl \
  --retry-threshold 2 \
  --long-chain-threshold 8 \
  --output classified-events.jsonl

# Summary stats only (no file output)
bun scripts/signal-classify.ts --input events.jsonl --stats

# Pipe from M1
bun scripts/transcript-extract.ts --since 7d | bun scripts/signal-classify.ts --stats
```

**Stats output example:**
```
Signal Classification Summary
═══════════════════════════════
Total events:      1,247
Noise (filtered):    623 (49.9%)
Friction:             31 (2.5%)
  tool_error:         13
  user_correction:     8
  retry:               4
  long_chain:          3
  compaction:           2
  user_rejection:      1
Success:              42 (3.4%)
  clean_completion:   28
  user_ack:           14
Neutral:             551 (44.2%)
```

## 9. Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | No events found in input |
| 2 | Invalid arguments |

## 10. Implementation Plan

### Phase 1: Core Pipeline (2-3 hours)
1. Set up `scripts/signal-classify.ts` with CLI argument parsing (use `parseArgs`)
2. Implement JSONL reader for events.jsonl (streaming line-by-line)
3. Implement Stage 1: noise filter (progress, queue-op, meta, last-prompt)
4. Implement Stage 2: individual event classifiers:
   - Tool error detector with subcategories (timeout, permission, size, api_mismatch)
   - Parallel cancellation detector
   - User rejection detector
   - Compaction detector
5. Implement Stage 3: success detectors (user_ack)
6. Write classified events to output JSONL

### Phase 2: Windowed Detectors (1-2 hours)
7. Implement event window buffer (sliding window over event stream)
8. Implement retry detector
9. Implement long chain detector
10. Implement clean completion detector (needs backward scan)
11. Implement user correction detector (keyword patterns)
12. Implement abandoned approach detector (basic heuristic, confidence 0.5)

### Phase 3: Stats & CLI Polish (1 hour)
13. Implement `--stats` mode with summary table
14. Implement `--filter` for category filtering
15. Implement stdin streaming for pipe support
16. Add `--min-confidence` threshold

### Phase 4: Session-Level Aggregation (optional)
17. Aggregate per-session: friction rate, dominant friction type, session health score
18. Output `session-summary.jsonl` alongside event-level output

## 11. Validation Plan

### Precision Test
1. Run classifier on 5 real sessions
2. Manually review all events classified as "friction" — are they real friction?
3. Target: >90% precision (fewer than 10% false positives)

### Recall Test
1. Manually read 2 sessions and annotate all friction events
2. Run classifier on same sessions
3. Compare: did the classifier catch all manually-identified friction?
4. Target: >80% recall (may miss some subtle user corrections)

### Noise Reduction Test
1. Run on 10 sessions, measure noise reduction ratio
2. Target: 40-60% of events classified as noise
3. Verify zero true friction events classified as noise

### Edge Case Tests
- Session with only system messages (compacted session)
- Session with no errors (all success/neutral)
- Session with cascading parallel failures
- Very short session (1-2 exchanges)
- Subagent events (should be classified same as main session events)

## 12. Future: LLM-Assisted Classification (M2.5)

For ambiguous cases where rule-based classification has low confidence (< 0.5), a future pass could use an LLM to reclassify:

**When to add:**
- After M2 is validated and baseline precision/recall is established
- When user correction detection proves insufficient with keyword matching alone
- When M3 needs higher-quality friction signals

**How:**
- Batch low-confidence events
- Send to LLM with prompt: "Is this event a friction signal? Given the context [previous 3 events], classify this event as friction/success/neutral. Respond with {critique: '...', verdict: 'friction|success|neutral'}"
- Critique-before-verdict pattern (from Hamel's write-judge-prompt)
- Only for events already classified as neutral with nearby friction context

**Cost control:**
- Only invoke on events where rule-based confidence < 0.5
- Batch API calls (group by session)
- Cache results (same event pattern → same classification)
