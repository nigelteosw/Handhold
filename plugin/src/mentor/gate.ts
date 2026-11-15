// The cheap "is ambition warranted?" filter. It runs before any model call.
const LOOKUP = /^(what|who|when|where) (is|are|was|were) [^.?!]{0,60}\??$/i
const GREETING = /^(hi|hello|hey|thanks|thank you|ok|okay)\b/i
const SHORT = 25
const SHORT_GREETING = 60

export function isTrivial(prompt: string): boolean {
  const p = prompt.trim()
  if (p.length < SHORT) return true
  if (!p.includes('\n') && LOOKUP.test(p)) return true
  return p.length < SHORT_GREETING && GREETING.test(p)
}
