import type { Assessment, Dimension } from '../../types'
import { DIMENSIONS } from '../mentor/rubric'

export type DayStats = { day: string; n: number; sum: Record<Dimension, number> }

const KEEP_DAYS = 30

const emptyDay = (day: string): DayStats => ({
  day,
  n: 0,
  sum: { altitude: 0, depth: 0, range: 0 },
})

// Adds one assessment to its day. Turns that were not warranted are not scored, so they are not counted.
export function recordDay(days: DayStats[], day: string, a: Assessment): DayStats[] {
  if (!a.warranted) return days
  const current = days.find(d => d.day === day) ?? emptyDay(day)
  const updated: DayStats = {
    day,
    n: current.n + 1,
    sum: {
      altitude: current.sum.altitude + a.scores.altitude,
      depth: current.sum.depth + a.scores.depth,
      range: current.sum.range + a.scores.range,
    },
  }
  const rest = days.filter(d => d.day !== day)
  return [...rest, updated].sort((x, y) => x.day.localeCompare(y.day)).slice(-KEEP_DAYS)
}

// The average of each dimension over the days that fall within the last `days` days, ending at `today`.
export function windowAverage(days: DayStats[], today: string, length: number): Record<Dimension, number> {
  const end = new Date(`${today}T00:00:00Z`).getTime()
  const start = end - (length - 1) * 24 * 60 * 60 * 1000
  const within = days.filter(d => {
    const t = new Date(`${d.day}T00:00:00Z`).getTime()
    return t >= start && t <= end
  })
  const n = within.reduce((sum, d) => sum + d.n, 0)
  const result = {} as Record<Dimension, number>
  for (const dim of DIMENSIONS) {
    const total = within.reduce((sum, d) => sum + d.sum[dim], 0)
    result[dim] = n === 0 ? 0 : total / n
  }
  return result
}

export const label = (d: Dimension): string => d.charAt(0).toUpperCase() + d.slice(1)
