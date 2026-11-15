// Drives the built server over stdio, as the desktop app does, against a temporary trace folder.
// Run with `npm test` (it builds first).
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

const SERVER = new URL('../dist/server.mjs', import.meta.url).pathname
const NOW = Date.now()
const SUBSTANTIVE = 'Plan the launch of our new onboarding flow and tell me how we will know it worked'

const root = (prompt, minutesAgo) => {
  const ns = `${BigInt(NOW - minutesAgo * 60000) * 1000000n}`
  return {
    traceId: 'a'.repeat(32), spanId: `${minutesAgo}`.padStart(16, '0'), parentSpanId: null,
    name: 'invoke_agent claude', kind: 'INTERNAL', startTimeUnixNano: ns, endTimeUnixNano: ns, status: { code: 'OK' },
    attributes: {
      'gen_ai.input.messages': [{ role: 'user', parts: [{ type: 'text', content: prompt }] }],
      'gen_ai.output.messages': [{ role: 'assistant', parts: [{ type: 'text', content: 'done' }] }],
    },
  }
}
const assessSpan = {
  traceId: 'a'.repeat(32), spanId: 'f'.repeat(16), parentSpanId: null, name: 'handhold.assess', kind: 'INTERNAL',
  startTimeUnixNano: '0', endTimeUnixNano: '0', status: { code: 'OK' },
  attributes: {
    'handhold.judge.phase': 'review', 'handhold.warranted': true,
    'handhold.score.altitude': 1, 'handhold.score.depth': 0, 'handhold.score.range': 0,
    'handhold.opportunity': 'depth', 'handhold.technique': 'outside-judge',
    'handhold.nudge': 'Ask for a check.', 'handhold.rewrite': 'Write the report, then have a sceptic check it.',
  },
}
const valid = id => ({
  id, warranted: true, scores: { altitude: 2, depth: 1, range: 0 },
  evidence: { altitude: 'states the goal', depth: 'no method', range: 'one field' },
  opportunity: 'range', technique: 'assemble-the-crew', nudge: 'Bring in a sceptic.', rewrite: 'Plan it with a sceptic.',
})

let dir, server, nextId = 0
const waits = new Map()
const call = (method, params) => new Promise(resolve => {
  const id = ++nextId
  waits.set(id, resolve)
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})
const tool = async (name, args) => {
  const r = await call('tools/call', { name, arguments: args })
  assert.equal(r.error, undefined, JSON.stringify(r.error))
  return r.result
}
const lines = file => readFileSync(join(dir, 's1', file), 'utf8').trim().split('\n').map(l => JSON.parse(l))

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'handhold-mcp-'))
  mkdirSync(join(dir, 's1'))
  mkdirSync(join(dir, 'gone'))
  const write = (session, file, spans) => writeFileSync(join(dir, session, file), spans.map(s => JSON.stringify(s)).join('\n') + '\n')
  write('s1', '00001-t1.jsonl', [root('merge it', 40)])
  write('s1', '00002-t2.jsonl', [root(SUBSTANTIVE, 30)])
  write('s1', '00003-t3.jsonl', [root(`  ${SUBSTANTIVE.toUpperCase()} `, 20)])
  write('s1', '00004-t4.jsonl', [root('Write the quarterly report for the board from the sales data', 10), assessSpan])
  write('gone', '00001-x.jsonl', [root('A forgotten test run that should never be shown anywhere', 5)])
  writeFileSync(join(dir, 'forgotten.json'), JSON.stringify({ sessions: ['gone'], turns: [] }))

  server = spawn(process.execPath, [SERVER], { env: { ...process.env, HANDHOLD_TRACE_ROOT: dir }, stdio: ['pipe', 'pipe', 'inherit'] })
  let buf = ''
  server.stdout.on('data', d => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (line.trim()) { const m = JSON.parse(line); waits.get(m.id)?.(m) }
    }
  })
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
})

after(() => {
  server?.kill()
  rmSync(dir, { recursive: true, force: true })
})

test('lists the three tools, and the history tool links its panel', async () => {
  const { tools } = (await call('tools/list', {})).result
  assert.deepEqual(tools.map(t => t.name).sort(), ['handhold_history', 'handhold_review_data', 'handhold_save_scores'])
  assert.equal(tools.find(t => t.name === 'handhold_history')._meta.ui.resourceUri, 'ui://handhold/history.html')
})

test('the panel resource is an MCP App with its client inlined', async () => {
  const { contents } = (await call('resources/read', { uri: 'ui://handhold/history.html' })).result
  assert.equal(contents[0].mimeType, 'text/html;profile=mcp-app')
  assert.ok(contents[0].text.includes('window.McpApps={'))
  assert.equal(contents[0].text.match(/<\/script>/g).length, 1)
})

test('history marks chores as quick, skips forgotten sessions, and sums up in text', async () => {
  const r = await tool('handhold_history', { range: 'all' })
  const status = Object.fromEntries(r.structuredContent.turns.map(t => [t.prompt.slice(0, 12), t.status]))
  assert.equal(status['merge it'], 'quick')
  assert.equal(status['Write the qu'], 'coached')
  assert.equal(r.structuredContent.turns.length, 4)
  assert.ok(!JSON.stringify(r).includes('forgotten test run'))
  assert.match(r.content[0].text, /4 turns \(1 scored, 1 quick, 2 waiting for a review\)/)
})

test('review asks for scores first, once per distinct request, then saves them and writes the review', async () => {
  const ask = (await tool('handhold_review_data', { range: 'all' })).content[0].text
  assert.match(ask, /1 turn in all time has not been scored/)
  assert.match(ask, /handhold_save_scores/)
  const pending = JSON.parse(ask.slice(ask.indexOf('Turns to score:\n') + 'Turns to score:\n'.length))
  assert.deepEqual(pending.map(p => p.id), ['s1/00003-t3.jsonl'])

  const bad = (await tool('handhold_save_scores', { scores: [{ ...valid('s1/00003-t3.jsonl'), technique: 'vibes' }, valid('../../etc/passwd')] })).content[0].text
  assert.match(bad, /Saved 0 scores/)
  assert.match(bad, /does not match the rubric's shape/)
  assert.match(bad, /no such turn/)

  const ok = (await tool('handhold_save_scores', { scores: [valid('s1/00003-t3.jsonl')] })).content[0].text
  assert.match(ok, /Saved 1 score\./)
  // Both copies of the repeated request carry the score, in the plugin's review-span format.
  for (const f of ['00002-t2.jsonl', '00003-t3.jsonl']) {
    const span = lines(f).find(s => s.name === 'handhold.assess')
    assert.equal(span.attributes['handhold.judge.phase'], 'review')
    assert.equal(span.attributes['handhold.technique'], 'assemble-the-crew')
  }
  assert.match((await tool('handhold_save_scores', { scores: [valid('s1/00003-t3.jsonl')] })).content[0].text, /already scored/)

  const review = (await tool('handhold_review_data', { range: 'all' })).content[0].text
  assert.match(review, /^Write the person a short review/)
  const data = JSON.parse(review.slice(review.indexOf('{')))
  assert.equal(data.worthCoaching, 2)
  assert.ok(data.missedMost.some(m => m.habit === 'Bring in people from other fields'))
})
