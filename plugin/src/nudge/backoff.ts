import type { Backoff, Technique } from '../../types'

export const EMPTY_BACKOFF: Backoff = { offered: null, declines: {} }

// Content words: five letters or more, lower-cased, so "the" and "for" do not count as take-up.
const contentWords = (text: string): Set<string> =>
  new Set((text.toLowerCase().match(/[a-z]{5,}/g) ?? []))

// The person took up an offer when the next prompt shares at least three content words with its rewrite.
// Otherwise the offered technique counts as declined.
export function recordOutcome(b: Backoff, nextPrompt: string, lastRewrite: string): Backoff {
  if (b.offered === null) return b
  const shared = [...contentWords(nextPrompt)].filter(w => contentWords(lastRewrite).has(w)).length
  if (shared >= 3) return { ...b, offered: null }
  const declined = b.offered
  return {
    offered: null,
    declines: { ...b.declines, [declined]: (b.declines[declined] ?? 0) + 1 },
  }
}

// After two declines of a technique, it is not offered again this session.
export function isSuppressed(b: Backoff, t: Technique): boolean {
  return (b.declines[t] ?? 0) >= 2
}
