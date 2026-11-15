# Agent notes for Handhold

## Releasing: always bump the version

`plugin/.claude-plugin/plugin.json` pins an explicit `version`, and Claude Code caches installed plugins by that version. **Any PR that changes what ships in `plugin/` must bump it**, or existing installs never see the change, even after `/plugin update`.

- Bump in the same PR as the change, not afterwards.
- Pre-1.0 semver: patch (`0.2.0` → `0.2.1`) for fixes and small behaviour changes; minor (`0.2.x` → `0.3.0`) for new features or changed defaults.
- Update the version in both places:
  - `plugin/.claude-plugin/plugin.json` (`"version"`)
  - `plugin/src/reflect/export.ts` (the OTLP `scope.version`)

## Checks before a PR

```bash
claude plugin validate plugin
claude plugin test plugin
```

The tests import `claude-code/testing`, which resolves only under `claude plugin test`. Plain `tsx`/`node --test` cannot run them.

## The Chat skill

`chat-skill/handhold-review/SKILL.md` is generated from `plugin/src/mentor/rubric.ts` and `plugin/src/nudge/brief.ts`. Edit `chat-skill/template.md`, never the generated file. After changing the rubric, the brief or the template, rebuild it in the same PR:

```bash
node chat-skill/build.ts          # regenerate SKILL.md and dist/handhold-review.zip
node chat-skill/build.ts --check  # fails if SKILL.md is out of date
```

It lives outside `plugin/`, so changing it alone needs no version bump.

## The Chat-tab MCP server

`mcp-server/` bundles code from `plugin/src/reflect`, so a change there can break it. When you touch either, run:

```bash
cd mcp-server && npm test && npm run typecheck
```

Its version is in `mcp-server/manifest.json`, separate from the plugin's. Bump it when what the extension does changes.
