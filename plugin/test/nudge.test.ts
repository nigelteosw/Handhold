import { expect, test } from 'claude-code/testing'

import type { KitOn } from './helpers'

import { USAGE } from '../src/shared/commands'

import { noteText } from '../src/nudge/note'
import { parseAssessment } from '../src/mentor/assessment'
import * as churn from './fixtures/churn'
import * as qbr from './fixtures/qbr'
import * as trivial from './fixtures/trivial'

type Writes = { path: string; text: string }[]

const composeInput = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as never

// The engine's bottom for the events these tests raise. The model answers from `reply`, keyed by the judge's prompt.
const beneath = (
  on: KitOn,
  reply: (prompt: string) => string | Error,
  writes: Writes = [],
  sections: unknown[] = [],
) => {
  on('env.get', () => ({ value: '/home/t' }))
  on('session.id', () => ({ value: 's1' }))
  on('ui.log', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('prompt.compose', () => ({ sections: sections as never }))
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
    return { value: { isAnswered: true, text: out, usage: { input_tokens: 1, output_tokens: 1 } } as never }
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

  // Each turn is written again when its post-answer span is added: the last write of a path is the whole turn.
  const last = (path: string): string => writes.filter(w => w.path === path).at(-1)?.text ?? ''
  expect(techniqueOf(last('/home/t/.handhold/traces/s1/00001-t1.jsonl'))).toBe('goal-beyond-the-goal')
  expect(techniqueOf(last('/home/t/.handhold/traces/s1/00002-t2.jsonl'))).toBe('challenge-assumptions')
})

const turn = async ($: Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0], i: number, prompt: string) => {
  await $.prompt.submit({ text: prompt } as never)
  await $.turn.start({ text: prompt, turnId: `t${i}` } as never)
  return $.turn.complete({ turnId: `t${i}`, answer: 'ok', durationMs: 1, isAborted: false } as never)
}

test('a coaching note shows at most once every three turns', async ($, on) => {
  beneath(on, modelReplyFor)
  const shown: number[] = []
  let text = ''

  for (let i = 1; i <= 6; i++) {
    const r = await turn($, i, qbr.prompt)
    if (r.text) {
      shown.push(i)
      text = r.text
    }
  }

  expect(shown).toEqual([1, 4])
  expect(text).toBe(noteText(parseAssessment(qbr.judgeReply) as never))
})

test('quiet mutes notes and quiet off restores them', async ($, on) => {
  beneath(on, modelReplyFor)
  const command = (args: string) =>
    $.command.run({ command: 'handhold', args, origin: { kind: 'composer' } } as never) as Promise<{ text: string }>

  const shown: number[] = []
  if ((await turn($, 1, qbr.prompt)).text) shown.push(1)
  expect((await command('quiet')).text).toBe('Handhold notes muted for this session.')
  for (let i = 2; i <= 4; i++) if ((await turn($, i, qbr.prompt)).text) shown.push(i)
  expect((await command('quiet off')).text).toBe('Handhold notes on.')
  if ((await turn($, 5, qbr.prompt)).text) shown.push(5)

  expect(shown).toEqual([1, 5])
})

test('the post-answer assessment is written as a span on the turn', async ($, on) => {
  const writes: Writes = []
  beneath(on, modelReplyFor, writes)

  await turn($, 1, qbr.prompt)

  const file = writes.filter(w => w.path.endsWith('00001-t1.jsonl')).at(-1)?.text ?? ''
  const assess = file
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as { name: string; attributes: Record<string, unknown> })
    .filter(s => s.name === 'handhold.assess')
  expect(assess.map(s => s.attributes['handhold.judge.phase'])).toEqual(['pre', 'post'])
})

test('a post-answer judge failure leaves the answer as it was', async ($, on) => {
  beneath(on, () => new Error('timeout'))

  const r = await turn($, 1, qbr.prompt)

  expect(r.text).toBe('')
})

test('an unknown /handhold word shows the usage line', async ($, on) => {
  beneath(on, modelReplyFor)

  const r = (await $.command.run({ command: 'handhold', args: 'nonsense', origin: { kind: 'composer' } } as never)) as { text: string }

  expect(r.text).toBe(USAGE)
})

test('a trivial turn makes no post-answer model call', async ($, on) => {
  let calls = 0
  beneath(on, () => {
    calls++
    return trivial.judgeReply
  })

  await turn($, 1, trivial.prompt)

  expect(calls).toBe(0)
})
