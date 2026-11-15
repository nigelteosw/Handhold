import type { Engine, On } from 'claude-code'

import type { Config } from './config'
import { review } from '../reflect/review'
import { setQuiet } from '../nudge/note'
import { fallThrough } from './safe'

export const USAGE =
  'Usage: /handhold review [session|week] | export [--otlp] [--report <path>] | quiet [off] | pane'

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
  if (word === 'export' || word === 'pane') return { text: 'Not available yet.' }
  return { text: USAGE }
}

export function registerCommands(on: On, cfg: Config): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'handhold', description: 'Handhold: nudges, reviews and the progress pane' })
    return next(e)
  }).catch(fallThrough)

  on('command.run', { command: 'handhold' }, async ($, e) => route($, cfg, e.args))
}
