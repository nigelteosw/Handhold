import { atom, read, update } from 'claude-code'
import type { Engine, On } from 'claude-code'

import type { CaptureState, Span } from '../../types'
import type { Config } from '../shared/config'
import { fallThrough } from '../shared/safe'
import { agentAttrs, chatAttrs, toolAttrs, toolResultAttrs, usageAttrs } from './otel'
import { sinkIo, writeTurn } from './sink'
import { TurnSpans } from './spans'

export type ClosedTurn = {
  turnId: string
  seq: number
  prompt: string
  answer: string
  toolNames: string[]
  agentTypes: string[]
  isAborted: boolean
  durationMs: number
}

const EMPTY: CaptureState = {
  seq: 0,
  pendingPrompt: '',
  main: null,
  mainTurnId: null,
  turnRoots: {},
  agentRoots: {},
  agentSpawns: {},
  toolCalls: {},
  lastClosed: null,
}

// Shape tag 'capture-1': a reload that changes the stored shape finds the value absent.
const captureState = atom({ plugin: 'handhold', key: 'capture' } as const, EMPTY, {
  shape: 'capture-1',
})

const now = (): number => Date.now()

// Module-level, so other registrations can subscribe without keeping a returned value.
const listeners: ((t: ClosedTurn) => void)[] = []

export function onTurnClosed(cb: (t: ClosedTurn) => void): void {
  listeners.push(cb)
}

const userMessage = (text: string): Record<string, unknown> => ({
  'gen_ai.input.messages': [{ role: 'user', parts: [{ type: 'text', content: text }] }],
})

const assistantMessage = (answer: string, toolUses: { name: string; input: unknown }[] = []) => [
  {
    role: 'assistant',
    parts: [
      ...(answer ? [{ type: 'text', content: answer }] : []),
      ...toolUses.map(u => ({ type: 'tool_call', name: u.name, arguments: u.input })),
    ],
  },
]

const argsOf = (e: Record<string, unknown>): Record<string, unknown> => {
  const { tool: _tool, tool_use_id: _id, agentId: _agent, requestMeta: _meta, ...input } = e
  return input
}

// Runs fn against the open main turn and persists the turn and any state it returns.
async function withMain(
  $: Engine,
  fn: (turn: TurnSpans) => void,
): Promise<void> {
  const s = await read($, captureState)
  if (!s.main) return
  const turn = TurnSpans.from(s.main)
  fn(turn)
  await update($, captureState, cur => ({ ...cur, main: turn.toJSON() }))
}

type FinishInput = {
  status: 'OK' | 'ERROR'
  message?: string
  answer: string
  durationMs: number
  isAborted: boolean
  closeOpenWith: string
}

// Closes the main turn: sets the root output and status, writes the file, remembers the closed turn for addSpan.
async function finishMain(
  $: Engine,
  cfg: Config,
  input: FinishInput,
  listeners: ((t: ClosedTurn) => void)[],
): Promise<ClosedTurn | null> {
  const s = await read($, captureState)
  if (!s.main || !s.mainTurnId) return null
  const turnId = s.mainTurnId
  const turn = TurnSpans.from(s.main)
  const root = s.turnRoots[turnId]
  const at = now()

  if (root) {
    turn.set(root, { 'gen_ai.output.messages': assistantMessage(input.answer) })
    turn.closeAll(at, { code: 'ERROR', message: input.closeOpenWith })
    turn.close(root, at, input.message ? { code: input.status, message: input.message } : { code: input.status })
  }

  const seq = s.seq + 1
  const spans = turn.finished()
  const sid = await $.session.id()
  await writeTurn(sinkIo($), cfg, sid, seq, turnId, spans)

  await update($, captureState, cur => ({
    ...cur,
    seq,
    pendingPrompt: '',
    main: null,
    mainTurnId: null,
    turnRoots: {},
    agentRoots: {},
    agentSpawns: {},
    toolCalls: {},
    lastClosed: root ? { turnId, seq, root, turn: turn.toJSON() } : null,
  }))

  const closed = summarise(turnId, seq, spans, input)
  for (const listener of listeners) {
    try {
      listener(closed)
    } catch {
      // A listener's failure must not change the turn.
    }
  }
  return closed
}

