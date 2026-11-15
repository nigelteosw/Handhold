// The /handhold history page: one self-contained file with no network access. It renders the snapshot
// embedded in it, then reloads the sibling history-data.js every few seconds, which the plugin rewrites
// after each turn and each review, so new turns and fresh scores appear without a reload.
// Every piece of trace text reaches the DOM through textContent, never as markup.

export const DATA_FILE = 'history-data.js'
export const DATA_CALLBACK = 'handholdHistory'

const STYLE = `
:root {
  color-scheme: light;
  --bg: #f6f5f2; --panel: #ffffff; --panel-2: #fbfaf8; --ink: #1c1b19; --ink-2: #4a4843; --muted: #75726b;
  --line: #e6e3dc; --line-2: #d8d4cb; --accent: #b4532a; --accent-soft: #f6e7df; --bar: #c9693f;
  --good: #1f7a3d; --good-soft: #e3f2e7; --warn: #8a5a00; --warn-soft: #fbf0d6; --bad: #b4321e; --bad-soft: #fbe5e1;
  --shadow: 0 1px 2px rgba(28, 27, 25, .05), 0 1px 1px rgba(28, 27, 25, .03);
  --shadow-lg: 0 10px 30px rgba(28, 27, 25, .12);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #141412; --panel: #1d1c1a; --panel-2: #22211e; --ink: #eceae5; --ink-2: #c5c2bb; --muted: #9b978f;
    --line: #2f2d29; --line-2: #3d3a35; --accent: #e8915f; --accent-soft: #3a261b; --bar: #d9805a;
    --good: #5fd08a; --good-soft: #1c3324; --warn: #f0c056; --warn-soft: #3a2f14; --bad: #ff8a75; --bad-soft: #3d1f1a;
    --shadow: 0 1px 2px rgba(0, 0, 0, .3); --shadow-lg: 0 10px 30px rgba(0, 0, 0, .5);
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 14.5px/1.55 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; }
main { max-width: 1040px; margin: 0 auto; padding: 28px 16px 96px; }
button { font: inherit; color: inherit; }
.num { font-variant-numeric: tabular-nums; }

/* Header */
.top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 22px; }
.brand { display: flex; gap: 12px; align-items: center; }
.logo { width: 36px; height: 36px; border-radius: 10px; background: var(--accent); color: #fff; display: grid; place-items: center;
  font-weight: 700; font-size: 17px; letter-spacing: -.02em; box-shadow: var(--shadow); flex: none; }
h1 { font-size: 21px; line-height: 1.2; margin: 0; letter-spacing: -.015em; }
.sub { color: var(--muted); font-size: 13px; margin-top: 2px; }
.live { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 10px; border-radius: 999px;
  background: var(--panel); border: 1px solid var(--line); font-size: 12.5px; color: var(--ink-2); box-shadow: var(--shadow); white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); position: relative; flex: none; }
.live[data-state="live"] .dot { background: var(--good); }
.live[data-state="live"] .dot::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid var(--good);
  opacity: 0; animation: ping 2.4s ease-out infinite; }
.live[data-state="offline"] .dot { background: var(--warn); }
.live[data-state="pulse"] .dot { background: var(--accent); transform: scale(1.3); transition: transform .2s; }
@keyframes ping { 0% { transform: scale(.6); opacity: .7; } 80%, 100% { transform: scale(1.6); opacity: 0; } }

/* Cards */
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
.kpi { padding: 14px 16px 13px; min-width: 0; }
.kpi .label { font-size: 12px; color: var(--muted); font-weight: 500; }
.kpi .value { font-size: 26px; font-weight: 650; letter-spacing: -.02em; line-height: 1.25; margin-top: 2px; transition: color .6s; }
.kpi .value.bump { color: var(--accent); transition: none; }
.kpi .foot { font-size: 12px; color: var(--muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meter { height: 4px; border-radius: 4px; background: var(--line); margin-top: 8px; overflow: hidden; }
.meter i { display: block; height: 100%; background: var(--accent); border-radius: 4px; transition: width .5s ease; }
.panels { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 12px; margin-bottom: 28px; }
.panel { padding: 16px; min-width: 0; }
.panel h2 { font-size: 13px; font-weight: 600; margin: 0 0 12px; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.panel h2 span { font-weight: 400; color: var(--muted); font-size: 12px; }
.dim { display: grid; grid-template-columns: 70px 1fr 64px; align-items: center; gap: 10px; padding: 6px 0; }
.dim .name { font-size: 13px; color: var(--ink-2); }
.dim .track { height: 8px; border-radius: 8px; background: var(--line); position: relative; overflow: hidden; }
.dim .track i { position: absolute; inset: 0 auto 0 0; border-radius: 8px; background: var(--accent); transition: width .5s ease; }
.dim .score { text-align: right; font-size: 13px; }
.dim .score b { font-size: 16px; font-weight: 650; }
.dim .score span { color: var(--muted); }
.panel .note { color: var(--muted); font-size: 12.5px; margin: 10px 0 0; }
.panel .empty-note { color: var(--muted); font-size: 13px; padding: 18px 0 8px; }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--panel-2); border: 1px solid var(--line);
  border-radius: 5px; padding: 1px 5px; }

/* Activity chart: one series, turns per day */
.chart { display: flex; align-items: flex-end; gap: 2px; height: 96px; border-bottom: 1px solid var(--line-2); }
.chart button { flex: 1; height: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; display: flex;
  align-items: flex-end; border-radius: 4px 4px 0 0; min-width: 0; }
.chart button i { display: block; width: 100%; background: var(--bar); border-radius: 4px 4px 0 0; min-height: 0;
  transition: height .4s ease, opacity .2s; opacity: .85; }
.chart button.zero i { background: var(--line-2); height: 2px !important; border-radius: 1px; opacity: 1; }
.chart button:hover i, .chart button:focus-visible i { opacity: 1; }
.chart button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.chart.has-pick button:not(.picked) i { opacity: .3; }
.axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 6px; }

/* Toolbar */
.toolbar { position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
  padding: 10px 0; margin-bottom: 4px; background: var(--bg); }
.toolbar.stuck { box-shadow: 0 8px 12px -12px rgba(0, 0, 0, .35); }
.search { flex: 1 1 240px; position: relative; min-width: 0; }
.search input { width: 100%; font: inherit; color: var(--ink); background: var(--panel); border: 1px solid var(--line);
  border-radius: 10px; padding: 8px 40px 8px 12px; outline: none; transition: border-color .15s, box-shadow .15s; }
.search input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.search kbd { position: absolute; right: 9px; top: 50%; transform: translateY(-50%); font: 11px ui-monospace, Menlo, monospace;
  color: var(--muted); border: 1px solid var(--line-2); border-radius: 5px; padding: 1px 6px; background: var(--panel-2); }
.seg { display: inline-flex; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 3px; gap: 2px; flex-wrap: wrap; }
.seg button { border: 0; background: transparent; padding: 5px 10px; border-radius: 7px; cursor: pointer; font-size: 13px;
  color: var(--ink-2); display: inline-flex; gap: 6px; align-items: center; }
.seg button:hover { background: var(--panel-2); }
.seg button[aria-pressed="true"] { background: var(--ink); color: var(--bg); }
.seg button .n { font-size: 11.5px; opacity: .65; }
select { font: inherit; font-size: 13px; color: var(--ink); background: var(--panel); border: 1px solid var(--line);
  border-radius: 10px; padding: 7px 10px; cursor: pointer; }
.pick { display: none; align-items: center; gap: 6px; font-size: 12.5px; background: var(--accent-soft); color: var(--accent);
  border: 0; border-radius: 999px; padding: 5px 10px; cursor: pointer; }
.pick.on { display: inline-flex; }

/* Turn list */
.day { display: flex; justify-content: space-between; align-items: baseline; margin: 22px 2px 8px; font-size: 12.5px; }
.day b { font-weight: 600; color: var(--ink-2); }
.day span { color: var(--muted); }
.turn { margin-bottom: 8px; overflow: hidden; transition: border-color .2s, box-shadow .2s; }
.turn:hover { border-color: var(--line-2); }
.turn.fresh { animation: arrive 1.6s ease-out; }
@keyframes arrive { 0% { transform: translateY(-6px); opacity: 0; background: var(--accent-soft); } 30% { transform: none; opacity: 1; }
  100% { background: var(--panel); } }
.turn.changed { animation: glow 1.6s ease-out; }
@keyframes glow { 0% { box-shadow: 0 0 0 3px var(--accent-soft); } 100% { box-shadow: var(--shadow); } }
summary { list-style: none; cursor: pointer; padding: 12px 14px; display: grid; grid-template-columns: 52px minmax(0, 1fr) auto;
  gap: 12px; align-items: start; outline: none; }
summary::-webkit-details-marker { display: none; }
summary:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); border-radius: 14px; }
.time { color: var(--muted); font-size: 12.5px; padding-top: 2px; }
.prompt { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
.prompt.blank { color: var(--muted); font-style: italic; }
details[open] .prompt { -webkit-line-clamp: 4; }
.facts { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 4px; font-size: 12px; color: var(--muted); }
.tag { font-size: 11px; font-weight: 600; border-radius: 5px; padding: 0 6px; line-height: 18px; }
.tag.new { background: var(--accent); color: #fff; }
.tag.bad { background: var(--bad-soft); color: var(--bad); }
.scores { display: flex; gap: 4px; align-items: center; padding-top: 1px; }
.pill { font-size: 12px; font-weight: 600; border-radius: 7px; padding: 1px 8px; line-height: 20px; white-space: nowrap; }
.pill.s0, .pill.s1 { background: var(--bad-soft); color: var(--bad); }
.pill.s2 { background: var(--warn-soft); color: var(--warn); }
.pill.s3 { background: var(--good-soft); color: var(--good); }
.pill.mute { background: transparent; border: 1px solid var(--line-2); color: var(--muted); font-weight: 500; }
.pill.dash { background: transparent; border: 1px dashed var(--line-2); color: var(--muted); font-weight: 500; }

.body { border-top: 1px solid var(--line); padding: 14px; display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px;
  background: var(--panel-2); }
.body h3 { font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 6px;
  display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
.block { margin-bottom: 14px; }
.block:last-child { margin-bottom: 0; }
.body pre { white-space: pre-wrap; word-break: break-word; margin: 0; font: 12.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; max-height: 380px; overflow: auto; }
.copy { border: 0; background: transparent; color: var(--muted); font-size: 11.5px; cursor: pointer; padding: 2px 6px; border-radius: 5px;
  text-transform: none; letter-spacing: 0; font-weight: 500; }
.copy:hover { background: var(--line); color: var(--ink); }
.coach { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
.coach .technique { font-weight: 600; margin-bottom: 8px; }
.coach .ev { display: grid; grid-template-columns: auto 1fr; gap: 8px; margin: 6px 0; font-size: 13px; color: var(--ink-2); align-items: start; }
.coach .nudge { margin: 10px 0 0; font-size: 13px; }
.rewrite { margin: 0; border-left: 3px solid var(--accent); padding: 6px 10px; background: var(--accent-soft); border-radius: 0 8px 8px 0; font-size: 13px; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-size: 13px; }
dt { color: var(--muted); }
dd { margin: 0; word-break: break-word; }
.tools { display: grid; gap: 4px; font-size: 12.5px; }
.tool { display: grid; grid-template-columns: minmax(0, 120px) 1fr 54px; gap: 8px; align-items: center; }
.tool .tn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool .tb { height: 6px; background: var(--line); border-radius: 6px; overflow: hidden; }
.tool .tb i { display: block; height: 100%; background: var(--bar); border-radius: 6px; min-width: 2px; }
.tool.err .tn { color: var(--bad); }
.tool.err .tb i { background: var(--bad); }
.tool .tm { text-align: right; color: var(--muted); }
.empty { text-align: center; padding: 56px 16px; color: var(--muted); }
.empty b { display: block; color: var(--ink-2); font-size: 15px; margin-bottom: 4px; }

/* Floating bits */
.tip { position: fixed; z-index: 20; pointer-events: none; background: var(--ink); color: var(--bg); font-size: 12px; padding: 6px 9px;
  border-radius: 8px; box-shadow: var(--shadow-lg); opacity: 0; transition: opacity .1s; white-space: nowrap; }
.tip.on { opacity: 1; }
.toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 20px); opacity: 0; pointer-events: none; z-index: 30;
  background: var(--ink); color: var(--bg); border: 0; border-radius: 999px; padding: 9px 16px; font-size: 13px; font-weight: 500;
  box-shadow: var(--shadow-lg); cursor: pointer; transition: opacity .2s, transform .2s; }
.toast.on { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }

@media (max-width: 820px) {
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .panels { grid-template-columns: minmax(0, 1fr); }
  .body { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 560px) {
  summary { grid-template-columns: minmax(0, 1fr); gap: 6px; }
  .time { order: -1; }
  .search { flex-basis: 100%; }
  .seg { flex-wrap: nowrap; overflow-x: auto; max-width: 100%; scrollbar-width: none; }
  .seg button { flex: none; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`

