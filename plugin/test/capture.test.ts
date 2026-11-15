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
