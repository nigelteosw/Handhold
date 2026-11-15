import { expect, test } from 'claude-code/testing'

import { readConfig } from '../src/shared/config'
import { fallThrough } from '../src/shared/safe'

test('readConfig fills the manifest defaults', () => {
  expect(readConfig({})).toEqual({
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

test('readConfig turns an unknown redact mode into none', () => {
  expect(readConfig({ redact: 'bogus' }).redact).toBe('none')
})

test('fallThrough hands the event to next and returns its result', async () => {
  const next = (e: { x: number }) => ({ passed: e.x })

  const result = await fallThrough({} as never, { x: 1 }, next as never)

  expect(result).toEqual({ passed: 1 })
})