// The page's script. Plain JS with no backticks or template placeholders, since it sits in a template literal.
const SCRIPT = `
(function () {
'use strict';
var DATA_FILE = '${DATA_FILE}';
var POLL_MS = 2000;
var DIMS = [['altitude', 'Altitude', 'A'], ['depth', 'Depth', 'D'], ['range', 'Range', 'R']];
var SORTS = { newest: 'Newest first', oldest: 'Oldest first', tokens: 'Most tokens', longest: 'Longest', lowest: 'Lowest score' };

var byId = function (id) { return document.getElementById(id); };
function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
var fmtK = function (n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n); };
var fmtDur = function (ms) { return ms < 1000 ? ms + ' ms' : ms < 60000 ? (ms / 1000).toFixed(1) + ' s' : ms < 3600000 ? Math.round(ms / 60000) + ' min' : (ms / 3600000).toFixed(1) + ' h'; };
var dayKey = function (ms) { var d = new Date(ms); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
var dayLabel = function (ms) {
  var d = new Date(ms), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
  if (dayKey(ms) === dayKey(today.getTime())) return 'Today';
  if (dayKey(ms) === dayKey(y.getTime())) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};
var shortDay = function (ms) { return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
var hm = function (ms) { return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
var ago = function (ms) {
  var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 5 ? 'just now' : s < 60 ? s + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago';
};
var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };
var model = function (m) { return m.replace(/^claude-/, ''); };
var keyOf = function (t) { return t.sessionId + '/' + t.turnId; };
var isScored = function (t) { return !!(t.assess && t.assess.warranted); };
var minScore = function (t) { return Math.min(t.assess.scores.altitude, t.assess.scores.depth, t.assess.scores.range); };
var isLow = function (t) { return isScored(t) && minScore(t) <= 1; };
var tokensOf = function (t) { return t.inputTokens + t.outputTokens; };
var sigOf = function (t) { return JSON.stringify([t.assess, t.inputTokens, t.outputTokens, t.answer.length, t.tools.length, t.aborted, t.durationMs]); };

var data = JSON.parse(byId('data').textContent);
var state = { q: '', f: 'all', sort: 'newest', day: '' };
try { var saved = JSON.parse(localStorage.getItem('handhold.history') || '{}'); if (SORTS[saved.sort]) state.sort = saved.sort; if (saved.f) state.f = saved.f; } catch (e) {}
var save = function () { try { localStorage.setItem('handhold.history', JSON.stringify({ sort: state.sort, f: state.f })); } catch (e) {} };

var known = new Set(data.turns.map(keyOf));
var fresh = new Set();
var nodes = new Map();
var liveState = 'connecting';
var lastValue = {};

/* Header and live status */
function renderLive() {
  var pill = byId('live');
  pill.dataset.state = liveState;
  var text = liveState === 'offline' ? 'Snapshot · updated ' + ago(data.generatedMs)
    : liveState === 'connecting' ? 'Connecting…' : 'Live · updated ' + ago(data.generatedMs);
  byId('live-text').textContent = text;
  pill.title = liveState === 'offline'
    ? 'This browser blocked reading ' + DATA_FILE + ' next to the page, so it shows the snapshot from ' + new Date(data.generatedMs).toLocaleString() + '. Run /handhold history again to refresh.'
    : 'Updates after every turn and every /handhold review. Data written ' + new Date(data.generatedMs).toLocaleString() + '.';
}
function pulse() {
  liveState = 'pulse'; renderLive();
  setTimeout(function () { if (liveState === 'pulse') { liveState = 'live'; renderLive(); } }, 600);
}

function setValue(node, id, text) {
  node.textContent = text;
  if (lastValue[id] !== undefined && lastValue[id] !== text) { node.classList.add('bump'); setTimeout(function () { node.classList.remove('bump'); }, 50); }
  lastValue[id] = text;
}

function renderHeader() {
  var turns = data.turns;
  var sessions = new Set(turns.map(function (t) { return t.sessionId; })).size;
  byId('sub').textContent = data.scope + ' · ' + plural(turns.length, 'turn') + ' across ' + plural(sessions, 'session');
  document.title = 'Handhold · ' + data.scope + (turns.length ? ' (' + turns.length + ')' : '');

  var tokIn = 0, tokOut = 0, dur = 0, assessed = 0;
  for (var i = 0; i < turns.length; i++) { var t = turns[i]; tokIn += t.inputTokens; tokOut += t.outputTokens; dur += t.durationMs; if (t.assess) assessed++; }
  var kpis = [
    ['turns', 'Turns', String(turns.length), plural(sessions, 'session'), null],
    ['tokens', 'Tokens', fmtK(tokIn + tokOut), fmtK(tokIn) + ' in · ' + fmtK(tokOut) + ' out', null],
    ['time', 'Time in turns', turns.length ? fmtDur(dur) : '–', turns.length ? fmtDur(Math.round(dur / turns.length)) + ' per turn' : 'nothing yet', null],
    ['assessed', 'Assessed', turns.length ? Math.round(assessed / turns.length * 100) + '%' : '–',
      assessed === turns.length ? (turns.length ? 'every turn scored' : 'nothing to score') : (turns.length - assessed) + ' waiting for /handhold review', turns.length ? assessed / turns.length : 0],
  ];
  var box = byId('kpis');
  if (!box.children.length) for (var k = 0; k < kpis.length; k++) {
    var c = el('div', 'card kpi'); c.append(el('div', 'label', kpis[k][1]), el('div', 'value num'), el('div', 'foot num'));
    if (kpis[k][4] !== null) { var m = el('div', 'meter'); m.append(el('i')); c.append(m); }
    box.append(c);
  }
  for (var j = 0; j < kpis.length; j++) {
    var card = box.children[j];
    setValue(card.querySelector('.value'), kpis[j][0], kpis[j][2]);
    card.querySelector('.foot').textContent = kpis[j][3];
    if (kpis[j][4] !== null) card.querySelector('.meter i').style.width = (kpis[j][4] * 100) + '%';
  }
}

function renderScores() {
  var box = byId('scores'); box.replaceChildren();
  var scored = data.turns.filter(isScored);
  var head = el('h2', null, 'Ambition scores'); head.append(el('span', 'num', scored.length ? 'average of ' + plural(scored.length, 'scored turn') + ' · 0–3' : '0–3'));
  box.append(head);
  if (!scored.length) {
    var e = el('div', 'empty-note');
    e.append(document.createTextNode('No scored turns yet. Run '), el('code', null, '/handhold review'), document.createTextNode(' and the scores appear here.'));
    box.append(e); return;
  }
  for (var i = 0; i < DIMS.length; i++) {
    var d = DIMS[i][0], sum = 0, low = 0;
    for (var j = 0; j < scored.length; j++) { sum += scored[j].assess.scores[d]; if (scored[j].assess.scores[d] <= 1) low++; }
    var avg = sum / scored.length;
    var row = el('div', 'dim');
    var track = el('div', 'track'), fill = el('i'); fill.style.width = (avg / 3 * 100) + '%'; track.append(fill);
    var score = el('div', 'score num'); score.append(el('b', null, avg.toFixed(1)), el('span', null, ' / 3'));
    row.title = DIMS[i][1] + ': ' + plural(low, 'turn') + ' scored 0 or 1';
    row.append(el('div', 'name', DIMS[i][1]), track, score);
    box.append(row);
  }
  var lows = scored.filter(isLow).length;
  box.append(el('p', 'note', lows ? plural(lows, 'turn') + ' had a dimension at 0 or 1. Filter with Low scores to see what to try instead.' : 'No dimension scored below 2. Nice.'));
}

function renderActivity() {
  var box = byId('activity'); box.replaceChildren();
  var DAYS = 30;
  var end = new Date(Math.max(data.generatedMs, Date.now())); end.setHours(0, 0, 0, 0);
  var counts = new Map(), toks = new Map();
  for (var i = 0; i < data.turns.length; i++) { var t = data.turns[i], k = dayKey(t.startMs); counts.set(k, (counts.get(k) || 0) + 1); toks.set(k, (toks.get(k) || 0) + tokensOf(t)); }
  var days = [];
  for (var n = DAYS - 1; n >= 0; n--) { var d = new Date(end); d.setDate(end.getDate() - n); var key = dayKey(d.getTime()); days.push({ ms: d.getTime(), key: key, n: counts.get(key) || 0, tok: toks.get(key) || 0 }); }
  var peak = Math.max.apply(null, [1].concat(days.map(function (x) { return x.n; })));
  var total = days.reduce(function (s, x) { return s + x.n; }, 0);
  var head = el('h2', null, 'Turns per day'); head.append(el('span', 'num', 'last 30 days · ' + plural(total, 'turn') + (peak > 1 ? ' · peak ' + peak : '')));
  var chart = el('div', 'chart' + (state.day ? ' has-pick' : ''));
  chart.setAttribute('role', 'list');
  days.forEach(function (x) {
    var b = el('button', x.n ? '' : 'zero'); var bar = el('i'); bar.style.height = (x.n / peak * 100) + '%'; b.append(bar);
    if (state.day === x.key) b.classList.add('picked');
    var label = new Date(x.ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + plural(x.n, 'turn') + (x.tok ? ' · ' + fmtK(x.tok) + ' tokens' : '');
    b.setAttribute('aria-label', label); b.setAttribute('role', 'listitem');
    b.addEventListener('mouseenter', function () { showTip(b, label); });
    b.addEventListener('focus', function () { showTip(b, label); });
    b.addEventListener('mouseleave', hideTip); b.addEventListener('blur', hideTip);
    b.addEventListener('click', function () { if (!x.n) return; state.day = state.day === x.key ? '' : x.key; state.dayMs = x.ms; renderActivity(); renderList(); });
    chart.append(b);
  });
  var axis = el('div', 'axis num'); axis.append(el('span', null, shortDay(days[0].ms)), el('span', null, shortDay(days[Math.floor(DAYS / 2)].ms)), el('span', null, 'Today'));
  box.append(head, chart, axis);
}

var tip = null;
function showTip(target, text) {
  if (!tip) { tip = el('div', 'tip'); document.body.append(tip); }
  tip.textContent = text; tip.classList.add('on');
  var r = target.getBoundingClientRect(), w = tip.offsetWidth;
  var left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
  tip.style.left = left + 'px'; tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + 'px';
}
function hideTip() { if (tip) tip.classList.remove('on'); }

/* Toolbar */
var FILTERS = [['all', 'All', function () { return true; }], ['scored', 'Scored', isScored], ['low', 'Low scores', isLow], ['unscored', 'Not scored', function (t) { return !t.assess && !t.quick; }]];
function renderFilters() {
  var seg = byId('seg'); seg.replaceChildren();
  FILTERS.forEach(function (f) {
    var b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(state.f === f[0]));
    b.append(document.createTextNode(f[1]), el('span', 'n num', String(data.turns.filter(f[2]).length)));
    b.addEventListener('click', function () { state.f = f[0]; save(); renderFilters(); renderList(); });
    seg.append(b);
  });
  var pick = byId('pick');
  pick.classList.toggle('on', !!state.day);
  if (state.day) pick.textContent = shortDay(state.dayMs) + '  ✕';
}

/* Turn cards */
function copyButton(text) {
  var b = el('button', 'copy', 'Copy'); b.type = 'button';
  b.addEventListener('click', function (ev) {
    ev.preventDefault();
    var done = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1200); };
    try { navigator.clipboard.writeText(text).then(done, function () { b.textContent = 'Copy failed'; }); } catch (e) { b.textContent = 'Copy failed'; }
  });
  return b;
}
function block(title, content, copyText) {
  var s = el('div', 'block'), h = el('h3', null, title);
  if (copyText) h.append(copyButton(copyText));
  s.append(h, content); return s;
}

function buildBody(t) {
  var body = el('div', 'body');
  var left = el('div'), right = el('div');
  left.append(block('Prompt', el('pre', null, t.prompt || '(empty prompt)'), t.prompt));
  if (t.answer) left.append(block('Answer', el('pre', null, t.answer), t.answer));

  if (isScored(t)) {
    var a = t.assess, coach = el('div', 'coach');
    coach.append(el('div', 'technique', a.techniqueLabel || 'Coaching'));
    DIMS.forEach(function (d) {
      if (!a.evidence[d[0]]) return;
      var row = el('div', 'ev'); row.append(el('span', 'pill s' + a.scores[d[0]], d[2] + ' ' + a.scores[d[0]]), el('span', null, a.evidence[d[0]]));
      coach.append(row);
    });
    if (a.nudge) coach.append(el('p', 'nudge', a.nudge));
    right.append(block('Coaching', coach));
    if (a.rewrite) right.append(block('Try instead', el('p', 'rewrite', a.rewrite), a.rewrite));
  } else if (t.assess) {
    right.append(block('Coaching', el('p', 'nudge', 'The judge found nothing here that called for more ambition.')));
  }

  var dl = el('dl', 'num');
  var fact = function (k, v) { if (v) dl.append(el('dt', null, k), el('dd', null, v)); };
  fact('Started', new Date(t.startMs).toLocaleString());
  fact('Duration', fmtDur(t.durationMs));
  fact('Model', t.models.map(model).join(', '));
  fact('Tokens', fmtK(t.inputTokens) + ' in · ' + fmtK(t.outputTokens) + ' out');
  fact('Subagents', t.agents.join(', '));
  fact('Session', t.sessionId);
  if (t.aborted) fact('Status', 'Aborted');
  right.append(block('Turn', dl));

  if (t.tools.length) {
    var list = el('div', 'tools'), max = Math.max.apply(null, [1].concat(t.tools.map(function (x) { return x.ms; })));
    var shown = t.tools.slice(0, 40);
    shown.forEach(function (x) {
      var row = el('div', 'tool' + (x.ok ? '' : ' err')); row.title = x.name + (x.ok ? '' : ' (failed)') + ' · ' + fmtDur(x.ms);
      var bar = el('div', 'tb'), fill = el('i'); fill.style.width = (x.ms / max * 100) + '%'; bar.append(fill);
      row.append(el('span', 'tn', (x.ok ? '' : '✕ ') + x.name), bar, el('span', 'tm num', fmtDur(x.ms)));
      list.append(row);
    });
    if (t.tools.length > shown.length) list.append(el('div', 'tm', '+ ' + (t.tools.length - shown.length) + ' more'));
    var failed = t.tools.filter(function (x) { return !x.ok; }).length;
    right.append(block('Tools · ' + t.tools.length + (failed ? ' · ' + failed + ' failed' : ''), list));
  }
  body.append(left, right);
  return body;
}

function buildTurn(t, isFresh) {
  var card = el('article', 'card turn' + (isFresh ? ' fresh' : ''));
  var d = el('details'), s = el('summary');
  var mid = el('div');
  mid.append(el('div', 'prompt' + (t.prompt ? '' : ' blank'), t.prompt || '(empty prompt)'));
  var facts = el('div', 'facts num');
  if (isFresh) facts.append(el('span', 'tag new', 'NEW'));
  if (t.aborted) facts.append(el('span', 'tag bad', 'aborted'));
  if (t.models.length) facts.append(el('span', null, t.models.map(model).join(', ')));
  if (t.durationMs) facts.append(el('span', null, fmtDur(t.durationMs)));
  if (t.tools.length) facts.append(el('span', null, plural(t.tools.length, 'tool')));
  if (t.agents.length) facts.append(el('span', null, plural(t.agents.length, 'subagent')));
  if (tokensOf(t)) facts.append(el('span', null, fmtK(tokensOf(t)) + ' tokens'));
  mid.append(facts);
  var scores = el('div', 'scores');
  if (isScored(t)) DIMS.forEach(function (x) { var p = el('span', 'pill num s' + t.assess.scores[x[0]], x[2] + ' ' + t.assess.scores[x[0]]); p.title = x[1] + ' ' + t.assess.scores[x[0]] + ' of 3'; scores.append(p); });
  else if (t.assess) scores.append(el('span', 'pill mute', 'not warranted'));
  else if (t.quick) scores.append(el('span', 'pill mute', 'quick request'));
  else scores.append(el('span', 'pill dash', 'unscored'));
  s.append(el('span', 'time num', hm(t.startMs)), mid, scores);
  d.append(s);
  d.addEventListener('toggle', function () { if (d.open && !d.querySelector('.body')) d.append(buildBody(t)); });
  card.append(d);
  return card;
}

function nodeFor(t) {
  var k = keyOf(t), sig = sigOf(t), have = nodes.get(k);
  if (have && have.sig === sig) return have.node;
  var node = buildTurn(t, fresh.has(k));
  if (have) {
    var wasOpen = have.node.querySelector('details').open;
    if (wasOpen) { var d = node.querySelector('details'); d.open = true; d.append(buildBody(t)); }
    node.classList.add('changed');
  }
  nodes.set(k, { node: node, sig: sig });
  return node;
}

function renderList() {
  var q = state.q.trim().toLowerCase();
  var filter = FILTERS.filter(function (f) { return f[0] === state.f; })[0] || FILTERS[0];
  var shown = data.turns.filter(function (t) {
    if (state.day && dayKey(t.startMs) !== state.day) return false;
    if (q && (t.prompt + ' ' + t.answer + ' ' + t.tools.map(function (x) { return x.name; }).join(' ')).toLowerCase().indexOf(q) < 0) return false;
    return filter[2](t);
  });
  var cmp = {
    newest: function (a, b) { return b.startMs - a.startMs; },
    oldest: function (a, b) { return a.startMs - b.startMs; },
    tokens: function (a, b) { return tokensOf(b) - tokensOf(a); },
    longest: function (a, b) { return b.durationMs - a.durationMs; },
    lowest: function (a, b) { return (isScored(a) ? minScore(a) * 10 + a.assess.scores.altitude + a.assess.scores.depth + a.assess.scores.range : 99) - (isScored(b) ? minScore(b) * 10 + b.assess.scores.altitude + b.assess.scores.depth + b.assess.scores.range : 99) || b.startMs - a.startMs; },
  }[state.sort];
  shown.sort(cmp);

  var list = byId('list'), out = [];
  if (!shown.length) {
    var e = el('div', 'empty');
    if (data.turns.length) { e.append(el('b', null, 'No turns match'), document.createTextNode('Try a different search or filter.')); }
    else { e.append(el('b', null, 'No turns recorded yet'), document.createTextNode('Keep this tab open. Turns appear here as you work.')); }
    list.replaceChildren(e); return;
  }
  var byDay = state.sort === 'newest' || state.sort === 'oldest';
  if (byDay) {
    var groups = [], cur = null;
    shown.forEach(function (t) { var k = dayKey(t.startMs); if (!cur || cur.k !== k) { cur = { k: k, ms: t.startMs, turns: [] }; groups.push(cur); } cur.turns.push(t); });
    groups.forEach(function (g) {
      var h = el('div', 'day'); var sc = g.turns.filter(isScored).length;
      h.append(el('b', null, dayLabel(g.ms)), el('span', 'num', plural(g.turns.length, 'turn') + (sc ? ' · ' + sc + ' scored' : '')));
      out.push(h); g.turns.forEach(function (t) { out.push(nodeFor(t)); });
    });
  } else {
    var h = el('div', 'day'); h.append(el('b', null, SORTS[state.sort]), el('span', 'num', plural(shown.length, 'turn'))); out.push(h);
    shown.forEach(function (t) { out.push(nodeFor(t)); });
  }
  list.replaceChildren.apply(list, out);
}

function renderAll() { renderHeader(); renderScores(); renderActivity(); renderFilters(); renderList(); renderLive(); }

/* Live updates: history-data.js is rewritten by the plugin, and re-read here as a script so file:// pages can load it. */
var toastCount = 0;
function toast(n) {
  toastCount += n;
  var t = byId('toast'); t.textContent = '↑ ' + plural(toastCount, 'new turn'); t.classList.add('on');
}
byId('toast').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });

window['${DATA_CALLBACK}'] = function (payload) {
  if (!payload || !Array.isArray(payload.turns)) return;
  if (liveState !== 'live' && liveState !== 'pulse') { liveState = 'live'; renderLive(); }
  if (payload.generatedMs === data.generatedMs) return;
  var added = 0;
  payload.turns.forEach(function (t) { var k = keyOf(t); if (!known.has(k)) { known.add(k); fresh.add(k); added++; } });
  var keep = new Set(payload.turns.map(keyOf));
  nodes.forEach(function (_, k) { if (!keep.has(k)) nodes.delete(k); });
  data = payload;
  renderAll(); pulse();
  if (added && window.scrollY > 260) toast(added);
  if (added) setTimeout(function () { fresh.clear(); }, 12000);
};

var inflight = false;
function poll() {
  if (document.hidden || inflight) return;
  inflight = true;
  var s = document.createElement('script');
  s.src = DATA_FILE + '?v=' + Date.now();
  s.onload = function () { s.remove(); inflight = false; };
  s.onerror = function () { s.remove(); inflight = false; liveState = 'offline'; renderLive(); };
  document.head.append(s);
}

/* Wiring */
var qInput = byId('q');
qInput.addEventListener('input', function () { state.q = qInput.value; renderList(); });
byId('sort').value = state.sort;
byId('sort').addEventListener('change', function (e) { state.sort = e.target.value; save(); renderList(); });
byId('pick').addEventListener('click', function () { state.day = ''; renderActivity(); renderFilters(); renderList(); });
document.addEventListener('keydown', function (e) {
  if (e.key === '/' && document.activeElement !== qInput) { e.preventDefault(); qInput.focus(); qInput.select(); }
  else if (e.key === 'Escape' && document.activeElement === qInput) { qInput.value = ''; state.q = ''; qInput.blur(); renderList(); }
});
window.addEventListener('scroll', function () {
  byId('toolbar').classList.toggle('stuck', byId('toolbar').getBoundingClientRect().top <= 0 && window.scrollY > 0);
  if (window.scrollY < 120 && toastCount) { toastCount = 0; byId('toast').classList.remove('on'); }
}, { passive: true });
document.addEventListener('visibilitychange', poll);

renderAll();
poll();
setInterval(poll, POLL_MS);
setInterval(renderLive, 5000);
})();
`

