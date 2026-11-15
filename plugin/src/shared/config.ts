export type Redact = 'none' | 'tool-results' | 'all-tool-io'

export type Config = {
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

const redactMode = (value: unknown): Redact =>
  REDACT_MODES.includes(value as string) ? (value as Redact) : 'none'

export function readConfig(options: Record<string, unknown>): Config {
  return {
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
