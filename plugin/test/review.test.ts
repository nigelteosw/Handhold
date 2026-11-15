import { expect, test } from 'claude-code/testing'

import type { Assessment, Span } from '../types'
import { parseBatch } from '../src/mentor/judge'
import { embedJson, historyDataJs, historyHtml, historyTurn, LIVE_FOR_MS, parseLive, scopeOf, wordOf } from '../src/reflect/history'
import type { TraceFile } from '../src/reflect/read'
import { scoringLine } from '../src/reflect/review'
import { scoreUnscored } from '../src/reflect/score'
import type { ScoreIo } from '../src/reflect/score'
import { defaultConfig } from './helpers'
import type { KitOn } from './helpers'
import * as churn from './fixtures/churn'
import * as qbr from './fixtures/qbr'

type Writes = { path: string; text: string }[]

const beneath = (on: KitOn, onModel: () => void, writes: Writes) => {
  on('env.get', () => ({ value: '/home/t' }))
  on('session.id', () => ({ value: 's1' }))
  on('ui.log', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('prompt.compose', () => ({ sections: [] as never }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('fs.write', (_, e) => {
    writes.push(e)
    return { value: undefined }
  })
  on('model.complete', () => {
    onModel()
    return { value: { isAnswered: true, text: qbr.judgeReply, usage: { input_tokens: 1, output_tokens: 1 } } as never }
  })
}

test('review mode records the turn and makes no model call while you work', async ($, on) => {
  let calls = 0
  const writes: Writes = []
  beneath(on, () => calls++, writes)

  await $.prompt.submit({ text: qbr.prompt } as never)
  await $.turn.start({ text: qbr.prompt, turnId: 't1' } as never)
  const r = await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false } as never)

  expect(calls).toBe(0)
  expect(r.text).toBe('')
  const file = writes.find(w => w.path.endsWith('00001-t1.jsonl'))?.text ?? ''
  expect(file).toContain('invoke_agent claude')
  expect(file).not.toContain('handhold.assess')
})

const root = (prompt: string, startMs: number, answer = 'done'): Span => ({
  traceId: 'a'.repeat(32),
  spanId: `${startMs}`.padStart(16, '0'),
  parentSpanId: null,
  name: 'invoke_agent claude',
  kind: 'INTERNAL',
  startTimeUnixNano: `${startMs}000000`,
  endTimeUnixNano: `${startMs + 1500}000000`,
  status: { code: 'OK' },
  schemaUrl: '',
  attributes: {
    'gen_ai.input.messages': [{ role: 'user', parts: [{ type: 'text', content: prompt }] }],
    'gen_ai.output.messages': [{ role: 'assistant', parts: [{ type: 'text', content: answer }] }],
  },
})

const fileOf = (n: number, prompt: string, extra: Span[] = []): TraceFile => ({
  sessionId: 's1',
  fileName: `${String(n).padStart(5, '0')}-t${n}.jsonl`,
  spans: [root(prompt, n * 1000), ...extra],
})

const memoryIo = (files: TraceFile[]): ScoreIo & { disk: Map<string, string> } => {
  const disk = new Map(files.map(f => [`/home/t/.handhold/traces/${f.sessionId}/${f.fileName}`, f.spans.map(s => JSON.stringify(s)).join('\n') + '\n']))
  return {
    disk,
    home: async () => '/home/t',
    list: async () => [],
    read: async path => disk.get(path) ?? '',
    write: async (path, text) => {
      disk.set(path, text)
    },
  }
}

const qbrAssessment = JSON.parse(qbr.judgeReply) as Assessment

test('scoreUnscored scores only real unscored turns, newest first, in one call, capped at reviewBatch', async () => {
  const already = { ...root('x', 0), name: 'handhold.assess', attributes: { 'handhold.warranted': true, 'handhold.judge.phase': 'post' } }
  const files = [
    fileOf(1, qbr.prompt),
    fileOf(2, churn.prompt),
    fileOf(3, 'thanks'),
    fileOf(4, '/handhold review'),
    fileOf(5, qbr.prompt + ' again', [already]),
    fileOf(6, churn.prompt + ' too'),
  ]
  const io = memoryIo(files)
  const calls: { id: string; prompt: string }[][] = []
  const judge = async (items: { id: string; prompt: string }[]) => {
    calls.push(items)
    return new Map(items.map(i => [i.id, qbrAssessment]))
  }

  const r = await scoreUnscored(io, { ...defaultConfig, reviewBatch: 2 }, files, judge)

  expect(calls.length).toBe(1)
  expect(calls[0].map(i => i.prompt)).toEqual([churn.prompt + ' too', churn.prompt])
  expect(r.scored.length).toBe(2)
  expect(r.left).toBe(1)
  const written = io.disk.get('/home/t/.handhold/traces/s1/00006-t6.jsonl') ?? ''
  const last = JSON.parse(written.trim().split('\n').at(-1) ?? '{}') as Span
  expect(last.name).toBe('handhold.assess')
  expect(last.attributes['handhold.judge.phase']).toBe('review')
  expect(last.parentSpanId).toBe(files[5].spans[0].spanId)

  // A second run picks up only what is left.
  calls.length = 0
  const again = await scoreUnscored(io, { ...defaultConfig, reviewBatch: 2 }, files, judge)
  expect(calls[0].map(i => i.prompt)).toEqual([qbr.prompt])
  expect(again.left).toBe(0)
})

test('scoreUnscored makes no call when everything is scored', async () => {
  let calls = 0
  const r = await scoreUnscored(memoryIo([]), defaultConfig, [fileOf(1, 'hi')], async () => {
    calls++
    return new Map()
  })
  expect(calls).toBe(0)
  expect(r).toEqual({ scored: [], left: 0 })
})

test('scoreUnscored judges a repeated prompt once and saves the score on every copy', async () => {
  const files = [fileOf(1, 'Update the numbers in our QBR template'), fileOf(2, 'update the numbers in  our QBR template')]
  const sent: string[][] = []
  const r = await scoreUnscored(memoryIo(files), defaultConfig, files, async items => {
    sent.push(items.map(i => i.id))
    return new Map(items.map(i => [i.id, qbrAssessment]))
  })
  expect(sent).toEqual([['1']])
  expect(r.scored.length).toBe(2)
  expect(r.left).toBe(0)
})

test('parseBatch keeps the elements that parse and skips the rest', () => {
  const reply = `Here you go:\n[${JSON.stringify({ id: 1, ...qbrAssessment })}, {"id": "2", "warranted": false}, {"id": "3", "scores": 7}]`
  const m = parseBatch(reply)
  expect([...m.keys()]).toEqual(['1', '2'])
  expect(m.get('1')?.technique).toBe('goal-beyond-the-goal')
  expect(m.get('2')?.warranted).toBe(false)
  expect(parseBatch('no json').size).toBe(0)
})

test('scoringLine says what was scored and what is left', () => {
  expect(scoringLine(0, 0)).toBe('')
  expect(scoringLine(3, 0)).toBe('Scored 3 new turns.')
  expect(scoringLine(1, 4)).toContain('4 older turns still unscored')
})

test('historyTurn summarises a turn without tool arguments or results', () => {
  const tool: Span = {
    ...root('', 1000),
    spanId: 'c'.repeat(16),
    name: 'execute_tool Bash',
    attributes: { 'gen_ai.tool.name': 'Bash', 'gen_ai.tool.call.arguments': { command: 'cat secret' }, 'gen_ai.tool.call.result': 'TOPSECRET' },
  }
  const chat: Span = { ...root('', 1000), spanId: 'd'.repeat(16), name: 'chat claude-opus-5-5', attributes: { 'gen_ai.usage.input_tokens': 120, 'gen_ai.usage.output_tokens': 30, 'gen_ai.response.model': 'claude-opus-5-5' } }
  const t = historyTurn(fileOf(1, qbr.prompt, [tool, chat]))

  expect(t?.prompt).toBe(qbr.prompt)
  expect(t?.answer).toBe('done')
  expect(t?.durationMs).toBe(1500)
  expect(t?.inputTokens).toBe(120)
  expect(t?.tools).toEqual([{ name: 'Bash', ms: 1500, ok: true }])
  expect(JSON.stringify(t)).not.toContain('TOPSECRET')
  expect(t?.assess).toBeNull()
})

test('the history page cannot be broken out of by a prompt', () => {
  const evil = '</script><script>alert(1)</script> '
  const t = historyTurn(fileOf(1, evil))
  const html = historyHtml(t ? [t] : [], 0, 'All time')

  expect(embedJson(evil)).not.toContain('<')
  expect(html.split('</script>').length).toBe(3)
  expect(html).not.toContain('alert(1)</script>')
})

test('the live data file hands the payload to the page and cannot close a script tag', () => {
  const t = historyTurn(fileOf(1, '</script><b>hi</b>'))
  const js = historyDataJs({ generatedMs: 5, scope: 'All time', turns: t ? [t] : [] })

  expect(js.startsWith('window.handholdHistory && window.handholdHistory({')).toBe(true)
  expect(js).not.toContain('<')
  const got: unknown = JSON.parse(js.slice(js.indexOf('(', js.indexOf('&&')) + 1, js.lastIndexOf(');')))
  expect((got as { turns: { prompt: string }[] }).turns[0]?.prompt).toBe('</script><b>hi</b>')
})

test('the history page polls its data file and allows loading it from disk', () => {
  const html = historyHtml([], 0, 'All time')
  expect(html).toContain("'history-data.js'")
  expect(html).toContain('file:')
})

test('a live history view keeps its scope and rolls its window forward', () => {
  expect(wordOf('')).toBe('month')
  expect(wordOf('week extra')).toBe('week')
  expect(wordOf('bogus')).toBe('month')
  expect(scopeOf({ word: 'week', openedMs: 0 }, 10 * 86400000)?.scope).toEqual({ sinceMs: 3 * 86400000 })
  expect(scopeOf({ word: 'session', sessionId: 's9', openedMs: 0 }, 1)?.scope).toEqual({ sessionId: 's9' })
  expect(scopeOf({ word: 'session', openedMs: 0 }, 1)).toBeNull()
  expect(parseLive('{"word":"all","openedMs":3}')).toEqual({ word: 'all', openedMs: 3 })
  expect(parseLive('{"word":"nope","openedMs":3}')).toBeNull()
  expect(parseLive('not json')).toBeNull()
})

const liveTurn = async ($: Parameters<Extract<Parameters<typeof test>[1], (...a: never[]) => unknown>>[0], on: KitOn, openedMs: number): Promise<Writes> => {
  const writes: Writes = []
  beneath(on, () => {}, writes)
  on('fs.read', (_, e) => {
    if (e.path.endsWith('history-live.json')) return { value: JSON.stringify({ word: 'all', openedMs }) }
    throw new Error('missing')
  })
  on('fs.list', () => ({ value: [] }))
  await $.prompt.submit({ text: qbr.prompt } as never)
  await $.turn.start({ text: qbr.prompt, turnId: 't1' } as never)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false } as never)
  return writes
}

test('an open history page gets its data file rewritten when a turn ends', async ($, on) => {
  const writes = await liveTurn($, on, Date.now())
  const data = writes.find(w => w.path === '/home/t/.handhold/history-data.js')
  expect(data?.text).toContain('"scope":"All time"')
})

test('a history page opened long ago is left alone', async ($, on) => {
  const writes = await liveTurn($, on, Date.now() - LIVE_FOR_MS - 1000)
  expect(writes.some(w => w.path.endsWith('history-data.js'))).toBe(false)
})
