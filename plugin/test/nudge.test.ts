import { expect, test } from 'claude-code/testing'

import * as churn from './fixtures/churn'
import * as qbr from './fixtures/qbr'
import * as trivial from './fixtures/trivial'

type Writes = { path: string; text: string }[]

const composeInput = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as never

// The engine's bottom for the events these tests raise. The model answers from `reply`, keyed by the judge's prompt.
const beneath = (
  on: Parameters<Parameters<typeof test>[1]>[1],
  reply: (prompt: string) => string | Error,
  writes: Writes = [],
  sections: unknown[] = [],
) => {
  on('env.get', () => ({ value: '/home/t' }))
  on('session.id', () => ({ value: 's1' }))
  on('ui.log', () => ({ value: undefined }))
  on('prompt.compose', () => ({ sections }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', () => ({ sessionId: 's1' }))
  on('fs.write', (_, e) => {
    writes.push(e)
    return { value: undefined }
  })
  on('model.complete', (_, e) => {
    const out = reply(e.prompt)
    if (out instanceof Error) throw out
    return { value: { isAnswered: true, text: out, usage: { input_tokens: 1, output_tokens: 1, model: e.model } } }
  })
}

const modelReplyFor = (prompt: string): string => {
  if (prompt.includes(qbr.prompt)) return qbr.judgeReply
  if (prompt.includes(churn.prompt)) return churn.judgeReply
  return trivial.judgeReply
}

test('the ambition brief is added once to the system prompt', async ($, on) => {
  beneath(on, modelReplyFor)

  const result = await $.prompt.compose(composeInput)
  const briefs = result.sections.filter(s => s.id === 'handhold:ambition')

  expect(briefs.length).toBe(1)
  expect(briefs[0].scope).toBe('session')
})

test('the brief is not added twice when it is already present', async ($, on) => {
  beneath(on, modelReplyFor, [], [{ id: 'handhold:ambition', text: 'already here', scope: 'session' }])

  const result = await $.prompt.compose(composeInput)

  expect(result.sections.filter(s => s.id === 'handhold:ambition').length).toBe(1)
})

test('a trivial prompt makes no model call and adds no context', async ($, on) => {
  let calls = 0
  beneath(on, () => {
    calls++
    return trivial.judgeReply
  })

  const result = await $.prompt.submit({ text: trivial.prompt } as never)

  expect(calls).toBe(0)
  expect(result.context).toBeUndefined()
})

test('a low-altitude prompt gets one hint and its text is unchanged', async ($, on) => {
  beneath(on, modelReplyFor)

  const result = await $.prompt.submit({ text: qbr.prompt } as never)

  expect(result.text).toBe(qbr.prompt)
  expect(result.context?.length).toBe(1)
  expect(result.context?.[0]).toContain('goal-beyond-the-goal')
})

test('a judge timeout leaves the prompt untouched', async ($, on) => {
  beneath(on, () => new Error('timeout'))

  const result = await $.prompt.submit({ text: qbr.prompt } as never)

  expect(result.text).toBe(qbr.prompt)
  expect(result.context).toBeUndefined()
})

test('two declines suppress the technique for the session', async ($, on) => {
  beneath(on, modelReplyFor)

  await $.prompt.submit({ text: qbr.prompt } as never)
  await $.prompt.submit({ text: 'Also list the three competitors we lost to last year, with reasons' } as never)
  const third = await $.prompt.submit({ text: 'And then summarise the churn trend for the board deck' } as never)

  expect(third.context).toBeUndefined()
})

test('back-to-back prompts keep their own assessment on their own turn', async ($, on) => {
  const writes: Writes = []
  beneath(on, modelReplyFor, writes)

  await $.prompt.submit({ text: qbr.prompt } as never)
  await $.turn.start({ text: qbr.prompt, turnId: 't1' } as never)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false } as never)

  await $.prompt.submit({ text: churn.prompt } as never)
  await $.turn.start({ text: churn.prompt, turnId: 't2' } as never)
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 1, isAborted: false } as never)

  const techniqueOf = (text: string): unknown => {
    const assess = text
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as { name: string; attributes: Record<string, unknown> })
      .find(s => s.name === 'handhold.assess')
    return assess?.attributes['handhold.technique']
  }

  expect(writes.length).toBe(2)
  expect(techniqueOf(writes[0].text)).toBe('goal-beyond-the-goal')
  expect(techniqueOf(writes[1].text)).toBe('challenge-assumptions')
})
