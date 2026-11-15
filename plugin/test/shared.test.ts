import { expect, test } from 'claude-code/testing'

import { readConfig } from '../src/shared/config'
import { safe } from '../src/shared/safe'

test('readConfig fills the manifest defaults', () => {
  expect(readConfig({})).toEqual({
    fastModel: 'claude-haiku-5-5',
    fullModel: 'claude-opus-5-5',
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

test('a safe hook that throws before next falls through to next', async () => {
  const hook = safe(() => {
    throw new Error('boom')
  })
  const next = (e: { x: number }) => ({ passed: e.x })

  const result = await hook({} as never, { x: 1 } as never, next as never)

  expect(result).toEqual({ passed: 1 })
})

test('a safe hook that throws after next does not run next twice', async () => {
  let runs = 0
  const hook = safe(async (_$: unknown, e: { x: number }, n: (e: unknown) => unknown) => {
    await n(e)
    throw new Error('after')
  })
  const next = () => {
    runs++
    return { ok: true }
  }

  await hook({} as never, { x: 1 } as never, next as never)

  expect(runs).toBe(1)
})
