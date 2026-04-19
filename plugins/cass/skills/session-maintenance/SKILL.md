---
name: session-maintenance
description: >-
  This skill should be used when the user asks to "fix cass", "rebuild index",
  "cass doctor", "repair sessions", "index status", "reindex",
  "cass not working", "search is broken", "stale index", "rebuild analytics",
  "validate data", "manage models", "semantic search setup",
  "configure remote sources", "sync sources",
  or needs to diagnose, repair, or maintain their CASS installation,
  index, analytics data, semantic models, or remote sources.
version: 0.3.0
---

# Session Maintenance

Diagnose, repair, and maintain the CASS installation including the search index,
analytics rollup tables, semantic search models, and remote sources.

## Quick Diagnostics

### Health Check

Fast pre-flight check (<50ms):

```bash
cass health --json
```

Exit 0 = healthy, 1 = unhealthy. Use this before any search operation.

### Detailed Status

```bash
cass status --json
```

Returns: index freshness, database stats, pending sessions, recommended action.

### Full Diagnostics

```bash
cass diag --json --verbose
```

Returns: version, platform, database size, index size, connector status, paths.

## Index Management

### Rebuild the Index

```bash
# Incremental update (new sessions only)
cass index --json

# Full rebuild from scratch
cass index --full --json

# Build with semantic embeddings
cass index --full --semantic --json

# Build HNSW index for fast approximate search
cass index --full --semantic --build-hnsw --json

# Watch mode (re-index on changes)
cass index --watch --json
```

### When to Rebuild

- `cass health` returns unhealthy
- `cass status` shows `stale: true`
- Search results seem incomplete or missing recent sessions
- After installing/updating CASS

## Analytics Maintenance

### Check Analytics Health

```bash
cass analytics status --json
```

Look at:
- `data.coverage.api_token_coverage_pct` — should be > 0% for meaningful token analytics
- `data.drift.signals` — any drift indicates inconsistency
- `data.recommended_action` — follow this

### Validate Analytics Data

```bash
# Check for issues
cass analytics validate --json

# Auto-fix safe issues (Track A rollups only)
cass analytics validate --fix --json
```

### Rebuild Analytics Rollups

```bash
# Rebuild when rollups are stale or corrupt
cass analytics rebuild --json

# Force rebuild even if rollups appear fresh
cass analytics rebuild --force --json
```

### Repair Workflow

When analytics data is wrong:

```bash
# 1. Validate to identify issues
cass analytics validate --json

# 2. If errors found, try auto-fix first
cass analytics validate --fix --json

# 3. If auto-fix insufficient, force rebuild
cass analytics rebuild --force --json

# 4. Re-validate to confirm
cass analytics validate --json
```

## Doctor

Automated diagnosis and repair:

```bash
# Diagnose issues (safe, read-only)
cass doctor

# Apply automatic repairs (rebuilds derived data, preserves sources)
cass doctor --fix
```

Doctor is safe by default — it never deletes user session data. The `--fix` flag
only rebuilds derived data (index, rollups).

## Semantic Search Models

### List Available Models

```bash
cass models status --json
```

### Model Setup

Semantic search requires embedding models. After downloading a model:

```bash
# Build semantic index
cass index --semantic --json

# Build HNSW for fast approximate-nearest-neighbor search
# Recommended when stats reports > ~10,000 conversations.
# Without HNSW, semantic search degrades on large indexes; with HNSW,
# `cass search --mode semantic --approximate` becomes order-of-magnitude faster.
cass index --semantic --build-hnsw --json
```

### When to enable HNSW

```bash
cass stats --json | jq '.conversations'
```

If `> 10000`: build HNSW. Below that, brute-force semantic is fast enough.

### Daemon Management

For faster repeated semantic queries, use the daemon:

```bash
# Start the daemon (Unix only)
cass daemon

# Searches will auto-use daemon when available
cass search "concept" --mode semantic --daemon --json
```

## Remote Sources

### Setup Remote Sources

Interactive wizard for configuring multi-machine search:

```bash
# Interactive setup (recommended)
cass sources setup

# Specific hosts
cass sources setup --hosts css,csd

# Preview without changes
cass sources setup --dry-run

# Non-interactive (for scripting)
cass sources setup --non-interactive --hosts css,csd
```

### Manage Sources

```bash
# List configured sources
cass sources list

# Sync data from all sources
cass sources sync

# Discover available hosts
cass sources discover

# Add a source manually
cass sources add user@hostname

# Diagnose remote connectivity (SSH/install/index status per host)
cass sources doctor

# Manage path mappings between local and remote workspaces
cass sources mappings
```

### When to use sources doctor

- After exit code `4` (network) or `8` (partial sync)
- When `cass search --source <host>` returns no results but local does
- When SSH config changes (new keys, rotated hosts)

### Path mappings

Use `cass sources mappings` when remote machines mount workspaces under different paths than local (e.g. local `/Users/me/Dev/proj` vs remote `/home/me/proj`). Mappings allow `--workspace` filters to match across machines.

## Troubleshooting

### Search Returns No Results

1. `cass health --json` — check if healthy
2. `cass stats --json` — check conversation/message counts
3. If counts are 0: `cass index --full --json`
4. If counts > 0 but no results: try broader query, remove filters

### Analytics Shows No Data

1. `cass analytics status --json` — check coverage
2. If `api_token_coverage_pct` is 0: API tokens not available for your agents (content estimates still work)
3. If tables missing: `cass analytics rebuild --json`

### Stale Index Warning

```bash
# Check how stale
cass status --json

# Refresh
cass index --json

# Or set up watch mode for automatic updates
cass index --watch
```

### Database Errors (Exit Code 9)

```bash
# If retryable=true: transient lock, retry after 1s
# If retryable=false: schema issue
cass doctor --fix
cass index --full --json
```

## Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | - |
| 2 | Usage error | Fix command flags |
| 3 | Missing database / index | Run `cass index --full` |
| 4 | Network error (remote sources) | Check SSH; retry; `cass sources doctor` |
| 5 | Data corruption | `cass doctor --fix`; if persistent, `cass index --full` |
| 6 | Incompatible CLI version | Upgrade `cass` (`brew upgrade cass` or installer) |
| 7 | Lock / busy | Retry after 1s |
| 8 | Partial success (e.g. some remote sources synced, others failed) | `cass sources doctor`; re-run `cass sources sync` for failed hosts |
| 9 | Unknown / database error | If `retryable=true`: retry after 1s. Otherwise: `cass doctor --fix`, then `cass index --full` |

## Best Practices

- Run `cass health --json` as a pre-flight check before search operations.
- Use `cass doctor --fix` as the first response to any CASS issue.
- Rebuild analytics after significant indexing: `cass analytics rebuild --json`.
- Set up `cass index --watch` for always-fresh index during active development.
- Use `cass sources setup` for multi-machine search — it handles SSH config discovery automatically.

## Additional Resources

- **[Command Reference](../../references/command-reference.md)** - CASS CLI v0.3.x reference (hot-path commands inline; long-tail topics via `cass robot-docs <topic>`)
