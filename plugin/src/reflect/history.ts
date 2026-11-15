import type { EngineInterface as Engine } from 'claude-code'

import type { Assessment, Span } from '../../types'
import { techniqueLabel } from '../mentor/rubric'
import type { Config } from '../shared/config'
import { readIo, readTraceFiles, toTurnRecord } from './read'
import type { TraceFile } from './read'

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

// A single self-contained page: no network, no external scripts. All text is set with textContent.
export function historyHtml(turns: HistoryTurn[], generatedMs: number, scopeLabel: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Handhold trace history</title>
<style>
:root {
  --bg: #f7f6f3; --panel: #ffffff; --ink: #1d1c1a; --muted: #6b6862; --line: #e4e1da;
  --accent: #b4532a; --low: #c2410c; --mid: #a16207; --high: #15803d; --chip: #f0ede6;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #161513; --panel: #1f1e1b; --ink: #ecebe7; --muted: #a09d96; --line: #34322e;
    --accent: #e08a5f; --low: #fb923c; --mid: #facc15; --high: #4ade80; --chip: #2a2925; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.5 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.01em; }
.sub { color: var(--muted); margin: 0 0 24px; font-size: 13px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 20px; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.stat b { display: block; font-size: 22px; font-variant-numeric: tabular-nums; }
.stat span { color: var(--muted); font-size: 12px; }
.strip { display: flex; align-items: flex-end; gap: 2px; height: 40px; margin: 4px 0 24px; }
.strip:empty { display: none; }
.strip i { flex: 1; max-width: 18px; background: var(--accent); opacity: .75; border-radius: 2px 2px 0 0; min-height: 1px; }
.controls { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
input, select { font: inherit; color: var(--ink); background: var(--panel); border: 1px solid var(--line);
  border-radius: 8px; padding: 7px 10px; }
input { flex: 1; min-width: 180px; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 28px 0 8px; }
details { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; margin-bottom: 8px; }
summary { list-style: none; cursor: pointer; padding: 12px 14px; display: grid;
  grid-template-columns: 56px 1fr auto; gap: 12px; align-items: start; }
summary::-webkit-details-marker { display: none; }
.time { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; padding-top: 1px; }
.prompt { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
.meta { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.chip { font-size: 12px; background: var(--chip); border-radius: 6px; padding: 2px 7px; white-space: nowrap;
  font-variant-numeric: tabular-nums; color: var(--muted); }
.s0, .s1 { color: var(--low); } .s2 { color: var(--mid); } .s3 { color: var(--high); }
.body { padding: 0 14px 14px; border-top: 1px solid var(--line); }
.body h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 14px 0 4px; }
.body pre { white-space: pre-wrap; word-break: break-word; margin: 0; font: 13px/1.5 ui-monospace, Menlo, monospace;
  background: var(--bg); border-radius: 8px; padding: 10px; max-height: 360px; overflow: auto; }
.rewrite { border-left: 3px solid var(--accent); padding: 4px 0 4px 10px; margin: 0; }
.empty { color: var(--muted); text-align: center; padding: 48px 0; }
@media (max-width: 560px) { summary { grid-template-columns: 1fr; gap: 4px; } .meta { justify-content: flex-start; } }
</style>
</head>
<body>
<main>
  <h1>Trace history</h1>
  <p class="sub" id="sub"></p>
  <div class="stats" id="stats"></div>
  <div class="strip" id="strip" title="Turns per day"></div>
  <div class="controls">
    <input id="q" type="search" placeholder="Search prompts and answers">
    <select id="f">
      <option value="all">All turns</option>
      <option value="scored">Scored</option>
      <option value="low">Low scores (a 0 or 1)</option>
      <option value="unscored">Not scored yet</option>
    </select>
  </div>
  <div id="list"></div>
</main>
<script id="data" type="application/json">${embedJson(turns)}</script>
<script>
const turns = JSON.parse(document.getElementById('data').textContent);
const GENERATED = ${generatedMs};
const SCOPE = ${embedJson(scopeLabel)};
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const fmtK = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
const fmtDur = ms => ms < 1000 ? ms + ' ms' : ms < 60000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms / 60000) + ' min';
const day = ms => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const hm = ms => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const scored = turns.filter(t => t.assess && t.assess.warranted);
const avg = d => scored.length ? (scored.reduce((s, t) => s + t.assess.scores[d], 0) / scored.length).toFixed(1) : '–';

document.getElementById('sub').textContent = SCOPE + ' · generated ' + new Date(GENERATED).toLocaleString() +
  ' · scores come from /handhold review';
const stats = [
  [turns.length, 'turns'], [new Set(turns.map(t => t.sessionId)).size, 'sessions'],
  [fmtK(turns.reduce((s, t) => s + t.inputTokens + t.outputTokens, 0)), 'tokens recorded'],
  [scored.length, 'scored turns'], [avg('altitude') + ' · ' + avg('depth') + ' · ' + avg('range'), 'altitude · depth · range (0–3)'],
];
for (const [v, l] of stats) { const s = el('div', 'stat'); s.append(el('b', null, String(v)), el('span', null, l)); document.getElementById('stats').append(s); }

const perDay = new Map();
for (const t of turns) { const k = new Date(t.startMs).toDateString(); perDay.set(k, (perDay.get(k) || 0) + 1); }
const days = []; if (turns.length) { const first = new Date(Math.min(...turns.map(t => t.startMs))); first.setHours(0,0,0,0);
  for (let d = new Date(first); d <= new Date(GENERATED); d.setDate(d.getDate() + 1)) days.push([d.toDateString(), perDay.get(d.toDateString()) || 0]); }
const peak = Math.max(1, ...days.map(d => d[1]));
if (days.length > 1) for (const [k, n] of days.slice(-90)) { const b = el('i'); b.style.height = (n / peak * 100) + '%'; b.title = k + ': ' + n + ' turns'; document.getElementById('strip').append(b); }

function turnNode(t) {
  const d = el('details');
  const s = el('summary');
  s.append(el('span', 'time', hm(t.startMs)), el('span', 'prompt', t.prompt || '(empty prompt)'));
  const meta = el('span', 'meta');
  if (t.assess && t.assess.warranted) for (const [k, d2] of [['A', 'altitude'], ['D', 'depth'], ['R', 'range']])
    meta.append(el('span', 'chip s' + t.assess.scores[d2], k + ' ' + t.assess.scores[d2]));
  else if (t.assess) meta.append(el('span', 'chip', 'not warranted'));
  if (t.tools.length) meta.append(el('span', 'chip', t.tools.length + ' tools'));
  if (t.inputTokens + t.outputTokens) meta.append(el('span', 'chip', fmtK(t.inputTokens + t.outputTokens) + ' tok'));
  if (t.aborted) meta.append(el('span', 'chip s0', 'aborted'));
  s.append(meta); d.append(s);
  d.addEventListener('toggle', () => { if (!d.open || d.dataset.built) return; d.dataset.built = '1';
    const b = el('div', 'body');
    const sec = (h, text) => { b.append(el('h3', null, h), el('pre', null, text)); };
    sec('Prompt', t.prompt); if (t.answer) sec('Answer', t.answer);
    const facts = [fmtDur(t.durationMs), t.models.join(', '), fmtK(t.inputTokens) + ' in / ' + fmtK(t.outputTokens) + ' out'].filter(Boolean);
    if (t.agents.length) facts.push('subagents: ' + t.agents.join(', '));
    b.append(el('h3', null, 'Turn'), el('p', null, facts.join(' · ')));
    if (t.tools.length) { const counts = {}; for (const x of t.tools) counts[x.name] = (counts[x.name] || 0) + 1;
      b.append(el('h3', null, 'Tools'), el('p', null, Object.entries(counts).map(([n, c]) => c > 1 ? n + ' ×' + c : n).join(', '))); }
    if (t.assess && t.assess.warranted) { const a = t.assess;
      b.append(el('h3', null, 'Coaching · ' + a.techniqueLabel));
      for (const dname of ['altitude', 'depth', 'range']) if (a.evidence[dname])
        b.append(el('p', null, dname[0].toUpperCase() + dname.slice(1) + ' ' + a.scores[dname] + ': ' + a.evidence[dname]));
      if (a.nudge) b.append(el('p', null, a.nudge));
      if (a.rewrite) b.append(el('h3', null, 'Try instead'), el('p', 'rewrite', a.rewrite)); }
    d.append(b); });
  return d;
}

function render() {
  const q = document.getElementById('q').value.toLowerCase();
  const f = document.getElementById('f').value;
  const list = document.getElementById('list'); list.replaceChildren();
  const shown = turns.filter(t => {
    if (q && !(t.prompt + '\\n' + t.answer).toLowerCase().includes(q)) return false;
    if (f === 'scored') return t.assess && t.assess.warranted;
    if (f === 'unscored') return !t.assess;
    if (f === 'low') return t.assess && t.assess.warranted && Math.min(t.assess.scores.altitude, t.assess.scores.depth, t.assess.scores.range) <= 1;
    return true;
  }).sort((a, b) => b.startMs - a.startMs);
  if (!shown.length) { list.append(el('p', 'empty', turns.length ? 'No turns match.' : 'No turns recorded yet.')); return; }
  let current = '';
  for (const t of shown) { const k = day(t.startMs); if (k !== current) { current = k; list.append(el('h2', null, k)); } list.append(turnNode(t)); }
}
document.getElementById('q').addEventListener('input', render);
document.getElementById('f').addEventListener('change', render);
render();
</script>
</body>
</html>
`
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
export async function historyCmd($: Engine, cfg: Config, args: string): Promise<{ text: string }> {
  const word = args.trim().split(/\s+/)[0] || 'month'
  const now = Date.now()
  const scope =
    word === 'session'
      ? { sessionId: await $.session.id() }
      : { sinceMs: word === 'all' ? 0 : now - (word === 'week' ? 7 : 30) * DAY_MS }
  const label = word === 'session' ? 'This session' : word === 'all' ? 'All time' : word === 'week' ? 'Last 7 days' : 'Last 30 days'

  const files = await readTraceFiles(readIo($), cfg, scope)
  const turns = files.map(historyTurn).filter((t): t is HistoryTurn => t !== null)

  const home = (await $.env.get('HOME')) ?? ''
  const path = `${home}/.handhold/history.html`
  await $.fs.write(path, historyHtml(turns, now, label))
  const opened = await openInBrowser($, path)
  const unscored = turns.filter(t => !t.assess).length
  const hint = unscored > 0 ? ` ${unscored} not scored yet: /handhold review scores them.` : ''
  return { text: `${opened ? 'Opened' : 'Wrote'} ${path} (${turns.length} turns, ${label.toLowerCase()}).${hint}` }
}
