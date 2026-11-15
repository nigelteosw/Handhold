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

export type Dimension = 'altitude' | 'depth' | 'range'

export type Technique =
  | 'goal-beyond-the-goal'
  | 'durable-workflow'
  | 'insist-on-instruments'
  | 'unreasonable-goal'
  | 'challenge-assumptions'
  | 'produce-new-knowledge'
  | 'outside-judge'
  | 'nouns-to-verbs'
  | 'assemble-the-crew'

export type Score = 0 | 1 | 2 | 3

export type Assessment = {
  warranted: boolean
  scores: Record<Dimension, Score>
  evidence: Record<Dimension, string>
  opportunity: Dimension
  technique: Technique
  nudge: string
  rewrite: string
}

export type Backoff = {
  offered: Technique | null
  declines: Partial<Record<Technique, number>>
}

export type PendingAssess = { prompt: string; assessment: Assessment | null } | null

declare module 'claude-code' {
  interface PluginState {
    handhold: {
      sinkWarned: Shaped<boolean>
      capture: Shaped<CaptureState>
      backoff: Shaped<Backoff>
      recent: Shaped<Assessment[]>
      pendingAssess: Shaped<PendingAssess>
      quiet: Shaped<boolean>
      turnsSinceNote: Shaped<number>
    }
  }
}
