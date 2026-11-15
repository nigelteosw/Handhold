import type { Span, SpanStatus, StoredTurn, SpanKind } from '../../types'
import { msToNano, newSpanId, newTraceId, SCHEMA_URL } from './otel'

// The spans of one turn: one trace, opened and closed as the turn runs.
// Serialises to StoredTurn so the open turn can live in $.state across hook calls.
export class TurnSpans {
  readonly traceId: string
  readonly turnId: string
  readonly conversationId: string
  private readonly openSpans: Map<string, Span>
  private readonly doneSpans: Span[]

  constructor(turnId: string, conversationId: string, _nowMs: number, traceId?: string, open: Span[] = [], done: Span[] = []) {
    this.traceId = traceId ?? newTraceId()
    this.turnId = turnId
    this.conversationId = conversationId
    this.openSpans = new Map(open.map(s => [s.spanId, s]))
    this.doneSpans = [...done]
  }

  static from(stored: StoredTurn): TurnSpans {
    return new TurnSpans(stored.turnId, stored.conversationId, 0, stored.traceId, stored.open, stored.done)
  }

  toJSON(): StoredTurn {
    return {
      traceId: this.traceId,
      turnId: this.turnId,
      conversationId: this.conversationId,
      open: [...this.openSpans.values()],
      done: [...this.doneSpans],
    }
  }

  open(
    name: string,
    kind: SpanKind,
    parentSpanId: string | null,
    attributes: Record<string, unknown>,
    nowMs: number,
  ): string {
    const spanId = newSpanId()
    this.openSpans.set(spanId, {
      traceId: this.traceId,
      spanId,
      parentSpanId,
      name,
      kind,
      startTimeUnixNano: msToNano(nowMs),
      endTimeUnixNano: null,
      status: { code: 'UNSET' },
      schemaUrl: SCHEMA_URL,
      attributes: { ...attributes },
    })
    return spanId
  }

  set(spanId: string, attributes: Record<string, unknown>): void {
    const span = this.openSpans.get(spanId)
    if (span) Object.assign(span.attributes, attributes)
  }

  close(spanId: string, nowMs: number, status: SpanStatus = { code: 'OK' }): void {
    const span = this.openSpans.get(spanId)
    if (!span) return
    this.openSpans.delete(spanId)
    this.doneSpans.push({ ...span, endTimeUnixNano: msToNano(nowMs), status })
  }

  closeAll(nowMs: number, status: SpanStatus): void {
    for (const spanId of [...this.openSpans.keys()]) this.close(spanId, nowMs, status)
  }

  isOpen(spanId: string): boolean {
    return this.openSpans.has(spanId)
  }

  finished(): Span[] {
    return [...this.doneSpans]
  }
}
