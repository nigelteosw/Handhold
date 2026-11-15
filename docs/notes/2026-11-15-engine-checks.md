# Engine checks (Task 1)

## (a) Plugin can write under $HOME — PASSED
- Probe plugin (kept outside the repo) ran `$.fs.write("$HOME/.handhold/traces/.probe")` in a `session.start` hook, via `claude -p ... --plugin-dir <probe>`.
- Result: file written, mode `-rw-------`. Probe removed afterwards.
- Conclusion: `traceRoot` default `~/.handhold/traces` is writable. Spec §3 stands.

## (b) Cowork mode loads the mod — OPEN
- Not yet checked. Needs the person to start Cowork in the Claude desktop app with `CLAUDE_CODE_PLUGIN_DIRS` pointing at this repo's `plugin/`, and report whether `/handhold` appears.
- Until answered, the desktop-app claim in spec §1 is unverified. If it fails, spec §1 Constraints gets "Cowork: not supported".
