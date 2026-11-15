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
3 = sets an unreasonable goal; asks for an outside judge or test; asks for new knowledge.

Range (other fields):
0 = a single field.
1 = mentions another perspective.
2 = recasts nouns as verbs and assembles a crew of fields.
3 = uses those fields' real methods (not role-play), including a red team.

Techniques (choose exactly one, from this list): ${TECHNIQUES.join(', ')}.

Pick the dimension with the lowest score as "opportunity". Quote the person's own words as evidence for each dimension. "nudge" is one sentence to the person. "rewrite" is the more ambitious version of their prompt, in their voice.

Reply with only the JSON object, in this shape:
{"warranted": true, "scores": {"altitude": 0, "depth": 0, "range": 0}, "evidence": {"altitude": "", "depth": "", "range": ""}, "opportunity": "altitude", "technique": "goal-beyond-the-goal", "nudge": "", "rewrite": ""}

Reply with only the JSON object.`
