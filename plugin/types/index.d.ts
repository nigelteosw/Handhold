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

// A turn's spans as stored in $.state: the open ones and the finished ones.
export type StoredTurn = {
  traceId: string
  turnId: string
  conversationId: string
  open: Span[]
  done: Span[]
}

export type CaptureState = {
  seq: number
  pendingPrompt: string
  main: StoredTurn | null
  mainTurnId: string | null
  turnRoots: Record<string, string>
  agentRoots: Record<string, string>
  agentSpawns: Record<string, { parentSpanId: string | null; subagentType: string }>
  toolCalls: Record<string, string>
  lastClosed: { turnId: string; seq: number; root: string; turn: StoredTurn } | null
}

declare module 'claude-code' {
  interface PluginState {
    handhold: {
      sinkWarned: Shaped<boolean>
      capture: Shaped<CaptureState>
    }
  }
}
