# Design: cass plugin perf defaults + session-resume

## Decision 1 — Token-perf defaults: recipe-level, not shim

**Chosen:** Bake `--fields summary --max-tokens 1600 --robot-format toon` into the lead example of every skill recipe. Hook also exports `CASS_OUTPUT_FORMAT=toon` so non-search commands inherit it without per-recipe noise.

**Rejected:** Wrapping `cass` in a shell function the hook installs that auto-injects flags. Too implicit; users reading a recipe would not see the actual flags being applied; debugging surprises when overrides collide.

**Why 1600 max-tokens:** Empirical sweet spot. 800 truncates titles aggressively in dense workspaces; 3200 leaves headroom but defeats the purpose. 1600 fits ~10 summary hits comfortably and is a clean factor-of-2.

**Why summary preset (not minimal):** `minimal` = path/line/agent only — no title, no score. Without title the agent can't decide which hit to drill into; without score it can't rank. `summary` adds both for ~+50 bytes per hit. Worth it.

**Trade-off accepted:** Recipes get one extra flag tuple to read. Acceptable because it teaches the right pattern by example.

**Trade-off rejected:** Snippet preset that includes truncated content. Tempting (gives context without full content) but breaks the "aggregate first, drill second" workflow. If a skill needs snippet, it opts in explicitly.

## Decision 2 — TOON encoding via env, not per-call flag

**Chosen:** Hook exports `CASS_OUTPUT_FORMAT=toon`. Recipes that need pretty JSON for human transcripts pass `--robot-format json` explicitly to override.

**Why:** TOON encoding alone shaves only ~1-2% on search payloads (content dominates), but on bounded commands (stats, sessions, timeline, analytics) the relative gain is larger and free. Setting once via env removes flag noise from every recipe.

**Risk:** Export persists for the entire shell session. If user runs `cass` outside a skill (interactive), they get TOON. Mitigation: TOON is reasonable human output too; not a regression. If they hate it, they unset the env var.

**Edge case:** Hook should not export when CLI < 0.3.0 (TOON support landed in 0.3). Add a capabilities check before export.

## Decision 3 — session-resume as standalone skill

**Chosen:** New skill `session-resume` with its own SKILL.md.

**Rejected option A:** Add a "resume" section to `session-context`. Activation phrasing differs ("catch me up" vs "resume that"); merging them muddies skill discovery and forces context skill to do command-shaped output.

**Rejected option B:** Add to `session-export`. Resume produces a launch command, not an export artifact. Different concept entirely.

**Output shape:** Both fenced code block (human readable) and bare command (paste). Output stays under ~600 tokens worst case.

**Lead recipe:** Current-workspace case (`cass sessions --current` → `cass resume`). Highest-frequency. Topic-search-then-resume is example #2.

**Edge case handling:**
- Multiple matches → present compact list `agent · time · title-fragment`, ask user to pick.
- `source_id != local` → warn that session lives on remote machine; offer `ssh <host> "<shell_command>"` wrapper.
- Cross-agent (user in Claude, session is Codex) → state explicitly "this opens a different harness than the current session".
- `cass resume` errors (path missing, etc) → suggest `cass doctor`.

**Not handled (per scope):** Soft memory of last-resumed session. Adds state for marginal benefit.

## Decision 4 — Reference doc strategy: hybrid

**Chosen:** Keep stable hot-path commands inline in `command-reference.md` (search, sessions, view, expand, context, timeline, stats, health, status, doctor, index). Replace long-tail sections with `cass robot-docs <topic>` pointers (analytics, sources, contracts, exit-codes, env, paths, schemas).

**Why hybrid not pure-live:** Per-skill cost of shelling out to `cass robot-docs` adds latency and a hard cli dependency for skill loading. Hot paths kept inline keep skills usable when cli is briefly unavailable (mid-upgrade).

**Why hybrid not pure-static:** Long-tail topics (analytics schemas, sources flags, contract envelopes) churn faster and matter less for everyday skill recipes. Pointing at `cass robot-docs` for those is honest about the source of truth.

## Decision 5 — Version gating

**Chosen:** Plugin declares minimum `cass` ≥ 0.3.0 in the SessionStart hook. If lower, hook emits a systemMessage advising upgrade. Skills do not individually version-gate (too noisy).

**Why:** TOON env, `cass resume`, `cass robot-docs`, and `cass api-version` all landed in v0.3.0. Single floor is simpler than per-feature checks.

**Mechanism:** Hook calls `cass api-version --json` (preferred — cheapest). Falls back to `cass capabilities --json` if api-version absent.

## Trade-off summary

| Trade-off | Chosen | Cost |
|-----------|--------|------|
| Field defaults vs verbose first example | summary + max-tokens lead | +1 flag tuple per recipe |
| Shim vs explicit flags | explicit | recipes look noisier |
| TOON env vs per-call | env | session-wide spillover |
| Standalone resume skill vs merged | standalone | new SKILL.md to maintain |
| Hybrid doc vs pure live | hybrid | two sources of truth |
| Single version floor vs per-feature | floor at 0.3.0 | breaks anyone on 0.2.x |

## Open questions

- Should `--max-tokens 1600` be configurable via env (`CASS_MAX_TOKENS_DEFAULT`)? Out of scope for this change; revisit if users tune frequently.
- Does the hook's TOON export survive across tool calls in Claude Code, or only within the single hook invocation? Needs verification — if it does not propagate, recipes need the per-call flag after all.
