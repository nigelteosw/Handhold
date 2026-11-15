import type { EngineInterface as Engine, On } from 'claude-code'

import type { Config } from './config'
import { exportCmd } from '../reflect/export'
import { forgetCmd } from '../reflect/forget'
import { historyCmd, refreshHistory } from '../reflect/history'
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
  if (word === 'review') {
    const r = await review($, cfg, tail)
    // Review writes scores into the traces; an open history page shows them without a reopen.
    await refreshHistory($, cfg)
    return r
  }
  if (word === 'history') return historyCmd($, cfg, tail)
  if (word === 'forget') {
    const r = await forgetCmd($, cfg, tail)
    // Forgotten turns leave an open history page too.
    await refreshHistory($, cfg)
    return r
  }
  if (word === 'export') return exportCmd($, cfg, tail)
  if (word === 'pane') return openPane($)
  return { text: USAGE }
}

// The tool the plugin's skills call. Surfaces whose slash menu lists only skills (the desktop app's chat)
// never show a command registered at runtime, so /review, /history and /forget reach the router through it.
export const TOOL_NAME = 'handhold'
export const TOOL_ID = `mcp__handhold__${TOOL_NAME}`

export function registerCommands(on: On, cfg: Config): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'handhold', description: 'Handhold: nudges, reviews and the progress pane' })
    await $.tool.register({
      name: TOOL_NAME,
      description: 'Runs a Handhold command and returns its output. Only call it when a Handhold skill says to.',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string', description: 'The /handhold arguments, e.g. "review week"' } },
        required: ['command'],
      },
      // In the prompt's tool list, so a skill's call needs no ToolSearch: one short line of context.
      isDeferred: false,
    })
    return next(e)
  }).catch(fallThrough)

  on('command.run', { command: 'handhold' }, async ($, e) => route($, cfg, e.args))

  on('tool.call', { tool: TOOL_ID }, async ($, e) => {
    const command = typeof e['command'] === 'string' ? e['command'] : ''
    const { text } = await route($, cfg, command)
    return { result: text }
  }).catch(() => ({ result: 'Handhold could not run that command. Try it again from Claude Code in the terminal.' }))
}
