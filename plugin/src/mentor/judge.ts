import type { EngineInterface as Engine } from 'claude-code'

import type { Assessment } from '../../types'
import type { Config } from '../shared/config'
import { parseAssessment } from './assessment'
import { RUBRIC_TEXT } from './rubric'

export type JudgeInput = {
  prompt: string
  phase: 'pre' | 'post'
  turnSummary?: string
  recent: Assessment[]
}

// Scores one request. The pre phase uses the fast model and short budget; the post phase the per-turn model.
// Returns null on any failure, so a judge problem never changes the turn.
export async function judge($: Engine, input: JudgeInput, cfg: Config): Promise<Assessment | null> {
  const isPre = input.phase === 'pre'
  const model = isPre ? cfg.fastModel : cfg.turnModel
  const timeoutMs = isPre ? cfg.preTimeoutMs : cfg.postTimeoutMs

  const parts = [`Request:\n${input.prompt}`]
  if (input.turnSummary) parts.push(`Turn summary:\n${input.turnSummary}`)
  const recent = input.recent.slice(-5).map(a => ({ scores: a.scores, technique: a.technique }))
  if (recent.length > 0) parts.push(`Recent assessments of this session:\n${JSON.stringify(recent)}`)

  try {
    const reply = await $.model.complete({
      model,
      system: RUBRIC_TEXT,
      prompt: parts.join('\n\n'),
      maxTokens: 600,
      timeoutMs,
    })
    if (!reply.isAnswered) return null
    return parseAssessment(reply.text)
  } catch (err) {
    $.ui.log(`handhold: judge ${input.phase} failed (${err instanceof Error ? err.name : 'Error'})`, { to: 'debug' })
    return null
  }
}

export const BATCH_SYSTEM = `${RUBRIC_TEXT}

BATCH MODE. You will receive several requests, each headed "#<id>". Score each one on its own, by the rules above.
Reply with only a JSON array with one object per request, each the object above plus its "id", e.g.
[{"id": "1", "warranted": false}, {"id": "2", "warranted": true, "scores": {...}, ...}]
Keep evidence quotes and the nudge short. Reply with only the JSON array.`

// Most characters of one prompt sent to the batch judge: enough to score, small enough to stay cheap.
const BATCH_PROMPT_CHARS = 1500

// Reads the batch judge's reply: every element that parses becomes an assessment keyed by its id.
export function parseBatch(text: string): Map<string, Assessment> {
  const out = new Map<string, Assessment>()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return out
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return out
  }
  if (!Array.isArray(raw)) return out
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const id = (item as { id?: unknown }).id
    if (typeof id !== 'string' && typeof id !== 'number') continue
    const a = parseAssessment(JSON.stringify(item))
    if (a) out.set(String(id), a)
  }
  return out
}

// Scores several prompts in a single call to the per-turn model. Returns what parsed; empty on any failure.
export async function judgeBatch(
  $: Engine,
  items: { id: string; prompt: string }[],
  cfg: Config,
): Promise<Map<string, Assessment>> {
  if (items.length === 0) return new Map()
  const prompt = items
    .map(i => `#${i.id}\n${i.prompt.length > BATCH_PROMPT_CHARS ? i.prompt.slice(0, BATCH_PROMPT_CHARS) + '…' : i.prompt}`)
    .join('\n\n')
  try {
    const reply = await $.model.complete({
      model: cfg.turnModel,
      system: BATCH_SYSTEM,
      prompt,
      maxTokens: 120 + 260 * items.length,
      timeoutMs: Math.max(cfg.postTimeoutMs, 30000),
    })
    return reply.isAnswered ? parseBatch(reply.text) : new Map()
  } catch (err) {
    $.ui.log(`handhold: batch judge failed (${err instanceof Error ? err.name : 'Error'})`, { to: 'debug' })
    return new Map()
  }
}
