import type { Register } from 'claude-code'

import { closeTurn, openTurn, recordPrompt, registerCapture } from '../src/capture/hooks'
import { attachAssess, nudgePrompt, registerNudge } from '../src/nudge/hooks'
import { readConfig } from '../src/shared/config'
import { fallThrough } from '../src/shared/safe'

// One registration per event: capture and nudge each contribute to the same hook.
export const register: Register = (on, options) => {
  const cfg = readConfig(options as Record<string, unknown>)

  registerCapture(on, cfg)
  registerNudge(on)

  on('prompt.submit', async ($, e, next) => {
    await recordPrompt($, e)
    return nudgePrompt($, cfg, e, next)
  }).catch(fallThrough)

  on('turn.start', async ($, e, next) => {
    await openTurn($, cfg, e)
    const result = await next(e)
    await attachAssess($, cfg, e)
    return result
  }).catch(fallThrough)

  on('turn.complete', async ($, e, next) => {
    await closeTurn($, cfg, e)
    return next(e)
  }).catch(fallThrough)
}
