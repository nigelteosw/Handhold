import type { EngineInterface as Engine, On } from 'claude-code'

import type { Config } from './config'
import { exportCmd } from '../reflect/export'
import { forgetCmd } from '../reflect/forget'
import { historyCmd } from '../reflect/history'
import { openPane } from '../reflect/pane'
import { review } from '../reflect/review'
import { setQuiet } from '../nudge/note'
import { fallThrough } from './safe'

export const USAGE =
  'Usage: /handhold review [session|week] | history [session|week|all] | export [--otlp] [--report <path>] | forget [session|last|<session id>] | quiet [off] | pane'

// Routes /handhold by its first word. Each word calls its own function with the engine's $ directly.
export async function route($: Engine, cfg: Config, args: string): Promise<{ text: string }> {
  const [word = '', ...rest] = args.trim().split(/\s+/)
  const tail = rest.join(' ')

  if (word === 'quiet') {
    const off = rest[0] === 'off'
    await setQuiet($, !off)
    return { text: off ? 'Handhold notes on.' : 'Handhold notes muted for this session.' }
  }
  if (word === 'review') return review($, cfg, tail)
  if (word === 'history') return historyCmd($, cfg, tail)
  if (word === 'forget') return forgetCmd($, cfg, tail)
  if (word === 'export') return exportCmd($, cfg, tail)
  if (word === 'pane') return openPane($)
  return { text: USAGE }
}

export function registerCommands(on: On, cfg: Config): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'handhold', description: 'Handhold: nudges, reviews and the progress pane' })
    return next(e)
  }).catch(fallThrough)

  on('command.run', { command: 'handhold' }, async ($, e) => route($, cfg, e.args))
}
