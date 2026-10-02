import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const marker = await $.env.get('MOD_FORGE_MARKER')
    if (marker) await $.fs.write(marker, 'loaded')
    $.ui.status('loop-probe: loaded')
    return next(e)
  })
}
