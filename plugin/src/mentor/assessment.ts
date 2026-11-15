import type { Assessment, Dimension, Score, Technique } from '../../types'
import { DIMENSIONS, RUBRIC_VERSION, TECHNIQUES } from './rubric'

export type { Assessment, Dimension, Score, Technique }

const isScore = (v: unknown): v is Score => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3
const isDimension = (v: unknown): v is Dimension => (DIMENSIONS as readonly unknown[]).includes(v)
const isTechnique = (v: unknown): v is Technique => (TECHNIQUES as readonly unknown[]).includes(v)

// Takes the first "{" to the last "}" so prose around the JSON is ignored. Returns null on anything invalid.
export function parseAssessment(text: string): Assessment | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || typeof raw.warranted !== 'boolean') return null

  if (raw.warranted === false) {
    return {
      warranted: false,
      scores: { altitude: 3, depth: 3, range: 3 },
      evidence: { altitude: '', depth: '', range: '' },
      opportunity: 'altitude',
      technique: 'goal-beyond-the-goal',
      nudge: '',
      rewrite: '',
    }
  }

  const scores = raw.scores as Record<string, unknown> | undefined
  const evidence = raw.evidence as Record<string, unknown> | undefined
  if (!scores || !evidence) return null
  for (const d of DIMENSIONS) {
    if (!isScore(scores[d])) return null
    if (typeof evidence[d] !== 'string') return null
  }
  if (!isDimension(raw.opportunity) || !isTechnique(raw.technique)) return null
  if (typeof raw.nudge !== 'string' || typeof raw.rewrite !== 'string') return null

  return {
    warranted: true,
    scores: { altitude: scores.altitude as Score, depth: scores.depth as Score, range: scores.range as Score },
    evidence: { altitude: evidence.altitude as string, depth: evidence.depth as string, range: evidence.range as string },
    opportunity: raw.opportunity,
    technique: raw.technique,
    nudge: raw.nudge,
    rewrite: raw.rewrite,
  }
}

// A nudge is due only for warranted prompts where some dimension scores 0 or 1.
export function needsNudge(a: Assessment): boolean {
  return a.warranted && Math.min(...Object.values(a.scores)) <= 1
}

// Attributes for the handhold.assess span, keyed as spec section 4.
export function assessAttrs(a: Assessment, phase: 'pre' | 'post'): Record<string, unknown> {
  return {
    'handhold.rubric.version': RUBRIC_VERSION,
    'handhold.judge.phase': phase,
    'handhold.warranted': a.warranted,
    'handhold.score.altitude': a.scores.altitude,
    'handhold.score.depth': a.scores.depth,
    'handhold.score.range': a.scores.range,
    'handhold.opportunity': a.opportunity,
    'handhold.technique': a.technique,
    'handhold.nudge': a.nudge,
    'handhold.rewrite': a.rewrite,
    'handhold.evidence.altitude': a.evidence.altitude,
    'handhold.evidence.depth': a.evidence.depth,
    'handhold.evidence.range': a.evidence.range,
  }
}
