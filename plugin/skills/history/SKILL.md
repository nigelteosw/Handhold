---
name: history
description: Show the person's Handhold history - their recent prompts to Claude and whether each was coached. Use when they ask for their Handhold history or traces, or type /history. Optional argument: session, week or all.
---

Use the first of these that is available, once, and nothing else:

1. **A tool named `handhold_history`** (the Handhold connector, in the desktop app's Chat tab): call it with `range` set to `week` for "session" or "week", `all` for "all", and `month` otherwise. It shows a panel in the chat. Add at most one short sentence after it.
2. **The `mcp__handhold__handhold` tool** (Claude Code): call it with `command` set to `history $ARGUMENTS` (trim the trailing space when there are no arguments). Show its output exactly as it comes back, with nothing added before or after it.
3. **Neither:** say only: "Handhold isn't connected here. In the desktop app's Chat tab, add the Handhold connector (see mcp-server/README.md in the Handhold repository). Otherwise, use Handhold from Claude Code." Do not answer from memory or anything else you know about the person.
