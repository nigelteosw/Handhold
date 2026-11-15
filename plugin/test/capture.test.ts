import { expect, test } from 'claude-code/testing'

import type { KitOn } from './helpers'

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

const lines = (text: string): Span[] =>
  text.trim().split('\n').map(line => JSON.parse(line) as Span)

// The engine's bottom: what runs beneath the plugin for each event the tests raise.
const bottom = (
  on: KitOn,
  answer: string,
  tool: (e: { tool: string }) => unknown = () => ({ result: { text: 'ok' } }),
) => {
  on('env.get', () => ({ value: '/home/t' }))
  on('session.id', () => ({ value: 's1' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', (_, e) => tool(e) as never)
  on('turn.complete', () => ({ text: answer }))
  on('session.end', () => ({ sessionId: 's1' }))
}

test('capture writes one OTel tree per turn', async ($, on) => {
  const writes: { path: string; text: string }[] = []
  bottom(on, 'hello')
  on('fs.write', (_, e) => {
    writes.push(e)
    return { value: undefined }
  })
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'hello', ref: 1 } as never
    return {
      turnId: 't1',
      index: 0,
      answer: 'hello',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 1, model: 'claude-opus-5-5' },
    } as never
  })

  await $.prompt.submit({ text: 'hi' } as never)
  await $.turn.start({ text: 'hi', turnId: 't1' } as never)
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)
  for await (const _chunk of stream) void _chunk
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await $.turn.complete({ turnId: 't1', answer: 'hello', durationMs: 10, isAborted: false } as never)

  expect(writes.length).toBe(1)
  expect(writes[0].path).toBe('/home/t/.handhold/traces/s1/00001-t1.jsonl')
  const spans = lines(writes[0].text)
  const root = spans.find(s => s.name === 'invoke_agent claude')
  expect(JSON.stringify(root?.attributes['gen_ai.input.messages'])).toContain('"hi"')
  expect(JSON.stringify(root?.attributes['gen_ai.output.messages'])).toContain('"hello"')
  expect(root?.status).toEqual({ code: 'OK' })
  expect(spans.find(s => s.name === 'chat claude-opus-5-5')?.attributes['gen_ai.usage.input_tokens']).toBe(5)
  expect(spans.find(s => s.name === 'execute_tool Bash')?.parentSpanId).toBe(root?.spanId ?? null)
})

test('a slash command is not captured as the prompt', async ($, on) => {
  const writes: { path: string; text: string }[] = []
  bottom(on, '')
  on('fs.write', (_, e) => {
    writes.push(e)
    return { value: undefined }
  })

  await $.prompt.submit({ text: '/handhold review', command: { name: 'handhold' } } as never)
  await $.turn.start({ text: '/handhold review', turnId: 't1' } as never)
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false } as never)

  const root = lines(writes[0].text).find(s => s.name === 'invoke_agent claude')
  expect(root?.attributes['gen_ai.input.messages']).toEqual([{ role: 'user', parts: [{ type: 'text', content: '' }] }] as never)
})

test('an aborted turn closes its open tool span with ERROR and the next turn starts clean', async ($, on) => {
  const writes: { path: string; text: string }[] = []
  bottom(on, '', () => new Promise(() => {}))
  on('fs.write', (_, e) => {
    writes.push(e)
    return { value: undefined }
  })

  await $.prompt.submit({ text: 'run it' } as never)
  await $.turn.start({ text: 'run it', turnId: 't1' } as never)
  void $.tool.call({ tool: 'Bash', command: 'sleep 9' } as never)
  await new Promise<void>(r => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(r, 10))
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 5, isAborted: true } as never)

  const spans = lines(writes[0].text)
  expect(spans.find(s => s.name === 'execute_tool Bash')?.status.code).toBe('ERROR')
  expect(writes[0].path.endsWith('00001-t1.jsonl')).toBe(true)

  await $.turn.start({ text: 'next', turnId: 't2' } as never)
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 1, isAborted: false } as never)
  expect(writes.length).toBe(2)
  expect(writes[1].path.endsWith('00002-t2.jsonl')).toBe(true)
  const next = lines(writes[1].text)
  expect(next.map(s => s.name)).toEqual(['invoke_agent claude'])
})

test('session end flushes a turn that never completed', async ($, on) => {
  const writes: { path: string; text: string }[] = []
  bottom(on, '')
  on('fs.write', (_, e) => {
    writes.push(e)
    return { value: undefined }
  })

  await $.turn.start({ text: 'half', turnId: 't1' } as never)
  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)

  const root = lines(writes[0].text).find(s => s.name === 'invoke_agent claude')
  expect(root?.status.message).toBe('session ended')
})

test('a subagent nests under the Agent call that spawned it', async ($, on) => {
  const writes: { path: string; text: string }[] = []
  bottom(on, '', async e => {
    if (e.tool === 'Agent') {
      await $.agent.spawn({ tool_use_id: 'tu9', prompt: 'p', description: 'd', subagentType: 'general-purpose' } as never)
    }
    return { result: { text: 'done' } }
  })
  on('fs.write', (_, e) => {
    writes.push(e)
    return { value: undefined }
  })
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'a1' }) as never)

  await $.turn.start({ text: 'delegate', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Agent', tool_use_id: 'tu9', prompt: 'p' } as never)
  await $.turn.start({ text: 'p', turnId: 't2', agentId: 'a1' } as never)
  await $.turn.complete({ turnId: 't2', agentId: 'a1', answer: 'done', durationMs: 1, isAborted: false } as never)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 2, isAborted: false } as never)

  const spans = lines(writes[writes.length - 1].text)
  const agentTool = spans.find(s => s.name === 'execute_tool Agent')
  const sub = spans.find(s => s.name === 'invoke_agent general-purpose')
  expect(sub?.parentSpanId).toBe(agentTool?.spanId ?? null)
  expect(sub?.attributes['gen_ai.agent.id']).toBe('a1')
})
