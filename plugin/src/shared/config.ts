export type Redact = 'none' | 'tool-results' | 'all-tool-io'

// review: no model calls while you work; turns are scored in one batch by /handhold review.
// live: the per-turn judges, hidden hints and coaching notes run on every warranted turn.
export type Mode = 'review' | 'live'

export type Config = {
  mode: Mode
  reviewBatch: number
  fastModel: string
  turnModel: string
  reviewModel: string
  preTimeoutMs: number
  postTimeoutMs: number
  redact: Redact
  noteEvery: number
  traceRoot: string
}

const REDACT_MODES: readonly string[] = ['none', 'tool-results', 'all-tool-io']

const positive = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() !== '' ? value : fallback

const mode = (value: unknown): Mode => (value === 'live' ? 'live' : 'review')

const redactMode = (value: unknown): Redact =>
  REDACT_MODES.includes(value as string) ? (value as Redact) : 'none'

export function readConfig(options: Record<string, unknown>): Config {
  return {
    mode: mode(options.mode),
    reviewBatch: positive(options.reviewBatch, 15),
    fastModel: text(options.fastModel, 'claude-haiku-5-5'),
    turnModel: text(options.turnModel, 'claude-haiku-5-5'),
    reviewModel: text(options.reviewModel, 'claude-opus-5-5'),
    preTimeoutMs: positive(options.preTimeoutMs, 2000),
    postTimeoutMs: positive(options.postTimeoutMs, 20000),
    redact: redactMode(options.redact),
    noteEvery: positive(options.noteEvery, 3),
    traceRoot: text(options.traceRoot, '~/.handhold/traces'),
  }
}
