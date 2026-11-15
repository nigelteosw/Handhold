import type { EngineInterface as Engine } from 'claude-code'

import type { Span } from '../../types'
import type { Config } from '../shared/config'
import { techniqueLabel } from '../mentor/rubric'
import { aggregate, readIo, readTraceFiles, readTurns } from './read'
import type { Aggregate } from './read'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
const STATUS = { UNSET: 0, OK: 1, ERROR: 2 } as const
const KIND = { INTERNAL: 1, CLIENT: 3 } as const

type KeyValue = { key: string; value: Record<string, string | boolean> }

// OTLP JSON: 64-bit integers travel as strings, per the proto3 JSON mapping.
const toValue = (v: unknown): Record<string, string | boolean> => {
  if (typeof v === 'number' && Number.isInteger(v)) return { intValue: String(v) }
  if (typeof v === 'boolean') return { boolValue: v }
  if (typeof v === 'string') return { stringValue: v }
  return { stringValue: JSON.stringify(v) }
}

const toKeyValues = (attributes: Record<string, unknown>): KeyValue[] =>
  Object.entries(attributes).map(([key, value]) => ({ key, value: toValue(value) }))

// Strict OTLP JSON, so any OpenTelemetry backend can read the file.
export function toOtlp(spans: Span[]): object {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'handhold' } }] },
        scopeSpans: [
          {
            scope: { name: 'handhold', version: '0.2.0' },
            spans: spans.map(s => ({
              traceId: s.traceId,
              spanId: s.spanId,
              ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
              name: s.name,
              kind: KIND[s.kind] ?? KIND.INTERNAL,
              startTimeUnixNano: s.startTimeUnixNano,
              endTimeUnixNano: s.endTimeUnixNano ?? s.startTimeUnixNano,
              attributes: toKeyValues(s.attributes),
              status: { code: STATUS[s.status?.code] ?? STATUS.UNSET, ...(s.status?.message ? { message: s.status.message } : {}) },
            })),
          },
        ],
      },
    ],
  }
}

// A Markdown progress report for sharing. It carries scores and short before-and-after pairs, not transcripts.
export function progressReport(agg: Aggregate, range: string): string {
  const f = (n: number) => n.toFixed(1)
  const lines = [
    '# Handhold progress report',
    '',
    `Range: ${range}`,
    `Turns: ${agg.turns} (warranted: ${agg.warranted})`,
    '',
    '| Dimension | Average (0–3) |',
    '|---|---|',
    `| Altitude | ${f(agg.avg.altitude)} |`,
    `| Depth | ${f(agg.avg.depth)} |`,
    `| Range | ${f(agg.avg.range)} |`,
    '',
    '## Most missed techniques',
    ...(agg.missed.length > 0 ? agg.missed.map(m => `- ${techniqueLabel(m.technique)} (${m.count})`) : ['- none']),
    '',
    '## Before and after',
    ...agg.worst.map(t => {
      const a = t.assess.post ?? t.assess.pre
      return `- Before: "${t.prompt}"\n  After: "${a?.rewrite ?? ''}"`
    }),
  ]
  return lines.join('\n') + '\n'
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

// /handhold export [--otlp] [--report [path]]: with no flags, writes both files.
export async function exportCmd($: Engine, cfg: Config, args: string): Promise<{ text: string }> {
  const tokens = args.trim() === '' ? [] : args.trim().split(/\s+/)
  const wantsOtlp = tokens.length === 0 || tokens.includes('--otlp')
  const reportAt = tokens.indexOf('--report')
  const wantsReport = tokens.length === 0 || reportAt !== -1
  const explicitPath = reportAt !== -1 && tokens[reportAt + 1] && !tokens[reportAt + 1].startsWith('--') ? tokens[reportAt + 1] : undefined

  const now = Date.now()
  const day = isoDay(now)
  const range = `${isoDay(now - WEEK_MS)} to ${day}`
  const home = (await $.env.get('HOME')) ?? ''
  const exportsDir = `${home}/.handhold/exports`
  const io = readIo($)
  const written: string[] = []

  if (wantsOtlp) {
    const files = await readTraceFiles(io, cfg, { sinceMs: now - WEEK_MS })
    const spans = files.flatMap(f => f.spans)
    const path = `${exportsDir}/otlp-${day}.json`
    await $.fs.write(path, JSON.stringify(toOtlp(spans), null, 2))
    written.push(path)
  }

  if (wantsReport) {
    const turns = await readTurns(io, cfg, { sinceMs: now - WEEK_MS })
    const path = explicitPath ?? `${exportsDir}/report-${day}.md`
    await $.fs.write(path, progressReport(aggregate(turns), range))
    written.push(path)
  }

  return { text: written.length > 0 ? `Wrote ${written.join('\n')}` : 'Nothing to export.' }
}
