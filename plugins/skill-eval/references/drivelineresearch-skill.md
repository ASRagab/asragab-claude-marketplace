---
name: autoresearch
description: Set up and run an autonomous experiment loop for any optimization target. Use when asked to "run autoresearch", "optimize X in a loop", "set up autoresearch for X", or "start experiments".
---
# Autoresearch
Autonomous experiment loop: try ideas, keep what works, discard what doesn't, never stop.
## Setup
1. Ask (or infer): \*\*Goal\*\*, \*\*Command\*\*, \*\*Metric\*\* (+ direction), \*\*Files in scope\*\*, \*\*Constraints\*\*.
2. `git checkout -b autoresearch/-`
3. Read the source files. Understand the workload deeply before writing anything.
4. `mkdir -p experiments` then write `autoresearch.md`, `autoresearch.sh`, and `experiments/worklog.md` (see below). Commit all three.
5. Initialize experiment (write config header to `autoresearch.jsonl`) → run baseline → log result → start looping immediately.
### `autoresearch.md`
This is the heart of the session. A fresh agent with no context should be able to read this file and run the loop effectively. Invest time making it excellent.
```markdown
# Autoresearch: 
## Objective
## Metrics
- \*\*Primary\*\*:  (, lower/higher is better)
- \*\*Secondary\*\*: , , ...
## How to Run
`./autoresearch.sh` — outputs `METRIC name=number` lines.
## Files in Scope
## Off Limits
## Constraints
## What's Been Tried
```
Update `autoresearch.md` periodically — especially the "What's Been Tried" section — so resuming agents have full context.
### `autoresearch.sh`
Bash script (`set -euo pipefail`) that: pre-checks fast (syntax errors in <1s), runs the benchmark, outputs `METRIC name=number` lines. Keep it fast — every second is multiplied by hundreds of runs. Update it during the loop as needed.
---
## JSONL State Protocol
All experiment state lives in `autoresearch.jsonl`. This is the source of truth for resuming across sessions.
### Config Header
The first line (and any re-initialization line) is a config header:
```json
{"type":"config","name":"","metricName":"","metricUnit":"","bestDirection":"lower|higher"}
```
Rules:
- First line of the file is always a config header.
- Each subsequent config header (re-init) starts a new \*\*segment\*\*. Segment index increments with each config header.
- The baseline for a segment is the first result line after the config header.
### Result Lines
Each experiment result is appended as a JSON line:
```json
{"run":1,"commit":"abc1234","metric":42.3,"metrics":{"secondary\_metric":123},"status":"keep","description":"baseline","timestamp":1234567890,"segment":0}
```
Fields:
- `run`: sequential run number (1-indexed, across all segments)
- `commit`: 7-char git short hash (the commit hash AFTER the auto-commit for keeps, or current HEAD for discard/crash)
- `metric`: primary metric value (0 for crashes)
- `metrics`: object of secondary metric values — \*\*once you start tracking a secondary metric, include it in every subsequent result\*\*
- `status`: `keep` | `discard` | `crash`
- `description`: short description of what this experiment tried
- `timestamp`: Unix epoch seconds
- `segment`: current segment index
### Initialization (equivalent of `init\_experiment`)
To initialize, write the config header to `autoresearch.jsonl`:
```bash
echo '{"type":"config","name":"","metricName":"","metricUnit":"","bestDirection":""}' > autoresearch.jsonl
```
To re-initialize (change optimization target), \*\*append\*\* a new config header:
```bash
echo '{"type":"config","name":"","metricName":"","metricUnit":"","bestDirection":""}' >> autoresearch.jsonl
```
---
## Running Experiments (equivalent of `run\_experiment`)
Run the benchmark command, capturing timing and output:
```bash
START\_TIME=$(date +%s%N)
bash -c "./autoresearch.sh" 2>&1 | tee /tmp/autoresearch-output.txt
EXIT\_CODE=$?
END\_TIME=$(date +%s%N)
DURATION=$(echo "scale=3; ($END\_TIME - $START\_TIME) / 1000000000" | bc)
echo "Duration: ${DURATION}s, Exit code: ${EXIT\_CODE}"
```
After running:
- Parse `METRIC name=number` lines from the output to extract metric values
- If exit code != 0 → this is a crash
- Read the output to understand what happened
---
## Logging Results (equivalent of `log\_experiment`)
After each experiment run, follow this exact protocol:
### 1. Determine status
- \*\*keep\*\*: primary metric improved (lower if `bestDirection=lower`, higher if `bestDirection=higher`)
- \*\*discard\*\*: primary metric worse or equal to best kept result
- \*\*crash\*\*: command failed (non-zero exit code)
Secondary metrics are for monitoring only — they almost never affect keep/discard decisions. Only discard a primary improvement if a secondary metric degraded catastrophically, and explain why in the description.
### 2. Git operations
\*\*If keep:\*\*
```bash
git add -A
git diff --cached --quiet && echo "nothing to commit" || git commit -m "
Result: {\"status\":\"keep\",\"\":,}"
```
Then get the new commit hash:
```bash
git rev-parse --short=7 HEAD
```
\*\*If discard or crash:\*\*
```bash
git checkout -- .
git clean -fd
```
> \*\*Warning:\*\* Never use `git clean -fdx` — the `-x` flag deletes gitignored files including JSONL state, dashboards, and experiment artifacts.
Use the current HEAD hash (before revert) as the commit field.
### 3. Append result to JSONL
```bash
echo '{"run":,"commit":"","metric":,"metrics":{},"status":"","description":"","timestamp":'$(date +%s)',"segment":}' >> autoresearch.jsonl
```
### 4. Update dashboard
After every log, regenerate `autoresearch-dashboard.md` (see Dashboard section below).
### 5. Append to worklog
After every experiment, append a concise entry to `experiments/worklog.md`. This file survives context compactions and crashes, giving any resuming agent (or the user) a complete narrative of the session. Format:
```markdown
### Run N:  — = ()
- Timestamp: YYYY-MM-DD HH:MM
- What changed: <1-2 sentences describing the code/config change>
- Result: , 
- Insight: 
- Next: 
```
Also update the "Key Insights" and "Next Ideas" sections at the bottom of the worklog when you learn something new.
\*\*On setup\*\*, create `experiments/worklog.md` with the session header, data summary, and baseline result. \*\*On resume\*\*, read `experiments/worklog.md` to recover context.
### 6. Secondary metric consistency
Once you start tracking a secondary metric, you MUST include it in every subsequent result. Parse the JSONL to discover which secondary metrics have been tracked and ensure all are present.
If you want to add a new secondary metric mid-session, that's fine — but from that point forward, always include it.
---
## Dashboard
After each experiment, regenerate `autoresearch-dashboard.md`:
```markdown
# Autoresearch Dashboard: 
\*\*Runs:\*\* 12 | \*\*Kept:\*\* 8 | \*\*Discarded:\*\* 3 | \*\*Crashed:\*\* 1
\*\*Baseline:\*\* :  (#1)
\*\*Best:\*\* :  (#8, -26.2%)
| # | commit |  | status | description |
|---|--------|---------------|--------|-------------|
| 1 | abc1234 | 42.3s | keep | baseline |
| 2 | def5678 | 40.1s (-5.2%) | keep | optimize hot loop |
| 3 | abc1234 | 43.0s (+1.7%) | discard | try vectorization |
...
```
Include delta percentages vs baseline for each metric value. Show ALL runs in the current segment (not just recent ones).
---
## Loop Rules
\*\*LOOP FOREVER.\*\* Never ask "should I continue?" — the user expects autonomous work.
- \*\*Primary metric is king.\*\* Improved → `keep`. Worse/equal → `discard`. Secondary metrics rarely affect this.
- \*\*Simpler is better.\*\* Removing code for equal perf = keep. Ugly complexity for tiny gain = probably discard.
- \*\*Don't thrash.\*\* Repeatedly reverting the same idea? Try something structurally different.
- \*\*Crashes:\*\* fix if trivial, otherwise log and move on. Don't over-invest.
- \*\*Think longer when stuck.\*\* Re-read source files, study the profiling data, reason about what the CPU is actually doing. The best ideas come from deep understanding, not from trying random variations.
- \*\*Resuming:\*\* if `autoresearch.md` exists, read it + `autoresearch.jsonl` + `experiments/worklog.md` + git log, continue looping. The worklog has the full narrative and insights.
\*\*NEVER STOP.\*\* The user may be away for hours. Keep going until interrupted.
## Ideas Backlog
When you discover complex but promising optimizations that you decide not to pursue right now, \*\*append them as bullet points to `autoresearch.ideas.md`\*\*. Don't let good ideas get lost.
If the loop stops (context limit, crash, etc.) and `autoresearch.ideas.md` exists, you'll be asked to:
1. Read the ideas file and use it as inspiration for new experiment paths
2. Prune ideas that are duplicated, already tried, or clearly bad
3. Create experiments based on the remaining ideas
4. If nothing is left, try to come up with your own new ideas
5. If all paths are exhausted, delete `autoresearch.ideas.md` and write a final summary report
When there is no `autoresearch.ideas.md` file and the loop ends, the research is complete.
## User Steers
User messages sent while an experiment is running should be noted and incorporated into the NEXT experiment. Finish your current experiment first — don't stop or ask for confirmation. Incorporate the user's idea in the next experiment.
## Updating autoresearch.md
Periodically update `autoresearch.md` — especially the "What's Been Tried" section — so that a fresh agent resuming the loop has full context on what worked, what didn't, and what architectural insights have been gained. Do this every 5-10 experiments or after any significant breakthrough.