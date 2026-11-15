# Engine checks (Task 1)

## (a) Plugin can write under $HOME — PASSED
- Probe plugin (kept outside the repo) ran `$.fs.write("$HOME/.handhold/traces/.probe")` in a `session.start` hook, via `claude -p ... --plugin-dir <probe>`.
- Result: file written, mode `-rw-------`. Probe removed afterwards.
- Conclusion: `traceRoot` default `~/.handhold/traces` is writable. Spec §3 stands.

## (b) Cowork mode loads the mod — OPEN
- Not yet checked. Needs the person to start Cowork in the Claude desktop app with `CLAUDE_CODE_PLUGIN_DIRS` pointing at this repo's `plugin/`, and report whether `/handhold` appears.
- Until answered, the desktop-app claim in spec §1 is unverified. If it fails, spec §1 Constraints gets "Cowork: not supported".

## End-to-end runs (Task 11), headless `claude -p --plugin-dir plugin`

Checked:
- Traces are written per turn under `~/.handhold/traces/<session>/`, with the root span, the chat spans, tool spans and the `handhold.assess` spans. A clean turn closes every span `OK`. (Found and fixed: the root closed as `unfinished`; regression test added.)
- A trivial prompt ("What is the capital of France?") is not judged before sending, and its post-answer judge is skipped. (Found and fixed: the post-answer judge ran on trivial turns; regression test added.)
- `/handhold review week` reads traces across sessions and returns a reflection.
- `/handhold pane`, `/handhold quiet` and `/handhold quiet off` answer.

Observed, not yet resolved:
- For the QBR prompt, the fast pre-send judge (Haiku 5.5) returned `warranted: false`, so no hint reached Claude in that run. The post-answer judge (Opus 5.5) scored the same turn as warranted (durable-workflow). The rubric is the same for both, so the fast judge's threshold is the question: keep Haiku for speed and accept some misses, or move the pre-send judge to a stronger model. This is a product decision.
- Some chat spans closed `ERROR` in the QBR run, where the model's Bash and Read calls were refused for approval in `-p` mode. Not yet traced to a plugin cause.

Not checked here (needs the person):
- The progress pane's drawing in the terminal and in the desktop app. The tests mount the pane through the engine's test kit, not on a real screen.
- Desktop app (interactive) via `CLAUDE_CODE_PLUGIN_DIRS`.
- Cowork mode loading mods.
