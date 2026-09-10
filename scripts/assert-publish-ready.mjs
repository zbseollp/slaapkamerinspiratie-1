#!/usr/bin/env node
/**
 * Fail the build when markdown exists but nothing would be listed live.
 * Prevents "Payload published, site stayed empty" deploys.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BLOG_DIR = path.join(ROOT, 'src/content/blog')
const CONFIG = path.join(ROOT, 'astropayload.config.json')

const UNPUBLISHED = new Set([
  'draft',
  'private',
  'pending',
  'trash',
  'auto-draft',
  'inherit',
  'future',
  'scheduled',
  'unpublished',
])
const PUBLISHED = new Set(['publish', 'published', 'live', 'public'])

function splitFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return {}
  const data = {}
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!m) continue
    let v = (m[2] || '').trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    data[m[1]] = v
  }
  return data
}

function isLive(data) {
  const status = String(data._status || data.publishStatus || '')
    .trim()
    .toLowerCase()
  if (PUBLISHED.has(status)) return true
  if (UNPUBLISHED.has(status)) return false
  if (data.draft === 'true' || data.draft === true) return false
  if (typeof data.draft === 'string' && ['draft', 'yes', '1'].includes(data.draft.toLowerCase())) {
    return false
  }
  return true
}

let floor = 1
try {
  const cfg = JSON.parse(await readFile(CONFIG, 'utf8'))
  if (typeof cfg.blogMinCount === 'number' && cfg.blogMinCount >= 0) floor = cfg.blogMinCount
} catch {
  /* default */
}
if (process.env.BLOG_MIN_COUNT !== undefined) {
  const n = Number(process.env.BLOG_MIN_COUNT)
  if (Number.isFinite(n)) floor = n
}

const files = (await readdir(BLOG_DIR)).filter((f) => f.endsWith('.md') || f.endsWith('.mdx'))
let live = 0
let drafts = 0
for (const file of files) {
  const raw = await readFile(path.join(BLOG_DIR, file), 'utf8')
  if (isLive(splitFrontmatter(raw))) live += 1
  else drafts += 1
}

if (files.length > 0 && live === 0) {
  console.error(
    `\n[assert-publish-ready] BUILD AFGEBROKEN — ${files.length} bestand(en), 0 live.\n` +
      `Alle artikelen worden als draft gezien. De live site blijft staan.\n`,
  )
  process.exit(1)
}

if (floor > 0 && live < floor) {
  console.error(
    `\n[assert-publish-ready] BUILD AFGEBROKEN — ${live} live artikel(en), ondergrens ${floor}` +
      `${drafts ? ` (${drafts} draft)` : ''}.\n`,
  )
  process.exit(1)
}

console.log(
  `[assert-publish-ready] ${live} live artikel(en)` +
    `${drafts ? `, ${drafts} draft` : ''} — in orde`,
)
