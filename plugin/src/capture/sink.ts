import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { Config } from '../shared/config'
import type { Span } from './otel'

const REDACTED = '[redacted]'
const MAX_VALUE_CHARS = 65536
const TRUNCATED = '…[truncated]'

const sinkWarned = atom({ plugin: 'handhold', key: 'sinkWarned' } as const, false, {
  shape: 'sink-1',
})

const redactValue = (value: unknown): unknown =>
  value === undefined ? value : REDACTED

// Redacts tool results in attributes and in message parts; arguments too for all-tool-io.
const redactMessages = (value: unknown, mode: 'tool-results' | 'all-tool-io'): unknown => {
  if (Array.isArray(value)) return value.map(v => redactMessages(v, mode))
  if (value && typeof value === 'object') {
    const part = value as Record<string, unknown>
    if (part.type === 'tool_call_response') return { ...part, response: REDACTED }
    if (part.type === 'tool_call' && mode === 'all-tool-io') return { ...part, arguments: REDACTED }
    return Object.fromEntries(Object.entries(part).map(([k, v]) => [k, redactMessages(v, mode)]))
  }
  return value
}

export function redact(spans: Span[], mode: Config['redact']): Span[] {
  if (mode === 'none') return spans
  return spans.map(span => {
    const attributes = { ...span.attributes }
    if ('gen_ai.tool.call.result' in attributes) {
      attributes['gen_ai.tool.call.result'] = redactValue(attributes['gen_ai.tool.call.result'])
    }
    if (mode === 'all-tool-io' && 'gen_ai.tool.call.arguments' in attributes) {
      attributes['gen_ai.tool.call.arguments'] = redactValue(attributes['gen_ai.tool.call.arguments'])
    }
    for (const key of ['gen_ai.input.messages', 'gen_ai.output.messages']) {
      if (key in attributes) attributes[key] = redactMessages(attributes[key], mode)
    }
    return { ...span, attributes }
  })
}

// Keeps structure; caps every string inside an attribute value at maxChars.
const capAny = (value: unknown, maxChars: number): unknown => {
  if (typeof value === 'string') {
    return value.length > maxChars ? value.slice(0, maxChars) + TRUNCATED : value
  }
  if (Array.isArray(value)) return value.map(v => capAny(v, maxChars))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, capAny(v, maxChars)]))
  }
  return value
}

export function capValues(spans: Span[], maxChars = MAX_VALUE_CHARS): Span[] {
  return spans.map(span => ({
    ...span,
    attributes: Object.fromEntries(
      Object.entries(span.attributes).map(([k, v]) => [k, capAny(v, maxChars)]),
    ),
  }))
}

export const toJsonl = (spans: Span[]): string =>
  spans.map(span => JSON.stringify(span)).join('\n') + '\n'

export const turnPath = (root: string, sessionId: string, seq: number, turnId: string): string =>
  `${root}/${sessionId}/${String(seq).padStart(5, '0')}-${turnId}.jsonl`

// The engine calls the sink needs, as an interface so the write logic can be tested
// without a session. The test kit's $ does not expose env or fs, so tests pass a fake.
export type SinkIo = {
  home(): Promise<string | undefined>
  write(path: string, text: string): Promise<void>
  isWarned(): Promise<boolean>
  markWarned(): Promise<void>
  status(text: string): void
}

// The production adapter: the engine's own $, with the warned flag kept as session state.
export function sinkIo($: Engine): SinkIo {
  return {
    home: () => $.env.get('HOME'),
    write: (path, text) => $.fs.write(path, text),
    isWarned: () => read($, sinkWarned),
    markWarned: async () => {
      await update($, sinkWarned, () => true)
    },
    status: text => $.ui.status(text),
  }
}

// Writes one finished turn as a whole file. Returns false (and warns once per session) when the write fails.
export async function writeTurn(
  io: SinkIo,
  cfg: Config,
  sessionId: string,
  seq: number,
  turnId: string,
  spans: Span[],
): Promise<boolean> {
  const home = (await io.home()) ?? ''
  const root = cfg.traceRoot.replace(/^~(?=\/|$)/, home)
  const body = toJsonl(capValues(redact(spans, cfg.redact)))

  try {
    await io.write(turnPath(root, sessionId, seq, turnId), body)
    return true
  } catch {
    if (!(await io.isWarned())) {
      io.status('Handhold: trace write failed')
      await io.markWarned()
    }
    return false
  }
}
