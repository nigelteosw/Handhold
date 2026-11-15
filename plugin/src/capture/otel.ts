// OpenTelemetry GenAI conventions: span shape, ids, and the gen_ai.* attribute builders.

export const SCHEMA_URL = 'https://opentelemetry.io/schemas/1.37.0'

export type SpanKind = 'INTERNAL' | 'CLIENT'

export type SpanStatus = { code: 'UNSET' | 'OK' | 'ERROR'; message?: string }

export type Span = {
  traceId: string
  spanId: string
  parentSpanId: string | null
  name: string
  kind: SpanKind
  startTimeUnixNano: string
  endTimeUnixNano: string | null
  status: SpanStatus
  schemaUrl: string
  attributes: Record<string, unknown>
}

export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; id: string; name: string; arguments: unknown }
  | { type: 'tool_call_response'; id: string; response: unknown }

export type Message = { role: 'user' | 'assistant' | 'tool'; parts: MessagePart[] }

const randomHex = (bytes: number): string => {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, b => b.toString(16).padStart(2, '0')).join('')
}

export const newTraceId = (): string => randomHex(16)

export const newSpanId = (): string => randomHex(8)

export const msToNano = (ms: number): string =>
  (BigInt(Math.round(ms)) * BigInt(1000000)).toString()

export const agentAttrs = (
  conversationId: string,
  agent?: { id: string; name: string },
): Record<string, unknown> => ({
  'gen_ai.operation.name': 'invoke_agent',
  'gen_ai.provider.name': 'anthropic',
  'gen_ai.conversation.id': conversationId,
  ...(agent ? { 'gen_ai.agent.id': agent.id, 'gen_ai.agent.name': agent.name } : {}),
})

export const chatAttrs = (model: string): Record<string, unknown> => ({
  'gen_ai.operation.name': 'chat',
  'gen_ai.provider.name': 'anthropic',
  'gen_ai.request.model': model,
})

export const usageAttrs = (
  usage: { input_tokens: number; output_tokens: number; model: string } | null,
): Record<string, unknown> =>
  usage === null
    ? {}
    : {
        'gen_ai.usage.input_tokens': usage.input_tokens,
        'gen_ai.usage.output_tokens': usage.output_tokens,
        'gen_ai.response.model': usage.model,
      }

export const toolAttrs = (name: string, callId: string, args: unknown): Record<string, unknown> => ({
  'gen_ai.operation.name': 'execute_tool',
  'gen_ai.tool.name': name,
  'gen_ai.tool.call.id': callId,
  'gen_ai.tool.call.arguments': args,
})

export const toolResultAttrs = (result: unknown): Record<string, unknown> => ({
  'gen_ai.tool.call.result': result,
})
