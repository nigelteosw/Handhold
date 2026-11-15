---
name: forget
description: Drop a test run or a stray turn from Handhold reviews and history. Optional argument: session, last or a session id.
disable-model-invocation: true
---

Call the `mcp__handhold__handhold` tool once with `command` set to `forget $ARGUMENTS` (trim the trailing space when there are no arguments).

Show the person the tool's output exactly as it comes back, with nothing added before or after it.

If that tool is not available, say only: "Handhold's recorder isn't running in this app, so there's nothing to forget here. Use Handhold from Claude Code in the terminal or the desktop app's Code tab." Do not try to do the forget another way.
