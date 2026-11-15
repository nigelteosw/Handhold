import type { Register } from 'claude-code'

import { closeTurn, openTurn, recordPrompt, registerCapture } from '../src/capture/hooks'
import { attachAssess, nudgePrompt, registerNudge } from '../src/nudge/hooks'
import { noteText } from '../src/nudge/note'
import { postAssess, throttle } from '../src/nudge/note'
import { readConfig } from '../src/shared/config'
import { refreshHistory } from '../src/reflect/history'
import { drawPane, PANE_ID } from '../src/reflect/pane'
import { registerCommands } from '../src/shared/commands'
import { fallThrough } from '../src/shared/safe'

// One registration per event: capture and nudge each contribute to the same hook, in this order.
export const register: Register = (on, options) => {
  const cfg = readConfig(options as Record<string, unknown>)

  registerCapture(on, cfg)
  registerNudge(on)

  registerCommands(on, cfg)

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e) => drawPane($, e))

  on('prompt.submit', async ($, e, next) => {
    await recordPrompt($, e)
    // Review mode makes no model call here: the prompt is only recorded.
    if (cfg.mode !== 'live') return next(e)
    return nudgePrompt($, cfg, e, next)
  }).catch(fallThrough)

  on('turn.start', async ($, e, next) => {
    await openTurn($, cfg, e)
    const result = await next(e)
    if (cfg.mode === 'live') await attachAssess($, cfg, e)
    return result
  }).catch(fallThrough)

  on('turn.complete', async ($, e, next) => {
    const closed = await closeTurn($, cfg, e)
    const result = await next(e)
    if (!closed) return result
    if (cfg.mode !== 'live') {
      await refreshHistory($, cfg)
      return result
    }

    const a = await postAssess($, cfg, closed)
    // After the judge, so an open history page gets the turn with its scores.
    await refreshHistory($, cfg)
    const show = a !== null && (await throttle($, a, cfg.noteEvery))
    return show && a ? { ...result, text: noteText(a) } : result
  }).catch(fallThrough)
}
