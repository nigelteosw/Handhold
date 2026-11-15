import { expect, test } from 'claude-code/testing'

import { readConfig } from '../src/shared/config'
import { fallThrough } from '../src/shared/safe'
import { TOOL_ID } from '../src/shared/commands'

test('readConfig fills the manifest defaults', () => {
  expect(readConfig({})).toEqual({
    mode: 'review',
    reviewBatch: 15,
    fastModel: 'claude-haiku-5-5',
    turnModel: 'claude-haiku-5-5',
    reviewModel: 'claude-opus-5-5',
    preTimeoutMs: 2000,
    postTimeoutMs: 20000,
    redact: 'none',
    noteEvery: 3,
    traceRoot: '~/.handhold/traces',
  })
})

test('readConfig keeps live mode and turns anything else into review', () => {
  expect(readConfig({ mode: 'live' }).mode).toBe('live')
  expect(readConfig({ mode: 'bogus' }).mode).toBe('review')
})

test('readConfig turns an unknown redact mode into none', () => {
  expect(readConfig({ redact: 'bogus' }).redact).toBe('none')
})

test('fallThrough hands the event to next and returns its result', async () => {
  const next = (e: { x: number }) => ({ passed: e.x })

  const result = await fallThrough({} as never, { x: 1 }, next as never)

  expect(result).toEqual({ passed: 1 })
})

test('the handhold tool runs a /handhold subcommand, for skills on surfaces without runtime commands', async ($, on) => {
  on('env.get', () => ({ value: '/home/t' }))
  on('session.id', () => ({ value: 's1' }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => {
    throw new Error('missing')
  })
  const r = (await $.tool.call({ tool: TOOL_ID, command: 'forget nosuchsession' } as never)) as { result?: unknown; deny?: string }
  expect(String(r.result)).toContain('No session matches')
})
