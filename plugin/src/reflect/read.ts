import type { EngineInterface as Engine } from 'claude-code'

import type { Assessment, Dimension, Span, Technique } from '../../types'
import { needsNudge } from '../mentor/assessment'
import type { Config } from '../shared/config'

export type TurnRecord = {
  sessionId: string
  turnId: string
  startMs: number
  prompt: string
  assess: { pre?: Assessment; post?: Assessment }
}

export type Aggregate = {
  turns: number
  warranted: number
  avg: Record<Dimension, number>
  missed: { technique: Technique; count: number }[]
  best: TurnRecord[]
  worst: TurnRecord[]
}

// What readTurns needs from the engine, so the parser can be tested without a session.
export type ReadIo = {
  home(): Promise<string | undefined>
  list(path: string): Promise<{ name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number }[]>
  read(path: string): Promise<string>
}

export function readIo($: Engine): ReadIo {
  return {
    home: () => $.env.get('HOME'),
    list: path => $.fs.list(path),
    read: path => $.fs.read(path),
  }
}

const scoreSum = (a: Assessment): number => a.scores.altitude + a.scores.depth + a.scores.range

function assessFrom(attrs: Record<string, unknown>): Assessment | undefined {
  if (typeof attrs['handhold.warranted'] !== 'boolean') return undefined
  return {
    warranted: attrs['handhold.warranted'],
    scores: {
      altitude: attrs['handhold.score.altitude'] as Assessment['scores']['altitude'],
      depth: attrs['handhold.score.depth'] as Assessment['scores']['depth'],
      range: attrs['handhold.score.range'] as Assessment['scores']['range'],
    },
    evidence: {
      altitude: String(attrs['handhold.evidence.altitude'] ?? ''),
      depth: String(attrs['handhold.evidence.depth'] ?? ''),
      range: String(attrs['handhold.evidence.range'] ?? ''),
    },
    opportunity: attrs['handhold.opportunity'] as Dimension,
    technique: attrs['handhold.technique'] as Technique,
    nudge: String(attrs['handhold.nudge'] ?? ''),
    rewrite: String(attrs['handhold.rewrite'] ?? ''),
  }
}

// One turn file becomes one record. The turn id is the file name after its sequence number.
export function toTurnRecord(sessionId: string, fileName: string, spans: Span[]): TurnRecord | null {
  const root = spans.find(s => s.name === 'invoke_agent claude')
  if (!root) return null
  const turnId = fileName.replace(/\.jsonl$/, '').replace(/^\d+-/, '')
  const startMs = Number(BigInt(root.startTimeUnixNano) / BigInt(1000000))
  const messages = root.attributes['gen_ai.input.messages'] as { parts: { content: string }[] }[] | undefined
  const prompt = messages?.[0]?.parts[0]?.content ?? ''

  const assess: TurnRecord['assess'] = {}
  for (const s of spans) {
    if (s.name !== 'handhold.assess') continue
    const a = assessFrom(s.attributes)
    if (!a) continue
    // A review-time score stands in for the post-answer one: both judge the finished turn.
    const phase = s.attributes['handhold.judge.phase']
    if (phase === 'post' || phase === 'review') assess.post = a
    else assess.pre = a
  }
  return { sessionId, turnId, startMs, prompt, assess }
}

export type TraceFile = { sessionId: string; fileName: string; spans: Span[] }

export type Scope = { sessionId: string } | { sinceMs: number }

// Reads every trace file in scope, line by line. A line that is not JSON is skipped; a missing folder is no files.
export async function traceRoot(io: Pick<ReadIo, 'home'>, cfg: Config): Promise<string> {
  const home = (await io.home()) ?? ''
  return cfg.traceRoot.replace(/^~(?=\/|$)/, home)
}

// What /handhold forget has dropped: whole sessions, and single turns as "<session>/<file>". Kept in the trace
// folder because plugins cannot delete files; every reader skips what it lists.
export type Forgotten = { sessions: string[]; turns: string[] }

export const FORGOTTEN_FILE = 'forgotten.json'

