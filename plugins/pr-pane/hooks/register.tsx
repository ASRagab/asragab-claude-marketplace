import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PrState, View } from '../types'
import { GLYPH, QUERY, SHORT, counts, parse, row, total } from './prs'

const REFRESH_MS = 60_000
const COLOR: Record<PrState, string | undefined> = {
  'changes requested': 'red',
  approved: 'green',
  'ready for review': 'cyan',
  draft: undefined,
}
const view = atom({ plugin: 'pr-pane', key: 'view' } as const, { prs: [], total: 0 } as View)
const visible = atom({ plugin: 'pr-pane', key: 'visible' } as const, false)

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
    const prs = parse(out)
    const count = total(out)
    const updatedAt = await $.clock.now()
    await update($, view, () => ({ login, prs, total: count, updatedAt }))
    $.ui.status(`PRs: ${count} open`)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await update($, view, v => ({ ...v, error }))
    $.ui.status('PRs: unavailable')
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
    const { Box, Text } = t
    const v = await read($, view)
    const at = v.updatedAt ? new Date(v.updatedAt).toTimeString().slice(0, 5) : undefined
    return (
      <Box flexDirection="column">
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
        {'Select' in t && v.prs.length > 0 && (
          <t.Select
            key="prs"
            autoFocus
            label="Selected"
            options={v.prs.map(p => ({ value: p.url, label: row(p, v.prs) }))}
            onSelect={url => void openUrl($, url)}
          />
        )}
        <Text dimColor>Ctrl+X then Tab focuses · up/down move · Enter opens · Esc back to prompt · /prs hides</Text>
        {theirs}
      </Box>
    )
  })
}
