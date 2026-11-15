import { expect, test } from 'claude-code/testing'

import type { Assessment, Technique } from '../types'
import { aggregate, readTurns } from '../src/reflect/read'
import { progressReport, toOtlp } from '../src/reflect/export'
import { recordDay } from '../src/reflect/stats'
import type { ReadIo, TurnRecord } from '../src/reflect/read'
import { defaultConfig } from './helpers'

const assessment = (
  scores: [number, number, number],
  technique: Technique,
  warranted = true,
): Assessment => ({
  warranted,
  scores: { altitude: scores[0], depth: scores[1], range: scores[2] } as Assessment['scores'],
  evidence: { altitude: '', depth: '', range: '' },
  opportunity: 'altitude',
  technique,
  nudge: 'n',
  rewrite: 'the more ambitious version',
})

const turn = (id: string, a: Assessment): TurnRecord => ({
  sessionId: 's1',
  turnId: id,
  startMs: Number(id.replace(/\D/g, '')),
  prompt: `prompt ${id}`,
  assess: { post: a },
})

test('aggregate averages the warranted turns and counts missed techniques', () => {
  const agg = aggregate([
    turn('1', assessment([1, 0, 0], 'goal-beyond-the-goal')),
    turn('2', assessment([1, 1, 0], 'goal-beyond-the-goal')),
    turn('3', assessment([3, 2, 2], 'challenge-assumptions')),
    turn('4', assessment([0, 0, 0], 'goal-beyond-the-goal', false)),
  ])

  expect(agg.turns).toBe(4)
  expect(agg.warranted).toBe(3)
  expect(Math.abs(agg.avg.altitude - 5 / 3) < 0.001).toBe(true)
  expect(agg.avg.depth).toBe(1)
  expect(agg.missed[0]).toEqual({ technique: 'goal-beyond-the-goal', count: 2 })
})

test('readTurns skips a damaged line and keeps the rest of the file', async () => {
  const root = JSON.stringify({
    spanId: 'b'.repeat(16),
    name: 'invoke_agent claude',
    startTimeUnixNano: '1000000000000',
    attributes: { 'gen_ai.input.messages': [{ role: 'user', parts: [{ type: 'text', content: 'hi there' }] }] },
  })
  const io: ReadIo = {
    home: async () => '/home/t',
    list: async () => [{ name: '00001-t1.jsonl', kind: 'file', mtimeMs: 0 }],
    read: async () => `${root}\nnot json{\n`,
  }

  const turns = await readTurns(io, defaultConfig, { sessionId: 's1' })

  expect(turns.length).toBe(1)
  expect(turns[0].prompt).toBe('hi there')
  expect(turns[0].turnId).toBe('t1')
})

test('review with no traces says so', async ($, on) => {
  on('env.get', () => ({ value: '/home/t' }))
  on('session.id', () => ({ value: 's1' }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))

  const r = (await $.command.run({ command: 'handhold', args: 'review', origin: { kind: 'composer' } } as never)) as {
    text: string
  }

  expect(r.text).toBe('No turns recorded yet.')
})

test('review falls back to plain text when the model fails', async ($, on) => {
  const root = JSON.stringify({
    spanId: 'b'.repeat(16),
    name: 'invoke_agent claude',
    startTimeUnixNano: '1000000000000',
    attributes: { 'gen_ai.input.messages': [{ role: 'user', parts: [{ type: 'text', content: 'qbr' }] }] },
  })
  const assess = JSON.stringify({
    spanId: 'c'.repeat(16),
    name: 'handhold.assess',
    startTimeUnixNano: '1000000000000',
    attributes: {
      'handhold.judge.phase': 'post',
      'handhold.warranted': true,
      'handhold.score.altitude': 1,
      'handhold.score.depth': 0,
      'handhold.score.range': 0,
      'handhold.opportunity': 'altitude',
      'handhold.technique': 'goal-beyond-the-goal',
      'handhold.rewrite': 'the three decisions',
    },
  })
  const file = `${root}\n${assess}\n`

  on('env.get', () => ({ value: '/home/t' }))
  on('session.id', () => ({ value: 's1' }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.list', () => ({
    value: [{ name: '00001-t1.jsonl', kind: 'file', size: 0, mtimeMs: 0, isLink: false }],
  }))
  on('fs.read', () => ({ value: file }))
  on('model.complete', () => {
    throw new Error('timeout')
  })

  const r = (await $.command.run({ command: 'handhold', args: 'review', origin: { kind: 'composer' } } as never)) as {
    text: string
  }

  expect(r.text).toContain('Altitude')
})

const span = (over: Record<string, unknown>) =>
  ({
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    parentSpanId: null,
    name: 'chat claude-opus-5-5',
    kind: 'CLIENT',
    startTimeUnixNano: '1000000000',
    endTimeUnixNano: '2000000000',
    status: { code: 'OK' },
    schemaUrl: 'https://opentelemetry.io/schemas/1.37.0',
    attributes: { 'gen_ai.usage.input_tokens': 5 },
    ...over,
  }) as never

type OtlpSpan = { kind: number; parentSpanId?: string; attributes: { key: string; value: unknown }[] }

