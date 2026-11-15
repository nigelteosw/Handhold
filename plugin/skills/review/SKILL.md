---
name: review
description: Reflect on how ambitiously the person has been working with Claude, from their Handhold traces - patterns, best moments and rewrites. Use only when they ask for a Handhold review or type /review; not for reviewing code or documents. Optional argument: session or week.
---

Use the first of these that is available, and nothing else:

1. **A tool named `handhold_review_data`** (the Handhold connector, in the desktop app's Chat tab): call it with `range` set to `week` (or `all` if they asked for all time). Do exactly what its result says, which may include scoring turns and saving them with `handhold_save_scores` before you write the review.
2. **The `mcp__handhold__handhold` tool** (Claude Code): call it once with `command` set to `review $ARGUMENTS` (trim the trailing space when there are no arguments). Show its output exactly as it comes back, with nothing added before or after it.
3. **Neither:** say only: "Handhold isn't connected here. In the desktop app's Chat tab, add the Handhold connector (see mcp-server/README.md in the Handhold repository). Otherwise, use Handhold from Claude Code." Do not write a review from memory or anything else you know about the person.
