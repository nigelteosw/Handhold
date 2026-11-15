import type { Engine, On } from 'claude-code'

import { setQuiet } from '../nudge/note'
import { fallThrough } from './safe'

export const USAGE =
  'Usage: /handhold review [session|week] | export [--otlp] [--report <path>] | quiet [off] | pane'

export type Handlers = {
  review: (args: string) => Promise<{ text: string }>
  export: (args: string) => Promise<{ text: string }>
  pane: (args: string) => Promise<{ text: string }>
}

// Routes /handhold by its first word. quiet is handled here; the others are handed to their handlers.
export async function route($: Engine, args: string, handlers: Handlers): Promise<{ text: string }> {
  const [word = '', ...rest] = args.trim().split(/\s+/)
  const tail = rest.join(' ')

  if (word === 'quiet') {
    const off = rest[0] === 'off'
    await setQuiet($, !off)
    return { text: off ? 'Handhold notes on.' : 'Handhold notes muted for this session.' }
  }
  if (word === 'review') return handlers.review(tail)
  if (word === 'export') return handlers.export(tail)
  if (word === 'pane') return handlers.pane(tail)
  return { text: USAGE }
}

export function registerCommands(on: On, handlers: Handlers): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'handhold', description: 'Handhold: nudges, reviews and the progress pane' })
    return next(e)
  }).catch(fallThrough)

  on('command.run', { command: 'handhold' }, async ($, e) => route($, e.args, handlers))
}
