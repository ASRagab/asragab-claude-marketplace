import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Deliberate type error: the module runs, so validate, test, headless and
    // interactive accept it and only the typecheck stage fails.
    const count: number = 'one'
    const marker = await $.env.get('MOD_FORGE_MARKER')
    if (marker) await $.fs.write(marker, 'loaded')
    $.ui.status(`type-error-probe: ${count}`)
    return next(e)
  })
}
