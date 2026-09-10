#!/usr/bin/env node
/**
 * Clean and enrich inner content pages (category archives, contact).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://slaapkamerinspiratie.nl';
const CONTENT_DIR = path.join(ROOT, 'src/data/content-pages');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');

function processContentHtml(html) {
  let result = html;

  result = result.replace(
    /<div id="content" data-elementor-type="wp-page"/g,
    '<div data-elementor-type="wp-page"'
  );

  if (!/id="content"/.test(result)) {
    result = result.replace(
      /(<div\s+)data-elementor-type="single-post"/,
      '$1id="content" data-elementor-type="single-post"'
    );
    result = result.replace(
      /(<div\s+)data-elementor-type="wp-page"/,
      '$1id="content" data-elementor-type="wp-page"'
    );
  }

  result = result.replace(
    /<p>([\s\S]*?)<style>[\s\S]*?<\/style>\s*(<div class="zbmp-category-links">[\s\S]*?<\/div>)\s*<\/p>/gi,
    (_, intro, grid) => {
      const text = intro.trim();
      return text ? `<p>${text}</p>\n${grid}` : grid;
    }
  );

  result = result.replace(/<style>\s*\.zbmp-category-links[\s\S]*?<\/style>/gi, '');
  result = result.replace(/<p>\s*<\/p>/g, '');

  return result;
}

function pickMdxImage(slug) {
  const candidates = [`${slug}.mdx`, `${slug}.md`].map((f) => path.join(BLOG_DIR, f));
  const filePath = candidates.find((p) => fs.existsSync(p));
  if (!filePath) return '';

  const content = fs.readFileSync(filePath, 'utf8');
  const images = [...content.matchAll(/\/uploads\/[^"\\]+\.(?:jpe?g|png|webp)/gi)].map((m) =>
    m[0].replace(/\\"/g, '')
  );
  const filtered = images.filter((img) => !/32x32|150x150|cropped-group|Group-18|icon/i.test(img));
  return filtered[0] || '';
}

async function fetchLiveOgImage(slug) {
  try {
    const res = await fetch(`${SITE}/${slug}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; migration-bot/1.0)' },
    });
    if (!res.ok) return '';
    const html = await res.text();
    const og = html.match(/<meta property="og:image" content="([^"]+)"/i)?.[1];
    return og ? og.replace(SITE, '').replace('/wp-content/uploads/', '/uploads/') : '';
  } catch {
    return '';
  }
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

function enrichSidebarPosts(html) {
  return html.replace(
    /<article class="elementor-post[^"]*"[^>]*role="listitem">([\s\S]*?)<\/article>/g,
    (articleHtml) => {
      if (articleHtml.includes('elementor-post__thumbnail')) return articleHtml;

      const slugMatch = articleHtml.match(/href="\/([^/]+)\/"[^>]*>\s*([^<]+?)\s*<\/a>/);
      if (!slugMatch) return articleHtml;

      const [, slug, title] = slugMatch;
      const imageUrl =
        pickMdxImage(slug) ||
        '/uploads/2026/06/anaterate-farmhouse-7424128_1280-300x200.jpg';

      const thumb = `<a class="elementor-post__thumbnail__link" href="/${slug}/" tabindex="-1">
\t\t\t<div class="elementor-post__thumbnail"><img width="300" height="200" src="${imageUrl}" class="attachment-medium size-medium wp-post-image" alt="${title.replace(/"/g, '&quot;')}" loading="lazy" decoding="async" /></div>
\t\t</a>
\t\t\t\t`;

      return articleHtml.replace(
        /(<article class="elementor-post[^"]*)([^"]*)"([^>]*role="listitem">)\s*<div class="elementor-post__text">/,
        `$1 has-post-thumbnail$2"$3
\t\t\t\t${thumb}<div class="elementor-post__text">`
      );
    }
  );
}

async function main() {
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.html'));
  let updated = 0;

  for (const file of files) {
    const filePath = path.join(CONTENT_DIR, file);
    let html = fs.readFileSync(filePath, 'utf8');
    const next = normalizePostImages(enrichSidebarPosts(processContentHtml(html)));

    if (next !== html) {
      fs.writeFileSync(filePath, next);
      updated++;
      console.log(`Updated ${file}`);
    }
  }

  console.log(`\nProcessed ${files.length} pages, updated ${updated}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
