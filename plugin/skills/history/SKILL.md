---
name: history
description: Open the Handhold history page of your recent turns and scores. Optional argument: session, week or all.
disable-model-invocation: true
---

Call the `mcp__handhold__handhold` tool once with `command` set to `history $ARGUMENTS` (trim the trailing space when there are no arguments).

Show the person the tool's output exactly as it comes back, with nothing added before or after it.

If that tool is not available, say only: "Handhold's recorder isn't running in this app, so there's nothing to history here. Use Handhold from Claude Code in the terminal or the desktop app's Code tab." Do not try to do the history another way.
