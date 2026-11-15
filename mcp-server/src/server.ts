// Handhold for the desktop app's Chat tab: a local MCP server over the same trace files the plugin writes.
// Chat can't run plugins, but the desktop app connects local MCP servers to it. The trace reading, history
// rows and review aggregation are the plugin's own code, reached through a Node file-system adapter.
import { appendFile, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { z } from 'zod'

import { parseAssessment } from '../../plugin/src/mentor/assessment'
import { RUBRIC_TEXT, techniqueLabel } from '../../plugin/src/mentor/rubric'
import { historySummary, historyTurn } from '../../plugin/src/reflect/history'
import type { HistoryTurn } from '../../plugin/src/reflect/history'
import { aggregate, readTraceFiles, samePrompt, toTurnRecord, traceRoot, turnsOf } from '../../plugin/src/reflect/read'
import type { ReadIo, Scope, TraceFile } from '../../plugin/src/reflect/read'
import { needsScore, reviewSpan } from '../../plugin/src/reflect/score'
import { readConfig } from '../../plugin/src/shared/config'

// Filled in by build.mjs: the panel's HTML, with the MCP Apps client inlined.
declare const VIEW_HTML: string

const VERSION = '0.0.1'
const VIEW_URI = 'ui://handhold/history.html'
const DAY_MS = 24 * 60 * 60 * 1000

// The same settings the plugin reads; HANDHOLD_TRACE_ROOT stands in for its traceRoot option.
const cfg = readConfig({ traceRoot: process.env.HANDHOLD_TRACE_ROOT })

export const nodeIo: ReadIo = {
  home: async () => homedir(),
  list: async path => {
    const names = await readdir(path)
    return Promise.all(
      names.map(async name => {
        const s = await stat(join(path, name))
        return { name, kind: s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other', mtimeMs: s.mtimeMs } as const
      }),
    )
  },
  read: path => readFile(path, 'utf8'),
}

const RANGES = { week: 7, month: 30, all: 0 } as const
type Range = keyof typeof RANGES
const rangeLabel = (r: Range): string => (r === 'all' ? 'All time' : r === 'week' ? 'Last 7 days' : 'Last 30 days')
const scopeFor = (r: Range): Scope => ({ sinceMs: RANGES[r] === 0 ? 0 : Date.now() - RANGES[r] * DAY_MS })

async function historyTurns(range: Range): Promise<HistoryTurn[]> {
  const files = await readTraceFiles(nodeIo, cfg, scopeFor(range))
  return files.map(historyTurn).filter((t): t is HistoryTurn => t !== null)
}

// What the panel draws. Answers stay out: the panel is a list of what you asked and what came of it.
const panelRow = (t: HistoryTurn) => ({
  startMs: t.startMs,
  prompt: t.prompt.slice(0, 400),
  tokens: t.inputTokens + t.outputTokens,
  tools: t.tools.length,
  status: t.assess ? (t.assess.warranted ? 'coached' : 'skipped') : t.quick ? 'quick' : 'unscored',
  habit: t.assess?.warranted ? t.assess.techniqueLabel : '',
  rewrite: t.assess?.warranted ? t.assess.rewrite : '',
})

// A turn's id for the scoring round trip: its session folder and file, which never change.
const idOf = (f: TraceFile): string => `${f.sessionId}/${f.fileName}`

type Pending = { id: string; prompt: string }

// The unscored turns worth scoring, newest first, one per distinct request, at most reviewBatch.
export function toScore(files: TraceFile[]): Pending[] {
  const seen = new Set<string>()
  const out: (Pending & { startMs: number })[] = []
  for (const f of files) {
    const t = toTurnRecord(f.sessionId, f.fileName, f.spans)
    if (!t || !needsScore(t)) continue
    out.push({ id: idOf(f), prompt: t.prompt, startMs: t.startMs })
  }
  return out
    .sort((a, b) => b.startMs - a.startMs)
    .filter(p => !seen.has(samePrompt(p.prompt)) && seen.add(samePrompt(p.prompt)))
    .slice(0, Math.max(1, Math.floor(cfg.reviewBatch)))
    .map(({ id, prompt }) => ({ id, prompt: prompt.slice(0, 2000) }))
}

const scoringRequest = (pending: Pending[], range: Range): string =>
  [
    `Before the review: ${pending.length} turn${pending.length === 1 ? '' : 's'} in ${rangeLabel(range).toLowerCase()} ${pending.length === 1 ? 'has' : 'have'} not been scored. Score each one with the rubric below, judging only the person's prompt. Then call handhold_save_scores once with all of them (each object: the turn's "id" plus the rubric's fields), then call handhold_review_data again with the same range. Tell the person in one short line that you are scoring their recent turns first.`,
    `Rubric (ignore its instruction to reply with JSON; pass the objects to handhold_save_scores instead):\n${RUBRIC_TEXT}`,
    `Turns to score:\n${JSON.stringify(pending, null, 2)}`,
  ].join('\n\n')

// Checks each score with the plugin's parser and appends it to every unscored copy of that request.
export async function saveScores(items: ({ id: string } & Record<string, unknown>)[]): Promise<{ saved: number; rejected: string[] }> {
  const root = await traceRoot(nodeIo, cfg)
  const files = await readTraceFiles(nodeIo, cfg, { sinceMs: 0 })
  const byId = new Map(files.map(f => [idOf(f), f]))
  const rejected: string[] = []
  let saved = 0
  for (const { id, ...fields } of items) {
    const file = byId.get(id)
    const turn = file ? toTurnRecord(file.sessionId, file.fileName, file.spans) : null
    if (!file || !turn) {
      rejected.push(`${id}: no such turn`)
      continue
    }
    const a = parseAssessment(JSON.stringify(fields))
    if (!a) {
      rejected.push(`${id}: does not match the rubric's shape`)
      continue
    }
    const copies = files.filter(f => {
      const t = toTurnRecord(f.sessionId, f.fileName, f.spans)
      return t !== null && needsScore(t) && samePrompt(t.prompt) === samePrompt(turn.prompt)
    })
    if (copies.length === 0) {
      rejected.push(`${id}: already scored`)
      continue
    }
    for (const f of copies) {
      const span = reviewSpan(f.spans, a, Date.now())
      if (!span) continue
      await appendFile(join(root, f.sessionId, f.fileName), `${JSON.stringify(span)}\n`)
      f.spans.push(span)
    }
    saved++
  }
  return { saved, rejected }
}

const REVIEW_GUIDE = `Write the person a short review from this data, in plain prose. Lead with the one habit they missed most (by its plain-words name), then a before-and-after using one of their own prompts and its rewrite exactly as given, then one sentence on what the better prompt would have got them. Mention a strong turn only if one is listed. Use only these turns; never invent a role, team, data source or deadline. No numeric scores unless asked.`

export function createServer(): McpServer {
  const server = new McpServer({ name: 'handhold', version: VERSION })

  registerAppTool(
    server,
    'handhold_history',
    {
      title: 'Handhold history',
      description:
        "Show the person's Handhold history as a panel in the chat: the prompts they gave Claude Code, and whether each was coached, with the habit to work on. Use this whenever they ask for their Handhold history, /history, their traces or past turns.",
      inputSchema: z.object({ range: z.enum(['week', 'month', 'all']).default('month') }),
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async ({ range }) => {
      const turns = await historyTurns(range)
      const label = rangeLabel(range)
      return {
        content: [{ type: 'text', text: historySummary(turns, label) }],
        structuredContent: { scope: label, turns: turns.sort((a, b) => b.startMs - a.startMs).slice(0, 200).map(panelRow) },
      }
    },
  )

  server.registerTool(
    'handhold_review_data',
    {
      title: 'Handhold review data',
      description:
        "Get the person's Handhold turns from their Claude Code work, for writing them a review of how ambitiously they work with Claude. Use when they ask for a Handhold review. Do exactly what the result says: it may first ask you to score unscored turns and save them with handhold_save_scores.",
      inputSchema: z.object({ range: z.enum(['week', 'month', 'all']).default('week') }),
    },
    async ({ range }) => {
      const files = await readTraceFiles(nodeIo, cfg, scopeFor(range))
      const pending = toScore(files)
      if (pending.length > 0) return { content: [{ type: 'text', text: scoringRequest(pending, range) }] }
      const agg = aggregate(turnsOf(files))
      const pick = (t: (typeof agg.worst)[number]) => {
        const a = t.assess.post ?? t.assess.pre
        return { prompt: t.prompt, rewrite: a?.rewrite ?? '', habit: a ? techniqueLabel(a.technique) : '' }
      }
      const data = {
        range: rangeLabel(range),
        turns: agg.turns,
        worthCoaching: agg.warranted,
        missedMost: agg.missed.map(m => ({ habit: techniqueLabel(m.technique), times: m.count })),
        weakest: agg.worst.map(pick),
        strongest: agg.best.map(t => t.prompt),
      }
      const text =
        agg.warranted === 0
          ? `${rangeLabel(range)}: ${agg.turns} turns, none needed coaching or none has been scored yet. Scores come from /handhold review in Claude Code.`
          : `${REVIEW_GUIDE}\n\n${JSON.stringify(data, null, 2)}`
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'handhold_save_scores',
    {
      title: 'Save Handhold scores',
      description:
        'Save the scores you gave to unscored Handhold turns, as handhold_review_data asked. Each score is checked against the rubric and written to that turn, so it is never scored twice.',
      inputSchema: z.object({
        scores: z
          .array(z.object({ id: z.string() }).passthrough())
          .describe('One object per turn: its id from handhold_review_data, plus the rubric fields (warranted, scores, evidence, opportunity, technique, nudge, rewrite).'),
      }),
    },
    async ({ scores }) => {
      const r = await saveScores(scores)
      const problems = r.rejected.length > 0 ? `\nNot saved: ${r.rejected.join('; ')}.` : ''
      return { content: [{ type: 'text', text: `Saved ${r.saved} score${r.saved === 1 ? '' : 's'}.${problems}\nNow call handhold_review_data again to write the review.` }] }
    },
  )

  registerAppResource(server, 'Handhold history', VIEW_URI, { description: 'The Handhold history panel' }, async () => ({
    contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: VIEW_HTML }],
  }))

  return server
}

if (process.env.HANDHOLD_NO_STDIO !== '1') {
  await createServer().connect(new StdioServerTransport())
}
