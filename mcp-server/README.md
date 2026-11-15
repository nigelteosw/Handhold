# Handhold for the desktop app's Chat tab

The Chat tab can't run plugins, but the Claude desktop app connects local MCP servers to it. This server reads the same trace files the plugin writes (`~/.handhold/traces`) and gives Chat:

- `handhold_history`: your Handhold history as a panel inside the chat (an MCP App), plus a short text summary.
- `handhold_review_data`: your scored turns, for Claude in the chat to write you a review. No extra model calls or API key.

It records nothing itself. Turns come from your Claude Code sessions, where the plugin runs. The trace reading, history rows and review aggregation are the plugin's own code (`plugin/src/reflect`), bundled in, so both see the same data.

## Try it

```sh
cd mcp-server && npm install && npm run build
```

Add it to `~/Library/Application Support/Claude/claude_desktop_config.json`, using absolute paths:

```json
{ "mcpServers": { "handhold": { "command": "/path/to/node", "args": ["/path/to/Handhold/mcp-server/dist/server.mjs"] } } }
```

Restart the desktop app, then ask in Chat: "Show my Handhold history". Set `HANDHOLD_TRACE_ROOT` in the server's `env` if your traces aren't in `~/.handhold/traces`.

Desktop app only: claude.ai on the web can't reach a server on your machine.
