import type { EngineInterface as Engine } from 'claude-code'

import type { Config } from '../shared/config'
import { techniqueLabel } from '../mentor/rubric'
import { judgeBatch } from '../mentor/judge'
import { recordSessionStat } from './pane'
import { aggregate, readIo, readTraceFiles, turnsOf } from './read'
import type { Aggregate, TurnRecord } from './read'
import { scoreUnscored } from './score'

const DAY_MS = 7 * 24 * 60 * 60 * 1000

const REFLECT_SYSTEM = `You help a person reflect on how ambitiously they worked with an AI assistant, using three dimensions: Altitude (aim at the outcome, not the task), Depth (work the way a field-leading expert would), Range (draw on other fields by their real methods). Write for the person, in plain prose, under these four headings: **Patterns** (what they most often miss, grounded in the techniques given), **Best moments** (the three strongest turns, briefly), **Try next time** (three before-and-after rewrites, using their own prompts), **Trend** (how their scores moved). Be specific and brief.`

const pair = (t: TurnRecord): string => {
  const a = t.assess.post ?? t.assess.pre
  return `before: ${t.prompt}\nafter: ${a?.rewrite ?? ''}`
}

const reviewPrompt = (agg: Aggregate): string =>
  [
    `Turns: ${agg.turns}; warranted: ${agg.warranted}`,
    `Average scores: altitude ${agg.avg.altitude.toFixed(2)}, depth ${agg.avg.depth.toFixed(2)}, range ${agg.avg.range.toFixed(2)}`,
    `Most missed techniques: ${agg.missed.map(m => `${techniqueLabel(m.technique)} (${m.count})`).join(', ') || 'none'}`,
    `Weakest turns, with rewrites:\n${agg.worst.map(pair).join('\n\n') || 'none'}`,
    `Strongest turns:\n${agg.best.map(t => t.prompt).join('\n') || 'none'}`,
  ].join('\n\n')

// The plain-text fallback, used when the model cannot answer.
export function renderAggregate(agg: Aggregate): string {
  const lines = [
    `Turns: ${agg.turns} (warranted: ${agg.warranted})`,
    `Altitude ${agg.avg.altitude.toFixed(1)} · Depth ${agg.avg.depth.toFixed(1)} · Range ${agg.avg.range.toFixed(1)}`,
  ]
  if (agg.missed.length > 0) {
    lines.push(`Most missed: ${agg.missed.map(m => `${techniqueLabel(m.technique)} (${m.count})`).join(', ')}`)
  }
  for (const t of agg.worst) lines.push(`Try: "${t.prompt}" → "${(t.assess.post ?? t.assess.pre)?.rewrite ?? ''}"`)
  return lines.join('\n')
}

// What the scoring step did, for the top of the review.
export function scoringLine(scored: number, left: number): string {
  if (scored === 0 && left === 0) return ''
  const more = left > 0 ? ` ${left} older turn${left === 1 ? '' : 's'} still unscored: run the review again to score them.` : ''
  return `Scored ${scored} new turn${scored === 1 ? '' : 's'}.${more}`
}

// /handhold review [session|week]: scores the unscored turns in scope in one cheap batch call, then asks
// the review model for a reflection. These are the only model calls Handhold makes in review mode.
export async function review($: Engine, cfg: Config, args: string): Promise<{ text: string }> {
  const io = readIo($)
  const sessionId = await $.session.id()
  const scope = args.trim() === 'week' ? { sinceMs: Date.now() - 7 * DAY_MS } : { sessionId }
  const files = await readTraceFiles(io, cfg, scope)
  if (files.length === 0) return { text: 'No turns recorded yet.' }

  const { scored, left } = await scoreUnscored(
    { ...io, write: (path, text) => $.fs.write(path, text) },
    cfg,
    files,
    items => judgeBatch($, items, cfg),
  )
  for (const s of scored) {
    try {
      await recordSessionStat($, s.assessment, new Date(s.turn.startMs).toISOString().slice(0, 10), s.turn.sessionId === sessionId)
    } catch {
      // The pane's averages are a side effect: their failure never costs the review.
    }
  }
  const header = scoringLine(scored.length, left)
  const withHeader = (body: string) => (header ? `${header}\n\n${body}` : body)

  const agg = aggregate(turnsOf(files))
  if (agg.warranted === 0) return { text: withHeader('No scored turns to reflect on yet.') }
  try {
    const reply = await $.model.complete({
      model: cfg.reviewModel,
      system: REFLECT_SYSTEM,
      prompt: reviewPrompt(agg),
      maxTokens: 1200,
      timeoutMs: 30000,
    })
    if (reply.isAnswered && reply.text.trim() !== '') return { text: withHeader(reply.text) }
  } catch {
    // Fall through to the plain rendering.
  }
  return { text: withHeader(renderAggregate(agg)) }
}
