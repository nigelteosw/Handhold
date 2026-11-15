// Bundles the server (with the plugin's reflect code it imports) into dist/server.mjs, and inlines the
// panel's HTML, with the MCP Apps client, as VIEW_HTML. The panel runs in a sandboxed frame inside the
// chat, so it carries its own script rather than loading one from the network.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const appClientPath = require.resolve('@modelcontextprotocol/ext-apps/app-with-deps')
let client = readFileSync(appClientPath, 'utf8')

// The client bundle ends in `export{a as App,...}`. Inline modules can't be imported from, so turn that
// export list into a global the panel reads.
const exportList = client.match(/export\s*\{([^}]*)\}\s*;?\s*$/)
if (!exportList) throw new Error('ext-apps client bundle changed shape: update build.mjs')
const names = exportList[1].split(',').map(p => p.trim().split(/\s+as\s+/)).map(([local, name]) => `${name ?? local}:${local}`)
client = client.slice(0, exportList.index) + `window.McpApps={${names.join(',')}};`

const view = readFileSync(new URL('./src/view.html', import.meta.url), 'utf8')
if (!view.includes('/*__APP_CLIENT__*/')) throw new Error('view.html lost its client marker')
// A function replacement, so `$` sequences in the minified client are not read as patterns.
const html = view.replace('/*__APP_CLIENT__*/', () => client.replace(/<\/script/gi, '<\\/script'))

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  define: { VIEW_HTML: JSON.stringify(html) },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
})
console.log(`built dist/server.mjs (panel ${Math.round(html.length / 1024)} KB)`)
