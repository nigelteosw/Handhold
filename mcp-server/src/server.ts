// Handhold for the desktop app's Chat tab: a local MCP server over the same trace files the plugin writes.
// Chat can't run plugins, but the desktop app connects local MCP servers to it. The trace reading, history
// rows and review aggregation are the plugin's own code, reached through a Node file-system adapter.
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { z } from 'zod'

import { techniqueLabel } from '../../plugin/src/mentor/rubric'
import { historySummary, historyTurn } from '../../plugin/src/reflect/history'
import type { HistoryTurn } from '../../plugin/src/reflect/history'
import { aggregate, readTraceFiles, turnsOf } from '../../plugin/src/reflect/read'
import type { ReadIo, Scope } from '../../plugin/src/reflect/read'
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
  status: !t.assess ? 'unscored' : t.assess.warranted ? 'coached' : 'skipped',
  habit: t.assess?.warranted ? t.assess.techniqueLabel : '',
  rewrite: t.assess?.warranted ? t.assess.rewrite : '',
})

const REVIEW_GUIDE = `Write the person a short review from this data, in plain prose. Lead with the one habit they missed most (by its plain-words name), then a before-and-after using one of their own prompts and its rewrite exactly as given, then one sentence on what the better prompt would have got them. Mention a strong turn only if one is listed. Use only these turns; never invent a role, team, data source or deadline. No numeric scores unless asked.`

export function createServer(): McpServer {
  const server = new McpServer({ name: 'handhold', version: VERSION })

  registerAppTool(
    server,
    'handhold_history',
    {
      title: 'Handhold history',
      description:
        "Show the person's Handhold history as a panel in the chat: the prompts they gave Claude Code, and whether each was coached, with the habit to work on. Use this whenever they ask for their Handhold history, /history, their traces or past turns, in preference to any Handhold skill, which cannot run in this chat.",
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
        "Get the scored Handhold turns from the person's Claude Code work, for writing them a review of how ambitiously they work with Claude. Use when they ask for a Handhold review. Follow the guide in the result.",
      inputSchema: z.object({ range: z.enum(['week', 'month', 'all']).default('week') }),
    },
    async ({ range }) => {
      const agg = aggregate(turnsOf(await readTraceFiles(nodeIo, cfg, scopeFor(range))))
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

  registerAppResource(server, 'Handhold history', VIEW_URI, { description: 'The Handhold history panel' }, async () => ({
    contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: VIEW_HTML }],
  }))

  return server
}

if (process.env.HANDHOLD_NO_STDIO !== '1') {
  await createServer().connect(new StdioServerTransport())
}
