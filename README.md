# Handhold

A local Claude plugin that mentors you to be more ambitious when you work with Claude. It follows Felix Rieseberg's essay [*How to be more ambitious: a tutorial for humans with models*](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/), which describes three kinds of ambition:

- **Altitude**: aim at the outcome, not just the task. "What is the goal beyond the goal?"
- **Depth**: work the way a field-leading expert would, with their raw material, methods and an outside check.
- **Range**: draw on other fields through their real methods, not role-play.

Handhold scores each request on these three, nudges Claude to offer the more ambitious version, gives you a short coaching note, and reflects on your progress over time. Everything runs on your machine, and it works in any field, not only programming.

## Where it runs

- **Claude Code** in the terminal and IDE extensions: supported.
- **Claude desktop app, Claude Code session**: loads through `CLAUDE_CODE_PLUGIN_DIRS`. Checked in headless runs only; the interactive desktop check is still open.
- **Claude desktop app, where plugins run with a skills-only `/` menu**: that menu never shows a command a plugin registers while it runs, so `/handhold` doesn't appear. Use the skills `/review`, `/history` and `/forget` instead; they call Handhold through its `mcp__handhold__handhold` tool. `/history` puts a summary in the chat as well as writing the page, because a browser may not open from there.
- **Cowork mode**: not yet verified. Its sessions may run in a sandbox with their own trace folder, apart from the terminal's.
- **The desktop app's Chat tab**: through the Handhold extension (`mcp-server/`), a separate install. It shows your history as a panel in the chat and writes reviews from your Claude Code traces. Chat itself isn't recorded. See "In the Chat tab".
- **claude.ai on the web**: only the Chat skill, which reviews one conversation at a time. A web page can't reach the trace files on your machine.

## Install from GitHub

In Claude Code, add this repository as a marketplace and install the plugin:

```sh
claude plugin marketplace add nigelteosw/Handhold
claude plugin install handhold@handhold
```

The plugin is copied at install time. To pick up a newer version, run `claude plugin update handhold@handhold`.

## Install (while developing)

Run Claude Code with the plugin folder:

```sh
claude --plugin-dir /path/to/Handhold/plugin
```

For sessions that cannot take a flag (for example the desktop app), set `CLAUDE_CODE_PLUGIN_DIRS` to the absolute path of `plugin/` in the `env` block of `~/.claude/settings.json`.

## In the Chat tab

The Chat tab can't run plugins, so Handhold reaches it in other ways:

- **The Handhold extension (desktop app).** A local MCP server that reads the traces the plugin records and gives Chat your history as a panel in the conversation, plus reviews that Claude in the chat writes (and scores, for turns not yet scored). Install it from `mcp-server/`: see [its README](mcp-server/README.md). Ask "Show my Handhold history" or "Give me a Handhold review", or use `/history` and `/review`. It reviews your Claude Code work; Chat conversations aren't recorded.

- **The Handhold review skill.** Run `node chat-skill/build.ts` (Node 22.18 or later) to make `chat-skill/dist/handhold-review.zip`, then upload it in Claude under Settings → Capabilities → Skills. In any chat, ask Claude to review your prompting, or type `/handhold-review`. It reviews **this conversation only**: the one habit to work on, a before-and-after of your own prompt, and what the better prompt would have got you. It can't see other chats and keeps no history. It is generated from the plugin's rubric, so both judge the same way.
- **The standing brief.** Paste the brief from `plugin/src/nudge/brief.ts` into Settings → Profile (preferences) or a Project's instructions, and Claude will offer the more ambitious version in every chat. The skill gives you this text too, if you ask it how.

