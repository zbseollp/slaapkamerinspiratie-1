#!/usr/bin/env node
/**
 * Clean and enrich fetched blog archive HTML (unique thumbnails, calendar icons).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBlogImageMap, preferExistingPublicUrl } from './lib/resolve-post-image.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://slaapkamerinspiratie.nl';
const ARCHIVE_DIR = path.join(ROOT, 'src/data/blog-archive');
const BLOG_MDX_DIR = path.join(ROOT, 'src/content/blog');
const BLOG_MANIFEST = path.join(ROOT, 'src/data/blog-pages/manifest.json');
const WP_XML = path.join(ROOT, 'slaapkamerinspiratienl.WordPress.2026-07-03.xml');
const FALLBACK_IMAGE = '/uploads/2026/06/anaterate-farmhouse-7424128_1280-300x200.jpg';

function toLocalUrl(url) {
  if (!url) return '';
  return url
    .replace(SITE, '')
    .replace('/wp-content/uploads/', '/uploads/')
    .split('?')[0];
}

function toMediumUrl(url) {
  const local = toLocalUrl(url);
  if (!local) return '';
  const sized = local.replace(
    /(\/uploads\/\d{4}\/\d{2}\/)([^/]+?)(-\d+x\d+)?\.(jpe?g|png|webp)$/i,
    (_, prefix, base, _size, ext) => `${prefix}${base}-300x200.${ext}`
  );
  return sized !== local ? sized : local;
}

function pickBestLocalImage(url) {
  const local = toLocalUrl(url);
  if (!local) return FALLBACK_IMAGE;

  const baseMatch = local.match(/^(\/uploads\/\d{4}\/\d{2}\/)(.+?)(-\d+x\d+)?\.(jpe?g|png|webp)$/i);
  const candidates = [local];

  if (baseMatch) {
    const [, prefix, base, , ext] = baseMatch;
    candidates.push(
      `${prefix}${base}-300x200.${ext}`,
      `${prefix}${base}-768x512.${ext}`,
      `${prefix}${base}-1024x682.${ext}`,
      `${prefix}${base}.${ext}`
    );
  }

  for (const candidate of [...new Set(candidates)]) {
    if (fs.existsSync(path.join(ROOT, 'public', candidate))) {
      return candidate;
    }
  }

  return FALLBACK_IMAGE;
}

function loadWpThumbnails() {
  const bySlug = {};
  if (!fs.existsSync(WP_XML)) return bySlug;

  const xml = fs.readFileSync(WP_XML, 'utf-8');
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const attachments = {};

  for (const chunk of items) {
    const id = chunk.match(/<wp:post_id>(\d+)<\/wp:post_id>/)?.[1];
    const type = chunk.match(/<wp:post_type><!\[CDATA\[([^\]]+)\]\]>/)?.[1];
    if (!id || type !== 'attachment') continue;

    const url = chunk.match(/<wp:attachment_url><!\[CDATA\[([^\]]+)\]\]>/)?.[1];
    const file = chunk.match(
      /<wp:meta_key><!\[CDATA\[_wp_attached_file\]\]><\/wp:meta_key>\s*<wp:meta_value><!\[CDATA\[([^\]]+)\]\]>/
    )?.[1];
    attachments[id] = url ? toLocalUrl(url) : file ? `/uploads/${file}` : '';
  }

  for (const chunk of items) {
    const type = chunk.match(/<wp:post_type><!\[CDATA\[([^\]]+)\]\]>/)?.[1];
    if (type !== 'post') continue;
    const slug = chunk.match(/<wp:post_name><!\[CDATA\[([^\]]+)\]\]>/)?.[1];
    const thumbId = chunk.match(
      /<wp:meta_key><!\[CDATA\[_thumbnail_id\]\]><\/wp:meta_key>\s*<wp:meta_value><!\[CDATA\[(\d+)\]\]>/
    )?.[1];
    if (slug && thumbId && attachments[thumbId]) {
      bySlug[slug] = attachments[thumbId];
    }
  }

  return bySlug;
}

function loadBlogManifestImages() {
  const bySlug = {};
  if (!fs.existsSync(BLOG_MANIFEST)) return bySlug;
  const manifest = JSON.parse(fs.readFileSync(BLOG_MANIFEST, 'utf8'));
  for (const [slug, meta] of Object.entries(manifest)) {
    if (meta.ogImage) bySlug[slug] = meta.ogImage;
  }
  return bySlug;
}

function pickMdxImage(slug) {
  const candidates = [`${slug}.mdx`, `${slug}.md`].map((f) => path.join(BLOG_MDX_DIR, f));
  const filePath = candidates.find((p) => fs.existsSync(p));
  if (!filePath) return '';

  const content = fs.readFileSync(filePath, 'utf8');
  const images = [...content.matchAll(/\/uploads\/[^"\\]+\.(?:jpe?g|png|webp)/gi)].map((m) =>
    m[0].replace(/\\"/g, '')
  );
  const filtered = images.filter((img) => !/32x32|150x150|cropped-group|Group-18|icon/i.test(img));
  return filtered.length ? filtered[0] : '';
}

function resolveImage(slug, wpThumbs, manifestImages, blogImages) {
  const raw =
    blogImages.get(slug) ||
    wpThumbs[slug] ||
    manifestImages[slug] ||
    pickMdxImage(slug);
  return raw ? pickBestLocalImage(preferExistingPublicUrl(raw, ROOT)) : FALLBACK_IMAGE;
}

function buildThumbnail(slug, imageUrl, title) {
  const safeTitle = title.replace(/"/g, '&quot;');
  return `<a class="elementor-post__thumbnail__link" href="/${slug}/" tabindex="-1">
\t\t\t<div class="elementor-post__thumbnail"><img width="300" height="200" src="${imageUrl}" class="attachment-medium size-medium wp-post-image" alt="${safeTitle}" loading="lazy" decoding="async" /></div>
\t\t</a>
\t\t\t\t`;
}

function addCalendarIcons(html) {
  return html.replace(
    /<span class="elementor-post-date">\s*([^<]+?)\s*<\/span>/g,
    (_, date) =>
      `<span class="elementor-post-date"><i aria-hidden="true" class="far fa-calendar-check"></i> ${date.trim()}</span>`
  );
}

function enrichArticle(articleHtml, slug, title, imageUrl) {
  const safeTitle = title.trim();
  let updated = articleHtml;

  if (updated.includes('elementor-post__thumbnail')) {
    updated = updated.replace(
      /(<div class="elementor-post__thumbnail"><img[^>]+src=")[^"]+("[^>]*>)/i,
      `$1${imageUrl}$2`
    );
    updated = updated.replace(
      /(<div class="elementor-post__thumbnail"><img[^>]+alt=")[^"]*(")/i,
      `$1${safeTitle.replace(/"/g, '&quot;')}$2`
    );
  } else {
    const thumbnail = buildThumbnail(slug, imageUrl, safeTitle);
    updated = updated.replace(
      /(<article class="elementor-post[^"]*)([^"]*)"([^>]*role="listitem">)\s*<div class="elementor-post__text">/i,
      `$1 has-post-thumbnail$2"$3
\t\t\t\t${thumbnail}<div class="elementor-post__text">`
    );
  }

  if (!updated.includes('has-post-thumbnail')) {
    updated = updated.replace(
      /(<article class="elementor-post)([^"]*)(")/i,
      '$1 has-post-thumbnail$2$3'
    );
  }

  return updated;
}

function processHtml(html, wpThumbs, manifestImages, blogImages) {
  let result = html;

  if (!/id="content"/.test(result)) {
    result = result.replace(
      /(<div\s+)data-elementor-type="wp-page" data-elementor-id="688"/,
      '$1id="content" data-elementor-type="wp-page" data-elementor-id="688"'
    );
  }

  result = result.replace(/\ssrc="data:image\/svg\+xml[^"]*"/gi, '');

  result = result.replace(
    'class="elementor-posts-container elementor-posts elementor-posts--skin-classic elementor-grid"',
    'class="elementor-posts-container elementor-posts elementor-posts--skin-classic elementor-grid elementor-has-item-ratio"'
  );

  result = result.replace(
    /<article class="elementor-post[^"]*"[^>]*role="listitem">[\s\S]*?<\/article>/g,
    (articleHtml) => {
      const slugMatch = articleHtml.match(/href="\/([^/]+)\/"[^>]*>\s*([^<]+?)\s*<\/a>/);
      if (!slugMatch) return articleHtml;
      const [, slug, title] = slugMatch;
      const imageUrl = resolveImage(slug, wpThumbs, manifestImages, blogImages);
      return enrichArticle(articleHtml, slug, title, imageUrl);
    }
  );

  result = addCalendarIcons(result);

  return result;
}

async function main() {
  if (!fs.existsSync(ARCHIVE_DIR)) {
    console.log('No blog-archive directory found. Run fetch-blog-archive first.');
    return;
  }

  const wpThumbs = loadWpThumbnails();
  const manifestImages = loadBlogManifestImages();
  const blogImages = loadBlogImageMap(ROOT);
  const files = fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith('.html'));
  let updated = 0;

  for (const file of files) {
    const filePath = path.join(ARCHIVE_DIR, file);
    const html = fs.readFileSync(filePath, 'utf8');
    const next = processHtml(html, wpThumbs, manifestImages, blogImages);

    if (next !== html) {
      fs.writeFileSync(filePath, next);
      updated++;
      console.log(`Updated ${file}`);
    }
  }

  console.log(`\nProcessed ${files.length} archive pages, updated ${updated}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
