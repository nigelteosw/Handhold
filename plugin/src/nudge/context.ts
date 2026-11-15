import type { Assessment } from '../../types'

// The hidden hint attached to a prompt: Claude is asked to offer the more ambitious version first.
export function hintFor(a: Assessment): string {
  const dimension = a.opportunity
  return `Handhold: this request scores ${dimension} ${a.scores[dimension]}/3 (technique: ${a.technique}). Before doing the task, offer in one or two lines the more ambitious version — e.g. "${a.rewrite}" — then proceed with what was asked unless the user takes it up.`
}
