export const prompt = 'Fix this crash: TypeError: cannot read properties of undefined (reading "id") at render (app.tsx:42)'

export const judgeReply = JSON.stringify({
  warranted: true,
  scores: { altitude: 0, depth: 1, range: 0 },
  evidence: {
    altitude: 'one crash, no outcome stated',
    depth: 'pastes the stack only',
    range: 'single field',
  },
  opportunity: 'altitude',
  technique: 'durable-workflow',
  nudge: 'Ask for the app to stay crash-free, with the access it needs to verify that.',
  rewrite: 'Keep the app crash-free: fetch the crash reports, map them to commits, and verify each fix on each platform.',
})

export const expected = {
  warranted: true,
  scores: { altitude: 0, depth: 1, range: 0 },
  opportunity: 'altitude',
  technique: 'durable-workflow',
}
