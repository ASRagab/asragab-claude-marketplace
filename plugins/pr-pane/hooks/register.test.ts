import { test, expect, mock } from 'claude-code/testing'

import { counts, parse, row, sorted, stateOf } from './prs'

const start = { cwd: '/run', surface: 'terminal', isInteractive: true } as const
const ack = { value: undefined } as never
const band = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

const node = (n: number, isDraft: boolean, reviewDecision: string | null) => ({
  id: `pr-${n}`,
  number: n,
  title: `pr ${n}`,
  url: `https://github.com/o/r/pull/${n}`,
  isDraft,
  reviewDecision,
  updatedAt: '2026-10-02T12:00:00Z',
  repository: { nameWithOwner: 'o/r' },
  reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
})

const graphql = (...nodes: unknown[]) =>
  JSON.stringify({ data: { search: { issueCount: nodes.length, nodes } } })

const done = (stdout: string, exitCode = 0, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

test('a draft is a draft whatever its review decision; other states follow the decision', () => {
  expect(stateOf(true, 'APPROVED')).toBe('draft')
  expect(stateOf(true, 'CHANGES_REQUESTED')).toBe('draft')
  expect(stateOf(false, 'CHANGES_REQUESTED')).toBe('has feedback')
  expect(stateOf(false, 'APPROVED')).toBe('approved')
  expect(stateOf(false, 'REVIEW_REQUIRED')).toBe('needs review')
  expect(stateOf(false, null)).toBe('needs review')
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
  expect(sorted(prs, 'status').map(p => p.number)).toEqual([4, 3, 2, 5, 1])
  expect(counts(prs)).toEqual([
    { state: 'has feedback', n: 1 },
    { state: 'approved', n: 1 },
    { state: 'needs review', n: 2 },
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

test('session start registers /prs, validates the gh user, lists PRs and clears the pinned warning', async ($, on) => {
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
  expect(statuses).toEqual([undefined])
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
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))

  await $.session.start(start)
  await clock.advance(0)

  expect(calls.length).toBe(1)
  expect(statuses).toEqual([undefined])
  await $.command.run({ command: 'prs', args: '' } as never)
  await clock.advance(0)
  const ui = await $.ui.mount({ plugin: 'pr-pane', surface: 'terminal', component: 'AbovePrompt', props: band })
  expect(await ui.find({ text: 'You are not logged into any GitHub hosts.' })).toBeDefined()
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

test('/prs shows and hides the PR picker in the band without opening a pane', async ($, on) => {
  const log: string[] = []

  mock.env(on, {})
  const clock = mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))
  on('process.run', async (_$, e) => (e.argv[2] === 'user' ? done('me\n') : done(graphql(node(1, false, null)))))
  on('ui.status', async () => ack)
  on('ui.open', async (_$, e) => {
    log.push(`open ${e.id}`)
    return { value: { isPlaced: true } }
  })
  on('ui.close', async (_$, e) => {
    log.push(`close ${e.id}`)
    return ack
  })

  const ui = await $.ui.mount({ plugin: 'pr-pane', surface: 'terminal', component: 'AbovePrompt', props: band })
  expect(await ui.find({ key: 'pr:https://github.com/o/r/pull/1' })).toBeUndefined()
  await $.command.run({ command: 'prs', args: '' } as never)
  await clock.advance(0)
  await ui.redraw(band)
  expect(await ui.find({ key: 'pr:https://github.com/o/r/pull/1' })).toBeDefined()
  await $.command.run({ command: 'prs', args: '' } as never)
  await ui.redraw(band)
  expect(await ui.find({ key: 'pr:https://github.com/o/r/pull/1' })).toBeUndefined()
  expect(log).toEqual([])
})

test('the PR band preserves other mods and yields to a survey without losing visibility', async ($, on) => {
  mock.env(on, {})
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => (e.argv[2] === 'user' ? done('me\n') : done(graphql(node(1, false, null)))))
  on('ui.status', async () => ack)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return Box({ children: [
      Text({ children: ['another mod'] }),
      Button({ key: 'other', label: 'Another mod', autoFocus: true, onPress: () => {} }),
    ] })
  })

  const ui = await $.ui.mount({ plugin: 'pr-pane', surface: 'terminal', component: 'AbovePrompt', props: band })
  expect(await ui.find({ text: 'another mod' })).toBeDefined()
  await $.command.run({ command: 'prs', args: '' } as never)
  await clock.advance(0)
  await ui.redraw(band)
  expect(await ui.find({ text: 'another mod' })).toBeDefined()
  expect(await ui.find({ key: 'pr:https://github.com/o/r/pull/1' })).toBeDefined()
  const autofocus = (await ui.findAll({})).filter(e => e.props.autoFocus === true)
  expect(autofocus.map(e => e.key)).toEqual(['pr:https://github.com/o/r/pull/1', 'other'])

  await ui.redraw({ ...band, hasSurvey: true })
  expect(await ui.find({ text: 'another mod' })).toBeDefined()
  expect(await ui.find({ key: 'pr:https://github.com/o/r/pull/1' })).toBeUndefined()
  await ui.redraw(band)
  expect(await ui.find({ key: 'pr:https://github.com/o/r/pull/1' })).toBeDefined()
})

