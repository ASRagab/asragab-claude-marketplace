import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SortBy, View } from '../types'
import { COLOR, GLYPH, QUERY, SHORT, THREADS_QUERY, counts, parse, row, sorted } from './prs'
import type { PullRequestNode, ThreadPage } from './prs'

const REFRESH_MS = 60_000
const view = atom({ plugin: 'pr-pane', key: 'view' } as const, { prs: [], total: 0 } as View)
const visible = atom({ plugin: 'pr-pane', key: 'visible' } as const, false)
const sort = atom({ plugin: 'pr-pane', key: 'sort' } as const, 'status' as SortBy)
const page = atom({ plugin: 'pr-pane', key: 'page' } as const, 0)

const gh = async ($: EngineInterface, args: string[], failure: string): Promise<string> => {
  const ran = await $.process
    .run(['gh', ...args], { timeoutMs: 20_000 })
    .catch(() => undefined)
  if (!ran) throw new Error('gh could not run (not installed, or no answer in 20s): install the GitHub CLI, then run `gh auth login`')
  if (ran.exitCode !== 0) throw new Error(`${failure}: ${ran.stderr.trim().split('\n')[0]}`)
  return ran.stdout
}

let isBusy = false

const refresh = async ($: EngineInterface): Promise<void> => {
  if (isBusy) return
  isBusy = true
  try {
    const login = (
      await gh($, ['api', 'user', '--jq', '.login'], 'gh is not authenticated, run `gh auth login`')
    ).trim()
    const out = await gh($, ['api', 'graphql', '-f', `query=${QUERY}`], 'gh could not list PRs')
    const response = JSON.parse(out)
    for (const n of response.data.search.nodes as (PullRequestNode | null)[]) {
      if (!n || n.isDraft || n.reviewDecision === 'CHANGES_REQUESTED') continue
      let threads = n.reviewThreads
      while (!threads.nodes.some(t => t?.isResolved === false) && threads.pageInfo.hasNextPage) {
        const after = threads.pageInfo.endCursor
        if (!after) throw new Error('GitHub returned an incomplete review thread page')
        const more = await gh($, ['api', 'graphql', '-f', `query=${THREADS_QUERY}`, '-f', `id=${n.id}`, '-f', `after=${after}`], 'gh could not list review threads')
        const next = JSON.parse(more).data?.node?.reviewThreads as ThreadPage | undefined
        if (!next || (next.pageInfo.hasNextPage && next.pageInfo.endCursor === after)) {
          throw new Error('GitHub returned an incomplete review thread page')
        }
        threads = next
      }
      n.reviewThreads = threads
    }
    const prs = parse(JSON.stringify(response))
    const count = response.data.search.issueCount as number
    const updatedAt = await $.clock.now()
    await update($, view, () => ({ login, prs, total: count, updatedAt }))
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await update($, view, v => ({ ...v, error }))
  } finally {
    isBusy = false
  }
}

// ponytail: macOS `open`, then Linux `xdg-open`; no Windows.
const openUrl = async ($: EngineInterface, url: string): Promise<void> => {
  if (!url.startsWith('https://')) return
  for (const bin of ['open', 'xdg-open']) {
    const ran = await $.process.run([bin, url]).catch(() => undefined)
    if (ran?.exitCode === 0) return
  }
  $.ui.toast(`Could not open ${url}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const marker = await $.env.get('MOD_FORGE_MARKER')
    if (marker) await $.fs.write(marker, 'loaded')
    await $.command.register({ name: 'prs', description: 'Toggle open pull requests above the prompt' })
    $.ui.status(undefined)
    const started = await next(e)
    void refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))
    return started
  })

  on('command.run', { command: 'prs' }, async $ => {
    const isVisible = !(await read($, visible))
    await update($, visible, () => isVisible)
    if (isVisible) void refresh($)
    return { text: isVisible ? 'PR list shown above the prompt.' : 'PR list hidden.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, visible))) return next(e)
    const theirs = await next(e)
    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    const v = await read($, view)
    const by = await read($, sort)
    const prs = sorted(v.prs, by)
    const size = Math.max(1, Math.min(8, e.props.maxRows - 7 - (v.error ? 1 : 0)))
    const pages = Math.max(1, Math.ceil(prs.length / size))
    const current = Math.min(await read($, page), pages - 1)
    const shown = prs.slice(current * size, (current + 1) * size)
    const movePage = async (to: number) => {
      await update($, page, () => to)
      const first = prs[to * size]
      if (first) void $.ui.focus({ requestId: e.requestId, key: `pr:${first.url}` }).catch(() => undefined)
    }
    const changeSort = async (to: SortBy) => {
      await update($, page, () => 0)
      await update($, sort, () => to)
    }
    const at = v.updatedAt ? new Date(v.updatedAt).toTimeString().slice(0, 5) : undefined
    const rule = '─'.repeat(Math.max(0, e.props.bodyColumns))
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">{rule}</Text>
        <Text bold>
          {v.login ? `@${v.login}` : 'GitHub'} · {v.total} open
          {v.total > v.prs.length ? ` (showing ${v.prs.length})` : ''}
          {at ? ` · updated ${at}` : ''}
        </Text>
        <Box>
          {counts(v.prs).map(c => (
            <Text color={COLOR[c.state]} dimColor={c.state === 'draft'}>
              {GLYPH[c.state]} {c.n} {SHORT[c.state]}{'   '}
            </Text>
          ))}
        </Box>
        {v.error && <Text color="red">{v.error}</Text>}
        {v.prs.length === 0 && !v.error && (
          <Text dimColor>{v.updatedAt ? 'No open PRs.' : 'Loading...'}</Text>
        )}
        <Box columnGap={2}>
          <Text dimColor>Sort:</Text>
          {(['repo', 'status', 'date'] as const).map(mode => (
            <Button key={`sort:${mode}`} plain hotkey={mode[0]} label={by === mode ? `[${mode}]` : mode} onPress={() => changeSort(mode)} />
          ))}
          <Text dimColor>{by === 'date' ? 'updated ↓' : 'updated ↓ within groups'}</Text>
        </Box>
        {shown.map((p, i) => (
          <Box columnGap={1}>
            <Button key={`pr:${p.url}`} plain label="›" autoFocus={i === 0 ? true : undefined} onPress={() => openUrl($, p.url)} />
            <Text color={COLOR[p.state]} dimColor={p.state === 'draft'} wrap="truncate-end">{row(p, prs)}</Text>
          </Box>
        ))}
        {prs.length > 0 && (
          <Box columnGap={2}>
            {current > 0 && <Button key="previous" plain hotkey="p" label="Previous" onPress={() => movePage(current - 1)} />}
            <Text dimColor>Page {current + 1}/{pages}</Text>
            {current + 1 < pages && <Button key="next" plain hotkey="n" label="Next" onPress={() => movePage(current + 1)} />}
          </Box>
        )}
        <Text dimColor>Ctrl+X then Tab focuses · ↑/↓ or Tab move · Enter opens · r/s/d sort · p/n page · Esc prompt · /prs hides</Text>
        <Text dimColor wrap="truncate-end">{rule}</Text>
        {theirs}
      </Box>
    )
  })
}
