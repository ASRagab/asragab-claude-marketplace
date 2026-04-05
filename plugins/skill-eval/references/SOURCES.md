# Sources & Prior Art

## Core References

| # | Title | Author | URL |
|---|-------|--------|-----|
| 1 | autoresearch | @karpathy | https://github.com/karpathy/autoresearch |
| 2 | evals-skills | @HamelHusain | https://github.com/hamelsmu/evals-skills |
| 3 | Improving AI Skills with autoresearch & evals | @nurijanian | https://x.com/nurijanian/status/2035257434365976671 |
| 4 | How to 10x your Claude Skills (autoresearch method) | @itsolelehmann | https://x.com/itsolelehmann/status/2033919415771713715 |
| 5 | autoresearch-skill repo | @itsolelehmann | https://github.com/olelehmann100kMRR/autoresearch-skill |
| 6 | PM's Guide to Karpathy's Autoresearch | @aakashgupta | https://www.news.aakashg.com/p/autoresearch-guide-for-pms |
| 7 | AI Evals for Engineers & PMs (course) | Hamel Husain & Shreya Rajpal | https://maven.com/parlance-labs/evals |

## Key Frameworks

### The Three Gulfs (Hamel Husain, via George @nurijanian)

1. **Gulf of Comprehension** — Gap between what you think your system does vs. what it actually does. Only closes by reading outputs manually.
2. **Gulf of Specification** — Gap between what you want vs. what your judges measure. Can't close without closing comprehension first.
3. **Gulf of Generalization** — Gap between test performance and real-world performance. Autoresearch helps here, but only after gulfs 1 and 2 are closed.

### George's Three Takes (learning progression)

- **Take 1**: Fully automated — auto-generated inputs + auto-generated judges → scores went up, skill didn't improve (judges measured the wrong things)
- **Take 2**: Added evals-skills for structured input generation → inputs improved, judges still wrong
- **Take 3**: Manual error analysis (open coding → axial coding → failure taxonomy) → grounded judges → autoresearch actually worked

### Autoresearch Pattern (Karpathy)

Three files: `train.py` (mutable, agent edits), `prepare.py` (eval, immutable), `program.md` (agent instructions, human edits).
Loop: read → hypothesize → edit → eval → keep/revert → repeat. ~12 experiments/hour.

## Prior Work in This Workspace

- `Projects/skill-eval-sandbox/` — Research notes, articles, Claude Code hooks design, reference material
- `Projects/zo-rl-training/` — GRPO RL training on Modal GPUs (hit sparse reward wall; autoresearch approach sidesteps this)
