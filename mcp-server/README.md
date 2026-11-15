# Handhold for the desktop app's Chat tab

The Chat tab can't run plugins, but the Claude desktop app connects local MCP servers to it. This server reads the trace files the Handhold plugin writes (`~/.handhold/traces`) and gives Chat:

- `handhold_history`: your Handhold history as a panel inside the chat (an MCP App), plus a short text summary. Chores like "merge it" show as quick requests, not as work waiting for a review.
- `handhold_review_data`: your turns, for Claude in the chat to write you a review. If some turns haven't been scored, it first asks Claude to score them against the rubric.
- `handhold_save_scores`: saves those scores. Each one is checked with the plugin's own parser and written to the turn's trace file in the same format `/handhold review` uses, so a turn is never scored twice and both see the same scores.

There are no extra model calls and no API key. Claude in your chat does the scoring and writing, within your normal usage. The server records nothing itself: turns come from your Claude Code sessions, where the plugin runs. It reuses the plugin's own code (`plugin/src/reflect`) for reading, history and aggregation.

In Chat, ask "Show my Handhold history" or "Give me a Handhold review", or use the plugin's `/history` and `/review` skills, which route here when this server is connected.

## Install (one click)

```sh
cd mcp-server && npm install && npm run pack
```

Open `mcp-server/out/handhold.mcpb` with the Claude desktop app (double-click it, or drag it onto Settings → Extensions) and install. You can change the trace folder in the extension's settings.

## Install (by hand, while developing)

Run `npm run build`, then add this to `~/Library/Application Support/Claude/claude_desktop_config.json`, using absolute paths:

```json
{ "mcpServers": { "handhold": { "command": "/path/to/node", "args": ["/path/to/Handhold/mcp-server/dist/server.mjs"] } } }
```

Restart the desktop app. Set `HANDHOLD_TRACE_ROOT` in the entry's `env` if your traces aren't in `~/.handhold/traces`.

## Development

```sh
npm test            # builds, then drives the server over stdio against a temporary trace folder
npm run typecheck
npm run pack        # out/handhold.mcpb
```

Desktop app only: claude.ai on the web can't reach a server on your machine.