const sortOptions = [
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['tokens', 'Most tokens'],
  ['longest', 'Longest'],
  ['lowest', 'Lowest score'],
]
  .map(([v, l]) => `<option value="${v}">${l}</option>`)
  .join('')

// `payloadJson` must already be embedJson'd: it goes inside a <script> block as is.
export function pageHtml(payloadJson: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'self' file:">
<title>Handhold · trace history</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <header class="top">
    <div class="brand">
      <div class="logo" aria-hidden="true">H</div>
      <div><h1>Trace history</h1><div class="sub num" id="sub"></div></div>
    </div>
    <div class="live" id="live" data-state="connecting" role="status" aria-live="polite"><span class="dot"></span><span id="live-text">Connecting…</span></div>
  </header>
  <section class="kpis" id="kpis" aria-label="Totals"></section>
  <section class="panels">
    <div class="card panel" id="scores" aria-label="Ambition scores"></div>
    <div class="card panel" id="activity" aria-label="Turns per day"></div>
  </section>
  <div class="toolbar" id="toolbar">
    <label class="search"><input id="q" type="search" placeholder="Search prompts, answers and tools" aria-label="Search" autocomplete="off"><kbd>/</kbd></label>
    <div class="seg" id="seg" role="group" aria-label="Filter"></div>
    <button class="pick" id="pick" type="button" title="Clear day filter"></button>
    <select id="sort" aria-label="Sort">${sortOptions}</select>
  </div>
  <div id="list"></div>
</main>
<button class="toast" id="toast" type="button"></button>
<script id="data" type="application/json">${payloadJson}</script>
<script>${SCRIPT}</script>
</body>
</html>
`
}
