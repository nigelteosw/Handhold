import type { EngineInterface as Engine } from 'claude-code'

import type { Config } from '../shared/config'
import { FORGOTTEN_FILE, readForgotten, readIo, readTraceFiles, toTurnRecord, traceRoot } from './read'

export const FORGET_USAGE = 'Usage: /handhold forget [session | last | <session id>]'

// /handhold forget [session|last|<session id>]: drops a test run or a stray turn from reviews, history and
// exports. The trace files stay on disk; forgotten.json in the trace folder lists what every reader skips.
export async function forgetCmd($: Engine, cfg: Config, args: string): Promise<{ text: string }> {
  const io = readIo($)
  const root = await traceRoot(io, cfg)
  const word = args.trim()
  const current = await $.session.id()
  const forgotten = await readForgotten(io, root)
  const save = () => $.fs.write(`${root}/${FORGOTTEN_FILE}`, `${JSON.stringify(forgotten, null, 2)}\n`)

  if (word === 'last') {
    // The newest real turn of this session: commands such as this one are not turns worth forgetting.
    const files = await readTraceFiles(io, cfg, { sessionId: current })
    const last = files
      .map(f => ({ f, t: toTurnRecord(f.sessionId, f.fileName, f.spans) }))
      .filter(x => x.t !== null && !x.t.prompt.trim().startsWith('/'))
      .sort((a, b) => b.t!.startMs - a.t!.startMs)[0]
    if (!last) return { text: 'No turn in this session to forget.' }
    forgotten.turns.push(`${last.f.sessionId}/${last.f.fileName}`)
    await save()
    return { text: `Forgot this session's last turn: "${last.t!.prompt.slice(0, 80)}".` }
  }

  let sessionId = current
  if (word !== '' && word !== 'session') {
    let dirs: string[] = []
    try {
      dirs = (await io.list(root)).filter(e => e.kind === 'dir').map(e => e.name)
    } catch {
      // No trace folder: nothing matches.
    }
    const matches = word.length >= 8 ? dirs.filter(d => d.startsWith(word)) : []
    if (matches.length !== 1) return { text: `${matches.length === 0 ? 'No session matches' : 'More than one session matches'} "${word}". ${FORGET_USAGE}` }
    sessionId = matches[0]
  }
  if (forgotten.sessions.includes(sessionId)) return { text: `Session ${sessionId.slice(0, 8)} is already forgotten.` }
  forgotten.sessions.push(sessionId)
  await save()
  return { text: `Forgot session ${sessionId.slice(0, 8)}: reviews, history and exports will skip it.` }
}
