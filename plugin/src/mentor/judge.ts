import type { Engine } from 'claude-code'

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

// Scores one request. The pre phase uses the fast model and short budget; the post phase the full model.
// Returns null on any failure, so a judge problem never changes the turn.
export async function judge($: Engine, input: JudgeInput, cfg: Config): Promise<Assessment | null> {
  const isPre = input.phase === 'pre'
  const model = isPre ? cfg.fastModel : cfg.fullModel
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
