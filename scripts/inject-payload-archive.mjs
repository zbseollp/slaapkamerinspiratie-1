#!/usr/bin/env node
/**
 * Inject Payload / content-collection posts that are missing from the scraped
 * Elementor blog archive into page-1 so new CMS articles appear on /blog/.
 *
 * Existing scraped cards are left intact. This only prepends cards for slugs
 * that are not linked anywhere under src/data/blog-archive/.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listBlogFiles, readPost, readField } from './lib/blog-files.mjs'
import { resolvePostImageFromFile } from './lib/resolve-post-image.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ARCHIVE_DIR = path.join(ROOT, 'src/data/blog-archive')
const PAGE1 = path.join(ARCHIVE_DIR, 'page-1.html')
const FALLBACK_IMAGE = '/uploads/2026/06/anaterate-farmhouse-7424128_1280-300x200.jpg'

const MONTHS_NL = [
  'januari',
  'februari',
  'maart',
  'april',
  'mei',
  'juni',
  'juli',
  'augustus',
  'september',
  'oktober',
  'november',
  'december',
]

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

const RESERVED = new Set([
  'blog',
  'contact',
  'bedden',
  'dekbed',
  'interieur',
  'kledingkasten',
  'verlichting',
  'sitemap',
  'index',
])

function isLive(frontmatter) {
  const status = String(readField(frontmatter, '_status') || readField(frontmatter, 'publishStatus') || '')
    .trim()
    .toLowerCase()
  if (PUBLISHED.has(status)) return true
  if (UNPUBLISHED.has(status)) return false
  const draft = readField(frontmatter, 'draft')
  if (draft === 'true' || draft === 'yes' || draft === '1') return false
  return true
}

function formatDateNl(value) {
  const d = value ? new Date(value) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  return `${MONTHS_NL[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function pickImage(filePath, body, featured) {
  const fromFile = resolvePostImageFromFile(filePath, ROOT)
  if (fromFile) return fromFile
  if (featured && (featured.startsWith('/') || /^https?:\/\//i.test(featured))) return featured
  const fromBody =
    body.match(/\/uploads\/[^"'\s)]+\.(?:jpe?g|png|webp)/i)?.[0] ||
    body.match(/src=["']([^"']+)["']/i)?.[1] ||
    ''
  return fromBody || FALLBACK_IMAGE
}

function excerptFrom(body, description) {
  if (description) return description.slice(0, 160)
  const text = body
    .replace(/export\s+const\s+__html\s*=\s*"((?:\\.|[^"\\])*)"/, (_, s) =>
      s.replace(/\\n/g, ' ').replace(/\\"/g, '"'),
    )
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 160)
}

function buildCard({ slug, title, description, dateLabel, imageUrl }) {
  const safeTitle = escapeHtml(title)
  const safeExcerpt = escapeHtml(description)
  return `<article class="elementor-post elementor-grid-item post type-post status-publish format-standard has-post-thumbnail hentry category-uncategorized" role="listitem">
				<a class="elementor-post__thumbnail__link" href="/${slug}/" tabindex="-1" >
			<div class="elementor-post__thumbnail"><img width="300" height="200" src="${escapeHtml(imageUrl)}" class="attachment-medium size-medium wp-post-image" alt="${safeTitle}" loading="lazy" decoding="async" /></div>
		</a>
				<div class="elementor-post__text">
				<p class="elementor-post__title">
			<a href="/${slug}/" >
				${safeTitle}			</a>
		</p>
				<div class="elementor-post__meta-data">
					<span class="elementor-post-date"><i aria-hidden="true" class="far fa-calendar-check"></i> ${escapeHtml(dateLabel)}</span>
				</div>
				<div class="elementor-post__excerpt">
			<p>${safeExcerpt}</p>
		</div>
				</div>
			</article>
`
}

function collectLinkedSlugs() {
  const linked = new Set()
  if (!fs.existsSync(ARCHIVE_DIR)) return linked
  for (const file of fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(ARCHIVE_DIR, file), 'utf8')
    for (const m of html.matchAll(/href="\/([^/"]+)\//g)) {
      linked.add(m[1])
    }
  }
  return linked
}

function main() {
  if (!fs.existsSync(PAGE1)) {
    console.log('[inject-payload-archive] no page-1.html — skip')
    return
  }

  const linked = collectLinkedSlugs()
  const missing = []

  for (const filePath of listBlogFiles()) {
    const post = readPost(filePath)
    if (!post.hasFrontmatter || !isLive(post.frontmatter)) continue
    if (!post.slug || RESERVED.has(post.slug)) continue
    if (linked.has(post.slug)) continue

    const title = readField(post.frontmatter, 'title') || post.slug
    const description = readField(post.frontmatter, 'description') || ''
    const pubDate =
      readField(post.frontmatter, 'pubDate') || readField(post.frontmatter, 'date') || ''
    const featured =
      readField(post.frontmatter, 'featuredImage') ||
      readField(post.frontmatter, 'heroImage') ||
      readField(post.frontmatter, 'image') ||
      ''

    missing.push({
      slug: post.slug,
      title,
      description: excerptFrom(post.body, description),
      dateLabel: formatDateNl(pubDate),
      imageUrl: pickImage(filePath, post.body, featured),
      sort: pubDate ? new Date(pubDate).getTime() : 0,
    })
  }

  if (!missing.length) {
    console.log('[inject-payload-archive] nothing to inject')
    return
  }

  missing.sort((a, b) => b.sort - a.sort)
  const cards = missing.map(buildCard).join('')

  let html = fs.readFileSync(PAGE1, 'utf8')
  const marker =
    'class="elementor-posts-container elementor-posts elementor-posts--skin-classic elementor-grid elementor-has-item-ratio"'
  const markerAlt =
    'class="elementor-posts-container elementor-posts elementor-posts--skin-classic elementor-grid"'

  let injected = false
  for (const m of [marker, markerAlt]) {
    const idx = html.indexOf(m)
    if (idx === -1) continue
    const openEnd = html.indexOf('>', idx)
    if (openEnd === -1) continue
    html = `${html.slice(0, openEnd + 1)}\n${cards}${html.slice(openEnd + 1)}`
    injected = true
    break
  }

  if (!injected) {
    console.error('[inject-payload-archive] could not find posts container in page-1.html')
    process.exit(1)
  }

  fs.writeFileSync(PAGE1, html)
  console.log(`[inject-payload-archive] injected ${missing.length} post(s) into page-1.html`)
}

main()
