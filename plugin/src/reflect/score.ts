import type { Assessment, Span } from '../../types'
import { assessAttrs } from '../mentor/assessment'
import { isTrivial } from '../mentor/gate'
import { msToNano, newSpanId, SCHEMA_URL } from '../capture/otel'
import type { Config } from '../shared/config'
import { samePrompt, toTurnRecord, traceRoot } from './read'
import type { ReadIo, TraceFile, TurnRecord } from './read'

export type ScoreIo = ReadIo & { write(path: string, text: string): Promise<void> }

export type JudgeBatch = (items: { id: string; prompt: string }[]) => Promise<Map<string, Assessment>>

export type Scored = { turn: TurnRecord; assessment: Assessment }

export type ScoreResult = { scored: Scored[]; left: number }

// A turn still needs a score when nothing has judged it and it is not a command or a trivial request.
export function needsScore(t: TurnRecord): boolean {
  if (t.assess.post || t.assess.pre) return false
  const p = t.prompt.trim()
  return p !== '' && !p.startsWith('/') && !isTrivial(p)
}

// The handhold.assess span a review adds to a finished turn, under the turn's root span.
export function reviewSpan(spans: Span[], a: Assessment, nowMs: number): Span | null {
  const root = spans.find(s => s.name === 'invoke_agent claude')
  if (!root) return null
  return {
    traceId: root.traceId,
    spanId: newSpanId(),
    parentSpanId: root.spanId,
    name: 'handhold.assess',
    kind: 'INTERNAL',
    startTimeUnixNano: msToNano(nowMs),
    endTimeUnixNano: msToNano(nowMs),
    status: { code: 'OK' },
    schemaUrl: SCHEMA_URL,
    attributes: assessAttrs(a, 'review'),
  }
}

// Scores the newest unscored turns, at most cfg.reviewBatch, in one judge call, and appends each score
// to its trace file so no turn is ever scored twice. The files' spans are updated in place.
export async function scoreUnscored(
  io: ScoreIo,
  cfg: Config,
  files: TraceFile[],
  judge: JudgeBatch,
  nowMs = Date.now(),
): Promise<ScoreResult> {
  const pending = files
    .map(file => ({ file, turn: toTurnRecord(file.sessionId, file.fileName, file.spans) }))
    .filter((x): x is { file: TraceFile; turn: TurnRecord } => x.turn !== null && needsScore(x.turn))
    .sort((a, b) => b.turn.startMs - a.turn.startMs)

  const batch = pending.slice(0, Math.max(1, Math.floor(cfg.reviewBatch)))
  if (batch.length === 0) return { scored: [], left: 0 }

  // A request asked more than once is judged once, and that score is saved on every copy.
  const unique = [...new Set(batch.map(x => samePrompt(x.turn.prompt)))]
  const idOf = new Map(unique.map((key, i) => [key, String(i + 1)]))
  const prompts = new Map(batch.map(x => [samePrompt(x.turn.prompt), x.turn.prompt]))
  const results = await judge(unique.map(key => ({ id: idOf.get(key)!, prompt: prompts.get(key)! })))
  const root = await traceRoot(io, cfg)
  const scored: Scored[] = []

  for (const x of batch) {
    const a = results.get(idOf.get(samePrompt(x.turn.prompt))!)
    if (!a) continue
    const span = reviewSpan(x.file.spans, a, nowMs)
    if (!span) continue
    const path = `${root}/${x.file.sessionId}/${x.file.fileName}`
    try {
      const text = await io.read(path)
      await io.write(path, `${text}${text.endsWith('\n') || text === '' ? '' : '\n'}${JSON.stringify(span)}\n`)
    } catch {
      continue
    }
    x.file.spans.push(span)
    scored.push({ turn: x.turn, assessment: a })
  }
  return { scored, left: pending.length - scored.length }
}
