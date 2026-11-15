import { msToNano, newSpanId, newTraceId, SCHEMA_URL } from './otel'
import type { Span, SpanKind, SpanStatus } from './otel'

// The spans of one turn: one trace, opened and closed as the turn runs.
export class TurnSpans {
  readonly traceId: string
  readonly turnId: string
  readonly conversationId: string
  private readonly openSpans = new Map<string, Span>()
  private readonly doneSpans: Span[] = []

  constructor(turnId: string, conversationId: string, _nowMs: number) {
    this.traceId = newTraceId()
    this.turnId = turnId
    this.conversationId = conversationId
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

  finished(): Span[] {
    return [...this.doneSpans]
  }
}
