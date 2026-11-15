export const prompt = "Update the numbers in our QBR template with this quarter's data"

export const judgeReply = JSON.stringify({
  warranted: true,
  scores: { altitude: 1, depth: 0, range: 0 },
  evidence: {
    altitude: 'Update the numbers in our QBR template',
    depth: 'no raw data or method named',
    range: 'single field',
  },
  opportunity: 'altitude',
  technique: 'goal-beyond-the-goal',
  nudge: 'What should this review lead to? Ask for the three decisions leadership must make.',
  rewrite:
    'Here is all our Q3 data. Tell me what changed, why, and which three decisions are most urgent, with for and against arguments.',
})

export const expected = {
  warranted: true,
  scores: { altitude: 1, depth: 0, range: 0 },
  opportunity: 'altitude',
  technique: 'goal-beyond-the-goal',
}
