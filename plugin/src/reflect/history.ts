import type { EngineInterface as Engine } from 'claude-code'

import type { Assessment, Span } from '../../types'
import { techniqueLabel } from '../mentor/rubric'
import type { Config } from '../shared/config'
import { DATA_CALLBACK, DATA_FILE, pageHtml } from './history-page'
import { readIo, readTraceFiles, toTurnRecord } from './read'
import type { Scope, TraceFile } from './read'

const DAY_MS = 24 * 60 * 60 * 1000
const TEXT_CHARS = 6000

export type HistoryTurn = {
  sessionId: string
  turnId: string
  startMs: number
  durationMs: number
  prompt: string
  answer: string
  models: string[]
  inputTokens: number
  outputTokens: number
  tools: { name: string; ms: number; ok: boolean }[]
  agents: string[]
  aborted: boolean
  assess: (Assessment & { techniqueLabel: string }) | null
}

const nanoToMs = (n: string | null | undefined): number => (n ? Number(BigInt(n) / BigInt(1000000)) : 0)

const clip = (s: string): string => (s.length > TEXT_CHARS ? s.slice(0, TEXT_CHARS) + '…' : s)

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function answerOf(root: Span): string {
  const out = root.attributes['gen_ai.output.messages'] as { parts?: { type: string; content?: string }[] }[] | undefined
  return (out ?? [])
    .flatMap(m => m.parts ?? [])
    .filter(p => p.type === 'text' && typeof p.content === 'string')
    .map(p => p.content as string)
    .join('\n')
}

// One trace file becomes one row of the page. Tool arguments and results stay out: names and timings only.
export function historyTurn(file: TraceFile): HistoryTurn | null {
  const record = toTurnRecord(file.sessionId, file.fileName, file.spans)
  const root = file.spans.find(s => s.name === 'invoke_agent claude')
  if (!record || !root) return null

  const chats = file.spans.filter(s => s.name.startsWith('chat '))
  const models = [...new Set(chats.map(s => String(s.attributes['gen_ai.response.model'] ?? s.attributes['gen_ai.request.model'] ?? '')).filter(Boolean))]
  const a = record.assess.post ?? record.assess.pre

  return {
    sessionId: file.sessionId,
    turnId: record.turnId,
    startMs: record.startMs,
    durationMs: Math.max(0, nanoToMs(root.endTimeUnixNano) - nanoToMs(root.startTimeUnixNano)),
    prompt: clip(record.prompt),
    answer: clip(answerOf(root)),
    models,
    inputTokens: chats.reduce((sum, s) => sum + num(s.attributes['gen_ai.usage.input_tokens']), 0),
    outputTokens: chats.reduce((sum, s) => sum + num(s.attributes['gen_ai.usage.output_tokens']), 0),
    tools: file.spans
      .filter(s => s.name.startsWith('execute_tool '))
      .map(s => ({
        name: String(s.attributes['gen_ai.tool.name'] ?? s.name.slice('execute_tool '.length)),
        ms: Math.max(0, nanoToMs(s.endTimeUnixNano) - nanoToMs(s.startTimeUnixNano)),
        ok: s.status?.code !== 'ERROR',
      })),
    agents: file.spans
      .filter(s => s.name.startsWith('invoke_agent ') && s.spanId !== root.spanId)
      .map(s => s.name.slice('invoke_agent '.length)),
    aborted: root.status?.code === 'ERROR',
    assess: a ? { ...a, techniqueLabel: a.warranted ? techniqueLabel(a.technique) : '' } : null,
  }
}

// Data inside a <script> block: "<" is escaped so no value can close the tag, and the two JS line separators too.
export const embedJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')


export type HistoryPayload = { generatedMs: number; scope: string; turns: HistoryTurn[] }

// The page as written: a snapshot it renders at once, plus a poller for the live data file beside it.
export function historyHtml(turns: HistoryTurn[], generatedMs: number, scopeLabel: string): string {
  return pageHtml(embedJson({ generatedMs, scope: scopeLabel, turns } satisfies HistoryPayload))
}

// The live data file: a script that hands the payload to the page's callback. A script, not JSON,
// because a file:// page may load a sibling <script> but may not fetch() one.
export function historyDataJs(payload: HistoryPayload): string {
  return `window.${DATA_CALLBACK} && window.${DATA_CALLBACK}(${embedJson(payload)});\n`
}

// What the last /handhold history asked for, so later turns can rewrite the same view.
export type LiveScope = { word: HistoryWord; sessionId?: string; openedMs: number }
export type HistoryWord = 'session' | 'week' | 'month' | 'all'

