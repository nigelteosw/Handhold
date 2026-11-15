// Builds the Chat skill from the plugin's own rubric and brief, so the two can't drift apart.
//
//   node chat-skill/build.ts           writes chat-skill/handhold-review/SKILL.md and dist/handhold-review.zip
//   node chat-skill/build.ts --check   fails if the checked-in SKILL.md is out of date (no writes)
//
// Node 22.18+ runs this TypeScript directly. The two plugin files it imports have no runtime imports.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { RUBRIC_TEXT, TECHNIQUE_LABELS } from '../plugin/src/mentor/rubric.ts'
import { BRIEF_TEXT } from '../plugin/src/nudge/brief.ts'

const here = dirname(fileURLToPath(import.meta.url))
const skillDir = join(here, 'handhold-review')
const skillPath = join(skillDir, 'SKILL.md')
const zipPath = join(here, 'dist', 'handhold-review.zip')

// The judge's levels, without its JSON instructions: from the first dimension up to the technique list.
function rubricLevels(): string {
  const start = RUBRIC_TEXT.indexOf('Altitude (outcome over task):')
  const end = RUBRIC_TEXT.indexOf('\n\nTechniques (')
  if (start < 0 || end < start) throw new Error('rubric.ts changed shape: update rubricLevels() in chat-skill/build.ts')
  return RUBRIC_TEXT.slice(start, end).trim()
}

export function render(template: string): string {
  const techniques = Object.values(TECHNIQUE_LABELS).map(label => `- ${label}`).join('\n')
  const out = template
    .replace('{{RUBRIC}}', rubricLevels())
    .replace('{{TECHNIQUES}}', techniques)
    .replace('{{BRIEF}}', BRIEF_TEXT)
  const left = out.match(/\{\{[A-Z]+\}\}/)
  if (left) throw new Error(`template placeholder not filled: ${left[0]}`)
  return out
}

const built = render(readFileSync(join(here, 'template.md'), 'utf8'))

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(skillPath, 'utf8')
  } catch {
    // Missing counts as out of date.
  }
  if (current !== built) {
    console.error('chat-skill/handhold-review/SKILL.md is out of date. Run: node chat-skill/build.ts')
    process.exit(1)
  }
  console.log('chat skill is up to date')
} else {
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(skillPath, built)
  mkdirSync(dirname(zipPath), { recursive: true })
  rmSync(zipPath, { force: true })
  // The zip holds the skill's folder at its root, which is what claude.ai's skill upload expects.
  execFileSync('zip', ['-q', '-r', '-X', zipPath, 'handhold-review'], { cwd: here })
  console.log(`wrote ${skillPath}\nwrote ${zipPath}`)
}