export async function readForgotten(io: ReadIo, root: string): Promise<Forgotten> {
  try {
    const raw = JSON.parse(await io.read(`${root}/${FORGOTTEN_FILE}`)) as Partial<Forgotten>
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return { sessions: strings(raw.sessions), turns: strings(raw.turns) }
  } catch {
    return { sessions: [], turns: [] }
  }
}

export async function readTraceFiles(io: ReadIo, cfg: Config, scope: Scope): Promise<TraceFile[]> {
  const root = await traceRoot(io, cfg)
  const forgotten = await readForgotten(io, root)
  const skipSession = new Set(forgotten.sessions)
  const skipTurn = new Set(forgotten.turns)

  let sessions: string[] = []
  if ('sessionId' in scope) {
    sessions = [scope.sessionId]
  } else {
    try {
      sessions = (await io.list(root)).filter(e => e.kind === 'dir').map(e => e.name)
    } catch {
      return []
    }
  }

  const files: TraceFile[] = []
  for (const sessionId of sessions) {
    if (skipSession.has(sessionId)) continue
    let entries: { name: string; mtimeMs: number }[] = []
    try {
      entries = (await io.list(`${root}/${sessionId}`)).filter(e => e.kind === 'file' && e.name.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const entry of entries) {
      if ('sinceMs' in scope && entry.mtimeMs < scope.sinceMs) continue
      if (skipTurn.has(`${sessionId}/${entry.name}`)) continue
      let text: string
      try {
        text = await io.read(`${root}/${sessionId}/${entry.name}`)
      } catch {
        continue
      }
      const spans: Span[] = []
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue
        try {
          const parsed = JSON.parse(line) as Partial<Span> | null
          if (parsed && typeof parsed === 'object' && typeof parsed.spanId === 'string' && typeof parsed.name === 'string') {
            spans.push(parsed as Span)
          }
        } catch {
          // A damaged line costs that line only.
        }
      }
      files.push({ sessionId, fileName: entry.name, spans })
    }
  }
  return files
}

// The turns of files already read, oldest first.
export function turnsOf(files: TraceFile[]): TurnRecord[] {
  const records: TurnRecord[] = []
  for (const f of files) {
    const record = toTurnRecord(f.sessionId, f.fileName, f.spans)
    if (record) records.push(record)
  }
  return records.sort((a, b) => a.startMs - b.startMs)
}

// Every turn in scope, oldest first.
export async function readTurns(io: ReadIo, cfg: Config, scope: Scope): Promise<TurnRecord[]> {
  return turnsOf(await readTraceFiles(io, cfg, scope))
}

// Two prompts are the same request when they match after case and whitespace.
export const samePrompt = (p: string): string => p.trim().replace(/\s+/g, ' ').toLowerCase()

export function aggregate(turns: TurnRecord[]): Aggregate {
  // A request asked more than once counts once, by its latest judgement (turns arrive oldest first).
  const byPrompt = new Map<string, { turn: TurnRecord; a: Assessment }>()
  for (const t of turns) {
    const a = t.assess.post ?? t.assess.pre
    if (a?.warranted) byPrompt.set(samePrompt(t.prompt), { turn: t, a })
  }
  const judged = [...byPrompt.values()]

  const dims: Dimension[] = ['altitude', 'depth', 'range']
  const avg = Object.fromEntries(
    dims.map(d => [d, judged.length === 0 ? 0 : judged.reduce((sum, x) => sum + x.a.scores[d], 0) / judged.length]),
  ) as Record<Dimension, number>

  const counts = new Map<Technique, number>()
  for (const x of judged) {
    if (needsNudge(x.a)) counts.set(x.a.technique, (counts.get(x.a.technique) ?? 0) + 1)
  }
  const missed = [...counts.entries()].map(([technique, count]) => ({ technique, count })).sort((a, b) => b.count - a.count)

  const bySum = [...judged].sort((x, y) => scoreSum(y.a) - scoreSum(x.a))
  return {
    turns: turns.length,
    warranted: judged.length,
    avg,
    missed,
    // The weakest come first; the strongest are drawn from the rest, so no turn is in both.
    worst: [...bySum].reverse().slice(0, 3).map(x => x.turn),
    best: bySum.slice(0, Math.max(0, Math.min(3, bySum.length - 3))).map(x => x.turn),
  }
}