function summarise(
  turnId: string,
  seq: number,
  spans: Span[],
  input: { answer: string; durationMs: number; isAborted: boolean },
): ClosedTurn {
  const root = spans.find(s => s.name === 'invoke_agent claude')
  const prompt = (root?.attributes['gen_ai.input.messages'] as { parts: { content: string }[] }[] | undefined)?.[0]
    ?.parts[0]?.content
  return {
    turnId,
    seq,
    prompt: prompt ?? '',
    answer: input.answer,
    toolNames: spans
      .filter(s => s.name.startsWith('execute_tool '))
      .map(s => s.name.slice('execute_tool '.length)),
    agentTypes: spans
      .filter(s => s.name.startsWith('invoke_agent ') && s.name !== 'invoke_agent claude')
      .map(s => s.name.slice('invoke_agent '.length)),
    isAborted: input.isAborted,
    durationMs: input.durationMs,
  }
}

// Bookkeeping for a prompt the person sent: remembered for the turn it starts.
export async function recordPrompt($: Engine, e: { text: string; command?: unknown; isMeta?: boolean }): Promise<void> {
  if (!e.command && !e.isMeta) {
    await update($, captureState, s => ({ ...s, pendingPrompt: e.text }))
  }
}

// Bookkeeping when a turn (the main loop's or a subagent's) starts.
export async function openTurn($: Engine, cfg: Config, e: { text: string; turnId: string; agentId?: string }): Promise<void> {
  const sid = await $.session.id()
  const s = await read($, captureState)

  if (e.agentId) {
    const spawn = s.agentSpawns[e.agentId]
    if (s.main && spawn) {
      const turn = TurnSpans.from(s.main)
      const root = turn.open(
        `invoke_agent ${spawn.subagentType}`,
        'INTERNAL',
        spawn.parentSpanId,
        agentAttrs(sid, { id: e.agentId, name: spawn.subagentType }),
        now(),
      )
      await update($, captureState, cur => ({
        ...cur,
        main: turn.toJSON(),
        turnRoots: { ...cur.turnRoots, [e.turnId]: root },
        agentRoots: { ...cur.agentRoots, [e.agentId as string]: root },
      }))
    }
    return
  }

  if (s.main) {
    await finishMain(
      $,
      cfg,
      { status: 'ERROR', message: 'turn not completed', answer: '', durationMs: 0, isAborted: true, closeOpenWith: 'turn not completed' },
      listeners,
    )
  }

  const turn = new TurnSpans(e.turnId, sid, now())
  const root = turn.open(
    'invoke_agent claude',
    'INTERNAL',
    null,
    { ...agentAttrs(sid), ...userMessage(s.pendingPrompt) },
    now(),
  )
  await update($, captureState, cur => ({
    ...cur,
    main: turn.toJSON(),
    mainTurnId: e.turnId,
    turnRoots: { [e.turnId]: root },
    agentRoots: {},
    agentSpawns: {},
    toolCalls: {},
    lastClosed: null,
  }))
  return
}

// Bookkeeping when a turn ends: closes its spans, writes its file, notifies listeners.
export async function closeTurn($: Engine, cfg: Config, e: { turnId: string; agentId?: string; answer: string; durationMs: number; isAborted: boolean }): Promise<ClosedTurn | null> {
  const s = await read($, captureState)

  if (e.agentId) {
    const root = s.turnRoots[e.turnId]
    if (root) {
      await withMain($, turn => {
        turn.set(root, { 'gen_ai.output.messages': assistantMessage(e.answer) })
        turn.close(root, now(), e.isAborted ? { code: 'ERROR', message: 'aborted' } : { code: 'OK' })
      })
    }
    return null
  }

  if (s.mainTurnId === e.turnId) {
    return finishMain(
      $,
      cfg,
      {
        status: e.isAborted ? 'ERROR' : 'OK',
        message: e.isAborted ? 'aborted' : undefined,
        answer: e.answer,
        durationMs: e.durationMs,
        isAborted: e.isAborted,
        closeOpenWith: e.isAborted ? 'aborted' : 'unfinished',
      },
      listeners,
    )
  }
  return

  return null
}

