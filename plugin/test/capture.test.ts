import { expect, test } from 'claude-code/testing'

import {
  agentAttrs,
  chatAttrs,
  msToNano,
  newSpanId,
  newTraceId,
  SCHEMA_URL,
  toolAttrs,
  usageAttrs,
} from '../src/capture/otel'
import { TurnSpans } from '../src/capture/spans'
import { capValues, redact, toJsonl, turnPath, writeTurn } from '../src/capture/sink'
import type { SinkIo } from '../src/capture/sink'
import type { Span } from '../src/capture/otel'
import { readConfig } from '../src/shared/config'

test('ids have the OTel widths', () => {
  expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/)
  expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/)
})

test('msToNano converts milliseconds to a nanosecond string', () => {
  expect(msToNano(1)).toBe('1000000')
})

test('a turn is one trace whose spans nest by parent id', () => {
  const turn = new TurnSpans('t1', 'conv-1', 1000)
  const root = turn.open('invoke_agent claude', 'INTERNAL', null, agentAttrs('conv-1'), 1000)
  const chat = turn.open('chat claude-opus-5-5', 'CLIENT', root, chatAttrs('claude-opus-5-5'), 1100)
  const tool = turn.open('execute_tool Bash', 'INTERNAL', chat, toolAttrs('Bash', 'tu1', { command: 'ls' }), 1200)
  turn.close(tool, 1300)
  turn.close(chat, 1400)
  turn.close(root, 1500)

  const spans = turn.finished()
  expect(spans.length).toBe(3)
  expect(new Set(spans.map(s => s.traceId)).size).toBe(1)
  expect(spans.find(s => s.name === 'execute_tool Bash')?.parentSpanId).toBe(chat)
  expect(spans.find(s => s.name === 'chat claude-opus-5-5')?.parentSpanId).toBe(root)
  expect(spans.every(s => s.schemaUrl === SCHEMA_URL)).toBe(true)
})

test('closeAll closes only the spans still open, with the given status', () => {
  const turn = new TurnSpans('t1', 'conv-1', 1000)
  const root = turn.open('invoke_agent claude', 'INTERNAL', null, agentAttrs('conv-1'), 1000)
  const done = turn.open('chat claude-opus-5-5', 'CLIENT', root, chatAttrs('claude-opus-5-5'), 1100)
  turn.close(done, 1200)
  turn.open('execute_tool Bash', 'INTERNAL', root, toolAttrs('Bash', 'tu1', {}), 1300)

  turn.closeAll(1400, { code: 'ERROR', message: 'aborted' })

  const spans = turn.finished()
  expect(spans.find(s => s.name === 'chat claude-opus-5-5')?.status.code).toBe('OK')
  expect(spans.find(s => s.name === 'execute_tool Bash')?.status).toEqual({ code: 'ERROR', message: 'aborted' })
})

test('usage becomes the gen_ai.usage attributes', () => {
  expect(usageAttrs({ input_tokens: 10, output_tokens: 2, model: 'm' })).toEqual({
    'gen_ai.usage.input_tokens': 10,
    'gen_ai.usage.output_tokens': 2,
    'gen_ai.response.model': 'm',
  })
})

test('a tool span carries its operation name and call id', () => {
  const attrs = toolAttrs('Bash', 'tu1', { command: 'ls' })
  expect(attrs['gen_ai.operation.name']).toBe('execute_tool')
  expect(attrs['gen_ai.tool.call.id']).toBe('tu1')
})

const toolSpan = (): Span => ({
  traceId: 't',
  spanId: 's',
  parentSpanId: null,
  name: 'execute_tool Bash',
  kind: 'INTERNAL',
  startTimeUnixNano: '0',
  endTimeUnixNano: '0',
  status: { code: 'OK' },
  schemaUrl: SCHEMA_URL,
  attributes: {
    'gen_ai.operation.name': 'execute_tool',
    'gen_ai.tool.call.arguments': { command: 'cat .env' },
    'gen_ai.tool.call.result': 'SECRET=1',
  },
})

test('redact tool-results replaces the result and keeps the arguments', () => {
  const [s] = redact([toolSpan()], 'tool-results')
  expect(s.attributes['gen_ai.tool.call.result']).toBe('[redacted]')
  expect(s.attributes['gen_ai.tool.call.arguments']).toEqual({ command: 'cat .env' })
})

test('redact all-tool-io replaces the arguments too', () => {
  const [s] = redact([toolSpan()], 'all-tool-io')
  expect(s.attributes['gen_ai.tool.call.result']).toBe('[redacted]')
  expect(s.attributes['gen_ai.tool.call.arguments']).toBe('[redacted]')
})

test('redact none leaves the tool io as it was', () => {
  const [s] = redact([toolSpan()], 'none')
  expect(s.attributes['gen_ai.tool.call.result']).toBe('SECRET=1')
})

test('capValues cuts a long value and marks it', () => {
  const [s] = capValues(
    [{ ...toolSpan(), attributes: { 'gen_ai.tool.call.result': 'x'.repeat(200000) } }],
    65536,
  )
  expect(String(s.attributes['gen_ai.tool.call.result']).length).toBe(65536 + '…[truncated]'.length)
})

test('toJsonl writes one parsable line per span', () => {
  const lines = toJsonl([toolSpan(), toolSpan()]).trimEnd().split('\n')
  expect(lines.length).toBe(2)
  expect(JSON.parse(lines[0]).name).toBe('execute_tool Bash')
})

test('turnPath zero-pads the sequence number', () => {
  expect(turnPath('/r', 's', 7, 't')).toBe('/r/s/00007-t.jsonl')
})

const fakeIo = (overrides: Partial<SinkIo> = {}): SinkIo & { writes: string[]; statuses: string[] } => {
  let warned = false
  const io = {
    writes: [] as string[],
    statuses: [] as string[],
    home: async () => '/home/t',
    write: async (path: string) => {
      io.writes.push(path)
    },
    isWarned: async () => warned,
    markWarned: async () => {
      warned = true
    },
    status: (text: string) => {
      io.statuses.push(text)
    },
    ...overrides,
  }
  return io
}

test('writeTurn writes under the expanded trace root', async () => {
  const io = fakeIo()

  const ok = await writeTurn(io, readConfig({}), 's1', 1, 't1', [toolSpan()])

  expect(ok).toBe(true)
  expect(io.writes).toEqual(['/home/t/.handhold/traces/s1/00001-t1.jsonl'])
})

test('a failed trace write warns once per session and returns false', async () => {
  const io = fakeIo({
    write: async () => {
      throw new Error('EACCES')
    },
  })

  const first = await writeTurn(io, readConfig({}), 's1', 1, 't1', [toolSpan()])
  const second = await writeTurn(io, readConfig({}), 's1', 2, 't2', [toolSpan()])

  expect(first).toBe(false)
  expect(second).toBe(false)
  expect(io.statuses).toEqual(['Handhold: trace write failed'])
})
