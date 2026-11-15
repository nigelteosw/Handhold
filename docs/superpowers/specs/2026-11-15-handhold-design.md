# Handhold — design

Date: 2026-11-15
Status: draft for review

## 1. Purpose

Handhold is a local Claude plugin that mentors people to be more ambitious when working with AI. Its framework comes from Felix Rieseberg's essay *How to be more ambitious: a tutorial for humans with models* (felixrieseberg.com). It uses the essay's three ambition types (Speed is out of scope, as in the essay):

- **Altitude**: aim at the outcome, not the task ("the goal beyond the goal").
- **Depth**: do the task the way a field-leading expert would: their instruments, raw material, challenged assumptions, an outside judge.
- **Range**: draw on fields beyond the obvious one, using their methods rather than role-play.

### Users

- **B:** professionals in any industry, not programmers, who work with Claude.
- **C:** students, optionally sharing progress with a teacher.
- Technical users who already work this way are not the target.

### Success criteria

1. Every prompt the person sends and everything Claude returns, subagents included, is captured locally as OTel-shaped traces, with no reliance on the model choosing to log.
2. When a request warrants more ambition, Claude is nudged in the same turn to offer the more ambitious version, without overriding what the person asked for.
3. The person sees a short, concrete coaching note and can run a reflection that shows patterns and progress over time.
4. Nothing leaves the machine except the judge calls, which go through the person's own Claude model access.

### Constraints

- Claude only for v1. Codex, Gemini, opencode and pi are out of scope.
- All local: no MCP server, no remote backend, no browser extension.
- It ships as a Claude Code mod (function-hooks plugin, TypeScript). It runs in Claude Code (terminal, IDE) and the Claude desktop app.
- **Known reach limit:** the plain claude.ai chat tab (web or desktop) cannot load local plugins. Whether Cowork mode in the desktop app loads mods is **unverified** and is the first task of the plan.

## 2. Architecture

### Repository layout

The repo separates the installable plugin from project docs. The plugin itself is organised by the product's four concerns: capture, mentor, nudge and reflect.

```
Handhold/                              repository root
├── README.md                          what Handhold is, install, usage
├── docs/
│   └── superpowers/specs/             design specs (this file)
└── plugin/                            the mod: what --plugin-dir / install points at
    ├── .claude-plugin/
    │   └── plugin.json                name, version, description, types, userConfig
    ├── hooks/
    │   ├── hooks.json                 { "modules": ["./register.ts"] }
    │   └── register.ts                entry point: wires hooks to src/, no logic of its own
    ├── types/
    │   └── index.d.ts                 $.state contract (PluginState["handhold"])
    ├── src/
    │   ├── capture/                   1. what happened
    │   │   ├── hooks.ts               prompt.submit / turn.start / turn.step / tool.call / agent.spawn / turn.complete → spans
    │   │   ├── spans.ts               span model, trace/span ids, open-span table per turn
    │   │   ├── otel.ts                gen_ai.* attribute + message-part builders, schemaUrl
    │   │   └── sink.ts                one JSONL file per turn under ~/.handhold/traces, redaction
    │   ├── mentor/                    2. how ambitious it was
    │   │   ├── rubric.ts              rubric text, levels, technique list, RUBRIC_VERSION
    │   │   ├── gate.ts                cheap "warranted?" pre-filter (no model call)
    │   │   ├── judge.ts               builds judge prompt, calls $.model.complete, phase pre|post
    │   │   └── assessment.ts          Assessment type, JSON parse + validation → Assessment | null
    │   ├── nudge/                     3. steer Claude and the person
    │   │   ├── brief.ts               standing ambition brief (prompt.compose)
    │   │   ├── context.ts             per-turn hidden hint (prompt.submit)
    │   │   ├── backoff.ts             decline counting, per-session suppression
    │   │   └── note.ts                visible line under the answer, throttle, quiet
    │   ├── reflect/                   4. learn over time
    │   │   ├── read.ts                reads trace files, aggregates handhold.assess spans
    │   │   ├── review.ts              /handhold review [session|week]
    │   │   ├── export.ts              /handhold export: --otlp, --report
    │   │   └── pane.tsx               progress pane
    │   └── shared/
    │       ├── config.ts              userConfig defaults (models, timeouts, redact)
    │       ├── commands.ts            /handhold command registration + subcommand routing
    │       └── safe.ts                hook wrapper: any throw falls through to next(e)
    └── test/
        ├── fixtures/                  essay examples: qbr.ts, churn.ts, crash.ts, trivial.ts
        ├── capture.test.ts
        ├── mentor.test.ts
        ├── nudge.test.ts
        └── reflect.test.ts
```