export function registerCapture(on: On, cfg: Config): void {
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.agentId) {
      await update($, captureState, s => ({
        ...s,
        agentSpawns: {
          ...s.agentSpawns,
          [result.agentId as string]: {
            parentSpanId: s.toolCalls[e.tool_use_id] ?? null,
            subagentType: e.subagentType,
          },
        },
      }))
    }
    return result
  }).catch(fallThrough)

  // A generator hook: its own bookkeeping is guarded, so a failure there never changes the step.
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    let spanId: string | null = null
    try {
      const s = await read($, captureState)
      const parent = s.turnRoots[e.turnId]
      if (s.main && parent) {
        const turn = TurnSpans.from(s.main)
        spanId = turn.open(`chat ${e.model}`, 'CLIENT', parent, chatAttrs(e.model), now())
        await update($, captureState, cur => ({ ...cur, main: turn.toJSON() }))
      }
    } catch {
      spanId = null
    }

    for await (const chunk of stream) yield chunk
    const result = await stream.result

    try {
      if (spanId) {
        const open = spanId
        await withMain($, turn => {
          turn.set(open, {
            ...usageAttrs(result.usage),
            'gen_ai.response.finish_reasons': [result.stopReason],
            'gen_ai.output.messages': assistantMessage(result.answer, result.toolUses),
          })
          turn.close(open, now())
        })
      }
    } catch {
      // Bookkeeping never changes the step.
    }
    return result
  })

  on('tool.call', async ($, e, next) => {
    const event = e as unknown as Record<string, unknown>
    const s = await read($, captureState)
    const parent = e.agentId
      ? s.agentRoots[e.agentId]
      : s.mainTurnId
        ? s.turnRoots[s.mainTurnId]
        : undefined
    let spanId: string | null = null

    if (s.main) {
      const turn = TurnSpans.from(s.main)
      spanId = turn.open(
        `execute_tool ${e.tool}`,
        'INTERNAL',
        parent ?? null,
        toolAttrs(e.tool, e.tool_use_id, argsOf(event)),
        now(),
      )
      const opened = spanId
      await update($, captureState, cur => ({
        ...cur,
        main: turn.toJSON(),
        toolCalls: { ...cur.toolCalls, [e.tool_use_id]: opened },
      }))
    }

    const result = await next(e)

    if (spanId) {
      const open = spanId
      await withMain($, turn => {
        if (result.deny !== undefined) {
          turn.close(open, now(), { code: 'ERROR', message: result.deny })
        } else {
          turn.set(open, toolResultAttrs(result.text ?? result.result))
          turn.close(open, now(), result.isError ? { code: 'ERROR' } : { code: 'OK' })
        }
      })
    }
    return result
  }).catch(fallThrough)

  on('session.end', async ($, e, next) => {
    const s = await read($, captureState)
    if (s.main) {
      await finishMain(
        $,
        cfg,
        { status: 'ERROR', message: 'session ended', answer: '', durationMs: 0, isAborted: true, closeOpenWith: 'session ended' },
        listeners,
      )
    }
    return next(e)
  }).catch(fallThrough)
}

// Adds a closed span to a turn: the open main turn, or the closed turn kept for a later note.
// Writes the turn's file again, with the same sequence number.
export async function addSpan(
  $: Engine,
  cfg: Config,
  turnId: string,
  name: string,
  attributes: Record<string, unknown>,
): Promise<boolean> {
  const s = await read($, captureState)
  const sid = await $.session.id()
  const at = now()

  if (s.main && s.mainTurnId === turnId) {
    const turn = TurnSpans.from(s.main)
    const parent = s.turnRoots[turnId] ?? null
    const spanId = turn.open(name, 'INTERNAL', parent, attributes, at)
    turn.close(spanId, at)
    await update($, captureState, cur => ({ ...cur, main: turn.toJSON() }))
    return true
  }

  if (s.lastClosed && s.lastClosed.turnId === turnId) {
    const turn = TurnSpans.from(s.lastClosed.turn)
    const spanId = turn.open(name, 'INTERNAL', s.lastClosed.root, attributes, at)
    turn.close(spanId, at)
    await update($, captureState, cur => ({
      ...cur,
      lastClosed: cur.lastClosed ? { ...cur.lastClosed, turn: turn.toJSON() } : null,
    }))
    return writeTurn(sinkIo($), cfg, sid, s.lastClosed.seq, turnId, turn.finished())
  }
  return false
}