test('a failed refresh keeps the last list and shows the error and true count in the band', async ($, on) => {
  const statuses: (string | undefined)[] = []
  const opened: string[][] = []
  let isDown = false

  mock.env(on, {})
  const clock = mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))
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

  expect(statuses).toEqual([undefined])

  await $.command.run({ command: 'prs', args: '' } as never)
  const ui = await $.ui.mount({
    plugin: 'pr-pane',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: band,
  })
  expect(await ui.find({ text: '58 open (showing 1)' })).toBeDefined()
  expect(await ui.find({ text: 'HTTP 502' })).toBeDefined()
  await ui.press({ key: 'pr:https://github.com/o/r/pull/7' })
  expect(opened).toEqual([['open', 'https://github.com/o/r/pull/7']])
})

test('picking a row in the drawn band opens that PR in the browser', async ($, on) => {
  const opened: string[][] = []

  mock.env(on, {})
  const clock = mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))
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
  await $.command.run({ command: 'prs', args: '' } as never)
  const ui = await $.ui.mount({
    plugin: 'pr-pane',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: band,
  })
  expect((await ui.find({ type: 'Text', text: '✓ r#2 pr 2' }))?.props.color).toBe('blue')
  expect((await ui.find({ type: 'Text', text: '● r#1 pr 1' }))?.props.color).toBe('#ffa500')
  await ui.press({ key: 'pr:https://github.com/o/r/pull/2' })

  expect(opened).toEqual([['open', 'https://github.com/o/r/pull/2']])
})

test('sort controls select one mode, order rows and reset paging', async ($, on) => {
  const nodes = Array.from({ length: 11 }, (_, i) => ({
    ...node(i + 1, false, i === 10 ? 'APPROVED' : null),
    updatedAt: `2026-10-${String(i + 1).padStart(2, '0')}T12:00:00Z`,
    repository: { nameWithOwner: i === 0 ? 'a/first' : 'z/last' },
  }))
  mock.env(on, {})
  const clock = mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))
  on('process.run', async (_$, e) => e.argv[2] === 'user' ? done('me\n') : done(graphql(...nodes)))
  await $.command.run({ command: 'prs', args: '' } as never)
  await clock.advance(0)
  const ui = await $.ui.mount({ plugin: 'pr-pane', surface: 'terminal', component: 'AbovePrompt', props: band })
  const keys = async () => (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('pr:')).map(b => b.key)
  expect((await keys()).length).toBe(8)
  expect((await keys())[0]).toBe('pr:https://github.com/o/r/pull/11')
  await ui.press({ key: 'next' })
  await ui.redraw(band)
  expect((await keys()).length).toBe(3)
  expect(await ui.find({ text: 'Page 2/2' })).toBeDefined()
  await ui.press({ key: 'sort:repo' })
  await ui.redraw(band)
  expect((await keys())[0]).toBe('pr:https://github.com/o/r/pull/1')
  expect((await keys())[1]).toBe('pr:https://github.com/o/r/pull/11')
  expect(await ui.find({ text: 'Page 1/2' })).toBeDefined()
  await ui.press({ key: 'sort:date' })
  await ui.redraw(band)
  expect((await keys())[0]).toBe('pr:https://github.com/o/r/pull/11')
  expect((await ui.find({ key: 'sort:date' }))?.props.label).toBe('[date]')
  expect((await ui.find({ key: 'sort:repo' }))?.props.label).toBe('repo')
  await ui.redraw({ ...band, maxRows: 8 })
  expect((await keys()).length).toBe(1)
  expect((await ui.findAll({ type: 'Text' })).some(t => t.props.backgroundColor !== undefined)).toBe(false)
})

test('review thread pagination finds feedback, retains data on failure and clears resolved feedback', async ($, on) => {
  let fail = false
  let resolved = false
  const pages: string[][] = []
  mock.env(on, {})
  const clock = mock.clock(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('ui.status', async () => ack)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))
  on('process.run', async (_$, e) => {
    if (e.argv[2] === 'user') return done('me\n')
    if (e.argv.includes('id=pr-1')) {
      pages.push([...e.argv])
      if (fail) return done('', 1, 'HTTP 502')
      return done(JSON.stringify({ data: { node: { reviewThreads: {
        nodes: [{ isResolved: resolved }], pageInfo: { hasNextPage: false, endCursor: null },
      } } } }))
    }
    return done(graphql({ ...node(1, false, 'APPROVED'), reviewThreads: {
      nodes: [{ isResolved: true }], pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
    } }))
  })
  await $.session.start(start)
  await clock.advance(0)
  await $.command.run({ command: 'prs', args: '' } as never)
  await clock.advance(0)
  const ui = await $.ui.mount({ plugin: 'pr-pane', surface: 'terminal', component: 'AbovePrompt', props: band })
  expect((await ui.find({ type: 'Text', text: '✗ r#1 pr 1' }))?.props.color).toBe('red')
  expect(pages[0]?.includes('after=cursor-1')).toBe(true)
  fail = true
  await clock.advance(60_000)
  await clock.advance(0)
  await ui.redraw(band)
  expect(await ui.find({ text: 'HTTP 502' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '✗ r#1 pr 1' }))?.props.color).toBe('red')
  fail = false
  resolved = true
  await clock.advance(60_000)
  await clock.advance(0)
  await ui.redraw(band)
  expect((await ui.find({ type: 'Text', text: '✓ r#1 pr 1' }))?.props.color).toBe('blue')
  expect(await ui.find({ text: 'HTTP 502' })).toBeUndefined()
})
