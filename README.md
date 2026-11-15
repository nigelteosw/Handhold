# Handhold

A local Claude plugin that mentors you to be more ambitious when you work with Claude. It follows Felix Rieseberg's essay [*How to be more ambitious: a tutorial for humans with models*](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/), using its three ambition types: **Altitude** (aim at the outcome, not the task), **Depth** (work the way a field-leading expert would), and **Range** (draw on other fields through their real methods).

Handhold watches each turn, scores how ambitiously you framed the request, nudges Claude to offer the more ambitious version, and gives you a short coaching note and reflections over time. Everything stays on your machine.

## Where it runs

- **Claude Code** in the terminal and IDE extensions: supported.
- **Claude desktop app, Claude Code session**: loads through `CLAUDE_CODE_PLUGIN_DIRS`. Verified in headless runs only; the interactive desktop check is still open.
- **Cowork mode**: not yet verified.
- **The claude.ai chat tab** (web or desktop): not supported. Local plugins cannot reach it.

## Install (while developing)

Run Claude Code with the plugin folder:

```sh
claude --plugin-dir /path/to/Handhold/plugin
```

Or, for sessions that cannot take a flag (for example the desktop app), set `CLAUDE_CODE_PLUGIN_DIRS` to the absolute path of `plugin/` in the `env` block of `~/.claude/settings.json`.

## Commands

| Command | What it does |
|---|---|
| `/handhold review [session\|week]` | Reflects on this session's turns (default), or the last 7 days across sessions: patterns, best moments, three before-and-after rewrites, and the trend. |
| `/handhold pane` | Opens the progress pane: session and 7-day averages per dimension, and any techniques Handhold has stopped offering. |
| `/handhold export [--otlp] [--report [path]]` | Writes an OTLP JSON file of the last 7 days of traces, and a Markdown progress report (scores and short before-and-after pairs, no transcripts) that you can share. With no flags it writes both. |
| `/handhold quiet [off]` | Mutes coaching notes for this session, or turns them back on. |

## How it nudges

- **Before your prompt is sent**, a fast judge (Haiku by default) scores it. When a dimension is low, Claude is asked, through a hidden hint for that turn, to offer the more ambitious version first. Trivial lookups and small talk are not judged.
- **After the answer**, a fuller judge (Opus by default) scores the turn. A coaching note appears under the answer, at most once every three turns.
- Handhold stops offering a technique for the session after you decline it twice.

## Where your data lives

Each turn is written once it ends, to `~/.handhold/traces/<session-id>/<turn>.jsonl`, as OpenTelemetry GenAI spans (`gen_ai.*` attributes). Every prompt, answer, tool call and subagent run is included. Set `redact` to strip tool results (`tool-results`) or tool arguments too (`all-tool-io`).

Exports go to `~/.handhold/exports/`, or to the path you give `--report`.

## Privacy

Handhold has no server and no account. Traces stay on disk. The only network use is the two judge calls and the reflection, which use your own Claude access. Traces contain your prompts and Claude's answers in full, so treat the trace folder and any export as sensitive.

## Settings

Set these under the plugin's configuration: `fastModel`, `fullModel`, `preTimeoutMs` (2000), `postTimeoutMs` (20000), `redact` (`none` by default), `noteEvery` (3), and `traceRoot`.

## Development

```sh
claude plugin validate plugin   # manifest and hooks
claude plugin test plugin       # the test suite
npx -p typescript tsc -p plugin # type-check (tsconfig includes the vendored engine types)
```

The engine's declaration file is vendored at `plugin/types/vendor/claude-code.d.ts` for build 2.1.325. Refresh it when the engine updates. The design is in `docs/superpowers/specs/`, and the plan is in `docs/superpowers/plans/`.