Layout rules:

- `hooks/register.ts` is the only file the engine loads. It imports from `../src/**` and contains no logic, so each concern can be tested without the others.
- **Dependencies point one way:** `capture` and `mentor` don't import `nudge` or `reflect`; `shared` imports nothing from the others.
- Rubric wording lives in `mentor/rubric.ts` alone, so tuning the mentor never touches judge plumbing.
- `plugin/` sits beside `docs/`, not at the root. That leaves room for a root `.claude-plugin/marketplace.json` when the mod is shared, and for future adapters for other AI tools as sibling folders.

### Units

Each unit has one job and talks to the others through plain data: spans, assessments and settings.

| Unit | Does | Depends on |
|---|---|---|
| `capture/` | Turns hook events into OTel GenAI spans and writes each finished turn to `~/.handhold/traces/<session-id>/<turn-seq>-<turnId>.jsonl`; applies `redact` | `$.fs`, `$.state` |
| `mentor/` | Decides whether ambition is warranted, scores against the rubric, returns a validated `Assessment` or `null` | `$.model.complete` |
| `nudge/` | Standing brief (`prompt.compose`), per-turn hidden context (`prompt.submit`), back-off, visible note (`turn.complete` → `{ text }`) | `mentor/` |
| `reflect/` | `/handhold review`, `/handhold export`, progress pane | trace files, `mentor/rubric.ts`, `$.store` |
| `shared/` | Config, command routing (`/handhold quiet\|review\|export\|pane`), safe hook wrapper | — |

## 3. Trace format

It follows the OpenTelemetry GenAI semantic conventions. Each turn is written once, when it ends, as its own JSONL file (`$.fs.write` replaces whole files, so there is no appending); one line is one **finished span**. Attributes are a flat map, which is easy to read. `/handhold export --otlp` converts files to strict OTLP JSON (KeyValue arrays, resource/scope wrapping) for any OTel backend.

```json
{"traceId":"<32 hex>","spanId":"<16 hex>","parentSpanId":"<16 hex>|null",
 "name":"chat claude-opus-5-5","kind":"CLIENT",
 "startTimeUnixNano":"…","endTimeUnixNano":"…","status":{"code":"OK"},
 "schemaUrl":"https://opentelemetry.io/schemas/<pinned version>",
 "attributes":{ "gen_ai.operation.name":"chat", "…":"…" }}
```

### Span tree: one trace per turn

