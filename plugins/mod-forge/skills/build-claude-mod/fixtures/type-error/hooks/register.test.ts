import { test, expect, mock } from 'claude-code/testing'

const start = { cwd: '/run', surface: 'terminal', isInteractive: true } as const

const ack = { value: undefined } as never

test('session.start writes the marker and sets the status line', async ($, on) => {
  const writes: { path: string; text: string }[] = []
  const statuses: (string | undefined)[] = []

  mock.env(on, { MOD_FORGE_MARKER: '/run/marker' })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('fs.write', async (_$, e) => {
    writes.push({ path: e.path, text: e.text })
    return ack
  })
  on('ui.status', async (_$, e) => {
    statuses.push(e.text)
    return ack
  })

  await $.session.start(start)

  expect(writes).toEqual([{ path: '/run/marker', text: 'loaded' }])
  expect(statuses).toEqual(['type-error-probe: one'])
})