On claude.ai on the web, only the skill and the brief work. The progress pane, live coaching notes and exports need Claude Code (the terminal, or the desktop app's Code tab).

## Commands

`/handhold <subcommand>` works wherever Claude Code runs plugin code. Where the `/` menu lists only skills (the desktop app's chat), the same subcommands are the skills `/review`, `/history` and `/forget`. In the terminal they appear as `/handhold:review` and so on. Each one costs a short model turn to call the tool, which `/handhold` doesn't.

| Command | What it does |
|---|---|
| `/handhold review [session\|week]` | Scores the turns in scope that haven't been scored yet (one Haiku call), then reflects on them (one Opus call): patterns, best moments, three before-and-after rewrites, and the trend. Requests asked more than once count once. With fewer than 5 distinct turns worth coaching it skips the reflection and shows each turn's own suggestion instead. Defaults to this session, and falls back to the last 7 days when nothing in the session needed coaching; `week` covers the last 7 days across sessions. |
| `/handhold forget [session\|last\|<session id>]` | Drops a test run or a stray turn from reviews, history and exports. With no argument it forgets this session; `last` forgets this session's last turn. Plugins can't delete files, so the traces stay on disk and `forgotten.json` in the trace folder lists what to skip. |
| `/handhold history [session\|week\|all]` | Sums up your recent turns in the chat (counts, your latest suggestion, and what came of each recent turn), and writes a local page of them to `~/.handhold/history.html`, opening it in your browser where it can: prompts, answers, tools used, tokens and any scores, with search and filters. Defaults to the last 30 days. Makes no model calls. |
| `/handhold pane` | Opens the progress pane: session and 7-day averages per dimension, and any techniques Handhold has stopped offering. In review mode it fills in after each `/handhold review`. |
| `/handhold export [--otlp] [--report [path]]` | Writes an OTLP JSON file of the last 7 days of traces, and a Markdown progress report (scores and short before-and-after pairs, no transcripts) you can share. With no flags it writes both. |
| `/handhold quiet [off]` | Mutes coaching notes for this session, or turns them back on. |

## How it works

### Two modes

Handhold has a `mode` setting.

- **`review` (the default)** makes no model calls while you work. Each turn is only recorded to disk. Scoring happens when you run `/handhold review`, which scores up to `reviewBatch` (15) unscored turns in **one** Haiku call and saves each score on its trace file so no turn is scored twice. It then makes one Opus call for the reflection. Apart from the standing brief below, a review is the only time Handhold uses your Claude usage.
- **`live`** runs the judges on every warranted turn and shows coaching notes, as described next. It costs two Haiku calls per warranted prompt.

### What happens in one turn (live mode)

1. **You send a prompt.** Handhold skips commands and trivial requests (short lookups, greetings). Anything else goes to the **fast judge** (Haiku 5.5 by default), which scores it against the rubric below. The judge gets a 2-second budget, and if it's late or fails, your prompt goes through unchanged.
2. **If a dimension scores 0 or 1,** Handhold adds a hidden note to that turn only. It asks Claude to offer the more ambitious version in a line or two before doing what you asked. Your words are never rewritten, and Claude still does the task.
3. **Claude works.** Handhold records each model step, tool call and subagent run as it happens.
4. **The turn ends.** The **per-turn judge** (`turnModel`, Haiku 5.5 by default) scores the whole turn, using your prompt and a short summary of the turn (tools used, subagents, how it ended). The result is saved on the turn's trace.
5. **A coaching note** appears under the answer if the score is low. Notes are at most one every three turns, and `/handhold quiet` mutes them.
6. **Claude gets a standing brief** once per session, in its system prompt. It condenses the essay into working habits: look for the goal beyond the goal, use experts' real methods, start from raw data, challenge assumptions, and insist on outside checks. It tells Claude to skip all of this for trivial requests.

### Back-off

If Claude offers a technique and your next prompt doesn't take it up (fewer than three content words in common with the rewrite), that counts as a decline. After two declines of the same technique in a session, Handhold stops offering it for that session. The progress pane lists these.

### The rubric

Each warranted request gets a 0–3 score on each dimension, based on what **you** did. Claude's work is only context.

| | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| **Altitude** | One micro-task, no purpose | Task plus context | States the goal and lets Claude choose the approach | Delegates an ongoing outcome, with access and checks so you can step out of the loop |
| **Depth** | Digested input, accepts a surface answer | Expert quality asked for, in vocabulary only | Gives raw material, insists on real methods, challenges an assumption | Sets an unreasonable goal, asks for an outside check, asks for new knowledge |
| **Range** | One field | Mentions another perspective | Describes the job as an action and brings in people from other fields | Uses those fields' working methods, including someone whose job is to find the plan's weak points |

The judge also names the weakest dimension (the **opportunity**), one technique from the essay's list, a one-sentence nudge, and a rewritten prompt in your own voice. For creative work, Altitude isn't pushed, since the essay notes it fits less well there. The rubric wording lives in one file, `plugin/src/mentor/rubric.ts`.

### What gets recorded

Each turn is written once it ends, to `~/.handhold/traces/<session-id>/<number>-<turn-id>.jsonl`. Each line is one OpenTelemetry GenAI span, using the standard `gen_ai.*` attribute names, so the files can be read by OTel-compatible tools:

- a root `invoke_agent claude` span for the turn, with your prompt and Claude's final answer;
- a `chat <model>` span for each model request, with token usage and what the model returned;
- an `execute_tool <name>` span for each tool call, with its arguments and result;
- an `invoke_agent <type>` span for each subagent, nested under the `Agent` call that started it;
- `handhold.assess` spans holding the judge's scores, technique, nudge and rewrite, once before sending and once after the answer.

Set `redact` to `tool-results` to strip tool results, or `all-tool-io` to strip arguments too.

### Reflection and export

`/handhold review` reads these files and sends the averages, the most-missed techniques, and the weakest turns to the full model, which writes the reflection. If the model can't answer, you get a plain-text summary instead.

`/handhold export` writes two files to `~/.handhold/exports/` (or the path you give `--report`): an OTLP JSON file for any OpenTelemetry backend, and a Markdown progress report with scores and short before-and-after pairs. The report has no transcripts, so it's safe to share with a teacher or mentor.

### Where the code is

```
plugin/
  hooks/register.ts      the entry point; one hook per event, in order
  src/capture/           turns, model steps, tools and subagents -> spans -> files
  src/mentor/            the rubric, the trivial-request gate, judge, and reply parsing
  src/nudge/             the standing brief, the pre-send hint, back-off, and the note
  src/reflect/           reading traces, review, export, and the progress pane
  src/shared/            settings, /handhold routing, and the fall-through catch handler
  test/                  tests, with fixtures from the essay's examples
docs/superpowers/specs/  the design
docs/superpowers/plans/  the implementation plan
```

## Settings

Set these in the plugin's configuration: `mode` (`review`), `reviewBatch` (15), `fastModel` (Haiku 5.5), `turnModel` (Haiku 5.5, per-turn scoring), `reviewModel` (Opus 5.5, `/handhold review`), `preTimeoutMs` (2000), `postTimeoutMs` (20000), `redact` (`none`), `noteEvery` (3), and `traceRoot` (`~/.handhold/traces`).

## Privacy

Handhold has no server and no account. Traces stay on disk. The only network use is the judge calls and the reflection, which use your own Claude access. The history page is a local file with no network access; it shows tool names and timings but not tool arguments or results. Traces contain your prompts and Claude's answers in full, so treat the trace folder and any export as sensitive. The exports are the only files built to be shared, and the progress report has no transcripts.

## Limits

- Claude only. Other AI tools are out of scope for now.
- The fast judge is a cheap model, so it can miss requests a stronger model would score. That's a deliberate trade for speed and cost. Its scores are worth checking against the full judge's.
- It works only where local plugins run: Claude Code and, when verified, the desktop app. In the desktop app's Chat tab, the extension shows and reviews your Claude Code traces, but Chat conversations themselves aren't recorded (see "In the Chat tab").
- There's no shared dashboard for teachers. Progress reaches others only through exported files that you choose to share.

## Development

```sh
claude plugin validate plugin   # manifest and hooks
claude plugin test plugin       # the test suite
npx -p typescript tsc -p plugin # type-check (tsconfig includes the vendored engine types)
```

The engine's type declarations are vendored at `plugin/types/vendor/claude-code.d.ts` for build 2.1.325. Refresh them when the engine updates.

## License

MIT. See [LICENSE](LICENSE).