| Span name | `gen_ai.operation.name` | Opened / closed by | Attributes |
|---|---|---|---|
| `invoke_agent claude` (root) | `invoke_agent` | `prompt.submit` / `turn.complete` | `gen_ai.provider.name=anthropic`, `gen_ai.conversation.id` (session id), `gen_ai.input.messages` (the person's prompt), `gen_ai.output.messages` (final answer), `gen_ai.response.finish_reasons` (from `turn.complete` reason) |
| `chat <model>` | `chat` | a `turn.step` hook's call / its stream's `result` | `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.output.messages` |
| `execute_tool <tool>` | `execute_tool` | `tool.call` hook before / after `await next(e)` | `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result` |
| `invoke_agent <agent type>` | `invoke_agent` | `agent.spawn` (its `tool_use_id` and the resolved `agentId`) / that agent's `turn.complete` | `gen_ai.agent.id`, `gen_ai.agent.name` (`subagentType`); parent is the `execute_tool` span whose `gen_ai.tool.call.id` equals the spawn's `tool_use_id`; its own `chat`/`execute_tool` children |
| `handhold.assess` | `handhold.assess` (custom) | each judge run | `handhold.*` (section 4), `handhold.judge.phase` = `pre` or `post` |

Messages use the GenAI message schema: `{ role, parts: [{ type: "text", content } | { type: "tool_call", id, name, arguments } | { type: "tool_call_response", id, response }] }`.

### Rules

- **Content is captured in full.** OTel makes content opt-in. Here it is the product's input, and it stays local.
- **Redaction:** `userConfig.redact` = `none` (default) | `tool-results` | `all-tool-io`. Redacted values become `"[redacted]"`.
- `handhold.rubric.version` is set on every `handhold.assess` span.
- Spans still open when the session ends are closed with `status.code=ERROR`, `status.message="session ended"`.
- The GenAI conventions are in OTel "Development" status. `schemaUrl` pins the version used so later readers can map renamed attributes.

## 4. Rubric

### Step 0: is ambition warranted?

Trivial lookups, tone fixes and small talk get `warranted=false` and are not scored or nudged. A cheap check runs first: very short prompts and those matching simple lookup patterns are skipped without calling a model. The judge itself makes the final call.

### Scores (0–3), based on what the person did; the AI's work is context only

| | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| **Altitude** | Single micro-task, no purpose stated | Task plus context | States the goal behind the task; lets the model choose the approach | Delegates an ongoing outcome; sets up access and verification so the human can leave the loop |
| **Depth** | Digested input; accepts a surface answer | Asks for expert quality in vocabulary only | Raw material; insists on the expert's real methods and tools; challenges an assumption | Unreasonable goal; outside judge or test; asks for new knowledge |
| **Range** | Single field | Mentions another perspective | Recasts nouns as verbs; assembles a crew of fields | Uses those fields' real methods (not role-play), including a red team |

For creative work the judge does not push Altitude, because the essay notes it fits there less well.

### Techniques (closed list, used for nudges and review patterns)

`goal-beyond-the-goal`, `durable-workflow`, `insist-on-instruments`, `unreasonable-goal`, `challenge-assumptions`, `produce-new-knowledge`, `outside-judge`, `nouns-to-verbs`, `assemble-the-crew`.

### Assessment (strict JSON; invalid output means `null`)

```json
{"warranted":true,
 "scores":{"altitude":1,"depth":0,"range":0},
 "evidence":{"altitude":"<quote from prompt>","depth":"…","range":"…"},
 "opportunity":"altitude",
 "technique":"goal-beyond-the-goal",
 "nudge":"<one sentence for the person>",
 "rewrite":"<the more ambitious prompt>"}
```

It is stored on `handhold.assess` as `handhold.warranted`, `handhold.score.altitude|depth|range`, `handhold.opportunity`, `handhold.technique`, `handhold.nudge`, `handhold.rewrite`, `handhold.evidence.*`.

### What the judge sees

- The person's prompt.
- A compact turn summary: tools used, subagents, outcome (post phase only).
- The last 5 assessments of the session.

Never the full transcript.

## 5. Nudging

Handhold nudges through three channels.

**1. Standing ambition brief (to Claude).**
- A `prompt.compose` hook adds one section with `scope: 'session'`, last in the system prompt.
- It condenses the essay into working instructions: look for the goal beyond the goal; use experts' instruments, not their vocabulary; start from raw data; challenge stated assumptions; insist on outside validation instead of self-judging; recast nouns as verbs to find other fields; use those fields' methods, not role-play.
- It says to skip all of this for trivial requests.
- It is under 250 tokens.

**2. Per-turn hidden context (to Claude), from the pre-send judge.**
- `prompt.submit` runs the fast judge: model `claude-haiku-5-5`, `timeoutMs` 2000.
- If the result is warranted with a dimension ≤ 1, the hook calls `next({ ...e, context: [...(e.context ?? []), hint] })`. The hint names the dimension, its score and the technique, and tells Claude: *offer the more ambitious version in one or two lines first, then do what was asked unless the user takes it up.*
- The person's text is never rewritten.
- **Back-off:** if Claude offered a technique and the person's next prompt does not take it up, that counts as a decline. After 2 declines of a technique in a session, it is suppressed for the rest of the session.
- On timeout or `null`, the prompt enters unchanged.

**3. Visible note (to the person), from the post-answer judge.**
- At `turn.complete`, the full judge (`claude-opus-5-5`, `timeoutMs` 20000) scores the turn with its summary.
- The hook returns `{ text }` with one line beneath the answer, e.g. `Handhold · Altitude 1 → try: "<rewrite>"`.
- It is shown at most once every 3 turns, and only when a dimension ≤ 1 and the result is warranted.
- `/handhold quiet` mutes notes for the session; `/handhold quiet off` restores them.
- The post-phase assessment is always recorded, even when no note is shown.

Both judge models can be set through `userConfig`.

## 6. Reflection

- **`/handhold review [session|week]`**
  - Reads the trace files and aggregates `handhold.assess` spans.
  - Asks the full model for a reflection: recurring patterns (most frequent techniques missed), the 3 best moments, 3 before/after rewrites drawn from the person's own prompts, and score trends.
  - Returns `{ text }`.
- **`/handhold export [--otlp] [--report]`**
  - `--report` writes a Markdown progress report to a path the person chooses, for a student to share with a teacher.
  - `--otlp` writes strict OTLP JSON.
  - Without flags it does both.
- **Progress pane:** opened with `/handhold pane`. It shows per-dimension averages for this session and the last 7 days, plus the current suppressed techniques. Rolling aggregates live in `$.store` so they survive across sessions.

## 7. Error handling

- No Handhold failure blocks, rewrites or delays a prompt beyond the pre-send budget (2 s).
- Judge errors, timeouts or invalid JSON give `null`: no nudge, no note, and one debug-log line.
- A sink write failure drops the span and sets `$.ui.status("Handhold: trace write failed")` once per session.
- Every hook body is wrapped so a thrown error falls through to `next(e)` unchanged.

## 8. Testing

Tests run with `claude plugin test`, plus `claude plugin validate` and `tsc -p`. Fixtures come from the essay's examples: QBR deck, churn analysis, crash fixing, plus a trivial lookup.

1. **Span shape:** each emitted line has the required OTel fields; names and `gen_ai.operation.name` match the table; parent links form one tree per turn.
2. **Subagents:** turns with an `agentId` nest under the spawning `execute_tool` span as `invoke_agent <type>`.
3. **Warranted gate:** "capital of France" gives no model call, no context and no note.
4. **Pre-send nudge:** a low-altitude QBR prompt (judge stubbed to Altitude 1) adds exactly one context entry naming `goal-beyond-the-goal`; the prompt text is unchanged.
5. **Back-off:** two declines suppress that technique for the session.
6. **Failure paths:** judge timeout or invalid JSON leaves the prompt and answer unchanged; a sink failure sets the status once.
7. **Redaction:** each `redact` mode strips the right attributes.
8. **Note throttle:** at most one note per 3 turns; `quiet` suppresses all notes.

## 9. Out of scope (v1)

Other AI tools; MCP or remote services; a shared teacher dashboard; the claude.ai chat tab; scoring Speed; inline UI cards.

## 10. Open items to resolve first in the plan

1. Verify whether Cowork mode in the Claude desktop app loads mods; if not, document the supported modes (Claude Code in terminal, IDE and desktop).
2. Verify `$.fs` may write under `~/.handhold`. If not, fall back to a path the engine allows and record that path in the spec.
3. Resolved while planning: tools are captured by `tool.call`; subagents link through `agent.spawn` (`tool_use_id` → `agentId`); model requests are `turn.step` streams whose `result` carries `answer`, `toolUses`, `stopReason` and `usage`.
