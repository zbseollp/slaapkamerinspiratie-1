#!/usr/bin/env node
/**
 * Prepend newest Payload / content-collection posts onto the homepage blog
 * grid when they are missing, so CMS publishes appear on `/` without a scrape.
 * Caps injections so the homepage does not grow unbounded.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listBlogFiles, readPost, readField } from './lib/blog-files.mjs'
import { resolvePostImageFromFile } from './lib/resolve-post-image.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const MAIN_HTML = path.join(ROOT, 'src/data/homepage/main.html')
const MAX_INJECT = 4

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
  const status = String(
    readField(frontmatter, '_status') || readField(frontmatter, 'publishStatus') || '',
  )
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

function excerptFrom(body, description) {
  if (description) return description.slice(0, 140)
  const text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 140)
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

function main() {
  if (!fs.existsSync(MAIN_HTML)) {
    console.log('[inject-payload-homepage] no main.html — skip')
    return
  }

  let html = fs.readFileSync(MAIN_HTML, 'utf8')
  const linked = new Set(
    [...html.matchAll(/href="\/([^/"]+)\//g)].map((m) => m[1]),
  )

  const missing = []
  for (const filePath of listBlogFiles()) {
    const post = readPost(filePath)
    if (!post.hasFrontmatter || !isLive(post.frontmatter)) continue
    if (!post.slug || RESERVED.has(post.slug) || linked.has(post.slug)) continue
    // Only inject Payload-style posts (not legacy WpContent scrapes already on site).
    if (
      /WpContent|export\s+const\s+__html/.test(post.body) &&
      fs.existsSync(path.join(ROOT, 'src/data/blog-pages', `${post.slug}.html`))
    ) {
      continue
    }

    const title = readField(post.frontmatter, 'title') || post.slug
    const description = readField(post.frontmatter, 'description') || ''
    const pubDate =
      readField(post.frontmatter, 'pubDate') || readField(post.frontmatter, 'date') || ''

    missing.push({
      slug: post.slug,
      title,
      description: excerptFrom(post.body, description),
      dateLabel: formatDateNl(pubDate),
      imageUrl: resolvePostImageFromFile(filePath, ROOT),
      sort: pubDate ? new Date(pubDate).getTime() : 0,
    })
  }

  if (!missing.length) {
    console.log('[inject-payload-homepage] nothing to inject')
    return
  }

  missing.sort((a, b) => b.sort - a.sort)
  const toInject = missing.slice(0, MAX_INJECT)
  const cards = toInject.map(buildCard).join('')

  const markers = [
    'class="elementor-posts-container elementor-posts elementor-posts--skin-classic elementor-grid elementor-has-item-ratio"',
    'class="elementor-posts-container elementor-posts elementor-posts--skin-classic elementor-grid"',
  ]

  let injected = false
  for (const m of markers) {
    const idx = html.indexOf(m)
    if (idx === -1) continue
    const openEnd = html.indexOf('>', idx)
    if (openEnd === -1) continue
    html = `${html.slice(0, openEnd + 1)}\n${cards}${html.slice(openEnd + 1)}`
    injected = true
    break
  }

  if (!injected) {
    console.log('[inject-payload-homepage] posts container not found — skip')
    return
  }

  fs.writeFileSync(MAIN_HTML, html)
  console.log(
    `[inject-payload-homepage] injected ${toInject.length} post(s): ${toInject.map((p) => p.slug).join(', ')}`,
  )
}

main()
