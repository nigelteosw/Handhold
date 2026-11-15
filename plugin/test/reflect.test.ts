import { expect, test } from 'claude-code/testing'

import type { Assessment, Technique } from '../types'
import { aggregate, readTurns } from '../src/reflect/read'
import type { ReadIo, TurnRecord } from '../src/reflect/read'
import { defaultConfig } from './helpers'

const assessment = (
  scores: [number, number, number],
  technique: Technique,
  warranted = true,
): Assessment => ({
  warranted,
  scores: { altitude: scores[0], depth: scores[1], range: scores[2] } as Assessment['scores'],
  evidence: { altitude: '', depth: '', range: '' },
  opportunity: 'altitude',
  technique,
  nudge: 'n',
  rewrite: 'the more ambitious version',
})

const turn = (id: string, a: Assessment): TurnRecord => ({
  sessionId: 's1',
  turnId: id,
  startMs: Number(id.replace(/\D/g, '')),
  prompt: `prompt ${id}`,
  assess: { post: a },
})

test('aggregate averages the warranted turns and counts missed techniques', () => {
  const agg = aggregate([
    turn('1', assessment([1, 0, 0], 'goal-beyond-the-goal')),
    turn('2', assessment([1, 1, 0], 'goal-beyond-the-goal')),
    turn('3', assessment([3, 2, 2], 'challenge-assumptions')),
    turn('4', assessment([0, 0, 0], 'goal-beyond-the-goal', false)),
  ])

  expect(agg.turns).toBe(4)
  expect(agg.warranted).toBe(3)
  expect(Math.abs(agg.avg.altitude - 5 / 3) < 0.001).toBe(true)
  expect(agg.avg.depth).toBe(1)
  expect(agg.missed[0]).toEqual({ technique: 'goal-beyond-the-goal', count: 2 })
})

test('readTurns skips a damaged line and keeps the rest of the file', async () => {
  const root = JSON.stringify({
    name: 'invoke_agent claude',
    startTimeUnixNano: '1000000000000',
    attributes: { 'gen_ai.input.messages': [{ role: 'user', parts: [{ type: 'text', content: 'hi there' }] }] },
  })
  const io: ReadIo = {
    home: async () => '/home/t',
    list: async () => [{ name: '00001-t1.jsonl', kind: 'file', mtimeMs: 0 }],
    read: async () => `${root}\nnot json{\n`,
  }

  const turns = await readTurns(io, defaultConfig, { sessionId: 's1' })

  expect(turns.length).toBe(1)
  expect(turns[0].prompt).toBe('hi there')
  expect(turns[0].turnId).toBe('t1')
})

test('review with no traces says so', async ($, on) => {
  on('env.get', () => ({ value: '/home/t' }))
  on('session.id', () => ({ value: 's1' }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))

  const r = (await $.command.run({ command: 'handhold', args: 'review', origin: { kind: 'composer' } } as never)) as {
    text: string
  }

  expect(r.text).toBe('No turns recorded yet.')
})

test('review falls back to plain text when the model fails', async ($, on) => {
  const root = JSON.stringify({
    name: 'invoke_agent claude',
    startTimeUnixNano: '1000000000000',
    attributes: { 'gen_ai.input.messages': [{ role: 'user', parts: [{ type: 'text', content: 'qbr' }] }] },
  })
  const assess = JSON.stringify({
    name: 'handhold.assess',
    startTimeUnixNano: '1000000000000',
    attributes: {
      'handhold.judge.phase': 'post',
      'handhold.warranted': true,
      'handhold.score.altitude': 1,
      'handhold.score.depth': 0,
      'handhold.score.range': 0,
      'handhold.opportunity': 'altitude',
      'handhold.technique': 'goal-beyond-the-goal',
      'handhold.rewrite': 'the three decisions',
    },
  })
  const file = `${root}\n${assess}\n`

  on('env.get', () => ({ value: '/home/t' }))
  on('session.id', () => ({ value: 's1' }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.list', () => ({
    value: [{ name: '00001-t1.jsonl', kind: 'file', size: 0, mtimeMs: 0, isLink: false }],
  }))
  on('fs.read', () => ({ value: file }))
  on('model.complete', () => {
    throw new Error('timeout')
  })

  const r = (await $.command.run({ command: 'handhold', args: 'review', origin: { kind: 'composer' } } as never)) as {
    text: string
  }

  expect(r.text).toContain('Altitude')
})
