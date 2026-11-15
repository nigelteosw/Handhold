// The rubric: the only home of the judge's wording. Changing it means bumping RUBRIC_VERSION.

export const RUBRIC_VERSION = '1'

export const TECHNIQUES = [
  'goal-beyond-the-goal',
  'durable-workflow',
  'insist-on-instruments',
  'unreasonable-goal',
  'challenge-assumptions',
  'produce-new-knowledge',
  'outside-judge',
  'nouns-to-verbs',
  'assemble-the-crew',
] as const

export type Technique = (typeof TECHNIQUES)[number]

// What each technique means to the person, in plain words. Shown on the pane, in exports and in reviews.
export const TECHNIQUE_LABELS: Record<Technique, string> = {
  'goal-beyond-the-goal': 'Aim at the goal behind the request',
  'durable-workflow': 'Build something that keeps working',
  'insist-on-instruments': 'Use the tools real experts use',
  'unreasonable-goal': 'Set a bold target',
  'challenge-assumptions': 'Test your assumptions against the facts',
  'produce-new-knowledge': 'Ask it to find what you do not know yet',
  'outside-judge': 'Get a check from outside the work',
  'nouns-to-verbs': 'Describe the job as an action, not a thing',
  'assemble-the-crew': 'Bring in people from other fields',
}

export const techniqueLabel = (t: Technique): string => TECHNIQUE_LABELS[t]

export const DIMENSIONS = ['altitude', 'depth', 'range'] as const

export type Dimension = (typeof DIMENSIONS)[number]

export const RUBRIC_TEXT = `You are a judge for a mentorship tool. You score how ambitiously the PERSON framed their request for an AI assistant. The assistant's work is context only; do not score it.

Step 0 — is ambition warranted? A quick lookup, a tone fix or small talk is not warranted. Reply with {"warranted": false} for those.

Otherwise score three dimensions, each 0 to 3, based on what the person did.

Altitude (outcome over task):
0 = a single micro-task, no purpose stated.
1 = a task plus context.
2 = states the goal behind the task and lets the model choose the approach.
3 = delegates an ongoing outcome, and sets up access and verification so the person can step out of the loop.
For creative work, do not push Altitude: it fits creative work less well.

Depth (how an expert would do it):
0 = digested input; accepts a surface answer.
1 = asks for expert quality, in vocabulary only.
2 = gives raw material; insists on the expert's real methods and tools; challenges an assumption.
3 = sets an unreasonable goal; asks for a check from outside the work; asks it to find what is not yet known.

Range (other fields):
0 = a single field.
1 = mentions another perspective.
2 = describes the job as an action (not "a deck" but "convince leadership to act") and brings in people from other fields.
3 = uses those fields' working methods (not pretending to be them), including someone whose job is to attack the plan and find its weak points.

Techniques (choose exactly one, from this list): ${TECHNIQUES.join(', ')}.

Pick the dimension with the lowest score as "opportunity". Quote the person's own words as evidence for each dimension. "nudge" is one sentence to the person. "rewrite" is the more ambitious version of their prompt, in their voice.

Reply with only the JSON object, in this shape:
{"warranted": true, "scores": {"altitude": 0, "depth": 0, "range": 0}, "evidence": {"altitude": "", "depth": "", "range": ""}, "opportunity": "altitude", "technique": "goal-beyond-the-goal", "nudge": "", "rewrite": ""}

Reply with only the JSON object.`
