#!/usr/bin/env node
/**
 * Inject featured images into homepage blog cards missing thumbnails.
 * Fetches og:image from live post pages when not available locally.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://slaapkamerinspiratie.nl';
const MAIN_HTML = path.join(ROOT, 'src/data/homepage/main.html');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const WP_XML = path.join(ROOT, 'slaapkamerinspiratienl.WordPress.2026-07-03.xml');

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
      bySlug[slug] = toMediumUrl(attachments[thumbId]);
    }
  }

  return bySlug;
}

function pickMdxImage(slug) {
  const mdxPath = path.join(BLOG_DIR, `${slug}.mdx`);
  if (!fs.existsSync(mdxPath)) return '';

  const content = fs.readFileSync(mdxPath, 'utf-8');
  const images = [...content.matchAll(/\/uploads\/[^"\\]+\.(?:jpe?g|png|webp)/gi)].map((m) =>
    m[0].replace(/\\"/g, '')
  );

  const filtered = images.filter(
    (img) => !/32x32|150x150|cropped-group|Group-18|icon/i.test(img)
  );
  return filtered.length ? toMediumUrl(filtered[0]) : '';
}

async function fetchLiveOgImage(slug) {
  const url = `${SITE}/${slug}/`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; migration-bot/1.0)' },
    });
    if (!res.ok) return '';
    const html = await res.text();
    const og = html.match(/<meta property="og:image" content="([^"]+)"/i)?.[1];
    if (og) return toMediumUrl(og);

    const img = html.match(
      /<img[^>]+src="(https:\/\/slaapkamerinspiratie\.nl\/wp-content\/uploads\/[^"]+\.(?:jpe?g|png|webp))"/i
    )?.[1];
    return img ? toMediumUrl(img) : '';
  } catch {
    return '';
  }
}

async function downloadImage(localPath) {
  if (!localPath || fs.existsSync(path.join(ROOT, 'public', localPath))) return;
  const remote = `${SITE}/wp-content/uploads/${localPath.replace('/uploads/', '')}`;
  const dest = path.join(ROOT, 'public', localPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    const res = await fetch(remote, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; migration-bot/1.0)' },
    });
    if (res.ok) fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  } catch {
    /* skip */
  }
}

function buildThumbnail(slug, imageUrl, title) {
  const safeTitle = title.replace(/"/g, '&quot;');
  return `<a class="elementor-post__thumbnail__link" href="/${slug}/" tabindex="-1">
\t\t\t<div class="elementor-post__thumbnail"><img width="300" height="200" src="${imageUrl}" class="attachment-medium size-medium wp-post-image" alt="${safeTitle}" loading="lazy" decoding="async" /></div>
\t\t</a>
\t\t\t\t`;
}

function enrichArticle(articleHtml, slug, title, imageUrl) {
  const hasThumb = articleHtml.includes('elementor-post__thumbnail');

  if (!imageUrl) return { html: articleHtml, changed: false };

  if (hasThumb) {
    const updated = articleHtml.replace(
      /(<div class="elementor-post__thumbnail"><img[^>]+src=")[^"]+("[^>]*>)/i,
      `$1${imageUrl}$2`
    );
    return { html: updated, changed: updated !== articleHtml };
  }

  const thumbnail = buildThumbnail(slug, imageUrl, title.trim());
  const updated = articleHtml.replace(
    /(<article class="elementor-post[^"]*)([^"]*)"([^>]*role="listitem">)\s*<div class="elementor-post__text">/i,
    `$1 has-post-thumbnail$2"$3
\t\t\t\t${thumbnail}<div class="elementor-post__text">`
  );
  return { html: updated, changed: true };
}

function normalizePostImages(html) {
  return html.replace(
    /<div class="elementor-post__thumbnail"><img[^>]*\/?><\/div>/gi,
    (block) => {
      const src = block.match(/src="([^"]+)"/)?.[1];
      const alt = block.match(/alt="([^"]*)"/)?.[1] || '';
      if (!src) return block;
      return `<div class="elementor-post__thumbnail"><img width="300" height="200" src="${src}" class="attachment-medium size-medium wp-post-image" alt="${alt}" loading="lazy" decoding="async" /></div>`;
    }
  );
}

async function main() {
  const wpThumbs = loadWpThumbnails();
  let html = fs.readFileSync(MAIN_HTML, 'utf-8');
  let total = 0;

  const articles = [...html.matchAll(/<article class="elementor-post[^"]*"[^>]*role="listitem">[\s\S]*?<\/article>/g)];

  for (const match of articles) {
    const articleHtml = match[0];
    const slugMatch = articleHtml.match(/href="\/([^/]+)\/"[^>]*>\s*([^<]+?)\s*<\/a>/);
    if (!slugMatch) continue;

    const [, slug, title] = slugMatch;
    let imageUrl = wpThumbs[slug] || pickMdxImage(slug);

    if (!imageUrl) {
      process.stdout.write(`Fetching image for ${slug}... `);
      imageUrl = await fetchLiveOgImage(slug);
      console.log(imageUrl ? 'OK' : 'skip');
      await new Promise((r) => setTimeout(r, 300));
    }

    if (imageUrl) await downloadImage(imageUrl);

    const { html: next, changed } = enrichArticle(articleHtml, slug, title, imageUrl);
    if (changed) {
      html = html.replace(articleHtml, next);
      total++;
    }
  }

  // Ensure posts container has ratio class for consistent thumbnails
  html = html.replace(
    'class="elementor-posts-container elementor-posts elementor-posts--skin-classic elementor-grid"',
    'class="elementor-posts-container elementor-posts elementor-posts--skin-classic elementor-grid elementor-has-item-ratio"'
  );

  fs.writeFileSync(MAIN_HTML, normalizePostImages(html));
  console.log(`\nUpdated ${total} blog cards with thumbnails.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
