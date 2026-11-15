export const prompt = "Write up why churn went up, it's onboarding"

export const judgeReply = JSON.stringify({
  warranted: true,
  scores: { altitude: 2, depth: 0, range: 1 },
  evidence: {
    altitude: 'states the goal',
    depth: 'assumes the cause without data',
    range: 'one field',
  },
  opportunity: 'depth',
  technique: 'challenge-assumptions',
  nudge: 'Test the onboarding belief against the raw churn data before writing it up.',
  rewrite: 'Reproduce the onboarding explanation from the raw churn logs, and report where it fails.',
})

export const expected = {
  warranted: true,
  scores: { altitude: 2, depth: 0, range: 1 },
  opportunity: 'depth',
  technique: 'challenge-assumptions',
}
