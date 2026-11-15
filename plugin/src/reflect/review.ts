import type { EngineInterface as Engine } from 'claude-code'

import type { Config } from '../shared/config'
import { techniqueLabel } from '../mentor/rubric'
import { judgeBatch } from '../mentor/judge'
import { recordSessionStat } from './pane'
import { aggregate, readIo, readTraceFiles, turnsOf } from './read'
import type { Aggregate, ReadIo, Scope, TurnRecord } from './read'
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

// Scores the unscored turns in one scope and records them on the pane. Returns the trace files and what was scored.
async function scoreScope($: Engine, cfg: Config, io: ReadIo, sessionId: string, scope: Scope) {
  const files = await readTraceFiles(io, cfg, scope)
  if (files.length === 0) return { files, scored: 0, left: 0 }
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
  return { files, scored: scored.length, left }
}

export const SESSION_FALLBACK = 'Nothing in this session needed coaching, so this review covers the last 7 days.'
export const NOTHING_IN_SESSION =
  'Nothing in this session needed coaching: Handhold skips commands, quick questions and chores. Run /handhold review week to look across sessions.'
export const NOTHING_IN_WEEK =
  'Nothing in the last 7 days needed coaching yet: Handhold skips commands, quick questions and chores. It has the most to say about planning, analysis, writing and design work, so try it on some of that and review again.'

// /handhold review [session|week]: scores the unscored turns in scope in one cheap batch call, then asks
// the review model for a reflection. These are the only model calls Handhold makes in review mode.
// With no argument it reviews this session, and falls back to the last 7 days when nothing here needed coaching.
export async function review($: Engine, cfg: Config, args: string): Promise<{ text: string }> {
  const io = readIo($)
  const sessionId = await $.session.id()
  const word = args.trim()
  const weekScope = { sinceMs: Date.now() - DAY_MS }

  let isWeek = word === 'week'
  let run = await scoreScope($, cfg, io, sessionId, isWeek ? weekScope : { sessionId })
  let agg = aggregate(turnsOf(run.files))
  const notes: string[] = []

  if (!isWeek && word === '' && agg.warranted === 0) {
    const first = scoringLine(run.scored, run.left)
    if (first) notes.push(first)
    isWeek = true
    run = await scoreScope($, cfg, io, sessionId, weekScope)
    agg = aggregate(turnsOf(run.files))
    if (agg.warranted > 0) notes.push(SESSION_FALLBACK)
  }
  const line = scoringLine(run.scored, run.left)
  if (line) notes.push(line)
  const withHeader = (body: string) => [...notes, body].join('\n\n')

  if (run.files.length === 0 && notes.length === 0) return { text: 'No turns recorded yet.' }
  if (agg.warranted === 0) return { text: withHeader(isWeek ? NOTHING_IN_WEEK : NOTHING_IN_SESSION) }
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
