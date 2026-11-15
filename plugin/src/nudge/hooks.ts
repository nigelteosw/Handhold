import { atom, read, update } from 'claude-code'
import type { Engine, On } from 'claude-code'

import type { Assessment, Backoff, PendingAssess } from '../../types'
import { addSpan } from '../capture/hooks'
import { assessAttrs, needsNudge } from '../mentor/assessment'
import { isTrivial } from '../mentor/gate'
import { judge } from '../mentor/judge'
import type { Config } from '../shared/config'
import { BRIEF, BRIEF_ID } from './brief'
import { EMPTY_BACKOFF, isSuppressed, recordOutcome } from './backoff'
import { hintFor } from './context'

const backoffState = atom({ plugin: 'handhold', key: 'backoff' } as const, EMPTY_BACKOFF, { shape: 'backoff-1' })
const recentState = atom({ plugin: 'handhold', key: 'recent' } as const, [] as Assessment[], { shape: 'recent-1' })
const pendingState = atom({ plugin: 'handhold', key: 'pendingAssess' } as const, null as PendingAssess, {
  shape: 'pending-1',
})

// The standing brief: added once to the system prompt of the session.
export function registerNudge(on: On): void {
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (result.sections.some(s => s.id === BRIEF_ID)) return result
    return { ...result, sections: [...result.sections, BRIEF] }
  }).catch(($, e, next) => next(e))
}

// Pre-send: judges the prompt and, when a dimension is low, hands Claude a hidden hint for this turn.
export async function nudgePrompt(
  $: Engine,
  cfg: Config,
  e: { text: string; command?: unknown; isMeta?: boolean; context?: readonly string[] },
  next: (e: never) => Promise<{ text: string; drop?: undefined }> | { text: string },
): Promise<never> {
  if (e.command || e.isMeta || isTrivial(e.text)) return next(e as never) as never

  const recent = await read($, recentState)
  const lastRewrite = recent.at(-1)?.rewrite ?? ''
  let backoff: Backoff = recordOutcome(await read($, backoffState), e.text, lastRewrite)

  const assessment = await judge($, { prompt: e.text, phase: 'pre', recent }, cfg)

  await update($, recentState, list => (assessment ? [...list, assessment].slice(-5) : list))
  await update($, pendingState, () => ({ prompt: e.text, assessment }))

  if (assessment && needsNudge(assessment) && !isSuppressed(backoff, assessment.technique)) {
    backoff = { ...backoff, offered: assessment.technique }
    await update($, backoffState, () => backoff)
    return next({ ...e, context: [...(e.context ?? []), hintFor(assessment)] } as never) as never
  }

  await update($, backoffState, () => backoff)
  return next(e as never) as never
}

// After the turn starts: attaches the pre-send assessment to its own turn, matched by prompt text.
export async function attachAssess($: Engine, cfg: Config, e: { text: string; turnId: string; agentId?: string }): Promise<void> {
  if (e.agentId) return
  const pending = await read($, pendingState)
  if (pending && pending.assessment && pending.prompt === e.text) {
    await addSpan($, cfg, e.turnId, 'handhold.assess', assessAttrs(pending.assessment, 'pre'))
  }
  await update($, pendingState, () => null)
}

// The last assessments of the session, for the judge's context. Read and written here, where the atom is defined.
export async function recentAssessments($: Engine): Promise<Assessment[]> {
  return read($, recentState)
}

export async function recordAssessment($: Engine, a: Assessment): Promise<void> {
  await update($, recentState, list => [...list, a].slice(-5))
}
