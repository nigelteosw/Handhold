import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { Assessment } from '../../types'
import { addSpan } from '../capture/hooks'
import type { ClosedTurn } from '../capture/hooks'
import { assessAttrs, needsNudge } from '../mentor/assessment'
import { judge } from '../mentor/judge'
import type { Config } from '../shared/config'
import { recentAssessments, recordAssessment } from './hooks'
import { recordSessionStat } from '../reflect/pane'

// Shape tags let a reload drop values that an older version stored in another form.
export const quietState = atom({ plugin: 'handhold', key: 'quiet' } as const, false, { shape: 'quiet-1' })

// Starts large, so the first warranted turn of a session may show a note.
export const turnsState = atom({ plugin: 'handhold', key: 'turnsSinceNote' } as const, 1_000_000, {
  shape: 'turns-1',
})

const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

export function noteText(a: Assessment): string {
  return `Handhold · ${cap(a.opportunity)} ${a.scores[a.opportunity]} → try: "${a.rewrite}"`
}

export function shouldShowNote(
  s: { quiet: boolean; turnsSinceNote: number },
  a: Assessment | null,
  every: number,
): boolean {
  return !s.quiet && a !== null && a.warranted && needsNudge(a) && s.turnsSinceNote >= every
}

// The turn as the post-answer judge sees it: what was used and how it ended, not the whole transcript.
export function summarize(t: ClosedTurn): string {
  return `tools: ${t.toolNames.join(', ') || 'none'}; subagents: ${t.agentTypes.join(', ') || 'none'}; aborted: ${t.isAborted}; answer: ${t.answer.slice(0, 400)}`
}

// Counts this turn and reports whether to show a note. A note at turn N allows the next at turn N + every.
export async function throttle(
  $: Engine,
  a: Assessment | null,
  every: number,
): Promise<boolean> {
  const quiet = await read($, quietState)
  const turnsSinceNote = (await read($, turnsState)) + 1
  const show = shouldShowNote({ quiet, turnsSinceNote }, a, every)
  await update($, turnsState, () => (show ? 0 : turnsSinceNote))
  return show
}

export async function setQuiet($: Engine, isQuiet: boolean): Promise<void> {
  await update($, quietState, () => isQuiet)
}

// Post-answer: the full judge scores the closed turn, records the span on its file, and remembers the result.
export async function postAssess($: Engine, cfg: Config, t: ClosedTurn): Promise<Assessment | null> {
  const a = await judge(
    $,
    { prompt: t.prompt, phase: 'post', turnSummary: summarize(t), recent: await recentAssessments($) },
    cfg,
  )
  if (a) {
    await recordAssessment($, a)
    try {
      await recordSessionStat($, a)
    } catch {
      // The averages are a side effect: their failure never costs the note or the span.
    }
    await addSpan($, cfg, t.turnId, 'handhold.assess', assessAttrs(a, 'post'))
  }
  return a
}
