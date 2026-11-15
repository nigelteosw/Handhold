import { atom, read, update } from 'claude-code'
import type { Engine } from 'claude-code'

import type { Assessment, Dimension } from '../../types'
import { DIMENSIONS } from '../mentor/rubric'
import { suppressedTechniques } from '../nudge/hooks'
import { label, recordDay, windowAverage } from './stats'
import type { DayStats } from './stats'

export const PANE_ID = 'handhold'

const sessionStats = atom(
  { plugin: 'handhold', key: 'sessionStats' } as const,
  { altitude: { n: 0, sum: 0 }, depth: { n: 0, sum: 0 }, range: { n: 0, sum: 0 } },
  { shape: 'stats-1' },
)

const today = (): string => new Date().toISOString().slice(0, 10)

// Records a post-answer assessment into this session's averages and the day's totals.
export async function recordSessionStat($: Engine, a: Assessment): Promise<void> {
  if (!a.warranted) return
  await update($, sessionStats, s => ({
    altitude: { n: s.altitude.n + 1, sum: s.altitude.sum + a.scores.altitude },
    depth: { n: s.depth.n + 1, sum: s.depth.sum + a.scores.depth },
    range: { n: s.range.n + 1, sum: s.range.sum + a.scores.range },
  }))
  const days = ((await $.store.get('days')) ?? []) as DayStats[]
  await $.store.set('days', recordDay(days, today(), a))
}

const fmt = (n: number): string => n.toFixed(1)

// The pane's drawing: session and 7-day averages per dimension, and any backed-off techniques.
export async function drawPane($: Engine, e: Parameters<Engine['ui']['resolve']>[0]) {
  const { Box, Text } = $.ui.resolve(e)
  const stats = await read($, sessionStats)
  const days = ((await $.store.get('days')) ?? []) as DayStats[]
  const week = windowAverage(days, today(), 7)
  const suppressed = await suppressedTechniques($)
  const hasData = DIMENSIONS.some(d => stats[d].n > 0)

  return (
    <Box flexDirection="column">
      {!hasData && <Text dimColor>No assessed turns yet.</Text>}
      {DIMENSIONS.map((d: Dimension) => {
        const session = stats[d].n === 0 ? 0 : stats[d].sum / stats[d].n
        return <Text>{`${label(d)}  session ${fmt(session)} · 7 days ${fmt(week[d])}`}</Text>
      })}
      {suppressed.length > 0 && <Text dimColor>{`Backing off: ${suppressed.join(', ')}`}</Text>}
    </Box>
  )
}

// /handhold pane: opens the progress pane.
export async function openPane($: Engine): Promise<{ text: string }> {
  await $.ui.open({ id: PANE_ID, title: 'Handhold' })
  return { text: 'Handhold pane opened.' }
}
