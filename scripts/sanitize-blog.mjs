#!/usr/bin/env node
/**
 * Heal Payload-synced blog files so `astro build` does not abort.
 *
 * Payload sync often writes `.mdx`. MDX treats `{…}` as JSX expressions
 * → "Could not parse expression with acorn".
 *
 * Strategy:
 * 1. Legacy WordPress posts (`WpContent` / `export const __html`) stay as `.mdx`.
 * 2. Payload Lexical markdown is rewritten to `.md` so the MDX JSX parser
 *    never touches editorial braces / `<`.
 * 3. Remaining markdown bodies still get brace / `<` escaping as a safety net.
 */
import { readdir, readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BLOG_DIR = path.join(ROOT, 'src/content/blog')

function splitFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { fm: '', body: raw }
  return { fm: match[1], body: match[2] }
}

function isLegacyHtmlExport(body) {
  return (
    /export\s+const\s+__html\s*=/.test(body) ||
    /import\s+WpContent\s+from/.test(body) ||
    /<WpContent\b/.test(body)
  )
}

function mapOutsideCodeFences(md, fn) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n')
  const out = []
  let inFence = false
  let chunk = []

  const flush = () => {
    if (!chunk.length) return
    out.push(fn(chunk.join('\n')))
    chunk = []
  }

  for (const line of lines) {
    if (/^(`{3,}|~{3,})/.test(line.trimStart())) {
      flush()
      out.push(line)
      inFence = !inFence
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    chunk.push(line)
  }
  flush()
  return out.join('\n')
}

function escapeStrayLessThan(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] !== '<') {
      out += text[i]
      i += 1
      continue
    }
    const rest = text.slice(i)
    const tagMatch = rest.match(/^<\/?[A-Za-z][\w:-]*(?:\s[^<>]*?)?\/?>/)
    if (tagMatch) {
      out += tagMatch[0]
      i += tagMatch[0].length
      continue
    }
    out += '&lt;'
    i += 1
  }
  return out
}

/** Escape `{` / `}` so MDX does not treat Dutch prose as JS expressions. */
function escapeMdxBraces(text) {
  return text.replace(/(?<!\\)\{/g, '\\{').replace(/(?<!\\)\}/g, '\\}')
}

function sanitizeMarkdownBody(body) {
  let out = String(body || '').replace(/\u0000/g, '')
  out = out.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
  out = mapOutsideCodeFences(out, (chunk) => {
    let text = chunk.replace(/<!--[\s\S]*?-->/g, '')
    text = text.replace(/<!DOCTYPE[^>]*>/gi, '')
    text = escapeStrayLessThan(text)
    text = escapeMdxBraces(text)
    return text
  })
  return out
}

let converted = 0
let healed = 0
let skipped = 0

const files = (await readdir(BLOG_DIR)).filter((f) => f.endsWith('.md') || f.endsWith('.mdx'))
for (const file of files) {
  const filePath = path.join(BLOG_DIR, file)
  const raw = await readFile(filePath, 'utf8')
  const { fm, body } = splitFrontmatter(raw)
  if (!fm) {
    skipped += 1
    continue
  }

  // Payload sync → plain markdown/HTML. Prefer .md so Astro never runs MDX/JSX.
  if (file.endsWith('.mdx') && !isLegacyHtmlExport(body)) {
    const nextBody = sanitizeMarkdownBody(body)
    const mdPath = path.join(BLOG_DIR, file.replace(/\.mdx$/i, '.md'))
    await writeFile(mdPath, `---\n${fm}\n---\n${nextBody}`, 'utf8')
    if (mdPath !== filePath) await unlink(filePath)
    converted += 1
    console.log(`[sanitize:blog] converted ${file} → ${path.basename(mdPath)}`)
    continue
  }

  if (isLegacyHtmlExport(body)) {
    skipped += 1
    continue
  }

  const nextBody = sanitizeMarkdownBody(body)
  if (nextBody === body) {
    skipped += 1
    continue
  }
  await writeFile(filePath, `---\n${fm}\n---\n${nextBody}`, 'utf8')
  healed += 1
  console.log(`[sanitize:blog] healed ${file}`)
}

console.log(
  `[sanitize:blog] converted=${converted}, healed=${healed}, skipped=${skipped}`,
)
