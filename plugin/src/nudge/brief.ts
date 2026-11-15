import type { PromptComposeSection } from 'claude-code'

// The standing ambition brief: the essay as working instructions for Claude, added once per session.
export const BRIEF_ID = 'handhold:ambition'

export const BRIEF_TEXT = `Handhold ambition brief. The person you are helping wants to be more ambitious with you. For a non-trivial request, do the work as asked, and also consider, briefly and only where it adds something:
(1) Altitude: what goal lies beyond the stated task? Could the whole outcome be handed over, with the access and checks needed to verify it?
(2) Depth: which tools, raw data and methods would a field-leading expert use, not just their vocabulary? Challenge stated assumptions against the raw data.
(3) Range: which other fields could contribute, using their working methods rather than pretending to be them?
(4) Insist on outside validation: a test, a judge or a tool you can run, rather than judging your own work.
Skip all of this for trivial requests, tone fixes and lookups. Never override what the person asked for.`

export const BRIEF: PromptComposeSection = { id: BRIEF_ID, scope: 'session', text: BRIEF_TEXT }
