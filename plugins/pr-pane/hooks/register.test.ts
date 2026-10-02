import { test, expect, mock } from 'claude-code/testing'

import { counts, parse, row, stateOf } from './prs'

const start = { cwd: '/run', surface: 'terminal', isInteractive: true } as const
const ack = { value: undefined } as never

const node = (n: number, isDraft: boolean, reviewDecision: string | null) => ({
  number: n,
  title: `pr ${n}`,
  url: `https://github.com/o/r/pull/${n}`,
  isDraft,
  reviewDecision,
  repository: { nameWithOwner: 'o/r' },
})

const graphql = (...nodes: unknown[]) =>
  JSON.stringify({ data: { search: { issueCount: nodes.length, nodes } } })

const done = (stdout: string, exitCode = 0, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

test('a draft is a draft whatever its review decision; other states follow the decision', () => {
  expect(stateOf(true, 'APPROVED')).toBe('draft')
  expect(stateOf(true, 'CHANGES_REQUESTED')).toBe('draft')
  expect(stateOf(false, 'CHANGES_REQUESTED')).toBe('changes requested')
  expect(stateOf(false, 'APPROVED')).toBe('approved')
  expect(stateOf(false, 'REVIEW_REQUIRED')).toBe('ready for review')
  expect(stateOf(false, null)).toBe('ready for review')
})

test('parse keeps repo, number, url and state, and drops empty search nodes', () => {
  const prs = parse(graphql(node(1, false, 'APPROVED'), null, node(2, true, null)))
  expect(prs.map(p => [p.repo, p.number, p.url, p.state])).toEqual([
    ['o/r', 1, 'https://github.com/o/r/pull/1', 'approved'],
    ['o/r', 2, 'https://github.com/o/r/pull/2', 'draft'],
  ])
})

test('rows are grouped by what needs the author first, and the legend counts each state', () => {
  const prs = parse(
    graphql(node(1, true, null), node(2, false, null), node(3, false, 'APPROVED'), node(4, false, 'CHANGES_REQUESTED'), node(5, false, null)),
  )
  expect(prs.map(p => p.number)).toEqual([4, 3, 2, 5, 1])
  expect(counts(prs)).toEqual([
    { state: 'changes requested', n: 1 },
    { state: 'approved', n: 1 },
    { state: 'ready for review', n: 2 },
    { state: 'draft', n: 1 },
  ])
})

test('a row is glyph, short repo and title; the owner stays only when two repos share a name', () => {
  const solo = parse(graphql(node(9, false, 'APPROVED')))
  expect(row(solo[0]!, solo)).toBe('✓ r#9 pr 9')

  const other = { ...solo[0]!, repo: 'x/r', number: 1 }
  const both = [solo[0]!, other]
  expect(row(both[0]!, both)).toBe('✓ o/r#9 pr 9')
  expect(row(both[1]!, both)).toBe('✓ x/r#1 pr 9')
})

test('session start registers /prs, validates the gh user, then lists PRs and sets the count', async ($, on) => {
  const calls: string[][] = []
  const statuses: (string | undefined)[] = []
  const commands: string[] = []

  mock.env(on, {})
  const clock = mock.clock(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => {
    commands.push(e.name)
    return { value: { command: e.name } } as never
  })
  on('process.run', async (_$, e) => {
    calls.push([...e.argv])
    return e.argv[2] === 'user' ? done('ASRagab\n') : done(graphql(node(1, false, null), node(2, true, null)))
  })
  on('ui.status', async (_$, e) => {
    statuses.push(e.text)
    return ack
  })

  await $.session.start(start)
  await clock.advance(0)

  expect(commands).toEqual(['prs'])
  expect(calls.map(c => c.slice(0, 3))).toEqual([
    ['gh', 'api', 'user'],
    ['gh', 'api', 'graphql'],
  ])
  expect(statuses).toEqual(['PRs: 2 open'])
})

test('a logged-out gh stops before the PR query and says so', async ($, on) => {
  const calls: string[][] = []
  const statuses: (string | undefined)[] = []

  mock.env(on, {})
  const clock = mock.clock(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('process.run', async (_$, e) => {
    calls.push([...e.argv])
    return done('', 1, 'You are not logged into any GitHub hosts.\n')
  })
  on('ui.status', async (_$, e) => {
    statuses.push(e.text)
    return ack
  })

  await $.session.start(start)
  await clock.advance(0)

  expect(calls.length).toBe(1)
  expect(statuses).toEqual(['PRs: unavailable'])
})

test('the list refreshes every 60 seconds', async ($, on) => {
  let queries = 0

  mock.env(on, {})
  const clock = mock.clock(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('process.run', async (_$, e) => {
    if (e.argv[2] === 'graphql') queries++
    return e.argv[2] === 'user' ? done('me\n') : done(graphql())
  })
  on('ui.status', async () => ack)

  await $.session.start(start)
  await clock.advance(0)
  expect(queries).toBe(1)

  await clock.advance(60_000)
  await clock.advance(0)
  expect(queries).toBe(2)
})

test('/prs opens the pane when closed and closes it when open', async ($, on) => {
  const log: string[] = []
  let isUp = false

  mock.env(on, {})
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => (e.argv[2] === 'user' ? done('me\n') : done(graphql())))
  on('ui.status', async () => ack)
  on('ui.panes', async () => ({ value: isUp ? [{ id: 'prs', title: 'Open PRs', isShown: true, isFocused: true, isPlaced: true }] : [] }))
  on('ui.open', async (_$, e) => {
    log.push(`open ${e.id} focus=${e.focus}`)
    isUp = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', async (_$, e) => {
    log.push(`close ${e.id}`)
    isUp = false
    return ack
  })

  await $.command.run({ command: 'prs', args: '' } as never)
  await $.command.run({ command: 'prs', args: '' } as never)

  expect(log).toEqual(['open prs focus=true', 'close prs'])
})

test('a failed refresh keeps the last list; the status reports the true total, not the page size', async ($, on) => {
  const statuses: (string | undefined)[] = []
  const opened: string[][] = []
  let isDown = false

  mock.env(on, {})
  const clock = mock.clock(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'open') {
      opened.push([...e.argv])
      return done('')
    }
    if (isDown) return done('', 1, 'HTTP 502')
    if (e.argv[2] === 'user') return done('me\n')
    // 58 open PRs in all, one page of one row
    return done(JSON.stringify({ data: { search: { issueCount: 58, nodes: [node(7, false, null)] } } }))
  })
  on('ui.status', async (_$, e) => {
    statuses.push(e.text)
    return ack
  })

  await $.session.start(start)
  await clock.advance(0)
  isDown = true
  await clock.advance(60_000)
  await clock.advance(0)

  expect(statuses).toEqual(['PRs: 58 open', 'PRs: unavailable'])

  await $.ui.mount({
    plugin: 'pr-pane',
    surface: 'terminal',
    component: 'Pane',
    props: { title: 'Open PRs', isFocused: true, bodyColumns: 100 } as never,
    requestId: 'prs',
  })
  await $.ui.select({ plugin: 'pr-pane', key: 'prs', value: 'https://github.com/o/r/pull/7' })
  expect(opened).toEqual([['open', 'https://github.com/o/r/pull/7']])
})

test('picking a row in the drawn pane opens that PR in the browser', async ($, on) => {
  const opened: string[][] = []

  mock.env(on, {})
  const clock = mock.clock(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'open') {
      opened.push([...e.argv])
      return done('')
    }
    return e.argv[2] === 'user' ? done('me\n') : done(graphql(node(1, false, null), node(2, false, 'APPROVED')))
  })
  on('ui.status', async () => ack)

  await $.session.start(start)
  await clock.advance(0)
  await $.ui.mount({
    plugin: 'pr-pane',
    surface: 'terminal',
    component: 'Pane',
    props: { title: 'Open PRs', isFocused: true, bodyColumns: 100 } as never,
    requestId: 'prs',
  })
  await $.ui.select({ plugin: 'pr-pane', key: 'prs', value: 'https://github.com/o/r/pull/2' })

  expect(opened).toEqual([['open', 'https://github.com/o/r/pull/2']])
})