// A page left open longer than this stops being refreshed, so idle installs do no work on every turn.
export const LIVE_FOR_MS = 12 * 60 * 60 * 1000

export function wordOf(args: string): HistoryWord {
  const w = args.trim().split(/\s+/)[0]
  return w === 'session' || w === 'week' || w === 'all' ? w : 'month'
}

// The trace scope and label for a view, measured from `now` so a rolling window keeps rolling.
export function scopeOf(live: LiveScope, now: number): { scope: Scope; label: string } | null {
  if (live.word === 'session') return live.sessionId ? { scope: { sessionId: live.sessionId }, label: 'This session' } : null
  if (live.word === 'all') return { scope: { sinceMs: 0 }, label: 'All time' }
  const days = live.word === 'week' ? 7 : 30
  return { scope: { sinceMs: now - days * DAY_MS }, label: live.word === 'week' ? 'Last 7 days' : 'Last 30 days' }
}

export function parseLive(text: string): LiveScope | null {
  try {
    const v = JSON.parse(text) as Partial<LiveScope>
    if (!v || typeof v.openedMs !== 'number') return null
    if (v.word !== 'session' && v.word !== 'week' && v.word !== 'month' && v.word !== 'all') return null
    return { word: v.word, openedMs: v.openedMs, ...(typeof v.sessionId === 'string' ? { sessionId: v.sessionId } : {}) }
  } catch {
    return null
  }
}

async function paths($: Engine): Promise<{ page: string; data: string; live: string }> {
  const dir = `${(await $.env.get('HOME')) ?? ''}/.handhold`
  return { page: `${dir}/history.html`, data: `${dir}/${DATA_FILE}`, live: `${dir}/history-live.json` }
}

async function payloadFor($: Engine, cfg: Config, live: LiveScope, now: number): Promise<HistoryPayload | null> {
  const s = scopeOf(live, now)
  if (!s) return null
  const files = await readTraceFiles(readIo($), cfg, s.scope)
  const turns = files.map(historyTurn).filter((t): t is HistoryTurn => t !== null)
  return { generatedMs: now, scope: s.label, turns }
}

// Rewrites the live data file for an open history page. Called after each turn and each review;
// does nothing (and reads no traces) when no page was opened recently. Never throws.
export async function refreshHistory($: Engine, cfg: Config, now = Date.now()): Promise<boolean> {
  try {
    const p = await paths($)
    let text: string
    try {
      text = await $.fs.read(p.live)
    } catch {
      return false
    }
    const live = parseLive(text)
    if (!live || now - live.openedMs > LIVE_FOR_MS) return false
    const payload = await payloadFor($, cfg, live, now)
    if (!payload) return false
    await $.fs.write(p.data, historyDataJs(payload))
    return true
  } catch {
    return false
  }
}

// Opens a local file in the default browser. False when no opener worked; the path is still reported.
async function openInBrowser($: Engine, path: string): Promise<boolean> {
  for (const argv of [['open', path], ['xdg-open', path], ['cmd', '/c', 'start', '', path]]) {
    try {
      const r = await $.process.run(argv, { timeoutMs: 5000 })
      if (r.exitCode === 0) return true
    } catch {
      // Try the next opener.
    }
  }
  return false
}

// /handhold history [session|week|all]: writes a local page of past turns and opens it. No model calls.
// The page stays live: later turns and reviews rewrite its data file, and it picks them up in place.
export async function historyCmd($: Engine, cfg: Config, args: string): Promise<{ text: string }> {
  const now = Date.now()
  const word = wordOf(args)
  const live: LiveScope = { word, openedMs: now, ...(word === 'session' ? { sessionId: await $.session.id() } : {}) }
  const payload = (await payloadFor($, cfg, live, now)) ?? { generatedMs: now, scope: 'This session', turns: [] }

  const p = await paths($)
  await $.fs.write(p.page, historyHtml(payload.turns, now, payload.scope))
  await $.fs.write(p.data, historyDataJs(payload))
  await $.fs.write(p.live, JSON.stringify(live))
  const opened = await openInBrowser($, p.page)
  const n = payload.turns.length
  const unscored = payload.turns.filter(t => !t.assess).length
  const hint = unscored > 0 ? ` ${unscored} not scored yet: /handhold review scores them.` : ''
  return { text: `${opened ? 'Opened' : 'Wrote'} ${p.page} (${n} turns, ${payload.scope.toLowerCase()}). It updates live while open.${hint}` }
}