test('toOtlp writes strict OTLP JSON', () => {
  const otlp = toOtlp([
    span({}),
    span({ name: 'execute_tool Bash', kind: 'INTERNAL', parentSpanId: 'c'.repeat(16) }),
  ]) as { resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[] }
  const spans = otlp.resourceSpans[0].scopeSpans[0].spans

  expect(spans.length).toBe(2)
  expect(spans[0].kind).toBe(3)
  expect(spans[0].parentSpanId).toBeUndefined()
  expect(spans[1].parentSpanId).toBe('c'.repeat(16))
  expect(spans[0].attributes[0]).toEqual({ key: 'gen_ai.usage.input_tokens', value: { intValue: '5' } })
})

test('the progress report has the score table and no transcript', () => {
  const agg = aggregate([turn('1', assessment([1, 0, 0], 'goal-beyond-the-goal'))])
  const report = progressReport(agg, '2026-11-08 to 2026-11-15')

  expect(report).toContain('| Altitude |')
  expect(report).toContain('Range: 2026-11-08 to 2026-11-15')
})

test('/handhold export with no flags writes the OTLP file and the report', async ($, on) => {
  const writes: string[] = []
  const root = JSON.stringify({
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    parentSpanId: null,
    name: 'invoke_agent claude',
    kind: 'INTERNAL',
    startTimeUnixNano: '1000000000000',
    endTimeUnixNano: '1000000005000',
    status: { code: 'OK' },
    schemaUrl: 'https://opentelemetry.io/schemas/1.37.0',
    attributes: { 'gen_ai.input.messages': [{ role: 'user', parts: [{ type: 'text', content: 'qbr' }] }] },
  })
  on('env.get', () => ({ value: '/home/t' }))
  on('session.id', () => ({ value: 's1' }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.list', (_, e) => ({
    value: e.path.endsWith('/traces')
      ? [{ name: 's1', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
      : [{ name: '00001-t1.jsonl', kind: 'file', size: 0, mtimeMs: Date.now(), isLink: false }],
  }))
  on('fs.read', () => ({ value: `${root}\n` }))
  on('fs.write', (_, e) => {
    writes.push(e.path)
    return { value: undefined }
  })

  await $.command.run({ command: 'handhold', args: 'export', origin: { kind: 'composer' } } as never)

  expect(writes.length).toBe(2)
  expect(writes[0].startsWith('/home/t/.handhold/exports/otlp-')).toBe(true)
  expect(writes[1].startsWith('/home/t/.handhold/exports/report-')).toBe(true)
})

const PANE = {
  plugin: 'handhold',
  component: 'Pane',
  requestId: 'handhold',
  props: {
    title: 'Handhold',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const judgeJson = (altitude: number, technique: Technique = 'goal-beyond-the-goal') =>
  JSON.stringify({
    warranted: true,
    scores: { altitude, depth: 3, range: 3 },
    evidence: { altitude: 'a', depth: 'd', range: 'r' },
    opportunity: 'altitude',
    technique,
    nudge: 'n',
    rewrite: 'the more ambitious version',
  })

// The engine's bottom for a pane test: the model answers from `reply`, store is empty, nothing else needed.
const paneBottom = (on: Parameters<Parameters<typeof test>[1]>[1], reply: (prompt: string) => string) => {
  on('env.get', () => ({ value: '/home/t' }))
  on('session.id', () => ({ value: 's1' }))
  on('ui.log', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('model.complete', (_, e) => ({ value: { isAnswered: true, text: reply(e.prompt), usage: { input_tokens: 1, output_tokens: 1, model: e.model } } }))
}

test('the pane says so when no turn has been assessed', async ($, on) => {
  paneBottom(on, () => '{"warranted":false}')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /No assessed turns yet/ }))?.text).toBe('No assessed turns yet.')
    await ui.unmount()
  }
})

test('the pane averages the session post-answer scores', async ($, on) => {
  paneBottom(on, prompt => (prompt.includes('Request:\nAlpha') ? judgeJson(1) : judgeJson(3)))

  await $.prompt.submit({ text: 'Alpha: plan the whole quarterly review for the board' } as never)
  await $.turn.start({ text: 'Alpha: plan the whole quarterly review for the board', turnId: 't1' } as never)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false } as never)
  await $.prompt.submit({ text: 'Beta: design a better way to run the quarterly review' } as never)
  await $.turn.start({ text: 'Beta: design a better way to run the quarterly review', turnId: 't2' } as never)
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 1, isAborted: false } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const row = await ui.find({ type: 'Text', text: /Altitude/ })
    expect(row?.text.includes('2.0')).toBe(true)
    await ui.unmount()
  }
})

test('the pane shows the techniques being backed off', async ($, on) => {
  paneBottom(on, () => judgeJson(1))

  await $.prompt.submit({ text: 'Plan the whole quarterly review for the board' } as never)
  await $.prompt.submit({ text: 'Also list the three competitors we lost to last year, with reasons' } as never)
  await $.prompt.submit({ text: 'And then summarise the churn trend for the board deck' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Backing off/ }))?.text).toBe('Backing off: goal-beyond-the-goal')
  await ui.unmount()
})

test('recordDay ignores a turn that was not warranted', () => {
  const none = recordDay([], '2026-11-15', {
    warranted: false,
    scores: { altitude: 3, depth: 3, range: 3 },
    evidence: { altitude: '', depth: '', range: '' },
    opportunity: 'altitude',
    technique: 'goal-beyond-the-goal',
    nudge: '',
    rewrite: '',
  })
  expect(none.length).toBe(0)
})
